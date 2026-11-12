import { apiJson, loadOwnNumpyProgress, saveOwnNumpyProgress } from '../auth/client';
import { isValidNumpyPayload, type NumpySyncPayload } from '../learning/numpy-sync';

/**
 * The NumPy course's account sync.
 *
 * It rides the existing account API (`/api/numpy/progress`) rather than a second transport, and every
 * failure is a NAMED outcome instead of an exception: a static deployment has no API, a signed-out
 * learner has no token, and a payload the server rejects is a bug. The course keeps working locally in
 * all three cases — this module only reports which one happened.
 */
export type NumpySyncState =
  | { ok: true; payload: NumpySyncPayload }
  | { ok: false; reason: 'signed-out' | 'unavailable' | 'rejected' | 'invalid' };

/**
 * Load order: the account API when the deployment runs one, then the caller's own
 * `progress_snapshots.per_course` column. The second path is what makes a static deployment sync —
 * it is the SAME row the counters use, read through the identity-bound SELECT policy.
 */
export async function loadNumpyProgress(): Promise<NumpySyncState> {
  const result = await apiJson<{ payload?: unknown }>('/api/numpy/progress', { action: 'load' }, { timeoutMs: 8000 });
  if (!result.ok) {
    if (result.status === 401) return { ok: false, reason: 'signed-out' };
    const direct = await loadOwnNumpyProgress();
    if (direct === null) return { ok: false, reason: 'unavailable' };
    if (!isValidNumpyPayload(direct)) return { ok: false, reason: 'invalid' };
    return { ok: true, payload: direct };
  }
  const payload = result.data?.payload;
  if (payload === undefined) return { ok: true, payload: {} };
  if (!isValidNumpyPayload(payload)) return { ok: false, reason: 'invalid' };
  return { ok: true, payload };
}

export async function saveNumpyProgress(payload: NumpySyncPayload): Promise<
  { ok: true; saved: number } | { ok: false; reason: 'signed-out' | 'unavailable' | 'rejected' }
> {
  const result = await apiJson<{ saved?: number }>(
    '/api/numpy/progress',
    { action: 'save', payload },
    { timeoutMs: 8000 },
  );
  if (!result.ok) {
    if (result.status === 401) return { ok: false, reason: 'signed-out' };
    if (result.status === 413 || result.status === 400) return { ok: false, reason: 'rejected' };
    // No account API (static hosting): write the course column through its own RPC, which never
    // touches the aggregate counters.
    if (await saveOwnNumpyProgress(payload)) return { ok: true, saved: Object.keys(payload).length };
    return { ok: false, reason: 'unavailable' };
  }
  return { ok: true, saved: Number(result.data?.saved ?? 0) };
}
