/**
 * The device-local half of the voice health dashboard: read, record, clear.
 *
 * Deliberately a tiny localStorage shim around the pure module in `core/platform/voice-telemetry.ts`
 * — the rules (what counts, what a percentile is, what a broken record means) are testable there,
 * and this file only owns the storage key and the try/catch. A voice that cannot write telemetry
 * must still speak, so every function here swallows storage errors.
 */
import { VOICE_TELEMETRY_KEY } from '../platform/keys';
import {
  emptyVoiceTelemetry,
  parseVoiceTelemetry,
  recordVoiceAnswer,
  recordVoiceFailure,
  type VoiceEngineTag,
  type VoiceTelemetry,
} from '../platform/voice-telemetry';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readVoiceTelemetry(): VoiceTelemetry {
  const store = storage();
  if (!store) return emptyVoiceTelemetry();
  try {
    return parseVoiceTelemetry(store.getItem(VOICE_TELEMETRY_KEY));
  } catch {
    return emptyVoiceTelemetry();
  }
}

function write(state: VoiceTelemetry): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(VOICE_TELEMETRY_KEY, JSON.stringify(state));
  } catch {
    // Quota or a private-mode browser: losing a counter is acceptable, losing the answer is not.
  }
}

export function noteVoiceAnswer(engine: VoiceEngineTag, latencyMs?: number): void {
  write(recordVoiceAnswer(readVoiceTelemetry(), { engine, latencyMs }));
}

export function noteVoiceFailure(code: string): void {
  write(recordVoiceFailure(readVoiceTelemetry(), { code }));
}

export function clearVoiceTelemetry(): void {
  const store = storage();
  if (!store) return;
  try { store.removeItem(VOICE_TELEMETRY_KEY); } catch { /* nothing to clear */ }
}
