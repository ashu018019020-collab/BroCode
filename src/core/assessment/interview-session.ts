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
import type { InterviewKindId } from './interview-room';

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
 * The structured evaluation both the model and the offline rubric produce.
 *
 * Deliberately flat and string-based: it has to survive JSON round-trips from a model, pass a
 * strict validator, and render without a second normalisation pass in the page.
 */
export interface AnswerEvaluation {
  /** 0–100. Derived from the answer's quality by the evaluator, never preset. */
  score: number;
  technicalAccuracy: TechnicalAccuracy;
  conceptsUnderstood: string[];
  missingConcepts: string[];
  mistakes: string[];
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
  return {
    ok: true,
    evaluation: {
      score: Math.round(score),
      technicalAccuracy: accuracy,
      conceptsUnderstood: list(raw.conceptsUnderstood),
      missingConcepts: list(raw.missingConcepts),
      mistakes: list(raw.mistakes),
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
 * UI labels it `Offline rubric`, never `AI`.
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
    technicalAccuracy: accuracyForScore(score),
    conceptsUnderstood: understood.slice(0, 6),
    missingConcepts: scored.missing.slice(0, 8),
    mistakes: written
      ? []
      : ['No answer was recorded, so nothing could be matched against the model answer.'],
    explanation: question.answer,
    modelAnswer: question.answer,
    nextStep: score >= 75
      ? 'Say the same answer again in your own words, then try a harder question.'
      : 'Compare your answer with the model answer and name the points you missed before retrying.',
    followUp: null,
  };
}

/** What the interviewer says aloud after an evaluation. Bounded — the full detail stays on screen. */
export function evaluationSpeech(evaluation: AnswerEvaluation, verdict: Verdict = verdictForScore(evaluation.score)): string {
  const parts: string[] = [];
  parts.push(verdict === 'correct'
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
  source: EvaluationSource;
  /** Seconds this answer took from the question appearing to submission. */
  seconds: number;
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

  return {
    subject: input.subject,
    planned: input.planned,
    answered: answers.length,
    skipped: input.skipped,
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
