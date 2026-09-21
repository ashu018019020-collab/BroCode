import { useEffect, useRef, useState } from 'react';
import { runPython, runJS, stopPython, explainError } from '../features/coding/runners';
import { useStore, setState, addMistake } from '../offline/store';

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

export function CodeLab({ storageKey, starter, lang = 'python', solution, onComplete, compact }: Props) {
  const state = useStore();
  const [code, setCode] = useState(state.savedCode[storageKey] ?? starter ?? FALLBACK[lang]);
  const [out, setOut] = useState<{ ok: boolean; text: string; ms?: number; error?: string } | null>(null);
  const [stdin, setStdin] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSol, setShowSol] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setCode(state.savedCode[storageKey] ?? starter ?? FALLBACK[lang]); }, [storageKey]);

  const save = () => { setState((s) => ({ ...s, savedCode: { ...s.savedCode, [storageKey]: code } })); };

  const run = async () => {
    setBusy(true);
    try {
      const r = lang === 'python' ? await runPython(code, stdin) : await runJS(code);
      setOut({ ok: r.ok, text: [r.output, r.error].filter(Boolean).join('\n'), ms: r.ms, error: r.error });
      if (r.ok) onComplete?.();
    } catch (e: any) { setOut({ ok: false, text: String(e?.message ?? e) }); }
    setBusy(false);
  };

  const stop = () => { stopPython(); setBusy(false); };
  const reset = () => { setCode(starter ?? FALLBACK[lang]); setOut(null); };
  const copy = async () => { await navigator.clipboard.writeText(code).catch(() => {}); };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = taRef.current!;
      const { selectionStart: a, selectionEnd: b } = ta;
      setCode(code.slice(0, a) + '    ' + code.slice(b));
      requestAnimationFrame(() => ta.setSelectionRange(a + 4, a + 4));
    }
  };

  const expl = out?.error ? explainError(out.error) : null;

  return (
    <div className="card" style={{ padding: 12 }}>
      <textarea
        ref={taRef}
        className="editor"
        spellCheck={false}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={onKey}
        aria-label="Code editor"
        rows={compact ? 8 : 12}
      />
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
          <div className="small muted">OUTPUT</div>
          <pre className="codeblock" style={{ maxHeight: 260 }}><code className={out.ok ? '' : 'out'}>{out.text || '(no output)'}</code></pre>
          {expl && (
            <div className="card" style={{ borderColor: 'rgba(248,113,113,.4)' }}>
              <b className="small">ERROR → WHAT HAPPENED:</b> <span className="small">{expl.what}</span><br />
              <b className="small">LIKELY CAUSE:</b> <span className="small">{expl.cause}</span><br />
              <b className="small">HOW TO DEBUG:</b> <span className="small">{expl.debug}</span>
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn small" onClick={() => addMistake({ section: storageKey, topic: expl.what, question: code.slice(0, 120), myAnswer: out.error ?? '', correct: expl.cause, type: 'code' })}>
                  Save to Mistake Tracker
                </button>
              </div>
            </div>
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
