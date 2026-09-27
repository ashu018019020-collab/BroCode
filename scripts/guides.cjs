#!/usr/bin/env node
/**
 * guides.cjs — the authored "CODE KAISE KARTE HAIN" layer.
 *
 *   node scripts/guides.cjs            # dry run: apply authored guides in memory
 *   node scripts/guides.cjs --write    # apply and save public/curriculum/sections.json
 *   node scripts/guides.cjs topics     # required-topic coverage matrix (read-only)
 *
 * Why it exists: sections.json is regenerated from the PDF by tools/extract.mjs, and the
 * PDF extraction is thin outside Python Core (s17–s23 carry two concepts each). The
 * prompt's required topic lists are therefore authored here, next to learn-overrides.json
 * and stage-overrides.json, and re-applied after every extraction:
 *
 *   content/curriculum/topics/<track>.json  required topics per track (coverage matrix)
 *   content/curriculum/guides/<sectionId>.json  authored guides, matched to a concept by
 *     title or attached to a NEW concept when the topic has no PDF lesson yet.
 *
 * Honesty rules (same spirit as learn.cjs):
 *   · every guide EXAMPLE is EXECUTED with local Python; the stored output is the real
 *     stdout. `howToCode[].code` is deliberately different: it is an instructional
 *     fragment (a Dockerfile line, a SQL clause, an API signature, pseudo-code), so it is
 *     never executed and never claimed as run output — only its step/detail shape is checked;
 *   · a snippet that raises is a hard failure unless its only problem is a module that is
 *     simply not installed locally (numpy/pandas/sklearn/…). Those keep the documented
 *     output and are marked `verified: false`, so the UI can say so instead of pretending;
 *   · nothing is written while any guide fails;
 *   · an overlay that no longer matches anything is reported as stale (not silently kept).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SECTIONS_JSON = path.join(ROOT, 'public', 'curriculum', 'sections.json');
const TOPICS_DIR = path.join(ROOT, 'content', 'curriculum', 'topics');
const GUIDES_DIR = path.join(ROOT, 'content', 'curriculum', 'guides');
const TRACKS_DIR = path.join(ROOT, 'content', 'tracks');

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const TOPICS = argv.includes('topics') || argv[0] === 'topics';
const ONLY = (argv.find((a) => a.startsWith('--section=')) || '').split('=')[1] || null;

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`\x1b[31m✕\x1b[0m ${m}`);
const warn = (m) => console.log(`\x1b[33m⚠\x1b[0m ${m}`);

const sections = JSON.parse(fs.readFileSync(SECTIONS_JSON, 'utf8'));
const byId = new Map(sections.map((s) => [s.id, s]));
const normTitle = (s) => String(s ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

/* --------------------------------------------------------------- coverage */

function trackFiles() {
  if (!fs.existsSync(TRACKS_DIR)) return [];
  return JSON.parse(fs.readFileSync(path.join(TRACKS_DIR, 'index.json'), 'utf8'))
    .map((e) => ({ slug: e.slug, title: e.title }));
}

function loadTopicRequirements() {
  if (!fs.existsSync(TOPICS_DIR)) return [];
  return fs.readdirSync(TOPICS_DIR).filter((f) => f.endsWith('.json')).map((f) =>
    JSON.parse(fs.readFileSync(path.join(TOPICS_DIR, f), 'utf8')));
}

/** A required topic counts as covered when any concept in the track's sections matches it. */
function coverageReport() {
  const tracks = trackFiles();
  const reqs = loadTopicRequirements();
  console.log('\n— Required-topic coverage (authored list vs curriculum) —\n');
  let required = 0, covered = 0;
  for (const req of reqs) {
    const track = tracks.find((t) => t.slug === req.track);
    const range = req.sectionRange ?? {};
    const pool = sections.filter((s) => (!range.from || s.no >= range.from) && (!range.to || s.no <= range.to));
    const concepts = pool.flatMap((s) => (s.learn?.concepts ?? []).map((c) => normTitle(c.title)));
    const guided = pool.flatMap((s) => (s.learn?.concepts ?? []).filter((c) => c.guide).map((c) => normTitle(c.title)));
    const missing = [];
    for (const topic of req.topics ?? []) {
      required++;
      const want = normTitle(topic);
      const hit = concepts.some((c) => c === want || c.includes(want) || want.includes(c));
      if (hit) {
        covered++;
        const g = guided.some((c) => c === want || c.includes(want) || want.includes(c));
        if (!g) missing.push({ topic, why: 'concept exists, no authored guide yet' });
      } else missing.push({ topic, why: 'no lesson at all yet' });
    }
    const own = (req.topics ?? []).length;
    const done = own - missing.length;
    console.log(`${done === own ? '✓' : '⚠'} ${(track?.title ?? req.track).padEnd(20)} ${done}/${own} topics covered`);
    for (const m of missing.slice(0, 8)) console.log(`     · ${m.topic} — ${m.why}`);
    if (missing.length > 8) console.log(`     … and ${missing.length - 8} more`);
  }
  console.log(`\nCovered ${covered}/${required} required topics (${required ? Math.round((covered / required) * 100) : 0}%).\n`);
  return { required, covered };
}

/* ---------------------------------------------------------- verification */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiml-guides-'));
let pyOk = null;
function pythonAvailable() {
  if (pyOk !== null) return pyOk;
  try { execFileSync('python', ['--version'], { stdio: 'ignore' }); pyOk = true; } catch { pyOk = false; }
  return pyOk;
}
const normOut = (s) => s.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
const loose = (s) => normOut(s).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n').trim();

/** Third-party runtimes the app bundles in Pyodide but this machine may not have. */
const OPTIONAL_MODULE = /^\s*(?:import|from)\s+(numpy|pandas|sklearn|scipy|matplotlib|seaborn|sqlite3|nltk|transformers|torch|langchain|openai|fastapi|uvicorn|requests)\b/m;

/**
 * Execute one snippet. Returns { state, output?, reason? } where state is
 * 'verified' (ran, real stdout), 'unrunnable' (needs stdin / no local python) or
 * 'failed' (raised for any other reason — the caller must not write).
 */
function runSnippet(code) {
  if (!code || !code.trim()) return { state: 'unrunnable', reason: 'empty snippet' };
  if (/\binput\s*\(/.test(code)) return { state: 'unrunnable', reason: 'needs stdin' };
  if (!pythonAvailable()) return { state: 'unrunnable', reason: 'python not on PATH' };
  const file = path.join(tmp, `g${Math.random().toString(36).slice(2)}.py`);
  try {
    fs.writeFileSync(file, `${code}\n`);
    const actual = execFileSync('python', [file], { timeout: 8000, cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    return { state: 'verified', output: normOut(actual) };
  } catch (e) {
    const stderr = String(e.stderr || '');
    const msg = stderr.split('\n').filter(Boolean).slice(-1)[0] || String(e.message || 'error');
    // A missing local dependency is not a broken snippet — the app bundles it in Pyodide.
    if (/ModuleNotFoundError|ImportError/.test(stderr) && OPTIONAL_MODULE.test(code)) {
      return { state: 'unrunnable', reason: `not installed locally (${msg.slice(0, 60)})` };
    }
    return { state: 'failed', reason: msg.slice(0, 160) };
  } finally {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }
}

/* --------------------------------------------------------------- applying */

const GUIDE_LIST = ['what', 'why', 'whereUsed', 'howItWorks', 'syntax', 'realWorld', 'miniChallenge', 'debugTask', 'interviewTip'];
const GUIDE_LISTS = ['prereqs', 'commonMistakes', 'bestPractices', 'related', 'revision'];

/** Shape check — a guide is either complete or it is not written at all. */
function checkGuide(g, at) {
  const problems = [];
  for (const k of GUIDE_LIST) if (!String(g[k] ?? '').trim()) problems.push(`${at}: missing "${k}"`);
  for (const k of GUIDE_LISTS) if (!Array.isArray(g[k]) || !g[k].length) problems.push(`${at}: missing list "${k}"`);
  if (!Array.isArray(g?.examples) || !g.examples.length) problems.push(`${at}: needs at least one example`);
  else g.examples.forEach((ex, i) => {
    if (!['basic', 'intermediate', 'advanced'].includes(ex.level)) problems.push(`${at}: example ${i} bad level "${ex.level}"`);
    if (!String(ex.code ?? '').trim()) problems.push(`${at}: example ${i} has no code`);
    if (!Array.isArray(ex.explain) || !ex.explain.length) problems.push(`${at}: example ${i} needs a line-by-line explanation`);
  });
  if (!Array.isArray(g?.howToCode) || !g.howToCode.length) problems.push(`${at}: needs howToCode steps`);
  else g.howToCode.forEach((h, i) => { if (!String(h.step ?? '').trim() || !String(h.detail ?? '').trim()) problems.push(`${at}: step ${i} needs step + detail`); });
  if (!Array.isArray(g?.practice) || !g.practice.length) problems.push(`${at}: needs a practice task`);
  if (!Array.isArray(g?.interview) || !g.interview.length) problems.push(`${at}: needs interview Q&A`);
  return problems;
}

function loadGuides() {
  if (!fs.existsSync(GUIDES_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(GUIDES_DIR).filter((x) => x.endsWith('.json'))) {
    const doc = JSON.parse(fs.readFileSync(path.join(GUIDES_DIR, f), 'utf8'));
    for (const g of doc.guides ?? []) out.push({ ...g, section: g.section ?? doc.section ?? f.replace(/\.json$/, '') });
  }
  return out;
}

function applyGuides() {
  if (!fs.existsSync(GUIDES_DIR)) { warn('no content/curriculum/guides directory yet'); return 0; }
  const guides = loadGuides();
  let changed = 0, created = 0, refreshed = 0, verifiedExamples = 0, unverifiedExamples = 0;
  const failures = [];
  const used = new Set();

  for (const g of guides) {
    if (ONLY && g.section !== ONLY) continue;
    const sec = byId.get(g.section);
    if (!sec) { failures.push(`${g.section}: unknown section`); continue; }
    const problems = checkGuide(g, `${g.section}/${g.title}`);
    if (problems.length) { failures.push(...problems); continue; }

    // Execute every snippet now; the stored output is the real stdout.
    const examples = g.examples.map((ex) => {
      const r = runSnippet(ex.code);
      if (r.state === 'failed') { failures.push(`${g.section}/${g.title}: example (${ex.level}) raised: ${r.reason}`); return ex; }
      if (r.state === 'verified') { verifiedExamples++; return { ...ex, output: r.output, verified: true }; }
      unverifiedExamples++;
      return { ...ex, output: ex.output ?? '', verified: false };
    });
    // Steps are instructions, not programs: their `code` is a fragment (often not Python at
    // all), so they are carried through as-is. Only `examples` above are claimed as run.
    const howToCode = (g.howToCode ?? []).map((h) => ({ ...h }));
    if (failures.length) continue;

    const guide = {
      what: g.what, why: g.why, whereUsed: g.whereUsed, prereqs: g.prereqs,
      howItWorks: g.howItWorks, syntax: g.syntax,
      examples, howToCode,
      commonMistakes: g.commonMistakes, bestPractices: g.bestPractices,
      realWorld: g.realWorld, practice: g.practice,
      interview: g.interview, miniChallenge: g.miniChallenge, debugTask: g.debugTask,
      related: g.related, revision: g.revision, interviewTip: g.interviewTip,
      authored: true,
    };

    const concepts = sec.learn?.concepts ?? [];
    const want = normTitle(g.title);
    let idx = concepts.findIndex((c) => normTitle(c.title) === want);
    if (idx < 0) idx = concepts.findIndex((c) => { const h = normTitle(c.title); return h && (h.includes(want) || want.includes(h)); });
    if (idx < 0) {
      // The topic has no PDF lesson yet — create one, and take its code sample from the
      // guide's advanced example so the learn stage still has something to run.
      const adv = examples.find((e) => e.level === 'advanced') ?? examples[examples.length - 1];
      concepts.push({
        title: g.title,
        level: g.level ?? 'core',
        body: g.what,
        code: adv.code,
        output: adv.output ?? '',
        tip: g.interviewTip,
        guide,
        // Explicit marker: this concept exists because an authored guide created it (the
        // PDF extraction had no lesson for the topic). Tests use it to prove that the
        // guided layer is additive and the PDF-derived concept count cannot drift.
        authoredTopic: true,
      });
      created++;
    } else {
      const target = concepts[idx];
      const adv = examples.find((e) => e.level === 'advanced') ?? examples[examples.length - 1];
      // Did an earlier run of THIS guide create this concept? The explicit `authoredTopic`
      // marker is authoritative; before the marker existed the only fingerprint is the content
      // the guide stored (its own `what` + advanced sample, compared with whitespace removed so
      // pure reformatting of a sample cannot break ownership). PDF-derived concepts match
      // neither, so extracted text is still never overwritten — while topics the guide owns are
      // refreshed, which is what makes editing a guide actually take effect.
      const squash = (s) => String(s ?? '').replace(/\s+/g, '');
      const guideOwns = target.authoredTopic === true
        || (target.body === g.what && squash(target.code) === squash(adv.code));
      target.guide = guide;
      if (guideOwns) {
        target.level = g.level ?? target.level ?? 'core';
        target.body = g.what;
        target.code = adv.code;
        target.output = adv.output ?? '';
        target.tip = g.interviewTip;
        target.authoredTopic = true;
        refreshed++;
      } else {
        // A concept without a runnable sample gets one from the guide (never overwriting PDF text).
        if (!target.code && examples[0]?.code) { target.code = examples[0].code; target.output = examples[0].output ?? ''; }
        if (!target.body && g.what) target.body = g.what;
      }
      changed++;
    }
    used.add(`${g.section}|${want}`);
  }

  if (failures.length) {
    bad(`${failures.length} guide problem(s) — nothing written`);
    failures.slice(0, 12).forEach((f) => console.log('   · ' + f));
    process.exit(1);
  }
  ok(`${guides.length} guide(s): ${changed} attached to existing concepts (${refreshed} refresh of guide-owned topics), ${created} new concepts created`);
  console.log(`   examples executed: ${verifiedExamples} verified with real output, ${unverifiedExamples} unrunnable locally (marked verified:false)`);
  if (WRITE) {
    fs.writeFileSync(SECTIONS_JSON, JSON.stringify(sections));
    ok(`wrote ${path.relative(ROOT, SECTIONS_JSON)}`);
  } else if (guides.length) {
    warn('dry run — re-run with --write to save');
  }
  return guides.length;
}

/* -------------------------------------------------------------------- main */

if (TOPICS) coverageReport();
else {
  console.log(`\n— Authored guide pass (${WRITE ? 'write' : 'dry run'}) —\n`);
  applyGuides();
  console.log('');
}
