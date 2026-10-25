/**
 * The optional realtime voice path — `server/realtime.mjs` and its two routes.
 *
 * Three properties are under test, and each is a security or honesty claim:
 *
 *   1. The permanent OpenAI key only exists server-side. The browser gets a short-lived secret, the
 *      status route names a boolean, and no response or error message ever echoes the key.
 *   2. The session is authenticated (401), same-origin (403), per-account rate-limited (429), and
 *      refuses an unsupported language (400) before a paid call is made.
 *   3. The instructions sent to the model forbid claiming a run or a test, and forbid judging accent
 *      — the product rules do not live in the browser where they could be rewritten.
 *
 * Zero dependencies: node:test, node:http, and injected fakes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createAuthServer } from '../../server/app.mjs';
import {
  DEFAULT_REALTIME_VOICE,
  REALTIME_MAX_SESSION_SECONDS,
  buildRealtimeSessionConfig,
  createRealtimeClientSecret,
  realtimeInstructions,
  validateRealtimeSessionBody,
} from '../../server/realtime.mjs';

const ORIGIN = 'http://localhost:5173';

/* ------------------------------ the session body ----------------------------- */

test('realtime: a female-sounding voice is chosen and an unknown voice falls back safely', () => {
  const body = buildRealtimeSessionConfig({ lang: 'en-IN' });
  assert.equal(body.session.type, 'realtime');
  assert.equal(body.session.audio.output.voice, DEFAULT_REALTIME_VOICE);
  assert.equal(DEFAULT_REALTIME_VOICE, 'coral');

  const bogus = buildRealtimeSessionConfig({ voice: 'not-a-voice' });
  assert.equal(bogus.session.audio.output.voice, DEFAULT_REALTIME_VOICE, 'never forward a made-up voice');

  const hi = buildRealtimeSessionConfig({ lang: 'hi-IN' });
  assert.match(hi.session.instructions, /Hinglish/);
  assert.equal(hi.session.audio.input.transcription.model, 'gpt-4o-mini-transcribe');
  assert.equal(hi.session.audio.input.turn_detection.type, 'semantic_vad', 'barge-in is server-side VAD');
});

test('realtime: the instructions forbid fake runs, invented content and accent scoring', () => {
  const en = realtimeInstructions('en-IN');
  const hi = realtimeInstructions('hi-IN');

  for (const text of [en, hi]) {
    assert.match(text, /Never say you ran, tested, compiled or verified code/);
    assert.match(text, /Do not judge accent, voice, fluency or personality/);
    assert.match(text, /Ask one question at a time/);
    assert.match(text, /you don’t know|do not know/i);
    assert.match(text, /at most 4 sentences/);
  }
  assert.match(en, /Indian English/);
  assert.match(hi, /Never use Devanagari script/);
});

/* ------------------------------ the secret exchange --------------------------- */

test('realtime: a missing key, a bad language and a timeout each fail with an honest code', async () => {
  await assert.rejects(
    createRealtimeClientSecret({ apiKey: '' }),
    (error) => error.code === 'realtime-unconfigured',
  );
  await assert.rejects(
    createRealtimeClientSecret({ apiKey: 'sk-secret', lang: 'fr-FR' }),
    (error) => error.code === 'realtime-bad-lang' && !error.message.includes('sk-secret'),
  );
  await assert.rejects(
    createRealtimeClientSecret({
      apiKey: 'sk-secret',
      fetchImpl: async () => { throw new Error('ECONNRESET sk-secret'); },
    }),
    (error) => error.code === 'realtime-unavailable' && !error.message.includes('sk-secret'),
  );
});

test('realtime: an OpenAI refusal maps to 429 only for a real rate limit', async () => {
  await assert.rejects(
    createRealtimeClientSecret({ apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 429 }) }),
    (error) => error.code === 'realtime-rate-limited',
  );
  await assert.rejects(
    createRealtimeClientSecret({ apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 500 }) }),
    (error) => error.code === 'realtime-unavailable',
  );
  await assert.rejects(
    createRealtimeClientSecret({ apiKey: 'k', fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }),
    (error) => error.code === 'realtime-unavailable',
    'an answer without a secret is a failure, not a quiet success',
  );
});

test('realtime: the browser receives only the literal fields it needs, never the instructions', async () => {
  let sent = null;
  const result = await createRealtimeClientSecret({
    apiKey: 'sk-secret',
    lang: 'hi-IN',
    now: () => 1_000_000,
    fetchImpl: async (url, options) => {
      sent = { url, options };
      return {
        ok: true,
        json: async () => ({
          value: 'ek_short_lived',
          expires_at: 1_700_000_000,
          session: { model: 'gpt-realtime', audio: { output: { voice: 'shimmer' } } },
          account: { id: 'acct_should_not_travel' },
        }),
      };
    },
  });

  assert.equal(sent.url, 'https://api.openai.com/v1/realtime/client_secrets');
  assert.equal(sent.options.headers.Authorization, 'Bearer sk-secret', 'the key stays server-side');
  assert.deepEqual(JSON.parse(sent.options.body).session.audio.output.voice, DEFAULT_REALTIME_VOICE);
  assert.deepEqual(result, {
    value: 'ek_short_lived',
    expiresAt: 1_700_000_000_000,
    model: 'gpt-realtime',
    voice: 'shimmer',
    maxSessionSeconds: REALTIME_MAX_SESSION_SECONDS,
  });
  assert.equal('account' in result, false);
  assert.equal('instructions' in result, false);
  assert.equal(JSON.stringify(result).includes('sk-secret'), false);
});

/* ------------------------------- consent body ------------------------------- */

test('realtime: a session body needs an allowed language AND explicit consent', () => {
  assert.deepEqual(validateRealtimeSessionBody({ lang: 'en-IN', consent: true }), { ok: true, lang: 'en-IN' });
  assert.deepEqual(validateRealtimeSessionBody({ lang: 'hi-IN', consent: true }), { ok: true, lang: 'hi-IN' });

  const noConsent = validateRealtimeSessionBody({ lang: 'en-IN' });
  assert.equal(noConsent.ok, false);
  assert.equal(noConsent.status, 400);
  assert.match(noConsent.message, /consent/i, 'the refusal explains what must be turned on');

  const implied = validateRealtimeSessionBody({ lang: 'en-IN', consent: 'yes' });
  assert.equal(implied.ok, false, 'a string is not a consent, only `true` is');

  const badLang = validateRealtimeSessionBody({ lang: 'fr-FR', consent: true });
  assert.equal(badLang.ok, false);
  assert.equal(badLang.status, 400);
  assert.match(badLang.message, /en-IN, hi-IN/);

  for (const body of [null, undefined, 'string', 42]) {
    assert.equal(validateRealtimeSessionBody(body).ok, false, `a non-object body is refused: ${String(body)}`);
  }
});

/* ---------------------------------- the routes -------------------------------- */

// The fakes mirror scripts/tests/voice-server.test.mjs: a store that only identifies the account,
// and an auth client that verifies one literal token. The key never appears in a response.
const store = {
  name: 'realtime-test-store',
  async health() {},
  async getProfile(id) {
    return ['user-1', 'user-2'].includes(id)
      ? { id, status: 'active', role: 'learner' }
      : null;
  },
};
const supabaseAuth = {
  auth: {
    async getUser(token) {
      if (token === 'good-token') return { data: { user: { id: 'user-1' } }, error: null };
      if (token === 'second-token') return { data: { user: { id: 'user-2' } }, error: null };
      return { data: { user: null }, error: { status: 401 } };
    },
  },
};
const supabaseAdmin = {};

let bareServer;
let barePort;
let keyedServer;
let keyedPort;
let disabledServer;
let disabledPort;
let cappedServer;
let cappedPort;
const minted = [];

before(async () => {
  const base = {
    store, supabaseAuth, supabaseAdmin, allowedOrigin: ORIGIN,
    logger: { error() {}, warn() {} },
    createRealtimeSecret: async (options) => {
      minted.push(options);
      return { value: 'ek_route_secret', expiresAt: 42, model: 'gpt-realtime', voice: 'coral', maxSessionSeconds: 300 };
    },
  };
  bareServer = createAuthServer({ ...base, openaiRealtimeKey: '' });
  await new Promise((resolve) => bareServer.listen(0, '127.0.0.1', resolve));
  barePort = bareServer.address().port;

  keyedServer = createAuthServer({ ...base, openaiRealtimeKey: 'sk-secret' });
  await new Promise((resolve) => keyedServer.listen(0, '127.0.0.1', resolve));
  keyedPort = keyedServer.address().port;

  disabledServer = createAuthServer({ ...base, openaiRealtimeKey: 'sk-secret', onlineVoiceEnabled: false });
  await new Promise((resolve) => disabledServer.listen(0, '127.0.0.1', resolve));
  disabledPort = disabledServer.address().port;

  cappedServer = createAuthServer({ ...base, openaiRealtimeKey: 'sk-secret', realtimeMaxSessions: 2 });
  await new Promise((resolve) => cappedServer.listen(0, '127.0.0.1', resolve));
  cappedPort = cappedServer.address().port;
});

after(() => {
  bareServer?.close();
  keyedServer?.close();
  disabledServer?.close();
  cappedServer?.close();
});

function send(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const call = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    call.on('error', reject);
    if (body !== undefined) call.write(body);
    call.end();
  });
}

function session(port, { lang = 'en-IN', origin = ORIGIN, token = 'good-token', consent = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = `Bearer ${token}`;
  const body = consent === null ? { lang } : { lang, consent };
  return send(port, '/api/voice/realtime/session', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

test('realtime route: status names a boolean, and no key material leaves the process', async () => {
  const bare = await send(barePort, '/api/voice/realtime/status', { headers: { Origin: ORIGIN } });
  assert.equal(bare.status, 200);
  assert.deepEqual(JSON.parse(bare.text), { configured: false, enabled: true });

  const keyed = await send(keyedPort, '/api/voice/realtime/status', { headers: { Origin: ORIGIN } });
  assert.deepEqual(JSON.parse(keyed.text), { configured: true, enabled: true });
  assert.equal(keyed.text.includes('sk-secret'), false);

  const switchedOff = await send(disabledPort, '/api/voice/realtime/status', { headers: { Origin: ORIGIN } });
  assert.deepEqual(JSON.parse(switchedOff.text), { configured: true, enabled: false },
    'a configured key behind an off switch is not available voice');
});

test('realtime route: signing in, same-origin and a configured key are all required', async () => {
  const anonymous = await session(keyedPort, { token: null });
  assert.equal(anonymous.status, 401, 'a live audio session is tied to an account');

  const foreign = await session(keyedPort, { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403, 'another site cannot spend this account’s session');

  const noOrigin = await session(keyedPort, { origin: null });
  assert.equal(noOrigin.status, 403, 'a curl without an Origin header is not a browser');

  const unconfigured = await session(barePort);
  assert.equal(unconfigured.status, 503);
  assert.match(JSON.parse(unconfigured.text).error, /browser voice/, 'the fallback is named');
});

test('realtime route: the language is validated before any paid call', async () => {
  const bad = await session(keyedPort, { lang: 'fr-FR' });
  assert.equal(bad.status, 400);
  assert.match(JSON.parse(bad.text).error, /en-IN, hi-IN/);
});

test('realtime route: without the learner\u2019s consent no secret is minted', async () => {
  minted.length = 0;
  const anonymous = await session(keyedPort, { consent: null });
  assert.equal(anonymous.status, 400);
  assert.match(JSON.parse(anonymous.text).error, /consent/i);
  assert.equal(minted.length, 0, 'the provider is never called for a body that did not consent');
});

test('realtime route: the deployment switch turns online voice off without hiding the key state', async () => {
  const refused = await session(disabledPort);
  assert.equal(refused.status, 503);
  assert.match(JSON.parse(refused.text).error, /disabled on this server/i);
  assert.match(JSON.parse(refused.text).error, /browser voice/i, 'the fallback is still named');
});

test('realtime route: an operator can lower the session ceiling', async () => {
  const first = await session(cappedPort);
  assert.equal(first.status, 200);
  const second = await session(cappedPort);
  assert.equal(second.status, 200);
  const third = await session(cappedPort);
  assert.equal(third.status, 429, 'the configured ceiling of 2 is enforced, not the default 6');
});

test('realtime route: a session returns a short-lived secret and nothing else', async () => {
  minted.length = 0;
  const response = await session(keyedPort, { lang: 'hi-IN' });
  assert.equal(response.status, 200);

  const payload = JSON.parse(response.text);
  assert.deepEqual(Object.keys(payload).sort(), ['clientSecret', 'expiresAt', 'maxSessionSeconds', 'model', 'voice']);
  assert.equal(payload.clientSecret, 'ek_route_secret');
  assert.equal(response.text.includes('sk-secret'), false, 'the permanent key is never serialized');
  assert.equal(response.text.includes('instructions'), false);
  assert.equal(minted.length, 1);
  assert.equal(minted[0].lang, 'hi-IN', 'the browser names only the language; the server chooses the rest');
  assert.equal(minted[0].apiKey, 'sk-secret');
});

/* ---------------------------- no key in the bundle --------------------------- */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Everything the browser downloads: the whole `src` tree, which is what Vite bundles. */
function frontendFiles(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return frontendFiles(rel);
    return /\.(ts|tsx|css|json)$/.test(entry.name) ? [rel] : [];
  });
}

test('realtime: the permanent key cannot appear in frontend sources or the example config', () => {
  const offenders = [];
  for (const file of frontendFiles('src')) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (/\bVITE_[A-Z0-9_]*(OPENAI|REALTIME|API_KEY)/.test(text)) {
      offenders.push(`${file} reads a provider key through a VITE_ variable`);
    }
    if (/['"`]sk-[A-Za-z0-9]{12,}/.test(text)) offenders.push(`${file} embeds an sk- credential`);
  }
  assert.deepEqual(offenders, [], offenders.join(' | '));

  const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  assert.equal(envExample.includes('sk-'), false, '.env.example stays a template of empty values');
  for (const line of envExample.split('\n')) {
    const match = line.match(/^(OPENAI[A-Z0-9_]*)=(.*)$/);
    if (match) assert.equal(match[2].trim(), '', `${match[1]} must be empty in the example file`);
  }
});

test('realtime route: six sessions per window per account, then 429 — a second account is unaffected', async () => {
  // user-1 already spent budget above; user-2 shares the same address and must start with a clean
  // allowance. The key is account+address, so one account cannot drink another's quota.
  let allowed = 0;
  let rejected = 0;
  for (let i = 0; i < 8; i += 1) {
    const response = await session(keyedPort, { token: 'second-token' });
    if (response.status === 200) allowed += 1;
    else if (response.status === 429) rejected += 1;
    else assert.fail(`unexpected status ${response.status}`);
  }
  assert.equal(allowed, 6, 'the documented budget is enforced');
  assert.equal(rejected, 2);
  assert.equal(minted.at(-1).apiKey, 'sk-secret', 'the fake never sees a client-supplied key');
});
