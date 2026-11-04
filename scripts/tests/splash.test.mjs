/**
 * The startup splash — pins the promises that are easy to fake.
 *
 *   1. The supplied artwork is the first visual, referenced at its exact path, `contain`ed and never
 *      stretched, with a real `max-height`.
 *   2. The gate is the REAL session restore (`useAuth().loading`), not a timer and not the artwork's
 *      decorative percentage.
 *   3. It is mounted above the router, so internal navigation never replays it.
 *   4. A failed restore is an error with Retry, and reduced motion is honoured.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('splash: the supplied illustration is the first visual, unmodified and proportional', () => {
  const splash = read('src/components/shared/SplashScreen.tsx');
  assert.match(splash, /'\.\/images\/brocode-loading\.png'/, 'the exact asset path is used');
  assert.doesNotMatch(splash, /canvas|filter: |transform: scale\(1\.\d+\) .*img/i, 'the artwork is not re-rendered');
  assert.match(splash, /onError=/, 'a missing asset degrades to a wordmark, never a broken-image icon');

  const css = read('src/styles.css');
  const art = css.slice(css.indexOf('.boot-art {'));
  assert.match(art.slice(0, 400), /object-fit: contain/, 'the illustration is contained, not cropped');
  assert.match(art.slice(0, 400), /max-height: 88vh/, 'desktop keeps it inside the viewport');
  assert.match(art.slice(0, 400), /width: min\(90vw, 1220px\)/, 'desktop sizing is the requested range');
  assert.match(css, /@media \(max-width: 640px\)[\s\S]{0,120}\.boot-art \{ width: 96vw/, 'mobile fills the width without overflow');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, 'reduced motion is respected');
});

test('splash: the gate is the real session restore, never the artwork percentage', () => {
  // Comments are stripped: the file EXPLAINS why 78% is artwork, and that explanation is the point.
  const splash = read('src/components/shared/SplashScreen.tsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.match(splash, /useAuth\(\)/, 'it reads the real auth state');
  assert.match(splash, /const \{ loading, serviceError \} = useAuth\(\)/, 'loading is the restore, not a local timer');
  assert.match(splash, /EXIT_MS/, 'the exit is a transition, not a fake delay');
  assert.doesNotMatch(splash, /78\s*%/, 'the 78% in the artwork is not wired as progress');
  assert.doesNotMatch(splash, /setInterval\(|Math\.random\(/, 'there is no invented progress');
  assert.match(splash, /serviceError/, 'a failed restore is surfaced');
  assert.match(splash, /window\.location\.reload\(\)/, 'the failure offers a real Retry');
  assert.match(splash, /aria-busy=\{busy\}/, 'the screen announces that it is busy');
});

test('splash: it runs on a document load only, above the router', () => {
  const main = read('src/app/main.tsx');
  assert.match(main, /<StartupSplash>/, 'the shell wraps the app');
  assert.match(main, /<AuthProvider>[\s\S]{0,120}<StartupSplash>/, 'the splash sits inside the provider it reads');
  const app = read('src/app/App.tsx');
  assert.doesNotMatch(app, /StartupSplash|SplashScreen/, 'a route change can never replay the splash');
  assert.match(read('index.html'), /rel="preload" as="image"[\s\S]{0,80}brocode-loading\.png/, 'the artwork is preloaded');
});

test('splash: the asset path is the one the build serves, with a fallback when it is absent', () => {
  // The illustration is supplied by the product owner. The path is pinned here so a correct
  // component can never ship pointing at a file the build does not serve; if the PNG is not in the
  // tree yet, the splash must still paint the wordmark instead of a broken-image icon.
  const splash = read('src/components/shared/SplashScreen.tsx');
  const match = /IMAGE_SRC = '\.\/(.+?)'/.exec(splash);
  assert.ok(match, 'the image path is a static constant');
  assert.equal(match[1], 'images/brocode-loading.png');
  const present = fs.existsSync(path.join(ROOT, 'public', match[1]));
  assert.ok(present || /boot-fallback/.test(splash), 'an absent PNG still renders a wordmark, never an img error');
});
