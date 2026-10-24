import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register('./_ts-resolve.mjs', import.meta.url);
const { formatLastSeen } = await import(pathToFileURL(path.join(ROOT, 'src/core/platform/last-seen.ts')).href);

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
