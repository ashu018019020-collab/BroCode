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
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const jn = read('src/components/code/JupyterNotebook.tsx');
const nb = read('src/components/code/NotebookCells.tsx');
const tw = read('src/components/learning/TopicWorkspace.tsx');
const css = read('src/styles.css');
const path_ = read('src/features/learning/LearningPath.tsx');

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
  // The label is the information, so it truncates instead of pushing the controls down.
  assert.match(css, /\.shelf-label \{[^}]*text-overflow: ellipsis;/, 'the label must truncate, not wrap');
  assert.match(jn, /<span className="shelf-label">Notebook Lab —/, 'the label must be its own truncating node');
  // The hint is decoration and yields to the label. It may only appear when the CARD is wide
  // enough to lend it ~95px — a container query, because the card width is not the viewport width
  // (the lesson column is ~502px at a 1440px window).
  assert.match(css, /\.jup-shelf-wrap \{[^}]*container-type: inline-size;/, 'the shelf must be a query container');
  assert.match(css, /@container \(min-width: \d+px\) \{ \.shelf-hint \{ display: inline; \} \}/, 'the hint needs a width gate');
  assert.match(css, /\.shelf-hint \{ display: none;/, 'the hint must start hidden');
  // …and it says something the collapsed line cannot otherwise show: that a notebook is open in a
  // body the learner has folded away.
  assert.match(jn, /\{!open && <span className="shelf-hint">\{openFile \? 'notebook open hai' : 'click karke kholo'\}/);
});

test('layout: the Learning Path keeps the shelf open, because there it is the page', () => {
  // The pin is that the shelf is MOUNTED OPEN there — not its exact attribute list, which grew a
  // `boxes` (draw the library as boxes) alongside `defaultOpen`.
  assert.match(path_, /<NotebookShelf defaultOpen\b/);
  assert.match(path_, /<NotebookShelf defaultOpen boxes \/>/);
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
  // of scrolling inside the block that already has `overflow-x: auto`. Measured: /ai 144px, /cheats
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
