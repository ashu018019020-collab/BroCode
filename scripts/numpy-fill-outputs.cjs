#!/usr/bin/env node
/**
 * Fill the `output` of every authored code sample in the NumPy deepening pack, and the reference
 * output of every independent coding task (`tasks.json`) by running its solution + hidden check.
 *
 * The output is **printed by the real interpreter**, never typed by hand: each topic's `code` is run
 * with Python + numpy in a throwaway directory and its stdout is stored verbatim (trailing blank
 * lines trimmed). A sample that raises or prints nothing fails the whole run, so the pack cannot
 * publish an unverified example.
 *
 * Usage: node scripts/numpy-fill-outputs.cjs
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'numpy-mastery');
const FILES = fs.readdirSync(SRC).filter((f) => /^deepening.*\.json$/.test(f)).sort().map((f) => path.join(SRC, f));

const probe = spawnSync('python3', ['-c', 'import numpy; print(numpy.__version__)'], { encoding: 'utf8' });
if (probe.status !== 0) {
  console.error('numpy-fill-outputs: python3 with numpy is required to verify outputs');
  console.error(probe.stderr.trim());
  process.exit(1);
}
console.log(`numpy-fill-outputs: verifying against numpy ${probe.stdout.trim()}`);

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'npy-out-'));
const failures = [];
let filled = 0;
let skipped = 0;

for (const file of FILES) {
  const deep = JSON.parse(fs.readFileSync(file, 'utf8'));
  let changed = false;
  for (const [id, pack] of Object.entries(deep)) {
    for (const topic of pack.topics || []) {
      if (topic.output) {
        skipped += 1;
        continue;
      }
      const run = spawnSync('python3', ['-c', topic.code], { cwd: workdir, encoding: 'utf8' });
      if (run.status !== 0) {
        failures.push(`${path.basename(file)} ${id} :: ${topic.title}\n  ${(run.stderr || '').trim().split('\n').slice(-1)[0]}`);
        continue;
      }
      const output = run.stdout.replace(/\s+$/, '');
      if (!output) {
        failures.push(`${path.basename(file)} ${id} :: ${topic.title}\n  printed nothing`);
        continue;
      }
      topic.output = output;
      filled += 1;
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(file, `${JSON.stringify(deep, null, 2)}\n`);
}

/* Independent tasks: the reference output is what the solution prints, and the hidden check must
 * accept that solution — a task whose own reference fails its check is not publishable. */
const TASKS_FILE = path.join(SRC, 'tasks.json');
if (fs.existsSync(TASKS_FILE)) {
  const tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
  let changed = false;
  for (const [id, list] of Object.entries(tasks)) {
    for (const task of list) {
      const run = spawnSync('python3', ['-c', `${task.solution}\n${task.check}`], { cwd: workdir, encoding: 'utf8' });
      if (run.status !== 0) {
        failures.push(`tasks ${id} :: ${task.title}\n  its own solution fails the hidden check: ${(run.stderr || '').trim().split('\n').slice(-1)[0]}`);
        continue;
      }
      const output = run.stdout.replace(/\s+$/, '');
      if (!output) {
        failures.push(`tasks ${id} :: ${task.title}\n  the reference solution printed nothing`);
        continue;
      }
      if (task.expected !== output) {
        task.expected = output;
        filled += 1;
        changed = true;
      } else {
        skipped += 1;
      }
    }
  }
  if (changed) fs.writeFileSync(TASKS_FILE, `${JSON.stringify(tasks, null, 2)}\n`);
}

if (failures.length) {
  console.error(`numpy-fill-outputs: ${failures.length} sample(s) failed`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}

console.log(`numpy-fill-outputs: filled ${filled}, already verified ${skipped} across ${FILES.length} layer(s) + tasks`);
