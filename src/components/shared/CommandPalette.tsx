import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { quickPages, searchItems, type SearchItem } from '../../core/platform/search';
import { detailFor, kindOf, routeFor, searchBankIndex, type BankIndex } from '../../core/platform/searchindex';

/** How many deep bank hits share the list with the curriculum results. */
const BANK_LIMIT = 12;

/**
 * The Ctrl+K palette: a launcher with nothing typed, a search once something is.
 *
 * Accessibility contract (the palette is the one surface a keyboard user opens BY keyboard):
 *   · combobox + listbox, so a screen reader hears the highlighted row and how many rows there are
 *     (`aria-activedescendant` follows the arrow keys, `aria-selected` marks the row);
 *   · the highlighted row is scrolled into view — arrowing past the fold used to move an invisible
 *     cursor through a list the learner could not see;
 *   · Tab cannot leave the dialog (it is one input; the rows are not tab stops), and closing it
 *     returns focus to whatever opened it;
 *   · a FAILED index load is reported as a failure, never as an endless "loading".
 */
export function CommandPalette({
  items, onClose, bank = null, bankLoading = false, bankFailed = false,
}: {
  items: SearchItem[];
  onClose: () => void;
  /** The question index, or null while it loads / when it is unavailable. */
  bank?: BankIndex | null;
  bankLoading?: boolean;
  /** The index request finished WITHOUT an index: a failed load is not a slow one. */
  bankFailed?: boolean;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => searchItems(items, q), [items, q]);
  // Every bank question, ranked by the tested engine module. This is the part the palette could
  // never do: the curriculum holds ~2,000 authored items, while the banks hold 13,865 — including
  // every Playbook V15 question — and none of them were reachable from search before.
  const bankHits = useMemo(() => (bank ? searchBankIndex(bank, q, BANK_LIMIT) : []), [bank, q]);

  /** The merged list the keyboard walks: curriculum first (it is what the learner was browsing),
   *  then the deep bank hits, which carry their own route. */
  const rows = useMemo(
    () => {
      // With nothing typed the palette is a LAUNCHER: it opens on the rail's own seven destinations,
      // in the rail's order and with the rail's names. A query takes the list over entirely, because
      // then the learner is searching rather than choosing a door.
      if (!q.trim()) {
        return quickPages().map((page) => ({
          key: page.id, kind: 'Page' as const, title: page.title, detail: page.detail, chip: '', go: page.route,
        }));
      }
      return [
        ...results.map((r) => ({ key: r.id, kind: r.kind, title: r.title, detail: r.detail, chip: r.page ? `p.${r.page}` : '', go: r.route })),
        ...bankHits.map(({ row }) => ({
          key: `bk:${row.id}`,
          kind: kindOf(row),
          title: row.text,
          detail: detailFor(bank as BankIndex, row),
          chip: 'Bank',
          go: routeFor(row),
        })),
      ];
    },
    [q, results, bankHits, bank],
  );

  /**
   * Focus goes back where it came from — the search capsule in the header, or the rail's keyboard
   * shortcut path — instead of being dropped on `<body>` when the dialog unmounts.
   */
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { opener?.focus?.(); };
  }, []);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSel(0); }, [q]);

  /**
   * Keep the highlighted row on screen. The list is taller than the panel once a broad query is
   * typed, so without this the arrow keys move a selection nobody can see.
   */
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${sel}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [sel, rows.length]);

  const go = (route: string) => { nav(route); onClose(); };
  const activeId = rows[sel] ? `palette-opt-${sel}` : undefined;

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="modal palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={(e) => {
          // One focusable control lives in here (the input); the rows are options, not tab stops.
          // Tab therefore has nowhere legitimate to go, and letting it escape into the page behind
          // an `aria-modal` dialog is the trap this prevents.
          if (e.key === 'Tab') { e.preventDefault(); inputRef.current?.focus(); }
        }}
      >
        <input
          ref={inputRef}
          value={q}
          placeholder="Search concepts, questions, code, projects…  (Esc to close)"
          role="combobox"
          aria-expanded
          aria-controls="palette-results"
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label="Search the curriculum and question banks"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (rows.length ? Math.min(s + 1, rows.length - 1) : 0)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === 'Enter' && rows[sel]) go(rows[sel].go);
          }}
        />
        <div className="results" ref={listRef} id="palette-results" role="listbox" aria-label="Results">
          {!q && (
            <div className="muted small" style={{ padding: 10 }}>
              Type to search the full curriculum: concepts, interview Q&A, coding tasks, logic cards, projects, mock questions
              {bank && <> — plus all <b>{bank.counts.items}</b> question-bank items, Playbook V15 included.</>}.
            </div>
          )}
          {rows.map((r, i) => (
            <div
              key={r.key}
              id={`palette-opt-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === sel}
              className={`result ${i === sel ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => go(r.go)}
            >
              <span className="kind">{r.kind}</span>
              <span style={{ flex: 1 }}>
                <b className="small">{r.title}</b>
                <div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.detail}</div>
              </span>
              {r.chip && <span className="chip">{r.chip}</span>}
            </div>
          ))}
        </div>
        {/* Status lines live OUTSIDE the listbox: a listbox may contain only options, and a screen
            reader must hear these as status, not as rows it can select. */}
        <div role="status" aria-live="polite">
          {/* "No results" and "still loading the index" are different facts: the first is a verdict,
              the second is a wait, and telling them apart is why the empty state is split in two. */}
          {q && !rows.length && !bankLoading && <div className="muted small" style={{ padding: 10 }}>No results for “{q}”.</div>}
          {q && !rows.length && bankLoading && <div className="muted small" style={{ padding: 10 }}>Nothing found in the curriculum — loading the full question bank…</div>}
          {q && bankFailed && (
            <div className="muted small" style={{ padding: '0 10px 10px' }}>
              The question-bank index could not be loaded this time, so only the curriculum was searched.
              It is requested again the next time the palette opens.
            </div>
          )}
          {q && rows.length > 0 && bankLoading && (
            <div className="muted small" style={{ padding: '4px 10px' }}>Indexing 13,865 question-bank items…</div>
          )}
          {q && rows.length > 0 && !bankLoading && !bankFailed && (
            <div className="muted small" style={{ padding: '4px 10px' }}>
              {results.length} curriculum hit(s)
              {bank ? <> · {bankHits.length} of {bank.counts.items} bank questions (all Playbook V15 items included)</> : ''}
            </div>
          )}
          {q && rows.length > 0 && !bankLoading && bankFailed && (
            <div className="muted small" style={{ padding: '4px 10px' }}>
              {results.length} curriculum hit(s) · the question-bank index was unavailable, so its items are not included.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
