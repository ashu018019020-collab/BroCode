import { useCallback, useMemo } from 'react';
import { useCurriculum } from './curriculum';
import { useStore } from '../storage/store';
import { useAsync } from './playbook';
import { labAttempt, learnView, NOTEBOOK_PREFIX, stageAttempt } from '../platform/keys';
import { bankTouched } from '../learning/coverage';
import { sectionProgress } from '../learning/progress';
import {
  measureSteps,
  anyItemRefTouched,
  type CourseFile,
  type CourseIndex,
  type CourseItem,
  type StepMeasure,
} from '../learning/courses';
import type { Attempt } from '../../types';

export type {
  CourseCard, CourseCounts, CourseFile, CourseIndex, CourseItem, CourseRef, CourseTab,
} from '../learning/courses';

/* ------------------------------ the loaders ------------------------------- */

/**
 * The courses pack's lazy JSON.
 *
 * `index.json` is 3 KB and drives `/courses`; each `<slug>.json` is the course's own item list and
 * is fetched ONLY by that course's page — python.json alone is 1.5 MB, and no home screen should
 * parse the whole pack to draw eleven rings (the same reason the track views are per-file). Both
 * are part of the offline pack (`public/generated/`), so the service worker serves them with no
 * network once visited.
 */
let indexPromise: Promise<CourseIndex | null> | null = null;
const coursePromises = new Map<string, Promise<CourseFile | null>>();

const loadJson = <T,>(url: string, fail: () => T): Promise<T> =>
  fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((d: T) => d).catch(fail);

export const loadCourseIndex = () => (indexPromise ??= loadJson<CourseIndex | null>('./generated/courses/index.json', () => null));

/** One course file, cached per slug. The slug is validated: this string lands in a fetch URL. */
export const loadCourse = (slug: string): Promise<CourseFile | null> => {
  if (!/^[a-z0-9-]+$/.test(slug)) return Promise.resolve(null);
  let p = coursePromises.get(slug);
  if (!p) {
    p = loadJson<CourseFile | null>(`./generated/courses/${slug}.json`, () => null);
    coursePromises.set(slug, p);
  }
  return p;
};

/* ------------------------------ the touch map ----------------------------- */

export interface TouchCtx {
  /** The synthetic mock round the intensive questions are shown in (`extras.mockInterview.length + 1`). */
  intensiveRound: number;
  /** Notebook files that have at least one executed cell — built once, not scanned per item. */
  notebooks: Set<string>;
}

/** The files under the notebook family. One pass over the attempt keys, whatever the item count. */
export function notebookFilesRun(attempts: Record<string, Attempt>): Set<string> {
  const out = new Set<string>();
  for (const key of Object.keys(attempts)) {
    if (!key.startsWith(NOTEBOOK_PREFIX)) continue;
    const rest = key.slice(NOTEBOOK_PREFIX.length);
    const cut = rest.lastIndexOf(':');
    if (cut > 0) out.add(rest.slice(0, cut));
  }
  return out;
}

export function touchContext(attempts: Record<string, Attempt>, intensiveRound: number): TouchCtx {
  return { intensiveRound, notebooks: notebookFilesRun(attempts) };
}

/**
 * Has the learner started this item?
 *
 * Every branch asks a record that a real surface writes, through the key builders in
 * `core/platform/keys.ts` — no family is spelled here. The question/playbook branch uses the
 * coverage predicate (a wrong answer still counts as work done; the score lives elsewhere), and
 * the project branch asks its section's project gate, which is the record the Project Lab writes
 * for the whole build.
 */
export function isItemTouched(attempts: Record<string, Attempt>, item: CourseItem, ctx: TouchCtx): boolean {
  return anyItemRefTouched(item, ({ kind, id }) => {
    switch (kind) {
      case 'question':
      case 'playbook':
        return bankTouched(attempts, id);
      case 'section':
        return !!attempts[learnView(id)];
      case 'notebook':
        return ctx.notebooks.has(id);
      case 'project':
        return !!attempts[stageAttempt(id.split(':')[0], 'project')]?.done;
      case 'mock':
        // `mock:<round>:<i>` → the key MockInterviews writes for that question.
        return attempts[labAttempt('mock', id.slice(id.indexOf(':') + 1))] !== undefined;
      case 'intensive': {
        // The intensive set is shown as one synthetic mock round, 12 questions at a time.
        const i = Number(id.slice(id.indexOf(':') + 1));
        return Number.isFinite(i) && i < 12 && ctx.intensiveRound > 0
          && attempts[labAttempt('mock', `${ctx.intensiveRound}:${i}`)] !== undefined;
      }
      default:
        return false;
    }
  });
}

/* ------------------------------- the hooks -------------------------------- */

export function useCourseIndex(): CourseIndex | null {
  return useAsync(loadCourseIndex);
}

/** One course file (fetch once per slug). `load` is memoised so the effect does not re-run per render. */
export function useCourse(slug: string): CourseFile | null {
  const load = useCallback(() => loadCourse(slug), [slug]);
  return useAsync(load);
}

/** Real mastery per section, from the gate engine the lesson and the Learning Path share. */
export function useSectionPct(): (sid: string) => number {
  const { sections } = useCurriculum();
  const state = useStore();
  return useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sections) map.set(s.id, sectionProgress(s, state).masterPct);
    return (sid: string) => map.get(sid) ?? 0;
  }, [sections, state]);
}

/** The per-item predicate the step page counts with. */
export function useCourseTouch(): (item: CourseItem) => boolean {
  const state = useStore();
  const { extras } = useCurriculum();
  const attempts = state.attempts;
  const ctx = useMemo(
    () => touchContext(attempts, (extras.mockInterview?.length ?? 0) + 1),
    [attempts, extras],
  );
  return useMemo(() => (item: CourseItem) => isItemTouched(attempts, item, ctx), [attempts, ctx]);
}

/**
 * Every step's measure for one course.
 *
 * Section-backed steps ask `sectionProgress` — the SAME figure their lesson tile prints — and the
 * rest count item coverage through the touch predicate. The caller gets one map it can hand to
 * `courseProgressFrom` / `nextStep` without re-deriving anything.
 */
export function useCourseMeasures(file: CourseFile | null): Map<number, StepMeasure> {
  const { sections } = useCurriculum();
  const state = useStore();
  const touch = useCourseTouch();

  return useMemo(() => {
    if (!file) return new Map<number, StepMeasure>();
    const sectionPctOf = (step: number): number | null => {
      const ids = Object.entries(file.sections ?? {}).filter(([, n]) => n === step).map(([sid]) => sid);
      const owned = sections.filter((s) => ids.includes(s.id));
      if (!owned.length) return null;
      return Math.round(owned.reduce((a, s) => a + sectionProgress(s, state).masterPct, 0) / owned.length);
    };
    return measureSteps(file, sectionPctOf, touch);
  }, [file, sections, state, touch]);
}
