import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Archive, ArrowRight, Dice5, ListChecks, Mic2, Play } from 'lucide-react';
import { useI18n } from '../../app/i18n';
import type { LocaleKey } from '../../app/i18n/locales';
import { TRACK_DEFS } from '../../app/App';
import { usePathCtx } from '../../core/data/paths';
import { useStore } from '../../core/storage/store';
import { useBankManifest } from '../../core/data/questions';
import { FINAL_PARTS } from '../../core/learning/paths';
import { subjectOf, type SubjectRange } from '../../core/learning/subjects';
import {
  INTERVIEW_KINDS, KIND_BY_ID, kindCounts, kindProgress, lastInterviewTouch, SESSION_SIZES,
} from '../../core/assessment/interview-room';
import { HubGrid } from '../../components/shared/HubGrid';
import { Bar } from '../../components/ui/ui';

/**
 * The interview pillar: choose a SUBJECT, choose a round, answer fresh questions.
 *
 * Every figure here is derived. The subject inventory comes from the bank manifest (the canonical
 * records' own tally), the "answers recorded" meters come from the `qb:` attempt keys the Question
 * Bank and the interview room both write, and the tool cards stay counted from the registries
 * their pages load — so this hub can never promise a question its own link cannot show. Which
 * kinds a subject offers is decided by the subject's real data, not by a hand-written list.
 */
const ROUTES = ['/interview-mode', '/mock-interviews', '/defense', '/final-assessment'];

/** The whole curriculum as one range — used for the cross-subject progress meters. */
const ALL_RANGE: SubjectRange = { id: 'all', from: 1, to: 99 };

export default function InterviewsHub() {
  const { t } = useI18n();
  const ctx = usePathCtx();
  const state = useStore();
  const manifest = useBankManifest();
  const [params, setParams] = useSearchParams();

  const entries = manifest?.sections ?? [];
  const ranges: SubjectRange[] = useMemo(() => TRACK_DEFS.map((d) => ({ id: d.id, from: d.from, to: d.to })), []);

  const answered = ctx.counts.interviewAnswers;
  const interviewQs = entries.reduce((a, s) => a + INTERVIEW_KINDS.reduce((b, k) => b + kindCounts(s)[k.id], 0), 0);

  /** Per subject: the interview inventory and how many of its questions have an answer on record. */
  const subjects = useMemo(() => ranges.map((r) => {
    const inv = entries.filter((e) => e.no >= r.from && e.no <= r.to);
    const total = inv.reduce((a, e) => a + INTERVIEW_KINDS.reduce((b, k) => b + kindCounts(e)[k.id], 0), 0);
    const kinds = INTERVIEW_KINDS
      .map((k) => ({ id: k.id, count: inv.reduce((a, e) => a + kindCounts(e)[k.id], 0) }))
      .filter((k) => k.count > 0);
    const done = kindProgress(state.attempts, r, entries).reduce((a, k) => a + k.done, 0);
    return { range: r, total, kinds, done };
  }), [ranges, entries, state.attempts]);

  const globalKinds = useMemo(() => kindProgress(state.attempts, ALL_RANGE, entries), [state.attempts, entries]);
  const selected = ranges.find((r) => r.id === params.get('subject')) ?? null;
  const subjectView = subjects.find((s) => s.range.id === selected?.id) ?? null;

  /** Continue: the last answered interview question, mapped back to its subject. */
  const last = useMemo(() => {
    const touch = lastInterviewTouch(state.attempts);
    if (!touch) return null;
    const no = Number(touch.sectionId.replace('s', ''));
    const subject = subjectOf(no, ranges);
    return subject ? { ...touch, subjectId: subject.id } : null;
  }, [state.attempts, ranges]);

  /** Random: a real subject — where the learner left off, else the first one with data. */
  const randomSubject = last?.subjectId
    ?? subjects.find((s) => s.kinds.length > 0)?.range.id
    ?? 'python';
  const randomKind = last?.kind ?? 'concept';
  const randomSize = SESSION_SIZES.includes(Number(params.get('size')) as (typeof SESSION_SIZES)[number])
    ? Number(params.get('size'))
    : 10;

  return (
    <div>
      <div className="card glow fadeup">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260 }}>
            <div className="chip" style={{ marginBottom: 6 }}>🎤 INTERVIEW</div>
            <h1 style={{ margin: 0 }}>Practise out loud. Then defend it.</h1>
            <p className="muted small" style={{ margin: '8px 0 0', maxWidth: 620 }}>
              Pick a subject, pick a round, and practise with real questions — concept, coding,
              debugging, logic, project. Every answer is saved against the same canonical question the
              Question Bank shows.
            </p>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="chip"><Mic2 size={12} /> {answered} answers recorded</span>
            {typeof ctx.counts.interviewPct === 'number' && <span className="chip">{ctx.counts.interviewPct}% average</span>}
            <span className="chip">{ctx.counts.mockDone} mock rounds</span>
            <span className="chip">{ctx.defenseGates} / {ctx.sections.length} defended</span>
            <span className="chip">{ctx.counts.finalParts} / {FINAL_PARTS} final parts</span>
          </div>
        </div>
      </div>

      {/* ---------- continue + random ---------- */}
      <div className="grid2" style={{ marginTop: 12 }}>
        <div className="card" style={{ margin: 0 }}>
          <h2 className="row" style={{ gap: 8, marginTop: 0 }}><Play size={15} color="var(--amber)" /> Continue</h2>
          {last ? (
            <>
              <p className="small muted" style={{ marginTop: 0 }}>
                Last answer: <b>{last.sectionId.toUpperCase()}</b> · {KIND_BY_ID[last.kind].label} round ·{' '}
                {new Date(last.ts).toLocaleDateString()}
              </p>
              <Link className="btn small primary" to={`/interview-mode?subject=${last.subjectId}&type=${last.kind}`}>
                Continue from here <ArrowRight size={12} />
              </Link>
            </>
          ) : (
            <p className="small muted" style={{ margin: '0 0 8px' }}>
              No interview answer yet — pick a subject below and start your first round.
            </p>
          )}
        </div>
        <div className="card" style={{ margin: 0 }}>
          <h2 className="row" style={{ gap: 8, marginTop: 0 }}><Dice5 size={15} color="var(--violet)" /> Random interview</h2>
          <p className="small muted" style={{ marginTop: 0 }}>
            {manifest ? `Fresh questions from ${interviewQs} interview-eligible questions` : '…'} — unseen first,
            then weak topics, then review-due. No question repeats within a round.
          </p>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {SESSION_SIZES.map((n) => (
              <button
                key={n}
                className={`chip${n === randomSize ? ' on' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  if (n === 10) next.delete('size'); else next.set('size', String(n));
                  setParams(next);
                }}
              >
                {n === 1 ? '⚡ Quick' : `${n} Qs`}
              </button>
            ))}
          </div>
          <Link className="btn small primary" to={`/interview-mode?subject=${randomSubject}&type=${randomKind}&size=${randomSize}`}>
            Start {last ? 'a random round' : 'your first round'} <ArrowRight size={12} />
          </Link>
        </div>
      </div>

      {/* ---------- choose your interview ---------- */}
      <div className="sec-head"><h2>Choose your interview</h2><span className="line" /></div>
      <div className="tile-grid">
        {subjects.map((s, i) => {
          const d = TRACK_DEFS.find((x) => x.id === s.range.id)!;
          const Icon = d.icon;
          const on = selected?.id === s.range.id;
          const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : null;
          return (
            <Link key={s.range.id} to={`/interview-mode?subject=${s.range.id}`} className={`tile${on ? ' on' : ''}`}>
              <span className="ic"><Icon size={18} /></span>
              <span className="t" style={{ flex: 1, minWidth: 0 }}>
                <b>{t(d.nameKey as LocaleKey)} Interview</b>
                <span>
                  {manifest
                    ? `${s.total} questions · ${s.kinds.length} rounds${s.done > 0 ? ` · ${s.done} answered` : ''}`
                    : '…'}
                </span>
                {pct !== null && <span className="bar" style={{ marginTop: 6 }}><div style={{ width: `${pct}%` }} /></span>}
              </span>
            </Link>
          );
        })}
      </div>

      {subjectView && (
        <div className="card fadeup" style={{ marginTop: 12 }}>
          <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div>
              <b>{t(TRACK_DEFS.find((x) => x.id === subjectView.range.id)!.nameKey as LocaleKey)} — interview rounds</b>
              <div className="small muted">{subjectView.total} eligible questions · {subjectView.done} answered</div>
            </div>
            <Link className="btn small ghost" to="/interviews">All subjects</Link>
          </div>
          {subjectView.kinds.map((k) => {
            const meta = KIND_BY_ID[k.id];
            const done = kindProgress(state.attempts, subjectView.range, entries).find((x) => x.id === k.id);
            return (
              <div key={k.id} className="q-row">
                <span className="ic" aria-hidden>{meta.emoji}</span>
                <span className="t">
                  {meta.label}
                  <span className="small muted" style={{ display: 'block' }}>{meta.blurb}</span>
                </span>
                <span className="small muted">{done?.done ?? 0} / {k.count}</span>
                <Bar pct={k.count > 0 ? ((done?.done ?? 0) / k.count) * 100 : 0} />
                <Link className="btn small" to={`/interview-mode?subject=${subjectView.range.id}&type=${k.id}`}>
                  Open <ArrowRight size={12} />
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {/* ---------- progress across every kind ---------- */}
      <div className="sec-head"><h2>My interview progress</h2><span className="line" /></div>
      <div className="card">
        {globalKinds.map((k) => (
          <div key={k.id} style={{ margin: '9px 0' }}>
            <div className="row spread small">
              <span>{KIND_BY_ID[k.id].emoji} {KIND_BY_ID[k.id].label} <span className="muted">{k.done} answers recorded of {k.total}</span></span>
              <span>{k.pct}%</span>
            </div>
            <Bar pct={k.pct} />
          </div>
        ))}
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          Meter = interview-eligible questions with a saved answer (the same <b>qb:</b> records the
          Question Bank writes). Mini-project builds in coding rounds are tracked separately.
        </p>
      </div>

      {/* ---------- the other interview surfaces ---------- */}
      <div className="sec-head"><h2>All interview surfaces</h2><span className="line" /></div>
      <HubGrid routes={ROUTES} />

      <div className="sec-head"><h2>Interview question banks</h2><span className="line" /></div>
      <div className="tile-grid">
        <Link to="/questions?type=interview" className="tile">
          <span className="ic"><ListChecks size={18} /></span>
          <span className="t" style={{ flex: 1, minWidth: 0 }}>
            <b>Interview questions</b>
            <span>{manifest?.sections.reduce((a, s) => a + (s.byType.interview ?? 0), 0) ?? '…'} curated questions · every section</span>
          </span>
        </Link>
        <Link to="/playbook" className="tile">
          <span className="ic"><Archive size={18} /></span>
          <span className="t" style={{ flex: 1, minWidth: 0 }}>
            <b>Practice Archive</b>
            <span>{ctx.playbook ? `${ctx.playbook.interview} interview items` : '…'} · written-answer drills</span>
          </span>
        </Link>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Run rounds from here — or read method answers in the {ctx.playbook?.items ?? '…'} archive items.
      </p>
    </div>
  );
}
