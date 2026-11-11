#!/usr/bin/env node
/**
 * NumPy Mastery course pipeline.
 *
 * Authored source: `content/numpy-mastery/course.json` + `modules-*.json` (five modules per file).
 * This script validates that source and publishes ONE artifact:
 * `public/generated/numpy-course/index.json` — course metadata plus, per module, the ten learning
 * sections built from the module's own authored material.
 *
 * Nothing is invented: a section entry is a projection of a named field (a topic's body, its code,
 * its verified output, an authored debug challenge), so a count on the course card is a count of
 * real records. Duplicate ids, duplicate questions inside a section, or a debug challenge whose
 * "fix" equals its "broken" code fail the run instead of shipping.
 *
 * Dry run validates only; `--write` publishes.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'numpy-mastery');
const OUT = path.join(ROOT, 'public', 'generated', 'numpy-course');
const WRITE = process.argv.includes('--write');
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const course = readJSON(path.join(SRC, 'course.json')).course;
const moduleFiles = fs.readdirSync(SRC).filter((f) => /^modules-.*\.json$/.test(f)).sort();
const modules = moduleFiles.flatMap((f) => readJSON(path.join(SRC, f)));

const problems = [];
const fail = (m) => problems.push(m);

/*
 * `deepening*.json` is the depth layer: extra topics and debug challenges per module, appended to the
 * authored module so a module can grow without rewriting the file it lives in. Layers are applied in
 * phase order (`deepening.json`, then `deepening-2.json`, ...). Their code samples are executed by
 * `scripts/numpy-fill-outputs.cjs`; a missing output here is a failure, not an empty card.
 */
const layerOrder = (f) => (f === 'deepening.json' ? 0 : Number((f.match(/deepening-(\d+)/) || [])[1] || 0));
const deepeningFiles = fs.readdirSync(SRC).filter((f) => /^deepening.*\.json$/.test(f)).sort((a, b) => layerOrder(a) - layerOrder(b));
const deepening = {};
for (const file of deepeningFiles) {
  for (const [id, pack] of Object.entries(readJSON(path.join(SRC, file)))) {
    const into = deepening[id] || (deepening[id] = { topics: [], debug: [] });
    into.topics.push(...(pack.topics || []));
    if (pack.debug) into.debug.push(...pack.debug);
  }
}
for (const [id, pack] of Object.entries(deepening)) {
  const target = modules.find((m) => m.id === id);
  if (!target) {
    fail(`deepening: unknown module ${id}`);
    continue;
  }
  for (const topic of pack.topics) {
    if (!topic.output) fail(`${id}: deepening topic "${topic.title}" has no verified output — run node scripts/numpy-fill-outputs.cjs`);
    target.topics.push(topic);
  }
  target.debug.push(...pack.debug);
}

/*
 * `tasks.json` is the independence layer: per module, coding tasks posed with their own data and a
 * hidden check, so copying the taught snippet cannot pass. `scripts/numpy-fill-outputs.cjs` executes
 * each solution + check and stores what the reference prints.
 */
const taskFiles = fs.readdirSync(SRC).filter((f) => /^tasks.*\.json$/.test(f)).sort();
const tasks = {};
for (const file of taskFiles) {
  for (const [id, list] of Object.entries(readJSON(path.join(SRC, file)))) {
    (tasks[id] || (tasks[id] = [])).push(...list);
  }
}
for (const [id, list] of Object.entries(tasks)) {
  const target = modules.find((m) => m.id === id);
  if (!target) {
    fail(`tasks: unknown module ${id}`);
    continue;
  }
  for (const task of list) {
    if (!task.title || !task.statement || !task.solution) fail(`${id}: task needs title/statement/solution`);
    if (!task.check) fail(`${id}: task "${task.title}" needs a hidden check`);
    if (!task.expected) fail(`${id}: task "${task.title}" has no executed output — run node scripts/numpy-fill-outputs.cjs`);
  }
  target.tasks = list;
}

const SECTIONS = [
  ['learn', 'Learn'], ['interview', 'Interview'], ['coding', 'Coding Lab'], ['logic', 'Logic'],
  ['debug', 'Debug'], ['practice', 'Practice Solutions'], ['miniProject', 'Mini Project'],
  ['projectLab', 'Project Lab'], ['defense', 'Defense'], ['checkpoint', 'Checkpoint'],
];
const LEVELS = new Set(['beginner', 'intermediate', 'advanced']);
/** Easy, Medium, Hard — cycled by position so a section never shows one difficulty only. */
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const difficultyAt = (i) => DIFFICULTIES[i % DIFFICULTIES.length];

/* --------------------------------- course -------------------------------- */
for (const key of ['id', 'slug', 'title', 'tagline', 'description', 'level', 'hours', 'prerequisites', 'outcomes']) {
  if (!course[key]) fail(`course: missing ${key}`);
}
if (course.id !== 'numpy-mastery') fail('course.id must be numpy-mastery');
if (!Array.isArray(course.modules) || course.modules.length !== 20) fail('course.modules must list 20 ids');

/* -------------------------------- modules -------------------------------- */
const seenModuleIds = new Set();
const seenTitles = new Set();
modules.forEach((m, index) => {
  if (!/^n\d{2}$/.test(m.id || '')) fail(`${m.id || index}: id must be nNN`);
  if (m.id !== `n${String(index + 1).padStart(2, '0')}`) fail(`${m.id}: id must be n${String(index + 1).padStart(2, '0')}`);
  if (m.no !== index + 1) fail(`${m.id}: no must be ${index + 1}`);
  if (seenModuleIds.has(m.id)) fail(`duplicate module id ${m.id}`);
  seenModuleIds.add(m.id);
  if (!m.title || seenTitles.has(m.title)) fail(`${m.id}: missing or duplicate module title`);
  seenTitles.add(m.title);
  if (!LEVELS.has(m.level)) fail(`${m.id}: bad level ${m.level}`);
  if (!(m.hours > 0)) fail(`${m.id}: hours must be positive`);
  if (!m.goal) fail(`${m.id}: missing goal`);
  if (!Array.isArray(m.topics) || m.topics.length < 3) fail(`${m.id}: needs 3+ topics`);
  const topicTitles = new Set();
  for (const [i, t] of (m.topics || []).entries()) {
    if (!t.title || !t.body) fail(`${m.id}: topic ${i + 1} needs title and body`);
    if (topicTitles.has(t.title)) fail(`${m.id}: duplicate topic title "${t.title}"`);
    topicTitles.add(t.title);
    if (!t.code || !t.output) fail(`${m.id}: topic ${t.title || i + 1} needs code and verified output`);
    if (String(t.code).includes('\t')) fail(`${m.id}: ${t.title} code contains a tab`);
  }
  if (!Array.isArray(m.debug) || m.debug.length < 2) fail(`${m.id}: needs 2+ debug challenges`);
  for (const d of m.debug || []) {
    if (!d.title || !d.broken || !d.fix || !d.error) fail(`${m.id}: debug challenge needs title/broken/fix/error`);
    if (d.fix === d.broken) fail(`${m.id}: debug "${d.title}" fix equals broken code`);
  }
  if (!Array.isArray(m.tasks) || m.tasks.length < 1) fail(`${m.id}: needs 1+ independent coding task`);
  if (!m.mini?.title || !m.mini?.brief || !m.mini.steps?.length) fail(`${m.id}: mini project incomplete`);
  if (!m.lab?.title || !m.lab?.brief || !m.lab.milestones?.length) fail(`${m.id}: project lab incomplete`);
});

if (modules.length !== 20) fail(`expected 20 modules, found ${modules.length}`);

/* -------------------------------- sections ------------------------------- */
/**
 * Three choices for a checkpoint: the real output plus two other topics' real outputs from the same
 * module. Distractors are executed records, never invented text, and the correct answer is always
 * present — a quiz with hand-typed distractors could not be checked. Position rotates with the title
 * so the answer is not always first.
 */
function checkpointOptions(title, answer, topics) {
  const seen = new Set([String(answer).trim()]);
  const pool = [];
  for (const t of topics) {
    if (t.title === title) continue;
    const out = String(t.output).trim();
    if (!out || seen.has(out)) continue;
    seen.add(out);
    pool.push(out);
  }
  if (pool.length < 2) return undefined;
  const options = pool.slice(0, 2);
  options.splice(title.length % 3, 0, answer);
  return options;
}

function buildSections(m) {
  const topics = m.topics;
  const id = (section, i) => `${m.id}:${section}:${i}`;
  return {
    learn: topics.map((t, i) => ({
      id: id('learn', i), title: t.title, body: t.body, code: t.code, output: t.output, difficulty: difficultyAt(i),
    })),
    interview: topics.flatMap((t, i) => [
      {
        id: id('interview', i * 2), q: `What is ${t.title.toLowerCase()}, and when would you use it?`,
        answer: t.body, difficulty: difficultyAt(i),
      },
      {
        id: id('interview', i * 2 + 1), q: `What does this ${t.title.toLowerCase()} snippet print, and why?`,
        code: t.code, answer: t.output, difficulty: i === topics.length - 1 ? 'hard' : 'medium',
      },
    ]),
    /*
     * Coding Lab is independent tasks only: a guided entry copied the taught snippet, so it could be
     * passed by pasting the lesson. The lesson still ships in Learn, Practice and Checkpoint.
     */
    coding: (m.tasks || []).map((t, i) => ({
      id: id('coding', 't' + i), title: t.title, statement: t.statement, kind: 'task',
      starter: 'import numpy as np\n\n# read the task, then store your answer in `result`\n',
      solution: t.solution, expected: t.expected, check: t.check,
      difficulty: difficultyAt(i),
    })),
    logic: topics.map((t, i) => ({
      id: id('logic', i), q: `Predict the exact output of this ${t.title.toLowerCase()} code before you run it.`, code: t.code, answer: t.output,
      difficulty: difficultyAt(i),
    })),
    debug: m.debug.map((d, i) => ({
      id: id('debug', i), title: d.title, code: d.broken, error: d.error, fix: d.fix, difficulty: difficultyAt(i),
    })),
    practice: topics.map((t, i) => ({
      id: id('practice', i), title: `Rebuild from memory: ${t.title}`, task: t.body,
      solution: t.code, expected: t.output, difficulty: difficultyAt(i),
    })),
    miniProject: [{
      id: id('miniProject', 0), title: m.mini.title, body: m.mini.brief, steps: m.mini.steps, difficulty: 'medium',
    }],
    projectLab: [{
      id: id('projectLab', 0), title: m.lab.title, body: m.lab.brief, steps: m.lab.milestones, difficulty: 'hard',
    }],
    defense: topics.map((t, i) => ({
      id: id('defense', i), q: `Explain ${t.title.toLowerCase()} to an interviewer, then defend the dtype and axis choices in your code.`,
      answer: t.body, code: t.code, difficulty: difficultyAt(i),
    })),
    checkpoint: topics.flatMap((t, i) => [
      {
        id: id('checkpoint', i * 2), q: `Checkpoint: predict the output of this code about ${t.title.toLowerCase()}.`, code: t.code, answer: t.output,
        options: checkpointOptions(t.title, t.output, topics), difficulty: difficultyAt(i),
      },
      { id: id('checkpoint', i * 2 + 1), q: `In your own words: what does ${t.title.toLowerCase()} do?`, answer: t.body, difficulty: i === 0 ? 'easy' : 'medium' },
    ]),
  };
}

const published = modules.map((m) => {
  const sections = buildSections(m);
  for (const [key, label] of SECTIONS) {
    const list = sections[key];
    if (!list.length) fail(`${m.id}: section ${label} is empty`);
    const ids = new Set();
    for (const entry of list) {
      if (ids.has(entry.id)) fail(`${m.id}/${label}: duplicate id ${entry.id}`);
      ids.add(entry.id);
    }
    const questions = list.map((e) => e.q || e.title || '').filter(Boolean);
    if (new Set(questions).size !== questions.length) fail(`${m.id}/${label}: duplicate question text`);
  }
  for (const entry of sections.checkpoint) {
    if (!entry.options) continue;
    if (entry.options.length !== 3) fail(`${entry.id}: a checkpoint quiz needs 3 options`);
    if (new Set(entry.options).size !== 3) fail(`${entry.id}: checkpoint options must be distinct`);
    if (!entry.options.includes(entry.answer)) fail(`${entry.id}: the options must include the answer`);
  }
  const counts = Object.fromEntries(SECTIONS.map(([key]) => [key, sections[key].length]));
  return { ...m, sections, counts, entries: Object.values(counts).reduce((a, b) => a + b, 0) };
});

const bySection = Object.fromEntries(SECTIONS.map(([key, label]) => [label, published.reduce((a, m) => a + m.counts[key], 0)]));
const stats = {
  modules: published.length,
  entries: published.reduce((a, m) => a + m.entries, 0),
  bySection,
  targetPerSection: 50,
  targetTotal: 10000,
};

if (problems.length) {
  console.error(`numpy-course: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}

const artifact = { course, stats, modules: published };
if (WRITE) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.json'), `${JSON.stringify(artifact, null, 1)}\n`);
  console.log(`numpy-course: published ${stats.modules} modules, ${stats.entries} entries → public/generated/numpy-course/index.json`);
  for (const [label, n] of Object.entries(bySection)) console.log(`  · ${label}: ${n}`);
} else {
  console.log(`numpy-course: valid — ${stats.modules} modules, ${stats.entries} entries (dry run; --write to publish)`);
}
