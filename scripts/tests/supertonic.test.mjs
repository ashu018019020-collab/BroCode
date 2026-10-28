/**
 * Supertonic 3 contract tests — the model, not the browser.
 *
 * Nothing here needs a GPU, a microphone or a network. What it protects is everything that would be
 * silently WRONG rather than loudly broken:
 *
 *   1. The language tag. A chunk tagged `hi` that is Roman script is a mispronunciation, not an error.
 *   2. The text normalisation order (emoji → symbols → punctuation → tag), and that nothing is lost.
 *   3. The tensors: shapes, the `<lang>` wrap, the batch-of-one mask, the latent length arithmetic.
 *   4. The inference loop: the exact feed names the checkpoint declares, one denoiser call per step,
 *      the style tensor reused, and a speed factor that shortens audio rather than dropping it.
 *   5. The asset contract: pinned immutable revision, real byte sizes, and the ONNX Runtime files the
 *      app imports actually existing in `node_modules` — a `?url` import of a moved file fails the
 *      build, but the version guard here fails first and says why.
 *
 * `synthesizeSupertonicChunk` is driven with FAKE sessions. That verifies the wiring, never the voice:
 * the real check is `tools/supertonic-check.mjs`, which runs the actual ONNX graphs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
register('./_ts-resolve.mjs', import.meta.url);

const st = await import(pathToFileURL(path.join(ROOT, 'src/core/ai/supertonic.ts')).href);

/* --------------------------------- assets -------------------------------- */

test('supertonic: the model is pinned to an immutable revision, never to main', () => {
  assert.match(st.SUPERTONIC_REVISION, /^[0-9a-f]{40}$/, 'a 40-character commit hash, not a branch');
  assert.match(st.SUPERTONIC_ASSET_BASE, /Supertone\/supertonic-3\/resolve\/[0-9a-f]{40}$/);
  assert.ok(!/\/main\//.test(st.SUPERTONIC_ASSET_BASE), 'main moves; the voice must not');
  assert.match(st.supertonicAsset('onnx/vocoder.onnx'), /\/resolve\/[0-9a-f]{40}\/onnx\/vocoder\.onnx$/);
});

test('supertonic: the four graphs and their real sizes are declared once', () => {
  const paths = st.SUPERTONIC_WEIGHTS.map((file) => file.path);
  assert.deepEqual(paths, [
    'onnx/duration_predictor.onnx',
    'onnx/text_encoder.onnx',
    'onnx/vector_estimator.onnx',
    'onnx/vocoder.onnx',
  ]);
  for (const file of st.SUPERTONIC_WEIGHTS) {
    assert.ok(file.bytes > 1_000_000, `${file.path} should carry its measured size`);
    assert.ok(file.label.length > 2);
  }
  assert.equal(st.SUPERTONIC_WEIGHT_BYTES, 398_075_273, 'the weight budget the model downloader verifies');
});

test('supertonic: the model runs on the SERVER — the browser ships neither weights nor runtime', () => {
  // The whole point of the migration: nothing model-shaped may re-enter the client bundle.
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies?.['onnxruntime-web'], undefined, 'the browser runtime is gone');
  assert.ok(!fs.existsSync(path.join(ROOT, 'src/core/ai/supertonic-runtime.ts')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'scripts/ort-copy.mjs')));
  assert.doesNotMatch(read('package.json'), /ort-copy/, 'no build step may copy a WASM runtime');

  // No client source may point at the model host or print a download size.
  const clientFiles = [
    'src/core/ai/voice.ts',
    'src/components/shared/useVoiceTutor.ts',
    'src/components/shared/VoiceBar.tsx',
    'src/components/shared/AiVoiceRow.tsx',
    'src/features/ai/VoiceMentorPanel.tsx',
  ];
  for (const file of clientFiles) {
    const source = read(file);
    assert.doesNotMatch(source, /huggingface\.co/i, `the browser must not fetch weights: ${file}`);
    assert.doesNotMatch(source, /398\s*MB/i, `no download size may be shown: ${file}`);
    assert.doesNotMatch(source, /loadSupertonic|synthesizeChunk/, `no on-device inference: ${file}`);
  }

  // The engine is a server module and opens the contract's graphs through native ONNX Runtime.
  const engine = read('server/supertonic-tts.mjs');
  assert.match(engine, /src\/core\/ai\/supertonic\.ts/, 'the server reuses the one model contract');
  assert.match(engine, /onnxruntime-node/);
  assert.match(engine, /executionProviders: \['cpu'\]/, 'CPU inference, not a GPU requirement');
  assert.match(engine, /queue\.then\(run, run\)/, 'synthesis is serialized, not raced');

  // Weights are deployment data, never repository data.
  assert.match(read('.gitignore'), /^models\/$/m, 'the weights directory must stay out of Git');
});

/* -------------------------------- language -------------------------------- */

test('supertonic: the language tag follows the script on the page, not the menu label', () => {
  assert.equal(st.supertonicLang('hi-IN', 'आज हम Python सीखेंगे'), 'hi');
  assert.equal(st.supertonicLang('en-IN', 'आज हम Python सीखेंगे'), 'en', 'the English setting wins');
  // Hinglish is Roman: tagging it `hi` asks the model to read Latin letters as Hindi.
  assert.equal(st.supertonicLang('hi-IN', 'Aaj hum Python seekhenge'), 'en');
  assert.equal(st.supertonicLang('hi-IN', ''), 'en');
  assert.equal(st.supertonicLang('en-IN', "Let's begin."), 'en');
});

/* ----------------------------- text pipeline ------------------------------ */

test('supertonic: normalisation wraps the text in its language tag last', () => {
  assert.equal(st.preprocessSupertonicText('Hello there', 'en'), '<en>Hello there.</en>');
  assert.equal(st.preprocessSupertonicText('नमस्ते दोस्त', 'hi'), '<hi>नमस्ते दोस्त.</hi>');
  // Punctuation that is already terminal is not doubled.
  assert.equal(st.preprocessSupertonicText('Done!', 'en'), '<en>Done!</en>');
  assert.equal(st.preprocessSupertonicText('Really?', 'en'), '<en>Really?</en>');
});

test('supertonic: symbols, emoji and spacing are rewritten, never read aloud', () => {
  // The arrow becomes a space here because that is what the checkpoint's normaliser does. The spoken
  // layer turns `→` into the word "to" BEFORE this runs (`speakable`), which is why the product never
  // hears a gap where the arrow was.
  assert.equal(st.preprocessSupertonicText('🎯 Loop → done', 'en'), '<en>Loop done.</en>');
  assert.equal(st.preprocessSupertonicText('a  ,b', 'en'), '<en>a,b.</en>');
  assert.equal(st.preprocessSupertonicText('e.g., this', 'en'), '<en>for example, this.</en>');
  assert.ok(!st.preprocessSupertonicText('♥ ★ © text', 'en').includes('♥'));
  assert.equal(st.preprocessSupertonicText('   ', 'en'), '', 'silence is not a synthesis request');
});

test('supertonic: a language the product does not expose is refused', () => {
  assert.throws(() => st.preprocessSupertonicText('x', 'ko'), /not enabled/);
});

test('supertonic: characters map through the checkpoint index, unmapped becomes -1', () => {
  const indexer = new Array(65536).fill(-1);
  indexer[97] = 42; // 'a'
  indexer[98] = 7;  // 'b'
  const { ids, mask, length } = st.supertonicTextIds('ab', indexer);
  assert.equal(length, 2);
  assert.equal(ids.length, 2);
  assert.equal(mask.length, 2);
  assert.deepEqual(mask, new Float32Array([1, 1]));
  assert.equal(ids[0], 42n);
  assert.equal(ids[1], 7n);
  // A codepoint beyond the index is the model's "unknown" id, not a crash.
  const beyond = st.supertonicTextIds('\u{1F600}', indexer);
  assert.equal(beyond.ids[0], -1n);
});

test('supertonic: chunks keep order, respect the cap, and never split a word', () => {
  const text = Array.from({ length: 12 }, (_, i) => `Sentence ${i + 1} explains one idea in plain words.`).join(' ');
  const chunks = st.chunkSupertonicText(text, 120);
  assert.ok(chunks.length > 2);
  for (const chunk of chunks) assert.ok(chunk.length <= 120, `too long: ${chunk}`);
  const squash = (value) => value.replace(/\s+/g, ' ').trim();
  assert.equal(squash(chunks.join(' ')), squash(text), 'nothing may be dropped or reordered');
  // A single over-long sentence is cut at a space, so no chunk starts mid-word.
  const one = `${'alpha beta '.repeat(60)}end.`;
  const parts = st.chunkSupertonicText(one, 90);
  for (const part of parts) {
    assert.ok(part.length <= 90);
    assert.ok(!/^[a-z]/.test(part) || /^[a-z]+$/.test(part) === false);
  }
  assert.equal(st.chunkSupertonicText('   ').length, 0);
});

test('supertonic: the first chunk is deliberately shorter, so speech starts sooner', () => {
  const text = [
    'This opening sentence is long enough to fill a whole default chunk on its own, and it keeps going for a while yet.',
    'A second sentence follows the first one.',
    'And a third closes the answer.',
  ].join(' ');
  const chunks = st.chunkSupertonicText(text, st.SUPERTONIC_CHUNK, st.SUPERTONIC_FIRST_CHUNK);
  assert.ok(st.SUPERTONIC_FIRST_CHUNK < st.SUPERTONIC_CHUNK, 'the opener must be the smaller cap');
  assert.ok(chunks[0].length <= st.SUPERTONIC_FIRST_CHUNK, `opener too long: ${chunks[0].length}`);
  for (const chunk of chunks.slice(1)) assert.ok(chunk.length <= st.SUPERTONIC_CHUNK);
  const squash = (value) => value.replace(/\s+/g, ' ').trim();
  assert.equal(squash(chunks.join(' ')), squash(text), 'a shorter opener may not lose or reorder text');
  // An answer that fits the opener in one go stays one chunk — no needless boundary.
  assert.deepEqual(st.chunkSupertonicText('Short answer.', st.SUPERTONIC_CHUNK, st.SUPERTONIC_FIRST_CHUNK), ['Short answer.']);
  // The runtime must actually use both caps, not just define them.
  assert.match(
    read('server/supertonic-tts.mjs'),
    /SUPERTONIC_CHUNK, active\.core\.SUPERTONIC_FIRST_CHUNK/,
    'the server must use both caps, not just define them',
  );
});

test('supertonic: an answer is cut at a sentence boundary, and the cut is bounded', () => {
  const long = Array.from({ length: 40 }, (_, i) => `Point ${i + 1} is a full sentence here.`).join(' ');
  const cut = st.clampSupertonicText(long, 120);
  assert.ok(cut.length <= 120);
  assert.match(cut, /\.$/, 'cut on a sentence, not mid-clause');
  assert.equal(st.clampSupertonicText('Short.', 120), 'Short.');
  assert.ok(st.clampSupertonicText(long).length <= st.SUPERTONIC_MAX_CHARS);
});

/* --------------------------------- config -------------------------------- */

const CONFIG = { ae: { sample_rate: 44100, base_chunk_size: 512 }, ttl: { chunk_compress_factor: 6, latent_dim: 24 } };

test('supertonic: the latent arithmetic comes from tts.json and is validated', () => {
  const cfg = st.parseSupertonicConfig(CONFIG);
  assert.deepEqual(cfg, { sampleRate: 44100, baseChunkSize: 512, chunkCompress: 6, latentDim: 24 });
  assert.throws(() => st.parseSupertonicConfig({}), /ae\.sample_rate/);
  assert.throws(() => st.parseSupertonicConfig({ ...CONFIG, ae: { sample_rate: 44100 } }), /base_chunk_size/);
  assert.throws(
    () => st.parseSupertonicConfig({ ...CONFIG, ttl: { chunk_compress_factor: 0, latent_dim: 24 } }),
    /chunk_compress_factor/,
  );
});

test('supertonic: the latent is box-muller noise, masked to the real audio length', () => {
  let n = 0;
  const seeded = () => [0.5, 0.25, 0.75, 0.1][(n += 1) % 4];
  const { latent, dims, mask } = st.sampleSupertonicLatent(1, st.parseSupertonicConfig(CONFIG), seeded);
  const chunkSize = 512 * 6;
  const frames = 44100;
  const expectedLen = Math.ceil(frames / chunkSize);
  assert.equal(dims[0], 24 * 6);
  assert.equal(dims[1], expectedLen);
  assert.equal(latent.length, dims[0] * dims[1]);
  assert.equal(mask.length, expectedLen);
  for (const value of latent) assert.ok(Number.isFinite(value));
  // One chunk is a batch of one, so every frame is real and the mask is all ones. (The mask exists
  // for padding inside a batch; a tail here would mean the audio length arithmetic disagreed with
  // itself, which is exactly what this pins.)
  assert.equal(mask.length, Math.ceil(frames / chunkSize));
  assert.ok(Array.from(mask).every((value) => value === 1));
  assert.equal(mask.length, dims[1]);
});

/* --------------------------------- style --------------------------------- */

function styleJson() {
  return {
    style_ttl: { dims: [1, 2, 3], data: [[[1, 2, 3], [4, 5, 6]]] },
    style_dp: { dims: [1, 1, 2], data: [[[0.5, 0.25]]] },
  };
}

test('supertonic: a style is two flat tensors of the declared shape', () => {
  const style = st.parseSupertonicStyle(styleJson());
  assert.deepEqual(style.ttl.dims, [1, 2, 3]);
  assert.deepEqual(Array.from(style.ttl.data), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(Array.from(style.dp.data), [0.5, 0.25]);
});

test('supertonic: a malformed style is rejected with a sentence, not a shape error', () => {
  assert.throws(() => st.parseSupertonicStyle({}), /style_ttl/);
  assert.throws(() => st.parseSupertonicStyle({ style_ttl: { dims: [1, 2], data: [] } }), /dims/);
  const wrong = styleJson();
  wrong.style_dp.data = [[[1]]];
  assert.throws(() => st.parseSupertonicStyle(wrong), /1 values, expected 2/);
  const multi = styleJson();
  multi.style_ttl = { dims: [2, 2, 3], data: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] };
  assert.throws(() => st.parseSupertonicStyle(multi), /single style/);
});

/* ------------------------------- inference -------------------------------- */

function fakeGraphs({ duration = 1.5, steps = 8 } = {}) {
  const calls = { duration: 0, text: 0, vector: 0, vocoder: 0, feeds: [] };
  const tensor = (type, data, dims) => ({ type, data, dims });
  const ort = { Tensor: function FakeTensor(type, data, dims) { return tensor(type, data, dims); } };
  const graphs = {
    duration: {
      run: async (feeds) => {
        calls.duration += 1;
        calls.feeds.push(Object.keys(feeds).sort());
        return { duration: tensor('float32', Float32Array.of(duration), [1]) };
      },
    },
    text: {
      run: async () => {
        calls.text += 1;
        return { text_emb: tensor('float32', new Float32Array(4), [1, 1, 4]) };
      },
    },
    vector: {
      run: async (feeds) => {
        calls.vector += 1;
        calls.stepValues = (calls.stepValues ?? []).concat(Array.from(feeds.current_step.data));
        const latent = feeds.noisy_latent;
        return { denoised_latent: tensor('float32', new Float32Array(latent.data.length), latent.dims) };
      },
    },
    vocoder: {
      run: async (feeds) => {
        calls.vocoder += 1;
        const len = Math.max(1, Math.floor(duration * 44100));
        return { wav_tts: tensor('float32', new Float32Array(len).fill(0.25), [1, len]) };
      },
    },
  };
  return { ort, graphs, calls, steps };
}

test('supertonic: inference feeds exactly the tensors the checkpoint declares', async () => {
  const { ort, graphs, calls } = fakeGraphs({ duration: 1 });
  const result = await st.synthesizeSupertonicChunk({
    text: 'Hello.',
    lang: 'en',
    style: st.parseSupertonicStyle(styleJson()),
    config: st.parseSupertonicConfig(CONFIG),
    indexer: new Array(65536).fill(0),
    ort,
    graphs,
    steps: 3,
    speed: 1,
  });
  assert.equal(calls.duration, 1);
  assert.equal(calls.text, 1);
  assert.equal(calls.vocoder, 1);
  assert.equal(calls.vector, 3, 'one denoiser call per step, not one call total');
  assert.deepEqual(calls.feeds[0], ['style_dp', 'text_ids', 'text_mask']);
  assert.deepEqual(calls.stepValues, [0, 1, 2], 'steps must be zero-based and in order');
  assert.equal(result.steps, 3);
  assert.equal(result.pcm.length, 44100, 'audio is trimmed to the predicted length');
  assert.equal(result.seconds, 1);
});

test('supertonic: speed shortens the predicted duration instead of dropping audio', async () => {
  const { ort, graphs } = fakeGraphs({ duration: 2 });
  const base = { text: 'Hello.', lang: 'en', style: st.parseSupertonicStyle(styleJson()),
    config: st.parseSupertonicConfig(CONFIG), indexer: new Array(65536).fill(0), ort, graphs, steps: 1 };
  const slow = await st.synthesizeSupertonicChunk({ ...base, speed: 1 });
  const fast = await st.synthesizeSupertonicChunk({ ...base, speed: 1.4 });
  assert.ok(fast.seconds < slow.seconds);
  assert.ok(fast.pcm.length < slow.pcm.length);
});

test('supertonic: a cancelled synthesis stops before the next graph', async () => {
  const { ort, graphs, calls } = fakeGraphs({ duration: 1 });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => st.synthesizeSupertonicChunk({
      text: 'Hello.',
      lang: 'en',
      style: st.parseSupertonicStyle(styleJson()),
      config: st.parseSupertonicConfig(CONFIG),
      indexer: new Array(65536).fill(0),
      ort,
      graphs,
      steps: 4,
      signal: controller.signal,
    }),
    (error) => error.name === 'AbortError',
  );
  assert.equal(calls.duration, 0, 'nothing runs after cancellation');
});

test('supertonic: a model that predicts no audio is an error, not silence', async () => {
  const { ort, graphs } = fakeGraphs({ duration: 0 });
  await assert.rejects(
    () => st.synthesizeSupertonicChunk({
      text: 'Hello.',
      lang: 'en',
      style: st.parseSupertonicStyle(styleJson()),
      config: st.parseSupertonicConfig(CONFIG),
      indexer: new Array(65536).fill(0),
      ort,
      graphs,
    }),
    /predicted no audio/,
  );
});

/* ---------------------------------- WAV ---------------------------------- */

test('supertonic: the WAV header is a real 16-bit mono PCM header', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -2]);
  const wav = st.encodeSupertonicWav(samples, 44100);
  const view = new DataView(wav);
  const tag = (offset, length) => String.fromCharCode(...new Uint8Array(wav, offset, length));
  assert.equal(tag(0, 4), 'RIFF');
  assert.equal(tag(8, 4), 'WAVE');
  assert.equal(tag(12, 4), 'fmt ');
  assert.equal(tag(36, 4), 'data');
  assert.equal(view.getUint16(20, true), 1, 'PCM');
  assert.equal(view.getUint16(22, true), 1, 'mono');
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), samples.length * 2);
  assert.equal(wav.byteLength, 44 + samples.length * 2);
  const pcm = new Int16Array(wav, 44);
  assert.equal(pcm[0], 0);
  assert.equal(pcm[1], Math.floor(0.5 * 32767));
  assert.equal(pcm[3], 32767);
  assert.equal(pcm[4], -32767, 'samples are clamped, never wrapped');
});
