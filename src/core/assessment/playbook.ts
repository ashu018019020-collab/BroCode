/**
 * Playbook V15 — the second source, as data rather than as a page.
 *
 * The 477 imported items do NOT live here. Every one of them was merged into the bank of the
 * section it belongs to (`scripts/questions.cjs` → `cmdPlaybook`), so practice has exactly one
 * home and exactly one place to save an answer. What this module owns is the derivation the
 * Learning Path needs: how much of the document reached each of the 8 tracks, and how much of it
 * the learner has actually practised.
 *
 * Pure on purpose — no React, no store, no fetch, and no value imports at all (Node's type
 * stripping cannot resolve an extensionless relative import, so a value import here would make
 * the module unimportable). `scripts/tests/playbook.test.mjs` loads it directly and drives it
 * with fixtures, so the numbers the path prints are the numbers the tests pin.
 */

export interface PbChapter {
  no: string;
  title: string;
  pdfPage: number;
  sectionId: string;
  sections: Record<string, number>;
  items: number;
  byType: Record<string, number>;
}

export interface PbTotals {
  items: number;
  byType: Record<string, number>;
  bySection: Record<string, number>;
  labs: number;
  miniProjectBlueprints: number;
  miniProjectCapstones: number;
  complexityRows: number;
  logicSteps: number;
  methodAnswers: number;
}

export interface PbIndex {
  generatedAt: string;
  source: string;
  pages: number;
  totals: PbTotals;
  chapters: PbChapter[];
}

export interface PbItem {
  id: string;
  sectionId: string;
  sectionTitle: string;
  type: string;
  difficulty: string;
  chapter: string;
  question: string;
  answer: string;
  /** The document's own method line (a rubric, not a model answer) — labelled, never hidden. */
  selfGrade: boolean;
}

export interface PbTrackDef {
  id: string;
  /** First and last curriculum section number of the track, 1-indexed. */
  from: number;
  to: number;
}

export interface PbSectionRef {
  id: string;
  no: number;
  title: string;
}

export interface PbTrackSection {
  id: string;
  no: number;
  title: string;
  items: number;
  touched: number;
}

export interface PbTrackRow {
  trackId: string;
  items: number;
  chapters: number;
  touched: number;
  /** First playbook page this track's chapters came from, or null when nothing landed there. */
  pdfPage: number | null;
  /** Where "Practice" should land: the section of this track with the most V15 items. */
  topSection: string | null;
  /** Every section of the track, biggest contributor first — kept even at 0 items. */
  sections: PbTrackSection[];
}

/** Where each kind of playbook item can actually be practised. */
export const STAGE_OF_TYPE: Record<string, string> = {
  interview: 'interview',
  checkpoint: 'checkpoint',
  defense: 'defense',
  coding: 'coding',
  theory: 'learn',
  logic: 'logic',
};

export const ACTION_OF_TYPE: Record<string, string> = {
  interview: 'Interview Q&A',
  checkpoint: 'Checkpoint',
  defense: 'Defense',
  coding: 'Coding lab',
  theory: 'Theory',
  logic: 'Logic',
};

/**
 * V15 items per section.
 *
 * `items.json` is the authority when it loaded (it is derived from the banks, so it can never
 * disagree with what the learner can actually open); the manifest's own `bySection` is the
 * fallback for the moment before it arrives.
 */
export function sectionTotals(index: PbIndex | null, items: PbItem[] | null): Record<string, number> {
  const totals: Record<string, number> = {};
  if (items && items.length) {
    for (const it of items) totals[it.sectionId] = (totals[it.sectionId] ?? 0) + 1;
    return totals;
  }
  return { ...(index?.totals.bySection ?? {}) };
}

/** How many items of each section the learner has practised, from a caller-supplied predicate. */
export function touchedBySection(items: PbItem[] | null, isTouched: (itemId: string) => boolean): Record<string, number> {
  const touched: Record<string, number> = {};
  for (const it of items ?? []) {
    if (isTouched(it.id)) touched[it.sectionId] = (touched[it.sectionId] ?? 0) + 1;
  }
  return touched;
}

/**
 * One row per track — ALWAYS one row per track, in the order the tracks were given, even when
 * nothing of the playbook landed there. The roadmap never hides a track, so a zero row has to be
 * renderable and honest ("V15 practice isi track me nahi") rather than quietly dropped.
 *
 * A chapter counts towards a track when any section it contributed to falls inside the track's
 * range — the document's chapters do not line up with the curriculum's sections one-to-one, so
 * the section list on each chapter is the only honest attribution.
 */
export function trackCoverage(
  index: PbIndex | null,
  items: PbItem[] | null,
  sections: PbSectionRef[],
  tracks: PbTrackDef[],
  isTouched: (itemId: string) => boolean,
): PbTrackRow[] {
  const totals = sectionTotals(index, items);
  const touched = touchedBySection(items, isTouched);

  return tracks.map((tr) => {
    const own = sections.filter((s) => s.no >= tr.from && s.no <= tr.to);
    const ids = new Set(own.map((s) => s.id));
    const rows: PbTrackSection[] = own
      .map((s) => ({ id: s.id, no: s.no, title: s.title, items: totals[s.id] ?? 0, touched: touched[s.id] ?? 0 }))
      // Biggest contributor first: "Practice" must land on a section that really has items.
      .sort((a, b) => b.items - a.items || a.no - b.no);

    const chapters = (index?.chapters ?? []).filter(
      (c) => c.items > 0 && (ids.has(c.sectionId) || Object.keys(c.sections).some((sid) => ids.has(sid))),
    );
    const pages = chapters.map((c) => c.pdfPage).filter((p) => Number.isFinite(p) && p > 0);

    return {
      trackId: tr.id,
      items: rows.reduce((a, s) => a + s.items, 0),
      chapters: chapters.length,
      touched: rows.reduce((a, s) => a + s.touched, 0),
      pdfPage: pages.length ? Math.min(...pages) : null,
      topSection: rows.find((s) => s.items > 0)?.id ?? null,
      sections: rows,
    };
  });
}

export interface PbTarget {
  sectionId: string;
  sectionTitle: string;
  no: number;
  remaining: number;
}

/**
 * The single most useful V15 section to open next: the one with the most items still untouched.
 * Null when every imported item has been practised (or nothing is imported yet) — the rail then
 * says so instead of pointing at a finished section.
 */
export function nextPlaybookTarget(
  index: PbIndex | null,
  items: PbItem[] | null,
  sections: PbSectionRef[],
  isTouched: (itemId: string) => boolean,
): PbTarget | null {
  const totals = sectionTotals(index, items);
  const touched = touchedBySection(items, isTouched);
  let best: PbTarget | null = null;
  for (const [sid, total] of Object.entries(totals)) {
    const remaining = total - (touched[sid] ?? 0);
    if (remaining <= 0) continue;
    const sec = sections.find((s) => s.id === sid);
    if (!sec) continue;
    if (!best || remaining > best.remaining) {
      best = { sectionId: sid, sectionTitle: sec.title, no: sec.no, remaining };
    }
  }
  return best;
}

/** Total V15 items practised, for the rail's coverage figure. */
export function playbookPractised(items: PbItem[] | null, isTouched: (itemId: string) => boolean): number {
  let n = 0;
  for (const it of items ?? []) if (isTouched(it.id)) n += 1;
  return n;
}
