/** One runnable example inside an authored topic guide. `output` is real stdout. */
export interface GuideExample {
  level: 'basic' | 'intermediate' | 'advanced';
  code: string;
  output: string;
  explain: string[];
  /** true = output came from a real run; false = documented (local module missing). */
  verified?: boolean;
}
/** One "code kaise karte hain" step: what to do, why, and the snippet for it. */
export interface GuideStep { step: string; detail: string; code?: string }
/**
 * Authored topic guide — the "CODE KAISE KARTE HAIN" teaching layer. Optional and
 * additive: concepts extracted from the PDF keep body/code/output untouched and a
 * guide only adds the structure on top. `authored: true` marks hand-written teaching
 * material (never PDF-derived) so the UI can label it honestly.
 */
export interface ConceptGuide {
  what: string; why: string; whereUsed: string; prereqs: string[];
  howItWorks: string; syntax: string;
  examples: GuideExample[]; howToCode: GuideStep[];
  commonMistakes: string[]; bestPractices: string[];
  realWorld: string; practice: { difficulty: string; text: string }[];
  interview: { q: string; a: string }[]; miniChallenge: string; debugTask: string;
  related: string[]; revision: string[]; interviewTip: string;
  authored: true;
}
export interface Concept {
  title: string; level: string; body: string; code: string; output: string; tip: string;
  guide?: ConceptGuide;
  /** true when the concept exists because an authored guide created it (no PDF lesson). */
  authoredTopic?: boolean;
}
/**
 * Topic workspace — the "16-part" structure that organises ONE topic end to end:
 * intro → theory → syntax → examples → real-world → interview → practice → coding →
 * debugging → challenges → projects (simple/medium/hard) → improvement tasks →
 * interview-based practical tasks → revision checklist.
 *
 * Everything here is hand-written for THIS topic (never extracted boilerplate) and is
 * topic-pure: the questions, tasks, bugs and projects inside a section all belong to that
 * section's subject, so a learner never meets an unrelated question or a shipped solution
 * that does not run. Code is executed by scripts/packs.cjs and `output` is real stdout;
 * `verified: false` marks a snippet that needs a bundled-only module.
 */
export type PracticeLevel = 'beginner' | 'intermediate' | 'advanced' | 'interview' | 'realworld';

/** One practice question: answer + explanation + runnable example + the classic trap. */
export interface PracticeItem {
  q: string; a: string; explain?: string; code?: string; output?: string; verified?: boolean;
  commonMistake?: string; tip?: string;
}

/** One coding task in the fixed 12-field format (question → complexity → follow-up). */
export interface TopicCodingTask {
  difficulty: string; question: string; build: string; input: string; expected: string; hint: string;
  concept: string; solution: string; output?: string; verified?: boolean;
  explanation: string; time: string; space: string; better: string; followUp: string;
}

/**
 * Debugging practice: broken code that really fails, and the fix that really runs.
 * `mode` is 'raise' (default) when the bug crashes, and 'logic' when the code runs but
 * prints the wrong thing — the pipeline checks whichever it claims.
 */
export interface TopicDebugTask {
  difficulty: string; broken: string; error: string; why: string; fix: string;
  correct: string; output?: string; verified?: boolean; lesson: string;
  mode?: 'raise' | 'logic';
  /** Real stdout of `broken` for a logic bug (stamped by the pipeline, never hand-written). */
  brokenOutput?: string;
  /** Exception name captured while authoring, for a crash bug. */
  errorKind?: string;
}

/** Challenge ladder: quick → coding → advanced → interview → build. */
export interface TopicChallenge {
  kind: 'quick' | 'coding' | 'advanced' | 'interview' | 'build';
  minutes: number; prompt: string; hint?: string; deliverable?: string;
}

/** A topic project at one level, with the Version 1→4 improvement path. */
export interface TopicProject {
  level: 'simple' | 'medium' | 'advanced';
  name: string; problem: string; objective: string; features: string[]; concepts: string[];
  structure: string; steps: string[]; code: string; output?: string; verified?: boolean;
  explanation: string; testing: string; errors: string;
  improvements: string[]; advanced: string[];
  realWorld: string; interview: { q: string; a: string }[]; resume: string; readme: string[];
}

/** Project questions grouped the way the spec asks for them. */
export interface ProjectQuestions {
  understanding: string[]; coding: string[]; advanced: string[]; interview: string[];
}

export interface TopicPack {
  intro: string;
  theory: string[];
  syntax: string[];
  examples: GuideExample[];
  realWorld: string[];
  interview: { q: string; a: string; tip?: string }[];
  practice: Record<PracticeLevel, PracticeItem[]>;
  coding: TopicCodingTask[];
  debugging: TopicDebugTask[];
  challenges: TopicChallenge[];
  projects: TopicProject[];
  projectQuestions: ProjectQuestions;
  interviewTasks: { q: string; a: string; deliverable?: string }[];
  revision: string[];
  authored: true;
}

export interface InterviewQ { q: string; a: string; tip: string; fu: string }
export interface CodeTask { difficulty: string; text: string; solution: string; check: string }
export interface LogicCard { kind: string; text: string; answer: string }
export interface SolvedItem { difficulty: string; text: string; solution: string; result: string }
export interface ProjectTier {
  tier: string; name: string; what: string; use: string; architecture: string;
  files: string; buildTarget: string; code: string; defense: string; debugCue: string; followUp: string;
}
export interface MiniProject {
  name: string; what: string; use: string; architecture: string; files: string;
  buildTarget: string; output: string; code: string; explanation: string; interview: string; edgeCases: string[];
}
export interface CheckpointQ { q: string; key: string }
export interface Section {
  id: string; no: number; title: string;
  pages: { learn: number[]; interview: number[]; code: number[]; logic: number[]; solved: number[]; mini: number[]; project: number[]; checkpoint: number[] };
  learn: { concepts: Concept[]; recap: string; remember: string[]; practice: { difficulty: string; text: string }[] };
  interview: InterviewQ[];
  coding: CodeTask[];
  logic: LogicCard[];
  solved: SolvedItem[];
  mini: MiniProject;
  projectLab: ProjectTier[];
  checkpoint: CheckpointQ[];
  /**
   * The authored 16-part topic workspace for this section. Optional and additive: when it
   * is missing the lesson renders exactly as before, so a section can be filled in later
   * without any half-built UI. Generated into this file by `npm run packs:write`.
   */
  topic?: TopicPack;
}
export interface MockQuestion { cat: string; q: string; a: string }
export interface Extras {
  mockInterview: { round: number; questions: MockQuestion[] }[];
  intensive: MockQuestion[];
}

export interface Attempt { done?: boolean; score?: number; tries?: number; answer?: string; ts?: number }
/**
 * Where a mistake came from. Optional so records written before this existed
 * stay valid; the offline coach labels and weighs each source honestly instead
 * of pretending every failure was a coding-lab bug.
 */
export type MistakeSource = 'bank' | 'exam' | 'lesson' | 'lab' | 'mock' | 'interview' | 'final';
export interface Mistake {
  id: string; section: string; topic: string; question: string;
  myAnswer: string; correct: string; type: string; date: string;
  attempts: number; fixed: boolean; source?: MistakeSource;
}
export interface Bookmark { id: string; label: string; page: number }
export interface Note {
  id: string; title: string; body: string;
  tags: string[]; fav: boolean; section?: string;
  created: number; updated: number;
}
export type NotificationKind = 'success' | 'info' | 'warning' | 'review' | 'streak' | 'achievement';
export interface AppNotification {
  id: string; kind: NotificationKind; title: string; body: string; to?: string;
}
export interface AppState {
  version: number;
  /** `avatar` is a DOWNSCALED data URL (a 128px JPEG, ~6 KB), never the file the learner picked. */
  profile: { name: string; goal: string; level: string; dailyMinutes: number; onboarded: boolean; avatar?: string };
  xp: number;
  streak: { current: number; last: string };
  attempts: Record<string, Attempt>;
  bookmarks: Bookmark[];
  mistakes: Mistake[];
  review: Record<string, { level: number; last: string }>;
  interviewAnswers: Record<string, string>;
  defenseAnswers: Record<string, string>;
  savedCode: Record<string, string>;
  /**
   * `autoAdvance` moves the lesson on by itself the moment a task's gate completes (with a
   * countdown the learner can cancel). Older saved states do not have it → treated as on.
   */
  settings: { reduceMotion: boolean; autoAdvance?: boolean };
  activity: Record<string, number>;
  /**
   * Study time per day: 'YYYY-MM-DD' → SECONDS. Sparse on purpose — a day with no entry IS a day
   * with no study, and writing zeros for every day of the year would bloat a state that is
   * re-serialised whole on every write. `engine/study.ts` owns every rule about it (the zero-fill,
   * the streak, the heat grid); this field is storage.
   */
  study: Record<string, number>;
  notes: Note[];
  jobPrep: Record<string, boolean>;
  readNotifs: string[];
}
