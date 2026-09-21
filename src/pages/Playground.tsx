import { useState } from 'react';
import { CodeLab } from '../components/CodeLab';
import { runSQL } from '../features/coding/runners';
import { DATASETS, seedForSQL } from '../data/datasets';
import { useStore, setState } from '../offline/store';
import { codeSlot } from '../engine/keys';

type Mode = 'python' | 'js' | 'html' | 'sql';

export default function Playground() {
  const [mode, setMode] = useState<Mode>('python');
  const state = useStore();
  const [sqlQ, setSqlQ] = useState(state.savedCode[codeSlot.playgroundSql] ?? 'SELECT * FROM students WHERE marks > 80;');
  const [res, setRes] = useState<any>(null);
  const [html, setHtml] = useState(state.savedCode[codeSlot.playgroundHtml] ?? '<h1>Hello AI Engineer</h1>\n<p>Edit me — live preview, fully offline.</p>');

  const runSql = async () => {
    setRes('running…');
    const seed = DATASETS.map(seedForSQL);
    const r = await runSQL(sqlQ, seed);
    setRes(r);
  };

  return (
    <div>
      <h1>🧪 Code Playground</h1>
      <p className="muted small">Local execution only: Python via bundled Pyodide (numpy/pandas included), JS in a sandboxed worker, HTML live preview, SQLite-WASM for SQL.</p>
      <div className="row" style={{ margin: '10px 0' }}>
        {(['python', 'js', 'html', 'sql'] as Mode[]).map((m) => (
          <button key={m} className={`stagepill ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)}>{m.toUpperCase()}</button>
        ))}
      </div>

      {mode === 'python' && (
        <CodeLab storageKey={codeSlot.playgroundPython} starter={'import numpy as np\nprint("numpy", np.__version__)\nprint("Hello World")\n'} compact={false} />
      )}
      {mode === 'js' && <CodeLab storageKey={codeSlot.playgroundJs} lang="js" starter={'const squares = [1,2,3].map(n => n ** 2);\nconsole.log(squares);\n'} />}
      {mode === 'html' && (
        <div className="grid2">
          <div>
            <div className="small muted">HTML / CSS</div>
            <textarea className="editor" style={{ minHeight: 260 }} value={html} onChange={(e) => setHtml(e.target.value)} />
            <button className="btn small" style={{ marginTop: 6 }} onClick={() => setState((s) => ({ ...s, savedCode: { ...s.savedCode, [codeSlot.playgroundHtml]: html } }))}>💾 Save</button>
          </div>
          <div>
            <div className="small muted">LIVE PREVIEW</div>
            <iframe
              title="HTML preview"
              sandbox=""
              srcDoc={html}
              style={{ width: '100%', minHeight: 260, border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }}
            />
          </div>
        </div>
      )}
      {mode === 'sql' && (
        <div>
          <div className="row small muted" style={{ marginBottom: 6 }}>
            Tables: {DATASETS.map((d) => <span key={d.name} className="chip">{d.name}</span>)}
          </div>
          <textarea className="editor" value={sqlQ} onChange={(e) => setSqlQ(e.target.value)} rows={6} />
          <button className="btn primary" style={{ margin: '8px 0' }} onClick={runSql}>▶ Run query</button>
          {res && (
            <div className="tablewrap">
              {res.error ? (
                <pre className="codeblock" style={{ color: 'var(--red)' }}>{res.error}</pre>
              ) : res.rows?.length ? (
                <table className="data">
                  <thead><tr>{res.columns.map((c: string) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>{res.rows.map((r: string[], i: number) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody>
                </table>
              ) : (
                <p className="small muted">0 rows.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
