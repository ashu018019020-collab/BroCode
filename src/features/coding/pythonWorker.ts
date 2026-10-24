/// <reference lib="webworker" />
import { DATASETS, datasetAsCSV } from '../../core/data/datasets';
/**
 * Offline Python worker. The main thread passes the absolute URL of
 * ./pyodide/pyodide.mjs (computed against document.baseURI), so this works in
 * dev, preview and any static hosting — always from local files.
 */
let pyodide: any = null;
let activeId: number | null = null; // id of the currently executing run
let chain: Promise<void> = Promise.resolve(); // serialize runs (pyodide is single-threaded)
let stdinQueue: string[] = [];

/**
 * One kernel session per notebook. Jupyter gives every notebook its own kernel;
 * here that is a private globals dict per scope name, so `df` defined in one
 * notebook can never leak into another, while cells of the SAME notebook keep
 * sharing names and imports (import once, use in every later cell).
 * An empty scope name keeps using the shared global namespace (Playground).
 */
const scopes = new Map<string, any>();

function scopeFor(name: string) {
  let s = scopes.get(name);
  if (!s) {
    s = pyodide.globals.get('dict')();
    s.set('__name__', '__main__');
    s.set('__builtins__', pyodide.globals.get('__builtins__'));
    scopes.set(name, s);
  }
  return s;
}

function post(msg: any) { (self as any).postMessage(msg); }

async function init(pyodideUrl: string) {
  if (pyodide) return;
  const mod = await import(/* @vite-ignore */ pyodideUrl);
  const loadPyodide = mod.loadPyodide ?? mod.default;
  pyodide = await loadPyodide({
    indexURL: new URL('.', pyodideUrl).href,
    lockFileURL: new URL('pyodide-lock.json', pyodideUrl).href,
  });
  // Route stdout/stderr to whichever run is active — NOT the init-time id.
  pyodide.setStdout({ batched: (s: string) => post({ type: 'stdout', id: activeId, text: s }) });
  pyodide.setStderr({ batched: (s: string) => post({ type: 'stderr', id: activeId, text: s }) });
  // stdin comes from the notebook "Program input" box. An exhausted queue must return `undefined`
  // (NOT an empty string): `undefined` is what Pyodide reports as EOF, so `input()` raises the
  // real `EOFError: EOF when reading a line` — exactly like Jupyter. Returning '' instead handed
  // the code an empty line, so a missing input surfaced as `ValueError: invalid literal for
  // int() with base 10: ''` — a message that blames the learner's conversion and hides the fact
  // that the Program Input box was simply empty, making the app's own EOFError coaching unreachable.
  pyodide.setStdin({ stdin: () => (stdinQueue.length ? stdinQueue.shift() + '\n' : undefined) });
  // Seed the bundled datasets into the virtual FS so pd.read_csv('students.csv') works offline.
  for (const d of DATASETS) pyodide.FS.writeFile(`${d.name}.csv`, datasetAsCSV(d), { encoding: 'utf8' });
}

self.onmessage = (e: MessageEvent) => {
  const { type, id, code, pyodideUrl, stdin, scope } = e.data;
  if (type === 'init') {
    init(pyodideUrl)
      .then(() => post({ type: 'ready', id }))
      .catch((err: any) => post({ type: 'fatal', id, error: String(err?.message ?? err) }));
    return;
  }
  if (type === 'run') {
    chain = chain.then(async () => {
      if (!pyodide) { post({ type: 'error', id, error: 'Python runtime not ready' }); return; }
      activeId = id;
      stdinQueue = (typeof stdin === 'string' && stdin.length) ? stdin.replace(/\r/g, '').split('\n') : [];
      try {
        await pyodide.loadPackagesFromImports(code, {
          messageCallback: (m: string) => { if (/Loading/i.test(m)) post({ type: 'stdout', id: activeId, text: m }); },
        });
        const ns = scope ? scopeFor(scope) : undefined;
        const result = await pyodide.runPythonAsync(code, ns ? { globals: ns } : undefined);
        post({ type: 'done', id, result: result === undefined || result === null ? null : String(result) });
      } catch (err: any) {
        post({ type: 'error', id, error: String(err?.message ?? err) });
      } finally {
        if (activeId === id) activeId = null;
      }
    });
  }
  if (type === 'reset-kernel') {
    // Jupyter's "Restart kernel": drop this notebook's names, keep the others.
    const s = scopes.get(scope);
    scopes.delete(scope);
    try { s?.destroy?.(); } catch { /* already gone with a terminated runtime */ }
  }
};
