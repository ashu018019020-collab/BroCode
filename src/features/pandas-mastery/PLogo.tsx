/**
 * The Pandas Mastery course mark — inline, like `CLogo`, `JLogo` and `NLogo`.
 *
 * A panda face on a green tile: two black ears, the black eye patches, a small nose. The greens are
 * the Pandas/data palette, so the mark sits beside NumPy's blue tile without either looking foreign.
 */
export function PLogo({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Pandas Mastery">
      <defs>
        <linearGradient id="pd-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#150458" />
          <stop offset="1" stopColor="#0B6E4F" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="11" fill="url(#pd-bg)" />
      {/* Ears */}
      <circle cx="15.5" cy="15.5" r="6" fill="#0E1116" />
      <circle cx="32.5" cy="15.5" r="6" fill="#0E1116" />
      {/* Head */}
      <ellipse cx="24" cy="26" rx="13.5" ry="12" fill="#F7FAF9" />
      {/* Eye patches */}
      <ellipse cx="18.6" cy="24" rx="4.1" ry="4.9" transform="rotate(-18 18.6 24)" fill="#0E1116" />
      <ellipse cx="29.4" cy="24" rx="4.1" ry="4.9" transform="rotate(18 29.4 24)" fill="#0E1116" />
      {/* Eyes */}
      <circle cx="18.9" cy="23.6" r="1.5" fill="#F7FAF9" />
      <circle cx="29.1" cy="23.6" r="1.5" fill="#F7FAF9" />
      {/* Nose and mouth */}
      <ellipse cx="24" cy="30.4" rx="2.2" ry="1.5" fill="#0E1116" />
      <path d="M24 31.9v1.6M24 33.5c-.9 1.1-2.1 1.3-3.2 1.1M24 33.5c.9 1.1 2.1 1.3 3.2 1.1"
            fill="none" stroke="#0E1116" strokeWidth="1.1" strokeLinecap="round" />
      {/* A quiet table grid in the corner: the course is about columns, not just the animal. */}
      <g stroke="#4AD0A0" strokeWidth="1" opacity="0.75">
        <path d="M36 37.5h7M36 40.5h7M39.5 36v6" />
      </g>
    </svg>
  );
}
