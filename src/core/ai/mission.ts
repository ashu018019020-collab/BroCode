/**
 * Daily mission: the learner's plan for today, built from real curriculum state.
 *
 * Two rules keep it honest and useful:
 *   · every row is a gate that is actually open — nothing appears that is already done;
 *   · a row points at the EXACT next task, not just the stage, so "Solve one coding task"
 *     becomes "Coding Lab · task 4 of 8" with a link that preselects that task. That is what
 *     makes the plan rotate on its own as the learner finishes things: the next row is always
 *     computed from what is left, never cached.
 */
import type { Section, AppState } from '../../types';
import { sectionProgress, currentSection, isMastered, codingTasks, stageApplies } from '../learning/progress';
import { nextItemIndex, stageItems } from '../learning/advance';

export interface MissionTask {
  id: string;
  kind: 'read' | 'interview' | 'coding' | 'logic' | 'debug' | 'mini' | 'explain' | 'checkpoint';
  label: string;
  route: string;
  minutes: number;
  /** The item to preselect when the stage shows one task at a time (`?task=` / `?card=`). */
  item?: number;
  /** Position inside the stage's item list, for "task 4 of 8" style labels. */
  position?: { at: number; of: number };
}

export function dailyMission(s: AppState, sections: Section[]): MissionTask[] {
  const sec = currentSection(sections, s);
  const { tasks } = sectionProgress(sec, s);
  const out: MissionTask[] = [];
  if (!tasks.learn) out.push({ id: `read:${sec.id}`, kind: 'read', label: `Read concept: ${sec.title}`, route: `/lesson/${sec.id}/learn`, minutes: 20 });

  if (tasks.interview < 70) {
    out.push({ id: `int:${sec.id}`, kind: 'interview', label: 'Answer interview questions aloud, then self-grade', route: `/lesson/${sec.id}/interview`, minutes: 15 });
  }

  if (tasks.coding < 70) {
    const items = stageItems(sec, 'coding');
    const idx = nextItemIndex(sec, s, 'coding', -1);
    const at = idx ?? 0;
    const task = codingTasks(sec)[at];
    out.push({
      id: `code:${sec.id}:${at}`,
      kind: 'coding',
      label: task ? `Coding Lab · task ${at + 1} of ${items?.count ?? 1}: ${task.text.slice(0, 60)}` : 'Coding Lab · next task',
      route: `/lesson/${sec.id}/coding?task=${at}`,
      minutes: 20,
      item: at,
      position: items ? { at: at + 1, of: items.count } : undefined,
    });
  }

  if (tasks.logic < 70) {
    const items = stageItems(sec, 'logic');
    const idx = nextItemIndex(sec, s, 'logic', -1);
    const at = idx ?? 0;
    out.push({
      id: `logic:${sec.id}:${at}`,
      kind: 'logic',
      label: items ? `Logic · card ${at + 1} of ${items.count}: predict before revealing` : 'Logic · predict two cards',
      route: `/lesson/${sec.id}/logic?card=${at}`,
      minutes: 10,
      item: at,
      position: items ? { at: at + 1, of: items.count } : undefined,
    });
  }

  if (tasks.debug < 70 && stageApplies(sec, 'debug')) {
    out.push({ id: `dbg:${sec.id}`, kind: 'debug', label: 'Debug · run the broken code, explain it, fix it', route: `/lesson/${sec.id}/debug`, minutes: 15 });
  }

  if (tasks.solved < 70) {
    const items = stageItems(sec, 'solved');
    const idx = nextItemIndex(sec, s, 'solved', -1);
    if (idx !== null) {
      out.push({ id: `sol:${sec.id}:${idx}`, kind: 'explain', label: `Practice · item ${idx + 1} of ${items?.count ?? 1}: solve, then compare`, route: `/lesson/${sec.id}/solved`, minutes: 10, item: idx });
    }
  }

  if (!tasks.mini) out.push({ id: `mini:${sec.id}`, kind: 'mini', label: `Build mini project: ${sec.mini.name || sec.title}`, route: `/lesson/${sec.id}/mini`, minutes: 25 });
  if (!tasks.project) out.push({ id: `proj:${sec.id}`, kind: 'mini', label: 'Project Lab · pick a tier and build it', route: `/lesson/${sec.id}/project`, minutes: 30 });
  if (!isMastered(sec, s) && stageApplies(sec, 'checkpoint')) {
    out.push({ id: `chk:${sec.id}`, kind: 'checkpoint', label: 'Take the checkpoint', route: `/lesson/${sec.id}/checkpoint`, minutes: 10 });
  }
  return out;
}

/**
 * The single next step of the whole journey — the one row to show when there is only room for
 * one. Falls back to the mission's first open row, then to the review queue.
 */
export function nextMissionTask(s: AppState, sections: Section[]): MissionTask | null {
  return dailyMission(s, sections)[0] ?? null;
}
