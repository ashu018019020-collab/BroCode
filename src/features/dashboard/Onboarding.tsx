import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, setState } from '../../core/storage/store';
import { useAuth } from '../../core/auth/AuthProvider';

const Choice = ({ options, value, onPick }: { options: string[]; value: string; onPick: (v: string) => void }) => (
  <div className="row" style={{ margin: '12px 0' }}>
    {options.map((o) => (
      <button key={o} className={`stagepill ${value === o ? 'active' : ''}`} onClick={() => onPick(o)}>{o}</button>
    ))}
  </div>
);

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
  const [goal, setGoal] = useState(state.profile.goal);
  const [level, setLevel] = useState(state.profile.level);
  const [minutes, setMinutes] = useState(state.profile.dailyMinutes);
  const [touched, setTouched] = useState(false);

  const validName = name.trim().length > 1;

  const finish = () => {
    setState((s) => ({ ...s, profile: { name: name.trim(), goal, level, dailyMinutes: minutes, onboarded: true } }));
    nav('/lesson/s01/learn');
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
      <p className="muted small">Step {step + 1} of 4</p>

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
          {/* Fields of study, broadest first — AI/ML is one path among several. */}
          <Choice options={['Programming & Software Development', 'AI & Machine Learning', 'Data Science & Analytics', 'Web Development', 'GenAI Engineering']} value={goal} onPick={setGoal} />
        </>
      )}
      {step === 1 && <Choice options={['Beginner', 'Intermediate', 'Advanced']} value={level} onPick={setLevel} />}
      {step === 2 && <Choice options={['30 min', '60 min', '90 min', '2+ hours']} value={`${minutes} min`} onPick={(v) => setMinutes(v.startsWith('2') ? 120 : parseInt(v, 10))} />}
      {step === 3 && (
        <div>
          <p className="small">Plan ready:</p>
          <ul className="small">
            <li>Name: <b>{name.trim()}</b></li>
            <li>Goal: <b>{goal}</b></li>
            <li>Level: <b>{level}</b></li>
            <li>Daily time: <b>{minutes} min</b></li>
            <li>First task: <b>Variables &amp; Data Types → Learn</b></li>
          </ul>
        </div>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>← Back</button>}
        {step < 3 && <button className="btn primary" onClick={next}>Next →</button>}
        {step === 3 && <button className="btn primary" onClick={finish}>Start learning ▶</button>}
      </div>
    </div>
  );
}
