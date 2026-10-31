/**
 * The browser's only door to the voice: two same-origin routes on the deployment.
 *
 *   GET  ./api/voice/status  → is there a voice, is it ready, which presets does it have
 *   POST ./api/voice/tts     → { text, lang, rate, voice } → audio/wav
 *
 * Both are Vercel Functions (`api/voice/*.js`) that run the shared engine in
 * `server/voice-engine.mjs`. That process holds the inference service's URL and its shared secret
 * and talks to the Python Supertonic service — so no secret, no service URL and no model ever
 * reaches this file. The browser posts text and gets bytes back.
 *
 * Failure is a typed value (`VoiceFailure`), not a thrown-and-forgotten error: the hook needs to know
 * whether to offer Retry (`voice-unavailable`, `voice-timeout`) or to stop telling the learner to
 * press it again (`voice-unconfigured`, `voice-auth-failed` are configuration faults that no press
 * can fix).
 */

/** The two language ids the deployment speaks, and the ids the UI stores. */
export type VoiceLangId = 'en-IN' | 'hi-IN';

export type VoiceEngineId = 'supertonic' | 'google' | 'none';

export interface ServerVoiceStatus {
  /** A voice exists AND answered ready. */
  configured: boolean;
  ready: boolean;
  engine: VoiceEngineId;
  engineLabel: string;
  /** Why it is not ready, in the deployment's own words. `null` when ready. */
  reason: string | null;
  /** The presets the backend really offers (`F1`…), when it reports them. */
  voices: string[];
}

export type VoiceFailureCode =
  | 'voice-unconfigured'
  | 'voice-rate-limited'
  | 'voice-auth-failed'
  | 'voice-timeout'
  | 'voice-unavailable'
  | 'voice-invalid-audio'
  | 'voice-bad-request'
  | 'voice-offline'
  | 'voice-aborted';

/** One failed voice call. `retryable` is the difference between "try again" and "this needs a fix". */
export class VoiceFailure extends Error {
  readonly code: VoiceFailureCode;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(code: VoiceFailureCode, message: string, { retryable, status = null }: { retryable: boolean; status?: number | null }) {
    super(message);
    this.name = 'VoiceFailure';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

const FAILURE_COPY: Record<VoiceFailureCode, { message: string; retryable: boolean }> = {
  'voice-unconfigured': {
    message: 'This deployment has no AI voice configured, so nothing was spoken. The answer stays on screen.',
    retryable: false,
  },
  'voice-rate-limited': {
    message: 'The AI voice is busy with too many requests. Wait a few seconds and press Speak again.',
    retryable: true,
  },
  'voice-auth-failed': {
    // A rotated or mismatched shared secret: the learner cannot fix this by pressing Retry.
    message: 'The AI voice rejected this deployment, so nothing was spoken. The server needs its voice secret fixed.',
    retryable: false,
  },
  'voice-timeout': {
    message: 'The AI voice took too long to answer. Press Speak again — the next try usually lands.',
    retryable: true,
  },
  'voice-unavailable': {
    message: 'The AI voice is temporarily unavailable. Press Speak again in a moment.',
    retryable: true,
  },
  'voice-invalid-audio': {
    message: 'The AI voice returned something this browser could not play. Press Speak again.',
    retryable: true,
  },
  'voice-bad-request': {
    message: 'The AI voice refused that text. Try a shorter answer or a different language.',
    retryable: false,
  },
  'voice-offline': {
    message: 'This device is offline, so the AI voice cannot be reached. Reconnect and press Speak again.',
    retryable: true,
  },
  'voice-aborted': {
    message: 'Voice request cancelled.',
    retryable: false,
  },
};

export function voiceFailure(code: VoiceFailureCode, status: number | null = null): VoiceFailure {
  const copy = FAILURE_COPY[code];
  return new VoiceFailure(code, copy.message, { retryable: copy.retryable, status });
}

/** The route's status code and body → the code the UI branches on. */
export function failureForResponse(status: number, body?: unknown): VoiceFailure {
  const reported = typeof body === 'object' && body !== null ? String((body as { code?: unknown }).code ?? '') : '';
  if (reported === 'VOICE_RATE_LIMITED' || status === 429) return voiceFailure('voice-rate-limited', status);
  if (reported === 'VOICE_AUTH_FAILED') return voiceFailure('voice-auth-failed', status);
  if (reported === 'VOICE_NOT_CONFIGURED' || reported === 'VOICE_UNCONFIGURED') return voiceFailure('voice-unconfigured', status);
  if (reported === 'VOICE_TIMEOUT' || status === 504 || status === 408) return voiceFailure('voice-timeout', status);
  if (reported === 'VOICE_INVALID_AUDIO') return voiceFailure('voice-invalid-audio', status);
  if (status === 400 || status === 413 || status === 415) return voiceFailure('voice-bad-request', status);
  if (status === 401 || status === 403) return voiceFailure('voice-auth-failed', status);
  return voiceFailure('voice-unavailable', status);
}

/**
 * The `/api/voice/status` body, made safe.
 *
 * The route is trusted (same origin, our own code) but a proxy or a stale deployment can answer with
 * HTML or `{}`; a wrong shape must read as "no voice" rather than crash the panel.
 */
export function parseVoiceStatus(input: unknown): ServerVoiceStatus {
  const body = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const engine = body.engine === 'supertonic' || body.engine === 'google' ? body.engine : 'none';
  const ready = body.ready === true && engine !== 'none';
  return {
    configured: body.configured === true && engine !== 'none',
    ready,
    engine,
    engineLabel: typeof body.engineLabel === 'string' ? body.engineLabel : engine === 'none' ? 'no server voice' : engine,
    reason: ready ? null : typeof body.reason === 'string' && body.reason ? body.reason : 'The AI voice is not ready.',
    voices: Array.isArray(body.voices) ? body.voices.filter((name): name is string => typeof name === 'string') : [],
  };
}

export interface SpeakInput {
  text: string;
  lang: VoiceLangId;
  /** 1 = the model's own pace. The service clamps to 0.5–2. */
  rate: number;
  /** `F1`…`M5`. Omitted means the service's configured default. */
  voice?: string;
  signal?: AbortSignal;
}

export interface SpokenAudio {
  /** A complete WAV file, ready for `decodeAudioData`. */
  wav: ArrayBuffer;
  engine: 'supertonic' | 'google';
  sampleRate: number | null;
}

export interface ServerVoice {
  status(signal?: AbortSignal): Promise<ServerVoiceStatus>;
  speak(input: SpeakInput): Promise<SpokenAudio>;
}

/** Vercel serves `api/` from the site root; a relative path keeps previews and production identical. */
export const VOICE_BASE = './api/voice';

/**
 * A bounded request.
 *
 * `AbortSignal.timeout` alone would lose the caller's own cancellation (Stop, navigation), so the
 * two are combined by hand and the listener is removed on every exit — a leaking listener on a
 * long-lived `AbortController` is how a page ends up aborting requests it no longer owns.
 */
function bounded(signal: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

export function createServerVoice({
  base = VOICE_BASE,
  fetchImpl = (...args: Parameters<typeof fetch>) => fetch(...args),
  statusTimeoutMs = 8000,
  speakTimeoutMs = 45_000,
}: {
  base?: string;
  fetchImpl?: typeof fetch;
  statusTimeoutMs?: number;
  speakTimeoutMs?: number;
} = {}): ServerVoice {
  const root = String(base).replace(/\/+$/, '');
  const statusPath = `${root}/status`;
  const speakPath = `${root}/tts`;

  return {
    async status(signal) {
      const gate = bounded(signal, statusTimeoutMs);
      try {
        const response = await fetchImpl(statusPath, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: gate.signal,
          cache: 'no-store',
        });
        // A 503 from the status route is a real answer (no voice / not ready), not a transport error.
        const body = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 503) return parseVoiceStatus({ engine: 'none', reason: `status answered HTTP ${response.status}` });
        return parseVoiceStatus(body);
      } catch (cause) {
        if (signal?.aborted) throw voiceFailure('voice-aborted');
        if (gate.timedOut()) throw voiceFailure('voice-timeout');
        throw voiceFailure('voice-offline');
      } finally {
        gate.dispose();
      }
    },

    async speak({ text, lang, rate, voice, signal }) {
      const clean = String(text ?? '').trim();
      if (!clean) throw voiceFailure('voice-bad-request');
      if (lang !== 'en-IN' && lang !== 'hi-IN') throw voiceFailure('voice-bad-request');
      const gate = bounded(signal, speakTimeoutMs);
      try {
        const response = await fetchImpl(speakPath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
          body: JSON.stringify({ text: clean, lang, rate, ...(voice ? { voice } : {}) }),
          signal: gate.signal,
          cache: 'no-store',
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw failureForResponse(response.status, body);
        }
        const type = String(response.headers.get('content-type') ?? '');
        if (!type.startsWith('audio/')) {
          // A 200 with JSON or an HTML error page: the bytes are not playable, so say that instead
          // of handing `decodeAudioData` something that will throw an opaque DOMException.
          throw voiceFailure('voice-invalid-audio', response.status);
        }
        const wav = await response.arrayBuffer();
        if (!wav.byteLength) throw voiceFailure('voice-invalid-audio', response.status);
        const engine = response.headers.get('x-voice-engine') === 'google' ? 'google' : 'supertonic';
        const reported = Number(response.headers.get('x-sample-rate') ?? 0);
        return { wav, engine, sampleRate: Number.isFinite(reported) && reported > 0 ? reported : null };
      } catch (cause) {
        if (cause instanceof VoiceFailure) throw cause;
        if (signal?.aborted) throw voiceFailure('voice-aborted');
        if (gate.timedOut()) throw voiceFailure('voice-timeout');
        throw voiceFailure('voice-offline');
      } finally {
        gate.dispose();
      }
    },
  };
}
