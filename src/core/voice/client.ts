/**
 * The page's handle on the voice worker.
 *
 * Small on purpose: one worker per page, one request in flight, and every state change reported to a
 * listener. The page never sees ONNX Runtime, a tensor or a model URL — only status events and
 * finished PCM.
 *
 * Failure is a state, not an exception thrown into the render tree: a model that cannot load reports
 * `phase: 'error'` with a code, and `Retry` calls `speak()` again, which retries the download and the
 * sessions. Nothing here ever falls back to the browser's own synthesiser.
 */
import { encodeWav } from './engine';
import { parseWorkerMessage, type VoicePhase, type VoiceStatus, type WorkerResponse } from './protocol';
import type { VoicePreset } from './assets';

export interface SpeakInput {
  text: string;
  lang: 'hi' | 'en';
  preset: VoicePreset;
  steps?: number;
  speed?: number;
}

export interface SpokenAudio {
  /** 44.1 kHz mono WAV, ready for `decodeAudioData`. */
  wav: ArrayBuffer;
  sampleRate: number;
  durationSeconds: number;
  synthMs: number;
}

type Listener = (status: VoiceStatus) => void;

export interface VoiceClient {
  status(): VoiceStatus;
  subscribe(listener: Listener): () => void;
  preload(): void;
  speak(input: SpeakInput): Promise<SpokenAudio>;
  cancel(): void;
  clearCache(): Promise<string[]>;
  dispose(): void;
}

interface Pending {
  resolve: (audio: SpokenAudio) => void;
  reject: (cause: Error) => void;
}

const INITIAL: VoiceStatus = { phase: 'idle', progress: 0, message: 'Voice ready to start' };

/**
 * Create the client, or `null` on a host without module workers (the Node test runner, an old
 * browser). `null` is a fact the caller can report, not a reason to speak with something else.
 */
export function createVoiceClient(): VoiceClient | null {
  if (typeof Worker === 'undefined' || typeof window === 'undefined') return null;

  let worker: Worker;
  try {
    worker = new Worker(new URL('../../workers/tts.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }

  let current: VoiceStatus = INITIAL;
  const listeners = new Set<Listener>();
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let activeId = 0;

  const publish = (status: VoiceStatus) => {
    current = status;
    for (const listener of listeners) {
      try {
        listener(status);
      } catch {
        /* a broken listener must not break the voice */
      }
    }
  };

  const settle = (id: number, error: Error | null, audio?: SpokenAudio) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (error) entry.reject(error);
    else if (audio) entry.resolve(audio);
  };

  worker.onmessage = (event: MessageEvent<unknown>) => {
    const message: WorkerResponse | null = parseWorkerMessage(event.data);
    if (!message) return;
    switch (message.type) {
      case 'status':
        publish(message.status);
        return;
      case 'audio': {
        const wav = encodeWav(new Float32Array(message.pcm), message.sampleRate);
        settle(message.id, null, {
          wav,
          sampleRate: message.sampleRate,
          durationSeconds: message.durationSeconds,
          synthMs: message.synthMs,
        });
        return;
      }
      case 'error':
        publish({
          ...current,
          phase: 'error' as VoicePhase,
          message: 'Supertonic 3 could not speak',
          code: message.code,
          detail: message.detail,
        });
        if (message.id !== undefined) settle(message.id, new Error(`${message.code}: ${message.detail}`));
        return;
      case 'cache-cleared':
        publish({ ...current, phase: 'idle', progress: 0, message: 'Voice cache cleared' });
        return;
      default:
        return;
    }
  };

  worker.onerror = (event) => {
    publish({ phase: 'error', progress: 0, message: 'Supertonic 3 could not load', code: 'worker', detail: String(event.message ?? 'The voice worker stopped.') });
  };

  return {
    status: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    preload() {
      worker.postMessage({ type: 'preload' });
    },
    speak(input) {
      const id = nextId++;
      activeId = id;
      // Chunks of the SAME answer arrive together, so a new `speak` must NOT reject the ones
      // already in flight — that turned every two-sentence answer into a failure on sentence one.
      // Superseding is `cancel()`'s job: Stop, a barge-in, or a new answer (the hook calls it).
      return new Promise<SpokenAudio>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({
          type: 'speak',
          id,
          text: input.text,
          lang: input.lang,
          preset: input.preset,
          steps: input.steps ?? 8,
          speed: input.speed ?? 1.05,
        });
      });
    },
    cancel() {
      activeId = 0;
      worker.postMessage({ type: 'cancel', id: 0 });
      for (const [id, entry] of pending) {
        pending.delete(id);
        entry.reject(new Error('cancelled'));
      }
    },
    clearCache() {
      worker.postMessage({ type: 'clear-cache' });
      return Promise.resolve([]);
    },
    dispose() {
      try {
        worker.terminate();
      } catch {
        /* already gone */
      }
      pending.clear();
      listeners.clear();
    },
  };
}

export { INITIAL as INITIAL_VOICE_STATUS };
export type { VoiceStatus, VoicePhase };
