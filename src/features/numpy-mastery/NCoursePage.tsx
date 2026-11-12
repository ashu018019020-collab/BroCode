import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, ChevronRight, GraduationCap, Play, ShieldCheck, Target, Trophy } from 'lucide-react';
import { useNumpyCourse } from '../../core/data/ncourse';
import { setState, useSavedAnswer, useStore } from '../../core/storage/store';
import { collectNumpyProgress, mergeNumpyProgress, numpySyncSummary } from '../../core/learning/numpy-sync';
import { loadNumpyProgress, saveNumpyProgress } from '../../core/data/numpy-progress';
import { N_BANK_CATEGORY_LABEL, N_BANK_CATEGORY_ORDER, N_CAPSTONE_KEY, N_LAST_KEY, N_SECTIONS, N_SECTION_LABEL, isModuleComplete, nProgress, nSectionKey, nextSection, numpyCertificate, numpyReport, revisionPlan, searchCourse } from '../../core/learning/ncourse';
import { useAuth } from '../../core/auth/AuthProvider';
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
  /** The plan is derived from the same records the report counts, weakest module first. */
  const revision = useMemo(() => revisionPlan(modules, state.attempts, 8), [modules, state.attempts]);
  const { user } = useAuth();
  const [capRaw, saveCap] = useSavedAnswer(N_CAPSTONE_KEY);
  const checked = useMemo<string[]>(() => {
    try {
      const parsed = JSON.parse(capRaw || '[]');
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch { return []; }
  }, [capRaw]);
  const rubric = file?.capstone?.rubric ?? [];
  const certificate = useMemo(
    () => numpyCertificate(report, rubric, checked),
    [report, rubric, checked],
  );
  const toggleCriterion = (criterion: string) => {
    const nextList = checked.includes(criterion) ? checked.filter((c) => c !== criterion) : [...checked, criterion];
    saveCap(JSON.stringify(nextList));
  };
  const learnerName = (state.profile.name || user?.name || 'Learner').trim();
  /*
   * Account sync for the course's own records. Pull once when the account arrives, merge server-only
   * records into the local map (local always wins), then push a debounced snapshot after changes.
   * Every outcome is named so the chip never says "synced" when the deployment has no API.
   */
  const [syncState, setSyncState] = useState<'idle' | 'pulling' | 'synced' | 'local' | 'saving' | 'rejected'>('idle');
  const pushed = useRef<string>('');
  const pulled = useRef(false);
  const syncPayload = useMemo(() => collectNumpyProgress(state.attempts), [state.attempts]);
  const syncSignature = useMemo(() => JSON.stringify(syncPayload), [syncPayload]);

  useEffect(() => { pulled.current = false; setSyncState('idle'); }, [user?.name]);

  useEffect(() => {
    if (!user || pulled.current) return;
    pulled.current = true;
    setSyncState('pulling');
    let alive = true;
    loadNumpyProgress().then((result) => {
      if (!alive) return;
      if (!result.ok) {
        setSyncState(result.reason === 'rejected' || result.reason === 'invalid' ? 'rejected' : 'local');
        return;
      }
      const merged = mergeNumpyProgress(syncPayload, result.payload);
      if (merged.added.length) {
        setState((s) => ({ ...s, attempts: { ...merged.payload, ...s.attempts } }));
      }
      pushed.current = JSON.stringify(merged.payload);
      setSyncState('synced');
    });
    return () => { alive = false; };
  }, [user, syncPayload]);

  useEffect(() => {
    if (!user || !pulled.current) return;
    if (!Object.keys(syncPayload).length || syncSignature === pushed.current) return;
    const timer = window.setTimeout(() => {
      setSyncState('saving');
      saveNumpyProgress(syncPayload).then((result) => {
        if (result.ok) {
          pushed.current = syncSignature;
          setSyncState('synced');
        } else {
          setSyncState(result.reason === 'rejected' ? 'rejected' : 'local');
        }
      });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [user, syncPayload, syncSignature]);
  const [query, setQuery] = useState('');
  const hits = useMemo(() => searchCourse(modules, query), [modules, query]);
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
          bank={stats.bank.modules[open.id]}
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
        <div className="row spread" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="row" style={{ gap: 12, minWidth: 'min(260px, 100%)' }}>
            <span className="cc-logo"><NLogo size={56} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="chip" style={{ marginBottom: 6 }}><GraduationCap size={12} /> NUMPY MASTERY</div>
              <h1 style={{ margin: 0 }}>{course.title}</h1>
              <p className="muted small" style={{ margin: '6px 0 0', maxWidth: 620 }}>{course.tagline}</p>
            </div>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="chip"><BookOpen size={12} /> {stats.modules} modules</span>
            <span className="chip"><Target size={12} /> {stats.entries.toLocaleString()} records</span>
            <span className="chip">{modules.reduce((a, m) => a + (m.hours || 0), 0)}h total</span>
          </div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {next && (
            <Link className="btn primary" to={`/numpy?module=${next.module.id}`}>
              <Play size={14} /> {progress.sectionsDone ? 'Continue' : 'Start'} learning
            </Link>
          )}
          <span className="chip"><Trophy size={12} /> {progress.pct}% complete</span>
          <span className="chip">{progress.modulesDone}/{progress.modulesTotal} modules done</span>
          {next && <span className="small muted">Next: {next.module.title} · {N_SECTION_LABEL[next.section]}</span>}
        </div>
        <div style={{ marginTop: 10, maxWidth: 520 }}><Bar pct={progress.pct} /></div>
      </div>

      <div className="sec-head" style={{ marginTop: 14 }}>
        <h2><BookOpen size={16} color="var(--blue)" /> Modules</h2><span className="line" />
        <span className="small muted">{modules.length} modules · ten sections each</span>
      </div>

      <div className="card" style={{ marginBottom: 10 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${stats.entries.toLocaleString()} records — try: broadcast, ValueError, percentile`}
          aria-label="Search the NumPy course"
          style={{ width: '100%' }}
        />
        {query.trim().length >= 2 && (
          hits.length ? (
            <div style={{ marginTop: 8 }}>
              {hits.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  onClick={() => setParams({ module: hit.moduleId, section: hit.section })}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, borderTop: '1px solid var(--line, #e6e8ee)', padding: '6px 0', cursor: 'pointer', color: 'inherit' }}
                >
                  <span className="small"><b>{hit.title}</b> <span className="muted">· {hit.label} · {hit.moduleTitle}</span></span>
                  <span className="small muted" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.snippet}</span>
                </button>
              ))}
              <p className="small muted" style={{ margin: '6px 0 0' }}>{hits.length} result{hits.length === 1 ? '' : 's'} shown, ranked with title matches first.</p>
            </div>
          ) : <p className="small muted" style={{ margin: '8px 0 0' }}>No record matches “{query.trim()}”. Try a shorter word.</p>
        )}
      </div>

      <div className="tile-grid tile-grid-lg">
        {modules.map((m) => {
          const done = isModuleComplete(m.id, state.attempts);
          const sectionsDone = N_SECTIONS.filter((s) => state.attempts[nSectionKey(m.id, s.key)]).length;
          const bank = stats.bank.modules[m.id];
          return (
            <Link
              key={m.id}
              to={`/numpy?module=${m.id}`}
              className={`tile tech${done ? ' on' : ''}`}
              data-agent-action={`numpy:module:${m.id}`}
            >
              <span className="ic" style={{ fontWeight: 700, fontSize: 17, color: done ? 'var(--blue, #2563eb)' : 'var(--muted)' }}>
                {String(m.no).padStart(2, '0')}
              </span>
              <span className="t" style={{ flex: 1, minWidth: 0 }}>
                <b>{m.title}</b>
                <span>{m.entries} entries · {m.hours}h · {sectionsDone}/10 sections{done ? ' · complete' : ''}</span>
                {bank && (
                  <span
                    className="muted"
                    style={{ display: 'block', marginTop: 3, fontSize: 11, lineHeight: 1.4 }}
                    aria-label={`Module ${m.no} question bank: ${bank.total} items`}
                  >
                    Bank {bank.total} · {N_BANK_CATEGORY_ORDER
                      .filter((key) => bank.categories[key])
                      .map((key) => `${N_BANK_CATEGORY_LABEL[key] ?? key} ${bank.categories[key]}`)
                      .join(' · ')}
                  </span>
                )}
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
          </div>
        </div>
        <div style={{ marginTop: 10, maxWidth: 520 }}><Bar pct={report.pct} /></div>

      </div>

      <details className="card" style={{ marginTop: 10 }}>
        <summary className="small" style={{ cursor: 'pointer' }}>
          <b>About this course</b> — description, standard and prerequisites
        </summary>
        <p className="small muted" style={{ margin: '8px 0 0', maxWidth: 820 }}>{course.description}</p>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <span className="chip"><ShieldCheck size={12} /> {course.standard}</span>
          {course.prerequisites.map((p) => <span key={p} className="chip">{p}</span>)}
          <span className="chip">{course.level}</span>
        </div>
      </details>

      {revision.length > 0 && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
            <b className="small">Revision plan — weakest modules first</b>
            <span className="chip">{report.weak.length} untouched sections</span>
          </div>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            Ranked by how little of each module is recorded, then by module and section order. Start at
            rank 1: one session there closes the most gaps.
          </p>
          <ol style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
            {revision.map((item) => (
              <li key={`${item.moduleId}:${item.section}`} style={{ marginBottom: 4 }}>
                <button
                  type="button"
                  className="row"
                  style={{
                    width: '100%', gap: 8, alignItems: 'center', textAlign: 'left', cursor: 'pointer',
                    background: 'none', border: 0, borderTop: '1px solid var(--line, #e6e8ee)',
                    padding: '6px 0', color: 'inherit',
                  }}
                  onClick={() => setParams({ module: item.moduleId, section: item.section })}
                >
                  <span className="chip">{item.rank}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b className="small">{item.label}</b>{' '}
                    <span className="small muted">· {item.moduleTitle}</span>
                    <span className="small muted" style={{ display: 'block' }}>{item.reason}</span>
                  </span>
                  <ChevronRight size={13} className="muted" />
                </button>
              </li>
            ))}
          </ol>
          {report.weak.length > revision.length && (
            <p className="small muted" style={{ margin: '6px 0 0' }}>
              Showing the {revision.length} highest-priority of {report.weak.length} untouched sections.
            </p>
          )}
        </div>
      )}

      <div className="sec-head"><h2><BookOpen size={16} color="var(--blue)" /> Learning outcomes</h2><span className="line" /></div>
      <div className="card">
        <ol className="small muted" style={{ margin: 0, paddingLeft: 18, columns: 2, columnGap: 24 }}>
          {course.outcomes.map((o) => <li key={o} style={{ marginBottom: 6 }}>{o}</li>)}
        </ol>
      </div>

      {file?.capstone && (
        <>
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
                    {tier.requirements.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                  <p className="small" style={{ margin: '6px 0 0' }}><b>Deliverables · </b>{tier.deliverables.join(' ')}</p>
                  <p className="small muted" style={{ margin: '4px 0 0' }}><b>Stretch · </b>{tier.stretch.join(' ')}</p>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 12 }}>
              <b className="small">Starter — the shape contract, executed</b>
              <pre className="codeblock" style={{ margin: '6px 0 0' }}>{file.capstone.starter.code}</pre>
              <pre className="codeblock" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{file.capstone.starter.output}</pre>
            </div>

            <div style={{ marginTop: 12 }}>
              <b className="small">Milestones</b>
              <ol className="small" style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {file.capstone.milestones.map((m) => (
                  <li key={m.title} style={{ marginBottom: 4 }}><b>{m.title}</b> — <span className="muted">{m.detail}</span></li>
                ))}
              </ol>
            </div>

            <div style={{ marginTop: 12 }}>
              <b className="small">Assessment rubric (weights total 100)</b>
              <div className="small" style={{ marginTop: 4 }}>
                {file.capstone.rubric.map((row) => (
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
              {certificate.reason} Both conditions are measured, not assumed: all {report.sectionsTotal} sections
              recorded and a capstone rubric at or above the course's own pass mark.
            </p>
          </div>
          <span className={`chip ${certificate.eligible ? 'easy' : ''}`}>
            {report.sectionsDone}/{report.sectionsTotal} sections{' · '}rubric {certificate.score}/100
            {certificate.eligible ? ` · ${certificate.grade}` : ''}
          </span>
        </div>

        {rubric.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <b className="small">Capstone rubric — tick only what you can show</b>
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
              <b>Certificate of completion — NumPy Mastery</b>
              <span className="chip easy">{certificate.grade}</span>
            </div>
            <p className="small" style={{ margin: '8px 0 0' }}>
              <b>{learnerName}</b> completed all {report.modulesTotal} modules and {report.sectionsTotal} sections
              of BroCode's NumPy Mastery course ({stats.entries} published items) and self-assessed the capstone at{' '}
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
            {report.weak.length > 0
              ? `Next untouched: ${report.weak[0].label} in ${report.weak[0].moduleTitle}.`
              : 'Every section is recorded — finish the capstone rubric to unlock the certificate.'}
          </p>
        )}
      </div>

      <p className="small muted" style={{ margin: '8px 0 0' }}>
        <b>Account sync · </b>
        {syncState === 'synced'
          ? `saved to your account (${numpySyncSummary(syncPayload)})`
          : syncState === 'saving'
            ? `saving ${numpySyncSummary(syncPayload)}…`
            : syncState === 'pulling'
              ? 'loading this account\u2019s course records…'
              : syncState === 'rejected'
                ? 'the account API rejected this payload; progress stays on this device'
                : syncState === 'local'
                  ? 'no account API on this deployment — progress stays on this device'
                  : 'sign in to sync section records and written drafts across devices'}
      </p>

      <p className="small muted" style={{ marginTop: 10 }}>
        Every module holds all ten sections — Learn, Interview, Coding Lab, Logic, Debug, Practice
        Solutions, Mini Project, Project Lab, Defense and Checkpoint. Counts are the records that
        shipped in the content pack, not a target: the pack's own progress ledger tracks the road to
        50 entries per section.
      </p>
    </div>
  );
}
