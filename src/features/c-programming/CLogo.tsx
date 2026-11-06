/**
 * The C course mark — inline, not a file under `src/assets/logos/`.
 *
 * That folder is the eleven-course pack's own set, and `courses-ui.test.mjs` fails on a mark no
 * course in the pack names. The C course is its own surface, so its logo lives with it.
 */
export function CLogo({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="C Programming">
      <rect width="48" height="48" rx="11" fill="#00599C" />
      <path d="M34.5 16.4A11.2 11.2 0 1 0 34.5 31.6" fill="none" stroke="#fff" strokeWidth="5.6" strokeLinecap="round" />
      <path d="M30 18.6A7.4 7.4 0 1 0 30 29.4" fill="none" stroke="#A8D8FF" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
