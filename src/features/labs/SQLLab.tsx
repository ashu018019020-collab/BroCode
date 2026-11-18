import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HubCrumb } from '../../components/learning/SectionChrome';
import { runSQL } from '../coding/runners';
import { DATASETS, seedForSQL } from '../../core/data/datasets';
import { useSqlMasterclass } from '../../core/data/sqlmasterclass';
import { sqliteSchema, withModuleSchema } from '../../core/learning/sql-setup';
import { useStore, setState } from '../../core/storage/store';
import { codeSlot } from '../../core/platform/keys';
import { parseTraceback } from '../../core/platform/traceback';
import { SqlMasterclass } from './SqlMasterclass';

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
  const [params] = useSearchParams();
  /**
   * `?module=sql13` is how a Masterclass module brings its schema here: the panel links to it and
   * `module.setup` is what the authored examples assume, so without it the first Run answers
   * "no such table". The artifact is already fetched by the panel on this page (one cached load).
   */
  const sqlFile = useSqlMasterclass();
  const moduleId = params.get('module');
  const module = moduleId ? sqlFile?.modules.find((m) => m.id === moduleId) ?? null : null;
  const schema = useMemo(() => sqliteSchema(module?.setup, DATASETS.map((d) => d.name)), [module]);
  const [q, setQ] = useState(state.savedCode[codeSlot.sqlLab] ?? EXAMPLES[0].q);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  /** Running is a real state: without it a double-click ran the query twice and nothing said "wait". */
  const [busy, setBusy] = useState(false);
  /** Only fill the editor from the module while the learner has not started writing. */
  const edited = useRef(false);
  const filledModule = useRef<string | null>(null);
  useEffect(() => {
    if (!module || filledModule.current === module.id) return;
    filledModule.current = module.id;
    if (edited.current) return;
    const first = module.topics[0]?.example.sql;
    if (first) setQ(first);
  }, [module]);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null); setRes(null);
    try {
      const r = await runSQL(withModuleSchema(schema, q), DATASETS.map(seedForSQL));
      if (r.error) setErr(r.error); else setRes(r);
      setState((s) => ({ ...s, savedCode: { ...s.savedCode, [codeSlot.sqlLab]: q } }));
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
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
      <HubCrumb hub="/labs" hubLabel="Labs" page="SQL Lab" />
      <h1>🗄️ SQL Lab</h1>
      <p className="muted small">SQLite (WASM) running locally — SELECT, WHERE, GROUP BY, JOIN, HAVING, subqueries, CTEs and window functions.</p>

      {module && (
        <div className="card" style={{ margin: '10px 0' }}>
          <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="chip easy">Module {String(module.no).padStart(2, '0')} · {module.title}</span>
              {schema.statements.length > 0 ? (
                <span className="small muted">
                  {schema.statements.length} schema statement{schema.statements.length === 1 ? '' : 's'} run before every query
                </span>
              ) : (
                <span className="small muted">This module adds no schema — the demo tables below are enough.</span>
              )}
              {schema.skipped.length > 0 && (
                <span className="chip hard">
                  {schema.skipped.length} PostgreSQL-only statement{schema.skipped.length === 1 ? '' : 's'} skipped
                </span>
              )}
            </span>
            <Link to="/course/sql" className="small">Back to the course →</Link>
          </div>
          {schema.adapted.length > 0 && (
            <p className="small muted" style={{ margin: '6px 0 0' }}>
              The module's schema is written for PostgreSQL; {schema.adapted.length === 1 ? 'one statement was' : `${schema.adapted.length} statements were`}{' '}
              adapted so SQLite can create the same tables.
            </p>
          )}
          {schema.skipped.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary className="small muted" style={{ cursor: 'pointer' }}>What could not run here</summary>
              <ul className="small muted" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {schema.skipped.map((item) => (
                  <li key={item.statement}><code>{item.statement}</code> — {item.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <SqlMasterclass />

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
          <button key={e.title} className="stagepill" onClick={() => { edited.current = true; setQ(e.q); }}>{e.title}</button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <Suspense fallback={<div className="editor loading" style={{ height: 220 }}>Loading editor…</div>}>
          <MonacoIDE
            value={q}
            language="sql"
            onChange={(value) => { edited.current = true; setQ(value); }}
            onRun={run}
            onSave={save}
            errors={markers}
            height={220}
          />
        </Suspense>
      </div>
      <button className="btn primary" style={{ margin: '8px 0' }} onClick={run} disabled={busy} aria-busy={busy}>
        {busy ? 'Running…' : '▶ Run query'} {!busy && <span className="kbd">Ctrl+↵</span>}
      </button>

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
