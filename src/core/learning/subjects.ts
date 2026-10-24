/**
 * The practice subjects — the eight tracks, as the axis a learner DRILLS by.
 *
 * The practice pillar opened on the bank's own section list, which answers "which section?" but not
 * the question a learner arrives with: "which subject do I want to work on today?" A subject here is
 * a TRACK, which is the app's own word for it (`path.tracksTitle`: "8 tracks — the subjects this road
 * is made of"), and its chapters are the published sections inside its range.
 *
 * Nothing is re-declared. The range comes from the track registry (`TRACK_DEFS`), the chapters and
 * every count come from the bank manifest the Question Bank itself reads — so a subject card can
 * never promise a number the page it opens cannot show. `scripts/tests/practice.test.mjs` pins the
 * ranges against the published track files AND against the section numbers that actually exist.
 *
 * Pure on purpose: no React, no store, no fetch, so the arithmetic is driven with fixtures under
 * `node --test` (see the loader ceiling in AGENTS.md).
 */

/** A track's section range, keyed by the track id the subject cards are selected with. */
export interface SubjectRange {
  id: string;
  /** First and last curriculum section number, inclusive — the published track's own range. */
  from: number;
  to: number;
}

/** One published section, as the bank manifest describes it. */
export interface ManifestChapterLike {
  sectionId: string;
  no: number;
  title: string;
  /** Questions the learner can actually see (drafts excluded) — never `total`. */
  published: number;
  byType: Record<string, number>;
}

/** A section as a subject renders it: identity, its counts, and what the learner has answered. */
export interface SubjectChapter {
  id: string;
  no: number;
  title: string;
  published: number;
  byType: Record<string, number>;
  /** Answers that exist for this section (written or graded). 0 when the caller passes no tally. */
  answered: number;
}

/** Every subject a section number falls inside. The ranges are meant to hold exactly one. */
export function subjectsOf(no: number, ranges: SubjectRange[]): SubjectRange[] {
  return ranges.filter((r) => no >= r.from && no <= r.to);
}

/** The subject a section number belongs to, or null — a section no range covers is nobody's. */
export function subjectOf(no: number, ranges: SubjectRange[]): SubjectRange | null {
  return subjectsOf(no, ranges)[0] ?? null;
}

/**
 * The published sections a subject owns, in section order, joined with the learner's own answers.
 *
 * `answered` is the per-section coverage tally (`bankAccuracyBySection`) keyed by section id; a
 * section the learner has never touched simply reads 0, which is the honest answer for a subject
 * nobody has started.
 */
export function chaptersOf(
  sections: ManifestChapterLike[],
  range: SubjectRange,
  answered: Record<string, number> = {},
): SubjectChapter[] {
  return sections
    .filter((s) => s.no >= range.from && s.no <= range.to)
    .sort((a, b) => a.no - b.no)
    .map((s) => ({
      id: s.sectionId,
      no: s.no,
      title: s.title,
      published: s.published,
      byType: s.byType ?? {},
      answered: answered[s.sectionId] ?? 0,
    }));
}

export interface SubjectCounts {
  /** Published questions the subject holds, all types. */
  questions: number;
  /** Published questions of the chosen type — equals `questions` when the type is `'all'`. */
  typed: number;
  /** Answers that exist across the subject's chapters. */
  answered: number;
  /** Chapters that hold at least one question of the chosen type. */
  typedChapters: number;
}

/**
 * What a subject holds, and how much of it is the chosen type.
 *
 * One loop for both numbers on purpose: the line "1,240 questions · 180 coding" and the count on
 * every chapter row come out of the same sum, so the header can never disagree with the rows under
 * it. An unknown type counts zero instead of falling back to everything — a filter that does not
 * exist must read as empty, never as unfiltered.
 */
export function subjectCounts(chapters: SubjectChapter[], type: string | 'all' = 'all'): SubjectCounts {
  let questions = 0;
  let typed = 0;
  let answered = 0;
  let typedChapters = 0;
  for (const c of chapters) {
    const ofType = type === 'all' ? c.published : c.byType[type] ?? 0;
    questions += c.published;
    typed += ofType;
    answered += c.answered;
    if (ofType > 0) typedChapters += 1;
  }
  return { questions, typed, answered, typedChapters };
}

/**
 * The chapter "Start practice" opens: the FIRST chapter with items of the chosen type, or null when
 * the subject holds none of it. First and not "random" or "biggest": the chapters are the course's
 * own order, so the drill starts where the subject starts.
 */
export function startChapter(chapters: SubjectChapter[], type: string | 'all' = 'all'): SubjectChapter | null {
  return chapters.find((c) => (type === 'all' ? c.published : (c.byType[type] ?? 0)) > 0) ?? null;
}

/**
 * The section numbers no subject covers, given the numbers that exist.
 *
 * Exported because "every section belongs to a subject" is the one invariant the subject layer can
 * actually break: the ranges are typed into the track registry, while the sections are published, so
 * a re-import that adds a section would leave it unreachable from practice with no error anywhere.
 */
export function uncoveredSections(sections: number[], ranges: SubjectRange[]): number[] {
  return sections.filter((no) => subjectsOf(no, ranges).length === 0).sort((a, b) => a - b);
}
