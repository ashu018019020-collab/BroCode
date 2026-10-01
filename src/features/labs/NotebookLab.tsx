/**
 * Notebook Lab — the Jupyter notebooks, running offline in the browser.
 *
 * Notebooks are authored in `content/notebooks/*.ipynb` and published to `public/notebooks/` by
 * `npm run notebooks:write`, which executes every cell with the local Python interpreter and
 * stamps the real stdout into the file. So:
 *
 *   · a cell marked "verified" already ran while authoring — its stored output is real stdout;
 *   · a cell marked "expected error" deliberately raises, and the stored traceback is real;
 *   · an "app runtime" cell uses the bundled numpy/pandas wheels and runs HERE, in the offline
 *     Pyodide runtime (the app seeds the bundled CSVs, so read_csv works too).
 *
 * The cells themselves are rendered by the shared notebook engine (`NotebookCells`), the same
 * one used inside every lesson stage and in the Learning Path — one engine, one behaviour, one
 * place to fix a bug. Each notebook gets its OWN kernel session, so `df` from one notebook can
 * never appear in another, while every cell of a notebook keeps sharing names and imports.
 *
 * `/notebooks?nb=<file>` deep-links straight to a notebook, which is how lessons and the
 * Learning Path hand a learner over from "practice here" to "open the full notebook".
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, ChevronLeft, FileCode2 } from 'lucide-react';
import { Chip } from '../../components/ui/ui';
import { NotebookCells, type NbCellSpec } from '../../components/code/NotebookCells';
import { isPythonReady, warmupPython } from '../coding/runners';
import { useStore } from '../../core/storage/store';
import { useNotebooks } from '../../core/data/notebooks';
import { notebookCellsRunFor } from '../../core/learning/coverage';

/** `public/notebooks/<file>` (nbformat 4) → the engine's cell specs. */
function toSpecs(nb: any): NbCellSpec[] {
  return (nb?.cells ?? []).map((c: any, i: number): NbCellSpec => {
    const meta = c.metadata ?? {};
    return {
      id: String(c.id ?? `cell${i}`),
      kind: c.cell_type === 'markdown' ? 'md' : 'code',
      source: Array.isArray(c.source) ? c.source.join('') : String(c.source ?? ''),
      expectError: !!meta.expectError,
      appOnly: !!meta.appOnly,
      verified: !!meta.verified,
      error: typeof meta.error === 'string' ? meta.error : undefined,
      outputs: c.outputs,
      executionCount: c.execution_count,
    };
  });
}

export default function NotebookLab() {
  const manifest = useNotebooks();
  const state = useStore();
  const [params, setParams] = useSearchParams();
  const [active, setActive] = useState<string | null>(null);
  const [nb, setNb] = useState<{ file: string; cells: NbCellSpec[] } | null>(null);
  const [failed, setFailed] = useState(false);

  // Deep link first, then the first published notebook.
  useEffect(() => {
    if (!manifest?.length || active) return;
    const wanted = params.get('nb');
    const found = wanted && manifest.some((m) => m.file === wanted) ? wanted : manifest[0].file;
    setActive(found);
  }, [manifest, params, active]);

  useEffect(() => { warmupPython().catch(() => { /* the header chip explains the state */ }); }, []);

  useEffect(() => {
    if (!active) return;
    setNb(null);
    setFailed(false);
    const url = `${import.meta.env.BASE_URL ?? '/'}notebooks/${active}`;
    fetch(url, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setNb({ file: active, cells: toSpecs(d) }))
      .catch(() => setFailed(true));
  }, [active]);

  const pick = (file: string) => {
    setActive(file);
    setParams(file ? { nb: file } : {}, { replace: true });
  };

  const codeCells = useMemo(() => (nb?.cells ?? []).filter((c) => c.kind === 'code'), [nb]);
  const doneCount = active ? notebookCellsRunFor(state.attempts, active) : 0;
  const pct = codeCells.length ? Math.min(100, Math.round((doneCount / codeCells.length) * 100)) : 0;

  if (!manifest) return <div className="loading">Loading notebooks…</div>;
  if (!manifest.length) {
    return <div className="card muted">Koi notebook publish nahi hua — <code>npm run notebooks:write</code> chalao.</div>;
  }

  const meta = manifest.find((m) => m.file === active);
  // The neighbouring notebooks in library order, so "agla notebook" walks the same list the sidebar
  // shows. No wrap-around: at the ends the button is simply absent.
  const activeIdx = manifest.findIndex((m) => m.file === active);
  const step = (d: -1 | 1) => {
    const m = activeIdx < 0 ? undefined : manifest[activeIdx + d];
    return m ? { label: m.title.split('—')[0].trim(), run: () => pick(m.file) } : null;
  };

  return (
    <div className="nb-page">
      <div className="card">
        <div className="row spread">
          <div>
            <h2 style={{ margin: 0 }}><BookOpen size={18} /> Notebook Lab</h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Jupyter notebooks jo poori tarah isi app me chalte hain. Author time par har cell execute hua hai;
              &quot;app runtime&quot; wale cells yahin NumPy/Pandas ke bundled wheels se chalte hain.
            </p>
          </div>
          <span className="row">
            <Chip kind={isPythonReady() ? 'easy' : 'medium'}>{isPythonReady() ? '✓ Python ready' : 'Python booting…'}</Chip>
            <Chip kind="interview">{manifest.length} notebooks</Chip>
          </span>
        </div>
      </div>

      <div className="nb-layout">
        <aside className="nb-listcard card">
          {manifest.map((m) => {
            const done = notebookCellsRunFor(state.attempts, m.file);
            return (
              <button key={m.file} className={`nb-pick${m.file === active ? ' active' : ''}`} onClick={() => pick(m.file)}>
                <strong>{m.title}</strong>
                <span className="small muted">{m.topic} · {m.codeCells} code cells{m.needsAppRuntime ? ' · numpy/pandas' : ''}</span>
                <span className="small muted">
                  <FileCode2 size={11} style={{ verticalAlign: -1 }} /> {done}/{m.codeCells} cells run
                </span>
              </button>
            );
          })}
        </aside>

        <main className="nb-main">
          {failed && <div className="card" style={{ color: 'var(--red)' }}>Notebook load nahi hua — `public/notebooks/{active}` check karo.</div>}
          {!nb && !failed && <div className="card muted">Notebook load ho raha hai…</div>}
          {nb && (
            <>
              <div className="card">
                <div className="row spread">
                  <div>
                    <h3 style={{ margin: 0 }}>{meta?.title}</h3>
                    <p className="small muted" style={{ margin: '4px 0 0' }}>{meta?.intro}</p>
                  </div>
                  <span className="row">
                    <Chip kind="easy">{doneCount}/{codeCells.length} cells</Chip>
                    <span className="nb-pct">{pct}%</span>
                  </span>
                </div>
                <div className="bar" style={{ marginTop: 8 }}><div style={{ width: `${pct}%` }} /></div>
              </div>

              {/* One notebook = one kernel session: import in cell 1, use it in cell 9. */}
              <NotebookCells
                cells={nb.cells}
                slug={nb.file}
                showKernel
                stdin
                where={meta?.title ?? nb.file}
                nav={{ prev: step(-1), next: step(1) }}
              />
            </>
          )}
        </main>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn ghost" onClick={() => pick(manifest[0].file)}><ChevronLeft size={14} /> Pehla notebook</button>
        <span className="small muted">Notebooks `content/notebooks` me edit hote hain, phir `npm run notebooks:write` se publish.</span>
      </div>
    </div>
  );
}
