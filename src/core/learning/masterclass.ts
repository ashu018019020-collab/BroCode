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

/** The six bank families every masterclass publishes, in tab order. */
export const MASTERCLASS_BANKS = ['learn', 'interview', 'labs', 'logic', 'debug', 'revision'] as const;
export type MasterclassBank = (typeof MASTERCLASS_BANKS)[number];

/** How a module is explained: the short Hinglish version, or the professional English one. */
export const MASTERCLASS_LEVELS = ['simple', 'pro'] as const;
export type MasterclassLevel = (typeof MASTERCLASS_LEVELS)[number];

export interface MasterclassSelection {
  /** The module the URL names, when this course publishes it. */
  moduleId?: string;
  /** The bank the URL names, when it is one of the six. */
  bank?: MasterclassBank;
  /** The topic whose example the link asked to load, when the named module publishes it. */
  topicId?: string;
  /** The explanation level the URL names, when it is one of the two. */
  level?: MasterclassLevel;
  /** The lab/debug item the URL names (0-based, within that bank). */
  exercise?: number;
}

/** The read half of `URLSearchParams`, so this rule needs no router. */
export interface MasterclassParams {
  get(name: string): string | null;
}

/** What the selection is validated against: the ids a course publishes. */
export interface MasterclassModuleRef {
  id: string;
  topics: readonly { id: string }[];
}

/**
 * The open module, bank and example as named by the URL — `?module=sql13&bank=logic&example=t04`.
 *
 * A link outlives the edit that renumbers a module or a topic, so an unknown id is ignored rather
 * than trusted: the panel keeps its own default instead of showing an empty course. This is the ONE
 * mapping the course page and the SQL Lab both read, which is what makes one shared link open the
 * same place in either.
 */
export function masterclassSelection(
  params: MasterclassParams,
  modules: readonly MasterclassModuleRef[],
): MasterclassSelection {
  const moduleParam = params.get('module');
  const module = moduleParam ? modules.find((candidate) => candidate.id === moduleParam) : undefined;
  const bankParam = params.get('bank');
  const exampleParam = params.get('example');
  const levelParam = params.get('level');
  const itemParam = params.get('item');
  return {
    moduleId: module?.id,
    bank: MASTERCLASS_BANKS.includes(bankParam as MasterclassBank) ? (bankParam as MasterclassBank) : undefined,
    topicId: module && exampleParam && module.topics.some((topic) => topic.id === exampleParam)
      ? exampleParam
      : undefined,
    level: MASTERCLASS_LEVELS.includes(levelParam as MasterclassLevel) ? (levelParam as MasterclassLevel) : undefined,
    // Only a whole number can name an item; a bad index is ignored like a bad module id.
    ...(itemParam && /^\d+$/.test(itemParam) ? { exercise: Number(itemParam) } : {}),
  };
}

/** The same page with the selection written into it; every other param is left alone. */
export function masterclassHref(
  params: URLSearchParams,
  next: { moduleId?: string; bank?: string; example?: string; level?: string; item?: string },
): URLSearchParams {
  const search = new URLSearchParams(params);
  if (next.moduleId) {
    search.set('module', next.moduleId);
    // An example belongs to its module: opening another module must not carry a stale topic id.
    if (!next.example) search.delete('example');
  }
  if (next.bank) search.set('bank', next.bank);
  if (next.example) search.set('example', next.example);
  if (next.level) search.set('level', next.level);
  if (next.item) search.set('item', next.item);
  return search;
}
