import { useMemo, useState } from 'react';
import { Archive, Check, Eye, EyeOff, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  archiveOwnerCourse, createOwnerCourse, deleteOwnerCourse, restoreOwnerCourse,
  updateOwnerCourse, useOwnerCourses,
} from '../../core/data/owner-courses';
import {
  nextOwnerOrder, ownerCourseCards, ownerCourseProblem, OWNER_LEVELS, OWNER_LOGO_KEYS,
  OWNER_SUMMARY_LIMIT, OWNER_TONES, slugifyCourseName, type OwnerCourseDraft,
} from '../../core/learning/owner-courses';

/**
 * The owner's course studio — ADD and DELETE, the half of course management the order editor
 * deliberately refuses.
 *
 * Why two editors: a catalog course is authored content with a page, steps, question ids and stored
 * progress keyed by its slug, so deleting it would break links and orphan records — that editor
 * moves and hides it instead. A card created HERE owns none of that, so it really can be deleted,
 * and this page says so in as many words instead of offering one dangerous "delete" for both.
 *
 * Every write goes straight to Supabase under the table's admin policy; the browser never holds a
 * service key. A failure (offline, migration not deployed, not an admin) is shown as a sentence and
 * nothing is optimistically changed.
 */
const emptyDraft = (): OwnerCourseDraft => ({
  slug: '',
  name: '',
  summary: '',
  href: '',
  logo: 'brain',
  tone: 'cyan',
  level: 'foundations',
  order: 1,
});

export default function OwnerCourseStudio() {
  const { rows, loading, reload } = useOwnerCourses();
  const cards = useMemo(() => ownerCourseCards(rows), [rows]);
  const archived = useMemo(() => (rows ?? []).filter((row) => row.deletedAt), [rows]);

  const [draft, setDraft] = useState<OwnerCourseDraft>(emptyDraft);
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const set = <K extends keyof OwnerCourseDraft>(key: K, value: OwnerCourseDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  /** The name is the source of the slug until the owner edits the slug by hand. */
  const onName = (name: string) => {
    setDraft((prev) => ({
      ...prev,
      name,
      slug: slugTouched ? prev.slug : slugifyCourseName(name),
    }));
  };

  const add = async () => {
    setNote('');
    const candidate: OwnerCourseDraft = {
      ...draft,
      order: nextOwnerOrder(cards, draft.level),
    };
    const problem = ownerCourseProblem(candidate);
    if (problem) { setNote(problem); return; }
    setBusy(true);
    const error = await createOwnerCourse(candidate);
    if (!error) await reload();
    setBusy(false);
    if (error) { setNote(error); return; }
    setDraft(emptyDraft());
    setSlugTouched(false);
    setNote(`Added “${candidate.name.trim()}” — it is on the Courses page now.`);
  };

  const run = async (action: () => Promise<string | null>, done: string) => {
    setBusy(true);
    setNote('');
    const error = await action();
    if (!error) { await reload(); setNote(done); }
    setBusy(false);
    if (error) setNote(error);
  };

  const changeLevel = (slug: string, level: string) => {
    const order = nextOwnerOrder(cards.filter((card) => card.slug !== slug), level);
    void run(() => updateOwnerCourse(slug, { level, order }), 'Moved to the new level.');
  };

  return (
    <div className="card owner-course-studio">
      <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Your own courses</h2>
          <p className="muted small" style={{ margin: '4px 0 0', maxWidth: 640 }}>
            Add a course card of your own: a name, a mark, a level and the page it opens. These cards
            own no generated content, so deleting one is safe — it cannot orphan a learner's progress.
            The eleven catalog courses are authored content and stay under <b>Course journey</b> below,
            where Hide stands one down without breaking its page, steps or records.
          </p>
        </div>
        <span className="chip small">{cards.length} custom</span>
      </div>

      <div className="ocs-form">
        <label>
          <span>Name</span>
          <input
            maxLength={80}
            onChange={(event) => onName(event.target.value)}
            placeholder="e.g. SQL Interview Sprint"
            type="text"
            value={draft.name}
          />
        </label>
        <label>
          <span>Slug</span>
          <input
            maxLength={48}
            onChange={(event) => { setSlugTouched(true); set('slug', event.target.value); }}
            placeholder="sql-interview-sprint"
            type="text"
            value={draft.slug}
          />
        </label>
        <label>
          <span>Opens</span>
          <input
            maxLength={200}
            onChange={(event) => set('href', event.target.value)}
            placeholder="/questions?type=sql"
            type="text"
            value={draft.href}
          />
        </label>
        <label>
          <span>One-line summary</span>
          <input
            maxLength={OWNER_SUMMARY_LIMIT}
            onChange={(event) => set('summary', event.target.value)}
            placeholder="Shown as the card tooltip"
            type="text"
            value={draft.summary}
          />
        </label>
        <label>
          <span>Level</span>
          <select onChange={(event) => set('level', event.target.value)} value={draft.level}>
            {OWNER_LEVELS.map((level) => (
              <option key={level.id} value={level.id}>
                {String(level.no).padStart(2, '0')} · {level.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Logo</span>
          <select onChange={(event) => set('logo', event.target.value)} value={draft.logo}>
            {OWNER_LOGO_KEYS.map((logo) => <option key={logo} value={logo}>{logo}</option>)}
          </select>
        </label>
        <label>
          <span>Tone</span>
          <select onChange={(event) => set('tone', event.target.value)} value={draft.tone}>
            {OWNER_TONES.map((tone) => <option key={tone} value={tone}>{tone}</option>)}
          </select>
        </label>
      </div>

      {note && <p className="small" role="status" style={{ margin: '8px 0 0' }}>{note}</p>}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '10px 0 4px' }}>
        <button className="btn small primary" disabled={busy} onClick={() => void add()} type="button">
          <Plus size={12} /> Add course
        </button>
        <button className="btn small" disabled={busy} onClick={() => void reload()} type="button">
          <RotateCcw size={12} /> Reload
        </button>
      </div>

      {loading && <p className="muted small">Loading your courses…</p>}
      {!loading && rows === null && (
        <p className="muted small" style={{ margin: 0 }}>
          The owner_course table is not reachable yet — deploy the migration to enable your own
          courses. The Courses page keeps rendering the catalog meanwhile.
        </p>
      )}

      {cards.map((card) => (
        <div className="ocs-row" key={card.slug}>
          <span className="ocs-name">
            <b>{card.name}</b>
            <span className="muted small" style={{ display: 'block' }}>
              /{card.slug} → {card.href}{card.summary ? ` · ${card.summary}` : ''}
            </span>
          </span>
          <select
            aria-label={`Level for ${card.slug}`}
            onChange={(event) => changeLevel(card.slug, event.target.value)}
            value={card.level}
          >
            {OWNER_LEVELS.map((level) => (
              <option key={level.id} value={level.id}>{level.title}</option>
            ))}
          </select>
          <button
            aria-pressed={card.hidden}
            className="btn small"
            disabled={busy}
            onClick={() => void run(
              () => updateOwnerCourse(card.slug, { hidden: !card.hidden }),
              card.hidden ? 'Card restored to the journey.' : 'Card hidden from learners.',
            )}
            title={card.hidden ? 'Show this card on the Courses page again.' : 'Take this card off the Courses page. Nothing is deleted.'}
            type="button"
          >
            {card.hidden ? <><Eye size={12} /> Show</> : <><EyeOff size={12} /> Hide</>}
          </button>
          <button
            className="btn small"
            disabled={busy}
            onClick={() => void run(() => archiveOwnerCourse(card.slug), 'Archived — Restore brings it back.')}
            title="Archive this card: it leaves the journey but the row is kept."
            type="button"
          >
            <Archive size={12} /> Archive
          </button>
          <button
            className="btn small"
            disabled={busy}
            onClick={() => void run(() => deleteOwnerCourse(card.slug), 'Deleted permanently.')}
            title="Delete this custom card for good. It owns no pages or progress, so nothing is orphaned."
            type="button"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      ))}

      {!loading && rows !== null && !cards.length && (
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          No custom course yet. Add one above — it appears on the Courses page in the level you pick.
        </p>
      )}

      {!!archived.length && (
        <>
          <h3 style={{ margin: '14px 0 4px', fontSize: '.85rem' }}>Archived</h3>
          <p className="muted small" style={{ margin: '0 0 4px' }}>
            Kept so a mistaken removal is one click away from coming back.
          </p>
          {archived.map((row) => (
            <div className="ocs-row is-archived" key={row.slug}>
              <span className="ocs-name">
                <b>{row.name}</b>
                <span className="muted small" style={{ display: 'block' }}>/{row.slug}</span>
              </span>
              <button
                className="btn small"
                disabled={busy}
                onClick={() => void run(() => restoreOwnerCourse(row.slug), 'Restored.')}
                type="button"
              >
                <RotateCcw size={12} /> Restore
              </button>
              <button
                className="btn small"
                disabled={busy}
                onClick={() => void run(() => deleteOwnerCourse(row.slug), 'Deleted permanently.')}
                type="button"
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
          ))}
        </>
      )}

      <p className="muted small" style={{ marginBottom: 0 }}>
        <Check size={12} /> A custom card is a door into this app — its link must be an internal path,
        so it can never redirect a learner off the site.
      </p>
    </div>
  );
}
