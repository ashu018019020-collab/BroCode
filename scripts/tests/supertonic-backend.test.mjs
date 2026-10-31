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
  // The service is split into decision modules; the contract is the whole package, not one file.
  const app = [
    'services/supertonic-tts/app.py',
    'services/supertonic-tts/brocode_voice/config.py',
    'services/supertonic-tts/brocode_voice/engine.py',
    'services/supertonic-tts/brocode_voice/security.py',
    'services/supertonic-tts/brocode_voice/middleware.py',
    'services/supertonic-tts/brocode_voice/schemas.py',
  ].map(read).join('\n');
  assert.match(app, /from supertonic import TTS/, 'the official package, not a re-implementation');
  assert.match(app, /@app\.get\("\/healthz"\)/);
  assert.match(app, /@app\.get\("\/ready"\)/);
  assert.match(app, /@app\.post\("\/v1\/tts"\)/);
  assert.match(app, /HTTPBearer/, 'the shared bearer secret is required');
  assert.match(app, /hmac\.compare_digest/, 'constant-time secret comparison');
  assert.match(app, /synth_lock\.acquire/, 'ONNX sessions are serialized');
  assert.match(app, /audio\/wav/, 'the client decodes WAV');
  assert.match(app, /X-Voice-Engine/);
  assert.match(app, /@app\.get\("\/v1\/voices"\)/, 'the only offered voices are published');
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

test('backend: no model, runtime or download reaches the browser', () => {
  // This used to pin the opposite (a browser worker owning ONNX Runtime). The browser-side engine was
  // removed on request: the checkpoint is loaded once by the service above, and the page only ever
  // receives WAV. These assertions exist so the old architecture cannot be reintroduced by accident.
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies?.['onnxruntime-web'], undefined, 'the browser runtime is gone');
  assert.equal(pkg.devDependencies?.['onnxruntime-node'], undefined, 'no native runtime either');
  assert.equal(pkg.scripts?.prebuild, undefined, 'nothing copies WASM into the build any more');

  for (const gone of [
    'src/workers/tts.worker.ts',
    'src/core/voice/engine.ts',
    'src/core/voice/client.ts',
    'src/core/voice/assets.ts',
    'src/core/voice/style.ts',
    'scripts/ort-copy.mjs',
    'public/ort',
  ]) {
    assert.equal(exists(gone), false, `${gone} must not come back`);
  }

  for (const file of [
    'src/components/shared/useVoiceTutor.ts',
    'src/components/shared/AiVoiceRow.tsx',
    'src/core/ai/voice.ts',
    'src/core/voice/server.ts',
  ]) {
    assert.doesNotMatch(read(file), /onnxruntime/i, `${file} must not name the runtime`);
  }

  // The page speaks through the deployment, and the deployment is the only thing holding the model.
  assert.match(read('src/components/shared/useVoiceTutor.ts'), /createServerVoice/);
  assert.match(read('src/core/voice/server.ts'), /\/tts/, 'the client posts to the proxy route');
  // Exactly one female and one male voice, exactly two languages — the backend's own registry.
  const registry = read('services/supertonic-tts/brocode_voice/voice_registry.py');
  assert.match(registry, /VoiceOption\(id="F1", gender="female"/);
  assert.match(registry, /VoiceOption\(id="M1", gender="male"/);
  assert.match(registry, /LANGUAGES: tuple\[str, \.\.\.\] = \("en", "hi"\)/);
  assert.doesNotMatch(registry, /id="F[2-5]"|id="M[2-5]"/, 'no other preset is approved');
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
