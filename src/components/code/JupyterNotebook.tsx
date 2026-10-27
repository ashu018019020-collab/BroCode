/**
 * JupyterNotebook — the notebook panel that replaced the old code editor.
 *
 * Every lesson stage, the authored 16-part workspace, the NumPy/Pandas lab and the final
 * assessment used to render `CodeLab`: one textarea, a Run button and an output box. They now
 * render this: a small notebook (a markdown cell with the task, a task code cell, then whatever
 * extra cells the surface needs) built on the shared notebook engine, so the learner gets the
 * same Jupyter behaviour everywhere — cells sharing one session, real stdout, live kernel
 * variables, the explain-this-error tab, and one-click library cells for the bundled
 * numpy/pandas.
 *
 * It also carries the Notebook Lab along: the shelf at the bottom of the panel lists the
 * published notebooks, and a notebook authored for the current section sits right there, ready
 * to open and run without leaving the lesson.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronRight, ExternalLink, Loader } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Chip } from '../ui/ui';
import { AssistantCard } from '../shared/AssistantCard';
import { NotebookCells, type NbCellSpec } from './NotebookCells';
import { notebooksForSection, useNotebooks, type NotebookMeta } from '../../core/data/notebooks';
import { notebookCellsRunFor } from '../../core/learning/coverage';
import { useStore } from '../../core/storage/store';

/** `public/notebooks/<file>` → notebook cells the engine can render. */
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

const baseDir = () => (import.meta.env.BASE_URL ?? '/');

/* --------------------------- published notebooks --------------------------- */
/**
 * The Notebook Lab, inline. Shows the notebooks relevant to this section first, opens the
 * chosen one right here (its own kernel session, its own saved cells) and links to the full
 * Notebook Lab page for the whole library.
 */
export function NotebookShelf({ sectionId, compact, defaultOpen = false, boxes = false }: { sectionId?: string; compact?: boolean; defaultOpen?: boolean; boxes?: boolean }) {
  const list = useNotebooks();
  const state = useStore();
  const { own, rest } = notebooksForSection(list ?? [], sectionId);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [nb, setNb] = useState<{ file: string; cells: NbCellSpec[] } | null>(null);
  const [err, setErr] = useState(false);
  /**
   * Collapsed to one line until asked for.
   *
   * The shelf renders under every notebook, and a lesson page can hold a dozen notebooks — so an
   * expanded library list there is pure scroll in front of content the learner was not looking
   * for. `defaultOpen` is for the one surface where the shelf IS the content (the Learning Path).
   */
  const [open, setOpen] = useState(defaultOpen);

  const openNotebook = useCallback(async (m: NotebookMeta) => {
    setOpenFile(m.file);
    setNb(null);
    setErr(false);
    try {
      const r = await fetch(`${baseDir()}notebooks/${m.file}`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(String(r.status));
      setNb({ file: m.file, cells: toSpecs(await r.json()) });
    } catch {
      setErr(true);
    }
  }, []);

  if (!list) return null;
  if (!list.length) {
    return (
      <p className="small muted" style={{ margin: '8px 0 0' }}>
        No published notebooks found — run <code>npm run notebooks:write</code>.
      </p>
    );
  }

  const activeMeta = list.find((m) => m.file === openFile);
  /**
   * The neighbouring notebooks, in the order the shelf itself lists them (this section's first).
   * Deliberately not wrapped: at the last notebook there is no "next" button, rather than one that
   * jumps back to the start and looks like a mistake.
   */
  const ordered = [...own, ...rest];
  const openIdx = ordered.findIndex((m) => m.file === openFile);
  const step = (d: -1 | 1) => {
    const m = openIdx < 0 ? undefined : ordered[openIdx + d];
    if (!m) return null;
    return { label: m.title.split('—')[0].trim(), run: () => void openNotebook(m) };
  };
  const pick = (m: NotebookMeta) => {
    const done = notebookCellsRunFor(state.attempts, m.file);
    return (
      <button key={m.file} className={`nb-pick small${m.file === openFile ? ' active' : ''}`} onClick={() => void openNotebook(m)}>
        <strong>{m.title}</strong>
        <span className="small muted">
          {m.topic} · {m.codeCells} code cells{m.needsAppRuntime ? ' · numpy/pandas' : ''}
          {done ? ` · ${done} run ✓` : ''}
        </span>
      </button>
    );
  };

  /**
   * The same list, as boxes.
   *
   * On the Learning Path a notebook is a peer of the track steps above it, so it is drawn in the
   * same box language (edge light, tone wash, lit icon well) and carries the two facts a learner
   * actually picks with: how big it is, and how much of it they have already run. The tones only
   * cycle here — a notebook has no family to belong to — and `compact` does not apply: a grid of
   * `compact ? 3 : …` boxes would hide the library from the one surface that asked to see it.
   */
  const BOX_TONES = ['cyan', 'violet', 'amber', 'green'];
  const pickBox = (m: NotebookMeta, i: number) => {
    const done = notebookCellsRunFor(state.attempts, m.file);
    return (
      <button
        key={m.file}
        className={`nb-box tone-${BOX_TONES[i % BOX_TONES.length]}${m.file === openFile ? ' on' : ''}`}
        onClick={() => void openNotebook(m)}
      >
        <span className="nb-box-ic"><BookOpen size={15} /></span>
        <b>{m.title}</b>
        <span className="nb-box-sub">{m.topic}</span>
        <span className="nb-box-facts">
          <span className="chip">{m.codeCells} code cells</span>
          {m.needsAppRuntime && <span className="chip">numpy/pandas</span>}
          {done ? <span className="chip easy">{done} run ✓</span> : null}
        </span>
      </button>
    );
  };

  return (
    <div className="jup-shelf-wrap" style={{ marginTop: 10 }}>
      <div className="row spread">
        <button
          className="jup-shelf-head small muted"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={open ? 'Collapse the notebook list' : 'Expand the notebook list'}
        >
          <ChevronRight size={13} className={`shelf-caret${open ? ' open' : ''}`} />
          <BookOpen size={13} />
          {/* The shelf's own name is a separate node from what it reports, because they do not have
              the same value on a phone: the count and the scope are what the learner picks with, and
              the name is repeated by every notebook card above. Below ~460px of CARD (a container
              query, not a viewport one — the lesson column is narrow on a wide window too) the name
              is dropped and the rest is allowed a second line. */}
          <span className="shelf-label"><span className="shelf-brand">Notebook Lab — </span>{own.length ? 'for this section' : 'the full library'} ({list.length} notebooks)</span>
          {!open && <span className="shelf-hint">{openFile ? 'notebook is open' : 'click to open'}</span>}
        </button>
        <span className="row">
          {open && openFile && <button className="btn small" onClick={() => { setOpenFile(null); setNb(null); }}>Close notebook</button>}
          <Link className="btn small" to={openFile ? `/notebooks?nb=${encodeURIComponent(openFile)}` : '/notebooks'}>
            Open Notebook Lab <ExternalLink size={12} />
          </Link>
        </span>
      </div>

      {/* Hidden, not unmounted: collapsing the shelf must not throw away the runs of a notebook
          that is already open, and a `display:none` body costs no scroll height. */}
      <div className={open ? undefined : 'hidden'}>
        {!openFile && (boxes ? (
          <div className="nb-boxes">{[...own, ...rest].map(pickBox)}</div>
        ) : (
          <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
            {own.map(pick)}
            {own.length > 0 && rest.length > 0 && <span className="small muted" style={{ alignSelf: 'center' }}>· more:</span>}
            {rest.slice(0, compact ? 3 : rest.length).map(pick)}
          </div>
        ))}

        {openFile && (
          <div className="fadeup" style={{ marginTop: 8 }}>
            <div className="row spread">
              <span className="row">
                <b className="small">{activeMeta?.title ?? openFile}</b>
                {activeMeta?.needsAppRuntime && <Chip kind="medium">numpy/pandas bundled</Chip>}
              </span>
              <span className="small muted">{activeMeta?.intro}</span>
            </div>
            {err && <p className="small" style={{ color: 'var(--red)' }}>Notebook failed to load — is the file in `public/notebooks/`?</p>}
            {!nb && !err && <p className="small muted"><Loader size={12} /> Loading notebook…</p>}
            {nb && (
              <NotebookCells
                cells={nb.cells}
                slug={nb.file}
                compact
                showKernel
                stdin
                sectionId={sectionId}
                where={activeMeta?.title ?? nb.file}
                nav={{ prev: step(-1), next: step(1) }}
              />
            )}
            <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
              <span className="small muted">Another notebook:</span>
              {list.filter((m) => m.file !== openFile).map((m) => (
                <button key={m.file} className="btn small" onClick={() => void openNotebook(m)}>{m.title.split('—')[0].trim()}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- the panel -------------------------------- */
interface Props {
  /** Namespace for saved cells, run records and the kernel session. */
  storageKey: string;
  starter?: string;
  /** Kept for call-site compatibility; notebooks run Python (the only in-browser runtime here). */
  lang?: 'python' | 'js';
  solution?: string;
  onComplete?: () => void;
  compact?: boolean;
  /** Markdown heading for the notebook's first cell. */
  title?: string;
  /** Task text (markdown) shown above the task cell. */
  taskText?: string;
  /** Small badge on the task cell, e.g. the difficulty. */
  label?: string;
  /** Markdown note cells after the task cell (checks, format reminders). */
  notes?: string;
  /** Section id — decides which published notebooks are suggested. */
  sectionId?: string;
  /** Hide the "open a published notebook here" shelf. */
  hideShelf?: boolean;
}

/**
 * The assistant's context strip is a label, not a paragraph.
 * Task titles on the idea/practice labs are whole prompts, so without this the strip renders a
 * sentence next to the 📍 pin and wraps to three lines inside a one-line affordance.
 */
const asLabel = (t?: string) => (t && t.length > 46 ? `${t.slice(0, 46).trimEnd()}…` : t);

export function JupyterNotebook({
  storageKey, starter, solution, onComplete, compact, title, taskText, label, notes, sectionId, hideShelf,
}: Props) {
  const [showSol, setShowSol] = useState(false);
  const [prefill, setPrefill] = useState({ code: '', nonce: 0 });
  /**
   * The traceback this notebook's cells really raised, lifted out of `NotebookCells`.
   *
   * The assistant lives at the END of the card — below the notebook and below the Notebook Lab
   * shelf — so the error has to travel up here for it to still answer the failure on screen
   * instead of offering generic advice. Cleared on a new task, like the cells themselves.
   */
  const [cellError, setCellError] = useState<{ code: string; error: string } | null>(null);

  // A new task means a new notebook: fresh cells, fresh kernel, no leftovers.
  useEffect(() => { setShowSol(false); setPrefill({ code: '', nonce: 0 }); setCellError(null); }, [storageKey]);

  const where = [sectionId, asLabel(title)].filter(Boolean).join(' · ') || undefined;

  const cells = useMemo<NbCellSpec[]>(() => {
    const list: NbCellSpec[] = [];
    const md = [title ? `### ${title}` : '', taskText ?? ''].filter(Boolean).join('\n\n');
    if (md) list.push({ id: 'md-task', kind: 'md', source: md });
    list.push({
      id: 'task',
      kind: 'code',
      source: starter ?? '# Write your code here\nprint("Hello World")\n',
      primary: true,
      label,
    });
    if (notes) list.push({ id: 'md-notes', kind: 'md', source: notes });
    return list;
  }, [title, taskText, starter, label, notes]);

  return (
    <div className="card jup-wrap">
      <div className="row spread" style={{ marginBottom: 8 }}>
        <span className="row">
          <b className="small">📓 JUPYTER NOTEBOOK</b>
          <Chip kind="easy">cells run in the same session</Chip>
        </span>
        {solution && (
          <button className="btn small" onClick={() => setShowSol((v) => !v)}>
            {showSol ? '🙈 Hide solution' : '👁 Show solution'}
          </button>
        )}
      </div>

      <NotebookCells
        cells={cells}
        slug={storageKey}
        compact={compact}
        stdin
        showKernel={!compact}
        sectionId={sectionId}
        where={where}
        prefill={{ cellId: 'task', code: prefill.code, nonce: prefill.nonce }}
        onCellRun={(cell) => { if (cell.primary) onComplete?.(); }}
        assistant={false}
        onError={setCellError}
      />

      {solution && showSol && (
        <div className="fadeup" style={{ marginTop: 8 }}>
          <div className="small muted">SOLUTION</div>
          <pre className="codeblock"><code>{solution}</code></pre>
          <button
            className="btn small"
            onClick={() => setPrefill((p) => ({ code: solution, nonce: p.nonce + 1 }))}
          >
            Load solution into the cell
          </button>
        </div>
      )}

      {!hideShelf && <NotebookShelf sectionId={sectionId} compact={compact} />}

      {/* Last thing in the card, under the shelf: "while coding" is where help belongs, and the
          shelf above it is only ever one collapsed line unless the learner opens it. */}
      <AssistantCard embedded context={{ sectionId, where, code: cellError?.code, error: cellError?.error }} />
    </div>
  );
}
