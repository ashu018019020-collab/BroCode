/**
 * `GET /api/voice/health` — the operator's view of a deployed voice path.
 *
 * These tests drive the REAL handler and the REAL diagnostics module with fake engines, so what is
 * pinned is the answer an operator actually gets: the code, the presence of each variable, and the
 * three rules the file must never break — no value ever leaves, a key is not the same as a working
 * voice, and 200 means the engine really answered.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createHealthHandler } from '../../server/vercel-voice.mjs';
import { voiceEnvReport, voiceDiagnostics, VOICE_CODES } from '../../server/voice-diagnostics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

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
      for (const [name, value] of Object.entries(headers)) this.headers[name.toLowerCase()] = value;
      return this;
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      this.body = Buffer.concat(chunks);
    },
  };
}

async function health(env, engine, { method = 'GET' } = {}) {
  const response = mockResponse();
  const quiet = { warn() {} };
  const handler = createHealthHandler({ env, engine, logger: quiet });
  await handler(mockRequest({ method }), response);
  return { status: response.statusCode, headers: response.headers, body: JSON.parse(response.body.toString()) };
}

const SECRET = 'secret-value-must-never-leak';

/* --------------------------- configuration report --------------------------- */

test('voice health: presence is reported by name, and a value never appears', () => {
  const report = voiceEnvReport({
    TTS_SERVICE_URL: 'https://voice.example.com',
    TTS_SERVICE_SECRET: SECRET,
    GOOGLE_TTS_API_KEY: 'google-key',
  });
  assert.equal(report.configured, true);
  assert.equal(report.engine, 'supertonic');
  assert.deepEqual(report.vars, {
    TTS_SERVICE_URL: 'set',
    TTS_SERVICE_SECRET: 'set',
    // The alias spelling is reported too, so an operator who set it never reads `missing` for the
    // variable they actually typed.
    SUPERTONIC_TTS_BASE_URL: 'missing',
    SUPERTONIC_TTS_API_KEY: 'missing',
    GOOGLE_TTS_API_KEY: 'set',
  });
  assert.doesNotMatch(JSON.stringify(report), /voice\.example\.com|secret-value|google-key/);
});

test('voice health: half a Supertonic configuration names the missing half', () => {
  const url = voiceEnvReport({ TTS_SERVICE_URL: 'https://voice.example.com' });
  assert.equal(url.configured, false, 'a URL with no secret cannot synthesize');
  assert.equal(url.engine, 'supertonic');
  assert.ok(url.hints.some((hint) => /no shared secret is/.test(hint)));

  const secretOnly = voiceEnvReport({ TTS_SERVICE_SECRET: SECRET });
  assert.equal(secretOnly.engine, 'none', 'a secret alone calls nothing');
  assert.ok(secretOnly.hints.some((hint) => /no service URL is/.test(hint)));

  // The other documented spelling configures the same service, and is reported as configured —
  // recording it as missing while it is the one in use would be the lie this report exists to avoid.
  const alias = voiceEnvReport({ SUPERTONIC_TTS_BASE_URL: 'https://voice.example.com', SUPERTONIC_TTS_API_KEY: SECRET });
  assert.equal(alias.configured, true, 'SUPERTONIC_TTS_* configures the service');
  assert.equal(alias.engine, 'supertonic');
  assert.deepEqual(alias.vars, {
    TTS_SERVICE_URL: 'missing',
    TTS_SERVICE_SECRET: 'missing',
    SUPERTONIC_TTS_BASE_URL: 'set',
    SUPERTONIC_TTS_API_KEY: 'set',
    GOOGLE_TTS_API_KEY: 'missing',
  });
  assert.doesNotMatch(JSON.stringify(alias), /secret-value/);

  const plainHttp = voiceEnvReport({ TTS_SERVICE_URL: 'http://voice.example.com', TTS_SERVICE_SECRET: SECRET });
  assert.ok(plainHttp.hints.some((hint) => /https:\/\//.test(hint)), 'a function cannot reach plain http');
});

test('voice health: nothing configured is VOICE_NOT_CONFIGURED with the next step', async () => {
  const result = await health({}, {});
  assert.equal(result.status, 503);
  assert.equal(result.body.code, VOICE_CODES.notConfigured);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.engine, 'none');
  assert.ok(result.body.hints.length > 0);
  assert.match(JSON.stringify(result.body), /redeploy/i, 'the redeploy trap must be stated');
});

/* ------------------------------- real probing ------------------------------- */

test('voice health: a ready service is 200 and verified, and the probe is forced', async () => {
  let forced = 0;
  const engine = {
    async serviceHealth(options) {
      forced += options?.force === true ? 1 : 0;
      return { ready: true, detail: null };
    },
  };
  const result = await health({ TTS_SERVICE_URL: 'https://voice.example.com', TTS_SERVICE_SECRET: SECRET }, engine);
  assert.equal(result.status, 200);
  assert.equal(result.body.code, VOICE_CODES.ready);
  assert.equal(result.body.verified, true);
  assert.equal(forced, 1, 'Retry must not read a cached negative');
  assert.doesNotMatch(JSON.stringify(result.body), /secret-value/);
});

test('voice health: a service that is down, slow or rejecting us is named, not buried', async () => {
  const cases = [
    [{ ready: false, detail: 'service unreachable' }, VOICE_CODES.providerUnavailable],
    [{ ready: false, detail: 'health check answered HTTP 401' }, VOICE_CODES.providerUnavailable],
    [{ ready: false, detail: 'health check timed out' }, VOICE_CODES.timeout],
    [{ ready: false, detail: 'the model is still loading' }, VOICE_CODES.providerUnavailable],
  ];
  for (const [probe, code] of cases) {
    const result = await health(
      { TTS_SERVICE_URL: 'https://voice.example.com', TTS_SERVICE_SECRET: SECRET },
      { async serviceHealth() { return probe; } },
    );
    assert.equal(result.status, 503);
    assert.equal(result.body.code, code, probe.detail);
    assert.equal(result.body.ok, false);
    assert.doesNotMatch(JSON.stringify(result.body), /secret-value/);
  }
});

test('voice health: a Google key is usable but explicitly unverified', async () => {
  const result = await health({ GOOGLE_TTS_API_KEY: 'google-key' }, {});
  assert.equal(result.status, 200);
  assert.equal(result.body.engine, 'google');
  assert.equal(result.body.verified, false, 'a key is not proof that synthesis works');
  assert.match(result.body.detail, /first spoken answer/i);
  assert.doesNotMatch(JSON.stringify(result.body), /google-key/);
});

test('voice health: a diagnostics failure still answers instead of throwing', async () => {
  const engine = { async serviceHealth() { throw new Error('boom: TTS_SERVICE_SECRET=' + SECRET); } };
  const response = mockResponse();
  const handler = createHealthHandler({
    env: { TTS_SERVICE_URL: 'https://voice.example.com', TTS_SERVICE_SECRET: SECRET },
    engine,
    logger: { warn() {} },
  });
  await handler(mockRequest({ method: 'GET' }), response);
  assert.ok([200, 502, 503].includes(response.statusCode));
  assert.doesNotMatch(response.body.toString(), /secret-value/);
});

test('voice health: only GET is accepted, and the route is a real function', async () => {
  const refused = await health({}, {}, { method: 'POST' });
  assert.equal(refused.status, 405);

  const source = read('api/voice/health.js');
  assert.match(source, /export default createHealthHandler\(\)/);
  assert.match(source, /server\/vercel-voice\.mjs/);
  const config = JSON.parse(read('vercel.json'));
  assert.equal(config.functions['api/voice/health.js'].maxDuration, 15);
});

/* ------------------------------ error contract ------------------------------ */

test('voice health: every failure the TTS route can produce carries its code', async () => {
  const { createTtsHandler } = await import('../../server/vercel-voice.mjs');
  const payload = JSON.stringify({ text: 'Namaste', lang: 'hi-IN', rate: 1 });
  const codes = [
    ['voice-bad-lang', 400, VOICE_CODES.invalidRequest],
    ['voice-unconfigured', 503, VOICE_CODES.notConfigured],
    ['voice-rate-limited', 429, VOICE_CODES.rateLimited],
    ['voice-auth-failed', 502, VOICE_CODES.authFailed],
    ['voice-invalid-audio', 502, VOICE_CODES.invalidAudio],
    ['voice-timeout', 504, VOICE_CODES.timeout],
    ['voice-unavailable', 502, VOICE_CODES.providerUnavailable],
  ];
  for (const [code, status, expected] of codes) {
    const engine = { async speak() { const error = new Error(`upstream said ${SECRET}`); error.code = code; throw error; } };
    const response = mockResponse();
    await createTtsHandler({ engine, env: { APP_ORIGIN: 'https://brocode.test' }, limiter: { take: () => true } })(
      mockRequest({
        method: 'POST',
        headers: { origin: 'https://brocode.test', 'content-type': 'application/json' },
        body: payload,
      }),
      response,
    );
    const parsed = JSON.parse(response.body.toString());
    assert.equal(response.statusCode, status, code);
    assert.equal(parsed.code, expected, code);
    assert.doesNotMatch(JSON.stringify(parsed), /secret-value/);
  }
});
