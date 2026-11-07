/**
 * The learner workspace (/workspace).
 *
 * The rule this file holds: the page may only answer with records the app already has. So the
 * tests drive the pure `workspaceTarget` with fixtures (which course wins, which step is named,
 * when the page must refuse to name one), then pin the contract around it:
 *
 *   · the route is registered in every place a route must be, behind `Protect`;
 *   · the page reads CARD-ONLY measures — it must never call the course-file loader (`useCourse`),
 *     because one course file is up to 1.5 MB;
 *   · every `workspace.*` string exists in BOTH packs, and the sentence-level Hinglish copy is
 *     actually Hinglish rather than an English copy (the defect this suite now guards against).
 *
 * Zero dependencies — node:test, `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./_ts-resolve.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const { workspaceNextAction, workspaceTarget } = await load('src/core/learning/workspace.ts');
const { PAGES } = await load('src/core/platform/search.ts');
const { PATH_ROUTE_ALLOWLIST } = await load('src/core/learning/paths.ts');
const { en, hinglish } = await load('src/app/i18n/locales.ts');

/** A published card, with the fields the resolver actually reads. */
const card = (slug, number, sections, steps) => ({
  slug, number, name: slug, tone: 'cyan', logo: 'brain', steps, sections, counts: {},
  meta: { level: 'beginner', prerequisites: [], objectives: ['a', 'b'], minutes: 120, assessment: 'x' },
});

const python = card('python', 3, { s01: 4, s02: 4 }, [4]);
const sql = card('sql', 5, { s19: 8 }, [8]);
const dataEngineering = card('data-engineering', 6, {}, [9, 10]);
/** Three measured steps, all opening step 1 — the fixture the "after this step" rule is driven with. */
const ladder = card('ladder', 3, { s01: 1, s02: 2, s03: 3 }, [1, 2, 3]);

test('workspace: a fresh learner is sent to the first course, labelled as a start', () => {
  const target = workspaceTarget([python, sql], () => 0);
  assert.equal(target.card.slug, 'python', 'with nothing started, the first course in the plan wins');
  assert.equal(target.started, false, 'it is not "their" course yet');
  assert.equal(target.pct, 0, 'section-backed mastery is a real 0, not null');
  assert.equal(target.step, 4);
  // A 0% on a real denominator is still evidence: step 4 is the first step the card can prove is
  // unfinished, which is exactly what a learner who has not started needs to see.
  assert.equal(target.certain, true, 'a real 0% denominator can name the first step');
});

test('workspace: a started course names its next incomplete step from the card alone', () => {
  const target = workspaceTarget([python, sql], (sid) => (sid === 's01' ? 40 : sid === 's02' ? 60 : 0));
  assert.equal(target.card.slug, 'python');
  assert.equal(target.started, true);
  assert.equal(target.pct, 50, 'the course average is the same section average every other surface prints');
  assert.equal(target.step, 4);
  assert.equal(target.certain, true);
  assert.equal(target.stepsTotal, 1);
  assert.equal(target.stepsClear, 0);
  assert.deepEqual([target.sectionsCleared, target.sectionsTotal], [0, 2]);
});

test('workspace: a finished course is not renamed as the next thing to do', () => {
  const target = workspaceTarget([python, sql], () => 100);
  assert.equal(target.pct, 100);
  assert.equal(target.stepsClear, 1);
  assert.equal(target.certain, false, 'nothing is incomplete — the page must not invent a step');
  assert.equal(target.step, 4, 'the fallback is the course\u2019s own first step');
});

test('workspace: a section-less course reports facts, never a percentage', () => {
  const target = workspaceTarget([dataEngineering], () => 0);
  assert.equal(target.card.slug, 'data-engineering');
  assert.equal(target.pct, null, 'no sections means no honest course percentage');
  assert.equal(target.sectionsTotal, 0);
  assert.equal(target.certain, false, 'the card holds no denominator for either step');
  assert.equal(target.step, 9, 'it still points at the first real step');
  assert.equal(target.stepsTotal, 2);
});

test('workspace: nothing published is an empty target, not a crash', () => {
  const target = workspaceTarget([], () => 0);
  assert.equal(target.card, null);
  assert.equal(target.certain, false);
  assert.equal(target.pct, null);
  assert.equal(target.stepsTotal, 0);
});

test('workspace: the page is registered everywhere a route must be, behind Protect', () => {
  const app = read('src/app/App.tsx');
  assert.ok(app.includes("const Workspace = lazy(() => import('../features/workspace/Workspace'));"),
    'the page must be code-split like every other route');
  assert.match(app, /path="\/workspace" element=\{<Protect><Workspace \/><\/Protect>\}/,
    'the workspace needs an account like every other learning surface');

  const nav = app.slice(app.indexOf('export const NAV: NavItem[] = ['), app.indexOf('/** Mobile bottom navigation'));
  assert.match(nav, /\{ to: '\/workspace', icon: \w+, label: 'Workspace', group: 'hidden', sidebar: false \}/,
    'registered for label/icon, deliberately not an eighth rail row');

  assert.ok(PAGES.some((page) => page.route === '/workspace'), 'Ctrl+K must find the workspace');
  assert.ok(PATH_ROUTE_ALLOWLIST.includes('/workspace'),
    'the route-reader must know the workspace is not a path card');
});

test('workspace: the page reads card-only measures and never fetches a course file', () => {
  const page = read('src/features/workspace/Workspace.tsx');
  assert.match(page, /workspaceTarget\(cards, pctOf\)/, 'the decision lives in the pure resolver');
  assert.doesNotMatch(page, /useCourse\(|useCourseMeasures\(/,
    'a course file is up to 1.5 MB — the workspace must answer from index.json + stored mastery');
});

test('workspace next action: names the next step AFTER the one on screen, never the same one', () => {
  const cards = [ladder];
  const target = workspaceTarget(cards, () => 0);
  assert.equal(target.step, 1);
  const next = workspaceNextAction(cards, () => 0, target);
  assert.equal(next.kind, 'step');
  assert.equal(next.step, 2, 'the block must not repeat the step the page already names');
  assert.equal(next.course.slug, 'ladder');
  assert.equal(next.certain, true, 'a step with a real denominator is a proven action');
});

test('workspace next action: a step the card can prove is clear is skipped', () => {
  const pct = (sid) => (sid === 's02' ? 100 : 0);
  const target = workspaceTarget([ladder], pct);
  assert.equal(target.step, 1);
  const next = workspaceNextAction([ladder], pct, target);
  assert.equal(next.kind, 'step');
  assert.equal(next.step, 3, 'step 2 is already clear, so it is not something to do again');
});

test('workspace next action: after the last step the journey names the next course', () => {
  const target = workspaceTarget([python, sql], () => 0);
  assert.equal(target.card.slug, 'python');
  const next = workspaceNextAction([python, sql], () => 0, target);
  assert.equal(next.kind, 'course');
  assert.equal(next.course.slug, 'sql', 'a course placed AFTER this one, never one earlier in the plan');
});

test('workspace next action: nothing left is an honest end, not an invented step', () => {
  const target = workspaceTarget([python], () => 0);
  const next = workspaceNextAction([python], () => 0, target);
  assert.equal(next.kind, 'done');
  assert.equal(next.course, null);
});

test('workspace next action: a step the card cannot measure is named, but not claimed', () => {
  const target = workspaceTarget([dataEngineering], () => 0);
  assert.equal(target.step, 9);
  const next = workspaceNextAction([dataEngineering], () => 0, target);
  assert.equal(next.kind, 'step');
  assert.equal(next.step, 10);
  assert.equal(next.certain, false, 'no denominator on the card means the page may not assert it');
});

test('workspace: the after-step block is one row fed by the pure resolver', () => {
  const page = read('src/features/workspace/Workspace.tsx');
  assert.match(page, /workspaceNextAction\(cards, pctOf, target\)/,
    'the second decision is pure too, so it can be driven with fixtures');
  assert.match(page, /className="card ws-after"/, 'a quiet row below the two cards, not a third card');
});

test('workspace: every string the page uses exists in both packs, and reads as Hinglish', () => {
  const page = read('src/features/workspace/Workspace.tsx');
  const keys = new Set([...page.matchAll(/'(workspace\.[a-zA-Z.]+)'/g)].map((m) => m[1]));
  assert.ok(keys.size >= 10, `expected the page's key set, saw ${keys.size}`);

  for (const key of keys) {
    assert.ok(en[key], `English pack is missing "${key}"`);
    assert.ok(hinglish[key], `Hinglish pack is missing "${key}"`);
  }
  // A sentence copied from English is not a translation — the earlier labels shipped exactly that.
  for (const key of ['workspace.title', 'workspace.subtitle', 'workspace.nextHint', 'workspace.noMeasure']) {
    assert.notEqual(hinglish[key], en[key], `Hinglish "${key}" is still the English sentence`);
  }
});
