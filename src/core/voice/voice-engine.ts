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
 *  · The four repairs that make the difference between a voice that works and one that silently does
 *    nothing (all seen in Chromium):
 *      1. `cancel()` then `speak()` in the SAME task drops the new utterance. When the platform was
 *         busy, the first sentence is started one task later (`CANCEL_GAP_MS`), not immediately.
 *      2. An utterance nobody references can be garbage-collected mid-sentence and stop the audio.
 *         `current` holds the live one until it ends.
 *      3. `speechSynthesis.paused` is page-global and survives `cancel()`. A previously paused
 *         platform queues every new utterance and plays none, so a paused platform is resumed before
 *         speaking.
 *      4. `speak()` can be accepted and never start. A bounded watchdog checks whether the platform
 *         really began, re-issues the same sentence once, and only then reports a failure.
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
import { speechSegments, speechText, type SpeechPreference } from './speech-processor';
import { planSpeech } from './voice-profile';
import type {
  BrowserVoice, VoiceLocale, VoicePlaybackState,
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
  volume: number;
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
  preference?: SpeechPreference;
}

export interface VoiceEngineOptions {
  synthesis?: SynthesisLike | null;
  createUtterance?: (text: string) => UtteranceLike | null;
  /** How long a silent start is tolerated before the sentence is re-issued (tests shorten it). */
  startTimeoutMs?: number;
}

/** Chromium drops a `speak()` issued in the same task as `cancel()`; one task of daylight is enough. */
const CANCEL_GAP_MS = 90;
/** Default grace period for a silent start before the sentence is re-issued once. */
const START_TIMEOUT_MS = 4000;

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

type QueueItem = { text: string; lang: VoiceLocale };

export class VoiceEngine {
  private readonly synthesis: () => SynthesisLike | null;
  private readonly create: (text: string) => UtteranceLike | null;
  private readonly listeners = new Set<(snapshot: VoiceEngineSnapshot) => void>();
  private readonly startTimeout: number;

  private playback: VoicePlaybackState = 'idle';
  private supportedFlag = false;
  private voices: BrowserVoice[] = [];
  private queue: QueueItem[] = [];
  private index = 0;
  private runId = 0;
  private onEnd: (() => void) | null = null;
  private onPulse: (() => void) | null = null;
  private lastText = '';
  private lastPreference: SpeechPreference = 'auto';
  private rate = 1;
  private pitch = 1;
  private enabled = true;
  private lastError: string | null = null;

  /** The live utterance. Chromium can collect an unreferenced one and stop the audio. */
  private current: UtteranceLike | null = null;
  /** At most one internal timer: the cancel gap, the start watchdog, or nothing. */
  private timer = 0;
  /** One re-issue per answer, so a platform that never starts cannot loop forever. */
  private retries = 0;

  constructor(options: VoiceEngineOptions = {}) {
    this.synthesis = options.synthesis === undefined ? browserSynthesis : () => options.synthesis ?? null;
    this.create = options.createUtterance ?? browserUtterance;
    this.startTimeout = Math.max(10, options.startTimeoutMs ?? START_TIMEOUT_MS);
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
   * Unlock the platform's speech queue from a real user gesture.
   *
   * Chrome and Safari only allow `speak()` once the page has been activated; an answer that arrives
   * from a fetch a second later is then refused (`not-allowed`) or dropped silently — the exact
   * "Ready but no sound" report. Called from the send and mic clicks, this speaks one silent, empty
   * utterance so the later answer is allowed. It is NOT part of the answer: `lastText`, the queue and
   * `onEnd` are untouched, and nothing is announced.
   */
  prime(): void {
    const synth = this.synthesis();
    if (!synth) return;
    if (this.playback === 'speaking' || this.playback === 'paused') return;
    if (synth.paused) {
      try { synth.resume(); } catch { /* platform refused */ }
    }
    const utterance = this.create('.');
    if (!utterance) return;
    const voice = resolveVoice(this.voices, 'en');
    utterance.text = '.';
    utterance.lang = voice?.lang ?? 'en-IN';
    utterance.voice = voice ?? null;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 0;
    utterance.onstart = null;
    utterance.onend = null;
    utterance.onerror = null;
    utterance.onpause = null;
    utterance.onresume = null;
    utterance.onboundary = null;
    try { synth.speak(utterance); } catch { /* activation still missing; speak() reports it */ }
  }

  /**
   * Speak one FINAL answer.
   *
   * `speechText` is applied here as well as by the caller, so a direct call from any surface is
   * cleaned the same way; segmentation is idempotent on already-clean text.
   */
  speak(text: string, options: SpeakOptions = {}): void {
    if (!this.enabled) return;
    const synth = this.synthesis();
    if (!synth) {
      this.fail('This browser has no speech synthesis, so answers cannot be read aloud.');
      return;
    }
    this.supportedFlag = true;
    this.readVoices();

    const preference = options.preference ?? 'auto';
    const plan = planSpeech(text, preference);
    if (!plan.segments.length) return;

    // Read the platform BEFORE the cancel below clears it: if it was playing (or left paused), the
    // new utterance must wait a task or Chromium silently discards it.
    const platformBusy = Boolean(synth.speaking || synth.pending || synth.paused)
      || this.playback === 'speaking' || this.playback === 'paused';

    this.stopRun();
    this.lastError = null;
    this.lastText = plan.segments.map((segment) => segment.text).join(' ');
    this.lastPreference = preference;
    this.onEnd = options.onEnd ?? null;
    this.onPulse = options.onPulse ?? null;
    this.queue = plan.segments.map((segment) => ({ text: segment.text, lang: segment.lang }));
    this.index = 0;
    this.retries = 0;
    this.playback = 'idle';
    this.emit();
    this.start(platformBusy ? CANCEL_GAP_MS : 0);
  }

  /**
   * One sentence, used by the profile's Test voice button. It is never remembered for Replay, and it
   * deliberately ignores the mute switch: pressing Test voice is an explicit request to hear a voice,
   * so a muted panel must still be able to prove that audio works.
   */
  preview(text: string, options: PreviewOptions): void {
    const clean = speechSegments(speechText(text))[0];
    if (!clean) return;
    const synth = this.synthesis();
    if (!synth) {
      this.fail('This browser has no speech synthesis, so voices cannot be previewed.');
      return;
    }
    this.readVoices();
    const platformBusy = Boolean(synth.speaking || synth.pending || synth.paused)
      || this.playback === 'speaking' || this.playback === 'paused';
    this.stopRun();
    this.lastError = null;
    this.onEnd = null;
    this.onPulse = null;
    this.queue = [{ text: clean, lang: options.locale }];
    this.index = 0;
    this.retries = 0;
    this.playback = 'idle';
    this.emit();
    this.start(platformBusy ? CANCEL_GAP_MS : 0);
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
    this.speak(this.lastText, { preference: this.lastPreference });
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
    this.current = null;
    this.retries = 0;
    this.clearTimer();
    try { this.synthesis()?.cancel(); } catch { /* nothing was speaking */ }
  }

  /** Begin the run after an optional one-task gap (see `CANCEL_GAP_MS`). */
  private start(delay: number): void {
    const id = this.runId;
    const synth = this.synthesis();
    // A page-global paused platform queues utterances and never plays them; clear it first.
    if (synth?.paused) {
      try { synth.resume(); } catch { /* platform refused */ }
    }
    if (delay <= 0) {
      this.speakNext(id);
      return;
    }
    this.schedule(delay, () => {
      if (id === this.runId) this.speakNext(id);
    });
  }

  private speakNext(id: number): void {
    if (id !== this.runId) return;
    const item = this.queue[this.index];
    if (!item) {
      this.finish();
      return;
    }
    const attempted = this.index;
    this.index += 1;
    const utterance = this.create(item.text);
    if (!utterance) {
      this.fail('This browser could not create an utterance.');
      return;
    }
    // No installed voice at all: say so once, instead of letting the watchdog report a silent device.
    if (!this.voices.length) {
      this.fail('No speech voice is installed on this device, so answers cannot be read aloud. '
        + 'Install one in your system settings, then press Speak.');
      return;
    }
    const voice = resolveVoice(this.voices, item.lang);
    utterance.text = item.text;
    // A Hindi sentence never gets an English voice's tag: the platform's own voice matters for the
    // script, and a mismatch is the classic "it speaks nothing" case on Windows.
    utterance.lang = voice?.lang ?? (item.lang === 'hi' ? 'hi-IN' : 'en-IN');
    utterance.voice = voice ?? null;
    utterance.rate = this.rate;
    utterance.pitch = this.pitch;
    utterance.volume = 1;

    utterance.onstart = () => {
      if (id !== this.runId) return;
      this.clearTimer();
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
      this.clearTimer();
      const code = String(event?.error ?? '');
      // Our own stop changes the run id, so a cancellation that reaches this line is the platform
      // dropping an utterance we still wanted. One re-issue, then an honest failure.
      if (/cancel|interrupt|abort/i.test(code)) {
        if (this.retries < 1) {
          this.retries += 1;
          this.index = attempted;
          this.speakNext(id);
          return;
        }
        this.fail('The browser interrupted the voice before it could finish. Press Replay.');
        return;
      }
      this.fail(code === 'not-allowed'
        ? 'The browser blocked speech. Press Speak once more, and allow audio for this site.'
        : `The device voice stopped${code ? ` (${code})` : ''}. Press Replay.`);
    };
    utterance.onend = () => {
      if (id !== this.runId) return;
      this.clearTimer();
      this.current = null;
      this.speakNext(id);
    };

    this.current = utterance;
    this.armWatchdog(id, attempted);
    try {
      this.synthesis()?.speak(utterance);
    } catch (cause) {
      this.fail(`The device voice could not start: ${String((cause as Error)?.message ?? cause)}`);
    }
  }

  /**
   * `speak()` accepted but silent — the fourth Chromium failure.
   *
   * If the platform is neither speaking nor pending after the grace period, the sentence is issued
   * once more. Only a second silence is reported as an error, so a slow start is not called a failure.
   */
  private armWatchdog(id: number, attempted: number): void {
    this.schedule(this.startTimeout, () => {
      if (id !== this.runId || this.playback === 'speaking') return;
      const synth = this.synthesis();
      if (synth && (synth.speaking || synth.pending)) return;
      if (this.retries > 0) {
        this.fail('The device voice did not start. Check that a voice for this language is '
          + 'installed in your browser or system settings, then ask again.');
        return;
      }
      this.retries += 1;
      this.index = attempted;
      this.speakNext(id);
    });
  }

  private schedule(ms: number, run: () => void): void {
    this.clearTimer();
    if (typeof setTimeout !== 'function') {
      run();
      return;
    }
    const handle = setTimeout(() => {
      this.timer = 0;
      run();
    }, ms) as unknown as number;
    // Server-side (the test suite) must not be held open by a pending watchdog.
    (handle as unknown as { unref?: () => void })?.unref?.();
    this.timer = handle;
  }

  private clearTimer(): void {
    if (this.timer && typeof clearTimeout === 'function') clearTimeout(this.timer);
    this.timer = 0;
  }

  private finish(): void {
    this.clearTimer();
    this.current = null;
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
