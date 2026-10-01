import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, setState } from '../../core/storage/store';

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
  const [step, setStep] = useState(0);
  const [name, setName] = useState(state.profile.name);
  const [goal, setGoal] = useState(state.profile.goal);
  const [level, setLevel] = useState(state.profile.level);
  const [minutes, setMinutes] = useState(state.profile.dailyMinutes);

  const finish = () => {
    setState((s) => ({ ...s, profile: { name, goal, level, dailyMinutes: minutes, onboarded: true } }));
    nav('/lesson/s01/learn');
  };

  return (
    <div className="card" style={{ maxWidth: 640, margin: '40px auto', padding: 26 }}>
      <h1 style={{ fontSize: '1.5rem' }}>Let's build your AI Engineer foundation.</h1>
      <p className="muted small">Step {step + 1} of 4</p>

      {step === 0 && (
        <>
          <p className="small">Your name:</p>
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <Choice options={['AI Engineer / GenAI / Agentic AI', 'GenAI Engineer', 'Data Scientist', 'Agentic AI Engineer']} value={goal} onPick={setGoal} />
        </>
      )}
      {step === 1 && <Choice options={['Beginner', 'Intermediate', 'Advanced']} value={level} onPick={setLevel} />}
      {step === 2 && <Choice options={['30 min', '60 min', '90 min', '2+ hours']} value={`${minutes} min`} onPick={(v) => setMinutes(v.startsWith('2') ? 120 : parseInt(v, 10))} />}
      {step === 3 && (
        <div>
          <p className="small">Plan ready:</p>
          <ul className="small">
            <li>Goal: <b>{goal}</b></li>
            <li>Level: <b>{level}</b></li>
            <li>Daily time: <b>{minutes} min</b></li>
            <li>First task: <b>Variables & Data Types → Learn</b></li>
          </ul>
        </div>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>← Back</button>}
        {step < 3 && <button className="btn primary" onClick={() => setStep(step + 1)}>Next →</button>}
        {step === 3 && <button className="btn primary" onClick={finish}>Start learning ▶</button>}
      </div>
    </div>
  );
}
