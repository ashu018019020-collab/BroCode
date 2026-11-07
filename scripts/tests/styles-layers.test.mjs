/**
 * The stylesheet is layered now, and a split only holds if it stays split.
 *
 * The failure modes are quiet ones: `src/styles.css` slowly collecting rules again until it is a
 * stylesheet with an @import ritual on top; a layer renamed on disk while the manifest still names
 * the old file (a missing @import resolves to nothing, so a whole layer of styling disappears with
 * no build error); or a layer emptied during a refactor, which reads as "styles moved" when they
 * were lost. Each is caught here, in milliseconds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { readCss, styleLayers, STYLE_DIR, STYLE_ENTRY } from './_css.mjs';

test('styles: the entry is a manifest of imports, not a stylesheet', () => {
  const entry = fs.readFileSync(STYLE_ENTRY, 'utf8');
  const body = entry.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);

  assert.ok(lines.length > 1, 'the entry must import the layers instead of holding rules');
  for (const line of lines) {
    assert.match(
      line,
      /^@import ['"]\.\/styles\/\d{2}-[a-z-]+\.css['"];$/,
      `the entry may only import layers, found: ${line}`,
    );
  }
});

test('styles: every layer is imported, in cascade order, and exists on disk', () => {
  const layers = styleLayers();
  assert.ok(layers.length > 1, 'a single layer is not a split');

  const names = layers.map((file) => path.basename(file));
  assert.deepEqual(names, [...names].sort(), 'layers must be imported in numeric order — the cascade depends on it');

  const onDisk = fs.readdirSync(STYLE_DIR).filter((file) => file.endsWith('.css')).sort();
  assert.deepEqual(
    onDisk,
    [...names].sort(),
    'a layer on disk that the manifest skips is dead weight, and a manifest entry with no file loses styling',
  );

  for (const file of layers) {
    const css = fs.readFileSync(file, 'utf8');
    assert.ok(css.trim().length > 0, `${path.basename(file)} is empty`);
    assert.ok(css.includes('{'), `${path.basename(file)} declares no rules`);
  }
});

test('styles: the layers still add up to the whole cascade', () => {
  const css = readCss();
  assert.ok(css.split('\n').length > 5000, 'the concatenated layers must hold the full stylesheet');
  assert.match(css, /--[a-z0-9-]+:\s*[^;]+;/, 'the design tokens must survive the split');
  assert.match(css, /@media\s*\([^)]*max-width/, 'the responsive pass must survive the split');
});
