import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthProvider';
import AuthForm from './AuthForm';
import type { AuthUser } from '../../core/auth/client';

/**
 * The `/login` page — the deep-linkable half of the sign-in UX (a shared URL, a bookmark, or a
 * page that turned out to need an account). The rail's profile card opens the same form in a dialog
 * instead of navigating here, so nobody mid-lesson is thrown out of what they were reading.
 *
 * Staying a real ROUTE is deliberate: the app is guest-first, and a signed-out visitor must be able
 * to paste a sign-in link into a fresh tab and land on a page that works.
 */
export default function LoginPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedPath = (location.state as { from?: unknown } | null)?.from;
  const destination = (account: AuthUser) => (
    typeof requestedPath === 'string'
      && requestedPath.startsWith('/')
      && !requestedPath.startsWith('//')
      && requestedPath !== '/login'
      ? requestedPath
      : account.role === 'admin' ? '/admin' : '/'
  );

  useEffect(() => {
    if (user) navigate(destination(user), { replace: true });
  }, [user, navigate]);

  if (user) return null;

  return (
    <section className="auth-page">
      <div className="card auth-card">
        <h1>BroCode account</h1>
        <p className="muted small">
          Sign in or create a new account. Your answers, notes and code stay on this device.
        </p>
        <AuthForm onSuccess={(account) => navigate(destination(account), { replace: true })} />
      </div>
    </section>
  );
}
