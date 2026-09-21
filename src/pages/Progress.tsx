import { useCurriculum } from '../data/curriculum';
import { useStore, exportProgress, importProgress } from '../offline/store';
import { sectionProgress, isMastered } from '../engine/progress';
import { Bar, ProgressRing } from '../components/ui';

const TRACKS = [
  { name: 'Python', from: 1, to: 16 },
  { name: 'NumPy/Pandas', from: 17, to: 18 },
  { name: 'SQL', from: 19, to: 19 },
  { name: 'ML/NLP', from: 20, to: 21 },
  { name: 'GenAI/Agentic', from: 22, to: 23 },
  { name: 'APIs/Production', from: 24, to: 26 },
  { name: 'Interview/Projects', from: 27, to: 29 },
];

export default function ProgressPage() {
  const { sections } = useCurriculum();
  const state = useStore();
  const overall = Math.round(sections.reduce((a, s) => a + sectionProgress(s, state).masterPct, 0) / sections.length);
  const activity = Object.entries(state.activity).sort().slice(-14);

  return (
    <div>
      <h1>📊 Progress</h1>
      <div className="row" style={{ margin: '14px 0' }}>
        <ProgressRing pct={overall} size={110} label="Overall mastery" />
        <div className="statgrid" style={{ flex: 1 }}>
          <div className="stat"><div className="n">{sections.filter((s) => isMastered(s, state)).length}</div><div className="l">mastered</div></div>
          <div className="stat"><div className="n">{state.xp}</div><div className="l">XP</div></div>
          <div className="stat"><div className="n">{state.mistakes.filter((m) => !m.fixed).length}</div><div className="l">open mistakes</div></div>
          <div className="stat"><div className="n">{Object.values(state.activity).reduce((a, b) => a + b, 0)}</div><div className="l">total XP earned</div></div>
        </div>
      </div>

      <div className="card">
        <h3>Mastery by track</h3>
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

      <div className="card">
        <h3>Activity (last 14 active days)</h3>
        {!activity.length && <p className="muted small">No activity recorded yet.</p>}
        {activity.map(([d, xp]) => (
          <div key={d} className="row spread small" style={{ padding: '2px 0' }}>
            <span>{d}</span>
            <span className="row" style={{ gap: 8 }}>
              <span style={{ width: 120 }} className="bar"><div style={{ width: `${Math.min(100, xp / 3)}%` }} /></span>
              <span className="muted">{xp} XP</span>
            </span>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Data</h3>
        <p className="small muted">All progress lives in your browser (localStorage). Export to back up or move devices.</p>
        <div className="row">
          <button className="btn" onClick={exportProgress}>⬇ Export progress (JSON)</button>
          <label className="btn" style={{ cursor: 'pointer' }}>
            ⬆ Import progress
            <input type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => {
              e.target.value = '';
              const f = e.target.files?.[0];
              if (f) importProgress(f).then(() => alert('Progress imported.')).catch((err) => alert('Import failed: progress NOT changed. ' + err.message));
            }} />
          </label>
        </div>
      </div>
    </div>
  );
}
