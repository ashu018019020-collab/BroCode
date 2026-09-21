/** Spaced repetition: 1 / 3 / 7 / 14 / 30 days. Fully offline. */
import type { AppState } from '../types';

export const INTERVALS = [1, 3, 7, 14, 30];
const DAY = 86400000;

export function dueReview(state: AppState): { id: string; level: number }[] {
  const now = Date.now();
  return Object.entries(state.review)
    .map(([id, r]) => ({ id, level: r.level }))
    .filter(({ id, level }) => {
      const last = state.review[id]?.last ? new Date(state.review[id].last).getTime() : 0;
      return now - last >= INTERVALS[Math.min(level, INTERVALS.length - 1)] * DAY;
    });
}

/** Mistakes not yet marked fixed = revision material. */
export function openMistakes(state: AppState) { return state.mistakes.filter((m) => !m.fixed); }
