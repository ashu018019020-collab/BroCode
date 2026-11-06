import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Briefcase, Bug, CheckCircle2, FlaskConical, Lightbulb, ListChecks, Play, Sparkles, X } from 'lucide-react';
import { useCAssessments, useCCourse, useCLabs } from '../../core/data/ccourse';
import { AssistantCard } from '../../components/shared/AssistantCard';
import { addXp, recordAttempt, useStore } from '../../core/storage/store';
import { checkpointKey, quizScore, testKey, wrongIndexes } from '../../core/learning/ccourse';
import { ASSISTANT_MODULE_KEY } from '../../core/platform/keys';
import CNotebook from './CNotebook';

export default function CLessonPage() {
  const { moduleId } = useParams<{ moduleId: string }>();
  const data = useCCourse();
  const sets = useCAssessments();
  const store = useStore();
  const [params] = useSearchParams();
  const location = useLocation();
  const labs = useCLabs();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [testAnswers, setTestAnswers] = useState<Record<number, number>>({});
  const [testSubmitted, setTestSubmitted] = useState(false);
  const [tryCode, setTryCode] = useState<{ code: string; id: number; module: string } | null>(null);
  const tryId = useRef(0);
  const leftRef = useRef<HTMLElement | null>(null);
  /** The mentor is a sheet opened from the header, not a second card in the page. */
  const [ask, setAsk] = useState(false);
  /** The module the sheet is about: this one, or the one last asked about. */
  const [askModuleId, setAskModuleId] = useState<string | null>(null);
  /** A starter question handed to the card; the nonce lets the same text be asked twice. */
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(null);
  const seedId = useRef(0);
  /** Device-local memory of the module the mentor was last asked about. */
  const [lastAsked, setLastAsked] = useState<string | null>(() => {
    try { return localStorage.getItem(ASSISTANT_MODULE_KEY); } catch { return null; }
  });

  // Escape closes it, like every other dialog on the site.
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAsk(false); setSeed(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ask]);

  const module = data?.modules.find((m) => m.id === moduleId) ?? null;
  const position = data && module ? data.modules.findIndex((m) => m.id === module.id) : -1;
  const prev = data && position > 0 ? data.modules[position - 1] : null;
  const next = data && position >= 0 ? data.modules[position + 1] ?? null : null;
  const set = useMemo(() => sets.find((s) => s.module === moduleId) ?? null, [sets, moduleId]);
  const done = store.attempts[checkpointKey(moduleId ?? '')]?.done === true;
  const score = useMemo(() => quizScore(module?.mcqs ?? [], answers), [module, answers]);
  const testScore = useMemo(() => quizScore(set?.questions ?? [], testAnswers), [set, testAnswers]);
  // A lab card can deep-link its own starter (`?lab=`) and its solution (`&try=solution`), while a
  // project card hands its starter over in router state. Both land in the same pinned notebook.
  const labId = params.get('lab');
  const activeLab = labs.find((l) => l.id === labId && l.module === module?.id) ?? null;
  const handoff = (location.state as { tryCode?: string } | null)?.tryCode ?? null;
  const wants = params.get('try');
  const seeded = useMemo(() => {
    // Only an explicit Try click seeds code: opening a lab for reference must never overwrite the
    // draft a learner already has saved for that module.
    const picked = activeLab && (wants === 'starter' || wants === 'solution')
      ? (wants === 'solution' ? activeLab.solution : activeLab.starter)
      : null;
    const code = handoff ?? picked;
    return code ? { code, id: 1 } : null;
  }, [handoff, activeLab, wants]);
  const injected = (tryCode && tryCode.module === module?.id ? tryCode : null) ?? seeded;
  const askModule = module ? (data?.modules.find((m) => m.id === (askModuleId ?? module.id)) ?? module) : null;
  const remembered = lastAsked && data ? data.modules.find((m) => m.id === lastAsked) ?? null : null;
  /**
   * Starter questions from THIS module's own authored material — its first topic, its first classic
   * mistake, its lab and its interview set — so the sheet opens with something worth asking instead
   * of an empty box. They are prompts: clicking one asks the mentor.
   */
  const starters = useMemo(() => {
    if (!askModule) return [];
    const topic = askModule.topics[0]?.title;
    const wrong = askModule.mistakes[0]?.wrong;
    return [
      topic
        ? `Explain "${topic}" from ${askModule.title} with a small C example`
        : `Explain the main idea of ${askModule.title} with a small C example`,
      wrong ? `Why is this wrong in C: ${wrong}` : `What is the most common mistake in ${askModule.title}?`,
      `Give me a hint for the lab: ${askModule.lab.title}`,
      `Ask me one interview question on ${askModule.title} and judge my answer`,
    ];
  }, [askModule]);

  if (!data) return <div className="card"><div className="skeleton" style={{ height: 100 }} /><div className="skeleton" style={{ height: 500, marginTop: 12 }} /></div>;
  if (!module) return <div className="card"><h2>Module not found</h2><p className="muted small">That id is not part of the C Programming course.</p><Link className="btn small primary" to="/c-programming">Back to the course</Link></div>;

  /** Asking from a chip records the module, so the next sheet remembers where the conversation was. */
  const askStarter = (text: string) => {
    const id = (askModule ?? module).id;
    try { localStorage.setItem(ASSISTANT_MODULE_KEY, id); } catch { /* storage can be blocked */ }
    setLastAsked(id);
    seedId.current += 1;
    setSeed({ text, nonce: seedId.current });
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
  const notebookLab = activeLab ?? { ...module.lab, id: `lab-${module.id}`, module: module.id, objective: module.goal, level: module.level, category: 'module', xp: 20 };
  const sendToNotebook = (code: string) => {
    tryId.current += 1;
    setTryCode({ code, id: tryId.current, module: module.id });
    leftRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const TryBlock = ({ code }: { code: string }) => (
    <div className="c-code">
      <pre style={{ background: '#0b0b0b', borderRadius: 10, padding: 12, overflow: 'auto', fontSize: 12, margin: 0 }}><code>{code}</code></pre>
      <button type="button" className="btn small c-code-try" onClick={() => sendToNotebook(code)}><Play size={11} /> Try this code</button>
    </div>
  );
  const finish = () => {
    if (!module.checkpoint.checks.every((_, i) => checked[i])) return;
    if (!done) { recordAttempt(checkpointKey(module.id), { done: true, score: 100 }); addXp(30); }
  };

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <Link className="btn small" to="/c-programming?tab=curriculum"><ArrowLeft size={13} /> C Programming</Link>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="chip small">Module {String(module.no).padStart(2, '0')} · {module.level} · {module.hours}h</span>
          <Link className="btn small" to="/c-programming?tab=practice"><ListChecks size={12} /> Practice</Link>
          <Link className="btn small" to="/c-programming?tab=career"><Briefcase size={12} /> Career</Link>
          <button
            className="btn small c-ask"
            onClick={() => { setAskModuleId(null); setSeed(null); setAsk(true); }}
            aria-haspopup="dialog"
          >
            <Sparkles size={12} /> Ask AI
          </button>
        </div>
      </div>

      {/* The mentor, for THIS module: the sheet passes the module id as the section and names it in
          the context strip, so answers are about the code on screen instead of the whole course. */}
      {ask && (
        <div
          className="ai-sheet-back"
          onClick={(e) => { if (e.target === e.currentTarget) { setAsk(false); setSeed(null); } }}
        >
          <div
            className="ai-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`Ask the mentor about ${(askModule ?? module).title}`}
          >
            <div className="row spread ai-sheet-head">
              <span className="row small">
                <Sparkles size={13} /> Mentor · Module {String((askModule ?? module).no).padStart(2, '0')} · {(askModule ?? module).title}
              </span>
              <button className="btn small" onClick={() => { setAsk(false); setSeed(null); }}>
                <X size={12} /> Close
              </button>
            </div>

            {/* The sheet remembers the module last asked about, so a new sitting can pick that
                conversation back up instead of starting from whatever module is on screen. */}
            {remembered && askModule && remembered.id !== askModule.id && (
              <div className="row ai-sheet-mem" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className="small muted">Last asked about</span>
                <button className="btn small" onClick={() => { setAskModuleId(remembered.id); setSeed(null); }}>
                  Module {String(remembered.no).padStart(2, '0')} · {remembered.title}
                </button>
              </div>
            )}
            {remembered && askModule && remembered.id === askModule.id && askModule.id !== module.id && (
              <div className="row ai-sheet-mem" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className="small muted">Continuing that conversation ·</span>
                <button className="btn small" onClick={() => { setAskModuleId(null); setSeed(null); }}>
                  This module · {module.title}
                </button>
              </div>
            )}

            <div className="ai-starters">
              <span className="small muted">Ask about this module:</span>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {starters.map((s) => (
                  <button key={s} className="btn small" onClick={() => askStarter(s)}>{s}</button>
                ))}
              </div>
            </div>

            <AssistantCard
              embedded
              seed={seed ?? undefined}
              context={{
                sectionId: (askModule ?? module).id,
                where: `Module ${String((askModule ?? module).no).padStart(2, '0')} · ${(askModule ?? module).title}`,
              }}
            />
          </div>
        </div>
      )}

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

      <div className="c-split">
        <aside className="c-split-left" ref={leftRef}>
          <div>
            <div className="row spread" style={{ marginBottom: 8, gap: 8 }}>
              <strong className="small">Coding notebook · {notebookLab.title}</strong>
              <span className="chip small">C17 · GCC · no sign-in</span>
            </div>
            <CNotebook
              key={module.id}
              source={injected}
              height={360}
              initialSource={notebookLab.starter}
              lab={notebookLab}
              storageKey={`brocode:c-lab:${module.id}`}
            />
          </div>
        </aside>
        <div className="c-split-right">
<section className="card">
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

      <section className="card">
        <h3 style={{ marginTop: 0 }}>6 · Syntax and rules</h3>
        {module.syntax.map((s) => (
          <div key={s.code} style={{ marginBottom: 12 }}>
            <TryBlock code={s.code} />
            <p className="muted small" style={{ margin: 0 }}>{s.note}</p>
          </div>
        ))}
        <h3>7 · Every important subtopic</h3>
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
        <h3 style={{ marginTop: 0 }}>8 · Code examples, simple → advanced</h3>
        {module.examples.map((ex) => (
          <div key={ex.title} style={{ marginBottom: 18 }}>
            <div className="row spread"><strong className="small">{ex.title}</strong><span className="chip small">{ex.level}</span></div>
            <TryBlock code={ex.code} />
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

      <section className="card">
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
        <TryBlock code={module.debug.code} />
        <p className="muted small">Expected: {module.debug.expected}</p>
        <details><summary className="small" style={{ cursor: 'pointer' }}>Hints and fix</summary>
          <ul className="muted small">{module.debug.hints.map((h) => <li key={h}>{h}</li>)}</ul>
          <TryBlock code={module.debug.fix} />
        </details>
        <h3><Lightbulb size={14} /> 11 · Best practices</h3>
        <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>{module.best.map((b) => <li key={b}>{b}</li>)}</ul>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>12 · Practice questions</h3>
        {module.practice.map((p, i) => (
          <div key={p.title} style={{ marginBottom: 10 }}>
            <strong className="small">{i + 1}. {p.title}</strong> <span className="chip small">{p.level}</span>
            <p className="small" style={{ margin: '4px 0' }}>{p.prompt}</p>
            <details><summary className="muted small" style={{ cursor: 'pointer' }}>Hint</summary><p className="muted small" style={{ margin: 0 }}>{p.hint}</p></details>
          </div>
        ))}
      </section>

      <section className="card">
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

      <section className="card">
        <h3 style={{ marginTop: 0 }}>14 · Interview questions with answers</h3>
        {module.interview.map((q) => (
          <details key={q.q} style={{ marginBottom: 8 }}>
            <summary className="small" style={{ cursor: 'pointer' }}>{q.q}</summary>
            <p className="small" style={{ margin: '6px 0 0' }}>{q.a}</p>
            {q.followUp && <p className="muted small" style={{ margin: 0 }}>Follow-up: {q.followUp}</p>}
          </details>
        ))}
      </section>

      <section>
        <h3 style={{ margin: 0, marginBottom: 8 }}><FlaskConical size={15} /> 15 · Lab assignment{activeLab ? ` · ${activeLab.title}` : ''}</h3>
        <p className="muted small" style={{ marginTop: 0 }}>{notebookLab.brief}</p>
        <p className="muted small">The notebook is pinned beside this lesson — it opens with this lab's starter, stdin and public tests.</p>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '6px 0 10px' }}>
          {notebookLab.tests.map((t) => <span key={t.name} className="chip small">{t.name}</span>)}
          <span className="chip small">expected {JSON.stringify(notebookLab.expected)}</span>
        </div>
        {notebookLab.hints.length > 0 && <ul className="muted small" style={{ margin: '0 0 8px', paddingLeft: 18 }}>{notebookLab.hints.map((h) => <li key={h}>{h}</li>)}</ul>}
        <TryBlock code={notebookLab.starter} />
        <details className="card" style={{ marginTop: 10 }}><summary className="small" style={{ cursor: 'pointer' }}>Solution (open after you have tried)</summary>
          <TryBlock code={notebookLab.solution} />
        </details>
      </section>

      <section className="card">
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

        </div>
      </div>

      <div className="row spread" style={{ marginTop: 14, gap: 8 }}>
        {prev ? <Link className="btn small" to={`/c-programming/${prev.id}`}><ArrowLeft size={13} /> {prev.title}</Link> : <span />}
        {next ? <Link className="btn small primary" to={`/c-programming/${next.id}`}>{next.title} <ArrowRight size={13} /></Link> : <span className="chip small">Course complete</span>}
      </div>
    </div>
  );
}
