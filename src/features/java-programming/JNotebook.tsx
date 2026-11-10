import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Copy, Download, Loader2, Play, Plus, RotateCcw, Save,
  Square, Trash2,
} from 'lucide-react';
import { runJava, type JRunResult } from '../../core/data/jcourse';
import type { JLab } from '../../core/learning/jcourse';
import { jLabDone } from '../../core/platform/keys';
import { addXp, recordAttempt, useStore } from '../../core/storage/store';

interface JTestResult { name: string; pass: boolean; expected: string; actual: string }

interface Props {
  initialSource?: string;
  lab?: JLab | null;
  storageKey?: string;
  /** Code handed over by a "Try this code" button in the lesson. */
  source?: { code: string; id: number } | null;
  height?: number;
  /** Attempt family written when every lab test passes. Defaults to the module lab key. */
  attemptKey?: string;
  xp?: number;
  title?: string;
}

type CellStatus = 'idle' | 'running' | 'ok' | 'error' | 'stopped' | 'skipped';

interface Cell {
  id: string;
  code: string;
  stdout: string;
  stderr: string;
  compile: string;
  status: CellStatus;
  time: number | null;
  tests: JTestResult[] | null;
  passed: number | null;
  total: number | null;
}

const FALLBACK = `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Namaste, BroCode!");\n    }\n}`;
const STORE_VERSION = 2;
const RUN_LIMIT = 8;

let cellSeq = 0;
const newCell = (code = ''): Cell => ({
  id: `c${Date.now().toString(36)}${(cellSeq += 1)}`,
  code, stdout: '', stderr: '', compile: '', status: 'idle', time: null, tests: null, passed: null, total: null,
});

/** Read either the old plain-string copy or the newer multi-cell document. */
function readStored(storageKey: string | undefined, fallback: string, fallbackStdin: string): { cells: Cell[]; stdin: string } {
  if (!storageKey) return { cells: [newCell(fallback)], stdin: fallbackStdin };
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { cells: [newCell(fallback)], stdin: fallbackStdin };
    if (raw.trim().startsWith('{')) {
      const parsed = JSON.parse(raw) as { v?: number; cells?: { code?: string }[]; stdin?: string };
      const cells = (parsed.cells ?? []).filter((c) => typeof c.code === 'string').map((c) => newCell(String(c.code)));
      if (cells.length) return { cells, stdin: typeof parsed.stdin === 'string' ? parsed.stdin : fallbackStdin };
    }
    return { cells: [newCell(raw)], stdin: fallbackStdin };
  } catch {
    return { cells: [newCell(fallback)], stdin: fallbackStdin };
  }
}

/**
 * Java Code Bro.
 *
 * Full Java programs are compiled independently: the page says so instead of pretending that a
 * variable from cell 1 exists in cell 2. Every result is a real Judge0 run; a compiler error, a
 * runtime exception or a timeout is shown as itself and is never converted into a pass.
 */
export default function JNotebook({
  initialSource, lab, storageKey, source, height = 320, attemptKey, xp, title = 'Java program',
}: Props) {
  const store = useStore();
  const fallback = initialSource ?? lab?.starter ?? FALLBACK;
  const fallbackStdin = lab?.tests[0]?.stdin ?? '';
  const initial = useMemo(() => readStored(storageKey, fallback, fallbackStdin), [storageKey, fallback, fallbackStdin]);
  const [cells, setCells] = useState<Cell[]>(initial.cells);
  const [stdin, setStdin] = useState(initial.stdin);
  const [active, setActive] = useState(0);
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [session, setSession] = useState(1);
  const abortRef = useRef<AbortController | null>(null);
  const rewarded = useRef(false);
  const cellsRef = useRef(cells);
  cellsRef.current = cells;

  const family = attemptKey ?? (lab ? jLabDone(lab.module) : '');
  const passedBefore = family ? store.attempts[family]?.done === true : false;
  const reward = xp ?? lab?.xp ?? 25;

  useEffect(() => {
    if (source) {
      setCells((previous) => previous.map((cell, i) => (i === 0 ? { ...cell, code: source.code, status: 'idle', stdout: '', stderr: '', compile: '', tests: null } : cell)));
      setActive(0);
    }
  }, [source]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ v: STORE_VERSION, cells: cells.map((c) => ({ code: c.code })), stdin }));
    } catch { /* storage can be blocked */ }
  }, [cells, stdin, storageKey]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const patchCell = (index: number, patch: Partial<Cell>) => {
    setCells((previous) => previous.map((cell, i) => (i === index ? { ...cell, ...patch } : cell)));
  };

  const recordPass = (response: JRunResult) => {
    if (!family || !response.tests?.length) return;
    if (response.passed !== response.total) return;
    if (!passedBefore && !rewarded.current) {
      rewarded.current = true;
      recordAttempt(family, { done: true, score: 100 });
      addXp(reward);
    }
    // A coding-bank question has its own attempt family; it must not also complete the module lab.
    if (lab && !attemptKey) recordAttempt(jLabDone(lab.module), { done: true, score: 100 });
  };

  const execute = async (index: number, controller: AbortController): Promise<boolean> => {
    const cell = cellsRef.current[index];
    if (!cell) return false;
    patchCell(index, { status: 'running', stdout: '', stderr: '', compile: '', tests: null, passed: null, total: null, time: null });
    try {
      const response = await runJava({
        source: cell.code,
        stdin,
        signal: controller.signal,
        ...(lab ? { tests: lab.tests.map((t) => ({ name: t.name, stdin: t.stdin ?? '', stdout: t.stdout })) } : {}),
      });
      const failed = Boolean(response.compileOutput.trim()) || Boolean(response.stderr.trim())
        || response.timedOut || (response.exitCode !== null && response.exitCode !== 0)
        || (response.tests ? response.passed !== response.total : false);
      patchCell(index, {
        stdout: response.stdout,
        stderr: response.stderr,
        compile: response.compileOutput,
        status: failed ? 'error' : 'ok',
        time: response.time,
        tests: response.tests ?? null,
        passed: response.passed ?? null,
        total: response.total ?? null,
      });
      if (!failed) recordPass(response);
      return !failed;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The Java compiler is unreachable right now.';
      const stopped = controller.signal.aborted;
      patchCell(index, {
        status: stopped ? 'stopped' : 'error',
        compile: stopped ? '' : message,
        stderr: stopped ? '' : message,
      });
      return false;
    }
  };

  const runCell = async (index: number) => {
    if (running) return;
    setRunning(true);
    setNote(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await execute(index, controller);
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  };

  const runAll = async () => {
    if (running) return;
    const snapshot = cellsRef.current.slice(0, RUN_LIMIT);
    setRunning(true);
    setNote(null);
    const controller = new AbortController();
    abortRef.current = controller;
    let stoppedAt = -1;
    try {
      for (let i = 0; i < snapshot.length; i += 1) {
        setActive(i);
        const ok = await execute(i, controller);
        if (!ok) { stoppedAt = i; break; }
      }
      if (stoppedAt >= 0) {
        setCells((previous) => previous.map((cell, i) => (
          i > stoppedAt && i < snapshot.length ? { ...cell, status: 'skipped' } : cell
        )));
        setNote(`Stopped after cell ${stoppedAt + 1}: later cells were not run.`);
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setCells((previous) => previous.map((cell) => (cell.status === 'running' ? { ...cell, status: 'stopped' } : cell)));
    // Judge0 has no cancel endpoint: this stops this tab waiting, and the provider may finish its
    // own sandbox run. Saying that plainly is better than a Stop button that pretends to kill it.
    setNote('Stopped waiting. The remote sandbox may finish its own run.');
  };

  const restart = () => {
    stop();
    setCells((previous) => previous.map((cell) => ({ ...cell, stdout: '', stderr: '', compile: '', status: 'idle', time: null, tests: null, passed: null, total: null })));
    setSession((n) => n + 1);
    setNote('Fresh session: outputs cleared, code kept.');
  };

  const resetAll = () => {
    stop();
    setCells([newCell(fallback)]);
    setStdin(fallbackStdin);
    setActive(0);
    setSession((n) => n + 1);
    setNote('Cells reset to the starter.');
  };

  const resetCell = (index: number) => {
    patchCell(index, {
      code: index === 0 ? fallback : '', stdout: '', stderr: '', compile: '',
      status: 'idle', time: null, tests: null, passed: null, total: null,
    });
  };

  const addCell = () => {
    setCells((previous) => [...previous, newCell('// New Java cell — a complete class with a main method, or a snippet.')]);
    setActive(cells.length);
  };

  const removeCell = (index: number) => {
    setCells((previous) => (previous.length <= 1 ? previous : previous.filter((_, i) => i !== index)));
    setActive((current) => Math.max(0, Math.min(current, cells.length - 2)));
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= cells.length) return;
    setCells((previous) => {
      const next = previous.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setActive(target);
  };

  const save = () => {
    if (storageKey) {
      try { localStorage.setItem(storageKey, JSON.stringify({ v: STORE_VERSION, cells: cells.map((c) => ({ code: c.code })), stdin })); } catch { /* blocked */ }
    }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  };

  const copy = (code: string) => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(code);
      window.setTimeout(() => setCopied(null), 1200);
    }).catch(() => setNote('The clipboard is blocked in this browser.'));
  };

  const download = () => {
    const notebook = {
      cells: cells.map((cell) => ({
        cell_type: 'code', execution_count: null, metadata: {}, outputs: [],
        source: cell.code.split('\n').map((line, i, all) => (i < all.length - 1 ? `${line}\n` : line)),
      })),
      metadata: {
        kernelspec: { display_name: 'Java 17', language: 'java', name: 'java' },
        language_info: { name: 'java', version: '17' },
      },
      nbformat: 4, nbformat_minor: 5,
    };
    const blob = new Blob([JSON.stringify(notebook, null, 2)], { type: 'application/x-ipynb+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brocode-java-${Date.now()}.ipynb`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeCell = cells[Math.min(active, cells.length - 1)];
  const runnable = Math.min(cells.length, RUN_LIMIT);
  const statusText = running ? 'Running…' : activeCell?.status === 'ok' ? 'Cell passed' : activeCell?.status === 'error' ? 'Cell failed' : 'Not run yet';

  return (
    <div className="j-notebook j-play">
      <div className="j-play-bar">
        <button type="button" className="btn small primary" onClick={runAll} disabled={running || !cells.length}>
          {running ? <Loader2 size={12} className="spin" /> : <Play size={12} />} Run all
        </button>
        <button type="button" className="btn small" onClick={stop} disabled={!running}><Square size={12} /> Stop</button>
        <button type="button" className="btn small" onClick={restart}><RotateCcw size={12} /> Restart</button>
        <button type="button" className="btn small" onClick={resetAll}><Trash2 size={12} /> Reset cells</button>
        <button type="button" className="btn small" onClick={addCell} disabled={cells.length >= RUN_LIMIT}><Plus size={12} /> Cell</button>
        <button type="button" className="btn small" onClick={download}><Download size={12} /> ipynb</button>
        <span className="j-play-status small muted">
          <b>{runnable}/{cells.length}</b> cells · <b>Java 17</b> · independent files · session {session}
        </span>
      </div>

      <div className="row spread small" style={{ gap: 8, marginTop: 6 }}>
        <span className="muted">{title} · each cell compiles as its own <code>Main.java</code></span>
        <span className={`chip small ${passedBefore ? 'easy' : ''}`}>{passedBefore ? 'all tests passed ✓' : lab ? `${lab.tests.length} tests` : 'no tests attached'}</span>
      </div>

      <div className="j-cells">
        {cells.map((cell, index) => {
          const state = cell.status === 'running' ? 'running' : cell.status;
          return (
            <div key={cell.id} className={`j-cell ${index === active ? 'on' : ''} ${state}`}>
              <div className="j-cell-bar">
                <button type="button" className="j-cell-no" onClick={() => setActive(index)} aria-label={`Open cell ${index + 1}`}>
                  In [{index + 1}]
                </button>
                <span className="chip small">Java 17</span>
                <span className="muted small">{cell.code.split('\n').length} lines</span>
                <span className="j-cell-actions">
                  <button type="button" className="btn small" onClick={() => { setActive(index); void runCell(index); }} disabled={running}>
                    <Play size={11} /> Run
                  </button>
                  <button type="button" className="btn small" onClick={() => resetCell(index)}><RotateCcw size={11} /> Reset</button>
                  <button type="button" className="btn small" onClick={() => copy(cell.code)}><Copy size={11} /> {copied === cell.code ? 'Copied' : 'Copy'}</button>
                  <button type="button" className="btn small" onClick={save}><Save size={11} /> {saved ? 'Saved' : 'Save'}</button>
                  <button type="button" className="btn small" onClick={() => removeCell(index)} disabled={cells.length <= 1} aria-label={`Delete cell ${index + 1}`}><Trash2 size={11} /></button>
                </span>
              </div>
              <textarea
                value={cell.code}
                onChange={(e) => { setActive(index); patchCell(index, { code: e.target.value, status: 'idle' }); }}
                spellCheck={false}
                aria-label="Java source code"
                title={`Cell ${index + 1}`}
                style={{ height }}
              />
              <div className="j-cell-foot">
                <span className={`j-cell-state ${state}`}>
                  {cell.status === 'running' ? 'Running…' : cell.status === 'ok' ? 'Passed' : cell.status === 'error' ? 'Failed' : cell.status === 'stopped' ? 'Stopped' : cell.status === 'skipped' ? 'Skipped' : 'Not run yet'}
                </span>
                {cell.time !== null && <span className="muted small">{cell.time} ms</span>}
                {cell.tests && <span className="muted small">{cell.passed}/{cell.total} tests</span>}
                <span className="j-cell-nav">
                  <button type="button" className="btn small" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move cell up">↑</button>
                  <button type="button" className="btn small" onClick={() => move(index, 1)} disabled={index === cells.length - 1} aria-label="Move cell down">↓</button>
                </span>
              </div>
              {cell.compile.trim() && (
                <div className="j-out bad">
                  <strong>Compilation</strong>
                  <pre>{cell.compile}</pre>
                </div>
              )}
              {cell.stderr.trim() && (
                <div className="j-out bad">
                  <strong>Runtime error</strong>
                  <pre>{cell.stderr}</pre>
                </div>
              )}
              {cell.stdout.trim() && (
                <div className="j-out">
                  <strong>Output</strong>
                  <pre>{cell.stdout}</pre>
                </div>
              )}
              {cell.tests && (
                <div className="j-tests">
                  {cell.tests.map((test) => (
                    <div key={`${cell.id}-${test.name}`} className={`j-test ${test.pass ? 'pass' : 'fail'}`}>
                      <b>{test.pass ? '✓' : '✗'} {test.name}</b>
                      <span>expected {JSON.stringify(test.expected)} · got {JSON.stringify(test.actual)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="j-cell-nav-row">
        <button type="button" className="btn small" onClick={() => setActive((n) => Math.max(0, n - 1))} disabled={active === 0}><ChevronLeft size={12} /> Previous cell</button>
        <span className="muted small">cell {Math.min(active + 1, cells.length)} of {cells.length}</span>
        <button type="button" className="btn small" onClick={() => setActive((n) => Math.min(cells.length - 1, n + 1))} disabled={active >= cells.length - 1}>Next cell <ChevronRight size={12} /></button>
      </div>

      <div className="j-stdin">
        <div className="row spread">
          <label className="small" htmlFor="j-stdin">PROGRAM INPUT — one value per line{" "}</label>
          <button type="button" className="btn small" onClick={() => setStdin('')}>Clear</button>
        </div>
        <textarea
          id="j-stdin"
          value={stdin}
          onChange={(e) => setStdin(e.target.value)}
          spellCheck={false}
          aria-label="Program input"
          placeholder={'Scanner reads these lines in order. For name + age:\nAshu\n22'}
        />
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          Each run receives this stdin. Empty input is passed as end-of-file, not as a blank first line.
        </p>
      </div>

      {note && <p className="j-note small">{note}</p>}
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        {statusText}. Java runs in a shared public JDK sandbox; stop only stops this tab waiting.
      </p>
    </div>
  );
}
