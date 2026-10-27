/**
 * Question search index — the 13,865 bank items, made searchable.
 *
 * Ctrl+K has always searched the CURRICULUM (sections.json, ~1 MB): the authored concepts, interview
 * Q&A and coding tasks that live in the lesson pages. The question BANKS — every section's extracted
 * practice set plus every Playbook V15 item that was imported into them — were never searchable,
 * because the banks are 11 MB across 29 files and no page loads more than one. So the app's largest
 * body of content was the one thing "search" could not find: typing "Dijkstra" or "CTE" in the
 * palette returned nothing, even though the app owns those questions.
 *
 * This script writes a single compact index of every bank question, which the palette fetches once,
 * lazily, and searches locally:
 *
 *   public/generated/search/index.json
 *   { v, counts, sections: [...], items: [[id, sectionId, type, info, text], ...] }
 *
 * Design decisions that keep it honest and small:
 *
 *  · DERIVED ONLY. Built from the banks on disk (the same files the learner practises) and from
 *    `public/generated/playbook/items.json` for chapter provenance — never from an expansion file or the PDF.
 *    A question added to a bank appears here; a question removed disappears. `npm test` re-derives
 *    the counts from the banks and fails if they disagree.
 *  · TUPLE ROWS, NOT OBJECTS. `["s19:theory:20","s19","theory","medium","CTE kya hai…"]` is ~155
 *    bytes per question instead of ~260 for the same data as an object, which matters 14,000 times.
 *  · THE SAME ID AS THE APP. `id` is the bank's own question id (`<sectionId>:<type>:<i>`), so the
 *    palette's deep link and every stored attempt key already agree on it.
 *  · DETERMINISTIC. No timestamp: regenerating over an unchanged bank set produces an identical
 *    file, so the artifact's diff is reviewable and a test can byte-compare it.
 *  · NO ANSWERS. Model answers would triple the size and the point of search is to FIND a question;
 *    the Question Bank (and the assistant) already answer it once you are there.
 *
 * Usage:
 *   node scripts/searchindex.cjs            # report only (dry run)
 *   node scripts/searchindex.cjs --write    # write public/generated/search/index.json
 *   npm run search:index
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const QUESTIONS_DIR = path.join(ROOT, 'public', 'generated', 'questions');
const SECTIONS_JSON = path.join(ROOT, 'public', 'generated', 'curriculum', 'sections.json');
const PLAYBOOK_VIEW = path.join(ROOT, 'public', 'generated', 'playbook', 'items.json');
const OUT_DIR = path.join(ROOT, 'public', 'generated', 'search');
const OUT_PATH = path.join(OUT_DIR, 'index.json');

/** How much of a question the index keeps. Enough for a result row, not the whole essay. */
const TEXT_LIMIT = 110;

const loadSections = () => JSON.parse(fs.readFileSync(SECTIONS_JSON, 'utf8'));
const bankIds = () => (fs.existsSync(QUESTIONS_DIR)
  ? fs.readdirSync(QUESTIONS_DIR).filter((f) => f.endsWith('.json') && f !== 'manifest.json').map((f) => f.replace(/\.json$/, ''))
  : []);
const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/**
 * The chapter a V15 item came from, or the item's difficulty for everything else.
 *
 * One field, two meanings, because every row already carries its type and section and a second
 * column would cost ~90 KB across the index. Readers get it through `infoOf()`, which knows which
 * is which from the `pb:<n>` shape.
 */
const infoOf = (q) => {
  const chapter = (q.tags ?? []).find((t) => /^pb:\d+$/.test(t));
  return chapter ? chapter : String(q.difficulty ?? '');
};

/** Build the index in memory. Pure given the files on disk — this is what the test drives too. */
function buildSearchIndex() {
  const sections = loadSections();
  const order = new Map(sections.map((s, i) => [s.id, i]));
  const ids = bankIds().sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b));

  const items = [];
  let skipped = 0;
  for (const sid of ids) {
    const bank = readJson(path.join(QUESTIONS_DIR, `${sid}.json`), null);
    if (!bank?.questions) continue;
    for (const q of bank.questions) {
      // Only published questions: a draft is not something the palette should send anyone to, and
      // the Question Bank hides drafts behind a checkbox by default.
      if (q.status && q.status !== 'PUBLISHED') { skipped++; continue; }
      const text = clip(q.question, TEXT_LIMIT);
      if (text.length < 8) { skipped++; continue; }
      items.push([q.id, sid, q.type, infoOf(q), text]);
    }
  }

  const playbook = readJson(PLAYBOOK_VIEW, { items: [] });
  return {
    v: 1,
    counts: {
      items: items.length,
      sections: new Set(items.map((r) => r[1])).size,
      playbook: items.filter((r) => /^pb:\d+$/.test(r[3])).length,
      skipped,
    },
    sections: sections
      .filter((s) => items.some((r) => r[1] === s.id))
      .map((s) => [s.id, s.no, s.title]),
    // Chapter provenance is only useful with the chapter's own title, so the index carries the map
    // the palette prints ("Playbook V15 · ch.18") instead of a bare number. The manifest names the
    // number `no` (`chapter` is the key in items.json) — reading the wrong one produced a table
    // keyed "undefined" whose lookups always missed, i.e. silent empty titles.
    chapters: (readJson(path.join(ROOT, 'public', 'generated', 'playbook', 'manifest.json'), { chapters: [] }).chapters ?? [])
      .map((c) => [String(c.no ?? ''), c.title ?? '', c.sectionId ?? ''])
      .filter(([n, title]) => /^\d+$/.test(n) && String(title).trim().length > 0),
    playbookTotal: (playbook.items ?? []).length,
    // The section titles ride along so the palette can label a hit without a second fetch.
    items,
  };
}

/** Write it, then report size honestly (the palette pays for these bytes once per session). */
function writeSearchIndex() {
  const index = buildSearchIndex();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(index));
  return index;
}

function report(index, written) {
  const bytes = Buffer.byteLength(JSON.stringify(index));
  const kb = (bytes / 1024).toFixed(0);
  console.log(`\n${written ? 'wrote' : 'dry run —'} public/generated/search/index.json`);
  console.log(`  ${index.counts.items} questions · ${index.counts.sections} sections · ${index.counts.playbook} Playbook V15 items · ${index.counts.chapters ?? index.chapters.length} chapters`);
  if (index.counts.skipped) console.log(`  skipped ${index.counts.skipped} unpublished/too-short record(s)`);
  console.log(`  index size: ${kb} KB (${(bytes / Math.max(1, index.counts.items)).toFixed(0)} bytes per question)${written ? '' : ' — run with --write to save'}`);
}

if (require.main === module) {
  const write = process.argv.includes('--write');
  const index = write ? writeSearchIndex() : buildSearchIndex();
  report(index, write);
}

module.exports = { buildSearchIndex, writeSearchIndex, OUT_PATH, TEXT_LIMIT };
