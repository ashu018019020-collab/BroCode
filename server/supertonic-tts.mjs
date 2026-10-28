/**
 * Supertonic 3, spoken by the SERVER.
 *
 * This is the same model the browser used to download (398 MB of ONNX weights), moved to the process
 * that already answers API requests: the client sends text, receives WAV, and never sees a model file.
 * The inference itself is not re-implemented — `src/core/ai/supertonic.ts` owns the checkpoint
 * contract (text tags, tensor shapes, the denoising loop) and is shared verbatim with the unit tests.
 *
 * Node runs that `.ts` contract directly through type stripping (Node ≥ 23.6, default on in 24). When
 * the running Node cannot do that, the engine says so instead of crashing the API: the route then
 * reports `engine: 'none'` and the client keeps its explicitly-labelled browser voice.
 *
 * Memory and time are the two things a server-side TTS has to be honest about:
 *
 *  - THE WEIGHTS LOAD ONCE, AT BOOT (`warm()`), not per request. Four sessions hold ~400 MB of model
 *    plus their arenas; that is the reason this service is a container with a real memory budget and
 *    not a serverless function.
 *  - SYNTHESIS IS SERIALIZED. CPU inference of a 99M-parameter model on one core is already the
 *    bottleneck; running two through it doubles both latencies and the peak memory. Requests queue,
 *    and a queued request can be abandoned (`signal`) without leaving the model in a bad state.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where the weights live on the server. Overridable so a container can mount a volume. */
export const DEFAULT_MODEL_DIR = path.join(ROOT, 'models', 'supertonic-3');

/** The dev cache `tools/supertonic-check.mjs` fills. Used only when the deploy dir is absent. */
const DEV_CACHE_DIR = path.join(ROOT, '.freebuff', 'supertonic');

/** The pause between two synthesized chunks, matching the sentence breath the voice always had. */
export const CHUNK_GAP_SECONDS = 0.18;

/** Hard caps, enforced before any tensor is built. */
export const SUPERTONIC_SERVER_MAX_CHARS = 1200;

/**
 * Small in-memory cache of finished audio.
 *
 * A lesson repeats the same line every time a learner replays it, and Stop/Play is one press away.
 * Thirty entries of a few seconds each is a couple of megabytes — cheap next to re-running 8 denoising
 * steps for text the process just voiced.
 */
const CACHE_LIMIT = 30;

let corePromise = null;
let ortPromise = null;
let loadingPromise = null;
let state = {
  phase: 'idle',
  error: null,
  readyAt: null,
  modelDir: null,
  weightsBytes: 0,
  sampleRate: null,
  steps: null,
  styleId: null,
};
let runtime = null;
const cache = new Map();
let queue = Promise.resolve();

function cacheKey(text, lang, rate, style) {
  return `${style}|${lang}|${rate.toFixed(2)}|${text}`;
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  // Refresh LRU position: `Map` keeps insertion order, so re-inserting makes the newest last.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheSet(key, value) {
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

/** The shared model contract. A Node without type stripping is a clean, named failure. */
async function loadCore() {
  if (corePromise) return corePromise;
  corePromise = (async () => {
    try {
      return await import(pathToFileURL(path.join(ROOT, 'src/core/ai/supertonic.ts')).href);
    } catch (cause) {
      const error = new Error(
        'The server cannot load the shared Supertonic contract (Node must support TypeScript '
        + `type stripping; this is ${process.version}).`,
      );
      error.code = 'voice-runtime';
      error.cause = cause;
      throw error;
    }
  })();
  return corePromise;
}

async function loadOrt() {
  if (ortPromise) return ortPromise;
  ortPromise = (async () => {
    try {
      return await import('onnxruntime-node');
    } catch (cause) {
      const error = new Error(
        'onnxruntime-node is not installed on this server, so the AI voice cannot run here.',
      );
      error.code = 'voice-unconfigured';
      error.cause = cause;
      throw error;
    }
  })();
  return ortPromise;
}

function readAsset(dir, relPath) {
  const file = path.join(dir, relPath);
  if (!fs.existsSync(file)) {
    const error = new Error(`The Supertonic model is missing ${relPath} in ${dir}.`);
    error.code = 'voice-unconfigured';
    throw error;
  }
  return fs.readFileSync(file);
}

function resolveModelDir(explicit) {
  if (explicit) return explicit;
  if (fs.existsSync(path.join(explicit ?? DEFAULT_MODEL_DIR, 'onnx'))) return explicit ?? DEFAULT_MODEL_DIR;
  if (fs.existsSync(DEFAULT_MODEL_DIR)) return DEFAULT_MODEL_DIR;
  if (fs.existsSync(path.join(DEV_CACHE_DIR, 'onnx'))) return DEV_CACHE_DIR;
  return DEFAULT_MODEL_DIR;
}

/** What this process knows about the voice, without doing any work. */
export function supertonicStatus() {
  return {
    phase: state.phase,
    ready: state.phase === 'ready',
    error: state.error,
    modelDir: state.modelDir,
    weightsBytes: state.weightsBytes,
    sampleRate: state.sampleRate,
    steps: state.steps,
    styleId: state.styleId,
    node: process.version,
    cachedClips: cache.size,
  };
}

/**
 * Load everything once and warm the graphs.
 *
 * Concurrent callers join the same promise: the HTTP server calls this on boot while a first request
 * may already be waiting, and two 400 MB loads would exhaust the container.
 */
export async function warmSupertonic({ modelDir, styleId = 'F1', steps } = {}) {
  if (state.phase === 'ready' && runtime) return supertonicStatus();
  if (loadingPromise) return loadingPromise;
  const dir = resolveModelDir(modelDir);
  state = { ...state, phase: 'loading', error: null, modelDir: dir };

  loadingPromise = (async () => {
    try {
      const core = await loadCore();
      const ort = await loadOrt();
      const resolvedStyle = styleId || core.DEFAULT_SUPERTONIC_STYLE;
      const resolvedSteps = Number.isFinite(Number(steps))
        ? Math.max(1, Math.round(Number(steps)))
        : core.SUPERTONIC_STEPS;

      const config = core.parseSupertonicConfig(
        JSON.parse(readAsset(dir, core.SUPERTONIC_CONFIG_PATH).toString('utf8')),
      );
      const indexer = JSON.parse(readAsset(dir, core.SUPERTONIC_INDEXER_PATH).toString('utf8'));
      const style = core.parseSupertonicStyle(
        JSON.parse(readAsset(dir, core.supertonicStylePath(resolvedStyle)).toString('utf8')),
      );

      const sessionOf = async (relPath) => ort.InferenceSession.create(readAsset(dir, relPath), {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });
      const graphs = {
        duration: await sessionOf('onnx/duration_predictor.onnx'),
        text: await sessionOf('onnx/text_encoder.onnx'),
        vector: await sessionOf('onnx/vector_estimator.onnx'),
        vocoder: await sessionOf('onnx/vocoder.onnx'),
      };

      // The native build takes `(data, dims)` and infers the type from the typed array; the shared
      // contract builds `(type, data, dims)` because that is the browser's signature.
      const adapter = {
        Tensor: function NativeTensor(_type, data, dims) {
          return new ort.Tensor(data, dims);
        },
      };

      let weightsBytes = 0;
      for (const file of core.SUPERTONIC_WEIGHTS) {
        const asset = path.join(dir, file.path);
        weightsBytes += fs.existsSync(asset) ? fs.statSync(asset).size : 0;
      }

      runtime = {
        core, ort, adapter, graphs, config, indexer, style,
        sampleRate: config.sampleRate,
        steps: resolvedSteps,
        styleId: resolvedStyle,
      };

      // Pay the first-run kernel cost at boot, not on the learner's first sentence. A failed warm-up
      // is not a dead voice: the first real request simply pays it (and the error is logged).
      try {
        await core.synthesizeSupertonicChunk({
          text: 'Hello.', lang: 'en', style, config, indexer, ort: adapter, graphs, steps: 1,
        });
      } catch (cause) {
        console.warn?.('Supertonic warm-up failed; the first request will pay the cost.', cause?.message ?? cause);
      }

      state = {
        phase: 'ready',
        error: null,
        readyAt: new Date().toISOString(),
        modelDir: dir,
        weightsBytes,
        sampleRate: config.sampleRate,
        steps: resolvedSteps,
        styleId: resolvedStyle,
      };
      return supertonicStatus();
    } catch (cause) {
      state = {
        ...state,
        phase: 'error',
        error: String(cause?.message ?? cause),
      };
      runtime = null;
      throw cause;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

/** A WAV of `text`, synthesized on this machine. Serialized through one queue on purpose. */
export async function synthesizeServerSpeech({
  text,
  lang = 'en-IN',
  rate = 1,
  styleId,
  maxChars = SUPERTONIC_SERVER_MAX_CHARS,
} = {}) {
  if (!runtime) await warmSupertonic({ styleId });
  const active = runtime;
  const clean = active.core.clampSupertonicText(String(text ?? ''), maxChars);
  if (!clean) {
    const error = new Error('There is no text to speak.');
    error.code = 'voice-empty-text';
    throw error;
  }
  const speakingRate = Number.isFinite(Number(rate)) ? Math.min(2, Math.max(0.5, Number(rate))) : 1;
  const style = styleId && styleId !== active.styleId
    ? active.core.parseSupertonicStyle(
      JSON.parse(readAsset(state.modelDir, active.core.supertonicStylePath(styleId)).toString('utf8')),
    )
    : active.style;
  const key = cacheKey(clean, lang, speakingRate, styleId ?? active.styleId);
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const run = async () => {
    const chunks = active.core.chunkSupertonicText(
      clean, active.core.SUPERTONIC_CHUNK, active.core.SUPERTONIC_FIRST_CHUNK,
    );
    const gap = Math.round(CHUNK_GAP_SECONDS * active.sampleRate);
    const parts = [];
    const spoken = [];
    let seconds = 0;
    for (const chunk of chunks) {
      const tag = active.core.supertonicLang(lang, chunk);
      const result = await active.core.synthesizeSupertonicChunk({
        text: chunk,
        lang: tag,
        style,
        config: active.config,
        indexer: active.indexer,
        ort: active.adapter,
        graphs: active.graphs,
        steps: active.steps,
        speed: active.core.SUPERTONIC_SPEED * speakingRate,
      });
      if (!result.pcm.length) continue;
      if (parts.length && gap) parts.push(new Float32Array(gap));
      parts.push(result.pcm);
      seconds += result.seconds + (parts.length > 1 ? CHUNK_GAP_SECONDS : 0);
      spoken.push({ text: chunk, lang: tag });
    }
    if (!parts.length) {
      const error = new Error('The AI voice produced no audio for that text.');
      error.code = 'voice-empty-audio';
      throw error;
    }
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const pcm = new Float32Array(total);
    let at = 0;
    for (const part of parts) { pcm.set(part, at); at += part.length; }
    const wav = Buffer.from(active.core.encodeSupertonicWav(pcm, active.sampleRate));
    const output = {
      audio: wav,
      contentType: 'audio/wav',
      sampleRate: active.sampleRate,
      seconds: pcm.length / active.sampleRate,
      chunks: spoken,
      styleId: styleId ?? active.styleId,
      steps: active.steps,
      cached: false,
    };
    cacheSet(key, output);
    return output;
  };

  const result = queue.then(run, run);
  // Keep the chain alive after a failed request; the next one must still run.
  queue = result.catch(() => undefined);
  return result;
}

/** Forget the model (tests, or a deliberate unload). The next request warms it again. */
export function resetSupertonic() {
  runtime = null;
  state = { ...state, phase: 'idle', error: null, readyAt: null };
  cache.clear();
  queue = Promise.resolve();
}
