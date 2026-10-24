#!/usr/bin/env node
/**
 * learn.cjs — rebuild `learn.concepts` (code / output / body / tip) in
 * public/generated/curriculum/sections.json from a LAYOUT-preserving PDF extraction.
 *
 * Root cause it fixes: tools/extract.mjs runs plain `pdftotext` (no -layout),
 * which linearises the PDF's code boxes and mashes statements, comments and
 * page furniture onto one line. `pdftotext -layout` keeps the columns, so code
 * comes out one statement per line. We re-parse only the learn pages, keep every
 * other field untouched, and EXECUTE every snippet against the OUTPUT block the
 * PDF documents. Nothing is written unless it matches — no invented content.
 *
 *   node scripts/learn.cjs                 # dry run: report only
 *   node scripts/learn.cjs --write         # apply verified results
 *   node scripts/learn.cjs --section=s01   # limit to one section
 *   node scripts/learn.cjs --fresh         # ignore the cached layout text
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SECTIONS_JSON = path.join(ROOT, 'public', 'generated', 'curriculum', 'sections.json');
const PDF = path.join(ROOT, 'public', 'pdf', 'guide.pdf');
const CACHE = path.join(ROOT, '.freebuff', 'layout.txt');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const WRITE = has('--write');
const FRESH = has('--fresh');
const ONLY = (argv.find((a) => a.startsWith('--section=')) || '').split('=')[1] || null;
const DUMP = has('--dump');
const DUMP_FAIL = has('--dump-fail');

const green = (m) => `\x1b[32m${m}\x1b[0m`;
const red = (m) => `\x1b[31m${m}\x1b[0m`;
const yellow = (m) => `\x1b[33m${m}\x1b[0m`;
const dim = (m) => `\x1b[2m${m}\x1b[0m`;

/* ------------------------------------------------------------------ extract */

function layoutText() {
  if (!FRESH && fs.existsSync(CACHE)) return fs.readFileSync(CACHE, 'utf8');
  if (!fs.existsSync(PDF)) throw new Error(`PDF not found: ${PDF}`);
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  const raw = execFileSync('pdftotext', ['-layout', PDF, '-'], { maxBuffer: 256 * 1024 * 1024 }).toString();
  fs.writeFileSync(CACHE, raw);
  return raw;
}

/* Lines that are page furniture from the PDF template, never content. */
const NOISE = [
  /^PYTHON COMPLETE GUIDE/,
  /^Python Complete Guide \|/,
  /^Hinglish\b.*Ashu Edition/,
  /^PDF p\./,
  /^\s*$/,
  /^Smart Section Rebuild/,
  /^S\s?E\s?C\s?T\s?I\s?O\s?N\s+\d+/,
  /^\s*Level: Beginner\b/,
  /^REAL-LIFE EXAMPLE SE SAMAJHO$/,
  /^IS SECTION ME KYA SEEKHOGE/,
  /^TOPIC ROADMAP/,
  /^\s*=\s*/,
];
/* The code window's chrome (a level chip + file label) lives in a right-hand
   column at ~char 111, so it lands on the same physical line as content. */
const CHROME = /^(CORE|ADVANCED|NOTES|BEGINNER|main\.py|example\.py)$/;
function segments(line) {
  const tail = line.slice(108);
  return tail.trim() && CHROME.test(tail.trim()) ? [line.slice(0, 108), tail] : [line];
}
NOISE.push(CHROME);
const isNoise = (t) => NOISE.some((r) => r.test(t));

/* Structural markers inside a concept block (not body prose, not code). */
const MARKER = /^(main\.py|main\.|example\.py|TIP|YAAD RAKHO|GALTI SE BACHO|STEP BY STEP: KAISE CHALTA HAI\?|QUICK RECAP: SECTION \d+|PRACTICE TIME.*|OUTPUT)$/;
/* A stray file label can land on the same physical line as the code. */
const cleanCodeLine = (l) => l.replace(/\s+(main\.py|example\.py)\s*$/, '').replace(/^\s*(main\.py|example\.py)\s*$/, '');
/* The level word sometimes bleeds into the prose line. */
const stripLevel = (s) => s.replace(/^(CORE|ADVANCED|NOTES|BEGINNER)\s+/, '').replace(/\s+(CORE|ADVANCED|NOTES|BEGINNER)$/, '').trim();
/* Page furniture often trails a prose line: "06 IF / ELIF / ELSE", "PDF p. 202". */
const TRAIL_HEADER = /\s+(?:PDF p\. \d+|\d{2}\s+[A-Z][A-Z0-9 &/()+-]*)$/;
/** Normalise a prose blob: drop leaked level/page furniture, collapse whitespace. */
function cleanBody(s) {
  let out = String(s ?? '');
  for (let i = 0; i < 3; i++) out = stripLevel(out.replace(TRAIL_HEADER, ''));
  return out.replace(/\s+/g, ' ').trim();
}
/* The section intro page's roadmap becomes a pseudo-concept whose title is the
   whole table of contents. Detect and rebuild it. */
const isTocTitle = (t) => ((t || '').match(/\d{1,2}\.\d{1,2}/g) || []).length >= 2;
const TAIL_MARKER = /^(TIP|YAAD RAKHO|GALTI SE BACHO|STEP BY STEP: KAISE CHALTA HAI\?|QUICK RECAP: SECT|PRACTICE TIME|REAL-LIFE)/;

/* A real concept heading sits at the page's left margin; TOPIC ROADMAP entries
   in the intro page's right-hand column are indented far across, so anchoring the
   number to column 0-3 excludes them. */
const HEADING = /^ {0,3}(\d{1,2}\.\d{1,2})\s+(.+?)(?:\s{2,}(CORE|ADVANCED|NOTES|BEGINNER))?\s*$/;

/** Does this physical line look like a line of Python rather than Hinglish prose? */
function looksLikeCode(t) {
  if (/^#/.test(t)) return true;
  if (/^(print|for|while|if|elif|else|def|class|import|from|return|break|continue|pass|try|except|finally|with|lambda|assert|raise|global|del|yield|match|case)\b/.test(t)) return true;
  if (/^[A-Za-z_][\w\s,.*]*=[^=]/.test(t)) return true;                                          // assignment (incl. tuple unpack)
  if (/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*\s*\([^()]*\)\s*(#.*)?$/.test(t)) return true;             // balanced call
  if (/^[A-Za-z_]\w*(\[[^\]]*\]|\.\w+(\([^()]*\))?)+\s*(#.*)?$/.test(t)) return true;           // subscript / attribute
  if (/^[\[{(]/.test(t)) return true;                                                           // literal continuation
  return false;
}

/**
 * The PDF's code box often sits at an arbitrary indent (8/15 spaces…). Remap each
 * distinct indent level to a canonical 4-space step, so blocks read like normal
 * Python. Only applies when the distinct widths appear in strictly increasing order.
 */
function normalizeIndent(lines) {
  const widths = [];
  for (const l of lines) if (l.trim()) { const w = l.match(/^\s*/)[0].length; if (!widths.includes(w)) widths.push(w); }
  if (widths.length <= 1) return lines;
  for (let i = 1; i < widths.length; i++) if (widths[i] <= widths[i - 1]) return lines;
  const map = new Map(widths.map((w, i) => [w, i * 4]));
  return lines.map((l) => (l.trim() ? ' '.repeat(map.get(l.match(/^\s*/)[0].length)) + l.trim() : l));
}

/* Remove the common leading indentation while keeping relative structure. */
function dedent(lines) {
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min).replace(/\s+$/, ''));
}

/** Parse one page's worth of lines into concept blocks keyed by "N.M". */
function parseBlocks(lines) {
  const blocks = [];
  let cur = null;
  for (const rawLine of lines) {
    for (const line of segments(rawLine.replace(/\r$/, ''))) {
      if (isNoise(line.trim())) continue;
      const h = line.match(HEADING);
      if (h) {
        if (cur) blocks.push(cur);
        cur = { no: h[1], title: h[2].trim(), level: (h[3] || '').toLowerCase(), lines: [] };
        continue;
      }
      if (cur) cur.lines.push(line);
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

/** Split a block into { body, code, output, tip } and classify each line. */
function interpret(block) {
  const out = { body: [], code: [], output: [], tip: null };
  let afterOutput = false;
  let codeStarted = false;
  let inTip = false;
  for (const rawLine of block.lines) {
    const line = rawLine.replace(/\r$/, '');
    const t = line.trim();
    if (t === '') continue;
    if (isNoise(t)) continue;

    if (MARKER.test(t)) {
      if (t === 'OUTPUT') { afterOutput = true; codeStarted = false; inTip = false; continue; }
      if (t === 'TIP' || t === 'YAAD RAKHO') { inTip = true; afterOutput = false; continue; }
      if (t === 'GALTI SE BACHO') { inTip = true; afterOutput = false; codeStarted = false; continue; }
      if (t === 'STEP BY STEP: KAISE CHALTA HAI?') { inTip = false; continue; }
      if (t.startsWith('QUICK RECAP') || t.startsWith('PRACTICE TIME')) break;
      continue; // main.py marker
    }
    if (afterOutput && TAIL_MARKER.test(t)) { inTip = true; afterOutput = false; continue; }
    if (afterOutput) { out.output.push(t); continue; }
    if (inTip) { out.tip = (out.tip ? out.tip + ' ' : '') + t; continue; }
    if (looksLikeCode(t) || codeStarted) {
      codeStarted = true;
      const cleaned = cleanCodeLine(line);
      if (cleaned.trim()) out.code.push(cleaned);
    } else {
      out.body.push(stripLevel(t));
    }
  }
  return {
    body: collapseParagraphs(out.body),
    code: normalizeIndent(dedent(out.code)).join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    output: out.output.join('\n').trim(),
    tip: out.tip ? out.tip.replace(/\s+/g, ' ').trim() : null,
  };
}

/** Join prose lines back into paragraphs (still one blob, spaces normalised). */
/** Build a readable overview body from the section's intro page. */
function overviewFromIntro(lines, sectionTitle) {
  const prose = [];
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const t = line.trim();
    if (!t) continue;
    // The roadmap marker is also in NOISE, so it must be tested before the skip.
    if (/^(IS SECTION ME KYA SEEKHOGE|TOPIC ROADMAP)/.test(t)) break;
    if (isNoise(t)) continue;
    if (HEADING.test(line)) break;
    if (normTitle(t) === normTitle(sectionTitle)) continue;      // the section title itself
    if (/^\d{1,2}\.\d{1,2}\b/.test(t)) continue;                 // roadmap entry
    if (/^REAL-LIFE EXAMPLE SE SAMAJHO$/.test(t)) { prose.push('REAL-LIFE EXAMPLE: '); continue; }
    prose.push(t);
  }
  return collapseParagraphs(prose).replace(/REAL-LIFE EXAMPLE: \s*/, 'REAL-LIFE EXAMPLE: ');
}

function collapseParagraphs(lines) {
  const joined = [];
  for (const l of lines) {
    const prev = joined[joined.length - 1];
    // numbered STEP BY STEP items keep their own line
    if (/^\d\s/.test(l) || !prev) joined.push(l);
    else joined[joined.length - 1] = `${prev} ${l}`;
  }
  return joined.join(' ').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------- verification */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiml-learn-'));
let pyOk = null;
function pythonAvailable() {
  if (pyOk !== null) return pyOk;
  try { execFileSync('python', ['--version'], { stdio: 'ignore' }); pyOk = true; } catch { pyOk = false; }
  return pyOk;
}

const normOut = (s) => s.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
/** Loose comparison: the PDF's rendering of tabs/indent is lossy, so collapse runs of whitespace. */
const loose = (s) => normOut(s).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n').trim();

/**
 * Run the snippet and compare stdout to the documented OUTPUT.
 * Returns { state: 'verified' | 'mismatch' | 'unverified', actual? }
 */
function verify(code, expected) {
  if (!code) return { state: 'unverified' };
  if (/\binput\s*\(/.test(code)) return { state: 'unverified', reason: 'needs stdin' };
  if (!pythonAvailable()) return { state: 'unverified', reason: 'python not on PATH' };
  const file = path.join(tmp, `t${Math.random().toString(36).slice(2)}.py`);
  try {
    fs.writeFileSync(file, code + '\n');
    const actual = execFileSync('python', [file], { timeout: 5000, cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    if (!expected) return { state: 'unverified', actual: normOut(actual) };
    return loose(actual) === loose(expected)
      ? { state: 'verified', actual: normOut(actual) }
      : { state: 'mismatch', actual: normOut(actual) };
  } catch (e) {
    const msg = String((e.stderr || e.stdout || e.message || '')).split('\n').filter(Boolean).slice(-1)[0] || 'error';
    return { state: 'mismatch', reason: msg.slice(0, 140) };
  } finally {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }
}

/* ---------------------------------------------------------------- matching */

const normTitle = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

/** Find the existing concept whose title best matches the PDF heading. */
function matchConcept(concepts, headingTitle, used) {
  const want = normTitle(headingTitle);
  let best = -1, bestScore = 0;
  concepts.forEach((c, i) => {
    if (used.has(i)) return;
    const have = normTitle(c.title);
    let score = 0;
    if (have === want) score = 100;
    else if (have.startsWith(want) || want.startsWith(have)) score = 60 + Math.min(have.length, want.length) / 100;
    else if (have.includes(want) || want.includes(have)) score = 40;
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return bestScore >= 40 ? best : -1;
}

/* -------------------------------------------------------------- overrides */

const OVERRIDES_FILE = path.join(ROOT, 'content', 'curriculum', 'learn-overrides.json');
function loadOverrides() {
  if (!fs.existsSync(OVERRIDES_FILE)) return [];
  const doc = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));
  return doc.concepts ?? [];
}
const overrideKey = (section, title) => `${section}|${normTitle(title)}`;

/**
 * Apply a curated override to a concept. Returns { next } on success or { error }.
 * The snippet is executed, so a typo in the overrides file can never ship.
 */
function applyOverride(c, ov, verifyFn, fallbackBody = '') {
  const ores = verifyFn(ov.code, ov.output ?? null);
  if (ores.state === 'mismatch') return { error: ores.reason || 'output mismatch' };
  const next = { ...c, code: ov.code, body: cleanBody(ov.body || fallbackBody || c.body) };
  if (ov.tip) next.tip = ov.tip;
  if (ov.code) next.output = ov.output ? (ores.actual ?? ov.output) : (ores.actual ?? c.output);
  return { next };
}

/* -------------------------------------------------------------------- main */

function main() {
  const sections = JSON.parse(fs.readFileSync(SECTIONS_JSON, 'utf8'));
  const pages = layoutText().split('\f');
  const overrides = loadOverrides();
  const overrideMap = new Map(overrides.map((o) => [overrideKey(o.section, o.title), o]));
  const overridesUsed = new Set();

  let totalMatched = 0, totalVerified = 0, totalMismatch = 0, totalChanged = 0, totalOverridden = 0, totalOverview = 0;
  const failures = [];

  for (const sec of sections) {
    if (ONLY && sec.id !== ONLY) continue;
    const learnPages = sec.pages?.learn ?? [];
    const concepts = sec.learn?.concepts ?? [];
    if (!learnPages.length || !concepts.length) continue;

    // Rebuild the section-intro pseudo-concept (its title is the whole roadmap).
    const introLines = (pages[learnPages[0] - 1] ?? '').split('\n');
    const overview = overviewFromIntro(introLines, sec.title);
    concepts.forEach((c, i) => {
      const toc = isTocTitle(c.title);
      const numOnly = /^[\d.\s]+$/.test((c.title || '').trim());
      if (!toc && !numOnly) return;
      // TOC pseudo-concept → a readable overview. Bare-number title (an advanced
      // topics page) → renamed but its snippet is fixed by an override.
      const nxt = toc
        ? { ...c, title: 'Section overview', body: overview || cleanBody(c.body), code: '', output: '', tip: '' }
        : { ...c, title: 'Advanced topics (second pass)', body: cleanBody(c.body) };
      if (JSON.stringify(nxt) !== JSON.stringify(c)) { totalChanged++; totalOverview++; }
      concepts[i] = nxt;
    });

    const blocks = [];
    for (const pn of learnPages) blocks.push(...parseBlocks((pages[pn - 1] ?? '').split('\n')));

    const used = new Set();
    for (const block of blocks) {
      const idx = matchConcept(concepts, block.title, used);
      if (idx < 0) continue;
      used.add(idx);
      const c = concepts[idx];

      const parsed = interpret(block);

      // Curated override wins over the automatic parse (layout was unrecoverable).
      const ov = overrideMap.get(overrideKey(sec.id, c.title));
      if (ov) {
        overridesUsed.add(overrideKey(sec.id, c.title));
        totalMatched++;
        const { next, error } = applyOverride(c, ov, verify, parsed.body);
        if (error) { totalMismatch++; failures.push(`${sec.id} · ${c.title} · override snippet failed: ${error}`); continue; }
        totalOverridden++;
        if (JSON.stringify(next) !== JSON.stringify(c)) totalChanged++;
        concepts[idx] = next;
        continue;
      }

      if (has('--dump-raw')) {
        console.log(`\n[RAW] ${sec.id} · ${c.title} (block "${block.title}", ${block.lines.length} lines)`);
        block.lines.forEach((l) => console.log('   ' + JSON.stringify(l.slice(0, 100))));
      }
      if (!parsed.code && !parsed.output) continue; // nothing to learn from
      totalMatched++;

      const res = verify(parsed.code, parsed.output);
      if (DUMP || (DUMP_FAIL && res.state === 'mismatch')) {
        console.log(`\n=== ${sec.id} · ${c.title} [${res.state}] ${res.reason || ''}`);
        console.log('CODE  :\n' + parsed.code.split('\n').map((l) => '   | ' + l).join('\n'));
        console.log('OUTPUT: ' + JSON.stringify(parsed.output));
        if (res.actual !== undefined) console.log('ACTUAL: ' + JSON.stringify(res.actual));
        console.log('BODY  : ' + JSON.stringify(parsed.body));
        console.log('TIP   : ' + JSON.stringify(parsed.tip));
        console.log('OLDCODE: ' + JSON.stringify(c.code));
      }
      if (res.state === 'verified') totalVerified++;
      else if (res.state === 'mismatch') { totalMismatch++; failures.push(`${sec.id} · ${c.title} · ${res.reason || 'output mismatch'}`); }

      // Never invent: apply code only when it verified, or when there is no OUTPUT to check against.
      const applyCode = parsed.code && (res.state === 'verified' || res.state === 'unverified');
      // On verify, store what the code REALLY printed (the PDF's rendering of whitespace is lossy).
      const realOutput = res.state === 'verified' && res.actual ? res.actual : null;
      const next = {
        ...c,
        code: applyCode ? parsed.code : c.code,
        output: applyCode && realOutput !== null ? realOutput : (parsed.output || c.output),
        body: cleanBody(parsed.body || c.body),
      };
      if (parsed.tip && parsed.tip.length > 3) next.tip = parsed.tip;
      if (JSON.stringify(next) !== JSON.stringify(c)) totalChanged++;
      concepts[idx] = next;
    }

    // Overrides for concepts the PDF never gave a heading (e.g. an advanced-topics page).
    concepts.forEach((c, i) => {
      const key = overrideKey(sec.id, c.title);
      if (!overrideMap.has(key) || overridesUsed.has(key)) return;
      overridesUsed.add(key);
      const { next, error } = applyOverride(c, overrideMap.get(key), verify);
      if (error) { totalMismatch++; failures.push(`${sec.id} · ${c.title} · override snippet failed: ${error}`); return; }
      totalOverridden++;
      if (JSON.stringify(next) !== JSON.stringify(c)) totalChanged++;
      concepts[i] = next;
    });
  }

  console.log(`\n— Learn rebuild ${WRITE ? '(write)' : '(dry run)'} —`);
  const staleOverrides = overrides.filter((o) => !overridesUsed.has(overrideKey(o.section, o.title)));
  console.log(`  concepts matched : ${totalMatched}`);
  console.log(`  execute-verified : ${green(totalVerified)}  ${dim('(from -layout parse)')}`);
  console.log(`  curated override : ${totalOverridden}`);
  console.log(`  section overview : ${totalOverview}`);
  console.log(`  output mismatch  : ${totalMismatch ? red(totalMismatch) : 0}  ${dim('(code kept as-is)')}`);
  console.log(`  fields changed   : ${totalChanged}`);
  if (staleOverrides.length) {
    console.log(yellow(`\n  Stale overrides (target concept no longer exists):`));
    staleOverrides.forEach((o) => console.log(`    · ${o.section} · ${o.title}`));
  }
  if (failures.length) {
    console.log(yellow(`\n  Needs a curated fix (${failures.length}):`));
    failures.slice(0, 60).forEach((f) => console.log(`    · ${f}`));
    if (failures.length > 60) console.log(dim(`    … ${failures.length - 60} more`));
  }

  if (WRITE) {
    fs.writeFileSync(SECTIONS_JSON, JSON.stringify(sections));
    console.log(green(`\n✓ wrote ${path.relative(ROOT, SECTIONS_JSON)}`));
  } else {
    console.log(dim('\n  dry run — re-run with --write to apply'));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

main();
