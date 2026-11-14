/**
 * The CSS Mastery course mark.
 *
 * The CSS3 identity: the blue shield in its two official blues (#2965F1 left, #264DE4 right) with
 * the white "3". Drawn as an inline SVG so the catalog card, the course hero, the module header and
 * the playground all share one asset with no network request and no binary file to keep in sync.
 */
export function CssLogo({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="CSS3">
      <defs>
        <linearGradient id="css-left" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#2965F1" />
        </linearGradient>
        <linearGradient id="css-right" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2965F1" />
          <stop offset="1" stopColor="#264DE4" />
        </linearGradient>
      </defs>
      {/* The shield: rounded shoulders, straight sides, a point at the bottom centre. */}
      <path d="M6 4h18v39.2L7.1 39.3Z" fill="url(#css-left)" />
      <path d="M24 4h18l-2.9 35.3L24 43.2Z" fill="url(#css-right)" />
      {/* The white 3, the mark's only letterform. */}
      <path
        d="M15.2 12.2h17.4l-.5 3.8H19.6l-.4 3.9h12.2l-1.3 14.4L24 36.9l-6.1-2.6-.4-5.6h4.1l.2 2.9 2.2 1 2.2-1 .4-4.4H19.1l1.1-13Z"
        fill="#FFFFFF"
      />
      <text
        x="24"
        y="42.4"
        textAnchor="middle"
        fontFamily="'Segoe UI', Arial, Helvetica, sans-serif"
        fontSize="3.2"
        fontWeight="700"
        letterSpacing="1.2"
        fill="#DCE6FF"
      >
        CSS3
      </text>
    </svg>
  );
}
