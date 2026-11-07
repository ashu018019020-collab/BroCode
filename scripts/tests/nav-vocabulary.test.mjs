/**
 * One vocabulary, three surfaces.
 *
 * The rail, the header and Ctrl+K all point at the same seven destinations, and they used to name
 * them three different ways — "Dashboard" in the header, "Progress" and "Project Lab" in the palette
 * for pages the rail called something else. Nothing throws when that drifts; a learner just learns
 * that the product has two namings for one place, and then stops trusting either.
 *
 * So the rail in `App.tsx` is read as text (the loader ceiling means the component itself cannot be
 * imported), and the other two are held to it: the header must MAP the pillars rather than own a
 * list, and the palette's launcher must be the same seven routes, in the same order, under the same
 * labels. Routes themselves are untouched — this is a naming contract, not a move.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./_ts-resolve.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// `core/platform/search.ts` is pure (no React, no store), which is what makes it loadable here.
const { PAGES, QUICK_ROUTES, quickPages } = await import(
  pathToFileURL(path.join(ROOT, 'src/core/platform/search.ts')).href
);

const app = read('src/app/App.tsx');
const nav = app.slice(app.indexOf('export const NAV: NavItem[] = ['), app.indexOf('/** Mobile bottom navigation'));
const pillars = nav
  .split('\n')
  .filter((line) => line.includes("group: 'nav.pillars'"))
  .map((line) => ({
    route: /to: '([^']+)'/.exec(line)?.[1],
    label: /label: '([^']+)'/.exec(line)?.[1],
  }));

test('nav vocabulary: the rail and the palette open on the same seven routes', () => {
  assert.equal(pillars.length, 7, 'the rail is seven destinations');

  assert.deepEqual(
    QUICK_ROUTES,
    pillars.map((pillar) => pillar.route),
    'the palette launcher must be the rail\'s own seven, in rail order',
  );

  const quick = quickPages();
  assert.equal(quick.length, QUICK_ROUTES.length, 'every quick route resolves to a registered page');
  assert.deepEqual(
    quick.map((page) => page.title),
    pillars.map((pillar) => pillar.label),
    'the palette must print the rail\'s labels — one place, one name',
  );
});

test('nav vocabulary: the palette still indexes every other screen', () => {
  // The launcher narrows to seven; the SEARCH must not. Dropping a page from Ctrl+K is how a
  // quick-link cleanup quietly makes a feature unfindable.
  assert.ok(PAGES.length >= 30, `the registry holds every screen, saw ${PAGES.length}`);
  for (const route of ['/questions', '/labs', '/interviews', '/notes', '/cheat-sheets', '/pdf', '/playbook']) {
    assert.ok(PAGES.some((page) => page.route === route), `${route} must stay searchable from Ctrl+K`);
  }
});

test('nav vocabulary: the header renders the rail instead of its own list', () => {
  const start = app.indexOf('<nav className="topbar-nav"');
  const end = app.indexOf('</nav>', start);
  assert.ok(start > 0 && end > start, 'the header navigation must exist');
  const header = app.slice(start, end);

  assert.match(header, /NAV\.filter\(\(n\) => n\.group === 'nav\.pillars'\)/, 'the header must map the rail\'s pillars');
  assert.doesNotMatch(header, /\{ to: '\//, 'the header must not carry a second route/label array');
});
