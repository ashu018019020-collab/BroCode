import { useMemo, useState } from 'react';
import { BookOpen, Bug, Check, Code2, GraduationCap, HelpCircle, Layers, ListChecks } from 'lucide-react';
import { useSqlMasterclass, type SqlModule, type SqlQuiz } from '../../core/data/sqlmasterclass';

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

export function SqlMasterclass() {
  const file = useSqlMasterclass();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<'simple' | 'pro'>('simple');
  const [moduleId, setModuleId] = useState('sql00');
  const [bank, setBank] = useState<BankKey>('learn');
  const modules = file?.modules ?? [];
  const module = useMemo(() => modules.find((m) => m.id === moduleId) ?? modules[0], [modules, moduleId]);

  if (!file || !module) {
    return <div className="card"><div className="skeleton" style={{ height: 90 }} /></div>;
  }

  return (
    <div className="card" style={{ marginTop: 10 }}>
      <div className="row spread" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="chip"><GraduationCap size={12} /> SQL MASTERCLASS</span>
          <b>{file.course.title}</b>
          <span className="chip">{file.stats.topics} topics</span>
          <span className="chip">{file.stats.learn + file.stats.interview + file.stats.labs + file.stats.logic + file.stats.debug + file.stats.revision} bank items</span>
        </div>
        <button type="button" className="btn small" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide course' : 'Open course'}
        </button>
      </div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        Phase 1: Module 00 — {module.title}. {file.course.tagline}
      </p>

      {open && (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {modules.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`chip ${m.id === module.id ? 'easy' : ''}`}
                onClick={() => { setModuleId(m.id); setBank('learn'); }}
                style={{ cursor: 'pointer' }}
              >
                Module {String(m.no).padStart(2, '0')} · {m.title}
              </button>
            ))}
            <span className="chip"><Layers size={11} /> {module.topics.length} topics</span>
            <span className="chip"><ListChecks size={11} /> {module.hours}h</span>
          </div>

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
            {module.topics.map((topic) => (
              <div key={topic.id} className="card" style={{ marginBottom: 8 }}>
                <b className="small">{topic.title}</b>
                <p className="small" style={{ margin: '6px 0 0' }}>{level === 'simple' ? topic.simple : topic.pro}</p>
                <ul className="small muted" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {topic.points.map((point) => <li key={point}>{point}</li>)}
                </ul>
                <pre className="codeblock" style={{ margin: '8px 0 0' }}>{topic.example.sql}</pre>
                <p className="small muted" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}><b>Output</b>{'\n'}{topic.example.output}</p>
              </div>
            ))}
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
