/**
 * Question-bank honesty (Part 6 of the brief).
 *
 * The brief asks for 500 unique items per module and forbids claiming a count the pack does not hold.
 * These tests recompute every category and difficulty from the published sections and compare them
 * with the manifest the generator publishes, so the UI can print a real number instead of "500+".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register('./_ts-resolve.mjs', import.meta.url);
const nc = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/ncourse.ts')).href);
const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/generated/numpy-course/index.json'), 'utf8'));

const countBy = (list, key) => list.reduce((acc, e) => {
  const value = e[key] || 'unset';
  acc[value] = (acc[value] || 0) + 1;
  return acc;
}, {});

function derive(m) {
  const s = m.sections;
  const categories = {
    concept: s.interview.filter((e) => !e.code).length + s.defense.length,
    output: s.logic.length + s.interview.filter((e) => e.code).length + s.checkpoint.filter((e) => e.options).length,
    coding: s.coding.length,
    debugging: s.debug.length,
    quiz: s.checkpoint.filter((e) => e.options).length,
    written: s.checkpoint.filter((e) => e.rubric).length,
    project: s.miniProject.length + s.projectLab.length,
    scenario: s.interview.filter((e) => e.scenario).length,
  };
  const all = Object.values(s).flat();
  return { total: all.length, categories, difficulty: countBy(all, 'difficulty') };
}

test('the manifest matches the records the artifact actually holds', () => {
  assert.ok(artifact.stats.bank, 'stats.bank is missing');
  assert.equal(artifact.stats.bank.total, artifact.stats.entries);
  for (const m of artifact.modules) {
    const real = derive(m);
    const claimed = artifact.stats.bank.modules[m.id];
    assert.ok(claimed, `${m.id}: no manifest row`);
    assert.equal(claimed.total, real.total, `${m.id}: total mismatch`);
    assert.deepEqual(claimed.categories, real.categories, `${m.id}: category mismatch`);
    assert.deepEqual(claimed.difficulty, real.difficulty, `${m.id}: difficulty mismatch`);
  }
});

test('no module claims 500 items while holding fewer', () => {
  for (const m of artifact.modules) {
    const claimed = artifact.stats.bank.modules[m.id];
    assert.ok(claimed.total < 500, `${m.id} claims ${claimed.total}`);
  }
  assert.equal(artifact.stats.bank.target, 500);
  assert.ok(artifact.stats.bank.shortPerModule > 0, 'shortfall must be stated');
});

test('scenario questions are authored, answered and tagged', () => {
  const scenarios = artifact.modules.flatMap((m) => m.sections.interview.filter((e) => e.scenario));
  assert.ok(scenarios.length >= 40, `only ${scenarios.length} scenario questions`);
  for (const e of scenarios) {
    assert.ok(e.q.trim().length > 40, `${e.id}: scenario prompt too short`);
    assert.ok(e.answer.trim().length > 40, `${e.id}: scenario answer too short`);
    assert.ok(Array.isArray(e.followUps) && e.followUps.length >= 2, `${e.id}: needs at least two follow-ups`);
    const asked = new Set();
    for (const f of e.followUps) {
      assert.ok(f.q.trim().length > 30, `${e.id}: follow-up question too short`);
      assert.ok(f.answer.trim().length > 30, `${e.id}: follow-up answer too short`);
      assert.ok(!asked.has(f.q), `${e.id}: duplicate follow-up question`);
      asked.add(f.q);
    }
  }
  const total = scenarios.reduce((n, e) => n + e.followUps.length, 0);
  assert.ok(total >= 80, `only ${total} follow-ups`);
});

test('every module ships true/false and fill-in-the-blank checkpoints', () => {
  for (const m of artifact.modules) {
    const cp = m.sections.checkpoint;
    const tf = cp.filter((e) => e.format === 'truefalse');
    const blanks = cp.filter((e) => e.format === 'blank');
    assert.ok(tf.length >= 5, `${m.id}: only ${tf.length} true/false checkpoints`);
    assert.ok(blanks.length >= 5, `${m.id}: only ${blanks.length} blank checkpoints`);
    for (const e of tf) {
      assert.deepEqual(e.options, ['True', 'False'], `${e.id}: true/false needs exactly two options`);
      assert.ok(['True', 'False'].includes(e.answer), `${e.id}: answer must be True or False`);
      assert.ok(e.claim && e.expected, `${e.id}: needs the claimed and real output`);
      if (e.answer === 'True') assert.equal(e.claim, e.expected, `${e.id}: a true claim must match the real output`);
      else assert.notEqual(e.claim, e.expected, `${e.id}: a false claim must differ from the real output`);
    }
    for (const e of blanks) {
      assert.ok(e.code.includes('___'), `${e.id}: blank code has no ___`);
      assert.ok(e.solution && !e.solution.includes('___'), `${e.id}: solution must fill the blank`);
      assert.ok(e.answer && e.expected, `${e.id}: needs an answer and a verified output`);
      assert.ok(!/^\s*(import|from)\b/.test(e.code.split('___')[0].split('\n').pop() ?? ''), `${e.id}: no blank on an import line`);
    }
  }
});

test('both new checkpoint formats execute to their published answer', (t) => {
  const probe = spawnSync('python3', ['-c', 'import numpy'], { encoding: 'utf8' });
  if (probe.status !== 0) return t.skip('python3 with numpy is not installed on this machine');
  const cases = artifact.modules.flatMap((m) => m.sections.checkpoint.filter((e) => e.format === 'truefalse' || e.format === 'blank'));
  const script = `
import contextlib, io, json, sys
cases = json.loads(sys.stdin.read())
bad = []
for c in cases:
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            exec(c.get('solution') or c['code'], {})
    except Exception as e:
        bad.append({'id': c['id'], 'why': type(e).__name__ + ': ' + str(e)[:120]})
        continue
    printed = buf.getvalue().strip()
    if printed != c['expected'].strip():
        bad.append({'id': c['id'], 'why': 'output changed', 'expected': c['expected'], 'actual': printed})
print(json.dumps(bad))
`;
  const run = spawnSync('python3', ['-c', script], { input: JSON.stringify(cases), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const bad = JSON.parse(run.stdout.trim() || '[]');
  assert.deepEqual(bad, [], `checkpoint failures: ${JSON.stringify(bad.slice(0, 3))}`);
});

test('every question id is unique and every difficulty is set', () => {
  const ids = new Set();
  for (const m of artifact.modules) {
    for (const list of Object.values(m.sections)) {
      for (const e of list) {
        assert.ok(!ids.has(e.id), `duplicate id ${e.id}`);
        ids.add(e.id);
        assert.ok(['easy', 'medium', 'hard'].includes(e.difficulty), `${e.id}: difficulty ${e.difficulty}`);
      }
    }
  }
});

test('the filter chips select exactly the records the manifest counts', () => {
  for (const m of artifact.modules) {
    const claimed = artifact.stats.bank.modules[m.id];
    for (const category of nc.N_BANK_CATEGORY_ORDER) {
      const matches = nc.bankItems(m, { category, difficulty: null });
      assert.equal(matches.length, claimed.categories[category], `${m.id}: ${category} filter count`);
      for (const match of matches) {
        assert.equal(match.entry.id, m.sections[match.section][match.index].id, `${m.id}: stale match index`);
        assert.ok(nc.bankCategoryMatch(match.section, match.entry, category), `${m.id}: wrong category match`);
      }
    }
    for (const difficulty of ['easy', 'medium', 'hard']) {
      const matches = nc.bankItems(m, { category: null, difficulty });
      assert.equal(matches.length, claimed.difficulty[difficulty], `${m.id}: ${difficulty} filter count`);
    }
  }
});

test('category and difficulty chips combine as an AND', () => {
  const m = artifact.modules[0];
  const both = nc.bankItems(m, { category: 'coding', difficulty: 'hard' });
  for (const match of both) {
    assert.equal(match.section, 'coding');
    assert.equal(match.entry.difficulty, 'hard');
  }
  assert.ok(both.length > 0, 'fixture has no hard coding item');
  assert.ok(both.length <= nc.bankItems(m, { category: 'coding', difficulty: null }).length);
});
