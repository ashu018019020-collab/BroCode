/**
 * Offline / service-worker policy tests.
 *
 * Regression guard for a real, user-visible bug: a service worker left over from
 * an earlier production run on the same origin served `curriculum/sections.json`
 * CACHE-FIRST, so content fixes were invisible in the browser while the server
 * happily served the new file. The UI just looked broken.
 *
 * The policy now is:
 *   - the worker is registered only in production, and dev actively purges it;
 *   - JSON content packs are network-first, so an update is never shadowed;
 *   - the cache name is versioned, so bumping it discards old entries.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SW = read(path.join('public', 'sw.js'));
const MAIN = read(path.join('src', 'app', 'main.tsx'));
const CURRICULUM_LOADER = read(path.join('src', 'core', 'data', 'curriculum.tsx'));

test('service worker: registers only in production', () => {
  assert.match(MAIN, /if\s*\(import\.meta\.env\.PROD\)/, 'main.tsx must gate registration on PROD');
  assert.match(MAIN, /navigator\.serviceWorker\.register/, 'main.tsx must still register the worker in production');
});

test('service worker: dev mode unregisters the worker and purges its caches', () => {
  assert.match(MAIN, /getRegistrations\(\)/, 'dev must enumerate existing registrations');
  assert.match(MAIN, /\.unregister\(\)/, 'dev must unregister a stale worker');
  assert.match(MAIN, /caches\.delete\(/, 'dev must delete stale cache storage');
});

test('service worker: content packs are network-first, not cache-first', () => {
  // A JSON branch must exist and fetch before consulting the cache.
  const jsonBranch = SW.match(/isContent[\s\S]{0,700}/);
  assert.ok(jsonBranch, 'sw.js must special-case JSON content packs');
  const branch = jsonBranch[0];
  assert.match(branch, /fetch\(req\)/, 'the JSON branch must go to the network first');
  assert.match(branch, /caches\.match\(req\)/, 'the JSON branch must fall back to the cache when offline');
  assert.ok(
    branch.indexOf('fetch(req)') < branch.indexOf('caches.match(req)'),
    'fetch must be attempted before the cache lookup',
  );
  assert.match(SW, /\/generated\//, 'curriculum + question banks (under generated/) must be covered by the content rule');
  assert.match(SW, /\/notebooks/, 'notebook packs must be covered by the content rule');
});

test('service worker: cache name is versioned so a bump discards stale entries', () => {
  const m = SW.match(/const CACHE = '([^']+)'/);
  assert.ok(m, 'sw.js must declare a cache name');
  assert.match(m[1], /-v\d+$/, `cache name should be versioned (got "${m[1]}")`);
  assert.notEqual(m[1], 'aiml-v2', 'the cache that served stale curriculum must not be reused');
  assert.match(SW, /keys\.filter\(\(k\) => k !== CACHE\)/, 'activate must delete other caches');
});

test('curriculum loader: content fetch revalidates instead of trusting the local cache', () => {
  assert.match(CURRICULUM_LOADER, /cache:\s*'no-cache'/, 'the loader must revalidate content packs');
  assert.match(CURRICULUM_LOADER, /sections\.json/, 'the loader must fetch sections.json');
});
