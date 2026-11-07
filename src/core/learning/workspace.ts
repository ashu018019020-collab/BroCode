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
  type CourseCard,
  type StepMeasure,
} from './courses';

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
