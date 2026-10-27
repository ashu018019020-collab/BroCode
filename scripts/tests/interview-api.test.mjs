/**
 * The server-side AI interviewer — input validation, prompt contract and output validation.
 *
 * The provider is never called here: `evaluateInterviewAnswer` takes an injected `fetchImpl`, so the
 * success path, a 429, a non-JSON reply and a missing key are all exercised offline. That is the
 * point — a provider that starts wrapping JSON in prose must break a test, not a learner's screen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INTERVIEW_DEFAULT_MODEL,
  INTERVIEW_MAX_ANSWER,
  buildInterviewPrompt,
  evaluateInterviewAnswer,
  normalizeEvaluation,
  validateEvaluationBody,
} from '../../server/interview.mjs';

const body = (over = {}) => ({
  question: 'Explain the difference between a list and a tuple in Python.',
  modelAnswer: 'A list is mutable and ordered; a tuple is immutable and ordered.',
  answer: 'A list can change, a tuple cannot.',
  sectionTitle: 'Lists',
  kind: 'Concept',
  difficulty: 'medium',
  lang: 'en-IN',
  ...over,
});

const validEvaluation = {
  score: 78,
  technicalAccuracy: 'mostly-accurate',
  conceptsUnderstood: ['mutability'],
  missingConcepts: ['ordered'],
  mistakes: [],
  explanation: 'A list is mutable and ordered; a tuple is immutable and ordered.',
  modelAnswer: 'Lists are mutable sequences, tuples are immutable sequences.',
  nextStep: 'Name the ordering guarantee as well.',
  followUp: 'When is a tuple the better choice?',
};

function fakeFetch({ ok = true, status = 200, content = JSON.stringify(validEvaluation) } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok,
      status,
      json: async () => ({ choices: [{ message: { content } }], model: 'test-model' }),
    };
  };
  impl.calls = calls;
  return impl;
}

/* ----------------------------- input validation ---------------------------- */

test('interview api: a real body is validated and trimmed', () => {
  const check = validateEvaluationBody(body({ lang: 'hi-IN', sectionTitle: '  Lists  ', answer: `  ${'x'.repeat(INTERVIEW_MAX_ANSWER + 50)}  ` }));
  assert.equal(check.ok, true);
  assert.equal(check.value.lang, 'hi-IN');
  assert.equal(check.value.sectionTitle, 'Lists');
  assert.equal(check.value.answer.length, INTERVIEW_MAX_ANSWER, 'the answer is bounded, not rejected');
});

test('interview api: empty questions, empty references and empty answers are refused', () => {
  assert.equal(validateEvaluationBody(null).ok, false);
  assert.equal(validateEvaluationBody([]).ok, false);
  assert.equal(validateEvaluationBody(body({ question: 'hi' })).ok, false);
  assert.equal(validateEvaluationBody(body({ modelAnswer: '' })).ok, false);
  assert.equal(validateEvaluationBody(body({ answer: '   ' })).ok, false);
  // An unknown language falls back to English rather than failing the round.
  assert.equal(validateEvaluationBody(body({ lang: 'fr-FR' })).value.lang, 'en-IN');
});

/* --------------------------------- prompt --------------------------------- */

test('interview api: the prompt carries the reference answer and demands a JSON object', () => {
  const prompt = buildInterviewPrompt(validateEvaluationBody(body()).value);
  assert.match(prompt.system, /Return ONLY a JSON object/);
  assert.match(prompt.system, /accept any technically valid alternative approach/);
  assert.match(prompt.system, /Never award full marks by default/);
  assert.match(prompt.system, /Do not include internal reasoning/);
  assert.match(prompt.user, /REFERENCE ANSWER \(authoritative curriculum content\)/);
  assert.match(prompt.user, /A list is mutable and ordered/);
  assert.match(prompt.user, /CANDIDATE ANSWER:/);
});

/* ---------------------------- output validation ---------------------------- */

test('interview api: a valid evaluation passes through', () => {
  const evaluation = normalizeEvaluation(validEvaluation);
  assert.equal(evaluation.score, 78);
  assert.equal(evaluation.technicalAccuracy, 'mostly-accurate');
  assert.deepEqual(evaluation.missingConcepts, ['ordered']);
  assert.equal(evaluation.followUp, 'When is a tuple the better choice?');
});

test('interview api: unusable model output throws ai-bad-response', () => {
  for (const bad of [
    null,
    [],
    { ...validEvaluation, score: 101 },
    { ...validEvaluation, score: -1 },
    { ...validEvaluation, score: 'high' },
    { ...validEvaluation, explanation: '' },
    { ...validEvaluation, modelAnswer: '' },
  ]) {
    assert.throws(() => normalizeEvaluation(bad), (error) => error.code === 'ai-bad-response');
  }
  // A missing follow-up and an unknown accuracy are normalised, not fatal.
  const normal = normalizeEvaluation({ ...validEvaluation, followUp: undefined, technicalAccuracy: 'weird' });
  assert.equal(normal.followUp, null);
  assert.equal(normal.technicalAccuracy, 'mostly-accurate');
});

/* ------------------------------- the call -------------------------------- */

test('interview api: a successful provider call returns the validated evaluation', async () => {
  const fetchImpl = fakeFetch();
  const result = await evaluateInterviewAnswer({
    apiKey: 'test-key',
    value: validateEvaluationBody(body()).value,
    fetchImpl,
  });
  assert.equal(result.evaluation.score, 78);
  assert.equal(result.model, 'test-model');
  const { url, init } = fetchImpl.calls[0];
  assert.match(url, /api\.openai\.com\/v1\/chat\/completions/);
  assert.equal(init.headers.Authorization, 'Bearer test-key');
  const sent = JSON.parse(init.body);
  assert.equal(sent.model, INTERVIEW_DEFAULT_MODEL);
  assert.deepEqual(sent.response_format, { type: 'json_object' });
  assert.equal(sent.messages.length, 2);
});

test('interview api: a rate-limited provider is reported as such, not as a generic failure', async () => {
  await assert.rejects(
    evaluateInterviewAnswer({ apiKey: 'k', value: validateEvaluationBody(body()).value, fetchImpl: fakeFetch({ ok: false, status: 429 }) }),
    (error) => error.code === 'ai-rate-limited',
  );
  await assert.rejects(
    evaluateInterviewAnswer({ apiKey: 'k', value: validateEvaluationBody(body()).value, fetchImpl: fakeFetch({ ok: false, status: 500 }) }),
    (error) => error.code === 'ai-unavailable',
  );
});

test('interview api: prose instead of JSON is a bad response, never a crash', async () => {
  await assert.rejects(
    evaluateInterviewAnswer({ apiKey: 'k', value: validateEvaluationBody(body()).value, fetchImpl: fakeFetch({ content: 'Sure! Here is my evaluation: 78/100' }) }),
    (error) => error.code === 'ai-bad-response',
  );
  await assert.rejects(
    evaluateInterviewAnswer({ apiKey: 'k', value: validateEvaluationBody(body()).value, fetchImpl: fakeFetch({ content: JSON.stringify({ score: 999 }) }) }),
    (error) => error.code === 'ai-bad-response',
  );
});

test('interview api: no key is an explicit unconfigured state', async () => {
  await assert.rejects(
    evaluateInterviewAnswer({ apiKey: '', value: validateEvaluationBody(body()).value, fetchImpl: fakeFetch() }),
    (error) => error.code === 'ai-unconfigured',
  );
});
