/**
 * Per-route document metadata (title + description).
 *
 * The silent failure this file exists for: the app is ONE document with hash-routed views, so every
 * route inherited the shell's single `<title>` and description. Nothing throws, nothing looks broken
 * — a tab, a bookmark, a "save link" sheet and the snippet a JS-rendering crawler prints all repeat
 * the home page's pitch, wherever the learner actually is. The home page is the one route where that
 * is correct, which is why `null` (not a generated sentence) is the answer for it and for the routes
 * nobody wrote copy for.
 *
 * So the rule in `src/core/platform/meta.ts` is asserted against the REAL registries — `PAGES`, the
 * same records Ctrl+K opens, and `STAGE_META`'s authored blurbs — plus `index.html` as text, so the
 * brand in a route title can never drift from the brand in the shell's title. Zero dependencies —
 * node:test, `npm test`.
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
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// Both are pure (no React, no store, no value imports), which is what makes them loadable here.
const { routeMeta, BRAND } = await load('src/core/platform/meta.ts');
const { PAGES } = await load('src/core/platform/search.ts');
const { STAGE_META } = await load('src/core/learning/progress.ts');

const shell = read('index.html');
const appSrc = read('src/app/App.tsx');

/** Decode the two entities the shell actually uses, so a comparison is against rendered text. */
const decode = (s) => s.replace(/&(amp|mdash);/g, (e) => (e === '&amp;' ? '&' : '—'));
const shellTitle = decode(shell.match(/<title>([^<]+)<\/title>/)?.[1] ?? '');
const shellDescription = shell.match(/<meta\s+name="description"\s+content="([^"]+)"\s*\/>/)?.[1] ?? '';

/** Every title this module produces obeys the same ceiling the shell's own <title> obeys. */
const TITLE_MAX = 60;
const DESC_MIN = 20;
const DESC_MAX = 160;

const shape = (label, meta) => {
  assert.ok(meta, `${label}: the route resolves to metadata`);
  assert.equal(typeof meta.title, 'string', `${label}: title is a string`);
  assert.equal(typeof meta.description, 'string', `${label}: description is a string`);
  assert.ok(meta.title.length <= TITLE_MAX, `${label}: the title is ${meta.title.length} chars — keep it under ${TITLE_MAX}`);
  assert.ok(meta.description.length >= DESC_MIN && meta.description.length <= DESC_MAX,
    `${label}: the description is ${meta.description.length} chars — engines want ${DESC_MIN}–${DESC_MAX}`);
  assert.ok(!/&[a-z]+;/.test(meta.title + meta.description), `${label}: stays plain text — no HTML entities to mis-render`);
  assert.ok(!/undefined|NaN|\bnull\b/.test(meta.title + meta.description), `${label}: no unresolved placeholder leaked into the copy`);
  return meta;
};

test('meta: every registered screen has its own title and description', () => {
  const seen = new Map();
  for (const page of PAGES) {
    if (page.route === '/') continue;
    const meta = shape(page.route, routeMeta(page.route));
    assert.equal(meta.description, page.detail,
      `${page.route}: the description is the record's own detail — Ctrl+K and the tab must not disagree`);
    assert.ok(meta.title.startsWith(page.title),
      `${page.route}: the title starts with the page's registered name (${meta.title})`);
    assert.ok(meta.title.includes(BRAND), `${page.route}: the title carries the brand`);
    assert.ok(meta.description, `${page.route}: the description is not empty`);
    assert.ok(!seen.has(meta.title), `${page.route}: prints the same title as ${seen.get(meta.title)}`);
    seen.set(meta.title, page.route);
  }
  assert.ok(seen.size >= 30, `only ${seen.size} screens resolved — the registry has ${PAGES.length}`);
});

test('meta: the brand in a route title is the brand in the shell title', () => {
  assert.ok(shellTitle, 'the shell still carries a <title>');
  assert.ok(shellTitle.startsWith(BRAND),
    `the shell title starts with "${shellTitle.slice(0, 24)}" but route titles use "${BRAND}" — one brand, two spellings`);
  const home = routeMeta('/');
  assert.equal(home, null, 'the home page is the shell\'s own route — it must not restate the pinned copy');
});

test('meta: a route nobody wrote for defers to the shell instead of inventing a sentence', () => {
  for (const p of ['/onboarding', '/login', '/admin', '/notes-archive', '/this-does-not-exist']) {
    assert.equal(routeMeta(p), null, `${p}: no authored copy exists, so the shell's meta is the honest answer`);
  }
  // The home page's description is the shell's — this is what the applier restores.
  assert.ok(shellDescription.length >= DESC_MIN, 'the shell description is still the home page snippet');
});

test('meta: the parameterised families answer for themselves', () => {
  const track = shape('/track/python-core', routeMeta('/track/python-core'));
  const course = shape('/course/numpy-pandas', routeMeta('/course/numpy-pandas'));
  const step = shape('/course/numpy-pandas/3', routeMeta('/course/numpy-pandas/3'));
  const bare = shape('/lesson/s01/learn', routeMeta('/lesson/s01/learn'));
  const titled = shape('/lesson/s01/learn', routeMeta('/lesson/s01/learn', { sectionTitle: '01 · Python Basics' }));

  assert.match(track.title, /Python Core/, 'a track slug is humanised, not printed raw');
  assert.match(course.title, /Numpy Pandas/, 'a course slug is humanised too');
  assert.ok(course.title.includes(step.title.split(' · ')[0]), 'the step page keeps naming its course');
  assert.match(step.title, /Step 3/, 'the step number is in the title');
  assert.ok(!bare.title.includes('undefined') && bare.title.includes('Lesson'),
    `a lesson with no section title says "Lesson", it does not guess (${bare.title})`);
  assert.notEqual(titled.title, bare.title, 'passing the real section title changes the title');
  assert.match(titled.title, /Python Basics/, 'the section title reaches the lesson title');

  // The stage blurb is authored in STAGE_META; the description must BE it, not a paraphrase.
  assert.equal(routeMeta('/lesson/s01/interview').description, STAGE_META.interview.blurb,
    'a lesson stage describes itself with its own authored blurb');
  assert.match(routeMeta('/lesson/s01/nonsense')?.title ?? '', /Learn/,
    'an unknown stage falls back to the stage the app itself falls back to');

  const titles = new Set(['/track/python-core', '/course/numpy-pandas', '/course/numpy-pandas/3']
    .map((p) => routeMeta(p).title));
  assert.equal(titles.size, 3, 'track, course and step do not collapse to one title');
});

test('meta: a sub-path belongs to its screen, and only across a separator', () => {
  const deep = shape('/questions/12', routeMeta('/questions/12'));
  assert.equal(deep.description, PAGES.find((p) => p.route === '/questions').detail,
    'a sub-path of a registered screen is that screen');
  assert.equal(routeMeta('/questions-archive'), null,
    'a shared prefix is NOT a sub-path — `/notes` must not claim `/notes-archive`');
});

test('meta: App.tsx actually applies the resolver, and restores the shell for unowned routes', () => {
  // The rule is tested above; if nothing calls it, the app still ships one title for 43 routes.
  assert.match(appSrc, /from '\.\.\/core\/platform\/meta'/, 'App.tsx imports the resolver');
  assert.match(appSrc, /routeMeta\(/, 'App.tsx calls the resolver');
  assert.match(appSrc, /document\.title\s*=/, 'App.tsx sets the document title');
  assert.match(appSrc, /meta\[name="description"\]/, 'App.tsx syncs the meta description tag');
  assert.match(appSrc, /useRef<\{ title: string; description: string \} \| null>\(null\)/,
    'App.tsx captures the shell\'s own strings once, so the home page copy is not duplicated in code');
});
