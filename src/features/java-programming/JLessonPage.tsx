import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Bug, CheckCircle2, FlaskConical, Lightbulb, ListChecks, Play } from 'lucide-react';
import { useJAssessments, useJCourse, useJLabs } from '../../core/data/jcourse';
import { addXp, recordAttempt, useStore } from '../../core/storage/store';
import { checkpointKey, quizScore, testKey, wrongIndexes } from '../../core/learning/jcourse';
import JNotebook from './JNotebook';

export default function JLessonPage() {
  const { moduleId } = useParams<{ moduleId: string }>();
  const data = useJCourse();
  const sets = useJAssessments();
  const labs = useJLabs();
  const store = useStore();
  const [params] = useSearchParams();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [testAnswers, setTestAnswers] = useState<Record<number, number>>({});
  const [testSubmitted, setTestSubmitted] = useState(false);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [injected, setInjected] = useState<{ code: string; id: number } | null>(null);

  const module = data?.modules.find((m) => m.id === moduleId) ?? null;
  const position = data && module ? data.modules.findIndex((m) => m.id === module.id) : -1;
  const prev = data && position > 0 ? data.modules[position - 1] : null;
  const next = data && position >= 0 ? data.modules[position + 1] ?? null : null;
  const set = useMemo(() => sets.find((s) => s.module === moduleId) ?? null, [sets, moduleId]);
  const activeLab = labs.find((l) => l.id === params.get('lab') && l.module === moduleId) ?? null;
  const done = store.attempts[checkpointKey(moduleId ?? '')]?.done === true;
  const score = useMemo(() => quizScore(module?.mcqs ?? [], answers), [module, answers]);
  const testScore = useMemo(() => quizScore(set?.questions ?? [], testAnswers), [set, testAnswers]);

  if (!data) return <div className="card"><div className="skeleton" style={{ height: 100 }} /><div className="skeleton" style={{ height: 500, marginTop: 12 }} /></div>;
  if (!module) {
    return (
      <div className="card">
        <h2>Module not found</h2>
        <p className="muted small">That id is not part of the Java Programming course.</p>
        <Link className="btn small primary" to="/java">Back to the course</Link>
      </div>
    );
  }

  const notebookLab = activeLab ?? {
    ...module.lab, id: `lab-${module.id}`, module: module.id,
    objective: module.goal, level: module.level, category: 'module', xp: 20,
  };

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
  const TryBlock = ({ code }: { code: string }) => (
    <div className="c-code j-code">
      <pre style={{ background: '#0b0b0b', borderRadius: 10, padding: 12, overflow: 'auto', fontSize: 12, margin: 0 }}><code>{code}</code></pre>
      <button type="button" className="btn small c-code-try" onClick={() => setInjected({ code, id: Date.now() })}>
        <Play size={11} /> Try this code
      </button>
    </div>
  );

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <Link className="btn small" to="/java?tab=curriculum"><ArrowLeft size={13} /> Java Programming</Link>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="chip small">Module {String(module.no).padStart(2, '0')} · {module.level} · {module.hours}h</span>
          <Link className="btn small" to="/java?tab=coding"><ListChecks size={12} /> Coding bank</Link>
          {set && <Link className="btn small" to={`/java/${module.id}?tab=test`}>Module test</Link>}
        </div>
      </div>

      {params.get('tab') === 'test' && set && (
        <div className="card glow" style={{ marginBottom: 14 }}>
          <h2 style={{ marginTop: 0 }}>{set.title}</h2>
          <p className="muted small">{set.questions.length} MCQs · explanations after submission</p>
          {set.questions.map((question, i) => (
            <div key={question.q} style={{ marginBottom: 14 }}>
              <strong className="small">{i + 1}. {question.q}</strong>
              <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                {question.options.map((opt, oi) => {
                  const chosen = testAnswers[i] === oi;
                  const correct = testSubmitted && oi === question.answer;
                  const wrong = testSubmitted && chosen && oi !== question.answer;
                  return (
                    <label key={opt} className="small" style={{ padding: '6px 8px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${correct ? '#22c55e' : wrong ? '#ef4444' : 'rgba(255,255,255,.1)'}` }}>
                      <input type="radio" name={`t${i}`} checked={chosen} onChange={() => setTestAnswers((a) => ({ ...a, [i]: oi }))} disabled={testSubmitted} /> {opt}
                      {correct && ' ✓'}{wrong && ' ✗'}
                    </label>
                  );
                })}
              </div>
              {testSubmitted && <p className="muted small" style={{ margin: '6px 0 0' }}>{question.explain}</p>}
            </div>
          ))}
          {!testSubmitted
            ? <button className="btn small primary" onClick={submitTest} disabled={Object.keys(testAnswers).length !== set.questions.length}>Submit test</button>
            : <div className="row" style={{ gap: 8 }}><span className="chip small">{testScore.correct}/{testScore.total} · {testScore.pct}%</span><button className="btn small" onClick={() => { setTestAnswers({}); setTestSubmitted(false); }}>Retry</button></div>}
        </div>
      )}

      <div className="card glow fadeup tone-amber">
        <div className="chip" style={{ marginBottom: 6 }}>Learning objective</div>
        <h1 style={{ margin: 0 }}>{module.title}</h1>
        <p className="muted small" style={{ margin: '8px 0 0' }}>{module.goal}</p>
        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <span className="chip small">{module.level}</span>
          <span className="chip small">{module.hours}h</span>
          <span className="chip small">{module.objectives.length} objectives</span>
          {done && <span className="chip small"><CheckCircle2 size={11} /> checkpoint complete</span>}
        </div>
      </div>

      <div className="c-split">
        <aside className="c-split-left">
          <div>
            <div className="row spread" style={{ marginBottom: 8, gap: 8 }}>
              <strong className="small">Code Bro · {notebookLab.title}</strong>
              <span className="chip small">JDK 17 · no sign-in</span>
            </div>
            <JNotebook
              key={module.id}
              source={injected}
              height={360}
              initialSource={notebookLab.starter}
              lab={notebookLab}
              storageKey={`brocode:j-lab:${module.id}`}
            />
          </div>
        </aside>

        <div className="c-split-right">
          <section className="card">
            <h2 style={{ marginTop: 0 }}>1 · Objectives and prerequisites</h2>
            <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>{module.objectives.map((o) => <li key={o}>{o}</li>)}</ul>
            <h3>2 · Prerequisites</h3>
            <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>{module.prereqs.map((p) => <li key={p}>{p}</li>)}</ul>
            <h3>3 · Definition</h3>
            <p className="small">{module.definition}</p>
            <h3>4 · Easy English explanation</h3>
            {module.explain.map((p) => <p key={p} className="small" style={{ marginTop: 0 }}>{p}</p>)}
            <h3>5 · Hinglish explanation</h3>
            {module.hinglish.map((p) => <p key={p} className="small" style={{ marginTop: 0 }}>{p}</p>)}
            <h3>6 · Real-life analogy</h3>
            <p className="small">{module.analogy}</p>
            <h3>7 · Why this matters</h3>
            <p className="small" style={{ marginBottom: 0 }}>{module.why}</p>
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>8 · Syntax and rules</h3>
            {module.syntax.map((s) => (
              <div key={s.code} style={{ marginBottom: 12 }}>
                <TryBlock code={s.code} />
                <p className="muted small" style={{ margin: 0 }}>{s.note}</p>
              </div>
            ))}
            <h3>9 · Every important subtopic</h3>
            {module.topics.map((t) => (
              <div key={t.title} style={{ marginBottom: 14 }}>
                <strong className="small">{t.title}</strong>
                <p className="small" style={{ margin: '4px 0' }}>{t.body}</p>
                {t.code && <TryBlock code={t.code} />}
                {t.memory?.length ? <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>{t.memory.map((m) => <li key={m}>{m}</li>)}</ul> : null}
              </div>
            ))}
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>10 · Code examples, simple to advanced</h3>
            {module.examples.map((ex) => (
              <div key={ex.title} style={{ marginBottom: 18 }}>
                <div className="row spread"><strong className="small">{ex.title}</strong><span className="chip small">{ex.level}</span></div>
                <TryBlock code={ex.code} />
                <strong className="small">Actual output</strong>
                <pre style={{ background: '#0b0b0b', borderRadius: 10, padding: 10, overflow: 'auto', fontSize: 12 }}><code>{ex.output}</code></pre>
                <strong className="small">Line by line</strong>
                <ul className="muted small" style={{ margin: '4px 0', paddingLeft: 18 }}>{ex.lines.map((l) => <li key={l}>{l}</li>)}</ul>
                {ex.dryRun?.length ? <><strong className="small">Dry run</strong><ol className="muted small" style={{ margin: '4px 0', paddingLeft: 18 }}>{ex.dryRun.map((d) => <li key={d}>{d}</li>)}</ol></> : null}
              </div>
            ))}
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>11 · Common mistakes and notes</h3>
            {module.mistakes.map((m) => (
              <div key={m.wrong} style={{ marginBottom: 10 }}>
                <div className="small" style={{ color: '#fca5a5' }}>✗ {m.wrong}</div>
                <div className="small" style={{ color: '#86efac' }}>✓ {m.right}</div>
                <div className="muted small">{m.why}</div>
              </div>
            ))}
            <h3><Bug size={14} /> 12 · Debugging exercise</h3>
            <p className="small">{module.debug.brief}</p>
            <TryBlock code={module.debug.code} />
            <p className="muted small">Expected: {module.debug.expected}</p>
            <details>
              <summary className="small" style={{ cursor: 'pointer' }}>Hints and fix</summary>
              <ul className="muted small">{module.debug.hints.map((h) => <li key={h}>{h}</li>)}</ul>
              <TryBlock code={module.debug.fix} />
            </details>
            <h3>13 · Best practices</h3>
            <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>{module.best.map((b) => <li key={b}>{b}</li>)}</ul>
            <h3><Lightbulb size={14} /> Interview tip</h3>
            <p className="small">{module.tip}</p>
            <h3>Revision notes</h3>
            <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>{module.revision.map((r) => <li key={r}>{r}</li>)}</ul>
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>14 · Practice questions</h3>
            {module.practice.map((p, i) => (
              <div key={p.title} style={{ marginBottom: 10 }}>
                <strong className="small">{i + 1}. {p.title}</strong> <span className="chip small">{p.level}</span>
                <p className="small" style={{ margin: '4px 0' }}>{p.prompt}</p>
                <details><summary className="muted small" style={{ cursor: 'pointer' }}>Hint</summary><p className="muted small" style={{ margin: 0 }}>{p.hint}</p></details>
              </div>
            ))}
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>15 · Knowledge check</h3>
            {module.mcqs.map((question, i) => (
              <div key={question.q} style={{ marginBottom: 12 }}>
                <strong className="small">{i + 1}. {question.q}</strong>
                <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                  {question.options.map((opt, oi) => {
                    const chosen = answers[i] === oi;
                    const correct = submitted && oi === question.answer;
                    const wrong = submitted && chosen && oi !== question.answer;
                    return (
                      <label key={opt} className="small" style={{ padding: '6px 8px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${correct ? '#22c55e' : wrong ? '#ef4444' : 'rgba(255,255,255,.1)'}` }}>
                        <input type="radio" name={`q${i}`} checked={chosen} onChange={() => setAnswers((a) => ({ ...a, [i]: oi }))} disabled={submitted} /> {opt}
                        {correct && ' ✓'}{wrong && ' ✗'}
                      </label>
                    );
                  })}
                </div>
                {submitted && <p className="muted small" style={{ margin: '6px 0 0' }}>{question.explain}</p>}
              </div>
            ))}
            {submitted
              ? <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span className="chip small">{score.correct}/{score.total} · {score.pct}%</span>
                  <button className="btn small" onClick={() => { setAnswers({}); setSubmitted(false); }}>Retry quiz</button>
                  {wrongIndexes(module.mcqs, answers).length > 0 && <span className="muted small">{wrongIndexes(module.mcqs, answers).length} to review</span>}
                </div>
              : <button className="btn small primary" onClick={submitQuiz} disabled={Object.keys(answers).length !== module.mcqs.length}>Submit quiz ({module.mcqs.length})</button>}
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>16 · Interview questions with answers</h3>
            {module.interview.map((item) => (
              <details key={item.q} style={{ marginBottom: 8 }}>
                <summary className="small" style={{ cursor: 'pointer' }}>{item.q}</summary>
                <p className="small" style={{ margin: '6px 0 0' }}>{item.a}</p>
                {item.followUp && <p className="muted small" style={{ margin: 0 }}>Follow-up: {item.followUp}</p>}
              </details>
            ))}
          </section>

          <section>
            <h3 style={{ margin: 0, marginBottom: 8 }}><FlaskConical size={15} /> 17 · Lab assignment{activeLab ? ` · ${activeLab.title}` : ''}</h3>
            <p className="muted small" style={{ marginTop: 0 }}>{notebookLab.brief}</p>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '6px 0 10px' }}>
              {notebookLab.tests.map((t) => <span key={t.name} className="chip small">{t.name}</span>)}
              <span className="chip small">expected {JSON.stringify(notebookLab.expected)}</span>
            </div>
            {notebookLab.hints.length > 0 && <ul className="muted small" style={{ margin: '0 0 8px', paddingLeft: 18 }}>{notebookLab.hints.map((h) => <li key={h}>{h}</li>)}</ul>}
            <TryBlock code={notebookLab.starter} />
            <details className="card" style={{ marginTop: 10 }}>
              <summary className="small" style={{ cursor: 'pointer' }}>Solution (open after you have tried)</summary>
              <TryBlock code={notebookLab.solution} />
            </details>
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>18 · Topic completion checkpoint</h3>
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
              {done && next && <Link className="btn small" to={`/java/${next.id}`}>Next: {next.title} <ArrowRight size={13} /></Link>}
            </div>
          </section>
        </div>
      </div>

      <div className="row spread" style={{ marginTop: 14, gap: 8 }}>
        {prev ? <Link className="btn small" to={`/java/${prev.id}`}><ArrowLeft size={13} /> {prev.title}</Link> : <span />}
        {next ? <Link className="btn small primary" to={`/java/${next.id}`}>{next.title} <ArrowRight size={13} /></Link> : <span className="chip small">Course complete</span>}
      </div>
    </div>
  );
}
