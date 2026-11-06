/**
 * The Courses page's LEARNING ARCHITECTURE — levels, order and prerequisites.
 *
 * The published pack (`content/courses/courses.json` → `generated/courses/index.json`) is a
 * CATALOG: it knows which steps and sections a course owns, never which course a learner should
 * meet first. The order the generator happens to emit is the authoring order, and `index.json`'s
 * `number` is only a stable id — neither is a learning path.
 *
 * So this module owns the journey: six levels, the position of every published course inside
 * them, and the prerequisite edges the cards show. It is pure data + pure functions with no
 * imports, so the Courses page, the course page and the tests all read ONE order.
 *
 * Two rules are deliberate:
 *
 *   · EVERY published course must be placed here, exactly once. The test compares this list
 *     against the real `generated/courses/index.json`, so a new course cannot silently land at the
 *     bottom of the page — it has to be given a level.
 *   · A PREREQUISITE NEVER LOCKS ANYTHING. It is displayed on the card as context ("after Python"),
 *     never enforced: every course is already open, and hiding one would break the promise the
 *     roadmap makes that a learner can jump anywhere.
 */

export type CourseLevelId =
  | 'beginner'
  | 'foundations'
  | 'intermediate'
  | 'advanced'
  | 'professional'
  | 'career';

export interface CourseLevel {
  id: CourseLevelId;
  /** 1-based, printed as "LEVEL 01" — the level's position in the journey, never a sort hack. */
  no: number;
  title: string;
  /** One sentence: who this level is for and what changes by the end of it. */
  blurb: string;
  /** Difficulty label shown on the cards of this level. */
  difficulty: string;
  /** One of the `.tone-*` families already used across the app. */
  tone: string;
}

/** The six levels, in the order they are walked. `no` and array position always agree. */
export const COURSE_LEVELS: CourseLevel[] = [
  {
    id: 'beginner', no: 1, title: 'Beginner', difficulty: 'Beginner', tone: 'cyan',
    blurb: 'Start here: what an AI career actually looks like, and the Python you need to begin.',
  },
  {
    id: 'foundations', no: 2, title: 'Core Foundations', difficulty: 'Beginner → Core', tone: 'blue',
    blurb: 'The tools under every AI stack: systems programming, statistics, dataframes and SQL.',
  },
  {
    id: 'intermediate', no: 3, title: 'Intermediate', difficulty: 'Intermediate', tone: 'violet',
    blurb: 'Move from tidy notebooks to pipelines that carry data, and models that learn from it.',
  },
  {
    id: 'advanced', no: 4, title: 'Advanced AI', difficulty: 'Advanced', tone: 'purple',
    blurb: 'Build with LLMs, then give them tools, memory and a loop that can act on its own.',
  },
  {
    id: 'professional', no: 5, title: 'Professional', difficulty: 'Professional', tone: 'gold',
    blurb: 'Ship it: deployment, reliability, evaluation and system design that survives real users.',
  },
  {
    id: 'career', no: 6, title: 'Career Ready', difficulty: 'Career', tone: 'pink',
    blurb: 'Turn the work you have done into interviews, a portfolio and an offer.',
  },
];

export interface CoursePlacement {
  /** The published course slug — the same id the catalog, routes and progress records use. */
  slug: string;
  level: CourseLevelId;
  /** Position INSIDE its level, 1-based. Never alphabetical, never insertion order. */
  order: number;
  /** One line for the card: what the course gives the learner. */
  blurb: string;
  /** Slugs this course builds on. DISPLAY ONLY — nothing is locked. */
  prerequisites: string[];
  /** A complementary course: real content, not on the critical path. */
  optional?: boolean;
  /**
   * Stood down by the owner: the course is not drawn in the journey. Its page, route, ids and the
   * learner's progress are all untouched — this is a VISIBILITY switch, not a deletion, because the
   * content is authored in `content/` and cannot be rewritten from a dashboard.
   */
  hidden?: boolean;
}

/**
 * The eleven published courses, placed. The sequence is the platform's pedagogical order:
 * orientation → Python → the data/C foundations → pipelines → models → LLMs → agents → shipping →
 * interviews. `C Programming` is not a catalog course (it is its own course page), so it is placed
 * separately in `C_COMPLEMENT` rather than invented as a twelfth catalog record.
 */
export const COURSE_PLACEMENTS: CoursePlacement[] = [
  {
    slug: 'ai-career-foundations', level: 'beginner', order: 1,
    blurb: 'The map of the field, the roles, and the study plan this platform follows.',
    prerequisites: [],
  },
  {
    slug: 'python', level: 'beginner', order: 2,
    blurb: 'The language every later course writes its code in — from syntax to real scripts.',
    prerequisites: ['ai-career-foundations'],
  },
  {
    slug: 'statistics-data-analysis', level: 'foundations', order: 2,
    blurb: 'Distributions, sampling and inference: how to tell a real result from noise.',
    prerequisites: ['ai-career-foundations'],
  },
  {
    slug: 'numpy-pandas', level: 'foundations', order: 3,
    blurb: 'Vectors and dataframes — the two shapes almost all AI work is expressed in.',
    prerequisites: ['python', 'statistics-data-analysis'],
  },
  {
    slug: 'sql', level: 'foundations', order: 4,
    blurb: 'Ask questions of data where it lives, and join tables without losing rows.',
    prerequisites: ['ai-career-foundations'],
  },
  {
    slug: 'data-engineering', level: 'intermediate', order: 1,
    blurb: 'Pipelines, ingestion and storage that keep data correct after the notebook closes.',
    prerequisites: ['sql', 'numpy-pandas'],
  },
  {
    slug: 'ml-nlp', level: 'intermediate', order: 2,
    blurb: 'Supervised models, evaluation and text — from first baseline to a tuned model.',
    prerequisites: ['numpy-pandas', 'statistics-data-analysis'],
  },
  {
    slug: 'generative-ai', level: 'advanced', order: 1,
    blurb: 'Prompts, embeddings, RAG and evaluation for systems built on large models.',
    prerequisites: ['ml-nlp'],
  },
  {
    slug: 'agentic-ai', level: 'advanced', order: 2,
    blurb: 'Tools, memory and planning: agents that do multi-step work without a human in the loop.',
    prerequisites: ['generative-ai'],
  },
  {
    slug: 'build-production', level: 'professional', order: 1,
    blurb: 'Deploy, monitor, secure and design the system around the model.',
    prerequisites: ['agentic-ai', 'data-engineering'],
  },
  {
    slug: 'interview-career', level: 'career', order: 1,
    blurb: 'Interview rounds, portfolio and the job search — the last stage, not a side page.',
    prerequisites: ['build-production'],
  },
];

/**
 * C Programming is a real course with its own page, labs and projects, but it is NOT one of the
 * eleven catalog records: the pack has no `c-programming.json`. Placing it here lets the Courses
 * page show the twelfth card honestly — marked optional, with its own module progress — without
 * fabricating a catalog entry or duplicating the course.
 */
export const C_COMPLEMENT: CoursePlacement = {
  slug: 'c-programming',
  level: 'foundations',
  order: 1,
  blurb: 'Optional companion: pointers, memory and the machine model behind every higher language.',
  prerequisites: ['python'],
  optional: true,
};

/** The built-in answer: the eleven catalog courses plus the optional C companion. */
export const ALL_PLACEMENTS: CoursePlacement[] = [...COURSE_PLACEMENTS, C_COMPLEMENT];

/** A database row that moves one course: the only fields an owner may change. */
export interface PlacementOverride {
  slug: string;
  level: CourseLevelId;
  order: number;
  optional?: boolean;
  hidden?: boolean;
}

export function isCourseLevelId(value: unknown): value is CourseLevelId {
  return typeof value === 'string' && COURSE_LEVELS.some((level) => level.id === value);
}

/**
 * Apply database overrides to the built-in journey.
 *
 * Unknown slugs and unknown levels are IGNORED rather than trusted: a hand-edited or stale row must
 * never hide a course or invent a seventh level, and the built-in registry stays the floor. Blurbs
 * and prerequisites are not editable through this table — they stay authored in code.
 */
export function mergePlacements(overrides: readonly PlacementOverride[]): CoursePlacement[] {
  const bySlug = new Map<string, PlacementOverride>();
  for (const row of overrides) {
    if (!isCourseLevelId(row.level)) continue;
    if (!Number.isFinite(row.order)) continue;
    if (!ALL_PLACEMENTS.some((p) => p.slug === row.slug)) continue;
    bySlug.set(row.slug, row);
  }
  return ALL_PLACEMENTS.map((base) => {
    const row = bySlug.get(base.slug);
    if (!row) return base;
    return {
      ...base,
      level: row.level,
      order: Math.max(1, Math.round(row.order)),
      optional: row.optional ?? base.optional,
      hidden: row.hidden ?? base.hidden,
    };
  });
}

/**
 * The cards a learner may see: everything except the courses the owner has stood down.
 *
 * Filtering happens HERE rather than inside `groupByLevel` because the owner editor draws the
 * hidden rows too — it needs the full journey to be able to restore one. Callers that render the
 * student journey pass their catalog through this; the course page and its progress records are
 * never touched, so a restored course comes back with its history intact.
 */
export function withoutHidden<T extends { slug: string }>(
  cards: readonly T[],
  list: readonly CoursePlacement[] = ALL_PLACEMENTS,
): T[] {
  const hidden = new Set(list.filter((p) => p.hidden).map((p) => p.slug));
  return hidden.size ? cards.filter((card) => !hidden.has(card.slug)) : [...cards];
}

/** Every placed slug, in journey order (the complementary course included). */
export const COURSE_ORDER: string[] = [...ALL_PLACEMENTS]
  .sort((a, b) => levelIndex(a.level) - levelIndex(b.level) || a.order - b.order)
  .map((p) => p.slug);

export function levelIndex(id: CourseLevelId): number {
  return COURSE_LEVELS.findIndex((level) => level.id === id);
}

export function levelOf(id: CourseLevelId): CourseLevel {
  return COURSE_LEVELS[levelIndex(id)];
}

export function placementOf(slug: string, list: readonly CoursePlacement[] = ALL_PLACEMENTS): CoursePlacement | null {
  return list.find((p) => p.slug === slug) ?? null;
}

/**
 * The rank of a slug in the journey. Unknown slugs sort LAST rather than throwing: a course added
 * to the pack before it is placed here must still render (at the end, visibly unplaced), never
 * vanish from the page.
 */
export function courseRank(slug: string, list: readonly CoursePlacement[] = ALL_PLACEMENTS): number {
  const placement = placementOf(slug, list);
  if (!placement) return Number.MAX_SAFE_INTEGER;
  return levelIndex(placement.level) * 100 + placement.order;
}

/** The explicit order, applied. Never alphabetical, never the generator's insertion order. */
export function sortByCourseOrder<T extends { slug: string }>(
  cards: readonly T[],
  list: readonly CoursePlacement[] = ALL_PLACEMENTS,
): T[] {
  return [...cards].sort((a, b) => courseRank(a.slug, list) - courseRank(b.slug, list) || a.slug.localeCompare(b.slug));
}

export interface LevelGroup<T> {
  level: CourseLevel;
  cards: T[];
  /** Cards that are on the critical path (the complementary course is excluded). */
  required: T[];
}

/**
 * Cards grouped into the six levels, each group in course order. An unknown slug joins the LAST
 * group so it is visible instead of dropped; `placementOf` can then be extended deliberately.
 */
export function groupByLevel<T extends { slug: string }>(
  cards: readonly T[],
  list: readonly CoursePlacement[] = ALL_PLACEMENTS,
): LevelGroup<T>[] {
  const groups: LevelGroup<T>[] = COURSE_LEVELS.map((level) => ({ level, cards: [], required: [] }));
  for (const card of sortByCourseOrder(cards, list)) {
    const placement = placementOf(card.slug, list);
    const at = placement ? levelIndex(placement.level) : COURSE_LEVELS.length - 1;
    groups[at].cards.push(card);
    if (!placement?.optional) groups[at].required.push(card);
  }
  return groups;
}

/** Display names for a card's prerequisite slugs, skipping the ones that are not placed. */
export function prerequisiteNames(
  slug: string,
  names: Record<string, string>,
  list: readonly CoursePlacement[] = ALL_PLACEMENTS,
): string[] {
  const placement = placementOf(slug, list);
  if (!placement) return [];
  return placement.prerequisites.map((pre) => names[pre]).filter((name): name is string => Boolean(name));
}

/** The next course to open: the first required course, in journey order, that is not finished. */
export function nextCourse<T extends { slug: string }>(
  cards: readonly T[],
  pctOf: (card: T) => number | null,
  list: readonly CoursePlacement[] = ALL_PLACEMENTS,
): T | null {
  for (const card of sortByCourseOrder(cards, list)) {
    const placement = placementOf(card.slug, list);
    if (placement?.optional || placement?.hidden) continue;
    const pct = pctOf(card);
    if (pct === null || pct < 100) return card;
  }
  return null;
}
