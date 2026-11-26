/**
 * pandas-fixture.cjs — guard for the Coding Lab of the Pandas Mastery course.
 *
 * A coding task is only runnable when its explicit `setup` and `fixture` already hold the data the
 * task works on, its `starter` is exactly that setup plus fixture plus an instruction comment, and
 * the authored solution begins with the same setup and fixture. This guard proves four things
 * instead of trusting the author:
 *
 *   · `setup` contains the imports, and `fixture` contains executable data construction;
 *   · `starter` is exactly `setup` + `fixture` + comments, so it is runnable as-is;
 *   · every executable line of setup + fixture begins the solution, so both use the same data;
 *   · running the solution prints the stored `expected` output.
 *
 * Solutions are executed with one interpreter per module, like pandas-debug.cjs, so the whole
 * Coding Lab is checked in a few seconds rather than 300 pandas imports.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/** The interpreter CI and local runs use; Windows CI sets PYTHON=python. */
const PYTHON = process.env.PYTHON || 'python3';

/** Executable lines in order: blank lines and comments are not part of the fixture. */
function codeLines(code) {
  return String(code ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

const IMPORT_RE = /^(?:import\s+\S+|from\s+\S+\s+import\b)/;

/** Output comparison is exact apart from line endings and trailing whitespace. */
function normalizeOutput(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

const PY_RUNNER = `import json, sys, io, traceback, contextlib
samples = json.load(open(sys.argv[1]))
results = []
for sample in samples:
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            exec(compile(sample["code"], "<pandas-task>", "exec"), {"__name__": "__main__"})
        results.append({"state": "ok", "stdout": buf.getvalue()})
    except BaseException:
        lines = traceback.format_exc().strip().splitlines()
        results.append({
            "state": "raised",
            "stdout": buf.getvalue(),
            "error": lines[-1] if lines else "",
        })
json.dump(results, open(sys.argv[2], "w"))
`;

/** Execute solutions grouped by module; one interpreter and one pandas import per module. */
function runSolutions(samples) {
  const results = new Map();
  if (!samples.length) return results;

  const groups = new Map();
  for (const sample of samples) {
    if (!groups.has(sample.module)) groups.set(sample.module, []);
    groups.get(sample.module).push(sample);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pandas-fixture-'));
  try {
    const runner = path.join(tmp, 'runner.py');
    fs.writeFileSync(runner, PY_RUNNER, 'utf8');
    for (const [module, group] of groups) {
      const input = path.join(tmp, 'samples.json');
      const output = path.join(tmp, 'results.json');
      fs.writeFileSync(input, JSON.stringify(group.map((s) => ({ code: s.code }))), 'utf8');
      try {
        execFileSync(PYTHON, [runner, input, output], {
          encoding: 'utf8',
          timeout: 120000,
          stdio: ['ignore', 'ignore', 'pipe'],
        });
      } catch (error) {
        const detail = String(error.stderr || error.message || error).trim().split('\n').pop();
        throw new Error(`could not execute the coding tasks for ${module}: ${detail}`);
      }
      const executed = JSON.parse(fs.readFileSync(output, 'utf8'));
      if (!Array.isArray(executed) || executed.length !== group.length) {
        throw new Error(`the Python runner returned ${executed.length} result(s) for ${group.length} task(s)`);
      }
      group.forEach((sample, index) => results.set(sample.key, executed[index]));
    }
    return results;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Inspect every coding task. Returns the human-readable problems plus the set of entries that
 * produced at least one — an entry that fails several checks is still one failed task, which is
 * what a pass/total count must subtract. `runSolutions` is injectable for tests.
 */
function inspectTaskFixtures(modules, options = {}) {
  const problems = [];
  const failed = new Set();
  const fail = (message) => problems.push(message);
  const samples = [];

  for (const module of modules) {
    const tasks = Array.isArray(module.tasks) ? module.tasks : [];
    for (const [index, task] of tasks.entries()) {
      const at = `${module.id}: task "${task?.title || index + 1}"`;
      const fail = (message) => {
        problems.push(message);
        failed.add(`${module.id}:${index}`);
      };
      if (!task || !task.title || !task.statement || !task.solution) {
        fail(`${at} needs title/statement/solution`);
        continue;
      }
      if (!task.setup || !String(task.setup).trim()) {
        fail(`${at} has no setup — add the imports the task needs`);
        continue;
      }
      if (!task.fixture || !String(task.fixture).trim()) {
        fail(`${at} has no fixture — construct the DataFrame or Series the task works on`);
        continue;
      }
      if (!task.starter || !String(task.starter).trim()) {
        fail(`${at} has no starter`);
        continue;
      }

      const setupLines = codeLines(task.setup);
      const fixtureLines = codeLines(task.fixture);
      if (!setupLines.length) {
        fail(`${at} setup holds no executable imports`);
        continue;
      }
      if (!fixtureLines.length || fixtureLines.every((line) => IMPORT_RE.test(line))) {
        fail(`${at} fixture holds no data — create the table the task works on`);
        continue;
      }

      const prefix = [...setupLines, ...fixtureLines];
      const starterLines = codeLines(task.starter);
      if (starterLines.join('\n') !== prefix.join('\n')) {
        fail(`${at} starter is not setup + fixture — keep the starter runnable as-is`);
      }

      const solutionLines = codeLines(task.solution);
      const drift = prefix.findIndex((line, i) => solutionLines[i] !== line);
      if (drift !== -1) {
        fail(`${at} solution does not start from the setup + fixture (line ${drift + 1})`);
      }
      if (task.expected === undefined || task.expected === null || !String(task.expected).trim()) {
        fail(`${at} has no expected output — run node scripts/pandas-fill-outputs.cjs`);
      }

      samples.push({ key: `${module.id}:${index}`, module: module.id, code: task.solution });
    }
  }

  if (options.execute === false || !samples.length) return { problems, failed };

  let results;
  try {
    results = (options.runSolutions || runSolutions)(samples);
  } catch (error) {
    for (const sample of samples) failed.add(sample.key);
    fail(`task execution failed: ${error.message}`);
    return { problems, failed };
  }

  for (const module of modules) {
    const tasks = Array.isArray(module.tasks) ? module.tasks : [];
    for (const [index, task] of tasks.entries()) {
      if (!task || !task.solution || !task.expected) continue;
      const at = `${module.id}: task "${task.title || index + 1}"`;
      const fail = (message) => {
        problems.push(message);
        failed.add(`${module.id}:${index}`);
      };
      const result = results.get(`${module.id}:${index}`);
      if (!result) {
        fail(`${at} has no execution result`);
        continue;
      }
      if (result.state !== 'ok') {
        fail(`${at} raised: ${result.error || result.reason || 'unknown error'}`);
        continue;
      }
      if (normalizeOutput(result.stdout) !== normalizeOutput(task.expected)) {
        fail(`${at} prints "${normalizeOutput(result.stdout)}", not the stored expected "${normalizeOutput(task.expected)}"`);
      }
    }
  }

  return { problems, failed };
}

/** The guard's contract: just the human-readable problems. */
function validateTaskFixtures(modules, options = {}) {
  return inspectTaskFixtures(modules, options).problems;
}

module.exports = { codeLines, inspectTaskFixtures, normalizeOutput, runSolutions, validateTaskFixtures };
