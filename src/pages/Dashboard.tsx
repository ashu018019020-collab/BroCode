import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Star, Flame, Target, Trophy, Code2, BookOpen, Sparkles, Brain, Mic2,
  Bug, FolderGit2, Flag, Play, ArrowRight, Zap, BarChart3, Percent,
} from 'lucide-react';
import { useCurriculum } from '../data/curriculum';
import { useStore } from '../offline/store';
import { sectionProgress, currentSection, isMastered, nextBestAction } from '../engine/progress';
import { bankAccuracy, pctText } from '../engine/accuracy';
import { dailyMission } from '../engine/mission';
import { levelForXp, levelProgress } from '../engine/keys';
import { ProgressRing, Bar } from '../components/ui';
import { AssistantCard } from '../components/AssistantCard';
import { earnedAchievements } from '../engine/achievements';
import { useUi, setUi } from '../offline/ui';
import { StickyNote, BookMarked, Moon, Repeat, Settings as SettingsIcon, Timer } from 'lucide-react';
import { useI18n } from '../i18n';
import { TRACK_DEFS } from '../App';
import type { LocaleKey } from '../i18n/locales';

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
  const acc = useMemo(
    () => bankAccuracy(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.attempts],
  );

  const trackStats = useMemo(() => TRACK_DEFS.map((def) => {
    const secs = sections.filter((s) => s.no >= def.from && s.no <= def.to);
    const pct = Math.round(secs.reduce((a, s) => a + sectionProgress(s, state).masterPct, 0) / Math.max(1, secs.length));
    return { def, pct, secs };
  }), [sections, state]);

  const codingDone = sections.reduce((a, s) => a + s.coding.filter((_, i) => state.attempts[`st:${s.id}:coding${i}`]?.done).length, 0);
  const codingTotal = sections.reduce((a, s) => a + s.coding.length, 0);
  const mastered = sections.filter((s) => isMastered(s, state));
  const level = levelForXp(state.xp);

  // Real activity: derive recent events from attempt timestamps + streak + profile.
  const activity = useMemo(() => {
    type Ev = { at: number; icon: typeof BookOpen; color: string; label: string; to: string };
    const evs: Ev[] = [];
    for (const s of sections) {
      for (const [k, a] of Object.entries(state.attempts)) {
        if (!k.startsWith(`st:${s.id}:`) || !a?.ts) continue;
        const stage = k.split(':')[2] ?? '';
        const kind = stage.replace(/\d+$/, '');
        const icon = MISSION_ICONS[kind === 'debugdone' ? 'debug' : kind] ?? BookOpen;
        evs.push({
          at: a.ts,
          icon,
          color: kind === 'coding' ? 'var(--cyan)' : kind === 'mini' || kind === 'project' ? 'var(--violet)' : 'var(--green)',
          label: `${s.title} — ${kind === 'debugdone' ? 'debug' : kind} ${kind === 'read' ? '' : 'progress'}`.replace(/\s+/g, ' ').trim(),
          to: `/lesson/${s.id}/learn`,
        });
      }
    }
    return evs.sort((a, b) => b.at - a.at).slice(0, 5);
  }, [sections, state.attempts]);

  const weekXp = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += state.activity[new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)] ?? 0;
    return sum;
  }, [state.activity]);

  const stage = mastered.length === 0 ? 1 : overall < 40 ? 2 : overall < 75 ? 3 : 4;

  return (
    <div>
      {/* HERO */}
      <section className="hero-band fadeup">
        <div className="row spread" style={{ flexWrap: 'wrap', position: 'relative' }}>
          <div>
            <span className="muted small">{t('dash.hello')}</span>
            <h1>{t('dash.welcome')} <span>{state.profile.name}.</span></h1>
            <p className="muted small">{t('dash.journey')}</p>
            <div className="row chip-line">
              <span className="chip">{t('dash.chip')}</span>
              <span className="chip">{state.profile.goal}</span>
            </div>
          </div>
          <div className="row" style={{ gap: 18 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 750 }}>{t('top.level')} {level}</div>
              <div className="muted small">{state.profile.goal.split('/')[0].trim()}</div>
              <div className="bar" style={{ width: 120, marginTop: 8 }}><div style={{ width: `${levelProgress(state.xp) * 100}%` }} /></div>
              <div className="muted small" style={{ marginTop: 4 }}>{state.xp} XP</div>
            </div>
            <ProgressRing pct={overall} size={92} label={t('dash.overall')} />
          </div>
        </div>
      </section>

      {/* STAT CARDS */}
      <div className="stat-row">
        {[
          { icon: Star, n: `${level}`, l: 'AI Engineer', c: 'var(--amber)' },
          { icon: Flame, n: `${state.streak.current}`, l: t('dash.levelStreak'), c: 'var(--pink)' },
          { icon: Target, n: `${overall}%`, l: t('dash.overall'), c: 'var(--cyan)' },
          // The sample size travels with the percentage: "100%" off one graded answer is true but
          // reads as a whole-bank score, and a bare dash needs to say WHICH of the two it is.
          { icon: Percent, n: pctText(acc.pct), l: acc.graded ? `answer accuracy · ${acc.correct}/${acc.graded}` : 'answer accuracy · grade nahi kiya', c: 'var(--green)' },
          { icon: Code2, n: `${codingDone}`, l: t('dash.codingTasks'), c: 'var(--violet)' },
          { icon: Trophy, n: `${mastered.length}`, l: t('dash.achievements'), c: 'var(--green)' },
        ].map((s) => (
          <div key={s.l} className="stat-card">
            <span className="ic" style={{ color: s.c }}><s.icon size={19} /></span>
            <div><div className="n">{s.n}</div><div className="l">{s.l}</div></div>
          </div>
        ))}
      </div>

      <div className="grid2" style={{ gridTemplateColumns: '1.4fr 1fr', alignItems: 'start' }}>
        {/* TODAY'S MISSION */}
        <div className="card fadeup">
          <div className="row spread">
            <h3 className="row" style={{ gap: 8 }}><Target size={17} color="var(--pink)" /> {t('dash.mission')}</h3>
            <span className="chip">{new Date().toDateString().slice(0, 10)}</span>
          </div>
          <p className="muted small">{t('dash.missionSub')}</p>
          {!mission.length && <p className="muted small">All current tasks complete — open the Learning Path for review. ✓</p>}
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
                <span className="muted small">~{m.minutes} min</span>
                <Link className={`btn small${isNext ? ' primary' : ''}`} to={m.route}>{t('dash.start')}</Link>
              </div>
            );
          })}
        </div>

        {/* NEXT BEST ACTION */}
        <div className="card fadeup">
          <h3 className="row" style={{ gap: 8 }}><Zap size={17} color="var(--amber)" /> {t('dash.nba')}</h3>
          <p className="muted small">{t('dash.nbaSub')}</p>
          <div className="stat" style={{ marginBottom: 10 }}>
            <b>{nba.label}</b>
            <p className="muted small" style={{ margin: '4px 0 0' }}>{nba.reason}</p>
            <div className="row small muted" style={{ marginTop: 6 }}>
              <span className="chip easy">{cur.learn.concepts[0]?.level ?? 'Beginner'}</span>
              <span>~20 min</span>
            </div>
          </div>
          <Link className="btn primary" style={{ width: '100%', justifyContent: 'center' }} to={nba.route}>
            <Play size={14} /> {t('dash.startLearning')} <ArrowRight size={14} />
          </Link>
          <div className="row spread small muted" style={{ margin: '10px 0 4px' }}>
            <span>{t('dash.continueLearning')}</span>
          </div>
          <div className="stat">
            <div className="row spread"><b className="small">{cur.title}</b><span className="muted small">{masterPct}%</span></div>
            <Bar pct={masterPct} />
            <Link className="btn small" style={{ marginTop: 8, width: '100%', justifyContent: 'center' }} to={`/lesson/${cur.id}/learn`}>
              {t('dash.continue')} <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </div>

      {/* YOUR PROGRESS + LEARNING TRACKS */}
      <div className="path-grid" style={{ gridTemplateColumns: '1fr 300px', marginTop: 12 }}>
        <div>
          <h2 className="row" style={{ gap: 8 }}><Sparkles size={17} color="var(--violet)" /> Learning Tracks</h2>
          <div className="track-grid" style={{ marginTop: 10 }}>
            {trackStats.map(({ def, pct }) => {
              const Icon = def.icon;
              return (
                <div key={def.id} className={`track-card tone-${def.tone}`}>
                  <span className="num">{String(TRACK_DEFS.indexOf(def) + 1).padStart(2, '0')}</span>
                  <div className="head">
                    <span className="ic" style={{ color: def.color }}><Icon size={21} /></span>
                    <h3>{t(def.nameKey as LocaleKey)}</h3>
                    <span className="ringwrap"><ProgressRing pct={pct} size={46} /></span>
                  </div>
                  <p className="desc">{def.desc}</p>
                  <div className="meta">
                    <span>⏱ ~{def.hours} {t('track.hours')}</span>
                    <span>{def.to - def.from + 1} {t('track.lessons')}</span>
                  </div>
                  <Bar pct={pct} />
                  <div className="row spread">
                    <Link className="btn small primary" to={`/path`}>{TRACK_DEFS.indexOf(def) === 0 || pct > 0 ? t('track.continueBtn') : t('track.startLesson')}</Link>
                    <span className={`prereq ${def.prereq ? '' : 'ok'}`}>
                      {def.prereq
                        ? <>{t('track.requires')} {def.prereq.map((p) => TRACK_DEFS.find((d) => d.id === p)!.id).join(', ')}</>
                        : <>{t('track.noPrereq')}</>}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT RAIL */}
        <div className="path-rail">
          <div className="card">
            <div className="row spread"><h3 className="row" style={{ gap: 8, margin: 0 }}><Target size={16} color="var(--cyan)" /> {t('dash.progress')}</h3><Link className="small" to="/progress">{t('dash.viewAll')} →</Link></div>
            <div style={{ marginTop: 10 }}>
              {trackStats.map(({ def, pct }) => {
                const Icon = def.icon;
                return (
                  <div key={def.id} style={{ margin: '7px 0' }}>
                    <div className="row spread small"><span className="row" style={{ gap: 6 }}><Icon size={13} /> {t(def.nameKey as LocaleKey)}</span><span>{pct}%</span></div>
                    <Bar pct={pct} />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card">
            <h3 className="row" style={{ gap: 8, margin: 0 }}><BookOpen size={16} color="var(--green)" /> {t('dash.activity')}</h3>
            {!activity.length && <p className="muted small" style={{ marginTop: 8 }}>{t('dash.emptyActivity')}</p>}
            {activity.map((e, i) => (
              <Link key={i} to={e.to} className="activity-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className="adot" style={{ background: e.color }} />
                <span style={{ flex: 1 }}>{e.label}</span>
                <time>{ago(e.at)}</time>
              </Link>
            ))}
          </div>
          <div className="card">
            <div className="row spread"><h3 className="row" style={{ gap: 8, margin: 0 }}><Code2 size={16} color="var(--amber)" /> {t('dash.quick')}</h3><span className="chip">{t('dash.week')}</span></div>
            <div className="statgrid" style={{ marginTop: 10 }}>
              <div className="stat"><div className="n">{mastered.length}</div><div className="l">{t('dash.topicsDone')}</div></div>
              <div className="stat"><div className="n">{codingDone}/{codingTotal}</div><div className="l">{t('dash.codingTasks')}</div></div>
              <div className="stat"><div className="n">{weekXp}</div><div className="l">XP</div></div>
              <div className="stat"><div className="n">{state.streak.current}d</div><div className="l">{t('dash.levelStreak')}</div></div>
            </div>
          </div>
        </div>
      </div>

      {/* TOOLS ROW — every tile is a real destination, no dead links */}
      <div className="sec-head"><h2>{t('dash.tools')}</h2><span className="line" /></div>
      <div className="tile-grid">
        {[
          { to: '/notes', icon: StickyNote, label: t('nav.notes'), sub: t('dash.toolsNotes'), color: 'var(--amber)' },
          { to: '/cheats', icon: BookMarked, label: t('nav.cheats'), sub: t('dash.toolsResources'), color: 'var(--violet)' },
          { to: '/exam', icon: Timer, label: t('nav.exam'), sub: t('dash.toolsExam'), color: 'var(--cyan)', badge: 'NEW' },
          { to: '/playground', icon: Sparkles, label: 'AI Tutor (Offline)', sub: t('dash.toolsTutor'), color: 'var(--cyan)' },
          { to: '/progress', icon: BarChart3, label: 'Progress', sub: t('dash.toolsProgress'), color: 'var(--green)' },
          { to: '/jobprep', icon: Target, label: t('nav.jobprep'), sub: t('dash.toolsGoals'), color: 'var(--pink)' },
          { to: '/review', icon: Repeat, label: 'Review', sub: t('dash.toolsReview'), color: 'var(--blue)' },
          { to: '/settings', icon: SettingsIcon, label: t('top.settings'), sub: t('dash.toolsSettings'), color: 'var(--muted)' },
        ].map((tile) => (
          <Link key={tile.to} to={tile.to} className="tile" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="ic" style={{ color: tile.color }}><tile.icon size={16} /></span>
            <span className="t" style={{ flex: 1 }}>
              <b>{tile.label} {tile.badge && <span className="badge new">{tile.badge}</span>}</b>
              <span>{tile.sub}</span>
            </span>
          </Link>
        ))}
        <button className="tile" onClick={() => { setUi({ focus: !ui.focus }); }} aria-pressed={ui.focus}>
          <span className="ic" style={{ color: 'var(--cyan)' }}><Moon size={16} /></span>
          <span className="t" style={{ flex: 1, textAlign: 'left' }}>
            <b>{t('top.focus')}</b>
            <span>{ui.focus ? 'On — band karne ke liye click' : t('top.focusSub')}</span>
          </span>
          <span className="badge" style={{ opacity: ui.focus ? 1 : .55 }}>{ui.focus ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      {/* AI ASSISTANT + ACHIEVEMENTS */}
      <div className="grid2" style={{ gridTemplateColumns: '1.15fr 1fr', alignItems: 'start', marginTop: 14 }}>
        <AssistantCard />
        <div className="card">
          <div className="row spread">
            <h3 className="row" style={{ gap: 8, margin: 0 }}><Trophy size={16} color="var(--amber)" /> {t('dash.achievementsTitle')}</h3>
            <span className="chip">{ach.filter((a) => a.earned).length} / {ach.length}</span>
          </div>
          <p className="muted small">Har badge tumhari real progress se banta hai — koi pre-seeded achievement nahi.</p>
          <div className="ach-grid">
            {ach.map((a) => (
              <div key={a.id} className={`ach ${a.earned ? 'earned pop-in' : ''}`} title={a.hint}>
                <span className="em" style={{ filter: a.earned ? 'none' : 'grayscale(1)', opacity: a.earned ? 1 : .45 }}>{a.icon}</span>
                <b>{a.label}</b>
                {a.earned
                  ? <span style={{ color: 'var(--amber)' }}>✓ Unlocked</span>
                  : <span>{a.got} / {a.need} — {a.hint.toLowerCase()}</span>}
                {!a.earned && <div className="bar"><div style={{ width: `${(a.got / a.need) * 100}%` }} /></div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="small muted" style={{ textAlign: 'center', marginTop: 18 }}>{t('dash.quote')} 🚀</p>

      {/* CURRENT GOAL BAR */}
      <div className="goalbar">
        <div className="stage" style={{ flex: 2 }}>
          <Target size={18} color="var(--pink)" />
          <div className="lbl"><b>{t('dash.goal')}: {state.profile.goal}</b><span className="muted">{t('top.level')} {level} · {t('dash.goalSub')}</span></div>
        </div>
        {[t('dash.stage1'), t('dash.stage2'), t('dash.stage3'), t('dash.stage4')].map((lbl, i) => (
          <div key={lbl} className={`stage ${stage === i + 1 ? 'on' : ''}`}>
            <span className="stepnum">{i + 1}</span>
            <div className="lbl"><b>{lbl}</b></div>
          </div>
        ))}
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
