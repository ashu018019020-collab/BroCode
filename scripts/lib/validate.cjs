/**
 * Validator for question banks (CJS, used by scripts/questions.cjs).
 *
 * `defense` is the Project Defense type (a bank question whose stage is the existing
 * `defense` lesson stage). `theory` is the Concept/Theory type. Both are first-class
 * so the quota report can prove 20-new-per-type-per-track without a separate tracker.
 */
const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];
const TYPES = ['interview', 'coding', 'debug', 'logic', 'solved', 'checkpoint', 'theory', 'defense'];
const IMPORTANCES = ['must_know', 'high_value', 'interview_critical', 'production', 'advanced'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const STATUSES = ['DRAFT', 'REVIEWED', 'PUBLISHED'];

/**
 * Dedupe key for a question/answer. Case- and whitespace-insensitive and it strips
 * decorative punctuation (backticks, quotes, dashes, commas), but KEEPS operator-like
 * symbols — otherwise distinct questions like "= aur == me fark?" and "/ aur // me
 * fark?" collapse into one key and get reported as duplicates. The key is strictly more
 * specific than a blanket [^a-z0-9] strip, so it can only remove duplicate reports,
 * never invent new ones.
 */
const norm = (s) => (s ?? '')
  .toLowerCase()
  .replace(/[`"'\u2018\u2019\u201c\u201d,\u201e;\u2026\u00b7\u00ab\u00bb\u2013\u2014]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function validateBank(bank, { strictSource = true } = {}) {
  const problems = [];
  const seenIds = new Set();
  const seenNorm = new Map();   // normalized question text -> id (exact dupes)
  const conceptAnswers = new Map(); // `${norm(q)}|${norm(a)}` -> id (same q + a dupes)

  if (!bank.sectionId || typeof bank.sectionId !== 'string') problems.push('bank.sectionId missing');
  if (!Array.isArray(bank.questions)) { problems.push('bank.questions must be an array'); return { problems, stats: { total: 0 } }; }
  if (!bank.title) problems.push('bank.title missing');

  for (const q of bank.questions) {
    const at = q.id || '(no id)';
    for (const f of ['id', 'sectionId', 'type', 'difficulty', 'importance', 'priority', 'status', 'question', 'answer', 'explanation', 'source']) {
      if (q[f] === undefined || q[f] === null || q[f] === '') problems.push(`${at}: missing field "${f}"`);
    }
    if (!TYPES.includes(q.type)) problems.push(`${at}: bad type "${q.type}"`);
    if (!DIFFICULTIES.includes(q.difficulty)) problems.push(`${at}: bad difficulty "${q.difficulty}"`);
    if (!IMPORTANCES.includes(q.importance)) problems.push(`${at}: bad importance "${q.importance}"`);
    if (!PRIORITIES.includes(q.priority)) problems.push(`${at}: bad priority "${q.priority}"`);
    if (!STATUSES.includes(q.status)) problems.push(`${at}: bad status "${q.status}"`);
    if (q.sectionId !== bank.sectionId) problems.push(`${at}: sectionId mismatch with bank`);
    if (String(q.question ?? '').length < 8) problems.push(`${at}: question too short`);
    if (String(q.answer ?? '').length < 2) problems.push(`${at}: answer missing/empty`);

    // duplicate detection
    if (seenIds.has(q.id)) problems.push(`${at}: duplicate id`);
    seenIds.add(q.id);
    const nq = norm(q.question);
    if (seenNorm.has(nq)) problems.push(`${at}: exact duplicate of ${seenNorm.get(nq)}`);
    seenNorm.set(nq, q.id);
    const qaKey = `${nq}|${norm(q.answer)}`;
    if (conceptAnswers.has(qaKey)) problems.push(`${at}: same question+answer as ${conceptAnswers.get(qaKey)}`);
    conceptAnswers.set(qaKey, q.id);

    // source verification for version-sensitive content
    if (strictSource && q.source !== 'curriculum' && !(q.verifiedAt && (q.sourceVersion || q.type === 'theory'))) {
      problems.push(`${at}: version-sensitive source needs sourceVersion + verifiedAt`);
    }
  }

  const stats = {
    total: bank.questions.length,
    published: bank.questions.filter((q) => q.status === 'PUBLISHED').length,
    byType: Object.fromEntries(TYPES.map((t) => [t, bank.questions.filter((q) => q.type === t).length])),
    byDifficulty: Object.fromEntries(DIFFICULTIES.map((d) => [d, bank.questions.filter((q) => q.difficulty === d).length])),
    byImportance: Object.fromEntries(IMPORTANCES.map((i) => [i, bank.questions.filter((q) => q.importance === i).length])),
    duplicates: problems.filter((p) => p.includes('duplicate')).length,
    unverified: bank.questions.filter((q) => q.source !== 'curriculum' && !q.verifiedAt).length,
  };
  return { problems, stats };
}

/** Quality gate: <50 per section (or missing answers) ⇒ CONTENT_INCOMPLETE. */
function coverageGate(bank, vstats) {
  const flags = [...(bank.flags ?? [])];
  const hasGap = vstats.total < 50 || vstats.published < vstats.total;
  const incomplete = hasGap && !flags.includes('CONTENT_INCOMPLETE');
  if (incomplete) flags.push('CONTENT_INCOMPLETE');
  return { flags, complete: vstats.total >= 50 && vstats.published === vstats.total };
}

module.exports = { validateBank, coverageGate, norm, TYPES, DIFFICULTIES, IMPORTANCES };
