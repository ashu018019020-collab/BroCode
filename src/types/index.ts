export interface Concept { title: string; level: string; body: string; code: string; output: string; tip: string }
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
}
export interface MockQuestion { cat: string; q: string; a: string }
export interface Extras {
  mockInterview: { round: number; questions: MockQuestion[] }[];
  intensive: MockQuestion[];
}

export interface Attempt { done?: boolean; score?: number; tries?: number; answer?: string; ts?: number }
export interface Mistake { id: string; section: string; topic: string; question: string; myAnswer: string; correct: string; type: string; date: string; attempts: number; fixed: boolean }
export interface Bookmark { id: string; label: string; page: number }
export interface AppState {
  version: number;
  profile: { name: string; goal: string; level: string; dailyMinutes: number; onboarded: boolean };
  xp: number;
  streak: { current: number; last: string };
  attempts: Record<string, Attempt>;
  bookmarks: Bookmark[];
  mistakes: Mistake[];
  review: Record<string, { level: number; last: string }>;
  interviewAnswers: Record<string, string>;
  defenseAnswers: Record<string, string>;
  savedCode: Record<string, string>;
  settings: { reduceMotion: boolean };
  activity: Record<string, number>;
}
