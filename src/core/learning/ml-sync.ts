import type { Attempt } from '../../types';
import { M_CAPSTONE_KEY } from './mcourse';

/**
 * WHAT TRAVELS BETWEEN DEVICES FOR THE ML COURSE.
 *
 * The ML workspace writes its own section records under `mmod:<module>:<section>`, and the capstone
 * evidence checklist lives under the exact key `mcap`. Both are part of the ML sync surface:
 * the checklist decides certificate eligibility, so leaving it local-only silently lost a pass on
 * another device. NumPy's `nmod:` / `nans:` / `ntick:` / `ncap` keys are deliberately excluded, so
 * the two courses cannot overwrite or impersonate each other. The server and SQL validator enforce
 * the same allowlist.
 */
export const ML_SYNC_PREFIX = 'mmod:' as const;
export const ML_SYNC_EXACT = [M_CAPSTONE_KEY] as const;

/** 64 KB is generous for 270 section records and small enough to reject a runaway body. */
export const ML_SYNC_MAX_BYTES = 64 * 1024;

/** The most a written value may occupy on the wire, if a record ever carries one. */
export const ML_SYNC_MAX_TEXT = 20_000;

export type MlSyncPayload = Record<string, Attempt>;

export function isMlSyncKey(key: string): boolean {
  return (ML_SYNC_EXACT as readonly string[]).includes(key) || key.startsWith(ML_SYNC_PREFIX);
}

/** The checklist is a JSON array of criterion names inside the record's `answer` field. */
function capstoneCriteria(attempt: Attempt | undefined): string[] {
  if (!attempt || typeof attempt.answer !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(attempt.answer);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Two devices can tick different rubric rows. The certificate needs the rubric total, so the merge is
 * the union of criteria — never "last writer wins" — and the local attempt's other fields win.
 */
function mergeCapstone(localRecord: Attempt | undefined, remoteRecord: Attempt | undefined): Attempt | undefined {
  if (!localRecord && !remoteRecord) return undefined;
  const criteria = [...new Set([
    ...capstoneCriteria(localRecord),
    ...capstoneCriteria(remoteRecord),
  ])];
  return {
    ...(remoteRecord ?? {}),
    ...(localRecord ?? {}),
    answer: JSON.stringify(criteria),
  };
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
  const mergedCapstone = mergeCapstone(localSafe[M_CAPSTONE_KEY], remoteSafe[M_CAPSTONE_KEY]);
  if (mergedCapstone) payload[M_CAPSTONE_KEY] = mergedCapstone;
  const added = Object.keys(remoteSafe).filter((key) => !(key in localSafe));
  // When both sides have a checklist, the union can add a row without adding a new key. Mark it so
  // the page applies the merged payload instead of leaving the local state untouched.
  if (capstoneCriteria(remoteSafe[M_CAPSTONE_KEY]).some(
    (criterion) => !capstoneCriteria(localSafe[M_CAPSTONE_KEY]).includes(criterion),
  ) && !added.includes(M_CAPSTONE_KEY)) {
    added.push(M_CAPSTONE_KEY);
  }
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
  const sections = Object.keys(payload).filter((key) => key.startsWith(ML_SYNC_PREFIX)).length;
  const capstone = M_CAPSTONE_KEY in payload ? ' · capstone' : '';
  return `${sections} section${sections === 1 ? '' : 's'}${capstone}`;
}
