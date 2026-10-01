import { lazy, Suspense, useState } from 'react';
import { runSQL } from '../coding/runners';
import { DATASETS, seedForSQL } from '../../core/data/datasets';
import { useStore, setState } from '../../core/storage/store';
import { codeSlot } from '../../core/platform/keys';
import { parseTraceback } from '../../core/platform/traceback';

/** Same Monaco editor the Playground and lessons use — one editor experience app-wide. */
const MonacoIDE = lazy(() => import('../../components/code/MonacoIDE').then((m) => ({ default: m.MonacoIDE })));
type IdeError = import('../../components/code/MonacoIDE').IdeError;

const EXAMPLES = [
  { title: 'SELECT + WHERE', q: 'SELECT name, marks FROM students WHERE marks > 80;' },
  { title: 'GROUP BY + HAVING', q: 'SELECT city, COUNT(*) AS n, AVG(marks) AS avg_marks FROM students GROUP BY city HAVING COUNT(*) > 2;' },
  { title: 'INNER JOIN', q: 'SELECT c.name, o.product, o.qty FROM customers c INNER JOIN sales o ON c.id = o.order_id;' },
  { title: 'ORDER BY + LIMIT', q: 'SELECT name, salary FROM employees ORDER BY salary DESC LIMIT 3;' },
  { title: 'Subquery', q: 'SELECT name FROM students WHERE marks = (SELECT MAX(marks) FROM students);' },
  { title: 'CTE', q: 'WITH top AS (SELECT * FROM employees WHERE salary > 80000) SELECT name, salary FROM top;' },
  { title: 'Window function', q: 'SELECT name, dept, salary, RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS rk FROM employees;' },
];

export default function SQLLab() {
  const state = useStore();
  const [q, setQ] = useState(state.savedCode[codeSlot.sqlLab] ?? EXAMPLES[0].q);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setErr(null); setRes(null);
    const r = await runSQL(q, DATASETS.map(seedForSQL));
    if (r.error) setErr(r.error); else setRes(r);
    setState((s) => ({ ...s, savedCode: { ...s.savedCode, [codeSlot.sqlLab]: q } }));
  };
  const save = () => setState((s) => ({ ...s, savedCode: { ...s.savedCode, [codeSlot.sqlLab]: q } }));

  // Squiggle the failing token's line straight from the SQLite error message.
  const sqlErrLine = (() => {
    if (!err) return null;
    const m = err.match(/line (\d+)/i) ?? err.match(/near \"[^\"]*\"[^\n]*\n([^\n]*)/);
    return m ? parseInt(m[1], 10) : null;
  })();
  const markers: IdeError[] = sqlErrLine ? [{ line: sqlErrLine, message: err!, severity: 'error' }] : [];

  return (
    <div>
      <h1>🗄️ SQL Lab</h1>
      <p className="muted small">SQLite (WASM) running locally — SELECT, WHERE, GROUP BY, JOIN, HAVING, subqueries, CTEs and window functions, no internet.</p>

      <div className="grid2" style={{ margin: '12px 0' }}>
        {DATASETS.map((d) => (
          <div key={d.name} className="card" style={{ margin: 0 }}>
            <b className="small">{d.name}</b> <span className="muted small">— {d.desc}</span>
            <div className="tablewrap" style={{ marginTop: 6 }}>
              <table className="data">
                <thead><tr>{d.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{d.rows.slice(0, 3).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{String(v)}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <p className="small muted" style={{ marginTop: 4 }}>{d.rows.length} rows total</p>
          </div>
        ))}
      </div>

      <div className="row" style={{ margin: '10px 0' }}>
        {EXAMPLES.map((e) => (
          <button key={e.title} className="stagepill" onClick={() => setQ(e.q)}>{e.title}</button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <Suspense fallback={<div className="editor loading" style={{ height: 220 }}>Loading editor…</div>}>
          <MonacoIDE
            value={q}
            language="sql"
            onChange={setQ}
            onRun={run}
            onSave={save}
            errors={markers}
            height={220}
          />
        </Suspense>
      </div>
      <button className="btn primary" style={{ margin: '8px 0' }} onClick={run}>▶ Run query <span className="kbd">Ctrl+↵</span></button>

      {err && <pre className="codeblock" style={{ color: 'var(--red)' }}>{err}</pre>}
      {res && (
        <div className="tablewrap">
          <div className="small muted" style={{ marginBottom: 4 }}>{res.output}</div>
          {res.rows.length > 0 ? (
            <table className="data">
              <thead><tr>{res.columns.map((c: string, i: number) => <th key={i}>{c}</th>)}</tr></thead>
              <tbody>{res.rows.map((r: string[], i: number) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody>
            </table>
          ) : <p className="small muted">0 rows returned.</p>}
        </div>
      )}
    </div>
  );
}
