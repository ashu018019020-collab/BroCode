/**
 * The learning architecture: six levels over the real published catalog.
 *
 * A catalog is not a curriculum. The order the generator emits is an authoring order, so this pins
 * the journey the Courses page renders: every published course placed exactly once, the expected
 * pedagogical sequence, non-empty levels, display-only prerequisites that reference real courses,
 * and an unknown course that stays visible instead of disappearing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const levels = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/course-levels.ts')).href);
const index = readJSON('public/generated/courses/index.json');
const published = index.courses.map((c) => c.slug);

test('levels: every published course is placed exactly once', () => {
  assert.equal(published.length, 11, 'the catalog still publishes eleven courses');
  const placed = levels.COURSE_PLACEMENTS.map((p) => p.slug);
  assert.deepEqual([...placed].sort(), [...published].sort(), 'placements mirror the catalog exactly');
  assert.equal(new Set(placed).size, placed.length, 'no course is placed twice');
});

test('levels: the journey order is the pedagogical sequence, not the catalog order', () => {
  assert.deepEqual(levels.COURSE_PLACEMENTS.map((p) => p.slug), [
    'ai-career-foundations', 'python',
    'statistics-data-analysis', 'numpy-pandas', 'sql',
    'data-engineering', 'ml-nlp',
    'generative-ai', 'agentic-ai',
    'build-production',
    'interview-career',
  ]);
  assert.deepEqual(levels.COURSE_LEVELS.map((l) => l.no), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(levels.COURSE_LEVELS.map((l) => l.title), [
    'Beginner', 'Core Foundations', 'Intermediate', 'Advanced AI', 'Professional', 'Career Ready',
  ]);
});

test('levels: the C course is optional, real, and never on the critical path', () => {
  assert.equal(levels.C_COMPLEMENT.optional, true);
  assert.equal(levels.C_COMPLEMENT.slug, 'c-programming');
  assert.equal(levels.placementOf('c-programming').level, 'foundations');
  assert.equal(levels.COURSE_PLACEMENTS.some((p) => p.slug === 'c-programming'), false,
    'the catalog has no c-programming record, so it is not invented as one');
});

test('levels: grouping is by level then explicit order, and unknown courses stay visible', () => {
  const cards = published.map((slug) => ({ slug }));
  const groups = levels.groupByLevel(cards);
  assert.equal(groups.length, 6);
  assert.deepEqual(groups.map((g) => g.level.id), levels.COURSE_LEVELS.map((l) => l.id));
  for (const group of groups) assert.ok(group.cards.length > 0, `${group.level.id} has no course`);
  const flat = groups.flatMap((g) => g.cards.map((c) => c.slug));
  assert.equal(flat.length, published.length, 'nothing is dropped and nothing is duplicated');

  // Sorting is explicit order, never alphabetical: python precedes statistics.
  assert.ok(flat.indexOf('python') < flat.indexOf('statistics-data-analysis'));
  assert.deepEqual(levels.sortByCourseOrder([{ slug: 'sql' }, { slug: 'python' }]).map((c) => c.slug),
    ['python', 'sql']);

  // A course added to the pack before it is placed here still renders, at the end.
  const withUnknown = levels.groupByLevel([...cards, { slug: 'unplaced-course' }]);
  assert.equal(withUnknown.at(-1).cards.at(-1).slug, 'unplaced-course');
  assert.equal(levels.placementOf('unplaced-course'), null);
});

test('levels: prerequisites are display-only and name real courses', () => {
  const names = Object.fromEntries(published.map((slug) => [slug, slug]));
  for (const placement of [...levels.COURSE_PLACEMENTS, levels.C_COMPLEMENT]) {
    for (const pre of placement.prerequisites) {
      assert.ok(levels.placementOf(pre), `${placement.slug} lists ${pre}, which is not placed`);
      assert.ok(!placement.optional || pre !== placement.slug);
    }
    assert.deepEqual(levels.prerequisiteNames(placement.slug, names), placement.prerequisites.map((p) => names[p]));
  }
  assert.deepEqual(levels.prerequisiteNames('generative-ai', names), ['ml-nlp']);
  assert.deepEqual(levels.prerequisiteNames('agentic-ai', names), ['generative-ai']);
  assert.deepEqual(levels.prerequisiteNames('build-production', names), ['agentic-ai', 'data-engineering']);
});

test('levels: database overrides move a course and invalid rows are ignored', () => {
  const merged = levels.mergePlacements([{ slug: 'python', level: 'professional', order: 1 }]);
  assert.equal(levels.placementOf('python', merged).level, 'professional');
  const groups = levels.groupByLevel([{ slug: 'python' }, { slug: 'sql' }], merged);
  const professional = groups.find((g) => g.level.id === 'professional');
  assert.deepEqual(professional.cards.map((c) => c.slug), ['python']);

  // An unknown level, an unknown slug and a non-numeric order are ignored, never trusted.
  const bad = levels.mergePlacements([
    { slug: 'python', level: 'not-a-level', order: 1 },
    { slug: 'not-a-course', level: 'beginner', order: 1 },
    { slug: 'sql', level: 'beginner', order: Number.NaN },
  ]);
  assert.equal(levels.placementOf('python', bad).level, 'beginner');
  assert.equal(levels.placementOf('sql', bad).level, 'foundations');
  assert.equal(levels.placementOf('not-a-course', bad), null);

  // The built-in journey is untouched by any merge call.
  assert.equal(levels.placementOf('python').level, 'beginner');
  assert.equal(levels.placementOf('c-programming').optional, true);
  assert.equal(levels.placementOf('python').hidden, undefined);
});

test('levels: a course can be stood down and restored without losing its place', () => {
  const hidden = levels.mergePlacements([
    { slug: 'sql', level: 'foundations', order: 4, hidden: true },
  ]);

  // Visibility is a filter over the journey, never a mutation of the registry.
  const cards = published.map((slug) => ({ slug }));
  const visible = levels.withoutHidden(cards, hidden);
  assert.equal(visible.length, cards.length - 1);
  assert.equal(visible.some((c) => c.slug === 'sql'), false);
  assert.equal(levels.withoutHidden(cards).length, cards.length, 'no overrides hides nothing');

  // A hidden course is skipped by "continue learning" even when it is unfinished.
  const pct = () => 0;
  const next = levels.nextCourse(cards, pct, hidden);
  assert.notEqual(next?.slug, 'sql');
  assert.equal(levels.nextCourse(cards, pct)?.slug, 'ai-career-foundations');

  // Restoring it returns the SAME placement, not a re-added one at the bottom.
  const restored = levels.mergePlacements([
    { slug: 'sql', level: 'foundations', order: 4, hidden: false },
  ]);
  assert.equal(levels.placementOf('sql', restored).hidden, false);
  assert.equal(levels.placementOf('sql', restored).level, 'foundations');
  assert.equal(levels.withoutHidden(cards, restored).length, cards.length);

  // A row for an unknown slug can never hide anything real.
  const badRow = levels.mergePlacements([{ slug: 'gone', level: 'beginner', order: 1, hidden: true }]);
  assert.equal(levels.withoutHidden(cards, badRow).length, cards.length);
});
