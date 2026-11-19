import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, ChevronLeft, ChevronRight, GraduationCap, Play, Search, Target, Trophy } from 'lucide-react';
import { Bar } from '../../components/ui/ui';
import { useMLCourse } from '../../core/data/mlcourse';
import { N_SECTIONS, N_SECTION_LABEL, type NModule } from '../../core/learning/ncourse';
import { mIsModuleComplete, mNextPlace, mProgress, mSectionKey, mSectionsDone, M_LAST_KEY } from '../../core/learning/mcourse';
import { useStore } from '../../core/storage/store';
import { NModuleWorkspace } from '../numpy-mastery/NWorkspace';
import { MLogo } from './MLogo';
import { MLTools } from './MLTools';

/**
 * /ml — Machine Learning: Zero to Professional.
 *
 * The course is indexed here and each module opens the SAME ten-section workspace as NumPy/Pandas
 * Mastery. The workspace receives the ML progress key family (`mmod:`) and ML branding; it does not
 * duplicate the lesson, quiz, code-cell or checkpoint implementations.
 *
 * The URL is shareable: `?module=ml12&section=checkpoint` reopens the exact place after a refresh.
 */
export default function MLCoursePage() {
  const file = useMLCourse();
  const state = useStore();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const modules = file?.modules ?? [];
  const open = modules.find((module) => module.id === params.get('module')) ?? null;
  const progress = useMemo(() => mProgress(modules, state.attempts), [modules, state.attempts]);
  const next = useMemo(() => mNextPlace(modules, state.attempts), [modules, state.attempts]);
  const hits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return modules.filter((module) =>
      `${module.title} ${module.goal} ${module.sections.learn.map((entry) => entry.title ?? entry.q ?? '').join(' ')}`.toLowerCase().includes(needle),
    );
  }, [modules, query]);

  const openModule = (moduleId: string, section?: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('module', moduleId);
    if (section) nextParams.set('section', section);
    else nextParams.delete('section');
    setParams(nextParams);
  };

  if (!file) {
    return (
      <div className="card" aria-busy="true">
        <div className="skeleton" style={{ height: 90 }} />
        <div className="skeleton" style={{ height: 320, marginTop: 12 }} />
      </div>
    );
  }

  const { course, stats } = file;

  if (open) {
    return (
      <NModuleWorkspace
        module={open}
        modules={modules}
        bank={stats.bank.modules[open.id]}
        initialSection={params.get('section')}
        onOpen={(id) => openModule(id)}
        onBack={() => {
          const nextParams = new URLSearchParams(params);
          nextParams.delete('module');
          nextParams.delete('section');
          setParams(nextParams);
        }}
        sectionKey={mSectionKey}
        isComplete={mIsModuleComplete}
        lastKey={M_LAST_KEY}
        courseTitle={course.title}
        pageTitle="Machine Learning"
        route="/ml"
        logo={<MLogo size={48} />}
        tools={<MLTools />}
        award={10}
        scopePrefix="ml"
        xpLabel="Machine Learning"
      />
    );
  }

  return (
    <div>
      <Link className="small muted" to="/courses" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
        <ChevronLeft size={13} /> All courses
      </Link>

      <div className="card glow fadeup">
        <div className="row spread" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="row" style={{ gap: 12, minWidth: 'min(260px, 100%)' }}>
            <span className="cc-logo"><MLogo size={64} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="chip" style={{ marginBottom: 6 }}><GraduationCap size={12} /> MACHINE LEARNING</div>
              <h1 style={{ margin: 0 }}>{course.title}</h1>
              <p className="muted small" style={{ margin: '6px 0 0', maxWidth: 680 }}>{course.tagline}</p>
            </div>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="chip"><BookOpen size={12} /> {stats.modules} modules</span>
            <span className="chip"><Target size={12} /> {stats.entries.toLocaleString()} records</span>
            <span className="chip">{modules.reduce((total, module) => total + module.hours, 0)}h total</span>
          </div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {next && (
            <button type="button" className="btn primary" onClick={() => openModule(next.moduleId, next.section)}>
              <Play size={14} /> {progress.sectionsDone ? 'Continue' : 'Start'} learning
            </button>
          )}
          <span className="chip"><Trophy size={12} /> {progress.pct}% complete</span>
          <span className="chip">{progress.modulesDone}/{progress.modulesTotal} modules done</span>
          {next && (
            <span className="small muted">
              Next: {modules.find((module) => module.id === next.moduleId)?.title} · {N_SECTION_LABEL[next.section]}
            </span>
          )}
        </div>
        <div style={{ marginTop: 10, maxWidth: 520 }}><Bar pct={progress.pct} /></div>
      </div>

      <div className="sec-head" style={{ marginTop: 14 }}>
        <h2><BookOpen size={16} color="var(--blue)" /> Modules</h2><span className="line" />
        <span className="small muted">{modules.length} modules · ten sections each</span>
      </div>

      <div className="card" style={{ marginBottom: 10 }}>
        <label className="small muted" htmlFor="ml-search">Search the course</label>
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <Search size={15} className="muted" />
          <input
            id="ml-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${stats.entries.toLocaleString()} records — try: leakage, PCA, evaluation`}
            style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', color: 'inherit', outline: 0 }}
          />
        </div>
        {query.trim().length >= 2 && (
          <div style={{ marginTop: 8 }}>
            {hits.length ? (
              <>
                {hits.map((module) => (
                  <button
                    key={module.id}
                    type="button"
                    onClick={() => openModule(module.id)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, borderTop: '1px solid var(--line, #e6e8ee)', padding: '6px 0', cursor: 'pointer', color: 'inherit' }}
                  >
                    <span className="small"><b>{module.title}</b> <span className="muted">· Module {String(module.no).padStart(2, '0')}</span></span>
                    <span className="small muted" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{module.goal}</span>
                  </button>
                ))}
                <p className="small muted" style={{ margin: '6px 0 0' }}>{hits.length} matching module{hits.length === 1 ? '' : 's'}.</p>
              </>
            ) : <p className="small muted" style={{ margin: '8px 0 0' }}>No module matches “{query.trim()}”.</p>}
          </div>
        )}
      </div>

      <div className="tile-grid tile-grid-lg">
        {modules.map((module) => {
          const done = mIsModuleComplete(module.id, state.attempts);
          const sectionsDone = mSectionsDone(module.id, state.attempts);
          return (
            <Link
              key={module.id}
              to={`/ml?module=${module.id}`}
              className={`tile tech${done ? ' on' : ''}`}
              data-agent-action={`ml:module:${module.id}`}
              data-agent-label={`Module ${module.no}: ${module.title}`}
            >
              <span className="ic" style={{ fontWeight: 700, fontSize: 17, color: done ? 'var(--blue, #2563eb)' : 'var(--muted)' }}>
                {String(module.no).padStart(2, '0')}
              </span>
              <span className="t" style={{ flex: 1, minWidth: 0 }}>
                <b>{module.title}</b>
                <span>{module.entries} entries · {module.hours}h · {sectionsDone}/10 sections{done ? ' · complete' : ''}</span>
                <span className="muted" style={{ display: 'block', marginTop: 3, fontSize: 11, lineHeight: 1.4 }}>
                  {module.goal}
                </span>
              </span>
              <ChevronRight size={14} className="muted" />
            </Link>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 10 }}>
        <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
          <b className="small">Course facts — counted, not claimed</b>
          <span className="chip">{stats.bank.total} unique bank items</span>
        </div>
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          {stats.bank.perModule} records per module against the 500-per-module target: {stats.bank.shortPerModule} short
          in each module, {stats.bank.shortfall.toLocaleString()} across the course. The published artifact counts
          every record that actually ships; it never pads a counter to hit the target.
        </p>
      </div>

      <details className="card" style={{ marginTop: 10 }}>
        <summary className="small" style={{ cursor: 'pointer' }}><b>About this course</b> — description, standard and prerequisites</summary>
        <p className="small muted" style={{ margin: '8px 0 0', maxWidth: 820 }}>{course.description}</p>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <span className="chip">{course.standard}</span>
          {course.prerequisites.map((prerequisite) => <span key={prerequisite} className="chip">{prerequisite}</span>)}
          <span className="chip">{course.level}</span>
        </div>
      </details>

      <div className="sec-head"><h2><BookOpen size={16} color="var(--blue)" /> Learning outcomes</h2><span className="line" /></div>
      <div className="card">
        <ol className="small muted" style={{ margin: 0, paddingLeft: 18, columns: 2, columnGap: 24 }}>
          {course.outcomes.map((outcome) => <li key={outcome} style={{ marginBottom: 6 }}>{outcome}</li>)}
        </ol>
      </div>

      <div className="sec-head"><h2><Target size={16} color="var(--blue)" /> Prerequisites and sequence</h2><span className="line" /></div>
      <div className="card">
        <p className="small muted" style={{ margin: 0 }}>
          Start with Python and NumPy/Pandas, then take the modules in order. Each module has Learn,
          Interview, Coding Lab, Logic, Debug, Practice Solutions, Mini Project, Project Lab, Defense
          and Checkpoint — the same ten-section contract as NumPy and Pandas Mastery.
        </p>
      </div>
    </div>
  );
}
