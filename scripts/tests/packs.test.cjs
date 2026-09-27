/**
 * Topic-workspace invariants — the 16-part structure, locked as tests.
 *
 * The packs pipeline is where "har topic ka content usi topic ke andar" becomes checkable
 * rather than aspirational, so these tests assert the properties the CLI enforces, using the
 * same library definitions (never a second copy of the rules):
 *
 *   · every authored pack in content/curriculum/packs must pass the shape check — a pack that
 *     is missing coding practice, debug tasks, challenges, projects or the revision checklist
 *     cannot ship;
 *   · what is applied in public/curriculum/sections.json must match its source pack, so the
 *     file the UI renders is never a stale or hand-edited copy;
 *   · an applied topic must satisfy all 16 parts, and one "broken" snippet may never be
 *     identical to its "fix" (that would teach nothing);
 *   · no question text may repeat inside one topic, and no topic may be applied to a section
 *     whose subject it does not match;
 *   · every authored item must state honestly whether its output was really produced
 *     (`verified: true`) or documented because a bundled-only module was unavailable.
 *
 * Execution (running every snippet through python) stays in `npm run packs` — that gate is
 * slow by design and must run before writing, not on every test pass.
 *
 * Zero dependencies — built-in node:test runner. `npm test`
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PACKS_DIR = path.join(ROOT, 'content', 'curriculum', 'packs');
const SECTIONS_JSON = path.join(ROOT, 'public', 'curriculum', 'sections.json');

const { validatePack, partCoverage, PARTS, PRACTICE_LEVELS, CHALLENGE_KINDS, PROJECT_LEVELS } = require('../lib/packs.cjs');

const sections = JSON.parse(fs.readFileSync(SECTIONS_JSON, 'utf8'));
const byId = new Map(sections.map((s) => [s.id, s]));
const packFiles = fs.existsSync(PACKS_DIR)
  ? fs.readdirSync(PACKS_DIR).filter((f) => f.endsWith('.json')).sort()
  : [];
const packs = packFiles.map((f) => ({ file: f, pack: JSON.parse(fs.readFileSync(path.join(PACKS_DIR, f), 'utf8')) }));

const squash = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();

/* ------------------------------- shape gates ------------------------------ */

test('packs: every authored pack satisfies the 16-part shape rules', () => {
  assert.ok(packs.length > 0, 'expected at least one authored pack in content/curriculum/packs');
  for (const { file, pack } of packs) {
    const problems = validatePack(pack, file);
    assert.deepEqual(problems, [], `${file} has shape problems`);
  }
});

test('packs: pack file is named after the section it belongs to', () => {
  for (const { file, pack } of packs) {
    assert.equal(file, `${pack.section}.json`, `${file} should be named ${pack.section}.json`);
    assert.ok(byId.has(pack.section), `${file} points at unknown section ${pack.section}`);
  }
});

test('packs: every pack covers all five practice levels and the whole challenge ladder', () => {
  for (const { file, pack } of packs) {
    for (const level of PRACTICE_LEVELS) {
      assert.ok((pack.practice[level] ?? []).length >= 3, `${file}: practice.${level} too thin`);
    }
    const kinds = new Set(pack.challenges.map((c) => c.kind));
    for (const k of CHALLENGE_KINDS) assert.ok(kinds.has(k), `${file}: challenge "${k}" missing`);
    const levels = new Set(pack.projects.map((p) => p.level));
    for (const l of PROJECT_LEVELS) assert.ok(levels.has(l), `${file}: project "${l}" missing`);
  }
});

/* --------------------------- topic purity & honesty --------------------------- */

test('packs: no question text repeats inside one topic', () => {
  for (const { file, pack } of packs) {
    const texts = [
      ...pack.interview.map((x) => x.q),
      ...PRACTICE_LEVELS.flatMap((l) => pack.practice[l].map((x) => x.q)),
      ...pack.coding.map((x) => x.question),
      ...pack.projects.flatMap((p) => p.interview.map((q) => q.q)),
      ...pack.interviewTasks.map((x) => x.q),
    ].map(squash);
    const seen = new Set();
    for (const t of texts) {
      assert.ok(!seen.has(t), `${file}: duplicate question text "${t.slice(0, 60)}"`);
      seen.add(t);
    }
  }
});

test('packs: a debugging task never ships identical broken and correct code', () => {
  for (const { file, pack } of packs) {
    for (const [i, d] of pack.debugging.entries()) {
      assert.notEqual(squash(d.broken), squash(d.correct), `${file}: debugging ${i} fix is identical to the bug`);
      assert.ok(['raise', 'logic', undefined].includes(d.mode), `${file}: debugging ${i} bad mode ${d.mode}`);
    }
  }
});

test('packs: every source snippet that must run is present in the pack', () => {
  for (const { file, pack } of packs) {
    for (const [i, ex] of pack.examples.entries()) assert.ok(ex.code?.trim(), `${file}: example ${i} has no code`);
    for (const [i, t] of pack.coding.entries()) assert.ok(t.solution?.trim(), `${file}: coding ${i} has no solution`);
    for (const [i, d] of pack.debugging.entries()) {
      assert.ok(d.broken?.trim() && d.correct?.trim(), `${file}: debugging ${i} needs both broken and correct code`);
    }
    for (const [i, p] of pack.projects.entries()) assert.ok(p.code?.trim(), `${file}: project ${i} has no code`);
  }
});

test('packs: every applied code item states whether its output was really produced', () => {
  // The applied topic is the one the UI renders, and it is the one the writer stamped after
  // execution — so this is where the honesty claim has to be visible to the learner.
  for (const { pack } of packs) {
    const t = byId.get(pack.section).topic;
    const coders = [
      ...t.examples.filter((x) => x.code),
      ...PRACTICE_LEVELS.flatMap((l) => t.practice[l].filter((x) => x.code)),
      ...t.coding,
      ...t.debugging,
      ...t.projects.filter((p) => p.code),
    ];
    for (const item of coders) {
      assert.equal(typeof item.verified, 'boolean', `${pack.section}: applied code item without a verified flag`);
      if (item.verified) assert.equal(typeof item.output, 'string', `${pack.section}: verified item without an output field`);
    }
  }
});

/* ------------------------------- applied state ------------------------------ */

test('packs: every applied section.topic matches its authored source pack', () => {
  for (const { pack } of packs) {
    const section = byId.get(pack.section);
    assert.ok(section?.topic, `${pack.section} has a pack but no applied section.topic — run npm run packs:write`);
    assert.equal(section.topic.topic, pack.topic, `${pack.section}: applied topic label drifted from the pack`);
    assert.equal(section.topic.authored, true, `${pack.section}: applied topic must declare authored:true`);
    assert.equal(section.topic.coding.length, pack.coding.length, `${pack.section}: applied coding tasks drifted`);
    assert.equal(section.topic.debugging.length, pack.debugging.length, `${pack.section}: applied debug tasks drifted`);
    assert.equal(section.topic.revision.length, pack.revision.length, `${pack.section}: applied revision list drifted`);
  }
});

test('packs: every applied topic satisfies all 16 parts', () => {
  for (const { pack } of packs) {
    const cov = partCoverage(byId.get(pack.section));
    assert.equal(cov.done, PARTS.length, `${pack.section} missing parts: ${cov.missing.join(', ')}`);
    assert.ok(cov.complete, `${pack.section} is not complete`);
  }
});

test('packs: a topic is never applied to a section about something else', () => {
  // Cheap sanity that the pack was authored for the right section: the section title must
  // share a meaningful word with the topic label (avoids a copy-paste landing on s19).
  const stop = new Set(['python', 'for', 'and', 'the', 'with', 'advanced', 'basics']);
  for (const { pack } of packs) {
    const section = byId.get(pack.section);
    const words = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !stop.has(w));
    const shared = words(section.title).filter((w) => words(pack.topic).includes(w));
    assert.ok(shared.length > 0, `${pack.section} ("${section.title}") does not match topic "${pack.topic}"`);
  }
});

test('packs: only sections with an authored pack carry a workspace', () => {
  const authored = new Set(packs.map(({ pack }) => pack.section));
  for (const s of sections) {
    if (authored.has(s.id)) continue;
    assert.equal(s.topic, undefined, `${s.id} carries a workspace with no source pack in content/curriculum/packs`);
  }
});
