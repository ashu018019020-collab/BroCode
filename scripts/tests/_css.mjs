/**
 * Reads the stylesheet the way the browser will see it.
 *
 * `src/styles.css` is now only a manifest: it imports the layered files in cascade order and holds
 * no rules of its own. A CSS guard that keeps reading the manifest still passes — on a comment and
 * eight @import lines — so every such guard would silently become a no-op. This helper concatenates
 * the layers in the entry's own declared order, i.e. the exact byte stream the browser applies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const STYLE_ENTRY = path.join(ROOT, 'src', 'styles.css');
export const STYLE_DIR = path.join(ROOT, 'src', 'styles');

/** The entry's `@import` targets, resolved, in cascade order. */
export function styleLayers() {
  const entry = fs.readFileSync(STYLE_ENTRY, 'utf8');
  return [...entry.matchAll(/@import\s+['"]([^'"]+)['"]/g)]
    .map((m) => path.resolve(path.dirname(STYLE_ENTRY), m[1]));
}

/** Every layer, concatenated in cascade order — the stylesheet as the browser resolves it. */
export function readCss() {
  return styleLayers().map((file) => fs.readFileSync(file, 'utf8')).join('');
}
