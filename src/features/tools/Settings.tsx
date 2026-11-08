import { useEffect, useRef, useState } from 'react';
import { useStore, setState, exportProgress, importProgress, defaultState } from '../../core/storage/store';
import { DAILY_MINUTES, GOALS, LEVELS } from '../../core/learning/onboarding';
import { LanguageToggle } from '../../components/ui/LanguageToggle';

export default function SettingsPage() {
  const state = useStore();
  const p = state.profile;
  /*
   * The name is the one field that is TYPED, so it cannot write on every keystroke: `setState`
   * re-serialises the whole progress record (measured at 1.18 MB and ~17 ms once the bank has been
   * used) on every call. It is committed after a pause, on Enter, and on leaving the page.
   */
  const [name, setName] = useState(p.name);
  const draft = useRef({ name, saved: p.name });
  draft.current = { name, saved: p.name };
  const commitName = (value: string) => setState((s) => (
    s.profile.name === value ? s : { ...s, profile: { ...s.profile, name: value } }
  ));

  useEffect(() => {
    if (name === p.name) return;
    const timer = window.setTimeout(() => commitName(name), 400);
    return () => window.clearTimeout(timer);
  }, [name, p.name]);

  // A typed name must survive leaving the page inside the debounce window too.
  useEffect(() => () => {
    const { name: typed, saved } = draft.current;
    if (typed !== saved) setState((s) => ({ ...s, profile: { ...s.profile, name: typed } }));
  }, []);

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
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => commitName(name)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitName(name); }}
            />
          </label>
          {/* The three pickers read the SAME lists onboarding offers (`core/learning/onboarding.ts`):
              a duplicated array here once meant a new option could exist in onboarding and not in
              Settings, where the select renders blank because no option carries the stored value. */}
          <label className="small">Goal
            <select value={p.goal} onChange={(e) => setState((s) => ({ ...s, profile: { ...s.profile, goal: e.target.value } }))}>
              {GOALS.map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
          <label className="small">Level
            <select value={p.level} onChange={(e) => setState((s) => ({ ...s, profile: { ...s.profile, level: e.target.value } }))}>
              {LEVELS.map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
          <label className="small">Daily study time
            <select value={p.dailyMinutes} onChange={(e) => setState((s) => ({ ...s, profile: { ...s.profile, dailyMinutes: Number(e.target.value) } }))}>
              {DAILY_MINUTES.map((g) => <option key={g} value={g}>{g === 120 ? '120 min (2+ hours)' : `${g} min`}</option>)}
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
            onClick={() => {
              if (confirm('Reset all course progress (XP, attempts, mistakes, study log, notes)? Export first if unsure.')) {
                setState(() => defaultState());
              }
            }}
          >
            Reset progress
          </button>
        </div>
        {/* The reset writes `defaultState()`; it does not touch the device-local records that live
            under their own keys (mentor transcript, mock reports, interview drafts, online-voice
            consent). Saying "everything" made the button claim a sweep it never did. */}
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          Reset clears this account&apos;s learning record only. Saved AI Mentor chats, mock-interview
          reports, interview drafts and your voice consent are stored separately on this device and stay
          where they are.
        </p>
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
