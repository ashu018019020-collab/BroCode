/**
 * The Question Bank and Courses home cards print two numbers per course — modules and questions —
 * from a small generated summary instead of loading six full course artifacts. Those numbers must
 * stay tied to the artifacts they describe, and the cards must keep pointing at the courses they
 * name; otherwise a card shows a count the course page no longer publishes.
 *
 * Two tables are pinned here and cross-checked: `COUNTS` (what the artifacts publish today) and
 * `CARDS` (the six card identities and destinations). A content change is expected to update
 * `COUNTS`; a card changing its id, title or href is not.
 *
 * The cards are JSX (the test loader only resolves .ts), so `QuestionBank.tsx` and the panel are
 * read as text — the same approach the other page-level tests take.
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

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const readJson = (relative) => JSON.parse(read(relative));

/** What the published artifacts answer today, in card order. */
const COUNTS = [
  { id: 'sql-masterclass', modules: 37, questions: 3515 },
  { id: 'mysql-masterclass', modules: 1, questions: 95 },
  { id: 'sqlite-masterclass', modules: 1, questions: 95 },
  { id: 'html-mastery', modules: 20, questions: 1006 },
  { id: 'css-mastery', modules: 24, questions: 2124 },
  { id: 'cpp-mastery', modules: 26, questions: 3720 },
  { id: 'c-programming', modules: 20, questions: 80 },
  { id: 'java-programming', modules: 20, questions: 80 },
  { id: 'numpy-mastery', modules: 20, questions: 4058 },
  { id: 'pandas-mastery', modules: 20, questions: 2200 },
  { id: 'ml-mastery', modules: 27, questions: 459 },
];

/** The invented cards beside the subject boxes: identity and destination, never the counts. */
const CARDS = [
  { id: 'sql-masterclass', title: 'SQL Masterclass', href: '/course/sql' },
  { id: 'mysql-masterclass', title: 'MySQL Masterclass', href: '/mysql' },
  { id: 'sqlite-masterclass', title: 'SQLite Masterclass', href: '/sqlite' },
  { id: 'html-mastery', title: 'HTML Mastery', href: '/html' },
  { id: 'css-mastery', title: 'CSS Mastery', href: '/css' },
  { id: 'cpp-mastery', title: 'C++ Mastery', href: '/cpp' },
];

test('course-banks: the published summary is the artifacts, in card order', () => {
  const summary = readJson('public/generated/course-banks/index.json');
  assert.deepEqual(summary, build(), 'stale summary — run: npm run course-banks:write');
  assert.deepEqual(summary.courses, COUNTS, 'a card prints these counts, so a change is a content change');
  assert.equal(
    new Set(summary.courses.map((course) => course.id)).size,
    summary.courses.length,
    'a duplicate id would make two cards share one row',
  );
});

test('course-banks: the course cards keep their identity, destination and published counts', () => {
  const source = read('src/features/practice/QuestionBank.tsx');
  const start = source.indexOf('const BANK_CARDS');
  assert.ok(start >= 0, 'QuestionBank must declare BANK_CARDS');
  const block = source.slice(start, source.indexOf('];', start));
  const cards = [...block.matchAll(/id:\s*'([^']+)',\s*title:\s*'([^']+)',\s*href:\s*'([^']+)'/g)]
    .map((match) => ({ id: match[1], title: match[2], href: match[3] }));
  assert.deepEqual(cards, CARDS, 'a card must not silently change identity or destination');

  const published = new Map(readJson('public/generated/course-banks/index.json').courses
    .map((course) => [course.id, course]));
  assert.deepEqual(
    cards.map((card) => ({ ...card, ...published.get(card.id) })),
    CARDS.map((card) => ({ ...card, ...COUNTS.find((count) => count.id === card.id) })),
    'each card must show the module count and real question count of its own course',
  );

  // A pinned href must still land on a page: five routes are exact and SQL uses the course slug route.
  const routes = new Set([...read('src/app/App.tsx').matchAll(/<Route path="([^"]+)"/g)].map((match) => match[1]));
  for (const { id, href } of CARDS) {
    assert.ok(
      routes.has(href) || (href.startsWith('/course/') && routes.has('/course/:slug')),
      `${id}: ${href} has no registered route`,
    );
  }
});

test('course-banks: card pages use the summary, not eager full artifacts', () => {
  const bank = read('src/features/practice/QuestionBank.tsx');
  const home = read('src/features/courses/CoursesHome.tsx');
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

test('course-banks: the SQL-family banks are the shared panel, not a second copy', () => {
  // CourseBankPanel used to re-render Learn/Interview/Coding Lab/Logic/Debug/Revision for SQL,
  // MySQL and SQLite on top of MasterclassPanel, so a bank change had to be made twice.
  const panel = read('src/features/practice/CourseBankPanel.tsx');
  const shared = read('src/features/labs/SqlMasterclass.tsx');

  assert.match(panel, /import \{ MasterclassPanel \} from '\.\.\/labs\/SqlMasterclass'/, 'the shared panel must be imported');
  assert.match(panel, /<MasterclassPanel\b/, 'the SQL-family banks must render through it');
  for (const duplicate of ['const BANKS', 'SqlQuizCard', 'SqlQaCard', 'SqlLabCard', 'SqlDebugCard', 'MasterclassQuestion']) {
    assert.ok(!panel.includes(duplicate), `CourseBankPanel must not re-implement ${duplicate}`);
  }
  // One authored bank list, in the shared panel.
  assert.equal((shared.match(/const BANKS\b/g) ?? []).length, 1);
  // Each card still loads only its own course artifact; the counts keep coming from the summary.
  for (const loader of ['useSqlMasterclass', 'useMysqlMasterclass', 'useSqliteMasterclass']) {
    assert.ok(panel.includes(loader), `${loader} must stay so a card loads only its own course`);
  }
  assert.match(panel, /MasterclassPanel file=\{file\} label="COURSE BANK" defaultOpen/);
});
