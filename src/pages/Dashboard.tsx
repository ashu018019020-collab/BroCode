import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useCurriculum } from '../data/curriculum';
import { useStore, bumpStreak } from '../offline/store';
import { sectionProgress, currentSection, isMastered, nextBestAction } from '../engine/progress';
import { dailyMission } from '../engine/mission';
import { levelForXp } from '../engine/keys';
import { Bar, ProgressRing } from '../components/ui';

const TRACKS = [
  { name: 'Python Core', from: 1, to: 16 },
  { name: 'Data (NumPy/Pandas/SQL)', from: 17, to: 19 },
  { name: 'ML + NLP', from: 20, to: 21 },
  { name: 'GenAI + Agentic', from: 22, to: 23 },
  { name: 'APIs + Production', from: 24, to: 26 },
  { name: 'Interview + Projects', from: 27, to: 29 },
];

export default function Dashboard() {
  const { sections } = useCurriculum();
  const state = useStore();
  bumpStreak();
  const cur = currentSection(sections, state);
  const { tasks, masterPct } = sectionProgress(cur, state);
  const mission = useMemo(() => dailyMission(state, sections), [state, sections]);
  const nba = nextBestAction(cur, state);

  const overall = useMemo(
    () => Math.round(sections.reduce((a, s) => a + sectionProgress(s, state).masterPct, 0) / sections.length),
    [sections, state],
  );

  const mastered = sections.filter((s) => isMastered(s, state));
  const needsPractice = sections.filter((s) => !isMastered(s, state) && sectionProgress(s, state).masterPct > 0);

  return (
    <div>
      <div className="hero row spread" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1>Welcome back, {state.profile.name}.</h1>
          <p className="muted">Current goal: {state.profile.goal} · Level {levelForXp(state.xp)}</p>
        </div>
        <div className="row">
          <ProgressRing pct={overall} size={84} label="Overall mastery" />
          <div className="stat" style={{ textAlign: 'center' }}>
            <div className="n">🔥 {state.streak.current}</div>
            <div className="l">day streak</div>
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>📌 Today's Mission</h3>
          {!mission.length && <p className="muted small">All current tasks complete. Open the Learning Path for review.</p>}
          {mission.map((t) => (
            <div key={t.id} className="row spread" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="small">{t.label}</span>
              <span className="row">
                <span className="small muted">~{t.minutes}m</span>
                <Link className="btn small" to={t.route}>Start</Link>
              </span>
            </div>
          ))}
        </div>

        <div className="card">
          <h3>🧭 Next Best Action</h3>
          <p className="small"><b>{nba.label}</b></p>
          <p className="small muted">{nba.reason}</p>
          <Link className="btn primary" to={nba.route}>Start task</Link>
          <div style={{ height: 10 }} />
          <h3>▶ Continue Learning</h3>
          <p className="small">{cur.title} — {masterPct}%</p>
          <div className="bar"><div style={{ width: `${masterPct}%` }} /></div>
          <div style={{ height: 10 }} />
          <Link className="btn" to={`/lesson/${cur.id}/learn`}>Continue</Link>
        </div>
      </div>

      <div className="card">
        <h3>📊 Progress by Track</h3>
        {TRACKS.map((t) => {
          const secs = sections.filter((s) => s.no >= t.from && s.no <= t.to);
          const pct = Math.round(secs.reduce((a, s) => a + sectionProgress(s, state).masterPct, 0) / Math.max(1, secs.length));
          return (
            <div key={t.name} style={{ margin: '8px 0' }}>
              <div className="row spread small"><span>{t.name}</span><span>{pct}%</span></div>
              <Bar pct={pct} />
            </div>
          );
        })}
      </div>

      <div className="grid2">
        <div className="card">
          <h3>✅ Mastered</h3>
          {!mastered.length && <p className="muted small">Nothing mastered yet — the first checkpoint awaits.</p>}
          <div className="row">
            {mastered.map((s) => <Link key={s.id} className="chip" to={`/lesson/${s.id}/learn`} style={{ borderColor: 'rgba(52,211,153,.4)', color: 'var(--green)' }}>✓ {s.title}</Link>)}
          </div>
        </div>
        <div className="card">
          <h3>🎯 Needs Practice</h3>
          {!needsPractice.length && <p className="muted small">Everything touched so far is mastered. Keep going!</p>}
          <div className="row">
            {needsPractice.slice(0, 6).map((s) => (
              <Link key={s.id} className="chip" to={`/lesson/${s.id}/learn`}>{s.title} · {sectionProgress(s, state).masterPct}%</Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
