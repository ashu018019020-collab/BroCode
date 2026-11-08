/**
 * Onboarding's ONE rule — "where does this learner start?" — pinned against the real registries.
 *
 * The page used to finish on a hardcoded lesson (`Variables & Data Types → Learn`) no matter what
 * the learner answered, so a "GenAI Engineering / Advanced" answer opened the same first Python
 * lesson as everyone else. The mapping now lives in `core/learning/onboarding.ts` and is checked
 * here against `public/generated/courses/index.json` (the published course partition) and the real
 * `STEPS`: a step the owning course does not list is a URL that renders "not found", which is the
 * exact failure a mapping table is supposed to prevent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The engine value-imports `roadmap`, so the project's resolver has to be registered (labs/coverage do the same).
register('./_ts-resolve.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// Pure: value-imports `roadmap` only, which makes it loadable here.
const ob = await load('src/core/learning/onboarding.ts');
const rm = await load('src/core/learning/roadmap.ts');
const courses = JSON.parse(read('public/generated/courses/index.json')).courses;

const bySlug = new Map(courses.map((c) => [c.slug, c]));
const stepOf = (no) => rm.STEPS.find((s) => s.no === no);

test('onboarding: every goal the page offers has exactly one path', () => {
  assert.equal(ob.GOALS.length, 5);
  assert.deepEqual(ob.GOAL_PATHS.map((p) => p.goal).sort(), [...ob.GOALS].sort());
  assert.equal(new Set(ob.GOAL_PATHS.map((p) => p.goal)).size, ob.GOAL_PATHS.length, 'no goal is listed twice');
});

test('onboarding: every path points at a course that really owns that step', () => {
  for (const p of ob.GOAL_PATHS) {
    const course = bySlug.get(p.slug);
    assert.ok(course, `${p.goal} maps to ${p.slug}, which is not a published course`);
    assert.ok(course.steps.includes(p.step), `${p.slug} does not list step ${p.step} (it has ${course.steps.join(', ')})`);
    assert.ok(stepOf(p.step), `step ${p.step} is not on the roadmap`);
  }
});

test('onboarding: a beginner starts at step 1, whatever the goal', () => {
  for (const goal of ob.GOALS) {
    const plan = ob.startPlan(goal, 'Beginner');
    assert.equal(plan.no, 1, `${goal} must not drop a beginner mid-course`);
    assert.equal(plan.slug, 'ai-career-foundations');
    assert.equal(plan.title, stepOf(1).title, 'the title is the roadmap step, not a second copy');
    assert.equal(plan.route, '/course/ai-career-foundations/1');
    assert.match(plan.why, /step 1/, 'the reason has to name the step it recommends');
  }
});

test('onboarding: intermediate starts at the goal course, advanced one step later', () => {
  for (const p of ob.GOAL_PATHS) {
    const mid = ob.startPlan(p.goal, 'Intermediate');
    assert.equal(mid.no, p.step);
    assert.equal(mid.slug, p.slug);
    assert.equal(mid.route, `/course/${p.slug}/${p.step}`);
    assert.equal(mid.title, stepOf(p.step).title);

    const adv = ob.startPlan(p.goal, 'Advanced');
    assert.equal(adv.no, p.step + 1, 'advanced skips the introduction');
    assert.equal(adv.slug, p.slug);
    // The advanced step must STILL belong to the same course, or `/course/<slug>/<n>` 404s.
    assert.ok(bySlug.get(p.slug).steps.includes(adv.no), `${p.slug} does not own step ${adv.no}`);
    assert.equal(adv.title, stepOf(adv.no).title);
  }
});

test('onboarding: an unknown or blank answer falls back instead of throwing', () => {
  for (const [goal, level] of [['', ''], ['Astrology', 'Guru'], ['AI & Machine Learning', '']]) {
    const plan = ob.startPlan(goal, level);
    assert.ok(plan.no >= 1 && plan.no <= 36);
    assert.match(plan.route, /^\/course\/[a-z-]+\/\d+$/);
    const [slug, no] = plan.route.split('/').slice(2);
    assert.ok(bySlug.get(slug).steps.includes(Number(no)), `${plan.route} is not a real course step`);
  }
  // An unknown GOAL keeps its own label in the reason only through the path's goal.
  assert.equal(ob.startPlan('Astrology', 'Intermediate').no, ob.GOAL_PATHS[0].step);
});

test('onboarding: the profile a skip writes is complete and in range', () => {
  assert.ok(ob.GOALS.includes(ob.PROFILE_DEFAULTS.goal));
  assert.ok(ob.LEVELS.includes(ob.PROFILE_DEFAULTS.level));
  assert.ok(ob.DAILY_MINUTES.includes(ob.PROFILE_DEFAULTS.dailyMinutes));
  assert.deepEqual([...ob.DAILY_MINUTES], [30, 60, 90, 120], 'Progress divides by this number');
});

test('onboarding: the page renders the rule, offers a skip, and hardcodes no lesson', () => {
  const page = read('src/features/dashboard/Onboarding.tsx');
  assert.match(page, /startPlan\(goal, level\)/, 'the page must ask the engine, not pick a step itself');
  assert.match(page, /nav\(plan\.route\)/, 'finishing must open the recommended step');
  assert.match(page, /Skip for now/, 'onboarding must be skippable');
  assert.match(page, /Settings → Profile edits every answer later/, 'editing has to be discoverable');
  assert.match(page, /useState\(state\.profile\.name \|\| user\?\.name \|\| ''\)/, 'the name still starts blank');
  assert.match(page, /validName/, 'the name check must survive');
  assert.match(page, /aria-invalid/, 'the invalid name field must announce itself');
  assert.doesNotMatch(page, /Variables & Data Types/, 'the hardcoded first lesson is gone');
  assert.doesNotMatch(page, /\/lesson\/s01\/learn/, 'finishing no longer jumps to a fixed lesson');
});
