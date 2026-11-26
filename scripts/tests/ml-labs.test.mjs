/**
 * ML labs and Colab packs — the course's runnable middle layer.
 *
 * The offline labs must use only the bundled NumPy/Pandas runtime, execute in one kernel session,
 * and read the canonical CSVs that the worker seeds. The Colab packs are a separate contract:
 * valid nbformat, pinned scikit-learn/XGBoost, canonical `load_*` datasets, and every code cell
 * parseable. When those libraries are installed, the packs are executed end to end; without them
 * that single execution check is a skip, never a pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = path.join(ROOT, 'content', 'datasets', 'ml');
const PUB_DATA = path.join(ROOT, 'public', 'datasets', 'ml');
const NB = path.join(ROOT, 'content', 'notebooks');
const COLAB = path.join(ROOT, 'content', 'colab-ml');
const PUB_COLAB = path.join(ROOT, 'public', 'colab-ml');
const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'generated', 'ml-course', 'index.json'), 'utf8'));
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const codeCells = (nb) => (nb.cells ?? []).filter((cell) => cell.cell_type === 'code');
const source = (cell) => (Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? ''));
const imports = (code) => [...code.matchAll(/^\s*(?:import\s+([\w.]+)|from\s+([\w.]+)\s+import)/gm)].map((match) => (match[1] ?? match[2]).split('.')[0]);
const py = spawnSync('python3', ['-c', 'print("ok")'], { encoding: 'utf8' });

function runCode(code, datasets = [], timeout = 120000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-lab-'));
  for (const id of datasets) {
    const file = path.join(DATA, `${id}.csv`);
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dir, `${id}.csv`));
  }
  const result = spawnSync('python3', ['-c', code], { cwd: dir, encoding: 'utf8', timeout });
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

test('canonical datasets: every CSV has the advertised shape, hash and provenance', () => {
  const metadata = read(path.join(DATA, 'datasets.json'));
  const manifest = read(path.join(PUB_DATA, 'manifest.json'));
  assert.equal(metadata.length, 4);
  assert.equal(manifest.datasets.length, metadata.length);
  const ids = new Set();
  for (const entry of metadata) {
    assert.ok(entry.id && entry.title && entry.source.startsWith('https://') && entry.license, `${entry.id}: provenance is incomplete`);
    assert.ok(!ids.has(entry.id), `${entry.id}: duplicate id`);
    ids.add(entry.id);
    const raw = fs.readFileSync(path.join(DATA, entry.file), 'utf8').replace(/\r\n?/g, '\n');
    const csv = raw.trimEnd();
    const published = fs.readFileSync(path.join(PUB_DATA, entry.file), 'utf8').replace(/\r\n?/g, '\n').trimEnd();
    assert.equal(published, csv, `${entry.file}: public copy drifted from content`);
    const lines = csv.split('\n');
    assert.ok(lines.length > 100, `${entry.id}: too few rows`);
    const header = lines[0].split(',');
    assert.ok(header.includes(entry.target), `${entry.id}: target is not a column`);
    assert.ok(lines.slice(1).every((line) => line.split(',').length === header.length), `${entry.id}: ragged row`);
    const found = manifest.datasets.find((dataset) => dataset.id === entry.id);
    assert.ok(found, `${entry.id}: missing from manifest`);
    assert.equal(found.rows, lines.length - 1);
    assert.equal(found.featureCount, header.length - 1);
    assert.equal(found.sha256, crypto.createHash('sha256').update(raw).digest('hex'), `${entry.id}: hash must cover the LF-normalised canonical text`);
  }
});

test('offline labs: all five exist, declare their data, and use only the bundled runtime', () => {
  assert.equal(artifact.labs?.length, 5);
  assert.equal(artifact.datasets?.length, 4);
  const published = read(path.join(ROOT, 'public', 'notebooks', 'manifest.json')).notebooks;
  for (const lab of artifact.labs) {
    assert.equal(lab.runtime, 'offline', `${lab.id}: not an offline lab`);
    assert.ok(published.some((entry) => entry.file === lab.notebook), `${lab.id}: notebook is not published`);
    const nb = read(path.join(NB, lab.notebook));
    assert.equal(nb.metadata.aiml.localRun, true, `${lab.id}: must opt into local execution`);
    assert.ok(nb.metadata.aiml.datasets?.length, `${lab.id}: no dataset declared`);
    const code = codeCells(nb).map(source).join('\n');
    const modules = imports(code);
    assert.ok(!modules.includes('sklearn') && !modules.includes('xgboost'), `${lab.id}: an offline lab imported an unbundled library`);
    assert.ok(modules.includes('numpy'), `${lab.id}: expected a NumPy lab`);
    assert.ok(!/fetch_openml|read_csv\s*\(\s*['"]https?:/.test(code), `${lab.id}: network dataset access is forbidden`);
  }
});

test('offline labs: every published cell was executed, and the code still runs in one session', (t) => {
  if (py.status !== 0) {
    t.skip('python3 is not available');
    return;
  }
  for (const lab of artifact.labs) {
    const nb = read(path.join(ROOT, 'public', 'notebooks', lab.notebook));
    const cells = codeCells(nb);
    assert.equal(cells.filter((cell) => cell.metadata?.verifiedHow === 'local-python').length, cells.length, `${lab.notebook}: a cell was not executed`);
    const result = runCode(cells.map(source).join('\n'), nb.metadata.aiml.datasets);
    assert.equal(result.status, 0, `${lab.notebook}: fresh run failed\n${result.stderr}`);
    assert.ok(result.stdout.trim().length > 50, `${lab.notebook}: produced no evidence output`);
  }
});

test('Colab packs: three published packs, valid syntax, pinned libraries and canonical loaders', (t) => {
  assert.equal(artifact.colabPacks?.length, 3);
  const manifest = read(path.join(PUB_COLAB, 'manifest.json'));
  assert.equal(manifest.notebooks.length, 3);
  const sources = [];
  for (const pack of artifact.colabPacks) {
    const packed = read(path.join(PUB_COLAB, pack.file));
    const sourceNotebook = read(path.join(COLAB, pack.file));
    assert.deepEqual(packed, sourceNotebook, `${pack.file}: published copy drifted from source`);
    assert.equal(sourceNotebook.nbformat, 4, `${pack.file}: nbformat`);
    assert.equal(sourceNotebook.metadata.aiml.runtime, 'colab', `${pack.file}: runtime`);
    assert.ok(sourceNotebook.metadata.aiml.requirements.some((req) => /^scikit-learn==/.test(req)), `${pack.file}: sklearn pin missing`);
    assert.ok(sourceNotebook.metadata.aiml.requirements.some((req) => /^xgboost==/.test(req)), `${pack.file}: xgboost pin missing`);
    const all = codeCells(sourceNotebook).map(source).join('\n');
    assert.match(all, /load_iris|load_breast_cancer|load_diabetes/, `${pack.file}: no canonical sklearn loader`);
    assert.ok(!/fetch_openml|read_csv\s*\(\s*['"]https?:/.test(all), `${pack.file}: downloads a dataset`);
    sources.push(path.join(COLAB, pack.file));
  }
  assert.ok(!read(path.join(ROOT, 'public', 'notebooks', 'manifest.json')).notebooks.some((entry) => entry.file.includes('sklearn')), 'a Colab pack leaked into the offline notebook manifest');

  if (py.status !== 0) {
    t.skip('python3 is not available for syntax checking');
    return;
  }
  const script = "import ast,json,sys\nfor p in sys.argv[1:]:\n    nb=json.load(open(p))\n    for c in nb['cells']:\n        if c['cell_type']=='code': ast.parse(''.join(c['source']))\nprint('syntax ok')";
  const result = spawnSync('python3', ['-c', script, ...sources], { encoding: 'utf8' });
  assert.equal(result.status, 0, `Colab code does not parse: ${result.stderr}`);
});

test('Colab packs execute end to end when scikit-learn and XGBoost are installed', (t) => {
  if (py.status !== 0) {
    t.skip('python3 is not available');
    return;
  }
  const installed = spawnSync('python3', ['-c', 'import sklearn, xgboost'], { encoding: 'utf8' });
  if (installed.status !== 0) {
    t.skip('scikit-learn/xgboost are not installed locally; the pack syntax is still validated');
    return;
  }
  for (const pack of artifact.colabPacks) {
    const notebook = read(path.join(COLAB, pack.file));
    const code = codeCells(notebook).map(source).join('\n');
    const result = runCode(code, notebook.metadata.aiml.datasets, 240000);
    assert.equal(result.status, 0, `${pack.file}: end-to-end run failed\n${result.stderr}`);
  }
});

test('the offline worker seeds canonical data from the bundle, not a network fetch', () => {
  const worker = fs.readFileSync(path.join(ROOT, 'src', 'features', 'coding', 'pythonWorker.ts'), 'utf8');
  assert.match(worker, /ML_DATASETS/, 'pythonWorker must know the canonical ML files');
  assert.match(worker, /writeFile\(d\.file, d\.csv/, 'pythonWorker must write each canonical CSV into Pyodide FS');
  const notebookData = fs.readFileSync(path.join(ROOT, 'src', 'core', 'data', 'notebooks.ts'), 'utf8');
  assert.match(notebookData, /ML_DATASETS/, 'the notebook shelf must list canonical datasets');
  const generated = fs.readFileSync(path.join(ROOT, 'src', 'core', 'data', 'mlDatasets.ts'), 'utf8');
  assert.match(generated, /export const ML_DATASETS: MlDataset\[\]/);
  assert.match(generated, /csv: "/, 'the CSV payload must be bundled with the app');
  const sw = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
  assert.match(sw, /\/datasets/, 'the service worker must cache dataset downloads');
});
