#!/usr/bin/env node
/**
 * ml-datasets.cjs — canonical ML datasets, bundled for the offline runtime.
 *
 * Source of truth: `content/datasets/ml/<name>.csv` plus `datasets.json`. The pass validates
 * every file (header, row count, finite values, class labels), then writes:
 *
 *   · public/datasets/ml/*.csv  — same-origin downloads for the course and Colab packs
 *   · public/datasets/ml/manifest.json — row/column counts, source, licence and SHA-256
 *   · src/core/data/mlDatasets.ts — the raw CSV strings the Pyodide worker seeds into its FS
 *
 * The generated TS module is what makes `np.genfromtxt('iris.csv')` work offline: the data is
 * already inside the bundle, so the browser never fetches a dataset at run time.
 *
 * Dry run by default; `--write` publishes; `check` compares without writing.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'datasets', 'ml');
const OUT = path.join(ROOT, 'public', 'datasets', 'ml');
const TS = path.join(ROOT, 'src', 'core', 'data', 'mlDatasets.ts');
const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('check');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const fail = (problems) => {
  console.error(`ml-datasets: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
};

function parseCsv(text, at, problems) {
  const lines = text.replace(/\r/g, '').trimEnd().split('\n');
  if (lines.length < 2) {
    problems.push(`${at}: expected a header and data rows`);
    return { columns: [], rows: [] };
  }
  const columns = lines[0].split(',');
  if (new Set(columns).size !== columns.length) problems.push(`${at}: duplicate column names`);
  const rows = lines.slice(1).map((line, index) => {
    const values = line.split(',');
    if (values.length !== columns.length) problems.push(`${at}: row ${index + 1} has ${values.length} values, expected ${columns.length}`);
    for (const value of values) {
      if (!value.trim() || !Number.isFinite(Number(value))) problems.push(`${at}: row ${index + 1} has a non-numeric or empty value "${value}"`);
    }
    return values;
  });
  return { columns, rows };
}

function build() {
  const problems = [];
  const metaPath = path.join(SRC, 'datasets.json');
  if (!fs.existsSync(metaPath)) fail([`missing ${path.relative(ROOT, metaPath)}`]);
  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (!Array.isArray(metadata) || metadata.length < 4) problems.push('datasets.json must describe at least four datasets');

  const ids = new Set();
  const files = new Set();
  const output = [];
  for (const entry of metadata) {
    const at = entry.id || 'dataset';
    if (!entry.id || !entry.file || !entry.title || !entry.description) problems.push(`${at}: id, file, title and description are required`);
    if (!entry.source || !entry.license) problems.push(`${at}: source and licence are required`);
    if (!['classification', 'regression'].includes(entry.task)) problems.push(`${at}: task must be classification or regression`);
    if (ids.has(entry.id)) problems.push(`${at}: duplicate id`);
    if (files.has(entry.file)) problems.push(`${at}: duplicate file name`);
    ids.add(entry.id);
    files.add(entry.file);

    const filePath = path.join(SRC, entry.file);
    if (!fs.existsSync(filePath)) { problems.push(`${at}: ${entry.file} is missing`); continue; }
    const csv = fs.readFileSync(filePath, 'utf8').replace(/\r/g, '');
    const { columns, rows } = parseCsv(csv, at, problems);
    if (!columns.includes(entry.target)) problems.push(`${at}: target "${entry.target}" is not a column`);
    if (rows.length < 100) problems.push(`${at}: expected a canonical dataset with at least 100 rows`);

    if (entry.task === 'classification') {
      if (!Array.isArray(entry.classes) || entry.classes.length < 2) problems.push(`${at}: classification needs class names`);
      const targetIndex = columns.indexOf(entry.target);
      const labels = [...new Set(rows.map((row) => row[targetIndex]))].sort();
      const expected = entry.classes.map((_, index) => String(index)).sort();
      if (JSON.stringify(labels) !== JSON.stringify(expected)) problems.push(`${at}: labels must be 0..${entry.classes.length - 1}, found ${labels.join(', ')}`);
    } else {
      const targetIndex = columns.indexOf(entry.target);
      if (!rows.every((row) => Number.isFinite(Number(row[targetIndex])))) problems.push(`${at}: regression target must be numeric`);
    }

    output.push({
      ...entry,
      columns,
      rows: rows.length,
      featureCount: columns.length - 1,
      bytes: Buffer.byteLength(csv),
      sha256: sha256(csv),
      csv,
    });
  }

  return { metadata, output, problems };
}

function renderTs(datasets) {
  const entries = datasets.map((dataset) => `  {
    id: ${JSON.stringify(dataset.id)},
    file: ${JSON.stringify(dataset.file)},
    title: ${JSON.stringify(dataset.title)},
    task: ${JSON.stringify(dataset.task)},
    target: ${JSON.stringify(dataset.target)},
    classes: ${JSON.stringify(dataset.classes)},
    description: ${JSON.stringify(dataset.description)},
    source: ${JSON.stringify(dataset.source)},
    license: ${JSON.stringify(dataset.license)},
    columns: ${JSON.stringify(dataset.columns)},
    rows: ${dataset.rows},
    featureCount: ${dataset.featureCount},
    sha256: ${JSON.stringify(dataset.sha256)},
    csv: ${JSON.stringify(dataset.csv)},
  },`).join('\n');
  return `/**
 * Generated by scripts/ml-datasets.cjs — do not edit by hand.
 *
 * The canonical ML datasets are bundled as raw CSV strings so the offline Pyodide worker can
 * seed them into its virtual filesystem. The matching downloads and manifest live in
 * public/datasets/ml/. Run \`npm run ml:datasets:write\` after changing content/datasets/ml.
 */
export interface MlDataset {
  id: string;
  file: string;
  title: string;
  task: 'classification' | 'regression';
  target: string;
  classes: string[];
  description: string;
  source: string;
  license: string;
  columns: string[];
  rows: number;
  featureCount: number;
  sha256: string;
  csv: string;
}

export const ML_DATASETS: MlDataset[] = [
${entries}
];
`;
}

/** `generated` is a publication timestamp, not content; ignore it when checking freshness. */
function comparableManifest(text) {
  try {
    const parsed = JSON.parse(text);
    delete parsed.generated;
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

function renderManifest(datasets) {
  return `${JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    note: 'Canonical datasets from the scikit-learn distribution (BSD-3-Clause); see each source and licence. Bundled for offline use.',
    datasets: datasets.map(({ csv, ...rest }) => rest),
  }, null, 2)}\n`;
}

function main() {
  const { output, problems } = build();
  if (problems.length) fail(problems);
  const ts = renderTs(output);
  const manifest = renderManifest(output);

  if (CHECK) {
    const stale = [];
    if (!fs.existsSync(TS) || fs.readFileSync(TS, 'utf8') !== ts) stale.push('src/core/data/mlDatasets.ts');
    const manifestPath = path.join(OUT, 'manifest.json');
    if (!fs.existsSync(manifestPath) || comparableManifest(fs.readFileSync(manifestPath, 'utf8')) !== comparableManifest(manifest)) stale.push('public/datasets/ml/manifest.json');
    for (const dataset of output) {
      const dest = path.join(OUT, dataset.file);
      if (!fs.existsSync(dest) || fs.readFileSync(dest, 'utf8') !== dataset.csv) stale.push(`public/datasets/ml/${dataset.file}`);
    }
    if (stale.length) fail(stale.map((file) => `${file} is stale — run npm run ml:datasets:write`));
    console.log(`ml-datasets: valid — ${output.length} canonical datasets, generated copies match`);
    return;
  }

  if (WRITE) {
    fs.mkdirSync(OUT, { recursive: true });
    for (const dataset of output) fs.writeFileSync(path.join(OUT, dataset.file), dataset.csv);
    fs.writeFileSync(path.join(OUT, 'manifest.json'), manifest);
    fs.writeFileSync(TS, ts);
    console.log(`ml-datasets: published ${output.length} datasets → public/datasets/ml/ and src/core/data/mlDatasets.ts`);
    for (const dataset of output) {
      console.log(`  · ${dataset.id}: ${dataset.rows} rows × ${dataset.featureCount} features (${dataset.task})`);
    }
    return;
  }

  console.log(`ml-datasets: valid — ${output.length} canonical datasets (dry run; --write to publish)`);
  for (const dataset of output) console.log(`  · ${dataset.id}: ${dataset.rows} rows × ${dataset.featureCount} features`);
}

main();
