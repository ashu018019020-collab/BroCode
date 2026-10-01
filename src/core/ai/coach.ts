/**
 * Offline coach decisions — WHO to re-teach and WHAT to re-ask, derived only
 * from real learner state.
 *
 * Two rules this module exists to guarantee:
 *
 *  1. **Every mistake counts, not just coding-lab ones.** A wrong answer in the
 *     Question Bank, a wrong answer under exam pressure, a failed logic card and
 *     a Python traceback all land in `state.mistakes`; the coach weighs them all,
 *     and it can tell you which surface you failed on (`source`).
 *  2. **Spaced repetition schedules the re-teaching.** A section's review level
 *     and due date are first-class inputs: due/overdue sections and sections reset
 *     to level 0 jump the queue, and the coach says out loud when the next
 *     re-teach is scheduled.
 *
 * This file imports TYPES ONLY. That keeps it loadable by Node's type stripping
 * (the same trick `engine/exam.ts` uses) so every rule below is unit-tested —
 * the spaced-repetition ladder itself stays owned by `engine/review.ts` and is
 * injected here as plain data.
 */
import type { AppState, Mistake, MistakeSource, Section } from '../../types';
import type { QuestionRecord, QuestionType, Difficulty } from '../data/schema';

/** A section's schedule, flattened for this module (built by the caller from review.ts). */
export interface CoachScheduleInput {
  level: number;
  intervalDays: number;
  due: boolean;
  daysLeft: number;
  overdueDays: number;
  /** Human line, e.g. "Review level 1 · 3-din interval · kal due". */
  text: string;
  /** What happens after coaching, e.g. "Coach ke baad → level 2 (7-din interval)". */
  nextText: string;
}

export interface CoachOptions {
  /** Null when the section was never reviewed. Injected so this engine stays pure. */
  scheduleOf?: (sectionId: string) => CoachScheduleInput | null;
}

export interface CoachMistake {
  id: string;
  topic: string;
  type: string;
  source: MistakeSource;
  /** "Question Bank self-grade · interview" */
  label: string;
  question: string;
  myAnswer: string;
  correct: string;
  attempts: number;
  date: string;
  /** Where this exact failure can be retried. */
  route: string;
  routeLabel: string;
}

export interface CoachCandidate {
  sectionId: string;
  title: string;
  score: number;
  /** Ordered, human-readable reasons — the coach never hides its reasoning. */
  reasons: string[];
  openMistakes: number;
  bankMistakes: number;
  topType: string | null;
  schedule: CoachScheduleInput | null;
}

/* ------------------------------ provenance ------------------------------ */

export const SOURCE_LABEL: Record<MistakeSource, string> = {
  bank: 'Question Bank self-grade',
  exam: 'Timed Exam',
  lesson: 'Lesson stage',
  lab: 'Code Playground',
  mock: 'Mock Interview',
  interview: 'Interview Mode',
  final: 'Final Assessment',
};

/** Sources that mean "a real question was marked wrong" (self-grade / exam). */
const BANK_SOURCES: MistakeSource[] = ['bank', 'exam'];

/** Records written before `source` existed fall back to their type. */
export function sourceOf(m: Mistake): MistakeSource {
  if (m.source) return m.source;
  if (m.section === 'mock') return 'mock';
  if (m.section === 'final') return 'final';
  if (m.section === 'interview-mode') return 'interview';
  if (m.section === 'playground') return 'lab';
  return 'lesson';
}

export const isBankMistake = (m: Mistake) => BANK_SOURCES.includes(sourceOf(m));

export const sourceLabel = (m: Mistake) => SOURCE_LABEL[sourceOf(m)];

/**
 * The redo pile — graded-question failures the learner has NOT fixed yet, plus the ones they have.
 *
 * Both halves are needed by the surface that prints it: the count is the figure, and the two together
 * are the only honest denominator for its rail (the share of that pile still owed).
 *
 * Why this exists: the Question Bank's fourth KPI card used to read "of 1450 baseline target" — a
 * CONTENT ratio. The pack published 13,865 questions against a 50-per-section baseline, 9.6x over its
 * own target, so `Math.min(100, published / baseline)` was pinned at 100% from the day the content
 * outgrew it and could never move again. A card that cannot move is a lie about progress, so that slot
 * reports learner work now: it climbs on every wrong answer, and falls on every fix.
 *
 * Takes the mistake list rather than `AppState` so it stays a tally over one collection, and borrows
 * the classification from this module — which is the only reason the figure can sit next to the bank's
 * answer counts without introducing a second idea of what "a question was marked wrong" means.
 */
export function bankRedo(mistakes: Mistake[]): { open: number; fixed: number } {
  let open = 0;
  let fixed = 0;
  for (const m of mistakes) {
    if (!isBankMistake(m)) continue;
    if (m.fixed) fixed += 1; else open += 1;
  }
  return { open, fixed };
}

const STAGE_FOR_TYPE: Record<string, string> = {
  debug: 'debug',
  logic: 'logic',
  interview: 'interview',
  final: 'interview',
  code: 'coding',
};
export const stageForMistakeType = (type: string) => STAGE_FOR_TYPE[type] ?? 'coding';

/**
 * Where to send the learner to retry THIS mistake. Bank and exam failures go back
 * to the bank/exam surface; a lesson failure goes to that section's exact stage.
 */
export function mistakeRoute(m: Mistake): { route: string; label: string } {
  const src = sourceOf(m);
  if (src === 'bank') return { route: '/questions', label: 'Question Bank me dobara' };
  if (src === 'exam') return { route: '/exam', label: 'Timed Exam dobara' };
  if (src === 'lab') return { route: '/playground', label: 'Playground me fix karo' };
  if (src === 'mock') return { route: '/mock', label: 'Mock round dobara' };
  if (src === 'interview') return { route: '/interview', label: 'Interview Mode dobara' };
  if (src === 'final') return { route: '/final', label: 'Final Assessment' };
  const stage = stageForMistakeType(m.type);
  return { route: `/lesson/${m.section}/${stage}`, label: `${String(m.section).toUpperCase()} ${stage} stage` };
}

/* ------------------------------ scheduling ------------------------------ */

/**
 * How much a section's review schedule pushes it up the queue. A section that is
 * overdue is urgent; a section reset to level 0 by a fresh wrong answer is the
 * weakest link, so it lands above sections comfortably mid-ladder.
 */
export function scheduleUrgency(info: CoachScheduleInput | null): number {
  if (!info) return 0;
  let n = 0;
  if (info.due) n += 12 + Math.min(info.overdueDays, 7) * 2;
  else if (info.daysLeft <= 1) n += 6;
  else if (info.daysLeft <= 3) n += 3;
  if (info.level === 0) n += 2;
  return n;
}

export function scheduleReason(info: CoachScheduleInput): string {
  if (info.due && info.overdueDays > 0) return `spaced repetition: ${info.overdueDays} din late (level ${info.level})`;
  if (info.due) return `spaced repetition: aaj due (level ${info.level})`;
  return `spaced repetition: ${info.daysLeft} din me due (level ${info.level})`;
}

/* ------------------------------- ranking -------------------------------- */

const sectionsById = (sections: Section[]) => new Map(sections.map((s) => [s.id, s]));

/** Open mistakes grouped by the real curriculum section they belong to. */
export function openBySection(state: AppState, sections: Section[]): Map<string, Mistake[]> {
  const ids = new Set(sections.map((s) => s.id));
  const grouped = new Map<string, Mistake[]>();
  for (const m of state.mistakes) {
    if (m.fixed || !ids.has(m.section)) continue;   // 'mock'/'final' aren't lesson sections
    const list = grouped.get(m.section) ?? [];
    list.push(m);
    grouped.set(m.section, list);
  }
  return grouped;
}

const mostCommonType = (list: Mistake[]): string | null => {
  const counts = new Map<string, number>();
  for (const m of list) counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
  let best: { type: string; n: number } | null = null;
  for (const [type, n] of counts) if (!best || n > best.n) best = { type, n };
  return best?.type ?? null;
};

/**
 * The coach's queue, best candidate first.
 *
 * score = open failures (5 each, capped at 4 → 20)
 *       + question-bank/exam failure bonus (5) — those were graded against a
 *         real model answer, so they are the closest thing to an interview miss
 *       + repeat-failure bonus (3)
 *       + schedule urgency (0–26)
 *
 * A section with NO mistakes can still be a candidate when its review is due —
 * that is spaced repetition doing its job, not new content.
 */
export function rankCandidates(
  state: AppState,
  sections: Section[],
  opts: CoachOptions = {},
): CoachCandidate[] {
  const byId = sectionsById(sections);
  const grouped = openBySection(state, sections);
  const out: CoachCandidate[] = [];

  for (const [sectionId, list] of grouped) {
    const section = byId.get(sectionId);
    if (!section) continue;
    const schedule = opts.scheduleOf?.(sectionId) ?? null;
    const bank = list.filter(isBankMistake).length;
    const repeat = list.some((m) => m.attempts > 1);
    const score =
      Math.min(list.length, 4) * 5 +
      (bank > 0 ? 5 : 0) +
      (repeat ? 3 : 0) +
      scheduleUrgency(schedule);

    const reasons: string[] = [`${list.length} open mistake${list.length === 1 ? '' : 's'}`];
    if (bank > 0) reasons.push(`${bank} Question Bank / Timed Exam se (model answer ke against galat)`);
    if (repeat) reasons.push('ek mistake dobara hui — pattern ban raha hai');
    if (schedule) reasons.push(scheduleReason(schedule));
    out.push({
      sectionId, title: section.title, score, reasons,
      openMistakes: list.length, bankMistakes: bank, topType: mostCommonType(list), schedule,
    });
  }

  // Due-for-review sections with a clean slate still need coaching.
  for (const sectionId of Object.keys(state.review)) {
    if (grouped.has(sectionId) || !byId.has(sectionId)) continue;
    const schedule = opts.scheduleOf?.(sectionId) ?? null;
    if (!schedule?.due) continue;
    const section = byId.get(sectionId)!;
    out.push({
      sectionId, title: section.title,
      score: scheduleUrgency(schedule),
      reasons: [scheduleReason(schedule)],
      openMistakes: 0, bankMistakes: 0, topType: null, schedule,
    });
  }

  return out.sort((a, b) => b.score - a.score || a.sectionId.localeCompare(b.sectionId));
}

/**
 * Which section the coach teaches right now. Falls back to the learner's
 * frontier section only when there is nothing to re-teach.
 */
export function coachSectionFor(
  state: AppState,
  sections: Section[],
  fallback: Section | null,
  fallbackWhy: string,
  opts: CoachOptions = {},
): { section: Section | null; why: string; schedule: CoachScheduleInput | null; candidates: CoachCandidate[] } {
  const candidates = rankCandidates(state, sections, opts);
  const top = candidates[0];
  const byId = sectionsById(sections);
  if (top) {
    const section = byId.get(top.sectionId) ?? null;
    if (section) {
      return {
        section,
        why: `${section.title} — ${top.reasons.join(' · ')}.`,
        schedule: top.schedule,
        candidates,
      };
    }
  }
  return { section: fallback, why: fallbackWhy, schedule: fallback ? opts.scheduleOf?.(fallback.id) ?? null : null, candidates };
}

/* ------------------------------- retakes -------------------------------- */

/**
 * The mistakes the coach opens with — the learner's own failures, in the order
 * they hurt most: question-bank/exam misses first, then repeats, then recency.
 * Nothing here is generated; every field comes from the stored record.
 */
export function buildRetakes(section: Section, state: AppState, limit = 5): CoachMistake[] {
  const list = state.mistakes
    .filter((m) => !m.fixed && m.section === section.id)
    .sort((a, b) =>
      Number(isBankMistake(b)) - Number(isBankMistake(a)) ||
      b.attempts - a.attempts ||
      String(b.date).localeCompare(String(a.date)));

  return list.slice(0, limit).map((m) => {
    const { route, label } = mistakeRoute(m);
    return {
      id: m.id,
      topic: m.topic,
      type: m.type,
      source: sourceOf(m),
      label: `${sourceLabel(m)} · ${m.type}`,
      question: m.question,
      myAnswer: m.myAnswer,
      correct: m.correct,
      attempts: m.attempts,
      date: m.date,
      route,
      routeLabel: label,
    };
  });
}

/* -------------------------------- drills -------------------------------- */

const BANK_TYPE_FOR_MISTAKE: Record<string, QuestionType> = {
  interview: 'interview',
  final: 'interview',
  logic: 'logic',
  debug: 'debug',
  code: 'coding',
};

/** The bank/section type the learner keeps failing in this section. */
export function failingType(section: Section, state: AppState): string {
  const list = state.mistakes.filter((m) => !m.fixed && m.section === section.id);
  const weighted = list.map((m) => ({ type: m.type, w: isBankMistake(m) ? 2 : 1 }));
  const counts = new Map<string, number>();
  for (const { type, w } of weighted) counts.set(type, (counts.get(type) ?? 0) + w);
  let best: { type: string; n: number } | null = null;
  for (const [type, n] of counts) if (!best || n > best.n) best = { type, n };
  return best?.type ?? 'coding';
}

/**
 * A fresh question of the type the learner failed, straight from the real bank.
 * Only PUBLISHED questions are eligible, never one already answered correctly,
 * and never the exact question that was just shown as a retake.
 */
export function nextBankDrill(
  bankQuestions: QuestionRecord[],
  type: string,
  doneQuestionIds: Set<string>,
  avoidQuestions: string[] = [],
): { question: QuestionRecord; bankType: QuestionType } | null {
  const bankType = BANK_TYPE_FOR_MISTAKE[type] ?? 'coding';
  const avoid = new Set(avoidQuestions.map((q) => q.trim().slice(0, 120)));
  const pool = bankQuestions
    .filter((q) => q.status === 'PUBLISHED')
    .filter((q) => q.type === bankType)
    .filter((q) => !doneQuestionIds.has(q.id))
    .filter((q) => !avoid.has(q.question.trim().slice(0, 120)));
  if (!pool.length) return null;
  const order: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
  const sorted = pool.slice().sort(
    (a, b) => order.indexOf(a.difficulty) - order.indexOf(b.difficulty) || a.id.localeCompare(b.id),
  );
  return { question: sorted[0], bankType };
}
