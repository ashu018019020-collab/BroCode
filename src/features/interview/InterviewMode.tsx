import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronLeft, CirclePause, Mic2, Pause, Play, RotateCcw,
  Send, SkipForward, Sparkles, Square, Volume2, VolumeX, X,
} from 'lucide-react';
import { HubCrumb } from '../../components/learning/SectionChrome';
import { BrandMark } from '../../components/shared/BrandMark';
import { useVoiceTutor } from '../../components/shared/useVoiceTutor';
import { useOnlineStatus } from '../../components/shared/useOnlineStatus';
import { AiVoiceRow } from '../../components/shared/AiVoiceRow';
import { Bar } from '../../components/ui/ui';
import { useI18n } from '../../app/i18n';
import type { LocaleKey } from '../../app/i18n/locales';
import { TRACK_DEFS } from '../../app/App';
import { useStore, setState, addXp, addMistake, recordAttempt } from '../../core/storage/store';
import { useBankManifest, loadBanksFor, TYPE_LABEL } from '../../core/data/questions';
import type { BankManifestEntry } from '../../core/data/questions';
import type { QuestionRecord } from '../../core/data/schema';
import { bankAttempt, INTERVIEW_DRAFT_KEY, INTERVIEW_HISTORY_KEY } from '../../core/platform/keys';
import { offlineRoomNote } from '../../core/platform/offline';
import {
  INTERVIEW_KINDS, KIND_BY_ID, eligibleInBank, kindCounts, kindOf, pickQuestion, planSections,
} from '../../core/assessment/interview-room';
import {
  adaptiveLevel, appendHistory, DEFAULT_LEVEL, DEFAULT_MODE, DEFAULT_STYLE, HISTORY_MAX, historyFromReport,
  INTERVIEWER_STYLES, LEVELS, MODES, PER_QUESTION_SECONDS,
  type InterviewHistoryEntry,
  buildInterviewReport, collectQuestions, evaluationSpeech, levelPool, modeById, questionHintSlots,
  statusLabel, styleById, verdictForScore,
  type AnswerEvaluation, type EvaluationSource, type InterviewerStyleId, type InterviewModeId, type LevelId,
  type SessionAnswer, type SessionQuestion,
} from '../../core/assessment/interview-session';
import { actionLegal, phaseLabel, type VoiceAction, type VoicePhase } from '../../core/ai/voice-session';
import { requestEvaluation } from '../../core/ai/interview';
import { voiceSupportNote } from '../../core/ai/voice';
import './interview-room.css';

/**
 * The Interview Room: subject → setup → a live round → a report derived from real evaluations.
 *
 * Four rules shape this page:
 *
 *  1. THE BANK IS THE QUESTION SOURCE. The pool is the canonical bank's own records, the same
 *     `sNN:type:i` ids the Question Bank writes its `qb:` attempt under, so an answer here and an
 *     answer there are ONE record. Nothing is generated on the client.
 *  2. THE AI IS ASKED, NOT IMITATED. Every evaluation is a real request with a deadline. The
 *     thinking indicator shows only while that request (or speech, or recognition) is genuinely in
 *     flight; when the API is absent the panel says "Built-in rubric" and the deterministic keyword
 *     score is displayed instead. Hints come from the authored answer's own rubric keywords —
 *     `questionHintSlots` — never from invented text.
 *  3. VOICE MODE IS A LATCH, NOT A CASUALTY OF A TURN. The mic and the speaker are separate
 *     machines (`core/ai/voice-session.ts` holds the tested transition rules): recording never
 *     disables the voice, one finished audio action never ends the sitting, and the hook
 *     (`useVoiceTutor`) recovers a stalled chain itself. The UI's `voicePhase` is DERIVED from the
 *     real audio states — there is no second, divergent "is the voice alive" boolean here.
 *  4. A SITTING SURVIVES NAVIGATION. The unfinished round is saved under the device-only
 *     `INTERVIEW_DRAFT_KEY` after every evaluated answer, offered back on return, and the finished
 *     summary is appended to `INTERVIEW_HISTORY_KEY` — the same device-local family as the mentor
 *     log, never an AppState attempt family.
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

interface SavedDraft {
  version: number;
  savedAt: string;
  subjectId: string;
  mode: InterviewModeId;
  level: LevelId;
  style: InterviewerStyleId;
  size: SessionSize;
  autoNext: boolean;
  step: number;
  elapsed: number;
  skipped: number;
  asked: string[];
  answers: SessionAnswer[];
  queue: SessionQuestion[];
  /**
   * The transcript that is TYPED or SPOKEN but not yet submitted. Saved so a connection drop, a
   * navigation or a crash costs nothing — the one piece of unsaved work the room used to lose.
   */
  answer?: string;
}

const DRAFT_VERSION = 1;

function readDraft(): SavedDraft | null {
  try {
    const raw = localStorage.getItem(INTERVIEW_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedDraft;
    if (!parsed || parsed.version !== DRAFT_VERSION) return null;
    // The sitting belongs to exactly one subject; a draft from another subject is noise, not data.
    if (!parsed.subjectId || !Array.isArray(parsed.answers) || !Array.isArray(parsed.queue)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDraft(draft: SavedDraft | null) {
  try {
    if (draft) localStorage.setItem(INTERVIEW_DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(INTERVIEW_DRAFT_KEY);
  } catch { /* quota or blocked */ }
}

function readHistory(): unknown[] {
  try {
    const raw = localStorage.getItem(INTERVIEW_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function InterviewMode() {
  const { t } = useI18n();
  const state = useStore();
  const manifest = useBankManifest();
  const [params, setParams] = useSearchParams();
  const voice = useVoiceTutor();
  /** Network status for the in-room offline note — the shell banner covers the app globally. */
  const online = useOnlineStatus();

  const ranges = useMemo(() => TRACK_DEFS.map((d) => ({ id: d.id, from: d.from, to: d.to })), []);
  const trackDef = TRACK_DEFS.find((d) => d.id === params.get('subject')) ?? null;
  const range = trackDef ? ranges.find((r) => r.id === trackDef.id) ?? null : null;
  const entries: BankManifestEntry[] = manifest?.sections ?? [];

  const [phase, setPhase] = useState<Phase>('setup');
  const [mode, setMode] = useState<InterviewModeId>(DEFAULT_MODE);
  const [level, setLevel] = useState<LevelId>(DEFAULT_LEVEL);
  const [size, setSize] = useState<SessionSize>(() => clampSize(params.get('size')));
  const [style, setStyle] = useState<InterviewerStyleId>(DEFAULT_STYLE);
  const [autoNext, setAutoNext] = useState(false);
  /** The chapter the round is drawn from. null = every chapter of the subject. */
  const [topicId, setTopicId] = useState<string | null>(null);

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
  const [hintOpen, setHintOpen] = useState(false);
  const [followUpDraft, setFollowUpDraft] = useState('');
  const [clearArmed, setClearArmed] = useState(false);
  const [savedDraft, setSavedDraft] = useState<SavedDraft | null>(() => readDraft());
  const [history, setHistory] = useState<InterviewHistoryEntry[]>(() => readHistory() as InterviewHistoryEntry[]);
  const [railTab, setRailTab] = useState<'all' | 'topics'>('all');
  /** Review navigation: when set, the room shows an earlier question read-only. */
  const [viewIndex, setViewIndex] = useState<number | null>(null);

  const modeDef = modeById(mode);
  const levelDef = LEVELS.find((l) => l.id === level) ?? LEVELS[1];
  const styleDef = styleById(style);
  const subjectLabel = trackDef ? t(trackDef.nameKey as LocaleKey) : 'Interview';

  /* ------------------------------- the queue ------------------------------- */

  // The lead kind of the mode weights the SECTION ORDER (the planner); the mode's whole kind list
  // decides which questions are eligible inside each section.
  const kind = KIND_BY_ID[modeDef.kinds[0]];
  const weak = useMemo(() => new Set(state.mistakes.filter((m) => !m.fixed).map((m) => m.section)), [state.mistakes]);

  const [queue, setQueue] = useState<SessionQuestion[]>([]);
  const [plannedSections, setPlannedSections] = useState<string[]>([]);
  /** The round's ELIGIBLE questions per section, loaded once at start. The adaptive picker reads it. */
  const banksRef = useRef<Map<string, QuestionRecord[]> | null>(null);
  const submittingRef = useRef(false);
  const autoAdvancedFor = useRef<string | null>(null);

  const [preparing, setPreparing] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const [levelRelaxed, setLevelRelaxed] = useState(false);
  const [retries, setRetries] = useState(0);

  const current = queue[step] ?? null;
  const q = current?.question ?? null;
  const currentSection = current ? { sectionId: current.sectionId, title: current.sectionTitle } : null;
  const qKind = q ? kindOf(q) : null;
  const hintSlots = useMemo(() => (q ? questionHintSlots(q) : []), [q]);
  const currentFollowUp = useMemo(
    () => answers.find((a) => a.questionId === q?.id)?.followUpEvaluation ?? null,
    [answers, q?.id],
  );

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
  const greeted = useRef(false);
  useEffect(() => {
    if (phase !== 'live' || !q || !voiceOn || !autoRead || paused) return;
    if (spokenFor.current === q.id) return;
    spokenFor.current = q.id;
    const spoken = greeted.current ? q.question : `${styleDef.opening} ${q.question}`;
    greeted.current = true;
    voice.speak(spoken);
    // `voice.speak` is stable enough for this trigger; the question id is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, q?.id, voiceOn, autoRead, paused]);

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

  /**
   * The live status derives from WHAT THE AUDIO IS REALLY DOING — the hook's own states plus the
   * page's evaluation flight. `core/ai/voice-session.ts` documents why deriving (not mirroring)
   * is the correct form: there can be no second machine drifting away from reality.
   */
  const voicePhase: VoicePhase = useMemo(() => {
    if (phase !== 'live') return 'idle';
    if (paused) return 'paused';
    if (evaluating) return 'processing';
    if (voice.listening) return 'listening';
    if (voice.speaking) return 'speaking';
    if (voice.error || evalError) return 'error';
    return 'idle';
  }, [phase, paused, evaluating, voice.listening, voice.speaking, voice.error, evalError]);

  /** The recording clock: real seconds the mic has been open, shown while it is open. */
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  useEffect(() => {
    if (!voice.listening) return;
    setRecordedSeconds(0);
    const timer = window.setInterval(() => setRecordedSeconds((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [voice.listening]);

  /* ------------------------------- transitions ------------------------------ */

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const requestToken = useRef(0);

  /* Consecutive-verdict streak the ADAPTIVE style walks the ladder with. */
  const streak = useMemo(() => {
    let correct = 0;
    let incorrect = 0;
    for (let i = answers.length - 1; i >= 0; i -= 1) {
      const v = answers[i].verdict;
      if (v === 'correct') { if (incorrect > 0) break; correct += 1; }
      else if (v === 'incorrect') { if (correct > 0) break; incorrect += 1; }
      else break;
    }
    return { correct, incorrect };
  }, [answers]);

  /** The adaptive level RIGHT NOW — the level the next pick may use. */
  const adaptiveLevelNow = useMemo(
    () => adaptiveLevel(level, streak.correct, streak.incorrect),
    [level, streak.correct, streak.incorrect],
  );

  const advance = (opts: { skipped?: boolean } = {}) => {
    // Cancel any evaluation still in flight for the question being left behind.
    requestToken.current += 1;
    submittingRef.current = false;
    spokenFor.current = null;
    setRetries(0);
    setEvaluation(null);
    setEvalError(null);
    setDraft('');
    setFollowUpDraft('');
    setHintOpen(false);
    setClearArmed(false);
    setViewIndex(null);
    autoAdvancedFor.current = null;
    setNotice(opts.skipped ? 'Question skipped — it is not counted as answered.' : null);
    setLeft(PER_QUESTION_SECONDS);
    setQuestionLeft(PER_QUESTION_SECONDS);
    expired.current = false;
    if (opts.skipped) setSkipped((n) => n + 1);
    if (step + 1 >= queue.length) {
      setPhase('report');
      voice.stopSpeaking();
      writeDraft(null);
    } else {
      setStep((n) => n + 1);
      // Weaving the queue: the ADAPTIVE style may rebuild the COMING question from the loaded
      // banks at the level the streak says — the prebuilt queue stays as the fallback.
      if (style === 'adaptive' && step + 1 < queue.length) {
        const built = buildAdaptiveStep(step + 1);
        if (built) setQueue((items) => items.map((item, i) => (i === step + 1 ? built : item)));
      }
    }
  };

  const buildAdaptiveStep = (at: number): SessionQuestion | null => {
    const banks = banksRef.current;
    if (!banks) return null;
    const sectionId = plannedSections[at];
    if (!sectionId) return null;
    const entry = entries.find((e) => e.sectionId === sectionId);
    const pool = (banks.get(sectionId) ?? []).filter((x) => {
      const k = kindOf(x);
      return k !== null && modeDef.kinds.includes(k);
    });
    if (!pool.length) return null;
    const exact = levelPool(pool, adaptiveLevelNow);
    if (exact.relaxed) setLevelRelaxed(true);
    const id = pickQuestion(exact.questions, state.attempts, { weak, avoid: new Set(asked) });
    const chosen = exact.questions.find((x) => x.id === id) ?? exact.questions[0];
    if (!chosen) return null;
    return { id: chosen.id, sectionId, sectionTitle: entry?.title ?? sectionId.toUpperCase(), question: chosen };
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
    submittingRef.current = false;
    spokenFor.current = null;
    greeted.current = false;
    autoAdvancedFor.current = null;
    setAnswers([]);
    setSkipped(0);
    setAsked([]);
    setStep(0);
    setDraft('');
    setFollowUpDraft('');
    setEvaluation(null);
    setEvalError(null);
    setNotice(null);
    setHintOpen(false);
    setClearArmed(false);
    setViewIndex(null);
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
    writeDraft(null);
    setSavedDraft(null);

    // `All Questions` needs every bank in the subject BEFORE the first question, so its total is
    // MEASURED rather than guessed and no later fetch can stall the middle of a sitting.
    // The plan is ALWAYS built from the manifest (pinned above); a chosen TOPIC then narrows the
    // same plan to that one chapter instead of re-planning from a private list.
    const subjectSections = topicId
      ? [topicId]
      : size === 'all'
        ? entries.filter((e) => e.no >= range.from && e.no <= range.to).map((e) => e.sectionId)
        : planSections(range, entries, kind.id, size);
    const banks = await loadBanksFor(subjectSections);
    if (!mounted.current) return;
    banksRef.current = new Map(
      subjectSections.map((sectionId) => {
        const bank = banks.get(sectionId) ?? null;
        return [sectionId, bank ? eligibleInBank(bank) : []];
      }),
    );

    const sections = subjectSections.map((sectionId) => {
      const entry = entries.find((e) => e.sectionId === sectionId);
      return {
        sectionId,
        title: entry?.title ?? sectionId.toUpperCase(),
        questions: banksRef.current?.get(sectionId) ?? [],
      };
    });
    const missing = sections.filter((s) => s.questions.length === 0).length;

    let items: SessionQuestion[] = [];
    let relaxed = false;
    if (size === 'all' && !topicId) {
      const collected = collectQuestions(sections, modeDef.kinds, level);
      items = collected.questions;
      relaxed = collected.relaxed;
    } else {
      // One question per planned section normally; a CHOSEN topic supplies every question of the
      // round (its pool is walked once, never repeating inside the sitting).
      for (const section of sections) {
        const exact = levelPool(section.questions, level);
        if (exact.relaxed) relaxed = true;
        const pool = exact.questions.filter((x) => {
          const k = kindOf(x);
          return k !== null && modeDef.kinds.includes(k);
        });
        if (!pool.length) continue;
        const wanted = topicId ? (size === 'all' ? pool.length : Math.min(size as number, 20)) : 1;
        const localAvoid = new Set(asked);
        for (let i = 0; i < wanted; i += 1) {
          const id = pickQuestion(pool, state.attempts, { weak, avoid: localAvoid });
          const chosen = pool.find((x) => x.id === id) ?? pool[0];
          if (!chosen) break;
          items.push({ id: chosen.id, sectionId: section.sectionId, sectionTitle: section.title, question: chosen });
          localAvoid.add(chosen.id);
        }
      }
    }

    setLevelRelaxed(relaxed);
    setQueue(items);
    setPlannedSections(subjectSections);
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
    setFollowUpDraft('');
    setEvaluation(null);
    setEvalError(null);
    setElapsed(0);
    setQueue([]);
    setPreparing(false);
    setPrepError(null);
    setLoadNote(null);
    setLevelRelaxed(false);
    setRetries(0);
    setHintOpen(false);
    setClearArmed(false);
    setViewIndex(null);
  };

  /** Restore an unfinished sitting exactly as the learner left it. */
  const resumeDraft = () => {
    const saved = savedDraft;
    if (!saved) return;
    if (saved.subjectId !== (trackDef?.id ?? '')) {
      setParams({ subject: saved.subjectId });
      return;
    }
    requestToken.current += 1;
    submittingRef.current = false;
    spokenFor.current = null;
    greeted.current = true; // the greeting belongs to a FRESH round only
    banksRef.current = null;
    setMode(saved.mode);
    setLevel(saved.level);
    setStyle(saved.style);
    setSize(saved.size);
    setAutoNext(saved.autoNext);
    setAnswers(saved.answers);
    setStep(Math.min(saved.step, Math.max(0, saved.queue.length - 1)));
    setElapsed(saved.elapsed);
    setSkipped(saved.skipped);
    setAsked(saved.asked ?? []);
    // The UNSUBMITTED transcript comes back inside its own box — the network dropping must not
    // cost the answer that was mid-flight when it happened.
    setDraft(typeof saved.answer === 'string' ? saved.answer : '');
    setFollowUpDraft('');
    setEvaluation(null);
    setEvalError(null);
    setNotice('This is your unfinished sitting — every answer below was already evaluated.');
    setPaused(false);
    setPreparing(false);
    setPrepError(null);
    setLoadNote(null);
    setLevelRelaxed(false);
    setRetries(0);
    setHintOpen(false);
    setClearArmed(false);
    setViewIndex(null);
    setLeft(PER_QUESTION_SECONDS);
    expired.current = false;
    setQueue(saved.queue);
    setPlannedSections(saved.queue.map((item) => item.sectionId));
    setPhase('live');
  };

  /** Re-open the current question. The old evaluation is discarded, so a re-answer replaces it in
   *  the report instead of counting twice. */
  const retryAnswer = () => {
    requestToken.current += 1;
    submittingRef.current = false;
    autoAdvancedFor.current = null;
    setAnswers((list) => list.filter((a) => a.questionId !== q?.id));
    setEvaluation(null);
    setEvalError(null);
    setFollowUpDraft('');
    setRetries((n) => n + 1);
    setLeft(PER_QUESTION_SECONDS);
    expired.current = false;
  };

  /** Guard state so the draft effect and the auto-advance read what IS stored, not a past render. */
  const liveRef = useRef({
    phase, paused, answers, skipped, step, queue, elapsed, asked,
    mode, level, style, size, autoNext, preparing, trackId: trackDef?.id ?? '',
  });
  liveRef.current = {
    phase, paused, answers, skipped, step, queue, elapsed, asked,
    mode, level, style, size, autoNext, preparing, trackId: trackDef?.id ?? '',
  };

  const submit = async (followUpQuestion?: string) => {
    if (!q || !currentSection || evaluating || preparing) return;
    if (submittingRef.current) return; // one submission in flight at a time — no double records
    // The follow-up has its OWN input box (the main answer is already submitted); without one the
    // evaluator would only ever see the first answer again.
    const text = (followUpQuestion ? followUpDraft : draft).trim();
    if (text.length < 3) {
      if (followUpQuestion) return; // the follow-up input validates itself; nothing to explain twice
      setEvalError('Say or write a little more before submitting — a few words is enough to start.');
      return;
    }
    submittingRef.current = true;
    const token = ++requestToken.current;
    const question = q;
    const section = currentSection;
    setEvaluating(true);
    setEvalError(null);

    const result = await requestEvaluation({
      question: followUpQuestion ?? question.question,
      modelAnswer: question.answer,
      sectionTitle: section.title,
      kindLabel: KIND_BY_ID[kindOf(question) ?? 'concept'].label,
      difficulty: question.difficulty,
      answer: text,
      lang: voice.lang,
      style,
    }, question);

    if (!mounted.current || requestToken.current !== token) { submittingRef.current = false; return; }

    // "Too vague to mark" is not a zero. The question stays open, nothing is recorded, and the
    // learner is asked for one concrete point instead of being scored on a shrug.
    if (result.evaluation.status === 'needs-clarification') {
      setEvaluation({ value: result.evaluation, source: result.source, note: result.note });
      setEvaluating(false);
      submittingRef.current = false;
      if (voiceOn) {
        voice.speak('I need a little more detail before I can mark that. Please add one concrete point or example, then submit again.');
      }
      return;
    }

    if (followUpQuestion) {
      // The follow-up is a REAL evaluation recorded onto the SAME sitting answer — it never
      // replaces the main verdict and it never writes a synthetic `qb:` key (see AGENTS.md).
      setAnswers((list) => list.map((a) => (a.questionId === question.id
        ? { ...a, followUpEvaluation: result.evaluation }
        : a)));
      setEvaluating(false);
      submittingRef.current = false;
      setFollowUpDraft('');
      if (voiceOn) {
        voice.speak(evaluationSpeech(result.evaluation, verdictForScore(result.evaluation.score), styleDef.lead));
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
    submittingRef.current = false;
    if (voiceOn) {
      const spokenLead = evaluationSpeech(result.evaluation, verdict, styleDef.lead);
      const followUp = result.evaluation.followUp;
      voice.speak(followUp ? `${spokenLead} A follow-up for you: ${followUp}` : spokenLead, [], () => {
        // AUTO progression: only from a FINAL speech end, only for a marked answer, at most once
        // per question, and never while the mic is open or the interview is paused.
        if (!autoNext || !mounted.current) return;
        if (voice.listening) return;
        const snapshot = liveRef.current;
        if (snapshot.phase !== 'live' || snapshot.paused) return;
        if (result.evaluation.status === 'needs-clarification') return;
        if (autoAdvancedFor.current === question.id) return;
        autoAdvancedFor.current = question.id;
        advance();
      });
    }
  };

  /**
   * The draft is written after every evaluated answer, every advance, AND every typed or spoken
   * transcript beat — a network drop, a navigation, or a closed tab must not cost the UNSUBMITTED
   * answer either. The report phase clears the draft (the sitting is finished); setup leaves it,
   * because that exit is a pause, not a verdict.
   */
  const [draftSaved, setDraftSaved] = useState(false);
  /** The clock is deliberately NOT a draft trigger, or the round would churn once a second. */
  const elapsedRef = useRef(elapsed);
  elapsedRef.current = elapsed;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /** One writer, two triggers: round changes commit immediately, typing commits debounced —
   *  every keystroke must not stringify the whole sitting (the store's own lesson in AGENTS.md). */
  const commitDraft = useCallback(() => {
    const snapshot = liveRef.current;
    if (snapshot.phase !== 'live' || !snapshot.queue.length || snapshot.preparing) return;
    writeDraft({
      version: DRAFT_VERSION,
      savedAt: new Date().toISOString(),
      subjectId: snapshot.trackId,
      mode: snapshot.mode, level: snapshot.level, style: snapshot.style, size: snapshot.size,
      autoNext: snapshot.autoNext,
      step: snapshot.step, skipped: snapshot.skipped, asked: snapshot.asked,
      answers: snapshot.answers, queue: snapshot.queue,
      elapsed: snapshot.elapsed,
      answer: draftRef.current,
    });
    setSavedDraft(null);
    setDraftSaved(true);
  }, []);

  const draftToggleRef = useRef({ phase, preparing });
  draftToggleRef.current = { phase, preparing };

  useEffect(() => {
    if (phase === 'report') { writeDraft(null); setDraftSaved(false); return; }
    if (phase !== 'live' || !queue.length || preparing) return;
    commitDraft();
  }, [commitDraft, phase, queue, step, answers, skipped, asked, mode, level, style, size, autoNext, preparing, trackDef?.id]);

  // The typed transcript: debounced, cleared when it matches the last committed text.
  useEffect(() => {
    if (phase !== 'live') return;
    const timer = window.setTimeout(commitDraft, 700);
    return () => window.clearTimeout(timer);
  }, [commitDraft, draft, phase]);

  // Persist the summary in the device history when the round ENDS (the report phase shows it).
  useEffect(() => {
    if (phase !== 'report' || !trackDef) return;
    const entry = historyFromReport(report, {
      subject: subjectLabel,
      subjectId: trackDef.id,
      mode, level, style,
      savedAt: new Date().toISOString(),
    });
    const next = appendHistory(history, entry);
    if (next.length === history.length) return; // nothing new (e.g. a report without answers)
    try { localStorage.setItem(INTERVIEW_HISTORY_KEY, JSON.stringify(next)); } catch { /* quota */ }
    setHistory(next);
    // `report` recomputes with answers; this effect owns the WRITE, not the rendering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, trackDef]);

  const report = useMemo(() => buildInterviewReport({
    answers,
    skipped,
    planned: queue.length,
    subject: subjectLabel,
    subjectId: trackDef?.id ?? '',
    seconds: elapsed,
  }), [answers, skipped, queue.length, subjectLabel, trackDef?.id, elapsed]);

  const clearDraftStorage = () => {
    writeDraft(null);
    setSavedDraft(null);
  };

  const doAction = (action: Exclude<VoiceAction, 'next-question'>) => {
    // The action table lives in `core/ai/voice-session.ts` (tested): one illegal action is one
    // no-op, never a state reset.
    if (!actionLegal(action, voicePhase)) return;
    if (!q) return;
    switch (action) {
      case 'speak-question':
      case 'repeat-question':
        spokenFor.current = null; // a repeat is a FRESH speak, never a doubling
        voice.speak(q.question);
        break;
      case 'stop-speaking':
        voice.stopSpeaking();
        break;
      case 'answer-by-voice':
        // Continuous capture: the mic stays open across sentence pauses, the transcript appends
        // sentence by sentence, and stopping leaves everything editable in the answer box.
        voice.startListening((text) => setDraft((d) => (d ? `${d} ${text}` : text)), { continuous: true });
        break;
      case 'stop-listening':
        voice.stopListening();
        break;
      case 'pause-speech':
        voice.pauseSpeaking();
        break;
      case 'resume-speech':
        voice.resumeSpeaking();
        break;
      default:
        break;
    }
  };

  /* -------------------------------- the data -------------------------------- */

  const subjectSectionsAll = useMemo(() => {
    if (!range) return [] as BankManifestEntry[];
    return entries.filter((e) => e.no >= range.from && e.no <= range.to);
  }, [entries, range]);

  const subjectInventory = useMemo(() => {
    if (!range) return 0;
    return subjectSectionsAll
      .filter((e) => !topicId || e.sectionId === topicId)
      .reduce((total, e) => total + modeDef.kinds.reduce((sum, k) => sum + kindCounts(e)[k], 0), 0);
  }, [subjectSectionsAll, range, modeDef, topicId]);

  const headNote = !trackDef
    ? 'Pick a subject. Each one opens its own setup screen — difficulty, round type and length.'
    : phase === 'report'
      ? `${modeDef.label} round · ${levelDef.label} · every number below comes from the answers evaluated in this sitting.`
      : phase === 'live'
        ? `${modeDef.label} round · ${levelDef.label} · answer by voice or text; the interviewer marks it.`
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
      {savedDraft && (
        <div className="iv-draft">
          <div>
            <b className="small">An unfinished sitting is waiting ({savedDraft.answers.length} evaluated, {Math.min(savedDraft.step + 1, savedDraft.queue.length || 1)} of {savedDraft.queue.length} asked).</b>
            <p className="small muted" style={{ margin: '2px 0 0' }}>
              {new Date(savedDraft.savedAt).toLocaleString()} — open its subject and press the resume card on the setup screen.
            </p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Link className="btn small primary" to={`/interview-mode?subject=${savedDraft.subjectId}`}>
              Open <ArrowRight size={12} />
            </Link>
            <button type="button" className="btn small ghost" onClick={clearDraftStorage}><X size={12} /> Discard</button>
          </div>
        </div>
      )}
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
      {history.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: 15 }}>Past rounds on this device</h2>
          <div className="iv-history">
            {history.slice(0, 6).map((entry) => {
              const e = entry as { savedAt: string; subject: string; averageScore: number | null; answered: number; planned: number };
              return (
                <div key={e.savedAt} className="iv-history-row">
                  <span className="small">{new Date(e.savedAt).toLocaleDateString()} · {e.subject}</span>
                  <span className="small muted">{e.answered}/{e.planned} answered</span>
                  <b className="small">{e.averageScore === null ? '—' : `${e.averageScore}%`}</b>
                </div>
              );
            })}
          </div>
          <p className="small muted" style={{ margin: '6px 0 0' }}>
            Rounds are saved on this device only — the {HISTORY_MAX} most recent. Nothing here is uploaded.
          </p>
        </div>
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

        {savedDraft && savedDraft.subjectId === trackDef.id && (
          <div className="iv-draft">
            <div>
              <b className="small">You have an unfinished sitting ({savedDraft.answers.length} evaluated, {Math.min(savedDraft.step + 1, savedDraft.queue.length || 1)} of {savedDraft.queue.length} asked).</b>
              <p className="small muted" style={{ margin: '2px 0 0' }}>
                {new Date(savedDraft.savedAt).toLocaleString()} — the same questions and evaluations are waiting. Answers already went into your Question Bank records; resuming adds the rest.
              </p>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn small primary" onClick={resumeDraft}><Play size={13} /> Resume sitting</button>
              <button type="button" className="btn small ghost" onClick={clearDraftStorage}><X size={12} /> Discard &amp; start fresh</button>
            </div>
          </div>
        )}

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

        <div className="sec-head"><h2>Interviewer style</h2><span className="line" /></div>
        <div className="iv-mode-grid">
          {INTERVIEWER_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`iv-mode${s.id === style ? ' on' : ''}`}
              aria-pressed={s.id === style}
              onClick={() => setStyle(s.id)}
            >
              <b>{s.emoji} {s.label}</b>
              <span className="small muted">{s.blurb}</span>
            </button>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 4 }}>
          The style changes how the interview WORKS, not just its label: the spoken opening, the verdict tone
          and the evaluator's own instructions all follow it.
          {style === 'adaptive' && (
            <> The Adaptive style holds the level you chose ({levelDef.label}) and steps it up after two clean
              answers, down after two misses.</>
          )}
        </p>

        <div className="sec-head"><h2>Topic</h2><span className="line" /></div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`chip${topicId === null ? ' on' : ''}`}
            style={{ cursor: 'pointer' }}
            aria-pressed={topicId === null}
            onClick={() => setTopicId(null)}
          >
            All chapters in this subject
          </button>
          {subjectSectionsAll.map((e) => (
            <button
              key={e.sectionId}
              type="button"
              className={`chip${topicId === e.sectionId ? ' on' : ''}`}
              style={{ cursor: 'pointer' }}
              aria-pressed={topicId === e.sectionId}
              onClick={() => setTopicId(e.sectionId)}
            >
              {e.title}
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
            : topicId
              ? `${Math.min(size as number, 20)} questions from the chosen chapter. ${subjectInventory} stored questions match this round type there.`
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
            <button type="button" className={`btn small${autoNext ? ' primary' : ''}`} aria-pressed={autoNext} onClick={() => setAutoNext((v) => !v)}>
              <SkipForward size={13} /> Auto-advance after feedback
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
            <label className="small muted" htmlFor="iv-pitch">Pitch {voice.pitch.toFixed(1)}</label>
            <input
              id="iv-pitch"
              type="range"
              min={0.6}
              max={1.4}
              step={0.1}
              value={voice.pitch}
              onChange={(e) => voice.setPitch(Number(e.target.value))}
            />
            <label className="small muted" htmlFor="iv-lang">Speech language</label>
            <select id="iv-lang" value={voice.lang} onChange={(e) => voice.setLang(e.target.value === 'hi-IN' ? 'hi-IN' : 'en-IN')}>
              <option value="en-IN">English</option>
              <option value="hi-IN">Hinglish</option>
            </select>
            <label className="small muted" htmlFor="iv-voice">Voice</label>
            <select
              id="iv-voice"
              value={voice.voiceName ?? ''}
              onChange={(e) => voice.setVoiceName(e.target.value || null)}
              disabled={voice.voices.length === 0}
            >
              <option value="">Best available (automatic)</option>
              {voice.voices
                .filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(voice.lang.slice(0, 2)))
                .map((v) => <option key={v.name} value={v.name}>{v.name}{v.localService ? ' (device)' : ' (network)'}</option>)}
            </select>
          </div>
          <AiVoiceRow voice={voice} />
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            {voiceSupportNote(voice.supported)
              || `Questions are spoken with the ${voice.lang === 'hi-IN' ? 'Hindi' : 'English'} voice your browser provides. The transcript appears in the answer box for you to edit. Answering by voice never turns the interviewer's voice off — the mic and the speaker are separate.`}
            {draftSaved && ' Your progress in the last sitting is saved on this device.'}
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
              {answer.followUpEvaluation ? ` · follow-up ${answer.followUpEvaluation.score}%` : ''}
            </summary>
            <p className="small" style={{ marginBottom: 4 }}><b>{answer.question}</b></p>
            <p className="small muted" style={{ marginTop: 0 }}>Your answer: {answer.answer}</p>
            <p className="small">What you got right: {answer.evaluation.conceptsUnderstood.join(', ') || 'nothing identified yet'}</p>
            <p className="small">Still missing: {answer.evaluation.missingConcepts.join(', ') || 'nothing — this was complete'}</p>
            {answer.followUpEvaluation && (
              <p className="small" style={{ color: 'var(--cyan)' }}>
                Follow-up answered — {statusLabel(answer.followUpEvaluation.status)}: {answer.followUpEvaluation.explanation}
              </p>
            )}
          </details>
        ))}

        <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn primary" onClick={start}><RotateCcw size={14} /> Restart this round</button>
          <button type="button" className="btn" onClick={toSetup}>Change setup</button>
          <Link className="btn small ghost" to="/interviews">Interview hub <ArrowRight size={12} /></Link>
        </div>
        <p className="small muted">
          Answers are saved to the same Question Bank records the bank page writes, so this round updates
          the progress the bank shows. The report itself is recomputed from this sitting; a summary copy
          (score, counts, time) is stored on this device — never uploaded.
        </p>
      </div>
    );
  }

  /* ---------------------------------- live --------------------------------- */

  const total = queue.length;
  const followUpText = evaluation && evaluation.value.followUp ? evaluation.value.followUp : null;
  const remaining = modeDef.timed ? Math.max(0, questionLeft) : null;
  const stillToAsk = Math.max(0, total - step - (evaluation ? 1 : 0));
  const answeredNow = answers.length;
  const ringPct = total ? Math.round(((answeredNow + skipped) / total) * 100) : 0;
  const shownIndex = viewIndex !== null ? viewIndex : step;
  const viewingEarlier = viewIndex !== null && viewIndex !== step;
  const shownQuestion = queue[shownIndex] ?? null;
  const isCurrentQuestion = !viewingEarlier && shownIndex === step;
  const viewAnswerDetails = viewingEarlier
    ? answers.find((a) => a.questionId === queue[viewIndex].id) ?? null
    : null;
  const conceptsCovered = evaluation
    ? (() => {
      const named = evaluation.value.conceptsUnderstood.length;
      const missing = evaluation.value.missingConcepts.length;
      return named + missing > 0 ? Math.round((named / (named + missing)) * 100) : null;
    })()
    : null;

  const header = (
    <div className="iv-header">
      <div className="iv-header-brand">
        <BrandMark size={30} />
        <div style={{ minWidth: 0 }}>
          <b>{subjectLabel} interview</b>
          <div className="small muted iv-header-sub">
            {modeDef.emoji} {modeDef.label} · {styleDef.emoji} {styleDef.label}
            {style === 'adaptive' ? ` · now asking ${adaptiveLevelNow}` : ` · ${levelDef.label}`}
            {topicId ? ` · ${entries.find((e) => e.sectionId === topicId)?.title ?? topicId}` : ''}
          </div>
        </div>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className={`chip iv-status-chip iv-status-${voicePhase}`}>
          <span aria-hidden className="iv-status-dot" /> {phaseLabel(voicePhase)}
        </span>
        {!online && <span className="chip iv-offline-chip">Offline · device save</span>}
        <button
          type="button"
          className={`chip${autoNext ? ' on' : ''}`}
          style={{ cursor: 'pointer' }}
          aria-pressed={autoNext}
          onClick={() => setAutoNext((v) => !v)}
          title="Automatic progression: the interviewer reads the next question when its feedback finishes"
        >
          Auto next: {autoNext ? 'on' : 'off'}
        </button>
        <span className="chip">⏱ {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
        <button type="button" className="btn small iv-end" onClick={() => { voice.stopSpeaking(); setPhase('report'); }}>
          <Square size={12} /> End interview
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <HubCrumb hub="/interviews" hubLabel="Interview" page="Interview Room" />
      {pageHead}
      {header}

      {notice && (
        <p className="small" style={{ color: 'var(--amber)', margin: '8px 0 0' }}>
          {notice} <button className="btn small ghost" onClick={() => setNotice(null)}>Dismiss</button>
        </p>
      )}

      {loadNote && !prepError && <p className="small muted" style={{ margin: '6px 0 0' }}>{loadNote}</p>}

      <div className="iv-live-new" style={{ marginTop: 12 }}>
        <div className="iv-main">
          <div className="iv-panel">
            <div className="iv-interviewer-head">
              <span className="iv-avatar"><BrandMark size={28} /></span>
              <div>
                <b>AI Interviewer</b>
                <div className="small muted">Online · {styleDef.label}</div>
              </div>
              {voice.speaking && <span className="iv-wave iv-presence" aria-hidden><i /><i /><i /><i /></span>}
              {voice.listening && <span className="iv-presence-mic small"><Mic2 size={12} /> Recording</span>}
            </div>

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

            {!preparing && !prepError && !current && (
              <div>
                <h2 style={{ marginTop: 0 }}>No question available for this round</h2>
                <p className="small muted">
                  This subject has no stored question matching this round type. Change the setup or pick
                  another subject — nothing is invented to fill the gap.
                </p>
                <button className="btn small" onClick={toSetup}>Change setup</button>
              </div>
            )}

            {shownQuestion && !preparing && !prepError && (
              <div className="iv-question">
                <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <span className="small muted">
                    {shownQuestion.sectionId.toUpperCase()} · {shownQuestion.sectionTitle} ·{' '}
                    {qKind ? KIND_BY_ID[qKind].label : TYPE_LABEL[shownQuestion.question.type]}
                  </span>
                  <div className="row" style={{ gap: 6 }}>
                    {levelRelaxed && <span className="chip">level relaxed — bank has no {levelDef.label.toLowerCase()} item here</span>}
                    <span className="chip iv-progress-chip">Question {step + 1} / {total}</span>
                  </div>
                </div>

                <h2 className="iv-question-text" style={{ margin: '10px 0', lineHeight: 1.35 }}>
                  {shownQuestion.question.question}
                </h2>

                <div className="iv-meta-row">
                  <span className={`chip diff-${shownQuestion.question.difficulty}`}>{shownQuestion.question.difficulty}</span>
                  <span className="chip">{KIND_BY_ID[qKind ?? 'concept'].label}</span>
                  <span className="chip">~{Math.ceil(PER_QUESTION_SECONDS / 60)} min typical</span>
                  {style === 'adaptive' && <span className="chip">adaptive level: {adaptiveLevelNow}</span>}
                  {voice.engine === 'cloud' && <span className="chip iv-engine">Google voice</span>}
                  {voice.engine === 'browser' && voice.supported.synthesis && <span className="chip iv-engine">Browser voice</span>}
                </div>

                <div className="iv-hint-block">
                  <button type="button" className="btn small" onClick={() => setHintOpen((o) => !o)}>
                    <Sparkles size={13} /> {hintOpen ? 'Hide hint' : 'Request hint'}
                  </button>
                  {hintOpen && hintSlots.length > 0 && (
                    <div className="iv-hint">
                      <b className="small">What the interviewer is looking for</b>
                      <ul>
                        {hintSlots.map((slot) => <li key={slot} className="small">{slot}</li>)}
                      </ul>
                      {voiceOn && (
                        <button
                          type="button"
                          className="btn small ghost"
                          onClick={() => {
                            // Same legality rule as every other speak: the mic owns the turn while recording.
                            if (!actionLegal('speak-question', voicePhase)) return;
                            voice.speak(`Points your answer should cover: ${hintSlots.join('. ')}.`);
                          }}
                        >
                          <Volume2 size={12} /> Read the hint aloud
                        </button>
                      )}
                      <p className="small muted" style={{ margin: '4px 0 0' }}>
                        Built from the chapter's own answer — the points it touches, not its wording.
                      </p>
                    </div>
                  )}
                </div>

                <div className="iv-speak-controls" role="group" aria-label="Question speech controls">
                  <button
                    type="button"
                    className={`btn small${voice.speaking ? ' primary' : ''}`}
                    onClick={() => doAction('speak-question')}
                    disabled={voicePhase === 'listening'}
                    title={voicePhase === 'listening' ? 'Stop recording first — the transcript stays clean' : 'Speak the question'}
                  >
                    <Volume2 size={13} /> {voice.speaking ? 'Reading…' : 'Speak question'}
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => doAction('repeat-question')}
                    disabled={voicePhase === 'listening'}
                    title="Read the question again from the start"
                  >
                    <RotateCcw size={13} /> Repeat
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => (voice.paused ? doAction('resume-speech') : doAction('pause-speech'))}
                    disabled={voicePhase !== 'speaking'}
                    title={voice.paused ? 'Resume the spoken question' : 'Pause the spoken question'}
                  >
                    {voice.paused ? <Play size={13} /> : <Pause size={13} />} {voice.paused ? 'Resume speech' : 'Pause speech'}
                  </button>
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => doAction('stop-speaking')}
                    disabled={voicePhase !== 'speaking'}
                  >
                    <Square size={13} /> Stop speech
                  </button>
                  <button
                    type="button"
                    className={`btn small${voice.listening ? ' iv-listening' : ''}`}
                    onClick={() => (voice.listening ? doAction('stop-listening') : doAction('answer-by-voice'))}
                    disabled={!voiceOn || !voice.supported.recognition}
                    title="Record your spoken answer; the transcript lands in the answer box, still editable"
                  >
                    <Mic2 size={13} /> {voice.listening ? 'Stop recording' : 'Answer by Voice'}
                  </button>
                </div>

                {voice.listening && (
                  <div className="iv-record" role="status" aria-live="polite">
                    <span className="iv-record-dot" aria-hidden />
                    <span className="small"><b>Recording</b> · {Math.floor(recordedSeconds / 60)}:{String(recordedSeconds % 60).padStart(2, '0')} · speak your full answer, sentences break freely</span>
                    <span className="iv-wave" aria-hidden><i /><i /><i /><i /><i /></span>
                  </div>
                )}
                {!voice.supported.recognition && (
                  <p className="small muted" style={{ margin: '6px 0 0' }}>
                    This browser has no speech recognition. Type the answer instead — everything else works.
                  </p>
                )}
                {voice.micDenied && (
                  <div className="iv-perm">
                    <p className="small" style={{ margin: 0 }}>
                      <b>Microphone blocked.</b> Allow mic access in the address bar, then retry — or answer by text below.
                      The round continues either way; the interviewer's own voice is unaffected.
                    </p>
                    <button type="button" className="btn small" onClick={() => doAction('answer-by-voice')}>Retry microphone</button>
                  </div>
                )}
                {voice.error && !voice.micDenied && (
                  <p className="small" style={{ margin: '6px 0 0', color: 'var(--amber)' }}>
                    {voice.error} <button className="btn small ghost" onClick={voice.dismissError}>Dismiss</button>
                  </p>
                )}
                {voice.interim && voice.listening && (
                  <p className="small" style={{ margin: '4px 0 0', color: 'var(--cyan)' }}>{voice.interim}</p>
                )}
                {!online && (
                  <div className="iv-perm iv-offline-note" role="status">
                    <p className="small" style={{ margin: 0 }}>
                      <b>Offline.</b> {offlineRoomNote()}
                    </p>
                  </div>
                )}

                <label className="small muted" htmlFor="iv-answer" style={{ display: 'block', marginTop: 10 }}>
                  Your answer {evaluation ? '(submitted)' : '— review and edit the transcript before sending'}
                </label>
                <textarea
                  id="iv-answer"
                  className="console"
                  rows={q?.type === 'coding' || q?.type === 'debug' ? 7 : 5}
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); setClearArmed(false); }}
                  placeholder={q?.type === 'coding' || q?.type === 'debug'
                    ? 'Write the code or the approach, then submit for review.'
                    : 'Say it out loud first, then fix the transcript here.'}
                  disabled={!!evaluation || evaluating || voicePhase === 'processing'}
                />
                <div className="row spread small muted" style={{ marginTop: 4 }}>
                  <span>{draft.trim().split(/\s+/).filter(Boolean).length} words {draftSaved && '· progress saved'}</span>
                  <span>{voice.lang === 'hi-IN' ? 'Hinglish accepted' : 'English accepted'} · voice or text</span>
                </div>
                {draft.trim().length > 0 && !evaluation && !evaluating && (
                  <button
                    type="button"
                    className="btn small ghost"
                    style={{ marginTop: 4 }}
                    onClick={() => {
                      // Clear asks once when the box holds a real answer; long transcripts deserve
                      // the confirmation, a stray word does not.
                      if (!clearArmed && draft.trim().length > 40) { setClearArmed(true); return; }
                      setDraft('');
                      setClearArmed(false);
                    }}
                  >
                    {clearArmed ? 'Clear — press again to confirm' : 'Clear answer'}
                  </button>
                )}
                {clearArmed && <span className="small muted" style={{ marginLeft: 6 }}>Press Clear again to erase the transcript.</span>}

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
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => void submit()}
                    disabled={evaluating || !!evaluation || voicePhase === 'listening'}
                    title={evaluation ? 'Submitted — the evaluation is below' : 'Send the answer for evaluation'}
                  >
                    <Send size={14} /> {evaluating ? 'Evaluating…' : 'Submit for evaluation'}
                  </button>
                  {evalError && (
                    <button type="button" className="btn" onClick={() => void submit()} disabled={evaluating || !!evaluation}>
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
                    {paused ? <Play size={13} /> : <CirclePause size={13} />} {paused ? 'Resume' : 'Pause'} interview
                  </button>
                  {step > 0 && (
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={() => setViewIndex(viewingEarlier ? null : step - 1)}
                      title="Review the previous question and its evaluation (read-only)"
                    >
                      <ChevronLeft size={13} /> Previous question
                    </button>
                  )}
                  <button type="button" className="btn small ghost" onClick={() => { voice.stopSpeaking(); setPhase('report'); }}>
                    <Square size={13} /> End interview
                  </button>
                </div>

                {viewingEarlier && (
                  <div className="iv-review-note">
                    <p className="small" style={{ margin: 0 }}>
                      You are reviewing question {viewIndex + 1} — its evaluation is below. This view is read-only;
                      the round is waiting at question {step + 1}.
                    </p>
                    <button className="btn small primary" onClick={() => setViewIndex(null)}>Back to question {step + 1}</button>
                  </div>
                )}

                {isCurrentQuestion && followUpText && !currentFollowUp && (
                  <div className="iv-followup">
                    <b className="small">Follow-up from the interviewer</b>
                    <p className="small" style={{ margin: '4px 0' }}>{followUpText}</p>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <input
                        className="console iv-followup-input"
                        placeholder="Type your follow-up answer (optional)…"
                        value={followUpDraft}
                        onChange={(e) => setFollowUpDraft(e.target.value)}
                        disabled={evaluating}
                      />
                      <button
                        type="button"
                        className="btn small"
                        disabled={evaluating || followUpDraft.trim().length < 3}
                        onClick={() => { if (followUpText) void submit(followUpText); }}
                      >
                        <Send size={13} /> Evaluate follow-up
                      </button>
                    </div>
                    <p className="small muted" style={{ margin: '4px 0 0' }}>
                      The follow-up is scored onto the same sitting record — it cannot change the verdict above.
                    </p>
                  </div>
                )}
                {currentFollowUp && (
                  <div className="iv-followup">
                    <b className="small">Follow-up practised — {currentFollowUp.score}% · {statusLabel(currentFollowUp.status)}</b>
                    <p className="small" style={{ margin: '4px 0 0' }}>{currentFollowUp.explanation}</p>
                  </div>
                )}
              </div>
            )}

            {evaluation && isCurrentQuestion && (
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

                {conceptsCovered !== null && (
                  <div className="iv-bar" title="Named concepts / (named + missing) — derived from the evaluation's own counts, not an invented metric">
                    <span className="small">Concepts covered</span>
                    <Bar pct={conceptsCovered} />
                    <b className="small">{conceptsCovered}%</b>
                  </div>
                )}

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
                  {followUpText && !currentFollowUp && (
                    <>
                      <b>Follow-up to think about</b>
                      <p style={{ margin: '2px 0 0' }}>{followUpText}</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {viewingEarlier && viewAnswerDetails && (
            <div className={`iv-eval${viewAnswerDetails.evaluation.score < 45 ? ' iv-eval-bad' : ''}`}>
              <p className="small" style={{ margin: 0 }}><b>{viewAnswerDetails.question}</b></p>
              <p className="small muted">Your answer: {viewAnswerDetails.answer}</p>
              <p className="small">{statusLabel(viewAnswerDetails.status)} · {viewAnswerDetails.evaluation.score}% · {viewAnswerDetails.source === 'ai' ? 'AI evaluation' : 'built-in rubric'}</p>
              <p className="small">Got right: {viewAnswerDetails.evaluation.conceptsUnderstood.join(', ') || '—'}</p>
              <p className="small">Missing: {viewAnswerDetails.evaluation.missingConcepts.join(', ') || '—'}</p>
            </div>
          )}
        </div>

        <div>
          <div className="iv-panel iv-rail">
            <h2 className="iv-rail-title">Interview Progress</h2>
            <div className="iv-progress-row">
              <div className="iv-ring" role="img" aria-label={`${ringPct}% of this sitting answered or skipped`}>
                <svg viewBox="0 0 44 44" aria-hidden>
                  <circle className="iv-ring-bg" cx="22" cy="22" r="19" />
                  <circle className="iv-ring-fg" cx="22" cy="22" r="19" style={{ strokeDashoffset: 119.4 * (1 - ringPct / 100) }} />
                </svg>
                <div className="iv-ring-label">
                  <b>{answeredNow + skipped} / {total || '—'}</b>
                  <span className="small muted">{ringPct}%</span>
                </div>
              </div>
              <div className="iv-progress-stats small">
                <span>⏱ {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} session time</span>
                <span><CheckCircle2 size={12} /> {report.correct} correct</span>
                <span><Send size={12} /> {answeredNow} answered</span>
                <span><SkipForward size={12} /> {skipped} skipped</span>
                <span>{stillToAsk} still to ask</span>
              </div>
            </div>
            <button type="button" className="btn small primary iv-summary-btn" onClick={() => setPhase('report')}>
              View Session Summary <ArrowRight size={12} />
            </button>

            <div className="iv-rail-visual">
              <div className="iv-rail-tabs">
                <button
                  type="button"
                  className={`btn small ghost${railTab === 'all' ? ' on' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setRailTab('all')}
                >Questions</button>
                <button
                  type="button"
                  className={`btn small ghost${railTab === 'topics' ? ' on' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setRailTab('topics')}
                >Topics</button>
              </div>
              {total === 0 && <p className="small muted">The round has no questions yet — it is still being prepared.</p>}
              {railTab === 'all' && total > 0 && (
                <div className="iv-listQ">
                  {queue.map((item, i) => {
                    const a = answers.find((x) => x.questionId === item.id);
                    const isHere = i === step && !viewingEarlier || (viewingEarlier && i === viewIndex);
                    const done = Boolean(a);
                    return (
                      <div key={item.id} className={`iv-listQ-row${isHere ? ' here' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="small iv-listQ-n">{done ? '✅' : i < step ? '—' : i + 1}</span>
                        <span className="small iv-listQ-t">{item.question.question.slice(0, 52)}{item.question.question.length > 52 ? '…' : ''}</span>
                        <span className={`chip diff-${item.question.difficulty} iv-listQ-d`}>{item.question.difficulty}</span>
                        {isHere && <Play size={11} aria-label="current" />}
                        {done && a?.followUpEvaluation ? <span className="small" title="follow-up practised">＋</span> : null}
                      </div>
                    );
                  })}
                </div>
              )}
              {railTab === 'topics' && (
                <div className="iv-listQ">
                  {report.topics.map((topic) => (
                    <div key={topic.sectionId} className="iv-listQ-row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="small iv-listQ-t">{topic.title}</span>
                      <b className="small">{topic.average}%</b>
                    </div>
                  ))}
                  {!report.topics.length && <p className="small muted">No evaluated answers yet.</p>}
                </div>
              )}
              <p className="small muted" style={{ margin: '6px 0 0' }}>
                {total > 0 && `${stillToAsk} question${stillToAsk === 1 ? '' : 's'} still to ask${skipped ? ` · ${skipped} skipped` : ''}.`}
                {' '}Answers live in the same Question Bank records the bank page writes.
              </p>
            </div>
          </div>
        </div>
      </div>

      {remaining !== null && (
        <p className="small" style={{ margin: '8px 0 0', color: remaining <= 20 ? 'var(--amber)' : 'inherit' }}>
          ⏳ {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} left for this question — running out skips it.
        </p>
      )}
    </div>
  );
}
