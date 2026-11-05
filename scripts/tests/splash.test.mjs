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

test('splash: the official mark is the first visual, unmodified and proportional', () => {
  // The splash used to point at an owner-supplied illustration that was never committed, so the
  // first frame was a 404 and the wordmark fallback. It now draws the SAME generated mark every
  // other surface draws, which `npm run brand:write` renders and the gate below pins.
  const splash = read('src/components/shared/SplashScreen.tsx');
  assert.match(splash, /import \{ BrandMark \} from '\.\/BrandMark'/, 'the splash draws the shared mark');
  assert.match(splash, /<BrandMark size=\{\d+\} alt="BroCode"/, 'the mark is attributed and never stretched');
  assert.doesNotMatch(splash, /brocode-loading|brocode-pixel-loader/, 'retired hand-exported art is gone');
  assert.doesNotMatch(splash, /canvas|filter: |transform: scale\(1\.\d+\) .*img/i, 'the artwork is not re-rendered');

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
  assert.match(read('index.html'), /rel="preload" as="image"[\s\S]{0,120}brocode-mark\.svg\?v=\d+/, 'the mark the splash draws is preloaded');
});

test('splash: every asset it draws ships in the build', () => {
  // A splash may never point at a file the build does not serve: both of its old paths 404'd on the
  // live site. It draws the shared component, so the only asset to check is the mark that component
  // names — and that is generated, so it must exist on disk after `npm run brand:write`.
  const splash = read('src/components/shared/SplashScreen.tsx');
  assert.doesNotMatch(splash, /IMAGE_SRC/, 'the splash keeps no separate artwork constant');
  const mark = read('src/components/shared/BrandMark.tsx');
  const match = /MARK_SVG = '\.\/(.+?)'/.exec(mark);
  assert.ok(match, 'BrandMark names its master on one static line');
  assert.ok(fs.existsSync(path.join(ROOT, 'public', match[1])), `public/${match[1]} must ship — run \`npm run brand:write\``);
});
