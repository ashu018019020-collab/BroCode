#!/usr/bin/env node
/**
 * C Programming course pipeline.
 *
 * Authored source lives in `content/c-programming/**`; this script validates it and publishes
 * `public/generated/c-course/*.json`. The dry run validates only; `--write` publishes. Nothing here
 * invents content: the counts on the course card are counted from the module files, and a module
 * that is missing one of the 22 lesson blocks fails the build instead of shipping a partial lesson.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'c-programming');
const OUT = path.join(ROOT, 'public', 'generated', 'c-course');
const WRITE = process.argv.includes('--write');

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const course = readJSON(path.join(SRC, 'course.json'));
const extras = {
  labs: readJSON(path.join(SRC, 'labs.json')),
  projects: readJSON(path.join(SRC, 'projects.json')),
  interview: readJSON(path.join(SRC, 'interview.json')),
  assessments: readJSON(path.join(SRC, 'assessments.json')),
};
const modules = course.modules.map((id) => readJSON(path.join(SRC, 'modules', `${id}.json`)));

const problems = [];
const fail = (msg) => problems.push(msg);
const REQUIRED = ['id', 'no', 'title', 'level', 'hours', 'goal', 'prereqs', 'definition', 'explain', 'analogy',
  'why', 'syntax', 'topics', 'examples', 'mistakes', 'debug', 'best', 'practice', 'mcqs', 'interview', 'lab', 'checkpoint'];
const LEVELS = new Set(['beginner', 'intermediate', 'advanced']);

/* ------------------------------- modules -------------------------------- */
const ids = new Set();
modules.forEach((m, index) => {
  for (const key of REQUIRED) if (m[key] === undefined) fail(`${m.id || index}: missing ${key}`);
  if (ids.has(m.id)) fail(`duplicate module id ${m.id}`);
  ids.add(m.id);
  if (m.no !== index + 1) fail(`${m.id}: no must be ${index + 1}`);
  if (!LEVELS.has(m.level)) fail(`${m.id}: bad level ${m.level}`);
  if (!Array.isArray(m.topics) || m.topics.length < 3) fail(`${m.id}: needs at least 3 topics`);
  if (!Array.isArray(m.examples) || m.examples.length < 2) fail(`${m.id}: needs at least 2 examples`);
  for (const ex of m.examples || []) {
    for (const key of ['level', 'title', 'code', 'output', 'lines']) if (!ex[key]) fail(`${m.id}: example missing ${key}`);
    if (!Array.isArray(ex.lines) || ex.lines.length < 2) fail(`${m.id}: example ${ex.title} needs line notes`);
  }
  for (const mcq of m.mcqs || []) {
    if (!Array.isArray(mcq.options) || mcq.options.length !== 4) fail(`${m.id}: MCQ needs 4 options`);
    if (!Number.isInteger(mcq.answer) || mcq.answer < 0 || mcq.answer > 3) fail(`${m.id}: MCQ answer out of range`);
    if (!mcq.explain) fail(`${m.id}: MCQ needs an explanation`);
  }
  for (const q of m.interview || []) if (!q.q || !q.a) fail(`${m.id}: interview item needs q and a`);
  for (const p of m.practice || []) if (!p.title || !p.prompt) fail(`${m.id}: practice item needs title and prompt`);
  for (const t of m.topics || []) if (!t.title || !t.body) fail(`${m.id}: topic needs title and body`);
  if (!m.lab || !m.lab.title || !m.lab.solution) fail(`${m.id}: lab needs a title and solution`);
  if (!m.lab?.tests?.length) fail(`${m.id}: lab needs at least one test`);
  if (!m.debug || !m.debug.code || !m.debug.expected || !m.debug.fix) fail(`${m.id}: debug block incomplete`);
  if (!m.checkpoint?.checks?.length) fail(`${m.id}: checkpoint needs checks`);
  if (m.visual && !m.visual.rows?.length) fail(`${m.id}: visual needs rows`);
});

/* --------------------------------- labs --------------------------------- */
const moduleLabs = modules.map((m) => ({
  id: `lab-${m.id}`,
  module: m.id,
  title: m.lab.title,
  brief: m.lab.brief,
  objective: m.goal,
  level: m.level,
  category: 'module',
  starter: m.lab.starter,
  expected: m.lab.expected,
  tests: m.lab.tests,
  hints: m.lab.hints,
  solution: m.lab.solution,
  xp: m.level === 'beginner' ? 20 : m.level === 'intermediate' ? 35 : 50,
}));
const labs = [...moduleLabs, ...extras.labs];
const labIds = new Set();
for (const lab of labs) {
  if (labIds.has(lab.id)) fail(`duplicate lab id ${lab.id}`);
  labIds.add(lab.id);
  if (!ids.has(lab.module)) fail(`${lab.id}: unknown module ${lab.module}`);
  if (!lab.title || !lab.starter || !lab.solution) fail(`${lab.id}: lab incomplete`);
  if (!Array.isArray(lab.tests) || !lab.tests.length) fail(`${lab.id}: needs tests`);
  for (const t of lab.tests || []) if (!t.name || typeof t.stdout !== 'string') fail(`${lab.id}: test needs name and stdout`);
}

/* ------------------------------- projects ------------------------------- */
const projectIds = new Set();
for (const p of extras.projects) {
  if (projectIds.has(p.id)) fail(`duplicate project id ${p.id}`);
  projectIds.add(p.id);
  if (!p.title || !p.summary) fail(`${p.id}: project incomplete`);
  if (!ids.has(p.module)) fail(`${p.id}: unknown module ${p.module}`);
  if (!p.starter?.trim()) fail(`${p.id}: needs a starter program`);
  if (!p.milestones?.length) fail(`${p.id}: needs milestones`);
  for (const ms of p.milestones || []) if (!ms.title || !ms.tasks?.length) fail(`${p.id}: milestone incomplete`);
}

/* ------------------------------ interviews ------------------------------ */
const interview = [
  ...modules.flatMap((m) => m.interview.map((q, i) => ({
    id: `${m.id}-i${i}`, module: m.id, level: m.level, topic: m.title, q: q.q, a: q.a, followUp: q.followUp || '',
  }))),
  ...extras.interview.map((q) => ({ id: `bank-${q.id}`, module: null, level: q.level, topic: q.topic, q: q.q, a: q.a, followUp: q.followUp || '' })),
];
for (const q of interview) if (!q.q || !q.a || !LEVELS.has(q.level)) fail(`interview ${q.id}: incomplete`);

/* ----------------------------- assessments ------------------------------ */
const assessments = extras.assessments.sets;
for (const set of assessments) {
  if (!ids.has(set.module)) fail(`${set.id}: unknown module ${set.module}`);
  if (!set.questions?.length) fail(`${set.id}: needs questions`);
  for (const q of set.questions || []) {
    if (q.options?.length !== 4 || !Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) fail(`${set.id}: bad question`);
  }
}

const cards = modules.map((m) => ({
  id: m.id,
  no: m.no,
  title: m.title,
  level: m.level,
  hours: m.hours,
  goal: m.goal,
  brief: m.explain[0],
  counts: {
    topics: m.topics.length,
    examples: m.examples.length,
    practice: m.practice.length,
    mcqs: m.mcqs.length,
    interview: m.interview.length,
  },
}));

const stats = {
  modules: modules.length,
  topics: modules.reduce((a, m) => a + m.topics.length, 0),
  examples: modules.reduce((a, m) => a + m.examples.length, 0),
  practice: modules.reduce((a, m) => a + m.practice.length, 0),
  mcqs: modules.reduce((a, m) => a + m.mcqs.length, 0) + assessments.reduce((a, s) => a + s.questions.length, 0),
  interview: interview.length,
  labs: labs.length,
  projects: extras.projects.length,
  hours: modules.reduce((a, m) => a + m.hours, 0),
};

if (problems.length) {
  console.error(`c-course: ${problems.length} problem(s)\n` + problems.map((p) => `  · ${p}`).join('\n'));
  process.exit(1);
}

const artifacts = {
  'index.json': { course, stats, modules: cards },
  'course.json': { course, stats, modules },
  'labs.json': { labs },
  'projects.json': { projects: extras.projects },
  'interview.json': { questions: interview },
  'assessments.json': { sets: assessments },
};

if (!WRITE) {
  console.log(`c-course: OK — ${stats.modules} modules, ${stats.topics} topics, ${stats.labs} labs, ${stats.projects} projects, ${stats.interview} interview Qs, ${stats.mcqs} MCQs (dry run)`);
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, value] of Object.entries(artifacts)) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2) + '\n');
}
console.log(`c-course: wrote ${Object.keys(artifacts).length} artifacts — ${stats.modules} modules, ${stats.topics} topics, ${stats.labs} labs, ${stats.projects} projects, ${stats.interview} interview Qs, ${stats.mcqs} MCQs`);
