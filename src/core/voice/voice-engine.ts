/**
 * The one speech engine the mentor uses.
 *
 * The browser owns the voices (`SpeechSynthesis`) and this class owns the only queue. It is
 * deliberately small on top of the platform, because every layer above a device voice is a place
 * where "speaking" can start lying:
 *
 *  · `Speaking` is published from `utterance.onstart` and `Finished speaking` from the last
 *    `onend` — never when `speak()` was merely called.
 *  · ONE answer at a time. A new `speak()` cancels the previous one and bumps a run id, so a late
 *    `onend` from the cancelled utterance cannot continue an old queue.
 *  · `pause`/`resume` call the platform's own pause/resume and publish the state the platform
 *    reports. Where a browser cannot resume mid-utterance it restarts the current sentence — the UI
 *    never shows a progress percentage that would be invented.
 *  · Utterances are sentence-sized: Chrome stops a single long utterance after roughly 15 seconds,
 *    and short segments also make `Stop` feel immediate.
 *
 * No model, no worker, no WASM, no network request: the sound comes from a voice the device already
 * has. That is also why there is nothing to download and no loading state to design around.
 */

import { resolveVoice } from './voice-discovery';
import { speechLanguage, speechSegments, speechText, type SpeechPreference } from './speech-processor';
import type {
  BrowserVoice, VoiceLocale, VoicePlaybackState, VoiceSelection,
} from './voice-types';

/** The fields of `SpeechSynthesisVoice` this engine reads. Plain data, so the tests can supply it. */
export interface SynthesisVoiceLike {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default: boolean;
}

/** The fields of `SpeechSynthesisUtterance` this engine sets and listens to. */
export interface UtteranceLike {
  text: string;
  lang: string;
  voice: SynthesisVoiceLike | null;
  rate: number;
  pitch: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onpause: (() => void) | null;
  onresume: (() => void) | null;
  onboundary: ((event: { name?: string }) => void) | null;
}

/** The slice of `window.speechSynthesis` used here — injectable, so the queue is testable. */
export interface SynthesisLike {
  getVoices(): SynthesisVoiceLike[];
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  speaking?: boolean;
  paused?: boolean;
  pending?: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

export interface VoiceEngineSnapshot {
  state: VoicePlaybackState;
  supported: boolean;
  voices: BrowserVoice[];
  paused: boolean;
  lastError: string | null;
}

export interface SpeakOptions {
  /** The learner's language choice; `auto` resolves per sentence from its own text. */
  preference?: SpeechPreference;
  /** Runs ONLY when the final sentence ended naturally. Never after `stop()` or an error. */
  onEnd?: () => void;
  /** A real word-boundary event — the orb's only source of "sound is happening". */
  onPulse?: () => void;
}

export interface PreviewOptions {
  locale: VoiceLocale;
  voiceURI?: string;
  preference?: SpeechPreference;
}

export interface VoiceEngineOptions {
  synthesis?: SynthesisLike | null;
  createUtterance?: (text: string) => UtteranceLike | null;
}

function browserSynthesis(): SynthesisLike | null {
  if (typeof window === 'undefined') return null;
  const synth = window.speechSynthesis as unknown as SynthesisLike | undefined;
  return synth ?? null;
}

function browserUtterance(text: string): UtteranceLike | null {
  if (typeof SpeechSynthesisUtterance === 'undefined') return null;
  return new SpeechSynthesisUtterance(text) as unknown as UtteranceLike;
}

function toBrowserVoice(voice: SynthesisVoiceLike): BrowserVoice {
  return {
    name: String(voice.name ?? 'Voice').trim() || 'Voice',
    lang: String(voice.lang ?? '').replace(/_/g, '-').trim() || 'en',
    voiceURI: String(voice.voiceURI ?? voice.name ?? '').trim(),
    localService: voice.localService === true,
    default: voice.default === true,
  };
}

type QueueItem = { text: string; lang: string };

export class VoiceEngine {
  private readonly synthesis: () => SynthesisLike | null;
  private readonly create: (text: string) => UtteranceLike | null;
  private readonly listeners = new Set<(snapshot: VoiceEngineSnapshot) => void>();

  private playback: VoicePlaybackState = 'idle';
  private supportedFlag = false;
  private voices: BrowserVoice[] = [];
  private selection: VoiceSelection = {};
  private queue: QueueItem[] = [];
  private index = 0;
  private runId = 0;
  private onEnd: (() => void) | null = null;
  private onPulse: (() => void) | null = null;
  private lastText = '';
  private rate = 1;
  private pitch = 1;
  private enabled = true;
  private lastError: string | null = null;

  constructor(options: VoiceEngineOptions = {}) {
    this.synthesis = options.synthesis === undefined ? browserSynthesis : () => options.synthesis ?? null;
    this.create = options.createUtterance ?? browserUtterance;
    this.supportedFlag = VoiceEngine.isSupported() || options.synthesis !== undefined;
  }

  /** Cheap capability probe for the first render, before `initialize()` resolved. */
  static isSupported(): boolean {
    return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
  }

  subscribe(listener: (snapshot: VoiceEngineSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getSnapshot(): VoiceEngineSnapshot {
    return {
      state: this.playback,
      supported: this.supportedFlag,
      voices: this.voices,
      paused: this.playback === 'paused',
      lastError: this.lastError,
    };
  }

  /**
   * Wait for the device's voice list.
   *
   * `getVoices()` is empty on the first call in every Chromium build — the list arrives with a
   * `voiceschanged` event, which some engines fire after the panel already rendered. The wait is
   * bounded: a browser that never answers must not leave a spinner on screen forever.
   */
  async initialize(timeoutMs = 1500): Promise<void> {
    const synth = this.synthesis();
    if (!synth) {
      this.supportedFlag = false;
      this.voices = [];
      this.emit();
      return;
    }
    this.supportedFlag = true;
    this.readVoices();
    if (this.voices.length) {
      this.emit();
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      let poll = 0;
      let timer = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        try { synth.removeEventListener?.('voiceschanged', finish); } catch { /* not supported */ }
        if (poll) clearInterval(poll);
        if (timer) clearTimeout(timer);
        this.readVoices();
        this.emit();
        resolve();
      };
      try { synth.addEventListener?.('voiceschanged', finish); } catch { /* not supported */ }
      if (typeof setTimeout === 'function') timer = setTimeout(finish, Math.max(200, timeoutMs)) as unknown as number;
      if (typeof setInterval === 'function') {
        poll = setInterval(() => {
          if (this.readVoices() && this.voices.length) finish();
        }, 120) as unknown as number;
      }
    });
  }

  /** Re-read the device list — a learner can install a voice without reloading the page. */
  refreshVoices(): BrowserVoice[] {
    this.readVoices();
    this.emit();
    return this.voices;
  }

  getVoices(): BrowserVoice[] {
    return this.voices;
  }

  setSelection(selection: VoiceSelection): void {
    this.selection = { ...selection };
  }

  setRate(rate: number): void {
    this.rate = Math.min(1.4, Math.max(0.7, Number.isFinite(rate) ? rate : 1));
  }

  setPitch(pitch: number): void {
    this.pitch = Math.min(1.4, Math.max(0.6, Number.isFinite(pitch) ? pitch : 1));
  }

  /** Off means off: speech stops now and no queued sentence starts. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  /**
   * Speak one FINAL answer.
   *
   * `speechText` is applied here as well as by the caller, so a direct call from any surface is
   * cleaned the same way; segmentation is idempotent on already-clean text.
   */
  speak(text: string, options: SpeakOptions = {}): void {
    const clean = speechText(text);
    const segments = speechSegments(clean);
    if (!segments.length) return;
    if (!this.enabled) return;

    const synth = this.synthesis();
    if (!synth) {
      this.fail('This browser has no speech synthesis, so answers cannot be read aloud.');
      return;
    }
    this.supportedFlag = true;
    this.readVoices();

    this.stopRun();
    this.lastError = null;
    this.lastText = clean;
    this.onEnd = options.onEnd ?? null;
    this.onPulse = options.onPulse ?? null;
    const preference = options.preference ?? 'auto';
    this.queue = segments.map((segment) => ({ text: segment, lang: speechLanguage(segment, preference) }));
    this.index = 0;
    this.playback = 'idle';
    this.emit();
    this.speakNext(this.runId);
  }

  /** One sentence with one named voice, used by the picker's Preview button. */
  preview(text: string, options: PreviewOptions): void {
    const clean = speechSegments(speechText(text))[0];
    if (!clean || !this.enabled) return;
    const synth = this.synthesis();
    if (!synth) {
      this.fail('This browser has no speech synthesis, so voices cannot be previewed.');
      return;
    }
    this.readVoices();
    this.stopRun();
    this.lastError = null;
    this.onEnd = null;
    this.onPulse = null;
    this.playback = 'idle';
    this.queue = [{ text: clean, lang: speechLanguage(clean, options.preference ?? options.locale) }];
    this.index = 0;
    this.emit();
    this.speakNext(this.runId, resolveVoice(this.voices, options.locale, options.voiceURI));
  }

  pause(): void {
    if (this.playback !== 'speaking') return;
    try { this.synthesis()?.pause(); } catch { /* platform refused; state below still matches us */ }
    this.playback = 'paused';
    this.emit();
  }

  resume(): void {
    if (this.playback !== 'paused') return;
    try { this.synthesis()?.resume(); } catch { /* platform refused */ }
    this.playback = 'speaking';
    this.emit();
  }

  /** Say the last answer again — the same text, a fresh run, no new retrieval. */
  replay(): void {
    if (!this.lastText) return;
    this.speak(this.lastText);
  }

  /** Stop the voice and the whole queue. `onEnd` is NOT called, so hands-free stays closed. */
  stop(): void {
    this.stopRun();
    this.playback = 'idle';
    this.emit();
  }

  /** Alias kept for callers that speak about cancellation. */
  cancel(): void {
    this.stop();
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  /* ------------------------------- internals ------------------------------- */

  private readVoices(): boolean {
    const synth = this.synthesis();
    if (!synth) {
      this.voices = [];
      return false;
    }
    let listed: SynthesisVoiceLike[] = [];
    try { listed = synth.getVoices() ?? []; } catch { listed = []; }
    const seen = new Set<string>();
    const voices: BrowserVoice[] = [];
    for (const voice of listed) {
      const mapped = toBrowserVoice(voice);
      const key = `${mapped.voiceURI}::${mapped.lang}`;
      if (seen.has(key)) continue;
      seen.add(key);
      voices.push(mapped);
    }
    this.voices = voices;
    return true;
  }

  /** Invalidate the current run and silence everything it queued. */
  private stopRun(): void {
    this.runId += 1;
    this.queue = [];
    this.index = 0;
    this.onEnd = null;
    this.onPulse = null;
    try { this.synthesis()?.cancel(); } catch { /* nothing was speaking */ }
  }

  private speakNext(id: number, forcedVoice?: BrowserVoice | null): void {
    if (id !== this.runId) return;
    const item = this.queue[this.index];
    if (!item) {
      this.finish();
      return;
    }
    this.index += 1;
    const utterance = this.create(item.text);
    if (!utterance) {
      this.fail('This browser could not create an utterance.');
      return;
    }
    const voice = forcedVoice ?? resolveVoice(this.voices, item.lang === 'hi' ? 'hi' : 'en', this.selection[item.lang === 'hi' ? 'hi' : 'en']);
    utterance.text = item.text;
    utterance.lang = voice?.lang ?? (item.lang === 'hi' ? 'hi-IN' : 'en-IN');
    utterance.voice = voice ?? null;
    utterance.rate = this.rate;
    utterance.pitch = this.pitch;

    utterance.onstart = () => {
      if (id !== this.runId) return;
      this.playback = 'speaking';
      this.emit();
    };
    utterance.onboundary = () => {
      if (id !== this.runId) return;
      this.onPulse?.();
    };
    utterance.onpause = () => {
      if (id !== this.runId) return;
      this.playback = 'paused';
      this.emit();
    };
    utterance.onresume = () => {
      if (id !== this.runId) return;
      this.playback = 'speaking';
      this.emit();
    };
    utterance.onerror = (event) => {
      if (id !== this.runId) return;
      const code = String(event?.error ?? '');
      // Every browser reports a cancelled utterance as an error; that is our own stop, not a failure.
      if (/cancel|interrupt|abort/i.test(code)) return;
      this.fail(code === 'not-allowed'
        ? 'The browser blocked speech. Press Speak once more, and allow audio for this site.'
        : `The device voice stopped${code ? ` (${code})` : ''}.`);
    };
    utterance.onend = () => {
      if (id !== this.runId) return;
      this.speakNext(id);
    };

    try {
      this.synthesis()?.speak(utterance);
    } catch (cause) {
      this.fail(`The device voice could not start: ${String((cause as Error)?.message ?? cause)}`);
    }
  }

  private finish(): void {
    this.playback = 'completed';
    const done = this.onEnd;
    this.onEnd = null;
    this.onPulse = null;
    this.queue = [];
    this.index = 0;
    this.emit();
    done?.();
  }

  private fail(message: string): void {
    this.stopRun();
    this.lastError = message;
    this.playback = 'error';
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch { /* one bad subscriber must not stop the queue */ }
    }
  }
}

let shared: VoiceEngine | null = null;

/** One engine per page: two components asking for a voice get the same queue, not two. */
export function getVoiceEngine(): VoiceEngine {
  shared ??= new VoiceEngine();
  return shared;
}

export function disposeVoiceEngine(): void {
  shared?.dispose();
  shared = null;
}

/**
 * Delete Cache Storage entries left by the retired model engine.
 *
 * This is the versioned invalidation the old architecture needed and the new one does not: the cache
 * names are matched exactly, so nothing else the app stores (the service worker's bundle cache, the
 * generated content) is touched. Failures are ignored — an absent Cache API is not an error.
 */
export async function purgeLegacyVoiceCaches(): Promise<string[]> {
  if (typeof caches === 'undefined') return [];
  try {
    const names = await caches.keys();
    const stale = names.filter((name) => /supertonic|tts-model|ort-wasm/i.test(name));
    await Promise.all(stale.map((name) => caches.delete(name)));
    return stale;
  } catch {
    return [];
  }
}
