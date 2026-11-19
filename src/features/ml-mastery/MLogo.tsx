/**
 * The Machine Learning course mark.
 *
 * A three-layer neural network: four inputs, three hidden nodes and one output, with the weighted
 * edges drawn behind the nodes. It is deliberately a real ML diagram rather than a letter tile, and
 * it stays inline so it ships with the app and has no network dependency.
 */
export function MLogo({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Machine Learning">
      <defs>
        <linearGradient id="ml-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#16B8C8" />
          <stop offset="1" stopColor="#7C5CFA" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="11" fill="url(#ml-bg)" />
      <g stroke="#EAF7FF" strokeWidth="0.9" opacity=".48">
        <path d="M11 13 24 19M11 20l13-1M11 28l13 1M11 35l13-4" />
        <path d="M24 19 37 24M24 24l13 0M24 29l13-5" />
      </g>
      <g fill="#EAF7FF">
        <circle cx="10" cy="13" r="2.1" />
        <circle cx="10" cy="20" r="2.1" />
        <circle cx="10" cy="28" r="2.1" />
        <circle cx="10" cy="35" r="2.1" />
        <circle cx="24" cy="19" r="2.4" />
        <circle cx="24" cy="24" r="2.4" />
        <circle cx="24" cy="29" r="2.4" />
        <circle cx="38" cy="24" r="2.8" fill="#9CF6D9" />
      </g>
    </svg>
  );
}
