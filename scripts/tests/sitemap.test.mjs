/**
 * The sitemap, robots.txt and the registries they are generated from.
 *
 * Three failure modes matter, and none of them throws:
 *
 *   · a page exists in the router but not in the sitemap (a route added to App.tsx, a course or
 *     lesson added to the content packs) — discoverability quietly shrinks;
 *   · the committed file drifts from its generator (hand-edited, or written under a different
 *     --base=) — the artifact stops being reviewable;
 *   · a `:param` placeholder or a within-document position (PDF page flips, lesson stage tabs)
 *     gets listed as if it were a page — a sitemap full of URLs that all load the same document;
 *   · an expansion names a page that does not resolve. The track case is the quiet one: the route
 *     is `/track/:trackSlug` but the loader fetches `generated/tracks/<slug>.json`, and six of the
 *     eight slugs differ from their TRACK_DEFS id — so `/track/python` mounts the page and then sits
 *     on "load ho raha hai…" forever. Every expanded URL is checked against the artifact behind it;
 *   · a `<meta name="robots" content="noindex">` appears in the shell (or is injected at runtime)
 *     and silently contradicts the sitemap + robots.txt — BroCode is meant to be found.
 *
 * So the file is re-derived from the same sources the app loads and byte-compared, every route is
 * accounted for, and the exclusions are asserted rather than assumed. Zero dependencies — node:test,
 * `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { buildSitemap, buildRobots, DEFAULT_BASE, SKIPPED, PRIVATE } = await import(pathToFileURL(path.join(ROOT, 'scripts/sitemap.cjs')).href);

const xml = read('public/sitemap.xml');
const robots = read('public/robots.txt');
const shell = read('index.html');
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

const appSrc = read('src/app/App.tsx');
const routes = [...appSrc.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
const staticRoutes = routes.filter((r) => r !== '*' && !r.includes(':'));
// The track pages, by the slug that actually loads — the same registry scripts/sitemap.cjs reads.
const trackSlugs = JSON.parse(read('public/generated/tracks/index.json')).map((t) => t.slug);
const sections = JSON.parse(read('public/generated/curriculum/sections.json'));
const courses = JSON.parse(read('public/generated/courses/index.json')).courses;

test('sitemap: the committed file IS the build output, byte for byte', () => {
  // Same contract as the search index: no timestamp, no hand edits — regenerating over unchanged
  // registries must reproduce the file, or staleness becomes invisible.
  assert.equal(buildSitemap(DEFAULT_BASE), xml, 'public/sitemap.xml is stale — run npm run sitemap:write');
});

test('sitemap: every registered route is represented — expanded, or deliberately skipped', () => {
  const urls = new Set(locs);
  for (const route of staticRoutes) {
    // PRIVATE routes are deliberately not advertised (production-readiness gate E).
    if (PRIVATE[route]) continue;
    const url = route === '/' ? `${DEFAULT_BASE}/` : `${DEFAULT_BASE}/#${route}`;
    assert.ok(urls.has(url), `route ${route} is missing from the sitemap`);
  }

  // The expansions are the REAL registry entries, not hand copies of them.
  for (const slug of trackSlugs) assert.ok(urls.has(`${DEFAULT_BASE}/#/track/${slug}`), `track ${slug} is missing from the sitemap`);
  for (const s of sections) assert.ok(urls.has(`${DEFAULT_BASE}/#/lesson/${s.id}`), `lesson ${s.id} is missing from the sitemap`);
  for (const c of courses) {
    assert.ok(urls.has(`${DEFAULT_BASE}/#/course/${c.slug}`), `course ${c.slug} is missing from the sitemap`);
    for (const step of c.steps) assert.ok(urls.has(`${DEFAULT_BASE}/#/course/${c.slug}/${step}`), `step ${c.slug}/${step} is missing from the sitemap`);
  }

  // And every route is accounted for: static, expanded, or skipped with a stated reason.
  const expanded = new Set(['/track/:trackSlug', '/lesson/:sid', '/course/:slug', '/course/:slug/:step']);
  for (const route of routes) {
    assert.ok(!route.includes(':') || expanded.has(route) || SKIPPED[route] !== undefined || PRIVATE[route] !== undefined,
      `route ${route} is neither expanded nor skipped — teach scripts/sitemap.cjs about it`);
  }
});

test('sitemap: every /track URL loads the file that page fetches', () => {
  // The quiet failure this pins: `/track/<id>` matches the route and mounts TrackOverview, which
  // then fetches `generated/tracks/<id>.json` — a 404 the dev server answers with index.html, so
  // the page renders its loading line forever. No error, no 404 page, just a spinner-shaped dead
  // end, and the sitemap is where those URLs were first published. Slug ≠ TRACK_DEFS id for six of
  // the eight tracks, so the check is the file, not the pattern.
  const listed = locs.filter((l) => l.includes('/#/track/')).map((l) => l.split('/#/track/')[1]);
  assert.equal(listed.length, trackSlugs.length, 'one URL per generated track');
  for (const slug of listed) {
    const file = path.join(ROOT, 'public', 'generated', 'tracks', `${slug}.json`);
    assert.ok(fs.existsSync(file), `sitemap lists /track/${slug} but public/generated/tracks/${slug}.json does not exist`);
  }
});

test('sitemap: no duplicates, no placeholders, no within-document positions', () => {
  assert.equal(new Set(locs).size, locs.length, 'every URL must appear exactly once');
  for (const loc of locs) {
    assert.ok(loc.startsWith(`${DEFAULT_BASE}/`), `${loc} is off the site`);
    assert.ok(!/[:*]/.test(loc.slice(DEFAULT_BASE.length)), `${loc} still carries a placeholder or the fallback route`);
    assert.doesNotMatch(loc, /#\/pdf\/(?:playbook\/)?\d+$/, 'reader page flips stay out of the sitemap');
    assert.doesNotMatch(loc, /#\/lesson\/s\d+\/.+$/, 'lesson stage tabs stay out of the sitemap');
    // …and every URL is a real SLUG. The route readers regex-read App.tsx as text, so route-tag
    // syntax typed inside a comment becomes a "route": that is how `#…` shipped once. This turns
    // the same typo into a failure instead of a junk URL in the file crawlers read.
    assert.match(
      loc.slice(`${DEFAULT_BASE}/`.length),
      /^(?:#\/[a-z0-9][a-z0-9/.-]*)?$/,
      `${loc} is not a slug URL — a route reader may have matched prose instead of a route`,
    );
  }
  const privateStaticRoutes = staticRoutes.filter((r) => PRIVATE[r]);
  const expected = staticRoutes.length - privateStaticRoutes.length + trackSlugs.length + sections.length + courses.length
    + courses.reduce((a, c) => a + c.steps.length, 0);
  assert.equal(locs.length, expected, 'the sitemap must hold exactly the route table’s real pages');
});

test('sitemap: it is well-formed XML a crawler can parse', () => {
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<\/urlset>$/);
  assert.equal((xml.match(/<url>/g) ?? []).length, (xml.match(/<\/url>/g) ?? []).length, 'every <url> must close');
  assert.equal((xml.match(/<url>/g) ?? []).length, locs.length, 'one <loc> per <url>');
});

test('robots: the committed file IS the build output, byte for byte', () => {
  assert.equal(buildRobots(DEFAULT_BASE), robots, 'public/robots.txt is stale — run npm run sitemap:write');
});

test('crawl: nothing in the shell forbids indexing', () => {
  // The sitemap and robots.txt above promise discoverability; a noindex tag in the shell — or one
  // injected at runtime — would silently contradict both. None has ever existed (git history and
  // every source file checked), and the suite fails the moment one appears.
  const shells = ['index.html'];
  if (fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) shells.push('dist/index.html');
  for (const file of shells) {
    assert.doesNotMatch(read(file), /noindex/i, `${file} must not carry a noindex tag`);
  }
  // A runtime-injected tag still needs the literal string somewhere in a source file.
  for (const rel of fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })) {
    if (!/\.(ts|tsx)$/.test(rel)) continue;
    assert.doesNotMatch(read(path.join('src', rel)), /noindex/i, `src/${rel} mentions noindex — the app ships indexable`);
  }
});

test('search console: a site-verification tag, if present, is a single well-formed token', () => {
  // Google Search Console proves ownership by fetching the DEPLOYED shell and reading this meta
  // tag — the only method available here: the host is github.io, so there is no DNS record to add,
  // and an uploaded verification file would mean hand-authoring inside `public/`, which this repo
  // forbids. The tag is added to index.html the moment a property exists, so this holds that moment:
  // exactly one tag per property (duplicates make ownership ambiguous) and a real 20+ character
  // token rather than a placeholder someone forgot to replace.
  const tokens = [...shell.matchAll(/<meta\s+name="google-site-verification"\s+content="([^"]*)"\s*\/>/g)]
    .map((m) => m[1]);
  assert.ok(tokens.length <= 1, 'one google-site-verification tag — a second makes ownership ambiguous');
  for (const token of tokens) {
    assert.match(token, /^[A-Za-z0-9_-]{20,}$/, 'the token is the exact string Search Console issued');
  }
  // GSC fetches the built site, not the source tree, so the tag has to survive the build.
  if (tokens.length && fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    assert.match(read('dist/index.html'), /name="google-site-verification"/,
      'the built shell lost the verification tag — Search Console fetches that file');
  }
});

test('canonical: index.html agrees with the origin the sitemap and robots are generated from', () => {
  // index.html is the one shell file written by hand, so the tag it carries is pinned here against
  // the generator's DEFAULT_BASE — the same constant sitemap.xml's <loc>s and robots.txt's
  // Sitemap: line are built from. A base change that misses any of the three fails this suite.
  const canonical = [...shell.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(canonical.length, 1, 'the shell carries exactly one canonical link');
  assert.equal(canonical[0], `${DEFAULT_BASE}/`, 'the canonical URL is the deploy origin itself');

  // The whole agreement, spelled out once: sitemap's first entry, robots' base, canonical.
  assert.equal(locs[0], `${DEFAULT_BASE}/`, 'the sitemap opens with the same origin URL');
  assert.ok(robots.includes(`Sitemap: ${DEFAULT_BASE}/sitemap.xml`), 'robots names the sitemap under the same origin');

  // The meta title is the other shell line a search result prints: brand first, one line, short
  // enough that engines do not truncate it.
  const title = shell.match(/<title>([^<]+)<\/title>/)?.[1];
  assert.ok(title, 'the shell carries a <title>');
  assert.ok(title.startsWith('BroCode'), 'the title leads with the brand');
  const rendered = title.replace(/&(amp|mdash);/g, (e) => (e === '&amp;' ? '&' : '—'));
  assert.ok(rendered.length <= 60, `the title renders at ${rendered.length} chars — keep it under 60`);
  assert.doesNotMatch(rendered, /[Oo]ffline/, 'the title no longer sells the offline angle — the offline branding came off the site');
  // The positioning decision: the platform is a TECHNOLOGY learning platform, not an AI/ML one —
  // AI/ML is one domain among several. The title/description must not name the platform after it.
  assert.match(rendered, /Technology Learning Platform/, 'the title states the broad platform identity');
  assert.doesNotMatch(rendered, /AI/, 'the title must not make AI the platform identity');

  // …and the description is the snippet under it: specific enough to sell the app, short enough
  // that engines show it whole. The counts it cites are the packs' own (36 steps, 11 courses,
  // 13,000+ published questions), so the snippet cannot drift into marketing fiction.
  const description = shell.match(/<meta\s+name="description"\s+content="([^"]+)"\s*\/>/)?.[1];
  assert.ok(description, 'the shell carries a meta description');
  assert.ok(description.length >= 70 && description.length <= 160,
    `the description is ${description.length} chars — engines want roughly 70–160`);
  assert.doesNotMatch(description, /[Oo]ffline/, 'the description no longer sells the offline angle — the offline branding came off the site');
  assert.match(description, /36 steps/);
  assert.match(description, /13,000\+/);
  assert.match(description, /technology learning platform/, 'the description states the broad platform identity');
  assert.match(description, /AI\/ML and more/, 'AI/ML is named as one domain, present but not the umbrella');
  assert.ok(!/&[a-z]+;/.test(description), 'the description stays plain text — no HTML entities to mis-render');

  // The built shell (vite copies index.html verbatim) must ship the same tag.
  if (fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    const built = read('dist/index.html');
    assert.match(built, /<link\s+rel="canonical"\s+href="[^"]+"/,
      'the built index.html lost the canonical tag — vite must not rewrite it away');
    assert.match(built, new RegExp(`<link\\s+rel="canonical"\\s+href="${DEFAULT_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/"`),
      'the built canonical is the deploy origin');
  }
});

test('open graph: the social card is a real 1200×630 PNG, and every tag agrees with the shell', () => {
  // The card is a GENERATED artifact (scripts/og.cjs, rendered by headless Chrome), so its bytes are
  // not pinned here: rendering differs between browser versions and machines, while "a crawler gets
  // a real 1200×630 image at an absolute URL that exists" is checkable anywhere — including on a
  // machine with no browser, which is why the contract and not the pixels is what the suite holds.
  // The sharp edge this catches: a declared size that the file does not have (every platform then
  // crops or letterboxes the card) and og:title/og:description drifting into a second version of the
  // pitch — they must BE the <title> and description the tests above already pin.
  const shellTitle = shell.match(/<title>([^<]+)<\/title>/)?.[1];
  const shellDescription = shell.match(/<meta\s+name="description"\s+content="([^"]+)"\s*\/>/)?.[1];
  const tag = (attr, name) =>
    shell.match(new RegExp(`<meta\\s+${attr}="${name}"\\s+content="([^"]+)"\\s*\\/>`))?.[1];

  assert.ok(shellTitle && shellDescription, 'the title and description are still in the shell');
  assert.equal(tag('property', 'og:title'), shellTitle, 'og:title is the same string as <title>');
  assert.equal(tag('property', 'og:description'), shellDescription, 'og:description is the meta description');
  assert.equal(tag('name', 'twitter:title'), shellTitle, 'twitter:title is that same string too');
  assert.equal(tag('name', 'twitter:description'), shellDescription, 'and twitter:description as well');

  const image = `${DEFAULT_BASE}/brocode-og.png`;
  assert.equal(tag('property', 'og:image'), image, 'og:image is absolute, on the canonical origin');
  assert.equal(tag('name', 'twitter:image'), image, 'twitter is served the same file');
  assert.equal(tag('property', 'og:url'), `${DEFAULT_BASE}/`, 'og:url is the canonical URL');
  assert.equal(tag('property', 'og:type'), 'website');
  assert.equal(tag('name', 'twitter:card'), 'summary_large_image', 'a card this wide needs the wide layout');
  for (const [attr, who] of [['property', 'og'], ['name', 'twitter']]) {
    const alt = tag(attr, `${who}:image:alt`);
    assert.ok(alt && alt.length >= 30, `${who}:image:alt must describe the card for a screen reader`);
  }

  // The file itself: a PNG whose own header is exactly the size the tags declare.
  const file = path.join(ROOT, 'public', 'brocode-og.png');
  assert.ok(fs.existsSync(file), 'public/brocode-og.png is missing — run npm run og:write');
  const png = fs.readFileSync(file);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'the card is a PNG');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(`${width}×${height}`, '1200×630', 'the card carries the size the OG spec crops for');
  assert.equal(tag('property', 'og:image:width'), String(width), 'the declared width is the real width');
  assert.equal(tag('property', 'og:image:height'), String(height), 'the declared height is the real height');
  assert.equal(tag('property', 'og:image:type'), 'image/png');

  // vite copies index.html verbatim, so the built shell must carry the whole block too.
  if (fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    assert.match(read('dist/index.html'), /<meta\s+property="og:image"\s+content="[^"]+brocode-og\.png"\s*\/>/,
      'the built index.html lost the og:image tag — vite must not rewrite it away');
  }
});

test('schema: the shell ships structured data naming the whole platform, not one domain', () => {
  // The JSON-LD graph is how a search engine reads BroCode's breadth without crawling the SPA:
  // who publishes it (EducationalOrganization), what the site is (WebSite), what the product is
  // (WebApplication, free, educational) and — the point of the repositioning — the ten learning
  // domains as an ItemList, AI/ML one among them. The block is in the hand-written shell, so it
  // is pinned here: it must parse, every node must resolve its @id references, the origin must be
  // the same one sitemap/robots/canonical use, and the domain list must mirror the homepage's.
  const jsonLd = shell.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(jsonLd, 'the shell carries exactly one JSON-LD block');
  const graph = JSON.parse(jsonLd[1]);
  assert.equal(graph['@context'], 'https://schema.org');
  const nodes = graph['@graph'];
  assert.deepEqual(nodes.map((n) => n['@type']),
    ['EducationalOrganization', 'WebSite', 'WebApplication', 'ItemList'],
    'the graph is org → site → app → domains');

  const BASE = 'https://ashu018019020-collab.github.io/BroCode';
  for (const n of nodes) {
    assert.ok(n['@id']?.startsWith(`${BASE}/#`), `node ${n['@type']} must be anchored at the deploy origin`);
    if (n.url) assert.ok(n.url.startsWith(BASE), `node ${n['@type']} points off the deploy origin`);
  }
  // The origin agreement, same as the canonical test above.
  assert.equal(BASE, DEFAULT_BASE, 'the schema origin is the sitemap/canonical origin');

  const domains = nodes.find((n) => n['@type'] === 'ItemList').itemListElement;
  assert.equal(domains.length, 10, 'the platform offers ten learning domains');
  for (const [i, d] of domains.entries()) {
    assert.equal(d.position, i + 1, 'positions are 1..10, in order');
    assert.ok(d.name, 'every domain has a name');
  }
  // AI/ML is present (it is a major domain) but is ONE list item — not the ItemList's name, not
  // the org description's first claim, not the graph's identity.
  assert.ok(domains.some((d) => d.name === 'AI & Machine Learning'), 'AI/ML stays listed as a domain');
  assert.equal(domains[0].name, 'Programming', 'the first domain is the broadest one');
  const org = nodes[0].description;
  assert.match(org, /technology learning platform/);
  assert.match(org, /projects, interview preparation and career/);

  // The built shell (vite copies index.html verbatim) must ship the same block.
  if (fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    const built = read('dist/index.html');
    const builtLd = built.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(builtLd, 'the built index.html lost the JSON-LD block — vite must not rewrite it away');
    assert.equal(JSON.parse(builtLd[1])['@graph'].length, nodes.length, 'the built graph is the same graph');
  }
});

test('robots: it allows crawling and names the sitemap, and nothing else', () => {
  // A fragment is never sent to the server, so no view can be Disallowed (nor should be) — the two
  // directives below are the whole, deliberate contract.
  const directives = robots.split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split(':')[0].trim());
  assert.deepEqual(directives, ['User-agent', 'Allow', 'Sitemap'], 'only the directives robots needs');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.equal(robots.split('\n').find((l) => l.startsWith('Sitemap:')), `Sitemap: ${DEFAULT_BASE}/sitemap.xml`);
  assert.ok(!robots.split('\n').filter((l) => !l.startsWith('#')).some((l) => l.includes('#')), 'a hash URL in robots.txt would match nothing');
});
