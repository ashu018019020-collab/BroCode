/**
 * Real Supertonic 3 inference, on this machine.
 *
 * The unit tests drive the model contract with fake sessions — they prove the wiring, not the voice.
 * This tool is the other half: it downloads the pinned weights once, runs the ACTUAL ONNX graphs
 * through ONNX Runtime (native CPU here, the same graphs the browser loads), and writes real WAVs so
 * the output can be listened to.
 *
 * It is a developer tool, not part of the app or the test suite: it needs `onnxruntime-node`, which is
 * deliberately NOT a dependency (the browser uses `onnxruntime-web`, and a second 100 MB native
 * runtime in the lockfile would be dead weight for every learner).
 *
 *   npm install --no-save onnxruntime-node
 *   node tools/supertonic-check.mjs
 *   node tools/supertonic-check.mjs --steps=4 --only=hi
 *
 * Honest limits: native CPU is FASTER than the browser's WebAssembly build, so the timings below are a
 * lower bound, not a prediction. This tool cannot judge naturalness either — it reports sample counts,
 * loudness and silence, which is what a machine can verify.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.freebuff', 'supertonic');
const OUT = path.join(ROOT, '.freebuff', 'supertonic-out');

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
    return [key, value];
  }),
);
const STEPS = Number(args.get('steps') ?? 8);
const STYLE = args.get('style') ?? 'F1';
const ONLY = args.get('only') ?? null;

const st = await import(pathToFileURL(path.join(ROOT, 'src/core/ai/supertonic.ts')).href);

let ort;
try {
  ort = await import('onnxruntime-node');
} catch {
  console.error('onnxruntime-node is not installed. Run: npm install --no-save onnxruntime-node');
  process.exit(2);
}

/* -------------------------------- download -------------------------------- */

async function fetchAsset(relPath, bytes) {
  const target = path.join(CACHE, relPath);
  if (fs.existsSync(target) && fs.statSync(target).size > 0) {
    const size = fs.statSync(target).size;
    console.log(`  cached  ${relPath.padEnd(30)} ${(size / 1e6).toFixed(1)} MB`);
    return fs.readFileSync(target);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const url = st.supertonicAsset(relPath);
  process.stdout.write(`  fetch   ${relPath.padEnd(30)} `);
  const started = Date.now();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${relPath}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (bytes && buffer.byteLength !== bytes) {
    throw new Error(`${relPath} is ${buffer.byteLength} bytes, expected ${bytes}`);
  }
  fs.writeFileSync(target, buffer);
  console.log(`${(buffer.byteLength / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return buffer;
}

console.log(`Supertonic 3 · ${st.SUPERTONIC_MODEL} @ ${st.SUPERTONIC_REVISION.slice(0, 10)} · style ${STYLE} · ${STEPS} steps`);

const config = st.parseSupertonicConfig(
  JSON.parse((await fetchAsset(st.SUPERTONIC_CONFIG_PATH)).toString('utf8')),
);
const indexer = JSON.parse((await fetchAsset(st.SUPERTONIC_INDEXER_PATH)).toString('utf8'));
const style = st.parseSupertonicStyle(
  JSON.parse((await fetchAsset(st.supertonicStylePath(STYLE))).toString('utf8')),
);

const sessionOf = async (relPath) => {
  const buffer = await fetchAsset(relPath, st.SUPERTONIC_WEIGHTS.find((f) => f.path === relPath)?.bytes);
  const started = Date.now();
  const session = await ort.InferenceSession.create(buffer, { executionProviders: ['cpu'] });
  console.log(`  loaded  ${relPath.padEnd(30)} ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return session;
};

const graphs = {
  duration: await sessionOf('onnx/duration_predictor.onnx'),
  text: await sessionOf('onnx/text_encoder.onnx'),
  vector: await sessionOf('onnx/vector_estimator.onnx'),
  vocoder: await sessionOf('onnx/vocoder.onnx'),
};
// The browser build takes `(type, data, dims)`; the native build takes `(data, dims)` and infers the
// type from the typed array. One shim keeps the shared inference core identical on both.
const adapter = {
  Tensor: function NativeTensor(type, data, dims) {
    return new ort.Tensor(data, dims);
  },
};

/* --------------------------------- cases --------------------------------- */

const CASES = [
  {
    id: 'en',
    lang: 'en',
    text: "Welcome to BroCode. Let's begin your AI engineering interview.",
    note: 'English, the product default',
  },
  {
    id: 'hi',
    lang: 'hi',
    text: 'नमस्ते! आज हम BroCode में Python प्रोग्रामिंग सीखेंगे।',
    note: 'Hindi in Devanagari — what the app tags hi',
  },
  {
    id: 'mixed',
    lang: 'en',
    text: "Chalo, let's start the next Python interview question.",
    note: 'Hinglish in Roman script — the app tags this en',
  },
  {
    id: 'hi-roman',
    lang: 'hi',
    text: 'Namaste! Aaj hum BroCode mein Python programming seekhenge.',
    note: 'the requested Hindi sentence verbatim, forced to hi to show what that tag does to Latin text',
  },
];

fs.mkdirSync(OUT, { recursive: true });
let failures = 0;

for (const testCase of CASES) {
  if (ONLY && testCase.id !== ONLY) continue;
  console.log(`\n▶ ${testCase.id} (${testCase.lang}) — ${testCase.note}`);
  console.log(`  text: ${testCase.text}`);
  const started = Date.now();
  try {
    const result = await st.synthesizeSupertonic({
      text: testCase.text,
      lang: testCase.lang,
      style,
      config,
      indexer,
      ort: adapter,
      graphs,
      steps: STEPS,
    });
    const ms = Date.now() - started;
    if (!result.pcm.length) throw new Error('empty audio');
    let peak = 0;
    let energy = 0;
    let loud = 0;
    for (const sample of result.pcm) {
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      energy += sample * sample;
      if (abs > 0.01) loud += 1;
    }
    const rms = Math.sqrt(energy / result.pcm.length);
    const file = path.join(OUT, `${testCase.id}.wav`);
    fs.writeFileSync(file, Buffer.from(st.encodeSupertonicWav(result.pcm, config.sampleRate)));
    console.log(`  audio   ${(result.pcm.length / config.sampleRate).toFixed(2)}s · ${result.pcm.length} samples · ${result.chunks} chunk(s)`);
    console.log(`  synth   ${(ms / 1000).toFixed(1)}s wall (${((result.pcm.length / config.sampleRate) / (ms / 1000)).toFixed(2)}× realtime)`);
    console.log(`  level   peak ${peak.toFixed(3)} · rms ${rms.toFixed(4)} · ${((loud / result.pcm.length) * 100).toFixed(0)}% above -40 dBFS`);
    console.log(`  wrote   ${path.relative(ROOT, file)}`);
    if (rms < 0.001) {
      console.log('  FAIL    audio is effectively silent');
      failures += 1;
    }
  } catch (cause) {
    failures += 1;
    console.log(`  FAIL    ${cause?.message ?? cause}`);
    if (process.env.SUPERTONIC_DEBUG) console.log(cause?.stack ?? cause);
  }
}

console.log(`\n${failures === 0 ? 'All cases produced audio.' : `${failures} case(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
