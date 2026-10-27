import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronLeft, Mic2, MicOff, Pause, Play, RotateCcw,
  Send, SkipForward, Sparkles, Square, Timer, Volume2, VolumeX,
} from 'lucide-react';
import { HubCrumb } from '../../components/learning/SectionChrome';
import { BrandMark } from '../../components/shared/BrandMark';
import { useVoiceTutor } from '../../components/shared/useVoiceTutor';
import { Bar } from '../../components/ui/ui';
import { useI18n } from '../../app/i18n';
import type { LocaleKey } from '../../app/i18n/locales';
import { TRACK_DEFS } from '../../app/App';
import { useStore, setState, addXp, addMistake, recordAttempt } from '../../core/storage/store';
import { useBankManifest, loadBanksFor, TYPE_LABEL } from '../../core/data/questions';
import type { BankManifestEntry } from '../../core/data/questions';
import { bankAttempt } from '../../core/platform/keys';
import {
  INTERVIEW_KINDS, KIND_BY_ID, eligibleInBank, kindCounts, kindOf, pickQuestion, planSections,
} from '../../core/assessment/interview-room';
import {
  DEFAULT_LEVEL, DEFAULT_MODE, LEVELS, MODES, PER_QUESTION_SECONDS,
  buildInterviewReport, collectQuestions, evaluationSpeech, levelPool, modeById, statusLabel,
  verdictForScore,
  type AnswerEvaluation, type EvaluationSource, type InterviewModeId, type LevelId,
  type SessionAnswer, type SessionQuestion,
} from '../../core/assessment/interview-session';
import { requestEvaluation } from '../../core/ai/interview';
import { voiceSupportNote } from '../../core/ai/voice';
import './interview-room.css';

/**
 * The Interview Room: subject → setup → a live round → a report derived from real evaluations.
 *
 * Three rules shape this page:
 *
 *  1. THE BANK IS THE QUESTION SOURCE. The pool is the canonical bank's own records, the same
 *     `sNN:type:i` ids the Question Bank writes its `qb:` attempt under, so an answer here and an
 *     answer there are ONE record. Nothing is generated on the client.
 *  2. THE AI IS ASKED, NOT IMITATED. Every evaluation is a real request with a deadline. The
 *     thinking indicator shows only while that request (or speech, or recognition) is genuinely in
 *     flight; when the API is absent the panel says "Built-in rubric" and the deterministic keyword
 *     score is displayed instead. No animation pretends a model is working when it is not.
 *  3. THE VOICE IS THE EXISTING TUTOR. `useVoiceTutor` owns SpeechRecognition, the browser voice
 *     and the Google Neural2 voice; this page only decides WHEN to speak. A transcript is placed in
 *     the editable box and never submitted for the learner.
 */
type Phase = 'setup' | 'live' | 'report';

const ACCURACY_LABEL: Record<string, string> = {
  accurate: 'Accurate',
  'mostly-accurate': 'Mostly accurate',
  'partially-accurate': 'Partially accurate',
  inaccurate: 'Inaccurate',
};

type SessionSize = 3 | 5 | 10 | 'all';

const clampSize = (value: string | null): SessionSize => {
  if (value === 'all') return 'all';
  const n = Number(value);
  return n === 3 || n === 5 || n === 10 ? n : 5;
};

export default function InterviewMode() {
  const { t } = useI18n();
  const state = useStore();
  const manifest = useBankManifest();
  const [params, setParams] = useSearchParams();
  const voice = useVoiceTutor();

  const ranges = useMemo(() => TRACK_DEFS.map((d) => ({ id: d.id, from: d.from, to: d.to })), []);
  const trackDef = TRACK_DEFS.find((d) => d.id === params.get('subject')) ?? null;
  const range = trackDef ? ranges.find((r) => r.id === trackDef.id) ?? null : null;
  const entries: BankManifestEntry[] = manifest?.sections ?? [];

  const [phase, setPhase] = useState<Phase>('setup');
  const [mode, setMode] = useState<InterviewModeId>(DEFAULT_MODE);
  const [level, setLevel] = useState<LevelId>(DEFAULT_LEVEL);
  const [size, setSize] = useState<SessionSize>(() => clampSize(params.get('size')));

  const [step, setStep] = useState(0);
  const [asked, setAsked] = useState<string[]>([]);
  const [answers, setAnswers] = useState<SessionAnswer[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [draft, setDraft] = useState('');
  const [evaluation, setEvaluation] = useState<{ value: AnswerEvaluation; source: EvaluationSource; note: string | null } | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [questionLeft, setQuestionLeft] = useState(PER_QUESTION_SECONDS);
  const [voiceOn, setVoiceOn] = useState(true);
  const [autoRead, setAutoRead] = useState(true);
  const [manifestSlow, setManifestSlow] = useState(false);

  const modeDef = modeById(mode);
  const levelDef = LEVELS.find((l) => l.id === level) ?? LEVELS[1];
  const subjectLabel = trackDef ? t(trackDef.nameKey as LocaleKey) : 'Interview';

  /* ------------------------------- the queue ------------------------------- */

  // The lead kind of the mode weights the SECTION ORDER (the planner); the mode's whole kind list
  // decides which questions are eligible inside each section.
  const kind = KIND_BY_ID[modeDef.kinds[0]];
  const weak = useMemo(() => new Set(state.mistakes.filter((m) => !m.fixed).map((m) => m.section)), [state.mistakes]);

  const [queue, setQueue] = useState<SessionQuestion[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const [levelRelaxed, setLevelRelaxed] = useState(false);
  const [retries, setRetries] = useState(0);

  const current = queue[step] ?? null;
  const q = current?.question ?? null;
  const currentSection = current ? { sectionId: current.sectionId, title: current.sectionTitle } : null;
  const qKind = q ? kindOf(q) : null;

  /* --------------------------------- clock --------------------------------- */

  const leftRef = useRef(PER_QUESTION_SECONDS);
  const expired = useRef(false);
  const evaluationRef = useRef(evaluation);
  evaluationRef.current = evaluation;

  const setLeft = (next: number) => {
    leftRef.current = next;
    setQuestionLeft(next);
  };

  useEffect(() => {
    if (phase !== 'live' || paused || preparing) return;
    const timer = window.setInterval(() => {
      setElapsed((n) => n + 1);
      if (!modeDef.timed || evaluationRef.current) return;
      const next = Math.max(0, leftRef.current - 1);
      setLeft(next);
      if (next === 0) expired.current = true;
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, paused, modeDef.timed, preparing]);

  /* ------------------------------ voice output ------------------------------ */

  const spokenFor = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== 'live' || !q || !voiceOn || !autoRead) return;
    if (spokenFor.current === q.id) return;
    spokenFor.current = q.id;
    voice.speak(q.question);
    // `voice.speak` is stable enough for this trigger; the question id is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, q?.id, voiceOn, autoRead]);

  useEffect(() => {
    if (!voiceOn) voice.stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOn]);

  useEffect(() => {
    if (paused) voice.stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  useEffect(() => {
    const timer = window.setTimeout(() => setManifestSlow(manifest === null), 6000);
    return () => window.clearTimeout(timer);
  }, [manifest]);

  /* ------------------------------- transitions ------------------------------ */

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const requestToken = useRef(0);

  const advance = (opts: { skipped?: boolean } = {}) => {
    // Cancel any evaluation still in flight for the question being left behind.
    requestToken.current += 1;
    spokenFor.current = null;
    setRetries(0);
    setEvaluation(null);
    setEvalError(null);
    setDraft('');
    setNotice(opts.skipped ? 'Question skipped — it is not counted as answered.' : null);
    setLeft(PER_QUESTION_SECONDS);
    setQuestionLeft(PER_QUESTION_SECONDS);
    expired.current = false;
    if (opts.skipped) setSkipped((n) => n + 1);
    if (step + 1 >= queue.length) {
      setPhase('report');
      voice.stopSpeaking();
    } else {
      setStep((n) => n + 1);
    }
  };

  useEffect(() => {
    if (!expired.current || phase !== 'live') return;
    expired.current = false;
    advance({ skipped: true });
    // The tick that empties the clock is the only trigger; `advance` reads the current render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionLeft, phase]);

  const start = async () => {
    if (!range) return;
    requestToken.current += 1;
    spokenFor.current = null;
    setAnswers([]);
    setSkipped(0);
    setAsked([]);
    setStep(0);
    setDraft('');
    setEvaluation(null);
    setEvalError(null);
    setNotice(null);
    setElapsed(0);
    setLeft(PER_QUESTION_SECONDS);
    expired.current = false;
    setPaused(false);
    setQueue([]);
    setPrepError(null);
    setLoadNote(null);
    setLevelRelaxed(false);
    setRetries(0);
    setPreparing(true);
    setPhase('live');

    // `All Questions` needs every bank in the subject BEFORE the first question, so its total is
    // MEASURED rather than guessed and no later fetch can stall the middle of a sitting.
    const subjectSections = entries.filter((e) => e.no >= range.from && e.no <= range.to);
    const sectionIds = size === 'all'
      ? subjectSections.map((e) => e.sectionId)
      : planSections(range, entries, kind.id, size);
    const banks = await loadBanksFor(sectionIds);
    if (!mounted.current) return;

    const sections = sectionIds.map((sectionId) => {
      const entry = entries.find((e) => e.sectionId === sectionId);
      const bank = banks.get(sectionId) ?? null;
      return {
        sectionId,
        title: entry?.title ?? sectionId.toUpperCase(),
        questions: bank ? eligibleInBank(bank) : [],
      };
    });
    const missing = sections.filter((s) => s.questions.length === 0).length;

    let items: SessionQuestion[] = [];
    let relaxed = false;
    if (size === 'all') {
      const collected = collectQuestions(sections, modeDef.kinds, level);
      items = collected.questions;
      relaxed = collected.relaxed;
    } else {
      // One question per planned section, chosen by the recovery ladder. The bank's own level is
      // preferred; a section with nothing at that level is taken at the bank's difficulty.
      for (const section of sections) {
        const exact = levelPool(section.questions, level);
        if (exact.relaxed) relaxed = true;
        const pool = exact.questions.filter((x) => {
          const k = kindOf(x);
          return k !== null && modeDef.kinds.includes(k);
        });
        if (!pool.length) continue;
        const id = pickQuestion(pool, state.attempts, { weak, avoid: new Set(asked) });
        const chosen = pool.find((x) => x.id === id) ?? pool[0];
        items.push({ id: chosen.id, sectionId: section.sectionId, sectionTitle: section.title, question: chosen });
      }
    }

    setLevelRelaxed(relaxed);
    setQueue(items);
    setPreparing(false);
    if (!items.length) {
      setPrepError(
        `The ${subjectLabel} banks hold no stored ${modeDef.label.toLowerCase()} question at the ${levelDef.label.toLowerCase()} level. Change the difficulty, pick another round type, or open the Question Bank.`,
      );
    } else if (missing && size === 'all') {
      setLoadNote(`${missing} of ${sections.length} chapter banks have no stored question for this round type — nothing was invented to fill them.`);
    }
  };

  const toSetup = () => {
    requestToken.current += 1;
    voice.stopSpeaking();
    setPhase('setup');
    setAnswers([]);
    setSkipped(0);
    setAsked([]);
    setStep(0);
    setDraft('');
    setEvaluation(null);
    setEvalError(null);
    setElapsed(0);
    setQueue([]);
    setPreparing(false);
    setPrepError(null);
    setLoadNote(null);
    setLevelRelaxed(false);
    setRetries(0);
  };

  /** Re-open the current question. The old evaluation is discarded, so a re-answer replaces it in
   *  the report instead of counting twice. */
  const retryAnswer = () => {
    requestToken.current += 1;
    setAnswers((list) => list.filter((a) => a.questionId !== q?.id));
    setEvaluation(null);
    setEvalError(null);
    setRetries((n) => n + 1);
    setLeft(PER_QUESTION_SECONDS);
    expired.current = false;
  };

  const submit = async () => {
    if (!q || !currentSection || evaluating || evaluation || preparing) return;
    const text = draft.trim();
    if (text.length < 3) {
      setEvalError('Say or write a little more before submitting — a few words is enough to start.');
      return;
    }
    const token = ++requestToken.current;
    const question = q;
    const section = currentSection;
    setEvaluating(true);
    setEvalError(null);

    const result = await requestEvaluation({
      question: question.question,
      modelAnswer: question.answer,
      sectionTitle: section.title,
      kindLabel: KIND_BY_ID[kindOf(question) ?? 'concept'].label,
      difficulty: question.difficulty,
      answer: text,
      lang: voice.lang,
    }, question);

    if (!mounted.current || requestToken.current !== token) return;

    // "Too vague to mark" is not a zero. The question stays open, nothing is recorded, and the
    // learner is asked for one concrete point instead of being scored on a shrug.
    if (result.evaluation.status === 'needs-clarification') {
      setEvaluation({ value: result.evaluation, source: result.source, note: result.note });
      setEvaluating(false);
      if (voiceOn) {
        voice.speak('I need a little more detail before I can mark that. Please add one concrete point or example, then submit again.');
      }
      return;
    }

    const verdict = verdictForScore(result.evaluation.score);
    const prev = state.attempts[bankAttempt(question.id)];
    const patch: Parameters<typeof recordAttempt>[1] = {
      tries: (prev?.tries ?? 0) + 1,
      answer: text,
      score: result.evaluation.score,
    };
    // A partial answer is not a pass and not a declared failure: it leaves the verdict untouched
    // while still recording the text and the measured score.
    if (verdict !== 'partial') patch.done = verdict === 'correct';
    recordAttempt(bankAttempt(q.id), patch);

    if (verdict === 'correct') {
      addXp(10, 'interview', 'Interview round');
    } else if (verdict === 'incorrect') {
      addMistake({
        section: question.sectionId,
        topic: (question.tags ?? [])[0] ?? TYPE_LABEL[question.type] ?? question.type,
        question: question.question.slice(0, 140),
        myAnswer: text.slice(0, 220),
        correct: result.evaluation.modelAnswer.slice(0, 240),
        type: 'interview',
        source: 'interview',
      });
      setState((s) => ({
        ...s,
        review: { ...s.review, [question.sectionId]: { level: 0, last: new Date().toISOString() } },
      }));
    }

    setAnswers((list) => [
      ...list,
      {
        questionId: question.id,
        sectionId: question.sectionId,
        sectionTitle: section.title,
        kind: kindOf(question) ?? 'concept',
        difficulty: question.difficulty,
        question: question.question,
        modelAnswer: result.evaluation.modelAnswer || question.answer,
        answer: text,
        evaluation: result.evaluation,
        verdict,
        status: result.evaluation.status,
        source: result.source,
        seconds: PER_QUESTION_SECONDS - leftRef.current,
        retries,
      },
    ]);
    setRetries(0);
    setAsked((ids) => [...ids, question.id]);
    setEvaluation({ value: result.evaluation, source: result.source, note: result.note });
    setEvaluating(false);
    if (voiceOn) voice.speak(evaluationSpeech(result.evaluation, verdict));
  };

  const report = useMemo(() => buildInterviewReport({
    answers,
    skipped,
    planned: queue.length,
    subject: subjectLabel,
    subjectId: trackDef?.id ?? '',
    seconds: elapsed,
  }), [answers, skipped, queue.length, subjectLabel, trackDef?.id, elapsed]);

  /* -------------------------------- the data -------------------------------- */

  const subjectInventory = useMemo(() => {
    if (!range) return 0;
    return entries
      .filter((e) => e.no >= range.from && e.no <= range.to)
      .reduce((total, e) => total + modeDef.kinds.reduce((sum, k) => sum + kindCounts(e)[k], 0), 0);
  }, [entries, range, modeDef]);

  const headNote = !trackDef
    ? 'Pick a subject. Each one opens its own setup screen — difficulty, round type and length.'
    : phase === 'report'
      ? `${modeDef.label} round · ${levelDef.label} · every number below comes from the answers evaluated in this sitting.`
      : phase === 'live'
        ? `${modeDef.label} round · ${levelDef.label} · answer by voice or text; the evaluator marks it.`
        : manifest
          ? `${subjectInventory} stored questions match this round type. The interviewer marks your answer instead of just revealing one.`
          : manifestSlow
            ? 'The question manifest did not load — check your connection and reload.'
            : 'Reading the question manifest…';

  /* One page title for all four phase views: the layout contract allows exactly one h1 per page. */
  const pageHead = (
    <div className="iv-brand">
      <BrandMark size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ margin: 0 }}>
          {!trackDef ? '🎤 Interview Room' : phase === 'report' ? `Interview report — ${subjectLabel}` : `${subjectLabel} interview`}
        </h1>
        <p className="muted small" style={{ margin: '2px 0 0' }}>{headNote}</p>
      </div>
    </div>
  );

  const picker = (
    <div>
      <HubCrumb hub="/interviews" hubLabel="Interview" page="Interview Room" />
      {pageHead}
      <div className="tile-grid">
        {TRACK_DEFS.map((d) => {
          const r = ranges.find((x) => x.id === d.id);
          if (!r) return null;
          const inv = entries.filter((e) => e.no >= r.from && e.no <= r.to);
          const total = inv.reduce((a, e) => a + INTERVIEW_KINDS.reduce((b, k) => b + kindCounts(e)[k.id], 0), 0);
          const Icon = d.icon;
          return (
            <Link key={d.id} to={`/interview-mode?subject=${d.id}`} className="tile">
              <span className="ic"><Icon size={18} /></span>
              <span className="t" style={{ flex: 1, minWidth: 0 }}>
                <b>{t(d.nameKey as LocaleKey)}</b>
                <span>{manifest ? `${total} stored interview questions` : '…'}</span>
              </span>
            </Link>
          );
        })}
      </div>
      {manifestSlow && (
        <p className="small" style={{ color: 'var(--amber)' }}>
          The question manifest is not loading. Check the connection and reload — the counts above stay
          unknown until it arrives.
        </p>
      )}
    </div>
  );

  if (!trackDef || !range) return picker;

  /* --------------------------------- setup --------------------------------- */

  if (phase === 'setup') {
    return (
      <div>
        <HubCrumb hub="/interviews" hubLabel="Interview" page="Interview Room" />
        {pageHead}

        <div className="sec-head"><h2>Round type</h2><span className="line" /></div>
        <div className="iv-mode-grid">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`iv-mode${m.id === mode ? ' on' : ''}`}
              aria-pressed={m.id === mode}
              onClick={() => setMode(m.id)}
            >
              <b>{m.emoji} {m.label}</b>
              <span className="small muted">{m.blurb}</span>
            </button>
          ))}
        </div>

        <div className="sec-head"><h2>Difficulty</h2><span className="line" /></div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {LEVELS.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`chip${l.id === level ? ' on' : ''}`}
              style={{ cursor: 'pointer' }}
              aria-pressed={l.id === level}
              onClick={() => setLevel(l.id)}
            >
              {l.label} · {l.difficulties.join(' / ')}
            </button>
          ))}
        </div>

        <div className="sec-head"><h2>Length</h2><span className="line" /></div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {([3, 5, 10] as const).map((n) => (
            <button
              key={n}
              type="button"
              className={`chip${n === size ? ' on' : ''}`}
              style={{ cursor: 'pointer' }}
              aria-pressed={n === size}
              onClick={() => setSize(n)}
            >
              {n} questions
            </button>
          ))}
          <button
            type="button"
            className={`chip${size === 'all' ? ' on' : ''}`}
            style={{ cursor: 'pointer' }}
            aria-pressed={size === 'all'}
            onClick={() => setSize('all')}
          >
            All questions
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>
          {size === 'all'
            ? `Every eligible stored question in this subject is asked for the ${modeDef.label.toLowerCase()} round. ${subjectInventory} match this round type across all levels; the exact ${levelDef.label.toLowerCase()} total is fixed when the session starts.`
            : `One question per planned chapter. ${subjectInventory} stored questions match this round type in this subject.`}
        </p>

        <div className="sec-head"><h2>Voice</h2><span className="line" /></div>
        <div className="card" style={{ marginTop: 0 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className={`btn small${voiceOn ? ' primary' : ''}`} aria-pressed={voiceOn} onClick={() => setVoiceOn((v) => !v)}>
              {voiceOn ? <Volume2 size={13} /> : <VolumeX size={13} />} Voice assistant {voiceOn ? 'on' : 'off'}
            </button>
            <button type="button" className={`btn small${autoRead ? ' primary' : ''}`} aria-pressed={autoRead} onClick={() => setAutoRead((v) => !v)} disabled={!voiceOn}>
              <Play size={13} /> Read each question aloud
            </button>
            <label className="small muted" htmlFor="iv-rate">Speed {voice.rate.toFixed(1)}×</label>
            <input
              id="iv-rate"
              type="range"
              min={0.7}
              max={1.4}
              step={0.1}
              value={voice.rate}
              onChange={(e) => voice.setRate(Number(e.target.value))}
            />
            <label className="small muted" htmlFor="iv-lang">Speech language</label>
            <select id="iv-lang" value={voice.lang} onChange={(e) => voice.setLang(e.target.value === 'hi-IN' ? 'hi-IN' : 'en-IN')}>
              <option value="en-IN">English</option>
              <option value="hi-IN">Hinglish</option>
            </select>
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            {voiceSupportNote(voice.supported)
              || `Questions are spoken with the best ${voice.lang === 'hi-IN' ? 'Hindi' : 'female English'} voice this device or server offers; the transcript appears in the answer box for you to edit.`}
          </p>
          {voice.error && (
            <p className="small" style={{ color: 'var(--amber)', margin: '6px 0 0' }}>
              {voice.error} <button className="btn small ghost" onClick={voice.dismissError}>Dismiss</button>
            </p>
          )}
        </div>

        <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn primary"
            onClick={start}
            disabled={!manifest || subjectInventory === 0}
          >
            <Play size={14} /> Start interview
          </button>
          <Link className="btn small ghost" to="/interview-mode"><ChevronLeft size={12} /> Change subject</Link>
          <span className="small muted">
            {modeDef.timed ? `Timed round · ${PER_QUESTION_SECONDS / 60} minutes per question` : 'Untimed · pause whenever you need to'}
          </span>
        </div>
        {!manifest && !manifestSlow && <p className="small muted">Loading the question manifest…</p>}
      </div>
    );
  }

  /* --------------------------------- report -------------------------------- */

  if (phase === 'report') {
    return (
      <div>
        <HubCrumb hub="/interviews" hubLabel="Interview" page="Interview Room" />
        {pageHead}

        <div className="grid2" style={{ marginTop: 12 }}>
          <div className="card" style={{ margin: 0 }}>
            <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div className="small muted">Overall score</div>
                <div className="iv-score">{report.averageScore === null ? '—' : `${report.averageScore}%`}</div>
                <div className="small muted">
                  {report.answered} answered of {report.planned} planned{report.skipped ? ` · ${report.skipped} skipped` : ''}
                  {report.remaining ? ` · ${report.remaining} not reached` : ''}{report.retries ? ` · ${report.retries} re-answered` : ''} ·{' '}
                  {Math.floor(report.seconds / 60)}m {report.seconds % 60}s
                </div>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className="chip easy"><CheckCircle2 size={12} /> {report.correct} correct</span>
                <span className="chip">{report.partial} partial</span>
                <span className="chip hard">{report.incorrect} incorrect</span>
                <span className="chip">accuracy {report.accuracyPct === null ? '—' : `${report.accuracyPct}%`}</span>
              </div>
            </div>
            <Bar pct={report.averageScore ?? 0} />
            {report.answered === 0 && (
              <p className="small" style={{ color: 'var(--amber)', margin: '8px 0 0' }}>
                No answer was evaluated in this sitting, so there is no score to report.
              </p>
            )}
          </div>
          <div className="card" style={{ margin: 0 }}>
            <h2 style={{ marginTop: 0 }}>Topics</h2>
            {report.topics.length === 0 && <p className="small muted">Nothing answered yet.</p>}
            {report.topics.map((topic) => (
              <div key={topic.sectionId} className="iv-topic">
                <span className="small">{topic.title} <span className="muted">· {topic.answered} answered</span></span>
                <b className="small">{topic.average}%</b>
                <span style={{ gridColumn: '1 / -1' }}><Bar pct={topic.average} /></span>
              </div>
            ))}
            {report.strongest.length > 0 && (
              <p className="small muted" style={{ margin: '8px 0 0' }}>
                Strongest: {report.strongest.map((x) => `${x.title} (${x.average}%)`).join(', ')}.
              </p>
            )}
            {report.weakest.length > 0 && (
              <p className="small" style={{ margin: '4px 0 0', color: 'var(--amber)' }}>
                Needs work: {report.weakest.map((x) => `${x.title} (${x.average}%)`).join(', ')}.
              </p>
            )}
          </div>
        </div>

        {report.revision.length > 0 && (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Revise these concepts</h2>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {report.revision.map((item) => <span key={item} className="chip">{item}</span>)}
            </div>
          </div>
        )}

        <div className="card">
          <h2 style={{ marginTop: 0 }}>What to do next</h2>
          {report.recommendations.map((rec) => (
            <div key={rec.to + rec.label} className="row spread" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <span className="small">{rec.label} <span className="muted">— {rec.why}</span></span>
              <Link className="btn small ghost" to={rec.to}>Open <ArrowRight size={12} /></Link>
            </div>
          ))}
        </div>

        <div className="sec-head"><h2>Every answer</h2><span className="line" /></div>
        {report.answers.length === 0 && <div className="card muted small">No evaluated answers in this sitting.</div>}
        {report.answers.map((answer, i) => (
          <details key={answer.questionId} className="card">
            <summary className="small" style={{ cursor: 'pointer' }}>
              <b>Q{i + 1} · {answer.sectionTitle}</b> — {statusLabel(answer.status)} · {answer.evaluation.score}% ·{' '}
              {answer.source === 'ai' ? 'AI evaluation' : 'built-in rubric'}
              {answer.retries ? ` · ${answer.retries} re-answer${answer.retries === 1 ? '' : 's'}` : ''}
            </summary>
            <p className="small" style={{ marginBottom: 4 }}><b>{answer.question}</b></p>
            <p className="small muted" style={{ marginTop: 0 }}>Your answer: {answer.answer}</p>
            <p className="small">What you got right: {answer.evaluation.conceptsUnderstood.join(', ') || 'nothing identified yet'}</p>
            <p className="small">Still missing: {answer.evaluation.missingConcepts.join(', ') || 'nothing — this was complete'}</p>
          </details>
        ))}

        <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn primary" onClick={start}><RotateCcw size={14} /> Restart this round</button>
          <button type="button" className="btn" onClick={toSetup}>Change setup</button>
          <Link className="btn small ghost" to="/interviews">Interview hub <ArrowRight size={12} /></Link>
        </div>
        <p className="small muted">
          Answers are saved to the same Question Bank records the bank page writes, so this round updates
          the progress the bank shows. The report itself is recomputed from this sitting — it is not stored
          as fake history.
        </p>
      </div>
    );
  }

  /* ---------------------------------- live --------------------------------- */

  const total = queue.length;
  const progress = total ? ((step + (evaluation ? 1 : 0)) / total) * 100 : 0;
  const remaining = modeDef.timed ? Math.max(0, questionLeft) : null;
  const stillToAsk = Math.max(0, total - step - (evaluation ? 1 : 0));

  return (
    <div>
      <HubCrumb hub="/interviews" hubLabel="Interview" page="Interview Room" />
      {pageHead}

      <div className="card glow" style={{ marginTop: 8 }}>
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="small muted">
            {levelDef.label} · question {Math.min(step + 1, total || 1)} of {total || '—'} ·{' '}
            {paused ? 'paused' : evaluating ? 'AI evaluating' : voice.listening ? 'listening' : 'live'}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="chip"><Timer size={12} /> {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
            {remaining !== null && (
              <span className={`chip${remaining <= 20 ? ' hard' : ''}`}>⏳ {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} left</span>
            )}
            <span className="chip">{report.correct} correct · {report.answered} answered</span>
            <span className="chip">{stillToAsk} remaining</span>
            <span className="chip">{answers.length} evaluated</span>
          </div>
        </div>
        <Bar pct={progress} />
      </div>

      {notice && (
        <p className="small" style={{ color: 'var(--amber)', margin: '8px 0 0' }}>
          {notice} <button className="btn small ghost" onClick={() => setNotice(null)}>Dismiss</button>
        </p>
      )}

      {loadNote && !prepError && <p className="small muted" style={{ margin: '6px 0 0' }}>{loadNote}</p>}

      <div className="iv-live-grid" style={{ marginTop: 12 }}>
        <div>
          <div className="card" style={{ marginTop: 0 }}>
            {preparing && (
              <div>
                <h2 style={{ marginTop: 0 }}>Preparing the interview…</h2>
                <p className="small muted">
                  Reading the chapter banks for this subject. This one step is what makes the question
                  total exact — nothing starts until every bank has answered.
                </p>
                <div className="iv-status" role="status" aria-live="polite">
                  <span className="iv-dots"><i /><i /><i /></span>
                  <span className="small">Loading question banks…</span>
                </div>
              </div>
            )}

            {!preparing && prepError && (
              <div>
                <h2 style={{ marginTop: 0 }}>This round cannot start</h2>
                <p className="small muted">{prepError}</p>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn small" onClick={() => void start()}>Try again</button>
                  <button className="btn small ghost" onClick={toSetup}>Change setup</button>
                  <Link className="btn small ghost" to="/questions">Question Bank <ArrowRight size={12} /></Link>
                </div>
              </div>
            )}

            {!preparing && !prepError && !currentSection && (
              <div>
                <h2 style={{ marginTop: 0 }}>No question available for this round</h2>
                <p className="small muted">
                  This subject has no stored question matching this round type. Change the setup or pick
                  another subject — nothing is invented to fill the gap.
                </p>
                <button className="btn small" onClick={toSetup}>Change setup</button>
              </div>
            )}

            {q && currentSection && (
              <>
                <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <span className="small muted">
                    {currentSection.sectionId.toUpperCase()} · {currentSection.title} · {qKind ? KIND_BY_ID[qKind].label : TYPE_LABEL[q.type]} · {q.difficulty}
                  </span>
                  <div className="row" style={{ gap: 6 }}>
                    {levelRelaxed && <span className="chip">level relaxed — bank has no {levelDef.label.toLowerCase()} item here</span>}
                    <span className="chip">{step + 1} / {total}</span>
                  </div>
                </div>

                <h2 style={{ margin: '10px 0', lineHeight: 1.35 }}>{q.question}</h2>

                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="btn small" onClick={() => voice.speak(q.question)} disabled={!voice.supported.synthesis}>
                    <Volume2 size={13} /> Speak question
                  </button>
                  <button type="button" className="btn small" onClick={() => voice.speak(q.question)} disabled={!voice.supported.synthesis}>
                    <RotateCcw size={13} /> Repeat
                  </button>
                  <button type="button" className="btn small ghost" onClick={voice.stopSpeaking}>
                    <Square size={13} /> Stop speaking
                  </button>
                  <button
                    type="button"
                    className={`btn small${voice.listening ? ' primary' : ''}`}
                    aria-pressed={voice.listening}
                    disabled={!voiceOn || !voice.supported.recognition}
                    onClick={() => (voice.listening
                      ? voice.stopListening()
                      : voice.startListening((text) => setDraft((d) => (d ? `${d} ${text}` : text))))}
                  >
                    {voice.listening ? <MicOff size={13} /> : <Mic2 size={13} />}
                    {voice.listening ? 'Stop listening' : 'Answer by voice'}
                  </button>
                </div>
                {!voice.supported.recognition && (
                  <p className="small muted" style={{ margin: '6px 0 0' }}>
                    This browser has no speech recognition. Type the answer instead — everything else works.
                  </p>
                )}
                {voice.listening && (
                  <p className="small" style={{ margin: '6px 0 0', color: 'var(--cyan)' }}>
                    Listening… {voice.interim || 'speak now'} <span className="iv-wave"><i /><i /><i /><i /></span>
                  </p>
                )}
                {voice.error && (
                  <p className="small" style={{ margin: '6px 0 0', color: 'var(--amber)' }}>
                    {voice.error} <button className="btn small ghost" onClick={voice.dismissError}>Dismiss</button>
                  </p>
                )}

                <label className="small muted" htmlFor="iv-answer" style={{ display: 'block', marginTop: 10 }}>
                  Your answer {evaluation ? '(submitted)' : '— review and edit the transcript before sending'}
                </label>
                <textarea
                  id="iv-answer"
                  className="console"
                  rows={q.type === 'coding' || q.type === 'debug' ? 7 : 5}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={q.type === 'coding' || q.type === 'debug'
                    ? 'Write the code or the approach, then submit for review.'
                    : 'Say it out loud first, then fix the transcript here.'}
                  disabled={!!evaluation || evaluating}
                />
                <div className="row spread small muted" style={{ marginTop: 4 }}>
                  <span>{draft.trim().split(/\s+/).filter(Boolean).length} words</span>
                  <span>{voice.lang === 'hi-IN' ? 'Hinglish accepted' : 'English accepted'} · voice or text</span>
                </div>

                {(evaluating || voice.speaking) && (
                  <div className="iv-status" role="status" aria-live="polite">
                    <span className="iv-dots"><i /><i /><i /></span>
                    <span className="small">
                      {evaluating ? 'Evaluating your answer — checking correctness and missing concepts…' : 'Speaking the explanation…'}
                    </span>
                    {voice.speaking && <span className="iv-wave"><i /><i /><i /><i /></span>}
                  </div>
                )}

                {evalError && (
                  <div className="card" style={{ borderColor: 'rgba(248,113,113,.4)', marginTop: 8 }}>
                    <p className="small" style={{ margin: 0, color: 'var(--red)' }}><AlertTriangle size={13} /> {evalError}</p>
                  </div>
                )}

                <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn primary" onClick={submit} disabled={evaluating || !!evaluation || !draft.trim()}>
                    <Send size={14} /> {evaluating ? 'Evaluating…' : 'Submit for evaluation'}
                  </button>
                  {evalError && (
                    <button type="button" className="btn" onClick={submit} disabled={evaluating || !!evaluation}>
                      <RotateCcw size={13} /> Retry
                    </button>
                  )}
                  {!evaluation && (
                    <button type="button" className="btn small" onClick={() => advance({ skipped: true })} disabled={evaluating}>
                      <SkipForward size={13} /> Skip question
                    </button>
                  )}
                  {evaluation && evaluation.value.status === 'needs-clarification' && (
                    <>
                      <button type="button" className="btn primary" onClick={retryAnswer}>
                        <RotateCcw size={13} /> Add detail and re-submit
                      </button>
                      <button type="button" className="btn small" onClick={() => advance({ skipped: true })}>
                        <SkipForward size={13} /> Skip for now
                      </button>
                    </>
                  )}
                  {evaluation && evaluation.value.status !== 'needs-clarification' && (
                    <>
                      <button type="button" className="btn" onClick={retryAnswer}>
                        <RotateCcw size={13} /> Try again
                      </button>
                      <button type="button" className="btn primary" onClick={() => advance()}>
                        {step + 1 >= total ? 'Finish and see report' : 'Next question'} <ArrowRight size={13} />
                      </button>
                    </>
                  )}
                  <button type="button" className="btn small ghost" onClick={() => setPaused((p) => !p)}>
                    {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? 'Resume' : 'Pause'}
                  </button>
                  <button type="button" className="btn small ghost" onClick={() => { voice.stopSpeaking(); setPhase('report'); }}>
                    <Square size={13} /> End interview
                  </button>
                </div>
              </>
            )}
          </div>

          {evaluation && (
            <div className={`iv-eval${evaluation.value.score < 45 ? ' iv-eval-bad' : ''}`}>
              <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div className="small muted">Evaluation</div>
                  <div className="iv-score">{evaluation.value.score}<span className="small"> / 100</span></div>
                  <b>{statusLabel(evaluation.value.status)}</b>
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <span className="chip">{ACCURACY_LABEL[evaluation.value.technicalAccuracy] ?? evaluation.value.technicalAccuracy}</span>
                  <span className="chip">
                    {evaluation.source === 'ai' ? <><Sparkles size={12} /> AI evaluation</> : 'Built-in rubric'}
                  </span>
                </div>
              </div>

              {evaluation.note && (
                <p className="small" style={{ margin: '8px 0 0', color: 'var(--amber)' }}>{evaluation.note}</p>
              )}

              {evaluation.value.status === 'needs-clarification' && (
                <p className="small" style={{ margin: '8px 0 0', color: 'var(--amber)' }}>
                  This answer was too vague to mark, so it is not counted in the report yet. Add one concrete
                  point or example and submit again.
                </p>
              )}

              <div className="small" style={{ marginTop: 8 }}>
                <b>What you got right</b>
                <ul className="iv-list">
                  {(evaluation.value.conceptsUnderstood.length ? evaluation.value.conceptsUnderstood : ['Nothing identified yet — read the explanation below.']).map((x) => <li key={x}>{x}</li>)}
                </ul>
                <b>Still missing</b>
                <ul className="iv-list">
                  {(evaluation.value.missingConcepts.length ? evaluation.value.missingConcepts : ['Nothing — this answer was complete.']).map((x) => <li key={x}>{x}</li>)}
                </ul>
                {evaluation.value.mistakes.length > 0 && (
                  <>
                    <b>Specific mistakes</b>
                    <ul className="iv-list">{evaluation.value.mistakes.map((x) => <li key={x}>{x}</li>)}</ul>
                  </>
                )}
                {evaluation.value.evidence.length > 0 && (
                  <>
                    <b>From your answer</b>
                    <ul className="iv-list">{evaluation.value.evidence.map((x) => <li key={x}>{x}</li>)}</ul>
                  </>
                )}
                <b>Explanation</b>
                <p style={{ margin: '2px 0 6px' }}>{evaluation.value.explanation}</p>
                <b>Improved model answer</b>
                <p style={{ margin: '2px 0 6px' }}>{evaluation.value.modelAnswer}</p>
                <b>Next step</b>
                <p style={{ margin: '2px 0 0' }}>{evaluation.value.nextStep}</p>
                {evaluation.value.followUp && (
                  <>
                    <b>Follow-up to think about</b>
                    <p style={{ margin: '2px 0 0' }}>{evaluation.value.followUp}</p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="card" style={{ marginTop: 0 }}>
            <h2 style={{ marginTop: 0, fontSize: 15 }}>This sitting</h2>
            <p className="small muted" style={{ marginTop: 0 }}>
              {modeDef.label} · {levelDef.label} · {total} in this round{stillToAsk ? ` · ${stillToAsk} still to ask` : ''}.
            </p>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <span className="chip"><CheckCircle2 size={12} /> {report.correct} correct</span>
              <span className="chip">{report.partial} partial</span>
              <span className="chip">{report.incorrect} incorrect</span>
            </div>
            <Bar pct={report.accuracyPct ?? 0} />
            <p className="small muted" style={{ marginTop: 8 }}>
              Answers are saved to the same Question Bank records the bank page writes. The report at the
              end is built from these evaluations, not from a template.
            </p>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="btn small ghost" onClick={toSetup}><ChevronLeft size={12} /> Setup</button>
              <button type="button" className="btn small ghost" onClick={() => setPhase('report')}>Report so far</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
