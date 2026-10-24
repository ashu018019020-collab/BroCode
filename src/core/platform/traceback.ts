/**
 * Parse a Python traceback (Pyodide format) into structured diagnostics
 * for editor markers and the tutor card.
 */
export interface Diagnostic {
  kind: string;          // e.g. "AttributeError"
  message: string;       // raw message line
  line: number | null;   // 1-based user-file line if attributable
  col: number | null;
}

export function parseTraceback(err: string): Diagnostic | null {
  if (!err) return null;
  const lines = err.split('\n').map((l) => l.trimEnd());
  // Last "  File ..." frame + following exception line(s).
  let fileLine: number | null = null;
  let col: number | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/File\s+"([^"]*)",\s*line\s+(\d+)/);
    if (m) {
      fileLine = parseInt(m[2], 10);
      const caret = lines[i + 1] ?? '';
      const cm = caret.match(/^(\s+)\^/);
      if (cm) col = cm[1].length + 1;
      break;
    }
  }
  // The exception line is the last non-indented line with a known shape.
  const kindMatch = err.match(/(SyntaxError|IndentationError|NameError|TypeError|ValueError|IndexError|KeyError|AttributeError|ModuleNotFoundError|ImportError|ZeroDivisionError|FileNotFoundError|OSError|EOFError|RuntimeError|RecursionError)\s*:?\s*(.*)/);
  if (!kindMatch && fileLine === null) return null;
  const kind = kindMatch?.[1] ?? 'Error';
  let message = (kindMatch?.[2] ?? '').trim();
  // SyntaxError puts the message on its own line before the type
  if (!message && kindMatch) {
    const idx = lines.findIndex((l) => l.startsWith(kind));
    if (idx > 0) message = lines[idx - 1].trim();
  }
  return { kind, message, line: fileLine, col };
}
