import { CourseLogo } from './CourseLogo';

/**
 * One track's REAL mark, not a generic glyph.
 *
 * The eleven course logos already ship as bundled SVGs (see `CourseLogo`), and a subject on the
 * Practice / Labs / Interview hubs is one of the same technologies the course pack names. So the
 * tile carries the brand mark a learner can recognise — Python's own, NumPy + Pandas', Postgres for
 * SQL, scikit-learn for ML, the LLM / agent marks for GenAI and Agentic AI, Docker for the API &
 * deployment track, and the briefcase for the interview track — instead of a lucide icon that says
 * nothing about the subject. Names are the course pack's own keys; an unknown id falls back to the
 * shared mark family rather than rendering nothing.
 */
export const SUBJECT_LOGOS: Record<string, string> = {
  python: 'python',
  data: 'numpy-pandas',
  sql: 'postgresql',
  ml: 'scikitlearn',
  genai: 'llm',
  agentic: 'agent',
  apis: 'docker',
  interview: 'briefcase',
};

export function SubjectLogo({
  id,
  name,
  size = 32,
}: {
  id: string;
  name: string;
  size?: number;
}) {
  return <CourseLogo logo={SUBJECT_LOGOS[id] ?? 'brain'} name={name} size={size} />;
}
