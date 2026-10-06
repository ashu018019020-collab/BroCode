import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Star, Flame, Target, Trophy, Code2, BookOpen, Sparkles, Brain, Mic2,
  Bug, FolderGit2, Flag, Play, ArrowRight, Zap, BarChart3, Percent, Clock,
  TrendingUp, ChevronRight, Award, NotebookPen, ListChecks, Layers,
  CalendarCheck, Timer, Check, GraduationCap,
} from 'lucide-react';
import { StickyNote, BookMarked, Moon, Repeat, Settings as SettingsIcon } from 'lucide-react';
import { useCurriculum } from '../../core/data/curriculum';
import { useStore } from '../../core/storage/store';
import { sectionProgress, currentSection, isMastered, nextBestAction, codingTasksDone, recentStageEvents } from '../../core/learning/progress';
import { dueReview, openMistakes } from '../../core/learning/review';
import { bankAccuracy, pctText } from '../../core/assessment/accuracy';
import { mockPassed, notebookCellsRun } from '../../core/learning/coverage';
import { dailyMission } from '../../core/ai/mission';
import { levelForXp, levelProgress, XP_PER_LEVEL } from '../../core/platform/keys';
import { dateKey, daySeries, formatDuration, studyStreak, studyTotals, weekTotals } from '../../core/learning/study';
import { ProgressRing, Bar } from '../../components/ui/ui';
import { AssistantCard } from '../../components/shared/AssistantCard';
import { earnedAchievements } from '../../core/platform/achievements';
import { useUi, setUi } from '../../core/storage/ui';
import { useI18n } from '../../app/i18n';
import { useCourseIndex, useSectionPct } from '../../core/data/courses';
import { activeCourse, cardMeasures, nextStep, sectionAvg, sectionsClear, type StepMeasure } from '../../core/learning/courses';
import { STEPS } from '../../core/learning/roadmap';
import { CourseLogo } from '../../components/shared/CourseLogo';

/**
 * Dashboard — the "what do I do now" surface.
 *
 * The page was a stack of eight equally weighted blocks, and three of its panels reported numbers
 * that were ALREADY on the screen: the hero printed the level, the streak and the overall
 * percentage, the six stat cards printed the same three plus three more, and the right rail drew
 * the 8 track bars a second time directly beside the 8 track cards. Between those duplicates it
 * also carried ~800px of horizontal dead space in the hero, an always-mounted "Recent Activity"
 * card that says nothing until something has happened, and a 4-box "Quick Stats" panel whose
 * numbers were the KPI row again. Restructured, the rule is one number, one place:
 *
 *   1. HERO            who you are — the greeting, the goal, the level ring, and a live snapshot
 *                      of today (minutes studied, this week, streak, XP to the next level). The
 *                      snapshot is the space the old hero wasted: `state.study` has held real
 *                      seconds per day since the study tracker landed, and nothing was showing it.
 *   2. KPI ROW         six figures the hero does NOT print: XP this week, study time this week
 *                      (with a delta against last week), answer accuracy with its sample size,
 *                      coding tasks, sections mastered, badges.
 *   3. COURSES         the continue-across-courses strip: the course the learner is actually in
 *                      (started, unfinished, most section mastery) and its next incomplete step,
 *                      then the other ten as chips. Index.json + section mastery only — the
 *                      Dashboard never parses a 1.5 MB course file to draw eleven rings.
 *   4. MISSION + NBA   what to do next, and why it is next — kept, but denser, and both cards are
 *                      the same height so the row has no ragged hole under the shorter one.
 *   5. RAIL            study time, the queue (due cards, open mistakes, mocks, notebook cells),
 *                      and real recent activity — which is hidden while there is none instead of
 *                      drawn empty. The Learning-Tracks card grid came OFF this page (the courses
 *                      strip above is the "what next" surface; the tracks live on their own pages).
 *   6. ACHIEVEMENTS    bigger tiles, earned-first, each with honest progress and an unlock line.
 *   7. TOOLS           every destination, quieter than the mission because it is not the plan.
 *
 * Every number on this page is derived from persisted learner state or from a content manifest —
 * there is no seeded, estimated or decorative figure anywhere on it.
 */

const MISSION_ICONS: Record<string, typeof BookOpen> = {
  read: BookOpen, interview: Mic2, coding: Code2, logic: Brain, debug: Bug, mini: FolderGit2, explain: Mic2, checkpoint: Flag,
};

export default function Dashboard() {
  const { sections } = useCurriculum();
  const state = useStore();
  const ui = useUi();
  const { t } = useI18n();
  const ach = useMemo(() => earnedAchievements(state, sections), [state, sections]);
  const cur = currentSection(sections, state);
  const { masterPct } = sectionProgress(cur, state);
  const mission = useMemo(() => dailyMission(state, sections).slice(0, 6), [state, sections]);
  const nba = nextBestAction(cur, state);

  const overall = useMemo(
    () => Math.round(sections.reduce((a, s) => a + sectionProgress(s, state).masterPct, 0) / Math.max(1, sections.length)),
    [sections, state],
  );
  /** How right the answers are, in percent — the figure the learner asks for most. */
  const acc = useMemo(() => bankAccuracy(state), [state.attempts]);
  /** XP earned in the last 7 days — distinct from total XP, which the hero already prints. */
  const weekXp = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += state.activity[dateKey(new Date(Date.now() - i * 86400000))] ?? 0;
    return sum;
  }, [state.activity]);

  /**
   * Study time. `engine/study.ts` owns every rule about the log — the zero-fill, the rolling week,
   * the "no percentage against an empty last week" — so this page only formats what it returns.
   */
  const study = useMemo(() => {
    const todayKey = dateKey(new Date());
    const days = daySeries(state.study, 7, todayKey);
    return {
      todayKey,
      days,
      today: state.study[todayKey] ?? 0,
      week: weekTotals(state.study, todayKey),
      totals: studyTotals(state.study),
      peak: Math.max(1, ...days.map((d) => d.seconds)),
    };
  }, [state.study]);
  const streak = useMemo(
    () => studyStreak(state.study ?? {}, study.todayKey),
    [state.study, study.todayKey],
  );

  const coding = codingTasksDone(sections, state);
  const mastered = sections.filter((s) => isMastered(s, state));
  const level = levelForXp(state.xp);
  const toNext = XP_PER_LEVEL - (state.xp % XP_PER_LEVEL);

  const due = dueReview(state).length;
  const openMistakesList = openMistakes(state).length;
  const mocksPassed = mockPassed(state.attempts);
  const nbCellsRun = notebookCellsRun(state.attempts);

  // Real activity: the stage records that carry a timestamp, newest first. Which key means which stage
  // is engine/progress.ts's business — the page only chooses the icon, the tone and the sentence.
  const activity = useMemo(
    () => recentStageEvents(sections, state.attempts, 5).map((ev) => ({
      at: ev.at,
      icon: MISSION_ICONS[ev.kind] ?? BookOpen,
      color: ev.kind === 'coding' ? 'var(--cyan)' : ev.kind === 'mini' || ev.kind === 'project' ? 'var(--violet)' : 'var(--green)',
      label: `${ev.section.title} — ${ev.kind} ${ev.kind === 'read' ? '' : 'progress'}`.replace(/\s+/g, ' ').trim(),
      to: `/lesson/${ev.section.id}/learn`,
    })),
    [sections, state.attempts],
  );

  const stage = mastered.length === 0 ? 1 : overall < 40 ? 2 : overall < 75 ? 3 : 4;
  const achEarned = ach.filter((a) => a.earned).length;

  /**
   * Achievements are shown EARNED FIRST, then by how close they are: a locked badge at 8/10 is the
   * one worth acting on, and a fixed order buries it under badges that need 40 more of something.
   */
  const achSorted = useMemo(
    () => [...ach].sort((a, b) => Number(b.earned) - Number(a.earned) || (b.got / b.need) - (a.got / a.need)),
    [ach],
  );
  const closest = achSorted.find((a) => !a.earned) ?? null;

  /**
   * The week-over-week line. `deltaPct` is null when last week has no time in it at all — a
   * percentage against nothing is not a number, so the panel says "naya hafta" instead of +∞%.
   */
  const delta = study.week.deltaPct !== null
    ? `${study.week.deltaPct >= 0 ? '+' : ''}${study.week.deltaPct}% ${t('dash.vsLastWeek')}`
    : t('dash.freshWeek');

  const kpis = [
    { icon: TrendingUp, n: `${weekXp}`, l: t('dash.xpWeek'), sub: `${state.xp} XP ${t('dash.allTime')}`, pct: levelProgress(state.xp) * 100, tone: 'amber' },
    { icon: Clock, n: formatDuration(study.week.thisWeek), l: t('dash.studyWeek'), sub: delta, tone: 'cyan' },
    // The sample size travels with the percentage: "100%" off one graded answer reads as a
    // whole-bank score, and a bare dash has to say WHICH of the two it is.
    { icon: Percent, n: pctText(acc.pct), l: t('dash.accuracy'), sub: acc.graded ? `${acc.correct}/${acc.graded} ${t('dash.graded')}` : t('dash.notGraded'), tone: 'green' },
    { icon: Code2, n: `${coding.done}/${coding.total}`, l: t('dash.codingTasks'), sub: t('dash.codingSub'), pct: (coding.done / Math.max(1, coding.total)) * 100, tone: 'violet' },
    { icon: Layers, n: `${mastered.length}/${sections.length}`, l: t('dash.sectionsMastered'), sub: `${overall}% ${t('dash.overall')}`, pct: (mastered.length / Math.max(1, sections.length)) * 100, tone: 'blue' },
    { icon: Trophy, n: `${achEarned}/${ach.length}`, l: t('dash.achievements'), sub: closest ? `${t('dash.next')}: ${closest.label}` : t('dash.allUnlocked'), pct: (achEarned / Math.max(1, ach.length)) * 100, tone: 'gold' },
  ];

  const queue = [
    { icon: Repeat, n: due, l: t('dash.reviewDue'), to: '/review', tone: 'blue' },
    { icon: Bug, n: openMistakesList, l: t('dash.mistakesOpen'), to: '/mistakes', tone: 'red' },
    { icon: Mic2, n: mocksPassed, l: t('dash.mocks'), to: '/mock-interviews', tone: 'violet' },
    { icon: NotebookPen, n: nbCellsRun, l: t('dash.notebookCells'), to: '/notebooks', tone: 'green' },
  ];

  /**
   * The continue-across-courses strip (section 3). `index.json` is 3 KB and section mastery is
   * already in the store; a `<slug>.json` is up to 1.5 MB and is NEVER fetched here. So the hero
   * names the course the learner is in (`activeCourse`: started, unfinished, most mastery) and
   * reads its next step from card-only measures — a step whose denominator lives in the course
   * file reports none on the card, and the hero then offers the course page instead of guessing.
   */
  const courseIndex = useCourseIndex();
  const sectionPct = useSectionPct();
  const courseCards = courseIndex?.courses ?? [];
  const activeCard = useMemo(() => activeCourse(courseCards, sectionPct), [courseCards, sectionPct]);
  const courseTarget = activeCard ?? courseCards[0] ?? null;
  const targetMeasures = useMemo(
    () => (courseTarget ? cardMeasures(courseTarget, sectionPct) : new Map<number, StepMeasure>()),
    [courseTarget, sectionPct],
  );
  const targetStepNo = courseTarget ? nextStep(courseTarget, targetMeasures) : 1;
  const targetMeasure = targetMeasures.get(targetStepNo);
  /** True when the card itself can name the next incomplete step (a section-backed one). */
  const targetCertain = !!activeCard && !!targetMeasure && targetMeasure.pct !== null && targetMeasure.status !== 'clear';
  const targetAvg = courseTarget ? sectionAvg(courseTarget, sectionPct) : null;
  const targetSections = courseTarget ? Object.keys(courseTarget.sections ?? {}).length : 0;
  const targetClear = courseTarget ? sectionsClear(courseTarget, sectionPct) : 0;
  const targetStep = STEPS.find((s) => s.no === targetStepNo) ?? null;
  const targetHref = !courseTarget
    ? '/courses'
    : targetCertain
      ? `/course/${courseTarget.slug}/${targetStepNo}?tab=lesson`
      : `/course/${courseTarget.slug}`;

  return (
    <div className="dash-page">
      {/* 1 — HERO: identity on the left, LIVE numbers in the middle, the overall ring on the right. */}
      <section className="hero-band fadeup">
        <div className="hero-grid">
          <div className="hero-id">
            <h1>{t('dash.welcome')} <span>{state.profile.name}.</span></h1>
            <p className="muted small">{t('dash.journey')}</p>
            <div className="row dash-tags">
              <span className="dash-tag tone-violet"><Sparkles size={13} /> {t('dash.chip')}</span>
            </div>
          </div>

          <div className="hero-snap">
            <span className="snap-head">{t('dash.snapshot')}</span>
            <div className="snap-grid">
              <div className="snap tone-cyan">
                <span className="l">{t('dash.studyToday')}</span>
                <b>{formatDuration(study.today)}</b>
                <span className="sub">{study.totals.activeDays} {t('dash.activeDays')}</span>
              </div>
              <div className="snap tone-violet">
                <span className="l">{t('dash.week')}</span>
                <b>{formatDuration(study.week.thisWeek)}</b>
                <span className="sub">{delta}</span>
              </div>
              <div className="snap tone-amber">
                <span className="l">{t('dash.levelStreak')}</span>
                <b>{streak}<small> {t('dash.days')}</small></b>
                <span className="sub"><Flame size={11} /> Study streak</span>
              </div>
              <div className="snap tone-green">
                <span className="l">{t('top.level')} {level}</span>
                <b>{toNext}<small> XP</small></b>
                <span className="sub">{t('dash.toNext')}</span>
                <span className="snap-bar"><i style={{ width: `${levelProgress(state.xp) * 100}%` }} /></span>
              </div>
            </div>
          </div>

          <div className="hero-ring">
            <ProgressRing pct={overall} size={118} label={`${overall}%`} />
            <span className="muted small">{t('dash.overall')} · {sections.length} {t('dash.sectionsShort')}</span>
            <span className="chip">{state.xp} XP</span>
          </div>
        </div>
      </section>

      {/* 2 — KPI ROW: six numbers the hero does not already print. */}
      <div className="kpi-row">
        {kpis.map((k) => (
          <div key={k.l} className={`kpi tone-${k.tone}`} title={k.sub}>
            <span className="ic"><k.icon size={18} /></span>
            <div className="kpi-body">
              <div className="n">{k.n}</div>
              <div className="l">{k.l}</div>
              <div className="kpi-sub">{k.sub}</div>
              {typeof k.pct === 'number' && <Bar pct={k.pct} />}
            </div>
          </div>
        ))}
      </div>

      {/* 2b — RECOMMENDED: the four pillars a learner reaches for when they are not sure where to go
             next. Pure navigation — no figure is invented here, and every destination is a real hub. */}
      <div className="sec-head"><h2>{t('dash.recommended')}</h2><span className="line" /></div>
      <div className="tile-grid">
        {[
          { to: '/projects', icon: FolderGit2, label: 'Build a Project', sub: 'Project Lab', tag: 'Project', tone: 'violet' },
          { to: '/labs', icon: Sparkles, label: 'Run a Lab', sub: 'Python · SQL · AI', tag: 'Lab', tone: 'cyan' },
          { to: '/interviews', icon: Mic2, label: 'Mock Interview', sub: 'Answer, then defend', tag: 'Interview', tone: 'amber' },
          { to: '/career', icon: Award, label: 'Sharpen the Portfolio', sub: 'Bullets + pitch', tag: 'Career', tone: 'green' },
        ].map((r) => (
          <Link key={r.to} to={r.to} className="tile">
            <span className="ic"><r.icon size={17} /></span>
            <span className="t" style={{ flex: 1, minWidth: 0 }}>
              <b>{r.label}</b>
              <span>{r.sub}</span>
            </span>
            <span className={`chip ${r.tone}`}>{r.tag}</span>
          </Link>
        ))}
      </div>

      {/* 3 — COURSES: continue where you left off. One hero card for the course the learner is
             actually in (started, unfinished, most section mastery) and the other ten as chips.
             Every figure comes from index.json + section mastery — a course file is never fetched
             here, so a course with no sections shows its counts, never a ring. */}
      {courseTarget && (
        <>
          <div className="sec-head"><h2><GraduationCap size={17} color="var(--cyan)" /> {t('dash.courses')}</h2><span className="line" /></div>
          <div className="dash-courses">
            <Link className={`course-continue tone-${courseTarget.tone}`} to={targetHref}>
              <CourseLogo logo={courseTarget.logo} name={courseTarget.name} size={44} />
              <span className="dc-body">
                <b>
                  {courseTarget.name}
                  {activeCard && <span className="chip easy">{t('dash.coursesIn')}</span>}
                </b>
                <span className="dc-next">
                  {targetCertain
                    ? `${t('courses.step')} ${String(targetStepNo).padStart(2, '0')} · ${targetStep?.title ?? ''}`
                    : `${courseTarget.steps.length} ${t('courses.stepsUnit')} · ${courseTarget.counts.total} ${t('courses.itemsUnit')}`}
                </span>
                <span className="dc-meta">
                  {targetCertain
                    ? `${targetClear}/${targetSections} ${t('courses.sectionsUnit')}`
                    : t('courses.noSections')}
                </span>
              </span>
              {targetAvg !== null && <ProgressRing pct={targetAvg} size={44} />}
              <span className="btn small primary">
                <Play size={13} /> {activeCard ? (targetCertain ? t('dash.continue') : t('dash.coursesOpen')) : t('dash.coursesStart')}
              </span>
            </Link>

            {courseCards.filter((c) => c.slug !== courseTarget.slug).map((c) => {
              const pct = sectionAvg(c, sectionPct);
              const total = Object.keys(c.sections ?? {}).length;
              return (
                <Link key={c.slug} to={`/course/${c.slug}`} className={`course-chip tone-${c.tone}`}>
                  <CourseLogo logo={c.logo} name={c.name} size={28} />
                  <span className="dc-body">
                    <b>{c.name}</b>
                    <span className="dc-meta">
                      {pct !== null
                        ? `${sectionsClear(c, sectionPct)}/${total} ${t('courses.sectionsUnit')}`
                        : `${c.counts.total} ${t('courses.itemsUnit')}`}
                    </span>
                  </span>
                  {pct !== null && <ProgressRing pct={pct} size={30} />}
                </Link>
              );
            })}

            <Link to="/courses" className="course-chip course-chip-all">
              <GraduationCap size={16} />
              <span className="dc-body"><b>{t('dash.coursesAll')}</b></span>
              <ChevronRight size={15} />
            </Link>
          </div>
        </>
      )}

      {/* 4 — TODAY'S PLAN: the mission, and why the next best action is next. `stretch` so the two
             cards share a height instead of leaving a hole under the shorter one. */}
      <div className="grid2 dash-plan">
        <div className="card fadeup">
          <div className="row spread">
            <h3 className="row" style={{ gap: 8 }}><Target size={17} color="var(--pink)" /> {t('dash.mission')}</h3>
            <span className="chip"><CalendarCheck size={12} /> {new Date().toDateString().slice(0, 10)}</span>
          </div>
          <p className="muted small">{t('dash.missionSub')}</p>
          {!mission.length && <p className="muted small">{t('dash.missionDone')}</p>}
          {mission.map((m, i) => {
            const Icon = MISSION_ICONS[m.kind] ?? BookOpen;
            // The first open row is the actual next step — highlight it so "kya karun?" never
            // needs thinking. It re-derives on every completion, so the plan rotates by itself.
            const isNext = i === 0;
            return (
              <div key={m.id} className={`mission-row${isNext ? ' next' : ''}`}>
                <span className="ic" style={{ color: isNext ? 'var(--green)' : 'var(--cyan)' }}><Icon size={16} /></span>
                <span className="t">
                  {isNext && <span className="chip easy" style={{ marginRight: 6 }}>NEXT</span>}
                  <b>{m.label}</b>
                </span>
                <span className="chip">{m.minutes} {t('dash.min')}</span>
                <Link className={`btn small${isNext ? ' primary' : ''}`} to={m.route}>{t('dash.start')}</Link>
              </div>
            );
          })}
        </div>

        <div className="card fadeup">
          <h3 className="row" style={{ gap: 8 }}><Zap size={17} color="var(--amber)" /> {t('dash.nba')}</h3>
          <p className="muted small">{t('dash.nbaSub')}</p>
          <div className="nba-box">
            <b>{nba.label}</b>
            <p className="muted small" style={{ margin: '4px 0 0' }}>{nba.reason}</p>
            <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
              <span className="chip easy">{cur.learn.concepts[0]?.level ?? 'Beginner'}</span>
              <span className="chip">~20 {t('dash.min')}</span>
              <span className="chip"><BookOpen size={11} /> {cur.title}</span>
            </div>
          </div>
          <Link className="btn primary btn-block" to={nba.route}>
            <Play size={14} /> {t('dash.startLearning')} <ArrowRight size={14} />
          </Link>
          {/* `nba-tail` takes the leftover height of the row, so the two cards end together
              instead of one of them carrying an empty strip at the bottom. */}
          <div className="nba-tail">
            <div className="row spread small muted" style={{ margin: '12px 0 4px' }}>
              <span>{t('dash.continueLearning')}</span>
              <span>{masterPct}%</span>
            </div>
            <Bar pct={masterPct} />
            <Link className="btn small btn-block" to={`/lesson/${cur.id}/learn`}>
              {t('dash.continue')} <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </div>

      {/* 5 — RAIL. The Learning-Tracks card grid came off the dashboard — the courses strip above
          is the "what next" surface now. What stays is what those cards could not say: study time,
          the queue and real recent activity. Three across when activity exists, two when the
          activity card is (correctly) hidden for having nothing to show. */}
      <div className={activity.length ? 'grid3 dash-main' : 'grid2 dash-main'}>
          <div className="card">
            <div className="row spread">
              <h3 className="row" style={{ gap: 8, margin: 0 }}><Clock size={16} color="var(--cyan)" /> {t('dash.studyPanel')}</h3>
              <Link className="small" to="/progress">{t('dash.viewAll')} →</Link>
            </div>
            <div className="study-row3">
              <div className="sr3 tone-cyan"><b>{formatDuration(study.today)}</b><span>{t('dash.studyToday')}</span></div>
              <div className="sr3 tone-violet"><b>{formatDuration(study.week.thisWeek)}</b><span>{t('dash.week')}</span></div>
              <div className="sr3 tone-amber"><b>{formatDuration(study.totals.seconds)}</b><span>{t('dash.allTime')}</span></div>
            </div>
            {/* Seven real days, drawn — the same log the Progress page charts, at a glance here. */}
            <div className="wk-strip" aria-hidden="true">
              {study.days.map((d) => (
                <span key={d.key} className={`wk-col${d.key === study.todayKey ? ' on' : ''}`} title={`${d.key} · ${formatDuration(d.seconds)}`}>
                  <i style={{ height: `${Math.max(4, Math.round((d.seconds / study.peak) * 100))}%` }} />
                </span>
              ))}
            </div>
            <div className="row spread small muted">
              <span>{t('dash.last7')}</span>
              <span>{study.totals.bestKey ? `${t('dash.bestDay')}: ${formatDuration(study.totals.bestSeconds)}` : t('dash.noStudyYet')}</span>
            </div>
          </div>

          <div className="card">
            <h3 className="row" style={{ gap: 8, margin: 0 }}><ListChecks size={16} color="var(--green)" /> {t('dash.queue')}</h3>
            {queue.map((q) => (
              <Link key={q.to} className={`q-row tone-${q.tone}`} to={q.to}>
                <span className="ic"><q.icon size={14} /></span>
                <span className="t">{q.l}</span>
                <b>{q.n}</b>
                <ChevronRight size={14} />
              </Link>
            ))}
          </div>

          {/* Only when there IS something: an empty activity card is 200px of nothing. */}
          {activity.length > 0 && (
            <div className="card">
              <h3 className="row" style={{ gap: 8, margin: 0 }}><BarChart3 size={16} color="var(--green)" /> {t('dash.activity')}</h3>
              {activity.map((e, i) => (
                <Link key={i} to={e.to} className="activity-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <span className="adot" style={{ background: e.color }} />
                  <span style={{ flex: 1 }}>{e.label}</span>
                  <time>{ago(e.at)}</time>
                </Link>
              ))}
            </div>
          )}
      </div>

      {/* 6 — ACHIEVEMENTS: bigger tiles, earned first, honest progress on every locked one. */}
      <div className="sec-head"><h2>{t('dash.achievementsTitle')}</h2><span className="line" /></div>
      <div className="grid2 dash-achrow">
        <div className="card">
          <div className="row spread">
            <h3 className="row" style={{ gap: 8, margin: 0 }}><Trophy size={17} color="var(--amber)" /> {achEarned} / {ach.length} {t('dash.unlocked')}</h3>
            {closest && <span className="chip">{t('dash.next')}: {closest.label} · +{closest.need - closest.got}</span>}
          </div>
          <Bar pct={(achEarned / Math.max(1, ach.length)) * 100} />
          <p className="muted small" style={{ margin: '8px 0 0' }}>{t('dash.achNote')}</p>
          <div className="achv-grid">
            {achSorted.map((a) => (
              <div key={a.id} className={`achv${a.earned ? ' earned' : ''}`} title={`${a.label} — ${a.hint}`}>
                <span className="achv-em" aria-hidden>{a.icon}</span>
                <div className="achv-top">
                  <b>{a.label}</b>
                  {a.earned
                    ? <span className="achv-tag earned"><Check size={11} /> {t('dash.unlocked')}</span>
                    : <span className="achv-tag">{a.got} / {a.need}</span>}
                </div>
                <span className="achv-hint">{a.earned ? a.hint : `${a.hint} — +${a.need - a.got} ${t('dash.moreToGo')}`}</span>
                {!a.earned && <span className="achv-bar"><i style={{ width: `${(a.got / a.need) * 100}%` }} /></span>}
              </div>
            ))}
          </div>
        </div>
        <div className="grid2" style={{ gridTemplateColumns: '1fr' }}>
          <AssistantCard />
          <div className="card">
            <h3 className="row" style={{ gap: 8, margin: 0 }}><Award size={16} color="var(--gold)" /> {t('dash.badgeRow')}</h3>
            <div className="statgrid" style={{ marginTop: 10 }}>
              <div className="stat"><div className="n">{mastered.length}</div><div className="l">{t('dash.topicsDone')}</div></div>
              <div className="stat"><div className="n">{streak}d</div><div className="l">{t('dash.levelStreak')}</div></div>
              <div className="stat"><div className="n">{weekXp}</div><div className="l">XP · 7 {t('dash.days')}</div></div>
              <div className="stat"><div className="n">{formatDuration(study.totals.seconds)}</div><div className="l">{t('dash.allTime')}</div></div>
            </div>
            <div className="goalbar" style={{ marginTop: 12, border: 'none', padding: 0 }}>
              {[t('dash.stage1'), t('dash.stage2'), t('dash.stage3'), t('dash.stage4')].map((lbl, i) => (
                <div key={lbl} className={`stage ${stage === i + 1 ? 'on' : ''}`}>
                  <span className="stepnum">{i + 1}</span>
                  <div className="lbl"><b>{lbl}</b></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 7 — TOOLS: every destination, one size down from the plan. */}
      <div className="sec-head"><h2>{t('dash.tools')}</h2><span className="line" /></div>
      <div className="tile-grid dash-tools">
        {[
          { to: '/notes', icon: StickyNote, label: t('nav.notes'), sub: t('dash.toolsNotes'), tone: 'amber' },
          { to: '/cheat-sheets', icon: BookMarked, label: t('nav.cheats'), sub: t('dash.toolsResources'), tone: 'violet' },
          { to: '/exam', icon: Timer, label: t('nav.exam'), sub: t('dash.toolsExam'), tone: 'cyan', badge: 'NEW' },
          { to: '/playground', icon: Sparkles, label: 'AI Tutor', sub: t('dash.toolsTutor'), tone: 'cyan' },
          { to: '/progress', icon: BarChart3, label: 'Progress', sub: t('dash.toolsProgress'), tone: 'green' },
          { to: '/job-prep', icon: Target, label: t('nav.jobprep'), sub: t('dash.toolsGoals'), tone: 'pink' },
          { to: '/review', icon: Repeat, label: 'Review Queue', sub: t('dash.toolsReview'), tone: 'blue' },
          { to: '/settings', icon: SettingsIcon, label: t('top.settings'), sub: t('dash.toolsSettings'), tone: 'muted' },
        ].map((tile) => (
          <Link key={tile.to} to={tile.to} className={`tile tone-${tile.tone}`}>
            <span className="ic"><tile.icon size={18} /></span>
            <span className="t">
              <b>{tile.label} {tile.badge && <span className="badge new">{tile.badge}</span>}</b>
              <span>{tile.sub}</span>
            </span>
            <ChevronRight size={14} />
          </Link>
        ))}
        <button className={`tile tone-cyan${ui.focus ? ' on' : ''}`} onClick={() => { setUi({ focus: !ui.focus }); }} aria-pressed={ui.focus}>
          <span className="ic"><Moon size={18} /></span>
          <span className="t" style={{ textAlign: 'left' }}>
            <b>{t('top.focus')}</b>
            <span>{t('top.focusSub')}</span>
          </span>
          <span className="badge" style={{ opacity: ui.focus ? 1 : .55 }}>{ui.focus ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      <div className="dash-foot">
        <Sparkles size={13} />
        <span className="small muted">{t('dash.quote')} 🚀</span>
      </div>
    </div>
  );
}

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
