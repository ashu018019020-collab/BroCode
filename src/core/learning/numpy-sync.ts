import type { Attempt } from '../../types';

/**
 * WHAT TRAVELS BETWEEN DEVICES FOR THE NUMPY COURSE.
 *
 * The account snapshot stores counters and a resume position; the course's own records live in
 * `state.attempts` under these key families, so that is exactly what is synced. The allowlist is the
 * point: a future key family is not uploaded by accident, and the server validates the same shape.
 */
export const NUMPY_SYNC_PREFIXES = ['nmod:', 'nans:', 'ntick:'] as const;
export const NUMPY_SYNC_EXACT = ['ncap', 'nlast', 'nlevel'] as const;

/** 64 KB is generous for 200 section records plus drafts, and small enough to reject a runaway body. */
export const NUMPY_SYNC_MAX_BYTES = 64 * 1024;

/** The most a written draft may occupy on the wire. */
export const NUMPY_SYNC_MAX_TEXT = 20_000;

export type NumpySyncPayload = Record<string, Attempt>;

export function isNumpySyncKey(key: string): boolean {
  return (NUMPY_SYNC_EXACT as readonly string[]).includes(key)
    || NUMPY_SYNC_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Only the course's own keys, and only ones with something in them. */
export function collectNumpyProgress(attempts: Record<string, Attempt>): NumpySyncPayload {
  const out: NumpySyncPayload = {};
  for (const [key, value] of Object.entries(attempts || {})) {
    if (!isNumpySyncKey(key) || !value || typeof value !== 'object') continue;
    const trimmed: Attempt = { ...value };
    if (typeof trimmed.answer === 'string') trimmed.answer = trimmed.answer.slice(0, NUMPY_SYNC_MAX_TEXT);
    out[key] = trimmed;
  }
  return out;
}

/**
 * Local first, remote as a gap filler. A record that exists on this device is never overwritten by an
 * older copy from another one, and a section opened elsewhere still appears here — the union is what
 * "survives across devices" means without a conflict-resolution UI.
 */
export function mergeNumpyProgress(
  local: NumpySyncPayload, remote: NumpySyncPayload | null | undefined,
): { payload: NumpySyncPayload; added: string[]; kept: number } {
  const payload: NumpySyncPayload = { ...(remote || {}), ...local };
  const added = Object.keys(remote || {}).filter((key) => !(key in local));
  return { payload, added, kept: Object.keys(local).length };
}

export function numpyPayloadBytes(payload: NumpySyncPayload): number {
  return JSON.stringify(payload).length;
}

/** Shape plus budget check, used by the client before sending and mirrored by the server. */
export function isValidNumpyPayload(value: unknown): value is NumpySyncPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 600) return false;
  for (const [key, attempt] of entries) {
    if (!isNumpySyncKey(key)) return false;
    if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) return false;
    const answer = (attempt as { answer?: unknown }).answer;
    if (answer !== undefined && (typeof answer !== 'string' || answer.length > NUMPY_SYNC_MAX_TEXT)) return false;
  }
  return numpyPayloadBytes(value as NumpySyncPayload) <= NUMPY_SYNC_MAX_BYTES;
}

/** A short summary for the sync chip, so the learner is never told "saved" without a number. */
export function numpySyncSummary(payload: NumpySyncPayload): string {
  const sections = Object.keys(payload).filter((key) => key.startsWith('nmod:')).length;
  const drafts = Object.keys(payload).filter((key) => key.startsWith('nans:')).length;
  return `${sections} sections · ${drafts} drafts`;
}
