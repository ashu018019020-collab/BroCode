# NumPy Mastery — repository audit and architecture

Audited before any file was added, so the course reuses the platform instead of cloning it.

## What already existed

| Area | Finding |
|---|---|
| Courses page | `src/features/courses/CoursesHome.tsx` renders one grid; the eleven catalog cards come from `public/generated/courses/index.json`, and **C Programming** and **Java Programming** are separate course pages (`/c-programming`, `/java`) drawn as extra cards. |
| NumPy today | NumPy is a **track section pair** (sections 17–18, `numpy-pandas`), a lab page (`/numpy-pandas`), notebook cells tagged `needsAppRuntime`, and question bank sections `s17`/`s18` (384 KB + 300 KB). There is **no** standalone NumPy course, no module workspace and no ten-section structure. |
| Pandas today | Same track pair plus the `numpy-pandas` lab. Nothing was moved or deleted by this work — Pandas content, stored progress and routes are untouched. |
| Reference course architecture | `C Programming` and `Java Programming`: `content/<course>/**` → `scripts/<course>-course.cjs` → `public/generated/<course>/*.json` → `core/learning/*.ts` rules → `core/data/*.ts` loaders → `features/<course>/` pages. |
| Python execution | Code Bro (`/notebooks`) runs Pyodide in a worker (`src/features/coding/pythonWorker.ts`) with **numpy + pandas bundled** (`needsAppRuntime` cells and the dataset seed prove it). No second runtime was added. |
| Progress | `recordAttempt(key, record)` in `core/storage/store.ts`; every course owns a key family. |
| XP / stats | `addXp` exists, unchanged by this course. |
| Admin | `/admin` and `/admin/content`; the NumPy pack is generated from `content/`, so it is edited by editing source and re-running the generator, the same rule every other course follows. |
| Search / routes | `PAGES` (`core/platform/search.ts`), `PATH_ROUTE_ALLOWLIST` (`core/learning/paths.ts`), the route table in `src/app/App.tsx`, and `npm run sitemap:write`. |

## What was missing

1. A standalone NumPy course card and page (only a track section pair existed).
2. Modules with the ten-section learning architecture.
3. Per-module practice: interview, coding, logic, debug, practice solutions, mini project, project lab, defense, checkpoint.
4. A course-specific progress family and a validated content artifact.
5. A NumPy course mark.

## What this batch adds

- `content/numpy-mastery/course.json` + `modules-0X-0Y.json` (authored source) and
  `deepening*.json` (per-module depth layers, applied in phase order and merged by the generator).
- `scripts/numpy-course.cjs` — validates and publishes one artifact; refuses duplicates, empty
  sections, and a debug challenge whose fix equals its broken code.
- `scripts/numpy-fill-outputs.cjs` — executes every depth-layer sample and stores the real stdout, so
  no published output is hand-typed.
- `public/generated/numpy-course/index.json` — 20 modules, ten sections each, **2,540 entries**.
- Coding Lab publishes independent tasks only: the guided, topic-copied entries were removed in
  phase 7, so every coding record carries its own data and a hidden check. Phase 12 grew the bank to
  500 tasks (25/module); phase 13 grew Debug to 200 challenges (10/module), each executed on both
  numpy 2.x and 1.26 with the recorded error taken from the interpreter.
- `content/numpy-mastery/deepening-3.json` — 80 debug challenges whose broken code is executed and
  required to raise, with the stored error taken from the interpreter and the fix required to run.
- `content/numpy-mastery/tasks*.json` — 500 independent coding tasks (25/module) with a hidden check
  each; the grader runs learner code, then the check in the same kernel namespace, so a copied
  lesson snippet fails. Their reference outputs are executed, not typed, on numpy 2.x and on the
  1.26 build the browser runtime ships.
- Interview and Defense carry authored answers in `deepening-5/6/7.json` (9 per module each). The
  generator no longer derives either section from a topic body: Interview publishes the verified-
  output question per topic plus the authored bank, and Defense publishes the authored bank only. A
  test asserts no interview/defense answer equals any Learn body (measured 0 of 600).
- Checkpoint publishes two kinds of record per topic: a multiple-choice quiz whose three options are
  real executed outputs from the same module (the generator refuses one without its answer or with a
  repeated option), and a written prompt with three rubric criteria derived from the topic's title and
  executed output. Written drafts and their ticks are stored per entry (`nans:` / `ntick:`) and
  survive a refresh; the model answer is gated behind actually writing something.
- Coding Lab is graded at runtime: `outputMatches` (`src/core/learning/ncourse.ts`) compares the
  learner's printed output with the module's executed output in a per-task Pyodide kernel. The
  expectations are checked against numpy 1.26.4 + pandas 2.2.0 (what the bundled browser runtime
  ships) as well as numpy 2.x.
- `src/core/learning/ncourse.ts` — types, section registry, progress rules (pure, tested).
- `src/core/data/ncourse.ts` — loader only.
- `src/features/numpy-mastery/{NLogo,NCoursePage}.tsx` — mark + course/module workspace.
- Route `/numpy`, a catalog card, a `PAGES` record and the route allowlist entry.

## Deliberate omissions

- **Pandas was not touched.** It keeps its track sections, lab and question banks.
- `np.matrix`, `np.int`, `np.float` and legacy `np.random.seed` are not taught as recommended
  patterns; the random module teaches `default_rng`.
- No new runtime: the "Run in Code Bro" links open the existing Pyodide notebook, where numpy is
  already bundled.
