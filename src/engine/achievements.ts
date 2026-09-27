/**
 * Achievements.
 *
 * Every badge is *derived* from persisted learner state — nothing is granted,
 * seeded or faked. An achievement exists only when the underlying progress
 * actually happened, and each one exposes honest progress toward itself.
 */
import type { AppState, Section } from '../types';
import { isMastered, sectionProgress } from './progress';
import { levelForXp } from './keys';

export interface Achievement {
  id: string;
  icon: string;
  label: string;
  hint: string;
  /** Current / target, so unearned badges can show real progress. */
  progress: (ctx: Ctx) => { got: number; need: number };
}

interface Ctx {
  state: AppState;
  sections: Section[];
  codingDone: number;
  attempts: number;
  fixedMistakes: number;
  mockPassed: number;
  graded: number;
  mastered: number;
  reviewsDone: number;
}

export function context(state: AppState, sections: Section[]): Ctx {
  const keys = Object.keys(state.attempts);
  return {
    state,
    sections,
    codingDone: keys.filter((k) => /^st:[^:]+:coding\d+$/.test(k) && state.attempts[k]?.done).length,
    attempts: keys.filter((k) => state.attempts[k]?.done).length,
    fixedMistakes: state.mistakes.filter((m) => m.fixed).length,
    mockPassed: keys.filter((k) => k.startsWith('lab:mock:') && state.attempts[k]?.done).length,
    graded: keys.filter((k) => k.startsWith('qb:')).length,
    mastered: sections.filter((s) => isMastered(s, state)).length,
    reviewsDone: Object.keys(state.review).length,
  };
}

const need = (got: number, want: number) => ({ got: Math.min(got, want), need: want });

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-step', icon: '🚀', label: 'First Step', hint: 'Apna pehla task complete karo', progress: (c) => need(c.attempts, 1) },
  { id: 'streak-3', icon: '🔥', label: 'Warming Up', hint: '3 din ka streak', progress: (c) => need(c.state.streak.current, 3) },
  { id: 'streak-7', icon: '⚡', label: 'Consistent Coder', hint: '7 din ka streak', progress: (c) => need(c.state.streak.current, 7) },
  { id: 'xp-100', icon: '✨', label: '100 XP', hint: '100 XP kamao', progress: (c) => need(c.state.xp, 100) },
  { id: 'xp-500', icon: '💫', label: '500 XP', hint: '500 XP kamao', progress: (c) => need(c.state.xp, 500) },
  { id: 'level-3', icon: '🏅', label: 'Level 3', hint: 'Level 3 tak pahuncho', progress: (c) => need(levelForXp(c.state.xp) - 1, 2) },
  { id: 'level-5', icon: '🎖️', label: 'Level 5', hint: 'Level 5 tak pahuncho', progress: (c) => need(levelForXp(c.state.xp) - 1, 4) },
  { id: 'code-1', icon: '⌨️', label: 'Hello, Code', hint: 'Pehla coding task solve karo', progress: (c) => need(c.codingDone, 1) },
  { id: 'code-10', icon: '🧑‍💻', label: 'Code Machine', hint: '10 coding tasks solve karo', progress: (c) => need(c.codingDone, 10) },
  { id: 'code-50', icon: '🛠️', label: 'Builder', hint: '50 coding tasks solve karo', progress: (c) => need(c.codingDone, 50) },
  { id: 'mistake-slayer', icon: '🐞', label: 'Mistake Slayer', hint: '10 mistakes fix karo', progress: (c) => need(c.fixedMistakes, 10) },
  { id: 'mock-1', icon: '🎤', label: 'Interview Debut', hint: 'Ek mock question pass karo', progress: (c) => need(c.mockPassed, 1) },
  { id: 'mock-25', icon: '🗣️', label: 'Interview Ready', hint: '25 mock questions pass karo', progress: (c) => need(c.mockPassed, 25) },
  { id: 'graded-50', icon: '📚', label: 'Question Bank Runner', hint: '50 questions self-grade karo', progress: (c) => need(c.graded, 50) },
  { id: 'master-1', icon: '🏁', label: 'Section Master', hint: 'Ek section 100% master karo', progress: (c) => need(c.mastered, 1) },
  { id: 'master-10', icon: '🏆', label: 'Ten Sections', hint: '10 sections master karo', progress: (c) => need(c.mastered, 10) },
  { id: 'review-5', icon: '🔁', label: 'Spaced Repetition', hint: '5 sections review queue me daalo', progress: (c) => need(c.reviewsDone, 5) },
  { id: 'notes-5', icon: '📝', label: 'Note Taker', hint: '5 notes likho', progress: (c) => need(c.state.notes.length, 5) },
];

export interface EarnedAchievement extends Achievement { earned: boolean; got: number; need: number }

export function earnedAchievements(state: AppState, sections: Section[]): EarnedAchievement[] {
  const c = context(state, sections);
  return ACHIEVEMENTS.map((a) => {
    const p = a.progress(c);
    return { ...a, ...p, earned: p.got >= p.need };
  });
}

/** Track-level mastery, used by the progress panel (honest, averaged from real sections). */
export function trackPct(sections: Section[], state: AppState, from: number, to: number): number {
  const secs = sections.filter((s) => s.no >= from && s.no <= to);
  if (!secs.length) return 0;
  return Math.round(secs.reduce((a, s) => a + sectionProgress(s, state).masterPct, 0) / secs.length);
}
