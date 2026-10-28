/**
 * The tutor's voice API — `GET /api/voice/status` and `POST /api/voice/tts`.
 *
 * Two things these tests exist to pin:
 *
 *  1. The Google key is SERVER-side state. The status route names only a boolean, the synthesize
 *     route is the only path that can reach Google, and a deployment without the key answers 503
 *     with copy that tells the client to use its browser voice — the app keeps speaking either way.
 *  2. What Google would receive is a pure function (`buildGoogleTtsRequest`), so voice choice,
 *     rate clamping and the text bound are testable with no network and no key. The synthesize
 *     call itself is injected, so the HTTP behaviour (status codes, audio bytes, rate limiting,
 *     same-origin) is tested against a fake that records exactly what it was asked to say.
 *
 * Zero dependencies: node:test, node:http, and the server modules themselves.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { request as httpRequest } from 'node:http';
import { createAuthServer } from '../../server/app.mjs';
import { buildGoogleTtsRequest, synthesizeGoogleTts, toSsml } from '../../server/voice.mjs';

const ORIGIN = 'http://localhost:5173';

/* --------------------------- the pure request builder --------------------------- */

test('voice-server: the Google request keeps Hindi text, clamps the rate and names a Neural2 voice', () => {
  const body = buildGoogleTtsRequest({ text: '  Loops samajhte hain.  ', lang: 'hi-IN', rate: 3 });
  assert.equal(body.input.text, 'Loops samajhte hain.', 'text is trimmed, not rewritten');
  assert.equal(body.voice.languageCode, 'hi-IN');
  assert.equal(body.voice.name, 'hi-IN-Neural2-A', 'natural Hindi by default');
  assert.equal(body.audioConfig.speakingRate, 2, 'Google rejects above 2 — clamp, never relay');
  assert.equal(body.audioConfig.audioEncoding, 'MP3');

  const slow = buildGoogleTtsRequest({ text: 'x', lang: 'en-IN', rate: 0.1 });
  assert.equal(slow.audioConfig.speakingRate, 0.5, 'and below 0.5');
  assert.equal(slow.voice.name, 'en-IN-Neural2-A');

  const overridden = buildGoogleTtsRequest({ text: 'x', lang: 'hi-IN', rate: 'nonsense', voiceName: 'hi-IN-Wavenet-B' });
  assert.equal(overridden.audioConfig.speakingRate, 1, 'an unreadable rate is the normal rate');
  assert.equal(overridden.voice.name, 'hi-IN-Wavenet-B', 'a deployment without Neural2 can override');
});

test('voice-server: a multi-sentence passage travels as SSML so the voice breathes between sentences', () => {
  const body = buildGoogleTtsRequest({
    text: 'A list is ordered. You can append to it. Indexing is O(1).',
    lang: 'en-IN',
    rate: 1,
  });
  assert.ok(body.input.ssml, 'more than one sentence means real pauses');
  assert.equal(body.input.text, undefined, 'text and ssml are alternatives, never both');
  assert.match(body.input.ssml, /^<speak>/);
  assert.equal((body.input.ssml.match(/<break time="220ms"\/>/g) ?? []).length, 2,
    'one break per sentence boundary, none at the ends');
  assert.match(body.input.ssml, /A list is ordered\./);
  assert.equal(body.voice.ssmlGender, 'FEMALE', 'one consistent tutor voice, even with a voice override');

  // A single sentence keeps the plain `text` input: there is nothing to pause between.
  const single = buildGoogleTtsRequest({ text: 'A tuple is immutable.', lang: 'en-IN', rate: 1 });
  assert.equal(single.input.text, 'A tuple is immutable.');
  assert.equal(single.input.ssml, undefined);
});

test('voice-server: SSML escapes the text, so a code sample can never break the request', () => {
  const ssml = toSsml('Compare a < b & c > d. Then print "x".');
  assert.match(ssml, /a &lt; b &amp; c &gt; d/, 'XML metacharacters from a learner’s code are escaped');
  assert.match(ssml, /&quot;x&quot;/);
  assert.doesNotMatch(ssml, /(?<!&lt;)<(?!speak>|\/speak>|break )/, 'no raw tag survives from the source');

  // Breaks are clamped, not trusted: a caller cannot ask for a two-second silence per sentence.
  assert.match(toSsml('One. Two.', 99999), /<break time="2000ms"\/>/);
  assert.match(toSsml('One. Two.', 1), /<break time="50ms"\/>/);
});

test('voice-server: the text bound is enforced by slicing — Google never sees an oversized chunk', () => {
  const long = 'अ'.repeat(900);
  const body = buildGoogleTtsRequest({ text: long, lang: 'hi-IN', rate: 1 });
  assert.equal(body.input.text.length, 480, 'sliced to the documented bound');
  assert.ok(Buffer.byteLength(body.input.text, 'utf8') < 5000, 'well under Google’s 5,000-byte cap');
});

/* --------------------------- the synthesize call (fakes) --------------------------- */

test('voice-server: synthesize maps every failure to an honest code, and never leaks the key', async () => {
  await assert.rejects(
    synthesizeGoogleTts({ apiKey: '', text: 'hi', lang: 'hi-IN', rate: 1 }),
    (error) => error.code === 'voice-unconfigured',
  );
  await assert.rejects(
    synthesizeGoogleTts({ apiKey: 'k', text: 'hi', lang: 'fr-FR', rate: 1 }),
    (error) => error.code === 'voice-bad-lang',
  );

  const seenUrl = [];
  const refuse = async (url) => { seenUrl.push(url); return { ok: false, status: 403 }; };
  let refusalMessage = '';
  await assert.rejects(
    synthesizeGoogleTts({ apiKey: 'secret-key', text: 'hi', lang: 'hi-IN', rate: 1, fetchImpl: refuse }),
    (error) => { refusalMessage = error.message; return error.code === 'voice-unavailable'; },
  );
  assert.ok(seenUrl[0].includes('key=secret-key'), 'the key travels in the URL, as Google documents');
  assert.doesNotMatch(refusalMessage, /secret-key/, 'the error message must not echo the key');

  await assert.rejects(
    synthesizeGoogleTts({
      apiKey: 'k', text: 'hi', lang: 'hi-IN', rate: 1,
      fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    }),
    (error) => error.code === 'voice-unavailable',
    'an empty answer is a failure, not silence pretending to be speech',
  );

  const audio = await synthesizeGoogleTts({
    apiKey: 'k', text: 'hi', lang: 'hi-IN', rate: 1,
    fetchImpl: async () => ({ ok: true, json: async () => ({ audioContent: Buffer.from('mp3-bytes').toString('base64') }) }),
  });
  assert.equal(audio.toString(), 'mp3-bytes', 'audioContent is base64 audio, decoded for the wire');
});

/* ------------------------------ the HTTP routes ------------------------------ */

// The fakes mirror scripts/tests/auth.test.mjs: a store that only says its own name, and an auth
// client that never gets called — the voice routes are anonymous by design (speech is not a
// learner record), which is exactly why they carry an origin check and a rate limit instead.
const store = {
  name: 'voice-test-store',
  async health() {},
  async getProfile() { return null; },
};
const supabaseAuth = { auth: { async getUser() { return { data: { user: null }, error: { status: 401 } }; } } };
const supabaseAdmin = {};

let bareServer;
let barePort;
let keyedServer;
let keyedPort;
const spoken = [];
let failNext = null;

async function fakeSynthesize({ text, lang, rate, voiceName }) {
  if (failNext) { const error = new Error('boom'); error.code = failNext; failNext = null; throw error; }
  spoken.push({ text, lang, rate, voiceName });
  return Buffer.from(`audio:${text}`);
}

before(async () => {
  bareServer = createAuthServer({
    store, supabaseAuth, supabaseAdmin, allowedOrigin: ORIGIN,
    logger: { error() {}, warn() {} },
    googleTtsKey: '',
    synthesizeTts: fakeSynthesize,
  });
  await new Promise((resolve) => bareServer.listen(0, '127.0.0.1', resolve));
  barePort = bareServer.address().port;

  keyedServer = createAuthServer({
    store, supabaseAuth, supabaseAdmin, allowedOrigin: ORIGIN,
    now: () => Date.now(),
    logger: { error() {}, warn() {} },
    googleTtsKey: 'test-key',
    googleTtsVoices: { 'hi-IN': 'hi-IN-Wavenet-A' },
    synthesizeTts: fakeSynthesize,
  });
  await new Promise((resolve) => keyedServer.listen(0, '127.0.0.1', resolve));
  keyedPort = keyedServer.address().port;
});

after(() => {
  bareServer?.close();
  keyedServer?.close();
});

function send(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const call = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        text: Buffer.concat(chunks).toString('utf8'),
        bytes: Buffer.concat(chunks),
      }));
    });
    call.on('error', reject);
    if (body !== undefined) call.write(body);
    call.end();
  });
}

const post = (port, payload) => send(port, '/api/voice/tts', {
  method: 'POST',
  headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

test('voice-server: status names the engine and never the key', async () => {
  const bare = await send(barePort, '/api/voice/status', { headers: { Origin: ORIGIN } });
  assert.equal(bare.status, 200);
  const bareBody = JSON.parse(bare.text);
  assert.equal(bareBody.configured, false);
  assert.equal(bareBody.engine, 'none');
  assert.equal(bareBody.ready, false);
  assert.match(bareBody.reason, /No server voice/);
  assert.deepEqual(bareBody.langs, ['en-IN', 'hi-IN']);

  const keyed = await send(keyedPort, '/api/voice/status', { headers: { Origin: ORIGIN } });
  const keyedBody = JSON.parse(keyed.text);
  assert.equal(keyedBody.configured, true);
  assert.equal(keyedBody.engine, 'google', 'the response names the engine that will speak');
  assert.equal(keyedBody.engineLabel, 'Google Neural2 (server)');
  assert.ok(!keyed.text.includes('test-key'), 'no key material in the response');
  assert.ok(!keyed.text.includes('tts-service.invalid'), 'no backend URL in the response');
});

test('voice-server: without a key the synthesize route says so and points at the browser voice', async () => {
  const response = await post(barePort, { text: 'Hello', lang: 'en-IN', rate: 1 });
  assert.equal(response.status, 503);
  assert.match(JSON.parse(response.text).error, /browser voice/);
});

test('voice-server: with a key the route returns MP3 bytes and passes the voice through', async () => {
  spoken.length = 0;
  const response = await post(keyedPort, { text: 'Loops samajhte hain.', lang: 'hi-IN', rate: 1.2 });
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'audio/mpeg');
  assert.equal(response.text, 'audio:Loops samajhte hain.');
  assert.deepEqual(spoken, [{ text: 'Loops samajhte hain.', lang: 'hi-IN', rate: 1.2, voiceName: 'hi-IN-Wavenet-A' }],
    'the deployment’s voice override reaches the synthesizer');
});

test('voice-server: input is validated before Google is paid for it', async () => {
  assert.equal((await post(keyedPort, { text: 'Hello', lang: 'fr-FR', rate: 1 })).status, 400);
  assert.equal((await post(keyedPort, { text: '   ', lang: 'en-IN', rate: 1 })).status, 400);
  assert.equal((await post(keyedPort, { text: 'x'.repeat(481), lang: 'en-IN', rate: 1 })).status, 400,
    'the chunk bound is enforced server-side, not trusted from the client');
  assert.equal((await post(keyedPort, { text: 'Hello' })).status, 400, 'a missing language is refused');
});

test('voice-server: the synthesize route is same-origin only', async () => {
  const foreign = await send(keyedPort, '/api/voice/tts', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Hello', lang: 'en-IN', rate: 1 }),
  });
  assert.equal(foreign.status, 403);
  const noOrigin = await send(keyedPort, '/api/voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Hello', lang: 'en-IN', rate: 1 }),
  });
  assert.equal(noOrigin.status, 403, 'a curl without an Origin header is not a browser');
});

test('voice-server: a Google failure becomes 502/429, never raw Google text', async () => {
  failNext = 'voice-unavailable';
  const down = await post(keyedPort, { text: 'Hello', lang: 'en-IN', rate: 1 });
  assert.equal(down.status, 502);
  assert.match(JSON.parse(down.text).error, /temporarily unavailable/i, 'the learner gets an actionable line');
  assert.ok(!JSON.parse(down.text).error.includes('voice-unavailable'), 'no internal code leak');

  failNext = 'voice-rate-limited';
  const limited = await post(keyedPort, { text: 'Hello', lang: 'en-IN', rate: 1 });
  assert.equal(limited.status, 429);
});

test('voice-server: one tab can be rate-limited out of spending the whole quota', async () => {
  // The keyed server allows 30 requests a minute per client address. The tests above already spent
  // a handful in this same window, so the exact split here is bounded rather than exact.
  let allowed = 0;
  let rejected = 0;
  for (let i = 0; i < 40; i += 1) {
    const response = await post(keyedPort, { text: `chunk ${i}`, lang: 'en-IN', rate: 1 });
    if (response.status === 200) allowed += 1;
    else if (response.status === 429) rejected += 1;
    else assert.fail(`unexpected status ${response.status}`);
  }
  assert.ok(allowed >= 15 && allowed <= 32, `the window should allow ~30, allowed ${allowed}`);
  assert.ok(rejected >= 8, `the rest must be refused with 429, rejected ${rejected}`);
});
