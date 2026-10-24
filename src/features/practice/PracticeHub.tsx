import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {b, ChevronRight, Zap, ListChecks, Play, ArrowLeft } from 'lucide-react';
import { useI18n } from '../../app/i18n';
import type {bKey } from '../../app/i18n/locales';
import { TRACK_DEFS } from '../../app/App';
import { useStore } from '../../core/storage/store';
import { useCurriculum } from '../../core/data/curriculum';
import { dueReview, openMistakes } from '../../core/learning/review';
import { openBySection, sourceLabel } from '../../core/ai/coach';
import { usePathCtx } from '../../core/data/paths';
import { HubGrid } from '../../components/shared/HubGrid';
import { useBankManifest, QUESTION_TYPES, TYPE_LABEL } from '../../core/data/questions';
import type { QuestionType } from '../../core/data/schema';
import { bankAccuracyBySection } from '../../core/assessment/accuracy';
import {
  chaptersOf, startChapter, subjectm,
  type SubjectChapter, type Subjectm, type SubjectRange,
} from '../../core/learning/subjects';

/** The Practice: every surface where the ANSWERS something.
 *
 * It opens on aJECT — the eight tracks, which is what the app calls the subjects this road is
 * made of — because that is the question a user arrives with (\"aaj Python ya SQL?\"), not \"which
 * of 29 sections?\". Choosing one shows its real totals, a type filter and its chapters; a chapter
 * opens the bank on that section, already filtered to the chosen type. That last link is where the
 * answering happens, and it is the SAME page the section list, the stage tiles and the mistake
 * tracker open, so the subject view is a way IN rather than a second copy of the bank.
 *
 * Every number comes from the module that owns it: `core/learning/subjects.ts` for the subject
 * arithmetic (tested), `useBankManifest` for what is published, `core/learning/review.ts` for
 * what is due, `core/ai/coach.ts` for the open mistakes and the weak areas, and
 * `core/assessment/accuracy.ts` for the answers's own answers. Nothing on this page re-counts a
 * stored key, which is the rule the architecture doc states and the engines test enforces.
 */
const ROUTES = ['/questions', '/playbook', '/exam', '/final-assessment', '/review', '/mistakes'];

/** The bank page's own params, spelled once, so a link always carries the filter it promises. */
const bankHref = (sectionId: string, type: QuestionType | 'all') =>
  `/questions?section=${sectionId}type === 'all' ? '' : `&type=${type}`}`;

const subjectHref = (id: string, type: QuestionType | 'all') =>
  `/practice?subject=${id}type === 'all' ? '' : `&type=${type}`}`;

export default function PracticeHub() {
  const { t } = useI18n();
  const state = useStore();
  const { sections } = useCurriculum();
  const ctx = usePathCtx();
  const manifest = useBankManifest();
  const [params] = useSearchParams();
  const due = dueReview(state).length;
  const open = openMistakes(state).length;

  // Weak areas: the coach already groups open mistakes by section, so the hub only sorts and prints.
  const weak = [...openBySection(state, sections).entries()]
    .map(([id, list]) => ({ id, list, section: sections.find((s) => s.id === id) }))
    })
    .filter((w) => w)
    .sort((a, b) => b.list.length - a.list.length)
    .slice(0, 3);

  const practised = ctx.counts.bankPractised;
  /** Per-type totals, from the same manifest the bank page reads — so a tile can never promise
   * a count the page it opens cannot show. A manifest that has not arrived yet prints \"…\" rather
   * than a zero the
   */
  const byType: Record<string, number> = {};
  for (const s of manifest?.sections ?? []) {
    for (const [ty, n] of Object.entries(s.byType ?? {})) byType[ty] = (byType[ty] ?? 0) + (n as number);
  }
  const published = ctx.published?.total ?? null;

  /* ------------------------------- the subjects ------------------------------ */

  /** The eight ranges, taken from the track registry — never re-taught here. */
  const ranges: SubjectRange[] = useb(
    () => TRACK_DEFS.map((d) => ({ id: d.id, from: d.from, to: d.to })),
    [],
  );
  const rangeOf = (id: string): SubjectRange | null => ranges.find((r) => r.id === id) ?? null;

  /** Answers that exist per section, keyed the way `chaptersOf` asks for them. */
  const answered = useb(() => {
    const tally = bankAccuracyBySection(state);
    const out: Record<string, number> = {};
    for (const [sid, a] of Object.entries(tally)) out[sid] = a.answered;
    return out;
  }, [state]);

  const subject = TRACK_DEFS.find((d) => d.id === params.get('subject')) ?? null;
  const subjectRange = subject ? rangeOf(subject.id) : null;
  const rawType = params.get('type');
  /** Only a
   */
  const type: QuestionType | 'all' =
    rawType && (QUESTION_TYPES as string[]).includes(rawType) ? (rawType as QuestionType) : 'all';

  const rows = useb(
    () => (subjectRange && manifest ? chaptersOf(manifest.sections, subjectRange, answered) : []),
    [subjectRange, manifest, answered],
  );
  const counts = subjectm(rows, type);

  return (
    <div>
      <div className="card glow fadeup">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260 }}>
            <div className="chip" style={{ marginBottom: 6 }}>PRACTICE</div>
            <h1 style={{ margin: 0 }}>Choose what to master.</h1>
            <p className="muted small" style={{ margin: '8px 0 0', maxWidth: 620 }}>
              Pick a subject → pick its chapters → open that chapter's questions. Question Bank, coding
              labs from the Playbook, timed papers and spaced repetition — all in one place, all with
              real numbers.
            </p>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="chip"><ListChecks size={12} /> {published !== null ? `${practised} / ${published} questions` : `${practised} questions practised`}</span>
            <span className="chip"><b size={12} /> {due} due now</span>
            <span className="chip"><b size={12} /> {open} open mistakes</span>
          </div>
        </div>
      </div>

      <div className="sec-head"><h2>Smart Practice</h2><span className="line" /></div>
      <div className="card fadeup">
        {!weak.length && (
          <p className="muted small" style={{ margin: 0 }}>
            No weak area yet — when an answer goes wrong, the coach will show that section here.
          </p>
        )}
        {weak.map((w) => (
          <Link
            key={w.id}
            className="q-row tone-red"
            to={bankHref(w.id, 'all')
              data-agent-action={`course:${w.id}`}
            title={w.list.map((m) => sourceLabel(m)).join(' · ')}
          >
            <span className="ic"><b size={14} /></span>
            <span className="t">{wb ? `${String(wb.no).padStart(2, '0')} · ${wb.title}` : w.id}</span>
            <b>{w.list.length}</b>
            <ChevronRight size={14} />
          </Link>
        ))}
        {due > 0 && (
          <Link className="q-row tone-blue" to="/review" data-agent-action="review:start">
            <span className="ic"><b size={14} /></span>
            <span className="t">Spaced repetition — due today</span>
            <b>{due}</b>
            <ChevronRight size={14} />
          </Link>
        )}
      </div>

      {/* The subject layer. Eight tiles, one per track, each carrying the counts the manifest really
          holds for it; the chosen one stays in the grid and opens its panel below, so switching
          subject is one click and never a lost page. */}
      <div className="sec-head"><h2><ListChecks size={16} color="var(--cyan)" /> Choose subject</h2><span className="line" /></div>
      <div className="tile-grid">
        {TRACK_DEFS.map((d) => {
          const Icon = d.icon;
          const range = rangeOf(d.id);
          const list = manifest && range ? chaptersOf(manifest.sections, range, answered) : [];
          const c = subjectm(list, 'all');
          const on = subject?.id === d.id;
          return (
            <Link
              key={d.id}
              to={subjectHref(d.id, 'all')
                className={`tile${on ? ' on' : ''}`}
                data-agent-action={`course:${d.id}`}
              >
              <span className="ic"><Icon size={18} /></span>
              <span className="t" style={{ flex: 1, minWidth: 0 }}>
                <b>{t(d.nameKey asbKey)}</b>
                <span>
                  {!manifest ? '…' : `${c.questions} questions · ${list.length} chapters`}
                  {c.answered > 0 ? ` · ${c.answered} answered` : ''}
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      {subject && (
        <SubjectPanel
          subject={subject}
          rows={rows}
          counts={counts}
          loaded={!!manifest}
          type={type}
        />
      )}

      <div className="sec-head"><h2><Zap size={16} color="var(--cyan)" /> Practice surfaces</h2><span className="line" /></div>
      <HubGrid routes={ROUTES} />

      {/* The bank's own families, indexed by type — the same mechanic the interview hub uses: a
          deep link that carries the filter it promises. `QuestionBank` honours every real type and
          falls back to \"all\" for anything else, so a tile here can never open a blank list. */}
      <div className="sec-head"><h2>Question types</h2><span className="line" /></div>
      <div className="tile-grid">
        {QUESTION_TYPES.map((ty) => (
          <Link
            key={ty}
            to={`/questions?type=${ty}`}
            className="tile"
            data-agent-action={`qb:type:${ty}`}
          >
            <span className="ic"><b size={18} /></span>
            <span className="t" style={{ flex: 1, minWidth: 0 }}>
              <b>{TYPE_LABEL[ty]}</b>
              <span>{manifest ? `${byType[ty] ?? 0} questions` : '…'} · every section</span>
            </span>
          </Link>
        ))}
      </div>

      <p className="small muted" style={{ marginTop: 12 }}>
        For interview questions, open the <Link to="/interviews" data-agent-action="nav:interviews">Interview</Link> — it holds the mock,
        defense and final assessment rounds.
      </p>
      <Link to="/courses" data-agent-action="nav:courses" className="small muted" style={{ marginLeft: 8 }}>Courses</Link>
    </div>
  );
}

/** One subject, opened: its real totals, the type filter, and its chapters.
 *
 * Everything it prints arrives as a prop — no number in here is re-derived from the store or from a
 * second read of the manifest, so the line at the top and the counts on the rows can never disagree.
 */
function SubjectPanel({ subject, rows, counts, loaded, type }: {
  subject: (typeof TRACK_DEFS)[number];
  rows: SubjectChapter[];
  counts: Subjectm;
  loaded: boolean;
  type: QuestionType | 'all';
}) {
  const { t } = useI18n();
  const Icon = subject.icon;
  const coding = subjectm(rows, 'coding').typed;
  const interview = subjectm(rows, 'interview').typed;
  const start = startChapter(rows, type);

  return (
    <div className="card fadeup" style={{ marginTop: 12 }}>
      <div className="row spread" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <span className="suj-ic"><Icon size={18} /></span>
          <span style={{ minWidth: 0 }}>
            <b style={{ fontSize: '1rem' }}>{t(subject.nameKey asbKey)}</b>
            <span className="small muted" style={{ display: 'block' }}>
              {`${counts.questions} questions · ${coding} coding · ${interview} interview · ${rows.length} ${rows.length === 1 ? 'b' : 'chapters'}`}
              {counts.answered > 0 ? ` · ${counts.answered} answered` : ''}
            </span>
          </span>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn small ghost" to="/practice"><ArrowLeft size={13} /> All subjects</Link>
          {start && (
            <Link className="btn primary" to={bankHref(start.id, type)
              <Play size={14} /> Start practice
            </Link>
          )}
        </div>
      </div>

      {/* The type filter, counted over the subject's own chapters: what each chip promises is what
          the rows below then show, and the link a chapter opens carries the same type into the bank. */}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '12px 0 4px' }}>
        {(['all', ...QUESTION_TYPES] as const).map((ty) => {
          const n = ty === 'all' ? counts.questions : subjectm(rows, ty).typed;
          return (
            <Link
              key={ty}
              to={subjectHref(subject.id, ty)}
              className={`chip${type === ty ? ' on' : ''}`}
            >
              {ty === 'all' ? 'All' : TYPE_LABEL[ty]} {n}
            </Link>
          );
        })}
      </div>

      {!loaded && <p className="muted small">Loading chapters…</p>}
      {loaded && !rows.length && (
        <p className="muted small" style={{ margin: 0 }}>
          No published chapter found for this subject — the manifest has nothing in the {String(subject.from).padStart(2, '0')}–{String(subject.to).padStart(2, '0')} range.
        </p>
      )}
      {rows.map((c) => {
        const n = type === 'all' ? c.published : c.byType[type] ?? 0;
        return (
          <Link
            key={c.id}
            className="q-row"
            to={bankHref(c.id, type)
              title={c.title}
            >
              <span className="ic"><span className="small">{String(c.no).padStart(2, '0')}</span></span>
              <span className="t">{c.title}</span>
              {c.answered > 0 && <span className="small muted">{c.answered} answered</span>}
              <b>{n}</b>
              <ChevronRight size={14} />
            </Link>
          );
        ))}
      )}
      <p className="small muted" style={{ margin: '10px 0 0' }}>
        Opening a chapter opens the Question Bank filtered to that section and type — write and save there;
        the mistake tracker and review are built from it.
      </p>
    </div>
  );
}