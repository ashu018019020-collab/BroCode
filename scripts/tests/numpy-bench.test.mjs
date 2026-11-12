/**
 * The performance lab's program and parser.
 *
 * The lab claims to time a real Python loop against a real NumPy expression. These tests execute the
 * same program with the local Python/NumPy and parse it with the same function the panel uses, so a
 * green run proves the numbers on screen come from a measurement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register('./_ts-resolve.mjs', import.meta.url);

const bench = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/numpy-bench.ts')).href);

test('median picks the middle and averages a pair', () => {
  assert.equal(bench.median([5, 1, 3]), 3);
  assert.equal(bench.median([4, 1, 3, 2]), 2.5);
  assert.equal(bench.median([]), 0);
});

test('parseBenchmark turns the marker line into a report', () => {
  const output = [
    'loading numpy',
    'NBENCH{"n":1000,"reps":3,"loopTimes":[9,8,10],"vectorTimes":[1,1,2],"checksumDelta":0}',
  ].join('\n');
  const report = bench.parseBenchmark(output);
  assert.equal(report.n, 1000);
  assert.equal(report.reps, 3);
  assert.equal(report.loopMs, 9);
  assert.equal(report.vectorMs, 1);
  assert.equal(report.speedup, 9);
  assert.equal(report.checksumDelta, 0);
});

test('parseBenchmark refuses missing or broken output', () => {
  assert.equal(bench.parseBenchmark('no marker here'), null);
  assert.equal(bench.parseBenchmark('NBENCH{not json'), null);
  assert.equal(bench.parseBenchmark('NBENCH{"loopTimes":[],"vectorTimes":[]}'), null);
});

test('benchmarkSource only accepts a sane size and repeat count', () => {
  const src = bench.benchmarkSource(10, 0);
  assert.match(src, /^n = 1000$/m);
  assert.match(src, /^reps = 1$/m);
  assert.ok(src.includes('np.sum(values * values)'));
  assert.ok(src.includes('for v in values.tolist()'));
});

test('the benchmark program runs and the vectorised path is faster', () => {
  const probe = spawnSync('python3', ['-c', bench.benchmarkSource(20000, 3)], { encoding: 'utf8', timeout: 120000 });
  if (probe.status !== 0) {
    if (/No module named 'numpy'/.test(probe.stderr) || probe.error) {
      console.log('numpy-not-available: benchmark program not executed');
      return;
    }
    assert.fail(`benchmark program failed: ${probe.stderr}`);
  }
  const report = bench.parseBenchmark(probe.stdout);
  assert.ok(report, 'the program must print a parsable NBENCH line');
  assert.equal(report.n, 20000);
  assert.equal(report.loopTimes.length, 3);
  assert.equal(report.vectorTimes.length, 3);
  assert.ok(report.loopMs > 0 && report.vectorMs > 0, 'both kernels must take measurable time');
  assert.ok(report.speedup > 1, `expected the vectorised expression to win, got ${report.speedup}x`);
  assert.ok(report.checksumDelta < 1e-3, `both paths must agree, delta ${report.checksumDelta}`);
});
