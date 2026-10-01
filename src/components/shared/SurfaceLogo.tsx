import type { GlyphId } from '../../core/learning/surfaces';

/**
 * The BroCode mark family — 37 marks, one grid, one stroke weight.
 *
 * The spec this implements asks for 61 logos. 61 drawings is the wrong answer: a platform where
 * every surface has its own hand-drawn art looks like a clip-art folder, and the learner has to
 * relearn a mark for every page. So the system is three families — DOMAIN (the ten technology
 * identities), STAGE (the ten stages of the master path) and FEATURE (the 25 support surfaces) —
 * drawn from ONE registry of marks that several families share on purpose. The ML domain and the
 * ML/NLP stage are the same brain because they mean the same thing; GenAI's spark is the stage's
 * mark and the domain's mark and the AI Lab's. That is the whole point of a system: learn it once.
 *
 * Everything here is one 24×24 grid at `stroke-width: 1.6`, round caps, `currentColor`, no fills
 * except deliberate accents — so a mark stays crisp at 20px in a sidebar row AND at 96px in a
 * stage card, and it picks up the tone its container declares instead of carrying its own palette.
 * Colour lives in CSS (`--tone`), provenance lives in `core/learning/surfaces.ts`, and this file
 * only draws.
 *
 * Inline SVG, never `<img src>`: the app must work with zero network, the marks must inherit
 * `currentColor` from whatever tone the surface declares, and they must never be a separate HTTP
 * request the service worker could miss.
 */
export function SurfaceLogo({
  id,
  size = 24,
  className,
  title,
}: {
  id: GlyphId;
  size?: number;
  className?: string;
  /** Give a mark a name when it is the ONLY thing identifying a surface; omit it when the card
   *  already prints the name as text, so a screen reader does not read the label twice. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      {GLYPHS[id]}
    </svg>
  );
}

const GLYPHS: Record<GlyphId, JSX.Element> = {
  /* ------------------------------- stage -------------------------------- */
  compass: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M15.4 8.6l-2 4.8-4.8 2 2-4.8z" fill="currentColor" stroke="none" />
    </>
  ),
  bars: (
    <>
      <rect x="4" y="13" width="3.4" height="7" rx="1" />
      <rect x="10.3" y="8.4" width="3.4" height="11.6" rx="1" />
      <rect x="16.6" y="4" width="3.4" height="16" rx="1" />
    </>
  ),
  python: (
    <>
      <path d="M12 2.9H9A3.2 3.2 0 0 0 5.8 6.1v3.2h7.4a2.4 2.4 0 0 1 2.4 2.4v2.6" />
      <path d="M12 21.1h3a3.2 3.2 0 0 0 3.2-3.2v-3.2H10.8a2.4 2.4 0 0 1-2.4-2.4v-2.6" />
      <circle cx="8.6" cy="6.5" r="0.95" fill="currentColor" stroke="none" />
      <circle cx="15.4" cy="17.5" r="0.95" fill="currentColor" stroke="none" />
    </>
  ),
  trend: (
    <>
      <path d="M4 18.2l4.3-5.3 3.5 3 4.6-7.3" />
      <path d="M13.2 8.6h3.6v3.6" />
      <path d="M4 21h16" />
    </>
  ),
  pipeline: (
    <>
      <circle cx="5.6" cy="6.4" r="2.4" />
      <circle cx="18.4" cy="12" r="2.4" />
      <circle cx="5.6" cy="17.6" r="2.4" />
      <path d="M7.8 7.5l8.4 3.6" />
      <path d="M7.8 16.5l8.4-3.6" />
    </>
  ),
  brain: (
    <>
      <path d="M11.2 5.2A3.4 3.4 0 0 0 7.8 8.6a2.9 2.9 0 0 0-.6 5.5 3.1 3.1 0 0 0 4 4.7" />
      <path d="M12.8 5.2a3.4 3.4 0 0 1 3.4 3.4 2.9 2.9 0 0 1 .6 5.5 3.1 3.1 0 0 1-4 4.7" />
      <path d="M12 5.5v12.6" />
    </>
  ),
  spark: (
    <>
      <path d="M10.6 3.2l1.5 4.3 4.3 1.5-4.3 1.5-1.5 4.3-1.5-4.3L4.8 9l4.3-1.5z" fill="currentColor" stroke="none" />
      <path d="M17.6 14.2l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </>
  ),
  robot: (
    <>
      <rect x="4.4" y="7.6" width="15.2" height="11.4" rx="3" />
      <path d="M12 7.6V4.9" />
      <circle cx="12" cy="3.7" r="1.2" />
      <circle cx="9.4" cy="13" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.6" cy="13" r="1.1" fill="currentColor" stroke="none" />
      <path d="M9.6 16.4h4.8" />
    </>
  ),
  cloud: <path d="M7.4 19h9.4a4.2 4.2 0 0 0 .5-8.4 5.9 5.9 0 0 0-11.2 1.4A3.3 3.3 0 0 0 7.4 19z" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <circle cx="12" cy="12" r="4.6" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),

  /* ------------------------------- domain ------------------------------- */
  numpy: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.4" />
      <rect x="13" y="4" width="7" height="7" rx="1.4" />
      <rect x="4" y="13" width="7" height="7" rx="1.4" />
      <rect x="13" y="13" width="7" height="7" rx="1.4" strokeDasharray="2.4 2" />
    </>
  ),
  pandas: (
    <>
      <circle cx="7.2" cy="6.6" r="2.2" />
      <circle cx="16.8" cy="6.6" r="2.2" />
      <path d="M5.3 15.4a6.7 6.7 0 0 1 13.4 0 6.7 6.7 0 0 1-13.4 0z" />
      <circle cx="9.6" cy="13.4" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.4" cy="13.4" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  sql: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.6" />
      <path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6" />
      <path d="M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" />
    </>
  ),
  network: (
    <>
      <circle cx="5.6" cy="17.4" r="2.2" />
      <circle cx="12" cy="5.8" r="2.2" />
      <circle cx="18.4" cy="17.4" r="2.2" />
      <path d="M6.9 15.6l3.5-2.5" />
      <path d="M17.1 15.6l-3.5-2.5" />
      <path d="M12 8v2.4" />
    </>
  ),
  language: (
    <>
      <path d="M4.2 5.6h15.6v9.6H10l-4.2 3.4.6-3.4H4.2z" />
      <path d="M7.6 9.2h8.8" />
      <path d="M7.6 12.2h5.6" />
    </>
  ),
  cube: (
    <>
      <path d="M12 2.8l8.2 4.6v9.2L12 21.2 3.8 16.6V7.4z" />
      <path d="M12 12l8.2-4.6" />
      <path d="M12 12v9.2" />
      <path d="M12 12L3.8 7.4" />
    </>
  ),

  /* ------------------------------ feature ------------------------------- */
  archive: (
    <>
      <rect x="3.6" y="4.6" width="16.8" height="4" rx="1.6" />
      <path d="M5.2 8.6v9.6a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2V8.6" />
      <path d="M12 11.4v5" />
      <path d="M9.6 14l2.4 2.4 2.4-2.4" />
    </>
  ),
  questions: (
    <>
      <rect x="5.2" y="3.4" width="13.6" height="17.2" rx="2.4" />
      <path d="M9.7 9.6a2.6 2.6 0 0 1 5 .8c0 1.6-2.4 2-2.4 3.4" />
      <circle cx="12.2" cy="17" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  interview: (
    <>
      <circle cx="9" cy="8" r="2.8" />
      <path d="M3.8 18.6a5.4 5.4 0 0 1 10.4 0" />
      <circle cx="17.4" cy="7.2" r="2.2" />
      <path d="M15 12.4a4.6 4.6 0 0 1 5.4 4.4" />
    </>
  ),
  mic: (
    <>
      <rect x="9.2" y="3" width="5.6" height="9.6" rx="2.8" />
      <path d="M5.8 11.2a6.2 6.2 0 0 0 12.4 0" />
      <path d="M12 17.4v3.2" />
      <path d="M8.6 20.6h6.8" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13.4" r="7.6" />
      <path d="M12 9.8v3.8l2.6 1.8" />
      <path d="M9.4 3.4h5.2" />
      <path d="M12 3.4v2.4" />
    </>
  ),
  clipboard: (
    <>
      <path d="M9 4.4H7.4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2v-13a2 2 0 0 0-2-2H15" />
      <rect x="9" y="2.6" width="6" height="3.6" rx="1.4" />
      <path d="M8.8 13.4l2.2 2.2 4.2-4.2" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20.2 4v4.2H16" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3.8l9 15.6H3z" />
      <path d="M12 9.6v4.2" />
      <circle cx="12" cy="16.6" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  code: (
    <>
      <path d="M9 7.4L4 12l5 4.6" />
      <path d="M15 7.4L20 12l-5 4.6" />
      <path d="M13.4 4.6l-2.8 14.8" />
    </>
  ),
  notebook: (
    <>
      <rect x="5.4" y="3.4" width="13.2" height="17.2" rx="2.4" />
      <path d="M8.8 3.4v17.2" />
      <path d="M11.6 8.4h4.2" />
      <path d="M11.6 11.8h4.2" />
    </>
  ),
  table: (
    <>
      <rect x="3.6" y="4.4" width="16.8" height="15.2" rx="2.4" />
      <path d="M3.6 9.6h16.8" />
      <path d="M9.4 9.6v10" />
      <path d="M14.8 9.6v10" />
    </>
  ),
  search: (
    <>
      <circle cx="10.6" cy="10.6" r="5.8" />
      <path d="M15 15l4.6 4.6" />
    </>
  ),
  resume: (
    <>
      <rect x="5.2" y="3.4" width="13.6" height="17.2" rx="2.4" />
      <circle cx="10.4" cy="9.4" r="1.8" />
      <path d="M8 13.4a2.6 2.6 0 0 1 4.8 0" />
      <path d="M14.6 9h1.8" />
      <path d="M14.6 12.2h1.8" />
      <path d="M8.4 17h8" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3.4" y="7.4" width="17.2" height="11.8" rx="2.4" />
      <path d="M9 7.4V5.8a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.6" />
      <path d="M3.4 13.4h17.2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.2l7.4 2.8v5.4c0 4.4-3.1 7.7-7.4 9.4-4.3-1.7-7.4-5-7.4-9.4V6z" />
      <path d="M9.2 11.8l2.2 2.2 4-4.2" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20h16" />
      <rect x="6" y="12.4" width="3.2" height="5.6" rx="1" />
      <rect x="11" y="8.4" width="3.2" height="9.6" rx="1" />
      <rect x="16" y="4.6" width="3.2" height="13.4" rx="1" />
    </>
  ),
  bulb: (
    <>
      <path d="M12 3.4a5.4 5.4 0 0 0-3 9.9v2.4h6v-2.4a5.4 5.4 0 0 0-3-9.9z" />
      <path d="M9.6 18.4h4.8" />
      <path d="M10.4 20.6h3.2" />
    </>
  ),
  sticky: (
    <>
      <path d="M4.4 4.4h15.2v9.8l-5.4 5.4H4.4z" />
      <path d="M19.6 14.2h-5.4v5.4" />
      <path d="M7.6 8.6h8.8" />
      <path d="M7.6 12h5.8" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.4l8.4 4.2-8.4 4.2L3.6 7.6z" />
      <path d="M3.6 12.4l8.4 4.2 8.4-4.2" />
      <path d="M3.6 16.6l8.4 4.2 8.4-4.2" />
    </>
  ),
  pdf: (
    <>
      <path d="M6.2 3.4h7.2L19 9.2v11.4H6.2z" />
      <path d="M13.4 3.4v5.8H19" />
      <path d="M9.2 13.6h5.6" />
      <path d="M9.2 16.8h3.4" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.4C10.6 5 8.6 4.4 6.2 4.4a3 3 0 0 0-1.4.2v14a3 3 0 0 1 1.4-.2c2.4 0 4.4.6 5.8 2 1.4-1.4 3.4-2 5.8-2a3 3 0 0 1 1.4.2v-14a3 3 0 0 0-1.4-.2c-2.4 0-4.4.6-5.8 2z" />
      <path d="M12 6.4v14" />
    </>
  ),
};
