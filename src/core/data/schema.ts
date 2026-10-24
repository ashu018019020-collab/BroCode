/**
 * Question-bank schema (shared TS shape) for the local content-pack pipeline.
 * Banks live at public/generated/questions/<sectionId>.json (source: content/questions); the CLI in scripts/
 * validates, seeds, expands and reports on them.
 */
export type QuestionType = 'interview' | 'coding' | 'debug' | 'logic' | 'solved' | 'checkpoint' | 'theory' | 'defense';
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
  source: string;             // 'curriculum' (PDF-derived) | 'authored' | 'official-docs'
  sourceVersion?: string;     // required when source is version-sensitive
  verifiedAt?: string;        // ISO date of last source verification
  tags: string[];
  /**
   * Which authored batch produced this record, e.g. 'track:python-core:v1'.
   * PDF-seeded records have no batch; the quota report counts a track's own
   * batch-tagged records so "+20 new per type" stays provable after merges.
   */
  batch?: string;
  /**
   * Provenance for records imported from the answer PDF by the curated pipeline in
   * scripts/lib/pdfqa.cjs. Present only on imported records, so a record can always be
   * traced back to the page it came from. Deliberately NOT `batch`: `isAuthored()` treats
   * any `batch` as hand-written, and the authorship quota counts `track:` batches.
   */
  pdfPage?: number;        // 1-based page in the source PDF
  pdfStage?: string;       // the PDF's stage band: LEARN | INTERVIEW | CODING LAB | …
  pdfImportance?: string;  // the PDF's own priority band: CRITICAL | HIGH | CORE
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
