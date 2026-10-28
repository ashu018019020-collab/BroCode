/**
 * The server voice engine — which engine speaks, and what happens when it cannot.
 *
 * Everything here runs against a FAKE fetch. That is deliberate: the assertions are about the
 * decisions a deployment can get wrong (claiming Supertonic while Google answered, hiding a dead
 * service behind a Google key, passing a secret to the wrong place), not about audio quality. The
 * real audio check is `tools/supertonic-check.mjs`; the real HTTP surface is exercised by
 * `interview-api.test.mjs` and the browser suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { createVoiceEngine } = await import(
  new URL('../../server/voice-engine.mjs', import.meta.url).href
);

const AUDIO = Buffer.from([0x52, 0x49, 0x46, 0x46]); // "RIFF" is enough for a byte assertion

/** A fetch double: records calls, answers from a routing table. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const route = routes.find((entry) => String(url).includes(entry.match));
    if (!route) throw new TypeError(`unexpected fetch: ${url}`);
    if (route.error) throw route.error;
    return {
      ok: route.status ? route.status < 400 : true,
      status: route.status ?? 200,
      headers: new Headers(route.headers ?? {}),
      json: async () => route.json ?? {},
      arrayBuffer: async () => (route.audio ?? AUDIO).buffer.slice(0, (route.audio ?? AUDIO).length),
    };
  };
  return { impl, calls };
}

test('voice engine: with no configuration, the status says so instead of pretending', async () => {
  const engine = createVoiceEngine({});
  const status = await engine.status();
  assert.equal(status.configured, false);
  assert.equal(status.engine, 'none');
  assert.match(status.reason, /No server voice/);
  assert.deepEqual(status.langs, ['en-IN', 'hi-IN']);
  await assert.rejects(engine.speak({ text: 'hello', lang: 'en-IN' }), /not configured/);
});

test('voice engine: Supertonic is preferred, and its status needs a real health answer', async () => {
  const { impl, calls } = fakeFetch([
    { match: '/healthz', json: { ok: true, ready: true } },
  ]);
  const engine = createVoiceEngine({
    serviceUrl: 'http://voice.internal:8080/',
    serviceSecret: 's3cret',
    googleKey: 'google-key',
    fetchImpl: impl,
  });

  const status = await engine.status();
  assert.equal(status.engine, 'supertonic');
  assert.equal(status.configured, true, 'a reachable service is what makes it configured');
  assert.equal(status.engineLabel, 'Supertonic 3 (server)');
  assert.equal(calls[0].url, 'http://voice.internal:8080/healthz', 'no doubled slash');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer s3cret');
});

test('voice engine: a configured but unreachable service is reported, never silently swapped', async () => {
  const { impl } = fakeFetch([
    { match: '/healthz', error: new Error('ECONNREFUSED') },
  ]);
  const engine = createVoiceEngine({
    serviceUrl: 'http://voice.internal:8080',
    serviceSecret: 's3cret',
    googleKey: 'google-key',
    fetchImpl: impl,
  });
  const status = await engine.status();
  assert.equal(status.engine, 'supertonic');
  assert.equal(status.configured, false);
  assert.match(status.reason, /unreachable/);
});

test('voice engine: the secret is sent to the service and never to the response', async () => {
  const { impl, calls } = fakeFetch([
    {
      match: '/v1/tts',
      headers: { 'content-type': 'audio/wav', 'x-sample-rate': '44100' },
    },
  ]);
  const engine = createVoiceEngine({
    serviceUrl: 'https://tts.example',
    serviceSecret: 'top-secret',
    fetchImpl: impl,
  });
  const result = await engine.speak({ text: 'नमस्ते', lang: 'hi-IN', rate: 1.2 });
  assert.equal(result.engine, 'supertonic');
  assert.equal(result.contentType, 'audio/wav');
  assert.equal(result.sampleRate, 44100);
  assert.ok(Buffer.isBuffer(result.audio));
  const post = calls.find((call) => call.url.includes('/v1/tts'));
  assert.equal(post.options.method, 'POST');
  assert.equal(post.options.headers.Authorization, 'Bearer top-secret');
  assert.deepEqual(JSON.parse(post.options.body), { text: 'नमस्ते', lang: 'hi-IN', rate: 1.2 });
  assert.ok(!JSON.stringify(result).includes('top-secret'), 'the token must never travel onward');
});

test('voice engine: a failed service falls back to Google, and the label follows the audio', async () => {
  const warnings = [];
  const { impl } = fakeFetch([
    { match: '/v1/tts', status: 503 },
  ]);
  const engine = createVoiceEngine({
    serviceUrl: 'https://tts.example',
    googleKey: 'google-key',
    synthesizeGoogle: async () => AUDIO,
    fetchImpl: impl,
    logger: { warn: (...args) => warnings.push(args) },
  });
  const result = await engine.speak({ text: 'Hello', lang: 'en-IN' });
  assert.equal(result.engine, 'google', 'the response must name the engine that actually spoke');
  assert.equal(result.contentType, 'audio/mpeg');
  assert.equal(warnings.length, 1, 'the downgrade is logged, not hidden');

  // With no Google key the same failure is an error the route can map to 502.
  const bare = createVoiceEngine({ serviceUrl: 'https://tts.example', fetchImpl: impl, logger: { warn() {} } });
  await assert.rejects(bare.speak({ text: 'Hello', lang: 'en-IN' }), (error) => {
    assert.equal(error.code, 'voice-unavailable');
    return true;
  });
});

test('voice engine: text, language and size are validated before any network call', async () => {
  const { impl, calls } = fakeFetch([{ match: '/v1/tts' }]);
  const engine = createVoiceEngine({ serviceUrl: 'https://tts.example', fetchImpl: impl });
  await assert.rejects(engine.speak({ text: '   ', lang: 'en-IN' }), /Text is required/);
  await assert.rejects(engine.speak({ text: 'x'.repeat(481), lang: 'en-IN' }), /at most 480/);
  await assert.rejects(engine.speak({ text: 'hello', lang: 'fr-FR' }), /supported voice language/);
  assert.equal(calls.length, 0, 'nothing is sent upstream for a request that is already invalid');
});

test('voice engine: a non-audio 200 is a failure, not a silent no-op', async () => {
  const { impl } = fakeFetch([
    { match: '/v1/tts', headers: { 'content-type': 'text/html' }, audio: Buffer.from('<html>') },
  ]);
  const engine = createVoiceEngine({ serviceUrl: 'https://tts.example', fetchImpl: impl });
  await assert.rejects(engine.speak({ text: 'Hello', lang: 'en-IN' }), /not audio/);
});

test('voice service: it refuses to start without a secret and caps the body', () => {
  const service = read('voice-service/server.mjs');
  assert.match(service, /TTS_SERVICE_SECRET is required/, 'an open inference endpoint is not an option');
  assert.match(service, /timingSafeEqual/, 'the bearer comparison is constant-time');
  assert.match(service, /MAX_BODY_BYTES/, 'a huge body is rejected before a tensor is built');
  assert.match(service, /\/healthz/);
  assert.match(service, /'\/v1\/tts'/);
  assert.match(service, /X-Voice-Engine/, 'audio says which engine produced it');

  const docker = read('voice-service/Dockerfile');
  assert.match(docker, /FROM node:24/, 'Node 24 is what runs the task contract through type stripping');
  assert.match(docker, /onnxruntime-node/, 'the native runtime is installed in the image');
  assert.match(docker, /VOLUME \["\/models"\]/, 'weights live on a volume, not in the image');
  assert.match(docker, /HEALTHCHECK/);
  assert.match(docker, /SUPERTONIC_AUTO_FETCH/, 'a fresh volume fills itself');
});

test('voice deploy: the Render blueprint matches the service contract', () => {
  const yaml = read('render.yaml');
  assert.match(yaml, /runtime: docker/);
  assert.match(yaml, /dockerfilePath: \.\/voice-service\/Dockerfile/);
  assert.match(yaml, /healthCheckPath: \/healthz/, 'Render must poll the real readiness route');
  assert.match(yaml, /mountPath: \/models/, 'the weights live on a disk, never in the image');
  assert.match(yaml, /SUPERTONIC_MODEL_DIR[\s\S]{0,80}\/models\/supertonic-3/);
  assert.match(yaml, /TTS_SERVICE_SECRET[\s\S]{0,80}generateValue: true/, 'the token is generated, not hard-coded');
  assert.match(yaml, /autoDeploy: true/);
  // A free instance cannot attach a disk and unloads the model after idle — the weights would be lost.
  assert.match(yaml, /plan: (starter|standard)/, 'the plan must support a persistent disk');
  assert.doesNotMatch(yaml, /TTS_SERVICE_SECRET:\s*[A-Za-z0-9]/, 'no literal secret in the blueprint');
});

test('voice deploy: the wiring check proves auth, both languages and production', () => {
  const script = read('scripts/voice-deploy-check.mjs');
  assert.match(script, /\/healthz/);
  assert.match(script, /Authorization: `Bearer \$\{SECRET\}`/);
  assert.match(script, /'en-IN'/);
  assert.match(script, /'hi-IN'/);
  assert.match(script, /RIFF/);
  assert.match(script, /\/api\/voice\/status/, 'the check must include the wiring half');
  assert.ok(!/console\.log\([^\n]*SECRET/.test(script), 'the token is never printed');
  assert.match(read('package.json'), /"voice:check": "node scripts\/voice-deploy-check\.mjs"/);
});

test('voice service: the model is fetched from the pinned revision, on the server only', () => {
  const script = read('scripts/voice-model.mjs');
  assert.match(script, /src\/core\/ai\/supertonic\.ts/, 'URLs and sizes come from the one contract');
  assert.match(script, /supertonicAsset\(/, 'the pinned revision is reused, not re-typed');
  assert.match(script, /statSync\(target\)\.size/, 'an existing complete file is not re-downloaded');
  assert.match(script, /expected \$\{expectedBytes\}/, 'a truncated download is rejected');
  assert.match(read('package.json'), /"voice:model": "node scripts\/voice-model\.mjs"/);
});
