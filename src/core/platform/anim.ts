/**
 * Counting maths for the surfaces that animate a number on mount, in its own module because it is
 * the only part of that animation a test can reach: `scripts/tests/_ts-resolve.mjs` resolves `.ts`
 * only, so nothing inside a `.tsx` page is importable by the suite. The page owns the frame loop;
 * everything here is pure.
 *
 * The rule these functions exist to protect: an animated number must land on the REAL value, never
 * near it. A count-up that stops at 99 of 100 is a lying dashboard, so the last frame is expected
 * to come from the page snapping to the target — `countValue` is only ever asked for the frames
 * before that.
 */

/**
 * Progress of an animation, clamped so a slow frame can never overshoot the end. Written as
 * `!(t > 0)` rather than `t < 0` on purpose: a `NaN` clock (a rAF timestamp that never arrived)
 * has to read as "not started yet", because every comparison against NaN is false and the naive
 * form would let the NaN through and paint `NaN` over a real figure.
 */
export const clamp01 = (t: number): number => (!(t > 0) ? 0 : t > 1 ? 1 : t);

/** Fast at the start, easing into the target — the shape a counter reads best at. */
export const easeOutCubic = (t: number): number => 1 - (1 - clamp01(t)) ** 3;

/**
 * One frame of a count-up, rounded for display (a counter that flickers through `13864.9982`
 * reads as a bug, not as progress). A non-finite input returns `to` untouched: a broken number
 * must never print `NaN` where a real figure belongs.
 */
export function countValue(from: number, to: number, t: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return to;
  return Math.round(from + (to - from) * easeOutCubic(t));
}

/**
 * How long a count should run for, in milliseconds. Long enough to be legible, short enough not to
 * hold the page hostage; a tiny delta is a pointless animation, so it is allowed to finish at once.
 */
export function countDuration(from: number, to: number, full = 900): number {
  const delta = Math.abs(to - from);
  if (!Number.isFinite(delta) || delta === 0) return 0;
  if (delta < 3) return 0;
  return full;
}
