import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_RATE, DEFAULT_VOICE_LANG, clampRate, cloudChunks, micPermissionDenied, normalizeVoiceLang,
  type VoiceLangId, type VoiceStatus,
} from '../../core/ai/voice';
import { noteVoiceAnswer, noteVoiceFailure } from '../../core/storage/voice-telemetry';
import { DEFAULT_PRESET, availablePresets, isVoicePreset, resolvePreset, type VoicePreset } from '../../core/voice/presets';
import { languageForChunk } from '../../core/voice/text';
import { createServerVoice, VoiceFailure, type ServerVoice, type ServerVoiceStatus } from '../../core/voice/server';
import { deriveVoiceStatus, type PlaybackState } from '../../core/voice/state';
import type { VoiceStatus as EngineStatus } from '../../core/voice/protocol';

/**
 * Speech in and speech out, as a hook.
 *
 * SPEECH OUT is Supertonic 3 running on the BroCode server. This hook posts the answer's sentences to
 * `POST /api/voice/tts` and plays the WAV that comes back. There is no model in the page, no worker,
 * no ONNX Runtime and no download: the 398 MB checkpoint is loaded once by the inference service, and
 * the browser's whole job is a few hundred kilobytes of audio per sentence.
 *
 * That is the fix for the symptom this file used to have. The engine used to run in a module worker,
 * so "Preparing Supertonic 3…" was the tab downloading four ONNX graphs and building four sessions —
 * a state that never resolved on a phone, on a metered connection, or wherever the runtime's WASM
 * could not be fetched. Now `voiceStatus` describes a conversation with a service that is already
 * warm, and the only unavoidable waits are the first connection and the synthesis of the sentence
 * being spoken.
 *
 * THE FOUR CONTROLS, and what makes them real:
 *
 *  - SPEAK posts the answer and plays it. A second press supersedes the first (the generation counter
 *    rejects the older promise), so double-clicking cannot produce two voices.
 *  - PAUSE suspends the `AudioContext`. That freezes the clock, so already-scheduled sentences wait
 *    instead of playing on under a "Paused" label — and it never re-requests anything.
 *  - REPLAY re-plays the decoded buffers of the last answer when they are still in memory, and only
 *    re-requests when they are not. "Replay" that re-synthesises is just a slow Speak.
 *  - MUTE sets one master gain to 0. It is instant, works mid-sentence, and is not a volume slider
 *    pretending to be a mute.
 *
 * FAILURE IS A STATE, WITH THE CAUSE IN IT. `VoiceFailure` carries the route's own code, so the panel
 * can say "this deployment has no voice configured" (no Retry — pressing it can never help) apart from
 * "the AI voice is temporarily unavailable" (Retry). It never falls back to a robotic voice: an answer
 * that cannot be spoken is not spoken, and the learner is told why.
 *
 * SPEECH IN is unchanged: Chromium's `SpeechRecognition`, created per press, aborted on stop/unmount,
 * and it interrupts the tutor (barge-in: the learner talking outranks the AI talking). The mic and the
 * speaker are separate — a recognition error never stops the voice, and a voice error never closes the
 * mic.
 */

const PREFS_KEY = 'aiml:voice';

interface Prefs {
  lang: VoiceLangId;
  /** `F1`…`M5`, stored per device. Validated against what the backend reports before it is sent. */
  preset: VoicePreset;
  rate: number;
  speakReplies: boolean;
}

const DEFAULT_PREFS: Prefs = {
  lang: DEFAULT_VOICE_LANG, preset: DEFAULT_PRESET, rate: DEFAULT_RATE, speakReplies: false,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs> | null;
    return {
      lang: normalizeVoiceLang(parsed?.lang),
      preset: isVoicePreset(parsed?.preset) ? parsed.preset : DEFAULT_PRESET,
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

/** Web Audio is what plays the server's audio. No graph, no voice — and the panel says so. */
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

/** A continuous (interview) listening press is capped, in case a learner walks away. */
const CONTINUOUS_MAX_MS = 120_000;
/** Chrome auto-ends a continuous recognition; it is re-armed at most this many times per press. */
const CONTINUOUS_REARMS = 8;
/** A watchdog only fires when a speech answer has produced no audio for this long. */
const STALL_MS = 20_000;
/** How long "Finished" stays on screen before the panel returns to "Ready". */
const COMPLETED_LINGER_MS = 2600;
/** A breath between sentences, so a paragraph does not run into itself. */
const GAP_SECONDS = 0.16;

export interface ListenOptions {
  /**
   * Keep the microphone open across sentence pauses and re-arm it when the engine auto-ends —
   * what a spoken ANSWER needs. Default (the assistant's press) captures one utterance.
   */
  continuous?: boolean;
  /** Hard cap for a continuous capture, in ms. Defaults to CONTINUOUS_MAX_MS. */
  maxMs?: number;
}

export interface ServerVoiceView {
  state: 'checking' | 'ready' | 'unavailable';
  engine: 'supertonic' | 'google' | 'none' | null;
  /** The presets the backend really offers, or the full known list before it has answered. */
  presets: readonly VoicePreset[];
}

export interface VoiceTutor {
  supported: { synthesis: boolean; recognition: boolean };
  lang: VoiceLangId;
  setLang: (lang: VoiceLangId) => void;
  rate: number;
  setRate: (rate: number) => void;
  /** Which Supertonic voice preset is selected — sent with every request. */
  preset: VoicePreset;
  setPreset: (preset: VoicePreset) => void;
  /** The presets that exist on this deployment, for the selector. */
  presets: readonly VoicePreset[];
  speakReplies: boolean;
  setSpeakReplies: (on: boolean) => void;
  status: VoiceStatus;
  listening: boolean;
  speaking: boolean;
  paused: boolean;
  /** Audio is silenced at the master gain — instant, and reversible mid-sentence. */
  muted: boolean;
  setMuted: (on: boolean) => void;
  /** Which backend engine actually produced the last audio. Never a guess. */
  engine: 'supertonic' | 'cloud' | null;
  /** The derived phase: idle / connecting / preparing / generating / speaking / paused / completed / disconnected / error. */
  voiceStatus: EngineStatus;
  /** The same facts in the shape the older rows read (`checking`/`ready`/`unavailable`). */
  serverVoice: ServerVoiceView;
  /** Re-ask the deployment whether a voice exists. This is what Retry does. */
  refreshServerVoice: () => void;
  /** Warm the connection before the first answer (turning the voice on, opening the mic). */
  preloadVoice: () => void;
  /** True while the deployment reports a usable voice. */
  cloudConfigured: boolean;
  /** The live partial transcript while the learner is speaking. */
  interim: string;
  /** The last thing spoken, so Replay can repeat it. */
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
  /** Say the last answer again, from memory when possible. A no-op when nothing has been spoken. */
  replay: () => void;
  stopSpeaking: () => void;
  pauseSpeaking: () => void;
  resumeSpeaking: () => void;
}

export function useVoiceTutor(thinking = false): VoiceTutor {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastSpoken, setLastSpoken] = useState<{ text: string; sources: { title: string }[] } | null>(null);
  const [muted, setMutedState] = useState(false);
  const [playback, setPlayback] = useState<PlaybackState>('idle');
  const [server, setServer] = useState<ServerVoiceStatus | null>(null);
  const [failure, setFailure] = useState<VoiceFailure | null>(null);
  const [engine, setEngine] = useState<'supertonic' | 'cloud' | null>(null);

  const mounted = useRef(true);
  const recognition = useRef<RecognitionLike | null>(null);
  /** Bumped on every intentional stop, so a stale answer can never schedule another word. */
  const generation = useRef(0);
  const mutedRef = useRef(false);
  const serverRef = useRef<ServerVoiceStatus | null>(null);
  const voiceRef = useRef<ServerVoice | null>(null);

  const contextRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const activeSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const lastActivity = useRef(0);
  /** Decoded buffers of the last answer, for Replay. Cleared when a different answer is spoken. */
  const buffersRef = useRef<AudioBuffer[]>([]);
  const answerRef = useRef<{ text: string; sources: { title: string }[] } | null>(null);
  const completeRef = useRef(false);
  const lingerTimer = useRef(0);

  // Listening machinery that the event handlers must read without stale closures.
  const listeningRef = useRef(false);
  const keepOpenRef = useRef(false);
  const rearmCountRef = useRef(0);
  const lastFinalRef = useRef('');
  /** Which mic PRESS owns the lifetime timer — a stale timer must never close a newer press. */
  const micSessionRef = useRef(0);
  const micTimerRef = useRef(0);

  const supported = useMemo(
    () => ({ synthesis: audioContextCtor() !== null, recognition: recognitionCtor() !== null }),
    [],
  );

  /** One client for the page's lifetime — it holds no model and no secret, just two URLs. */
  if (!voiceRef.current && typeof window !== 'undefined') voiceRef.current = createServerVoice();

  const applyMuted = useCallback((on: boolean) => {
    mutedRef.current = on;
    if (mounted.current) setMutedState(on);
    const gain = gainRef.current;
    if (gain) {
      // A short ramp instead of a jump: a hard cut on a spoken word clicks.
      const now = gain.context.currentTime;
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(on ? 0 : 1, now, 0.02);
      } catch {
        gain.gain.value = on ? 0 : 1;
      }
    }
  }, []);

  const setMuted = useCallback((on: boolean) => applyMuted(on), [applyMuted]);

  /* ------------------------------- the graph -------------------------------- */

  /** One AudioContext for the page: a context per answer hits Chrome's per-page limit. */
  const ensureGraph = useCallback((): AudioContext | null => {
    if (contextRef.current) return contextRef.current;
    const Ctor = audioContextCtor();
    if (!Ctor) return null;
    try {
      const context = new Ctor();
      const gain = context.createGain();
      gain.gain.value = mutedRef.current ? 0 : 1;
      gain.connect(context.destination);
      gainRef.current = gain;
      contextRef.current = context;
      return context;
    } catch {
      return null;
    }
  }, []);

  /** Stop everything that is audible and cancel every fetch. Never closes the context. */
  const releaseAudio = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    for (const source of activeSources.current) {
      // `onended` is cleared FIRST: a Stop must never be read as "this sentence finished", which
      // would advance the queue or fire the answer's completion callback.
      source.onended = null;
      try { source.stop(); } catch { /* not started, or already ended */ }
      try { source.disconnect(); } catch { /* already disconnected */ }
    }
    activeSources.current.clear();
  }, []);

  const stopSpeaking = useCallback(() => {
    generation.current += 1;
    releaseAudio();
    buffersRef.current = [];
    completeRef.current = false;
    if (lingerTimer.current) {
      window.clearTimeout(lingerTimer.current);
      lingerTimer.current = 0;
    }
    if (mounted.current) {
      setPlayback('idle');
    }
  }, [releaseAudio]);

  /* ------------------------------- the server ------------------------------- */

  /**
   * Ask the deployment whether it has a voice.
   *
   * This is the ONLY thing that moves the panel out of `connecting`, and it is a real HTTP call, not
   * a timer: a deployment with no `TTS_SERVICE_URL` answers `engine: none`, and that is a state the
   * learner sees instead of an endless "Loading…".
   */
  const probe = useCallback(async () => {
    const client = voiceRef.current;
    if (!client) return;
    try {
      const next = await client.status();
      if (!mounted.current) return;
      serverRef.current = next;
      setServer(next);
      if (next.ready) setFailure(null);
      else if (!next.configured) {
        setFailure(new VoiceFailure('voice-unconfigured', next.reason ?? 'No AI voice is configured on this deployment.', { retryable: false }));
      }
    } catch (cause) {
      if (!mounted.current) return;
      const reason = cause instanceof VoiceFailure ? cause : new VoiceFailure('voice-offline', 'The AI voice could not be reached.', { retryable: true });
      serverRef.current = { configured: false, ready: false, engine: 'none', engineLabel: 'no server voice', reason: reason.message, voices: [] };
      setServer(serverRef.current);
      setFailure(reason);
    }
  }, []);

  const refreshServerVoice = useCallback(() => {
    setError(null);
    setFailure(null);
    void probe();
  }, [probe]);

  const preloadVoice = useCallback(() => {
    // Warming is a status probe: the model is already loaded on the server, so there is nothing to
    // download. It exists so the first Speak does not pay for a cold connection.
    void probe();
    // A context created inside a user gesture is the one that will be allowed to play later.
    ensureGraph();
  }, [ensureGraph, probe]);

  useEffect(() => {
    void probe();
  }, [probe]);

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

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      try { recognition.current?.abort(); } catch { /* already stopped */ }
      recognition.current = null;
      releaseAudio();
      if (micTimerRef.current) window.clearTimeout(micTimerRef.current);
      if (lingerTimer.current) window.clearTimeout(lingerTimer.current);
      const context = contextRef.current;
      contextRef.current = null;
      gainRef.current = null;
      if (context) void context.close().catch(() => { /* already closed */ });
    };
  }, [releaseAudio]);

  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* quota or blocked */ }
  }, [prefs]);

  /** A completed answer returns to idle after a beat, so the panel is not stuck on "Finished". */
  const markCompleted = useCallback(() => {
    if (!mounted.current) return;
    setPlayback('completed');
    if (lingerTimer.current) window.clearTimeout(lingerTimer.current);
    lingerTimer.current = window.setTimeout(() => {
      if (!mounted.current) return;
      setPlayback((current) => (current === 'completed' ? 'idle' : current));
    }, COMPLETED_LINGER_MS);
  }, []);

  /**
   * Play a list of decoded buffers on one clock.
   *
   * `cached` is the Replay path: same buffers, no request. Otherwise the caller has already started
   * the fetches and this awaits them IN ORDER — playback begins on the first sentence while the rest
   * are still arriving, which is what makes a long answer feel immediate.
   */
  const playBuffers = useCallback(async (
    id: number,
    pending: Promise<AudioBuffer>[],
    onEnd: (() => void) | undefined,
    startedAt: number,
  ) => {
    const graph = ensureGraph();
    if (!graph) {
      setError('This browser cannot play audio (Web Audio is unavailable), so the answer is not spoken.');
      setPlayback('idle');
      return;
    }
    void graph.resume().catch(() => { /* the first start() reports a real failure */ });

    const destination = gainRef.current ?? graph.destination;
    let playhead = 0;
    let heard = 0;
    let firstAudioMs: number | null = null;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      completeRef.current = true;
      if (firstAudioMs !== null) noteVoiceAnswer('supertonic', firstAudioMs);
      else noteVoiceAnswer('supertonic');
      if (!mounted.current || id !== generation.current) return;
      markCompleted();
      onEnd?.();
    };

    for (let index = 0; index < pending.length; index += 1) {
      let buffer: AudioBuffer;
      try {
        buffer = await pending[index];
      } catch (cause) {
        if (!mounted.current || id !== generation.current) return;
        const reason = cause instanceof VoiceFailure ? cause : new VoiceFailure('voice-unavailable', 'The AI voice could not answer that.', { retryable: true });
        noteVoiceFailure(reason.code.slice(0, 24));
        setFailure(reason);
        setError(reason.message);
        setPlayback('idle');
        return;
      }
      if (!mounted.current || id !== generation.current) return;

      buffersRef.current[index] = buffer;
      lastActivity.current = Date.now();

      if (firstAudioMs === null) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        firstAudioMs = Math.round(now - startedAt);
        // Audio is about to exist: only now is "Speaking" true.
        setPlayback('speaking');
      }

      const source = graph.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);
      const startAt = Math.max(graph.currentTime + 0.04, playhead);
      playhead = startAt + buffer.duration + GAP_SECONDS;
      activeSources.current.add(source);
      const isLast = index === pending.length - 1;
      source.onended = () => {
        activeSources.current.delete(source);
        heard += 1;
        lastActivity.current = Date.now();
        if (!mounted.current || id !== generation.current) return;
        if (isLast && heard >= pending.length) finish();
      };
      try {
        source.start(startAt);
      } catch {
        activeSources.current.delete(source);
        setError('This browser could not start audio playback. Press Speak again.');
        setPlayback('idle');
        return;
      }
    }
    // A zero-length answer never fires `onended`; close it out here instead of waiting for a watchdog.
    if (pending.length === 0) finish();
  }, [ensureGraph, markCompleted]);

  /**
   * Speak one answer through the server.
   *
   * `cached` is used by Replay. Everything else re-requests, because the text may have changed.
   */
  const runAnswer = useCallback((
    text: string,
    sources: { title: string }[],
    onEnd: (() => void) | undefined,
    cached?: AudioBuffer[],
  ) => {
    const chunks = cloudChunks(text);
    if (!chunks.length) return;

    generation.current += 1;
    const id = generation.current;
    releaseAudio();
    if (lingerTimer.current) {
      window.clearTimeout(lingerTimer.current);
      lingerTimer.current = 0;
    }

    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    answerRef.current = { text, sources };
    buffersRef.current = cached ? [...cached] : [];
    completeRef.current = false;
    setLastSpoken({ text, sources });
    setError(null);
    setFailure(null);
    setPlayback('generating');
    lastActivity.current = Date.now();

    if (cached?.length) {
      void playBuffers(id, cached.map((buffer) => Promise.resolve(buffer)), onEnd, startedAt);
      return;
    }

    const client = voiceRef.current;
    if (!client) {
      const reason = new VoiceFailure('voice-offline', 'The AI voice could not be reached from this page.', { retryable: true });
      setFailure(reason);
      setError(reason.message);
      setPlayback('idle');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const chosen = prefs.lang === 'hi-IN' ? 'hi' : 'en';
    const preset = resolvePreset(prefs.preset, serverRef.current?.voices);

    // Every request starts immediately; only the ORDER of playback is sequential. A 600-character
    // answer is two requests, not four, so the synthesiser keeps its own prosody across a paragraph.
    const pending = chunks.map(async (chunk) => {
      const { lang } = languageForChunk(chunk, chosen);
      const spoken = await client.speak({
        text: chunk,
        lang: lang === 'hi' ? 'hi-IN' : 'en-IN',
        rate: prefs.rate,
        voice: preset,
        signal: controller.signal,
      });
      const graph = ensureGraph();
      if (!graph) throw new VoiceFailure('voice-invalid-audio', 'This browser cannot play audio.', { retryable: false });
      setEngine(spoken.engine === 'google' ? 'cloud' : 'supertonic');
      return graph.decodeAudioData(spoken.wav.slice(0));
    });

    void playBuffers(id, pending, onEnd, startedAt);
  }, [ensureGraph, playBuffers, prefs.lang, prefs.preset, prefs.rate, releaseAudio]);

  const speak = useCallback((text: string, sources: { title: string }[] = [], onEnd?: () => void) => {
    const clean = String(text ?? '').trim();
    if (!clean) return;
    // Replay from memory only when it is the SAME answer AND every sentence was decoded.
    const same = answerRef.current?.text === clean;
    const cached = same && completeRef.current && buffersRef.current.length > 0 && buffersRef.current.every(Boolean)
      ? buffersRef.current
      : undefined;
    runAnswer(clean, sources, onEnd, cached);
  }, [runAnswer]);

  const replay = useCallback(() => {
    if (!lastSpoken) return;
    // Pass the SAME text so `speak` can reuse the decoded buffers instead of re-asking the server.
    speak(lastSpoken.text, lastSpoken.sources);
  }, [lastSpoken, speak]);

  const pauseSpeaking = useCallback(() => {
    const context = contextRef.current;
    if (!context || context.state !== 'running') return; // nothing is playing: never claim a pause
    void context.suspend().then(() => {
      if (mounted.current) setPlayback('paused');
    }).catch(() => { /* closed by navigation */ });
  }, []);

  const resumeSpeaking = useCallback(() => {
    const context = contextRef.current;
    if (!context || context.state === 'running') {
      if (mounted.current) setPlayback((current) => (current === 'paused' ? 'speaking' : current));
      return;
    }
    void context.resume().then(() => {
      if (mounted.current) setPlayback((current) => (current === 'paused' ? 'speaking' : current));
    }).catch(() => { /* closed by navigation */ });
  }, []);

  /**
   * The watchdog. Runs only while a spoken answer believes itself active, and repairs exactly the
   * stall no event can report: requests that never resolved and audio that never started. It aborts
   * the fetches, which lands in `playBuffers`' catch with a real message — never a silent hang and
   * never a second engine.
   */
  useEffect(() => {
    if (playback !== 'generating' && playback !== 'speaking') return;
    const timer = window.setInterval(() => {
      if (!mounted.current) return;
      if (listeningRef.current) return; // recording owns the turn; no sound is expected
      const context = contextRef.current;
      if (context?.state === 'suspended') {
        // Paused playback is not a stall: hold the timestamp so the watchdog stays idle.
        lastActivity.current = Date.now();
        return;
      }
      if (Date.now() - lastActivity.current < STALL_MS) return;
      lastActivity.current = Date.now();
      abortRef.current?.abort();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [playback]);

  /* ------------------------------ the microphone ----------------------------- */

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

  /* -------------------------------- the view -------------------------------- */

  const voiceStatus = deriveVoiceStatus({ server, failure, playback });
  const speaking = playback === 'speaking' || playback === 'paused' || playback === 'generating';
  const paused = playback === 'paused';
  const presets = useMemo(() => availablePresets(server?.voices), [server]);

  // Keep the chosen voice valid for this deployment: a stored `F4` on a checkpoint that only ships
  // F1–F3 would otherwise be a 400 on every press.
  useEffect(() => {
    if (!server?.voices.length) return;
    setPrefs((current) => {
      const next = resolvePreset(current.preset, server.voices);
      return next === current.preset ? current : { ...current, preset: next };
    });
  }, [server]);

  // An error is a real state, not a hidden flag: a dead microphone must stop the controls looking
  // as if everything is idle.
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
    preset: prefs.preset,
    setPreset: (preset) => setPrefs((current) => ({ ...current, preset })),
    presets,
    speakReplies: prefs.speakReplies,
    setSpeakReplies: (on) => setPrefs((current) => ({ ...current, speakReplies: on })),
    status,
    listening,
    speaking,
    paused,
    muted,
    setMuted,
    engine,
    voiceStatus,
    serverVoice: {
      state: server?.ready ? 'ready' : server ? 'unavailable' : 'checking',
      engine: server?.engine ?? null,
      presets,
    },
    cloudConfigured: server?.ready === true,
    refreshServerVoice,
    preloadVoice,
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
