/**
 * The count-up maths behind the animated KPI numbers (Question Bank, and any surface that counts
 * a figure up on mount).
 *
 * Why it needs its own test: the animation is driven from `src/features/practice/QuestionBank.tsx`, and no test
 * can import a `.tsx` file (`_ts-resolve.mjs` appends `.ts` only), so the property that actually
 * matters — a counter lands on the real figure, never near it, and never prints `NaN` — is asserted
 * here instead of on the page.
 *
 * Zero dependencies — node:test, `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const { clamp01, countDuration, countValue, easeOutCubic } = await load('src/core/platform/anim.ts');

test('anim: a count-up starts at the old value, ends at the new one, and never passes it', () => {
  assert.equal(countValue(0, 13865, 0), 0, 'the first frame is the value it counts from');
  assert.equal(countValue(0, 13865, 1), 13865, 'the last frame is the real number, not 13,864');
  assert.equal(countValue(120, 80, 1), 80, 'a count can run downwards too');

  // Monotonic: a counter that dips mid-flight reads as a glitch, and one that passes its target is
  // a number bigger than the truth on screen.
  let prev = countValue(0, 635, 0);
  for (let i = 1; i <= 60; i++) {
    const v = countValue(0, 635, i / 60);
    assert.ok(v >= prev, `frame ${i} went backwards (${prev} → ${v})`);
    assert.ok(v <= 635, `frame ${i} overshot the target: ${v}`);
    prev = v;
  }
  assert.equal(prev, 635);
});

test('anim: easing is anchored at both ends and clamps a frame that ran late', () => {
  assert.equal(clamp01(-0.4), 0);
  assert.equal(clamp01(1.4), 1);
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  // A throttled frame — an unfocused window fires rAF about once a second — arrives after the
  // duration. It must land on the end of the range, not past it.
  assert.equal(easeOutCubic(3), 1);
  assert.ok(easeOutCubic(0.5) > 0.5, 'the ease must be ahead of linear, not behind it');
});

test('anim: a number that cannot be counted falls back to the truth, never to NaN', () => {
  assert.equal(countValue(Number.NaN, 42, 0.5), 42, 'a bad start must not poison the result');
  assert.ok(!Number.isNaN(countValue(0, 7, 0.5)));
  assert.ok(!Number.isNaN(countValue(0, 7, Number.NaN)), 'a NaN clock still has to print a number');

  assert.equal(countDuration(5, 5), 0, 'no delta, no animation');
  assert.equal(countDuration(0, 2), 0, 'counting to 2 is not worth a frame loop');
  assert.equal(countDuration(0, 13865), 900);
  assert.equal(countDuration(120, 80), 900, 'a shorter distance is still a real count');
});
