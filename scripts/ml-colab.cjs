#!/usr/bin/env node
/**
 * ml-colab.cjs — publish the scikit-learn / XGBoost Colab notebook packs.
 *
 * These notebooks are deliberately NOT part of `public/notebooks`: the offline Code Bro kernel
 * ships NumPy/Pandas only, and a cell importing sklearn must never be offered as runnable there.
 * The packs live in `content/colab-ml/`, are validated here, and are published as downloadable
 * `.ipynb` files under `public/colab-ml/`. The ML course links to them as "Colab / local" work.
 *
 * The generator validates structure and provenance; `scripts/tests/ml-labs.test.mjs` checks that
 * every code cell parses and, when the libraries are installed, executes the packs end to end.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'colab-ml');
const OUT = path.join(ROOT, 'public', 'colab-ml');
const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('check');

const fail = (problems) => {
  console.error(`ml-colab: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
};

const text = (cell) => (Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? ''));

function validate(file, nb) {
  const problems = [];
  const at = file;
  if (nb?.nbformat !== 4) problems.push(`${at}: nbformat must be 4`);
  if (!Array.isArray(nb?.cells) || !nb.cells.length) problems.push(`${at}: no cells`);
  const meta = nb?.metadata?.aiml ?? {};
  for (const key of ['title', 'topic', 'level', 'intro']) if (!meta[key]) problems.push(`${at}: metadata.aiml.${key} is required`);
  if (meta.runtime !== 'colab') problems.push(`${at}: metadata.aiml.runtime must be "colab"`);
  if (!Array.isArray(meta.datasets) || !meta.datasets.length) problems.push(`${at}: name the canonical dataset(s)`);
  if (!Array.isArray(meta.requirements) || !meta.requirements.length) problems.push(`${at}: name pinned requirement(s)`);
  const requirements = meta.requirements ?? [];
  if (!requirements.some((r) => /^scikit-learn==\d/.test(r))) problems.push(`${at}: pin scikit-learn==<version>`);
  if (!requirements.some((r) => /^xgboost==\d/.test(r))) problems.push(`${at}: pin xgboost==<version>`);

  const ids = new Set();
  let codeCells = 0;
  let installCells = 0;
  for (const [index, cell] of (nb?.cells ?? []).entries()) {
    if (!Array.isArray(cell.source) || !cell.source.length) problems.push(`${at}: cell ${index} has no source`);
    if (ids.has(cell.id)) problems.push(`${at}: duplicate cell id ${cell.id}`);
    ids.add(cell.id);
    if (!['markdown', 'code'].includes(cell.cell_type)) problems.push(`${at}: cell ${index} bad type`);
    if (cell.cell_type !== 'code') continue;
    codeCells += 1;
    const code = text(cell);
    if (/fetch_openml|read_csv\s*\(\s*['"]https?:/.test(code)) problems.push(`${at}: cell ${cell.id} downloads a dataset; use a canonical load_* function`);
    if (/subprocess\.check_call/.test(code) && /scikit-learn==\d/.test(code) && /xgboost==\d/.test(code)) installCells += 1;
  }
  if (!codeCells) problems.push(`${at}: needs at least one code cell`);
  if (!installCells) problems.push(`${at}: needs an install cell with pinned packages`);
  return problems;
}

function load() {
  if (!fs.existsSync(SRC)) return [];
  return fs.readdirSync(SRC).filter((file) => file.endsWith('.ipynb')).sort().map((file) => ({
    file,
    nb: JSON.parse(fs.readFileSync(path.join(SRC, file), 'utf8')),
  }));
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

/** A Windows checkout writes CRLF; generated content is compared by text, not by its line endings. */
const normalizeEol = (text) => String(text).replace(/\r\n?/g, '\n');

function main() {
  const notebooks = load();
  if (!notebooks.length) fail(['no packs in content/colab-ml']);
  const problems = [];
  const manifest = [];
  for (const { file, nb } of notebooks) {
    problems.push(...validate(file, nb));
    const codeCells = nb.cells.filter((cell) => cell.cell_type === 'code').length;
    manifest.push({
      file,
      title: nb.metadata.aiml.title,
      topic: nb.metadata.aiml.topic,
      level: nb.metadata.aiml.level,
      runtime: 'colab',
      datasets: nb.metadata.aiml.datasets,
      requirements: nb.metadata.aiml.requirements,
      cells: nb.cells.length,
      codeCells,
      intro: nb.metadata.aiml.intro,
      source: `content/colab-ml/${file}`,
    });
  }
  if (problems.length) fail(problems);

  const payload = JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    note: 'Download and open in Google Colab or a local Jupyter environment. These packs are online/local only; the app kernel never downloads them.',
    notebooks: manifest,
  }, null, 2) + '\n';

  if (CHECK) {
    const stale = [];
    const manifestPath = path.join(OUT, 'manifest.json');
    if (!fs.existsSync(manifestPath) || comparableManifest(fs.readFileSync(manifestPath, 'utf8')) !== comparableManifest(payload)) stale.push('public/colab-ml/manifest.json');
    for (const { file, nb } of notebooks) {
      const dest = path.join(OUT, file);
      if (!fs.existsSync(dest) || normalizeEol(fs.readFileSync(dest, 'utf8')) !== normalizeEol(JSON.stringify(nb, null, 1) + '\n')) stale.push(`public/colab-ml/${file}`);
    }
    if (stale.length) fail(stale.map((file) => `${file} is stale — run npm run ml:colab:write`));
    console.log(`ml-colab: valid — ${notebooks.length} packs, published copies match`);
    return;
  }

  if (WRITE) {
    fs.mkdirSync(OUT, { recursive: true });
    for (const { file, nb } of notebooks) fs.writeFileSync(path.join(OUT, file), JSON.stringify(nb, null, 1) + '\n');
    fs.writeFileSync(path.join(OUT, 'manifest.json'), payload);
    console.log(`ml-colab: published ${notebooks.length} packs → public/colab-ml/`);
    for (const entry of manifest) console.log(`  · ${entry.file}: ${entry.codeCells} code cells`);
  } else {
    console.log(`ml-colab: valid — ${notebooks.length} packs (dry run; --write to publish)`);
  }
}

main();
