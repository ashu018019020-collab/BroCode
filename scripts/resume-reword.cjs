#!/usr/bin/env node
/**
 * Phase 5 (resume cleanup) — one-off migration, kept in the repo for traceability.
 *
 * Rule of the house: KOI DATA DELETE NAHI. Nothing is dropped — every record that mentions
 * "resume" is REWORDED to portfolio/project framing, the id, the type and the counts stay
 * byte-identical, and every before/after pair is archived to content/archive/resume-removed.json
 * so any string is recoverable verbatim.
 *
 *   node scripts/resume-reword.cjs            # dry run: report every hit and the intended rewrite
 *   node scripts/resume-reword.cjs --write    # apply + archive
 *
 * Rewrites are exact-string maps (case preserved per hit by the maps themselves); nothing is a
 * regex, so a future "resume" in authored content can never be silently mangled by re-running.
 * Authored sources are edited through the same maps, then re-applied by their pipelines on the
 * next regeneration — the generated side carries the same change so the app is correct now.
 *
 * Deliberately NOT touched:
 *  - the `resume:` storage-key family (byte-compatible by plan; keys.ts builder stays);
 *  - the `resume` FIELD KEY in packs/*.json + types/index.ts (packs schema — only the VALUE is
 *    reworded; renaming the key would break scripts/lib/packs.cjs part validation);
 *  - the 'resume' keyword in src/core/assessment/interview.ts skillOf (kept so old labels
 *    still classify).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);

/* ---------------------------------------------------------------- the maps */

/**
 * Ordered longest-first so a longer phrase is never half-shadowed by a shorter one.
 * `s.split(a).join(b)` with plain strings — one exact pass per pair, then the pair set is re-run
 * until stable (a rewrite can create the input of a later, shorter pair — e.g. the section
 * title inside a longer sentence).
 */
const MAPS = {
  titles: [
    ['Resume Project Defense Playbook', 'Project Defense Playbook'],
    ['RESUME PROJECT DEFENSE PLAYBOOK', 'PROJECT DEFENSE PLAYBOOK'],
    ['Resume Project Defense Studio', 'Project Defense Studio'],
    ['RESUME PROJECT DEFENSE STUDIO', 'PROJECT DEFENSE STUDIO'],
    ['Resume Project Interview Labs', 'Project Interview Labs'],
    ['RESUME PROJECT INTERVIEW LABS', 'PROJECT INTERVIEW LABS'],
    ['RESUME PROJECT INTERVIEW LA ', 'PROJECT INTERVIEW LABS '], // PDF glyph-loss artifact in a coding-lab banner
    ['resume project interview labs', 'project interview labs'],
    ['RESUME', 'PROJECT'], // bare ALL-CAPS token (mock-round cat label in extras.json)
  ],
  bankText: [
    // s29 — the defense-studio framing (generated from the PDF's V10 template)
    ['resume/interview credibility ke liye', 'project/interview credibility ke liye'],
    // s29 — real-world framing line (solved:5)
    ['Real-world: resume project ko 8 hafte me complete karna hai', 'Real-world: capstone project ko 8 hafte me complete karna hai'],
    // s29 + s27 — the "resume project" phrase in questions/answers
    ['Apne resume project ka', 'Apne capstone project ka'],
    ['Resume project ke follow-up', 'Capstone project ke follow-up'],
    ['Resume claim challenge', 'Project claim challenge'],
    ['resume projects ko defensibly present karne ke liye', 'capstone projects ko defensibly present karne ke liye'],
    ['resume padhna nahi hai', 'CV padhna nahi hai'],
    ['resume se skills extract karni hain', 'CV se skills extract karni hain'],
    // s23 — agent-control verb framing
    ['Long-running agent ko kaise resume?', 'Long-running agent ko wapas kaise chalana hai?'],
    // expansion-pack authorship note (never user-visible, but zero-leftover is the bar)
    ['s29 (Resume Project Labs) solved', 's29 (Project Labs) solved'],
    // s07 pack — runner restart feature
    ['resume feature do', 'restart feature do'],
    // s27/s29 — the authored bullet-writing items (archived, then re-pointed at the pitch lab)
    ['Resume me project bullet kaise likhna chahiye?', 'Project ka measurable outcome kaise likhna chahiye?'],
    ["Real-world: project ka 'resume bullet' likho (metric-driven).", "Real-world: project ka outcome summary likho (metric-driven)."],
    ['Delta report resume bullet ban jaati hai.', 'Delta report outcome summary ban jaati hai.'],
    ['resume matcher', 'document matcher'],
    // s23/s21 — plain-language uses (agent resume = the verb, kept honest)
    ['failure ke baad resume aur long-running tasks enable karti hai', 'failure ke baad wapas chalana aur long-running tasks enable karti hai'],
    ['Checkpointed state + deterministic resume boundary', 'Checkpointed state + deterministic restart boundary'],
  ],
  misc: [
    ['Resume alignment:', 'Portfolio alignment:'],
    ['Resume-aligned story:', 'Portfolio-aligned story:'],
    ['Resume par project likhna aasan hai', 'Portfolio me project likhna aasan hai'],
    ['For every bullet in resume, prepare', 'For every bullet in your portfolio, prepare'],
    ['resume headline', 'portfolio headline'],
    ['resume story', 'portfolio story'],
  ],
};

const PAIRS = [...MAPS.titles, ...MAPS.bankText, ...MAPS.misc];
function reword(text) {
  let out = String(text ?? '');
  let changed = false;
  for (let pass = 0; pass < 3; pass += 1) {
    let next = out;
    for (const [a, b] of PAIRS) if (next.includes(a)) next = next.split(a).join(b);
    if (next === out) break;
    out = next;
    changed = true;
  }
  return changed ? out : null;
}

/* ------------------------------------------------------------ the archive */

const ARCHIVE_DIR = path.join(ROOT, 'content', 'archive');
const ARCHIVE = path.join(ARCHIVE_DIR, 'resume-removed.json');
const loadArchive = () => (fs.existsSync(ARCHIVE) ? JSON.parse(fs.readFileSync(ARCHIVE, 'utf8')) : {
  _comment: 'Phase 5 resume cleanup — every string the migration reworded, verbatim, before the change. Recoverable, nothing deleted.',
  created: new Date().toISOString(),
  entries: [],
});
const seen = new Set();
let entries = [];
function archive(entry) {
  const k = `${entry.file}::${entry.id ?? ''}::${entry.field ?? ''}`;
  if (seen.has(k)) return;
  seen.add(k);
  entries.push(entry);
}

/** Reword the listed fields of `obj` (strings only — arrays/objects are never coerced). */
function apply(file, obj, fields, idFn) {
  let n = 0;
  for (const f of fields) {
    const before = obj[f];
    if (typeof before !== 'string') continue;
    const after = reword(before);
    if (after === null) continue;
    archive({ file, id: idFn(obj), field: f, before, after });
    if (WRITE) obj[f] = after;
    n += 1;
  }
  return n;
}

/**
 * Deep-walk any JSON object/array, rewording every string VALUE — including strings that are
 * ARRAY ELEMENTS (related[]/topics[]/advanced[] lists), which are written back via the parent
 * array. A node with its own string `id` re-binds the archive id for everything below it.
 */
function walkReword(o, file, id, fieldPrefix = '') {
  let n = 0;
  if (Array.isArray(o)) {
    o.forEach((x, i) => {
      const pfx = `${fieldPrefix}[${i}]`;
      if (typeof x === 'string') {
        const after = reword(x);
        if (after !== null) { archive({ file, id, field: pfx, before: x, after }); if (WRITE) o[i] = after; n += 1; }
      } else if (x && typeof x === 'object') {
        n += walkReword(x, file, id, pfx);
      }
    });
    return n;
  }
  if (o && typeof o === 'object') {
    const ownId = typeof o.id === 'string' && o.id ? o.id : id;
    for (const [k, v] of Object.entries(o)) {
      const pfx = fieldPrefix ? `${fieldPrefix}.${k}` : k;
      if (typeof v === 'string') {
        const after = reword(v);
        if (after !== null) { archive({ file, id: ownId, field: pfx, before: v, after }); if (WRITE) o[k] = after; n += 1; }
      } else if (v && typeof v === 'object') {
        n += walkReword(v, file, ownId, pfx);
      }
    }
  }
  return n;
}

/** Raw-text reword — applies PAIRS to the original file bytes so formatting is never disturbed. */
function rewordRaw(text) {
  let out = String(text);
  for (let pass = 0; pass < 3; pass += 1) {
    let next = out;
    for (const [a, b] of PAIRS) if (next.includes(a)) next = next.split(a).join(b);
    if (next === out) break;
    out = next;
  }
  return out === text ? null : out;
}

/* --------------------------------------------------------------- the files */

const GEN = path.join(ROOT, 'public', 'generated');
const rel = (p) => path.relative(ROOT, p);
let WRITE = false;

function main() {
  WRITE = process.argv.includes('--write');

  // 1. Question banks — one deep walk covers title/topics AND every question's text + related[]
  //    lists; ids, types and counts are never touched.
  let bankQs = 0;
  for (const sid of ['s21', 's23', 's27', 's29']) {
    const p = path.join(GEN, 'questions', `${sid}.json`);
    const bank = JSON.parse(fs.readFileSync(p, 'utf8'));
    bankQs += walkReword(bank, rel(p), `${sid}:bank`);
    if (WRITE) fs.writeFileSync(p, JSON.stringify(bank, null, 1));
  }

  // 2. Curriculum sections.json + meta.json mirror — every nested resume string.
  const SECTIONS = path.join(GEN, 'curriculum', 'sections.json');
  const sections = JSON.parse(fs.readFileSync(SECTIONS, 'utf8'));
  let secN = 0;
  for (const s of sections) secN += walkReword(s, rel(SECTIONS), s.id);
  if (WRITE) fs.writeFileSync(SECTIONS, JSON.stringify(sections));

  const META = path.join(GEN, 'curriculum', 'meta.json');
  const metaRaw = fs.readFileSync(META, 'utf8');
  const metaN = walkReword(JSON.parse(metaRaw), rel(META), 'meta');
  // Written as raw text: meta.json ships pretty-printed, and a round-trip would reflow all 982
  // lines around one reword. Same maps, so decoded and raw hits agree exactly.
  if (WRITE) {
    const metaOut = rewordRaw(metaRaw);
    if (metaOut !== null) fs.writeFileSync(META, metaOut);
  }

  // 3. extras.json — the RESUME category label of the mock/intensive sets → PROJECT.
  const EXTRAS = path.join(GEN, 'curriculum', 'extras.json');
  const extras = JSON.parse(fs.readFileSync(EXTRAS, 'utf8'));
  const extrasN = walkReword(extras, rel(EXTRAS), 'extras');
  if (WRITE) fs.writeFileSync(EXTRAS, JSON.stringify(extras));

  // 4. tracks (authored is the source; generated is its byte-copy) — walked for the archive,
  //    but written as RAW TEXT so the authored file's formatting is preserved byte-for-byte.
  for (const [src, dst] of [['content/tracks/interview-projects.json', 'public/generated/tracks/interview-projects.json']]) {
    const sp = path.join(ROOT, src);
    const raw = fs.readFileSync(sp, 'utf8');
    const t = JSON.parse(raw);
    walkReword(t, src, t.id ?? 'track');
    const out = WRITE ? rewordRaw(raw) : null;
    if (out !== null) {
      fs.writeFileSync(sp, out);
      fs.writeFileSync(path.join(ROOT, dst), out); // generated copy is a byte-copy of authored
    }
  }

  // 5. Authored sources that feed the SAME generated strings. Walked (JSON) for the archive,
  //    but written as RAW TEXT — a JSON round-trip would reformat compact files and bury the
  //    3-4 word rewords under thousands of whitespace-diff lines. Same maps, so decoded and
  //    raw hits agree exactly (no pair string contains an escapable character).
  const AUTHORED = [
    'content/questions/expansion/interview-projects.json',
    'content/questions/expansion/ml-nlp.json',
    'content/curriculum/guides/interview-projects.json',
    'content/curriculum/topics/interview-projects.json',
    'content/curriculum/stage-overrides.json',
    'content/questions/expansion/playbook-v15.json',
    // packs: the `resume` FIELD KEY stays (schema) — only its VALUE is reworded by the walk.
    'content/curriculum/packs/s01.json',
    'content/curriculum/packs/s02.json',
    'content/curriculum/packs/s03.json',
    'content/curriculum/packs/s04.json',
    'content/curriculum/packs/s05.json',
    'content/curriculum/packs/s06.json',
    'content/curriculum/packs/s07.json',
    'content/curriculum/packs/s08.json',
    'content/curriculum/packs/s12.json',
  ];
  let authoredN = 0;
  for (const f of AUTHORED) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p, 'utf8');
    let doc;
    try { doc = JSON.parse(raw); } catch { continue; }
    authoredN += walkReword(doc, f, doc.id ?? doc.sectionId ?? 'authored');
    if (WRITE) {
      const out = rewordRaw(raw);
      if (out !== null) fs.writeFileSync(p, out);
    }
  }

  // 6. Playbook manifest — chapter titles were parsed OUT of the (uncommitted) PDF and frozen
  //    into this checked-in artifact; scripts/playbook.cjs cannot re-derive them without the PDF,
  //    so the in-place reword is the only correct path here too.
  const PB_MANIFEST = path.join(GEN, 'playbook', 'manifest.json');
  const pbRaw = fs.readFileSync(PB_MANIFEST, 'utf8');
  const pbN = walkReword(JSON.parse(pbRaw), rel(PB_MANIFEST), 'playbook-manifest');
  if (WRITE) {
    const pbOut = rewordRaw(pbRaw);
    if (pbOut !== null) fs.writeFileSync(PB_MANIFEST, pbOut);
  }

  const hits = { banks: bankQs, sections: secN, meta: metaN, extras: extrasN, authored: authoredN, playbookManifest: pbN };
  const total = Object.values(hits).reduce((a, b) => a + b, 0);
  if (!WRITE) {
    console.log(`dry run — ${total} string(s) would be reworded:`, JSON.stringify(hits));
    console.log('re-run with --write to archive + apply');
    return;
  }

  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const prev = loadArchive();
  // Re-runs re-walk restored sources, so entries can repeat — dedupe on file+id+field+before.
  const keyOf = (e) => `${e.file}::${e.id ?? ''}::${e.field ?? ''}::${e.before}`;
  const mergedSeen = new Set();
  const mergedEntries = [];
  for (const e of [...prev.entries, ...entries]) {
    const k = keyOf(e);
    if (mergedSeen.has(k)) continue;
    mergedSeen.add(k);
    mergedEntries.push(e);
  }
  const merged = { ...prev, updated: new Date().toISOString(), entries: mergedEntries };
  fs.writeFileSync(ARCHIVE, JSON.stringify(merged, null, 1));
  ok(`archived ${entries.length} new entr(y|ies) → ${rel(ARCHIVE)} (total ${mergedEntries.length})`);
  ok(`reworded ${total} string(s): ${JSON.stringify(hits)}`);
}

if (require.main === module) main();

/* ----------------------------------------------------- module exports (scan tooling) */
module.exports = { MAPS, PAIRS, reword };
