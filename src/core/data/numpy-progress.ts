import { apiJson } from '../auth/client';
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

export async function loadNumpyProgress(): Promise<NumpySyncState> {
  const result = await apiJson<{ payload?: unknown }>('/api/numpy/progress', { action: 'load' }, { timeoutMs: 8000 });
  if (!result.ok) {
    return { ok: false, reason: result.status === 401 ? 'signed-out' : 'unavailable' };
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
    return { ok: false, reason: result.status === 401 ? 'signed-out' : result.status === 413 || result.status === 400 ? 'rejected' : 'unavailable' };
  }
  return { ok: true, saved: Number(result.data?.saved ?? 0) };
}
