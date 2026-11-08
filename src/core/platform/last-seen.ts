const DAY_MS = 24 * 60 * 60 * 1000;

function localDayNumber(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

export type RelativeUnit = 'now' | 'minute' | 'hour' | 'yesterday' | 'day' | 'date';

export interface RelativeParts {
  unit: RelativeUnit;
  /** Minutes / hours / days for those units; 0 for `now`, `yesterday` and `date`. */
  value: number;
  /** The calendar date, only for the `date` unit — the caller renders it in its own language. */
  date: Date | null;
}

/**
 * Which relative bucket a timestamp falls in, and its count — the ONE arithmetic behind every
 * "how long ago" string in the app.
 *
 * The header's last-seen line and the dashboard's activity rail answered the same question with
 * two separate pieces of maths (and the rail answered it in raw English: `5m ago`). Splitting the
 * BUCKET out from the words lets each surface say it in its own language while both keep the same
 * thresholds — and the thresholds are the part that drifts, not the words.
 *
 * `null` means the input is not a timestamp at all; a future timestamp clamps to `now` rather than
 * producing a negative count.
 */
export function relativeParts(timestamp: number, now: number): RelativeParts | null {
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return null;

  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return { unit: 'now', value: 0, date: null };
  if (elapsed < 60 * 60_000) {
    return { unit: 'minute', value: Math.floor(elapsed / 60_000), date: null };
  }
  const calendarDays = localDayNumber(now) - localDayNumber(timestamp);
  if (calendarDays === 1) return { unit: 'yesterday', value: 1, date: null };
  if (elapsed < DAY_MS) {
    return { unit: 'hour', value: Math.floor(elapsed / (60 * 60_000)), date: null };
  }

  if (calendarDays > 1 && calendarDays < 7) return { unit: 'day', value: calendarDays, date: null };
  return { unit: 'date', value: 0, date: new Date(timestamp) };
}

export function formatLastSeen(timestamp: number, now: number): string {
  const parts = relativeParts(timestamp, now);
  if (!parts) return 'Unknown';
  if (parts.unit === 'now') return 'Just now';
  if (parts.unit === 'minute') return `${parts.value} ${parts.value === 1 ? 'minute' : 'minutes'} ago`;
  if (parts.unit === 'yesterday') return 'Yesterday';
  if (parts.unit === 'hour') return `${parts.value} ${parts.value === 1 ? 'hour' : 'hours'} ago`;
  if (parts.unit === 'day') return `Last seen ${parts.value} days ago`;

  const date = parts.date as Date;
  const month = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date);
  return `${date.getDate()} ${month} ${date.getFullYear()}`;
}
