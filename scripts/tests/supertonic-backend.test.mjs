/**
 * The Supertonic backend, and the guarantee that the browser no longer runs it.
 *
 * The Python service is tested directly with pytest (`services/supertonic-tts/tests`) because the
 * Node suite cannot import it. What this file pins is the contract AROUND it: the official pinned
 * package, a persistent cache, the routes/auth the proxy expects, the Render wiring, and the absence
 * of any on-device model download in the client.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(ROOT, file));

test('backend: the Python service uses the official SDK and the routes the proxy calls', () => {
  const app = read('services/supertonic-tts/app.py');
  assert.match(app, /from supertonic import TTS/, 'the official package, not a re-implementation');
  assert.match(app, /@app\.get\("\/healthz"\)/);
  assert.match(app, /@app\.get\("\/ready"\)/);
  assert.match(app, /@app\.post\("\/v1\/tts"\)/);
  assert.match(app, /HTTPBearer/, 'the shared bearer secret is required');
  assert.match(app, /hmac\.compare_digest/, 'constant-time secret comparison');
  assert.match(app, /state\.synth_lock\.acquire/, 'ONNX sessions are serialized');
  assert.match(app, /audio\/wav/, 'the client decodes WAV');
  assert.match(app, /X-Voice-Engine/);
  assert.match(app, /SUPERTONIC_CACHE_DIR/, 'the disk cache is configurable');
  assert.match(app, /SUPERTONIC_MODEL_REVISION/, 'the revision can be pinned explicitly');
  assert.doesNotMatch(app, /yield.*model download/i);
});

test('backend: the pinned package, container and cache are deployable as written', () => {
  assert.match(read('services/supertonic-tts/requirements.txt'), /supertonic\[serve\]==1\.3\.1/);
  const dockerfile = read('services/supertonic-tts/Dockerfile');
  assert.match(dockerfile, /python:3\.12-slim/);
  assert.match(dockerfile, /libsndfile1/);
  assert.match(dockerfile, /SUPERTONIC_CACHE_DIR=\/models\/supertonic3/);
  assert.match(dockerfile, /--workers 1/, 'one model per container');
  assert.match(dockerfile, /uvicorn app:app/);

  const blueprint = read('render.yaml');
  assert.match(blueprint, /services\/supertonic-tts\/Dockerfile/);
  assert.match(blueprint, /healthCheckPath: \/healthz/);
  assert.match(blueprint, /mountPath: \/models/);
  assert.match(blueprint, /724fb5abbf5502583fb520898d45929e62f02c0b/, 'the checkpoint revision is explicit');
  assert.match(blueprint, /TTS_SERVICE_SECRET/);
  assert.doesNotMatch(blueprint, /voice-service\/Dockerfile/, 'the Node service is not the deployed backend');
});

test('backend: the voice engine runs in the browser and the page never touches ONNX Runtime', () => {
  // The architecture this test used to pin (model on a server, nothing in the browser) was replaced
  // on request: the checkpoint now loads in a worker, so `onnxruntime-web` is a real dependency and
  // must be imported by exactly one file.
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies?.['onnxruntime-web'], 'the browser runtime is installed');
  assert.equal(pkg.devDependencies?.['onnxruntime-node'], undefined, 'no second native runtime to keep alive');
  assert.ok(exists('src/workers/tts.worker.ts'), 'the worker is the owner of the runtime');
  assert.ok(exists('src/core/voice/engine.ts'), 'the inference pipeline is a module of its own');

  for (const file of [
    'src/components/shared/useVoiceTutor.ts',
    'src/components/shared/AiVoiceRow.tsx',
    'src/core/ai/voice.ts',
    'src/core/voice/client.ts',
  ]) {
    assert.doesNotMatch(read(file), /onnxruntime/, `${file} must not import the runtime`);
  }
  assert.match(read('src/workers/tts.worker.ts'), /onnxruntime-web/, 'only the worker does');
});

test('backend: Vercel reaches the Python service through the same authenticated contract', () => {
  const shared = read('server/vercel-voice.mjs');
  assert.match(shared, /TTS_SERVICE_URL/);
  assert.match(shared, /TTS_SERVICE_SECRET/);
  const engine = read('server/voice-engine.mjs');
  assert.match(engine, /Authorization: `Bearer \$\{serviceSecret\}`/, 'the secret is forwarded server-side');
  assert.match(engine, /serviceTimeoutMs/, 'requests are bounded');
  assert.match(engine, /X-Voice-Engine|x-sample-rate/);
  assert.match(shared, /X-Voice-Engine/);
  assert.match(read('api/voice/tts.js'), /createTtsHandler/);
  assert.match(read('api/voice/status.js'), /createStatusHandler/);
});
