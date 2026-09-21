import type { Section, AppState } from '../types';
import { stageAttempt, itemAttempt, debugDone, learnView } from './keys';

/** Every stage of the lesson flow with its completion gate. */
export const STAGES = ['learn', 'interview', 'coding', 'logic', 'debug', 'solved', 'mini', 'project', 'defense', 'checkpoint'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_META: Record<Stage, { label: string; icon: string; blurb: string }> = {
  learn: { label: 'Learn', icon: '📖', blurb: 'Definition, easy explanation, code examples, recap' },
  interview: { label: 'Interview', icon: '🎤', blurb: 'Questions paired with model answers' },
  coding: { label: 'Coding Lab', icon: '💻', blurb: 'Tasks with runner + checks + solutions' },
  logic: { label: 'Logic', icon: '🧠', blurb: 'Predict, trace, why, fix, explain' },
  debug: { label: 'Debug', icon: '🐞', blurb: 'Broken code: find, explain, fix' },
  solved: { label: 'Practice Solutions', icon: '✅', blurb: 'Try first, then compare with the answer key' },
  mini: { label: 'Mini Project', icon: '🏗️', blurb: 'Runnable build for this topic' },
  project: { label: 'Project Lab', icon: '🚀', blurb: 'Simple / Medium / Hard builds' },
  defense: { label: 'Defense', icon: '🛡️', blurb: 'Explain the build, get scored' },
  checkpoint: { label: 'Checkpoint', icon: '🏆', blurb: 'Final gate before Mastered' },
};


export function sectionProgress(s: Section, state: AppState) {
  const tasks = {
    learn: !!state.attempts[learnView(s.id)],
    interview: s.interview.length
      ? state.attempts[stageAttempt(s.id, 'interview')]?.score ?? 0
      : 100,
    coding: s.coding.length
      ? Math.round(100 * s.coding.filter((_, i) => state.attempts[itemAttempt(s.id, 'coding', i)]?.done).length / s.coding.length)
      : 100,
    logic: s.logic.length
      ? Math.round(100 * s.logic.filter((_, i) => state.attempts[itemAttempt(s.id, 'logic', i)]?.done).length / s.logic.length)
      : 100,
    debug: s.coding.some((c) => c.difficulty === 'debug')
      ? Math.round(100 * s.coding.filter((c) => c.difficulty === 'debug' && state.attempts[debugDone(s.id)]?.done).length / s.coding.filter((c) => c.difficulty === 'debug').length)
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
    ) / (8 + (s.coding.some((c) => c.difficulty === 'debug') ? 1 : 0) + (s.checkpoint.length ? 1 : 0)));
  return { tasks, masterPct };
}

export function missingForMastery(s: Section, state: AppState): string[] {
  const { tasks } = sectionProgress(s, state);
  const missing: string[] = [];
  if (!tasks.learn) missing.push('Read the Learn section');
  if (tasks.interview < 70) missing.push(`Interview score ≥ 70% (now ${tasks.interview}%)`);
  if (tasks.coding < 70) missing.push(`Coding tasks ≥ 70% (now ${tasks.coding}%)`);
  if (tasks.logic < 70) missing.push(`Logic ≥ 70% (now ${tasks.logic}%)`);
  if (s.coding.some((c) => c.difficulty === 'debug') && tasks.debug < 70) missing.push(`Debug ≥ 70% (now ${tasks.debug}%)`);
  if (tasks.solved < 70) missing.push(`Practice solutions ≥ 70% (now ${tasks.solved}%)`);
  if (!tasks.mini) missing.push('Complete the mini project');
  if (!tasks.project) missing.push('Complete one Project Lab build');
  if (tasks.defense < 60) missing.push(`Project defense ≥ 60 (now ${tasks.defense})`);
  if (s.checkpoint.length && tasks.checkpoint < 70) missing.push(`Checkpoint ≥ 70% (now ${tasks.checkpoint}%)`);
  return missing;
}

export const isMastered = (s: Section, state: AppState) => missingForMastery(s, state).length === 0;

export interface NextAction { label: string; reason: string; route: string }

export function nextBestAction(s: Section, state: AppState): NextAction {
  const { tasks } = sectionProgress(s, state);
  if (!tasks.learn) return { label: `Read: ${s.title}`, reason: 'Foundation first — concepts, examples, recap.', route: `/lesson/${s.id}/learn` };
  if (tasks.interview < 70) return { label: 'Interview practice', reason: `Score is ${tasks.interview}%. Answer aloud, then self-grade.`, route: `/lesson/${s.id}/interview` };
  if (tasks.coding < 70) return { label: 'Solve a coding task', reason: `Coding at ${tasks.coding}%. Run and verify your code.`, route: `/lesson/${s.id}/coding` };
  if (tasks.logic < 70) return { label: 'Logic lab', reason: `Logic at ${tasks.logic}%. Predict before running.`, route: `/lesson/${s.id}/logic` };
  if (tasks.debug < 70 && s.coding.some((c) => c.difficulty === 'debug')) return { label: 'Debug lab', reason: `Debug at ${tasks.debug}%. Find, explain, fix.`, route: `/lesson/${s.id}/debug` };
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
