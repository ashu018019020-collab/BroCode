/**
 * The voice routes as serverless handlers.
 *
 * The site is a static bundle on a host that runs one function per route, so `server/app.mjs` is not
 * the process that answers there. These handlers are the same contract over the same engine
 * (`server/tts.mjs`): same-origin only, a per-address budget, the key read from the host's
 * environment, and MP3 back. Nothing here downloads a model — the provider is an HTTPS call.
 *
 * `api/voice/status.js` and `api/voice/tts.js` are three-line wrappers; keeping the logic here means
 * one place to test and one place to change.
 */

import {
  TTS_DEFAULT_TIMEOUT_MS, TTS_LANGS, TTS_MAX_CHARS, TtsError, createTtsEngine, voiceOverrides,
} from './tts.mjs';

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** One engine per warm instance: the key is read once from the host environment, never per request. */
export function createEngine(env = process.env) {
  return createTtsEngine({
    key: env.AZURE_SPEECH_KEY ?? '',
    region: env.AZURE_SPEECH_REGION ?? '',
    voices: voiceOverrides({ hi: env.AZURE_SPEECH_VOICE_HI, en: env.AZURE_SPEECH_VOICE_EN }),
    timeoutMs: Math.min(60_000, Math.max(1_000, Number(env.AZURE_SPEECH_TIMEOUT_MS) || TTS_DEFAULT_TIMEOUT_MS)),
    logger: console,
  });
}

/** Vercel puts the caller's address first in `x-forwarded-for`; the socket is the fallback. */
function clientKey(request) {
  const forwarded = String(request.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim();
  return forwarded || request.socket?.remoteAddress || 'unknown';
}

/**
 * A POST from another site is refused. `Origin` must be present and its host must be this
 * deployment's host, which is what stops a random page from spending the owner's characters.
 */
function isSameOrigin(request) {
  const origin = request.headers?.origin;
  const host = request.headers?.['x-forwarded-host'] ?? request.headers?.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === String(host);
  } catch {
    return false;
  }
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

function sendError(response, error) {
  const status = error instanceof TtsError ? error.status : 500;
  const message = error instanceof TtsError ? error.message : 'The voice could not be generated.';
  const code = error instanceof TtsError ? error.code : 'TTS_INTERNAL';
  sendJson(response, status, { code, message });
}

/** Vercel parses a JSON body itself; a raw stream (local `node` harness) is read here. */
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

export function createStatusHandler(engine = createEngine()) {
  return async function statusHandler(request, response) {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    if (request.method !== 'GET') {
      sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Use GET.' });
      return;
    }
    // Public by design: a learner's UI needs to label its own controls before anyone speaks. The
    // payload is an engine name and voice ids — never the key and never the region's credentials.
    sendJson(response, 200, engine.status());
  };
}

export function createTtsHandler(engine = createEngine()) {
  const hits = new Map();

  function allowed(key) {
    const at = Date.now();
    if (hits.size > 2000) {
      for (const [address, stamps] of hits) {
        if (!stamps.length || at - stamps[stamps.length - 1] >= WINDOW_MS) hits.delete(address);
      }
    }
    const recent = (hits.get(key) ?? []).filter((stamp) => at - stamp < WINDOW_MS);
    if (recent.length >= MAX_REQUESTS) {
      hits.set(key, recent);
      return false;
    }
    recent.push(at);
    hits.set(key, recent);
    return true;
  }

  return async function ttsHandler(request, response) {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' });
      return;
    }
    if (!isSameOrigin(request)) {
      sendJson(response, 403, { code: 'ORIGIN_NOT_ALLOWED', message: 'This endpoint only answers its own site.' });
      return;
    }
    if (!allowed(clientKey(request))) {
      sendJson(response, 429, { code: 'TTS_RATE_LIMITED', message: 'Too many voice requests in the last minute. Try again shortly.' });
      return;
    }

    const input = await readBody(request);
    const text = typeof input?.text === 'string' ? input.text.trim() : '';
    if (!text) {
      sendJson(response, 400, { code: 'TTS_TEXT_EMPTY', message: 'Text is required.' });
      return;
    }
    if (text.length > TTS_MAX_CHARS) {
      sendJson(response, 400, { code: 'TTS_TEXT_TOO_LONG', message: `Text must be at most ${TTS_MAX_CHARS} characters.` });
      return;
    }
    if (!TTS_LANGS.includes(input?.lang)) {
      sendJson(response, 400, { code: 'TTS_LANG_UNSUPPORTED', message: `Choose one of these voice languages: ${TTS_LANGS.join(', ')}.` });
      return;
    }

    try {
      const speech = await engine.synthesize({ text, lang: input.lang, rate: input?.rate });
      const body = Buffer.from(speech.audio);
      response.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': speech.contentType,
        'Content-Length': body.byteLength,
        'Cache-Control': 'private, no-store',
        'X-Voice-Id': speech.voice,
        'X-Voice-Lang': speech.lang,
      });
      response.end(body);
    } catch (error) {
      sendError(response, error);
    }
  };
}
