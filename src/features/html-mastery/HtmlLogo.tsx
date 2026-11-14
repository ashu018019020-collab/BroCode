/**
 * The HTML Mastery course mark.
 *
 * The official HTML5 identity: the orange shield (#E34F26 with the darker #F06529 right half) and
 * the white "5". Drawn as an inline SVG so the catalog card, the course hero, the favicon-sized
 * header and the module header all share one asset with no network request and no binary file to
 * keep in sync.
 */
export function HtmlLogo({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="HTML5">
      <defs>
        <linearGradient id="html-left" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E44D26" />
          <stop offset="1" stopColor="#D8431F" />
        </linearGradient>
        <linearGradient id="html-right" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F16529" />
          <stop offset="1" stopColor="#E44D26" />
        </linearGradient>
      </defs>
      {/* The shield: flat top, straight sides, a point at the bottom centre. */}
      <path d="M5 3h19v42.2L5.9 40.1Z" fill="url(#html-left)" />
      <path d="M24 3h19l-3.1 37.1L24 45.2Z" fill="url(#html-right)" />
      {/* The white 5, the mark's only letterform. */}
      <path
        d="M15.6 12.4h16.8l-.6 3.9H20.1l-.5 4.6h10.7l-1.3 12.4L24 35.6l-5-2.3-.4-5.2h4.2l.2 2.5 2.7 1.2 2.8-1.2.4-4.2H17.9l1.5-13.5Z"
        fill="#FFFFFF"
      />
      <text
        x="24"
        y="43.4"
        textAnchor="middle"
        fontFamily="'Segoe UI', Arial, Helvetica, sans-serif"
        fontSize="3.4"
        fontWeight="700"
        letterSpacing="1.4"
        fill="#FFD9C9"
      >
        HTML5
      </text>
    </svg>
  );
}
