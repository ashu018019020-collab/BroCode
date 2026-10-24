import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthProvider';

/**
 * THE authorization boundary for the whole app.
 *
 * Learning content is no longer readable without a real, verified Supabase session. Rather than
 * scattering `if (!user)` through forty screens — where one omission silently re-opens a door — every
 * protected route is wrapped in this component and the decision is made in ONE place.
 *
 * THREE STATES, and the middle one is the whole reason this is not a one-line redirect:
 *
 *   1. RESTORING (`loading`). supabase-js is exchanging the persisted session for a user. A redirect
 *      here would throw a signed-in learner back to the sign-in page on every single refresh, so the
 *      guard renders a skeleton instead. This is also what stops a flash of protected content before
 *      the session is known.
 *   2. UNAUTHENTICATED. Redirect to the sign-in page, carrying the route the learner actually asked
 *      for so they land there after signing in rather than on a generic dashboard.
 *   3. AUTHENTICATED. Render the route.
 *
 * WHY THE DESTINATION IS PASSED IN ROUTER STATE, NOT A QUERY STRING: state never reaches the address
 * bar, so a crafted `/login?next=…` cannot be used to steer a learner somewhere after sign-in.
 * `LoginPage` still re-validates it (same-origin, absolute path, not `/login`), so a hand-written
 * history entry cannot escape the app either.
 *
 * WHAT THIS IS NOT: this is convenience and flow, NOT the security boundary. The server verifies the
 * bearer token on every protected endpoint, and the database enforces ownership through RLS. Hiding a
 * route is not protection — a learner who defeats this guard still gets 401s and empty rows.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <RouteGateSkeleton />;

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <>{children}</>;
}

/**
 * The "we do not know yet" screen.
 *
 * Deliberately a skeleton rather than a spinner over the live shell: it is visible for the length of
 * one session round-trip, and a spinner that replaces a whole page for 200 ms reads as a glitch.
 * `aria-busy` tells a screen reader what is happening instead of leaving it with an empty page.
 */
function RouteGateSkeleton() {
  return (
    <div className="route-gate" aria-busy="true" aria-live="polite">
      <span className="route-gate-note">Checking your session…</span>
      <div className="route-gate-card" />
      <div className="route-gate-row">
        <div className="route-gate-kpi" />
        <div className="route-gate-kpi" />
        <div className="route-gate-kpi" />
      </div>
      <div className="route-gate-card" />
    </div>
  );
}

export default RequireAuth;
