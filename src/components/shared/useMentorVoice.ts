import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getVoiceEngine, purgeLegacyVoiceCaches, VoiceEngine, type VoiceEngineSnapshot,
} from '../../core/voice/voice-engine';
import { describeVoice, resolveLocale, voiceCounts } from '../../core/voice/voice-discovery';
import {
  NATURAL_VOICE, naturalVoices, profileMessage, profileStatus, recognitionLocale,
  type NaturalVoiceStatus,
} from '../../core/voice/voice-profile';
import { mentorVoiceState, speechText, type MentorVoiceState } from '../../core/voice/mentor-voice';
import type {
  MicPermission, VoiceLanguagePreference, VoiceLocale, VoicePlaybackState,
} from '../../core/voice/voice-types';
import { clampRate, recognitionLanguages } from '../../core/ai/voice';

/**
 * The one voice adapter shared by every AI Mentor surface.
 *
 * It is a thin, honest layer over `VoiceEngine`:
 *
 *  · ONE ENGINE PER PAGE — a module singleton, so remounting the studio never creates a second queue
 *    and two surfaces can never speak over each other.
 *  · SPEAKING MEANS PLAYING — the state is the engine's own `onstart`/`onend`/`onerror` report.
 *  · THE VOICE IS THE DEVICE'S — `voices` is exactly what `getVoices()` returned; nothing is renamed
 *    into an invented preset and no "female" claim is made for a voice whose name does not say so.
 *  · HANDS-FREE IS NOT A TIMER — the hook only reveals `onEnd` after the final utterance ended, and
 *    the studio reopens the microphone there. `stop()` never runs that callback.
 *  · THE ORB READS REAL EVENTS — `levelRef` is driven by word-boundary events from the platform, and
 *    the microphone level by a real `AnalyserNode`. Neither moves to a decorative animation loop.
 */

export interface VoiceDiagnostics {
  synthesis: boolean;
  recognition: boolean;
  voices: number;
  hindi: number;
  english: number;
  /** True when ONE installed voice serves both languages, which is said in the details. */
  shared: boolean;
  selected: string;
  selectedLang: string;
  language: VoiceLanguagePreference;
  playback: VoicePlaybackState;
  enabled: boolean;
  lastError: string | null;
  micPermission: MicPermission;
  handsFree: boolean;
}

export interface MentorVoice {
  /** Speech synthesis is available in this browser. */
  supported: boolean;
  /** The recogniser exists (Chromium today). */
  recognitionSupported: boolean;
  state: MentorVoiceState;
  playback: VoicePlaybackState;
  speaking: boolean;
  paused: boolean;
  listening: boolean;
  /** True once the device's voice list arrived (or the bounded wait ended). */
  ready: boolean;
  enabled: boolean;
  /** Alias of `!enabled`, kept because the studio speaks about a muted mentor. */
  muted: boolean;
  autoSpeak: boolean;
  handsFree: boolean;
  speed: number;
  langPref: VoiceLanguagePreference;
  locale: VoiceLocale;
  lastSpoken: string;
  interim: string;
  error: string | null;
  micPermission: MicPermission;
  /** Why the microphone stopped, in words a learner can act on. Null when nothing went wrong. */
  micError: string | null;
  dismissMicError: () => void;
  /**
   * The ONE profile the learner sees. The installed voices behind it are an implementation detail:
   * they are named only in the diagnostic details, never in the main panel.
   */
  profile: {
    id: string;
    name: string;
    subtitle: string;
    detail: string;
    status: NaturalVoiceStatus;
    /** What will actually happen, or '' when both languages have a voice. */
    message: string;
  };
  diagnostics: VoiceDiagnostics;
  levelRef: { current: number };
  micLevelRef: { current: number };
  setEnabled: (on: boolean) => void;
  setAutoSpeak: (on: boolean) => void;
  setHandsFree: (on: boolean) => void;
  setSpeed: (speed: number) => void;
  setLangPref: (pref: VoiceLanguagePreference) => void;
  testVoice: () => void;
  /** Unlock the platform's speech queue from a click (Chrome/Safari activation). */
  prime: () => void;
  refreshVoices: () => void;
  /** Speak the FINAL assistant text. `onEnd` runs only after real completion. */
  speak: (text: string, onEnd?: () => void) => void;
  pause: () => void;
  resume: () => void;
  replay: () => void;
  interrupt: () => void;
  startListening: (onTranscript: (text: string) => void) => void;
  stopListening: () => void;
  toggleListening: (onTranscript: (text: string) => void) => void;
  dismissError: () => void;
}

const STORAGE_KEY = 'aiml:mentor-voice';
const SENTENCE_GAP_FREE = 'The browser reads sentence by sentence, in order.';

const SAMPLE: Record<VoiceLocale, string> = {
  en: 'Hi, I am your BroCode mentor. This is how I will read your answers.',
  hi: 'Namaste! Main tumhara BroCode mentor hoon. Tumhare jawab aise padhe jayenge.',
};

interface Prefs {
  speed: number;
  lang: VoiceLanguagePreference;
  autoSpeak: boolean;
  handsFree: boolean;
  enabled: boolean;
}

const FALLBACK_PREFS: Prefs = {
  speed: 1,
  lang: 'auto',
  autoSpeak: true,
  handsFree: false,
  enabled: true,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return FALLBACK_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs> | null;
    // A stored voice name from the picker era is deliberately DROPPED: the profile re-resolves the
    // device's best voices on every load, so an uninstalled or wrong-language pick cannot stick.
    return {
      speed: clampRate(parsed?.speed ?? 1),
      lang: parsed?.lang === 'hi' || parsed?.lang === 'en' ? parsed.lang : 'auto',
      autoSpeak: parsed?.autoSpeak !== false,
      handsFree: parsed?.handsFree === true,
      enabled: parsed?.enabled !== false,
    };
  } catch {
    return FALLBACK_PREFS;
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

const LANGUAGE_LABELS: Record<VoiceLanguagePreference, string> = {
  auto: 'Auto detect',
  en: 'English',
  hi: 'Hindi / Hinglish',
};

export function languageLabel(pref: VoiceLanguagePreference): string {
  return LANGUAGE_LABELS[pref];
}

export function useMentorVoice(busy = false): MentorVoice {
  const engine = useMemo(() => getVoiceEngine(), []);
  const [snapshot, setSnapshot] = useState<VoiceEngineSnapshot>(() => engine.getSnapshot());
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [ready, setReady] = useState(false);
  const [listening, setListening] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [micPermission, setMicPermission] = useState<MicPermission>('unknown');
  const [interim, setInterim] = useState('');
  const [lastSpoken, setLastSpoken] = useState('');

  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const levelRef = useRef(0);
  const micLevelRef = useRef(0);
  const pulse = useRef(0);
  const micAnalyser = useRef<AnalyserNode | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const mounted = useRef(true);
  const recognition = useRef<RecognitionLike | null>(null);
  const recognitionWanted = useRef(false);
  const recognitionLang = useRef(0);
  /** Consecutive empty recognition passes; capped so a silent room cannot loop forever. */
  const recognitionFailures = useRef(0);
  const micTimer = useRef(0);

  const supported = ready ? snapshot.supported : VoiceEngine.isSupported();
  const recognitionSupported = useMemo(() => recognitionCtor() !== null, []);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = engine.subscribe((next) => {
      if (mounted.current) setSnapshot(next);
    });
    let alive = true;
    void engine.initialize().then(() => {
      if (!alive) return;
      setSnapshot(engine.getSnapshot());
      setReady(true);
    });
    // The old model engine cached hundreds of megabytes; deleting those entries is the migration's
    // own cleanup, and it happens once, quietly, whether or not the learner ever uses the voice.
    void purgeLegacyVoiceCaches();
    return () => {
      alive = false;
      mounted.current = false;
      unsubscribe();
      engine.stop();
      try { recognition.current?.abort(); } catch { /* gone */ }
      micStream.current?.getTracks().forEach((track) => track.stop());
      micStream.current = null;
      micAnalyser.current = null;
      if (micTimer.current) window.clearTimeout(micTimer.current);
      void audioContext.current?.close().catch(() => undefined);
      audioContext.current = null;
    };
  }, [engine]);

  useEffect(() => {
    engine.setRate(prefs.speed);
    engine.setEnabled(prefs.enabled);
  }, [engine, prefs]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch { /* quota or blocked */ }
  }, [prefs]);

  /* ------------------------------ permissions ------------------------------ */
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const permissions = (navigator as unknown as {
      permissions?: { query?: (descriptor: { name: string }) => Promise<{ state: string }> };
    }).permissions;
    if (!permissions?.query) {
      setMicPermission(recognitionCtor() ? 'unknown' : 'unsupported');
      return;
    }
    let alive = true;
    void permissions.query({ name: 'microphone' })
      .then((status) => {
        if (!alive) return;
        setMicPermission(status.state === 'granted' ? 'granted' : status.state === 'denied' ? 'denied' : 'unknown');
      })
      .catch(() => { if (alive) setMicPermission('unknown'); });
    return () => { alive = false; };
  }, []);

  /* -------------------------------- levels -------------------------------- */
  useEffect(() => {
    let frame = 0;
    let smooth = 0;
    const data = new Uint8Array(256);
    const tick = () => {
      // Boundary events are real (the platform is advancing word by word); the decay is only visual.
      pulse.current *= 0.86;
      smooth += (pulse.current - smooth) * 0.24;
      levelRef.current = Math.min(1, smooth);
      const analyser = micAnalyser.current;
      if (analyser) {
        analyser.getByteTimeDomainData(data);
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

  const ensureAudio = useCallback(() => {
    if (typeof window === 'undefined') return null;
    if (!audioContext.current) {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioContext.current = new Ctor();
    }
    const context = audioContext.current;
    if (!context) return null;
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    return context;
  }, []);

  /* -------------------------------- speaking ------------------------------- */
  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (!prefsRef.current.enabled) return;
    const clean = speechText(text);
    if (!clean) return;
    setLastSpoken(clean);
    engine.speak(clean, {
      preference: prefsRef.current.lang,
      onEnd,
      onPulse: () => { pulse.current = 1; },
    });
  }, [engine]);

  const pause = useCallback(() => engine.pause(), [engine]);
  const resume = useCallback(() => engine.resume(), [engine]);
  const interrupt = useCallback(() => engine.stop(), [engine]);
  const replay = useCallback(() => {
    if (!prefsRef.current.enabled) return;
    engine.replay();
  }, [engine]);

  /** The profile's one button: the device's best voice for the current language reads a sample. */
  const testVoice = useCallback(() => {
    const pref = prefsRef.current;
    const locale = resolveLocale(pref.lang, lastSpoken);
    engine.preview(SAMPLE[locale], { locale, preference: pref.lang });
  }, [engine, lastSpoken]);

  const prime = useCallback(() => { engine.prime(); }, [engine]);

  const refreshVoices = useCallback(() => {
    engine.refreshVoices();
    setSnapshot(engine.getSnapshot());
  }, [engine]);

  /* ------------------------------- microphone ------------------------------ */
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
      setMicPermission('unsupported');
      return;
    }
    // Barge-in: the learner speaking outranks the mentor speaking, and the mic never opens on top of
    // the voice — that is exactly how a recogniser ends up transcribing the speaker.
    engine.stop();
    stopListening();
    recognitionWanted.current = true;
    recognitionLang.current = 0;
    recognitionFailures.current = 0;
    setMicDenied(false);
    setMicError(null);
    setInterim('');
    // The recogniser follows the last answer: a Hindi answer invites a Hindi reply. Starting every
    // question with `en-IN` is why a Hindi question came back as nothing at all.
    const languages = recognitionLanguages(recognitionLocale(prefsRef.current.lang, lastSpoken));
    setListening(true);

    // `mediaDevices` is absent on an insecure origin and in some webviews; calling it unguarded threw
    // before recognition ever started, which looked exactly like a broken microphone.
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (media?.getUserMedia) {
      void media.getUserMedia({ audio: true }).then((stream) => {
        if (!recognitionWanted.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        micStream.current = stream;
        const context = ensureAudio();
        if (!context) return;
        const node = context.createAnalyser();
        node.fftSize = 512;
        context.createMediaStreamSource(stream).connect(node);
        micAnalyser.current = node;
        setMicPermission('granted');
      }).catch((cause: unknown) => {
        // The recogniser can still work with its own permission prompt; the level meter simply stays flat.
        const name = String((cause as { name?: string })?.name ?? '');
        const blocked = name === 'NotAllowedError' || name === 'SecurityError';
        setMicPermission((current) => (current === 'granted' ? current : blocked ? 'denied' : 'unknown'));
      });
    }

    // Listening ends after 20 seconds of SILENCE, not 20 seconds from the press: a learner who pauses
    // to think mid-question must not have their microphone closed under them.
    const resetMicTimer = () => {
      if (micTimer.current) window.clearTimeout(micTimer.current);
      micTimer.current = window.setTimeout(() => {
        if (recognitionWanted.current) stopListening();
      }, 20_000);
    };

    const arm = () => {
      if (!recognitionWanted.current || !mounted.current) return;
      const instance = new Ctor();
      instance.lang = languages[Math.min(recognitionLang.current, languages.length - 1)] ?? 'en-IN';
      instance.continuous = false;
      instance.interimResults = true;
      instance.onresult = (event) => {
        recognitionFailures.current = 0;
        resetMicTimer();
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
          recognitionFailures.current += 1;
          if (recognitionFailures.current > 4) {
            stopListening();
            return;
          }
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
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') setMicDenied(true);
        // Every recogniser failure used to end in a silent stop, which reads as "the voice section does
        // nothing". The code is mapped to the one action that actually fixes it.
        const MIC_ERRORS: Record<string, string> = {
          'not-allowed': 'The microphone is blocked. Allow it for this site in the browser settings, then press Ask again.',
          'service-not-allowed': 'This browser blocked microphone access for the page. Allow it, then press Ask again.',
          'audio-capture': 'No microphone was found. Connect one, then press Ask again — or type the question.',
          network: 'Speech recognition could not reach its service. Check your connection, then try again or type the question.',
          'language-not-supported': 'This browser cannot recognise the selected language yet. Pick English in Language, or type the question.',
        };
        setMicError(MIC_ERRORS[event.error]
          ?? `The microphone stopped (${event.error || 'unknown error'}). Press Ask to try again.`);
      };
      instance.onend = () => {
        recognition.current = null;
        if (recognitionWanted.current && mounted.current) {
          window.setTimeout(() => { if (recognitionWanted.current) { try { arm(); } catch { /* done */ } } }, 260);
        }
      };
      recognition.current = instance;
      try {
        instance.start();
      } catch {
        recognitionWanted.current = false;
        setListening(false);
      }
    };

    arm();
    resetMicTimer();
  }, [engine, ensureAudio, lastSpoken, stopListening]);

  const toggleListening = useCallback((onTranscript: (text: string) => void) => {
    if (recognitionWanted.current) stopListening();
    else startListening(onTranscript);
  }, [startListening, stopListening]);

  /* ------------------------------ the surface ----------------------------- */
  const locale = resolveLocale(prefs.lang, lastSpoken);
  const pair = useMemo(() => naturalVoices(snapshot.voices), [snapshot.voices]);
  const counts = useMemo(() => voiceCounts(snapshot.voices), [snapshot.voices]);
  const profile = useMemo(() => ({
    ...NATURAL_VOICE,
    status: profileStatus(snapshot.voices, prefs.lang),
    message: profileMessage(snapshot.voices, prefs.lang),
  }), [snapshot.voices, prefs.lang]);

  const state = mentorVoiceState({
    playing: snapshot.state,
    listening,
    thinking: busy,
    error: snapshot.lastError,
    unsupported: ready && !snapshot.supported,
    permissionRequired: micDenied,
  });

  const setEnabled = useCallback((on: boolean) => {
    setPrefs((current) => ({ ...current, enabled: on }));
  }, []);
  const setAutoSpeak = useCallback((on: boolean) => {
    setPrefs((current) => ({ ...current, autoSpeak: on }));
  }, []);
  const setHandsFree = useCallback((on: boolean) => {
    setPrefs((current) => ({ ...current, handsFree: on }));
  }, []);
  const setSpeed = useCallback((speed: number) => {
    setPrefs((current) => ({ ...current, speed: clampRate(speed) }));
  }, []);
  const setLangPref = useCallback((lang: VoiceLanguagePreference) => {
    setPrefs((current) => ({ ...current, lang }));
  }, []);
  const diagnostics: VoiceDiagnostics = {
    synthesis: supported,
    recognition: recognitionSupported,
    voices: counts.total,
    hindi: counts.hindi,
    english: counts.english,
    shared: pair.shared,
    selected: `${describeVoice(pair.hi)} / ${describeVoice(pair.en)}`,
    selectedLang: pair.hi?.lang ?? pair.en?.lang ?? '—',
    language: prefs.lang,
    playback: snapshot.state,
    enabled: prefs.enabled,
    lastError: snapshot.lastError,
    micPermission,
    handsFree: prefs.handsFree,
  };

  return {
    supported,
    recognitionSupported,
    state,
    playback: snapshot.state,
    speaking: snapshot.state === 'speaking',
    paused: snapshot.state === 'paused',
    listening,
    ready,
    enabled: prefs.enabled,
    muted: !prefs.enabled,
    autoSpeak: prefs.autoSpeak,
    handsFree: prefs.handsFree,
    speed: prefs.speed,
    langPref: prefs.lang,
    locale,
    lastSpoken,
    interim,
    error: snapshot.lastError,
    micPermission,
    profile,
    diagnostics,
    levelRef,
    micLevelRef,
    setEnabled,
    setAutoSpeak,
    setHandsFree,
    setSpeed,
    setLangPref,
    testVoice,
    prime,
    refreshVoices,
    speak,
    pause,
    resume,
    replay,
    interrupt,
    startListening,
    stopListening,
    toggleListening,
    micError,
    dismissMicError: () => setMicError(null),
    dismissError: () => engine.stop(),
  };
}

/** Exported for the copy panel: the sentence gap is the platform's, not a promise we invented. */
export const VOICE_QUEUE_NOTE = SENTENCE_GAP_FREE;
