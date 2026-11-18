import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Bug, CheckCircle2, Code2, Copy, Flag, GraduationCap, HelpCircle, Layers, ListChecks, Lock, Trophy } from 'lucide-react';
import { useSqlMasterclass, type SqlMasterclassFile, type SqlModule, type SqlQuiz } from '../../core/data/sqlmasterclass';
import { masterclassPractice, masterclassQuestionCount, masterclassQuizTally, type MasterclassBank, type MasterclassLevel } from '../../core/learning/masterclass';
import { levelForXp, masterclassCourseReward, masterclassModuleReward, masterclassQuizAttempt, masterclassTopicDone } from '../../core/platform/keys';
import { addXp, recordAttempt, useStore } from '../../core/storage/store';

const BANKS: { key: MasterclassBank; label: string; icon: typeof BookOpen }[] = [
  { key: 'learn', label: 'Learn', icon: BookOpen },
  { key: 'interview', label: 'Interview', icon: HelpCircle },
  { key: 'labs', label: 'Coding Lab', icon: Code2 },
  { key: 'logic', label: 'Logic', icon: Layers },
  { key: 'debug', label: 'Debug', icon: Bug },
  { key: 'revision', label: 'Revision', icon: ListChecks },
];

/** One completion reward per masterclass course, recorded so re-completion cannot pay twice. */
const MASTERCLASS_COMPLETION_XP = 100;
/** Finishing one topic, and finishing every topic in a module. Both pay once, never per re-tick. */
const MASTERCLASS_TOPIC_XP = 10;
const MASTERCLASS_MODULE_XP = 50;
const NEXT_MASTERCLASS: Record<string, { to: string; title: string; why: string }> = {
  'sql-masterclass': {
    to: '/mysql',
    title: 'MySQL Complete Masterclass',
    why: 'Apply the same SQL in MySQL and see where the dialects differ — LIMIT, AUTO_INCREMENT, string and date functions.',
  },
  'mysql-masterclass': {
    to: '/sqlite',
    title: 'Complete SQLite Masterclass',
    why: 'Learn the embedded database used in mobile apps, browsers and local-first tools.',
  },
  'sqlite-masterclass': {
    to: '/practice',
    title: 'SQL Practice & Interview Bank',
    why: 'Keep your query skills sharp with mixed practice and interview-style questions.',
  },
};
const FALLBACK_NEXT = {
  to: '/courses',
  title: 'Browse courses',
  why: 'Continue with the next course in the catalog.',
};

/** The page that can actually run a module's setup — only the SQL course has one today. */
const LAB_ROUTE: Record<string, string> = {
  'sql-masterclass': '/sql',
};

/**
 * A learn-bank question whose answer lives in the attempt record, not in this component.
 *
 * It used to hold the pick in local state, so every answer vanished on refresh and the course counted
 * only the manual topic ticks. The panel passes the stored pick in and writes the verdict on click,
 * which also keeps one store subscription here instead of one per question.
 */
function Quiz({ item, index, picked, onPick }: {
  item: SqlQuiz;
  index: number;
  /** Stored option index, or `null` when the question has not been answered. */
  picked: number | null;
  onPick: (optionIndex: number) => void;
}) {
  return (
    <div className="card" style={{ marginBottom: 8 }} data-quiz={index}>
      <b className="small">{item.q}</b>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {item.options.map((option, optionIndex) => {
          const chosen = picked === optionIndex;
          const right = option === item.answer;
          const tone = picked === null ? '' : right ? 'easy' : chosen ? 'hard' : '';
          return (
            <button
              key={option}
              type="button"
              className={`chip ${tone}`}
              onClick={() => onPick(optionIndex)}
              aria-pressed={chosen}
              style={{ cursor: 'pointer', height: 'auto', whiteSpace: 'normal', textAlign: 'left', padding: '4px 8px' }}
            >
              {option}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <p className="small" style={{ margin: '8px 0 0' }}>
          {item.options[picked] === item.answer ? 'Correct. ' : 'Not yet. '}
          <span className="muted">{item.why}</span>
        </p>
      )}
    </div>
  );
}

function Bank({ module, bank, courseId, attempts, onPick }: {
  module: SqlModule;
  bank: MasterclassBank;
  courseId: string;
  attempts: Record<string, { done?: boolean; answer?: string } | undefined>;
  onPick: (index: number, optionIndex: number, answerIndex: number) => void;
}) {
  const items = module.banks[bank];
  if (bank === 'learn') {
    return (
      <>
        {(items as SqlQuiz[]).map((item, index) => {
          const stored = attempts[masterclassQuizAttempt(courseId, module.id, index)]?.answer;
          const picked = stored === undefined ? null : Number(stored);
          return (
            <Quiz
              key={item.q}
              item={item}
              index={index}
              picked={Number.isInteger(picked) ? picked : null}
              onPick={(optionIndex) => onPick(index, optionIndex, item.options.indexOf(item.answer))}
            />
          );
        })}
      </>
    );
  }
  if (bank === 'labs') {
    return (
      <>
        {(items as SqlModule['banks']['labs']).map((item) => (
          <div key={item.title} className="card" style={{ marginBottom: 8 }}>
            <b className="small">{item.title}</b>
            <p className="small" style={{ margin: '6px 0 0' }}>{item.task}</p>
            <details style={{ marginTop: 8 }}>
              <summary className="small" style={{ cursor: 'pointer' }}>Reference solution and expected output</summary>
              <pre className="codeblock" style={{ margin: '4px 0 0' }}>{item.solution}</pre>
              <p className="small muted" style={{ margin: '6px 0 0' }}><b>Expected:</b> {item.expected}</p>
            </details>
          </div>
        ))}
      </>
    );
  }
  if (bank === 'debug') {
    return (
      <>
        {(items as SqlModule['banks']['debug']).map((item) => (
          <div key={item.title} className="card" style={{ marginBottom: 8 }}>
            <b className="small">{item.title}</b>
            <pre className="codeblock" style={{ margin: '6px 0 0' }}>{item.broken}</pre>
            <p className="small" style={{ margin: '6px 0 0' }}><b>Why it fails · </b><span className="muted">{item.error}</span></p>
            <details style={{ marginTop: 8 }}>
              <summary className="small" style={{ cursor: 'pointer' }}>Fix and expected output</summary>
              <pre className="codeblock" style={{ margin: '4px 0 0' }}>{item.fix}</pre>
              <p className="small muted" style={{ margin: '6px 0 0' }}><b>Expected:</b> {item.expected}</p>
            </details>
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      {(items as SqlModule['banks']['interview']).map((item) => (
        <div key={item.q} className="card" style={{ marginBottom: 8 }}>
          <b className="small">{item.q}</b>
          <details style={{ marginTop: 6 }}>
            <summary className="small" style={{ cursor: 'pointer' }}>Answer</summary>
            <p className="small muted" style={{ margin: '4px 0 0' }}>{item.answer}</p>
          </details>
        </div>
      ))}
    </>
  );
}

export function MasterclassPanel({
  file,
  label = 'SQL MASTERCLASS',
  defaultOpen = false,
  moduleId: selectedModuleId,
  bank: selectedBank,
  level: selectedLevel,
  onModuleChange,
  onBankChange,
  onLevelChange,
}: {
  file: SqlMasterclassFile;
  label?: string;
  defaultOpen?: boolean;
  /** The open module, when the page keeps it in the URL. */
  moduleId?: string;
  /** The open bank, when the page keeps it in the URL. */
  bank?: MasterclassBank;
  /** The explanation level, when the page keeps it in the URL. */
  level?: MasterclassLevel;
  onModuleChange?: (moduleId: string) => void;
  onBankChange?: (bank: MasterclassBank) => void;
  onLevelChange?: (level: MasterclassLevel) => void;
}) {
  const state = useStore();
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [levelState, setLevelState] = useState<MasterclassLevel>('simple');
  const [moduleIdState, setModuleIdState] = useState('sql00');
  const [bankState, setBankState] = useState<MasterclassBank>('learn');
  /** The page may own the selection (a URL); otherwise the panel does. */
  const moduleId = selectedModuleId ?? moduleIdState;
  const bank = selectedBank ?? bankState;
  const level = selectedLevel ?? levelState;
  const pickLevel = (value: MasterclassLevel) => {
    setLevelState(value);
    onLevelChange?.(value);
  };
  const openModule = (id: string) => {
    setModuleIdState(id);
    onModuleChange?.(id);
  };
  const pickBank = (key: MasterclassBank) => {
    setBankState(key);
    onBankChange?.(key);
  };
  const [notice, setNotice] = useState<string | null>(null);
  const modules = file?.modules ?? [];
  const module = useMemo(() => modules.find((m) => m.id === moduleId) ?? modules[0], [modules, moduleId]);
  const completed = useMemo(
    () => new Set(
      modules
        .filter((m) => m.topics.length > 0 && m.topics.every((t) => state.attempts[masterclassTopicDone(file.course.id, m.id, t.id)]?.done))
        .map((m) => m.id),
    ),
    [modules, state.attempts, file.course.id],
  );
  const doneTopics = useMemo(() => {
    if (!module) return new Set<string>();
    return new Set(
      module.topics
        .filter((t) => state.attempts[masterclassTopicDone(file.course.id, module.id, t.id)]?.done)
        .map((t) => t.id),
    );
  }, [module, state.attempts, file.course.id]);
  const moduleQuestions = module?.banks.learn.length ?? 0;
  const moduleTally = masterclassQuizTally(state.attempts, file.course.id, module?.id ?? '', moduleQuestions);
  const practice = useMemo(
    () => masterclassPractice(
      state.attempts,
      file.course.id,
      modules.map((m) => ({ id: m.id, questions: m.banks.learn.length })),
    ),
    [state.attempts, file.course.id, modules],
  );
  const bankItems = masterclassQuestionCount(file.stats);
  const courseDone = modules.length > 0 && completed.size === modules.length;
  const firstUnfinished = modules.find((m) => !completed.has(m.id));
  const remainingModules = Math.max(0, modules.length - completed.size);
  const nextCourse = NEXT_MASTERCLASS[file.course.id] ?? FALLBACK_NEXT;
  const labRoute = LAB_ROUTE[file.course.id];
  /** What the Lab runs first: the course's shared school tables, then this module's own setup. */
  const labSchema = [...(file.course.schema ?? []), ...(module?.setup ?? [])];
  const rewardRef = useRef(false);
  useEffect(() => {
    if (!courseDone || rewardRef.current) return;
    const key = masterclassCourseReward(file.course.id);
    if (state.attempts[key]?.done) { rewardRef.current = true; return; }
    rewardRef.current = true;
    recordAttempt(key, { done: true });
    addXp(MASTERCLASS_COMPLETION_XP, 'course', `${file.course.title} complete`);
  }, [courseDone, state.attempts, file.course.id, file.course.title]);
  const moduleIndex = module ? modules.findIndex((m) => m.id === module.id) : -1;
  const nextModule = moduleIndex >= 0 ? modules[moduleIndex + 1] : undefined;
  const currentDone = module ? completed.has(module.id) : false;
  const unlocked = (index: number) => index === 0 || index === moduleIndex || completed.has(modules[index - 1].id);

  if (!module) {
    return <div className="card"><div className="skeleton" style={{ height: 90 }} /></div>;
  }

  /** The authored DDL these examples assume — shown, copyable, and what the Lab runs first. */
  const schemaText = [
    file.course.schema?.length ? `-- shared school tables, every module\n${file.course.schema.join('\n')}` : '',
    module.setup?.length ? `-- module ${String(module.no).padStart(2, '0')} setup\n${module.setup.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const openNext = () => {
    if (!nextModule) {
      setNotice('Course complete — every published module is finished.');
      return;
    }
    openModule(nextModule.id);
    pickBank('learn');
    pickLevel('simple');
    setNotice(`Module ${String(module.no).padStart(2, '0')} complete (+${MASTERCLASS_MODULE_XP} XP). Module ${String(nextModule.no).padStart(2, '0')} unlocked and opened.`);
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  /** Module XP pays once: the `mmr:` record is the receipt, independent of the derived completion set. */
  const rewardModule = (doneModule: SqlModule) => {
    const key = masterclassModuleReward(file.course.id, doneModule.id);
    if (state.attempts[key]?.done) return;
    recordAttempt(key, { done: true });
    addXp(MASTERCLASS_MODULE_XP, 'course', `${doneModule.title} complete`);
  };

  const toggleTopic = (topicId: string, checked: boolean) => {
    const key = masterclassTopicDone(file.course.id, module.id, topicId);
    // The `mt:` record doubles as the topic's XP receipt: unchecking keeps it (`done: false`)
    // instead of deleting it, so checking the same topic again cannot pay twice.
    if (checked) {
      if (!state.attempts[key]) addXp(MASTERCLASS_TOPIC_XP, 'course', module.title);
      recordAttempt(key, { done: true });
    } else {
      recordAttempt(key, { done: false });
    }

    const nextDone = new Set(doneTopics);
    if (checked) nextDone.add(topicId);
    else nextDone.delete(topicId);
    const nowComplete = nextDone.size === module.topics.length;
    if (!nowComplete) {
      setNotice(null);
      return;
    }
    if (currentDone) return;
    rewardModule(module);
    openNext();
  };

  /** One record per answered question, keyed by course + module + the question's position. */
  const pickQuiz = (moduleId: string, index: number, optionIndex: number, answerIndex: number) => {
    const correct = optionIndex === answerIndex;
    recordAttempt(masterclassQuizAttempt(file.course.id, moduleId, index), {
      answer: String(optionIndex),
      done: correct,
      score: correct ? 100 : 0,
    });
  };

  return (
    <div className="card" ref={panelRef} style={{ marginTop: 10 }}>
      <div className="row spread" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="chip"><GraduationCap size={12} /> {label}</span>
          <b>{file.course.title}</b>
          <span className="chip">{modules.length} modules</span>
          <span className="chip">{file.stats.topics} topics</span>
          <span className="chip">{bankItems} bank items</span>
        </div>
        <button type="button" className="btn small" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide course' : 'Open course'}
        </button>
      </div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        Module {String(module.no).padStart(2, '0')} — {module.title}. Check every topic to complete it{nextModule ? '; the last check unlocks and opens the next module' : ''}. {file.course.tagline}
      </p>

      {open && (
        <>
          {labSchema.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {labRoute && (
                  <Link to={`${labRoute}?module=${module.id}&bank=${bank}&level=${level}`} className="btn small primary">
                    <Code2 size={13} /> Run this module in SQL Lab
                  </Link>
                )}
                <button
                  type="button"
                  className="btn small"
                  onClick={() => void navigator.clipboard?.writeText(schemaText).catch(() => {})}
                >
                  <Copy size={12} /> Copy setup
                </button>
              </div>
              <details style={{ marginTop: 6 }}>
                <summary className="small muted" style={{ cursor: 'pointer' }}>
                  Module schema — {labSchema.length} statement{labSchema.length === 1 ? '' : 's'}
                  {labRoute ? ' the lab loads before every query' : ' these examples assume'}
                </summary>
                <pre className="codeblock" style={{ margin: '6px 0 0' }}>{schemaText}</pre>
              </details>
            </div>
          )}

          <div
            className="kpi-row"
            role="group"
            aria-label="Course progress overview"
            style={{ marginTop: 10, marginBottom: 4 }}
          >
            <div className="kpi tone-green">
              <span className="ic" aria-hidden="true"><CheckCircle2 size={16} /></span>
              <div className="kpi-body">
                <div className="n">{completed.size} / {modules.length}</div>
                <div className="l">Completed modules</div>
                <div className="kpi-sub">
                  {remainingModules === 0
                    ? 'All published modules finished'
                    : `${remainingModules} module${remainingModules === 1 ? '' : 's'} remaining`}
                </div>
              </div>
            </div>
            <div className="kpi tone-amber">
              <span className="ic" aria-hidden="true"><Trophy size={16} /></span>
              <div className="kpi-body">
                <div className="n">{state.xp} XP</div>
                <div className="l">Total XP</div>
                <div className="kpi-sub">Level {levelForXp(state.xp)}</div>
              </div>
            </div>
            <div className="kpi tone-violet">
              <span className="ic" aria-hidden="true"><Flag size={16} /></span>
              <div className="kpi-body">
                <div className="n">
                  {firstUnfinished
                    ? `Module ${String(firstUnfinished.no).padStart(2, '0')}`
                    : 'Course complete'}
                </div>
                <div className="l">Next unfinished module</div>
                <div className="kpi-sub">
                  {firstUnfinished ? firstUnfinished.title : 'All published modules finished'}
                </div>
              </div>
            </div>
            <div className="kpi tone-blue">
              <span className="ic" aria-hidden="true"><ListChecks size={16} /></span>
              <div className="kpi-body">
                <div className="n">{practice.answered} / {practice.total}</div>
                <div className="l">Learn bank answered</div>
                <div className="kpi-sub">
                  {practice.answered === 0
                    ? 'Answers are saved and count here'
                    : `${practice.correct} correct · ${practice.pct ?? 0}% answered`}
                </div>
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {modules.map((m, index) => {
              const isOpen = unlocked(index);
              const isDone = completed.has(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`chip ${m.id === module.id ? 'easy' : ''}`}
                  onClick={() => { if (!isOpen) return; openModule(m.id); pickBank('learn'); setNotice(null); }}
                  disabled={!isOpen}
                  title={isOpen ? m.title : `Finish Module ${String(modules[index - 1].no).padStart(2, '0')} to unlock this module`}
                  style={{ cursor: isOpen ? 'pointer' : 'not-allowed', opacity: isOpen ? 1 : 0.55 }}
                >
                  {isDone ? <CheckCircle2 size={11} /> : !isOpen ? <Lock size={11} /> : null}
                  Module {String(m.no).padStart(2, '0')} · {m.title}
                </button>
              );
            })}
            <span className="chip"><Layers size={11} /> {module.topics.length} topics</span>
            <span className="chip"><CheckCircle2 size={11} /> {doneTopics.size}/{module.topics.length} checked</span>
            <span className="chip"><ListChecks size={11} /> {moduleTally.answered}/{moduleQuestions} answered</span>
            <span className="chip"><ListChecks size={11} /> {module.hours}h</span>
          </div>

          <div className="row spread" style={{ gap: 8, marginTop: 10 }}>
            <span className="small muted"><CheckCircle2 size={12} /> {completed.size} of {modules.length} modules complete</span>
            {courseDone && <span className="chip easy"><CheckCircle2 size={11} /> Course complete</span>}
          </div>
          <div style={{ height: 6, marginTop: 6, borderRadius: 999, background: 'var(--line, #e5e7eb)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${modules.length ? (completed.size / modules.length) * 100 : 0}%`,
                borderRadius: 999,
                background: 'var(--accent, #2563eb)',
                transition: 'width 240ms ease',
              }}
            />
          </div>
          {notice && <p className="small" role="status" style={{ margin: '8px 0 0' }}>{notice}</p>}

          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {(['simple', 'pro'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`chip ${level === value ? 'easy' : ''}`}
                onClick={() => pickLevel(value)}
                style={{ cursor: 'pointer' }}
              >
                {value === 'simple' ? 'Simple Hinglish' : 'Professional English'}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 10 }}>
            {module.topics.map((topic) => {
              const topicDone = doneTopics.has(topic.id);
              return (
                <div key={topic.id} className="card" style={{ marginBottom: 8, borderColor: topicDone ? 'var(--ok, #2e7d32)' : undefined }}>
                  <div className="row spread" style={{ gap: 8, alignItems: 'flex-start' }}>
                    <b className="small">{topic.title}</b>
                    <button
                      type="button"
                      className={`chip ${topicDone ? 'easy' : ''}`}
                      onClick={() => toggleTopic(topic.id, !topicDone)}
                      aria-pressed={topicDone}
                      title={topicDone ? 'Mark this topic as not read' : 'Mark this topic as read'}
                      style={{ cursor: 'pointer', flexShrink: 0 }}
                    >
                      {topicDone ? <CheckCircle2 size={11} /> : null} {topicDone ? 'Done' : 'Mark read'}
                    </button>
                  </div>
                  <p className="small" style={{ margin: '6px 0 0' }}>{level === 'simple' ? topic.simple : topic.pro}</p>
                  <ul className="small muted" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {topic.points.map((point) => <li key={point}>{point}</li>)}
                  </ul>
                  <pre className="codeblock" style={{ margin: '8px 0 0' }}>{topic.example.sql}</pre>
                  {labRoute && (
                    <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                      <Link
                        to={`${labRoute}?module=${module.id}&bank=${bank}&level=${level}&example=${topic.id}`}
                        className="btn small"
                      >
                        <Code2 size={12} /> Run this example in SQL Lab
                      </Link>
                      <span className="small muted">Opens the Lab with this module’s schema and this example loaded.</span>
                    </div>
                  )}
                  <p className="small muted" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}><b>Output</b>{'\n'}{topic.example.output}</p>
                </div>
              );
            })}
          </div>

          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
            {BANKS.map((entry) => {
              const Icon = entry.icon;
              return (
                <button
                  key={entry.key}
                  type="button"
                  className={`chip ${bank === entry.key ? 'easy' : ''}`}
                  onClick={() => pickBank(entry.key)}
                  style={{ cursor: 'pointer' }}
                >
                  <Icon size={11} /> {entry.label} · {module.banks[entry.key].length}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 10 }}>
            <Bank
              module={module}
              bank={bank}
              courseId={file.course.id}
              attempts={state.attempts}
              onPick={(index, optionIndex, answerIndex) => pickQuiz(module.id, index, optionIndex, answerIndex)}
            />
          </div>

          {!courseDone && (
            <div className="card" style={{ marginTop: 10, borderColor: currentDone ? 'var(--ok, #2e7d32)' : undefined }}>
              <div className="row spread" style={{ gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <b className="small">{currentDone ? 'Module complete' : 'Topic checklist'}</b>
                  <p className="small muted" style={{ margin: '4px 0 0' }}>
                    {currentDone
                      ? nextModule
                        ? `All ${module.topics.length} topics checked. Module ${String(nextModule.no).padStart(2, '0')} is unlocked.`
                        : `All ${module.topics.length} topics checked. You have finished every published module.`
                      : `${doneTopics.size} of ${module.topics.length} topics checked. ${nextModule ? 'Check every topic to complete this module and unlock the next one.' : 'Check every topic to complete the course.'}`}
                  </p>
                  <div style={{ height: 6, marginTop: 8, borderRadius: 999, background: 'var(--line, #e5e7eb)', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${module.topics.length ? (doneTopics.size / module.topics.length) * 100 : 0}%`,
                        borderRadius: 999,
                        background: 'var(--accent, #2563eb)',
                        transition: 'width 240ms ease',
                      }}
                    />
                  </div>
                </div>
                {currentDone && nextModule && (
                  <button type="button" className="btn small primary" onClick={openNext}>
                    Open Module {String(nextModule.no).padStart(2, '0')} <ArrowRight size={13} />
                  </button>
                )}
              </div>
            </div>
          )}

          {courseDone && (
            <div className="card" style={{ marginTop: 10, borderColor: 'var(--ok, #2e7d32)' }}>
              <div className="row spread" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 230 }}>
                  <span className="chip easy"><CheckCircle2 size={11} /> Course complete</span>
                  <b className="small" style={{ display: 'block', marginTop: 8 }}>
                    {file.course.title} — every published module finished
                  </b>
                  <p className="small muted" style={{ margin: '4px 0 0' }}>
                    {modules.length} modules · {file.stats.topics} topics read · {practice.answered} of {bankItems} questions answered.
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <b>+{MASTERCLASS_COMPLETION_XP} XP</b>
                  <p className="small muted" style={{ margin: '2px 0 0' }}>Level {levelForXp(state.xp)} · {state.xp} XP total</p>
                </div>
              </div>
              <div style={{ borderTop: '1px solid var(--line, #e5e7eb)', marginTop: 10, paddingTop: 10 }}>
                <b className="small">Next course</b>
                <p className="small muted" style={{ margin: '4px 0 8px' }}>{nextCourse.why}</p>
                <Link to={nextCourse.to} className="btn small primary">
                  {nextCourse.title} <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          )}

          <details className="card" style={{ marginTop: 10 }}>
            <summary className="small" style={{ cursor: 'pointer' }}><b>Module outcomes and dialect note</b></summary>
            <ul className="small muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {file.course.outcomes.map((outcome) => <li key={outcome}>{outcome}</li>)}
            </ul>
            <p className="small muted" style={{ margin: '8px 0 0' }}>{file.course.standard}</p>
          </details>
        </>
      )}
    </div>
  );
}

/** SQL Lab wrapper: the panel plus the SQL Masterclass artifact. */
export function SqlMasterclass(props: {
  moduleId?: string;
  bank?: MasterclassBank;
  level?: MasterclassLevel;
  onModuleChange?: (moduleId: string) => void;
  onBankChange?: (bank: MasterclassBank) => void;
  onLevelChange?: (level: MasterclassLevel) => void;
}) {
  const file = useSqlMasterclass();
  if (!file) return <div className="card"><div className="skeleton" style={{ height: 90 }} /></div>;
  return <MasterclassPanel file={file} {...props} />;
}
