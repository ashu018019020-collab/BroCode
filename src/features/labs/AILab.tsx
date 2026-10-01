import { useMemo, useState } from 'react';
import { ArchitectureDiagram } from '../../components/ui/ui';

/** Tiny deterministic local "embedding" for the visual demo — hashing n-grams into a vector. */
function toyEmbed(text: string, dim = 24): number[] {
  const v = new Array(dim).fill(0);
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (const w of words) {
    let h = 0;
    for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) % 100000;
    v[h % dim] += 1;
  }
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => +(x / n).toFixed(3));
}
const cosine = (a: number[], b: number[]) => {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return +dot.toFixed(3);
};

const DOCS = [
  'Pyodide runs Python in the browser via WebAssembly.',
  'RAG retrieves relevant documents before the LLM answers.',
  'Pandas groupby splits data into groups and aggregates each.',
  'Embeddings map text to vectors so similar meanings sit close together.',
  'Agents pick tools based on the task and inspect results before continuing.',
];

export default function AILab() {
  const [query, setQuery] = useState('How does RAG ground answers?');
  const [promptTpl, setPromptTpl] = useState('Answer only from context:\n{context}\n\nQ: {question}');
  const [jsonOut, setJsonOut] = useState('{"answer": "RAG grounds answers by retrieving documents first.", "sources": [1], "confidence": 0.86}');

  const qEmb = useMemo(() => toyEmbed(query), [query]);
  const ranked = useMemo(() => {
    return DOCS.map((d, i) => ({ d, i, score: cosine(qEmb, toyEmbed(d)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [qEmb]);

  const context = ranked.map((r) => `[doc ${r.i + 1}] ${r.d}`).join('\n');
  const groundedPrompt = promptTpl.replace('{context}', context).replace('{question}', query);

  let jsonStatus: { ok: boolean; msg: string } = { ok: false, msg: '' };
  try {
    const parsed = JSON.parse(jsonOut);
    if (!('answer' in parsed)) throw new Error('missing "answer" key');
    jsonStatus = { ok: true, msg: `Valid JSON · keys: ${Object.keys(parsed).join(', ')}` };
  } catch (e: any) {
    jsonStatus = { ok: false, msg: String(e.message) };
  }

  const tokens = groundedPrompt.split(/\s+/).filter(Boolean).length;

  return (
    <div>
      <h1>🤖 AI / GenAI Lab</h1>
      <p className="muted small">Deterministic local simulations — no API keys, no internet. Concepts behave like the real pipelines so you can reason about them.</p>

      <div className="card">
        <h3>RAG pipeline (simulated)</h3>
        <ArchitectureDiagram nodes={['Query', 'Embed', 'Vector similarity', 'Top-k docs', 'Grounded prompt', 'LLM (answer span)', 'Answer + sources']} note="Click any stage. In production, 'LLM' is a model call — here the retrieval logic is fully local." />
      </div>

      <div className="grid2">
        <div className="card">
          <h3>1. Retrieval demo (toy embeddings)</h3>
          <label className="small">Query</label>
          <input value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: '100%' }} />
          <div style={{ margin: '10px 0' }}>
            {ranked.map((r) => (
              <div key={r.i} className="row spread small" style={{ padding: '3px 0' }}>
                <span>[doc {r.i + 1}] {r.d.slice(0, 44)}…</span>
                <span className="chip">{r.score}</span>
              </div>
            ))}
          </div>
          <p className="small muted">Cosine similarity ranks the docs. Top-2 become the context — exactly the real RAG flow, scaled down.</p>
        </div>

        <div className="card">
          <h3>2. Grounded prompt builder</h3>
          <textarea className="console" rows={6} value={promptTpl} onChange={(e) => setPromptTpl(e.target.value)} />
          <p className="small muted">Rendered ({tokens} words ≈ {Math.ceil(tokens * 1.3)} tokens):</p>
          <pre className="codeblock" style={{ maxHeight: 160 }}><code>{groundedPrompt}</code></pre>
        </div>
      </div>

      <div className="card">
        <h3>3. JSON structured-output validator</h3>
        <textarea className="console" rows={4} value={jsonOut} onChange={(e) => setJsonOut(e.target.value)} />
        <div className="row" style={{ marginTop: 6 }}>
          <span className="chip" style={{ color: jsonStatus.ok ? 'var(--green)' : 'var(--red)' }}>
            {jsonStatus.ok ? '✅ PASS' : '❌ FAIL'}
          </span>
          <span className="small muted">{jsonStatus.msg}</span>
        </div>
        <p className="small muted">Real LLM apps validate JSON before acting on it — break the JSON above and watch validation catch it.</p>
      </div>
    </div>
  );
}
