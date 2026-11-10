import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BarChart3, BookOpen, Bug, CheckCircle2, ChevronRight, FlaskConical, FolderGit2, GraduationCap,
  ListChecks, Mic2, Play, Trophy,
} from 'lucide-react';
import { useJAssessments, useJCoding, useJCourse, useJDebugging, useJIndex, useJInterview, useJLabs, useJProjects } from '../../core/data/jcourse';
import { useStore } from '../../core/storage/store';import { certificateOf, checkpointKey, codingTally, debugTally, jQuizTally, nextModule, progressOf,
} from '../../core/learning/jcourse';
import { JLogo } from './JLogo';

const TABS = [
  ['overview', 'Overview'], ['curriculum', 'Curriculum'], ['coding', 'Coding'], ['debugging', 'Debugging'],
  ['labs', 'Labs'], ['projects', 'Projects'], ['interview', 'Interview'], ['tests', 'Tests'],
  ['final', 'Final'], ['progress', 'Progress'],
] as const;
type Tab = typeof TABS[number][0];
const LEVELS = ['all', 'beginner', 'intermediate', 'advanced'] as const;

export default function JCoursePage() {
  const index = useJIndex();
  const course = useJCourse();
  const labs = useJLabs();
  const projects = useJProjects();
  const interview = useJInterview();
  const sets = useJAssessments();
  const coding = useJCoding();
  const debugging = useJDebugging();
  const store = useStore();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(12);
  const [finalAnswers, setFinalAnswers] = useState<Record<number, number>>({});
  const [finalSubmitted, setFinalSubmitted] = useState(false);
  const tab = (TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'overview') as Tab;

  const completed = useMemo(() => new Set(
    (index?.modules ?? []).filter((m) => store.attempts[checkpointKey(m.id)]?.done).map((m) => m.id),
  ), [index, store.attempts]);

  const answered = useMemo(
    () => (index?.modules ?? []).reduce((n, m) => n + jQuizTally(store.attempts, m.id, m.counts.mcqs).answered, 0),
    [index, store.attempts],
  );
  const codingStats = useMemo(() => codingTally(store.attempts, coding), [store.attempts, coding]);
  const debugStats = useMemo(() => debugTally(store.attempts, debugging), [store.attempts, debugging]);
  const finalPct = store.attempts['jcourse:final:assessment']?.score ?? null;
  const certificate = useMemo(() => (index ? certificateOf({
    modules: index.modules, completed, finalPct, passPct: course?.final.passPct ?? 70,
  }) : null), [index, completed, finalPct, course]);

  if (!index) {
    return <div className="card"><div className="skeleton" style={{ height: 120 }} /><div className="skeleton" style={{ height: 420, marginTop: 12 }} /></div>;
  }

  const stats = index.stats;
  const progress = progressOf(index.modules, completed);
  const next = nextModule(index.modules, completed);
  const open = (id: Tab) => setParams(id === 'overview' ? {} : { tab: id });
  const match = (text: string) => !q || text.toLowerCase().includes(q.toLowerCase());

  const codingList = coding.filter((c) => (level === 'all' || c.level === level) && match(`${c.title} ${c.statement} ${c.topic}`));
  const debugList = debugging.filter((c) => (level === 'all' || c.level === level) && match(`${c.title} ${c.brief} ${c.category}`));
  const labList = labs.filter((l) => (level === 'all' || l.level === level) && match(`${l.title} ${l.category} ${l.brief}`));
  const questionList = interview.filter((i) => (level === 'all' || i.level === level) && match(`${i.q} ${i.topic}`));

  const finalQuestions = course?.final.questions ?? [];
  const finalScore = finalQuestions.reduce((n, question, i) => n + (finalAnswers[i] === question.answer ? 1 : 0), 0);
  const finalResultPct = finalQuestions.length ? Math.round((finalScore / finalQuestions.length) * 100) : 0;

  return (
    <div>
      <div className="card glow fadeup tone-amber">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260 }}>
            <div className="chip" style={{ marginBottom: 8 }}><GraduationCap size={12} /> BroCode course</div>
            <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <JLogo size={40} />
              {index.course.title}
            </h1>
            <p className="muted small" style={{ margin: '8px 0 0', maxWidth: 700 }}>{index.course.description}</p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <span className="chip">{index.course.standard}</span>
              <span className="chip">{stats.modules} modules</span>
              <span className="chip">{stats.topics} topics</span>
              <span className="chip">{stats.coding} coding Qs</span>
              <span className="chip">{stats.debugging} debug labs</span>
              <span className="chip">{stats.labs} labs</span>
              <span className="chip">{stats.projects} projects</span>
              <span className="chip">{stats.interview} interview Qs</span>
              <span className="chip">{index.course.hours}h</span>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10, minWidth: 230 }}>
            <div className="chip small">{progress.completed}/{progress.total} modules · {progress.pct}%</div>
            <div style={{ height: 8, background: 'rgba(255,255,255,.08)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${progress.pct}%`, height: '100%', background: 'linear-gradient(90deg,#f59e0b,#ef4444)' }} />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Link className="btn small primary" to={`/java/${next?.id ?? index.modules[0].id}`}><Play size={13} /> {progress.completed ? 'Resume learning' : 'Start course'}</Link>
              <Link className="btn small" to="/java?tab=curriculum">Curriculum</Link>
            </div>
            <span className="muted small">{progress.hoursDone}h studied · real javac execution in the notebook</span>
          </div>
        </div>
      </div>

      <div className="row j-tabs" style={{ gap: 6, flexWrap: 'wrap', margin: '14px 0' }}>
        {TABS.map(([id, label]) => (
          <button key={id} className={`btn small${tab === id ? ' primary' : ''}`} onClick={() => open(id)} aria-pressed={tab === id}>{label}</button>
        ))}
        <Link className="btn small" to={`/java/${next?.id ?? 'j01'}`}><BookOpen size={13} /> Open a lesson</Link>
      </div>

      {tab === 'overview' && (
        <>
          <div className="course-grid">
            <div className="card">
              <h2 style={{ marginTop: 0 }}>What you will be able to do</h2>
              <ul className="muted small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>{index.course.outcomes.map((o) => <li key={o}>{o}</li>)}</ul>
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Skills covered</h3>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{index.course.skills.map((s) => <span key={s} className="chip small">{s}</span>)}</div>
              <h4 style={{ marginBottom: 4 }}>Prerequisites</h4>
              <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>{index.course.prerequisites.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Who it is for</h3>
              <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>{index.course.targetStudents.map((s) => <li key={s}>{s}</li>)}</ul>
              <p className="muted small" style={{ marginBottom: 0 }}>{index.course.tagline}</p>
            </div>
          </div>

          <div className="sec-head"><h2><BarChart3 size={16} color="var(--amber)" /> Progress by module</h2><span className="line" /></div>
          <div className="card fadeup">
            <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
              <span className="small muted">
                {answered}/{stats.mcqs} module MCQs answered · {codingStats.attempted}/{codingStats.total} coding attempts · {debugStats.fixed}/{debugStats.total} debug fixes
              </span>
              <button className="btn small" onClick={() => open('progress')}>Full progress <ChevronRight size={13} /></button>
            </div>
            <div className="tile-grid" style={{ marginTop: 10 }}>
              {index.modules.slice(0, 8).map((m) => {
                const q2 = jQuizTally(store.attempts, m.id, m.counts.mcqs);
                return (
                  <Link key={m.id} to={`/java/${m.id}`} className="tile c-tile">
                    <span className="ic"><span className="small">J{String(m.no).padStart(2, '0')}</span></span>
                    <span className="t" style={{ flex: 1, minWidth: 0 }}>
                      <b>{m.title}</b>
                      <span>{q2.answered}/{q2.total} MCQs answered</span>
                      <span className="c-progress" role="img" aria-label={`${q2.pct ?? 0}% of ${m.title} MCQs answered`}>
                        <i style={{ width: `${q2.pct ?? 0}%` }} />
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}

      {tab === 'curriculum' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {index.modules.map((m) => (
            <div key={m.id} className="card">
              <div className="row spread" style={{ gap: 12, flexWrap: 'wrap' }}>
                <div className="row" style={{ gap: 12, alignItems: 'flex-start', minWidth: 240 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, minWidth: 34 }}>{String(m.no).padStart(2, '0')}</span>
                  <div>
                    <strong>{m.title}</strong>
                    <div className="muted small">{m.brief}</div>
                    <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      <span className="chip small">{m.level}</span><span className="chip small">{m.hours}h</span>
                      <span className="chip small">{m.counts.topics} topics</span><span className="chip small">{m.counts.mcqs} MCQs</span>
                    </div>
                  </div>
                </div>
                {completed.has(m.id)
                  ? <span className="chip small"><CheckCircle2 size={11} /> complete</span>
                  : <Link className="btn small primary" to={`/java/${m.id}`}>Open <ChevronRight size={13} /></Link>}
              </div>
            </div>
          ))}
        </div>
      )}

      {(tab === 'coding' || tab === 'debugging') && (
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input className="assistant-input" style={{ maxWidth: 300 }} placeholder={tab === 'coding' ? 'Search coding questions…' : 'Search debugging labs…'} value={q} onChange={(e) => setQ(e.target.value)} />
            {LEVELS.map((l) => <button key={l} className={`btn small${level === l ? ' primary' : ''}`} onClick={() => setLevel(l)}>{l}</button>)}
            <span className="chip small">{tab === 'coding' ? codingList.length : debugList.length} matching</span>
          </div>
          <div className="course-grid">
            {(tab === 'coding' ? codingList : debugList).slice(0, limit).map((item) => (
              <div className="card" key={item.id}>
                <div className="row spread"><span className="chip small">{'topic' in item ? item.topic : item.category}</span><span className="chip small">{item.level}</span></div>
                <strong className="small" style={{ display: 'block', marginTop: 6 }}>{item.title}</strong>
                <p className="muted small" style={{ margin: '4px 0' }}>{'statement' in item ? item.statement : item.brief}</p>
                {'tests' in item && <div className="muted small">{item.tests.length} tests · {'time' in item ? `time ${item.time}` : `expected ${JSON.stringify(item.expected)}`}</div>}
                <Link className="btn small" style={{ marginTop: 8 }} to={`/java/${item.module}`}>Open module <ChevronRight size={12} /></Link>
              </div>
            ))}
          </div>
          {(tab === 'coding' ? codingList : debugList).length > limit && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button className="btn small" onClick={() => setLimit((n) => n + 12)}>Show more</button>
            </div>
          )}
        </div>
      )}

      {tab === 'labs' && (
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input className="assistant-input" style={{ maxWidth: 300 }} placeholder="Filter labs…" value={q} onChange={(e) => setQ(e.target.value)} />
            {LEVELS.map((l) => <button key={l} className={`btn small${level === l ? ' primary' : ''}`} onClick={() => setLevel(l)}>{l}</button>)}
            <span className="chip small">{labList.length} labs</span>
          </div>
          <div className="course-grid">
            {labList.map((lab) => (
              <div className="card" key={lab.id}>
                <div className="row spread"><div className="chip small"><FlaskConical size={11} /> {lab.category}</div><span className="chip small">{lab.level}</span></div>
                <h3 style={{ margin: '8px 0 4px', fontSize: '1rem' }}>{lab.title}</h3>
                <p className="muted small">{lab.brief}</p>
                <div className="muted small">Module {lab.module.toUpperCase()} · {lab.tests.length} tests · {lab.xp} XP</div>
                <Link className="btn small primary" style={{ marginTop: 8 }} to={`/java/${lab.module}?lab=${encodeURIComponent(lab.id)}`}>Open lab <ChevronRight size={12} /></Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'projects' && (
        <div className="course-grid">
          {projects.map((p) => (
            <div className="card" key={p.id}>
              <div className="row spread"><strong><FolderGit2 size={13} /> {p.title}</strong><span className="chip small">{p.level}</span></div>
              <p className="muted small">{p.summary}</p>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{p.features.slice(0, 4).map((f) => <span className="chip small" key={f}>{f}</span>)}</div>
              <ol className="muted small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {p.steps.map((s) => <li key={s.title}>{s.title} <span className="muted">({s.tasks.length} tasks)</span></li>)}
              </ol>
              <Link className="btn small" style={{ marginTop: 8 }} to={`/java/${p.module}`}>Module {p.module.toUpperCase()} <ChevronRight size={12} /></Link>
            </div>
          ))}
        </div>
      )}

      {tab === 'interview' && (
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input className="assistant-input" style={{ maxWidth: 340 }} placeholder="Search interview questions…" value={q} onChange={(e) => setQ(e.target.value)} />
            {LEVELS.map((l) => <button key={l} className={`btn small${level === l ? ' primary' : ''}`} onClick={() => setLevel(l)}>{l}</button>)}
            <span className="chip small">{questionList.length} questions</span>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {questionList.map((item) => (
              <details className="card" key={item.id}>
                <summary style={{ cursor: 'pointer' }}><Mic2 size={12} /> {item.q}</summary>
                <p className="small" style={{ marginBottom: 4 }}>{item.a}</p>
                <p className="muted small" style={{ margin: 0 }}>{item.explain}</p>
                {item.followUp && <p className="muted small" style={{ margin: 0 }}>Follow-up: {item.followUp}</p>}
                <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <span className="chip small">{item.topic}</span>
                  <span className="chip small">{item.level}</span>
                  {item.module && <Link className="chip small" to={`/java/${item.module}`}>Module {item.module.toUpperCase()}</Link>}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {tab === 'tests' && (
        <div className="course-grid">
          {sets.map((set) => (
            <div className="card" key={set.id}>
              <div className="row spread"><strong>{set.title}</strong><span className="chip small">{set.questions.length} MCQs</span></div>
              <p className="muted small">Module {set.module.toUpperCase()} checkpoint test · explanations after submit</p>
              <Link className="btn small primary" to={`/java/${set.module}?tab=test`}>Start test</Link>
            </div>
          ))}
        </div>
      )}

      {tab === 'final' && (
        <div>
          <div className="card">
            <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
              <h2 style={{ margin: 0 }}><Trophy size={16} /> {course?.final.title ?? 'Final assessment'}</h2>
              <span className="chip small">{finalQuestions.length} questions · pass {course?.final.passPct ?? 70}%</span>
            </div>
            <p className="muted small">Answer every question, then submit. The best score is kept with your progress.</p>
            {finalQuestions.map((question, i) => (
              <div key={question.q} style={{ marginBottom: 14 }}>
                <strong className="small">{i + 1}. {question.q}</strong>
                <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                  {question.options.map((opt, oi) => {
                    const chosen = finalAnswers[i] === oi;
                    const correct = finalSubmitted && oi === question.answer;
                    const wrong = finalSubmitted && chosen && oi !== question.answer;
                    return (
                      <label key={opt} className="small" style={{ padding: '6px 8px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${correct ? '#22c55e' : wrong ? '#ef4444' : 'rgba(255,255,255,.1)'}` }}>
                        <input type="radio" name={`final${i}`} checked={chosen} onChange={() => setFinalAnswers((a) => ({ ...a, [i]: oi }))} disabled={finalSubmitted} /> {opt}
                        {correct && ' ✓'}{wrong && ' ✗'}
                      </label>
                    );
                  })}
                </div>
                {finalSubmitted && <p className="muted small" style={{ margin: '6px 0 0' }}>{question.explain}</p>}
              </div>
            ))}
            {!finalSubmitted
              ? <button className="btn small primary" disabled={Object.keys(finalAnswers).length !== finalQuestions.length} onClick={() => setFinalSubmitted(true)}>Submit final</button>
              : <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span className="chip small">{finalScore}/{finalQuestions.length} · {finalResultPct}%</span>
                  <button className="btn small" onClick={() => { setFinalAnswers({}); setFinalSubmitted(false); }}>Retry</button>
                </div>}
          </div>
        </div>
      )}

      {tab === 'progress' && (
        <div className="course-grid">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Course progress</h3>
            <div style={{ fontSize: 32, fontWeight: 800 }}>{progress.pct}%</div>
            <p className="muted small">{progress.completed} of {progress.total} modules complete · {progress.hoursDone}h of {stats.hours}h</p>
            <div style={{ height: 10, background: 'rgba(255,255,255,.08)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${progress.pct}%`, height: '100%', background: 'linear-gradient(90deg,#f59e0b,#ef4444)' }} />
            </div>
          </div>
          {(Object.keys(progress.byLevel) as (keyof typeof progress.byLevel)[]).map((lvl) => (
            <div className="card" key={lvl}>
              <strong style={{ textTransform: 'capitalize' }}>{lvl}</strong>
              <p className="muted small">{progress.byLevel[lvl].done}/{progress.byLevel[lvl].total} modules</p>
              <div style={{ height: 8, background: 'rgba(255,255,255,.08)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{ width: `${progress.byLevel[lvl].total ? (progress.byLevel[lvl].done / progress.byLevel[lvl].total) * 100 : 0}%`, height: '100%', background: 'linear-gradient(90deg,#f59e0b,#ef4444)' }} />
              </div>
            </div>
          ))}
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Practice evidence</h3>
            <p className="muted small">Counted from your own attempt records, never from page views.</p>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="chip small">{answered}/{stats.mcqs} MCQs answered</span>
              <span className="chip small">{codingStats.attempted}/{codingStats.total} coding attempted</span>
              <span className="chip small">{codingStats.solved} coding solved</span>
              <span className="chip small">{debugStats.fixed}/{debugStats.total} debug fixed</span>
              <span className="chip small">{interview.length} interview Qs</span>
            </div>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Certificate</h3>
            {certificate?.earned
              ? <p className="small" style={{ color: '#86efac' }}>Earned — every module checkpoint is complete and the final assessment passed.</p>
              : <p className="muted small">{certificate?.reason ?? 'Complete the course and pass the final assessment.'}</p>}
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="chip small">{certificate?.modulesComplete}/{certificate?.modulesTotal} modules</span>
              <span className="chip small">final {finalPct === null ? 'not taken' : `${finalPct}%`}</span>
              <button className="btn small" onClick={() => open('final')}>Final assessment</button>
            </div>
          </div>
        </div>
      )}

      <div className="sec-head"><h2><ListChecks size={16} color="var(--amber)" /> Course sections</h2><span className="line" /></div>
      <div className="tile-grid">
        {([['coding', 'Coding bank', `${stats.coding} questions`, Bug], ['debugging', 'Debugging', `${stats.debugging} challenges`, Bug],
          ['labs', 'Labs', `${stats.labs} labs`, FlaskConical], ['projects', 'Projects', `${stats.projects} builds`, FolderGit2],
          ['interview', 'Interview', `${stats.interview} answers`, Mic2], ['tests', 'Tests', `${sets.length} module tests`, ListChecks]] as const).map(([id, title, copy, Icon]) => (
          <button key={id} type="button" className="tile tone-amber" onClick={() => { setQ(''); setLimit(12); open(id as Tab); }} style={{ textAlign: 'left' }}>
            <span className="ic"><Icon size={18} /></span>
            <span className="t" style={{ flex: 1, minWidth: 0 }}><b>{title}</b><span>{copy}</span></span>
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
    </div>
  );
}
