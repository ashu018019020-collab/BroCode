import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, BookOpen, Check, ChevronRight, Code2, GraduationCap, Play, ShieldCheck, Target, Trophy,
} from 'lucide-react';
import { useNumpyCourse } from '../../core/data/ncourse';
import { useStore, recordAttempt, useSavedAnswer } from '../../core/storage/store';
import {
  N_SECTIONS, N_SECTION_LABEL, decodeTicks, encodeTicks, isModuleComplete, nProgress, nSectionKey,
  nWrittenAnswerKey, nWrittenTicksKey, nextSection,
  type NEntry, type NModule, type NSectionKey,
} from '../../core/learning/ncourse';
import { NLogo } from './NLogo';
import { NCodeWorkbench, NSlipRail } from './NWorkspace';
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

/**
 * A checkpoint quiz: three real outputs, one of which the shown code prints.
 *
 * The distractors are other executed outputs from the same module, so nothing here is invented prose.
 * Choosing the right option records the section; a wrong choice keeps the question open.
 */
function CheckpointCard({ entry, done, onPass }: { entry: NEntry; done: boolean; onPass: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const answer = entry.answer ?? '';
  const right = picked === answer;

  return (
    <div className="card" style={{ margin: 0, padding: '12px 14px' }}>
      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className={`chip ${DIFF_TONE[entry.difficulty]}`}>{entry.difficulty}</span>
        {done && <span className="chip easy"><Check size={11} /> done</span>}
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
            >
              {option}
            </button>
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
 * A written checkpoint: explain the concept in your own words, then self-assess against three real
 * criteria. The answer stays hidden until something has actually been written, and the section is
 * only recorded once every criterion is ticked — writing nothing and peeking does not count.
 *
 * The draft and its ticks are per-entry store records, not component state, so a refresh or a trip
 * to another module and back keeps what was written. One card per entry means one debounced write.
 */
function WrittenCheckpointCard({ entry, done, onPass }: { entry: NEntry; done: boolean; onPass: () => void }) {
  const rubric = entry.rubric ?? [];
  const [text, setText] = useSavedAnswer(nWrittenAnswerKey(entry.id));
  const [rawTicks, setRawTicks] = useSavedAnswer(nWrittenTicksKey(entry.id));
  const ticks = useMemo(() => decodeTicks(rawTicks, rubric.length), [rawTicks, rubric.length]);
  const [revealed, setRevealed] = useState(false);
  const enough = text.trim().length >= 20;
  const allTicked = rubric.length > 0 && ticks.every(Boolean);
  const toggle = (i: number, on: boolean) =>
    setRawTicks(encodeTicks(ticks.map((value, j) => (j === i ? on : value))));

  return (
    <div className="card" style={{ margin: 0, padding: '12px 14px' }}>
      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className={`chip ${DIFF_TONE[entry.difficulty]}`}>{entry.difficulty}</span>
        <span className="row" style={{ gap: 6 }}>
          {done && <span className="chip easy"><Check size={11} /> done</span>}
          <span className="chip">written · self-assessed</span>
        </span>
      </div>
      <strong className="small" style={{ display: 'block', margin: '8px 0 4px' }}>{entry.q}</strong>
      {entry.code && <pre className="codeblock" style={{ margin: '6px 0' }}>{entry.code}</pre>}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Explain what this code does and why, in two sentences or more."
        aria-label={`Your answer for ${entry.id}`}
        style={{
          width: '100%', minHeight: 90, padding: 10, borderRadius: 10, resize: 'vertical',
          border: '1px solid var(--line, #d6dbe4)', background: 'var(--bg2, #fff)', color: 'inherit',
          fontSize: 13, lineHeight: 1.45,
        }}
      />
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        {enough ? 'Now check your answer against the three criteria.' : 'Write at least a sentence before revealing the answer.'}
        {text.trim() && !done ? ' · draft saved' : ''}
      </p>
      <ol className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
        {rubric.map((line, i) => (
          <li key={line} style={{ marginBottom: 4 }}>
            <label className="row" style={{ gap: 6, alignItems: 'flex-start', cursor: enough ? 'pointer' : 'default' }}>
              <input
                type="checkbox"
                checked={ticks[i] ?? false}
                disabled={!enough}
                onChange={(e) => toggle(i, e.target.checked)}
              />
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
          <b>Model answer: </b>
          <span className="muted" style={{ whiteSpace: 'pre-wrap' }}>{entry.answer}</span>
        </p>
      )}
    </div>
  );
}

/** The module workspace: ten section tabs over the entries that section really holds. */
function ModuleView({ module, onBack }: { module: NModule; onBack: () => void }) {
  const state = useStore();
  const [section, setSection] = useState<NSectionKey>('learn');
  const [picked, setPicked] = useState(0);
  const entries = module.sections[section] ?? [];
  const done = Boolean(state.attempts[nSectionKey(module.id, section)]);
  const onDone = () => recordAttempt(nSectionKey(module.id, section), { done: true, tries: 1 });
  const entry = entries[Math.min(picked, Math.max(0, entries.length - 1))];

  // Switching section or module is a new list: open its first slip, never a stale index.
  useEffect(() => { setPicked(0); }, [module.id, section]);

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

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 10 }}>
        <div style={{ flex: '3 1 440px', minWidth: 'min(320px, 100%)' }}>
          {entry && (
            entry.options?.length
              ? <CheckpointCard key={entry.id} entry={entry} done={done} onPass={onDone} />
              : entry.rubric?.length
                ? <WrittenCheckpointCard key={entry.id} entry={entry} done={done} onPass={onDone} />
                : <NCodeWorkbench key={entry.id} entry={entry} scope={`numpy:${module.id}:${entry.id}`} done={done} onDone={onDone} />
          )}
        </div>
        <NSlipRail entries={entries} picked={picked} onPick={setPicked} done={done} />
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
