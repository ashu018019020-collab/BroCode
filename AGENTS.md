# AGENTS.md — AI Engineer Master Lab

`README.md` covers install/run and `ARCHITECTURE.md` covers the layer model and
`core/platform/keys.ts` key ownership. This file is the operational knowledge those docs don't
carry: the commands that actually gate a change, environment quirks, and places where the code reads
one way and behaves another.

## The gate (there is no CI)

- `npm run typecheck` (`tsc --noEmit`, strict) + `npm test` (`node --test scripts/tests/*.test.{cjs,mjs}`,
  281 tests, ~4 s) + `npm run build` (vite, ~1 min). No `.github/`, no linter, no formatter — these
  commands are the only enforcement. Do not add eslint/prettier/.editorconfig.
- `typecheck` and `test` leave the working tree untouched (verified with `git status`); `build` writes
  the gitignored `dist/`. Iterate with one file: `node --test scripts/tests/accuracy.test.mjs`.
- `npm run build` always prints a >1500 kB chunk warning (Monaco) — pre-existing, not a failure.
- Undocumented but useful: `npm run doctor`, `npm run curriculum:validate`, `npm run questions:manifest`
  (manifest may not overstate coverage), `npm run questions:duplicates`.
- Commit messages: single-line, imperative, sentence case, no type prefix.

## Where things live (`content/` → scripts → `public/generated/`)

- **`content/**` is the only authored source.** `public/generated/**` (`curriculum/`, `questions/`,
  `playbook/`, `search/`, `tracks/`) is generator output: `public/generated/search/index.json` is asserted
  byte-for-byte against its generator, and `public/**` is never hand-edited. The dry run is the
  default; `--write` publishes (`npm run notebooks:write`, `curriculum:guides:write`, `packs:write`,
  `questions:pdf:write`, …).
- Three different things are called "content", so keep them straight: `content/` is the authored
  source, `public/generated/` is what the build publishes from it, and `src/core/data/` is only the
  TypeScript that fetches the published files. Never move data into `src/`, never hand-edit
  `public/generated/`.
- `src/core/*` is the logic (`learning`, `assessment`, `ai`, `platform` are pure; `storage` owns
  `AppState` and localStorage; `data` is the React **data-access** layer — loaders only, and there is
  no JSON under `src/` at all), `src/features/*` are the screens, `src/app/App.tsx` is the shell. A
  write tool that forgets the `generated/` prefix leaves the app offline-broken: `public/sw.js` caches
  `/generated/` and `/notebooks` only.

## Test-loader ceiling (why some modules can't be tested)

- `scripts/tests/_ts-resolve.mjs` appends `.ts` **only**, and only for relative specifiers, so **no
  `.tsx` file can be imported by a test**: `import('../src/components/PathGrid')` fails with
  `ERR_MODULE_NOT_FOUND …/PathGrid.ts`.
- Therefore `src/core/data/playbook.ts` and `src/core/data/paths.ts` are permanently unreachable
  from tests (they import `./curriculum` → `curriculum.tsx`, plus React and the store). A rule that
  needs a test must live in `src/core/{learning,assessment,ai,platform}/*` with no value imports of
  React/store/page modules.
- Consequence in practice: coverage ("was it done", right or wrong) is owned by
  `src/core/learning/coverage.ts` — the predicate *and* both counts. `src/core/data/paths.ts` and
  `src/core/data/playbook.ts` are adapters that call it; re-implementing the rule or the counting
  in a content module is how one policy came to have three copies, none of them reachable by a test.
- `scripts/tests/engines.test.mjs` enforces the purity: `ENGINE_DIRS =
  ['src/core/learning','src/core/assessment','src/core/ai','src/core/platform']` may not import React
  or the store. `src/core/storage` and `src/core/data` are deliberately outside that list.
- `esbuild@0.21.5` is already installed transitively via vite, and
  `esbuild.transformSync(tsx, { loader: 'tsx', jsx: 'automatic' })` works. An esbuild-backed resolver
  hook is the zero-new-dependency route to rendering components under `node --test` if that ceiling is
  ever lifted.

## Serving the app locally

- `npm run dev` binds **IPv6 loopback only**: `http://localhost:5173` → 200, `http://127.0.0.1:5173`
  → connection refused.
- HashRouter: routes are `/#/playground`, `/#/path`. A hash-only navigation does **not** reload the
  document, and `store.ts` reads `localStorage` once at module init — so seed state, then force a full
  reload, before asserting.
- Monaco silently drops keys unless it holds real focus: focus `.monaco-editor .native-edit-context`
  (`tabindex=0`) or click the editor — the `ime-text-area` textarea is `readOnly` and accepts nothing.
  Focus is lost after every Run, so refocus before typing. Synthetic `insertText` is ignored.
- A wrong hash renders the Dashboard, not an error: `<Route path="*">` falls back to `Dashboard`, so a
  typo like `#/sqllab` shows a real page (SQL Lab is `#/sql`) and looks like a successful navigation.
- A first-run visit with no stored profile lands on `#/start` (the landing page), not `#/onboarding`.
- Long in-page scripted steps hit a ~10 s cap — split them. Verify persisted `localStorage` or produced
  output, not markup.
- Windows Git Bash prints CRLF warnings on every `git diff`/`status` — noise.
- `.freebuff/` is gitignored scratch (dev logs, run notes, one-off scripts).

## Hidden couplings (files that must change together)

- Route knowledge is duplicated **five** ways and only a test holds it together: 40 `<Route path>` in
  `src/app/App.tsx`, 31 `NAV`, 32 `PAGES` (`core/platform/search.ts`), 25 `EXTRA_PATHS`
  (`core/learning/paths.ts`), 15 `PATH_ROUTE_ALLOWLIST` (25 + 15 = the 40 routes).
  `scripts/tests/playbook.test.mjs` regex-reads `App.tsx` as **text**, so a new route must be
  registered or deliberately allowlisted or the suite fails. `NAV` is also the label/icon source for
  the Learning Path's cards and the hub grids, so a route can be kept registered with
  `sidebar: false, group: 'hidden'` when it should have a card but no sidebar link (the Playground).
- The sidebar is 8 pillars + 4 tools; the pillar hubs (`/practice`, `/labs`, `/interviews`, `/career`)
  are *indexes over existing pages*, never merges — the underlying routes, engines and stored keys are
  unchanged, and `HubGrid` reads the same `EXTRA_PATHS` records the Learning Path does.
- 8 files import `NAV`/`TRACK_DEFS` **from `../app/App`** (`components/learning/PathGrid`,
  `components/shared/HubGrid`, `features/dashboard/{Dashboard,Landing}`,
  `features/learning/{LearningPath,Lesson,TrackOverview}`, `features/tools/CheatSheets`) — `App.tsx`
  doubles as a shared label/icon module; moving those exports touches all eight. (`src/app/main.tsx`
  imports `App.tsx` too, but for the component, so it is not an importer of the exports.)
- The written-answer block is duplicated verbatim in two places — the Question Bank row and the in-lesson
  stage panel (`StageQnA`) — including the live rubric line under the textarea and the reveal gate. A
  change to one must be made in both, or the two screens drift silently (no test can load either: see
  the loader ceiling above).
- Two modules are named `playbook.ts` and they are NOT duplicates: `core/data/playbook.ts` is the
  fetch/type loader (`loadPlaybookIndex`, `loadPlaybookItems`, `playbookPractised` callers), while
  `core/assessment/playbook.ts` is the pure item contract + `nextPlaybookTarget`. Merging them would
  push a React/store-adjacent loader into the purity sweep.
- Two answer questions, two predicates in `core/learning/coverage.ts`: `isPractised` (graded either way)
  drives every count, while `isCleared` (graded correct, or written) is what `nextPlaybookTarget`
  skips. Feeding the coverage predicate to the ladder made a FAILED section stop being recommended.
- `pathStat` clamps `done` to `total`, so a numerator that outgrows its denominator prints `N/N`, never
  `101%`.
- `MonacoIDE.tsx` has exactly two callers (`Playground`, `SQLLab`), both passing identity setters. If an
  `onChange` ever normalizes (trim/format/round-trip through the store), `value !== ed.getValue()` turns
  true per keystroke → the value-sync effect calls `setValue` → that fires `onDidChangeModelContent` →
  cursor snaps to the end and the render loops. Its `errors` effect depends on `value`, so it now
  re-applies markers every keystroke.

## Semantics that read one way and behave another

- `done` does **not** mean the same thing in every family: bank/interview write it as a VERDICT, notebook
  cells write `done: true` for *every* run (a raise still counts). `tally(…, verdictByScore)` exists for
  this — reading notebook `done` as "correct" reported 100% for a notebook of failing cells.
- `attemptPct` order is `score` → `done` → `null`: a stored measured `score` wins over `done`, so a
  rubric-scored answer's percentage is not its verdict.
- `done: false` is only ever an explicit self-grade "galat" (`done: correct` in QuestionBank/StageQnA,
  `done: e.correct` in `applyExamWrites`, `done: ok` in `Lesson`) — never a "viewed/revealed" placeholder,
  so counting it as coverage cannot be inflated by merely opening a question.
- `addXp(n, type?, label?)` silently ignores `type`/`label` while ~21 call sites pass real provenance;
  `noUnusedParameters: false` keeps the typecheck quiet about it.

## Store and offline behaviour

- `setState` serializes the **whole** state and writes localStorage synchronously on every call (40 call
  sites, no batching; `ErrorBoundary`'s two `this.setState` are React's). Measured at full bank use:
  13,865 attempts → 1.18 MB, ~17 ms of `JSON.stringify` per write. That is why `useSavedAnswer` debounces
  400 ms with a flush on key change/unmount — do not add a per-keystroke store write.
- `stateSnapshot()` exists so async flows (running a notebook cell by cell) read the really-stored state
  instead of their render's snapshot.
- `public/sw.js` precaches **nothing** at install (cache-on-demand); bumping `CACHE` (`aiml-v6`) is the
  only purge mechanism. Its fetch handler caches any successful `/pyodide`, `/pdf`, `/generated/` or
  `/notebooks` response — so a full offline bundle can be warmed with plain `fetch()`es, no SW change needed.
- **`public/**` is either generated or a bundled runtime — never hand-edited.** Content changes go
  through `content/**` and the pipeline (`scripts/*.cjs`); `public/generated/search/index.json` is
  asserted byte-for-byte against its generator, so artifact and code ship together. The source PDF is
  not committed (it would ship in `dist/`); re-runs need its path.
- The app must keep working with zero network — Pyodide, notebooks, SQL engine and the PDF are bundled.
  Do not add runtime dependencies or build config.
