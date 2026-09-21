/// <reference lib="webworker" />
import { DATASETS, datasetAsCSV } from '../../data/datasets';
/**
 * Offline Python worker. The main thread passes the absolute URL of
 * ./pyodide/pyodide.mjs (computed against document.baseURI), so this works in
 * dev, preview and any static hosting — always from local files.
 */
let pyodide: any = null;
let activeId: number | null = null; // id of the currently executing run
let chain: Promise<void> = Promise.resolve(); // serialize runs (pyodide is single-threaded)
let stdinQueue: string[] = [];

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
  // stdin comes from the CodeLab "Program input" box; empty queue → EOFError in input()
  pyodide.setStdin({ stdin: () => (stdinQueue.length ? stdinQueue.shift() + '\n' : '') });
  // Seed the bundled datasets into the virtual FS so pd.read_csv('students.csv') works offline.
  for (const d of DATASETS) pyodide.FS.writeFile(`${d.name}.csv`, datasetAsCSV(d), { encoding: 'utf8' });
}

self.onmessage = (e: MessageEvent) => {
  const { type, id, code, pyodideUrl, stdin } = e.data;
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
        const result = await pyodide.runPythonAsync(code);
        post({ type: 'done', id, result: result === undefined || result === null ? null : String(result) });
      } catch (err: any) {
        post({ type: 'error', id, error: String(err?.message ?? err) });
      } finally {
        if (activeId === id) activeId = null;
      }
    });
  }
};
