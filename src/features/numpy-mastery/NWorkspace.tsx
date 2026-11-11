import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Code2, Copy, Eye, EyeOff, Play, RotateCcw, Wand2 } from 'lucide-react';
import { outputMatches, type NEntry, type NSectionKey } from '../../core/learning/ncourse';
import type { RunResult } from '../coding/runners';

const DIFF_TONE: Record<NEntry['difficulty'], string> = { easy: 'easy', medium: 'medium', hard: 'hard' };

interface Outcome {
  run: RunResult;
  /** `null` when there is nothing to compare (a free run, or a failing run). */
  graded: 'pass' | 'fail' | null;
}

/**
 * The module's code box.
 *
 * One entry at a time, but a real workbench rather than a reveal card: the sample is loaded into an
 * editable editor, "Try this code" runs the authored snippet exactly as published, and Run grades
 * whatever is in the box. A learning sample is compared with its verified output; an independent
 * task is graded by its hidden check, which runs in the same kernel namespace so a copied lesson
 * snippet fails. Every run gets a fresh kernel, so a name left over from a previous run can never
 * make the current one pass.
 */
export function NCodeWorkbench({
  entry, scope, done, onDone,
}: { entry: NEntry; scope: string; done: boolean; onDone: () => void }) {
  const source = entry.code ?? entry.starter ?? '';
  const expected = entry.kind === 'task' ? (entry.expected ?? '') : (entry.output ?? '');
  const [code, setCode] = useState(source);
  const [out, setOut] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [showExpected, setShowExpected] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [copied, setCopied] = useState(false);

  // A new entry is a new problem: never carry the previous draft or its output across.
  useEffect(() => {
    setCode(entry.code ?? entry.starter ?? '');
    setOut(null);
    setShowExpected(false);
    setShowSolution(false);
  }, [entry.id, entry.code, entry.starter]);

  async function run(text: string) {
    if (!text.trim()) return;
    setBusy(true);
    setOut(null);
    try {
      const { runPython, resetKernel } = await import('../coding/runners');
      resetKernel(scope);
      const r = await runPython(text, '', scope);
      let graded: 'pass' | 'fail' | null = null;
      if (r.ok && entry.kind === 'task' && entry.check) {
        const check = await runPython(entry.check, '', scope);
        graded = check.ok ? 'pass' : 'fail';
        if (!check.ok) r.error = check.error ?? 'the hidden check did not pass';
      } else if (r.ok && expected) {
        graded = outputMatches(expected, r.output) ? 'pass' : 'fail';
      }
      setOut({ run: r, graded });
      if (graded === 'pass') onDone();
    } catch (error) {
      setOut({
        run: { ok: false, output: '', error: String((error as Error)?.message ?? error), ms: 0 },
        graded: null,
      });
    } finally {
      setBusy(false);
    }
  }

  const title = entry.title ?? entry.q ?? 'Code';
  const statement = entry.statement ?? entry.task ?? entry.body;

  return (
    <div className="card" style={{ margin: 0, padding: '12px 14px' }}>
      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className={`chip ${DIFF_TONE[entry.difficulty]}`}>{entry.difficulty}</span>
          {entry.kind === 'task'
            ? <span className="chip">independent task · hidden check</span>
            : <span className="chip"><Wand2 size={11} /> verified sample</span>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {done && <span className="chip easy"><Check size={11} /> done</span>}
          <button type="button" className="btn small ghost" onClick={onDone} disabled={done}>
            {done ? 'Recorded' : 'Mark done'}
          </button>
        </div>
      </div>

      <strong className="small" style={{ display: 'block', margin: '10px 0 6px', fontSize: '0.95rem' }}>{title}</strong>
      {statement && <p className="small muted" style={{ margin: '0 0 10px' }}>{statement}</p>}
      {/* What practising here actually feels like, stated from the data rather than promised. */}
      <div className="small muted" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 10px' }}>
        <span>Runs in the built-in Python kernel · numpy bundled · offline</span>
        <span>·</span>
        <span>{entry.kind === 'task' ? 'Graded by a hidden check in a fresh kernel' : 'Output verified on numpy 1.26.4 and 2.x'}</span>
      </div>
      {entry.error && <p className="small" style={{ margin: '0 0 8px', color: 'var(--red)' }}>{entry.error}</p>}
      {entry.steps?.length ? (
        <ol className="small muted" style={{ margin: '0 0 10px', paddingLeft: 18 }}>
          {entry.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      ) : null}

      {/* Actions live ABOVE the editor: the snippet is one click away from running. */}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {entry.code && (
          <button
            type="button"
            className="btn small primary"
            disabled={busy}
            onClick={() => { setCode(entry.code!); void run(entry.code!); }}
            title="Load the published sample into the editor and run it"
          >
            <Play size={12} /> Try this code
          </button>
        )}
        <button type="button" className="btn small" disabled={busy} onClick={() => void run(code)}>
          <Code2 size={12} /> {busy ? 'Running…' : entry.kind === 'task' ? 'Run & grade' : 'Run'}
        </button>
        <button type="button" className="btn small ghost" disabled={busy} onClick={() => { setCode(source); setOut(null); }}>
          <RotateCcw size={12} /> Reset
        </button>
        <button
          type="button"
          className="btn small ghost"
          onClick={async () => {
            try { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1200); } catch { setCopied(false); }
          }}
        >
          <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
        </button>
        {expected && (
          <button type="button" className="btn small ghost" onClick={() => setShowExpected((v) => !v)}>
            {showExpected ? <EyeOff size={12} /> : <Eye size={12} />} {showExpected ? 'Hide expected' : 'Expected output'}
          </button>
        )}
        {entry.kind === 'task' && entry.solution && (
          <button type="button" className="btn small ghost" onClick={() => setShowSolution((v) => !v)}>
            {showSolution ? 'Hide solution' : 'Show solution'}
          </button>
        )}
        <Link className="btn small ghost" to="/playground"><Code2 size={12} /> Code Bro</Link>
      </div>

      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void run(code); } }}
        spellCheck={false}
        aria-label={`Code for ${title}`}
        placeholder="import numpy as np&#10;&#10;# edit the sample, then Run (Ctrl/Cmd + Enter)"
        style={{
          width: '100%', minHeight: 220, padding: 12, borderRadius: 10, resize: 'vertical',
          border: '1px solid var(--line, #d6dbe4)', background: 'var(--bg2, #fff)', color: 'inherit',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.5,
          tabSize: 4,
        }}
      />
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        Ctrl/Cmd + Enter runs · Python loads once (~10s) and then runs locally — your code never leaves this browser.
      </p>

      {showExpected && expected && (
        <div style={{ marginTop: 8 }}>
          <span className="small muted">{entry.kind === 'task' ? 'Graded by the hidden check on this output' : 'Verified output'}</span>
          <pre className="codeblock" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{expected}</pre>
        </div>
      )}

      {out && (
        <div
          className="card"
          style={{
            margin: '10px 0 0', padding: 10,
            borderColor: out.graded === 'pass' ? 'var(--green, #177245)' : out.graded === 'fail' || !out.run.ok ? 'var(--red, #b42318)' : undefined,
          }}
        >
          <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
            <b className="small" style={{ color: out.graded === 'pass' ? 'var(--green, #177245)' : out.graded === 'fail' || !out.run.ok ? 'var(--red, #b42318)' : undefined }}>
              {out.run.ok
                ? out.graded === 'pass' ? 'Passed — this section is recorded' : out.graded === 'fail' ? 'Not graded — the output differs' : 'Ran successfully'
                : 'Raised an error'}
            </b>
            <span className="small muted">{out.run.ms} ms</span>
          </div>
          {out.run.output.trim() && (
            <pre className="codeblock" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{out.run.output}</pre>
          )}
          {out.run.error && (
            <pre className="codeblock" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', color: 'var(--red)' }}>{out.run.error}</pre>
          )}
          {out.graded === 'fail' && expected && (
            <div style={{ marginTop: 8 }}>
              <span className="small muted">Expected</span>
              <pre className="codeblock" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{expected}</pre>
            </div>
          )}
        </div>
      )}

      {showSolution && entry.solution && (
        <div style={{ marginTop: 10 }}>
          <span className="small muted">Reference solution</span>
          <pre className="codeblock" style={{ margin: '4px 0 0' }}>{entry.solution}</pre>
        </div>
      )}

      {!entry.code && entry.answer && (
        <details style={{ marginTop: 10 }}>
          <summary className="small" style={{ cursor: 'pointer' }}>Model answer</summary>
          <p className="small muted" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{entry.answer}</p>
        </details>
      )}
    </div>
  );
}

/**
 * The right-hand rail: one slip per record in the current section.
 *
 * It is the module's index, not a decorative list — the count is the section's real record count, and
 * picking a slip swaps the workbench. The rail is sticky on wide screens and wraps under the
 * workbench on narrow ones, so the code box always keeps the larger share of the width.
 */
export function NSlipRail({
  groups, activeKey, picked, onPick, done,
}: {
  groups: { key: NSectionKey; label: string; entries: NEntry[] }[];
  activeKey: NSectionKey;
  picked: number;
  onPick: (key: NSectionKey, index: number) => void;
  done: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const current = groups.find((g) => g.key === activeKey);
  const total = groups.reduce((n, g) => n + g.entries.length, 0);

  const slip = (e: NEntry, i: number, key: NSectionKey, active: boolean) => (
    <button
      key={`${key}:${e.id}`}
      type="button"
      onClick={() => onPick(key, i)}
      aria-pressed={active}
      className={`chip${active ? ' on' : ''}`}
      style={{
        display: 'block', textAlign: 'left', cursor: 'pointer', whiteSpace: 'normal',
        padding: '8px 10px', lineHeight: 1.35, borderRadius: 10, width: '100%',
      }}
    >
      <span style={{ opacity: 0.6, marginRight: 6, fontVariantNumeric: 'tabular-nums' }}>
        {String(i + 1).padStart(2, '0')}
      </span>
      <span>{e.title ?? e.q ?? e.id}</span>
      <span className="small muted" style={{ display: 'block', marginTop: 2, marginLeft: 22 }}>
        {e.kind === 'task' ? 'task' : e.options ? 'quiz' : e.rubric ? 'written' : e.difficulty}
      </span>
    </button>
  );

  return (
    <aside style={{ flex: '1 1 300px', minWidth: 'min(260px, 100%)', maxWidth: 360, position: 'sticky', top: 12 }}>
      <div className="card" style={{ margin: 0, padding: 10, maxHeight: '72vh', overflowY: 'auto' }}>
        <div className="row spread small" style={{ marginBottom: 8 }}>
          <b>Topics</b>
          <button type="button" className="btn small ghost" onClick={() => setShowAll((v) => !v)} title="Every record in this module, grouped by section">
            {showAll ? 'This section' : `All ${total}`}
          </button>
        </div>
        {showAll ? groups.map((g) => (
          <div key={g.key} style={{ marginBottom: 10 }}>
            <div className="row spread small muted" style={{ margin: '4px 2px' }}>
              <span>{g.label}{g.key === activeKey && done ? ' ✓' : ''}</span>
              <span>{g.entries.length}</span>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {g.entries.map((e, i) => slip(e, i, g.key, g.key === activeKey && i === picked))}
            </div>
          </div>
        )) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {(current?.entries ?? []).map((e, i) => slip(e, i, activeKey, i === picked))}
          </div>
        )}
      </div>
    </aside>
  );
}
