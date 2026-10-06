import { useMemo, useState } from 'react';
import { HubCrumb } from '../../components/learning/SectionChrome';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useCurriculum } from '../../core/data/curriculum';
import { useStore, setState, addXp } from '../../core/storage/store';
import { defenseScore, DEFENSE_QUESTIONS } from '../../core/assessment/evaluate';
import { DEFENSE_PROJECTS } from '../../core/assessment/defense';
import { resumeDefenseAnswer } from '../../core/platform/keys';
import { ArchitectureDiagram } from '../../components/ui/ui';


export default function DefensePage() {
  const { sections } = useCurriculum();
  const state = useStore();
  const [projIdx, setProjIdx] = useState(0);
  const [mode, setMode] = useState<'pitch' | 'defense'>('pitch');
  const [answers, setAnswers] = useState<string[]>(() => DEFENSE_QUESTIONS.map(() => ''));
  const [score, setScore] = useState<{ total: number; per: { pct: number; missing: string[] }[] } | null>(null);
  const proj = DEFENSE_PROJECTS[projIdx];

  const resumeSection = sections.find((s) => s.no === 29);
  const keyPoints = useMemo(() => resumeSection?.interview.slice(0, 4).map((q) => q.q) ?? [], [resumeSection]);

  const submitDefense = () => {
    const sc = defenseScore(answers);
    setScore(sc);
    answers.forEach((a, i) => setState((s) => ({ ...s, defenseAnswers: { ...s.defenseAnswers, [resumeDefenseAnswer(proj.id, i)]: a } })));
    if (sc.total >= 60) addXp(25, 'defense', 'Project defense');
  };

  return (
    <div>
      <HubCrumb hub="/interviews" hubLabel="Interview" page="Project Defense" />
      <h1>💼 Project Defense</h1>
      <p className="muted small">The PDF's capstone projects with pitches, architecture and a 10-question defense. Use only claims you can defend with evidence — never invent details under pressure.</p>

      <div className="row" style={{ margin: '12px 0' }}>
        {DEFENSE_PROJECTS.map((p, i) => (
          <button key={p.id} className={`stagepill ${projIdx === i ? 'active' : ''}`} onClick={() => { setProjIdx(i); setScore(null); setAnswers(DEFENSE_QUESTIONS.map(() => '')); }}>
            {p.name.split(' ').slice(0, 3).join(' ')}
          </button>
        ))}
      </div>

      <div className="card glow">
        <h2>{proj.name}</h2>
        <ArchitectureDiagram nodes={proj.arch} note="Walk the interviewer along this flow — data flow questions are the most common follow-ups." />
        <div style={{ marginTop: 10 }}>
          {Object.entries(proj.pitch).map(([k, v]) => (
            <details key={k} style={{ margin: '8px 0' }}>
              <summary className="small"><b>{k} pitch</b></summary>
              <p className="small">{v}</p>
            </details>
          ))}
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          Likely follow-ups: {proj.questions.join(' · ')}
        </div>
      </div>

      {keyPoints.length > 0 && (
        <div className="card">
          <b className="small">From the PDF — Project Interview Labs (p.{resumeSection?.pages.interview[0]}):</b>
          <ul className="small" style={{ margin: '6px 0 0 18px' }}>
            {keyPoints.map((k, i) => <li key={i}>{k}</li>)}
          </ul>
          <p className="small muted">60-sec skeleton: "I built X to solve Y. I used A/B/C. My main contribution was Z. The hardest issue was Q, solved by R. Result: S. Next: T."</p>
        </div>
      )}

      <div className="row" style={{ margin: '12px 0' }}>
        <button className={`stagepill ${mode === 'pitch' ? 'active' : ''}`} onClick={() => setMode('pitch')}>Pitches</button>
        <button className={`stagepill ${mode === 'defense' ? 'active' : ''}`} onClick={() => setMode('defense')}>Defense Q&A</button>
      </div>

      {mode === 'defense' && (
        <div className="card">
          {DEFENSE_QUESTIONS.map((dq, i) => (
            <div key={i} style={{ margin: '10px 0' }}>
              <label className="small"><b>{i + 1}. {dq.q}</b></label>
              <textarea className="console" rows={2} value={answers[i]} onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))} />
              {score && (
                <div className="small" style={{ color: score.per[i].pct >= 60 ? 'var(--green)' : 'var(--red)' }}>
                  {score.per[i].pct}%{score.per[i].missing.length ? ` — missing: ${score.per[i].missing.join(', ')}` : ''}
                </div>
              )}
            </div>
          ))}
          <button className="btn primary" onClick={submitDefense}>Score my defense</button>
          {score && <p className="small" style={{ marginTop: 8 }}>TOTAL: <b>{score.total}/100</b> {score.total >= 60 ? '✅' : '⚠️'} — key points to include: problem, stack, architecture, YOUR contribution, result, limitation, next step.</p>}
        </div>
      )}
    </div>
  );
}
