/**
 * The numbers the voice health dashboard shows, and the rules that make them honest.
 *
 * The aggregation is pure (`src/core/platform/voice-telemetry.ts`), so it is driven here with
 * fixtures: per-engine counts, the share of answers that fell back, nearest-rank percentiles, the
 * latency cap, and the two rules that keep the page truthful — an unknown share is null rather than
 * 0%, and a corrupt record is discarded instead of being trusted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const t = await load('src/core/platform/voice-telemetry.ts');

/* ------------------------------- recording ------------------------------- */

test('voice telemetry: an answer is counted for the engine that actually spoke', () => {
  let state = t.emptyVoiceTelemetry();
  state = t.recordVoiceAnswer(state, { engine: 'supertonic', latencyMs: 1200, at: 1000 });
  state = t.recordVoiceAnswer(state, { engine: 'supertonic', latencyMs: 800, at: 2000 });
  state = t.recordVoiceAnswer(state, { engine: 'browser', at: 3000 });
  const summary = t.summarizeVoiceTelemetry(state);
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.byEngine, { supertonic: 2, google: 0, browser: 1 });
  // 2 server answers out of 3, and one fallback of 3.
  assert.equal(summary.serverShare, 2 / 3);
  assert.equal(summary.browserShare, 1 / 3);
  // A browser answer contributes no latency sample: there is no request to time.
  assert.equal(summary.samples, 2);
  assert.equal(summary.lastAt, 3000);
});

test('voice telemetry: nothing spoken yet is unknown, never 0%', () => {
  const summary = t.summarizeVoiceTelemetry(t.emptyVoiceTelemetry());
  assert.equal(summary.total, 0);
  assert.equal(summary.browserShare, null);
  assert.equal(summary.serverShare, null);
  assert.equal(summary.p50, null, 'no samples means no percentile, not zero ms');
  assert.equal(summary.p95, null);
  assert.equal(summary.lastAt, null);
});

test('voice telemetry: latency samples are capped and percentiles are nearest-rank', () => {
  let state = t.emptyVoiceTelemetry();
  for (let i = 1; i <= 60; i += 1) state = t.recordVoiceAnswer(state, { engine: 'google', latencyMs: i * 10 });
  assert.equal(state.latencyMs.length, t.VOICE_LATENCY_SAMPLES, 'a counter may not grow without bound');
  // The oldest samples fall off the front: 21…60 * 10.
  assert.equal(state.latencyMs[0], (60 - t.VOICE_LATENCY_SAMPLES + 1) * 10);
  const summary = t.summarizeVoiceTelemetry(state);
  assert.equal(summary.samples, t.VOICE_LATENCY_SAMPLES);
  assert.ok(summary.p50 !== null && summary.p95 !== null && summary.p95 >= summary.p50);
  assert.equal(t.percentile([10, 20, 30, 40], 50), 20);
  assert.equal(t.percentile([10, 20, 30, 40], 95), 40);
  assert.equal(t.percentile([], 50), null);
});

test('voice telemetry: failures are counted by short code, sorted, and never carry text', () => {
  let state = t.emptyVoiceTelemetry();
  state = t.recordVoiceFailure(state, { code: 'tts-503' });
  state = t.recordVoiceFailure(state, { code: 'tts-503' });
  state = t.recordVoiceFailure(state, { code: 'tts-network' });
  state = t.recordVoiceFailure(state, { code: 'x'.repeat(80) });
  const summary = t.summarizeVoiceTelemetry(state);
  assert.equal(summary.failureTotal, 4);
  assert.deepEqual(summary.failures[0], { code: 'tts-503', count: 2 });
  const codes = summary.failures.map((entry) => entry.code);
  assert.ok(codes.includes('x'.repeat(24)), 'a code is a token, truncated rather than stored whole');
  assert.ok(!codes.some((code) => code.length > 24));
});

/* -------------------------------- parsing -------------------------------- */

test('voice telemetry: a corrupt or foreign record is discarded, not trusted', () => {
  assert.deepEqual(t.parseVoiceTelemetry(null), t.emptyVoiceTelemetry());
  assert.deepEqual(t.parseVoiceTelemetry('not json'), t.emptyVoiceTelemetry());
  assert.deepEqual(t.parseVoiceTelemetry(JSON.stringify({ version: 2, answers: { browser: 9 } })), t.emptyVoiceTelemetry());
  const partial = t.parseVoiceTelemetry(JSON.stringify({
    version: 1,
    answers: { supertonic: 3, browser: -1, google: 'x' },
    failures: { 'tts-500': 2, broken: 'many' },
    latencyMs: [100, NaN, -5, 200, 1e9, 'x'],
    lastAt: 1234,
  }));
  assert.deepEqual(partial.answers, { supertonic: 3, google: 0, browser: 0 });
  assert.deepEqual(partial.failures, { 'tts-500': 2 });
  assert.deepEqual(partial.latencyMs, [100, 200], 'only finite, plausible milliseconds survive');
  assert.equal(partial.lastAt, 1234);
});

/* ----------------------------- the dashboard ----------------------------- */

test('voice health page: reports deployment readiness and device-local counts separately', () => {
  const source = read('src/features/ops/VoiceHealth.tsx');
  assert.match(source, /makePath|api\/voice\/health|\.\/api\/voice\/health/, 'it reads the real health route');
  assert.match(source, /api\/voice\/status|\.\/api\/voice\/status/);
  assert.match(source, /readVoiceTelemetry/);
  // The two halves are named, so no reader mistakes a browser count for a site-wide one.
  assert.match(source, /Deployment/);
  assert.match(source, /This browser/);
  // A share with no answers must not print 0%.
  assert.match(source, /value === null \? '—'/);
  // "Verified" is only claimed when the engine really answered.
  assert.match(source, /health\?\.verified === true/);
  // It must not claim a site-wide aggregate it cannot back.
  assert.match(source, /this device only/i);
});

test('voice health page: the route is registered, protected and reachable from search', () => {
  const app = read('src/app/App.tsx');
  assert.match(app, /const VoiceHealth = lazy\(\(\) => import\('\.\.\/features\/ops\/VoiceHealth'\)\)/);
  assert.match(app, /<Route path="\/voice-health" element=\{<Protect><VoiceHealth \/><\/Protect>\} \/>/);
  assert.match(app, /\{ to: '\/voice-health'.*sidebar: false \}/, 'an operator page is not a sidebar entry');
  assert.match(read('src/core/platform/search.ts'), /route: '\/voice-health'/);
  assert.match(read('src/core/learning/paths.ts'), /'\/voice-health'/);
});

test('voice telemetry: the voice hook records what actually spoke, after playback', () => {
  const hook = read('src/components/shared/useVoiceTutor.ts');
  assert.match(hook, /noteVoiceAnswer\(tag, firstAudioMs \?\? undefined\)/, 'one count per answer, not per chunk');
  // The worker reports its own failure; the hook records the message it carried (a code such as
  // `model-load` or `synth-bad-output`), so the dashboard can separate a download failure from a
  // synthesis failure without guessing from a status line that no longer exists.
  assert.match(hook, /noteVoiceFailure\(String\(\(cause as \{ message\?: string \}\)\?\.message/, 'a failure keeps the engine\'s code');
  // The measurement is around the real request.
  assert.match(hook, /performance\.now\(\)/);
  // Telemetry must never be able to break playback: the storage shim swallows its own errors.
  assert.match(read('src/core/storage/voice-telemetry.ts'), /catch \{[\s\S]*?\/\/ Quota or a private-mode browser/);
});
