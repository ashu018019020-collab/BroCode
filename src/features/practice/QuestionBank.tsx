import { useEffect, useMemo, useRef, useState } from 'react';
import { HubCrumb } from '../../components/learning/SectionChrome';
import { Link, useSearchParams } from 'react-router-dom';
import { Bot, ListChecks, Search, ExternalLink, Database, Check, X, RotateCcw, FileText, NotebookPen, Percent, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useBankManifest, useBank, filterQuestions, countByField, mistakeTypeFor,
  TYPE_LABEL, stageForQuestion, QNA_STAGES, STAGE_QNA, STAGE_PAGE_SIZE, QUESTION_TYPES, DIFFICULTIES, isAuthored,
  type BankFilter,
} from '../../core/data/questions';
import type { QuestionRecord, QuestionType, Difficulty } from '../../core/data/schema';
import type { Attempt } from '../../types';
import { useI18n } from '../../app/i18n';
import { useStore, setState, addXp, addMistake, recordAttempt, useSavedAnswer } from '../../core/storage/store';
import { bankAttempt, codeSlot } from '../../core/platform/keys';
import { attemptPct, bankAccuracy, bankAccuracyBySection, isAnswer, pctText, rubricFor } from '../../core/assessment/accuracy';
import { countDuration, countValue } from '../../core/platform/anim';
import { bankRedo } from '../../core/ai/coach';
import { bankPractised } from '../../core/learning/coverage';
import { JupyterNotebook } from '../../components/code/JupyterNotebook';
import { AssistantCard } from '../../components/shared/AssistantCard';

const EMPTY_FILTER: BankFilter = { type: 'all', difficulty: 'all', search: '', includeDrafts: false };
const XP_PER_CORRECT = 2;

/**
 * How many rows of a stage group show before that group's own "Aur dikhao".
 *
 * Per group rather than one global page: `learn` holds ~52 questions in most sections, so a single
 * shared budget meant page one was only the Learn stage and the Coding Lab the learner came for was
 * several clicks away. A small slice each keeps every stage visible at once while the header still
 * reports the group's real total.
 */
const PER_GROUP = 8;

/** The answers that ARE code — the only ones with a practice notebook. */
const CODE_TYPES = new Set(['coding', 'solved', 'debug']);

/**
 * The playbook chapter an item came from — the `pb:<chapter>` tag the import writes, or null for
 * curriculum items. Rendered as "ch.18" so the provenance is readable instead of machine shorthand.
 */
const playbookChapter = (q: QuestionRecord): string | null =>
  (q.tags ?? []).find((tag) => /^pb:\d{2}$/.test(tag))?.slice(3) ?? null;

/**
 * A deep link's params, read synchronously so they are in place on the FIRST render.
 *
 * `/questions?section=s23&playbook=1` is what the Playbook page's chapter links open. The view
 * resets below whenever the SECTION changes ("filters never look stale"), and a filter applied
 * after that reset would be wiped — so the link's intent has to be the initial state, not an
 * update. `useSearchParams` still handles a later, same-page link (see the effect in the page).
 */
const urlParams = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '');

/**
 * Question Bank — browses the local content pack (public/generated/questions/*.json) and lets the learner
 * write, practise and self-grade. Self-grading writes REAL state: one attempt per question (with
 * the answer the learner actually wrote), mistakes for wrong answers, and a review-queue reset for
 * that section. No score is computed or invented by the app.
 *
 * With the type filter on "All" the list is grouped by the LESSON STAGE each question belongs to,
 * because a question's home is its stage: that is where it is taught, where the gate lives and
 * where the same question is graded. The grouping reads `stageForQuestion` — the same function the
 * Practice links use — so the group a question appears under is exactly the page that link opens.
 */

/**
 * Count a figure up to its real value on mount. The maths is `engine/anim.ts` (the only part of
 * this a test can reach); this hook is just the frame loop around it.
 *
 * Three properties it has to keep, because a KPI row is where a wrong number does the most damage:
 *
 *   · it ends ON the value, never near it — the last frame is the target itself, so 13,865 is
 *     never left showing as 13,864;
 *   · a reduced-motion user (or a delta too small to be worth animating) gets the value at once,
 *     with no frames at all;
 *   · the count only runs on mount and on a real change, never per render — the bank re-renders on
 *     every keystroke of a saved answer, and a counter that restarted there would flicker all page.
 */
function useCountUp(target: number): number {
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const settle = () => { fromRef.current = target; setShown(target); };
    const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const ms = still ? 0 : countDuration(from, target);
    if (ms <= 0) { settle(); return; }

    let raf = 0;
    let start: number | null = null;
    const step = (now: number) => {
      if (start === null) start = now;
      const t = (now - start) / ms;
      if (t >= 1) settle();
      else { setShown(countValue(from, target, t)); raf = requestAnimationFrame(step); }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

export default function QuestionBank() {
  const manifest = useBankManifest();
  const state = useStore();
  const [selected, setSelected] = useState<string | null>(() => urlParams().get('section'));
  const [sectionSearch, setSectionSearch] = useState('');
  const [filter, setFilter] = useState<BankFilter>(() => {
    // `?type=interview` — the Interview hub's "interview questions" card deep-links here with the
    // type filter pre-set. Only a REAL question type is honoured: a garbage param would otherwise
    // filter the whole bank down to zero rows with the chips showing nothing selected.
    const t = urlParams().get('type');
    return { ...EMPTY_FILTER, type: (t && (QUESTION_TYPES as string[]).includes(t) ? t : 'all') as BankFilter['type'] };
  });
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState(STAGE_PAGE_SIZE);
  const [onlyWrong, setOnlyWrong] = useState(false);
  const [onlyMustKnow, setOnlyMustKnow] = useState(false);
  const [onlyPlaybook, setOnlyPlaybook] = useState(() => urlParams().get('playbook') === '1');
  // `?chapter=18` — one Playbook chapter's items, IN THIS LIST. The chapter used to be a second page
  // (/playbook); the merge moved the reading here, next to the answers, the notebook and the mistake
  // tracker, so a chapter is a filter now instead of a place.
  const [chapterOnly, setChapterOnly] = useState(() => urlParams().get('chapter'));
  const [groupShown, setGroupShown] = useState<Record<string, number>>({});
  const [params] = useSearchParams();

  useEffect(() => {
    if (manifest && !selected && manifest.sections.length) setSelected(manifest.sections[0].sectionId);
  }, [manifest, selected]);

  // `?section=s23` — the Playbook page's chapter links open THIS section's bank. The section resets
  // the other view state on change (see below), which is what a section change should do anyway.
  // A same-page link (already on the bank, new params) still applies its section and its filter.
  useEffect(() => {
    const s = params.get('section');
    if (s) setSelected(s);
    if (params.get('playbook') === '1') setOnlyPlaybook(true);
    setChapterOnly(params.get('chapter'));
    const t = params.get('type');
    if (t && (QUESTION_TYPES as string[]).includes(t)) setFilter((x) => ({ ...x, type: t as BankFilter['type'] }));
    // `?find=<text>` — a command-palette hit lands here. The palette searches all 13,865 bank
    // questions, so a hit that only opened the section would leave the learner scrolling a
    // 644-question list to find the one they clicked; this seeds the bank's own search box.
    const f = params.get('find');
    if (f) setFilter((x) => ({ ...x, search: f }));
  }, [params]);

  const bank = useBank(selected ?? undefined);

  // New section → reset view state so filters/answers never look stale.
  //
  // Keyed on the section actually CHANGING, not on "not the first run": a deep link
  // (`?section=s23&playbook=1`) opens with its section already selected and its filter already on,
  // and a first-run guard is not enough to protect them — React StrictMode runs mount effects twice
  // in development, and the second run wiped the filter the link came with.
  const prevSelected = useRef(selected);
  useEffect(() => {
    if (prevSelected.current === selected) return;
    prevSelected.current = selected;
    // A reset that blindly clears everything also erases what the URL ASKED FOR: arriving from the
    // palette (`?section=s28&find=Dijkstra`) changes the section in the same tick that seeds the
    // search box, and the reset would immediately wipe the query the learner clicked on.
    setFilter({ ...EMPTY_FILTER, type: ((QUESTION_TYPES as string[]).includes(urlParams().get('type') ?? '') ? urlParams().get('type') as string : 'all') as BankFilter['type'], search: urlParams().get('find') ?? '' });
    setRevealed({});
    setShown(STAGE_PAGE_SIZE);
    setOnlyWrong(false);
    setOnlyMustKnow(false);
    setOnlyPlaybook(urlParams().get('playbook') === '1');
    setGroupShown({});
  }, [selected]);

  const sectionList = useMemo(() => {
    if (!manifest) return [];
    const needle = sectionSearch.trim().toLowerCase();
    return needle
      ? manifest.sections.filter((s) => `${s.no} ${s.title}`.toLowerCase().includes(needle))
      : manifest.sections;
  }, [manifest, sectionSearch]);

  const attemptOf = (id: string) => state.attempts[bankAttempt(id)];

  const entry = manifest?.sections.find((s) => s.sectionId === selected) ?? null;
  const rows = useMemo(() => {
    if (!bank) return [];
    let filtered = filterQuestions(bank.questions, filter);
    if (onlyWrong) filtered = filtered.filter((q) => attemptOf(q.id) && !attemptOf(q.id)!.done);
    // MUST-KNOW is the honest signal (the `MUST-KNOW` tag). The `importance.must_know` field claims
    // 54% of the pack against the tag's 17.8%, so filtering on it would drown the learner.
    if (onlyMustKnow) filtered = filtered.filter((q) => (q.tags ?? []).includes('MUST-KNOW'));
    // The V15 playbook's own items. Tagged on import, so this is the document's provenance — not a
    // guess from the text — and it is how the learner finds the 385 playbook answers in one tap.
    if (onlyPlaybook) filtered = filtered.filter((q) => (q.tags ?? []).includes('playbook'));
    if (chapterOnly) {
      filtered = filtered.filter((q) => (q.tags ?? []).includes(`pb:${chapterOnly}`));
      // LEVEL BY LEVEL. A merged chapter arrives in the document's own order, which is a reading
      // order — not a difficulty one: item 1 can be `hard` while item 7 is `easy`. Inside one
      // chapter's practice the list is therefore sorted easy → medium → hard, so the honest next
      // thing to answer is always the first one. (Sort is stable, so equal levels keep their order.)
      const rank: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
      filtered = [...filtered].sort((a, b) => (rank[a.difficulty ?? 'medium'] ?? 1) - (rank[b.difficulty ?? 'medium'] ?? 1));
    }
    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bank, filter, onlyWrong, onlyMustKnow, onlyPlaybook, state.attempts]);

  /** Overall accuracy across every bank answer, for the header card. */
  const bankAcc = useMemo(
    () => bankAccuracy(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.attempts],
  );
  /**
   * The four KPI figures, computed up here because the count-up hooks cannot sit below the
   * "no banks" early return: a hook behind a conditional return changes the hook order between
   * renders, which throws. An animation may change how a number ARRIVES — never what it says, so
   * every target below is the same expression the card used to render directly.
   *
   * Each figure has exactly one owner and none of them is this page: the pack's size comes from the
   * manifest, accuracy from `engine/accuracy.ts`, the recorded-answer count from `engine/coverage.ts`
   * and the redo pile from `engine/coach.ts`. The page used to scan the attempt store for bank
   * records itself and print a CONTENT ratio as if it were learner progress —
   * `min(100, published / (baseline * sections))`, which the pack had already overshot 9.6x, so that
   * card read a frozen 100% for as long as it shipped. Figures belong in the engine, where a test can
   * reach them and where a numerator that cannot move is visible.
   */
  const gradedCount = bankPractised(state.attempts);
  const redo = bankRedo(state.mistakes);
  const redoPct = redo.open + redo.fixed > 0 ? Math.round((redo.open / (redo.open + redo.fixed)) * 100) : 0;
  const shownPublished = useCountUp(manifest?.published ?? 0);
  const shownAccuracy = useCountUp(bankAcc.pct ?? 0);
  const shownGraded = useCountUp(gradedCount);
  const shownRedo = useCountUp(redo.open);
  /** Per-section accuracy, so the left list can show each section's own figure. */
  const accBySection = useMemo(
    () => bankAccuracyBySection(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.attempts],
  );

  /**
   * The selected section's tally — the ONE source for every number in its summary line below.
   *
   * This replaced a second, hand-rolled loop over the loaded bank file, whose `wrong` counted a
   * merely-written record as galat. Two silent consequences: the sentence printed its counts
   * from one tally and its percentage from another (they can disagree), and a written-but-ungraded
   * answer was reported as a failure the learner never earned. `tally` already answers "graded",
   * "correct", and the share its percentage is built from — one source, one sentence.
   */
  const secAcc = selected ? accBySection[selected] ?? null : null;

  const hasDrafts = useMemo(() => (bank ? bank.questions.some((q) => q.status !== 'PUBLISHED') : false), [bank]);
  const typeCounts = useMemo(() => (bank ? countByField(bank.questions, 'type') : {}), [bank]);

  /**
   * The section's questions grouped by the stage that owns them, in lesson order.
   * `stageForQuestion` decides the group — the same owner as the Practice link — so a question can
   * never sit under one stage while its link opens another.
   */
  const groups = useMemo(() => {
    if (!rows.length) return [];
    const byStage = new Map<string, QuestionRecord[]>();
    for (const q of rows) {
      const stage = stageForQuestion(q);
      const list = byStage.get(stage);
      if (list) list.push(q); else byStage.set(stage, [q]);
    }
    // Lesson order first; an unexpected stage id still renders rather than disappearing.
    const order = [...QNA_STAGES.filter((s) => byStage.has(s)), ...[...byStage.keys()].filter((s) => !QNA_STAGES.includes(s))];
    return order.map((stage) => ({ stage, items: byStage.get(stage)! }));
  }, [rows]);

  /**
   * The visible rows. A type filter collapses the list to one flat page (the old behaviour, so
   * "Aur dikhao" still advances); "All" shows every stage group with its own slice, and a group's
   * header always reports its real total, never just the part that fits.
   */
  const page = useMemo(() => {
    if (filter.type !== 'all') {
      return [{ stage: null as string | null, items: rows.slice(0, shown), total: rows.length }];
    }
    return groups.map((g) => ({
      stage: g.stage as string | null,
      items: g.items.slice(0, groupShown[g.stage] ?? PER_GROUP),
      total: g.items.length,
    }));
  }, [groups, rows, filter.type, shown, groupShown]);

  /** The questions actually on screen, in reading order — what Pichla/Agla walk. */
  const onScreen = useMemo(() => page.flatMap((g) => g.items.map((q) => q.id)), [page]);
  const posOf = useMemo(() => new Map(onScreen.map((id, i) => [id, i])), [onScreen]);
  /** Per-question "Check answer" state, and the id whose box should take focus after a nav click. */
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [focusId, setFocusId] = useState<string | null>(null);

  const move = (id: string, dir: -1 | 1) => {
    const next = onScreen[(posOf.get(id) ?? 0) + dir];
    if (next) setFocusId(next);
  };

  /** Self-grade one question. Honest state only: attempt + written answer, mistake, review reset, XP once. */
  const grade = (q: QuestionRecord, correct: boolean, written: string) => {
    const prev = state.attempts[bankAttempt(q.id)];
    // Two different facts in one record, on purpose: `done` is the mastery gate the learner sets,
    // `score` is the MEASURED percentage (keyword rubric of their write-up vs the model answer, or
    // 100/0 when they wrote nothing). Neither overwrites the other.
    const r = rubricFor(written, q.answer);
    recordAttempt(bankAttempt(q.id), {
      done: correct,
      tries: (prev?.tries ?? 0) + 1,
      answer: written,
      score: r ? r.pct : (correct ? 100 : 0),
    });

    if (correct) {
      if (!prev?.done) addXp(XP_PER_CORRECT, 'practice', 'Question Bank self-grade');
      return;
    }

    addMistake({
      section: q.sectionId,
      topic: (q.tags ?? [])[0] ?? TYPE_LABEL[q.type as QuestionType] ?? q.type,
      question: q.question.slice(0, 140),
      // The learner's own words — the tracker used to file a fixed placeholder here, so a review
      // never showed what was actually written.
      myAnswer: written.trim() ? written.slice(0, 220) : '(self-grade: marked wrong with no answer)',
      correct: q.answer.slice(0, 220),
      type: mistakeTypeFor(q.type),
      source: 'bank',
    });
    // Wrong answer ⇒ this section comes back sooner (spaced repetition level reset).
    setState((s) => ({ ...s, review: { ...s.review, [q.sectionId]: { level: 0, last: new Date().toISOString() } } }));
  };

  if (!manifest) {
    return (
      <div>
        <h2 className="h1-look row" style={{ gap: 10 }}><ListChecks size={22} /> Question Bank</h2>
        <div className="card">
          <p className="muted small">Loading the content pack…</p>
          <p className="muted small">
            If the banks are missing, run the pipeline: <code>npm run questions:seed</code> — then
            {' '}<code>npm run questions:validate</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <HubCrumb hub="/practice" hubLabel="Practice" page="Question Bank" />
      <h1 className="row" style={{ gap: 10 }}><Database size={22} /> Question Bank</h1>
      <p className="muted small">
        Local content pack — <b>{manifest.published}</b> questions across <b>{manifest.sections.length}</b> sections.
        Every question lives in its section and its stage. Write an answer (it saves automatically) or open the
        notebook for code, then grade yourself: you decide correct or wrong, and the app computes no score.
      </p>

      {/* Four figures, four tones: each card publishes its own `--accent`, so the row reads as four
          different measures instead of four copies of the same grey box. The rail along the bottom
          repeats the card's own number as a proportion — it is decoration for a figure already
          printed, never a second, differently-computed claim. */}
      <div className="stat-row qb-stats">
        <div className="stat-card tone-cyan">
          <div className="ic"><Database size={18} /></div>
          <div><div className="n">{shownPublished}</div><div className="l">published questions</div></div>
          {/* Full, because this figure IS the whole bank — not learner progress. */}
          <i className="qb-meter" aria-hidden="true"><b style={{ width: '100%' }} /></i>
        </div>
        {/* The one number the learner actually asks for: how right the answers are, in percent.
            It is real — correct self-grades over graded answers (engine/accuracy.ts). */}
        <div className="stat-card tone-green">
          <div className="ic"><Percent size={18} /></div>
          <div>
            <div className="n">{pctText(bankAcc.pct === null ? null : shownAccuracy)}</div>
            {/* The sample size sits next to the percentage: "100%" off a single graded answer is a
                true ratio, but a bare 100% over one answer reads as if the whole bank were aced. */}
            <div className="l">
              {bankAcc.graded > 0
                ? `answer accuracy · ${bankAcc.correct}/${bankAcc.graded} correct`
                : `answer accuracy · ${bankAcc.answered} written, not graded`}
            </div>
          </div>
          <i className="qb-meter" aria-hidden="true"><b style={{ width: `${Math.min(100, bankAcc.pct ?? 0)}%` }} /></i>
        </div>
        <div className="stat-card tone-violet">
          <div className="ic"><Check size={18} /></div>
          <div>
            <div className="n">{shownGraded}</div>
            <div className="l">self-graded by you</div>
          </div>
          {/* Out of the bank that exists — which is why this rail is honest at 0%, and why it moves
              only when a real self-grade is written. */}
          <i className="qb-meter" aria-hidden="true">
            <b style={{ width: `${manifest.published > 0 ? Math.min(100, (gradedCount / manifest.published) * 100) : 0}%` }} />
          </i>
        </div>
        {/* The learner's WORK, not the content's. This slot used to print a content ratio that the
            pack had already overshot 9.6x, so it read a frozen 100% forever — a figure that cannot
            move claims progress nobody measured. Now: the wrong answers still waiting to be redone,
            which climbs on every galat self-grade and falls as they are fixed. */}
        <div className="stat-card tone-amber" title={`${redo.fixed} fixed · wrong answers still to redo`}>
          <div className="ic"><RotateCcw size={18} /></div>
          <div>
            <div className="n">{shownRedo}</div>
            <div className="l">wrong answers to redo</div>
          </div>
          {/* The card's own number over its own history: the share of every wrong answer the learner
              has not cleared yet, so the rail falls as the pile is worked through. */}
          <i className="qb-meter" aria-hidden="true"><b style={{ width: `${redoPct}%` }} /></i>
        </div>
      </div>

      <p className="muted small" style={{ marginTop: -4 }}>
        Section rows show the {manifest.baseline}/section baseline (as the PDF defines it) — sections that fall
        short carry an honest <i> CONTENT_INCOMPLETE</i> flag, and those gaps are listed for authoring. The amber
        card above does not describe content, it describes your work: how many wrong answers are still waiting to
        be redone.
        A wrong answer creates a mistake tracker entry and makes that section's review due one day later.
      </p>

      {/* Sections first, full width; the questions come UNDER them. The bank used to sit in a 300px
          side column (`.path-grid` is 1fr/300px), so the type chips wrapped onto three lines, every
          answer box was 300px wide, and the section list left the rest of the row empty. Stacked, the
          section rows become grid cells and the bank gets the whole width. */}
      <div className="qb-layout" style={{ display: 'grid', gap: 14, marginTop: 12 }}>
        {/* Section index */}
        <div className="card">
          <div className="row spread">
            <h2 className="row" style={{ gap: 8, margin: 0 }}><ListChecks size={16} /> Sections</h2>
            <span className="small muted">{sectionList.length}</span>
          </div>
          <div className="row" style={{ margin: '10px 0', border: '1px solid var(--border)', borderRadius: 10, padding: '2px 8px', background: 'rgba(0,0,0,.3)' }}>
            <Search size={14} />
            <input
              value={sectionSearch}
              onChange={(e) => setSectionSearch(e.target.value)}
              placeholder="Search sections…"
              aria-label="Search sections"
              style={{ border: 'none', background: 'transparent', flex: 1, padding: '6px 4px', minWidth: 0 }}
            />
          </div>
          {/* One cell per section, so 29 sections stay a compact block instead of 29 stacked rows
              pushing the questions off the screen. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(272px, 100%), 1fr))', gap: 2 }}>
            {sectionList.map((s) => {
              const incomplete = s.flags.includes('CONTENT_INCOMPLETE');
              const pct = Math.min(100, Math.round((s.published / manifest.baseline) * 100));
              return (
                <button
                  key={s.sectionId}
                  className={`file-row ${s.sectionId === selected ? 'on' : ''}`}
                  onClick={() => setSelected(s.sectionId)}
                  style={{ width: '100%', textAlign: 'left', background: s.sectionId === selected ? undefined : 'transparent' }}
                >
                  <span className="mono small muted" style={{ flex: 'none' }}>{String(s.no).padStart(2, '0')}</span>
                  {/* The name is a class, not an inline style, so the phone rule in styles.css can
                      let it wrap — an inline `white-space` cannot be overridden by a media query. */}
                  <span className="sec-name">{s.title}</span>
                  <span className={`chip ${incomplete ? 'medium' : 'easy'}`} title={incomplete ? 'CONTENT_INCOMPLETE — baseline not authored yet' : 'complete'}>
                    {pct}%
                  </span>
                </button>
              );
            })}
            {!sectionList.length && <p className="muted small">No section matches “{sectionSearch}”.</p>}
          </div>
        </div>

        {/* The bank itself — now the full width of the page. */}
        <div className="card">
          {!entry ? (
            <p className="muted small">Choose a section from the list above.</p>
          ) : (
            <>
              <div className="row spread">
                <h3 style={{ margin: 0 }}>{String(entry.no).padStart(2, '0')} · {entry.title}</h3>
                <span className={`chip ${entry.flags.includes('CONTENT_INCOMPLETE') ? 'medium' : 'easy'}`}>
                  {entry.published}/{manifest.baseline} target
                </span>
              </div>
              <p className="muted small" style={{ marginTop: 4 }}>
                {bank ? `${bank.questions.length} questions` : 'loading bank…'}
                {secAcc && secAcc.graded > 0
                  ? ` · you graded ${secAcc.graded}: ${secAcc.correct} correct, ${secAcc.graded - secAcc.correct} wrong`
                  : ''}
                {' · '}answer accuracy <b>{pctText(secAcc?.pct ?? null)}</b>
                {secAcc?.avg !== null && secAcc?.avg !== undefined
                  ? ` · rubric avg ${pctText(secAcc.avg)}`
                  : ''}
              </p>

              {/* type filter */}
              <div className="lang-toggle" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                <button className={filter.type === 'all' ? 'on' : ''} onClick={() => { setFilter((f) => ({ ...f, type: 'all' })); setShown(STAGE_PAGE_SIZE); }}>
                  All {bank ? `(${bank.questions.length})` : ''}
                </button>
                {QUESTION_TYPES.filter((t) => (typeCounts[t] ?? 0) > 0).map((t) => (
                  <button
                    key={t}
                    className={filter.type === t ? 'on' : ''}
                    onClick={() => { setFilter((f) => ({ ...f, type: t })); setShown(STAGE_PAGE_SIZE); }}
                  >
                    {TYPE_LABEL[t]} ({typeCounts[t]})
                  </button>
                ))}
              </div>

              {/* difficulty / search / drafts / repeat */}
              <div className="row" style={{ marginTop: 8 }}>
                <select
                  value={filter.difficulty}
                  aria-label="Filter by difficulty"
                  onChange={(e) => { setFilter((f) => ({ ...f, difficulty: e.target.value as Difficulty | 'all' })); setShown(STAGE_PAGE_SIZE); }}
                >
                  <option value="all">Any difficulty</option>
                  {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <div className="row" style={{ flex: 1, minWidth: 160, border: '1px solid var(--border)', borderRadius: 10, padding: '2px 8px', background: 'rgba(0,0,0,.3)' }}>
                  <Search size={14} />
                  <input
                    value={filter.search}
                    onChange={(e) => { setFilter((f) => ({ ...f, search: e.target.value })); setShown(STAGE_PAGE_SIZE); }}
                    placeholder="Search questions…"
                    aria-label="Search questions"
                    style={{ border: 'none', background: 'transparent', flex: 1, padding: '6px 4px', minWidth: 0 }}
                  />
                </div>
                <label className="small row" style={{ gap: 6 }}>
                  <input type="checkbox" checked={onlyMustKnow} onChange={(e) => { setOnlyMustKnow(e.target.checked); setShown(STAGE_PAGE_SIZE); }} />
                  MUST-KNOW only
                </label>
                <label className="small row" style={{ gap: 6 }} title="Items from Playbook V15 (second source)">
                  <input type="checkbox" checked={onlyPlaybook} onChange={(e) => { setOnlyPlaybook(e.target.checked); setShown(STAGE_PAGE_SIZE); }} />
                  📘 Playbook V15 only
                </label>
                <label className="small row" style={{ gap: 6 }}>
                  <input type="checkbox" checked={onlyWrong} onChange={(e) => { setOnlyWrong(e.target.checked); setShown(STAGE_PAGE_SIZE); }} />
                  Wrong only (repeat)
                </label>
                {hasDrafts && (
                  <label className="small row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={filter.includeDrafts}
                      onChange={(e) => setFilter((f) => ({ ...f, includeDrafts: e.target.checked }))}
                    />
                    Show drafts
                  </label>
                )}
                <button className="btn small" onClick={() => { setRevealed({}); setOnlyWrong(false); setOnlyMustKnow(false); setOnlyPlaybook(false); }}>Reset view</button>
              </div>

              <div style={{ marginTop: 10 }}>
                {page.map((group) => (
                  <div key={group.stage ?? 'flat'}>
                    {group.stage && (
                      <div className="row spread" style={{ margin: '12px 0 6px' }}>
                        <h4 className="row" style={{ gap: 8, margin: 0 }}>
                          {STAGE_QNA[group.stage]?.label ?? group.stage}
                          <span className="small muted">{group.items.length} of {group.total}</span>
                        </h4>
                        <Link className="btn small" to={`/lesson/${entry.sectionId}/${group.stage}`}>
                          Open stage <ExternalLink size={12} />
                        </Link>
                      </div>
                    )}
                    {/* Cards absorb the width instead of stretching: on a 1920px screen one
                        full-width row left ~1000px of empty space between the question on the left
                        and its buttons on the far right, and made the answer box unreadably wide.
                        Two or three per row means more questions on screen and readable lines. */}
                    {/* `min(560px, 100%)` and not a bare 560px: a fixed 560px minimum track is
                        wider than a phone's whole content column, so the grid forced a 289px
                        horizontal scroll on /questions at 320px (measured) instead of stacking.
                        "min" keeps the desktop behaviour identical — 560px is the minimum there
                        anyway — and collapses to one full-width column once 560px no longer fits. */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(560px, 100%), 1fr))', gap: 10, alignItems: 'start' }}>
                      {group.items.map((q) => (
                        <QuestionCard
                          key={q.id}
                          q={q}
                          open={!!revealed[q.id]}
                          graded={attemptOf(q.id)}
                          onToggle={() => setRevealed((r) => ({ ...r, [q.id]: !r[q.id] }))}
                          onGrade={grade}
                          checked={!!checked[q.id]}
                          onCheck={() => setChecked((c) => ({ ...c, [q.id]: !c[q.id] }))}
                          focused={focusId === q.id}
                          index={posOf.get(q.id) ?? 0}
                          total={onScreen.length}
                          onNav={(dir) => move(q.id, dir)}
                        />
                      ))}
                    </div>
                    {group.stage && group.total > group.items.length && (
                      <button
                        className="btn small"
                        style={{ marginBottom: 8 }}
                        onClick={() => setGroupShown((g) => ({ ...g, [group.stage!]: (g[group.stage!] ?? PER_GROUP) + PER_GROUP }))}
                      >
                        Show more ({group.total - group.items.length} left)
                      </button>
                    )}
                  </div>
                ))}
                {!rows.length && (
                  <p className="muted small">
                    {onlyWrong
                      ? 'No wrong-answer questions in this section yet — grade some answers first.'
                      : onlyPlaybook
                        ? 'No Playbook V15 item in this section — open the playbook chapter index.'
                      : onlyMustKnow
                        ? 'No MUST-KNOW question matches this filter.'
                        : 'No question matches this filter — change the filters.'}
                  </p>
                )}
              </div>

              {filter.type !== 'all' && rows.length > shown && (
                <button className="btn small" style={{ marginTop: 8 }} onClick={() => setShown((n) => n + STAGE_PAGE_SIZE)}>
                  Show more ({rows.length - shown} left)
                </button>
              )}
              <p className="muted small" style={{ marginTop: 8 }}>
                {rows.length} of {bank?.questions.length ?? 0} match · a wrong answer adds +1 mistake tracker entry, a correct one adds +{XP_PER_CORRECT} XP (first time).
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionCard({
  q, open, graded, onToggle, onGrade, checked, onCheck, focused, index, total, onNav,
}: {
  q: QuestionRecord;
  open: boolean;
  graded?: Attempt;
  onToggle: () => void;
  onGrade: (q: QuestionRecord, correct: boolean, written: string) => void;
  checked: boolean;
  onCheck: () => void;
  /** Set by Pichla/Agla — this card's answer box takes focus and scrolls into view. */
  focused: boolean;
  index: number;
  total: number;
  onNav: (dir: -1 | 1) => void;
}) {
  const { t } = useI18n();
  const [notebook, setNotebook] = useState(false);
  const [ai, setAi] = useState(false);
  const [written, setWritten] = useSavedAnswer(bankAttempt(q.id));
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const rubric = rubricFor(written, q.answer);
  const words = written.trim() ? written.trim().split(/\s+/).length : 0;

  useEffect(() => {
    if (!focused) return;
    boxRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    boxRef.current?.focus();
  }, [focused]);
  return (
    <div className="card" style={{ margin: 0, padding: '10px 12px', minWidth: 0 }}>
      <div className="row spread" style={{ gap: 8 }}>
        <span className="row" style={{ gap: 6 }}>
          <span className={`chip ${q.type}`}>{TYPE_LABEL[q.type as QuestionType] ?? q.type}</span>
          <span className={`chip ${q.difficulty}`}>{q.difficulty}</span>
          {isAuthored(q) && <span className="chip" title={t('badge.authoredHint')}>{t('badge.authored')}</span>}
          {(q.tags ?? []).includes('MUST-KNOW') && (
            <span className="chip" style={{ color: 'var(--amber)', borderColor: 'rgba(251,191,36,.5)' }}>MUST-KNOW</span>
          )}
          {/* Grade and percentage together: ✓/✗ is the mastery gate, the number is the feedback. A
              record that is only WRITTEN carries no verdict — `useSavedAnswer` stores it as the
              learner types — so it says that instead of printing a "✗ galat —" nobody earned. */}
          {graded && (
            <span
              className={`chip ${graded.done === true ? 'easy' : graded.done === false ? 'hard' : 'medium'}`}
              title={graded.done === undefined
                ? 'Your answer is saved — grade it correct or wrong yourself; that is what raises mastery'
                : 'Percentage = keyword match against the model answer'}
            >
              {graded.done === true ? '✓ correct' : graded.done === false ? '✗ wrong' : '✍ written'}
              {attemptPct(graded) !== null ? ` ${pctText(attemptPct(graded))}` : ''}
              {graded.tries && graded.tries > 1 ? ` ×${graded.tries}` : ''}
            </span>
          )}
          {/* Playbook provenance, read from the import's own `pb:<chapter>` tag. It is kept out of
              the generic tag list below, which would otherwise show "playbook" and "pb:18". */}
          {playbookChapter(q) && (
            <Link className="chip" to={`/questions?section=${q.sectionId}&chapter=${playbookChapter(q)}`} title="Filter every item in this chapter here">
              📘 ch.{playbookChapter(q)}
            </Link>
          )}
          {(q.tags ?? []).filter((tag) => tag !== 'MUST-KNOW' && !/^pb:\d{2}$/.test(tag) && tag !== 'playbook').slice(0, 2).map((tag) => <span key={tag} className="chip">{tag}</span>)}
        </span>
        <span className="row" style={{ gap: 6 }}>
          {CODE_TYPES.has(q.type) && (
            <button className="btn small" onClick={() => setNotebook((v) => !v)} aria-expanded={notebook}>
              <NotebookPen size={12} /> Notebook
            </button>
          )}
          <Link className="btn small" to={`/lesson/${q.sectionId}/${stageForQuestion(q)}`}>
            <ExternalLink size={12} /> Practice
          </Link>
          {/* The offline assistant, scoped to this item: its answer, a hint, and the percentage of
              whatever is written below. Lazy — built only for the row the learner opened. */}
          <button className={`btn small${ai ? ' primary' : ''}`} onClick={() => setAi((v) => !v)} aria-expanded={ai} title="This question's answer, a hint, and the percentage of your answer">
            <Bot size={12} /> AI
          </button>
          <button className="btn small primary" onClick={onToggle}>{open ? 'Hide answer' : 'Show answer'}</button>
        </span>
      </div>
      <p style={{ margin: '8px 0 0' }} className="small">{q.question}</p>

      {/* The answer field comes BEFORE the reveal on purpose: the rule is write first, compare
          second — and whatever is written here survives a refresh and shows up in the mistake
          tracker as the learner's own words. */}
      <textarea
        ref={boxRef}
        className="console"
        rows={3}
        value={written}
        placeholder="My answer… (it saves automatically)"
        aria-label="My answer"
        onChange={(e) => setWritten(e.target.value)}
        style={{ marginTop: 8 }}
      />

      {/* Check answer, plus Pichla/Agla over the questions on screen. The percentage used to appear
          on its own while typing; asking for it is what a learner expects from a "check", and it is
          the only way to say WHY a check measures nothing (a stub, or an item whose document gave a
          method instead of a model answer) — the silence there was the confusing part. */}
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
            {rubric.pct >= 80 ? '✅ excellent' : rubric.pct >= 50 ? '⚠️ partial' : '🔴 weak'} · {rubric.pct}% match
          </span>{' '}
          {rubric.missing.length > 0
            ? <span className="muted">Hint: these key points are missing — {rubric.missing.map((m) => m.split('|')[0]).join(', ')}</span>
            : <span className="muted">All rubric points are covered — now tighten the structure.</span>}
        </p>
      ) : (
        <p className="small muted" style={{ marginTop: 6 }}>
          {!written.trim()
            ? 'Write your answer first, then press Check answer.'
            : !isAnswer(written)
              ? 'This is too short to measure — write 1-2 lines in your own words.'
              : 'This item has no model answer (the document gives a method), so no match percentage can be computed — read the method under "Show answer" and grade yourself.'}
        </p>
      ))}

      {open && (
        <div style={{ marginTop: 8 }}>
          {/* `pre-wrap` + `anywhere`: a long model answer used to render as ONE line inside a
              horizontally scrolling box — you had to drag sideways to read a sentence. It wraps
              down the card now, like every other paragraph in the app. */}
          <pre className="codeblock" style={{ fontSize: '.78rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{q.answer || '(no answer)'}</pre>
          {q.explanation && <p className="small muted" style={{ marginTop: 6 }}><b>Why:</b> {q.explanation}</p>}
          <div className="row" style={{ marginTop: 8 }}>
            <span className="small muted">Grade yourself:</span>
            <button className="btn small" onClick={() => onGrade(q, true, written)}><Check size={12} /> Correct</button>
            <button className="btn small" onClick={() => onGrade(q, false, written)}><X size={12} /> Wrong</button>
          </div>
          <p className="small muted" style={{ marginTop: 4 }}>
            source: {q.source}
            {q.verifiedAt ? ` · verified ${q.verifiedAt.slice(0, 10)}` : ''} · id: <span className="mono">{q.id}</span>
          </p>
        </div>
      )}

      {/* Provenance, finally readable: 10,890 items carry the PDF page they came from, and until now
          nothing in the app showed it. It deep-links into the reader, so any question can be checked
          against the page it was extracted from. */}
      {q.pdfPage !== undefined && (
        <p className="small muted" style={{ marginTop: 6 }}>
          <Link
            className="chip"
            to={`/pdf/${q.pdfPage}`}
            title={[q.pdfStage && `source band: ${q.pdfStage}`, q.pdfImportance && `source importance: ${q.pdfImportance}`].filter(Boolean).join(' · ') || 'source page'}
          >
            <FileText size={11} /> PDF p.{q.pdfPage}
          </Link>
          {q.pdfStage && <span className={`chip ${graded ? 'easy' : 'medium'}`} style={{ marginLeft: 6 }}>{q.pdfStage}</span>}
        </p>
      )}

      {ai && (
        <div style={{ marginTop: 10 }}>
          <AssistantCard
            compact
            embedded
            context={{
              sectionId: q.sectionId,
              where: `${q.sectionId} · ${q.type}`,
              question: {
                text: q.question,
                model: q.answer,
                mine: written,
                sectionId: q.sectionId,
                type: q.type,
                source: playbookChapter(q) ? `Playbook V15 · ch.${playbookChapter(q)}` : 'Question Bank',
              },
            }}
          />
        </div>
      )}

      {notebook && (
        <div style={{ marginTop: 10 }}>
          <JupyterNotebook
            storageKey={codeSlot.bank(q.id)}
            starter={`# ${q.question.slice(0, 120)}\n\n`}
            solution={q.answer}
            title={`${TYPE_LABEL[q.type as QuestionType] ?? q.type} practice`}
            taskText={q.question}
            label={q.difficulty}
            sectionId={q.sectionId}
            compact
            hideShelf
            onComplete={() => onGrade(q, true, written)}
          />
        </div>
      )}
    </div>
  );
}
