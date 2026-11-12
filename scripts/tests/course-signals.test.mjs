/**
 * Course XP and achievement signals.
 *
 * The C, Java and NumPy courses store their own attempt families. These tests pin the one module that
 * counts them, the one-time XP rule, and the badge definitions — so a badge cannot be earned by
 * opening a page, and a second click cannot pay again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register('./_ts-resolve.mjs', import.meta.url);

const signals = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/course-signals.ts')).href);
const ach = await import(pathToFileURL(path.join(ROOT, 'src/core/platform/achievements.ts')).href);
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const NUMPY_SECTIONS = ['learn', 'interview', 'coding', 'logic', 'debug', 'practice', 'miniProject', 'projectLab', 'defense', 'checkpoint'];

function numpyModule(id, sections = NUMPY_SECTIONS) {
  return Object.fromEntries(sections.map((section) => [`nmod:${id}:${section}`, { done: true }]));
}

test('a NumPy module counts only when all ten sections are recorded', () => {
  const nine = numpyModule('n01', NUMPY_SECTIONS.slice(0, 9));
  assert.deepEqual(signals.numpyCompletedModules(nine), []);
  const full = { ...nine, 'nmod:n01:checkpoint': { done: true } };
  assert.deepEqual(signals.numpyCompletedModules(full), ['n01']);
  // A malformed key is ignored, and an answered draft must not complete a section on its own.
  assert.deepEqual(signals.numpyCompletedModules({ 'nmod:n02:learn:extra': { done: true } }), []);
  assert.deepEqual(signals.numpyCompletedModules({ 'nans:x': { answer: 'draft' } }), []);
});

test('C and Java checkpoints are matched exactly, not by assessment suffixes', () => {
  const attempts = {
    'ccourse:m1:checkpoint': { done: true },
    'ccourse:m1:test': { done: true },
    'ccourse:m1:checkpoint:assessment': { done: true },
    'jcourse:m2:checkpoint': { done: true },
    'jcourse:m2:checkpoint:assessment': { done: true },
  };
  const s = signals.courseSignals(attempts);
  assert.equal(s.cModules, 1, 'only the module checkpoint counts, not the test or the assessment');
  assert.equal(s.javaModules, 1);
  assert.equal(s.modules, 2);
  assert.equal(s.allThree, false, 'NumPy is still missing');
});

test('courseSignals connects all three courses', () => {
  const attempts = {
    ...numpyModule('n01'),
    'ccourse:m1:checkpoint': { done: true },
    'jcourse:m2:checkpoint': { done: true },
  };
  const s = signals.courseSignals(attempts);
  assert.equal(s.numpySections, 10);
  assert.equal(s.numpyModules, 1);
  assert.equal(s.modules, 3);
  assert.equal(s.allThree, true);
});

test('completion XP is paid once, and the NumPy module bonus only on the tenth section', () => {
  assert.equal(signals.completionAward('numpy', true), 0, 'a recorded section pays nothing again');
  assert.equal(signals.completionAward('numpy', false), 12);
  assert.equal(signals.completionAward('numpy', false, true), 32);
  assert.equal(signals.completionAward('c', false), 30);
  assert.equal(signals.completionAward('java', true), 0);
});

test('the course badges derive from those counts and stay unearned at zero', () => {
  const byId = Object.fromEntries(ach.ACHIEVEMENTS.map((badge) => [badge.id, badge]));
  for (const id of ['numpy-first', 'course-first', 'course-ten', 'numpy-twenty', 'course-trio']) {
    assert.ok(byId[id], `${id} must be in the ONE achievements list`);
  }
  const ctx = { numpySections: 0, courseModules: 0, numpyModules: 0, courseTrio: 0 };
  assert.deepEqual(byId['numpy-first'].progress(ctx), { got: 0, need: 1 });
  assert.deepEqual(byId['course-ten'].progress({ ...ctx, courseModules: 4 }), { got: 4, need: 10 });
  assert.deepEqual(byId['numpy-twenty'].progress({ ...ctx, numpyModules: 20 }), { got: 20, need: 20 });
  assert.deepEqual(byId['course-trio'].progress({ ...ctx, courseTrio: 1 }), { got: 1, need: 1 });
  assert.deepEqual(byId['numpy-twenty'].progress({ ...ctx, numpyModules: 25 }), { got: 20, need: 20 },
    'progress is clamped, never above the badge target');
});

test('every course page feeds the same XP, streak and achievement signals', () => {
  const numpy = read('src/features/numpy-mastery/NWorkspace.tsx');
  assert.match(numpy, /if \(done\) return;/, 'a recorded section cannot pay XP twice');
  assert.match(numpy, /completionAward\('numpy', false, recorded === N_SECTIONS\.length - 1\)/,
    'NumPy pays the section XP and the final-section bonus');
  assert.match(numpy, /addXp\(award, 'course'/, 'the award goes through the ONE XP path');
  assert.match(numpy, /bumpStreak\(\)/, 'recording a section feeds the streak');

  for (const file of ['src/features/c-programming/CLessonPage.tsx', 'src/features/java-programming/JLessonPage.tsx']) {
    const source = read(file);
    assert.match(source, /recordAttempt\(checkpointKey\(module\.id\), \{ done: true, score: 100 \}\);\s*addXp\(30\); bumpStreak\(\);/,
      `${file}: the module checkpoint pays once and feeds the streak`);
  }
});
