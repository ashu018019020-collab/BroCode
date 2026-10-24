import type { Section, AppState, Mistake, Attempt } from '../../types';
import { STAGE_ATTEMPT_PREFIX, stageAttempt, itemAttempt, debugDone, learnView } from '../platform/keys';

/** Every stage of the lesson flow with its completion gate. */
export const STAGES = ['learn', 'interview', 'coding', 'logic', 'debug', 'solved', 'mini', 'project', 'defense', 'checkpoint'] as const;
export type Stage = (typeof STAGES)[number];

/**
 * Accent tones. Every tone defines exactly two custom properties (`--accent`
 * and `--accent-rgb`), so a surface can be tinted without inventing new colors
 * per component — see the `.tone-*` block in styles.css.
 */
export type Tone =
  | 'blue' | 'cyan' | 'violet' | 'fuchsia' | 'red'
  | 'green' | 'amber' | 'orange' | 'purple' | 'gold';

/** Short menu label for the stage grid — the blurb's first clause, trimmed. */
export const stageTagline = (st: Stage): string => {
  const taglines: Record<Stage, string> = {
    learn: 'Concepts & Theory', interview: 'Q&A + Mock', coding: 'Write & Run', logic: 'Think & Solve',
    debug: 'Find & Fix', solved: 'Hands-on Tasks', mini: 'Build & Apply', project: 'Ship It For Real',
    defense: 'Explain & Present', checkpoint: 'Test Your Mastery',
  };
  return taglines[st];
};

export const STAGE_META: Record<Stage, { label: string; icon: string; blurb: string; tone: Tone }> = {
  learn: { label: 'Learn', icon: '📖', blurb: 'Definition, easy explanation, code examples, recap', tone: 'blue' },
  interview: { label: 'Interview', icon: '🎤', blurb: 'Questions paired with model answers', tone: 'cyan' },
  coding: { label: 'Coding Lab', icon: '💻', blurb: 'Tasks with runner + checks + solutions', tone: 'violet' },
  logic: { label: 'Logic', icon: '🧠', blurb: 'Predict, trace, why, fix, explain', tone: 'fuchsia' },
  debug: { label: 'Debug', icon: '🐞', blurb: 'Broken code: find, explain, fix', tone: 'red' },
  solved: { label: 'Practice Solutions', icon: '✅', blurb: 'Try first, then compare with the answer key', tone: 'green' },
  mini: { label: 'Mini Project', icon: '🏗️', blurb: 'Runnable build for this topic', tone: 'amber' },
  project: { label: 'Project Lab', icon: '🚀', blurb: 'Simple / Medium / Hard builds', tone: 'orange' },
  defense: { label: 'Defense', icon: '🛡️', blurb: 'Explain the build, get scored', tone: 'purple' },
  checkpoint: { label: 'Checkpoint', icon: '🏆', blurb: 'Final gate before Mastered', tone: 'gold' },
};

/**
 * The tasks the Coding Lab actually shows. Debug tasks have their own stage and their own
 * gate (`debugDone`), so they must not appear here: counting them made the Coding percentage
 * grade a task the learner could never tick from the Coding Lab, and it shifted the item keys
 * for every task after it. One list, used by the lab, the progress maths and the tutor drill —
 * that is what keeps a key like `st:s01:coding3` meaning the same task everywhere.
 */
export const codingTasks = (s: Section) => s.coding.filter((c) => c.difficulty !== 'debug');

/** Debug tasks shown by the Debug stage (gated by a single section-level record). */
export const debugTasks = (s: Section) => s.coding.filter((c) => c.difficulty === 'debug');

/**
 * Coding Lab tasks ticked, counted over the tasks the Lab actually SHOWS — both halves of the fraction.
 *
 * The list is the Lab's own (`codingTasks`, which files the debug tasks under their own stage), so the
 * index here is the index the Lab writes. Counting `s.coding` instead put 18 debug tasks — 245 against
 * the Lab's 227 — inside the denominator, so the card could not pass ~92% however much was solved, and
 * the index compared one task's record against another task's slot. This is the same defect
 * `sectionProgress` was already fixed for; the dashboard was its second copy, which is why it is
 * measured here rather than spelled there.
 */
export function codingTasksDone(sections: Section[], state: AppState): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const s of sections) {
    const coding = codingTasks(s);
    total += coding.length;
    for (let i = 0; i < coding.length; i++) {
      if (state.attempts[itemAttempt(s.id, 'coding', i)]?.done) done += 1;
    }
  }
  return { done, total };
}

export type StageTasks = ReturnType<typeof sectionProgress>['tasks'];

/**
 * The score a scored stage must reach. Read/test/build stages use plain booleans instead.
 * One table, so the lesson tile, the mastery gate and the "what next" planner can never
 * disagree — the defense gate in particular used to be 70 in the lesson and 60 for mastery,
 * which left a learner with a passing defense staring at a stage that never went green.
 */
export const STAGE_PASS: Partial<Record<Stage, number>> = {
  interview: 70, coding: 70, logic: 70, debug: 70, solved: 70, defense: 60, checkpoint: 70,
};

/**
 * Some stages cannot exist for every section: the Debug stage needs a debugging task, the
 * checkpoint needs a checkpoint bank. A stage that does not apply never blocks — otherwise the
 * learner would be sent to a page that only says "nothing here" and mastery could never unlock.
 */
export function stageApplies(sec: Section, stage: Stage): boolean {
  if (stage === 'debug') return debugTasks(sec).length > 0;
  if (stage === 'checkpoint') return sec.checkpoint.length > 0;
  return true;
}

/** The authoritative gate for one whole stage of one section. */
export function stagePassed(sec: Section, state: AppState, stage: Stage): boolean {
  if (!stageApplies(sec, stage)) return true;
  const { tasks } = sectionProgress(sec, state);
  if (stage === 'learn' || stage === 'mini' || stage === 'project') return !!tasks[stage];
  return (tasks[stage] as number) >= (STAGE_PASS[stage] ?? 70);
}

export function sectionProgress(s: Section, state: AppState) {
  const coding = codingTasks(s);
  const debug = debugTasks(s);
  const tasks = {
    learn: !!state.attempts[learnView(s.id)],
    interview: s.interview.length
      ? state.attempts[stageAttempt(s.id, 'interview')]?.score ?? 0
      : 100,
    coding: coding.length
      ? Math.round(100 * coding.filter((_, i) => state.attempts[itemAttempt(s.id, 'coding', i)]?.done).length / coding.length)
      : 100,
    logic: s.logic.length
      ? Math.round(100 * s.logic.filter((_, i) => state.attempts[itemAttempt(s.id, 'logic', i)]?.done).length / s.logic.length)
      : 100,
    debug: debug.length
      ? Math.round(100 * debug.filter(() => state.attempts[debugDone(s.id)]?.done).length / debug.length)
      : 0,
    solved: s.solved.length
      ? Math.round(100 * s.solved.filter((_, i) => state.attempts[itemAttempt(s.id, 'solved', i)]?.done).length / s.solved.length)
      : 100,
    mini: !!state.attempts[stageAttempt(s.id, 'mini')],
    project: !!state.attempts[stageAttempt(s.id, 'project')],
    defense: state.attempts[stageAttempt(s.id, 'defense')]?.score ?? 0,
    checkpoint: s.checkpoint.length
      ? state.attempts[stageAttempt(s.id, 'checkpoint')]?.score ?? 0
      : 0,
  };
  const masterPct =
    Math.round((
      (tasks.learn ? 1 : 0) + tasks.interview + tasks.coding + tasks.logic +
      (tasks.debug as number) + tasks.solved +
      (tasks.mini ? 100 : 0) + (tasks.project ? 100 : 0) + tasks.defense + tasks.checkpoint
    ) / (8 + (debug.length ? 1 : 0) + (s.checkpoint.length ? 1 : 0)));

  /**
   * The breakdown a learner can act on — every number derived from a real gate,
   * never invented. Theory = concept read + logic prediction; Project groups the
   * three build gates (mini project, project lab, defense).
   */
  const scores = {
    theory: s.logic.length ? Math.round(((tasks.learn ? 100 : 0) + tasks.logic) / 2) : (tasks.learn ? 100 : 0),
    coding: tasks.coding,
    debug: tasks.debug,
    interview: tasks.interview,
    project: Math.round(((tasks.mini ? 100 : 0) + (tasks.project ? 100 : 0) + tasks.defense) / 3),
    mastery: masterPct,
  };

  return { tasks, masterPct, scores };
}

export type ScoreBreakdown = ReturnType<typeof sectionProgress>['scores'];

export function missingForMastery(s: Section, state: AppState): string[] {
  const { tasks } = sectionProgress(s, state);
  const missing: string[] = [];
  const need = (st: Stage) => STAGE_PASS[st] ?? 70;
  if (!tasks.learn) missing.push('Read the Learn section');
  if (tasks.interview < need('interview')) missing.push(`Interview score >= ${need('interview')}% (now ${tasks.interview}%)`);
  if (tasks.coding < need('coding')) missing.push(`Coding tasks >= ${need('coding')}% (now ${tasks.coding}%)`);
  if (tasks.logic < need('logic')) missing.push(`Logic >= ${need('logic')}% (now ${tasks.logic}%)`);
  if (stageApplies(s, 'debug') && tasks.debug < need('debug')) missing.push(`Debug >= ${need('debug')}% (now ${tasks.debug}%)`);
  if (tasks.solved < need('solved')) missing.push(`Practice solutions >= ${need('solved')}% (now ${tasks.solved}%)`);
  if (!tasks.mini) missing.push('Complete the mini project');
  if (!tasks.project) missing.push('Complete one Project Lab build');
  if (tasks.defense < need('defense')) missing.push(`Project defense >= ${need('defense')} (now ${tasks.defense})`);
  if (stageApplies(s, 'checkpoint') && tasks.checkpoint < need('checkpoint')) missing.push(`Checkpoint >= ${need('checkpoint')}% (now ${tasks.checkpoint}%)`);
  return missing;
}

export const isMastered = (s: Section, state: AppState) => missingForMastery(s, state).length === 0;

/** Mistakes are logged against the section id (logic/defense) or a code slot key. */
const inSection = (m: Mistake, sid: string) => m.section === sid || m.section.includes(sid);

export interface WeakTopic { topic: string; count: number; route: string }

const stageForMistake = (type: string): Stage =>
  type === 'debug' ? 'debug' : type === 'code' ? 'coding' : type === 'logic' ? 'logic' : 'solved';

/**
 * The topic a learner keeps getting wrong in this section. Repeated open mistakes
 * outrank the ordered gates — grinding ahead while a concept is broken is how
 * learners stall at 68% forever.
 */
export function weakTopic(s: Section, state: AppState): WeakTopic | null {
  const open = state.mistakes.filter((m) => !m.fixed && inSection(m, s.id));
  if (!open.length) return null;
  const byTopic = new Map<string, { count: number; type: string }>();
  for (const m of open) {
    const cur = byTopic.get(m.topic);
    byTopic.set(m.topic, { count: (cur?.count ?? 0) + 1, type: cur?.type ?? m.type });
  }
  let best: { topic: string; count: number; type: string } | null = null;
  for (const [topic, v] of byTopic) if (v.count >= 2 && (!best || v.count > best.count)) best = { topic, count: v.count, type: v.type };
  if (!best) return null;
  return { topic: best.topic, count: best.count, route: `/lesson/${s.id}/${stageForMistake(best.type)}` };
}

export interface NextAction { label: string; reason: string; route: string }

export function nextBestAction(s: Section, state: AppState): NextAction {
  const { tasks } = sectionProgress(s, state);
  const weak = weakTopic(s, state);
  if (weak) {
    return {
      label: `Targeted practice: ${weak.topic}`,
      reason: `"${weak.topic}" has been missed ${weak.count} times — fix it first, then move on.`,
      route: weak.route,
    };
  }
  if (!tasks.learn) return { label: `Read: ${s.title}`, reason: 'Foundation first — concepts, examples, recap.', route: `/lesson/${s.id}/learn` };
  if (tasks.interview < 70) return { label: 'Interview practice', reason: `Score is ${tasks.interview}%. Answer aloud, then self-grade.`, route: `/lesson/${s.id}/interview` };
  if (tasks.coding < 70) return { label: 'Solve a coding task', reason: `Coding at ${tasks.coding}%. Run and verify your code.`, route: `/lesson/${s.id}/coding` };
  if (tasks.logic < 70) return { label: 'Logic lab', reason: `Logic at ${tasks.logic}%. Predict before running.`, route: `/lesson/${s.id}/logic` };
  if (tasks.debug < 70 && stageApplies(s, 'debug')) return { label: 'Debug lab', reason: `Debug at ${tasks.debug}%. Find, explain, fix.`, route: `/lesson/${s.id}/debug` };
  if (tasks.solved < 70) return { label: 'Practice solutions', reason: `At ${tasks.solved}%. Try first, then compare.`, route: `/lesson/${s.id}/solved` };
  if (!tasks.mini) return { label: 'Build the mini project', reason: 'Nothing cements a topic like shipping its mini build.', route: `/lesson/${s.id}/mini` };
  if (!tasks.project) return { label: 'Project Lab build', reason: 'Pick Simple / Medium / Hard and build it.', route: `/lesson/${s.id}/project` };
  if (tasks.defense < 60) return { label: 'Project defense', reason: `Defense score ${tasks.defense}. Explain it.`, route: `/lesson/${s.id}/defense` };
  if (tasks.checkpoint < 70 && s.checkpoint.length) return { label: 'Take the checkpoint', reason: `Checkpoint at ${tasks.checkpoint}%.`, route: `/lesson/${s.id}/checkpoint` };
  return { label: 'Review queue', reason: 'Everything is done — review keeps it sharp.', route: '/review' };
}

/** First section not yet mastered = the learner's current frontier. */
export function currentSection(sections: Section[], state: AppState): Section {
  return sections.find((s) => !isMastered(s, state)) ?? sections[sections.length - 1];
}

/** One recorded stage activity, newest first. */
export interface StageEvent {
  at: number;
  section: Section;
  /** The stage name, digits stripped, with the debug record filed under its own stage. */
  kind: string;
}

/**
 * The last `limit` stage/item records that carry a timestamp, newest first — the dashboard's feed.
 *
 * The key PARSING lives here (`st:<sid>:<stage>` and its item form), because reading a stage out of a
 * persisted key inside a renderer is the same bug as spelling the family there: the shape belongs to
 * `keys.ts`, and the page should only choose an icon and a sentence. Icons stay in the page — an engine
 * that imported a lucide component would stop being testable.
 */
export function recentStageEvents(sections: Section[], attempts: Record<string, Attempt>, limit = 5): StageEvent[] {
  const out: StageEvent[] = [];
  for (const s of sections) {
    const family = `${STAGE_ATTEMPT_PREFIX}${s.id}:`;
    for (const [key, a] of Object.entries(attempts)) {
      if (!key.startsWith(family) || !a?.ts) continue;
      const stage = key.slice(family.length).replace(/\d+$/, '');
      out.push({ at: a.ts, section: s, kind: stage === 'debugdone' ? 'debug' : stage });
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}
