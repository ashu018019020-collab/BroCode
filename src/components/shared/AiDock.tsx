import { useEffect, useRef } from 'react';
import { AssistantCard } from './AssistantCard';
import { useTutorScope } from './tutorScope';

/**
 * The footer AI dock — the assistant, reachable from every screen.
 *
 * The same `AssistantCard` already sits on the Dashboard and under every notebook, and that is
 * exactly the problem this solves: on the 30-odd pages that render neither, "just ask" meant leaving
 * the page you were reading. The dock hangs off the status bar, so the assistant is one tap away
 * wherever you are.
 *
 * It is a DOCK, not a modal: it never blocks the page, the route, or the keyboard — `aria-modal` is
 * false on purpose, and everything except the input stays clickable behind it. Three ways out (the
 * AI button that opened it, the panel's close button, Escape), and it stays open while you navigate,
 * because "explain this screen" usually means reading two screens.
 *
 * The dock draws no header of its own: the assistant card IS the panel, so its identity, live state
 * and close control live in one header instead of two stacked ones.
 *
 * A step page and an open build card publish their scoped tutor (see `tutorScope.ts`); the dock
 * hands that scope to the card. So the entry — the authored briefing and its four starters — follows
 * the learner to the top of the page, instead of waiting in a block they have to scroll back to.
 */
export function AiDock({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const scope = useTutorScope();

  // Focus on desktop so typing is immediate. On phones this both opens the software keyboard and
  // scrolls the compact dock past its header/actions, so the learner taps the composer explicitly.
  useEffect(() => {
    if (open && !window.matchMedia('(max-width: 780px)').matches) {
      // `preventScroll`: focusing the composer used to scroll the panel straight to the bottom,
      // hiding the identity, the live state and the learning context behind the fold.
      ref.current?.querySelector('input')?.focus({ preventScroll: true });
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="aidock fadeup" role="dialog" aria-modal="false" aria-label="AI assistant" ref={ref}>
      <AssistantCard compact embedded onClose={onClose} tutor={scope ?? undefined} />
    </div>
  );
}
