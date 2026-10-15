#!/usr/bin/env node
/**
 * `npm run i18n:check` | `npm run i18n:report` — localization QA. No network.
 *
 * Two halves, because localization fails in two different ways:
 *
 *   · THE PACKS can drift. A key added to English and forgotten in Hinglish does not crash: the
 *     reader falls back to English and a Hinglish learner sees one English sentence in the middle of
 *     a Hinglish screen. `check` makes that a failure here instead of a surprise in production, and
 *     it also compares the `{placeholders}` on both sides — `Use at least {n} characters` translated
 *     without the `{n}` renders a sentence with a hole in it.
 *
 *   · THE CONTENT is a corpus, not a dictionary. Courses, tracks and curriculum sections are
 *     authored JSON, translated in batches, so the honest state is a COVERAGE NUMBER rather than a
 *     pass/fail. `report` prints it per source — full / partial / not-yet — and never claims a file
 *     is translated when it is not.
 *
 * The packs are read as TEXT on purpose: this script must run without a TypeScript build, exactly
 * like the rest of `scripts/`.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const status = { failures: 0, warnings: 0 };
const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => { console.log(`\x1b[31m✕\x1b[0m ${m}`); status.failures += 1; };
const warn = (m) => { console.log(`\x1b[33m⚠\x1b[0m ${m}`); status.warnings += 1; };

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

/* ------------------------------- the packs ------------------------------- */

const LOCALES_SRC = read('src/app/i18n/locales.ts');

/** `'key': 'value',` pairs of one pack object, read without executing TypeScript. */
function packKeys(source, startMarker, endMarker) {
  const from = source.indexOf(startMarker);
  const to = endMarker ? source.indexOf(endMarker, from) : source.length;
  const block = source.slice(from, to);
  const out = new Map();
  const re = /^\s*'([^']+)':\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*,?\s*$/gm;
  for (const m of block.matchAll(re)) {
    out.set(m[1], (m[2] ?? m[3] ?? '').replace(/\\'/g, "'").replace(/\\"/g, '"'));
  }
  return out;
}

const en = packKeys(LOCALES_SRC, 'export const en', 'export type LocaleKey');
const hi = packKeys(LOCALES_SRC, 'export const hinglish', 'export interface LocaleMeta');

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

function checkPacks() {
  console.log('\n— Locale packs —');
  if (!en.size) bad('the English pack could not be read');
  if (!hi.size) bad('the Hinglish pack could not be read');

  // The locale ids themselves: `en` and `hi`, exactly, and both with a pack behind them.
  const codes = [...LOCALES_SRC.matchAll(/\{\s*code:\s*'([^']+)'/g)].map((m) => m[1]);
  for (const code of ['en', 'hi']) {
    if (!codes.includes(code)) bad(`LOCALES does not declare the '${code}' locale`);
  }
  const expected = LOCALES_SRC.includes("hi: hinglish");
  if (!expected) bad('the Hinglish pack is not wired to the `hi` locale id in PACKS');
  if (codes.length !== 2) warn(`LOCALES declares ${codes.length} locales (${codes.join(', ')})`);

  const missing = [...en.keys()].filter((key) => !hi.has(key));
  const extra = [...hi.keys()].filter((key) => !en.has(key));
  if (missing.length) {
    bad(`${missing.length} key(s) missing from the Hinglish pack: ${missing.join(', ')}`);
  } else {
    ok(`${en.size} keys, translated in both packs`);
  }
  if (extra.length) bad(`${extra.length} key(s) exist in Hinglish but not in English: ${extra.join(', ')}`);

  let holes = 0;
  for (const [key, value] of en) {
    if (!value.trim()) { bad(`en.${key} is empty`); holes += 1; }
  }
  for (const [key, value] of hi) {
    if (!value.trim()) { bad(`hi.${key} is empty`); holes += 1; }
  }
  if (!holes) ok('no empty strings in either pack');

  let mismatched = 0;
  for (const [key, value] of en) {
    const translation = hi.get(key);
    if (translation === undefined) continue;
    if (placeholders(value) !== placeholders(translation)) {
      bad(`placeholder mismatch on "${key}": en{${placeholders(value)}} vs hi{${placeholders(translation)}}`);
      mismatched += 1;
    }
  }
  if (!mismatched) ok('every {placeholder} survives translation');
}

/* ------------------------------ the content ------------------------------ */

/**
 * The coverage numbers are owned by `lib/i18n-coverage.cjs` so a test can hold them: the ledger used
 * to read the tracks INDEX with a FILE reader, so every track field came back `undefined` and eight
 * files were dropped while the row still printed a confident total. The reader is no longer here.
 */
const { contentLedger, ledgerTotals, overlayLedger } = require('./lib/i18n-coverage.cjs');

function contentCoverage() {
  console.log('\n— Content coverage (authored sources) —');
  const rows = contentLedger(readJson);
  for (const row of rows) {
    const pct = row.total ? Math.round((row.full / row.total) * 100) : 0;
    console.log(`   ${row.label.padEnd(32)} ${String(row.total).padStart(4)} fields in ${String(row.files).padStart(2)} file(s) · ${String(row.full).padStart(4)} bilingual (${pct}%) · ${row.partial} partial · ${row.plain} not-yet`);
    if (!row.total) bad(`${row.label}: 0 translatable fields found — the reader is wrong, not the corpus`);
  }
  const totals = ledgerTotals(rows);
  if (!totals.total) bad('no translatable content fields were found — the reader is wrong, not the corpus');
  else ok(`${totals.full}/${totals.total} authored fields carry both languages inline (${totals.total - totals.full} still to translate)`);

  // Overlay sources are counted on their own line: they are a different shape of evidence (a name
  // map keyed by id), and folding them into the counts above would compare unlike things.
  const overlay = overlayLedger(readJson);
  console.log(`   ${overlay.label.padEnd(32)} ${String(overlay.total).padStart(4)} names · ${String(overlay.named).padStart(4)} with Hinglish (${overlay.pct}%) · ${overlay.missing} missing`);
  if (overlay.orphans) bad(`${overlay.label}: ${overlay.orphans} id(s) match no section — they can never render`);
  if (overlay.blank) bad(`${overlay.label}: ${overlay.blank} empty value(s) — an empty name is not a translation`);
  if (!overlay.orphans && !overlay.blank) ok(`${overlay.named}/${overlay.total} section names have a reviewed Hinglish name`);

  console.log('   Not in this ledger yet: question banks, the playbook, notebooks, curriculum packs,');
  console.log('   and every section field other than its name (concepts, prose, questions, projects).');
  return rows;
}

/* --------------------------------- the run -------------------------------- */

console.log('\n— BroCode localization —');
const mode = process.argv[2] ?? 'check';
checkPacks();

if (mode === 'report') {
  contentCoverage();
  console.log('\n— Summary —');
  console.log(`   UI keys        ${en.size} keys × 2 languages`);
  console.log(`   Packs          en, hi (both complete: ${[...en.keys()].every((k) => hi.has(k)) ? 'yes' : 'no'})`);
  console.log('   Content        translated in batches; the table above is the current batch list.');
  console.log('   Validate       npm run i18n:check (packs only) · npm run courses:write after a course edit');
} else if (mode !== 'check') {
  bad(`unknown mode "${mode}" (expected check | report)`);
}

console.log(status.failures ? `\n\x1b[31m${status.failures} localization problem(s).\x1b[0m\n` : '\n\x1b[32mLocalization checks passed.\x1b[0m\n');
process.exit(status.failures ? 1 : 0);
