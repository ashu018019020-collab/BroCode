/**
 * The interview SESSION — everything the room needs that is not a question lookup.
 *
 * Pure, like `interview-room.ts`: no React, no store, no fetch (the loader ceiling in AGENTS.md).
 * Three jobs, kept apart because each has a failure mode the others cannot see:
 *
 *  1. WHAT THE ROUND ASKS — the six modes the brief names are VIEWS over the canonical kinds, and
 *     the three difficulty levels map onto the bank's four real difficulties. The old room filtered
 *     the answer pool by difficulty but planned sections without it, so a level with no items in a
 *     planned section dead-ended the round; `levelPool` returns the relaxed pool and says so, so the
 *     page can keep going and TELL the learner the level was relaxed.
 *  2. WHAT AN EVALUATION IS — one strict schema for the model's reply, a parser that refuses
 *     anything else, and a deterministic rubric fallback for the deployments where the API or its
 *     key is absent. The fallback is labelled `rubric`, never `ai`.
 *  3. WHAT THE REPORT SAYS — every number derived from the answers actually evaluated in this
 *     session. No fabricated history, no averaged placeholders.
 */
import type { Difficulty, QuestionRecord } from '../data/schema';
import { keywordScore, questionRubric } from './evaluate';
import { kindOf, type InterviewKindId } from './interview-room';

/* --------------------------------- modes --------------------------------- */

export type InterviewModeId = 'technical' | 'coding' | 'project' | 'hr' | 'mock' | 'timed';

export interface InterviewMode {
  id: InterviewModeId;
  label: string;
  emoji: string;
  blurb: string;
  /** The canonical kinds this mode asks. The FIRST one is the section-planning weight. */
  kinds: InterviewKindId[];
  /** A per-question clock. Hitting it SKIPS the question — it never submits an unfinished answer. */
  timed: boolean;
}

export const MODES: InterviewMode[] = [
  { id: 'technical', label: 'Technical', emoji: '🎯', blurb: 'Concepts and reasoning, the classic screening round', kinds: ['concept', 'logic'], timed: false },
  { id: 'coding', label: 'Coding', emoji: '💻', blurb: 'Write, run and explain code — complexity included', kinds: ['coding', 'debug'], timed: false },
  { id: 'project', label: 'Project', emoji: '🛡️', blurb: 'Defend the build: decisions, trade-offs, failures', kinds: ['project', 'concept'], timed: false },
  { id: 'hr', label: 'HR', emoji: '🤝', blurb: 'Behavioural and communication questions', kinds: ['concept'], timed: false },
  { id: 'mock', label: 'Mock', emoji: '🎭', blurb: 'Mixed round — the interviewer moves across topics', kinds: ['concept', 'coding', 'debug', 'logic', 'project', 'challenge'], timed: false },
  { id: 'timed', label: 'Timed', emoji: '⏱️', blurb: 'Mixed round with 2 minutes per question', kinds: ['concept', 'coding', 'debug', 'logic'], timed: true },
];

export const DEFAULT_MODE: InterviewModeId = 'technical';
export const PER_QUESTION_SECONDS = 120;

export function modeById(id: InterviewModeId): InterviewMode {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}

/* --------------------------- interviewer styles --------------------------- */

/**
 * The five interviewer personalities. A style is NOT a label: it changes THREE real things —
 * the opening line the AI speaks, the lead line of the spoken verdict, and the persona directive
 * sent to the evaluator (the model is explicitly told how to weigh clarity vs depth vs strictness).
 * `scripts/tests/interview-voice.test.mjs` holds the ids unique and the directives distinct.
 */
export type InterviewerStyleId = 'mentor' | 'recruiter' | 'technical' | 'strict' | 'adaptive';

export interface InterviewerStyle {
  id: InterviewerStyleId;
  label: string;
  emoji: string;
  blurb: string;
  /** The persona sentence sent to the AI evaluator with every answer. */
  promptDirective: string;
  /** The spoken OPENING line the candidate hears when a round starts. */
  opening: string;
  /** How the spoken verdict LEADS, per verdict. Tone is part of the personality. */
  lead: Record<Verdict, string>;
}

export const INTERVIEWER_STYLES: InterviewerStyle[] = [
  {
    id: 'mentor',
    label: 'Friendly Mentor',
    emoji: '🤝',
    blurb: 'Patient and supportive — best for a first interview round',
    promptDirective:
      'Persona: a friendly mentor. Explain unfamiliar concepts in simple language, forgive wording variance generously, and encourage before correcting. Keep the tone warm but still mark real gaps honestly.',
    opening: 'Hi! I will walk you through a short round — take your time, I am listening.',
    lead: {
      correct: 'Very good —',
      partial: 'You are on the right track —',
      incorrect: 'No problem, this one trips a lot of people —',
    },
  },
  {
    id: 'recruiter',
    label: 'Professional Recruiter',
    emoji: '💼',
    blurb: 'Realistic HR-style screening: clarity, structure, examples',
    promptDirective:
      'Persona: a professional recruiter screening an AI/Data-Science candidate. Weigh clarity, structure and concrete examples as heavily as technical content; flag vague or rambling answers as communication issues, and keep the tone polite and businesslike.',
    opening: 'Hello, thanks for making the time. Let us begin with a screening round.',
    lead: {
      correct: 'Good answer —',
      partial: 'Reasonable, though a recruiter would probe further —',
      incorrect: 'This answer would not survive a screening call —',
    },
  },
  {
    id: 'technical',
    label: 'Technical Interviewer',
    emoji: '🧑‍💻',
    blurb: 'Concepts, logic, debugging — expects real depth',
    promptDirective:
      'Persona: a seasoned technical interviewer. Reward precision, reasoning and edge cases; push on the "why" behind facts, and treat hand-waving as a gap. Stay factual and specific.',
    opening: 'Let us get into the technical round. Explain your reasoning as you go.',
    lead: {
      correct: 'Solid —',
      partial: 'Halfway there technically —',
      incorrect: 'That misses the core concept —',
    },
  },
  {
    id: 'strict',
    label: 'Strict Interviewer',
    emoji: '🧨',
    blurb: 'Direct, demanding evaluation — for the week before a real interview',
    promptDirective:
      'Persona: a strict, experienced interviewer. Mark missing concepts directly with no cushioning, hold the score to a high bar, and keep feedback short and actionable. Never invent errors — the reference answer is the authority.',
    opening: 'I will be direct in this round — answer precisely, that is what you will face.',
    lead: {
      correct: 'Accepted —',
      partial: 'Not good enough yet —',
      incorrect: 'No —',
    },
  },
  {
    id: 'adaptive',
    label: 'Adaptive Interviewer',
    emoji: '🧭',
    blurb: 'Moves up after two clean answers, down after two misses',
    promptDirective:
      'Persona: an adaptive interviewer calibrating the candidate. Match depth to the apparent skill shown by the answer itself, and name one concrete step up or down the ladder in nextStep.',
    opening: 'This round adapts to you — it starts at the level you chose and moves with your answers.',
    lead: {
      correct: 'That level is behind you —',
      partial: 'You held your level —',
      incorrect: 'We are above where you are right now —',
    },
  },
];

export const DEFAULT_STYLE: InterviewerStyleId = 'mentor';

export function styleById(id: InterviewerStyleId): InterviewerStyle {
  return INTERVIEWER_STYLES.find((s) => s.id === id) ?? INTERVIEWER_STYLES[0];
}

/** The level order the ADAPTIVE rule walks. Not exported: the page asks, it never indexes. */
const LEVEL_ORDER: LevelId[] = ['beginner', 'intermediate', 'advanced'];

/**
 * The level the ADAPTIVE style holds the round at: two clean answers land one level up, two
 * misses one level down. Anything else holds — the level must not jitter on every question.
 */
export function adaptiveLevel(current: LevelId, consecutiveCorrect: number, consecutiveIncorrect: number): LevelId {
  const at = Math.max(0, LEVEL_ORDER.indexOf(current));
  if (consecutiveCorrect >= 2 && at < LEVEL_ORDER.length - 1) return LEVEL_ORDER[at + 1];
  if (consecutiveIncorrect >= 2 && at > 0) return LEVEL_ORDER[at - 1];
  return LEVEL_ORDER[at];
}

/**
 * A HINT built from the authored answer, never invented: the leading keywords of each model-answer
 * clause. It names the ground the answer should cover WITHOUT handing over phrasing — the detail is
 * the answer itself, and the hint must not read as it. Returns [] when there is nothing to hint at.
 */
export function questionHintSlots(question: Pick<QuestionRecord, 'answer'>): string[] {
  return questionRubric(question.answer)
    .map((group) => group.split('|').slice(0, 3).join(', '))
    .filter((sparse) => sparse.length > 3)
    .slice(0, 4);
}

/* ------------------------------ session history ------------------------------ */

/**
 * One past round, saved under the device-only history key (see keys.ts). Every number is copied
 * from the built report — nothing recomputed, nothing embellished.
 */
export interface InterviewHistoryEntry {
  savedAt: string;
  subject: string;
  subjectId: string;
  mode: InterviewModeId;
  level: LevelId;
  style: InterviewerStyleId;
  planned: number;
  answered: number;
  skipped: number;
  correct: number;
  partial: number;
  incorrect: number;
  averageScore: number | null;
  seconds: number;
}

export const HISTORY_MAX = 20;

/** The history entry for one finished sitting, derived only from the report and the setup. */
export function historyFromReport(
  report: InterviewReport,
  meta: { subject: string; subjectId: string; mode: InterviewModeId; level: LevelId; style: InterviewerStyleId; savedAt: string },
): InterviewHistoryEntry {
  return {
    savedAt: meta.savedAt,
    subject: meta.subject,
    subjectId: meta.subjectId,
    mode: meta.mode,
    level: meta.level,
    style: meta.style,
    planned: report.planned,
    answered: report.answered,
    skipped: report.skipped,
    correct: report.correct,
    partial: report.partial,
    incorrect: report.incorrect,
    averageScore: report.averageScore,
    seconds: report.seconds,
  };
}

/** Append one entry to a history list honouring HISTORY_MAX, newest first. */
export function appendHistory(history: InterviewHistoryEntry[], entry: InterviewHistoryEntry): InterviewHistoryEntry[] {
  return [entry, ...history.filter((h) => h.savedAt !== entry.savedAt)].slice(0, HISTORY_MAX);
}

/* ------------------------------- difficulty ------------------------------- */

export type LevelId = 'beginner' | 'intermediate' | 'advanced';

export interface Level {
  id: LevelId;
  label: string;
  /** The real bank difficulties this level means. `advanced` spans hard+expert on purpose. */
  difficulties: Difficulty[];
}

export const LEVELS: Level[] = [
  { id: 'beginner', label: 'Beginner', difficulties: ['easy'] },
  { id: 'intermediate', label: 'Intermediate', difficulties: ['medium'] },
  { id: 'advanced', label: 'Advanced', difficulties: ['hard', 'expert'] },
];

export const DEFAULT_LEVEL: LevelId = 'intermediate';

export function levelById(id: LevelId): Level {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[1];
}

export function matchesLevel(q: Pick<QuestionRecord, 'difficulty'>, level: LevelId): boolean {
  return levelById(level).difficulties.includes(q.difficulty);
}

/**
 * The questions a level can ask, with one honest escape hatch.
 *
 * When the chosen level has nothing in the loaded bank, the round keeps going at the bank's own
 * difficulty instead of stalling on "no question matched" — and `relaxed` is true so the page can
 * say so in the header. An EMPTY bank stays empty: nothing is invented.
 */
export function levelPool(questions: QuestionRecord[], level: LevelId): { questions: QuestionRecord[]; relaxed: boolean } {
  const exact = questions.filter((q) => matchesLevel(q, level));
  if (exact.length) return { questions: exact, relaxed: false };
  return { questions, relaxed: questions.length > 0 };
}

/* ------------------------------- evaluation ------------------------------- */

export type Verdict = 'correct' | 'partial' | 'incorrect';

export type TechnicalAccuracy = 'accurate' | 'mostly-accurate' | 'partially-accurate' | 'inaccurate';

/**
 * The verdict the EVALUATOR reports. `needs-clarification` is not a low score — it means the answer
 * was too vague to mark, so the room asks for detail instead of inventing a number.
 */
export type EvaluationStatus = 'correct' | 'partially-correct' | 'incorrect' | 'needs-clarification';

const STATUSES: EvaluationStatus[] = ['correct', 'partially-correct', 'incorrect', 'needs-clarification'];

/**
 * The structured evaluation both the model and the built-in rubric produce.
 *
 * Deliberately flat and string-based: it has to survive JSON round-trips from a model, pass a
 * strict validator, and render without a second normalisation pass in the page.
 */
export interface AnswerEvaluation {
  /** 0–100. Derived from the answer's quality by the evaluator, never preset. */
  score: number;
  /** The evaluator's verdict, including the "too vague to mark" case. */
  status: EvaluationStatus;
  technicalAccuracy: TechnicalAccuracy;
  conceptsUnderstood: string[];
  missingConcepts: string[];
  mistakes: string[];
  /** Short quotes or observations from the candidate's own answer that justify the verdict. */
  evidence: string[];
  explanation: string;
  modelAnswer: string;
  nextStep: string;
  /** A relevant follow-up, or null when one would not help. */
  followUp: string | null;
}

export type ParseResult = { ok: true; evaluation: AnswerEvaluation } | { ok: false; reason: string };

const ACCURACY: TechnicalAccuracy[] = ['accurate', 'mostly-accurate', 'partially-accurate', 'inaccurate'];
const text = (value: unknown, max = 1200): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const list = (value: unknown, max = 8, each = 240): string[] =>
  Array.isArray(value)
    ? value.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, max).map((x) => x.slice(0, each))
    : [];

/** The verdict bands the report counts. Stated once so the page and the report cannot disagree. */
export function verdictForScore(score: number): Verdict {
  if (score >= 75) return 'correct';
  if (score >= 45) return 'partial';
  return 'incorrect';
}

export function verdictLabel(verdict: Verdict): string {
  if (verdict === 'correct') return 'Correct';
  if (verdict === 'partial') return 'Partially correct';
  return 'Incorrect';
}

function accuracyForScore(score: number): TechnicalAccuracy {
  if (score >= 85) return 'accurate';
  if (score >= 65) return 'mostly-accurate';
  if (score >= 40) return 'partially-accurate';
  return 'inaccurate';
}

/** The status a score alone implies. Used when a model omits `status`. */
export function statusForScore(score: number): EvaluationStatus {
  if (score >= 75) return 'correct';
  if (score >= 45) return 'partially-correct';
  return 'incorrect';
}

export function statusLabel(status: EvaluationStatus): string {
  if (status === 'correct') return 'Correct';
  if (status === 'partially-correct') return 'Partially correct';
  if (status === 'needs-clarification') return 'Needs clarification';
  return 'Incorrect';
}

/**
 * Validate one model reply.
 *
 * A schema violation is a NORMAL outcome (models wrap JSON in prose, drop a key, or send a score as
 * a string), so this never throws: the caller falls back to the rubric and says so. Only a value
 * that cannot honestly be displayed is rejected — there is no partial trust of an invalid score.
 */
export function parseEvaluation(value: unknown): ParseResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'not an object' };
  const raw = value as Record<string, unknown>;
  const score = typeof raw.score === 'string' ? Number(raw.score) : raw.score;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
    return { ok: false, reason: 'score must be a number between 0 and 100' };
  }
  const explanation = text(raw.explanation, 2000);
  const modelAnswer = text(raw.modelAnswer, 2000);
  if (!explanation || !modelAnswer) return { ok: false, reason: 'explanation and modelAnswer are required' };
  const accuracy = ACCURACY.includes(raw.technicalAccuracy as TechnicalAccuracy)
    ? (raw.technicalAccuracy as TechnicalAccuracy)
    : accuracyForScore(score);
  const status = STATUSES.includes(raw.status as EvaluationStatus)
    ? (raw.status as EvaluationStatus)
    : statusForScore(Math.round(score));
  return {
    ok: true,
    evaluation: {
      score: Math.round(score),
      status,
      technicalAccuracy: accuracy,
      conceptsUnderstood: list(raw.conceptsUnderstood),
      missingConcepts: list(raw.missingConcepts),
      mistakes: list(raw.mistakes),
      evidence: list(raw.evidence, 6, 300),
      explanation,
      modelAnswer,
      nextStep: text(raw.nextStep, 400) || 'Re-read the model answer, then try the same question again.',
      followUp: typeof raw.followUp === 'string' && raw.followUp.trim() ? raw.followUp.trim().slice(0, 400) : null,
    },
  };
}

/**
 * The deterministic evaluator, used only when the AI evaluator cannot answer.
 *
 * It is the SAME keyword rubric the Question Bank uses, so its number is auditable: it counts how
 * many clauses of the authored answer the learner actually hit. It is not a language model and the
 * UI labels it `Built-in rubric`, never `AI`.
 */
export function fallbackEvaluation(question: Pick<QuestionRecord, 'answer'>, answer: string): AnswerEvaluation {
  const written = answer.trim();
  const rubric = questionRubric(question.answer);
  const scored = written
    ? keywordScore(written, rubric)
    : { pct: 0, missing: rubric };
  const score = written ? scored.pct : 0;
  const understood = rubric
    .filter((group) => !scored.missing.includes(group))
    .map((group) => group.split('|')[0])
    .filter(Boolean);
  return {
    score,
    status: written ? statusForScore(score) : 'incorrect',
    technicalAccuracy: accuracyForScore(score),
    conceptsUnderstood: understood.slice(0, 6),
    missingConcepts: scored.missing.slice(0, 8),
    mistakes: written
      ? []
      : ['No answer was recorded, so nothing could be matched against the model answer.'],
    evidence: understood.slice(0, 4).map((group) => `Matched the model answer's point: ${group}`),
    explanation: question.answer,
    modelAnswer: question.answer,
    nextStep: score >= 75
      ? 'Say the same answer again in your own words, then try a harder question.'
      : 'Compare your answer with the model answer and name the points you missed before retrying.',
    followUp: null,
  };
}

/**
 * What the interviewer says aloud after an evaluation. Bounded — the full detail stays on screen.
 * `styleLead` swaps the flat verdict openers for the chosen interviewer persona's tone
 * (see INTERVIEWER_STYLES); without it the built-in lines keep every existing caller identical.
 */
export function evaluationSpeech(
  evaluation: AnswerEvaluation,
  verdict: Verdict = verdictForScore(evaluation.score),
  styleLead?: Partial<Record<Verdict, string>>,
): string {
  const parts: string[] = [];
  const lead = styleLead?.[verdict];
  parts.push(lead
    ? `${lead} ${evaluation.score} out of 100.`
    : verdict === 'correct'
      ? `That is correct — ${evaluation.score} out of 100.`
      : verdict === 'partial'
        ? `You are partly there — ${evaluation.score} out of 100.`
        : `Not quite — ${evaluation.score} out of 100.`);
  if (evaluation.conceptsUnderstood.length) {
    parts.push(`What you got right: ${evaluation.conceptsUnderstood.slice(0, 3).join(', ')}.`);
  }
  if (evaluation.missingConcepts.length) {
    parts.push(`Still missing: ${evaluation.missingConcepts.slice(0, 3).join(', ')}.`);
  }
  const explanation = evaluation.explanation.replace(/\s+/g, ' ').trim();
  if (explanation) {
    const sentences = explanation.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
    parts.push(sentences);
  }
  if (evaluation.nextStep) parts.push(evaluation.nextStep);
  return parts.join(' ').replace(/\s{2,}/g, ' ').slice(0, 620);
}

/* --------------------------------- report --------------------------------- */

export type EvaluationSource = 'ai' | 'rubric';

export interface SessionAnswer {
  questionId: string;
  sectionId: string;
  sectionTitle: string;
  kind: InterviewKindId;
  difficulty: Difficulty;
  question: string;
  modelAnswer: string;
  answer: string;
  evaluation: AnswerEvaluation;
  verdict: Verdict;
  status: EvaluationStatus;
  source: EvaluationSource;
  /** Seconds this answer took from the question appearing to submission. */
  seconds: number;
  /** How many times the learner re-answered this question before this evaluation. */
  retries?: number;
  /**
   * The EVALUATED answer to the interviewer's follow-up question, if the candidate practised it.
   * It rides on the same sitting record — it never writes a synthetic `qb:` key and never changes
   * the main verdict; the report shows it beside the answer it belongs to.
   */
  followUpEvaluation?: AnswerEvaluation;
}

/**
 * One question in a sitting's queue, with its record attached.
 *
 * The record travels with the slot so the live room never re-fetches a bank to show a question it
 * already planned — which is what makes "All Questions" over an entire subject possible in one
 * pass, and what keeps every asked id unique within the sitting.
 */
export interface SessionQuestion {
  id: string;
  sectionId: string;
  sectionTitle: string;
  question: QuestionRecord;
}

/**
 * Build the full queue from already-loaded banks.
 *
 * `All Questions` means exactly that: every PUBLISHED, interview-eligible question of the chosen
 * kinds in the chosen subject, at the chosen level — with one honest fallback. If a section has
 * nothing at that level, its questions are taken at the bank's own difficulty and `relaxed` is true,
 * so the room says so. Ids are de-duplicated, so a question can never be asked twice in a sitting.
 */
export function collectQuestions(
  sections: { sectionId: string; title: string; questions: QuestionRecord[] }[],
  kinds: InterviewKindId[],
  level: LevelId,
): { questions: SessionQuestion[]; relaxed: boolean; sections: number } {
  const out: SessionQuestion[] = [];
  const seen = new Set<string>();
  let relaxed = false;
  for (const section of sections) {
    const eligible = section.questions.filter((q) => {
      const k = kindOf(q);
      return k !== null && kinds.includes(k);
    });
    const pool = levelPool(eligible, level);
    if (pool.relaxed) relaxed = true;
    for (const question of pool.questions) {
      if (seen.has(question.id)) continue;
      seen.add(question.id);
      out.push({ id: question.id, sectionId: section.sectionId, sectionTitle: section.title, question });
    }
  }
  return { questions: out, relaxed, sections: sections.length };
}

export interface TopicPerformance {
  sectionId: string;
  title: string;
  answered: number;
  average: number;
}

export interface Recommendation {
  label: string;
  to: string;
  why: string;
}

export interface InterviewReport {
  subject: string;
  planned: number;
  answered: number;
  skipped: number;
  correct: number;
  partial: number;
  incorrect: number;
  /** Planned questions never reached because the learner ended early. */
  remaining: number;
  /** Planned questions neither answered nor explicitly skipped. */
  unanswered: number;
  /** Total re-answers across the sitting. */
  retries: number;
  /** Mean of the evaluated answers' scores, or null when nothing was evaluated. */
  averageScore: number | null;
  /** Correct answers / answered answers, as a percentage. Null when nothing was answered. */
  accuracyPct: number | null;
  seconds: number;
  topics: TopicPerformance[];
  strongest: TopicPerformance[];
  weakest: TopicPerformance[];
  revision: string[];
  recommendations: Recommendation[];
  answers: SessionAnswer[];
}

/**
 * Every figure comes from `answers` — the list the page appended only after a real evaluation came
 * back. An empty session reports zeros and `null`, never a flattering default.
 */
export function buildInterviewReport(input: {
  answers: SessionAnswer[];
  skipped: number;
  planned: number;
  subject: string;
  subjectId: string;
  seconds?: number;
}): InterviewReport {
  const { answers } = input;
  const count = (v: Verdict) => answers.filter((a) => a.verdict === v).length;
  const totalScore = answers.reduce((sum, a) => sum + a.evaluation.score, 0);
  const averageScore = answers.length ? Math.round(totalScore / answers.length) : null;
  const correct = count('correct');

  const bySection = new Map<string, { title: string; total: number; n: number }>();
  for (const a of answers) {
    const row = bySection.get(a.sectionId) ?? { title: a.sectionTitle, total: 0, n: 0 };
    row.total += a.evaluation.score;
    row.n += 1;
    bySection.set(a.sectionId, row);
  }
  const topics: TopicPerformance[] = [...bySection.entries()]
    .map(([sectionId, row]) => ({ sectionId, title: row.title, answered: row.n, average: Math.round(row.total / row.n) }))
    .sort((a, b) => b.average - a.average);
  const strongest = topics.slice(0, 3);
  const weakest = [...topics].reverse().slice(0, 3).filter((t) => t.average < 75);

  const revision: string[] = [];
  for (const a of answers) {
    for (const missing of a.evaluation.missingConcepts) {
      if (revision.length >= 8) break;
      if (!revision.includes(missing)) revision.push(missing);
    }
  }

  const recommendations: Recommendation[] = [];
  for (const topic of weakest) {
    recommendations.push({
      label: `Re-practise ${topic.title}`,
      to: `/questions?section=${topic.sectionId}`,
      why: `${topic.average}% average across ${topic.answered} answer${topic.answered === 1 ? '' : 's'} in this topic.`,
    });
  }
  recommendations.push({
    label: 'Fix these in the Mistake Tracker',
    to: '/mistakes',
    why: 'Every incorrect answer in this round was filed there with your own words.',
  });
  if (averageScore === null || averageScore < 75) {
    recommendations.push({
      label: 'Take the same round again',
      to: `/interview-mode?subject=${input.subjectId}`,
      why: 'A second pass with the same settings is the fastest way to see whether the explanation stuck.',
    });
  }

  const remaining = Math.max(0, input.planned - answers.length - input.skipped);
  return {
    subject: input.subject,
    planned: input.planned,
    answered: answers.length,
    skipped: input.skipped,
    remaining,
    unanswered: remaining,
    retries: answers.reduce((sum, a) => sum + (a.retries ?? 0), 0),
    correct,
    partial: count('partial'),
    incorrect: count('incorrect'),
    averageScore,
    accuracyPct: answers.length ? Math.round((correct / answers.length) * 100) : null,
    seconds: input.seconds ?? answers.reduce((sum, a) => sum + a.seconds, 0),
    topics,
    strongest,
    weakest,
    revision,
    recommendations,
    answers,
  };
}
