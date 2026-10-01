/** Unified code-runner API for the app. All execution is local/offline. */
export interface RunResult {
  ok: boolean;
  output: string;
  error?: string;
  result?: string;
  ms: number;
}

// ---------------- Python (Pyodide worker) ----------------
let pyWorker: Worker | null = null;
let pyReady: Promise<void> | null = null;
let readyDone = false;
let seq = 0;
const pending = new Map<number, (r: RunResult) => void>();
const outBuffers = new Map<number, { out: string; err: string }>();
let readyRes: (() => void) | null = null;
let readyRej: ((e: Error) => void) | null = null;

function pyodideUrl(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return new URL(`${base}pyodide/pyodide.mjs`, document.baseURI).href;
}

function ensureWorker(): Worker {
  if (pyWorker) return pyWorker;
  pyWorker = new Worker(new URL('./pythonWorker.ts', import.meta.url), { type: 'module' });
  pyWorker.onmessage = (e: MessageEvent) => {
    const { type, id, text, error, result } = e.data;
    if (type === 'ready') { readyDone = true; readyRes?.(); return; }
    if (type === 'fatal') { readyRej?.(new Error(error)); return; }
    const buf = outBuffers.get(id) ?? { out: '', err: '' };
    if (type === 'stdout') { buf.out += (buf.out ? '\n' : '') + text; outBuffers.set(id, buf); return; }
    if (type === 'stderr') { buf.err += (buf.err ? '\n' : '') + text; outBuffers.set(id, buf); return; }
    const res = pending.get(id);
    if (!res) return;
    pending.delete(id);
    const b = outBuffers.get(id) ?? { out: '', err: '' };
    outBuffers.delete(id);
    if (type === 'done') res({ ok: true, output: b.out, error: b.err || undefined, result, ms: 0 });
    else res({ ok: false, output: b.out, error: error || b.err, ms: 0 });
  };
  pyReady = new Promise((resolve, reject) => { readyRes = resolve; readyRej = reject; });
  pyWorker.postMessage({ type: 'init', id: -1, pyodideUrl: pyodideUrl() });
  return pyWorker;
}

function pythonReady(): Promise<void> {
  ensureWorker();
  return pyReady!;
}

/**
 * Boot the Pyodide worker early so the learner's first Run is instant, and let
 * the UI show that the offline Python runtime is warming up (~5-15s, once).
 * Python itself is bundled under public/pyodide — nothing to install, no network.
 */
export async function warmupPython(): Promise<boolean> {
  try { await pythonReady(); return true; } catch { return false; }
}

export const isPythonReady = () => readyDone;

export async function runPython(code: string, stdin = '', scope = ''): Promise<RunResult> {
  await pythonReady();
  const id = ++seq;
  const t0 = performance.now();
  outBuffers.set(id, { out: '', err: '' });
  return new Promise<RunResult>((resolve) => {
    pending.set(id, (r) => resolve({ ...r, ms: Math.round(performance.now() - t0) }));
    pyWorker!.postMessage({ type: 'run', id, code, stdin, scope });
  });
}

/**
 * Restart one notebook's kernel: its names vanish, other notebooks are untouched.
 * Anything using the shared namespace (empty scope) is unaffected.
 */
export function resetKernel(scope: string) {
  if (!scope) return;
  pyWorker?.postMessage({ type: 'reset-kernel', id: -1, scope });
}

/**
 * Names currently alive in a notebook's kernel — `[(name, type, repr), …]`.
 * Runs in the same session as the cells, so it sees exactly what the learner built.
 */
export async function kernelVars(scope = ''): Promise<[string, string, string][]> {
  const marker = NBVARS_MARKER;
  try {
    const r = await runPython(PROBE_SOURCE, '', scope);
    const line = r.output.split('\n').find((l) => l.includes(marker));
    if (!line) return [];
    const parsed = JSON.parse(line.slice(line.indexOf(marker) + marker.length));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/** Hidden stdout tag + snippet used by `kernelVars`; never shown to the learner. */
const NBVARS_MARKER = '\u0001NBVARS\u0001';
const PROBE_SOURCE = `import json as _nb_json
try:
    _nb_rows = [[_k, type(_v).__name__, repr(_v)[:64]] for _k, _v in list(globals().items()) if not _k.startswith('_')]
except Exception:
    _nb_rows = []
print(${JSON.stringify(NBVARS_MARKER)} + _nb_json.dumps(_nb_rows[:40]))`;

/** Hard-stop: terminate the worker (the only way to interrupt blocking Python). */
export function stopPython() {
  pyWorker?.terminate();
  pyWorker = null; readyDone = false;
  readyRes?.(); // release anyone awaiting the old runtime; a fresh worker starts below
  readyRes = null; readyRej = null;
  pending.forEach((r) => r({ ok: false, output: '', error: 'Stopped by user', ms: 0 }));
  pending.clear(); outBuffers.clear();
  ensureWorker();
}

// ---------------- JavaScript (blob worker) ----------------
export function runJS(code: string, timeoutMs = 5000): Promise<RunResult> {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const src = `
      const out = [];
      const push = (s) => out.push(String(s));
      console.log = (...a) => push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' '));
      console.error = (...a) => push('ERR: ' + a.join(' '));
      console.warn = (...a) => push('WARN: ' + a.join(' '));
      self.onmessage = (e) => {
        try { const r = eval(e.data); push(r === undefined ? '' : '=> ' + String(r)); self.postMessage({ ok: true, out: out.join('\\n') }); }
        catch (err) { push(String(err)); self.postMessage({ ok: false, out: out.join('\\n'), error: String(err) }); }
      };
    `;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    const out: string[] = [];
    const timer = setTimeout(() => {
      w.terminate();
      resolve({ ok: false, output: out.join('\n'), error: `Timed out after ${timeoutMs}ms (possible infinite loop)`, ms: timeoutMs });
    }, timeoutMs);
    w.onmessage = (e: MessageEvent) => {
      clearTimeout(timer); w.terminate();
      out.push(e.data.out ?? '');
      resolve({ ok: !!e.data.ok, output: e.data.out ?? '', error: e.data.error, ms: Math.round(performance.now() - t0) });
    };
    w.onerror = (e) => {
      clearTimeout(timer); w.terminate();
      resolve({ ok: false, output: out.join('\n'), error: e.message || 'Worker error', ms: Math.round(performance.now() - t0) });
    };
    w.onmessageerror = () => {
      clearTimeout(timer); w.terminate();
      resolve({ ok: false, output: out.join('\n'), error: 'Message serialization failed', ms: Math.round(performance.now() - t0) });
    };
    w.postMessage(code);
  });
}

// ---------------- SQL (sql.js / SQLite WASM, local files) ----------------
let sqlInit: Promise<any> | null = null;
function initSql() {
  if (!sqlInit) {
    sqlInit = (async () => {
      const base = import.meta.env.BASE_URL ?? '/';
      const mod: any = await import('sql.js');
      return mod.default({
        locateFile: (f: string) => new URL(`${base}sqljs/${f}`, document.baseURI).href,
      });
    })();
  }
  return sqlInit;
}

export interface SqlRunResult extends RunResult { columns: string[]; rows: string[][] }

export async function runSQL(statements: string, seed?: { name: string; rows: any[][] }[]): Promise<SqlRunResult> {
  const t0 = performance.now();
  try {
    const SQL = await initSql();
    const db = new SQL.Database();
    for (const t of seed ?? []) {
      db.run(`CREATE TABLE ${t.name} (${t.rows[0].map((c) => `"${c}"`).join(',')});`);
      for (let i = 1; i < t.rows.length; i++) {
        db.run(`INSERT INTO ${t.name} VALUES (${t.rows[i].map((v) => typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`).join(',')});`);
      }
    }
    // exec supports single or multiple statements; take the last result set
    const results: { columns: string[]; values: any[][] }[] = db.exec(statements);
    const last = results[results.length - 1];
    const columns = last?.columns ?? [];
    const rows = (last?.values ?? []).map((r: any[]) => r.map((v) => (v === null ? 'NULL' : String(v))));
    db.close();
    return { ok: true, output: `${rows.length} row(s)`, columns, rows, ms: Math.round(performance.now() - t0) };
  } catch (err: any) {
    return { ok: false, output: '', error: String(err?.message ?? err), columns: [], rows: [], ms: Math.round(performance.now() - t0) };
  }
}

// ---------------- friendly error decomposition ----------------
export function explainError(err: string): { what: string; cause: string; debug: string } | null {
  const m = err.match(/(SyntaxError|NameError|TypeError|ValueError|IndexError|KeyError|ZeroDivisionError|IndentationError|AttributeError|ModuleNotFoundError|FileNotFoundError|ConnectionError|RuntimeError|OSError|EOFError)/);
  if (!m) return null;
  const kind = m[1];
  const map: Record<string, { what: string; cause: string; debug: string }> = {
    SyntaxError: { what: 'Python could not parse the code — it is not valid syntax.', cause: 'Missing colon, bracket or quote; invalid assignment target; bad indentation.', debug: 'Read the line number in the traceback, check the character just before it, and count your brackets/quotes.' },
    IndentationError: { what: 'The indentation is inconsistent or missing.', cause: 'Mixed tabs/spaces or a block that was not indented after `:`.', debug: 'Use 4 spaces per level everywhere; check the first line reported in the traceback.' },
    NameError: { what: 'A name is used before it exists.', cause: 'Typo in a variable/function name, or the assignment ran in a different order.', debug: 'print the names you expect right before the failing line; check spelling and order.' },
    TypeError: { what: 'An operation got the wrong type of value.', cause: 'Classic: str + int, or calling something that is not callable.', debug: 'print(type(x)) for every operand just above the failing line; convert explicitly.' },
    ValueError: { what: 'The type is right but the value is invalid.', cause: 'e.g. int("3.5") — int() cannot parse a decimal string.', debug: 'Print the exact value being converted; choose float() or validate the format first.' },
    IndexError: { what: 'A sequence index is out of range.', cause: 'Index beyond len(seq)-1, or an empty sequence.', debug: 'print(len(seq)) and print the index; remember the last valid index is len(seq)-1.' },
    KeyError: { what: 'A dictionary key was not found.', cause: 'Key never inserted, or a typo in the key string.', debug: 'print(d.keys()) before the failing line; use d.get(key, default) for safety.' },
    ZeroDivisionError: { what: 'Division or modulo by zero.', cause: 'Denominator evaluated to 0 (often from user input).', debug: 'print the denominator right before the operation; guard with `if denom:`.' },
    AttributeError: { what: 'That object has no such attribute/method.', cause: 'Wrong type for the method called (e.g. .append on a tuple).', debug: 'print(type(obj)); check the method exists for that type.' },
    ModuleNotFoundError: { what: 'The module is not available in this runtime.', cause: 'Only numpy/pandas (+stdlib) are bundled here.', debug: 'Rewrite the example with stdlib/numpy/pandas equivalents.' },
    FileNotFoundError: { what: 'File not found.', cause: 'Wrong path or the file was never created.', debug: 'List the directory you expect; use Path(__file__).parent as anchor.' },
    ConnectionError: { what: 'Network access is disabled.', cause: 'This lab never calls a network by design.', debug: 'Use the bundled datasets and mock services instead of live APIs.' },
    RuntimeError: { what: 'The runtime refused the operation.', cause: 'Usually recursion depth or an invalid runtime state.', debug: 'Check for missing recursion base-cases or runaway loops.' },
    OSError: { what: 'The runtime hit an input/output error.', cause: 'In this lab the most common cause is input() — provide values in the “Program input” box below the editor.', debug: 'Type each value the program should read (one per line) into Program input, then Run again. To test errors, leave it empty.' },
    EOFError: { what: 'input() reached end of input — no value was available to read.', cause: 'The program called input() more times than there are lines in Program input.', debug: 'Count the input() calls in your code and supply exactly that many lines (one value per line).' },
  };
  return map[kind] ?? null;
}
