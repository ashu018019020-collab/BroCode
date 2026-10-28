/**
 * The BroCode voice service — Supertonic 3, server-side, on CPU.
 *
 * A separate process from the account API on purpose. Running the model needs ~400 MB of weights
 * resident, a Node with native ONNX Runtime, and an execution window measured in seconds; a
 * serverless frontend host offers none of those. So the website (and the account API) talk to this
 * over one authenticated HTTP endpoint, and this process can live on any container host.
 *
 *   GET  /healthz   → readiness, model revision, style, sample rate
 *   POST /v1/tts    → { text, lang, rate } → audio/wav
 *
 * Auth is a shared bearer token (`TTS_SERVICE_SECRET`). The browser never talks to this service and
 * never sees the token: only the account API proxies to it, keeping CORS, rate limits and abuse
 * control in one place. If the token is unset the service refuses to start rather than running open.
 *
 *   PORT=8080 TTS_SERVICE_SECRET=... node voice-service/server.mjs
 */
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { supertonicStatus, synthesizeServerSpeech, warmSupertonic } from '../server/supertonic-tts.mjs';
import { downloadModel, modelDirFromEnv } from '../scripts/voice-model.mjs';

const PORT = Number(process.env.PORT ?? process.env.TTS_PORT ?? 8080);
const SECRET = String(process.env.TTS_SERVICE_SECRET ?? '').trim();
const MAX_BODY_BYTES = 8 * 1024;
const MAX_CHARS = Number(process.env.TTS_MAX_CHARS ?? 1200) || 1200;
const AUTO_FETCH = !/^(0|false|off|no)$/i.test(String(process.env.SUPERTONIC_AUTO_FETCH ?? '1'));
const STYLE = String(process.env.SUPERTONIC_STYLE ?? 'F1').trim() || 'F1';
const STEPS = Number(process.env.SUPERTONIC_STEPS ?? 0) || undefined;
const MODEL_DIR = modelDirFromEnv();

if (!SECRET) {
  console.error('TTS_SERVICE_SECRET is required: this service must not run unauthenticated.');
  process.exit(1);
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('PORT must be a valid TCP port.');
  process.exit(1);
}

/** Constant-time compare that does not leak length through an early return. */
function tokenMatches(header) {
  const presented = String(header ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(presented);
  const b = Buffer.from(SECRET);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function json(response, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(payload);
}

async function readBody(request) {
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
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be JSON.');
    error.status = 400;
    throw error;
  }
}

/** Boot the model in the background so the port answers (and reports `loading`) immediately. */
async function boot() {
  try {
    if (AUTO_FETCH) await downloadModel({ dir: MODEL_DIR, logger: console });
    const status = await warmSupertonic({ modelDir: MODEL_DIR, styleId: STYLE, steps: STEPS });
    console.log(`Supertonic 3 ready · ${status.modelDir} · ${(status.weightsBytes / 1e6).toFixed(0)} MB · `
      + `${status.sampleRate} Hz · style ${status.styleId} · ${status.steps} steps`);
  } catch (cause) {
    console.error('Supertonic 3 failed to load.', cause?.message ?? cause);
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (request.method === 'GET' && url.pathname === '/healthz') {
      const status = supertonicStatus();
      // Unauthenticated on purpose for liveness probes, but it names nothing sensitive: no path with
      // credentials, no model bytes, no configuration values.
      json(response, status.ready ? 200 : 503, {
        ok: status.ready,
        ready: status.ready,
        engine: 'supertonic',
        phase: status.phase,
        error: status.error,
        sampleRate: status.sampleRate,
        steps: status.steps,
        style: status.styleId,
        node: status.node,
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/v1/tts') {
      if (!tokenMatches(request.headers.authorization)) {
        json(response, 401, { error: 'Unauthorized.' });
        return;
      }
      if (!supertonicStatus().ready) {
        const status = supertonicStatus();
        json(response, 503, {
          error: status.error ?? 'The voice model is still loading.',
          code: 'voice-loading',
        });
        return;
      }
      const body = await readBody(request);
      const text = typeof body?.text === 'string' ? body.text.trim() : '';
      const lang = body?.lang === 'hi-IN' ? 'hi-IN' : body?.lang === 'en-IN' ? 'en-IN' : null;
      if (!text) {
        json(response, 400, { error: 'Text is required.' });
        return;
      }
      if (text.length > MAX_CHARS) {
        json(response, 400, { error: `Text must be at most ${MAX_CHARS} characters.` });
        return;
      }
      if (!lang) {
        json(response, 400, { error: 'lang must be en-IN or hi-IN.' });
        return;
      }
      const rate = Number(body?.rate);
      try {
        const result = await synthesizeServerSpeech({
          text,
          lang,
          rate: Number.isFinite(rate) ? rate : 1,
          styleId: typeof body?.style === 'string' ? body.style : STYLE,
          maxChars: MAX_CHARS,
        });
        response.writeHead(200, {
          'Content-Type': result.contentType,
          'Content-Length': String(result.audio.length),
          'X-Sample-Rate': String(result.sampleRate),
          'X-Voice-Engine': 'supertonic-3',
          'X-Voice-Chunks': String(result.chunks.length),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(result.audio);
      } catch (cause) {
        const status = cause?.code === 'voice-unconfigured' ? 503 : 500;
        console.error('Supertonic synthesis failed.', cause?.code ?? cause?.name ?? 'unknown');
        json(response, status, {
          error: cause?.message ?? 'The voice could not be generated.',
          code: cause?.code ?? 'voice-failed',
        });
      }
      return;
    }

    json(response, 404, { error: 'Not found.' });
  } catch (cause) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    json(response, cause?.status ?? 500, { error: cause?.message ?? 'The voice service failed.' });
  }
});

server.listen(PORT, () => {
  console.log(`BroCode voice service listening on port ${PORT}.`);
  void boot();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
