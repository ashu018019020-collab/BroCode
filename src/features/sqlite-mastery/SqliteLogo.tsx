/**
 * The Complete SQLite Masterclass course mark.
 *
 * SQLite's identity is the feather/quill; this draws a flat blue feather over a single database
 * file, so the card and the course page share one asset.
 */
export function SqliteLogo({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Complete SQLite Masterclass">
      <defs>
        <linearGradient id="sqlite-feather" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8FD3F4" />
          <stop offset="0.55" stopColor="#2E86C1" />
          <stop offset="1" stopColor="#0B4F6C" />
        </linearGradient>
      </defs>
      <path d="M12 48c0-5 8-9 20-9s20 4 20 9v4c0 5-8 9-20 9s-20-4-20-9z" fill="#0B4F6C" opacity="0.14" />
      <path d="M18 42h28l4 10H14z" fill="#0B4F6C" />
      <path d="M22 42V30h20v12" fill="#EAF6FB" stroke="#0B4F6C" strokeWidth="2" />
      <path d="M27 30v-5h10v5" fill="none" stroke="#0B4F6C" strokeWidth="2" />
      <path
        d="M39 12c6 0 10 4 10 10 0 7-6 14-14 18l-3-3c4-8 7-14 7-19 0-3-1-5-3-6z"
        fill="url(#sqlite-feather)"
      />
      <path d="M32 40c4-8 8-15 9-22" fill="none" stroke="#EAF6FB" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
      <path d="M35 31l6 1M37 26l6 1M39 21l5 1" stroke="#EAF6FB" strokeWidth="1.4" strokeLinecap="round" opacity="0.75" />
      <circle cx="43" cy="18" r="1.2" fill="#0B4F6C" />
    </svg>
  );
}
