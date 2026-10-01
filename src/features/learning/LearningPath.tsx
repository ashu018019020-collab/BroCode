import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Map as MapIcon, List, ChevronDown, ChevronUp, ChevronRight, Target, BarChart3, Lightbulb, CalendarCheck,
  Compass, BookOpen, BookMarked, ListChecks, FileText, Wrench, Mic2, Bot, Brain, Code2, Database, Sparkles,
  NotebookPen,
} from 'lucide-react';
import { NotebookShelf } from '../../components/code/JupyterNotebook';
import PlaybookLayer from '../../components/learning/PlaybookLayer';
import PathGrid from '../../components/learning/PathGrid';
import { SurfaceLogo } from '../../components/shared/SurfaceLogo';
import { STAGE_GLYPH, MASTER_STEPS, DOMAIN_GLYPH, DOMAIN_NAME, TRACK_DOMAINS } from '../../core/learning/surfaces';
import { useCurriculum } from '../../core/data/curriculum';
import { usePlaybookCoverage } from '../../core/data/playbook';
import { useTrackIndex } from '../../core/data/tracks';
import { useStore } from '../../core/storage/store';
import { sectionProgress, currentSection } from '../../core/learning/progress';
import { bankTouched } from '../../core/learning/coverage';
import { stageAttempt, learnView } from '../../core/platform/keys';
import { Bar, ProgressRing } from '../../components/ui/ui';
import { useI18n } from '../../app/i18n';
import { TRACK_DEFS } from '../../app/App';
import { STEPS, PHASES, phaseOf, chapterStats, stepStat, stepTrack, stepSections, masteryOf, type StepKind } from '../../core/learning/roadmap';
import { useNotebooks } from '../../core/data/notebooks';
import type { LocaleKey } from '../../app/i18n/locales';

/**
 * Learning Path — the master roadmap.
 *
 * There are two sources behind this app and they are NOT in the same order:
 *
 *   · the curriculum's 29 sections, grouped into the 8 tracks, and
 *   · the Playbook V15 document's 36 chapters, numbered the way the PDF prints them.
 *
 * Until now this page showed the tracks and the document's chapter list as two separate things —
 * eight track boxes, then (on /playbook) 36 chapters in PDF order. Both were honest and neither was
 * a plan: PDF order puts Logic + DSA after the agent labs, the LLM foundation before the data work,
 * and the 205-question interview bank at chapter five. `engine/roadmap.ts` owns the ONE re-ordering
 * (36 learning steps, each carrying its own chapters), this page renders it, and
 * `scripts/tests/roadmap.test.mjs` proves against the real manifest that no chapter fell off it.
 *
 * So a step here is one row of the road: its number is the node in the rail, its tone is its PHASE
 * (colour says "which part of the journey", never "how good"), the ring is the real mastery of the
 * sections that teach it, and the panel holds everything else — what it teaches, when it is done,
 * which chapters it is read from, what it is worth in the document, and where to practise it. The
 * 25 other surfaces continue on the same rail underneath (`PathGrid`, numbered on from step 36).
 */
export default function LearningPath() {
  const { sections } = useCurriculum();
  const trackIndex = useTrackIndex();
  const state = useStore();
  const { t } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();
  const [view, setView] = useState<'roadmap' | 'list'>('roadmap');
  const [open, setOpen] = useState<string | null>(null);

  /** The Playbook V15 layer: its coverage rows feed the track strip and the rail. */
  const pb = usePlaybookCoverage(TRACK_DEFS);

  /** Real mastery per section — the only progress figure this page is allowed to print. */
  const secPct = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sections) map.set(s.id, sectionProgress(s, state).masterPct);
    return map;
  }, [sections, state]);
  const pctOf = (id: string) => secPct.get(id) ?? 0;

  /** Track mastery is the average of the sections the track owns. */
  const trackPct = useMemo(() => {
    const fn = (key: string) => {
      const def = TRACK_DEFS.find((d) => d.id === key)!;
      const secs = sections.filter((s) => s.no >= def.from && s.no <= def.to);
      if (!secs.length) return 0;
      return Math.round(secs.reduce((a, s) => a + (secPct.get(s.id) ?? 0), 0) / secs.length);
    };
    return fn;
  }, [sections, secPct]);

  /**
   * The document, attributed to chapters. Section attribution comes from the manifest; the counts
   * and the practised figures come from items.json, which is derived from the banks — the only
   * thing a learner can actually open.
   */
  const stats = useMemo(
    () => chapterStats(pb.index?.chapters ?? null, pb.items ?? null, (id) => bankTouched(state.attempts, id)),
    [pb.index, pb.items, state.attempts],
  );

  /**
   * One row per step: its document share, its track, the sections that teach it, its mastery — and
   * the practice notebooks those sections own.
   *
   * A notebook is filed under the SECTION it practices (`metadata.aiml.section`), and a step is
   * defined by the sections it teaches, so the two already agree: joining them here is what puts
   * "Python Lists" inside the Python step instead of leaving it reachable only from the Notebook
   * Lab shelf. The Lab stays the launcher — this is the same file, opened from where it is taught.
   */
  const notebooks = useNotebooks();
  const rows = useMemo(() => STEPS.map((step) => {
    const stat = stepStat(step, stats);
    const track = stepTrack(step, stats, sections, TRACK_DEFS);
    const own = stepSections(step, stats, sections, TRACK_DEFS);
    const mastery = masteryOf(own.map((s) => s.id), pctOf);
    const ids = new Set(own.map((s) => s.id));
    const nbs = (notebooks ?? []).filter((n) => ids.has(n.section));
    return { step, stat, track, def: TRACK_DEFS.find((d) => d.id === track) ?? null, own, mastery, nbs };
  }), [stats, sections, secPct, notebooks]);

  /** The step the learner is on: the first one not fully mastered. Nothing is locked. */
  const current = rows.find((r) => (r.mastery ?? 0) < 100) ?? rows[rows.length - 1];
  const openNo = open ?? String(current.step.no);

  /**
   * `/path#s18` opens step 18 — the deep link the Playbook's chapter index uses, so clicking a
   * chapter there lands on the step where it is read. Hash-only navigation does not reload the
   * document, hence an effect on `loc.hash` rather than a mount-time read.
   *
   * The hashless case RESETS rather than doing nothing: arriving at plain `/path` from a deep link
   * would otherwise keep the chapter's step open, so the same sidebar click would show a different
   * page depending on where you had been. No hash means the step the learner is on, always.
   */
  useEffect(() => {
    const h = loc.hash.replace('#', '');
    if (!h.startsWith('s') || !STEPS.some((x) => String(x.no) === h.slice(1))) { setOpen(null); return; }
    setOpen(h.slice(1));
    // Aim at the step's HEAD, not at its whole box: an opened step is ~400px tall, so centring
    // the box lands mid-panel with the title already scrolled off. And land TWICE, because the
    // first jump is measured against a layout that is still moving — opening step 20 also
    // collapses the step that was open, which shifts everything above the target by a panel.
    // Measured before the second pass: the head sat 902px above the viewport.
    const land = () => document.getElementById(h)?.querySelector('.ch-head')?.scrollIntoView({ block: 'center' });
    const raf = requestAnimationFrame(() => requestAnimationFrame(land));
    const later = setTimeout(land, 140);
    return () => { cancelAnimationFrame(raf); clearTimeout(later); };
  }, [loc.hash]);

  const cur = currentSection(sections, state);
  const curPct = sectionProgress(cur, state).masterPct;
  const overall = Math.round(sections.reduce((a, s) => a + sectionProgress(s, state).masterPct, 0) / Math.max(1, sections.length));

  const weak = useMemo(() => {
    const counts = new Map<string, { topic: string; n: number; fixed: number }>();
    for (const m of state.mistakes) {
      const e = counts.get(m.topic) ?? { topic: m.topic, n: 0, fixed: 0 };
      e.n += 1;
      if (m.fixed) e.fixed += 1;
      counts.set(m.topic, e);
    }
    return [...counts.values()].filter((e) => e.n >= 1).sort((a, b) => b.n - a.n).slice(0, 5);
  }, [state.mistakes]);

  const weeklyDone = useMemo(() => {
    let acts = 0;
    for (let i = 0; i < 7; i++) acts += Math.floor((state.activity[new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)] ?? 0) / 25);
    return Math.min(5, acts);
  }, [state.activity]);

  const firstOpenTask = useMemo(() => {
    const m = { min: Infinity, sid: cur.id, stage: 'learn' };
    for (const s of sections) {
      if (s.no > cur.no) break;
      for (const stage of ['learn', 'interview', 'coding', 'logic', 'debug', 'mini'] as const) {
        // `view:` is only ever written for the learn stage (`learnView`), so for any other stage the
        // second key never existed — this asks for the one marker that can actually be there.
        const anyPending = !state.attempts[stageAttempt(s.id, stage)] && !(stage === 'learn' && state.attempts[learnView(s.id)]);
        if (anyPending && s.no < m.min) { m.min = s.no; m.sid = s.id; m.stage = stage; }
      }
    }
    return m;
  }, [sections, state.attempts, cur]);

  const slugOf = (key: string | null) => {
    const def = TRACK_DEFS.find((d) => d.id === key);
    if (!def) return null;
    const title = t(def.nameKey as LocaleKey);
    const byTitle = trackIndex?.find((x) => x.title === title);
    if (byTitle) return byTitle.slug;
    const SLUGS: Record<string, string> = {
      python: 'python-core', data: 'numpy-pandas', sql: 'sql', ml: 'ml-nlp',
      genai: 'genai', agentic: 'agentic-ai', apis: 'apis-production', interview: 'interview-projects',
    };
    return SLUGS[def.id] ?? null;
  };

  /** The 8 tracks as a strip: still the way into a track page, no longer a second roadmap. */
  const trackStrip = TRACK_DEFS.map((def) => ({
    def,
    pct: trackPct(def.id),
    slug: slugOf(def.id),
    recs: (def.prereq ?? []).filter((p) => trackPct(p) < 60),
  }));
  const doneTracks = trackStrip.filter((r) => r.pct >= 100).length;

  return (
    <div>
      {/*
       * No page hero. The page used to open with a title, a one-line pitch and four chips
       * ("36 steps", "8 Learning Tracks", "0% Overall Progress", "Skills: …") — a banner that
       * repeated the breadcrumb above it, the track strip below it and the level chip in the
       * sidebar, ~120px of chrome before the first thing a learner can actually DO.
       *
       * The route still says where you are (the crumb reads "Learning Path — 8-track AI Engineer
       * roadmap"), and the numbers that were decoration here are live below: the strip carries each
       * track's own percentage, the rail carries the overall one. What is left is the switch and the
       * plan itself.
       */}
      <div className="row" style={{ margin: '0 0 14px' }}>
        <div className="lang-toggle">
          <button className={view === 'roadmap' ? 'on' : ''} onClick={() => setView('roadmap')}><MapIcon size={14} style={{ verticalAlign: -2 }} /> {t('path.viewRoadmap')}</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><List size={14} style={{ verticalAlign: -2 }} /> {t('path.viewList')}</button>
        </div>
      </div>

      <div className="path-grid">
        <div>
          {view === 'roadmap' ? (
            <>
              {/* The 8 tracks, as a strip rather than eight full-size boxes: the boxes below are the
                  road, and a track is a way INTO a subject rather than a step of the journey. */}
              <div className="rmap-tracks">
                <span className="small muted">{t('path.tracksTitle')}</span>
                {trackStrip.map(({ def, pct, slug, recs }) => {
                  /*
                   * The DOMAIN identity, not a track glyph: a track is a slice of the curriculum,
                   * and the technology it teaches is what a learner recognises — Python is Python
                   * whether it is taught in the Python track or mentioned inside the ML one. A track
                   * that owns two domains (NumPy + Pandas, ML + NLP) shows both marks, side by side,
                   * which is the honest picture of what that track covers.
                   */
                  const domains = TRACK_DOMAINS[def.id] ?? [];
                  return (
                    <Link
                      key={def.id}
                      className={`rmap-trackchip tone-${def.tone}`}
                      to={slug ? `/track/${slug}` : '/path'}
                      title={`~${def.hours}${t('track.hours')} · ${def.desc}${recs.length ? ` · Recommended before: ${recs.map((m) => t(TRACK_DEFS.find((d) => d.id === m)!.nameKey as LocaleKey)).join(', ')} (60%+)` : ''}`}
                    >
                      {domains.map((d) => (
                        <SurfaceLogo key={d} id={DOMAIN_GLYPH[d]} size={13} title={DOMAIN_NAME[d]} />
                      ))}
                      <b>{t(def.nameKey as LocaleKey)}</b>
                      <span className="pct">{pct}%</span>
                    </Link>
                  );
                })}
              </div>

              <div className="rmap-head">
                <h3 className="row" style={{ gap: 8, margin: 0 }}>
                  <MapIcon size={16} color="var(--cyan)" /> {t('path.masterTitle')}
                </h3>
                {/* The span, on the heading: "Core Learning Paths (01–36)" is the first thing the
                    page has to say, because it is what makes the 25 cards below read as support
                    rather than as a second, competing curriculum. */}
                <span className="chip">{`01–${String(MASTER_STEPS)}`}</span>
                <span className="small muted" style={{ maxWidth: 720 }}>{t('path.masterSub')}</span>
                <div className="rmap-legend">
                  <span className="rmap-key"><i />{t('path.statusAvailable')}</span>
                  <span className="rmap-key"><i className="k-now" />{t('path.statusProgress')}</span>
                  <span className="rmap-key"><i className="k-done" />{t('path.statusComplete')}</span>
                  <span className="chip">{doneTracks}/{trackStrip.length} {t('path.rmapDone')}</span>
                  <span className="chip">{pb.touched}/{pb.total} {t('path.pbPractised')}</span>
                </div>
              </div>

              <div className="rmap rmap-master">
                {PHASES.map((phase, phaseIdx) => {
                  const steps = rows.filter((r) => r.step.no >= phase.first && r.step.no <= phase.last);
                  if (!steps.length) return null;
                  return (
                    <Fragment key={phase.id}>
                      {/* A stage is a stage of the same road, not a new list: the divider IS a step of
                          the spine, so the line runs through it and the numbering never restarts.
                          The stage is NUMBERED ("STAGE 01") because the ten stages are the one thing
                          a learner quotes back — "main stage 6 par hoon" — and a bare name leaves
                          them counting dividers to find out which one that is. */}
                      <div className={`rmap-group tone-${phase.tone}`}>
                        <div className="rmap-rail" aria-hidden="true"><span className="rmap-line" /></div>
                        <div className="rmap-group-body">
                          {/* The stage's own mark, from the one registry the ten stages share with the
                              ten domains and the 25 support surfaces — so "which stage am I in" is
                              readable from the mark before the name is read. */}
                          <span className="stage-mark" aria-hidden="true">
                            <SurfaceLogo id={STAGE_GLYPH[phase.id]} size={17} />
                          </span>
                          <span className="chip">{t('path.stageWord')} {String(phaseIdx + 1).padStart(2, '0')} · {t(phase.key as LocaleKey)}</span>
                          <span className="small muted">{steps.length} {t(steps.length === 1 ? 'path.masterStep1' : 'path.masterSteps')}</span>
                        </div>
                      </div>

                      {steps.map((row) => {
                        const { step, stat, def, own, mastery, nbs } = row;
                        const st = statusOf(mastery);
                        const Icon = STEP_ICON[step.kind];
                        const isOpen = openNo === String(step.no);
                        const last = step.no === STEPS.length;
                        const trackName = def ? t(def.nameKey as LocaleKey) : null;
                        const chapterOf = (no: string) => pb.index?.chapters.find((c) => c.no === no) ?? null;
                        const recs = def ? (def.prereq ?? []).filter((p) => trackPct(p) < 60) : [];
                        return (
                          <div
                            key={step.no}
                            id={`s${step.no}`}
                            className={`rmap-step tone-${phase.tone}${st.cls ? ` ${st.cls}` : ''}`}
                          >
                            <div className="rmap-rail" aria-hidden="true">
                              <span className="rmap-dot">{String(step.no).padStart(2, '0')}</span>
                              {!last && <span className="rmap-line" />}
                              {!last && <span className="rmap-arrow"><ChevronDown size={12} /></span>}
                            </div>

                            <div className={`tree-ch ch-box step-box${isOpen ? ' open' : ''}`}>
                              <button
                                className="tree-row ch ch-head"
                                aria-expanded={isOpen}
                                onClick={() => setOpen(isOpen ? null : String(step.no))}
                              >
                                <span className="ch-ic"><Icon size={16} /></span>
                                <b className="ch-title" style={{ textAlign: 'left' }}>{step.title}</b>
                                <span className="ch-sub">
                                  {trackName ? `${trackName} · ` : ''}
                                  {stat.items > 0
                                    ? `${stat.items} ${t('path.pbItems')}`
                                    : step.chapters.length
                                      ? t('path.stepConceptOnly')
                                      : t('path.stepNoDoc')}
                                </span>
                                {mastery !== null && <span className="ringwrap"><ProgressRing pct={mastery} size={30} /></span>}
                                {stat.pdfPage !== null && (
                                  <Link
                                    className="chip step-pdf"
                                    to={`/pdf/playbook/${stat.pdfPage}`}
                                    onClick={(e) => e.stopPropagation()}
                                    title={t('path.stepPdf')}
                                  >
                                    <FileText size={11} /> p.{stat.pdfPage}
                                  </Link>
                                )}
                                <span className="ch-chev">{isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
                              </button>

                              {isOpen && (
                                <div className="tree-topics">
                                  <div className="step-panel">
                                    <p className="small step-goal" style={{ margin: 0 }}>
                                      <b>{t('path.stepGoal')}:</b> {step.goal}
                                    </p>

                                    <div className="step-topics">
                                      {step.topics.map((x) => <span key={x} className="chip">{x}</span>)}
                                    </div>

                                    {(step.lab || step.project) && (
                                      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                                        {step.lab && <span className="chip"><SurfaceLogo id="code" size={12} /> {t('path.stepLab')}: {step.lab}</span>}
                                        {step.project && <span className="chip"><SurfaceLogo id="cube" size={12} /> {t('path.stepProject')}: {step.project}</span>}
                                      </div>
                                    )}

                                    {/* The curriculum sections this step is taught in. The step's track is
                                        DERIVED from these, so listing them is also what explains why the
                                        track chip says what it says — and it is the fastest way into a
                                        lesson without going through the track page. */}
                                    {own.length > 0 && (
                                      <div className="step-sections">
                                        <span className="small muted">{t('path.stepSections')}</span>
                                        {own.slice(0, 8).map((s) => (
                                          <Link key={s.id} className="chip" to={`/lesson/${s.id}/learn`}>
                                            {String(s.no).padStart(2, '0')} {s.title}
                                          </Link>
                                        ))}
                                      </div>
                                    )}

                                    {/* The practice notebooks this step's own sections own. Filed by
                                        section, opened by deep link, so a learner never has to
                                        remember which shelf the notebook was on — and the count is
                                        the manifest's, never a hand-typed figure. */}
                                    {nbs.length > 0 && (
                                      <div className="step-sections">
                                        <span className="small muted">{t('path.stepNotebooks')}</span>
                                        {nbs.map((nb) => (
                                          <Link key={nb.file} className="chip" to={`/notebooks?nb=${nb.file}`} title={nb.intro}>
                                            <NotebookPen size={11} /> {nb.topic} · {nb.codeCells} {t('path.stepCells')}
                                          </Link>
                                        ))}
                                      </div>
                                    )}

                                    {/* The document, chapter by chapter — with the chapter's own number,
                                        because the roadmap number and the PDF number are different things. */}
                                    {step.chapters.length > 0 ? (
                                      <div className="step-chs">
                                        {step.chapters.map((no) => {
                                          const ch = chapterOf(no);
                                          const cs = stats.get(no);
                                          return (
                                            <Link key={no} className="tree-row topic" to={cs?.sectionId ? `/questions?section=${cs.sectionId}&chapter=${no}` : `/questions?chapter=${no}`} title={ch?.title ?? `Chapter ${no}`}>
                                              {/* A mark, not an emoji: a chapter that carries practice items says
                                                  "there is something to DO here", a reading chapter says
                                                  "there is something to READ here". */}
                                              <span className="mark"><SurfaceLogo id={cs && cs.items > 0 ? 'clipboard' : 'book'} size={13} /></span>
                                              <span className="chip">{t('path.stepSetWord')} {no}</span>
                                              <span style={{ flex: 1, textAlign: 'left' }}>{ch?.title ?? t('path.stepLoading')}</span>
                                              {cs && cs.items > 0
                                                ? <span className="chip">{cs.items} {t('path.pbItems')}</span>
                                                : <span className="chip">{t('path.stepConcept')}</span>}
                                              {ch && <span className="chip">p.{ch.pdfPage}</span>}
                                            </Link>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <p className="small muted" style={{ margin: 0 }}>{t('path.stepNoDoc')}</p>
                                    )}

                                    <div className="tree-footer">
                                      {/* What the step is worth in the document: items, chapters, practised. */}
                                      {stat.items > 0 ? (
                                        <div className="step-share">
                                          <span className="row spread small muted">
                                            <span><BookMarked size={12} /> {stat.items} {t('path.pbItems')} · {stat.chapters} {t('path.pbChapters')}</span>
                                            <span>{stat.practised}/{stat.items} {t('path.pbPractised')}</span>
                                          </span>
                                          <Bar pct={Math.round((stat.practised / Math.max(1, stat.items)) * 100)} />
                                        </div>
                                      ) : (
                                        <span className="small muted">{t('path.stepNoPractice')}</span>
                                      )}

                                      {def && (
                                        <div className="step-track">
                                          <span className="row spread small muted">
                                            <span>{trackName}</span>
                                            <span>{mastery ?? 0}%</span>
                                          </span>
                                          <Bar pct={mastery ?? 0} />
                                        </div>
                                      )}

                                      {recs.length > 0 && (
                                        <div className="prereq ok">
                                          <Compass size={12} /> Recommended: {recs.map((m) => t(TRACK_DEFS.find((d) => d.id === m)!.nameKey as LocaleKey)).join(', ')} (60%+)
                                        </div>
                                      )}

                                      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                                        {stat.topSection ? (
                                          <>
                                            <Link className="btn small primary" to={`/questions?section=${stat.topSection}&playbook=1`}>
                                              <ListChecks size={12} /> {t('path.pbPractice')}
                                            </Link>
                                            <Link className="btn small" to={`/lesson/${stat.topSection}/interview`}>{t('path.pbInterview')}</Link>
                                          </>
                                        ) : own[0] ? (
                                          <Link className="btn small primary" to={`/lesson/${own[0].id}/coding`}>
                                            <Wrench size={12} /> {t('track.practiceBtn')}
                                          </Link>
                                        ) : null}
                                        {own[0] && (
                                          <Link className="btn small" to={`/lesson/${own[0].id}/learn`}>
                                            <BookOpen size={12} /> {t('path.openLesson')}
                                          </Link>
                                        )}
                                        {stat.pdfPage !== null && (
                                          <Link className="btn small" to={`/pdf/playbook/${stat.pdfPage}`}>
                                            <FileText size={11} /> {t('path.pbRead')}
                                          </Link>
                                        )}
                                        {def && (
                                          <button className="btn small" onClick={() => { const s = slugOf(def.id); if (s) nav(`/track/${s}`); }}>
                                            {t('path.trackOpen')} <ChevronRight size={13} />
                                          </button>
                                        )}
                                        <Link className="btn small" to="/interview"><Mic2 size={11} /> {t('path.pbInterviewMode')}</Link>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="tablewrap card">
              <table className="data">
                <thead>
                  <tr>
                    <th>#</th><th>{t('path.stepCol')}</th><th>{t('path.stepColPhase')}</th><th>{t('path.stepColTrack')}</th>
                    <th>{t('path.pbV15')}</th><th>Progress</th><th>PDF</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ step, stat, def, own, mastery }) => (
                    <tr key={step.no}>
                      <td><b>{String(step.no).padStart(2, '0')}</b></td>
                      <td>
                        <b>{step.title}</b>
                        <div className="small muted">{step.chapters.length ? `ch ${step.chapters.join(', ')}` : t('path.stepNoDoc')}</div>
                      </td>
                      <td className="small muted">{t(phaseOf(step.no).key as LocaleKey)}</td>
                      <td className="small muted">{def ? t(def.nameKey as LocaleKey) : '—'}</td>
                      <td>
                        {stat.items > 0 && stat.topSection ? (
                          <Link className="chip" to={`/questions?section=${stat.topSection}&playbook=1`}>
                            <BookMarked size={11} /> {stat.items}
                          </Link>
                        ) : <span className="small muted">—</span>}
                      </td>
                      <td style={{ minWidth: 120 }}><Bar pct={mastery ?? 0} /></td>
                      <td>
                        {stat.pdfPage !== null
                          ? <Link className="chip" to={`/pdf/playbook/${stat.pdfPage}`}>p.{stat.pdfPage}</Link>
                          : <span className="small muted">—</span>}
                      </td>
                      <td>
                        {own[0]
                          ? <Link className="btn small" to={`/lesson/${own[0].id}/learn`}>{t('path.openLesson')}</Link>
                          : <span className="small muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* And every OTHER path in the project, continuing the same line: the 36 steps end at 36
              and these pick the numbering up at 37, on the same rail with the same arrowheads. */}
          <PathGrid />

          {/* The second source, as a layer of the roadmap rather than a detour from it. Its
              per-chapter numbers are inside the steps above, not repeated here. */}
          <PlaybookLayer coverage={pb} />

          {/* The Notebook Lab lives on the path itself: pick a notebook and run its cells here,
              offline, without leaving the roadmap. */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="row spread">
              <h3 className="row" style={{ gap: 8, margin: 0 }}>
                <BookOpen size={16} color="var(--cyan)" /> {t('nb.labTitle')}
              </h3>
              <span className="chip easy">{t('nb.offline')}</span>
            </div>
            <p className="muted small" style={{ marginTop: 4 }}>{t('nb.labSub')}</p>
            <NotebookShelf defaultOpen boxes />
          </div>

          <div className="goalbar" style={{ marginTop: 16 }}>
            {[t('dash.stage1'), t('dash.stage2'), t('dash.stage3'), t('dash.stage4')].map((l, i) => (
              <div key={l} className={`stage ${overall >= [0, 25, 50, 80][i] ? 'on' : ''}`}>
                <span className="stepnum">{i + 1}</span><div className="lbl"><b>{l}</b></div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT RAIL */}
        <div className="path-rail">
          <div className="card">
            <div className="row spread">
              <h3 className="row" style={{ gap: 8, margin: 0 }}><Target size={16} color="var(--pink)" /> {t('path.mission')}</h3>
              <span className="chip">Day {Math.max(1, state.streak.current)}</span>
            </div>
            <p className="small" style={{ margin: '8px 0 4px' }}><b>{String(current.step.no).padStart(2, '0')} · {current.step.title}</b></p>
            <p className="muted small">{current.step.goal}</p>
            <Bar pct={current.mastery ?? 0} />
            <button
              className="btn small primary"
              style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
              onClick={() => setOpen(String(current.step.no))}
            >
              {t('path.stepGo')} <ChevronRight size={13} />
            </button>
            <p className="small muted" style={{ margin: '8px 0 0' }}>Read: {cur.title} · {curPct}%</p>
            <Link className="btn small" style={{ marginTop: 8, width: '100%', justifyContent: 'center' }} to={`/lesson/${cur.id}/learn`}>
              {t('path.openLesson')}
            </Link>
          </div>

          {/* The V15 layer's own progress, and the single best place to push it forward. */}
          <div className="card">
            <div className="row spread">
              <h3 className="row" style={{ gap: 8, margin: 0 }}>
                <BookMarked size={16} color="var(--cyan)" /> {t('path.pbV15')}
              </h3>
              <span className="small">{pb.touched}/{pb.total}</span>
            </div>
            <Bar pct={pb.total ? Math.round((pb.touched / pb.total) * 100) : 0} />
            <p className="muted small" style={{ margin: '8px 0 6px' }}>{t('path.pbRailSub')}</p>
            {pb.target ? (
              <>
                <div className="row spread small muted">
                  <span>{t('path.pbNext')}</span>
                  <span>{pb.target.remaining} {t('path.pbItems')}</span>
                </div>
                <Link className="btn small primary" style={{ marginTop: 6, width: '100%', justifyContent: 'center' }} to={`/questions?section=${pb.target.sectionId}&playbook=1`}>
                  {String(pb.target.no).padStart(2, '0')} · {pb.target.sectionTitle} <ChevronRight size={13} />
                </Link>
              </>
            ) : pb.ready ? (
              <span className="chip easy">✓ {t('path.pbAllDone')}</span>
            ) : (
              <span className="chip">{t('path.pbLoading')}</span>
            )}
            <Link className="small" to="/questions?playbook=1" style={{ display: 'inline-block', marginTop: 8 }}>{t('path.pbPractice')} →</Link>
          </div>

          <div className="card">
            <h3 className="row" style={{ gap: 8, margin: 0 }}><BarChart3 size={16} color="var(--red)" /> {t('path.weak')}</h3>
            {!weak.length && <p className="muted small" style={{ marginTop: 8 }}>{t('path.weakNone')}</p>}
            {weak.map((w) => (
              <div key={w.topic} className="row spread small" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span>{w.topic}</span>
                <span className="muted small">{w.fixed >= w.n ? '✓' : w.n >= 2 ? t('path.weakPractice') : t('path.weakEmpty')}</span>
              </div>
            ))}
            <Link className="small" to="/mistakes" style={{ display: 'inline-block', marginTop: 8 }}>{t('dash.viewAll')} →</Link>
          </div>

          <div className="card">
            <h3 className="row" style={{ gap: 8, margin: 0 }}><Lightbulb size={16} color="var(--amber)" /> {t('path.recommended')}</h3>
            <div className="stat" style={{ marginTop: 8 }}>
              <b className="small">{cur.title}</b>
              <div className="row small muted" style={{ marginTop: 4 }}><span>~20 min</span><span className="chip">Beginner</span></div>
            </div>
            <Link className="btn small" style={{ marginTop: 8, width: '100%', justifyContent: 'center' }} to={`/lesson/${firstOpenTask.sid}/${firstOpenTask.stage}`}>{t('dash.continue')} →</Link>
          </div>

          <div className="card">
            <div className="row spread"><h3 className="row" style={{ gap: 8, margin: 0 }}><CalendarCheck size={16} color="var(--cyan)" /> {t('path.weeklyGoal')}</h3><span className="small">{weeklyDone}/5</span></div>
            <p className="muted small" style={{ marginTop: 4 }}>{t('path.weeklySub')}</p>
            <Bar pct={(weeklyDone / 5) * 100} />
          </div>

          <div className="card" style={{ borderLeft: '3px solid var(--violet)' }}>
            <p className="small" style={{ margin: 0, fontStyle: 'italic' }}>{t('path.quote')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One glyph per kind of step — a category, never a quality signal. */
const STEP_ICON: Record<StepKind, typeof BookOpen> = {
  concept: BookOpen, code: Code2, data: Database, ml: Brain, genai: Sparkles, agent: Bot, build: Wrench, career: Mic2,
};

/**
 * The three states the spine can show: not started, in progress, complete — and a fourth answer,
 * `mastery === null`, which means the step holds no curriculum sections to average. That is not
 * 0%: it is "not measured", so it gets the neutral node rather than a claim.
 */
function statusOf(pct: number | null): { cls: '' | 'now' | 'done'; key: LocaleKey } {
  if (pct === null) return { cls: '', key: 'path.statusAvailable' };
  if (pct >= 100) return { cls: 'done', key: 'path.statusComplete' };
  if (pct > 0) return { cls: 'now', key: 'path.statusProgress' };
  return { cls: '', key: 'path.statusAvailable' };
}
