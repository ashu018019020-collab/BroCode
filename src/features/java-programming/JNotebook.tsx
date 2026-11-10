import { useEffect, useState } from 'react';
import { Loader2, Play, RotateCcw, Trash2 } from 'lucide-react';
import { runJava } from '../../core/data/jcourse';
import type { JLab } from '../../core/learning/jcourse';
import { jLabDone } from '../../core/platform/keys';
import { addXp, recordAttempt, useStore } from '../../core/storage/store';

interface JTestResult { name: string; pass: boolean; expected: string; actual: string }

interface Props {
  initialSource?: string; lab?: JLab | null; storageKey?: string;
  /** Code handed over by a "Try this code" button in the lesson. */
  source?: { code: string; id: number } | null;
  height?: number;
}

const FALLBACK = `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Namaste, BroCode!");\n    }\n}`;

/**
 * The Java notebook: one file, real compilation through `runJava`, optional lab tests.
 * It never fakes a verdict — a compiler or network failure is displayed as a failure.
 */
export default function JNotebook({ initialSource, lab, storageKey, source, height = 360 }: Props) {
  const store = useStore();
  const [code, setCode] = useState(() => {
    if (storageKey) {
      try { const saved = localStorage.getItem(storageKey); if (saved) return saved; } catch { /* storage can be blocked */ }
    }
    return initialSource ?? lab?.starter ?? FALLBACK;
  });
  const [stdin, setStdin] = useState(() => lab?.tests[0]?.stdin ?? '');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stdout, setStdout] = useState('');
  const [compile, setCompile] = useState('');
  const [results, setResults] = useState<JTestResult[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (source) setCode(source.code);
  }, [source]);

  useEffect(() => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, code); } catch { /* storage can be blocked */ }
  }, [code, storageKey]);

  const passed = store.attempts[lab ? jLabDone(lab.module) : '']?.done === true;

  const execute = async (withTests: boolean) => {
    setRunning(true); setError(null); setCompile(''); setResults(null);
    try {
      const response = await runJava({
        source: code,
        stdin,
        ...(withTests && lab ? { tests: lab.tests.map((t) => ({ name: t.name, stdin: t.stdin ?? '', stdout: t.stdout })) } : {}),
      });
      setStdout(response.stdout);
      setCompile(response.compileOutput || response.stderr);
      if (response.tests) {
        setResults(response.tests);
        if (lab && response.passed === response.total && !passed) {
          recordAttempt(jLabDone(lab.module), { done: true, score: 100 });
          addXp(lab.xp ?? 25);
        }
      }
      if (response.timedOut) setError('The program hit the compiler time limit.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The Java compiler is unreachable right now.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="j-notebook">
      <div className="row spread" style={{ gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span className="chip small">real javac · JDK 17</span>
        {lab && <span className="chip small">{passed ? 'lab passed ✓' : `${lab.tests.length} tests`}</span>}
      </div>
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        aria-label="Java source code"
        style={{
          width: '100%', height, resize: 'vertical', background: '#0b0b0b', color: '#e5e7eb',
          border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: 12,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, lineHeight: 1.55,
        }}
      />
      <label className="muted small" style={{ display: 'block', margin: '8px 0 4px' }}>Standard input</label>
      <textarea
        value={stdin}
        onChange={(e) => setStdin(e.target.value)}
        spellCheck={false}
        aria-label="Standard input"
        style={{
          width: '100%', height: 60, resize: 'vertical', background: '#0b0b0b', color: '#e5e7eb',
          border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: 8,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12,
        }}
      />
      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn small primary" onClick={() => execute(false)} disabled={running}>
          {running ? <Loader2 size={12} className="spin" /> : <Play size={12} />} Run
        </button>
        {lab && (
          <button className="btn small" onClick={() => execute(true)} disabled={running}>
            <Play size={12} /> Run lab tests
          </button>
        )}
        <button
          className="btn small"
          onClick={() => { setCode(lab?.starter ?? initialSource ?? FALLBACK); setStdin(lab?.tests[0]?.stdin ?? ''); setResults(null); setStdout(''); setCompile(''); setError(null); }}
        >
          <RotateCcw size={12} /> Starter
        </button>
        <button className="btn small" onClick={() => { setCode(FALLBACK); setResults(null); }}><Trash2 size={12} /> Clear</button>
        <button
          className="btn small"
          onClick={() => { navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {}); }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {error && <p className="small" style={{ color: '#fca5a5', margin: '8px 0 0' }}>{error}</p>}
      {compile.trim() && (
        <div style={{ marginTop: 8 }}>
          <strong className="small">Compiler output</strong>
          <pre style={{ background: '#1a0b0b', borderRadius: 10, padding: 10, overflow: 'auto', fontSize: 12 }}><code>{compile}</code></pre>
        </div>
      )}
      {stdout && (
        <div style={{ marginTop: 8 }}>
          <strong className="small">Output</strong>
          <pre style={{ background: '#0b0b0b', borderRadius: 10, padding: 10, overflow: 'auto', fontSize: 12 }}><code>{stdout}</code></pre>
        </div>
      )}
      {results && (
        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
          {results.map((r) => (
            <div key={r.name} className="small" style={{ border: `1px solid ${r.pass ? '#22c55e' : '#ef4444'}`, borderRadius: 8, padding: '6px 8px' }}>
              <b>{r.pass ? '✓' : '✗'} {r.name}</b>
              <div className="muted">expected: {JSON.stringify(r.expected)} · got: {JSON.stringify(r.actual)}</div>
            </div>
          ))}
        </div>
      )}
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        Runs on a shared public JDK 17 compiler. Keep every class in this one file; requests are rate limited.
      </p>
    </div>
  );
}
