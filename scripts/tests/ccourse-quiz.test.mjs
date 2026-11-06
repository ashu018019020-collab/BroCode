/**
 * The practice hub's per-module C progress is only worth showing if the count means something:
 * one module's answered questions, never another module's, never the Python bank's, and never more
 * than the module actually has.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
register('./_ts-resolve.mjs', import.meta.url);

const { cQuizTally } = await load('src/core/learning/ccourse.ts');

test('the C quiz tally counts one module family and caps at the set size', () => {
  const attempts = {
    'cquiz:m01:0': { done: true },
    'cquiz:m01:1': { done: false },
    'cquiz:m01:9': { done: true }, // stale record for a question the set no longer has
    'cquiz:m02:0': { done: true }, // another module
    'qb:s01:coding:1': { done: true }, // the Python bank
  };
  assert.deepEqual(cQuizTally(attempts, 'm01', 12), { answered: 3, correct: 2, total: 12, pct: 25 });
  assert.deepEqual(cQuizTally(attempts, 'm01', 2), { answered: 2, correct: 2, total: 2, pct: 100 });
  assert.deepEqual(cQuizTally(attempts, 'm03', 5), { answered: 0, correct: 0, total: 5, pct: 0 });
  assert.deepEqual(cQuizTally({}, 'm01', 0), { answered: 0, correct: 0, total: 0, pct: null });
});
