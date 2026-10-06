# AGENTS.md — AI Engineer Master Lab

`README.md` covers install/run and `ARCHITECTURE.md` covers the layer model and
`core/platform/keys.ts` key ownership. This file is the operational knowledge those docs don't
carry: the commands that actually gate a change, environment quirks, and places where the code reads
one way and behaves another.

## The gate (there is no CI)

- `npm run typecheck` (`tsc --noEmit`, strict) + `npm test` (`node --test scripts/tests/*.test.{cjs,mjs}`,
  410 tests, ~6 s) + `npm run build` (vite, ~1 min). No `.github/`, no linter, no formatter — these
  commands are the only enforcement. Do not add eslint/prettier/.editorconfig.
- `typecheck` and `test` leave the working tree untouched (verified with `git status`); `build` writes
  the gitignored `dist/`. Iterate with one file: `node --test scripts/tests/accuracy.test.mjs`.
- `npm run build` always prints a >1500 kB chunk warning (Monaco) — pre-existing, not a failure.
- Undocumented but useful: `npm run doctor`, `npm run curriculum:validate`, `npm run questions:manifest`
  (manifest may not overstate coverage), `npm run questions:duplicates`, `npm run og` (renders the
  social card to a temp file and prints the path — needs a local Chrome/Edge),
  `npm run course:audit` (read-only: re-runs the courses generator in dry mode and then checks its
  output — unmapped items, unresolved refs, true duplicates, orphans, index gaps; exits 1 if anything
  is open). `npm run courses` is the write path and already refuses to write when an item is unsorted.
- **The index is the COURSE**: 1…36 across the 11 courses, numbered by `core/learning/courses.ts` +
  `roadmap.ts` and shown on each course page and step page (`StepPage` numbers itself against
  `STEPS.length`). No surface draws a numbered rail of its own any more: the 36-node strip that briefly
  sat on `/courses` is gone, and `scripts/tests/roadmap.test.mjs` fails if it comes back. The 24
  support surfaces (`EXTRA_PATHS` — Question Bank, the labs, career, reference)
  are **capabilities, not steps**, and are deliberately UNNUMBERED: their content is already filed
  under the chapter that teaches it (`scripts/courses.cjs` tags all 14,551 items with
  `{course, chapter, ref}` + `related_*` cross-refs), and the step page's seven tabs are where a
  learner meets them. The old `FIRST_EXTRA_NO = STEP_COUNT + 1` (which drew them as steps 37–60) is
  gone and `scripts/tests/roadmap.test.mjs` fails if it comes back — 60 index entries was a claim the
  data did not make.
- **Practice opens on a SUBJECT = a track.** `/practice`'s first choice is the eight tracks (`TRACK_DEFS`
  in `App.tsx`, whose `from`/`to` ranges are pinned against `generated/tracks/*.json` by
  `scripts/tests/practice.test.mjs`), and the drill-down is subject → chapter → `/questions?section=sNN&type=<ty>`,
  which is the SAME bank the section list, the stage tiles and the mistake tracker open — one page where
  answering happens, not a second copy of it. The arithmetic lives in the pure `core/learning/subjects.ts`
  (`chaptersOf`/`subjectCounts`/`startChapter`, driven with fixtures), the numbers come from
  `useBankManifest()`, and the same test holds that every published section resolves to exactly one subject —
  a section no range covers is content practice can never reach and nothing would throw.
- **Career is an operating system over the other pillars, not a fourth clone of them.** `/career`
  answers "what next, and am I job-ready?" through the pure `core/learning/career.ts`: the authored
  `CAREER_CHECKLIST` (the 16 job-prep items + their 4 phases — `JobPrep.tsx` renders it, nothing else
  holds a copy), `checklistReadiness`, the six roadmap tiles (Learn/Build/Prove/Resume/Profile/Apply),
  `jobReadiness`, `careerProgress`, `nextCareerAction` (the first failed gate in
  LEARN → BUILD → PROVE → PRESENT → PREPARE → APPLY → INTERVIEW → GET HIRED order, each reason quoting
  the real number), `trackMastery` + `TARGET_ROLES` (roles are authored choices, skills are measured
  track ids — an unknown id is dropped, so a new track extends the roles with no code change) and
  `portfolioTrio` (the ONE "which 3 projects go on the portfolio" rule — `ProjectLab.tsx` calls it
  too). Every number is a real record: manifests, stage gates, `resume:` answers, checklist ticks;
  where no denominator exists a line shows `pct: null` and facts only. `scripts/tests/career.test.mjs`
  drives it with fixtures and against the real registries; `layout.test.mjs`'s PILLARS career entry
  pins the cross-pillar links (courses/practice/labs/projects/interview/archive).
- **Defense projects and career badges have one owner each.** `core/assessment/defense.ts` holds
  `DEFENSE_PROJECTS` + `RESUME_ANSWER_TOTAL` (moved out of `DefensePage.tsx`, which now imports it) so
  the defense page and Career count the same record — `resume:<projId>:<i>` keys must keep their ids or
  stored answers orphan. Career badges are NOT a second list: they were added to
  `core/platform/achievements.ts` (`first-project`, `defended`, `resume-ready`, `checklist-half`) and
  Career renders the subset `careerAchievements()` returns, so the Dashboard's panel earns them too.
  The gate predicate is the curriculum's (`stagePassed`): the gate RECORD EXISTS — asking for `.done`
  silently drops a scored defense.
- **Interview kinds are VIEWS over the canonical bank types, not a second bank.** The pure
  `core/assessment/interview-room.ts` owns everything: `INTERVIEW_KINDS` maps concept=[interview,
  theory], coding=[coding] (the `miniProject` tag is excluded), debug=[debug], logic=[logic],
  project=[defense], challenge=[solved]; `checkpoint` is the declared ASSESSMENT exclusion — it is
  NOT an interview kind, so a checkpoint question can never surface in a round. The Interview Room
  (`InterviewMode.tsx`, URL-driven `?subject=&type=&size=&difficulty=`) loads ONE bank per step via
  `useBank` (never all 29), writes the SAME `qb:` record the Question Bank writes (`bankAttempt`),
  and `pickQuestion` walks the ladder unseen-weak → unseen → failed-weak → failed → review-due →
  passed with a per-sitting `avoid` set. `checkpoint` keys are skipped by `lastInterviewTouch`, and
  the engine spells no key-family literal — it imports `BANK_ATTEMPT_PREFIX` from `platform/keys`.
  The offline BRANDING came off the site (title, og card, landing chips, statusbar) at the user's
  request — `engines.test.mjs` still pins the assistant's offline NATURE in code comments, and the
  service-worker/offline test files are engineering facts, not copy.
- Commit messages: single-line, imperative, sentence case, no type prefix.

## Where things live (`content/` → scripts → `public/generated/`)

- **`content/**` is the only authored source.** `public/generated/**` (`ai/`, `curriculum/`, `questions/`,
  `playbook/`, `search/`, `tracks/`) is generator output: `public/generated/search/index.json` and
  `public/generated/ai/knowledge.json.gz` are both asserted byte-for-byte against their generators, and
  `public/**` is never hand-edited. The dry run is the
  default; `--write` publishes (`npm run notebooks:write`, `curriculum:guides:write`, `packs:write`,
  `questions:pdf:write`, `ai:index:write`, `sitemap:write`, …). `public/sitemap.xml` and `public/robots.txt` are the
  root-level generated files under `public/`: the sitemap comes from `App.tsx`'s route table plus the
  section/course registries, and robots.txt names it with the same base — so a new route needs
  `npm run sitemap:write` (the suite fails until it is regenerated). `public/brocode-og.png` is the
  third root-level artifact: the 1200×630 social card `scripts/og.cjs` renders with a local
  Chrome/Edge (a build-time tool, never a runtime or test dependency), so `npm run og:write` is the
  only way to change it and the suite pins its contract — a PNG of exactly the declared size, plus
  the open-graph and twitter tags in `index.html` — rather than its bytes.
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
- HashRouter: routes are `/#/playground`, `/#/courses`. A hash-only navigation does **not** reload the
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

- Route knowledge is duplicated **five** ways and only a test holds it together: 44 `<Route path>` in
  `src/app/App.tsx`, 30 `NAV`, 32 `PAGES` (`core/platform/search.ts`), 24 `EXTRA_PATHS`
  (`core/learning/paths.ts`), 19 `PATH_ROUTE_ALLOWLIST` (24 + 19 = the 43 routes).
  `scripts/tests/playbook.test.mjs` regex-reads `App.tsx` as **text**, so a new route must be
  registered or deliberately allowlisted or the suite fails. `NAV` is also the label/icon source for
  the support-path cards and the hub grids, so a route can be kept registered with
  `sidebar: false, group: 'hidden'` when it should have a card but no sidebar link (the Playground).
  Old slugs are deliberately **not** `<Route path>` elements: the seven renamed in the slug cleanup
  live in `LEGACY_ROUTES` (an array in `App.tsx`) so none of the five readers above — nor the
  sitemap generator — can mistake a redirect for a page. `scripts/tests/layout.test.mjs` holds the
  alias contract instead (no alias shadows a live route, every target exists), so a rename needs no
  allowlist entry but the table must never be converted back into literal routes.
- Per-route `<title>`/description is **not** a sixth copy of route knowledge: `core/platform/meta.ts`
  resolves a pathname against `PAGES` + `STAGE_META` (both pure pieces the tests already load) and
  returns `null` for a route with no authored copy — meaning "the shell already says it", which is
  the home page, `/login`, `/onboarding` and the legacy aliases. `Shell` in `App.tsx` holds only the
  effect that applies it, reading `index.html`'s own title/description once through a `useRef`
  before it overrides anything, so the pinned home-page copy is never restated in code.
  `scripts/tests/meta.test.mjs` holds the brand in a route title to the brand in the shell's
  `<title>`. Probing caveat: route chunks are lazy and commit late, so a title read ~250 ms after a
  hash change is still the PREVIOUS route's — wait ≥600 ms or you will debug a bug that isn't there.
- A track's `TRACK_DEFS.id` is **not** its page slug. Six of the eight differ (`python` →
  `python-core`, `data` → `numpy-pandas`, `ml` → `ml-nlp`, `apis` → `apis-production`, plus `agentic`
  and `interview`), and `/track/python` is the nastiest failure the app has: the route matches, the
  page mounts, the loader fetches `generated/tracks/python.json`, which was never generated — so it
  sits on "Track load ho raha hai…" forever. Build every track link with `trackHref`
  (`src/core/learning/surfaces.ts`), take slugs from `public/generated/tracks/index.json` in scripts,
  and let `layout.test.mjs` / `surfaces.test.mjs` / `sitemap.test.mjs` (file-existence check) hold it.
- The sidebar is 8 pillars + 4 tools; the pillar hubs (`/practice`, `/labs`, `/interviews`, `/career`)
  are *indexes over existing pages*, never merges — the underlying routes, engines and stored keys are
  unchanged, and `HubGrid` reads the same `EXTRA_PATHS` records `PathGrid` does.
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
- Google Search Console ownership is verified by a `<meta name="google-site-verification">` tag in
  `index.html` (the only method that works on a `github.io` origin — there is no DNS record to add,
  and an uploaded file would mean hand-authoring inside `public/`). Paste the token beside the
  canonical; `scripts/tests/sitemap.test.mjs` pins the tag's shape. Two crawl facts to remember when
  a property is created: the canonical origin has to be LIVE first (everything in `sitemap.xml`,
  `canonical` and the og/twitter image URLs points at it), and `robots.txt` is only authoritative at
  the HOST root, so the sitemap must be submitted by URL rather than discovered through robots.
- **`public/**` is either generated or a bundled runtime — never hand-edited.** Content changes go
  through `content/**` and the pipeline (`scripts/*.cjs`); `public/generated/search/index.json` and
  `public/generated/ai/knowledge.json.gz` is asserted byte-for-byte against its generator, so
  artifact and code ship together. The AI index is loaded only when the assistant is first asked and
  contains published learning material, not learner records. The source PDF is
  not committed (it would ship in `dist/`); re-runs need its path.
- The app must keep working with zero network — Pyodide, notebooks, SQL engine and the PDF are bundled.
  Do not add runtime dependencies or build config. Marketing never overrides this: no analytics, no
  third-party pixels, no runtime change for a campaign. `BACKLINK-STRATEGY.md` holds the outward-facing
  plan (measured status, targets, templates) and the rule that every number in a pitch comes from a
  registry — `index.html`'s own claims are pinned by `scripts/tests/sitemap.test.mjs`, so anything that
  oversells contradicts the tested shell.
