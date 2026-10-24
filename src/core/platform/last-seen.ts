const DAY_MS = 24 * 60 * 60 * 1000;

function localDayNumber(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

export function formatLastSeen(timestamp: number, now: number): string {
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return 'Unknown';

  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 60 * 60_000) {
    const minutes = Math.floor(elapsed / 60_000);
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  const calendarDays = localDayNumber(now) - localDayNumber(timestamp);
  if (calendarDays === 1) return 'Yesterday';
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / (60 * 60_000));
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }

  if (calendarDays > 1 && calendarDays < 7) return `Last seen ${calendarDays} days ago`;

  const date = new Date(timestamp);
  const month = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date);
  return `${date.getDate()} ${month} ${date.getFullYear()}`;
}
