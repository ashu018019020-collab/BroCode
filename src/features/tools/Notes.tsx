import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { StickyNote, Plus, Trash2, Star, Search, Save, Eye, Pencil, Tag, Download } from 'lucide-react';
import { useStore, upsertNote, deleteNote, toggleNoteFav, newNote, stateSnapshot } from '../../core/storage/store';
import { useCurriculum } from '../../core/data/curriculum';
import type { Note } from '../../types';
import { toast } from '../../components/ui/Toast';

/**
 * Markdown-lite renderer. It builds React nodes — never HTML strings — so
 * note content can never inject markup (no dangerouslySetInnerHTML anywhere).
 */
function renderMarkdown(src: string): ReactNode[] {
  const lines = src.split('\n');
  const out: ReactNode[] = [];
  // Held in an object so TypeScript doesn't over-narrow the mutable buffer.
  const buf: { code: string[] | null } = { code: null };

  const inline = (text: string, key: string): ReactNode[] => {
    const parts: ReactNode[] = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let last = 0; let m: RegExpExecArray | null; let i = 0;
    while ((m = re.exec(text))) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith('**')) parts.push(<b key={`${key}b${i}`}>{tok.slice(2, -2)}</b>);
      else parts.push(<code key={`${key}c${i}`} className="inline-code">{tok.slice(1, -1)}</code>);
      last = m.index + tok.length; i++;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };

  lines.forEach((raw, li) => {
    if (raw.trim().startsWith('```')) {
      if (buf.code) { out.push(<pre key={`p${li}`} className="codeblock">{buf.code.join('\n')}</pre>); buf.code = null; }
      else buf.code = [];
      return;
    }
    if (buf.code) { buf.code.push(raw); return; }
    const line = raw.trimEnd();
    if (!line.trim()) { out.push(<div key={`s${li}`} style={{ height: 6 }} />); return; }
    if (/^#{1,3}\s/.test(line)) {
      const level = (line.match(/^#+/) ?? ['#'])[0].length;
      out.push(<div key={`h${li}`} style={{ fontWeight: 700, fontSize: level === 1 ? '1.05rem' : level === 2 ? '.95rem' : '.88rem', margin: '6px 0 2px' }}>{inline(line.replace(/^#+\s/, ''), `h${li}`)}</div>);
      return;
    }
    if (/^[-*]\s/.test(line.trim())) {
      out.push(<div key={`l${li}`} className="row" style={{ gap: 6, alignItems: 'flex-start' }}><span>•</span><span>{inline(line.trim().slice(2), `l${li}`)}</span></div>);
      return;
    }
    out.push(<div key={`t${li}`}>{inline(line, `t${li}`)}</div>);
  });
  if (buf.code) out.push(<pre key="pend" className="codeblock">{buf.code.join('\n')}</pre>);
  return out;
}

interface NoteDraft { title: string; body: string; tags: string }

const draftOf = (note: Note | undefined): NoteDraft => ({
  title: note?.title ?? '',
  body: note?.body ?? '',
  tags: note?.tags.join(', ') ?? '',
});

/** "python, #sql," → ['python', 'sql'] — the same normalization every other note write used. */
const tagsOf = (text: string) => text.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);

const SAVE_DEBOUNCE_MS = 400;

/**
 * The editor's text, held locally and committed on a debounce.
 *
 * It used to call `upsertNote` on every keystroke, and `setState` serializes the WHOLE state —
 * notes, attempts, mistakes, ~1.18 MB at full bank use — and writes localStorage synchronously, so
 * every letter cost a full JSON pass. 400 ms of idle is the trade `useSavedAnswer` already makes;
 * the pending write is committed when the selection changes and when the page unmounts, so closing
 * a tab mid-sentence still keeps what was typed.
 */
function useNoteDraft(note: Note | undefined) {
  const noteId = note?.id ?? null;
  const [draft, setDraft] = useState<NoteDraft>(() => draftOf(note));
  const [saving, setSaving] = useState(false);
  const draftRef = useRef(draft);
  const scheduled = useRef<{ id: string; draft: NoteDraft } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  /**
   * Write the pending draft onto the note as it is stored NOW, not as it was when typing began —
   * so changing the linked lesson meanwhile is not undone by the save. Only the three text fields
   * travel: favourites and the lesson link are not the editor's to overwrite.
   */
  const flush = useCallback(() => {
    if (timer.current !== undefined) { window.clearTimeout(timer.current); timer.current = undefined; }
    const pending = scheduled.current;
    scheduled.current = null;
    if (!pending) return;
    const base = stateSnapshot().notes.find((n) => n.id === pending.id);
    if (!base) return; // the note was deleted — a flush must not resurrect it
    const tags = tagsOf(pending.draft.tags);
    const same = base.title === pending.draft.title
      && base.body === pending.draft.body
      && base.tags.length === tags.length && base.tags.every((t, i) => t === tags[i]);
    if (same) return;
    upsertNote({ ...base, title: pending.draft.title, body: pending.draft.body, tags });
  }, []);

  // A new selection is a new document: commit the old one, then load the new one's stored text.
  useEffect(() => {
    flush();
    setSaving(false);
    const next = draftOf(stateSnapshot().notes.find((n) => n.id === noteId));
    draftRef.current = next;
    setDraft(next);
    // Keyed on the id alone: re-running on every store change would replace text still being typed
    // with the last saved value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, flush]);

  useEffect(() => () => flush(), [flush]);

  const edit = useCallback((p: Partial<NoteDraft>) => {
    if (!noteId) return;
    const next = { ...draftRef.current, ...p };
    draftRef.current = next;
    setDraft(next);
    setSaving(true);
    scheduled.current = { id: noteId, draft: next };
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { flush(); setSaving(false); }, SAVE_DEBOUNCE_MS);
  }, [noteId, flush]);

  return { draft, saving, edit, flush };
}

export default function NotesPage() {
  const state = useStore();
  const { sections } = useCurriculum();
  const [sel, setSel] = useState<string | null>(state.notes[0]?.id ?? null);
  const [q, setQ] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [favOnly, setFavOnly] = useState(false);
  const [preview, setPreview] = useState(false);

  const current: Note | undefined = state.notes.find((n) => n.id === sel);
  const { draft, saving, edit, flush } = useNoteDraft(current);
  const allTags = useMemo(() => [...new Set(state.notes.flatMap((n) => n.tags))].sort(), [state.notes]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return state.notes
      .filter((n) => (favOnly ? n.fav : true))
      .filter((n) => (tagFilter ? n.tags.includes(tagFilter) : true))
      .filter((n) => !needle || `${n.title} ${n.body} ${n.tags.join(' ')}`.toLowerCase().includes(needle))
      .sort((a, b) => b.updated - a.updated);
  }, [state.notes, q, tagFilter, favOnly]);

  const create = (sectionId?: string) => {
    const n = newNote({ title: '', body: '', tags: sectionId ? [sectionId] : [], section: sectionId });
    upsertNote(n);
    setSel(n.id);
    setPreview(false);
    toast('New note created — start writing.', 'success', 1800);
  };

  const patch = (p: Partial<Note>) => {
    if (!current) return;
    upsertNote({ ...current, ...p });
  };

  /**
   * Delete, then move on to the next visible note. Clearing the selection left the editor empty
   * even when the learner still had notes left.
   */
  const remove = () => {
    if (!current) return;
    const next = list.find((n) => n.id !== current.id) ?? state.notes.find((n) => n.id !== current.id);
    deleteNote(current.id);
    setSel(next?.id ?? null);
    setPreview(false);
    toast('Note deleted.', 'info');
  };

  const exportAll = () => {
    flush(); // an export must include text typed in the last debounce window
    const md = stateSnapshot().notes.map((n) => `# ${n.title || 'Untitled'}\n\n${n.tags.map((t) => `#${t}`).join(' ')}\n\n${n.body}\n`).join('\n---\n\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ai-master-lab-notes.md';
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`Exported ${state.notes.length} note${state.notes.length === 1 ? '' : 's'}.`, 'success');
  };

  return (
    <div>
      <div className="row spread" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1 className="row" style={{ gap: 10 }}><StickyNote size={24} color="var(--amber)" /> NOTES</h1>
          <p className="muted small">Concept notes, debugging lessons and interview lines — all here, all on your device.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="chip">{state.notes.length} notes</span>
          <span className="chip">{allTags.length} tags</span>
          <button className="btn small" onClick={exportAll} disabled={!state.notes.length}><Download size={13} /> Markdown export</button>
          <button className="btn small primary" onClick={() => create()}><Plus size={13} /> New note</button>
        </div>
      </div>

      <div className="path-grid" style={{ marginTop: 14, gridTemplateColumns: '320px 1fr' }}>
        {/* list */}
        <div className="path-rail">
          <div className="card">
            <div className="searchbox" style={{ cursor: 'text', maxWidth: 'none' }}>
              <Search size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes…" style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, color: 'inherit' }} />
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <button className={`tabbtn ${favOnly ? 'active' : ''}`} onClick={() => setFavOnly((v) => !v)}><Star size={11} /> Favourites</button>
              {tagFilter && <button className="tabbtn active" onClick={() => setTagFilter(null)}>#{tagFilter} ✕</button>}
            </div>
            {allTags.length > 0 && (
              <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                {allTags.slice(0, 14).map((t) => (
                  <button key={t} className={`tabbtn ${tagFilter === t ? 'active' : ''}`} onClick={() => setTagFilter(tagFilter === t ? null : t)}>#{t}</button>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginTop: 10 }}>
            {!list.length && (
              <div className="empty-state">
                <span className="big">📝</span>
                <b>{state.notes.length ? 'No note matches the filter' : 'No notes yet'}</b>
                <span className="small">Create your first note — rewriting what you learned in your own words is the best revision.</span>
                <button className="btn small primary" onClick={() => create()}><Plus size={12} /> New note</button>
              </div>
            )}
            {list.map((n) => (
              <button
                key={n.id}
                className={`card ${sel === n.id ? 'wb-active' : ''}`}
                style={{ width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: 8, padding: 12 }}
                onClick={() => setSel(n.id)}
              >
                <div className="row spread" style={{ gap: 6 }}>
                  <b className="small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title || '(untitled note)'}</b>
                  {n.fav && <Star size={12} color="var(--amber)" fill="currentColor" />}
                </div>
                <div className="small muted" style={{ margin: '4px 0' }}>{n.body.slice(0, 70) || 'Empty note'}{n.body.length > 70 ? '…' : ''}</div>
                <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                  {n.tags.slice(0, 3).map((t) => <span key={t} className="chip">#{t}</span>)}
                  <span className="chip">{new Date(n.updated).toLocaleDateString()}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* editor */}
        <div>
          {!current ? (
            <div className="card empty-state">
              <span className="big">✍️</span>
              <b>Select a note or create a new one</b>
              <span className="small">Markdown is supported: # heading, **bold**, `code`, ```code block```.</span>
            </div>
          ) : (
            <div className="card">
              <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input
                  value={draft.title}
                  onChange={(e) => edit({ title: e.target.value })}
                  placeholder="Note title…"
                  style={{ flex: 1, minWidth: 200, fontSize: '1rem', fontWeight: 650 }}
                  aria-label="Note title"
                />
                <div className="row" style={{ gap: 6 }}>
                  <button className={`btn small ${preview ? '' : 'primary'}`} onClick={() => setPreview(false)}><Pencil size={12} /> Edit</button>
                  <button className={`btn small ${preview ? 'primary' : ''}`} onClick={() => setPreview(true)}><Eye size={12} /> Preview</button>
                  <button className={`btn small ${current.fav ? 'primary' : ''}`} onClick={() => toggleNoteFav(current.id)} aria-pressed={current.fav}>
                    <Star size={12} /> {current.fav ? 'Favourite' : 'Add to favourites'}
                  </button>
                  <button className="btn small danger" onClick={remove}><Trash2 size={12} /> Delete</button>
                </div>
              </div>

              <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <span className="row small muted" style={{ gap: 5 }}><Tag size={12} /> Tags (comma-separated)</span>
                <input
                  value={draft.tags}
                  onChange={(e) => edit({ tags: e.target.value })}
                  placeholder="python, functions, interview"
                  style={{ flex: 1, minWidth: 180 }}
                  aria-label="Note tags"
                />
                <select
                  value={current.section ?? ''}
                  onChange={(e) => patch({ section: e.target.value || undefined })}
                  aria-label="Link to a lesson"
                >
                  <option value="">Not linked to a lesson</option>
                  {sections.map((s) => <option key={s.id} value={s.id}>{String(s.no).padStart(2, '0')} — {s.title}</option>)}
                </select>
                {current.section && <Link className="btn small" to={`/lesson/${current.section}/learn`}>Open lesson →</Link>}
              </div>

              {preview ? (
                <div className="bubble" style={{ marginTop: 12, minHeight: 220 }}>{renderMarkdown(current.body)}</div>
              ) : (
                <textarea
                  rows={16}
                  value={draft.body}
                  onChange={(e) => edit({ body: e.target.value })}
                  placeholder={'# Key idea\n- first point\n- second point\n\n```python\nprint("example")\n```'}
                  style={{ width: '100%', marginTop: 12, fontFamily: 'var(--mono)', fontSize: '.84rem' }}
                  aria-label="Note body"
                />
              )}

              <div className="row spread small muted" style={{ marginTop: 8 }}>
                <span role="status"><Save size={12} /> {saving ? 'Saving…' : 'Saved on this device — writes a moment after you stop typing.'}</span>
                <span>{draft.body.split(/\s+/).filter(Boolean).length} words</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
