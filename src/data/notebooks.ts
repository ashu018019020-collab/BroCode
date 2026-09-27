/**
 * The app's single view of the published Jupyter notebooks (`public/notebooks/`).
 *
 * `npm run notebooks:write` executes every cell with the local Python interpreter, stamps the
 * real stdout into the file and writes `manifest.json`. This module reads that manifest once
 * per session and hands it to every place a notebook can be opened: the Notebook Lab page, the
 * notebook panel inside each lesson stage, and the Learning Path shelf.
 *
 * Everything here is offline: the manifest is a local file, and the libraries listed in
 * `NOTEBOOK_LIBS` are the wheels bundled under `public/pyodide/` (a test keeps the two in sync,
 * so the shelf can never advertise an import the offline runtime cannot satisfy).
 */
import { useEffect, useState } from 'react';
import { DATASETS } from './datasets';

export interface NotebookMeta {
  file: string;
  title: string;
  topic: string;
  /** Section id this notebook belongs to, e.g. "s07". */
  section: string;
  level: string;
  cells: number;
  codeCells: number;
  /** True when at least one cell runs on the bundled numpy/pandas wheels. */
  needsAppRuntime: boolean;
  intro: string;
}

/**
 * Libraries the offline runtime really ships. `test` proves each one against the wheels in
 * `public/pyodide/`, so this list is a promise, not a wish list.
 */
export const NOTEBOOK_LIBS = [
  { id: 'numpy', code: 'import numpy as np', blurb: 'arrays, vector maths, mean/std, broadcasting' },
  { id: 'pandas', code: 'import pandas as pd', blurb: 'DataFrame, read_csv, filter, groupby, join' },
] as const;

/** Snippet that loads both bundled libraries in one cell. */
export const NOTEBOOK_LIBS_SNIPPET = `import numpy as np\nimport pandas as pd\n\nprint("numpy", np.__version__)\nprint("pandas", pd.__version__)\n`;

/** Dataset file names pre-seeded in the offline filesystem — `pd.read_csv('students.csv')` works. */
export const NB_DATASETS = DATASETS.map((d) => ({ name: `${d.name}.csv`, desc: d.desc }));

const listDir = () => (import.meta.env.BASE_URL ?? '/');

let cache: NotebookMeta[] | null = null;
let inflight: Promise<NotebookMeta[]> | null = null;

/** Fetch the manifest once per session (cached across routes and components). */
export function loadNotebooks(): Promise<NotebookMeta[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch(`${listDir()}notebooks/manifest.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : { notebooks: [] }))
    .then((d: { notebooks?: NotebookMeta[] }) => {
      cache = Array.isArray(d.notebooks) ? d.notebooks : [];
      return cache;
    })
    .catch(() => { cache = []; return cache; })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Manifest for React components — `null` while it is still loading. */
export function useNotebooks(): NotebookMeta[] | null {
  const [list, setList] = useState<NotebookMeta[] | null>(cache);
  useEffect(() => {
    let alive = true;
    if (!cache) loadNotebooks().then((n) => { if (alive) setList(n); });
    return () => { alive = false; };
  }, []);
  return list;
}

/**
 * Notebooks worth showing next to a section: the ones authored FOR it first, the rest of the
 * library after that. No fuzzy matching — a wrong suggestion is worse than a short list.
 */
export function notebooksForSection(list: NotebookMeta[], sectionId?: string): { own: NotebookMeta[]; rest: NotebookMeta[] } {
  if (!sectionId) return { own: [], rest: list };
  const own = list.filter((n) => n.section === sectionId);
  const rest = list.filter((n) => n.section !== sectionId);
  return { own, rest };
}

/** How many cells of a notebook the learner has already run (progress is keyed `nb:<file>:<cell>`). */
export function notebookCellsDone(attempts: Record<string, unknown>, file: string): number {
  const prefix = `nb:${file}:`;
  return Object.keys(attempts).filter((k) => k.startsWith(prefix)).length;
}
