import { apiJson, loadOwnMlProgress, saveOwnMlProgress } from '../auth/client';
import { isValidMlPayload, type MlSyncPayload } from '../learning/ml-sync';

/**
 * The ML course's account sync.
 *
 * It rides the existing account API (`/api/ml/progress`) rather than a second transport, and every
 * failure is a named outcome instead of an exception: a static deployment has no API, a signed-out
 * learner has no token, and a payload the server rejects is a bug. The course keeps working locally
 * in all three cases; only the status chip changes.
 */
export type MlSyncState =
  | { ok: true; payload: MlSyncPayload }
  | { ok: false; reason: 'signed-out' | 'unavailable' | 'rejected' | 'invalid' };

/**
 * Load order: the account API when the deployment runs one, then the caller's own
 * `progress_snapshots.ml_per_course` column. The second path is what makes a static deployment sync;
 * it is the same row the counters use, read through the existing identity-bound SELECT policy.
 */
export async function loadMlProgress(): Promise<MlSyncState> {
  const result = await apiJson<{ payload?: unknown }>('/api/ml/progress', { action: 'load' }, { timeoutMs: 8000 });
  if (!result.ok) {
    if (result.status === 401) return { ok: false, reason: 'signed-out' };
    const direct = await loadOwnMlProgress();
    if (direct === null) return { ok: false, reason: 'unavailable' };
    if (!isValidMlPayload(direct)) return { ok: false, reason: 'invalid' };
    return { ok: true, payload: direct };
  }
  const payload = result.data?.payload;
  if (payload === undefined) return { ok: true, payload: {} };
  if (!isValidMlPayload(payload)) return { ok: false, reason: 'invalid' };
  return { ok: true, payload };
}

export async function saveMlProgress(payload: MlSyncPayload): Promise<
  { ok: true; saved: number } | { ok: false; reason: 'signed-out' | 'unavailable' | 'rejected' }
> {
  const result = await apiJson<{ saved?: number }>(
    '/api/ml/progress',
    { action: 'save', payload },
    { timeoutMs: 8000 },
  );
  if (!result.ok) {
    if (result.status === 401) return { ok: false, reason: 'signed-out' };
    if (result.status === 413 || result.status === 400) return { ok: false, reason: 'rejected' };
    // No account API (static hosting): write the ML column through its own RPC, which never touches
    // XP, the resume position or NumPy's `per_course` payload.
    if (await saveOwnMlProgress(payload)) return { ok: true, saved: Object.keys(payload).length };
    return { ok: false, reason: 'unavailable' };
  }
  return { ok: true, saved: Number(result.data?.saved ?? 0) };
}
