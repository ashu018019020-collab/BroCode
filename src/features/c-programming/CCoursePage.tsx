import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BarChart3, BookOpen, Briefcase, Bug, ChevronRight, FlaskConical, FolderGit2, GraduationCap,
  ListChecks, Mic2, Play, Sparkles, Target, Trophy,
} from 'lucide-react';
import { useCAssessments, useCCourse, useCIndex, useCInterview, useCLabs, useCProjects } from '../../core/data/ccourse';
import { useStore } from '../../core/storage/store';
import { checkpointKey, nextModule, progressOf } from '../../core/learning/ccourse';
import type { CLab, CProject } from '../../core/learning/ccourse';

const TABS = [
  ['overview', 'Overview'], ['curriculum', 'Curriculum'], ['practice', 'Practice'], ['labs', 'Labs'],
  ['projects', 'Projects'], ['interview', 'Interview'], ['career', 'Career'], ['tests', 'Tests'], ['progress', 'Progress'],
] as const;
type Tab = typeof TABS[number][0];

const LEVELS = ['all', 'beginner', 'intermediate', 'advanced'] as const;

/** The four C career tracks, each mapped to the modules that actually teach its skills. */
const CAREER_ROLES = [
  {
    id: 'embedded', title: 'Embedded & Firmware', icon: '🔌',
    blurb: 'Firmware, drivers and bare-metal code where memory and timing are the product.',
    modules: ['c03', 'c04', 'c05', 'c13', 'c15', 'c16', 'c17'],
    skills: ['bit masking', 'volatile registers', 'ring buffers', 'struct layouts', 'file/EEPROM persistence'],
  },
  {
    id: 'systems', title: 'Systems & OS', icon: '⚙️',
    blurb: 'Processes, allocators, parsers and data structures — the layer everything else stands on.',
    modules: ['c13', 'c14', 'c16', 'c18', 'c19', 'c20'],
    skills: ['pointers & aliasing', 'malloc/free discipline', 'linked lists', 'stacks & queues', 'build flags'],
  },
  {
    id: 'backend', title: 'Backend & Infrastructure', icon: '🛠️',
    blurb: 'Services, tooling and data pipelines where correctness and clean I/O matter more than syntax.',
    modules: ['c09', 'c12', 'c15', 'c17', 'c18'],
    skills: ['functions & modules', 'string handling', 'records on disk', 'error handling', 'portable headers'],
  },
  {
    id: 'algorithms', title: 'Algorithms & Interviews', icon: '🧠',
    blurb: 'Pattern programming, arrays, recursion and complexity — the rounds that get you hired.',
    modules: ['c08', 'c10', 'c11', 'c12', 'c19', 'c20'],
    skills: ['nested loops', 'recursion', 'sorting & searching', 'complexity', 'problem decomposition'],
  },
] as const;

interface PracticeItem {
  id: string; kind: 'Code prompt' | 'Debug' | 'MCQ'; level: string;
  title: string; prompt: string; hint: string; code?: string; fix?: string;
  moduleId: string; moduleTitle: string;
}

export default function CCoursePage() {
  const index = useCIndex();
  const course = useCCourse();
  const labs = useCLabs();
  const projects = useCProjects();
  const interview = useCInterview();
  const sets = useCAssessments();
  const store = useStore();
  const [params, setParams] = useSearchParams();
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('all');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | PracticeItem['kind']>('all');
  const [limit, setLimit] = useState(18);
  const navigate = useNavigate();
  const tab = (TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'overview') as Tab;

  const completed = useMemo(() => new Set(
    (index?.modules ?? []).filter((m) => store.attempts[checkpointKey(m.id)]?.done).map((m) => m.id),
  ), [index, store.attempts]);

  /** Every C exercise in one list: writing prompts, the debugging drill and the module MCQs. */
  const practice = useMemo<PracticeItem[]>(() => (course?.modules ?? []).flatMap((m) => [
    ...m.practice.map((p, i) => ({
      id: `${m.id}-pr${i}`, kind: 'Code prompt' as const, level: p.level, title: p.title,
      prompt: p.prompt, hint: p.hint, moduleId: m.id, moduleTitle: m.title,
    })),
    {
      id: `${m.id}-dbg`, kind: 'Debug' as const, level: m.level, title: `Debug: ${m.title}`,
      prompt: m.debug.brief, hint: m.debug.hints.join(' · '), code: m.debug.code, fix: m.debug.fix,
      moduleId: m.id, moduleTitle: m.title,
    },
    ...m.mcqs.map((q2, i) => ({
      id: `${m.id}-mcq${i}`, kind: 'MCQ' as const, level: m.level, title: q2.q,
      prompt: q2.options.map((o, oi) => `${String.fromCharCode(65 + oi)}. ${o}`).join('    '),
      hint: q2.explain, moduleId: m.id, moduleTitle: m.title,
    })),
  ]), [course]);

  if (!index) {
    return <div className="card"><div className="skeleton" style={{ height: 120 }} /><div className="skeleton" style={{ height: 420, marginTop: 12 }} /></div>;
  }

  const stats = index.stats;
  const progress = progressOf(index.modules, completed);
  const next = nextModule(index.modules, completed);
  const open = (id: Tab) => setParams(id === 'overview' ? {} : { tab: id });
  const openCode = (moduleId: string, code: string) => navigate(`/c-programming/${moduleId}`, { state: { tryCode: code } });
  const tryLab = (lab: CLab, solution = false) => navigate(`/c-programming/${lab.module}?lab=${encodeURIComponent(lab.id)}&try=${solution ? 'solution' : 'starter'}`);
  const tryProject = (project: CProject) => navigate(`/c-programming/${project.module}`, { state: { tryCode: project.starter } });

  const filteredLabs = labs.filter((lab) => (level === 'all' || lab.level === level) && (!q || `${lab.title} ${lab.category}`.toLowerCase().includes(q.toLowerCase())));
  const filteredQs = interview.filter((item) => (level === 'all' || item.level === level) && (!q || `${item.q} ${item.topic}`.toLowerCase().includes(q.toLowerCase())));
  const filteredPractice = practice.filter((item) => (kind === 'all' || item.kind === kind)
    && (level === 'all' || item.level === level)
    && (!q || `${item.title} ${item.prompt} ${item.moduleTitle}`.toLowerCase().includes(q.toLowerCase())));
  const counts = {
    prompt: practice.filter((p) => p.kind === 'Code prompt').length,
    debug: practice.filter((p) => p.kind === 'Debug').length,
    mcq: practice.filter((p) => p.kind === 'MCQ').length,
  };
  const sections = [
    { tab: 'practice' as Tab, icon: ListChecks, title: 'Practice', copy: `${practice.length} exercises`, tone: 'cyan' },
    { tab: 'labs' as Tab, icon: FlaskConical, title: 'Labs', copy: `${labs.length} labs`, tone: 'blue' },
    { tab: 'projects' as Tab, icon: FolderGit2, title: 'Projects', copy: `${projects.length} builds`, tone: 'violet' },
    { tab: 'interview' as Tab, icon: Mic2, title: 'Interview', copy: `${interview.length} Qs`, tone: 'gold' },
    { tab: 'career' as Tab, icon: Briefcase, title: 'Career', copy: `${CAREER_ROLES.length} tracks`, tone: 'amber' },
    { tab: 'progress' as Tab, icon: BarChart3, title: 'Progress', copy: `${progress.pct}% complete`, tone: 'green' },
  ];

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
              <span className="chip">{stats.projects} projects</span>
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
        <Link className="btn small" to={`/c-programming/${next?.id ?? 'c01'}`}><BookOpen size={13} /> Notebook</Link>
      </div>

      {tab === 'overview' && (
        <>
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

          <div className="sec-head"><h2><ListChecks size={16} color="var(--cyan)" /> Course sections</h2><span className="line" /></div>
          <div className="tile-grid">
            {sections.map((s) => (
              <button key={s.tab} type="button" className={`tile tone-${s.tone}`} onClick={() => open(s.tab)} style={{ textAlign: 'left' }}>
                <span className="ic"><s.icon size={18} /></span>
                <span className="t" style={{ flex: 1, minWidth: 0 }}>
                  <b>{s.title}</b>
                  <span>{s.copy}</span>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        </>
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

      {tab === 'practice' && (
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <input className="assistant-input" style={{ maxWidth: 280 }} placeholder="Search exercises…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className={`btn small${kind === 'all' ? ' primary' : ''}`} onClick={() => setKind('all')}>All {practice.length}</button>
            <button className={`btn small${kind === 'Code prompt' ? ' primary' : ''}`} onClick={() => setKind('Code prompt')}><ListChecks size={12} /> Prompts {counts.prompt}</button>
            <button className={`btn small${kind === 'Debug' ? ' primary' : ''}`} onClick={() => setKind('Debug')}><Bug size={12} /> Debug {counts.debug}</button>
            <button className={`btn small${kind === 'MCQ' ? ' primary' : ''}`} onClick={() => setKind('MCQ')}>MCQ {counts.mcq}</button>
          </div>
          <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {LEVELS.map((l) => <button key={l} className={`btn small${level === l ? ' primary' : ''}`} onClick={() => setLevel(l)}>{l}</button>)}
            <span className="chip small">{filteredPractice.length} matching</span>
            {!course && <span className="chip small">loading exercises…</span>}
          </div>
          <div className="course-grid">
            {filteredPractice.slice(0, limit).map((item) => (
              <div className="card" key={item.id}>
                <div className="row spread" style={{ gap: 6 }}>
                  <span className="chip small">{item.kind === 'Debug' ? <><Bug size={11} /> Debug</> : item.kind}</span>
                  <span className="chip small">{item.level}</span>
                </div>
                <strong className="small" style={{ display: 'block', marginTop: 6 }}>{item.title}</strong>
                <p className="muted small" style={{ margin: '4px 0' }}>{item.prompt}</p>
                <div className="muted small">Module {item.moduleId.toUpperCase()} · {item.moduleTitle}</div>
                {item.code && (
                  <div className="c-code" style={{ marginTop: 6 }}>
                    <pre style={{ background: '#0b0b0b', borderRadius: 10, padding: 12, overflow: 'auto', fontSize: 12, margin: 0, maxHeight: 180 }}><code>{item.code}</code></pre>
                    <button type="button" className="btn small c-code-try" onClick={() => openCode(item.moduleId, item.code as string)}><Play size={11} /> Try this code</button>
                  </div>
                )}
                <details style={{ marginTop: 6 }}>
                  <summary className="muted small" style={{ cursor: 'pointer' }}>Hint</summary>
                  <p className="muted small" style={{ margin: '4px 0 0' }}>{item.hint}</p>
                </details>
                {item.fix && (
                  <details style={{ marginTop: 4 }}>
                    <summary className="muted small" style={{ cursor: 'pointer' }}>Fixed version</summary>
                    <div className="c-code" style={{ marginTop: 6 }}>
                      <pre style={{ background: '#0b0b0b', borderRadius: 10, padding: 12, overflow: 'auto', fontSize: 12, margin: 0, maxHeight: 180 }}><code>{item.fix}</code></pre>
                      <button type="button" className="btn small c-code-try" onClick={() => openCode(item.moduleId, item.fix as string)}><Play size={11} /> Try the fix</button>
                    </div>
                  </details>
                )}
                <Link className="btn small" style={{ marginTop: 8 }} to={`/c-programming/${item.moduleId}`}>Open lesson</Link>
              </div>
            ))}
          </div>
          {filteredPractice.length > limit && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button className="btn small" onClick={() => setLimit((n) => n + 18)}>Show more ({filteredPractice.length - limit} left)</button>
            </div>
          )}
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
                <h3 style={{ margin: '8px 0 4px', fontSize: '1rem' }}>{lab.title}</h3>
                <p className="muted small">{lab.brief}</p>
                <div className="muted small">Module {lab.module.toUpperCase()} · {lab.tests.length} tests · {lab.xp} XP</div>
                <div className="c-code" style={{ marginTop: 8 }}>
                  <pre style={{ background: '#0b0b0b', borderRadius: 10, padding: 12, overflow: 'auto', fontSize: 12, margin: 0, maxHeight: 180 }}><code>{lab.starter}</code></pre>
                  <button type="button" className="btn small c-code-try" onClick={() => tryLab(lab)}><Play size={11} /> Try this code</button>
                </div>
                <details style={{ marginTop: 6 }}>
                  <summary className="muted small" style={{ cursor: 'pointer' }}>Solution</summary>
                  <div className="c-code" style={{ marginTop: 6 }}>
                    <pre style={{ background: '#0b0b0b', borderRadius: 10, padding: 12, overflow: 'auto', fontSize: 12, margin: 0, maxHeight: 180 }}><code>{lab.solution}</code></pre>
                    <button type="button" className="btn small c-code-try" onClick={() => tryLab(lab, true)}><Play size={11} /> Try this code</button>
                  </div>
                </details>
                <Link className="btn small" style={{ marginTop: 8 }} to={`/c-programming/${lab.module}?lab=${lab.id}`}>Open lab</Link>
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
              <div className="c-code" style={{ marginTop: 8 }}>
                <pre style={{ background: '#0b0b0b', borderRadius: 10, padding: 12, overflow: 'auto', fontSize: 12, margin: 0, maxHeight: 180 }}><code>{p.starter}</code></pre>
                <button type="button" className="btn small c-code-try" onClick={() => tryProject(p)}><Play size={11} /> Try this code</button>
              </div>
              <Link className="btn small" style={{ marginTop: 8 }} to={`/c-programming/${p.module}`}>Module {p.module.toUpperCase()} <ChevronRight size={12} /></Link>
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
                <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <span className="chip small">{item.topic}</span>
                  <span className="chip small">{item.level}</span>
                  {item.module && <Link className="chip small" to={`/c-programming/${item.module}`}>Module {item.module.toUpperCase()}</Link>}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {tab === 'career' && (
        <div>
          <div className="card glow fadeup">
            <div className="row spread" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 260 }}>
                <div className="chip" style={{ marginBottom: 6 }}>CAREER</div>
                <h2 style={{ margin: 0 }}>Where C takes you.</h2>
                <p className="muted small" style={{ margin: '8px 0 0', maxWidth: 620 }}>
                  Four real tracks, each mapped to the modules that teach its skills. Readiness below counts
                  completed module checkpoints only — labs, projects and interviews are proof of work you add on top.
                </p>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="chip"><Trophy size={12} /> {progress.completed}/{progress.total} modules complete</span>
                <span className="chip"><FolderGit2 size={12} /> {projects.length} portfolio builds</span>
                <span className="chip"><Mic2 size={12} /> {interview.length} interview answers</span>
                <Link className="chip" to="/career">Full career OS</Link>
              </div>
            </div>
          </div>

          <div className="course-grid" style={{ marginTop: 12 }}>
            {CAREER_ROLES.map((role) => {
              const ids = role.modules.filter((id) => index.modules.some((m) => m.id === id));
              const done = ids.filter((id) => completed.has(id)).length;
              const pct = ids.length ? Math.round((done / ids.length) * 100) : 0;
              return (
                <div className="card" key={role.id}>
                  <div className="row spread"><strong>{role.icon} {role.title}</strong><span className="chip small">{pct}% ready</span></div>
                  <p className="muted small">{role.blurb}</p>
                  <div style={{ height: 8, background: 'rgba(255,255,255,.08)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#22d3ee,#818cf8)' }} />
                  </div>
                  <div className="muted small" style={{ marginTop: 6 }}>{done}/{ids.length} modules · {role.skills.slice(0, 3).join(' · ')}</div>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {ids.slice(0, 4).map((id) => {
                      const m = index.modules.find((x) => x.id === id);
                      return m ? <Link key={id} className="chip small" to={`/c-programming/${id}`}>{String(m.no).padStart(2, '0')} {m.title}</Link> : null;
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="sec-head"><h2><Target size={16} color="var(--amber)" /> Next moves</h2><span className="line" /></div>
          <div className="course-grid">
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Finish the course</h3>
              <p className="muted small">{next ? `Next up: ${next.title} (${next.level}).` : 'Every module is complete — keep the labs warm.'}</p>
              <Link className="btn small primary" to={`/c-programming/${next?.id ?? 'c01'}`}><Play size={12} /> {next ? 'Continue' : 'Revisit a module'}</Link>
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Prove it with builds</h3>
              <p className="muted small">Pick from {projects.length} project briefs, each with milestones and a runnable starter.</p>
              <button className="btn small" onClick={() => open('projects')}>Browse projects <ChevronRight size={12} /></button>
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Practice the rounds</h3>
              <p className="muted small">{practice.length} exercises and {interview.length} interview answers across {index.modules.length} modules.</p>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn small" onClick={() => open('practice')}><ListChecks size={12} /> Practice</button>
                <button className="btn small" onClick={() => open('interview')}><Mic2 size={12} /> Interview</button>
              </div>
            </div>
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
            <h3 style={{ marginTop: 0 }}>Course evidence</h3>
            <p className="muted small" style={{ marginTop: 0 }}>Everything this course contains, so you can see what is left to touch.</p>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="chip small">{index.modules.length} modules</span>
              <span className="chip small">{practice.length} exercises</span>
              <span className="chip small">{labs.length} labs</span>
              <span className="chip small">{projects.length} projects</span>
              <span className="chip small">{interview.length} interview Qs</span>
              <span className="chip small">{sets.length} tests</span>
            </div>
            <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn small" onClick={() => open('practice')}>Practice</button>
              <button className="btn small" onClick={() => open('labs')}>Labs</button>
              <button className="btn small" onClick={() => open('projects')}>Projects</button>
              <button className="btn small" onClick={() => open('career')}>Career</button>
            </div>
          </div>
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
