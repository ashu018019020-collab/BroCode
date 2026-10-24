/**
 * runpy.cjs — shared Python snippet runner for the authored-content pipelines.
 *
 * Both `scripts/guides.cjs` (the CODE KAISE KARTE HAIN layer) and `scripts/packs.cjs`
 * (the 16-part topic workspaces) must be able to say "this snippet really ran and the
 * stored output is its real stdout". Keeping one runner means one definition of honesty:
 *
 *   state 'ok'        — ran cleanly; `output` is the real stdout (normalised).
 *   state 'raised'    — Python raised; `reason` is the last stderr line and `kind` the
 *                       exception name. Callers that WANT a failure (debugging tasks) can
 *                       demand this state, everyone else treats it as a hard error.
 *   state 'unrunnable'— needs stdin, needs a module this machine does not have (the app
 *                       bundles numpy/pandas/sklearn in Pyodide), or no interpreter at all.
 *                       Callers keep their documented output and mark `verified: false`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiml-py-'));

let pyOk = null;
/** Is a usable local interpreter present? Cached — this is checked once per process. */
function pythonAvailable() {
  if (pyOk !== null) return pyOk;
  try { execFileSync('python', ['--version'], { stdio: 'ignore' }); pyOk = true; } catch { pyOk = false; }
  return pyOk;
}

/** Trailing whitespace and surrounding blank lines removed, so stored output is stable. */
const normOut = (s) => s.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
/** Whitespace-insensitive compare, for "same code modulo formatting". */
const squash = (s) => String(s ?? '').replace(/\s+/g, '');

/** Third-party runtimes the app bundles in Pyodide but this machine may not have. */
const OPTIONAL_MODULE = /^\s*(?:import|from)\s+(numpy|pandas|sklearn|scipy|matplotlib|seaborn|sqlite3|nltk|transformers|torch|langchain|openai|fastapi|uvicorn|requests)\b/m;

/**
 * Execute one snippet.
 * @param {string} code
 * @param {{ timeout?: number, expectRaise?: boolean }} [opts]
 */
function runSnippet(code, opts = {}) {
  if (!code || !code.trim()) return { state: 'unrunnable', reason: 'empty snippet' };
  // A snippet that reads stdin cannot be verified non-interactively, and a snippet that
  // shells out is not something an offline lesson should be doing in the first place.
  if (/\binput\s*\(/.test(code)) return { state: 'unrunnable', reason: 'needs stdin' };
  if (!pythonAvailable()) return { state: 'unrunnable', reason: 'python not on PATH' };

  const file = path.join(tmpDir, `s${Math.random().toString(36).slice(2)}.py`);
  try {
    fs.writeFileSync(file, `${code}\n`);
    const actual = execFileSync('python', [file], {
      timeout: opts.timeout ?? 8000, cwd: tmpDir, stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    return { state: 'ok', output: normOut(actual) };
  } catch (e) {
    const stderr = String(e.stderr || '');
    const msg = stderr.split('\n').filter(Boolean).slice(-1)[0] || String(e.message || 'error');
    const kind = (stderr.match(/^(\w*Error|\w*Exception)\b/m) || [])[1] || null;
    // A missing local dependency is not a broken snippet — the app bundles it in Pyodide.
    if (/ModuleNotFoundError|ImportError/.test(stderr) && OPTIONAL_MODULE.test(code)) {
      return { state: 'unrunnable', reason: `not installed locally (${msg.slice(0, 60)})` };
    }
    return { state: 'raised', kind, reason: msg.slice(0, 200), output: normOut(String(e.stdout || '')) };
  } finally {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }
}

module.exports = { runSnippet, pythonAvailable, normOut, squash, OPTIONAL_MODULE, tmpDir };
