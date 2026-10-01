import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchItems, type SearchItem } from '../../core/platform/search';
import { detailFor, kindOf, routeFor, searchBankIndex, type BankIndex } from '../../core/platform/searchindex';

/** How many deep bank hits share the list with the curriculum results. */
const BANK_LIMIT = 12;

export function CommandPalette({
  items, onClose, bank = null, bankLoading = false,
}: {
  items: SearchItem[];
  onClose: () => void;
  /** The question index, or null while it loads / when it is unavailable. */
  bank?: BankIndex | null;
  bankLoading?: boolean;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchItems(items, q), [items, q]);
  // Every bank question, ranked by the tested engine module. This is the part the palette could
  // never do: the curriculum holds ~2,000 authored items, while the banks hold 13,865 — including
  // every Playbook V15 question — and none of them were reachable from search before.
  const bankHits = useMemo(() => (bank ? searchBankIndex(bank, q, BANK_LIMIT) : []), [bank, q]);

  /** The merged list the keyboard walks: curriculum first (it is what the learner was browsing),
   *  then the deep bank hits, which carry their own route. */
  const rows = useMemo(
    () => [
      ...results.map((r) => ({ key: r.id, kind: r.kind, title: r.title, detail: r.detail, chip: r.page ? `p.${r.page}` : '', go: r.route })),
      ...bankHits.map(({ row }) => ({
        key: `bk:${row.id}`,
        kind: kindOf(row),
        title: row.text,
        detail: detailFor(bank as BankIndex, row),
        chip: 'Bank',
        go: routeFor(row),
      })),
    ],
    [results, bankHits, bank],
  );

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSel(0); }, [q]);

  const go = (route: string) => { nav(route); onClose(); };

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          value={q}
          placeholder="Search concepts, questions, code, projects…  (Esc to close)"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, rows.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === 'Enter' && rows[sel]) go(rows[sel].go);
          }}
        />
        <div className="results">
          {!q && (
            <div className="muted small" style={{ padding: 10 }}>
              Type to search the full curriculum: concepts, interview Q&A, coding tasks, logic cards, projects, mock questions
              {bank && <> — plus all <b>{bank.counts.items}</b> question-bank items, Playbook V15 included.</>}.
            </div>
          )}
          {rows.map((r, i) => (
            <div key={r.key} className={`result ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => go(r.go)}>
              <span className="kind">{r.kind}</span>
              <span style={{ flex: 1 }}>
                <b className="small">{r.title}</b>
                <div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.detail}</div>
              </span>
              {r.chip && <span className="chip">{r.chip}</span>}
            </div>
          ))}
          {/* "No results" and "still loading the index" are different facts: the first is a verdict,
              the second is a wait, and telling them apart is why the empty state is split in two. */}
          {q && !rows.length && !bankLoading && <div className="muted small" style={{ padding: 10 }}>No results for “{q}”.</div>}
          {q && !rows.length && bankLoading && <div className="muted small" style={{ padding: 10 }}>Curriculum me kuch nahi mila — poora question bank load ho raha hai…</div>}
          {q && rows.length > 0 && bankLoading && (
            <div className="muted small" style={{ padding: '4px 10px' }}>Question bank ke 13,865 items index ho rahe hain…</div>
          )}
          {q && rows.length > 0 && !bankLoading && (
            <div className="muted small" style={{ padding: '4px 10px' }}>
              {results.length} curriculum hit(s)
              {bank ? <> · {bankHits.length} of {bank.counts.items} bank questions (Playbook V15 ke saare items included)</> : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
