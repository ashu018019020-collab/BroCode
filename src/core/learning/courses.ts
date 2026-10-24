/**
 * The 11 courses as DATA, and the one rule every course surface reads.
 *
 * The authored map (`content/courses/courses.json`) says which steps and sections belong to which
 * course; the generator (`scripts/courses.cjs`) publishes one item list per course, each item
 * tagged `{ course, chapter (step), type, ref, pdf_page }`. This module owns what those tags MEAN:
 * which tab an item belongs to, whether it is a measurable item at all, how a step's progress is
 * computed, and which lab a step should link to as a shortcut.
 *
 * TWO MEASURES, ONE PER STEP, never invented:
 *
 *   · a step that teaches curriculum sections reports the MASTERY of those sections — the same
 *     gate engine (`core/learning/progress.ts`) the lesson and the Learning Path already read, so
 *     a step here can never disagree with its own sections' rings;
 *   · a step with no sections (Data Engineering, the GenAI/agent playbook steps, the labs) reports
 *     COVERAGE of its measurable items — how many the learner has started — because those items
 *     (question-bank ids, playbook ids, notebook cells, project gates, mock rounds) all have a
 *     real stored record behind them.
 *
 * A step with NEITHER denominator is not 0%: it is a reading step, and `pct` is null so the page
 * prints facts only. That is the same rule `core/learning/paths.ts` states for its cards.
 *
 * Pure on purpose: no React, no store, no fetch, and no value imports at all — so every test can
 * load it directly with fixtures, without the TS resolver hook (roadmap.ts sets the same rule).
 */

/* --------------------------------- the pack ------------------------------- */

/** The seven families an item can belong to (the generator's `type` field). */
export type CourseItemType =
  | 'lesson' | 'practice' | 'question' | 'interview' | 'lab' | 'project' | 'reference';

export const ITEM_TYPES: CourseItemType[] =
  ['lesson', 'practice', 'question', 'interview', 'lab', 'project', 'reference'];

/** What an item points AT — its home surface in the app. */
export type CourseRefKind =
  | 'step' | 'section' | 'track' | 'playbook' | 'question' | 'notebook' | 'project' | 'mock' | 'intensive';

export interface CourseRef {
  kind: CourseRefKind;
  /** The real id of the thing: `s23:theory:0`, `step-4`, `numpy-pandas.ipynb`, `mock:2:7`, … */
  id: string;
}

/** One tagged item of a course. Shape owned by `scripts/courses.cjs`; asserted by its test. */
export interface CourseItem {
  id: string;
  course: string;
  /** The STEP this item belongs to (1…36), which the plan and the UI call "chapter". */
  chapter: number;
  type: CourseItemType;
  subtype?: string;
  difficulty?: string;
  title?: string;
  pdf_page?: number;
  primary_section?: string;
  related_chapters?: number[];
  related_sections?: string[];
  related_courses?: string[];
  related_refs?: CourseRef[];
  ref: CourseRef;
  tags: string[];
}

/** Canonical record plus any legacy attempt keys that now refer to the same content. */
export function itemRefs(item: CourseItem): CourseRef[] {
  return [item.ref, ...(item.related_refs ?? [])];
}

/** An item is covered when any canonical or legacy reference has its existing progress record. */
export function anyItemRefTouched(item: CourseItem, isTouched: (ref: CourseRef) => boolean): boolean {
  return itemRefs(item).some(isTouched);
}

export interface CourseCounts {
  total: number;
  lesson: number;
  practice: number;
  question: number;
  interview: number;
  lab: number;
  project: number;
  reference: number;
}

/** One course card: everything `index.json` carries (no items — those live in `<slug>.json`). */
export interface CourseCard {
  slug: string;
  number: number;
  name: string;
  tone: string;
  logo: string;
  steps: number[];
  /** sectionId → step, for the 29 curriculum sections this course owns. */
  sections: Record<string, number>;
  /**
   * Step number → the runtime routes this course files under it, for the same reason `sections` is
   * on the card: the Labs hub resolves "which lab does this topic open?" for all eleven courses at
   * once, and eleven course files (python.json alone is 1.5 MB) is not a price a hub may pay. The
   * course's OWN file carries the identical map — one authored source, published twice.
   */
  lab_routes: Record<string, string[]>;
  counts: CourseCounts;
}

export interface CourseIndex {
  courses: CourseCard[];
  families: Record<string, number>;
  totals: { courses: number; items: number };
}

/* --------------------------- bilingual shape ------------------------------- */

/**
 * The authored shape of the text a course publishes, before the loader resolves it.
 *
 * A translatable field is EITHER a plain string (a term that is the same in both languages, like
 * "Python") or an `{ en, hi }` map. Both are legal at once so the corpus can be translated one
 * batch at a time — see `core/data/localize.ts`, which owns the resolver and the fallback rule.
 * These aliases are structural on purpose: `core/learning` stays free of runtime imports, and the
 * published card a component sees is still a plain `CourseCard` with a plain string `name`.
 */
interface LocalizedText { en: string; hi: string }
type CardText = string | LocalizedText;

export type CourseCardRecord = Omit<CourseCard, 'name'> & { name: CardText };
export type CourseIndexRecord = Omit<CourseIndex, 'courses'> & { courses: CourseCardRecord[] };
export type CourseFileRecord = Omit<CourseFile, 'name'> & { name: CardText };

/** A course's full file: its card plus every tagged item. Fetched only on the course's own page. */
export interface CourseFile extends CourseCard {
  /** Step number → curriculum-aware lab routes, derived from the authored course map. */
  lab_routes: Record<number, string[]>;
  items: CourseItem[];
}

/* --------------------------------- the tabs ------------------------------- */

/**
 * The step page's seven tabs, in the order the plan fixes them. The order is presentation, the id
 * is identity: the deep link is `/course/:slug/:step?tab=practice`.
 */
export type CourseTab = 'lesson' | 'practice' | 'questions' | 'interview' | 'lab' | 'pdf' | 'notes';

export const COURSE_TABS: CourseTab[] = ['lesson', 'practice', 'questions', 'interview', 'lab', 'pdf', 'notes'];

/** Locale key per tab — the page translates these, the engine only names them. */
export const TAB_KEY: Record<CourseTab, string> = {
  lesson: 'courses.tab.lesson',
  practice: 'courses.tab.practice',
  questions: 'courses.tab.questions',
  interview: 'courses.tab.interview',
  lab: 'courses.tab.lab',
  pdf: 'courses.tab.pdf',
  notes: 'courses.tab.notes',
};

/** True for a tab id coming from a URL, so a typo falls back instead of rendering nothing. */
export function isCourseTab(v: string | null | undefined): v is CourseTab {
  return !!v && (COURSE_TABS as string[]).includes(v);
}

/** The items a tab shows. `notes` owns no items — it reads the learner's own note store. */
export function tabItems(items: CourseItem[], tab: CourseTab): CourseItem[] {
  switch (tab) {
    case 'lesson': return items.filter((i) => i.type === 'lesson');
    case 'practice': return items.filter((i) => i.type === 'practice');
    case 'questions': return items.filter((i) => i.type === 'question');
    case 'interview': return items.filter((i) => i.type === 'interview');
    // Projects have no tab of their own; a build IS the lab work of its step, and the row links
    // to the section's Project Lab stage rather than copying the brief in here.
    case 'lab': return items.filter((i) => i.type === 'lab' || i.type === 'project');
    case 'pdf': return items.filter((i) => typeof i.pdf_page === 'number');
    case 'notes': return [];
  }
}

/** Items per tab, for the little counters on the tab buttons. */
export function tabCounts(items: CourseItem[]): Record<CourseTab, number> {
  const out = {} as Record<CourseTab, number>;
  for (const tab of COURSE_TABS) out[tab] = tabItems(items, tab).length;
  return out;
}

/* ------------------------------- the measures ----------------------------- */

/**
 * Can this item carry a progress record?
 *
 * Practice/question/interview items are stored under the bank family, notebooks under their cell
 * family, projects under their section's project gate, mock rounds under the mock family — all real
 * records. A section lesson is measurable through its `view:<sid>:learn` marker. Two things are
 * deliberately NOT measurable: `reference` items (a track view is navigation, not work) and the
 * step's own lesson item (`ref.kind: 'step'`) — the roadmap has no "opened step" record, and
 * inventing one here would make a step look started the moment its page was visited.
 */
export function isMeasureable(item: CourseItem): boolean {
  if (item.type === 'reference') return false;
  if (item.type === 'lesson') return item.ref.kind === 'section';
  return true;
}

export type StepStatus = 'new' | 'active' | 'clear';

export interface StepMeasure {
  step: number;
  /** null = no honest denominator (a reading-only step): facts only, never a 0%. */
  pct: number | null;
  /** Where `pct` came from, so the page can state the denominator it is dividing by. */
  source: 'sections' | 'items' | 'none';
  /** Measurable items in this step. */
  items: number;
  /** How many of them the learner has started (a wrong answer still counts — coverage, not score). */
  touched: number;
  status: StepStatus;
}

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * One step's progress.
 *
 * `sectionPct` is the caller's average mastery of the step's own sections (null when the step owns
 * no section) and `isTouched` answers per item. A step whose sections exist uses mastery because
 * that is a percentage the rest of the app already gates on; a step without sections uses item
 * coverage. Nothing here reads the store — the caller supplies both answers.
 */
export function measureStep(args: {
  step: number;
  items: CourseItem[];
  sectionPct: number | null;
  isTouched: (item: CourseItem) => boolean;
}): StepMeasure {
  const measurable = args.items.filter(isMeasureable);
  let touched = 0;
  for (const item of measurable) if (args.isTouched(item)) touched += 1;

  let pct: number | null;
  let source: StepMeasure['source'];
  if (args.sectionPct !== null) {
    pct = clampPct(args.sectionPct);
    source = 'sections';
  } else if (measurable.length > 0) {
    pct = clampPct((touched / measurable.length) * 100);
    source = 'items';
  } else {
    pct = null;
    source = 'none';
  }

  // "Clear" is 100% of a real denominator. A step with no denominator is never cleared: it is
  // reading material, and reading material does not block a course from being finished — it is
  // simply excluded from every ratio below.
  const status: StepStatus = pct === null ? 'new' : pct >= 100 ? 'clear' : pct > 0 || touched > 0 ? 'active' : 'new';
  return { step: args.step, pct, source, items: measurable.length, touched, status };
}

/** A step's sections, from the course's own `sections` map (sectionId → step). */
export function sectionsOfStep(card: CourseCard, step: number): string[] {
  return Object.entries(card.sections ?? {})
    .filter(([, n]) => n === step)
    .map(([sid]) => sid)
    .sort();
}

/** The steps of a course, lowest first — the order the course page prints them in. */
export function stepsOf(card: CourseCard): number[] {
  return [...(card.steps ?? [])].sort((a, b) => a - b);
}

/**
 * Is this step one of THIS course's steps?
 *
 * A `/course/:slug/:step` URL carries two independent values: the slug, and a step number in the
 * roadmap's global 1…36 space. Checking only 1…36 is not enough — step 30 belongs to Build,
 * Production & System Design, and `/course/python/30` would then print another course's step under
 * Python's own header, with no items and no measure. The URL is legal only when the step is in
 * THIS course's list; anything else is a not-found, same as an unknown slug.
 */
export function hasStep(card: CourseCard, step: number): boolean {
  return Number.isInteger(step) && (card.steps ?? []).includes(step);
}

/** Every step's measure, keyed by step number, in the course's own order. */
export function measureSteps(
  file: CourseFile,
  sectionPctOf: (step: number) => number | null,
  isTouched: (item: CourseItem) => boolean,
): Map<number, StepMeasure> {
  const out = new Map<number, StepMeasure>();
  for (const step of stepsOf(file)) {
    out.set(step, measureStep({
      step,
      items: itemsOfStep(file.items, step),
      sectionPct: sectionPctOf(step),
      isTouched,
    }));
  }
  return out;
}

export interface CourseProgress {
  /** Average of every measurable step's pct — null while no step has a denominator. */
  pct: number | null;
  steps: { total: number; clear: number; measured: number; started: number };
  items: { total: number; touched: number };
}

export const EMPTY_PROGRESS: CourseProgress = {
  pct: null,
  steps: { total: 0, clear: 0, measured: 0, started: 0 },
  items: { total: 0, touched: 0 },
};

/** The course's own ratio, derived from its steps' measures. */
export function courseProgressFrom(measures: Map<number, StepMeasure>): CourseProgress {
  const list = [...measures.values()];
  const measured = list.filter((m) => m.pct !== null);
  return {
    pct: measured.length
      ? clampPct(measured.reduce((a, m) => a + (m.pct as number), 0) / measured.length)
      : null,
    steps: {
      total: list.length,
      clear: list.filter((m) => m.status === 'clear').length,
      measured: measured.length,
      started: list.filter((m) => m.touched > 0 || (m.pct ?? 0) > 0).length,
    },
    items: {
      total: list.reduce((a, m) => a + m.items, 0),
      touched: list.reduce((a, m) => a + m.touched, 0),
    },
  };
}

/**
 * Where "Continue" goes: the first step that still has a denominator and is not clear.
 *
 * Reading-only steps are skipped rather than blocking: step 01 has no record to complete, so
 * sending a finished learner back there forever would be a lie about what is left to do. When
 * every measured step is clear — or the course has none — the first step is the honest answer.
 *
 * Takes a `CourseCard`, not a `CourseFile`: the Dashboard runs this on the card-only measures
 * below, without ever fetching a course file.
 */
export function nextStep(card: CourseCard, measures: Map<number, StepMeasure>): number {
  const ordered = stepsOf(card);
  return ordered.find((n) => {
    const m = measures.get(n);
    return !!m && m.pct !== null && m.status !== 'clear';
  }) ?? ordered[0] ?? 1;
}

/**
 * One step's measure from the CARD alone — the Dashboard's rule, where no course file is fetched.
 *
 * A step with sections measures their mastery, the same figures the course page prints; a step
 * WITHOUT sections has no card-visible record at all (its items live in the course file), so it
 * reports `pct: null` — no denominator, the same honesty rule as everywhere else. Feed the result
 * to `nextStep`; do not use it where a real item count is required.
 */
export function cardMeasures(card: CourseCard, pctOf: (sid: string) => number): Map<number, StepMeasure> {
  const out = new Map<number, StepMeasure>();
  for (const step of stepsOf(card)) {
    const ids = sectionsOfStep(card, step);
    const sectionPct = ids.length
      ? Math.round(ids.reduce((a, sid) => a + pctOf(sid), 0) / ids.length)
      : null;
    out.set(step, measureStep({ step, items: [], sectionPct, isTouched: () => false }));
  }
  return out;
}

/**
 * Which course the learner is "in": the STARTED, UNFINISHED course with the most section mastery
 * (a tie goes to the lower course number).
 *
 * Derived, never stored — the Dashboard has no per-course record to read, and section mastery is
 * the only per-course signal `index.json` can answer. A course that owns no section is therefore
 * never "active": nothing in the card can say the learner touched it, and guessing would be a
 * figure that is not backed by state. `null` when no course has section work yet.
 */
export function activeCourse(cards: CourseCard[], pctOf: (sid: string) => number): CourseCard | null {
  const started = cards
    .map((card) => ({ card, avg: sectionAvg(card, pctOf) }))
    .filter((entry): entry is { card: CourseCard; avg: number } => entry.avg !== null && entry.avg > 0)
    .filter((entry) => sectionsClear(entry.card, pctOf) < Object.keys(entry.card.sections ?? {}).length);
  started.sort((a, b) => b.avg - a.avg || a.card.number - b.card.number);
  return started[0]?.card ?? null;
}

/**
 * A course card's section signal — the only progress `/courses` can print without fetching the
 * course's (up to 1.5 MB) item file. `null` when the course owns no section, so a card shows its
 * real counts instead of a ring nobody can fill.
 */
export function sectionAvg(card: CourseCard, pctOf: (sid: string) => number): number | null {
  const ids = Object.keys(card.sections ?? {});
  if (!ids.length) return null;
  return clampPct(ids.reduce((a, sid) => a + pctOf(sid), 0) / ids.length);
}

/** How many of a course's sections are fully mastered. */
export function sectionsClear(card: CourseCard, pctOf: (sid: string) => number): number {
  return Object.keys(card.sections ?? {}).filter((sid) => pctOf(sid) >= 100).length;
}

/* --------------------------- the owning course ---------------------------- */

/**
 * Which course owns a step — the resolver every surface needs now that the standalone Learning
 * Path is gone.
 *
 * `content/courses/courses.json` partitions the roadmap's 1…36 across the eleven courses, so a
 * step number can always be answered with a real course step page instead of a route that no
 * longer exists. `null` for a step no course lists (a typo, or a roadmap that grew).
 */
export function courseOfStep(cards: CourseCard[], step: number): CourseCard | null {
  return cards.find((c) => (c.steps ?? []).includes(step)) ?? null;
}

/**
 * The course step that teaches a curriculum section, from the plan's own `sections` map
 * (sectionId → step) — the same map the generator tags notebook and question items from. `null`
 * when no course claims the section, so a caller falls back to `/courses` instead of guessing.
 */
export function courseOfSection(cards: CourseCard[], sid: string): { card: CourseCard; step: number } | null {
  for (const card of cards) {
    const step = (card.sections ?? {})[sid];
    if (typeof step === 'number') return { card, step };
  }
  return null;
}

/**
 * Which PDF a page number belongs to.
 *
 * The app carries TWO books and the pages are different spaces: the Playbook V15 document (read at
 * `/pdf/playbook/:page`) and the curriculum guide (`/pdf/:page`). A step's own lesson and its
 * practice items are chapter pages of the PLAYBOOK; a section lesson and a bank question carry the
 * GUIDE's page. Mixing them would open the right number in the wrong book, which is worse than no
 * link at all.
 */
export type PdfSource = 'playbook' | 'guide';

export function pdfSourceOf(item: CourseItem): PdfSource | null {
  if (typeof item.pdf_page !== 'number') return null;
  if (item.ref.kind === 'step' || item.ref.kind === 'playbook') return 'playbook';
  if (item.ref.kind === 'section' || item.ref.kind === 'question') return 'guide';
  return null;
}

/** The distinct pages of one book inside a set of items, ascending. */
export function pdfPages(items: CourseItem[], source: PdfSource): number[] {
  const out = new Set<number>();
  for (const item of items) {
    if (pdfSourceOf(item) !== source) continue;
    out.add(item.pdf_page as number);
  }
  return [...out].sort((a, b) => a - b);
}

/* -------------------------------- the helpers ----------------------------- */

export function itemsOfStep(items: CourseItem[], step: number): CourseItem[] {
  return items.filter((i) => i.chapter === step);
}
