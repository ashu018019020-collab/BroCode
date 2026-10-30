/**
 * The contract between the page and the voice worker.
 *
 * Kept in one place, and pure, so the two ends cannot drift: the worker's `switch` and the client's
 * `onmessage` both read these types, and `parseWorkerMessage` is what the tests drive. A message that
 * does not fit is dropped rather than trusted — a worker is a separate realm, and its output is data,
 * not instructions.
 */
import type { VoicePreset } from './assets';

export type VoicePhase = 'idle' | 'downloading' | 'initializing' | 'ready' | 'speaking' | 'error';

/** What the panel shows. `progress` is bytes-downloaded / bytes-total while downloading. */
export interface VoiceStatus {
  phase: VoicePhase;
  progress: number;
  message: string;
  preset?: VoicePreset;
  code?: string;
  detail?: string;
}

export interface SpeakRequest {
  type: 'speak';
  id: number;
  text: string;
  lang: 'hi' | 'en';
  preset: VoicePreset;
  steps: number;
  speed: number;
}

export type WorkerRequest =
  | { type: 'preload' }
  | { type: 'cancel'; id: number }
  | { type: 'clear-cache' }
  | SpeakRequest;

export type WorkerResponse =
  | { type: 'status'; status: VoiceStatus }
  | { type: 'audio'; id: number; pcm: ArrayBuffer; sampleRate: number; durationSeconds: number; synthMs: number }
  | { type: 'error'; id?: number; code: string; detail: string }
  | { type: 'cache-cleared'; caches: string[] };

const PHASES: readonly VoicePhase[] = ['idle', 'downloading', 'initializing', 'ready', 'speaking', 'error'];

/** Narrow an untrusted message. Returns `null` for anything that is not one of ours. */
export function parseWorkerMessage(input: unknown): WorkerResponse | null {
  if (!input || typeof input !== 'object') return null;
  const message = input as Record<string, unknown>;
  switch (message.type) {
    case 'status': {
      const status = message.status as Record<string, unknown> | undefined;
      if (!status || !PHASES.includes(status.phase as VoicePhase)) return null;
      return {
        type: 'status',
        status: {
          phase: status.phase as VoicePhase,
          progress: clamp01(Number(status.progress ?? 0)),
          message: String(status.message ?? ''),
          preset: typeof status.preset === 'string' ? (status.preset as VoicePreset) : undefined,
          code: typeof status.code === 'string' ? status.code : undefined,
          detail: typeof status.detail === 'string' ? status.detail : undefined,
        },
      };
    }
    case 'audio': {
      if (!(message.pcm instanceof ArrayBuffer) || !message.pcm.byteLength) return null;
      return {
        type: 'audio',
        id: Number(message.id ?? 0),
        pcm: message.pcm,
        sampleRate: Number(message.sampleRate ?? 44100) || 44100,
        durationSeconds: Number(message.durationSeconds ?? 0) || 0,
        synthMs: Number(message.synthMs ?? 0) || 0,
      };
    }
    case 'error':
      return {
        type: 'error',
        id: message.id === undefined ? undefined : Number(message.id),
        code: String(message.code ?? 'voice-error'),
        detail: String(message.detail ?? 'The voice could not speak.'),
      };
    case 'cache-cleared':
      return { type: 'cache-cleared', caches: Array.isArray(message.caches) ? message.caches.map(String) : [] };
    default:
      return null;
  }
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** The copy the panel shows. One owner, so the worker and the page cannot describe the same state differently. */
export const PHASE_COPY: Record<VoicePhase, string> = {
  idle: 'Voice ready to start',
  downloading: 'Downloading Supertonic 3…',
  initializing: 'Initializing Supertonic 3…',
  ready: 'Supertonic 3 ready',
  speaking: 'AI Mentor is speaking',
  error: 'Supertonic 3 could not load',
};
