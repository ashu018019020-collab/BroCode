/**
 * Theme and profile-photo guards.
 *
 * Two things could regress silently here, and both are invisible in a unit test that only checks a
 * function's return value:
 *
 *   1. WHICH THEME THE APP OPENS IN. It is decided in three places that must agree — the product
 *      default in `core/storage/ui.ts`, the inline boot script in `index.html` (which paints the
 *      attribute before the bundle loads), and the CSS scope that responds to it. A drift between
 *      them is a flash of the wrong theme, or worse, a stored choice being ignored.
 *
 *   2. WHETHER THE LIGHT ACCENTS ARE READABLE. They are TEXT colours on small bold labels and pills.
 *      The previous values were picked by eye and measured 3.2–4.1:1, i.e. below WCAG AA. Nothing in
 *      the build would have caught that, so the floor is pinned here by computing the real contrast
 *      ratio from the real stylesheet with the WCAG formula.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

/* ------------------------------- WCAG contrast ------------------------------- */

const rgbOf = (hex) => {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

/** The body of the first rule whose selector matches, so a test reads what the browser reads. */
function block(css, selector) {
  const at = css.indexOf(selector);
  assert.notEqual(at, -1, `the stylesheet has no rule for ${selector}`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

/**
 * Every `prop: value;` declaration inside a rule body — custom properties AND real ones.
 *
 * Real properties matter here: `color-scheme` is what tells the browser to draw native scrollbars and
 * form controls for the theme, and asserting it is part of "the light page is actually light".
 */
function tokens(body) {
  const out = new Map();
  // `--[\w-]+` or a bare `[\w-]+` — anchored on a declaration boundary so a value like
  // `linear-gradient(180deg, ...)` cannot be mistaken for a property.
  for (const match of body.matchAll(/(?:^|[;{\s])(--[\w-]+|[a-z][\w-]*)\s*:\s*([^;{}]+);/gi)) {
    out.set(match[1], match[2].trim());
  }
  return out;
}

const CSS = read('src/styles.css');
const LIGHT = tokens(block(CSS, ":root[data-theme='light'] {"));

/* ---------------------------- light accent readability ---------------------------- */

test('theme: every light accent clears WCAG AA on the page AND on a card', () => {
  // The two surfaces an accent can land on. 4.6 rather than 4.5 leaves a hair of rounding room and
  // keeps the assertion readable; the tokens themselves measure 4.62–5.70.
  const surfaces = { card: '#ffffff', page: LIGHT.get('--background') };
  assert.match(surfaces.page ?? '', /^#[0-9a-f]{6}$/i, 'the light page colour must be a hex value');

  const accents = ['--cyan', '--blue', '--purple', '--violet', '--pink', '--green', '--amber', '--red', '--primary'];
  for (const name of accents) {
    const value = LIGHT.get(name);
    assert.ok(value, `the light theme must define ${name}`);
    assert.match(value, /^#[0-9a-f]{6}$/i, `${name} must be a hex colour, got ${value}`);
    for (const [label, surface] of Object.entries(surfaces)) {
      const ratio = contrast(value, surface);
      assert.ok(ratio >= 4.6, `${name} ${value} is ${ratio.toFixed(2)}:1 on the ${label} — below AA (4.5)`);
    }
  }
});

test('theme: the ten light tone accents are readable too', () => {
  const page = LIGHT.get('--background');
  const toneBlock = CSS.slice(CSS.indexOf(":root[data-theme='light'] .tone-blue"));
  const tones = [...toneBlock.matchAll(/:root\[data-theme='light'\] \.tone-([\w-]+)\s*\{\s*--accent:\s*(#[0-9a-f]{6})/gi)];
  assert.equal(tones.length, 11, 'the light theme must re-declare all eleven tone accents');
  for (const [, name, value] of tones) {
    for (const surface of ['#ffffff', page]) {
      const ratio = contrast(value, surface);
      assert.ok(ratio >= 4.6, `.tone-${name} ${value} is ${ratio.toFixed(2)}:1 — below AA (4.5)`);
    }
  }
});

test('theme: the light page is light and the dark page is dark', () => {
  const dark = tokens(block(CSS, ':root {'));
  // A regression here would invert the whole product, so the two ends are asserted explicitly.
  assert.ok(contrast(LIGHT.get('--background'), '#ffffff') < 1.2, 'the light background must be near-white');
  assert.ok(contrast(dark.get('--background'), '#000000') < 1.2, 'the dark background must be near-black');
  assert.equal(LIGHT.get('color-scheme'), 'light');
  assert.equal(dark.get('color-scheme'), 'dark');
});

/* ------------------------------- the default theme ------------------------------- */

test('theme: the product default is LIGHT, and it is stated once', () => {
  const ui = read('src/core/storage/ui.ts');
  const defaults = ui.match(/const DEFAULTS:\s*UiPrefs\s*=\s*\{([^}]*)\}/);
  assert.ok(defaults, 'DEFAULTS must be a literal so this test can read it');
  assert.match(defaults[1], /theme:\s*'light'/, 'the shipped default theme must be light');
  assert.doesNotMatch(defaults[1], /theme:\s*'dark'/);
});

test('theme: an explicit dark choice is still honoured', () => {
  const ui = read('src/core/storage/ui.ts');
  // `resolveTheme` must consult the CHOICE marker, not the stored theme alone: a stored `dark` with
  // no marker is the pre-light default, while a marked one is a decision.
  assert.match(ui, /export function resolveTheme\(\)[\s\S]{0,120}themeChoice\(\)\s*\?\?\s*DEFAULTS\.theme/);
  assert.match(ui, /if \(patch\.theme\)\s*\{[\s\S]{0,200}localStorage\.setItem\(CHOICE_KEY,\s*'1'\)/,
    'choosing a theme must record that it was a choice');
});

test('theme: the boot script and the module agree on the storage keys and the default', () => {
  const html = read('index.html');
  const ui = read('src/core/storage/ui.ts');
  const boot = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(boot, 'index.html must carry the inline boot script');

  // The keys are the contract between two files that cannot import each other.
  assert.match(ui, /const KEY = 'aiml:ui:v1'/);
  assert.match(ui, /const CHOICE_KEY = 'aiml:theme:choice'/);
  assert.match(boot[1], /'aiml:ui:v1'/, 'the boot script must read the same preference key');
  assert.match(boot[1], /'aiml:theme:choice'/, 'the boot script must read the same choice key');

  // The fallback must be light, in both files, or a blocked localStorage changes the default theme.
  assert.match(boot[1], /\?\s*theme\s*:\s*'light'/, 'the boot script must default to light');
  assert.match(boot[1], /setAttribute\('data-theme',\s*'light'\)/, 'the boot catch must resolve to light');

  // It must set the attribute BEFORE </head> so nothing paints in the wrong theme first.
  const headEnd = html.indexOf('</head>');
  assert.ok(html.indexOf('aiml:ui:v1') < headEnd, 'the boot script must run inside <head>');

  // And it must claim the real paint colour, not the dark one.
  assert.match(html, /<meta name="theme-color" content="#f2f4fa" \/>/, 'theme-color must default to the light page colour');
  assert.doesNotMatch(html, /name="theme-color" content="#0a0a0a"/, 'the dark hex must no longer be the static default');
});

/* --------------------------- the profile photo boundary --------------------------- */

test('avatar: only a small raster data URL is accepted', async () => {
  const { checkAvatar, safeAvatar, AVATAR_MAX_CHARS } = await import(
    // A pure module with no runtime imports, so the test loader can read it directly.
    new URL('../../src/core/platform/avatar.ts', import.meta.url).href
  );
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.deepEqual(checkAvatar(png), { ok: true, value: png });
  assert.equal(safeAvatar('data:image/jpeg;base64,/9j/4AAQ'), 'data:image/jpeg;base64,/9j/4AAQ');

  // The three ways a hostile or mistaken value is refused.
  assert.equal(checkAvatar(`data:image/png;base64,${'A'.repeat(AVATAR_MAX_CHARS)}`).reason, 'too-large');
  assert.equal(checkAvatar('javascript:alert(1)').reason, 'not-an-image');
  assert.equal(checkAvatar('data:text/html;base64,PHNjcmlwdD4=').reason, 'not-an-image');
  assert.equal(checkAvatar('data:image/svg+xml;base64,PHN2Zz4=').reason, 'not-an-image',
    'an SVG is a document, not a bitmap — it must not be accepted');
  assert.equal(checkAvatar('').reason, 'empty');
  assert.equal(checkAvatar(undefined).reason, 'empty');
  assert.equal(checkAvatar(42).reason, 'empty');
  assert.equal(safeAvatar('javascript:alert(1)'), '', 'an unusable avatar becomes "no avatar"');
});

test('avatar: the import boundary actually applies the check', () => {
  const store = read('src/core/storage/store.ts');
  // `importProgress` spreads a learner-supplied file into state; the avatar is the one field in it
  // that reaches markup, so a missing call here is the vulnerability this pins shut.
  const importer = store.slice(store.indexOf('export async function importProgress'));
  assert.match(importer, /checkAvatar\(clean\.profile\.avatar\)/, 'importProgress must validate the imported avatar');
  assert.match(importer, /delete clean\.profile\.avatar/, 'a refused avatar must be dropped, not stored');

  const setter = store.slice(store.indexOf('export function setAvatar'));
  assert.match(setter.slice(0, 900), /checkAvatar\(/, 'setAvatar must not trust its caller either');
});
