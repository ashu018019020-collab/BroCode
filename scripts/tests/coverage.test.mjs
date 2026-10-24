/**
 * "Kitne kiye?" — the coverage layer, next to "kitna sahi hai?" (accuracy.test.mjs). Tables of
 * behavior and boundaries, because the traps here are silent: a graded-WRONG answer is coverage and
 * still 0% mastery; `done` means "ran" for a notebook cell but "passed" for a mock; and the "next
 * target" ladder asks cleared, not attempted, so failing a section must not skip it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const cov = await load('src/core/learning/coverage.ts');
const acc = await load('src/core/assessment/accuracy.ts');
const pb = await load('src/core/assessment/playbook.ts');

/* ------------------------- coverage is not mastery ------------------------- */

test('coverage: graded wrong is done, opening a question is not', () => {
  // `{ done: false }` is the record the old rule dropped: it wanted `done === true` or written text,
  // so a learner with hundreds of answers read "0/13865 practice ho chuke".
  const counts = [{ done: false }, { done: false, answer: '' }, { answer: 'kuch likha' }, { score: 0 }, { done: true }];
  const ignores = [undefined, {}, { tries: 3 }, { answer: '' }, { answer: '   ' }, { score: null }, { score: NaN }];
  for (const a of counts) assert.equal(cov.isPractised(a), true, `not counted: ${JSON.stringify(a)}`);
  for (const a of ignores) assert.equal(cov.isPractised(a), false, `counted: ${JSON.stringify(a)}`);
  // The same record, the other question: coverage says done, mastery still says 0%.
  assert.equal(acc.attemptPct({ done: false }), 0);
});

/* --------------------------- what gets counted --------------------------- */

test('coverage: the bank count covers the qb: family and nothing else', () => {
  // Each of the others looks practised if you only read `done` — the trap the other families set,
  // and why the prefix comes from keys.ts rather than from the caller.
  const attempts = {
    'qb:s01:theory:0': { done: false },              // graded wrong → counts
    'qb:s01:theory:1': { answer: 'likha' },          // written only → counts
    'qb:s01:theory:2': { tries: 3 },                 // merely opened → does not
    'nb:main.ipynb:c1': { done: true, score: 0 },    // a notebook run, even a failing one
    'lab:mock:0': { done: true, score: 90 },         // a passed mock round
    'st:s01:mini': { done: true },                   // a stage gate
    'view:s01:learn': { done: true },                // the "opened the theory" marker
  };
  assert.equal(cov.bankPractised(attempts), 2, 'only the two answered bank records');
  assert.equal(cov.bankPractised({}), 0, 'an empty history is 0, not undefined');
});

test('coverage: the drill skips bank questions graded CORRECT, not merely touched', () => {
  // engine/tutor.ts picks the next bank question for a section the learner keeps failing. It built
  // this set itself — `startsWith('qb:')` plus `done` — i.e. a key shape AND a predicate living
  // outside the module that owns both, in the one builder whose job is to never hand back a question
  // the learner already answered. A written-but-ungraded record is NOT correct: `done` is the verdict.
  const attempts = {
    'qb:s01:theory:0': { done: true },                // correct → skipped
    'qb:s01:theory:1': { done: true, score: 60 },     // the verdict is `done`, not the rubric score
    'qb:s01:theory:2': { done: false },               // graded wrong → still drillable
    'qb:s01:theory:3': { answer: 'likha' },           // written, no verdict → still drillable
    'qb:s01:theory:4': { tries: 2 },                  // merely opened → still drillable
    'nb:main.ipynb:c1': { done: true, score: 100 },   // another family entirely
    'lab:mock:0': { done: true },
  };
  assert.deepEqual([...cov.bankCorrectIds(attempts)].sort(), ['s01:theory:0', 's01:theory:1']);
  assert.equal(cov.bankCorrectIds({}).size, 0, 'an empty history is an empty set, not undefined');
});

test('coverage: a helper resolves the stored key through keys.ts, not the raw id', () => {
  const id = 's19:interview:77';
  const rows = [
    [cov.bankTouched, { [`qb:${id}`]: { done: false } }, true],
    [cov.bankTouched, { [`qb:${id}`]: { done: true } }, true],
    [cov.bankTouched, { [id]: { done: true } }, false],   // the bare id is not the stored key
    [cov.bankTouched, {}, false],
    [cov.bankCleared, { [`qb:${id}`]: { done: false } }, false],  // wrong is not cleared
    [cov.bankCleared, { [`qb:${id}`]: { done: true } }, true],
  ];
  for (const [helper, attempts, expected] of rows) {
    assert.equal(helper(attempts, id), expected, `${helper.name} on ${JSON.stringify(attempts)}`);
  }
});

/* ------------------ the card and the band agree on one learner ------------------ */

test('coverage: the /questions card and the Playbook band report the same work', () => {
  const attempts = {
    'qb:s19:interview:77': { done: false },              // graded wrong
    'qb:s19:interview:78': { answer: 'method' },         // written, never scored
    'qb:s19:interview:81': { done: true, score: 100 },   // graded right
    'qb:s19:interview:82': { tries: 2 },                 // opened only
  };
  const items = [77, 78, 79, 80, 81, 82].map((i) => ({ id: `s19:interview:${i}` }));
  // The card counts bank keys, the band playbook items, and both live in adapters no test can import
  // (see AGENTS.md) — this agreement is the only guard the two screens share.
  assert.equal(cov.bankPractised(attempts), 3, 'three bank records answered, right or wrong');
  assert.equal(pb.playbookPractised(items, (id) => cov.bankTouched(attempts, id)), 3, 'the band counts the same three');
});

/* ------------- what the ladder skips is not what the counters hold ------------- */

test('coverage: the ladder asks cleared, not merely practised', () => {
  const rows = [[{ done: false }, false], [{ answer: 'method' }, true], [{ done: true, score: 100 }, true], [undefined, false]];
  for (const [a, expected] of rows) assert.equal(cov.isCleared(a), expected, JSON.stringify(a));
  // Feeding the coverage predicate to the ladder meant failing an item REMOVED it from the ladder: a
  // learner who failed all 115 items of a section was pointed at a different section.
  assert.equal(cov.isPractised({ done: false }), true, 'the counters accept it');
  assert.equal(cov.isCleared({ done: false }), false, 'the ladder must not skip it');
});

/* ------------- one owner per family: the same question must not be asked twice ------------- */

test('coverage: every family tally reads its own family, with that family own meaning of done', () => {
  // The mock tally lived in three places (dashboard, job prep, badge panel) and the coding tally in
  // two, each spelling the family and the predicate itself. These are the owners now, so this table is
  // the only place the per-family rules are written down — including the one that is a trap.
  const a = {
    'lab:mock:1:0': { done: true },             // a round that cleared 60%
    'lab:mock:1:1': { done: false },            // attempted, failed → recorded, not passed
    'lab:mock:2:0': { score: 0 },               // opened, never graded
    'nb:a.ipynb:c1': { done: true },            // a cell that RAN (even if it raised)
    'nb:a.ipynb:c2': { done: true },
    'nb:b.ipynb:c1': { done: true },            // a different notebook
    'lab:interview:3': { answer: 'bol diya' },  // saved answer, never graded
    'st:s01:coding0': { done: true },
    'st:s01:mini': { done: true },
    'final:part:1': { done: true },             // a final-assessment part, not a stage record
  };
  assert.equal(cov.mockPassed(a), 1, 'only the round that cleared the bar counts as passed');
  assert.equal(cov.notebookCellsRun(a), 3, 'cells that ran — a raised cell still counts');
  assert.equal(cov.notebookCellsRunFor(a, 'a.ipynb'), 2, 'per notebook; a library must not pool its cells');
  assert.equal(cov.interviewLabsAnswered(a), 1, 'a written answer counts before it is graded');
  assert.equal(cov.stageRecords(a), 2, 'stage records only — final: is not a stage');
  assert.equal(cov.doneRecords(a), 7, 'every completed record, whatever its family');
  const counts = {
    mockPassed: cov.mockPassed, notebookCellsRun: cov.notebookCellsRun,
    interviewLabsAnswered: cov.interviewLabsAnswered, stageRecords: cov.stageRecords, doneRecords: cov.doneRecords,
  };
  for (const [name, fn] of Object.entries(counts)) assert.equal(fn({}), 0, `${name} of an empty history is 0, not undefined`);
  assert.equal(cov.notebookCellsRunFor({}, 'a.ipynb'), 0, 'and so is a notebook nobody opened');
});
