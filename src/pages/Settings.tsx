import { useStore, setState, exportProgress, importProgress, defaultState } from '../offline/store';

export default function SettingsPage() {
  const state = useStore();
  const p = state.profile;

  return (
    <div>
      <h1>⚙️ Settings</h1>
      <div className="card">
        <h3>Profile</h3>
        <div className="grid2">
          <label className="small">Name
            <input value={p.name} onChange={(e) => setState((s) => ({ ...s, profile: { ...s.profile, name: e.target.value } }))} />
          </label>
          <label className="small">Goal
            <select value={p.goal} onChange={(e) => setState((s) => ({ ...s, profile: { ...s.profile, goal: e.target.value } }))}>
              {['AI Engineer / GenAI / Agentic AI', 'GenAI Engineer', 'Data Scientist', 'Agentic AI Engineer'].map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
          <label className="small">Level
            <select value={p.level} onChange={(e) => setState((s) => ({ ...s, profile: { ...s.profile, level: e.target.value } }))}>
              {['Beginner', 'Intermediate', 'Advanced'].map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
          <label className="small">Daily study time
            <select value={p.dailyMinutes} onChange={(e) => setState((s) => ({ ...s, profile: { ...s.profile, dailyMinutes: Number(e.target.value) } }))}>
              {[30, 60, 90, 120].map((g) => <option key={g} value={g}>{g} min</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <h3>Accessibility & motion</h3>
        <label className="row small">
          <input
            type="checkbox"
            checked={state.settings.reduceMotion}
            onChange={(e) => setState((s) => ({ ...s, settings: { ...s.settings, reduceMotion: e.target.checked } }))}
          />
          Reduce motion (also respects your OS setting)
        </label>
      </div>

      <div className="card">
        <h3>Data & backup</h3>
        <div className="row">
          <button className="btn" onClick={exportProgress}>⬇ Export progress</button>
          <label className="btn" style={{ cursor: 'pointer' }}>
            ⬆ Import progress
            <input type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => {
              e.target.value = '';
              const f = e.target.files?.[0];
              if (f) importProgress(f).then(() => alert('Progress imported.')).catch((err) => alert('Import failed: progress NOT changed. ' + err.message));
            }} />
          </label>
          <button
            className="btn"
            style={{ borderColor: 'rgba(248,113,113,.5)', color: 'var(--red)' }}
            onClick={() => { if (confirm('Reset ALL progress? Export first if unsure.')) setState(() => defaultState()); }}
          >
            Reset everything
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Optional online services</h3>
        <p className="small muted">
          This app is fully offline. No API keys are needed for any core learning feature. If you later want a real
          LLM-backed answer evaluator, it would run <b>online and optional</b> — clearly labeled, never required.
          The current evaluation is deterministic: test cases + keyword rubrics.
        </p>
      </div>
    </div>
  );
}
