import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  validateTaskDiversity,
  validateCrossModuleDiversity,
  crossModuleDuplicateReport,
  solutionFingerprint,
  WARMUP_ALLOWLIST,
} = require('../lib/pandas-diversity.cjs');

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

test('pandas diversity: rejects a NEAR-duplicate solution that means the same thing', () => {
  const problems = validateTaskDiversity([
    task('Row count', 'Print how many rows the frame has.', 'print(df.shape[0])'),
    task('Frame length', 'Print the length of the frame.', 'print(len(df))'),
  ], 'p99');

  const near = problems.find((p) => p.includes('repeats the solution'));
  assert.ok(near, `expected a near-duplicate failure, got ${JSON.stringify(problems)}`);
  assert.ok(near.includes('"Frame length"'), 'the message names the offending task');
  assert.ok(near.includes('"Row count"'), 'the message names the task it duplicates');
  assert.ok(near.includes('semantic fingerprint'), 'the message explains why they collide');
  assert.ok(near.includes('len(df)'), 'the fingerprint is shown in the message');
});

test('pandas diversity: fingerprints ignore spelling but keep column case', () => {
  const same = [
    ['print(df.shape[0])', 'print(len(df))'],
    ['print(df.shape[0])', 'print( len( df ) )'],
    ['print(df.shape[1])', 'print(len(df.columns))'],
    ['print(df.shape[1])', 'print(df.columns.size)'],
    ['print(df["b"].tolist())', 'print(list(df["b"]))'],
    ['print(df["b"].tolist())', 'print(df["b"].values.tolist())'],
    ['print(df["b"].tolist())', "print(df['b'].tolist())"],
    ['print(df.head(n=2))', 'print(df.head(2))'],
    ['print(df.copy()["a"].sum())', 'print(df["a"].sum())'],
    ['# count the rows\nprint(len(df))', 'print(len(df))'],
  ];
  for (const [left, right] of same) {
    assert.equal(solutionFingerprint(left), solutionFingerprint(right), `${left} === ${right}`);
  }

  const different = [
    ['print(df["Sales"].sum())', 'print(df["sales"].sum())'],
    ['print(df.shape[0])', 'print(df.shape[1])'],
    ['print(df["a"].sum())', 'print(df["b"].sum())'],
    ['print(df.head(2))', 'print(df.head(3))'],
  ];
  for (const [left, right] of different) {
    assert.notEqual(solutionFingerprint(left), solutionFingerprint(right), `${left} !== ${right}`);
  }
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

test('pandas diversity: rejects a task copied into another module', () => {
  const problems = validateCrossModuleDiversity([
    { id: 'p16', tasks: [task('Category codes', 'Print the integer codes.', 'print(s.cat.codes.tolist())')] },
    { id: 'p18', tasks: [task('Feature codes', 'Print the codes for the labels.', 'print(s.cat.codes.tolist())')] },
  ]);

  const duplicated = problems.find((p) => p.includes('repeats the solution'));
  assert.ok(duplicated, `expected a cross-module failure, got ${JSON.stringify(problems)}`);
  assert.ok(duplicated.startsWith('p18:'), 'the message is filed against the later module');
  assert.ok(duplicated.includes('p16'), 'the message names the module it copies');
  assert.ok(duplicated.includes('WARMUP_ALLOWLIST'), 'the message says how to exempt an intended repeat');
});

test('pandas diversity: flags a cross-module near-duplicate, not just identical text', () => {
  const problems = validateCrossModuleDiversity([
    { id: 'p01', tasks: [task('Row count', 'Print how many rows the frame has.', 'print(df.shape[0])')] },
    { id: 'p09', tasks: [task('Frame length', 'Print the length of the frame.', 'print(len(df))')] },
  ]);

  assert.ok(problems.some((p) => p.startsWith('p09:') && p.includes('repeats the solution')));
});

test('pandas diversity: also catches a statement copied across modules', () => {
  const problems = validateCrossModuleDiversity([
    { id: 'p03', tasks: [task('Alpha task', 'Print the number of rows.', 'print(len(df))')] },
    { id: 'p07', tasks: [task('Beta task', 'Print the number of rows.', 'print(df["a"].sum())')] },
  ]);

  assert.ok(problems.some((p) => p.startsWith('p07:') && p.includes('repeats the statement')));
});

test('pandas diversity: the intentional warm-ups are allowlisted across modules', () => {
  assert.deepEqual(
    WARMUP_ALLOWLIST.map((entry) => entry.title),
    ['Count rows and columns', 'Select a column', 'Filter rows', 'Add a column'],
    'the allowlist names exactly the warm-ups the course repeats',
  );

  const modules = ['p01', 'p02', 'p20'].map((id) => ({
    id,
    tasks: [
      task(`Count rows and columns (${id.toUpperCase()})`, 'Print the number of rows and columns of the DataFrame.', 'print(len(df), len(df.columns))'),
      task(`Select a column (${id.toUpperCase()})`, 'Print the values of column "b" as a list.', 'print(df["b"].tolist())'),
      task(`Filter rows (${id.toUpperCase()})`, 'Print rows where column "a" is greater than 1.', 'print(df[df["a"] > 1].to_string(index=False))'),
      task(`Add a column (${id.toUpperCase()})`, 'Add column "c" as a + b and print the DataFrame.', 'df["c"] = df["a"] + df["b"]\nprint(df.to_string(index=False))'),
    ],
  }));

  assert.deepEqual(validateCrossModuleDiversity(modules), []);
});

test('pandas diversity: the allowlist is opt-in, so a caller can tighten it', () => {
  const modules = [
    { id: 'p01', tasks: [task('Select a column (P01)', 'Print column b.', 'print(df["b"].tolist())')] },
    { id: 'p02', tasks: [task('Select a column (P02)', 'Print column b.', 'print(df["b"].tolist())')] },
  ];

  assert.deepEqual(validateCrossModuleDiversity(modules), []);
  assert.ok(validateCrossModuleDiversity(modules, { allowWarmups: [] }).length > 0);
});

test('pandas diversity: a shared title with a different solution is not a duplicate', () => {
  const problems = validateCrossModuleDiversity([
    { id: 'p01', tasks: [task('Average marks per course', 'Print the mean per course.', 'print(df.groupby("course")["marks"].mean())')] },
    { id: 'p13', tasks: [task('Average marks per course', 'Print the rounded mean per course.', 'print(df.groupby("course")["marks"].mean().round(1))')] },
  ]);

  assert.deepEqual(problems, []);
});

test('pandas diversity report: flags a repeated title without failing the hard gate', () => {
  const modules = [
    { id: 'p02', tasks: [task('Clean missing values (P02)', 'Drop the missing rows.', 'print(df.dropna())')] },
    { id: 'p07', tasks: [task('Clean missing values', 'Fill the missing values with zero.', 'print(df.fillna(0))')] },
  ];

  const report = crossModuleDuplicateReport(modules);
  assert.equal(report.counts.title, 1, 'the title repeat is reported');
  assert.equal(report.counts.statement, 0, 'the statements differ');
  assert.equal(report.counts.solution, 0, 'the solutions differ');
  assert.equal(report.findings[0].kind, 'title');
  assert.equal(report.findings[0].moduleId, 'p07');
  assert.equal(report.findings[0].ownerModuleId, 'p02');
  assert.match(report.findings[0].message, /repeats the title/);
  assert.deepEqual(validateCrossModuleDiversity(modules), [], 'a shared title alone is advisory, not fatal');
});

test('pandas diversity report: only a pair of documented warm-ups is exempt', () => {
  const statement = 'Print rows where column "a" is greater than 1.';
  const solution = 'print(df[df["a"] > 1].to_string(index=False))';
  const warmup = (title, id) => task(`${title} (${id})`, statement, solution);
  const unique = (id) => task('Keep matching rows', statement, solution);

  const cases = [
    {
      name: 'the same warm-up in both modules',
      first: warmup('Filter rows', 'P01'),
      second: warmup('Filter rows', 'P02'),
      counts: { title: 0, statement: 0, solution: 0 },
    },
    {
      name: 'two different documented warm-ups',
      first: warmup('Filter rows', 'P01'),
      second: warmup('Select a column', 'P02'),
      counts: { title: 0, statement: 0, solution: 0 },
    },
    {
      name: 'a unique task copying a warm-up',
      first: warmup('Filter rows', 'P01'),
      second: unique('P02'),
      counts: { title: 0, statement: 1, solution: 1 },
    },
    {
      name: 'a warm-up copying a unique task',
      first: unique('P01'),
      second: warmup('Filter rows', 'P02'),
      counts: { title: 0, statement: 1, solution: 1 },
    },
  ];

  for (const { name, first, second, counts } of cases) {
    const modules = [{ id: 'p01', tasks: [first] }, { id: 'p02', tasks: [second] }];
    const report = crossModuleDuplicateReport(modules);
    assert.deepEqual(report.counts, counts, name);
    assert.equal(report.findings.length, counts.statement + counts.solution, name);
    if (report.findings.length) {
      assert.ok(
        report.findings.every((finding) => finding.moduleId === 'p02' && finding.ownerModuleId === 'p01'),
        `${name}: findings are filed against the later task`,
      );
    }
    assert.equal(validateCrossModuleDiversity(modules).length, report.findings.length, `${name}: gate agrees with the report`);
  }
});

test('pandas diversity report: flags repeated statements and solutions with both owners', () => {
  const report = crossModuleDuplicateReport([
    { id: 'p01', tasks: [task('Row count', 'Print how many rows the frame has.', 'print(df.shape[0])')] },
    { id: 'p09', tasks: [task('Frame length', 'Print how many rows the frame has.', 'print(len(df))')] },
  ]);

  assert.equal(report.counts.statement, 1);
  assert.equal(report.counts.solution, 1);
  for (const finding of report.findings) {
    assert.equal(finding.moduleId, 'p09');
    assert.equal(finding.ownerModuleId, 'p01');
  }
  assert.ok(report.findings.some((finding) => finding.kind === 'solution' && finding.fingerprint.includes('len(df)')));
  assert.equal(validateCrossModuleDiversity([
    { id: 'p01', tasks: [task('Row count', 'Print how many rows the frame has.', 'print(df.shape[0])')] },
    { id: 'p09', tasks: [task('Frame length', 'Print how many rows the frame has.', 'print(len(df))')] },
  ]).length, 2, 'the hard gate still reports both copies');
});

test('pandas diversity report: a clean module set has no findings', () => {
  const report = crossModuleDuplicateReport([
    { id: 'p01', tasks: [task('Count the rows', 'Print the row count.', 'print(len(df))')] },
    { id: 'p02', tasks: [task('Sum a column', 'Print the total of column "a".', 'print(df["a"].sum())')] },
  ]);

  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.counts, { title: 0, statement: 0, solution: 0 });
});
