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

const { MASTERCLASS_BANKS, masterclassHref, masterclassPractice, masterclassQuestionCount, masterclassQuizTally, masterclassSelection } = await load('src/core/learning/masterclass.ts');
const { MASTERCLASS_QUIZ_PREFIX, masterclassModuleReward, masterclassQuizAttempt, masterclassQuizFamily } = await load('src/core/platform/keys.ts');

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

test('masterclass url: the selection is validated against what the course publishes', () => {
  const modules = [
    { id: 'sql12', topics: [{ id: 't01' }] },
    { id: 'sql13', topics: [{ id: 't01' }, { id: 't04' }] },
  ];
  const read = (query) => masterclassSelection(new URLSearchParams(query), modules);
  assert.deepEqual(
    read('module=sql13&bank=logic&example=t04&level=pro'),
    { moduleId: 'sql13', bank: 'logic', topicId: 't04', level: 'pro' },
  );
  // A link can outlive an edit that renumbers a module or a topic: an unknown id is ignored.
  assert.deepEqual(read('module=sql99&example=t04'), { moduleId: undefined, bank: undefined, topicId: undefined, level: undefined });
  assert.deepEqual(read('module=sql13&example=t99'), { moduleId: 'sql13', bank: undefined, topicId: undefined, level: undefined });
  assert.deepEqual(read('module=sql13&bank=answers'), { moduleId: 'sql13', bank: undefined, topicId: undefined, level: undefined });
  // The level is a panel-wide choice, so it stands on its own; only the two authored values count.
  assert.deepEqual(read('level=pro'), { moduleId: undefined, bank: undefined, topicId: undefined, level: 'pro' });
  assert.deepEqual(read('level=expert'), { moduleId: undefined, bank: undefined, topicId: undefined, level: undefined });
  assert.deepEqual(read(''), { moduleId: undefined, bank: undefined, topicId: undefined, level: undefined });
  assert.equal(MASTERCLASS_BANKS.length, 6);
});

test('masterclass url: writing the selection keeps the page’s other params', () => {
  const params = new URLSearchParams('module=sql12&tab=notes');
  const next = masterclassHref(params, { moduleId: 'sql13', bank: 'logic', example: 't04', level: 'pro' });
  assert.equal(next.get('module'), 'sql13');
  assert.equal(next.get('bank'), 'logic');
  assert.equal(next.get('example'), 't04');
  assert.equal(next.get('level'), 'pro');
  assert.equal(next.get('tab'), 'notes');
  assert.equal(params.get('module'), 'sql12', 'the page’s current params are not mutated');

  // An example belongs to its module: opening another one drops the stale topic.
  const moved = masterclassHref(new URLSearchParams('module=sql12&example=t01&bank=logic'), { moduleId: 'sql13' });
  assert.equal(moved.get('module'), 'sql13');
  assert.equal(moved.get('example'), null);
  assert.equal(moved.get('bank'), 'logic', 'the bank is still the learner’s choice');
});

test('masterclass xp: topics and modules each pay once, through their own receipts', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'src/features/labs/SqlMasterclass.tsx'), 'utf8');
  assert.equal(masterclassModuleReward('sql-masterclass', 'sql13'), 'mmr:sql-masterclass:sql13');

  // A topic pays the first time its mt: record appears — the record is the receipt, so unchecking
  // keeps it (done: false) instead of deleting it, and checking again cannot pay twice.
  assert.match(panel, /if \(!state\.attempts\[key\]\) addXp\(MASTERCLASS_TOPIC_XP/, 'topic XP is gated by the record');
  assert.match(panel, /recordAttempt\(key, \{ done: false \}\)/, 'unchecking must keep the receipt');
  assert.doesNotMatch(panel, /forgetAttempt\(/, 'deleting the record would re-pay on the next check');

  // A module pays once through mmr:, not through the derived completion set, and says so.
  assert.match(panel, /masterclassModuleReward\(/, 'module XP needs its own receipt');
  assert.match(panel, /if \(state\.attempts\[key\]\?\.done\) return;/, 'the module receipt is checked before paying');
  assert.match(panel, /addXp\(MASTERCLASS_MODULE_XP/, 'completing a module awards XP');
  assert.match(panel, /\+\$\{MASTERCLASS_MODULE_XP\} XP/, 'the notice names the award');

  // The course-wide bonus is unchanged: mcr:, once, at full completion.
  assert.match(panel, /masterclassCourseReward\(/, 'the course reward stays on mcr:');
  assert.match(panel, /addXp\(MASTERCLASS_COMPLETION_XP/, 'the course bonus still pays at the end');
});
