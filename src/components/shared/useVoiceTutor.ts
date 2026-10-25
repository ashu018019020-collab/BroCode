import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_RATE, DEFAULT_VOICE_LANG, clampRate, cloudChunks, normalizeVoiceLang, pickVoiceFrom,
  speechChunks, type VoiceLangId, type VoiceStatus,
} from '../../core/ai/voice';

/**
 * Speech in and speech out, as a hook.
 *
 * This is the only place in the app that touches `SpeechRecognition`, `speechSynthesis` and the
 * tutor's cloud voice. All three have sharp edges, and every one of them is handled here instead of
 * in the assistant's JSX:
 *
 *  - SPEECH OUT has two engines. The Google Neural2 voice wins when the server reports a key
 *    (`GET /api/voice/status`): each chunk is fetched as MP3 from `POST /api/voice/tts` — the Google
 *    key itself stays on the server — and played through one `Audio` element. ANY failure (no API
 *    server, no key, Google refusing, a static host answering HTML) falls back to the browser's own
 *    synthesiser for the same chunks and is REPORTED in the settings line; two consecutive cloud
 *    failures disable it for the session instead of stalling every answer behind a dead endpoint.
 *    A deployment without the key simply never leaves the browser voice.
 *  - Chrome stops one `speak()` call after ~15 s and sometimes drops the first utterance after a
 *    `cancel()`, so browser answers are queued as short chunks and every started utterance carries
 *    a generation id — a stale `onend` from a cancelled answer can never advance the new one.
 *  - Speech recognition is Chromium-only. The hook reports what the browser really has, so the UI can
 *    say "voice input is unavailable here" instead of showing a button that does nothing.
 *  - The mic is never left open: recognition is created per press, aborted on stop and on unmount,
 *    and starting to listen interrupts the tutor's own speech (barge-in).
 *
 * Preferences (language, speed, read-replies) are device preferences in `aiml:voice`, not learner
 * records: nothing here is uploaded, and no audio is recorded or stored — the transcript is the only
 * thing that leaves the microphone.
 */

const PREFS_KEY = 'aiml:voice';

/* The account API's two voice routes. Relative on purpose: the app is served from a subpath, and a
   static host without the API answers with its 404 page — which the cloud probe must read as
   "not configured", never as a broken tutor. */
const TTS_STATUS_PATH = './api/voice/status';
const TTS_SYNTHESIZE_PATH = './api/voice/tts';

/** "The account API answers, and its Google key is configured." Null until the probe resolves. */
type CloudState = boolean | null;

interface Prefs { lang: VoiceLangId; rate: number; speakReplies: boolean }

const DEFAULT_PREFS: Prefs = { lang: DEFAULT_VOICE_LANG, rate: DEFAULT_RATE, speakReplies: false };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs> | null;
    return {
      lang: normalizeVoiceLang(parsed?.lang),
      rate: clampRate(parsed?.rate),
      speakReplies: parsed?.speakReplies === true,
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

/**
 * The browser voice for this language — Google's own voices first when Chrome ships them, because
 * they are the most natural speech a browser offers with no server involved (see `pickVoiceFrom`).
 */
function pickBrowserVoice(lang: VoiceLangId): SpeechSynthesisVoice | null {
  const chosen = pickVoiceFrom(window.speechSynthesis.getVoices(), lang);
  if (!chosen) return null;
  // The ranking only read name/lang/localService; the utterance wants the real object.
  return window.speechSynthesis.getVoices().find((voice) => voice.name === chosen.name) ?? null;
}

export interface VoiceTutor {
  supported: { synthesis: boolean; recognition: boolean };
  lang: VoiceLangId;
  setLang: (lang: VoiceLangId) => void;
  rate: number;
  setRate: (rate: number) => void;
  speakReplies: boolean;
  setSpeakReplies: (on: boolean) => void;
  status: VoiceStatus;
  listening: boolean;
  speaking: boolean;
  paused: boolean;
  /** Which engine spoke last: the Google voice through the server, or the built-in browser voice. */
  engine: 'cloud' | 'browser' | null;
  /** What the SERVER reported about its Google key — null until the status probe answers. */
  cloudConfigured: CloudState;
  /** Live partial transcript while the learner is speaking. */
  interim: string;
  /** The last thing spoken, so "Replay" can repeat it without re-asking the engine. */
  lastSpoken: { text: string; sources: { title: string }[] } | null;
  error: string | null;
  dismissError: () => void;
  startListening: (onTranscript: (text: string) => void) => void;
  stopListening: () => void;
  toggleListening: (onTranscript: (text: string) => void) => void;
  /**
   * Speak an answer. `onEnd` runs only when the speech really finished — never after Stop, a
   * navigation, or a barge-in — which is what lets the mentor reopen the mic for a hands-free turn
   * without ever leaving a microphone open after an interruption.
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

  const recognition = useRef<RecognitionLike | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const queue = useRef<string[]>([]);

  // The cloud voice's own machinery. `context` is ONE Web Audio graph reused for the whole page —
  // creating an AudioContext per answer hits Chrome's per-page limit and costs the start-up latency
  // on every reply. `sources` are the chunks currently scheduled or playing; `abort` cancels
  // in-flight chunk fetches on Stop/unmount; `fails` counts consecutive cloud failures so a dead
  // endpoint is abandoned after the second instead of taxing every following answer with the same
  // timeout.
  const [cloudConfigured, setCloudConfigured] = useState<CloudState>(null);
  const [engine, setEngine] = useState<'cloud' | 'browser' | null>(null);
  const cloudRef = useRef<CloudState>(null);
  const cloudFails = useRef(0);
  const engineRef = useRef<'cloud' | 'browser' | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const activeSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const cloudAbort = useRef<AbortController | null>(null);

  /** One setter for the engine, so the ref the pause switch reads can never lag the state. */
  const markEngine = useCallback((next: 'cloud' | 'browser') => {
    engineRef.current = next;
    setEngine(next);
  }, []);

  const supported = useMemo(() => ({ synthesis: synthesisAvailable(), recognition: recognitionCtor() !== null }), []);

  // The one probe. It asks the account API whether a Google key is configured; every failure mode —
  // no server, a static host, a 503 — reads as "not configured", so the browser voice starts
  // immediately and the cloud voice is simply never attempted.
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3000);
    fetch(TTS_STATUS_PATH, { signal: controller.signal, cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!alive) return;
        const configured = payload?.configured === true;
        cloudRef.current = configured;
        setCloudConfigured(configured);
      })
      // No API server, a proxy error, a redirect to HTML — every failure reads as "not
      // configured", so the label settles on the truth instead of "Checking…" forever.
      .catch(() => {
        if (!alive) return;
        cloudRef.current = false;
        setCloudConfigured(false);
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      alive = false;
      controller.abort();
      window.clearTimeout(timer);
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

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      try { recognition.current?.abort(); } catch { /* already stopped */ }
      recognition.current = null;
      releaseCloud();
      const context = contextRef.current;
      contextRef.current = null;
      if (context) void context.close().catch(() => { /* already closed */ });
      if (synthesisAvailable()) window.speechSynthesis.cancel();
    };
  }, [releaseCloud]);

  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* quota or blocked */ }
  }, [prefs]);

  // Voices load asynchronously in Chrome; asking early returns [] and every language falls back to
  // the default voice. One listener warms the list up without a polling loop.
  useEffect(() => {
    if (!synthesisAvailable()) return;
    const warm = () => { window.speechSynthesis.getVoices(); };
    warm();
    window.speechSynthesis.addEventListener?.('voiceschanged', warm);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', warm);
  }, []);

  const stopSpeaking = useCallback(() => {
    generation.current += 1;
    queue.current = [];
    releaseCloud();
    if (synthesisAvailable()) {
      try { window.speechSynthesis.cancel(); } catch { /* nothing queued */ }
    }
    if (mounted.current) {
      setSpeaking(false);
      setPaused(false);
    }
  }, [releaseCloud]);

  const speak = useCallback((text: string, sources: { title: string }[] = [], onEnd?: () => void) => {
    const chunks = speechChunks(text);
    if (!chunks.length) return;
    const cloudUsable = cloudRef.current === true;
    if (!cloudUsable && !supported.synthesis) {
      setError(cloudRef.current === null
        ? 'This browser cannot speak text aloud, and the voice service has not answered yet.'
        : 'This browser cannot speak text aloud.');
      return;
    }
    stopSpeaking();
    const id = generation.current;
    queue.current = chunks;
    setLastSpoken({ text, sources });
    setError(null);
    setSpeaking(true);
    setPaused(false);

    /**
     * One completion per utterance queue. Stop/navigation increments the generation, so a stale
     * queue can never fire it; the latch covers the cloud path's two failure reports.
     */
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (!mounted.current || id !== generation.current) return;
      setSpeaking(false);
      setPaused(false);
      onEnd?.();
    };

    /** The browser engine: short utterances in order, generation-guarded against stale `onend`. */
    const speakWithBrowser = () => {
      if (!mounted.current || id !== generation.current) return;
      markEngine('browser');
      const next = () => {
        if (!mounted.current || id !== generation.current) return;
        const chunk = queue.current.shift();
        if (!chunk) {
          finish();
          return;
        }
        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.lang = prefs.lang;
        utterance.rate = prefs.rate;
        const voice = pickBrowserVoice(prefs.lang);
        if (voice) utterance.voice = voice;
        utterance.onend = next;
        utterance.onerror = next;
        try { window.speechSynthesis.speak(utterance); } catch { setSpeaking(false); }
      };
      next();
    };

    if (!cloudUsable) { speakWithBrowser(); return; }

    /**
     * The Google engine, played through Web Audio.
     *
     * This block is what "smooth" means in practice, and every decision here is about the gaps a
     * learner actually hears:
     *
     *  - PACKING: the server is sent whole sentences (`cloudChunks`), not one line at a time, so a
     *    600-character answer is 2 requests instead of 4 and the synthesiser places its own prosody
     *    across a paragraph.
     *  - PIPELINING: every request starts immediately, but playback begins as soon as the FIRST
     *    chunk is decoded. The old path waited for `Promise.all`, so the learner heard silence for
     *    as long as the slowest request took.
     *  - GApless JOIN: decoded buffers are scheduled on one AudioContext clock with a short breath
     *    between them. An `<audio>` element reloading a new `src` per sentence is exactly the
     *    stutter this replaces: there is no decoder re-init and no gap while the next file loads.
     *  - PAUSE that really pauses: the AudioContext clock freezes, so already-scheduled sentences
     *    wait instead of playing on under a "Paused" label.
     *
     * The browser voice remains the fallback for the WHOLE answer, and for any chunk that never
     * arrived — from that chunk onward, so a sentence is never skipped.
     */
    const AudioCtor = audioContextCtor();
    const cloud = cloudChunks(text);
    if (!AudioCtor || !cloud.length) { speakWithBrowser(); return; }

    let context = contextRef.current;
    if (!context) {
      try {
        context = new AudioCtor();
        contextRef.current = context;
      } catch {
        speakWithBrowser();
        return;
      }
    }
    const graph = context;
    // A context created before any user gesture starts suspended; `speak()` is only ever reached
    // from a press, so resuming here is allowed — and harmless when it is already running.
    void graph.resume().catch(() => { /* the first failure hands over to the browser voice */ });

    const controller = new AbortController();
    cloudAbort.current = controller;
    const decode = async (chunk: string): Promise<AudioBuffer> => {
      const response = await fetch(TTS_SYNTHESIZE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunk, lang: prefs.lang, rate: prefs.rate }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`tts-${response.status}`);
      // A static host answers HTML with a 200; audio is audio.
      const type = response.headers.get('content-type') ?? '';
      if (!type.startsWith('audio')) throw new Error('tts-not-audio');
      return graph.decodeAudioData(await response.arrayBuffer());
    };

    // All requests in flight at once; only the ORDER of playback is sequential.
    const pending = cloud.map(decode);
    const GAP_SECONDS = 0.18;
    let playhead = 0;
    let next = 0;
    let scheduled = 0;
    let handoff: { from: number } | null = null;
    let handedOff = false;

    const handOffToBrowser = (from: number) => {
      if (handedOff || !mounted.current || id !== generation.current) return;
      handedOff = true;
      // Everything before `from` was scheduled and has now finished; only the unheard remainder is
      // re-read, so no sentence is spoken twice and none is skipped.
      queue.current = speechChunks(cloud.slice(from).join(' '));
      releaseCloud();
      speakWithBrowser();
    };

    const run = async () => {
      for (;;) {
        const index = next;
        if (index >= cloud.length) return;
        let buffer: AudioBuffer;
        try {
          buffer = await pending[index];
        } catch (cause) {
          if (!mounted.current || id !== generation.current || controller.signal.aborted) return;
          cloudFails.current += 1;
          // Keep `cloudConfigured` as the SERVER's report — the server is configured, it is this
          // voice that is unavailable. The settings line says which engine spoke.
          if (cloudFails.current >= 2) cloudRef.current = false;
          console.warn('BroCode voice: Google voice failed, using the browser voice.', cause);
          if (scheduled === 0) { handOffToBrowser(0); return; }
          // Something is already playing: let it finish before the other engine starts, otherwise
          // two voices talk over each other.
          handoff = { from: index };
          // …but that audio may ALREADY have ended while this request was in flight, in which case no
          // `onended` is left to trigger the hand-off and the answer would simply stop mid-sentence.
          if (activeSources.current.size === 0) handOffToBrowser(index);
          return;
        }
        if (!mounted.current || id !== generation.current) return;
        cloudFails.current = 0;
        if (engineRef.current !== 'cloud') markEngine('cloud');

        const source = graph.createBufferSource();
        source.buffer = buffer;
        source.connect(graph.destination);
        const startAt = Math.max(graph.currentTime + 0.05, playhead);
        playhead = startAt + buffer.duration + GAP_SECONDS;
        next = index + 1;
        scheduled = next;
        activeSources.current.add(source);
        source.onended = () => {
          activeSources.current.delete(source);
          if (!mounted.current || id !== generation.current) return;
          const wasLastScheduled = index === scheduled - 1;
          if (handoff) {
            if (wasLastScheduled) handOffToBrowser(handoff.from);
            return;
          }
          if (index === cloud.length - 1) finish();
        };
        try { source.start(startAt); } catch { handOffToBrowser(index); return; }
      }
    };
    void run();
  }, [markEngine, prefs.lang, prefs.rate, releaseCloud, stopSpeaking, supported.synthesis]);

  const replay = useCallback(() => {
    if (lastSpoken) speak(lastSpoken.text, lastSpoken.sources);
  }, [lastSpoken, speak]);

  const stopListening = useCallback(() => {
    try { recognition.current?.abort(); } catch { /* already gone */ }
    recognition.current = null;
    if (mounted.current) {
      setListening(false);
      setInterim('');
    }
  }, []);

  const startListening = useCallback((onTranscript: (text: string) => void) => {
    const Ctor = recognitionCtor();
    if (!Ctor) { setError('This browser has no speech recognition. Type your question instead.'); return; }
    // Barge-in: the learner talking is always the higher priority than the tutor talking.
    stopSpeaking();
    stopListening();
    setError(null);
    setInterim('');
    const instance = new Ctor();
    instance.lang = prefs.lang;
    instance.continuous = false;
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
        setListening(false);
        setInterim('');
        try { instance.stop(); } catch { /* already ended */ }
        onTranscript(text);
      }
    };
    instance.onerror = (event) => {
      const copy = recognitionErrorCopy(event.error);
      if (mounted.current) {
        setListening(false);
        setInterim('');
        if (copy) setError(copy);
      }
      recognition.current = null;
    };
    instance.onend = () => {
      if (mounted.current) {
        setListening(false);
        setInterim('');
      }
      recognition.current = null;
    };
    recognition.current = instance;
    try {
      instance.start();
      setListening(true);
    } catch (cause) {
      // `start()` throws if a previous recognition is still finishing. That is not a learner error.
      console.warn('BroCode voice: speech recognition did not start', cause);
      setError('The microphone is still closing from the last try. Press the mic again.');
      recognition.current = null;
    }
  }, [prefs.lang, stopListening, stopSpeaking]);

  const toggleListening = useCallback((onTranscript: (text: string) => void) => {
    if (listening) stopListening();
    else startListening(onTranscript);
  }, [listening, startListening, stopListening]);

  const pauseSpeaking = useCallback(() => {
    // The AudioContext clock and the synthesiser are separate pause switches; only one is live.
    const context = contextRef.current;
    if (engineRef.current === 'cloud' && context && context.state === 'running') {
      // Suspending freezes `currentTime`, so the sentences already scheduled wait where they are
      // instead of finishing under a "Paused" label.
      void context.suspend().then(() => { if (mounted.current) setPaused(true); }).catch(() => { /* not speaking */ });
      return;
    }
    if (!supported.synthesis) return;
    try { window.speechSynthesis.pause(); setPaused(true); } catch { /* not speaking */ }
  }, [supported.synthesis]);

  const resumeSpeaking = useCallback(() => {
    const context = contextRef.current;
    if (engineRef.current === 'cloud' && context && context.state === 'suspended') {
      void context.resume().then(() => { if (mounted.current) setPaused(false); }).catch(() => { /* closed */ });
      return;
    }
    if (!supported.synthesis) return;
    try { window.speechSynthesis.resume(); setPaused(false); } catch { /* nothing paused */ }
  }, [supported.synthesis]);

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
    speakReplies: prefs.speakReplies,
    setSpeakReplies: (on) => setPrefs((current) => ({ ...current, speakReplies: on })),
    status,
    listening,
    speaking,
    paused,
    engine,
    cloudConfigured,
    interim,
    lastSpoken,
    error,
    dismissError: () => setError(null),
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
