import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthProvider';
import AuthForm from './AuthForm';
import OtpForm from './OtpForm';
import type { AuthUser } from '../../core/auth/client';

/**
 * The `/login` page — the ONE front door for an unauthenticated visitor.
 *
 * This is where `RequireAuth` sends anyone who asks for a protected route, and it is the page a
 * shared sign-in link or a bookmark lands on. Learning is no longer readable without a session, so
 * this page is a real gate rather than an optional detour; the `from` state the guard attached is
 * honoured after a successful sign-in so a deep link still arrives where it was aimed.
 *
 * The rail's profile block opens the same form in a dialog, so a learner who is ALREADY inside the
 * app can sign in without losing the page they were reading.
 */
export default function LoginPage() {
  const { user } = useAuth();
  /** Password vs emailed one-time code: two doors to the SAME account, one page. */
  const [withCode, setWithCode] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const requestedPath = (location.state as { from?: unknown } | null)?.from;
  /**
   * Where to go after signing in.
   *
   * `from` comes from router state, so it is not attacker-controlled through the address bar — but
   * it is still validated, because a history entry can be crafted and because an open redirect is
   * cheap to prevent: same-origin absolute paths only (`/x`, never `//host/x`), and never back to a
   * page that would immediately bounce here again.
   */
  const destination = (account: AuthUser) => {
    if (
      typeof requestedPath === 'string'
      && requestedPath.startsWith('/')
      && !requestedPath.startsWith('//')
      && !requestedPath.startsWith('/login')
      && !requestedPath.startsWith('/reset-password')
    ) return requestedPath;
    return account.role === 'admin' ? '/admin' : '/';
  };

  useEffect(() => {
    if (user) navigate(destination(user), { replace: true });
  }, [user, navigate]);

  if (user) return null;

  const cameFromProtected = typeof requestedPath === 'string' && requestedPath !== '/';

  return (
    <section className="auth-page">
      <div className="card auth-card">
        <h1>BroCode account</h1>
        <p className="muted small">
          {cameFromProtected
            ? 'An account is required to open that page. Sign in or create one — then you will land right where you were going.'
            : 'Sign in or create an account to open courses, lessons, practice, labs and your progress.'}
        </p>
        {withCode ? (
          <OtpForm onSuccess={(account) => navigate(destination(account), { replace: true })} />
        ) : (
          <AuthForm
            initialMode={cameFromProtected ? 'login' : 'register'}
            onSuccess={(account) => navigate(destination(account), { replace: true })}
          />
        )}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button className="btn small" onClick={() => setWithCode((v) => !v)} type="button">
            {withCode ? 'Use a password instead' : 'Sign in with an email code'}
          </button>
        </div>
        <p className="muted small auth-privacy">
          Your learning data is tied to your account and stays under your control.
        </p>
      </div>
    </section>
  );
}
