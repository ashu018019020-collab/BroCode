/**
 * Pointer-tracked spotlight — the light that follows the cursor across a card.
 *
 * Everything visual is CSS (see the SPOTLIGHT section at the end of `styles.css`); this module only
 * keeps two custom properties — `--spot-x` / `--spot-y` — pointed at the cursor. One delegated
 * listener pair on `document` serves the whole app, so nothing has to be wired into a card, a tile
 * or a route: any surface that gains the layer gets the light.
 *
 * Three of the choices here are the point of the module:
 *
 *   · No React state. A per-move `useState` would re-render every card on the page at 60 Hz, and
 *     `offline/store.ts` serialises the WHOLE state to localStorage on every `setState` — so the
 *     glow would cost a full `JSON.stringify` per mouse move. Custom properties never touch it.
 *   · At most one style write per animation frame, on one element, and the box is measured inside
 *     that frame rather than on every event, so a burst of moves collapses to a single layout read.
 *   · Nothing is mounted at all on a coarse pointer or under `prefers-reduced-motion: reduce` — the
 *     CSS is gated by the same two media features, so a phone pays neither a listener nor a layer.
 */

/**
 * Must stay in step with the selector list in the SPOTLIGHT block of `styles.css`.
 * Written as data because this list is the join on every pointer move; a hand-typed query string
 * that drifted from the stylesheet would look like "the feature only works on some pages".
 */
const HOSTS = [
  '.card', '.glass', '.stat', '.stat-card', '.stat-tile', '.tile', '.util-tile', '.back-tile',
  '.stage-card', '.stage-tile', '.track-card', '.path-card', '.ach', '.coach-card', '.plan-row',
  '.tree-ch',
];

const SELECTOR = HOSTS.join(', ');

/**
 * Attach the listener. Returns a detach function; safe to call in any environment (it is a no-op
 * with no DOM, on a coarse pointer, or when the user asked for reduced motion).
 */
export function mountSpotlight(): () => void {
  const noop = () => {};
  if (typeof document === 'undefined' || typeof window === 'undefined') return noop;
  if (typeof window.matchMedia !== 'function') return noop;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return noop;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return noop;

  let host: HTMLElement | null = null;
  let x = 0;
  let y = 0;
  let frame = 0;

  /**
   * One pass per frame, measured against the box as it is right now.
   *
   * Every box the pointer is INSIDE gets the two coordinates, from the innermost one outwards — not
   * just the innermost. `:hover` matches an ancestor too, so a `.card` inside a `.card` (the Question
   * Bank renders 74 of them, 72 nested in one list card) would keep its pool lit while the inner card
   * tracked the cursor, parked at the last coordinate it happened to see. Walking out keeps the whole
   * box family under the pointer, and the walk stops at the first ancestor that is not a host, so it
   * is 1 measure for a plain card and 2–3 for a nested one.
   *
   * Nothing is cleared on the way out: the pool's opacity is driven by `:hover`, so the coordinates a
   * surface was left with are already invisible.
   */
  const paint = () => {
    frame = 0;
    if (!host) return;
    if (!host.isConnected) { host = null; return; }
    for (let el: HTMLElement | null = host; el; el = el.parentElement?.closest(SELECTOR) as HTMLElement | null) {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--spot-x', `${Math.round(x - r.left)}px`);
      el.style.setProperty('--spot-y', `${Math.round(y - r.top)}px`);
    }
  };

  const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };

  const onPointer = (e: PointerEvent) => {
    x = e.clientX;
    y = e.clientY;
    const next = e.target instanceof Element ? (e.target.closest(SELECTOR) as HTMLElement | null) : null;
    if (next !== host) host = next;
    schedule();
  };

  /**
   * The pointer can hold perfectly still while the page scrolls under it — a wheel over a card, or
   * a trackpad flick. Without this the same offset would be re-used and the pool would slide away
   * with the card instead of staying under the cursor.
   */
  const onScroll = () => { if (host?.matches(':hover')) schedule(); };

  document.addEventListener('pointermove', onPointer, { passive: true });
  /*
   * And `pointerover` — a box can arrive under a cursor that never moved: the page scrolled, a list
   * re-rendered, a modal closed, a shortcut changed the route. Chromium delivers an `over` at the
   * pointer's position in those cases and no `move` at all, so a `pointermove`-only listener leaves
   * the light showing at the previous box's coordinates (or, on a first visit, an empty pool). Both
   * events carry the same `clientX/clientY`, so they share one handler, and `over` is rare enough
   * that adding it costs nothing next to `move`.
   */
  document.addEventListener('pointerover', onPointer, { passive: true });
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });

  return () => {
    if (frame) cancelAnimationFrame(frame);
    document.removeEventListener('pointermove', onPointer);
    document.removeEventListener('pointerover', onPointer);
    document.removeEventListener('scroll', onScroll, true);
    host = null;
  };
}
