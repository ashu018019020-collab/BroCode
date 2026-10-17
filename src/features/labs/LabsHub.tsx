import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, FlaskConical, ArrowLeft, ChevronRight, Play, PenLine } from 'lucide-react';
import { useI18n } from '../../app/i18n';
import type { LocaleKey } from '../../app/i18n/locales';
import { NAV, TRACK_DEFS } from '../../app/App';
import { useStore } from '../../core/storage/store';
import { useCourseIndex } from '../../core/data/courses';
import { useBankManifest } from '../../core/data/questions';
import { useNotebooks, type NotebookMeta } from '../../core/data/notebooks';
import { usePathCtx } from '../../core/data/paths';
import { HubGrid } from '../../components/shared/HubGrid';
import { notebookCellsRunFor } from '../../core/learning/coverage';
import { EXTRA_PATHS } from '../../core/learning/paths';
import {
  continueLab, courseRoutes, labSummary, labTopics, routesOfSteps, stepOfSections,
  type LabCourseLike, type LabSummary, type LabTopic,
} from '../../core/learning/labs';
import type { SubjectRange } from '../../core/learning/subjects';

/**
 * The Labs pillar: every surface where the learner RUNS something.
 *
 * Practice answers questions; a lab executes. So this page is deliberately NOT the practice page
 * with a different word on it: it opens on a SUBJECT ("what do I want to build/run?"), and each subject
 * shows the topics its course files hands-on content under — the notebook authored for that section,
 * the runtime the course assigns to that section's step, and the section's coding exercises. A topic
 * with none of the three says so instead of showing a zero.
 *
 * Nothing here is hand-listed: the subjects are the track registry, the routes are the lab family of
 * `EXTRA_PATHS` (so a new lab page appears here by being registered, not by editing this file), and
 * every count comes from published data — the bank manifest, the notebook manifest, and
 * `generated/courses/index.json` (`sections` + `lab_routes`), which is why the index carries the
 * lab map. Progress is notebook cells actually run (`nb:<file>:<cell>` — a notebook's own completion
 * unit), never a percentage invented for a subject that has no notebooks.
 */
const LAB_ROUTES = EXTRA_PATHS.filter((p) => p.group === 'lab').map((p) => p.route);

/** A tool's label is the app's own (NAV) — the same source the sidebar and the hub grids read. */
const labelOf = (route: string) => NAV.find((n) => n.to === route)?.label ?? route;

const notebookHref = (file: string) => `/notebooks?nb=${file}`;

const pct = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : null);

export default function LabsHub() {
  const { t } = useI18n();
  const state = useStore();
  const ctx = usePathCtx();
  const index = useCourseIndex();
  const banks = useBankManifest();
  const notebooks = useNotebooks();
  const [params] = useSearchParams();

  /** Every count of a notebook's progress comes from the family the Notebook Lab itself writes. */
  const cellsRun = useMemo(
    () => (file: string) => notebookCellsRunFor(state.attempts, file),
    [state.attempts],
  );

  const courses: LabCourseLike[] = index?.courses ?? [];
  const stepOf = useMemo(() => stepOfSections(courses), [courses]);
  const routesByStep = useMemo(() => routesOfSteps(courses), [courses]);
  const ranges: SubjectRange[] = useMemo(
    () => TRACK_DEFS.map((d) => ({ id: d.id, from: d.from, to: d.to })),
    [],
  );
  const rangeOf = (id: string): SubjectRange | null => ranges.find((r) => r.id === id) ?? null;

  /** One subject's topics, and the summary its card prints. Pure rules, called with published data. */
  const viewOf = (range: SubjectRange): { topics: LabTopic[]; summary: LabSummary } => {
    const topics = labTopics(banks?.sections ?? [], range, stepOf, routesByStep, notebooks ?? [], cellsRun);
    const routes = [...topics.flatMap((tp) => tp.routes), ...courseRoutes(courses, range)];
    return { topics, summary: labSummary(topics, routes, LAB_ROUTES) };
  };

  const subject = TRACK_DEFS.find((d) => d.id === params.get('subject')) ?? null;
  const subjectRange = subject ? rangeOf(subject.id) : null;
  const { topics, summary } = subjectRange ? viewOf(subjectRange) : { topics: [], summary: null };

  const cont = useMemo(() => continueLab(state.attempts, notebooks ?? [], cellsRun), [state.attempts, notebooks, cellsRun]);
  const cells = ctx.notebooks ? ctx.notebooks.cells : null;

  return (
    <div>
      <div className="card glow fadeup">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260 }}>
            <div className="chip" style={{ marginBottom: 6 }}>LABS</div>
            <h1 style={{ margin: 0 }}>Write code. Run it. Build it.</h1>
            <p className="muted small" style={{ margin: '8px 0 0', maxWidth: 640 }}>
              Hands-on labs follow the same course structure: pick a subject, open its topics, then
              write and run code there in the notebook or runtime. Everything runs in the browser, without internet.
            </p>
          </div>
          {/* Secondary on purpose: the numbers are here to orient, not to lead the page. */}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="chip"><FlaskConical size={12} /> {LAB_ROUTES.length} labs</span>
            {notebooks && <span className="chip"><BookOpen size={12} /> {notebooks.length} notebooks</span>}
            {cells !== null && <span className="chip">{ctx.counts.notebookCells} / {cells} notebook cells run</span>}
            {ctx.counts.ragRounds > 0 && <span className="chip">{ctx.counts.ragRounds} retrieval rounds</span>}
          </div>
        </div>
      </div>

      {/* Continue: the notebook most recently touched and not finished, from the cell records. */}
      {cont && (
        <>
          <div className="sec-head"><h2><Play size={16} color="var(--amber)" /> Continue where you left off</h2><span className="line" /></div>
          <div className="card fadeup">
            <Link className="q-row" to={notebookHref(cont.notebook.file)} title={cont.notebook.intro}>
              <span className="ic"><BookOpen size={14} /></span>
              <span className="t">
                {cont.notebook.title}
                <span className="small muted" style={{ display: 'block' }}>
                  {cont.notebook.topic} · {cont.done}/{cont.total} code cells run
                </span>
              </span>
              <b>{pct(cont.done, cont.total)}%</b>
              <ChevronRight size={14} />
            </Link>
          </div>
        </>
      )}

      <div className="sec-head"><h2><FlaskConical size={16} color="var(--cyan)" /> Choose your lab</h2><span className="line" /></div>
      <p className="small muted" style={{ margin: '0 0 8px' }}>
        Open the subject for the technology you want to try hands-on — each card's numbers come from its own course,
        notebooks and exercises.
      </p>
      <div className="tile-grid">
        {TRACK_DEFS.map((d) => {
          const Icon = d.icon;
          const range = rangeOf(d.id);
          const s = range ? viewOf(range).summary : null;
          const on = subject?.id === d.id;
          return (
            <Link key={d.id} to={`/labs?subject=${d.id}`} className={`tile${on ? ' on' : ''}`}>
              <span className="ic"><Icon size={18} /></span>
              <span className="t" style={{ flex: 1, minWidth: 0 }}>
                <b>{t(d.nameKey as LocaleKey)}</b>
                <span>
                  {!s ? '…' : `${s.labs.length} labs · ${s.notebooks} ${s.notebooks === 1 ? 'notebook' : 'notebooks'} · ${s.exercises} exercises`}
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      {subject && summary && (
        <div className="card fadeup" style={{ marginTop: 12 }}>
          <div className="row spread" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <div className="row" style={{ gap: 10, minWidth: 0 }}>
              <span className="suj-ic"><subject.icon size={18} /></span>
              <span style={{ minWidth: 0 }}>
                <b style={{ fontSize: '1rem' }}>{t(subject.nameKey as LocaleKey)} Lab</b>
                <span className="small muted" style={{ display: 'block' }}>
                  {`${summary.topics} topics · ${summary.labs.length} labs · ${summary.notebooks} ${summary.notebooks === 1 ? 'notebook' : 'notebooks'} · ${summary.exercises} exercises`}
                </span>
              </span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Link className="btn small ghost" to="/labs"><ArrowLeft size={13} /> All subjects</Link>
              {summary.notebooks > 0 && (
                <span className="chip">{summary.cellsRun} / {summary.codeCells} notebook cells run</span>
              )}
            </div>
          </div>

          {/* The labs this subject's course assigns, so the runtime the learner needs is one hop away
              even when it is filed under a later step (the RAG lab sits two steps after its section). */}
          {summary.labs.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0 2px' }}>
              {summary.labs.map((route) => (
                <Link key={route} className="chip" to={route}>{labelOf(route)}</Link>
              ))}
            </div>
          )}

          {!summary.hasContent && (
            <p className="muted small" style={{ margin: '10px 0 0' }}>
              🧪 This subject has no hands-on lab yet — study the topic in the course, do the coding exercises
              below, and the lab will appear here as soon as it is available.
            </p>
          )}

          {topics.map((tp) => {
            const hasNotebook = tp.notebooks.length > 0;
            /**
             * A topic with its OWN notebook does not also get the `/notebooks` shelf button: the
             * exact file is strictly better than the shelf it sits on, and two buttons that open
             * the same surface is how a row starts looking like noise. Other runtimes stay.
             */
            const routes = tp.routes.filter((r) => !(hasNotebook && r === '/notebooks'));
            const route = routes[0] ?? null;
            return (
              <div key={tp.id} className="q-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <span className="ic"><span className="small">{String(tp.no).padStart(2, '0')}</span></span>
                <span className="t" style={{ minWidth: 200 }}>
                  {tp.title}
                  <span className="small muted" style={{ display: 'block' }}>
                    {[
                      hasNotebook ? `${tp.notebooks.length} notebook · ${tp.codeCells} code cells` : null,
                      tp.exercises > 0 ? `${tp.exercises} coding exercises` : null,
                      tp.step !== null && !route && !hasNotebook && tp.exercises === 0 ? `step ${tp.step}` : null,
                    ].filter(Boolean).join(' · ') || 'course topic'}
                  </span>
                </span>
                <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {hasNotebook && (
                    <Link className="btn small" to={notebookHref(tp.notebooks[0].file)}>
                      <BookOpen size={13} /> Notebook
                    </Link>
                  )}
                  {routes.map((r) => (
                    <Link key={r} className="btn small" to={r}><Play size={13} /> {labelOf(r)}</Link>
                  ))}
                  {tp.exercises > 0 && (
                    <Link className="btn small ghost" to={`/questions?section=${tp.id}&type=coding`}>
                      <PenLine size={13} /> Exercises
                    </Link>
                  )}
                  {!hasNotebook && !route && tp.exercises === 0 && (
                    <span className="small muted">no hands-on lab yet</span>
                  )}
                </span>
              </div>
            );
          })}
          <p className="small muted" style={{ margin: '10px 0 0' }}>
            Each topic opens the lab for its course step: the notebook belongs to the section that teaches it,
            and the runtime is the one the course assigns to that step.
          </p>
        </div>
      )}

      <div className="sec-head"><h2>Global tools</h2><span className="line" /></div>
      <p className="small muted" style={{ margin: '0 0 8px' }}>
        These workspaces are not tied to a single subject — whenever you want to run something, come straight here.
      </p>
      <HubGrid routes={LAB_ROUTES} />

      {/* The notebooks, each named with the section it was authored for — the same file the subject
          panel opens, so a learner can see the whole shelf without losing the subject structure. */}
      {!!notebooks?.length && (
        <>
          <div className="sec-head"><h2>All notebooks</h2><span className="line" /></div>
          <div className="tile-grid">
            {notebooks.map((nb: NotebookMeta) => {
              const done = cellsRun(nb.file);
              const p = pct(done, nb.codeCells);
              return (
                <Link key={nb.file} to={notebookHref(nb.file)} className="tile">
                  <span className="ic"><BookOpen size={18} /></span>
                  <span className="t" style={{ flex: 1, minWidth: 0 }}>
                    <b>{nb.title}</b>
                    <span>{nb.topic} · {nb.codeCells} code cells{nb.section ? ` · ${nb.section.toUpperCase()}` : ''}</span>
                    {p !== null && <span className="bar" style={{ marginTop: 6 }}><div style={{ width: `${p}%` }} /></span>}
                  </span>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
