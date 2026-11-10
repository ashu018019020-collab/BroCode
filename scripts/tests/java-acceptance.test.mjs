/**
 * Java course ACCEPTANCE gate — the course's own minimums, read from the published artifacts.
 *
 * The generator already refuses to publish malformed blocks; this test holds the COURSE-LEVEL contract
 * the product promises (20 modules, 100 coding questions, 80 interview answers, 50 debug labs, 20 labs,
 * 15 projects) plus the lesson shape and the two protected routes. It deliberately reads
 * `public/generated/java-course/*.json` — the same files a learner's browser fetches — so a stale or
 * hand-edited artifact fails here instead of shipping.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/generated/java-course', name), 'utf8'));
const app = fs.readFileSync(path.join(ROOT, 'src/app/App.tsx'), 'utf8');

const course = read('course.json');
const index = read('index.json');
const coding = read('coding.json').questions;
const debugging = read('debugging.json').challenges;
const interview = read('interview.json').questions;
const labs = read('labs.json').labs;
const projects = read('projects.json').projects;
const sets = read('assessments.json').sets;

test('java acceptance: twenty modules, numbered and unique', () => {
  assert.equal(course.modules.length, 20);
  const ids = course.modules.map((m) => m.id);
  assert.equal(new Set(ids).size, 20, 'module ids must be unique');
  assert.deepEqual(ids, Array.from({ length: 20 }, (_, i) => `j${String(i + 1).padStart(2, '0')}`));
  assert.deepEqual(course.modules.map((m) => m.no), Array.from({ length: 20 }, (_, i) => i + 1));
});

test('java acceptance: the published course meets every minimum', () => {
  assert.ok(course.stats.modules >= 20, `modules ${course.stats.modules}`);
  assert.ok(course.stats.topics >= 80, `topics ${course.stats.topics}`);
  assert.ok(coding.length >= 100, `coding ${coding.length}`);
  assert.ok(interview.length >= 80, `interview bank ${interview.length}`);
  assert.ok(debugging.length >= 50, `debug ${debugging.length}`);
  assert.ok(labs.length >= 20, `labs ${labs.length}`);
  assert.ok(projects.length >= 15, `projects ${projects.length}`);
  assert.ok(course.final.questions.length >= 20, `final ${course.final.questions.length}`);
  assert.ok(course.final.passPct > 0 && course.final.passPct <= 100);
  assert.equal(sets.length, 20, 'one module assessment per module');
  // index.json is what the hub renders; it may not overstate the course.
  assert.equal(index.stats.modules, course.modules.length);
  assert.equal(index.stats.coding, coding.length);
  assert.equal(index.stats.debugging, debugging.length);
  assert.equal(index.stats.labs, labs.length);
  assert.equal(index.stats.projects, projects.length);
  // The hub counts the bank AND the module-level interview questions, so it may exceed the bank.
  assert.ok(index.stats.interview >= interview.length, `index interview ${index.stats.interview}`);
});

test('java acceptance: every module carries the full lesson shape', () => {
  for (const m of course.modules) {
    assert.ok(m.title && m.goal && m.definition, m.id);
    assert.ok(m.objectives.length >= 3, `${m.id} objectives`);
    assert.ok(m.prereqs.length >= 1, `${m.id} prereqs`);
    assert.ok(m.explain.length >= 2 && m.hinglish.length >= 2, `${m.id} explanations`);
    assert.ok(m.analogy && m.why, `${m.id} analogy/why`);
    assert.ok(m.syntax.length >= 1, `${m.id} syntax`);
    assert.ok(m.topics.length >= 5, `${m.id} topics`);
    assert.ok(m.examples.length >= 2, `${m.id} examples`);
    for (const ex of m.examples) {
      assert.ok(ex.code && ex.output !== undefined && ex.lines.length >= 1 && ex.dryRun.length >= 1, `${m.id} example shape`);
    }
    assert.ok(m.mistakes.length >= 2 && m.debug && m.best.length >= 2 && m.tip && m.revision.length >= 2, `${m.id} teaching extras`);
    assert.ok(m.practice.length >= 3, `${m.id} practice`);
    assert.ok(m.mcqs.length >= 3, `${m.id} mcqs`);
    for (const q of m.mcqs) {
      assert.equal(q.options.length, 4, `${m.id} mcq options`);
      assert.ok(q.answer >= 0 && q.answer < 4, `${m.id} mcq answer`);
      assert.ok(q.explain, `${m.id} mcq explanation`);
    }
    assert.ok(m.interview.length >= 2, `${m.id} interview`);
    assert.ok(m.lab.tests.length >= 1 && m.lab.starter && m.lab.solution, `${m.id} lab`);
    assert.ok(m.checkpoint.checks.length >= 3, `${m.id} checkpoint`);
  }
});

test('java acceptance: coding bank is runnable, tested and explained', () => {
  const hidden = coding.reduce((n, q) => n + q.tests.filter((t) => t.hidden).length, 0);
  assert.ok(hidden >= 50, `hidden tests ${hidden}`);
  for (const q of coding) {
    assert.ok(q.statement && q.input && q.output, q.id);
    assert.ok(q.constraints.length >= 1, `${q.id} constraints`);
    assert.ok(q.examples.length >= 1, `${q.id} example`);
    assert.ok(q.starter && q.solution, `${q.id} code`);
    assert.ok(q.tests.length >= 2, `${q.id} tests`);
    assert.ok(q.time && q.space, `${q.id} complexity`);
    assert.ok(q.hints.length >= 1 && q.mistakes.length >= 1, `${q.id} hints/mistakes`);
  }
});

test('java acceptance: debug, interview, labs and projects are complete', () => {
  for (const c of debugging) {
    assert.ok(c.brief && c.code && c.fix && c.explain, c.id);
    assert.ok(c.tests.length >= 1 && c.hints.length >= 1, `${c.id} tests/hints`);
  }
  for (const q of interview) {
    assert.ok(q.q && q.a && q.explain && q.example && q.tip && q.followUp, q.id);
  }
  for (const l of labs) {
    assert.ok(l.title && l.brief && l.objective && l.starter && l.solution, l.id);
    assert.ok(l.tests.length >= 1, `${l.id} tests`);
  }
  for (const p of projects) {
    assert.ok(p.title && p.summary && p.useCase && p.starter, p.id);
    assert.ok(p.requirements.length >= 3 && p.features.length >= 3, `${p.id} requirements/features`);
    assert.ok(p.steps.length >= 3, `${p.id} steps`);
    assert.ok(p.testing.length >= 1 && p.errors.length >= 1 && p.extensions.length >= 1, `${p.id} closing sections`);
    assert.ok(p.readme.length >= 1, `${p.id} readme`);
  }
});

test('java acceptance: the courses page renders the Java card with its logo', () => {
  const home = fs.readFileSync(path.join(ROOT, 'src/features/courses/CoursesHome.tsx'), 'utf8');
  assert.match(home, /to="\/java"/, 'the courses grid must link to the Java course');
  assert.match(home, /<JLogo size=\{88\} \/>/, 'the Java card must use the Java mark, not a letter tile');
  assert.match(home, /data-agent-action="course:java-programming"/, 'the Java card needs its action label');
  assert.match(
    home,
    /visible\.length \+ \(cHidden \? 0 : 1\) \+ 1/,
    'the header course count must include the Java card that is rendered below it',
  );
});

test('java acceptance: both routes exist and are protected', () => {
  assert.match(app, /path="\/java"/);
  assert.match(app, /path="\/java\/:moduleId"/);
  for (const route of ['/java', '/java/:moduleId']) {
    const line = app.split('\n').find((l) => l.includes(`path="${route}"`));
    assert.ok(line && line.includes('<Protect>'), `${route} must be inside <Protect>`);
  }
});
