#!/usr/bin/env node
/**
 * npm run course-banks | course-banks:write
 *
 * Publishes the small counts summary used by the Question Bank and Courses home cards. The cards
 * need only `modules` and `questions`; loading the full course artifacts to obtain those two numbers
 * was unnecessary (the SQL artifact alone is 1.4 MB, NumPy is 2.8 MB).
 *
 * The source of truth is the published artifacts, not a second hand-maintained list. Dry run by
 * default; `--write` publishes `public/generated/course-banks/index.json`. The test compares the
 * published file byte-for-byte with a fresh build.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'generated', 'course-banks', 'index.json');

const masterclassQuestions = (stats) =>
  stats.learn + stats.interview + stats.labs + stats.logic + stats.debug + stats.revision;

const bankQuestions = (data) => data.stats?.bank?.total;
const assessmentQuestions = (data) =>
  data.sets?.reduce((total, set) => total + (set.questions?.length ?? 0), 0);

const SOURCES = [
  { id: 'sql-masterclass', modules: 'sql-masterclass/index.json', questions: 'sql-masterclass/index.json', count: (data) => masterclassQuestions(data.stats ?? {}) },
  { id: 'mysql-masterclass', modules: 'mysql-masterclass/index.json', questions: 'mysql-masterclass/index.json', count: (data) => masterclassQuestions(data.stats ?? {}) },
  { id: 'sqlite-masterclass', modules: 'sqlite-masterclass/index.json', questions: 'sqlite-masterclass/index.json', count: (data) => masterclassQuestions(data.stats ?? {}) },
  { id: 'html-mastery', modules: 'html-course/index.json', questions: 'html-course/index.json', count: bankQuestions },
  { id: 'css-mastery', modules: 'css-course/index.json', questions: 'css-course/index.json', count: bankQuestions },
  { id: 'cpp-mastery', modules: 'cpp-course/index.json', questions: 'cpp-course/index.json', count: bankQuestions },
  { id: 'c-programming', modules: 'c-course/index.json', questions: 'c-course/assessments.json', count: assessmentQuestions },
  { id: 'java-programming', modules: 'java-course/index.json', questions: 'java-course/assessments.json', count: assessmentQuestions },
  { id: 'numpy-mastery', modules: 'numpy-course/index.json', questions: 'numpy-course/index.json', count: bankQuestions },
  { id: 'pandas-mastery', modules: 'pandas-course/index.json', questions: 'pandas-course/index.json', count: bankQuestions },
];

function readArtifact(file, cache) {
  if (!cache.has(file)) {
    cache.set(file, JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'generated', file), 'utf8')));
  }
  return cache.get(file);
}

function build() {
  const cache = new Map();
  const courses = SOURCES.map(({ id, modules: modulesFile, questions: questionsFile, count }) => {
    const modules = readArtifact(modulesFile, cache).stats?.modules;
    const questions = count(readArtifact(questionsFile, cache));
    if (!Number.isInteger(modules) || modules < 1) {
      throw new Error(`${id}: published stats.modules must be a positive integer`);
    }
    if (!Number.isInteger(questions) || questions < 1) {
      throw new Error(`${id}: published question count must be a positive integer`);
    }
    return { id, modules, questions };
  });

  if (new Set(courses.map((course) => course.id)).size !== courses.length) {
    throw new Error('course-banks: duplicate course id');
  }
  return { courses };
}

function main() {
  const write = process.argv.includes('--write');
  const summary = build();
  console.log(`course-banks: ${summary.courses.length} courses`);
  for (const course of summary.courses) {
    console.log(`  ${course.id}: ${course.modules} modules · ${course.questions} questions`);
  }
  if (!write) {
    console.log('dry run — run: npm run course-banks:write');
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`course-banks: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

module.exports = { build, SOURCES };
