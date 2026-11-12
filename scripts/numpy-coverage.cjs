#!/usr/bin/env node
/**
 * NumPy lesson coverage: what a module actually teaches, counted from the published artifact.
 *
 * The source is `public/generated/numpy-course/index.json`, not the authored JSON — so the report
 * cannot claim a part that the generator dropped. Each Learn topic is checked for the two levels
 * (`simple`/`pro`) and the five lesson-structure fields; a module row shows `authored/topics` for
 * every part, and the gaps section names the topics still missing one.
 *
 * Usage:
 *   npm run numpy:coverage            report and exit 0
 *   npm run numpy:coverage -- --strict   exit 1 when any part is missing (for a future gate)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT = path.join(ROOT, 'public', 'generated', 'numpy-course', 'index.json');

const PARTS = [
  ['dual', (t) => Boolean(t.simple && t.pro)],
  ['syntax', (t) => Boolean(t.syntax)],
  ['steps', (t) => Array.isArray(t.steps) && t.steps.length > 0],
  ['visual', (t) => Boolean(t.visual)],
  ['realWorld', (t) => Boolean(t.realWorld)],
  ['mistakes', (t) => Array.isArray(t.mistakes) && t.mistakes.length > 0],
  ['revision', (t) => Array.isArray(t.revision) && t.revision.length > 0],
];
const FULL = PARTS.filter(([name]) => name !== 'dual');

if (!fs.existsSync(ARTIFACT)) {
  console.error(`numpy-coverage: ${path.relative(ROOT, ARTIFACT)} is missing — run \`npm run numpy-course:write\` first`);
  process.exit(2);
}

const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
const modules = artifact.modules || [];
if (!modules.length) {
  console.error('numpy-coverage: the artifact holds no modules');
  process.exit(2);
}

const pad = (value, width) => String(value).padStart(width);
const label = (value, width) => String(value).padEnd(width);

const rows = modules.map((m) => {
  const topics = m.sections?.learn || [];
  const counts = Object.fromEntries(PARTS.map(([name, ok]) => [name, topics.filter(ok).length]));
  const full = topics.filter((t) => FULL.every(([, ok]) => ok(t))).length;
  return { m, topics, counts, full };
});

const totalTopics = rows.reduce((n, r) => n + r.topics.length, 0);
const totalFull = rows.reduce((n, r) => n + r.full, 0);
const totalDual = rows.reduce((n, r) => n + r.counts.dual, 0);
const pct = (n) => (totalTopics ? Math.round((n / totalTopics) * 100) : 0);

console.log(`NumPy lesson coverage — ${path.relative(ROOT, ARTIFACT)}`);
console.log(`${totalTopics} Learn topics across ${modules.length} modules · ${artifact.stats?.entries ?? '?'} entries\n`);

const head = [label('module', 6), label('topic', 34), pad('topics', 6), ...PARTS.map(([name]) => pad(name, 10))];
console.log(head.join(' '));
console.log('-'.repeat(head.join(' ').length));
for (const { m, topics, counts } of rows) {
  console.log([
    label(m.id, 6),
    label(String(m.title).slice(0, 32), 34),
    pad(topics.length, 6),
    ...PARTS.map(([name]) => pad(`${counts[name]}/${topics.length}`, 10)),
  ].join(' '));
}
console.log('-'.repeat(head.join(' ').length));
console.log(`full 12-part: ${totalFull}/${totalTopics} (${pct(totalFull)}%) · dual-level: ${totalDual}/${totalTopics} (${pct(totalDual)}%)`);

const gaps = rows
  .map(({ m, topics }) => {
    const missing = FULL
      .map(([name, ok]) => ({ name, titles: topics.filter((t) => !ok(t)).map((t) => t.title) }))
      .filter((part) => part.titles.length);
    return { m, missing };
  })
  .filter((entry) => entry.missing.length);

if (!gaps.length) {
  console.log('\nNo gaps: every topic has both levels and all five lesson-structure parts.');
  process.exit(0);
}

console.log('\nMissing parts:');
for (const { m, missing } of gaps) {
  const summary = missing.map((part) => `${part.name} ${part.titles.length}`).join(', ');
  console.log(`\n${m.id} ${m.title} — ${summary}`);
  for (const part of missing) {
    const shown = part.titles.slice(0, 4).join('; ');
    const more = part.titles.length > 4 ? `; +${part.titles.length - 4} more` : '';
    console.log(`  ${part.name}: ${shown}${more}`);
  }
}

if (process.argv.includes('--strict')) {
  console.error('\nnumpy-coverage: --strict set and gaps remain');
  process.exit(1);
}
