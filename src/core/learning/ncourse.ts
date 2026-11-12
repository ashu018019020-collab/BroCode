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
  /** A nudge toward the right function, never the solution itself. */
  hint?: string;
  output?: string;
  answer?: string;
  solution?: string;
  expected?: string;
  error?: string;
  fix?: string;
  steps?: string[];
  /** A checkpoint quiz offers three real, distinct outputs; the answer is one of them. */
  options?: string[];
  /** Checkpoint shape: the original three-option quiz, a true/false claim, or a blank to fill in. */
  format?: 'truefalse' | 'blank';
  /** The output a true/false checkpoint claims the code prints. */
  claim?: string;
  /** A written checkpoint is self-assessed against three criteria built from real content. */
  rubric?: string[];
  /** Authored deeper questions asked after the model answer, so practice goes past one reply. */
  followUps?: { q: string; answer: string }[];
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

/** Canonical question-bank categories, in display order, shared by the course tiles and the module view. */
export const N_BANK_CATEGORY_ORDER = ['concept', 'output', 'coding', 'debugging', 'quiz', 'written', 'project', 'scenario'];
export const N_BANK_CATEGORY_LABEL: Record<string, string> = {
  concept: 'concept', output: 'output', coding: 'coding', debugging: 'debug', quiz: 'quiz',
  written: 'written', project: 'project', scenario: 'scenario',
};

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
    /** Real counts per module and category — never a target dressed as a count. */
    bank: {
      total: number;
      target: number;
      perModule: number;
      shortPerModule: number;
      shortfall: number;
      modules: Record<string, {
        total: number;
        categories: Record<string, number>;
        difficulty: Record<string, number>;
      }>;
    };
  };
  modules: NModule[];
  /** The one assessable project for the whole course, when the build carries it. */
  capstone?: {
    title: string;
    brief: string;
    dataset: string;
    starter: { code: string; output: string };
    tiers: { name: string; goal: string; requirements: string[]; deliverables: string[]; stretch: string[] }[];
    milestones: { title: string; detail: string }[];
    rubric: { criterion: string; weight: number; evidence: string }[];
    assessment: { pass: string; excellent: string };
  };
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
/** The reader's last opened place, so "Resume" is a real place and not a guess. */
export const N_LAST_KEY = 'nlast';

export interface NReportRow {
  id: string;
  no: number;
  title: string;
  done: number;
  total: number;
  pct: number;
}

export interface NWeakSpot {
  moduleId: string;
  moduleTitle: string;
  section: NSectionKey;
  label: string;
}

export interface NReport {
  modulesDone: number;
  modulesTotal: number;
  sectionsDone: number;
  sectionsTotal: number;
  pct: number;
  rows: NReportRow[];
  weak: NWeakSpot[];
  next: { moduleId: string; section: NSectionKey } | null;
  resume: { moduleId: string; section: NSectionKey } | null;
}

/**
 * The course's own progress arithmetic: per-section records only, so a checkpoint score alone never
 * counts a section (the same predicate `isModuleComplete` uses). `resume` reads the stored last place
 * and falls back to the first untouched section; `weak` is every unrecorded section in course order,
 * which is what a revision plan needs.
 */
/** The rubric self-check is stored as a JSON array of criteria under this key. */
export const N_CAPSTONE_KEY = 'ncap';

export interface NCertificate {
  /** Every section recorded — the only thing that makes the course complete. */
  complete: boolean;
  capstonePassed: boolean;
  eligible: boolean;
  score: number;
  grade: 'none' | 'pass' | 'excellent';
  reason: string;
}

/**
 * A certificate is a claim, so it is derived, never assumed: the course must be complete (all sections
 * recorded) AND the capstone rubric must reach the pass mark the course publishes. The grade mirrors
 * the same thresholds (70 pass, 90 excellent) instead of inventing a second scale.
 */
export function numpyCertificate(report: NReport, rubric: { criterion: string; weight: number }[], checked: string[]): NCertificate {
  const score = rubric.reduce((a, row) => a + (checked.includes(row.criterion) ? row.weight : 0), 0);
  const complete = report.sectionsDone === report.sectionsTotal && report.sectionsTotal > 0;
  const capstonePassed = score >= 70;
  const grade: NCertificate['grade'] = score >= 90 ? 'excellent' : score >= 70 ? 'pass' : 'none';
  const reason = !complete
    ? `${report.sectionsTotal - report.sectionsDone} sections are still untouched.`
    : !capstonePassed
      ? 'The capstone rubric is below 70 — tick the evidence you can actually show.'
      : 'Every section is recorded and the capstone rubric is at or above the pass mark.';
  return { complete, capstonePassed, eligible: complete && capstonePassed, score, grade, reason };
}

export interface NSearchHit {
  moduleId: string;
  moduleTitle: string;
  section: NSectionKey;
  label: string;
  id: string;
  title: string;
  snippet: string;
  score: number;
}

/**
 * Search across every published record in the course, not just titles: a learner searching "broadcast"
 * should find the coding task that uses it, and one searching "ValueError" should find the debug item
 * that raises it. Title matches outrank body matches, and an exact title beats a partial one, so the
 * first row is the thing being named.
 */
export function searchCourse(modules: NModule[], rawQuery: string, limit = 20): NSearchHit[] {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < 2) return [];
  const hits: NSearchHit[] = [];
  for (const m of modules) {
    for (const s of N_SECTIONS) {
      for (const e of (m.sections[s.key] ?? []) as NEntry[]) {
        const title = String(e.title ?? e.q ?? '').trim();
        const body = [e.body, e.statement, e.error, e.task, e.answer, e.code]
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
          .join(' ')
          .toLowerCase();
        const lowerTitle = title.toLowerCase();
        let score = 0;
        if (lowerTitle === query) score = 100;
        else if (lowerTitle.startsWith(query)) score = 60;
        else if (lowerTitle.includes(query)) score = 40;
        else if (body.includes(query)) score = 10;
        if (!score) continue;
        const at = body.indexOf(query);
        const raw = body || [e.body, e.statement, e.task, e.answer, e.code, title]
          .find((v): v is string => typeof v === 'string' && v.trim().length > 0) || title;
        const snippet = at >= 0
          ? body.slice(Math.max(0, at - 40), Math.min(body.length, at + 80)).trim()
          : raw.slice(0, 120).trim();
        hits.push({ moduleId: m.id, moduleTitle: m.title, section: s.key, label: s.label, id: e.id, title, snippet, score });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

export function numpyReport(modules: NModule[], attempts: Record<string, unknown>, last?: string): NReport {
  const rows: NReportRow[] = [];
  const weak: NWeakSpot[] = [];
  let sectionsDone = 0;
  let sectionsTotal = 0;
  for (const m of modules) {
    const recorded = N_SECTIONS.filter((s) => Boolean(attempts[nSectionKey(m.id, s.key)])).length;
    sectionsDone += recorded;
    sectionsTotal += N_SECTIONS.length;
    rows.push({
      id: m.id, no: m.no, title: m.title,
      done: recorded, total: N_SECTIONS.length,
      pct: Math.round((recorded / N_SECTIONS.length) * 100),
    });
    for (const s of N_SECTIONS) {
      if (!attempts[nSectionKey(m.id, s.key)]) {
        weak.push({ moduleId: m.id, moduleTitle: m.title, section: s.key, label: s.label });
      }
    }
  }
  const modulesDone = rows.filter((r) => r.done === r.total).length;
  const first = weak[0] ? { moduleId: weak[0].moduleId, section: weak[0].section } : null;
  let resume: { moduleId: string; section: NSectionKey } | null = null;
  if (last) {
    const [moduleId, section] = last.split(':');
    if (modules.some((m) => m.id === moduleId) && N_SECTIONS.some((s) => s.key === section)) {
      resume = { moduleId, section: section as NSectionKey };
    }
  }
  return {
    modulesDone,
    modulesTotal: modules.length,
    sectionsDone,
    sectionsTotal,
    pct: sectionsTotal ? Math.round((sectionsDone / sectionsTotal) * 100) : 0,
    rows,
    weak,
    next: first,
    resume: resume ?? first,
  };
}

export interface NRevisionItem extends NWeakSpot {
  rank: number;
  moduleNo: number;
  recorded: number;
  total: number;
  /** Why this section is ranked here, printed beside it. */
  reason: string;
}

/**
 * A revision plan, weakest first.
 *
 * The plan is DERIVED from the same records `numpyReport` counts: an untouched section is a candidate,
 * and candidates are ordered by how little of their module is recorded (fewest first), then by module
 * order, then by the course's own section order. So the learner starts in the module where a single
 * session closes the most gaps, and inside it the earliest missing section — not merely page order.
 */
export function revisionPlan(
  modules: NModule[], attempts: Record<string, unknown>, limit = 8,
): NRevisionItem[] {
  const candidates: Omit<NRevisionItem, 'rank'>[] = [];
  for (const m of modules) {
    const recorded = N_SECTIONS.filter((s) => Boolean(attempts[nSectionKey(m.id, s.key)])).length;
    for (const s of N_SECTIONS) {
      if (attempts[nSectionKey(m.id, s.key)]) continue;
      candidates.push({
        moduleId: m.id,
        moduleTitle: m.title,
        moduleNo: m.no,
        section: s.key,
        label: s.label,
        recorded,
        total: N_SECTIONS.length,
        reason: `${recorded}/${N_SECTIONS.length} recorded in this module`,
      });
    }
  }
  candidates.sort((a, b) => a.recorded - b.recorded || a.moduleNo - b.moduleNo
    || N_SECTIONS.findIndex((s) => s.key === a.section) - N_SECTIONS.findIndex((s) => s.key === b.section));
  return candidates.slice(0, Math.max(0, limit)).map((item, index) => ({ ...item, rank: index + 1 }));
}

export function sectionCounts(module: Pick<NModule, 'sections'>): Record<NSectionKey, number> {
  return Object.fromEntries(N_SECTIONS.map((s) => [s.key, module.sections[s.key]?.length ?? 0])) as Record<NSectionKey, number>;
}

/** The first section with something left in it — what "Continue" opens. */
export function nextSection(moduleId: string, attempts: Record<string, unknown>): NSectionKey {
  return N_SECTIONS.find((s) => !attempts[nSectionKey(moduleId, s.key)])?.key ?? 'checkpoint';
}
