#!/usr/bin/env node
/**
 * npm run course-banks | course-banks:write
 *
 * Publishes the small counts summary the Question Bank and Courses home cards need. A card prints
 * only `modules` and `questions`, and loading the full course artifacts to obtain two numbers was
 * unnecessary (the SQL file alone is 1.4 MB, NumPy is 2.8 MB).
 *
 * Every value comes from the published artifact, including the id: `course.id` is the course's own
 * identity, so this list cannot disagree with the course it describes. A masterclass counts its
 * actual bank items rather than restating the app's six-family sum — `masterclassQuestionCount`
 * stays the only place that formula is written.
 *
 * Dry run by default; `--write` publishes `public/generated/course-banks/index.json`. The test
 * compares the published file byte-for-byte with a fresh build.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'generated', 'course-banks', 'index.json');

/** A masterclass publishes six banks per module; the items in them ARE its question count. */
const bankItems = (course) =>
  (course.modules ?? []).reduce(
    (total, module) => total + Object.values(module.banks ?? {}).reduce((n, items) => n + items.length, 0),
    0,
  );
/** HTML, CSS, C++, NumPy and Pandas publish their bank total on `stats`. */
const publishedBank = (course) => course.stats?.bank?.total;
/** C and Java keep their questions in a separate assessment file. */
const assessmentQuestions = (course) => course.sets?.reduce((total, set) => total + (set.questions?.length ?? 0), 0);

/** `questions` is named only where a course's counts live in a second artifact. */
const SOURCES = [
  { file: 'sql-masterclass/index.json', count: bankItems },
  { file: 'mysql-masterclass/index.json', count: bankItems },
  { file: 'sqlite-masterclass/index.json', count: bankItems },
  { file: 'html-course/index.json', count: publishedBank },
  { file: 'css-course/index.json', count: publishedBank },
  { file: 'cpp-course/index.json', count: publishedBank },
  { file: 'c-course/index.json', questions: 'c-course/assessments.json', count: assessmentQuestions },
  { file: 'java-course/index.json', questions: 'java-course/assessments.json', count: assessmentQuestions },
  { file: 'numpy-course/index.json', count: publishedBank },
  { file: 'pandas-course/index.json', count: publishedBank },
];

function readArtifact(file, cache) {
  if (!cache.has(file)) {
    cache.set(file, JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'generated', file), 'utf8')));
  }
  return cache.get(file);
}

function build() {
  const cache = new Map();
  return {
    courses: SOURCES.map(({ file, questions, count }) => {
      const course = readArtifact(file, cache);
      const id = course.course?.id;
      const modules = course.stats?.modules;
      const items = count(readArtifact(questions ?? file, cache));
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error(`${file}: the artifact must name its course`);
      }
      if (!Number.isInteger(modules) || modules < 1) {
        throw new Error(`${id}: published stats.modules must be a positive integer`);
      }
      if (!Number.isInteger(items) || items < 1) {
        throw new Error(`${id}: the published question count must be a positive integer`);
      }
      return { id, modules, questions: items };
    }),
  };
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

module.exports = { build };
