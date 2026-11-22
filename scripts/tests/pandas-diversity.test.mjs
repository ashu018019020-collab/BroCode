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

test('pandas diversity: rejects bare filler titles but keeps meaningful titles', () => {
  const generic = validateTaskDiversity([
    task('Task 1', 'Print the first row.', 'df.head(1)'),
    task('Pandas Exercise #2 (P99)', 'Print the last row.', 'df.tail(1)'),
    task('Warm up', 'Print the first two rows.', 'df.head(2)'),
  ], 'p99');
  assert.equal(generic.filter((p) => p.includes('generic title')).length, 3);

  const meaningful = validateTaskDiversity([
    task('Practice with groupby', 'Print the size of each group.', 'df.groupby("a").size()'),
    task('Project sales report', 'Print total sales.', 'df["sales"].sum()'),
  ], 'p99');
  assert.deepEqual(meaningful, []);
});

test('pandas diversity: rejects a repeated solution', () => {
  const problems = validateTaskDiversity([
    task('First rows', 'Print the first two rows.', 'df.head(2)'),
    task('Top rows', 'Print the first three rows.', 'df.head(2)'),
  ], 'p99');

  assert.ok(problems.some((p) => p.includes('p99') && p.includes('repeats the solution')));
});

test('pandas diversity: keeps code case-sensitive so different columns are not duplicates', () => {
  const problems = validateTaskDiversity([
    task('Uppercase column', 'Sum the Sales column.', 'df["Sales"].sum()'),
    task('Lowercase column', 'Print the total from the sales column.', 'df["sales"].sum()'),
  ], 'p99');

  assert.deepEqual(problems, []);
});

test('pandas diversity: accepts distinct tasks', () => {
  const problems = validateTaskDiversity([
    task('Count the rows', 'Print the number of rows in the frame.', 'df.shape[0]'),
    task('Select column b', 'Print column "b" as a list.', 'df["b"].tolist()'),
    task('Filter large values', 'Print rows where column "a" is greater than 1.', 'df[df["a"] > 1]'),
  ], 'p99');

  assert.deepEqual(problems, []);
});

test('pandas diversity: keeps the hard gate per module so cross-module warm-ups pass', () => {
  const warmup = [
    task('First rows', 'Print the first two rows.', 'df.head(2)'),
    task('Column names', 'Print the column names.', 'df.columns.tolist()'),
  ];

  assert.deepEqual(validateTaskDiversity(warmup, 'p01'), []);
  assert.deepEqual(validateTaskDiversity(warmup, 'p02'), []);
});
