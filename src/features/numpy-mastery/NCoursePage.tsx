import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, ChevronRight, GraduationCap, Play, ShieldCheck, Target, Trophy } from 'lucide-react';
import { useNumpyCourse } from '../../core/data/ncourse';
import { useSavedAnswer, useStore } from '../../core/storage/store';
import { N_LAST_KEY, N_SECTIONS, N_SECTION_LABEL, isModuleComplete, nProgress, nSectionKey, nextSection, numpyReport } from '../../core/learning/ncourse';
import { NLogo } from './NLogo';
import { NModuleWorkspace } from './NWorkspace';
import { Bar } from '../../components/ui/ui';

/**
 * The NumPy Mastery course.
 *
 * One course, twenty modules, ten learning sections inside EVERY module. The course page is an index
 * and the module view is the split workspace (`NWorkspace.tsx`); both read ONE generated artifact
 * (`public/generated/numpy-course/index.json`) and ONE pure rules module (`core/learning/ncourse.ts`),
 * so no count here can disagree with the content that shipped.
 *
 * Progress is stored per module AND section (`nmod:<module>:<section>`). A module counts as complete
 * only when all ten sections have a record — a checkpoint score alone never marks it done.
 */
export default function NCoursePage() {
  const file = useNumpyCourse();
  const state = useStore();
  const [params, setParams] = useSearchParams();
  const modules = file?.modules ?? [];
  const open = modules.find((m) => m.id === params.get('module')) ?? null;
  const progress = useMemo(() => nProgress(modules, state.attempts), [modules, state.attempts]);
  const [lastPlace] = useSavedAnswer(N_LAST_KEY);
  const report = useMemo(() => numpyReport(modules, state.attempts, lastPlace), [modules, state.attempts, lastPlace]);
  const next = useMemo(() => {
    const fresh = modules.find((m) => !isModuleComplete(m.id, state.attempts));
    return fresh ? { module: fresh, section: nextSection(fresh.id, state.attempts) } : null;
  }, [modules, state.attempts]);

  if (!file) {
    return (
      <div className="card">
        <div className="skeleton" style={{ height: 90 }} />
        <div className="skeleton" style={{ height: 320, marginTop: 12 }} />
      </div>
    );
  }

  const { course, stats } = file;

  if (open) {
    return (
      <div>
        <NModuleWorkspace
          module={open}
          modules={modules}
          initialSection={params.get('section')}
          onOpen={(id) => setParams({ module: id })}
          onBack={() => {
            const p = new URLSearchParams(params);
            p.delete('module');
            setParams(p);
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="card glow fadeup">
        <div className="row spread" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 12, minWidth: 'min(260px, 100%)' }}>
            <span className="cc-logo"><NLogo size={64} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="chip" style={{ marginBottom: 6 }}><GraduationCap size={12} /> NUMPY MASTERY</div>
              <h1 style={{ margin: 0 }}>{course.title}</h1>
              <p className="muted small" style={{ margin: '6px 0 0', maxWidth: 620 }}>{course.tagline}</p>
            </div>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="chip"><BookOpen size={12} /> {stats.modules} modules</span>
            <span className="chip"><Target size={12} /> {stats.entries} entries</span>
            <span className="chip"><Trophy size={12} /> {progress.pct}% complete</span>
            <span className="chip">{progress.modulesDone}/{progress.modulesTotal} modules done</span>
            <span className="chip">{modules.reduce((a, m) => a + (m.hours || 0), 0)}h total</span>
            <span className="chip">{course.level}</span>
          </div>
        </div>
        <p className="muted small" style={{ margin: '10px 0 0', maxWidth: 820 }}>{course.description}</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <span className="chip"><ShieldCheck size={12} /> {course.standard}</span>
          {course.prerequisites.map((p) => <span key={p} className="chip">{p}</span>)}
        </div>
        {next && (
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Link className="btn primary" to={`/numpy?module=${next.module.id}`}>
              <Play size={14} /> {progress.sectionsDone ? 'Continue' : 'Start'} learning
            </Link>
            <span className="small muted" style={{ alignSelf: 'center' }}>
              Next: {next.module.title} · {N_SECTION_LABEL[next.section]}
            </span>
          </div>
        )}
        {progress.sectionsDone > 0 && (
          <div style={{ marginTop: 10, maxWidth: 460 }}>
            <div className="row spread small"><span className="muted">{progress.modulesDone}/{progress.modulesTotal} modules complete</span><span>{progress.pct}%</span></div>
            <Bar pct={progress.pct} />
          </div>
        )}
      </div>

      <div className="sec-head"><h2><Trophy size={16} color="var(--blue)" /> Your progress</h2><span className="line" /></div>
      <div className="card">
        <div className="row spread" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="chip">{report.pct}% of the course</span>
            <span className="chip">{report.sectionsDone}/{report.sectionsTotal} sections</span>
            <span className="chip">{report.modulesDone}/{report.modulesTotal} modules</span>
            <span className="chip">{report.weak.length} sections untouched</span>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {report.resume && (
              <button
                type="button"
                className="btn small primary"
                onClick={() => setParams({ module: report.resume!.moduleId, section: report.resume!.section })}
              >
                <Play size={12} /> Resume · {N_SECTION_LABEL[report.resume.section]}
              </button>
            )}
            {report.next && (
              <button
                type="button"
                className="btn small ghost"
                onClick={() => setParams({ module: report.next!.moduleId, section: report.next!.section })}
              >
                Next: {modules.find((m) => m.id === report.next!.moduleId)?.title} · {N_SECTION_LABEL[report.next.section]}
              </button>
            )}
          </div>
        </div>
        <div style={{ marginTop: 10, maxWidth: 520 }}><Bar pct={report.pct} /></div>

        <div style={{ marginTop: 12 }}>
          <b className="small">Module-wise performance</b>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '4px 16px', marginTop: 6 }}>
            {report.rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setParams({ module: row.id })}
                style={{ background: 'none', border: 0, padding: '2px 0', textAlign: 'left', cursor: 'pointer', color: 'inherit' }}
                title={`${row.title} — ${row.done}/10 sections`}
              >
                <span className="row spread small" style={{ gap: 8 }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {String(row.no).padStart(2, '0')} · {row.title}
                  </span>
                  <span className="muted">{row.done}/10</span>
                </span>
                <Bar pct={row.pct} />
              </button>
            ))}
          </div>
        </div>

        {report.weak.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <b className="small">Weak topics — untouched sections in course order</b>
            <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {report.weak.slice(0, 8).map((spot) => (
                <button
                  key={`${spot.moduleId}:${spot.section}`}
                  type="button"
                  className="chip"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setParams({ module: spot.moduleId, section: spot.section })}
                >
                  {spot.label} · {spot.moduleTitle}
                </button>
              ))}
              {report.weak.length > 8 && <span className="chip">+{report.weak.length - 8} more</span>}
            </div>
          </div>
        )}
      </div>

      <div className="sec-head"><h2><BookOpen size={16} color="var(--blue)" /> Learning outcomes</h2><span className="line" /></div>
      <div className="card">
        <ol className="small muted" style={{ margin: 0, paddingLeft: 18, columns: 2, columnGap: 24 }}>
          {course.outcomes.map((o) => <li key={o} style={{ marginBottom: 6 }}>{o}</li>)}
        </ol>
      </div>

      <div className="sec-head"><h2>20 modules · 10 sections each</h2><span className="line" /></div>
      <div className="tile-grid tile-grid-lg">
        {modules.map((m) => {
          const done = isModuleComplete(m.id, state.attempts);
          const sectionsDone = N_SECTIONS.filter((s) => state.attempts[nSectionKey(m.id, s.key)]).length;
          return (
            <Link
              key={m.id}
              to={`/numpy?module=${m.id}`}
              className={`tile tech${done ? ' on' : ''}`}
              data-agent-action={`numpy:module:${m.id}`}
            >
              <span className="ic"><NLogo size={30} /></span>
              <span className="t" style={{ flex: 1, minWidth: 0 }}>
                <b>{String(m.no).padStart(2, '0')} · {m.title}</b>
                <span>{m.entries} entries · {m.level} · {m.hours}h{sectionsDone ? ` · ${sectionsDone}/10 sections` : ''}</span>
              </span>
              <ChevronRight size={14} className="muted" />
            </Link>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 10 }}>
        <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
          <b className="small">Question bank — counted, not claimed</b>
          <span className="chip">{stats.bank.total} unique items</span>
        </div>
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          {stats.bank.perModule} per module against a target of {stats.bank.target}: {stats.bank.shortPerModule} short
          in each module, {stats.bank.shortfall} across the course. Each module's manifest counts concept,
          output, coding, debugging, quiz, written, project and scenario items separately.
        </p>
      </div>

      <p className="small muted" style={{ marginTop: 10 }}>
        Every module holds all ten sections — Learn, Interview, Coding Lab, Logic, Debug, Practice
        Solutions, Mini Project, Project Lab, Defense and Checkpoint. Counts are the records that
        shipped in the content pack, not a target: the pack's own progress ledger tracks the road to
        50 entries per section.
      </p>
    </div>
  );
}
