/**
 * The C++ Mastery course mark.
 *
 * The official C++ identity is the white "C++" wordmark on the standard blue (#00599C). It is drawn
 * here as an inline SVG so the card, the course hero and the module header all share one asset with
 * no network request and no binary file to keep in sync.
 */
export function CppLogo({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="C++ Mastery">
      <defs>
        <linearGradient id="cpp-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0A6BB8" />
          <stop offset="1" stopColor="#004482" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="10" fill="url(#cpp-bg)" />
      {/* The inner keyline of the standard mark. */}
      <rect x="2.4" y="2.4" width="43.2" height="43.2" rx="8" fill="none" stroke="#7FC4F2" strokeOpacity="0.45" strokeWidth="1" />
      <text
        x="24"
        y="30.5"
        textAnchor="middle"
        fontFamily="'Segoe UI', Arial, Helvetica, sans-serif"
        fontSize="19"
        fontWeight="800"
        letterSpacing="-1.2"
        fill="#FFFFFF"
      >
        C++
      </text>
      <text
        x="24"
        y="40"
        textAnchor="middle"
        fontFamily="'Segoe UI', Arial, Helvetica, sans-serif"
        fontSize="5.4"
        fontWeight="700"
        letterSpacing="1.6"
        fill="#B9E0FA"
      >
        MASTERY
      </text>
    </svg>
  );
}
