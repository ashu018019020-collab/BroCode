/**
 * Mobile OVERFLOW guard — a page must fit the narrowest screen the product supports.
 *
 * This is a source scan rather than a rendered check, for the two reasons AGENTS.md already
 * documents: the test loader cannot import a `.tsx` file, and there is no headless browser in the
 * gate (no CI, no new dependency). What a scan CAN hold is the shape that actually shipped a bug:
 * a block that asks for a fixed width wider than the space a 320px phone gives it, so the document
 * itself gets pushed sideways and the right-hand edge becomes unreachable.
 *
 * That is not hypothetical — the course header carried `minWidth: 280` and overflowed every 320px
 * phone by 8px until it was clamped. The rules below fail on the next one instead of shipping it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
import { readCss } from './_css.mjs';
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

/**
 * The budget: what is LEFT of a 320px screen once the shell has taken its padding.
 *
 * `320` is the narrowest viewport the product claims to support. On it `.content` keeps a 12px
 * gutter on each side (the `max-width: 780px` block) and `.card` adds another 12px of its own
 * (the `max-width: 430px` block), so a page block gets 320 − 24 − 24 = 272px. Anything that
 * hard-codes a minimum above that cannot shrink and drags the document with it.
 *
 * If either padding changes, change it here too — the number is a derived fact, not a preference.
 */
const VIEWPORT = 320;
const CONTENT_GUTTER = 12;
const CARD_PADDING = 12;
const BUDGET = VIEWPORT - CONTENT_GUTTER * 2 - CARD_PADDING * 2; // 272

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Every component in `src/`, so a NEW page is covered by this guard without being listed here. */
const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
};

/**
 * Every `{ … }` block of a stylesheet, as `{ selector, body, line, parents }`.
 *
 * A line grep cannot answer "which rule does this declaration belong to": the dashboard's course
 * strip opens `.course-continue {` on one line and declares `min-width: 320px` on the next, so the
 * selector has to come from the block that ENCLOSES it. Braces are balanced in this file, which is
 * all a small stack needs — and it also lets the scan tell a declaration apart from a media query.
 */
const cssBlocks = (css) => {
  const blocks = [];
  const stack = [];
  let header = '';
  let line = 1;
  let headerLine = 1;
  for (const ch of css) {
    if (ch === '{') {
      stack.push({ selector: header.trim(), line: headerLine, body: '' });
      header = '';
      headerLine = line;
      continue;
    }
    if (ch === '}') {
      const frame = stack.pop();
      if (frame) blocks.push({ ...frame, parents: stack.map((s) => s.selector) });
      header = '';
      headerLine = line;
      continue;
    }
    if (ch === '\n') line++;
    if (stack.length) stack[stack.length - 1].body += ch;
    header += ch;
  }
  return blocks;
};

/** A block inside `@media (min-width: 781px)` never applies to a 320px phone, so it cannot overflow one. */
const desktopOnly = (parents) => parents.some((parent) => {
  if (!parent.startsWith('@media')) return false;
  const floor = parent.match(/min-width:\s*(\d+)px/);
  return !!floor && Number(floor[1]) > VIEWPORT;
});

test('mobile overflow: no component asks for a hard width wider than a 320px phone can give', () => {
  const offenders = [];
  for (const file of walk(path.join(ROOT, 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    /*
     * A NUMERIC literal is the failure shape: `minWidth: 260` cannot shrink below 260px, while the
     * safe spelling is a string the browser resolves against the container — `min(260px, 100%)`
     * keeps the desktop floor and gives the phone the room it has. Strings are therefore allowed and
     * only numbers are judged, which also keeps percentage bars and `height` out of this rule.
     */
    for (const match of source.matchAll(/\b(minWidth|width)\s*:\s*(\d+)\b/g)) {
      const value = Number(match[2]);
      if (value <= BUDGET) continue;
      offenders.push(`${relative}:${lineOf(source, match.index)} — ${match[1]}: ${value}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `These ask for more than the ${BUDGET}px a 320px phone can give its content, so the page would ` +
      `scroll sideways. Use a clamped string such as min(<n>px, 100%) or a percentage:\n` +
      offenders.join('\n'),
  );
});

test('mobile overflow: the course header columns clamp instead of forcing the page sideways', () => {
  // The exact regression: both course headers used a bare `minWidth: 280` (280 > 272 on a 320px
  // phone). Pinned by name because this is the screen a learner reads the page title on.
  for (const file of ['src/features/courses/CoursePage.tsx', 'src/features/courses/StepPage.tsx']) {
    assert.match(
      read(file),
      /minWidth:\s*'min\(280px, 100%\)'/,
      `${file} must clamp its header column with min(280px, 100%) so a 320px phone can fit it.`,
    );
  }
});

test('mobile overflow: a stylesheet minimum wider than the budget is only for something that scrolls itself', () => {
  const css = readCss();
  /*
   * Two declarations are deliberately wider than the budget, and both are safe for a reason this
   * test also checks below — so the allowlist is not an escape hatch, it is a claim being verified:
   *   · `.auth-table` (980px): a data table, ALWAYS rendered inside `.auth-table-wrap`
   *     (`overflow-x: auto`), so it scrolls inside its own box instead of the document.
   *   · `.course-continue` (320px): the first card of the dashboard's course strip, which lives in
   *     `.dash-courses` (`overflow-x: auto`) AND is reset to `min-width: 0` below 780px.
   */
  const allowed = new Map([
    ['.auth-table', 980],
    ['.course-continue', 320],
  ]);

  const found = new Map();
  for (const block of cssBlocks(css)) {
    if (block.selector.startsWith('@')) continue;
    if (desktopOnly(block.parents)) continue;
    for (const match of block.body.matchAll(/min-width:\s*(\d+)px/g)) {
      const value = Number(match[1]);
      if (value <= BUDGET) continue;
      found.set(block.selector, { value, line: block.line });
    }
  }

  const unexpected = [...found]
    .filter(([selector, hit]) => allowed.get(selector) !== hit.value)
    .map(([selector, hit]) => `${selector} — min-width: ${hit.value}px (styles.css:${hit.line})`);
  assert.deepEqual(
    unexpected,
    [],
    `A stylesheet minimum above ${BUDGET}px overflows a ${VIEWPORT}px phone unless it sits inside a ` +
      `horizontal scroller. Either clamp it, or add it to the allowlist above WITH the reason and ` +
      `the check that proves it.\n${unexpected.join('\n')}`,
  );

  // The allowlist is only honest while its two reasons hold.
  const flat = css.replace(/\s+/g, ' ');
  assert.match(flat, /\.auth-table-wrap \{ overflow-x: auto;/, 'the wide admin table must stay inside a horizontal scroller');
  assert.match(flat, /\.course-continue \{ min-width: 0;[^}]*max-width: 100%/, 'the course strip card must be released below 780px');
});

/**
 * The Java course at phone widths.
 *
 * The course is its own workspace (a source textarea, compiler/output blocks and a ten-tab section
 * bar), so it gets its own checks instead of relying on the generic component scan alone. Both
 * budgets are real: 320px is the narrowest viewport the product supports, 390px is the common small
 * phone, and each is what is LEFT after the shell's gutter and the card's padding.
 */
const JAVA_DIR = path.join(ROOT, 'src', 'features', 'java-programming');
const BUDGET_390 = 390 - CONTENT_GUTTER * 2 - CARD_PADDING * 2; // 342

test('mobile overflow: Java notebook, code blocks and section tabs fit 320px and 390px', () => {
  const offenders = [];
  for (const file of walk(JAVA_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    for (const match of source.matchAll(/\b(minWidth|width)\s*:\s*(\d+)\b/g)) {
      const value = Number(match[2]);
      if (value > BUDGET_390) {
        offenders.push(`${relative}:${lineOf(source, match.index)} — ${match[1]}: ${value} is wider than the ${BUDGET_390}px a 390px phone gives its content`);
      } else if (value > BUDGET) {
        offenders.push(`${relative}:${lineOf(source, match.index)} — ${match[1]}: ${value} is wider than the ${BUDGET}px a 320px phone gives its content`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `A fixed width in the Java course cannot shrink, so the page scrolls sideways on a small phone. ` +
      `Clamp it with a string such as min(<n>px, 100%) or use 100%:\n${offenders.join('\n')}`,
  );

  const notebook = read('src/features/java-programming/JNotebook.tsx');
  const lesson = read('src/features/java-programming/JLessonPage.tsx');
  const hub = read('src/features/java-programming/JCoursePage.tsx');
  const css = readCss().replace(/\s+/g, ' ');

  // The notebook is a bounded, full-width box; its compiler and output blocks scroll themselves.
  assert.match(notebook, /className="j-notebook/, 'the Java notebook needs its containment class');
  assert.match(notebook, /aria-label="Java source code/, 'the Java source editor must stay labelled');
  const notebookPres = notebook.match(/<pre\b/g) ?? [];
  assert.ok(notebookPres.length >= 2, `compiler and output blocks must be <pre> (found ${notebookPres.length})`);

  // Every lesson code block carries the Java scroller class, and the tab bar keeps all ten tabs.
  assert.match(lesson, /className="c-code j-code"/, 'Java lesson code blocks need the j-code scroller');
  assert.match(hub, /className="row j-tabs"/, 'the Java hub tab bar needs its containing class');

  const rules = css;
  assert.match(rules, /\.j-notebook, \.j-code, \.j-tabs \{ min-width: 0; max-width: 100%; \}/);
  assert.match(rules, /\.j-notebook pre, \.j-code pre \{ max-width: 100%; overflow: auto; overscroll-behavior-x: contain; \}/);
  assert.match(rules, /\.j-tabs \{ flex-wrap: wrap; \}/);
  assert.match(
    rules,
    /@media \(max-width: 430px\) \{ \.j-notebook pre, \.j-code pre \{ padding: 8px; font-size: 11px; \} \.j-tabs \.btn \{ min-width: 0; \} \}/,
    'the 390px breakpoint must relax Java code padding and tab buttons',
  );
});

test('mobile: the document is the single scroll container and the last row clears the bottom nav', () => {
  const flat = readCss().replace(/\s+/g, ' ');
  /*
   * The architecture, not a cosmetic rule: on a phone the page itself scrolls. `.shell` used to be a
   * fixed-height frame with `.main` as an inner scroller, which trapped touch gestures inside
   * whichever panel started them (the notebook list, a cell, the split lesson column) and left the
   * bottom of the page unreachable. A page re-introducing a fixed-height shell or a nested scroller
   * would silently bring that back, so it fails here.
   */
  assert.match(
    flat,
    /\.shell, \.main \{ height: auto; min-height: 100dvh; overflow: visible;/,
    'below 780px the shell must hand scrolling to the document',
  );
  assert.match(
    flat,
    /\.content \{[^}]*padding-bottom: calc\(96px \+ env\(safe-area-inset-bottom\)\)/,
    'the content must reserve the bottom nav plus the home-indicator safe area',
  );
  assert.match(
    flat,
    /\.c-split-left \{ position: static; max-height: none; overflow: visible;/,
    'the split lesson column must become a static block on phones',
  );
  /*
   * The notebook picker is the exception, and both halves of it are the bug report: it used to be
   * `sticky`, so it pinned itself over the notebook and its options were unreachable — and a plain
   * full-height block pushed the notebook a screen down instead. It must stay static AND bounded, so
   * the box scrolls its own options while the page keeps scrolling.
   */
  assert.match(
    flat,
    /\.nb-listcard \{ position: static; max-height: min\(46dvh, 340px\); overflow: hidden auto;/,
    'the notebook picker must be a bounded, non-sticky scroller on phones',
  );
});
