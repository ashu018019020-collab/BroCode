/**
 * Localization QA, as a test rather than a script someone remembers to run.
 *
 * Two things could regress silently: a UI key added to one pack and forgotten in the other (the
 * learner just sees an English sentence inside a Hinglish screen), and the CONTENT COVERAGE
 * numbers drifting away from the corpus. The second is why `scripts/lib/i18n-coverage.cjs` exists —
 * it was extracted from `scripts/i18n.cjs` precisely so it could be driven with fixtures here. The
 * reader it replaced opened the tracks INDEX with a FILE reader, so eight files were dropped and the
 * row still printed a confident total.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const { stateOf, contentLedger, ledgerTotals, CONTENT_SOURCES, overlayLedger } = require(path.join(ROOT, 'scripts', 'lib', 'i18n-coverage.cjs'));
const { buildOverlay, mapOverlay, nameCoverage } = require(path.join(ROOT, 'scripts', 'lib', 'i18n-sections.cjs'));
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));

/* ------------------------------ the field states ------------------------------ */

test('i18n: a field is only bilingual when BOTH sides are written', () => {
  assert.equal(stateOf({ en: 'Loops', hi: 'Loops chapter' }), 'full');
  assert.equal(stateOf({ en: 'Loops', hi: '' }), 'partial', 'an empty Hinglish side is not translated');
  assert.equal(stateOf({ en: 'Loops', hi: '   ' }), 'partial', 'whitespace is not a translation');
  assert.equal(stateOf({ hi: 'Loops chapter', en: '' }), 'partial');
  assert.equal(stateOf({ en: '', hi: '' }), 'missing');
  assert.equal(stateOf('Loops'), 'plain', 'a plain string is not translated YET, not translated');
  assert.equal(stateOf(''), 'missing');
  assert.equal(stateOf(undefined), 'missing');
  assert.equal(stateOf(null), 'missing');
  assert.equal(stateOf(42), 'plain', 'a machine value is language-neutral, never bilingual');
});

/* ------------------------------ the perFile bug ------------------------------- */

test('i18n: an indexed source is read through its FILE reader, once per real file', () => {
  // The exact regression: `tracks` is an index whose `fields` reader expects ONE track file. Reading
  // the index document directly yields `undefined` for every field and reports 0 of 0.
  const fixture = {
    'content/courses/courses.json': { courses: [] },
    'public/generated/curriculum/sections.json': [],
    'content/tracks/index.json': [{ slug: 'python-core' }, { slug: 'sql' }],
    'content/tracks/python-core.json': { title: 'Python Core', description: 'Core Python', chapters: [{}] },
    // An EMPTY `chapters` array is falsy in length, so this file legitimately contributes title only.
    'content/tracks/sql.json': { title: 'SQL', chapters: [] },
  };
  const ledger = contentLedger((relative) => {
    const value = fixture[relative];
    if (value === undefined) throw new Error(`fixture has no ${relative}`);
    return value;
  });
  const tracks = ledger.find((row) => row.label === 'tracks');
  assert.equal(tracks.files, 2, 'both indexed files must be opened');
  // python-core has chapters → title + description = 2 fields; sql has none → title only = 1 field.
  assert.equal(tracks.total, 3, 'a file WITH chapters contributes its description; one without does not');
  assert.equal(tracks.plain, 3, 'all three are still single strings');
  assert.equal(tracks.full, 0);
});

test('i18n: a source with zero readable fields is reported, never silently divided by zero', () => {
  const ledger = contentLedger((relative) => {
    if (relative.endsWith('index.json')) return [];
    if (relative.endsWith('courses.json')) return { courses: [] };
    return [];
  });
  assert.equal(ledger.length, CONTENT_SOURCES.length);
  for (const row of ledger) assert.equal(row.total, 0);
  assert.equal(ledgerTotals(ledger).total, 0);
});

/* --------------------------- the real corpus floor --------------------------- */

test('i18n: the real corpus reports the coverage it actually has, with every indexed file read', () => {
  const ledger = contentLedger(readJson);
  const courses = ledger.find((row) => row.label === 'courses');
  const tracks = ledger.find((row) => row.label === 'tracks');
  const sections = ledger.find((row) => row.label.startsWith('curriculum sections'));

  assert.ok(courses.total >= 11, 'the eleven authored courses are all in the denominator');
  assert.equal(courses.full, 11, 'all eleven course names are authored bilingually');
  assert.equal(courses.partial, 0);

  const trackIndex = readJson('content/tracks/index.json');
  assert.equal(tracks.files, trackIndex.length, 'every track in the index is read');
  assert.ok(tracks.total >= trackIndex.length, 'each track contributes at least its title');
  assert.equal(tracks.full, 0, 'no track is translated yet — the report must not imply otherwise');

  assert.equal(sections.total, 29, 'all 29 published curriculum sections are counted');
  assert.equal(sections.full, 0, 'no curriculum section title is translated yet');

  const totals = ledgerTotals(ledger);
  assert.equal(totals.total, courses.total + tracks.total + sections.total);
  assert.ok(totals.full < totals.total, 'the corpus is NOT fully translated; a report claiming so is a bug');

  // Every source must actually open the files it counted, so the printed file count is evidence:
  // a single-file source reads exactly one document, an indexed source reads its index PLUS each file.
  const indexed = new Set(CONTENT_SOURCES.filter((source) => source.perFile).map((source) => source.label));
  for (const row of ledger) {
    const expected = indexed.has(row.label) ? row.files + 1 : 1;
    assert.equal(row.present.length, expected, `${row.label} read ${row.present.length} files, expected ${expected}`);
    assert.ok(row.present.includes(row.present[0]));
  }
  for (const source of CONTENT_SOURCES.filter((entry) => entry.perFile)) {
    const row = ledger.find((entry) => entry.label === source.label);
    for (const file of source.perFile(readJson(source.file))) {
      assert.ok(row.present.includes(file), `${source.label} did not read ${file}`);
    }
  }
});

/* -------------------------------- packs parity -------------------------------- */

test('i18n: the locale packs stay in parity, with matching {placeholders}', () => {
  // `scripts/i18n.cjs` is a CLI that calls process.exit, so it runs as a child process rather than
  // being imported into the test runner.
  const result = spawnSync(process.execPath, ['scripts/i18n.cjs', 'check'], { cwd: ROOT, encoding: 'utf8' });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, `i18n:check failed:\n${output}`);
  assert.match(output, /translated in both packs/);
  assert.match(output, /every \{placeholder\} survives translation/);
  assert.doesNotMatch(output, /missing from the Hinglish pack/, 'a key exists in English but not Hinglish');
});

/* --------------------- the section-name overlay (bilingual) --------------------- */

test('i18n: an overlay id that matches no section is a DEFECT, never a silent gap', () => {
  const sections = [{ id: 's01', title: 'Variables & Data Types' }, { id: 's02', title: 'Operators' }];
  const ledger = mapOverlay(sections, { sections: { s01: 'Variables aur Data Types', s99: 'Ghost section' } });
  // s99 can never render: it must be reported, not dropped into the map and forgotten.
  assert.deepEqual(ledger.orphans, ['s99']);
  assert.deepEqual(Object.keys(ledger.sections), ['s01']);
  assert.deepEqual(ledger.missing, ['s02'], 'a section with no entry is "still to translate"');
  assert.deepEqual(ledger.counts, { sections: 2, named: 1, missing: 1, orphans: 1, blank: 0 });
  assert.deepEqual(nameCoverage(ledger.counts), { total: 2, translated: 1, pct: 50 });
});

test('i18n: a blank overlay value is not a translation, and never replaces an English title', () => {
  const sections = [{ id: 's01', title: 'Variables & Data Types' }];
  const blank = mapOverlay(sections, { sections: { s01: '   ' } });
  assert.deepEqual(blank.blank, ['s01']);
  assert.deepEqual(blank.sections, {}, 'a blank name must NOT be mapped — the English title stands');
  assert.deepEqual(blank.missing, ['s01']);
  assert.equal(buildOverlay(sections, { sections: { s01: '   ' } }).sections.s01, undefined);
});

test('i18n: the overlay never changes an id, and every section keeps an English fallback', () => {
  const sections = readJson('public/generated/curriculum/sections.json');
  const authored = readJson('content/curriculum/i18n/sections.json');
  const payload = buildOverlay(sections, authored);

  // Ids are identity and must be preserved exactly, in the same order, with English still present.
  assert.deepEqual(Object.keys(payload.sections), sections.map((section) => section.id));
  assert.ok(sections.every((section) => typeof section.title === 'string' && section.title.trim()));
  for (const [id, name] of Object.entries(payload.sections)) {
    assert.equal(typeof name, 'string');
    assert.ok(name.trim(), `${id} has an empty Hinglish name`);
  }
});

test('i18n: the published overlay is in sync with its authored source', () => {
  // The browser only ever reads the PUBLISHED merge, so a stale artifact means the translations the
  // author wrote are invisible. This is the same contract the bytes-for-bytes generators hold.
  const sections = readJson('public/generated/curriculum/sections.json');
  const authored = readJson('content/curriculum/i18n/sections.json');
  const expected = JSON.stringify(buildOverlay(sections, authored), null, 2) + '\n';
  const publishedPath = path.join(ROOT, 'public', 'generated', 'curriculum', 'i18n.json');
  assert.ok(fs.existsSync(publishedPath), 'public/generated/curriculum/i18n.json is missing');
  const actual = fs.readFileSync(publishedPath, 'utf8');
  assert.equal(actual, expected, 'stale overlay — run `npm run i18n:sections:write`');
});

test('i18n: the overlay ledger agrees with the authored file, and reports no orphan ids', () => {
  const overlay = overlayLedger(readJson);
  const sections = readJson('public/generated/curriculum/sections.json');
  assert.equal(overlay.total, sections.length, 'every generated section is in the denominator');
  assert.equal(overlay.named + overlay.missing, overlay.total);
  assert.equal(overlay.orphans, 0, 'every authored id must resolve to a real section');
  assert.equal(overlay.blank, 0, 'no empty Hinglish names');
  assert.equal(overlay.pct, Math.round((overlay.named / overlay.total) * 100));
});

test('i18n: the runtime resolver applies Hinglish, keeps English, and degrades safely', async () => {
  // The RULE lives in `core/learning/section-names.ts` — no runtime imports, so the test runner's
  // synchronous linker can load it. The fetching half (`core/data/curriculum-i18n.ts`) imports
  // `./localize` and is deliberately not reachable from a test; it only wires this rule to a fetch.
  const { resolveSectionTitle, localizeSectionTitles } = await import(
    pathToFileURL(path.join(ROOT, 'src', 'core', 'learning', 'section-names.ts')).href
  );
  const sections = [
    { id: 's01', title: 'Variables & Data Types' },
    { id: 's02', title: 'Operators' },
  ];
  const overlay = { s01: 'Variables aur Data Types' };

  const hinglish = localizeSectionTitles(sections, 'hi', overlay);
  assert.equal(hinglish[0].title, 'Variables aur Data Types');
  assert.equal(hinglish[1].title, 'Operators', 'no entry → the English title stands');
  assert.equal(sections[0].title, 'Variables & Data Types', 'the source array must not be mutated');

  // English returns the SAME array (no allocation, stable identity for memo consumers).
  assert.equal(localizeSectionTitles(sections, 'en', overlay), sections);
  // A missing overlay is the honest "not translated yet" state, not an error.
  assert.equal(localizeSectionTitles(sections, 'hi', null), sections);
  assert.equal(localizeSectionTitles(sections, 'hi', {}), sections);

  // A section that already carries an authored bilingual map wins over the overlay.
  const inline = [{ id: 's01', title: { en: 'Variables & Data Types', hi: 'Variables aur Types' } }];
  assert.equal(localizeSectionTitles(inline, 'hi', overlay)[0].title, 'Variables aur Types');
  assert.equal(localizeSectionTitles(inline, 'en', overlay)[0].title, 'Variables & Data Types');
  // A map with an empty Hinglish side falls back to its own English, never a blank heading.
  const half = [{ id: 's03', title: { en: 'Strings', hi: '   ' } }];
  assert.equal(localizeSectionTitles(half, 'hi', overlay)[0].title, 'Strings');

  // An empty overlay value never blanks a heading.
  assert.equal(resolveSectionTitle({ id: 's01', title: 'Operators' }, 'hi', { s01: '  ' }), 'Operators');
  assert.equal(resolveSectionTitle({ id: 's99', title: 'Operators' }, 'hi', overlay), 'Operators');
  assert.equal(resolveSectionTitle({ id: 's99', title: '' }, 'hi', overlay), '');
});

test('i18n: every real section resolves to a NON-EMPTY name in both languages', async () => {
  // The end-to-end guarantee, over the real corpus: no id, no overlay and no language may produce a
  // blank heading. This is what the boundary in `core/data/curriculum.tsx` promises every renderer.
  const { resolveSectionTitle } = await import(
    pathToFileURL(path.join(ROOT, 'src', 'core', 'learning', 'section-names.ts')).href
  );
  const sections = readJson('public/generated/curriculum/sections.json');
  const authored = readJson('content/curriculum/i18n/sections.json');
  const overlay = {};
  for (const [id, value] of Object.entries(authored.sections)) {
    if (typeof value === 'string' && value.trim()) overlay[id] = value.trim();
  }
  assert.ok(Object.keys(overlay).length > 0, 'the overlay must actually carry names');
  for (const section of sections) {
    for (const locale of ['en', 'hi']) {
      const name = resolveSectionTitle(section, locale, overlay);
      assert.equal(typeof name, 'string', `${section.id}/${locale} must be a string`);
      assert.ok(name.trim(), `${section.id}/${locale} must not be blank`);
    }
    // English is never changed by the overlay — it must equal the generated title exactly.
    assert.equal(resolveSectionTitle(section, 'en', overlay), section.title);
  }
});


