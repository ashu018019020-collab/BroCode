#!/usr/bin/env node
/**
 * Read-only audit of the published NumPy course.
 *
 * Everything printed here is counted from `public/generated/numpy-course/index.json` — the same file the
 * app loads — so an authored-coverage number cannot drift from what a learner can open. It exits 1 only
 * on a real invariant break (missing output, duplicate id/title, empty section); partial authoring is
 * reported as a number, not a failure, because the course is honest about being partial.
 *
 * Usage: node scripts/numpy-audit.cjs        (npm run numpy:audit)
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const artifactPath = path.join(ROOT, 'public/generated/numpy-course/index.json');
if (!fs.existsSync(artifactPath)) {
  console.error('numpy-audit: the artifact is missing — run `node scripts/numpy-course.cjs --write`.');
  process.exit(1);
}
const a = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const modules = a.modules;
const all = modules.flatMap((m) => Object.values(m.sections).flat());
const learn = modules.flatMap((m) => m.sections.learn);
const coding = modules.flatMap((m) => m.sections.coding);

const problems = [];
const seenIds = new Set();
for (const e of all) {
  if (seenIds.has(e.id)) problems.push(`duplicate id ${e.id}`);
  seenIds.add(e.id);
}
const titles = new Map();
for (const e of learn) titles.set(e.title, (titles.get(e.title) || 0) + 1);
for (const [title, n] of titles) if (n > 1) problems.push(`duplicate Learn title "${title}" (${n})`);
for (const m of modules) {
  if (!m.sections.learn.length) problems.push(`${m.id}: empty Learn`);
  for (const e of m.sections.learn) {
    if (!e.code || !e.output) problems.push(`${e.id}: Learn without code/output`);
  }
}

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '0%');
const structure = learn.filter((e) => e.syntax && e.steps?.length && e.visual && e.realWorld && e.mistakes?.length && e.revision?.length);
const levels = learn.filter((e) => e.simple && e.pro);
const hints = coding.filter((e) => e.hint);
const bank = a.stats.bank;

console.log('numpy-audit — read-only, counted from the published artifact\n');
console.log(`modules              ${modules.length}`);
console.log(`entries              ${a.stats.entries} (${bank.perModule} per module, target ${bank.target})`);
console.log(`shortfall            ${bank.shortPerModule}/module · ${bank.shortfall} course-wide`);
console.log(`Learn topics         ${learn.length}`);
console.log(`  full 12-part shape ${structure.length} (${pct(structure.length, learn.length)})`);
console.log(`  dual-level simple+pro ${levels.length} (${pct(levels.length, learn.length)})`);
console.log(`coding hints         ${hints.length}/${coding.length} (${pct(hints.length, coding.length)})`);
console.log(`scenario questions   ${modules.flatMap((m) => m.sections.interview.filter((e) => e.scenario)).length}`);
console.log(`capstone             ${a.capstone ? `${a.capstone.tiers.length} tiers, rubric ${a.capstone.rubric.reduce((x, r) => x + r.weight, 0)}` : 'missing'}`);
console.log(`bytes                ${fs.statSync(artifactPath).size.toLocaleString()}`);
console.log('\ncategory counts (course total):');
const totals = {};
for (const row of Object.values(bank.modules)) {
  for (const [k, v] of Object.entries(row.categories)) totals[k] = (totals[k] || 0) + v;
}
for (const [key, value] of Object.entries(totals)) {
  console.log(`  ${key.padEnd(12)} ${value}`);
}

if (problems.length) {
  console.error(`\n${problems.length} invariant problem(s):`);
  for (const p of problems.slice(0, 20)) console.error(`  · ${p}`);
  process.exit(1);
}
console.log('\ninvariants: unique ids, unique Learn titles, every Learn topic has code + verified output.');
