import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, CircleHelp, Code2, FileDiff, Lightbulb,
  Loader2, Mic2, MicOff, Play, Send, Sparkles, Square, Wrench,
} from 'lucide-react';
import { useCurriculum } from '../../core/data/curriculum';
import { useStore } from '../../core/storage/store';
import { assistantContextForPage } from '../../core/ai/context';
import {
  analyzeCode, coachHints, explainCode, previewFindingPatch, type CodeCoachResult,
  type CodeFinding, type CoachLanguage,
} from '../../core/ai/coding-coach';
import { applyLinePatch, diffStats, type DiffLine } from '../../core/platform/diff';
import { spokenReply } from '../../core/ai/voice';
import { MENTOR_LOG_KEY } from '../../core/platform/keys';
import { accountStorageKey, subscribeStorageAccount } from '../../core/storage/account';
import { runJS, runPython, stopPython, warmupPython } from '../coding/runners';
import { useVoiceTutor } from '../../components/shared/useVoiceTutor';
import { toast } from '../../components/ui/Toast';
import { useMentorAsk } from './useMentorAsk';
import { MentorText } from './MentorText';

const MonacoIDE = lazy(() => import('../../components/code/MonacoIDE').then((m) => ({ default: m.MonacoIDE })));
type IdeError = import('../../components/code/MonacoIDE').IdeError;

const STARTERS: Record<'python' | 'javascript', string> = {
  python: `def average(numbers):
    total = 0
    for n in numbers:
        total += n
    return total / len(numbers)

print("average:", average([]))
`,
  javascript: `var values = [1, 2, 3]
const total = values.reduce((sum, n) => sum + n, 0)
if (total == 6) {
  console.log("total is", total)
}
console.log(missingName)
`,
};

interface RunState {
  code: string;
  ok: boolean;
  output: string;
  error?: string;
  ms: number;
}

/**
 * The Coding Coach tab.
 *
 * The rule the UI follows: a red squiggle and a "why" are shown only for evidence the engine has —
 * a real traceback from the bundled runner, or a named static pattern visible in the line. A
 * suggested repair is previewed as a diff and applied only when the learner presses Apply; the
 * apply re-checks the original line, so a preview that went stale refuses instead of overwriting.
 *
 * Python and JavaScript run in their real bundled runtimes here. C and C++ have no runtime in
 * BroCode, so the language selector does not offer them rather than pretending to execute them.
 */
export function CodingCoachPanel() {
  const location = useLocation();
  const { sections } = useCurriculum();
  const state = useStore();
  const logKey = useSyncExternalStore(
    subscribeStorageAccount,
    () => accountStorageKey(MENTOR_LOG_KEY),
    () => MENTOR_LOG_KEY,
  );

  const [language, setLanguage] = useState<'python' | 'javascript'>('python');
  const [code, setCodeState] = useState(STARTERS.python);
  const [stdin, setStdin] = useState('');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<RunState | null>(null);
  const [mode, setMode] = useState<'debug' | 'explain'>('debug');
  const [hintLevel, setHintLevel] = useState(1);
  const [preview, setPreview] = useState<{ findingId: string; lines: DiffLine[] } | null>(null);
  const [question, setQuestion] = useState('');
  const [pyReady, setPyReady] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const currentRun = run && run.code === code ? run : null;
  const error = currentRun?.error?.trim() || '';
  const context = useMemo(() => {
    const page = assistantContextForPage(location.pathname, location.search, sections, state);
    return {
      ...page,
      where: 'AI Mentor · Coding Coach',
      code,
      error: error || undefined,
      questionType: 'coding',
    };
  }, [location.pathname, location.search, sections, state, code, error]);
  const chat = useMentorAsk(logKey, context);
  const voice = useVoiceTutor(chat.busy || busy);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useEffect(() => {
    let alive = true;
    warmupPython().then((ok) => { if (alive) setPyReady(ok); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [chat.turns.length, chat.busy]);

  const analysis: CodeCoachResult = useMemo(() => analyzeCode({
    code,
    language: language as CoachLanguage,
    error: error || undefined,
    stdout: currentRun?.output,
    stdin,
    ran: currentRun !== null,
  }), [code, language, error, currentRun, stdin]);

  const explanation = useMemo(() => explainCode(code, language as CoachLanguage), [code, language]);
  const hints = coachHints(analysis, hintLevel);

  const setCode = (next: string) => {
    setCodeState(next);
    setPreview(null);
    setHintLevel(1);
    // Runtime evidence belongs to the exact text that ran. Editing invalidates it; keeping the old
    // traceback under the new code is how an assistant points at the wrong line.
    setRun((previous) => (previous && previous.code === next ? previous : null));
  };

  const changeLanguage = (next: 'python' | 'javascript') => {
    if (next === language) return;
    setLanguage(next);
    setCode(STARTERS[next]);
    setRun(null);
    setStdin('');
  };

  const execute = async () => {
    if (busy) return;
    voiceRef.current.stopListening();
    setBusy(true);
    setPreview(null);
    const runningCode = code;
    try {
      const result = language === 'python'
        ? await runPython(runningCode, stdin)
        : await runJS(runningCode);
      setRun({ code: runningCode, ok: result.ok, output: result.output, error: result.error, ms: result.ms });
      if (!result.ok) setMode('debug');
    } catch (cause) {
      setRun({ code: runningCode, ok: false, output: '', error: String(cause), ms: 0 });
    } finally {
      setBusy(false);
    }
  };

  const ask = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setQuestion('');
    const result = await chat.ask(clean, voiceRef.current.lang);
    if (!result) {
      toast('The coach could not answer that. Try naming the error or the line.', 'warning');
      return;
    }
    voiceRef.current.speak(spokenReply(result.reply.spoken, result.answer.sources), result.answer.sources);
  }, [chat]);

  const handleTranscript = useCallback((text: string) => { void ask(text); }, [ask]);

  const errors: IdeError[] = useMemo(() => analysis.findings
    .filter((finding) => finding.line !== null)
    .slice(0, 20)
    .map((finding) => ({
      line: finding.line!,
      message: `${finding.title} — ${finding.evidence}`,
      severity: finding.severity === 'error' ? 'error' : 'warning',
    })), [analysis.findings]);

  const openPreview = (finding: CodeFinding) => {
    const lines = previewFindingPatch(code, finding);
    if (!lines) {
      toast('That line no longer matches the finding. Run again to regenerate the evidence.', 'warning');
      return;
    }
    setPreview({ findingId: finding.id, lines });
  };

  const applyPreview = () => {
    if (!preview) return;
    const finding = analysis.findings.find((item) => item.id === preview.findingId);
    if (!finding?.patch) return;
    const next = applyLinePatch(code, finding.patch);
    if (next === null) {
      setPreview(null);
      toast('The line changed since the preview. Nothing was applied — run again.', 'warning');
      return;
    }
    setCode(next);
    setPreview(null);
    setRun(null);
    toast('Change applied. Review it, then run again.', 'success');
  };

  return (
    <div className="coach-grid">
      <section className="card coach-editor" aria-label="Code editor">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <Code2 size={17} color="var(--cyan)" />
            <select
              value={language}
              onChange={(event) => changeLanguage(event.target.value as 'python' | 'javascript')}
              aria-label="Coach language"
            >
              <option value="python">Python 3.12 (bundled runtime)</option>
              <option value="javascript">JavaScript (bundled worker)</option>
            </select>
            <span className="chip">{language === 'python' ? (pyReady ? 'Python ready' : 'Python starts on Run') : 'JS worker'}</span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn small primary" onClick={() => { void execute(); }} disabled={busy}>
              {busy ? <><Loader2 size={13} className="spin" /> Running…</> : <><Play size={13} /> Run code</>}
            </button>
            <button type="button" className="btn small" onClick={() => { stopPython(); setBusy(false); }} disabled={!busy}>
              <Square size={12} /> Stop
            </button>
          </div>
        </div>

        <div className="coach-editor-host">
          <Suspense fallback={<div className="editor loading" style={{ height: 360 }}>Loading the editor…</div>}>
            <MonacoIDE
              value={code}
              language={language}
              onChange={setCode}
              onRun={() => { void execute(); }}
              errors={errors}
              height={360}
            />
          </Suspense>
        </div>

        <div className="coach-io">
          <label className="small muted" htmlFor="coach-stdin">Program input (one value per line)</label>
          <textarea
            id="coach-stdin"
            className="editor"
            rows={2}
            value={stdin}
            onChange={(event) => { setStdin(event.target.value); setRun(null); }}
            placeholder="Only used when the code calls input()"
          />
        </div>

        <div className="coach-output">
          <div className="row spread" style={{ flexWrap: 'wrap', gap: 6 }}>
            <b className="small row" style={{ gap: 6 }}>
              <ChevronDot ok={currentRun ? currentRun.ok : null} />
              Output
            </b>
            <span className="small muted">
              {currentRun
                ? currentRun.ok
                  ? `Ran in ${currentRun.ms} ms · no Python error reported`
                  : `Ran in ${currentRun.ms} ms · the run raised`
                : 'Nothing has been run for this exact code.'}
            </span>
          </div>
          <pre className="codeblock" style={{ maxHeight: 150, overflow: 'auto', marginTop: 6 }}>
            {currentRun ? [currentRun.output, currentRun.error].filter(Boolean).join('\n') || '(no output)' : '—'}
          </pre>
        </div>

        <p className="small muted" style={{ margin: 0 }}>
          C and C++ samples are not supported because BroCode has no bundled compiler for them. The coach will not pretend to run code it cannot run.
        </p>
      </section>

      <section className="card coach-panel" aria-label="Coach findings">
        <div className="lang-toggle tutor-tabs" role="tablist" aria-label="Coach mode">
          <button type="button" role="tab" aria-selected={mode === 'debug'} className={mode === 'debug' ? 'on' : ''} onClick={() => setMode('debug')}>
            Debug
          </button>
          <button type="button" role="tab" aria-selected={mode === 'explain'} className={mode === 'explain' ? 'on' : ''} onClick={() => setMode('explain')}>
            Explain code
          </button>
        </div>

        {mode === 'debug' ? (
          <>
            <div className={`coach-summary ${analysis.findings.some((f) => f.severity === 'error') ? 'bad' : analysis.findings.length ? 'warn' : 'good'}`}>
              <b className="row" style={{ gap: 6 }}>
                {analysis.findings.some((f) => f.severity === 'error')
                  ? <AlertTriangle size={15} />
                  : analysis.findings.length
                    ? <Lightbulb size={15} />
                    : <CheckCircle2 size={15} />}
                {analysis.summary}
              </b>
              <p className="small muted" style={{ margin: '4px 0 0' }}>
                {analysis.ran ? 'Runtime evidence is from the last run of this exact code.' : 'No runtime evidence yet — the notes below are static observations.'}
              </p>
            </div>

            <div className="coach-hint">
              <div className="row spread">
                <b className="small row" style={{ gap: 6 }}><Lightbulb size={13} color="var(--amber)" /> Hint {hintLevel}/3</b>
                {hintLevel < 3 && (
                  <button type="button" className="btn small" onClick={() => setHintLevel((level) => Math.min(3, level + 1))}>
                    Another hint →
                  </button>
                )}
              </div>
              {hints.map((line, index) => (
                <p key={index} className="small" style={{ margin: '5px 0', whiteSpace: 'pre-wrap' }}>{line}</p>
              ))}
            </div>

            <div className="coach-findings">
              {!analysis.findings.length && (
                <div className="mentor-empty compact">
                  <CheckCircle2 size={22} color="var(--green)" />
                  <b>No finding from the evidence available</b>
                  <p className="small muted">
                    {analysis.ran
                      ? 'The last run did not raise and no static rule matched. That is not proof the logic is right — use the edge cases below.'
                      : 'Run the code. A traceback gives the coach a real line to point at.'}
                  </p>
                </div>
              )}
              {analysis.findings.map((finding) => (
                <article key={finding.id} className={`coach-finding ${finding.severity}`}>
                  <div className="row spread" style={{ gap: 8, alignItems: 'flex-start' }}>
                    <b className="small">{finding.title}</b>
                    <span className="row" style={{ gap: 5, flex: 'none' }}>
                      {finding.line !== null && <span className="chip">line {finding.line}</span>}
                      <span className={`chip ${finding.severity === 'error' ? 'hard' : finding.severity === 'warning' ? 'medium' : ''}`}>
                        {finding.severity}
                      </span>
                    </span>
                  </div>
                  <p className="small mono" style={{ margin: '6px 0' }}>{finding.evidence}</p>
                  <details>
                    <summary className="small muted" style={{ cursor: 'pointer' }}>Why, and how to fix it</summary>
                    <p className="small" style={{ margin: '6px 0' }}><b>Why:</b> {finding.why}</p>
                    <p className="small" style={{ margin: '6px 0' }}><b>Fix:</b> {finding.fix}</p>
                  </details>
                  {finding.patch && (
                    <button type="button" className="btn small" style={{ marginTop: 6 }} onClick={() => openPreview(finding)}>
                      <FileDiff size={12} /> Preview this fix
                    </button>
                  )}
                </article>
              ))}
            </div>

            {preview && (
              <div className="coach-diff">
                <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <b className="small row" style={{ gap: 6 }}><FileDiff size={13} /> Proposed change</b>
                  <span className="small muted">
                    +{diffStats(preview.lines).added} / −{diffStats(preview.lines).removed} · nothing is applied until you press Apply
                  </span>
                </div>
                <DiffView lines={preview.lines} />
                <div className="row" style={{ gap: 6, marginTop: 8 }}>
                  <button type="button" className="btn small primary" onClick={applyPreview}>
                    <Wrench size={12} /> Apply this change
                  </button>
                  <button type="button" className="btn small ghost" onClick={() => setPreview(null)}>Cancel</button>
                </div>
              </div>
            )}

            {analysis.complexity && (
              <div className="coach-complexity small">
                <b>Complexity estimate</b>
                <p style={{ margin: '4px 0' }}><b>Time:</b> {analysis.complexity.time}</p>
                <p style={{ margin: '4px 0' }}><b>Space:</b> {analysis.complexity.space}</p>
                <p className="muted" style={{ margin: '4px 0 0' }}>{analysis.complexity.basis}</p>
              </div>
            )}

            <div className="coach-tests small">
              <b>Edge cases to try (not run by the coach)</b>
              <ul style={{ margin: '5px 0 0', paddingLeft: 18 }}>
                {analysis.nextTests.map((test) => <li key={test}>{test}</li>)}
              </ul>
            </div>
          </>
        ) : (
          <>
            <div className="coach-summary good">
              <b className="row" style={{ gap: 6 }}><Code2 size={15} /> What this code visibly does</b>
              <p className="small muted" style={{ margin: '4px 0 0' }}>
                A structural reading only. Correctness needs a requirement and a run; this does not score the code.
              </p>
            </div>
            <ul className="coach-observations small">
              {explanation.observations.map((observation) => <li key={observation}>{observation}</li>)}
            </ul>
            {explanation.complexity && (
              <div className="coach-complexity small">
                <b>Complexity estimate</b>
                <p style={{ margin: '4px 0' }}><b>Time:</b> {explanation.complexity.time}</p>
                <p style={{ margin: '4px 0' }}><b>Space:</b> {explanation.complexity.space}</p>
                <p className="muted" style={{ margin: '4px 0 0' }}>{explanation.complexity.basis}</p>
              </div>
            )}
            <p className="small muted">
              {explanation.functions.length ? `Functions: ${explanation.functions.join(', ')}. ` : ''}
              {explanation.classes.length ? `Classes: ${explanation.classes.join(', ')}. ` : ''}
              {explanation.imports.length ? `Imports: ${explanation.imports.join(', ')}.` : 'No imports detected.'}
            </p>
          </>
        )}

        <div className="coach-ask">
          <b className="small row" style={{ gap: 6 }}><Sparkles size={13} color="var(--cyan)" /> Ask the coach about this code</b>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void ask(question); } }}
              placeholder={error ? 'Why did this error happen?' : 'Why is this slow? What edge case am I missing?'}
              aria-label="Ask the coding coach"
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              className={`icon-btn${voice.listening ? ' listening' : ''}`}
              onClick={() => voice.toggleListening(handleTranscript)}
              aria-pressed={voice.listening}
              aria-label={voice.listening ? 'Stop listening' : 'Ask the coding coach by voice'}
            >
              {voice.listening ? <MicOff size={15} /> : <Mic2 size={15} />}
            </button>
            <button type="button" className="btn small primary" onClick={() => { void ask(question); }} disabled={!question.trim() || chat.busy}>
              {chat.busy ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
            </button>
          </div>
          {voice.interim && <p className="voice-interim small" aria-live="polite">“{voice.interim}”</p>}
          {voice.error && (
            <p className="voice-error small" role="status">
              <span>{voice.error}</span>
              <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} onClick={voice.dismissError} aria-label="Dismiss the voice message">×</button>
            </p>
          )}
          <div className="coach-chat" ref={scroller} aria-live="polite">
            {chat.turns.slice(-6).map((turn, index) => (
              <div key={index} className={`bubble assistant-bubble ${turn.role === 'learner' ? 'from-user' : 'from-assistant'}`} style={{ alignSelf: turn.role === 'learner' ? 'flex-end' : 'flex-start' }}>
                {turn.role === 'learner' ? <span>{turn.text}</span> : <MentorText text={turn.text} />}
              </div>
            ))}
            {chat.busy && <div className="bubble from-assistant small" style={{ alignSelf: 'flex-start' }}><Loader2 size={12} className="spin" /> Reading the evidence…</div>}
          </div>
          <p className="small muted" style={{ margin: '6px 0 0' }}>
            The coach only says the code was run when the bundled runner actually returned for this text. Voice answers use the same engine.
          </p>
        </div>

        <p className="small muted" style={{ margin: 0 }}>
          Need a full interview? <Link to="/ai-mentor?tab=interview">Open the spoken mock interview</Link>.
        </p>
      </section>
    </div>
  );
}

function ChevronDot({ ok }: { ok: boolean | null }) {
  return <span aria-hidden="true" style={{
    display: 'inline-block', width: 7, height: 7, borderRadius: 99,
    background: ok === null ? 'var(--muted)' : ok ? 'var(--green)' : 'var(--red)',
  }} />;
}

function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="coach-diff-lines" role="table" aria-label="Line diff">
      {lines.map((line, index) => (
        <div key={`${line.type}-${index}`} className={`diff-line ${line.type}`} role="row">
          <span className="diff-no" aria-hidden="true">{line.beforeLine ?? line.afterLine ?? ''}</span>
          <span className="diff-sign" aria-hidden="true">{line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}</span>
          <code>{line.text || ' '}</code>
        </div>
      ))}
    </div>
  );
}
