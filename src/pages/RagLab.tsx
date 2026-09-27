import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Network, Play, RotateCcw, FileText, Search, Sparkles, Info, ArrowRight } from 'lucide-react';
import { useCurriculum } from '../data/curriculum';
import { useStore, recordAttempt, addXp, setState, today } from '../offline/store';
import { labAttempt } from '../engine/keys';
import { buildChunks, buildIndex, retrieve, answerFrom, tokenize, type Scored } from '../engine/rag';
import { toast } from '../components/Toast';

const RAG_SLOT = 'rag:index';

/** Worked questions that the local corpus can actually answer. */
const SUGGESTED = [
  'What is the difference between list and tuple?',
  'How do I handle a file safely?',
  'What does a lambda function do?',
  'How do NumPy arrays differ from Python lists?',
  'What is an API and why does FastAPI matter?',
];

export default function RagLab() {
  const { sections } = useCurriculum();
  const state = useStore();
  const [corpusKey, setCorpusKey] = useState('all');
  const [custom, setCustom] = useState('');
  const [size, setSize] = useState(60);
  const [overlap, setOverlap] = useState(12);
  const [k, setK] = useState(4);
  const [q, setQ] = useState(SUGGESTED[0]);
  const [asked, setAsked] = useState(false);

  /** The default document set is the real curriculum — never a canned fixture. */
  const docs = useMemo(() => {
    const pick = corpusKey === 'all' ? sections : sections.filter((s) => s.id === corpusKey);
    const out = pick.flatMap((s) =>
      s.learn.concepts
        .filter((c) => c.body || c.code)
        .slice(0, 8)
        .map((c) => ({ text: `${c.title}. ${c.body} ${c.code} ${c.tip}`, source: `${s.id} · ${c.title}` })),
    );
    if (custom.trim()) out.push({ text: custom.trim(), source: 'Your pasted document' });
    return out;
  }, [sections, corpusKey, custom]);

  const chunks = useMemo(() => buildChunks(docs, size, Math.min(overlap, size - 1)), [docs, size, overlap]);
  const index = useMemo(() => buildIndex(chunks), [chunks]);
  const hits: Scored[] = useMemo(() => (q.trim() ? retrieve(index, q, k) : []), [index, q, k]);
  const answer = useMemo(() => answerFrom(q, hits), [q, hits]);

  const avgLen = chunks.length ? Math.round(chunks.reduce((a, c) => a + tokenize(c.text).length, 0) / chunks.length) : 0;
  const passed = state.attempts[RAG_SLOT]?.tries ?? 0;

  // Award XP for actually completing a retrieval round — once per question asked.
  useEffect(() => {
    if (!asked || !q.trim()) return;
    const key = labAttempt('rag', Math.abs(hash(q)) % 50);
    if (state.attempts[key]?.done) return;
    recordAttempt(key, { done: true, tries: 1 });
    addXp(2, 'logic', 'RAG retrieval round');
    setState((s) => ({ ...s, activity: { ...s.activity, [today()]: (s.activity[today()] ?? 0) } }));
  }, [asked, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = () => {
    if (!q.trim()) { toast('Pehle ek sawaal likho.', 'warning'); return; }
    setAsked(true);
    recordAttempt(RAG_SLOT, { tries: passed + 1, done: true });
    if (!state.attempts[RAG_SLOT]?.done) toast('Retrieval chal gayi — neeche chunks dekho.', 'success');
  };

  return (
    <div>
      <div className="row spread" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1 className="row" style={{ gap: 10 }}><Network size={24} color="var(--cyan)" /> RAG LAB</h1>
          <p className="muted small" style={{ maxWidth: 720 }}>
            Retrieval-Augmented Generation ka poora pipeline — <b>offline</b>, browser me.
            Chunking → vectors → cosine ranking → extractive answer. Har number tumhare
            text se compute hota hai, kahin se hardcode nahi.
          </p>
        </div>
        <span className="chip">{chunks.length} chunks · {index.terms} terms</span>
      </div>

      <div className="grid2" style={{ gridTemplateColumns: '340px 1fr', alignItems: 'start', marginTop: 12 }}>
        {/* ---------- LEFT: pipeline controls ---------- */}
        <div className="card">
          <h3 className="row" style={{ gap: 8, margin: 0 }}><FileText size={16} color="var(--violet)" /> Corpus</h3>
          <p className="muted small">Document set chuno jo index hoga.</p>
          <select value={corpusKey} onChange={(e) => setCorpusKey(e.target.value)} style={{ width: '100%' }}>
            <option value="all">Poora curriculum ({sections.length} sections)</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{String(s.no).padStart(2, '0')} — {s.title}</option>
            ))}
          </select>

          <label className="small muted" style={{ display: 'block', marginTop: 12 }}>
            Apna document paste karo (optional — add ho jayega corpus me)
          </label>
          <textarea
            rows={5}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Yahan apna text paste karo…"
            style={{ width: '100%' }}
          />

          <div className="small row spread" style={{ marginTop: 12 }}><span>Chunk size</span><b>{size} words</b></div>
          <input type="range" min={20} max={140} step={5} value={size} onChange={(e) => setSize(Number(e.target.value))} style={{ width: '100%' }} aria-label="Chunk size" />

          <div className="small row spread" style={{ marginTop: 8 }}><span>Overlap</span><b>{Math.min(overlap, size - 1)} words</b></div>
          <input type="range" min={0} max={40} step={2} value={overlap} onChange={(e) => setOverlap(Number(e.target.value))} style={{ width: '100%' }} aria-label="Chunk overlap" />

          <div className="small row spread" style={{ marginTop: 8 }}><span>Top-K</span><b>{k}</b></div>
          <input type="range" min={1} max={8} step={1} value={k} onChange={(e) => setK(Number(e.target.value))} style={{ width: '100%' }} aria-label="Top K" />

          <div className="scoregrid" style={{ marginTop: 12 }}>
            <div className="scorecell"><span className="small muted">Chunks</span><b>{chunks.length}</b></div>
            <div className="scorecell"><span className="small muted">Avg tokens</span><b>{avgLen}</b></div>
            <div className="scorecell"><span className="small muted">Vector dim</span><b>256</b></div>
            <div className="scorecell"><span className="small muted">Runs</span><b>{passed}</b></div>
          </div>

          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={run}>
            <Play size={14} /> Retrieve karo
          </button>
          <button
            className="btn small ghost"
            style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
            onClick={() => { setQ(''); setAsked(false); setCustom(''); toast('Lab reset ho gaya.', 'info'); }}
          >
            <RotateCcw size={13} /> Reset
          </button>
        </div>

        {/* ---------- RIGHT: query + results ---------- */}
        <div>
          <div className="card">
            <h3 className="row" style={{ gap: 8, margin: 0 }}><Search size={16} color="var(--cyan)" /> Query</h3>
            <div className="assistant" style={{ marginTop: 10 }}>
              <div className="ask">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
                  placeholder="Curriculum se kuch bhi poocho…"
                  aria-label="RAG query"
                />
                <button className="btn primary" onClick={run}><Sparkles size={14} /> Ask</button>
              </div>
              <div className="quick">
                {SUGGESTED.map((s) => (
                  <button key={s} className="btn small ghost" onClick={() => { setQ(s); setAsked(true); }}>{s}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3 className="row" style={{ gap: 8, margin: 0 }}><Info size={16} color="var(--green)" /> Extracted answer</h3>
            {!asked && <p className="muted small">“Retrieve karo” dabao — answer sirf retrieved text se banega, koi generation nahi.</p>}
            {asked && !answer.text && (
              <div className="empty-state">
                <span className="big">🔍</span>
                <b>Koi matching sentence nahi mila</b>
                <span className="small">Query ke words corpus me nahi hain. Chunk size badhao ya doosra section chuno.</span>
              </div>
            )}
            {asked && answer.text && <div className="bubble" style={{ marginTop: 10 }}>{answer.text}</div>}
            {asked && answer.used.length > 0 && (
              <p className="muted small" style={{ marginTop: 8 }}>
                Answer {answer.used.length} retrieved chunk{answer.used.length > 1 ? 's' : ''} se bana hai — neeche highlight ho rakhe hain.
              </p>
            )}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3 className="row" style={{ gap: 8, margin: 0 }}>Retrieved chunks <span className="chip">{hits.length} / {chunks.length}</span></h3>
            {!asked && <p className="muted small">Chunking se cosine ranking tak — sab yahin dikhega.</p>}
            {asked && !hits.length && <p className="muted small">Is query ke liye koi chunk match nahi hua (saare scores 0 hain).</p>}
            <div style={{ marginTop: 8 }}>
              {hits.map((h, i) => {
                const isUsed = answer.used.includes(i);
                return (
                  <div key={h.id} className="tile" style={{ marginBottom: 8, alignItems: 'flex-start', borderColor: isUsed ? 'rgba(52,211,153,.55)' : undefined }}>
                    <span className="ic" style={{ color: 'var(--cyan)', fontSize: '.72rem', fontWeight: 700 }}>#{i + 1}</span>
                    <div className="t" style={{ minWidth: 0 }}>
                      <b>{h.source}</b>
                      <div className="small muted" style={{ fontFamily: 'var(--mono)', margin: '4px 0', whiteSpace: 'pre-wrap' }}>
                        {h.text.slice(0, 340)}{h.text.length > 340 ? '…' : ''}
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="chip">score {h.score.toFixed(3)}</span>
                        <span className="chip">{tokenize(h.text).length} tokens</span>
                        {isUsed && <span className="chip easy">used in answer</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3 className="row" style={{ gap: 8, margin: 0 }}>Pipeline — stage by stage</h3>
            <div className="timeline" style={{ marginTop: 10 }}>
              {[
                ['1. Ingest', `${docs.length} documents load hue — pick kiya gaya corpus + tumhara text.`],
                ['2. Chunk', `${chunks.length} chunks, ${size} words each with ${Math.min(overlap, size - 1)} word overlap.`],
                ['3. Embed', `Har chunk → 256-dim hashed TF-IDF vector (${index.terms} unique terms).`],
                ['4. Retrieve', `Query vector banaya, cosine similarity se top ${k} chunks rank kiye.`],
                ['5. Answer', answer.text ? 'Top chunks ki sentences ko query terms se match karke extract kiya.' : 'Koi query nahi — extract stage pending hai.'],
              ].map(([k2, v], i) => (
                <div key={k2} className={`tl-item ${asked ? 'on' : ''}`} style={{ opacity: !asked && i > 2 ? 0.5 : 1 }}>
                  <b className="small">{k2}</b>
                  <div className="small muted">{v}</div>
                </div>
              ))}
            </div>
            <p className="muted small" style={{ marginTop: 10 }}>
              Ye lexical retrieval hai — embeddings hashed bag-of-words hain, network se aaye hue model vectors nahi.
              Real systems me sentence-transformers use hote hain; yahan poora mechanism samajhne ke liye sab kuch visible rakha gaya hai.
            </p>
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <Link className="btn small" to="/ai">AI / GenAI Lab <ArrowRight size={12} /></Link>
              <Link className="btn small" to="/agentic">Agentic AI Lab <ArrowRight size={12} /></Link>
              <Link className="btn small" to="/questions">RAG ke questions practice karo <ArrowRight size={12} /></Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Stable small hash so a repeated question maps to the same attempt key. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
