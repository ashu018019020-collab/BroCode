import { useEffect, useState } from 'react';
import type { TopicBank, QuestionRecord, QuestionType, Difficulty } from './schema';
import type { Section } from '../types';

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
  /**
   * Item counts per LESSON stage (`learn`, `coding`, `mini`, …) — the number of questions the
   * stage's panel actually shows, i.e. after the stage's own extracted Q&A is removed. Written by
   * `npm run questions:seed`/`:merge`; the stage tiles read this instead of re-deriving a count
   * from `byType`, which cannot know what the panel skipped.
   */
  byStage?: Record<string, number>;
  /** MINI PROJECT reuses the `coding` type, so the manifest splits it out by tag. */
  miniProject?: number;
  flags: string[];
}
export interface BankManifest {
  generatedAt: string;
  baseline: number;
  total: number;
  published: number;
  sections: BankManifestEntry[];
}

export const QUESTION_TYPES: QuestionType[] = ['theory', 'interview', 'coding', 'logic', 'debug', 'solved', 'defense', 'checkpoint'];

/**
 * How many questions one page of a stage shows. Shared by the in-lesson panel and the Question
 * Bank page: the same slice of the same bank used to page 10 at a time in a lesson and 25 on the
 * bank page, which made the two views of one list feel like different content.
 */
export const STAGE_PAGE_SIZE = 25;
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

export const TYPE_LABEL: Record<QuestionType, string> = {
  interview: 'Interview',
  coding: 'Coding',
  debug: 'Debug',
  logic: 'Logic',
  solved: 'Solved',
  checkpoint: 'Checkpoint',
  theory: 'Theory',
  defense: 'Defense',
};

/**
 * The bank slice each LESSON stage shows as its own on-page Q&A, so a learner practises a
 * stage without leaving it. One map for both the panel and the stage-tile counts, so the
 * number on the tile can never disagree with the number of questions behind it.
 *
 * `mini` and `coding` share the `coding` type — MINI PROJECT items carry the `mini-project`
 * tag — and `project` has no bank stage: the PDF has no project-lab band, that stage is
 * built from the section's own project tiers.
 */
export const STAGE_QNA: Record<string, { types: QuestionType[]; tag?: string; label: string }> = {
  learn: { types: ['theory'], label: 'Concepts & Theory' },
  interview: { types: ['interview'], label: 'Interview Q&A' },
  coding: { types: ['coding'], label: 'Coding Lab' },
  logic: { types: ['logic'], label: 'Logic' },
  debug: { types: ['debug'], label: 'Debug' },
  solved: { types: ['solved'], label: 'Practice Solutions' },
  mini: { types: ['coding'], tag: 'mini-project', label: 'Mini Project' },
  defense: { types: ['defense'], label: 'Defense' },
  checkpoint: { types: ['checkpoint'], label: 'Checkpoint' },
};

/** Lesson stages in the order the bank content should be practised. */
export const QNA_STAGES = Object.keys(STAGE_QNA);

/**
 * Reverse index built once from STAGE_QNA: for each question `type`, the stage(s) that show it.
 * Never hand-written — a stage added to STAGE_QNA is registered here by the same loop, so the
 * link a question generates and the panel that renders it cannot drift apart.
 */
const STAGE_OWNERS: Partial<Record<QuestionType, { stage: string; tag?: string }[]>> = {};
for (const stage of QNA_STAGES) {
  for (const type of STAGE_QNA[stage].types) (STAGE_OWNERS[type] ??= []).push({ stage, tag: STAGE_QNA[stage].tag });
}

/**
 * The Lesson stage that actually renders this question — the target of its "Practice" link.
 *
 * Read off STAGE_QNA via STAGE_OWNERS, never from a parallel table: a hand-written `TYPE_STAGE`
 * used to live here claiming `solved → coding`, which sent the learner to a stage whose panel
 * does not contain the question they clicked. `coding` is the one type two stages share — MINI
 * PROJECT items carry the `mini-project` tag — so the tag decides between them. The last-resort
 * `learn` is unreachable while every QUESTION_TYPES entry is claimed (locked by lessonqna.test).
 */
export function stageForQuestion(q: Pick<QuestionRecord, 'type' | 'tags'>): string {
  const owners = STAGE_OWNERS[q.type] ?? [];
  if (owners.length === 1) return owners[0].stage;
  const isMini = (q.tags ?? []).includes('mini-project');
  return (owners.find((o) => !!o.tag === isMini) ?? owners[0])?.stage ?? 'learn';
}

/**
 * The section's bank items for one lesson stage, published first-class items only.
 * `coding` excludes the mini-project items; `mini` is exactly them.
 *
 * `ownTexts` are the questions the stage component above the panel already renders itself (see
 * `stageOwnTexts`). They are skipped here so one page never asks the same question twice: 502
 * bank items are verbatim copies of the section's own extracted Q&A, and the stage's copy is the
 * one that carries the mastery gate and the richer affordances.
 */
export function stageQuestions(bank: TopicBank | null | undefined, stage: string, ownTexts: string[] = []): QuestionRecord[] {
  const spec = STAGE_QNA[stage];
  if (!bank || !spec || !Array.isArray(bank.questions)) return [];
  const wanted = new Set(spec.types);
  const own = new Set(ownTexts);
  return bank.questions.filter((q) => {
    if (q.status !== 'PUBLISHED') return false;   // drafts stay out of the lesson, as in the bank UI
    if (!wanted.has(q.type)) return false;
    if (q.type !== 'coding') return !own.has(normText(q.question));
    const isMini = (q.tags ?? []).includes('mini-project');
    if (spec.tag ? !isMini : isMini) return false;
    return !own.has(normText(q.question));
  });
}

/**
 * Which array of the section's OWN workspace a lesson stage renders by itself.
 *
 * Several stages already show their own extracted Q&A — Interview shows `sec.interview`, Coding
 * Lab `sec.coding`, Logic `sec.logic`, Practice `sec.solved`, Checkpoint `sec.checkpoint` — and
 * the bank holds verbatim copies of many of them. The stage's copy wins (it owns the gate key),
 * so the panel below skips it.
 *
 * `debug` and `learn` are absent on purpose: the Debug stage renders `sec.coding` entries flagged
 * `difficulty: 'debug'` rather than a bucket of its own, and the Learn stage renders concepts, not
 * Q&A — neither has a measured overlap with the bank, so neither needs a dedupe.
 */
export const STAGE_OWN_ARRAY: Partial<Record<string, 'interview' | 'coding' | 'logic' | 'solved' | 'checkpoint'>> = {
  interview: 'interview', coding: 'coding', logic: 'logic', solved: 'solved', checkpoint: 'checkpoint',
};

/** Whitespace/case-insensitive text key — the same comparison the pipeline's `norm` makes. */
export const normText = (s: string) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The question texts a stage renders itself. Read straight off the section — never a copy that a
 * human has to keep in sync. The Coding Lab's debug entries are left out because the Coding Lab
 * does not show them; they belong to the Debug stage.
 */
export function stageOwnTexts(stage: string, section: Section | null | undefined): string[] {
  if (!section) return [];
  const out: string[] = [];
  switch (STAGE_OWN_ARRAY[stage]) {
    case 'interview': for (const x of section.interview ?? []) out.push(normText(x.q)); break;
    case 'coding': for (const x of section.coding ?? []) if (x.difficulty !== 'debug') out.push(normText(x.text)); break;
    case 'logic': for (const x of section.logic ?? []) out.push(normText(x.text)); break;
    case 'solved': for (const x of section.solved ?? []) out.push(normText(x.text)); break;
    case 'checkpoint': for (const x of section.checkpoint ?? []) out.push(normText(x.q)); break;
    default: break;
  }
  return out.filter(Boolean);
}

/**
 * How many questions a stage has, from the manifest alone (12 KB, already loaded), so the
 * stage tiles can show a real number without fetching the section's ~400 KB bank.
 * Returns null for a stage with no bank content — the tile then shows no badge at all.
 */
export function manifestStageCount(manifest: BankManifest | null, sectionId: string, stage: string): number | null {
  const entry = manifest?.sections.find((s) => s.sectionId === sectionId);
  const spec = STAGE_QNA[stage];
  if (!entry || !spec) return null;
  // The manifest's own per-stage number comes first: the panel skips the questions the stage
  // renders itself, so summing `byType` would over-count and the tile would promise more
  // questions than the learner can find. A manifest written before `byStage` existed has no
  // number, and there the old sum is the best available answer.
  const reported = entry.byStage?.[stage];
  if (typeof reported === 'number') return reported;
  if (spec.tag) return entry.miniProject ?? 0;
  const n = spec.types.reduce((acc, t) => acc + (entry.byType?.[t] ?? 0), 0);
  return stage === 'coding' ? Math.max(0, n - (entry.miniProject ?? 0)) : n;
}

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

/**
 * Exam mode needs to choose questions ACROSS sections, so it reads every bank
 * once and keeps it in memory for the session. Still lazy: nothing is fetched
 * until an exam screen asks for it, and a re-mount reuses the cached copy.
 */
let allBanksCache: TopicBank[] | null = null;
let allBanksInflight: Promise<TopicBank[]> | null = null;

export function loadAllBanks(manifest: BankManifest): Promise<TopicBank[]> {
  if (allBanksCache) return Promise.resolve(allBanksCache);
  if (!allBanksInflight) {
    allBanksInflight = Promise.all(
      manifest.sections.map((s) =>
        fetch(`./questions/${s.sectionId}.json`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    ).then((banks) => {
      allBanksCache = (banks.filter((b) => b && Array.isArray(b.questions)) as TopicBank[]).sort(
        (a, b) => String(a.sectionId).localeCompare(String(b.sectionId)),
      );
      allBanksInflight = null;
      return allBanksCache;
    });
  }
  return allBanksInflight;
}

export function useAllBanks(manifest: BankManifest | null): TopicBank[] | null {
  const [banks, setBanks] = useState<TopicBank[] | null>(allBanksCache);
  useEffect(() => {
    if (!manifest) return;
    let alive = true;
    loadAllBanks(manifest).then((b) => { if (alive) setBanks(b); }).catch(() => { if (alive) setBanks([]); });
    return () => { alive = false; };
  }, [manifest]);
  return banks;
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
  if (t === 'defense') return 'interview'; // defense is an oral-answer failure, not a code bug
  return 'interview'; // interview, checkpoint, theory
}

/** Authored (non-PDF) records carry source 'authored' — the UI labels them honestly. */
export function isAuthored(q: QuestionRecord): boolean {
  return q.source === 'authored' || !!q.batch;
}

export function countByField(questions: QuestionRecord[], field: keyof QuestionRecord): Record<string, number> {
  return questions.reduce<Record<string, number>>((acc, q) => {
    const k = String(q[field]);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}
