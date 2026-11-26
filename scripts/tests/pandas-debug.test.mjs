import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  inspectDebugChallenges, validateDebugChallenges, debugDiff, MIN_TOKEN_SIMILARITY, SUPPORTED_RUNTIMES,
} = require('../lib/pandas-debug.cjs');

const broken = `import pandas as pd

df = pd.DataFrame({"a": [1, 2]})
print(df.shape())`;
const fix = `import pandas as pd

df = pd.DataFrame({"a": [1, 2]})
print(df.shape)`;

const challenge = (overrides = {}) => ({
  title: 'shape called as a method',
  broken,
  fix,
  error: "TypeError: 'tuple' object is not callable",
  fixedOutput: '(2, 1)',
  ...overrides,
});

const moduleWith = (id, debug) => ({ id, debug });

const runFrom = (results) => (samples) => new Map(samples.map((sample) => {
  const result = results[sample.kind];
  return [sample.key, result];
}));

const raisingRun = (overrides = {}) => runFrom({
  broken: { state: 'raised', stdout: '', error: "TypeError: 'tuple' object is not callable", ...overrides.broken },
  fix: { state: 'ok', stdout: '(2, 1)', ...overrides.fix },
});

test('pandas debug: accepts a pair that fails for the stored reason and fixes cleanly', () => {
  const problems = validateDebugChallenges(
    [moduleWith('p01', [challenge()])],
    { runSamples: raisingRun() },
  );

  assert.deepEqual(problems, []);
});

test('pandas debug: accepts a date error rewritten by a newer pandas version', () => {
  const stored = 'pandas._libs.tslibs.parsing.DateParseError: day is out of range for month: 2026-02-30';
  const actual = 'pandas._libs.tslibs.parsing.DateParseError: day 30 must be in range 1..28 for month 2 in year 2026: 2026-02-30';
  const problems = validateDebugChallenges(
    [moduleWith('p01', [challenge({ error: stored })])],
    { runSamples: raisingRun({ broken: { state: 'raised', error: actual } }) },
  );

  assert.deepEqual(problems, []);
});

test('pandas debug: accepts re.PatternError as the same class as re.error', () => {
  const problems = validateDebugChallenges(
    [moduleWith('p01', [challenge({ error: 're.error: unterminated character set at position 0' })])],
    { runSamples: raisingRun({ broken: { state: 'raised', error: 're.PatternError: unterminated character set at position 0' } }) },
  );

  assert.deepEqual(problems, []);
});

test('pandas debug: rejects a same-class message with a different explanation', () => {
  const stored = 'pandas._libs.tslibs.parsing.DateParseError: day is out of range for month: 2026-02-30';
  const actual = 'pandas._libs.tslibs.parsing.DateParseError: month must be in 1..12: 2026-02-30';
  const problems = validateDebugChallenges(
    [moduleWith('p01', [challenge({ error: stored })])],
    { runSamples: raisingRun({ broken: { state: 'raised', error: actual } }) },
  );

  assert.ok(problems.some((problem) => problem.includes('fails for a different reason')));
});

test('pandas debug: documents the supported browser and local runtimes', () => {
  const browser = SUPPORTED_RUNTIMES.find((runtime) => runtime.surface.includes('Pyodide'));
  const local = SUPPORTED_RUNTIMES.find((runtime) => runtime.surface.includes('Local'));
  assert.equal(browser.python, '3.12.1');
  assert.equal(browser.pandas, '2.2.0');
  assert.match(browser.source, /pyodide-lock\.json$/);
  assert.match(local.python, /3\.12-3\.15/);
  assert.match(local.pandas, /2\.2-3\.0/);
  assert.match(local.verified, /3\.15\.2.*3\.0\.6/);
});

test('pandas debug: rejects a broken sample that fails for a different reason', () => {
  const problems = validateDebugChallenges(
    [moduleWith('p01', [challenge({ error: "KeyError: 'a'" })])],
    { runSamples: raisingRun() },
  );

  assert.ok(problems.some((problem) => problem.includes('fails for a different reason')));
});

test('pandas debug: rejects the same exception type with a different message', () => {
  const problems = validateDebugChallenges(
    [moduleWith('p01', [challenge({ error: "KeyError: 'a'" })])],
    { runSamples: raisingRun({ broken: { state: 'raised', error: "KeyError: 'b'" } }) },
  );

  assert.ok(problems.some((problem) => problem.includes('fails for a different reason')));
});

test('pandas debug: accepts a declared wrong-output lesson only when the outputs differ', () => {
  const logic = challenge({
    title: 'wrong total',
    broken: 'print(2 + 2)',
    fix: 'print(2 + 3)',
    error: 'Wrong output: it prints 4, not 5.',
    brokenOutput: '4',
    fixedOutput: '5',
  });
  const problems = validateDebugChallenges(
    [moduleWith('p01', [logic])],
    {
      runSamples: runFrom({
        broken: { state: 'ok', stdout: '4' },
        fix: { state: 'ok', stdout: '5' },
      }),
    },
  );

  assert.deepEqual(problems, []);
});

test('pandas debug: rejects a wrong-output lesson whose fix prints the same output', () => {
  const logic = challenge({
    title: 'no real fix',
    broken: 'print(2 + 2)',
    fix: 'print(2 + 2)',
    error: 'Wrong output: it prints 4.',
    brokenOutput: '4',
    fixedOutput: '4',
  });
  const problems = validateDebugChallenges(
    [moduleWith('p01', [logic])],
    {
      runSamples: runFrom({
        broken: { state: 'ok', stdout: '4' },
        fix: { state: 'ok', stdout: '4' },
      }),
    },
  );

  assert.ok(problems.some((problem) => problem.includes('print the same output')));
});

test('pandas debug: rejects a fix that raises or does not match fixedOutput', () => {
  const raises = validateDebugChallenges(
    [moduleWith('p01', [challenge()])],
    { runSamples: raisingRun({ fix: { state: 'raised', error: 'ValueError: nope' } }) },
  );
  assert.ok(raises.some((problem) => problem.includes('fix raised')));

  const wrongOutput = validateDebugChallenges(
    [moduleWith('p01', [challenge()])],
    { runSamples: raisingRun({ fix: { state: 'ok', stdout: '(3, 1)' } }) },
  );
  assert.ok(wrongOutput.some((problem) => problem.includes('fixedOutput does not match')));
});

test('pandas debug: rejects a rewrite instead of a minimal fix', () => {
  const rewrite = challenge({
    title: 'rewritten',
    broken: 'import pandas as pd\n\ndf = pd.DataFrame({"a": [1]})\nprint(df["a"].sum())',
    fix: 'import pandas as pd\n\ns = pd.Series([9, 8])\nprint(s.max())',
  });

  const diff = debugDiff(rewrite.broken, rewrite.fix);
  assert.ok(diff.changedLines > 6 || diff.similarity < MIN_TOKEN_SIMILARITY);

  const problems = validateDebugChallenges(
    [moduleWith('p01', [rewrite])],
    { execute: false },
  );
  assert.ok(problems.some((problem) => problem.includes('not minimal')));
});

test('pandas debug: rejects the same broken/fix pair in another module', () => {
  const problems = validateDebugChallenges(
    [
      moduleWith('p01', [challenge()]),
      moduleWith('p02', [challenge({ title: 'same bug, new title' })]),
    ],
    { execute: false },
  );

  assert.ok(problems.some((problem) => problem.includes('repeats the broken/fix pair from p01:0')));
});

test('pandas debug: reports execution failures instead of silently passing', () => {
  const problems = validateDebugChallenges(
    [moduleWith('p01', [challenge()])],
    { runSamples: () => { throw new Error('python3 is unavailable'); } },
  );

  assert.ok(problems.some((problem) => problem.includes('debug execution failed')));
});

test('pandas debug: counts one pair once when it reports several problems', () => {
  const audit = inspectDebugChallenges(
    [moduleWith('p01', [challenge({ error: 'KeyError' })])],
    { runSamples: raisingRun({ fix: { state: 'raised', error: 'ValueError: nope' } }) },
  );

  assert.ok(audit.problems.length > 1, 'the pair should exercise both sides');
  assert.equal(audit.failed.size, 1);
});

test('pandas debug: an execution failure marks every pair as unverified', () => {
  const audit = inspectDebugChallenges(
    [moduleWith('p01', [challenge()])],
    { runSamples: () => { throw new Error('python3 is unavailable'); } },
  );

  assert.equal(audit.failed.size, 1);
});
