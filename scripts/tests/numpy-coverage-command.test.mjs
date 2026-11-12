/**
 * The coverage command must count the published artifact, not a hand-maintained list.
 *
 * These tests run the real CLI and compare its per-module rows and summary with numbers recomputed
 * from `public/generated/numpy-course/index.json`, then check that `--strict` fails exactly when a
 * gap exists — so a broken report cannot quietly claim a module is complete.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'numpy-coverage.cjs');
const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/generated/numpy-course/index.json'), 'utf8'));

const isFull = (t) => Boolean(
  t.syntax && t.visual && t.realWorld
  && Array.isArray(t.steps) && t.steps.length
  && Array.isArray(t.mistakes) && t.mistakes.length
  && Array.isArray(t.revision) && t.revision.length,
);

const totals = artifact.modules.reduce((acc, m) => {
  const topics = m.sections.learn || [];
  acc.topics += topics.length;
  acc.full += topics.filter(isFull).length;
  acc.dual += topics.filter((t) => t.simple && t.pro).length;
  return acc;
}, { topics: 0, full: 0, dual: 0 });

test('the coverage command reports each module from the real artifact', () => {
  const run = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^NumPy lesson coverage/m);
  for (const m of artifact.modules) {
    const topics = m.sections.learn || [];
    const full = topics.filter(isFull).length;
    assert.ok(
      run.stdout.includes(`${m.id.padEnd(6)} ${String(m.title).slice(0, 32).padEnd(34)} ${String(topics.length).padStart(6)}`),
      `${m.id}: module row missing or misaligned`,
    );
    assert.ok(run.stdout.includes(`${full}/${topics.length}`), `${m.id}: full-shape count ${full}/${topics.length} missing`);
    assert.ok(run.stdout.includes(`${topics.filter((t) => t.simple && t.pro).length}/${topics.length}`), `${m.id}: dual count missing`);
  }
  assert.ok(
    run.stdout.includes(`full 12-part: ${totals.full}/${totals.topics}`),
    `summary should say ${totals.full}/${totals.topics}`,
  );
  assert.ok(run.stdout.includes(`dual-level: ${totals.dual}/${totals.topics}`), 'dual summary missing');
});

test('gaps are named, and --strict fails only when a gap exists', () => {
  const gaps = totals.topics - totals.full;
  const run = spawnSync('node', [SCRIPT, '--strict'], { encoding: 'utf8' });
  assert.equal(run.status, gaps ? 1 : 0, `expected exit ${gaps ? 1 : 0} with ${gaps} missing topics`);
  if (!gaps) {
    assert.match(run.stdout, /No gaps/);
    return;
  }
  assert.match(run.stdout, /Missing parts:/);
  const firstGap = artifact.modules.find((m) => (m.sections.learn || []).some((t) => !isFull(t)));
  assert.ok(run.stdout.includes(firstGap.id), `first gap ${firstGap.id} not reported`);
  assert.match(run.stderr, /--strict/);
});
