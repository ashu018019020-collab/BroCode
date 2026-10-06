import { useState } from 'react';
import type { GlyphId } from '../../core/learning/surfaces';
import { SurfaceLogo } from './SurfaceLogo';
import brain from '../../assets/logos/brain.svg';
import rLogo from '../../assets/logos/r.svg';
import python from '../../assets/logos/python.svg';
import numpyPandas from '../../assets/logos/numpy-pandas.svg';
import postgresql from '../../assets/logos/postgresql.svg';
import spark from '../../assets/logos/spark.svg';
import scikitlearn from '../../assets/logos/scikitlearn.svg';
import llm from '../../assets/logos/llm.svg';
import agent from '../../assets/logos/agent.svg';
import docker from '../../assets/logos/docker.svg';
import briefcase from '../../assets/logos/briefcase.svg';

/**
 * The bundled course logos.
 *
 * Eleven marks, shipped as SVG assets (Vite inlines/renames them into `dist/assets/`), so a course
 * card renders with ZERO network — the app's rule everywhere else. The name in `index.json`
 * (`brain`, `r`, `python`, …) is the key; a name the pack gains later simply falls back to the
 * shared mark family instead of breaking the card.
 */
export const COURSE_LOGOS: Record<string, string> = {
  brain,
  r: rLogo,
  python,
  'numpy-pandas': numpyPandas,
  postgresql,
  spark,
  scikitlearn,
  llm,
  agent,
  docker,
  briefcase,
};

/** The mark family's glyph for each logo, so a missing/broken file still says what the course is. */
const FALLBACK: Record<string, GlyphId> = {
  brain: 'brain',
  r: 'bars',
  python: 'python',
  'numpy-pandas': 'numpy',
  postgresql: 'sql',
  spark: 'spark',
  scikitlearn: 'network',
  llm: 'spark',
  agent: 'robot',
  docker: 'cloud',
  briefcase: 'briefcase',
};

/**
 * One course's logo.
 *
 * Every `<img>` carries real `alt` text, and a file that fails to load (or a name the map does not
 * know) degrades to the inline mark family — never to a broken-image icon. The drawing layer stays
 * `SurfaceLogo`: no emoji, one grid, one stroke weight.
 */
export function CourseLogo({
  logo,
  name,
  size = 56,
  className,
}: {
  logo: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = COURSE_LOGOS[logo];
  if (!src || failed) {
    return (
      <span
        className={`course-logo fallback ${className ?? ''}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <SurfaceLogo id={FALLBACK[logo] ?? 'bulb'} size={Math.round(size * 0.62)} />
      </span>
    );
  }
  return (
    <img
      className={`course-logo ${className ?? ''}`}
      src={src}
      alt={`${name} logo`}
      width={size}
      height={size}
      onError={() => setFailed(true)}
    />
  );
}
