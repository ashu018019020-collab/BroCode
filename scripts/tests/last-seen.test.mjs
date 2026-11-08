import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register('./_ts-resolve.mjs', import.meta.url);
const { formatLastSeen, relativeParts } = await import(pathToFileURL(path.join(ROOT, 'src/core/platform/last-seen.ts')).href);

const now = new Date(2026, 9, 6, 12, 0).getTime();

test('last seen: formats recent activity in minutes and hours', () => {
  assert.equal(formatLastSeen(now, now), 'Just now');
  assert.equal(formatLastSeen(now - 5 * 60_000, now), '5 minutes ago');
  assert.equal(formatLastSeen(now - 2 * 60 * 60_000, now), '2 hours ago');
});

test('last seen: uses local calendar days before switching to the exact date', () => {
  assert.equal(formatLastSeen(new Date(2026, 9, 5, 23, 50).getTime(), now), 'Yesterday');
  assert.equal(formatLastSeen(new Date(2026, 9, 3, 12).getTime(), now), 'Last seen 3 days ago');
  assert.equal(formatLastSeen(new Date(2026, 8, 28, 12).getTime(), now), '28 Sep 2026');
});

test('last seen: refuses invalid timestamps and clamps future timestamps to just now', () => {
  assert.equal(formatLastSeen(Number.NaN, now), 'Unknown');
  assert.equal(formatLastSeen(now + 60_000, now), 'Just now');
});

/**
 * The BUCKETS, driven directly. The dashboard's activity rail and the header's last-seen line both
 * read these, so the thresholds are now one decision instead of two — and each surface supplies its
 * own words. These assertions are the shared thresholds; `formatLastSeen` above is the English
 * rendering of the same parts.
 */
test('relative parts: every surface agrees on where each bucket starts and ends', () => {
  assert.equal(relativeParts(Number.NaN, now), null, 'a non-timestamp has no bucket');
  assert.deepEqual(relativeParts(now + 60_000, now), { unit: 'now', value: 0, date: null }, 'the future clamps to now');
  assert.deepEqual(relativeParts(now - 30_000, now), { unit: 'now', value: 0, date: null });
  assert.deepEqual(relativeParts(now - 59_999, now), { unit: 'now', value: 0, date: null });
  assert.deepEqual(relativeParts(now - 60_000, now), { unit: 'minute', value: 1, date: null });
  assert.deepEqual(relativeParts(now - 5 * 60_000, now), { unit: 'minute', value: 5, date: null });
  assert.deepEqual(relativeParts(now - 59 * 60_000, now), { unit: 'minute', value: 59, date: null });
  assert.deepEqual(relativeParts(now - 60 * 60_000, now), { unit: 'hour', value: 1, date: null });
  assert.deepEqual(relativeParts(now - 2 * 60 * 60_000, now), { unit: 'hour', value: 2, date: null });
});

test('relative parts: calendar days decide "yesterday" and the day count, not 24-hour blocks', () => {
  // 12h10m before noon is still YESTERDAY by the calendar, which is what a learner reads.
  assert.deepEqual(relativeParts(new Date(2026, 9, 5, 23, 50).getTime(), now), { unit: 'yesterday', value: 1, date: null });
  assert.deepEqual(relativeParts(new Date(2026, 9, 3, 12).getTime(), now), { unit: 'day', value: 3, date: null });
  const old = relativeParts(new Date(2026, 8, 28, 12).getTime(), now);
  assert.equal(old.unit, 'date', 'a week or more is an exact date, not "8 d ago"');
  assert.equal(old.date.getFullYear(), 2026);
  assert.equal(old.date.getMonth(), 8);
  assert.equal(old.date.getDate(), 28);
});
