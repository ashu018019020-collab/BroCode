/**
 * The 61 surfaces, and the icons that identify them.
 *
 * BroCode exposes 61 numbered things a learner can open. They are NOT 61 competing journeys: they
 * are ONE master learning path (01–36) and four support families around it — practice (37–44),
 * labs & build (45–52), career (53–56) and reference (57–61). This module owns that numbering and
 * the icon key every surface is drawn with, so no page can invent a number or a look of its own.
 *
 * Why the numbers are not decoration: `PathGrid` prints them on the rail, the Learning Path prints
 * them on the stage cards, and the only reason two different pages describe the same surface the
 * same way is that both read them from here. The spans are pinned by
 * `scripts/tests/surfaces.test.mjs`, which also re-derives the four support families from
 * `EXTRA_PATHS` — a route added there without a glyph here fails the suite instead of rendering a
 * blank tile.
 *
 * THE LOGO SYSTEM — three families, one visual language.
 *
 *   · DOMAIN — the technology identity (Python, NumPy, Pandas, SQL, ML, NLP, GenAI, Agentic AI,
 *     Production, Projects). A domain logo is not decoration: it identifies a whole knowledge
 *     ecosystem, and the same mark follows that technology everywhere it is taught.
 *   · STAGE — the ten stages of the master path, in the roadmap's own order.
 *   · FEATURE — the 25 support surfaces: one functional meaning each (timer, refresh, warning…).
 *
 * All three draw from ONE glyph registry on ONE 24×24 grid with one stroke weight, which is what
 * keeps 42 marks looking like a family instead of a clip-art folder. Several glyphs are shared
 * ACROSS families on purpose (the ML domain and the ML/NLP stage are the same brain; GenAI's spark
 * appears on the stage and the domain) — the point of a system is that a learner learns a mark once.
 *
 * Pure on purpose: no React, no store, no imports at all, no emoji. `engines.test.mjs` sweeps
 * `src/core/learning` for React/store imports and `scripts/tests/surfaces.test.mjs` loads this file
 * directly with fixtures, so a value import here would make it unimportable under `node --test`.
 */

/* ------------------------------- the families ---------------------------- */

/** The five top-level families, in the order the Learning Path presents them. */
export type SurfaceFamilyId = 'master' | 'practice' | 'lab' | 'career' | 'reference';

export interface SurfaceFamily {
  id: SurfaceFamilyId;
  /** Locale key for the family's heading. */
  key: string;
  /** First and last surface number of the family, inclusive. */
  first: number;
  last: number;
  /** One of the `.tone-*` families: colour says "which family", never "how good". */
  tone: string;
}

/**
 * The spans tile 1…61 with no gap and no overlap — the test asserts exactly that, because a hole
 * between two families is a surface nobody can find and a doubled number is two surfaces sharing a
 * node on the rail.
 */
export const SURFACE_FAMILIES: SurfaceFamily[] = [
  { id: 'master', key: 'path.famMaster', first: 1, last: 36, tone: 'cyan' },
  { id: 'practice', key: 'path.famPractice', first: 37, last: 44, tone: 'violet' },
  { id: 'lab', key: 'path.famLab', first: 45, last: 52, tone: 'blue' },
  { id: 'career', key: 'path.famCareer', first: 53, last: 56, tone: 'amber' },
  { id: 'reference', key: 'path.famReference', first: 57, last: 61, tone: 'green' },
];

/** Every openable surface in the product. */
export const SURFACE_COUNT = 61;
/** Where the master learning path ends and the support families begin. */
export const MASTER_STEPS = 36;

/** The family a surface number belongs to. Numbers are 1-based and the caller clamps. */
export function familyOfNo(no: number): SurfaceFamily {
  return SURFACE_FAMILIES.find((f) => no >= f.first && no <= f.last) ?? SURFACE_FAMILIES[0];
}

/** The family record itself, for a caller that already knows which one it wants. */
export function family(id: SurfaceFamilyId): SurfaceFamily {
  return SURFACE_FAMILIES.find((f) => f.id === id) ?? SURFACE_FAMILIES[0];
}

/** How many surfaces a family holds — the denominator of its own progress line. */
export function familySize(id: SurfaceFamilyId): number {
  const f = family(id);
  return f.last - f.first + 1;
}

/** The support families in presentation order — everything except the master path. */
export const SUPPORT_FAMILIES: SurfaceFamilyId[] = ['practice', 'lab', 'career', 'reference'];

/* ------------------------------ the glyph grid --------------------------- */

/**
 * Every mark the product draws, on one grid. Named for the IDEA (target, timer, refresh), not for
 * the page that happens to use it first, so two surfaces with the same meaning can share a mark.
 */
export type GlyphId =
  /* stage family */
  | 'compass' | 'bars' | 'python' | 'trend' | 'pipeline' | 'brain' | 'spark' | 'robot' | 'cloud' | 'target'
  /* domain family */
  | 'numpy' | 'pandas' | 'sql' | 'network' | 'language' | 'cube'
  /* feature family */
  | 'archive' | 'questions' | 'interview' | 'mic' | 'timer' | 'clipboard' | 'refresh' | 'warning'
  | 'code' | 'notebook' | 'table' | 'search' | 'resume' | 'briefcase' | 'shield' | 'chart'
  | 'bulb' | 'sticky' | 'layers' | 'pdf' | 'book';

/** The technology ecosystems a domain mark stands for. */
export type DomainId =
  | 'python' | 'numpy' | 'pandas' | 'sql' | 'ml' | 'nlp' | 'genai' | 'agentic' | 'production' | 'projects';

export const DOMAINS: DomainId[] = ['python', 'numpy', 'pandas', 'sql', 'ml', 'nlp', 'genai', 'agentic', 'production', 'projects'];

/** The mark that identifies each domain, everywhere that domain appears. */
export const DOMAIN_GLYPH: Record<DomainId, GlyphId> = {
  python: 'python',
  numpy: 'numpy',
  pandas: 'pandas',
  sql: 'sql',
  ml: 'network',
  nlp: 'language',
  genai: 'spark',
  agentic: 'robot',
  production: 'cloud',
  projects: 'cube',
};

/**
 * The domain names are PROPER NOUNS — "NumPy" is not a word a translator may rewrite — so they are
 * content, like the roadmap's own step titles, and stay in one language on purpose.
 */
export const DOMAIN_NAME: Record<DomainId, string> = {
  python: 'Python',
  numpy: 'NumPy',
  pandas: 'Pandas',
  sql: 'SQL',
  ml: 'Machine Learning',
  nlp: 'NLP',
  genai: 'Generative AI',
  agentic: 'Agentic AI',
  production: 'APIs & Production',
  projects: 'Projects & Career',
};

/**
 * Which domains a curriculum track teaches. The 8 tracks are the SECTION-based view and the ten
 * domains are the TECHNOLOGY view, and they do not line up one-to-one (the NumPy + Pandas track
 * teaches two domains; the ML + NLP track teaches two) — so the mapping is many-to-many and lives
 * here rather than being guessed at each call site. The test pins every track id in TRACK_DEFS.
 */
export const TRACK_DOMAINS: Record<string, DomainId[]> = {
  python: ['python'],
  data: ['numpy', 'pandas'],
  sql: ['sql'],
  ml: ['ml', 'nlp'],
  genai: ['genai'],
  agentic: ['agentic'],
  apis: ['production'],
  interview: ['projects'],
};

/**
 * The ten stages of the master path, keyed by the roadmap's phase ids. Literals rather than a type
 * import, the same way `paths.ts` declares its key families: `surfaces.test.mjs` asserts these keys
 * ARE the roadmap's `PHASES.map(p => p.id)`, so the value can only drift if both files change.
 */
export const STAGE_GLYPH: Record<string, GlyphId> = {
  orientation: 'compass',
  dataFoundation: 'bars',
  python: 'python',
  analytics: 'trend',
  dataEngineering: 'pipeline',
  mlNlp: 'brain',
  genai: 'spark',
  agents: 'robot',
  build: 'cloud',
  career: 'target',
};

/* ------------------------- the 25 support surfaces ---------------------- */

/**
 * Route → mark, for the surfaces numbered 37–61. Keyed by ROUTE and not by position because the
 * route is the stable identity (`EXTRA_PATHS` may be reordered) — `surfaces.test.mjs` diffs this
 * against `EXTRA_PATHS`, so a new support surface cannot ship without a mark.
 */
export const SURFACE_GLYPH: Record<string, GlyphId> = {
  /* 37–44 · practice */
  '/playbook': 'archive',
  '/questions': 'questions',
  '/interview': 'interview',
  '/mock': 'mic',
  '/exam': 'timer',
  '/final': 'clipboard',
  '/review': 'refresh',
  '/mistakes': 'warning',
  /* 45–52 · labs & build */
  '/playground': 'code',
  '/notebooks': 'notebook',
  '/sql': 'sql',
  '/numpy-pandas': 'table',
  '/ai': 'spark',
  '/agentic': 'robot',
  '/rag': 'search',
  '/projects': 'cube',
  /* 53–56 · career */
  '/resume': 'resume',
  '/jobprep': 'briefcase',
  '/defense': 'shield',
  '/progress': 'chart',
  /* 57–61 · reference */
  '/concepts': 'bulb',
  '/notes': 'sticky',
  '/cheats': 'layers',
  '/pdf': 'pdf',
  '/pdf/playbook': 'book',
};

/**
 * THE PRACTICE ARCHIVE — surface 37.
 *
 * The imported V15 practice set used to be presented as "Playbook V15": a product-looking name for
 * a SECOND learning journey, which is exactly what it is not. It is 476 practice items the master
 * path teaches, kept under `source: 'v15'` internally for traceability and NEVER shown to the
 * learner as a brand. One route, one label key, one place to change it.
 */
export const ARCHIVE_ROUTE = '/playbook';
export const ARCHIVE_LABEL_KEY = 'path.practiceArchive';
/** The internal provenance marker. Never rendered — it exists so migrated items stay traceable. */
export const ARCHIVE_SOURCE = 'v15';
