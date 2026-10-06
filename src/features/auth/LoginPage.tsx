import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthProvider';
import type { OAuthProvider } from '../../core/auth/oauth';

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

export default function LoginPage() {
  const { login, loginWithProvider, redirectError, register, serviceError } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyProvider, setBusyProvider] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const startProvider = async (provider: OAuthProvider) => {
    setBusyProvider(provider);
    setError('');
    setNotice('');
    try {
      await loginWithProvider(provider);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start provider sign-in.');
      setBusyProvider(null);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') {
        const user = await login(email, password);
        navigate(user.role === 'admin' ? '/admin' : '/', { replace: true });
      } else {
        const result = await register(name, email, password);
        if (!result.user && result.emailConfirmationRequired) {
          setNotice('Check your email to confirm your BroCode account, then sign in.');
          setMode('login');
          return;
        }
        navigate(result.user?.role === 'admin' ? '/admin' : '/', { replace: true });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="auth-page">
      <div className="card auth-card">
        <h1>{mode === 'login' ? 'Sign in to BroCode' : 'Create a learner account'}</h1>
        <p className="muted small">
          Sign in with your BroCode account. Your private answers, notes, and code stay on this device.
        </p>

        {serviceError && (
          <p className="auth-message" role="status">
            Account service is unavailable: {serviceError} You can continue learning as a guest.
          </p>
        )}
        {(error || redirectError) && <p className="auth-error" role="alert">{error || redirectError}</p>}
        {notice && <p className="auth-message" role="status">{notice}</p>}

        <div className="auth-providers">
          {PROVIDERS.map((provider) => (
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

        <form className="auth-form" onSubmit={submit}>
          {mode === 'register' && (
            <label>
              Name
              <input autoComplete="name" maxLength={100} required value={name} onChange={(event) => setName(event.target.value)} />
            </label>
          )}
          <label>
            Email
            <input autoComplete="email" maxLength={320} required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Password
            <input
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'register' ? 8 : undefined}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {mode === 'register' && <span className="muted small">Use at least 8 characters.</span>}
          </label>
          <button className="btn primary" disabled={busy || busyProvider !== null} type="submit">
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="row auth-switch">
          <span className="muted small">
            {mode === 'login' ? 'New to BroCode?' : 'Already have an account?'}
          </span>
          <button className="btn small ghost" disabled={busy} onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
            setNotice('');
          }} type="button">
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </div>
        <Link className="btn small ghost auth-guest" to="/">Continue as guest</Link>
      </div>
    </section>
  );
}
