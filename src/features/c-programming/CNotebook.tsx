import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Download, FileCode2, Play, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { MonacoIDE } from '../../components/code/MonacoIDE';
import { runC } from '../../core/data/ccourse';
import type { CLab } from '../../core/learning/ccourse';

interface CFile { name: string; content: string }
interface Props {
  initialSource?: string; lab?: CLab | null; storageKey?: string;
  /** Code handed over by a "Try this code" button in the lesson. */
  source?: { code: string; id: number } | null;
  height?: number;
}
interface TestResult { name: string; pass: boolean; expected: string; actual: string }

const STARTER = '#include <stdio.h>\n\nint main(void) {\n    printf("Namaste, BroCode!\\n");\n    return 0;\n}\n';
const STORAGE = 'brocode:c-notebook:v1';
const EMPTY = {
  stdout: '', stderr: '', compileOutput: '', exitCode: null as number | null,
  time: null as number | null, memory: null as number | null, status: '', timedOut: false,
  tests: [] as TestResult[],
};

export default function CNotebook({ initialSource, lab = null, storageKey, source = null, height = 420 }: Props) {
  const key = storageKey ?? STORAGE;
  const seed = initialSource ?? lab?.starter ?? STARTER;
  const [files, setFiles] = useState<CFile[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (Array.isArray(saved?.files) && saved.files.length) return saved.files as CFile[];
    } catch { /* a corrupt local copy falls back to the lesson starter */ }
    return [{ name: 'main.c', content: seed }];
  });
  const [active, setActive] = useState(0);
  const [stdin, setStdin] = useState('');
  const [args, setArgs] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(EMPTY);
  const [notice, setNotice] = useState('');
  const index = Math.min(active, files.length - 1);
  const file = files[index];

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify({ files })); } catch { /* quota is not fatal */ }
  }, [files, key]);

  // A lesson example replaces the working file, so "Try this code" is one click away from Run.
  useEffect(() => {
    if (!source) return;
    setFiles([{ name: 'main.c', content: source.code }]);
    setActive(0);
    setResult(EMPTY);
    setError('');
    setNotice('Code loaded — press Run to see its output.');
  }, [source]);

  const write = useCallback((content: string) => {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, content } : f)));
  }, [index]);

  const run = useCallback(async (withTests: boolean) => {
    setBusy(true); setError(''); setResult(EMPTY); setNotice('');
    try {
      const body = await runC({
        source: file.content, stdin, args,
        files: files.filter((_, i) => i !== index),
        ...(withTests && lab ? { tests: lab.tests.map((t) => ({ name: t.name, stdin: t.stdin ?? '', stdout: t.stdout })) } : {}),
      });
      setResult({ ...EMPTY, ...body, tests: body.tests ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compilation could not be started.');
    } finally { setBusy(false); }
  }, [args, file, files, index, lab, stdin]);

  const addFile = () => {
    if (files.length >= 8) return;
    setFiles((prev) => [...prev, { name: prev.some((f) => f.name === 'extra.c') ? `extra${prev.length}.c` : 'extra.c', content: '' }]);
    setActive(files.length);
  };
  const removeFile = (i: number) => {
    if (files.length === 1) return;
    setFiles((prev) => prev.filter((_, at) => at !== i));
    setActive(Math.max(0, Math.min(i, files.length - 2)));
  };
  const rename = (i: number, name: string) => setFiles((prev) => prev.map((f, at) => (at === i ? { ...f, name } : f)));
  const download = () => {
    const url = URL.createObjectURL(new Blob([file.content], { type: 'text/x-c' }));
    const a = document.createElement('a');
    a.href = url; a.download = file.name; a.click();
    URL.revokeObjectURL(url);
  };
  const copy = () => { navigator.clipboard?.writeText(file.content).catch(() => {}); };
  const reset = () => setFiles([{ name: 'main.c', content: seed }]);
  const save = () => {
    try { localStorage.setItem(key, JSON.stringify({ files, savedAt: Date.now() })); setError(''); }
    catch { setError('This browser refused to save the notebook.'); }
  };

  const output = useMemo(() => [
    result.stdout,
    result.stderr && `stderr:\n${result.stderr}`,
    result.compileOutput && `compiler:\n${result.compileOutput}`,
  ].filter(Boolean).join('\n'), [result]);

  return (
    <div className="card">
      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {files.map((f, i) => (
            <button key={`${f.name}-${i}`} className={`btn small${i === index ? ' primary' : ''}`} onClick={() => setActive(i)}>
              <FileCode2 size={12} /> {f.name || 'untitled'}
            </button>
          ))}
          <button className="btn small" onClick={addFile} disabled={files.length >= 8} title="Add a file"><Plus size={12} /></button>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn small primary" onClick={() => run(false)} disabled={busy}><Play size={12} /> {busy ? 'Compiling…' : 'Run'}</button>
          {lab && <button className="btn small" onClick={() => run(true)} disabled={busy}>Run tests</button>}
          <button className="btn small" onClick={save} title="Save to this browser"><Save size={12} /></button>
          <button className="btn small" onClick={copy} title="Copy"><Copy size={12} /></button>
          <button className="btn small" onClick={download} title="Download"><Download size={12} /></button>
          <button className="btn small" onClick={reset} title="Restore starter"><RotateCcw size={12} /></button>
        </div>
      </div>

      <div className="row" style={{ gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
        <input className="assistant-input" style={{ maxWidth: 200 }} value={file.name} onChange={(e) => rename(index, e.target.value)} aria-label="File name" />
        <input className="assistant-input" style={{ maxWidth: 220 }} value={args} onChange={(e) => setArgs(e.target.value)} placeholder="Command-line arguments" aria-label="Command-line arguments" />
        {files.length > 1 && <button className="btn small" onClick={() => removeFile(index)}><Trash2 size={12} /> Delete file</button>}
        <span className="muted small">C17 · GCC · extra .c files are linked into the entry file; headers are available to it.</span>
      </div>

      <MonacoIDE value={file.content} language="cpp" onChange={write} height={height} onRun={() => run(false)} />

      <label className="muted small" style={{ display: 'block', marginTop: 10 }}>stdin (scanf input, one value per line)</label>
      <textarea className="assistant-input" style={{ width: '100%', minHeight: 70 }} value={stdin} onChange={(e) => setStdin(e.target.value)} placeholder={'42\nBroCode'} />

      {error && <p className="small" style={{ color: '#fca5a5', marginTop: 10 }}>{error}</p>}

      {result.tests.length > 0 && (
        <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
          {result.tests.map((t) => (
            <div key={t.name} className="row spread small">
              <span>{t.pass ? '✅' : '❌'} {t.name}</span>
              {!t.pass && <span className="muted">expected {JSON.stringify(t.expected)}, got {JSON.stringify(t.actual)}</span>}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <div className="row spread">
          <strong className="small">Output</strong>
          <span className="muted small">
            {result.status && `${result.status} · `}exit {result.exitCode ?? '—'}
            {result.time != null && ` · ${result.time} ms`}{result.memory != null && ` · ${result.memory} KB`}
          </span>
        </div>
        <pre style={{ background: '#0b0b0b', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, padding: 12, minHeight: 90, maxHeight: 320, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {output || (busy ? 'Running…' : notice || 'Run the program to see real compiler output.')}
        </pre>
      </div>
    </div>
  );
}
