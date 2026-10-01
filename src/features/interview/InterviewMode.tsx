import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, BookMarked, Bot, Brain, Briefcase, ChevronDown, Code2, Database, FileText, Layers,
  Server, Sparkles, type LucideIcon,
} from 'lucide-react';
import { useCurriculum } from '../../core/data/curriculum';
import { useStore, setState, addXp, addMistake, recordAttempt } from '../../core/storage/store';
import { keywordScore, questionRubric } from '../../core/assessment/evaluate';
import { labAttempt } from '../../core/platform/keys';
import { pctText } from '../../core/assessment/accuracy';
import { interviewLabsAnswered } from '../../core/learning/coverage';
import { ALL_CATS, catMatchesFilter, groupCategories, skillKey } from '../../core/assessment/interview';
import { AssistantCard } from '../../components/shared/AssistantCard';
import type { MockQuestion } from '../../types';

/**
 * A stable key for one interview question, so its percentage survives a reload.
 *
 * These questions come from the curriculum and the playbook rather than from a bank, so there is no
 * question id to hang an attempt on. A hash of the question TEXT is the honest equivalent: the same
 * question always lands on the same `lab:interview:<hash>` record, and nothing else can collide
 * with it (`lab:` is the family engine/keys.ts reserves for non-section labs).
 */
function qKey(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return labAttempt('interview', Math.abs(h));
}

interface Q { cat: string; q: string; a: string; source: string; book: string }

/** Section icons by the name the engine publishes — a component cannot live in `engine/*`. */
const SKILL_ICON: Record<string, LucideIcon> = { Code2, BarChart3, Database, Brain, Sparkles, Bot, Server, Briefcase, Layers };

/**
 * How each source is presented. The count is measured (`sources` below), never written here: the
 * bank grows, and "635" in a static string is how a number becomes a lie.
 */
const SOURCE_META: Record<string, { tone: string; icon: LucideIcon; label: string; sub: string }> = {
  [ALL_CATS]: { tone: 'cyan', icon: Layers, label: 'Sabhi sources', sub: 'Curriculum + Playbook dono' },
  'Curriculum PDF': { tone: 'blue', icon: FileText, label: 'Curriculum PDF', sub: 'Section-wise Q&A' },
  'Playbook V15': { tone: 'violet', icon: BookMarked, label: 'Playbook V15', sub: 'Chapter-wise Q&A' },
};

/**
 * The V15 playbook's own Q&A, read from the small derived view the import writes (the banks are
 * 11 MB, too much to load for one interview round).
 *
 * Only items with a real model answer enter the keyword-graded pool: the document's checkpoint and
 * production-scenario prompts carry its METHOD line instead of an answer, and scoring those against
 * a rubric built from "answer verbally first…" would be noise. They are counted and pointed at
 * their section's stage instead of silently disappearing.
 */
function usePlaybookQA(): { items: Q[]; methodOnly: number } {
  const [pack, setPack] = useState<{ items: { type: string; question: string; answer: string; chapter: string; sectionTitle: string; selfGrade: boolean }[] } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('./generated/playbook/items.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setPack(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return useMemo(() => {
    const rows = (pack?.items ?? []).filter((it) => ['interview', 'defense', 'theory'].includes(it.type));
    const gradable = rows.filter((it) => !it.selfGrade);
    return {
      methodOnly: rows.length - gradable.length,
      items: gradable.map((it) => ({
        cat: it.sectionTitle,
        q: it.question,
        a: it.answer,
        source: `playbook ch.${it.chapter}`,
        book: 'Playbook V15',
      })),
    };
  }, [pack]);
}

export default function InterviewMode() {
  const { sections, extras } = useCurriculum();
  const state = useStore();
  const [catFilter, setCatFilter] = useState<string>(ALL_CATS);
  const [bookFilter, setBookFilter] = useState<string>(ALL_CATS);
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState<{ pct: number; missing: string[] } | null>(null);
  /** The skills panel starts open — it is the map of what can be practised — and folds on demand. */
  const [showSkills, setShowSkills] = useState(true);
  /** This sitting's percentages — the running accuracy figure, kept in the page (not invented). */
  const [history, setHistory] = useState<number[]>([]);
  const playbook = usePlaybookQA();

  const all: Q[] = useMemo(() => {
    const out: Q[] = [];
    sections.forEach((s) => s.interview.forEach((q) => out.push({ cat: s.title, q: q.q, a: q.a, source: `s${s.no}·p${s.pages.interview[0] ?? ''}`, book: 'Curriculum PDF' })));
    extras.mockInterview.forEach((r) => r.questions.forEach((q) => out.push({ cat: q.cat, q: q.q, a: q.a, source: 'Final Mock', book: 'Curriculum PDF' })));
    extras.intensive.forEach((q) => out.push({ cat: q.cat, q: q.q, a: q.a, source: 'Intensive', book: 'Curriculum PDF' }));
    out.push(...playbook.items);
    return out;
  }, [sections, extras, playbook.items]);

  // Two independent filters: which SOURCE BOOK the question came from, and which skill inside it.
  const books = [ALL_CATS, ...Array.from(new Set(all.map((x) => x.book)))];
  const playbookCount = all.filter((x) => x.book === 'Playbook V15').length;
  const sources = books.map((b) => {
    const meta = SOURCE_META[b] ?? { tone: 'cyan', icon: Layers, label: b, sub: 'Source' };
    const n = b === ALL_CATS ? all.length : all.filter((x) => x.book === b).length;
    return { key: b, ...meta, n, title: b === 'Playbook V15' ? 'Doosre source (V15) ka Q&A bank' : undefined };
  });

  /* The categories are read from the SELECTED source, so choosing the Playbook drops the Python
     sections it does not cover instead of leaving 45 buttons that mostly filter to nothing. */
  const inBook = useMemo(() => (bookFilter === ALL_CATS ? all : all.filter((x) => x.book === bookFilter)), [all, bookFilter]);
  const skillSections = useMemo(() => {
    const counts = new Map<string, number>();
    inBook.forEach((x) => counts.set(x.cat, (counts.get(x.cat) ?? 0) + 1));
    return groupCategories([...counts].map(([name, count]) => ({ name, count })));
  }, [inBook]);
  // Memoised against the two filters (not the answer draft): 635 questions × 8 regexes per keystroke
  // is exactly the kind of work a textarea does not need to trigger.
  const pool = useMemo(() => inBook.filter((x) => catMatchesFilter(catFilter, x.cat)), [inBook, catFilter]);
  const q = pool[idx % Math.max(1, pool.length)];
  /**
   * Answers already on record, per category — the figure behind each skill's "recorded" meter.
   * It is the SAME attempt key the round writes (`lab:interview:<hash of the question text>`), so
   * the meter can only ever move when a real answer is saved, never from opening the page.
   */
  const answeredByCat = useMemo(() => {
    const out = new Map<string, number>();
    for (const x of all) {
      if (!state.attempts[qKey(x.q)]) continue;
      out.set(x.cat, (out.get(x.cat) ?? 0) + 1);
    }
    return out;
  }, [all, state.attempts]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); next(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); next(-1); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  if (!q) return <div className="card muted">No questions.</div>;

  const grade = () => {
    const kws = questionRubric(q.a);
    const g = keywordScore(answer, kws);
    const prev = state.attempts[qKey(q.q)];
    setGraded(g);
    setHistory((h) => [...h, g.pct]);
    // Stored, so the percentage is still there when the learner comes back to this question — and
    // so the Progress page and the offline assistant can report real interview accuracy instead of
    // a number that vanishes with the page.
    recordAttempt(qKey(q.q), { done: g.pct >= 70, score: g.pct, answer, tries: (prev?.tries ?? 0) + 1 });
    if (g.pct >= 70) addXp(8, 'interview', 'Interview answer');
    else addMistake({ section: 'interview-mode', topic: q.cat, question: q.q, myAnswer: answer, correct: q.a, type: 'interview', source: 'interview' });
  };

  const sessionPct = history.length ? Math.round(history.reduce((a, b) => a + b, 0) / history.length) : null;
  const lastAttempt = q ? state.attempts[qKey(q.q)] : undefined;
  const answered = interviewLabsAnswered(state.attempts);

  const next = (d: number) => { setIdx((i) => (i + d + pool.length) % pool.length); setAnswer(''); setRevealed(false); setGraded(null); };
  /** A filter change starts a fresh round: the index, the draft answer and the grade belong to the old pool. */
  const resetRound = () => { setIdx(0); setAnswer(''); setRevealed(false); setGraded(null); };
  const pickCat = (value: string) => { setCatFilter(value); resetRound(); };
  const pickBook = (b: string) => {
    // A skill can exist in one source and not the other. Switching to a source that has none of the
    // selected label would empty the pool and park the page on "No questions.", so the category
    // filter is cleared first — visible, and recoverable in one click.
    if (catFilter !== ALL_CATS && !(b === ALL_CATS ? all : all.filter((x) => x.book === b)).some((x) => catMatchesFilter(catFilter, x.cat))) {
      setCatFilter(ALL_CATS);
    }
    setBookFilter(b);
    resetRound();
  };

  return (
    <div>
      <h1>🎤 Interview Mode</h1>
      <p className="muted small">
        {all.length - playbookCount} questions from the curriculum PDF + {playbookCount} from the V15 Playbook.
        Arrow keys navigate. Speak the answer first, then reveal.
      </p>

      {/* Sources: one lit tile each, its own tone and icon, and the count it actually holds. */}
      <div className="im-src-row">
        {sources.map((s) => {
          const on = bookFilter === s.key;
          const Ic = s.icon;
          return (
            <button
              key={s.key}
              type="button"
              className={`im-src tone-${s.tone}${on ? ' on' : ''}`}
              aria-pressed={on}
              title={s.title}
              onClick={() => pickBook(s.key)}
            >
              <span className="im-src-ic"><Ic size={17} /></span>
              <span className="im-src-txt">
                <span className="im-src-label">{s.label}</span>
                <span className="im-src-sub">{s.sub}</span>
              </span>
              <span className="im-src-n">{s.n}</span>
            </button>
          );
        })}
      </div>
      {playbook.methodOnly > 0 && (
        <p className="small muted" style={{ margin: '0 0 6px' }}>
          Playbook ke {playbook.methodOnly} checkpoint/scenario prompts ke paas model answer ki jagah document ka method hai —
          wo rubric se grade nahi hote, unhe apne section ke Checkpoint stage me bolo.
        </p>
      )}

      {/* One ROW per skill, in the learning path's order, on the roadmap's own rail.

          The flat alphabet of 45 pills this replaces said nothing about which of them belonged
          together; the eight-card grid that replaced it said it, but paid for it with space — the
          grid stretched every row to its tallest card, so the four skills beside Python's
          17 topics each carried a quarter-page of empty card, and the last row left a hole. A row
          per skill flows the topics across the full width (4-6 per line instead of one) and makes
          the learning ORDER visible instead of implied. The header filters the whole skill at
          once; a pill narrows to one topic. */}
      <div className="im-filter-head">
        {/* The panel is a tool, and the question is the page: the toggle folds the filter list away
            when what you want is the question at the top. It starts OPEN, because the sequence is
            also the map of what can be practised. */}
        <button
          type="button"
          className="im-filter-toggle"
          aria-expanded={showSkills}
          onClick={() => setShowSkills((v) => !v)}
        >
          <ChevronDown size={14} className={showSkills ? 'open' : ''} />
          <span className="im-filter-title">Skills</span>
        </button>
        <span className="im-filter-span">
          {skillSections.length} sections · {catFilter === ALL_CATS ? inBook.length : `${pool.length} of ${inBook.length}`} questions
        </span>
        {catFilter !== ALL_CATS && (
          <span className="chip">
            {catFilter.startsWith('#') ? (skillSections.find((g) => skillKey(g.id) === catFilter)?.label ?? catFilter) : catFilter}
          </span>
        )}
        <button
          type="button"
          className={`im-clear${catFilter === ALL_CATS ? ' on' : ''}`}
          aria-pressed={catFilter === ALL_CATS}
          onClick={() => pickCat(ALL_CATS)}
        >
          <Layers size={12} /> ALL
        </button>
      </div>
      {showSkills && (<div className="im-skills">
        {skillSections.map((g, gi) => {
          const Ic = SKILL_ICON[g.icon] ?? Layers;
          const whole = catFilter === skillKey(g.id);
          const share = inBook.length ? (g.count / inBook.length) * 100 : 0;
          const done = g.cats.reduce((a, c) => a + (answeredByCat.get(c.name) ?? 0), 0);
          const last = gi === skillSections.length - 1;
          return (
            <div key={g.id} className={`rmap-step tone-${g.tone}${whole ? ' now' : ''}`}>
              {/* The rail is the sequence: a numbered node per skill, and an arrowhead into the
                  next one, so "Python, then NumPy, then SQL" is the layout and not a guess. */}
              <div className="rmap-rail" aria-hidden="true">
                <span className="rmap-dot">{String(gi + 1).padStart(2, '0')}</span>
                {!last && <span className="rmap-line" />}
                {!last && <span className="rmap-arrow"><ChevronDown size={12} /></span>}
              </div>

              <section className={`im-skill${whole ? ' on' : ''}`}>
                {/* Identity and the two figures share ONE band: the meters are the width the header
                    was not using, and a band per row keeps the eight rows scannable. */}
                <div className="im-skill-top">
                  <button
                    type="button"
                    className="im-skill-head"
                    aria-pressed={whole}
                    title={`${g.hint} — poora skill practice karo`}
                    onClick={() => pickCat(whole ? ALL_CATS : skillKey(g.id))}
                  >
                    <span className="im-skill-ic"><Ic size={15} /></span>
                    <span className="im-skill-txt">
                      <span className="im-skill-name">{g.label}</span>
                      <span className="im-skill-hint">{g.hint}</span>
                    </span>
                    <span className="im-skill-n">{g.count} Q</span>
                  </button>

                  <div className="im-skill-meta">
                    <span className="im-meter">
                      <span className="im-meter-l">
                        {Math.round(share)}% of {inBook.length} questions · {g.cats.length} topics
                      </span>
                      <span className="im-meter-bar"><i style={{ width: `${share}%` }} /></span>
                    </span>
                    <span className="im-meter m-done">
                      <span className="im-meter-l">
                        {done} / {g.count} answers recorded
                      </span>
                      <span className="im-meter-bar"><i style={{ width: `${(done / Math.max(1, g.count)) * 100}%` }} /></span>
                    </span>
                  </div>
                </div>

                <div className="im-cats">
                  {g.cats.map((c) => {
                    const on = catFilter === c.name;
                    return (
                      <button
                        key={c.name}
                        type="button"
                        className={`im-cat${on ? ' on' : ''}`}
                        aria-pressed={on}
                        title={`${c.name} · ${c.count} question${c.count === 1 ? '' : 's'}`}
                        onClick={() => pickCat(on ? ALL_CATS : c.name)}
                      >
                        {c.name}
                        <span className="im-cat-n">{c.count}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          );
        })}
      </div>)}

      <div className="card">
        <div className="row spread">
          <span className="small muted">{q.cat} · {q.source} · #{idx + 1}/{pool.length}</span>
          <div className="row">
            {/* The percentage of the last answer to THIS question, and of this sitting. Both are
                measured; neither is shown when nothing was answered yet. */}
            {lastAttempt && (
              <span className={`chip ${lastAttempt.done ? 'easy' : 'hard'}`} title="Pichhli baar is question par kitna sahi">
                pichhla: {pctText(lastAttempt.score ?? null)}
              </span>
            )}
            <span className="chip" title="Is sitting me kitne answers, aur unka average">
              {history.length} answers · avg {pctText(sessionPct)}
            </span>
            <button className="btn small" onClick={() => next(-1)} aria-label="Previous">←</button>
            <button className="btn small" onClick={() => next(1)} aria-label="Next">→</button>
          </div>
        </div>
        {(history.length > 0 || answered > 0) && (
          <div className="row spread small muted" style={{ marginTop: 6 }}>
            <span>Is sitting ki accuracy: <b>{pctText(sessionPct)}</b></span>
            <span>Total interview answers saved: {answered}</span>
          </div>
        )}
        {history.length > 0 && <div className="bar" style={{ marginTop: 4 }}><div style={{ width: `${sessionPct ?? 0}%` }} /></div>}
        <h2 style={{ margin: '10px 0' }}>{q.q}</h2>
        <textarea className="console" rows={4} placeholder="Answer aloud, or type here…" value={answer} onChange={(e) => setAnswer(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={() => setRevealed(!revealed)}>{revealed ? 'Hide' : 'Reveal model answer'}</button>
          <button className="btn primary" onClick={grade} disabled={!answer.trim()}>Check</button>
        </div>
        {graded && (
          <div className="card fadeup" style={{ marginTop: 10, borderColor: graded.pct >= 70 ? 'rgba(52,211,153,.5)' : 'rgba(248,113,113,.5)' }}>
            <b>{graded.pct >= 70 ? '✅' : '⚠️'} Keyword rubric: {graded.pct}%</b>
            {graded.missing.length > 0 && <p className="small muted">Missing: {graded.missing.join(', ')}</p>}
          </div>
        )}
        {revealed && (
          <div className="fadeup" style={{ marginTop: 10 }}>
            <b className="small">MODEL ANSWER:</b>
            <p className="small">{q.a}</p>
            <p className="small muted">Structure: definition → tiny example → practical use → edge case.</p>
          </div>
        )}

        {/* The assistant, scoped to this question: its answer, an escalating hint about THIS item,
            and the rubric percentage of what was typed above. */}
        <div style={{ marginTop: 10 }}>
          <AssistantCard
            compact
            embedded
            context={{
              where: `${q.cat} · ${q.source}`,
              question: { text: q.q, model: q.a, mine: answer, type: 'interview', source: `${q.book} · ${q.source}` },
            }}
          />
        </div>
      </div>
    </div>
  );
}
