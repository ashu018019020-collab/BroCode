import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthProvider';
import { authApi, type AuthUser } from '../../core/auth/client';
import { authErrorCopy, isEmail, MIN_PASSWORD, passwordProblem, resendWaitSeconds } from '../../core/auth/messages';

/**
 * The ONE sign-in/sign-up form. Two screens render it: the `/login` page (a deep link a shared URL
 * or an expired session can land on) and `AuthDialog` (the rail's account block, so a guest can sign
 * up without losing the page they were reading). The form owns only what is true for both — the
 * fields, validation, pending/notice/error states — and reports success upward, so neither caller
 * duplicates logic or copy.
 *
 * SIGN-UP is four fields: name, email, password, confirm password. The name is the display name the
 * profile and dashboard show, and it is sent to Supabase as `display_name` in the sign-up metadata
 * (the database trigger falls back to the address's local part only when that metadata is missing).
 *
 * CONFIRMATION is a state, not a toast. The project has "Confirm email" ON, so a successful sign-up
 * returns no session: the form is replaced by a "Check your inbox" panel that names the address and
 * offers a resend. The account exists from that moment; the learner gets a session when the link
 * comes back to the deployment and supabase-js exchanges the confirmation for one.
 *
 * The resend button is COOLED DOWN for a minute after every message. Supabase refuses a repeat for
 * the same address inside 60 seconds and the project's sender allows only a couple of emails per
 * hour in total, so a button that can be pressed freely spends that hour in three clicks — which is
 * exactly how a learner reached "this project has used up its hourly confirmation emails".
 *
 * Password rules live here, once: 8 characters minimum, matching confirmation, an email that is
 * actually an address. Nothing is validated on the FIRST keystroke of an untouched field — a field
 * complains only after it has been used and left.
 */

export type AuthMode = 'login' | 'register';

/** The eye that toggles password visibility. Decorative — the button carries the label. */
function EyeMark({ off }: { off: boolean }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" width="16">
      <path d={off
        ? 'M3 3l18 18M10.6 10.7a2 2 0 0 0 2.8 2.8M9.9 5.5A9.7 9.7 0 0 1 12 5.3c5 0 9 4.3 9 6.7 0 1-.7 2.3-1.9 3.5M6.2 7.4C4.1 9 3 10.9 3 12c0 2.4 4 6.7 9 6.7 1.3 0 2.5-.3 3.6-.8'
        : 'M12 5.3c5 0 9 4.3 9 6.7s-4 6.7-9 6.7-9-4.3-9-6.7 4-6.7 9-6.7Z'}
      />
      {!off && <circle cx="12" cy="12" r="2.6" />}
    </svg>
  );
}

type Field = 'name' | 'email' | 'password' | 'confirm';

export default function AuthForm({
  initialMode = 'login',
  onSuccess,
}: {
  initialMode?: AuthMode;
  onSuccess?: (user: AuthUser) => void;
}) {
  const { login, redirectError, register, serviceError } = useAuth();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /** The address a confirmation link was just sent to — the whole form is replaced while it is set. */
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  /** When the last confirmation message was sent — the resend button counts down from here. */
  const [sentAt, setSentAt] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  /** Seconds left on the resend wait; `0` means the button may send. */
  const resendWait = awaitingConfirmation ? resendWaitSeconds(sentAt, clock) : 0;

  // A second-by-second clock only while it matters: the countdown ends the interval on its own.
  useEffect(() => {
    if (!resendWait) return;
    const ticker = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(ticker);
  }, [resendWait]);

  // The first field of the active tab holds focus: a keyboard learner starts typing immediately, and
  // switching to "Create account" moves the cursor to the field that tab actually starts with — the
  // name, because that tab now begins with it.
  useEffect(() => {
    (mode === 'register' ? nameRef : emailRef).current?.focus();
  }, [mode]);

  const validEmail = isEmail(email);
  const validPassword = !passwordProblem(password);
  const validConfirm = confirm === password;
  const validName = name.trim().length > 1;
  // Only a field the learner has already left may complain.
  const fieldError = {
    name: mode === 'register' && touched.name && !validName ? 'Enter your name (at least 2 letters).' : '',
    email: touched.email && !validEmail ? 'Enter a valid email address, like name@example.com.' : '',
    password: touched.password ? passwordProblem(password) : '',
    confirm: mode === 'register' && touched.confirm && !validConfirm ? "Passwords don't match." : '',
  };
  const canSubmit = validEmail
    && validPassword
    && (mode === 'login' || (validName && validConfirm));
  /**
   * ONE banner for one failure.
   *
   * A failed sign-in can arrive from two places at once: the submit handler's `error` and the
   * provider-return `redirectError`. They used to render as two identical boxes, which looks like
   * two separate outages. Resolve them to the first real sentence and render exactly once.
   */
  const authFailure = error || redirectError || serviceError;
  const authFailureIsAlert = Boolean(error || redirectError);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError('');
    setNotice('');
    setConfirm('');
    setTouched({});
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched({ name: true, email: true, password: true, confirm: true });
    setError('');
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      if (mode === 'login') {
        onSuccess?.(await login(email.trim(), password));
      } else {
        const result = await register(name.trim(), email.trim(), password);
        if (result.user) onSuccess?.(result.user);
        else {
          setAwaitingConfirmation(email.trim());
          // The sign-up itself just sent the first message, so the resend starts locked too.
          setSentAt(Date.now());
          setClock(Date.now());
        }
      }
    } catch (cause) {
      setError(authErrorCopy(cause instanceof Error ? cause.message : 'Sign-in failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!awaitingConfirmation || resending || resendWait > 0) return;
    setResending(true);
    setError('');
    try {
      await authApi.resendConfirmation(awaitingConfirmation);
      setSentAt(Date.now());
      setClock(Date.now());
      setNotice(`Confirmation email sent again — check ${awaitingConfirmation}.`);
    } catch (cause) {
      setError(authErrorCopy(cause instanceof Error ? cause.message : 'Could not resend the confirmation email.'));
    } finally {
      setResending(false);
    }
  };

  // Confirmation is a STATE of the form, not a toast: the learner must not be left staring at a
  // sign-in form that silently expects an email they have not opened yet.
  if (awaitingConfirmation) {
    return (
      <div className="auth-sent" role="status">
        <span className="auth-sent-icon" aria-hidden="true">
          <svg fill="none" height="24" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" width="24">
            <rect height="14" rx="2.5" width="18" x="3" y="5.5" />
            <path d="m4 7 8 5.6L20 7" />
          </svg>
        </span>
        <h2>Check your inbox</h2>
        <p className="muted small">
          We sent a confirmation link to <b className="auth-sent-email">{awaitingConfirmation}</b>.
          Open it and you are signed in.
        </p>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {notice && <p className="auth-message" role="status">{notice}</p>}
        <button
          className="btn auth-wide"
          disabled={resending || resendWait > 0}
          onClick={() => void resend()}
          type="button"
        >
          {resending ? 'Sending…' : resendWait > 0 ? `Resend in ${resendWait}s` : 'Resend email'}
        </button>
        <p className="auth-foot muted small">
          The sender allows only a couple of confirmation emails per hour, so a resend waits a
          minute before it can send again.
        </p>
        <button
          className="btn ghost auth-wide"
          onClick={() => { setAwaitingConfirmation(null); setSentAt(0); switchMode('login'); }}
          type="button"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="auth-tabs" role="tablist" aria-label="Sign in or create an account">
        {(['login', 'register'] as AuthMode[]).map((value) => (
          <button
            aria-selected={mode === value}
            className={`auth-tab${mode === value ? ' active' : ''}`}
            key={value}
            onClick={() => switchMode(value)}
            role="tab"
            tabIndex={mode === value ? 0 : -1}
            type="button"
          >
            {value === 'login' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      {authFailure && (
        <p className={authFailureIsAlert ? 'auth-error' : 'auth-message'} role={authFailureIsAlert ? 'alert' : 'status'}>
          {authFailure}
        </p>
      )}
      {notice && <p className="auth-message" role="status">{notice}</p>}

      <form className="auth-form" noValidate onSubmit={submit}>
        {mode === 'register' && (
          <label className="auth-field">
            <span>Name</span>
            <input
              autoComplete="name"
              className={fieldError.name ? 'invalid' : ''}
              aria-invalid={Boolean(fieldError.name)}
              maxLength={100}
              onBlur={() => setTouched((t) => ({ ...t, name: true }))}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              ref={nameRef}
              required
              value={name}
            />
            {fieldError.name && <em className="auth-hint error" role="alert">{fieldError.name}</em>}
          </label>
        )}
        <label className="auth-field">
          <span>Email</span>
          <input
            autoComplete="email"
            className={fieldError.email ? 'invalid' : ''}
            aria-invalid={Boolean(fieldError.email)}
            maxLength={320}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            ref={emailRef}
            required
            type="email"
            value={email}
          />
          {fieldError.email && <em className="auth-hint error" role="alert">{fieldError.email}</em>}
        </label>
        <label className="auth-field">
          <span>Password</span>
          <span className="auth-input-row">
            <input
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className={fieldError.password ? 'invalid' : ''}
              aria-invalid={Boolean(fieldError.password)}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === 'login' ? 'Your password' : `At least ${MIN_PASSWORD} characters`}
              required
              type={showPassword ? 'text' : 'password'}
              value={password}
            />
            <button
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="auth-reveal"
              onClick={() => setShowPassword((value) => !value)}
              type="button"
            >
              <EyeMark off={showPassword} />
            </button>
          </span>
          {mode === 'register' && !fieldError.password && (
            <em className={`auth-hint${validPassword ? ' ok' : ''}`}>
              {validPassword ? '✓ Password looks good' : `At least ${MIN_PASSWORD} characters`}
            </em>
          )}
          {fieldError.password && <em className="auth-hint error" role="alert">{fieldError.password}</em>}
        </label>
        {mode === 'register' && (
          <label className="auth-field">
            <span>Confirm password</span>
            <input
              autoComplete="new-password"
              className={fieldError.confirm ? 'invalid' : ''}
              aria-invalid={Boolean(fieldError.confirm)}
              onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="Type the password again"
              required
              type={showPassword ? 'text' : 'password'}
              value={confirm}
            />
            {fieldError.confirm && <em className="auth-hint error" role="alert">{fieldError.confirm}</em>}
          </label>
        )}
        <button className="btn primary auth-wide" disabled={busy} type="submit">
          {busy ? (mode === 'login' ? 'Signing in…' : 'Creating account…') : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      {/* Forgot-password sits under the submit button, where a learner looks the moment a sign-in
          fails — the alternative is a support email saying "I cannot get in". It is a link, not a
          third tab: recovery is a different journey (an email round-trip), not a mode of this form. */}
      {mode === 'login' && (
        <Link className="auth-forgot" to="/reset-password">Forgot your password?</Link>
      )}

      <p className="auth-foot muted small">
        {mode === 'login'
          ? 'New here? Choose the "Create account" tab above.'
          : 'An account is required to open courses, lessons, practice and labs.'}
      </p>
    </>
  );
}
