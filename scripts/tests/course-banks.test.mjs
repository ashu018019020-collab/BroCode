/**
 * The Question Bank's course cards read a small generated summary instead of six full course
 * artifacts. Those counts must stay tied to the artifacts they describe; otherwise a card can show
 * a module/question count the course page no longer publishes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const { build } = require(path.join(ROOT, 'scripts', 'course-banks.cjs'));

const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));

test('course-banks: published summary matches the published artifacts', () => {
  assert.deepEqual(readJson('public/generated/course-banks/index.json'), build());
});

test('course-banks: every course card has real positive counts', () => {
  const summary = readJson('public/generated/course-banks/index.json');
  const ids = summary.courses.map((course) => course.id);
  assert.deepEqual(ids, [
    'sql-masterclass', 'mysql-masterclass', 'sqlite-masterclass',
    'html-mastery', 'css-mastery', 'cpp-mastery',
    'c-programming', 'java-programming', 'numpy-mastery', 'pandas-mastery',
  ]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate course id');
  for (const course of summary.courses) {
    assert.ok(Number.isInteger(course.modules) && course.modules > 0, `${course.id}: modules`);
    assert.ok(Number.isInteger(course.questions) && course.questions > 0, `${course.id}: questions`);
  }
  assert.deepEqual(
    summary.courses.filter((course) => ['c-programming', 'java-programming', 'numpy-mastery', 'pandas-mastery'].includes(course.id)),
    [
      { id: 'c-programming', modules: 20, questions: 80 },
      { id: 'java-programming', modules: 20, questions: 80 },
      { id: 'numpy-mastery', modules: 20, questions: 4058 },
      { id: 'pandas-mastery', modules: 20, questions: 2200 },
    ],
    'the other course cards count their real published banks',
  );
});

test('course-banks: new course cards pin their ids, hrefs and real counts', () => {
  const expected = [
    { id: 'sql-masterclass', title: 'SQL Masterclass', href: '/course/sql', modules: 37, questions: 3515 },
    { id: 'mysql-masterclass', title: 'MySQL Masterclass', href: '/mysql', modules: 1, questions: 95 },
    { id: 'sqlite-masterclass', title: 'SQLite Masterclass', href: '/sqlite', modules: 1, questions: 95 },
    { id: 'html-mastery', title: 'HTML Mastery', href: '/html', modules: 20, questions: 1006 },
    { id: 'css-mastery', title: 'CSS Mastery', href: '/css', modules: 24, questions: 2124 },
    { id: 'cpp-mastery', title: 'C++ Mastery', href: '/cpp', modules: 26, questions: 3720 },
  ];

  // The cards are JSX (the test loader only resolves .ts), so read the one authored list as text.
  const source = fs.readFileSync(path.join(ROOT, 'src/features/practice/QuestionBank.tsx'), 'utf8');
  const start = source.indexOf('const BANK_CARDS');
  assert.ok(start >= 0, 'QuestionBank must declare BANK_CARDS');
  const block = source.slice(start, source.indexOf('];', start));
  const cards = [...block.matchAll(/id:\s*'([^']+)',\s*title:\s*'([^']+)',\s*href:\s*'([^']+)'/g)]
    .map((match) => ({ id: match[1], title: match[2], href: match[3] }));

  assert.deepEqual(cards, expected.map(({ id, title, href }) => ({ id, title, href })),
    'course cards must not silently change identity or destination');

  const summary = new Map(readJson('public/generated/course-banks/index.json').courses
    .map((course) => [course.id, course]));
  assert.deepEqual(cards.map((card) => ({
    ...card,
    modules: summary.get(card.id)?.modules,
    questions: summary.get(card.id)?.questions,
  })), expected, 'each card must show the published module count and real question count');

  // A pinned href must still land on a page: five routes are exact and SQL uses the course slug route.
  const app = fs.readFileSync(path.join(ROOT, 'src/app/App.tsx'), 'utf8');
  const routes = new Set([...app.matchAll(/<Route path="([^"]+)"/g)].map((match) => match[1]));
  for (const { id, href } of expected) {
    assert.ok(
      routes.has(href) || (href.startsWith('/course/') && routes.has('/course/:slug')),
      `${id}: ${href} has no registered route`,
    );
  }
});

test('course-banks: card pages use the summary, not eager full artifacts', () => {
  const bank = fs.readFileSync(path.join(ROOT, 'src/features/practice/QuestionBank.tsx'), 'utf8');
  const home = fs.readFileSync(path.join(ROOT, 'src/features/courses/CoursesHome.tsx'), 'utf8');
  const eagerLoaders = [
    'useSqlMasterclass', 'useMysqlMasterclass', 'useSqliteMasterclass',
    'useHtmlCourse', 'useCssCourse', 'useCppCourse', 'useNumpyCourse', 'usePandasCourse',
  ];
  for (const loader of eagerLoaders) {
    assert.ok(!bank.includes(loader), `QuestionBank must not load ${loader} on mount`);
    assert.ok(!home.includes(loader), `CoursesHome must not load ${loader} on mount`);
  }
  assert.match(bank, /useCourseBanks\(\)/, 'QuestionBank counts come from the summary');
  assert.match(home, /useCourseBanks\(\)/, 'CoursesHome presence comes from the summary');
  assert.match(bank, /useCAssessments\(course === 'c'\)/, 'the C MCQ bank waits for its box');
  assert.ok(!/manifest && !selected/.test(bank), 'the first section bank must not auto-load');
});
