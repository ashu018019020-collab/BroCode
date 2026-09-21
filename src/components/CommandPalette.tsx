import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchItems, type SearchItem } from '../engine/search';

export function CommandPalette({ items, onClose }: { items: SearchItem[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchItems(items, q), [items, q]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSel(0); }, [q]);

  const go = (it: SearchItem) => { nav(it.route); onClose(); };

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
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === 'Enter' && results[sel]) go(results[sel]);
          }}
        />
        <div className="results">
          {!q && <div className="muted small" style={{ padding: 10 }}>Type to search the full curriculum: concepts, interview Q&A, coding tasks, logic cards, projects, mock questions.</div>}
          {results.map((r, i) => (
            <div key={r.id} className={`result ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
              <span className="kind">{r.kind}</span>
              <span style={{ flex: 1 }}>
                <b className="small">{r.title}</b>
                <div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.detail}</div>
              </span>
              {r.page && <span className="chip">p.{r.page}</span>}
            </div>
          ))}
          {q && !results.length && <div className="muted small" style={{ padding: 10 }}>No results for “{q}”.</div>}
        </div>
      </div>
    </div>
  );
}
