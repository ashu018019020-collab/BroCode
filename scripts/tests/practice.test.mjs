/**
 * The practice subjects — "which subject do I drill today?", answered from published data.
 *
 * The practice pillar opens on eight subject tiles (the tracks), and each one shows the questions,
 * chapters and answers the bank manifest really holds for it. Two failures here are silent:
 *
 *   · a section falls OUTSIDE every track range — it stays in the bank, but practice can never
 *     reach it, and nothing on screen looks wrong;
 *   · a subject's counts come from somewhere other than the manifest the chapter page reads, so the
 *     tile promises a number of questions the page it opens does not contain.
 *
 * Neither throws. This file drives the pure rules with fixtures AND against the real published
 * manifest, real track files and the real `TRACK_DEFS` (read as text, the way playbook.test.mjs
 * reads App.tsx). Zero dependencies — node:test, `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// Both pure (no React, no store, no fetch), which is what makes them loadable here.
const su = await load('src/core/learning/subjects.ts');
const sf = await load('src/core/learning/surfaces.ts');

const banks = JSON.parse(read('public/generated/questions/manifest.json'));
const hub = read('src/features/practice/PracticeHub.tsx');

/** The 8 tracks, read from the real TRACK_DEFS so a renamed id fails here instead of on screen. */
const appSrc = read('src/app/App.tsx');
const defsBlock = appSrc.slice(appSrc.indexOf('export const TRACK_DEFS'), appSrc.indexOf('];', appSrc.indexOf('export const TRACK_DEFS')));
const TRACKS = [...defsBlock.matchAll(/id: '([^']+)'[^\n]*?from: (\d+), to: (\d+)/g)]
  .map((m) => ({ id: m[1], from: Number(m[2]), to: Number(m[3]) }));

const chapter = (over = {}) => ({ sectionId: 's01', no: 1, title: 'Variables', published: 20, byType: { coding: 5, interview: 3 }, ...over });

/* ------------------------------- the ranges ------------------------------ */

test('practice: every published section belongs to exactly one subject', () => {
  const ranges = TRACKS.map(({ id, from, to }) => ({ id, from, to }));
  assert.equal(ranges.length, 8, 'the subjects are the eight tracks');

  const numbers = banks.sections.map((s) => s.no).sort((a, b) => a - b);
  assert.deepEqual(su.uncoveredSections(numbers, ranges), [],
    'a section no subject covers is content practice can never reach');

  for (const no of numbers) {
    assert.equal(su.subjectsOf(no, ranges).length, 1, `section ${no} must resolve to one subject, not to none or two`);
  }
  for (const card of ranges) {
    assert.ok(su.subjectOf(card.from, ranges), `${card.id}: its own first section must resolve`);
    assert.equal(su.subjectOf(card.to, ranges)?.id, card.id, `${card.id}: its last section must resolve to itself`);
    assert.ok(su.chaptersOf(banks.sections, card).length > 0, `${card.id} would be a subject with no chapters`);
  }
});

test('practice: each subject range is the published track file’s own range', () => {
  // The subject tiles and the /track pages describe the same eight things. If the registry's range
  // and the generated track's range ever disagree, one of the two screens is lying about what the
  // track teaches — and neither would throw.
  for (const { id, from, to } of TRACKS) {
    const slug = sf.TRACK_SLUG[id];
    assert.ok(slug, `track ${id} has no page slug`);
    const doc = JSON.parse(read(`public/generated/tracks/${slug}.json`));
    assert.deepEqual(doc.sectionRange, { from, to }, `${id}: TRACK_DEFS range must equal generated/tracks/${slug}.json`);
    assert.equal(doc.key, id, `${slug}.json must name its own track id`);
  }
});

/* ------------------------------ the arithmetic --------------------------- */

test('practice: a subject sums the chapters it owns, and nothing else', () => {
  const sections = [
    chapter({ sectionId: 's01', no: 1, published: 20, byType: { coding: 5, interview: 3 } }),
    chapter({ sectionId: 's02', no: 2, published: 30, byType: { coding: 0, interview: 7 } }),
    chapter({ sectionId: 's03', no: 3, published: 99, byType: { coding: 40 } }),
  ];
  const rows = su.chaptersOf(sections, { id: 'x', from: 1, to: 2 });
  assert.deepEqual(rows.map((r) => r.id), ['s01', 's02'], 'a chapter outside the range is another subject’s');
  assert.deepEqual(rows.map((r) => r.no), [1, 2], 'chapters read in section order regardless of input order');

  const all = su.subjectCounts(rows);
  assert.equal(all.questions, 50);
  assert.equal(all.typed, 50, 'no filter means everything a subject holds');
  assert.equal(all.answered, 0, 'a subject nobody started reads 0 answers, not unknown');

  assert.equal(su.subjectCounts(rows, 'coding').typed, 5);
  assert.equal(su.subjectCounts(rows, 'interview').typed, 10);
  assert.equal(su.subjectCounts(rows, 'debug').typed, 0, 'a type the subject does not hold counts zero');
  assert.equal(su.subjectCounts(rows, 'nonsense').typed, 0, 'an unknown filter must read as empty, never as unfiltered');
  assert.equal(su.subjectCounts(rows, 'coding').typedChapters, 1);
  assert.equal(su.subjectCounts(rows, 'interview').typedChapters, 2);

  // Answers are joined by SECTION ID, never by position: a caller that keyed them by index would
  // show the learner another section's work as soon as the filter changed.
  const withAnswers = su.chaptersOf(sections, { id: 'x', from: 1, to: 2 }, { s02: 4 });
  assert.deepEqual(withAnswers.map((c) => c.answered), [0, 4]);
  assert.equal(su.subjectCounts(withAnswers).answered, 4);
});

test('practice: the first chapter with the chosen type is where Start practice goes', () => {
  const rows = su.chaptersOf([
    chapter({ sectionId: 's01', no: 1, published: 4, byType: { interview: 0 } }),
    chapter({ sectionId: 's02', no: 2, published: 0, byType: {} }),
    chapter({ sectionId: 's03', no: 3, published: 9, byType: { interview: 2 } }),
  ], { id: 'x', from: 1, to: 3 });

  assert.equal(su.startChapter(rows, 'interview')?.id, 's03', 'a chapter with none of the type is skipped');
  assert.equal(su.startChapter(rows, 'all')?.id, 's01', 'unfiltered, the subject starts where it starts');
  assert.equal(su.startChapter(su.chaptersOf([], { id: 'x', from: 1, to: 2 }), 'coding'), null,
    'no chapters is no target — never a made-up chapter');
});

/* --------------------------------- the page ------------------------------ */

test('practice: the hub takes its subjects, counts and rules from the registries', () => {
  // The subject grid is the track registry, not a hand-written list of eight cards.
  assert.match(hub, /TRACK_DEFS\.map\(/, 'the subject tiles must come from TRACK_DEFS');
  assert.match(hub, /d\.nameKey as LocaleKey/, 'a subject is labelled by the app’s own i18n key');
  assert.ok(!/\bfrom:\s*\d/.test(hub) && !/\bto:\s*\d/.test(hub),
    'a section range typed into the page is a second copy of the registry that can drift');

  // …and the numbers are the published manifest's, read through the shared rules.
  assert.match(hub, /useBankManifest\(\)/, 'subject counts come from the manifest the bank page reads');
  assert.match(hub, /chaptersOf\(/, 'the chapters a subject owns come from the engine');
  assert.match(hub, /subjectCounts\(/, 'its totals come from the engine too');
  assert.match(hub, /startChapter\(/, 'and so does where Start practice goes');
  assert.match(hub, /from '\.\.\/\.\.\/core\/learning\/subjects'/, 'the rules live in the pure engine, not in the view');

  // A chapter opens the bank on ITS section, carrying the chosen type — one helper, so no link can
  // spell the params differently from the page that reads them.
  assert.match(hub, /const bankHref = \(sectionId: string, type: QuestionType \| 'all'\) =>/, 'the bank link is built once');
  assert.match(hub, /\/questions\?section=\$\{sectionId\}/, 'a chapter link must name its section');
  assert.match(hub, /type === 'all' \? '' : `&type=\$\{type\}`/, 'and carry the filter it promised');
  assert.match(hub, /to=\{bankHref\(start\.id, type\)\}/, 'Start practice opens the first chapter of the chosen type');
  assert.ok(!/to=\{`\/questions\?section=/.test(hub), 'a section link must not spell the bank URL by hand');

  // The selected subject is the URL, so a drill-down is shareable and the back button works.
  assert.match(hub, /useSearchParams\(\)/, 'the chosen subject must be a URL param, not hidden state');
  assert.match(hub, /params\.get\('subject'\)/);
  assert.match(hub, /QUESTION_TYPES as string\[\]\)\.includes\(rawType\)/, 'only a real type is honoured');
});

test('practice: the hub’s subjects are all reachable, and none is a dead end', () => {
  // Every subject the grid renders must have at least one chapter with questions in the real
  // manifest — otherwise its panel opens empty and the tile was a promise the data did not make.
  const numbers = new Set(banks.sections.map((s) => s.no));
  for (const { id, from, to } of TRACKS) {
    const rows = su.chaptersOf(banks.sections, { id, from, to });
    assert.ok(rows.length > 0, `${id} has no published chapters`);
    assert.equal(su.subjectCounts(rows).questions, rows.reduce((a, c) => a + c.published, 0));
    assert.equal(su.subjectCounts(rows, 'coding').typed, rows.reduce((a, c) => a + (c.byType.coding ?? 0), 0));
    for (const r of rows) assert.ok(numbers.has(r.no), `${r.id} is not a published section`);
  }
});
