/**
 * Guided navigation tests — the contract between the tutor and the real controls.
 *
 * What can silently go wrong here, and what these tests watch for:
 *
 *   1. The tutor invents a button. Every step must name a stable action id and describe WHAT to do;
 *      the real label is read from the live element, so a hardcoded "Start Learning" is a bug.
 *   2. The tutor claims success for the wrong reason. Completion is the ROUTE reaching the step's
 *      target — never a click, never an assumption.
 *   3. The attribute is wired in one place and forgotten in another. `AGENT_ACTION_WIRING` is checked
 *      against the actual source files, so removing `data-agent-action` from a control fails here.
 *   4. The guide does the learner's work for them. It may highlight, never click.
 *
 * Zero dependencies: node:test plus the project's TS resolver hook.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const actions = await load('src/core/ai/actions.ts');

const COURSES = [
  { slug: 'python-core', name: 'Python Core', pct: 100 },
  { slug: 'numpy-pandas', name: 'NumPy & Pandas', pct: 42 },
  { slug: 'ml-nlp', name: 'ML & NLP', pct: null },
];

/* ---------------------------------- ids ---------------------------------- */

test('actions: ids are stable, readable and built by one owner', () => {
  assert.equal(actions.navActionId('/courses'), 'nav:/courses');
  assert.equal(actions.courseActionId('python-core'), 'course:python-core');
  assert.equal(actions.continueActionId('python-core'), 'course:continue:python-core');
  assert.equal(actions.stepActionId('python-core', 3), 'course:step:python-core:3');
  assert.equal(actions.actionSelector('course:python-core'), '[data-agent-action="course:python-core"]');
});

test('actions: a selector value cannot break out of the attribute string', () => {
  const selector = actions.actionSelector('course:"x"] body');
  // Every quote and bracket in the VALUE is escaped, so the selector cannot close early and match
  // some other element (`body`). CSS string grammar accepts both escapes.
  assert.equal(selector, '[data-agent-action="course:\\"x\\"\\] body"]');
  assert.ok(selector.startsWith('[data-agent-action="') && selector.endsWith('"]'));
  assert.doesNotMatch(selector.slice(20, -2), /(^|[^\\])"/, 'every quote in the value is escaped');
});

/* --------------------------------- planner -------------------------------- */

test('actions: off the course surface the next real control is Courses', () => {
  for (const route of ['/', '/practice', '/lesson/s04/learn', '/questions?section=s04']) {
    const plan = actions.guidePlan(route, COURSES, 'en-IN');
    assert.equal(plan.kind, 'step');
    assert.equal(plan.step.id, 'nav:/courses');
    assert.equal(plan.step.kind, 'nav');
    assert.deepEqual(plan.step.target, { path: '/courses', mode: 'exact' });
    assert.doesNotMatch(plan.step.instruction, /Start Learning|"Continue"/, 'the label is read from the DOM, never guessed');
  }
});

test('actions: on the course list the guide opens the first course that still has work', () => {
  const plan = actions.guidePlan('/courses', COURSES, 'en-IN');
  assert.equal(plan.kind, 'step');
  assert.equal(plan.step.id, 'course:numpy-pandas', 'a 100% course is not "next"');
  assert.match(plan.step.instruction, /NumPy & Pandas/);
  assert.match(plan.step.reason, /42% complete/);
  assert.deepEqual(plan.step.target, { path: '/course/numpy-pandas', mode: 'prefix' });
});

test('actions: with every course finished the list still offers a review target', () => {
  const finished = COURSES.map((course) => ({ ...course, pct: 100 }));
  const plan = actions.guidePlan('/courses', finished, 'en-IN');
  assert.equal(plan.kind, 'step');
  assert.equal(plan.step.id, 'course:python-core');
});

test('actions: an unmeasured course is offered honestly, with no invented percentage', () => {
  const plan = actions.guidePlan('/courses', [{ slug: 'data', name: 'Data Engineering', pct: null }], 'en-IN');
  assert.equal(plan.kind, 'step');
  assert.match(plan.step.reason, /no measured percentage/);
  assert.doesNotMatch(plan.step.reason, /%/);
});

test('actions: the list is loading, not empty advice', () => {
  assert.deepEqual(actions.guidePlan('/courses', [], 'en-IN'), { kind: 'loading' });
});

test('actions: on a course page the next control is that course’s own continue button', () => {
  const plan = actions.guidePlan('/course/python-core', COURSES, 'en-IN');
  assert.equal(plan.kind, 'step');
  assert.equal(plan.step.id, 'course:continue:python-core');
  assert.equal(plan.step.kind, 'continue');
  assert.match(plan.step.reason, /Python Core/);
  assert.deepEqual(plan.step.target, { path: '/course/python-core/', mode: 'prefix' });
});

test('actions: deeper than the course page the guide ends instead of pointing at nothing', () => {
  const plan = actions.guidePlan('/course/python-core/3', COURSES, 'en-IN');
  assert.equal(plan.kind, 'done');
  assert.match(plan.message, /inside the course/);
  assert.doesNotMatch(plan.message, /completed|finished the lesson/i, 'reaching a page is not completing it');
});

test('actions: the Hinglish guide keeps the real course name and adds no numbers', () => {
  const plan = actions.guidePlan('/courses', COURSES, 'hi-IN');
  assert.equal(plan.kind, 'step');
  assert.match(plan.step.instruction, /NumPy & Pandas course kholo/);
  assert.match(plan.step.reason, /42% complete/);
  assert.doesNotMatch(plan.step.reason.replace('42%', ''), /\d+%/);
});

test('actions: a signed-out visitor is guided to the real sign-in control, not into a wall', () => {
  const plan = actions.guidePlan('/', [], 'en-IN', false);
  assert.equal(plan.kind, 'step');
  assert.equal(plan.step.id, actions.AUTH_SIGN_IN_ACTION);
  assert.equal(plan.step.target.path, '/login');
  assert.match(plan.step.reason, /account/);

  const onForm = actions.guidePlan('/login', [], 'en-IN', false);
  assert.equal(onForm.kind, 'stopped');
  assert.match(onForm.message, /Guide me/);
});

test('actions: once signed in the course path is the plan again', () => {
  const plan = actions.guidePlan('/courses', COURSES, 'en-IN', true);
  assert.equal(plan.kind, 'step');
  assert.equal(plan.step.id, 'course:numpy-pandas');
});

test('actions: an unknown course slug waits for the index instead of guessing a control', () => {
  assert.deepEqual(actions.guidePlan('/course/does-not-exist', COURSES, 'en-IN'), { kind: 'loading' });
});

/* ------------------------------- verification ------------------------------ */

const STEP = {
  id: 'course:python-core',
  kind: 'course',
  instruction: 'Open the Python Core course.',
  reason: '42% complete.',
  target: { path: '/course/python-core', mode: 'prefix' },
};

test('actions: completion is the route reaching the target, not a click', () => {
  assert.equal(actions.verifyGuide(STEP, { route: '/course/python-core', present: true }), 'done');
  assert.equal(actions.verifyGuide(STEP, { route: '/course/python-core/3?tab=lesson', present: true }), 'done');
  assert.equal(actions.verifyGuide(STEP, { route: '/courses', present: true }), 'waiting');
});

test('actions: exact steps do not accept a longer path', () => {
  const exact = { ...STEP, target: { path: '/courses', mode: 'exact' } };
  assert.equal(actions.verifyGuide(exact, { route: '/courses', present: true }), 'done');
  assert.equal(actions.verifyGuide(exact, { route: '/courses/python-core', present: true }), 'waiting');
});

test('actions: a disabled control is explained, a missing one is not silently ignored', () => {
  assert.equal(actions.verifyGuide(STEP, { route: '/courses', present: true, disabled: true }), 'blocked');
  assert.equal(actions.verifyGuide(STEP, { route: '/courses', present: false }), 'missing');
  assert.equal(actions.verifyGuide(STEP, { route: '/courses', present: false, disabled: true }), 'blocked',
    'disabled wins: the control exists but cannot be used');
});

test('actions: the status chip has one vocabulary, in both languages', () => {
  for (const status of ['waiting', 'done', 'missing', 'blocked']) {
    assert.equal(typeof actions.guideStatusLabel(status, 'en-IN'), 'string');
    assert.equal(typeof actions.guideStatusLabel(status, 'hi-IN'), 'string');
  }
  assert.notEqual(actions.guideStatusLabel('waiting', 'en-IN'), actions.guideStatusLabel('done', 'en-IN'));
});

/* -------------------------------- recovery -------------------------------- */

test('actions: recovery names the real surface and an actual way out', () => {
  const nav = actions.guideRecovery({ ...STEP, kind: 'nav' }, 'en-IN');
  const course = actions.guideRecovery({ ...STEP, kind: 'course' }, 'en-IN');
  const cont = actions.guideRecovery({ ...STEP, kind: 'continue' }, 'en-IN');
  for (const line of [nav, course, cont]) {
    assert.match(line, /Close guide/, 'the overlay has a Close control; the copy must name it');
    assert.doesNotMatch(line, /Skip/, 'there is no Skip control in the UI');
  }
  assert.match(nav, /sidebar/);
  assert.notEqual(nav, course);
  assert.match(actions.guideRecovery({ ...STEP, kind: 'continue' }, 'hi-IN'), /Close guide/);
});

/* --------------------------------- wiring --------------------------------- */

test('actions: every registered action family is actually wired in the app', () => {
  for (const { owner, marker } of actions.AGENT_ACTION_WIRING) {
    assert.ok(read(owner).includes(marker), `${owner} no longer wires ${marker}`);
  }
});

test('actions: the guide highlights, it never clicks for the learner', () => {
  const layer = read('src/components/shared/GuideLayer.tsx');
  assert.doesNotMatch(layer, /\.click\(/, 'a guide that clicks is not teacher-guided');
  assert.match(layer, /createPortal/, 'the ring must escape the dock’s backdrop-filter containing block');
  assert.match(layer, /role="dialog"/);
  assert.match(layer, /aria-label="Cancel the guide"/, 'the learner can always cancel');
  assert.match(layer, /verifyGuide\(/, 'the overlay reports; it does not decide completion itself');
});

test('actions: the guide is mounted once, at the shell, and survives the card that starts it', () => {
  const app = read('src/app/App.tsx');
  const card = read('src/components/shared/AssistantCard.tsx');
  assert.match(app, /<GuideLayer \/>/);
  assert.match(card, /startGuide\(\{ goal: 'start-course', lang: voice\.lang/, 'the assistant lends the guide its language');
  assert.match(card, /say: \(text\) => voice\.speak\(text\)/, 'and its voice');
  assert.match(read('src/components/shared/guideStore.ts'), /useSyncExternalStore/, 'the request outlives one assistant instance');
});

test('actions: a guide never starts by itself', () => {
  const layer = read('src/components/shared/GuideLayer.tsx');
  const app = read('src/app/App.tsx');
  assert.doesNotMatch(layer, /startGuide\(/, 'only an explicit action may start a guide');
  assert.doesNotMatch(app, /startGuide\(/);
  assert.equal((read('src/components/shared/AssistantCard.tsx').match(/startGuide\(/g) ?? []).length, 1);
});
