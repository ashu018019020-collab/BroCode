import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateTaskFixtures } = require('../lib/pandas-fixture.cjs');

const setup = 'import pandas as pd';
const fixture = 'df = pd.DataFrame({"a": [1, 2]})';
const starter = `${setup}\n${fixture}\n\n# write the result the task asks for and print it\n`;

const task = (overrides = {}) => ({
  title: 'Print column a',
  statement: 'Print the values of column a as a list.',
  setup,
  fixture,
  starter,
  solution: `import pandas as pd
df = pd.DataFrame({"a": [1, 2]})
print(df["a"].tolist())`,
  expected: '[1, 2]',
  ...overrides,
});

const moduleWith = (tasks) => ({ id: 'p01', tasks });

const runFrom = (byKey = {}) => (samples) => new Map(samples.map((sample) => [
  sample.key,
  byKey[sample.key] || { state: 'ok', stdout: '[1, 2]' },
]));

test('pandas fixture: accepts a starter whose fixture starts the solution', () => {
  const problems = validateTaskFixtures([moduleWith([task()])], { runSolutions: runFrom() });
  assert.deepEqual(problems, []);
});

test('pandas fixture: rejects a task whose fixture holds no data', () => {
  const problems = validateTaskFixtures(
    [moduleWith([task({ fixture: '', starter: 'import pandas as pd\n\n# print the values\n' })])],
    { runSolutions: runFrom() },
  );

  assert.ok(problems.some((problem) => problem.includes('has no fixture')));
});

test('pandas fixture: rejects a task with no explicit setup', () => {
  const problems = validateTaskFixtures(
    [moduleWith([task({ setup: '' })])],
    { runSolutions: runFrom() },
  );

  assert.ok(problems.some((problem) => problem.includes('has no setup')));
});

test('pandas fixture: rejects a starter that does not combine setup and fixture', () => {
  const problems = validateTaskFixtures(
    [moduleWith([task({ starter: `${setup}\n\n# write it\n` })])],
    { runSolutions: runFrom() },
  );

  assert.ok(problems.some((problem) => problem.includes('starter is not setup + fixture')));
});

test('pandas fixture: rejects a solution that rebuilds a different table', () => {
  const problems = validateTaskFixtures(
    [moduleWith([task({
      solution: `import pandas as pd
df = pd.DataFrame({"a": [9, 9]})
print(df["a"].tolist())`,
      expected: '[9, 9]',
    })])],
    { runSolutions: runFrom({ 'p01:0': { state: 'ok', stdout: '[9, 9]' } }) },
  );

  assert.ok(problems.some((problem) => problem.includes('does not start from the setup + fixture')));
});

test('pandas fixture: rejects a solution that does not print the stored output', () => {
  const problems = validateTaskFixtures(
    [moduleWith([task()])],
    { runSolutions: runFrom({ 'p01:0': { state: 'ok', stdout: '[2, 1]' } }) },
  );

  assert.ok(problems.some((problem) => problem.includes('not the stored expected')));
});

test('pandas fixture: rejects a solution that raises', () => {
  const problems = validateTaskFixtures(
    [moduleWith([task()])],
    { runSolutions: runFrom({ 'p01:0': { state: 'raised', error: "KeyError: 'a'" } }) },
  );

  assert.ok(problems.some((problem) => problem.includes("raised: KeyError: 'a'")));
});

test('pandas fixture: rejects a task with no expected output', () => {
  const problems = validateTaskFixtures(
    [moduleWith([task({ expected: '' })])],
    { execute: false },
  );

  assert.ok(problems.some((problem) => problem.includes('no expected output')));
});

test('pandas fixture: reports execution failures instead of silently passing', () => {
  const problems = validateTaskFixtures(
    [moduleWith([task()])],
    { runSolutions: () => { throw new Error('python3 is unavailable'); } },
  );

  assert.ok(problems.some((problem) => problem.includes('task execution failed')));
});
