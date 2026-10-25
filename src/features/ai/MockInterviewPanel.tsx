import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, ArrowRight, BarChart3, CheckCircle2, Clock, History,
  ListChecks, Loader2, Mic2, MicOff, Play, RotateCcw, Send, Sparkles, Square, Trash2, Volume2,
} from 'lucide-react';
import { useCurriculum } from '../../core/data/curriculum';
import {
  MOCK_DIFFICULTIES, MOCK_MINUTES, MOCK_ROLES, MOCK_TOPICS, UNAVAILABLE_TOPICS,
  addReport, buildMockPlan, buildMockReport, createMockSession, evaluateMockAnswer, followUpsFor,
  mockRole, normalizeTopics, recordMockAnswer, removeReport, reportHeadline, sanitizeReports,
  type MockAnswerScore, type MockConfig, type MockCodingEvidence, type MockDifficulty, type MockMinutes,
  type MockPlan, type MockQuestion, type MockReport, type MockRoleId, type MockSession, type MockTopicId,
} from '../../core/assessment/mock-interview';
import { spokenReply } from '../../core/ai/voice';
import { MOCK_HISTORY_KEY } from '../../core/platform/keys';
import { accountStorageKey, subscribeStorageAccount } from '../../core/storage/account';
import { useVoiceTutor } from '../../components/shared/useVoiceTutor';
import { runPython, stopPython } from '../coding/runners';
import { parseTraceback } from '../../core/platform/traceback';
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
export function MockInterviewPanel({ initialPhase = 'setup' }: { initialPhase?: Phase } = {}) {
  const { sections } = useCurriculum();
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
  const [minutes, setMinutes] = useState<MockMinutes>(15);

  const [plan, setPlan] = useState<MockPlan | null>(null);
  const [session, setSession] = useState<MockSession | null>(null);
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [answer, setAnswer] = useState('');
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

  const voice = useVoiceTutor(false);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const autoListenRef = useRef(autoListen);
  autoListenRef.current = autoListen;

  const question = plan?.questions[index] ?? null;
  const preview = useMemo(
    () => buildMockPlan(sections, { role, topics, difficulty, minutes, seed: 1 }),
    [sections, role, topics, difficulty, minutes],
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
      if (autoListenRef.current) voiceRef.current.startListening(handleAnswerRef.current);
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
    if (!topics.length) {
      toast('Choose at least one topic for the round.', 'warning');
      return;
    }
    const builtPlan = buildMockPlan(sections, {
      role, topics, difficulty, minutes, seed: Date.now(),
    });
    if (!builtPlan.questions.length) {
      toast(builtPlan.notes[0] ?? 'No question matches this selection. Choose another topic.', 'warning');
      return;
    }
    setPlan(builtPlan);
    setSession(createMockSession(builtPlan));
    setIndex(0);
    setRemaining(minutes * 60);
    setReport(null);
    resetForQuestion();
    setPhase('live');
  };

  const submitAnswer = () => {
    if (!session || !question) return;
    if (!answer.trim() && !coding?.ran) {
      toast('Answer by voice or type first — an empty answer cannot be scored.', 'warning');
      return;
    }
    const combined = [answer, ...followUps.map((item) => item.answer)].filter(Boolean).join(' ');
    setFeedback(evaluateMockAnswer(question, combined, coding));
    const next = recordMockAnswer(session, question.id, {
      text: answer,
      followUps,
      coding,
    });
    setSession(next);
    voiceRef.current.stopListening();
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
        if (autoListenRef.current) voiceRef.current.startListening(handleAnswerRef.current);
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

  const nextQuestion = () => {
    if (!plan) return;
    voiceRef.current.stopListening();
    voiceRef.current.stopSpeaking();
    if (index + 1 >= plan.questions.length) {
      finish();
      return;
    }
    setIndex(index + 1);
    resetForQuestion();
  };

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
            A timed round built only from questions in the bundled curriculum. The interviewer asks
            one question aloud, transcribes your answer, asks a follow-up about what is missing, and
            writes a report with separate technical, reasoning, communication and coding evidence.
            Scores are deterministic estimates, not a hiring decision.
          </p>

          <div className="mock-form-grid">
            <label className="small muted" htmlFor="mock-role">Role</label>
            <select id="mock-role" value={role} onChange={(event) => {
              const next = event.target.value as MockRoleId;
              setRole(next);
              setTopics(mockRole(next).topics);
            }}>
              {MOCK_ROLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>

            <label className="small muted" htmlFor="mock-difficulty">Difficulty</label>
            <select id="mock-difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value as MockDifficulty)}>
              {MOCK_DIFFICULTIES.map((level) => <option key={level} value={level}>{level[0].toUpperCase() + level.slice(1)}</option>)}
            </select>

            <label className="small muted" htmlFor="mock-minutes">Duration</label>
            <select id="mock-minutes" value={minutes} onChange={(event) => setMinutes(Number(event.target.value) as MockMinutes)}>
              {MOCK_MINUTES.map((value) => <option key={value} value={value}>{value} minutes</option>)}
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
              <span>this round picks {preview.questions.length}.</span>
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
    const progress = Math.round((index / Math.max(1, plan.questions.length)) * 100);
    return (
      <div className="mock-live">
        <section className="card">
          <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div>
              <span className="chip">{mockRole(plan.config.role).label} · {plan.config.difficulty}</span>
              <span className="chip" style={{ marginLeft: 6 }}>Q{index + 1} / {plan.questions.length}</span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <span className={`chip ${remaining <= 60 ? 'hard' : ''}`}><Clock size={11} /> {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span>
              <button type="button" className="btn small" onClick={finish}><CheckCircle2 size={12} /> Finish round</button>
            </div>
          </div>
          <Bar pct={progress} />
          <p className="small muted" style={{ marginTop: 4 }}>{question.sectionTitle} · {question.kind}</p>
          <h2 style={{ marginTop: 8 }}>{question.prompt}</h2>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="btn small" onClick={() => askQuestion(question)}><Volume2 size={12} /> Read question again</button>
            {question.sourceDifficulty && <span className="chip">{question.sourceDifficulty}</span>}
            {question.check && <span className="chip">task check: {question.check.slice(0, 80)}</span>}
          </div>

          <label className="small muted" htmlFor="mock-answer" style={{ display: 'block', marginTop: 12 }}>
            Your answer (spoken transcript is editable)
          </label>
          <textarea
            id="mock-answer"
            className="console"
            rows={5}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Press the mic below and answer aloud, or type. One question at a time."
            style={{ width: '100%', marginTop: 5 }}
          />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            <button
              type="button"
              className={`btn small${voice.listening ? ' primary' : ''}`}
              onClick={() => voice.toggleListening(handleAnswer)}
              aria-pressed={voice.listening}
            >
              {voice.listening ? <><MicOff size={13} /> Stop listening</> : <><Mic2 size={13} /> Answer by voice</>}
            </button>
            <button type="button" className="btn small primary" onClick={submitAnswer} disabled={!answer.trim() && !coding?.ran}>
              <CheckCircle2 size={13} /> Submit answer
            </button>
            <button type="button" className="btn small" onClick={askFollowUp} disabled={!feedback}>
              <Sparkles size={13} /> Ask a follow-up
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
          {voice.listening && <p className="small muted" aria-live="polite">Listening… speak naturally; the transcript appears above.</p>}
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
                  <button type="button" className="btn small" onClick={() => voice.toggleListening(handleAnswer)} aria-pressed={voice.listening}>
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
