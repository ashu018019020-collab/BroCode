/**
 * Study time — "kis date par kitna padha", as data rather than as a bar on a page.
 *
 * The store holds one flat log (`study: { 'YYYY-MM-DD': seconds }`); every question a dashboard asks
 * about it — today, this week against last week, the streak, the weekday profile, the heat grid — is
 * answered here, so the page only draws. That split matters for one reason in particular: the log is
 * sparse (a day that was never studied is simply ABSENT), and a chart that reads it directly would
 * silently compress time — four bars for four active days in a month, with no empty days between
 * them. `daySeries` zero-fills, and it is the only thing allowed to turn the log into a timeline.
 *
 * Pure on purpose: no React, no store, no `Date.now()` default arguments. The caller passes today's
 * key, which is what makes every boundary below (a streak that ends yesterday, a week that rolls,
 * the Monday a heat column starts on) reproducible in a test instead of "true when I ran it".
 */

/** 'YYYY-MM-DD' → seconds studied that day. A missing day means zero, never "unknown". */
export type StudyLog = Record<string, number>;

/**
 * The date key.
 *
 * Deliberately UTC, and deliberately the same rule `today()` below uses for XP and the streak: two
 * different key schemes would put tonight's study in a different day bucket than tonight's XP, and
 * the dashboard would show a streak next to a hole. A learner in IST crossing 05:30 local is the
 * cost, and it is the cost the rest of the app already pays.
 */
export const dateKey = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Today's key. Owned here, with `dateKey` — NOT in the store.
 *
 * `engine/notify.ts` needs it to decide whether today's mission has happened, and an engine module
 * that imported it from the store would pull React and localStorage into a layer that is meant to be
 * pure. The store imports it from here and re-exports it, so pages that already say
 * `today()` `from '../storage/store'` keep working unchanged.
 */
export const today = (): string => dateKey(new Date());

export const isDayKey = (k: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(k);

/** `addDays('2026-09-27', 1)` → '2026-09-28'. Arithmetic is done at UTC midnight, so no DST hour can skip a day. */
export const addDays = (key: string, n: number): string => dateKey(new Date(Date.parse(`${key}T00:00:00Z`) + n * 86400000));

/**
 * What one tick may add, at most.
 *
 * The tracker counts elapsed wall-clock time between ticks, and a background tab has its timers
 * throttled to roughly one call a minute: without a cap, a tab left open overnight would bank eight
 * hours of "study" for a sleeping human. Anything above this is treated as evidence that the page
 * was not being used.
 */
export const MAX_TICK_SECONDS = 5;

/** Add seconds to a day. Non-finite, negative and sub-second amounts are ignored rather than stored. */
export function addStudy(log: StudyLog, seconds: number, key: string): StudyLog {
  if (!isDayKey(key) || !isFinite(seconds) || seconds <= 0) return log;
  const whole = Math.round(seconds);
  if (whole <= 0) return log;
  return { ...log, [key]: (log[key] ?? 0) + whole };
}

/** Merge two logs (import/restore). Sums where both have a day, so a merge can never lose time. */
export function mergeStudy(a: StudyLog, b: StudyLog): StudyLog {
  const out: StudyLog = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (!isDayKey(k) || !isFinite(v) || v <= 0) continue;
    out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

export interface StudyDay {
  key: string;
  /** 0 for a day that is in the window but absent from the log. */
  seconds: number;
  minutes: number;
  /** 0 = Sunday … 6 = Saturday, matching `Date.getUTCDay()`. */
  weekday: number;
}

/**
 * The last `days` days, oldest first, EVERY day present.
 *
 * This is the zero-fill: a month of studying four days a week must chart as ~30 slots with gaps in
 * them, not four wide bars. `todayKey` is included as the last element.
 */
export function daySeries(log: StudyLog, days: number, todayKey: string): StudyDay[] {
  const span = Math.max(1, Math.floor(days));
  const out: StudyDay[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const key = addDays(todayKey, -i);
    const seconds = log[key] ?? 0;
    out.push({ key, seconds, minutes: Math.round(seconds / 60), weekday: new Date(`${key}T00:00:00Z`).getUTCDay() });
  }
  return out;
}

export interface StudyTotals {
  seconds: number;
  /** Days with any time on them — the denominator for an average that means something. */
  activeDays: number;
  bestKey: string | null;
  bestSeconds: number;
  /** Average over ACTIVE days only, so a holiday does not read as laziness. */
  avgActiveSeconds: number;
}

export function studyTotals(log: StudyLog): StudyTotals {
  let seconds = 0;
  let activeDays = 0;
  let bestKey: string | null = null;
  let bestSeconds = 0;
  for (const [k, v] of Object.entries(log)) {
    if (!isDayKey(k) || !isFinite(v) || v <= 0) continue;
    seconds += v;
    activeDays += 1;
    if (v > bestSeconds || (v === bestSeconds && bestKey !== null && k < bestKey)) { bestSeconds = v; bestKey = k; }
  }
  return { seconds, activeDays, bestKey, bestSeconds, avgActiveSeconds: activeDays ? Math.round(seconds / activeDays) : 0 };
}

/**
 * Consecutive studied days ending today — or ending yesterday, when today has not started yet.
 *
 * The "or yesterday" half is the whole point: at 05:30 in the morning a correct streak of 12 must
 * not read as 0 (and must not be reset by a timer), so an empty today is treated as pending rather
 * than as broken. Only a gap of a FULL day ends it.
 */
export function studyStreak(log: StudyLog, todayKey: string): number {
  const has = (k: string) => (log[k] ?? 0) > 0;
  let cursor = has(todayKey) ? todayKey : addDays(todayKey, -1);
  let n = 0;
  while (has(cursor)) {
    n += 1;
    cursor = addDays(cursor, -1);
  }
  return n;
}

export interface WeekTotals {
  thisWeek: number;
  lastWeek: number;
  /** Percent change, or null when last week is 0 — a percentage against nothing is not a number. */
  deltaPct: number | null;
}

/**
 * Rolling 7-day windows, not calendar weeks.
 *
 * A calendar week reports 0 every Monday morning and "−90%" every Monday night, which is noise about
 * the calendar rather than about the learner. Two rolling windows compare like with like on any day.
 */
export function weekTotals(log: StudyLog, todayKey: string): WeekTotals {
  const sum = (fromOffset: number) => {
    let total = 0;
    for (let i = 0; i < 7; i++) total += log[addDays(todayKey, -(fromOffset + i))] ?? 0;
    return total;
  };
  const thisWeek = sum(0);
  const lastWeek = sum(7);
  return { thisWeek, lastWeek, deltaPct: lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null };
}

export interface HeatCell {
  key: string;
  seconds: number;
  /** 0…4, 0 meaning nothing recorded. */
  level: number;
  /** false for a day in the current week that has not happened yet — drawn blank, never as zero. */
  past: boolean;
}

export interface HeatWeek {
  /** The Monday this column starts on. */
  monday: string;
  cells: HeatCell[];
}

/** Intensity buckets. Fifteen minutes is a real session; ninety is a full evening. */
export function studyLevel(seconds: number): number {
  if (!(seconds > 0)) return 0;
  if (seconds <= 15 * 60) return 1;
  if (seconds <= 45 * 60) return 2;
  if (seconds <= 90 * 60) return 3;
  return 4;
}

/**
 * A GitHub-style grid, `weeks` columns of Monday→Sunday, oldest column first, the last column
 * holding today.
 *
 * Columns start on Monday so the rows are stable names (Mon…Sun) rather than a window that slides by
 * weekday. Days after today are marked `past: false`, because a future cell drawn at level 0 is a
 * claim the learner failed a day that has not arrived.
 */
export function heatmapWeeks(log: StudyLog, weeks: number, todayKey: string): HeatWeek[] {
  const span = Math.max(1, Math.floor(weeks));
  const todayDow = new Date(`${todayKey}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const mondayOffset = (todayDow + 6) % 7;                      // days since this week's Monday
  const lastMonday = addDays(todayKey, -mondayOffset);
  const out: HeatWeek[] = [];
  for (let w = span - 1; w >= 0; w--) {
    const monday = addDays(lastMonday, -7 * w);
    const cells: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const key = addDays(monday, d);
      const seconds = log[key] ?? 0;
      cells.push({ key, seconds, level: studyLevel(seconds), past: key <= todayKey });
    }
    out.push({ monday, cells });
  }
  return out;
}

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface HeatMonth {
  label: string;
  /** Column index in `HeatYear.weeks` this label sits above. */
  col: number;
}

export interface HeatYear {
  /** Oldest column first. 53 columns covers a full year whatever weekday today is. */
  weeks: HeatWeek[];
  months: HeatMonth[];
  /** First day of the window and today, inclusive. */
  from: string;
  to: string;
  /** Days the window spans. */
  days: number;
  /** Days in the window that carry study time. */
  activeDays: number;
  /** Seconds in the window. */
  totalSeconds: number;
  /** Longest run of consecutive active days inside the window. */
  longestRun: number;
  /** The biggest day inside the window, newest on a tie, or null when nothing was recorded. */
  busiest: TopDay | null;
}

/**
 * A YEAR of the same grid: 53 columns, a label per month, and the figures a year view is actually
 * asked for (active days, longest run, total, best day) computed over the same window it draws.
 *
 * 53 columns rather than 52, because a 52-column grid starting on a Monday misses the first days of
 * the same month last year whenever today is not a Monday — the streak a learner is proud of can sit
 * one column outside the frame. `heatmapWeeks` stays the primitive; this only adds the reading aids,
 * and every figure here is windowed so the card can never mix "this year" with "all time".
 */
export function heatmapYear(log: StudyLog, todayKey: string, weeks = 53): HeatYear {
  const weekRows = heatmapWeeks(log, Math.max(1, Math.floor(weeks)), todayKey);

  const months: HeatMonth[] = [];
  let lastLabel = -99;
  weekRows.forEach((w, col) => {
    const month = w.monday.slice(0, 7);
    if (col > 0 && weekRows[col - 1].monday.slice(0, 7) === month) return;
    // Two labels need room between them: a 31-day month can start three columns after the last one, and
    // a label sitting on top of its neighbour reads worse than a month that goes unlabelled.
    if (col - lastLabel < 3) return;
    lastLabel = col;
    months.push({ label: MONTHS_SHORT[Number(month.slice(5, 7)) - 1], col });
  });

  let activeDays = 0;
  let totalSeconds = 0;
  let longestRun = 0;
  let run = 0;
  let busiest: TopDay | null = null;
  // Columns run Monday→Sunday, oldest first, so a plain scan is already in date order — the run below
  // counts real consecutive days, not consecutive cells.
  for (const w of weekRows) {
    for (const c of w.cells) {
      if (!c.past) continue;
      if (c.seconds > 0) {
        activeDays += 1;
        totalSeconds += c.seconds;
        run += 1;
        if (run > longestRun) longestRun = run;
        // Same tie rule as `topDays`: several equal best days report the most recent one, not the
        // oldest of them, so "best day" does not answer with a date the other card disagrees with.
        if (!busiest || c.seconds > busiest.seconds || (c.seconds === busiest.seconds && c.key > busiest.key)) {
          busiest = { key: c.key, seconds: c.seconds };
        }
      } else {
        run = 0;
      }
    }
  }

  const from = weekRows[0]?.monday ?? todayKey;
  return {
    weeks: weekRows,
    months,
    from,
    to: todayKey,
    days: Math.round((Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1,
    activeDays,
    totalSeconds,
    longestRun,
    busiest,
  };
}

export interface WeekdayBucket {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  totalSeconds: number;
  days: number;
  avgSeconds: number;
}

/**
 * Which days of the week actually get studied.
 *
 * Averaged over the days that have HAPPENED (per weekday), not over the whole log, so a Tuesday that
 * was never studied drags Tuesday down instead of being skipped — that is the whole point of asking.
 */
export function weekdayProfile(log: StudyLog, todayKey: string): WeekdayBucket[] {
  const buckets: WeekdayBucket[] = Array.from({ length: 7 }, (_, weekday) => ({ weekday, totalSeconds: 0, days: 0, avgSeconds: 0 }));
  const first = Object.keys(log).filter(isDayKey).sort()[0];
  if (!first) return buckets;
  for (let key = first; key <= todayKey; key = addDays(key, 1)) {
    const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
    buckets[weekday].days += 1;
    buckets[weekday].totalSeconds += log[key] ?? 0;
  }
  for (const b of buckets) b.avgSeconds = b.days ? Math.round(b.totalSeconds / b.days) : 0;
  return buckets;
}

export interface TopDay {
  key: string;
  seconds: number;
}

/** The biggest days in the log, newest first on a tie. Used for a "best day" line, never for a verdict. */
export function topDays(log: StudyLog, n: number): TopDay[] {
  return Object.entries(log)
    .filter(([k, v]) => isDayKey(k) && isFinite(v) && v > 0)
    .map(([key, seconds]) => ({ key, seconds }))
    .sort((a, b) => b.seconds - a.seconds || (a.key < b.key ? 1 : -1))
    .slice(0, Math.max(0, n));
}

/** '1h 24m' / '45m' / '—' for zero. Zero prints as a dash, because "0m" reads as a verdict. */
export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Minutes for a chart's y-axis label: 90 → '1.5h'. Kept short so ticks never widen the plot. */
export function axisHours(minutes: number): string {
  if (minutes <= 0) return '0';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}
