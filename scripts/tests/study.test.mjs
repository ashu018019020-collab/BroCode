/**
 * Study time — the dashboard's numbers, pinned.
 *
 * The traps here are all SILENT, which is why each one gets a test: the log is sparse, so anything
 * that reads it directly loses the empty days and draws four bars where there were four weeks; a
 * streak read literally at 05:30 in the morning reports itself broken; and a percentage change
 * against a week of zero is not a number at all and must be null rather than +100%.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const s = await load('src/core/learning/study.ts');

/** Monday — asserted below, because half the boundary expectations depend on it. */
const TODAY = '2026-09-28';
const MIN = 60;

test('study: the day keys line up with the store\'s own rule', () => {
  assert.equal(new Date(`${TODAY}T00:00:00Z`).getUTCDay(), 1, 'the fixture day must be a Monday');
  assert.equal(s.dateKey(new Date('2026-09-28T23:30:00Z')), TODAY);
  assert.equal(s.addDays(TODAY, 1), '2026-09-29');
  assert.equal(s.addDays(TODAY, -1), '2026-09-27');
  // Month and year boundaries, because `addDays` is date arithmetic and not string surgery.
  assert.equal(s.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(s.addDays('2027-03-01', -1), '2027-02-28');
});

test('study: a gap day is a real day, so the timeline is zero-filled', () => {
  const log = { '2026-09-21': 30 * MIN, [TODAY]: 45 * MIN };
  const series = s.daySeries(log, 3, TODAY);
  assert.deepEqual(series.map((d) => d.key), ['2026-09-26', '2026-09-27', TODAY]);
  // The two days with nothing on them are present AND zero — not absent, not the neighbour's value.
  assert.deepEqual(series.map((d) => d.seconds), [0, 0, 45 * MIN]);
  assert.deepEqual(series.map((d) => d.minutes), [0, 0, 45]);
  assert.deepEqual(series.map((d) => d.weekday), [6, 0, 1]);
});

test('study: only real, positive whole seconds ever enter the log', () => {
  const start = {};
  for (const bad of [0, -1, -0.4, NaN, Infinity, -Infinity]) {
    assert.equal(s.addStudy(start, bad, TODAY), start, `stored: ${bad}`);
  }
  // A bad KEY is refused too: a typo would create a day the calendar can never reach.
  assert.equal(s.addStudy(start, 30, '2026/09/28'), start);
  assert.equal(s.addStudy(start, 30, ''), start);
  const once = s.addStudy(start, 30.4, TODAY);
  assert.deepEqual(once, { [TODAY]: 30 });
  // Adding is additive, and never mutates the log it was handed.
  assert.deepEqual(s.addStudy(once, 12, TODAY), { [TODAY]: 42 });
  assert.deepEqual(once, { [TODAY]: 30 });
});

test('study: the per-tick cap exists for a throttled tab, not for the clock', () => {
  // A background tab's timers fire about once a minute; without the cap an idle tab asleep since
  // last night would bank eight hours of "study". The tracker clamps to this, and the engine states
  // what the clamp is so the two cannot disagree.
  assert.equal(s.MAX_TICK_SECONDS, 5);
});

test('study: a streak survives the morning it has not been earned in yet', () => {
  const log = { '2026-09-26': MIN, '2026-09-27': MIN, [TODAY]: MIN };
  assert.equal(s.studyStreak(log, TODAY), 3);
  // Today still empty (05:30): the run of 2 must keep standing, not reset to 0.
  assert.equal(s.studyStreak({ '2026-09-26': MIN, '2026-09-27': MIN }, TODAY), 2);
  // A whole missed day DOES end it, and yesterday stops counting as the tail.
  assert.equal(s.studyStreak({ '2026-09-26': MIN }, TODAY), 0);
  assert.equal(s.studyStreak({ '2026-09-25': MIN, '2026-09-26': MIN }, TODAY), 0);
  assert.equal(s.studyStreak({}, TODAY), 0);
  // Zero seconds is not a studied day — a stored 0 must not extend a streak.
  assert.equal(s.studyStreak({ '2026-09-27': 0, '2026-09-26': MIN }, TODAY), 0);
});

test('study: this week is the last 7 days, not the calendar week', () => {
  // 2h inside the PREVIOUS rolling week (offsets 12 and 13 back), not the one before that: an entry
  // 14 days back is outside both windows and would silently make this a test about nothing.
  const last = { '2026-09-15': 60 * MIN, '2026-09-16': 60 * MIN };
  const log = { ...last, [TODAY]: 90 * MIN };                       // 1.5h today
  const w = s.weekTotals(log, TODAY);
  assert.equal(w.thisWeek, 90 * MIN);
  assert.equal(w.lastWeek, 120 * MIN);
  assert.equal(w.deltaPct, -25);
  // Against a week of nothing, a change has no percentage — it must not print +100% or Infinity.
  assert.equal(s.weekTotals({ [TODAY]: 10 * MIN }, TODAY).deltaPct, null);
  assert.equal(s.weekTotals({}, TODAY).deltaPct, null);
});

test('study: the totals average over days that happened, not over the calendar', () => {
  const log = { '2026-09-01': 60 * MIN, '2026-09-02': 30 * MIN, '2026-09-09': 120 * MIN };
  const t = s.studyTotals(log);
  assert.equal(t.seconds, 210 * MIN);
  assert.equal(t.activeDays, 3);
  assert.equal(t.avgActiveSeconds, 70 * MIN, 'a holiday must not read as laziness');
  assert.equal(t.bestKey, '2026-09-09');
  assert.equal(t.bestSeconds, 120 * MIN);
  assert.deepEqual(s.studyTotals({}), { seconds: 0, activeDays: 0, bestKey: null, bestSeconds: 0, avgActiveSeconds: 0 });
});

test('study: the heat grid is Monday-first, ends on today, and never paints the future', () => {
  const log = { '2026-09-28': 20 * MIN, '2026-09-22': 100 * MIN };
  const weeks = s.heatmapWeeks(log, 3, TODAY);
  assert.equal(weeks.length, 3);
  for (const w of weeks) {
    assert.equal(w.cells.length, 7);
    assert.equal(new Date(`${w.monday}T00:00:00Z`).getUTCDay(), 1, 'every column must start on a Monday');
  }
  // Today is a Monday → the last column starts today, and Tue…Sun of this week are not "zero".
  assert.equal(weeks[2].monday, TODAY);
  assert.deepEqual(weeks[2].cells.map((c) => c.past), [true, false, false, false, false, false, false]);
  assert.equal(weeks[2].cells[0].level, s.studyLevel(20 * MIN));
  // The previous column holds the 22nd (Tuesday of the week before).
  assert.equal(weeks[1].monday, '2026-09-21');
  assert.equal(weeks[1].cells[1].key, '2026-09-22');
  assert.equal(weeks[1].cells[1].level, 4);
  // A day that is absent is level 0 with a real key, so a tooltip can still name it.
  assert.equal(weeks[1].cells[0].key, '2026-09-21');
  assert.equal(weeks[1].cells[0].seconds, 0);
});

test('study: intensity buckets step at the session boundaries', () => {
  assert.equal(s.studyLevel(0), 0);
  assert.equal(s.studyLevel(-5), 0);
  assert.equal(s.studyLevel(1), 1);
  assert.equal(s.studyLevel(15 * MIN), 1);
  assert.equal(s.studyLevel(15 * MIN + 1), 2);
  assert.equal(s.studyLevel(45 * MIN), 2);
  assert.equal(s.studyLevel(90 * MIN), 3);
  assert.equal(s.studyLevel(90 * MIN + 1), 4);
});

test('study: the weekday profile counts the days that have happened', () => {
  const log = { '2026-09-21': 60 * MIN, '2026-09-28': 30 * MIN }; // a Monday and the next Monday
  const p = s.weekdayProfile(log, TODAY);
  assert.equal(p.length, 7);
  const mon = p[1];
  assert.equal(mon.weekday, 1);
  assert.equal(mon.totalSeconds, 90 * MIN);
  assert.equal(mon.days, 2, 'both Mondays since the first entry must be counted');
  assert.equal(mon.avgSeconds, 45 * MIN);
  // The window runs from the first LOGGED day to today, so every weekday in it has HAPPENED — the
  // 23rd and the 27th are counted as days with zero on them. That is the question being asked:
  // "which days do I actually study" is only answerable if the empty ones are in the denominator.
  assert.equal(p[3].days, 1, 'Wednesday the 23rd happened, it just has nothing on it');
  assert.equal(p[3].totalSeconds, 0);
  assert.equal(p[3].avgSeconds, 0);
  assert.equal(p[0].days, 1, 'Sunday the 27th happened too');
  assert.equal(p[0].avgSeconds, 0);
  // A weekday that never fell inside the window at all has nothing to average over.
  assert.deepEqual(s.weekdayProfile({}, TODAY).map((b) => b.days), [0, 0, 0, 0, 0, 0, 0]);
});

test('study: the biggest days are ranked, and a tie goes to the newer one', () => {
  const log = { '2026-09-26': 60 * MIN, '2026-09-27': 60 * MIN, [TODAY]: 5 * MIN };
  assert.deepEqual(s.topDays(log, 2), [
    { key: '2026-09-27', seconds: 60 * MIN },
    { key: '2026-09-26', seconds: 60 * MIN },
  ]);
  assert.deepEqual(s.topDays({}, 3), []);
});

test('study: durations read like a human, and zero is a dash', () => {
  assert.equal(s.formatDuration(0), '—');
  assert.equal(s.formatDuration(-1), '—');
  assert.equal(s.formatDuration(NaN), '—');
  assert.equal(s.formatDuration(40 * 60), '40m');
  assert.equal(s.formatDuration(60 * 60), '1h');
  assert.equal(s.formatDuration(84 * 60), '1h 24m');
  assert.equal(s.formatDuration(60 * 60 + 29), '1h', 'seconds round to the nearest minute');
  assert.equal(s.formatDuration(60 * 60 + 30), '1h 1m', '…and round up from the half minute');
  // Axis ticks stay short so they cannot widen the plot.
  assert.equal(s.axisHours(0), '0');
  assert.equal(s.axisHours(45), '45m');
  assert.equal(s.axisHours(60), '1h');
  assert.equal(s.axisHours(90), '1.5h');
});

test('study: merging two logs sums them and drops what could never be a day', () => {
  const merged = s.mergeStudy({ '2026-09-27': 10 * MIN }, { '2026-09-27': 20 * MIN, '2026-09-28': 5 * MIN, bad: 99, empty: 0 });
  assert.deepEqual(merged, { '2026-09-27': 30 * MIN, '2026-09-28': 5 * MIN });
});

/* ------------------------------- the year view ------------------------------- */

test('study: the year grid covers a full year whatever weekday today is', () => {
  const year = s.heatmapYear({ [TODAY]: 30 * MIN }, TODAY);
  // 53 columns, not 52: on a Monday a 52-column grid starts 364 days back, which drops the first days
  // of the same month last year out of the frame — and the run a learner is proud of can be in them.
  assert.equal(year.weeks.length, 53);
  assert.equal(year.weeks[0].monday, '2025-09-29');
  assert.equal(year.weeks[52].monday, TODAY, 'the last column is the week today is in');
  assert.equal(year.from, '2025-09-29');
  assert.equal(year.to, TODAY);
  assert.equal(year.days, 365, 'a year, counted in days that exist');
  for (const w of year.weeks) assert.equal(w.cells.length, 7, 'every column is a real Mon…Sun week');
  // The rest of this week is drawn but not claimed: six cells are days that have not happened.
  assert.equal(year.weeks[52].cells.filter((c) => !c.past).length, 6);
});

test('study: every year figure is windowed, so a year card cannot report all time', () => {
  const stale = s.addDays(TODAY, -400);
  const log = { [s.addDays(TODAY, -1)]: 10 * MIN, [s.addDays(TODAY, -2)]: 0, [stale]: 99 * MIN };
  const year = s.heatmapYear(log, TODAY);
  assert.equal(year.activeDays, 1, 'a zero entry is not an active day');
  assert.equal(year.totalSeconds, 10 * MIN, 'the 99m day is older than the window, so it is not in it');
  assert.deepEqual(year.busiest, { key: s.addDays(TODAY, -1), seconds: 10 * MIN });
  const empty = s.heatmapYear({}, TODAY);
  assert.equal(empty.activeDays, 0);
  assert.equal(empty.totalSeconds, 0);
  assert.equal(empty.busiest, null, 'no history is null, not a fake best day');
  assert.equal(empty.longestRun, 0);
});

test('study: the longest run counts consecutive days, and a gap ends it', () => {
  const d = (n) => s.addDays(TODAY, -n);
  const log = { [d(5)]: MIN, [d(4)]: MIN, [d(3)]: MIN, [d(1)]: MIN }; // a three-day run, a gap, then one
  const year = s.heatmapYear(log, TODAY);
  assert.equal(year.longestRun, 3, 'the run is not the number of active days');
  assert.equal(year.activeDays, 4);
  // Sunday→Monday is consecutive even though the grid puts it in a new column.
  assert.equal(s.heatmapYear({ '2026-09-27': MIN, [TODAY]: MIN }, TODAY).longestRun, 2);
  // A day that has not been studied yet is not a broken streak: yesterday's run still stands.
  assert.equal(s.heatmapYear({ [d(1)]: MIN, [d(2)]: MIN }, TODAY).longestRun, 2);
  assert.equal(s.heatmapYear({ [TODAY]: MIN }, TODAY).longestRun, 1);
});

test('study: the best day of the year breaks a tie the same way the all-time one does', () => {
  const d = (n) => s.addDays(TODAY, -n);
  const tie = s.heatmapYear({ [d(3)]: 20 * MIN, [d(1)]: 20 * MIN }, TODAY);
  assert.deepEqual(tie.busiest, { key: d(1), seconds: 20 * MIN }, 'two equal days report the newer one');
  assert.deepEqual(s.topDays({ [d(3)]: 20 * MIN, [d(1)]: 20 * MIN }, 1)[0], tie.busiest, 'and agree with topDays');
  // A bigger but older day still wins on size, and a day outside the window is not a candidate.
  const older = s.heatmapYear({ [d(3)]: 90 * MIN, [d(1)]: 20 * MIN }, TODAY);
  assert.deepEqual(older.busiest, { key: d(3), seconds: 90 * MIN });
  assert.equal(s.heatmapYear({ [s.addDays(TODAY, -400)]: 90 * MIN }, TODAY).busiest, null);
});

test('study: the year grid names its months, and no two labels can collide', () => {
  const year = s.heatmapYear({}, TODAY);
  assert.equal(year.months.length, 12, 'a year names its months');
  assert.equal(year.months[0].col, 0, 'the first column carries a label');
  assert.equal(year.months.map((m) => m.label).join(' '), 'Sep Nov Dec Jan Feb Mar Apr May Jun Jul Aug Sep');
  // The dropped October is deliberate: its first column sits one column after September's label, and a
  // label on top of its neighbour reads worse than a month that goes unlabelled.
  for (let i = 0; i < year.months.length; i++) {
    const m = year.months[i];
    assert.equal(m.label, s.MONTHS_SHORT[Number(year.weeks[m.col].monday.slice(5, 7)) - 1], 'a label names the column it sits above');
    if (i > 0) assert.ok(m.col - year.months[i - 1].col >= 3, `${m.label} sits too close to ${year.months[i - 1].label}`);
  }
});
