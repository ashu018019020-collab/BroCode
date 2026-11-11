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
/** The depth layers are part of the authored source, so the artifact is compared against the merge. */
const deepening = {};
for (const file of fs.readdirSync(SRC).filter((f) => /^deepening.*\.json$/.test(f))) {
  for (const [id, pack] of Object.entries(readJSON(path.join('content', 'numpy-mastery', file)))) {
    const into = deepening[id] || (deepening[id] = { topics: [], debug: [] });
    into.topics.push(...(pack.topics || []));
    if (pack.debug) into.debug.push(...pack.debug);
  }
}
const sourceOf = (id) => {
  const base = authored.find((m) => m.id === id);
  const extra = deepening[id] || {};
  return { ...base, topics: [...base.topics, ...(extra.topics || [])], debug: [...base.debug, ...(extra.debug || [])] };
};
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
  for (const module of artifact.modules) {
    const source = sourceOf(module.id);
    assert.equal(module.title, source.title);
    assert.equal(module.sections.learn.length, source.topics.length, `${module.id}: Learn is one entry per topic`);
    assert.equal(module.sections.debug.length, source.debug.length, `${module.id}: Debug is one entry per challenge`);
    assert.equal(module.entries, Object.values(module.counts).reduce((a, b) => a + b, 0));
  }
});

test('numpy course: every deepening sample carries an executed output', () => {
  for (const [id, pack] of Object.entries(deepening)) {
    assert.ok(authored.some((m) => m.id === id), `deepening targets unknown module ${id}`);
    for (const topic of pack.topics || []) {
      assert.ok(topic.code && topic.output, `${id}: ${topic.title} needs code and output`);
    }
  }
});

const tasks = {};
for (const file of fs.readdirSync(SRC).filter((f) => /^tasks.*\.json$/.test(f))) {
  for (const [id, list] of Object.entries(readJSON(path.join('content', 'numpy-mastery', file)))) {
    (tasks[id] || (tasks[id] = [])).push(...list);
  }
}

test('numpy course: every module ships independent tasks with a hidden check', () => {
  for (const m of artifact.modules) {
    const authored = tasks[m.id] ?? [];
    assert.ok(authored.length >= 4, `${m.id}: expected 4+ independent tasks, found ${authored.length}`);
    const published = m.sections.coding.filter((e) => e.kind === 'task');
    assert.equal(published.length, authored.length, `${m.id}: every authored task must be published`);
    for (const task of authored) {
      assert.ok(task.statement && task.solution && task.check, `${m.id}: "${task.title}" is incomplete`);
      assert.ok(task.expected, `${m.id}: "${task.title}" needs its executed output`);
    }
  }
  const total = Object.values(tasks).reduce((a, list) => a + list.length, 0);
  const publishedTotal = artifact.modules.reduce((a, m) => a + m.sections.coding.filter((e) => e.kind === 'task').length, 0);
  assert.equal(publishedTotal, total, 'the artifact must carry every independent task');
});

test('numpy course: each independent task solves its own hidden check', (t) => {
  const probe = spawnSync('python3', ['-c', 'import numpy'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    t.skip('python3 with numpy is not installed on this machine');
    return;
  }
  const cases = Object.entries(tasks).flatMap(([id, list]) =>
    list.map((task) => ({ id: `${id}:${task.title}`, solution: task.solution, check: task.check, expected: task.expected })));
  const script = `
import json, io, contextlib, sys
cases = json.load(sys.stdin)
bad = []
for c in cases:
    ns = {}
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            exec(c['solution'], ns)
        printed = buf.getvalue().strip()
        if printed != c['expected'].strip():
            bad.append({'id': c['id'], 'why': 'reference output changed', 'expected': c['expected'], 'actual': printed})
            continue
        exec(c['check'], ns)
    except Exception as e:
        bad.append({'id': c['id'], 'why': type(e).__name__ + ': ' + str(e)[:120]})
print(json.dumps(bad))
`;
  const run = spawnSync('python3', ['-c', script], { input: JSON.stringify(cases), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const bad = JSON.parse(run.stdout.trim() || '[]');
  assert.deepEqual(bad, [], `task failures: ${JSON.stringify(bad.slice(0, 3))}`);
});

test('numpy course: every debug fix runs, and broken code raises or prints something else', (t) => {
  const probe = spawnSync('python3', ['-c', 'import numpy'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    t.skip('python3 with numpy is not installed on this machine');
    return;
  }
  const cases = artifact.modules.flatMap((m) => m.sections.debug.map((e) => ({ id: e.id, broken: e.code, fix: e.fix })));
  const script = `
import json, io, contextlib, sys
cases = json.load(sys.stdin)
problems, raised, differed = [], 0, 0
def run(code):
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            exec(code, {})
        return True, buf.getvalue().strip()
    except Exception:
        return False, buf.getvalue().strip()
for c in cases:
    ok_broken, out_broken = run(c['broken'])
    ok_fix, out_fix = run(c['fix'])
    if not ok_fix:
        problems.append({'id': c['id'], 'why': 'the fix raises'})
        continue
    if ok_broken:
        if out_broken == out_fix:
            problems.append({'id': c['id'], 'why': 'broken code behaves exactly like the fix'})
        else:
            differed += 1
    else:
        raised += 1
print(json.dumps({'problems': problems, 'raised': raised, 'differed': differed}))
`;
  const run = spawnSync('python3', ['-c', script], { input: JSON.stringify(cases), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout.trim());
  assert.deepEqual(report.problems, [], `debug problems: ${JSON.stringify(report.problems.slice(0, 3))}`);
  assert.equal(report.raised + report.differed, cases.length, 'every challenge must be exercised');
});

test('numpy course: every checkpoint quiz offers three distinct options including the answer', () => {
  let quizzes = 0;
  for (const m of artifact.modules) {
    for (const e of m.sections.checkpoint) {
      if (!e.options) continue;
      quizzes += 1;
      assert.equal(e.options.length, 3, `${e.id}: a quiz offers three options`);
      assert.equal(new Set(e.options).size, 3, `${e.id}: options must be distinct`);
      assert.ok(e.options.includes(e.answer), `${e.id}: the answer must be one of the options`);
    }
  }
  assert.ok(quizzes >= 200, `expected checkpoint quizzes, found ${quizzes}`);
});

test('numpy course: every written checkpoint has three real rubric criteria', () => {
  let written = 0;
  for (const m of artifact.modules) {
    for (const e of m.sections.checkpoint) {
      if (!e.rubric) continue;
      written += 1;
      assert.equal(e.rubric.length, 3, `${e.id}: three criteria`);
      assert.ok(e.rubric.every((line) => typeof line === 'string' && line.trim()), `${e.id}: criteria must not be blank`);
      assert.ok(e.answer, `${e.id}: a written checkpoint still needs a model answer`);
    }
  }
  assert.ok(written >= 200, `expected written checkpoints, found ${written}`);
});

test('numpy course: a written answer and its ticks are stored per entry, not per section', () => {
  const answer = engine.nWrittenAnswerKey('n01-checkpoint-1');
  const ticks = engine.nWrittenTicksKey('n01-checkpoint-1');
  assert.equal(answer, 'nans:n01-checkpoint-1');
  assert.equal(ticks, 'ntick:n01-checkpoint-1');
  assert.notEqual(answer, engine.nSectionKey('n01', 'checkpoint'));
  assert.notEqual(answer, ticks);
  assert.ok(!answer.startsWith('nmod:'), 'a draft must not be readable as a completed section');
});

test('numpy course: self-assessment ticks round-trip and pad to the rubric length', () => {
  assert.equal(engine.encodeTicks([true, false, true]), '1,0,1');
  assert.deepEqual(engine.decodeTicks('1,0,1', 3), [true, false, true]);
  assert.deepEqual(engine.decodeTicks('', 3), [false, false, false]);
  assert.deepEqual(engine.decodeTicks('1', 3), [true, false, false]);
  assert.deepEqual(engine.decodeTicks('1,0,1,1,1', 3), [true, false, true]);
  for (const m of artifact.modules) {
    for (const e of m.sections.checkpoint) {
      if (!e.rubric) continue;
      const picked = e.rubric.map((_, i) => i % 2 === 0);
      assert.deepEqual(engine.decodeTicks(engine.encodeTicks(picked), e.rubric.length), picked, e.id);
    }
  }
});

test('numpy course: every Coding Lab entry is an independent graded task', () => {
  for (const m of artifact.modules) {
    assert.equal(m.sections.coding.length, (tasks[m.id] || []).length, `${m.id}: Coding Lab is exactly the task bank`);
    for (const e of m.sections.coding) {
      assert.equal(e.kind, 'task', `${e.id}: guided coding entries are not published`);
      assert.ok(e.check, `${e.id}: every Coding Lab entry needs a hidden check`);
    }
  }
});

test('numpy course: coding output is graded on the printed text, not on whitespace noise', () => {
  assert.equal(engine.normalizeOutput('a\r\nb  \n\n'), 'a\nb');
  assert.equal(engine.normalizeOutput('[1 2]'), '[1 2]');

  assert.equal(engine.outputMatches('[1 2]\n', '[1 2]'), true, 'a trailing newline is not a difference');
  assert.equal(engine.outputMatches('[1 2]', '[1  2]'), false, 'internal spacing is a real difference');
  assert.equal(engine.outputMatches('[1 2]', '[2 1]'), false, 'order matters');
  assert.equal(engine.outputMatches('True', 'true'), false, 'case matters');
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
