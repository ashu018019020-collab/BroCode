#!/usr/bin/env node
/**
 * npm run curriculum:stages | curriculum:stages:write
 *
 * Applies content/curriculum/stage-overrides.json to public/generated/curriculum/sections.json.
 *
 * Why this exists: tools/extract.mjs regenerates sections.json from the PDF, and that
 * extraction boilerplates the same generic stage prompts into every module ("What
 * changes first: input, transformed data, or output?", "Main pehle constraints aur edge
 * cases clarify karunga...", the debug-methodology line). Those repeated placeholders
 * used to show up verbatim in 12-13 question banks at once, which is exactly the
 * content debt `npm run questions:duplicates` reports. Curated repairs therefore live in
 * content/curriculum/ next to learn-overrides.json and are re-applied after extraction,
 * so a re-extract can never bring the boilerplate back.
 *
 * Default run is a DRY RUN: it reports what would change and fails if an override no
 * longer matches anything (stale overlay). `--write` applies and saves the file.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SECTIONS_JSON = path.join(ROOT, 'public', 'generated', 'curriculum', 'sections.json');
const OVERRIDES_FILE = path.join(ROOT, 'content', 'curriculum', 'stage-overrides.json');

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`\x1b[31m✕\x1b[0m ${m}`);
const warn = (m) => console.log(`\x1b[33m⚠\x1b[0m ${m}`);

const sections = JSON.parse(fs.readFileSync(SECTIONS_JSON, 'utf8'));
const overrides = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));
const byId = new Map(sections.map((s) => [s.id, s]));

let failures = 0;
let changed = 0;

/** Replace one logic card (matched by kind) — keeps the {kind, text, answer} shape. */
function applyLogic(ov) {
  const sec = byId.get(ov.section);
  if (!sec) return bad(`${ov.section}: unknown section`);
  const cards = sec.logic ?? [];
  const matches = cards.filter((l) => l.kind === ov.kind);
  if (matches.length !== 1) return bad(`${ov.section}/${ov.kind}: expected exactly 1 logic card, found ${matches.length}`);
  const card = matches[0];
  if (card.text === ov.text && card.answer === ov.answer) return 'unchanged';
  card.text = ov.text;
  card.answer = ov.answer;
  return 'changed';
}

/** Replace a coding stage item (matched by the boilerplate text it replaces). */
function applyCoding(ov) {
  const sec = byId.get(ov.section);
  if (!sec) return bad(`${ov.section}: unknown section`);
  const items = sec.coding ?? [];
  // Re-running is a no-op: the boilerplate is already gone once the override is in place.
  const applied = items.find((c) => String(c.text).trim() === ov.text.trim());
  if (applied) {
    return applied.solution === ov.solution && applied.check === ov.check ? 'unchanged' : bad(`${ov.section}: applied task drifted from the overlay`);
  }
  const matches = items.filter((c) => String(c.text).trim() === ov.replaces.trim());
  if (matches.length !== 1) return bad(`${ov.section}: boilerplate target not found once (found ${matches.length}) — overlay is stale`);
  const item = matches[0];
  item.text = ov.text;
  item.solution = ov.solution;
  item.check = ov.check;
  item.difficulty = item.difficulty || 'medium';
  return 'changed';
}

/** No stage text may appear in more than one section (the whole point of the overlay). */
function assertUnique() {
  const seen = new Map();
  const dupes = [];
  for (const sec of sections) {
    const texts = [...(sec.logic ?? []).map((l) => `${l.kind}: ${l.text}`), ...(sec.coding ?? []).map((c) => String(c.text))];
    for (const item of texts) {
      const key = item.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seen.has(key) && seen.get(key) !== sec.id) dupes.push(`${sec.id} repeats ${seen.get(key)}: ${item.slice(0, 60)}`);
      else seen.set(key, sec.id);
    }
  }
  if (dupes.length) {
    failures++;
    bad(`${dupes.length} stage text(s) still repeat across sections:\n   ${dupes.slice(0, 10).join('\n   ')}`);
  } else ok('no stage text repeats across sections');
}

const write = process.argv.includes('--write');

console.log(`\n— Stage override pass (${write ? 'write' : 'dry run'}) —`);
console.log(`   ${overrides.logic?.length ?? 0} logic card(s) + ${overrides.coding?.length ?? 0} coding task(s)\n`);

for (const ov of overrides.logic ?? []) {
  const r = applyLogic(ov);
  if (r === 'changed') { changed++; console.log(`   ~ ${ov.section}/${ov.kind}: replaced`); }
  else if (r === undefined) failures++;
}

for (const ov of overrides.coding ?? []) {
  const r = applyCoding(ov);
  if (r === 'changed') { changed++; console.log(`   ~ ${ov.section}/coding: replaced`); }
  else if (r === 'unchanged') console.log(`   = ${ov.section}/coding: already applied`);
  else failures++;
}

if (!failures && !changed) ok('sections.json already carries every stage override');

assertUnique();

if (write && changed && !failures) {
  fs.writeFileSync(SECTIONS_JSON, JSON.stringify(sections));
  ok(`wrote ${path.relative(ROOT, SECTIONS_JSON)} (${changed} stage card(s) updated)`);
} else if (changed && !failures) {
  warn(`${changed} stage card(s) would change — run: npm run curriculum:stages:write`);
}

console.log('');
if (failures) { bad(`${failures} stage override problem(s)`); process.exit(1); }
