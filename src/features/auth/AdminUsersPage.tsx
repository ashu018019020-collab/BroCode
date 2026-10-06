import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthProvider';
import { authApi, type AccountStatus, type AdminUserResult, type ManagedUser } from '../../core/auth/client';

const dateTime = (value: string | null) => value ? new Date(value).toLocaleString() : 'Never';

export default function AdminUsersPage() {
  const { user, loading } = useAuth();
  const [result, setResult] = useState<AdminUserResult | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError] = useState('');

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      setResult(await authApi.users());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load accounts.');
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    void loadUsers();
    const interval = window.setInterval(() => { void loadUsers(); }, 60_000);
    return () => window.clearInterval(interval);
  }, [loadUsers, user?.role]);

  const updateStatus = async (account: ManagedUser, status: AccountStatus) => {
    setBusyId(account.id);
    setError('');
    try {
      await authApi.updateStatus(account.id, status);
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update account status.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <p className="muted">Checking account…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: '/admin' }} />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <section>
      <div className="row spread auth-admin-heading">
        <div>
          <h1>Owner dashboard</h1>
          <p className="muted small">Only your administrator account can view learner identity, activity, and progress.</p>
        </div>
        <Link className="btn small" to="/">Back to learning</Link>
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {result && (
        <div className="grid auth-admin-stats">
          <article className="card"><span className="muted small">Registered users</span><strong>{result.summary.total}</strong></article>
          <article className="card"><span className="muted small">Online now</span><strong>{result.summary.online}</strong></article>
          <article className="card"><span className="muted small">Signed in · last 30 days</span><strong>{result.summary.active30Days}</strong></article>
        </div>
      )}
      {loadingUsers ? <p className="muted">Loading accounts…</p> : (
        <div className="card auth-table-wrap">
          <table className="auth-table">
            <thead>
              <tr>
                <th>Learner</th><th>Activity</th><th>Progress</th><th>Manage</th>
              </tr>
            </thead>
            <tbody>
              {result?.users.map((account) => (
                <tr key={account.id}>
                  <td>
                    <strong>{account.name || account.email}</strong>
                    <br /><span className="muted small">{account.email}</span>
                    <br /><span className="muted small">{account.role === 'admin' ? 'Administrator' : `Joined ${dateTime(account.createdAt)}`}</span>
                  </td>
                  <td>
                    <span>{account.online ? 'Online' : 'Offline'}</span>
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
              {!result?.users.length && <tr><td colSpan={4} className="muted">No accounts found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
