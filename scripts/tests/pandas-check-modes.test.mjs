/**
 * Regression tests for the three `--check` modes the pandas workflow runs.
 *
 * A check that only passes on today's tree proves nothing: each mode has to be shown failing for the
 * reason it claims to catch. Every test builds a throwaway project in the OS temp directory — the
 * real script, the libraries it requires, and the smallest content that reaches the branch — makes
 * exactly one thing wrong, and asserts the CLI's exit code and message:
 *
 *   · `pandas-course check` compares ONE file. It has two failure paths, and they are different
 *     problems: the artifact is missing, or it no longer matches the source. Both must stay named,
 *     and a current artifact must still exit 0 (or a check that always failed would pass this file).
 *   · `pandas-diversity-report.cjs --check` blocks a repeated statement and a repeated solution;
 *     a repeated TITLE is advisory by design and must NOT fail the run.
 *   · `pandas-coverage.cjs --check` blocks a module that teaches an operation no task exercises.
 *
 * The diversity and coverage fixtures are two/20 synthetic modules, not a copy of the course, so the
 * test cannot start failing because real authored content changed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { OPERATIONS } = require('../lib/pandas-coverage.cjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'content', 'pandas-mastery');
const ARTIFACT = path.join(ROOT, 'public', 'generated', 'pandas-course', 'index.json');
const COURSE_LIBS = [
  'pandas-diversity.cjs',
  'pandas-debug.cjs',
  'pandas-fixture.cjs',
  'pandas-answer.cjs',
  'pandas-coverage.cjs',
];

/** A disposable project: one real script, the libraries it requires, and either real or given content. */
function makeFixture(script, { libs, content }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandas-check-'));
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scripts', script), path.join(dir, 'scripts', script));
  for (const library of libs) {
    fs.copyFileSync(path.join(ROOT, 'scripts', 'lib', library), path.join(dir, 'scripts', 'lib', library));
  }

  const target = path.join(dir, 'content', 'pandas-mastery');
  if (content === 'real') {
    fs.cpSync(SRC, target, { recursive: true });
  } else {
    fs.mkdirSync(target, { recursive: true });
    for (const [name, modules] of Object.entries(content)) {
      fs.writeFileSync(path.join(target, name), `${JSON.stringify(modules, null, 1)}\n`, 'utf8');
    }
  }
  return dir;
}

function withFixture(script, options, body) {
  const dir = makeFixture(script, options);
  try {
    body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Run a fixture's CLI in the fixture root, exactly as npm would. */
function run(script, args, cwd) {
  return spawnSync(process.execPath, [path.join(cwd, 'scripts', script), ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
  });
}

function writeArtifact(dir, mutate) {
  const target = path.join(dir, 'public', 'generated', 'pandas-course', 'index.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  if (mutate) mutate(artifact);
  fs.writeFileSync(target, `${JSON.stringify(artifact, null, 1)}\n`, 'utf8');
}

/* --------------------------- published artifact ---------------------------- */

test('pandas-course check: a missing artifact is named as missing, not as stale', () => {
  withFixture('pandas-course.cjs', { libs: COURSE_LIBS, content: 'real' }, (dir) => {
    const result = run('pandas-course.cjs', ['check'], dir);
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.stdout}`);
    assert.match(result.stderr, /the published artifact is missing/);
    assert.doesNotMatch(result.stderr, /stale/);
  });
});

test('pandas-course check: a stale artifact exits non-zero and names the write command', () => {
  withFixture('pandas-course.cjs', { libs: COURSE_LIBS, content: 'real' }, (dir) => {
    // One stale number is enough: the check compares the whole serialized artifact.
    writeArtifact(dir, (artifact) => { artifact.stats.entries += 1; });

    const result = run('pandas-course.cjs', ['check'], dir);
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.stdout}`);
    assert.match(result.stderr, /the published artifact is stale/);
    assert.match(result.stderr, /pandas-course:write/);
  });
});

test('pandas-course check: a current artifact exits zero', () => {
  withFixture('pandas-course.cjs', { libs: COURSE_LIBS, content: 'real' }, (dir) => {
    writeArtifact(dir);

    const result = run('pandas-course.cjs', ['check'], dir);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`);
    assert.match(result.stdout, /artifact is current/);
  });
});

/* ------------------------------ diversity gate ---------------------------- */

/** Two modules with distinct titles, statements and solutions; one task each. */
const diversityModules = () => [
  {
    id: 'p01',
    title: 'First module',
    topics: [],
    debug: [],
    tasks: [
      { title: 'Alpha rows', statement: 'Print the alpha values.', solution: 'print(df["a"].tolist())' },
      { title: 'Beta total', statement: 'Print the beta total.', solution: 'print(df["b"].sum())' },
    ],
  },
  {
    id: 'p02',
    title: 'Second module',
    topics: [],
    debug: [],
    tasks: [
      { title: 'Gamma mean', statement: 'Print the gamma mean.', solution: 'print(df["g"].mean())' },
    ],
  },
];

function diversityFixture(mutate) {
  const modules = diversityModules();
  mutate(modules);
  return { libs: ['pandas-diversity.cjs'], content: { 'modules-01-05.json': modules } };
}

test('pandas-diversity --check: a statement copied into another module fails', () => {
  const options = diversityFixture((modules) => {
    modules[1].tasks.push({
      title: 'Statement copy probe',
      statement: modules[0].tasks[0].statement,
      solution: 'print("statement probe")',
    });
  });

  withFixture('pandas-diversity-report.cjs', options, (dir) => {
    const result = run('pandas-diversity-report.cjs', ['--check'], dir);
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.stdout}`);
    assert.match(result.stderr, /blocking duplicate/);
    assert.match(result.stderr, /repeats the statement/);
  });
});

test('pandas-diversity --check: a solution copied into another module fails', () => {
  const options = diversityFixture((modules) => {
    modules[1].tasks.push({
      title: 'Solution copy probe',
      statement: 'Print the solution copy probe value.',
      solution: modules[0].tasks[1].solution,
    });
  });

  withFixture('pandas-diversity-report.cjs', options, (dir) => {
    const result = run('pandas-diversity-report.cjs', ['--check'], dir);
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.stdout}`);
    assert.match(result.stderr, /blocking duplicate/);
    assert.match(result.stderr, /repeats the solution/);
  });
});

test('pandas-diversity --check: a repeated title stays advisory', () => {
  const options = diversityFixture((modules) => {
    modules[1].tasks.push({
      title: 'Alpha rows',
      statement: 'Print the alpha title probe.',
      solution: 'print(df["t"].max())',
    });
  });

  withFixture('pandas-diversity-report.cjs', options, (dir) => {
    const result = run('pandas-diversity-report.cjs', ['--check'], dir);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`);
    assert.match(result.stdout, /1 advisory title repeat/);
  });
});

/* ------------------------------- coverage gate ---------------------------- */

/** A complete 20-module matrix: each module tests every family it is authored to teach. */
function coverageModules({ breakP01 = false } = {}) {
  return Array.from({ length: 20 }, (_, index) => {
    const id = `p${String(index + 1).padStart(2, '0')}`;
    const taught = OPERATIONS.filter((family) => family.taughtIn === id);
    return {
      id,
      title: `Module ${index + 1}`,
      topics: taught.map((family) => ({ title: `Topic ${family.id}`, code: family.example })),
      tasks: breakP01 && id === 'p01'
        ? []
        : taught.map((family) => ({ title: `Task ${family.id}`, requires: 'tolist()', solution: `print(${family.example})` })),
      debug: [],
    };
  });
}

test('pandas-coverage --check: a module that teaches an operation it never tests fails', () => {
  withFixture('pandas-coverage.cjs', {
    libs: ['pandas-coverage.cjs'],
    content: { 'modules-01-05.json': coverageModules({ breakP01: true }) },
  }, (dir) => {
    const result = run('pandas-coverage.cjs', ['--check'], dir);
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.stdout}`);
    assert.match(result.stderr, /pandas-coverage: \d+ problem/);
    assert.match(result.stderr, /no coding task or debug challenge tests/);
  });
});
