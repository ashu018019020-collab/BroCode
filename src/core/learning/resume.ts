import type { AppState, Section } from '../../types';
import { LEARN_VIEW_PREFIX, STAGE_ATTEMPT_PREFIX } from '../platform/keys';
import { STAGES, isMastered, nextBestAction, stagePassed, type Stage } from './progress';

/**
 * WHERE "CONTINUE LEARNING" GOES.
 *
 * One resolver for every entry point (the dashboard card, the footer status bar and the signed-in
 * landing page), because three copies of "pick a lesson" is how the three buttons end up on three
 * different lessons.
 *
 * The order is deliberate and each step is derived from real state — nothing here invents a course
 * id or a stage:
 *
 *   1. STORED POSITION — `state.learning`, written by the lesson page. This is the last lesson the
 *      learner actually opened, so it wins over any inference.
 *   2. ATTEMPT HISTORY — for a state written before `learning` existed, and for a learner whose
 *      progress arrived from the account service: the newest timestamped stage record names the
 *      section and stage they touched last.
 *   3. THE FIRST SECTION — a brand-new account starts at the beginning of the real roadmap instead
 *      of being sent to the dashboard or to a dead route.
 *
 * Within the chosen section the stage is chosen the same way the dashboard's "next best action"
 * chooses it: the last accessed stage while it is still incomplete, otherwise the first stage whose
 * gate is still open. A fully mastered last lesson moves to the next unmastered section rather than
 * parking the learner on a page with nothing left to do.
 *
 * PURE on purpose: no React, no store, no fetch — so this decision is unit-testable and cannot
 * silently diverge from what a component renders.
 */
export interface ResumeTarget {
  /** A real route built from a section id that exists in the curriculum. */
  route: string;
  sectionId: string | null;
  stage: Stage | null;
  source: 'stored' | 'history' | 'first' | 'review';
  /** Short label for the button, e.g. "Resume: Variables & Data Types". */
  label: string;
  /** Why this is the destination — used as the button's tooltip. */
  reason: string;
}

interface Position {
  sectionId: string;
  stage: Stage | null;
}

const isStage = (value: unknown): value is Stage =>
  typeof value === 'string' && (STAGES as readonly string[]).includes(value);

/** Sections in roadmap order — `no`, not array order, is what "first" means. */
const ordered = (sections: Section[]): Section[] =>
  [...sections].sort((a, b) => a.no - b.no);

const sectionOf = (sections: Section[], id: string | undefined): Section | null =>
  (id ? sections.find((s) => s.id === id) ?? null : null);

/**
 * The stage a persisted attempt key names, or null when the key is not a lesson-stage record.
 *
 * Key shapes are owned by `core/platform/keys.ts`; this is a READ of those shapes for the one
 * fallback below. It deliberately accepts only a section that exists in the curriculum, so a stale
 * key from an older release can never become a route.
 */
export function stageFromAttemptKey(key: string, sectionId: string): Stage | null {
  const view = `${LEARN_VIEW_PREFIX}${sectionId}:`;
  if (key.startsWith(view)) return isStage(key.slice(view.length)) ? (key.slice(view.length) as Stage) : null;

  const family = `${STAGE_ATTEMPT_PREFIX}${sectionId}:`;
  if (!key.startsWith(family)) return null;
  const tail = key.slice(family.length);
  if (tail === 'debugdone') return 'debug';
  const name = tail.replace(/\d+$/, '');
  return isStage(name) ? name : null;
}

/** The newest stage record in `attempts` that maps to a real section of this curriculum. */
export function historyPosition(state: AppState, sections: Section[]): Position | null {
  let best: { at: number; sectionId: string; stage: Stage } | null = null;
  for (const [key, attempt] of Object.entries(state.attempts ?? {})) {
    const at = attempt?.ts;
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;
    if (!key.startsWith(LEARN_VIEW_PREFIX) && !key.startsWith(STAGE_ATTEMPT_PREFIX)) continue;
    const [, sectionId] = key.split(':');
    if (!sectionOf(sections, sectionId)) continue;
    const stage = stageFromAttemptKey(key, sectionId);
    if (!stage) continue;
    if (!best || at > best.at) best = { at, sectionId, stage };
  }
  return best ? { sectionId: best.sectionId, stage: best.stage } : null;
}

/**
 * The concrete lesson inside a section: the last accessed stage if it is still open, else the
 * section's own next incomplete action. Returns null only when the whole section is mastered.
 */
function lessonFor(sec: Section, state: AppState, preferred: Stage | null): { stage: Stage; route: string } | null {
  if (preferred && !stagePassed(sec, state, preferred)) {
    return { stage: preferred, route: `/lesson/${sec.id}/${preferred}` };
  }
  if (isMastered(sec, state)) return null;
  const next = nextBestAction(sec, state);
  const prefix = `/lesson/${sec.id}/`;
  if (!next.route.startsWith(prefix)) return null;
  const stage = next.route.slice(prefix.length);
  return isStage(stage) ? { stage, route: next.route } : { stage: 'learn', route: `/lesson/${sec.id}/learn` };
}

const label = (sec: Section | null, source: ResumeTarget['source']) => {
  if (!sec) return 'Continue Learning';
  return source === 'first' ? `Start: ${sec.title}` : `Resume: ${sec.title}`;
};

export function resumeTarget(state: AppState, sections: Section[]): ResumeTarget {
  const orderedSections = ordered(sections);

  // 1 — the explicitly stored position.
  const storedSection = sectionOf(sections, state.learning?.lastSectionId);
  if (storedSection) {
    const preferred = isStage(state.learning?.lastStage) ? state.learning?.lastStage as Stage : null;
    const lesson = lessonFor(storedSection, state, preferred);
    if (lesson) {
      return {
        route: lesson.route,
        sectionId: storedSection.id,
        stage: lesson.stage,
        source: 'stored',
        label: label(storedSection, 'stored'),
        reason: `You opened ${storedSection.no.toString().padStart(2, '0')} · ${storedSection.title} last.`,
      };
    }
    // That section is finished: go to the first section that still has something open.
    const nextSection = orderedSections.find((s) => !isMastered(s, state)) ?? null;
    if (nextSection) {
      return {
        route: `/lesson/${nextSection.id}/learn`,
        sectionId: nextSection.id,
        stage: 'learn',
        source: 'stored',
        label: label(nextSection, 'first'),
        reason: 'That section is complete — this is your next one.',
      };
    }
    return {
      route: '/review',
      sectionId: null,
      stage: null,
      source: 'review',
      label: 'Review Queue',
      reason: 'Everything is complete — keep it sharp with a review.',
    };
  }

  // 2 — the newest record a pre-`learning` state already has.
  const fromHistory = historyPosition(state, sections);
  if (fromHistory) {
    const sec = sectionOf(sections, fromHistory.sectionId);
    if (sec) {
      const lesson = lessonFor(sec, state, fromHistory.stage);
      if (lesson) {
        return {
          route: lesson.route,
          sectionId: sec.id,
          stage: lesson.stage,
          source: 'history',
          label: label(sec, 'stored'),
          reason: `Your latest activity was ${sec.no.toString().padStart(2, '0')} · ${sec.title}.`,
        };
      }
    }
  }

  // 3 — a brand-new learner: the first real lesson in the roadmap.
  const first = orderedSections[0] ?? null;
  if (first) {
    return {
      route: `/lesson/${first.id}/learn`,
      sectionId: first.id,
      stage: 'learn',
      source: 'first',
      label: label(first, 'first'),
      reason: 'Start with the first lesson in the roadmap.',
    };
  }

  // An empty curriculum is not a lesson: the course hub is the only honest destination.
  return {
    route: '/courses',
    sectionId: null,
    stage: null,
    source: 'first',
    label: 'Continue Learning',
    reason: 'Open the course catalogue.',
  };
}
