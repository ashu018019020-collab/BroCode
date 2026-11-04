import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, ArrowRight, BarChart3, CheckCircle2, Clock, History,
  ListChecks, Loader2, Mic2, MicOff, Play, RotateCcw, Send, Sparkles, Square, Trash2, Volume2,
} from 'lucide-react';
import { useCurriculum } from '../../core/data/curriculum';
import {
  DEFAULT_QUESTION_COUNT, MAX_QUESTION_COUNT, MIN_QUESTION_COUNT, MOCK_DIFFICULTIES, MOCK_LENGTHS,
  MOCK_ROLES, MOCK_TOPICS, UNAVAILABLE_TOPICS,
  addReport, buildMockPlan, buildMockReport, createMockSession, evaluateMockAnswer, followUpsFor,
  minutesForQuestions, mockLevelLabel, mockRole, normalizeQuestionCount, normalizeTopics, recordMockAnswer,
  removeReport, reportHeadline, sanitizeReports, topicsForSection,
  type MockAnswerScore, type MockCodingEvidence, type MockDifficulty,
  type MockPlan, type MockQuestion, type MockQuestionKind, type MockReport, type MockRoleId,
  type MockSession, type MockTopicId,
} from '../../core/assessment/mock-interview';
import { spokenReply } from '../../core/ai/voice';
import { requestEvaluation, type EvaluationResult } from '../../core/ai/interview';
import { MOCK_HISTORY_KEY } from '../../core/platform/keys';
import { accountStorageKey, subscribeStorageAccount } from '../../core/storage/account';
import { useVoiceTutor } from '../../components/shared/useVoiceTutor';
import { runPython, stopPython } from '../coding/runners';
import { parseTraceback } from '../../core/platform/traceback';
import { addMistake } from '../../core/storage/store';
import { toast } from '../../components/ui/Toast';
import { Bar } from '../../components/ui/ui';

const MonacoIDE = lazy(() => import('../../components/code/MonacoIDE').then((m) => ({ default: m.MonacoIDE })));

type Phase = 'setup' | 'live' | 'report' | 'history';

const CODING_STARTER = `def solve(numbers):
    # Write your approach, then run it.
    # The interview records whether the code really ran and whether it raised.
    return numbers


print(solve([1, 2, 3]))
`;

function readHistory(key: string): MockReport[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? sanitizeReports(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function writeHistory(key: string, reports: MockReport[]) {
  try { localStorage.setItem(key, JSON.stringify(reports)); } catch { /* quota or blocked */ }
}

/**
 * The spoken mock interview.
 *
 * The page owns the ROUND (clock, question order, editor lock); the pure engine owns the rules
 * (what may be asked, what a follow-up means, what each score dimension is). Answers are spoken into
 * a transcript the candidate can edit — the microcopy never implies speech recognition is exact.
 *
 * A report saves only after the round ends, and its numbers are the same ones shown next to each
 * answer. Nothing here scores voice, accent or confidence.
 */
const KIND_LABEL: Record<MockQuestionKind, string> = {
  concept: 'Conceptual',
  coding: 'Coding',
  debug: 'Debugging',
  logic: 'Logic',
  project: 'Scenario / project',
};

export function MockInterviewPanel({ initialPhase = 'setup' }: { initialPhase?: Phase } = {}) {
  const { sections, extras } = useCurriculum();
  const historyKey = useSyncExternalStore(
    subscribeStorageAccount,
    () => accountStorageKey(MOCK_HISTORY_KEY),
    () => MOCK_HISTORY_KEY,
  );
  const [history, setHistory] = useState<MockReport[]>(() => readHistory(historyKey));
  const historyRef = useRef(history);
  historyRef.current = history;

  useEffect(() => {
    setHistory(readHistory(historyKey));
  }, [historyKey]);

  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [role, setRole] = useState<MockRoleId>('ai-engineer');
  const [topics, setTopics] = useState<MockTopicId[]>(mockRole('ai-engineer').topics);
  const [difficulty, setDifficulty] = useState<MockDifficulty>('mid');
  const [questionCount, setQuestionCount] = useState(DEFAULT_QUESTION_COUNT);
  /** 0 = no focus; otherwise one real curriculum section number. */
  const [focusSection, setFocusSection] = useState(0);
  const advancingRef = useRef(0);
  const roundMinutes = minutesForQuestions(questionCount);
  const focus = focusSection > 0 ? [focusSection] : undefined;

  const [plan, setPlan] = useState<MockPlan | null>(null);
  const [session, setSession] = useState<MockSession | null>(null);
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [answer, setAnswer] = useState('');
  // Guards the double press: two clicks in one frame must not burn two questions.
  const [followUps, setFollowUps] = useState<{ prompt: string; answer: string }[]>([]);
  const [activeFollowUp, setActiveFollowUp] = useState<string | null>(null);
  const [followUpDraft, setFollowUpDraft] = useState('');
  const [feedback, setFeedback] = useState<MockAnswerScore | null>(null);
  const [coding, setCoding] = useState<MockCodingEvidence | undefined>();
  const [codingCode, setCodingCode] = useState(CODING_STARTER);
  const [codingBusy, setCodingBusy] = useState(false);
  const [codingOutput, setCodingOutput] = useState('');
  const [report, setReport] = useState<MockReport | null>(null);
  const [autoListen, setAutoListen] = useState(true);
  /** The AI answer check: the rubric is always shown, the evaluator's review replaces the headline. */
  const [checking, setChecking] = useState(false);
  const [aiResult, setAiResult] = useState<EvaluationResult | null>(null);
  const [aiQuestionId, setAiQuestionId] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);

  const voice = useVoiceTutor(false);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const autoListenRef = useRef(autoListen);
  autoListenRef.current = autoListen;

  const question = plan?.questions[index] ?? null;
  // A late evaluation must never land on the next question: the id it was asked for is compared.
  const questionRef = useRef<string | null>(question?.id ?? null);
  questionRef.current = question?.id ?? null;
  const preview = useMemo(
    () => buildMockPlan(
      sections,
      { role, topics, difficulty, minutes: roundMinutes, questionCount, sections: focus, seed: 1 },
      extras,
    ),
    // `extras` is a stable reference from the curriculum loader; the plan is recomputed on a real choice.
    [sections, extras, role, topics, difficulty, roundMinutes, questionCount, focusSection],
  );

  const handleAnswer = useCallback((text: string) => {
    const clean = text.trim();
    if (!clean) return;
    if (activeFollowUp) {
      setFollowUpDraft((current) => (current ? `${current} ${clean}` : clean));
      return;
    }
    setAnswer((current) => (current ? `${current} ${clean}` : clean));
  }, [activeFollowUp]);
  const handleAnswerRef = useRef(handleAnswer);
  handleAnswerRef.current = handleAnswer;

  const askQuestion = useCallback((next: MockQuestion) => {
    voiceRef.current.stopListening();
    voiceRef.current.stopSpeaking();
    if (!voiceRef.current.supported.synthesis) return;
    voiceRef.current.speak(next.prompt, [], () => {
      // The round's mic stays open across sentence pauses: an answer is several sentences, not one.
      if (autoListenRef.current) voiceRef.current.startListening(handleAnswerRef.current, { continuous: true });
    });
  }, []);

  const resetForQuestion = () => {
    setAnswer('');
    setFollowUps([]);
    setActiveFollowUp(null);
    setFollowUpDraft('');
    setFeedback(null);
    setCoding(undefined);
    setCodingCode(CODING_STARTER);
    setCodingOutput('');
    setChecking(false);
    setAiResult(null);
    setAiQuestionId('');
    setAiError(null);
  };

  const finish = useCallback(() => {
    if (!session) return;
    voiceRef.current.stopListening();
    voiceRef.current.stopSpeaking();
    let final = session;
    const currentQuestion = session.plan.questions[index];
    if (currentQuestion && (answer.trim() || coding?.ran)) {
      final = recordMockAnswer(final, currentQuestion.id, {
        text: answer,
        followUps,
        coding,
      });
    }
    const finished: MockSession = { ...final, finishedAt: Date.now() };
    const built = buildMockReport(finished);
    setSession(finished);
    setReport(built);
    setPhase('report');
    setRemaining(0);
    const next = addReport(historyRef.current, built);
    historyRef.current = next;
    setHistory(next);
    writeHistory(historyKey, next);
  }, [session, index, answer, coding, followUps, historyKey]);

  // The round clock. A timer that expires still saves what the candidate has already submitted, and
  // `finish` also keeps an answer that was written but not submitted yet. `finishRef` keeps the
  // one-second tick from being re-created on every keystroke in the answer box.
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    if (phase !== 'live') return;
    if (remaining <= 0) { finishRef.current(); return; }
    const timer = window.setTimeout(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [phase, remaining]);

  useEffect(() => {
    if (phase === 'live' && question) askQuestion(question);
    // Only when the round becomes live or the question changes; `askQuestion` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index]);

  const start = () => {
    if (!topics.length && !focusSection) {
      toast('Choose at least one topic for the round.', 'warning');
      return;
    }
    const builtPlan = buildMockPlan(sections, {
      role, topics, difficulty, minutes: roundMinutes, questionCount, sections: focus, seed: Date.now(),
    }, extras);
    if (!builtPlan.questions.length) {
      toast(builtPlan.notes[0] ?? 'No question matches this selection. Choose another topic.', 'warning');
      return;
    }
    setPlan(builtPlan);
    setSession(createMockSession(builtPlan));
    setIndex(0);
    setRemaining(roundMinutes * 60);
    setReport(null);
    resetForQuestion();
    setPhase('live');
  };

  /**
   * Check the answer the learner actually gave — spoken transcript or typed, plus follow-ups.
   *
   * The deterministic rubric is computed synchronously (so the page always has a real number), and
   * the AI evaluator is asked in the same press. When it is unreachable or unconfigured the note
   * says so and the rubric stands: no invented score, and Retry re-asks the same question.
   */
  const checkAnswer = async () => {
    if (!session || !question || checking) return;
    const combined = [answer, ...followUps.map((item) => item.answer)].filter(Boolean).join(' ').trim();
    if (!combined && !coding?.ran) {
      toast('Speak or type your answer first — an empty answer cannot be checked.', 'warning');
      return;
    }
    voiceRef.current.stopListening();
    const askedFor = question.id;
    const rubric = evaluateMockAnswer(question, combined, coding);
    setFeedback(rubric);
    setAiResult(null);
    setAiError(null);
    setChecking(true);
    // A weak answer becomes a real revision task, filed under the section it came from. Authored
    // extras have no curriculum section to send the learner back to, so they are not filed.
    if (question.sectionNo > 0 && rubric.overall !== null && rubric.overall < 60) {
      addMistake({
        section: question.sectionId,
        topic: question.sectionTitle,
        question: question.prompt.slice(0, 140),
        myAnswer: answer.slice(0, 220),
        correct: question.model.slice(0, 240),
        type: 'interview',
        source: 'mock',
      });
    }
    setSession(recordMockAnswer(session, question.id, { text: answer, followUps, coding }));
    try {
      const result = await requestEvaluation({
        question: question.prompt,
        modelAnswer: question.model,
        sectionTitle: question.sectionTitle,
        kindLabel: KIND_LABEL[question.kind],
        difficulty: mockLevelLabel(plan?.config.difficulty ?? difficulty),
        answer: combined || '(only a code run was recorded)',
        lang: voiceRef.current.lang,
      }, { answer: question.model });
      if (questionRef.current !== askedFor) return;
      setAiResult(result);
      setAiQuestionId(askedFor);
    } catch {
      if (questionRef.current !== askedFor) return;
      setAiError('The answer could not be evaluated — the rubric below is still yours. Press Retry.');
    } finally {
      if (questionRef.current === askedFor) setChecking(false);
    }
  };

  const askFollowUp = () => {
    if (!question) return;
    const combined = [answer, ...followUps.map((item) => item.answer)].filter(Boolean).join(' ');
    const options = followUpsFor(question, combined, { lang: voiceRef.current.lang, limit: 2 });
    const next = options.find((option) => !followUps.some((item) => item.prompt === option.prompt));
    if (!next) {
      toast('No further follow-up is needed for this answer. Move to the next question.', 'info');
      return;
    }
    setActiveFollowUp(next.prompt);
    setFollowUpDraft('');
    if (voiceRef.current.supported.synthesis) {
      voiceRef.current.speak(next.prompt, [], () => {
        if (autoListenRef.current) voiceRef.current.startListening(handleAnswerRef.current, { continuous: true });
      });
    }
  };

  const saveFollowUp = () => {
    if (!session || !question || !activeFollowUp || !followUpDraft.trim()) return;
    const nextFollowUps = [...followUps, { prompt: activeFollowUp, answer: followUpDraft.trim() }];
    setFollowUps(nextFollowUps);
    setActiveFollowUp(null);
    setFollowUpDraft('');
    const combined = [answer, ...nextFollowUps.map((item) => item.answer)].filter(Boolean).join(' ');
    setFeedback(evaluateMockAnswer(question, combined, coding));
    setSession(recordMockAnswer(session, question.id, { text: answer, followUps: nextFollowUps, coding }));
  };

  /** One press, one advance: a double-click must never skip a question silently. */
  const claimAdvance = (): boolean => {
    const now = Date.now();
    if (now - advancingRef.current < 400) return false;
    advancingRef.current = now;
    return true;
  };

  /** Move on without recording anything: a skipped question is never scored. */
  const advance = () => {
    if (!plan || !claimAdvance()) return;
    voiceRef.current.stopListening();
    voiceRef.current.stopSpeaking();
    if (index + 1 >= plan.questions.length) {
      finish();
      return;
    }
    setIndex(index + 1);
    resetForQuestion();
  };

  const nextQuestion = advance;
  const skipQuestion = advance;

  const runCoding = async () => {
    if (!question) return;
    setCodingBusy(true);
    setCodingOutput('');
    try {
      const result = await runPython(codingCode, '', `mock:${session?.id ?? 'draft'}`);
      setCoding({
        ran: true,
        ok: result.ok,
        output: [result.output, result.error].filter(Boolean).join('\n'),
      });
      setCodingOutput([result.output, result.error].filter(Boolean).join('\n') || '(no output)');
    } catch (cause) {
      const message = String(cause);
      setCoding({ ran: true, ok: false, output: message });
      setCodingOutput(message);
    } finally {
      setCodingBusy(false);
    }
  };

  const openHistoryReport = (item: MockReport) => {
    setReport(item);
    setPhase('report');
  };

  const deleteReport = (id: string) => {
    const next = removeReport(historyRef.current, id);
    historyRef.current = next;
    setHistory(next);
    writeHistory(historyKey, next);
    if (report?.id === id) {
      setReport(null);
      setPhase(history.length ? 'history' : 'setup');
    }
  };

  if (sections.length === 0) {
    return <div className="card loading">Loading the interview bank from the bundled curriculum…</div>;
  }

  if (phase === 'setup') {
    return (
      <div className="mock-setup">
        <section className="card">
          <h2 className="row" style={{ gap: 8, margin: 0 }}><Mic2 size={18} color="var(--pink)" /> Spoken mock interview</h2>
          <p className="small muted" style={{ margin: '6px 0 12px', maxWidth: 760 }}>
            One round, one question at a time, built only from the bundled curriculum and the
            authored interview sets — both collections now live in this single interview. Pick a
            role, a level and a length (quick 10, standard 20, deep 30, or a custom count). The
            interviewer reads each question aloud, keeps your spoken answer as an editable transcript,
            asks a follow-up about what is missing, and writes a report with separate technical,
            reasoning, communication and coding evidence. Scores are deterministic estimates, not a
            hiring decision.
          </p>

          <div className="mock-form-grid">
            <label className="small muted" htmlFor="mock-role">Role</label>
            <select id="mock-role" value={role} onChange={(event) => {
              const next = event.target.value as MockRoleId;
              setRole(next);
              setTopics(mockRole(next).topics);
              setFocusSection(0);
            }}>
              {MOCK_ROLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>

            <label className="small muted" htmlFor="mock-difficulty">Level</label>
            <select id="mock-difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value as MockDifficulty)}>
              {MOCK_DIFFICULTIES.map((level) => <option key={level} value={level}>{mockLevelLabel(level)}</option>)}
            </select>

            <label className="small muted" htmlFor="mock-count">Questions</label>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {MOCK_LENGTHS.map((count) => (
                <button
                  key={count}
                  type="button"
                  className={`chip mock-topic${questionCount === count ? ' on' : ''}`}
                  aria-pressed={questionCount === count}
                  onClick={() => setQuestionCount(count)}
                >
                  {count === 10 ? 'Quick · 10' : count === 20 ? 'Standard · 20' : 'Deep · 30'}
                </button>
              ))}
              <input
                id="mock-count"
                type="number"
                min={MIN_QUESTION_COUNT}
                max={MAX_QUESTION_COUNT}
                value={questionCount}
                aria-label={`Custom question count, ${MIN_QUESTION_COUNT} to ${MAX_QUESTION_COUNT}`}
                onChange={(event) => setQuestionCount(normalizeQuestionCount(event.target.value))}
                style={{ width: 84 }}
              />
            </div>

            <label className="small muted" htmlFor="mock-focus">Focus section</label>
            <select
              id="mock-focus"
              value={focusSection}
              onChange={(event) => {
                const no = Number(event.target.value);
                setFocusSection(no);
                if (no > 0) {
                  const owned = topicsForSection(no);
                  if (owned.length) setTopics(owned);
                }
              }}
            >
              <option value={0}>Whole curriculum for this role</option>
              {sections.map((section) => (
                <option key={section.id} value={section.no}>{section.no}. {section.title}</option>
              ))}
            </select>
          </div>

          <fieldset className="mock-topics">
            <legend className="small muted">Topics (real curriculum sections only)</legend>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {MOCK_TOPICS.map((topic) => {
                const on = topics.includes(topic.id);
                return (
                  <label key={topic.id} className={`chip mock-topic${on ? ' on' : ''}`} title={topic.hint}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setTopics((current) => (on
                        ? current.filter((id) => id !== topic.id)
                        : [...current, topic.id]))}
                    />
                    {topic.label}
                  </label>
                );
              })}
            </div>
            <p className="small muted" style={{ margin: '8px 0 0' }}>
              Not in this curriculum: {UNAVAILABLE_TOPICS.map((item) => item.label).join(', ')}. The app will not invent a bank that is not bundled.
            </p>
          </fieldset>

          <div className="row spread" style={{ flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
            <div className="small muted">
              <b className="chip">{preview.available} eligible questions</b>{' '}
              <span>
                this round asks <b>{preview.questions.length}</b> in {roundMinutes} minutes
                {focusSection > 0 ? ` · focused on section ${focusSection}` : ''}.
              </span>
            </div>
            <button type="button" className="btn primary" onClick={start} disabled={!preview.questions.length || !topics.length}>
              <Play size={14} /> Start spoken round
            </button>
          </div>
          {preview.notes.length > 0 && (
            <ul className="mock-notes small muted">
              {preview.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
          <label className="mentor-check small" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={autoListen} onChange={(event) => setAutoListen(event.target.checked)} />
            <span>Open the mic automatically after each question is read</span>
          </label>
        </section>

        <section className="card">
          <div className="row spread">
            <h2 className="row" style={{ gap: 8, margin: 0 }}><History size={16} /> Interview history</h2>
            <button type="button" className="btn small" onClick={() => setPhase('history')} disabled={!history.length}>
              View all ({history.length})
            </button>
          </div>
          {history.length === 0 ? (
            <p className="small muted" style={{ marginTop: 8 }}>No completed round yet. Start one above; the report is saved on this device.</p>
          ) : (
            <div className="mock-history">
              {history.slice(0, 3).map((item) => (
                <button key={item.id} type="button" className="mock-history-row" onClick={() => openHistoryReport(item)}>
                  <span>
                    <b className="small">{mockRole(item.config.role).label}</b>
                    <span className="small muted"> · {new Date(item.createdAt).toLocaleDateString()}</span>
                    <span className="small muted block">{reportHeadline(item)}</span>
                  </span>
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  if (phase === 'history') {
    return (
      <section className="card">
        <div className="row spread">
          <h2 className="row" style={{ gap: 8, margin: 0 }}><History size={17} /> Interview history and reports</h2>
          <button type="button" className="btn small" onClick={() => setPhase('setup')}><ArrowLeft size={13} /> Back to setup</button>
        </div>
        {history.length === 0 ? (
          <p className="small muted" style={{ marginTop: 10 }}>No report yet. Finish a round and it appears here.</p>
        ) : (
          <div className="mock-history" style={{ marginTop: 10 }}>
            {history.map((item) => (
              <div key={item.id} className="mock-history-row static">
                <button type="button" className="mock-history-open" onClick={() => openHistoryReport(item)}>
                  <span>
                    <b className="small">{mockRole(item.config.role).label}</b>
                    <span className="small muted"> · {new Date(item.createdAt).toLocaleString()}</span>
                    <span className="small muted block">{reportHeadline(item)} · {item.config.minutes} min · {item.config.difficulty}</span>
                  </span>
                  {item.totals.overall !== null && <span className="chip">{item.totals.overall}%</span>}
                  <ArrowRight size={14} />
                </button>
                <button type="button" className="icon-btn" onClick={() => deleteReport(item.id)} aria-label="Delete this report">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  if (phase === 'live' && plan && question) {
    const progress = Math.round(((index + 1) / Math.max(1, plan.questions.length)) * 100);
    return (
      <div className="mock-live">
        <section className="card">
          <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div>
              <span className="chip">{mockRole(plan.config.role).label} · {mockLevelLabel(plan.config.difficulty)}</span>
              <span className="chip" style={{ marginLeft: 6 }}>Question {index + 1} / {plan.questions.length}</span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <span className={`chip ${remaining <= 60 ? 'hard' : ''}`}><Clock size={11} /> {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span>
              <button type="button" className="btn small" onClick={finish}><CheckCircle2 size={12} /> Finish round</button>
            </div>
          </div>
          <Bar pct={progress} />
          <p className="small muted" style={{ marginTop: 4 }}>
            {progress}% completed · {question.sectionTitle} · {KIND_LABEL[question.kind]} · {mockLevelLabel(plan.config.difficulty)} · {roundMinutes} minutes total
          </p>
          <h2 style={{ marginTop: 8 }}>{question.prompt}</h2>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="btn small" onClick={() => askQuestion(question)}><Volume2 size={12} /> Read question aloud</button>
            {voice.speaking && (
              <button type="button" className="btn small" onClick={voice.stopSpeaking}><Square size={12} /> Stop speaking</button>
            )}
            <label className="small muted row" style={{ gap: 4 }}>
              Language
              <select
                value={voice.lang}
                onChange={(event) => voice.setLang(event.target.value as Parameters<typeof voice.setLang>[0])}
                aria-label="Recognition and question language"
              >
                <option value="en-IN">English (India)</option>
                <option value="hi-IN">Hindi (India)</option>
              </select>
            </label>
            {question.sourceDifficulty && <span className="chip">{question.sourceDifficulty}</span>}
            {question.check && <span className="chip">task check: {question.check.slice(0, 80)}</span>}
          </div>

          <label className="small muted" htmlFor="mock-answer" style={{ display: 'block', marginTop: 12 }}>
            Your answer (spoken transcript is editable)
          </label>
          {/* The live partial transcript is appended INSIDE the box, so the learner watches their
              words arrive where the answer lives — not in a line under it. The final result then
              commits the sentence to `answer`, and the box is editable the moment the mic stops. */}
          <textarea
            id="mock-answer"
            className="console"
            rows={5}
            value={voice.listening && voice.interim ? `${answer}${answer ? ' ' : ''}${voice.interim}` : answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Press Start listening and answer aloud, or type. One question at a time."
            style={{ width: '100%', marginTop: 5 }}
          />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            <button
              type="button"
              className={`btn small${voice.listening ? ' primary' : ''}`}
              onClick={() => voice.toggleListening(handleAnswer, { continuous: true })}
              aria-pressed={voice.listening}
              disabled={!voice.supported.recognition}
              title={voice.supported.recognition ? 'Answer aloud; the transcript lands in the box and stays editable' : 'This browser has no speech recognition — type your answer instead'}
            >
              {voice.listening ? <><MicOff size={13} /> Stop listening</> : <><Mic2 size={13} /> Start listening</>}
            </button>
            <button
              type="button"
              className="btn small primary"
              onClick={() => { void checkAnswer(); }}
              disabled={checking || (!answer.trim() && !coding?.ran)}
            >
              {checking ? <><Loader2 size={13} className="spin" /> Checking…</> : <><CheckCircle2 size={13} /> Check answer</>}
            </button>
            <button type="button" className="btn small" onClick={askFollowUp} disabled={!feedback}>
              <Sparkles size={13} /> Ask a follow-up
            </button>
            <button type="button" className="btn small ghost" onClick={skipQuestion} disabled={Boolean(feedback)}>
              Skip question <ArrowRight size={12} />
            </button>
            <button type="button" className="btn small" onClick={nextQuestion}>
              {index + 1 >= plan.questions.length ? 'Finish' : 'Next question'} <ArrowRight size={12} />
            </button>
          </div>
          {voice.interim && <p className="voice-interim small" aria-live="polite">“{voice.interim}”</p>}
          {voice.error && (
            <p className="voice-error small" role="status">
              <span>{voice.error}</span>
              <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} onClick={voice.dismissError} aria-label="Dismiss the voice message">×</button>
            </p>
          )}
          <p className="small muted" aria-live="polite" style={{ margin: '6px 0 0' }}>
            {voice.listening
              ? `Listening… speak naturally${voice.interim ? ' — your words appear in the box as you talk.' : '.'}`
              : answer.trim()
                ? 'Microphone off. The transcript stays editable — fix a word, then press Check answer.'
                : 'Type or press Start listening. Nothing is sent to BroCode as audio.'}
          </p>
        </section>

        {(question.kind === 'coding' || question.kind === 'debug') && (
          <section className="card">
            <div className="row spread" style={{ flexWrap: 'wrap', gap: 6 }}>
              <b className="small row" style={{ gap: 6 }}><BarChart3 size={14} /> Coding evidence</b>
              <span className="row" style={{ gap: 6 }}>
                {coding?.ran ? <span className={`chip ${coding.ok ? 'easy' : 'hard'}`}>{coding.ok ? 'Code ran without an error' : 'Code ran and raised'}</span> : <span className="chip">No run recorded</span>}
                <button type="button" className="btn small primary" onClick={() => { void runCoding(); }} disabled={codingBusy}>
                  {codingBusy ? <><Loader2 size={12} className="spin" /> Running…</> : <><Play size={12} /> Run code</>}
                </button>
                <button type="button" className="btn small" onClick={() => stopPython()} disabled={!codingBusy}><Square size={11} /> Stop</button>
              </span>
            </div>
            <div style={{ marginTop: 8 }}>
              <Suspense fallback={<div className="editor loading" style={{ height: 220 }}>Loading the editor…</div>}>
                <MonacoIDE
                  value={codingCode}
                  language="python"
                  onChange={(value) => { setCodingCode(value); setCoding(undefined); setCodingOutput(''); }}
                  onRun={() => { void runCoding(); }}
                  errors={(() => {
                    const diag = parseTraceback(codingOutput);
                    return diag?.line ? [{ line: diag.line, message: `${diag.kind}: ${diag.message}`, severity: 'error' as const }] : [];
                  })()}
                  height={220}
                />
              </Suspense>
            </div>
            <pre className="codeblock" style={{ maxHeight: 130, overflow: 'auto', marginTop: 6 }}>{codingOutput || '—'}</pre>
            <p className="small muted" style={{ margin: 0 }}>
              The score uses only the run that is recorded here. It never assumes a test passed, and a missing expected output is reported as evidence missing.
            </p>
          </section>
        )}

        {(checking || aiError || (aiResult && aiQuestionId === question.id)) && (
          <section className="card fadeup" aria-live="polite">
            <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
              <h2 className="row" style={{ gap: 8, margin: 0 }}>
                <Sparkles size={16} /> Answer check
              </h2>
              {aiResult && aiQuestionId === question.id && (
                <span className={`chip ${aiResult.source === 'ai' ? 'easy' : ''}`}>
                  {aiResult.source === 'ai' ? `AI review${aiResult.model ? ` · ${aiResult.model}` : ''}` : 'Built-in rubric'}
                </span>
              )}
            </div>
            {checking && (
              <p className="small muted" style={{ margin: '8px 0 0' }}>
                <Loader2 size={12} className="spin" /> Checking the answer against the authored model answer…
              </p>
            )}
            {aiError && (
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <span className="small voice-error">{aiError}</span>
                <button type="button" className="btn small" onClick={() => { void checkAnswer(); }}>
                  <RotateCcw size={12} /> Retry
                </button>
              </div>
            )}
            {aiResult && aiQuestionId === question.id && (
              <>
                <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <span className="chip"><b>{Math.round(aiResult.evaluation.score) / 10}/10</b></span>
                  <span className="chip">{aiResult.evaluation.status.replace(/-/g, ' ')}</span>
                  <span className="chip">{aiResult.evaluation.technicalAccuracy.replace(/-/g, ' ')}</span>
                </div>
                {aiResult.note && <p className="small muted" style={{ margin: '8px 0 0' }}>{aiResult.note}</p>}
                <p className="small" style={{ margin: '8px 0 0' }}><b>Why this score:</b> {aiResult.evaluation.explanation}</p>
                {aiResult.evaluation.conceptsUnderstood.length > 0 && (
                  <>
                    <p className="small" style={{ margin: '10px 0 4px' }}><b>What you explained correctly</b></p>
                    <ul className="small mock-feedback-list">
                      {aiResult.evaluation.conceptsUnderstood.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </>
                )}
                {aiResult.evaluation.missingConcepts.length > 0 && (
                  <>
                    <p className="small" style={{ margin: '10px 0 4px' }}><b>Missing concepts</b></p>
                    <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
                      {aiResult.evaluation.missingConcepts.map((item) => <span key={item} className="chip hard">{item}</span>)}
                    </div>
                  </>
                )}
                {(aiResult.evaluation.mistakes.length > 0 || aiResult.evaluation.nextStep) && (
                  <>
                    <p className="small" style={{ margin: '10px 0 4px' }}><b>What to improve</b></p>
                    <ul className="small mock-feedback-list weak">
                      {aiResult.evaluation.mistakes.map((item) => <li key={item}>{item}</li>)}
                      {aiResult.evaluation.nextStep && <li>{aiResult.evaluation.nextStep}</li>}
                    </ul>
                  </>
                )}
                <p className="small" style={{ margin: '10px 0 4px' }}><b>Interview-ready answer</b></p>
                <div className="bubble small">{aiResult.evaluation.modelAnswer || question.model}</div>
                <p className="small muted" style={{ margin: '8px 0 0' }}>
                  <b>Hinglish:</b>{' '}
                  {aiResult.evaluation.status === 'correct' ? 'jawab sahi hai'
                    : aiResult.evaluation.status === 'partially-correct' ? 'aadha sahi hai'
                      : aiResult.evaluation.status === 'needs-clarification' ? 'jawab thoda vague hai'
                        : 'jawab galat hai'}
                  {aiResult.evaluation.missingConcepts.length > 0
                    ? ` — ye cover karo: ${aiResult.evaluation.missingConcepts.slice(0, 3).join(', ')}.`
                    : '.'}
                  {aiResult.evaluation.nextStep ? ` ${aiResult.evaluation.nextStep}` : ''}
                </p>
              </>
            )}
          </section>
        )}

        {feedback && (
          <section className="card fadeup">
            <div className="row spread">
              <h2 className="row" style={{ gap: 8, margin: 0 }}><ListChecks size={16} /> Feedback for this answer</h2>
              <span className="chip">{feedback.overall ?? 0}% overall</span>
            </div>
            <div className="scoregrid" style={{ marginTop: 10 }}>
              <ScoreCell label="Technical correctness" value={feedback.technical} basis={feedback.basis.technical} />
              <ScoreCell label="Reasoning" value={feedback.reasoning} basis={feedback.basis.reasoning} />
              <ScoreCell label="Communication" value={feedback.communication} basis={feedback.basis.communication} />
              <ScoreCell label="Coding / tests" value={feedback.coding} basis={feedback.basis.coding} />
            </div>
            {feedback.missing.length > 0 && (
              <>
                <p className="small" style={{ margin: '10px 0 4px' }}><b>Key points not in your answer</b></p>
                <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
                  {feedback.missing.slice(0, 8).map((point) => <span key={point} className="chip hard">{point.split('|').slice(0, 2).join(' / ')}</span>)}
                </div>
              </>
            )}
            {feedback.strengths.length > 0 && <ul className="small mock-feedback-list">{feedback.strengths.map((s) => <li key={s}>{s}</li>)}</ul>}
            {feedback.weaknesses.length > 0 && <ul className="small mock-feedback-list weak">{feedback.weaknesses.map((w) => <li key={w}>{w}</li>)}</ul>}
            <details style={{ marginTop: 8 }}>
              <summary className="small muted" style={{ cursor: 'pointer' }}>Show the model answer</summary>
              <div className="bubble" style={{ marginTop: 6 }}>{question.model}</div>
            </details>
            {activeFollowUp ? (
              <div className="mock-followup">
                <b className="small">Follow-up: {activeFollowUp}</b>
                <textarea
                  className="console"
                  rows={3}
                  value={followUpDraft}
                  onChange={(event) => setFollowUpDraft(event.target.value)}
                  placeholder="Answer the follow-up aloud (press the mic) or type here."
                  style={{ width: '100%', marginTop: 5 }}
                />
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <button type="button" className="btn small" onClick={() => voice.toggleListening(handleAnswer, { continuous: true })} aria-pressed={voice.listening}>
                    {voice.listening ? <><MicOff size={12} /> Stop</> : <><Mic2 size={12} /> Answer by voice</>}
                  </button>
                  <button type="button" className="btn small primary" onClick={saveFollowUp} disabled={!followUpDraft.trim()}>
                    Save follow-up answer
                  </button>
                </div>
              </div>
            ) : (
              <p className="small muted" style={{ margin: '8px 0 0' }}>
                The follow-up is based on this answer and the model rubric; ask it before moving on if you want the full practice.
              </p>
            )}
          </section>
        )}
      </div>
    );
  }

  if (phase === 'report' && report) {
    return <ReportView report={report} onBack={() => setPhase(history.length ? 'history' : 'setup')} onNew={() => { setPhase('setup'); setPlan(null); setSession(null); setReport(null); }} />;
  }

  return (
    <section className="card">
      <div className="row spread">
        <h2 className="row" style={{ gap: 8, margin: 0 }}><Mic2 size={17} /> Spoken mock interview</h2>
        <button type="button" className="btn small" onClick={() => setPhase('setup')}>Back</button>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>This round has no question to show. Go back and choose a topic with available questions.</p>
    </section>
  );
}

function ScoreCell({ label, value, basis }: { label: string; value: number | null; basis: string }) {
  return (
    <div className="scorecell" title={basis}>
      <span className="small muted">{label}</span>
      <b>{value === null ? '—' : `${value}%`}</b>
      <Bar pct={value ?? 0} />
      <span className="small muted" style={{ fontSize: '.68rem' }}>{basis}</span>
    </div>
  );
}

function ReportView({ report, onBack, onNew }: { report: MockReport; onBack: () => void; onNew: () => void }) {
  const role = mockRole(report.config.role);
  return (
    <div className="mock-report">
      <section className="card">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 className="row" style={{ gap: 8, margin: 0 }}><BarChart3 size={18} /> Interview report</h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              {role.label} · {report.config.difficulty} · {report.config.minutes} min · {new Date(report.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn small" onClick={onBack}><ArrowLeft size={12} /> History</button>
            <button type="button" className="btn small primary" onClick={onNew}><RotateCcw size={12} /> New round</button>
          </div>
        </div>
        <div className="scoregrid" style={{ marginTop: 12 }}>
          <ScoreCell label="Overall estimate" value={report.totals.overall} basis="Weighted from the measured dimensions; not a hiring judgment." />
          <ScoreCell label="Technical correctness" value={report.totals.technical} basis="Keyword rubric across the answered questions." />
          <ScoreCell label="Reasoning" value={report.totals.reasoning} basis="Visible cause/example/edge-case signals." />
          <ScoreCell label="Communication" value={report.totals.communication} basis="Word and sentence structure only." />
          <ScoreCell label="Coding / tests" value={report.totals.coding} basis="Recorded runs only; null when no code ran." />
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>{report.answered}/{report.total} questions answered · {Math.round(report.durationSeconds / 60)} min round</p>
        {report.notes.length > 0 && (
          <ul className="mock-notes small muted">
            {report.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        )}
      </section>

      <div className="mock-report-grid">
        <section className="card">
          <h2 className="row" style={{ gap: 8, margin: 0 }}><CheckCircle2 size={15} color="var(--green)" /> Strengths</h2>
          <ul className="small mock-feedback-list">{report.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
          <h2 className="row" style={{ gap: 8, marginTop: 12 }}><AlertTriangle size={15} color="var(--amber)" /> What to improve</h2>
          <ul className="small mock-feedback-list weak">{report.weaknesses.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>

        <section className="card">
          <h2 className="row" style={{ gap: 8, margin: 0 }}><Sparkles size={15} color="var(--cyan)" /> Revision plan</h2>
          {report.revision.length === 0 ? (
            <p className="small muted" style={{ marginTop: 8 }}>No section fell below the threshold in this round. Keep practising edge cases in the Question Bank.</p>
          ) : (
            <div className="mock-revision">
              {report.revision.map((item) => (
                <div key={item.sectionId} className="mock-revision-row">
                  <div>
                    <b className="small">{item.sectionTitle}</b>
                    <p className="small muted" style={{ margin: '2px 0 0' }}>{item.reason}</p>
                  </div>
                  <Link className="btn small" to={item.route}>Revise <ArrowRight size={11} /></Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <h2 className="row" style={{ gap: 8, margin: 0 }}><ListChecks size={15} /> Questions and answers</h2>
        {report.incomplete.length > 0 && (
          <div className="mock-incomplete">
            <b className="small">Answered incorrectly or incompletely</b>
            {report.incomplete.map((item, index) => (
              <details key={`${item.prompt}-${index}`} className="mock-incomplete-row">
                <summary className="small">
                  <span>{item.prompt.slice(0, 110)}{item.prompt.length > 110 ? '…' : ''}</span>
                  <span className="muted"> · {item.sectionTitle}</span>
                </summary>
                <p className="small" style={{ margin: '6px 0' }}><b>Your answer:</b> {item.answer || '(not answered)'}</p>
                {item.missing.length > 0 && <p className="small" style={{ margin: '6px 0' }}><b>Missing:</b> {item.missing.map((m) => m.split('|').slice(0, 2).join(' / ')).join(' · ')}</p>}
                <p className="small" style={{ margin: '6px 0' }}><b>Why:</b> {item.explanation}</p>
                <div className="bubble small">{item.model}</div>
              </details>
            ))}
          </div>
        )}
        <div className="mock-results">
          {report.results.map((result, index) => (
            <article key={result.question.id} className="mock-result-row">
              <div className="row spread" style={{ gap: 8, alignItems: 'flex-start' }}>
                <b className="small">Q{index + 1}. {result.question.prompt.slice(0, 130)}{result.question.prompt.length > 130 ? '…' : ''}</b>
                <span className="chip">{result.score.overall === null ? 'not answered' : `${result.score.overall}%`}</span>
              </div>
              <p className="small muted" style={{ margin: '3px 0' }}>{result.question.sectionTitle} · {result.question.kind}</p>
              {result.answer && <p className="small" style={{ margin: '5px 0' }}><b>Your answer:</b> {result.answer}</p>}
              {result.followUps.map((followUp) => (
                <p key={followUp.prompt} className="small" style={{ margin: '5px 0' }}><b>Follow-up:</b> {followUp.prompt}<br /><b>Answer:</b> {followUp.answer}</p>
              ))}
              {result.score.evidence.length > 0 && (
                <details>
                  <summary className="small muted" style={{ cursor: 'pointer' }}>Evidence and rubric</summary>
                  <ul className="small" style={{ margin: '5px 0 0', paddingLeft: 18 }}>
                    {result.score.evidence.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                  <div className="bubble small" style={{ marginTop: 5 }}>{result.question.model}</div>
                </details>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="card mock-disclaimer">
        <p className="small" style={{ margin: 0 }}><b>How these scores work.</b> {report.disclaimer}</p>
      </section>
    </div>
  );
}
