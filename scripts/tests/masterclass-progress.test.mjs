/**
 * The Masterclass learn bank used to be a session-only click: `Quiz` kept the pick in local state, so
 * a refresh erased it and only the manual topic ticks moved the course. The answer is now an attempt
 * record of its own family (`mq:<courseId>:<moduleId>:<i>`), and this file holds the two rules that
 * make it count: the tally reads ONLY that family, and the panel reads/writes the record instead of
 * a local pick.
 *
 * The panel is .tsx (the test loader only resolves .ts), so its half is read as text — the same
 * approach `sql-course-page.test.mjs` takes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./_ts-resolve.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);

const { masterclassPractice, masterclassQuestionCount, masterclassQuizTally } = await load('src/core/learning/masterclass.ts');
const { MASTERCLASS_QUIZ_PREFIX, masterclassQuizAttempt, masterclassQuizFamily } = await load('src/core/platform/keys.ts');

test('masterclass quiz: one family per course module, keyed by question position', () => {
  assert.equal(masterclassQuizAttempt('sql-masterclass', 'sql13', 4), 'mq:sql-masterclass:sql13:4');
  assert.equal(masterclassQuizFamily('sql-masterclass', 'sql13'), 'mq:sql-masterclass:sql13:');
  assert.ok(MASTERCLASS_QUIZ_PREFIX === 'mq:');
  assert.ok(masterclassQuizAttempt('sql-masterclass', 'sql13', 0).startsWith(MASTERCLASS_QUIZ_PREFIX));
});

test('masterclass quiz: the tally counts only this course and module', () => {
  const attempts = {
    'mq:sql-masterclass:sql13:0': { done: true },
    'mq:sql-masterclass:sql13:1': { done: false },
    'mq:sql-masterclass:sql14:0': { done: true },
    'mq:mysql-masterclass:sql13:0': { done: true },
    'mt:sql-masterclass:sql13:t1': { done: true },
    'qb:s19:coding:1': { done: true },
    'cquiz:m03:0': { done: true },
    'jquiz:j03:0': { done: true },
  };
  assert.deepEqual(
    masterclassQuizTally(attempts, 'sql-masterclass', 'sql13', 20),
    { answered: 2, correct: 1, total: 20, pct: 10 },
    'topic ticks, the Python bank and the other courses are not questions',
  );

  // Module ids are zero-padded, so the family's trailing colon is what keeps sql1 out of sql13.
  assert.equal(
    masterclassQuizTally({ 'mq:sql-masterclass:sql1:0': { done: true } }, 'sql-masterclass', 'sql13', 20).answered,
    0,
  );
});

test('masterclass quiz: the answered count is capped and an empty bank has no percentage', () => {
  const stale = {
    'mq:sql-masterclass:sql02:0': { done: true },
    'mq:sql-masterclass:sql02:1': { done: true },
    'mq:sql-masterclass:sql02:2': { done: true },
  };
  assert.deepEqual(
    masterclassQuizTally(stale, 'sql-masterclass', 'sql02', 2),
    { answered: 2, correct: 2, total: 2, pct: 100 },
    'a record left over from an edited bank must not print 3/2',
  );
  assert.deepEqual(masterclassQuizTally({}, 'sql-masterclass', 'sql02', 0), {
    answered: 0, correct: 0, total: 0, pct: null,
  });
});

test('masterclass practice: the course tally sums the modules it is given', () => {
  const attempts = {
    'mq:sql-masterclass:sql13:0': { done: true },
    'mq:sql-masterclass:sql13:1': { done: false },
    'mq:sql-masterclass:sql14:0': { done: true },
  };
  assert.deepEqual(
    masterclassPractice(attempts, 'sql-masterclass', [
      { id: 'sql13', questions: 20 },
      { id: 'sql14', questions: 20 },
    ]),
    { answered: 3, correct: 2, total: 40, pct: 8 },
  );
  assert.equal(masterclassPractice({}, 'sql-masterclass', []).pct, null);
  assert.equal(masterclassQuestionCount({ learn: 1, interview: 2, labs: 3, logic: 4, debug: 5, revision: 6 }), 21);
});

test('masterclass quiz: the panel records the answer and reads it back from the store', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'src/features/labs/SqlMasterclass.tsx'), 'utf8');
  assert.match(panel, /recordAttempt\(masterclassQuizAttempt\(/, 'a pick must be stored, not held in state');
  assert.match(panel, /attempts\[masterclassQuizAttempt\(/, 'the chosen option must come back from the record');
  assert.match(panel, /masterclassQuizTally\(/, 'the module progress must count the bank');
  assert.match(panel, /masterclassPractice\(/, 'the course progress must count the bank');
  assert.doesNotMatch(
    panel,
    /const \[picked, setPicked\] = useState/,
    'the old session-only pick must not come back',
  );
  // `done` is the verdict, matching the C and Java quizzes: correct/incorrect, not "viewed".
  assert.match(panel, /done: correct,/);
});
