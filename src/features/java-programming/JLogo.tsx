/**
 * The Java course mark — inline, not a file under `src/assets/logos/`.
 *
 * That folder belongs to the eleven-course pack and `courses-ui.test.mjs` rejects a mark no course
 * in the pack names, so the Java course's logo lives with its feature exactly like `CLogo`.
 *
 * The drawing is the Java coffee-cup mark: blue cup and saucer, red steam, on a light tile.
 */
export function JLogo({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Java Programming">
      <rect width="48" height="48" rx="11" fill="#FFFFFF" />
      <rect x="0.6" y="0.6" width="46.8" height="46.8" rx="10.5" fill="none" stroke="rgba(15,23,42,.10)" strokeWidth="1.2" />
      {/* Steam — the two red curls above the cup. */}
      <path d="M19.5 19.2c-2.6-2.4-2.2-5.2.4-7.3 2-1.6 2.2-3.2.7-4.9" fill="none" stroke="#ED1C24" strokeWidth="2" strokeLinecap="round" />
      <path d="M27 19.2c-2.6-2.4-2.2-5.2.4-7.3 2-1.6 2.2-3.2.7-4.9" fill="none" stroke="#ED1C24" strokeWidth="2" strokeLinecap="round" />
      {/* Handle, then body so the body's edge stays crisp. */}
      <path d="M31.4 25.4h2.1a4.1 4.1 0 0 1 0 8.2h-2.1" fill="none" stroke="#0074BD" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M13.6 22.6h18.2v6.2a8.1 8.1 0 0 1-8.1 8.1h-2a8.1 8.1 0 0 1-8.1-8.1z" fill="#0074BD" />
      <path d="M13.6 22.6h18.2v1.9H13.6z" fill="#3FA3E0" />
      {/* Saucer. */}
      <ellipse cx="22.7" cy="40.6" rx="12" ry="2.1" fill="#0074BD" opacity=".92" />
    </svg>
  );
}
