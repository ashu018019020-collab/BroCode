/**
 * The LABS subjects — the eight tracks, as the axis a learner BUILDS by.
 *
 * Practice answers questions; a lab RUNS something. So this module does not repeat `subjects.ts`:
 * the subject is the same eight tracks, but the content attached to it is what a learner can open
 * and execute — a notebook with real cells, a runtime the course files under that section's step,
 * and the section's coding exercises as the count of things to write.
 *
 * Everything is data the app already publishes, and nothing is re-typed:
 *
 *   · the topics are the published sections (id, section number, title, byType) — the bank manifest;
 *   · which step a section is filed under, and which runtime that step opens, come from
 *     `generated/courses/index.json` (`sections` + `lab_routes`, one authored map published twice);
 *   · the notebooks come from `public/notebooks/manifest.json`, joined to their section;
 *   · how far the learner got comes from the notebook cell records (`nb:<file>:<cell>`), the same
 *     family the Notebook Lab itself counts — a notebook's cells ARE its completion unit here, which
 *     is why this module never invents a percentage for a subject that has no notebooks.
 *
 * A subject with no notebook, no runtime and no exercises says so (`hasContent: false`) instead of
 * showing a 0% — the empty state is a fact about the content, not about the learner.
 *
 * Pure on purpose: no React, no store, no fetch, so `scripts/tests/labs.test.mjs` can drive it with
 * fixtures (see the loader ceiling in AGENTS.md).
 */
import { notebookFamily } from '../platform/keys';
import type { SubjectRange } from './subjects';

/** One published section, as the bank manifest describes it. */
export interface LabSectionLike {
  sectionId: string;
  no: number;
  title: string;
  published: number;
  byType: Record<string, number>;
}

/** One published notebook, as `public/notebooks/manifest.json` describes it. */
export interface LabNotebookLike {
  file: string;
  title: string;
  topic: string;
  /** Section id the notebook was authored for, e.g. `s07`. */
  section: string;
  level: string;
  cells: number;
  codeCells: number;
  /** The manifest's own one-paragraph pitch; optional so a caller may pass a narrower record. */
  intro?: string;
}

/** One course entry of `generated/courses/index.json`, narrowed to what a lab view needs. */
export interface LabCourseLike {
  slug: string;
  /** section id → the step (chapter) that section is filed under. */
  sections: Record<string, number>;
  /** step → the runtime routes the course files under it. */
  lab_routes: Record<string, string[]>;
}

/** A topic inside a subject: one section, plus the hands-on things attached to it. */
export interface LabTopic {
  id: string;
  no: number;
  title: string;
  /** The step that teaches this topic, or null for a section no course files. */
  step: number | null;
  /** The runtimes this topic's OWN step opens (usually one, sometimes two). */
  routes: string[];
  notebooks: LabNotebookLike[];
  /** Cells the learner has run in this topic's notebooks, and the cells they could run. */
  cellsRun: number;
  codeCells: number;
  /** Published `coding` items for the section — the things to WRITE, not to answer. */
  exercises: number;
}

/** section id → the step it is filed under, read from the published course index. */
export function stepOfSections(index: LabCourseLike[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const course of index) {
    for (const [sid, step] of Object.entries(course.sections ?? {})) out[sid] = step;
  }
  return out;
}

/** step → the runtime routes the courses assign to it. */
export function routesOfSteps(index: LabCourseLike[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const course of index) {
    for (const [step, routes] of Object.entries(course.lab_routes ?? {})) out[step] = routes;
  }
  return out;
}

/**
 * The runtimes of the COURSES that teach a subject.
 *
 * A topic shows its own step's lab, which is exact but narrow: the RAG lab is filed under step 20,
 * and no section is filed under step 20 — so a subject built only from its sections would never
 * reach the lab its own course assigned two steps later. A subject therefore carries both: what its
 * own steps assign (fact) and what its courses assign (reachability), and it says how many.
 */
export function courseRoutes(index: LabCourseLike[], range: SubjectRange): string[] {
  const out: string[] = [];
  for (const course of index) {
    const shares = Object.keys(course.sections ?? {}).some((sid) => {
      const no = Number(sid.replace(/^s/, ''));
      return no >= range.from && no <= range.to;
    });
    if (!shares) continue;
    for (const routes of Object.values(course.lab_routes ?? {})) {
      for (const route of routes) if (!out.includes(route)) out.push(route);
    }
  }
  return out;
}

/** The published sections a subject owns, in section order, joined into lab topics. */
export function labTopics(
  sections: LabSectionLike[],
  range: SubjectRange,
  stepOf: Record<string, number>,
  routesByStep: Record<string, string[]>,
  notebooks: LabNotebookLike[],
  cellsRun: (file: string) => number,
): LabTopic[] {
  return sections
    .filter((s) => s.no >= range.from && s.no <= range.to)
    .sort((a, b) => a.no - b.no)
    .map((s) => {
      const step = stepOf[s.sectionId] ?? null;
      const own = notebooks.filter((n) => n.section === s.sectionId);
      return {
        id: s.sectionId,
        no: s.no,
        title: s.title,
        step,
        routes: step !== null ? routesByStep[String(step)] ?? [] : [],
        notebooks: own,
        cellsRun: own.reduce((a, n) => a + cellsRun(n.file), 0),
        codeCells: own.reduce((a, n) => a + n.codeCells, 0),
        exercises: s.byType?.coding ?? 0,
      };
    });
}

export interface LabSummary {
  topics: number;
  notebooks: number;
  codeCells: number;
  cellsRun: number;
  exercises: number;
  /** The runtimes reachable from this subject, in the registry's own order. */
  labs: string[];
  /**
   * False when the course files neither a runtime nor a notebook under this subject yet.
   *
   * Coding exercises do NOT make it true: they are counted (and the topic rows still offer them),
   * but "we have something to RUN here" is a different claim from "we have something to answer",
   * and a subject that only has the latter says so instead of showing a lab that is not there.
   */
  hasContent: boolean;
}

/**
 * What one subject card prints. `order` is the runtime registry's order, so the same subject always
 * lists its labs the same way and a card cannot reshuffle because a map had a different key order.
 */
export function labSummary(topics: LabTopic[], routes: string[], order: string[]): LabSummary {
  const uniq: string[] = [];
  for (const route of routes) if (route && !uniq.includes(route)) uniq.push(route);
  uniq.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib) || a.localeCompare(b);
  });
  const notebooks = topics.reduce((a, t) => a + t.notebooks.length, 0);
  const codeCells = topics.reduce((a, t) => a + t.codeCells, 0);
  const cellsRun = topics.reduce((a, t) => a + t.cellsRun, 0);
  const exercises = topics.reduce((a, t) => a + t.exercises, 0);
  return {
    topics: topics.length,
    notebooks,
    codeCells,
    cellsRun,
    exercises,
    labs: uniq,
    hasContent: uniq.length > 0 || notebooks > 0,
  };
}

export interface LabContinue {
  notebook: LabNotebookLike;
  /** Cells run in it, and the code cells it holds. */
  done: number;
  total: number;
  lastAt: number;
}

/**
 * Where "Continue where you left off" goes: the notebook the learner touched most recently that is
 * not finished yet.
 *
 * Read off the notebook cell records themselves (`nb:<file>:<cell>`, the family the Notebook Lab
 * writes), so the suggestion cannot disagree with the progress bar under it. A notebook with every
 * code cell run is skipped — finishing is not "left off" — and nothing at all returns null, which
 * the page renders as no section rather than an empty card.
 */
export function continueLab(
  attempts: Record<string, { ts?: number } | undefined>,
  notebooks: LabNotebookLike[],
  cellsRun: (file: string) => number,
): LabContinue | null {
  let best: LabContinue | null = null;
  for (const notebook of notebooks) {
    const done = cellsRun(notebook.file);
    if (done <= 0 || done >= notebook.codeCells || notebook.codeCells <= 0) continue;
    const prefix = notebookFamily(notebook.file);
    let lastAt = 0;
    for (const [key, a] of Object.entries(attempts)) {
      if (!key.startsWith(prefix)) continue;
      const ts = typeof a?.ts === 'number' ? a.ts : 0;
      if (ts > lastAt) lastAt = ts;
    }
    if (!best || lastAt > best.lastAt) best = { notebook, done, total: notebook.codeCells, lastAt };
  }
  return best;
}
