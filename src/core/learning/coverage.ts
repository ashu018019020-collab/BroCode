/**
 * "Was it done at all?" — coverage, the question next to "kitna sahi hai?".
 *
 * `engine/accuracy.ts` answers the second: a percentage, or `null` when nothing was measured. This
 * module answers the first, where a graded-WRONG answer counts as work done and still scores 0%.
 * They are separate on purpose — the bug this replaces was one predicate meaning both things, which
 * is how a learner with hundreds of answers read "0/13865 practice ho chuke".
 *
 * ONE OWNER for the state predicates and the counts below: the /questions card, the Playbook band and
 * the "next target" ladder each ask one of these questions, and none of them re-derives an answer.
 * Pure, so the tests load it directly — the data modules that render it cannot be (see AGENTS.md).
 */
import { attemptPct } from '../assessment/accuracy';
import {
  BANK_ATTEMPT_PREFIX, NOTEBOOK_PREFIX, STAGE_ATTEMPT_PREFIX,
  bankAttempt, labFamily, notebookFamily,
} from '../platform/keys';
import type { Attempt } from '../../types';

type Attempts = Record<string, Attempt>;

/**
 * Count the records of one key family — the ONE loop behind every family tally in the app.
 *
 * `keep` decides whether a record counts; the default counts any record at all, because a key exists
 * only once something was written under it. The family's prefix is never spelled by the caller: it
 * comes from `keys.ts` (or from a helper there that builds it), which is what stops the same family
 * being counted twice with two different rules.
 */
function familyCount(attempts: Attempts, prefix: string, keep: (a?: Attempt) => boolean = () => true): number {
  let n = 0;
  for (const [key, a] of Object.entries(attempts)) {
    if (key.startsWith(prefix) && keep(a)) n += 1;
  }
  return n;
}

/** `done` as a VERDICT (pass/fail), which is what the gate families write. Never what a notebook writes. */
const verdict = (a?: Attempt): boolean => a?.done === true;

/** Written out in words — the one clause both predicates share: a method answer is written, not scored. */
const written = (a?: Attempt): boolean => (a?.answer ?? '').trim().length > 0;

/** Graded either way, scored, or written out. Opening a question is not coverage. */
export const isPractised = (a?: Attempt): boolean => attemptPct(a) !== null || written(a);

/**
 * Graded CORRECT, or written out — what the "next target" ladder treats as dealt with. A FAILED item
 * is deliberately not cleared, so its section stays recommended instead of being skipped by the
 * learner who needs it most, while the counts above still accept the attempt as practised.
 */
export const isCleared = (a?: Attempt): boolean => a?.done === true || written(a);

/** Has this bank item been answered? The stored key comes from keys.ts, not from the caller. */
export function bankTouched(attempts: Attempts, id: string): boolean {
  return isPractised(attempts[bankAttempt(id)]);
}

/** Has this bank item been cleared — graded correct, or answered in writing? */
export function bankCleared(attempts: Attempts, id: string): boolean {
  return isCleared(attempts[bankAttempt(id)]);
}

/** How many bank answers exist. The bank family's prefix comes from keys.ts, not the caller, so this
 * cannot be aimed at a family where `done` means something else — notebooks write it per run. */
export function bankPractised(attempts: Attempts): number {
  return familyCount(attempts, BANK_ATTEMPT_PREFIX, isPractised);
}

/**
 * The ids of bank questions graded CORRECT — the set a drill uses to skip what is already mastered.
 *
 * Ids rather than a count, because that is what the caller needs: `engine/tutor.ts` picks the next
 * bank question for a failed section and must skip these. The prefix comes from keys.ts here too — a
 * drill that spells the family itself can silently stop skipping, and the learner is handed back a
 * question they already answered. Written-but-ungraded is NOT correct: `done` is the mastery verdict,
 * not "this record has text".
 */
export function bankCorrectIds(attempts: Attempts): Set<string> {
  const out = new Set<string>();
  for (const [key, a] of Object.entries(attempts)) {
    if (!key.startsWith(BANK_ATTEMPT_PREFIX) || !verdict(a)) continue;
    out.add(key.slice(BANK_ATTEMPT_PREFIX.length));
  }
  return out;
}

/* --------------------------------- the other families --------------------------------
 * Every count below used to live in the surface that printed it: three copies of the mock tally
 * (dashboard, job prep, achievements), two of the coding tally, plus an inline `nb:` /
 * `lab:interview:` / `st:` scan wherever a page needed one. Same question, four spellings — and not
 * one of the page-side copies was reachable by a test.
 */

/**
 * Mock interview rounds PASSED. A round writes `done` as the pass verdict (60% and up), so a round
 * that was attempted and failed is stored with `done: false` and deliberately not counted here.
 */
export const mockPassed = (attempts: Attempts): number => familyCount(attempts, labFamily('mock'), verdict);

/**
 * Notebook cells that RAN — never cells that passed.
 *
 * This is the trap the whole module exists for: a cell writes `done: true` for EVERY run, so a raise
 * still leaves `done` behind. Reading this number as "correct" once reported a notebook of failing
 * cells as 100%.
 */
export const notebookCellsRun = (attempts: Attempts): number => familyCount(attempts, NOTEBOOK_PREFIX, verdict);

/** Cells of ONE notebook that ran. Keyed per file, so a library of notebooks cannot pool its cells. */
export const notebookCellsRunFor = (attempts: Attempts, file: string): number => familyCount(attempts, notebookFamily(file));

/** Interview-lab answers saved. The record exists as soon as an answer was written, graded or not. */
export const interviewLabsAnswered = (attempts: Attempts): number => familyCount(attempts, labFamily('interview'));

/** Stage and item records across every section — "how many stage activities happened", nothing finer. */
export const stageRecords = (attempts: Attempts): number => familyCount(attempts, STAGE_ATTEMPT_PREFIX);

/**
 * Every completed record, whatever its family. Deliberately cross-family, and honest about it: it
 * answers one question — did anything at all get completed — for the first-step badge. It must not be
 * read as mastery; the families disagree about what `done` means, which is why the counts above exist.
 */
export function doneRecords(attempts: Attempts): number {
  let n = 0;
  for (const a of Object.values(attempts)) if (verdict(a)) n += 1;
  return n;
}
