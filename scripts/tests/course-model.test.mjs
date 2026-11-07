/**
 * The course spine: Level → Chapter → Module → Lesson, plus the metadata that makes a course
 * followable.
 *
 * Two failure modes matter here, and neither throws:
 *
 *   · the metadata is PRESENT but WRONG — a prerequisite that names a later course (a plan nobody
 *     can follow), a `minutes: 0` that nobody measured, an objective that is really a label;
 *   · the hierarchy DRIFTS from the items — a chapter that owns no module, an item that belongs to
 *     no module, or a spine that stops covering the 36-step plan exactly once.
 *
 * So this file reads the PUBLISHED course files (the ones the app fetches) and projects them with
 * the real `courseSpine()`. Both halves are pure, so no browser or store is involved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./_ts-resolve.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const { courseSpine, COURSE_LEVELS } = await import(
  pathToFileURL(path.join(ROOT, 'src/core/learning/courses.ts')).href
);
const { en } = await import(pathToFileURL(path.join(ROOT, 'src/app/i18n/locales.ts')).href);

const index = readJson('public/generated/courses/index.json');
const files = index.courses.map((card) => readJson(`public/generated/courses/${card.slug}.json`));

test('course model: every published course carries metadata a learner can act on', () => {
  assert.equal(index.courses.length, 11);
  const bySlug = new Map(index.courses.map((course) => [course.slug, course]));

  for (const course of index.courses) {
    const meta = course.meta;
    assert.ok(meta, `${course.slug}: metadata is published with the card`);
    assert.ok(COURSE_LEVELS.includes(meta.level), `${course.slug}: ${meta.level} is not a level`);

    assert.ok(meta.objectives.length >= 2, `${course.slug}: needs at least 2 objectives`);
    for (const objective of meta.objectives) {
      assert.ok(objective.trim().length > 10, `${course.slug}: objective "${objective}" is a placeholder`);
    }
    assert.ok(Number.isInteger(meta.minutes) && meta.minutes > 0, `${course.slug}: minutes must be measured`);
    assert.ok(meta.assessment.trim().length > 0, `${course.slug}: assessment is required`);

    assert.ok(!meta.prerequisites.includes(course.slug), `${course.slug}: cannot require itself`);
    for (const prerequisite of meta.prerequisites) {
      const earlier = bySlug.get(prerequisite);
      assert.ok(earlier, `${course.slug}: prerequisite ${prerequisite} is not a course`);
      assert.ok(earlier.number < course.number, `${course.slug}: prerequisite ${prerequisite} comes later in the plan`);
    }
  }
});

test('course model: the spine is the 36-step plan exactly once, with no item left out', () => {
  const steps = [];
  const levels = {};
  let lessons = 0;

  for (const file of files) {
    const spine = courseSpine(file);
    assert.equal(spine.slug, file.slug);
    assert.equal(spine.level, file.meta.level, `${file.slug}: the spine reads the course's own level`);
    assert.ok(spine.chapters.length > 0, `${file.slug}: a course with no chapter is not a course`);

    const published = spine.chapters.reduce(
      (sum, chapter) => sum + chapter.modules.reduce((count, module) => count + module.counts.total, 0),
      0,
    );
    assert.equal(published, file.items.length, `${file.slug}: every item belongs to exactly one chapter and module`);

    for (const chapter of spine.chapters) {
      steps.push(chapter.step);
      assert.ok(file.steps.includes(chapter.step), `${file.slug}: chapter ${chapter.step} is not a step of this course`);
      assert.ok(chapter.modules.length > 0, `${file.slug}: chapter ${chapter.step} owns no module`);

      const chapterItems = file.items.filter((item) => item.chapter === chapter.step).length;
      assert.equal(
        chapter.modules.reduce((count, module) => count + module.counts.total, 0),
        chapterItems,
        `${file.slug}: chapter ${chapter.step} loses or duplicates an item`,
      );

      // The chapter's overview module leads, then sections by id — the order the page reads in.
      const firstSection = chapter.modules.findIndex((module) => module.sectionId !== null);
      if (firstSection > 0) {
        assert.ok(
          chapter.modules.slice(0, firstSection).every((module) => module.sectionId === null),
          `${file.slug}: the chapter overview module must come first`,
        );
      }
      for (const module of chapter.modules) {
        for (const lesson of module.lessons) {
          assert.ok(lesson.id && lesson.title, `${file.slug}: a lesson without an id or title is not addressable`);
          lessons += 1;
        }
      }
    }

    levels[spine.level] = (levels[spine.level] ?? 0) + 1;
  }

  assert.deepEqual(
    [...steps].sort((a, b) => a - b),
    Array.from({ length: 36 }, (_, i) => i + 1),
    'the spine IS the 36-step plan, once per step',
  );

  const lessonItems = files.reduce(
    (sum, file) => sum + file.items.filter((item) => item.type === 'lesson').length,
    0,
  );
  assert.equal(lessons, lessonItems, 'every lesson item appears once in the spine — none dropped, none doubled');
  assert.equal(Object.values(levels).reduce((sum, count) => sum + count, 0), 11, 'every course has a level');
});

test('course model: the metadata reaches the screens, and every level has a label', () => {
  const home = fs.readFileSync(path.join(ROOT, 'src/features/courses/CoursesHome.tsx'), 'utf8');
  const page = fs.readFileSync(path.join(ROOT, 'src/features/courses/CoursePage.tsx'), 'utf8');

  // The card answers "is this my level, how long, what should I know first?".
  assert.match(home, /card\.meta\.level/, 'the card shows the level');
  assert.match(home, /card\.meta\.minutes/, 'the card shows the estimated time');
  assert.match(home, /card\.meta\.prerequisites/, 'the card shows the prerequisites');
  // The course page header answers the same three questions the card does, from the same authored
  // `meta` — level, whole-course estimate, prerequisites (by name).
  assert.match(page, /course\.meta\.level/, 'the course page header shows the level');
  assert.match(page, /course\.meta\.minutes/, 'the course page header shows the estimated time');
  assert.match(page, /course\.meta\.prerequisites/, 'the course page header shows the prerequisites');
  // …and the course page answers "what will I be able to do?".
  assert.match(page, /course\.meta\.objectives\.map/, 'the course page lists the objectives');
  // One helper formats the estimate for both surfaces, so the card and the header cannot drift.
  assert.match(home, /courseHours\(card\.meta\.minutes\)/, 'the card uses the shared hour helper');
  assert.match(page, /courseHours\(course\.meta\.minutes\)/, 'the course page uses the same helper');

  for (const level of COURSE_LEVELS) {
    assert.ok(en[`courses.level.${level}`], `${level} needs a label in the English pack`);
  }
  assert.ok(en['courses.needs'], 'the prerequisite clause needs a label');
  assert.ok(en['courses.objectives'], 'the objectives block needs a heading');
});
