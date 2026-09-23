import { lazy, Suspense, useEffect, useState } from 'react';
import { runPython, runJS, stopPython, explainError } from '../features/coding/runners';
import { useStore, setState, addMistake } from '../offline/store';
import { parseTraceback } from '../engine/traceback';

/** Same Monaco editor the Playground uses — lazily fetched so non-editor pages stay light. */
const MonacoIDE = lazy(() => import('./MonacoIDE').then((m) => ({ default: m.MonacoIDE })));
type IdeError = import('./MonacoIDE').IdeError;

interface Props {
  storageKey: string;
  starter?: string;
  lang?: 'python' | 'js';
  solution?: string;
  onComplete?: () => void;
  compact?: boolean;
}

const FALLBACK: Record<string, string> = {
  python: '# write your code here\nprint("Hello World")\n',
  js: '// write your code here\nconsole.log("Hello World");\n',
};

type ResultTab = 'output' | 'errors' | 'explain';

export function CodeLab({ storageKey, starter, lang = 'python', solution, onComplete, compact }: Props) {
  const state = useStore();
  const [code, setCode] = useState(state.savedCode[storageKey] ?? starter ?? FALLBACK[lang]);
  const [out, setOut] = useState<{ ok: boolean; text: string; ms?: number; error?: string } | null>(null);
  const [stdin, setStdin] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSol, setShowSol] = useState(false);
  const [tab, setTab] = useState<ResultTab>('output');

  useEffect(() => {
    setCode(state.savedCode[storageKey] ?? starter ?? FALLBACK[lang]);
    setOut(null);
    setTab('output');
  }, [storageKey]);

  const save = () => { setState((s) => ({ ...s, savedCode: { ...s.savedCode, [storageKey]: code } })); };

  const run = async () => {
    setBusy(true);
    try {
      const r = lang === 'python' ? await runPython(code, stdin) : await runJS(code);
      setOut({ ok: r.ok, text: [r.output, r.error].filter(Boolean).join('\n'), ms: r.ms, error: r.error });
      setTab(r.ok ? 'output' : 'errors');
      if (r.ok) onComplete?.();
    } catch (e: any) { setOut({ ok: false, text: String(e?.message ?? e) }); setTab('errors'); }
    setBusy(false);
  };

  const stop = () => { stopPython(); setBusy(false); };
  const reset = () => { setCode(starter ?? FALLBACK[lang]); setOut(null); };
  const copy = async () => { await navigator.clipboard.writeText(code).catch(() => {}); };

  // Squiggle the failing line straight from the traceback, like a real IDE.
  const diag = out?.error ? parseTraceback(out.error) : null;
  const markers: IdeError[] = diag?.line
    ? [{ line: diag.line, message: `${diag.kind}: ${diag.message}`.trim(), severity: 'error' }]
    : [];
  const expl = out?.error ? explainError(out.error) : null;

  return (
    <div className="card" style={{ padding: 12 }}>
      <Suspense fallback={<div className="editor-skeleton">Editor load ho raha hai…</div>}>
        <MonacoIDE
          value={code}
          language={lang === 'js' ? 'javascript' : 'python'}
          onChange={setCode}
          onRun={run}
          onSave={save}
          errors={markers}
          height={compact ? 240 : 330}
        />
      </Suspense>

      <div className="row" style={{ margin: '8px 0' }}>
        <button className="btn primary" onClick={run} disabled={busy}>▶ Run <span className="kbd">Ctrl+↵</span></button>
        <button className="btn small" onClick={stop} disabled={!busy}>■ Stop</button>
        <button className="btn small" onClick={reset}>↺ Reset</button>
        <button className="btn small" onClick={copy}>⧉ Copy</button>
        <button className="btn small" onClick={save}>💾 Save</button>
        {solution && (
          <button className="btn small" onClick={() => setShowSol((v) => !v)}>
            {showSol ? '🙈 Hide solution' : '👁 Show solution'}
          </button>
        )}
        {busy && <span className="muted small">running…</span>}
        {out && !busy && <span className="muted small">{out.ms}ms</span>}
      </div>

      {lang === 'python' && (
        <div style={{ margin: '8px 0' }}>
          <div className="small muted">PROGRAM INPUT — one value per line, for input()</div>
          <textarea
            className="editor"
            spellCheck={false}
            value={stdin}
            onChange={(e) => setStdin(e.target.value)}
            aria-label="Program input"
            rows={2}
            style={{ minHeight: 44 }}
          />
        </div>
      )}

      {out && (
        <div>
          <div className="row resulttabs" style={{ marginBottom: 6 }}>
            <button className={`tabbtn ${tab === 'output' ? 'active' : ''}`} onClick={() => setTab('output')}>
              Output {out.ok ? '✓' : ''}
            </button>
            <button className={`tabbtn ${tab === 'errors' ? 'active' : ''} ${out.ok ? '' : 'haserr'}`} onClick={() => setTab('errors')}>
              Errors {out.ok ? '' : '●'}
            </button>
            <button className={`tabbtn ${tab === 'explain' ? 'active' : ''}`} onClick={() => setTab('explain')}>AI Explanation</button>
          </div>

          {tab === 'output' && (
            <pre className="codeblock" style={{ maxHeight: 260 }}><code className={out.ok ? '' : 'out'}>{out.text || '(no output)'}</code></pre>
          )}

          {tab === 'errors' && (
            out.ok
              ? <div className="card small" style={{ borderColor: 'rgba(52,211,153,.4)' }}>✅ Koi error nahi — program clean chala.</div>
              : (
                <div>
                  <pre className="codeblock" style={{ maxHeight: 200 }}><code className="out">{out.error ?? out.text}</code></pre>
                  {diag && (
                    <p className="small" style={{ marginTop: 6 }}>
                      <b>{diag.kind}</b>
                      {diag.line ? <> — line <b>{diag.line}</b> (editor me highlight ho gaya)</> : null}
                      {diag.message ? <> · {diag.message}</> : null}
                    </p>
                  )}
                </div>
              )
          )}

          {tab === 'explain' && (
            endOrExpl(expl, out, code, storageKey)
          )}
        </div>
      )}

      {solution && showSol && (
        <div className="fadeup">
          <div className="small muted">SOLUTION</div>
          <pre className="codeblock"><code>{solution}</code></pre>
          <button className="btn small" onClick={() => { setCode(solution); }}>Load into editor</button>
        </div>
      )}
    </div>
  );
}

/** Local-tutor explanation for the last error, with the mistake-tracker hand-off. */
function endOrExpl(
  expl: ReturnType<typeof explainError> | null,
  out: { ok: boolean; text: string; error?: string },
  code: string,
  storageKey: string,
) {
  if (out.ok) return <div className="card small" style={{ borderColor: 'rgba(52,211,153,.4)' }}>✅ Program bina error ke chala — ab task ka check pura karo.</div>;
  if (!expl) return <div className="card small muted">{out.error ?? out.text}</div>;
  return (
    <div className="card" style={{ borderColor: 'rgba(248,113,113,.4)' }}>
      <b className="small">WHAT HAPPENED:</b> <span className="small">{expl.what}</span><br />
      <b className="small">LIKELY CAUSE:</b> <span className="small">{expl.cause}</span><br />
      <b className="small">HOW TO DEBUG:</b> <span className="small">{expl.debug}</span>
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn small" onClick={() => addMistake({ section: storageKey, topic: expl.what, question: code.slice(0, 120), myAnswer: out.error ?? '', correct: expl.cause, type: 'code' })}>
          Save to Mistake Tracker
        </button>
      </div>
    </div>
  );
}
