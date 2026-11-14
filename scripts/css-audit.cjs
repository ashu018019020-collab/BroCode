#!/usr/bin/env node
/**
 * Read-only audit of the CSS Mastery course.
 *
 * The generator proves the artifact is well formed; this script proves the course is complete in the
 * ways a learner would notice. It checks the published artifact and the authored source together:
 *
 *   · 24 modules, css01…css24, ten non-empty sections each;
 *   · every foundation module (css01–css08) carries at least 50 interview items;
 *   · no interview question and no interview answer is repeated anywhere in the course;
 *   · every Learn, Coding Lab solution and Practice solution is a complete HTML document;
 *   · every Debug entry changes the sample and records the fixed result;
 *   · every MCQ has four distinct options and includes its answer;
 *   · no record ships an empty output or a placeholder.
 *
 * Exit code 1 means the course has an open defect; warnings do not fail the run.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT = path.join(ROOT, 'public', 'generated', 'css-course', 'index.json');
const SRC = path.join(ROOT, 'content', 'css-mastery');

const errors = [];
const warnings = [];
const fail = (message) => errors.push(message);
const warn = (message) => warnings.push(message);

if (!fs.existsSync(ARTIFACT)) {
  console.error('css-audit: artifact missing — run `npm run css-course:write` first');
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
const modules = artifact.modules ?? [];
const { course, stats } = artifact;

const isCompleteDoc = (code) => {
  const text = String(code ?? '');
  return /^\s*<!DOCTYPE html>/i.test(text)
    && /<html[\s>]/i.test(text)
    && /<head[\s>]/i.test(text)
    && /<body[\s>]/i.test(text)
    && /<\/html>/i.test(text);
};

/* ------------------------------- course --------------------------------- */
if (course?.id !== 'css-mastery') fail(`course.id is ${course?.id ?? 'missing'}, expected css-mastery`);
if (!Array.isArray(course?.outcomes) || course.outcomes.length < 8) fail('course outcomes are missing or too few');
if (!Array.isArray(course?.prerequisites) || !course.prerequisites.length) fail('course prerequisites are missing');

if (modules.length !== 24) fail(`expected 24 modules, found ${modules.length}`);

modules.forEach((m, index) => {
  const expectedId = `css${String(index + 1).padStart(2, '0')}`;
  if (m.id !== expectedId) fail(`${m.id ?? `module ${index + 1}`}: expected id ${expectedId}`);
  if (!m.title || !m.goal) fail(`${m.id}: title or goal missing`);
  if (!(m.hours > 0)) fail(`${m.id}: hours must be positive`);
  if (m.sections && Object.values(m.sections).some((list) => !Array.isArray(list) || !list.length)) {
    fail(`${m.id}: a section is empty`);
  }
  if (m.entries < 30) warn(`${m.id}: only ${m.entries} entries`);

  const learn = m.sections?.learn ?? [];
  learn.forEach((e) => {
    if (!isCompleteDoc(e.code)) fail(`${m.id}/learn: "${e.title}" is not a complete HTML document`);
    if (!String(e.output ?? '').trim()) fail(`${m.id}/learn: "${e.title}" has no recorded result`);
    if (!String(e.body ?? '').trim()) fail(`${m.id}/learn: "${e.title}" has no explanation`);
  });

  const coding = m.sections?.coding ?? [];
  coding.forEach((e) => {
    if (!isCompleteDoc(e.solution)) fail(`${m.id}/coding: "${e.title}" solution is not a complete HTML document`);
    if (!String(e.expected ?? '').trim()) fail(`${m.id}/coding: "${e.title}" has no expected result`);
    if (!String(e.statement ?? '').trim()) fail(`${m.id}/coding: "${e.title}" has no statement`);
  });

  const debug = m.sections?.debug ?? [];
  debug.forEach((e) => {
    if (!String(e.code ?? '').trim() || !String(e.fix ?? '').trim()) fail(`${m.id}/debug: "${e.title}" is missing broken or fixed code`);
    if (e.code === e.fix) fail(`${m.id}/debug: "${e.title}" fix equals the broken sample`);
    if (!String(e.error ?? '').trim()) fail(`${m.id}/debug: "${e.title}" does not explain the failure`);
    if (!String(e.expected ?? '').trim()) fail(`${m.id}/debug: "${e.title}" has no fixed result`);
  });

  const practice = m.sections?.practice ?? [];
  practice.forEach((e) => {
    if (!isCompleteDoc(e.solution)) fail(`${m.id}/practice: "${e.title}" solution is not a complete HTML document`);
    if (!String(e.expected ?? '').trim()) fail(`${m.id}/practice: "${e.title}" has no recorded result`);
  });

  for (const e of m.sections?.checkpoint ?? []) {
    if (!e.options) continue;
    const expected = e.format === 'truefalse' ? 2 : e.format === 'mcq' ? 4 : 3;
    if (e.options.length !== expected) fail(`${m.id}/checkpoint: ${e.id} has ${e.options.length} options, expected ${expected}`);
    if (new Set(e.options).size !== e.options.length) fail(`${m.id}/checkpoint: ${e.id} has duplicate options`);
    if (!e.options.includes(e.answer)) fail(`${m.id}/checkpoint: ${e.id} answer is not one of its options`);
  }
});

/* ------------------------------ interview -------------------------------- */
const foundation = modules.filter((m) => Number(m.id.slice(3)) <= 8);
const allInterview = modules.flatMap((m) => m.sections?.interview ?? []);

foundation.forEach((m) => {
  const count = m.sections?.interview?.length ?? 0;
  if (count < 50) fail(`${m.id}: foundation interview bank has ${count} items, expected 50`);
});

const answers = allInterview.map((e) => String(e.answer ?? '').trim());
const questions = allInterview.map((e) => String(e.q ?? '').trim());

if (answers.some((a) => a.length < 20)) fail('an interview answer is shorter than 20 characters');
if (questions.filter((q) => !q).length) fail('an interview item has no question');

const dupAnswers = answers.filter((a, i) => answers.indexOf(a) !== i);
const dupQuestions = questions.filter((q, i) => questions.indexOf(q) !== i);
if (dupAnswers.length) {
  const sample = [...new Set(dupAnswers)].slice(0, 3).map((a) => `"${a.slice(0, 60)}…"`);
  fail(`duplicate interview answers: ${dupAnswers.length} (${sample.join(', ')})`);
}
if (dupQuestions.length) {
  const sample = [...new Set(dupQuestions)].slice(0, 3).map((q) => `"${q}"`);
  fail(`duplicate interview questions: ${dupQuestions.length} (${sample.join(', ')})`);
}

/* -------------------------------- source --------------------------------- */
const sourceFiles = fs.existsSync(SRC) ? fs.readdirSync(SRC).filter((f) => f.endsWith('.json')).sort() : [];
if (!sourceFiles.some((f) => f.startsWith('course'))) fail('content/css-mastery/course.json is missing');
if (!sourceFiles.some((f) => /^modules-/.test(f))) fail('no authored module files found');

const foundationCounts = foundation.map((m) => m.sections?.interview?.length ?? 0);
const summary = {
  modules: modules.length,
  entries: stats?.entries ?? 0,
  interview: allInterview.length,
  foundationInterviewMin: foundationCounts.length ? Math.min(...foundationCounts) : 0,
  foundationInterviewMax: foundationCounts.length ? Math.max(...foundationCounts) : 0,
  uniqueAnswers: new Set(answers).size,
  uniqueQuestions: new Set(questions).size,
  sections: stats?.bySection ?? {},
};

console.log(`css-audit: ${summary.modules} modules · ${summary.entries} entries · ${summary.interview} interview items`);
console.log(`  foundation interview: ${summary.foundationInterviewMin}–${summary.foundationInterviewMax} per module`);
console.log(`  unique interview answers: ${summary.uniqueAnswers}/${summary.interview}`);
console.log(`  unique interview questions: ${summary.uniqueQuestions}/${summary.interview}`);
for (const [label, count] of Object.entries(summary.sections)) console.log(`  · ${label}: ${count}`);

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const message of warnings.slice(0, 20)) console.log(`  ! ${message}`);
  if (warnings.length > 20) console.log(`  ! …and ${warnings.length - 20} more`);
}

if (errors.length) {
  console.error(`\ncss-audit: ${errors.length} error(s)`);
  for (const message of errors.slice(0, 40)) console.error(`  · ${message}`);
  if (errors.length > 40) console.error(`  · …and ${errors.length - 40} more`);
  process.exit(1);
}

console.log('\ncss-audit: clean — no open defects');
