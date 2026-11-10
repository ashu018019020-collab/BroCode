/**
 * The Java Programming course's pure rules.
 *
 * Same architecture as the C course (`core/learning/ccourse.ts`), one family of storage keys per
 * kind of work so no tally can count another course's records:
 *
 *   · `jcourse:<module>:checkpoint` — the module is complete (the only completion signal)
 *   · `jcourse:<module>:test`       — the module assessment score
 *   · `jquiz:<module>:<i>`          — one answered module MCQ
 *   · `jlab:<module>`               — the module lab's public tests all passed
 *   · `jcoding:<questionId>`        — a coding-bank question was attempted (score = tests passed %)
 *   · `jdebug:<challengeId>`        — a debugging challenge was fixed (score = 100) or attempted
 *
 * Everything here is pure: no React, no store, no fetch. The pages supply stored records; this
 * module answers what is unlocked, what comes next, and how much of the course is honestly done.
 */
import { jQuizFamily } from '../platform/keys';

export type JLevel = 'beginner' | 'intermediate' | 'advanced';

export interface JModuleCard {
  id: string;
  no: number;
  title: string;
  level: JLevel;
  hours: number;
  goal: string;
  brief: string;
  counts: { topics: number; examples: number; practice: number; mcqs: number; interview: number };
}

export interface JStats {
  modules: number;
  topics: number;
  examples: number;
  practice: number;
  mcqs: number;
  interview: number;
  labs: number;
  projects: number;
  coding: number;
  debugging: number;
  hours: number;
}

export interface JIndex {
  course: {
    id: string; slug: string; title: string; subtitle: string; tagline: string; description: string;
    standard: string; level: string; hours: number; tone: string; prerequisites: string[];
    outcomes: string[]; skills: string[]; targetStudents: string[]; modules: string[];
  };
  stats: JStats;
  modules: JModuleCard[];
}

export interface JTopic { title: string; body: string; code?: string; memory?: string[] }
export interface JExample {
  level: string; title: string; code: string; output: string; stdin?: string;
  lines: string[]; dryRun?: string[]; memory?: string[];
}
export interface JMistake { wrong: string; right: string; why: string }
export interface JMcq { q: string; options: string[]; answer: number; explain: string }
export interface JInterview { q: string; a: string; followUp?: string }
export interface JTest { name: string; stdin?: string; stdout: string }
export interface JModuleLab {
  title: string; brief: string; starter: string; expected: string; tests: JTest[]; hints: string[]; solution: string;
}
export interface JModule {
  id: string; no: number; title: string; level: JLevel; hours: number; goal: string; prereqs: string[];
  objectives: string[]; definition: string; explain: string[]; hinglish: string[]; analogy: string; why: string;
  syntax: { code: string; note: string }[]; topics: JTopic[]; examples: JExample[];
  visual?: { title: string; rows: string[] };
  mistakes: JMistake[]; debug: { brief: string; code: string; expected: string; hints: string[]; fix: string };
  best: string[]; tip: string; revision: string[];
  practice: { title: string; prompt: string; level: string; hint: string }[];
  mcqs: JMcq[]; interview: JInterview[];
  lab: JModuleLab; checkpoint: { title: string; checks: string[] };
}
export interface JCourseFile {
  course: JIndex['course'];
  stats: JStats;
  modules: JModule[];
  final: JFinalExam;
}
export interface JInterviewItem {
  id: string; module: string | null; level: JLevel; topic: string; q: string; a: string;
  explain: string; example: string; code: string; followUp: string; tip: string; related: string[];
}
export interface JAssessmentSet { id: string; module: string; title: string; questions: JMcq[] }
export interface JFinalExam { id: string; title: string; passPct: number; minutes: number; questions: JMcq[] }

/** A learner-facing lab: a module lab (`category: 'module'`) or a practical lab (`category: 'lab'`). */
export interface JLab {
  id: string; module: string; title: string; brief: string; objective: string; level: JLevel;
  category: string; starter: string; expected: string; tests: JTest[]; hints: string[];
  solution: string; xp: number; theory?: string; instructions?: string[];
}

export interface JCodingTest { name: string; input?: string; output: string; hidden?: boolean }
export interface JCodingQuestion {
  id: string; title: string; level: JLevel; module: string; topic: string;
  statement: string; input: string; output: string; constraints: string[];
  examples: { input: string; output: string; explain: string }[];
  starter: string; tests: JCodingTest[]; solution: string;
  time: string; space: string; mistakes: string[]; hints: string[]; related: string[];
}

export interface JDebugChallenge {
  id: string; category: string; level: JLevel; module: string; title: string;
  brief: string; expected: string; actual: string; error: string;
  code: string; hints: string[]; fix: string; explain: string; tests: JTest[];
}

export interface JProject {
  id: string; title: string; level: JLevel; module: string; summary: string; useCase: string;
  objectives: string[]; prereqs: string[]; requirements: string[]; features: string[];
  architecture: string; structure: string[]; schema?: string; starter: string;
  steps: { title: string; tasks: string[]; code?: string }[];
  testing: string[]; output: string; errors: string[]; extensions: string[];
  readme: string[];
}

/* ------------------------------- the storage ------------------------------ */

/** The one completion rule: a module is complete when its checkpoint record exists. */
export function checkpointKey(moduleId: string): string { return `jcourse:${moduleId}:checkpoint`; }
export function testKey(moduleId: string): string { return `jcourse:${moduleId}:test`; }
/** The module's assessment record, kept apart from the checkpoint so a score is never a pass. */
export function assessmentKey(moduleId: string): string { return `jcourse:${moduleId}:checkpoint:assessment`; }

export function isComplete(id: string, completed: ReadonlySet<string>): boolean { return completed.has(id); }

/**
 * Every module ships OPEN. The order is a recommendation, not a lock — a learner can jump straight
 * to collections on day one. Completion still comes from the checkpoint record, so progress stays
 * honest even when the reading order is not.
 */
export function isUnlocked(index: number, _completed: ReadonlySet<string>, modules: JModuleCard[]): boolean {
  return index >= 0 && index < modules.length;
}

export function nextModule(modules: JModuleCard[], completed: ReadonlySet<string>): JModuleCard | null {
  return modules.find((m) => !completed.has(m.id)) ?? null;
}

export interface JProgress {
  completed: number;
  total: number;
  pct: number;
  hoursDone: number;
  byLevel: Record<JLevel, { done: number; total: number }>;
}

export function progressOf(modules: JModuleCard[], completed: ReadonlySet<string>): JProgress {
  const total = modules.length;
  const done = modules.filter((m) => completed.has(m.id)).length;
  const byLevel: JProgress['byLevel'] = {
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
export function quizScore(questions: JMcq[], answers: Record<number, number>): { correct: number; total: number; pct: number } {
  let correct = 0;
  questions.forEach((q, i) => { if (answers[i] === q.answer) correct += 1; });
  const total = questions.length;
  return { correct, total, pct: total ? Math.round((correct / total) * 100) : 0 };
}

/** Which answers were wrong, for the explanation pass after submission. */
export function wrongIndexes(questions: JMcq[], answers: Record<number, number>): number[] {
  return questions.map((q, i) => (answers[i] === q.answer ? -1 : i)).filter((i) => i >= 0);
}

/** Labs are open with the course — nothing waits on a checkpoint. */
export function labUnlocked(lab: JLab, _completed: ReadonlySet<string>): boolean {
  return Boolean(lab.module);
}

/**
 * How much of ONE module's MCQ set has been answered, from the records the quiz writes.
 *
 * `answered` counts that module's own attempt family (the prefix comes from `platform/keys`, so no
 * page spells a stored shape), capped at the set size so a stale record for a removed question
 * cannot push the hub past `N/N`. `correct` only counts records graded right.
 */
export interface JQuizTally { answered: number; correct: number; total: number; pct: number | null }

export function jQuizTally(
  attempts: Record<string, { done?: boolean } | undefined>,
  moduleId: string,
  total: number,
): JQuizTally {
  const family = jQuizFamily(moduleId);
  let answered = 0;
  let correct = 0;
  for (const [key, record] of Object.entries(attempts)) {
    if (!key.startsWith(family) || !record) continue;
    answered += 1;
    if (record.done === true) correct += 1;
  }
  const capped = Math.max(0, Math.min(answered, total));
  return { answered: capped, correct: Math.min(correct, capped), total, pct: total > 0 ? Math.round((capped / total) * 100) : null };
}

/* ------------------------------ coding + debug ---------------------------- */

/**
 * Coverage of the coding bank: a question counts as attempted when its record exists, whether the
 * verdict was right or wrong (that is what "attempted" means everywhere else in this app). A
 * question with every stored test passing is `solved`. Never a fake percentage from opening a card.
 */
export interface JCodingTally { attempted: number; solved: number; total: number; pct: number | null }

export function codingTally(
  attempts: Record<string, { done?: boolean; score?: number } | undefined>,
  questions: { id: string }[],
): JCodingTally {
  const total = questions.length;
  let attempted = 0;
  let solved = 0;
  for (const q of questions) {
    const record = attempts[`jcoding:${q.id}`];
    if (!record) continue;
    attempted += 1;
    if (record.done === true || record.score === 100) solved += 1;
  }
  return { attempted, solved, total, pct: total ? Math.round((attempted / total) * 100) : null };
}

export interface JDebugTally { attempted: number; fixed: number; total: number; pct: number | null }

export function debugTally(
  attempts: Record<string, { done?: boolean; score?: number } | undefined>,
  challenges: { id: string }[],
): JDebugTally {
  const total = challenges.length;
  let attempted = 0;
  let fixed = 0;
  for (const c of challenges) {
    const record = attempts[`jdebug:${c.id}`];
    if (!record) continue;
    attempted += 1;
    if (record.done === true || record.score === 100) fixed += 1;
  }
  return { attempted, fixed, total, pct: total ? Math.round((attempted / total) * 100) : null };
}

/**
 * What a coding submission earns: the share of a question's tests that passed.
 *
 * Hidden tests count toward the score but their expected output is never printed until the learner
 * has attempted the question, so a score cannot be read off the page before writing anything.
 */
export function submissionScore(results: { pass: boolean }[] | undefined): number {
  if (!results || !results.length) return 0;
  return Math.round((results.filter((r) => r.pass).length / results.length) * 100);
}

/* ------------------------------- certificate ------------------------------ */

/**
 * The certificate rule, in one place: every module checkpoint complete AND the final assessment at
 * or above its pass mark. A module score or a lab pass is evidence, never a substitute.
 */
export interface CertificateState {
  earned: boolean;
  modulesComplete: number;
  modulesTotal: number;
  finalPct: number | null;
  passPct: number;
  missingModules: string[];
  reason: string;
}

export function certificateOf(args: {
  modules: JModuleCard[];
  completed: ReadonlySet<string>;
  finalPct: number | null;
  passPct: number;
}): CertificateState {
  const missing = args.modules.filter((m) => !args.completed.has(m.id)).map((m) => m.id);
  const finalOk = args.finalPct !== null && args.finalPct >= args.passPct;
  const earned = missing.length === 0 && finalOk;
  const reason = earned
    ? 'All module checkpoints are complete and the final assessment passed.'
    : missing.length > 0
      ? `${missing.length} module checkpoint${missing.length === 1 ? '' : 's'} left, then the final assessment.`
      : `Final assessment needs ${args.passPct}% — the best score so far is ${args.finalPct ?? 0}%.`;
  return {
    earned,
    modulesComplete: args.modules.length - missing.length,
    modulesTotal: args.modules.length,
    finalPct: args.finalPct,
    passPct: args.passPct,
    missingModules: missing,
    reason,
  };
}

/** Coding questions for one module, in authored order. */
export function codingOfModule(questions: JCodingQuestion[], moduleId: string): JCodingQuestion[] {
  return questions.filter((q) => q.module === moduleId);
}

/** Debugging challenges for one module, in authored order. */
export function debugOfModule(challenges: JDebugChallenge[], moduleId: string): JDebugChallenge[] {
  return challenges.filter((c) => c.module === moduleId);
}

/** Bank questions for one module (a bank question has `module: null` when it is course-wide). */
export function interviewOfModule(bank: JInterviewItem[], moduleId: string): JInterviewItem[] {
  return bank.filter((q) => q.module === moduleId);
}
