import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';

/**
 * Monaco wired to the locally bundled runtime (npm monaco-editor, no CDN).
 * Vite worker plugin is configured in vite.config.ts.
 */
import EditorWorker from '../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker&inline';

let started = false;
function ensureMonaco() {
  if (started) return;
  started = true;
  // Wire Monaco's web worker through Vite's ?worker pipeline (local bundle, no CDN).
  (window as any).MonacoEnvironment = { getWorker: () => new EditorWorker() };
  monaco.editor.defineTheme('aiml-dark', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '6B7A99', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'C792EA' },
      { token: 'string', foreground: '7EE787' },
      { token: 'string.escape', foreground: 'F2CC60' },
      { token: 'number', foreground: 'F78C6C' },
      { token: 'type', foreground: '7FD1E8' },
      { token: 'constructor', foreground: 'FFCB6B' },
      { token: 'function', foreground: '82AAFF' },
      { token: 'variable', foreground: 'D7E4FF' },
    ],
    colors: {
      'editor.background': '#0D0D0D',
      'editorLineNumber.foreground': '#525252',
      'editorLineNumber.activeForeground': '#A3A3A3',
      'editor.lineHighlightBackground': '#1A1A1A',
      'editor.selectionBackground': '#3A3A3A',
      'editorIndentGuide.background': '#1F1F1F',
      'editorGutter.background': '#0D0D0D',
    },
  });
}

export interface IdeError { line: number; message: string; severity: 'error' | 'warning' }

interface Props {
  value: string;
  language?: 'python' | 'javascript' | 'sql' | 'plaintext';
  onChange: (v: string) => void;
  onRun?: () => void;
  onSave?: () => void;
  errors?: IdeError[];
  height?: number | string;
  readOnly?: boolean;
}

export function MonacoIDE({ value, language = 'python', onChange, onRun, onSave, errors = [], height = 380, readOnly }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const edRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decoRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  // The editor is built once per language, so its listeners read the CURRENT handlers: capturing
  // them in the create-effect would write an edit into the file selected back then.
  const handlers = useRef({ onChange, onRun, onSave });
  handlers.current = { onChange, onRun, onSave };

  useEffect(() => {
    ensureMonaco();
    const ed = monaco.editor.create(hostRef.current!, {
      value,
      language,
      theme: 'aiml-dark',
      minimap: { enabled: true, size: 'proportional' },
      fontSize: 14,
      lineNumbers: 'on',
      folding: true,
      wordWrap: 'off',
      automaticLayout: true,
      tabSize: 4,
      readOnly,
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      smoothScrolling: true,
      suggestOnTriggerCharacters: true,
      quickSuggestions: { other: true, comments: false, strings: false },
    });
    edRef.current = ed;
    decoRef.current = ed.createDecorationsCollection([]);

    // Nothing to dispose by hand: `ed.dispose()` tears down its own registrations, like the commands below.
    ed.onDidChangeModelContent(() => handlers.current.onChange(ed.getValue()));
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => handlers.current.onRun?.());
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => handlers.current.onSave?.());

    return () => { ed.dispose(); edRef.current = null; };
  }, [language, readOnly]);

  // value sync (external reset/load)
  useEffect(() => {
    const ed = edRef.current;
    if (ed && ed.getValue() !== value) ed.setValue(value);
  }, [value]);

  // error squiggles + line highlight
  useEffect(() => {
    const ed = edRef.current;
    if (!ed) return;
    const markers: monaco.editor.IMarkerData[] = errors.map((e) => ({
      startLineNumber: e.line, startColumn: 1, endLineNumber: e.line, endColumn: 1e5,
      message: e.message, severity: e.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
    }));
    monaco.editor.setModelMarkers(ed.getModel()!, 'aiml', markers);
    decoRef.current?.set(errors.filter((e) => e.severity === 'error').map((e) => ({
      range: new monaco.Range(e.line, 1, e.line, 1e5),
      options: { isWholeLine: true, className: 'err-line', overviewRuler: { color: '#f87171', position: 4 } },
    })));
  }, [errors, value]);

  return (
    <div style={{ position: 'relative' }}>
      <div ref={hostRef} style={{ height }} />
    </div>
  );
}
