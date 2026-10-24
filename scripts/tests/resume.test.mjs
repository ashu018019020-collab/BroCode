/**
 * "Continue Learning" destination rules.
 *
 * The three entry points (dashboard, footer, landing page) all call `resumeTarget`, so its decision
 * is the whole feature. These tests use the real `progress.ts` engine and a minimal but complete
 * Section fixture — no copied logic, and no route is asserted without also asserting that its
 * section id exists in the fixture curriculum.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register('./_ts-resolve.mjs', import.meta.url);

const { resumeTarget, stageFromAttemptKey } = await import(
  pathToFileURL(path.join(ROOT, 'src', 'core', 'learning', 'resume.ts')).href
);

/** A Section with every collection the progress engine reads. */
const section = (id, no, title) => ({
  id,
  no,
  title,
  pages: { learn: [1], interview: [2], code: [3], logic: [4], solved: [5], mini: [6], project: [7], checkpoint: [8] },
  learn: { concepts: [], recap: '', remember: [], practice: [] },
  interview: [],
  coding: [{ difficulty: 'easy', text: 'task', solution: '', check: '' }],
  logic: [{ kind: 'predict', text: 'card', answer: '' }],
  solved: [{ difficulty: 'easy', text: 'q', solution: '', result: '' }],
  mini: {},
  projectLab: [],
  checkpoint: [],
});

const SECTIONS = [section('s02', 2, 'Second'), section('s01', 1, 'First')];

const state = (over = {}) => ({
  version: 1,
  profile: { name: 'Learner', goal: 'Programming', level: 'Beginner', dailyMinutes: 60, onboarded: true },
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
  learning: {},
  ...over,
});

test('resume: a brand-new learner starts at the first section in ROADMAP order', () => {
  const target = resumeTarget(state(), SECTIONS);
  assert.equal(target.source, 'first');
  assert.equal(target.route, '/lesson/s01/learn', 'the section with no=1 wins even when it is not first in the array');
  assert.equal(target.sectionId, 's01');
  assert.equal(target.stage, 'learn');
});

test('resume: the stored lesson position wins over history', () => {
  const target = resumeTarget(
    state({ learning: { lastSectionId: 's02', lastStage: 'coding' } }),
    SECTIONS,
  );
  assert.equal(target.source, 'stored');
  assert.equal(target.route, '/lesson/s02/coding');
});

test('resume: a completed stored stage advances to the next incomplete stage of that section', () => {
  const target = resumeTarget(
    state({
      learning: { lastSectionId: 's02', lastStage: 'learn' },
      attempts: { 'view:s02:learn': { done: true, ts: 100 } },
    }),
    SECTIONS,
  );
  assert.equal(target.source, 'stored');
  assert.equal(target.stage, 'coding', 'learn is finished, so the first open gate (coding) is next');
  assert.equal(target.route, '/lesson/s02/coding');
});

test('resume: without a stored position the newest stage record is used', () => {
  const target = resumeTarget(
    state({
      attempts: {
        'view:s01:learn': { done: true, ts: 100 },
        'st:s02:logic0': { done: false, ts: 500 },
      },
    }),
    SECTIONS,
  );
  assert.equal(target.source, 'history');
  assert.equal(target.sectionId, 's02');
  assert.equal(target.stage, 'logic');
  assert.equal(target.route, '/lesson/s02/logic');
});

test('resume: a stale or unknown section id cannot become a route', () => {
  const target = resumeTarget(state({ learning: { lastSectionId: 's99', lastStage: 'learn' } }), SECTIONS);
  assert.equal(target.sectionId, 's01', 'the invalid stored id is ignored');
  assert.equal(target.route, '/lesson/s01/learn');
});

test('resume: a fully complete curriculum lands on the review queue, never a dead route', () => {
  const only = section('s01', 1, 'Only');
  const complete = state({
    learning: { lastSectionId: 's01', lastStage: 'defense' },
    attempts: {
      'view:s01:learn': { done: true, ts: 1 },
      'st:s01:interview': { score: 100, ts: 1 },
      'st:s01:coding0': { done: true, ts: 1 },
      'st:s01:logic0': { done: true, ts: 1 },
      'st:s01:solved0': { done: true, ts: 1 },
      'st:s01:mini': { done: true, ts: 1 },
      'st:s01:project': { done: true, ts: 1 },
      'st:s01:defense': { score: 60, ts: 1 },
    },
  });
  const target = resumeTarget(complete, [only]);
  assert.equal(target.route, '/review');
  assert.equal(target.source, 'review');
});

test('resume: attempt keys are read through their real shapes only', () => {
  assert.equal(stageFromAttemptKey('view:s01:learn', 's01'), 'learn');
  assert.equal(stageFromAttemptKey('st:s01:debugdone', 's01'), 'debug');
  assert.equal(stageFromAttemptKey('st:s01:coding3', 's01'), 'coding');
  assert.equal(stageFromAttemptKey('st:s01:notAStage', 's01'), null);
  assert.equal(stageFromAttemptKey('st:s02:learn', 's01'), null, 'another section\'s key is not this section');
  assert.equal(stageFromAttemptKey('qb:s01:q1', 's01'), null);
});
