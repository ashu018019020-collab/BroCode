import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  OPERATIONS,
  REQUIRES_FAMILY,
  buildCoverageMatrix,
  validateOperationCoverage,
  formatCoverageMatrix,
  operationsInDebug,
  familyOfRequires,
} = require('../lib/pandas-coverage.cjs');

/**
 * A 20-module course in which each module already tests the operations it is authored to teach, so
 * a fixture only has to describe the behaviour under test. `replace: true` swaps a module's content
 * instead of appending to it.
 */
function course(populate = {}) {
  const modules = Array.from({ length: 20 }, (_, index) => ({
    id: `p${String(index + 1).padStart(2, '0')}`,
    title: `Module ${index + 1}`,
    topics: [],
    tasks: [],
    debug: [],
  }));
  for (const module of modules) {
    const taught = OPERATIONS.filter((family) => family.taughtIn === module.id);
    module.topics = taught.map((family) => ({ title: `Topic ${family.id}`, code: family.example }));
    module.tasks = taught.map((family) => ({
      title: `Task ${family.id}`,
      requires: 'tolist()',
      solution: `print(${family.example})`,
    }));
  }
  for (const [id, patch] of Object.entries(populate)) {
    const module = modules.find((entry) => entry.id === id);
    const { replace = false, ...content } = patch;
    if (replace) {
      Object.assign(module, content);
      continue;
    }
    for (const [key, value] of Object.entries(content)) module[key] = [...module[key], ...value];
  }
  return modules;
}

/** p01 in its complete form: it teaches selection, inspection, aggregation and conversion. */
const P01 = {
  topics: [
    { title: 'Select a column', code: 'df["a"]' },
    { title: 'Inspect the shape', code: 'df.shape' },
    { title: 'Aggregate with mean', code: 'df["a"].mean()' },
    { title: 'Convert to a Python list', code: 'df["a"].tolist()' },
  ],
  tasks: [
    { title: 'Pick a column', requires: '__getitem__()', solution: 'print(df["a"])' },
    { title: 'Rows and columns', requires: 'shape', solution: 'print(df.shape)' },
    { title: 'Average', requires: 'mean()', solution: 'print(df["a"].mean())' },
    { title: 'As a list', requires: 'tolist()', solution: 'print(df["a"].tolist())' },
  ],
  debug: [],
};

test('every requires label maps to exactly one operation family', () => {
  const labels = [...REQUIRES_FAMILY.keys()];
  assert.equal(labels.length, new Set(labels).size);
  assert.ok(labels.length >= 70);
  for (const family of OPERATIONS) {
    for (const requirement of family.requires) assert.equal(familyOfRequires(requirement).id, family.id);
  }
});

test('a clean course passes the operation coverage gate', () => {
  assert.deepEqual(validateOperationCoverage(course({ p01: { ...P01, replace: true } })), []);
});

test('a module that teaches an operation but never tests it fails', () => {
  const modules = course({
    p01: { ...P01, replace: true },
    p13: {
      replace: true,
      topics: [{ title: 'groupby splits, then aggregates', code: 'df.groupby("k").sum()' }],
      tasks: [{ title: 'Round a column', requires: 'round()', solution: 'print(df["a"].round(2))' }],
      debug: [],
    },
  });
  const problems = validateOperationCoverage(modules);
  assert.ok(
    problems.some((problem) => /p13: no coding task or debug challenge tests grouping and aggregation \(df\.groupby\(/u.test(problem)),
    problems.join('\n'),
  );
});

test('a task that uses an operation taught only later fails and names the operation', () => {
  const modules = course({
    p01: { ...P01, replace: true },
    p02: {
      topics: [{ title: 'A custom index', code: 'df.reindex([1, 2])' }],
      tasks: [{
        title: 'Join the tables',
        requires: 'merge()',
        solution: 'print(left.merge(right, on="id"))',
      }],
    },
  });
  const problems = validateOperationCoverage(modules);
  assert.ok(
    problems.some((problem) => /p02: task "Join the tables" uses merging and joining \(left\.merge\(right, on="id"\)\) via merge\(\), taught only later in p12/u.test(problem)),
    problems.join('\n'),
  );
});

test('a requires label outside the operation catalogue fails', () => {
  const modules = course({
    p01: {
      ...P01,
      replace: true,
      tasks: [...P01.tasks, { title: 'Mystery', requires: 'frobnicate()', solution: 'print(1)' }],
    },
  });
  const problems = validateOperationCoverage(modules);
  assert.ok(
    problems.some((problem) => /p01: task "Mystery" requires frobnicate\(\), which maps to no pandas operation family/u.test(problem)),
    problems.join('\n'),
  );
});

test('an operation claimed as taught with nothing in the module mentioning it fails', () => {
  const modules = course({
    p01: { ...P01, replace: true },
    p13: {
      replace: true,
      topics: [{ title: 'Something else entirely', code: 'print(1)' }],
      tasks: [{ title: 'Round a column', requires: 'round()', solution: 'print(df["a"].round(2))' }],
      debug: [],
    },
  });
  const problems = validateOperationCoverage(modules);
  assert.ok(
    problems.some((problem) => /p13: grouping and aggregation .* claims to be taught here, but no topic, task or debug challenge mentions it/u.test(problem)),
    problems.join('\n'),
  );
});

test('debug challenges are mapped by the operation they share with their fix', () => {
  assert.deepEqual(
    operationsInDebug({ broken: 'df.groupby("k").sum()', fix: 'df.groupby("k")["v"].sum()' })
      .map((family) => family.id),
    ['aggregation', 'groupby'],
  );
});

test('a debug challenge counts as testing the operation a module teaches', () => {
  const modules = course({
    p01: { ...P01, replace: true },
    p13: {
      replace: true,
      topics: [{ title: 'groupby splits, then aggregates', code: 'df.groupby("k").sum()' }],
      tasks: [],
      debug: [{ broken: 'df.groupby("k").count()', fix: 'df.groupby("k").size()' }],
    },
  });
  assert.deepEqual(validateOperationCoverage(modules), []);
});

test('debug drills may cite a later operation without a prerequisite failure', () => {
  const modules = course({
    p01: { ...P01, replace: true },
    p02: {
      topics: [{ title: 'A custom index', code: 'df.reindex([1, 2])' }],
      debug: [{ broken: 'left.merge(right, on="id")', fix: 'left.join(right, on="id")' }],
    },
  });
  assert.deepEqual(validateOperationCoverage(modules), []);
});

test('the matrix maps taught, topics, coding and debug families per module', () => {
  const { rows, operations } = buildCoverageMatrix(course({ p01: { ...P01, replace: true } }));
  assert.equal(operations.length, OPERATIONS.length);
  const p01 = rows.find((row) => row.id === 'p01');
  assert.deepEqual(p01.taught.map((family) => family.id), ['selection', 'inspection', 'aggregation', 'conversion']);
  assert.deepEqual(p01.coding.map((family) => family.id), ['selection', 'inspection', 'aggregation', 'conversion']);
  assert.ok(p01.topics.some((family) => family.id === 'conversion'));

  const text = formatCoverageMatrix(course({ p01: { ...P01, replace: true } }));
  assert.match(text, /operation coverage: 20 modules/u);
  assert.match(text, /p01[^\n]*\n {2}taught: selection, inspection, aggregation, conversion/u);
});
