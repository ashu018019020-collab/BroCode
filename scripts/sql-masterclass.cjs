#!/usr/bin/env node
/**
 * SQL Masterclass pipeline.
 *
 * Authored source: `content/sql-mastery/module-*.json`.
 * Published artifact: `public/generated/sql-masterclass/index.json`.
 *
 * Phase 1 ships Module 00 with its 24 topics and six authored banks. The generator refuses to
 * publish a module whose topics or banks are empty, so a later module cannot appear as a shell.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'sql-mastery');
const OUT = path.join(ROOT, 'public', 'generated', 'sql-masterclass');
const WRITE = process.argv.includes('--write');
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const problems = [];
const fail = (m) => problems.push(m);

const files = fs.readdirSync(SRC).filter((f) => /^module-.*\.json$/.test(f)).sort();
const modules = files.flatMap((f) => readJSON(path.join(SRC, f)).modules);
const first = files.length ? readJSON(path.join(SRC, files[0])) : null;
const course = first?.course;

if (!course) fail('course metadata missing');
for (const key of ['id', 'title', 'tagline', 'description', 'level', 'hours', 'prerequisites', 'outcomes', 'standard']) {
  if (!course?.[key]) fail(`course: missing ${key}`);
}
if (course && course.id !== 'sql-masterclass') fail('course.id must be sql-masterclass');
if (!modules.length) fail('no modules found');

const seenModules = new Set();
for (const m of modules) {
  if (!/^sql\d{2}$/.test(m.id || '')) fail(`${m.id}: id must be sqlNN`);
  if (seenModules.has(m.id)) fail(`duplicate module id ${m.id}`);
  seenModules.add(m.id);
  if (!m.title || !m.goal) fail(`${m.id}: title and goal are required`);
  if (!Array.isArray(m.topics) || m.topics.length < 3) fail(`${m.id}: needs 3+ topics`);
  const topicTitles = new Set();
  for (const t of m.topics || []) {
    if (!t.id || !t.title || !t.simple || !t.pro) fail(`${m.id}: topic needs id/title/simple/pro`);
    if (t.simple === t.pro) fail(`${m.id}/${t.title}: simple and pro are identical`);
    if (topicTitles.has(t.title)) fail(`${m.id}: duplicate topic title ${t.title}`);
    topicTitles.add(t.title);
  }
  for (const [bank, min] of [['learn', 20], ['interview', 20], ['labs', 20], ['logic', 15], ['debug', 10], ['revision', 10]]) {
    const list = m.banks?.[bank] || [];
    if (list.length < min) fail(`${m.id}: ${bank} needs ${min}+ items, found ${list.length}`);
  }
  const ids = new Set();
  for (const bank of ['learn', 'interview', 'labs', 'logic', 'debug', 'revision']) {
    for (const item of m.banks?.[bank] || []) {
      const key = `${m.id}:${bank}:${item.q || item.title}`;
      if (ids.has(key)) fail(`duplicate question text: ${key}`);
      ids.add(key);
    }
  }
  for (const q of m.banks?.learn || []) {
    if (!q.q || !Array.isArray(q.options) || q.options.length !== 4) fail(`${m.id}: learn item needs 4 options`);
    if (!q.options.includes(q.answer)) fail(`${m.id}: learn answer must be one of its options`);
    if (new Set(q.options).size !== 4) fail(`${m.id}: learn options must be distinct`);
  }
}

if (problems.length) {
  console.error(`sql-masterclass: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}

const counts = {
  modules: modules.length,
  topics: modules.reduce((n, m) => n + m.topics.length, 0),
  learn: modules.reduce((n, m) => n + m.banks.learn.length, 0),
  interview: modules.reduce((n, m) => n + m.banks.interview.length, 0),
  labs: modules.reduce((n, m) => n + m.banks.labs.length, 0),
  logic: modules.reduce((n, m) => n + m.banks.logic.length, 0),
  debug: modules.reduce((n, m) => n + m.banks.debug.length, 0),
  revision: modules.reduce((n, m) => n + m.banks.revision.length, 0),
};

const artifact = { course, stats: counts, modules };
if (WRITE) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.json'), `${JSON.stringify(artifact, null, 1)}\n`);
  console.log(`sql-masterclass: published ${counts.modules} module(s), ${counts.topics} topics, ${counts.learn + counts.interview + counts.labs + counts.logic + counts.debug + counts.revision} bank items → public/generated/sql-masterclass/index.json`);
} else {
  console.log(`sql-masterclass: valid — ${counts.modules} module(s), ${counts.topics} topics (dry run; --write to publish)`);
}
