import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, ListChecks, NotebookPen, Check, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';
import { useBank, stageQuestions, stageOwnTexts, STAGE_QNA, STAGE_PAGE_SIZE, TYPE_LABEL, isAuthored } from '../../core/data/questions';
import type { QuestionRecord } from '../../core/data/schema';
import type { Attempt, Section } from '../../types';
import { useStore, setState, addXp, addMistake, recordAttempt, useSavedAnswer } from '../../core/storage/store';
import { bankAttempt, codeSlot } from '../../core/platform/keys';
import { attemptPct, isAnswer, pctText, rubricFor, tally } from '../../core/assessment/accuracy';
import { JupyterNotebook } from '../code/JupyterNotebook';
import { AssistantCard } from '../shared/AssistantCard';

const XP_PER_CORRECT = 2;

/**
 * The answers that ARE code. Only these get a practice notebook: for a theory or interview
 * question the notebook would be a distraction, and mounting one per row is the difference
 * between a light page and a page that ships a Python kernel per question.
 */
const CODE_TYPES = new Set(['coding', 'solved', 'debug']);

/**
 * The section's question bank, filtered to the stage this panel is mounted in.
 *
 * Why it lives inside the stage: the PDF's per-stage Q&A is the actual practice material for
 * that stage (LEARN → theory, INTERVIEW → interview, CODING LAB → coding, …), and asking a
 * learner to leave the lesson and hunt through a separate page to use it defeats the point.
 *
 * It writes the SAME state the Question Bank writes — `bankAttempt(<question id>)` — so a
 * question graded here is graded everywhere, and no progress is counted twice or lost. It
 * deliberately does NOT touch the stage gates: mastery thresholds are unchanged.
 */
export function StageQnA({ section, stage }: { section: Section; stage: string }) {
  const spec = STAGE_QNA[stage];
  const bank = useBank(section.id);
  const state = useStore();
  const [shown, setShown] = useState(STAGE_PAGE_SIZE);
  const [onlyPlaybook, setOnlyPlaybook] = useState(false);
  /** Per-item "Check answer" state, and the id whose box should take focus after a nav click. */
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [focusId, setFocusId] = useState<string | null>(null);

  const sectionId = section.id;
  // The questions this stage renders itself (its own extracted Q&A) — shown by the stage above,
  // so the panel below must not ask them a second time.
  const owns = useMemo(() => stageOwnTexts(stage, section), [stage, section]);
  const items = useMemo(() => stageQuestions(bank, stage, owns), [bank, stage, owns]);
  const attemptOf = (id: string) => state.attempts[bankAttempt(id)];

  const graded = useMemo(
    () => items.filter((q) => attemptOf(q.id)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, state.attempts],
  );
  /**
   * Real correctness of THIS stage's answers, never estimated.
   *
   * Scoped to the stage's own items, not the section: the sentence it feeds reads "tumne 3/123
   * grade kiye · answer accuracy X%", and a section-wide figure sitting next to a stage-wide
   * denominator told two different stories — measured live on `/lesson/s19/interview`, it printed
   * "tumne 0/123 grade kiye · answer accuracy 100% (1/1 sahi)", because one `s19` theory answer was
   * graded elsewhere. Here the percentage is over exactly the answers counted beside it.
   */
  const acc = useMemo(
    () => tally(items.map((q) => attemptOf(q.id)).filter((a): a is Attempt => !!a)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, state.attempts],
  );
  const mustKnow = useMemo(() => items.filter((q) => (q.tags ?? []).includes('MUST-KNOW')).length, [items]);
  // The V15 playbook's items were APPENDED to their type, so in a long stage (s28's Coding Lab has
  // 63) its 12 labs sit on the last page. The tag is the document's own provenance, so this toggle
  // can put exactly that set first without reordering anybody's bank.
  const playbookCount = useMemo(() => items.filter((q) => (q.tags ?? []).includes('playbook')).length, [items]);
  const pool = useMemo(
    () => (onlyPlaybook ? items.filter((q) => (q.tags ?? []).includes('playbook')) : items),
    [items, onlyPlaybook],
  );

  if (!spec) return null;
  if (bank && !items.length) return null;          // no bank content for this stage — stay quiet
  if (!bank) {
    return (
      <div className="card" style={{ marginTop: 12 }}>
        <b className="small">📚 {spec.label} — loading the question bank…</b>
      </div>
    );
  }

  /**
   * Self-grade one item. Identical semantics to the Question Bank, so the two cannot drift.
   * `written` is the learner's own answer, saved with the grade — it is what the mistake tracker
   * records, so a review later shows what was actually written instead of a placeholder.
   */
  const grade = (q: QuestionRecord, correct: boolean, written: string) => {
    const prev = state.attempts[bankAttempt(q.id)];
    // The percentage that is stored is the MEASURED one: the keyword rubric of what the learner
    // wrote against the model answer, or 100/0 when they wrote nothing and self-graded. `done`
    // stays the mastery gate — the two never overwrite each other's meaning.
    const r = rubricFor(written, q.answer);
    recordAttempt(bankAttempt(q.id), {
      done: correct,
      tries: (prev?.tries ?? 0) + 1,
      answer: written,
      score: r ? r.pct : (correct ? 100 : 0),
    });
    if (correct) {
      if (!prev?.done) addXp(XP_PER_CORRECT, 'practice', 'Stage Q&A self-grade');
      return;
    }
    addMistake({
      section: q.sectionId,
      topic: (q.tags ?? [])[0] ?? spec.label,
      question: q.question.slice(0, 140),
      myAnswer: written.trim() ? written.slice(0, 220) : '(stage Q&A: graded without a written answer)',
      correct: q.answer.slice(0, 220),
      type: q.type === 'debug' ? 'debug' : q.type === 'logic' ? 'logic' : q.type === 'coding' || q.type === 'solved' ? 'code' : 'interview',
      source: 'bank',
    });
    setState((s) => ({ ...s, review: { ...s.review, [q.sectionId]: { level: 0, last: new Date().toISOString() } } }));
  };

  const visible = pool.slice(0, shown);

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row spread">
        <h3 className="row" style={{ gap: 8, margin: 0 }}>
          <ListChecks size={16} /> {spec.label} — Q&A
        </h3>
        <span className="row" style={{ gap: 6 }}>
          {playbookCount > 0 && (
            <button
              className={`btn small ${onlyPlaybook ? 'primary' : ''}`}
              aria-pressed={onlyPlaybook}
              title="Items from Playbook V15 (the second source), taken from the document's own `playbook` tag"
              onClick={() => { setOnlyPlaybook((v) => !v); setShown(STAGE_PAGE_SIZE); }}
            >
              {onlyPlaybook ? '📘 Clear Playbook filter' : `📘 Playbook only (${playbookCount})`}
            </button>
          )}
          <Link className="btn small" to={`/questions?section=${sectionId}&playbook=1`}>Full bank <ListChecks size={12} /></Link>
        </span>
      </div>

      <p className="muted small" style={{ margin: '6px 0 0' }}>
        <b>{items.length}</b> questions for this stage
        {mustKnow > 0 && <> · <b>{mustKnow}</b> MUST-KNOW highlighted</>}
        {onlyPlaybook && <> · playbook filter: showing <b>{pool.length}</b></>}
        {' · '}you have graded {graded}/{items.length} · answer accuracy <b>{pctText(acc.pct)}</b> ({acc.correct}/{acc.graded} correct).
        Write your answer — it is saved — then reveal and grade yourself.
      </p>

      <div style={{ marginTop: 10 }}>
        {visible.map((q, i) => (
          <BankItem
            key={q.id}
            q={q}
            sectionId={sectionId}
            attempt={attemptOf(q.id)}
            onGrade={grade}
            checked={!!checked[q.id]}
            onCheck={() => setChecked((c) => ({ ...c, [q.id]: !c[q.id] }))}
            focused={focusId === q.id}
            index={i}
            total={visible.length}
            onNav={(dir) => { const next = visible[i + dir]; if (next) setFocusId(next.id); }}
          />
        ))}
      </div>

      {pool.length > shown && (
        <button className="btn small" onClick={() => setShown((n) => n + STAGE_PAGE_SIZE)}>
          Show more ({pool.length - shown} left)
        </button>
      )}
      {pool.length > STAGE_PAGE_SIZE && shown > STAGE_PAGE_SIZE && (
        <button className="btn small" style={{ marginLeft: 8 }} onClick={() => setShown(STAGE_PAGE_SIZE)}>
          Kam dikhao
        </button>
      )}
    </div>
  );
}

/**
 * One question in the panel: its own answer field, the model answer behind a reveal, and — for
 * code answers — a notebook that runs the code right here.
 *
 * Its own component because the answer field is per-question state, and a hook cannot live inside
 * a loop: this way each row owns its text, its reveal and its notebook, and the parent stays a
 * list.
 */
function BankItem({
  q, sectionId, attempt, onGrade, checked, onCheck, focused, index, total, onNav,
}: {
  q: QuestionRecord;
  sectionId: string;
  attempt?: Attempt;
  onGrade: (q: QuestionRecord, correct: boolean, written: string) => void;
  checked: boolean;
  onCheck: () => void;
  /** Set by Pichla/Agla — this item's answer box takes focus and scrolls into view. */
  focused: boolean;
  index: number;
  total: number;
  onNav: (dir: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notebook, setNotebook] = useState(false);
  const [ai, setAi] = useState(false);
  const [answer, setAnswer] = useSavedAnswer(bankAttempt(q.id));
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const tags = q.tags ?? [];
  const pbChapter = tags.find((t) => /^pb:\d{2}$/.test(t))?.slice(3) ?? null;
  const rubric = rubricFor(answer, q.answer);
  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0;

  useEffect(() => {
    if (!focused) return;
    boxRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    boxRef.current?.focus();
  }, [focused]);

  return (
    <div className="card" style={{ margin: '0 0 8px', padding: '10px 12px' }}>
      <div className="row spread" style={{ gap: 8 }}>
        <span className="row" style={{ gap: 6, flex: 1, minWidth: 0 }}>
          <span className={`chip ${q.difficulty}`}>{q.difficulty}</span>
          {tags.includes('MUST-KNOW') && (
            <span className="chip" style={{ color: 'var(--amber)', borderColor: 'rgba(251,191,36,.5)' }}>MUST-KNOW</span>
          )}
          {/* The playbook's `pb:<chapter>` tag is machine shorthand — show the book and the chapter,
              and keep it out of the generic list (same treatment as the Question Bank page). */}
          {pbChapter && (
            <span className="chip" title="The source chapter for this question — the bank can be filtered by that chapter">
              📘 ch.{pbChapter}
            </span>
          )}
          {tags.filter((t) => t !== 'MUST-KNOW' && t !== 'playbook' && !/^pb:\d{2}$/.test(t)).slice(0, 2).map((t) => (
            <span key={t} className="chip">{t}</span>
          ))}
          {isAuthored(q) && <span className="chip" title="Hand-written practice pack">authored</span>}
          {/* The grade AND the percentage it was scored at: ✓/✗ is the mastery gate, the number is
              the feedback. Written-but-ungraded carries no verdict, so it says so rather than
              showing a ✗ the learner never gave (same rule as the Question Bank row). */}
          {attempt && (
            <span
              className={`chip ${attempt.done === true ? 'easy' : attempt.done === false ? 'hard' : 'medium'}`}
              title={attempt.done === undefined
                ? 'Your answer is saved — grade it yourself; mastery follows that grade'
                : 'Percentage = keyword match against the model answer'}
            >
              {attempt.done === true ? '✓ correct' : attempt.done === false ? '✗ incorrect' : '✍ written'}
              {attemptPct(attempt) !== null ? ` ${pctText(attemptPct(attempt))}` : ''}
              {attempt.tries && attempt.tries > 1 ? ` ×${attempt.tries}` : ''}
            </span>
          )}
        </span>
        <span className="row" style={{ gap: 6 }}>
          {CODE_TYPES.has(q.type) && (
            <button className="btn small" onClick={() => setNotebook((v) => !v)} aria-expanded={notebook}>
              <NotebookPen size={12} /> {notebook ? 'Close notebook' : 'Notebook'}
            </button>
          )}
          {/* The local assistant, scoped to THIS question: answer, hint and a rubric percentage of
              whatever is written above. Lazy — one instance per opened item, never per row. */}
          <button className={`btn small${ai ? ' primary' : ''}`} onClick={() => setAi((v) => !v)} aria-expanded={ai} title="The answer, a hint, and a percentage for your written answer">
            <Bot size={12} /> AI
          </button>
          <button className="btn small" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide answer' : 'Show answer'}
          </button>
        </span>
      </div>

      <p className="small" style={{ margin: '8px 0 0' }}><b>{q.question}</b></p>

      <textarea
        ref={boxRef}
        className="console"
        rows={3}
        value={answer}
        placeholder="My answer… (saved automatically)"
        aria-label="My answer"
        onChange={(e) => setAnswer(e.target.value)}
        style={{ marginTop: 8 }}
      />

      {/* Identical to the Question Bank row: Check answer asks for the match percentage, and says
          why a check measured nothing (a stub, or an item with a method instead of a model answer). */}
      <div className="row" style={{ marginTop: 8 }}>
        <button className={`btn small${checked ? '' : ' primary'}`} onClick={onCheck} aria-expanded={checked}>
          {checked ? <RotateCcw size={12} /> : <Check size={12} />} {checked ? 'Check again' : 'Check answer'}
        </button>
        <button className="btn small" disabled={index <= 0} onClick={() => onNav(-1)} title="Previous question">
          <ChevronLeft size={12} /> Previous
        </button>
        <button className="btn small" disabled={index >= total - 1} onClick={() => onNav(1)} title="Next question">
          Next <ChevronRight size={12} />
        </button>
        <span className="small muted">Q {index + 1} / {total}{words ? ` · ${words} words` : ''}</span>
      </div>

      {checked && (rubric ? (
        <p className="small" style={{ marginTop: 6 }}>
          <span
            className={`chip ${rubric.pct >= 70 ? 'easy' : rubric.pct >= 40 ? 'medium' : 'hard'}`}
            title="Percentage = keyword match against the model answer"
          >
            {rubric.pct >= 80 ? '✅ very good' : rubric.pct >= 50 ? '⚠️ incomplete' : '🔴 weak'} · {rubric.pct}% match
          </span>{' '}
          {rubric.missing.length > 0
            ? <span className="muted">Hint: these key points are missing — {rubric.missing.map((m) => m.split('|')[0]).join(', ')}</span>
            : <span className="muted">All rubric points are covered — now tighten the structure.</span>}
        </p>
      ) : (
        <p className="small muted" style={{ marginTop: 6 }}>
          {!answer.trim()
            ? 'Write your answer first, then press Check answer.'
            : !isAnswer(answer)
              ? 'This is too short to measure — write one or two lines in your own words.'
              : 'This item has no model answer (the document gives a method instead), so a match percentage cannot exist — open "Show answer" to read the model and grade yourself.'}
        </p>
      ))}

      {open && (
        <div className="fadeup">
          <p className="small" style={{ marginTop: 8 }}>{q.answer}</p>
          {q.explanation && <p className="small muted" style={{ marginTop: 4 }}>{q.explanation}</p>}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small primary" onClick={() => onGrade(q, true, answer)}>✓ That was correct</button>
            <button className="btn small" onClick={() => onGrade(q, false, answer)}>✗ That was incorrect</button>
          </div>
        </div>
      )}

      {ai && (
        <div style={{ marginTop: 10 }}>
          <AssistantCard
            compact
            embedded
            context={{
              sectionId,
              where: `${q.sectionId} · ${q.type}`,
              question: {
                text: q.question,
                model: q.answer,
                mine: answer,
                sectionId,
                type: q.type,
                source: (q.tags ?? []).includes('playbook') ? `Playbook V15 · ch.${pbChapter ?? '?'}` : 'Question Bank',
              },
            }}
          />
        </div>
      )}

      {/* Lazy on purpose: the notebook is a Python kernel plus an editor, so it is built only when
          the learner actually asks for it — never as part of rendering a 100-question stage. */}
      {notebook && (
        <div style={{ marginTop: 10 }}>
          <JupyterNotebook
            storageKey={codeSlot.bank(q.id)}
            starter={`# ${q.question.slice(0, 120)}\n\n`}
            solution={q.answer}
            title={`${TYPE_LABEL[q.type] ?? q.type} practice`}
            taskText={q.question}
            label={q.difficulty}
            sectionId={sectionId}
            compact
            hideShelf
            onComplete={() => onGrade(q, true, answer)}
          />
        </div>
      )}
    </div>
  );
}

