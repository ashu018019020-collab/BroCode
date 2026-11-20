import type { Attempt } from '../../types';

/**
 * WHAT TRAVELS BETWEEN DEVICES FOR THE ML COURSE.
 *
 * The ML workspace writes its own section records under `mmod:<module>:<section>`. That family is
 * the entire sync surface: NumPy's `nmod:` / `nans:` / `ntick:` keys are deliberately excluded, so
 * the two courses cannot overwrite or impersonate each other. The server validates the same prefix.
 */
export const ML_SYNC_PREFIX = 'mmod:' as const;

/** 64 KB is generous for 270 section records and small enough to reject a runaway body. */
export const ML_SYNC_MAX_BYTES = 64 * 1024;

/** The most a written value may occupy on the wire, if a record ever carries one. */
export const ML_SYNC_MAX_TEXT = 20_000;

export type MlSyncPayload = Record<string, Attempt>;

export function isMlSyncKey(key: string): boolean {
  return key.startsWith(ML_SYNC_PREFIX);
}

/** Only the ML section family, and only values that are real records. */
export function collectMlProgress(attempts: Record<string, Attempt>): MlSyncPayload {
  const out: MlSyncPayload = {};
  for (const [key, value] of Object.entries(attempts || {})) {
    if (!isMlSyncKey(key) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const trimmed: Attempt = { ...value };
    if (typeof trimmed.answer === 'string') trimmed.answer = trimmed.answer.slice(0, ML_SYNC_MAX_TEXT);
    out[key] = trimmed;
  }
  return out;
}

/**
 * Local first, remote as a gap filler. A section recorded on this device is never overwritten by an
 * older copy from another one, and a section opened elsewhere still appears here. Both sides are
 * filtered to `mmod:` before merging, so a malformed response cannot inject another key family.
 */
export function mergeMlProgress(
  local: MlSyncPayload, remote: MlSyncPayload | null | undefined,
): { payload: MlSyncPayload; added: string[]; kept: number } {
  const safe = (source: MlSyncPayload | null | undefined): MlSyncPayload => {
    const out: MlSyncPayload = {};
    for (const [key, value] of Object.entries(source || {})) {
      if (isMlSyncKey(key) && value && typeof value === 'object' && !Array.isArray(value)) out[key] = value;
    }
    return out;
  };
  const localSafe = safe(local);
  const remoteSafe = safe(remote);
  const payload: MlSyncPayload = { ...remoteSafe, ...localSafe };
  const added = Object.keys(remoteSafe).filter((key) => !(key in localSafe));
  return { payload, added, kept: Object.keys(localSafe).length };
}

export function mlPayloadBytes(payload: MlSyncPayload): number {
  return JSON.stringify(payload).length;
}

/** Shape plus budget check, used by the client before sending and mirrored by the server. */
export function isValidMlPayload(value: unknown): value is MlSyncPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 600) return false;
  for (const [key, attempt] of entries) {
    if (!isMlSyncKey(key)) return false;
    if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) return false;
    const answer = (attempt as { answer?: unknown }).answer;
    if (answer !== undefined && (typeof answer !== 'string' || answer.length > ML_SYNC_MAX_TEXT)) return false;
  }
  return mlPayloadBytes(value as MlSyncPayload) <= ML_SYNC_MAX_BYTES;
}

/** A short summary for the sync chip, so the learner is never told “saved” without a number. */
export function mlSyncSummary(payload: MlSyncPayload): string {
  const sections = Object.keys(payload).filter(isMlSyncKey).length;
  return `${sections} section${sections === 1 ? '' : 's'}`;
}
