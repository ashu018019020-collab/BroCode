/**
 * Playbook V15 + the extra path registry.
 *
 * The Learning Path now prints numbers it did not print before: how much of the second source
 * reached each of the 8 tracks, and one card per other surface in the app with a real figure on
 * it. Two failure modes matter, and neither is a crash:
 *
 *   · a card that shows a 0% or a missing row for something that simply has no honest
 *     denominator (the learner reads that as "I have done nothing", which is a lie);
 *   · a page that exists in the app but is missing from the path, so it becomes undiscoverable.
 *
 * So the maths is tested with fixtures, the real artifacts on disk are cross-checked against each
 * other, and the route list in App.tsx is diffed against the registry. Zero dependencies —
 * node:test, `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// Both engine modules are pure (type-only imports), which is what makes them loadable here.
const pb = await load('src/core/assessment/playbook.ts');
const paths = await load('src/core/learning/paths.ts');
const keys = await load('src/core/platform/keys.ts');
const exam = await load('src/core/assessment/exam.ts');

const manifest = JSON.parse(read('public/generated/playbook/manifest.json'));
const itemsView = JSON.parse(read('public/generated/playbook/items.json'));
const banks = JSON.parse(read('public/generated/questions/manifest.json'));

/* ------------------------------- fixtures ------------------------------- */

const SECTIONS = [
  { id: 's19', no: 19, title: 'SQL' },
  { id: 's20', no: 20, title: 'ML' },
  { id: 's21', no: 21, title: 'NLP' },
];
const TRACKS = [
  { id: 'sql', from: 19, to: 19 },
  { id: 'ml', from: 20, to: 21 },
];

const item = (id, sectionId) => ({
  id, sectionId, sectionTitle: sectionId, type: 'interview', difficulty: 'easy',
  chapter: '01', question: id, answer: '', selfGrade: false,
});

const FIXTURE_INDEX = {
  generatedAt: 'x', source: 'x.pdf', pages: 10,
  totals: {
    items: 4, byType: { interview: 3, coding: 1 }, bySection: { s20: 2, s21: 2 },
    labs: 1, miniProjectBlueprints: 1, miniProjectCapstones: 1,
    complexityRows: 0, logicSteps: 0, methodAnswers: 1,
  },
  chapters: [
    { no: '01', title: 'A', pdfPage: 3, sectionId: 's20', sections: { s20: 2 }, items: 2, byType: { interview: 2 } },
    { no: '02', title: 'B', pdfPage: 7, sectionId: 's21', sections: { s21: 2 }, items: 2, byType: { interview: 1, coding: 1 } },
  ],
};
const FIXTURE_ITEMS = [
  item('s20:interview:0', 's20'), item('s20:interview:1', 's20'),
  item('s21:interview:0', 's21'), item('s21:coding:0', 's21'),
];

/* --------------------------- track coverage ---------------------------- */

test('playbook: coverage returns a row for EVERY track, including the ones it never reached', () => {
  const rows = pb.trackCoverage(FIXTURE_INDEX, FIXTURE_ITEMS, SECTIONS, TRACKS, () => false);
  assert.equal(rows.length, TRACKS.length, 'a track must never be dropped from the list');
  assert.deepEqual(rows.map((r) => r.trackId), ['sql', 'ml']);

  const empty = rows[0];
  assert.equal(empty.items, 0);
  assert.equal(empty.topSection, null, 'a track with no items must not offer a Practice link');
  assert.equal(empty.pdfPage, null);
  assert.ok(empty.sections.some((s) => s.id === 's19'), 'its own sections are still listed');

  const full = rows[1];
  assert.equal(full.items, 4);
  assert.equal(full.chapters, 2, 'both chapters contributed to this track');
  assert.equal(full.pdfPage, 3, 'the earliest page of its chapters');
  assert.equal(full.topSection, 's20', 'Practice lands on the track\'s biggest contributor');
});

test('playbook: practised counts come from the caller\'s predicate, never from the manifest', () => {
  const isTouched = (id) => id === 's20:interview:0' || id === 's20:interview:1';
  const rows = pb.trackCoverage(FIXTURE_INDEX, FIXTURE_ITEMS, SECTIONS, TRACKS, isTouched);
  assert.equal(rows[0].touched, 0, 'the sql track has nothing to practise, so nothing counts there');
  assert.equal(rows[1].touched, 2);
  assert.equal(pb.playbookPractised(FIXTURE_ITEMS, isTouched), 2);
  assert.equal(pb.playbookPractised(null, isTouched), 0, 'no items loaded = nothing claimed');
});

test('playbook: the next target is the section with the most unpractised items', () => {
  const none = pb.nextPlaybookTarget(FIXTURE_INDEX, FIXTURE_ITEMS, SECTIONS, () => false);
  assert.equal(none.sectionId, 's20');

  // Practising all of s20 must move the target on, not keep pointing at a finished section.
  const s20Done = (id) => id.startsWith('s20');
  const next = pb.nextPlaybookTarget(FIXTURE_INDEX, FIXTURE_ITEMS, SECTIONS, s20Done);
  assert.equal(next.sectionId, 's21');
  assert.equal(next.remaining, 2);

  assert.equal(pb.nextPlaybookTarget(FIXTURE_INDEX, FIXTURE_ITEMS, SECTIONS, () => true), null,
    'everything practised → no target rather than a fake one');
});

test('playbook: item totals fall back to the manifest before items.json arrives', () => {
  assert.deepEqual(pb.sectionTotals(FIXTURE_INDEX, null), { s20: 2, s21: 2 });
  assert.deepEqual(pb.sectionTotals(FIXTURE_INDEX, FIXTURE_ITEMS), { s20: 2, s21: 2 });
  assert.deepEqual(pb.sectionTotals(null, FIXTURE_ITEMS), { s20: 2, s21: 2 });
  assert.deepEqual(pb.sectionTotals(null, null), {});
});

/* --------------------------- the real artifacts ------------------------- */

test('playbook: the imported manifest and the derived item view agree with each other', () => {
  const bySection = manifest.totals.bySection;
  const fromView = {};
  for (const it of itemsView.items) fromView[it.sectionId] = (fromView[it.sectionId] ?? 0) + 1;
  assert.equal(itemsView.items.length, itemsView.count, 'count must describe the list it ships');

  // The manifest records what the DOCUMENT offered per section; items.json records what the banks
  // actually took. The import refuses a question whose text another bank already owns, so the
  // banks can only ever hold the same or fewer — never more, and never a section the manifest
  // does not know about. The learner's figures come from items.json (neither page prints the
  // parsed count any more), so this relationship is what keeps the two honest.
  for (const [sid, n] of Object.entries(bySection)) {
    assert.ok(fromView[sid] <= n, `${sid}: items.json holds more items than the manifest parsed`);
  }
  for (const sid of Object.keys(fromView)) {
    assert.ok(bySection[sid] !== undefined, `items.json has a section the manifest does not know: ${sid}`);
  }
  const parsed = manifest.totals.items;
  const merged = itemsView.items.length;
  assert.equal(Object.values(bySection).reduce((a, b) => a + b, 0), parsed, 'the manifest must add up');
  assert.ok(merged <= parsed, `the banks hold ${merged} of the ${parsed} items the document offered`);
  assert.ok(parsed - merged <= 5, `manifest and banks have drifted apart by ${parsed - merged} items`);
});

test('playbook: every chapter points at a section that really exists in the banks', () => {
  const known = new Set(banks.sections.map((s) => s.sectionId));
  for (const ch of manifest.chapters) {
    assert.ok(known.has(ch.sectionId), `chapter ${ch.no} points at unknown section ${ch.sectionId}`);
    for (const sid of Object.keys(ch.sections)) {
      assert.ok(known.has(sid), `chapter ${ch.no} claims items in unknown section ${sid}`);
    }
  }
  for (const it of itemsView.items) {
    assert.ok(known.has(it.sectionId), `item ${it.id} lives in unknown section ${it.sectionId}`);
  }
});

test('playbook: every imported item lands in exactly one of the 8 tracks', () => {
  // Mirrors TRACK_DEFS' section ranges (src/app/App.tsx) — the same ranges the page passes in.
  const tracks = [
    { id: 'python', from: 1, to: 16 }, { id: 'data', from: 17, to: 18 }, { id: 'sql', from: 19, to: 19 },
    { id: 'ml', from: 20, to: 21 }, { id: 'genai', from: 22, to: 22 }, { id: 'agentic', from: 23, to: 23 },
    { id: 'apis', from: 24, to: 26 }, { id: 'interview', from: 27, to: 29 },
  ];
  const sections = banks.sections.map((s) => ({ id: s.sectionId, no: s.no, title: s.title }));
  const rows = pb.trackCoverage(manifest, itemsView.items, sections, tracks, () => false);
  assert.equal(rows.length, 8);
  assert.equal(rows.reduce((a, r) => a + r.items, 0), itemsView.items.length,
    'the 8 track rows must account for every imported item — nothing may be shadowed');
  for (const r of rows) {
    if (r.items > 0) assert.ok(r.topSection, `${r.trackId} has items but no practice target`);
  }
});

/* ------------------------- stored-key families -------------------------- */

test('paths: each card counts a key family that engine/keys.ts actually builds', () => {
  const byPrefix = (p) => paths.EXTRA_PATHS.find((d) => d.prefix === p);
  assert.ok(byPrefix('qb:'), 'the bank family card must exist');
  assert.ok(keys.bankAttempt('s01:theory:0').startsWith('qb:'));
  assert.equal(byPrefix('qb:').prefix, keys.BANK_ATTEMPT_PREFIX);
  assert.ok(keys.labAttempt('mock', 0).startsWith('lab:mock:'));
  assert.ok(keys.labAttempt('rag', 0).startsWith('lab:rag:'));
  assert.ok(keys.finalPart('py:0').startsWith('final:part:'));
  assert.ok(keys.notebookCell('x.ipynb', 'c1').startsWith('nb:'));
  assert.ok(keys.codeSlot.npLab('numpy', 0).startsWith('nplab:'));
  assert.ok(keys.resumeDefenseAnswer('p1', 0).startsWith('resume:'));
  assert.equal(keys.learnView('s01'), 'view:s01:learn');
  assert.equal(keys.stageAttempt('s01', 'project'), 'st:s01:project');
  assert.equal(keys.stageAttempt('s01', 'defense'), 'st:s01:defense');
});

test('paths: the constants a card prints are pinned to their real source', () => {
  const final = read('src/features/interview/FinalAssessment.tsx');
  const partsBlock = final.slice(final.indexOf('const parts: Part[] = ['), final.indexOf('];', final.indexOf('const parts: Part[] = [')));
  const partIds = [...partsBlock.matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
  assert.equal(partIds.length, paths.FINAL_PARTS, 'the final paper gained or lost a part');

  const jobPrep = read('src/features/career/JobPrep.tsx');
  assert.equal([...jobPrep.matchAll(/id: '[^']+'/g)].length, paths.JOB_PREP_ITEMS,
    'the job-prep checklist gained or lost an item');

  assert.equal(exam.EXAM_FOCUS_ORDER.length, paths.EXAM_FOCI);
  assert.equal(exam.EXAM_SIZES.length, paths.EXAM_SIZES);
});

/* ----------------------- no invented numbers rule ----------------------- */

/** A learner who has done nothing, with no manifest loaded yet. */
const coldCtx = (over = {}) => ({
  sections: SECTIONS,
  readSections: 0,
  projectGates: 0,
  defenseGates: 0,
  counts: {
    bankPractised: 0, interviewAnswers: 0, notes: 0, mistakesOpen: 0, mistakesTotal: 0, reviewDue: 0,
    mockDone: 0, ragRounds: 0, npSlots: 0, playgroundSlots: 0, sqlSlots: 0, notebookCells: 0,
    resumeAnswers: 0, finalParts: 0, jobPrepDone: 0, playbookPractised: null, interviewPct: null,
    xp: 0, level: 1, streak: 0, bookmarksGuide: 0, bookmarksPlaybook: 0,
    ...(over.counts ?? {}),
  },
  published: over.published ?? null,
  playbook: over.playbook ?? null,
  notebooks: over.notebooks ?? null,
  mockTotal: over.mockTotal ?? 0,
});

test('paths: a manuscript-less context never produces a percentage for a manifest-backed card', () => {
  const ctx = coldCtx();
  const pctOf = (route) => paths.pathStat(paths.EXTRA_PATHS.find((d) => d.route === route), ctx).pct;
  for (const route of ['/playbook', '/questions', '/notebooks', '/mock']) {
    assert.equal(pctOf(route), null, `${route} must show facts only until its manifest arrives`);
  }
  // …while cards whose denominator is the curriculum itself honestly report 0%.
  for (const route of ['/final', '/projects', '/concepts', '/jobprep', '/defense']) {
    assert.equal(pctOf(route), 0, `${route} has a real denominator and must report it`);
  }
});

test('paths: every card states at least one fact, in every state of the app', () => {
  const full = coldCtx({
    published: { total: 13865, sections: 29, interview: 1936 },
    playbook: { pages: 94, chapters: 36, items: 477, interview: 385, labs: 12, miniProjects: 15, methodAnswers: 91 },
    notebooks: { notebooks: 5, cells: 131 },
    mockTotal: 40,
  });
  for (const ctx of [coldCtx(), full]) {
    for (const def of paths.EXTRA_PATHS) {
      const facts = def.facts(ctx);
      assert.ok(facts.length >= 1, `${def.route} shows no fact at all`);
      for (const f of facts) {
        assert.ok(typeof f === 'string' && f.trim().length > 0, `${def.route}: empty fact`);
        // A fact built from a field the context does not carry yet reads "undefined% average" — a
        // non-empty string, so a length check alone would let it through onto the page.
        assert.doesNotMatch(f, /undefined|NaN/, `${def.route}: fact leaked an unset field ("${f}")`);
      }
      const stat = paths.pathStat(def, ctx);
      if (stat.pct !== null) {
        assert.ok(stat.total > 0 && stat.done <= stat.total, `${def.route}: ${stat.done}/${stat.total}`);
        assert.equal(stat.note, `${stat.done}/${stat.total}`);
      }
    }
  }
  // A saturated manifest-backed card really does move: the coverage figure is not decorative.
  const half = coldCtx({
    counts: { bankPractised: 100, playbookPractised: 5 },
    published: { total: 1000, sections: 29, interview: 10 },
    playbook: full.playbook,
  });
  assert.equal(paths.pathStat(paths.EXTRA_PATHS.find((d) => d.route === '/questions'), half).pct, 10);
  assert.equal(paths.pathStat(paths.EXTRA_PATHS.find((d) => d.route === '/playbook'), half).note, '5/477');
});

test('paths: the Playbook card divides by the MERGED item count, so 100% stays reachable', () => {
  // The manifest counts what the document offered — one item more than the banks took, because a
  // question whose text another bank already owned was refused on import. Using that parsed count
  // as the denominator would leave a learner who finished every imported item at 99% forever.
  const merged = itemsView.items.length;
  const def = paths.EXTRA_PATHS.find((d) => d.route === '/playbook');
  const stat = paths.pathStat(def, coldCtx({
    playbook: { pages: 94, chapters: 36, items: merged, interview: 384, labs: 12, miniProjects: 15, methodAnswers: 91 },
    counts: { playbookPractised: merged },
  }));
  assert.equal(stat.total, merged);
  assert.equal(stat.pct, 100, 'every merged item practised must read as 100%');
  assert.equal(stat.note, `${merged}/${merged}`, 'the card must never print a denominator it cannot fill');
  assert.ok(merged < manifest.totals.items, 'the merged count really is lower than the parsed one');

  // The parsed denominator is one higher, so the card would read 476/477 — a target that cannot
  // be reached. Asserted on the printed figure, because the rounded percentage hides it.
  const stale = paths.pathStat(def, coldCtx({
    playbook: { pages: 94, chapters: 36, items: manifest.totals.items, interview: 385, labs: 12, miniProjects: 15, methodAnswers: 91 },
    counts: { playbookPractised: merged },
  }));
  assert.equal(stale.note, `${merged}/${manifest.totals.items}`, 'the parsed count is the wrong denominator');
});

/* ------------------------- no hidden path rule -------------------------- */

test('paths: every route in App.tsx is either a registered path or deliberately not one', () => {
  const appSrc = read('src/app/App.tsx');
  const routes = [...appSrc.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(routes.length >= 25, `expected the full route table, saw ${routes.length}`);

  const registered = new Set(paths.EXTRA_PATHS.map((p) => p.route));
  for (const route of routes) {
    const covered = registered.has(route) || paths.PATH_ROUTE_ALLOWLIST.includes(route);
    assert.ok(covered, `route ${route} is in neither EXTRA_PATHS nor the allowlist — it would be undiscoverable`);
  }
});

test('paths: the registry points only at routes that exist, with no duplicates', () => {
  const appSrc = read('src/app/App.tsx');
  const routes = new Set([...appSrc.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));
  const seen = new Set();
  for (const def of paths.EXTRA_PATHS) {
    assert.ok(routes.has(def.route), `registry card ${def.route} has no <Route>`);
    assert.ok(!seen.has(def.route), `duplicate card for ${def.route}`);
    seen.add(def.route);
    assert.ok(paths.PATH_GROUPS.includes(def.group), `${def.route}: unknown group ${def.group}`);
  }
  assert.match(appSrc, /export const NAV: NavItem\[\]/, 'PathGrid takes its labels/icons from NAV');
  const navRoutes = new Set([...appSrc.matchAll(/\{\s*to:\s*'([^']+)'/g)].map((m) => m[1]));
  for (const def of paths.EXTRA_PATHS) {
    if (def.labelKey) continue;
    assert.ok(navRoutes.has(def.route), `no NAV entry for ${def.route} — the card would fall back to a raw URL`);
  }
});

test('paths: the cards grid does not collide with the page layout class', () => {
  // `.path-grid` is the Learning Path's own 1fr/300px frame. Declaring the cards grid under that
  // name (later in the file, so it won) silently stretched the right rail from 300px to fill the
  // row — a layout bug with no error message, which is what this assertion exists to catch.
  const css = read('src/styles.css');
  assert.match(css, /^\.path-grid \{ display: grid; grid-template-columns: 1fr 300px;/m,
    'the Learning Path must keep the two-column frame it had before this change');
  assert.match(css, /^\.path-extra \{ margin-top: 16px; \}/m, 'the extra-path spine needs its own class');
  const grid = read('src/components/learning/PathGrid.tsx');
  assert.match(grid, /<div className="path-extra">/);
  // The steps must be the shared spine, not a second grid: `.rmap-step` is what lines the numbering
  // up with the eight track steps above them.
  assert.match(grid, /className={`rmap-step tone-\$\{TONE\[group\]}`}/);
  assert.ok(!/more-grid/.test(grid), 'the wrapped card grid is back — the extra paths are a line now');
  assert.ok(!/className="path-grid"/.test(grid), 'PathGrid must never re-declare the page frame');
});

/* --------------------- the page actually mounts them -------------------- */

test('paths: the Learning Path mounts the V15 layer and the extra path grid', () => {
  const page = read('src/features/learning/LearningPath.tsx');
  assert.match(page, /<PlaybookLayer coverage=\{pb\} \/>/);
  assert.match(page, /<PathGrid \/>/);
  // The layout contract that came before this change must survive it: the shelf is still mounted
  // OPEN on the path — it just draws its library as boxes now (`boxes`).
  assert.match(page, /<NotebookShelf defaultOpen\b/);
  // …and the band must sit above the notebook shelf, not after the goal bar.
  assert.ok(page.indexOf('<PlaybookLayer') < page.indexOf('<NotebookShelf defaultOpen'));
  // The V15 per-track grid is gone: one box per track, with the V15 share inside it.
  assert.ok(!/pbCoverage/.test(page), 'the second copy of the track grid is back in the roadmap');
  // …and the extra paths continue that line rather than interrupting it, so they come before the
  // band: the eight track steps end at 08 and `PathGrid` picks the numbering up at 09.
  assert.ok(page.indexOf('<PathGrid />') < page.indexOf('<PlaybookLayer'),
    'the extra paths must continue the track spine, not start a second section after the V15 band');
  assert.ok(page.indexOf('<PathGrid />') < page.indexOf('<NotebookShelf defaultOpen'));
});
