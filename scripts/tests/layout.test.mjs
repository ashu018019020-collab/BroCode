/**
 * Layout contracts — the rules that decide what a learner has to scroll past.
 *
 * These are structural assertions on the real components, because the failure mode here is not a
 * crash: it is a page that still works and is still unusable. The learned-the-hard-way specifics:
 *
 *   · the Notebook Lab shelf renders under EVERY notebook, and a lesson page holds a dozen of them,
 *     so an expanded library list there was ~200px of "not your lesson" repeated twelve times;
 *   · the authored 16-part workspace mounts all sixteen parts at once, and several carry a
 *     notebook, so the part you were reading sat under fifteen you were not;
 *   · the assistant sat under the last cell, i.e. ABOVE the shelf, which put the help between the
 *     code and the way out of the notebook.
 *
 * The counters are checked too, so this file fails if the fix is applied to one call site and not
 * the others. Zero dependencies — node:test, `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Pure (no React, no store) — the one place a track link is spelled is loadable from here.
const sf = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/surfaces.ts')).href);
// …and the surface registry, because the labs hub derives its list from it rather than from a literal.
const lp = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/paths.ts')).href);
const LAB_FAMILY = lp.EXTRA_PATHS.filter((p) => p.group === 'lab').map((p) => p.route);

/**
 * Every `<h1…>` opening in a .tsx file under src/, with the file+line so a failure names the offender.
 *
 * A JSDoc block comment is stripped first. Documentation legitimately QUOTES markup — the reset page's
 * header comment explains which element it uses — and counting a backticked example as a real heading
 * made the check fire on prose rather than on code. Only `/** … *&#47;` blocks are removed: a JSX
 * `{/* … *&#47;}` comment is left alone, because a real (if commented-out) heading there is still a
 * heading someone will uncomment, and the line numbers below stay truthful either way.
 */
const stripBlockComments = (source) => source.replace(/\/\*\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));

/**
 * Code with every comment removed — for assertions that grep for a literal string.
 *
 * A test that searches a source file for `token` will also find that token inside the paragraph
 * explaining why the token is NOT used, which turns a correct implementation into a failure. That
 * happened twice in this file (the guard's own note about `?next=`, and the reset page's note about
 * which heading element it uses), so the stripping lives here once and both callers share it.
 * Blank-line-preserving on purpose: it keeps `indexOf` and slice-based neighbours meaningful.
 */
const stripComments = (source) => stripBlockComments(source)
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));

const h1s = [];
for (const dir of ['src/features', 'src/components', 'src/app']) {
  for (const rel of fs.readdirSync(path.join(ROOT, dir), { recursive: true }).map((f) => `${dir}/${f}`.replace(/\\/g, '/')).filter((f) => /\.tsx$/.test(f))) {
    const src = stripBlockComments(read(rel));
    [...src.matchAll(/<h1[\s>]/g)].forEach((m) => {
      const line = src.slice(0, m.index).split('\n').length;
      h1s.push({ file: rel, line });
    });
  }
}

const jn = read('src/components/code/JupyterNotebook.tsx');
const nb = read('src/components/code/NotebookCells.tsx');
const tw = read('src/components/learning/TopicWorkspace.tsx');
const css = read('src/styles.css');
const assistantCard = read('src/components/shared/AssistantCard.tsx');
const aiDock = read('src/components/shared/AiDock.tsx');

test('layout: the Notebook Lab shelf is one collapsed line until the learner opens it', () => {
  assert.match(jn, /defaultOpen = false/, 'the shelf must default to closed');
  assert.match(jn, /const \[open, setOpen\] = useState\(defaultOpen\)/);
  assert.match(jn, /aria-expanded=\{open\}/, 'the header must announce whether the shelf is open');
  // The header is a control, not a caption: the row is one button that toggles.
  assert.match(jn, /className="jup-shelf-head small muted"[\s\S]{0,120}setOpen\(\(v\) => !v\)/);
});

test('layout: collapsing the shelf hides its body instead of unmounting it', () => {
  // Unmounting would throw away the runs of a notebook that is already open, so the body stays
  // mounted and only stops taking space.
  assert.match(jn, /className=\{open \? undefined : 'hidden'\}/);
  assert.match(css, /^\.hidden \{ display: none; \}/m, 'the hidden class must actually hide');
  const body = jn.indexOf("className={open ? undefined : 'hidden'}");
  const picks = jn.indexOf('{!openFile && (');
  const opened = jn.indexOf('{openFile && (');
  assert.ok(body > 0 && body < picks && picks < opened, 'both the list and the opened notebook must sit inside the collapsible body');
});

test('layout: the shelf header is one line — never a wrapped, stray button', () => {
  // Measured at 860px: the lesson column gives the shelf row 523px (and 502px at 1440px — the
  // column is capped, so this is NOT viewport-driven). The header is 418px and "Open Notebook Lab"
  // is another 150px, so `.row`'s `flex-wrap: wrap` dropped the controls onto a SECOND line under
  // the collapsed header: a stray "Close notebook" button that reads as attached to nothing, plus
  // an extra line of scroll under every notebook on the page.
  assert.match(css, /\.jup-shelf-wrap > \.row\.spread \{ flex-wrap: nowrap; \}/, 'the shelf row may wrap again');
  assert.match(css, /\.jup-shelf-wrap > \.row\.spread > \.row \{ flex: none; \}/, 'the controls must keep their size');
  assert.match(css, /\.jup-shelf-head \{[^}]*flex: 1 1 auto; min-width: 0; overflow: hidden;/, 'the header must be able to shrink');
  // The label is the information, so it truncates instead of pushing the controls down. Where there
  // is room to truncate: on a phone card there is not, and the label wraps there instead (see the
  // phone-rows test below, which owns the narrow half of this contract).
  assert.match(css, /\.shelf-label \{[^}]*text-overflow: ellipsis;/, 'the label must truncate, not wrap, where there is room');
  assert.match(jn, /<span className="shelf-label"><span className="shelf-brand">Notebook Lab — <\/span>/,
    'the label must be its own truncating node, with the shelf\u2019s name in its own child so a narrow card can drop it');
  // The hint is decoration and yields to the label. It may only appear when the CARD is wide
  // enough to lend it ~95px — a container query, because the card width is not the viewport width
  // (the lesson column is ~502px at a 1440px window).
  assert.match(css, /\.jup-shelf-wrap \{[^}]*container-type: inline-size;/, 'the shelf must be a query container');
  assert.match(css, /@container \(min-width: \d+px\) \{ \.shelf-hint \{ display: inline; \} \}/, 'the hint needs a width gate');
  assert.match(css, /\.shelf-hint \{ display: none;/, 'the hint must start hidden');
  // …and it says something the collapsed line cannot otherwise show: that a notebook is open in a
  // body the learner has folded away.
  assert.match(jn, /\{!open && <span className="shelf-hint">\{openFile \? 'notebook is open' : 'click to open'\}/);
});

test('layout: on a phone the three clipping rows wrap instead of eating their own label', () => {
  // All three rows are the same shape — a flexible name beside fixed chrome — and all three were
  // `white-space: nowrap`, so at 360px the NAME was the thing that got cut. Measured on the real
  // screens (360x760, the smallest phone the app targets):
  //
  //   · notebook shelf ......... 109px of a 299px label — "Notebook L…" — because the head gets
  //                               155px of a 299px row and "Open Notebook Lab" holds the rest;
  //   · playbook chapter ....... 141px of a 325px title, because the "p.3" chip and the chevron
  //                               take 75px of the 259px row;
  //   · Question Bank section .. 199px of 271px on the worst of 29 names — 72px gone — because the
  //                               number and the completeness chip take 100px of the 299px button.
  //
  // None of the three is a missing breakpoint: each breakpoint was already firing. They clipped
  // because ONE LINE was treated as more important than the name, which is backwards — the wide-card
  // rules above are untouched (the label still truncates where there is room to truncate), and on a
  // phone the information takes a second line while the chrome stays put. Each rule below is the one
  // measured decision, kept in one declaration so the numbers above can be re-checked by hand.
  const shelf = read('src/components/code/JupyterNotebook.tsx');
  assert.match(css, /@container \(max-width: 460px\) \{ \.shelf-brand \{ display: none; \} \.shelf-label \{ white-space: normal;/,
    'a narrow shelf card must drop the shelf name and let the count and the scope wrap');
  assert.match(css, /\.shelf-brand \{ display: inline; \}/, 'the name must stay on a wide card');
  assert.match(shelf, /<span className="shelf-brand">Notebook Lab — <\/span>/,
    'the shelf name must be its own node for the narrow rule to drop');

  // The head must ALSO be allowed to wrap: `flex-basis` on a `nowrap` row just shrinks back to what
  // is left beside the chip, which is how the title stayed 141px wide on the first pass of this fix.
  assert.match(css, /@media \(max-width: 640px\) \{ \.ch-head \{ flex-wrap: wrap; \} \.ch-title \{ white-space: normal; overflow-wrap: anywhere; \} \}/,
    'a phone chapter row must wrap its name, not clip it beside the page chip');
  // The title keeps its base `flex: 1` (basis 0) — giving it `100%` breaks the row BEFORE the chevron
  // and costs each of the 36 chapters a line of chrome (measured: 52px → 84px per row).
  assert.ok(!/\.ch-title \{ flex: 1 1 100%;/.test(css), 'the title must not claim the whole row from the chevron');
  assert.match(css, /@media \(max-width: 430px\) \{ \.ch-head > \.chip \{ display: none; \} \}/,
    'below 430px the page chip must yield to the name (the opened panel repeats it)');

  const bank = read('src/features/practice/QuestionBank.tsx');
  assert.match(css, /\.file-row \.sec-name \{[^}]*text-overflow: ellipsis;[^}]*\}/,
    'the section name must truncate on a wide card, like the shelf label');
  assert.match(css, /@media \(max-width: 560px\) \{ \.file-row \.sec-name \{ white-space: normal; overflow-wrap: anywhere; \} \}/,
    'a phone section row must wrap its name');
  assert.match(bank, /<span className="sec-name">\{s\.title\}<\/span>/,
    'the name must be a class, not an inline style — a media query cannot override an inline white-space');
  assert.ok(!/textOverflow: 'ellipsis', whiteSpace: 'nowrap'/.test(bank),
    'the inline clipping style is back, and it will win over the phone rule');
  // The class is scoped to these rows: the Playground's file list shares `.file-row`.
  assert.ok(!/\.file-row \{ white-space/.test(css), 'the wrap must not be pushed onto every .file-row');
});

test('layout: the sidebar has no Learning item, and Courses is the learning home', () => {
  // The standalone Learning surface is retired, and the two bands it left behind — the support
  // paths and the practice archive's per-track coverage — have since come off the courses home as
  // well: the first page is the eleven cards, and what sits under a course is on the course's own
  // page (its steps, and the seven tabs of the step the learner is on). The bands' components are
  // kept, so what this test holds is the MOUNT: a first page that renders them again is the change
  // it exists to catch.
  const app = read('src/app/App.tsx');
  assert.ok(!/label: 'Learning'/.test(app), 'the Learning sidebar item is back');
  assert.ok(!/path="\/path"/.test(app), 'the standalone Learning route is back in the router');
  assert.match(app, /label: 'Courses'/);
  const home = read('src/features/courses/CoursesHome.tsx');
  assert.ok(!/<PathGrid/.test(home), 'the support-path band is back on the first page');
  assert.ok(!/<PlaybookLayer/.test(home), 'the practice-archive layer is back on the first page');
});

test('layout: the assistant is the last thing in a notebook card, below the shelf', () => {
  const shelf = jn.indexOf('{!hideShelf && <NotebookShelf');
  const assistant = jn.indexOf('<AssistantCard embedded context={{ sectionId, where,');
  assert.ok(shelf > 0, 'the card still renders the shelf');
  assert.ok(assistant > shelf, 'the assistant must come after the shelf, not before it');
  // …and the engine must not also render one under the last cell, or every card shows two.
  assert.match(jn, /assistant=\{false\}/, 'the panel must switch off the engine\'s own assistant');
});

test('layout: the assistant still receives the error it was moved away from', () => {
  // Moving the card out of the engine must not cost it the traceback: the error travels up.
  assert.match(nb, /onError\?: \(e: \{ code: string; error: string \} \| null\) => void;/);
  assert.match(nb, /useEffect\(\(\) => \{ onError\?\.\(lastError\); \}, \[lastError, onError\]\)/);
  assert.match(jn, /const \[cellError, setCellError\] = useState<\{ code: string; error: string \} \| null>\(null\)/);
  assert.match(jn, /onError=\{setCellError\}/);
  assert.match(jn, /code: cellError\?\.code, error: cellError\?\.error/);
  // A new task clears it, exactly like the cells it describes.
  assert.match(jn, /setShowSol\(false\); setPrefill\(\{ code: '', nonce: 0 \}\); setCellError\(null\);/);
});

test('layout: Shift+Enter moves on inside its own notebook', () => {
  // With a dozen notebooks mounted at once, the old document-wide lookup handed focus to a cell in
  // a different — now possibly collapsed — notebook.
  assert.doesNotMatch(nb, /querySelectorAll<HTMLTextAreaElement>\('\.jup \[data-cell-index\]'\)/, 'still searching the whole document');
  assert.match(nb, /from\?\.closest\('\.jup'\) \?\? document/);
  assert.match(nb, /focusNextCell\(cellIndex, e\.currentTarget\)/, 'the handler must pass the cell it fired in');
});

test('layout: the 16-part workspace shows one part at a time', () => {
  assert.match(tw, /const \[openPart, setOpenPart\] = useState<string \| null>\('intro'\)/);
  assert.match(tw, /data-open=\{openPart \?\? undefined\}/);
  // Picking a part toggles the accordion (and can open everything again); it no longer scrolls to
  // a section that the accordion may be hiding.
  assert.match(tw, /setOpenPart\(\(cur\) => \(cur === p\.key \? null : p\.key\)\)/);
  assert.doesNotMatch(tw, /onClick=\{\(\) => document\.getElementById\(`pack-\$\{sec\.id\}-\$\{p\.key\}`\)/, 'the nav still scroll-jumps');
  // Sections outside the 16 are exempt, so project questions can never be swallowed.
  assert.match(tw, /id=\{`pack-\$\{sec\.id\}-projectQuestions`\} className="pack-always"/);
});

test('layout: every part of the workspace has an accordion rule (none can silently stay open)', () => {
  // The CSS matches sections by id suffix, so a renamed or new PART would keep rendering in full
  // without this check — the accordion would quietly stop being one.
  const keys = [...tw.matchAll(/^\s*\{ key: '([^']+)', label:/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 16, `expected the 16 PARTS rows, found ${keys.length}`);
  for (const key of keys) {
    assert.ok(
      css.includes(`.pack[data-open="${key}"] > section:not([id$="-${key}"]):not(.pack-always)`),
      `styles.css has no accordion rule for the "${key}" part`,
    );
  }
  assert.match(css, /\{\s*display: none;\s*\}/, 'the accordion rules must hide something');

  // A section id must be spelled with a PARTS key, never with a raw pack value. The pack calls the
  // third project `advanced` while the outline calls the part `project-hard`; naming the section
  // after the level left the rule pointing at an id that does not exist, and an id that matches no
  // rule is hidden by EVERY rule — pressing that button hid the whole workspace.
  const literalIds = [...tw.matchAll(/id=\{`pack-\$\{sec\.id\}-([A-Za-z]+)`\}/g)].map((m) => m[1]);
  assert.ok(literalIds.length >= 12, `expected the workspace's section ids, found ${literalIds.length}`);
  for (const id of literalIds) {
    if (id === 'projectQuestions') continue; // outside the 16, always visible on purpose
    assert.ok(keys.includes(id), `section id "…-${id}" is not a PARTS key, so no accordion rule can match it`);
  }
  assert.doesNotMatch(tw, /id=\{`pack-\$\{sec\.id\}-project-\$\{p\.level\}`\}/, 'project sections must be named by their PARTS key');
  assert.match(tw, /advanced: 'project-hard'/, 'PROJECT_PART must map every pack level onto a PARTS key');
});

test('layout: the assistant card can shrink — its own rows must never widen the page', () => {
  // Found by measurement at 400px: the ask row's send / clear buttons sat 130-171px off the edge of
  // the screen and the page gained a horizontal scrollbar. A flex item defaults to `min-width: auto`
  // (min-content) and a bare <input> is ~20 characters wide, so `flex: 1` alone could not shrink it.
  const ast = read('src/components/shared/AssistantCard.tsx');
  assert.match(css, /\.assistant \.ask input \{ flex: 1; min-width: 0; \}/, 'the ask input still refuses to shrink');
  assert.match(css, /\.assistant \.ask \{[^}]*flex-wrap: wrap;/, 'the ask row must wrap instead of overflowing');
  assert.match(css, /\.assistant \.head \{[^}]*flex-wrap: wrap;/, 'the header row must wrap');
  assert.match(css, /\.assistant \.head > div \{ min-width: 0; \}/, 'the header text block must be shrinkable');
  assert.match(css, /\.assistant \.head \.chip \{ flex: none; \}/, 'the status chip must not be squeezed out of the card');
  // The bot avatar is a fixed square: without `flex: none` it squashes under width pressure.
  assert.match(css, /\.assistant \.bot \{[^}]*flex: none;/, 'the bot avatar must keep its size');
  // Its log is a scroller. The old 170px cap was short enough that a wheel over the card scrolled
  // the log first, which reads as "the page won't scroll", and hid long answers in a keyhole.
  assert.match(ast, /maxHeight: embedded \? 'min\(45vh, 340px\)'/);
  assert.doesNotMatch(ast, /maxHeight: embedded \? 170/, 'the 170px keyhole is back');
  assert.match(ast, /overflowY: 'auto'/, 'the log must stay scrollable, just not a trap');
});

test('layout: a grid track child can never be stretched by a long code line', () => {
  // Grid items default to `min-width: auto`, so one long line inside a card — a notebook output, a
  // cheat-sheet snippet — stretched its `1fr` track and gave the page a horizontal scrollbar instead
  // of scrolling inside the block that already has `overflow-x: auto`. Measured: /ai-lab 144px, /cheat-sheets
  // 120px (290px at 400px), /notebooks 189px.
  for (const grid of ['grid2', 'grid3', 'statgrid', 'stat-row', 'track-grid', 'hero-stats', 'coach-grid', 'path-grid', 'stage-grid', 'nb-layout', 'workbench', 'kpi-row', 'chart-wrap', 'heat-wrap', 'im-skills', 'rmap-step', 'rmap-cols', 'rmap-group', 'nb-boxes']) {
    assert.match(
      css,
      new RegExp(`\\.${grid} > \\*`),
      `.${grid} children have no min-width: 0, so a long line can still blow the page out sideways`,
    );
  }
  const rule = css.slice(css.indexOf('.grid2 > *'), css.indexOf('.grid2 > *') + 320);
  assert.match(rule, /\{ min-width: 0; \}/, 'the grid-children rule must set min-width: 0');
  // The scrollable blocks that receive the overflow keep their own scroller.
  assert.match(css, /\.tablewrap \{ overflow-x: auto; \}/);
  assert.match(css, /^\s*\.pack \.codeblock \{ max-height: 320px; overflow: auto; \}/m);
});

test('layout: the notebook layout collapses instead of squeezing itself into a sliver', () => {
  // Measured at 400px: `.nb-layout` kept its fixed 250px rail and squeezed the notebook into 97px,
  // so one unbreakable token pushed the page 20px sideways. `.workbench` and `.ide-grid` already
  // collapse at a narrow width; the notebook layout was the one that got missed.
  assert.match(css, /@media \(max-width: \d+px\) \{ \.nb-layout \{ grid-template-columns: 1fr; \} \}/, 'the notebook layout never collapses');
  // Plain markdown text needs the same break rule that inline code already had.
  assert.match(css, /\.nb-md, \.nb-md p, \.nb-list li \{ overflow-wrap: anywhere; \}/);
  assert.match(css, /\.nb-inline \{[^}]*overflow-wrap: anywhere;/, 'inline code must keep its break rule');
});

test('layout: the shell keeps the footer flush at the bottom of every page, short or tall', () => {
  // `.main` is a fixed-height flex column whose LAST child is the status bar, so the content has to
  // absorb the free height. Without that, the four shortest routes — the pillar hubs /practice,
  // /labs, /interviews, /career — ended their flow right under the last card and the footer printed
  // mid-screen with dead space beneath it (measured on /practice: bar bottom 728px in an 885px
  // viewport, 0px from the bottom once the content grew), while a long page scrolled it out of view.
  const content = css.match(/\n\.content \{([^}]*)\}/);
  assert.ok(content, '.content must stay a single rule in styles.css');
  // 1 0 auto, not the default 0 1 auto: grow into the space, never shrink a long page inside the
  // scroller (that is how the bottom of the page — and this bar with it — would go missing).
  assert.match(content[1], /flex:\s*1\s+0\s+auto/, 'the content must fill the free height without shrinking a long page');
  // The bar this pins is the shell's sticky last child; growing the content is what gives it a
  // bottom to stick to.
  assert.match(css, /\n\.main \{[^}]*flex-direction:\s*column/);
  assert.match(css, /\n\.statusbar \{[^}]*position:\s*sticky/);
  // ...and the bar must refuse to shrink as well. `.content` above cannot shrink, so on a page
  // taller than the frame the whole overfull deficit landed on the status bar: measured at
  // 1366x768 it collapsed from its natural 35.8px to 11px on /, /questions, /playbook, /concepts,
  // /playground, /notebooks and /sql — the same footer, drawn two different heights, with its
  // cells half cut off. `flex: none` (0 0 auto) keeps the bar at its natural height on every route.
  const bar = css.match(/\n\.statusbar \{([^}]*)\}/);
  assert.ok(bar, '.statusbar must stay a single rule in styles.css');
  assert.match(bar[1], /flex:\s*none/, 'the status bar must not be squeezed by a tall page');
});

test('layout: light mode keeps the console dark — code, notebook and answer surfaces do not invert', () => {
  // A light theme that whitens EVERY surface is wrong in exactly two places: the code and the
  // answer. A code well on a white page loses the only thing that makes it read as code — that it is
  // a screen, not a card — and a plain written-answer box on white is indistinguishable from the card
  // around it, so the learner cannot see where their own words live. Measured on /notebooks in light
  // mode before the fix: `.nb-editor` painted #f5f7fc with #1b2338 ink, i.e. the code cell WAS the
  // page around it (and the output well, a `.codeblock`, was the same near-white).
  //
  // The fix re-declares the dark token set ON the surface rather than restyling each one, so every
  // rule that already draws code by name — the well's colours, the green `.out` line, the labels and
  // chips inside it — keeps working unchanged. These assertions pin the scope, its opaque fill, the
  // focus state and the surfaces that carry their own class in the markup.
  const scope = css.match(/:root\[data-theme='light'\] \.codeblock,[\s\S]*?\n\}/);
  assert.ok(scope, 'the light theme must scope the console surfaces');
  for (const sel of ['.editor', '.nb-editor', '.console']) {
    assert.ok(scope[0].includes(sel), `${sel} must be inside the console scope`);
  }
  assert.match(scope[0], /--code-fg:\s*#d7e4ff/, 'the console must keep the dark theme\'s ink');
  // An OPAQUE fill, not a white wash: a translucent `--input-bg` left the answer box white on the
  // white card, because the `input, textarea` rule paints `--input-bg` OVER whatever is behind it.
  assert.match(scope[0], /--input-bg:\s*#[0-9a-f]{6}/, 'the answer box must be filled, not tinted');
  // The focus state is a translucent cyan wash in both themes; on white it would flip the answer box
  // back to light the moment the learner starts typing, which is exactly when it must not move.
  assert.match(css, /:root\[data-theme='light'\] \.console:focus \{ background-color: #05070e; \}/, 'focus must not un-dark the answer box');
  // The meter and the scrollbar thumb stay dark with it: a pale grey track on a white card is not
  // read as a meter, and a `.18` thumb vanished into the white chrome it has to move inside.
  assert.match(css, /:root\[data-theme='light'\] \.bar,\n:root\[data-theme='light'\] \.mini-bar \{ background: #0a0e18; \}/, 'the progress track must stay dark in light mode');
  assert.match(css, /--scroll: rgba\(6, 10, 24, \.45\);/, 'the light theme\'s scrollbar thumb must be near-black');

  // The ANSWER boxes carry a class of their own, and none of them can be reached by a test import
  // (`_ts-resolve.mjs` resolves `.ts` only), so the markup is read as text — the same technique
  // playbook.test.mjs uses to read App.tsx. The first two are the duplicated pair that must not
  // drift; ExamMode's is the one that is a console either way (`.editor` on a code question).
  for (const file of [
    'src/features/practice/QuestionBank.tsx',
    'src/components/learning/StageQnA.tsx',
    'src/features/interview/FinalAssessment.tsx',
    'src/features/interview/InterviewMode.tsx',
    'src/features/interview/MockInterviews.tsx',
    'src/features/interview/DefensePage.tsx',
    'src/features/learning/Lesson.tsx',
    'src/features/practice/ExamMode.tsx',
  ]) {
    assert.match(read(file), /className=\{?[^>]{0,60}?console/, `${file} must mark its answer box as a console`);
  }
  // …and the document surfaces must NOT be dragged in with it: `/notes` is a document, not a well.
  assert.doesNotMatch(read('src/features/tools/Notes.tsx'), /className="console"/, 'the Notes editor is not a console');
});

test('layout: the redesigned header keeps search, focus, notifications and profile controls wired', () => {
  const app = read('src/app/App.tsx');
  assert.match(app, /Search courses, lessons, skills\.\.\./, 'the search capsule must show the requested prompt');
  assert.match(app, /setPaletteOpen\(true\)/, 'the search capsule must still open the command palette');
  assert.match(app, /key\.toLowerCase\(\) === 'k'[\s\S]{0,100}setPaletteOpen\(true\)/,
    'Ctrl+K must continue to open the command palette');
  assert.match(app, /setUi\(\{ focus: true \}\)[\s\S]{0,100}title="Focus Mode"/,
    'the Focus Mode control must use the existing focus state');
  assert.match(app, /setNotifOpen\(\(v\) => !v\)/, 'the notification button must keep its toggle');
  assert.match(app, /notif-dot/, 'notifications must retain their count badge');
  assert.match(app, /<Link className="profile-chip" to="\/progress"/,
    'the avatar must keep its existing profile destination');
  const headerStart = app.indexOf('<header className={`topbar');
  const headerEnd = app.indexOf('</header>', headerStart);
  const header = app.slice(headerStart, headerEnd);
  assert.doesNotMatch(header, /topbar-brand|BroCode home|Learn <i \/> Practice/,
    'the BroCode logo and wordmark must not appear in the top header');
  // The account flow is NOT a row of header buttons. It is the greeting dialog that opens over
  // whatever page the visitor landed on (see the guest test below), plus the rail's own block —
  // the header keeps only navigation and utilities, and never a link that navigates to /login.
  assert.doesNotMatch(header, /topbar-account|topbar-signin|acct\.signIn|acct\.signOut/,
    'the header must not render account controls');
  for (const [route, label] of [['/', 'Dashboard'], ['/courses', 'Courses'], ['/projects', 'Projects'], ['/questions', 'Quizzes']]) {
    assert.match(app, new RegExp(`to: '${route.replace('/', '\\/')}', label: '${label}'`),
      `the primary navigation must expose ${label} at ${route}`);
  }
  assert.match(css, /:root\[data-theme='light'\] \.topbar,[\s\S]*?--glass-1: rgba\(10, 18, 35,/,
    'the header surface must remain dark in light mode');
  assert.match(css, /\.topbar-nav-link\.active/,
    'the active route must have a dedicated highlighted treatment');
});

test('layout: header and navigation dock keep the dark glass treatment and raised AI control', () => {
  const chrome = css.slice(css.lastIndexOf('/* ---------- Header + navigation dock: dark glass chrome ---------- */'));
  assert.ok(chrome.length > 0, 'the scoped chrome refinements must remain identifiable');
  assert.match(chrome, /\.topbar \{[\s\S]*?background-color: rgba\(5, 10, 22, \.92\)/,
    'the header must retain its dark glass surface in both themes');
  assert.match(chrome, /\.topbar \.searchbox:focus-within \{[\s\S]*?rgba\(34, 211, 238, \.62\)/,
    'search must keep a visible cyan focus state');
  assert.match(chrome, /\.statusbar \{[\s\S]*?width: min\(1120px, calc\(100% - 24px\)\)/,
    'the desktop footer must read as a centered floating dock');
  assert.match(chrome, /\.statusbar \{[\s\S]*?bottom: 0;[\s\S]*?min-height: 34px;[\s\S]*?margin: 0 auto 0;[\s\S]*?padding: 1px 14px;/,
    'the desktop dock must be compact and touch the screen edge');
  assert.match(chrome, /\.statusbar \.sb-ai \{[\s\S]*?left: 50%;[\s\S]*?transform: translateX\(-50%\)/,
    'the desktop AI action must sit at the dock center');
  assert.match(chrome, /\.statusbar \.sb-ai-orb \{[\s\S]*?top: -9px;[\s\S]*?width: 36px;[\s\S]*?height: 36px;/,
    'the desktop AI emblem must stay compact');
  assert.match(chrome, /@media \(max-width: 780px\) \{[\s\S]*?\.bottomnav \{[\s\S]*?left: 50%;[\s\S]*?transform: translateX\(-50%\)/,
    'the mobile navigation must remain a centered floating dock');
  assert.match(chrome, /@media \(max-width: 780px\) \{[\s\S]*?\.bottomnav \{[\s\S]*?bottom: 0;[\s\S]*?min-height: 32px;[\s\S]*?padding: 1px 8px;/,
    'the mobile dock must be compact and touch the screen edge');
  assert.match(chrome, /\.bn-ai-ic \{[\s\S]*?top: -8px;[\s\S]*?width: 34px;[\s\S]*?height: 34px;[\s\S]*?border-radius: 50%/,
    'the mobile AI control must be circular and raised above the dock');
});

test('layout: the AI assistant is a dark glass island with four responsive quick actions', () => {
  assert.match(assistantCard, /className=\{`assistant\$\{embedded \? ' embedded' : ''\}`\}/,
    'the shared assistant surface must retain its common root');
  assert.match(assistantCard, /assistant-title"><span>AI<\/span> Assistant/,
    'the assistant identity must distinguish the blue AI label');
  for (const label of ['Explain', 'Give Hint', 'Solve Doubt', 'Next Topic']) {
    assert.match(assistantCard, new RegExp(`<b>${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/b>`),
      `the assistant must expose the ${label} action card`);
  }
  assert.match(assistantCard, /quickExplain\(state, sections, activeContext\)/, 'Explain must use the learner\'s current lesson');
  assert.match(assistantCard, /quickHint\(state, sections, activeContext, askedHints\)/, 'Give Hint must retain contextual hint logic');
  assert.match(assistantCard, /quickNext\(state, sections, activeContext/, 'Next Topic must use the measured, current-page context');
  assert.match(assistantCard, /loadKnowledgeIndex\(\)/, 'the published retrieval index must load only when needed');
  assert.match(assistantCard, /contextForIndex\(index\)/, 'retrieval must resolve the current route against loaded course metadata');
  assert.match(assistantCard, /ask\('I have a doubt about this topic\./, 'Solve Doubt must use the existing local ask flow');
  assert.match(assistantCard, /aria-label="Ask the AI assistant"/, 'the redesigned composer must retain its accessible label');
  assert.match(assistantCard, /placeholder=\{activeContext\.question \? 'Ask about this question…' : 'Ask BroCode AI anything…'\}/,
    'the assistant composer must use the requested placeholder outside question context');
  assert.match(css, /\.assistant \{[\s\S]*?linear-gradient\(145deg, rgba\(13, 29, 53, \.98\), rgba\(7, 15, 30, \.98\)\) padding-box/,
    'the assistant surface must keep its dark navy background independent of theme tokens');
  assert.match(css, /\.assistant\.embedded \{[\s\S]*?linear-gradient\(145deg, rgba\(13, 29, 53, \.98\), rgba\(7, 15, 30, \.98\)\) padding-box/,
    'embedded assistants must also remain dark in light mode');
  assert.match(css, /\.aidock \{[\s\S]*?color: #edf5ff; background-color: rgba\(7, 15, 30, \.97\)/,
    'the floating AI assistant shell must not turn light in light mode');
  assert.match(css, /\.assistant-actions \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/,
    'wide assistant surfaces must use four equal action columns');
  assert.match(css, /@media \(max-width: 700px\) \{\s*\.assistant-actions \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
    'tablet assistant surfaces must use two action columns');
  assert.match(css, /@media \(max-width: 430px\) \{[\s\S]*?\.assistant-actions \{ grid-template-columns: minmax\(0, 1fr\)/,
    'small mobile assistant surfaces must stack action cards');
  assert.match(css, /\.assistant-input:focus-within[\s\S]*?border-color: rgba\(66, 211, 255, \.76\)/,
    'the composer must surface its cyan focus state');
  assert.match(css, /@media \(max-width: 780px\) \{[\s\S]*?\.aidock \{[\s\S]*?bottom: calc\(32px \+ env\(safe-area-inset-bottom\)\);[\s\S]*?max-height: min\(52dvh, 430px\)/,
    'the mobile AI dock must fit the viewport and sit close above the bottom navigation');
  assert.match(css, /@media \(max-width: 780px\) \{[\s\S]*?\.aidock \.assistant-actions \{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)[\s\S]*?\.aidock \.assistant-action small, \.aidock \.assistant > p\.small \{ display: none; \}/,
    'the mobile AI dock must compact its action cards and supporting copy');
  assert.match(css, /\.aidock-head \{[\s\S]*?position: sticky; top: -12px; z-index: 5;[\s\S]*?background: linear-gradient/,
    'the AI dock header must remain visible over the scrollable panel');
  assert.match(css, /\.aidock-head \.icon-btn \{ flex: none; margin-left: auto; \}/,
    'the close button must stay at the right side of the dock header');
  assert.match(aiDock, /open && !window\.matchMedia\('\(max-width: 780px\)'\)\.matches/,
    'mobile dock opening must not auto-scroll its header and actions offscreen');
  assert.match(aiDock, /onClick=\{onClose\} aria-label="Close the AI panel"/,
    'the sticky X button must still close the AI dock');
});

test('layout: removed header progress shortcuts remain available at their destinations', () => {
  const app = read('src/app/App.tsx');
  assert.doesNotMatch(app.slice(app.indexOf('<header className={`topbar'), app.indexOf('</header>')), /hd-stat|smart-chip|topbar-account|Sign out/,
    'progress chips, the interview/next-step card and auth controls must be absent from the header');
  for (const [className, route] of [['profile-chip', '/progress']]) {
    assert.match(app, new RegExp(`<Link className="${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" to="${route.replace('/', '\\/')}"`),
      `${className} must navigate to ${route}`);
  }
  for (const route of ['/progress', '/review', '/mistakes']) {
    assert.match(app, new RegExp(`<Route path="${route.replace('/', '\\/')}" element=\\{`), `${route} must stay registered`);
  }

  const boundary = read('src/components/ui/ErrorBoundary.tsx');
  assert.match(boundary, /failed to fetch dynamically imported module\|importing a module script failed\|loading \(\?:css \)\?chunk \.\+ failed/i,
    'the retry action must recognize failed lazy route imports');
  assert.match(boundary, /window\.location\.reload\(\)/,
    'retrying a failed lazy import must reload instead of reusing the rejected lazy module');
});

test('layout: the footer shows truthful sync state and working learning actions', () => {
  const app = read('src/app/App.tsx');
  const auth = read('src/core/auth/AuthProvider.tsx');
  const dashboard = read('src/features/dashboard/Dashboard.tsx');
  assert.match(app, /<footer className="statusbar" aria-label="Learning progress and quick actions">/);
  assert.match(app, /!user\s*\?\s*'Local save'/, 'signed-out learners must not be told their progress was cloud-synced');
  assert.match(app, /progressSync\.lastSyncedAt[\s\S]{0,100}formatSyncAge/, 'the displayed sync age must come from an actual successful-sync timestamp');
  assert.match(auth, /lastSyncedAt\.current = Date\.now\(\);[\s\S]{0,140}status: 'synced'/,
    'the sync timestamp must be set only after the account API request succeeds');
  assert.match(auth, /authApi\.saveProgress\(summary\)/, 'the footer sync status must reflect the real progress-summary API');
  const start = app.indexOf('<footer className="statusbar"');
  const end = app.indexOf('</footer>', start);
  const footer = app.slice(start, end);
  assert.doesNotMatch(footer, /Search|Feedback|sb-network|tone-violet|tone-red|BroCode Ready/,
    'the removed actions and labels must not remain in the footer');
  assert.match(app, /className="sb-continue" to=\{smart\.route\}/, 'continue learning must open the live next-task destination');
  assert.match(dashboard, /studyStreak\(state\.study \?\? \{\}, study\.todayKey\)/, 'the dashboard streak must match the profile\'s measured study streak');
});

test('layout: an account is REQUIRED to learn — every private route is guarded, and the guard is one component', () => {
  const app = read('src/app/App.tsx');
  const guard = read('src/features/auth/RequireAuth.tsx');
  const login = read('src/features/auth/LoginPage.tsx');
  const landing = read('src/features/dashboard/Landing.tsx');
  const form = read('src/features/auth/AuthForm.tsx');

  // The guard exists and is the SINGLE place the decision is made.
  assert.match(guard, /export function RequireAuth/, 'the app must own one authorization boundary');
  assert.match(guard, /if \(loading\) return <RouteGateSkeleton \/>/,
    'a session still being restored must NOT redirect, or every refresh bounces a signed-in learner');
  assert.match(guard, /state=\{\{ from: `\$\{location\.pathname\}\$\{location\.search\}` \}\}/,
    'the requested destination must be preserved so the learner returns to it after signing in');
  assert.doesNotMatch(stripComments(guard), /\?next=|\?from=|searchParams\.set\('(from|next)'/,
    'the destination must travel in router state, never in a query string a caller could craft');

  // The public pages, and NOTHING else, sit outside `Protect`.
  const routes = app.slice(app.indexOf('<Routes>'), app.indexOf('</Routes>'));
  const publicRoutes = ['/', '/start', '/login', '/reset-password'];
  for (const path of publicRoutes) {
    assert.match(routes, new RegExp(`<Route path="${path.replace('/', '\\/')}" element=\\{<[A-Z]`),
      `${path} must stay reachable without a session`);
  }
  // Every remaining literal route must be wrapped. This is the assertion that makes a NEW page
  // memorable to guard: an unprotected one fails here instead of quietly shipping.
  const literals = [...routes.matchAll(/<Route path="(\/[^"]*)" element=\{<(\w+)/g)];
  assert.ok(literals.length > 0, 'the route table must be literal enough for this test to read');
  for (const [, path, component] of literals) {
    if (publicRoutes.includes(path)) continue;
    assert.equal(component, 'Protect', `${path} is not wrapped in Protect — it would be readable without a session`);
  }
  // The learning surfaces a visitor must not reach, spelled out so the intent is visible.
  for (const path of ['/courses', '/lesson/:sid/:stage', '/questions', '/practice', '/labs', '/progress', '/notes', '/pdf']) {
    assert.match(routes, new RegExp(`path="${path.replace(/[/:]/g, (c) => `\\${c}`)}" element=\\{<Protect>`),
      `${path} must require an account`);
  }

  // The Dashboard prints the learner's own numbers, so `/` may not hand it to a visitor.
  assert.match(app, /function PublicHome\(\)[\s\S]{0,260}return user \? <Dashboard \/>/,
    'the front door must choose the Landing page for a visitor and the Dashboard for a learner');

  // The old guest affordances are gone, and nothing offers a way in without a session.
  assert.doesNotMatch(app, /acct\.guest/, 'the rail must not name a guest');
  assert.doesNotMatch(app, /ACCOUNT_GREETING_KEY|greeted\.current/, 'the auto-open greeting is gone; /login is the prompt');
  assert.doesNotMatch(login, /Continue as guest/);
  assert.doesNotMatch(form, /Continue as guest/);
  // The public page may not offer a way INTO learning without an account. "Continue Learning" is
  // fine — it is the signed-in branch's label on the same page — so only the free-start phrasing is
  // rejected, together with the old direct route into onboarding. Comments are stripped because the
  // file EXPLAINS what it removed ("Start Learning Free" went straight to onboarding), and that
  // explanation must not read as a regression.
  const landingCode = stripComments(landing);
  assert.doesNotMatch(landingCode, /Start Learning Free|to=\{start\}/,
    'the public page must not promise learning without an account');
  assert.doesNotMatch(landingCode, /state\.profile\.onboarded/, 'the public page must not gate on local profile state');
  assert.match(landingCode, /An account is required/, 'the public page must say an account is required');
  assert.match(landingCode, /to="\/login"/, 'the public page must link to the account entry');

  // Password recovery is part of the flow, not an afterthought.
  assert.match(app, /path="\/reset-password"/, 'the recovery page must be routable');
  assert.match(form, /to="\/reset-password"/, 'the form must offer a way to recover a forgotten password');
});

test('layout: the sidebar account block is the way in, the way out, and the route to /admin', () => {
  const app = read('src/app/App.tsx');
  const styles = read('src/styles.css');
  const footerStart = app.indexOf('<div className="side-foot">');
  const footerEnd = app.indexOf('</div>\n        </aside>', footerStart);
  assert.ok(footerStart >= 0 && footerEnd > footerStart, 'the sidebar footer must exist');
  const footer = app.slice(footerStart, footerEnd);
  assert.match(footer, /side-account-copy[\s\S]*user\.name \|\| user\.email/, 'the rail must name the signed-in account');
  assert.match(footer, /onClick=\{\(\) => void signOut\(\)\}[\s\S]{0,170}t\('acct\.signOut'\)/, 'the block must offer sign-out');
  assert.match(footer, /user\.role === 'admin'[\s\S]{0,120}to="\/admin"/, 'an administrator gets a route to the owner dashboard');
  // Signed out: a state, not an identity. Two real doors, and the second one is a LINK to `/login`
  // because navigation to a fixed page is a link (see the dedicated test below).
  assert.match(footer, /t\('acct\.signedOut'\)/, 'a signed-out visitor must be described as signed out, not as a guest');
  assert.match(footer, /t\('acct\.signInHint'\)/, 'the block must say an account is needed');
  assert.match(footer, /to="\/login"[\s\S]{0,160}t\('acct\.signUp'\)/, 'the block must offer account creation');
  assert.doesNotMatch(footer, /acct\.guest/, 'no guest identity may remain in the rail');
  assert.match(app, /await logout\(\);[\s\S]{0,260}nav\('\/', \{ replace: true \}\)/, 'sign-out must end the session');
  // The cards this block replaced are gone from the markup AND from the stylesheet.
  assert.doesNotMatch(app, /side-xp|side-keep|keep-badge/, 'the replaced rail cards must not remain in the shell');
  assert.doesNotMatch(styles, /\.side-xp|\.side-keep/, 'the replaced rail cards must not leave a rule behind');
  const locales = read('src/app/i18n/locales.ts');
  const enBlock = locales.slice(locales.indexOf('export const en ='), locales.indexOf('export type LocaleKey'));
  const hiBlock = locales.slice(locales.indexOf('export const hinglish'));
  for (const key of ['acct.signedOut', 'acct.signInHint', 'acct.signIn', 'acct.signUp', 'acct.signOut']) {
    assert.ok(enBlock.includes(`'${key}':`), `${key} is missing from the English pack`);
    assert.ok(hiBlock.includes(`'${key}':`), `${key} is missing from the Hinglish pack`);
  }
  assert.ok(!enBlock.includes("'acct.guest':"), 'the guest identity must be gone from the English pack');
});

test('layout: the footer replaces the brand with a live local Last Seen and floating AI button', () => {
  const app = read('src/app/App.tsx');
  const start = app.indexOf('<footer className="statusbar"');
  const end = app.indexOf('</footer>', start);
  assert.ok(start >= 0 && end > start, 'the status footer must exist');
  const footer = app.slice(start, end);
  for (const removed of ['BroCode Ready', 'Search', 'Feedback', 'sb-network', 'tone-violet', 'tone-red']) {
    assert.equal(footer.includes(removed), false, `${removed} must not remain in the footer`);
  }
  assert.match(footer, /className="sb-last-seen"/, 'the footer must have a Last Seen item');
  assert.match(app, /localStorage\.setItem\(lastSeenKey, String\(now\)\)/, 'each site visit must persist the current timestamp');
  assert.match(app, /window\.addEventListener\('focus', recordVisit\)/, 'returning to the app must refresh Last Seen');
  assert.match(app, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/,
    'returning to a visible tab must refresh Last Seen');
  assert.match(footer, /className=\{`sb-ai\$\{aiOpen \? ' on' : ''\}`\}[\s\S]*?setAiOpen\(\(open\) => !open\)[\s\S]*?className="sb-ai-orb"/,
    'the prominent AI control must retain its assistant toggle action');
  assert.match(footer, /className=\{`sb-sync-block/, 'the actual local/account save status must remain');
  assert.match(footer, /className="sb-continue" to=\{smart\.route\}/, 'Continue Learning must retain its existing destination');
  assert.doesNotMatch(footer, /sb-settings|to="\/settings"/,
    'the footer must stay a progress+learning surface — Settings lives in the sidebar, not here');
  const statusGroupIndex = footer.indexOf('className="sb-status-group"');
  const actionsGroupIndex = footer.indexOf('className="sb-actions"');
  assert.ok(statusGroupIndex >= 0 && actionsGroupIndex > statusGroupIndex,
    'status must share a left group, with actions grouped on the right');
  assert.match(footer.slice(statusGroupIndex, actionsGroupIndex), /className=\{`sb-sync-block/,
    'the local/account save status must stay in the left group');
  assert.match(footer.slice(actionsGroupIndex), /className=\{`sb-ai[\s\S]*?className="sb-continue"/,
    'AI and Continue Learning must stay adjacent in the right group');
  assert.match(css, /\.sb-status-group \{[\s\S]*?flex: 1 1 auto;[\s\S]*?min-width: 0;/,
    'the left status group must shrink safely on narrow desktop widths');
  assert.match(css, /\.sb-actions \{ display: flex; flex: none;/,
    'the AI/Continue action group must remain together on the right');
  assert.match(css, /@media \(max-width: 1100px\) and \(min-width: 781px\)[\s\S]*?\.sb-last-seen b, \.sb-last-seen i \{ display: none; \}/,
    'the footer must compact supporting text before its essential controls overflow');
  assert.match(css, /\.sb-ai-orb \{[\s\S]*?top: -23px;[\s\S]*?border-radius: 50%;[\s\S]*?box-shadow:/,
    'the AI circle must overlap the border and glow');
});

test('layout: header and footer controls compact cleanly across desktop, tablet and mobile', () => {
  const app = read('src/app/App.tsx');
  assert.match(css, /@media \(max-width: 1180px\) and \(min-width: 781px\)[\s\S]*?\.topbar-nav-link:nth-child\(n \+ 3\) \{ display: none; \}/,
    'tablet header navigation must reduce density before the search and utility controls collide');
  assert.match(css, /@media \(max-width: 780px\)[\s\S]*?\.topbar-nav, \.topbar-right \.quickmenu,[\s\S]*?\.topbar \.searchbox \{[\s\S]*?width: 30px; min-width: 30px;/,
    'mobile header must retain compact search and priority utility controls');
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*?\.topbar-right \{ gap: 1px !important; \}[\s\S]*?width: 28px; min-width: 28px;/,
    'very narrow phones must shrink header controls without horizontal overflow');
  assert.match(css, /@media \(max-width: 780px\) \{[\s\S]*?\.statusbar \{ display: none; \}/,
    'phones must hide the desktop footer to avoid overflowing the viewport');
  assert.match(css, /\.bottomnav \{\s*display: none;[\s\S]*?@media \(max-width: 780px\) \{[\s\S]*?\.bottomnav \{ display: flex;/,
    'phones must use the fixed bottom navigation instead of the desktop footer');
  assert.match(css, /@media \(max-width: 780px\) \{[\s\S]*?\.topbar \{[\s\S]*?top: 0; justify-content: flex-start;[\s\S]*?\.topbar-right \{ gap: 4px !important; margin-left: auto; \}/,
    'the mobile header must stay at the top and keep search beside the menu');
  assert.match(css, /@media \(max-width: 780px\) \{[\s\S]*?min-height: 44px; padding: 3px 7px;[\s\S]*?\.topbar \.topbar-right > \.theme-toggle \{ width: 30px; height: 30px; \}/,
    'the mobile header frame and controls must be reduced in height');
  assert.match(css, /@media \(max-width: 780px\) \{[\s\S]*?\.bottomnav \{[\s\S]*?bottom: 0;[\s\S]*?min-height: 32px;[\s\S]*?\.bn-item, \.bn-ai \{ min-height: 24px;/,
    'the mobile footer must be compact and touch the screen edge');
  assert.match(css, /\.bn-icon \{ width: 26px; height: 22px;/,
    'the mobile footer icons must scale down with the compact dock');
  assert.match(app, /<NavLink to=\{n\.to\} end=\{n\.to === '\/'\} aria-label=\{n\.label\}/,
    'icon-only mobile destinations must retain accessible names');
  assert.match(css, /@media \(max-width: 1100px\) and \(min-width: 781px\)[\s\S]*?\.sb-status-group \{ gap: 5px; \}/,
    'tablet footer status must compact while keeping its right-side actions grouped');
});

test('layout: app chrome gets the animated multicolour rim, including mobile navigation', () => {
  const rim = css.match(/\.topbar::before,\n\.sidebar::after,\n\.statusbar::before,\n\.bottomnav::before \{[\s\S]*?\n\}/);
  assert.ok(rim, 'the rim must target the header, sidebar, desktop footer and mobile navigation');
  assert.match(rim[0], /conic-gradient\(/, 'the rim must carry moving multicolour light');
  assert.match(rim[0], /mask-composite:\s*exclude/, 'the light must be clipped to the border');
  assert.match(rim[0], /padding:\s*1px/, 'the glass rim stays subtle');
  assert.match(rim[0], /drop-shadow\(0 0 3px rgba\(34, 211, 238, \.75\)\)/, 'the rim must keep its soft glow');
  assert.match(rim[0], /rgba\(244, 114, 182, \.8\)/, 'the moving rim must carry the reference\'s full colour range');
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.topbar::before,\s*\.sidebar::after,\s*\.statusbar::before \{\s*animation: chrome-border-flow 8s linear infinite;/,
    'desktop chrome rim animation must only run when reduced motion is not requested');
  assert.match(css, /@media \(max-width: 780px\) and \(prefers-reduced-motion: no-preference\) \{\s*\.bottomnav::before \{ animation: chrome-border-flow 8s linear infinite; \}/,
    'the moving border must also animate on mobile when reduced motion is not requested');
  assert.match(css, /\.bn-item\.active \.bn-icon \{[\s\S]*?border-color: rgba\(34, 211, 238, \.40\);/,
    'the active mobile destination must have a clear, restrained highlight');
  assert.match(css, /\.bn-ai-ic \{[\s\S]*?border-radius: 9px;[\s\S]*?box-shadow:/,
    'the mobile AI action must have its own premium glass icon treatment');
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.topbar, \.topbar \*, \.topbar::before, \.bottomnav, \.bottomnav \*, \.bottomnav::before/,
    'mobile header and footer motion must be disabled for reduced-motion users');
  assert.match(css, /@keyframes chrome-border-flow \{ to \{ --chrome-glow-angle: 360deg; \} \}/,
    'the colour arc must travel around the border continuously');
});

test('layout: light mode keeps the RAIL dark — the sidebar is chrome, not a surface', () => {
  // The rail is the app's one piece of chrome with a palette of its own: a near-black glass panel,
  // a neon hue on every row's icon, a purple "Keep Going" card. In light mode it used to invert
  // with everything else, and all three readings died at once — the panel vanished into the page,
  // the per-row glow had no dark to glow against, and the card became a grey rectangle. Measured on
  // `/` in light mode before the fix: `.sidebar` painted `rgba(255, 255, 255, .82)` behind rows of
  // `#22d3ee` icons.
  //
  // The fix is the same trick as the console above — re-declare the dark token set ON the surface
  // rather than restyling each child — so the rim, the active row's accent wash, the fold button,
  // the level card and the rule above Tools all keep working by name. These assertions pin the
  // scope, the values that make the panel read as dark, and the two light-theme rules that had to go
  // with it (they were written for a white rail and are dead code now).
  const scope = css.match(/:root\[data-theme='light'\] \.sidebar \{[\s\S]*?\n\}/);
  assert.ok(scope, 'the light theme must scope the sidebar panel');
  // `--sidebar` is restated MORE opaque than the dark theme's `.72`: a black wash at `.72` over the
  // light page composites to ~#464a4d, a mid grey. The exact value is pinned because a later "let us
  // reuse the dark token" edit is exactly how it goes back to grey.
  assert.match(scope[0], /--sidebar: rgba\(4, 6, 12, \.90\);/, 'the panel must be a black glass, not a wash');
  assert.match(scope[0], /--sidebar-ring: rgba\(34, 211, 238, \.16\);/, 'the rail must keep its neon rim');
  assert.match(scope[0], /--card: #0a0d16;/, 'the level card must stay a dark surface');
  assert.match(scope[0], /--track: rgba\(255, 255, 255, \.08\);/, 'meters inside the rail stay dark-on-dark');
  assert.match(scope[0], /--text: #e8eefc;/, 'the rail must keep the dark theme ink');
  // Without this the wordmark is the PAGE's ink on a black panel — near-black on black, invisible.
  assert.match(scope[0], /color: var\(--text\);/, 'the panel must set its own ink, not inherit the page\'s');
  // The light theme's near-black scrollbar thumb is invisible inside a near-black panel.
  assert.match(scope[0], /--scroll: rgba\(140, 170, 255, \.22\);/, 'the rail keeps the blue-tinted thumb');
  // The global `.bar` counter-measure pins the track to `#0a0e18`, which on this panel is black on
  // black; the rail's own bars go back to the rail's own track.
  assert.match(css, /:root\[data-theme='light'\] \.sidebar \.bar \{ background: var\(--track\); \}/, 'the XP bar must use the panel track');

  // The four `--sidebar*` tokens must NOT be restated in the root light block any more: that is how
  // the rail went white, and a second light value there now only invites the scope to lose.
  const lightRoot = css.match(/:root\[data-theme='light'\] \{[\s\S]*?\n\}/);
  assert.ok(lightRoot, 'the light theme needs its token block');
  assert.doesNotMatch(lightRoot[0], /--sidebar[\w-]*:/, 'the root light block must not restate the rail tokens');

  // The per-row hues are neon and stay neon, because the panel under them stays dark. The light
  // theme's six deeper-hue overrides and its deeper wordmark gradient were written for a white rail
  // and are dead code now — left in, they would darken the icons the moment the scope landed.
  assert.equal(css.match(/data-theme='light'\] \.navlink\[data-tone/g), null, 'the rail tones must not be re-declared for light mode');
  assert.equal(css.match(/data-theme='light'\] \.brand b \.grad/g), null, 'the wordmark gradient must not be re-declared for light mode');
});

/* ------------------------- one H1 per page ------------------------------- */

/**
 * A page's H1 is the page's own title — the one line a search result, a screen reader's heading
 * list and a skim-reader all land on first. Two per rendered page dilutes all three, and the
 * failure mode is silent: a second h1 added to a loading branch or a summary card renders fine and
 * outranks the real title in every outline. This suite only ever sees one page at a time render,
 * so the rule is enforced structurally: a .tsx file holds AT MOST one h1, and files whose two h1s
 * are mutually exclusive branches (loading/error vs. main) must demote one to `.h1-look` — the
 * exact h1 look without the semantics.
 */
test('layout: every page owns exactly one H1', () => {
  // The class that makes a demoted heading look like the h1 it replaced must exist and match h1.
  assert.match(css, /\.h1-look \{[^}]*font-size: 1\.4rem;/, '.h1-look must carry the h1 look');
  for (const m of css.match(/\.h1-look \{([^}]*)\}/)[1].matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
    const expected = { margin: '0 0 .4rem', 'font-weight': '650', 'letter-spacing': '-.018em', 'font-size': '1.4rem' }[m[1]];
    assert.equal(m[2], expected, `.h1-look's ${m[1]} must stay identical to h1's`);
  }

  // Only five demotions are on record; a NEW second h1 in any file fails here with its location.
  // Deliberate asymmetry worth knowing: /exam owns its h1 on the SETUP screen only — the running,
  // grading and report screens are in-flow states of the same route and carry no h1 at all (the
  // report's big % is a stat, not a page title), so a fresh visit never renders two.
  const branchDemotions = [
    'src/features/practice/QuestionBank.tsx',
    'src/features/practice/ExamMode.tsx',
    'src/features/courses/StepPage.tsx',
    'src/features/courses/CoursePage.tsx',
  ];
  for (const f of branchDemotions) {
    assert.equal(h1s.filter((h) => h.file === f).length, 1, `${f} must hold exactly one <h1>`);
    assert.match(read(f), /h1-look/, `${f} demoted its branch title — the h1-look class is the visual match`);
  }

  // And every file stays at one h1 or fewer: a route renders exactly one file tree, so two h1s in
  // one file is two on the page (mutually-exclusive branches are the one exception, and each of
  // those is on record above).
  const byFile = new Map();
  for (const h of h1s) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1);
  for (const [file, count] of byFile) {
    assert.ok(count === 1 || branchDemotions.includes(file),
      `${file} holds ${count} <h1>s — demote the non-title one to <h2 className="h1-look">`);
  }
});

/* --------------------- the rest of the outline nests ---------------------- */

/**
 * The one-H1 contract above pins the TOP of the outline; this pins the rest of it. A page's first
 * section is an h2 and a heading never skips a level on the way down (h1 → h3, h2 → h4). The
 * failure mode is as silent as the second-h1 one: a card title written as an h3 renders exactly
 * the same when there is no h2 above it, and only the screen reader's outline and the search
 * engine's section tree lose the structure.
 *
 * Source order is a proxy for render order — these files are hand-written JSX, not generated — so
 * the scan walks every heading opening in a file and rejects two shapes:
 *
 *   · a file whose FIRST heading is an h3 or deeper (the page opens below its section level);
 *   · two adjacent headings that jump down by more than one level (h1 → h3, h2 → h4).
 *
 * Components that legitimately render INSIDE a section heading owned by another file are listed
 * below with their reason. A page-level file must never need an entry here.
 */
const nestedHeadingOwners = [
  'src/components/learning/StageQnA.tsx',       // the Q&A panel under a lesson stage's own h2
  'src/components/learning/TopicWorkspace.tsx', // the 16 parts under the workspace's own h2
  'src/components/code/NotebookCells.tsx',      // markdown, authored: '# '→h2, '## '→h3, '### '→h4
];

test('layout: the heading outline nests — the first section is an h2 and no level is skipped', () => {
  const offenders = [];
  for (const dir of ['src/features', 'src/components', 'src/app']) {
    for (const rel of fs.readdirSync(path.join(ROOT, dir), { recursive: true }).map((f) => `${dir}/${f}`.replace(/\\/g, '/')).filter((f) => /\.tsx$/.test(f))) {
      if (nestedHeadingOwners.includes(rel)) continue;
      const levels = [...read(rel).matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
      if (levels.length && levels[0] > 2) {
        offenders.push(`${rel}: opens at <h${levels[0]}> — a page's first section must be <h2>`);
      }
      for (let i = 1; i < levels.length; i++) {
        if (levels[i] > levels[i - 1] + 1) {
          offenders.push(`${rel}: <h${levels[i - 1]}> is directly followed by <h${levels[i]}> — h${levels[i - 1] + 1} is skipped`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `heading outline skipped a level:\n${offenders.join('\n')}`);

  // The allowlist is exhaustive: a NESTED-ONLY renderer may not grow an h1 (that would make it a
  // second page title), and a page-level file may not be quietly parked here instead of fixed.
  for (const f of nestedHeadingOwners) {
    assert.doesNotMatch(read(f), /<h1[\s>]/, `${f} renders inside a section — it must not own an h1`);
  }
});

test('layout: the heroless pages still own their route H1', () => {
  // Two routes deliberately render no banner: /playground is a full IDE and /notebooks makes its
  // card title the page title. Each still owns exactly one h1 for the outline — the h1 the
  // one-H1 test counts. (/path, the third, went with the Learning surface.)
  for (const f of ['src/features/labs/Playground.tsx']) {
    assert.match(read(f), /<h1 className="sr-only">/, `${f} must keep its visually hidden page title`);
  }
  assert.match(
    read('src/features/labs/NotebookLab.tsx'),
    /<h1 style=\{\{ margin: 0 \}\}><BookOpen size=\{18\} \/> Notebook Lab<\/h1>/,
    'the Notebook Lab card title IS the page title',
  );
});

/* ------------------------ the front door's own links --------------------- */

/**
 * The homepage's domain chips and pillar tiles are the first internal links the product has, and
 * they were wrong when they shipped: four of the ten pointed at `/track/python`, `/track/data`,
 * `/track/ml` and `/track/apis` — the TRACK_DEFS ids, while the generated pages live at
 * `python-core`, `numpy-pandas`, `ml-nlp` and `apis-production`. A hash URL like that does not
 * 404: the route matches, the page mounts, and the loader waits forever on a file that is not
 * there. The same class of failure covers `/course/<slug>`, so every target below is re-resolved
 * against the registry the app itself fetches.
 */
test('layout: every front-door link resolves to a page that actually loads', () => {
  const landing = read('src/features/dashboard/Landing.tsx');
  const app = read('src/app/App.tsx');
  const staticRoutes = new Set(
    [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]).filter((r) => r !== '*' && !r.includes(':')),
  );
  const courseSlugs = new Set(JSON.parse(read('public/generated/courses/index.json')).courses.map((c) => c.slug));
  const trackFiles = new Set(fs.readdirSync(path.join(ROOT, 'public', 'generated', 'tracks')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')));

  const block = (name) => {
    const at = landing.indexOf(`const ${name}:`);
    return landing.slice(at, landing.indexOf('];', at));
  };

  // Track targets are built through the shared map; the slug it produces must have a real file.
  const throughMap = [...block('DOMAINS').matchAll(/\{ name: '([^']+)', to: trackHref\('([a-z-]+)'\) \}/g)];
  assert.ok(throughMap.length >= 6, 'the domain chips link into the track pages');
  for (const [, name, id] of throughMap) {
    const slug = sf.TRACK_SLUG[id];
    assert.ok(slug, `"${name}" links through trackHref('${id}') but that is not a track id`);
    assert.ok(trackFiles.has(slug), `"${name}" points at /track/${slug}, which has no generated file`);
  }

  // Unexpanded targets must be a registered static route, a real track page, or a real course.
  const literals = ['DOMAINS', 'PILLARS'].flatMap((n) => [...block(n).matchAll(/to: '([^']+)'/g)].map((m) => m[1]));
  assert.ok(literals.length >= 5, 'the front door ships literal route targets too');
  for (const to of literals) {
    const track = to.match(/^\/track\/(.+)$/);
    const course = to.match(/^\/course\/(.+)$/);
    const ok = staticRoutes.has(to) || (track && trackFiles.has(track[1])) || (course && courseSlugs.has(course[1]));
    assert.ok(ok, `${to} is not a route, a generated track page or a course — the link would dead-end`);
  }

  // …and they are ANCHORS, not click handlers: a hash-routed SPA is only crawlable if its links
  // are real `<a href>`s, which is also what makes middle-click and "open in new tab" work.
  assert.match(landing, /DOMAINS\.map\(\(d\) => <Link key=\{d\.name\} to=\{d\.to\}/, 'domain chips must be links');
  assert.match(landing, /PILLARS\.map\(\(p\) => \(\s*<Link key=\{p\.to\} to=\{p\.to\}/, 'pillar tiles must be links');
});

test('layout: a track page links onward through the same slug map', () => {
  const track = read('src/features/learning/TrackOverview.tsx');
  // Related tracks are links in both directions, spelled by the shared builder...
  assert.match(track, /trackHref\(x\.def\.id\)/, 'back-links must go through trackHref');
  assert.match(track, /trackHref\(d\.id\)/, 'forward links must go through trackHref');
  assert.match(track, /<Link key=\{r\.id\} className="chip" to=\{r\.to\}>\{r\.label\}<\/Link>/, 'related tracks are real links');
  // …and their labels are translated. A raw `nameKey` here printed the literal string "track.ml".
  assert.match(track, /label: t\(x\.def\.nameKey as LocaleKey\)/, 'labels come from i18n');
  assert.doesNotMatch(track, /title: d!\.nameKey/, 'an i18n key must never be rendered as a label');
  // The in-track next step is a link too; the tree rows stay buttons (a row holds a nested link).
  assert.match(track, /<Link className="btn small primary" to=\{nba\.route\}>Start →<\/Link>/);
  // Legacy `/track/python`-style URLs redirect instead of loading forever.
  assert.match(track, /if \(legacySlug\) nav\(trackHref\(trackSlug!\), \{ replace: true \}\)/);
});

test('layout: navigation to a fixed page is a link, not a click handler', () => {
  // A `<button onClick={() => nav('/exam')}>` works, and is invisible to a crawler: it produces no
  // `<a href>`, no middle-click, no "copy link address". A static route can ALWAYS be a `<Link>`,
  // so any click-handler navigation with a literal route in it is an internal link that never got
  // written. (Parameterised jumps and view toggles — a reader page flip, a tab — are not this.)
  const offenders = [];
  for (const dir of ['src/features', 'src/components', 'src/app']) {
    for (const rel of fs.readdirSync(path.join(ROOT, dir), { recursive: true }).map((f) => `${dir}/${f}`.replace(/\\/g, '/')).filter((f) => /\.tsx$/.test(f))) {
      const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of src.matchAll(/onClick=\{\(\) => (?:nav|navigate)\('\/[a-z]/g)) offenders.push(`${rel}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `write these as <Link to=…> instead:\n${offenders.join('\n')}`);
});

/* ------------------------- old slugs keep resolving ---------------------- */

/**
 * The slug cleanup renamed seven destinations to descriptive kebab-case. An alias is not a page,
 * so the redirects live in a `LEGACY_ROUTES` table in App.tsx where the route readers in this
 * suite (and the sitemap generator) cannot mistake them for real routes — which means the alias
 * contract has to be pinned here: an alias that shadows a live route is dead code, and one that
 * points at a route nobody registered dead-ends on the fallback Dashboard.
 */
test('layout: every legacy slug alias points at a real route and shadows nothing', () => {
  const app = read('src/app/App.tsx');
  const registered = new Set(
    [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]).filter((r) => r !== '*' && !r.includes(':')),
  );
  const at = app.indexOf('const LEGACY_ROUTES');
  assert.ok(at > 0, 'the renamed slugs are kept as a LEGACY_ROUTES table');
  const block = app.slice(at, app.indexOf('];', at));
  const aliases = [...block.matchAll(/\['(\/[^']+)', '(\/[^']+)'\]/g)].map((m) => [m[1], m[2]]);

  assert.ok(aliases.length >= 7, 'the seven renamed slugs must keep their old URLs working');
  for (const [from, to] of aliases) {
    assert.ok(!registered.has(from), `${from} is both a legacy alias and a live route — one of them is dead`);
    assert.ok(registered.has(to), `legacy alias ${from} points at ${to}, which is not a registered <Route path>`);
  }

  // …and the router really renders them, or the table would be documentation instead of behaviour.
  assert.match(app, /\{LEGACY_ROUTES\.map\(\(\[from, to\]\) => \(/, 'LEGACY_ROUTES must be rendered by the router');
});

/* --------------------- the interview pillar's wiring --------------------- */

/**
 * The sidebar's single "Interview" tile is a HUB over four surfaces (/interview-mode,
 * /mock-interviews, /defense, /final-assessment) — and the pillar also owns its question banks,
 * which live on /questions and /playbook. The wiring fails silently in exactly one direction: a
 * surface keeps working while nothing links back to the hub that indexed it, and the learner who
 * landed on /mock-interviews from a search result has no
 * path to the other three. So both directions are pinned: the hub must index every surface, and
 * every surface must name the hub above its title.
 */
test('layout: the interview hub indexes its surfaces and every surface links back', () => {
  const hub = read('src/features/interview/InterviewsHub.tsx');
  const app = read('src/app/App.tsx');

  // The hub's card list is exactly the interview surfaces the router registers — no surface left
  // unindexed (unreachable from the pillar), no dead route in the list.
  const registered = new Set([...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));
  for (const r of ['/interview-mode', '/mock-interviews', '/defense', '/final-assessment']) {
    assert.ok(registered.has(r), `${r} must be a registered route`);
    assert.match(hub, new RegExp(`'${r}'`), `the interview hub must index ${r}`);
  }

  // The pillar owns its question banks too: the deep link carries the type filter it promises, and
  // the counts quoted on the cards come from the registries those pages load.
  assert.match(hub, /to="\/questions\?type=interview"/, 'the hub must link its interview question bank with the type filter');
  assert.match(hub, /useBankManifest\(\)/, 'the hub quotes the bank manifest, not an invented count');
  assert.match(hub, /ctx\.playbook\?\.items/, 'the archive card quotes the playbook registry');
  assert.match(hub, /to="\/playbook"/);

  // …and every interview surface carries the breadcrumb back to the hub.
  for (const f of [
    'src/features/interview/InterviewMode.tsx',
    'src/features/interview/MockInterviews.tsx',
    'src/features/interview/DefensePage.tsx',
    'src/features/interview/FinalAssessment.tsx',
  ]) {
    assert.match(read(f), /<HubCrumb hub="\/interviews" hubLabel="Interview"/, `${f} must link back to the interview hub`);
  }

  // The lesson's interview stage hands the learner the same questions in the bank, filtered —
  // the parameter it sends must be one the bank actually honours.
  const lesson = read('src/features/learning/Lesson.tsx');
  assert.match(lesson, /to=\{`\/questions\?section=\$\{sec\.id\}&type=interview`\}/,
    'the lesson interview stage must deep-link the bank');
  const bank = read('src/features/practice/QuestionBank.tsx');
  assert.match(bank, /params\.get\('type'\)/, 'the bank must honour a ?type= deep link');
  assert.match(bank, /QUESTION_TYPES as string\[\]\)\.includes/,
    'a garbage ?type= value must fall back to All, not filter the bank to zero rows');
});

/* ------------- the practice, labs and career pillars' wiring -------------- */

/**
 * The same contract the interview pillar is pinned to, for the other three: the sidebar tile is a
 * HUB over the pages it owns, and every one of those pages names the hub above its title. The crumb
 * is rendered by the shared `HubCrumb`, so "all four feel the same" is structural, not a promise.
 *
 * A surface wears exactly one crumb, and the pillar that OWNS it owns it: `/final-assessment` and `/defense`
 * are listed by two hubs but owned by interview — which is why cross-indexing is checked separately
 * from ownership. Only real figures are allowed on a hub: every count it prints comes from the
 * registry the page it links to loads.
 */
const PILLARS = [
  {
    hub: '/practice', label: 'Practice', file: 'src/features/practice/PracticeHub.tsx',
    owns: {
      '/questions': 'src/features/practice/QuestionBank.tsx',
      '/playbook': 'src/features/practice/Playbook.tsx',
      '/exam': 'src/features/practice/ExamMode.tsx',
      '/review': 'src/features/practice/Review.tsx',
      '/mistakes': 'src/features/practice/Mistakes.tsx',
    },
    // The pillar's content on a shared page: the bank indexed by question type, the deep link
    // carrying the filter `QuestionBank` honours, the count read from its manifest.
    index: [/\?type=\$\{ty\}/, /QUESTION_TYPES\.map/, /useBankManifest\(\)/, /TYPE_LABEL\[ty\]/],
  },
  {
    hub: '/labs', label: 'Labs', file: 'src/features/labs/LabsHub.tsx',
    owns: {
      '/playground': 'src/features/labs/Playground.tsx',
      '/notebooks': 'src/features/labs/NotebookLab.tsx',
      '/sql': 'src/features/labs/SQLLab.tsx',
      '/numpy-pandas': 'src/features/labs/NumPyPandasLab.tsx',
      '/ai-lab': 'src/features/labs/AILab.tsx',
      '/agentic': 'src/features/labs/AgenticLab.tsx',
      '/rag-lab': 'src/features/labs/RagLab.tsx',
    },
    // The notebooks it hosts, listed by name with the manifest's own cell count.
    index: [/\/notebooks\?nb=\$\{file\}/, /useNotebooks\(\)/, /nb\.codeCells/],
    // Its surface list is not a literal: the hub reads the lab family of the registry, so a new lab
    // page is indexed by being REGISTERED instead of by someone remembering to edit the hub. The
    // assertion below therefore reads the same registry, and keeps the contract that matters — the
    // pillar can reach every page it owns.
    derived: {
      from: /EXTRA_PATHS\.filter\(\(p\) => p\.group === 'lab'\)\.map\(\(p\) => p\.route\)/,
      routes: LAB_FAMILY,
    },
  },
  {
    hub: '/career', label: 'Career', file: 'src/features/career/CareerHub.tsx',
    owns: {
      '/job-prep': 'src/features/career/JobPrep.tsx',
      '/progress': 'src/features/progress/Progress.tsx',
    },
    // The career operating system: every figure comes from the pure engine (the file imports it),
    // and the surfaces it hands the learner off to are real pages. The portfolio work and the
    // answer bank that live outside the pillar are counted from the registries those pages read;
    // the labs and interview tiles come from the lab family and the bank manifest their pages load.
    index: [
      /from '\.\.\/\.\.\/core\/learning\/career'/,
      /checklistReadiness\(state\.jobPrep\)/,
      /nextCareerAction\(counts\)/,
      /careerRoadmap\(counts\)/,
      /jobReadiness\(counts\)/,
      /careerProgress\(counts\)/,
      /careerFlow\(counts\)/,
      /careerAchievements\(state, sections\)/,
      /TARGET_ROLES\.map/,
      /to=\{`\/practice\?subject=\$\{view\.weakest\.id\}`\}/,
      /to="\/projects"/, /ctx\.playbook\.miniProjects/, /ctx\.playbook\.methodAnswers/,
      /to="\/labs"/, /to="\/questions\?type=interview"/, /useBankManifest\(\)/,
    ],
  },
];

test('layout: the practice, labs and career hubs index their surfaces and every surface links back', () => {
  const app = read('src/app/App.tsx');
  const registered = new Set([...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));

  for (const pillar of PILLARS) {
    const hub = read(pillar.file);

    // Every route the hub lists is a real page — whether the hub spells its list out or reads it
    // from a registry (the labs hub does the latter; the test then reads that same registry).
    let listed;
    if (pillar.derived) {
      assert.match(hub, pillar.derived.from, `${pillar.file}: its surface list must come from the registry`);
      listed = pillar.derived.routes;
    } else {
      const list = hub.slice(hub.indexOf('const ROUTES'), hub.indexOf('];', hub.indexOf('const ROUTES')));
      listed = [...list.matchAll(/'(\/[^']+)'/g)].map((m) => m[1]);
      assert.ok(listed.length >= 2, `${pillar.file}: expected a ROUTES list`);
    }
    for (const route of listed) assert.ok(registered.has(route), `${pillar.file} links ${route}, which is not a registered route`);

    // …it indexes every page it owns…
    for (const [route, file] of Object.entries(pillar.owns)) {
      assert.ok(registered.has(route), `${route} must be a registered route`);
      assert.ok(listed.includes(route), `${pillar.file} must index ${route} — otherwise the pillar cannot reach it`);
      // …and that page names the hub above its title, through the one shared crumb.
      assert.match(
        read(file),
        new RegExp(`<HubCrumb hub="${pillar.hub}" hubLabel="${pillar.label}"`),
        `${file} must link back to ${pillar.hub}`,
      );
    }

    // The content index on the shared pages, with no invented figures.
    for (const re of pillar.index) assert.match(hub, re, `${pillar.file} is missing part of its content index (${re})`);
  }
});

/* --------- the four pillars' crumbs are one component, one shape ---------- */

test('layout: every pillar surface renders the same crumb, and the hubs it points at exist', () => {
  // The crumb is chrome with one job: get back up to the pillar. Four hand-written copies is how
  // the four pillars drift, so the shared component is pinned as the only source of it — a surface
  // that hand-rolls its own crumb fails here.
  const crumb = read('src/components/learning/SectionChrome.tsx');
  assert.match(crumb, /export function HubCrumb\(\{ hub, hubLabel, page \}/);
  assert.match(crumb, /<Link to=\{hub\}/, 'the crumb must link to the hub it names');
  assert.match(crumb, /aria-hidden|ArrowLeft/, 'the crumb carries a back arrow');

  const app = read('src/app/App.tsx');
  const registered = new Set([...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));
  for (const hub of ['/practice', '/labs', '/interviews', '/career']) {
    assert.ok(registered.has(hub), `${hub} must be a registered route — four crumb targets, four routes`);
  }

  // …and no surface anywhere hand-rolls the crumb row instead of calling the component.
  const handRolled = [];
  for (const dir of ['src/features']) {
    for (const rel of fs.readdirSync(path.join(ROOT, dir), { recursive: true }).map((f) => `${dir}/${f}`.replace(/\\/g, '/')).filter((f) => /\.tsx$/.test(f))) {
      if (rel.endsWith('SectionChrome.tsx')) continue;
      const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, '');
      if (/className="row small muted" style=\{\{ gap: 6, marginBottom: 6 \}\}/.test(src) && !/<HubCrumb/.test(src)) {
        handRolled.push(rel);
      }
    }
  }
  assert.deepEqual(handRolled, [], 'these files hand-roll the pillar crumb instead of using HubCrumb');
});

/* ------------------------- images carry a decision ------------------------ */

/**
 * Every `<img>` states what it is: a real description when the image carries meaning, `alt=""`
 * when something already names it. The failure this pins is the silent one — a missing attribute,
 * which a screen reader announces as the file name. The app's three identity images (the sidebar
 * tile, the header avatar, the Progress avatar) are each named by something ADJACENT to them —
 * visible text, or the button's own aria-label — so their `alt` depends on that neighbour staying
 * in place. Each of those conditions is asserted below: a layout change that hides the text (or
 * drops the label) fails here instead of quietly leaving the image unnamed.
 */
test('layout: every <img> carries an alt decision, and identity images name themselves', () => {
  const offenders = [];
  for (const dir of ['src/features', 'src/components', 'src/app']) {
    for (const rel of fs.readdirSync(path.join(ROOT, dir), { recursive: true }).map((f) => `${dir}/${f}`.replace(/\\/g, '/')).filter((f) => /\.tsx$/.test(f))) {
      // Comments are prose: CourseLogo's and SurfaceLogo's docblocks both spell `<img>` while
      // explaining why one exists or does not. Only the elements are scanned.
      const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const tag of src.match(/<img\b[\s\S]*?\/>/g) ?? []) {
        if (!/\balt=/.test(tag)) offenders.push(`${rel}: <img> without alt — ${tag.replace(/\s+/g, ' ').slice(0, 70)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `an image would be announced as its file name:\n${offenders.join('\n')}`);

  const app = read('src/app/App.tsx');
  // The sidebar tile is empty alt exactly while the wordmark text beside it is visible; a
  // collapsed rail hides that text (`display: none`), so the tile must carry the brand itself.
  assert.match(app, /alt=\{collapsed \? 'BroCode' : ''\}/, 'the brand tile must name itself when the wordmark is hidden');
  // The header photo names itself because the chip's name line is hidden below 1400px; without
  // the alt the button would be announced by its XP `title` alone.
  assert.match(app, /alt=\{`\$\{state\.profile\.name \|\| 'Learner'\} profile photo`\}/, 'the header avatar must name the person');
  // The one deliberate empty alt left is the Progress avatar: its button carries the aria-label,
  // so a description on the image would be the control's own name read twice.
  const progress = read('src/features/progress/Progress.tsx');
  assert.match(progress, /aria-label=\{state\.profile\.avatar \? 'Change profile photo' : 'Add a profile photo'\}/);
  assert.match(progress, /alt="" width=\{72\} height=\{72\}/, 'the Progress avatar keeps its empty alt for the labeled button');
});
