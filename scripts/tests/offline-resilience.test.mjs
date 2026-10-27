/**
 * Offline / weak-network RESILIENCE — the resilience-layer the platform already had, now said
 * OUT LOUD and pinned.
 *
 * What this suite holds (the contract the code must not quietly drop):
 *
 *  1. THE COPY IS A REGISTRY, NOT SCATTERED STRINGS. `core/platform/offline.ts` owns every claim
 *     the offline UI makes. Each "still works" note must name its real mechanism (the service-
 *     worker cache, the bundled runtimes, the device store, the `online` resync), and each
 *     "waits for the network" note must name the fallback the learner gets meanwhile — no
 *     promise the platform cannot keep offline, no shrug about what skips.
 *  2. THE SHELL SHOWS IT. The banner is gated on the browser's own online/offline events, reads
 *     ONLY the registry, is a live status region — and is not a sixth copy of the route table.
 *  3. UNSAVED WORK IS PRESERVED. The interview room's unsubmitted transcript travels in the
 *     sitting draft, committed debounced (not per keystroke — the store's stringify lesson), and
 *     comes back on resume. A network drop may not cost a typed or spoken answer.
 *  4. NO FALSE REMOTE DATA. The service worker's offline miss for never-cached JSON keeps a
 *     NON-OK status with a named error body, so a loader routes it to its error state instead of
 *     parsing a placeholder as truth; the Notebook Lab distinguishes "empty because offline"
 *     from "empty because unpublished".
 *  5. THE QUEUE IS IDEMPOTENT. The one automatic network write — the progress snapshot — is a
 *     full summary rewrite (idempotent, safe to replay) and already re-syncs on the browser's
 *     `online` event; the suite pins that wiring so it cannot rot offline.
 *
 * The browser itself (real network toggling) cannot run under node --test; everything here is
 * source-level contract. That limit is stated, not hidden.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const offline = await load('src/core/platform/offline.ts');

/* ------------------------------ the copy registry ------------------------------ */

test('offline contract: every "still works" note names a mechanism that really exists', () => {
  assert.ok(offline.OFFLINE_CAPABLE.length >= 3, 'the registry is the whole claim, not a sample');
  const mechanisms = /cache|device|inside the app|returns|syncs|browser/i;
  for (const item of offline.OFFLINE_CAPABLE) {
    assert.match(item.note, mechanisms, `${item.id} must name its offline mechanism`);
    assert.doesNotMatch(item.note, /\bAI (mentor|mastery)|cloud|Google Neural/i,
      `${item.id} must not promise a cloud service offline`);
  }
});

test('offline contract: every network-only note names the fallback the learner gets meanwhile', () => {
  assert.ok(offline.NETWORK_ONLY.length >= 3);
  for (const item of offline.NETWORK_ONLY) {
    assert.match(item.note, /rubric|browser|stay signed|cache|wait/i,
      `${item.id} must say what works meanwhile — never a bare "unavailable"`);
  }
});

test('offline contract: the banner copy composes honestly and says nothing was lost', () => {
  const banner = offline.offlineBannerCopy();
  assert.equal(banner.capable, offline.OFFLINE_CAPABLE, 'the banner renders THE registry, not a copy of it');
  assert.equal(banner.waiting, offline.NETWORK_ONLY);
  // The footnote is the load-bearing sentence: a connection drop must never read as data loss.
  assert.match(banner.footnote, /Nothing was lost|device/i);
  assert.match(banner.title, /offline/i);
});

test('offline contract: network failure codes are recognisable and enumerable', () => {
  assert.equal(offline.isNetworkCode('network'), true);
  assert.equal(offline.isNetworkCode('timeout'), true);
  assert.equal(offline.isNetworkCode('api-unreachable'), true);
  for (const honest of ['ai-unconfigured', 'signed-out', 'ai-rate-limited', null, undefined]) {
    assert.equal(offline.isNetworkCode(honest), false,
      `${honest} is a policy state, not a connection state`);
  }
});

/* --------------------------- the shell's banner wiring --------------------------- */

test('shell: the banner is gated on the real network state and renders the registry', () => {
  const app = read('src/app/App.tsx');
  assert.match(app, /\{!online && \(/, 'the banner appears only when the device is offline');
  assert.match(app, /role="status" aria-live="polite"/, 'an announced status region, resurfaced without hunting');
  assert.match(app, /offlineBannerCopy\(\)/, 'the copy comes from the tested contract');
  // No ad-hoc capability claims outside the registry: the shell must not hold its own copy.
  const bannerBlock = app.match(/\{!online && \([\s\S]{0,2600}/)?.[0] ?? '';
  assert.ok(!/still works\s*<\/b>\s*<ul>[\s\S]*?lit/i.test(bannerBlock.replace(/Still working/, '')),
    'the shell renders registry items, not a second claim list');
  // It lives inside the content column, so every route gets it — not hidden behind one page.
  assert.ok(bannerBlock.includes('net-banner'));
});

test('shell: the online flag follows the browser events (and existed before this task)', () => {
  const app = read('src/app/App.tsx');
  assert.match(app, /useState\(\(\) => navigator\.onLine\)/);
  assert.match(app, /addEventListener\('online', updateOnline\)/);
  assert.match(app, /addEventListener\('offline', updateOnline\)/);
  // Cleanup: an unremoved listener would leak one per navigation impossible here (shell mounts
  // once), but the pattern is still pinned so copy-pasted hooks can never leak.
  assert.match(app, /removeEventListener\('online', updateOnline\)/);
});

/* ------------------- the interview room's unsaved-work guarantee ------------------- */

test('interview room: an UNSUBMITTED transcript is part of the saved sitting', () => {
  const page = read('src/features/interview/InterviewMode.tsx');
  assert.match(page, /answer: draftRef\.current/, 'the transcript rides in the draft record');
  // Debounced — one stringify per pause, never per keystroke (the store's own measured lesson).
  assert.match(page, /window\.setTimeout\(commitDraft, \d+\)/, 'typing commits on a delay');
  assert.doesNotMatch(page, /onChange=\{[^}]*commitDraft\)/, 'the keystroke itself never stringifies the sitting');
  // And it comes back.
  assert.match(page, /saved\.answer/, 'resume returns the unsubmitted transcript');
  assert.match(page, /setDraft\(typeof saved\.answer === 'string' \? saved\.answer : ''\)/);
});

test('interview room: the offline note is the tested contract, shown as a status not an error', () => {
  const page = read('src/features/interview/InterviewMode.tsx');
  assert.match(page, /offlineRoomNote\(\)/, 'the room reuses the registry line');
  assert.match(page, /\{!online && <span className="chip iv-offline-chip">Offline · device save<\/span>\}/,
    'the header names the offline state next to the round state');
  // The offline note is amber-styled and a live status — attention, not alarm.
  assert.match(page, /className="iv-perm iv-offline-note" role="status"/);
  const css = read('src/features/interview/interview-room.css');
  assert.match(css, /\.iv-offline-chip/, 'and the chip is styled in the scoped interview sheet');
});

/* ----------------------------- no false remote data ----------------------------- */

test('service worker: an offline miss for never-cached JSON cannot be parsed as real data', () => {
  const sw = read('public/sw.js');
  // The `[]` body was the bug: a loader that read the body without the status would see a
  // VALID empty array and print "no content" as if it were content.
  assert.doesNotMatch(sw, /new Response\('\[\]'/, 'the old empty-array fallback is gone');
  assert.match(sw, /status: 504/, 'the miss stays non-OK so response.ok is false');
  assert.match(sw, /error: 'offline-never-cached'/, 'the body names its own condition');
  // And the sw still only ever touches GET — a non-idempotent POST is never cached or replayed.
  assert.match(sw, /req\.method !== 'GET'\) return;/);
});

test('service worker: the established network-first policy still stands', () => {
  // Mirror of offline.test.cjs' own pins, asserted here so a later edit that flips the strategy
  // fails BOTH suites instead of just the one nobody re-reads.
  const sw = read('public/sw.js');
  const branch = sw.match(/isContent[\s\S]{0,900}/)?.[0] ?? '';
  assert.ok(branch.indexOf('fetch(req)') >= 0 && branch.indexOf('fetch(req)') < branch.indexOf('caches.match(req)'),
    'content packs stay network-first with a cache fallback');
});

test('notebook lab: an empty library OFFLINE is not the same page as "nothing published"', () => {
  const lab = read('src/features/labs/NotebookLab.tsx');
  assert.match(lab, /useOnlineStatus\(\)/, 'the lab reads the network state');
  assert.match(lab, /reconnect once so the lab can fetch its list/,
    'the offline empty state names the recovery instead of inventing false data');
});

/* ---------------------- the idempotent-queue decision, pinned ---------------------- */

test('account sync: the one background write is a full-summary rewrite and replays on reconnect', () => {
  const provider = read('src/core/auth/AuthProvider.tsx');
  // Idempotency: the summary is the WHOLE snapshot, so a replay can never double-count — the
  // queue is this rewrite, not an event log.
  assert.match(provider, /summarizeProgress\(stateSnapshot\(\)\)/,
    'the snapshot is rebuilt from the store every time, never appended');
  assert.match(provider, /serialized === lastSent\.current\) return;/,
    'an unchanged summary is not resent — the write is idempotent in practice too');
  // Reconnect: the browser event drives the retry, no polling loop and no lost work.
  assert.match(provider, /addEventListener\('online', syncWhenOnline\)/);
  assert.match(provider, /if \(!navigator\.onLine\) \{[\s\S]{0,220}status: 'offline'/,
    'offline is a REPORTED state, not a silent skip');
});

test('account sync: a failed sync still reports the local truth', () => {
  // The statusbar's copy says where the data is when the cloud is not: on the device.
  const app = read('src/app/App.tsx');
  assert.match(app, /Your local progress is still available\./,
    'a sync error must not read as lost progress');
});
