/**
 * The realtime voice routes as serverless handlers.
 *
 * On the static site the account API (`server/app.mjs`) is not the process that answers, so the
 * browser's own status probe used to hit a 404. These handlers are the same contract over the same
 * tested engine (`server/realtime.mjs`): a boolean status with no key, and a signed-in, same-origin,
 * budgeted request for a short-lived client secret. The permanent OpenAI key never leaves the host.
 *
 * `api/voice/realtime/status.js` and `api/voice/realtime/session.js` are thin wrappers; the logic
 * lives here so it can be tested with fake requests and an injected secret factory.
 */
import {
  REALTIME_MAX_SESSION_SECONDS,
  createRealtimeClientSecret,
  validateRealtimeSessionBody,
} from './realtime.mjs';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** Six sessions per ten minutes, per account AND address — the same budget as the Node API. */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 6;

function envFlag(value, fallback) {
  if (value === undefined || String(value).trim() === '') return fallback;
  return !/^(0|false|off|no)$/i.test(String(value).trim());
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

/** `res.status().json()` on the edge runtime, `res.writeHead()` in Node — support both. */
function sendJson(response, status, body) {
  if (typeof response.status === 'function' && typeof response.json === 'function') {
    response.status(status).json(body);
    return;
  }
  json(response, status, body);
}

function requestHost(request) {
  return String(request.headers?.['x-forwarded-host'] ?? request.headers?.host ?? '').trim();
}

/**
 * A POST from another site is refused. `APP_ORIGIN` wins when the deployment sets it; otherwise the
 * Origin host must equal the host that served the request, so a preview URL works without config
 * while a cross-site page still cannot spend the owner's key.
 */
function isSameOrigin(request, env) {
  const origin = request.headers?.origin;
  if (!origin) return false;
  const allowed = String(env.APP_ORIGIN ?? '').trim();
  if (allowed) return origin === allowed;
  try {
    return new URL(origin).host === requestHost(request);
  } catch {
    return false;
  }
}

function clientAddress(request) {
  const forwarded = String(request.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim();
  return forwarded || request.socket?.remoteAddress || 'unknown';
}

/** Vercel parses JSON itself; a raw stream (the local `node` harness) is read here. */
async function readBody(request) {
  const body = request.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Verify a Supabase access token against Supabase itself — never decode and trust it locally.
 * A missing token, a missing deployment URL/key or a rejected token all return null; the caller
 * turns that into one honest 401 rather than leaking which piece was absent.
 */
export async function verifySupabaseUser(request, env = process.env) {
  const token = String(request.headers?.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  const url = String(env.SUPABASE_URL ?? '').trim();
  const key = String(env.SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  if (!token || !url || !key) return null;
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const user = await response.json();
    return user && typeof user.id === 'string' && user.id ? user : null;
  } catch {
    return null;
  }
}

/** `GET /api/voice/realtime/status` — public, booleans only, never the key. */
export function createRealtimeStatusHandler(env = process.env) {
  return async function realtimeStatusHandler(request, response) {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    if (request.method !== 'GET') {
      sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Use GET.' });
      return;
    }
    sendJson(response, 200, {
      configured: Boolean(String(env.OPENAI_API_KEY ?? '').trim()),
      enabled: envFlag(env.ONLINE_VOICE_ENABLED, true),
    });
  };
}

/**
 * `POST /api/voice/realtime/session` — a short-lived secret for one live voice session.
 *
 * The deployment switch is checked before anything paid, the account is verified by Supabase, the
 * body is validated (language and explicit consent) before the budget is spent, and only then is
 * OpenAI called. A failure carries a code the client can tell apart from a microphone failure.
 */
export function createRealtimeSessionHandler({
  env = process.env,
  verifyUser = (request) => verifySupabaseUser(request, env),
  createSecret = createRealtimeClientSecret,
  now = Date.now,
  logger = console,
} = {}) {
  const hits = new Map();

  function allowed(clientKey) {
    const at = now();
    const recent = (hits.get(clientKey) ?? []).filter((stamp) => at - stamp < WINDOW_MS);
    if (hits.size > 5000) {
      for (const [key, stamps] of hits) {
        if (!stamps.length || at - stamps[stamps.length - 1] >= WINDOW_MS) hits.delete(key);
      }
    }
    if (recent.length >= MAX_REQUESTS) {
      hits.set(clientKey, recent);
      return false;
    }
    recent.push(at);
    hits.set(clientKey, recent);
    return true;
  }

  return async function realtimeSessionHandler(request, response) {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' });
      return;
    }
    if (!isSameOrigin(request, env)) {
      sendJson(response, 403, {
        code: 'ORIGIN_NOT_ALLOWED',
        message: 'This endpoint only answers its own site.',
      });
      return;
    }
    if (!envFlag(env.ONLINE_VOICE_ENABLED, true)) {
      sendJson(response, 503, {
        code: 'ONLINE_VOICE_DISABLED',
        message: 'Online AI voice is disabled on this server. The browser voice stays available.',
      });
      return;
    }

    let user = null;
    try {
      user = await verifyUser(request);
    } catch {
      user = null;
    }
    if (!user) {
      sendJson(response, 401, { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' });
      return;
    }

    const apiKey = String(env.OPENAI_API_KEY ?? '').trim();
    if (!apiKey) {
      sendJson(response, 503, {
        code: 'REALTIME_UNCONFIGURED',
        message: 'Realtime voice is not configured on this server. The browser voice is used instead.',
      });
      return;
    }

    const input = await readBody(request);
    const check = validateRealtimeSessionBody(input);
    if (!check.ok) {
      sendJson(response, check.status, { code: 'INVALID_SESSION', message: check.message });
      return;
    }

    const clientKey = `${user.id}:${clientAddress(request)}`;
    if (!allowed(clientKey)) {
      sendJson(response, 429, {
        code: 'REALTIME_RATE_LIMITED',
        message: 'Too many realtime voice sessions. Try again in a few minutes.',
      });
      return;
    }

    try {
      const secret = await createSecret({
        apiKey,
        lang: check.lang,
        model: env.OPENAI_REALTIME_MODEL || undefined,
        voice: env.OPENAI_REALTIME_VOICE || undefined,
      });
      sendJson(response, 200, {
        clientSecret: secret.value,
        expiresAt: secret.expiresAt,
        model: secret.model,
        voice: secret.voice,
        maxSessionSeconds: secret.maxSessionSeconds ?? REALTIME_MAX_SESSION_SECONDS,
      });
    } catch (error) {
      if (error?.code === 'realtime-rate-limited') {
        sendJson(response, 429, {
          code: 'REALTIME_PROVIDER_RATE_LIMITED',
          message: 'The realtime voice service is rate-limited. Try again in a moment.',
        });
        return;
      }
      if (error?.code === 'realtime-bad-lang') {
        sendJson(response, 400, { code: 'REALTIME_BAD_LANG', message: 'That realtime language is not supported.' });
        return;
      }
      if (error?.code === 'realtime-unconfigured') {
        sendJson(response, 503, {
          code: 'REALTIME_UNCONFIGURED',
          message: 'Realtime voice is not configured on this server. The browser voice is used instead.',
        });
        return;
      }
      logger.warn?.('Realtime voice request failed.', error?.code ?? error?.name ?? 'unknown');
      sendJson(response, 502, {
        code: 'REALTIME_UNAVAILABLE',
        message: 'The realtime voice service is unavailable. The browser voice is used instead.',
      });
    }
  };
}
