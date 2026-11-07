/**
 * THE CAREER WORKSPACE — resume readiness, local ATS checks and the next job-prep tick, in one
 * place, from records the learner already has.
 *
 * `/career` answers "am I job-ready?" across the whole flow; `/job-prep` renders the checklist and
 * `/defense` holds the pitch answers. What no single screen showed was the CV view: how complete the
 * resume material is, which ATS-style checks it currently fails, and which one thing to fix next.
 *
 * Two rules keep this honest:
 *
 *   1. NO INVENTED NUMBERS. Every part and every check has a real denominator from stored records —
 *      `resume:` pitch answers, the profile ticks, build/defense gates, target-role skills. Where a
 *      denominator does not exist yet (no pitch answers written) a check is `pass: null` and is left
 *      OUT of the score rather than counted as a failure, and the score itself is `null` when
 *      nothing is measurable.
 *   2. THESE ARE LOCAL CHECKS, NOT A JOB-BOARD SCANNER. There is no resume PDF parser and no
 *      network here. Each check states in its own detail what it actually measured, so "ATS" never
 *      becomes a number the product cannot defend.
 *
 * Pure: no React, no store. The page hands in a plain bag; `scripts/tests/career-workspace.test.mjs`
 * drives every rule with fixtures.
 */
import { CAREER_CHECKLIST, type ChecklistItem } from './career';

export interface CareerWorkspaceInput {
  /** `state.defenseAnswers` — the stored `resume:<projId>:<i>` pitch answers. */
  answers: Record<string, string>;
  /** `state.jobPrep` — the checklist ticks. */
  checklist: Record<string, boolean>;
  /** Portfolio builds: mini projects + Project Lab gates. */
  builds: { done: number; total: number };
  /** Sections defended, against the published section count. */
  defenses: { done: number; total: number };
  /** The chosen target role, so the keyword check is about THIS job. */
  role: string;
  /** The role's skills, measured against real track mastery (0–100). */
  skills: { id: string; label: string; pct: number }[];
  /** Every defense question, for every defense project — the pitch denominator. */
  answerTotal: number;
  /** The profile ticks a CV is found through. Defaults to the career engine's own pair. */
  profileIds?: readonly string[];
}

/* ------------------------------- resume readiness ------------------------------- */

export interface ReadinessPart {
  id: string;
  label: string;
  done: number;
  total: number;
  /** Whole-number percentage over this part's own denominator (0 when the denominator is 0). */
  pct: number;
  /** Where the fix happens — a real route, never a placeholder. */
  to: string;
}

export interface ResumeReadiness {
  /** Aggregate over every part's real denominator (not an average of percentages). */
  pct: number;
  done: number;
  total: number;
  parts: ReadinessPart[];
}

const pctOf = (done: number, total: number): number => (total > 0 ? Math.round((done / total) * 100) : 0);

/** Stored pitch answers, counted from the keys the defense lab writes. */
export function storedAnswers(answers: Record<string, string>): string[] {
  return Object.values(answers ?? {}).filter((value) => String(value ?? '').trim().length > 0);
}

/**
 * Resume readiness across the four things a CV actually needs, each with its own real denominator:
 * written pitches, shipped builds, defended sections, and a findable profile. The aggregate is
 * `sum(done) / sum(total)` — averaging four percentages would let a 1/2 profile outweigh 20 pitches.
 */
export function resumeReadiness(input: CareerWorkspaceInput): ResumeReadiness {
  const stored = storedAnswers(input.answers).length;
  const profileIds = input.profileIds ?? ['github', 'linkedin'];
  const profileDone = profileIds.filter((id) => input.checklist?.[id]).length;

  const parts: ReadinessPart[] = [
    { id: 'pitches', label: 'Pitch answers written', done: stored, total: input.answerTotal, pct: pctOf(stored, input.answerTotal), to: '/defense' },
    { id: 'builds', label: 'Portfolio builds shipped', done: input.builds.done, total: input.builds.total, pct: pctOf(input.builds.done, input.builds.total), to: '/projects' },
    { id: 'defenses', label: 'Sections defended', done: input.defenses.done, total: input.defenses.total, pct: pctOf(input.defenses.done, input.defenses.total), to: '/defense' },
    { id: 'profile', label: 'Profile ticks (GitHub + LinkedIn)', done: profileDone, total: profileIds.length, pct: pctOf(profileDone, profileIds.length), to: '/job-prep' },
  ];

  const done = parts.reduce((sum, p) => sum + p.done, 0);
  const total = parts.reduce((sum, p) => sum + p.total, 0);
  return { pct: pctOf(done, total), done, total, parts };
}

/* ---------------------------------- ATS checks ---------------------------------- */

export interface AtsCheck {
  id: string;
  label: string;
  /** What was actually measured — printed under the label so the check cannot overclaim. */
  detail: string;
  weight: number;
  /** `null` means "no denominator yet", which is excluded from the score, not counted as a fail. */
  pass: boolean | null;
  to: string;
}

export interface AtsReport {
  /** Weighted pass rate over MEASURABLE checks only; `null` when none is measurable yet. */
  score: number | null;
  passed: number;
  measurable: number;
  checks: AtsCheck[];
  /** The failing checks, most important first — what the page offers as fixes. */
  missing: AtsCheck[];
}

/** Filler that makes a pitch look written without saying anything. */
const PLACEHOLDER = /\b(todo|tbd|lorem ipsum|placeholder|asdf|xxx)\b/i;

/** Words too generic to prove a role keyword is present. */
const KEYWORD_STOP = new Set(['with', 'and', 'the', 'for', 'data', 'core', 'basics', 'skills', 'using']);

/** Role keywords from the measured skill labels — the words an ATS would look for. */
export function roleKeywords(skills: { label: string }[]): string[] {
  const out = new Set<string>();
  for (const skill of skills ?? []) {
    for (const word of String(skill.label ?? '').toLowerCase().split(/[^a-z0-9+#]+/)) {
      if (word.length > 3 && !KEYWORD_STOP.has(word)) out.add(word);
    }
  }
  return [...out].sort();
}

/** The share of role keywords that literally appear in the written pitches. */
export function keywordCoverage(answers: string[], skills: { label: string }[]): { matched: number; total: number; pct: number } {
  const words = roleKeywords(skills);
  if (!words.length) return { matched: 0, total: 0, pct: 0 };
  const text = answers.join(' ').toLowerCase();
  const matched = words.filter((word) => text.includes(word)).length;
  return { matched, total: words.length, pct: Math.round((matched / words.length) * 100) };
}

/**
 * The checks themselves, in the order a learner should fix them: finish the pitches, make them
 * substantive, put the role's words in them, ship three builds, be findable, remove filler.
 */
export function atsChecks(input: CareerWorkspaceInput): AtsCheck[] {
  const answers = storedAnswers(input.answers);
  const stored = answers.length;
  const substantive = answers.filter((value) => value.trim().length >= 120).length;
  const coverage = keywordCoverage(answers, input.skills);
  const profileIds = input.profileIds ?? ['github', 'linkedin'];
  const profileDone = profileIds.filter((id) => input.checklist?.[id]).length;
  const filler = answers.filter((value) => PLACEHOLDER.test(value)).length;
  const buildsNeeded = Math.min(3, input.builds.total);

  return [
    {
      id: 'pitch-complete',
      label: 'Every pitch question answered',
      detail: `${stored} of ${input.answerTotal} answers written`,
      weight: 3,
      pass: input.answerTotal > 0 ? stored >= input.answerTotal : null,
      to: '/defense',
    },
    {
      id: 'pitch-substance',
      label: 'Pitches are substantive (120+ characters)',
      detail: stored ? `${substantive} of ${stored} written answers are long enough` : 'No written answer yet to measure',
      weight: 2,
      pass: stored > 0 ? substantive / stored >= 0.75 : null,
      to: '/defense',
    },
    {
      id: 'keywords',
      label: `Role keywords (${input.role}) appear in the pitches`,
      detail: coverage.total
        ? `${coverage.matched} of ${coverage.total} keywords found (${coverage.pct}%)`
        : 'No measured skill words to look for yet',
      weight: 2,
      pass: coverage.total > 0 && stored > 0 ? coverage.pct >= 60 : null,
      to: '/career',
    },
    {
      id: 'builds',
      label: 'Three portfolio builds shipped',
      detail: `${input.builds.done} of ${input.builds.total} builds done${buildsNeeded ? ` (need ${buildsNeeded})` : ''}`,
      weight: 3,
      pass: input.builds.total > 0 ? input.builds.done >= buildsNeeded : null,
      to: '/projects',
    },
    {
      id: 'profile',
      label: 'GitHub and LinkedIn ticks',
      detail: `${profileDone} of ${profileIds.length} profile ticks`,
      weight: 1,
      pass: profileIds.length ? profileDone === profileIds.length : null,
      to: '/job-prep',
    },
    {
      id: 'placeholders',
      label: 'No filler text in the pitches',
      detail: stored ? `${filler} of ${stored} written answers contain filler` : 'No written answer yet to measure',
      weight: 1,
      pass: stored > 0 ? filler === 0 : null,
      to: '/defense',
    },
  ];
}

/** The weighted score, over measurable checks only. */
export function atsReport(input: CareerWorkspaceInput): AtsReport {
  const checks = atsChecks(input);
  const measurable = checks.filter((c) => c.pass !== null);
  const weight = measurable.reduce((sum, c) => sum + c.weight, 0);
  const won = measurable.reduce((sum, c) => sum + (c.pass ? c.weight : 0), 0);
  const score = weight > 0 ? Math.round((won / weight) * 100) : null;
  return {
    score,
    passed: measurable.filter((c) => c.pass).length,
    measurable: measurable.length,
    checks,
    missing: measurable.filter((c) => !c.pass).sort((a, b) => b.weight - a.weight),
  };
}

/* ------------------------------ the next job-prep tick ------------------------------ */

/** The first unticked checklist item, in the authored order, plus what remains after it. */
export function nextChecklistAction(checklist: Record<string, boolean>): { item: ChecklistItem | null; remaining: number } {
  const open = CAREER_CHECKLIST.filter((item) => !checklist?.[item.id]);
  return { item: open[0] ?? null, remaining: open.length };
}

/* ---------------------------------- composition ---------------------------------- */

export interface CareerWorkspace {
  resume: ResumeReadiness;
  ats: AtsReport;
  next: ReturnType<typeof nextChecklistAction>;
  /** True when no record exists at all — the page says so instead of printing a zero score. */
  cold: boolean;
}

export function careerWorkspace(input: CareerWorkspaceInput): CareerWorkspace {
  const stored = storedAnswers(input.answers).length;
  const ticks = Object.values(input.checklist ?? {}).filter(Boolean).length;
  return {
    resume: resumeReadiness(input),
    ats: atsReport(input),
    next: nextChecklistAction(input.checklist),
    cold: stored === 0 && ticks === 0 && input.builds.done === 0 && input.defenses.done === 0,
  };
}
