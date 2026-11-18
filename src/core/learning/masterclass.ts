import { masterclassQuizFamily } from '../platform/keys';

/**
 * Counts shared by the SQL-style masterclass artifacts.
 *
 * SQL, MySQL and SQLite publish the same six bank families. Keeping the sum here means a card,
 * a course header and the completion panel cannot drift from one another.
 */
export interface MasterclassQuestionStats {
  learn: number;
  interview: number;
  labs: number;
  logic: number;
  debug: number;
  revision: number;
}

export const masterclassQuestionCount = (stats: MasterclassQuestionStats): number =>
  stats.learn + stats.interview + stats.labs + stats.logic + stats.debug + stats.revision;

export interface MasterclassQuizTally {
  answered: number;
  correct: number;
  total: number;
  /** Share of the bank answered, `null` when the module publishes none. */
  pct: number | null;
}

/**
 * The learn-bank half of a module's progress, counted from the stored records.
 *
 * Mirrors `cQuizTally` on purpose: one family per module, `done === true` is the verdict, and the
 * answered count is capped at the published total so a record left over from an edited bank can never
 * print "23/20". Only THIS course's module family counts — `mt:` topic ticks and other courses' keys
 * are not questions.
 */
export function masterclassQuizTally(
  attempts: Record<string, { done?: boolean } | undefined>,
  courseId: string,
  moduleId: string,
  total: number,
): MasterclassQuizTally {
  const family = masterclassQuizFamily(courseId, moduleId);
  let answered = 0;
  let correct = 0;
  for (const [key, record] of Object.entries(attempts)) {
    if (!key.startsWith(family) || !record) continue;
    answered += 1;
    if (record.done === true) correct += 1;
  }
  const capped = Math.max(0, Math.min(answered, total));
  return {
    answered: capped,
    correct: Math.min(correct, capped),
    total,
    pct: total > 0 ? Math.round((capped / total) * 100) : null,
  };
}

/** The whole course's learn-bank progress, summed from its modules' own tallies. */
export function masterclassPractice(
  attempts: Record<string, { done?: boolean } | undefined>,
  courseId: string,
  modules: { id: string; questions: number }[],
): MasterclassQuizTally {
  let answered = 0;
  let correct = 0;
  let total = 0;
  for (const module of modules) {
    const tally = masterclassQuizTally(attempts, courseId, module.id, module.questions);
    answered += tally.answered;
    correct += tally.correct;
    total += tally.total;
  }
  return { answered, correct, total, pct: total > 0 ? Math.round((answered / total) * 100) : null };
}
