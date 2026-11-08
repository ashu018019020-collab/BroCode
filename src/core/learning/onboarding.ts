/**
 * Where a new learner starts, and the ONLY rule that decides it.
 *
 * Four questions — name, goal, level, daily time — are everything onboarding collects, and the
 * answer to "what do I open first?" is derived from two of them instead of being hardcoded. The
 * page renders `startPlan()` and navigates to `plan.route`; no screen keeps a second copy of the
 * mapping, so a step renumbering in `roadmap.ts` (or a course moving in `content/courses/`) is a
 * test failure here instead of a lesson path that 404s.
 *
 * Pure on purpose: value imports are `roadmap` only (itself pure), no React, no store, no fetch, so
 * `scripts/tests/onboarding.test.mjs` loads it directly and checks every mapping against the real
 * published course registry.
 */

import { STEPS, type RoadmapStep } from './roadmap';

/** The five fields of study the learner picks from, broadest first. */
export const GOALS = [
  'Programming & Software Development',
  'AI & Machine Learning',
  'Data Science & Analytics',
  'Web Development',
  'GenAI Engineering',
] as const;

export type Goal = (typeof GOALS)[number];

export const LEVELS = ['Beginner', 'Intermediate', 'Advanced'] as const;

export type Level = (typeof LEVELS)[number];

/** The four daily-time choices, in minutes. 120 renders as "2+ hours". */
export const DAILY_MINUTES = [30, 60, 90, 120] as const;

/**
 * What a SKIPPED onboarding stores.
 *
 * Skipping must never leave a profile that the rest of the app cannot read — Progress divides by
 * `dailyMinutes`, Career prints `goal`, the Dashboard greets `name` — so the defaults are the
 * first goal, the first level and an hour a day. Nothing is guessed per learner: a skipped
 * profile is the same explicit choice for everyone, and Settings edits all four afterwards.
 */
export const PROFILE_DEFAULTS = {
  goal: GOALS[0],
  level: LEVELS[0],
  dailyMinutes: 60,
} as const;

/**
 * Goal → the course that teaches it, and the step an INTERMEDIATE learner starts on.
 *
 * Authored, not inferred: "Web Development" has no course of its own, and its nearest home really
 * is the build/production course (steps 29–34), while "Data Science" starts at statistics rather
 * than at Python because the roadmap already assumes programming by then. `slug` is checked against
 * `public/generated/courses/index.json` and `step` against that course's own `steps` list.
 */
interface GoalPath {
  goal: Goal;
  slug: string;
  step: number;
}

export const GOAL_PATHS: GoalPath[] = [
  { goal: 'Programming & Software Development', slug: 'python', step: 4 },
  { goal: 'AI & Machine Learning', slug: 'ml-nlp', step: 13 },
  { goal: 'Data Science & Analytics', slug: 'statistics-data-analysis', step: 2 },
  { goal: 'Web Development', slug: 'build-production', step: 29 },
  { goal: 'GenAI Engineering', slug: 'generative-ai', step: 18 },
];

export interface StartPlan {
  /** Roadmap step number, 1…36. */
  no: number;
  /** The course that owns that step — the first URL segment. */
  slug: string;
  /** The step's authored title, quoted as-is so the recommendation promises real content. */
  title: string;
  /** `/course/:slug/:step`, the route the page navigates to. */
  route: string;
  /** One sentence explaining why THIS step, in the learner's own answers. */
  why: string;
}

const entryCourse = 'ai-career-foundations';

const stepAt = (no: number): RoadmapStep => STEPS.find((s) => s.no === no) ?? STEPS[0];

/**
 * The step a learner should open, from goal + level.
 *
 * Beginner always starts at step 1 — the role map that explains the 36 steps — because starting a
 * beginner mid-course is exactly the failure the plan names. Intermediate starts at the goal's own
 * course; Advanced starts one step later, past its introduction. An unknown goal or level falls
 * back to the first goal's path rather than throwing: a stored profile can carry an older label.
 */
export function startPlan(goal: string, level: string): StartPlan {
  const path = GOAL_PATHS.find((p) => p.goal === goal) ?? GOAL_PATHS[0];
  const pathStep = stepAt(path.step);

  if (level === 'Beginner' || level === undefined) {
    const first = stepAt(1);
    return {
      no: first.no,
      slug: entryCourse,
      title: first.title,
      route: `/course/${entryCourse}/${first.no}`,
      why: `Start at step ${first.no}: it maps the role and the whole plan. ${pathStep.title} (${goal || path.goal}) begins at step ${pathStep.no}.`,
    };
  }

  const advanced = level === 'Advanced';
  const step = stepAt(advanced ? Math.min(path.step + 1, 36) : path.step);
  return {
    no: step.no,
    slug: path.slug,
    title: step.title,
    route: `/course/${path.slug}/${step.no}`,
    why: advanced
      ? `Step ${step.no} — ${step.title} — is past the introduction, so an advanced learner starts here in ${path.goal}.`
      : `Step ${step.no} — ${step.title} — is where ${path.goal} starts; the intro before it is optional.`,
  };
}
