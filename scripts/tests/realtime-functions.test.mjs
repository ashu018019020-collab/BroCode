/**
 * The realtime voice Vercel functions — the deployment gap this test closes.
 *
 * The static site previously shipped `/api/voice/status` and `/api/voice/tts` only, so the
 * browser's online-voice probe hit a 404 even on a deployment that had an OpenAI key. These tests
 * pin the same contract as the account API: a public boolean status, and a session that is
 * same-origin, signed-in, validated and budgeted before the provider is paid. No network: the
 * Supabase check and secret factory are injected.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRealtimeSessionHandler,
  createRealtimeStatusHandler,
} from '../../server/realtime-handler.mjs';

const ORIGIN = 'https://mybrocode.vercel.app';

function fakeResponse() {
  const captured = { status: 0, headers: null, body: null };
  return {
    captured,
    writeHead(status, headers) {
      captured.status = status;
      captured.headers = headers;
    },
    end(payload) {
      captured.body = payload ? JSON.parse(payload) : null;
    },
  };
}

function fakeRequest({ method = 'POST', origin = ORIGIN, body = { lang: 'en-IN', consent: true }, token = 'token' } = {}) {
  const headers = { host: 'mybrocode.vercel.app', origin };
  if (token) headers.authorization = `Bearer ${token}`;
  return { method, headers, body, socket: { remoteAddress: '203.0.113.7' } };
}

async function call(handler, request) {
  const response = fakeResponse();
  await handler(request, response);
  return response.captured;
}

const user = { id: 'user-1' };
const envWithKey = { OPENAI_API_KEY: 'sk-test', APP_ORIGIN: ORIGIN };

/* --------------------------------- status --------------------------------- */

test('realtime status: no key is configured:false, and the key is never returned', async () => {
  const result = await call(createRealtimeStatusHandler({}), fakeRequest({ method: 'GET' }));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { configured: false, enabled: true });
});

test('realtime status: a configured key is a boolean, and the deployment switch is reported', async () => {
  const on = await call(createRealtimeStatusHandler(envWithKey), fakeRequest({ method: 'GET' }));
  assert.equal(on.body.configured, true);
  assert.equal(on.body.enabled, true);
  assert.equal(JSON.stringify(on.body).includes('sk-test'), false);

  const off = await call(
    createRealtimeStatusHandler({ ...envWithKey, ONLINE_VOICE_ENABLED: 'off' }),
    fakeRequest({ method: 'GET' }),
  );
  assert.equal(off.body.enabled, false);
});

test('realtime status: POST is refused', async () => {
  const result = await call(createRealtimeStatusHandler(envWithKey), fakeRequest({ method: 'POST' }));
  assert.equal(result.status, 405);
});

/* --------------------------------- session -------------------------------- */

function sessionHandler(overrides = {}) {
  return createRealtimeSessionHandler({
    env: envWithKey,
    verifyUser: async () => user,
    createSecret: async () => ({
      value: 'ephemeral-secret',
      expiresAt: 1_700_000_000_000,
      model: 'gpt-realtime',
      voice: 'coral',
      maxSessionSeconds: 300,
    }),
    logger: { warn() {} },
    ...overrides,
  });
}

test('realtime session: a foreign origin is refused before any auth or paid call', async () => {
  const result = await call(
    sessionHandler({ createSecret: async () => { throw new Error('must not be called'); } }),
    fakeRequest({ origin: 'https://evil.example' }),
  );
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'ORIGIN_NOT_ALLOWED');
});

test('realtime session: a missing account is 401', async () => {
  const result = await call(sessionHandler({ verifyUser: async () => null }), fakeRequest());
  assert.equal(result.status, 401);
  assert.equal(result.body.code, 'AUTH_REQUIRED');
});

test('realtime session: a disabled deployment and a missing key are honest 503s', async () => {
  const disabled = await call(
    createRealtimeSessionHandler({
      env: { ...envWithKey, ONLINE_VOICE_ENABLED: 'false' },
      verifyUser: async () => user,
    }),
    fakeRequest(),
  );
  assert.equal(disabled.status, 503);
  assert.equal(disabled.body.code, 'ONLINE_VOICE_DISABLED');

  const unconfigured = await call(
    sessionHandler({ env: { APP_ORIGIN: ORIGIN } }),
    fakeRequest(),
  );
  assert.equal(unconfigured.status, 503);
  assert.equal(unconfigured.body.code, 'REALTIME_UNCONFIGURED');
});

test('realtime session: language and explicit consent are validated before the budget', async () => {
  const badLang = await call(sessionHandler(), fakeRequest({ body: { lang: 'fr-FR', consent: true } }));
  assert.equal(badLang.status, 400);

  const noConsent = await call(sessionHandler(), fakeRequest({ body: { lang: 'en-IN' } }));
  assert.equal(noConsent.status, 400);
  assert.match(noConsent.body.message, /consent is required/i);
});

test('realtime session: the account+address budget stops the seventh session', async () => {
  const handler = sessionHandler();
  for (let i = 0; i < 6; i += 1) {
    const ok = await call(handler, fakeRequest());
    assert.equal(ok.status, 200, `session ${i + 1} should be allowed`);
  }
  const limited = await call(handler, fakeRequest());
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'REALTIME_RATE_LIMITED');
});

test('realtime session: success forwards the language and returns only the short-lived fields', async () => {
  let seen = null;
  const result = await call(
    sessionHandler({ createSecret: async (input) => { seen = input; return sessionHandlerSecret(); } }),
    fakeRequest({ body: { lang: 'hi-IN', consent: true } }),
  );
  assert.equal(result.status, 200);
  assert.equal(seen.lang, 'hi-IN');
  assert.equal(seen.apiKey, 'sk-test');
  assert.deepEqual(Object.keys(result.body).sort(), [
    'clientSecret', 'expiresAt', 'maxSessionSeconds', 'model', 'voice',
  ]);
  assert.equal(JSON.stringify(result.body).includes('sk-test'), false);
});

test('realtime session: provider rate limits are 429 and other failures are a 502', async () => {
  const limited = await call(
    sessionHandler({ createSecret: async () => { const e = new Error('slow down'); e.code = 'realtime-rate-limited'; throw e; } }),
    fakeRequest(),
  );
  assert.equal(limited.status, 429);

  const failed = await call(
    sessionHandler({ createSecret: async () => { throw new Error('socket hang up'); } }),
    fakeRequest(),
  );
  assert.equal(failed.status, 502);
  assert.equal(failed.body.code, 'REALTIME_UNAVAILABLE');
});

function sessionHandlerSecret() {
  return {
    value: 'ephemeral-secret',
    expiresAt: 1_700_000_000_000,
    model: 'gpt-realtime',
    voice: 'coral',
    maxSessionSeconds: 300,
  };
}
