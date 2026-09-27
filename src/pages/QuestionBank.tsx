import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bot, ListChecks, Search, ExternalLink, Database, Check, X, RotateCcw, FileText, NotebookPen, Percent } from 'lucide-react';
import {
  useBankManifest, useBank, filterQuestions, countByField, mistakeTypeFor,
  TYPE_LABEL, stageForQuestion, QNA_STAGES, STAGE_QNA, STAGE_PAGE_SIZE, QUESTION_TYPES, DIFFICULTIES, isAuthored,
  type BankFilter,
} from '../data/questions';
import type { QuestionRecord, QuestionType, Difficulty } from '../data/schema';
import type { Attempt } from '../types';
import { useI18n } from '../i18n';
import { useStore, setState, addXp, addMistake, recordAttempt, useSavedAnswer } from '../offline/store';
import { bankAttempt, codeSlot } from '../engine/keys';
import { attemptPct, bankAccuracy, bankAccuracyBySection, pctText, rubricFor } from '../engine/accuracy';
import { JupyterNotebook } from '../components/JupyterNotebook';
import { AssistantCard } from '../components/AssistantCard';

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
 * Question Bank — browses the local content pack (public/questions/*.json) and lets the learner
 * write, practise and self-grade. Self-grading writes REAL state: one attempt per question (with
 * the answer the learner actually wrote), mistakes for wrong answers, and a review-queue reset for
 * that section. No score is computed or invented by the app.
 *
 * With the type filter on "All" the list is grouped by the LESSON STAGE each question belongs to,
 * because a question's home is its stage: that is where it is taught, where the gate lives and
 * where the same question is graded. The grouping reads `stageForQuestion` — the same function the
 * Practice links use — so the group a question appears under is exactly the page that link opens.
 */
export default function QuestionBank() {
  const manifest = useBankManifest();
  const state = useStore();
  const [selected, setSelected] = useState<string | null>(() => urlParams().get('section'));
  const [sectionSearch, setSectionSearch] = useState('');
  const [filter, setFilter] = useState<BankFilter>(EMPTY_FILTER);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState(STAGE_PAGE_SIZE);
  const [onlyWrong, setOnlyWrong] = useState(false);
  const [onlyMustKnow, setOnlyMustKnow] = useState(false);
  const [onlyPlaybook, setOnlyPlaybook] = useState(() => urlParams().get('playbook') === '1');
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
    setFilter({ ...EMPTY_FILTER, search: urlParams().get('find') ?? '' });
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
    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bank, filter, onlyWrong, onlyMustKnow, onlyPlaybook, state.attempts]);

  /** Overall accuracy across every bank answer, for the header card. */
  const bankAcc = useMemo(
    () => bankAccuracy(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.attempts],
  );
  /** Per-section accuracy, so the left list can show each section's own figure. */
  const accBySection = useMemo(
    () => bankAccuracyBySection(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.attempts],
  );

  const bankStats = useMemo(() => {
    if (!bank) return { graded: 0, correct: 0, wrong: 0 };
    let graded = 0, correct = 0, wrong = 0;
    for (const q of bank.questions) {
      const a = state.attempts[bankAttempt(q.id)];
      if (!a) continue;
      graded++;
      if (a.done) correct++; else wrong++;
    }
    return { graded, correct, wrong };
  }, [bank, state.attempts]);

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
      myAnswer: written.trim() ? written.slice(0, 220) : '(self-grade: bina likhe galat)',
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
        <h1 className="row" style={{ gap: 10 }}><ListChecks size={22} /> Question Bank</h1>
        <div className="card">
          <p className="muted small">Content pack load ho raha hai…</p>
          <p className="muted small">
            Agar banks missing hain to pipeline chalao: <code>npm run questions:seed</code> — phir
            {' '}<code>npm run questions:validate</code>.
          </p>
        </div>
      </div>
    );
  }

  const baseline = manifest.baseline * manifest.sections.length;

  return (
    <div>
      <h1 className="row" style={{ gap: 10 }}><Database size={22} /> Question Bank</h1>
      <p className="muted small">
        Local content pack — <b>{manifest.published}</b> questions across <b>{manifest.sections.length}</b> sections.
        Har question apne section aur apne stage me rehta hai. Answer likho (save ho jata hai) ya code ke liye
        notebook kholo, phir khud grade karo: sahi/galat tum batate ho, app koi score nahi banata.
      </p>

      <div className="stat-row">
        <div className="stat-card">
          <div className="ic"><Database size={18} /></div>
          <div><div className="n">{manifest.published}</div><div className="l">published questions</div></div>
        </div>
        {/* The one number the learner actually asks for: how right the answers are, in percent.
            It is real — correct self-grades over graded answers (engine/accuracy.ts). */}
        <div className="stat-card">
          <div className="ic"><Percent size={18} /></div>
          <div>
            <div className="n">{pctText(bankAcc.pct)}</div>
            {/* The sample size sits next to the percentage: "100%" off a single graded answer is a
                true ratio, but a bare 100% over one answer reads as if the whole bank were aced. */}
            <div className="l">
              {bankAcc.graded > 0
                ? `answer accuracy · ${bankAcc.correct}/${bankAcc.graded} sahi`
                : `answer accuracy · ${bankAcc.answered} likhe, grade nahi kiya`}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="ic"><Check size={18} /></div>
          <div>
            <div className="n">{Object.keys(state.attempts).filter((k) => k.startsWith('qb:')).length}</div>
            <div className="l">self-graded by you</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="ic"><RotateCcw size={18} /></div>
          <div>
            <div className="n">{Math.min(100, Math.round((manifest.published / baseline) * 100))}%</div>
            <div className="l">of {baseline} baseline target</div>
          </div>
        </div>
      </div>

      <p className="muted small" style={{ marginTop: -4 }}>
        Baseline {manifest.baseline}/section PDF ke hisaab se hai — jo sections kam hain unme honestly
        <i> CONTENT_INCOMPLETE</i> flag laga hai, aur wahi gaps authoring ke liye listed hain.
        Galat answer dene par mistake tracker entry banti hai aur us section ka review 1 din baad due ho jata hai.
      </p>

      <div className="path-grid" style={{ marginTop: 12 }}>
        {/* LEFT: section index */}
        <div className="card">
          <div className="row spread">
            <h3 className="row" style={{ gap: 8, margin: 0 }}><ListChecks size={16} /> Sections</h3>
            <span className="small muted">{sectionList.length}</span>
          </div>
          <div className="row" style={{ margin: '10px 0', border: '1px solid var(--border)', borderRadius: 10, padding: '2px 8px', background: 'rgba(0,0,0,.3)' }}>
            <Search size={14} />
            <input
              value={sectionSearch}
              onChange={(e) => setSectionSearch(e.target.value)}
              placeholder="Section dhoondo…"
              aria-label="Search sections"
              style={{ border: 'none', background: 'transparent', flex: 1, padding: '6px 4px', minWidth: 0 }}
            />
          </div>
          <div>
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
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                  <span className={`chip ${incomplete ? 'medium' : 'easy'}`} title={incomplete ? 'CONTENT_INCOMPLETE — baseline not authored yet' : 'complete'}>
                    {pct}%
                  </span>
                </button>
              );
            })}
            {!sectionList.length && <p className="muted small">“{sectionSearch}” se koi section match nahi hua.</p>}
          </div>
        </div>

        {/* RIGHT: questions */}
        <div className="card">
          {!entry ? (
            <p className="muted small">Left list se ek section choose karo.</p>
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
                {bankStats.graded > 0 && ` · tumne ${bankStats.graded} grade kiye: ${bankStats.correct} sahi, ${bankStats.wrong} galat`}
                {' · '}answer accuracy <b>{pctText(accBySection[selected ?? '']?.pct ?? null)}</b>
                {accBySection[selected ?? '']?.avg !== null && accBySection[selected ?? '']?.avg !== undefined
                  ? ` · rubric avg ${pctText(accBySection[selected ?? ''].avg)}`
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
                    placeholder="Question me dhoondo…"
                    aria-label="Search questions"
                    style={{ border: 'none', background: 'transparent', flex: 1, padding: '6px 4px', minWidth: 0 }}
                  />
                </div>
                <label className="small row" style={{ gap: 6 }}>
                  <input type="checkbox" checked={onlyMustKnow} onChange={(e) => { setOnlyMustKnow(e.target.checked); setShown(STAGE_PAGE_SIZE); }} />
                  sirf MUST-KNOW
                </label>
                <label className="small row" style={{ gap: 6 }} title="Playbook V15 (doosra source) ke items">
                  <input type="checkbox" checked={onlyPlaybook} onChange={(e) => { setOnlyPlaybook(e.target.checked); setShown(STAGE_PAGE_SIZE); }} />
                  📘 sirf Playbook V15
                </label>
                <label className="small row" style={{ gap: 6 }}>
                  <input type="checkbox" checked={onlyWrong} onChange={(e) => { setOnlyWrong(e.target.checked); setShown(STAGE_PAGE_SIZE); }} />
                  sirf jo galat kiye (repeat)
                </label>
                {hasDrafts && (
                  <label className="small row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={filter.includeDrafts}
                      onChange={(e) => setFilter((f) => ({ ...f, includeDrafts: e.target.checked }))}
                    />
                    drafts dikhao
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
                          Stage kholo <ExternalLink size={12} />
                        </Link>
                      </div>
                    )}
                    {group.items.map((q) => (
                      <QuestionCard
                        key={q.id}
                        q={q}
                        open={!!revealed[q.id]}
                        graded={attemptOf(q.id)}
                        onToggle={() => setRevealed((r) => ({ ...r, [q.id]: !r[q.id] }))}
                        onGrade={grade}
                      />
                    ))}
                    {group.stage && group.total > group.items.length && (
                      <button
                        className="btn small"
                        style={{ marginBottom: 8 }}
                        onClick={() => setGroupShown((g) => ({ ...g, [group.stage!]: (g[group.stage!] ?? PER_GROUP) + PER_GROUP }))}
                      >
                        Aur dikhao ({group.total - group.items.length} baaki)
                      </button>
                    )}
                  </div>
                ))}
                {!rows.length && (
                  <p className="muted small">
                    {onlyWrong
                      ? 'Is section me abhi koi galat-kiya question nahi hai — pehle grade karo.'
                      : onlyPlaybook
                        ? 'Is section me Playbook V15 ka koi item nahi mila — playbook chapter index kholo.'
                      : onlyMustKnow
                        ? 'Is filter me koi MUST-KNOW question nahi mila.'
                        : 'Is filter me koi question nahi mila — filter badlo.'}
                  </p>
                )}
              </div>

              {filter.type !== 'all' && rows.length > shown && (
                <button className="btn small" style={{ marginTop: 8 }} onClick={() => setShown((n) => n + STAGE_PAGE_SIZE)}>
                  Aur dikhao ({rows.length - shown} baaki)
                </button>
              )}
              <p className="muted small" style={{ marginTop: 8 }}>
                {rows.length} of {bank?.questions.length ?? 0} match · galat par +1 mistake tracker entry, sahi par +{XP_PER_CORRECT} XP (pehli baar).
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionCard({
  q, open, graded, onToggle, onGrade,
}: {
  q: QuestionRecord;
  open: boolean;
  graded?: Attempt;
  onToggle: () => void;
  onGrade: (q: QuestionRecord, correct: boolean, written: string) => void;
}) {
  const { t } = useI18n();
  const [notebook, setNotebook] = useState(false);
  const [ai, setAi] = useState(false);
  const [written, setWritten] = useSavedAnswer(bankAttempt(q.id));
  /** Live rubric of the current text: the percentage before the learner self-grades. */
  const rubric = rubricFor(written, q.answer);
  return (
    <div className="card" style={{ margin: '0 0 8px', padding: '10px 12px' }}>
      <div className="row spread" style={{ gap: 8 }}>
        <span className="row" style={{ gap: 6 }}>
          <span className={`chip ${q.type}`}>{TYPE_LABEL[q.type as QuestionType] ?? q.type}</span>
          <span className={`chip ${q.difficulty}`}>{q.difficulty}</span>
          {isAuthored(q) && <span className="chip" title={t('badge.authoredHint')}>{t('badge.authored')}</span>}
          {(q.tags ?? []).includes('MUST-KNOW') && (
            <span className="chip" style={{ color: 'var(--amber)', borderColor: 'rgba(251,191,36,.5)' }}>MUST-KNOW</span>
          )}
          {/* Grade and percentage together: ✓/✗ is the mastery gate, the number is the feedback. */}
          {graded && (
            <span className={`chip ${graded.done ? 'easy' : 'hard'}`} title="Percentage = model answer ke keyword rubric se match">
              {graded.done ? '✓ sahi' : '✗ galat'} {pctText(attemptPct(graded))}{graded.tries && graded.tries > 1 ? ` ×${graded.tries}` : ''}
            </span>
          )}
          {/* Playbook provenance, read from the import's own `pb:<chapter>` tag. It is kept out of
              the generic tag list below, which would otherwise show "playbook" and "pb:18". */}
          {playbookChapter(q) && (
            <Link className="chip" to={`/playbook#${playbookChapter(q)}`} title="Playbook V15 ka chapter index kholo">
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
          <button className={`btn small${ai ? ' primary' : ''}`} onClick={() => setAi((v) => !v)} aria-expanded={ai} title="Is question ka answer, hint aur tumhare answer ka percentage">
            <Bot size={12} /> AI
          </button>
          <button className="btn small primary" onClick={onToggle}>{open ? 'Answer chhupao' : 'Answer dekho'}</button>
        </span>
      </div>
      <p style={{ margin: '8px 0 0' }} className="small">{q.question}</p>

      {/* The answer field comes BEFORE the reveal on purpose: the rule is write first, compare
          second — and whatever is written here survives a refresh and shows up in the mistake
          tracker as the learner's own words. */}
      <textarea
        rows={2}
        value={written}
        placeholder="My answer… (save ho jata hai)"
        aria-label="My answer"
        onChange={(e) => setWritten(e.target.value)}
        style={{ marginTop: 8 }}
      />

      {open && (
        <div style={{ marginTop: 8 }}>
          <pre className="codeblock" style={{ fontSize: '.78rem' }}>{q.answer || '(no answer)'}</pre>
          {q.explanation && <p className="small muted" style={{ marginTop: 6 }}><b>Kyun:</b> {q.explanation}</p>}
          {/* Write first, compare second: how much of the model answer's substance is in the
              learner's own words, with the points they missed named. */}
          {rubric && (
            <p className="small" style={{ marginTop: 4 }}>
              <span className={`chip ${rubric.pct >= 70 ? 'easy' : rubric.pct >= 40 ? 'medium' : 'hard'}`}>
                tumhare answer ka rubric: {rubric.pct}%
              </span>
              {rubric.missing.length > 0 && (
                <span className="muted"> chhoota hua: {rubric.missing.map((m) => m.split('|')[0]).join(', ')}</span>
              )}
            </p>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <span className="small muted">Khud grade karo:</span>
            <button className="btn small" onClick={() => onGrade(q, true, written)}><Check size={12} /> Sahi tha</button>
            <button className="btn small" onClick={() => onGrade(q, false, written)}><X size={12} /> Galti hui</button>
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
