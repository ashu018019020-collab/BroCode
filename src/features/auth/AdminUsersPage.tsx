import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthProvider';
import { authApi, type AccountStatus, type AdminUserResult, type ManagedUser, type SignInProvider } from '../../core/auth/client';
import { authErrorCopy } from '../../core/auth/messages';
import { onlineOf, watchLive, type LiveStatus } from '../../core/auth/realtime';

/**
 * The owner dashboard — the account database, seen through the API.
 *
 * The roster arrives through ONE server call (`GET /api/admin/users`), which the server answers
 * only after verifying the caller's Supabase token AND the `admin` role on their profile row. The
 * client never talks to Postgres and never sees the service key: the browser sends a bearer
 * token, the server decides. A learner who types /admin by hand is redirected out by the guard
 * below and would get a 403 even if they were not.
 *
 * After that first load the page does NOT poll on a timer. The shared Supabase Realtime channel
 * (`core/auth/realtime`) reports who is online through presence and pings one refetch per
 * sign-in broadcast, so updates land the moment they happen; a slow refresh runs only while
 * realtime is disconnected, so a dropped socket degrades to stale-proof polling rather than a
 * frozen page.
 */
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString() : 'Never';
const providerLabel: Record<SignInProvider, string> = {
  email: 'Email / password',
  google: 'Google',
  github: 'GitHub',
  other: 'Other provider',
};

/** One row of the roster as CSV, quoted only when a value needs it. */
function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_HEADER = [
  'email', 'name', 'role', 'status', 'joined', 'last_sign_in', 'last_seen', 'online',
  'xp', 'streak', 'practiced', 'done_records', 'study_minutes', 'study_days', 'open_mistakes',
];

/** The roster is the owner's own data, so it can leave the page as a file. */
function exportRoster(users: ManagedUser[]) {
  const rows = users.map((account) => [
    account.email,
    account.name,
    account.role,
    account.status,
    account.createdAt,
    account.lastSignInAt,
    account.lastSeenAt,
    account.online ? 'yes' : 'no',
    account.progress?.xp ?? 0,
    account.progress?.streakCurrent ?? 0,
    account.progress?.practicedCount ?? 0,
    account.progress?.doneRecords ?? 0,
    account.progress?.studyMinutes ?? 0,
    account.progress?.studyDays ?? 0,
    account.progress?.openMistakes ?? 0,
  ]);
  const csv = [CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `brocode-users-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function AdminUsersPage() {
  const { user, loading } = useAuth();
  const [result, setResult] = useState<AdminUserResult | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  // Realtime state: the account ids presence reports as connected (null until the channel has
  // really synced) and the channel's own connection status.
  const [liveIds, setLiveIds] = useState<ReadonlySet<string> | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('idle');
  const refreshTimer = useRef<number | null>(null);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      setResult(await authApi.users());
      setError('');
    } catch (cause) {
      // Through the same funnel as the form: this page is the one place an operator could otherwise
      // read a raw HTTP status or "verify the API server is running" straight off the screen.
      setError(cause instanceof Error ? authErrorCopy(cause.message) : 'Could not load accounts.');
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  // One refetch per burst of events: a sign-in can arrive as a broadcast from the client AND a
  // follow-up from the same session, and a roster the owner is looking at should not flicker.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void loadUsers();
    }, 600);
  }, [loadUsers]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    void loadUsers();
    // Coming back to the tab covers whatever a suspended socket may have missed; between visits
    // the roster keeps itself fresh through the realtime channel, not a timer.
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadUsers();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadUsers, user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    // Supabase Realtime: presence keeps "Online" live in both directions, and every sign-in
    // broadcast anywhere answers with one refetch — this is what replaced the 15-second poll.
    return watchLive({
      onPresence: setLiveIds,
      onStatus: setLiveStatus,
      onEvent: scheduleRefresh,
    });
  }, [user?.role, scheduleRefresh]);

  useEffect(() => {
    if (user?.role !== 'admin' || liveStatus === 'subscribed') return;
    // Realtime is the normal path. The moment it is NOT connected (first join, a dropped socket,
    // no realtime service) a slow refresh runs instead, so the roster can never silently rot.
    const interval = window.setInterval(() => { void loadUsers(); }, 30_000);
    return () => window.clearInterval(interval);
  }, [liveStatus, loadUsers, user?.role]);

  const accounts = result?.users ?? [];
  // Live presence is authoritative for "online" while the channel is synced; otherwise the
  // server's own snapshot stands in (`onlineOf` owns that switch, once).
  const live = liveStatus === 'subscribed' ? liveIds : null;
  const displayAccounts = useMemo(
    () => accounts.map((account) => (
      { ...account, online: onlineOf(account.id, account.online, live) }
    )),
    [accounts, live],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return displayAccounts;
    return displayAccounts.filter((account) => (
      account.email.toLowerCase().includes(needle) || account.name.toLowerCase().includes(needle)
    ));
  }, [displayAccounts, query]);

  const updateStatus = async (account: ManagedUser, status: AccountStatus) => {
    setBusyId(account.id);
    setError('');
    try {
      await authApi.updateStatus(account.id, status);
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof Error ? authErrorCopy(cause.message) : 'Could not update account status.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <p className="muted">Checking account…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: '/admin' }} />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;

  const liveLabel = liveStatus === 'subscribed' ? 'Live' : liveStatus === 'connecting' ? 'Connecting…' : 'Offline';
  const liveTitle = liveStatus === 'subscribed'
    ? 'Supabase Realtime: sign-ins and online status stream in the moment they happen.'
    : 'Realtime is not connected — the roster refreshes on its own, less often, until it is.';

  return (
    <section>
      <div className="row spread auth-admin-heading">
        <div>
          <h1>Owner dashboard</h1>
          <p className="muted small auth-admin-sub">
            Only your administrator account can view learner identity, activity, and progress.
            <span className={`chip auth-live${liveStatus === 'subscribed' ? ' on' : ''}`} title={liveTitle}>
              <i aria-hidden="true" />
              {liveLabel}
            </span>
          </p>
        </div>
        <Link className="btn small" to="/">Back to learning</Link>
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {result && (
        <div className="grid auth-admin-stats">
          <article className="card"><span className="muted small">Registered users</span><strong>{result.summary.total}</strong></article>
          <article className="card">
            <span className="muted small">Online now</span>
            <strong>{accounts.filter((account) => onlineOf(account.id, account.online, live)).length}</strong>
          </article>
          <article className="card"><span className="muted small">Signed in · last 30 days</span><strong>{result.summary.active30Days}</strong></article>
        </div>
      )}
      {result && (
        <div className="card auth-recent-signins">
          <h2>Recent sign-ins</h2>
          <p className="muted small">Most recent authenticated sign-ins and the provider reported by Supabase.</p>
          <div className="auth-table-wrap">
            <table className="auth-table">
              <thead><tr><th>Learner</th><th>Sign-in method</th><th>Signed in</th></tr></thead>
              <tbody>
                {result.recentSignIns.map((signIn) => (
                  <tr key={signIn.id}>
                    <td><strong>{signIn.name || signIn.email}</strong><br /><span className="muted small">{signIn.email}</span></td>
                    <td>{providerLabel[signIn.provider]}</td>
                    <td>{dateTime(signIn.signedInAt)}</td>
                  </tr>
                ))}
                {!result.recentSignIns.length && <tr><td colSpan={3} className="muted">No sign-ins recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="row spread auth-admin-tools">
        <label className="auth-admin-search">
          <span className="sr-only">Search accounts by email or name</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by email or name…"
            type="search"
            value={query}
          />
        </label>
        <div className="row" style={{ gap: 8 }}>
          {query.trim() && <span className="muted small">{visible.length} of {accounts.length} shown</span>}
          <button className="btn small" disabled={loadingUsers} onClick={() => void loadUsers()} type="button">
            Refresh
          </button>
          <button
            className="btn small"
            disabled={!visible.length}
            onClick={() => exportRoster(visible)}
            type="button"
          >
            Export CSV
          </button>
        </div>
      </div>
      {loadingUsers ? <p className="muted">Loading accounts…</p> : (
        <div className="card auth-table-wrap">
          <table className="auth-table">
            <thead>
              <tr>
                <th>Learner</th><th>Activity</th><th>Progress</th><th>Manage</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((account) => (
                <tr key={account.id}>
                  <td>
                    <strong>{account.name || account.email}</strong>
                    <br /><span className="muted small">{account.email}</span>
                    <br /><span className="muted small">{account.role === 'admin' ? 'Administrator' : `Joined ${dateTime(account.createdAt)}`}</span>
                  </td>
                  <td>
                    <span className={account.online ? 'auth-online' : 'auth-offline'}>{account.online ? 'Online' : 'Offline'}</span>
                    <br /><span className="muted small">Last seen: {dateTime(account.lastSeenAt)}</span>
                    <br /><span className="muted small">Last sign-in: {dateTime(account.lastSignInAt)}</span>
                  </td>
                  <td>
                    {account.progress ? (
                      <span className="small">
                        {account.progress.xp} XP · {account.progress.practicedCount} practiced
                        <br />{account.progress.doneRecords} done / run · {account.progress.studyMinutes} study min
                        <br />{account.progress.studyDays} study days · {account.progress.streakCurrent} streak
                        <br />{account.progress.openMistakes} open mistakes
                      </span>
                    ) : <span className="muted small">No synced progress yet</span>}
                  </td>
                  <td>
                    {account.role !== 'admin' && (
                      <select
                        aria-label={`Account status for ${account.email}`}
                        disabled={busyId === account.id}
                        value={account.status}
                        onChange={(event) => void updateStatus(
                          account,
                          event.currentTarget.value === 'disabled' ? 'disabled' : 'active',
                        )}
                      >
                        <option value="active">Active account</option>
                        <option value="disabled">Disable account</option>
                      </select>
                    )}
                  </td>
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    {accounts.length ? 'No account matches that search.' : 'No accounts found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
