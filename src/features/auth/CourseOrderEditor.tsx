import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, RotateCcw, Save } from 'lucide-react';
import { useCourseIndex } from '../../core/data/courses';
import {
  clearPlacementOverrides, loadPlacementOverrides, savePlacementOverrides,
} from '../../core/data/course-placement';
import {
  COURSE_LEVELS, groupByLevel, mergePlacements, type CoursePlacement,
} from '../../core/learning/course-levels';

/**
 * The owner's course-journey editor.
 *
 * Rendered only inside the owner dashboard, which already refuses a non-admin: this component is
 * not a second guard, and the DATABASE is the real gate — the `course_placement` policies accept a
 * write only from a JWT whose app_metadata carries `brocode_role = admin`. The browser never holds
 * a service key.
 *
 * The page itself does not depend on this editor working: no rows, no table, no network or a
 * non-admin visitor all fall back to the code-authored order. "Save" writes every placement, so a
 * course cannot be left half-moved; "Use built-in order" deletes the override rows.
 */
export default function CourseOrderEditor() {
  const index = useCourseIndex();
  const [draft, setDraft] = useState<CoursePlacement[]>(() => mergePlacements([]));
  const [source, setSource] = useState<'built-in' | 'database'>('built-in');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const names = useMemo<Record<string, string>>(() => Object.fromEntries([
    ...(index?.courses ?? []).map((c) => [c.slug, c.name] as const),
    ['c-programming', 'C Programming'] as const,
  ]), [index]);

  const reload = useCallback(async () => {
    setBusy(true);
    const rows = await loadPlacementOverrides();
    setDraft(mergePlacements(rows ?? []));
    setSource(rows && rows.length > 0 ? 'database' : 'built-in');
    setNote(rows === null
      ? 'The course_placement table is not reachable yet — the page keeps the built-in order. Deploy the migration to enable overrides.'
      : '');
    setBusy(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  /** Move inside its level; orders are renumbered 1..n so the database never holds gaps. */
  const move = (slug: string, dir: -1 | 1) => setDraft((prev) => {
    const next = prev.map((p) => ({ ...p }));
    const item = next.find((p) => p.slug === slug);
    if (!item) return prev;
    const peers = next.filter((p) => p.level === item.level).sort((a, b) => a.order - b.order);
    const at = peers.findIndex((p) => p.slug === slug);
    const target = at + dir;
    if (target < 0 || target >= peers.length) return prev;
    [peers[at], peers[target]] = [peers[target], peers[at]];
    peers.forEach((p, i) => { p.order = i + 1; });
    return next;
  });

  /** Change level: appended to the end of the new level, old level renumbered. */
  const place = (slug: string, level: CoursePlacement['level']) => setDraft((prev) => {
    const next = prev.map((p) => ({ ...p }));
    const item = next.find((p) => p.slug === slug);
    if (!item || item.level === level) return prev;
    const oldPeers = next.filter((p) => p.level === item.level && p.slug !== slug).sort((a, b) => a.order - b.order);
    const newPeers = next.filter((p) => p.level === level).sort((a, b) => a.order - b.order);
    item.level = level;
    item.order = newPeers.length + 1;
    oldPeers.forEach((p, i) => { p.order = i + 1; });
    newPeers.forEach((p, i) => { p.order = i + 1; });
    return next;
  });

  const toggleOptional = (slug: string) => setDraft((prev) =>
    prev.map((p) => (p.slug === slug ? { ...p, optional: !p.optional } : p)));

  const save = async () => {
    setBusy(true);
    const error = await savePlacementOverrides(draft.map(({ slug, level, order, optional }) => ({ slug, level, order, optional })));
    setBusy(false);
    if (error) { setNote(error); return; }
    setSource('database');
    setNote('Saved. Every learner now reads this journey.');
  };

  const reset = async () => {
    setBusy(true);
    const error = await clearPlacementOverrides();
    setBusy(false);
    if (error) { setNote(error); return; }
    await reload();
    setNote('Overrides cleared — back to the built-in journey.');
  };

  const groups = groupByLevel(draft, draft);

  return (
    <div className="card owner-course-editor">
      <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Course journey</h2>
          <p className="muted small" style={{ margin: '4px 0 0', maxWidth: 620 }}>
            Move a course between levels, or up and down inside one. Students only read this;
            saving writes it to the database, and the page falls back to the built-in journey if the
            table is empty or unreachable. Currently: <b>{source === 'database' ? 'your saved order' : 'built-in order'}</b>.
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn small" type="button" onClick={() => void reload()} disabled={busy}>
            <RotateCcw size={12} /> Reload
          </button>
          <button className="btn small" type="button" onClick={() => void reset()} disabled={busy}>
            Use built-in order
          </button>
          <button className="btn small primary" type="button" onClick={() => void save()} disabled={busy}>
            <Save size={12} /> Save order
          </button>
        </div>
      </div>
      {note && <p className="small" role="status" style={{ margin: '8px 0 0' }}>{note}</p>}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
        {COURSE_LEVELS.map((level) => (
          <span key={level.id} className="chip small">
            {String(level.no).padStart(2, '0')} {level.title} · {draft.filter((p) => p.level === level.id).length}
          </span>
        ))}
      </div>
      <div className="oce-levels">
        {groups.map(({ level, cards: rows }) => (
          <section key={level.id} className="oce-level">
            <h3>Level {String(level.no).padStart(2, '0')} · {level.title}</h3>
            {rows.map((row, i) => (
              <div className="oce-row" key={row.slug}>
                <span className="oce-name">
                  <b>{names[row.slug] ?? row.slug}</b>
                  {row.optional && <span className="chip small">optional</span>}
                </span>
                <select
                  aria-label={`Level for ${row.slug}`}
                  value={row.level}
                  onChange={(e) => place(row.slug, e.target.value as CoursePlacement['level'])}
                >
                  {COURSE_LEVELS.map((l) => (
                    <option key={l.id} value={l.id}>{String(l.no).padStart(2, '0')} · {l.title}</option>
                  ))}
                </select>
                <label className="small">
                  <input type="checkbox" checked={Boolean(row.optional)} onChange={() => toggleOptional(row.slug)} /> optional
                </label>
                <button className="btn small" type="button" disabled={i === 0} aria-label={`Move ${row.slug} up`} onClick={() => move(row.slug, -1)}>
                  <ArrowUp size={12} />
                </button>
                <button className="btn small" type="button" disabled={i === rows.length - 1} aria-label={`Move ${row.slug} down`} onClick={() => move(row.slug, 1)}>
                  <ArrowDown size={12} />
                </button>
              </div>
            ))}
            {!rows.length && <p className="muted small">No course in this level yet.</p>}
          </section>
        ))}
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        <Check size={12} /> This list is the student journey: levels in order, courses in their saved sequence.
      </p>
    </div>
  );
}
