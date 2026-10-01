/**
 * Deep search over the question banks, for the command palette.
 *
 * The palette used to search only the curriculum: concepts, interview Q&A and coding tasks that live
 * in the lesson pages. The 13,865 bank questions — including every Playbook V15 item — were not
 * searchable at all, because the banks are 11 MB and no page loads more than one section's worth.
 * `scripts/searchindex.cjs` flattens them into one small index; this module ranks that index.
 *
 * Pure and dependency-free on purpose: the ranking and the deep-link contract are the parts worth
 * testing, and they must not need a browser, a fetch or a React render to be exercised.
 */

/**
 * One row of `public/generated/search/index.json`, decoded.
 *
 * The file stores tuples (`[id, sectionId, type, info, text]`) because it holds ~14,000 rows and an
 * object per row costs nearly twice the bytes. `info` is the Playbook chapter (`pb:18`) for an
 * imported item and the difficulty (`hard`) for everything else — one column, two meanings, and
 * `chapterOf`/`difficultyOf` below are the only places that care which is which.
 */
export interface BankIndexRow {
  id: string;
  sectionId: string;
  type: string;
  info: string;
  text: string;
}

export interface BankIndex {
  v: number;
  counts: { items: number; sections: number; playbook: number; skipped: number };
  /** `[id, no, title]` for every section that has questions. */
  sections: [string, number, string][];
  /** `[chapter, title, sectionId]` for the V15 chapters, so a hit can name its chapter. */
  chapters: [string, string, string][];
  playbookTotal: number;
  items: BankIndexRow[];
}

/** The raw JSON shape as written by the build script (tuples, not objects). */
export interface RawBankIndex {
  v?: number;
  counts?: { items?: number; sections?: number; playbook?: number; skipped?: number };
  sections?: [string, number, string][];
  chapters?: [string, string, string][];
  playbookTotal?: number;
  items?: [string, string, string, string, string][];
}

/** Decode the wire format once. Tolerates a truncated/older file rather than throwing at runtime. */
export function decodeIndex(raw: RawBankIndex | null | undefined): BankIndex {
  return {
    v: raw?.v ?? 0,
    counts: {
      items: raw?.counts?.items ?? raw?.items?.length ?? 0,
      sections: raw?.counts?.sections ?? 0,
      playbook: raw?.counts?.playbook ?? 0,
      skipped: raw?.counts?.skipped ?? 0,
    },
    sections: raw?.sections ?? [],
    chapters: raw?.chapters ?? [],
    playbookTotal: raw?.playbookTotal ?? 0,
    items: (raw?.items ?? [])
      .filter((r) => Array.isArray(r) && r.length >= 5)
      .map(([id, sectionId, type, info, text]) => ({ id, sectionId, type, info, text })),
  };
}

/** The V15 chapter number of a row, or null. */
export const chapterOf = (row: BankIndexRow): string | null => (/^pb:\d+$/.test(row.info) ? row.info.slice(3) : null);

/** The difficulty of a row, or null when the row is a V15 item (its `info` is a chapter). */
export const difficultyOf = (row: BankIndexRow): string | null => (/^pb:\d+$/.test(row.info) ? null : row.info || null);

/** The section's number and title, for a result row's detail line. */
export function sectionLabel(index: BankIndex, sectionId: string): string {
  const hit = index.sections.find(([id]) => id === sectionId);
  return hit ? `${String(hit[1]).padStart(2, '0')} — ${hit[2]}` : sectionId.toUpperCase();
}

/** The V15 chapter title for a chapter number, e.g. `18` → the chapter's own heading. */
export function chapterTitle(index: BankIndex, chapter: string): string {
  return index.chapters.find(([n]) => n === chapter)?.[1] ?? '';
}

/** The palette's kind labels — the same words the Question Bank prints for each type. */
const KIND_OF: Record<string, string> = {
  interview: 'Interview',
  theory: 'Theory',
  coding: 'Coding',
  solved: 'Solved',
  logic: 'Logic',
  debug: 'Debug',
  checkpoint: 'Checkpoint',
  defense: 'Defense',
  mini: 'MiniProject',
};

/** How the palette labels a row: its type's own word, so the chip and the page agree. */
export const kindOf = (row: BankIndexRow): string => (row.type === 'coding' ? 'Coding' : KIND_OF[row.type] ?? 'Question');

/**
 * Where a hit should send the learner: the Question Bank, already filtered to that section.
 *
 * `find` seeds the bank's own search box (the bank reads the same param), so a palette hit lands on
 * the question itself rather than on a 644-question list that happens to contain it. `playbook=1`
 * additionally ticks the V15 filter when the row is an imported item — the filter is a fact about
 * the row (its `pb:` chapter), not a guess from the text.
 */
export function routeFor(row: BankIndexRow): string {
  const params = new URLSearchParams();
  params.set('section', row.sectionId);
  params.set('find', row.text.slice(0, 60));
  if (chapterOf(row)) params.set('playbook', '1');
  return `/questions?${params.toString()}`;
}

/**
 * The one-line detail under a result: section, type, and whichever of chapter/difficulty the row
 * carries. Built from the index's own maps, so a renamed section renames here too.
 */
export function detailFor(index: BankIndex, row: BankIndexRow): string {
  const chapter = chapterOf(row);
  const parts = [sectionLabel(index, row.sectionId)];
  if (chapter) {
    const title = chapterTitle(index, chapter);
    parts.push(`Playbook V15 · ch.${chapter}${title ? ` ${title}` : ''}`);
  } else {
    parts.push(row.type);
    const d = difficultyOf(row);
    if (d) parts.push(d);
  }
  return parts.join(' · ');
}

export interface BankHit {
  row: BankIndexRow;
  score: number;
}

const norm = (s: string) => (s ?? '').toLowerCase();

/**
 * Match a term at the START of a word, matched case-insensitively against a lowercased haystack.
 *
 * Plain `includes` is not good enough for a 3-letter query: measured on the real index, "cte"
 * matched 402 questions because the letters sit inside "expe[cte]d", "detected"/"directed"/"collected"
 * and similar — the one question actually about CTEs was buried. Requiring a word start keeps the
 * useful behaviour people expect from search (typing "dia" finds "Dijkstra") without the noise.
 * Numbers are word-start too, so "s19" and "270" still match.
 */
const wordStart = (term: string) => new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

/**
 * Rank index rows against a query.
 *
 * Every term must appear (AND), which is what makes a two-word search useful instead of a pile of
 * near-misses — the palette has room for a few rows, not a page. Scores are deliberately simple and
 * explainable: a question that STARTS with the term outranks one that merely contains it, and an
 * exact whole-question match wins outright. Ties keep index order (section order), so the result
 * list is stable while you type rather than reshuffling under the cursor.
 */
export function searchBankIndex(index: BankIndex, query: string, limit = 12): BankHit[] {
  const q = norm(query).trim();
  if (q.length < 2) return [];
  const terms = q.split(/\s+/).filter((t) => t.length >= 2);
  if (!terms.length) return [];

  const matchers = terms.map((t) => ({ term: t, re: wordStart(t) }));
  const hits: BankHit[] = [];
  for (const row of index.items) {
    const text = norm(row.text);
    let score = 0;
    let ok = true;
    for (const { term, re } of matchers) {
      // Cheap substring test first: it rejects almost every row, and only the survivors pay for the
      // boundary check.
      if (!text.includes(term)) { ok = false; break; }
      if (!re.test(text)) { ok = false; break; }
      score += text.startsWith(term) ? 6 : 2;
      // The term inside the first few words is far more likely to be the subject of the question.
      if (text.slice(0, 24).includes(term)) score += 2;
    }
    if (!ok) continue;
    if (text === q) score += 10;
    hits.push({ row, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
