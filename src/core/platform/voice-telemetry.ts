/**
 * The numbers behind the voice health dashboard, as a pure value.
 *
 * WHY THIS IS CLIENT-SIDE. The production voice path is two Vercel Functions, and each function runs
 * in its own isolate: counters kept in `api/voice/tts.js` are invisible to any other route, so a
 * "server-wide" total written there would be a number that looks authoritative and means nothing.
 * This browser is the only place that really knows which engine spoke, how long the audio took to
 * arrive and whether the answer fell back — so that is what it records, and the dashboard says
 * "this browser" next to every count it shows.
 *
 * Pure on purpose (`src/core/platform/**` may not import React or the store): the caller passes the
 * storage away, and every function returns a new value, so `node --test` can drive it with fixtures.
 */

export type VoiceEngineTag = 'supertonic' | 'google' | 'browser';

export interface VoiceTelemetry {
  version: 1;
  /** Answers actually spoken, by the engine that produced the audio. */
  answers: Record<VoiceEngineTag, number>;
  /** Failures by short code (`tts-503`, `tts-network`, `mic`, …) — never a message with content. */
  failures: Record<string, number>;
  /** Round-trip milliseconds for the requests that produced audio, newest last, capped. */
  latencyMs: number[];
  /** Epoch ms of the last recorded event, or null. */
  lastAt: number | null;
}

/** Enough for a stable p95 without letting localStorage grow forever. */
export const VOICE_LATENCY_SAMPLES = 40;
/** A failure code is a short token; anything longer is truncated instead of stored. */
const MAX_CODE = 24;

export function emptyVoiceTelemetry(): VoiceTelemetry {
  return {
    version: 1,
    answers: { supertonic: 0, google: 0, browser: 0 },
    failures: {},
    latencyMs: [],
    lastAt: null,
  };
}

/**
 * Tolerate anything that comes back from localStorage — another version, a truncated write, a user
 * with an old shape. A broken record must never stop the voice from working.
 */
export function parseVoiceTelemetry(raw: unknown): VoiceTelemetry {
  const base = emptyVoiceTelemetry();
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return base; }
  }
  if (!value || typeof value !== 'object') return base;
  const record = value as Partial<VoiceTelemetry>;
  if (record.version !== 1) return base;
  const count = (input: unknown): number => {
    const number = Number(input);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  };
  const telemetry = emptyVoiceTelemetry();
  for (const engine of ['supertonic', 'google', 'browser'] as VoiceEngineTag[]) {
    telemetry.answers[engine] = count(record.answers?.[engine]);
  }
  if (record.failures && typeof record.failures === 'object') {
    for (const [code, value2] of Object.entries(record.failures)) {
      const n = count(value2);
      if (n > 0 && code) telemetry.failures[String(code).slice(0, MAX_CODE)] = n;
    }
  }
  if (Array.isArray(record.latencyMs)) {
    telemetry.latencyMs = record.latencyMs
      // `Number(null)` is 0, so a `NaN` that round-tripped through JSON must be dropped explicitly
      // — otherwise a corrupt sample becomes a suspiciously fast zero.
      .filter((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 600_000)
      .slice(-VOICE_LATENCY_SAMPLES);
  }
  const lastAt = Number(record.lastAt);
  telemetry.lastAt = Number.isFinite(lastAt) && lastAt > 0 ? lastAt : null;
  return telemetry;
}

function stamp(at?: number): number {
  const value = Number(at);
  return Number.isFinite(value) && value > 0 ? value : Date.now();
}

/** One spoken answer. `latencyMs` is the round trip that produced its audio, not the whole answer. */
export function recordVoiceAnswer(
  state: VoiceTelemetry,
  { engine, latencyMs, at }: { engine: VoiceEngineTag; latencyMs?: number; at?: number },
): VoiceTelemetry {
  const next: VoiceTelemetry = {
    ...state,
    answers: { ...state.answers, [engine]: (state.answers[engine] ?? 0) + 1 },
    latencyMs: state.latencyMs.slice(),
    lastAt: stamp(at),
  };
  const ms = Number(latencyMs);
  if (Number.isFinite(ms) && ms >= 0 && ms < 600_000) {
    next.latencyMs = [...next.latencyMs, Math.round(ms)].slice(-VOICE_LATENCY_SAMPLES);
  }
  return next;
}

/** One failure. The code is a category, never text from the answer or from a provider body. */
export function recordVoiceFailure(
  state: VoiceTelemetry,
  { code, at }: { code: string; at?: number },
): VoiceTelemetry {
  const key = String(code ?? '').trim().slice(0, MAX_CODE) || 'unknown';
  return {
    ...state,
    failures: { ...state.failures, [key]: (state.failures[key] ?? 0) + 1 },
    lastAt: stamp(at),
  };
}

/** Nearest-rank percentile over a copy, so the stored order is never disturbed. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? null;
}

export interface VoiceTelemetrySummary {
  /** Answers spoken in this browser. */
  total: number;
  byEngine: Record<VoiceEngineTag, number>;
  /** 0…1, or null when nothing has been spoken yet — never a fake zero. */
  browserShare: number | null;
  serverShare: number | null;
  failureTotal: number;
  failures: { code: string; count: number }[];
  p50: number | null;
  p95: number | null;
  samples: number;
  lastAt: number | null;
}

export function summarizeVoiceTelemetry(state: VoiceTelemetry): VoiceTelemetrySummary {
  const total = state.answers.supertonic + state.answers.google + state.answers.browser;
  const failureTotal = Object.values(state.failures).reduce((sum, n) => sum + n, 0);
  return {
    total,
    byEngine: { ...state.answers },
    browserShare: total ? state.answers.browser / total : null,
    serverShare: total ? (state.answers.supertonic + state.answers.google) / total : null,
    failureTotal,
    failures: Object.entries(state.failures)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    p50: percentile(state.latencyMs, 50),
    p95: percentile(state.latencyMs, 95),
    samples: state.latencyMs.length,
    lastAt: state.lastAt,
  };
}
