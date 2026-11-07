/**
 * The learner workspace's ONE decision: which course, which step, how far.
 *
 * `/workspace` exists because the dashboard answers "how am I doing overall" and the course page
 * answers "what is in this course", while a learner who has been away needs a third thing: "where
 * was I, and what do I open next". That question is answerable from `index.json` alone, and this
 * module is the answer — pure, so it can be driven with fixtures.
 *
 * Three rules, each inherited rather than re-invented:
 *
 *   · the course is `activeCourse` (started, unfinished, most section mastery); a learner who has
 *     started nothing gets the first course in the plan, flagged `started: false` so the screen can
 *     say "start here" instead of pretending it is their course;
 *   · mastery is `sectionAvg`, the same measure the card, the course page and the dashboard print;
 *   · the step is `nextStep` over CARD-ONLY measures. A course file is up to 1.5 MB and this page
 *     never fetches one, so when the card has no denominator for a step `certain` is false and the
 *     screen sends the learner to the course page rather than naming a step it cannot prove.
 *
 * Pure on purpose: no React, no store, no fetch (the same rule `courses.ts` states).
 */

import {
  activeCourse,
  cardMeasures,
  nextStep,
  sectionAvg,
  sectionsClear,
  stepsOf,
  type CourseCard,
  type StepMeasure,
} from './courses';
import { courseRank, nextCourse } from './course-levels';

export interface WorkspaceTarget {
  /** null only when nothing is published. */
  card: CourseCard | null;
  /** The step to open: the first step that still has a denominator, else the course's first step. */
  step: number;
  /**
   * True when the card's own measures can name an incomplete step. False covers both "everything
   * is clear" and "this step's denominator lives in the course file" — the screen must not claim a
   * step it cannot back with a real record.
   */
  certain: boolean;
  /** The course is one the learner has actually started (not just the first in the plan). */
  started: boolean;
  /** Course mastery, or null for a course whose card owns no sections. */
  pct: number | null;
  stepsClear: number;
  stepsTotal: number;
  /** Sections of THIS course that are clear, and how many it owns (0 for a section-less course). */
  sectionsCleared: number;
  sectionsTotal: number;
}

export function workspaceTarget(cards: CourseCard[], pctOf: (sid: string) => number): WorkspaceTarget {
  const active = activeCourse(cards, pctOf);
  const card = active ?? cards[0] ?? null;
  if (!card) {
    return {
      card: null, step: 1, certain: false, started: false, pct: null,
      stepsClear: 0, stepsTotal: 0, sectionsCleared: 0, sectionsTotal: 0,
    };
  }

  const measures = cardMeasures(card, pctOf);
  const list = [...measures.values()];
  const step = nextStep(card, measures);
  const measure: StepMeasure | undefined = measures.get(step);

  return {
    card,
    step,
    certain: !!measure && measure.pct !== null && measure.status !== 'clear',
    started: !!active,
    pct: sectionAvg(card, pctOf),
    stepsClear: list.filter((m) => m.status === 'clear').length,
    stepsTotal: list.length,
    sectionsCleared: sectionsClear(card, pctOf),
    sectionsTotal: Object.keys(card.sections ?? {}).length,
  };
}

/* ------------------------- what comes AFTER that step ---------------------- */

/**
 * The workspace's second answer: the ONE thing to open once the step on screen is clear.
 *
 * Same rule as `nextStep`, read only from the steps AFTER the current one — so the block can never
 * repeat the step the page is already telling the learner to open. A step the card can prove is
 * clear is skipped (the learner does not need it again), and a step with no denominator on the card
 * is kept: it is still the next thing in the course, and this page may not fetch a course file to
 * know more, so `certain` says the card could not prove it either way.
 *
 * When nothing is left in this course, the journey's own ordering names the next course — the same
 * `nextCourse` rule `/courses` uses, restricted to the courses placed AFTER this one. Nothing here
 * creates a record, a plan or a ranking: every input is a card, a section percentage or the
 * authored placement registry.
 */
export interface WorkspaceNextAction {
  /** 'step' = another step of the same course; 'course' = the course is done; 'done' = nothing left. */
  kind: 'step' | 'course' | 'done';
  /** The step to open, when `kind === 'step'`; 0 otherwise. */
  step: number;
  /** The course the action belongs to; null only when nothing is left. */
  course: CourseCard | null;
  /** True when a real record backs the action (a measured step, or a placed course). */
  certain: boolean;
}

export function workspaceNextAction(
  cards: CourseCard[],
  pctOf: (sid: string) => number,
  target: WorkspaceTarget,
): WorkspaceNextAction {
  const card = target.card;
  if (!card) return { kind: 'done', step: 0, course: null, certain: false };

  const measures = cardMeasures(card, pctOf);
  const after = stepsOf(card).filter((n) => n > target.step);
  const step = after.find((n) => {
    const m = measures.get(n);
    return !m || m.pct === null || m.status !== 'clear';
  });

  if (typeof step === 'number') {
    const m = measures.get(step);
    return { kind: 'step', step, course: card, certain: !!m && m.pct !== null };
  }

  const later = cards.filter((c) => courseRank(c.slug) > courseRank(card.slug));
  const next = nextCourse(later, (c) => sectionAvg(c, pctOf));
  if (next) return { kind: 'course', step: 0, course: next, certain: true };
  return { kind: 'done', step: 0, course: null, certain: true };
}
