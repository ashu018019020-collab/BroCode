/**
 * Lightweight index of the course-owned banks shown in the Question Bank.
 *
 * Course pages publish full artifacts (the SQL file alone is 1.4 MB, NumPy is 2.8 MB). The Question
 * Bank only needs module/question counts for its cards, so `scripts/course-banks.cjs` publishes those
 * counts once and this module fetches that small file instead of every course artifact.
 */
import { useAsync } from './playbook';

export interface CourseBankCount {
  id: string;
  modules: number;
  questions: number;
}

export interface CourseBankIndex {
  courses: CourseBankCount[];
}

let cached: Promise<CourseBankIndex | null> | null = null;

/** Fetch once per session; the promise is cached, not just the result. */
export const loadCourseBanks = () => (cached ??= fetch('generated/course-banks/index.json')
  .then((response) => {
    if (!response.ok) throw new Error(`course-banks/index.json: ${response.status}`);
    return response.json() as Promise<CourseBankIndex>;
  })
  .catch(() => null));

export function useCourseBanks(): CourseBankIndex | null {
  return useAsync(loadCourseBanks);
}
