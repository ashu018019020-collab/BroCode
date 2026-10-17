/**
 * Answer accuracy — one honest percentage per answer, and per surface.
 *
 * The app has always known *whether* an answer was right (`state.attempts[...].done`, the mastery
 * gate) and, on some surfaces, a real 0–100 score (the rubric score in Interview Mode, an exam
 * part, a notebook run). What it never had was a single place that answers "kitna sahi hai?" in
 * percent — so every surface either showed a bare ✓/✗ or invented its own idea of a score.
 *
 * Three rules keep this module honest:
 *
 *   1. NOTHING IS INVENTED. `attemptPct` returns the stored `score` when a surface measured one;
 *      otherwise a self-grade is 100 or 0; otherwise `null`. `null` means "not answered yet" and a
 *      surface must print a dash — never a 0% that reads as a failure the learner never had.
 *   2. THE GATE AND THE PERCENTAGE ARE DIFFERENT THINGS. `done` still decides mastery and XP; the
 *      percentage is feedback. A rubric of 60% on an answer the learner called "sahi" is not a
 *      contradiction, it is information — and every label here says which one it is.
 *   3. THE RUBRIC IS DETERMINISTIC AND OFFLINE. `engine/evaluate.ts` keyword rubrics only — the
 *      same ones Interview Mode, the mock rounds and the final paper already score with, so an
 *      answer cannot score 74% here and 40% there.
 *
 * Coverage — "was it done at all", where a graded-wrong answer still counts — is `engine/coverage.ts`.
 *
 * Pure: the only imports are the rubric engine and the key owners in `engine/keys.ts`.
 */
import type { AppState, Attempt } from '../../types';
import { keywordScore, questionRubric } from './evaluate';
import { BANK_ATTEMPT_PREFIX, LAB_ATTEMPT_PREFIX, NOTEBOOK_PREFIX } from '../platform/keys';

export interface Rubric {
  pct: number;
  /** Rubric groups the answer did not hit — the key terms worth adding next time. */
  missing: string[];
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Is this an answer at all, or just a stub the learner typed to get past the box?
 *
 * Two real words of 2+ characters. This matters because "haan", "pata nahi" and "ok" otherwise earn
 * a rubric score of 0% — a failure verdict on something nobody attempted to answer. Measured before
 * the guard existed: `rubricFor('haan', MODEL)` returned `{pct: 0, missing: [all five groups]}`. The
 * surfaces all fall back to the learner's own self-grade (100/0) when this returns null, so nothing
 * is lost — the verdict the learner earned is kept, the invented one is not.
 */
export const isAnswer = (s: string) => (s.match(/[A-Za-z0-9_]{2,}/g) ?? []).length >= 2;

/**
 * The rubric score of a written answer against the model answer.
 *
 * Returns `null` — never a score — when there is nothing to measure: a stub, an empty answer, a model
 * answer too short to build a rubric from, or a method-only line (the V15 document's checkpoint
 * prompts carry a method, not a model answer, and grading "answer verbally first…" against a
 * keyword rubric would be noise).
 */
export function rubricFor(mine: string, model: string): Rubric | null {
  const wrote = (mine ?? '').trim();
  const answer = (model ?? '').trim();
  if (!isAnswer(wrote) || answer.length < 10) return null;
  const keywords = questionRubric(answer);
  if (!keywords.length) return null;
  const { pct, missing } = keywordScore(wrote, keywords);
  return { pct: clamp(pct), missing };
}

/** The percentage one stored attempt represents, or null when nothing was measured. */
export function attemptPct(a?: Attempt): number | null {
  if (!a) return null;
  if (typeof a.score === 'number' && Number.isFinite(a.score)) return clamp(a.score);
  if (a.done === true) return 100;
  if (a.done === false) return 0;
  return null;
}

export interface Accuracy {
  /** Answers that exist (written or graded) — the "kitne kiye" figure. */
  answered: number;
  /** Answers the learner actually graded (done true/false) — the denominator for `pct`. */
  graded: number;
  correct: number;
  /** correct / graded, or null when nothing was graded yet. */
  pct: number | null;
  /** Mean of the per-answer percentages, or null when none were measured. */
  avg: number | null;
}

const NONE: Accuracy = { answered: 0, graded: 0, correct: 0, pct: null, avg: null };

/** A run counts as correct at 50%+: notebook cells store 100 or 0, so this is exact, not arbitrary. */
const PASS = 50;

/**
 * Collapse stored attempts into counts.
 *
 * `verdictByScore` exists because **`done` does not mean the same thing in every family**, and
 * assuming it did produced a wrong number. Bank and interview answers write `done` as a VERDICT
 * (the learner's sahi/galat, or Interview Mode's `pct >= 70`). Notebook cells write `done: true` for
 * *every* run — a cell that raised is still "run" — so reading that as correct made a notebook of
 * failing cells report 100%. Measured before the fix: `notebookAccuracy` on `{done: true, score: 0}`
 * returned `pct: 100`. Where `done` means "ran", the run outcome decides instead.
 */
export function tally(attempts: Attempt[], verdictByScore = false): Accuracy {
  if (!attempts.length) return { ...NONE };
  let graded = 0;
  let correct = 0;
  let sum = 0;
  let scored = 0;
  for (const a of attempts) {
    const p = attemptPct(a);
    if (verdictByScore) {
      if (p !== null) { graded += 1; if (p >= PASS) correct += 1; }
    } else if (a.done === true || a.done === false) {
      graded += 1;
      if (a.done === true) correct += 1;
    }
    if (p !== null) { sum += p; scored += 1; }
  }
  return {
    answered: attempts.length,
    graded,
    correct,
    pct: graded ? clamp((100 * correct) / graded) : null,
    avg: scored ? clamp(sum / scored) : null,
  };
}

/** Attempts under a stored-key family, in insertion order. */
function family(state: AppState, prefix: string): Attempt[] {
  const out: Attempt[] = [];
  for (const [key, a] of Object.entries(state.attempts)) if (key.startsWith(prefix)) out.push(a);
  return out;
}

/**
 * Accuracy over the self-graded bank answers (`qb:`), optionally for one section.
 * A bank question id IS `<sectionId>:<type>:<i>`, so the section filter is the key prefix — the
 * same id the Question Bank, every in-lesson stage panel and the exam import all write.
 */
export function bankAccuracy(state: AppState, sectionId?: string): Accuracy {
  return tally(family(state, sectionId ? `${BANK_ATTEMPT_PREFIX}${sectionId}:` : BANK_ATTEMPT_PREFIX));
}

/** Per-section accuracy for every section that has at least one bank answer. */
export function bankAccuracyBySection(state: AppState): Record<string, Accuracy> {
  const groups: Record<string, Attempt[]> = {};
  for (const [key, a] of Object.entries(state.attempts)) {
    if (!key.startsWith(BANK_ATTEMPT_PREFIX)) continue;
    const sid = key.slice(BANK_ATTEMPT_PREFIX.length).split(':')[0];
    if (!sid) continue;
    (groups[sid] ??= []).push(a);
  }
  const out: Record<string, Accuracy> = {};
  for (const [sid, list] of Object.entries(groups)) out[sid] = tally(list);
  return out;
}

/**
 * Accuracy of one notebook's cells: a cell counts as correct when its last run succeeded.
 * Cells are the second measured family — `nb:<slug>:<cellId>` is written by every notebook in the
 * app (lessons, the lab, question-bank practice), so this is real signal, not a proxy.
 *
 * `verdictByScore` because a cell's `done: true` only means "this cell has been run" (the notebook
 * toolbar counts exactly that way, and a raise still counts), so the 100/0 run score is the verdict.
 */
export function notebookAccuracy(state: AppState, slug: string): Accuracy {
  return tally(family(state, `${NOTEBOOK_PREFIX}${slug}:`), true);
}

/**
 * Standalone Interview Mode's own records (`lab:interview:<hash of the question>`).
 *
 * Its questions come from the curriculum and the playbook rather than from a bank, so it cannot use
 * the `qb:` family — but it does keep a real score per question, and that makes interview practice
 * the third measured family alongside bank answers and notebook cells.
 */
export function interviewAccuracy(state: AppState): Accuracy {
  return tally(family(state, `${LAB_ATTEMPT_PREFIX}interview:`));
}

/** Percentages print as `—` when nothing was measured, so 0% always means a real 0%. */
export const pctText = (p: number | null): string => (p === null ? '—' : `${p}%`);

/**
 * One line for a surface's header: "32/41 correct · 78%" — the counts, then the percentage.
 * Kept here so every surface phrases the same number the same way.
 */
export function accuracyLine(a: Accuracy): string {
  if (!a.answered) return 'No answers yet';
  if (a.pct === null) return `${a.answered} answers written — not graded yet`;
  return `${a.correct}/${a.graded} correct · ${a.pct}%`;
}
