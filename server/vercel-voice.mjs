/**
 * `GET /api/voice/status` and `POST /api/voice/tts`, as Vercel Functions.
 *
 * The production site is a static Vite build; the account API (`server/index.mjs`) is not deployed
 * there. These two functions are the smallest honest bridge: they expose the SAME contract the client
 * already calls, using the SAME engine selection as the account API (`server/voice-engine.mjs`), so a
 * deployment needs no separate API host.
 *
 * WHAT RUNS WHERE:
 *
 *  - A Vercel function cannot hold the Supertonic checkpoint: 398 MB of weights plus a 100 MB native
 *    ONNX Runtime is far past a serverless bundle, and a cold start that downloads the model would
 *    time out. So the function is a PROXY when `TTS_SERVICE_URL` points at `services/supertonic-tts/` (a
 *    container with the model), and a direct caller of Google Cloud TTS when only
 *    `GOOGLE_TTS_API_KEY` is set. With neither, it answers `engine: none` and the browser uses its
 *    own labelled voice; the checkpoint is never downloaded to the visitor.
 *  - Nothing secret is ever returned: the status body carries engine names and readiness only, and
 *    errors are sanitized. `TTS_SERVICE_SECRET` and the Google key stay in the function environment.
 *
 * ABUSE CONTROLS: these routes are anonymous by design (speech is not a learner record), exactly like
 * the account API's voice routes. They are therefore same-origin only and rate-limited per client.
 * Serverless instances do not share memory, so the limiter is best-effort per warm instance — it
 * stops a runaway tab, not a botnet. Vercel's own DDoS protection is the outer layer.
 */
import { createVoiceEngine, VOICE_LANGS, VOICE_MAX_CHARS } from './voice-engine.mjs';
import { voiceDiagnostics, VOICE_CODES } from './voice-diagnostics.mjs';

const MAX_BODY_BYTES = 16 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_REQUESTS = 30;
const LIMITER_MAX_KEYS = 5000;

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function json(response, status, body, extra = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.length),
    ...extra,
  });
  response.end(payload);
}

/** Fixed-window-ish limiter with a sliding window per key. Exported so the tests can shrink it. */
export function createLimiter({ windowMs = RATE_WINDOW_MS, max = RATE_MAX_REQUESTS, now = Date.now } = {}) {
  const hits = new Map();
  return {
    take(key) {
      const at = now();
      const recent = (hits.get(key) ?? []).filter((stamp) => at - stamp < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(at);
      hits.set(key, recent);
      if (hits.size > LIMITER_MAX_KEYS) {
        for (const [candidate, stamps] of hits) {
          if (!stamps.length || at - stamps[stamps.length - 1] >= windowMs) hits.delete(candidate);
        }
      }
      return true;
    },
  };
}

export function clientKey(request) {
  const forwarded = String(request.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return forwarded || request.socket?.remoteAddress || 'unknown';
}

/**
 * The origin this deployment answers on.
 *
 * `APP_ORIGIN` (or the existing `WEB_ORIGIN`) wins. Otherwise it is derived from the host Vercel
 * forwarded, so preview deployments work without a per-deployment variable. Never derived from the
 * request's `Origin` — that would make the check meaningless.
 */
export function originOf(request, env = process.env) {
  const configured = String(env.APP_ORIGIN ?? env.WEB_ORIGIN ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '').trim();
  if (!host) return '';
  const proto = String(request.headers['x-forwarded-proto'] ?? 'https').split(',')[0].trim() || 'https';
  return `${proto}://${host}`;
}

export function sameOrigin(request, env = process.env) {
  const origin = String(request.headers.origin ?? '').trim();
  const allowed = originOf(request, env);
  return Boolean(origin && allowed && origin === allowed);
}

/** The engine the account API would build, from the same environment variable names. */
export function engineFromEnv(env = process.env) {
  return createVoiceEngine({
    serviceUrl: env.TTS_SERVICE_URL ?? '',
    serviceSecret: env.TTS_SERVICE_SECRET ?? '',
    googleKey: env.GOOGLE_TTS_API_KEY ?? '',
    googleVoices: {
      'hi-IN': env.GOOGLE_TTS_VOICE_HI ?? '',
      'en-IN': env.GOOGLE_TTS_VOICE_EN ?? '',
    },
    serviceTimeoutMs: Number(env.TTS_SERVICE_TIMEOUT_MS ?? 20_000) || 20_000,
  });
}

/** Vercel pre-parses small JSON bodies; a direct call may hand us the stream instead. */
async function readBody(request) {
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body) && !(request.body instanceof Uint8Array)) {
    return request.body;
  }
  if (typeof request.body === 'string' || Buffer.isBuffer(request.body) || request.body instanceof Uint8Array) {
    const text = Buffer.from(request.body).toString('utf8');
    try { return text ? JSON.parse(text) : {}; } catch { const error = new Error('Send a valid JSON body.'); error.status = 400; throw error; }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('Send a valid JSON body.');
    error.status = 400;
    throw error;
  }
}

/**
 * One failure, one status, one code. The `code` is what the client can branch on (`VOICE_RATE_LIMITED`
 * is worth a retry, `VOICE_NOT_CONFIGURED` never is); the prose is what a person reads. Neither ever
 * carries an upstream body, a URL, a token or a stack trace.
 */
function errorCopy(response, cause) {
  const timeout = cause?.code === 'voice-timeout' || cause?.name === 'TimeoutError';
  switch (cause?.code) {
    case 'voice-bad-text':
      return json(response, 400, { code: VOICE_CODES.invalidRequest, error: 'Text is required and must be under the voice limit.' });
    case 'voice-bad-lang':
      return json(response, 400, { code: VOICE_CODES.invalidRequest, error: `Choose a supported voice language: ${VOICE_LANGS.join(', ')}.` });
    case 'voice-rate-limited':
      return json(response, 429, { code: VOICE_CODES.rateLimited, error: 'The AI voice is busy. Try again in a moment.' }, { 'Retry-After': '5' });
    case 'voice-unconfigured':
      return json(response, 503, {
        code: VOICE_CODES.notConfigured,
        error: 'No AI voice is configured on this deployment — the built-in browser voice still reads answers.',
      });
    case 'voice-auth-failed':
      // The service is reachable but refused this process: a rotated or mistyped shared secret.
      return json(response, 502, {
        code: VOICE_CODES.authFailed,
        error: 'The AI voice rejected this deployment\'s credentials. The browser voice reads answers meanwhile.',
      });
    case 'voice-invalid-audio':
      return json(response, 502, {
        code: VOICE_CODES.invalidAudio,
        error: 'The AI voice returned no playable audio. Please try again.',
      });
    default:
      if (timeout) {
        return json(response, 504, {
          code: VOICE_CODES.timeout,
          error: 'The AI voice took too long to answer. Please try again.',
        });
      }
      return json(response, 502, {
        code: VOICE_CODES.providerUnavailable,
        error: 'The AI voice is temporarily unavailable. Please try again.',
      });
  }
}

export function createStatusHandler({ engine = engineFromEnv() } = {}) {
  return async function statusHandler(request, response) {
    if (request.method !== 'GET') {
      return json(response, 405, { error: 'Use GET.' }, { Allow: 'GET' });
    }
    try {
      json(response, 200, await engine.status());
    } catch {
      json(response, 503, {
        configured: false,
        engine: 'none',
        engineLabel: 'no server voice',
        ready: false,
        langs: VOICE_LANGS,
        reason: 'The voice status is temporarily unavailable.',
      });
    }
  };
}

export function createTtsHandler({
  engine = engineFromEnv(),
  env = process.env,
  limiter = createLimiter(),
} = {}) {
  return async function ttsHandler(request, response) {
    if (request.method !== 'POST') {
      return json(response, 405, { error: 'Use POST.' }, { Allow: 'POST' });
    }
    // A browser same-origin POST always carries Origin; a foreign page's does too, with its own
    // origin. This is CSRF-shaped protection, not authentication.
    if (!sameOrigin(request, env)) {
      return json(response, 403, { code: VOICE_CODES.forbidden, error: 'Voice requests must come from the BroCode app.' });
    }
    if (!limiter.take(clientKey(request))) {
      return json(response, 429, { code: VOICE_CODES.rateLimited, error: 'Too many voice requests. Try again in a minute.' }, { 'Retry-After': '60' });
    }
    const type = String(request.headers['content-type'] ?? '').toLowerCase();
    if (!type.startsWith('application/json')) {
      return json(response, 415, { code: VOICE_CODES.invalidRequest, error: 'Send JSON using Content-Type: application/json.' });
    }

    let body;
    try {
      body = await readBody(request);
    } catch (cause) {
      return json(response, cause?.status ?? 400, {
        code: VOICE_CODES.invalidRequest,
        error: String(cause?.message ?? 'Send a valid JSON body.'),
      });
    }

    const text = String(body?.text ?? '');
    const lang = String(body?.lang ?? '');
    const rate = Number(body?.rate ?? 1);
    const clean = text.trim();
    if (!clean || clean.length > VOICE_MAX_CHARS) {
      return json(response, 400, { code: VOICE_CODES.invalidRequest, error: `Text must be 1–${VOICE_MAX_CHARS} characters.` });
    }

    try {
      const speech = await engine.speak({ text: text, lang, rate });
      if (!speech?.audio?.length) throw Object.assign(new Error('empty audio'), { code: 'voice-invalid-audio' });
      response.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': speech.contentType,
        'Content-Length': String(speech.audio.length),
        'X-Voice-Engine': speech.engine,
        ...(speech.sampleRate ? { 'X-Sample-Rate': String(speech.sampleRate) } : {}),
      });
      response.end(speech.audio);
    } catch (cause) {
      errorCopy(response, cause);
    }
  };
}

/**
 * `GET /api/voice/health` — the operator's answer, not the browser's.
 *
 * 200 when the engine that would speak is actually ready, 503 when it is not, and the body always
 * carries a sanitized `code` from `VOICE_CODES`, the presence of each variable (never its value) and
 * the next step. It force-probes the inference service, so `Retry` on a dashboard never reads a
 * cached negative.
 */
export function createHealthHandler({ engine = engineFromEnv(), env = process.env, logger = console } = {}) {
  return async function healthHandler(request, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json(response, 405, { error: 'Use GET.' }, { Allow: 'GET' });
    }
    const requestId = Math.random().toString(36).slice(2, 10);
    let report;
    try {
      report = await voiceDiagnostics({ env, engine });
    } catch {
      // A diagnostics route that throws is worse than useless: answer with the honest generic state.
      report = {
        ok: false,
        code: VOICE_CODES.providerUnavailable,
        engine: 'none',
        ready: false,
        verified: false,
        env: {},
        hints: [],
        detail: 'The voice diagnostics could not be collected on this instance.',
      };
    }
    // One line per check, ids and codes only: no text, no key, no URL with a token in it.
    if (!report.ok) logger.warn?.(`[voice-health ${requestId}] ${report.code} engine=${report.engine}`);
    json(response, report.ok ? 200 : 503, { requestId, ...report });
  };
}

export const VOICE_ROUTE_LIMITS = Object.freeze({ maxBodyBytes: MAX_BODY_BYTES, rateMax: RATE_MAX_REQUESTS });
