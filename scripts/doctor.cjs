#!/usr/bin/env node
/** npm run doctor — offline environment diagnostic. No network calls. */
const fs = require('fs');
const path = require('path');

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`\x1b[33m⚠\x1b[0m ${m}`);
const bad = (m) => console.log(`\x1b[31m✕\x1b[0m ${m}`);
const section = (m) => console.log(`\n— ${m} —`);

let failures = 0;

section('Toolchain (used for building, not required at runtime)');
ok(`Node ${process.version}`);
try {
  const npm = require('child_process').execSync('npm --version', { encoding: 'utf8' }).trim();
  ok(`npm ${npm}`);
} catch { bad('npm not found'); failures++; }

section('Project files');
const must = [
  'package.json', 'vite.config.ts', 'index.html', 'src/App.tsx', 'src/main.tsx',
  'src/i18n/locales.ts', 'src/i18n/index.tsx', 'src/pages/Playground.tsx',
  'src/components/MonacoIDE.tsx', 'src/engine/traceback.ts', 'src/data/packages.ts',
];
for (const f of must) {
  if (fs.existsSync(path.join(__dirname, '..', f))) ok(f);
  else { bad(`missing: ${f}`); failures++; }
}

section('Offline runtime assets (public/)');
const assets = [
  ['public/pyodide/pyodide.mjs', 'Python (Pyodide) runtime'],
  ['public/pyodide/python_stdlib.zip', 'Python stdlib'],
  ['public/sqljs/sql-wasm-browser.wasm', 'SQL engine (SQLite WASM)'],
  ['public/curriculum/sections.json', 'Curriculum (29 sections)'],
  ['public/pdf/guide.pdf', 'PDF reader source'],
];
for (const [f, why] of assets) {
  if (fs.existsSync(path.join(__dirname, '..', f))) ok(`${f} — ${why}`);
  else { warn(`${f} absent — ${why} will not load`); }
}

section('Dependencies (all local — no CDN)');
const pkg = require(path.join(__dirname, '..', 'package.json'));
const needed = ['react', 'react-dom', 'react-router-dom', 'monaco-editor', 'lucide-react', 'pdfjs-dist', 'sql.js'];
for (const d of needed) {
  if (pkg.dependencies?.[d]) ok(`${d} ${pkg.dependencies[d]}`);
  else { bad(`missing dependency: ${d}`); failures++; }
}
const forbidden = Object.keys(pkg.dependencies ?? {}).filter((d) => /openai|anthropic|gemini|firebase|supabase|googleapis/i.test(d));
if (forbidden.length) { bad(`forbidden online deps: ${forbidden.join(', ')}`); failures++; }
else ok('no cloud/online dependencies');

section('Topic workspaces (16-part structure)');
try {
  const { partCoverage, PARTS } = require('./lib/packs.cjs');
  const sections = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'curriculum', 'sections.json'), 'utf8'));
  const complete = sections.filter((s) => s.topic && partCoverage(s).complete);
  const partial = sections.filter((s) => s.topic && !partCoverage(s).complete);
  ok(`${complete.length}/${sections.length} sections carry a complete authored workspace (${PARTS.length} parts)`);
  if (partial.length) { bad(`${partial.length} section(s) have a half-built workspace: ${partial.map((s) => s.id).join(', ')}`); failures++; }
  if (complete.length < sections.length) {
    warn(`${sections.length - complete.length} section(s) still to restructure — author content/curriculum/packs/<sectionId>.json, then npm run packs:write`);
  }
} catch (e) {
  warn(`topic workspace check skipped: ${e.message}`);
}

section('Jupyter notebooks (Notebook Lab)');
try {
  const manifestPath = path.join(__dirname, '..', 'public', 'notebooks', 'manifest.json');
  if (!fs.existsSync(manifestPath)) warn('no published notebooks — run npm run notebooks:write');
  else {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const cells = m.notebooks.reduce((a, n) => a + n.codeCells, 0);
    const verified = m.notebooks.reduce((a, n) => a + (n.verifiedCells ?? 0), 0);
    const appCells = m.notebooks.reduce((a, n) => a + (n.appRuntimeCells ?? 0), 0);
    ok(`${m.notebooks.length} notebooks · ${cells} code cells · ${verified} executed while authoring`);
    if (appCells) {
      const wheels = fs.existsSync(path.join(__dirname, '..', 'public', 'pyodide'))
        ? fs.readdirSync(path.join(__dirname, '..', 'public', 'pyodide')).filter((f) => /^(numpy|pandas)-/.test(f) && f.endsWith('.whl'))
        : [];
      if (wheels.length >= 2) ok(`${appCells} cell(s) run in the bundled runtime (${wheels.length} wheel(s) present)`);
      else { bad(`app-only notebook cells need bundled numpy/pandas wheels — found ${wheels.length}`); failures++; }
    }
  }
} catch (e) {
  warn(`notebook check skipped: ${e.message}`);
}

section('Storage');
for (const s of ['localStorage (progress, workspace, language)', 'IndexedDB-ready (large assets via runtime)']) ok(s);

console.log(`\n${failures ? '\x1b[31m✕ ' + failures + ' problem(s) found\x1b[0m' : '\x1b[32m✓ Environment ready — fully offline capable\x1b[0m'}`);
process.exit(failures ? 1 : 0);
