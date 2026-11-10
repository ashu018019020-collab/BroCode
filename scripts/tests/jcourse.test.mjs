/**
 * Java course content contract.
 *
 * The published artifacts are what the app actually loads, so these assertions read the same files
 * the UI fetches. A missing test, a duplicate id, or a level count below the syllabus fails here
 * rather than shipping a card that opens an empty page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
register('./_ts-resolve.mjs', import.meta.url);
const engine = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/jcourse.ts')).href);

const course = readJSON('content/java-programming/course.json');
const modules = course.modules.map((id) => readJSON(`content/java-programming/modules/${id}.json`));
const index = readJSON('public/generated/java-course/index.json');
const artifact = readJSON('public/generated/java-course/course.json');
const coding = readJSON('public/generated/java-course/coding.json').questions;
const debugging = readJSON('public/generated/java-course/debugging.json').challenges;
const labs = readJSON('public/generated/java-course/labs.json').labs;
const projects = readJSON('public/generated/java-course/projects.json').projects;
const interview = readJSON('public/generated/java-course/interview.json').questions;
const assessments = readJSON('public/generated/java-course/assessments.json').sets;
const final = readJSON('public/generated/java-course/final.json').final;

const BLOCKS = ['prereqs', 'definition', 'explain', 'hinglish', 'analogy', 'why', 'syntax', 'topics',
  'examples', 'mistakes', 'debug', 'best', 'tip', 'revision', 'practice', 'mcqs', 'interview', 'lab', 'checkpoint'];

test('java course: twenty modules, each with every lesson block', () => {
  assert.equal(modules.length, 20);
  for (const m of modules) {
    for (const key of BLOCKS) assert.ok(m[key], `${m.id} is missing ${key}`);
    assert.ok(m.topics.length >= 6, `${m.id} needs six topics`);
    assert.ok(m.examples.length >= 2, `${m.id} needs two examples`);
    assert.ok(m.mcqs.length >= 3, `${m.id} needs three MCQs`);
    assert.ok(m.practice.length >= 3, `${m.id} needs three practice prompts`);
    assert.ok(m.lab.tests.length >= 1, `${m.id} lab needs a test`);
    assert.ok(m.debug.code !== m.debug.fix, `${m.id} debug fix repeats the broken code`);
  }
});

test('java course: the published index counts the authored files', () => {
  assert.equal(index.modules.length, modules.length);
  assert.equal(index.stats.coding, coding.length);
  assert.equal(index.stats.debugging, debugging.length);
  assert.equal(index.stats.projects, projects.length);
  assert.equal(artifact.modules.length, modules.length);
  assert.equal(index.stats.hours, modules.reduce((n, m) => n + m.hours, 0));
  assert.deepEqual(index.modules.map((m) => m.id), course.modules);
});

test('java course: the coding bank meets the syllabus levels', () => {
  const byLevel = { beginner: 0, intermediate: 0, advanced: 0 };
  const ids = new Set();
  for (const q of coding) {
    assert.ok(!ids.has(q.id), `duplicate coding id ${q.id}`);
    ids.add(q.id);
    byLevel[q.level] += 1;
    assert.ok(q.tests.length >= 2, `${q.id} needs two tests`);
    assert.ok(q.tests.some((t) => t.hidden), `${q.id} needs a hidden test`);
    assert.ok(q.solution.includes('class Main'), `${q.id} solution must be a single Main file`);
  }
  assert.ok(byLevel.beginner >= 30 && byLevel.intermediate >= 40 && byLevel.advanced >= 30);
  assert.ok(coding.length >= 100);
});

test('java course: debugging, labs, projects and interviews are complete', () => {
  assert.ok(debugging.length >= 50);
  for (const c of debugging) {
    assert.ok(c.fix && c.fix !== c.code, `${c.id} must carry a real fix`);
    assert.ok(c.tests.length >= 1);
  }
  assert.ok(labs.length >= 40);
  for (const lab of labs) assert.ok(lab.solution && lab.tests.length >= 1, lab.id);
  assert.ok(projects.length >= 15);
  for (const p of projects) assert.ok(p.steps.length >= 3 && p.starter.trim(), p.id);
  const levels = { beginner: 0, intermediate: 0, advanced: 0 };
  for (const q of interview) {
    levels[q.level] += 1;
    assert.ok(q.a && q.tip, q.id);
  }
  assert.ok(levels.beginner >= 25 && levels.intermediate >= 30 && levels.advanced >= 25);
});

test('java course: one assessment per module and a final exam above the pass mark', () => {
  assert.equal(assessments.length, modules.length);
  assert.deepEqual(new Set(assessments.map((s) => s.module)), new Set(course.modules));
  for (const set of assessments) {
    for (const q of set.questions) {
      assert.equal(q.options.length, 4);
      assert.equal(new Set(q.options).size, 4);
      assert.ok(q.answer >= 0 && q.answer < 4);
    }
  }
  assert.ok(final.questions.length >= 20);
  assert.ok(final.passPct > 0 && final.passPct <= 100);
});

test('java rules: quiz tally counts one module family and caps at the set size', () => {
  const attempts = {
    'jquiz:j01:0': { done: true }, 'jquiz:j01:1': { done: false },
    'jquiz:j02:0': { done: true }, 'cquiz:j01:0': { done: true },
  };
  const tally = engine.jQuizTally(attempts, 'j01', 3);
  assert.equal(tally.answered, 2);
  assert.equal(tally.correct, 1);
  assert.equal(tally.pct, 67);
  const capped = engine.jQuizTally(attempts, 'j01', 1);
  assert.equal(capped.answered, 1);
});

test('java rules: progress and certificate never claim an unearned pass', () => {
  const cards = modules.map((m) => ({ id: m.id, no: m.no, title: m.title, level: m.level, hours: m.hours, goal: m.goal, brief: '', counts: { topics: 0, examples: 0, practice: 0, mcqs: 0, interview: 0 } }));
  const completed = new Set([cards[0].id]);
  const progress = engine.progressOf(cards, completed);
  assert.equal(progress.completed, 1);
  assert.equal(progress.pct, 5);
  const partial = engine.certificateOf({ modules: cards, completed, finalPct: 90, passPct: 70 });
  assert.equal(partial.earned, false);
  assert.equal(partial.missingModules.length, 19);
  const all = new Set(cards.map((c) => c.id));
  assert.equal(engine.certificateOf({ modules: cards, completed: all, finalPct: 69, passPct: 70 }).earned, false);
  assert.equal(engine.certificateOf({ modules: cards, completed: all, finalPct: 70, passPct: 70 }).earned, true);
});

test('java rules: coding and debug tallies read their own key families', () => {
  const attempts = {
    'jcoding:jb01': { done: true, score: 100 }, 'jcoding:jb02': { score: 50 },
    'jdebug:jd01': { done: true, score: 100 }, 'ccoding:jb01': { done: true },
  };
  const codingTally = engine.codingTally(attempts, [{ id: 'jb01' }, { id: 'jb02' }, { id: 'jb03' }]);
  assert.deepEqual({ attempted: codingTally.attempted, solved: codingTally.solved }, { attempted: 2, solved: 1 });
  const debugTally = engine.debugTally(attempts, [{ id: 'jd01' }, { id: 'jd02' }]);
  assert.deepEqual({ attempted: debugTally.attempted, fixed: debugTally.fixed }, { attempted: 1, fixed: 1 });
  assert.equal(engine.submissionScore([{ pass: true }, { pass: false }]), 50);
});
