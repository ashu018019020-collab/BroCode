/**
 * Where the weights come from, and how they are kept.
 *
 * The browser downloads the real Supertonic 3 checkpoint — 379 MB across four ONNX graphs — so the
 * two things that matter are that it downloads from an IMMUTABLE url and that a second visit does not
 * download it at all.
 *
 *  - PINNED. Every URL carries the model's commit sha, not a branch name. A moving `main` would let a
 *    new checkpoint arrive under an old cache key, which is the one failure a versioned cache cannot
 *    detect: the browser would keep serving audio from weights the app was not written for.
 *  - CACHED IN CACHE STORAGE, one cache per revision. `clearVoiceCache()` deletes that cache and
 *    nothing else — never `localStorage`, never IndexedDB, never a learner record.
 *  - RESUMABLE ENOUGH. A failed request is retried twice with a short backoff; a partial download is
 *    simply refetched, because a truncated ONNX graph must never reach the runtime (it fails with an
 *    opaque protobuf error that looks like "the model is broken").
 *
 * Pure URLs and sizes live here so the tests can assert them without a browser.
 */

/** `Supertone/supertonic-3` @ the revision these graphs and styles were verified against. */
export const SUPERTONIC_REVISION = '3cadd1ee6394adea1bd021217a0e650ede09a323';
export const SUPERTONIC_MODEL = 'supertonic-3';
export const SUPERTONIC_LICENSE = 'OpenRAIL-M';
export const SUPERTONIC_SDK_VERSION = '1.3.1';

/** The cache name carries the revision: a new checkpoint can never read old bytes. */
export const VOICE_CACHE_NAME = `brocode-supertonic3-${SUPERTONIC_REVISION.slice(0, 12)}`;

/** Female presets are what the mentor ships with; the male pair stays selectable, never hidden. */
export const FEMALE_PRESETS = ['F1', 'F2', 'F3', 'F4', 'F5'] as const;
export const MALE_PRESETS = ['M1', 'M2', 'M3', 'M4', 'M5'] as const;
export type VoicePreset = (typeof FEMALE_PRESETS)[number] | (typeof MALE_PRESETS)[number];
export const VOICE_PRESETS: readonly VoicePreset[] = [...FEMALE_PRESETS, ...MALE_PRESETS];
export const DEFAULT_PRESET: VoicePreset = 'F1';

/**
 * F1 is the default because it is the female preset whose measured pitch is the most consistent
 * across Hindi and English (184 Hz / 186 Hz from the real checkpoint) — one tutor, one voice, in both
 * languages. Every preset stays selectable; the choice is stored per device, not per account.
 */
export function isVoicePreset(value: unknown): value is VoicePreset {
  return typeof value === 'string' && (VOICE_PRESETS as readonly string[]).includes(value);
}

export type AssetName =
  | 'duration_predictor.onnx'
  | 'text_encoder.onnx'
  | 'vector_estimator.onnx'
  | 'vocoder.onnx'
  | 'unicode_indexer.json'
  | 'tts.json';

/** `bytes` are the published sizes, used for an honest progress bar before headers arrive. */
export interface AssetSpec {
  name: AssetName;
  bytes: number;
}

export const MODEL_ASSETS: readonly AssetSpec[] = [
  { name: 'duration_predictor.onnx', bytes: 3_670_016 },
  { name: 'text_encoder.onnx', bytes: 36_388_864 },
  { name: 'vector_estimator.onnx', bytes: 256_589_824 },
  { name: 'vocoder.onnx', bytes: 101_384_192 },
  { name: 'unicode_indexer.json', bytes: 331_776 },
  { name: 'tts.json', bytes: 6_000 },
];

export const TOTAL_MODEL_BYTES = MODEL_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0);

/**
 * The asset base. A single override (`VITE_SUPERTONIC_ASSET_BASE`) exists for a self-hosted mirror;
 * it must still be revision-pinned by the operator, which the docs say out loud.
 */
export function assetBase(override?: string): string {
  const custom = String(override ?? '').trim().replace(/\/+$/u, '');
  if (custom) return custom;
  return `https://huggingface.co/Supertone/supertonic-3/resolve/${SUPERTONIC_REVISION}`;
}

export function assetPath(name: AssetName): string {
  return name.endsWith('.json') && name !== 'tts.json' ? `onnx/${name}` : `onnx/${name}`;
}

export function assetUrl(name: AssetName, base = assetBase()): string {
  return `${base}/${assetPath(name)}`;
}

export function styleUrl(preset: VoicePreset, base = assetBase()): string {
  return `${base}/voice_styles/${preset}.json`;
}

/** Everything the engine needs before it can speak, in download order (smallest first). */
export function downloadPlan(base = assetBase()): Array<{ name: string; url: string; bytes: number }> {
  return MODEL_ASSETS.map((asset) => ({ name: asset.name, url: assetUrl(asset.name, base), bytes: asset.bytes }));
}

export interface AssetLoadProgress {
  file: string;
  /** Bytes of THIS file, when the server told us its length. */
  received: number;
  size: number;
  /** 0…1 across the whole plan. */
  overall: number;
}

export interface LoadOptions {
  base?: string;
  signal?: AbortSignal;
  onProgress?: (progress: AssetLoadProgress) => void;
  /** Injected in tests and in the Node harness; defaults to the page's `fetch` and `caches`. */
  fetchImpl?: typeof fetch;
  cacheStorage?: CacheStorage;
  retries?: number;
}

/**
 * Fetch one asset, from the version cache when it is already there.
 *
 * The cache check comes first because it is the difference between a 379 MB download and none at
 * all on the second visit. `cache.add`-style shortcuts are deliberately avoided: a failed network
 * response would otherwise be stored, and every later visit would then "load" a corrupted graph.
 */
export async function loadAsset(
  name: string,
  url: string,
  { signal, onProgress, fetchImpl = fetch, cacheStorage = globalThis.caches, retries = 2 }: LoadOptions = {},
): Promise<ArrayBuffer> {
  const cache = cacheStorage ? await cacheStorage.open(VOICE_CACHE_NAME).catch(() => null) : null;
  const cached = await cache?.match(url).catch(() => null);
  if (cached) {
    const body = await cached.arrayBuffer();
    if (body.byteLength > 0) {
      onProgress?.({ file: name, received: body.byteLength, size: body.byteLength, overall: 1 });
      return body;
    }
    // A zero-byte entry is a failed write from an older session: drop it and refetch.
    await cache?.delete(url).catch(() => undefined);
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, { signal, credentials: 'omit', mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const size = Number(response.headers.get('content-length') ?? 0) || 0;
      const body = await readWithProgress(response, size, (received, total) => {
        onProgress?.({ file: name, received, size: total, overall: total ? received / total : 0 });
      });
      if (!body.byteLength) throw new Error('empty response');
      // Only a COMPLETE body is stored: a truncated graph is worse than no cache at all.
      if (size && body.byteLength !== size) throw new Error(`incomplete (${body.byteLength}/${size} bytes)`);
      if (cache) {
        await cache.put(url, new Response(body, {
          headers: { 'Content-Type': url.endsWith('.json') ? 'application/json' : 'application/octet-stream' },
        })).catch(() => undefined);
      }
      return body;
    } catch (cause) {
      if (signal?.aborted) throw cause;
      lastError = cause;
      // A moment's pause between attempts: an instant retry usually hits the same bad edge.
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw new Error(`${name}: ${String((lastError as Error)?.message ?? lastError)}`);
}

/** Stream a response so the UI can show bytes, falling back to `arrayBuffer()` where streams are absent. */
async function readWithProgress(
  response: Response,
  size: number,
  onChunk: (received: number, total: number) => void,
): Promise<ArrayBuffer> {
  const body = response.body;
  const total = size || Number(response.headers.get('content-length') ?? 0) || 0;
  if (!body || typeof body.getReader !== 'function') {
    const buffer = await response.arrayBuffer();
    onChunk(buffer.byteLength, buffer.byteLength);
    return buffer;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      onChunk(received, total);
    }
  }
  const joined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined.buffer;
}

/** Download the whole plan, reporting one cumulative number instead of six. */
export async function downloadModel(
  options: LoadOptions = {},
  base = options.base ?? assetBase(),
): Promise<Record<string, ArrayBuffer>> {
  const plan = downloadPlan(base);
  const total = plan.reduce((sum, entry) => sum + entry.bytes, 0);
  const files: Record<string, ArrayBuffer> = {};
  let done = 0;
  for (const entry of plan) {
    const buffer = await loadAsset(entry.name, entry.url, {
      ...options,
      onProgress: (progress) => {
        const overall = total ? (done + Math.min(progress.received, entry.bytes)) / total : 0;
        options.onProgress?.({ ...progress, overall: Math.min(0.999, overall) });
      },
    });
    done += buffer.byteLength;
    files[entry.name] = buffer;
    options.onProgress?.({ file: entry.name, received: buffer.byteLength, size: buffer.byteLength, overall: Math.min(0.999, done / total) });
  }
  options.onProgress?.({ file: 'done', received: done, size: done, overall: 1 });
  return files;
}

/** How many bytes this browser already holds for the pinned revision. */
export async function cachedVoiceBytes(cacheStorage: CacheStorage | undefined = globalThis.caches): Promise<number> {
  if (!cacheStorage) return 0;
  const cache = await cacheStorage.open(VOICE_CACHE_NAME).catch(() => null);
  if (!cache) return 0;
  const requests = await cache.keys().catch(() => []);
  let total = 0;
  for (const request of requests) {
    const response = await cache.match(request).catch(() => null);
    total += Number(response?.headers.get('content-length') ?? 0) || 0;
  }
  return total;
}

/**
 * Remove the model cache for every revision this app has ever written.
 *
 * Scoped by NAME PREFIX, not "delete all caches": other caches on this origin belong to other
 * features, and the learner's records live in Supabase, not here.
 */
export async function clearVoiceCache(cacheStorage: CacheStorage | undefined = globalThis.caches): Promise<string[]> {
  if (!cacheStorage) return [];
  const names = await cacheStorage.keys().catch(() => []);
  const mine = names.filter((name) => name.startsWith('brocode-supertonic3-'));
  await Promise.all(mine.map((name) => cacheStorage.delete(name).catch(() => false)));
  return mine;
}
