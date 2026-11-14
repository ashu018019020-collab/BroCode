/**
 * The MySQL Complete Masterclass course mark.
 *
 * A dolphin leaping over a database cylinder, drawn as flat SVG so the card and the course page
 * share one asset. The colours are MySQL's orange and blue, not the app's accents.
 */
export function MysqlLogo({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="MySQL Complete Masterclass">
      <defs>
        <linearGradient id="mysql-dolphin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F29111" />
          <stop offset="1" stopColor="#E48E00" />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="52" rx="21" ry="6" fill="#00618A" opacity="0.16" />
      <path d="M14 45c0-4.4 8-8 18-8s18 3.6 18 8v5c0 4.4-8 8-18 8s-18-3.6-18-8z" fill="#00618A" />
      <path d="M14 45c0 4.4 8 8 18 8s18-3.6 18-8" fill="none" stroke="#8FD3F4" strokeWidth="2" opacity="0.8" />
      <path d="M14 50c0 4.4 8 8 18 8s18-3.6 18-8" fill="none" stroke="#8FD3F4" strokeWidth="1.5" opacity="0.55" />
      <path
        d="M18 34c5-9 14-13 22-13 2.7 0 5 .8 6.8 2.2-2.3.2-4.2 1.3-5.3 3 3.1.2 5.7 1.6 7.5 3.8-2.2-.4-4.3-.2-6 .7 2.2 1.9 3.4 4.4 3.5 7.2-2.3-2.3-5-3.7-8.2-4.2l-2.1 4.6c-.6 1.4-2.4 1.6-3.3.4l-2.2-2.9c-4.1.6-7.8 2.5-10.7 5.4-.9.9-2.5.3-2.5-1 0-2.6.7-5.2 2.5-7.2l-2.7.3c-.7.1-1.2-.7-.8-1.3z"
        fill="url(#mysql-dolphin)"
      />
      <circle cx="40.5" cy="24.5" r="1.4" fill="#0B1F2A" />
      <path d="M33 34c2.6 1 4.6 2.6 6 4.8" fill="none" stroke="#B85F00" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M14 24c0-2 1.6-3.6 3.6-3.6S21 22 21 24" fill="none" stroke="#00618A" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}
