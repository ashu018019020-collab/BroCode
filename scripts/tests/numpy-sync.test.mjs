/**
 * The NumPy sync contract: only the course's own keys travel, local records win, and the payload stays
 * inside the server's budget. The server validates the same allowlist, so a regression here would
 * either leak unrelated progress or silently drop a section.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register('./_ts-resolve.mjs', import.meta.url);
const sync = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/numpy-sync.ts')).href);

test('only NumPy key families are collected', () => {
  const payload = sync.collectNumpyProgress({
    'nmod:n01:learn': { done: true, tries: 1 },
    'nans:e-1': { answer: 'because strides' },
    'ntick:e-1': { answer: '[true,false]' },
    ncap: { answer: '["axis"]' },
    nlast: { answer: 'n02:learn' },
    nlevel: { answer: 'pro' },
    'bank:q1': { done: true },
    xp: { done: true },
  });
  assert.deepEqual(Object.keys(payload).sort(), ['nans:e-1', 'ncap', 'nlast', 'nlevel', 'nmod:n01:learn', 'ntick:e-1']);
});

test('long drafts are truncated, not rejected, on the way out', () => {
  const long = 'x'.repeat(sync.NUMPY_SYNC_MAX_TEXT + 500);
  const payload = sync.collectNumpyProgress({ 'nans:e-9': { answer: long } });
  assert.equal(payload['nans:e-9'].answer.length, sync.NUMPY_SYNC_MAX_TEXT);
});

test('merge keeps local records and fills gaps from the server', () => {
  const local = { 'nmod:n01:learn': { done: true } };
  const remote = { 'nmod:n01:learn': { done: true, tries: 9 }, 'nmod:n02:learn': { done: true } };
  const { payload, added } = sync.mergeNumpyProgress(local, remote);
  assert.equal(payload['nmod:n01:learn'].tries, undefined, 'local record must not be overwritten');
  assert.equal(payload['nmod:n02:learn'].done, true, 'missing record must be added');
  assert.deepEqual(added, ['nmod:n02:learn']);
  assert.deepEqual(sync.mergeNumpyProgress(local, null).payload, local);
});

test('payload validation mirrors the allowlist and the byte budget', () => {
  assert.equal(sync.isValidNumpyPayload({ 'nmod:n01:learn': { done: true } }), true);
  assert.equal(sync.isValidNumpyPayload({ 'bank:q1': { done: true } }), false);
  assert.equal(sync.isValidNumpyPayload({ 'nmod:x': 'nope' }), false);
  assert.equal(sync.isValidNumpyPayload({ 'nans:x': { answer: 'y'.repeat(sync.NUMPY_SYNC_MAX_TEXT + 1) } }), false);
  assert.equal(sync.isValidNumpyPayload(null), false);
  assert.equal(sync.isValidNumpyPayload([]), false);
});

test('the summary names what would be synced', () => {
  const summary = sync.numpySyncSummary({ 'nmod:a': {}, 'nmod:b': {}, 'nans:x': {}, ncap: {} });
  assert.equal(summary, '2 sections · 1 drafts');
});
