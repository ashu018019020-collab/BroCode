import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Bug, CheckCircle2, FlaskConical, Lightbulb } from 'lucide-react';
import { useCAssessments, useCCourse } from '../../core/data/ccourse';
import { addXp, recordAttempt, useStore } from '../../core/storage/store';
import { checkpointKey, quizScore, testKey, wrongIndexes } from '../../core/learning/ccourse';
import CNotebook from './CNotebook';

export default function CLessonPage() {
  const { moduleId } = useParams<{ moduleId: string }>();
  const data = useCCourse();
  const sets = useCAssessments();
  const store = useStore();
  const [params] = useSearchParams();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [testAnswers, setTestAnswers] = useState<Record<number, number>>({});
  const [testSubmitted, setTestSubmitted] = useState(false);

  const module = data?.modules.find((m) => m.id === moduleId) ?? null;
  const position = data && module ? data.modules.findIndex((m) => m.id === module.id) : -1;
  const prev = data && position > 0 ? data.modules[position - 1] : null;
  const next = data && position >= 0 ? data.modules[position + 1] ?? null : null;
  const set = useMemo(() => sets.find((s) => s.module === moduleId) ?? null, [sets, moduleId]);
  const done = store.attempts[checkpointKey(moduleId ?? '')]?.done === true;
  const score = useMemo(() => quizScore(module?.mcqs ?? [], answers), [module, answers]);
  const testScore = useMemo(() => quizScore(set?.questions ?? [], testAnswers), [set, testAnswers]);

  if (!data) return <div className="card"><div className="skeleton" style={{ height: 100 }} /><div className="skeleton" style={{ height: 500, marginTop: 12 }} /></div>;
  if (!module) return <div className="card"><h2>Module not found</h2><p className="muted small">That id is not part of the C Programming course.</p><Link className="btn small primary" to="/c-programming">Back to the course</Link></div>;

  const submitQuiz = () => {
    const result = quizScore(module.mcqs, answers);
    recordAttempt(testKey(module.id), { score: result.pct, done: true });
    if (result.pct >= 60) addXp(15);
    setSubmitted(true);
  };
  const submitTest = () => {
    recordAttempt(`${checkpointKey(module.id)}:assessment`, { score: testScore.pct, done: true });
    if (testScore.pct >= 60) addXp(20);
    setTestSubmitted(true);
  };
  const finish = () => {
    if (!module.checkpoint.checks.every((_, i) => checked[i])) return;
    if (!done) { recordAttempt(checkpointKey(module.id), { done: true, score: 100 }); addXp(30); }
  };

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <Link className="btn small" to="/c-programming?tab=curriculum"><ArrowLeft size={13} /> C Programming</Link>
        <span className="chip small">Module {String(module.no).padStart(2, '0')} · {module.level} · {module.hours}h</span>
        <Link className="btn small" to={`/c-programming/${module.id}?tab=notebook`}><FlaskConical size={13} /> Notebook</Link>
      </div>

      {params.get('tab') === 'test' && set && (
        <div className="card glow" style={{ marginBottom: 14 }}>
          <h2 style={{ marginTop: 0 }}>{set.title}</h2>
          <p className="muted small">Module test · {set.questions.length} MCQs · explanations after submission</p>
          {set.questions.map((q, i) => (
            <div key={q.q} style={{ marginBottom: 14 }}>
              <strong className="small">{i + 1}. {q.q}</strong>
              <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                {q.options.map((opt, oi) => {
                  const chosen = testAnswers[i] === oi;
                  const correct = testSubmitted && oi === q.answer;
                  const wrong = testSubmitted && chosen && oi !== q.answer;
                  return (
                    <label key={opt} className="small" style={{ padding: '6px 8px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${correct ? '#22c55e' : wrong ? '#ef4444' : 'rgba(255,255,255,.1)'}` }}>
                      <input type="radio" name={`t${i}`} checked={chosen} onChange={() => setTestAnswers((a) => ({ ...a, [i]: oi }))} disabled={testSubmitted} /> {opt}
                      {correct && ' ✓'}{wrong && ' ✗'}
                    </label>
                  );
                })}
              </div>
              {testSubmitted && <p className="muted small" style={{ margin: '6px 0 0' }}>{q.explain}</p>}
            </div>
          ))}
          {!testSubmitted
            ? <button className="btn small primary" onClick={submitTest} disabled={Object.keys(testAnswers).length !== set.questions.length}>Submit test</button>
            : <div className="row" style={{ gap: 8 }}><span className="chip small">{testScore.correct}/{testScore.total} · {testScore.pct}%</span><button className="btn small" onClick={() => { setTestAnswers({}); setTestSubmitted(false); }}>Retry</button></div>}
        </div>
      )}

      <div className="card glow fadeup tone-cyan">
        <div className="chip" style={{ marginBottom: 6 }}>Learning objective</div>
        <h1 style={{ margin: 0 }}>{module.title}</h1>
        <p className="muted small" style={{ margin: '8px 0 0' }}>{module.goal}</p>
        {done && <span className="chip small" style={{ marginTop: 8 }}><CheckCircle2 size={11} /> checkpoint complete</span>}
      </div>

      <section className="card" style={{ marginTop: 12 }}>
        <h2 style={{ marginTop: 0 }}>1 · Prerequisites</h2>
        <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>{module.prereqs.map((p) => <li key={p}>{p}</li>)}</ul>
        <h3>2 · Definition</h3>
        <p className="small">{module.definition}</p>
        <h3>3 · Easy Hinglish explanation</h3>
        {module.explain.map((p) => <p key={p} className="small" style={{ marginTop: 0 }}>{p}</p>)}
        <h3>4 · Real-life analogy</h3>
        <p className="small">{module.analogy}</p>
        <h3>5 · Why this matters</h3>
        <p className="small" style={{ marginBottom: 0 }}>{module.why}</p>
      </section>

      <section className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>6 · Syntax and rules</h3>
        {module.syntax.map((s) => (
          <div key={s.code} style={{ marginBottom: 12 }}>
            <pre style={{ background: '#0b0b0b', borderRadius: 10, padding: 12, overflow: 'auto', fontSize: 12 }}><code>{s.code}</code></pre>
            <p className="muted small" style={{ margin: 0 }}>{s.note}</p>
          </div>
        ))}
        <h3>7 · Every important subtopic</h3>
        {module.topics.map((t) => (
          <div key={t.title} style={{ marginBottom: 14 }}>
            <strong className="small">{t.title}</strong>
            <p className="small" style={{ margin: '4px 0' }}>{t.body}</p>
            {t.code && <pre style={{ background: '#0b0b0b', borderRadius: 10, padding: 12, overflow: 'auto', fontSize: 12 }}><code>{t.code}</code></pre>}
            {t.memory?.length ? <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>{t.memory.map((m) => <li key={m}>{m}</li>)}</ul> : null}
          </div>
        ))}
      </section>

      <section className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>8 · Code examples, simple → advanced</h3>
        {module.examples.map((ex) => (
          <div key={ex.title} style={{ marginBottom: 18 }}>
            <div className="row spread"><strong className="small">{ex.title}</strong><span className="chip small">{ex.level}</span></div>
            <pre style={{ background: '#0b0b0b', borderRadius: 10, padding: 12, overflow: 'auto', fontSize: 12 }}><code>{ex.code}</code></pre>
            <strong className="small">Actual output</strong>
            <pre style={{ background: '#0b0b0b', borderRadius: 10, padding: 10, overflow: 'auto', fontSize: 12 }}><code>{ex.output}</code></pre>
            <strong className="small">Line by line</strong>
            <ul className="muted small" style={{ margin: '4px 0', paddingLeft: 18 }}>{ex.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            {ex.dryRun?.length ? <><strong className="small">Dry run</strong><ol className="muted small" style={{ margin: '4px 0', paddingLeft: 18 }}>{ex.dryRun.map((d) => <li key={d}>{d}</li>)}</ol></> : null}
            {ex.memory?.length ? <><strong className="small">Memory</strong><ul className="muted small" style={{ margin: '4px 0', paddingLeft: 18 }}>{ex.memory.map((d) => <li key={d}>{d}</li>)}</ul></> : null}
          </div>
        ))}
        {module.visual && (
          <div style={{ marginTop: 10 }}>
            <h3>{module.visual.title}</h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="small" style={{ borderCollapse: 'collapse', width: '100%' }}>
                <tbody>
                  {module.visual.rows.map((row, i) => (
                    <tr key={row}>{row.split('|').map((cell, ci) => (
                      <td key={ci} style={{ border: '1px solid rgba(255,255,255,.1)', padding: '6px 8px', fontFamily: i === 0 ? 'inherit' : 'monospace', fontWeight: i === 0 ? 700 : 400 }}>{cell.trim()}</td>
                    ))}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>9 · Common mistakes</h3>
        {module.mistakes.map((m) => (
          <div key={m.wrong} style={{ marginBottom: 10 }}>
            <div className="small" style={{ color: '#fca5a5' }}>✗ {m.wrong}</div>
            <div className="small" style={{ color: '#86efac' }}>✓ {m.right}</div>
            <div className="muted small">{m.why}</div>
          </div>
        ))}
        <h3><Bug size={14} /> 10 · Debugging exercise</h3>
        <p className="small">{module.debug.brief}</p>
        <pre style={{ background: '#0b0b0b', borderRadius: 10, padding: 12, overflow: 'auto', fontSize: 12 }}><code>{module.debug.code}</code></pre>
        <p className="muted small">Expected: {module.debug.expected}</p>
        <details><summary className="small" style={{ cursor: 'pointer' }}>Hints and fix</summary>
          <ul className="muted small">{module.debug.hints.map((h) => <li key={h}>{h}</li>)}</ul>
          <pre style={{ background: '#0b0b0b', borderRadius: 10, padding: 12, overflow: 'auto', fontSize: 12 }}><code>{module.debug.fix}</code></pre>
        </details>
        <h3><Lightbulb size={14} /> 11 · Best practices</h3>
        <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>{module.best.map((b) => <li key={b}>{b}</li>)}</ul>
      </section>

      <section className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>12 · Practice questions</h3>
        {module.practice.map((p, i) => (
          <div key={p.title} style={{ marginBottom: 10 }}>
            <strong className="small">{i + 1}. {p.title}</strong> <span className="chip small">{p.level}</span>
            <p className="small" style={{ margin: '4px 0' }}>{p.prompt}</p>
            <details><summary className="muted small" style={{ cursor: 'pointer' }}>Hint</summary><p className="muted small" style={{ margin: 0 }}>{p.hint}</p></details>
          </div>
        ))}
      </section>

      <section className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>13 · Quiz and MCQs</h3>
        {module.mcqs.map((q, i) => (
          <div key={q.q} style={{ marginBottom: 12 }}>
            <strong className="small">{i + 1}. {q.q}</strong>
            <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
              {q.options.map((opt, oi) => {
                const chosen = answers[i] === oi;
                const correct = submitted && oi === q.answer;
                const wrong = submitted && chosen && oi !== q.answer;
                return (
                  <label key={opt} className="small" style={{ padding: '6px 8px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${correct ? '#22c55e' : wrong ? '#ef4444' : 'rgba(255,255,255,.1)'}` }}>
                    <input type="radio" name={`q${i}`} checked={chosen} onChange={() => setAnswers((a) => ({ ...a, [i]: oi }))} disabled={submitted} /> {opt}
                    {correct && ' ✓'}{wrong && ' ✗'}
                  </label>
                );
              })}
            </div>
            {submitted && <p className="muted small" style={{ margin: '6px 0 0' }}>{q.explain}</p>}
          </div>
        ))}
        {submitted
          ? <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><span className="chip small">{score.correct}/{score.total} · {score.pct}%</span><button className="btn small" onClick={() => { setAnswers({}); setSubmitted(false); }}>Retry quiz</button>
            {wrongIndexes(module.mcqs, answers).length > 0 && <span className="muted small">{wrongIndexes(module.mcqs, answers).length} to review</span>}</div>
          : <button className="btn small primary" onClick={submitQuiz} disabled={Object.keys(answers).length !== module.mcqs.length}>Submit quiz ({module.mcqs.length})</button>}
        {set && <p className="muted small" style={{ marginBottom: 0 }}>Module test also available: <Link to={`/c-programming/${module.id}?tab=test`}>{set.title}</Link>.</p>}
      </section>

      <section className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>14 · Interview questions with answers</h3>
        {module.interview.map((q) => (
          <details key={q.q} style={{ marginBottom: 8 }}>
            <summary className="small" style={{ cursor: 'pointer' }}>{q.q}</summary>
            <p className="small" style={{ margin: '6px 0 0' }}>{q.a}</p>
            {q.followUp && <p className="muted small" style={{ margin: 0 }}>Follow-up: {q.followUp}</p>}
          </details>
        ))}
      </section>

      <section style={{ marginTop: 12 }}>
        <h3 style={{ margin: 0, marginBottom: 8 }}><FlaskConical size={15} /> 15 · Lab assignment</h3>
        <p className="muted small" style={{ marginTop: 0 }}>{module.lab.brief}</p>
        <CNotebook key={module.id} initialSource={module.lab.starter} lab={{ ...module.lab, id: `lab-${module.id}`, module: module.id, objective: module.goal, level: module.level, category: 'module', xp: 20 }} storageKey={`brocode:c-lab:${module.id}`} />
        <details className="card" style={{ marginTop: 10 }}><summary className="small" style={{ cursor: 'pointer' }}>Solution (open after you have tried)</summary>
          <pre style={{ background: '#0b0b0b', borderRadius: 10, padding: 12, overflow: 'auto', fontSize: 12 }}><code>{module.lab.solution}</code></pre>
        </details>
      </section>

      <section className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>16 · Topic completion checkpoint</h3>
        <p className="muted small">{module.checkpoint.title}</p>
        {module.checkpoint.checks.map((c, i) => (
          <label key={c} className="small" style={{ display: 'block', marginBottom: 4 }}>
            <input type="checkbox" checked={!!checked[i]} onChange={(e) => setChecked((p) => ({ ...p, [i]: e.target.checked }))} disabled={done} /> {c}
          </label>
        ))}
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn small primary" onClick={finish} disabled={done || !module.checkpoint.checks.every((_, i) => checked[i])}>
            <CheckCircle2 size={13} /> {done ? 'Checkpoint complete' : 'Mark module complete (+30 XP)'}
          </button>
          {done && next && <Link className="btn small" to={`/c-programming/${next.id}`}>Next: {next.title} <ArrowRight size={13} /></Link>}
        </div>
      </section>

      <div className="row spread" style={{ marginTop: 14, gap: 8 }}>
        {prev ? <Link className="btn small" to={`/c-programming/${prev.id}`}><ArrowLeft size={13} /> {prev.title}</Link> : <span />}
        {next ? <Link className="btn small primary" to={`/c-programming/${next.id}`}>{next.title} <ArrowRight size={13} /></Link> : <span className="chip small">Course complete</span>}
      </div>
    </div>
  );
}
