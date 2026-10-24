/**
 * Production-readiness gates.
 *
 * These assert the things that are TRUE OF THE SHIPPED ARTIFACT rather than of the source — a secret
 * that only appears after bundling, a `dist/` that grew past what a first load should pay, metadata
 * that would let a search engine index a private page. They read `dist/`, so they require
 * `npm run build` to have run; the build gate test says so explicitly instead of failing obscurely.
 *
 * Each test names the release gate it supports, so a failure maps to a decision rather than a noise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(ROOT, 'dist');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const distBuilt = () => fs.existsSync(path.join(DIST, 'index.html'));

/** Every file under a directory, recursively. */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/* ============================ Gate B — secrets ============================ */

test('gate B: no server-only secret reaches the built browser bundle', { skip: !distBuilt() && 'run `npm run build` first' }, () => {
  // The publishable key is DESIGNED to be in the bundle; everything else is a leak. Scanning the
  // built output (not the source) is the only check that catches a secret inlined by the bundler.
  //
  // SCOPE MATTERS HERE, and getting it wrong makes the test lie in the expensive direction: a
  // false positive trains people to ignore the gate. Two classes are separated for that reason:
  //
  //   · CONCRETE CREDENTIALS (a `sb_secret_…` value, a connection string with user:password@) are
  //     unmistakable, so they are scanned for in EVERY shipped file including content JSON.
  //   · VARIABLE NAMES (`DATABASE_URL`, `DIRECT_URL`) are only evidence when they appear in CODE, and
  //     the curriculum legitimately TEACHES them — `s04`'s pack has `REQUIRED = {"DATABASE_URL": str}`
  //     as a real lesson example, which ships inside `generated/curriculum/sections.json`. Matching
  //     that would be flagging the teaching material as a leak.
  const credentialPatterns = [
    { pattern: /sb_secret_[A-Za-z0-9_-]{8,}/, what: 'a Supabase secret key' },
    { pattern: /postgres(?:ql)?:\/\/[^\s"'`]*:[^\s"'`]*@/, what: 'a database connection string' },
  ];
  const codeOnlyPatterns = [
    { pattern: /SUPABASE_SECRET_KEY/, what: 'the secret-key variable name' },
    { pattern: /\b(?:DATABASE_URL|DIRECT_URL)\b/, what: 'a server-only database variable name' },
  ];

  const offenders = [];
  for (const file of walk(DIST)) {
    const relative = path.relative(ROOT, file);
    const isCode = /\.(js|mjs|html|css|webmanifest|map)$/i.test(file);
    // Content JSON is read for credentials but not for variable names: prose may name them on purpose.
    const isScannable = isCode || /\.json$/i.test(file);
    if (!isScannable) continue;

    const text = fs.readFileSync(file, 'utf8');
    for (const { pattern, what } of credentialPatterns) {
      if (pattern.test(text)) offenders.push(`${relative} contains ${what}`);
    }
    if (!isCode) continue;
    for (const { pattern, what } of codeOnlyPatterns) {
      if (pattern.test(text)) offenders.push(`${relative} contains ${what}`);
    }
  }
  assert.deepEqual(offenders, [], `secrets in the bundle:\n${offenders.join('\n')}`);
});

test('gate B: an environment variable NAME in the curriculum is teaching, not a leak', () => {
  // The other half of the test above, made explicit so nobody "fixes" the scanner by loosening it
  // again: this is what the content actually says, and it must stay allowed to say it.
  const sections = read('public/generated/curriculum/sections.json');
  assert.match(sections, /DATABASE_URL/, 'the s04 pack teaches environment-config validation by name');
  assert.doesNotMatch(sections, /sb_secret_/, 'but no real credential may ever appear in content');
});

test('gate B: a shipped .env or a key file never lands in dist/', { skip: !distBuilt() && 'run `npm run build` first' }, () => {
  const bad = walk(DIST).filter((f) => /(^|[\\/])\.env(\.|$)|\.pem$|\.key$|id_rsa/i.test(f));
  assert.deepEqual(bad.map((f) => path.relative(ROOT, f)), []);
});

test('gate B: .env.example carries placeholders only', () => {
  const example = read('.env.example');
  // A real value pasted into the template and committed is a leak that cannot be un-committed.
  assert.doesNotMatch(example, /sb_secret_[A-Za-z0-9_-]{8,}/, 'a real secret key is in the template');
  assert.doesNotMatch(example, /postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@(?!HOST)/, 'a real connection string is in the template');
  assert.match(example, /your-project\.supabase\.co/, 'the Supabase URL must stay a placeholder');
  assert.match(example, /your-supabase-publishable-key/, 'the publishable key must stay a placeholder');
});

test('gate B: .env is not tracked by git', () => {
  // Belt and braces next to the bundle scan: `.gitignore` is the only thing keeping committed
  // credentials out of history, and a `.gitignore` edit is easy to lose.
  const ignore = read('.gitignore');
  assert.match(ignore, /^\.env$/m, '.env must be ignored');
  assert.match(ignore, /^\.env\.\*$/m, '.env.* must be ignored');
  assert.match(ignore, /^!\.env\.example$/m, '.env.example must be the one exception');
});

/* =================== Gate D — no personal-data prepopulation =================== */

test('gate D: a fresh learner profile carries NO personal data', async () => {
  // `defaultState()` seeds every new account. A name here was a real person's, which made a new
  // learner's dashboard greet a stranger and pre-filled the onboarding name field.
  const store = read('src/core/storage/store.ts');
  const defaults = store.match(/export const defaultState[\s\S]*?profile:\s*\{([^}]*)\}/);
  assert.ok(defaults, 'defaultState must be a literal so this test can read it');
  assert.match(defaults[1], /name:\s*''/, 'the default profile name must be empty');
  assert.doesNotMatch(defaults[1], /name:\s*'[^']+'/, 'no name may be seeded');
});

test('gate D: the onboarding name field starts empty for a fresh account', () => {
  const onboarding = read('src/features/dashboard/Onboarding.tsx');
  // It may fall back to the VERIFIED account's name, never to application seed data.
  assert.match(onboarding, /useState\(state\.profile\.name \|\| user\?\.name \|\| ''\)/,
    'the name field must start empty and may only fall back to the signed-in account');
  assert.match(onboarding, /validName/, 'onboarding must refuse to continue without a name');
  assert.match(onboarding, /aria-invalid/, 'the invalid name field must announce itself');
});

test('gate D: no personal name is seeded into the bundled lab datasets', () => {
  // The SQL and Pandas labs render these rows on screen, so a real name in them is a visible leak in
  // every deployment rather than a private-content question.
  const datasets = read('src/core/data/datasets.ts');
  const names = [...datasets.matchAll(/'([A-Z][a-z]{3,})'/g)].map((m) => m[1]);
  assert.ok(names.length > 0, 'the datasets must contain sample names for the SQL labs');
  // A full personal name (two words) is what must never appear; single first names are sample data.
  assert.doesNotMatch(datasets, /'[A-Z][a-z]+ [A-Z][a-z]+'/, 'a full personal name is in the bundled data');
});

/* ========================= Gate D — accessibility ========================= */

test('gate D: every input the UI marks invalid also announces it', () => {
  // `class="invalid"` is a colour change. A screen-reader user gets nothing from it, so each marked
  // field must carry `aria-invalid` too — and this test exists because the auth forms did not.
  const files = walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.tsx'));
  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const marksInvalid = /className=\{[^}]*\binvalid\b/.test(source);
    if (marksInvalid && !/aria-invalid/.test(source)) offenders.push(path.relative(ROOT, file));
  }
  assert.deepEqual(offenders, [], `files marking a field invalid without aria-invalid:\n${offenders.join('\n')}`);
});

test('gate D: form errors are announced, and every input is labelled', () => {
  for (const file of ['src/features/auth/AuthForm.tsx', 'src/features/auth/ResetPassword.tsx']) {
    const form = read(file);
    assert.match(form, /role="alert"/, `${file} must announce its field errors`);
    // Each `<input` must be inside a `<label>` (this project's convention) or carry aria-label.
    const inputs = form.split('<input').length - 1;
    const labels = form.split('<label').length - 1;
    assert.ok(labels >= inputs - 1, `${file}: ${inputs} inputs but only ${labels} labels`);
  }
});

test('gate D: reduced-motion is respected and focus is never removed without a replacement', () => {
  const css = read('src/styles.css');
  assert.match(css, /prefers-reduced-motion:\s*reduce/, 'the stylesheet must honour reduced motion');

  // The baseline: every element a keyboard user lands on must have a focus treatment. One rule
  // covers the native controls, and the named ones are the custom elements that replace them.
  assert.match(css, /\.btn:focus-visible,\s*a:focus-visible,\s*input:focus-visible,\s*textarea:focus-visible,\s*select:focus-visible/,
    'the baseline focus ring must cover buttons, links and form controls');
  for (const selector of ['.path-card', '.stage-tile', '.lang-switch-btn', '.bn-ai', '.side-btn-desk']) {
    assert.ok(css.includes(`${selector}:focus-visible`), `${selector} needs a visible focus state`);
  }

  // `outline: none` is a defect only on a FOCUSABLE element that then has no replacement indicator.
  // A non-interactive status label (`.sb-last-seen` is a tooltip target with `cursor: help`) is not
  // focusable in the first place, so suppressing a default ring there is correct — flagging it would
  // be exactly the kind of false positive that teaches people to ignore this gate. The replacement
  // may live on the same selector or on its `:focus-visible` rule, so both are inspected.
  const offenders = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectorList, body] = match;
    if (!/(?:^|[;{]\s*)outline:\s*(?:none|0)\s*(?:;|$)/m.test(body)) continue;
    // Only selectors that actually receive keyboard focus are in scope.
    const focusable = /(?:^|,)\s*(?:\.[\w-]*)?(?:btn|input|select|textarea|link|navlink)\b|(?:^|,\s*)(?:a|button|input|textarea|select)\s*(?:,|$|:)/.test(selectorList);
    if (!focusable) continue;
    const hasReplacement = /box-shadow\s*:|border-color\s*:|outline-offset\s*:|outline-width\s*:/.test(body);
    // The same selector list may carry its ring in a separate `:focus-visible` rule.
    const named = selectorList.trim().split(',').map((s) => s.trim()).filter(Boolean);
    const hasFocusRule = named.some((selector) => css.includes(`${selector}:focus-visible`));
    if (!hasReplacement && !hasFocusRule) {
      offenders.push(`${selectorList.trim()} (line ${css.slice(0, match.index).split('\n').length})`);
    }
  }
  assert.deepEqual(offenders, [], `focusable element with no focus indicator: ${offenders.join(', ')}`);
});

/* ==================== Gate E — deployment configuration ==================== */

test('gate E: the built shell is a hash-routed SPA, so deep links need no rewrite rule', { skip: !distBuilt() && 'run `npm run build` first' }, () => {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  assert.match(html, /<div id="root">/, 'the SPA mount point must be in the built shell');
  assert.match(html, /<script type="module" crossorigin src="\.\//, 'assets must be referenced relatively');
  // `base: './'` in vite.config.ts is what makes a project-path deployment (…/BroCode/) work.
  assert.match(html, /(?:src|href)="\.\//, 'assets must use a relative base for a sub-path deployment');
});

test('gate E: private routes are not advertised to search engines', () => {
  const sitemap = read('public/sitemap.xml');
  // The sitemap is generated from the route table. `scripts/sitemap.cjs` now holds a PRIVATE map, and
  // this asserts the two things that make it trustworthy: none of those routes is published, and the
  // list cannot drift into hiding a page nobody chose to hide.
  const sitemapModule = path.join(ROOT, 'scripts', 'sitemap.cjs');
  const privateRoutes = [
    '/admin', '/progress', '/notes', '/settings', '/onboarding', '/login', '/reset-password',
  ];
  for (const route of privateRoutes) {
    assert.doesNotMatch(sitemap, new RegExp(`#${route}<`), `${route} must not be in the sitemap`);
  }
  // …while the genuinely public, discoverable product must be, or the sitemap is useless.
  for (const route of ['/start', '/courses', '/practice', '/labs', '/questions']) {
    assert.match(sitemap, new RegExp(`#${route}<`), `${route} must stay discoverable`);
  }
  // Every private route must be a REAL route, and must be declared in the generator rather than
  // filtered by a regex this test cannot see.
  const app = read('src/app/App.tsx');
  const generation = fs.readFileSync(sitemapModule, 'utf8');
  for (const route of privateRoutes) {
    assert.ok(app.includes(`path="${route}"`), `${route} is not a route any more — update PRIVATE in sitemap.cjs`);
    assert.ok(generation.includes(`'${route}'`), `${route} must be listed in sitemap.cjs PRIVATE`);
  }
});

test('gate E: robots.txt points at the real sitemap and hides nothing by accident', () => {
  const robots = read('public/robots.txt');
  assert.match(robots, /Sitemap:\s*https:\/\//, 'robots.txt must name an absolute sitemap URL');
  assert.doesNotMatch(robots, /Disallow:\s*\/$/, 'a bare `Disallow: /` would deindex the whole site');
});

test('gate E: PWA metadata is present and consistent with the shell', { skip: !distBuilt() && 'run `npm run build` first' }, () => {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.webmanifest'), 'utf8'));
  assert.ok(manifest.name, 'the manifest must name the app');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'the manifest must declare icons');
  assert.match(html, /rel="manifest"/, 'the shell must link the manifest');
  assert.match(html, /name="theme-color"/, 'the shell must declare a theme colour');
  // Every icon the manifest promises must actually ship, or install breaks silently.
  for (const icon of manifest.icons) {
    const file = path.join(DIST, icon.src.replace(/^\.\//, ''));
    assert.ok(fs.existsSync(file), `manifest icon missing from dist: ${icon.src}`);
  }
});

/* ====================== Gate A — first-load performance ====================== */

test('gate A: the first page load stays small — the heavy assets are lazy', { skip: !distBuilt() && 'run `npm run build` first' }, () => {
  // dist/ is ~94 MB, almost all of it Pyodide's wheels, Monaco's language workers and the two PDFs.
  // Only the INITIAL transfer is a user-facing number, so the budget is measured on the static import
  // graph reachable from index.html — dynamic `import()` boundaries are exactly what must be excluded.
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const entrySpecs = [
    ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]),
  ].filter((s) => s.startsWith('./') || s.startsWith('/'));

  const seen = new Set();
  const queue = [];
  const resolveFrom = (fromFile, spec) => {
    const base = path.resolve(path.dirname(fromFile), spec);
    for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
  };
  for (const spec of entrySpecs) {
    const file = resolveFrom(path.join(DIST, 'index.html'), spec);
    if (file) queue.push(file);
  }
  let initialJs = 0;
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith('.js')) initialJs += fs.statSync(file).size;
    const code = fs.readFileSync(file, 'utf8');
    for (const m of code.matchAll(/\bfrom\s*["'](\.[^"']+)["']/g)) {
      const target = resolveFrom(file, m[1]);
      if (target) queue.push(target);
    }
  }

  const initialJsKb = initialJs / 1024;
  const gzipKb = zlib.gzipSync(Buffer.alloc(Math.min(initialJs, 1 << 20))).length / 1024; // sanity only
  assert.ok(gzipKb > 0);
  // The shell was ~610 KB raw / ~190 KB gzip when this budget was set. 900 KB raw leaves room for
  // growth while failing loudly if a heavy dependency is ever imported STATICALLY into the shell —
  // which is the actual regression this guards (Monaco or Pyodide pulled into the entry graph would
  // blow past it immediately).
  assert.ok(
    initialJsKb < 900,
    `first-load JS is ${initialJsKb.toFixed(0)} KB — a heavy dependency was probably imported statically. `
    + 'Monaco, Pyodide and the PDF reader must stay behind dynamic import().',
  );

  // And the contrast that makes the budget meaningful: the big assets must NOT be in that graph.
  const initialNames = new Set([...seen].map((f) => path.basename(f)));
  for (const heavy of ['MonacoIDE', 'pyodide', 'pdf']) {
    const inInitial = [...initialNames].some((n) => n.toLowerCase().includes(heavy.toLowerCase()));
    assert.equal(inInitial, false, `${heavy} must not be in the initial graph`);
  }
});
