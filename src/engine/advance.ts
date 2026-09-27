/**
 * "Aur ab?" — what to open the moment something is completed.
 *
 * The lesson used to congratulate the learner and leave them sitting on the finished screen:
 * task 4 done meant task 4 still open, every stage done meant the last stage stayed open, and a
 * mastered section never pointed anywhere. This module answers the only question left after a
 * completion, from the SAME gates the progress engine uses (`stagePassed`), so the suggestion can
 * never point at something already done and can never skip a gate that still blocks mastery.
 *
 * The ladder it walks, in order:
 *   1. another unfinished item inside this stage  → same page, next task/card selected
 *   2. the next stage of this section that is not passed yet → navigate
 *   3. the next section that is not mastered yet → navigate to its Learn stage
 *   4. nothing left → the review queue (spaced repetition keeps it sharp)
 *
 * Pure functions only: no React, no storage. `npm test` locks the ladder down.
 */
import type { Section, AppState } from '../types';
import {
  STAGES, STAGE_META, STAGE_PASS, sectionProgress, stagePassed, stageApplies, isMastered,
  codingTasks, type Stage,
} from './progress';
import { itemAttempt } from './keys';

export interface NextStep {
  /** item = another task/card in this stage · stage = next stage · section = next section · review = done. */
  kind: 'item' | 'stage' | 'section' | 'review';
  /** 0-based index of the next item to select when `kind === 'item'` (inside the same stage). */
  index?: number;
  /** Short action label, e.g. "Task 5 / 8". */
  label: string;
  /** One line explaining why this is next, in the learner's voice. */
  hint: string;
  /** Where to go for a 'stage' / 'section' / 'review' step. Empty for 'item'. */
  route: string;
}

/** A step of the road ahead, as rendered by the lesson's "Aage ka plan" panel. */
export interface RoadmapStep {
  key: string;
  kind: 'item' | 'stage' | 'section' | 'review';
  icon: string;
  label: string;
  hint: string;
  /** Where to go. Empty for the immediate item, which is selected on the page you are already on. */
  route: string;
  /** The item to select when `kind === 'item'`. */
  index?: number;
  minutes: string;
  /** The single thing to do right now — always row 0. */
  now: boolean;
}

/**
 * The gated items a stage shows, in display order — the same list the stage renders.
 * Only stages with a per-item gate appear here. A stage whose gate is a single record must not:
 * the ladder would then count items nobody can tick, so "N item baaki" could never reach zero.
 * interview/defense/checkpoint/mini/project/debug are scored or single gates.
 *
 * For `learn` the item key is written by the concept notebook in the sidebar (`onComplete`), which
 * is exactly what the "N/M tried" counter reads — one gate per concept, so it belongs here.
 */
export function stageItems(sec: Section, stage: Stage): { count: number; name: (i: number) => string } | null {
  if (stage === 'learn') return { count: sec.learn.concepts.length, name: (i) => `Concept ${i + 1}` };
  if (stage === 'coding') return { count: codingTasks(sec).length, name: (i) => `Task ${i + 1}` };
  if (stage === 'logic') return { count: sec.logic.length, name: (i) => `Card ${i + 1}` };
  if (stage === 'solved') return { count: sec.solved.length, name: (i) => `Practice ${i + 1}` };
  return null;
}

/** Has this item's own gate been recorded? Mirrors the key the stage component writes. */
export function itemDone(sec: Section, state: AppState, stage: Stage, i: number): boolean {
  if (stage === 'learn' || stage === 'coding' || stage === 'logic' || stage === 'solved') {
    return !!state.attempts[itemAttempt(sec.id, stage, i)]?.done;
  }
  return false;
}

/** Unfinished items left in a stage (by its own item gates, not the stage-wide score). */
export function openItems(sec: Section, state: AppState, stage: Stage): number {
  const items = stageItems(sec, stage);
  if (!items) return 0;
  let n = 0;
  for (let i = 0; i < items.count; i++) if (!itemDone(sec, state, stage, i)) n += 1;
  return n;
}

/**
 * The next unfinished item after `after`, wrapping around once so a learner who skipped task 2
 * is sent back to it instead of being told the stage is over.
 */
export function nextItemIndex(sec: Section, state: AppState, stage: Stage, after: number): number | null {
  const items = stageItems(sec, stage);
  if (!items || items.count === 0) return null;
  for (let k = 1; k <= items.count; k++) {
    const i = (after + k) % items.count;
    if (!itemDone(sec, state, stage, i)) return i;
  }
  return null;
}

/**
 * The next stage that still blocks mastery, searching forward first and then wrapping to any
 * earlier stage that was never finished. Non-applicable stages (no debug task, no checkpoint
 * bank) are skipped by `stagePassed`, never suggested.
 */
export function nextOpenStage(sec: Section, state: AppState, after: Stage | null): Stage | null {
  const order = STAGES as readonly Stage[];
  const start = after ? Math.max(0, order.indexOf(after) + 1) : 0;
  for (let i = start; i < order.length; i++) if (!stagePassed(sec, state, order[i])) return order[i];
  for (let i = 0; i < start; i++) if (!stagePassed(sec, state, order[i])) return order[i];
  return null;
}

/** The next section that is not mastered yet — after this one first, then anywhere. */
export function nextOpenSection(sections: Section[], state: AppState, afterSid: string): Section | null {
  const i = sections.findIndex((s) => s.id === afterSid);
  const later = i >= 0 ? sections.slice(i + 1).find((s) => !isMastered(s, state)) : undefined;
  return later ?? sections.find((s) => !isMastered(s, state)) ?? null;
}

export const stageMinutes = (stage: Stage): string => {
  if (stage === 'coding') return '~10 min';
  if (stage === 'logic') return '~5 min';
  if (stage === 'solved') return '~10 min';
  if (stage === 'checkpoint') return '~10 min';
  return '~15 min';
};

/**
 * The road ahead: the same ladder `planNextStep` walks, laid out in advance so the learner can see
 * the plan instead of discovering it one completion at a time.
 *
 * It answers a different question from `planNextStep` — not "what comes after what I just did",
 * but "where does this go from here" — so the first row is deliberately the next real action on
 * THIS page: the next open item of the stage you are on, or the stage itself when it is a scored
 * or single gate that has not passed yet. After that come the stages that still block this
 * section, in the ladder's own forward-then-wrap order (so a stage that was skipped earlier is
 * shown rather than quietly dropped), and the last row is the exit: the next topic, or the review
 * queue once the whole course is mastered.
 *
 * Nothing that is already passed can appear, and a stage the section has no content for can never
 * appear at all — the same gates as everywhere else. `middle` caps the stage rows so the panel
 * stays a glance rather than a syllabus; the exit row says how many it left out, so the short
 * list is never a lie.
 *
 * `after` means "the item on screen right now" (unlike `planNextStep`, where it means "the item
 * just finished"). While that item is still open it IS the next step — a preview that pointed at
 * task 6 while you are working on task 5 would simply be wrong.
 */
export function planAhead(
  sections: Section[],
  sec: Section,
  state: AppState,
  stage: Stage,
  after?: number,
  middle = 2,
): RoadmapStep[] {
  const order = STAGES as readonly Stage[];
  const out: RoadmapStep[] = [];

  // 1 — the one thing to do right now
  const items = stageItems(sec, stage);
  const onScreen = after !== undefined && after >= 0 && !!items && after < items.count && !itemDone(sec, state, stage, after);
  const nextItem = items ? (onScreen ? after! : nextItemIndex(sec, state, stage, after ?? -1)) : null;
  if (items && nextItem !== null) {
    out.push({
      key: `now:${sec.id}:${stage}`,
      kind: 'item',
      icon: STAGE_META[stage].icon,
      label: `${items.name(nextItem)} / ${items.count}`,
      hint: `${openItems(sec, state, stage)} item baaki — pehle yahi, phir agla khud khulega (${stageMinutes(stage)}).`,
      route: '',
      index: nextItem,
      minutes: stageMinutes(stage),
      now: true,
    });
  } else if (stageApplies(sec, stage) && !stagePassed(sec, state, stage)) {
    const m = STAGE_META[stage];
    out.push({
      key: `now:${sec.id}:${stage}`,
      kind: 'stage',
      icon: m.icon,
      label: m.label,
      hint: `${m.blurb} — isi page par, abhi (${stageMinutes(stage)}).`,
      route: `/lesson/${sec.id}/${stage}`,
      minutes: stageMinutes(stage),
      now: true,
    });
  }

  // 2 — the stages of this section that still block it: forward from here first, then wrapping
  // back to anything skipped, which is exactly how the ladder itself searches.
  const from = order.indexOf(stage);
  const gap = (s: Stage) => (order.indexOf(s) - from + order.length) % order.length;
  const blocking = order
    .filter((s) => s !== stage && stageApplies(sec, s) && !stagePassed(sec, state, s))
    .sort((a, b) => gap(a) - gap(b));
  const shown = Math.max(0, middle);
  for (const s of blocking.slice(0, shown)) {
    const m = STAGE_META[s];
    out.push({
      key: `next:${sec.id}:${s}`,
      kind: 'stage',
      icon: m.icon,
      label: m.label,
      hint: `${m.blurb} · ${stageMinutes(s)}`,
      route: `/lesson/${sec.id}/${s}`,
      minutes: stageMinutes(s),
      now: false,
    });
  }
  const hidden = Math.max(0, blocking.length - shown);
  // Nothing left in this section means leaving it IS the next step, so the hand-off row takes the
  // NOW slot; "row 0 is what you do now" stays true on every screen.
  const empty = out.length === 0;

  // 3 — the exit: the next topic, or the review queue when nothing is left anywhere.
  const nextSec = nextOpenSection(sections, state, sec.id);
  if (nextSec && nextSec.id !== sec.id) {
    const left = sections.filter((s) => !isMastered(s, state)).length;
    out.push({
      key: `exit:${nextSec.id}`,
      kind: 'section',
      icon: STAGE_META.learn.icon,
      label: nextSec.title,
      hint: empty
        ? `Yeh section clear hai ✓ — ${left} section bache hain, agla topic khol do.`
        : hidden
          ? `Pehle is section ke ${hidden} stage baaki, phir yeh topic — ${left} section bache hain.`
          : `Yeh section clear hone par agla topic — ${left} section bache hain.`,
      route: `/lesson/${nextSec.id}/learn`,
      minutes: `~${45 + nextSec.coding.length * 4} min`,
      now: empty,
    });
  } else if (isMastered(sec, state)) {
    out.push({
      key: 'exit:review',
      kind: 'review',
      icon: '🔁',
      label: 'Review Queue',
      hint: 'Poora course mastered hai — ab spaced repetition se sharp rakho. 🏆',
      route: '/review',
      minutes: '~10 min',
      now: empty,
    });
  }

  // Structural guarantee, so the panel never has to guess: row 0 is the next action, whether that
  // is an item, a stage, the next topic or the review queue.
  if (out.length && !out.some((r) => r.now)) out[0] = { ...out[0], now: true };
  return out;
}

/**
 * The whole ladder in one call: pass the section, the current stage and (for item stages) the
 * index the learner just finished. `null` means nothing is left to do anywhere.
 */
export function planNextStep(
  sections: Section[],
  sec: Section,
  state: AppState,
  stage: Stage,
  after?: number,
): NextStep | null {
  // 1 — another unfinished item in this same stage
  if (after !== undefined) {
    const next = nextItemIndex(sec, state, stage, after);
    if (next !== null) {
      const items = stageItems(sec, stage)!;
      return {
        kind: 'item',
        index: next,
        label: `${items.name(next)} / ${items.count}`,
        hint: `${STAGE_META[stage].label} me abhi ${openItems(sec, state, stage)} item baaki hain — agla wahin khul raha hai (${stageMinutes(stage)}).`,
        route: '',
      };
    }
  }

  // 2 — the next stage of this section
  const nextStage = nextOpenStage(sec, state, stage);
  if (nextStage) {
    const cleared = stagePassed(sec, state, stage) || !stageApplies(sec, stage);
    return {
      kind: 'stage',
      label: `${STAGE_META[nextStage].icon} ${STAGE_META[nextStage].label}`,
      hint: cleared
        ? `${STAGE_META[stage].label} clear — ab ${STAGE_META[nextStage].label}. ${STAGE_META[nextStage].blurb}.`
        : `${STAGE_META[stage].label} ka gate abhi poora nahi hua (${Math.max(0, (STAGE_PASS[stage] ?? 70) - (sectionProgress(sec, state).tasks[stage] as number))}% kam). ${STAGE_META[nextStage].label} bhi khol sakte ho.`,
      route: `/lesson/${sec.id}/${nextStage}`,
    };
  }

  // 3 — the next section
  const nextSec = nextOpenSection(sections, state, sec.id);
  if (nextSec && nextSec.id !== sec.id) {
    const remaining = sections.filter((s) => !isMastered(s, state)).length;
    return {
      kind: 'section',
      label: `${STAGE_META.learn.icon} ${nextSec.title}`,
      hint: `Section ${String(sec.no).padStart(2, '0')} MASTERED 🎉 ${remaining} section${remaining === 1 ? '' : 's'} baaki — agla topic khol raha hoon.`,
      route: `/lesson/${nextSec.id}/learn`,
    };
  }

  // 4 — everything done
  if (isMastered(sec, state)) {
    return {
      kind: 'review',
      label: '🔁 Review Queue',
      hint: 'Poora course mastered hai — ab spaced repetition se sharp rakho. 🏆',
      route: '/review',
    };
  }
  return null;
}

/**
 * What to show on a stage tile: `n/a` for a stage this section has no content for, so the grid
 * never marks an impossible stage as done or as pending.
 */
export const stageTileState = (sec: Section, state: AppState, stage: Stage): 'passed' | 'open' | 'na' =>
  !stageApplies(sec, stage) ? 'na' : stagePassed(sec, state, stage) ? 'passed' : 'open';
