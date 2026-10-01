import { useEffect, useRef } from 'react';
import { Bot, X } from 'lucide-react';
import { AssistantCard } from './AssistantCard';

/**
 * The footer AI dock — the assistant, reachable from every screen.
 *
 * The same `AssistantCard` already sits on the Dashboard and under every notebook, and that is
 * exactly the problem this solves: on the 30-odd pages that render neither, "poocho" meant leaving
 * the page you were reading. The dock hangs off the status bar, so the assistant is one tap away
 * wherever you are.
 *
 * It is a DOCK, not a modal: it never blocks the page, the route, or the keyboard — `aria-modal` is
 * false on purpose, and everything except the input stays clickable behind it. Three ways out (the
 * AI button that opened it, this panel's close button, Escape), and it stays open while you
 * navigate, because "explain this screen" usually means reading two screens.
 *
 * `suggestions` are one-tap project questions: the facts in `engine/project.ts` are only useful if
 * the learner knows they exist, and "test kaise chalaun" is not a question anyone types cold.
 */
export function AiDock({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // Focus the ask box on open, so the keyboard is ready — this is the one thing a dock can do that
  // a page-embedded card cannot.
  useEffect(() => {
    if (open) ref.current?.querySelector('input')?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="aidock fadeup" role="dialog" aria-modal="false" aria-label="AI assistant" ref={ref}>
      <div className="aidock-head">
        <span className="aidock-ic"><Bot size={14} /></span>
        <b className="small">AI</b>
        <span className="aidock-sub small muted">App ke bare me poocho — setup, content, commands, code</span>
        <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={onClose} aria-label="AI panel band karo">
          <X size={14} />
        </button>
      </div>
      <AssistantCard
        compact
        embedded
        suggestions={[
          { label: 'Ye app kya hai?', ask: 'ye app kya hai' },
          { label: 'Commands / test', ask: 'test kaise chalaun' },
          { label: 'Content kaha add karun?', ask: 'naya question kaha add karun' },
          { label: 'Code kaha hai?', ask: 'code kaun si file me hai' },
        ]}
      />
    </div>
  );
}
