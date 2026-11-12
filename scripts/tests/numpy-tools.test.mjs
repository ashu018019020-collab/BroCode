/**
 * The NumPy interactive tools' arithmetic.
 *
 * The page must not show invented numbers: these tests fix the broadcasting rule, the population
 * statistics (NumPy's default ddof=0), the linear percentile interpolation, and the matmul contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register('./_ts-resolve.mjs', import.meta.url);
const tools = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/numpy-tools.ts')).href);

test('parseShape accepts the three written forms and rejects zero dimensions', () => {
  assert.deepEqual(tools.parseShape('2, 3'), [2, 3]);
  assert.deepEqual(tools.parseShape('2x3'), [2, 3]);
  assert.deepEqual(tools.parseShape(' 4 '), [4]);
  assert.deepEqual(tools.parseShape('2,3,4'), [2, 3, 4]);
  assert.equal(tools.parseShape('0, 3'), null);
  assert.equal(tools.parseShape('2, -1'), null);
  assert.equal(tools.parseShape('two, 3'), null);
  assert.equal(tools.parseShape(''), null);
});

test('shapeSize and shapeStrides match ndarray.size and C-order strides', () => {
  assert.equal(tools.shapeSize([2, 3]), 6);
  assert.equal(tools.shapeSize([2, 3, 4]), 24);
  assert.deepEqual(tools.shapeStrides([2, 3]), [3, 1]);
  assert.deepEqual(tools.shapeStrides([2, 3, 4]), [12, 4, 1]);
  assert.deepEqual(tools.shapeStrides([5]), [1]);
});

test('broadcasting follows the trailing-dimension rule', () => {
  assert.deepEqual(tools.broadcastShape([3, 1], [1, 4]).shape, [3, 4]);
  assert.deepEqual(tools.broadcastShape([2, 3], [3]).shape, [2, 3]);
  assert.deepEqual(tools.broadcastShape([5], [1]).shape, [5]);
  assert.deepEqual(tools.broadcastShape([2, 1, 4], [3, 1]).shape, [2, 3, 4]);
  assert.deepEqual(tools.broadcastShape([2, 3], [3, 2]).shape, null);
  assert.equal(tools.broadcastShape([2, 3], [3, 2]).ok, false);
  assert.equal(tools.broadcastShape([2, 3], [2]).ok, false);
  assert.match(tools.broadcastShape([2, 3], [2]).steps.join(' '), /cannot broadcast/);
});

test('statsSummary is population statistics, like np.mean/np.std/np.var', () => {
  const s = tools.statsSummary([1, 2, 3, 4]);
  assert.ok(s);
  assert.equal(s.count, 4);
  assert.equal(s.mean, 2.5);
  assert.equal(s.median, 2.5);
  assert.equal(s.variance, 1.25);
  assert.equal(s.std, Math.sqrt(1.25));
  assert.equal(s.min, 1);
  assert.equal(s.max, 4);
  assert.equal(s.range, 3);
  assert.equal(tools.statsSummary([]), null);
});

test('percentile interpolates linearly like np.percentile', () => {
  assert.equal(tools.percentile([1, 2, 3, 4], 25), 1.75);
  assert.equal(tools.percentile([1, 2, 3, 4], 50), 2.5);
  assert.equal(tools.percentile([1, 2, 3, 4], 75), 3.25);
  assert.equal(tools.percentile([10, 20], 0), 10);
  assert.equal(tools.percentile([10, 20], 100), 20);
  assert.equal(tools.percentile([], 50), null);
});

test('parseMatrix reads rows and rejects ragged input', () => {
  assert.deepEqual(tools.parseMatrix('1, 2; 3, 4'), [[1, 2], [3, 4]]);
  assert.deepEqual(tools.parseMatrix('1 2\n3 4'), [[1, 2], [3, 4]]);
  assert.equal(tools.parseMatrix('1, 2; 3'), null);
  assert.equal(tools.parseMatrix('a, b'), null);
});

test('matmul contracts inner dimensions and refuses the rest', () => {
  assert.deepEqual(tools.matmul([[1, 2], [3, 4]], [[5, 6], [7, 8]]), [[19, 22], [43, 50]]);
  assert.deepEqual(tools.matmul([[1, 2, 3]], [[1], [2], [3]]), [[14]]);
  assert.deepEqual(tools.matmul([[1, 2], [3, 4]], [[1], [2]]), [[5], [11]]);
  assert.equal(tools.matmul([[1, 2]], [[1, 2]]), null);
  assert.deepEqual(tools.transpose([[1, 2, 3], [4, 5, 6]]), [[1, 4], [2, 5], [3, 6]]);
});

test('sliceIndices matches Python slice semantics including negative steps', () => {
  const all = tools.sliceIndices(10, null, null, 1).indices;
  assert.deepEqual(all, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(tools.sliceIndices(10, 2, 8, 2).indices, [2, 4, 6]);
  assert.deepEqual(tools.sliceIndices(10, null, null, -1).indices, [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.deepEqual(tools.sliceIndices(10, -3, null, 1).indices, [7, 8, 9]);
  assert.deepEqual(tools.sliceIndices(10, null, 4, 1).indices, [0, 1, 2, 3]);
  assert.deepEqual(tools.sliceIndices(0, null, null, 1).indices, []);
  assert.equal(tools.sliceIndices(5, 0, 5, 0).error, 'step must be a non-zero whole number');
});

test('maskFilter builds the mask and the selected values', () => {
  const r = tools.maskFilter([4, 11, 10, 15, 3], '>', 10);
  assert.deepEqual(r.mask, [false, true, false, true, false]);
  assert.deepEqual(r.selected, [11, 15]);
  assert.deepEqual(tools.maskFilter([1, 2, 2], '==', 2).selected, [2, 2]);
  assert.deepEqual(tools.maskFilter([1, 2], '>=', 2).selected, [2]);
});

test('reshapeGrid maps C-order flat indices and rejects bad shapes', () => {
  assert.deepEqual(tools.reshapeGrid(2, 3), [[0, 1, 2], [3, 4, 5]]);
  assert.deepEqual(tools.reshapeGrid(0, 3), []);
  assert.deepEqual(tools.reshapeGrid(2, -1), []);
});

test('dtypeMemory multiplies itemsize by count and formats it', () => {
  assert.equal(tools.dtypeMemory('int64', 5).bytes, 40);
  assert.equal(tools.dtypeMemory('float32', 1000).bytes, 4000);
  assert.match(tools.dtypeMemory('float32', 1000).readable, /KiB/);
  assert.equal(tools.dtypeMemory('int8', 0).bytes, 0);
  assert.equal(tools.dtypeMemory('complex128', 2).bytes, 32);
  assert.equal(tools.dtypeMemory('int3', 2), null);
});

test('uniformSamples is deterministic per seed and stays in range', () => {
  const a = tools.uniformSamples(42, 5);
  const b = tools.uniformSamples(42, 5);
  const c = tools.uniformSamples(43, 5);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a.length, 5);
  for (const v of a) assert.ok(v >= 0 && v <= 1);
  assert.equal(tools.uniformSamples(1, 0).length, 0);
});

test('missingSummary skips nulls and a sentinel without inventing values', () => {
  const s = tools.missingSummary([1, null, -999, 5], -999);
  assert.equal(s.total, 4);
  assert.equal(s.missing, 2);
  assert.equal(s.present, 2);
  assert.equal(s.meanPresent, 3);
  assert.equal(s.minPresent, 1);
  assert.equal(tools.missingSummary([], null).meanPresent, null);
});
