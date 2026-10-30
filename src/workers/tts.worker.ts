/// <reference lib="webworker" />
/**
 * The voice worker: the only place the model touches the page's thread budget.
 *
 * Loading 379 MB of graphs and running a flow-matching loop is not something to do on the UI thread —
 * it would freeze the chat, the microphone and the waveform while a sentence is generated. So the
 * worker owns the sessions, the voice-style cache and the synthesis, and the page only ever receives
 * status events and finished PCM.
 *
 * Download progress is real: it comes from the bytes crossing the network (or from Cache Storage when
 * a returning visit finds them already there), never from a timer.
 */
import * as ort from 'onnxruntime-web';
import { downloadModel, clearVoiceCache, assetBase, type VoicePreset } from '../core/voice/assets';
import { createSupertonicEngine, type Session, type Tensor } from '../core/voice/engine';
import { encodeText } from '../core/voice/text';
import { parseStyle } from '../core/voice/style';
import { clamp01, type VoiceStatus, type WorkerRequest, type WorkerResponse } from '../core/voice/protocol';

declare const self: DedicatedWorkerGlobalScope & {
  navigator: Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
};

// The WASM runtime is served from OUR OWN ORIGIN: `scripts/ort-copy.mjs` publishes the pinned
// runtime's two files into `public/ort/` at build time, so there is no third-party CDN in the path and
// the site keeps working under a strict CSP.
//
// Resolved against THIS worker's own URL (`/assets/tts.worker-*.js` → `/ort/`) rather than
// `import.meta.env.BASE_URL`, which Vite inlines as `./` inside a worker and would then resolve to
// `/assets/ort/` — a 404 that only shows up when the engine actually tries to start.
ort.env.wasm.wasmPaths = new URL('../ort/', self.location.href).href;
// Threads need COOP/COEP headers; without them the runtime silently falls back to one thread, and
// asking for more than one would throw. Single-threaded WASM is the portable choice.
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

type Engine = ReturnType<typeof createSupertonicEngine>;

let engine: Engine | null = null;
let loading: Promise<Engine> | null = null;
let indexer: number[] | null = null;
const styles = new Map<VoicePreset, ReturnType<typeof parseStyle>>();
let currentPreset: VoicePreset = 'F1';
/** The id of the answer allowed to speak right now; anything else is stale by definition. */
let activeId = 0;

function post(message: WorkerResponse) {
  self.postMessage(message);
}

function status(next: Partial<VoiceStatus> & Pick<VoiceStatus, 'phase' | 'message'>) {
  post({ type: 'status', status: { progress: 0, preset: currentPreset, ...next } });
}

/** Wrap an ONNX Runtime session in this repo's tiny `Session` interface. */
async function openSession(bytes: ArrayBuffer, providers: string[]): Promise<Session> {
  const session = await ort.InferenceSession.create(bytes, { executionProviders: providers } as never);
  return {
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    async run(feeds: Record<string, Tensor>) {
      const input: Record<string, ort.Tensor> = {};
      for (const [name, tensor] of Object.entries(feeds)) {
        input[name] = new ort.Tensor(
          tensor.data instanceof BigInt64Array ? 'int64' : 'float32',
          tensor.data as never,
          tensor.dims,
        );
      }
      const output = await session.run(input as never);
      const mapped: Record<string, Tensor> = {};
      for (const [name, tensor] of Object.entries(output)) {
        const value = tensor as ort.Tensor;
        mapped[name] = { data: value.data as Float32Array | BigInt64Array, dims: value.dims as number[] };
      }
      return mapped;
    },
  };
}

/** WebGPU when the browser has it, WASM everywhere else — tried in that order, honestly reported. */
async function executionProviders(): Promise<string[]> {
  try {
    if (self.navigator?.gpu) {
      const adapter = await self.navigator.gpu.requestAdapter();
      if (adapter) return ['webgpu', 'wasm'];
    }
  } catch {
    /* a refused adapter is not an error: WASM is the fallback the model was verified on */
  }
  return ['wasm'];
}

/**
 * Load once per worker. Concurrent callers share one promise, so a second Speak press during the
 * first download cannot start a second 379 MB fetch.
 */
function ensureEngine(): Promise<Engine> {
  if (engine) return Promise.resolve(engine);
  if (loading) return loading;
  loading = (async () => {
    try {
      status({ phase: 'downloading', message: 'Downloading Supertonic 3…', progress: 0 });
      const files = await downloadModel({
        onProgress: (progress) => {
          status({
            phase: 'downloading',
            message: progress.file === 'done' ? 'Supertonic 3 downloaded' : `Downloading Supertonic 3… ${Math.round(progress.overall * 100)}%`,
            progress: clamp01(progress.overall),
          });
        },
      });
      status({ phase: 'initializing', message: 'Initializing Supertonic 3…', progress: 1 });

      const providers = await executionProviders();
      const [duration, textEncoder, vectorEstimator, vocoder] = await Promise.all([
        openSession(files['duration_predictor.onnx'], providers),
        openSession(files['text_encoder.onnx'], providers),
        openSession(files['vector_estimator.onnx'], providers),
        openSession(files['vocoder.onnx'], providers),
      ]);
      indexer = JSON.parse(new TextDecoder().decode(files['unicode_indexer.json'])) as number[];
      const tts = JSON.parse(new TextDecoder().decode(files['tts.json'])) as {
        ae: { sample_rate: number; base_chunk_size: number };
        ttl: { latent_dim: number; chunk_compress_factor: number };
      };

      engine = createSupertonicEngine({
        sessions: { duration, textEncoder, vectorEstimator, vocoder },
        config: {
          sampleRate: tts.ae.sample_rate,
          baseChunkSize: tts.ae.base_chunk_size,
          chunkCompressFactor: tts.ttl.chunk_compress_factor,
          latentDim: tts.ttl.latent_dim,
        },
        encodeText: (text, lang) => encodeText(text, lang, indexer ?? []),
      });
      status({ phase: 'ready', message: 'Supertonic 3 ready', progress: 1 });
      return engine;
    } catch (cause) {
      engine = null;
      const detail = String((cause as Error)?.message ?? cause);
      status({ phase: 'error', message: 'Supertonic 3 could not load', progress: 0, code: 'model-load', detail });
      throw cause;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

async function ensureStyle(preset: VoicePreset, base: string) {
  const cached = styles.get(preset);
  if (cached) return cached;
  const response = await fetch(`${base}/voice_styles/${preset}.json`, { credentials: 'omit', mode: 'cors' });
  if (!response.ok) throw new Error(`voice_styles/${preset}.json: HTTP ${response.status}`);
  const style = parseStyle(await response.json());
  styles.set(preset, style);
  return style;
}

async function speak(request: Extract<WorkerRequest, { type: 'speak' }>, base: string) {
  activeId = request.id;
  const started = Date.now();
  try {
    const ready = await ensureEngine();
    if (request.id !== activeId) return; // superseded while the model was loading
    currentPreset = request.preset;
    const style = await ensureStyle(request.preset, base);
    status({ phase: 'initializing', message: request.lang === 'hi' ? 'Generating Hindi speech…' : 'Generating English speech…', progress: 1 });
    const speech = await ready.synthesize({
      text: request.text,
      lang: request.lang,
      style,
      steps: request.steps,
      speed: request.speed,
    });
    if (request.id !== activeId) return; // a newer answer arrived mid-synthesis
    const pcm = speech.audio.buffer.slice(
      speech.audio.byteOffset,
      speech.audio.byteOffset + speech.audio.byteLength,
    ) as ArrayBuffer;
    post({
      type: 'audio',
      id: request.id,
      pcm,
      sampleRate: speech.sampleRate,
      durationSeconds: speech.durationSeconds,
      synthMs: Date.now() - started,
    });
  } catch (cause) {
    if (request.id !== activeId) return;
    post({
      type: 'error',
      id: request.id,
      code: (cause as { code?: string })?.code ?? 'model-load',
      detail: String((cause as Error)?.message ?? cause),
    });
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  switch (message.type) {
    case 'preload':
      void ensureEngine().catch(() => undefined);
      return;
    case 'speak':
      void speak(message, assetBase());
      return;
    case 'cancel':
      activeId = message.id;
      return;
    case 'clear-cache':
      void clearVoiceCache().then((caches) => {
        styles.clear();
        post({ type: 'cache-cleared', caches });
      });
      return;
    default:
      return;
  }
};
