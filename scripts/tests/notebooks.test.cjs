/**
 * Notebook invariants — the Jupyter layer, locked as tests.
 *
 * The notebook pipeline (`npm run notebooks:write`) executes every cell while authoring and
 * stamps the real stdout into the published file. These tests keep that promise honest:
 *
 *   · every source notebook must be valid nbformat with unique cell ids;
 *   · the published copy must exist and carry the same code cells as its source, so the file
 *     the learner opens is never a stale or hand-edited sibling of what was verified;
 *   · every code cell must declare HOW it was verified — `local-python` (really executed) or
 *     `app-runtime` (needs the bundled numpy/pandas, which the app runs);
 *   · a cell marked "expected error" must actually carry an error output, and a cell that
 *     claims to have run must carry a stream output — a notebook cannot claim both;
 *   · an app-runtime cell may only import modules the app really bundles (numpy/pandas), so a
 *     learner never hits an uninstallable import in the offline runtime;
 *   · the manifest the Notebook Lab reads must describe exactly the published notebooks.
 *
 * Execution itself stays in `npm run notebooks` — it is intentionally slow and must run
 * before publishing, not on every test pass.
 *
 * Zero dependencies — built-in node:test runner. `npm test`
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC_DIR = path.join(ROOT, 'content', 'notebooks');
const PUB_DIR = path.join(ROOT, 'public', 'notebooks');
const PYODIDE_DIR = path.join(ROOT, 'public', 'pyodide');
const BUNDLED = ['numpy', 'pandas'];

const srcFiles = fs.existsSync(SRC_DIR) ? fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.ipynb')).sort() : [];
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const codeCells = (nb) => (nb.cells ?? []).filter((c) => c.cell_type === 'code');
const topImports = (code) =>
  [...code.matchAll(/^\s*(?:import\s+([\w.]+)|from\s+([\w.]+)\s+import)/gm)].map((m) => (m[1] ?? m[2]).split('.')[0]);
const streamText = (c) => (c.outputs ?? []).filter((o) => o.output_type === 'stream').map((o) => (Array.isArray(o.text) ? o.text.join('') : String(o.text ?? ''))).join('');

test('notebooks: sources exist and are valid nbformat with unique ids', () => {
  assert.ok(srcFiles.length > 0, 'expected notebooks in content/notebooks');
  for (const f of srcFiles) {
    const nb = read(SRC_DIR, f);
    assert.equal(nb.nbformat, 4, `${f}: nbformat must be 4`);
    assert.ok(Array.isArray(nb.cells) && nb.cells.length > 0, `${f}: no cells`);
    const ids = nb.cells.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, `${f}: duplicate cell ids`);
    for (const c of nb.cells) {
      assert.ok(['markdown', 'code'].includes(c.cell_type), `${f}: bad cell type`);
      assert.ok(Array.isArray(c.source) && c.source.length, `${f}: cell ${c.id} has no source`);
    }
    assert.ok(nb.metadata?.aiml?.title, `${f}: metadata.aiml.title required`);
  }
});

test('notebooks: published copies match their sources', () => {
  for (const f of srcFiles) {
    assert.ok(fs.existsSync(path.join(PUB_DIR, f)), `${f} is not published — run npm run notebooks:write`);
    const src = read(SRC_DIR, f);
    const pub = read(PUB_DIR, f);
    assert.equal(codeCells(pub).length, codeCells(src).length, `${f}: published code-cell count drifted`);
    assert.deepEqual(codeCells(pub).map((c) => c.id), codeCells(src).map((c) => c.id), `${f}: published cells reordered`);
    for (const [i, sc] of codeCells(src).entries()) {
      assert.equal(codeCells(pub)[i].source.join(''), sc.source.join(''), `${f}: published cell ${sc.id} code drifted from source`);
    }
  }
});

test('notebooks: every published code cell declares how it was verified', () => {
  for (const f of srcFiles) {
    for (const c of codeCells(read(PUB_DIR, f))) {
      const how = c.metadata?.verifiedHow;
      assert.ok(['local-python', 'app-runtime'].includes(how), `${f}: cell ${c.id} missing verifiedHow (got ${how})`);
      if (how === 'app-runtime') assert.equal(c.metadata?.appOnly, true, `${f}: cell ${c.id} claims app-runtime without appOnly`);
      else assert.equal(c.metadata?.verified, true, `${f}: cell ${c.id} claims local-python but is not marked verified`);
    }
  }
});

test('notebooks: expected-error cells carry a real error output, others do not', () => {
  for (const f of srcFiles) {
    for (const c of codeCells(read(PUB_DIR, f))) {
      const outs = c.outputs ?? [];
      const raised = outs.some((o) => o.output_type === 'error');
      if (c.metadata?.appOnly) {
        // An app-runtime cell cannot be executed here, so it stores no output at all — the
        // learner sees the real traceback when the cell runs in the app. It must not pretend.
        assert.deepEqual(outs, [], `${f}: app-runtime cell ${c.id} must not carry fabricated output`);
        continue;
      }
      if (c.metadata?.expectError) {
        assert.ok(raised, `${f}: cell ${c.id} claims a taught error but has no error output`);
      } else {
        assert.ok(!raised, `${f}: cell ${c.id} raised unexpectedly`);
      }
    }
  }
});

test('notebooks: a cell that ran really has its stdout stored', () => {
  // A verified local-python cell with no output must genuinely be a silent cell — so the rule
  // is not "must have output" but "must not have lost output": we re-check the marker by
  // looking for notebooks where EVERY verified cell is empty, which would mean stamping broke.
  for (const f of srcFiles) {
    const verified = codeCells(read(PUB_DIR, f)).filter((c) => c.metadata?.verifiedHow === 'local-python' && !c.metadata?.expectError);
    if (!verified.length) continue;
    const withOutput = verified.filter((c) => streamText(c).trim().length > 0);
    assert.ok(withOutput.length > 0, `${f}: no verified cell stored any stdout — the stamping pass did not run`);
  }
});

test('notebooks: app-runtime cells import nothing the app cannot provide', () => {
  // The offline runtime = Python stdlib + the bundled wheels. Anything else (matplotlib,
  // sklearn, torch, requests…) would fail for the learner, so it must not appear here.
  const wheel = (mod) => fs.existsSync(PYODIDE_DIR) && fs.readdirSync(PYODIDE_DIR).some((x) => x.toLowerCase().startsWith(`${mod}-`) && x.endsWith('.whl'));
  for (const mod of BUNDLED) assert.ok(wheel(mod), `bundled wheel missing for ${mod} — the app could not run these cells`);

  const stdlib = new Set([
    'time', 'math', 'json', 'random', 'collections', 'itertools', 'functools', 'datetime', 're',
    'os', 'sys', 'statistics', 'csv', 'statistics', 'decimal', 'string', 'typing', 'dataclasses',
  ]);
  const unbundled = ['matplotlib', 'seaborn', 'sklearn', 'scipy', 'torch', 'transformers', 'langchain', 'openai', 'requests', 'fastapi', 'nltk', 'plotly'];

  for (const f of srcFiles) {
    for (const c of codeCells(read(PUB_DIR, f))) {
      if (!c.metadata?.appOnly) continue;
      const mods = topImports(c.source.join(''));
      const blocked = mods.filter((m) => unbundled.includes(m));
      assert.deepEqual(blocked, [], `${f}: cell ${c.id} imports ${blocked.join(', ')} which the offline runtime does not have`);
      const unknown = mods.filter((m) => !BUNDLED.includes(m) && !stdlib.has(m));
      assert.deepEqual(unknown, [], `${f}: cell ${c.id} imports non-stdlib module(s) ${unknown.join(', ')}`);
    }
  }
});

test('notebooks: the manifest describes exactly the published notebooks', () => {
  const manifestPath = path.join(PUB_DIR, 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'public/notebooks/manifest.json missing — run npm run notebooks:write');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(manifest.notebooks.map((n) => n.file).sort(), srcFiles, 'manifest file list drifted from the sources');
  for (const entry of manifest.notebooks) {
    const nb = read(PUB_DIR, entry.file);
    assert.equal(entry.codeCells, codeCells(nb).length, `${entry.file}: manifest code-cell count drifted`);
    assert.equal(entry.needsAppRuntime, codeCells(nb).some((c) => c.metadata?.appOnly), `${entry.file}: manifest app-runtime flag drifted`);
    assert.equal(entry.title, nb.metadata?.aiml?.title, `${entry.file}: manifest title drifted`);
  }
});

test('notebooks: the old code editor is gone and every coding surface is a notebook', () => {
  // The editor was deleted on purpose: coding practice happens in notebooks everywhere now.
  // This guards the deletion — a file that still imports it would be a half-done migration.
  const UI = path.join(ROOT, 'src');
  assert.ok(!fs.existsSync(path.join(UI, 'components', 'CodeLab.tsx')), 'the deleted code editor component came back');

  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  };
  walk(UI);

  const importers = files
    .filter((f) => /from\s+['"][^'"]*CodeLab['"]/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(importers, [], 'these files still import the deleted code editor');

  // Every place a learner writes code in a lesson must render the notebook engine.
  for (const f of ['features/learning/Lesson.tsx', 'components/learning/TopicWorkspace.tsx', 'features/labs/NumPyPandasLab.tsx', 'features/interview/FinalAssessment.tsx']) {
    const src = fs.readFileSync(path.join(UI, f), 'utf8');
    assert.match(src, /JupyterNotebook/, `${f} no longer renders the notebook`);
    assert.ok(!/<CodeLab/.test(src), `${f} still renders the deleted <CodeLab>`);
  }
});

test('notebooks: the library shelf only offers wheels the app really bundles', () => {
  // `NOTEBOOK_LIBS` drives the one-click library cells. If it ever listed a package without a
  // bundled wheel, the learner would click it and hit ModuleNotFoundError in an offline app.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'core', 'data', 'notebooks.ts'), 'utf8');
  const ids = [...src.matchAll(/\{\s*id:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(ids.length > 0, 'src/core/data/notebooks.ts declares no libraries');
  const wheels = fs.readdirSync(PYODIDE_DIR);
  for (const id of ids) {
    assert.ok(BUNDLED.includes(id), `${id} is offered in the shelf but is not a bundled library`);
    assert.ok(
      wheels.some((w) => w.toLowerCase().startsWith(`${id}-`) && w.endsWith('.whl')),
      `no bundled wheel for ${id} — the shelf would advertise an uninstallable import`,
    );
  }
});
