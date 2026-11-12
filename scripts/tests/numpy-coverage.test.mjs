/**
 * Curriculum coverage against Part 3 of the brief.
 *
 * The brief lists 18 module areas. This test does not claim the course teaches every sub-topic of
 * those areas — it checks the weaker, true thing: every area has a module whose authored title or
 * Learn topics name it, so no area of the brief is silently absent from the pack. New areas must be
 * added here deliberately, and removing a module's coverage fails the suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/generated/numpy-course/index.json'), 'utf8'));

/** One entry per brief module: the words any matching module title or Learn title must contain. */
const BRIEF_AREAS = [
  ['01 fundamentals', ['fundamental', 'ndarray']],
  ['02 creation and attributes', ['creation']],
  ['03 data types', ['data types']],
  ['04 indexing and slicing', ['indexing']],
  ['05 boolean masking', ['boolean indexing']],
  ['06 math and ufuncs', ['universal functions', 'ufunc']],
  ['07 broadcasting', ['broadcast']],
  ['08 reshaping', ['reshaping']],
  ['09 aggregation and statistics', ['aggregation']],
  ['10 random numbers', ['random']],
  ['11 missing values', ['masked', 'robustness']],
  ['12 sorting, searching, sets', ['sorting']],
  ['13 linear algebra', ['linear algebra']],
  ['14 file input and output', ['file input']],
  ['15 performance and memory', ['performance', 'memory']],
  ['16 advanced toolbox', ['advanced', 'special arrays']],
  ['17 real-world projects', ['real-world', 'ecosystem']],
  ['18 interview and mastery', ['interview']],
];

const haystack = artifact.modules.map((m) => ({
  module: m.title.toLowerCase(),
  topics: m.sections.learn.map((e) => (e.title || '').toLowerCase()),
  // Some brief areas are served by a SECTION rather than a Learn topic — 18 (interview and mastery)
  // is the Interview/Defense/Checkpoint ladder that every module carries.
  sections: Object.keys(m.sections).map((k) => k.toLowerCase()),
}));

test('every brief area is represented in the pack', () => {
  const missing = [];
  for (const [area, words] of BRIEF_AREAS) {
    const found = haystack.some(({ module, topics, sections }) =>
      words.some((w) => module.includes(w) || sections.some((s) => s.includes(w)) || topics.some((t) => t.includes(w))));
    if (!found) missing.push(area);
  }
  assert.deepEqual(missing, [], `brief areas with no matching content: ${missing.join(', ')}`);
});

test('the pack has 20 modules with ten sections each, and every Learn entry teaches something', () => {
  assert.equal(artifact.modules.length, 20);
  for (const m of artifact.modules) {
    assert.equal(Object.keys(m.sections).length, 10, `${m.id} does not hold ten sections`);
    assert.ok(m.sections.learn.length >= 14, `${m.id} has only ${m.sections.learn.length} Learn topics`);
    for (const e of m.sections.learn) {
      assert.ok(e.title && e.title.trim(), `${e.id} has no title`);
      assert.ok(e.body && e.body.trim().length > 30, `${e.id} has no explanation`);
      assert.ok(e.code && e.code.trim(), `${e.id} has no runnable code`);
      assert.ok(e.output && e.output.trim(), `${e.id} has no verified output`);
    }
  }
});

test('learn topics are unique across the whole course', () => {
  const seen = new Map();
  for (const m of artifact.modules) {
    for (const e of m.sections.learn) seen.set(e.title, (seen.get(e.title) || 0) + 1);
  }
  const dupes = [...seen].filter(([, n]) => n > 1);
  assert.deepEqual(dupes, [], `duplicate Learn topics: ${dupes.map(([t]) => t).join(', ')}`);
});
