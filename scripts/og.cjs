#!/usr/bin/env node
/**
 * The social card — `public/brocode-og.png`, 1200×630, generated rather than drawn by hand.
 *
 * `public/**` is either generated or a bundled runtime, and this is the one artifact that cannot be
 * built in JavaScript: a text-heavy card needs a real text engine, so the generator renders an HTML
 * card with a headless Chrome/Edge (a BUILD-TIME tool, not a runtime or test dependency) and writes
 * the PNG. That is why `scripts/tests/sitemap.test.mjs` pins the artifact's CONTRACT — it exists, it
 * is a PNG, it is exactly 1200×630, and index.html's open-graph and twitter tags agree with it and
 * with the `<title>` and description the same file already pins — instead of its bytes: rendering
 * bytes differ between machines and Chrome versions, while the contract is what a crawler reads.
 *
 * Everything in the card comes from a registry, never from marketing copy typed here:
 *   · the palette and the font stack are parsed out of src/styles.css (a renamed token fails loudly);
 *   · "36 steps / 11 courses" are counted from public/generated/courses/index.json;
 *   · "13,000+ questions" is the search index's own item count, floored to a thousand (the same
 *     claim index.html's meta description makes);
 *   · the ten domain chips are the names in Landing.tsx's DOMAINS band, the list the shell's
 *     JSON-LD and the homepage both render.
 *
 * Usage:
 *   node scripts/og.cjs                 # dry run: renders to a temp file and prints its path
 *   node scripts/og.cjs --write         # writes public/brocode-og.png
 *   node scripts/og.cjs --chrome=<path> # pick the browser explicitly (or set CHROME_PATH)
 *   npm run og:write
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'public', 'brocode-og.png');
const MARK_PATH = path.join(ROOT, 'public', 'brocode-256.png');
const CSS_PATH = path.join(ROOT, 'src', 'styles.css');
const LANDING_PATH = path.join(ROOT, 'src', 'features', 'dashboard', 'Landing.tsx');
const COURSES_PATH = path.join(ROOT, 'public', 'generated', 'courses', 'index.json');
const SEARCH_PATH = path.join(ROOT, 'public', 'generated', 'search', 'index.json');

const WIDTH = 1200;
const HEIGHT = 630;

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`\x1b[31m✕\x1b[0m ${m}`);
const arg = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : undefined;
};

const read = (p) => fs.readFileSync(p, 'utf8');
const readJson = (p) => JSON.parse(read(p));

/** The app's own tokens, so the card cannot drift into a palette the product does not use. */
function tokens() {
  const css = read(CSS_PATH);
  const root = css.slice(css.indexOf(':root'), css.indexOf('\n}', css.indexOf(':root')));
  const want = [
    '--background-2', '--foreground', '--muted-foreground', '--card',
    '--cyan', '--blue', '--violet', '--accent-grad',
  ];
  const out = {};
  for (const name of want) {
    const value = root.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1]?.trim();
    if (!value) throw new Error(`src/styles.css no longer defines ${name}`);
    out[name] = value;
  }
  const font = css.match(/body\s*\{[^}]*?font:\s*[^;]*?\s((?:ui-|system-ui|-apple)[^;]+);/s)?.[1]?.trim();
  if (!font) throw new Error('src/styles.css body font stack not found — the card would use the wrong typeface');
  return { ...out, font };
}

/** The ten domains, from the homepage band the shell's JSON-LD also mirrors. */
function domains() {
  const src = read(LANDING_PATH);
  const block = src.slice(src.indexOf('const DOMAINS'), src.indexOf('];', src.indexOf('const DOMAINS')));
  const names = [...block.matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
  if (names.length !== 10) throw new Error(`Landing.tsx DOMAINS has ${names.length} entries — expected the ten domains`);
  return names;
}

function numbers() {
  const courses = readJson(COURSES_PATH).courses;
  const steps = courses.reduce((n, c) => n + c.steps.length, 0);
  const items = readJson(SEARCH_PATH).counts.items;
  const thousands = Math.floor(items / 1000) * 1000;
  return { courses: courses.length, steps, questions: `${thousands.toLocaleString('en-US')}+` };
}

/** The browser is a build-time tool: look where each OS actually puts one. */
function findChrome() {
  const explicit = arg('chrome') ?? process.env.CHROME_PATH;
  const candidates = [
    explicit,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error('No Chrome/Edge found. Pass --chrome=<path> or set CHROME_PATH — the card is rendered, not drawn.');
  }
  return found;
}

/** The card, as one self-contained document: no web fonts, no animation, no network. */
function buildCard() {
  const t = tokens();
  const n = numbers();
  const chips = domains();
  const mark = `data:image/png;base64,${fs.readFileSync(MARK_PATH).toString('base64')}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>BroCode social card</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body {
    font-family: ${t.font};
    color: ${t['--foreground']};
    background-color: ${t['--background-2']};
    -webkit-font-smoothing: antialiased;
    background-image:
      radial-gradient(760px 480px at 88% -10%, ${t['--cyan']}29, transparent 62%),
      radial-gradient(680px 440px at 0% 106%, ${t['--violet']}24, transparent 60%),
      linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
    background-size: auto, auto, 42px 42px, 42px 42px;
  }
  .card { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; padding: 60px 72px 56px; display: flex; flex-direction: column; }
  .bar { position: absolute; top: 0; left: 0; right: 0; height: 6px; background: ${t['--accent-grad']}; }
  .wm { position: absolute; right: -58px; top: 74px; width: 470px; opacity: .04; }
  header { display: flex; align-items: center; gap: 16px; }
  header img { width: 62px; height: 62px; border-radius: 14px; }
  .wordmark { font-size: 30px; font-weight: 700; letter-spacing: -0.2px; }
  .tag { margin-left: auto; font-family: 'Cascadia Code', 'Consolas', ui-monospace, monospace; font-size: 15px; font-weight: 600;
         color: ${t['--muted-foreground']}; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.04);
         border-radius: 999px; padding: 10px 18px; }
  h1 { margin-top: 54px; max-width: 940px; font-size: 76px; line-height: 1.06; letter-spacing: -2.4px; font-weight: 800; }
  h1 span { background: ${t['--accent-grad']}; -webkit-background-clip: text; background-clip: text; color: transparent; }
  .stats { margin-top: 24px; font-size: 27px; font-weight: 650; letter-spacing: -0.3px; }
  .why { margin-top: 12px; font-size: 21px; color: ${t['--muted-foreground']}; }
  .chips { margin-top: auto; display: flex; flex-wrap: wrap; gap: 10px; max-width: 1020px; }
  .chip { font-size: 16px; color: ${t['--muted-foreground']}; border: 1px solid rgba(255,255,255,.12);
          background: rgba(255,255,255,.035); border-radius: 999px; padding: 9px 15px; }
  /* No chip is highlighted: AI/ML is one of ten domains here, never the platform identity — the
     same decision the <title> is pinned to in scripts/tests/sitemap.test.mjs. */
</style>
</head>
<body>
  <div class="card">
    <div class="bar"></div>
    <img class="wm" src="${mark}" alt="" />
    <header>
      <img src="${mark}" alt="" />
      <span class="wordmark">BroCode</span>
      <span class="tag">runs in the browser</span>
    </header>
    <h1>Learn <span>technology</span> by building,<br />start to finish.</h1>
    <p class="stats">${n.steps} steps &middot; ${n.courses} courses &middot; ${n.questions} questions</p>
    <p class="why">Runnable Python, SQL, notebook and AI labs — start free.</p>
    <div class="chips">
${chips.map((c) => `      <span class="chip">${c}</span>`).join('\n')}
    </div>
  </div>
</body>
</html>
`;
}

/** 1200×630 or nothing: the declared size in index.html is only honest if the file matches it. */
function assertPng(file) {
  const png = fs.readFileSync(file);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((b, i) => png[i] === b)) throw new Error(`${file} is not a PNG`);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== WIDTH || height !== HEIGHT) {
    throw new Error(`Chrome produced ${width}×${height}; the OG spec wants ${WIDTH}×${HEIGHT}`);
  }
  return { width, height, bytes: png.length };
}

function render(chrome, dir) {
  const html = path.join(dir, 'card.html');
  const png = path.join(dir, 'card.png');
  fs.writeFileSync(html, buildCard());
  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-device-scale-factor=1',
    `--window-size=${WIDTH},${HEIGHT}`,
    '--virtual-time-budget=3000',
    '--run-all-compositor-stages-before-draw',
    `--user-data-dir=${path.join(dir, 'profile')}`,
    `--screenshot=${png}`,
    `file:///${html.replace(/\\/g, '/')}`,
  ], { stdio: 'pipe', timeout: 90_000 });
  return { png, html };
}

if (require.main === module) {
  const write = process.argv.includes('--write');
  console.log(`\n— social card (${write ? 'write' : 'dry run'}) —\n`);
  try {
    const chrome = findChrome();
    const n = numbers();
    console.log(`  browser: ${chrome}`);
    console.log(`  counts : ${n.steps} steps · ${n.courses} courses · ${n.questions} questions · ${domains().length} domains`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brocode-og-'));
    const { png, html } = render(chrome, dir);
    const meta = assertPng(png);
    if (write) {
      fs.copyFileSync(png, OUT_PATH);
      ok(`card → public/brocode-og.png (${meta.width}×${meta.height}, ${Math.round(meta.bytes / 1024)} kB)`);
    } else {
      ok(`rendered ${meta.width}×${meta.height} (${Math.round(meta.bytes / 1024)} kB)`);
      console.log(`\n  png  : ${png}\n  html : ${html}`);
      console.log('\nDry run — nothing written. Apply with: npm run og:write');
    }
  } catch (error) {
    bad(error.message);
    process.exit(2);
  }
}

module.exports = { buildCard, tokens, domains, numbers, WIDTH, HEIGHT, OUT_PATH };
