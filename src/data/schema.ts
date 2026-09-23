/**
 * Question-bank schema (shared TS shape) for the local content-pack pipeline.
 * Banks live at public/questions/<sectionId>.json; the CLI in scripts/
 * validates, seeds, expands and reports on them.
 */
export type QuestionType = 'interview' | 'coding' | 'debug' | 'logic' | 'solved' | 'checkpoint' | 'theory';
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export type Importance = 'must_know' | 'high_value' | 'interview_critical' | 'production' | 'advanced';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type QStatus = 'DRAFT' | 'REVIEWED' | 'PUBLISHED';

export interface QuestionRecord {
  id: string;                 // global unique: "<sectionId>:<type>:<index>"
  sectionId: string;
  type: QuestionType;
  difficulty: Difficulty;
  importance: Importance;
  priority: Priority;
  status: QStatus;
  question: string;
  answer: string;             // model answer / solution / expected output
  explanation: string;        // why the answer is right (Hinglish-friendly)
  source: string;             // e.g. 'curriculum' | 'official-docs'
  sourceVersion?: string;     // required when source is version-sensitive
  verifiedAt?: string;        // ISO date of last source verification
  tags: string[];
}

export interface TopicBank {
  sectionId: string;
  title: string;
  contentVersion: string;
  generatedAt: string;
  topics: string[];           // concept titles covered
  questions: QuestionRecord[];
  flags?: string[];           // e.g. 'CONTENT_INCOMPLETE'
}

/** Importance weights used by the coverage scoring. */
export const IMPORTANCE_WEIGHTS: Record<Importance, number> = {
  must_know: 3, interview_critical: 3, high_value: 2, production: 2, advanced: 1,
};
