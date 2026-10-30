/**
 * The Vercel voice functions — the same two routes the static deployment previously lacked.
 *
 * These tests exercise the REAL handlers (`server/vercel-voice.mjs`) with fake engines and mock
 * request/response objects, so what is pinned is the wire contract: status shape, audio headers,
 * same-origin enforcement, body bounds, rate limiting, and sanitized errors. The engine itself is
 * already covered by `voice-server.test.mjs`; no network and no key are needed here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  createLimiter,
  createStatusHandler,
  createTtsHandler,
  engineFromEnv,
  originOf,
} from '../../server/vercel-voice.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = 'https://brocode.test';

function mockRequest({ method = 'GET', headers = {}, body } = {}) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  stream.method = method;
  stream.headers = headers;
  stream.socket = { remoteAddress: '127.0.0.1' };
  return stream;
}

function mockResponse() {
  const chunks = [];
  return {
    statusCode: 0,
    headers: {},
    body: null,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      // Node exposes response headers case-insensitively; the mock must not hide that.
      for (const [name, value] of Object.entries(headers)) this.headers[name.toLowerCase()] = value;
      return this;
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      this.body = Buffer.concat(chunks);
    },
  };
}

async function call(handler, { method = 'POST', headers = {}, body, ip = '203.0.113.7' } = {}) {
  const response = mockResponse();
  await handler(mockRequest({
    method,
    headers: {
      origin: APP,
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      ...headers,
    },
    body,
  }), response);
  return response;
}

/* ------------------------------- status route ------------------------------- */

test('vercel voice: status reports the engine and withholds everything secret', async () => {
  const engine = {
    async status() {
      return {
        configured: true,
        engine: 'supertonic',
        engineLabel: 'Supertonic 3 (server)',
        ready: true,
        langs: ['en-IN', 'hi-IN'],
        reason: null,
      };
    },
  };
  const response = await call(createStatusHandler({ engine }), { method: 'GET' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(response.body.toString()), {
    configured: true,
    engine: 'supertonic',
    engineLabel: 'Supertonic 3 (server)',
    ready: true,
    langs: ['en-IN', 'hi-IN'],
    reason: null,
  });
  assert.equal(response.headers['access-control-allow-origin'], undefined, 'no wildcard CORS');
});

test('vercel voice: an unconfigured function says so instead of failing the page', async () => {
  const response = await call(createStatusHandler({ engine: engineFromEnv({}) }), { method: 'GET' });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body.toString());
  assert.equal(body.configured, false);
  assert.equal(body.engine, 'none');
  assert.match(body.reason, /No server voice/);
});

test('vercel voice: the status route refuses non-GET requests', async () => {
  const response = await call(createStatusHandler({ engine: engineFromEnv({}) }), { method: 'POST' });
  assert.equal(response.statusCode, 405);
});

/* -------------------------------- tts route -------------------------------- */

function voiceEngine() {
  const spoken = [];
  return {
    spoken,
    async speak(input) {
      spoken.push(input);
      return {
        audio: Buffer.from('RIFF-voice-bytes'),
        contentType: 'audio/wav',
        engine: 'supertonic',
        sampleRate: 44_100,
      };
    },
  };
}

test('vercel voice: tts returns real audio with the engine that produced it', async () => {
  const engine = voiceEngine();
  const handler = createTtsHandler({ engine, env: { APP_ORIGIN: APP } });
  const response = await call(handler, {
    body: JSON.stringify({ text: 'नमस्ते! आज हम Python सीखेंगे।', lang: 'hi-IN', rate: 1 }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'audio/wav');
  assert.equal(response.headers['x-voice-engine'], 'supertonic');
  assert.equal(response.headers['x-sample-rate'], '44100');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body.toString(), 'RIFF-voice-bytes');
  assert.deepEqual(engine.spoken, [{ text: 'नमस्ते! आज हम Python सीखेंगे।', lang: 'hi-IN', rate: 1 }]);
});

test('vercel voice: a foreign origin cannot spend the voice budget', async () => {
  const engine = voiceEngine();
  const handler = createTtsHandler({ engine, env: { APP_ORIGIN: APP } });
  const foreign = await call(handler, {
    headers: { origin: 'https://evil.example' },
    body: JSON.stringify({ text: 'Hello', lang: 'en-IN', rate: 1 }),
  });
  assert.equal(foreign.statusCode, 403);
  assert.equal(engine.spoken.length, 0);

  const missing = await call(handler, {
    headers: { origin: '' },
    body: JSON.stringify({ text: 'Hello', lang: 'en-IN', rate: 1 }),
  });
  assert.equal(missing.statusCode, 403, 'a curl without an Origin is not the app');
  assert.equal(engine.spoken.length, 0);
});

test('vercel voice: the function derives the allowed origin from the forwarded host', async () => {
  const request = { headers: { 'x-forwarded-host': 'mybrocode.vercel.app', 'x-forwarded-proto': 'https' } };
  assert.equal(originOf(request, {}), 'https://mybrocode.vercel.app');
  assert.equal(originOf({ headers: { origin: 'https://evil.example' } }, {}), '', 'the Origin is never trusted as the allowlist');
  assert.equal(originOf({ headers: {} }, { APP_ORIGIN: 'https://mybrocode.vercel.app/' }), 'https://mybrocode.vercel.app');
});

test('vercel voice: input is validated before any engine is called', async () => {
  const engine = voiceEngine();
  const handler = createTtsHandler({ engine, env: { APP_ORIGIN: APP } });

  assert.equal((await call(handler, { body: JSON.stringify({ text: '', lang: 'en-IN' }) })).statusCode, 400);
  assert.equal((await call(handler, { body: JSON.stringify({ text: 'x'.repeat(1201), lang: 'en-IN' }) })).statusCode, 400);
  assert.equal((await call(handler, { headers: { 'content-type': 'text/plain' }, body: 'hi' })).statusCode, 415);
  assert.equal((await call(handler, { body: '{not json' })).statusCode, 400);
  assert.equal(engine.spoken.length, 0);
});

test('vercel voice: an oversized body is refused before parsing it', async () => {
  const handler = createTtsHandler({ engine: voiceEngine(), env: { APP_ORIGIN: APP } });
  const huge = JSON.stringify({ text: 'x'.repeat(20_000), lang: 'en-IN' });
  assert.equal((await call(handler, { body: huge })).statusCode, 413);
});

test('vercel voice: a request is rate-limited per client, predictably', async () => {
  const handler = createTtsHandler({
    engine: voiceEngine(),
    env: { APP_ORIGIN: APP },
    limiter: createLimiter({ max: 2, windowMs: 60_000 }),
  });
  const payload = JSON.stringify({ text: 'Hello', lang: 'en-IN', rate: 1 });
  assert.equal((await call(handler, { body: payload })).statusCode, 200);
  assert.equal((await call(handler, { body: payload })).statusCode, 200);
  const limited = await call(handler, { body: payload });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['retry-after'], '60');
});

test('vercel voice: engine failures are mapped, and internal detail never reaches the learner', async () => {
  const failWith = (code) => ({
    async speak() {
      const error = new Error('TTS_SERVICE_URL=http://internal.invalid with secret shh');
      error.code = code;
      throw error;
    },
  });
  const handlerFor = (code) => createTtsHandler({ engine: failWith(code), env: { APP_ORIGIN: APP } });
  const payload = JSON.stringify({ text: 'Hello', lang: 'en-IN', rate: 1 });

  const badLang = await call(handlerFor('voice-bad-lang'), { body: payload });
  assert.equal(badLang.statusCode, 400);

  const unconfigured = await call(handlerFor('voice-unconfigured'), { body: payload });
  assert.equal(unconfigured.statusCode, 503);
  const absent = JSON.parse(unconfigured.body.toString()).error;
  assert.match(absent, /No AI voice is configured/i);
  // The deployment with no voice says so. It must NOT promise a robotic substitute: that sentence
  // is how a broken deployment read as healthy for months.
  assert.match(absent, /not spoken|stays on screen/i, 'the silence is stated, not denied');
  assert.doesNotMatch(absent, /browser voice/i, 'the AI flow never advertises another engine');

  const unavailable = await call(handlerFor('voice-unavailable'), { body: payload });
  assert.equal(unavailable.statusCode, 502);
  const copy = JSON.parse(unavailable.body.toString()).error;
  assert.match(copy, /temporarily unavailable/i);
  assert.doesNotMatch(copy, /internal\.invalid|secret|TTS_SERVICE_URL/);

  const limited = await call(handlerFor('voice-rate-limited'), { body: payload });
  assert.equal(limited.statusCode, 429);
});

/* -------------------------------- deployment -------------------------------- */

test('vercel voice: both routes are real functions wired to the shared engine', () => {
  for (const file of ['api/voice/status.js', 'api/voice/tts.js']) {
    const source = read(file);
    assert.match(source, /export default create(Status|Tts)Handler\(\)/, `${file} must export a handler`);
    assert.match(source, /server\/vercel-voice\.mjs/, `${file} must reuse the shared implementation`);
  }
  const config = JSON.parse(read('vercel.json'));
  assert.equal(config.functions['api/voice/tts.js'].maxDuration, 60, 'cold inference needs room');
  assert.equal(config.functions['api/voice/status.js'].maxDuration, 15);

  // The engine reads the same names the account API and the docs use; no secret is in the client.
  const shared = read('server/vercel-voice.mjs');
  assert.match(shared, /TTS_SERVICE_URL/);
  assert.match(shared, /TTS_SERVICE_SECRET/);
  assert.match(shared, /GOOGLE_TTS_API_KEY/);
  assert.doesNotMatch(read('src/components/shared/useVoiceTutor.ts'), /TTS_SERVICE_SECRET|GOOGLE_TTS_API_KEY/);
});
