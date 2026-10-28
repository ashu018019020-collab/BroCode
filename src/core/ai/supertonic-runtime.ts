/**
 * Supertonic 3, running in this browser.
 *
 * The only file in the app that touches ONNX Runtime Web, the Cache API and the model host. It is
 * deliberately separate from `supertonic.ts` (the pure model contract), so the parts that can be
 * wrong about the model are testable in Node and the parts that can only be wrong in a browser are
 * all here.
 *
 * What this module guarantees:
 *
 *  - NOTHING LOADS UNTIL ASKED. `onnxruntime-web` is a dynamic import, so a learner who never uses
 *    the AI voice never downloads a megabyte of it.
 *  - THE WEIGHTS ARE FETCHED ONCE. Four files (~398 MB) are streamed with progress and stored in a
 *    Cache API bucket named after the pinned model revision. A second visit loads from disk. When the
 *    browser refuses to store them the voice still works for that visit; the caller says so.
 *  - IT SAYS WHAT FAILED. Every failure is classified (`network`, `quota`, `wasm`, `model`, …) so the
 *    UI can offer the right way out instead of "something went wrong".
 *  - IT CAN BE STOPPED. Loading and synthesis both take an `AbortSignal`; a cancelled download leaves
 *    no half-initialised runtime behind, so Retry starts cleanly.
 *  - ONE RUNTIME PER PAGE. Four sessions of 398 MB of weights are not something to create twice.
 */
import {
  SUPERTONIC_CONFIG_PATH,
  SUPERTONIC_INDEXER_PATH,
  SUPERTONIC_WEIGHT_BYTES,
  SUPERTONIC_WEIGHTS,
  chunkSupertonicText,
  clampSupertonicText,
  classifySupertonicFailure,
  DEFAULT_SUPERTONIC_STYLE,
  parseSupertonicConfig,
  parseSupertonicStyle,
  synthesizeSupertonicChunk,
  supertonicAsset,
  supertonicLang,
  supertonicStylePath,
  type SupertonicConfig,
  type SupertonicGraphs,
  type SupertonicIndexer,
  type SupertonicLang,
  type SupertonicOrt,
  type SupertonicStyle,
  type SupertonicStyleId,
} from './supertonic';

/*
 * ORT's browser loader needs two real URLs: the `.mjs` it imports as a module and the `.wasm` beside it.
 * `scripts/ort-copy.mjs` puts them in `public/ort/` on `predev`/`prebuild` (the package's `exports` map
 * has no `./dist/*` entry, so a bundler `?url` import cannot resolve). Relative to the document, so a
 * subpath deployment and `base: './'` both work. `scripts/tests/supertonic.test.mjs` pins the names.
 */
export const ORT_RUNTIME_DIR = 'ort';
export const ORT_WASM_MODULE = 'ort-wasm-simd-threaded.mjs';
export const ORT_WASM_BINARY = 'ort-wasm-simd-threaded.wasm';

type OrtModule = typeof import('onnxruntime-web');

interface Runtime {
  ort: OrtModule;
  adapter: SupertonicOrt;
  graphs: SupertonicGraphs;
  config: SupertonicConfig;
  indexer: SupertonicIndexer;
  sampleRate: number;
}

export interface LoadProgress {
  loaded: number;
  total: number;
  /** Which of the four files is in flight, for a status line that names it. */
  file: string;
  percent: number;
}

let runtime: Runtime | null = null;
let loading: Promise<Runtime> | null = null;
const styles = new Map<string, SupertonicStyle>();

/** Cache bucket keyed by model revision: a new revision can never read the old weights. */
export function supertonicCacheName(revisionTag: string): string {
  return `brocode-supertonic-${revisionTag}`;
}
const CACHE = supertonicCacheName('724fb5abbf55');

/**
 * Can this browser even attempt it? WebAssembly and Web Audio are the two hard requirements; the
 * Cache API is optional (the voice works, it just downloads again next visit).
 */
export function supertonicSupport(): { ok: boolean; reason: string | null } {
  if (typeof window === 'undefined') return { ok: false, reason: 'Not a browser' };
  if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') {
    return { ok: false, reason: 'This browser has no WebAssembly.' };
  }
  const audio = (window as unknown as {
    AudioContext?: unknown; webkitAudioContext?: unknown;
  });
  if (!audio.AudioContext && !audio.webkitAudioContext) {
    return { ok: false, reason: 'This browser has no Web Audio.' };
  }
  return { ok: true, reason: null };
}

export function isSupertonicReady(): boolean {
  return runtime !== null;
}

export function disposeSupertonic(): void {
  const current = runtime;
  runtime = null;
  loading = null;
  styles.clear();
  if (!current) return;
  for (const graph of Object.values(current.graphs)) {
    try { (graph as unknown as { release?: () => Promise<void> }).release?.(); } catch { /* already gone */ }
  }
}

/* ------------------------------- storage -------------------------------- */

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(CACHE);
  } catch {
    return null;
  }
}

/** Has the model already been stored on this device? Used only to label the button honestly. */
export async function supertonicCached(): Promise<boolean> {
  const cache = await openCache();
  if (!cache) return false;
  try {
    // The vocoder is fetched last, so its presence means the download finished.
    const last = SUPERTONIC_WEIGHTS[SUPERTONIC_WEIGHTS.length - 1];
    return (await cache.match(supertonicAsset(last.path))) !== undefined;
  } catch {
    return false;
  }
}

/** Forget the stored weights. Not wired to a button by default; here so a learner is never trapped. */
export async function clearSupertonicCache(): Promise<void> {
  try { if (typeof caches !== 'undefined') await caches.delete(CACHE); } catch { /* nothing stored */ }
}

export interface FetchedAsset {
  buffer: ArrayBuffer;
  /** False when the bytes could not be stored (quota, private mode) — the caller says so once. */
  stored: boolean;
}

/**
 * Fetch one asset, reporting real byte progress, and store it.
 *
 * The stream is read chunk by chunk rather than with `response.arrayBuffer()` because a 257 MB file
 * with no feedback is indistinguishable from a hung page.
 */
export async function fetchSupertonicAsset(
  path: string,
  options: { signal?: AbortSignal; onBytes?: (loaded: number) => void } = {},
): Promise<FetchedAsset> {
  const url = supertonicAsset(path);
  const cache = await openCache();
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const cachedBuffer = await hit.arrayBuffer();
        options.onBytes?.(cachedBuffer.byteLength);
        return { buffer: cachedBuffer, stored: true };
      }
    } catch {
      // A corrupt cache entry is not an error: fall through and fetch it again.
    }
  }

  const response = await fetch(url, { signal: options.signal, credentials: 'omit', mode: 'cors' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  const body = response.body;
  let buffer: ArrayBuffer;

  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const parts: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        parts.push(value);
        loaded += value.byteLength;
        options.onBytes?.(loaded);
      }
    }
    const merged = new Uint8Array(loaded);
    let at = 0;
    for (const part of parts) { merged.set(part, at); at += part.byteLength; }
    buffer = merged.buffer;
    if (declared && loaded !== declared) {
      throw new Error(`Supertonic asset ${path} was truncated (${loaded} of ${declared} bytes)`);
    }
  } else {
    buffer = await response.arrayBuffer();
    options.onBytes?.(buffer.byteLength);
  }

  let stored = false;
  if (cache) {
    try {
      await cache.put(url, new Response(buffer, { headers: { 'content-type': 'application/octet-stream' } }));
      stored = true;
    } catch {
      // Quota or a read-only store: usable now, downloads again next visit.
      stored = false;
    }
  }
  return { buffer, stored };
}

/* -------------------------------- loading -------------------------------- */

async function readJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(supertonicAsset(path), { signal, credentials: 'omit', mode: 'cors' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
  return response.json();
}

/**
 * Load the four graphs, the config, the character index and one voice style.
 *
 * Concurrency is deliberate: a second call while the first is in flight joins it instead of starting
 * a second 398 MB download. A failed load clears the in-flight promise so Retry really retries.
 */
export async function loadSupertonic(options: {
  onProgress?: (progress: LoadProgress) => void;
  signal?: AbortSignal;
  style?: SupertonicStyleId;
} = {}): Promise<Runtime> {
  if (runtime) return runtime;
  if (loading) return loading;

  const support = supertonicSupport();
  if (!support.ok) throw new Error(support.reason ?? 'This browser cannot run the AI voice');

  loading = (async (): Promise<Runtime> => {
    const { signal, onProgress } = options;
    // `onnxruntime-web` is ~1 MB of glue: only a request for speech pays for it.
    const ort = (await import('onnxruntime-web')) as OrtModule;

    // Single-threaded on purpose. Threads need `crossOriginIsolated` (COOP/COEP headers), which this
    // deployment does not set; asking for them makes ORT warn and fall back anyway.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
    ort.env.logLevel = 'error';
    const ortBase = new URL(`${ORT_RUNTIME_DIR}/`, document.baseURI).href;
    ort.env.wasm.wasmPaths = {
      mjs: new URL(ORT_WASM_MODULE, ortBase).href,
      wasm: new URL(ORT_WASM_BINARY, ortBase).href,
    };

    const config = parseSupertonicConfig(await readJson(SUPERTONIC_CONFIG_PATH, signal));
    const indexer = (await readJson(SUPERTONIC_INDEXER_PATH, signal)) as SupertonicIndexer;
    if (!indexer || typeof indexer.length !== 'number') {
      throw new Error('Supertonic character index is not an array');
    }

    let loaded = 0;
    let storeRefused = false;
    const sessions: Record<string, unknown> = {};
    for (let i = 0; i < SUPERTONIC_WEIGHTS.length; i += 1) {
      const file = SUPERTONIC_WEIGHTS[i];
      const base = loaded;
      const asset = await fetchSupertonicAsset(file.path, {
        signal,
        onBytes: (bytes) => {
          onProgress?.({
            loaded: base + bytes,
            total: SUPERTONIC_WEIGHT_BYTES,
            file: file.label,
            percent: Math.min(100, Math.round(((base + bytes) / SUPERTONIC_WEIGHT_BYTES) * 100)),
          });
        },
      });
      if (!asset.stored) storeRefused = true;
      loaded = base + file.bytes;
      sessions[file.path] = await ort.InferenceSession.create(asset.buffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
    }
    if (storeRefused) {
      console.warn('BroCode voice: the browser would not store the AI voice; it will download again next visit.');
    }

    const graphs: SupertonicGraphs = {
      duration: sessions['onnx/duration_predictor.onnx'] as SupertonicGraphs['duration'],
      text: sessions['onnx/text_encoder.onnx'] as SupertonicGraphs['text'],
      vector: sessions['onnx/vector_estimator.onnx'] as SupertonicGraphs['vector'],
      vocoder: sessions['onnx/vocoder.onnx'] as SupertonicGraphs['vocoder'],
    };
    for (const [name, graph] of Object.entries(graphs)) {
      if (!graph || typeof graph.run !== 'function') throw new Error(`Supertonic graph ${name} did not load`);
    }

    const adapter: SupertonicOrt = {
      Tensor: ort.Tensor as unknown as SupertonicOrt['Tensor'],
    };

    const built: Runtime = { ort, adapter, graphs, config, indexer, sampleRate: config.sampleRate };
    runtime = built;
    return built;
  })();

  try {
    return await loading;
  } catch (cause) {
    // A half-loaded runtime must not poison the next attempt.
    loading = null;
    disposeSupertonic();
    throw cause;
  }
}

async function styleFor(id: SupertonicStyleId, signal?: AbortSignal): Promise<SupertonicStyle> {
  const existing = styles.get(id);
  if (existing) return existing;
  const parsed = parseSupertonicStyle(await readJson(supertonicStylePath(id), signal));
  styles.set(id, parsed);
  return parsed;
}

/* ------------------------------- synthesis ------------------------------- */

export interface SynthesizeOptions {
  signal?: AbortSignal;
  /** Overrides for testing; production uses the model defaults. */
  steps?: number;
  speed?: number;
  style?: SupertonicStyleId;
  /** Notified before every denoising step, so a slow device can show real progress. */
  onStep?: (step: number, total: number) => void;
}

/**
 * One chunk of speech. Loads the model if this is the first request, so a caller never has to know
 * whether the voice is "warm".
 */
export async function synthesizeChunk(
  text: string,
  preferred: 'en-IN' | 'hi-IN',
  options: SynthesizeOptions = {},
): Promise<{ pcm: Float32Array; seconds: number; lang: SupertonicLang }> {
  const active = await loadSupertonic({ signal: options.signal, style: options.style });
  const lang = supertonicLang(preferred, text);
  const style = await styleFor(options.style ?? DEFAULT_SUPERTONIC_STYLE, options.signal);
  const result = await synthesizeSupertonicChunk({
    text,
    lang,
    style,
    config: active.config,
    indexer: active.indexer,
    ort: active.adapter,
    graphs: active.graphs,
    steps: options.steps,
    speed: options.speed,
    signal: options.signal,
  });
  return { ...result, lang };
}

/**
 * The text this voice will actually read for an answer: markdown already flattened by the caller,
 * cut to a bounded length, split into playable chunks. Exported so the hook and the tests agree on
 * what "one answer" means.
 */
export function supertonicChunksFor(text: string): string[] {
  return chunkSupertonicText(clampSupertonicText(text));
}

/** The failure copy for a thrown value, with the classification, so a caller can log one and show the other. */
export function supertonicFailure(cause: unknown): string {
  return classifySupertonicFailure(cause);
}
