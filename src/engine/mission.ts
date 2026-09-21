/** Daily mission: builds a task queue from curriculum state. */
import type { Section, AppState } from '../types';
import { sectionProgress, currentSection, isMastered } from './progress';

export interface MissionTask {
  id: string;
  label: string;
  route: string;
  minutes: number;
}

export function dailyMission(s: AppState, sections: Section[]): MissionTask[] {
  const sec = currentSection(sections, s);
  const { tasks } = sectionProgress(sec, s);
  const out: MissionTask[] = [];
  if (!tasks.learn) out.push({ id: `read:${sec.id}`, label: `Read concept: ${sec.title}`, route: `/lesson/${sec.id}/learn`, minutes: 20 });
  if (tasks.interview < 70) out.push({ id: `int:${sec.id}`, label: 'Answer 3 interview questions aloud', route: `/lesson/${sec.id}/interview`, minutes: 15 });
  if (tasks.coding < 70) out.push({ id: `code:${sec.id}`, label: 'Solve one coding task', route: `/lesson/${sec.id}/coding`, minutes: 20 });
  if (tasks.logic < 70) out.push({ id: `logic:${sec.id}`, label: 'Predict 2 logic cards', route: `/lesson/${sec.id}/logic`, minutes: 10 });
  if (tasks.debug < 70) out.push({ id: `dbg:${sec.id}`, label: 'Fix one debugging problem', route: `/lesson/${sec.id}/debug`, minutes: 15 });
  if (!tasks.mini) out.push({ id: `mini:${sec.id}`, label: `Build mini project: ${sec.mini.name || sec.title}`, route: `/lesson/${sec.id}/mini`, minutes: 25 });
  if (!isMastered(sec, s)) out.push({ id: `chk:${sec.id}`, label: 'Take the checkpoint', route: `/lesson/${sec.id}/checkpoint`, minutes: 10 });
  return out;
}


