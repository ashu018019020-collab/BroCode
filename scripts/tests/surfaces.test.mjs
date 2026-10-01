/**
 * The 61 surfaces and the mark that identifies each one.
 *
 * Two failure modes here are silent, which is why this file exists:
 *
 *   · a surface gets no mark, and its tile renders BLANK — the page still works, and the one card
 *     that says nothing is the one a learner skips;
 *   · a family span drifts (a gap between 44 and 45, or two families claiming 45), so a surface is
 *     either unreachable from the hierarchy or is printed twice with two different numbers.
 *
 * Neither throws. Both are asserted here against the REAL registry (`EXTRA_PATHS`), the REAL ten
 * stages (`PHASES`) and the REAL eight tracks (`TRACK_DEFS`, read as text the same way
 * playbook.test.mjs reads App.tsx). Zero dependencies — node:test, `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// Both are pure (no React, no store, no value imports), which is what makes them loadable here.
const sf = await load('src/core/learning/surfaces.ts');
const paths = await load('src/core/learning/paths.ts');
const rm = await load('src/core/learning/roadmap.ts');

const appSrc = read('src/app/App.tsx');
const logo = read('src/components/shared/SurfaceLogo.tsx');

/** The marks the drawing module actually implements, read from its own record keys. */
const GLYPH_BLOCK = logo.slice(logo.indexOf('const GLYPHS'), logo.lastIndexOf('};'));
const DRAWN = new Set([...GLYPH_BLOCK.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]));

/* ------------------------------- the families ---------------------------- */

test('surfaces: the five families tile 1…61 with no gap and no overlap', () => {
  const fams = sf.SURFACE_FAMILIES;
  assert.equal(fams.length, 5, 'the product has exactly five top-level families');
  assert.equal(fams[0].id, 'master', 'the master learning path is the first family, not one of five peers');
  assert.equal(fams[0].first, 1, 'the master path starts at step 01');
  assert.equal(fams[fams.length - 1].last, sf.SURFACE_COUNT, 'the last family must end at the last surface');
  for (let i = 0; i < fams.length; i += 1) {
    assert.ok(fams[i].first <= fams[i].last, `${fams[i].id}: an empty family span`);
    if (i > 0) {
      assert.equal(fams[i].first, fams[i - 1].last + 1,
        `a surface fell between ${fams[i - 1].id} and ${fams[i].id} — it would be undiscoverable`);
    }
  }
  assert.equal(sf.MASTER_STEPS, fams[0].last, 'the master path ends where the support families begin');
  assert.equal(sf.familyOfNo(1).id, 'master');
  assert.equal(sf.familyOfNo(sf.MASTER_STEPS).id, 'master');
  assert.equal(sf.familyOfNo(sf.MASTER_STEPS + 1).id, 'practice', 'step 37 is the first support surface');
});

test('surfaces: each support family holds exactly the paths the registry declares', () => {
  // The spans are numbers written by hand; `EXTRA_PATHS` is the list they describe. If a ninth
  // practice path is added there and not here, that path gets a number no family owns.
  for (const id of sf.SUPPORT_FAMILIES) {
    const fam = sf.family(id);
    const defs = paths.EXTRA_PATHS.filter((d) => d.group === id);
    assert.equal(fam.last - fam.first + 1, defs.length,
      `${id}: the family span says ${fam.last - fam.first + 1} surfaces, the registry has ${defs.length}`);
    assert.equal(sf.familySize(id), defs.length);
  }
  const total = sf.SURFACE_FAMILIES.reduce((a, f) => a + (f.last - f.first + 1), 0);
  assert.equal(total, sf.SURFACE_COUNT, 'the five families must add up to every surface');
  assert.equal(paths.EXTRA_PATHS.length + sf.MASTER_STEPS, sf.SURFACE_COUNT,
    'the master path plus the support registry must be the whole product');
});

/* --------------------------------- the marks ----------------------------- */

test('surfaces: every surface has a mark that is actually drawn', () => {
  // The routes, from the real registry — a support surface added there without a mark here fails.
  const routes = paths.EXTRA_PATHS.map((d) => d.route).sort();
  assert.deepEqual(Object.keys(sf.SURFACE_GLYPH).sort(), routes,
    'SURFACE_GLYPH must key every support surface route, and nothing else');
  for (const [route, glyph] of Object.entries(sf.SURFACE_GLYPH)) {
    assert.ok(DRAWN.has(glyph), `${route} points at "${glyph}", which SurfaceLogo does not draw`);
  }
});

test('surfaces: the ten stages use the roadmap’s own stage ids', () => {
  assert.deepEqual(Object.keys(sf.STAGE_GLYPH).sort(), rm.PHASES.map((p) => p.id).sort(),
    'a stage id renamed in the roadmap must be renamed here — otherwise a stage header loses its mark');
  assert.equal(rm.PHASES.length, 10, 'the master path has ten stages');
  for (const [id, glyph] of Object.entries(sf.STAGE_GLYPH)) {
    assert.ok(DRAWN.has(glyph), `stage ${id} points at "${glyph}", which SurfaceLogo does not draw`);
  }
});

test('surfaces: the ten domains cover every track, and every domain is drawn', () => {
  const defsBlock = appSrc.slice(appSrc.indexOf('export const TRACK_DEFS'), appSrc.indexOf('];', appSrc.indexOf('export const TRACK_DEFS')));
  const trackIds = [...defsBlock.matchAll(/id: '([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(sf.TRACK_DOMAINS).sort(), trackIds,
    'every curriculum track must name the domains it teaches');
  const reached = new Set(Object.values(sf.TRACK_DOMAINS).flat());
  for (const domain of sf.DOMAINS) {
    assert.ok(reached.has(domain), `domain "${domain}" is taught by no track — its mark would never render`);
    assert.ok(DRAWN.has(sf.DOMAIN_GLYPH[domain]), `domain "${domain}" points at a mark SurfaceLogo does not draw`);
    assert.ok(sf.DOMAIN_NAME[domain], `domain "${domain}" needs a name`);
  }
  assert.equal(sf.DOMAINS.length, 10, 'ten technology identities');
});

test('surfaces: the mark family is drawn once and named once, without emoji', () => {
  // One glyph registry is the whole point: 61 hand-drawn logos is a clip-art folder. Several marks
  // are SHARED across families on purpose (the ML domain and the ML/NLP stage are the same brain),
  // so the drawn set may be smaller than the sum of the three families — never larger.
  const used = new Set([
    ...Object.values(sf.DOMAIN_GLYPH),
    ...Object.values(sf.STAGE_GLYPH),
    ...Object.values(sf.SURFACE_GLYPH),
  ]);
  for (const glyph of used) assert.ok(DRAWN.has(glyph), `"${glyph}" is referenced but not drawn`);
  assert.ok(DRAWN.size >= 30, 'the family is too small to identify 61 surfaces distinctly');
  // …and every mark has a drawing, not a placeholder.
  for (const key of DRAWN) assert.ok(used.has(key), `SurfaceLogo draws "${key}", which no surface uses`);
  // No emoji anywhere in the identity layer: an emoji is a font's opinion, it cannot inherit
  // `currentColor`, it renders differently on every OS, and it cannot be a design system.
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  for (const file of ['src/core/learning/surfaces.ts', 'src/components/shared/SurfaceLogo.tsx']) {
    assert.doesNotMatch(read(file), EMOJI, `${file} must not use emoji as an icon`);
  }
});

/* ------------------------- the naming decision (37) ---------------------- */

test('surfaces: the imported practice set is a Practice Archive, not a product', () => {
  assert.ok(paths.EXTRA_PATHS.some((d) => d.route === sf.ARCHIVE_ROUTE),
    'the archive must be registered as a support surface');
  assert.equal(sf.familyOfNo(37).id, 'practice', 'the archive is the first practice surface, 37');
  assert.equal(paths.EXTRA_PATHS.find((d) => d.group === 'practice').route, sf.ARCHIVE_ROUTE);
  // The provenance marker stays internal: it is what keeps 476 migrated items traceable, and it is
  // never the name of a page.
  assert.equal(sf.ARCHIVE_SOURCE, 'v15');
  const locales = read('src/app/i18n/locales.ts');
  assert.match(locales, /'path\.practiceArchive': 'Practice Archive'/);
  assert.ok(!/label: 'Playbook V15'/.test(appSrc), 'the imported set must not be branded "Playbook V15"');
  assert.match(appSrc, /label: 'Practice Archive'/, 'NAV is the one label source PathGrid reads');
});

/* ------------------------------ the pages mount it ----------------------- */

test('surfaces: the Learning Path shows the five families and marks its stages', () => {
  const page = read('src/features/learning/LearningPath.tsx');
  const grid = read('src/components/learning/PathGrid.tsx');
  assert.match(grid, /SURFACE_FAMILIES\.map/, 'the family band is drawn from the registry, not hand-listed');
  assert.match(grid, /SURFACE_GLYPH\[def\.route\]/, 'a path card takes its mark from the registry');
  assert.match(grid, /from '\.\.\/\.\.\/core\/learning\/surfaces'/, 'the registry is the source of the marks');
  assert.match(page, /STAGE_GLYPH\[phase\.id\]/, 'each stage divider carries its stage mark');
  // The spec's headline: 01–36 on the master heading, 37–61 on the support band.
  assert.match(page, /MASTER_STEPS/, 'the master heading states its own span');
  assert.match(grid, /family\('practice'\)\.first/, 'the support band states its span from the registry');
});
