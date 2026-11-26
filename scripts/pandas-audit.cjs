#!/usr/bin/env node
/**
 * pandas-audit.cjs — read-only execution audit of the Pandas Mastery course.
 *
 * Every number here comes from running the authored code, not from trusting the stored string:
 *
 *   · each Learn topic's `code` is executed and its stdout compared with `output` — that same
 *     `output` is what the published artifact serves as the interview answer, logic prompt,
 *     practice solution and checkpoint key;
 *   · each coding task's `starter` is executed, so the code a learner actually receives is proven
 *     to run, and `solution` is executed by the task guard against `expected`;
 *   · each debug challenge is executed by the debug guard: the broken sample must fail
 *     for its declared reason and the fix must print `fixedOutput`.
 *
 * Mini projects and project labs hold milestone prose only — no code and no stored output exist to
 * execute — so they are counted as unverifiable instead of being silently reported as passing.
 *
 * Nothing is written: no content file, no artifact. Exit 1 when any executed sample disagrees with
 * what the course stores.
 *
 * Usage: node scripts/pandas-audit.cjs        (npm run pandas:audit)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { inspectTaskFixtures } = require('./lib/pandas-fixture.cjs');
const { inspectDebugChallenges, normalizeOutput } = require('./lib/pandas-debug.cjs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'pandas-mastery');
/** The interpreter the generator and guards use; Windows CI sets PYTHON=python. */
const PYTHON = process.env.PYTHON || 'python3';

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/* ------------------------------ authored source ----------------------------- */
const course = readJSON(path.join(SRC, 'course.json')).course;
const moduleFiles = fs.readdirSync(SRC).filter((f) => /^modules-.*\.json$/.test(f)).sort();
const modules = moduleFiles.flatMap((f) => readJSON(path.join(SRC, f)));

/** The growth layer is merged in file order, exactly as the generator does it. */
const deepeningFiles = fs.readdirSync(SRC).filter((f) => /^deepening.*\.json$/.test(f)).sort();
for (const file of deepeningFiles) {
  const layer = readJSON(path.join(SRC, file));
  for (const [id, pack] of Object.entries(layer)) {
    const target = modules.find((m) => m.id === id);
    if (!target) continue;
    target.topics.push(...(pack.topics || []));
    target.debug.push(...(pack.debug || []));
    target.tasks.push(...(pack.tasks || []));
  }
}

/* --------------------------------- runtime ---------------------------------- */
let runtime;
try {
  runtime = execFileSync(PYTHON, ['-c', 'import sys, pandas; print(sys.version.split()[0] + " / pandas " + pandas.__version__)'], {
    encoding: 'utf8',
    timeout: 60000,
  }).trim();
} catch (error) {
  const detail = String(error.stderr || error.message || error).trim().split('\n').pop();
  console.error(`pandas-audit: cannot start ${PYTHON} with pandas — ${detail}`);
  process.exit(1);
}

/* ----------------------------- topic executor ------------------------------- */
const PY_RUNNER = `import json, sys, io, traceback, contextlib
samples = json.load(open(sys.argv[1]))
results = []
for sample in samples:
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            exec(compile(sample["code"], "<pandas-audit>", "exec"), {"__name__": "__main__"})
        results.append({"state": "ok", "stdout": buf.getvalue()})
    except BaseException:
        lines = traceback.format_exc().strip().splitlines()
        results.append({"state": "raised", "stdout": buf.getvalue(), "error": lines[-1] if lines else ""})
json.dump(results, open(sys.argv[2], "w"))
`;

/** One interpreter per module, like the guards, so 480 samples stay inside a few seconds. */
function runSamples(samples) {
  const results = new Map();
  if (!samples.length) return results;
  const groups = new Map();
  for (const sample of samples) {
    if (!groups.has(sample.module)) groups.set(sample.module, []);
    groups.get(sample.module).push(sample);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pandas-audit-'));
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
        throw new Error(`could not execute the samples for ${module}: ${detail}`);
      }
      const executed = JSON.parse(fs.readFileSync(output, 'utf8'));
      if (!Array.isArray(executed) || executed.length !== group.length) {
        throw new Error(`the Python runner returned ${executed.length} result(s) for ${group.length} sample(s)`);
      }
      group.forEach((sample, index) => results.set(sample.key, executed[index]));
    }
    return results;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The first line that disagrees, so a failure names the value instead of dumping both blobs. */
function firstDiff(stored, actual) {
  const a = normalizeOutput(stored).split('\n');
  const b = normalizeOutput(actual).split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      return `line ${i + 1}: stored ${JSON.stringify(a[i] ?? '<no line>')}, printed ${JSON.stringify(b[i] ?? '<no line>')}`;
    }
  }
  return 'no line differs (whitespace only)';
}

/* -------------------------------- collect ----------------------------------- */
const problems = [];
const fail = (message) => problems.push(message);
const samples = [];
let topics = 0;
let tasks = 0;
let debug = 0;
let starterCount = 0;
let projects = 0;
let projectSteps = 0;

for (const module of modules) {
  const topicList = Array.isArray(module.topics) ? module.topics : [];
  for (const [index, topic] of topicList.entries()) {
    const at = `${module.id}: topic ${index + 1} "${topic?.title || 'untitled'}"`;
    topics += 1;
    if (!topic || !topic.code) { fail(`${at} has no code to execute`); continue; }
    if (topic.output === undefined || topic.output === null) { fail(`${at} has no stored output`); continue; }
    samples.push({ key: `${module.id}:topic:${index}`, module: module.id, code: topic.code, stored: topic.output, at });
  }

  const taskList = Array.isArray(module.tasks) ? module.tasks : [];
  tasks += taskList.length;
  for (const [index, task] of taskList.entries()) {
    if (!task || !task.starter) continue;
    starterCount += 1;
    samples.push({ key: `${module.id}:starter:${index}`, module: module.id, code: task.starter, stored: null, at: `${module.id}: starter "${task.title || index + 1}"` });
  }

  const debugList = Array.isArray(module.debug) ? module.debug : [];
  debug += debugList.length;

  for (const project of [module.mini, module.lab]) {
    if (!project || !project.title) continue;
    projects += 1;
    projectSteps += (project.steps || project.milestones || []).length;
  }
}

let executed;
try {
  executed = runSamples(samples);
} catch (error) {
  console.error(`pandas-audit: ${error.message}`);
  process.exit(1);
}

let topicsMatched = 0;
let startersRan = 0;
for (const sample of samples) {
  const result = executed.get(sample.key);
  if (!result) { fail(`${sample.at} has no execution result`); continue; }
  if (result.state !== 'ok') {
    fail(`${sample.at} raised: ${result.error || 'unknown error'}`);
    continue;
  }
  if (sample.stored === null) { startersRan += 1; continue; }
  if (normalizeOutput(result.stdout) !== normalizeOutput(sample.stored)) {
    fail(`${sample.at} prints a different result than stored — ${firstDiff(sample.stored, result.stdout)}`);
    continue;
  }
  topicsMatched += 1;
}

/* The two authored guard suites already execute their samples, so the audit reuses their policy:
 * a debug reason is matched semantically, and a coding solution must print its `expected`. One
 * entry can report several problems, but it is still one failed entry: count entries, not messages. */
const taskAudit = inspectTaskFixtures(modules);
const debugAudit = inspectDebugChallenges(modules);
for (const problem of taskAudit.problems) fail(`coding — ${problem}`);
for (const problem of debugAudit.problems) fail(`debug — ${problem}`);

/* -------------------------------- report ------------------------------------ */
const pad = (label) => label.padEnd(20);
console.log('pandas-audit — read-only, every number counted from execution\n');
console.log(`${pad('course')}${course.title} (${modules.length} modules)`);
console.log(`${pad('runtime')}Python ${runtime} · ${PYTHON}`);
console.log(`${pad('topic examples')}${topicsMatched}/${topics} executed and matched stored output`);
console.log(`${pad('coding starters')}${startersRan}/${starterCount} executed without raising`);
console.log(`${pad('coding solutions')}${tasks - taskAudit.failed.size}/${tasks} matched stored expected output`);
console.log(`${pad('debug challenges')}${debug - debugAudit.failed.size}/${debug} pairs: broken failed as declared, fix matched fixedOutput`);
console.log(`${pad('projects')}${projects} found (${projectSteps} steps), 0 executable — milestone prose only, no code or stored output`);

const unverifiable = samples.length - topics - starterCount;
if (unverifiable > 0) console.log(`${pad('other samples')}${unverifiable} unclassified`);

if (problems.length) {
  console.error(`\n${problems.length} failure(s):`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}
console.log('\nall executed samples match the outputs the course stores.');
