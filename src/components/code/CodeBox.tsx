/**
 * CodeBox — the one advanced code surface in the app.
 *
 * The Playground's editor was the only place that looked like a real IDE: a titled chrome around
 * Monaco, problems under the code, and the failing line lit. Every other coding box — the Python
 * notebook cells, the C notebook, the coach panels — was either a bare textarea or a naked Monaco
 * instance. This wraps Monaco in that chrome once, so all of them get the same thing:
 *
 *   · a bar that names the file, the language and the size (so a cell reads as a file, not a box);
 *   · a problem count, the `✖` line list under the editor, and Monaco's error lens printing the
 *     message at the end of the offending line (see MonacoIDE);
 *   · the run/reset/copy actions in the chrome, where an IDE puts them.
 *
 * Monaco is loaded through `lazy()` on purpose: it must stay out of the entry chunk
 * (`production-readiness.test.mjs` fails if it creeps in), and a lesson that never runs code
 * should not pay for it.
 */
import { lazy, Suspense, type KeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, Circle, Loader } from 'lucide-react';
import type { IdeError } from './MonacoIDE';

const MonacoIDE = lazy(() => import('./MonacoIDE').then((m) => ({ default: m.MonacoIDE })));

export type CodeLanguage = 'python' | 'cpp' | 'javascript' | 'sql' | 'plaintext';

interface Props {
  value: string;
  onChange: (v: string) => void;
  language?: CodeLanguage;
  errors?: IdeError[];
  height?: number | string;
  /** Shown in the chrome, e.g. `cell-2.py` or `main.c`. */
  fileName?: string;
  /** Extra label after the language chip, e.g. a task name. */
  label?: string;
  readOnly?: boolean;
  running?: boolean;
  onRun?: () => void;
  onRunNext?: () => void;
  /** Buttons that belong to the surface (Run tests, Save, …). */
  actions?: ReactNode;
  /** Notebook cell position — the wrapper carries it so cell stepping can find this editor. */
  cellIndex?: number;
  onKeyDownCapture?: (e: KeyboardEvent<HTMLDivElement>) => void;
  className?: string;
}

const LANG_LABEL: Record<CodeLanguage, string> = {
  python: 'Python 3.12',
  cpp: 'C · C17',
  javascript: 'JavaScript',
  sql: 'SQLite',
  plaintext: 'Text',
};

export function CodeBox({
  value, onChange, language = 'python', errors = [], height = 260, fileName, label,
  readOnly, running, onRun, onRunNext, actions, cellIndex, onKeyDownCapture, className,
}: Props) {
  const lines = value ? value.split('\n').length : 1;
  const errorsOnly = errors.filter((e) => e.severity === 'error');
  const shown = errorsOnly.length ? errorsOnly : errors;

  return (
    <div
      className={`codebox${className ? ` ${className}` : ''}`}
      data-cell-index={cellIndex}
      onKeyDownCapture={onKeyDownCapture}
    >
      <div className="codebox-bar">
        <span className="codebox-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="codebox-name">{fileName ?? 'scratch'}</span>
        <span className={`codebox-lang lang-${language}`}>{LANG_LABEL[language] ?? language}</span>
        {label && <span className="codebox-label">{label}</span>}
        <span className="codebox-meta">{lines} lines</span>
        {running && <span className="codebox-meta codebox-run"><Loader size={11} /> running…</span>}
        {shown.length > 0 && (
          <span className="codebox-badge" title="Problems found on the marked lines">
            <AlertTriangle size={11} /> {shown.length}
          </span>
        )}
        {actions && <span className="codebox-actions">{actions}</span>}
      </div>

      <Suspense fallback={<div className="codebox-loading"><Loader size={13} /> Loading editor…</div>}>
        <MonacoIDE
          value={value}
          language={language}
          onChange={onChange}
          errors={errors}
          height={height}
          readOnly={readOnly}
          onRun={onRun}
          onRunNext={onRunNext}
        />
      </Suspense>

      {shown.length > 0 && (
        <ul className="codebox-problems">
          {shown.slice(0, 4).map((p, i) => (
            <li key={`${p.line}-${i}`} className={p.severity === 'error' ? 'is-err' : 'is-warn'}>
              <Circle size={7} /> <b>line {p.line}</b> {p.message}
            </li>
          ))}
          {shown.length > 4 && <li className="muted">+{shown.length - 4} more — hover the squiggles.</li>}
        </ul>
      )}
    </div>
  );
}
