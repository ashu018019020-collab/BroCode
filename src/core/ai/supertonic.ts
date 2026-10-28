/**
 * Supertonic 3 — the on-device voice.
 *
 * This module is the *model contract*, kept pure so it can be tested without a browser: text
 * preprocessing, chunking, the latent sampler, the four-graph inference loop and the WAV encoder.
 * The browser plumbing (ONNX Runtime Web, Cache API, audio graph) lives in
 * `src/core/ai/supertonic-runtime.ts`, and the speech hook calls it.
 *
 * Everything here follows the upstream implementation that shipped with the model
 * (`supertone-oss-archive/supertonic`, `web/helper.js`), because this is a 99M-parameter network
 * whose tensor names, text tags and denoising loop are part of the checkpoint, not a style choice:
 *
 *   duration_predictor(text_ids, style_dp, text_mask) → duration        seconds of audio
 *   text_encoder(text_ids, style_ttl, text_mask)      → text_emb
 *   vector_estimator(noisy_latent, text_emb, style_ttl, latent_mask,
 *                    text_mask, current_step, total_step) → denoised_latent   × total_step
 *   vocoder(latent)                                   → wav_tts         44.1 kHz mono float32
 *
 * The text is wrapped in `<hi>…</hi>` / `<en>…</en>`; that tag is how the model picks the language,
 * and it is why a wrong tag is audible rather than merely inaccurate.
 *
 * Two deliberate differences from the reference demo, both about being a voice inside a product
 * rather than a one-shot demo page:
 *
 *  - FLAT TYPED ARRAYS, not nested JS arrays. The reference converts a 257 MB tensor into nested
 *    arrays eight times per sentence; that is the difference between usable and unusable on CPU.
 *  - ONE CHUNK AT A TIME. Chunking exists for playback here: the first sentence can start speaking
 *    while the next is still being synthesized, and Stop can abandon the remainder.
 */

/* ------------------------------- the model ------------------------------- */

/** The model card the assets come from. */
export const SUPERTONIC_MODEL = 'Supertone/supertonic-3';

/**
 * The immutable revision the four graphs are fetched from — the initial Supertonic 3 release
 * (`724fb5a`), not `main`. `main` moves; a voice that silently changes its weights is not a
 * dependency, it is a surprise. Bump this constant to change the voice on purpose.
 */
export const SUPERTONIC_REVISION = '724fb5abbf5502583fb520898d45929e62f02c0b';

export const SUPERTONIC_ASSET_BASE =
  `https://huggingface.co/${SUPERTONIC_MODEL}/resolve/${SUPERTONIC_REVISION}`;

export interface SupertonicFile {
  /** Path under the model repository. */
  path: string;
  /** Exact size in bytes at `SUPERTONIC_REVISION`; the download tells the learner what it costs. */
  bytes: number;
  label: string;
}

/**
 * The weights, measured from the model repository (Content-Length at the pinned revision), not
 * guessed. This is the whole first-use cost: ~380 MiB. It is shown to the learner before anything
 * is downloaded rather than discovered halfway through.
 */
export const SUPERTONIC_WEIGHTS: SupertonicFile[] = [
  { path: 'onnx/duration_predictor.onnx', bytes: 3_700_147, label: 'Duration predictor' },
  { path: 'onnx/text_encoder.onnx', bytes: 36_416_150, label: 'Text encoder' },
  { path: 'onnx/vector_estimator.onnx', bytes: 256_534_781, label: 'Vector estimator' },
  { path: 'onnx/vocoder.onnx', bytes: 101_424_195, label: 'Vocoder' },
];

/** Small JSON assets: the graph config and the character index. */
export const SUPERTONIC_CONFIG_PATH = 'onnx/tts.json';
export const SUPERTONIC_INDEXER_PATH = 'onnx/unicode_indexer.json';

export const SUPERTONIC_WEIGHT_BYTES = SUPERTONIC_WEIGHTS.reduce((sum, file) => sum + file.bytes, 0);

export function supertonicAsset(path: string): string {
  return `${SUPERTONIC_ASSET_BASE}/${path}`;
}

/** Output format of `vocoder.onnx` (`ae.sample_rate` in `tts.json`). */
export const SUPERTONIC_SAMPLE_RATE = 44_100;

/** Denoising steps. The reference default; fewer steps is faster and coarser, not "the same". */
export const SUPERTONIC_STEPS = 8;

/** Upstream's default pacing (1.05 slightly faster than the model's native rate). */
export const SUPERTONIC_SPEED = 1.05;

/* --------------------------------- voices -------------------------------- */

export type SupertonicStyleId = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'M1' | 'M2' | 'M3' | 'M4' | 'M5';

/**
 * The ten presets the checkpoint ships. The upstream demo labels F1–F5 female and M1–M5 male; that
 * label is the repository's, not a listening claim made here. F1 is the default for consistency
 * with the female voice the tutor used before — the preset id is one constant, so changing the
 * voice is one edit.
 */
export const SUPERTONIC_STYLES: SupertonicStyleId[] = [
  'F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5',
];

export const DEFAULT_SUPERTONIC_STYLE: SupertonicStyleId = 'F1';

export function supertonicStylePath(style: SupertonicStyleId = DEFAULT_SUPERTONIC_STYLE): string {
  return `voice_styles/${style}.json`;
}

/* -------------------------------- language -------------------------------- */

/** The two language tags BroCode speaks. Supertonic 3 supports 31; the product exposes these two. */
export type SupertonicLang = 'hi' | 'en';

const DEVANAGARI = /[\u0900-\u097F]/;

/**
 * Which tag the text actually deserves.
 *
 * The product's `hi-IN` means "Hindi voice, Hinglish explanations", and Hinglish is usually written
 * in Roman script. Tagging Roman text as `hi` would ask the model to read Latin letters as Hindi, so
 * the decision is made per chunk from the script on the page: Devanagari → `hi`, otherwise `en`.
 * That is a fact about the text, not a guess about the learner.
 */
export function supertonicLang(preferred: 'en-IN' | 'hi-IN', text: string): SupertonicLang {
  if (preferred !== 'hi-IN') return 'en';
  return DEVANAGARI.test(String(text ?? '')) ? 'hi' : 'en';
}

/* ----------------------------- text processing ---------------------------- */

/** The character index: `indexer[codePoint]` is the model's id, `-1` for unmapped. */
export type SupertonicIndexer = ArrayLike<number>;

const EMOJI =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;

const SYMBOL_REPLACEMENTS: [string, string][] = [
  ['–', '-'], ['‑', '-'], ['—', '-'], ['_', ' '],
  ['\u201C', '"'], ['\u201D', '"'], ['\u2018', "'"], ['\u2019', "'"],
  ['´', "'"], ['`', "'"],
  ['[', ' '], [']', ' '], ['|', ' '], ['/', ' '], ['#', ' '], ['→', ' '], ['←', ' '],
];

const EXPRESSION_REPLACEMENTS: [string, string][] = [
  ['@', ' at '],
  ['e.g.,', 'for example, '],
  ['i.e.,', 'that is, '],
];

/**
 * The model's own text normalisation, in the reference order (NFKD, emoji removal, symbol and
 * expression rewrites, punctuation spacing, duplicate quotes, whitespace) plus the language tag.
 *
 * The order is load-bearing: normalising after the tag would decompose it, and collapsing spaces
 * before the punctuation rules would leave ` ,` behind.
 */
export function preprocessSupertonicText(raw: string, lang: SupertonicLang): string {
  if (lang !== 'hi' && lang !== 'en') throw new Error(`Supertonic language not enabled: ${String(lang)}`);
  let text = String(raw ?? '').normalize('NFKD');
  text = text.replace(EMOJI, '');
  for (const [from, to] of SYMBOL_REPLACEMENTS) text = text.split(from).join(to);
  text = text.replace(/[♥☆♡©\\]/g, '');
  for (const [from, to] of EXPRESSION_REPLACEMENTS) text = text.split(from).join(to);
  text = text.replace(/ ,/g, ',')
    .replace(/ \./g, '.')
    .replace(/ !/g, '!')
    .replace(/ \?/g, '?')
    .replace(/ ;/g, ';')
    .replace(/ :/g, ':')
    .replace(/ '/g, "'")
    // The rules above fix ONE space; markdown and pasted text arrive with more. A space before
    // punctuation is never something the model should pronounce as a pause.
    .replace(/\s+([,.;:!?])/g, '$1');
  while (text.includes('""')) text = text.replace('""', '"');
  while (text.includes("''")) text = text.replace("''", "'");
  while (text.includes('``')) text = text.replace('``', '`');
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (!/[.!?;:,'"’)\]}…。」』】〉》›»]$/.test(text)) text += '.';
  return `<${lang}>${text}</${lang}>`;
}

/** `[1, n]` int64 ids + `[1, 1, n]` float mask, exactly the shapes the four graphs declare. */
export function supertonicTextIds(
  processed: string,
  indexer: SupertonicIndexer,
): { ids: BigInt64Array; mask: Float32Array; length: number } {
  const points = Array.from(processed);
  const ids = new BigInt64Array(points.length);
  for (let i = 0; i < points.length; i += 1) {
    const cp = points[i].codePointAt(0) ?? 0;
    const mapped = cp < indexer.length ? Number(indexer[cp]) : -1;
    ids[i] = BigInt(Number.isFinite(mapped) ? mapped : -1);
  }
  const mask = new Float32Array(points.length).fill(1);
  return { ids, mask, length: points.length };
}

/**
 * Sentences, packed up to `maxLen`, with a hard cap so a 4,000-character answer cannot become one
 * multi-minute synthesis. Truncation is at a sentence boundary and is announced by the caller, never
 * silently applied to the middle of a word.
 */
export function chunkSupertonicText(text: string, maxLen = 220): string[] {
  const limit = Math.max(60, Math.round(maxLen));
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  const sentences = clean.split(/(?<=[.!?])\s+/);
  let current = '';
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };
  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if (piece.length > limit) {
      flush();
      // A single long sentence still has to fit: cut at a space, never inside a word.
      let rest = piece;
      while (rest.length > limit) {
        const head = rest.slice(0, limit + 1);
        let cut = head.lastIndexOf(' ');
        if (cut <= 0) cut = limit;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      current = rest;
      continue;
    }
    if (current && current.length + 1 + piece.length > limit) flush();
    current = current ? `${current} ${piece}` : piece;
  }
  flush();
  return chunks;
}

/** Longest text one spoken answer will synthesize; the screen keeps the rest. */
export const SUPERTONIC_MAX_CHARS = 1200;

/** Cut to the cap at a sentence boundary. Returns the text a caller should actually speak. */
export function clampSupertonicText(text: string, maxChars = SUPERTONIC_MAX_CHARS): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  let out = '';
  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    const candidate = out ? `${out} ${sentence}` : sentence;
    if (out && candidate.length > maxChars) break;
    out = candidate;
  }
  return (out || clean.slice(0, maxChars)).trim();
}

/* --------------------------------- config -------------------------------- */

export interface SupertonicConfig {
  sampleRate: number;
  baseChunkSize: number;
  chunkCompress: number;
  latentDim: number;
}

/**
 * The four numbers the latent sampler needs, read from `tts.json` and validated. A missing or
 * reshaped config must fail with a sentence, not produce a NaN-shaped tensor that ORT reports as a
 * 300-line shape error.
 */
export function parseSupertonicConfig(raw: unknown): SupertonicConfig {
  const cfg = (raw ?? {}) as {
    ae?: { sample_rate?: unknown; base_chunk_size?: unknown };
    ttl?: { chunk_compress_factor?: unknown; latent_dim?: unknown };
  };
  const sampleRate = Number(cfg.ae?.sample_rate);
  const baseChunkSize = Number(cfg.ae?.base_chunk_size);
  const chunkCompress = Number(cfg.ttl?.chunk_compress_factor);
  const latentDim = Number(cfg.ttl?.latent_dim);
  for (const [name, value] of [
    ['ae.sample_rate', sampleRate], ['ae.base_chunk_size', baseChunkSize],
    ['ttl.chunk_compress_factor', chunkCompress], ['ttl.latent_dim', latentDim],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Supertonic config is missing a valid ${name}`);
    }
  }
  return { sampleRate, baseChunkSize, chunkCompress, latentDim };
}

/* --------------------------------- style --------------------------------- */

export interface SupertonicStyle {
  ttl: { dims: [number, number, number]; data: Float32Array };
  dp: { dims: [number, number, number]; data: Float32Array };
}

function readStyleTensor(
  raw: unknown,
  name: 'style_ttl' | 'style_dp',
): { dims: [number, number, number]; data: Float32Array } {
  const tensor = (raw ?? {}) as { dims?: unknown; data?: unknown };
  const dims = Array.isArray(tensor.dims) ? tensor.dims.map(Number) : [];
  if (dims.length !== 3 || dims.some((d) => !Number.isFinite(d) || d <= 0)) {
    throw new Error(`Supertonic voice style has no valid ${name}.dims`);
  }
  if (!Array.isArray(tensor.data)) throw new Error(`Supertonic voice style has no ${name}.data`);
  const flat = new Float32Array(dims[0] * dims[1] * dims[2]);
  let at = 0;
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (at < flat.length) flat[at] = Number(value);
    at += 1;
  };
  walk(tensor.data);
  if (at !== flat.length) {
    throw new Error(`Supertonic voice style ${name} has ${at} values, expected ${flat.length}`);
  }
  return { dims: [dims[0], dims[1], dims[2]], data: flat };
}

/** A style JSON is two pre-extracted tensors; anything else is a different file, so say so. */
export function parseSupertonicStyle(raw: unknown): SupertonicStyle {
  const style = (raw ?? {}) as { style_ttl?: unknown; style_dp?: unknown };
  const ttl = readStyleTensor(style.style_ttl, 'style_ttl');
  const dp = readStyleTensor(style.style_dp, 'style_dp');
  if (ttl.dims[0] !== 1) throw new Error('Supertonic single-speaker synthesis needs a single style');
  return { ttl, dp };
}

/* ------------------------------- inference -------------------------------- */

export interface SupertonicTensor {
  data: Float32Array | BigInt64Array;
  dims: readonly number[];
}

export interface SupertonicSession {
  run(feeds: Record<string, SupertonicTensor>): Promise<Record<string, SupertonicTensor>>;
}

export interface SupertonicOrt {
  Tensor: new (
    type: 'float32' | 'int64',
    data: Float32Array | BigInt64Array,
    dims: number[],
  ) => SupertonicTensor;
}

export interface SupertonicGraphs {
  duration: SupertonicSession;
  text: SupertonicSession;
  vector: SupertonicSession;
  vocoder: SupertonicSession;
}

export interface SupertonicChunkInput {
  text: string;
  lang: SupertonicLang;
  style: SupertonicStyle;
  config: SupertonicConfig;
  indexer: SupertonicIndexer;
  ort: SupertonicOrt;
  graphs: SupertonicGraphs;
  steps?: number;
  speed?: number;
  /** Injected so the latent sampler is testable; defaults to `Math.random`. */
  random?: () => number;
  /** Stop between two graphs, so a cancelled answer does not keep a 99M-parameter model busy. */
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Supertonic synthesis aborted');
  error.name = 'AbortError';
  throw error;
}

/**
 * Box–Muller noise for the flow-matching start point, flattened, then zeroed outside the real audio
 * length. The mask is what makes a batch of one the right shape; without it the tail of the latent
 * is noise the model would happily voice.
 */
export function sampleSupertonicLatent(
  seconds: number,
  config: SupertonicConfig,
  random: () => number = Math.random,
): { latent: Float32Array; dims: [number, number]; mask: Float32Array } {
  const frames = Math.max(1, Math.floor(seconds * config.sampleRate));
  const chunkSize = config.baseChunkSize * config.chunkCompress;
  const latentLen = Math.max(1, Math.ceil(frames / chunkSize));
  const latentDim = config.latentDim * config.chunkCompress;
  const latent = new Float32Array(latentDim * latentLen);
  for (let i = 0; i < latent.length; i += 1) {
    const u1 = Math.max(0.0001, random());
    const u2 = random();
    latent[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  const mask = new Float32Array(latentLen);
  const realLen = Math.min(latentLen, Math.ceil(frames / chunkSize));
  for (let t = 0; t < realLen; t += 1) mask[t] = 1;
  for (let d = 0; d < latentDim; d += 1) {
    const base = d * latentLen;
    for (let t = 0; t < latentLen; t += 1) latent[base + t] *= mask[t];
  }
  return { latent, dims: [latentDim, latentLen], mask };
}

/**
 * One chunk in, mono float32 samples out — the whole inference, in the reference order.
 *
 * The style tensor is passed as-is to both the duration predictor (`style_dp`) and every other graph
 * (`style_ttl`); the denoiser is re-fed the SAME latent tensor that is returned, which is what makes
 * the eight steps a trajectory rather than eight independent guesses.
 */
export async function synthesizeSupertonicChunk(input: SupertonicChunkInput): Promise<{
  pcm: Float32Array;
  seconds: number;
  steps: number;
}> {
  const { text, lang, style, config, indexer, ort, graphs, signal } = input;
  throwIfAborted(signal);
  const steps = Math.max(1, Math.round(input.steps ?? SUPERTONIC_STEPS));
  const speed = input.speed && input.speed > 0 ? input.speed : SUPERTONIC_SPEED;
  const processed = preprocessSupertonicText(text, lang);
  if (!processed) return { pcm: new Float32Array(0), seconds: 0, steps };

  const { ids, mask } = supertonicTextIds(processed, indexer);
  const textIds = new ort.Tensor('int64', ids, [1, ids.length]);
  const textMask = new ort.Tensor('float32', mask, [1, 1, mask.length]);
  // Style tensors are real tensors, not `{ data, dims }` literals: ONNX Runtime validates the feed
  // objects it is given, and a plain object is rejected before the graph is even entered.
  const styleDp = new ort.Tensor('float32', style.dp.data, [...style.dp.dims]);
  const styleTtl = new ort.Tensor('float32', style.ttl.data, [...style.ttl.dims]);

  const durationOut = await graphs.duration.run({
    text_ids: textIds,
    style_dp: styleDp,
    text_mask: textMask,
  });
  const rawSeconds = Number((durationOut.duration.data as Float32Array)[0]);
  if (!Number.isFinite(rawSeconds) || rawSeconds <= 0) {
    throw new Error('Supertonic predicted no audio for this text');
  }
  const seconds = rawSeconds / speed;

  throwIfAborted(signal);
  const textOut = await graphs.text.run({
    text_ids: textIds,
    style_ttl: styleTtl,
    text_mask: textMask,
  });
  const textEmb = textOut.text_emb;
  if (!textEmb) throw new Error('Supertonic text encoder returned no embedding');

  const { latent: start, dims, mask: latentMask } = sampleSupertonicLatent(seconds, config, input.random);
  const latentMaskTensor = new ort.Tensor('float32', latentMask, [1, 1, latentMask.length]);
  const totalStepTensor = new ort.Tensor('float32', Float32Array.of(steps), [1]);
  let latent = new ort.Tensor('float32', start, [1, dims[0], dims[1]]);

  for (let step = 0; step < steps; step += 1) {
    throwIfAborted(signal);
    const out = await graphs.vector.run({
      noisy_latent: latent,
      text_emb: textEmb,
      style_ttl: styleTtl,
      latent_mask: latentMaskTensor,
      text_mask: textMask,
      current_step: new ort.Tensor('float32', Float32Array.of(step), [1]),
      total_step: totalStepTensor,
    });
    const denoised = out.denoised_latent;
    if (!denoised) throw new Error(`Supertonic vector estimator returned nothing on step ${step + 1}`);
    if (denoised.data.length !== start.length) {
      throw new Error(
        `Supertonic latent changed shape on step ${step + 1}: ${denoised.data.length} vs ${start.length}`,
      );
    }
    latent = new ort.Tensor('float32', denoised.data as Float32Array, [1, dims[0], dims[1]]);
  }

  const wavOut = await graphs.vocoder.run({ latent });
  const wav = wavOut.wav_tts;
  if (!wav || !wav.data.length) throw new Error('Supertonic vocoder returned no audio');
  const wanted = Math.min(wav.data.length, Math.max(1, Math.floor(seconds * config.sampleRate)));
  return { pcm: (wav.data as Float32Array).slice(0, wanted), seconds, steps };
}

/**
 * Every chunk in order, separated by a short pause — the whole answer as one buffer. The browser
 * path does not use this (it plays chunk by chunk so the first sentence starts earlier); the
 * verification tool does, and the timing it reports is the real synthesis time.
 */
export async function synthesizeSupertonic(
  input: SupertonicChunkInput & { pauseSeconds?: number },
): Promise<{ pcm: Float32Array; seconds: number; chunks: number }> {
  const pieces = chunkSupertonicText(input.text);
  const pause = Math.max(0, Math.round((input.pauseSeconds ?? 0.3) * input.config.sampleRate));
  const out: Float32Array[] = [];
  let seconds = 0;
  for (const piece of pieces) {
    const result = await synthesizeSupertonicChunk({ ...input, text: piece });
    if (!result.pcm.length) continue;
    if (out.length && pause) out.push(new Float32Array(pause));
    out.push(result.pcm);
    seconds += result.seconds + (out.length > 1 && pause ? pause / input.config.sampleRate : 0);
  }
  const total = out.reduce((sum, part) => sum + part.length, 0);
  const pcm = new Float32Array(total);
  let at = 0;
  for (const part of out) { pcm.set(part, at); at += part.length; }
  return { pcm, seconds, chunks: pieces.length };
}

/* ---------------------------------- WAV ---------------------------------- */

/** 16-bit PCM WAV, mono — what `<audio>`/`decodeAudioData` accept and what a learner can download. */
export function encodeSupertonicWav(samples: Float32Array, sampleRate = SUPERTONIC_SAMPLE_RATE): ArrayBuffer {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataSize, true);
  const int16 = new Int16Array(buffer, 44);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    int16[i] = Math.floor(clamped * 32767);
  }
  return buffer;
}

/* -------------------------------- messages ------------------------------- */

export type SupertonicState = 'off' | 'loading' | 'ready' | 'error';

export type SupertonicFail =
  | 'network' | 'quota' | 'wasm' | 'model' | 'unsupported' | 'aborted' | 'empty';

/**
 * The learner-facing line for a failure, always with the way out. No message says the voice is
 * "unavailable" without saying what still works, because the rest of BroCode does keep working.
 */
export function supertonicErrorCopy(fail: SupertonicFail): string {
  switch (fail) {
    case 'network':
      return 'The AI voice files could not be downloaded. Check the connection and retry — the built-in voice still reads answers.';
    case 'quota':
      return 'This browser refused to store the AI voice (storage is full). It can still be used for this visit, but it will download again next time.';
    case 'wasm':
      return 'This browser could not start the AI voice engine (WebAssembly). The built-in voice still reads answers.';
    case 'model':
      return 'The AI voice files were downloaded but could not be loaded. Retry, or use the built-in voice.';
    case 'unsupported':
      return 'This device cannot run the on-device AI voice. The built-in browser voice still reads answers.';
    case 'aborted':
      return 'The AI voice download was cancelled. Nothing was lost — you can start it again.';
    case 'empty':
      return 'The AI voice returned no audio for that text. The built-in voice takes over for this answer.';
    default:
      return 'The AI voice hit an unexpected error. The built-in voice still reads answers.';
  }
}

/** Classify a thrown value into one of the messages above. Never rethrows a raw DOM string. */
export function classifySupertonicFailure(cause: unknown): SupertonicFail {
  const name = String((cause as { name?: string } | null)?.name ?? '');
  const message = String((cause as { message?: string } | null)?.message ?? cause ?? '');
  if (name === 'AbortError' || /abort/i.test(message)) return 'aborted';
  if (name === 'QuotaExceededError' || /quota/i.test(message)) return 'quota';
  if (/offline|network|fetch|failed to fetch|load failed|http 5|http 4/i.test(message)) return 'network';
  if (/webassembly|wasm|compile|instantiate/i.test(message)) return 'wasm';
  if (/no audio|returned no|no embedding|predicted no/i.test(message)) return 'empty';
  if (/not supported|cross-origin|sharedarraybuffer/i.test(message)) return 'unsupported';
  if (/supertonic|onnx|shape|invalid|tensor/i.test(message)) return 'model';
  return 'model';
}

/** Bytes → the phrase a learner can judge. Base-10 MB, because that is what a download meter shows. */
export function supertonicSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/** `0…100`, clamped, for a progress bar that must never show 120%. */
export function supertonicPercent(loaded: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
}

/**
 * The line under the voice controls. It names what will speak NEXT, not what the deployment wishes
 * it had, and it never says "AI voice" while the browser's own synthesiser is the one talking.
 */
export function supertonicEngineNote(
  state: SupertonicState,
  detail: { percent?: number; error?: string | null; downloaded?: boolean } = {},
): string {
  const size = supertonicSizeLabel(SUPERTONIC_WEIGHT_BYTES);
  switch (state) {
    case 'loading':
      return `Preparing the AI voice… ${detail.percent ?? 0}% of ${size}. Answers use the built-in voice until it is ready.`;
    case 'ready':
      return 'AI voice ready — Supertonic 3 on this device (Hindi + English).';
    case 'error':
      return `${detail.error ?? 'The AI voice could not load.'} Retry, or keep using the built-in voice.`;
    default:
      return detail.downloaded
        ? 'AI voice downloaded. It starts on the next spoken answer.'
        : `AI voice not downloaded yet (${size}, one time). Answers use the built-in voice.`;
  }
}
