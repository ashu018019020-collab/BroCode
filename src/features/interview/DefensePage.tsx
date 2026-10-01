import { useMemo, useState } from 'react';
import { useCurriculum } from '../../core/data/curriculum';
import { useStore, setState, addXp } from '../../core/storage/store';
import { defenseScore, DEFENSE_QUESTIONS } from '../../core/assessment/evaluate';
import { resumeDefenseAnswer } from '../../core/platform/keys';
import { ArchitectureDiagram } from '../../components/ui/ui';

const RESUME_PROJECTS = [
  {
    id: 'chatbot',
    name: 'AI-Powered Professional Chatbot',
    arch: ['User', 'Flask API', 'Validation', 'NLP/LLM service', 'Database (history)', 'Response'],
    pitch: {
      '60-second': 'I built an AI chatbot to automate first-line customer questions. Flask exposes a /chat endpoint; requests are validated, the intent is classified, and a response is generated and stored with history in a database for continuity and analytics. The modular design let me swap the response engine without touching the API layer.',
      'Deep technical': 'Request → validation → intent classification → response generation → persistence. I personally implemented the routing, the persistence schema and the error path: invalid payloads get structured 400s, and provider failures fall back to a safe canned response. The biggest bug was session mixing — I isolated it by logging request IDs end-to-end and fixed it by scoping history per user.',
    },
    questions: [
      'Why Flask for this? (lightweight, easy REST endpoints)',
      'Why store chat history in a DB? (persistence, continuity, analytics)',
      'Where would this break at 10x traffic? (sync model calls, no queue, DB pooling)',
    ],
  },
  {
    id: 'n8n',
    name: 'Agentic AI Automation Workflow (n8n)',
    arch: ['Trigger (webhook)', 'n8n workflow', 'State / context', 'Agent decision', 'Allow-listed tools', 'Validation', 'Action (email/CRM)', 'Logs'],
    pitch: {
      '60-second': 'I automated a multi-step business workflow in n8n: a webhook trigger feeds an agent step that decides an action from an allow-list, validation blocks anything unexpected, and side effects like CRM updates run with idempotency keys. Manual handling dropped because the routing decisions — not the whole process — were automated.',
      'Deep technical': 'Key trade-off: deterministic nodes for fixed steps, agent decisions only where variability adds value. I validate the payload schema first, allow-list the action field, and never blindly retry side-effecting calls — idempotency keys and human approval guard high-impact actions.',
    },
    questions: [
      'Why an agent step at all — why not pure workflow? (context-dependent routing)',
      'How do you prove the "reduction in manual work" claim? (before/after measurement)',
      'What happens on duplicate webhook delivery? (idempotency keys)',
    ],
  },
  {
    id: 'powerbi',
    name: 'Power BI Dashboard (Real-World Analytics)',
    arch: ['Source data', 'Cleaning / transform', 'Data model + relationships', 'DAX measures', 'KPI visuals', 'Business insight'],
    pitch: {
      '60-second': 'I built a KPI-driven Power BI dashboard on real business data: cleaned the source, defined grain and relationships, wrote DAX measures like Total Revenue, Order Count and AOV, and designed visuals around the three questions the business actually asks. The value is decisions: trends and outliers became visible instead of buried in spreadsheets.',
      'Deep technical': 'Grain first: I verify the fact-table grain and relationship cardinality before trusting any number — that was also my biggest early bug (revenue doubling from a many-to-many join). Filter context matters for every measure; DIVIDE handles divide-by-zero safely.',
    },
    questions: [
      'What is the grain of your fact table? (row = one order line)',
      'Why did revenue double after a join? (many-to-many relationship)',
      'How do you verify a KPI is correct? (reconcile against a source query)',
    ],
  },
];

export default function DefensePage() {
  const { sections } = useCurriculum();
  const state = useStore();
  const [projIdx, setProjIdx] = useState(0);
  const [mode, setMode] = useState<'pitch' | 'defense'>('pitch');
  const [answers, setAnswers] = useState<string[]>(() => DEFENSE_QUESTIONS.map(() => ''));
  const [score, setScore] = useState<{ total: number; per: { pct: number; missing: string[] }[] } | null>(null);
  const proj = RESUME_PROJECTS[projIdx];

  const resumeSection = sections.find((s) => s.no === 29);
  const keyPoints = useMemo(() => resumeSection?.interview.slice(0, 4).map((q) => q.q) ?? [], [resumeSection]);

  const submitDefense = () => {
    const sc = defenseScore(answers);
    setScore(sc);
    answers.forEach((a, i) => setState((s) => ({ ...s, defenseAnswers: { ...s.defenseAnswers, [resumeDefenseAnswer(proj.id, i)]: a } })));
    if (sc.total >= 60) addXp(25, 'defense', 'Resume project defense');
  };

  return (
    <div>
      <h1>💼 Resume Project Defense</h1>
      <p className="muted small">The PDF's resume projects with pitches, architecture and a 10-question defense. Use only claims you can defend with evidence — never invent details under pressure.</p>

      <div className="row" style={{ margin: '12px 0' }}>
        {RESUME_PROJECTS.map((p, i) => (
          <button key={p.id} className={`stagepill ${projIdx === i ? 'active' : ''}`} onClick={() => { setProjIdx(i); setScore(null); setAnswers(DEFENSE_QUESTIONS.map(() => '')); }}>
            {p.name.split(' ').slice(0, 3).join(' ')}
          </button>
        ))}
      </div>

      <div className="card glow">
        <h3>{proj.name}</h3>
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
          <b className="small">From the PDF — Resume Project Interview Labs (p.{resumeSection?.pages.interview[0]}):</b>
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
