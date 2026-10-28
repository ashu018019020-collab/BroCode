/**
 * Put the Supertonic 3 weights on the SERVER once.
 *
 * The browser used to stream these 398 MB into a Cache API bucket per learner. Now the model lives
 * beside the inference service: one download per deployment (or per mounted volume), zero per visitor.
 * The revision and the byte sizes come from `src/core/ai/supertonic.ts`, so this script cannot drift
 * from the graphs the engine actually opens — a mismatch fails here instead of producing noise.
 *
 *   node scripts/voice-model.mjs                 # → models/supertonic-3
 *   node scripts/voice-model.mjs --dir=/models   # a mounted volume
 *   node scripts/voice-model.mjs --only=style    # JSON assets only
 *
 * Nothing here runs during `npm run build` or on the web host: the frontend never needs the weights.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where the service expects the model unless `SUPERTONIC_MODEL_DIR` says otherwise. */
export function modelDirFromEnv(env = process.env) {
  const configured = String(env.SUPERTONIC_MODEL_DIR ?? '').trim();
  if (configured) return path.resolve(ROOT, configured);
  return path.join(ROOT, 'models', 'supertonic-3');
}

async function loadCore() {
  return import(pathToFileURL(path.join(ROOT, 'src/core/ai/supertonic.ts')).href);
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} kB`;
}

async function fetchOnce(url, expectedBytes, logger) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (expectedBytes && buffer.byteLength !== expectedBytes) {
    throw new Error(`${url} is ${buffer.byteLength} bytes, expected ${expectedBytes}`);
  }
  logger?.log?.(`  fetched ${humanBytes(buffer.byteLength)}`);
  return buffer;
}

/**
 * Ensure every required asset exists under `dir`. Files already present at the right size are kept, so
 * a restart on a volume is free; a truncated file is replaced rather than loaded by ONNX and rejected
 * with a shape error nobody can read.
 */
export async function downloadModel({ dir = modelDirFromEnv(), logger = console, retries = 2 } = {}) {
  const core = await loadCore();
  const styleId = String(process.env.SUPERTONIC_STYLE ?? 'F1').trim() || 'F1';
  const assets = [
    ...core.SUPERTONIC_WEIGHTS.map((file) => ({ path: file.path, bytes: file.bytes, label: file.label })),
    { path: core.SUPERTONIC_CONFIG_PATH, bytes: 0, label: 'Graph config' },
    { path: core.SUPERTONIC_INDEXER_PATH, bytes: 0, label: 'Character index' },
    { path: core.supertonicStylePath(styleId), bytes: 0, label: `Voice style ${styleId}` },
  ];

  let downloaded = 0;
  for (const asset of assets) {
    const target = path.join(dir, asset.path);
    const present = fs.existsSync(target) ? fs.statSync(target).size : 0;
    if (present > 0 && (!asset.bytes || present === asset.bytes)) {
      logger?.log?.(`  present ${asset.path.padEnd(34)} ${humanBytes(present)}`);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    logger?.log?.(`  fetch   ${asset.path.padEnd(34)} ${asset.label}`);
    const url = core.supertonicAsset(asset.path);
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const buffer = await fetchOnce(url, asset.bytes, logger);
        fs.writeFileSync(target, buffer);
        downloaded += buffer.byteLength;
        lastError = null;
        break;
      } catch (cause) {
        lastError = cause;
        if (attempt < retries) {
          const wait = 800 * (attempt + 1);
          logger?.warn?.(`  retry   ${asset.path} in ${wait} ms (${cause?.message ?? cause})`);
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
      }
    }
    if (lastError) throw lastError;
  }
  logger?.log?.(downloaded
    ? `Model ready in ${path.relative(ROOT, dir) || dir} (${humanBytes(downloaded)} downloaded).`
    : `Model already complete in ${path.relative(ROOT, dir) || dir}.`);
  return { dir, downloaded };
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const args = new Map(process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
    return [key, value];
  }));
  const dir = args.get('dir') ? path.resolve(args.get('dir')) : modelDirFromEnv();
  console.log(`Supertonic 3 weights → ${dir}`);
  try {
    await downloadModel({ dir });
  } catch (cause) {
    console.error('The model could not be prepared.', cause?.message ?? cause);
    process.exit(1);
  }
}
