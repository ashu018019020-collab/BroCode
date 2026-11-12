import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, BookOpen, Bug, CheckCircle2, ChevronRight, FlaskConical, Lightbulb,
  ListChecks, Play, Target,
} from 'lucide-react';
import {
  useJAssessments, useJCoding, useJCourse, useJDebugging, useJInterview, useJLabs, useJProjects,
} from '../../core/data/jcourse';
import { addXp, bumpStreak, newNote, recordAttempt, upsertNote, useStore } from '../../core/storage/store';
import {
  checkpointKey, codingTally, debugTally, jQuizKey, jQuizTally, jStageKey, quizScore,
  submissionScore, testKey, wrongIndexes,
} from '../../core/learning/jcourse';
import { STAGES, STAGE_META, type Stage } from '../../core/learning/progress';
import { SectionHero, StageGrid, UtilityStrip, LessonCoach, type HeroStat } from '../../components/learning/SectionChrome';
import JNotebook from './JNotebook';
import type { JLab, JMcq } from '../../core/learning/jcourse';

function TryBlock({ code, onTry }: { code: string; onTry: (code: string) => void }) {
  return (
    <div className="c-code j-code">
      <pre><code>{code}</code></pre>
      <button type="button" className="btn small c-code-try" onClick={() => onTry(code)}>
        <Play size={11} /> Try this code
      </button>
    </div>
  );
}

function StagePlan({ rows, onGo }: {
  rows: { label: string; hint: string; stage: Stage | null; minutes: string; now: boolean }[];
  onGo: (stage: Stage | null) => void;
}) {
  if (!rows.length) return null;
  return (
    <div className="plan" role="region" aria-label="Plan ahead">
      <div className="row spread">
        <span className="row" style={{ gap: 7 }}>
          <b className="small">🧭 Plan ahead</b>
          <span className="small muted">— the next real step, from your own records</span>
        </span>
        <span className="small muted">{rows.length} steps</span>
      </div>
      <div className="plan-rows">
        {rows.map((row, i) => (
          <button
            key={`${row.label}-${i}`}
            className={`plan-row${row.now ? ' now' : ''}${row.stage === null ? ' exit' : ''}`}
            onClick={() => onGo(row.stage)}
            aria-label={`${row.now ? 'Now' : i + 1}: ${row.label}. ${row.hint}`}
          >
            <span className="plan-no">{row.stage === null ? '➜' : row.now ? 'NOW' : i + 1}</span>
            <span className="plan-glyph" aria-hidden="true">{row.stage ? STAGE_META[row.stage].label.slice(0, 1) : '→'}</span>
            <span className="plan-body"><b>{row.label}</b><span className="plan-hint">{row.hint}</span></span>
            <span className="plan-min muted small">{row.minutes}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function JLessonPage() {
  const { moduleId } = useParams<{ moduleId: string }>();
  const data = useJCourse();
  const sets = useJAssessments();
  const labs = useJLabs();
  const coding = useJCoding();
  const debugging = useJDebugging();
  const interviewBank = useJInterview();
  const projects = useJProjects();
  const store = useStore();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();

  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [testAnswers, setTestAnswers] = useState<Record<number, number>>({});
  const [testSubmitted, setTestSubmitted] = useState(false);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [injected, setInjected] = useState<{ code: string; id: number } | null>(null);
  const [codingSel, setCodingSel] = useState(0);
  const [debugSel, setDebugSel] = useState(0);
  const [projectSel, setProjectSel] = useState(0);
  const [panel, setPanel] = useState<'notes' | 'resources' | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const module = data?.modules.find((m) => m.id === moduleId) ?? null;
  const modules = data?.modules ?? [];
  const position = module ? modules.findIndex((m) => m.id === module.id) : -1;
  const prev = position > 0 ? modules[position - 1] : null;
  const next = position >= 0 ? modules[position + 1] ?? null : null;
  const set = sets.find((s) => s.module === moduleId) ?? null;
  const activeLab = labs.find((l) => l.id === params.get('lab') && l.module === moduleId) ?? null;

  const stageParam = params.get('stage');
  const stage: Stage = STAGES.includes(stageParam as Stage)
    ? (stageParam as Stage)
    : params.get('tab') === 'test' ? 'checkpoint' : params.get('lab') ? 'mini' : 'learn';

  const quizAnswers = module?.mcqs ?? [];
  const testQuestions = set?.questions ?? [];
  const score = useMemo(() => quizScore(quizAnswers, answers), [quizAnswers, answers]);
  const testScore = useMemo(() => quizScore(testQuestions, testAnswers), [testQuestions, testAnswers]);

  const codingMine = useMemo(() => coding.filter((q) => q.module === moduleId), [coding, moduleId]);
  const debugMine = useMemo(() => debugging.filter((c) => c.module === moduleId), [debugging, moduleId]);
  const projectsMine = useMemo(() => projects.filter((p) => p.module === moduleId), [projects, moduleId]);
  const interviewMine = useMemo(() => interviewBank.filter((q) => q.module === moduleId), [interviewBank, moduleId]);

  useEffect(() => {
    setCodingSel(0); setDebugSel(0); setProjectSel(0);
    setAnswers({}); setSubmitted(false); setTestAnswers({}); setTestSubmitted(false); setChecked({});
  }, [moduleId]);

  const note = module ? store.notes.find((n) => n.section === module.id && n.tags.includes('java')) : undefined;
  useEffect(() => { setNoteDraft(note?.body ?? ''); }, [note?.id, moduleId]);

  if (!data) return <div className="card"><div className="skeleton" style={{ height: 110 }} /><div className="skeleton" style={{ height: 520, marginTop: 12 }} /></div>;
  if (!module) {
    return (
      <div className="card">
        <h2>Module not found</h2>
        <p className="muted small">That id is not part of the Java Programming course.</p>
        <Link className="btn small primary" to="/java">Back to the course</Link>
      </div>
    );
  }

  const codingStats = codingTally(store.attempts, codingMine);
  const debugStats = debugTally(store.attempts, debugMine);
  const quiz = jQuizTally(store.attempts, module.id, module.mcqs.length);
  const testPct = store.attempts[testKey(module.id)]?.score ?? 0;
  const complete = store.attempts[checkpointKey(module.id)]?.done === true;
  const labDone = store.attempts[`jlab:${module.id}`]?.done === true;
  const selfDone = (s: Stage) => store.attempts[jStageKey(module.id, s)]?.done === true;

  const codingLab = (q: (typeof codingMine)[number] | undefined): JLab | null => q ? {
    id: q.id, module: q.module, title: q.title, brief: q.statement, objective: q.statement,
    level: q.level, category: 'coding', starter: q.starter, expected: q.output,
    tests: q.tests.map((t, i) => ({ name: t.name || `Test ${i + 1}`, stdin: t.input ?? '', stdout: t.output })),
    hints: q.hints, solution: q.solution, xp: 30,
  } : null;

  const activeCoding = codingMine[Math.min(codingSel, Math.max(0, codingMine.length - 1))];
  const activeDebug = debugMine[Math.min(debugSel, Math.max(0, debugMine.length - 1))];
  const activeProject = projectsMine[Math.min(projectSel, Math.max(0, projectsMine.length - 1))];

  const counts: Record<Stage, number> = {
    learn: module.topics.length + module.examples.length,
    interview: module.interview.length + interviewMine.length,
    coding: codingMine.length,
    logic: module.mcqs.length,
    debug: debugMine.length || (module.debug ? 1 : 0),
    solved: module.practice.length,
    mini: 1,
    project: projectsMine.length,
    defense: module.checkpoint.checks.length,
    checkpoint: module.mcqs.length + testQuestions.length,
  };

  const done: Record<Stage, boolean> = {
    learn: selfDone('learn'),
    interview: selfDone('interview'),
    coding: codingMine.length > 0 && codingStats.solved === codingMine.length,
    logic: quiz.total > 0 && quiz.answered === quiz.total,
    debug: debugMine.length > 0 ? debugStats.fixed === debugMine.length : selfDone('debug'),
    solved: selfDone('solved'),
    mini: labDone,
    project: selfDone('project'),
    defense: selfDone('defense') || complete,
    checkpoint: complete,
  };

  const pct: Record<Stage, number> = {
    learn: done.learn ? 100 : 0,
    interview: done.interview ? 100 : 0,
    coding: codingStats.pct ?? 0,
    logic: quiz.pct ?? 0,
    debug: debugMine.length ? (debugStats.pct ?? 0) : done.debug ? 100 : 0,
    solved: done.solved ? 100 : 0,
    mini: done.mini ? 100 : 0,
    project: done.project ? 100 : 0,
    defense: done.defense ? 100 : 0,
    checkpoint: complete ? 100 : testPct,
  };
  const mastery = Math.round(STAGES.reduce((sum, s) => sum + pct[s], 0) / STAGES.length);
  const heroStatus: 'done' | 'progress' | 'new' = complete ? 'done' : mastery > 0 ? 'progress' : 'new';

  const totalQs = module.topics.length + module.examples.length + module.mcqs.length
    + module.interview.length + interviewMine.length + codingMine.length + module.practice.length + debugMine.length;
  const heroStats: HeroStat[] = [
    { n: module.topics.length + module.examples.length, l: 'Learn Q&A', tone: 'cyan', Icon: BookOpen },
    { n: module.interview.length + interviewMine.length, l: 'Interview Qs', tone: 'green', Icon: Target },
    { n: codingMine.length, l: 'Coding Lab', tone: 'violet', Icon: ListChecks },
    { n: module.practice.length, l: 'Practice', tone: 'amber', Icon: FlaskConical },
    { n: totalQs, l: 'Q&A Total', tone: 'blue', Icon: CheckCircle2 },
  ];

  const setStage = (s: Stage) => setParams(s === 'learn' ? {} : { stage: s });
  const markStudied = (s: Stage) => {
    if (selfDone(s)) return;
    recordAttempt(jStageKey(module.id, s), { done: true, score: 100 });
    addXp(5);
  };
  const tryCode = (code: string) => {
    setInjected({ code, id: Date.now() });
    if (stage !== 'learn') setStage('learn');
  };

  const submitQuiz = () => {
    module.mcqs.forEach((q, i) => recordAttempt(jQuizKey(module.id, i), { done: answers[i] === q.answer }));
    recordAttempt(testKey(module.id), { score: score.pct, done: true });
    if (score.pct >= 60) addXp(15);
    setSubmitted(true);
  };
  const submitTest = () => {
    // The checkpoint reads `testKey`; the assessment key keeps the same score for the course page.
    recordAttempt(testKey(module.id), { score: testScore.pct, done: true });
    recordAttempt(`${checkpointKey(module.id)}:assessment`, { score: testScore.pct, done: true });
    if (testScore.pct >= 60) addXp(20);
    setTestSubmitted(true);
  };
  const finish = () => {
    if (!module.checkpoint.checks.every((_, i) => checked[i])) return;
    if (!complete) { recordAttempt(checkpointKey(module.id), { done: true, score: 100 }); addXp(30); bumpStreak(); }
  };
  const saveNote = () => {
    if (note) upsertNote({ ...note, body: noteDraft });
    else upsertNote(newNote({ title: `${module.title} — notes`, body: noteDraft, tags: ['java'], section: module.id }));
    setPanel(null);
  };

  const interviewItems = (() => {
    const seen = new Set<string>();
    const rows: { q: string; a: string; followUp?: string }[] = [];
    for (const item of [...module.interview, ...interviewMine]) {
      if (seen.has(item.q)) continue;
      seen.add(item.q);
      rows.push({ q: item.q, a: item.a, followUp: 'followUp' in item ? item.followUp : undefined });
    }
    return rows;
  })();

  const undone = STAGES.filter((s) => !done[s]);
  const planRows: { label: string; hint: string; stage: Stage | null; minutes: string; now: boolean }[] = undone.slice(0, 3).map((s, i) => ({
    label: STAGE_META[s].label,
    hint: STAGE_META[s].blurb,
    stage: s,
    minutes: `~${Math.max(5, Math.round((35 + module.topics.length * 4) / 10))} min`,
    now: i === 0,
  }));
  if (!undone.length && next) {
    planRows.push({ label: next.title, hint: 'Next module — your checkpoint is complete.', stage: null, minutes: `${next.hours}h`, now: true });
  }
  const nbaStage = undone[0];
  const nba = nbaStage
    ? { label: STAGE_META[nbaStage].label, reason: STAGE_META[nbaStage].blurb, route: `/java/${module.id}?stage=${nbaStage}` }
    : next
      ? { label: `Next: ${next.title}`, reason: 'This module is complete — continue the course.', route: `/java/${next.id}` }
      : { label: 'Course complete', reason: 'Every Java module is complete.', route: '/java' };

  const codingSolved = (id: string) => store.attempts[`jcoding:${id}`]?.done === true;
  const debugFixed = (id: string) => store.attempts[`jdebug:${id}`]?.done === true;

  return (
    <div className="j-workspace">
      <SectionHero
        no={String(module.no).padStart(2, '0')}
        title={module.title}
        subtitle={module.goal}
        pct={mastery}
        minutes={35 + module.topics.length * 4}
        status={heroStatus}
        stats={heroStats}
        backLabel="Java Programming"
        onBack={() => nav('/java')}
        glyph={BookOpen}
      />
      <StageGrid
        active={stage}
        isDone={(s) => done[s]}
        pctOf={(s) => pct[s]}
        countOf={(s) => counts[s]}
        onPick={setStage}
      />
      <StagePlan rows={planRows} onGo={(s) => { if (s) setStage(s); else if (next) nav(`/java/${next.id}`); }} />
      <UtilityStrip />
      <LessonCoach sectionId={module.id} sectionTitle={module.title} nba={nba} onStart={(route) => nav(route)} />

      <div className="j-topic-tools">
        <button type="button" className={`btn small${panel === 'notes' ? ' primary' : ''}`} onClick={() => setPanel(panel === 'notes' ? null : 'notes')}>Notes</button>
        <button type="button" className={`btn small${panel === 'resources' ? ' primary' : ''}`} onClick={() => setPanel(panel === 'resources' ? null : 'resources')}>Resources</button>
        <span className="muted small">Topic {module.no} · {module.level} · {module.hours}h · {mastery}% mastery</span>
        <Link className="btn small" to="/java?tab=coding"><ListChecks size={12} /> Coding bank</Link>
      </div>

      {panel === 'notes' && (
        <div className="card j-note-panel">
          <div className="row spread"><strong>Notes — {module.title}</strong><span className="muted small">Saved in your BroCode notes</span></div>
          <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Write your own explanation, a mistake to remember, or an interview line…" />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn small primary" onClick={saveNote}>Save note</button>
            <button className="btn small" onClick={() => setPanel(null)}>Close</button>
          </div>
        </div>
      )}
      {panel === 'resources' && (
        <div className="card j-note-panel">
          <strong>Resources for this topic</strong>
          <ul className="small" style={{ margin: '6px 0', paddingLeft: 18, lineHeight: 1.7 }}>
            <li><a href="https://dev.java/learn/" target="_blank" rel="noreferrer">dev.java — official Java tutorials</a></li>
            <li><a href="https://docs.oracle.com/en/java/javase/21/docs/api/" target="_blank" rel="noreferrer">Java 21 API documentation</a></li>
            <li><a href="https://docs.oracle.com/javase/tutorial/java/nutsandbolts/" target="_blank" rel="noreferrer">Java language basics</a></li>
            <li>This module has {module.examples.length} runnable examples, {module.syntax.length} syntax patterns and {module.topics.length} topics.</li>
          </ul>
          <button className="btn small" onClick={() => setPanel(null)}>Close</button>
        </div>
      )}

      {stage === 'learn' && (
        <div className="j-topic-grid">
          <div className="j-topic-main">
            <section className="card">
              <h2 style={{ marginTop: 0 }}>Definition and explanation</h2>
              <p className="small"><b>Definition:</b> {module.definition}</p>
              {module.explain.map((p) => <p key={p} className="small">{p}</p>)}
              <h3>Hinglish</h3>
              {module.hinglish.map((p) => <p key={p} className="small">{p}</p>)}
              <h3>Real-life analogy</h3>
              <p className="small">{module.analogy}</p>
              <h3>Why this matters</h3>
              <p className="small" style={{ marginBottom: 0 }}>{module.why}</p>
            </section>

            <section className="card">
              <h3 style={{ marginTop: 0 }}>Syntax and rules</h3>
              {module.syntax.map((s) => (
                <div key={s.code} style={{ marginBottom: 12 }}>
                  <TryBlock code={s.code} onTry={tryCode} />
                  <p className="muted small" style={{ margin: 0 }}>{s.note}</p>
                </div>
              ))}
              <h3>Every important subtopic</h3>
              {module.topics.map((t) => (
                <div key={t.title} style={{ marginBottom: 14 }}>
                  <strong className="small">{t.title}</strong>
                  <p className="small" style={{ margin: '4px 0' }}>{t.body}</p>
                  {t.code && <TryBlock code={t.code} onTry={tryCode} />}
                  {t.memory?.length ? <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>{t.memory.map((m) => <li key={m}>{m}</li>)}</ul> : null}
                </div>
              ))}
            </section>

            <section className="card">
              <h3 style={{ marginTop: 0 }}>Code examples with real output</h3>
              {module.examples.map((ex) => (
                <div key={ex.title} style={{ marginBottom: 18 }}>
                  <div className="row spread"><strong className="small">{ex.title}</strong><span className="chip small">{ex.level}</span></div>
                  <TryBlock code={ex.code} onTry={tryCode} />
                  <strong className="small">Output</strong>
                  <pre className="j-output-pre"><code>{ex.output}</code></pre>
                  <strong className="small">Line by line</strong>
                  <ul className="muted small" style={{ margin: '4px 0', paddingLeft: 18 }}>{ex.lines.map((l) => <li key={l}>{l}</li>)}</ul>
                </div>
              ))}
            </section>

            <section className="card">
              <h3 style={{ marginTop: 0 }}>Common mistakes and debugging</h3>
              {module.mistakes.map((m) => (
                <div key={m.wrong} style={{ marginBottom: 10 }}>
                  <div className="small" style={{ color: 'var(--red)' }}>✗ {m.wrong}</div>
                  <div className="small" style={{ color: 'var(--green)' }}>✓ {m.right}</div>
                  <div className="muted small">{m.why}</div>
                </div>
              ))}
              <h3><Bug size={14} /> Debugging exercise</h3>
              <p className="small">{module.debug.brief}</p>
              <TryBlock code={module.debug.code} onTry={tryCode} />
              <p className="muted small">Expected: {module.debug.expected}</p>
              <details><summary className="small" style={{ cursor: 'pointer' }}>Hints and fix</summary>
                <ul className="muted small">{module.debug.hints.map((h) => <li key={h}>{h}</li>)}</ul>
                <TryBlock code={module.debug.fix} onTry={tryCode} />
              </details>
              <h3>Best practices</h3>
              <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>{module.best.map((b) => <li key={b}>{b}</li>)}</ul>
              <h3><Lightbulb size={14} /> Interview tip</h3>
              <p className="small">{module.tip}</p>
              <h3>Revision notes</h3>
              <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>{module.revision.map((r) => <li key={r}>{r}</li>)}</ul>
              <button className="btn small primary" style={{ marginTop: 12 }} onClick={() => markStudied('learn')} disabled={done.learn}>
                <CheckCircle2 size={13} /> {done.learn ? 'Learn section complete' : 'Mark learn section studied'}
              </button>
            </section>
          </div>

          <aside className="j-topic-side">
            <div className="card">
              <div className="row spread" style={{ marginBottom: 8 }}>
                <strong>Code Bro — try the topic</strong>
                <span className="chip small">JDK 17</span>
              </div>
              <JNotebook
                key={module.id}
                source={injected}
                height={280}
                initialSource={module.lab.starter}
                storageKey={`brocode:j-lab:${module.id}`}
              />
            </div>
            <div className="card">
              <strong className="small">Learning navigation</strong>
              <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {prev && <Link className="btn small" to={`/java/${prev.id}`}><ArrowLeft size={12} /> Previous</Link>}
                <button className="btn small" onClick={() => setStage('interview')}>Continue learning <ArrowRight size={12} /></button>
                {next && <Link className="btn small" to={`/java/${next.id}`}>Next topic <ChevronRight size={12} /></Link>}
              </div>
            </div>
          </aside>
        </div>
      )}

      {stage === 'interview' && (
        <section className="card">
          <div className="row spread"><h2 style={{ marginTop: 0 }}>Interview Q&A + mock</h2><span className="chip small">{interviewItems.length} questions</span></div>
          <p className="muted small">Answer aloud first, then open the model answer. This stage is marked studied by you, not by a page view.</p>
          {interviewItems.map((item, i) => (
            <details key={`${item.q}-${i}`} style={{ marginBottom: 8 }}>
              <summary className="small" style={{ cursor: 'pointer' }}>{item.q}</summary>
              <p className="small" style={{ margin: '6px 0 0' }}>{item.a}</p>
              {item.followUp && <p className="muted small" style={{ margin: 0 }}>Follow-up: {item.followUp}</p>}
            </details>
          ))}
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="btn small primary" onClick={() => markStudied('interview')} disabled={done.interview}><CheckCircle2 size={13} /> {done.interview ? 'Interview complete' : 'Mark interview studied'}</button>
            <Link className="btn small" to="/interviews">Open Interview Room</Link>
          </div>
        </section>
      )}

      {stage === 'coding' && (
        <div className="j-stage-grid">
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Coding Lab</h2>
            {codingMine.length === 0 ? <p className="muted small">No coding-bank questions are mapped to this module yet.</p> : (
              <>
                <div className="j-pick-list">
                  {codingMine.map((q, i) => (
                    <button key={q.id} type="button" className={`j-pick${q.id === activeCoding?.id ? ' on' : ''}`} onClick={() => setCodingSel(i)}>
                      <span className="mono">{(i + 1).toString().padStart(2, '0')}</span>
                      <span><b>{q.title}</b><span>{q.level} · {q.tests.length} tests</span></span>
                      {codingSolved(q.id) && <CheckCircle2 size={13} />}
                    </button>
                  ))}
                </div>
                {activeCoding && (
                  <div style={{ marginTop: 12 }}>
                    <h3 style={{ marginTop: 0 }}>{activeCoding.title}</h3>
                    <p className="small">{activeCoding.statement}</p>
                    <p className="muted small"><b>Input:</b> {activeCoding.input || 'none'} · <b>Output:</b> {activeCoding.output}</p>
                    {activeCoding.examples.map((ex) => <div key={ex.input} className="mono small">{ex.input || '(no input)'} → {ex.output}</div>)}
                    <h4>Constraints</h4>
                    <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>{activeCoding.constraints.map((c) => <li key={c}>{c}</li>)}</ul>
                    <h4>Hints</h4>
                    <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>{activeCoding.hints.map((h) => <li key={h}>{h}</li>)}</ul>
                    <details style={{ marginTop: 10 }}><summary className="small" style={{ cursor: 'pointer' }}>Reference solution (after trying)</summary><TryBlock code={activeCoding.solution} onTry={tryCode} /></details>
                  </div>
                )}
              </>
            )}
          </section>
          <section className="card">
            {activeCoding ? (
              <JNotebook
                key={activeCoding.id}
                title={activeCoding.title}
                initialSource={activeCoding.starter}
                lab={codingLab(activeCoding)}
                attemptKey={`jcoding:${activeCoding.id}`}
                xp={30}
                storageKey={`brocode:j-coding:${activeCoding.id}`}
              />
            ) : <p className="muted small">Choose a coding question to open the playground.</p>}
          </section>
        </div>
      )}

      {stage === 'logic' && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Logic — think before code</h2>
          <p className="muted small">{module.mcqs.length} knowledge checks · answer every question to record logic progress.</p>
          {module.mcqs.map((q, i) => (
            <div key={q.q} style={{ marginBottom: 12 }}>
              <strong className="small">{i + 1}. {q.q}</strong>
              <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                {q.options.map((opt, oi) => {
                  const chosen = answers[i] === oi;
                  const correct = submitted && oi === q.answer;
                  const wrong = submitted && chosen && oi !== q.answer;
                  return (
                    <label key={opt} className="small j-option" style={{ borderColor: correct ? 'var(--green)' : wrong ? 'var(--red)' : undefined }}>
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
            ? <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="chip small">{score.correct}/{score.total} · {score.pct}%</span>
                <button className="btn small" onClick={() => { setAnswers({}); setSubmitted(false); }}>Retry</button>
                {wrongIndexes(module.mcqs, answers).length > 0 && <span className="muted small">{wrongIndexes(module.mcqs, answers).length} to review</span>}
              </div>
            : <button className="btn small primary" onClick={submitQuiz} disabled={Object.keys(answers).length !== module.mcqs.length}>Submit logic check ({module.mcqs.length})</button>}
        </section>
      )}

      {stage === 'debug' && (
        <div className="j-stage-grid">
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Debug — find and fix</h2>
            {debugMine.length === 0 ? (
              <>
                <p className="small">{module.debug.brief}</p>
                <TryBlock code={module.debug.code} onTry={tryCode} />
                <p className="muted small">Expected: {module.debug.expected}</p>
                <ul className="muted small">{module.debug.hints.map((h) => <li key={h}>{h}</li>)}</ul>
                <details><summary className="small" style={{ cursor: 'pointer' }}>Fix</summary><TryBlock code={module.debug.fix} onTry={tryCode} /></details>
                <button className="btn small primary" style={{ marginTop: 10 }} onClick={() => markStudied('debug')} disabled={done.debug}><CheckCircle2 size={13} /> Mark debug studied</button>
              </>
            ) : (
              <>
                <div className="j-pick-list">
                  {debugMine.map((c, i) => (
                    <button key={c.id} type="button" className={`j-pick${c.id === activeDebug?.id ? ' on' : ''}`} onClick={() => setDebugSel(i)}>
                      <span className="mono">{(i + 1).toString().padStart(2, '0')}</span>
                      <span><b>{c.title}</b><span>{c.category} · {c.level}</span></span>
                      {debugFixed(c.id) && <CheckCircle2 size={13} />}
                    </button>
                  ))}
                </div>
                {activeDebug && (
                  <div style={{ marginTop: 12 }}>
                    <p className="small">{activeDebug.brief}</p>
                    <p className="muted small"><b>Expected:</b> {activeDebug.expected} · <b>Actual:</b> {activeDebug.actual}</p>
                    <p className="small" style={{ color: 'var(--red)' }}>{activeDebug.error}</p>
                    <details><summary className="small" style={{ cursor: 'pointer' }}>Hints</summary><ul className="muted small">{activeDebug.hints.map((h) => <li key={h}>{h}</li>)}</ul></details>
                    <details><summary className="small" style={{ cursor: 'pointer' }}>Fix</summary><TryBlock code={activeDebug.fix} onTry={tryCode} /></details>
                  </div>
                )}
              </>
            )}
          </section>
          <section className="card">
            {activeDebug ? (
              <JNotebook
                key={activeDebug.id}
                title={activeDebug.title}
                initialSource={activeDebug.code}
                lab={{ id: activeDebug.id, module: activeDebug.module, title: activeDebug.title, brief: activeDebug.brief, objective: activeDebug.brief, level: activeDebug.level, category: 'debug', starter: activeDebug.code, expected: activeDebug.expected, tests: activeDebug.tests, hints: activeDebug.hints, solution: activeDebug.fix, xp: 20 }}
                attemptKey={`jdebug:${activeDebug.id}`}
                storageKey={`brocode:j-debug:${activeDebug.id}`}
              />
            ) : (
              <JNotebook key={`${module.id}-debug`} title="Debug exercise" initialSource={module.debug.code} lab={{ ...module.lab, id: `debug-${module.id}`, module: module.id, title: 'Debug exercise', brief: module.debug.brief, objective: module.debug.brief, level: module.level, category: 'debug', starter: module.debug.code, expected: module.debug.expected, tests: [{ name: 'Expected output', stdin: '', stdout: module.debug.expected }], hints: module.debug.hints, solution: module.debug.fix, xp: 20 }} attemptKey={`jstage:${module.id}:debug`} storageKey={`brocode:j-debug:${module.id}`} />
            )}
          </section>
        </div>
      )}

      {stage === 'solved' && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Practice Solutions — hands-on tasks</h2>
          <p className="muted small">These prompts are authored for this module. Write the solution in Code Bro; the hint is one click away, not the answer.</p>
          {module.practice.map((p, i) => (
            <div key={p.title} style={{ marginBottom: 14 }}>
              <strong className="small">{i + 1}. {p.title}</strong> <span className="chip small">{p.level}</span>
              <p className="small" style={{ margin: '4px 0' }}>{p.prompt}</p>
              <details><summary className="muted small" style={{ cursor: 'pointer' }}>Hint</summary><p className="muted small" style={{ margin: 0 }}>{p.hint}</p></details>
            </div>
          ))}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn small primary" onClick={() => markStudied('solved')} disabled={done.solved}><CheckCircle2 size={13} /> {done.solved ? 'Practice complete' : 'Mark practice studied'}</button>
            <button className="btn small" onClick={() => setStage('coding')}>Open Coding Lab <ArrowRight size={12} /></button>
          </div>
        </section>
      )}

      {stage === 'mini' && (
        <div className="j-stage-grid">
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Mini Project — build and apply</h2>
            <h3>{activeLab?.title ?? module.lab.title}</h3>
            <p className="small">{activeLab?.brief ?? module.lab.brief}</p>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {(activeLab?.tests ?? module.lab.tests).map((t) => <span key={t.name} className="chip small">{t.name}</span>)}
            </div>
            <h4>Hints</h4>
            <ul className="muted small" style={{ paddingLeft: 18 }}>{(activeLab?.hints ?? module.lab.hints).map((h) => <li key={h}>{h}</li>)}</ul>
            <details style={{ marginTop: 8 }}><summary className="small" style={{ cursor: 'pointer' }}>Solution (open after trying)</summary><TryBlock code={activeLab?.solution ?? module.lab.solution} onTry={tryCode} /></details>
          </section>
          <section className="card">
            <JNotebook
              key={activeLab?.id ?? module.id}
              title={activeLab?.title ?? module.lab.title}
              initialSource={(activeLab ?? module.lab).starter}
              lab={{ ...(activeLab ?? module.lab), id: activeLab?.id ?? `lab-${module.id}`, module: module.id, objective: activeLab?.objective ?? module.goal, level: activeLab?.level ?? module.level, category: activeLab?.category ?? 'module', xp: activeLab?.xp ?? 25 }}
              storageKey={`brocode:j-lab:${activeLab?.id ?? module.id}`}
            />
          </section>
        </div>
      )}

      {stage === 'project' && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Project Lab — ship it for real</h2>
          {projectsMine.length === 0 ? <p className="muted small">No project is mapped to this module yet.</p> : (
            <>
              <div className="j-pick-list">
                {projectsMine.map((p, i) => (
                  <button key={p.id} type="button" className={`j-pick${p.id === activeProject?.id ? ' on' : ''}`} onClick={() => setProjectSel(i)}>
                    <span className="mono">{(i + 1).toString().padStart(2, '0')}</span>
                    <span><b>{p.title}</b><span>{p.level} · {p.steps.length} steps</span></span>
                  </button>
                ))}
              </div>
              {activeProject && (
                <div style={{ marginTop: 12 }}>
                  <p className="small">{activeProject.summary}</p>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{activeProject.features.map((f) => <span key={f} className="chip small">{f}</span>)}</div>
                  <ol className="muted small" style={{ paddingLeft: 18 }}>{activeProject.steps.map((s) => <li key={s.title}>{s.title} <span className="muted">({s.tasks.length} tasks)</span></li>)}</ol>
                  <TryBlock code={activeProject.starter} onTry={tryCode} />
                  <button className="btn small primary" style={{ marginTop: 8 }} onClick={() => markStudied('project')} disabled={done.project}><CheckCircle2 size={13} /> {done.project ? 'Project studied' : 'Mark project studied'}</button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {stage === 'defense' && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Defense — explain and present</h2>
          <p className="muted small">Explain each point aloud in your own words. Self-mark only after you can defend it without notes.</p>
          <ol className="small" style={{ paddingLeft: 18, lineHeight: 1.8 }}>{module.checkpoint.checks.map((c) => <li key={c}>{c}</li>)}</ol>
          <h3>Objectives you should be able to defend</h3>
          <ul className="muted small" style={{ paddingLeft: 18 }}>{module.objectives.map((o) => <li key={o}>{o}</li>)}</ul>
          <button className="btn small primary" onClick={() => markStudied('defense')} disabled={done.defense}><CheckCircle2 size={13} /> {done.defense ? 'Defense complete' : 'Mark defense complete'}</button>
        </section>
      )}

      {stage === 'checkpoint' && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Checkpoint — test your mastery</h2>
          <h3>Module knowledge check</h3>
          {module.mcqs.map((q: JMcq, i) => (
            <div key={`cp-${q.q}`} style={{ marginBottom: 12 }}>
              <strong className="small">{i + 1}. {q.q}</strong>
              <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                {q.options.map((opt, oi) => {
                  const chosen = answers[i] === oi;
                  const correct = submitted && oi === q.answer;
                  const wrong = submitted && chosen && oi !== q.answer;
                  return (
                    <label key={opt} className="small j-option" style={{ borderColor: correct ? 'var(--green)' : wrong ? 'var(--red)' : undefined }}>
                      <input type="radio" name={`cp${i}`} checked={chosen} onChange={() => setAnswers((a) => ({ ...a, [i]: oi }))} disabled={submitted} /> {opt}
                      {correct && ' ✓'}{wrong && ' ✗'}
                    </label>
                  );
                })}
              </div>
              {submitted && <p className="muted small" style={{ margin: '6px 0 0' }}>{q.explain}</p>}
            </div>
          ))}
          {submitted
            ? <span className="chip small">{score.correct}/{score.total} · {score.pct}%</span>
            : <button className="btn small primary" onClick={submitQuiz} disabled={Object.keys(answers).length !== module.mcqs.length}>Submit knowledge check</button>}

          {set && (
            <>
              <h3 style={{ marginTop: 18 }}>{set.title}</h3>
              <p className="muted small">{set.questions.length} MCQs · module assessment</p>
              {set.questions.map((q, i) => (
                <div key={`set-${q.q}`} style={{ marginBottom: 12 }}>
                  <strong className="small">{i + 1}. {q.q}</strong>
                  <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                    {q.options.map((opt, oi) => {
                      const chosen = testAnswers[i] === oi;
                      const correct = testSubmitted && oi === q.answer;
                      const wrong = testSubmitted && chosen && oi !== q.answer;
                      return (
                        <label key={opt} className="small j-option" style={{ borderColor: correct ? 'var(--green)' : wrong ? 'var(--red)' : undefined }}>
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
                ? <button className="btn small primary" onClick={submitTest} disabled={Object.keys(testAnswers).length !== set.questions.length}>Submit module test</button>
                : <div className="row" style={{ gap: 8 }}><span className="chip small">{testScore.correct}/{testScore.total} · {testScore.pct}%</span><button className="btn small" onClick={() => { setTestAnswers({}); setTestSubmitted(false); }}>Retry test</button></div>}
            </>
          )}

          <h3 style={{ marginTop: 18 }}>Completion checkpoint</h3>
          <p className="muted small">{module.checkpoint.title}</p>
          {module.checkpoint.checks.map((c, i) => (
            <label key={c} className="small" style={{ display: 'block', marginBottom: 4 }}>
              <input type="checkbox" checked={!!checked[i]} onChange={(e) => setChecked((p) => ({ ...p, [i]: e.target.checked }))} disabled={complete} /> {c}
            </label>
          ))}
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn small primary" onClick={finish} disabled={complete || !module.checkpoint.checks.every((_, i) => checked[i])}>
              <CheckCircle2 size={13} /> {complete ? 'Checkpoint complete' : 'Mark module complete (+30 XP)'}
            </button>
            {complete && next && <Link className="btn small" to={`/java/${next.id}`}>Next: {next.title} <ArrowRight size={13} /></Link>}
          </div>
        </section>
      )}

      <div className="row spread" style={{ marginTop: 14, gap: 8 }}>
        {prev ? <Link className="btn small" to={`/java/${prev.id}`}><ArrowLeft size={13} /> {prev.title}</Link> : <span />}
        {next ? <Link className="btn small primary" to={`/java/${next.id}`}>{next.title} <ArrowRight size={13} /></Link> : <span className="chip small">Course complete</span>}
      </div>
    </div>
  );
}
