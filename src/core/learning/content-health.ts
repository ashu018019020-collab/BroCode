/**
 * THE OWNER'S CONTENT HEALTH — gaps in the published registries, derived from what the app loads.
 *
 * The owner already has `/admin` (accounts, custom course cards) and three CLI audits
 * (`course:audit`, `curriculum:validate`, `questions:manifest`). What was missing was a screen that
 * tells an owner, in one place, what the catalog currently publishes and which real gaps it has —
 * without a shell. This module is that screen's whole rule set, and it only reads REGISTRIES the
 * browser already has: the course index, the curriculum sections, the question-bank manifest, the
 * notebook manifest and the owner card rows.
 *
 * The honesty rules are the same ones every other engine follows:
 *
 *   1. A finding is a FACT about a registry, never a vibe. "s07 has no coding tasks" is countable;
 *      "content feels thin" is not, so it does not exist here.
 *   2. NULL IS NOT ZERO. A manifest that has not loaded is `null` in the input, and the finding says
 *      "not loaded", never "0 questions" — a page that reports zero for an unloaded file is lying.
 *   3. NO NETWORK, NO SHELL. This cannot run `npm run course:audit`; it checks the published output,
 *      which is the same thing a learner's browser sees.
 *
 * Pure: no React, no store.
 */

export type Severity = 'high' | 'medium' | 'low';

export interface CourseHealthInput {
  slug: string;
  name: string;
  steps: number;
  sections: number;
  objectives: number;
  prerequisites: number;
  minutes: number;
}

export interface SectionHealthInput {
  id: string;
  no: number;
  title: string;
  interview: number;
  coding: number;
  logic: number;
  checkpoint: number;
  mini: boolean;
  builds: number;
  /** Published questions for this section, or `null` before the bank manifest loads. */
  bank: number | null;
}

export interface OwnerCardHealthInput {
  slug: string;
  name: string;
  hidden: boolean;
}

export interface ContentHealthInput {
  courses: CourseHealthInput[];
  sections: SectionHealthInput[];
  /** The roadmap's own step count (`STEPS.length`) — the plan, not a guess. */
  stepsExpected: number;
  bank: { total: number; sections: number } | null;
  notebooks: number | null;
  /** `null` when the owner cards could not be read (offline / unconfigured). */
  ownerCards: OwnerCardHealthInput[] | null;
}

export interface HealthFinding {
  id: string;
  severity: Severity;
  label: string;
  /** The real numbers the finding is about, so an owner can verify it. */
  detail: string;
  /** Where the fix lives. */
  to: string;
}

export interface PublishingStatus {
  courses: number;
  steps: number;
  stepsExpected: number;
  sections: number;
  bankQuestions: number | null;
  bankSections: number | null;
  notebooks: number | null;
  ownerVisible: number | null;
  ownerHidden: number | null;
}

export interface ContentHealth {
  publishing: PublishingStatus;
  findings: HealthFinding[];
  /** The same findings, most urgent first. */
  attention: HealthFinding[];
  counts: Record<Severity, number>;
}

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** `s01` in a finding, so an id a script printed is recognisable on screen. */
const sid = (no: number): string => `s${String(no).padStart(2, '0')}`;

/** The first few names plus a count, so one finding about 8 sections stays readable. */
function names(list: string[], max = 3): string {
  return list.length <= max ? list.join(', ') : `${list.slice(0, max).join(', ')} +${list.length - max} more`;
}

/**
 * Every rule, in one pass. Each finding carries the counts it was derived from; none is emitted
 * from an empty list, and a `null` manifest produces a "not loaded" finding instead of a zero.
 */
export function contentHealth(input: ContentHealthInput): ContentHealth {
  const courses = input.courses ?? [];
  const sections = input.sections ?? [];
  const findings: HealthFinding[] = [];

  const steps = courses.reduce((sum, course) => sum + course.steps, 0);

  /* ------------------------------- the plan ------------------------------- */

  if (steps !== input.stepsExpected) {
    findings.push({
      id: 'steps',
      severity: 'high',
      label: 'Step coverage does not match the plan',
      detail: `${steps} steps are published across ${courses.length} courses; the roadmap plans ${input.stepsExpected}.`,
      to: '/courses',
    });
  }

  const stepLess = courses.filter((course) => course.steps === 0);
  if (stepLess.length) {
    findings.push({
      id: 'courses-no-steps',
      severity: 'high',
      label: 'Courses with no published steps',
      detail: names(stepLess.map((course) => course.name)),
      to: '/courses',
    });
  }

  const noObjectives = courses.filter((course) => course.objectives === 0);
  if (noObjectives.length) {
    findings.push({
      id: 'courses-no-objectives',
      severity: 'medium',
      label: 'Courses with no objectives',
      detail: `${noObjectives.length} course${noObjectives.length === 1 ? '' : 's'}: ${names(noObjectives.map((course) => course.name))}`,
      to: '/courses',
    });
  }

  const noMinutes = courses.filter((course) => course.minutes <= 0);
  if (noMinutes.length) {
    findings.push({
      id: 'courses-no-minutes',
      severity: 'low',
      label: 'Courses with no time estimate',
      detail: names(noMinutes.map((course) => course.name)),
      to: '/courses',
    });
  }

  const noSections = courses.filter((course) => course.sections === 0);
  if (noSections.length) {
    findings.push({
      id: 'courses-no-sections',
      severity: 'medium',
      label: 'Courses with no curriculum sections',
      detail: names(noSections.map((course) => course.name)),
      to: '/courses',
    });
  }

  /* ------------------------------ the sections ----------------------------- */

  const noCoding = sections.filter((section) => section.coding === 0);
  if (noCoding.length) {
    findings.push({
      id: 'sections-no-coding',
      severity: 'high',
      label: 'Sections with no coding tasks',
      detail: names(noCoding.map((section) => `${sid(section.no)} ${section.title}`)),
      to: '/practice',
    });
  }

  const noInterview = sections.filter((section) => section.interview === 0);
  if (noInterview.length) {
    findings.push({
      id: 'sections-no-interview',
      severity: 'medium',
      label: 'Sections with no interview questions',
      detail: names(noInterview.map((section) => `${sid(section.no)} ${section.title}`)),
      to: '/interviews',
    });
  }

  const noBuild = sections.filter((section) => !section.mini && section.builds === 0);
  if (noBuild.length) {
    findings.push({
      id: 'sections-no-build',
      severity: 'low',
      label: 'Sections with neither a mini project nor a build',
      detail: names(noBuild.map((section) => `${sid(section.no)} ${section.title}`)),
      to: '/projects',
    });
  }

  const noLogic = sections.filter((section) => section.logic === 0);
  if (noLogic.length) {
    findings.push({
      id: 'sections-no-logic',
      severity: 'low',
      label: 'Sections with no logic cards',
      detail: names(noLogic.map((section) => `${sid(section.no)} ${section.title}`)),
      to: '/practice',
    });
  }

  /* ------------------------------- the bank ------------------------------- */

  if (input.bank === null) {
    findings.push({
      id: 'bank-not-loaded',
      severity: 'low',
      label: 'Question bank manifest not loaded',
      detail: 'Bank coverage cannot be checked on this device yet.',
      to: '/questions',
    });
  } else {
    if (input.bank.sections < sections.length) {
      findings.push({
        id: 'bank-coverage',
        severity: 'medium',
        label: 'Question bank covers fewer sections than the curriculum',
        detail: `${input.bank.sections} bank sections for ${sections.length} curriculum sections.`,
        to: '/questions',
      });
    }
    const emptyBank = sections.filter((section) => section.bank === 0);
    if (emptyBank.length) {
      findings.push({
        id: 'bank-empty-sections',
        severity: 'high',
        label: 'Sections with no published questions',
        detail: names(emptyBank.map((section) => `${sid(section.no)} ${section.title}`)),
        to: '/questions',
      });
    }
  }

  /* ----------------------------- other artifacts ----------------------------- */

  if (input.notebooks === null) {
    findings.push({
      id: 'notebooks-not-loaded',
      severity: 'low',
      label: 'Notebook manifest not loaded',
      detail: 'Notebook coverage cannot be checked on this device yet.',
      to: '/notebooks',
    });
  }

  if (input.ownerCards === null) {
    findings.push({
      id: 'owner-cards-unreachable',
      severity: 'low',
      label: 'Owner cards could not be read',
      detail: 'The account service is unconfigured or offline, so custom-card status is unknown.',
      to: '/admin',
    });
  }

  const hiddenCards = (input.ownerCards ?? []).filter((card) => card.hidden);
  if (hiddenCards.length) {
    findings.push({
      id: 'owner-cards-hidden',
      severity: 'low',
      label: 'Owner cards currently hidden',
      detail: `${hiddenCards.length} custom card${hiddenCards.length === 1 ? '' : 's'}: ${names(hiddenCards.map((card) => card.name))}`,
      to: '/admin',
    });
  }

  const attention = [...findings].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.id.localeCompare(b.id));
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  return {
    publishing: {
      courses: courses.length,
      steps,
      stepsExpected: input.stepsExpected,
      sections: sections.length,
      bankQuestions: input.bank?.total ?? null,
      bankSections: input.bank?.sections ?? null,
      notebooks: input.notebooks,
      ownerVisible: input.ownerCards ? input.ownerCards.filter((card) => !card.hidden).length : null,
      ownerHidden: input.ownerCards ? hiddenCards.length : null,
    },
    findings,
    attention,
    counts,
  };
}
