/**
 * pdfqa.cjs — parse + curate the V10 "Senior Visual Answer Edition" Q&A PDF into
 * per-section question-bank records.
 *
 * Why `-layout`: plain `pdftotext` linearises the PDF's card layout, splitting the
 * priority/difficulty band ("HIGH  BASIC") onto its own line and mangling code and
 * stage furniture into the question text. `pdftotext -layout` keeps the two columns
 * apart, so each item's band line, question and ANSWER / SOLUTION block stay parseable.
 * This is the same reason `scripts/learn.cjs` uses `-layout` for the learn pages.
 *
 * Nothing here invents content. The PDF supplies, per item: a priority band
 * (CRITICAL / HIGH / CORE — present only in 13 of the 29 sections), a difficulty band
 * (BASIC / INTERMEDIATE / ADVANCED / SENIOR — present on every item), the question, the
 * model answer and an optional "USE / IMPACT" line. Everything else is a deterministic
 * mapping into the existing bank schema. There is no new question type: MINI PROJECT
 * reuses `coding` (the schema's eight types are locked by the authorship quota test).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { norm, TYPES } = require('./validate.cjs');

/* ------------------------------- vocabulary ------------------------------- */

/** The PDF's nine stages, in document order. */
const STAGES = [
  'LEARN', 'INTERVIEW', 'CODING LAB', 'LOGIC', 'DEBUG',
  'PRACTICE', 'MINI PROJECT', 'DEFENSE', 'CHECKPOINT',
];

/**
 * PDF stage → bank type. MINI PROJECT has no dedicated schema type (adding one would
 * change the locked `20 x TYPES.length x 8 = 1,280` authorship quota), so it reuses
 * `coding` and carries the `mini-project` tag instead.
 */
const STAGE_TO_TYPE = {
  LEARN: 'theory',
  INTERVIEW: 'interview',
  'CODING LAB': 'coding',
  LOGIC: 'logic',
  DEBUG: 'debug',
  PRACTICE: 'solved',
  'MINI PROJECT': 'coding',
  DEFENSE: 'defense',
  CHECKPOINT: 'checkpoint',
};

/** Stages that share a schema type keep an extra tag so the UI can tell them apart. */
const STAGE_TAG = { 'MINI PROJECT': 'mini-project' };

const DIFFICULTY = { BASIC: 'easy', INTERMEDIATE: 'medium', ADVANCED: 'hard', SENIOR: 'expert' };
const DIFF_RANK = { easy: 0, medium: 1, hard: 2, expert: 3 };
const BANDS = ['CRITICAL', 'HIGH', 'CORE'];
/** Priority rank, lowest → highest, as the PDF's own legend defines it. */
const PRIORITY_ORDER = ['CORE', 'HIGH', 'CRITICAL'];

/**
 * The PDF's priority band → the bank schema's `importance`. The mapping keeps the PDF's
 * own ordering intact (CRITICAL > HIGH > CORE ⇒ weight 3 > 2 > 1): `production` and
 * `interview_critical` are deliberately unused so no two bands share a weight.
 */
const IMPORTANCE_OF = { CRITICAL: 'must_know', HIGH: 'high_value', CORE: 'advanced' };
const PRIORITY_OF = { must_know: 'P0', interview_critical: 'P0', high_value: 'P1', production: 'P1', advanced: 'P2' };

/** The one visible marker the importer writes. The Question Bank already renders the
 *  first two `tags` as chips, so this highlights without touching the design. */
const HIGHLIGHT_TAG = 'MUST-KNOW';

/** Difficulty bands that can be part of a highlight — the PDF's own top tier. */
const HIGHLIGHT_DIFFICULTIES = ['SENIOR'];

/**
 * Highlight rule, in one place so it is reviewable and adjustable:
 *   the section's HIGHEST priority band (whichever band that section actually uses)
 *   INTERSECT the PDF's SENIOR difficulty band.
 *
 * Why an intersection: the PDF marks all 468 items of 16 sections CRITICAL, so the band
 * alone flags 61% of the document and stops meaning "most important". Intersecting it
 * with the PDF's own top difficulty band lands a credible set and uses only the PDF's
 * signals — no invented ranking.
 */
const HIGHLIGHT_RULE = 'section top priority band (CRITICAL | HIGH | CORE, whichever it uses) x SENIOR difficulty';

/**
 * Concept extraction, per stage. Each template is tried in order; the PDF uses several
 * variants per stage ("What is X and why…", "What is one common mistake with X and…",
 * "Defense : X ka biggest failure mode…"), so a generic `^Stage : <C> <particle>` rule is
 * kept last as the catch-all. This only ever reads text the PDF already printed.
 */
const CONCEPT_RULES = {
  LEARN: [/^[A-Za-z][A-Za-z /&()-]{2,26}:\s*(.+?)\s+ko\s/],
  INTERVIEW: [
    /^What is one common mistake with\s+(.+?)\s+and how\s/i,
    /^What is\s+(.+?)\s+and why\s/i,
    /^When would you use\s+(.+?)\s+in a real\s/i,
    /^What trade-off should an engineer consider when using\s+(.+?)\s*\?/i,
    /^What\s+(?:is|are)\s+(.+?)\s*\?/i,
  ],
  'CODING LAB': [/^Coding\s*:\s*(.+?)\s+ko use karke/i],
  LOGIC: [
    /^Logic\s*:\s*(.+?)\s+ko use karke/i,
    /^Logic\s*:\s*(.+?)\s+me kaunsi/i,
    /^Logic\s*:\s*(.+?)\s+ka simpler alternative/i,
    /^Logic\s*:\s*(.+?)\s+(?:ko|me|ka|se)\s/i,
  ],
  DEBUG: [/^Debug\s*:\s*(.+?)\s+ka broken case/i, /^Debug\s*:\s*(.+?)\s+(?:ka|ko|me|se)\s/i],
  PRACTICE: [/^Practice\s*:\s*.+?task\s*:\s*(.+?)\s+(?:se|ko)\s/i, /^Practice\s*:\s*.+?task\s*:\s*(.+?)\s+(?:se|ko|me|ka)\s/i],
  'MINI PROJECT': [/jisme\s+(.+?)\s+core\b/i],
  DEFENSE: [
    /^Defense\s*:\s*Project\s+.+?\s+me\s+(.+?)\s+kyun/i,
    /^Defense\s*:\s*Project\s+.+?\s+ka\s+(.+?)\s+data flow/i,
    /^Defense\s*:\s*(.+?)\s+ka biggest failure mode/i,
    /^Defense\s*:\s*(?:Project\s+.+?\s+)?(.+?)\s+(?:ka|ko|me|se)\s/i,
  ],
  CHECKPOINT: [
    /^Checkpoint\s*:\s*(?:MCQ|True\/False|Quick|Scenario)\s*:\s*(.+?)\s+(?:ka|ko|ke|se|me)\s/i,
    /^Checkpoint\s*:\s*.+?:\s*(.+?)\s+(?:ka|ko|ke|se|me)\s/i,
  ],
};

/* --------------------------------- parsing -------------------------------- */

const STAGE_RE = /^0([1-9])\. (LEARN|INTERVIEW|CODING LAB|LOGIC|DEBUG|PRACTICE|MINI PROJECT|DEFENSE|CHECKPOINT)$/;
const SECTION_RE = /SECTION (\d\d) \|/;
const NAV_RE = /^01 LEARN 02 INTERVIEW/;
const SUBTITLE_RE = /answered items \| Basic -> Intermediate -> Advanced -> Senior$/;
const FOOTER_RE = /^Learn -> Apply -> Practice -> Debug -> Interview -> Build -> Defend -> Master/;
const IMPACT_RE = /^USE \/ IMPACT\s*(.*)$/;

/** Page furniture from the PDF template — never content. */
function isFurniture(line) {
  return !line
    || line.startsWith('AI ENGINEER MASTER LAB')
    || /^Hinglish \| \d+ Sections \|/.test(line)
    || NAV_RE.test(line)
    || SUBTITLE_RE.test(line)
    || FOOTER_RE.test(line)
    || /^Page \d+$/.test(line)
    || SECTION_RE.test(line)
    || STAGE_RE.test(line);
}

/**
 * Non-band chips the template prints next to the band. Sections 13-24 and 26-29 carry a
 * three-cell band (`AI ENGINEER CRITICAL  BASIC`); sections 01-12 and 25 carry two
 * (`HIGH  BASIC`). Both must parse, otherwise half the questions keep the band line glued
 * to their text.
 */
const CHIPS = ['AI ENGINEER'];
const IMP_RE = /\b(CRITICAL|HIGH|CORE)\b/;
const DIFF_RE = /\b(BASIC|INTERMEDIATE|ADVANCED|SENIOR)\b/;

/**
 * The item band line, or null when the line is real content. Every item carries a
 * difficulty band, so that is the anchor: after removing the known chips and bands,
 * nothing may be left over. Bands are uppercase in the PDF while the question prose
 * says "intermediate level par", so prose can never be mistaken for a band line.
 */
function bandTokens(line) {
  if (!line) return null;
  const dif = String(line).match(DIFF_RE);
  if (!dif) return null;
  const imp = String(line).match(IMP_RE);
  let rest = String(line).replace(/\b(CRITICAL|HIGH|CORE)\b/g, ' ').replace(/\b(BASIC|INTERMEDIATE|ADVANCED|SENIOR)\b/g, ' ');
  for (const c of CHIPS) rest = rest.split(c).join(' ');
  if (rest.replace(/\s+/g, '') !== '') return null;
  return { pdfImportance: imp ? imp[1] : null, pdfDifficulty: dif[1] };
}

const isBandLine = (line) => bandTokens(line) !== null;

/** Join wrapped lines: collapse the columns' whitespace, rejoin hyphenated breaks. */
function joinLines(arr) {
  let out = '';
  for (const raw of arr) {
    const l = String(raw ?? '').trim();
    if (!l) continue;
    if (!out) { out = l; continue; }
    if (/-$/.test(out) && /^[a-z]/.test(l)) out = out.slice(0, -1) + l;
    else out = `${out} ${l}`;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * The MINI PROJECT template can push the first fragment of the ANSWER onto the question
 * side of the page (`Input ->` above "ANSWER / SOLUTION", `process -> output ...` below).
 * Move a dangling lead-in fragment back where it belongs.
 */
const SPLIT_FRAGMENT_RE = /^[A-Z][A-Za-z ]{1,14}->\s*$/;

/**
 * Parse the layout text into raw items. Deterministic and order-preserving; items keep
 * their source page so every imported record can be traced back to the PDF.
 */
function parseLayout(text) {
  const pages = String(text ?? '').split('\f');
  const items = [];
  const problems = [];

  pages.forEach((raw, idx) => {
    const pageNo = idx + 1;
    const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+$/, '').trim());
    const header = lines.find((l) => SECTION_RE.test(l)) || '';
    const hm = header.match(SECTION_RE);
    const sid = hm ? `s${hm[1]}` : null;

    let stage = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const sm = line && line.match(STAGE_RE);
      if (sm) { stage = sm[2]; continue; }
      if (line !== 'ANSWER / SOLUTION') continue;

      // ---- question block: walk back to the band line ----
      const qLines = [];
      let pdfImportance = null;
      let pdfDifficulty = null;
      for (let j = i - 1; j >= 0; j--) {
        const x = lines[j];
        if (!x) continue;
        if (x === 'ANSWER / SOLUTION' || IMPACT_RE.test(x)) break;
        if (isFurniture(x)) break;
        if (isBandLine(x)) {
          const b = bandTokens(x);
          pdfImportance = b.pdfImportance;
          pdfDifficulty = b.pdfDifficulty;
          break;
        }
        qLines.unshift(x);
      }

      // ---- answer block: walk forward to the next band line / furniture ----
      const aLines = [];
      let impactLines = null;
      for (let j = i + 1; j < lines.length; j++) {
        const x = lines[j];
        if (!x) continue;
        if (x === 'ANSWER / SOLUTION' || isBandLine(x) || isFurniture(x)) break;
        const im = x.match(IMPACT_RE);
        if (im) { impactLines = [im[1]]; continue; }
        if (impactLines) { impactLines.push(x); continue; }
        aLines.push(x);
      }

      // Repair the MINI PROJECT fragment split across the ANSWER / SOLUTION marker.
      if (qLines.length > 1 && SPLIT_FRAGMENT_RE.test(qLines[qLines.length - 1])) {
        aLines.unshift(qLines.pop());
      }

      const question = joinLines(qLines);
      const answer = joinLines(aLines);
      if (!sid || !stage) { problems.push(`page ${pageNo}: item outside a section/stage block — skipped`); continue; }
      if (!question) { problems.push(`page ${pageNo}: empty question — skipped`); continue; }

      items.push({
        sid,
        page: pageNo,
        stage,
        pdfImportance,
        pdfDifficulty,
        question,
        answer,
        impact: impactLines ? joinLines(impactLines) : '',
      });
    }
  });

  return { items, problems };
}

/** Run `pdftotext -layout`, caching the text exactly like scripts/learn.cjs does. */
function extractLayout(pdfPath, { cacheFile, fresh = false } = {}) {
  if (!fresh && cacheFile && fs.existsSync(cacheFile)) {
    return { text: fs.readFileSync(cacheFile, 'utf8'), fromCache: true };
  }
  if (!pdfPath) throw new Error('no --pdf=<path> and no cached layout text — nothing to parse');
  if (!fs.existsSync(pdfPath)) throw new Error(`PDF not found: ${pdfPath}`);
  let text;
  try {
    text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { maxBuffer: 512 * 1024 * 1024 }).toString();
  } catch (err) {
    throw new Error(`pdftotext failed (poppler installed?): ${err.message}`);
  }
  if (cacheFile) {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, text);
  }
  return { text, fromCache: false };
}

/* -------------------------------- curating -------------------------------- */

/** Sections the PDF actually labelled (13 of 29 — the rest carry no priority band). */
function labelledSections(items) {
  const m = new Map();
  for (const it of items) {
    if (!it.sid) continue;
    m.set(it.sid, (m.get(it.sid) || false) || !!it.pdfImportance);
  }
  return m;
}

function cleanConcept(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim();
  if (!t || t.length > 60 || /[?]/.test(t)) return null;
  return t;
}

function conceptOf(item) {
  for (const re of CONCEPT_RULES[item.stage] || []) {
    const m = item.question.match(re);
    if (m && m[1]) {
      const c = cleanConcept(m[1]);
      if (c) return c;
    }
  }
  return null;
}

/**
 * The section's concept vocabulary, read off the PDF itself: every candidate any stage
 * template yields, plus the curriculum's own concept titles as a cross-check. Two items
 * of the same section never disagree about a concept once it is in this list — which is
 * what makes the tag reliable for stages whose template has no concept slot at all
 * (PRACTICE's edge/performance/refactor tasks, CHECKPOINT's scenario form).
 * Longest first, so "Mutable vs Immutable + id()" wins over "id".
 */
function buildVocabulary(sectionItems, curriculumConcepts = []) {
  const set = new Set();
  for (const c of curriculumConcepts) {
    const cleaned = cleanConcept(c);
    if (cleaned) set.add(cleaned);
  }
  for (const it of sectionItems) {
    const c = conceptOf(it);
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => b.length - a.length);
}

/** Own template first (most precise), then the section vocabulary, longest term first. */
function conceptFor(item, vocabulary) {
  const own = conceptOf(item);
  if (own) return { concept: own, fromTemplate: true };
  for (const term of vocabulary) {
    if (term && item.question.includes(term)) return { concept: term, fromTemplate: false };
  }
  return { concept: null, fromTemplate: false };
}

/** The highest priority band a section actually uses — every section has at least one. */
function topBandOf(sectionItems) {
  let best = null;
  for (const it of sectionItems) {
    const b = it.pdfImportance;
    if (!b) continue;
    if (!best || PRIORITY_ORDER.indexOf(b) > PRIORITY_ORDER.indexOf(best)) best = b;
  }
  return best;
}

/** Keep the best variant of a repeated question: PDF priority, then difficulty, then detail. */
const rankOf = (r) => (r.pdfImportance === 'HIGH' ? 100 : r.pdfImportance === 'CORE' ? 50 : 0)
  + DIFF_RANK[r.difficulty] * 10
  + Math.min(9, Math.floor(r.answer.length / 200));

/**
 * Whitespace-only clean-up of the PDF's template punctuation. No wording is touched.
 * The generator writes its stage labels with a space before the colon ("Coding : X"),
 * which is a typographic artefact, not content — `punctuation: true` normalises it for
 * question text. Answers keep their own punctuation (code snippets live there) and only
 * get their whitespace collapsed.
 */
function tidyText(s, { punctuation = false } = {}) {
  let out = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (punctuation) {
    out = out
      .replace(/\s+([,;:])/g, '$1')
      .replace(/\s+\.(?=\s|$)/g, '.')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')');
  }
  return out;
}

/**
 * Make a question section-specific. `questions.test.cjs` fails on question text that
 * repeats across banks, and its own remedy is "make it section-specific" — so the
 * template families the PDF repeats in every section get the section's name injected
 * instead of being thrown away.
 */
function disambiguate(question, title, withSid = false) {
  const label = withSid ? ` (${title} · ${withSid})` : ` (${title})`;
  const m = String(question).match(/^([^:]{1,40})\s*:\s*([\s\S]*)$/);
  if (m) return tidyText(`${m[1].trim()}${label}: ${m[2]}`, { punctuation: true });
  return tidyText(`${title}${withSid ? ` · ${withSid}` : ''} — ${question}`);
}

/** Drop the answer's "Use: X" clause when it is the same sentence as the USE / IMPACT line. */
function cleanAnswer(r) {
  if (!r.impact) return tidyText(r.answer);
  const m = r.answer.match(/\bUse:\s*([^.]{4,240})\./);
  if (!m) return tidyText(r.answer);
  const a = norm(m[1]);
  const b = norm(r.impact);
  const same = a && b && (a === b || a.startsWith(b.slice(0, 30)) || b.startsWith(a.slice(0, 30)));
  if (!same) return tidyText(r.answer);
  return tidyText(r.answer.replace(m[0], ' '));
}

function explanationOf(r, sec) {
  if (r.impact) return `USE / IMPACT: ${r.impact}`;
  const why = r.answer.match(/\bWhy:\s*([^.]{4,240})\./);
  if (why) return `Why: ${why[1]}.`;
  return `${sec.title} · ${r.stage} stage — model answer V10 answer PDF se (page ${r.page}).`;
}

/**
 * Next free per-type index in a bank — the same rule `questions:expand-track` uses, so
 * imported ids are appended and existing records are never renumbered.
 */
function nextIndex(bank, type) {
  let max = -1;
  for (const q of bank.questions ?? []) {
    if (q.type !== type) continue;
    const n = Number(String(q.id).split(':').pop());
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/**
 * Give curated records their bank ids. Deterministic given the bank's current state,
 * which is what makes re-running the importer a true no-op instead of a second copy.
 */
function withIds(bank, records, sid) {
  const counter = new Map();
  return records.map((r) => {
    if (!counter.has(r.type)) counter.set(r.type, nextIndex(bank, r.type));
    const idx = counter.get(r.type);
    counter.set(r.type, idx + 1);
    return { ...r, id: `${sid}:${r.type}:${idx}` };
  });
}

/**
 * Curate parsed items into merge-ready records.
 * Returns per-section payloads (already ordered so highlights come first) plus an
 * honest report of everything dropped or rewritten.
 */
function curate(items, { sections }) {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const report = {
    parsed: items.length,
    sectionBands: {},
    sectionsWithoutLabels: [],
    dropped: { intraSection: 0, unusable: 0 },
    crossSection: { families: 0, items: 0 },
    forked: 0,
    answerClauseTrimmed: 0,
    highlighted: 0,
    unmatchedConcept: 0,
    vocabulary: 0,
    pages: 0,
    problems: [],
  };

  // Section groups drive both the concept vocabulary and the top-band rule.
  const grouped = new Map(sections.map((s) => [s.id, []]));
  for (const it of items) if (grouped.has(it.sid)) grouped.get(it.sid).push(it);
  const vocab = new Map();
  const topBands = new Map();
  for (const sec of sections) {
    const group = grouped.get(sec.id);
    const terms = buildVocabulary(group, (sec.learn?.concepts ?? []).map((c) => c.title));
    vocab.set(sec.id, terms);
    report.vocabulary += terms.length;
    const band = topBandOf(group);
    topBands.set(sec.id, band);
    report.sectionBands[sec.id] = band;
    if (!band) report.sectionsWithoutLabels.push(sec.id);
  }

  // ---- 1. derive every field from the PDF's own signals ----
  const enriched = [];
  for (const it of items) {
    const sec = byId.get(it.sid);
    if (!sec) { report.dropped.unusable++; continue; }
    const type = STAGE_TO_TYPE[it.stage];
    if (!type || !TYPES.includes(type)) { report.dropped.unusable++; continue; }
    if (!it.question || it.question.length < 8) { report.dropped.unusable++; continue; }
    if (!it.answer || it.answer.trim().length < 2) { report.dropped.unusable++; continue; }

    const difficulty = DIFFICULTY[it.pdfDifficulty] || 'medium';
    const highlighted = it.pdfImportance === topBands.get(it.sid)
      && HIGHLIGHT_DIFFICULTIES.includes(it.pdfDifficulty);
    const importance = highlighted ? 'must_know' : (IMPORTANCE_OF[it.pdfImportance] ?? 'advanced');
    const { concept, fromTemplate } = conceptFor(it, vocab.get(it.sid) ?? []);
    if (!concept || !fromTemplate) report.unmatchedConcept++;

    enriched.push({
      sid: it.sid, page: it.page, stage: it.stage,
      pdfImportance: it.pdfImportance, pdfDifficulty: it.pdfDifficulty,
      type, difficulty, importance, highlighted,
      concept: concept ?? sec.title,
      conceptFromTemplate: fromTemplate,
      // Tidy before dedupe/uniqueness so every later step works on the shipped text.
      question: tidyText(it.question, { punctuation: true }),
      answer: tidyText(it.answer),
      impact: tidyText(it.impact),
    });
    report.pages = Math.max(report.pages, it.page);
  }

  // ---- 2. repeated inside one section: keep the strongest, drop the copies ----
  const bySection = new Map();
  for (const r of enriched) {
    if (!bySection.has(r.sid)) bySection.set(r.sid, new Map());
    const bucket = bySection.get(r.sid);
    const k = norm(r.question);
    const prev = bucket.get(k);
    if (!prev) { bucket.set(k, r); continue; }
    report.dropped.intraSection++;
    if (rankOf(r) > rankOf(prev)) bucket.set(k, r);
  }

  const all = [];
  for (const bucket of bySection.values()) all.push(...bucket.values());

  // ---- 3. repeated across sections: make it section-specific (don't lose coverage) ----
  const groups = new Map();
  for (const r of all) {
    const k = norm(r.question);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    if (new Set(arr.map((r) => r.sid)).size < 2) continue;
    report.crossSection.families++;
    report.crossSection.items += arr.length;
    for (const r of arr) r.question = disambiguate(r.question, byId.get(r.sid).title);
  }

  // ---- 4. belt and braces: nothing may leave this function with a repeated text ----
  const seen = new Map();
  const resolved = [];
  for (const r of all) {
    let k = norm(r.question);
    if (seen.has(k)) {
      r.question = disambiguate(r.question, byId.get(r.sid).title, r.sid);
      report.forked++;
      k = norm(r.question);
    }
    if (seen.has(k)) { report.dropped.unusable++; continue; }
    if (k.length < 8) { report.dropped.unusable++; continue; }
    seen.set(k, r);
    resolved.push(r);
  }

  // ---- 5. schema records ----
  const records = new Map();
  for (const r of resolved) {
    const sec = byId.get(r.sid);
    const tags = [r.concept];
    if (r.highlighted) tags.push(HIGHLIGHT_TAG);
    const extra = STAGE_TAG[r.stage];
    if (extra) tags.push(extra);
    const answer = cleanAnswer(r);
    if (answer !== r.answer) report.answerClauseTrimmed++;
    if (r.highlighted) report.highlighted++;
    const rec = {
      sectionId: r.sid,
      type: r.type,
      difficulty: r.difficulty,
      importance: r.importance,
      priority: PRIORITY_OF[r.importance] ?? 'P1',
      status: 'PUBLISHED',
      question: r.question,
      answer,
      explanation: explanationOf(r, sec),
      source: 'curriculum',
      tags,
      pdfPage: r.page,
      pdfStage: r.stage,
    };
    if (r.pdfImportance) rec.pdfImportance = r.pdfImportance;
    if (!records.has(r.sid)) records.set(r.sid, []);
    records.get(r.sid).push(rec);
  }

  // ---- 6. order: highlights first (hardest first, then by source page) ----
  for (const [sid, list] of records) {
    const hl = list.filter((r) => r.tags.includes(HIGHLIGHT_TAG))
      .sort((a, b) => DIFF_RANK[b.difficulty] - DIFF_RANK[a.difficulty] || a.pdfPage - b.pdfPage);
    const rest = list.filter((r) => !r.tags.includes(HIGHLIGHT_TAG));
    records.set(sid, [...hl, ...rest]);
  }

  const perSection = sections.map((s) => {
    const list = records.get(s.id) ?? [];
    const byType = {};
    for (const r of list) byType[r.type] = (byType[r.type] ?? 0) + 1;
    return {
      sid: s.id, no: s.no, title: s.title,
      added: list.length,
      highlighted: list.filter((r) => r.tags.includes(HIGHLIGHT_TAG)).length,
      band: report.sectionBands[s.id] ?? null,
      byType,
    };
  });

  const total = perSection.reduce((n, s) => n + s.added, 0);
  return { records, report: { ...report, total, perSection } };
}

/** Records for one section only (--section=s01), with the same ordering guarantees. */
function onlySection(curated, sid) {
  const list = curated.records.get(sid);
  return list ? new Map([[sid, list]]) : new Map();
}

/** Is this bank record one the importer highlighted? Only the importer writes the tag. */
const isHighlighted = (q) => Array.isArray(q.tags) && q.tags.includes(HIGHLIGHT_TAG);

module.exports = {
  // vocabulary (exported so tests and the report can assert against one source)
  STAGES, STAGE_TO_TYPE, STAGE_TAG, DIFFICULTY, DIFF_RANK, BANDS, PRIORITY_ORDER,
  IMPORTANCE_OF, PRIORITY_OF, HIGHLIGHT_TAG, HIGHLIGHT_RULE, HIGHLIGHT_DIFFICULTIES,
  CONCEPT_RULES, CHIPS,
  // parsing
  parseLayout, extractLayout, joinLines, isBandLine, bandTokens, isFurniture, disambiguate,
  // curating
  curate, onlySection, conceptOf, conceptFor, buildVocabulary, topBandOf, cleanAnswer,
  explanationOf, labelledSections, isHighlighted, cleanConcept, rankOf, tidyText,
  nextIndex, withIds,
};
