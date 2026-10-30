import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_RATE, DEFAULT_VOICE_LANG, clampRate, cloudChunks, micPermissionDenied, normalizeVoiceLang, pickVoiceFrom,
  speechChunks, type VoiceLangId, type VoiceStatus,
} from '../../core/ai/voice';
import { noteVoiceAnswer, noteVoiceFailure } from '../../core/storage/voice-telemetry';
import { createVoiceClient, INITIAL_VOICE_STATUS, type VoiceClient, type VoiceStatus as EngineStatus } from '../../core/voice/client';
import { DEFAULT_PRESET, isVoicePreset, clearVoiceCache as clearVoiceCacheEntries, type VoicePreset } from '../../core/voice/assets';
import { speechRequests, languageForChunk } from '../../core/voice/text';


/**
 * Speech in and speech out, as a hook.
 *
 * This is the only place in the app that touches `SpeechRecognition`, `speechSynthesis` and the
 * tutor's cloud voice. All three have sharp edges, and every one of them is handled here instead of
 * in the interview room's JSX:
 *
 *  - SPEECH OUT is Supertonic 3, and it runs IN THIS BROWSER. A worker
 *    (`src/workers/tts.worker.ts`) downloads the revision-pinned checkpoint once, caches it in Cache
 *    Storage, builds the four ONNX sessions and synthesises one sentence at a time; this hook only
 *    queues those sentences and plays them through one `AudioContext`. There is no server route and no
 *    status probe: "is the voice configured?" is not a question that can have a wrong answer. Progress,
 *    readiness and failures come from the engine itself and are surfaced verbatim.
 *    A failure is an ERROR with a Retry that re-runs the real work — never a quiet hand-off to the
 *    browser's robotic synthesiser, which is exactly how a broken voice used to look healthy.
 *    The built-in browser synthesiser survives only behind the learner's explicit `engine: 'browser'`
 *    preference, where it is labelled as such.
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

/*
 * The two copy strings the primary flow is allowed to fail with. They name the cause instead of
 * apologising, and both point at Retry — which re-probes the deployment and re-issues the request
 * (`refreshServerVoice` + the learner's own press), so a voice configured after this tab was opened
 * starts working without a reload.
 */
const VOICE_ABSENT_TEXT = 'Supertonic 3 cannot run in this browser, so nothing is spoken. Retry re-checks the engine.';
const VOICE_FAILED_TEXT = 'The AI voice could not answer that. Nothing is spoken — press Retry to ask the server again.';
const VOICE_AUDIO_TEXT = 'This browser cannot play the AI voice (Web Audio is unavailable). Nothing is spoken.';

/* The voice worker — the ONLY speech provider. There is no status endpoint to probe any more: the
   model lives in the browser, so "is it configured?" is not a question that can have a wrong answer. */
const VOICE_STEPS = 8;

/** "The account API answers, and its Google key is configured." Null until the probe resolves. */
type CloudState = boolean | null;

interface Prefs {
  lang: VoiceLangId;
  /** Which Supertonic voice preset speaks — `F1`…`F5`, `M1`…`M5`, stored per device. */
  preset: VoicePreset;
  rate: number;
  pitch: number;
  /** Preferred browser voice by name; null = let the engine's ranking decide. */
  voiceName: string | null;
  speakReplies: boolean;
  /**
   * The learner's choice of speaking voice, not a capability probe: `ai` means "use the server AI
   * voice when it is reachable", and every path where it is NOT falls back to the built-in voice with
   * a line that says which one actually spoke. Stored preferences from the old on-device build carry
   * over unchanged — `ai` simply means the hosted voice now.
   */
  engine: 'ai' | 'browser';
}

const DEFAULT_PREFS: Prefs = {
  lang: DEFAULT_VOICE_LANG, preset: DEFAULT_PRESET, rate: DEFAULT_RATE, pitch: 1, voiceName: null, speakReplies: false, engine: 'ai',
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
      preset: isVoicePreset(parsed?.preset) ? parsed.preset : DEFAULT_PRESET,
      rate: clampRate(parsed?.rate),
      pitch: clampPitch(parsed?.pitch),
      voiceName: typeof parsed?.voiceName === 'string' && parsed.voiceName ? parsed.voiceName : null,
      speakReplies: parsed?.speakReplies === true,
      engine: parsed?.engine === 'browser' ? 'browser' : 'ai',
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

/**
 * Web Audio, for gapless cloud playback. Safari only ever shipped the prefixed constructor; a
 * browser with neither falls back to its own synthesiser rather than going silent.
 */
type AudioContextCtor = new () => AudioContext;
function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
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
    case 'aborted':
      return '';
    default:
      return `Voice input stopped (${code}). You can type instead.`;
  }
}

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
  /** Which Supertonic voice preset is selected. */
  preset: VoicePreset;
  setPreset: (preset: VoicePreset) => void;
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
  /**
   * Which engine spoke last: the server's Supertonic voice, the server's Google voice, or the
   * built-in browser voice. Never a promise about what the deployment has.
   */
  engine: 'supertonic' | 'cloud' | 'browser' | null;
  /**
   * What the ENGINE reported: downloading (with progress), initializing, ready, speaking, or an
   * error with a code. The panel renders this verbatim instead of guessing at a host's state.
   */
  voiceStatus: EngineStatus;
  /** The engine's state in the shape the older rows read it (`checking`/`ready`/`unavailable`). */
  serverVoice: { state: 'checking' | 'ready' | 'unavailable'; engine: 'supertonic' | 'google' | 'none' | null };
  /** Retry the real thing: start the download and the sessions again. */
  refreshServerVoice: () => void;
  /** Delete ONLY this model's Cache Storage entry — never learner data. */
  clearVoiceCache: () => Promise<string[]>;
  /** True once the engine can speak — false while it is still loading or after a failure. */
  cloudConfigured: boolean;
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

  /**
   * The engine's own report, straight from the worker: download progress, initialization, ready,
   * speaking, or a real error with a code. Nothing here is inferred from a guess about the host.
   */
  const [voiceStatus, setVoiceStatus] = useState<EngineStatus>(INITIAL_VOICE_STATUS);

  // The cloud voice's own machinery. `context` is ONE Web Audio graph reused for the whole page —
  // creating an AudioContext per answer hits Chrome's per-page limit and costs the start-up latency
  // on every reply. `sources` are the chunks currently scheduled or playing; `abort` cancels
  // in-flight chunk fetches on Stop/unmount; `fails` counts consecutive cloud failures so a dead
  // endpoint is abandoned after the second instead of taxing every following answer with the same
  // timeout.
  const [engine, setEngine] = useState<'supertonic' | 'cloud' | 'browser' | null>(null);
  const voiceRef = useRef<VoiceClient | null>(null);
  const engineRef = useRef<'supertonic' | 'cloud' | 'browser' | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const activeSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const cloudAbort = useRef<AbortController | null>(null);

  // Listening machinery that the event handlers must read without stale closures.
  const listeningRef = useRef(false);
  const keepOpenRef = useRef(false);
  const rearmCountRef = useRef(0);
  const lastFinalRef = useRef('');
  /** Which mic PRESS owns the lifetime timer — a stale timer must never close a newer press. */
  const micSessionRef = useRef(0);
  const micTimerRef = useRef(0);

  /** One setter for the engine, so the ref the pause switch reads can never lag the state. */
  const markEngine = useCallback((next: 'supertonic' | 'cloud' | 'browser') => {
    engineRef.current = next;
    setEngine(next);
  }, []);

  const supported = useMemo(() => ({ synthesis: synthesisAvailable(), recognition: recognitionCtor() !== null }), []);

  /**
   * One worker for the page's lifetime — created on mount, terminated on unmount. It is NOT created
   * eagerly in a `useMemo`: mounting a worker starts the module graph (ONNX Runtime included), and a
   * learner who never presses Speak should not pay for that.
   */
  useEffect(() => {
    const client = createVoiceClient();
    voiceRef.current = client;
    if (!client) {
      setVoiceStatus({
        phase: 'error',
        progress: 0,
        message: 'Supertonic 3 cannot run in this browser',
        code: 'unsupported',
        detail: 'This browser has no module worker support, which the voice engine needs.',
      });
      return undefined;
    }
    const unsubscribe = client.subscribe(setVoiceStatus);
    setVoiceStatus(client.status());
    return () => {
      unsubscribe();
      client.dispose();
      voiceRef.current = null;
    };
  }, []);

  const releaseCloud = useCallback(() => {
    cloudAbort.current?.abort();
    cloudAbort.current = null;
    for (const source of activeSources.current) {
      // `onended` is cleared first: a Stop must never be read as "this chunk finished", which would
      // advance the queue or hand the rest of the answer to the other engine.
      source.onended = null;
      try { source.stop(); } catch { /* not started, or already ended */ }
      try { source.disconnect(); } catch { /* already disconnected */ }
    }
    activeSources.current.clear();
    const context = contextRef.current;
    // Freezing the clock (rather than closing the graph) makes Stop immediate and keeps the one
    // context reusable. Scheduled nodes are already stopped above.
    if (context && context.state === 'running') {
      void context.suspend().catch(() => { /* nothing scheduled */ });
    }
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

  /**
   * Retry the REAL failure: start the download and the sessions again. A retry that only cleared the
   * message would leave the engine exactly as broken as it was.
   */
  const refreshServerVoice = useCallback(() => {
    setError(null);
    voiceRef.current?.preload();
  }, []);

  /** Cache Storage is versioned per checkpoint revision, so clearing it cannot touch anything else. */
  const clearVoiceCache = useCallback(async () => {
    try {
      const removed = await clearVoiceCacheEntries();
      if (removed.length) setError(null);
      return removed;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      try { recognition.current?.abort(); } catch { /* already stopped */ }
      recognition.current = null;
      releaseCloud();
      releaseUtterances();
      const context = contextRef.current;
      contextRef.current = null;
      if (context) void context.close().catch(() => { /* already closed */ });
      if (synthesisAvailable()) window.speechSynthesis.cancel();
    };
  }, [releaseCloud, releaseUtterances]);

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

  const stopListening = useCallback(() => {
    keepOpenRef.current = false;
    listeningRef.current = false;
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
    // Cancelling the fetch is what stops the SERVER's synthesis: the request is aborted, so the
    // inference service drops the work instead of finishing an answer nobody will hear.
    releaseCloud();
    if (synthesisAvailable()) {
      try { window.speechSynthesis.cancel(); } catch { /* nothing queued */ }
    }
    if (mounted.current) {
      setSpeaking(false);
      setPaused(false);
    }
  }, [releaseCloud, releaseUtterances]);

  const speak = useCallback((text: string, sources: { title: string }[] = [], onEnd?: () => void) => {
    const chunks = speechChunks(text);
    if (!chunks.length) return;
    // Time from press to the first playable chunk of THIS answer — the number the dashboard shows
    // as latency. It is measured around the real fetch, never estimated from the text length.
    let firstAudioMs: number | null = null;
    const answerStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // The Supertonic worker is the ONLY voice the default (`engine: 'ai'`) flow may use. Its absence
    // is an ERROR, not a licence to hand the answer to the browser's robotic synthesiser.
    const client = voiceRef.current;
    const cloudUsable = prefs.engine === 'ai' && client !== null;
    if (prefs.engine === 'ai' && !client) {
      setError(VOICE_ABSENT_TEXT);
      setSpeaking(false);
      return;
    }
    if (!cloudUsable && !supported.synthesis) {
      // Only reachable when the learner explicitly chose the built-in voice on a browser without one.
      setError('This browser cannot speak text aloud.');
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

    /**
     * One completion per utterance queue. Stop/navigation increments the generation, so a stale
     * queue can never fire it; the latch covers the cloud path's two failure reports.
     */
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      releaseUtterances();
      // One count per ANSWER, tagged with the engine that actually produced the sound. A fallback
      // mid-answer therefore lands on `browser`, which is exactly what the dashboard must show.
      const tag = engineRef.current === 'supertonic' ? 'supertonic' : engineRef.current === 'cloud' ? 'google' : 'browser';
      noteVoiceAnswer(tag, firstAudioMs ?? undefined);
      if (!mounted.current || id !== generation.current) return;
      setSpeaking(false);
      setPaused(false);
      onEnd?.();
    };

    /** The browser engine: short utterances in order, generation-guarded against stale `onend`. */
    const speakWithBrowser = () => {
      if (!mounted.current || id !== generation.current) return;
      markEngine('browser');

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
        // The Windows-Chrome stuck bug: speak() resolves but nothing plays and no event ever
        // fires. One 600 ms check per chunk re-fires the utterance if it never started; the
        // generation and `done` guards make a retry the only path it can take.
        window.setTimeout(() => {
          if (!mounted.current || id !== generation.current || done) return;
          if (window.speechSynthesis.speaking || window.speechSynthesis.pending) return;
          try { window.speechSynthesis.cancel(); } catch { /* nothing queued */ }
          speakChunk(index);
        }, 600);
      };

      const start = () => speakChunk(0);
      // Chrome drops the FIRST utterance spoken in the same tick as a cancel. speak() always
      // cancels what played before, so the very first chunk of a fresh answer waits one gap out.
      if (Date.now() - lastCancelAt.current < CANCEL_GAP_MS) {
        window.setTimeout(start, CANCEL_GAP_MS + 60);
      } else {
        start();
      }
    };

    // Reached only when the learner explicitly chose the built-in voice: `engine: 'ai'` without a
    // server voice already failed above, so the AI flow can never land on this path.
    if (!cloudUsable) { speakWithBrowser(); return; }

    /**
     * The SERVER engine, played through Web Audio (Supertonic 3 or Google, whichever answered).
     *
     *  - PACKING: the server is sent whole sentences (`cloudChunks`), not one line at a time, so a
     *    600-character answer is 2 requests instead of 4 and the synthesiser places its own prosody
     *    across a paragraph.
     *  - PIPELINING: every request starts immediately, but playback begins as soon as the FIRST
     *    chunk is decoded. The old path waited for `Promise.all`, so the learner heard silence for
     *    as long as the slowest request took.
     *  - GAPLESS JOIN: decoded buffers are scheduled on one AudioContext clock with a short breath
     *    between them. An `<audio>` element reloading a new `src` per sentence is exactly the
     *    stutter this replaces.
     *  - PAUSE that really pauses: the AudioContext clock freezes, so already-scheduled sentences
     *    wait instead of playing on under a "Paused" label.
     *
     * A chunk that never arrives FAILS the answer: the audio that already played is released and the
     * learner gets an error with Retry. It is never finished by another engine — two voices in one
     * answer, the second one robotic, is precisely the behaviour this flow exists to avoid.
     */
    const AudioCtor = audioContextCtor();
    const cloud = cloudChunks(text);
    if (!AudioCtor || !cloud.length) {
      setError(VOICE_AUDIO_TEXT);
      setSpeaking(false);
      setPaused(false);
      return;
    }

    let context = contextRef.current;
    if (!context) {
      try {
        context = new AudioCtor();
        contextRef.current = context;
      } catch {
        setError(VOICE_AUDIO_TEXT);
        setSpeaking(false);
        setPaused(false);
        return;
      }
    }
    const graph = context;
    // A context created before any user gesture starts suspended; `speak()` is only ever reached
    // from a press, so resuming here is allowed — and harmless when it is already running.
    void graph.resume().catch(() => { /* the first `start()` reports it as an error */ });

    // Kept as the cancel token: `releaseCloud()` aborts it, and the loop below reads it exactly as
    // it did when a fetch was the thing being cancelled.
    const controller = new AbortController();
    cloudAbort.current = controller;
    const decode = async (chunk: string): Promise<AudioBuffer> => {
      // The model is asked for ONE sentence at a time, in the language the script decides. Devanagari
      // is Hindi and Latin is English; Romanised Hinglish falls back to the learner's own choice.
      const { lang } = languageForChunk(chunk, prefs.lang === 'hi-IN' ? 'hi' : 'en');
      const spoken = await client!.speak({
        text: chunk,
        lang,
        preset: prefs.preset,
        steps: VOICE_STEPS,
        speed: prefs.rate,
      });
      markEngine('supertonic');
      if (firstAudioMs === null) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        firstAudioMs = Math.round(now - answerStartedAt);
      }
      return graph.decodeAudioData(spoken.wav.slice(0));
    };

    // All requests in flight at once; only the ORDER of playback is sequential.
    const pending = cloud.map(decode);
    const GAP_SECONDS = 0.18;
    let playhead = 0;
    let next = 0;
    let failed = false;

    /**
     * The one terminal state for a server answer that could not be spoken. Idempotent (`failed`), and
     * it releases the graph so a half-scheduled answer cannot keep playing under an error message.
     */
    const failAnswer = () => {
      if (failed) return;
      failed = true;
      releaseCloud();
      if (!mounted.current || id !== generation.current) return;
      setError(VOICE_FAILED_TEXT);
      setSpeaking(false);
      setPaused(false);
    };

    const run = async () => {
      for (;;) {
        const index = next;
        if (index >= cloud.length) return;
        let buffer: AudioBuffer;
        try {
          buffer = await pending[index];
        } catch (cause) {
          if (!mounted.current || id !== generation.current || controller.signal.aborted) {
            // An aborted fetch is an intentional stop (Stop, pause, navigation). A watchdog abort of
            // a HANGING endpoint is a failure, and it says so rather than handing the answer over.
            if (mounted.current && id === generation.current && controller.signal.aborted) failAnswer();
            return;
          }
          noteVoiceFailure(String((cause as { message?: string })?.message ?? 'tts-failed').slice(0, 24));
          console.warn('BroCode voice: Supertonic 3 could not speak this chunk; the answer is not spoken.', cause);
          failAnswer();
          return;
        }
        if (!mounted.current || id !== generation.current) return;
        lastActivity.current = Date.now();
        if (engineRef.current !== 'cloud') markEngine('cloud');

        const source = graph.createBufferSource();
        source.buffer = buffer;
        source.connect(graph.destination);
        const startAt = Math.max(graph.currentTime + 0.05, playhead);
        playhead = startAt + buffer.duration + GAP_SECONDS;
        next = index + 1;
        activeSources.current.add(source);
        source.onended = () => {
          activeSources.current.delete(source);
          lastActivity.current = Date.now();
          if (!mounted.current || id !== generation.current) return;
          if (failed) return;
          if (index === cloud.length - 1) finish();
        };
        try { source.start(startAt); } catch { failAnswer(); return; }
      }
    };
    void run();
  }, [
    markEngine, prefs.engine, prefs.lang, prefs.pitch, prefs.rate, prefs.voiceName,
    releaseCloud, releaseUtterances, stopSpeaking, supported.synthesis,
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
    keepOpenRef.current = continuous;
    rearmCountRef.current = 0;
    micSessionRef.current += 1;
    const session = micSessionRef.current;
    if (micTimerRef.current) {
      // The previous press's cap (if it is still armed) must never close THIS press.
      window.clearTimeout(micTimerRef.current);
      micTimerRef.current = 0;
    }
    let alive = true;

    const arm = () => {
      if (!alive || !keepOpenRef.current) return;
      const instance = new Ctor();
      instance.lang = prefs.lang;
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
        if (mounted.current) setInterim(partial);
        if (final.trim()) {
          const text = final.trim();
          // Chrome can replay the same final result on a re-armed instance; a candidate never
          // repeats a sentence verbatim here, so a verbatim repeat is the engine, not the learner.
          if (text === lastFinalRef.current) return;
          lastFinalRef.current = text;
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
        const copy = recognitionErrorCopy(event.error);
        // The mic's failure must never reach the SPEAKER: voice mode stays exactly as the learner
        // left it, and the page shows the cause with the text fallback beside it.
        listeningRef.current = false;
        if (mounted.current) {
          if (copy) setError(copy);
          setListening(false);
          setInterim('');
        }
        recognition.current = null;
      };
      instance.onend = () => {
        recognition.current = null;
        if (!mounted.current || !alive) return;
        if (keepOpenRef.current) {
          // Chrome ends a continuous recognition after every pause. Re-arm it — a spoken answer
          // naturally stops mid-sentence, and one auto-end must not become "Answer by Voice
          // stopped working". The rearm cap keeps a dead mic from cycling forever.
          if (rearmCountRef.current < CONTINUOUS_REARMS) {
            rearmCountRef.current += 1;
            window.setTimeout(() => {
              if (!alive || !keepOpenRef.current || !mounted.current) return;
              try {
                arm();
                if (recognition.current) setListening(true);
              } catch (cause) {
                console.warn('BroCode voice: re-arming recognition failed', cause);
              }
            }, 360);
          } else {
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
      try {
        instance.start();
        listeningRef.current = true;
        setListening(true);
      } catch (cause) {
        // `start()` throws if a previous recognition is still finishing. That is not a learner error.
        console.warn('BroCode voice: speech recognition did not start', cause);
        setError('The microphone is still closing from the last try. Press the mic again.');
        recognition.current = null;
      }
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
   * The AudioContext clock and the synthesiser are separate switches, and the SERVER engine spends
   * its first moments in flight: `speak()` creates the graph and calls `resume()` before the first
   * chunk has been fetched. A pause pressed in that window used to fall through to
   * `speechSynthesis.pause()` — which pauses nothing — and set `paused: true`, so the label said
   * "Paused" while the answer started playing a second later. Suspending the graph holds the
   * pending audio instead, and if there is no graph yet there is genuinely nothing to pause, so the
   * button keeps saying "Pause" rather than lying.
   */
  const pauseSpeaking = useCallback(() => {
    const context = contextRef.current;
    const serverVoice = engineRef.current === 'cloud' || engineRef.current === 'supertonic';
    if (serverVoice) {
      if (!context) return; // nothing has been created yet: no audio is playing to pause
      // Suspending freezes `currentTime`, so sources already scheduled wait where they are and
      // chunks still in flight are queued silently instead of starting under a "Paused" label.
      void context.suspend().then(() => { if (mounted.current) setPaused(true); }).catch(() => { /* closed */ });
      return;
    }
    if (!supported.synthesis) return;
    // `speechSynthesis.pause()` on an engine that is not speaking is a silent no-op; saying
    // "Paused" after it is how the controls came to disagree with the sound.
    if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) return;
    try { window.speechSynthesis.pause(); setPaused(true); } catch { /* nothing to pause */ }
  }, [supported.synthesis]);

  const resumeSpeaking = useCallback(() => {
    const context = contextRef.current;
    const serverVoice = engineRef.current === 'cloud' || engineRef.current === 'supertonic';
    if (serverVoice) {
      if (!context || context.state === 'running') { setPaused(false); return; }
      void context.resume().then(() => { if (mounted.current) setPaused(false); }).catch(() => { /* closed */ });
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
   *    cancel and re-speak the unheard remainder, twice at most, then finish with an honest error;
   *  - the cloud chain hung in a fetch that never promised (no per-request timeout) — abort the
   *    fetch so the pipeline's own failure path hands the answer to the browser voice.
   *
   * It never touches the mic: while the learner is being recorded, the machines hold still —
   * turn-taking, not a race.
   */
  useEffect(() => {
    if (!speaking) return;
    const timer = window.setInterval(() => {
      if (!mounted.current) return;
      if (listeningRef.current) return; // recording owns the turn; no sound is expected
      if (Date.now() - lastActivity.current < (engineRef.current === 'cloud' ? 15000 : STALL_MS)) return;
      const context = contextRef.current;
      const pausedHere = context?.state === 'suspended' || (engineRef.current === 'browser' && window.speechSynthesis.paused);
      if (pausedHere) {
        // Paused playback is not a stall: hold the timestamp so the watchdog stays idle.
        lastActivity.current = Date.now();
        return;
      }
      if (engineRef.current === 'cloud') {
        if (activeSources.current.size > 0) {
          // Real audio is scheduled; a suspended-but-running graph has `pausedHere` above, so this
          // means scheduled audio with a dead clock — restart the clock rather than the queue.
          void contextRef.current?.resume().catch(() => { /* handed to the browser voice */ });
          lastActivity.current = Date.now();
          return;
        }
        // Nothing is playing: the fetches hung. Aborting makes `run()`'s catch hand off cleanly.
        lastActivity.current = Date.now();
        cloudAbort.current?.abort();
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
    voiceStatus,
    // Derived from the engine's own report, so every existing row keeps a truthful value without
    // each of them learning the new vocabulary.
    cloudConfigured: voiceStatus.phase === 'ready' || voiceStatus.phase === 'speaking' || voiceStatus.phase === 'initializing',
    serverVoice: {
      state: voiceStatus.phase === 'ready' || voiceStatus.phase === 'speaking'
        ? ('ready' as const)
        : voiceStatus.phase === 'error'
          ? ('unavailable' as const)
          : ('checking' as const),
      engine: voiceStatus.phase === 'error' && voiceStatus.code === 'unsupported' ? ('none' as const) : ('supertonic' as const),
    },
    refreshServerVoice,
    clearVoiceCache,
    setPreset: (preset: VoicePreset) => setPrefs((current) => ({ ...current, preset })),
    preset: prefs.preset,
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
