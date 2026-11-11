import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, BookOpen, Check, ChevronRight, Code2, GraduationCap, Play, ShieldCheck, Target, Trophy,
} from 'lucide-react';
import { useNumpyCourse } from '../../core/data/ncourse';
import { useStore, recordAttempt } from '../../core/storage/store';
import {
  N_SECTIONS, N_SECTION_LABEL, isModuleComplete, nProgress, nSectionKey, nextSection, outputMatches,
  type NEntry, type NModule, type NSectionKey,
} from '../../core/learning/ncourse';
import { NLogo } from './NLogo';
import { Bar } from '../../components/ui/ui';

/**
 * The NumPy Mastery course.
 *
 * One course, twenty modules, ten learning sections inside EVERY module. The course page is an
 * index and the module view is the workspace; both read ONE generated artifact
 * (`public/generated/numpy-course/index.json`) and ONE pure rules module
 * (`core/learning/ncourse.ts`), so no count here can disagree with the content that shipped.
 *
 * Progress is stored per module AND section (`nmod:<module>:<section>`). A module counts as complete
 * only when all ten sections have a record — a checkpoint score alone never marks it done.
 */

const DIFF_TONE: Record<NEntry['difficulty'], string> = { easy: 'easy', medium: 'medium', hard: 'hard' };

/** One learning entry: the question/concept, its code, and a reveal for the answer or fix. */
function EntryCard({ entry, done, onDone }: { entry: NEntry; done: boolean; onDone: () => void }) {
  const [shown, setShown] = useState(false);
  const answer = entry.answer ?? entry.solution ?? entry.fix ?? entry.expected ?? '';
  const prompt = entry.q ?? entry.title ?? '';
  return (
    <div className="card" style={{ margin: 0, padding: '12px 14px' }}>
      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className={`chip ${DIFF_TONE[entry.difficulty]}`}>{entry.difficulty}</span>
        <span className="row" style={{ gap: 6 }}>
          {done && <span className="chip easy"><Check size={11} /> done</span>}
          <button type="button" className="btn small ghost" onClick={onDone} disabled={done}>
            {done ? 'Recorded' : 'Mark done'}
          </button>
        </span>
      </div>
      {prompt && <strong className="small" style={{ display: 'block', margin: '8px 0 4px' }}>{prompt}</strong>}
      {(entry.body || entry.task) && <p className="small muted" style={{ margin: '0 0 8px' }}>{entry.task ?? entry.body}</p>}
      {entry.code && (
        <>
          <pre className="codeblock" style={{ margin: '6px 0' }}>{entry.code}</pre>
          <Link className="btn small ghost" to="/playground"><Code2 size={12} /> Run in Code Bro</Link>
        </>
      )}
      {entry.error && <p className="small" style={{ margin: '8px 0 0', color: 'var(--red)' }}>{entry.error}</p>}
      {entry.steps?.length ? (
        <ol className="small muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {entry.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      ) : null}
      {answer && (
        <div style={{ marginTop: 8 }}>
          <button type="button" className="btn small" onClick={() => setShown((v) => !v)}>
            {shown ? 'Hide answer' : 'Show answer'}
          </button>
          {shown && (
            <p className="small" style={{ margin: '8px 0 0' }}>
              <b>{entry.error ? 'Fix: ' : 'Answer: '}</b>
              <span className="muted" style={{ whiteSpace: 'pre-wrap' }}>{answer}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Coding Lab: the learner writes the code, not reads it.
 *
 * The starter runs in the app's bundled Python runtime (the same Pyodide worker Code Bro uses, so
 * numpy is real and offline), and the printed output is compared with the module's executed output.
 * A run that raises is never a pass, even if it printed the right thing before failing. Passing
 * records the section, the same record every other section writes.
 */
function CodingEntryCard({ entry, done, onPass }: { entry: NEntry; done: boolean; onPass: () => void }) {
  const [code, setCode] = useState(entry.starter ?? 'import numpy as np\n\n# your code here\n');
  const [result, setResult] = useState<{ pass: boolean; output: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const expected = entry.expected ?? '';
  /** One kernel per task, cleared before every run, so a leftover name can never make code pass. */
  const scope = `numpy:${entry.id}`;

  async function grade() {
    setBusy(true);
    setResult(null);
    try {
      const { runPython, resetKernel } = await import('../coding/runners');
      resetKernel(scope);
      const run = await runPython(code, '', scope);
      const pass = run.ok && outputMatches(expected, run.output);
      setResult({ pass, output: run.output, error: run.error });
      if (pass) onPass();
    } catch (error) {
      setResult({ pass: false, output: '', error: String((error as Error)?.message ?? error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ margin: 0, padding: '12px 14px' }}>
      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className={`chip ${DIFF_TONE[entry.difficulty]}`}>{entry.difficulty}</span>
        <span className="row" style={{ gap: 6 }}>
          {done && <span className="chip easy"><Check size={11} /> done</span>}
          <button type="button" className="btn small ghost" onClick={onPass} disabled={done}>
            {done ? 'Recorded' : 'Mark done'}
          </button>
        </span>
      </div>
      <strong className="small" style={{ display: 'block', margin: '8px 0 4px' }}>{entry.title ?? entry.q ?? ''}</strong>
      {entry.body && <p className="small muted" style={{ margin: '0 0 8px' }}>{entry.body}</p>}
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        aria-label={`Code for ${entry.title ?? entry.id}`}
        style={{
          width: '100%', minHeight: 140, padding: 10, borderRadius: 10, resize: 'vertical',
          border: '1px solid var(--line, #d6dbe4)', background: 'var(--bg2, #fff)', color: 'inherit',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.45,
        }}
      />
      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn small primary" onClick={grade} disabled={busy}>
          <Play size={12} /> {busy ? 'Running…' : 'Run & grade'}
        </button>
        <button type="button" className="btn small ghost" onClick={() => { setCode(entry.starter ?? ''); setResult(null); }} disabled={busy}>
          Reset code
        </button>
        {entry.solution && (
          <button type="button" className="btn small ghost" onClick={() => setShowSolution((v) => !v)}>
            {showSolution ? 'Hide solution' : 'Show solution'}
          </button>
        )}
      </div>
      {busy && <p className="small muted" style={{ margin: '8px 0 0' }}>Python loads once (~10s) and then runs locally — your code never leaves this browser.</p>}
      {result && (
        <div
          className="card"
          style={{
            margin: '8px 0 0', padding: 10,
            borderColor: result.pass ? 'var(--green, #177245)' : 'var(--red, #b42318)',
          }}
        >
          <b className="small" style={{ color: result.pass ? 'var(--green, #177245)' : 'var(--red, #b42318)' }}>
            {result.pass ? 'Passed — the output matches' : 'Not graded — the output differs'}
          </b>
          {result.error && <pre className="codeblock" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{result.error}</pre>}
          {!result.pass && (
            <div className="grid2" style={{ gap: 8, marginTop: 8 }}>
              <div>
                <span className="small muted">Expected</span>
                <pre className="codeblock" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{expected || '(nothing)'}</pre>
              </div>
              <div>
                <span className="small muted">Your output</span>
                <pre className="codeblock" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{result.output.trim() || '(nothing printed)'}</pre>
              </div>
            </div>
          )}
          {result.pass && <p className="small muted" style={{ margin: '6px 0 0' }}>No differences to show — this section is recorded.</p>}
        </div>
      )}
      {showSolution && entry.solution && (
        <div style={{ marginTop: 8 }}>
          <span className="small muted">Reference solution</span>
          <pre className="codeblock" style={{ margin: '4px 0 0' }}>{entry.solution}</pre>
        </div>
      )}
    </div>
  );
}

/** The module workspace: ten section tabs over the entries that section really holds. */
function ModuleView({ module, onBack }: { module: NModule; onBack: () => void }) {
  const state = useStore();
  const [section, setSection] = useState<NSectionKey>('learn');
  const entries = module.sections[section] ?? [];

  return (
    <div>
      <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <span className="cc-logo"><NLogo size={44} /></span>
          <div style={{ minWidth: 0 }}>
            <b style={{ fontSize: '1.05rem' }}>{String(module.no).padStart(2, '0')} · {module.title}</b>
            <span className="small muted" style={{ display: 'block' }}>{module.level} · {module.hours}h · {module.entries} entries</span>
          </div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn small ghost" onClick={onBack}><ArrowLeft size={13} /> All modules</button>
          <Link className="btn small" to="/notebooks"><BookOpen size={13} /> Code Bro</Link>
        </div>
      </div>
      <p className="small muted" style={{ margin: '8px 0 10px' }}>{module.goal}</p>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {N_SECTIONS.map((s) => {
          const on = s.key === section;
          const done = Boolean(state.attempts[nSectionKey(module.id, s.key)]);
          return (
            <button
              key={s.key}
              type="button"
              className={`chip${on ? ' on' : ''}`}
              style={{ cursor: 'pointer' }}
              aria-pressed={on}
              onClick={() => setSection(s.key)}
              title={s.blurb}
            >
              {done ? '✓ ' : ''}{s.label} {module.sections[s.key]?.length ?? 0}
            </button>
          );
        })}
      </div>

      <div className="row spread" style={{ margin: '10px 0 6px', gap: 8, flexWrap: 'wrap' }}>
        <b className="small">{N_SECTION_LABEL[section]}</b>
        <button
          type="button"
          className="btn small primary"
          onClick={() => recordAttempt(nSectionKey(module.id, section), { done: true, tries: 1 })}
          disabled={Boolean(state.attempts[nSectionKey(module.id, section)])}
        >
          <Check size={12} /> {state.attempts[nSectionKey(module.id, section)] ? 'Section recorded' : 'Mark section done'}
        </button>
      </div>

      {section === 'coding' && (
        <p className="small muted" style={{ margin: '0 2px 8px' }}>
          Each task is graded: your code runs in the bundled Python runtime and its printed output is
          compared with the module's verified output. A run that raises is not a pass.
        </p>
      )}

      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
        {entries.map((entry) => {
          const done = Boolean(state.attempts[nSectionKey(module.id, section)]);
          const onDone = () => recordAttempt(nSectionKey(module.id, section), { done: true, tries: 1 });
          return section === 'coding'
            ? <CodingEntryCard key={entry.id} entry={entry} done={done} onPass={onDone} />
            : <EntryCard key={entry.id} entry={entry} done={done} onDone={onDone} />;
        })}
      </div>
    </div>
  );
}

export default function NCoursePage() {
  const file = useNumpyCourse();
  const state = useStore();
  const [params, setParams] = useSearchParams();
  const modules = file?.modules ?? [];
  const open = modules.find((m) => m.id === params.get('module')) ?? null;
  const progress = useMemo(() => nProgress(modules, state.attempts), [modules, state.attempts]);
  const next = useMemo(() => {
    const fresh = modules.find((m) => !isModuleComplete(m.id, state.attempts));
    return fresh ? { module: fresh, section: nextSection(fresh.id, state.attempts) } : null;
  }, [modules, state.attempts]);

  if (!file) {
    return (
      <div className="card">
        <div className="skeleton" style={{ height: 90 }} />
        <div className="skeleton" style={{ height: 320, marginTop: 12 }} />
      </div>
    );
  }

  const { course, stats } = file;

  if (open) {
    return (
      <div>
        <ModuleView
          module={open}
          onBack={() => {
            const p = new URLSearchParams(params);
            p.delete('module');
            setParams(p);
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="card glow fadeup">
        <div className="row spread" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 12, minWidth: 260 }}>
            <span className="cc-logo"><NLogo size={64} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="chip" style={{ marginBottom: 6 }}><GraduationCap size={12} /> NUMPY MASTERY</div>
              <h1 style={{ margin: 0 }}>{course.title}</h1>
              <p className="muted small" style={{ margin: '6px 0 0', maxWidth: 620 }}>{course.tagline}</p>
            </div>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="chip"><BookOpen size={12} /> {stats.modules} modules</span>
            <span className="chip"><Target size={12} /> {stats.entries} entries</span>
            <span className="chip"><Trophy size={12} /> {progress.pct}% complete</span>
            <span className="chip">{course.level}</span>
          </div>
        </div>
        <p className="muted small" style={{ margin: '10px 0 0', maxWidth: 820 }}>{course.description}</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <span className="chip"><ShieldCheck size={12} /> {course.standard}</span>
          {course.prerequisites.map((p) => <span key={p} className="chip">{p}</span>)}
        </div>
        {next && (
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Link className="btn primary" to={`/numpy?module=${next.module.id}`}>
              <Play size={14} /> {progress.sectionsDone ? 'Continue' : 'Start'} learning
            </Link>
            <span className="small muted" style={{ alignSelf: 'center' }}>
              Next: {next.module.title} · {N_SECTION_LABEL[next.section]}
            </span>
          </div>
        )}
        {progress.sectionsDone > 0 && (
          <div style={{ marginTop: 10, maxWidth: 460 }}>
            <div className="row spread small"><span className="muted">{progress.modulesDone}/{progress.modulesTotal} modules complete</span><span>{progress.pct}%</span></div>
            <Bar pct={progress.pct} />
          </div>
        )}
      </div>

      <div className="sec-head"><h2><BookOpen size={16} color="var(--blue)" /> Learning outcomes</h2><span className="line" /></div>
      <div className="card">
        <ol className="small muted" style={{ margin: 0, paddingLeft: 18, columns: 2, columnGap: 24 }}>
          {course.outcomes.map((o) => <li key={o} style={{ marginBottom: 6 }}>{o}</li>)}
        </ol>
      </div>

      <div className="sec-head"><h2>20 modules · 10 sections each</h2><span className="line" /></div>
      <div className="tile-grid tile-grid-lg">
        {modules.map((m) => {
          const done = isModuleComplete(m.id, state.attempts);
          const sectionsDone = N_SECTIONS.filter((s) => state.attempts[nSectionKey(m.id, s.key)]).length;
          return (
            <Link
              key={m.id}
              to={`/numpy?module=${m.id}`}
              className={`tile tech${done ? ' on' : ''}`}
              data-agent-action={`numpy:module:${m.id}`}
            >
              <span className="ic"><NLogo size={30} /></span>
              <span className="t" style={{ flex: 1, minWidth: 0 }}>
                <b>{String(m.no).padStart(2, '0')} · {m.title}</b>
                <span>{m.entries} entries · {m.level} · {m.hours}h{sectionsDone ? ` · ${sectionsDone}/10 sections` : ''}</span>
              </span>
              <ChevronRight size={14} className="muted" />
            </Link>
          );
        })}
      </div>

      <p className="small muted" style={{ marginTop: 10 }}>
        Every module holds all ten sections — Learn, Interview, Coding Lab, Logic, Debug, Practice
        Solutions, Mini Project, Project Lab, Defense and Checkpoint. Counts are the records that
        shipped in the content pack, not a target: the pack's own progress ledger tracks the road to
        50 entries per section.
      </p>
    </div>
  );
}
