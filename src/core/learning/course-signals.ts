/**
 * One honest reading of the non-Python courses' records, for XP and achievements.
 *
 * The Python curriculum already has `isMastered` and `doneRecords`; the C, Java and NumPy courses
 * store their own attempt families (`ccourse:*`, `jcourse:*`, `nmod:*`). This module counts those
 * families in ONE place so a badge, the XP award and the course pages cannot disagree about what
 * "finished" means.
 */
import type { Attempt } from '../../types';
import { N_SECTIONS } from './ncourse';

export type CourseId = 'numpy' | 'c' | 'java';

export interface CourseSignals {
  /** NumPy sections recorded (`nmod:<module>:<section>`), one per section. */
  numpySections: number;
  /** NumPy modules whose ten sections are all recorded. */
  numpyModules: number;
  /** C modules whose checkpoint is recorded. */
  cModules: number;
  /** Java modules whose checkpoint is recorded. */
  javaModules: number;
  /** Finished course modules across C, Java and NumPy. */
  modules: number;
  /** One module in each of C, Java and NumPy — the "connected courses" signal. */
  allThree: boolean;
}

/** XP for finishing a section/module, paid once. */
export function sectionXp(course: CourseId): number {
  return course === 'numpy' ? 12 : 30;
}

/** NumPy's module-completion bonus, paid when the tenth section lands. */
export const NUMPY_MODULE_BONUS = 20;

/** A module id from an exact `family:<id>:<suffix>` key, never from a longer suffix. */
function moduleIds(attempts: Record<string, Attempt>, family: string, suffix: string): Set<string> {
  const out = new Set<string>();
  const prefix = `${family}:`;
  const tail = `:${suffix}`;
  for (const key of Object.keys(attempts || {})) {
    if (key.startsWith(prefix) && key.endsWith(tail)) {
      const id = key.slice(prefix.length, key.length - tail.length);
      if (id && !id.includes(':')) out.add(id);
    }
  }
  return out;
}

/** NumPy module ids whose every section key exists. */
export function numpyCompletedModules(attempts: Record<string, Attempt>): string[] {
  const byModule = new Map<string, Set<string>>();
  for (const key of Object.keys(attempts || {})) {
    if (!key.startsWith('nmod:')) continue;
    const parts = key.split(':');
    if (parts.length !== 3) continue;
    const [, moduleId, section] = parts;
    if (!moduleId || !section) continue;
    const set = byModule.get(moduleId) ?? new Set<string>();
    set.add(section);
    byModule.set(moduleId, set);
  }
  return [...byModule.entries()]
    .filter(([, sections]) => N_SECTIONS.every((s) => sections.has(s.key)))
    .map(([id]) => id);
}

export function courseSignals(attempts: Record<string, Attempt>): CourseSignals {
  const numpyModules = numpyCompletedModules(attempts);
  const cModules = moduleIds(attempts || {}, 'ccourse', 'checkpoint').size;
  const javaModules = moduleIds(attempts || {}, 'jcourse', 'checkpoint').size;
  const numpySections = Object.keys(attempts || {}).filter((key) => /^nmod:[^:]+:[^:]+$/.test(key)).length;
  return {
    numpySections,
    numpyModules: numpyModules.length,
    cModules,
    javaModules,
    modules: numpyModules.length + cModules + javaModules,
    allThree: numpyModules.length > 0 && cModules > 0 && javaModules > 0,
  };
}

/**
 * What to pay for a completion, given whether it was already recorded.
 * `alreadyDone` is the guard that keeps a re-click from farming XP.
 */
export function completionAward(course: CourseId, alreadyDone: boolean, finalSection = false): number {
  if (alreadyDone) return 0;
  return sectionXp(course) + (course === 'numpy' && finalSection ? NUMPY_MODULE_BONUS : 0);
}
