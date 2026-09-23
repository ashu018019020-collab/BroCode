import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks, Search, ExternalLink, RefreshCw, Database } from 'lucide-react';
import {
  useBankManifest, useBank, filterQuestions, countByField,
  TYPE_LABEL, TYPE_STAGE, QUESTION_TYPES, DIFFICULTIES,
  type BankFilter,
} from '../data/questions';
import type { QuestionRecord, QuestionType, Difficulty } from '../data/schema';

const EMPTY_FILTER: BankFilter = { type: 'all', difficulty: 'all', search: '', includeDrafts: false };
const PAGE_SIZE = 25;

/**
 * Question Bank — browses the local content pack (public/questions/*.json).
 * Read-only by design: nothing here writes progress, awards XP or fakes a score.
 */
export default function QuestionBank() {
  const manifest = useBankManifest();
  const [selected, setSelected] = useState<string | null>(null);
  const [sectionSearch, setSectionSearch] = useState('');
  const [filter, setFilter] = useState<BankFilter>(EMPTY_FILTER);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState(PAGE_SIZE);

  // Default to the first bank once the manifest arrives.
  useEffect(() => {
    if (manifest && !selected && manifest.sections.length) setSelected(manifest.sections[0].sectionId);
  }, [manifest, selected]);

  const bank = useBank(selected ?? undefined);

  // New section → reset the view state so filters never look stale.
  useEffect(() => {
    setFilter(EMPTY_FILTER);
    setRevealed({});
    setShown(PAGE_SIZE);
  }, [selected]);

  const sectionList = useMemo(() => {
    if (!manifest) return [];
    const needle = sectionSearch.trim().toLowerCase();
    return needle
      ? manifest.sections.filter((s) => `${s.no} ${s.title}`.toLowerCase().includes(needle))
      : manifest.sections;
  }, [manifest, sectionSearch]);

  const entry = manifest?.sections.find((s) => s.sectionId === selected) ?? null;
  const rows = useMemo(() => (bank ? filterQuestions(bank.questions, filter) : []), [bank, filter]);
  const hasDrafts = useMemo(() => (bank ? bank.questions.some((q) => q.status !== 'PUBLISHED') : false), [bank]);
  const typeCounts = useMemo(() => (bank ? countByField(bank.questions, 'type') : {}), [bank]);
  const touched = Object.keys(revealed).length;

  if (!manifest) {
    return (
      <div>
        <h1 className="row" style={{ gap: 10 }}><ListChecks size={22} /> Question Bank</h1>
        <div className="card">
          <p className="muted small">Content pack load ho raha hai…</p>
          <p className="muted small">
            Agar banks missing hain to pipeline chalao: <code>npm run questions:seed</code> — phir
            <code> npm run questions:validate</code>.
          </p>
        </div>
      </div>
    );
  }

  const baseline = manifest.baseline * manifest.sections.length;

  return (
    <div>
      <h1 className="row" style={{ gap: 10 }}><Database size={22} /> Question Bank</h1>
      <p className="muted small">
        Local content pack — <b>{manifest.published}</b> published questions across{' '}
        <b>{manifest.sections.length}</b> sections. Sab kuch offline hai; answers reveal karke self-check karo.
      </p>

      <div className="stat-row">
        <div className="stat-card">
          <div className="ic"><Database size={18} /></div>
          <div><div className="n">{manifest.published}</div><div className="l">published questions</div></div>
        </div>
        <div className="stat-card">
          <div className="ic"><ListChecks size={18} /></div>
          <div><div className="n">{manifest.sections.length}</div><div className="l">sections with a bank</div></div>
        </div>
        <div className="stat-card">
          <div className="ic"><RefreshCw size={18} /></div>
          <div>
            <div className="n">{Math.round((manifest.published / baseline) * 100)}%</div>
            <div className="l">of {baseline} baseline target</div>
          </div>
        </div>
      </div>

      <p className="muted small" style={{ marginTop: -4 }}>
        Baseline {manifest.baseline}/section PDF ke hisaab se hai — jo sections kam hain unme honestly
        <i> CONTENT_INCOMPLETE</i> flag laga hai, aur wahi gaps authoring ke liye listed hain.
      </p>

      <div className="path-grid" style={{ marginTop: 12 }}>
        {/* LEFT: section index */}
        <div className="card">
          <div className="row spread">
            <h3 className="row" style={{ gap: 8, margin: 0 }}><ListChecks size={16} /> Sections</h3>
            <span className="small muted">{sectionList.length}</span>
          </div>
          <div className="row" style={{ margin: '10px 0', border: '1px solid var(--border)', borderRadius: 10, padding: '2px 8px', background: 'rgba(0,0,0,.3)' }}>
            <Search size={14} />
            <input
              value={sectionSearch}
              onChange={(e) => setSectionSearch(e.target.value)}
              placeholder="Section dhoondo…"
              aria-label="Search sections"
              style={{ border: 'none', background: 'transparent', flex: 1, padding: '6px 4px', minWidth: 0 }}
            />
          </div>
          <div>
            {sectionList.map((s) => {
              const incomplete = s.flags.includes('CONTENT_INCOMPLETE');
              const pct = Math.min(100, Math.round((s.published / manifest.baseline) * 100));
              return (
                <button
                  key={s.sectionId}
                  className={`file-row ${s.sectionId === selected ? 'on' : ''}`}
                  onClick={() => setSelected(s.sectionId)}
                  style={{ width: '100%', textAlign: 'left', background: s.sectionId === selected ? undefined : 'transparent' }}
                >
                  <span className="mono small muted" style={{ flex: 'none' }}>{String(s.no).padStart(2, '0')}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                  <span className={`chip ${incomplete ? 'medium' : 'easy'}`} title={incomplete ? 'CONTENT_INCOMPLETE — baseline not authored yet' : 'complete'}>
                    {pct}%
                  </span>
                </button>
              );
            })}
            {!sectionList.length && <p className="muted small">“{sectionSearch}” se koi section match nahi hua.</p>}
          </div>
        </div>

        {/* RIGHT: questions */}
        <div className="card">
          {!entry ? (
            <p className="muted small">Left list se ek section choose karo.</p>
          ) : (
            <>
              <div className="row spread">
                <h3 style={{ margin: 0 }}>{String(entry.no).padStart(2, '0')} · {entry.title}</h3>
                <span className={`chip ${entry.flags.includes('CONTENT_INCOMPLETE') ? 'medium' : 'easy'}`}>
                  {entry.published}/{manifest.baseline} target
                </span>
              </div>
              <p className="muted small" style={{ marginTop: 4 }}>
                {bank ? `${bank.questions.length} questions in this bank` : 'loading bank…'}
                {touched > 0 && ` · ${touched} answer${touched === 1 ? '' : 's'} revealed`}
              </p>

              {/* type filter */}
              <div className="lang-toggle" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                <button className={filter.type === 'all' ? 'on' : ''} onClick={() => { setFilter((f) => ({ ...f, type: 'all' })); setShown(PAGE_SIZE); }}>
                  All {bank ? `(${bank.questions.length})` : ''}
                </button>
                {QUESTION_TYPES.filter((t) => (typeCounts[t] ?? 0) > 0).map((t) => (
                  <button
                    key={t}
                    className={filter.type === t ? 'on' : ''}
                    onClick={() => { setFilter((f) => ({ ...f, type: t })); setShown(PAGE_SIZE); }}
                  >
                    {TYPE_LABEL[t]} ({typeCounts[t]})
                  </button>
                ))}
              </div>

              {/* difficulty / search / drafts */}
              <div className="row" style={{ marginTop: 8 }}>
                <select
                  value={filter.difficulty}
                  aria-label="Filter by difficulty"
                  onChange={(e) => { setFilter((f) => ({ ...f, difficulty: e.target.value as Difficulty | 'all' })); setShown(PAGE_SIZE); }}
                >
                  <option value="all">Any difficulty</option>
                  {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <div className="row" style={{ flex: 1, minWidth: 160, border: '1px solid var(--border)', borderRadius: 10, padding: '2px 8px', background: 'rgba(0,0,0,.3)' }}>
                  <Search size={14} />
                  <input
                    value={filter.search}
                    onChange={(e) => { setFilter((f) => ({ ...f, search: e.target.value })); setShown(PAGE_SIZE); }}
                    placeholder="Question me dhoondo…"
                    aria-label="Search questions"
                    style={{ border: 'none', background: 'transparent', flex: 1, padding: '6px 4px', minWidth: 0 }}
                  />
                </div>
                {hasDrafts && (
                  <label className="small row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={filter.includeDrafts}
                      onChange={(e) => setFilter((f) => ({ ...f, includeDrafts: e.target.checked }))}
                    />
                    drafts dikhao
                  </label>
                )}
                <button className="btn small" onClick={() => setRevealed({})}>Reset reveals</button>
              </div>

              <div style={{ marginTop: 10 }}>
                {rows.slice(0, shown).map((q) => (
                  <QuestionCard
                    key={q.id}
                    q={q}
                    open={!!revealed[q.id]}
                    onToggle={() => setRevealed((r) => ({ ...r, [q.id]: !r[q.id] }))}
                  />
                ))}
                {!rows.length && <p className="muted small">Is filter me koi question nahi mila — filter badlo.</p>}
              </div>

              {rows.length > shown && (
                <button className="btn small" style={{ marginTop: 8 }} onClick={() => setShown((n) => n + PAGE_SIZE)}>
                  Aur dikhao ({rows.length - shown} baaki)
                </button>
              )}
              <p className="muted small" style={{ marginTop: 8 }}>
                {rows.length} of {bank?.questions.length ?? 0} match{rows.length === 1 ? '' : 'es'} · answer khud check karo, koi score store nahi hota.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionCard({ q, open, onToggle }: { q: QuestionRecord; open: boolean; onToggle: () => void }) {
  return (
    <div className="card" style={{ margin: '0 0 8px', padding: '10px 12px' }}>
      <div className="row spread" style={{ gap: 8 }}>
        <span className="row" style={{ gap: 6 }}>
          <span className={`chip ${q.type}`}>{TYPE_LABEL[q.type as QuestionType] ?? q.type}</span>
          <span className={`chip ${q.difficulty}`}>{q.difficulty}</span>
          {q.status !== 'PUBLISHED' && <span className="chip medium">{q.status}</span>}
          {(q.tags ?? []).slice(0, 2).map((t) => <span key={t} className="chip">{t}</span>)}
        </span>
        <span className="row" style={{ gap: 6 }}>
          <Link className="btn small" to={`/lesson/${q.sectionId}/${TYPE_STAGE[q.type]}`}>
            <ExternalLink size={12} /> Practice
          </Link>
          <button className="btn small primary" onClick={onToggle}>{open ? 'Answer chhupao' : 'Answer dekho'}</button>
        </span>
      </div>
      <p style={{ margin: '8px 0 0' }} className="small">{q.question}</p>
      {open && (
        <div style={{ marginTop: 8 }}>
          <pre className="codeblock" style={{ fontSize: '.78rem' }}>{q.answer || '(no answer)'}</pre>
          {q.explanation && <p className="small muted" style={{ marginTop: 6 }}><b>Kyun:</b> {q.explanation}</p>}
          <p className="small muted" style={{ marginTop: 4 }}>
            source: {q.source}
            {q.verifiedAt ? ` · verified ${q.verifiedAt.slice(0, 10)}` : ''} · id: <span className="mono">{q.id}</span>
          </p>
        </div>
      )}
    </div>
  );
}
