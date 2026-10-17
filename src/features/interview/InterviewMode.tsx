import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronLeft, Dice5, RefreshCw } from 'lucide-react';
import { HubCrumb } from '../../components/learning/SectionChrome';
import { useI18n } from '../../app/i18n';
import type { LocaleKey } from '../../app/i18n/locales';
import { TRACK_DEFS } from '../../app/App';
import { useStore, setState, addXp, addMistake, recordAttempt } from '../../core/storage/store';
import { useBankManifest, useBank, TYPE_LABEL } from '../../core/data/questions';
import type { BankManifestEntry } from '../../core/data/questions';
import { bankAttempt } from '../../core/platform/keys';
import { bankTouched } from '../../core/learning/coverage';
import { keywordScore, questionRubric } from '../../core/assessment/evaluate';
import {
  INTERVIEW_KINDS, KIND_BY_ID, eligibleInBank, kindCounts, kindOf, lastInterviewTouch,
  pickQuestion, planSections, SESSION_SIZES,
} from '../../core/assessment/interview-room';
import type { SubjectRange } from '../../core/learning/subjects';
import type { QuestionRecord, Difficulty } from '../../core/data/schema';
import { Bar } from '../../components/ui/ui';

/**
 * The interview room: pick a subject, pick a round, answer real questions.
 *
 * NOT a second question bank, and that is the whole design. The pool is the canonical bank's own
 * records — the same `sNN:type:i` ids the Question Bank writes its `qb:` attempt under — filtered
 * to the interview-eligible types by `core/assessment/interview-room.ts`. An answer saved here and
 * an answer saved on /questions are the SAME record, so progress is shared, never duplicated.
 *
 * The sitting walks one section per step (banks are 400 KB each: the room loads ONE at a time and
 * never the whole pack), and the question inside it is chosen by the recovery ladder in the engine
 * — unseen first, then weak topics, then review-due — with the ids already shown in this sitting
 * excluded, so "next question" can never repeat within a round.
 */
const DIFFS: (Difficulty | 'all')[] = ['all', 'easy', 'medium', 'hard', 'expert'];

const pctText = (p: number | null) => (p === null ? '—' : `${p}%`);

export default function InterviewMode() {
  const { t } = useI18n();
  const state = useStore();
  const manifest = useBankManifest();
  const [params, setParams] = useSearchParams();

  const ranges: SubjectRange[] = useMemo(() => TRACK_DEFS.map((d) => ({ id: d.id, from: d.from, to: d.to })), []);
  const trackDef = TRACK_DEFS.find((d) => d.id === params.get('subject')) ?? null;
  const range = trackDef ? ranges.find((r) => r.id === trackDef.id) ?? null : null;
  const kindParam = params.get('type');
  const kind = INTERVIEW_KINDS.find((k) => k.id === kindParam) ?? null;
  const size = SESSION_SIZES.includes(Number(params.get('size')) as (typeof SESSION_SIZES)[number])
    ? Number(params.get('size'))
    : 5;
  const diff = (DIFFS.includes(params.get('difficulty') as Difficulty) ? params.get('difficulty') : 'all') as Difficulty | 'all';
  const pinned = params.get('section');

  /** The sitting: an ordered section list, decided once when the round starts (rng in the engine). */
  const [nonce, setNonce] = useState(0);
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState<string[]>([]);
  const [written, setWritten] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [asked, setAsked] = useState(0);
  const [right, setRight] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);

  const entries: BankManifestEntry[] = manifest?.sections ?? [];
  /**
   * The sitting: one section per step, weighted by how many questions it holds. `nonce` is the
   * deliberate re-roll — a new sitting under the same filters. One bank is loaded per step
   * (`useBank` below), never the whole 11 MB pack.
   */
  const plan = useMemo(() => {
    if (!range || !kind) return [] as BankManifestEntry[];
    const ids = pinned && entries.some((e) => e.sectionId === pinned)
      ? [pinned]
      : planSections(range, entries, kind.id, size);
    return ids.map((sid) => entries.find((e) => e.sectionId === sid)).filter((e): e is BankManifestEntry => !!e);
  }, [range, kind, size, pinned, entries, nonce]);

  /** A step only exists inside the plan — after the last one the round is over, not a repeat. */
  const inRound = step < plan.length;
  const current = inRound ? plan[step] : null;
  const bank = useBank(current?.sectionId);
  const weak = useMemo(() => new Set(state.mistakes.filter((m) => !m.fixed).map((m) => m.section)), [state.mistakes]);

  /** The questions this step may ask: eligible kind + difficulty, from the loaded canonical bank. */
  const pool: QuestionRecord[] = useMemo(() => {
    if (!bank || !kind) return [];
    return eligibleInBank(bank).filter((q) => kind.id === kindOf(q) && (diff === 'all' || q.difficulty === diff));
  }, [bank, kind, diff]);

  const q = useMemo(() => {
    if (!inRound || !pool.length) return null;
    const byId = new Map(pool.map((x) => [x.id, x]));
    const id = pickQuestion(pool, state.attempts, { weak, avoid: new Set(shown) });
    return id ? byId.get(id) ?? pool[0] : pool[0];
  }, [inRound, pool, state.attempts, weak, shown]);

  const doneCount = q ? bankTouched(state.attempts, q.id) : false;
  const last = lastInterviewTouch(state.attempts);

  /** The self-grade — the Question Bank's own convention, under the SAME canonical id. */
  const grade = (correct: boolean) => {
    if (!q) return;
    const prev = state.attempts[bankAttempt(q.id)];
    const r = written.trim() ? keywordScore(written, questionRubric(q.answer)) : null;
    recordAttempt(bankAttempt(q.id), {
      done: correct,
      tries: (prev?.tries ?? 0) + 1,
      answer: written,
      score: r ? r.pct : (correct ? 100 : 0),
    });
    if (correct) addXp(10, 'interview', 'Interview round');
    else {
      addMistake({
        section: q.sectionId,
        topic: (q.tags ?? [])[0] ?? TYPE_LABEL[q.type] ?? q.type,
        question: q.question.slice(0, 140),
        myAnswer: written.trim() ? written.slice(0, 220) : '(self-grade: marked wrong with no answer)',
        correct: q.answer.slice(0, 220),
        type: 'interview',
        source: 'interview',
      });
      setState((s) => ({ ...s, review: { ...s.review, [q.sectionId]: { level: 0, last: new Date().toISOString() } } }));
      setFailed((f) => [...f, `${q.sectionId} · ${q.question.slice(0, 70)}`]);
    }
    setAsked((n) => n + 1);
    if (correct) setRight((n) => n + 1);
    setShown((ids) => [...ids, q.id]);
    setWritten('');
    setRevealed(false);
    setStep((n) => n + 1);
  };

  const reroll = () => {
    setNonce((n) => n + 1);
    setStep(0);
    setShown([]);
    setAsked(0);
    setRight(0);
    setFailed([]);
    setWritten('');
    setRevealed(false);
  };
  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null ? next.delete(k) : next.set(k, v));
    setParams(next);
    reroll();
  };

  /* ---------------------------------- pickers ---------------------------------- */

  if (!range || !kind || !trackDef) {
    return (
      <div>
        <HubCrumb hub="/interviews" hubLabel="Interview" page="Interview Room" />
        <h1>🎤 Interview Room</h1>
        <p className="muted small">Pick a subject — then start any of its rounds.</p>
        <div className="tile-grid">
          {TRACK_DEFS.map((d) => {
            const r = ranges.find((x) => x.id === d.id)!;
            const inv = entries.filter((e) => e.no >= r.from && e.no <= r.to);
            const total = inv.reduce((a, e) => a + INTERVIEW_KINDS.reduce((b, k) => b + kindCounts(e)[k.id], 0), 0);
            const Icon = d.icon;
            return (
              <Link key={d.id} to={`/interview-mode?subject=${d.id}`} className="tile">
                <span className="ic"><Icon size={18} /></span>
                <span className="t" style={{ flex: 1, minWidth: 0 }}>
                  <b>{t(d.nameKey as LocaleKey)}</b>
                  <span>            {manifest ? `${total} interview questions` : '…'}
                </span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  const inv = entries.filter((e) => e.no >= range.from && e.no <= range.to);
  const kindsWithData = INTERVIEW_KINDS.filter((k) => inv.some((e) => kindCounts(e)[k.id] > 0));
  const sectionChips = inv
    .map((e) => ({ e, n: kindCounts(e)[kind.id] }))
    .filter((x) => x.n > 0);

  const answered = asked > 0 && step >= plan.length;
  const sessionPct = asked ? Math.round((right / asked) * 100) : null;

  return (
    <div>
      <HubCrumb hub="/interviews" hubLabel="Interview" page="Interview Room" />
      <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div style={{ minWidth: 240 }}>
          {/* The page has ONE h1 (the picker above); the round's title is a heading, not the page. */}
          <h2 style={{ margin: 0 }}>{kind.emoji} {t(trackDef.nameKey as LocaleKey)} — {kind.label} Interview</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {kind.blurb} · {sectionChips.reduce((a, x) => a + x.n, 0)} questions in this subject.
          </p>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="chip">{asked}/{plan.length || size} in this sitting</span>
          {sessionPct !== null && <span className={`chip ${sessionPct >= 70 ? 'easy' : 'hard'}`}>{sessionPct}% correct</span>}
          <button className="btn small" onClick={reroll}><RefreshCw size={12} /> New round</button>
          {last && (
            <Link className="btn small ghost" to={`/interview-mode?subject=${trackDef.id}&type=${last.kind}`}>
              Continue: {KIND_BY_ID[last.kind].label} <ArrowRight size={12} />
            </Link>
          )}
        </div>
      </div>

      {/* The round + the filters. Every switch starts a fresh sitting (the plan and the drafts
          belong to the old one), exactly like changing a bank filter resets its round. */}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
        {kindsWithData.map((k) => (
          <button key={k.id} className={`tabbtn ${k.id === kind.id ? 'active' : ''}`} onClick={() => setParam({ type: k.id, section: null })}>
            {k.emoji} {k.label} ({inv.reduce((a, e) => a + kindCounts(e)[k.id], 0)})
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {DIFFS.map((d) => (
          <button key={d} className={`chip${d === diff ? ' on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setParam({ difficulty: d === 'all' ? null : d })}>
            {d === 'all' ? 'All levels' : d}
          </button>
        ))}
        {SESSION_SIZES.map((n) => (
          <button key={n} className={`chip${n === size ? ' on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setParam({ size: String(n) })}>
            {n === 1 ? '⚡ Quick' : `${n} Qs`}
          </button>
        ))}
      </div>
      {/* Topic pin — the subject's own sections, only the ones this round has questions in. */}
      <details style={{ marginBottom: 10 }}>
        <summary className="small muted" style={{ cursor: 'pointer' }}>Topic pin: {pinned ? sectionChips.find((x) => x.e.sectionId === pinned)?.e.title ?? pinned : 'whole subject'}</summary>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <button className={`chip${!pinned ? ' on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setParam({ section: null })}>Whole subject</button>
          {sectionChips.map(({ e, n }) => (
            <button key={e.sectionId} className={`chip${pinned === e.sectionId ? ' on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setParam({ section: e.sectionId })}>
              {e.sectionId.toUpperCase()} · {e.title} · {n}
            </button>
          ))}
        </div>
      </details>

      {/* ---------- the question ---------- */}
      {answered && !q && (
        <div className="card">
          <h2>✅ Round complete</h2>
          <p className="small muted">{asked} answers · {right} correct · {pctText(sessionPct)} — all saved under <b>qb:</b> records, the same ones the Question Bank writes.</p>
          {failed.length > 0 && (
            <>
              <b className="small">Weak areas in this round:</b>
              <ul className="small muted" style={{ margin: '4px 0 8px 18px' }}>{failed.map((f, i) => <li key={i}>{f}</li>)}</ul>
              <Link className="btn small primary" to="/mistakes">Fix them in the Mistake Tracker <ArrowRight size={12} /></Link>
            </>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small" onClick={reroll}><Dice5 size={12} /> New round (fresh questions)</button>
            <Link className="btn small ghost" to={`/interview-mode?subject=${trackDef.id}`}>Another round <ChevronLeft size={12} /></Link>
          </div>
        </div>
      )}

      {!q && !answered && (
        <div className="card muted small">
          {bank === null ? 'Loading bank…' : 'No question matched this filter in this round — pick another type or level.'}
        </div>
      )}

      {q && !answered && (
        <div className="card">
          <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className="small muted">
              {current?.sectionId.toUpperCase()} · {current?.title} · {TYPE_LABEL[q.type]} · {q.difficulty}
            </span>
            <div className="row" style={{ gap: 6 }}>
              {doneCount && <span className="chip easy">answered before</span>}
              <span className="chip">{step + 1} / {plan.length}</span>
            </div>
          </div>
          <h2 style={{ margin: '10px 0' }}>{q.question}</h2>
          {q.type === 'coding' || q.type === 'debug' ? (
            <>
              <p className="small muted" style={{ marginTop: 0 }}>
                Writing code? Do it in the <Link to="/playground">Playground</Link> (or right here), then compare with the answer key.
              </p>
              <textarea className="console" rows={6} placeholder="Write your code / approach here…" value={written} onChange={(e) => setWritten(e.target.value)} />
            </>
          ) : (
            <textarea
              className="console"
              rows={4}
              placeholder="Say it out loud first, then write it here…"
              value={written}
              onChange={(e) => setWritten(e.target.value)}
            />
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => setRevealed((v) => !v)}>{revealed ? 'Hide' : 'Show model answer'}</button>
          </div>
          {revealed && (
            <div className="fadeup" style={{ marginTop: 10 }}>
              <b className="small">MODEL ANSWER:</b>
              <p className="small">{q.answer}</p>
              {q.explanation && <p className="small muted">{q.explanation}</p>}
            </div>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <span className="small muted">Grade your answer:</span>
            <button className="btn small primary" onClick={() => grade(true)}>✅ Correct</button>
            <button className="btn small" onClick={() => grade(false)}>❌ Wrong</button>
          </div>
          <Bar pct={plan.length ? ((step + 1) / plan.length) * 100 : 0} />
        </div>
      )}
    </div>
  );
}
