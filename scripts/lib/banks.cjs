/** Bank read/write + seeder from the real curriculum (no fabrication). */
const fs = require('fs');
const path = require('path');

const QUESTIONS_DIR = path.join(__dirname, '..', '..', 'public', 'questions');
const SECTIONS_JSON = path.join(__dirname, '..', '..', 'public', 'curriculum', 'sections.json');

const loadSections = () => JSON.parse(fs.readFileSync(SECTIONS_JSON, 'utf8'));

const bankPath = (sid) => path.join(QUESTIONS_DIR, `${sid}.json`);
const bankExists = (sid) => fs.existsSync(bankPath(sid));
const loadBank = (sid) => JSON.parse(fs.readFileSync(bankPath(sid), 'utf8'));
const saveBank = (bank) => {
  fs.mkdirSync(QUESTIONS_DIR, { recursive: true });
  fs.writeFileSync(bankPath(bank.sectionId), JSON.stringify(bank, null, 1));
};
const allSectionIds = () => loadSections().map((s) => s.id);
const existingBankIds = () => fs.existsSync(QUESTIONS_DIR) ? fs.readdirSync(QUESTIONS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')) : [];

const difficultyOf = (d) => (['easy', 'medium', 'hard', 'interview', 'debug'].includes(d) ? (d === 'interview' ? 'medium' : d === 'debug' ? 'hard' : d) : 'medium');

const norm = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
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

module.exports = { loadSections, bankPath, bankExists, loadBank, saveBank, allSectionIds, existingBankIds, seedBank, seedAll, QUESTIONS_DIR };
