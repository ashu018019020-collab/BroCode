import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { analyzeSolutions, validateTaskAnswers } = require('../lib/pandas-answer.cjs');

const starter = `import pandas as pd\ndf = pd.DataFrame({"a": [1, 2]})\n\n# write the result the task asks for and print it\n`;

const task = (overrides = {}) => ({
  title: 'Running product',
  statement: 'Print the cumulative product of column a as a list.',
  starter,
  solution: `import pandas as pd\ndf = pd.DataFrame({"a": [1, 2]})\nprint(df["a"].cumprod().tolist())`,
  expected: '[1, 2]',
  requires: 'cumprod()',
  ...overrides,
});

const moduleWith = (tasks) => ({ id: 'p06', tasks });

const op = (overrides = {}) => ({
  name: 'cumprod', label: 'cumprod()', kind: 'method', tainted: true, source: 'answer', ...overrides,
});

const analysis = (overrides = {}) => ({
  answerOps: [op()],
  starterOps: [],
  printedTainted: true,
  printCount: 1,
  requires: 'cumprod()',
  requiresKind: 'method',
  requiresSource: 'answer',
  ...overrides,
});

const analyzeFrom = (result) => (samples) => new Map(
  samples.map((sample) => [sample.key, typeof result === 'function' ? result(sample) : result]),
);

test('pandas answer: accepts a data-dependent answer that uses its required operation', () => {
  const problems = validateTaskAnswers([moduleWith([task()])], { analyze: analyzeFrom(analysis()) });
  assert.deepEqual(problems, []);
});

test('pandas answer: rejects a constant print and names the missing operation', () => {
  const problems = validateTaskAnswers(
    [moduleWith([task()])],
    { analyze: analyzeFrom(analysis({ printedTainted: false })) },
  );

  assert.equal(problems.length, 1);
  assert.match(problems[0], /prints a constant/);
  assert.match(problems[0], /cumprod\(\)/);
});

test('pandas answer: rejects a task with no declared operation', () => {
  const problems = validateTaskAnswers(
    [moduleWith([task({ requires: undefined })])],
    { analyze: analyzeFrom(analysis()) },
  );

  assert.equal(problems.length, 1);
  assert.match(problems[0], /has no "requires"/);
});

test('pandas answer: rejects an answer that never uses the declared operation', () => {
  const problems = validateTaskAnswers(
    [moduleWith([task()])],
    { analyze: analyzeFrom(analysis({ answerOps: [op({ name: 'sum', label: 'sum()' })] })) },
  );

  assert.equal(problems.length, 1);
  assert.match(problems[0], /never uses its required pandas operation cumprod\(\)/);
});

test('pandas answer: rejects the operation applied to fresh literal data', () => {
  const problems = validateTaskAnswers(
    [moduleWith([task()])],
    { analyze: analyzeFrom(analysis({ answerOps: [op({ tainted: false })] })) },
  );

  assert.equal(problems.length, 1);
  assert.match(problems[0], /not the starter's fixture/);
  assert.match(problems[0], /cumprod\(\)/);
});

test('pandas answer: rejects a solution the AST cannot parse', () => {
  const problems = validateTaskAnswers(
    [moduleWith([task()])],
    { analyze: analyzeFrom({ error: 'SyntaxError: invalid syntax' }) },
  );

  assert.equal(problems.length, 1);
  assert.match(problems[0], /could not be parsed.*SyntaxError/);
});

test('pandas answer: reports an analyzer failure instead of silently passing', () => {
  const problems = validateTaskAnswers(
    [moduleWith([task()])],
    { analyze: () => { throw new Error('python3 is unavailable'); } },
  );

  assert.equal(problems.length, 1);
  assert.match(problems[0], /AST analysis failed.*python3 is unavailable/);
});

test('pandas answer: the real AST check tells a computation from a constant', (t) => {
  const probe = spawnSync('python3', ['-c', 'import ast'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    t.skip('python3 is not available');
    return;
  }

  const samples = [
    { key: 'p06:0', module: 'p06', starter, solution: task().solution },
    {
      key: 'p06:1',
      module: 'p06',
      starter,
      solution: `import pandas as pd\ndf = pd.DataFrame({"a": [1, 2]})\nprint("[1, 2]")`,
    },
  ];
  const results = analyzeSolutions(samples);
  const computed = results.get('p06:0');
  const constant = results.get('p06:1');

  assert.equal(computed.printedTainted, true);
  assert.equal(computed.requires, 'cumprod()');
  assert.ok(computed.answerOps.some((entry) => entry.label === 'cumprod()' && entry.tainted));
  assert.equal(constant.printedTainted, false);
});
