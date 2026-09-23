import { useEffect, useState } from 'react';
import type { TopicBank, QuestionRecord, QuestionType, Difficulty } from './schema';

/**
 * Local question banks (offline content pack).
 * public/questions/manifest.json indexes every bank; each bank is fetched
 * lazily only when its section is opened — no 29-file fetch on page load.
 */
export interface BankManifestEntry {
  sectionId: string;
  no: number;
  title: string;
  total: number;
  published: number;
  byType: Record<QuestionType, number>;
  byDifficulty: Record<Difficulty, number>;
  flags: string[];
}
export interface BankManifest {
  generatedAt: string;
  baseline: number;
  total: number;
  published: number;
  sections: BankManifestEntry[];
}

export const QUESTION_TYPES: QuestionType[] = ['interview', 'coding', 'debug', 'logic', 'solved', 'checkpoint', 'theory'];
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

export const TYPE_LABEL: Record<QuestionType, string> = {
  interview: 'Interview',
  coding: 'Coding',
  debug: 'Debug',
  logic: 'Logic',
  solved: 'Solved',
  checkpoint: 'Checkpoint',
  theory: 'Theory',
};

/** Which Lesson stage a bank question belongs to (Practice button target). */
export const TYPE_STAGE: Record<QuestionType, string> = {
  interview: 'interview',
  coding: 'coding',
  debug: 'debug',
  logic: 'logic',
  solved: 'coding',
  checkpoint: 'checkpoint',
  theory: 'learn',
};

export function useBankManifest(): BankManifest | null {
  const [m, setM] = useState<BankManifest | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('./questions/manifest.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setM(d); })
      .catch(() => { if (alive) setM(null); });
    return () => { alive = false; };
  }, []);
  return m;
}

/** Lazy per-section bank loader. */
export function useBank(sectionId: string | undefined): TopicBank | null {
  const [bank, setBank] = useState<TopicBank | null>(null);
  useEffect(() => {
    if (!sectionId) { setBank(null); return; }
    let alive = true;
    setBank(null);
    fetch(`./questions/${sectionId}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setBank(d); })
      .catch(() => { if (alive) setBank(null); });
    return () => { alive = false; };
  }, [sectionId]);
  return bank;
}

export interface BankFilter {
  type: QuestionType | 'all';
  difficulty: Difficulty | 'all';
  search: string;
  includeDrafts: boolean;
}

/** Filter a bank client-side. Drafts stay hidden unless explicitly asked for. */
export function filterQuestions(questions: QuestionRecord[], f: BankFilter): QuestionRecord[] {
  const needle = f.search.trim().toLowerCase();
  return questions.filter((q) => {
    if (!f.includeDrafts && q.status !== 'PUBLISHED') return false;
    if (f.type !== 'all' && q.type !== f.type) return false;
    if (f.difficulty !== 'all' && q.difficulty !== f.difficulty) return false;
    if (needle && !`${q.question} ${q.answer} ${q.explanation} ${(q.tags ?? []).join(' ')}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** Count questions by any string field (type, difficulty, status…). */
/** Mistake-tracker type for a bank question (keeps the tracker's four buckets). */
export function mistakeTypeFor(t: QuestionType): 'code' | 'debug' | 'logic' | 'interview' {
  if (t === 'debug') return 'debug';
  if (t === 'logic') return 'logic';
  if (t === 'coding' || t === 'solved') return 'code';
  return 'interview'; // interview, checkpoint, theory
}

export function countByField(questions: QuestionRecord[], field: keyof QuestionRecord): Record<string, number> {
  return questions.reduce<Record<string, number>>((acc, q) => {
    const k = String(q[field]);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}
