import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ListChecks, Search } from 'lucide-react';
import { SubjectLogo } from '../../components/shared/SubjectLogo';
import { CLogo } from '../c-programming/CLogo';
import { JLogo } from '../java-programming/JLogo';
import { TRACK_DEFS } from '../../app/App';
import { useI18n } from '../../app/i18n';
import type { LocaleKey } from '../../app/i18n/locales';
import { subjectsOf, type SubjectRange } from '../../core/learning/subjects';

/** Which course a section row belongs to — the boxes below are the whole point of this index. */
export type CourseKey = 'python' | 'c';

export interface PythonSectionRow {
  sectionId: string; no: number; title: string; published: number; flags: string[];
}
export interface CModuleRow {
  id: string; no: number; title: string; level: string; brief: string; questions: number;
}

/** The eight subject ranges, from the track registry — never re-typed here. */
const RANGES: SubjectRange[] = TRACK_DEFS.map((d) => ({ id: d.id, from: d.from, to: d.to }));

/**
 * One emoji per subject box, as a quick shape to find by before the name is read.
 *
 * Presentation, not data: the box already carries the subject's real mark (`SubjectLogo`), and the
 * counts on it come from the bank manifest. This is the one thing a box says that no registry
 * holds, which is why it lives here beside the markup that prints it rather than in `TRACK_DEFS`.
 */
const EMOJI: Record<string, string> = {
  python: '🐍', data: '📊', sql: '🗄️', ml: '🤖', genai: '✨', agentic: '🧠', apis: '🚀', interview: '💼',
};
const C_EMOJI = '⚙️';

/**
 * The Question Bank's index: one box per subject, then that subject's lessons.
 *
 * The page used to open on two boxes — "Python & AI" holding all 29 sections, and C — which meant
 * the first thing a learner saw was a 29-row list under a single label, with no sense of which
 * subject they were in. The boxes are now the app's own eight subjects (the same `TRACK_DEFS`
 * ranges the practice pillar opens on), drawn with the course card's design: the subject's mark, its
 * emoji, its name, and one line of real numbers. Picking a box opens THAT subject's lessons directly
 * under it; picking a lesson loads its questions in the bank below. C Programming keeps its own box
 * and its own module list, because its questions are MCQs that belong to a course, not a track.
 *
 * Nothing here counts a stored key: the counts are the manifest's `published`, and "answered" is the
 * accuracy tally the page already computed.
 */
export default function CourseSections({
  baseline, python, cModules, java, selected, course, track, answered = {}, accuracy = {}, cAnswered = {}, cCorrect = 0, onPick, onPickTrack,
}: {
  baseline: number;
  python: PythonSectionRow[];
  cModules: CModuleRow[];
  /**
   * The Java course's own bank, as a box that opens it.
   *
   * Java is a course like C, but its module tests are written under the course's own `jquiz:`
   * records (the keys its lesson tests and progress already read). Answering them a second time
   * here would collide with those records, so this box LINKS to the Java test bank instead of
   * rendering a competing pane — and prints the length of the published file it opens.
   */
  java: { modules: number; questions: number };
  selected: string | null;
  course: CourseKey;
  /** The open subject box (a track id, or `'c'`). */
  track: string;
  /** Answers that exist per section id — the accuracy tally, not a click count. */
  answered?: Record<string, number>;
  /**
   * Graded answers per section id, and how many of them were right.
   *
   * `answered` alone cannot tell a learner who got everything right from one who got everything
   * wrong, which is the figure this page exists to make visible. Accuracy is correct / GRADED —
   * never correct / answered: an answer written but not graded yet is not a wrong one, and counting
   * it in the denominator would drag the figure down for work the learner has not finished.
   */
  accuracy?: Record<string, { graded: number; correct: number }>;
  /** The same tally for C's MCQ sets, keyed by module id. */
  cAnswered?: Record<string, number>;
  /** How many of C's answered MCQs were right — every pick is graded, so `cAnswered` is the denominator. */
  cCorrect?: number;
  onPick: (course: CourseKey, id: string) => void;
  onPickTrack: (id: string) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();

  /**
   * The published lessons each subject owns. Membership comes from `subjectsOf` — the tested rule
   * the practice pillar and its test share — so a section can never sit in one box here and in
   * another box there.
   */
  const rowsByTrack = new Map<string, PythonSectionRow[]>();
  for (const range of RANGES) {
    rowsByTrack.set(
      range.id,
      python.filter((s) => subjectsOf(s.no, RANGES)[0]?.id === range.id).sort((a, b) => a.no - b.no),
    );
  }

  const questionsOf = (rows: PythonSectionRow[]) => rows.reduce((n, s) => n + s.published, 0);
  const answeredOf = (rows: PythonSectionRow[]) => rows.reduce((n, s) => n + (answered[s.sectionId] ?? 0), 0);
  const gradedOf = (rows: PythonSectionRow[]) => rows.reduce((n, s) => n + (accuracy[s.sectionId]?.graded ?? 0), 0);
  const correctOf = (rows: PythonSectionRow[]) => rows.reduce((n, s) => n + (accuracy[s.sectionId]?.correct ?? 0), 0);
  /**
   * Correct over GRADED, or null when nothing is graded.
   *
   * Null is the honest answer for a box nobody has graded: the box then says nothing about accuracy
   * instead of printing "0%", which would read as "everything wrong".
   */
  const accPct = (graded: number, correct: number) => (graded > 0 ? Math.round((correct / graded) * 100) : null);
  /**
   * Which band an accuracy figure falls in, so a weak subject is visible before its number is read.
   *
   * The cut-offs are the app's existing mastery gates — 75% ready, 40% building
   * (`core/learning/career.ts`) — reused here instead of inventing a second pair of thresholds:
   * two surfaces teaching two different ideas of "good" is how the word stops meaning anything.
   */
  const accBand = (pct: number) => (pct >= 75 ? 'strong' : pct >= 40 ? 'mid' : 'weak');
  /**
   * How much of a box the learner has actually answered, as a percentage.
   *
   * The denominator is the box's own published questions, so the figure means "of what this box
   * holds, this much is done" — never a share of the whole bank, which would read as progress on a
   * subject the learner has not opened. Clamped at 100: an answer is one per question, but a bank
   * that shrinks between imports must not print 104%.
   */
  const pctOf = (done: number, total: number) => (total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0);

  const activeTrack = TRACK_DEFS.find((d) => d.id === track) ?? TRACK_DEFS[0];
  const activeRows = rowsByTrack.get(activeTrack.id) ?? [];
  const cQuestions = cModules.reduce((n, m) => n + m.questions, 0);
  /** C's own tally, keyed by module id — the same rail, so the one course box is not a gap. */
  const cDone = cModules.reduce((n, m) => n + (cAnswered[m.id] ?? 0), 0);
  const cAcc = accPct(cDone, cCorrect);

  const total = questionsOf(python) + cQuestions + java.questions;

  /**
   * Search is GLOBAL on purpose. A box holds one subject, but a learner looking for "Tuples" does
   * not always know which subject teaches it — so a query reads across every box and labels each
   * hit with the subject it came from, instead of silently searching the box that happens to be open.
   */
  const matches = !needle ? [] : [
    ...TRACK_DEFS.flatMap((d) => (rowsByTrack.get(d.id) ?? [])
      .filter((s) => `${s.no} ${s.title}`.toLowerCase().includes(needle))
      .map((s) => ({ key: `t-${s.sectionId}`, course: 'python' as const, id: s.sectionId, no: s.no, title: s.title, where: t(d.nameKey as LocaleKey) }))),
    ...cModules
      .filter((m) => `${m.id} ${m.title} ${m.level}`.toLowerCase().includes(needle))
      .map((m) => ({ key: `c-${m.id}`, course: 'c' as const, id: m.id, no: m.no, title: m.title, where: 'C Programming' })),
  ];

  /** One subject box, in the course card's own design. */
  const trackCard = (d: (typeof TRACK_DEFS)[number]) => {
    const rows = rowsByTrack.get(d.id) ?? [];
    const on = course === 'python' && d.id === activeTrack.id;
    const needs = (d as { prereq?: string[] }).prereq?.[0];
    const needed = needs ? TRACK_DEFS.find((x) => x.id === needs) : null;
    const name = t(d.nameKey as LocaleKey);
    const acc = accPct(gradedOf(rows), correctOf(rows));
    return (
      <button
        key={d.id}
        type="button"
        className={`course-card cc-simple qb-track tone-${d.tone}${on ? ' on' : ''}`}
        onClick={() => onPickTrack(d.id)}
        data-agent-action={`qb:track:${d.id}`}
        aria-pressed={on}
        title={`${name} — ${rows.length} lessons · ${questionsOf(rows)} questions · ${answeredOf(rows)} answered${accPct(gradedOf(rows), correctOf(rows)) !== null ? ` · ${accPct(gradedOf(rows), correctOf(rows))}% accuracy on ${gradedOf(rows)} graded` : ''}`}
      >
        <span className="cc-logo">
          <SubjectLogo id={d.id} name={name} size={72} />
          <span className="qb-emoji" aria-hidden="true">{EMOJI[d.id] ?? '📘'}</span>
        </span>
        <b className="cc-name">{name}</b>
        <span className="cc-meta">
          <span className="cc-level">{rows.length} {rows.length === 1 ? 'lesson' : 'lessons'}</span>
          <span>{questionsOf(rows)} questions</span>
          {needed && <span className="cc-needs">Needs: {t(needed.nameKey as LocaleKey)}</span>}
        </span>
        {/* The learner's own work on this box, quiet under the plan line: a rail plus the figure it
            draws. A box nobody has touched says so in words instead of showing a 0% rail that looks
            like a broken measure. */}
        <span className="qb-progress-block">
          <span className="qb-progress" aria-hidden="true">
            <i style={{ width: `${pctOf(answeredOf(rows), questionsOf(rows))}%` }} />
          </span>
          <span className="qb-progress-label">
            {answeredOf(rows) > 0
              ? `${pctOf(answeredOf(rows), questionsOf(rows))}% answered`
              : 'not started'}
            {acc !== null && (
              <> · <span className={`qb-acc qb-acc-${accBand(acc)}`} title={`${acc}% accuracy · ${accBand(acc)}`}>{acc}% accuracy</span></>
            )}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="card">
      <div className="row spread">
        <h2 className="row" style={{ gap: 8, margin: 0 }}><ListChecks size={16} /> Subjects</h2>
        <span className="small muted">
          {TRACK_DEFS.length + 2} boxes · {total} questions
        </span>
      </div>
      <div className="row" style={{ margin: '10px 0', border: '1px solid var(--border)', borderRadius: 10, padding: '2px 8px', background: 'rgba(0,0,0,.3)' }}>
        <Search size={14} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search every lesson — Python, data, ML, SQL, C…"
          aria-label="Search lessons across every course"
          style={{ border: 'none', background: 'transparent', flex: 1, padding: '6px 4px', minWidth: 0 }}
        />
        {search && (
          <button className="btn small" onClick={() => setSearch('')} aria-label="Clear the lesson search">Clear</button>
        )}
      </div>
      <p className="muted small" style={{ margin: '0 0 10px' }}>
        One box per subject — pick a subject and its own lessons open right under the boxes; pick a
        lesson and its questions open below. Nothing is mixed between two subjects.
      </p>
      {/* The bands, spelled out where the colours are. A colour that means something only to the
          person who wrote the CSS is decoration; one line decodes it. */}
      <p className="small muted" style={{ margin: '-4px 0 10px' }}>
        Accuracy is correct ÷ graded — <b className="qb-acc-strong">75%+ strong</b> ·{' '}
        <b className="qb-acc-mid">40–74% building</b> · <b className="qb-acc-weak">below 40% weak</b>.
      </p>

      {needle ? (
        <div className="qb-index-rows">
          {matches.map((m) => (
            <button
              key={m.key}
              className={`file-row${m.course === course && m.id === selected ? ' on' : ''}`}
              data-agent-action={`qb:hit:${m.id}`}
              onClick={() => { onPickTrack(m.course === 'c' ? 'c' : (RANGES.find((r) => subjectsOf(m.no, [r]).length > 0)?.id ?? activeTrack.id)); onPick(m.course, m.id); }}
            >
              <span className="mono small muted" style={{ flex: 'none' }}>{String(m.no).padStart(2, '0')}</span>
              <span className="sec-name">{m.title}</span>
              <span className="chip small">{m.where}</span>
              <ChevronRight size={13} />
            </button>
          ))}
          {!matches.length && (
            <p className="muted small" style={{ margin: 0 }}>No lesson matches “{search}” in any subject.</p>
          )}
        </div>
      ) : (
        <>
          <div className="course-grid qb-tracks">
            {TRACK_DEFS.map((d) => trackCard(d))}
            <button
              type="button"
              className={`course-card cc-simple qb-track tone-cyan${course === 'c' ? ' on' : ''}`}
              onClick={() => onPickTrack('c')}
              data-agent-action="qb:track:c"
              aria-pressed={course === 'c'}
              title={`C Programming — ${cModules.length} modules · ${cQuestions} MCQs`}
            >
              <span className="cc-logo">
                <CLogo size={72} />
                <span className="qb-emoji" aria-hidden="true">{C_EMOJI}</span>
              </span>
              <b className="cc-name">C Programming</b>
              <span className="cc-meta">
                <span className="cc-level">{cModules.length} modules</span>
                <span>{cQuestions} questions</span>
              </span>
              <span className="qb-progress-block">
                <span className="qb-progress" aria-hidden="true">
                  <i style={{ width: `${pctOf(cDone, cQuestions)}%` }} />
                </span>
                <span className="qb-progress-label">
                  {cDone > 0 ? `${pctOf(cDone, cQuestions)}% answered` : 'not started'}
                  {cAcc !== null && (
                    <> · <span className={`qb-acc qb-acc-${accBand(cAcc)}`} title={`${cAcc}% accuracy · ${accBand(cAcc)}`}>{cAcc}% accuracy</span></>
                  )}
                </span>
              </span>
            </button>
            {/* Java, the second course box: same card, its own mark, and the real total of the
                questions its test bank holds. */}
            <Link
              className="course-card cc-simple qb-track tone-amber"
              to="/java?tab=tests"
              data-agent-action="qb:track:java"
              title={`Java Programming — ${java.modules || '…'} modules · ${java.questions || '…'} test questions`}
            >
              <span className="cc-logo">
                <JLogo size={72} />
                <span className="qb-emoji" aria-hidden="true">☕</span>
              </span>
              <b className="cc-name">Java Programming</b>
              <span className="cc-meta">
                <span className="cc-level">{java.modules || '…'} modules</span>
                <span>{java.questions || '…'} questions</span>
              </span>
              <span className="qb-progress-block">
                <span className="qb-progress-label">Open the Java test bank →</span>
              </span>
            </Link>
          </div>

          {/* The open subject's own index, directly under its boxes. */}
          <div className="qb-index">
            <div className="qb-index-head">
              {course === 'c'
                ? <CLogo size={26} />
                : <SubjectLogo id={activeTrack.id} name={t(activeTrack.nameKey as LocaleKey)} size={26} />}
              <span style={{ minWidth: 0 }}>
                <b>{course === 'c' ? 'C Programming' : t(activeTrack.nameKey as LocaleKey)}</b>
                <span className="small muted" style={{ display: 'block' }}>
                  {course === 'c'
                    ? `${cModules.length} modules · ${cQuestions} MCQs`
                    : `${activeRows.length} lessons · ${questionsOf(activeRows)} questions${answeredOf(activeRows) > 0 ? ` · ${answeredOf(activeRows)} answered` : ''}${accPct(gradedOf(activeRows), correctOf(activeRows)) !== null ? ` · ${accPct(gradedOf(activeRows), correctOf(activeRows))}% accuracy` : ''}`}
                </span>
              </span>
            </div>

            {course === 'c' ? (
              <div className="qb-index-rows">
                {cModules.map((m) => (
                  <button
                    key={m.id}
                    className={`file-row${m.id === selected ? ' on' : ''}`}
                    data-agent-action={`qb:module:${m.id}`}
                    onClick={() => onPick('c', m.id)}
                  >
                    <span className="mono small muted" style={{ flex: 'none' }}>{String(m.no).padStart(2, '0')}</span>
                    <span className="sec-name">{m.title}</span>
                    <span className="chip small">{m.questions} Qs</span>
                    <ChevronRight size={13} />
                  </button>
                ))}
                {!cModules.length && <p className="muted small">No C module is published yet.</p>}
              </div>
            ) : (
              <div className="qb-index-rows">
                {activeRows.map((s) => {
                  const incomplete = s.flags.includes('CONTENT_INCOMPLETE');
                  const pct = Math.min(100, Math.round((s.published / baseline) * 100));
                  const acc = accPct(accuracy[s.sectionId]?.graded ?? 0, accuracy[s.sectionId]?.correct ?? 0);
                  return (
                    <button
                      key={s.sectionId}
                      className={`file-row${s.sectionId === selected ? ' on' : ''}`}
                      data-agent-action={`qb:section:${s.sectionId}`}
                      onClick={() => onPick('python', s.sectionId)}
                    >
                      <span className="mono small muted" style={{ flex: 'none' }}>{String(s.no).padStart(2, '0')}</span>
                      <span className="sec-name">{s.title}</span>
                      {(answered[s.sectionId] ?? 0) > 0 && (
                        <span className="small muted">
                          {answered[s.sectionId]} answered
                          {acc !== null && <> · <span className={`qb-acc qb-acc-${accBand(acc)}`}>{acc}%</span></>}
                        </span>
                      )}
                      <span className={`chip ${incomplete ? 'medium' : 'easy'}`} title={incomplete ? 'CONTENT_INCOMPLETE — baseline not authored yet' : 'complete'}>
                        {pct}%
                      </span>
                      <ChevronRight size={13} />
                    </button>
                  );
                })}
                {!activeRows.length && (
                  <p className="muted small" style={{ margin: 0 }}>
                    No published lesson in this subject's range yet.
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
