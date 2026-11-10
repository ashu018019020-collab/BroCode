#!/usr/bin/env node
/**
 * Java course coverage report — read-only, honest.
 *
 * Prints the measured entry count for each of the ten required sections, per module, and the
 * shortfall against the 50-per-section target. Nothing here authors content or rounds a number up;
 * a section with no source prints 0. `--check` exits 1 when any section is below the target, which is
 * how a future batch proves it moved the needle.
 *
 * Usage: node scripts/java-coverage.cjs [--check] [--json]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'generated', 'java-course');
const TARGET = 50;
const check = process.argv.includes('--check');
const asJson = process.argv.includes('--json');

const read = (name) => JSON.parse(fs.readFileSync(path.join(OUT, name), 'utf8'));
const course = read('course.json');
const coding = read('coding.json').questions;
const debugging = read('debugging.json').challenges;
const labs = read('labs.json').labs;
const projects = read('projects.json').projects;
const interview = read('interview.json').questions;
const sets = read('assessments.json').sets;

const by = (arr, key, value) => arr.filter((x) => x[key] === value).length;

const rows = course.modules.map((m) => {
  const set = sets.find((s) => s.module === m.id);
  const sections = {
    learn: m.topics.length + m.syntax.length + m.examples.length + m.mistakes.length + m.best.length + m.revision.length,
    interview: m.interview.length + by(interview, 'module', m.id),
    coding: by(coding, 'module', m.id),
    logic: 0,
    debug: by(debugging, 'module', m.id) + (m.debug ? 1 : 0),
    practice: m.practice.length,
    miniProject: by(projects, 'module', m.id),
    projectLab: by(projects, 'module', m.id),
    defense: interview.filter((q) => q.module === m.id && q.level === 'advanced').length,
    checkpoint: m.mcqs.length + (set?.questions.length ?? 0),
  };
  const below = Object.entries(sections).filter(([, n]) => n < TARGET).map(([k]) => k);
  return { id: m.id, title: m.title, labModules: by(labs, 'module', m.id), sections, below };
});

if (asJson) {
  console.log(JSON.stringify({ target: TARGET, modules: rows }, null, 2));
} else {
  const names = ['learn', 'interview', 'coding', 'logic', 'debug', 'practice', 'miniProject', 'projectLab', 'defense', 'checkpoint'];
  console.log(`\nJava coverage — target ${TARGET} per section per module\n`);
  console.log(`${'module'.padEnd(28)}${names.map((n) => n.slice(0, 7).padStart(8)).join('')}`);
  for (const row of rows) {
    const cells = names.map((n) => String(row.sections[n]).padStart(8)).join('');
    console.log(`${`${row.id} ${row.title}`.slice(0, 27).padEnd(28)}${cells}`);
  }
  const totals = names.map((n) => rows.reduce((sum, r) => sum + r.sections[n], 0));
  console.log(`${'TOTAL'.padEnd(28)}${totals.map((n) => String(n).padStart(8)).join('')}`);
  const required = names.length * TARGET * rows.length;
  console.log(`\nEntries: ${totals.reduce((a, b) => a + b, 0)} · required ${required} · shortfall ${required - totals.reduce((a, b) => a + b, 0)}`);
  console.log(`Modules below target in every section: ${rows.filter((r) => r.below.length === names.length).length}/${rows.length}`);
}

if (check && rows.some((r) => r.below.length)) {
  console.error(`\njava-coverage: FAILED — ${rows.filter((r) => r.below.length).length} module(s) below ${TARGET} in at least one section.`);
  process.exit(1);
}
