/**
 * The interview room — the rules behind the subject-wise interview system.
 *
 * The recovery this module exists for: the question banks already hold every kind of
 * interview-eligible material (concept Q&A, coding, debugging, logic, project/defense,
 * challenges), tagged with a canonical id, section, difficulty and status — and the interview
 * surfaces only ever read the curriculum's own Q&A. So an interview kind is NOT a new question
 * set: it is a VIEW over the canonical bank records, selected by `type` (and the `mini-project`
 * tag, which must stay out of coding interviews). One question, one record, many surfaces — the
 * same `sNN:type:i` id the Question Bank writes its `qb:` attempt under, so progress is shared
 * and nothing is copied.
 *
 * Pure on purpose: no React, no store, no fetch (see the loader ceiling in AGENTS.md), so
 * `scripts/tests/interview-room.test.mjs` drives every rule with fixtures AND against the real
 * manifest. The manifest section shape is declared here rather than imported from the loader —
 * `core/data/questions.ts` imports React, and an engine may not.
 */
import type { QuestionType, QuestionRecord } from '../data/schema';
import type { SubjectRange } from '../learning/subjects';
import { BANK_ATTEMPT_PREFIX } from '../platform/keys';

/* --------------------------------- the kinds -------------------------------- */

export type InterviewKindId = 'concept' | 'coding' | 'debug' | 'logic' | 'project' | 'challenge';

export interface InterviewKind {
  id: InterviewKindId;
  label: string;
  emoji: string;
  /** The canonical bank types this kind is a view over. */
  types: QuestionType[];
  blurb: string;
}

/**
 * The six interview kinds, each a view over real bank types.
 *
 * The mapping is deliberately exhaustive over the bank's interview-eligible types: `checkpoint`
 * is the ONE exclusion — it is a scored assessment band (its own surface, /final-assessment and
 * the lesson's checkpoint stage), not an interview round, and counting it here would make the
 * interview total overlap the assessment total. `theories` map to `concept` beside `interview`,
 * because a theory question ("What is the difference between X and Y?") is exactly what a concept
 * interview asks. `defense` maps to `project`, `solved` to `challenge` (try-first exercises).
 * MINI-PROJECT items reuse the `coding` type with a tag and are excluded — they are builds, not
 * interview coding questions.
 */
export const INTERVIEW_KINDS: InterviewKind[] = [
  { id: 'concept', label: 'Concept', emoji: '📚', types: ['interview', 'theory'], blurb: 'Definition, difference, why-it-works questions' },
  { id: 'coding', label: 'Coding', emoji: '💻', types: ['coding'], blurb: 'Write-and-run problems, no mini-project builds' },
  { id: 'debug', label: 'Debugging', emoji: '🐞', types: ['debug'], blurb: 'Broken code: find it, explain it, fix it' },
  { id: 'logic', label: 'Logic', emoji: '🧠', types: ['logic'], blurb: 'Predict, trace, reason — the round that trips people' },
  { id: 'project', label: 'Project & Defense', emoji: '🛡️', types: ['defense'], blurb: 'Explain your build, defend your decisions' },
  { id: 'challenge', label: 'Challenge', emoji: '🔥', types: ['solved'], blurb: 'Try first, then compare with the answer key' },
];

/** Presentation order / lookup. */
export const KIND_BY_ID: Record<InterviewKindId, InterviewKind> = Object.fromEntries(
  INTERVIEW_KINDS.map((k) => [k.id, k]),
) as Record<InterviewKindId, InterviewKind>;

/** The one bank type deliberately NOT an interview kind — a scored assessment band. */
export const ASSESSMENT_TYPES: QuestionType[] = ['checkpoint'];

/**
 * The kind a canonical bank record belongs to, or null when it is not interview material.
 * MINI-PROJECT items carry the `coding` type plus a tag; they belong to the Project Lab.
 */
export function kindOf(q: Pick<QuestionRecord, 'type' | 'tags'>): InterviewKindId | null {
  for (const kind of INTERVIEW_KINDS) {
    if (!kind.types.includes(q.type)) continue;
    if (kind.id === 'coding' && (q.tags ?? []).includes('mini-project')) return null;
    return kind.id;
  }
  return null;
}

/** Published records only — a draft is not something an interviewer can ask. */
export const isInterviewEligible = (q: QuestionRecord): boolean =>
  q.status === 'PUBLISHED' && kindOf(q) !== null;

/** The eligible records inside one loaded bank, in bank order. */
export function eligibleInBank(bank: { questions?: QuestionRecord[] } | null | undefined): QuestionRecord[] {
  return (bank?.questions ?? []).filter(isInterviewEligible);
}

/* --------------------------- counts from the manifest --------------------------- */

/** The manifest fields these rules read (declared locally: the loader imports React). */
export interface ManifestSectionLike {
  sectionId: string;
  no: number;
  title: string;
  published: number;
  byType: Record<string, number>;
  miniProject?: number;
}

/**
 * Per-kind counts for one manifest section.
 *
 * A `coding` count subtracts the section's `miniProject` tally: those items are the Project Lab's
 * builds wearing the coding type, and offering them as coding-interview questions would promise
 * a question that is really a build brief.
 */
export function kindCounts(entry: ManifestSectionLike): Record<InterviewKindId, number> {
  const out = { concept: 0, coding: 0, debug: 0, logic: 0, project: 0, challenge: 0 } as Record<InterviewKindId, number>;
  for (const kind of INTERVIEW_KINDS) {
    let n = kind.types.reduce((a, t) => a + (entry.byType?.[t] ?? 0), 0);
    if (kind.id === 'coding') n = Math.max(0, n - (entry.miniProject ?? 0));
    out[kind.id] = n;
  }
  return out;
}

export interface SubjectInterview {
  id: string;
  from: number;
  to: number;
  /** Only kinds the subject really holds — a kind with zero items is not a category. */
  kinds: { id: InterviewKindId; count: number }[];
  total: number;
  sections: ManifestSectionLike[];
}

/** One subject's interview inventory, from the manifest and the track ranges. */
export function subjectInterview(range: SubjectRange, sections: ManifestSectionLike[]): SubjectInterview {
  const mine = sections.filter((s) => s.no >= range.from && s.no <= range.to);
  const totals = { concept: 0, coding: 0, debug: 0, logic: 0, project: 0, challenge: 0 } as Record<InterviewKindId, number>;
  for (const s of mine) {
    const c = kindCounts(s);
    for (const k of INTERVIEW_KINDS) totals[k.id] += c[k.id];
  }
  return {
    id: range.id,
    from: range.from,
    to: range.to,
    kinds: INTERVIEW_KINDS.map((k) => ({ id: k.id, count: totals[k.id] })).filter((k) => k.count > 0),
    total: INTERVIEW_KINDS.reduce((a, k) => a + totals[k.id], 0),
    sections: mine,
  };
}

/** Every subject's inventory, in registry order. */
export function subjectInterviews(ranges: SubjectRange[], sections: ManifestSectionLike[]): SubjectInterview[] {
  return ranges.map((r) => subjectInterview(r, sections));
}

/**
 * Sections with NO interview-eligible item, given the whole manifest.
 *
 * Exported because "no orphan interview data" has a mirror image: a section that teaches
 * something and offers no interview question at all is a hole in the interview system, and the
 * test holds this list empty rather than trusting a UI that would simply not render it.
 */
export function sectionsWithoutInterview(sections: ManifestSectionLike[]): string[] {
  return sections.filter((s) => INTERVIEW_KINDS.every((k) => kindCounts(s)[k.id] === 0)).map((s) => s.sectionId);
}

/* ------------------------- the intelligent selection ------------------------- */

export interface AttemptLike { done?: boolean; score?: number; ts?: number }

/** Days after which a completed question counts as due for review. */
export const REVIEW_DAYS = 14;
const DAY_MS = 86_400_000;

/**
 * The candidate ladder, lowest tier first. Documented once, tested directly:
 *
 *   0  unseen, in a section the learner keeps getting wrong   → highest value
 *   1  unseen, anywhere
 *   2  seen and NOT passed, weak section
 *   3  seen and NOT passed
 *   4  passed, untouched for REVIEW_DAYS (review due)
 *   5  passed (or newly passed) — the fallback, oldest first inside the tier
 *
 * `avoid` is the ids shown in this session; a question never repeats inside one sitting. When
 * every candidate is avoided (a sitting longer than the pool) the avoid set is dropped for that
 * step rather than returning "no question", and the caller ends the sitting at the pool size.
 * `rng` breaks ties so two starts of the same session are not the same list, and an injected rng
 * in tests makes the choice deterministic.
 */
export function pickQuestion(
  pool: { id: string; sectionId: string }[],
  attempts: Record<string, AttemptLike>,
  opts: { weak?: Set<string>; avoid?: Set<string>; rng?: () => number; now?: number } = {},
): string | null {
  const weak = opts.weak ?? new Set<string>();
  const avoid = opts.avoid ?? new Set<string>();
  const rng = opts.rng ?? Math.random;
  const now = opts.now ?? Date.now();

  const tierOf = (q: { id: string; sectionId: string }): number | null => {
    const a = attempts[q.id];
    if (!a) return weak.has(q.sectionId) ? 0 : 1;
    if (a.done !== true) return weak.has(q.sectionId) ? 2 : 3;
    const age = now - (a.ts ?? 0);
    return age >= REVIEW_DAYS * DAY_MS ? 4 : 5;
  };

  const fresh = pool.filter((q) => !avoid.has(q.id));
  const from = fresh.length ? fresh : pool;   // everything avoided → the sitting is longer than the pool
  let best: { id: string; tier: number } | null = null;
  for (const q of from) {
    const tier = tierOf(q);
    if (tier === null) continue;
    if (!best || tier < best.tier || (tier === best.tier && rng() < 0.5)) best = { id: q.id, tier };
  }
  return best?.id ?? null;
}

/**
 * The section order one sitting walks.
 *
 * Weighted sampling WITHOUT replacement: a subject's sections are steps, and starting the round
 * in a section the learner has no content in is not possible — only sections with eligible items
 * enter the plan. `size` caps the sitting (Quick = 1 question, sessions 5–20); when the subject
 * has fewer eligible sections than the sitting asks for, the plan is that shorter list rather
 * than a padded one with repeats.
 */
export function planSections(
  range: SubjectRange,
  sections: ManifestSectionLike[],
  kind: InterviewKindId,
  size: number,
  rng: () => number = Math.random,
): string[] {
  const pool = sections
    .filter((s) => s.no >= range.from && s.no <= range.to)
    .map((s) => ({ id: s.sectionId, w: Math.max(0, kindCounts(s)[kind]) }))
    .filter((s) => s.w > 0);
  const out: string[] = [];
  while (out.length < size && pool.length) {
    const total = pool.reduce((a, s) => a + s.w, 0);
    let roll = rng() * total;
    let at = pool.length - 1;
    for (let i = 0; i < pool.length; i += 1) {
      roll -= pool[i].w;
      if (roll <= 0) { at = i; break; }
    }
    out.push(pool[at].id);
    pool.splice(at, 1);
  }
  return out;
}

/* ------------------------------ progress figures ------------------------------ */

export interface KindProgress { id: InterviewKindId; done: number; total: number; pct: number }

/**
 * Answers recorded per kind, and the kind's pool size, for one subject range.
 *
 * `done` counts saved attempt records (`qb:<sid>:<type>:<i>` — the keys the Question Bank and
 * this room both write, read off the id's own segments), the coverage-true count of "an answer
 * exists here". One honest caveat, stated rather than hidden: a MINI-PROJECT build shares the
 * `coding` type in its id, so the coding meter can include a build answer in its numerator; the
 * denominator already excludes mini projects. The hub labels the figure "answers recorded" for
 * exactly that reason, and the room — which has the loaded bank, tags and all — is where the
 * exact coding set is picked from.
 */
export function kindProgress(
  attempts: Record<string, AttemptLike>,
  range: SubjectRange,
  sections: ManifestSectionLike[],
): KindProgress[] {
  const inRange = new Set(
    sections.filter((s) => s.no >= range.from && s.no <= range.to).map((s) => s.sectionId),
  );
  const done = { concept: 0, coding: 0, debug: 0, logic: 0, project: 0, challenge: 0 } as Record<InterviewKindId, number>;
  for (const key of Object.keys(attempts)) {
    // The family prefix comes from its owner (keys.ts) — an engine never spells a key shape.
    if (!key.startsWith(BANK_ATTEMPT_PREFIX)) continue;
    const [sid, type] = key.slice(BANK_ATTEMPT_PREFIX.length).split(':');
    if (!inRange.has(sid)) continue;
    const kind = TYPE_KIND[type];
    if (kind) done[kind] += 1;
  }
  const mine = sections.filter((s) => s.no >= range.from && s.no <= range.to);
  return INTERVIEW_KINDS.map((kind) => {
    const total = mine.reduce((a, s) => a + kindCounts(s)[kind.id], 0);
    return { id: kind.id, done: done[kind.id], total, pct: total > 0 ? Math.round((done[kind.id] / total) * 100) : 0 };
  });
}

/** The sitting sizes the room offers. `quick` is one question — the "fresh question" button. */
export const SESSION_SIZES = [1, 5, 10, 15, 20] as const;
export type SessionSize = (typeof SESSION_SIZES)[number];

/**
 * Where the learner left off: the most recently answered interview-eligible question, as
 * {sectionId, id, kind, ts}. It reads the SAME `qb:` records the bank writes, so "continue"
 * cannot point at a question that was never answered — the id's own segments name the section
 * and the type (schema.ts: `<sectionId>:<type>:<index>`).
 */
export function lastInterviewTouch(
  attempts: Record<string, AttemptLike>,
): { id: string; sectionId: string; kind: InterviewKindId; ts: number } | null {
  let best: { id: string; sectionId: string; kind: InterviewKindId; ts: number } | null = null;
  for (const [key, a] of Object.entries(attempts)) {
    if (!key.startsWith(BANK_ATTEMPT_PREFIX) || !a?.ts) continue;
    const id = key.slice(BANK_ATTEMPT_PREFIX.length);
    const [sectionId, type] = id.split(':');
    const kind = TYPE_KIND[type];
    if (!kind || !sectionId) continue;
    if (!best || a.ts > best.ts) best = { id, sectionId, kind, ts: a.ts };
  }
  return best;
}

/** The `type → kind` table the bank page and the room both need (ids are `sid:type:i`). */
export const TYPE_KIND: Record<string, InterviewKindId | undefined> = Object.fromEntries(
  INTERVIEW_KINDS.flatMap((k) => k.types.map((t) => [t, k.id])),
);
