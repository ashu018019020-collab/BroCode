/**
 * The C Programming course's pure rules.
 *
 * Progress is stored in the existing attempt record (`ccourse:<module>:checkpoint`, `:test`) and in
 * the module's own completion marker, so no new store schema is introduced. Everything here is pure
 * and fixture-testable: the page supplies a set of completed module ids, this module answers what is
 * unlocked, what comes next, and how much of the course is done.
 */

export type CLevel = 'beginner' | 'intermediate' | 'advanced';

export interface CModuleCard {
  id: string;
  no: number;
  title: string;
  level: CLevel;
  hours: number;
  goal: string;
  brief: string;
  counts: { topics: number; examples: number; practice: number; mcqs: number; interview: number };
}

export interface CStats {
  modules: number;
  topics: number;
  examples: number;
  practice: number;
  mcqs: number;
  interview: number;
  labs: number;
  projects: number;
  hours: number;
}

export interface CIndex {
  course: {
    id: string; slug: string; title: string; tagline: string; description: string; standard: string;
    level: string; hours: number; tone: string; prerequisites: string[]; outcomes: string[]; skills: string[];
    modules: string[];
  };
  stats: CStats;
  modules: CModuleCard[];
}

export interface CTopic { title: string; body: string; code?: string; memory?: string[] }
export interface CExample { level: string; title: string; code: string; output: string; stdin?: string; lines: string[]; dryRun?: string[]; memory?: string[] }
export interface CMcq { q: string; options: string[]; answer: number; explain: string }
export interface CInterview { q: string; a: string; followUp?: string }
export interface CLab {
  id: string; module: string; title: string; brief: string; objective: string; level: CLevel;
  category: string; starter: string; expected: string; tests: { name: string; stdin?: string; stdout: string }[];
  hints: string[]; solution: string; xp: number;
}
export interface CProject {
  id: string; title: string; level: CLevel; summary: string; concepts: string[]; features: string[];
  milestones: { title: string; tasks: string[] }[];
}
export interface CModule {
  id: string; no: number; title: string; level: CLevel; hours: number; goal: string; prereqs: string[];
  definition: string; explain: string[]; analogy: string; why: string;
  syntax: { code: string; note: string }[]; topics: CTopic[]; examples: CExample[];
  visual?: { title: string; rows: string[] };
  mistakes: { wrong: string; right: string; why: string }[];
  debug: { brief: string; code: string; expected: string; hints: string[]; fix: string };
  best: string[]; practice: { title: string; prompt: string; level: string; hint: string }[];
  mcqs: CMcq[]; interview: CInterview[];
  lab: { title: string; brief: string; starter: string; expected: string; tests: { name: string; stdin?: string; stdout: string }[]; hints: string[]; solution: string };
  checkpoint: { title: string; checks: string[] };
}
export interface CCourseFile { course: CIndex['course']; stats: CStats; modules: CModule[] }
export interface CInterviewItem { id: string; module: string | null; level: CLevel; topic: string; q: string; a: string; followUp: string }
export interface CAssessmentSet { id: string; module: string; title: string; questions: CMcq[] }

/** The one storage rule. A checkpoint is the completion signal; a test is a score, not a pass. */
export function checkpointKey(moduleId: string): string { return `ccourse:${moduleId}:checkpoint`; }
export function testKey(moduleId: string): string { return `ccourse:${moduleId}:test`; }

export function isComplete(id: string, completed: ReadonlySet<string>): boolean { return completed.has(id); }

/**
 * Every module ships OPEN. The order is a recommendation, not a lock: a learner can jump to
 * pointers on day one, or come back to module 3 after module 12. Completion still comes from the
 * checkpoint record, so progress stays honest even when the order is not.
 */
export function isUnlocked(index: number, _completed: ReadonlySet<string>, modules: CModuleCard[]): boolean {
  return index >= 0 && index < modules.length;
}

export function nextModule(modules: CModuleCard[], completed: ReadonlySet<string>): CModuleCard | null {
  return modules.find((m) => !completed.has(m.id)) ?? null;
}

export interface CProgress {
  completed: number;
  total: number;
  pct: number;
  hoursDone: number;
  byLevel: Record<CLevel, { done: number; total: number }>;
}

export function progressOf(modules: CModuleCard[], completed: ReadonlySet<string>): CProgress {
  const total = modules.length;
  const done = modules.filter((m) => completed.has(m.id)).length;
  const byLevel: CProgress['byLevel'] = {
    beginner: { done: 0, total: 0 }, intermediate: { done: 0, total: 0 }, advanced: { done: 0, total: 0 },
  };
  let hoursDone = 0;
  for (const m of modules) {
    byLevel[m.level].total += 1;
    if (completed.has(m.id)) { byLevel[m.level].done += 1; hoursDone += m.hours; }
  }
  return { completed: done, total, pct: total ? Math.round((done / total) * 100) : 0, hoursDone, byLevel };
}

/** A quiz score is correct answers over asked questions — never a percentage of attempts. */
export function quizScore(questions: CMcq[], answers: Record<number, number>): { correct: number; total: number; pct: number } {
  let correct = 0;
  questions.forEach((q, i) => { if (answers[i] === q.answer) correct += 1; });
  const total = questions.length;
  return { correct, total, pct: total ? Math.round((correct / total) * 100) : 0 };
}

/** Which answers were wrong, for the explanation pass after submission. */
export function wrongIndexes(questions: CMcq[], answers: Record<number, number>): number[] {
  return questions.map((q, i) => (answers[i] === q.answer ? -1 : i)).filter((i) => i >= 0);
}

/** Labs are open with the course — nothing waits on a checkpoint. */
export function labUnlocked(lab: CLab, _completed: ReadonlySet<string>): boolean {
  return Boolean(lab.module);
}
