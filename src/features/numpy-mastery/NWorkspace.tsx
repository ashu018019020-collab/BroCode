import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, BookOpen, Check, ChevronLeft, ChevronRight, Code2, Copy, Eye, EyeOff, Play, RotateCcw, Terminal,
} from 'lucide-react';
import { useStore, recordAttempt, useSavedAnswer } from '../../core/storage/store';
import {
  N_SECTIONS, N_SECTION_LABEL, decodeTicks, encodeTicks, isModuleComplete, nProgress, nSectionKey,
  nWrittenAnswerKey, nWrittenTicksKey, outputMatches,
  type NEntry, type NModule, type NSectionKey,
} from '../../core/learning/ncourse';
import { NLogo } from './NLogo';
import { NTools } from './NTools';
import type { RunResult } from '../coding/runners';

const DIFF_TONE: Record<NEntry['difficulty'], string> = { easy: 'easy', medium: 'medium', hard: 'hard' };

/** The module's completion, drawn as a ring like the Python course's section header. */
function ModuleRing({ pct, label }: { pct: number; label: string }) {
  const size = 64;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size }} title={`${label}: ${pct}%`}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line, #e3e8ef)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--blue, #2563eb)" strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={c - (Math.max(0, Math.min(100, pct)) / 100) * c} strokeLinecap="round"
        />
      </svg>
      <span className="small" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontWeight: 700 }}>
        {pct}%
      </span>
    </div>
  );
}

/**
 * A short-answer checkpoint.
 *
 * The prompt is a specific question, not "explain this in your own words": the model answer and the
 * three rubric criteria are published with it, the draft and the ticks are stored per entry, and the
 * section can only be recorded once a real answer was written and every criterion checked. Writing
 * nothing and revealing the answer is not a completion.
 */
function ShortAnswerCard({ entry, done, onPass }: { entry: NEntry; done: boolean; onPass: () => void }) {
  const rubric = entry.rubric ?? [];
  const [text, setText] = useSavedAnswer(nWrittenAnswerKey(entry.id));
  const [rawTicks, setRawTicks] = useSavedAnswer(nWrittenTicksKey(entry.id));
  const ticks = useMemo(() => decodeTicks(rawTicks, rubric.length), [rawTicks, rubric.length]);
  const [revealed, setRevealed] = useState(false);
  const enough = text.trim().length >= 40;
  const allTicked = rubric.length > 0 && ticks.every(Boolean);
  const toggle = (i: number, on: boolean) => setRawTicks(encodeTicks(ticks.map((value, j) => (j === i ? on : value))));

  return (
    <div className="card" style={{ margin: 0, padding: '12px 14px' }}>
      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className={`chip ${DIFF_TONE[entry.difficulty]}`}>{entry.difficulty}</span>
        <span className="row" style={{ gap: 6 }}>
          {done && <span className="chip easy"><Check size={11} /> done</span>}
          <span className="chip">short answer · rubric</span>
        </span>
      </div>
      <strong className="small" style={{ display: 'block', margin: '8px 0 4px' }}>{entry.q}</strong>
      {entry.code && <pre className="codeblock" style={{ margin: '6px 0' }}>{entry.code}</pre>}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Answer in two or three sentences, using the terms the rubric asks for."
        aria-label={`Your answer for ${entry.id}`}
        style={{
          width: '100%', minHeight: 96, padding: 10, borderRadius: 10, resize: 'vertical',
          border: '1px solid var(--line, #d6dbe4)', background: 'var(--bg2, #fff)', color: 'inherit',
          fontSize: 13, lineHeight: 1.45,
        }}
      />
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        {enough ? 'Check your answer against the criteria, then record it.' : 'Write at least a full sentence before revealing the model answer.'}
        {text.trim() && !done ? ' · draft saved' : ''}
      </p>
      <ol className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
        {rubric.map((line, i) => (
          <li key={line} style={{ marginBottom: 4 }}>
            <label className="row" style={{ gap: 6, alignItems: 'flex-start', cursor: enough ? 'pointer' : 'default' }}>
              <input type="checkbox" checked={ticks[i] ?? false} disabled={!enough} onChange={(e) => toggle(i, e.target.checked)} />
              <span className="muted">{line}</span>
            </label>
          </li>
        ))}
      </ol>
      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn small ghost" disabled={!enough} onClick={() => setRevealed((v) => !v)}>
          {revealed ? 'Hide model answer' : 'Show model answer'}
        </button>
        <button type="button" className="btn small primary" disabled={!enough || !allTicked || done} onClick={onPass}>
          <Check size={12} /> {done ? 'Recorded' : 'Mark section done'}
        </button>
      </div>
      {revealed && (
        <p className="small" style={{ margin: '8px 0 0' }}>
          <b>Model answer: </b><span className="muted" style={{ whiteSpace: 'pre-wrap' }}>{entry.answer}</span>
        </p>
      )}
    </div>
  );
}

/** A multiple-choice checkpoint: three real executed outputs, one of which the code prints. */
function QuizCard({ entry, done, onPass }: { entry: NEntry; done: boolean; onPass: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const answer = entry.answer ?? '';
  const right = picked === answer;
  return (
    <div className="card" style={{ margin: 0, padding: '12px 14px' }}>
      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className={`chip ${DIFF_TONE[entry.difficulty]}`}>{entry.difficulty}</span>
        <span className="row" style={{ gap: 6 }}>
          {done && <span className="chip easy"><Check size={11} /> done</span>}
          <span className="chip">quiz · 3 options</span>
        </span>
      </div>
      <strong className="small" style={{ display: 'block', margin: '8px 0 4px' }}>{entry.q}</strong>
      {entry.code && <pre className="codeblock" style={{ margin: '6px 0' }}>{entry.code}</pre>}
      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {entry.options?.map((option) => {
          const tone = picked === null ? '' : option === answer ? ' easy' : option === picked ? ' hard' : '';
          return (
            <button
              key={option}
              type="button"
              className={`chip${tone}`}
              style={{ cursor: 'pointer', whiteSpace: 'pre-wrap', textAlign: 'left', fontFamily: 'ui-monospace, monospace' }}
              onClick={() => { setPicked(option); if (option === answer) onPass(); }}
              aria-pressed={picked === option}
            >{option}</button>
          );
        })}
      </div>
      {picked !== null && (
        <p className="small" style={{ margin: '8px 0 0', color: right ? 'var(--green, #177245)' : 'var(--red, #b42318)' }}>
          {right ? 'Correct — this section is recorded.' : 'Not this one — try another option.'}
        </p>
      )}
      {picked !== null && !right && (
        <button type="button" className="btn small ghost" style={{ marginTop: 6 }} onClick={() => setRevealed((v) => !v)}>
          {revealed ? 'Hide answer' : 'Show answer'}
        </button>
      )}
      {revealed && <pre className="codeblock" style={{ margin: '6px 0 0' }}>{answer}</pre>}
    </div>
  );
}

/**
 * The right-hand Code Bro panel: one cell at a time, with the notebook actions the learner expects.
 *
 * Run executes the cell in a fresh kernel for the entry, "Try this code" reloads the published sample
 * and runs it, and a learning sample is compared with its verified output while an independent task is
 * graded by its hidden check. Program input is passed as stdin, the same contract Code Bro uses.
 */
function CodePanel({
  entry, cells, index, onMove, scope, done, onDone,
}: {
  entry: NEntry | undefined; cells: NEntry[]; index: number;
  onMove: (i: number) => void; scope: string; done: boolean; onDone: () => void;
}) {
  const source = entry ? (entry.code ?? entry.starter ?? extraOf(entry).solution ?? '') : '';
  const expected = entry ? (entry.kind === 'task' ? (entry.expected ?? '') : (entry.output ?? entry.expected ?? '')) : '';
  const [code, setCode] = useState(source);
  const [stdin, setStdin] = useState('');
  const [out, setOut] = useState<{ run: RunResult; graded: 'pass' | 'fail' | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showExpected, setShowExpected] = useState(false);

  useEffect(() => {
    setCode(entry ? (entry.code ?? entry.starter ?? extraOf(entry).solution ?? '') : '');
    setOut(null);
    setShowExpected(false);
  }, [entry?.id, entry?.code, entry?.starter]);

  async function run(text: string) {
    if (!entry || !text.trim()) return;
    setBusy(true);
    setOut(null);
    try {
      const { runPython, resetKernel } = await import('../coding/runners');
      resetKernel(scope);
      const r = await runPython(text, stdin, scope);
      let graded: 'pass' | 'fail' | null = null;
      if (r.ok && entry.kind === 'task' && entry.check) {
        const check = await runPython(entry.check, '', scope);
        graded = check.ok ? 'pass' : 'fail';
        if (!check.ok) r.error = check.error ?? 'the hidden check did not pass';
      } else if (r.ok && expected) {
        graded = outputMatches(expected, r.output) ? 'pass' : 'fail';
      }
      setOut({ run: r, graded });
      if (graded === 'pass') onDone();
    } catch (error) {
      setOut({ run: { ok: false, output: '', error: String((error as Error)?.message ?? error), ms: 0 }, graded: null });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ margin: 0, padding: 12 }}>
      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <b className="small"><Terminal size={13} /> CODE BRO <span className="muted" style={{ fontWeight: 400 }}>· cells run in the same session</span></b>
        <span className="small muted">{index + 1}/{cells.length} cells</span>
      </div>
      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn small primary" disabled={busy || !entry} onClick={() => void run(code)}>
          <Play size={12} /> {busy ? 'Running…' : 'Run all'}
        </button>
        <button type="button" className="btn small ghost" disabled={!entry} onClick={() => { setCode(source); setOut(null); }}>
          <RotateCcw size={12} /> Reset cell
        </button>
        <button
          type="button"
          className="btn small ghost"
          onClick={async () => { try { await navigator.clipboard.writeText(code); } catch { /* clipboard blocked */ } }}
        >
          <Copy size={12} /> Copy
        </button>
        {entry?.code && (
          <button type="button" className="btn small ghost" disabled={busy} onClick={() => { setCode(entry.code!); void run(entry.code!); }}>
            <Play size={12} /> Try this code
          </button>
        )}
        {expected && (
          <button type="button" className="btn small ghost" onClick={() => setShowExpected((v) => !v)}>
            {showExpected ? <EyeOff size={12} /> : <Eye size={12} />} Expected
          </button>
        )}
      </div>

      {entry ? (
        <>
          <div className="row spread small" style={{ margin: '10px 0 4px', gap: 6, flexWrap: 'wrap' }}>
            <span><span style={{ opacity: 0.6 }}>{String(index + 1).padStart(2, '0')}</span> {entry.title ?? entry.q}</span>
            <span className="chip">{entry.kind === 'task' ? 'task' : 'sample'}</span>
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void run(code); } }}
            spellCheck={false}
            aria-label={`Code cell for ${entry.title ?? entry.id}`}
            style={{
              width: '100%', minHeight: 230, padding: 12, borderRadius: 10, resize: 'vertical',
              border: '1px solid var(--line, #d6dbe4)', background: 'var(--bg2, #fff)', color: 'inherit',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.5,
            }}
          />
          <p className="small muted" style={{ margin: '6px 0 0' }}>Ctrl/Cmd + Enter runs this cell · Python loads once, then runs locally.</p>
          <details style={{ marginTop: 8 }}>
            <summary className="small muted" style={{ cursor: 'pointer' }}>Program input — one value per line, for input()</summary>
            <textarea
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              rows={3}
              aria-label="Program input"
              style={{ width: '100%', marginTop: 6, padding: 8, borderRadius: 8, fontFamily: 'ui-monospace, monospace', fontSize: 12, border: '1px solid var(--line, #d6dbe4)', background: 'var(--bg2, #fff)', color: 'inherit' }}
            />
          </details>
          <div className="row spread" style={{ gap: 8, marginTop: 8 }}>
            <button type="button" className="btn small ghost" disabled={index === 0} onClick={() => onMove(index - 1)}>
              <ChevronLeft size={12} /> Previous cell
            </button>
            <button type="button" className="btn small ghost" disabled={index >= cells.length - 1} onClick={() => onMove(index + 1)}>
              Next cell <ChevronRight size={12} />
            </button>
          </div>
        </>
      ) : (
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          This record is answered in the panel on the left — there is no code cell for it.
        </p>
      )}

      {showExpected && expected && (
        <div style={{ marginTop: 8 }}>
          <span className="small muted">Verified output</span>
          <pre className="codeblock" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{expected}</pre>
        </div>
      )}

      {out && (
        <div
          className="card"
          style={{ margin: '10px 0 0', padding: 10, borderColor: out.graded === 'pass' ? 'var(--green, #177245)' : out.graded === 'fail' || !out.run.ok ? 'var(--red, #b42318)' : undefined }}
        >
          <div className="row spread" style={{ gap: 8 }}>
            <b className="small" style={{ color: out.graded === 'pass' ? 'var(--green, #177245)' : out.graded === 'fail' || !out.run.ok ? 'var(--red, #b42318)' : undefined }}>
              {out.run.ok
                ? out.graded === 'pass' ? 'Passed — recorded' : out.graded === 'fail' ? 'Not graded — output differs' : 'Ran successfully'
                : 'Raised an error'}
            </b>
            <span className="small muted">{out.run.ms} ms</span>
          </div>
          {out.run.output.trim() && <pre className="codeblock" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{out.run.output}</pre>}
          {out.run.error && <pre className="codeblock" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', color: 'var(--red)' }}>{out.run.error}</pre>}
          {out.graded === 'fail' && expected && (
            <>
              <span className="small muted">Expected</span>
              <pre className="codeblock" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{expected}</pre>
            </>
          )}
        </div>
      )}
      {!out && <p className="small muted" style={{ margin: '8px 0 0' }}>Not run yet — press Run or Ctrl/Cmd + Enter.</p>}
    </div>
  );
}

/** Fields some authored records carry instead of `statement`/`code`/`output`. */
type AnyEntry = NEntry & { body?: string; task?: string; solution?: string };
const extraOf = (entry: NEntry) => entry as AnyEntry;

/**
 * A non-interactive record: the brief, its code, and whatever must stay behind a reveal.
 *
 * Practice ships `task`/`solution`/`expected`, projects ship `body`/`steps`, logic ships `answer`,
 * and debug ships `error`/`fix` — this card reads all of them, so no section renders an empty panel.
 */
function TopicCard({ entry }: { entry: NEntry }) {
  const e = extraOf(entry);
  const [reveal, setReveal] = useState<'answer' | 'fix' | 'solution' | null>(null);
  const brief = entry.statement ?? e.body ?? e.task ?? '';
  const solution = e.solution ?? '';
  return (
    <div className="card" style={{ margin: 0, padding: '12px 14px' }}>
      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className={`chip ${DIFF_TONE[entry.difficulty]}`}>{entry.difficulty}</span>
        <span className="chip">
          {entry.kind === 'task' ? 'independent task · hidden check' : entry.error ? 'broken code' : 'verified sample'}
        </span>
      </div>
      <strong className="small" style={{ display: 'block', margin: '8px 0 4px', fontSize: '0.95rem' }}>{entry.title ?? entry.q}</strong>
      {brief && <p className="small" style={{ margin: '0 0 8px' }}>{brief}</p>}
      {entry.steps?.length ? (
        <ol className="small muted" style={{ margin: '0 0 8px', paddingLeft: 18 }}>
          {entry.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      ) : null}
      {entry.code && <pre className="codeblock" style={{ margin: 0 }}>{entry.code}</pre>}
      {entry.error && (
        <p className="small" style={{ margin: '8px 0 0', color: 'var(--red)', fontFamily: 'ui-monospace, monospace' }}>
          <b>Raises:</b> {entry.error}
        </p>
      )}
      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {entry.answer && (
          <button type="button" className="btn small ghost" onClick={() => setReveal(reveal === 'answer' ? null : 'answer')}>
            {reveal === 'answer' ? 'Hide answer' : 'Reveal answer'}
          </button>
        )}
        {entry.fix && (
          <button type="button" className="btn small ghost" onClick={() => setReveal(reveal === 'fix' ? null : 'fix')}>
            {reveal === 'fix' ? 'Hide the fix' : 'Show the fix'}
          </button>
        )}
        {solution && (
          <button type="button" className="btn small ghost" onClick={() => setReveal(reveal === 'solution' ? null : 'solution')}>
            {reveal === 'solution' ? 'Hide the solution' : 'Show the solution'}
          </button>
        )}
      </div>
      {reveal === 'answer' && entry.answer && (
        <pre className="codeblock" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{entry.answer}</pre>
      )}
      {reveal === 'fix' && entry.fix && (
        <pre className="codeblock" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{entry.fix}</pre>
      )}
      {reveal === 'solution' && solution && (
        <>
          <pre className="codeblock" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{solution}</pre>
          {entry.expected && (
            <pre className="codeblock" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{entry.expected}</pre>
          )}
        </>
      )}
      <p className="small muted" style={{ margin: '8px 0 0' }}>
        Run the cell on the right. Predict the result first, then compare it with the verified output.
      </p>
    </div>
  );
}

/**
 * One module: a header with a completion ring and ten section cards, then a 50/50 workspace.
 *
 * The left half is the topic itself (what it teaches, its code and the project questions), the right
 * half is the Code Bro cell that runs it. Both halves are 50% of the row, and on a phone they stack
 * instead of overflowing.
 */
export function NModuleWorkspace({ module, onBack }: { module: NModule; onBack: () => void }) {
  const state = useStore();
  const [section, setSection] = useState<NSectionKey>('learn');
  const entries = module.sections[section] ?? [];
  const [index, setIndex] = useState(0);
  const safe = Math.min(index, Math.max(0, entries.length - 1));
  const entry = entries[safe];
  const done = Boolean(state.attempts[nSectionKey(module.id, section)]);
  const onDone = () => recordAttempt(nSectionKey(module.id, section), { done: true, tries: 1 });
  const progress = useMemo(() => nProgress([module], state.attempts), [module, state.attempts]);
  const cells = useMemo(() => entries.filter((e) => e.code || e.starter || extraOf(e).solution), [entries]);
  const cellIndex = Math.max(0, cells.findIndex((c) => c.id === entry?.id));

  useEffect(() => { setIndex(0); }, [module.id, section]);

  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn small ghost" onClick={onBack}><ArrowLeft size={13} /> All modules</button>
        <Link className="btn small ghost" to="/notebooks"><BookOpen size={13} /> Code Bro</Link>
      </div>

      <div className="card" style={{ marginBottom: 10 }}>
        <div className="row spread" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 12, minWidth: 0 }}>
            <span className="cc-logo"><NLogo size={48} /></span>
            <div style={{ minWidth: 0 }}>
              <span className="chip">MODULE {String(module.no).padStart(2, '0')}</span>
              <h1 style={{ margin: '6px 0 0' }}>{module.title}</h1>
              <p className="muted small" style={{ margin: '4px 0 0', maxWidth: 620 }}>{module.goal}</p>
              <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <span className="chip">{module.level}</span>
                <span className="chip">{module.hours}h</span>
                <span className="chip">{module.entries} records</span>
                <span className={`chip${isModuleComplete(module.id, state.attempts) ? ' easy' : ''}`}>
                  {isModuleComplete(module.id, state.attempts) ? 'module complete' : `${N_SECTIONS.filter((s) => state.attempts[nSectionKey(module.id, s.key)]).length}/10 sections`}
                </span>
              </div>
            </div>
          </div>
          <ModuleRing pct={progress.pct} label="Module progress" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 10 }}>
        {N_SECTIONS.map((s) => {
          const on = s.key === section;
          const recorded = Boolean(state.attempts[nSectionKey(module.id, s.key)]);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => { setSection(s.key); setIndex(0); }}
              aria-pressed={on}
              className={`tile tech${recorded ? ' on' : ''}`}
              style={{ cursor: 'pointer', textAlign: 'left', borderColor: on ? 'var(--blue, #2563eb)' : undefined }}
            >
              <span className="t" style={{ flex: 1, minWidth: 0 }}>
                <b>{recorded ? '✓ ' : ''}{s.label}</b>
                <span>{module.sections[s.key]?.length ?? 0} records</span>
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 0', minWidth: 'min(320px, 100%)' }}>
          <div className="row spread" style={{ gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <b className="small">{N_SECTION_LABEL[section]}</b>
            <button type="button" className="btn small primary" onClick={onDone} disabled={done}>
              <Check size={12} /> {done ? 'Section recorded' : 'Mark section done'}
            </button>
          </div>
          {entry && (entry.options?.length
            ? <QuizCard key={entry.id} entry={entry} done={done} onPass={onDone} />
            : entry.rubric?.length
              ? <ShortAnswerCard key={entry.id} entry={entry} done={done} onPass={onDone} />
              : <TopicCard key={entry.id} entry={entry} />)}
        </div>
        <div style={{ flex: '1 1 0', minWidth: 'min(320px, 100%)' }}>
          <CodePanel
            entry={cells.length ? (entry && cells.some((c) => c.id === entry.id) ? entry : cells[0]) : undefined}
            cells={cells}
            index={cellIndex}
            onMove={(i) => {
              const target = cells[i];
              const at = entries.findIndex((e) => e.id === target?.id);
              if (at >= 0) setIndex(at);
            }}
            scope={`numpy:${module.id}:${entry?.id ?? 'cell'}`}
            done={done}
            onDone={onDone}
          />
        </div>
      </div>

      <NTools />
    </div>
  );
}
