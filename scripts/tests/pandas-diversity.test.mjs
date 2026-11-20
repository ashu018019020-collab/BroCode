import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateTaskDiversity } = require('../lib/pandas-diversity.cjs');

const task = (title, statement, solution) => ({ title, statement, solution, expected: 'output' });

test('pandas diversity: rejects identical statements after normalization', () => {
  const problems = validateTaskDiversity([
    task('Count the rows', 'Print the number of rows in the frame.', 'df.shape[0]'),
    task('Frame length', '  print   the number of ROWS in the frame! ', 'len(df)'),
  ], 'p99');

  assert.ok(problems.some((p) => p.includes('p99') && p.includes('repeats the statement')));
});

test('pandas diversity: rejects placeholder task titles', () => {
  const problems = validateTaskDiversity([
    task('Task 1', 'Print the first row of the frame.', 'df.head(1)'),
    task('Pandas Exercise #2 (P99)', 'Print the last row of the frame.', 'df.tail(1)'),
  ], 'p99');

  assert.equal(problems.filter((p) => p.includes('generic title')).length, 2);
});

test('pandas diversity: rejects a module with only a handful of distinct solutions', () => {
  const problems = validateTaskDiversity([
    task('First rows', 'Print the first two rows.', 'df.head(2)'),
    task('Top rows', 'Print the first three rows.', 'df.head(2)'),
    task('Head rows', 'Print the first four rows.', 'df.head(2)'),
    task('Opening rows', 'Print the first five rows.', 'df.head(2)'),
  ], 'p99');

  assert.ok(problems.some((p) => p.includes('only 1 distinct solution') && p.includes('need 2')));
});

test('pandas diversity: accepts distinct tasks and one repeated statement across modules', () => {
  const problems = validateTaskDiversity([
    task('Count the rows', 'Print the number of rows in the frame.', 'df.shape[0]'),
    task('Select column b', 'Print column "b" as a list.', 'df["b"].tolist()'),
    task('Filter large values', 'Print rows where column "a" is greater than 1.', 'df[df["a"] > 1]'),
  ], 'p99');

  assert.deepEqual(problems, []);
});
