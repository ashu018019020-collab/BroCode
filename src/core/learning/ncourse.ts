/**
 * The NumPy Mastery course's pure rules.
 *
 * Same architecture as the C and Java courses: storage keys are per course and per section, so no
 * tally can count another course's records:
 *
 *   · `nmod:<module>:<section>` — one entry was completed (a checkpoint answer, a lab milestone…)
 *   · `nans:<entry>` / `ntick:<entry>` — a written checkpoint's draft answer and its rubric ticks
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
  statement?: string;
  code?: string;
  starter?: string;
  /** Independent authored task with a hidden check, vs a guided practice entry built from a topic. */
  kind?: 'topic' | 'task';
  check?: string;
  output?: string;
  answer?: string;
  solution?: string;
  expected?: string;
  error?: string;
  fix?: string;
  steps?: string[];
  /** A checkpoint quiz offers three real, distinct outputs; the answer is one of them. */
  options?: string[];
  /** A written checkpoint is self-assessed against three criteria built from real content. */
  rubric?: string[];
  /** The same Learn topic explained for a beginner, in Hinglish. */
  simple?: string;
  /** The same Learn topic explained professionally, in English. */
  pro?: string;
  /** Lesson structure: the call signature, in one line. */
  syntax?: string;
  /** Lesson structure: the ordered steps a reader follows. */
  visual?: string;
  /** Lesson structure: where the topic is actually used. */
  realWorld?: string;
  /** Lesson structure: the mistakes learners actually make. */
  mistakes?: string[];
  /** Lesson structure: the two or three points worth remembering. */
  revision?: string[];
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

/**
 * What a graded run compares: the output a learner's code printed against the module's expected
 * output. Trailing spaces on a line, CRLF line endings and trailing blank lines are noise — a
 * solution is not wrong because the last line has no newline — so both sides are normalised first.
 * Everything else (internal spacing, order, case) must match exactly.
 */
export function normalizeOutput(text: string): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

export function outputMatches(expected: string, actual: string): boolean {
  return normalizeOutput(expected) === normalizeOutput(actual);
}

/** One completion record: the section of a module was worked through. */
export function nSectionKey(moduleId: string, section: NSectionKey): string {
  return `nmod:${moduleId}:${section}`;
}

/**
 * A written checkpoint's own records: the drafted explanation and the learner's self-assessment.
 *
 * They are per ENTRY, not per section, on purpose — a section key says "done", and the draft has to
 * survive a refresh, so the text cannot live in component state. Both use the store's single
 * written-answer field (`Attempt.answer`), so nothing new was invented for storage; the ticks are
 * one compact `1,0,1` string. The families are distinct from `nmod:` so no tally can count a draft
 * as a completed section, and distinct from each other so a codec bug cannot overwrite an answer.
 */
/** The reader's teaching level: `simple` (Hinglish, default) or `pro` (professional English). */
export const N_LEVEL_KEY = 'nlevel';

export const N_WRITTEN_ANSWER_PREFIX = 'nans:';
export const N_WRITTEN_TICKS_PREFIX = 'ntick:';
export function nWrittenAnswerKey(entryId: string): string {
  return `${N_WRITTEN_ANSWER_PREFIX}${entryId}`;
}
export function nWrittenTicksKey(entryId: string): string {
  return `${N_WRITTEN_TICKS_PREFIX}${entryId}`;
}

/** Self-assessment ticks as a compact record; the store holds text, not booleans. */
export function encodeTicks(ticks: boolean[]): string {
  return ticks.map((t) => (t ? '1' : '0')).join(',');
}

/**
 * Read ticks back against the rubric length: missing entries are unticked, and an older or shorter
 * record never grows the list — the rubric is the source of truth for how many criteria exist.
 */
export function decodeTicks(raw: string | undefined, count: number): boolean[] {
  const parts = String(raw ?? '').split(',');
  return Array.from({ length: Math.max(0, count) }, (_, i) => parts[i] === '1');
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
