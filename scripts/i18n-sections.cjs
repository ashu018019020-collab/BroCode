#!/usr/bin/env node
/**
 * npm run i18n:sections | i18n:sections:write — publish the Hinglish section-name overlay.
 *
 * Reads the authored overlay (`content/curriculum/i18n/sections.json`) and the generated curriculum
 * (`public/generated/curriculum/sections.json`), and writes ONLY the resolved name map to
 * `public/generated/curriculum/i18n.json`, which the app fetches and applies at its data boundary
 * (`src/core/data/curriculum-i18n.ts`).
 *
 * Dry run is the default, like every other generator in this repository. An overlay id that matches
 * no section is a hard failure: it is a typo that would never render, and shipping it silently is
 * exactly the kind of invisible defect this pipeline is meant to prevent.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { buildOverlay, mapOverlay, nameCoverage } = require('./lib/i18n-sections.cjs');

const ROOT = path.join(__dirname, '..');
const SECTIONS = path.join(ROOT, 'public', 'generated', 'curriculum', 'sections.json');
const AUTHORED = path.join(ROOT, 'content', 'curriculum', 'i18n', 'sections.json');
const OUT = path.join(ROOT, 'public', 'generated', 'curriculum', 'i18n.json');

const status = { failures: 0 };
const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => { console.log(`\x1b[31m✕\x1b[0m ${m}`); status.failures += 1; };
const warn = (m) => console.log(`\x1b[33m⚠\x1b[0m ${m}`);

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function main() {
  const write = process.argv.includes('--write');
  console.log('\n— Section name overlay (bilingual) —');

  if (!fs.existsSync(SECTIONS)) { bad(`generated curriculum missing: ${path.relative(ROOT, SECTIONS)}`); return; }
  if (!fs.existsSync(AUTHORED)) { bad(`authored overlay missing: ${path.relative(ROOT, AUTHORED)}`); return; }

  const sections = readJson(SECTIONS);
  const authored = readJson(AUTHORED);
  const ledger = mapOverlay(sections, authored);
  const coverage = nameCoverage(ledger.counts);

  console.log(`   generated sections        ${ledger.counts.sections}`);
  console.log(`   Hinglish names authored   ${ledger.counts.named} (${coverage.pct}%)`);
  console.log(`   still to translate        ${ledger.counts.missing}`);
  if (ledger.missing.length) console.log(`     ${ledger.missing.join(' ')}`);

  // An id that resolves to no section is a defect, not a gap: the translation can never be shown.
  if (ledger.orphans.length) bad(`overlay id(s) match no section: ${ledger.orphans.join(', ')}`);
  else ok('every authored id resolves to a real section');

  if (ledger.blank.length) bad(`overlay entry/entries are empty strings: ${ledger.blank.join(', ')}`);

  // English identity check: the overlay must never change an id or the English title.
  const englishChanged = sections.filter((s) => typeof s.title !== 'string' || !s.title.trim());
  if (englishChanged.length) bad(`${englishChanged.length} section(s) have no English title to fall back to`);
  else ok('every section keeps a non-empty English title to fall back to');

  if (status.failures) return;

  const payload = buildOverlay(sections, authored);
  const serialized = JSON.stringify(payload, null, 2) + '\n';
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;

  if (current === serialized) ok(`public/generated/curriculum/i18n.json is already up to date`);
  else if (!write) warn(`dry run — ${current === null ? 'not yet written' : 'differs'}; re-run with --write to publish`);
  else {
    fs.writeFileSync(OUT, serialized);
    ok(`wrote public/generated/curriculum/i18n.json (${Object.keys(payload.sections).length} section name(s))`);
  }
}

if (require.main === module) {
  main();
  console.log(status.failures
    ? `\n\x1b[31m${status.failures} localization problem(s).\x1b[0m\n`
    : '\n\x1b[32mSection name overlay checked.\x1b[0m\n');
  process.exit(status.failures ? 1 : 0);
}

module.exports = { SECTIONS, AUTHORED, OUT };
