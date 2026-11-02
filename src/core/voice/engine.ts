/**
 * Supertonic 3 inference — the four ONNX graphs, wired exactly as the official SDK wires them.
 *
 * Ported from `supertonic/core.py` (`Supertonic.__call__` and `sample_noisy_latent`) at package
 * version 1.3.1. The order is not negotiable: duration predictor → text encoder → a flow-matching
 * loop over the vector estimator → vocoder. Each step below names the Python line it reproduces, so a
 * future reader can diff the two instead of guessing.
 *
 * NO RUNTIME IS IMPORTED HERE. ONNX Runtime Web runs in a worker in production and ONNX Runtime's
 * WASM build runs this same file under `node --test`; both reach it through `Session`, a two-line
 * interface. That is what makes the tests real: the code path that speaks in the browser is the code
 * path the suite exercises, with the genuine weights.
 */

/** A tensor as this file sees it. Adapters convert to the runtime's own `Tensor`. */
export interface Tensor {
  data: Float32Array | BigInt64Array;
  dims: number[];
}

/** One loaded graph. `run` takes named feeds and returns named outputs. */
export interface Session {
  run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  readonly inputNames?: readonly string[];
  readonly outputNames?: readonly string[];
}

export interface SupertonicSessions {
  duration: Session;
  textEncoder: Session;
  vectorEstimator: Session;
  vocoder: Session;
}

/** The numbers the graphs were built around, read from the model's own `tts.json`. */
export interface SupertonicConfig {
  sampleRate: number;
  baseChunkSize: number;
  chunkCompressFactor: number;
  latentDim: number;
}

/** `F1`…`M5`, as `voice_styles/<preset>.json` stores them. */
export interface StyleVectors {
  ttl: Tensor;
  dp: Tensor;
}

export interface SynthesizeRequest {
  text: string;
  lang: 'hi' | 'en';
  style: StyleVectors;
  /** Denoising steps. The SDK default is 5; BroCode ships 8 for the quality/latency balance. */
  steps?: number;
  /** 1 = the model's own pace. The SDK's usable band is 0.5–2. */
  speed?: number;
}

export interface SynthesizedSpeech {
  /** Mono float samples at `sampleRate`, ready for an `AudioBuffer`. */
  audio: Float32Array;
  sampleRate: number;
  /** What the duration predictor promised, before any trimming: the honest length of the answer. */
  durationSeconds: number;
  steps: number;
  lang: 'hi' | 'en';
}

export class VoiceEngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'VoiceEngineError';
    this.code = code;
  }
}

/** Standard normal samples (Box–Muller) — the Gaussian the SDK draws with `np.random.randn`. */
function gaussianPairs(count: number, random: () => number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 2) {
    // Guard against log(0) from a generator that can return exactly 0.
    const u1 = Math.max(random(), Number.EPSILON);
    const u2 = random();
    const radius = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    out[i] = radius * Math.cos(theta);
    if (i + 1 < count) out[i + 1] = radius * Math.sin(theta);
  }
  return out;
}

/** `get_latent_mask`: one 1/0 per latent frame, `[1, 1, latentLength]`. */
function latentMask(wavLength: number, chunkSize: number): Float32Array {
  const frames = Math.ceil(wavLength / chunkSize);
  const mask = new Float32Array(frames);
  mask.fill(1);
  return mask;
}

function firstScalar(tensor: Tensor | undefined, field: string): number {
  const value = tensor?.data?.[0];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  throw new VoiceEngineError('synth-bad-output', `The voice model returned no ${field}.`);
}

export function createSupertonicEngine({
  sessions,
  config,
  encodeText: encode,
  random = Math.random,
}: {
  sessions: SupertonicSessions;
  config: SupertonicConfig;
  /** Injected so this file stays free of the tokenizer's own dependencies (and testable alone). */
  encodeText: (text: string, lang: 'hi' | 'en') => { ids: BigInt64Array; mask: Float32Array; length: number };
  random?: () => number;
}) {
  const { sampleRate, baseChunkSize, chunkCompressFactor, latentDim } = config;
  const chunkSize = baseChunkSize * chunkCompressFactor;
  const latentChannels = latentDim * chunkCompressFactor;

  async function synthesize(request: SynthesizeRequest): Promise<SynthesizedSpeech> {
    const text = String(request.text ?? '').trim();
    if (!text) throw new VoiceEngineError('synth-bad-text', 'There is nothing to speak.');
    const steps = Math.min(12, Math.max(1, Math.round(request.steps ?? 8)));
    const speed = Math.min(2, Math.max(0.5, Number(request.speed ?? 1.05) || 1.05));
    const lang = request.lang === 'hi' ? 'hi' : 'en';

    const { ids, mask, length } = encode(text, lang);
    if (!length) throw new VoiceEngineError('synth-bad-text', 'There is nothing to speak.');
    if (request.style?.ttl?.dims?.[0] !== 1 || request.style?.dp?.dims?.[0] !== 1) {
      throw new VoiceEngineError('synth-bad-style', 'The selected voice preset is not usable.');
    }

    const textIds: Tensor = { data: ids, dims: [1, length] };
    const textMask: Tensor = { data: mask, dims: [1, 1, length] };

    // 1. How long is this sentence? (Python: `dp_ort.run(...)` then `dur_onnx / speed`.)
    const durationOut = await sessions.duration.run({
      text_ids: textIds,
      style_dp: request.style.dp,
      text_mask: textMask,
    });
    const spokenFor = firstScalar(durationOut.duration, 'a duration') / speed;
    if (!(spokenFor > 0)) throw new VoiceEngineError('synth-bad-duration', 'The voice model produced no speech for that text.');

    // 2. Text → acoustic embedding, conditioned on the voice preset.
    const textEmbOut = await sessions.textEncoder.run({
      text_ids: textIds,
      style_ttl: request.style.ttl,
      text_mask: textMask,
    });
    const textEmb = textEmbOut.text_emb ?? textEmbOut[Object.keys(textEmbOut)[0]];
    if (!textEmb) throw new VoiceEngineError('synth-bad-output', 'The voice model returned no text embedding.');

    // 3. Start from noise shaped to the predicted length (Python: `sample_noisy_latent`).
    const wavLength = Math.round(spokenFor * sampleRate);
    const latentLength = Math.max(1, Math.ceil(wavLength / chunkSize));
    const maskRow = latentMask(wavLength, chunkSize);
    const noise = gaussianPairs(latentChannels * latentLength, random);
    // Python: `noisy_latent = noisy_latent * latent_mask`. The mask MUST be applied to the noise, or
    // the frames past the spoken length are generated as sound and the answer runs long with a
    // tail of invented speech — the padding is part of the model's contract, not an optimisation.
    for (let frame = 0; frame < latentLength; frame += 1) {
      if (maskRow[frame] === 1) continue;
      for (let channel = 0; channel < latentChannels; channel += 1) noise[channel * latentLength + frame] = 0;
    }
    let latent: Tensor = { data: noise, dims: [1, latentChannels, latentLength] };
    const latentMaskTensor: Tensor = {
      data: maskRow.length === latentLength ? maskRow : padMask(maskRow, 1, latentLength, maskRow),
      dims: [1, 1, latentLength],
    };

    // 4. Flow-matching denoising: the vector estimator refines the latent `steps` times.
    for (let step = 0; step < steps; step += 1) {
      const out = await sessions.vectorEstimator.run({
        noisy_latent: latent,
        text_emb: textEmb,
        style_ttl: request.style.ttl,
        latent_mask: latentMaskTensor,
        text_mask: textMask,
        current_step: { data: new Float32Array([step]), dims: [1] },
        total_step: { data: new Float32Array([steps]), dims: [1] },
      });
      const next = out.denoised_latent ?? out[Object.keys(out)[0]];
      if (!next) throw new VoiceEngineError('synth-bad-output', 'The voice model returned no latent.');
      latent = next;
    }

    // 5. Latent → waveform.
    const wavOut = await sessions.vocoder.run({ latent });
    const wav = wavOut.wav_tts ?? wavOut[Object.keys(wavOut)[0]];
    if (!wav || !(wav.data instanceof Float32Array) || !wav.data.length) {
      throw new VoiceEngineError('synth-bad-output', 'The voice model returned no audio.');
    }
    return {
      audio: wav.data,
      sampleRate,
      durationSeconds: spokenFor,
      steps,
      lang,
    };
  }

  return { synthesize, config: { sampleRate, baseChunkSize, chunkCompressFactor, latentDim } };
}

export type SupertonicEngine = ReturnType<typeof createSupertonicEngine>;

/** Copy `row` into a zeroed `[rows, width]` buffer, trimming or padding to `width`. */
function padMask(data: Float32Array, rows: number, width: number, mask: Float32Array): Float32Array {
  const out = new Float32Array(rows * width);
  const sourceWidth = mask.length;
  for (let row = 0; row < rows; row += 1) {
    for (let i = 0; i < width; i += 1) {
      out[row * width + i] = i < sourceWidth ? data[row * sourceWidth + i] : 0;
    }
  }
  return out;
}

/** A 16-bit PCM WAV — the same container the server produced, so the editor can save a sample. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), true);
  }
  return buffer;
}
