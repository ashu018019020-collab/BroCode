import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, ChevronLeft, ChevronRight, Download, FlaskConical, GraduationCap, Play, Search, ShieldCheck, Target, Trophy } from 'lucide-react';
import { Bar } from '../../components/ui/ui';
import { useMLCourse } from '../../core/data/mlcourse';
import { N_SECTION_LABEL, searchCourse } from '../../core/learning/ncourse';
import { mIsModuleComplete, mNextPlace, mProgress, mSectionKey, mSectionsDone, mlCertificate, M_CAPSTONE_KEY, M_LAST_KEY } from '../../core/learning/mcourse';
import { collectMlProgress, mergeMlProgress, mlSyncSummary } from '../../core/learning/ml-sync';
import { loadMlProgress, saveMlProgress } from '../../core/data/ml-progress';
import { useAuth } from '../../core/auth/AuthProvider';
import { setState, useSavedAnswer, useStore } from '../../core/storage/store';
import { NModuleWorkspace, type NCourseWorkspace } from '../numpy-mastery/NWorkspace';
import { MLogo } from './MLogo';
import { MLTools } from './MLTools';

const ML_WORKSPACE: NCourseWorkspace = {
  id: 'ml',
  pageTitle: 'Machine Learning',
  route: '/ml',
  sectionKey: mSectionKey,
  lastKey: M_LAST_KEY,
  xpLabel: 'Machine Learning',
  logo: <MLogo size={48} />,
  tools: <MLTools />,
};

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
  const hits = useMemo(() => searchCourse(modules, query), [modules, query]);
  const [capRaw, saveCap] = useSavedAnswer(M_CAPSTONE_KEY);
  const checked = useMemo<string[]>(() => {
    try {
      const parsed = JSON.parse(capRaw || '[]');
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
    } catch { return []; }
  }, [capRaw]);
  const rubric = file?.capstone?.rubric ?? [];
  const certificate = useMemo(() => mlCertificate(progress, rubric, checked), [progress, rubric, checked]);
  const toggleCriterion = (criterion: string) => {
    const nextList = checked.includes(criterion) ? checked.filter((item) => item !== criterion) : [...checked, criterion];
    saveCap(JSON.stringify(nextList));
  };
  const { user } = useAuth();
  const learnerName = (state.profile.name || user?.name || 'Learner').trim();
  /*
   * Dedicated ML sync. Only `mmod:` records are collected, sent to `/api/ml/progress`, or written
   * through `save_my_ml_progress`; NumPy's `nmod:` / `nans:` / `ntick:` keys never enter this path.
   * Pull once on account arrival, merge local-first, then push a debounced copy after changes.
   */
  const [syncState, setSyncState] = useState<'idle' | 'pulling' | 'synced' | 'local' | 'saving' | 'rejected'>('idle');
  const [syncEpoch, setSyncEpoch] = useState(0);
  const pushed = useRef('');
  const pulled = useRef(false);
  const syncPayload = useMemo(() => collectMlProgress(state.attempts), [state.attempts]);
  const syncSignature = useMemo(() => JSON.stringify(syncPayload), [syncPayload]);

  useEffect(() => { pulled.current = false; setSyncState('idle'); }, [user?.id]);

  useEffect(() => {
    if (!user || pulled.current) return;
    pulled.current = true;
    setSyncState('pulling');
    let alive = true;
    loadMlProgress().then((result) => {
      if (!alive) return;
      if (!result.ok) {
        setSyncState(result.reason === 'rejected' || result.reason === 'invalid' ? 'rejected' : 'local');
        return;
      }
      const merged = mergeMlProgress(syncPayload, result.payload);
      if (merged.added.length) {
        setState((s) => ({ ...s, attempts: { ...merged.payload, ...s.attempts } }));
      }
      // The remote copy is the baseline we just observed. If this device has a record the remote
      // does not, the save effect still needs one run to upload the local-first merge instead of
      // waiting for the learner to complete another section.
      pushed.current = JSON.stringify(result.payload);
      setSyncState('synced');
      setSyncEpoch((epoch) => epoch + 1);
    });
    return () => { alive = false; };
  }, [user, syncPayload]);

  useEffect(() => {
    if (!user || !pulled.current) return;
    if (!Object.keys(syncPayload).length || syncSignature === pushed.current) return;
    const timer = window.setTimeout(() => {
      setSyncState('saving');
      saveMlProgress(syncPayload).then((result) => {
        if (result.ok) {
          pushed.current = syncSignature;
          setSyncState('synced');
        } else {
          setSyncState(result.reason === 'rejected' ? 'rejected' : 'local');
        }
      });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [user, syncPayload, syncSignature, syncEpoch]);

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
        course={ML_WORKSPACE}
        courseTitle={course.title}
        module={open}
        modules={modules}
        bank={stats.bank.modules[open.id]}
        initialSection={params.get('section')}
        onOpen={openModule}
        onBack={() => {
          const nextParams = new URLSearchParams(params);
          nextParams.delete('module');
          nextParams.delete('section');
          setParams(nextParams);
        }}
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
            <span className="chip">{course.hours}h total</span>
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
                {hits.map((hit) => (
                  <button
                    key={hit.id}
                    type="button"
                    onClick={() => openModule(hit.moduleId, hit.section)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, borderTop: '1px solid var(--line, #e6e8ee)', padding: '6px 0', cursor: 'pointer', color: 'inherit' }}
                  >
                    <span className="small"><b>{hit.title}</b> <span className="muted">· {hit.label} · {hit.moduleTitle}</span></span>
                    <span className="small muted" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.snippet}</span>
                  </button>
                ))}
                <p className="small muted" style={{ margin: '6px 0 0' }}>{hits.length} result{hits.length === 1 ? '' : 's'} shown, ranked with title matches first.</p>
              </>
            ) : <p className="small muted" style={{ margin: '8px 0 0' }}>No record matches “{query.trim()}”. Try a shorter word.</p>}
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

      <p className="small muted" style={{ margin: '8px 0 0' }}>
        <b>Account sync · </b>
        {syncState === 'synced'
          ? `saved to your account (${mlSyncSummary(syncPayload)})`
          : syncState === 'saving'
            ? `saving ${mlSyncSummary(syncPayload)}…`
            : syncState === 'pulling'
              ? 'loading this account\u2019s ML section records…'
              : syncState === 'rejected'
                ? 'the account API rejected this payload; progress stays on this device'
                : syncState === 'local'
                  ? 'no account API on this deployment — progress stays on this device'
                  : 'sign in to sync mmod section records across devices'}
      </p>

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

      {file.capstone && (
        <>
          <div className="sec-head" id="ml-labs"><h2><FlaskConical size={16} color="var(--blue)" /> Labs, canonical datasets and Colab packs</h2><span className="line" /></div>
      <div className="card">
        <p className="small muted" style={{ margin: 0 }}>
          The five NumPy labs run in Code Bro with the bundled offline kernel. The canonical CSVs are
          already seeded into that kernel, so <code>np.genfromtxt(&apos;iris.csv&apos;)</code> works without a
          download. Scikit-learn and XGBoost packs are separate downloads for Colab or a local environment.
        </p>

        {file.labs && file.labs.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginTop: 12 }}>
            {file.labs.map((lab) => {
              const module = modules.find((item) => item.id === lab.module);
              const datasets = (lab.datasets ?? []).map((id) => file.datasets?.find((dataset) => dataset.id === id)?.title ?? id);
              return (
                <div key={lab.id} className="card" style={{ padding: 10 }}>
                  <div className="row spread" style={{ gap: 6 }}>
                    <b className="small">{lab.title}</b>
                    <span className="chip">NumPy</span>
                  </div>
                  <p className="small muted" style={{ margin: '4px 0 6px' }}>{lab.description}</p>
                  <p className="small muted" style={{ margin: '0 0 6px' }}>
                    {module ? `Module ${module.no}: ${module.title}` : lab.module} · {datasets.join(', ')}
                  </p>
                  <Link className="btn small primary" to={`/notebooks?nb=${lab.notebook}`}>Open offline lab</Link>
                </div>
              );
            })}
          </div>
        )}

        {file.datasets && file.datasets.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <b className="small">Canonical datasets — bundled, not fetched</b>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8, marginTop: 6 }}>
              {file.datasets.map((dataset) => (
                <div key={dataset.id} className="card" style={{ padding: 10 }}>
                  <div className="row spread" style={{ gap: 6 }}>
                    <b className="small">{dataset.title}</b>
                    <span className="chip">{dataset.task}</span>
                  </div>
                  <p className="small muted" style={{ margin: '4px 0 6px' }}>
                    {dataset.rows ?? '?'} rows × {dataset.featureCount ?? '?'} features · target <code>{dataset.target}</code>
                  </p>
                  <p className="small muted" style={{ margin: '0 0 6px' }}>{dataset.description}</p>
                  <a className="btn small ghost" href={`${import.meta.env.BASE_URL ?? '/'}datasets/ml/${dataset.file}`} download>
                    <Download size={11} /> Download CSV
                  </a>
                  <p className="small muted" style={{ margin: '6px 0 0', fontSize: 10 }}>{dataset.license}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {file.colabPacks && file.colabPacks.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <b className="small">Scikit-learn / XGBoost Colab packs — download, upload to Colab, Run all</b>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8, marginTop: 6 }}>
              {file.colabPacks.map((pack) => (
                <div key={pack.id} className="card" style={{ padding: 10 }}>
                  <b className="small">{pack.title}</b>
                  <p className="small muted" style={{ margin: '4px 0 6px' }}>{pack.description}</p>
                  <p className="small muted" style={{ margin: '0 0 6px', fontSize: 10 }}>{pack.requirements.join(' · ')}</p>
                  <a className="btn small ghost" href={`${import.meta.env.BASE_URL ?? '/'}colab-ml/${pack.file}`} download>
                    <Download size={11} /> Download .ipynb
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="sec-head"><h2><GraduationCap size={16} color="var(--blue)" /> Capstone project</h2><span className="line" /></div>
          <div className="card">
            <h3 style={{ margin: 0 }}>{file.capstone.title}</h3>
            <p className="small" style={{ margin: '6px 0 0' }}>{file.capstone.brief}</p>
            <p className="small muted" style={{ margin: '6px 0 0' }}><b>Dataset · </b>{file.capstone.dataset}</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginTop: 12 }}>
              {file.capstone.tiers.map((tier) => (
                <div key={tier.name} className="card" style={{ padding: 10 }}>
                  <div className="row spread" style={{ gap: 6 }}>
                    <b className="small">{tier.name}</b>
                    <span className="chip">{tier.requirements.length} requirements</span>
                  </div>
                  <p className="small muted" style={{ margin: '4px 0 6px' }}>{tier.goal}</p>
                  <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {tier.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}
                  </ul>
                  <p className="small" style={{ margin: '6px 0 0' }}><b>Deliverables · </b>{tier.deliverables.join(' ')}</p>
                  <p className="small muted" style={{ margin: '4px 0 0' }}><b>Stretch · </b>{tier.stretch.join(' ')}</p>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 12 }}>
              <b className="small">Starter — the metric contract, executed</b>
              <pre className="codeblock" style={{ margin: '6px 0 0' }}>{file.capstone.starter.code}</pre>
              <pre className="codeblock" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{file.capstone.starter.output}</pre>
            </div>

            <div style={{ marginTop: 12 }}>
              <b className="small">Milestones</b>
              <ol className="small" style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {file.capstone.milestones.map((milestone) => (
                  <li key={milestone.title} style={{ marginBottom: 4 }}><b>{milestone.title}</b> — <span className="muted">{milestone.detail}</span></li>
                ))}
              </ol>
            </div>

            <div style={{ marginTop: 12 }}>
              <b className="small">Assessment rubric (weights total 100)</b>
              <div className="small" style={{ marginTop: 4 }}>
                {rubric.map((row) => (
                  <div key={row.criterion} className="row" style={{ gap: 8, alignItems: 'flex-start', marginBottom: 3 }}>
                    <span className="chip">{row.weight}</span>
                    <span><b>{row.criterion}</b> — <span className="muted">{row.evidence}</span></span>
                  </div>
                ))}
              </div>
              <p className="small muted" style={{ margin: '6px 0 0' }}>Pass: {file.capstone.assessment.pass} Excellent: {file.capstone.assessment.excellent}</p>
            </div>
          </div>
        </>
      )}

      <div className="sec-head"><h2><ShieldCheck size={16} color="var(--blue)" /> Proof of work</h2><span className="line" /></div>
      <div className="card">
        <div className="row spread" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div>
            <b className="small">Certificate eligibility</b>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              {certificate.reason} Both conditions are measured, not assumed: all {progress.sectionsTotal} sections
              recorded and a capstone rubric at or above the course's own pass mark.
            </p>
          </div>
          <span className={`chip ${certificate.eligible ? 'easy' : ''}`}>
            {progress.sectionsDone}/{progress.sectionsTotal} sections{' · '}rubric {certificate.score}/100
            {certificate.eligible ? ` · ${certificate.grade}` : ''}
          </span>
        </div>

        {rubric.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <b className="small">Evidence checklist — tick only what you can show</b>
            <div style={{ marginTop: 4 }}>
              {rubric.map((row) => (
                <label key={row.criterion} className="row small" style={{ gap: 6, alignItems: 'flex-start', marginBottom: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={checked.includes(row.criterion)} onChange={() => toggleCriterion(row.criterion)} style={{ marginTop: 2 }} />
                  <span><b>{row.weight}</b> · {row.criterion} <span className="muted">— {row.evidence}</span></span>
                </label>
              ))}
            </div>
          </div>
        )}

        {certificate.eligible ? (
          <div className="card" style={{ marginTop: 12, padding: 14, border: '1px solid var(--blue, #2563eb)' }}>
            <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
              <b>Certificate of completion — {course.title}</b>
              <span className="chip easy">{certificate.grade}</span>
            </div>
            <p className="small" style={{ margin: '8px 0 0' }}>
              <b>{learnerName}</b> completed all {progress.modulesTotal} modules and {progress.sectionsTotal} sections
              of BroCode's Machine Learning course ({stats.entries.toLocaleString()} published items) and self-assessed the capstone at{' '}
              <b>{certificate.score}/100</b>.
            </p>
            <p className="small muted" style={{ margin: '6px 0 0' }}>
              Issued {new Date().toLocaleDateString()} · Self-issued proof of work from your own progress records;
              it is not an accredited qualification. Print it or save it as a PDF from your browser.
            </p>
            <button type="button" className="btn small primary" style={{ marginTop: 8 }} onClick={() => window.print()}>
              Print / save as PDF
            </button>
          </div>
        ) : (
          <p className="small muted" style={{ margin: '10px 0 0' }}>
            {next
              ? `Next untouched: ${N_SECTION_LABEL[next.section]} in ${modules.find((module) => module.id === next.moduleId)?.title}.`
              : 'Every section is recorded — finish the capstone evidence checklist to unlock the certificate.'}
          </p>
        )}
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
