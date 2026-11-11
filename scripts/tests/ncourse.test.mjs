/**
 * NumPy Mastery course contracts.
 *
 * Three promises:
 *  1. the published artifact is a faithful projection of the authored pack (counts are counted),
 *  2. every module holds all ten sections, with unique ids and unique question text,
 *  3. the completion rule needs every section — a checkpoint alone never marks a module done.
 *
 * The code/output pairs are additionally executed against the real `numpy` when this machine has
 * one; without it the check is reported as a skip, never as a pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
register('./_ts-resolve.mjs', import.meta.url);
const engine = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/ncourse.ts')).href);

const SRC = path.join(ROOT, 'content', 'numpy-mastery');
const authored = fs.readdirSync(SRC).filter((f) => /^modules-.*\.json$/.test(f)).sort()
  .flatMap((f) => readJSON(path.join('content', 'numpy-mastery', f)));
const artifact = readJSON('public/generated/numpy-course/index.json');
const SECTIONS = engine.N_SECTIONS.map((s) => s.key);

test('numpy course: the artifact publishes all 20 modules, in order', () => {
  assert.equal(artifact.modules.length, 20);
  artifact.modules.forEach((m, i) => {
    assert.equal(m.id, `n${String(i + 1).padStart(2, '0')}`);
    assert.equal(m.no, i + 1);
    assert.ok(m.title && m.goal, `${m.id} needs a title and goal`);
  });
  assert.equal(artifact.stats.modules, 20);
});

test('numpy course: every module holds all ten sections, and the counts are real', () => {
  for (const m of artifact.modules) {
    for (const key of SECTIONS) {
      assert.ok(Array.isArray(m.sections[key]) && m.sections[key].length > 0, `${m.id}/${key} is empty`);
      assert.equal(m.counts[key], m.sections[key].length, `${m.id}/${key}: count must equal the records`);
    }
    const total = SECTIONS.reduce((a, key) => a + m.sections[key].length, 0);
    assert.equal(m.entries, total, `${m.id}: entries must equal the section sum`);
  }
  const published = artifact.modules.reduce((a, m) => a + m.entries, 0);
  assert.equal(artifact.stats.entries, published, 'the header total is the sum of real records');
});

test('numpy course: no duplicate ids or question text inside a section', () => {
  for (const m of artifact.modules) {
    for (const key of SECTIONS) {
      const list = m.sections[key];
      const ids = list.map((e) => e.id);
      assert.equal(new Set(ids).size, ids.length, `${m.id}/${key}: duplicate id`);
      const prompts = list.map((e) => e.q || e.title).filter(Boolean);
      assert.equal(new Set(prompts).size, prompts.length, `${m.id}/${key}: duplicate question`);
    }
  }
});

test('numpy course: the artifact is a projection of the authored pack', () => {
  assert.equal(artifact.modules.length, authored.length);
  for (const [i, module] of artifact.modules.entries()) {
    const source = authored[i];
    assert.equal(module.title, source.title);
    assert.equal(module.entries, 31, `${module.id}: projection must keep its full entry count`);
    assert.equal(module.sections.learn.length, source.topics.length);
    assert.equal(module.sections.debug.length, source.debug.length);
  }
});

test('numpy course: a module is complete only when all ten sections are recorded', () => {
  const modules = [{ id: 'n01' }];
  assert.equal(engine.isModuleComplete('n01', {}), false);
  assert.equal(engine.nProgress(modules, {}).pct, 0);

  const nine = Object.fromEntries(SECTIONS.slice(0, 9).map((key) => [engine.nSectionKey('n01', key), { done: true }]));
  assert.equal(engine.isModuleComplete('n01', nine), false, 'nine of ten is not complete');

  const all = { ...nine, [engine.nSectionKey('n01', 'checkpoint')]: { done: true } };
  assert.equal(engine.isModuleComplete('n01', all), true);
  assert.equal(engine.nProgress(modules, all).pct, 100);
  assert.equal(engine.nextSection('n01', nine), 'checkpoint');
});

test('numpy course: every Learn code sample prints exactly its published output', (t) => {
  const probe = spawnSync('python3', ['-c', 'import numpy'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    t.skip('python3 with numpy is not installed on this machine');
    return;
  }
  const cases = artifact.modules.flatMap((m) => m.sections.learn
    .filter((e) => e.code)
    .map((e) => ({ id: e.id, code: e.code, output: e.output })));
  const script = `
import json, io, contextlib, sys
cases = json.load(sys.stdin)
bad = []
for c in cases:
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            exec(c['code'], {})
        got = buf.getvalue().strip()
    except Exception as e:
        got = 'EXC: ' + type(e).__name__ + ': ' + str(e)
    if got != c['output'].strip():
        bad.append({'id': c['id'], 'expected': c['output'], 'actual': got})
print(json.dumps(bad))
`;
  const run = spawnSync('python3', ['-c', script], { input: JSON.stringify(cases), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const bad = JSON.parse(run.stdout.trim() || '[]');
  assert.deepEqual(bad, [], `code/output mismatches: ${JSON.stringify(bad.slice(0, 3))}`);
});
