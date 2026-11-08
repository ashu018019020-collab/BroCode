import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, setState } from '../../core/storage/store';
import { useAuth } from '../../core/auth/AuthProvider';
import { DAILY_MINUTES, GOALS, LEVELS, PROFILE_DEFAULTS, startPlan } from '../../core/learning/onboarding';

const Choice = ({ options, value, onPick }: { options: readonly string[]; value: string; onPick: (v: string) => void }) => (
  <div className="row" style={{ margin: '12px 0' }}>
    {options.map((o) => (
      <button
        key={o}
        type="button"
        className={`stagepill ${value === o ? 'active' : ''}`}
        aria-pressed={value === o}
        onClick={() => onPick(o)}
      >{o}</button>
    ))}
  </div>
);

/** 120 minutes is "2+ hours" on the button and "120 min" in the plan — one label, no drift. */
const minutesLabel = (n: number) => (n >= 120 ? '2+ hours' : `${n} min`);

export default function Onboarding() {
  const nav = useNavigate();
  const state = useStore();
  /**
   * The account's own name is the starting value, and the field is EMPTY for a fresh learner.
   *
   * `state.profile.name` no longer ships a default (see `defaultState`), so this input starts blank
   * and is filled from the verified account — never from application-controlled seed data. Falling
   * back to the signed-in account means a learner who already gave their name at signup does not have
   * to type it a second time.
   */
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(state.profile.name || user?.name || '');
  const [goal, setGoal] = useState(state.profile.goal || PROFILE_DEFAULTS.goal);
  const [level, setLevel] = useState(state.profile.level || PROFILE_DEFAULTS.level);
  const [minutes, setMinutes] = useState(state.profile.dailyMinutes || PROFILE_DEFAULTS.dailyMinutes);
  const [touched, setTouched] = useState(false);

  const validName = name.trim().length > 1;

  /** Where this learner should actually start — derived, never a hardcoded lesson. */
  const plan = startPlan(goal, level);

  /**
   * Persist the four answers. The name is only replaced when there IS a name, so skipping the
   * first step cannot blank out a name the account already gave.
   */
  const save = () => {
    setState((s) => ({
      ...s,
      profile: {
        ...s.profile,
        name: name.trim() || s.profile.name,
        goal,
        level,
        dailyMinutes: minutes,
        onboarded: true,
      },
    }));
  };

  /**
   * Skipping is a first-class exit, not a hidden one: it writes the same complete profile as
   * finishing (with the defaults for anything unanswered) and lands on the dashboard, so the rest
   * of the app never meets a half-written profile. Settings edits all four fields afterwards.
   */
  const skip = () => {
    save();
    nav('/');
  };

  const finish = () => {
    save();
    nav(plan.route);
  };

  /**
   * Step 0 collects the name, so "Next" is refused until there is one. Without this a learner could
   * walk through to a dashboard that greets an empty string — the same blank heading the old
   * hardcoded default was hiding.
   */
  const next = () => {
    if (step === 0 && !validName) { setTouched(true); return; }
    setStep(step + 1);
  };

  return (
    <div className="card" style={{ maxWidth: 640, margin: '40px auto', padding: 26 }}>
      <h1 style={{ fontSize: '1.5rem' }}>Let's build your learning foundation.</h1>
      <p className="muted small" aria-live="polite">
        Step {step + 1} of 4 · about a minute
      </p>

      {step === 0 && (
        <>
          <label className="small" htmlFor="onboarding-name">Your name:</label>
          <input
            id="onboarding-name"
            aria-invalid={touched && !validName}
            autoComplete="name"
            className={touched && !validName ? 'invalid' : ''}
            onBlur={() => setTouched(true)}
            onChange={(e) => setName(e.target.value)}
            placeholder="Type your name"
            value={name}
          />
          {touched && !validName && (
            <em className="auth-hint error" role="alert">Enter your name (at least 2 letters).</em>
          )}
          <p className="small" style={{ margin: '16px 0 0' }}>What do you want to get good at?</p>
          {/* Fields of study, broadest first — AI/ML is one path among several. */}
          <Choice options={GOALS} value={goal} onPick={setGoal} />
        </>
      )}
      {step === 1 && (
        <>
          <p className="small" style={{ margin: '16px 0 0' }}>How much have you already done?</p>
          <Choice options={LEVELS} value={level} onPick={setLevel} />
          <p className="small muted">This decides your starting step — not your pace. You can open any step any time.</p>
        </>
      )}
      {step === 2 && (
        <>
          <p className="small" style={{ margin: '16px 0 0' }}>How much time can you give on a normal day?</p>
          <Choice
            options={DAILY_MINUTES.map(minutesLabel)}
            value={minutesLabel(minutes)}
            onPick={(v) => setMinutes(DAILY_MINUTES[DAILY_MINUTES.map(minutesLabel).indexOf(v)] ?? PROFILE_DEFAULTS.dailyMinutes)}
          />
          <p className="small muted">Used by the goal ring and the daily target on Progress. Nothing locks when you miss a day.</p>
        </>
      )}
      {step === 3 && (
        <div>
          <p className="small">Your plan:</p>
          <ul className="small">
            <li>Name: <b>{name.trim()}</b></li>
            <li>Goal: <b>{goal}</b></li>
            <li>Level: <b>{level}</b></li>
            <li>Daily time: <b>{minutes} min</b></li>
          </ul>
          <div className="card" style={{ margin: '14px 0 0', padding: 14 }}>
            <p className="small" style={{ margin: 0 }}>You start here · step {plan.no} of 36</p>
            <p style={{ margin: '4px 0 6px', fontWeight: 600 }}>{plan.title}</p>
            <p className="small muted" style={{ margin: 0 }}>{plan.why}</p>
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>← Back</button>}
        {step < 3 && <button className="btn primary" onClick={next}>Next →</button>}
        {step === 3 && <button className="btn primary" onClick={finish}>Start step {plan.no} ▶</button>}
        <button className="btn" onClick={skip} style={{ marginLeft: 'auto' }}>Skip for now</button>
      </div>
      <p className="small muted" style={{ margin: '10px 0 0' }}>
        Skipping keeps what you have picked so far, defaults the rest, and leaves you on the dashboard.
        Settings → Profile edits every answer later.
      </p>
    </div>
  );
}
