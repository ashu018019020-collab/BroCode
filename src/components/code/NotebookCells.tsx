/**
 * Notebook engine — the one Jupyter-like surface for the whole app.
 *
 * The old single-code-box editor is gone; this replaced it. Everything that used to be
 * "a textarea plus a Run button" now renders a notebook: markdown cells holding the task,
 * code cells that all share ONE interpreter session, real stdout, real millisecond timings,
 * Jupyter-style `In [n] / Out [n]` numbering, and a live view of the kernel's variables.
 *
 * What makes it more than a nicer textarea:
 *   · every code cell of a notebook runs in the SAME kernel session (import once in cell 1,
 *     use it in cell 9) while a different notebook gets its own isolated namespace, so nothing
 *     leaks across sections;
 *   · Run all executes the notebook top to bottom and stops at the first raise, like Jupyter;
 *   · a failing cell auto-opens an Errors tab with the structured traceback, and an
 *     "AI Explanation" tab built from the local tutor engine (what happened, why, how to
 *     debug, then a progressive hint ladder) that can file the mistake in the tracker;
 *   · the kernel-variable panel lists the names the session really has, so `df` disappearing is
 *     visible instead of mysterious;
 *   · the library shelf offers only what the bundled runtime truly ships (numpy + pandas free
 *     of installation) and inserts a ready-made cell, so a library lesson starts in one click.
 *
 * Persistence is per cell: edited source lands in `state.savedCode[codeSlot.notebook(slug, id)]`
 * and the run record in `state.attempts[notebookCell(slug, id)]`, using the app's key module.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Copy, Download, Loader, Package, Play, Plus, RotateCcw, Save, Square, Trash2 } from 'lucide-react';
import { Chip } from '../ui/ui';
import { explainError, isPythonReady, kernelVars, resetKernel, runPython, stopPython, warmupPython } from '../../features/coding/runners';
import { addMistake, addXp, recordAttempt, setState, stateSnapshot, useStore } from '../../core/storage/store';
import { codeSlot, notebookCell } from '../../core/platform/keys';
import { debugSteps, explainTraceback, hintLadder, mistakeFromDiagnostic } from '../../core/ai/tutor';
import { NB_DATASETS, NOTEBOOK_LIBS, NOTEBOOK_LIBS_SNIPPET } from '../../core/data/notebooks';
import { buildIpynb, ipynbFileName } from '../../core/platform/ipynb';
import { attemptPct, notebookAccuracy, pctText } from '../../core/assessment/accuracy';
import { AssistantCard } from '../shared/AssistantCard';

/**
 * One notebook-step the caller can offer: the neighbouring notebook in ITS list.
 *
 * The notebook engine cannot know this on its own — a lesson task notebook has no siblings, while
 * the Notebook Lab and the in-lesson shelf do — so the surface that owns the list passes the step
 * in. That is what puts a real "next notebook" under every notebook that has one.
 */
export interface NbStep { label: string; run: () => void }
export interface NbNav { prev?: NbStep | null; next?: NbStep | null }

/** One cell of a notebook, whatever surface it came from (published file or a lesson task). */
export interface NbCellSpec {
  id: string;
  kind: 'md' | 'code';
  source: string;
  /** Short badge text, e.g. the coding task's difficulty. */
  label?: string;
  /** The cell the lesson task is about: its first clean run completes the task. */
  primary?: boolean;
  /** Teaching cell that is SUPPOSED to raise (the published notebook proves it does). */
  expectError?: boolean;
  /** Needs the bundled numpy/pandas wheels — runs here, in the app runtime. */
  appOnly?: boolean;
  /** Verified while authoring: the stored output below is real stdout. */
  verified?: boolean;
  /** Error kind for an expected-error cell. */
  error?: string;
  /** Stored nbformat outputs (markdown/stream/error), shown until the learner runs the cell. */
  outputs?: any[];
  executionCount?: number | null;
  /** Local Python line the cell was verified on — read-only display for lesson cells. */
  readOnlySource?: boolean;
}

export interface CellRun { ok: boolean; output: string; error?: string; ms: number }

/* ------------------------- markdown (dependency-free) ------------------------ */
/** Renders the subset of markdown the notebooks use — no dependency, no raw HTML. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith('`') && p.endsWith('`')) return <code key={i} className="nb-inline">{p.slice(1, -1)}</code>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

export function Markdown({ src }: { src: string }) {
  const lines = src.split('\n');
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    const items = list;
    list = [];
    out.push(
      <ul className="nb-list" key={`ul${out.length}`}>
        {items.map((li, i) => <li key={i}><Inline text={li} /></li>)}
      </ul>,
    );
  };
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (bullet) { list.push(bullet[1]); return; }
    flush();
    if (!line.trim()) return;
    if (line.startsWith('### ')) out.push(<h4 key={i}><Inline text={line.slice(4)} /></h4>);
    else if (line.startsWith('## ')) out.push(<h3 key={i}><Inline text={line.slice(3)} /></h3>);
    else if (line.startsWith('# ')) out.push(<h2 key={i}><Inline text={line.slice(2)} /></h2>);
    else out.push(<p key={i}><Inline text={line} /></p>);
  });
  flush();
  return <div className="nb-md">{out}</div>;
}

/* --------------------------------- badges --------------------------------- */
function badgeFor(cell: NbCellSpec): { kind: string; text: string } | null {
  if (cell.expectError) return { kind: 'hard', text: `expected error · ${cell.error ?? 'raises'}` };
  if (cell.appOnly) return { kind: 'medium', text: 'app runtime (numpy/pandas)' };
  if (cell.verified) return { kind: 'easy', text: 'verified while authoring' };
  if (cell.primary) return { kind: 'interview', text: 'task' };
  return null;
}

/** A published cell's stored output, shaped like a live run so one pane renders both. */
function storedOutcome(cell: NbCellSpec): CellRun | null {
  const outputs = cell.outputs ?? [];
  const streams = outputs
    .filter((o) => o?.output_type === 'stream')
    .map((o) => (Array.isArray(o.text) ? o.text.join('') : String(o.text ?? '')));
  const errs = outputs
    .filter((o) => o?.output_type === 'error')
    .map((o) => `${o.ename ?? 'Error'}: ${o.evalue ?? ''}`.trim());
  if (!streams.length && !errs.length && !cell.error) return null;
  return { ok: !errs.length && !cell.error, output: streams.join('\n'), error: cell.error ?? (errs.length ? errs.join('\n') : undefined), ms: 0 };
}

/* ------------------------------ one code cell ------------------------------ */
interface CodeCellProps {
  cell: NbCellSpec;
  value: string;
  run?: CellRun;
  execCount?: number;
  /** Position in the notebook — `Shift+Enter` moves focus to the next cell by index. */
  cellIndex: number;
  busy: boolean;
  locked: boolean;
  /** The last run's recorded percentage (100 pass / 0 raise), or null when never run. */
  score?: number | null;
  onChange: (v: string) => void;
  onRun: () => void;
  onReset: () => void;
  onSave: () => void;
}

/**
 * Jupyter muscle memory: Shift+Enter runs the cell and moves on to the next one.
 *
 * It walks the rendered code cells in document order instead of assuming the next index is
 * `index + 1`: markdown blocks sit between code cells and carry no index, so a plain `+1`
 * lookup would silently drop focus whenever a prose cell followed. The last cell simply
 * stays focused (nothing to move to) — no jump to the browser chrome mid-thought.
 */
function focusNextCell(index: number, from?: HTMLElement | null) {
  // Scoped to the notebook the caret is already in. A page can hold many notebooks at once (the
  // 16-part workspace renders one per part, and collapsed parts stay mounted), so a document-wide
  // lookup would hand focus to a cell in a different — possibly hidden — notebook.
  const root: ParentNode = from?.closest('.jup') ?? document;
  const cells = Array.from(root.querySelectorAll<HTMLTextAreaElement>('[data-cell-index]'));
  const next = cells.find((el) => Number(el.dataset.cellIndex) > index);
  if (!next) return;
  next.focus();
  next.scrollIntoView({ block: 'nearest' });
}

function CodeCell({ cell, value, run, execCount, cellIndex, busy, locked, score, onChange, onRun, onReset, onSave }: CodeCellProps) {
  const [tab, setTab] = useState<'out' | 'err' | 'why'>('out');
  const [hint, setHint] = useState(1);
  const shown = run ?? storedOutcome(cell);

  // A raise should land the learner on the error, not on an empty output pane.
  useEffect(() => { if (run) { setTab(run.ok ? 'out' : 'err'); setHint(1); } }, [run]);

  const expl = !run?.ok && run?.error ? explainTraceback(run.error) : null;
  const simple = !run?.ok && run?.error && !expl ? explainError(run.error) : null;
  const badge = badgeFor(cell);
  const lines = Math.min(24, Math.max(3, value.split('\n').length));

  const type = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onRun(); return; }
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); onRun(); focusNextCell(cellIndex, e.currentTarget); return; }
    if (e.key === 'Tab') {                                   // Tab = 4 spaces, never leave the cell
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: en } = el;
      onChange(`${value.slice(0, s)}    ${value.slice(en)}`);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 4; });
    }
  };

  return (
    <div className={`card nb-cell jup-cell${cell.primary ? ' jup-primary' : ''}`}>
      <div className="row spread">
        <span className="row">
          <span className="nb-label">In [{execCount ?? cell.executionCount ?? ' '}]</span>
          {badge && <Chip kind={badge.kind}>{badge.text}</Chip>}
          {/* The cell's own percentage: the stored run score, so the pass rate is visible on
              the cell itself and not only in the toolbar total. */}
          {typeof score === 'number' && <Chip kind={score >= 100 ? 'easy' : 'hard'}>{score}%</Chip>}
          {cell.label && <span className="small muted">{cell.label}</span>}
        </span>
        <span className="row">
          <button className="btn small" onClick={onRun} disabled={busy || locked} aria-label="Run this cell" title="Ctrl+↵ to run · Shift+↵ to run and move to the next cell">
            {busy ? <Loader size={12} /> : <Play size={12} />} Run
          </button>
          <button className="btn small" onClick={onReset} title="Restore the cell to its original code"><RotateCcw size={12} /> Reset</button>
          <button className="btn small" onClick={() => void navigator.clipboard?.writeText(value).catch(() => {})}><Copy size={12} /> Copy</button>
          <button className="btn small" onClick={onSave}><Save size={12} /> Save</button>
        </span>
      </div>

      <textarea
        className="nb-editor"
        spellCheck={false}
        value={value}
        rows={lines}
        data-cell-index={cellIndex}
        aria-label={cell.label ? `Code cell — ${cell.label}` : 'Code cell'}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={type}
      />

      {shown ? (
        <div className="nb-out">
          <div className="row resulttabs" style={{ marginBottom: 6 }}>
            <span className="nb-label">Out [{shown.ms ? `${shown.ms} ms` : 'stored'}]</span>
            <button className={`tabbtn ${tab === 'out' ? 'active' : ''}`} onClick={() => setTab('out')}>
              Output {shown.ok ? '✓' : ''}
            </button>
            {!shown.ok && (
              <button className={`tabbtn ${tab === 'err' ? 'active' : ''} haserr`} onClick={() => setTab('err')}>
                Errors ●
              </button>
            )}
            {!shown.ok && (
              <button className={`tabbtn ${tab === 'why' ? 'active' : ''}`} onClick={() => setTab('why')}>
                AI Explanation
              </button>
            )}
          </div>

          {tab === 'out' && (
            <pre className="codeblock" style={{ maxHeight: 280 }}>
              <code className={shown.ok ? 'out' : ''}>{shown.output || '(no output)'}</code>
            </pre>
          )}

          {tab === 'err' && !shown.ok && (
            <pre className="codeblock" style={{ maxHeight: 220 }}><code className="out">{shown.error ?? shown.output}</code></pre>
          )}

          {tab === 'why' && !shown.ok && (
            <ExplainPane expl={expl} simple={simple} err={shown.error ?? ''} code={value} slug={cell.id} hint={hint} onHint={() => setHint((h) => h + 1)} hasInput={false} />
          )}
        </div>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>Not run yet — press ▶ Run (or Ctrl+↵).</p>
      )}
    </div>
  );
}

/* ---------------------------- the explanation tab --------------------------- */
function ExplainPane({
  expl, simple, err, code, slug, hint, onHint, hasInput,
}: {
  expl: ReturnType<typeof explainTraceback>;
  simple: ReturnType<typeof explainError>;
  err: string;
  code: string;
  slug: string;
  hint: number;
  onHint: () => void;
  hasInput: boolean;
}) {
  const steps = debugSteps(expl, hasInput);
  const hints = hintLadder(expl, hint, hasInput);
  if (!expl && !simple) {
    return <div className="card small muted">The tutor has no pattern for this error — read the last line of the traceback.</div>;
  }
  return (
    <div className="card jup-explain">
      <b className="small">WHAT HAPPENED:</b>{' '}
      <span className="small">{expl?.what ?? simple?.what}</span>
      <br />
      <b className="small">LIKELY CAUSE:</b>{' '}
      <span className="small">{expl?.cause ?? simple?.cause}</span>
      <br />
      <b className="small">HOW TO DEBUG:</b>{' '}
      <span className="small">{expl?.fix ?? simple?.debug}</span>

      {steps.length > 0 && (
        <>
          <div className="small muted" style={{ marginTop: 8 }}>DEBUG STEPS</div>
          <ol className="pack-list small">{steps.slice(0, hint + 2).map((s, i) => <li key={i}>{s}</li>)}</ol>
        </>
      )}

      <div className="row" style={{ marginTop: 8 }}>
        {hints.length > 0 && <button className="btn small" onClick={onHint}>💡 New hint ({hint})</button>}
        {expl && (
          <button
            className="btn small"
            onClick={() => addMistake(mistakeFromDiagnostic(expl, code, err, slug))}
          >
            Save to Mistake Tracker
          </button>
        )}
        {expl?.example && <span className="small muted">Example: {expl.example.split('\n')[0]}</span>}
      </div>
    </div>
  );
}

/* ------------------------------ library shelf ------------------------------ */
/**
 * What the bundled runtime really has, offered as one-click cells. The list is verified against
 * the wheels in `public/pyodide/` by a test, so it can never advertise an uninstallable import.
 */
export function LibraryShelf({ onInsert, open: openProp }: { onInsert?: (code: string, label: string) => void; open?: boolean }) {
  const [open, setOpen] = useState(!!openProp);
  const insert = (code: string, label: string) => {
    if (onInsert) onInsert(code, label);
    else void navigator.clipboard?.writeText(code).catch(() => {});
  };
  return (
    <div className="jup-shelf">
      <div className="row spread">
        <span className="row small muted">
          <Package size={13} /> Bundled libraries: {NOTEBOOK_LIBS.map((l) => l.id).join(' · ')} + Python stdlib
        </span>
        <span className="row">
          <span className="small muted">{NB_DATASETS.length} bundled datasets</span>
          <button className="btn small" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Hide library cells' : '+ Library cell'}
          </button>
        </span>
      </div>
      {open && (
        <div className="fadeup" style={{ marginTop: 8 }}>
          <div className="row">
            <button className="btn small primary" onClick={() => insert(NOTEBOOK_LIBS_SNIPPET, 'numpy + pandas')}>+ numpy + pandas</button>
            {NOTEBOOK_LIBS.map((l) => (
              <button key={l.id} className="btn small" onClick={() => insert(`${l.code}\n\n`, l.id)} title={l.blurb}>
                + {l.code}
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
            {NB_DATASETS.map((d) => (
              <button
                key={d.name}
                className="btn small"
                title={d.desc}
                onClick={() => insert(`import pandas as pd\n\ndf = pd.read_csv('${d.name}')\nprint(df.head())\nprint(df.shape)\n`, `pd.read_csv('${d.name}')`)}
              >
                + {d.name}
              </button>
            ))}
          </div>
          <p className="small muted" style={{ margin: '6px 0 0' }}>
            The datasets are already on the filesystem — `pd.read_csv(&quot;students.csv&quot;)` works as-is.
          </p>
        </div>
      )}
    </div>
  );
}

/* --------------------------------- notebook -------------------------------- */
interface NotebookCellsProps {
  cells: NbCellSpec[];
  /** Namespace for saved code, run records and the kernel session (`nbc:<slug>:<cell>`, `nb:<slug>:<cell>`). */
  slug: string;
  compact?: boolean;
  /** Show the Program Input box (one value per line for `input()`). */
  stdin?: boolean;
  /** Show the live kernel-variable panel. */
  showKernel?: boolean;
  /** Show the Run all / Stop / Restart toolbar (always on: it is the notebook's controls). */
  toolbar?: boolean;
  /** Fired on every clean run; `first` is true only the first time that cell ever succeeds. */
  onCellRun?: (cell: NbCellSpec, first: boolean) => void;
  /** Drop code into a named cell ("Load solution into the cell") — applied when `nonce` changes. */
  prefill?: { cellId: string; code: string; nonce: number };
  right?: ReactNode;
  /** Lesson id, so the assistant under the cells can bias its answer to this section. */
  sectionId?: string;
  /** Human label for the assistant's context strip, e.g. "Task 4 · coding". */
  where?: string;
  /** Hide the local assistant that normally sits under the last cell. */
  assistant?: boolean;
  /**
   * Report the traceback the cells really raised (null once a run succeeds).
   *
   * A surface that places the assistant somewhere other than under the last cell — the notebook
   * card puts it below the Notebook Lab shelf — needs the error to travel with it, otherwise the
   * assistant can no longer explain what just broke on screen.
   */
  onError?: (e: { code: string; error: string } | null) => void;
  /** Previous / next notebook in the caller's list (see NbNav) — omitted when there is no list. */
  nav?: NbNav;
}

/**
 * A readable label for the assistant when the caller didn't supply one.
 * Slugs look like `nbc:s01:coding:3`, so the middle two parts already say where we are.
 */
function whereFromSlug(slug: string): string | undefined {
  const parts = slug.split(':').filter(Boolean);
  if (parts.length >= 3) return `${parts[1]} · ${parts[2]}`;
  if (parts.length === 2) return parts[1];
  return undefined;
}

export function NotebookCells({ cells, slug, compact, stdin: showStdin, showKernel, toolbar = true, onCellRun, prefill, right, sectionId, where, assistant = true, onError, nav }: NotebookCellsProps) {
  const state = useStore();
  const rootRef = useRef<HTMLDivElement>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<Record<string, CellRun>>({});
  const [exec, setExec] = useState<Record<string, number>>({});
  const [extra, setExtra] = useState<NbCellSpec[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [vars, setVars] = useState<[string, string, string][]>([]);
  const [showVars, setShowVars] = useState(false);
  const [stdin, setStdin] = useState('');
  /**
   * The last error this notebook really raised, with the code that raised it.
   *
   * This is the difference between a tutor and a search box: with the traceback and the source in
   * hand the assistant can point at the offending line instead of paraphrasing a topic. Cleared the
   * moment a run succeeds, so "nothing is broken" stays true rather than sticky.
   */
  const [lastError, setLastError] = useState<{ code: string; error: string } | null>(null);
  const [pyReady, setPyReady] = useState(isPythonReady());
  const stopRef = useRef(false);
  const execRef = useRef(0);

  useEffect(() => { warmupPython().then((ok) => { if (ok) setPyReady(true); }).catch(() => {}); }, []);

  /**
   * The kernel session is deliberately NOT reset here.
   *
   * A notebook's names live in the worker, keyed by `slug`, and they must outlive this component:
   * leaving a lesson and coming back — or moving between tasks and sections — is navigation, not a
   * new interpreter. Resetting on mount made every return an empty kernel, so `import pandas as pd`
   * (and every name built on top of it) had to be paid for again on each visit, which is exactly
   * what a real Jupyter session does not do. Only the "Restart kernel" button resets a session.
   *
   * The in-memory run/exec/edit maps ARE cleared on a notebook switch: cell ids are only unique
   * within a notebook, so a leftover entry would render another notebook's output for a same-named
   * cell. The names still alive in this kernel are then re-probed, so the panel shows the session
   * the learner actually has instead of an empty list that contradicts it.
   */
  useEffect(() => {
    setRuns({}); setExec({}); setVars([]); setEdits({}); setExtra([]);
    if (showKernel) kernelVars(slug).then(setVars).catch(() => {});
  }, [slug, showKernel]);

  useEffect(() => {
    // nonce 0 is the initial value — ignore it, so a saved cell is never overwritten on mount.
    if (!prefill || !prefill.nonce) return;
    setEdits((e) => ({ ...e, [prefill.cellId]: prefill.code }));
  }, [prefill?.nonce]);

  const all = useMemo(() => [...cells, ...extra], [cells, extra]);
  const codeCells = useMemo(() => all.filter((c) => c.kind === 'code'), [all]);
  const valueOf = useCallback(
    (c: NbCellSpec) => edits[c.id] ?? state.savedCode[codeSlot.notebook(slug, c.id)] ?? c.source,
    [edits, state.savedCode, slug],
  );

  const doneCount = codeCells.filter((c) => state.attempts[notebookCell(slug, c.id)]?.done).length;
  const pct = codeCells.length ? Math.round((doneCount / codeCells.length) * 100) : 0;
  /** How many of the ran cells actually SUCCEEDED — the notebook's own answer accuracy. */
  const acc = notebookAccuracy(state, slug);

  /**
   * Move the caret to the previous / next code cell of THIS notebook, scrolling it into view.
   *
   * With nothing focused yet, "next" starts at the first cell and "previous" at the last, so both
   * buttons always do something visible instead of appearing broken.
   */
  const moveCell = useCallback((dir: -1 | 1) => {
    const root = rootRef.current;
    if (!root) return;
    const list = Array.from(root.querySelectorAll<HTMLTextAreaElement>('[data-cell-index]'));
    if (!list.length) return;
    const at = document.activeElement instanceof HTMLTextAreaElement ? list.indexOf(document.activeElement) : -1;
    const nextIndex = at < 0
      ? (dir > 0 ? 0 : list.length - 1)
      : Math.min(list.length - 1, Math.max(0, at + dir));
    const el = list[nextIndex];
    el.focus();
    el.scrollIntoView({ block: 'center' });
  }, []);

  /** Alt+↓ / Alt+↑ step cells from the keyboard, for anyone who would rather not reach for a button. */
  const onRootKeys = (e: React.KeyboardEvent) => {
    if (!e.altKey) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveCell(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveCell(-1); }
  };

  const persist = useCallback((id: string, code: string) => {
    setState((s) => ({ ...s, savedCode: { ...s.savedCode, [codeSlot.notebook(slug, id)]: code } }));
  }, [slug]);

  /**
   * Typing is not running. `persist` used to fire only on Run (and on the explicit Save button),
   * so code that was written but never executed was gone on the next visit — the working copy was
   * the one thing a learner could not get back. A short debounce keeps it without writing the whole
   * state blob on every keystroke.
   */
  const pending = useRef(new Map<string, { code: string; timer: number }>());
  const cancelPending = useCallback((id?: string) => {
    for (const [key, v] of pending.current) {
      if (id && key !== id) continue;
      window.clearTimeout(v.timer);
      pending.current.delete(key);
    }
  }, []);
  const schedulePersist = useCallback((id: string, code: string) => {
    cancelPending(id);
    const timer = window.setTimeout(() => {
      pending.current.delete(id);
      persist(id, code);
    }, 600);
    pending.current.set(id, { code, timer });
  }, [cancelPending, persist]);

  // Leaving the notebook (another task, another page) must not drop the last few characters, and
  // must not resurrect code that was explicitly reset either — resets cancel first.
  useEffect(() => () => {
    for (const [id, v] of pending.current) { window.clearTimeout(v.timer); persist(id, v.code); }
    pending.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const runCell = useCallback(async (cell: NbCellSpec): Promise<boolean> => {
    const code = valueOf(cell);
    setBusy(cell.id);
    persist(cell.id, code);
    const res = await runPython(code, stdin, slug);
    const outcome: CellRun = {
      ok: res.ok,
      output: res.output ?? '',
      error: res.ok ? undefined : (res.error || res.output || 'Error'),
      ms: res.ms,
    };
    setRuns((r) => ({ ...r, [cell.id]: outcome }));
    setLastError(res.ok ? null : { code, error: outcome.error ?? 'Error' });
    execRef.current += 1;
    const n = execRef.current;
    setExec((e) => ({ ...e, [cell.id]: n }));
    setBusy(null);
    setPyReady(true);

    // Read the store fresh: during "Run all" this render's snapshot is already stale.
    const first = !stateSnapshot().attempts[notebookCell(slug, cell.id)];
    recordAttempt(notebookCell(slug, cell.id), { done: true, score: outcome.ok ? 100 : 0 });
    if (res.ok) {
      if (first) addXp(2, 'notebook', cell.label ?? cell.id);
      onCellRun?.(cell, first);
      if (showKernel) kernelVars(slug).then(setVars).catch(() => {});
    }
    return res.ok;
  }, [valueOf, persist, stdin, slug, onCellRun, showKernel]);

  const runAll = useCallback(async () => {
    stopRef.current = false;
    setRunningAll(true);
    for (const c of codeCells) {
      if (stopRef.current) break;
      const ok = await runCell(c);
      if (!ok) break;                     // a raise stops the run, like Jupyter
    }
    setRunningAll(false);
  }, [codeCells, runCell]);

  /** Hard stop: the in-browser runtime can only be interrupted by restarting its worker. */
  const stop = () => {
    stopRef.current = true;
    stopPython();
    setRunningAll(false);
    setBusy(null);
    setVars([]);
    setPyReady(false);
  };

  const restart = () => {
    resetKernel(slug);
    setRuns({}); setExec({}); setVars([]);
  };

  /**
   * Reset means the ORIGINAL cell, not "the last thing I saved". Saved code is dropped too,
   * otherwise a reset would silently reappear on the next visit and look like a lost keystroke.
   */
  const forgetSaved = (ids: string[]) => {
    setState((s) => {
      const savedCode = { ...s.savedCode };
      for (const id of ids) delete savedCode[codeSlot.notebook(slug, id)];
      return { ...s, savedCode };
    });
  };

  const resetCell = (cell: NbCellSpec) => {
    cancelPending(cell.id);
    setEdits((e) => { const next = { ...e }; delete next[cell.id]; return next; });
    setRuns((r) => { const next = { ...r }; delete next[cell.id]; return next; });
    forgetSaved([cell.id]);
  };

  const resetCells = () => {
    cancelPending();
    setEdits({}); setRuns({}); setVars([]); setExtra([]); setLastError(null);
    forgetSaved(all.map((c) => c.id));
  };

  const assistantContext = useMemo(
    () => ({ sectionId, where: where ?? whereFromSlug(slug), code: lastError?.code, error: lastError?.error }),
    [sectionId, where, slug, lastError],
  );
  // Hand the same failure to the caller's own assistant placement, when it has one.
  useEffect(() => { onError?.(lastError); }, [lastError, onError]);
  const locked = runningAll;

  /**
   * Download exactly what is on screen: the learner's edited code, and the outputs their runs
   * really produced. This is what makes the surface a notebook rather than a sandbox — the file
   * opens in real Jupyter with the work already in it.
   */
  const downloadIpynb = () => {
    const doc = buildIpynb(
      all.map((c) => ({
        kind: c.kind,
        source: valueOf(c),
        run: runs[c.id] ? { ok: runs[c.id].ok, output: runs[c.id].output, error: runs[c.id].error } : undefined,
        executionCount: exec[c.id] ?? null,
      })),
    );
    const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/x-ipynb+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ipynbFileName(slug);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const addCell = (code: string, label: string) =>
    setExtra((e) => [...e, { id: `add${Date.now()}${e.length}`, kind: 'code', source: code, label }]);

  return (
    <div className={`jup${compact ? ' jup-compact' : ''}`} ref={rootRef} onKeyDown={onRootKeys}>
      {toolbar && (
        <div className="jup-bar">
          <button className="btn primary" onClick={() => void runAll()} disabled={runningAll || !!busy}>
            <Play size={13} /> Run all
          </button>
          <button className="btn" onClick={stop} disabled={!runningAll && !busy}>
            <Square size={12} /> Stop
          </button>
          <button className="btn" onClick={restart} title="Clear all names but keep the code"><RotateCcw size={13} /> Restart kernel</button>
          <button className="btn" onClick={resetCells} title="Discard edits and restore the original cells"><Trash2 size={13} /> Reset cells</button>
          <button className="btn" onClick={() => addCell('# new cell\n', 'blank')}><Plus size={13} /> Cell</button>
          <button
            className="btn"
            onClick={downloadIpynb}
            title="Download the whole notebook as an .ipynb file — with your edits and run outputs (opens in real Jupyter)"
            aria-label="Download this notebook as a .ipynb file"
          >
            <Download size={13} /> .ipynb
          </button>
          {showKernel && <button className="btn" onClick={() => setShowVars((v) => !v)}>Kernel vars ({vars.length})</button>}
          {right}
          <span className="jup-progress">
            <span className="small muted">{doneCount}/{codeCells.length} cells run</span>
            <span className="bar" style={{ width: 84 }}><div style={{ width: `${pct}%` }} /></span>
            {/* Run = attempted, passing = the runs that succeeded. Two numbers because a cell that
                raised is still a cell the learner worked through. */}
            {acc.answered > 0 && (
              <span className="small muted" title="How many run cells passed (score 100)">
                pass {pctText(acc.pct)}
              </span>
            )}
            {busy && <span className="small muted">{runningAll ? 'run all…' : 'running…'}</span>}
          </span>
          <Chip kind={pyReady ? 'easy' : 'medium'}>
            {pyReady ? '✓ Python ready' : 'Starting Python… 5–15s'}
          </Chip>
        </div>
      )}

      {showVars && (
        <div className="card jup-vars">
          <div className="row spread">
            <b className="small">🧠 Kernel variables — this notebook's session</b>
            <span className="small muted">Import once, available in every cell below</span>
          </div>
          {!vars.length && <p className="small muted" style={{ margin: '6px 0 0' }}>Empty for now — run the first cell.</p>}
          {vars.map(([n, t, v]) => (
            <div className="jup-var" key={n}>
              <code className="jup-var-n">{n}</code>
              <span className="chip">{t}</span>
              <span className="jup-var-v">{v}</span>
            </div>
          ))}
        </div>
      )}

      <LibraryShelf onInsert={addCell} />

      {all.map((cell, cellIndex) =>
        cell.kind === 'md' ? (
          <div className="nb-mdwrap card" key={cell.id}><Markdown src={cell.source} /></div>
        ) : (
          <CodeCell
            key={cell.id}
            cell={cell}
            value={valueOf(cell)}
            run={runs[cell.id]}
            execCount={exec[cell.id]}
            cellIndex={cellIndex}
            busy={busy === cell.id}
            locked={locked}
            score={attemptPct(state.attempts[notebookCell(slug, cell.id)])}
            onChange={(v) => { setEdits((e) => ({ ...e, [cell.id]: v })); schedulePersist(cell.id, v); }}
            onRun={() => void runCell(cell)}
            onReset={() => resetCell(cell)}
            onSave={() => persist(cell.id, valueOf(cell))}
          />
        ),
      )}

      {/*
       * The line under every notebook. Cell stepping works everywhere (any notebook, any surface);
       * notebook stepping appears when the surface owns a list of notebooks and passed the steps in.
       */}
      <div className="nb-nav" role="group" aria-label="Notebook navigation" data-nb-nav={slug}>
        <span className="row">
          <button className="btn small" onClick={() => moveCell(-1)} title="Previous code cell (Alt+↑)">
            <ChevronUp size={12} /> Previous cell
          </button>
          <button className="btn small" onClick={() => moveCell(1)} title="Next code cell (Alt+↓)">
            <ChevronDown size={12} /> Next cell
          </button>
          <span className="small muted">{codeCells.length} cells</span>
        </span>
        {(nav?.prev || nav?.next) && (
          <span className="row">
            {nav?.prev && (
              <button className="btn small" onClick={nav.prev.run} title={`Previous notebook: ${nav.prev.label}`}>
                ← {nav.prev.label}
              </button>
            )}
            {nav?.next && (
              <button className="btn small primary" onClick={nav.next.run} title={`Next notebook: ${nav.next.label}`}>
                {nav.next.label} →
              </button>
            )}
          </span>
        )}
      </div>

      {showStdin && (
        <div className="card jup-stdin">
          <div className="row spread">
            <span className="small muted">PROGRAM INPUT — one value per line, for input()</span>
            <button className="btn small" onClick={() => setStdin('')} disabled={!stdin}>Clear</button>
          </div>
          <textarea
            className="nb-editor"
            spellCheck={false}
            value={stdin}
            onChange={(e) => setStdin(e.target.value)}
            aria-label="Program input"
            rows={2}
          />
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            If the program calls input(), provide values here (one per line) — then run that cell again.
          </p>
        </div>
      )}

      {/* Under the last cell, so "while coding" is exactly where help is. It receives this
          notebook's error and code, which is what lets it answer the traceback instead of a topic. */}
      {assistant && <AssistantCard embedded context={assistantContext} />}
    </div>
  );
}
