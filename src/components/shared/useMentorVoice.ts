import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createVoiceClient, type VoiceClient, type VoiceStatus } from '../../core/voice/client';
import type { VoicePreset } from '../../core/voice/assets';
import { DEFAULT_PRESET, VOICE_PRESETS } from '../../core/voice/assets';
import {
  mentorVoiceState, speechLanguage, speechSegments, speechText,
  type MentorVoicePhase, type MentorVoiceState, type SpeechLocale, type SpeechPreference,
} from '../../core/voice/mentor-voice';
import { clampRate, recognitionLanguages } from '../../core/ai/voice';

/**
 * The one Supertonic 3 voice, shared by every AI Mentor surface.
 *
 * This hook is the only place the mentor talks to the worker, the <audio> graph and the microphone.
 * Components receive facts and verbs; they never create a worker, decode PCM or reopen a mic
 * themselves, which is what keeps two panels from starting two 379 MB model loads.
 *
 * The rules it enforces:
 *
 *  · ONE CLIENT PER PAGE. The worker (and its ONNX sessions) live in a module singleton, so opening a
 *    tab or remounting the studio reuses the loaded model instead of re-downloading it.
 *  · SPEAKING MEANS PLAYING. State flips to `speaking` when an AudioBufferSourceNode actually starts,
 *    and `completed` when the last sentence's `ended` fires — never when a request was merely sent.
 *  · SENTENCES, IN ORDER, ONE AT A TIME. Synthesis per sentence, playback strictly sequential, a short
 *    gap between sentences for a natural pause. Nothing overlaps, and no sentence is spoken twice.
 *  · INTERRUPT IS TOTAL. Cancel the worker generation, stop the node, drop the queue, bump the run id.
 *    A late buffer cannot revive, and `onEnd` never fires after an interruption.
 *  · NO DEVICE-VOICE FALLBACK. If the model cannot load the learner is told, and can retry. Silently
 *    switching to the browser's robot voice is the failure this hook exists to prevent.
 */

let sharedClient: VoiceClient | null | undefined;

function client(): VoiceClient | null {
  if (sharedClient !== undefined) return sharedClient;
  sharedClient = createVoiceClient();
  return sharedClient;
}

/** A silent `VoiceStatus` for a host without module workers. */
const UNAVAILABLE: VoiceStatus = {
  phase: 'error',
  progress: 0,
  message: 'This browser cannot run the voice engine',
  code: 'no-worker',
  detail: 'Module workers are unavailable here, so Supertonic 3 cannot start.',
};

export interface MentorVoiceOptions {
  /** URL search of the page, used to decide the default language of the interface copy. */
  lang?: SpeechPreference;
}

export interface MentorVoice {
  /** The raw engine phase, as the worker reported it. */
  phase: MentorVoicePhase;
  /** The one announced state, derived from real signals. */
  state: MentorVoiceState;
  progress: number;
  receivedBytes: number;
  totalBytes: number;
  totalLabel: string;
  file: string;
  detail: string;
  error: string | null;
  supported: boolean;
  listening: boolean;
  speaking: boolean;
  paused: boolean;
  /** The worker is producing audio for the next sentence (synthesis, not playback). */
  generating: boolean;
  muted: boolean;
  autoSpeak: boolean;
  handsFree: boolean;
  preset: VoicePreset;
  speed: number;
  langPref: SpeechPreference;
  locale: SpeechLocale;
  lastSpoken: string;
  interim: string;
  /** Live output amplitude, 0…1, read by the orb's animation loop (not React state). */
  levelRef: { current: number };
  /** Live microphone amplitude, 0…1. */
  micLevelRef: { current: number };
  setPreset: (preset: VoicePreset) => void;
  setSpeed: (speed: number) => void;
  setLangPref: (pref: SpeechPreference) => void;
  setAutoSpeak: (on: boolean) => void;
  setHandsFree: (on: boolean) => void;
  setMuted: (on: boolean) => void;
  /** Download and open the model now (the first Speak also does this). */
  prepare: () => void;
  /** Speak the FINAL assistant text. `onEnd` runs only after real completion. */
  speak: (text: string, onEnd?: () => void) => void;
  pause: () => void;
  resume: () => void;
  replay: () => void;
  interrupt: () => void;
  startListening: (onTranscript: (text: string) => void) => void;
  stopListening: () => void;
  toggleListening: (onTranscript: (text: string) => void) => void;
  clearCache: () => Promise<void>;
  dismissError: () => void;
}

const PRESET_KEY = 'aiml:mentor-voice';

interface StoredPrefs {
  preset: VoicePreset;
  speed: number;
  lang: SpeechPreference;
  autoSpeak: boolean;
  handsFree: boolean;
}

function loadPrefs(): StoredPrefs {
  const fallback: StoredPrefs = { preset: DEFAULT_PRESET, speed: 1, lang: 'auto', autoSpeak: true, handsFree: false };
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredPrefs> | null;
    return {
      preset: (VOICE_PRESETS as readonly string[]).includes(String(parsed?.preset))
        ? (parsed?.preset as VoicePreset)
        : fallback.preset,
      speed: clampRate(parsed?.speed ?? 1),
      lang: parsed?.lang === 'hi' || parsed?.lang === 'en' ? parsed.lang : 'auto',
      autoSpeak: parsed?.autoSpeak !== false,
      handsFree: parsed?.handsFree === true,
    };
  } catch {
    return fallback;
  }
}

/* ------------------------------ recognition ------------------------------ */
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

function bytesLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / 1_048_576;
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/** How long to hold the queue between sentences — a breath, not a gap. */
const SENTENCE_GAP_MS = 120;

export function useMentorVoice(): MentorVoice {
  const prefs = useMemo(() => loadPrefs(), []);
  const [phase, setPhase] = useState<MentorVoicePhase>('idle');
  const [progress, setProgress] = useState(0);
  const [receivedBytes, setReceivedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [file, setFile] = useState('');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [autoSpeak, setAutoSpeakState] = useState(prefs.autoSpeak);
  const [handsFree, setHandsFreeState] = useState(prefs.handsFree);
  const [preset, setPresetState] = useState<VoicePreset>(prefs.preset);
  const [speed, setSpeedState] = useState(prefs.speed);
  const [langPref, setLangPrefState] = useState<SpeechPreference>(prefs.lang);
  const [lastSpoken, setLastSpoken] = useState('');
  const [interim, setInterim] = useState('');

  const levelRef = useRef(0);
  const micLevelRef = useRef(0);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const micAnalyser = useRef<AnalyserNode | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const buffer = useRef<AudioBuffer | null>(null);
  const offset = useRef(0);
  const startedAt = useRef(0);
  const runId = useRef(0);
  const queue = useRef<string[]>([]);
  const index = useRef(0);
  const pausedFlag = useRef(false);
  const speakingFlag = useRef(false);
  const onEndRef = useRef<(() => void) | null>(null);
  /** Filled in after `speakNext` is defined; the ended-callback reads it later, never during render. */
  const speakNextRef = useRef<(id: number) => void>(() => undefined);
  const mounted = useRef(true);
  const recognition = useRef<RecognitionLike | null>(null);
  const recognitionWanted = useRef(false);
  const recognitionLang = useRef(0);
  const micTimer = useRef(0);

  const supported = useMemo(() => recognitionCtor() !== null, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runId.current += 1;
      recognitionWanted.current = false;
      try { recognition.current?.abort(); } catch { /* gone */ }
      try { source.current?.stop(); } catch { /* not started */ }
      micStream.current?.getTracks().forEach((track) => track.stop());
      micStream.current = null;
      if (micTimer.current) window.clearTimeout(micTimer.current);
      client()?.cancel();
      void audioContext.current?.close().catch(() => undefined);
      audioContext.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PRESET_KEY, JSON.stringify({ preset, speed, lang: langPref, autoSpeak, handsFree }));
    } catch { /* quota or blocked */ }
  }, [preset, speed, langPref, autoSpeak, handsFree]);

  const voice = client();

  // One subscription for the whole page: the worker's own phases drive the announced state.
  useEffect(() => {
    const instance = voice;
    if (!instance) {
      setPhase('error');
      setError(UNAVAILABLE.detail ?? UNAVAILABLE.message);
      return;
    }
    const apply = (status: VoiceStatus) => {
      if (!mounted.current) return;
      setPhase(status.phase);
      setProgress(Math.min(1, Math.max(0, status.progress)));
      setReceivedBytes(status.receivedBytes ?? 0);
      setTotalBytes(status.totalBytes ?? 0);
      setFile(status.file ?? '');
      setDetail(status.detail ?? '');
      if (status.phase === 'error') setError(status.detail || status.message);
      if (status.phase === 'downloading' || status.phase === 'initializing' || status.phase === 'ready') {
        setError(null);
      }
    };
    apply(instance.status());
    const unsubscribe = instance.subscribe(apply);
    return () => { unsubscribe(); };
  }, [voice]);

  /* ------------------------------ playback ------------------------------ */

  const ensureAudio = useCallback(() => {
    if (!audioContext.current) {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioContext.current = new Ctor();
    }
    const context = audioContext.current;
    if (!context) return null;
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    if (!analyser.current) {
      const node = context.createAnalyser();
      node.fftSize = 512;
      node.smoothingTimeConstant = 0.75;
      node.connect(context.destination);
      analyser.current = node;
    }
    return context;
  }, []);

  /** Read the output's real amplitude — the orb must only move while sound is playing. */
  useEffect(() => {
    let frame = 0;
    const data = new Uint8Array(256);
    const tick = () => {
      const node = analyser.current;
      if (node) {
        node.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const value = (data[i] - 128) / 128;
          sum += value * value;
        }
        levelRef.current = Math.min(1, Math.sqrt(sum / data.length) * 3.4);
      } else {
        levelRef.current = 0;
      }
      const mic = micAnalyser.current;
      if (mic) {
        mic.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const value = (data[i] - 128) / 128;
          sum += value * value;
        }
        micLevelRef.current = Math.min(1, Math.sqrt(sum / data.length) * 4);
      } else {
        micLevelRef.current = 0;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const clearQueue = useCallback(() => {
    queue.current = [];
    index.current = 0;
    buffer.current = null;
    offset.current = 0;
    try { source.current?.stop(); } catch { /* not started */ }
    source.current = null;
    if (analyser.current) levelRef.current = 0;
  }, []);

  const finishRun = useCallback(() => {
    const done = onEndRef.current;
    onEndRef.current = null;
    speakingFlag.current = false;
    pausedFlag.current = false;
    if (!mounted.current) return;
    setSpeaking(false);
    setPaused(false);
    setPhase('completed');
    done?.();
  }, []);

  /** Play one decoded sentence. Resolves when it ENDS (or is superseded). */
  const playBuffer = useCallback((audio: AudioBuffer, id: number) => {
    const context = ensureAudio();
    if (!context) {
      setError('This browser blocked audio playback. Press Speak once more.');
      return;
    }
    const node = context.createBufferSource();
    node.buffer = audio;
    node.playbackRate.value = 1;
    if (analyser.current) node.connect(analyser.current);
    else node.connect(context.destination);
    source.current = node;
    buffer.current = audio;
    const from = Math.min(offset.current, Math.max(0, audio.duration - 0.02));
    startedAt.current = context.currentTime - from;
    offset.current = from;
    speakingFlag.current = true;
    pausedFlag.current = false;
    setSpeaking(true);
    setPaused(false);
    setPhase('speaking');
    node.onended = () => {
      if (id !== runId.current || !mounted.current) return;
      const consumed = context.currentTime - startedAt.current;
      // A stop() we caused (pause/interrupt) leaves the offset where it was; a natural end resets it.
      if (pausedFlag.current || id !== runId.current) return;
      if (consumed >= audio.duration - 0.08) {
        buffer.current = null;
        offset.current = 0;
        speakNextRef.current(id);
      }
    };
    node.start(0, from);
  }, [ensureAudio]);

  /** Speak the next queued sentence, or finish the run. */
  const speakNext = useCallback(async (id: number) => {
    if (id !== runId.current || !mounted.current) return;
    const next = queue.current[index.current];
    if (!next) {
      finishRun();
      return;
    }
    index.current += 1;
    setGenerating(true);
    setPhase('generating');
    try {
      const audio = await client()?.speak({
        text: next,
        lang: speechLanguage(next, langPref),
        preset,
        steps: 8,
        speed,
      });
      if (!audio) throw new Error('The voice worker is not available.');
      if (id !== runId.current || !mounted.current) return;
      const context = ensureAudio();
      if (!context) throw new Error('Audio playback is unavailable.');
      const decoded = await context.decodeAudioData(audio.wav.slice(0));
      if (id !== runId.current || !mounted.current) return;
      setGenerating(false);
      playBuffer(decoded, id);
    } catch (cause) {
      if (id !== runId.current || !mounted.current) return;
      setGenerating(false);
      const message = String((cause as Error)?.message ?? cause);
      if (/cancelled|superseded|interrupted/i.test(message)) return;
      setError(`Supertonic 3 could not speak: ${message}`);
      setPhase('error');
      speakingFlag.current = false;
      setSpeaking(false);
      onEndRef.current = null;
    }
  }, [ensureAudio, finishRun, langPref, playBuffer, preset, speed]);
  speakNextRef.current = speakNext;

  const speak = useCallback((text: string, onEnd?: () => void) => {
    const clean = speechText(text);
    const segments = speechSegments(clean);
    if (!segments.length) return;
    runId.current += 1;
    const id = runId.current;
    clearQueue();
    setError(null);
    setDetail('');
    setLastSpoken(clean);
    queue.current = segments;
    index.current = 0;
    onEndRef.current = onEnd ?? null;
    void speakNext(id);
  }, [clearQueue, speakNext]);

  const interrupt = useCallback(() => {
    runId.current += 1;
    onEndRef.current = null;
    speakingFlag.current = false;
    pausedFlag.current = false;
    client()?.cancel();
    clearQueue();
    setSpeaking(false);
    setPaused(false);
    setGenerating(false);
    setPhase('ready');
    levelRef.current = 0;
  }, [clearQueue]);

  const pause = useCallback(() => {
    const node = source.current;
    if (!node || !audioContext.current) return;
    const context = audioContext.current;
    offset.current = Math.max(0, context.currentTime - startedAt.current);
    pausedFlag.current = true;
    try { node.stop(); } catch { /* already stopped */ }
    source.current = null;
    speakingFlag.current = false;
    setSpeaking(false);
    setPaused(true);
    setPhase('paused');
    levelRef.current = 0;
  }, []);

  const resume = useCallback(() => {
    const audio = buffer.current;
    if (!audio || !pausedFlag.current) return;
    pausedFlag.current = false;
    playBuffer(audio, runId.current);
  }, [playBuffer]);

  const replay = useCallback(() => {
    if (lastSpoken) speak(lastSpoken);
  }, [lastSpoken, speak]);

  const prepare = useCallback(() => {
    client()?.preload();
  }, []);

  /* ------------------------------ microphone ------------------------------ */

  const stopListening = useCallback(() => {
    recognitionWanted.current = false;
    if (micTimer.current) {
      window.clearTimeout(micTimer.current);
      micTimer.current = 0;
    }
    try { recognition.current?.abort(); } catch { /* gone */ }
    recognition.current = null;
    micStream.current?.getTracks().forEach((track) => track.stop());
    micStream.current = null;
    micAnalyser.current = null;
    micLevelRef.current = 0;
    if (mounted.current) {
      setListening(false);
      setInterim('');
    }
  }, []);

  const startListening = useCallback((onTranscript: (text: string) => void) => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError('This browser has no speech recognition. Type your question instead.');
      return;
    }
    // Barge-in: the learner speaking outranks the tutor speaking.
    interrupt();
    stopListening();
    recognitionWanted.current = true;
    recognitionLang.current = 0;
    setError(null);
    setInterim('');
    const languages = recognitionLanguages(langPref === 'hi' ? 'hi-IN' : 'en-IN');
    setListening(true);

    // The mic's own level: the orb reacts to real input, not to a timer.
    void navigator.mediaDevices?.getUserMedia({ audio: true }).then((stream) => {
      if (!recognitionWanted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      micStream.current = stream;
      const context = ensureAudio();
      if (!context) return;
      const node = context.createAnalyser();
      node.fftSize = 512;
      const src = context.createMediaStreamSource(stream);
      src.connect(node);
      micAnalyser.current = node;
    }).catch(() => undefined);

    const arm = () => {
      if (!recognitionWanted.current || !mounted.current) return;
      const instance = new Ctor();
      instance.lang = languages[Math.min(recognitionLang.current, languages.length - 1)] ?? 'en-IN';
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
          recognitionWanted.current = false;
          try { instance.stop(); } catch { /* ended */ }
          recognition.current = null;
          if (mounted.current) {
            setListening(false);
            setInterim('');
          }
          onTranscript(final.trim());
        }
      };
      instance.onerror = (event) => {
        recognition.current = null;
        if (!mounted.current || !recognitionWanted.current) return;
        if (event.error === 'no-speech' || event.error === 'aborted') {
          window.setTimeout(() => { if (recognitionWanted.current) { try { arm(); } catch { /* retry later */ } } }, 300);
          return;
        }
        if (event.error === 'language-not-supported' && recognitionLang.current + 1 < languages.length) {
          recognitionLang.current += 1;
          try { arm(); } catch { /* retry later */ }
          return;
        }
        recognitionWanted.current = false;
        setListening(false);
        setInterim('');
        setError(event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Microphone permission is blocked. Allow it in the address bar, then press the mic again.'
          : 'Voice input stopped. You can type instead.');
      };
      instance.onend = () => {
        recognition.current = null;
        // Chrome ends a single-shot recognition on its own; keep the press alive until a final result.
        if (recognitionWanted.current && mounted.current) {
          window.setTimeout(() => { if (recognitionWanted.current) { try { arm(); } catch { /* done */ } } }, 260);
        }
      };
      recognition.current = instance;
      try {
        instance.start();
      } catch {
        setError('The microphone is still closing from the last try. Press the mic again.');
        recognitionWanted.current = false;
        setListening(false);
      }
    };

    arm();
    // A press that never hears anything must not hold the mic forever.
    micTimer.current = window.setTimeout(() => {
      if (!recognitionWanted.current) return;
      stopListening();
      setError('I did not hear anything. Press the mic and speak right after it says Listening.');
    }, 20_000);
  }, [ensureAudio, interrupt, langPref, stopListening]);

  const toggleListening = useCallback((onTranscript: (text: string) => void) => {
    if (recognitionWanted.current) stopListening();
    else startListening(onTranscript);
  }, [startListening, stopListening]);

  const clearCache = useCallback(async () => {
    interrupt();
    await client()?.clearCache();
  }, [interrupt]);

  const state = mentorVoiceState({
    phase, listening, speaking, paused, muted, generating, error,
  });
  const locale: SpeechLocale = langPref === 'hi' ? 'hi' : 'en';

  return {
    phase,
    state,
    progress,
    receivedBytes,
    totalBytes,
    totalLabel: bytesLabel(totalBytes),
    file,
    detail,
    error,
    supported,
    listening,
    speaking,
    paused,
    generating,
    muted,
    autoSpeak,
    handsFree,
    preset,
    speed,
    langPref,
    locale,
    lastSpoken,
    interim,
    levelRef,
    micLevelRef,
    setPreset: setPresetState,
    setSpeed: (value: number) => setSpeedState(clampRate(value)),
    setLangPref: setLangPrefState,
    setAutoSpeak: setAutoSpeakState,
    setHandsFree: setHandsFreeState,
    setMuted: (on: boolean) => {
      setMutedState(on);
      if (on) interrupt();
    },
    prepare,
    speak,
    pause,
    resume,
    replay,
    interrupt,
    startListening,
    stopListening,
    toggleListening,
    clearCache,
    dismissError: () => {
      setError(null);
      setPhase((current) => (current === 'error' ? 'ready' : current));
    },
  };
}
