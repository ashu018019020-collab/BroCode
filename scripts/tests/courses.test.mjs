/**
 * The course index.
 *
 * Three taxonomies used to run side by side (29 sections, 36 steps, 8 tracks) with no course
 * concept. `content/courses/courses.json` is the authored answer; `scripts/courses.cjs` derives
 * the tagged index. Two things can silently rot:
 *
 *   · an item falls out of every course (the "unsorted" bucket fills up) — its practice becomes
 *     unreachable from the course that owns the step;
 *   · the published `public/generated/courses/` drifts from what the builder produces — every page
 *     then shows a count that no longer matches its data.
 *
 * So the mapping is asserted against the real sources AND the published files are asserted
 * byte-for-byte against a fresh build. Zero dependencies — node:test, `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const { build } = require(path.join(ROOT, 'scripts', 'courses.cjs'));

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const source = readJson('content/courses/courses.json');
const roadmap = await import(new URL('../../src/core/learning/roadmap.ts', import.meta.url).href);
const built = await build();

test('courses: the 11 courses partition the 36 roadmap steps exactly once', () => {
  assert.equal(source.courses.length, 11);
  assert.equal(roadmap.STEP_COUNT, 36);

  const slugs = source.courses.map((course) => course.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate course slug');

  const owners = new Map();
  for (const course of source.courses) {
    assert.ok(course.steps.length > 0, `${course.slug} has no steps`);
    for (const step of course.steps) {
      assert.ok(!owners.has(step), `step ${step} is in both ${owners.get(step)} and ${course.slug}`);
      owners.set(step, course.slug);
    }
  }
  assert.deepEqual([...owners.keys()].sort((a, b) => a - b), Array.from({ length: 36 }, (_, i) => i + 1));
});

test('courses: every section is mapped once, into a step that belongs to its own course', () => {
  const sections = readJson('public/generated/curriculum/sections.json');
  const mapped = new Map();
  for (const course of source.courses) {
    for (const [sectionId, step] of Object.entries(course.sections ?? {})) {
      assert.ok(!mapped.has(sectionId), `section ${sectionId} is mapped twice`);
      assert.ok(course.steps.includes(step), `${sectionId} maps to step ${step}, not a step of ${course.slug}`);
      mapped.set(sectionId, { slug: course.slug, step });
    }
  }
  assert.deepEqual(
    [...mapped.keys()].sort(),
    sections.map((section) => section.id).sort(),
    'every generated section must be mapped exactly once',
  );
});

test('courses: every source item is tagged, and nothing falls into unsorted', () => {
  assert.deepEqual(built.stats.problems, []);
  assert.deepEqual(built.stats.unsorted, []);

  const questions = readJson('public/generated/questions/manifest.json');
  const playbook = readJson('public/generated/playbook/items.json');
  const notebooks = readJson('public/notebooks/manifest.json');
  const sections = readJson('public/generated/curriculum/sections.json');
  const extras = readJson('public/generated/curriculum/extras.json');
  const tracks = readJson('public/generated/tracks/index.json');
  const interviewQuestions = [
    ...extras.mockInterview.flatMap((round) => round.questions ?? []),
    ...extras.intensive,
  ];
  assert.deepEqual(
    [...new Set(interviewQuestions.map((question) => question.cat))].sort(),
    Object.keys(readJson('content/courses/courses.json').interviewTopics).sort(),
    'every interview category has one authored curriculum destination',
  );
  const uniqueInterviewContent = new Set(interviewQuestions.map((question) => [
    String(question.q ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en'),
    String(question.a ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en'),
  ].join('\u0000')));

  const expected = {
    steps: roadmap.STEP_COUNT,
    sections: sections.length,
    tracks: tracks.length,
    playbook: playbook.items.length,
    questions: questions.sections.reduce((sum, section) => sum + section.published, 0),
    notebooks: notebooks.notebooks.length,
    projects: sections.reduce((sum, section) => sum + (section.projectLab?.length ?? 0), 0),
    interviewPrep: uniqueInterviewContent.size,
  };
  assert.deepEqual(built.stats.families, expected);
  assert.equal(built.stats.interviewPrepReferences.count, interviewQuestions.length);

  const total = Object.values(expected).reduce((sum, count) => sum + count, 0);
  assert.equal(built.index.totals.items, total);
  assert.equal(built.index.courses.length, 11);
  assert.equal(
    built.index.courses.reduce((sum, course) => sum + course.counts.total, 0),
    total,
    'course counts must add up to the source total',
  );
});

test('courses: repeated interview prompts share one course item without losing source refs', () => {
  const plan = readJson('content/courses/courses.json');
  const extras = readJson('public/generated/curriculum/extras.json');
  const sourceRefs = [
    ...extras.mockInterview.flatMap((round, roundIndex) => (round.questions ?? []).map((_, questionIndex) =>
      `mock:mock:${round.round ?? roundIndex + 1}:${questionIndex}`)),
    ...extras.intensive.map((_, index) => `intensive:intensive:${index}`),
  ].sort();
  const interviewItems = [...built.files.values()].flatMap((body) => body.items)
    .filter((item) => item.ref.kind === 'mock' || item.ref.kind === 'intensive');
  const indexedRefs = interviewItems.flatMap((item) => [
    `${item.ref.kind}:${item.ref.id}`,
    ...(item.related_refs ?? []).map((ref) => `${ref.kind}:${ref.id}`),
  ]).sort();
  assert.deepEqual(indexedRefs, sourceRefs, 'every existing attempt key remains addressable exactly once');
  assert.equal(interviewItems.length, built.stats.families.interviewPrep, 'one canonical row per unique prompt');

  const byRef = new Map();
  for (const item of interviewItems) {
    for (const ref of [item.ref, ...(item.related_refs ?? [])]) byRef.set(`${ref.kind}:${ref.id}`, item);
    assert.ok(item.title, `${item.ref.id} keeps one display title`);
    assert.ok(!item.related_refs?.some((ref) => ref.kind === item.ref.kind && ref.id === item.ref.id));
  }
  for (const [roundIndex, round] of extras.mockInterview.entries()) {
    for (const [questionIndex, question] of (round.questions ?? []).entries()) {
      const ref = `mock:mock:${round.round ?? roundIndex + 1}:${questionIndex}`;
      const item = byRef.get(ref);
      const expectedStep = plan.interviewTopics[question.cat];
      assert.ok(item, `missing interview prompt ref ${ref}`);
      assert.ok(
        item.chapter === expectedStep || item.related_chapters?.includes(expectedStep),
        `${ref} category ${question.cat} must be related to step ${expectedStep}`,
      );
    }
  }
  for (const [index, question] of extras.intensive.entries()) {
    const item = byRef.get(`intensive:intensive:${index}`);
    const expectedStep = plan.interviewTopics[question.cat];
    assert.ok(item, `missing intensive prompt ref intensive:${index}`);
    assert.ok(item.chapter === expectedStep || item.related_chapters?.includes(expectedStep));
  }
});

test('courses: every tagged row carries a course, chapter, type and ref', () => {
  for (const [file, body] of built.files) {
    const slug = file.replace(/\.json$/, '');
    assert.equal(body.slug, slug);
    for (const item of body.items) {
      assert.equal(item.course, slug);
      assert.ok(Number.isInteger(item.chapter) && item.chapter >= 1 && item.chapter <= 36, `${item.id}: bad chapter`);
      assert.ok(item.ref?.kind && item.ref?.id, `${item.id}: bad ref`);
      assert.match(item.id, /^[a-z0-9-]+-\d{2}-[a-z]+-\d{4,}$/);
      for (const step of item.related_chapters ?? []) {
        assert.ok(Number.isInteger(step) && step >= 1 && step <= 36, `${item.id}: bad related chapter ${step}`);
      }
    }
  }
});

test('courses: the published index and course files match a fresh build byte for byte', () => {
  const out = 'public/generated/courses';
  assert.equal(readText(`${out}/index.json`), JSON.stringify(built.index));

  const onDisk = fs.readdirSync(path.join(ROOT, out)).filter((name) => name.endsWith('.json')).sort();
  const expectedFiles = ['index.json', ...[...built.files.keys()]].sort();
  assert.deepEqual(onDisk, expectedFiles, 'stale or missing course files — run npm run courses:write');

  for (const [name, body] of built.files) {
    assert.equal(readText(`${out}/${name}`), JSON.stringify(body), `${name} drifted from the builder`);
  }
});
