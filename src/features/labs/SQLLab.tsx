import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HubCrumb } from '../../components/learning/SectionChrome';
import { runSQL } from '../coding/runners';
import { DATASETS, seedForSQL } from '../../core/data/datasets';
import { useSqlMasterclass, type SqlDebug, type SqlLab } from '../../core/data/sqlmasterclass';
import { sqliteSchema, moduleRun } from '../../core/learning/sql-setup';
import { gradeSqlResult, isGradeableSql, type SqlGrade } from '../../core/learning/sql-exercise';
import { masterclassHref, masterclassSelection, type MasterclassBank, type MasterclassLevel } from '../../core/learning/masterclass';
import { useStore, setState } from '../../core/storage/store';
import { codeSlot } from '../../core/platform/keys';
import { SqlMasterclass } from './SqlMasterclass';

/** Same Monaco editor the Playground and lessons use — one editor experience app-wide. */
const MonacoIDE = lazy(() => import('../../components/code/MonacoIDE').then((m) => ({ default: m.MonacoIDE })));
type IdeError = import('../../components/code/MonacoIDE').IdeError;

const EXAMPLES = [
  { title: 'SELECT + WHERE', q: 'SELECT name, marks FROM students WHERE marks > 80;' },
  { title: 'GROUP BY + HAVING', q: 'SELECT city, COUNT(*) AS n, AVG(marks) AS avg_marks FROM students GROUP BY city HAVING COUNT(*) > 2;' },
  { title: 'INNER JOIN', q: 'SELECT c.name, o.product, o.qty FROM customers c INNER JOIN sales o ON c.id = o.customer_id;' },
  { title: 'ORDER BY + LIMIT', q: 'SELECT name, salary FROM employees ORDER BY salary DESC LIMIT 3;' },
  { title: 'Subquery', q: 'SELECT name FROM students WHERE marks = (SELECT MAX(marks) FROM students);' },
  { title: 'CTE', q: 'WITH top AS (SELECT * FROM employees WHERE salary > 80000) SELECT name, salary FROM top;' },
  { title: 'Window function', q: 'SELECT name, dept, salary, RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS rk FROM employees;' },
];

/** The Lab's demo tables; a run that provides its own table by the same name skips its seed. */
const DEMO_TABLES = DATASETS.map((dataset) => dataset.name);
const seedsFor = (shadowed: readonly string[]) =>
  DATASETS.filter((dataset) => !shadowed.includes(dataset.name)).map(seedForSQL);

export default function SQLLab() {
  const state = useStore();
  const [params, setParams] = useSearchParams();
  /**
   * `?module=sql13&bank=logic` is how a Masterclass module brings its schema here: the panel links to
   * it and `module.setup` is what the authored examples assume, so without it the first Run answers
   * "no such table". The artifact is already fetched by the panel on this page (one cached load).
   */
  const sqlFile = useSqlMasterclass();
  const selection = masterclassSelection(params, sqlFile?.modules ?? []);
  const module = selection.moduleId ? sqlFile?.modules.find((m) => m.id === selection.moduleId) ?? null : null;
  /** `?bank=labs|debug&item=2` opens one authored exercise, with the module's setup applied. */
  const exerciseBank = selection.bank === 'labs' || selection.bank === 'debug' ? selection.bank : null;
  const exercises = exerciseBank && module ? module.banks[exerciseBank] : [];
  const exercise = exerciseBank && module && selection.exercise !== undefined
    ? exercises[selection.exercise] as SqlLab | SqlDebug | undefined
    : undefined;
  /** What a correct answer must return: the authored solution, graded by its result, not its text. */
  const referenceSql = exercise
    ? exerciseBank === 'labs' ? (exercise as SqlLab).solution : (exercise as SqlDebug).fix
    : '';
  /** Functional update: one click can change two parts (a chip opens its module and resets the bank). */
  const select = (next: { moduleId?: string; bank?: MasterclassBank; level?: MasterclassLevel }) =>
    setParams((current) => masterclassHref(current, next), { replace: true });
  /** No module, no module schema: the plain Lab keeps its demo datasets. */
  const schema = useMemo(
    () => sqliteSchema(
      module ? [...(sqlFile?.course.schema ?? []), ...(module.setup ?? [])] : [],
      DEMO_TABLES,
    ),
    [sqlFile, module],
  );
  const [q, setQ] = useState(state.savedCode[codeSlot.sqlLab] ?? EXAMPLES[0].q);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  /** Running is a real state: without it a double-click ran the query twice and nothing said "wait". */
  const [busy, setBusy] = useState(false);
  const [grade, setGrade] = useState<SqlGrade | null>(null);
  /** Set only when the reference cannot run here, so showing it is the one honest fallback. */
  const [revealReference, setRevealReference] = useState(false);
  /** Only fill the editor from the module while the learner has not started writing. */
  const edited = useRef(false);
  const filledExample = useRef<string | null>(null);
  /** The example a link named (`?module=sql13&example=t04`), else the module's first one. */
  const linkedExample = selection.topicId
    ? module?.topics.find((topic) => topic.id === selection.topicId)
    : undefined;
  const exampleSql = (linkedExample ?? module?.topics[0])?.example.sql;
  useEffect(() => {
    if (!module || exercise) return;
    const key = `${module.id}:${selection.topicId ?? ''}`;
    if (filledExample.current === key) return;
    filledExample.current = key;
    // A link to one example is a request for that example, so it wins over an edit in progress;
    // a plain module link still leaves the learner's own query alone.
    if (edited.current && !selection.topicId) return;
    if (exampleSql) setQ(exampleSql);
  }, [module, selection.topicId, exampleSql, exercise]);
  /** Opening an exercise is a request for THAT exercise: a debug item starts from its broken query. */
  const filledExercise = useRef<string | null>(null);
  useEffect(() => {
    if (!module || !exerciseBank || !exercise) return;
    const key = `${module.id}:${exerciseBank}:${selection.exercise}`;
    if (filledExercise.current === key) return;
    filledExercise.current = key;
    edited.current = true;
    setGrade(null);
    setQ(exerciseBank === 'debug' ? (exercise as SqlDebug).broken : `-- ${exercise.title}\n`);
  }, [module, exercise, exerciseBank, selection.exercise]);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null); setRes(null);
    try {
      const { sql, shadowed } = moduleRun(schema, q);
      const r = await runSQL(sql, seedsFor(shadowed));
      if (r.error) setErr(r.error); else setRes(r);
      setState((s) => ({ ...s, savedCode: { ...s.savedCode, [codeSlot.sqlLab]: q } }));
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };
  const save = () => setState((s) => ({ ...s, savedCode: { ...s.savedCode, [codeSlot.sqlLab]: q } }));

  /**
   * Grade by RESULT: run the learner's SQL and the authored solution on the same schema and compare
   * the result sets. The solution's text is never shown, so a right answer in different phrasing counts.
   */
  const checkAnswer = async () => {
    if (busy || !exercise || !referenceSql) return;
    setBusy(true);
    setErr(null); setRes(null); setGrade(null); setRevealReference(false);
    try {
      const { sql, shadowed } = moduleRun(schema, q);
      const mine = await runSQL(sql, seedsFor(shadowed));
      if (!mine.ok) { setErr(mine.error ?? 'Your query did not run.'); return; }
      const referenceRun = moduleRun(schema, referenceSql);
      const reference = await runSQL(referenceRun.sql, seedsFor(referenceRun.shadowed));
      if (!reference.ok) {
        // A PostgreSQL-only reference cannot be graded by this SQLite engine — say that, not "wrong".
        setErr(`This exercise can’t be graded here: its reference solution does not run on SQLite (${reference.error}).`);
        setRevealReference(true);
        return;
      }
      setRes(mine);
      setGrade(gradeSqlResult(mine, reference));
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

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
            <Link to={`/course/sql?module=${module.id}&bank=${selection.bank ?? 'learn'}&level=${selection.level ?? 'simple'}`} className="small">
              Back to the course →
            </Link>
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

      {exercise && module && (
        <div className="card" style={{ margin: '10px 0' }} data-exercise={exerciseBank}>
          <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="chip easy">{exerciseBank === 'labs' ? 'Lab' : 'Debug'} · {exercise.title}</span>
            <Link to={`/course/sql?module=${module.id}&bank=${exerciseBank}&level=${selection.level ?? 'simple'}`} className="small">
              Back to the course →
            </Link>
          </div>
          <p className="small" style={{ margin: '6px 0 0' }}>
            {exerciseBank === 'labs' ? (exercise as SqlLab).task : (exercise as SqlDebug).error}
          </p>
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {isGradeableSql(referenceSql) ? (
              <>
                <button className="btn small primary" onClick={checkAnswer} disabled={busy}>Check answer</button>
                <span className="small muted">Runs your SQL and the authored solution on this module’s schema, then compares the results.</span>
              </>
            ) : (
              <span className="small muted">
                This item’s reference is a statement rather than a query, so it is not graded by result — run it here to try it.
              </span>
            )}
          </div>
          {grade && (
            <p className="small" role="status" style={{ margin: '8px 0 0', color: grade.ok ? 'var(--green, #2e7d32)' : 'var(--red)' }}>
              {grade.ok
                ? `Correct — ${grade.rows} row${grade.rows === 1 ? '' : 's'} match the reference.`
                : `Not yet — ${grade.reason}.`}
            </p>
          )}
          {revealReference && (
            <details style={{ marginTop: 8 }}>
              <summary className="small" style={{ cursor: 'pointer' }}>Reference solution and expected output</summary>
              <pre className="codeblock" style={{ margin: '4px 0 0' }}>{referenceSql}</pre>
              <p className="small muted" style={{ margin: '6px 0 0' }}><b>Expected:</b> {exercise.expected}</p>
            </details>
          )}
        </div>
      )}

      <SqlMasterclass
        moduleId={selection.moduleId}
        bank={selection.bank}
        level={selection.level}
        onModuleChange={(moduleId) => select({ moduleId })}
        onBankChange={(bank) => select({ bank })}
        onLevelChange={(level) => select({ level })}
      />

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
