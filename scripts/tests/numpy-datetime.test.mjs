/**
 * datetime64 arithmetic and fixed-width string arrays.
 *
 * The explorer must show computed answers, so these tests check the pure helpers against real NumPy
 * calls (dtype width, character lengths, sorting, truncation and unit conversion) and pin the strict
 * date parser that keeps an impossible date from becoming a different day.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register('./_ts-resolve.mjs', import.meta.url);

const tt = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/numpy-text-time.ts')).href);

test('parseDateValue accepts dates and date-times, rejects impossible ones', () => {
  assert.equal(tt.parseDateValue('2026-01-01').iso, '2026-01-01');
  assert.equal(tt.parseDateValue('2026-01-01T09:30').iso, '2026-01-01T09:30:00');
  assert.equal(tt.parseDateValue('2026-02-30'), null);
  assert.equal(tt.parseDateValue('01/02/2026'), null);
  assert.equal(tt.parseDateValue(''), null);
});

test('date difference and shift use the chosen unit', () => {
  assert.equal(tt.dateDifference('2026-01-01', '2026-03-01', 'D'), 59);
  assert.equal(tt.dateDifference('2026-01-01', '2026-01-02', 's'), 86400);
  assert.equal(tt.dateDifference('2026-01-01', '2026-01-01', 'ms'), 0);
  assert.equal(tt.dateDifference('bad', '2026-01-01', 'D'), null);
  assert.equal(tt.shiftDate('2026-01-01', 45, 'D'), '2026-02-15');
  assert.equal(tt.shiftDate('2026-01-01', -1, 'D'), '2025-12-31');
});

test('a day span also reads as weeks, hours and minutes', () => {
  const span = tt.dateSpan('2026-01-01', '2026-03-01');
  assert.equal(span.days, 59);
  assert.equal(span.hours, 1416);
  assert.equal(span.minutes, 84960);
  assert.ok(Math.abs(span.weeks - 59 / 7) < 1e-12);
  assert.equal(tt.dateSpan('2026-01-01T09:30', '2026-01-02T09:30').minutes, 1440);
  assert.equal(tt.dateSpan('bad', '2026-01-01'), null);
  assert.equal(tt.dateSpan('2026-01-01', '2026-01-01').weeks, 0);
});

test('string helpers follow fixed-width dtype rules', () => {
  const names = ['ada', 'bob', 'cy'];
  assert.equal(tt.stringDtype(names), '<U3');
  assert.equal(tt.stringDtype(['a', 'longer']), '<U6');
  assert.deepEqual(tt.charLengths(names), [3, 3, 2]);
  assert.deepEqual(tt.upperAll(names), ['ADA', 'BOB', 'CY']);
  assert.deepEqual(tt.truncateAll(names, 2), ['ad', 'bo', 'cy']);
  assert.deepEqual(tt.sortedStrings(names), ['ada', 'bob', 'cy']);
  assert.deepEqual(tt.parseStringList(' ada, bob ,, cy '), ['ada', 'bob', 'cy']);
  assert.equal(tt.stringSummary(names).totalChars, 8);
});

test('helpers agree with real numpy', () => {
  const probe = spawnSync('python3', ['-c', [
    'import json, numpy as np',
    'names = ["ada", "bob", "cy"]',
    'a = np.array(names)',
    'print(json.dumps({',
    '  "dtype": a.dtype.str,',
    '  "lengths": np.char.str_len(names).tolist(),',
    '  "upper": np.char.upper(names).tolist(),',
    '  "sorted": np.sort(a).tolist(),',
    '  "trunc": a.astype("<U2").tolist(),',
    '  "diffD": int((np.datetime64("2026-03-01") - np.datetime64("2026-01-01")) / np.timedelta64(1, "D")),',
    '  "diffS": int((np.datetime64("2026-01-02") - np.datetime64("2026-01-01")) / np.timedelta64(1, "s")),',
    '  "shift": str(np.datetime64("2026-01-01") + np.timedelta64(45, "D"))',
    '}))',
  ].join('\n')], { encoding: 'utf8' });
  if (probe.status !== 0) {
    if (/No module named 'numpy'/.test(probe.stderr) || probe.error) {
      console.log('numpy-not-available: datetime/string parity not executed');
      return;
    }
    assert.fail(`numpy probe failed: ${probe.stderr}`);
  }
  const np = JSON.parse(probe.stdout);
  const names = ['ada', 'bob', 'cy'];
  assert.equal(tt.stringDtype(names), np.dtype);
  assert.deepEqual(tt.charLengths(names), np.lengths);
  assert.deepEqual(tt.upperAll(names), np.upper);
  assert.deepEqual(tt.sortedStrings(names), np.sorted);
  assert.deepEqual(tt.truncateAll(names, 2), np.trunc);
  assert.equal(tt.dateDifference('2026-01-01', '2026-03-01', 'D'), np.diffD);
  assert.equal(tt.dateDifference('2026-01-01', '2026-01-02', 's'), np.diffS);
  assert.equal(tt.shiftDate('2026-01-01', 45, 'D'), np.shift);
});

test('the data-types module lessons link to the explorer tab', () => {
  const workspace = fs.readFileSync(path.join(ROOT, 'src/features/numpy-mastery/NWorkspace.tsx'), 'utf8');
  const tools = fs.readFileSync(path.join(ROOT, 'src/features/numpy-mastery/NTools.tsx'), 'utf8');
  assert.match(workspace, /module\.id === 'n04' && section === 'learn'/,
    'the link belongs to the advanced-dtypes Learn section');
  assert.match(workspace, /\/numpy\?module=n04&section=learn&tool=datetime/,
    'the link must carry the explorer tab, not just the module');
  assert.match(tools, /params\.get\('tool'\)/, 'the tools panel must read the tool param');
  assert.match(tools, /scrollIntoView/, 'a deep link must bring the panel into view');
});
