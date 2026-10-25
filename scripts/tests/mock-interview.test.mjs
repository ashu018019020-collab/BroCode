/**
 * The Spoken Interview engine — `src/core/assessment/mock-interview.ts`.
 *
 * Every question here is projected from the bundled curriculum, never authored by this module. The
 * tests pin the parts that would otherwise be easy to fake:
 *
 *   1. A plan is reproducible from its seed, cites only real sections, and says what it could not
 *      include (no coding item, no HR bank) instead of padding the round.
 *   2. The four dimensions are scored from different evidence, an unanswered question is not scored,
 *      and no audio/accent signal exists at all.
 *   3. Follow-ups come from the authored text or the exact missing rubric point.
 *   4. The report's totals equal the per-question numbers the candidate already saw, and its revision
 *      plan points at real lesson routes.
 *
 * Zero dependencies: node:test, the TS resolver, and the generated curriculum.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

register('./_ts-resolve.mjs', import.meta.url);

const interview = await load('src/core/assessment/mock-interview.ts');
const sections = JSON.parse(read('public/generated/curriculum/sections.json'));
const byId = new Map(sections.map((section) => [section.id, section]));

/* ---------------------------------- planning -------------------------------- */

test('interview: the same seed produces the same round, drawn from real curriculum sections', () => {
  const config = { role: 'ai-engineer', topics: ['python'], difficulty: 'junior', minutes: 15, seed: 7 };
  const a = interview.buildMockPlan(sections, config);
  const b = interview.buildMockPlan(sections, config);
  assert.deepEqual(a.questions.map((q) => q.id), b.questions.map((q) => q.id), 'seeded, reproducible');
  assert.ok(a.questions.length > 0);
  assert.ok(a.questions.length <= interview.targetQuestionCount(15));

  for (const question of a.questions) {
    assert.ok(byId.has(question.sectionId), `${question.id} must belong to a real section`);
    assert.ok(question.prompt.trim().length > 10, 'an empty prompt would be a fake question');
    assert.ok(question.model.trim().length > 0, 'every real item has an authored answer');
    assert.equal(question.topic, 'python');
  }
  const counts = new Map();
  for (const question of a.questions) counts.set(question.sectionId, (counts.get(question.sectionId) ?? 0) + 1);
  assert.ok([...counts.values()].every((count) => count <= 2), 'no section dominates the round');
});

test('interview: a missing topic is reported, not replaced by an invented question', () => {
  const plan = interview.buildMockPlan(sections, { role: 'backend-engineer', topics: ['nlp'], difficulty: 'senior', minutes: 10, seed: 3 });
  assert.ok(Array.isArray(plan.notes));
  if (!plan.questions.length) {
    assert.ok(plan.notes.some((note) => /No questions matched|No eligible/i.test(note)));
  }
  assert.ok(plan.available >= plan.questions.length);
});

test('interview: short rounds are spoken-only, and the plan says why no coding item appears', () => {
  const plan = interview.buildMockPlan(sections, { role: 'python-developer', topics: ['python'], difficulty: 'junior', minutes: 5, seed: 11 });
  assert.ok(plan.questions.length >= 2);
  assert.equal(plan.questions.some((q) => q.kind === 'coding' || q.kind === 'debug'), false);
  assert.ok(plan.notes.some((note) => /short round|coding/i.test(note)), 'an omission is stated, never silent');
});

test('interview: unsupported languages are declared unavailable instead of silently ignored', () => {
  const ids = interview.UNAVAILABLE_TOPICS.map((topic) => topic.id);
  assert.ok(ids.includes('javascript'));
  assert.ok(ids.includes('c'));
  assert.ok(ids.includes('cpp'));
  assert.ok(interview.UNAVAILABLE_TOPICS.every((topic) => topic.reason.length > 10));
  assert.equal(interview.normalizeTopics(['javascript']).includes('javascript'), false, 'no bank, no topic');
});

/* --------------------------------- evaluation -------------------------------- */

const question = {
  id: 'fixture:1',
  sectionId: 's01',
  sectionNo: 1,
  sectionTitle: 'Fixture',
  topic: 'python',
  kind: 'concept',
  prompt: 'What is a list?',
  model: 'A list is ordered and mutable. You can append to it because it stores references.',
  rubric: ['list|ordered', 'append|mutable', 'reference|because'],
};

test('interview: technical, reasoning and communication are independent numbers', () => {
  const strong = interview.evaluateMockAnswer(question, 'A list is an ordered and mutable collection, and you can append to it because it stores references. For example, scores.append(30) adds one item. An edge case is an empty list, where indexing fails.');
  assert.equal(strong.technical, 100, 'all three rubric groups are present');
  assert.ok(strong.reasoning >= 70, 'a cause, an example and an edge case raise reasoning');
  assert.ok(strong.communication >= 65, 'the length is in the spoken range');
  assert.equal(strong.coding, null, 'nothing was run, so no coding score exists');

  const keywordOnly = interview.evaluateMockAnswer(question, 'list ordered mutable append references');
  assert.equal(keywordOnly.technical, 100, 'keywords alone satisfy the rubric');
  assert.ok(keywordOnly.reasoning < strong.reasoning, 'but they do not demonstrate reasoning');
  assert.ok(keywordOnly.communication < strong.communication);

  const empty = interview.evaluateMockAnswer(question, '   ');
  assert.equal(empty.technical, 0);
  assert.equal(empty.reasoning, 0);
  assert.equal(empty.communication, 0);
  assert.equal(empty.overall, null, 'an unanswered question has no score, not a zero');
});

test('interview: coding evidence counts only when a run really happened', () => {
  const notRun = interview.evaluateMockAnswer(question, 'A list is ordered and mutable.', { ran: false, ok: true });
  assert.equal(notRun.coding, null, 'ok:true without ran must not become evidence');
  assert.match(notRun.basis.coding, /No code run/);

  const matched = interview.evaluateMockAnswer(question, 'A list is ordered and mutable.', { ran: true, ok: true, matchesExpected: true });
  assert.equal(matched.coding, 100);
  assert.match(matched.basis.coding, /matched/);

  const failed = interview.evaluateMockAnswer(question, 'A list is ordered and mutable.', { ran: true, ok: false });
  assert.equal(failed.coding, 15);
  assert.match(failed.basis.coding, /raised an error/);

  const uncompared = interview.evaluateMockAnswer(question, 'A list is ordered and mutable.', { ran: true, ok: true });
  assert.equal(uncompared.coding, 60, 'a run with no expected output is execution evidence only');
});

test('interview: the score never reads voice, accent or audio', () => {
  const score = interview.evaluateMockAnswer(question, 'A list is ordered and mutable because it stores references.');
  assert.deepEqual(Object.keys(score).sort(), [
    'basis', 'coding', 'communication', 'evidence', 'missing', 'overall', 'reasoning', 'strengths', 'technical', 'weaknesses',
  ].sort());
  assert.equal('accent' in score, false);
  assert.equal('voice' in score, false);
  assert.equal(score.basis.communication.includes('audio'), false);
});

/* --------------------------------- follow-ups -------------------------------- */

test('interview: a follow-up targets the exact rubric point that is missing', () => {
  const partial = interview.followUpsFor(question, 'A list is ordered.', { limit: 1 });
  assert.equal(partial[0].target, 'missing-rubric');
  assert.match(partial[0].prompt, /append \/ mutable/i);
  assert.match(partial[0].reason, /not in the response yet/);
});

test('interview: an authored follow-up is used when the source has one, and the limit holds', () => {
  const authored = { ...question, authoredFollowUp: 'When would a tuple be better?' };
  const list = interview.followUpsFor(authored, 'A list is ordered and mutable, because it stores references.', { limit: 2 });
  assert.ok(list.length <= 2);
  assert.ok(list.some((item) => item.target === 'authored' && item.prompt === 'When would a tuple be better?'));
});

test('interview: an empty answer gets a way to start, not a score-shaped follow-up', () => {
  const list = interview.followUpsFor(question, '', { limit: 2 });
  assert.equal(list.length, 1);
  assert.equal(list[0].target, 'open');
  assert.match(list[0].prompt, /first step/);
});

test('interview: Hindi follow-ups are Hinglish, not translated technical terms', () => {
  const list = interview.followUpsFor(question, 'A list is ordered.', { lang: 'hi-IN', limit: 1 });
  assert.match(list[0].prompt, /Tumne kuch points cover kiye/);
  assert.match(list[0].prompt, /append|mutable/);
});

/* ----------------------------------- report ---------------------------------- */

function finishedSession() {
  const plan = interview.buildMockPlan(sections, { role: 'ai-engineer', topics: ['python'], difficulty: 'junior', minutes: 10, seed: 21 });
  let session = interview.createMockSession(plan, 1_000_000, 'mock-test');
  const first = plan.questions[0];
  session = interview.recordMockAnswer(session, first.id, {
    text: first.model,
    followUps: [{ prompt: 'Why?', answer: 'Because the lesson says so.' }],
  });
  return { ...session, finishedAt: 1_000_000 + 90_000 };
}

test('interview: the report averages only answered questions and matches the feedback already shown', () => {
  const session = finishedSession();
  const report = interview.buildMockReport(session, 1_000_090_000);

  assert.equal(report.answered, 1);
  assert.equal(report.total, session.plan.questions.length);
  assert.equal(report.durationSeconds, 90);

  const answered = report.results.find((result) => result.answered);
  assert.equal(report.totals.technical, answered.score.technical, 'no second scoring pass');
  assert.equal(report.totals.reasoning, answered.score.reasoning);
  assert.equal(report.totals.coding, null);

  const unanswered = report.results.filter((result) => !result.answered);
  assert.ok(unanswered.length > 0);
  assert.ok(unanswered.every((result) => result.score.overall === null), 'missing answers are null, not zero');
  assert.ok(unanswered.every((result) => report.incomplete.some((entry) => entry.prompt === result.question.prompt)));

  assert.match(report.disclaimer, /not a hiring judgment/);
  assert.match(report.disclaimer, /Accent, voice and audio are never scored/);
  assert.ok(report.strengths.length > 0);
  assert.ok(report.weaknesses.length > 0);
  for (const item of report.revision) {
    assert.match(item.route, /^\/lesson\/[^/]+\/learn$/);
    assert.ok(byId.has(item.sectionId), 'the revision plan links to a section that exists');
  }
});

test('interview: a round with no answers has no scores and says so', () => {
  const plan = interview.buildMockPlan(sections, { role: 'ai-engineer', topics: ['python'], difficulty: 'junior', minutes: 5, seed: 5 });
  const session = { ...interview.createMockSession(plan, 0, 'empty'), finishedAt: 1000 };
  const report = interview.buildMockReport(session, 1000);
  assert.equal(report.answered, 0);
  assert.deepEqual(report.totals, { technical: null, reasoning: null, communication: null, coding: null, overall: null });
  assert.equal(interview.reportHeadline(report), 'Round finished — no answer recorded');
  assert.ok(report.weaknesses.some((line) => /not answered/.test(line)));
});

test('interview: history decode is defensive, bounded and keeps the newest rounds', () => {
  assert.deepEqual(interview.sanitizeReports(null), []);
  assert.deepEqual(interview.sanitizeReports('bogus'), []);
  assert.deepEqual(interview.sanitizeReports([{ id: 'x' }, null, 42]), [], 'a malformed entry is skipped');

  const report = interview.buildMockReport(finishedSession(), 1_000_090_000);
  const decoded = interview.sanitizeReports([{ ...report, totals: { ...report.totals, technical: 150 } }]);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].totals.technical, 100, 'out-of-range scores are clamped on read');
  assert.equal(decoded[0].disclaimer, report.disclaimer);

  const many = Array.from({ length: 20 }, (_, i) => ({ ...report, id: `r${i}`, createdAt: i }));
  const kept = interview.sanitizeReports(many);
  assert.equal(kept.length, interview.MOCK_HISTORY_LIMIT);
  assert.equal(kept[0].id, 'r19', 'newest first');

  const added = interview.addReport([report], { ...report, id: 'new' });
  assert.equal(added.length, 2);
  assert.equal(interview.addReport(added, { ...report, id: 'new' }).length, 2, 'same id replaces');
  assert.deepEqual(interview.removeReport(added, 'new'), [report]);
});

test('interview: the headline reports coverage, not a fake pass', () => {
  const report = interview.buildMockReport(finishedSession(), 1_000_090_000);
  const headline = interview.reportHeadline(report);
  assert.match(headline, /% overall · 1\/\d+ answered/);
});
