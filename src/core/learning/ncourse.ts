/**
 * The NumPy Mastery course's pure rules.
 *
 * Same architecture as the C and Java courses: storage keys are per course and per section, so no
 * tally can count another course's records:
 *
 *   · `nmod:<module>:<section>` — one entry was completed (a checkpoint answer, a lab milestone…)
 *   · the module is complete when every one of its ten sections has at least one record
 *
 * Everything here is pure: no React, no store, no fetch, so the arithmetic is driven with fixtures
 * under `node --test`.
 */

export type NCourseLevel = 'beginner' | 'intermediate' | 'advanced';
export type NSectionKey =
  | 'learn' | 'interview' | 'coding' | 'logic' | 'debug'
  | 'practice' | 'miniProject' | 'projectLab' | 'defense' | 'checkpoint';

/** The ten sections, in the order a module walks them. */
export const N_SECTIONS: { key: NSectionKey; label: string; blurb: string }[] = [
  { key: 'learn', label: 'Learn', blurb: 'Concepts and theory, with runnable code' },
  { key: 'interview', label: 'Interview', blurb: 'Q&A plus output questions' },
  { key: 'coding', label: 'Coding Lab', blurb: 'Write and run the solution' },
  { key: 'logic', label: 'Logic', blurb: 'Predict the output before running' },
  { key: 'debug', label: 'Debug', blurb: 'Find the real error and fix it' },
  { key: 'practice', label: 'Practice Solutions', blurb: 'Rebuild from memory, then compare' },
  { key: 'miniProject', label: 'Mini Project', blurb: 'Apply the module to one task' },
  { key: 'projectLab', label: 'Project Lab', blurb: 'Ship a milestone' },
  { key: 'defense', label: 'Defense', blurb: 'Explain and defend your choices' },
  { key: 'checkpoint', label: 'Checkpoint', blurb: 'Test your mastery' },
];

export const N_SECTION_LABEL: Record<NSectionKey, string> = Object.fromEntries(
  N_SECTIONS.map((s) => [s.key, s.label]),
) as Record<NSectionKey, string>;

export interface NEntry {
  id: string;
  title?: string;
  q?: string;
  body?: string;
  task?: string;
  code?: string;
  output?: string;
  answer?: string;
  solution?: string;
  expected?: string;
  error?: string;
  fix?: string;
  steps?: string[];
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface NModule {
  id: string;
  no: number;
  title: string;
  level: NCourseLevel;
  hours: number;
  goal: string;
  counts: Record<NSectionKey, number>;
  entries: number;
  sections: Record<NSectionKey, NEntry[]>;
}

export interface NCourseFile {
  course: {
    id: string; slug: string; title: string; subtitle: string; tagline: string; description: string;
    standard: string; level: string; hours: number; tone: string;
    prerequisites: string[]; outcomes: string[]; modules: string[];
  };
  stats: {
    modules: number;
    entries: number;
    bySection: Record<string, number>;
    targetPerSection: number;
    targetTotal: number;
  };
  modules: NModule[];
}

/** One completion record: the section of a module was worked through. */
export function nSectionKey(moduleId: string, section: NSectionKey): string {
  return `nmod:${moduleId}:${section}`;
}

/** A module is complete when all ten sections have a record — never from a score. */
export function isModuleComplete(moduleId: string, attempts: Record<string, unknown>): boolean {
  return N_SECTIONS.every((s) => Boolean(attempts[nSectionKey(moduleId, s.key)]));
}

export interface NProgress {
  modulesDone: number;
  modulesTotal: number;
  pct: number;
  sectionsDone: number;
  sectionsTotal: number;
}

export function nProgress(modules: { id: string }[], attempts: Record<string, unknown>): NProgress {
  const total = modules.length * N_SECTIONS.length;
  let sectionsDone = 0;
  let modulesDone = 0;
  for (const m of modules) {
    const done = N_SECTIONS.filter((s) => Boolean(attempts[nSectionKey(m.id, s.key)])).length;
    sectionsDone += done;
    if (done === N_SECTIONS.length) modulesDone += 1;
  }
  return {
    modulesDone,
    modulesTotal: modules.length,
    pct: total > 0 ? Math.round((sectionsDone / total) * 100) : 0,
    sectionsDone,
    sectionsTotal: total,
  };
}

/** Counts a module prints: real records per section, never a target. */
export function sectionCounts(module: Pick<NModule, 'sections'>): Record<NSectionKey, number> {
  return Object.fromEntries(N_SECTIONS.map((s) => [s.key, module.sections[s.key]?.length ?? 0])) as Record<NSectionKey, number>;
}

/** The first section with something left in it — what "Continue" opens. */
export function nextSection(moduleId: string, attempts: Record<string, unknown>): NSectionKey {
  return N_SECTIONS.find((s) => !attempts[nSectionKey(moduleId, s.key)])?.key ?? 'checkpoint';
}
