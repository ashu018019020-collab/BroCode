/**
 * Owner-created course cards: the half of course management that can be a real create/delete.
 *
 * Catalog courses own generated content and learner progress keyed by their slug, so the dashboard
 * may only move or hide them. A card created by the owner owns none of that, which is what makes
 * create + delete safe — these tests pin the rules that keep it that way: valid slugs only, no
 * shadowing a built-in course, an INTERNAL link only, and malformed database rows dropped instead
 * of crashing the public Courses page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

// The app source uses extensionless imports (bundler resolution); the hook appends `.ts`.
register('./_ts-resolve.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const owner = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/owner-courses.ts')).href);
const levels = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/course-levels.ts')).href);

const valid = {
  slug: 'sql-interview-sprint',
  name: 'SQL Interview Sprint',
  summary: 'Window functions and joins, drilled.',
  href: '/questions?type=sql',
  logo: 'postgresql',
  tone: 'cyan',
  level: 'foundations',
  order: 2,
};

const row = (over = {}) => ({
  ...valid,
  optional: false,
  hidden: false,
  deletedAt: null,
  ...over,
});

test('owner courses: a name slugs deterministically into a route-safe id', () => {
  assert.equal(owner.slugifyCourseName('SQL Interview Sprint'), 'sql-interview-sprint');
  assert.equal(owner.slugifyCourseName('  Café & Data  '), 'cafe-data');
  assert.equal(owner.slugifyCourseName('A'), 'a');
  assert.equal(owner.slugifyCourseName('x'.repeat(80)).length <= 48, true, 'capped at the column width');
  assert.equal(owner.slugifyCourseName('Rust / Go'), 'rust-go');
});

test('owner courses: the draft contract refuses everything that would break a card', () => {
  assert.equal(owner.ownerCourseProblem(valid), null);
  assert.match(owner.ownerCourseProblem({ ...valid, name: '' }), /name/i);
  assert.match(owner.ownerCourseProblem({ ...valid, slug: 'No Spaces' }), /slug/i);
  assert.match(owner.ownerCourseProblem({ ...valid, slug: 'ab' }), /slug/i);
  // A custom card may never shadow a catalog course: its page and progress are keyed by that slug.
  assert.match(owner.ownerCourseProblem({ ...valid, slug: 'python' }), /built-in/i);
  assert.match(owner.ownerCourseProblem({ ...valid, slug: 'c-programming' }), /built-in/i);
  assert.match(owner.ownerCourseProblem({ ...valid, href: 'https://example.com' }), /app path/i);
  assert.match(owner.ownerCourseProblem({ ...valid, href: '//example.com/x' }), /app path/i);
  assert.match(owner.ownerCourseProblem({ ...valid, href: '/has space' }), /spaces/i);
  assert.match(owner.ownerCourseProblem({ ...valid, logo: 'not-a-mark' }), /logo/i);
  assert.match(owner.ownerCourseProblem({ ...valid, tone: 'neon' }), /tone/i);
  assert.match(owner.ownerCourseProblem({ ...valid, level: 'expert' }), /level/i);
  assert.match(owner.ownerCourseProblem({ ...valid, order: 0 }), /position/i);
  assert.match(owner.ownerCourseProblem({ ...valid, summary: 'x'.repeat(241) }), /summary/i);
});

test('owner courses: rows are validated, archived ones dropped and order is the journey order', () => {
  const cards = owner.ownerCourseCards([
    row({ slug: 'late', name: 'Late', level: 'career', order: 1 }),
    row({ slug: 'first', name: 'First', level: 'beginner', order: 1 }),
    row({ slug: 'bad', name: 'Bad', level: 'nope', order: 1 }),
    row({ slug: 'gone', name: 'Gone', deletedAt: '2026-11-06T00:00:00Z' }),
    row({ slug: 'late', name: 'Duplicate' }),
    row({ slug: 'second', name: 'Second', level: 'beginner', order: 2 }),
  ]);
  assert.deepEqual(cards.map((c) => c.slug), ['first', 'second', 'late']);
  assert.ok(cards.every((c) => c.name.trim() === c.name), 'names are normalised');
});

test('owner courses: placements interleave without touching built-in placements', () => {
  const cards = owner.ownerCourseCards([row()]);
  const placements = owner.ownerCoursePlacements(cards);
  assert.equal(placements.length, 1);
  assert.deepEqual(
    { slug: placements[0].slug, level: placements[0].level, order: placements[0].order },
    { slug: 'sql-interview-sprint', level: 'foundations', order: 2 },
  );
  assert.deepEqual(placements[0].prerequisites, [], 'a custom card claims no prerequisite edges');
  // Built-in slugs never take a custom row's place, and hidden rows still reach the owner's editor.
  assert.equal(levels.ALL_PLACEMENTS.some((p) => p.slug === 'sql-interview-sprint'), false);
  assert.equal(owner.visibleOwnerCards(owner.ownerCourseCards([row({ hidden: true })])).length, 0);
});

test('owner courses: a new card lands at the end of its level', () => {
  const cards = owner.ownerCourseCards([
    row({ slug: 'one', level: 'advanced', order: 3 }),
    row({ slug: 'two', level: 'advanced', order: 7 }),
  ]);
  assert.equal(owner.nextOwnerOrder(cards, 'advanced'), 8);
  assert.equal(owner.nextOwnerOrder(cards, 'beginner'), 1);
});

test('owner courses: every picker option exists in the app (no dead logo or tone)', () => {
  for (const logo of owner.OWNER_LOGO_KEYS) {
    assert.ok(fs.existsSync(path.join(ROOT, `src/assets/logos/${logo}.svg`)), `${logo} logo is bundled`);
  }
  const css = read('src/styles.css');
  for (const tone of owner.OWNER_TONES) {
    assert.match(css, new RegExp(`\\.tone-${tone}\\b`), `.tone-${tone} is defined in styles.css`);
  }
  assert.deepEqual(
    owner.OWNER_LEVELS.map((l) => l.id),
    levels.COURSE_LEVELS.map((l) => l.id),
    'the level picker is the journey registry, not a second copy',
  );
});

test('owner courses: the table is admin-writable and public-readable, with a soft delete', () => {
  const sql = read('prisma/migrations/20261106130000_owner_courses/migration.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.owner_course/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FOR SELECT\s+USING \(true\)/, 'learners may read the cards');
  assert.match(sql, /brocode_role', ''\) = 'admin'\)/, 'only an admin JWT may write');
  assert.match(sql, /deleted_at\s+timestamptz/, 'archive is a timestamp, not a delete');
  assert.match(sql, /href NOT LIKE '\/\/%'/, 'the database refuses protocol-relative links too');
  // The page and the studio must both exist and be wired, or this is dead code.
  assert.match(read('src/core/data/owner-courses.ts'), /from\('owner_course'\)/);
  assert.match(read('src/features/auth/AdminUsersPage.tsx'), /<OwnerCourseStudio \/>/);
  assert.match(read('src/features/courses/CoursesHome.tsx'), /renderOwnerCard/);
});
