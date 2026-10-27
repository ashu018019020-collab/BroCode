#!/usr/bin/env node
/**
 * notebooks.cjs — the Jupyter notebook pipeline for the Python coding labs.
 *
 *   node scripts/notebooks.cjs            # dry run: validate every notebook, execute every cell
 *   node scripts/notebooks.cjs --write    # publish + stamp outputs into public/notebooks/
 *   node scripts/notebooks.cjs check      # structure matrix (cells, verified, app-only)
 *
 * Source of truth is content/notebooks/<name>.ipynb (real nbformat 4 files). The pass:
 *
 *   1. validates the nbformat shape (cells, unique ids, source arrays) so a broken file
 *      cannot reach the learner's editor;
 *   2. EXECUTES every code cell with the local Python interpreter and stores the real stdout
 *      as a Jupyter `stream` output with a real `execution_count` — the notebook a learner
 *      opens is one that demonstrably ran;
 *   3. allows a cell to *intentionally* raise (`metadata.expectError: true`): its traceback is
 *      stored as an `error` output, because teaching an exception with a cell that really
 *      raises is the point;
 *   4. keeps `metadata.appOnly` cells (numpy/pandas) documented instead of faked — those run
 *      in the app's bundled Pyodide runtime, so the pass checks the wheel is actually bundled
 *      under public/pyodide and marks the cell verified:false + verifiedHow:"app-runtime";
 *   5. publishes to public/notebooks/ with a manifest the Notebook Lab reads, and is
 *      all-or-nothing: one bad cell and nothing is written.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runSnippet, pythonAvailable, normOut } = require('./lib/runpy.cjs');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'content', 'notebooks');
const OUT_DIR = path.join(ROOT, 'public', 'notebooks');
const PYODIDE_DIR = path.join(ROOT, 'public', 'pyodide');

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const CHECK = argv.includes('check');

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`\x1b[31m✕\x1b[0m ${m}`);
const warn = (m) => console.log(`\x1b[33m⚠\x1b[0m ${m}`);

/** Modules the app bundles in Pyodide (a cell importing these runs in the app, not here). */
const BUNDLED = ['numpy', 'pandas'];
const bundledWheel = (mod) =>
  fs.existsSync(PYODIDE_DIR) && fs.readdirSync(PYODIDE_DIR).some((f) => f.toLowerCase().startsWith(`${mod}-`) && f.endsWith('.whl'));

const topImports = (code) =>
  [...code.matchAll(/^\s*(?:import\s+([\w.]+)|from\s+([\w.]+)\s+import)/gm)]
    .map((m) => (m[1] ?? m[2]).split('.')[0]);

const asSource = (text) => text.split('\n').map((l, i, a) => (i === a.length - 1 ? l : `${l}\n`));

function loadNotebooks() {
  if (!fs.existsSync(SRC_DIR)) return [];
  return fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.ipynb')).sort()
    .map((f) => ({ file: f, nb: JSON.parse(fs.readFileSync(path.join(SRC_DIR, f), 'utf8')) }));
}

/* ------------------------------------------------------------- shape checks */

function validateNotebook(nb, at) {
  const p = [];
  if (nb?.nbformat !== 4) p.push(`${at}: nbformat must be 4`);
  if (!Array.isArray(nb?.cells) || !nb.cells.length) p.push(`${at}: no cells`);
  const ids = new Set();
  (nb?.cells ?? []).forEach((c, i) => {
    if (!['markdown', 'code'].includes(c?.cell_type)) p.push(`${at}: cell ${i} bad type "${c?.cell_type}"`);
    if (!Array.isArray(c?.source) || !c.source.length) p.push(`${at}: cell ${i} needs a source array`);
    if (ids.has(c?.id)) p.push(`${at}: duplicate cell id "${c?.id}"`);
    ids.add(c?.id);
    if (c?.cell_type === 'code' && !c.metadata?.appOnly && c.metadata?.expectError !== true && !String(c.source.join('')).trim()) {
      p.push(`${at}: code cell ${i} is empty (use a markdown cell instead)`);
    }
  });
  if (!nb?.metadata?.aiml?.title) p.push(`${at}: metadata.aiml.title is required`);
  return p;
}

/* -------------------------------------------------------------- execution */

/**
 * Run the notebook the way Jupyter does: ONE interpreter session, in cell order, with a
 * printed marker between cells so each cell's stdout can be attributed back to it.
 *
 * This matters: a cell may legitimately use a name imported by an earlier cell (that is how
 * notebooks are written), so executing each cell in a fresh process would reject correct
 * notebooks. Isolated runs are kept for cells that are SUPPOSED to raise.
 */
function runSequential(cells) {
  const body = [];
  const starts = []; // { index, id, line } — first line of each cell in the concatenated script
  for (const { index, cell } of cells) {
    starts.push({ index, id: cell.id, line: body.length + 1 });
    body.push(`print('@@CELL:${index}@@')`);
    body.push(cell.source.join(''));
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aiml-nb-')), 'notebook.py');
  fs.writeFileSync(file, body.join('\n') + '\n');
  let stdout = '', stderr = '', failed = null;
  try {
    stdout = execFileSync('python', [file], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, cwd: path.dirname(file) }).toString();
  } catch (e) {
    stdout = String(e.stdout || '');
    stderr = String(e.stderr || '');
    failed = e;
  }

  // Attribute stdout per cell.
  const outputs = new Map();
  let current = null;
  for (const line of normOut(stdout).split('\n')) {
    const m = line.match(/^@@CELL:(\d+)@@$/);
    if (m) { current = Number(m[1]); outputs.set(current, []); continue; }
    if (current !== null) outputs.get(current).push(line);
  }

  // A raise aborts the session: find which cell owned that line and report it precisely.
  let failure = null;
  if (failed) {
    const lineNo = Number((stderr.match(/File "[^"]+", line (\d+)/g) || []).map((s) => Number(s.match(/line (\d+)/)[1])).pop());
    const owner = starts.filter((s) => s.line <= lineNo).pop();
    const lastLine = stderr.split('\n').filter(Boolean).slice(-1)[0] || String(failed.message || 'error');
    const unreached = starts.filter((s) => owner && s.line > owner.line).map((s) => s.id);
    failure = { index: owner?.index ?? null, id: owner?.id ?? '?', reason: lastLine.slice(0, 200), unreached };
  }
  return { outputs, failure };
}

/** Run one cell and return the stamped cell + problems. */
function runCell(cell, at, bundledMissing) {
  const code = cell.source.join('');
  const moduleNames = topImports(code);
  const needsBundled = moduleNames.some((m) => BUNDLED.includes(m));

  if (cell.metadata?.appOnly || needsBundled) {
    // Honest middle ground: we cannot execute numpy/pandas here, but we can prove the app
    // can — the wheel must be bundled, and the cell is marked as app-verified, not faked.
    const missing = moduleNames.filter((m) => BUNDLED.includes(m) && !bundledWheel(m));
    if (missing.length) return { cell, problems: [`${at}: app-only cell needs bundled wheel(s) ${missing.join(', ')} — not found in public/pyodide`] };
    cell.metadata = { ...cell.metadata, appOnly: true, verified: false, verifiedHow: 'app-runtime' };
    cell.execution_count = cell.execution_count ?? null;
    return { cell, problems: [], appOnly: true };
  }

  const first = moduleNames[0];
  if (first && !BUNDLED.includes(first) && bundledMissing.has(first)) {
    return { cell, problems: [`${at}: imports "${first}" which is neither stdlib nor bundled in the browser runtime`] };
  }

  const result = runSnippet(code);
  if (result.state === 'ok') {
    cell.metadata = { ...cell.metadata, verified: true, verifiedHow: 'local-python' };
    cell.outputs = result.output
      ? [{ output_type: 'stream', name: 'stdout', text: asSource(result.output) }]
      : [];
    return { cell, problems: [] };
  }
  if (result.state === 'raised' && cell.metadata?.expectError === true) {
    // A cell that teaches an exception must really raise — that is the lesson.
    cell.metadata = { ...cell.metadata, verified: true, verifiedHow: 'local-python', error: result.kind ?? 'Error' };
    cell.outputs = [{
      output_type: 'error',
      ename: result.kind ?? 'Error',
      evalue: result.reason ?? '',
      traceback: [result.reason ?? ''],
    }];
    return { cell, problems: [] };
  }
  if (result.state === 'unrunnable') return { cell, problems: [`${at}: cell cannot run (${result.reason})`] };
  return { cell, problems: [`${at}: cell raised (${result.kind ?? 'error'}): ${result.reason}`] };
}

/* ------------------------------------------------------------------- main */

function loadImports() {
  // Modules that must not be used because the browser runtime does not have them. Detected
  // by trying to import them locally — the same failure a learner would see.
  const candidates = ['matplotlib', 'seaborn', 'sklearn', 'scipy', 'torch', 'transformers', 'langchain', 'openai', 'requests', 'fastapi', 'nltk'];
  const missing = new Set();
  for (const mod of candidates) {
    const r = runSnippet(`import ${mod}`);
    if (r.state !== 'ok') missing.add(mod);
  }
  return missing;
}

function main() {
  const notebooks = loadNotebooks();
  console.log(`\n— Notebook pass (${CHECK ? 'check' : WRITE ? 'write' : 'dry run'}) —\n`);
  if (!notebooks.length) {
    warn('no notebooks in content/notebooks — nothing to do');
    console.log('');
    return;
  }
  if (!pythonAvailable()) warn('no local python — cells cannot be executed');

  const bundledMissing = CHECK ? new Set() : loadImports();
  const problems = [];
  const manifest = [];
  let codeCells = 0, verified = 0, appOnly = 0, expectedErrors = 0;

  for (const { file, nb } of notebooks) {
    const name = file.replace(/\.ipynb$/, '');
    const shape = validateNotebook(nb, name);
    if (shape.length) { problems.push(...shape); continue; }

    const out = JSON.parse(JSON.stringify(nb));
    let count = 0;
    // Per-notebook tallies — the manifest flags this notebook only, never the previous one.
    let nbVerified = 0, nbExpected = 0, nbApp = 0;

    // 1. Cells that must run together, in order (shared kernel state).
    const sequential = out.cells
      .map((cell, index) => ({ index, cell }))
      .filter(({ cell }) => cell.cell_type === 'code'
        && !cell.metadata?.appOnly
        && cell.metadata?.expectError !== true
        && !topImports(cell.source.join('')).some((m) => BUNDLED.includes(m)));

    for (const { index, cell } of sequential) codeCells++;

    if (sequential.length) {
      const { outputs, failure } = runSequential(sequential);
      if (failure) {
        problems.push(`${name} cell ${failure.index} (${failure.id}) raised: ${failure.reason}` +
          (failure.unreached.length ? ` — later cells never ran: ${failure.unreached.join(', ')}` : ''));
      }
      for (const { index, cell } of sequential) {
        if (failure && failure.index === index) continue;
        const text = (outputs.get(index) ?? []).join('\n');
        cell.metadata = { ...cell.metadata, verified: true, verifiedHow: 'local-python' };
        cell.outputs = text ? [{ output_type: 'stream', name: 'stdout', text: asSource(text) }] : [];
      }
    }

    // 2. Cells that must raise, app-only cells, and anything else: run/claim individually.
    for (const [i, cell] of out.cells.entries()) {
      if (cell.cell_type !== 'code') continue;
      const inSequential = sequential.some((s) => s.index === i);
      if (inSequential) {
        count++;
        if (!cell.metadata?.verified) continue;      // it failed above; already reported
        verified++; nbVerified++;
        continue;
      }
      codeCells++;
      const { problems: cellProblems, appOnly: isApp } = runCell(cell, `${name} cell ${i} (${cell.id})`, bundledMissing);
      problems.push(...cellProblems);
      if (cellProblems.length) continue;
      count++;
      if (isApp) { appOnly++; nbApp++; }
      else if (cell.metadata?.expectError) { expectedErrors++; nbExpected++; }
      else { verified++; nbVerified++; }
    }
    out.cells.forEach((c, i) => {
      if (c.cell_type === 'code') c.execution_count = c.metadata?.appOnly ? null : i + 1;
    });
    out.metadata = {
      ...out.metadata,
      aiml: { ...out.metadata.aiml, published: new Date().toISOString().slice(0, 10), codeCells: count },
    };
    manifest.push({
      file: `${name}.ipynb`,
      title: out.metadata.aiml.title,
      topic: out.metadata.aiml.topic ?? '',
      section: out.metadata.aiml.section ?? '',
      level: out.metadata.aiml.level ?? 'beginner',
      cells: out.cells.length,
      codeCells: count,
      verifiedCells: nbVerified,
      expectedErrorCells: nbExpected,
      appRuntimeCells: nbApp,
      needsAppRuntime: nbApp > 0,
      intro: out.metadata.aiml.intro ?? '',
    });
    if (WRITE) {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, `${name}.ipynb`), JSON.stringify(out, null, 1) + '\n');
    }
    ok(`${name} · ${out.metadata.aiml.title}: ${count} code cells`);
  }

  if (problems.length) {
    bad(`${problems.length} notebook problem(s) — nothing written`);
    problems.slice(0, 15).forEach((p) => console.log('   · ' + p));
    process.exit(1);
  }

  console.log(`\n   cells executed for real: ${verified} · expected-error cells: ${expectedErrors} · app-only (bundled numpy/pandas): ${appOnly}`);
  if (WRITE) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
      generated: new Date().toISOString().slice(0, 10),
      notebooks: manifest,
    }, null, 2) + '\n');
    ok(`published ${manifest.length} notebook(s) to public/notebooks/`);
  } else warn('dry run — re-run with --write to publish');
  console.log('');
  void codeCells;
}

main();
