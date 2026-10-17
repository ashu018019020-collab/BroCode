import { useStore, setState, exportProgress, importProgress, defaultState } from '../../core/storage/store';
import { LanguageToggle } from '../../components/ui/LanguageToggle';

export default function SettingsPage() {
  const state = useStore();
  const p = state.profile;

  return (
    <div>
      <h1>⚙️ Settings</h1>
      <div className="card">
        <h2>Language</h2>
        <p className="small muted" style={{ margin: '0 0 10px' }}>
          English is the default. You can switch the interface and supported learning content to Hinglish at any time — the choice is saved on this device.
        </p>
        <LanguageToggle />
      </div>
      <div className="card">
        <h2>Profile</h2>
        <div className="grid2">
          <label className="small">Name
            <input value={p.name} onChange={(e) => setState((s) => ({ ...s, profile: { ...s.profile, name: e.target.value } }))} />
          </label>
          <label className="small">Goal
            <select value={p.goal} onChange={(e) => setState((s) => ({ ...s, profile: { ...s.profile, goal: e.target.value } }))}>
              {['Programming & Software Development', 'AI & Machine Learning', 'Data Science & Analytics', 'Web Development', 'GenAI Engineering'].map((g) => <option key={g}>{g}</option>)}
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
        <h2>Study flow</h2>
        <label className="row small">
          <input
            type="checkbox"
            checked={state.settings.autoAdvance !== false}
            onChange={(e) => setState((s) => ({ ...s, settings: { ...s.settings, autoAdvance: e.target.checked } }))}
          />
          Auto-advance: open the next task, stage, or topic as soon as one is complete
        </label>
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          When enabled, a card with a 7-second countdown appears — choose &quot;Stay here&quot; to remain on the
          current item. When disabled, the card still says what comes next, but nothing opens automatically.
        </p>
      </div>

      <div className="card">
        <h2>Accessibility & motion</h2>
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
        <h2>Data & backup</h2>
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
        <h2>Optional online services</h2>
        <p className="small muted">
          This app runs fully on your device. No API keys are needed for any core learning feature. If you later want a real
          LLM-backed answer evaluator, it would run <b>online and optional</b> — clearly labeled, never required.
          The current evaluation is deterministic: test cases + keyword rubrics.
        </p>
      </div>
    </div>
  );
}
