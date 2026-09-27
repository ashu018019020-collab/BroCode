#!/usr/bin/env node
/**
 * packs.cjs — the 16-part topic workspace pipeline.
 *
 *   node scripts/packs.cjs               # dry run: validate every pack, execute every snippet
 *   node scripts/packs.cjs --write       # apply into public/curriculum/sections.json
 *   node scripts/packs.cjs check         # per-section quality matrix (the final checklist)
 *   node scripts/packs.cjs --section=s08 # limit the pass to one section
 *
 * Source of truth is content/curriculum/packs/<sectionId>.json (one file per topic, so a
 * topic can be authored and reviewed on its own). Each pack is merged into that section as
 * `section.topic`; existing extracted/overlaid content is never touched — the workspace is
 * additive, which is why a section can be filled in later without a half-built lesson.
 *
 * The pass is all-or-nothing: if any pack has a shape problem, or any snippet that should
 * run raises / any "broken" snippet that should fail runs cleanly, NOTHING is written.
 */
const fs = require('fs');
const path = require('path');
const { validatePack, verifyPack, partCoverage, PARTS } = require('./lib/packs.cjs');
const { pythonAvailable } = require('./lib/runpy.cjs');

const ROOT = path.join(__dirname, '..');
const SECTIONS_JSON = path.join(ROOT, 'public', 'curriculum', 'sections.json');
const PACKS_DIR = path.join(ROOT, 'content', 'curriculum', 'packs');

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const CHECK = argv.includes('check');
const ONLY = (argv.find((a) => a.startsWith('--section=')) || '').split('=')[1] || null;

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`\x1b[31m✕\x1b[0m ${m}`);
const warn = (m) => console.log(`\x1b[33m⚠\x1b[0m ${m}`);

const sections = JSON.parse(fs.readFileSync(SECTIONS_JSON, 'utf8'));
const byId = new Map(sections.map((s) => [s.id, s]));

function loadPacks() {
  if (!fs.existsSync(PACKS_DIR)) return [];
  return fs.readdirSync(PACKS_DIR).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ file: f, pack: JSON.parse(fs.readFileSync(path.join(PACKS_DIR, f), 'utf8')) }));
}

/* ------------------------------------------------------------- quality matrix */

function cmdCheck() {
  console.log('\n— Topic workspace quality check (16-part structure per section) —\n');
  const packs = new Map(loadPacks().map(({ pack }) => [pack.section, pack]));

  let complete = 0;
  const rows = [];
  for (const s of sections) {
    const pack = packs.get(s.id);
    // A section is measured against the pack inside sections.json when one is applied,
    // otherwise against its authored source file.
    const rendered = { ...s, topic: s.topic ?? pack };
    const cov = partCoverage(rendered);
    if (cov.complete) complete++;
    rows.push({ id: s.id, title: s.title, cov, authored: !!pack });
  }

  const w = (v, n) => String(v).padEnd(n);
  console.log(`${w('SECTION', 9)}${w('TOPIC', 34)}${w('SOURCE', 9)}PARTS`);
  for (const r of rows) {
    const bar = r.cov.complete ? `${r.cov.done}/16 ✓` : `${r.cov.done}/16  missing: ${r.cov.missing.slice(0, 4).join(', ')}${r.cov.missing.length > 4 ? ` +${r.cov.missing.length - 4}` : ''}`;
    console.log(`${w(r.id, 9)}${w(r.title.slice(0, 32), 34)}${w(r.authored ? 'pack' : '—', 9)}${bar}`);
  }
  console.log('');
  console.log(`${complete}/${sections.length} sections satisfy all 16 parts.`);
  if (complete < sections.length) warn('toolkit reports gaps honestly — author the missing parts in content/curriculum/packs/<section>.json');
  else ok('every section satisfies the full structure');

  // Nothing may ship half-built: a partially covered pack is an error for CI.
  const partial = rows.filter((r) => r.authored && !r.cov.complete);
  if (partial.length) {
    bad(`${partial.length} authored pack(s) are incomplete: ${partial.map((p) => p.id).join(', ')}`);
    process.exit(1);
  }
  process.exit(complete === sections.length ? 0 : 1);
}

/* ------------------------------------------------------------------- apply */

function cmdApply() {
  const packs = loadPacks().filter(({ pack }) => !ONLY || pack.section === ONLY);
  console.log(`\n— Topic workspace pass (${WRITE ? 'write' : 'dry run'}) —\n`);
  if (!packs.length) {
    warn('no packs in content/curriculum/packs yet — nothing to do');
    console.log('');
    return;
  }

  const problems = [];
  let verified = 0, unverified = 0, cases = 0, bugs = 0;
  const applied = [];

  for (const { file, pack } of packs) {
    const section = byId.get(pack.section);
    if (!section) { problems.push(`${file}: unknown section "${pack.section}"`); continue; }

    const shape = validatePack(pack);
    if (shape.length) { problems.push(...shape); continue; }

    const { pack: done, problems: runProblems } = verifyPack(pack);
    problems.push(...runProblems);
    if (runProblems.length) continue;

    // Count the honesty claims for the summary (and for the report).
    const all = [
      ...done.examples,
      ...Object.values(done.practice).flat(),
      ...done.coding,
      ...done.debugging,
      ...done.projects,
    ];
    for (const item of all) {
      if (item.verified === true) verified++;
      else if (item.verified === false) unverified++;
    }
    cases += done.practice ? Object.values(done.practice).flat().length : 0;
    bugs += done.debugging.length;

    section.topic = done;
    applied.push({ section: done.section, name: done.topic, pack: done, coverage: partCoverage(section) });
  }

  if (problems.length) {
    bad(`${problems.length} pack problem(s) — nothing written`);
    problems.slice(0, 15).forEach((p) => console.log('   · ' + p));
    process.exit(1);
  }

  for (const a of applied) {
    const t = a.pack;
    const practice = Object.values(t.practice ?? {}).flat().length;
    ok(`${a.section} · ${a.name}: ${a.coverage.done}/16 parts, ${practice} practice questions, ${t.coding.length} coding tasks, ${t.debugging.length} debugging tasks, ${t.projects.length} projects`);
  }
  console.log(`\n   snippets: ${verified} verified with real output, ${unverified} unrunnable locally (marked verified:false)`);
  console.log(`   practice questions: ${cases} · debugging tasks (broken code that really fails): ${bugs}`);

  if (WRITE) {
    fs.writeFileSync(SECTIONS_JSON, JSON.stringify(sections));
    ok(`wrote ${path.relative(ROOT, SECTIONS_JSON)}`);
  } else warn('dry run — re-run with --write to save');
  console.log('');
}

/* -------------------------------------------------------------------- main */

if (CHECK) cmdCheck();
else {
  if (!pythonAvailable()) warn('no local python — snippets will be marked verified:false');
  cmdApply();
}
