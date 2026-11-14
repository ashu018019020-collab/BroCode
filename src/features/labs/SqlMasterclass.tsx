import { useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Bug, CheckCircle2, Code2, GraduationCap, HelpCircle, Layers, ListChecks, Lock } from 'lucide-react';
import { useSqlMasterclass, type SqlMasterclassFile, type SqlModule, type SqlQuiz } from '../../core/data/sqlmasterclass';
import { masterclassTopicDone } from '../../core/platform/keys';
import { forgetAttempt, recordAttempt, useStore } from '../../core/storage/store';

type BankKey = 'learn' | 'interview' | 'labs' | 'logic' | 'debug' | 'revision';
const BANKS: { key: BankKey; label: string; icon: typeof BookOpen }[] = [
  { key: 'learn', label: 'Learn', icon: BookOpen },
  { key: 'interview', label: 'Interview', icon: HelpCircle },
  { key: 'labs', label: 'Coding Lab', icon: Code2 },
  { key: 'logic', label: 'Logic', icon: Layers },
  { key: 'debug', label: 'Debug', icon: Bug },
  { key: 'revision', label: 'Revision', icon: ListChecks },
];

function Quiz({ item }: { item: SqlQuiz }) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="card" style={{ marginBottom: 8 }}>
      <b className="small">{item.q}</b>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {item.options.map((option) => {
          const chosen = picked === option;
          const right = option === item.answer;
          const tone = picked ? (right ? 'easy' : chosen ? 'hard' : '') : '';
          return (
            <button
              key={option}
              type="button"
              className={`chip ${tone}`}
              onClick={() => setPicked(option)}
              style={{ cursor: 'pointer', height: 'auto', whiteSpace: 'normal', textAlign: 'left', padding: '4px 8px' }}
            >
              {option}
            </button>
          );
        })}
      </div>
      {picked && (
        <p className="small" style={{ margin: '8px 0 0' }}>
          {picked === item.answer ? 'Correct. ' : 'Not yet. '}
          <span className="muted">{item.why}</span>
        </p>
      )}
    </div>
  );
}

function Bank({ module, bank }: { module: SqlModule; bank: BankKey }) {
  const items = module.banks[bank];
  if (bank === 'learn') {
    return <>{(items as SqlQuiz[]).map((item) => <Quiz key={item.q} item={item} />)}</>;
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

export function MasterclassPanel({ file, label = 'SQL MASTERCLASS' }: { file: SqlMasterclassFile; label?: string }) {
  const state = useStore();
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<'simple' | 'pro'>('simple');
  const [moduleId, setModuleId] = useState('sql00');
  const [bank, setBank] = useState<BankKey>('learn');
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
  const moduleIndex = module ? modules.findIndex((m) => m.id === module.id) : -1;
  const nextModule = moduleIndex >= 0 ? modules[moduleIndex + 1] : undefined;
  const currentDone = module ? completed.has(module.id) : false;
  const unlocked = (index: number) => index === 0 || index === moduleIndex || completed.has(modules[index - 1].id);

  if (!module) {
    return <div className="card"><div className="skeleton" style={{ height: 90 }} /></div>;
  }

  const openNext = () => {
    if (!nextModule) {
      setNotice('Course complete — every published module is finished.');
      return;
    }
    setModuleId(nextModule.id);
    setBank('learn');
    setLevel('simple');
    setNotice(`Module ${String(module.no).padStart(2, '0')} complete. Module ${String(nextModule.no).padStart(2, '0')} unlocked and opened.`);
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const toggleTopic = (topicId: string, checked: boolean) => {
    const key = masterclassTopicDone(file.course.id, module.id, topicId);
    if (checked) recordAttempt(key, { done: true });
    else forgetAttempt(key);

    const nextDone = new Set(doneTopics);
    if (checked) nextDone.add(topicId);
    else nextDone.delete(topicId);
    const nowComplete = nextDone.size === module.topics.length;
    if (!nowComplete) {
      setNotice(null);
      return;
    }
    if (currentDone) return;
    openNext();
  };

  return (
    <div className="card" ref={panelRef} style={{ marginTop: 10 }}>
      <div className="row spread" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="chip"><GraduationCap size={12} /> {label}</span>
          <b>{file.course.title}</b>
          <span className="chip">{file.stats.topics} topics</span>
          <span className="chip">{file.stats.learn + file.stats.interview + file.stats.labs + file.stats.logic + file.stats.debug + file.stats.revision} bank items</span>
        </div>
        <button type="button" className="btn small" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide course' : 'Open course'}
        </button>
      </div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        Module {String(module.no).padStart(2, '0')} — {module.title}. Check every topic to complete it; the last check unlocks and opens the next module. {file.course.tagline}
      </p>

      {open && (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {modules.map((m, index) => {
              const isOpen = unlocked(index);
              const isDone = completed.has(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`chip ${m.id === module.id ? 'easy' : ''}`}
                  onClick={() => { if (!isOpen) return; setModuleId(m.id); setBank('learn'); setNotice(null); }}
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
            <span className="chip"><ListChecks size={11} /> {module.hours}h</span>
          </div>

          <div className="row spread" style={{ gap: 8, marginTop: 10 }}>
            <span className="small muted"><CheckCircle2 size={12} /> {completed.size} of {modules.length} modules complete</span>
            {nextModule && <span className="small muted">Next: Module {String(nextModule.no).padStart(2, '0')} · {nextModule.title}</span>}
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
                onClick={() => setLevel(value)}
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
                  onClick={() => setBank(entry.key)}
                  style={{ cursor: 'pointer' }}
                >
                  <Icon size={11} /> {entry.label} · {module.banks[entry.key].length}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 10 }}>
            <Bank module={module} bank={bank} />
          </div>

          <div className="card" style={{ marginTop: 10, borderColor: currentDone ? 'var(--ok, #2e7d32)' : undefined }}>
            <div className="row spread" style={{ gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <b className="small">{currentDone ? 'Module complete' : 'Topic checklist'}</b>
                <p className="small muted" style={{ margin: '4px 0 0' }}>
                  {currentDone
                    ? nextModule
                      ? `All ${module.topics.length} topics checked. Module ${String(nextModule.no).padStart(2, '0')} is unlocked.`
                      : `All ${module.topics.length} topics checked. You have finished every published module.`
                    : `${doneTopics.size} of ${module.topics.length} topics checked. Check every topic to complete this module and unlock the next one.`}
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
              {currentDone && !nextModule && (
                <span className="chip easy"><CheckCircle2 size={11} /> Course complete</span>
              )}
            </div>
          </div>

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
export function SqlMasterclass() {
  const file = useSqlMasterclass();
  if (!file) return <div className="card"><div className="skeleton" style={{ height: 90 }} /></div>;
  return <MasterclassPanel file={file} />;
}
