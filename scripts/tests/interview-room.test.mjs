/**
 * The interview room — subject-wise interviews over the CANONICAL bank records.
 *
 * The failure this file exists to catch is silent data loss in a new costume: the interview
 * system could look complete while reading none of the 11,018 interview-eligible bank records
 * (the old Interview Mode read only the curriculum's own Q&A), or it could promise a kind of
 * round a subject cannot fill. Both render fine. So the mapping, the counts and the selection
 * ladder are driven with fixtures here AND against the real manifest and track registry.
 *
 * `interview-room.ts` imports the bank key family from `core/platform/keys.ts`, so the project's
 * resolver is registered exactly like labs.test.mjs. Zero dependencies — node:test, `npm test`.
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

const room = await load('src/core/assessment/interview-room.ts');

const manifest = JSON.parse(read('public/generated/questions/manifest.json'));
const entries = manifest.sections;
const hub = read('src/features/interview/InterviewsHub.tsx');
const mode = read('src/features/interview/InterviewMode.tsx');

/** The 8 track ranges, read from the real TRACK_DEFS (a renamed id must fail here, not on screen). */
const appSrc = read('src/app/App.tsx');
const defsBlock = appSrc.slice(appSrc.indexOf('export const TRACK_DEFS'), appSrc.indexOf('];', appSrc.indexOf('export const TRACK_DEFS')));
const TRACKS = [...defsBlock.matchAll(/id: '([^']+)'[^\n]*?from: (\d+), to: (\d+)/g)]
  .map((m) => ({ id: m[1], from: Number(m[2]), to: Number(m[3]) }));

/** The real QuestionType union, read from the schema (types are erased at runtime). */
const schemaSrc = read('src/core/data/schema.ts');
const union = schemaSrc.slice(schemaSrc.indexOf('export type QuestionType ='), schemaSrc.indexOf(';', schemaSrc.indexOf('export type QuestionType =')));
const QUESTION_TYPES = [...union.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);

const section = (over = {}) => ({
  sectionId: 's01', no: 1, title: 'Variables', published: 419,
  byType: { interview: 27, coding: 92, debug: 29, logic: 73, solved: 37, checkpoint: 56, theory: 52, defense: 53 },
  miniProject: 30, ...over,
});

/* ------------------------------ the kind mapping ------------------------------ */

test('interview: every canonical bank type is either an interview kind or a declared exclusion', () => {
  const covered = new Set(room.INTERVIEW_KINDS.flatMap((k) => k.types));
  for (const t of QUESTION_TYPES) {
    const isKind = covered.has(t);
    const isExcluded = room.ASSESSMENT_TYPES.includes(t);
    assert.ok(isKind || isExcluded, `bank type "${t}" belongs to neither an interview round nor the exclusion list`);
  }
  // …and the kinds are exactly the six the brief asks for, each mapped to real types.
  assert.deepEqual(room.INTERVIEW_KINDS.map((k) => k.id), ['concept', 'coding', 'debug', 'logic', 'project', 'challenge']);
  assert.equal(room.ASSESSMENT_TYPES.join(','), 'checkpoint', 'checkpoint is the assessment band, not a round');
});

test('interview: coding rounds exclude the mini-project builds that share the coding type', () => {
  const c = room.kindCounts(section({ byType: { coding: 92 }, miniProject: 30 }));
  assert.equal(c.coding, 62, 'mini-project items are builds, not coding-interview questions');
  assert.equal(c.concept, 0);
  // A section with no mini projects keeps its full coding count.
  assert.equal(room.kindCounts(section({ byType: { coding: 10 }, miniProject: 0 })).coding, 10);

  // …and the record-level filter agrees with the id-level counts.
  const q = (over) => ({ id: 's01:coding:0', sectionId: 's01', type: 'coding', status: 'PUBLISHED', tags: [], ...over });
  assert.equal(room.kindOf(q({ tags: ['mini-project'] })), null, 'a mini-project item is not interview material');
  assert.equal(room.kindOf(q({})), 'coding');
  assert.equal(room.kindOf(q({ type: 'checkpoint' })), null);
  assert.equal(room.kindOf(q({ type: 'theory' })), 'concept');
  assert.equal(room.kindOf(q({ type: 'interview' })), 'concept');
  assert.equal(room.kindOf(q({ type: 'defense' })), 'project');
  assert.equal(room.kindOf(q({ type: 'solved' })), 'challenge');
  assert.equal(room.isInterviewEligible(q({ status: 'DRAFT' })), false, 'drafts never enter an interview round');
});

/* ------------------------------ the real inventory ------------------------------ */

test('interview: no published section is an interview orphan', () => {
  assert.equal(entries.length, 29);
  assert.deepEqual(room.sectionsWithoutInterview(entries), [],
    'a section with no interview-eligible question is a hole the UI would simply not render');
  // The recovered pool is the sum of the kinds, and it is the real number.
  const total = entries.reduce((a, e) => a + room.INTERVIEW_KINDS.reduce((b, k) => b + room.kindCounts(e)[k.id], 0), 0);
  assert.ok(total > 10_000, `expected the recovered interview pool to be large, got ${total}`);
});

test('interview: every subject holds interview rounds, counted from the real manifest', () => {
  const ranges = TRACKS.map(({ id, from, to }) => ({ id, from, to }));
  for (const r of ranges) {
    const inv = room.subjectInterview(r, entries);
    assert.ok(inv.total > 0, `${r.id} offers no interview questions at all`);
    assert.ok(inv.kinds.length >= 2, `${r.id} offers only ${inv.kinds.length} round(s)`);
    // The subject's counts are the sum of its sections' — never a second, hand-kept tally.
    const mine = entries.filter((e) => e.no >= r.from && e.no <= r.to);
    for (const k of inv.kinds) {
      const parts = mine.reduce((a, e) => a + room.kindCounts(e)[k.id], 0);
      assert.equal(k.count, parts, `${r.id}/${k.id} count disagrees with its sections`);
    }
  }
});

/* ------------------------------- the selection ------------------------------- */

const pool = [
  { id: 's01:interview:0', sectionId: 's01' },   // unseen
  { id: 's01:interview:1', sectionId: 's01' },   // seen, failed
  { id: 's02:interview:0', sectionId: 's02' },   // unseen, weak section
  { id: 's02:interview:1', sectionId: 's02' },   // seen, passed long ago (review due)
  { id: 's02:interview:2', sectionId: 's02' },   // seen, passed recently
];
const DAY = 86_400_000;
const NOW = 1_700_000_000_000;
const attempts = {
  's01:interview:1': { done: false, ts: NOW - 1000 },
  's02:interview:1': { done: true, ts: NOW - 20 * DAY },
  's02:interview:2': { done: true, ts: NOW - 1 * DAY },
};
const never = () => 0.99;   // deterministic rng: no tie-flipping, first candidate of a tier wins

test('interview: the ladder is unseen-weak → unseen → failed-weak → failed → review → passed', () => {
  const weak = new Set(['s02']);
  assert.equal(room.pickQuestion(pool, attempts, { weak, rng: never, now: NOW }), 's02:interview:0');
  // Once the weak-unseen is avoided, the plain unseen is next.
  assert.equal(room.pickQuestion(pool, attempts, { weak, avoid: new Set(['s02:interview:0']), rng: never, now: NOW }), 's01:interview:0');
  // Then the failed answer (weak section first), then the plain failed one.
  const seen = new Set(['s02:interview:0', 's01:interview:0']);
  assert.equal(room.pickQuestion(pool, attempts, { weak, avoid: seen, rng: never, now: NOW }), 's01:interview:1');
  // Then the review-due pass, then the fresh pass.
  const seen2 = new Set([...seen, 's01:interview:1']);
  assert.equal(room.pickQuestion(pool, attempts, { weak, avoid: seen2, rng: never, now: NOW }), 's02:interview:1');
  const seen3 = new Set([...seen2, 's02:interview:1']);
  assert.equal(room.pickQuestion(pool, attempts, { weak, avoid: seen3, rng: never, now: NOW }), 's02:interview:2');
  // Everything shown: the sitting asked for more than the pool holds — answer something, never nothing.
  assert.ok(room.pickQuestion(pool, attempts, { weak, avoid: new Set(pool.map((q) => q.id)), rng: never, now: NOW }));
  assert.equal(room.pickQuestion([], attempts, { rng: never, now: NOW }), null);
});

test('interview: a weak topic outranks an equally unseen question from a strong one', () => {
  // Everything is unseen here, so the only thing that may decide is the weak section: whichever of
  // its three questions the tie-break lands on, it must come from s02 and not from s01.
  for (const roll of [0, 0.4, 0.99]) {
    const fixed = () => roll;
    const picked = room.pickQuestion(pool, {}, { weak: new Set(['s02']), rng: fixed, now: NOW });
    assert.match(picked, /^s02:/, `roll ${roll} skipped the weak section`);
  }
});

test('interview: the sitting walks real sections, weighted by content, with no repeats', () => {
  const range = { id: 'python', from: 1, to: 3 };
  const sections = [
    section({ sectionId: 's01', no: 1, byType: { interview: 10 }, miniProject: 0 }),
    section({ sectionId: 's02', no: 2, byType: { interview: 0 }, miniProject: 0 }),   // no concept content
    section({ sectionId: 's03', no: 3, byType: { interview: 5, theory: 5 }, miniProject: 0 }),
  ];
  const plan = room.planSections(range, sections, 'concept', 2, () => 0);
  assert.equal(plan.length, 2);
  assert.ok(plan.includes('s01') && plan.includes('s03'), 'only sections with eligible content may enter');
  assert.equal(new Set(plan).size, plan.length, 'one section per step — no repeats');
  // Asking for more steps than there are eligible sections yields the shorter list, not padding.
  assert.equal(room.planSections(range, sections, 'concept', 10, () => 0).length, 2);
  // A kind nobody has content in plans nothing at all.
  assert.deepEqual(room.planSections(range, sections, 'debug', 5, () => 0), []);
});

/* ------------------------------- progress ------------------------------- */

test('interview: progress counts the canonical qb records, per kind and per subject', () => {
  const r = { id: 'python', from: 1, to: 2 };
  const sections = [
    // coding 3 with one mini project = 2 real coding-interview questions in the pool.
    section({ sectionId: 's01', no: 1, byType: { interview: 2, coding: 3, debug: 1 }, miniProject: 1 }),
    section({ sectionId: 's02', no: 2, byType: { interview: 1 }, miniProject: 0 }),
  ];
  const attempts = {
    'qb:s01:interview:0': { done: true, ts: 1 },
    'qb:s02:interview:0': { done: false, ts: 1 },        // answered, wrong — still an answer recorded
    'qb:s01:debug:0': { ts: 1 },                          // draft written, not graded
    'qb:s09:interview:0': { done: true, ts: 1 },          // outside the subject range
    'lab:mock:1:0': { done: true, ts: 1 },                // a different family entirely
  };
  const p = Object.fromEntries(room.kindProgress(attempts, r, sections).map((k) => [k.id, k]));
  assert.equal(p.concept.done, 2);
  assert.equal(p.concept.total, 3);
  assert.equal(p.concept.pct, 67);
  assert.equal(p.debug.done, 1);
  assert.equal(p.coding.total, 2, 'the mini project is not part of the coding pool');
  assert.equal(p.coding.done, 0, 'no coding answer was recorded');
  assert.equal(p.logic.total, 0);
  assert.equal(p.logic.pct, 0);
});

test('interview: continue points at the most recent canonical answer, and never at a non-interview key', () => {
  const last = room.lastInterviewTouch({
    'qb:s01:interview:0': { done: true, ts: 100 },
    'qb:s02:defense:1': { done: true, ts: 300 },
    'qb:s02:checkpoint:0': { done: true, ts: 900 },   // assessment band — not an interview round
    'lab:interview:42': { done: true, ts: 999 },      // the old standalone family, not a bank id
  });
  assert.deepEqual(last, { id: 's02:defense:1', sectionId: 's02', kind: 'project', ts: 300 });
  assert.equal(room.lastInterviewTouch({}), null);
});

test('interview: the offered sitting sizes are the brief\'s five plus Quick', () => {
  assert.deepEqual([...room.SESSION_SIZES], [1, 5, 10, 15, 20]);
});

/* ------------------------------- the surfaces ------------------------------- */

test('interview: the room writes the SAME canonical attempt records as the Question Bank', () => {
  // The one-line contract of this whole rebuild: answers hang off the bank id, not a copy of it.
  assert.match(mode, /recordAttempt\(bankAttempt\(q\.id\)/, 'the room must save under the canonical qb id');
  assert.match(mode, /eligibleInBank\(bank\)/, 'the pool must come from the canonical bank');
  assert.match(mode, /pickQuestion\(pool, state\.attempts/, 'the ladder must drive the next question');
  assert.match(mode, /planSections\(range, entries, kind\.id, size\)/, 'the sitting must be planned over the manifest');
});

test('interview: the hub indexes every surface and shows the recovered inventory', () => {
  const app = read('src/app/App.tsx');
  const registered = new Set([...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));
  for (const r of ['/interview-mode', '/mock-interviews', '/defense', '/final-assessment']) {
    assert.ok(registered.has(r), `${r} must be a registered route`);
    assert.ok(hub.includes(`'${r}'`), `the hub must index ${r}`);
  }
  assert.match(hub, /useBankManifest\(\)/, 'the inventory must come from the bank manifest');
  assert.match(hub, /kindProgress\(/, 'the meters must count real answers');
  assert.match(hub, /useBankManifest\(\)[\s\S]*?INTERVIEW_KINDS|INTERVIEW_KINDS[\s\S]*?kindCounts\(/, 'the subject cards must count the interview kinds');
  assert.match(hub, /to="\/questions\?type=interview"/, 'the interview bank stays one link away');
  assert.match(hub, /to="\/playbook"/, 'the answer archive stays one link away');
});
