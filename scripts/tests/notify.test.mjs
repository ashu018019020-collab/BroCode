/**
 * The notification centre — `src/core/platform/notify.ts`.
 *
 * Every entry on that list is a CLAIM about the learner's own record, so the two ways it can lie
 * are the two things these tests watch:
 *
 *   1. Inventing something that did not happen — a badge, a level, a mastery count or a review
 *      that was never earned. A brand-new account must see only the two real nudges it qualifies
 *      for, and each family must disappear again when the record behind it goes away.
 *   2. Crashing the shell. `buildNotifications` runs in the header on every render, including the
 *      renders before the curriculum has resolved; with no sections there is no frontier step,
 *      and asking for one used to dereference `undefined` inside `sectionProgress`.
 *
 * Plus the identity rule the read/unread badge depends on: the same state must produce the same
 * ids on every render, and no two entries may share one (a duplicate id would collapse the count).
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

const { buildNotifications, unreadCount } = await load('src/core/platform/notify.ts');
const { today } = await load('src/core/learning/study.ts');

const raw = JSON.parse(read('public/generated/curriculum/sections.json'));
const sections = Array.isArray(raw) ? raw : raw.sections;

/** The shape every surface really writes, with nothing earned yet. */
const learner = (over = {}) => ({
  version: 1,
  profile: { name: 'T', goal: 'g', level: 'Beginner', dailyMinutes: 60, onboarded: true },
  xp: 0,
  streak: { current: 0, last: '' },
  attempts: {},
  bookmarks: [],
  mistakes: [],
  review: {},
  interviewAnswers: {},
  defenseAnswers: {},
  savedCode: {},
  settings: { reduceMotion: false },
  activity: {},
  study: {},
  notes: [],
  jobPrep: {},
  readNotifs: [],
  ...over,
});

const ids = (list) => list.map((n) => n.id);

test('a brand-new account is told what is real: a pending mission and the next step, nothing else', () => {
  const list = buildNotifications(learner(), sections);
  assert.deepEqual(ids(list).filter((id) => id.startsWith('n:streak:')), [`n:streak:${today()}`]);
  assert.equal(list.filter((n) => n.id.startsWith('n:next:')).length, 1);
  // Nothing earned, so nothing announced: no achievement, no level, no review due, no weak topic.
  assert.equal(
    list.filter((n) => /^n:(achievement|level|review|weak|open-mistakes):/.test(n.id)).length,
    0,
    'an empty record earns no badge',
  );
});

test("today's activity retires the streak reminder", () => {
  const list = buildNotifications(learner({ activity: { [today()]: 5 } }), sections);
  assert.equal(list.filter((n) => n.id.startsWith('n:streak:')).length, 0);
});

test('a level is announced only after the XP behind it exists', () => {
  const level = buildNotifications(learner({ xp: 100000 }), sections).find((n) => n.id.startsWith('n:level:'));
  assert.ok(level, 'a real XP total earns a level notice');
  assert.match(level.body, /100000 XP/);
  assert.equal(level.to, '/progress');
});

test('a due review names the real section and opens the review queue', () => {
  const sec = sections[0];
  const last = new Date(Date.now() - 10 * 86400000).toISOString();
  const list = buildNotifications(learner({ review: { [sec.id]: { level: 0, last } } }), sections);
  const review = list.find((n) => n.id.startsWith('n:review:'));
  assert.ok(review, 'a section past its interval is due');
  assert.equal(review.title, '1 review due');
  assert.equal(review.to, '/review');
  assert.ok(review.body.includes(sec.title), 'the body quotes the stored section title');
});

test('a section still inside its interval is not "due"', () => {
  const sec = sections[1];
  const last = new Date().toISOString();
  const list = buildNotifications(learner({ review: { [sec.id]: { level: 3, last } } }), sections);
  assert.equal(list.filter((n) => n.id.startsWith('n:review:')).length, 0);
});

test('the weakest repeated topic wins the warning, and fixed mistakes silence it', () => {
  const mk = (topic, attempts, fixed = false) => ({
    id: `m-${topic}`, section: sections[0].id, topic, question: 'q', myAnswer: 'a', correct: 'c',
    type: 'logic', source: 'logic', date: '2026-01-01', attempts, fixed,
  });
  const list = buildNotifications(learner({ mistakes: [mk('loops', 2), mk('closures', 4)] }), sections);
  const warning = list.find((n) => n.kind === 'warning');
  assert.equal(warning.title, 'Weak topic: closures');
  assert.equal(warning.to, '/mistakes');

  const fixed = buildNotifications(learner({ mistakes: [mk('loops', 4, true)] }), sections);
  assert.equal(
    fixed.filter((n) => n.kind === 'warning' || n.id.startsWith('n:open-mistakes')).length,
    0,
    'a fixed mistake is not revision material',
  );
});

test('open mistakes below the repeat threshold are still reported, once', () => {
  const m = {
    id: 'm1', section: sections[0].id, topic: 'loops', question: 'q', myAnswer: 'a', correct: 'c',
    type: 'logic', source: 'logic', date: '2026-01-01', attempts: 1, fixed: false,
  };
  const list = buildNotifications(learner({ mistakes: [m] }), sections);
  assert.equal(list.filter((n) => n.id.startsWith('n:open-mistakes:')).length, 1);
  assert.equal(list.filter((n) => n.kind === 'warning').length, 0);
});

test('an unloaded curriculum is not a crash and not a frontier claim', () => {
  // The shell renders this list before the curriculum resolves; `currentSection([])` is undefined.
  const list = buildNotifications(learner(), []);
  assert.deepEqual(list.filter((n) => n.id.startsWith('n:next:')), []);
  assert.equal(list.filter((n) => n.id.startsWith('n:streak:')).length, 1, 'the streak nudge needs no curriculum');
});

test('ids are stable, unique and namespaced, so the read badge can survive a reload', () => {
  const a = buildNotifications(learner(), sections);
  const b = buildNotifications(learner(), sections);
  assert.deepEqual(ids(a), ids(b), 'the same record produces the same ids');
  assert.equal(new Set(ids(a)).size, ids(a).length, 'a duplicate id would collapse an unread');
  assert.ok(ids(a).every((id) => id.startsWith('n:')), 'every id is namespaced');
});

test('unread counts only what the learner has not read', () => {
  const list = buildNotifications(learner(), sections);
  assert.equal(unreadCount(list, []), list.length);
  assert.equal(unreadCount(list, [ids(list)[0]]), list.length - 1);
  assert.equal(unreadCount(list, ids(list)), 0);
  assert.equal(unreadCount(list, ['n:long-gone:1']), list.length, 'a stale read id hides nothing');
});

test('every notification opens a route inside this app', () => {
  const sec = sections[0];
  const list = buildNotifications(
    learner({ xp: 100000, review: { [sec.id]: { level: 0, last: new Date(Date.now() - 10 * 86400000).toISOString() } } }),
    sections,
  );
  assert.ok(list.length >= 3);
  for (const n of list) {
    assert.equal(typeof n.to, 'string', n.id);
    assert.ok(n.to.startsWith('/'), `${n.id} points at ${n.to}`);
    assert.ok(n.title.length > 0 && n.body.length > 0, `${n.id} carries real copy`);
  }
});
