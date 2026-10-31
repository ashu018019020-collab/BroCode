import test from 'node:test';
import assert from 'node:assert/strict';

import { createTtsEngine } from '../../server/tts.mjs';
import { createStatusHandler, createTtsHandler } from '../../server/voice-handler.mjs';

/**
 * The serverless half of the voice: what a static deployment serves at /api/voice/*. Driven with a
 * fake request/response pair, so the rules (same origin, budget, typed codes, MP3 out) are checked
 * with no network and no key.
 */

function fakeRequest({ method = 'POST', body = null, headers = {} } = {}) {
  return {
    method,
    body,
    headers: { host: 'mybrocode.vercel.app', origin: 'https://mybrocode.vercel.app', ...headers },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() { /* no streamed body: the fake carries `body` */ },
  };
}

function fakeResponse() {
  const state = { status: 0, headers: {}, body: null };
  return {
    state,
    writeHead(status, headers) { state.status = status; Object.assign(state.headers, headers); },
    end(payload) { state.body = payload ?? null; },
  };
}

/** A configured engine whose provider call is a stub — one fake MP3, no Azure account needed. */
function stubEngine() {
  return createTtsEngine({
    key: 'test-key',
    region: 'centralindia',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'audio/mpeg' },
      arrayBuffer: async () => new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4]).buffer,
    }),
  });
}

/* --------------------------------- status --------------------------------- */

test('voice handler: status is public, names the voices, and never the key', async () => {
  const response = fakeResponse();
  await createStatusHandler(stubEngine())(fakeRequest({ method: 'GET' }), response);
  assert.equal(response.state.status, 200);
  const body = JSON.parse(response.state.body);
  assert.equal(body.configured, true);
  assert.equal(body.engine, 'azure');
  assert.deepEqual(body.langs, ['hi-IN', 'en-IN']);
  assert.equal(JSON.stringify(body).includes('test-key'), false);
  assert.equal(JSON.stringify(body).includes('centralindia'), false);
});

test('voice handler: status names no engine when the deployment has no key', async () => {
  const response = fakeResponse();
  await createStatusHandler(createTtsEngine({ key: '', region: '' }))(fakeRequest({ method: 'GET' }), response);
  assert.equal(response.state.status, 200);
  assert.equal(JSON.parse(response.state.body).configured, false);
});

/* ---------------------------------- tts ----------------------------------- */

test('voice handler: audio out with the voice that spoke', async () => {
  const response = fakeResponse();
  await createTtsHandler(stubEngine())(fakeRequest({
    body: { text: 'Aaj hum Python seekhenge.', lang: 'hi-IN', rate: 1 },
  }), response);
  assert.equal(response.state.status, 200);
  assert.equal(response.state.headers['Content-Type'], 'audio/mpeg');
  assert.equal(response.state.headers['X-Voice-Id'], 'hi-IN-SwaraNeural');
  assert.equal(response.state.headers['X-Voice-Lang'], 'hi-IN');
  assert.equal(Buffer.isBuffer(response.state.body), true);
});

test('voice handler: no key is a 503 with a code, not fake audio', async () => {
  const response = fakeResponse();
  await createTtsHandler(createTtsEngine({ key: '', region: '' }))(fakeRequest({
    body: { text: 'Hello', lang: 'en-IN' },
  }), response);
  assert.equal(response.state.status, 503);
  assert.equal(JSON.parse(response.state.body).code, 'TTS_NOT_CONFIGURED');
});

test('voice handler: another site cannot spend the owner’s characters', async () => {
  const response = fakeResponse();
  await createTtsHandler(stubEngine())(fakeRequest({
    body: { text: 'Hello', lang: 'en-IN' },
    headers: { origin: 'https://example.com' },
  }), response);
  assert.equal(response.state.status, 403);
  assert.equal(JSON.parse(response.state.body).code, 'ORIGIN_NOT_ALLOWED');

  const bare = fakeResponse();
  await createTtsHandler(stubEngine())(fakeRequest({ body: { text: 'Hello', lang: 'en-IN' }, headers: { origin: '' } }), bare);
  assert.equal(bare.state.status, 403, 'a request with no origin is not this site either');
});

test('voice handler: accepts the host header a proxy actually forwards', async () => {
  const response = fakeResponse();
  await createTtsHandler(stubEngine())(fakeRequest({
    body: { text: 'Hello', lang: 'en-IN' },
    headers: { origin: 'https://mybrocode.vercel.app', host: '127.0.0.1:3000', 'x-forwarded-host': 'mybrocode.vercel.app' },
  }), response);
  assert.equal(response.state.status, 200);
});

test('voice handler: text and language are validated before the provider is called', async () => {
  for (const body of [{ text: '   ', lang: 'en-IN' }, { text: 'Hi', lang: 'fr-FR' }, { text: 'x'.repeat(601), lang: 'en-IN' }]) {
    const response = fakeResponse();
    await createTtsHandler(stubEngine())(fakeRequest({ body }), response);
    assert.equal(response.state.status, 400, JSON.stringify(body));
  }
});

test('voice handler: a streamed body works too, so a raw node harness behaves the same', async () => {
  const response = fakeResponse();
  const request = fakeRequest({ body: undefined });
  request[Symbol.asyncIterator] = async function* stream() {
    yield Buffer.from(JSON.stringify({ text: 'Hello', lang: 'en-IN' }));
  };
  await createTtsHandler(stubEngine())(request, response);
  assert.equal(response.state.status, 200);
});

test('voice handler: the per-address budget closes after thirty requests in a minute', async () => {
  const handler = createTtsHandler(stubEngine());
  let last = null;
  for (let i = 0; i < 31; i += 1) {
    last = fakeResponse();
    await handler(fakeRequest({ body: { text: 'Hello', lang: 'en-IN' } }), last);
  }
  assert.equal(last.state.status, 429);
  assert.equal(JSON.parse(last.state.body).code, 'TTS_RATE_LIMITED');
});

test('voice handler: GET on the speech route is refused', async () => {
  const response = fakeResponse();
  await createTtsHandler(stubEngine())(fakeRequest({ method: 'GET' }), response);
  assert.equal(response.state.status, 405);
});

/* -------------------------------- wiring ---------------------------------- */

test('voice handler: the deployed routes are thin wrappers over these handlers', async () => {
  for (const path of ['../../api/voice/status.js', '../../api/voice/tts.js']) {
    const mod = await import(path);
    assert.equal(typeof mod.default, 'function', `${path} must export a handler`);
  }
});
