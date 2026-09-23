/**
 * Single owner of every persisted-key shape and gamification policy.
 * Anything that reads or writes state.attempts, state.savedCode, or derives
 * a level from XP must go through here — a typo in a key silently severs a
 * mastery gate, and the typecheck cannot see string shapes.
 * Keys must stay byte-identical to what existing learners have stored.
 */
import type { Stage } from './progress';

// ---- state.attempts: per-section stage/item completion and scores ----
/** Whole-stage gates: interview, mini, project, defense, checkpoint. */
export const stageAttempt = (sid: string, stage: Stage) => `st:${sid}:${stage}`;
/** Per-item completion inside a stage: coding, logic, solved. */
export const itemAttempt = (sid: string, stage: Stage, i: number) => `st:${sid}:${stage}${i}`;
/** Debug stage: a single "fixed the bug" record per section. */
export const debugDone = (sid: string) => `st:${sid}:debugdone`;
/** Learn stage: theory-viewed marker. */
export const learnView = (sid: string) => `view:${sid}:learn`;
/** Final assessment coding tasks. */
export const finalTaskAttempt = (i: number) => `final:task${i}`;
/** Question-bank self-grade: one record per bank question id. */
export const bankAttempt = (questionId: string) => `qb:${questionId}`;
export const BANK_ATTEMPT_PREFIX = 'qb:';
/** Final assessment per-part scores. */
export const finalPart = (k: string) => `final:part:${k}`;

// ---- state.interviewAnswers ----
export const interviewAnswer = (sid: string, i: number) => `ia:${sid}:${i}`;

// ---- state.defenseAnswers ----
export const lessonDefenseAnswer = (sid: string, i: number) => `df:${sid}:${i}`;
export const resumeDefenseAnswer = (projId: string, i: number) => `resume:${projId}:${i}`;

// ---- state.savedCode slots ----
export const codeSlot = {
  playgroundPython: 'pg:python',
  playgroundJs: 'pg:js',
  playgroundSql: 'pg:sql',
  playgroundHtml: 'pg:html',
  sqlLab: 'sql:lab',
  lesson: (sid: string, stage: string, i: number | string) => `code:${sid}:${stage}:${i}`,
  final: (i: number) => `final:code:${i}`,
  npLab: (tab: string, i: number | string) => `nplab:${tab}:${i}`,
} as const;

// ---- gamification policy ----
const XP_PER_LEVEL = 50; // private: callers go through levelForXp / levelProgress
export const levelForXp = (xp: number) => Math.floor(Math.sqrt(xp / XP_PER_LEVEL)) + 1;
/** Fraction (0..1) of progress toward the next level. */
export const levelProgress = (xp: number) => (xp % XP_PER_LEVEL) / XP_PER_LEVEL;
export const LEVEL_NAMES = ['Initiate', 'Coder', 'Builder', 'Analyst', 'Engineer', 'Architect', 'AI Engineer', 'AI Master'];
