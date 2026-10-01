import { useState } from 'react';
import { ArchitectureDiagram } from '../../components/ui/ui';

interface Step { thought: string; tool: string; observation: string; next: string }

const SCENARIOS: Record<string, { goal: string; steps: Step[] }> = {
  'Process a customer refund request': {
    goal: 'Refund request from chat_logs intent classifier',
    steps: [
      { thought: 'Understand the request: refund for order #104, amount ₹3,750.', tool: 'none', observation: 'Intent = refund, entity = order 104', next: 'Check policy & order state' },
      { thought: 'Need order state before deciding.', tool: 'db.lookup(order=104)', observation: 'Order delivered 3 days ago, eligible for return window.', next: 'Approve refund' },
      { thought: 'Policy satisfied — execute refund.', tool: 'payments.refund(104, 3750)', observation: 'Refund queued, ref RF-9911', next: 'Notify customer, log, stop' },
      { thought: 'Success path complete; side effects logged for audit.', tool: 'notify + log', observation: 'Message sent, log written', next: 'FINAL ANSWER' },
    ],
  },
  'Answer a question with RAG tools': {
    goal: 'Knowledge-base question',
    steps: [
      { thought: 'Question needs facts I must not invent.', tool: 'retrieve(query)', observation: '3 chunks about embeddings and similarity', next: 'Compose grounded answer' },
      { thought: 'Context covers the question — answer only from it.', tool: 'compose(prompt, context)', observation: 'Draft answer with [doc 2] citation', next: 'Validate JSON output' },
      { thought: 'Validation ensures the contract for downstream tools.', tool: 'json.validate', observation: 'OK', next: 'FINAL ANSWER' },
    ],
  },
  'Route an automation webhook (n8n style)': {
    goal: 'Webhook payload with unknown action',
    steps: [
      { thought: 'Validate payload shape first.', tool: 'schema.check', observation: 'Missing field: data.action', next: 'Reject safely' },
      { thought: 'Never act on invalid side-effecting payloads.', tool: 'error.reply(400)', observation: 'Caller receives structured error', next: 'Log + stop' },
    ],
  },
};

export default function AgenticLab() {
  const [scenario, setScenario] = useState(Object.keys(SCENARIOS)[0]);
  const [stepIdx, setStepIdx] = useState(0);
  const sc = SCENARIOS[scenario];
  const step = sc.steps[Math.min(stepIdx, sc.steps.length - 1)];
  const finished = stepIdx >= sc.steps.length - 1;

  return (
    <div>
      <h1>🕸️ Agentic AI Lab</h1>
      <p className="muted small">Step through agent decision loops — thought summaries, tool calls, observations and next actions. Fully local simulation; concise decision summaries, no hidden chain-of-thought.</p>

      <div className="row" style={{ margin: '12px 0' }}>
        {Object.keys(SCENARIOS).map((k) => (
          <button key={k} className={`stagepill ${scenario === k ? 'active' : ''}`} onClick={() => { setScenario(k); setStepIdx(0); }}>
            {k.length > 34 ? k.slice(0, 34) + '…' : k}
          </button>
        ))}
      </div>

      <div className="card">
        <h3>TASK: {scenario}</h3>
        <p className="small muted">{sc.goal}</p>
        <ArchitectureDiagram nodes={['Trigger', 'Agent', 'Context', 'Decision', 'Tool', 'Observation', 'Next Action', 'Final Response']} note="The agent loop: decide → act → observe → repeat until done or stop-condition." />
      </div>

      <div className="card" style={{ borderColor: 'var(--cyan)' }}>
        <div className="row spread">
          <b>Step {Math.min(stepIdx + 1, sc.steps.length)} / {sc.steps.length}</b>
          <div className="row">
            <button className="btn small" disabled={stepIdx === 0} onClick={() => setStepIdx(stepIdx - 1)}>← Back</button>
            <button className="btn primary small" disabled={finished} onClick={() => setStepIdx(stepIdx + 1)}>Execute step ▶</button>
          </div>
        </div>
        <p className="small" style={{ marginTop: 10 }}><b>THOUGHT:</b> {step.thought}</p>
        <p className="small"><b>TOOL:</b> <code>{step.tool}</code></p>
        <p className="small" style={{ color: 'var(--green)' }}><b>OBSERVATION:</b> {step.observation}</p>
        <p className="small" style={{ color: finished ? 'var(--amber)' : 'inherit' }}><b>NEXT ACTION:</b> {step.next}</p>
        {finished && <p className="small"><b>FINAL RESPONSE delivered.</b> Notice the stop condition — agents must know when to stop.</p>}
      </div>
    </div>
  );
}
