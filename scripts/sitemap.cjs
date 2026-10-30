/**
 * The site's sitemap — every standalone page in the app, derived from the route table itself.
 *
 * BroCode is a hash-routed SPA served at a project path on GitHub Pages, so every page below the
 * landing document lives behind `/BroCode/#/…`. A crawler fetching those URLs gets the same HTML,
 * and fragments are not distinct server paths — but the file still earns its place: search consoles
 * and link checkers that DO execute the app discover each view from it, and the repo ships a
 * predictable root artifact instead of hand-maintaining a list that goes stale (exactly how the
 * route/NAV counts drifted). So nothing here is hand-listed:
 *
 *   · static routes come straight from the `<Route path>` table in src/app/App.tsx;
 *   · parameterized routes expand to their REAL instances — the 8 track pages
 *     (generated/tracks/index.json), the 29 lesson pages (sections.json), the 11 courses and
 *     their 36 steps (courses/index.json);
 *   · within-document positions are deliberately NOT expanded: `/pdf/:page` and
 *     `/pdf/playbook/:page` (page flips inside the bundled reader), `/lesson/:sid/:stage` (a tab
 *     of a lesson page) and `*` (the fallback route is the landing page again). Listing them would
 *     add ~750 URLs that differ only in scroll or tab state.
 *
 * `public/robots.txt` is written by the same command from the same base: an explicit allow plus the
 * sitemap's absolute URL. Crawl rules cannot target the app's views (a fragment is never sent to the
 * server), so there are no Disallow entries. Caveat worth knowing: GitHub Pages serves this project
 * under /BroCode/, and crawlers only honour robots.txt from the HOST root — on the Pages URL the file
 * is a convention other tools read; on a custom domain it is authoritative.
 *
 * The output is DETERMINISTIC — no `lastmod`: nothing here knows when a page last changed, and a
 * fabricated date is worse than none — so `npm test` rebuilds it byte for byte and fails on a stale
 * artifact, the same contract as the search index.
 *
 * Usage:
 *   node scripts/sitemap.cjs                                  # dry run
 *   node scripts/sitemap.cjs --write                          # write public/sitemap.xml
 *   node scripts/sitemap.cjs --base=https://example.com/app   # another origin
 *   npm run sitemap:write
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP_TSX = path.join(ROOT, 'src', 'app', 'App.tsx');
const SECTIONS_JSON = path.join(ROOT, 'public', 'generated', 'curriculum', 'sections.json');
const COURSES_INDEX = path.join(ROOT, 'public', 'generated', 'courses', 'index.json');
const TRACKS_INDEX = path.join(ROOT, 'public', 'generated', 'tracks', 'index.json');
const OUT_PATH = path.join(ROOT, 'public', 'sitemap.xml');
const ROBOTS_PATH = path.join(ROOT, 'public', 'robots.txt');

/** Where the app really ships. Override with --base= for any host; the test pins this default. */
const DEFAULT_BASE = 'https://ashu018019020-collab.github.io/BroCode';

/**
 * The routes that stay out of the sitemap, each for a stated reason.
 *
 * A new parameterized route with no expansion entry makes the build fail loudly instead — a page
 * added to the router may not silently disappear from the sitemap.
 */
const SKIPPED = {
  '*': 'the fallback route renders the landing page again',
  '/lesson/:sid/:stage': 'a tab inside a lesson page, not a page of its own',
  '/pdf/:page': 'a page flip inside the bundled reader',
  '/pdf/playbook/:page': 'a page flip inside the bundled reader',
};

/**
 * Routes that must NEVER appear in a public sitemap, and the reason each one is excluded.
 *
 * This list became necessary when learning moved behind an account. Before that, every page really
 * was public and listing all of them was correct; now a sitemap is a PUBLIC declaration of where a
 * crawler should go, and advertising a signed-in learner's private surfaces to a search engine is a
 * disclosure even though the page itself renders nothing without a session.
 *
 * Two different problems, one list:
 *
 *   · PRIVATE USER SURFACES (`/progress`, `/notes`, `/settings`) — per-account data. Nothing about
 *     them is useful to a crawler and their titles alone describe a person's study activity.
 *   · OPERATIONAL SURFACES (`/admin`, `/onboarding`, and the two auth pages) — the owner console,
 *     a first-run wizard, and pages whose only content is a form.
 *
 * `/login` and `/reset-password` are a judgement call: they are legitimately reachable by a visitor,
 * but a crawlable sign-in page invites password-spraying traffic and a recovery page carries a
 * one-time credential in its URL. Neither earns a place in an index.
 *
 * `/`, `/start` and the COURSE CATALOGUE stay public — that is the discoverable product.
 *
 * The test asserts every entry here is a real route (a typo would silently exclude a page nobody
 * meant to hide) AND that none of them reaches the sitemap.
 */
const PRIVATE = {
  '/admin': 'the owner console — server-authorized, never advertised',
  '/voice-health': 'the voice operations console — readiness and telemetry, never advertised',
  '/progress': 'the learner\'s own analytics — per-account data',
  '/notes': 'the learner\'s private notes',
  '/settings': 'per-account preferences, no public content',
  '/onboarding': 'a first-run wizard with nothing to read',
  '/login': 'a form, and a crawlable sign-in page invites credential attacks',
  '/reset-password': 'carries a one-time recovery credential in its URL',
};

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`\x1b[31m✕\x1b[0m ${m}`);
const arg = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : undefined;
};

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const readRoutes = (appSrc) => [...appSrc.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
/**
 * The track pages, by the slug that actually loads. NOT the TRACK_DEFS ids: the route is
 * `/track/:trackSlug` and the page fetches `generated/tracks/<slug>.json`, so the short ids
 * (`python`, `data`, `ml`, `agentic`, `apis`, `interview`) name files that were never generated —
 * a listed URL that mounts the page and then loads forever. The registry the app itself fetches is
 * the only honest source, and the test asserts each slug here has a real file behind it.
 */
const readTrackSlugs = () => readJson(TRACKS_INDEX).map((t) => t.slug);

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Every hash URL a parameterized route stands for, read from the same registries the app loads. */
function expansions(tracks, sectionIds, courses) {
  return {
    '/track/:trackSlug': tracks.map((slug) => `/track/${slug}`),
    '/lesson/:sid': sectionIds.map((sid) => `/lesson/${sid}`),
    '/course/:slug': courses.map((c) => `/course/${c.slug}`),
    '/course/:slug/:step': courses.flatMap((c) => c.steps.map((step) => `/course/${c.slug}/${step}`)),
  };
}

/** Build the sitemap in memory. Pure given the files on disk — this is what the test drives too. */
function buildSitemap(base = DEFAULT_BASE) {
  const cleanBase = base.replace(/\/+$/, '');
  const appSrc = fs.readFileSync(APP_TSX, 'utf8');
  const expanded = expansions(readTrackSlugs(), readJson(SECTIONS_JSON).map((s) => s.id), readJson(COURSES_INDEX).courses);

  // A typo in PRIVATE would hide nothing while looking deliberate, so every entry must be a real
  // route. Failing here is the difference between "excluded on purpose" and "excluded by mistake".
  const routes = readRoutes(appSrc);
  const registered = new Set(routes);
  const strays = Object.keys(PRIVATE).filter((route) => !registered.has(route));
  if (strays.length) {
    throw new Error(`PRIVATE names route(s) that do not exist in App.tsx: ${strays.join(', ')}`);
  }
  // A route can be skipped (no page of its own) or private (a real page, not advertised) — never
  // both, because the two mean different things and the overlap hides a mistake.
  const overlap = Object.keys(PRIVATE).filter((route) => SKIPPED[route]);
  if (overlap.length) throw new Error(`route(s) are in both SKIPPED and PRIVATE: ${overlap.join(', ')}`);

  const urls = [];
  for (const route of routes) {
    if (SKIPPED[route]) continue;
    if (PRIVATE[route]) continue;
    if (route.includes(':')) {
      const list = expanded[route];
      if (!list) throw new Error(`route ${route} has no expansion rule — add one to scripts/sitemap.cjs or to SKIPPED`);
      for (const p of list) urls.push(`${cleanBase}/#${p}`);
      continue;
    }
    urls.push(route === '/' ? `${cleanBase}/` : `${cleanBase}/#${route}`);
  }

  const body = urls.map((u) => `  <url>\n    <loc>${escapeXml(u)}</loc>\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
}

function writeSitemap(base = DEFAULT_BASE) {
  const xml = buildSitemap(base);
  fs.writeFileSync(OUT_PATH, xml);
  return xml;
}

/** The robot-facing companion: allow everything, and name the sitemap by its absolute URL. */
function buildRobots(base = DEFAULT_BASE) {
  const cleanBase = base.replace(/\/+$/, '');
  return [
    '# BroCode — every view is a hash URL, so the sitemap is the crawlable list.',
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${cleanBase}/sitemap.xml`,
    '',
  ].join('\n');
}

function writeRobots(base = DEFAULT_BASE) {
  const txt = buildRobots(base);
  fs.writeFileSync(ROBOTS_PATH, txt);
  return txt;
}

if (require.main === module) {
  const base = arg('base') ?? DEFAULT_BASE;
  if (!/^https?:\/\/\S+$/.test(base)) { bad(`--base= must be an absolute http(s) URL, got "${base}"`); process.exit(2); }
  const write = process.argv.includes('--write');
  console.log(`\n— sitemap (${write ? 'write' : 'dry run'}) —\n`);
  console.log(`  base   : ${base.replace(/\/+$/, '')}`);
  const routes = readRoutes(fs.readFileSync(APP_TSX, 'utf8'));
  console.log(`  routes : ${routes.length} registered · ${Object.keys(SKIPPED).length} within-document patterns skipped`);
  const xml = write ? writeSitemap(base) : buildSitemap(base);
  const count = (xml.match(/<loc>/g) ?? []).length;
  console.log(`  urls   : ${count}`);
  console.log('  files  : public/sitemap.xml + public/robots.txt');
  if (write) {
    writeRobots(base);
    ok(`sitemap → public/sitemap.xml (${count} URLs)`);
    ok(`robots → public/robots.txt (Sitemap: ${base.replace(/\/+$/, '')}/sitemap.xml)`);
  } else console.log('\nDry run — nothing written. Apply with: npm run sitemap:write');
}

module.exports = { buildSitemap, writeSitemap, buildRobots, writeRobots, DEFAULT_BASE, SKIPPED, PRIVATE, ROBOTS_PATH };
