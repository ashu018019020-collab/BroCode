/** Bank read/write + seeder from the real curriculum (no fabrication). */
const fs = require('fs');
const path = require('path');
const { validateBank, coverageGate, norm } = require('./validate.cjs');

const QUESTIONS_DIR = path.join(__dirname, '..', '..', 'public', 'generated', 'questions');
const SECTIONS_JSON = path.join(__dirname, '..', '..', 'public', 'generated', 'curriculum', 'sections.json');

const loadSections = () => JSON.parse(fs.readFileSync(SECTIONS_JSON, 'utf8'));

const bankPath = (sid) => path.join(QUESTIONS_DIR, `${sid}.json`);
const bankExists = (sid) => fs.existsSync(bankPath(sid));
const loadBank = (sid) => JSON.parse(fs.readFileSync(bankPath(sid), 'utf8'));
const saveBank = (bank) => {
  fs.mkdirSync(QUESTIONS_DIR, { recursive: true });
  fs.writeFileSync(bankPath(bank.sectionId), JSON.stringify(bank, null, 1));
};
const allSectionIds = () => loadSections().map((s) => s.id);
/** Bank files only — manifest.json is pipeline metadata, not a bank. */
const existingBankIds = () => fs.existsSync(QUESTIONS_DIR)
  ? fs.readdirSync(QUESTIONS_DIR).filter((f) => f.endsWith('.json') && f !== 'manifest.json').map((f) => f.replace(/\.json$/, ''))
  : [];

const difficultyOf = (d) => (['easy', 'medium', 'hard', 'interview', 'debug'].includes(d) ? (d === 'interview' ? 'medium' : d === 'debug' ? 'hard' : d) : 'medium');

const isPlaceholder = (s) => /^\(/.test(String(s ?? '').trim());

/**
 * Seed a bank from the section's REAL content: interview, coding, debug, logic, solved, checkpoint.
 * Honest seeding — nothing is fabricated:
 *  · duplicate question text (curriculum repeats solved examples as coding tasks) → skipped,
 *    and the earlier record is enriched with the solved example's real solution if it only had a placeholder;
 *  · empty/missing answers (some logic/checkpoint entries) → skipped;
 *  · too-short question texts (PDF extraction artifacts) → skipped.
 * Skips are counted and reported; coverage flags stay honest.
 */
function seedBank(section, generatedAt = new Date().toISOString()) {
  const sid = section.id;
  const questions = [];
  const counters = {};
  const seenText = new Map(); // normalized question text -> record
  const skipped = { duplicateText: 0, missingAnswer: 0, tooShort: 0 };

  const push = (type, q) => {
    const text = String(q.question ?? '');
    if (norm(text).length < 8) { skipped.tooShort++; return; }
    if (!q.answer || String(q.answer).trim().length < 2) { skipped.missingAnswer++; return; }
    const nq = norm(text);
    const prev = seenText.get(nq);
    if (prev) {
      skipped.duplicateText++;
      // The solved variant often carries the real solution for a coding task that only had a placeholder.
      if (isPlaceholder(prev.answer) && !isPlaceholder(q.answer)) {
        prev.answer = q.answer;
        if (/^(Run the task|Try first|See model)/.test(String(prev.explanation ?? '')) && q.explanation) prev.explanation = q.explanation;
      }
      return;
    }
    const i = (counters[type] = (counters[type] ?? -1) + 1);
    const rec = {
      id: `${sid}:${type}:${i}`,
      sectionId: sid,
      type,
      difficulty: q.difficulty,
      importance: q.importance,
      priority: q.importance === 'must_know' ? 'P0' : 'P2',
      status: 'PUBLISHED',
      question: text,
      answer: q.answer,
      explanation: q.explanation,
      source: 'curriculum',
      tags: q.tags,
    };
    seenText.set(nq, rec);
    questions.push(rec);
  };

  section.interview.forEach((q) => push('interview', {
    difficulty: 'medium', importance: 'interview_critical',
    question: q.q, answer: q.a,
    explanation: [q.tip && `TIP: ${q.tip}`, q.fu && `FOLLOW-UP: ${q.fu}`].filter(Boolean).join(' · ') || 'See model answer.',
    tags: [],
  }));
  section.coding.forEach((t) => push(t.difficulty === 'debug' ? 'debug' : 'coding', {
    difficulty: difficultyOf(t.difficulty), importance: 'must_know',
    question: t.text, answer: t.solution || '(solve in the Coding Lab)',
    explanation: t.check || 'Run the task in the Coding Lab and compare with the expected output.',
    tags: t.difficulty ? [t.difficulty] : [],
  }));
  section.logic.forEach((l) => push('logic', {
    difficulty: 'medium', importance: 'high_value',
    question: `${l.kind}: ${l.text}`, answer: l.answer,
    explanation: 'Predict first, then verify by running the code.',
    tags: [l.kind],
  }));
  section.solved.forEach((it) => push('solved', {
    difficulty: difficultyOf(it.difficulty), importance: 'high_value',
    question: it.text, answer: it.solution || '(see solution)',
    explanation: it.result ? `Expected result: ${it.result}` : 'Try first, then compare with the answer key.',
    tags: it.difficulty ? [it.difficulty] : [],
  }));
  section.checkpoint.forEach((c) => push('checkpoint', {
    difficulty: 'hard', importance: 'interview_critical',
    question: c.q, answer: c.key,
    explanation: 'Self-grade against the key points.',
    tags: [],
  }));

  const bank = {
    sectionId: sid,
    title: section.title,
    contentVersion: '1.0.0',
    generatedAt,
    topics: section.learn.concepts.map((c) => c.title),
    questions,
    flags: [],
  };
  return { bank, count: questions.length, skipped };
}

const MANIFEST_PATH = path.join(QUESTIONS_DIR, 'manifest.json');
/** Every bank targets this many questions; below it a bank is honestly incomplete. */
const BASELINE_PER_SECTION = 50;

/**
 * Merge candidate records into a bank. Duplicate ids and duplicate question texts
 * are SKIPPED (never overwritten) so re-running an import is a no-op.
 */
function mergeIntoBank(bank, items, sid) {
  const existingIds = new Set(bank.questions.map((q) => q.id));
  const existingNorms = new Set(bank.questions.map((q) => norm(q.question)));
  const added = [];
  const skipped = { byId: 0, byText: 0 };
  for (const q of items) {
    const rec = { priority: 'P2', status: 'DRAFT', tags: [], ...q, sectionId: sid };
    if (existingIds.has(rec.id)) { skipped.byId++; continue; }
    const nq = norm(rec.question);
    if (existingNorms.has(nq)) { skipped.byText++; continue; }
    existingIds.add(rec.id);
    existingNorms.add(nq);
    bank.questions.push(rec);
    added.push(rec);
  }
  const byStatus = added.reduce((acc, q) => { acc[q.status] = (acc[q.status] ?? 0) + 1; return acc; }, {});
  return { added, skipped, byStatus };
}

/**
 * The lesson's stage → bank-type map, mirrored from `src/core/data/questions.ts` (`STAGE_QNA` +
 * `STAGE_OWN_ARRAY`) for the build step.
 *
 * It exists in two languages because the pipeline is CommonJS and the app is TypeScript, so
 * neither can import the other. `scripts/tests/lessonqna.test.mjs` closes that gap: it re-counts
 * every stage of every section through the RUNTIME functions and fails if this copy drifts. A
 * `own` extractor lists the flattened question texts the stage renders itself — those items are
 * skipped, because the panel below the stage does not show them either.
 */
const STAGE_QNA_BUILD = {
  learn: { types: ['theory'] },
  interview: { types: ['interview'], own: (s) => (s.interview ?? []).map((x) => x.q) },
  coding: { types: ['coding'], own: (s) => (s.coding ?? []).filter((x) => x.difficulty !== 'debug').map((x) => x.text) },
  logic: { types: ['logic'], own: (s) => (s.logic ?? []).map((x) => x.text) },
  debug: { types: ['debug'] },
  solved: { types: ['solved'], own: (s) => (s.solved ?? []).map((x) => x.text) },
  mini: { types: ['coding'], tag: 'mini-project' },
  defense: { types: ['defense'] },
  checkpoint: { types: ['checkpoint'], own: (s) => (s.checkpoint ?? []).map((x) => x.q) },
};

/** Whitespace/case-insensitive text key — MUST stay identical to `normText` in src/core/data/questions.ts. */
const textKey = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** How many questions a lesson stage's panel shows for this section (published, after dedupe). */
function stageCounts(bank, section) {
  const byStage = {};
  for (const [stage, spec] of Object.entries(STAGE_QNA_BUILD)) {
    const own = new Set((spec.own ? spec.own(section) : []).map(textKey));
    byStage[stage] = bank.questions.filter((q) => {
      if (q.status !== 'PUBLISHED') return false;
      if (!spec.types.includes(q.type)) return false;
      if (q.type === 'coding') {
        const isMini = (q.tags ?? []).includes('mini-project');
        if (spec.tag ? !isMini : isMini) return false;
      }
      return !own.has(textKey(q.question));
    }).length;
  }
  return byStage;
}

/** Write public/generated/questions/manifest.json — the UI's index of banks (no 29-file fetch). */
function writeManifest() {
  const entries = [];
  let total = 0, published = 0;
  for (const s of loadSections()) {
    if (!bankExists(s.id)) continue;
    const bank = loadBank(s.id);
    const { stats } = validateBank(bank);
    const { flags } = coverageGate(bank, stats);
    // The per-LESSON-stage counts. `byType` alone cannot separate MINI PROJECT from CODING LAB
    // (both are `coding`) and cannot know that the stage above the panel renders some questions
    // itself, so the tile would promise more than the learner can find. `byStage` is the number
    // the panel will really show — computed here by the build mirror, verified against the
    // runtime by lessonqna.test.mjs.
    const byStage = stageCounts(bank, s);
    let miniProject = 0;
    for (const q of bank.questions) {
      if ((q.tags ?? []).includes('mini-project')) miniProject++;
    }
    entries.push({
      sectionId: s.id, no: s.no, title: s.title,
      total: stats.total, published: stats.published,
      byType: stats.byType, byDifficulty: stats.byDifficulty, byStage, miniProject, flags,
    });
    total += stats.total;
    published += stats.published;
  }
  const manifest = { generatedAt: new Date().toISOString(), baseline: BASELINE_PER_SECTION, total, published, sections: entries };
  fs.mkdirSync(QUESTIONS_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 1));
  return manifest;
}

function seedAll({ force = false } = {}) {
  const sections = loadSections();
  let created = 0, skippedBanks = 0, questions = 0;
  const dropped = { duplicateText: 0, missingAnswer: 0, tooShort: 0 };
  for (const s of sections) {
    if (bankExists(s.id) && !force) { skippedBanks++; continue; }
    const r = seedBank(s);
    saveBank(r.bank);
    created++;
    questions += r.count;
    for (const k of Object.keys(dropped)) dropped[k] += r.skipped[k];
  }
  return { created, skipped: skippedBanks, total: sections.length, questions, dropped };
}

module.exports = {
  loadSections, bankPath, bankExists, loadBank, saveBank, allSectionIds, existingBankIds,
  seedBank, seedAll, mergeIntoBank, writeManifest, norm, textKey, stageCounts, STAGE_QNA_BUILD,
  QUESTIONS_DIR, MANIFEST_PATH, BASELINE_PER_SECTION,
};
