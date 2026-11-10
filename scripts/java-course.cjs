#!/usr/bin/env node
/**
 * Java Programming course pipeline.
 *
 * Authored source lives in `content/java-programming/**`; this script validates it and publishes
 * `public/generated/java-course/*.json`. The dry run validates only; `--write` publishes. Nothing
 * here invents content: every count on the course card is counted from the module files, and a
 * module missing one of the lesson blocks fails the build instead of shipping a partial lesson.
 *
 * The banks (coding, debugging, interview, labs, projects, assessments, final) are validated for
 * the SAME reason: a question with no reference solution, a test with no expected output, or a
 * debug challenge whose fix is the same as its broken code is not practice — it is a dead link
 * with a nice title.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'java-programming');
const OUT = path.join(ROOT, 'public', 'generated', 'java-course');
const WRITE = process.argv.includes('--write');

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const read = (name) => readJSON(path.join(SRC, name));
/**
 * A bank can be split by level into `content/java-programming/<dir>/*.json`, so a 100-question file
 * does not have to be one enormous document. Files are read in name order, which is why they are
 * prefixed 01-, 02-, 03- — the published order is the authored order.
 */
const readParts = (dir, key) => {
  const full = path.join(SRC, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((f) => f.endsWith('.json')).sort()
    .flatMap((f) => readJSON(path.join(full, f))[key] ?? []);
};
const course = read('course.json');
const modules = course.modules.map((id) => readJSON(path.join(SRC, 'modules', `${id}.json`)));
const coding = readParts('coding', 'questions');
const debugging = readParts('debugging', 'challenges');
const extraLabs = read('labs.json').labs;
const projects = read('projects.json').projects;
const interview = readParts('interview', 'questions');
const assessments = read('assessments.json').sets;
const final = read('final.json').final;

const problems = [];
const fail = (msg) => problems.push(msg);
const LEVELS = new Set(['beginner', 'intermediate', 'advanced']);
const REQUIRED = ['id', 'no', 'title', 'level', 'hours', 'goal', 'prereqs', 'objectives', 'definition',
  'explain', 'hinglish', 'analogy', 'why', 'syntax', 'topics', 'examples', 'mistakes', 'debug', 'best',
  'tip', 'revision', 'practice', 'mcqs', 'interview', 'lab', 'checkpoint'];

/* ------------------------------- modules -------------------------------- */
const ids = new Set();
modules.forEach((m, index) => {
  for (const key of REQUIRED) if (m[key] === undefined || m[key] === null) fail(`${m.id || index}: missing ${key}`);
  if (ids.has(m.id)) fail(`duplicate module id ${m.id}`);
  ids.add(m.id);
  if (m.id !== `j${String(index + 1).padStart(2, '0')}`) fail(`${m.id}: id must be j${String(index + 1).padStart(2, '0')}`);
  if (m.no !== index + 1) fail(`${m.id}: no must be ${index + 1}`);
  if (!LEVELS.has(m.level)) fail(`${m.id}: bad level ${m.level}`);
  if (!(m.hours > 0)) fail(`${m.id}: hours must be positive`);
  if (!Array.isArray(m.objectives) || m.objectives.length < 3) fail(`${m.id}: needs 3+ objectives`);
  if (!Array.isArray(m.explain) || m.explain.length < 2) fail(`${m.id}: needs 2+ English explanations`);
  if (!Array.isArray(m.hinglish) || m.hinglish.length < 2) fail(`${m.id}: needs 2+ Hinglish explanations`);
  if (!Array.isArray(m.syntax) || m.syntax.length < 2) fail(`${m.id}: needs 2+ syntax blocks`);
  for (const s of m.syntax || []) if (!s.code || !s.note) fail(`${m.id}: syntax needs code and note`);
  if (!Array.isArray(m.topics) || m.topics.length < 5) fail(`${m.id}: needs at least 5 topics (found ${m.topics?.length ?? 0})`);
  for (const t of m.topics || []) if (!t.title || !t.body) fail(`${m.id}: topic needs title and body`);
  if (!Array.isArray(m.examples) || m.examples.length < 2) fail(`${m.id}: needs at least 2 examples`);
  for (const ex of m.examples || []) {
    for (const key of ['level', 'title', 'code', 'output', 'lines']) if (!ex[key]) fail(`${m.id}: example missing ${key}`);
    if (!Array.isArray(ex.lines) || ex.lines.length < 2) fail(`${m.id}: example ${ex.title} needs line notes`);
  }
  if (!Array.isArray(m.mistakes) || m.mistakes.length < 2) fail(`${m.id}: needs 2+ mistakes`);
  for (const k of m.mistakes || []) if (!k.wrong || !k.right || !k.why) fail(`${m.id}: mistake needs wrong/right/why`);
  if (!m.debug || !m.debug.code || !m.debug.expected || !m.debug.fix) fail(`${m.id}: debug block incomplete`);
  if (!m.debug?.hints?.length) fail(`${m.id}: debug block needs hints`);
  if (!Array.isArray(m.best) || m.best.length < 3) fail(`${m.id}: needs 3+ best practices`);
  if (!m.tip) fail(`${m.id}: needs an interview tip`);
  if (!Array.isArray(m.revision) || m.revision.length < 3) fail(`${m.id}: needs 3+ revision lines`);
  if (!Array.isArray(m.practice) || m.practice.length < 3) fail(`${m.id}: needs 3+ practice exercises`);
  for (const p of m.practice || []) if (!p.title || !p.prompt || !p.hint) fail(`${m.id}: practice needs title/prompt/hint`);
  if (!Array.isArray(m.mcqs) || m.mcqs.length < 3) fail(`${m.id}: needs 3+ MCQs`);
  for (const q of m.mcqs || []) checkMcq(q, m.id);
  if (!Array.isArray(m.interview) || m.interview.length < 2) fail(`${m.id}: needs 2+ interview items`);
  for (const q of m.interview || []) if (!q.q || !q.a) fail(`${m.id}: interview item needs q and a`);
  if (!m.lab || !m.lab.title || !m.lab.starter || !m.lab.solution) fail(`${m.id}: lab incomplete`);
  if (!m.lab?.tests?.length) fail(`${m.id}: lab needs at least one test`);
  for (const t of m.lab?.tests || []) if (!t.name || typeof t.stdout !== 'string') fail(`${m.id}: lab test needs name and stdout`);
  if (!m.checkpoint?.checks?.length) fail(`${m.id}: checkpoint needs checks`);
  if (m.visual && !m.visual.rows?.length) fail(`${m.id}: visual needs rows`);
});

function checkMcq(q, where) {
  if (!q || !q.q || !q.explain) { fail(`${where}: MCQ needs a question and an explanation`); return; }
  if (!Array.isArray(q.options) || q.options.length !== 4) fail(`${where}: MCQ needs 4 options — ${String(q.q).slice(0, 50)}`);
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) fail(`${where}: MCQ answer out of range — ${String(q.q).slice(0, 50)}`);
  if (new Set(q.options).size !== 4) fail(`${where}: MCQ options must be distinct — ${String(q.q).slice(0, 50)}`);
}

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
const labs = [...moduleLabs, ...extraLabs];
const labIds = new Set();
for (const lab of labs) {
  if (labIds.has(lab.id)) fail(`duplicate lab id ${lab.id}`);
  labIds.add(lab.id);
  if (!ids.has(lab.module)) fail(`${lab.id}: unknown module ${lab.module}`);
  if (!lab.title || !lab.starter || !lab.solution) fail(`${lab.id}: lab incomplete`);
  if (!Array.isArray(lab.tests) || !lab.tests.length) fail(`${lab.id}: needs tests`);
  for (const t of lab.tests || []) if (!t.name || typeof t.stdout !== 'string') fail(`${lab.id}: test needs name and stdout`);
  if (!Array.isArray(lab.hints) || !lab.hints.length) fail(`${lab.id}: needs hints`);
}
if (extraLabs.length < 20) fail(`practical labs: expected at least 20, found ${extraLabs.length}`);

/* -------------------------------- coding -------------------------------- */
const codingIds = new Set();
const levelCount = { beginner: 0, intermediate: 0, advanced: 0 };
for (const q of coding) {
  if (codingIds.has(q.id)) fail(`duplicate coding question ${q.id}`);
  codingIds.add(q.id);
  if (!LEVELS.has(q.level)) fail(`coding ${q.id}: bad level ${q.level}`);
  else levelCount[q.level] += 1;
  if (!ids.has(q.module)) fail(`coding ${q.id}: unknown module ${q.module}`);
  for (const key of ['title', 'topic', 'statement', 'input', 'output', 'starter', 'solution', 'time', 'space']) {
    if (!q[key]) fail(`coding ${q.id}: missing ${key}`);
  }
  if (!Array.isArray(q.constraints) || !q.constraints.length) fail(`coding ${q.id}: needs constraints`);
  if (!Array.isArray(q.examples) || !q.examples.length) fail(`coding ${q.id}: needs an example`);
  if (!Array.isArray(q.tests) || q.tests.length < 2) fail(`coding ${q.id}: needs 2+ tests`);
  if (!q.tests?.some((t) => t.hidden)) fail(`coding ${q.id}: needs at least one hidden test`);
  for (const t of q.tests || []) if (!t.name || typeof t.output !== 'string') fail(`coding ${q.id}: test needs name and output`);
  if (!Array.isArray(q.hints) || !q.hints.length) fail(`coding ${q.id}: needs hints`);
  if (!Array.isArray(q.mistakes) || !q.mistakes.length) fail(`coding ${q.id}: needs common mistakes`);
  if (!Array.isArray(q.related) || !q.related.length) fail(`coding ${q.id}: needs related concepts`);
}
if (coding.length < 100) fail(`coding bank: expected at least 100 questions, found ${coding.length}`);
if (levelCount.beginner < 30) fail(`coding bank: expected 30+ beginner, found ${levelCount.beginner}`);
if (levelCount.intermediate < 40) fail(`coding bank: expected 40+ intermediate, found ${levelCount.intermediate}`);
if (levelCount.advanced < 30) fail(`coding bank: expected 30+ advanced, found ${levelCount.advanced}`);

/* ------------------------------- debugging ------------------------------ */
const debugIds = new Set();
for (const c of debugging) {
  if (debugIds.has(c.id)) fail(`duplicate debug challenge ${c.id}`);
  debugIds.add(c.id);
  if (!LEVELS.has(c.level)) fail(`debug ${c.id}: bad level`);
  if (!ids.has(c.module)) fail(`debug ${c.id}: unknown module ${c.module}`);
  for (const key of ['category', 'title', 'brief', 'expected', 'actual', 'error', 'code', 'fix', 'explain']) {
    if (!c[key]) fail(`debug ${c.id}: missing ${key}`);
  }
  if (c.code === c.fix) fail(`debug ${c.id}: the fix is the broken code`);
  if (!Array.isArray(c.hints) || !c.hints.length) fail(`debug ${c.id}: needs hints`);
  if (!Array.isArray(c.tests) || !c.tests.length) fail(`debug ${c.id}: needs tests`);
  for (const t of c.tests || []) if (!t.name || typeof t.stdout !== 'string') fail(`debug ${c.id}: test needs name and stdout`);
}
if (debugging.length < 50) fail(`debug lab: expected at least 50 challenges, found ${debugging.length}`);

/* ------------------------------- projects ------------------------------- */
const projectIds = new Set();
for (const p of projects) {
  if (projectIds.has(p.id)) fail(`duplicate project ${p.id}`);
  projectIds.add(p.id);
  if (!LEVELS.has(p.level)) fail(`${p.id}: bad level`);
  if (!ids.has(p.module)) fail(`${p.id}: unknown module ${p.module}`);
  if (!p.title || !p.summary || !p.useCase || !p.architecture) fail(`${p.id}: project incomplete`);
  if (!p.starter?.trim()) fail(`${p.id}: needs a starter program`);
  if (!p.steps?.length) fail(`${p.id}: needs steps`);
  for (const step of p.steps || []) if (!step.title || !step.tasks?.length) fail(`${p.id}: step incomplete`);
  for (const key of ['objectives', 'prereqs', 'requirements', 'features', 'structure', 'testing', 'errors', 'extensions', 'readme']) {
    if (!Array.isArray(p[key]) || !p[key].length) fail(`${p.id}: needs ${key}`);
  }
  if (/library management/i.test(p.title) && !p.schema) fail(`${p.id}: a database project needs a schema`);
}
if (projects.length < 15) fail(`projects: expected at least 15, found ${projects.length}`);

/* ------------------------------ interviews ------------------------------ */
const interviewIds = new Set();
const interviewLevel = { beginner: 0, intermediate: 0, advanced: 0 };
for (const q of interview) {
  if (interviewIds.has(q.id)) fail(`duplicate interview ${q.id}`);
  interviewIds.add(q.id);
  if (!LEVELS.has(q.level)) fail(`interview ${q.id}: bad level`);
  else interviewLevel[q.level] += 1;
  if (q.module !== null && !ids.has(q.module)) fail(`interview ${q.id}: unknown module ${q.module}`);
  for (const key of ['topic', 'q', 'a', 'explain', 'example', 'followUp', 'tip']) {
    if (!q[key]) fail(`interview ${q.id}: missing ${key}`);
  }
  if (typeof q.code !== 'string') fail(`interview ${q.id}: code must be a string (may be empty)`);
  if (!Array.isArray(q.related) || !q.related.length) fail(`interview ${q.id}: needs related questions`);
}
if (interview.length < 80) fail(`interview bank: expected at least 80 questions, found ${interview.length}`);
if (interviewLevel.beginner < 25) fail(`interview bank: expected 25+ beginner, found ${interviewLevel.beginner}`);
if (interviewLevel.intermediate < 30) fail(`interview bank: expected 30+ intermediate, found ${interviewLevel.intermediate}`);
if (interviewLevel.advanced < 25) fail(`interview bank: expected 25+ advanced, found ${interviewLevel.advanced}`);

/* ----------------------------- assessments ------------------------------ */
for (const set of assessments) {
  if (!ids.has(set.module)) fail(`${set.id}: unknown module ${set.module}`);
  if (!set.title) fail(`${set.id}: needs a title`);
  if (!set.questions?.length) fail(`${set.id}: needs questions`);
  for (const q of set.questions || []) checkMcq(q, set.id);
}
if (assessments.length !== modules.length) fail(`assessments: expected one set per module (${modules.length}), found ${assessments.length}`);

/* -------------------------------- final --------------------------------- */
if (!final || !final.questions?.length) fail('final assessment needs questions');
if (!(final?.passPct > 0 && final.passPct <= 100)) fail('final assessment passPct must be 1..100');
for (const q of final?.questions || []) checkMcq(q, 'final');

/* -------------------------------- publish ------------------------------- */
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
  mcqs: modules.reduce((a, m) => a + m.mcqs.length, 0) + assessments.reduce((a, s) => a + s.questions.length, 0) + final.questions.length,
  interview: modules.reduce((a, m) => a + m.interview.length, 0) + interview.length,
  labs: labs.length,
  projects: projects.length,
  coding: coding.length,
  debugging: debugging.length,
  hours: modules.reduce((a, m) => a + m.hours, 0),
};

if (problems.length) {
  console.error(`java-course: ${problems.length} problem(s)\n` + problems.map((p) => `  · ${p}`).join('\n'));
  process.exit(1);
}

const artifacts = {
  'index.json': { course, stats, modules: cards },
  'course.json': { course, stats, modules, final },
  'labs.json': { labs },
  'projects.json': { projects },
  'interview.json': { questions: interview },
  'assessments.json': { sets: assessments },
  'coding.json': { questions: coding },
  'debugging.json': { challenges: debugging },
  'final.json': { final },
};

if (!WRITE) {
  console.log(`java-course: OK — ${stats.modules} modules, ${stats.topics} topics, ${stats.examples} examples, `
    + `${stats.coding} coding Qs, ${stats.debugging} debug challenges, ${stats.interview} interview Qs, `
    + `${stats.labs} labs, ${stats.projects} projects, ${stats.mcqs} MCQs (dry run)`);
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, value] of Object.entries(artifacts)) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2) + '\n');
}
console.log(`java-course: wrote ${Object.keys(artifacts).length} artifacts — ${stats.modules} modules, ${stats.topics} topics, `
  + `${stats.coding} coding Qs, ${stats.debugging} debug challenges, ${stats.interview} interview Qs, ${stats.labs} labs, `
  + `${stats.projects} projects, ${stats.mcqs} MCQs`);
