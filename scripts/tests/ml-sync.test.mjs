/**
 * The ML sync contract: the ML `mmod:` family and the exact `mcap` checklist travel, local section
 * records win, and capstone ticks are unioned so a certificate pass survives a device switch. The
 * payload stays inside the same budget as NumPy without ever accepting a NumPy key. The server and
 * migration enforce the same allowlist, so a regression here would either leak unrelated progress
 * or let one course overwrite the other.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register('./_ts-resolve.mjs', import.meta.url);
const sync = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/ml-sync.ts')).href);
const mcourse = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/mcourse.ts')).href);

test('only the ML mmod family and the mcap checklist are collected', () => {
  const payload = sync.collectMlProgress({
    'mmod:ml01:learn': { done: true, tries: 1 },
    mcap: { answer: '["Decision frame"]' },
    'nmod:n01:learn': { done: true },
    'nans:e-1': { answer: 'must not travel with ML' },
    'ntick:e-1': { answer: '[true,false]' },
    ncap: { answer: '["axis"]' },
    'bank:q1': { done: true },
  });
  assert.deepEqual(Object.keys(payload).sort(), ['mcap', 'mmod:ml01:learn']);
});

test('long values are truncated on the way out', () => {
  const long = 'x'.repeat(sync.ML_SYNC_MAX_TEXT + 500);
  const payload = sync.collectMlProgress({ 'mmod:ml01:learn': { answer: long } });
  assert.equal(payload['mmod:ml01:learn'].answer.length, sync.ML_SYNC_MAX_TEXT);
});

test('merge keeps local ML records, fills remote gaps, and filters other families', () => {
  const local = { 'mmod:ml01:learn': { done: true } };
  const remote = {
    'mmod:ml01:learn': { done: true, tries: 9 },
    'mmod:ml02:learn': { done: true },
    'nmod:n01:learn': { done: true },
  };
  const { payload, added } = sync.mergeMlProgress(local, remote);
  assert.equal(payload['mmod:ml01:learn'].tries, undefined, 'local record must not be overwritten');
  assert.equal(payload['mmod:ml02:learn'].done, true, 'missing record must be added');
  assert.equal('nmod:n01:learn' in payload, false, 'NumPy keys must never enter the ML payload');
  assert.deepEqual(added, ['mmod:ml02:learn']);
  assert.deepEqual(sync.mergeMlProgress(local, null).payload, local);
});

test('payload validation mirrors the ML allowlist and byte budget', () => {
  assert.equal(sync.isValidMlPayload({ 'mmod:ml01:learn': { done: true } }), true);
  assert.equal(sync.isValidMlPayload({ mcap: { answer: '["Decision frame"]' } }), true);
  assert.equal(sync.isValidMlPayload({ 'nmod:n01:learn': { done: true } }), false);
  assert.equal(sync.isValidMlPayload({ ncap: { answer: '["axis"]' } }), false);
  assert.equal(sync.isValidMlPayload({ 'mmod:ml01:learn': 'nope' }), false);
  assert.equal(sync.isValidMlPayload({ 'mmod:ml01:learn': { answer: 'y'.repeat(sync.ML_SYNC_MAX_TEXT + 1) } }), false);
  assert.equal(sync.isValidMlPayload(null), false);
  assert.equal(sync.isValidMlPayload([]), false);
});

test('capstone ticks from two devices are unioned instead of last-writer-wins', () => {
  const local = { mcap: { answer: '["Decision frame","Baseline and metric"]' } };
  const remote = {
    mcap: { answer: '["Baseline and metric","Reproducibility"]' },
    'mmod:ml02:learn': { done: true },
  };
  const { payload, added } = sync.mergeMlProgress(local, remote);
  assert.deepEqual(JSON.parse(payload.mcap.answer), ['Decision frame', 'Baseline and metric', 'Reproducibility']);
  assert.ok(added.includes('mcap'), 'a remote tick added to the local checklist must update local state');
  assert.equal(payload['mmod:ml02:learn'].done, true);
});

test('NumPy capstone ticks never enter the ML payload', () => {
  const { payload } = sync.mergeMlProgress(
    { mcap: { answer: '["Decision frame"]' } },
    { ncap: { answer: '["axis"]' }, 'nmod:n01:learn': { done: true } },
  );
  assert.equal('ncap' in payload, false);
  assert.equal('nmod:n01:learn' in payload, false);
  assert.deepEqual(JSON.parse(payload.mcap.answer), ['Decision frame']);
});

test('the summary names ML section records and the synced capstone checklist', () => {
  assert.equal(sync.mlSyncSummary({ 'mmod:a': {}, 'mmod:b': {} }), '2 sections');
  assert.equal(sync.mlSyncSummary({ 'mmod:a': {} }), '1 section');
  assert.equal(sync.mlSyncSummary({ mcap: { answer: '["Decision frame"]' } }), '0 sections · capstone');
});

test('a module completed on another device survives the ML merge', () => {
  const sections = ['learn', 'interview', 'coding', 'logic', 'debug', 'practice', 'miniProject', 'projectLab', 'defense', 'checkpoint'];
  const remote = Object.fromEntries(sections.map((section) => [`mmod:ml07:${section}`, { done: true }]));
  const { payload, added } = sync.mergeMlProgress({}, remote);
  assert.equal(added.length, 10, 'every remote section is a gap on this device');
  assert.equal(mcourse.mIsModuleComplete('ml07', payload), true,
    'the merged mmod payload still counts as a completed ML module');
  assert.equal(mcourse.mIsModuleComplete('n07', payload), false,
    'the NumPy module with the same section names must not be completed by ML keys');
});
