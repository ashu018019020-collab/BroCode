/**
 * The interview SESSION rules — modes, level pools, evaluation parsing and the report.
 *
 * These are the parts a UI cannot prove: a report that averages the wrong denominator, a level that
 * empties a round, or a model reply that is trusted without a shape all render fine. The engine is
 * pure, so every rule is driven with fixtures here; `interview-room.test.mjs` already holds the
 * canonical-bank side of the same feature.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./_ts-resolve.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const session = await load('src/core/assessment/interview-session.ts');
const room = await load('src/core/assessment/interview-room.ts');

const question = (over = {}) => ({
  id: 's01:interview:0',
  sectionId: 's01',
  type: 'interview',
  difficulty: 'medium',
  importance: 'interview_critical',
  priority: 'P0',
  status: 'PUBLISHED',
  question: 'What is a list in Python?',
  answer: 'A list is an ordered mutable collection. It keeps duplicates. Indexing starts at zero.',
  explanation: 'An ordered sequence you can change.',
  source: 'authored',
  tags: [],
  ...over,
});

/* ---------------------------------- modes --------------------------------- */

test('interview session: the six modes are views over real interview kinds', () => {
  assert.deepEqual(session.MODES.map((m) => m.id), ['technical', 'coding', 'project', 'hr', 'mock', 'timed']);
  const kinds = new Set(room.INTERVIEW_KINDS.map((k) => k.id));
  for (const mode of session.MODES) {
    assert.ok(mode.kinds.length > 0, `${mode.id} must ask at least one kind`);
    for (const k of mode.kinds) assert.ok(kinds.has(k), `${mode.id} names an unknown kind: ${k}`);
  }
  assert.equal(session.modeById('timed').timed, true);
  assert.equal(session.modeById('technical').timed, false);
});

/* -------------------------------- difficulty ------------------------------- */

test('interview session: the three levels map onto the four real difficulties', () => {
  assert.deepEqual(session.levelById('beginner').difficulties, ['easy']);
  assert.deepEqual(session.levelById('intermediate').difficulties, ['medium']);
  assert.deepEqual(session.levelById('advanced').difficulties, ['hard', 'expert']);
  assert.equal(session.matchesLevel(question({ difficulty: 'expert' }), 'advanced'), true);
  assert.equal(session.matchesLevel(question({ difficulty: 'easy' }), 'advanced'), false);
});

test('interview session: an empty level RELAXES instead of stalling, but an empty bank stays empty', () => {
  const medium = [question(), question({ id: 's01:interview:1' })];
  assert.deepEqual(session.levelPool(medium, 'intermediate'), { questions: medium, relaxed: false });

  // No `easy` item in the loaded bank: the round continues at the bank's own difficulty, and says so.
  const relaxed = session.levelPool(medium, 'beginner');
  assert.equal(relaxed.relaxed, true);
  assert.equal(relaxed.questions.length, 2);

  // A bank with nothing in it invents nothing.
  assert.deepEqual(session.levelPool([], 'beginner'), { questions: [], relaxed: false });
});

/* -------------------------------- evaluation ------------------------------- */

test('interview session: scores band into correct / partial / incorrect', () => {
  assert.equal(session.verdictForScore(100), 'correct');
  assert.equal(session.verdictForScore(75), 'correct');
  assert.equal(session.verdictForScore(74), 'partial');
  assert.equal(session.verdictForScore(45), 'partial');
  assert.equal(session.verdictForScore(44), 'incorrect');
  assert.equal(session.verdictForScore(0), 'incorrect');
});

test('interview session: a valid model evaluation is accepted and normalised', () => {
  const parsed = session.parseEvaluation({
    score: '82',
    status: 'partially-correct',
    technicalAccuracy: 'mostly-accurate',
    conceptsUnderstood: ['ordered collection', '', 42],
    missingConcepts: ['mutability'],
    mistakes: ['said tuples are mutable'],
    evidence: ['"a tuple cannot" — correct, but no reason given'],
    explanation: 'Lists are mutable sequences.',
    modelAnswer: 'A list is an ordered, mutable sequence.',
    nextStep: 'Say the mutability point first.',
    followUp: 'When would a tuple be better?',
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.evaluation.score, 82);
  assert.equal(parsed.evaluation.status, 'partially-correct');
  assert.deepEqual(parsed.evaluation.conceptsUnderstood, ['ordered collection']);
  assert.deepEqual(parsed.evaluation.evidence, ['"a tuple cannot" — correct, but no reason given']);
  assert.equal(parsed.evaluation.technicalAccuracy, 'mostly-accurate');
  assert.equal(parsed.evaluation.followUp, 'When would a tuple be better?');

  // A reply that states only a score still carries a defensible status.
  const derived = session.parseEvaluation({ score: 20, explanation: 'x', modelAnswer: 'y' });
  assert.equal(derived.evaluation.status, 'incorrect');
  assert.deepEqual(derived.evaluation.evidence, []);
  // An unknown status is never trusted.
  const unknown = session.parseEvaluation({ score: 90, status: 'perfect', explanation: 'x', modelAnswer: 'y' });
  assert.equal(unknown.evaluation.status, 'correct');
});

test('interview session: malformed model output is refused, never half-displayed', () => {
  assert.equal(session.parseEvaluation(null).ok, false);
  assert.equal(session.parseEvaluation([]).ok, false);
  assert.equal(session.parseEvaluation({ explanation: 'x', modelAnswer: 'y' }).ok, false, 'a missing score is not 0');
  assert.equal(session.parseEvaluation({ score: 101, explanation: 'x', modelAnswer: 'y' }).ok, false);
  assert.equal(session.parseEvaluation({ score: -1, explanation: 'x', modelAnswer: 'y' }).ok, false);
  assert.equal(session.parseEvaluation({ score: 'high', explanation: 'x', modelAnswer: 'y' }).ok, false);
  assert.equal(session.parseEvaluation({ score: 50, modelAnswer: 'y' }).ok, false, 'no explanation');
  assert.equal(session.parseEvaluation({ score: 50, explanation: 'x' }).ok, false, 'no model answer');

  // A valid score with a missing accuracy is normalised from the score, not rejected.
  const inferred = session.parseEvaluation({ score: 30, explanation: 'x', modelAnswer: 'y' });
  assert.equal(inferred.ok, true);
  assert.equal(inferred.evaluation.technicalAccuracy, 'inaccurate');
  assert.equal(inferred.evaluation.followUp, null);
});

test('interview session: the built-in rubric scores the answer, and an empty answer scores zero', () => {
  const q = question();
  const blank = session.fallbackEvaluation(q, '   ');
  assert.equal(blank.score, 0);
  assert.equal(blank.status, 'incorrect');
  assert.equal(blank.technicalAccuracy, 'inaccurate');
  assert.ok(blank.explanation.includes('ordered'));

  const good = session.fallbackEvaluation(q, 'A list is an ordered mutable collection that keeps duplicates and indexing starts at zero.');
  assert.ok(good.score > 0 && good.score <= 100);
  assert.equal(good.status, session.statusForScore(good.score));
  assert.ok(good.conceptsUnderstood.length > 0);
  assert.ok(good.evidence.length > 0, 'the rubric reports what it matched, not just a number');
  assert.equal(good.modelAnswer, q.answer);
});

/* ------------------------------ all questions ----------------------------- */

test('all questions: the queue is every eligible item, level-filtered, de-duplicated', () => {
  const banks = [
    { sectionId: 's01', title: 'Lists', questions: [
      question(),
      question({ id: 's01:interview:1', difficulty: 'easy' }),
      question({ id: 's01:logic:0', type: 'logic' }),
    ] },
    { sectionId: 's02', title: 'Tuples', questions: [question({ id: 's02:interview:0', sectionId: 's02', type: 'coding' })] },
    // The same id twice must not be asked twice.
    { sectionId: 's03', title: 'Duplicate', questions: [question({ id: 's01:interview:0' })] },
  ];
  const result = session.collectQuestions(banks, ['concept', 'coding'], 'intermediate');
  assert.deepEqual(result.questions.map((q) => q.id), ['s01:interview:0', 's02:interview:0']);
  assert.equal(result.sections, 3);
  assert.equal(result.relaxed, false, 'the exact level existed, so nothing was relaxed');
  assert.equal(result.questions[0].sectionTitle, 'Lists', 'a slot carries its section title');

  // No item at the chosen level anywhere: the whole set is asked and the page can say it relaxed.
  const easyOnly = [{ sectionId: 's01', title: 'Lists', questions: [question({ difficulty: 'easy' })] }];
  const relaxed = session.collectQuestions(easyOnly, ['concept'], 'advanced');
  assert.equal(relaxed.questions.length, 1);
  assert.equal(relaxed.relaxed, true);

  // An empty bank stays empty — nothing is invented.
  assert.deepEqual(session.collectQuestions([], ['concept'], 'advanced').questions, []);
});

test('interview session: the spoken summary names the score and the missing concept', () => {
  const evaluation = {
    score: 40,
    technicalAccuracy: 'partially-accurate',
    conceptsUnderstood: ['ordered collection'],
    missingConcepts: ['mutability'],
    mistakes: [],
    explanation: 'Lists are mutable. Tuples are not.',
    modelAnswer: 'A list is an ordered mutable sequence.',
    nextStep: 'Compare lists and tuples.',
    followUp: null,
  };
  const spoken = session.evaluationSpeech(evaluation, 'partial');
  assert.match(spoken, /40 out of 100/);
  assert.match(spoken, /partly there/);
  assert.match(spoken, /ordered collection/);
  assert.match(spoken, /mutability/);
  assert.ok(spoken.length <= 620, 'the voice summary stays bounded');
});

/* --------------------------------- report --------------------------------- */

const answer = (over = {}) => ({
  questionId: 's01:interview:0',
  sectionId: 's01',
  sectionTitle: 'Variables',
  kind: 'concept',
  difficulty: 'medium',
  question: 'What is a list?',
  modelAnswer: 'An ordered mutable collection.',
  answer: 'Something that holds values.',
  evaluation: {
    score: 80,
    technicalAccuracy: 'mostly-accurate',
    conceptsUnderstood: ['ordered collection'],
    missingConcepts: ['mutability'],
    mistakes: [],
    explanation: 'A list is ordered and mutable.',
    modelAnswer: 'An ordered mutable collection.',
    nextStep: 'Say mutability out loud.',
    followUp: null,
  },
  verdict: 'correct',
  status: 'correct',
  source: 'ai',
  seconds: 30,
  ...over,
});

test('interview report: every metric is derived from the answers actually evaluated', () => {
  const report = session.buildInterviewReport({
    answers: [
      answer({ retries: 2 }),
      answer({
        questionId: 's01:logic:1',
        sectionId: 's01',
        verdict: 'incorrect',
        source: 'rubric',
        evaluation: { ...answer().evaluation, score: 40, missingConcepts: ['indexing'], technicalAccuracy: 'partially-accurate' },
      }),
    ],
    skipped: 1,
    planned: 3,
    subject: 'Python Core',
    subjectId: 'python',
    seconds: 90,
  });

  assert.equal(report.answered, 2);
  assert.equal(report.correct, 1);
  assert.equal(report.partial, 0);
  assert.equal(report.incorrect, 1);
  assert.equal(report.averageScore, 60);
  assert.equal(report.accuracyPct, 50, 'accuracy is correct/answered, not correct/planned');
  assert.equal(report.skipped, 1);
  assert.equal(report.planned, 3);
  assert.equal(report.remaining, 0, 'two answered + one skipped covers the plan');
  assert.equal(report.unanswered, 0);
  assert.equal(report.retries, 2);
  assert.equal(report.seconds, 90);
  assert.equal(report.topics.length, 1);
  assert.equal(report.topics[0].average, 60);
  assert.deepEqual(report.weakest.map((t) => t.average), [60]);
  assert.ok(report.revision.includes('mutability'));
  assert.ok(report.revision.includes('indexing'));
  assert.ok(report.recommendations.some((r) => r.to === '/mistakes'));
});

test('interview report: an empty sitting reports dashes, not a flattering score', () => {
  const report = session.buildInterviewReport({
    answers: [], skipped: 2, planned: 3, subject: 'SQL', subjectId: 'sql',
  });
  assert.equal(report.averageScore, null);
  assert.equal(report.accuracyPct, null);
  assert.equal(report.answered, 0);
  assert.equal(report.skipped, 2);
  assert.equal(report.remaining, 1, 'the third planned question was never reached');
  assert.equal(report.unanswered, 1);
  assert.equal(report.retries, 0);
  assert.deepEqual(report.topics, []);
  assert.deepEqual(report.weakest, []);
  assert.ok(report.recommendations.length >= 1);
});

test('interview session: the room keeps the pinned canonical contracts', () => {
  const page = read('src/features/interview/InterviewMode.tsx');
  assert.match(page, /recordAttempt\(bankAttempt\(q\.id\)/, 'answers must save under the canonical qb id');
  assert.match(page, /eligibleInBank\(bank\)/, 'the pool must come from the canonical bank');
  assert.match(page, /pickQuestion\(pool, state\.attempts/, 'the ladder must drive the next question');
  assert.match(page, /planSections\(range, entries, kind\.id, size\)/, 'the plan must be built from the manifest');
  assert.match(page, /HubCrumb hub="\/interviews" hubLabel="Interview"/, 'the room links back to the hub');
  assert.match(page, /source: 'interview'/, 'a failed answer must be filed with its source');
  assert.match(page, /requestEvaluation\(/, 'evaluation must be a real request, not a local guess');
  assert.match(page, /useVoiceTutor/, 'the room must reuse the existing voice tutor');
});
