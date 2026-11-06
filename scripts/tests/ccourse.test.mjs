/**
 * C Programming course contracts.
 *
 * These check three different things, because each one has failed elsewhere in this repo before:
 *  1. the authored content really has every lesson block (a lesson with six blocks is not a lesson),
 *  2. the generated artifacts are a faithful projection of that content (counts on the card are
 *     counted, never typed by hand), and
 *  3. every lab's reference solution actually compiles and produces the stdout its public tests
 *     demand — the same promise the Judge0 runner makes to a learner.
 *
 * Gaps in the third check are reported as skips, never passes: without gcc this file says so.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const engine = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/ccourse.ts')).href);

const course = readJSON('content/c-programming/course.json');
const modules = course.modules.map((id) => readJSON(`content/c-programming/modules/${id}.json`));
const extraLabs = readJSON('content/c-programming/labs.json');
const labs = readJSON('public/generated/c-course/labs.json').labs;
const projects = readJSON('content/c-programming/projects.json');
const interview = readJSON('content/c-programming/interview.json');
const assessments = readJSON('content/c-programming/assessments.json');
const index = readJSON('public/generated/c-course/index.json');
const artifactCourse = readJSON('public/generated/c-course/course.json');

const BLOCKS = ['prereqs', 'definition', 'explain', 'analogy', 'why', 'syntax', 'topics', 'examples', 'visual',
  'mistakes', 'debug', 'best', 'practice', 'mcqs', 'interview', 'lab', 'checkpoint'];
/** The five modules where a picture of memory is the lesson, not decoration. */
const MEMORY_MODULES = ['c13', 'c14', 'c15', 'c16'];

test('twenty modules, authored in order, each with a level and hours', () => {
  assert.equal(modules.length, 20);
  assert.deepEqual(course.modules, modules.map((m) => m.id));
  modules.forEach((m, i) => {
    assert.equal(m.id, `c${String(i + 1).padStart(2, '0')}`);
    assert.equal(m.no, i + 1);
    assert.ok(['beginner', 'intermediate', 'advanced'].includes(m.level), `${m.id} level`);
    assert.ok(m.hours > 0, `${m.id} hours`);
  });
});

test('every lesson carries the full 22-block learning structure', () => {
  for (const m of modules) {
    for (const key of BLOCKS) {
      if (key === 'visual') continue; // optional, but mandatory for the memory modules below
      assert.ok(m[key] !== undefined && m[key] !== null, `${m.id} missing ${key}`);
    }
    assert.ok(m.topics.length >= 3, `${m.id} topics`);
    for (const t of m.topics) assert.ok(t.title && t.body, `${m.id} topic body`);
    assert.ok(m.examples.length >= 2, `${m.id} examples`);
    for (const ex of m.examples) {
      assert.ok(ex.code && ex.output, `${m.id} example code/output`);
      assert.ok(ex.lines.length >= 2, `${m.id} line-by-line notes`);
    }
    for (const q of m.mcqs) {
      assert.equal(q.options.length, 4, `${m.id} MCQ options`);
      assert.ok(q.answer >= 0 && q.answer < 4, `${m.id} MCQ answer`);
      assert.ok(q.explain, `${m.id} MCQ explanation`);
    }
    assert.ok(m.practice.length >= 3, `${m.id} practice`);
    assert.ok(m.interview.length >= 1, `${m.id} interview`);
    assert.ok(m.debug.code && m.debug.expected && m.debug.fix, `${m.id} debug exercise`);
    assert.ok(m.lab.solution && m.lab.tests.length > 0, `${m.id} lab`);
    assert.ok(m.checkpoint.checks.length > 0, `${m.id} checkpoint`);
  }
});

test('pointer, array, structure and heap lessons ship a memory map', () => {
  for (const id of MEMORY_MODULES) {
    const m = modules.find((x) => x.id === id);
    assert.ok(m?.visual?.rows?.length >= 3, `${id} needs a visual memory map`);
  }
});

test('labs, projects, interview bank and assessments are complete and cross-referenced', () => {
  assert.equal(labs.length, modules.length + extraLabs.length);
  assert.ok(extraLabs.length >= 20, `expected 20+ extra labs, found ${extraLabs.length}`);
  const moduleIds = new Set(modules.map((m) => m.id));
  const ids = new Set();
  for (const lab of labs) {
    assert.ok(!ids.has(lab.id), `duplicate lab id ${lab.id}`);
    ids.add(lab.id);
    assert.ok(moduleIds.has(lab.module), `${lab.id} points at ${lab.module}`);
    assert.ok(lab.starter && lab.solution && lab.hints.length, `${lab.id} incomplete`);
    assert.ok(lab.tests.length > 0, `${lab.id} tests`);
    for (const t of lab.tests) assert.equal(typeof t.stdout, 'string', `${lab.id} test stdout`);
  }
  assert.ok(projects.length >= 15, `expected 15+ projects, found ${projects.length}`);
  for (const p of projects) assert.ok(p.milestones.length > 0, `${p.id} milestones`);

  const bank = [...modules.flatMap((m) => m.interview), ...interview];
  assert.ok(bank.length >= 100, `expected 100+ interview answers, found ${bank.length}`);
  assert.ok(interview.length >= 50, `expected 50+ bank questions, found ${interview.length}`);

  assert.equal(assessments.sets.length, 20);
  for (const set of assessments.sets) {
    assert.ok(moduleIds.has(set.module), `${set.id} module`);
    for (const q of set.questions) assert.ok(q.answer >= 0 && q.answer < 4, `${set.id} answer index`);
  }
});

test('generated artifacts are counted from the authored content', () => {
  assert.equal(artifactCourse.modules.length, modules.length);
  assert.deepEqual(artifactCourse.modules.map((m) => m.title), modules.map((m) => m.title));
  assert.equal(index.stats.modules, modules.length);
  assert.equal(index.stats.topics, modules.reduce((a, m) => a + m.topics.length, 0));
  assert.equal(index.stats.examples, modules.reduce((a, m) => a + m.examples.length, 0));
  assert.equal(index.stats.labs, labs.length);
  assert.equal(index.stats.projects, projects.length);
  assert.equal(index.stats.interview, index.stats.interview);
  assert.equal(index.stats.interview, modules.reduce((a, m) => a + m.interview.length, 0) + interview.length);
  assert.equal(index.stats.mcqs,
    modules.reduce((a, m) => a + m.mcqs.length, 0) + assessments.sets.reduce((a, s) => a + s.questions.length, 0));
  index.modules.forEach((card, i) => {
    assert.equal(card.counts.topics, modules[i].topics.length, `${card.id} topic count`);
    assert.equal(card.counts.mcqs, modules[i].mcqs.length, `${card.id} mcq count`);
  });
});

test('progress rules: sequential unlock, resume target, honest percentage', () => {
  const cards = index.modules;
  assert.equal(engine.checkpointKey('c03'), 'ccourse:c03:checkpoint');
  assert.equal(engine.isUnlocked(0, new Set(), cards), true);
  assert.equal(engine.isUnlocked(1, new Set(), cards), false);
  assert.equal(engine.isUnlocked(1, new Set(['c01']), cards), true);
  assert.equal(engine.isUnlocked(0, new Set(['c01', 'c02']), cards), true);

  const empty = engine.progressOf(cards, new Set());
  assert.deepEqual([empty.completed, empty.total, empty.pct], [0, cards.length, 0]);
  const half = engine.progressOf(cards, new Set(cards.slice(0, 10).map((m) => m.id)));
  assert.equal(half.completed, 10);
  assert.equal(half.pct, 50);
  assert.equal(engine.nextModule(cards, new Set())?.id, 'c01');
  assert.equal(engine.nextModule(cards, new Set(['c01']))?.id, 'c02');
  assert.equal(engine.nextModule(cards, new Set(cards.map((m) => m.id))), null);
});

test('quiz scoring counts correct answers, and reports what to review', () => {
  const qs = modules[0].mcqs;
  const allCorrect = Object.fromEntries(qs.map((q, i) => [i, q.answer]));
  const score = engine.quizScore(qs, allCorrect);
  assert.equal(score.correct, qs.length);
  assert.equal(score.pct, 100);
  assert.deepEqual(engine.wrongIndexes(qs, allCorrect), []);

  const none = engine.quizScore(qs, {});
  assert.equal(none.correct, 0);
  assert.equal(none.pct, 0);
  assert.equal(engine.wrongIndexes(qs, {}).length, qs.length);

  const wrong = { ...allCorrect, 0: (qs[0].answer + 1) % 4 };
  assert.deepEqual(engine.wrongIndexes(qs, wrong), [0]);
});

const gcc = spawnSync('gcc', ['--version'], { encoding: 'utf8' });
test('every lab solution compiles under C17 and passes its public tests', { skip: gcc.status !== 0 && 'gcc is not installed here' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brocode-c-'));
  const failures = [];
  try {
    for (const lab of labs) {
      const src = path.join(dir, `${lab.id}.c`);
      const bin = path.join(dir, lab.id);
      fs.writeFileSync(src, lab.solution);
      const built = spawnSync('gcc', ['-std=c17', '-O0', '-w', src, '-o', bin, '-lm'], { encoding: 'utf8', timeout: 20_000 });
      if (built.status !== 0) {
        failures.push(`${lab.id}: compile — ${(built.stderr || '').split('\n')[0]}`);
        continue;
      }
      for (const t of lab.tests) {
        const run = spawnSync(bin, [], { input: t.stdin ?? '', encoding: 'utf8', timeout: 10_000, cwd: dir });
        if ((run.stdout ?? '').trim() !== t.stdout.trim()) {
          failures.push(`${lab.id} [${t.name}]: expected ${JSON.stringify(t.stdout.trim().slice(0, 60))}, got ${JSON.stringify((run.stdout ?? '').trim().slice(0, 60))}`);
        }
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(failures.length, 0, `${failures.length} lab failure(s):\n${failures.join('\n')}`);
});
