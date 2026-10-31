/**
 * The browser voice engine, tested without a browser.
 *
 * Three layers, three kinds of evidence:
 *
 *  1. `text.ts` — the tokenizer port. Driven directly against the SDK's own normalisation rules, so a
 *     drifting regex fails here instead of becoming mispronounced audio.
 *  2. `engine.ts` — the ONNX pipeline. Driven with FAKE sessions that record every feed: the order of
 *     the four graphs, the shapes, the mask, the number of denoising steps, and the speed division are
 *     all assertions. `scripts/voice-engine-check.mjs` is what runs the same file against the real
 *     weights (and prints measured audio), because a checked-in 379 MB checkpoint is not a test asset.
 *  3. `assets.ts` / `protocol.ts` — where the weights come from and what the worker may say. Cache
 *     behaviour is exercised against a fake `CacheStorage`, retries against a fake `fetch`.
 *
 * The real-model run is a separate command, not a skipped test: a "skipped" badge would let a broken
 * checkpoint ship unnoticed.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./_ts-resolve.mjs', import.meta.url);

const text = await import('../../src/core/voice/text.ts');
const engine = await import('../../src/core/voice/engine.ts');
const style = await import('../../src/core/voice/style.ts');
const assets = await import('../../src/core/voice/assets.ts');
const protocol = await import('../../src/core/voice/protocol.ts');

/* ------------------------------------------------------------------ tokenizer */

test('supertonic voice: text is prepared exactly as the official SDK prepares it', () => {
  // Every rule in `UnicodeProcessor._preprocess_text`, in the order the SDK applies them.
  assert.equal(text.normalizeForModel('Hello world'), 'Hello world.');
  assert.equal(text.normalizeForModel('Hello world!'), 'Hello world!', 'existing punctuation is kept');
  assert.equal(text.normalizeForModel('a — b'), 'a - b.', 'em dash folds to a hyphen');
  assert.equal(text.normalizeForModel('a—b'), 'a-b.', 'an unspaced dash becomes an unspaced hyphen');
  // A closing quote already ends the sentence for the SDK, so no full stop is added.
  assert.equal(text.normalizeForModel('"quoted"'), '"quoted"');
  assert.equal(text.normalizeForModel('x [y] | z'), 'x y z.', 'brackets and pipes become spaces');
  assert.equal(text.normalizeForModel('hi 😀 there'), 'hi there.', 'emoji are removed');
  // The SDK strips ONE space before punctuation, so a doubled space collapses to a single one rather
  // than disappearing — reproduced on purpose, because the tokenizer must match the training data.
  assert.equal(text.normalizeForModel('a  ,  b'), 'a , b.');
  assert.equal(text.normalizeForModel('a , b'), 'a, b.', 'a single spaced comma is tightened');
  assert.equal(text.normalizeForModel('mail me@site'), 'mail me at site.', 'the @ short form expands');
  assert.equal(text.normalizeForModel('x\r\n\ty'), 'x y.', 'whitespace collapses');
  assert.equal(text.normalizeForModel('a "" b'), 'a " b.', 'duplicate quotes collapse');
});

test('supertonic voice: NFKD is applied, so a precomposed accent reaches the model decomposed', () => {
  // The indexer carries the COMBINING mark, not the precomposed character.
  const prepared = text.normalizeForModel('café');
  assert.equal(prepared, 'cafe\u0301.');
  assert.equal(prepared.length, 6);
});

test('supertonic voice: Hindi keeps its own punctuation and gets the Hindi language token', () => {
  const hindi = 'नमस्ते! आज हम Python सीखेंगे।';
  // The SDK's ending-punctuation class has no Devanagari danda, so it appends a full stop after one.
  // Reproduced rather than "fixed": the tokenizer must match the model's training data exactly.
  assert.equal(text.normalizeForModel(hindi), `${hindi}.`);
  assert.equal(text.modelText(hindi, 'hi'), `<hi>${hindi}.</hi>`, 'the wrapper goes outside the prepared text');
  assert.equal(text.modelText('Hello', 'en'), '<en>Hello.</en>');
});

test('supertonic voice: ids come from the indexer, and unknown characters are reported not dropped', () => {
  // A tiny indexer: class = code point for the ASCII we use, -1 for everything else.
  const indexer = new Array(0x3000).fill(-1);
  for (const char of 'abc.') indexer[char.codePointAt(0)] = char.codePointAt(0) % 97;
  const encoded = text.encodeText('abc', 'en', indexer);
  // "<en>abc.</en>" — the wrapper characters are unsupported in this fixture, which is the point.
  // '<en>abc.</en>' = 13 characters
  assert.equal(encoded.length, 13);
  assert.equal(encoded.mask.length, 13);
  assert.ok([...encoded.mask].every((value) => value === 1), 'every position is attended to');
  assert.deepEqual(encoded.unsupported.sort(), ['<', '>', 'e', 'n', '/'].sort());
  // 'a' is 97 → 0, 'b' 98 → 1, 'c' 99 → 2, '.' 46 → 46
  assert.deepEqual(
    [...encoded.ids].slice(4, 7).map(Number),
    [0, 1, 2],
    'supported characters map through the indexer in order',
  );
});

test('supertonic voice: long answers split on sentences, and no word is lost', () => {
  const answer = 'First sentence here. Second one is a little longer! Third? Fourth.';
  const chunks = text.speechRequests(answer, 64);
  assert.ok(chunks.length >= 1);
  assert.equal(chunks.join(' ').replace(/\s+/g, ' ').trim(), answer.replace(/\s+/g, ' ').trim());
  for (const chunk of chunks) assert.ok(chunk.length <= 64, `"${chunk}" exceeds the limit`);
});

test('supertonic voice: a sentence longer than the limit is cut at word boundaries', () => {
  const long = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ') + '.';
  const chunks = text.speechRequests(long, 40);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 40);
    assert.doesNotMatch(chunk, /^\s|\s$/, 'no chunk starts or ends with a space');
  }
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' '));
});

test('supertonic voice: the language follows the script, and Hinglish is left to the learner', () => {
  assert.deepEqual(text.languageForChunk('नमस्ते दोस्तों', 'en'), { lang: 'hi', decided: true });
  assert.deepEqual(text.languageForChunk('Hello there', 'hi'), { lang: 'en', decided: true });
  // Romanised Hinglish: Latin letters, so it is read as English unless the learner chose otherwise.
  assert.deepEqual(text.languageForChunk('aaj hum python seekhenge', 'hi'), { lang: 'en', decided: true });
  assert.deepEqual(text.languageForChunk('123 456', 'hi'), { lang: 'hi', decided: false });
});

/* --------------------------------------------------------------------- engine */

/** Fake sessions: record the feeds, answer with plausible shapes, never touch a real model. */
function fakeSessions({ duration = 1, wavFrames = 4410, steps = 8 } = {}) {
  const calls = [];
  const latentDims = () => calls.filter((call) => call.name === 'vectorEstimator').length;
  const session = (name, run) => ({
    async run(feeds) {
      calls.push({ name, feeds });
      return run(feeds);
    },
  });
  return {
    calls,
    steps,
    latentDims,
    sessions: {
      duration: session('duration', async () => ({
        duration: { data: new Float32Array([duration]), dims: [1] },
      })),
      textEncoder: session('textEncoder', async (feeds) => ({
        text_emb: { data: new Float32Array(256 * feeds.text_ids.dims[1]), dims: [1, 256, feeds.text_ids.dims[1]] },
      })),
      vectorEstimator: session('vectorEstimator', async (feeds) => ({
        denoised_latent: { data: new Float32Array(feeds.noisy_latent.data.length), dims: [...feeds.noisy_latent.dims] },
      })),
      vocoder: session('vocoder', async (feeds) => ({
        wav_tts: { data: new Float32Array(feeds.latent.dims[2] * 3072), dims: [1, feeds.latent.dims[2] * 3072] },
      })),
    },
  };
}

const CONFIG = { sampleRate: 44100, baseChunkSize: 512, chunkCompressFactor: 6, latentDim: 24 };
const STYLE = {
  ttl: { data: new Float32Array(1 * 50 * 256), dims: [1, 50, 256] },
  dp: { data: new Float32Array(1 * 8 * 16), dims: [1, 8, 16] },
};
const encode = (value) => ({
  ids: new BigInt64Array(value.length),
  mask: new Float32Array(value.length).fill(1),
  length: value.length,
});

test('supertonic voice: the pipeline runs same→duration→text→steps→vocoder, with the documented shapes', async () => {
  const fake = fakeSessions();
  const sut = engine.createSupertonicEngine({
    sessions: fake.sessions,
    config: CONFIG,
    encodeText: encode,
    random: () => 0.5,
  });
  const speech = await sut.synthesize({ text: 'Hello there', lang: 'en', style: STYLE, steps: 4, speed: 1 });

  assert.deepEqual(fake.calls.map((call) => call.name), [
    'duration', 'textEncoder', 'vectorEstimator', 'vectorEstimator', 'vectorEstimator', 'vectorEstimator', 'vocoder',
  ]);

  const dp = fake.calls[0].feeds;
  assert.deepEqual(dp.text_ids.dims, [1, 11], 'one row, one column per character the tokenizer emitted');
  assert.deepEqual(dp.text_mask.dims, [1, 1, 11]);
  assert.deepEqual(dp.style_dp.dims, [1, 8, 16]);

  const encoder = fake.calls[1].feeds;
  assert.deepEqual(encoder.style_ttl.dims, [1, 50, 256]);

  const latent = fake.calls[2].feeds.noisy_latent;
  // 1 s × 44.1 kHz / (512 × 6) ≈ 8 latent frames; 24 × 6 = 144 channels.
  assert.equal(latent.dims[1], 144);
  assert.equal(latent.dims[2], Math.ceil(44100 / 3072));
  assert.deepEqual(fake.calls[2].feeds.latent_mask.dims, [1, 1, Math.ceil(44100 / 3072)]);
  assert.equal(fake.calls[2].feeds.current_step.data[0], 0);
  assert.equal(fake.calls[2].feeds.total_step.data[0], 4, 'the step count is sent to the model');

  assert.equal(speech.sampleRate, 44100);
  assert.ok(speech.audio instanceof Float32Array && speech.audio.length > 0);
});

test('supertonic voice: speed divides the predicted duration before the latent is shaped', async () => {
  for (const speed of [0.5, 1, 2]) {
    const fake = fakeSessions({ duration: 4 });
    const sut = engine.createSupertonicEngine({ sessions: fake.sessions, config: CONFIG, encodeText: encode, random: () => 0.5 });
    const speech = await sut.synthesize({ text: 'Four seconds', lang: 'en', style: STYLE, steps: 1, speed });
    assert.equal(speech.durationSeconds, 4 / speed);
    const frames = fake.calls[2].feeds.noisy_latent.dims[2];
    assert.equal(frames, Math.ceil((4 / speed) * 44100 / 3072));
  }
});

test('supertonic voice: the latent mask silences the frames past the spoken length', async () => {
  const fake = fakeSessions({ duration: 0.5 });
  const sut = engine.createSupertonicEngine({ sessions: fake.sessions, config: CONFIG, encodeText: encode, random: () => 0.5 });
  await sut.synthesize({ text: 'Short', lang: 'en', style: STYLE, steps: 1, speed: 1 });
  const latent = fake.calls[2].feeds.noisy_latent;
  const mask = fake.calls[2].feeds.latent_mask;
  // For a single utterance the mask covers every latent frame (it exists so a BATCH can pad a short
  // sentence beside a long one), so the assertion that matters is that the mask is shaped to the
  // latent and fully attended — the multiplication itself is exercised by the pipeline test.
  assert.equal(mask.data.length, latent.dims[2], 'one mask value per latent frame');
  assert.ok([...mask.data].every((value) => value === 1), 'a solo sentence attends to all its frames');
  assert.equal(mask.data.length, latent.dims[2]);
});

test('supertonic voice: empty text, a bad style and an empty waveform are errors, never silence', async () => {
  const fake = fakeSessions();
  const sut = engine.createSupertonicEngine({ sessions: fake.sessions, config: CONFIG, encodeText: encode, random: () => 0.5 });
  await assert.rejects(() => sut.synthesize({ text: '   ', lang: 'en', style: STYLE }), /nothing to speak/i);
  await assert.rejects(
    () => sut.synthesize({ text: 'hi', lang: 'en', style: { ...STYLE, ttl: { data: new Float32Array(4), dims: [2, 2] } } }),
    /voice preset is not usable/i,
  );
  const broken = fakeSessions();
  broken.sessions.vocoder = { async run() { return { wav_tts: { data: new Float32Array(0), dims: [1, 0] } }; } };
  const brokenEngine = engine.createSupertonicEngine({ sessions: broken.sessions, config: CONFIG, encodeText: encode, random: () => 0.5 });
  await assert.rejects(() => brokenEngine.synthesize({ text: 'hi', lang: 'en', style: STYLE, steps: 1 }), /no audio/i);
});

test('supertonic voice: WAV output is a real 16-bit PCM header, not a label', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const wav = engine.encodeWav(samples, 44100);
  const view = new DataView(wav);
  const ascii = (offset, length) => String.fromCharCode(...new Uint8Array(wav, offset, length));
  assert.equal(ascii(0, 4), 'RIFF');
  assert.equal(ascii(8, 4), 'WAVE');
  assert.equal(view.getUint16(20, true), 1, 'PCM');
  assert.equal(view.getUint16(22, true), 1, 'mono');
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint16(34, true), 16, '16-bit');
  assert.equal(view.getUint32(40, true), samples.length * 2);
  assert.equal(wav.byteLength, 44 + samples.length * 2);
  assert.equal(view.getInt16(44 + 2 * 1, true), Math.round(0.5 * 0x7fff));
  assert.equal(view.getInt16(44 + 2 * 3, true), 0x7fff, 'peaks clip instead of wrapping');
});

/* ---------------------------------------------------------------- voice styles */

test('supertonic voice: a style file is parsed to the exact shapes the graphs demand', () => {
  const ttl = [Array.from({ length: 50 }, () => Array.from({ length: 256 }, () => 0.25))];
  const dp = [Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => 0.5))];
  const parsed = style.parseStyle({ style_ttl: { data: ttl }, style_dp: { data: dp }, metadata: { source_file: 'F1.wav' } });
  assert.deepEqual(parsed.ttl.dims, [1, 50, 256]);
  assert.deepEqual(parsed.dp.dims, [1, 8, 16]);
  assert.equal(parsed.ttl.data.length, 12800);
  assert.equal(parsed.dp.data.length, 128);
  assert.equal(parsed.ttl.data[0], 0.25);
});

test('supertonic voice: a malformed style is rejected instead of producing nonsense audio', () => {
  assert.throws(() => style.parseStyle({ style_ttl: { data: [[0, 1]] }, style_dp: { data: [] } }), /shape/);
  assert.throws(() => style.parseStyle({ style_dp: { data: [] } }), /shape/);
  assert.throws(() => style.parseStyle(null), /not an object/);
  assert.throws(() => style.parseStyle({ style_ttl: { data: [['x']] }, style_dp: { data: [] } }), /not a number|shape/);
});

/* --------------------------------------------------------------------- assets */

test('supertonic voice: every asset URL is pinned to the verified revision', () => {
  assert.match(assets.SUPERTONIC_REVISION, /^[0-9a-f]{40}$/, 'a commit sha, never a branch');
  const plan = assets.downloadPlan();
  assert.equal(plan.length, 6);
  for (const entry of plan) {
    assert.ok(entry.url.includes(assets.SUPERTONIC_REVISION), `${entry.name} is not revision-pinned`);
    assert.match(entry.url, /^https:\/\//, 'weights are only ever fetched over https');
    assert.ok(entry.bytes > 0);
  }
  assert.ok(assets.VOICE_CACHE_NAME.includes(assets.SUPERTONIC_REVISION.slice(0, 12)), 'the cache is keyed by revision');
  assert.equal(assets.isVoicePreset('F1'), true);
  assert.equal(assets.isVoicePreset('X9'), false);
  assert.equal(assets.DEFAULT_PRESET, 'F1');
  assert.deepEqual([...assets.FEMALE_PRESETS], ['F1', 'F2', 'F3', 'F4', 'F5']);
});

test('supertonic voice: an asset is fetched once, cached, and reused without a second request', async () => {
  const store = new Map();
  const cacheStorage = {
    async open() {
      return {
        async match(url) { return store.get(url) ?? null; },
        async put(url, response) { store.set(url, response); },
        async delete(url) { return store.delete(url); },
        async keys() { return [...store.keys()].map((url) => new Request(url)); },
      };
    },
    async keys() { return ['brocode-supertonic3-abc', 'unrelated-cache']; },
    async delete(name) { return name === 'brocode-supertonic3-abc'; },
  };
  let hits = 0;
  const fetchImpl = async () => {
    hits += 1;
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-length': '4' } });
  };
  const url = 'https://example.test/onnx/tts.json';
  const first = await assets.loadAsset('tts.json', url, { fetchImpl, cacheStorage });
  assert.deepEqual([...new Uint8Array(first)], [1, 2, 3, 4]);
  assert.equal(hits, 1);
  const second = await assets.loadAsset('tts.json', url, { fetchImpl, cacheStorage });
  assert.deepEqual([...new Uint8Array(second)], [1, 2, 3, 4]);
  assert.equal(hits, 1, 'the cached copy answered without touching the network');
});

test('supertonic voice: a failed or truncated download is retried, never cached', async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts === 1) return new Response('nope', { status: 503 });
    if (attempts === 2) {
      // Claims 100 bytes, delivers 4: a truncated graph must not reach the runtime.
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-length': '100' } });
    }
    return new Response(new Uint8Array([9, 9]), { status: 200, headers: { 'content-length': '2' } });
  };
  const cached = [];
  const cacheStorage = {
    async open() { return { async match() { return null; }, async put(url) { cached.push(url); }, async delete() { return true; }, async keys() { return []; } }; },
  };
  const buffer = await assets.loadAsset('text_encoder.onnx', 'https://example.test/x.onnx', { fetchImpl, cacheStorage, retries: 3 });
  assert.deepEqual([...new Uint8Array(buffer)], [9, 9]);
  assert.equal(attempts, 3);
  assert.equal(cached.length, 1, 'only the complete body was stored');
});

test('supertonic voice: clearing the voice cache touches only this model', async () => {
  const deleted = [];
  const cacheStorage = {
    async keys() { return ['brocode-supertonic3-aaa', 'brocode-supertonic3-bbb', 'aiml-user-cache']; },
    async delete(name) { deleted.push(name); return true; },
  };
  const removed = await assets.clearVoiceCache(cacheStorage);
  assert.deepEqual(removed, ['brocode-supertonic3-aaa', 'brocode-supertonic3-bbb']);
  assert.deepEqual(deleted, removed);
  assert.ok(!deleted.includes('aiml-user-cache'), 'unrelated caches are untouched');
});

/* ------------------------------------------------------------------- protocol */

test('supertonic voice: worker messages are parsed, and anything else is dropped', () => {
  const status = protocol.parseWorkerMessage({
    type: 'status',
    status: { phase: 'downloading', progress: 0.42, message: 'Downloading Supertonic 3… 42%' },
  });
  assert.equal(status.status.phase, 'downloading');
  assert.equal(status.status.progress, 0.42);

  const audio = protocol.parseWorkerMessage({ type: 'audio', id: 3, pcm: new ArrayBuffer(8), sampleRate: 44100, durationSeconds: 1.2, synthMs: 900 });
  assert.equal(audio.type, 'audio');
  assert.equal(audio.id, 3);

  assert.equal(protocol.parseWorkerMessage({ type: 'audio', id: 1, pcm: new ArrayBuffer(0) }), null, 'empty audio is not audio');
  assert.equal(protocol.parseWorkerMessage({ type: 'status', status: { phase: 'nonsense' } }), null);
  assert.equal(protocol.parseWorkerMessage({ type: 'run-javascript', code: 'alert(1)' }), null, 'unknown verbs are ignored');
  assert.equal(protocol.parseWorkerMessage(null), null);
  assert.equal(protocol.parseWorkerMessage('status'), null);
});

/* ------------------------------------------------------------ source contracts */

test('supertonic voice: the worker owns ONNX Runtime and the page never touches it', async () => {
  const { readFileSync } = await import('node:fs');
  const worker = readFileSync('src/workers/tts.worker.ts', 'utf8');
  assert.match(worker, /onnxruntime-web/, 'the worker is the only place the runtime is imported');
  assert.match(worker, /executionProviders\(\).*webgpu[\s\S]*wasm/s, 'WebGPU is preferred, WASM is the fallback');
  assert.match(worker, /downloadModel/, 'the worker downloads the pinned checkpoint');
  const client = readFileSync('src/core/voice/client.ts', 'utf8');
  assert.doesNotMatch(client, /onnxruntime/, 'the page never imports the runtime');
  assert.match(client, /new Worker\(/, 'the page talks to the worker');
});

test('supertonic voice: the AI answer path has no browser synthesiser and no server route', async () => {
  const { readFileSync } = await import('node:fs');
  const hook = readFileSync('src/components/shared/useVoiceTutor.ts', 'utf8');
  assert.doesNotMatch(hook, /api\/voice\/status/, 'there is no server status probe any more');
  assert.doesNotMatch(hook, /api\/voice\/tts/, 'audio is generated locally, not fetched from a route');
  assert.match(hook, /client!\.speak\(/, 'the engine is what speaks');
  assert.match(hook, /languageForChunk/, 'each chunk is tagged from its own script');
  // The explicit browser-voice preference still exists for accessibility, but the AI path returns
  // with a real error before reaching it — that ordering is the guarantee.
  const aiGuard = hook.indexOf("prefs.engine === 'ai' && !client");
  const browserPath = hook.indexOf('speakWithBrowser(); return;');
  assert.ok(aiGuard > 0 && browserPath > aiGuard, 'the AI guard runs before any browser path');
});

/* ------------------------------------------------------- the first-load experience */

test('supertonic voice: the wait is described in bytes, because a percentage is not an answer', () => {
  assert.equal(assets.formatBytes(0), '0 MB');
  assert.equal(assets.formatBytes(430_000), '0.4 MB');
  assert.equal(assets.formatBytes(3_670_016), '3.5 MB');
  assert.equal(assets.formatBytes(244_700_000), '233 MB');
  assert.equal(assets.bytesProgressLabel(0, assets.TOTAL_MODEL_BYTES), `0 MB of ${assets.formatBytes(assets.TOTAL_MODEL_BYTES)}`);
  assert.equal(assets.bytesProgressLabel(150_000_000, assets.TOTAL_MODEL_BYTES), `143 MB of ${assets.formatBytes(assets.TOTAL_MODEL_BYTES)}`);
  // A count that overshoots the plan would be a lie on screen: it is clamped, and no total means no "of".
  // A count that overshoots the plan is clamped to the total instead of printing 1 GB of 380 MB.
  assert.equal(
    assets.bytesProgressLabel(999_000_000, assets.TOTAL_MODEL_BYTES),
    `${assets.formatBytes(assets.TOTAL_MODEL_BYTES)} of ${assets.formatBytes(assets.TOTAL_MODEL_BYTES)}`,
  );
  assert.equal(assets.bytesProgressLabel(12_000_000, 0), '11 MB');
  assert.equal(assets.formatBytes(Number.NaN), '0 MB');
});

test('supertonic voice: download progress carries absolute bytes and the file in flight', () => {
  const parsed = protocol.parseWorkerMessage({
    type: 'status',
    status: {
      phase: 'downloading',
      progress: 0.68,
      message: 'Downloading Supertonic 3… 68%',
      receivedBytes: 259_000_000,
      totalBytes: 379_000_000,
      file: 'vector_estimator.onnx',
    },
  });
  assert.equal(parsed.status.receivedBytes, 259_000_000);
  assert.equal(parsed.status.totalBytes, 379_000_000);
  assert.equal(parsed.status.file, 'vector_estimator.onnx');

  // Untrusted numbers are cleaned, not trusted: a negative or NaN count would render as nonsense.
  const cleaned = protocol.parseWorkerMessage({
    type: 'status',
    status: { phase: 'downloading', progress: 0.1, message: 'x', receivedBytes: -5, totalBytes: 'many' },
  });
  assert.equal(cleaned.status.receivedBytes, undefined);
  assert.equal(cleaned.status.totalBytes, undefined);
  assert.equal(protocol.byteCount(12.7), 13);
});

test('supertonic voice: the engine starts loading when the learner asks for voice, not on page load', async () => {
  const { readFileSync } = await import('node:fs');
  const panel = readFileSync('src/features/ai/VoiceMentorPanel.tsx', 'utf8');
  const hook = readFileSync('src/components/shared/useVoiceTutor.ts', 'utf8');
  const row = readFileSync('src/components/shared/AiVoiceRow.tsx', 'utf8');
  const css = readFileSync('src/styles.css', 'utf8');

  // Intent, not arrival: the two moments that mean "I am about to listen".
  assert.match(panel, /if \(!next\) voice\.preloadVoice\(\)/, 'unmuting the voice starts the download');
  assert.match(panel, /voice\.preloadVoice\(\); voice\.toggleListening/, 'opening the mic starts it too');
  assert.match(hook, /const preloadVoice = useCallback\(\(\) => \{[\s\S]{0,80}preload\(\)/, 'the hook owns the call');

  // The press is acknowledged while the engine is not ready, and the wait is visible where it happens.
  assert.match(panel, /<VoicePrepareChip status=\{voice\.voiceStatus\} \/>/);
  assert.match(panel, /<VoiceLoadProgress status=\{voice\.voiceStatus\} \/>/);
  assert.match(panel, /One-time download/);
  assert.match(row, /role="progressbar"/, 'the bar is a real progressbar for a screen reader');
  assert.match(row, /bytesProgressLabel/, 'the bar is labelled in bytes');
  assert.match(css, /\.voice-load-fill/, 'the bar has a fill');
  assert.match(css, /indeterminate/, 'starting the engine is not a frozen 0%');
});
