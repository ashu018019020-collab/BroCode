/**
 * Copy ONNX Runtime Web's two browser files into `public/ort/`.
 *
 * `onnxruntime-web`'s package `exports` map exposes only its entry points (`.`, `./wasm`, `./webgpu`),
 * so Vite cannot resolve `onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url` — the build fails at
 * resolve time. Copying the files is the supported way: the app then points ORT's `wasmPaths` at a real
 * same-origin URL, which is also what makes it work from a subpath and offline-ish from the HTTP cache.
 *
 * The copies are BUILD OUTPUT, not source: `public/ort/` is gitignored, `predev`/`prebuild` regenerate
 * it from the installed package, and nothing hand-edits it. Version skew is impossible because the
 * files come from the same `node_modules` the bundler imports.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FROM = path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist');
const TO = path.join(ROOT, 'public', 'ort');

/** Exactly the two files `supertonic-runtime.ts` names. The unit test pins this list. */
export const ORT_RUNTIME_FILES = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

if (!fs.existsSync(FROM)) {
  console.error('onnxruntime-web is not installed — run npm install first.');
  process.exit(1);
}

fs.mkdirSync(TO, { recursive: true });
let copied = 0;
for (const file of ORT_RUNTIME_FILES) {
  const source = path.join(FROM, file);
  const target = path.join(TO, file);
  if (!fs.existsSync(source)) {
    console.error(`onnxruntime-web has no dist/${file}`);
    process.exit(1);
  }
  const sourceSize = fs.statSync(source).size;
  if (fs.existsSync(target) && fs.statSync(target).size === sourceSize) continue;
  fs.copyFileSync(source, target);
  copied += 1;
  console.log(`ort: ${file} → public/ort (${(sourceSize / 1e6).toFixed(1)} MB)`);
}
if (copied === 0) console.log('ort: public/ort is up to date');
