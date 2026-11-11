#!/usr/bin/env node
/**
 * Fill the `output` of every authored code sample in the NumPy deepening pack.
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
const FILE = path.join(ROOT, 'content', 'numpy-mastery', 'deepening.json');
const deep = JSON.parse(fs.readFileSync(FILE, 'utf8'));

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

for (const [id, pack] of Object.entries(deep)) {
  for (const topic of pack.topics || []) {
    const run = spawnSync('python3', ['-c', topic.code], { cwd: workdir, encoding: 'utf8' });
    if (run.status !== 0) {
      failures.push(`${id} :: ${topic.title}\n  ${(run.stderr || '').trim().split('\n').slice(-1)[0]}`);
      continue;
    }
    const output = run.stdout.replace(/\s+$/, '');
    if (!output) {
      failures.push(`${id} :: ${topic.title}\n  printed nothing`);
      continue;
    }
    topic.output = output;
    filled += 1;
  }
}

if (failures.length) {
  console.error(`numpy-fill-outputs: ${failures.length} sample(s) failed`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}

fs.writeFileSync(FILE, `${JSON.stringify(deep, null, 2)}\n`);
console.log(`numpy-fill-outputs: filled ${filled} outputs → content/numpy-mastery/deepening.json`);
