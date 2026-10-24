/**
 * Export the notebook the learner is looking at as a real `.ipynb`.
 *
 * A notebook a learner cannot take with them is a demo, not a notebook: the whole point of the
 * Jupyter surface is that the file outlives the browser tab, opens in real Jupyter, and keeps the
 * work that was actually done. So this builds the genuine nbformat 4 document — the same shape the
 * bundled notebooks already use — from the CURRENT state of the page: the code the learner edited
 * plus the outputs their runs really produced.
 *
 * Two rules keep the export honest:
 *
 *   · a cell that was never run is exported with `execution_count: null` and no outputs, rather
 *     than a fabricated result — the file shows what happened, not what should have happened;
 *   · an error run is exported as a real `output_type: "error"` cell (ename/evalue/traceback),
 *     because a notebook full of clean outputs would misrepresent the session.
 *
 * Pure functions only: no DOM, no storage, no Date. The download trigger lives in the component;
 * everything that decides WHAT lands in the file lives here, so `npm test` can lock it down.
 */

export interface IpynbSourceCell {
  kind: 'md' | 'code';
  /** The source as the learner sees it right now (edits applied), not the authored original. */
  source: string;
  /** The live result of this cell's last run in this session, if it was run at all. */
  run?: { ok: boolean; output: string; error?: string };
  /** The kernel's execution counter for this cell (In [n]); null/absent when never run. */
  executionCount?: number | null;
}

export type IpynbOutput =
  | { output_type: 'stream'; name: 'stdout' | 'stderr'; text: string[] }
  | { output_type: 'error'; ename: string; evalue: string; traceback: string[] }
  | { output_type: 'execute_result'; execution_count: number | null; data: { 'text/plain': string[] }; metadata: Record<string, never> };

export interface IpynbDocument {
  cells: (
    | { cell_type: 'markdown'; metadata: Record<string, never>; source: string[] }
    | { cell_type: 'code'; execution_count: number | null; metadata: Record<string, never>; outputs: IpynbOutput[]; source: string[] }
  )[];
  metadata: {
    kernelspec: { display_name: string; language: string; name: string };
    language_info: { name: string; version: string };
  };
  nbformat: number;
  nbformat_minor: number;
}

/**
 * nbformat stores a cell's source as a list of lines that each keep their trailing newline. Split
 * that way (rather than on '\n') so a file that round-trips loses nothing — not a blank line, not
 * the final newline.
 */
export function toLines(text: string): string[] {
  if (!text) return [];
  return text.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

/** `ZeroDivisionError: division by zero` → the two fields nbformat wants. */
function splitError(err: string): { ename: string; evalue: string } {
  const line = err.trim().split('\n').filter((l) => l.trim()).pop() ?? 'Error';
  const m = line.match(/^([A-Za-z_][\w.]*(?:Error|Exception|Warning|Exit|Interrupt|KeyboardInterrupt|StopIteration))\s*:?\s*(.*)$/);
  if (m) return { ename: m[1], evalue: m[2] ?? '' };
  return { ename: 'Error', evalue: line };
}

/** The nbformat outputs for a cell, from the run that actually happened. */
export function outputsFor(cell: IpynbSourceCell, executionCount: number | null = null): IpynbOutput[] {
  if (!cell.run) return [];
  if (!cell.run.ok) {
    const err = (cell.run.error || cell.run.output || 'Error').trim();
    const { ename, evalue } = splitError(err);
    return [{ output_type: 'error', ename, evalue, traceback: err.split('\n') }];
  }
  const out = cell.run.output ?? '';
  if (!out.trim()) return [];
  return [{ output_type: 'stream', name: 'stdout', text: toLines(out) }];
}

/** Build the whole document. `version` is the Python the app really runs (Pyodide), not a guess. */
export function buildIpynb(cells: IpynbSourceCell[], version = '3.12'): IpynbDocument {
  return {
    cells: cells.map((c) =>
      c.kind === 'md'
        ? { cell_type: 'markdown' as const, metadata: {}, source: toLines(c.source) }
        : {
            cell_type: 'code' as const,
            execution_count: c.run ? (c.executionCount ?? null) : null,
            metadata: {},
            outputs: outputsFor(c, c.executionCount ?? null),
            source: toLines(c.source),
          },
    ),
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python', version },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

/**
 * A safe download name for any slug the app uses. Lesson cells pass keys like
 * `nbc:s01:coding:3`, which must never reach the filesystem as-is — Jupyter would refuse the file
 * and Windows would reject the colons outright.
 */
export function ipynbFileName(slug: string): string {
  const base = (slug || 'notebook').replace(/^.*[\\/]/, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'notebook';
  if (base.toLowerCase().endsWith('.ipynb')) return base;
  return `${base.replace(/\.$/, '')}.ipynb`;
}
