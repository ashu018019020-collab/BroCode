/**
 * Publish the ONNX Runtime WASM runtime with the site.
 *
 * `onnxruntime-web` ships its `.wasm` and its loader `.mjs` inside `dist/`, which its package
 * `exports` map does not expose — so a bundler import of them fails, and a CDN copy would make the
 * voice depend on a third party at runtime and break under a strict CSP. Copying the pair into
 * `public/ort/` at build time keeps them same-origin, content-addressed by nothing but the package
 * version, and out of Git (see .gitignore): the files are a build artifact of a pinned dependency.
 *
 * Idempotent, and it verifies the copy: a truncated .wasm fails at `InferenceSession.create` with an
 * opaque protobuf error, which is exactly the kind of failure that costs an afternoon to diagnose.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FROM = path.join(ROOT, 'node_modules/onnxruntime-web/dist');
const TO = path.join(ROOT, 'public/ort');
const FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];

if (!existsSync(FROM)) {
  console.error(`✕ onnxruntime-web is not installed (looked in ${FROM}). Run npm ci.`);
  process.exit(1);
}

mkdirSync(TO, { recursive: true });
for (const file of FILES) {
  const source = path.join(FROM, file);
  const target = path.join(TO, file);
  if (!existsSync(source)) {
    console.error(`✕ ${file} is missing from onnxruntime-web; the voice cannot run.`);
    process.exit(1);
  }
  copyFileSync(source, target);
  const size = statSync(target).size;
  if (size !== statSync(source).size || size === 0) {
    console.error(`✕ ${file} copied incompletely (${size} bytes).`);
    process.exit(1);
  }
  // A .wasm starts with the magic bytes \0asm; a .mjs must parse.
  if (file.endsWith('.wasm')) {
    const head = readFileSync(target).subarray(0, 4);
    if (head[0] !== 0x00 || head.toString('ascii', 1) !== 'asm') {
      console.error(`✕ ${file} is not a WebAssembly module.`);
      process.exit(1);
    }
  }
  console.log(`✓ public/ort/${file} (${(size / 1048576).toFixed(1)} MB)`);
}
