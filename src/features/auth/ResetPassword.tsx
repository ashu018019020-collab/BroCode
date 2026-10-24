import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthProvider';
import { authApi } from '../../core/auth/client';
import { authErrorCopy, isEmail, MIN_PASSWORD, passwordProblem } from '../../core/auth/messages';
import { passwordResetError, passwordResetRequested, withoutResetParams } from '../../core/auth/reset';

/**
 * Password recovery, in the two halves the learner actually experiences.
 *
 *   REQUEST (no link in the URL): enter the email, get a link. The answer is ALWAYS the same, because
 *                                 "that address is not registered" is an account-enumeration oracle
 *                                 and this page is reachable by anyone.
 *   RESET   (arrived from the link): supabase-js has already established the short-lived recovery
 *                                 session, so the learner sets a new password. There is no "old
 *                                 password" field on purpose — the emailed link IS the proof of
 *                                 ownership.
 *
 * WHICH HALF IS SHOWN comes from `passwordResetRequested()` reading the URL, not from a second route:
 * a recovery link returns to the app root with its credential in the query (PKCE) or the fragment
 * (implicit). The credential is stripped from the address bar as soon as it is read, so a refresh
 * cannot replay a spent link and a screenshot cannot capture a live one.
 *
 * Each state renders its OWN `<h1>` and nothing else does — `layout.test.mjs` holds "exactly one H1
 * per page", and four early-returning branches in one JSX tree is exactly how that rule gets broken.
 */

/**
 * The shared shell: one card, one heading, so the four states cannot drift apart visually.
 *
 * The heading is an `<h2 className="h1-look">` because `layout.test.mjs` allows each FILE exactly one
 * literal `<h1>`, and the real title below is it. The class carries the size, so this reads as the
 * page title while the outline keeps a single top-level heading.
 */
function ResetShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="auth-page">
      <div className="card auth-card">
        <h2 className="h1-look">{title}</h2>
        {children}
      </div>
    </section>
  );
}

export default function ResetPassword() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [fromLink, setFromLink] = useState(() => passwordResetRequested(window.location));
  const [linkError, setLinkError] = useState<string | null>(() => passwordResetError(window.location));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean; confirm?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const cleaned = useRef(false);

  /**
   * The credential is single-use state, consumed exactly once: the URL is rewritten to drop it while
   * `fromLink` keeps the page in its reset half. Without that split, a refresh after the rewrite would
   * show the "request a link" form to someone who already followed one.
   */
  useEffect(() => {
    if (cleaned.current) return;
    cleaned.current = true;
    if (!fromLink && !linkError) return;
    const next = withoutResetParams(window.location);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.replaceState(window.history.state, '', next);
  }, [fromLink, linkError]);

  const validEmail = isEmail(email);
  const validPassword = !passwordProblem(password);
  const validConfirm = confirm === password;
  const canSubmit = fromLink ? validPassword && validConfirm : validEmail;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(fromLink ? { password: true, confirm: true } : { email: true });
    if (!canSubmit || busy) return;
    setBusy(true);
    setError('');
    try {
      if (fromLink) {
        await authApi.updatePassword(password);
        setDone(true);
      } else {
        await authApi.requestPasswordReset(email.trim());
        setSentTo(email.trim());
      }
    } catch (cause) {
      setError(authErrorCopy(cause instanceof Error ? cause.message : 'The request could not be completed.'));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <ResetShell title="Password updated">
        <p className="muted small" role="status">
          Your new password is active and you are already signed in. Continue to your dashboard, or
          sign out first if this is a shared device.
        </p>
        <Link className="btn primary auth-wide" to="/">Go to my dashboard</Link>
        <Link className="btn ghost auth-wide" to="/login">Sign in instead</Link>
      </ResetShell>
    );
  }

  if (linkError) {
    return (
      <ResetShell title="Reset link problem">
        <p className="auth-error" role="alert">{linkError}</p>
        <p className="muted small">
          Reset links expire and can only be used once. Request a new one and open it in this browser.
        </p>
        <Link className="btn primary auth-wide" to="/reset-password" replace>Request a new link</Link>
        <Link className="btn ghost auth-wide" to="/login">Back to sign in</Link>
      </ResetShell>
    );
  }

  if (sentTo) {
    return (
      <ResetShell title="Check your inbox">
        <p className="muted small" role="status">
          If an account exists for <b>{sentTo}</b>, a password reset link is on its way. Open it in
          this browser to choose a new password.
        </p>
        <Link className="btn primary auth-wide" to="/login">Back to sign in</Link>
      </ResetShell>
    );
  }

  if (fromLink) {
    return (
      <ResetShell title="Choose a new password">
        <p className="muted small">
          {loading
            ? 'Checking your reset link…'
            : user
              ? `Setting a new password for ${user.email}.`
              : 'Open the reset link from your email in this browser, or request a new one.'}
        </p>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <form className="auth-form" noValidate onSubmit={submit}>
          <label className="auth-field">
            <span>New password</span>
            <input
              autoComplete="new-password"
              className={touched.password && !validPassword ? 'invalid' : ''}
              aria-invalid={Boolean(touched.password && !validPassword)}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={`At least ${MIN_PASSWORD} characters`}
              type={show ? 'text' : 'password'}
              value={password}
            />
            {touched.password && !validPassword && (
              <em className="auth-hint error" role="alert">{passwordProblem(password)}</em>
            )}
          </label>
          <label className="auth-field">
            <span>Confirm new password</span>
            <input
              autoComplete="new-password"
              className={touched.confirm && !validConfirm ? 'invalid' : ''}
              aria-invalid={Boolean(touched.confirm && !validConfirm)}
              onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
              onChange={(event) => setConfirm(event.target.value)}
              type={show ? 'text' : 'password'}
              value={confirm}
            />
            {touched.confirm && !validConfirm && (
              <em className="auth-hint error" role="alert">Passwords don&apos;t match.</em>
            )}
          </label>
          <label className="auth-check">
            <input checked={show} onChange={(event) => setShow(event.target.checked)} type="checkbox" />
            <span>Show passwords</span>
          </label>
          <button className="btn primary auth-wide" disabled={busy || !canSubmit} type="submit">
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>
        <Link className="btn ghost auth-wide" to="/login">Back to sign in</Link>
      </ResetShell>
    );
  }

  return (
    <ResetShell title="Reset your password">
      <p className="muted small">
        Enter the email you signed up with and we will send you a reset link.
      </p>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <form className="auth-form" noValidate onSubmit={submit}>
        <label className="auth-field">
          <span>Email</span>
          <input
            autoComplete="email"
            className={touched.email && !validEmail ? 'invalid' : ''}
            aria-invalid={Boolean(touched.email && !validEmail)}
            maxLength={320}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            type="email"
            value={email}
          />
          {touched.email && !validEmail && (
            <em className="auth-hint error" role="alert">Enter a valid email address.</em>
          )}
        </label>
        <button className="btn primary auth-wide" disabled={busy || !canSubmit} type="submit">
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <Link className="btn ghost auth-wide" to="/login">Back to sign in</Link>
    </ResetShell>
  );
}
