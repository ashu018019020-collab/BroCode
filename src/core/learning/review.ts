/** Spaced repetition: 1 / 3 / 7 / 14 / 30 days. Fully offline. */
import type { AppState } from '../../types';

export const INTERVALS = [1, 3, 7, 14, 30];
const DAY = 86400000;

/** The level is an index into INTERVALS, so it can never exceed the last slot. */
export const clampLevel = (level: number) => Math.max(0, Math.min(Math.trunc(level) || 0, INTERVALS.length - 1));
export const intervalDays = (level: number) => INTERVALS[clampLevel(level)];

export function dueReview(state: AppState): { id: string; level: number }[] {
  const now = Date.now();
  return Object.entries(state.review)
    .map(([id, r]) => ({ id, level: r.level }))
    .filter(({ id, level }) => {
      const last = state.review[id]?.last ? new Date(state.review[id].last).getTime() : 0;
      return now - last >= INTERVALS[Math.min(level, INTERVALS.length - 1)] * DAY;
    });
}

/**
 * One section's real position in the schedule: which interval applies, when the
 * next review falls due, and how late it already is. Everything here is derived
 * from the stored `{ level, last }` record — nothing is estimated or invented.
 */
export interface ReviewInfo {
  id: string;
  level: number;
  last: string;
  /** Days in the current interval (1/3/7/14/30). */
  intervalDays: number;
  /** Epoch ms when this section is due again. */
  dueAt: number;
  /** Whole days until due (0 once due or overdue). */
  daysLeft: number;
  /** Whole days past the due date (0 while still on schedule). */
  overdueDays: number;
  due: boolean;
}

export function reviewInfo(state: AppState, id: string, now = Date.now()): ReviewInfo | null {
  const rec = state.review[id];
  if (!rec) return null;
  const level = clampLevel(rec.level);
  const lastMs = rec.last ? new Date(rec.last).getTime() : 0;
  const days = intervalDays(level);
  const dueAt = lastMs + days * DAY;
  const delta = dueAt - now;
  return {
    id,
    level,
    last: rec.last,
    intervalDays: days,
    dueAt,
    daysLeft: delta > 0 ? Math.ceil(delta / DAY) : 0,
    overdueDays: delta < 0 ? Math.floor(-delta / DAY) : 0,
    due: delta <= 0,
  };
}

/** Hinglish one-liner for the schedule, e.g. "Level 1 · 3-din interval · 2 din baaki". */
export function reviewLabel(info: ReviewInfo): string {
  const base = `Review level ${info.level} · ${info.intervalDays}-din interval`;
  if (info.due && info.overdueDays > 0) return `${base} · ${info.overdueDays} din late — abhi due`;
  if (info.due) return `${base} · aaj due`;
  if (info.daysLeft === 1) return `${base} · kal due`;
  return `${base} · ${info.daysLeft} din baaki`;
}

/** The next record after the learner marks a section reviewed (mirrors the Review page). */
export function nextReviewRecord(level: number, now = new Date()) {
  return { level: clampLevel(level + 1), last: now.toISOString() };
}

/** A wrong answer drops the section back to the start of the ladder. */
export const resetReviewRecord = (now = new Date()) => ({ level: 0, last: now.toISOString() });

/** Mistakes not yet marked fixed = revision material. */
export function openMistakes(state: AppState) { return state.mistakes.filter((m) => !m.fixed); }
