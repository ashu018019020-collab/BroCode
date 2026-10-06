import { doneRecords, isPractised } from '../learning/coverage';
import type { AppState } from '../../types';

export interface ProgressSummary {
  xp: number;
  streakCurrent: number;
  practicedCount: number;
  doneRecords: number;
  studyMinutes: number;
  studyDays: number;
  openMistakes: number;
}

export function summarizeProgress(state: AppState): ProgressSummary {
  const studySeconds = Object.values(state.study).reduce(
    (total, seconds) => Number.isFinite(seconds) ? total + Math.max(0, seconds) : total,
    0,
  );
  return {
    xp: Number.isFinite(state.xp) ? Math.max(0, Math.floor(state.xp)) : 0,
    streakCurrent: Number.isFinite(state.streak.current) ? Math.max(0, Math.floor(state.streak.current)) : 0,
    practicedCount: Object.values(state.attempts).filter(isPractised).length,
    doneRecords: doneRecords(state.attempts),
    studyMinutes: Math.floor(studySeconds / 60),
    studyDays: Object.values(state.study).filter((seconds) => Number.isFinite(seconds) && seconds > 0).length,
    openMistakes: state.mistakes.filter((mistake) => mistake && !mistake.fixed).length,
  };
}
