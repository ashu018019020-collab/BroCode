import { useEffect, useRef } from 'react';
import { useAuth } from '../../core/auth/AuthProvider';
import AuthForm, { type AuthMode } from './AuthForm';

/**
 * The in-place sign-in surface, opened from the rail's profile card. It is the `/login` page's
 * sibling, not a second implementation: both render the same `AuthForm`.
 *
 * A guest can be in the middle of a lesson when they decide to sign in, so the dialog deliberately
 * does NOT navigate anywhere on success — it closes, and the learner keeps the page they were on.
 * `document.body`'s scroll is locked while it is open so the page behind it cannot drift.
 */
export default function AuthDialog({
  open,
  initialMode,
  onClose,
}: {
  open: boolean;
  initialMode?: AuthMode;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const panel = useRef<HTMLDivElement>(null);

  // Another tab completing a provider sign-in, or a session restored mid-dialog: the reason the
  // dialog was opened is gone, so it goes too.
  useEffect(() => {
    if (open && user) onClose();
  }, [open, user, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    // The form's own autofocus came first (a child effect runs before its parent's); the panel only
    // takes focus when nothing inside it wanted it.
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="auth-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        aria-labelledby="auth-dialog-title"
        aria-modal="true"
        className="card auth-card auth-dialog"
        ref={panel}
        role="dialog"
        tabIndex={-1}
      >
        <button className="auth-dialog-close" onClick={onClose} aria-label="Close sign-in dialog" type="button">×</button>
        <h1 id="auth-dialog-title">BroCode account</h1>
        <p className="muted small">
          Create an account and your progress syncs across devices. The whole platform still works
          without one — an account is optional.
        </p>
        <AuthForm initialMode={initialMode} onSuccess={onClose} />
      </div>
    </div>
  );
}
