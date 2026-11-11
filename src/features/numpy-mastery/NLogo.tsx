/**
 * The NumPy Mastery course mark — inline, like `CLogo` and `JLogo`.
 *
 * `src/assets/logos/` belongs to the eleven-course pack (`courses-ui.test.mjs` rejects a mark no
 * course in the pack names), so a course with its own page carries its own drawing.
 *
 * The drawing is NumPy's blue/green palette over an array grid: three rows of cells with the first
 * column highlighted, which reads as an ndarray rather than a generic letter tile.
 */
export function NLogo({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="NumPy Mastery">
      <defs>
        <linearGradient id="np-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4DABCF" />
          <stop offset="1" stopColor="#4D77CF" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="11" fill="url(#np-bg)" />
      {/* Array grid — three rows, four columns, with the first column filled in green. */}
      <g fill="none" stroke="#EAF6FF" strokeWidth="1.5" opacity=".9">
        <rect x="9" y="13" width="30" height="22" rx="2.5" />
        <path d="M16.5 13v22M24 13v22M31.5 13v22M9 20.3h30M9 27.6h30" />
      </g>
      <g fill="#4AD0A0">
        <rect x="10.4" y="14.4" width="4.8" height="4.6" rx="1" />
        <rect x="10.4" y="21.7" width="4.8" height="4.6" rx="1" />
        <rect x="10.4" y="29" width="4.8" height="4.6" rx="1" />
      </g>
      {/* The N, drawn over the grid's free cells. */}
      <path d="M20.5 30V18h2.2l6.4 7.6V18h2.2v12h-2.2l-6.4-7.6V30z" fill="#EAF6FF" />
    </svg>
  );
}
