/**
 * Timed exam engine — pure logic, no React and no storage, so every rule below
 * is unit-testable with node:test.
 *
 * The exam assembles a mock interview from the REAL local question banks. Two
 * properties matter for honesty:
 *
 *  1. Selection is deterministic for a given seed: same blueprint + same seed ⇒
 *     the same paper. Nothing is randomised behind the learner's back, and the
 *     seed is stored in the session so a paper can be re-taken exactly.
 *  2. Scoring is SELF-GRADED. The engine never guesses a mark from typed text —
 *     it only aggregates the learner's own sahi/galat decisions, and it counts
 *     ungraded questions separately instead of silently calling them wrong.
 *
 * This file imports types only, which keeps it loadable by Node's TypeScript
 * stripping in the test suite (no runtime relative imports).
 */
import type { Attempt, Mistake } from '../types';
import type { Difficulty, QuestionRecord, QuestionType } from '../data/schema';

export type ExamFocus = 'mixed' | 'interview' | 'coding' | 'logic' | 'debug';
export type ExamPhase = 'running' | 'grading' | 'done';
export type ExamScope = 'all' | 'complete' | 'one';

export const EXAM_VERSION = 1;

export const EXAM_FOCUS_LABEL: Record<ExamFocus, string> = {
  mixed: 'Mixed (sab types)',
  interview: 'Interview + Checkpoint',
  coding: 'Coding + Solved',
  logic: 'Logic (predict/trace/why…)',
  debug: 'Debug (bug fix karo)',
};

/** Which bank question types a focus draws from. `theory` is never examined. */
export const FOCUS_TYPES: Record<ExamFocus, QuestionType[]> = {
  mixed: ['interview', 'coding', 'logic', 'debug', 'solved', 'checkpoint'],
  interview: ['interview', 'checkpoint'],
  coding: ['coding', 'solved'],
  logic: ['logic'],
  debug: ['debug'],
};

export const EXAM_FOCUS_ORDER: ExamFocus[] = ['mixed', 'interview', 'coding', 'logic', 'debug'];
export const EXAM_SIZES = [5, 8, 12, 20];
export const EXAM_MINUTES = [5, 10, 20, 30, 45];
export const DIFFICULTY_CHOICES: (Difficulty | 'all')[] = ['all', 'easy', 'medium', 'hard', 'expert'];

/** 2.5 minutes per question, floored at 5 — a realistic interview pace. */
export const defaultMinutes = (size: number) => Math.max(5, Math.round(size * 2.5));

export interface ExamBlueprint {
  size: number;
  minutes: number;
  focus: ExamFocus;
  difficulty: Difficulty | 'all';
  scope: ExamScope;
  /** Required when scope === 'one'. */
  sectionId?: string;
  /** Prefer questions the learner has never graded (a real measure, not a fake one). */
  unseenFirst: boolean;
}

export const DEFAULT_BLUEPRINT: ExamBlueprint = {
  size: 8,
  minutes: defaultMinutes(8),
  focus: 'mixed',
  difficulty: 'all',
  scope: 'all',
  unseenFirst: true,
};

/** One question as it lives inside a running exam (self-contained → reload-safe). */
export interface ExamQuestion {
  id: string;
  sectionId: string;
  sectionTitle: string;
  type: QuestionType;
  difficulty: Difficulty;
  question: string;
  answer: string;
  explanation: string;
  tags: string[];
}

export interface ExamSession {
  version: number;
  id: string;
  seed: number;
  blueprint: ExamBlueprint;
  questions: ExamQuestion[];
  startedAt: number;
  endsAt: number;
  /** Question id → the learner's own typed answer (or code). */
  answers: Record<string, string>;
  /** Question ids marked for review during the exam. */
  flags: string[];
  /** Question id → learner's self-grade. `undefined` means not graded yet. */
  grades: Record<string, boolean>;
  index: number;
  phase: ExamPhase;
  /** Set when the paper was submitted early because the clock ran out. */
  timedOut?: boolean;
  /** Timestamp of the atomic write into real state (attempts/mistakes/review/xp). */
  savedAt?: number;
  /** What that write actually granted, kept so the report stays truthful after a reload. */
  savedXp?: number;
  savedMistakes?: number;
}

export interface ExamPool {
  sectionId: string;
  sectionTitle: string;
  questions: QuestionRecord[];
}

/* --------------------------------- random --------------------------------- */

/** Deterministic 32-bit PRNG (mulberry32) — same seed always yields the same paper. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fresh seed for a new paper (stored in the session so it can be replayed). */
export function makeSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

/** Fisher–Yates with the supplied PRNG — stable for a given seed. */
export function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* -------------------------------- selection ------------------------------- */

export const matchesFocus = (q: QuestionRecord, focus: ExamFocus) => FOCUS_TYPES[focus].includes(q.type);

/** Questions from a pool that the current blueprint could even draw from. */
export function eligible(pool: ExamPool, bp: ExamBlueprint): QuestionRecord[] {
  return pool.questions.filter((q) => {
    if (q.status !== 'PUBLISHED') return false;
    if (!matchesFocus(q, bp.focus)) return false;
    if (bp.difficulty !== 'all' && q.difficulty !== bp.difficulty) return false;
    return true;
  });
}

/** How many questions the blueprint can draw right now — shown BEFORE the exam starts. */
export function availableCount(pools: ExamPool[], bp: ExamBlueprint): number {
  const seen = new Set<string>();
  let n = 0;
  for (const pool of pools) {
    for (const q of eligible(pool, bp)) {
      if (seen.has(q.id)) continue;
      seen.add(q.id);
      n++;
    }
  }
  return n;
}

/**
 * Build the paper. Sections are shuffled and then drawn round-robin, so a mixed
 * exam spreads across the syllabus instead of emptying one bank first. Within a
 * section, unseen questions come first (the learner's own attempt history
 * decides what counts as unseen — never a random substitute).
 *
 * Returns fewer than `size` questions when the filters genuinely cannot fill the
 * paper — it never invents or duplicates a question to pad the count.
 */
export function selectExamQuestions(
  pools: ExamPool[],
  bp: ExamBlueprint,
  attempts: Record<string, Attempt>,
  seed: number,
): ExamQuestion[] {
  const rng = mulberry32(seed);
  const wasGraded = (id: string) => attempts[`qb:${id}`] !== undefined;

  const decks = shuffle(pools, rng).map((pool) => {
    const all = eligible(pool, bp);
    const fresh = shuffle(all.filter((q) => !wasGraded(q.id)), rng);
    const seen = shuffle(all.filter((q) => wasGraded(q.id)), rng);
    const ordered = bp.unseenFirst ? [...fresh, ...seen] : shuffle(all, rng);
    return { pool, ordered };
  }).filter((d) => d.ordered.length > 0);

  const picked: ExamQuestion[] = [];
  const usedIds = new Set<string>();
  let guard = 0;

  while (picked.length < bp.size && decks.length && guard < 10000) {
    guard++;
    let drewThisRound = false;
    for (const deck of decks) {
      if (picked.length >= bp.size) break;
      let next: QuestionRecord | undefined;
      while (deck.ordered.length) {
        const cand = deck.ordered.shift()!;
        if (!usedIds.has(cand.id)) { next = cand; break; }
      }
      if (!next) continue;
      drewThisRound = true;
      usedIds.add(next.id);
      picked.push({
        id: next.id,
        sectionId: deck.pool.sectionId,
        sectionTitle: deck.pool.sectionTitle,
        type: next.type,
        difficulty: next.difficulty,
        question: next.question,
        answer: next.answer,
        explanation: next.explanation,
        tags: next.tags ?? [],
      });
    }
    if (!drewThisRound) break;   // every deck exhausted
  }

  return picked;
}

/* --------------------------------- clock ---------------------------------- */

export function remainingMs(session: ExamSession, now = Date.now()): number {
  return Math.max(0, session.endsAt - now);
}

export function isExpired(session: ExamSession, now = Date.now()): boolean {
  return session.phase === 'running' && remainingMs(session, now) <= 0;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function minutesUsed(session: ExamSession, now = Date.now()): number {
  return Math.max(0, Math.round((Math.min(now, session.endsAt) - session.startedAt) / 60000));
}

/* -------------------------------- scoring --------------------------------- */

export interface SectionScore {
  sectionId: string;
  title: string;
  total: number;
  correct: number;
  wrong: number;
  ungraded: number;
}

export interface ExamSummary {
  total: number;
  graded: number;
  correct: number;
  wrong: number;
  ungraded: number;
  /** Percentage over GRADED questions only; null when nothing is graded yet. */
  pct: number | null;
  answered: number;
  flagged: number;
  bySection: SectionScore[];
  byType: Record<string, { total: number; correct: number; wrong: number }>;
}

/**
 * Aggregate the learner's own grades. `pct` is deliberately null (never 0) until
 * at least one question is graded — the app must not present an unearned score.
 */
export function summariseExam(session: ExamSession): ExamSummary {
  const bySection = new Map<string, SectionScore>();
  const byType: ExamSummary['byType'] = {};
  let correct = 0, wrong = 0, ungraded = 0, answered = 0;

  for (const q of session.questions) {
    const g = session.grades[q.id];
    const sec = bySection.get(q.sectionId) ?? {
      sectionId: q.sectionId, title: q.sectionTitle, total: 0, correct: 0, wrong: 0, ungraded: 0,
    };
    const t = byType[q.type] ?? (byType[q.type] = { total: 0, correct: 0, wrong: 0 });
    sec.total++; t.total++;
    if ((session.answers[q.id] ?? '').trim()) answered++;
    if (g === true) { correct++; sec.correct++; t.correct++; }
    else if (g === false) { wrong++; sec.wrong++; t.wrong++; }
    else { ungraded++; sec.ungraded++; }
    bySection.set(q.sectionId, sec);
  }

  const graded = correct + wrong;
  return {
    total: session.questions.length,
    graded, correct, wrong, ungraded,
    pct: graded === 0 ? null : Math.round((correct / graded) * 100),
    answered,
    flagged: session.flags.length,
    bySection: [...bySection.values()].sort((a, b) => b.wrong - a.wrong || a.title.localeCompare(b.title)),
    byType,
  };
}

/* ------------------------------ state writes ------------------------------ */

export interface ExamWriteEntry {
  questionId: string;
  sectionId: string;
  correct: boolean;
  /** What the learner typed, stored on the attempt for later review. */
  answer: string;
  tries: number;
  mistake?: Omit<Mistake, 'id' | 'date' | 'attempts' | 'fixed'>;
  reviewReset: boolean;
}

export interface ExamWrites {
  entries: ExamWriteEntry[];
  xp: number;
  correct: number;
  wrong: number;
}

export const XP_PER_CORRECT = 2;

/**
 * Turn a graded paper into the exact state changes it earns — and nothing more.
 *
 *  · ungraded questions produce NO entry at all (never counted as wrong);
 *  · XP is granted only the first time a question is answered correctly, the same
 *    policy the Question Bank uses, so the two surfaces cannot double-pay;
 *  · wrong answers carry a mistake record and reset that section's spaced-repetition
 *    level, which is what puts it back in the review queue.
 * Pure: pass the attempt map in, get the writes out. The caller applies them in one
 * atomic store write, so a half-saved exam can never happen.
 */
export function buildExamWrites(
  session: ExamSession,
  attempts: Record<string, Attempt>,
  now = Date.now(),
): ExamWrites {
  const entries: ExamWriteEntry[] = [];
  let xp = 0, correct = 0, wrong = 0;

  for (const q of session.questions) {
    const grade = session.grades[q.id];
    if (grade === undefined) continue;

    const prev = attempts[`qb:${q.id}`];
    const typed = (session.answers[q.id] ?? '').trim();

    if (grade) {
      correct++;
      if (!prev?.done) xp += XP_PER_CORRECT;
    } else {
      wrong++;
    }

    entries.push({
      questionId: q.id,
      sectionId: q.sectionId,
      correct: grade,
      answer: typed.slice(0, 400),
      tries: (prev?.tries ?? 0) + 1,
      mistake: grade ? undefined : {
        section: q.sectionId,
        topic: q.tags[0] ?? q.type,
        question: q.question.slice(0, 140),
        myAnswer: typed ? typed.slice(0, 220) : '(exam me khaali chhoda)',
        correct: q.answer.slice(0, 220),
        type: mistakeTypeForType(q.type),
        // Provenance so the offline coach knows this failure came from a bank
        // question under exam pressure, not from a coding-lab traceback.
        source: 'exam',
      },
      reviewReset: !grade,
    });
  }

  return { entries, xp, correct, wrong };
}

/** Mistake-tracker bucket for a bank question type (mirrors the Question Bank rule). */
export function mistakeTypeForType(t: QuestionType): 'code' | 'debug' | 'logic' | 'interview' {
  if (t === 'debug') return 'debug';
  if (t === 'logic') return 'logic';
  if (t === 'coding' || t === 'solved') return 'code';
  return 'interview';
}

/* ------------------------------- summaries -------------------------------- */

/** Share of the paper that must be graded before results can be filed. */
export function readiness(summary: ExamSummary): { ready: boolean; label: string } {
  if (summary.total === 0) return { ready: false, label: 'Koi question nahi mila — filters badlo.' };
  if (summary.graded === 0) return { ready: false, label: 'Abhi kuch grade nahi hua.' };
  if (summary.ungraded > 0) return { ready: true, label: `${summary.ungraded} question bina grade — wo neutral rahenge.` };
  return { ready: true, label: 'Saare questions grade ho gaye.' };
}

export function describeBlueprint(bp: ExamBlueprint, sectionTitle?: string): string {
  const scope = bp.scope === 'all' ? 'all sections' : bp.scope === 'complete' ? 'complete sections only' : (sectionTitle ?? bp.sectionId ?? '—');
  const diff = bp.difficulty === 'all' ? 'any difficulty' : bp.difficulty;
  return `${bp.size} questions · ${bp.minutes} min · ${EXAM_FOCUS_LABEL[bp.focus]} · ${diff} · ${scope}`;
}
