import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, ChevronRight, FlaskConical, FolderGit2, GraduationCap, Mic2, Play, Sparkles, Target, Trophy } from 'lucide-react';
import { useCAssessments, useCIndex, useCInterview, useCLabs, useCProjects } from '../../core/data/ccourse';
import { useStore } from '../../core/storage/store';
import { checkpointKey, nextModule, progressOf } from '../../core/learning/ccourse';

const TABS = [
  ['overview', 'Overview'], ['curriculum', 'Curriculum'], ['labs', 'Labs'], ['projects', 'Projects'],
  ['interview', 'Interview'], ['tests', 'Tests'], ['progress', 'Progress'],
] as const;
type Tab = typeof TABS[number][0];

const LEVELS = ['all', 'beginner', 'intermediate', 'advanced'] as const;

export default function CCoursePage() {
  const index = useCIndex();
  const labs = useCLabs();
  const projects = useCProjects();
  const interview = useCInterview();
  const sets = useCAssessments();
  const store = useStore();
  const [params, setParams] = useSearchParams();
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('all');
  const [q, setQ] = useState('');
  const tab = (TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'overview') as Tab;

  const completed = useMemo(() => new Set(
    (index?.modules ?? []).filter((m) => store.attempts[checkpointKey(m.id)]?.done).map((m) => m.id),
  ), [index, store.attempts]);

  if (!index) {
    return <div className="card"><div className="skeleton" style={{ height: 120 }} /><div className="skeleton" style={{ height: 420, marginTop: 12 }} /></div>;
  }

  const stats = index.stats;
  const progress = progressOf(index.modules, completed);
  const next = nextModule(index.modules, completed);
  const open = (id: Tab) => setParams(id === 'overview' ? {} : { tab: id });

  const filteredLabs = labs.filter((lab) => (level === 'all' || lab.level === level) && (!q || `${lab.title} ${lab.category}`.toLowerCase().includes(q.toLowerCase())));
  const filteredQs = interview.filter((item) => (level === 'all' || item.level === level) && (!q || `${item.q} ${item.topic}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <div>
      <div className="card glow fadeup tone-cyan">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260 }}>
            <div className="chip" style={{ marginBottom: 8 }}><GraduationCap size={12} /> BroCode course</div>
            <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span aria-hidden style={{ fontWeight: 800, letterSpacing: '-0.04em', background: 'linear-gradient(135deg,#22d3ee,#818cf8)', WebkitBackgroundClip: 'text', color: 'transparent' }}>C</span>
              {index.course.title}
            </h1>
            <p className="muted small" style={{ margin: '8px 0 0', maxWidth: 680 }}>{index.course.description}</p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <span className="chip">{index.course.standard}</span>
              <span className="chip">{stats.modules} modules</span>
              <span className="chip">{stats.topics} topics</span>
              <span className="chip">{stats.labs} labs</span>
              <span className="chip">{stats.interview} interview Qs</span>
              <span className="chip">{index.course.hours}h</span>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10, minWidth: 220 }}>
            <div className="chip small">{progress.completed}/{progress.total} modules · {progress.pct}%</div>
            <div style={{ height: 8, background: 'rgba(255,255,255,.08)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${progress.pct}%`, height: '100%', background: 'linear-gradient(90deg,#22d3ee,#818cf8)' }} />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Link className="btn small primary" to={`/c-programming/${next?.id ?? index.modules[0].id}`}><Play size={13} /> {progress.completed ? 'Resume learning' : 'Start course'}</Link>
              <Link className="btn small" to="/c-programming?tab=curriculum">Curriculum</Link>
            </div>
            <span className="muted small">{progress.hoursDone}h studied · real GCC execution via the notebook</span>
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '14px 0' }}>
        {TABS.map(([id, label]) => (
          <button key={id} className={`btn small${tab === id ? ' primary' : ''}`} onClick={() => open(id)} aria-pressed={tab === id}>{label}</button>
        ))}
        <Link className="btn small" to={`/c-programming/${next?.id ?? 'c01'}?tab=notebook`}><BookOpen size={13} /> Notebook</Link>
      </div>

      {tab === 'overview' && (
        <div className="course-grid">
          <div className="card">
            <h2 style={{ marginTop: 0 }}><Target size={15} /> What you will be able to do</h2>
            <ul className="muted small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>{index.course.outcomes.map((o) => <li key={o}>{o}</li>)}</ul>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}><Sparkles size={15} /> Skills covered</h3>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{index.course.skills.map((s) => <span key={s} className="chip small">{s}</span>)}</div>
            <h4 style={{ marginBottom: 4 }}>Prerequisites</h4>
            <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>{index.course.prerequisites.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}><Trophy size={15} /> Course map</h3>
            <ol className="muted small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              {index.modules.slice(0, 6).map((m) => <li key={m.id}>{m.title} <span className="muted">· {m.hours}h · {m.level}</span></li>)}
            </ol>
            <p className="muted small" style={{ marginBottom: 0 }}>…and {index.modules.length - 6} more, from preprocessor to trees and graphs.</p>
            <button className="btn small" style={{ marginTop: 10 }} onClick={() => open('curriculum')}>See all {index.modules.length} modules <ChevronRight size={13} /></button>
          </div>
        </div>
      )}

      {tab === 'curriculum' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {index.modules.map((m) => {
            const done = completed.has(m.id);
            return (
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
                  {done
                    ? <span className="chip small">✓ complete</span>
                    : <Link className="btn small primary" to={`/c-programming/${m.id}`}>Open <ChevronRight size={13} /></Link>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'labs' && (
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <input className="assistant-input" style={{ maxWidth: 280 }} placeholder="Filter labs…" value={q} onChange={(e) => setQ(e.target.value)} />
            {LEVELS.map((l) => <button key={l} className={`btn small${level === l ? ' primary' : ''}`} onClick={() => setLevel(l)}>{l}</button>)}
            <span className="chip small">{filteredLabs.length} labs</span>
          </div>
          <div className="course-grid">
            {filteredLabs.map((lab) => (
              <div className="card" key={lab.id}>
                <div className="row spread"><div className="chip small"><FlaskConical size={11} /> {lab.category}</div><span className="chip small">{lab.level}</span></div>
                <h4 style={{ margin: '8px 0 4px' }}>{lab.title}</h4>
                <p className="muted small">{lab.brief}</p>
                <div className="muted small">Module {lab.module.toUpperCase()} · {lab.tests.length} tests · {lab.xp} XP</div>
                <Link className="btn small" style={{ marginTop: 8 }} to={`/c-programming/${lab.module}?tab=labs&lab=${lab.id}`}>Open lab</Link>
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
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{p.concepts.slice(0, 4).map((c) => <span className="chip small" key={c}>{c}</span>)}</div>
              <ol className="muted small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {p.milestones.map((m) => <li key={m.title}>{m.title} <span className="muted">({m.tasks.length} tasks)</span></li>)}
              </ol>
            </div>
          ))}
        </div>
      )}

      {tab === 'interview' && (
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <input className="assistant-input" style={{ maxWidth: 320 }} placeholder="Search questions…" value={q} onChange={(e) => setQ(e.target.value)} />
            {LEVELS.map((l) => <button key={l} className={`btn small${level === l ? ' primary' : ''}`} onClick={() => setLevel(l)}>{l}</button>)}
            <span className="chip small">{filteredQs.length} questions</span>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {filteredQs.map((item) => (
              <details className="card" key={item.id}>
                <summary style={{ cursor: 'pointer' }}><Mic2 size={12} /> {item.q}</summary>
                <p className="small" style={{ marginBottom: 4 }}>{item.a}</p>
                {item.followUp && <p className="muted small" style={{ margin: 0 }}>Follow-up: {item.followUp}</p>}
                <span className="chip small">{item.topic}</span>
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
              <Link className="btn small primary" to={`/c-programming/${set.module}?tab=test`}>Start test</Link>
            </div>
          ))}
        </div>
      )}

      {tab === 'progress' && (
        <div className="course-grid">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Course progress</h3>
            <div style={{ fontSize: 32, fontWeight: 800 }}>{progress.pct}%</div>
            <p className="muted small">{progress.completed} of {progress.total} modules complete · {progress.hoursDone}h of {stats.hours}h</p>
            <div style={{ height: 10, background: 'rgba(255,255,255,.08)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${progress.pct}%`, height: '100%', background: 'linear-gradient(90deg,#22d3ee,#818cf8)' }} />
            </div>
          </div>
          {(Object.keys(progress.byLevel) as (keyof typeof progress.byLevel)[]).map((lvl) => (
            <div className="card" key={lvl}>
              <strong style={{ textTransform: 'capitalize' }}>{lvl}</strong>
              <p className="muted small">{progress.byLevel[lvl].done}/{progress.byLevel[lvl].total} modules</p>
              <div style={{ height: 8, background: 'rgba(255,255,255,.08)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{ width: `${progress.byLevel[lvl].total ? (progress.byLevel[lvl].done / progress.byLevel[lvl].total) * 100 : 0}%`, height: '100%', background: 'linear-gradient(90deg,#22d3ee,#818cf8)' }} />
              </div>
            </div>
          ))}
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Saved work</h3>
            <p className="muted small">Attempts and XP live in the same BroCode progress record as every other course. Checkpoints unlock the next module; test scores are kept separately.</p>
            <div className="row" style={{ gap: 8 }}>
              <span className="chip small">{store.xp} XP total</span>
              <span className="chip small">{store.streak.current} day streak</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
