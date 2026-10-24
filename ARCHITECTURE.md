# Architecture — AI Engineer Master Lab

Learning flow: **authored content (`content/`) → generator scripts → build artifacts
(`public/generated/`) → core logic (`src/core/*`, pure) → store (`src/core/storage/store.ts`, single
owner) → features (`src/features/*`, render only)**. Optional account access is separate:
**browser auth client (`src/core/auth/`) → Node API (`server/`) → Supabase Auth sessions and
Postgres profiles/roles through Prisma (`prisma/`)**.

Companion documents, each verified against the source rather than aspirational:

| Document | Covers |
|---|---|
| `docs/ARCHITECTURE-AUDIT.md` | What was inspected, the confirmed defects and their evidence, and the design choices investigated and deliberately left alone. |
| `docs/CONTENT-PIPELINE.md` | The real generator dependency graph, the five-step `sections.json` accumulation, published-artifact contracts, cross-reference validation. |
| `docs/SECURITY.md` | The verified security model: the `VITE_` boundary, server-side authorization, request hardening, RLS and migration safety. No secret values. |
| `docs/LOCALIZATION-GUIDE.md` | The bilingual model, where language is applied, authoring rules, and **measured** coverage. |

## The golden rule: `content/` is source, `public/generated/` is output

| Direction | Path | Rule |
|---|---|---|
| Source | `content/**` — curriculum sections/guides/packs/topics, question banks, playbook source, notebooks (`.ipynb`) | Hand-editable. The only place content is *authored*. `content/` is not served and never ships in `dist/`. |
| Generators | `scripts/*.cjs`, `scripts/lib/*.cjs`, `tools/extract.mjs` | Dry-run by default, `--write` publishes. Each one validates before writing and executes the snippets it stores. |
| Output | `public/generated/**` — `curriculum/`, `questions/`, `playbook/`, `search/`, `tracks/` | **Generated. Edit the pipeline, never the artifact.** `public/generated/search/index.json` is asserted byte-for-byte against its generator, so artifact and code ship together. |
| Bundled runtimes | `public/pyodide/`, `public/sqljs/`, `public/pdf/`, `public/notebooks/`, `public/data/` | Third-party runtimes, the source PDF, published notebooks. Inputs the app consumes offline — not generated from `content/`. |

The `generated/` prefix is not cosmetic: `public/sw.js`'s fetch rule treats `/generated/` and
`/notebooks` as the offline content surface, so a runtime file at a new top-level path is *not*
cached by that rule and must be added deliberately.

## Layers

| Layer | Location | Rule |
|---|---|---|
| Data access | `src/core/data/` — `curriculum.tsx` (the React context + JSON load), `questions`, `playbook` (loader), `tracks`, `paths` (the only place that knows stored-key shapes for cards), `notebooks`, `datasets`, `packages`, `schema`, `searchindex`, `knowledge` (lazy AI index loader) | **Loaders/adapters only** — there is no JSON under `src/`; the authored source is `content/` and this layer fetches the published `./generated/…` and exposes it typed. No maths, no gates. `curriculum.tsx` is the one `.tsx` here — a provider, not a page. |
| Core — learning | `src/core/learning/` — `progress` (mastery gates, section %), `roadmap` (the learning spine), `review` (spaced repetition), `advance` (stage unlock), `paths` (the support-path card registry + `PATH_ROUTE_ALLOWLIST` + `pathStat`), `coverage` (the family predicates **and** every family tally), `study` (the study-day timeline, the year heat grid + its month labels, `today()`) | Pure functions over `AppState` + curriculum. `paths.ts` is here, not in `assessment/`: its subject is the learning journey (which card, at what step), while `assessment/` is only about grading — rubrics, exam papers, accuracy. |
| Core — assessment | `src/core/assessment/` — `evaluate` (keyword rubrics, output checks, defense scoring), `exam` (focus types, paper sizes), `interview`, `accuracy` (what was done / how right it was), `playbook` (the pure item contract + `nextPlaybookTarget`) | Pure, and **grading-only**. `learning/paths.ts` and `assessment/exam.ts` are loaded by explicit path by two test files that do not register the `.ts` hook, so those two stay value-import-free (see below). Two modules are named `playbook.ts` on purpose and must not be merged: this one holds the rule, `core/data/playbook.ts` holds the loader. |
| Core — AI | `src/core/ai/` — `assistant`, `context` (current route/course/lesson/progress), `knowledge` (typed inverted-index retrieval), `tutor` (hints, `nextTask`), `rag`, `project` (strict app facts), `mission` (daily queue), `coach` (mistake classification, the redo pile) | Deterministic and offline. No model calls: the assistant retrieves only relevant local passages and answers with source links. `npm run ai:index` reports; `npm run ai:index:write` regenerates compressed `public/generated/ai/knowledge.json.gz` from published sources. |
| Core — platform | `src/core/platform/` — `keys` (**persisted-key shapes + gamification policy**), `search` + `searchindex` (the Ctrl+K index), `notify`, `achievements`, `anim` (count-up maths), `ipynb`, `traceback` | Pure utilities. `keys.ts` is the only owner of stored shapes. |
| Storage | `src/core/storage/` — `store.ts` (**single owner** of `AppState`), `account.ts` (the per-account localStorage namespace), `ui.ts` (theme/panel prefs), `exam.ts`, `study.ts` | Exposes `useStore()`, `setState()` and the mutation helpers (`addXp`, `recordAttempt`, `addMistake`, `bumpStreak`, `exportProgress`, `importProgress`). Private state is keyed per signed-in account; on sign-in/out the store re-reads the matching namespace. |
| Runners | `src/features/coding/` — `runners` (main thread), `pythonWorker` (Pyodide in a Web Worker) | Execution only; no app state. The worker seeds the bundled datasets into the Pyodide FS at boot, so `pd.read_csv('<dataset>.csv')` works in every Python surface. |
| Features (pages) | `src/features/<pillar>/` — `dashboard`, `learning`, `practice`, `labs`, `projects`, `interview`, `career`, `progress`, `tools` | Rendering + intent; all state mutations go through store helpers. No key shapes, no level maths, no gate logic inline. |
| Components | `src/components/{ui,code,learning,shared}/` | Presentational building blocks. `learning/PathGrid` and `shared/HubGrid` render card grids; `code/MonacoIDE` and `code/JupyterNotebook` own the editor surfaces. |
| App shell | `src/app/` — `App.tsx` (routes, sidebar, `NAV`), `main.tsx`, `i18n/{index.tsx,locales.ts}` | `App.tsx` doubles as the shared **label/icon module**: 8 files import `NAV`/`TRACK_DEFS` *from* `../app/App`. |
| Types | `src/types/` — `index.ts` (`AppState` and friends), `sql.d.ts` | Shared shapes; storage and features both import from here. |
| Optional account service | `src/core/auth/` (browser Supabase client + session provider), `server/` (Node API, Supabase adapter, Prisma store, first-admin bootstrap), `prisma/` (schema and migration) | Supabase Auth owns credentials and sessions (email, GitHub, Google; PKCE). Postgres stores profiles, roles and summary-only progress snapshots behind RLS; the server checks the database-backed role on every admin request. Private learning data stays in per-account browser storage and remains available to guests offline. |

The account service is an intentional online exception to the offline-first learning app. Only the
Supabase publishable key may reach the browser; the secret key is server-only. Production must
terminate HTTPS and proxy `/api` to the Node service; local setup, schema, and bootstrap
instructions live in `server/README.md`.

## The pillar model (why there are two kinds of sidebar entry)

The sidebar is the learning journey, not a file tree: **8 pillars** (Dashboard, Learning, Practice,
Labs, Projects, Interview, Career, Progress), then a labelled **Tools** group (Notes, Cheat Sheets,
PDF Reader, Settings). The five pillar hubs — `/practice`, `/labs`, `/interviews`, `/career` and the
`/start` landing — are *indexes*, not merges: every underlying page still exists, still owns its
route, and still reads the same engine data. `NAV` carries a `group`
(`'nav.pillars' | 'nav.tools' | 'hidden'`) and 19 registered-but-hidden entries, because a page's
label and icon for the support-path cards, the hub grids and the command palette all come from
`NAV` — deleting an entry prints a raw URL on a card.

## Route knowledge is duplicated on purpose — and one test holds it together

| Registry | File | Count |
|---|---|---|
| `<Route path>` table | `src/app/App.tsx` | 44 |
| `NAV` entries | `src/app/App.tsx` | 31 (13 visible + 18 hidden) |
| `PAGES` (command palette) | `src/core/platform/search.ts` | 32 |
| `EXTRA_PATHS` (support-path cards, drawn by `PathGrid` on the courses home) | `src/core/learning/paths.ts` | 24 |
| `PATH_ROUTE_ALLOWLIST` (routes deliberately *not* path cards) | `src/core/learning/paths.ts` | 19 |

24 + 20 = the 44 routes. `scripts/tests/playbook.test.mjs` regex-reads `App.tsx` as **text** and
diffs every route against `EXTRA_PATHS` + the allowlist, so a new route must be registered in one of
the two or deliberately allowlisted. A path card with no `NAV` entry needs a `labelKey` override
(`/pdf/playbook`).

## Cross-file contracts live in `src/core/platform/keys.ts`

Every persisted-key string shape (`st:*`, `view:*`, `ia:*`, `df:*`, `resume:*`, `final:*`, `code:*`,
`pg:*`, `sql:lab`) and the gamification policy (`XP_PER_LEVEL`, `levelForXp`, `levelProgress`,
`LEVEL_NAMES`) is defined **only** there. Writers in features and readers in
`core/learning/progress.ts` must both call the same function — a typo here silently severs a mastery
gate and the typecheck cannot see it. Keys are byte-compatible with existing learners' stored state.

`keys.ts` is also the *purity* exception list: the test forbids family literals in the pure core
except in five files with a written reason — `keys.ts` (the owner), `learning/paths.ts` and
`assessment/exam.ts` (loaded by explicit path by two tests that do not register the `.ts` hook, so a
value import would make them unloadable — `playbook.test.mjs` pins their families against the owner
instead), and `ai/mission.ts` / `platform/search.ts` (a mission-task id and a search-item id, not
persisted keys).

## Derived figures have one owner

The `/questions` KPI row used to compose its own figures inline. One of them was a **content** ratio
(`published / (baseline × sections)`), which the pack had already overshot 9.6× — so
`Math.min(100, …)` pinned that card at a frozen 100% for as long as it shipped. A KPI that cannot
move claims progress nobody measured, and the fix is structural: the figures belong to the modules
that own the questions.

| Figure (the `/questions` row) | Owner |
|---|---|
| published questions | `public/generated/questions/manifest.json` |
| answer accuracy | `core/assessment/accuracy.ts` (`bankAccuracy`, `bankAccuracyBySection`) |
| answers recorded | `core/learning/coverage.ts` (`bankPractised`) |
| wrong answers still owed | `core/ai/coach.ts` (`bankRedo`) |

- **A page never scans `state.attempts` keys.** The family shape is `keys.ts`'s and the count belongs
  to the core module that owns the question; `k.startsWith('qb:')` inside a renderer is the bug, not
  the fix. Same rule for tallies: one loop, in the core — not a second one beside it.
- **Every family tally has an owner.** `core/learning/coverage.ts` counts what the log holds —
  `bankPractised`, `mockPassed`, `notebookCellsRun` / `notebookCellsRunFor`, `interviewLabsAnswered`,
  `stageRecords`, `doneRecords` — all through one `familyCount`, and `core/learning/progress.ts` owns
  the two that need a section (`codingTasksDone`, `recentStageEvents`). Six surfaces that used to
  spell `lab:mock:` / `nb:` / `st:` / `lab:interview:` themselves (dashboard, job prep, interview
  mode, playground, notebook lab, the badge panel) now ask for the number. The dashboard's coding card
  takes its denominator from the Lab's own list: counting `s.coding` put 18 debug tasks in it (245
  against the Lab's 227), so the card could not pass ~92% however much was solved.
- **`done` is not one thing, so no count is shared between families** unless its name says so.
  Notebook cells write `done` per RUN; mock rounds write it per PASS. `notebookCellsRun` is cells that
  ran (a raised cell still counts) and `mockPassed` is rounds that cleared the bar — `doneRecords` is
  the one deliberate cross-family count, and the first-step badge is its only reader.
- **One sentence, one source.** A line that prints counts *and* a percentage takes both from the same
  `tally`, never one from a hand-rolled loop and the other from the core.
- **The frame loop is presentation; the maths is core.** Count-up animation is driven by a page-local
  React hook, and every number it interpolates or settles on comes from `core/platform/anim.ts`.
- **Enforced, not trusted.** `scripts/tests/engines.test.mjs` sweeps
  `src/core/{learning,assessment,ai,platform}`, `src/features`, `src/components` and `src/core/data`
  for every declared family (`st:`, `view:`, `qb:`, `nb:`, `lab:`, `tp:`, …) and keeps the four pure
  core dirs free of store and React imports (`src/core/storage` and `src/core/data` are
  deliberately excluded — they *are* the store and the React provider).
- `core/learning/coverage.ts` owns the bank predicates **and** the counts built on them
  (`bankPractised`, `bankCorrectIds` — the second so a drill skips what is already mastered);
  `core/learning/study.ts` owns `today()`, which `core/platform/notify.ts` asks for and `store.ts`
  re-exports so pages keep their import.

## State ownership

- `AppState` (one object in `core/storage/store.ts`): profile, xp, streak, attempts, mistakes, review,
  interviewAnswers, defenseAnswers, savedCode, settings, activity.
- Ephemeral UI state: local `useState` inside features/components only.
- Curriculum: `core/data/curriculum.tsx` context, loaded once from `generated/curriculum/*.json`.
- `setState` serializes the **whole** state and writes localStorage synchronously on every call, so
  per-keystroke writes are forbidden — the saved-answer hook debounces 400 ms with a flush on key
  change/unmount.

## Invariants worth preserving

- Mastery gates (`core/learning/progress.ts`) are the only readers of attempt semantics; features only write.
- The app must stay fully offline: no CDN, no external fetch. Bundled runtimes: Pyodide 0.26
  (Python 3.12 + numpy + pandas), sql.js (SQLite WASM), pdf.js + the source PDF, notebooks.
- Evaluation is deterministic (tests + keyword rubrics). No fake AI; optional online features must be
  labelled.
- Hinglish/English i18n: a new user-visible string goes into **both** packs in
  `src/app/i18n/locales.ts`.

## Bilingual content: one model, resolved at the data boundary

Content is authored, not generated, so translation is a **batch migration measured in coverage**, not
a flag day. A translatable authored field is either a plain value (not translated yet, or genuinely
language-neutral — `"Python"`, a code sample, an id) or an `{ en, hi }` map (both languages written).
**Both forms are legal at once, forever.** `hi` is Hinglish (Roman-script Hindi with the English
technical vocabulary), never Devanagari.

`src/core/data/localize.ts` owns the resolver and the states: `full` / `partial` (a map with one side
empty — an empty string counts as MISSING, so `hi: ''` shows English rather than a blank line) /
`plain` / `missing`.

**Where the language is applied is the load-bearing decision: once, at the data boundary.**
`src/core/data/courses.ts` keeps the authored `{ en, hi }` maps in the per-slug fetch cache and
resolves only the value it hands to a component, so a 1.5 MB course file is never re-downloaded on a
language switch and **no render site can forget to translate** — every component downstream gets a
plain `CourseCard` with a plain string. A page must never compare language codes to choose copy.

The rule generalizes past the browser: **any derived artifact that declares a plain string must
resolve the authored field where it reads it.** The AI retrieval corpus is the other consumer, and it
is not a renderer — it stores ONE canonical plain string per field (the English side) because
retrieval tokenizes `title`/`courseTitle`/`body`. `scripts/ai-index.cjs` therefore converts at the
single authored→plain boundary and **stores course slugs instead of course records**, so a call site
cannot read `.name` and forget the conversion. A generator that leaks an `{ en, hi }` map does not
throw: it stringifies to `"[object Object]"` on a learner's screen and poisons the inverted index.
Two guards make that impossible: `assertPlainStrings` in the generator fails the build, and
`validateKnowledgeIndex` (`src/core/ai/knowledge.ts`) validates every printed field as a string so a
bad artifact is rejected at load.

| Concern | Owner |
|---|---|
| Locale ids, message packs, `t()`, `document.lang`/`dir` | `src/app/i18n/{locales.ts,index.tsx}` |
| The bilingual value model + fallback + states | `src/core/data/localize.ts` |
| Which content fields are resolved per language | `src/core/data/courses.ts` (the boundary) |
| The section-name rule (precedence, blank handling, no-op identity) | `src/core/learning/section-names.ts` |
| Fetching the section-name overlay | `src/core/data/curriculum-i18n.ts` |
| Which sections/fields are translated, measured | `npm run i18n:report` → `scripts/lib/i18n-coverage.cjs` |
| UI pack parity + `{placeholder}` survival | `npm run i18n:check` |
| Publishing the section-name overlay | `npm run i18n:sections:write` → `scripts/lib/i18n-sections.cjs` |

**Section names are the one content field that is NOT authored inside its record.** Their English
title lives in `sections.json`, which is extracted from the PDF and then repaired in place by four
scripts, so a translation written there survives only until the next extraction. The reviewed Hinglish
name therefore lives in `content/curriculum/i18n/sections.json` and is merged into
`public/generated/curriculum/i18n.json` — the same reasoning as
`content/curriculum/stage-overrides.json`. Everything else about a section keeps its single generated
source. The full pipeline is in `docs/CONTENT-PIPELINE.md`; the authoring workflow and the measured
coverage (402/402 UI keys, 11/11 course names, 29/29 section names, and everything still outstanding)
are in `docs/LOCALIZATION-GUIDE.md`.

`scripts/lib/i18n-coverage.cjs` owns the coverage numbers so a test can hold them (a report that can
be wrong about its own denominator is worse than no report — the reader it replaced opened the tracks
INDEX with a FILE reader, dropping eight files while still printing a confident total). The overlay is
reported on its **own** line rather than folded into the inline `{ en, hi }` counts, because the two
are different shapes of evidence and combining them would make one percentage flatter the other.
