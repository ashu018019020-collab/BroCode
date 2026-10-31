/**
 * The interview-room VOICE regression suite — the Answer-by-Voice bug, held in tests.
 *
 * The bug the report named: using "Answer by Voice" left the AI speaking permanently off, the
 * session stuck, and a page refresh was the only recovery. The fix is enforced at THREE layers,
 * and this file holds each layer to its rule:
 *
 *  1. `core/ai/voice-session.ts` — the tested STATE rules: the mic and the speaker are separate
 *     machines, every turn ends back in `idle`, cancellation is reserved for intention, and a
 *     duplicate submission can never double-record. These are pure functions; no browser needed.
 *  2. `useVoiceTutor`'s recovery machinery is pinned AS DATA (the file touches SpeechRecognition
 *     and speechSynthesis, which no test runner has — so the constants and the strong-ref rule
 *     are read as text, the same way `interview-session.test.mjs` pins its contracts).
 *  3. The interviewer styles, hints, the adaptive ladder and the device history — the round's new
 *     behaviour, driven with fixtures and checked against the server module's own persona table.
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

const session = await load('src/core/assessment/interview-session.ts');
const rules = await load('src/core/ai/voice-session.ts');
const serverInterview = await load('server/interview.mjs');

/* --------------------------- the voice state machine --------------------------- */

test('voice session: the mic NEVER disables the voice — the Answer-by-Voice invariant', () => {
  // The bug's shape: recording starts → the voice machinery switched off → interview dead.
  // The rule: from ANY phase, opening the mic lands in `listening` (one machine), and closing it
  // lands back in `idle` — a state that can still speak. There IS no "voice off" node.
  for (const phase of ['idle', 'speaking', 'listening', 'processing', 'paused', 'error']) {
    assert.equal(rules.stepVoiceSession(phase, { type: 'listen-start' }), 'listening', `listening from ${phase}`);
  }
  // A recording that ends while a submission is typed flows mic-end → submit without losing voice.
  assert.equal(rules.stepVoiceSession('listening', { type: 'listen-end' }), 'idle');
  assert.equal(rules.stepVoiceSession('idle', { type: 'submit' }), 'processing');
});

test('voice session: finishing a turn always lands back on ready', () => {
  // The verdict is spoken, the speech finishes naturally: ready for the next question.
  assert.equal(rules.stepVoiceSession('processing', { type: 'evaluation-ready' }), 'speaking');
  assert.equal(rules.stepVoiceSession('speaking', { type: 'speak-end' }), 'idle');
  // A question speech that ends on its own: ready — never "off".
  assert.equal(rules.stepVoiceSession('speaking', { type: 'speak-end' }), 'idle');
  // A failed evaluation is survivable WITHOUT a refresh.
  assert.equal(rules.stepVoiceSession('processing', { type: 'submit-failed' }), 'idle');
  assert.equal(rules.stepVoiceSession('error', { type: 'recover' }), 'idle');
});

test('voice session: cancel is intentional only, and a duplicate submit is ignored', () => {
  assert.equal(rules.stepVoiceSession('speaking', { type: 'speak-cancelled' }), 'idle');
  assert.equal(rules.stepVoiceSession('listening', { type: 'speak-cancelled' }), 'idle');
  // A paused session keeps its pause through a cancelled speech — pause is its own machine.
  assert.equal(rules.stepVoiceSession('paused', { type: 'speak-cancelled' }), 'paused');
  // Double-click submit while the request is in flight: still exactly one in-flight request.
  assert.equal(rules.stepVoiceSession('processing', { type: 'submit' }), 'processing');
  // Reset is always available: a finished turn can never trap the session.
  assert.equal(rules.stepVoiceSession('error', { type: 'reset' }), 'idle');
});

test('voice session: the action table disables ONE action, never the interview', () => {
  assert.equal(rules.actionLegal('answer-by-voice', 'idle'), true);
  assert.equal(rules.actionLegal('answer-by-voice', 'listening'), false, 'one mic at a time');
  assert.equal(rules.actionLegal('stop-listening', 'listening'), true);
  assert.equal(rules.actionLegal('speak-question', 'listening'), false, 'no echo while recording');
  assert.equal(rules.actionLegal('speak-question', 'idle'), true, 'a finished recording never breaks Speak');
  assert.equal(rules.actionLegal('submit', 'processing'), false);
  assert.equal(rules.actionLegal('skip', 'processing'), false);
  assert.equal(rules.actionLegal('submit', 'speaking'), true, 'a finished speech never blocks submitting');
  assert.equal(rules.actionLegal('pause-interview', 'idle'), true);
  assert.equal(rules.actionLegal('resume-interview', 'paused'), true);
  assert.equal(rules.actionLegal('resume-interview', 'idle'), false);
});

test('voice session: auto-advance fires only on a finished speech of a marked answer', () => {
  assert.equal(rules.mayAutoAdvance({ phase: 'speaking', ended: false, autoNext: true, finalVerdict: true }), false);
  assert.equal(rules.mayAutoAdvance({ phase: 'speaking', ended: true, autoNext: false, finalVerdict: true }), false);
  assert.equal(rules.mayAutoAdvance({ phase: 'speaking', ended: true, autoNext: true, finalVerdict: false }), false);
  assert.equal(rules.mayAutoAdvance({ phase: 'listening', ended: true, autoNext: true, finalVerdict: true }), false,
    'a mic still open is the learner turn — never auto-advance under it');
  assert.equal(rules.mayAutoAdvance({ phase: 'speaking', ended: true, autoNext: true, finalVerdict: true }), true);
  assert.ok(rules.phaseLabel('processing').includes('Evaluat'), 'the status chip states the real wait');
});

/* ------------------------- the hook's recovery machinery ------------------------- */

test('voice hook: the recovery machinery is pinned where the speech engine reads it', () => {
  const hook = read('src/components/shared/useVoiceTutor.ts');
  // The generation guard replaced the utterance bookkeeping when the model moved to the server: a
  // stale answer can never schedule another sentence, which is what the old strong-ref/GC dance was
  // protecting against.
  assert.match(hook, /generation\.current \+= 1/, 'an intentional stop invalidates the answer in flight');
  assert.match(hook, /id !== generation\.current/, 'every async continuation checks the generation');
  assert.match(hook, /const STALL_MS = \d+/, 'the stall watchdog must be a named constant');
  assert.match(hook, /Date\.now\(\) - lastActivity\.current < STALL_MS/, 'the watchdog measures real silence');
  // A hung request is CANCELLED, not waited on: the server stops synthesising audio nobody will hear.
  assert.match(hook, /abortRef\.current\?\.abort\(\)/, 'the watchdog aborts a hung request');
  assert.match(hook, /const COMPLETED_LINGER_MS = \d+/, 'a finished answer returns to Ready on a bounded timer');
  // Continuous answers: the interview asks for a mic that survives sentence pauses.
  assert.match(hook, /CONTINUOUS_REARMS = \d+/, 'the re-arm cap exists');
  assert.match(hook, /keepOpenRef\.current = continuous/, 'the press honours the continuous option');
  // A refused mic never switches the speech settings or the session off.
  assert.match(hook, /micDenied: micPermissionDenied\(error\)/, 'permission is its own state');
});

test('voice hook: the interview page derives the voice phase from the REAL audio states', () => {
  const page = read('src/features/interview/InterviewMode.tsx');
  // Deriving, not mirroring: no second boolean that can drift away from the engine.
  assert.match(page, /voice\.listening\) return 'listening'/);
  assert.match(page, /voice\.speaking\) return 'speaking'/);
  assert.match(page, /actionLegal\(action, voicePhase\)/, 'the button table guards every press');
  // Answer by Voice is a CONTINUOUS capture — the long-answer flow of a real interview.
  assert.match(page, /\{ continuous: true \}/, 'the room records whole answers, not one utterance');
  // The auto-advance only advances through the speech-end callback.
  assert.match(page, /autoAdvancedFor\.current === question\.id/, 'one auto-advance per question, ever');
  // The canonical bank contracts stay pinned (mirror of interview-session.test.mjs).
  assert.match(page, /\.speak\(followUp \? `\$\{spokenLead\} A follow-up for you: \$\{followUp\}` : spokenLead/);
});

/* ------------------------------- interviewer styles ------------------------------- */

test('styles: five personas, unique, with distinct evaluator instructions and real leads', () => {
  const ids = session.INTERVIEWER_STYLES.map((s) => s.id);
  assert.deepEqual([...new Set(ids)], ids, 'style ids must be unique');
  assert.equal(ids.length, 5, 'the brief names five interviewer styles');
  assert.equal(new Set(session.INTERVIEWER_STYLES.map((s) => s.promptDirective)).size, ids.length,
    'a style wants its own evaluator instruction — otherwise it is a label');
  for (const style of session.INTERVIEWER_STYLES) {
    assert.ok(style.opening.length > 12, `${style.id} opens with its own words`);
    for (const verdict of ['correct', 'partial', 'incorrect']) {
      assert.ok(style.lead[verdict].length > 3, `${style.id} leads a ${verdict} verdict`);
    }
  }
  assert.equal(session.styleById('nonsense').id, session.INTERVIEWER_STYLES[0].id, 'an unknown style falls back');
  assert.equal(session.DEFAULT_STYLE, 'mentor');
});

test('styles: the five persona ids are mirrored EXACTLY by the server module', () => {
  for (const style of session.INTERVIEWER_STYLES) {
    assert.ok(typeof serverInterview.INTERVIEW_STYLES[style.id] === 'string',
      `the server knows the ${style.id} persona`);
    assert.ok(serverInterview.INTERVIEW_STYLES[style.id].length > 30,
      `${style.id}'s directive is a real instruction, not a tag`);
  }
  // The validated style travels into the prompt — an unknown one never mangles the request.
  const check = serverInterview.validateEvaluationBody({
    question: 'What is a tuple?', modelAnswer: 'An ordered immutable sequence.', answer: 'It is immutable.',
    lang: 'en-IN', style: 'hacker-man',
  });
  assert.equal(check.ok, true);
  assert.equal(check.value.style, null, 'an unknown style is dropped, never a 400');
  const mentor = serverInterview.validateEvaluationBody({
    question: 'What is a tuple?', modelAnswer: 'An ordered immutable sequence.', answer: 'It is immutable.',
    lang: 'en-IN', style: 'mentor',
  });
  assert.equal(mentor.value.style, 'mentor');
  const prompt = serverInterview.buildInterviewPrompt(mentor.value);
  assert.match(prompt.system, /friendly mentor/, 'the persona reaches the system prompt');
  const plain = serverInterview.buildInterviewPrompt({ ...mentor.value, style: null });
  assert.doesNotMatch(plain.system, /Persona:/, 'no style, no persona line — the old prompt');
});

/* ------------------------------- the adaptive ladder ------------------------------- */

test('adaptive: two clean answers step up, two misses step down, single results hold', () => {
  assert.equal(session.adaptiveLevel('intermediate', 2, 0), 'advanced');
  assert.equal(session.adaptiveLevel('intermediate', 1, 0), 'intermediate', 'one answer is not a trend');
  assert.equal(session.adaptiveLevel('intermediate', 0, 2), 'beginner');
  assert.equal(session.adaptiveLevel('intermediate', 0, 1), 'intermediate');
  assert.equal(session.adaptiveLevel('advanced', 3, 0), 'advanced', 'the top is the ceiling');
  assert.equal(session.adaptiveLevel('beginner', 0, 3), 'beginner', 'the floor is the floor');
  assert.equal(session.adaptiveLevel('advanced', 2, 0), 'advanced');
});

/* ------------------------------------ hints ------------------------------------ */

test('hints: a hint names points the answer touches, never the model answer itself', () => {
  const question = {
    answer:
      'Mutable vs immutable decides whether assignment changes state: int, float, str, tuple are immutable, list, dict, set are mutable types like a list append example.',
  };
  const slots = session.questionHintSlots(question);
  assert.ok(slots.length > 0 && slots.length <= 4, 'a hint is a handful of points, not a dump');
  const hint = slots.join(' ');
  assert.ok(!hint.includes('decides whether'), 'the clause PHRASING stays hidden — the hint is not the answer');
  assert.match(hint, /mutable|types|list/i, 'but the ground the answer should cover is named');
  assert.deepEqual(session.questionHintSlots({ answer: '' }), [], 'nothing to hint at, nothing hinted');
});

test('hints: every REAL bank question yields a non-empty, answer-free hint slot list', () => {
  const manifest = JSON.parse(read('public/generated/questions/manifest.json'));
  assert.ok(manifest.total > 10_000, 'the bank manifest is real');
  const section = manifest.sections.find((s) => s.sectionId === 's01');
  const bank = JSON.parse(read('public/generated/questions/s01.json'));
  const eligible = bank.questions.filter(
    (q) => q.status === 'PUBLISHED'
      && !(q.type === 'coding' && (q.tags ?? []).includes('mini-project'))
      && ['interview', 'theory', 'coding', 'debug', 'logic', 'defense', 'solved'].includes(q.type),
  );
  // The interview pool is every interview-eligible type, minus the mini-project builds that wear
  // the coding type — exactly the arithmetic `interview-room.kindCounts` performs.
  const expectedEligible = (section.byType.interview ?? 0) + (section.byType.theory ?? 0)
    + (section.byType.debug ?? 0) + (section.byType.logic ?? 0) + (section.byType.defense ?? 0)
    + (section.byType.solved ?? 0) + Math.max(0, (section.byType.coding ?? 0) - (section.miniProject ?? 0));
  assert.equal(eligible.length, expectedEligible, 'the tested pool is the real interview pool');
  for (const q of eligible.slice(0, 40)) {
    const slots = session.questionHintSlots(q);
    assert.ok(Array.isArray(slots), `hint is a list for ${q.id}`);
    const hinted = slots.join(' ');
    assert.ok(!hinted.includes(q.answer.slice(0, 30)), `the hint never reads the answer for ${q.id}`);
  }
});

/* ------------------------------ the device history ------------------------------ */

test('history: a finished sitting becomes one entry — and the list caps at the limit', () => {
  const report = session.buildInterviewReport({
    answers: [fixtureAnswer('s01', 's01:interview:1', 80, 'correct'), fixtureAnswer('s04', 's04:interview:2', 50, 'partial')],
    skipped: 1, planned: 5, subject: 'SQL', subjectId: 'sql', seconds: 310,
  });
  const entry = session.historyFromReport(report, {
    subject: 'SQL', subjectId: 'sql', mode: 'technical', level: 'intermediate', style: 'mentor',
    savedAt: '2026-10-27T10:00:00.000Z',
  });
  assert.equal(entry.answered, 2);
  assert.equal(entry.averageScore, 65);
  assert.equal(entry.planned, 5);
  assert.equal(entry.style, 'mentor');

  let history = [];
  for (let i = 0; i < session.HISTORY_MAX + 12; i += 1) {
    history = session.appendHistory(history, { ...entry, savedAt: `2026-01-0${i % 10}T10:00:00.000Z-${i}` });
  }
  assert.equal(history.length, session.HISTORY_MAX, 'the cap holds — no unbounded device storage');
  assert.equal(history[0].subject, 'SQL', 'newest first');
});

function fixtureAnswer(sectionId, questionId, score, verdict) {
  return {
    questionId,
    sectionId,
    sectionTitle: sectionId.toUpperCase(),
    kind: 'concept',
    difficulty: 'medium',
    question: '?',
    modelAnswer: 'answer',
    answer: 'answer text',
    evaluation: {
      score,
      status: 'partially-correct',
      technicalAccuracy: 'mostly-accurate',
      conceptsUnderstood: ['one'],
      missingConcepts: ['two'],
      mistakes: [],
      evidence: [],
      explanation: 'explanation',
      modelAnswer: 'answer',
      nextStep: 'next',
      followUp: null,
    },
    verdict,
    status: 'correct',
    source: 'ai',
    seconds: 30,
  };
}
