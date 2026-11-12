/**
 * datetime64 and fixed-width string arrays, as the course's explorer computes them.
 *
 * NumPy stores a date as an integer count of a chosen unit and text as a fixed-width `<U<n>` buffer.
 * These pure helpers reproduce both rules so the panel can show a computed answer, and
 * `numpy-datetime.test.mjs` compares them with real NumPy calls — including the wide-string width and
 * the day difference — instead of trusting a hand-written table.
 */
export type DateUnit = 'D' | 's' | 'ms';

export interface DateValue {
  /** Milliseconds since the Unix epoch, UTC. */
  ms: number;
  /** Canonical `YYYY-MM-DD` (or `YYYY-MM-DDTHH:MM:SS` when a time was supplied). */
  iso: string;
}

const UNIT_MS: Record<DateUnit, number> = { D: 86_400_000, s: 1_000, ms: 1 };

export function unitMilliseconds(unit: DateUnit): number {
  return UNIT_MS[unit];
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function format(ms: number, withTime: boolean): string {
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return withTime ? `${date}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` : date;
}

/**
 * Parse an ISO date or date-time strictly. `Date.parse` accepts too much (local zones, rollovers), so
 * the components are rebuilt and compared: `2026-02-30` must be rejected, not silently become March.
 */
export function parseDateValue(text: string): DateValue | null {
  const m = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0));
  const probe = new Date(ms);
  if (probe.getUTCFullYear() !== Number(y) || probe.getUTCMonth() !== Number(mo) - 1 || probe.getUTCDate() !== Number(d)) return null;
  const withTime = h !== undefined;
  return { ms, iso: format(ms, withTime) };
}

/** `b - a` expressed in `unit`, like subtracting two datetime64 values. */
export function dateDifference(a: string, b: string, unit: DateUnit): number | null {
  const left = parseDateValue(a);
  const right = parseDateValue(b);
  if (!left || !right) return null;
  return (right.ms - left.ms) / UNIT_MS[unit];
}

/** `a + amount unit`, returned in the same ISO shape the input used. */
export function shiftDate(text: string, amount: number, unit: DateUnit): string | null {
  const value = parseDateValue(text);
  if (!value || !Number.isFinite(amount)) return null;
  const withTime = value.iso.includes('T') || unit !== 'D';
  return format(value.ms + amount * UNIT_MS[unit], withTime);
}

/** What `np.array([...]).dtype` reports for the same strings: `<U` plus the longest length. */
export function stringDtype(values: string[]): string {
  const width = values.reduce((n, v) => Math.max(n, v.length), 0);
  return `<U${Math.max(width, 1)}`;
}

export function charLengths(values: string[]): number[] {
  return values.map((v) => v.length);
}

export function upperAll(values: string[]): string[] {
  return values.map((v) => v.toUpperCase());
}

/** Assignment into a fixed-width array truncates to the dtype width; it never grows the buffer. */
export function truncateAll(values: string[], width: number): string[] {
  const w = Math.max(0, Math.floor(width));
  return values.map((v) => v.slice(0, w));
}

/** NumPy sorts strings by code point, which is `Array.prototype.sort` for the ASCII this tool takes. */
export function sortedStrings(values: string[]): string[] {
  return [...values].sort();
}

export interface StringSummary {
  dtype: string;
  count: number;
  longest: number;
  shortest: number;
  totalChars: number;
}

export function stringSummary(values: string[]): StringSummary {
  const lengths = charLengths(values);
  return {
    dtype: stringDtype(values),
    count: values.length,
    longest: lengths.length ? Math.max(...lengths) : 0,
    shortest: lengths.length ? Math.min(...lengths) : 0,
    totalChars: lengths.reduce((a, b) => a + b, 0),
  };
}

/** Split the explorer's comma-separated input, trimming each item and dropping empty ones. */
export function parseStringList(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
