import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../../core/auth/AuthProvider';
import { authApi, loadProviderAvailability, type AuthUser } from '../../core/auth/client';
import { authErrorCopy, isEmail, MIN_PASSWORD, passwordProblem } from '../../core/auth/messages';
import type { OAuthProvider, ProviderAvailability } from '../../core/auth/oauth';

/**
 * The ONE sign-in/sign-up form. Two screens render it: the `/login` page (a deep link a shared URL
 * or an expired session can land on) and `AuthDialog` (the rail's account block, so a guest can sign
 * up without losing the page they were reading). The form owns only what is true for both — the
 * fields, the provider buttons, validation, pending/notice/error states — and reports success
 * upward, so neither caller duplicates logic or copy.
 *
 * Password rules live here, once: 8 characters minimum, matched confirmation, an email that is
 * actually an address. Nothing is validated on the FIRST keystroke of an untouched field — a field
 * complains only after it has been used and left.
 */

export type AuthMode = 'login' | 'register';

const PROVIDERS: { id: OAuthProvider; label: string }[] = [
  { id: 'github', label: 'Continue with GitHub' },
  { id: 'google', label: 'Continue with Google' },
];

function GitHubMark() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="17" viewBox="0 0 16 16" width="17">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" height="17" viewBox="0 0 24 24" width="17">
      <path d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.86c2.26-2.09 3.56-5.17 3.56-8.87Z" fill="#4285F4" />
      <path d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24Z" fill="#34A853" />
      <path d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a11.99 11.99 0 0 0 0 10.76l3.98-3.09Z" fill="#FBBC05" />
      <path d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z" fill="#EA4335" />
    </svg>
  );
}

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

export default function AuthForm({
  initialMode = 'login',
  onSuccess,
}: {
  initialMode?: AuthMode;
  onSuccess?: (user: AuthUser) => void;
}) {
  const { login, loginWithProvider, redirectError, register, serviceError } = useAuth();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState<{ name?: boolean; email?: boolean; password?: boolean; confirm?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const [busyProvider, setBusyProvider] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /** The address a confirmation link was just sent to — the whole form is replaced while it is set. */
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  // `undefined` = still asking Supabase, `null` = could not find out (keep both buttons).
  const [available, setAvailable] = useState<ProviderAvailability | null | undefined>(undefined);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void loadProviderAvailability().then((result) => { if (active) setAvailable(result); });
    return () => { active = false; };
  }, []);

  // The first field of the active tab holds focus: a keyboard learner starts typing immediately, and
  // switching to "Create account" moves the cursor to the field that tab actually starts with.
  useEffect(() => { emailRef.current?.focus(); }, [mode]);

  const providers = available === undefined
    ? []
    : PROVIDERS.filter((provider) => available === null || available[provider.id]);

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

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError('');
    setNotice('');
    setConfirm('');
    setTouched({});
  };

  const startProvider = async (provider: OAuthProvider) => {
    setBusyProvider(provider);
    setError('');
    setNotice('');
    try {
      await loginWithProvider(provider);
    } catch (cause) {
      setError(authErrorCopy(cause instanceof Error ? cause.message : 'Could not start the sign-in with this provider.'));
      setBusyProvider(null);
    }
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
        else setAwaitingConfirmation(email.trim());
      }
    } catch (cause) {
      setError(authErrorCopy(cause instanceof Error ? cause.message : 'Sign-in failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!awaitingConfirmation) return;
    setResending(true);
    setError('');
    try {
      await authApi.resendConfirmation(awaitingConfirmation);
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
          Open it and you can sign in.
        </p>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {notice && <p className="auth-message" role="status">{notice}</p>}
        <button className="btn auth-wide" disabled={resending} onClick={() => void resend()} type="button">
          {resending ? 'Sending…' : 'Resend email'}
        </button>
        <button
          className="btn ghost auth-wide"
          onClick={() => { setAwaitingConfirmation(null); switchMode('login'); }}
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

      {serviceError && (
        <p className="auth-message" role="status">
          The account service is unavailable: {serviceError} Try again in a little while.
        </p>
      )}
      {(error || redirectError) && <p className="auth-error" role="alert">{error || redirectError}</p>}
      {notice && <p className="auth-message" role="status">{notice}</p>}

      {providers.length > 0 && (
        <>
          <div className="auth-providers">
            {providers.map((provider) => (
              <button
                className="btn auth-provider"
                disabled={busy || busyProvider !== null}
                key={provider.id}
                onClick={() => void startProvider(provider.id)}
                type="button"
              >
                {provider.id === 'github' ? <GitHubMark /> : <GoogleMark />}
                {busyProvider === provider.id ? 'Opening provider…' : provider.label}
              </button>
            ))}
          </div>
          <div className="auth-divider">or continue with email</div>
        </>
      )}

      <form className="auth-form" noValidate onSubmit={submit}>
        {mode === 'register' && (
          <label className="auth-field">
            <span>Name</span>
            <input
              autoComplete="name"
              className={fieldError.name ? 'invalid' : ''}
              maxLength={100}
              onBlur={() => setTouched((t) => ({ ...t, name: true }))}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
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
        <button className="btn primary auth-wide" disabled={busy || busyProvider !== null} type="submit">
          {busy ? (mode === 'login' ? 'Signing in…' : 'Creating account…') : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <p className="auth-foot muted small">
        {mode === 'login'
          ? 'New here? Choose the "Create account" tab above.'
          : 'Create an account to take your progress with you on any device.'}
      </p>
    </>
  );
}
