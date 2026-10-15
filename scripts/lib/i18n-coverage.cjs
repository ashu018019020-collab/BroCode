'use strict';
/**
 * The bilingual content ledger — WHICH authored field is translated, and how far along.
 *
 * This is the pure half of `npm run i18n:report`: it reads authored JSON and returns counts, and
 * writes nothing. It lives here rather than inside `scripts/i18n.cjs` so the coverage numbers are
 * covered by a test — a report that can be wrong about its own denominator is worse than no report,
 * and that is exactly what this module was extracted to fix.
 *
 * THE MITIGATION IT EXISTS FOR: the corpus is translated in batches, so the honest unit is a
 * COVERAGE NUMBER, never a pass/fail. Each field is therefore classified, not judged:
 *
 *   full    — an `{ en, hi }` map with both sides written
 *   partial — a map with one side empty (`{ en: 'Loops', hi: '' }` renders English in Hinglish mode)
 *   plain   — still a single string: not translated yet, or genuinely language-neutral
 *   missing — absent or empty
 *
 * A field that is `plain` is NOT counted as translated. Nothing here may report a file as bilingual
 * because it looks bilingual; `hi: ''` is `partial`, not `full`.
 */

/** One translatable field's state. Mirrors `localizationState` in `src/core/data/localize.ts`. */
function stateOf(value) {
  if (value === undefined || value === null) return 'missing';
  if (typeof value === 'string') return value.trim() ? 'plain' : 'missing';
  if (typeof value !== 'object') return 'plain';
  const en = typeof value.en === 'string' ? value.en.trim() : '';
  const hi = typeof value.hi === 'string' ? value.hi.trim() : '';
  if (en && hi) return 'full';
  if (en || hi) return 'partial';
  return 'missing';
}

function emptyCounts() {
  return { full: 0, partial: 0, plain: 0, missing: 0 };
}

/**
 * Resolve one source's file list.
 *
 * A `perFile` source is an INDEX: the entry file lists the real files. Passing that index document
 * to the `fields` reader (which is written for one real file) reads `undefined` for every field and
 * silently reports 0 of 0 — the bug this shape exists to prevent. `present` is what was actually
 * read, so a report can never claim a file it did not open.
 */
function filesOf(source, readJson) {
  if (!source.perFile) return { files: [source.file], present: [source.file] };
  const index = readJson(source.file);
  const files = [...new Set(source.perFile(index))].sort();
  return { files, present: [source.file, ...files] };
}

function countSource(source, readJson) {
  const { files, present } = filesOf(source, readJson);
  const counts = emptyCounts();
  for (const file of files) {
    for (const [, value] of source.fields(readJson(file))) counts[stateOf(value)] += 1;
  }
  const total = counts.full + counts.partial + counts.plain + counts.missing;
  return { label: source.label, files: files.length, total, ...counts, present };
}

/**
 * The ledger over every declared source.
 *
 * `readJson(relativePath)` is injected so a test can drive the ledger with fixtures instead of the
 * real corpus, and so this module never decides where the repository root is.
 */
function contentLedger(readJson) {
  return CONTENT_SOURCES.map((source) => countSource(source, readJson));
}

/** Totals across the ledger, so a summary line cannot be computed from a different set of rows. */
function ledgerTotals(rows) {
  return {
    full: rows.reduce((sum, row) => sum + row.full, 0),
    partial: rows.reduce((sum, row) => sum + row.partial, 0),
    plain: rows.reduce((sum, row) => sum + row.plain, 0),
    missing: rows.reduce((sum, row) => sum + row.missing, 0),
    total: rows.reduce((sum, row) => sum + row.total, 0),
    files: rows.reduce((sum, row) => sum + row.files, 0),
  };
}

/**
 * THE TRANSLATABLE-FIELD LEDGER.
 *
 * `fields` answers "which authored values could carry a second language?" for ONE real file of that
 * source. Only the fields the readers actually resolve per language are listed: a course's `tone`,
 * `logo` and `steps` are machine values, and claiming them as translatable would inflate the
 * denominator and understate real coverage.
 *
 * Two gaps are stated rather than hidden, because a coverage number that ignores them is a claim:
 *   · a curriculum section is measured by `title` only — its `learn`/`topic`/`projectLab` prose is a
 *     far larger body and is not yet authored bilingually at all;
 *   · the question banks, the playbook, notebooks and the curriculum packs are not in this ledger
 *     yet (they are read source→generated, not through the localize boundary).
 */
const CONTENT_SOURCES = [
  {
    file: 'content/courses/courses.json',
    label: 'courses',
    // The canonical authored course map. Read as a LIST (the file holds all eleven), so it declares
    // no `perFile`; the module that resolves it at runtime is `src/core/data/courses.ts`.
    fields: (doc) => (doc.courses ?? []).flatMap((course) => [
      ['name', course.name],
      ['description', course.description],
    ]),
  },
  {
    file: 'content/tracks/index.json',
    label: 'tracks',
    perFile: (index) => index.map((entry) => `content/tracks/${entry.slug}.json`),
    fields: (doc) => (Array.isArray(doc.chapters) && doc.chapters.length
      ? [['title', doc.title], ['description', doc.description]]
      : [['title', doc.title]]),
  },
  {
    // The generated curriculum the app actually loads. Listed so the report describes the artifact
    // the learner reads, and labelled generated so no reader mistakes it for an authored source.
    file: 'public/generated/curriculum/sections.json',
    label: 'curriculum sections (generated)',
    generated: true,
    fields: (list) => (Array.isArray(list) ? list : list.sections ?? [])
      .flatMap((section) => [['title', section.title]]),
  },
];

/**
 * Sources that carry a Hinglish side through a SEPARATE authored overlay rather than an `{ en, hi }`
 * map inside the record.
 *
 * A section's name is the case that needs this: its English title lives in `sections.json`, which is
 * extracted from the PDF and then repaired in place by four scripts, so a translation written there
 * survives only until the next extraction. `content/curriculum/i18n/sections.json` is the reviewed
 * Hinglish side, and `npm run i18n:sections:write` merges the two into the published
 * `generated/curriculum/i18n.json` that the app resolves at its data boundary.
 *
 * Reported SEPARATELY, never folded into `contentLedger`: the overlay is a different shape of
 * evidence (a name map keyed by id), and adding it to the `full/partial/plain` counts above would
 * compare two unlike things to make one percentage look better.
 */
function overlayLedger(readJson) {
  const sections = readJson('public/generated/curriculum/sections.json');
  const authored = readJson('content/curriculum/i18n/sections.json');
  const known = new Set((Array.isArray(sections) ? sections : sections.sections ?? [])
    .map((section) => section.id).filter(Boolean));
  const entries = authored?.sections && typeof authored.sections === 'object' ? authored.sections : {};
  let named = 0;
  const orphans = [];
  const blank = [];
  for (const [id, value] of Object.entries(entries)) {
    if (!known.has(id)) { orphans.push(id); continue; }
    if (typeof value !== 'string' || !value.trim()) { blank.push(id); continue; }
    named += 1;
  }
  return {
    label: 'section names (authored overlay)',
    total: known.size,
    named,
    missing: known.size - named,
    orphans: orphans.length,
    blank: blank.length,
    pct: known.size ? Math.round((named / known.size) * 100) : 0,
  };
}

module.exports = { CONTENT_SOURCES, stateOf, contentLedger, ledgerTotals, overlayLedger };
