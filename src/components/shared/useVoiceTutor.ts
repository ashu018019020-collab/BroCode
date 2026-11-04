import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_RATE, DEFAULT_VOICE_LANG, clampRate, micPermissionDenied, normalizeVoiceLang, pickVoiceFrom,
  recognitionLanguages, speechChunks, speechLangFor, type VoiceLangId, type VoiceStatus,
} from '../../core/ai/voice';
import { SpeechError, fetchSpeech, voiceStatus, type ServerVoiceState } from '../../core/voice/tts';


/**
 * Speech in and speech out, as a hook.
 *
 * This is the only place in the app that touches `SpeechRecognition` and `speechSynthesis`. Both
 * have sharp edges, and every one of them is handled here instead of in the interview room's JSX:
 *
 *  - SPEECH OUT comes from the deployment's own route (`/api/voice/tts`, Azure AI Speech) and is
 *    played through one `<audio>` element; when the server has no key, or the learner explicitly
 *    switches, the BROWSER's synthesiser speaks instead. There is never a model in the tab. For the
 *    device voice, `pickVoiceFrom` ranks the browser's voices for the chosen language — Google's
 *    voice first, which is the natural female one on Chrome, Edge and Android — the learner may pin
 *    an installed voice by name, and the settings line names the voice that actually spoke.
 *  - SPEECH IN is the browser's recogniser, and it is a different product with a different language
 *    list: `hi-IN` is missing on some Chrome builds, so the capture walks Hindi → English India →
 *    English US instead of giving up on a `language-not-supported` error.
 *  - WHY VOICE USED TO DIE MID-SESSION (the Answer-by-Voice bug, fixed here, three causes):
 *
 *      1. UTTERANCE GC. The old browser path created `SpeechSynthesisUtterance` objects as local
 *         variables. Chrome has a long-standing bug where a collected utterance fires neither
 *         `onend` nor `onerror`, so the queue latched "speaking" forever and every later turn
 *         started behind a dead chain. Every utterance is now held in a strong ref until its own
 *         event runs, and cleared only when the whole answer finishes or is intentionally stopped.
 *      2. FIRST UTTERANCE AFTER `cancel()`. `speak()` legitimately stops anything already playing
 *         first (one answer at a time), and Chrome silently DROPS the utterance spoken in the same
 *         tick right after a cancel — the exact moment "Answer by Voice" finishes and the verdict
 *         speech starts. The first chunk of a new answer is now deferred ~180 ms past a cancel.
 *      3. NO WATCHDOG. Any browser where the audio engine stalls outside the events had no
 *         recovery, so the interview needed a page refresh. A 1 s watchdog now detects a stalled
 *         chain and self-recovers the unheard remainder (twice), before reporting a voice error.
 *
 *  Every utterance carries a generation id and the watchdog runs only while the engine really
 *  believes it is speaking: `cancel()` fires for INTENTIONAL interruption only (Stop, pause, leave,
 *  navigation, shutdown) — never as part of a render or a transcript update.
 *
 *  - SPEECH IN. Recognition is Chromium-only. It is created per press, aborted on stop and on
 *    unmount, and starting to listen still interrupts the tutor's own speech (barge-in: the
 *    learner talking outranks the AI talking). The interview asks for `continuous: true`, which
 *    holds the mic open across sentence pauses and re-arms the recognition Chrome auto-ends, so a
 *    long spoken answer lands whole in the transcript box. `startListening` stays
 *    backwards-compatible: without options it is the assistant's single-shot press.
 *  - THE MIC AND THE VOICE ARE SEPARATE. A recognition error (a refused permission, no network)
 *    sets `micDenied`/`error` and never touches the speech engine or the voice mode toggle; the
 *    caller decides what that means (see `core/ai/voice-session.ts` for the tested state rules).
 *
 * Preferences (language, speed, pitch, voice, read-replies) are device preferences in `aiml:voice`,
 * not learner records: nothing here is uploaded, and no audio is recorded or stored — the
 * transcript is the only thing that leaves the microphone.
 */

const PREFS_KEY = 'aiml:voice';


interface Prefs {
  lang: VoiceLangId;
  rate: number;
  pitch: number;
  /** Preferred browser voice by name; null = let the engine's ranking decide. */
  voiceName: string | null;
  speakReplies: boolean;
}

const DEFAULT_PREFS: Prefs = {
  // Auto-speak stays ON (a talking tutor); a stored "Voice off" still wins.
  lang: DEFAULT_VOICE_LANG, rate: DEFAULT_RATE, pitch: 1, voiceName: null, speakReplies: true,
};

/** Pitch is clamped, not validated: a slider can never produce a chipmunk or a rumble. */
function clampPitch(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.round(Math.min(1.4, Math.max(0.6, n)) * 10) / 10;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs> | null;
    return {
      lang: normalizeVoiceLang(parsed?.lang),
      rate: clampRate(parsed?.rate),
      pitch: clampPitch(parsed?.pitch),
      voiceName: typeof parsed?.voiceName === 'string' && parsed.voiceName ? parsed.voiceName : null,
      speakReplies: parsed?.speakReplies !== false,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/* ------------------------------ browser typings ------------------------------ */
/* `lib.dom` still ships no SpeechRecognition, and `webkitSpeechRecognition` is the real name in
   Chrome/Edge. Declaring the slice we use keeps this file honest without `any`. */
interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface RecognitionEvent { resultIndex: number; results: { length: number; [index: number]: RecognitionResult } }
interface RecognitionErrorEvent { error: string }

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function synthesisAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

/** The failure a learner can act on, in their words — never the raw DOM error code alone. */
function recognitionErrorCopy(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission is blocked. Allow it in the address bar, then press the mic again.';
    case 'no-speech':
      return 'I did not hear anything. Press the mic and speak right after it says Listening.';
    case 'audio-capture':
      return 'No microphone was found. Check that one is connected and allowed.';
    case 'network':
      return 'Speech recognition needs a network connection in this browser. You can type instead.';
    case 'language-not-supported':
      return 'This browser’s speech recogniser does not know that language. Switch Language to English, or type your answer.';
    case 'aborted':
      return '';
    default:
      return `Voice input stopped (${code}). You can type instead.`;
  }
}

/** Codes that mean "the engine went quiet", not "the learner is finished": keep the mic open. */
const QUIET_CODES = new Set(['no-speech', 'aborted']);
/** Chrome replays a previous final result on a re-armed instance; a real repeat comes later. */
const REPEAT_WINDOW_MS = 2500;

/** Chrome drops an utterance spoken in the same tick as a cancel; this is the tested-over gap. */
const CANCEL_GAP_MS = 180;
/** A browser chain is stalled when no utterance activity happened for this long. */
const STALL_MS = 8000;
/** The stall recovery self-repairs the unheard remainder at most twice, then reports honestly. */
const STALL_RETRIES = 2;
/** A continuous (interview) listening press is capped, in case a learner walks away. */
const CONTINUOUS_MAX_MS = 120_000;
/** Chrome auto-ends a continuous recognition; it is re-armed at most this many times per press. */
const CONTINUOUS_REARMS = 8;

/** The browser voice for this language, honouring the learner's explicit choice when it exists. */
function pickBrowserVoice(lang: VoiceLangId, voiceName: string | null): SpeechSynthesisVoice | null {
  if (voiceName) {
    const named = window.speechSynthesis.getVoices().find((voice) => voice.name === voiceName);
    if (named && named.lang.replace('_', '-').toLowerCase().startsWith(lang.slice(0, 2))) return named;
  }
  const chosen = pickVoiceFrom(window.speechSynthesis.getVoices(), lang);
  if (!chosen) return null;
  // The ranking only read name/lang/localService; the utterance wants the real object.
  return window.speechSynthesis.getVoices().find((voice) => voice.name === chosen.name) ?? null;
}

export interface ListenOptions {
  /**
   * Keep the microphone open across sentence pauses and re-arm it when the engine auto-ends —
   * what a spoken ANSWER needs. Default (the assistant's press) captures one utterance.
   */
  continuous?: boolean;
  /** Hard cap for a continuous capture, in ms. Defaults to CONTINUOUS_MAX_MS. */
  maxMs?: number;
}

export interface VoiceTutor {
  supported: { synthesis: boolean; recognition: boolean };
  lang: VoiceLangId;
  setLang: (lang: VoiceLangId) => void;
  rate: number;
  setRate: (rate: number) => void;
  pitch: number;
  setPitch: (pitch: number) => void;
  /** Every voice this browser exposes, for the interview room's voice selector. */
  voices: { name: string; lang: string; localService: boolean }[];
  voiceName: string | null;
  setVoiceName: (name: string | null) => void;
  speakReplies: boolean;
  setSpeakReplies: (on: boolean) => void;
  status: VoiceStatus;
  listening: boolean;
  speaking: boolean;
  paused: boolean;
  /** Which engine spoke last: the deployment's Azure voice, or this browser's own synthesiser. */
  engine: 'browser' | 'server' | null;
  /**
   * Can this browser speak at all? A synchronous capability check, not a network probe: there is no
   * server voice left to wait for, so the rows label the controls correctly on the first render.
   */
  synthesisReady: boolean;
  /** The SERVER voice's state: a real probe of /api/voice/status, not a guess. */
  serverVoice: ServerVoiceState;
  /** The voice id the server will speak the current language with (`hi-IN-SwaraNeural`). */
  voiceId: string | null;
  /** The learner's own choice to fall back to the device voice. Never switched on behind their back. */
  useDeviceVoice: boolean;
  setUseDeviceVoice: (on: boolean) => void;
  /** The live partial transcript while the learner is speaking. */
  interim: string;
  /** The last thing spoken, so "Replay" can repeat it without re-asking the engine. */
  lastSpoken: { text: string; sources: { title: string }[] } | null;
  error: string | null;
  dismissError: () => void;
  /** Was the latest voice-input failure a REFUSED microphone permission? */
  micDenied: boolean;
  startListening: (onTranscript: (text: string) => void, options?: ListenOptions) => void;
  stopListening: () => void;
  toggleListening: (onTranscript: (text: string) => void, options?: ListenOptions) => void;
  /**
   * Speak an answer. `onEnd` runs only when the speech really finished — never after Stop, a
   * navigation, or a barge-in — which is what lets the room auto-advance, or the mentor reopen the
   * mic for a hands-free turn, without ever leaving a microphone open after an interruption.
   */
  speak: (text: string, sources?: { title: string }[], onEnd?: () => void) => void;
  /** Say the last answer again. A no-op when nothing has been spoken. */
  replay: () => void;
  stopSpeaking: () => void;
  pauseSpeaking: () => void;
  resumeSpeaking: () => void;
}

export function useVoiceTutor(thinking = false): VoiceTutor {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastSpoken, setLastSpoken] = useState<{ text: string; sources: { title: string }[] } | null>(null);
  const [voices, setVoices] = useState<{ name: string; lang: string; localService: boolean }[]>([]);
  const [serverVoice, setServerVoice] = useState<ServerVoiceState>('checking');
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [useDeviceVoice, setUseDeviceVoice] = useState(false);
  /** The <audio> element currently speaking the server's audio, and every URL it has created. */
  const serverAudio = useRef<HTMLAudioElement | null>(null);
  const blobUrls = useRef<Set<string>>(new Set());

  const recognition = useRef<RecognitionLike | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const queue = useRef<string[]>([]);
  /** Index of the NEXT browser chunk to speak — the watchdog restarts from here. */
  const queueIndex = useRef(0);
  /** Strong refs to the live utterances: Chrome's GC bug makes collected utterances mute forever. */
  const utterances = useRef<Set<SpeechSynthesisUtterance>>(new Set());
  /** Last event the browser chain produced (onstart fires per real utterance). */
  const lastActivity = useRef(0);
  const stallRetries = useRef(0);
  /** When the last INTENTIONAL speech stop happened — the first-utterance gap reads it. */
  const lastCancelAt = useRef(0);

  /** Which engine spoke last. Only the browser's can, and it stays null until it has spoken once. */
  const [engine, setEngine] = useState<'browser' | 'server' | null>(null);

  // Listening machinery that the event handlers must read without stale closures.
  const listeningRef = useRef(false);
  const keepOpenRef = useRef(false);
  const rearmCountRef = useRef(0);
  const lastFinalRef = useRef('');
  const lastFinalAtRef = useRef(0);
  /** The unfinished tail of the CURRENT press. Chrome discards it on abort, so Stop commits it. */
  const pendingPartialRef = useRef('');
  /** The callback that owns this press, so the stop path can save the words before closing. */
  const onTranscriptRef = useRef<((text: string) => void) | null>(null);
  /** Index into `recognitionLanguages(prefs.lang)`: 0 is the learner's choice, then the fallbacks. */
  const langTryRef = useRef(0);
  /** Which mic PRESS owns the lifetime timer — a stale timer must never close a newer press. */
  const micSessionRef = useRef(0);
  const micTimerRef = useRef(0);

  const supported = useMemo(() => ({ synthesis: synthesisAvailable(), recognition: recognitionCtor() !== null }), []);


  /** Stop the server audio and revoke every blob URL it made. A leak, not just a pause. */
  const releaseServerAudio = useCallback(() => {
    const audio = serverAudio.current;
    serverAudio.current = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      try { audio.pause(); } catch { /* already stopped */ }
      audio.removeAttribute('src');
      try { audio.load(); } catch { /* detached */ }
    }
    for (const url of blobUrls.current) URL.revokeObjectURL(url);
    blobUrls.current.clear();
  }, []);

  /** Drop every strong utterance ref. Called on intentional stop and on a full answer finish. */
  const releaseUtterances = useCallback(() => {
    for (const utterance of utterances.current) {
      // The handlers are nulled FIRST so a late Chrome event can never advance a dead generation.
      utterance.onstart = null;
      utterance.onend = null;
      utterance.onerror = null;
    }
    utterances.current.clear();
    lastActivity.current = 0;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      try { recognition.current?.abort(); } catch { /* already stopped */ }
      recognition.current = null;
      releaseUtterances();
      releaseServerAudio();
      if (synthesisAvailable()) window.speechSynthesis.cancel();
    };
  }, [releaseServerAudio, releaseUtterances]);

  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* quota or blocked */ }
  }, [prefs]);

  // Voices load asynchronously in Chrome; asking early returns [] and every language falls back to
  // the default voice. One listener warms the list up (and feeds the voice selector) without a
  // polling loop. Reading getVoices() here also keeps the OBJECTS alive for the utterance path.
  useEffect(() => {
    if (!synthesisAvailable()) return;
    const warm = () => {
      const list = window.speechSynthesis.getVoices();
      if (list.length) {
        setVoices(list.map((v) => ({ name: v.name, lang: v.lang, localService: v.localService })));
      }
    };
    warm();
    window.speechSynthesis.addEventListener?.('voiceschanged', warm);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', warm);
  }, []);


  // Ask the API once which female voice it will speak with. A failed probe is not an error the
  // learner must act on yet: the row names the device voice as the explicit alternative.
  useEffect(() => {
    let alive = true;
    void voiceStatus().then((status) => {
      if (!alive) return;
      setServerVoice(status?.configured ? 'ready' : 'unavailable');
      setVoiceId(status?.configured ? (status.voices[prefs.lang] ?? null) : null);
    });
    return () => { alive = false; };
  }, [prefs.lang]);


  const stopListening = useCallback(() => {
    keepOpenRef.current = false;
    listeningRef.current = false;
    // Stop means "keep what I said". Chrome drops the interim transcript the moment the recogniser
    // is aborted, which is why a learner could speak a whole answer and press Stop on an EMPTY box.
    const pending = pendingPartialRef.current.trim();
    pendingPartialRef.current = '';
    if (pending) {
      const replay = pending === lastFinalRef.current && Date.now() - lastFinalAtRef.current < REPEAT_WINDOW_MS;
      if (!replay) {
        try { onTranscriptRef.current?.(pending); } catch (cause) {
          console.warn('BroCode voice: the final transcript could not be saved.', cause);
        }
      }
    }
    if (micTimerRef.current) {
      window.clearTimeout(micTimerRef.current);
      micTimerRef.current = 0;
    }
    try { recognition.current?.abort(); } catch { /* already gone */ }
    recognition.current = null;
    if (mounted.current) {
      setListening(false);
      setInterim('');
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    // An intentional stop. Chrome measures this instant against the next speak() — see CANCEL_GAP_MS.
    lastCancelAt.current = Date.now();
    generation.current += 1;
    queue.current = [];
    queueIndex.current = 0;
    stallRetries.current = 0;
    releaseUtterances();
    if (synthesisAvailable()) {
      try { window.speechSynthesis.cancel(); } catch { /* nothing queued */ }
    }
    releaseServerAudio();
    if (mounted.current) {
      setSpeaking(false);
      setPaused(false);
    }
  }, [releaseServerAudio, releaseUtterances]);

  const speak = useCallback((text: string, sources: { title: string }[] = [], onEnd?: () => void) => {
    const chunks = speechChunks(text);
    if (!chunks.length) return;
    const viaServer = serverVoice === 'ready' && !useDeviceVoice;
    if (!viaServer && !supported.synthesis) {
      setError('This browser cannot read text aloud, and the server voice is not configured.');
      return;
    }
    stopSpeaking();
    const id = generation.current;
    queue.current = chunks;
    queueIndex.current = 0;
    stallRetries.current = 0;
    setLastSpoken({ text, sources });
    setError(null);
    setSpeaking(true);
    setPaused(false);
    lastActivity.current = Date.now();

    /** One completion per answer. Stop/navigation bumps the generation, so a stale queue cannot fire it. */
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      releaseUtterances();
      releaseServerAudio();
      if (!mounted.current || id !== generation.current) return;
      setSpeaking(false);
      setPaused(false);
      onEnd?.();
    };

    const fail = (message: string) => {
      if (!mounted.current || id !== generation.current) return;
      setError(message);
      setSpeaking(false);
      setPaused(false);
    };

    /** The device engine — only ever reached when the learner chose it, or the server has no key. */
    const speakWithBrowser = () => {
      if (!mounted.current || id !== generation.current) return;
      setEngine('browser');

      const speakChunk = (index: number) => {
        if (!mounted.current || id !== generation.current) return;
        const chunk = queue.current[index];
        if (!chunk) {
          queueIndex.current = index;
          finish();
          return;
        }
        queueIndex.current = index;
        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.lang = prefs.lang;
        utterance.rate = prefs.rate;
        utterance.pitch = prefs.pitch;
        utterance.volume = 1;
        const voice = pickBrowserVoice(prefs.lang, prefs.voiceName);
        if (voice) utterance.voice = voice;
        // STRONG REF: the utterance object must outlive its own callbacks, or Chrome may collect it
        // mid-speech and fire no event at all — the cause of voice going permanently silent.
        utterances.current.add(utterance);
        let done = false;
        const advance = () => {
          if (done) return;
          done = true;
          utterances.current.delete(utterance);
          lastActivity.current = Date.now();
          if (!mounted.current || id !== generation.current) return;
          if (index + 1 >= queue.current.length) {
            finish();
            return;
          }
          speakChunk(index + 1);
        };
        utterance.onstart = () => { lastActivity.current = Date.now(); };
        utterance.onend = advance;
        utterance.onerror = advance; // a failed engine advances; silence beats a hung "speaking"
        try {
          window.speechSynthesis.speak(utterance);
        } catch {
          advance();
          return;
        }
        // The Windows-Chrome stuck bug: speak() resolves but nothing plays and no event ever fires.
        window.setTimeout(() => {
          if (!mounted.current || id !== generation.current || done) return;
          if (window.speechSynthesis.speaking || window.speechSynthesis.pending) return;
          try { window.speechSynthesis.cancel(); } catch { /* nothing queued */ }
          speakChunk(index);
        }, 600);
      };

      const start = () => speakChunk(0);
      // Chrome drops the FIRST utterance spoken in the same tick as a cancel.
      if (Date.now() - lastCancelAt.current < CANCEL_GAP_MS) {
        window.setTimeout(start, CANCEL_GAP_MS + 60);
      } else {
        start();
      }
    };

    /**
     * The server engine: one sentence per request, played in order on ONE <audio> element.
     *
     *  - ORDERING is the anti-overlap guarantee: the next chunk is only started by the previous
     *    `onended`, so a rapid double-press cannot open a second stream (the generation guard ends the
     *    earlier one first).
     *  - PREFETCH: the next sentence is fetched while this one speaks, so the gap is a breath rather
     *    than a round-trip.
     *  - NO SILENT FALLBACK: a failure is shown, and the device voice stays the learner's choice.
     */
    const speakFromServer = () => {
      setEngine('server');
      const urls: (string | null)[] = queue.current.map(() => null);

      const load = async (index: number): Promise<string> => {
        const cached = urls[index];
        if (cached) return cached;
        const url = await fetchSpeech({ text: queue.current[index], lang: prefs.lang, rate: prefs.rate });
        urls[index] = url;
        blobUrls.current.add(url);
        return url;
      };

      const play = (index: number) => {
        if (!mounted.current || id !== generation.current) return;
        queueIndex.current = index;
        if (index >= queue.current.length) { finish(); return; }
        void load(index).then((url) => {
          if (!mounted.current || id !== generation.current) return;
          const audio = new Audio(url);
          audio.preload = 'auto';
          serverAudio.current = audio;
          audio.onended = () => {
            lastActivity.current = Date.now();
            if (!mounted.current || id !== generation.current) return;
            play(index + 1);
          };
          audio.onerror = () => fail('The generated audio could not be played. Press Replay, or switch to the device voice.');
          void audio.play().catch(() => fail('Your browser blocked playback. Press Speak once more.'));
          // Warm the next sentence while this one is speaking.
          if (index + 1 < queue.current.length) void load(index + 1).catch(() => { /* retried on demand */ });
        }).catch((cause: unknown) => {
          if (!mounted.current || id !== generation.current) return;
          if (cause instanceof SpeechError && cause.status === 503) {
            // The server answered and said it has no key: that is a fact about THIS deployment, so
            // the row updates and the device voice becomes an explicit offer, never an automatic swap.
            setServerVoice('unavailable');
            fail('The server voice is not configured. Press “Use device voice” to hear answers in this browser’s voice.');
            return;
          }
          fail(cause instanceof Error && cause.message ? cause.message : 'The voice could not be generated.');
        });
      };

      play(0);
    };

    if (viaServer) speakFromServer();
    else speakWithBrowser();
  }, [
    prefs.lang, prefs.pitch, prefs.rate, prefs.voiceName, releaseServerAudio, releaseUtterances,
    serverVoice, stopSpeaking, supported.synthesis, useDeviceVoice,
  ]);

  const replay = useCallback(() => {
    if (lastSpoken) speak(lastSpoken.text, lastSpoken.sources);
  }, [lastSpoken, speak]);

  const startListening = useCallback((onTranscript: (text: string) => void, options: ListenOptions = {}) => {
    const Ctor = recognitionCtor();
    if (!Ctor) { setError('This browser has no speech recognition. Type your question instead.'); return; }
    const continuous = options.continuous === true;
    const maxMs = options.maxMs ?? CONTINUOUS_MAX_MS;
    // Barge-in: the learner talking is always the higher priority than the tutor talking.
    stopSpeaking();
    stopListening();
    setError(null);
    setInterim('');
    lastFinalRef.current = '';
    lastFinalAtRef.current = 0;
    pendingPartialRef.current = '';
    onTranscriptRef.current = onTranscript;
    keepOpenRef.current = continuous;
    rearmCountRef.current = 0;
    langTryRef.current = 0;
    micSessionRef.current += 1;
    const session = micSessionRef.current;
    if (micTimerRef.current) {
      // The previous press's cap (if it is still armed) must never close THIS press.
      window.clearTimeout(micTimerRef.current);
      micTimerRef.current = 0;
    }
    let alive = true;

    // Speech-out and speech-IN don't share a language list: the recogniser is a network service and
    // some builds have no Hindi model, which until now meant a mic that never typed a word.
    const languages = recognitionLanguages(prefs.lang);

    /**
     * Chrome throws `InvalidStateError` on `start()` while the previous instance is still closing —
     * which is exactly what happens after the room stops one mic and opens the next (barge-in, an
     * auto-listened turn). One short retry turns that into a working press instead of an error.
     */
    const startInstance = (instance: RecognitionLike, attempt = 0) => {
      if (!alive || !mounted.current) return;
      try {
        instance.start();
        listeningRef.current = true;
        setListening(true);
      } catch (cause) {
        if (attempt < 1 && keepOpenRef.current) {
          window.setTimeout(() => {
            if (!alive || !keepOpenRef.current || !mounted.current) return;
            startInstance(instance, attempt + 1);
          }, 300);
          return;
        }
        console.warn('BroCode voice: speech recognition did not start', cause);
        setError('The microphone is still closing from the last try. Press the mic again.');
        listeningRef.current = false;
        setListening(false);
        recognition.current = null;
      }
    };

    /** Re-arm after an auto-end, an error the mic survives, or a language it did not have. */
    const rearm = (delayMs: number) => {
      if (rearmCountRef.current >= CONTINUOUS_REARMS) return false;
      rearmCountRef.current += 1;
      window.setTimeout(() => {
        if (!alive || !keepOpenRef.current || !mounted.current) return;
        try {
          arm();
        } catch (cause) {
          console.warn('BroCode voice: re-arming recognition failed', cause);
        }
      }, delayMs);
      return true;
    };

    const arm = () => {
      if (!alive || !keepOpenRef.current) return;
      const instance = new Ctor();
      instance.lang = languages[Math.min(langTryRef.current, languages.length - 1)];
      instance.continuous = continuous;
      instance.interimResults = true;
      instance.onresult = (event) => {
        let final = '';
        let partial = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (!result) continue;
          if (result.isFinal) final += result[0].transcript;
          else partial += result[0].transcript;
        }
        pendingPartialRef.current = partial;
        if (mounted.current) setInterim(partial);
        if (final.trim()) {
          const text = final.trim();
          // Chrome replays the last final result on a re-armed instance. Dedupe only inside a short
          // window: a learner who really repeats a sentence a few seconds later must keep it.
          if (text === lastFinalRef.current && Date.now() - lastFinalAtRef.current < REPEAT_WINDOW_MS) return;
          lastFinalRef.current = text;
          lastFinalAtRef.current = Date.now();
          // Continuous mode appends one sentence per final result and KEEPS listening; single-shot
          // mode (the assistant's press) closes the mic after the one utterance, as before.
          if (!continuous) {
            keepOpenRef.current = false;
            alive = false;
            listeningRef.current = false;
            setListening(false);
            setInterim('');
            try { instance.stop(); } catch { /* already ended */ }
            recognition.current = null;
          }
          onTranscript(text);
        }
      };
      instance.onerror = (event) => {
        recognition.current = null;
        const code = event.error;
        if (!mounted.current || !alive) return;

        // Silence is not an answer. A continuous capture (the interview's mic) survives `no-speech`
        // and its own auto-end, which is what made "Answer by voice" look broken after one pause.
        if (keepOpenRef.current && QUIET_CODES.has(code)) {
          if (rearm(360)) return;
          keepOpenRef.current = false;
          listeningRef.current = false;
          setListening(false);
          setInterim('');
          setError('I stopped after a long silence. Press the mic again when you are ready, or type.');
          return;
        }

        // A recogniser without this language model is not the learner's mistake: move down the
        // chain (Hindi → English India → English US) and keep listening.
        if (code === 'language-not-supported' && langTryRef.current + 1 < languages.length) {
          langTryRef.current += 1;
          if (keepOpenRef.current && rearm(120)) return;
        }

        // The mic's failure must never reach the SPEAKER: voice mode stays exactly as the learner
        // left it, and the page shows the cause with the text fallback beside it.
        listeningRef.current = false;
        if (mounted.current) {
          const copy = recognitionErrorCopy(code);
          if (copy) setError(copy);
          setListening(false);
          setInterim('');
        }
      };
      instance.onend = () => {
        recognition.current = null;
        if (!mounted.current || !alive) return;
        if (keepOpenRef.current) {
          // Chrome ends a continuous recognition after every pause. Re-arm it — a spoken answer
          // naturally stops mid-sentence, and one auto-end must not become "Answer by Voice
          // stopped working". The rearm cap keeps a dead mic from cycling forever.
          if (!rearm(360)) {
            keepOpenRef.current = false;
            setListening(false);
          }
          return;
        }
        if (mounted.current) {
          setListening(false);
          setInterim('');
        }
      };
      recognition.current = instance;
      startInstance(instance);
    };

    arm();
    if (continuous && maxMs > 0) {
      // A walked-away mic closes itself; the transcript captured so far stays in the answer box.
      // The cap dies with its OWN press: a newer press (a higher session) is never touched by an
      // old timer, and a manual stop clears the timer outright.
      micTimerRef.current = window.setTimeout(() => {
        if (micSessionRef.current !== session) return;
        alive = false;
        keepOpenRef.current = false;
        stopListening();
      }, maxMs);
    }
  }, [prefs.lang, stopListening, stopSpeaking]);

  const toggleListening = useCallback((onTranscript: (text: string) => void, options?: ListenOptions) => {
    if (listeningRef.current) stopListening();
    else startListening(onTranscript, options);
  }, [startListening, stopListening]);

  /**
   * Pause, without ever claiming a pause that did not happen.
   *
   * `speechSynthesis.pause()` on an engine that is not speaking is a silent no-op, and reporting
   * "Paused" after it is how the controls came to disagree with the sound. So the press reads the
   * synthesiser's own state first and claims only the pause it actually caused.
   */
  const pauseSpeaking = useCallback(() => {
    const audio = serverAudio.current;
    if (audio && !audio.paused) {
      audio.pause();
      setPaused(true);
      return;
    }
    if (!supported.synthesis) return;
    if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) return;
    try { window.speechSynthesis.pause(); setPaused(true); } catch { /* nothing to pause */ }
  }, [supported.synthesis]);

  const resumeSpeaking = useCallback(() => {
    const audio = serverAudio.current;
    if (audio && audio.paused) {
      void audio.play().then(() => { if (mounted.current) setPaused(false); }).catch(() => { /* blocked */ });
      return;
    }
    if (!supported.synthesis) return;
    try { window.speechSynthesis.resume(); setPaused(false); } catch { /* nothing paused */ }
  }, [supported.synthesis]);

  /**
   * The watchdog. Runs only while `speaking` believes itself true, and repairs exactly the two
   * stalls no event can tell us about:
   *
   *  - the browser chain went mute with chunks left (GC bug, an engine that fired no events) —
   *    cancel and re-speak the unheard remainder, twice at most, then finish with an honest error.
   *
   * It never touches the mic: while the learner is being recorded, the machines hold still —
   * turn-taking, not a race.
   */
  useEffect(() => {
    if (!speaking) return;
    const timer = window.setInterval(() => {
      if (!mounted.current) return;
      if (listeningRef.current) return; // recording owns the turn; no sound is expected
      if (Date.now() - lastActivity.current < STALL_MS) return;
      if (window.speechSynthesis.paused) {
        // Paused playback is not a stall: hold the timestamp so the watchdog stays idle.
        lastActivity.current = Date.now();
        return;
      }
      // Browser engine, stalled, with or without a remainder.
      if (stallRetries.current >= STALL_RETRIES) {
        stopSpeaking();
        setError('The voice stopped speaking on this device. Press Replay to hear the last answer again.');
        return;
      }
      stallRetries.current += 1;
      const remainder = queue.current.slice(queueIndex.current).join(' ');
      generation.current += 1;
      try { window.speechSynthesis.cancel(); } catch { /* nothing queued */ }
      releaseUtterances();
      lastCancelAt.current = 0; // the gap after a cancel would delay the recovery two beats
      if (remainder) {
        // Re-speak only what has not been heard — no sentence twice, none skipped.
        remainder && speak(remainder);
      } else {
        setSpeaking(false);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [releaseUtterances, speak, speaking, stopSpeaking]);

  // An error is a real state, not a hidden flag: a dead microphone or a missing synthesiser must
  // stop the controls looking as if everything is idle.
  const status: VoiceStatus = speaking
    ? 'speaking'
    : listening
      ? 'listening'
      : error
        ? 'error'
        : thinking
          ? 'thinking'
          : 'off';

  return {
    supported,
    lang: prefs.lang,
    setLang: (lang) => setPrefs((current) => ({ ...current, lang: normalizeVoiceLang(lang) })),
    rate: prefs.rate,
    setRate: (rate) => setPrefs((current) => ({ ...current, rate: clampRate(rate) })),
    pitch: prefs.pitch,
    setPitch: (pitch) => setPrefs((current) => ({ ...current, pitch: clampPitch(pitch) })),
    voices,
    voiceName: prefs.voiceName,
    setVoiceName: (name) => setPrefs((current) => ({ ...current, voiceName: name })),
    speakReplies: prefs.speakReplies,
    setSpeakReplies: (on) => setPrefs((current) => ({ ...current, speakReplies: on })),
    status,
    listening,
    speaking,
    paused,
    engine,
    synthesisReady: supported.synthesis,
    serverVoice,
    voiceId,
    useDeviceVoice,
    setUseDeviceVoice,
    interim,
    lastSpoken,
    error,
    dismissError: () => setError(null),
    micDenied: micPermissionDenied(error),
    startListening,
    stopListening,
    toggleListening,
    speak,
    replay,
    stopSpeaking,
    pauseSpeaking,
    resumeSpeaking,
  };
}
