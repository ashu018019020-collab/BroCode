import {
  ALL_PLACEMENTS,
  COURSE_LEVELS,
  isCourseLevelId,
  levelIndex,
  type CourseLevelId,
  type CoursePlacement,
} from './course-levels';

/**
 * Owner-authored course cards.
 *
 * The eleven catalog courses are AUTHORED CONTENT: their pages, steps, questions and every stored
 * progress record are keyed by the slug the generator publishes. A dashboard cannot rewrite or
 * delete them without breaking links and orphaning progress, which is why `course_placement` only
 * moves/hides them.
 *
 * This module is the other half of that rule: the cards the OWNER really can create and delete.
 * A custom course is a curated entry point — a name, a mark, a level and the page it opens — and it
 * owns no content of its own, so removing one can never orphan a learner's record. Everything here
 * is pure: the database row shapes are validated and normalised before any component sees them, so
 * a hand-edited row, an unknown logo or a stale level degrades to "not shown" rather than a broken
 * card. The Supabase adapter is `core/data/owner-courses.ts`.
 */

/** The bundled marks a custom card may use — the same eleven every catalog course ships. */
export const OWNER_LOGO_KEYS = [
  'brain', 'r', 'python', 'numpy-pandas', 'postgresql', 'spark',
  'scikitlearn', 'llm', 'agent', 'docker', 'briefcase',
] as const;

/** The tone families already defined in `styles.css`; an unknown one would render colourless. */
export const OWNER_TONES = [
  'cyan', 'blue', 'green', 'violet', 'purple', 'pink', 'gold', 'orange',
] as const;

export type OwnerLogoKey = (typeof OWNER_LOGO_KEYS)[number];
export type OwnerTone = (typeof OWNER_TONES)[number];

export const OWNER_NAME_LIMIT = 80;
export const OWNER_SUMMARY_LIMIT = 240;
export const OWNER_SLUG_LIMIT = 48;
export const OWNER_HREF_LIMIT = 200;

/** A row exactly as the database stores it (`level`/`tone`/`logo` are free text there). */
export interface OwnerCourseRow {
  slug: string;
  name: string;
  summary: string;
  href: string;
  logo: string;
  tone: string;
  level: string;
  order: number;
  optional: boolean;
  hidden: boolean;
  deletedAt: string | null;
}

/** A row that passed validation — this is what a card renders from. */
export interface OwnerCourseCard {
  slug: string;
  name: string;
  summary: string;
  href: string;
  logo: string;
  tone: string;
  level: CourseLevelId;
  order: number;
  optional: boolean;
  hidden: boolean;
}

/** The editable fields a dashboard form submits. */
export interface OwnerCourseDraft {
  slug: string;
  name: string;
  summary: string;
  href: string;
  logo: string;
  tone: string;
  level: string;
  order: number;
}

/**
 * A name → slug, deterministic and route-safe.
 *
 * Diacritics are folded first ("Café" → "cafe") so the slug is ASCII; everything else that is not a
 * letter or digit becomes one hyphen. The result is trimmed and capped, because the column is 48
 * characters and a slug is an identity: the same name must always produce the same one.
 */
export function slugifyCourseName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, OWNER_SLUG_LIMIT)
    .replace(/-+$/g, '');
}

/** 3–48 characters, starts and ends with a letter or digit, hyphens only inside. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;

/**
 * Where a card may open: an INTERNAL app path only.
 *
 * A custom card is a door into this app, not a redirect: `//evil.example` is a protocol-relative
 * URL and an absolute `https://` link would both turn an owner typo into an open redirect, so both
 * are refused here rather than trusted at render time. Whitespace and backslashes are refused too,
 * because browsers normalise them into characters the check above did not see.
 */
export function ownerHrefProblem(href: string): string | null {
  const value = href.trim();
  if (!value) return 'Choose where the card opens, like /questions?type=coding.';
  if (value.length > OWNER_HREF_LIMIT) return `Keep the link under ${OWNER_HREF_LIMIT} characters.`;
  if (!value.startsWith('/') || value.startsWith('//')) {
    return 'The link must be an app path that starts with one "/", like /questions?type=coding.';
  }
  if (/\s/.test(value) || value.includes('\\')) return 'The link cannot contain spaces or backslashes.';
  return null;
}

/**
 * ONE validation for the form and for rows read back from the database.
 *
 * Returns the first problem as a sentence for the owner, or null. Built-in slugs are rejected here
 * because a custom card may never shadow a catalog course: the catalog card and its progress would
 * become unreachable behind a linked duplicate.
 */
export function ownerCourseProblem(draft: OwnerCourseDraft): string | null {
  const name = draft.name.trim();
  if (name.length < 2) return 'Give the course a name (at least 2 characters).';
  if (name.length > OWNER_NAME_LIMIT) return `Keep the name under ${OWNER_NAME_LIMIT} characters.`;
  if ((draft.summary ?? '').trim().length > OWNER_SUMMARY_LIMIT) {
    return `Keep the one-line summary under ${OWNER_SUMMARY_LIMIT} characters.`;
  }
  const slug = draft.slug.trim();
  if (!SLUG_RE.test(slug)) {
    return 'The slug needs 3–48 lowercase letters, digits or hyphens, and must start and end with a letter or digit.';
  }
  if (ALL_PLACEMENTS.some((placement) => placement.slug === slug)) {
    return 'That slug belongs to a built-in course — pick another one.';
  }
  const hrefProblem = ownerHrefProblem(draft.href);
  if (hrefProblem) return hrefProblem;
  if (!(OWNER_LOGO_KEYS as readonly string[]).includes(draft.logo)) return 'Pick one of the bundled logos.';
  if (!(OWNER_TONES as readonly string[]).includes(draft.tone)) return 'Pick one of the colour tones.';
  if (!isCourseLevelId(draft.level)) return 'Pick one of the six levels.';
  if (!Number.isInteger(draft.order) || draft.order < 1 || draft.order > 999) return 'The position must be 1–999.';
  return null;
}

/**
 * The cards a learner may see: validated, deduplicated, archived rows dropped, in journey order.
 *
 * Invalid rows are DROPPED rather than thrown: this list is rendered on the public Courses page, so
 * one malformed row (a level removed from the code, a logo deleted from the pack) must cost that
 * row only — never the page. First row wins on a duplicate slug, because the table's primary key
 * makes that impossible anyway and the rule should not depend on it.
 */
export function ownerCourseCards(rows: readonly OwnerCourseRow[] | null | undefined): OwnerCourseCard[] {
  if (!rows?.length) return [];
  const seen = new Set<string>();
  const cards: OwnerCourseCard[] = [];
  for (const row of rows) {
    if (row.deletedAt) continue;
    if (seen.has(row.slug)) continue;
    const draft: OwnerCourseDraft = {
      slug: row.slug,
      name: row.name ?? '',
      summary: row.summary ?? '',
      href: row.href ?? '',
      logo: row.logo,
      tone: row.tone,
      level: row.level,
      order: row.order,
    };
    if (ownerCourseProblem(draft)) continue;
    seen.add(row.slug);
    cards.push({
      slug: draft.slug.trim(),
      name: draft.name.trim(),
      summary: (draft.summary ?? '').trim(),
      href: draft.href.trim(),
      logo: draft.logo,
      tone: draft.tone,
      level: draft.level as CourseLevelId,
      order: Math.round(draft.order),
      optional: Boolean(row.optional),
      hidden: Boolean(row.hidden),
    });
  }
  return cards.sort(
    (a, b) => levelIndex(a.level) - levelIndex(b.level)
      || a.order - b.order
      || a.name.localeCompare(b.name),
  );
}

/** The journey placements a custom card contributes, so `/courses` can interleave it. */
export function ownerCoursePlacements(cards: readonly OwnerCourseCard[]): CoursePlacement[] {
  return cards.map((card) => ({
    slug: card.slug,
    level: card.level,
    order: card.order,
    blurb: card.summary,
    prerequisites: [],
    optional: card.optional,
    hidden: card.hidden,
  }));
}

/** The student journey's custom cards: the ones the owner has not stood down. */
export function visibleOwnerCards(cards: readonly OwnerCourseCard[]): OwnerCourseCard[] {
  return cards.filter((card) => !card.hidden);
}

/** The next free position inside a level, so a new card lands at the end instead of colliding. */
export function nextOwnerOrder(cards: readonly OwnerCourseCard[], level: string): number {
  const used = cards
    .filter((card) => card.level === level)
    .reduce((max, card) => Math.max(max, card.order), 0);
  return Math.min(999, used + 1);
}

/** The six levels, re-exported so a form can list them without importing the whole registry. */
export const OWNER_LEVELS = COURSE_LEVELS;
