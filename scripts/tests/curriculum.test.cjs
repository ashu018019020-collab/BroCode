/**
 * Curriculum hygiene tests — guards the learn content that feeds the Lesson
 * "CODE EDITOR" and the coach panel.
 *
 * The learn concepts are rebuilt from the PDF by `scripts/learn.cjs`, which is
 * the only sane way to keep them clean (the PDF's text layer mashes code,
 * comments and page furniture). These tests assert the invariants that rebuild
 * guarantees, so a hand edit or a stale extraction can never quietly ship
 * garbage into the editor.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SECTIONS = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'curriculum', 'sections.json'), 'utf8'));
const OVERRIDES = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'curriculum', 'learn-overrides.json'), 'utf8'));
const STAGE_OVERRIDES = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'curriculum', 'stage-overrides.json'), 'utf8'));

const allConcepts = () => SECTIONS.flatMap((s) => (s.learn?.concepts ?? []).map((c) => ({ sec: s, c })));
const normTitle = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

/** Concepts deliberately without a snippet (intro overviews and interview pages). */
const NO_CODE_TITLES = new Set(['Section overview', 'Interview Depth']);

test('curriculum: 29 sections and 163 PDF-derived learn concepts are present', () => {
  assert.equal(SECTIONS.length, 29);
  // The guided layer is additive (scripts/guides.cjs): when the extraction had no lesson for
  // a required topic the guide creates one and marks it `authoredTopic`. That must never be
  // confused with PDF-derived content, so the extracted layer stays exactly 163.
  const authored = allConcepts().filter(({ c }) => c.authoredTopic === true);
  assert.equal(allConcepts().length - authored.length, 163, 'PDF-derived concept count drifted');
  assert.ok(authored.every(({ c }) => c.guide?.authored === true),
    'an authoredTopic concept must carry an authored guide');
});

test('curriculum: no concept title is a leaked table of contents', () => {
  const offenders = allConcepts()
    .filter(({ c }) => ((c.title || '').match(/\d{1,2}\.\d{1,2}/g) || []).length >= 2)
    .map(({ sec, c }) => `${sec.id}: ${c.title.slice(0, 60)}`);
  assert.deepEqual(offenders, [], `TOC-like titles:\n${offenders.join('\n')}`);
});

test('curriculum: code never contains merged comments, over-long lines or page headers', () => {
  const offenders = [];
  for (const { sec, c } of allConcepts()) {
    const code = (c.code || '').trim();
    if (!code) continue;
    if (/#[^#\n]*#[^#\n]*#/.test(code)) offenders.push(`${sec.id}/${c.title}: merged comment run`);
    if (code.split('\n').some((l) => l.length > 90)) offenders.push(`${sec.id}/${c.title}: line > 90 chars`);
    if (/GALTI SE BACHO/.test(code)) offenders.push(`${sec.id}/${c.title}: "GALTI SE BACHO" banner in code`);
    if (/\b\d{1,2}\.\d{1,2}\s+[A-Z][a-z]/.test(code)) offenders.push(`${sec.id}/${c.title}: section heading in code`);
    if (/\b(main\.py|example\.py|\bPDF p\.)/.test(code)) offenders.push(`${sec.id}/${c.title}: file/page label in code`);
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('curriculum: prose never carries the leaked level chip or page furniture', () => {
  const offenders = [];
  for (const { sec, c } of allConcepts()) {
    const body = (c.body || '').trim();
    if (/^(CORE|ADVANCED|NOTES|BEGINNER)\b/.test(body)) offenders.push(`${sec.id}/${c.title}: body starts with a level chip`);
    if (/\bPDF p\. \d+/.test(body)) offenders.push(`${sec.id}/${c.title}: "PDF p." in body`);
    if (/\bOUTPUT\b\s*$/.test(body) || /OUTPUT\s+[\[\(]/.test(body)) offenders.push(`${sec.id}/${c.title}: OUTPUT dump in body`);
    if (/\bSTEP BY STEP: KAISE CHALTA HAI\?/.test(body)) offenders.push(`${sec.id}/${c.title}: step banner in body`);
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('curriculum: every code-bearing concept is a real, non-empty snippet', () => {
  const expected = ['Interview Depth', 'Section overview'].sort();
  for (const { sec, c } of allConcepts()) {
    if (c.level === 'notes') continue;                       // study-notes pages carry no code
    if (NO_CODE_TITLES.has(c.title)) {                       // overviews / interview pages
      assert.equal((c.code || '').trim(), '', `${sec.id}/${c.title} should have no code`);
      continue;
    }
    assert.ok((c.code || '').trim(), `${sec.id}/${c.title} is missing code`);
  }
  // The deliberately code-free set must not silently grow.
  const codeFree = allConcepts().filter(({ c }) => c.level !== 'notes' && !(c.code || '').trim());
  assert.equal(codeFree.length, 16, `code-free concepts: ${codeFree.map(({ sec, c }) => `${sec.id}/${c.title}`).join(', ')}`);
  assert.deepEqual([...new Set(codeFree.map(({ c }) => c.title))].sort(), expected);
});

test('curriculum: a Python block that opens an indented body is actually indented', () => {
  const offenders = [];
  for (const { sec, c } of allConcepts()) {
    const lines = (c.code || '').split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const cur = lines[i].trim();
      const nxt = lines[i + 1];
      if (!cur.endsWith(':') || /^#/.test(cur)) continue;
      if (!nxt.trim() || /^\s/.test(nxt) || /^#/.test(nxt.trim())) continue;
      offenders.push(`${sec.id}/${c.title}: "${cur.slice(0, 40)}" not followed by an indented line`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('overrides: file is well-formed and every target concept exists', () => {
  assert.ok(Array.isArray(OVERRIDES.concepts) && OVERRIDES.concepts.length > 0);
  const secIds = new Set(SECTIONS.map((s) => s.id));
  const seen = new Set();
  for (const o of OVERRIDES.concepts) {
    assert.ok(secIds.has(o.section), `unknown section in overrides: ${o.section}`);
    assert.equal(typeof o.title, 'string', `override without a title in ${o.section}`);
    assert.equal(typeof o.code, 'string', `${o.section}/${o.title} override needs a code string`);
    const key = `${o.section}|${normTitle(o.title)}`;
    assert.ok(!seen.has(key), `duplicate override target: ${o.section}/${o.title}`);
    seen.add(key);
    const target = SECTIONS.find((s) => s.id === o.section)?.learn?.concepts?.find((c) => normTitle(c.title) === normTitle(o.title));
    assert.ok(target, `override target missing from sections.json: ${o.section}/${o.title}`);
    if (o.title !== 'Interview Depth') {
      assert.equal(target.code, o.code, `override not applied to ${o.section}/${o.title} — run: npm run curriculum:learn:write`);
    }
  }
});

test('stage overrides: every curated logic/coding card is applied to sections.json', () => {
  assert.ok(Array.isArray(STAGE_OVERRIDES.logic) && Array.isArray(STAGE_OVERRIDES.coding));
  const byId = new Map(SECTIONS.map((s) => [s.id, s]));

  for (const ov of STAGE_OVERRIDES.logic) {
    const cards = (byId.get(ov.section)?.logic ?? []).filter((l) => l.kind === ov.kind);
    assert.equal(cards.length, 1, `${ov.section}/${ov.kind}: expected exactly one logic card`);
    assert.equal(cards[0].text, ov.text, `override not applied to ${ov.section}/${ov.kind} — run: npm run curriculum:stages:write`);
    assert.equal(cards[0].answer, ov.answer, `${ov.section}/${ov.kind}: answer out of sync with the overlay`);
  }

  for (const ov of STAGE_OVERRIDES.coding) {
    const item = (byId.get(ov.section)?.coding ?? []).find((c) => c.text === ov.text);
    assert.ok(item, `override not applied to ${ov.section} — run: npm run curriculum:stages:write`);
    assert.equal(item.solution, ov.solution, `${ov.section}: solution out of sync with the overlay`);
    assert.ok(item.solution.trim(), `${ov.section}: coding task has no real solution`);
  }
});

test('curriculum: no logic or coding stage text repeats across sections', () => {
  // The PDF boilerplates the same generic prompts into every module; the stage overlay
  // replaces them with section-specific cards. This is the invariant that keeps them out.
  const seen = new Map();
  const offenders = [];
  for (const sec of SECTIONS) {
    const texts = [
      ...(sec.logic ?? []).map((l) => `${l.kind}: ${l.text}`),
      ...(sec.coding ?? []).map((c) => String(c.text)),
    ];
    for (const t of texts) {
      const key = t.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seen.has(key) && seen.get(key) !== sec.id) offenders.push(`${sec.id} repeats ${seen.get(key)}: ${t.slice(0, 60)}`);
      else seen.set(key, sec.id);
    }
  }
  assert.deepEqual(offenders, [], `repeated stage text:\n${offenders.slice(0, 10).join('\n')}`);
});

test('pipeline: the learn rebuild tool and its npm script exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'learn.cjs')), 'scripts/learn.cjs missing');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts['curriculum:learn'], 'npm script curriculum:learn missing');
  assert.ok(pkg.scripts['curriculum:learn:write'], 'npm script curriculum:learn:write missing');
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'stages.cjs')), 'scripts/stages.cjs missing');
  assert.ok(pkg.scripts['curriculum:stages'], 'npm script curriculum:stages missing');
  assert.ok(pkg.scripts['curriculum:stages:write'], 'npm script curriculum:stages:write missing');
});
