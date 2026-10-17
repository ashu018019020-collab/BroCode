/**
 * Every other path in the app, as data.
 *
 * The Learning Path shows the 8 curriculum tracks (TRACK_DEFS, section-based mastery). It also
 * has to show the REST of the project — the Playbook V15 layer, the question bank, the labs, the
 * career tools, the reference books — because a learner should never have to know which sidebar
 * group something lives in to find it.
 *
 * Two rules hold this file together:
 *
 *   1. NO INVENTED NUMBERS. Every card's number is read from the offline content pack (a
 *      manifest on disk) or from real learner state. When no honest denominator exists the entry
 *      declares `progress: null` and shows facts only — never a made-up percentage.
 *   2. NO HIDDEN PATH. `PATH_ROUTE_ALLOWLIST` names the routes that are deliberately NOT paths
 *      (the shell, the track/lesson pages the 8 tracks already own, setup screens). The test
 *      diffs every route in src/app/App.tsx against `EXTRA_PATHS` + this allowlist, so a page added
 *      later cannot be forgotten here.
 *
 * Pure on purpose: no React, no store, no lucide, no value imports (see core/assessment/playbook.ts for why).
 * That is a LOADER constraint, not a style choice — measured in the key-ownership pass: adding
 * `import { BANK_ATTEMPT_PREFIX } from '../platform/keys'` here made the module unimportable under
 * `node --test` (ERR_MODULE_NOT_FOUND for './keys': this file is loaded by explicit path, so its own
 * relative imports reach Node's resolver with the test's `.ts` hook out of scope). The families below
 * therefore stay literals, and `scripts/tests/playbook.test.mjs` pins each one against the builders in
 * core/platform/keys.ts — the value can only drift if this file and that test are changed together.
 */

export type PathGroup = 'practice' | 'lab' | 'career' | 'reference';

/** The order the groups render in. */
export const PATH_GROUPS: PathGroup[] = ['practice', 'lab', 'career', 'reference'];

/** Heading key per group — the component translates these, the engine only names them. */
export const GROUP_KEY: Record<PathGroup, 'path.morePractice' | 'path.moreLab' | 'path.moreCareer' | 'path.moreReference'> = {
  practice: 'path.morePractice',
  lab: 'path.moreLab',
  career: 'path.moreCareer',
  reference: 'path.moreReference',
};

/**
 * FinalAssessment.tsx builds a 14-part paper (py, code, np, pd, sql, ml, genai, rag, agent, api,
 * debug, defense, sys, proj). Pinned by the test, which counts the parts array in the page.
 */
export const FINAL_PARTS = 14;
/** JobPrep.tsx checklist items. Pinned by the test, which counts them in the page. */
export const JOB_PREP_ITEMS = 16;
/** src/core/assessment/exam.ts EXAM_FOCUS_ORDER.length / EXAM_SIZES.length — pinned by the test. */
export const EXAM_FOCI = 5;
export const EXAM_SIZES = 4;

/** Everything a card may read. Built by src/core/data/paths.ts, which owns the key shapes. */
export interface PathCtx {
  /** The 29 curriculum sections (id/no/title) — used for the "/29" denominators. */
  sections: { id: string; no: number; title: string }[];
  /** Sections whose Learn stage has been opened at least once. */
  readSections: number;
  /** st:<sid>:<stage> gates that are done or scored (project lab builds, defenses). */
  projectGates: number;
  defenseGates: number;
  counts: {
    /** Distinct `<section>:<type>:<i>` ids with a bank attempt or a written answer. */
    bankPractised: number;
    /** Every standalone interview answer recorded (`interviewAnswers` + `lab:interview:` records). */
    interviewAnswers: number;
    /** Average percentage of those answers, or null when none were measured. */
    interviewPct: number | null;
    notes: number;
    mistakesOpen: number;
    mistakesTotal: number;
    reviewDue: number;
    mockDone: number;
    ragRounds: number;
    npSlots: number;
    playgroundSlots: number;
    sqlSlots: number;
    notebookCells: number;
    resumeAnswers: number;
    finalParts: number;
    jobPrepDone: number;
    /** V15 items practised, or null while items.json has not loaded. */
    playbookPractised: number | null;
    xp: number;
    level: number;
    streak: number;
    bookmarksGuide: number;
    bookmarksPlaybook: number;
  };
  /** public/generated/questions/manifest.json */
  published: { total: number; sections: number; interview: number } | null;
  /** public/generated/playbook/manifest.json (pages/chapters/items + the document's own tallies). */
  playbook: {
    pages: number;
    chapters: number;
    items: number;
    interview: number;
    labs: number;
    miniProjects: number;
    methodAnswers: number;
  } | null;
  /** public/notebooks/manifest.json */
  notebooks: { notebooks: number; cells: number } | null;
  /** Questions across every mock round + intensive set. */
  mockTotal: number;
}

export interface ExtraPath {
  route: string;
  group: PathGroup;
  /**
   * Label override for a route the sidebar has no NAV entry for (`/pdf/playbook` is the same
   * reader as `/pdf`). Every other card takes its label and icon from the exported NAV, so the
   * sidebar and the roadmap can never describe the same page differently.
   */
  labelKey?: 'path.pbPdf';
  /**
   * The stored-key family this card counts. Documentation for the reader AND an assertion target
   * for the test, which pins each prefix against the builder in core/platform/keys.ts — a key shape that
   * changes without this file changing fails the suite instead of silently printing 0.
   */
  prefix?: string;
  facts: (ctx: PathCtx) => string[];
  /**
   * null = no honest denominator exists → facts only (see rule 1 above). An entry may also return
   * null at runtime, for the moment its manifest has not arrived yet — never a zero.
   */
  progress: ((ctx: PathCtx) => { done: number; total: number } | null) | null;
}

const n29 = (ctx: PathCtx) => Math.max(1, ctx.sections.length);

export const EXTRA_PATHS: ExtraPath[] = [
  /* ------------------------------- practice ------------------------------- */
  {
    route: '/playbook',
    group: 'practice',
    prefix: 'qb:',
    facts: (c) => (c.playbook
      ? [`${c.playbook.items} items`, `${c.playbook.chapters} chapters`, `${c.playbook.pages} pages`, `${c.playbook.labs} coding labs`, `${c.playbook.miniProjects} mini projects`, `${c.playbook.methodAnswers} method answers`]
      : ['index pending']),
    progress: (c) => (c.playbook && c.counts.playbookPractised !== null
      ? { done: c.counts.playbookPractised, total: c.playbook.items }
      : null),
  },
  {
    route: '/questions',
    group: 'practice',
    prefix: 'qb:',
    facts: (c) => (c.published ? [`${c.published.total} published`, `${c.published.sections} sections`] : ['banks pending']),
    progress: (c) => (c.published ? { done: c.counts.bankPractised, total: c.published.total } : null),
  },
  {
    route: '/interview-mode',
    group: 'practice',
    prefix: 'ia:',
    facts: (c) => [
      c.published ? `${c.published.interview} interview Qs` : 'interview banks pending',
      `${c.counts.interviewAnswers} answers recorded`,
      typeof c.counts.interviewPct === 'number' ? `${c.counts.interviewPct}% average` : 'no answers yet',
    ],
    // No denominator: the pool a learner sees depends on the section they are in.
    progress: null,
  },
  {
    route: '/mock-interviews',
    group: 'practice',
    prefix: 'lab:mock:',
    facts: (c) => [`${c.mockTotal} questions`, `${c.counts.mockDone} attempted`],
    progress: (c) => (c.mockTotal > 0 ? { done: c.counts.mockDone, total: c.mockTotal } : null),
  },
  {
    route: '/exam',
    group: 'practice',
    facts: () => [`${EXAM_FOCI} focus types`, `${EXAM_SIZES} paper sizes`, '5–45 min timed'],
    // The exam session lives in its own offline store and keeps no history in AppState, so there
    // is no honest "done" figure to show. Facts only — the card never claims a score it cannot read.
    progress: null,
  },
  {
    route: '/final-assessment',
    group: 'practice',
    prefix: 'final:part:',
    facts: (c) => [`${FINAL_PARTS}-part paper`, `${c.counts.finalParts} parts scored`],
    progress: (c) => ({ done: c.counts.finalParts, total: FINAL_PARTS }),
  },
  {
    route: '/review',
    group: 'practice',
    facts: (c) => [`${c.counts.reviewDue} cards due now`, 'spaced repetition'],
    progress: null,
  },
  {
    route: '/mistakes',
    group: 'practice',
    facts: (c) => [`${c.counts.mistakesOpen} open`, `${c.counts.mistakesTotal} logged`],
    progress: null,
  },

  /* --------------------------------- labs --------------------------------- */
  {
    route: '/playground',
    group: 'lab',
    prefix: 'pg:',
    facts: (c) => ['4 runtimes: Python · JS · SQL · HTML', `${c.counts.playgroundSlots} saved slots`],
    progress: null,
  },
  {
    route: '/notebooks',
    group: 'lab',
    prefix: 'nb:',
    facts: (c) => (c.notebooks ? [`${c.notebooks.notebooks} notebooks`, `${c.notebooks.cells} cells`] : ['notebooks pending']),
    progress: (c) => (c.notebooks && c.notebooks.cells > 0 ? { done: c.counts.notebookCells, total: c.notebooks.cells } : null),
  },
  {
    route: '/sql',
    group: 'lab',
    prefix: 'sql:lab',
    facts: (c) => ['Monaco SQL editor', `${c.counts.sqlSlots} saved queries`],
    progress: null,
  },
  {
    route: '/numpy-pandas',
    group: 'lab',
    prefix: 'nplab:',
    facts: (c) => ['3 tabs: NumPy · Pandas · Datasets', `${c.counts.npSlots} practice cells saved`],
    progress: null,
  },
  {
    route: '/ai-lab',
    group: 'lab',
    facts: () => ['prompt + embedding labs', 'local runtime'],
    // A guided lab: it writes no per-step record, so there is no figure to print. Facts only.
    progress: null,
  },
  {
    route: '/agentic',
    group: 'lab',
    facts: () => ['agent scenarios', 'tool-use + workflow steps'],
    progress: null,
  },
  {
    route: '/rag-lab',
    group: 'lab',
    prefix: 'lab:rag:',
    facts: (c) => [`${c.counts.ragRounds} retrieval rounds run`, 'chunking + vector search'],
    progress: null,
  },
  {
    route: '/projects',
    group: 'lab',
    prefix: 'st:*:project',
    facts: (c) => [`${c.projectGates} / ${c.sections.length} builds done`],
    progress: (c) => ({ done: c.projectGates, total: n29(c) }),
  },

  /* -------------------------------- career -------------------------------- */
  {
    route: '/job-prep',
    group: 'career',
    prefix: 'jobPrep',
    facts: (c) => [`${c.counts.jobPrepDone} / ${JOB_PREP_ITEMS} checklist items`],
    progress: (c) => ({ done: c.counts.jobPrepDone, total: JOB_PREP_ITEMS }),
  },
  {
    route: '/defense',
    group: 'career',
    prefix: 'st:*:defense',
    facts: (c) => [`${c.defenseGates} / ${c.sections.length} sections defended`],
    progress: (c) => ({ done: c.defenseGates, total: n29(c) }),
  },
  {
    route: '/progress',
    group: 'career',
    facts: (c) => [`${c.counts.xp} XP`, `Level ${c.counts.level}`, `${c.counts.streak}-day streak`],
    progress: null,
  },

  /* ------------------------------ reference ------------------------------- */
  {
    route: '/concepts',
    group: 'reference',
    prefix: 'view:*:learn',
    facts: (c) => [`${c.readSections} / ${c.sections.length} sections read`],
    progress: (c) => ({ done: c.readSections, total: n29(c) }),
  },
  {
    route: '/notes',
    group: 'reference',
    facts: (c) => [`${c.counts.notes} notes`, 'markdown export'],
    progress: null,
  },
  {
    route: '/cheat-sheets',
    group: 'reference',
    facts: () => ['syntax reference', 'local run'],
    progress: null,
  },
  {
    route: '/pdf',
    group: 'reference',
    prefix: 'b<page>',
    // The reader learns the page count from the PDF itself at runtime, so there is no stored
    // total to print here — only what the learner has actually bookmarked.
    facts: (c) => ['original curriculum book', `${c.counts.bookmarksGuide} bookmarks`],
    progress: null,
  },
  {
    route: '/pdf/playbook',
    group: 'reference',
    labelKey: 'path.pbPdf',
    prefix: 'pb<page>',
    facts: (c) => (c.playbook
      ? [`${c.playbook.pages} pages`, `${c.playbook.chapters} chapters`, `${c.counts.bookmarksPlaybook} bookmarks`]
      : ['index pending']),
    progress: null,
  },
];

/**
 * Routes that are deliberately NOT a path card, and why. The coverage test reads this list, so
 * adding a page without deciding where it belongs is impossible.
 */
export const PATH_ROUTE_ALLOWLIST: string[] = [
  '/',                    // dashboard — the landing surface itself
  '/start',               // the front door: a landing page, not a path
  '/practice',            // pillar hub — its cards (/questions, /exam, /review, …) are the paths
  '/labs',                // pillar hub — the lab cards are the paths
  '/interviews',          // pillar hub — /interview-mode, /mock-interviews, /defense are the paths
  '/career',              // pillar hub — /job-prep, /defense, /progress are the paths
  '/track/:trackSlug',    // owned by the 8 TRACK_DEFS cards
  '/lesson/:sid/:stage',  // owned by the 8 TRACK_DEFS cards
  '/lesson/:sid',
  '/courses',             // the 11-course hub: a list of courses, not a path card
  '/course/:slug',        // one course's step index — owned by the /courses grid
  '/course/:slug/:step',  // one step, 7 tabs — owned by its course
  '/pdf/:page',           // the guide's page-deep-link form of /pdf
  '/pdf/playbook/:page',  // …and the playbook's page-deep-link form of /pdf/playbook
  '/settings',            // setup, not a path
  '/onboarding',          // first-run gate
  '/login',               // Supabase-backed account entry — the app's only front door
  '/reset-password',      // the emailed-recovery half of the account flow, reached from /login
  '/admin',               // server-authorized account management
  '*',                    // fallback route
];

export interface PathStat {
  /** null when the entry declares no honest denominator. */
  pct: number | null;
  done: number;
  total: number;
  /** `done/total` for the card's line, empty when there is no ratio. */
  note: string;
}

export function pathStat(def: ExtraPath, ctx: PathCtx): PathStat {
  const raw = def.progress?.(ctx) ?? null;
  if (!raw || raw.total <= 0) return { pct: null, done: 0, total: 0, note: '' };
  const done = Math.max(0, Math.min(raw.done, raw.total));
  return { pct: Math.round((done / raw.total) * 100), done, total: raw.total, note: `${done}/${raw.total}` };
}

/** Aggregate of every card that declares a ratio — the "More Paths" header line. */
export function pathTotals(ctx: PathCtx): { done: number; total: number; pct: number } {
  let done = 0;
  let total = 0;
  for (const def of EXTRA_PATHS) {
    const s = pathStat(def, ctx);
    if (s.pct === null) continue;
    done += s.done;
    total += s.total;
  }
  return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
}
