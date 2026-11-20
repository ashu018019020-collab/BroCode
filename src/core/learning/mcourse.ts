/**
 * Machine Learning Mastery's pure rules.
 *
 * The course reuses the ten-section mastery shape (and its workspace), but it owns a DIFFERENT
 * progress family: `mmod:<module>:<section>`. Sharing `nmod:` would make the NumPy course's
 * achievement tally count ML sections, so the family is deliberately separate.
 */
import { N_SECTIONS, courseCertificate, type NCertificate, type NSectionKey } from './ncourse';

export const M_SECTION_KEY_PREFIX = 'mmod:';
export const M_LAST_KEY = 'ml:last';
/** The capstone rubric self-check is a JSON array of criteria under this key ('ncap' is NumPy's). */
export const M_CAPSTONE_KEY = 'mcap';

export function mSectionKey(moduleId: string, section: NSectionKey): string {
  return `${M_SECTION_KEY_PREFIX}${moduleId}:${section}`;
}

/** A module is complete only when every section has a real record. */
export function mIsModuleComplete(moduleId: string, attempts: Record<string, unknown>): boolean {
  return N_SECTIONS.every((section) => Boolean(attempts[mSectionKey(moduleId, section.key)]));
}

export function mSectionsDone(moduleId: string, attempts: Record<string, unknown>): number {
  return N_SECTIONS.filter((section) => Boolean(attempts[mSectionKey(moduleId, section.key)])).length;
}

export interface MProgress {
  modulesDone: number;
  modulesTotal: number;
  pct: number;
  sectionsDone: number;
  sectionsTotal: number;
}

/**
 * ML's certificate uses the same derived rule as NumPy: every section recorded AND the capstone
 * rubric at the published pass mark. It never treats a module count or a checkpoint score as enough.
 */
export function mlCertificate(
  progress: MProgress,
  rubric: { criterion: string; weight: number }[],
  checked: string[],
): NCertificate {
  return courseCertificate(progress, rubric, checked);
}

export function mProgress(modules: { id: string }[], attempts: Record<string, unknown>): MProgress {
  const total = modules.length * N_SECTIONS.length;
  let sectionsDone = 0;
  let modulesDone = 0;
  for (const module of modules) {
    const done = mSectionsDone(module.id, attempts);
    sectionsDone += done;
    if (done === N_SECTIONS.length) modulesDone += 1;
  }
  return {
    modulesDone,
    modulesTotal: modules.length,
    pct: total > 0 ? Math.round((sectionsDone / total) * 100) : 0,
    sectionsDone,
    sectionsTotal: total,
  };
}

/** The first section of the first unfinished module, in course order. */
export function mNextPlace(
  modules: { id: string }[],
  attempts: Record<string, unknown>,
): { moduleId: string; section: NSectionKey } | null {
  for (const module of modules) {
    for (const section of N_SECTIONS) {
      if (!attempts[mSectionKey(module.id, section.key)]) return { moduleId: module.id, section: section.key };
    }
  }
  return null;
}
