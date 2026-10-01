/**
 * The study-time session tracker — how "kis date par kitna padha" gets recorded at all.
 *
 * A page can only measure the time it is open, so this counts the time the app is open AND being
 * used, and writes it to the day bucket the dashboard reads. Three rules make that measurement
 * honest rather than optimistic:
 *
 *   · VISIBLE only. A tab in the background is not a study session, whatever the wall clock says.
 *   · USE, not presence. After `IDLE_MS` without a single pointer, key or wheel event, counting
 *     stops until the next one — so a tab left open overnight banks a few minutes at most instead of
 *     eight hours. The trade-off is deliberate: reading a lesson for longer than that without
 *     touching anything is possible, and losing those minutes is better than reporting a night's
 *     sleep as a night's work.
 *   · LATE TIMERS ARE NOT TIME. Every tick is clamped to `MAX_TICK_SECONDS` (engine/study.ts), so a
 *     throttled background window — where a 1 s timer fires once a minute — cannot bank the minute.
 *
 * It writes on a slow interval and on the way out (`pagehide`), never per tick. `setState`
 * serialises the whole state and writes localStorage synchronously, so one write per second would
 * cost a full `JSON.stringify` per second for a number that only matters when the dashboard opens.
 *
 * Mounted once from `main.tsx`, at module scope, next to the spotlight: it must outlive every route
 * and must not be duplicated by React's StrictMode double-mount.
 */
import { addStudySeconds, today } from './store';
import { MAX_TICK_SECONDS } from '../learning/study';

/** How often the clock is sampled. Cheap: it only does arithmetic, no writes. */
const TICK_MS = 1000;
/** How often the measured time reaches the store. One localStorage write per this, at most. */
const FLUSH_MS = 30_000;
/** No input for this long and the session is over until the next event. */
const IDLE_MS = 3 * 60_000;

/** Input events that mean "still here". `pointermove` covers reading with a hand on the mouse. */
const ACTIVITY: (keyof DocumentEventMap)[] = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];

export function mountStudyTracker(): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};

  /** Seconds measured but not yet stored, including a sub-second remainder across flushes. */
  let pending = 0;
  let lastSample = Date.now();
  let lastActive = Date.now();

  const markActive = () => { lastActive = Date.now(); };
  for (const e of ACTIVITY) document.addEventListener(e, markActive, { passive: true, capture: true });

  const sample = () => {
    const now = Date.now();
    const elapsed = (now - lastSample) / 1000;
    lastSample = now;
    if (document.visibilityState !== 'visible') return;
    if (now - lastActive > IDLE_MS) return;
    pending += Math.min(elapsed, MAX_TICK_SECONDS);
  };

  const flush = () => {
    const whole = Math.floor(pending);
    if (whole < 1) return;
    pending -= whole;
    addStudySeconds(whole, today());
  };

  /** Leaving counts the seconds since the last tick, then stores them — a closed tab keeps its time. */
  const onHide = () => { sample(); flush(); };

  const tick = window.setInterval(sample, TICK_MS);
  const timer = window.setInterval(flush, FLUSH_MS);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  window.addEventListener('beforeunload', onHide);

  return () => {
    sample();
    flush();
    window.clearInterval(tick);
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('beforeunload', onHide);
    for (const e of ACTIVITY) document.removeEventListener(e, markActive, { capture: true });
  };
}
