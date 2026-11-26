#!/usr/bin/env node
/**
 * Print the Pandas Mastery operation coverage matrix.
 *
 * It is the readable form of `scripts/lib/pandas-coverage.cjs`: which module teaches each operation
 * family, which topics mention it, and which coding tasks and debug challenges test it. The same
 * checks run inside `scripts/pandas-course.cjs`, so a matrix printed here that ends in `ok` is the
 * matrix the generator enforces.
 *
 * Usage: node scripts/pandas-coverage.cjs [--check]
 *   (no flag)  print the matrix
 *   --check    print the matrix and exit 1 when a module teaches an operation it never tests, or a
 *              task uses an operation taught only later
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { formatCoverageMatrix, validateOperationCoverage } = require('./lib/pandas-coverage.cjs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'pandas-mastery');
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const modules = fs.readdirSync(SRC)
  .filter((file) => /^modules-.*\.json$/.test(file))
  .sort()
  .flatMap((file) => readJSON(path.join(SRC, file)));

for (const file of fs.readdirSync(SRC).filter((name) => /^deepening.*\.json$/.test(name)).sort()) {
  const layer = readJSON(path.join(SRC, file));
  for (const [id, pack] of Object.entries(layer)) {
    const target = modules.find((module) => module.id === id);
    if (!target) continue;
    target.topics.push(...(pack.topics || []));
    target.debug.push(...(pack.debug || []));
    target.tasks.push(...(pack.tasks || []));
  }
}

console.log(formatCoverageMatrix(modules));

if (process.argv.includes('--check')) {
  const problems = validateOperationCoverage(modules);
  if (problems.length) {
    console.error(`pandas-coverage: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  · ${problem}`);
    process.exit(1);
  }
  console.log('pandas-coverage: ok — every taught operation is tested where it is taught');
}
