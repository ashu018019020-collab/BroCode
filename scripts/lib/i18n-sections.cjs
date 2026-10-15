'use strict';
/**
 * The section-name overlay and its ledger — the pure half of `npm run i18n:sections`.
 *
 * WHAT THIS OWNS: merging `content/curriculum/i18n/sections.json` (authored Hinglish names, keyed by
 * section id) against `public/generated/curriculum/sections.json` (the generated curriculum) into
 * the small published file the browser resolves at load: `public/generated/curriculum/i18n.json`.
 *
 * WHY A MERGE AND NOT AN EDIT OF sections.json: that file is extracted from the source PDF and then
 * repaired in place by `learn.cjs`, `stages.cjs`, `guides.cjs` and `packs.cjs`. A translation written
 * into it survives only until the next extraction — the same reason
 * `content/curriculum/stage-overrides.json` exists as a separate authored file. Keeping the overlay
 * separate means the generator is idempotent and the generated curriculum is never hand-edited.
 *
 * The ledger is separate from the write path so a test can check BOTH directions of the key
 * mapping without touching disk: an overlay entry for a section that does not exist is a typo that
 * would silently never render, and a section with no entry is simply still to translate.
 */

/** The published shape the app fetches: sectionId → Hinglish title. */
function buildOverlay(sections, authored) {
  return { version: 1, sections: mapOverlay(sections, authored).sections };
}

/**
 * Resolve the authored overlay against the real section list.
 *
 * `missing` is "still to translate" (expected, batched). `orphans` is a DEFECT — an id that matches
 * no section means the translation can never appear, so the caller must fail rather than ship it.
 */
function mapOverlay(sections, authored) {
  const known = new Set();
  const byId = new Map();
  for (const section of sections) {
    if (typeof section?.id !== 'string' || !section.id) continue;
    known.add(section.id);
    byId.set(section.id, section);
  }
  const entries = authored?.sections && typeof authored.sections === 'object' ? authored.sections : {};

  const mapped = {};
  const orphans = [];
  const blank = [];
  const missing = [];
  for (const [id, value] of Object.entries(entries)) {
    if (!known.has(id)) { orphans.push(id); continue; }
    if (typeof value !== 'string' || !value.trim()) { blank.push(id); continue; }
    // A translation identical to the English title is legitimate (a proper noun like "Strings"),
    // so it is mapped, not flagged.
    mapped[id] = value.trim();
  }
  for (const id of [...known].sort()) if (!(id in mapped)) missing.push(id);

  const sectionsWithName = Object.keys(mapped).length;
  return {
    sections: mapped,
    counts: {
      sections: known.size,
      named: sectionsWithName,
      missing: missing.length,
      orphans: orphans.length,
      blank: blank.length,
    },
    missing,
    orphans,
    blank,
    byId,
  };
}

/** Total translatable NAME fields, so a coverage percentage has a stated denominator. */
function nameCoverage(counts) {
  const total = counts.sections;
  return { total, translated: counts.named, pct: total ? Math.round((counts.named / total) * 100) : 0 };
}

module.exports = { buildOverlay, mapOverlay, nameCoverage };
