/**
 * Achievements.
 *
 * Every badge is *derived* from persisted learner state — nothing is granted,
 * seeded or faked. An achievement exists only when the underlying progress
 * actually happened, and each one exposes honest progress toward itself.
 */
import type { AppState, Section } from '../../types';
import { isMastered, sectionProgress, codingTasksDone } from '../learning/progress';
import { levelForXp, resumeDefenseAnswer, stageAttempt } from './keys';
import { bankPractised, doneRecords, mockPassed } from '../learning/coverage';
import { CAREER_CHECKLIST } from '../learning/career';
import { RESUME_ANSWER_TOTAL } from '../assessment/defense';

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
  /** Sections with a completed Project Lab build. */
  projectGates: number;
  /** Sections defended. */
  defenseGates: number;
  /** `resume:<projId>:<i>` answers stored. */
  resumeAnswers: number;
  /** Job-prep checklist ticks. */
  checklistTicks: number;
}

export function context(state: AppState, sections: Section[]): Ctx {
  return {
    state,
    sections,
    // Every count below comes from the module that owns the questions and the predicates — the badge
    // panel and the page that prints the same figure read the same function, never a second scan.
    codingDone: codingTasksDone(sections, state).done,
    attempts: doneRecords(state.attempts),
    fixedMistakes: state.mistakes.filter((m) => m.fixed).length,
    mockPassed: mockPassed(state.attempts),
    // "Self-graded answers", from the module that owns that count — so this badge and the /questions
    // KPI row can never disagree about what the learner has graded.
    graded: bankPractised(state.attempts),
    mastered: sections.filter((s) => isMastered(s, state)).length,
    reviewsDone: Object.keys(state.review).length,
    // The career gates — the same records the Career hub reads (project/defense stage attempts and
    // the `resume:` answer family), so a badge and a readiness row can never disagree. The
    // predicate is the curriculum's own (`stagePassed` in learning/progress.ts): the GATE RECORD
    // EXISTS. A defense is `{done, score}` and a project gate is `{done, answer}`, so asking for
    // `.done` would be a second, narrower rule that silently drops a scored record.
    projectGates: sections.filter((s) => !!state.attempts[stageAttempt(s.id, 'project')]).length,
    defenseGates: sections.filter((s) => !!state.attempts[stageAttempt(s.id, 'defense')]).length,
    resumeAnswers: Object.keys(state.defenseAnswers).filter((k) => k.startsWith(RESUME_FAMILY)).length,
    checklistTicks: Object.values(state.jobPrep).filter(Boolean).length,
  };
}

/** The `resume:` family, derived from the key builder — the family is never re-typed here. */
const RESUME_FAMILY = `${resumeDefenseAnswer('', 0).split(':')[0]}:`;

const need = (got: number, want: number) => ({ got: Math.min(got, want), need: want });

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-step', icon: '🚀', label: 'First Step', hint: 'Complete your first task', progress: (c) => need(c.attempts, 1) },
  { id: 'streak-3', icon: '🔥', label: 'Warming Up', hint: '3-day streak', progress: (c) => need(c.state.streak.current, 3) },
  { id: 'streak-7', icon: '⚡', label: 'Consistent Coder', hint: '7-day streak', progress: (c) => need(c.state.streak.current, 7) },
  { id: 'xp-100', icon: '✨', label: '100 XP', hint: 'Earn 100 XP', progress: (c) => need(c.state.xp, 100) },
  { id: 'xp-500', icon: '💫', label: '500 XP', hint: 'Earn 500 XP', progress: (c) => need(c.state.xp, 500) },
  { id: 'level-3', icon: '🏅', label: 'Level 3', hint: 'Reach Level 3', progress: (c) => need(levelForXp(c.state.xp) - 1, 2) },
  { id: 'level-5', icon: '🎖️', label: 'Level 5', hint: 'Reach Level 5', progress: (c) => need(levelForXp(c.state.xp) - 1, 4) },
  { id: 'code-1', icon: '⌨️', label: 'Hello, Code', hint: 'Solve your first coding task', progress: (c) => need(c.codingDone, 1) },
  { id: 'code-10', icon: '🧑‍💻', label: 'Code Machine', hint: 'Solve 10 coding tasks', progress: (c) => need(c.codingDone, 10) },
  { id: 'code-50', icon: '🛠️', label: 'Builder', hint: 'Solve 50 coding tasks', progress: (c) => need(c.codingDone, 50) },
  { id: 'mistake-slayer', icon: '🐞', label: 'Mistake Slayer', hint: 'Fix 10 mistakes', progress: (c) => need(c.fixedMistakes, 10) },
  { id: 'mock-1', icon: '🎤', label: 'Interview Debut', hint: 'Pass one mock question', progress: (c) => need(c.mockPassed, 1) },
  { id: 'mock-25', icon: '🗣️', label: 'Interview Ready', hint: 'Pass 25 mock questions', progress: (c) => need(c.mockPassed, 25) },
  { id: 'graded-50', icon: '📚', label: 'Question Bank Runner', hint: 'Self-grade 50 questions', progress: (c) => need(c.graded, 50) },
  { id: 'master-1', icon: '🏁', label: 'Section Master', hint: 'Master one section 100%', progress: (c) => need(c.mastered, 1) },
  { id: 'master-10', icon: '🏆', label: 'Ten Sections', hint: 'Master 10 sections', progress: (c) => need(c.mastered, 10) },
  { id: 'review-5', icon: '🔁', label: 'Spaced Repetition', hint: 'Add 5 sections to the review queue', progress: (c) => need(c.reviewsDone, 5) },
  { id: 'notes-5', icon: '📝', label: 'Note Taker', hint: 'Write 5 notes', progress: (c) => need(c.state.notes.length, 5) },
  // The career badges — the same engine, so the Dashboard's panel earns them too. Their counts
  // come from the records the project/defense stages and the job-prep checklist write.
  { id: 'first-project', icon: '🚀', label: 'First Ship', hint: 'Complete your first Project Lab build', progress: (c) => need(c.projectGates, 1) },
  { id: 'defended', icon: '🛡️', label: 'Defended', hint: 'Defend one build against interviewer questions', progress: (c) => need(c.defenseGates, 1) },
  { id: 'resume-ready', icon: '📄', label: 'Resume Ready', hint: 'Write pitch answers for every defense project', progress: (c) => need(c.resumeAnswers, RESUME_ANSWER_TOTAL) },
  { id: 'checklist-half', icon: '💼', label: 'Halfway There', hint: 'Half the job-prep checklist ticked', progress: (c) => need(c.checklistTicks, Math.ceil(CAREER_CHECKLIST.length / 2)) },
];

/** The badge ids the Career pillar shows — the pure-learning badges stay the Dashboard's story. */
const CAREER_BADGE_IDS = new Set(['first-project', 'defended', 'resume-ready', 'checklist-half', 'mock-1', 'code-10']);

/** The career subset of the ONE achievements list — no second badge registry anywhere. */
export function careerAchievements(state: AppState, sections: Section[]): EarnedAchievement[] {
  return earnedAchievements(state, sections).filter((a) => CAREER_BADGE_IDS.has(a.id));
}

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
