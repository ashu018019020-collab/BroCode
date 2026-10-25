# AI ENGINEER MASTER LAB

> Learn → Code → Practice → Build → Master

A **premium offline-first AI Python Learning IDE** built from
**Python_Complete_Guide_AI_Engineer_SMART_SECTION_REBUILD_V5_2026.pdf** (457 pages).
The PDF is the primary source of truth: all 29 sections, interview Q&A, coding/logic/debug
tasks, solved practice, mini projects, project labs, checkpoints and mock interviews were
extracted from it and transformed into an interactive curriculum — nothing is invented.

## What's inside

- **8-pillar learning navigation** — the sidebar *is* the learning journey: Dashboard, Learning,
  Practice, Labs, Projects, Interview, Career, Progress — then a labelled Tools group (Notes, Cheat
  Sheets, PDF Reader, Settings). Each pillar is a hub page that indexes the real screens behind it
  (Question Bank, Playbook V15, Timed Exam, Mock Interviews, Notebook/SQL/AI labs, Resume Labs, Job
  Prep, …) and every card shows a figure taken from the engine or manifest that owns it — no
  marketing numbers, ever.
- **Jupyter notebooks everywhere** — coding practice in every lesson stage (Learn, Coding
  Lab, Debug, Mini Project, Project Lab, Final Assessment) and in the authored 16-part topic
  workspace happens in a notebook panel, not a single code box: cells share one kernel session
  per notebook, imports carry down the page, output is real stdout, `In [n] / Out [n]` numbering
  and a live kernel-variable panel make the session visible, and a failing cell opens an Errors
  tab plus an offline AI Explanation with a progressive hint ladder. The same notebooks run
  from the **Notebook Lab**, from the Learning Path, and inline inside any lesson whose section
  has an authored notebook.
- **AI Python Learning Studio (Code Playground)** — a VS Code-style IDE (Monaco editor, file
  explorer, Program Input, Output Console, offline AI Tutor, honest package manager) with real
  in-browser Python (bundled Pyodide, NumPy + pandas wheels included).
- **Error intelligence** — tracebacks are parsed to file/line/column, the exact line is
  highlighted in the editor (and named in the notebook's Errors tab), and a teaching card
  explains the mistake in clear English, with optional Hinglish when that language is selected,
  plus hints and a one-click Fix It where derivable. A notebook cell can file the failure straight
  into the Mistake Tracker.
- **Learning dashboard + roadmap** — 8 tracks (Python Core → Interview + Projects) mapped
  onto the 29 PDF sections, with prerequisite gates, real XP/levels, streaks, daily
  mission, mistake tracker and spaced review.
- **English-first i18n** — English is the permanent default for every new visitor; Hinglish is an
  optional, explicitly selected alternative. The choice is persisted locally and missing translations
  always fall back to English.
- **100% offline** — Monaco, icons, fonts, Python runtime, SQL engine, datasets and the
  PDF are all bundled. No CDN, no cloud APIs, no telemetry.

## Requirements

- Node.js 18+ (LTS 22 recommended) — one-time install, needs internet
- A modern browser (Chrome/Edge/Firefox). Python, SQL, PDF rendering all run **inside** the browser.

## Install & run

```bash
npm install
npm run dev        # http://localhost:5173
```

Production:

```bash
npm run build
npm run preview    # http://localhost:4173
```

For a plain static host (nginx/IIS/USB stick), serve the `dist/` folder after `npm run build`.

## Project structure

| Path | What it is |
|---|---|
| `src/app/` | The shell: `App.tsx` (routes + the sidebar `NAV`, which is also the label/icon source for every card), `main.tsx`, `i18n/` |
| `src/core/learning/` | Pure logic: mastery gates, the roadmap, spaced review, coverage counts, the study log, the Learning Path card registry |
| `src/core/assessment/` | Pure logic: keyword rubrics & output checks, exam papers, interview scoring, accuracy, the Learning Path card registry |
| `src/core/ai/` | The offline assistant: page-aware retrieval over the generated lesson/question/project index, tutor hints, progress coaching, and strict app facts |
| `src/core/platform/` | `keys.ts` (the only owner of persisted-key shapes), command-palette search, notifications, achievements, count-up maths |
| `src/core/storage/` | `store.ts` — the single owner of `AppState` and the only module that touches `localStorage` — plus UI/exam prefs |
| `src/core/data/` | Data access: loaders/adapters for curriculum, questions, playbook, notebooks, tracks and the lazy AI knowledge index — fetches `public/generated/`. No JSON lives under `src/`; the authored source is `content/` |
| `src/features/` | The screens, grouped by pillar: `dashboard`, `learning`, `practice`, `labs`, `projects`, `interview`, `career`, `progress`, `tools` |
| `src/components/` | Shared UI, the editors (`MonacoIDE`, `JupyterNotebook`) and the card grids (`PathGrid`, `HubGrid`) |
| `content/` | **Authored source**: curriculum sections, guides/packs/topics, question banks, playbook source, notebooks |
| `public/generated/` | **Build output** published by the scripts, including compressed `ai/knowledge.json.gz` — never hand-edited |
| `scripts/`, `tools/` | The generators (dry-run by default, `--write` publishes) and the test suite that holds them to it |

## Offline mode

Everything executes locally — no CDN, no fonts, no external APIs:

| Capability | Bundled runtime (local files in `public/`) |
|---|---|
| Python 3.12 + numpy + pandas | `public/pyodide` (Pyodide WASM + filtered wheel set, ~48 MB) |
| SQL (SQLite) | sql.js WASM in `public/sqljs` |
| PDF reader | pdf.js + worker in `public/pdf`, source PDF in `public/pdf/` |
| Curriculum + search | `public/generated/curriculum/*.json` (extracted from the PDF) |
| BroCode AI knowledge | `public/generated/ai/knowledge.json.gz` (2.5 MB compressed, loaded on first question; local retrieval only) |
| Datasets | students, sales, customers, employees, expenses, chat_logs (in-app) |

A service worker (`public/sw.js`, cache `aiml-v6`) caches the app shell and assets at
runtime. After the first full load, disconnect the internet and reload — the app works
completely offline. Install as a PWA from the browser menu for a standalone window.

Notes:
- Refresh the assistant corpus with `npm run ai:index` (dry run) or `npm run ai:index:write` (publish). It is derived from the published curriculum, question banks, playbook, tracks, courses, notebooks and career registries; it does not call a hosted model or include learner records.
- The service worker never caches HTML responses under asset paths (prevents a poisoned
  cache if a file is temporarily missing).
- GenAI/Agentic labs are **simulations** (deterministic, offline). Any optional online
  feature would be clearly labeled — the core course never needs one.

## Python runtime setup

Nothing to do: the worker loads `pyodide.mjs` from its local folder (path resolved against
the site base URL, so it works in dev, preview and any static host). First run takes
~30–60 s to unpack the runtime; afterwards it is served from cache. `input()` reads from
the "Program input" box under the notebook cells (one value per line).

## SQL runtime setup

Nothing to do: sql.js is imported from npm and loads its `.wasm` from `public/sqljs`.

## Diagnostics

```bash
npm run doctor
```

Checks Node/npm, required project files, bundled runtime assets (Pyodide, SQLite WASM,
curriculum, PDF), dependencies (and rejects cloud/online packages), and storage setup.
Every line reports ✓ ready, ⚠ warning, or ✕ missing.

## Language system

**English is the official default.** A visitor with no saved choice gets English immediately — the
app never guesses from the browser language. The `English | Hinglish` switch on Settings (also in the
quick-actions menu) changes the interface in place and stores the explicit choice;
returning users get the language they picked, and every missing translation falls back to English.

`src/app/i18n/` holds the packs: `locales.ts` (English + Hinglish dictionaries, keyed) and
`index.tsx` (`I18nProvider`, `useI18n().t`, instant switch, `localStorage` persistence, English
fallback for missing keys). Adding strings: add the key to `en` first, then translate in `hinglish`.
UI labels and app-generated copy live in the packs/source; lesson prose is PDF-authored and is being
translated in reviewed batches (see `docs/LOCALIZATION-GUIDE.md`).

## AI Mentor, Coding Coach & Spoken Interview

The AI studio at `/#/ai-mentor` adds a voice-first mentor, a diagnostics-driven coding coach inside
the Playground, and a spoken mock-interview round with scorecards and history. All answers, code
evidence and scores come from the bundled curriculum and the existing offline runners; the optional
OpenAI Realtime voice needs a server-side key, is rate-limited, and falls back to the browser voice.
Architecture, provider setup, security rules and known limits: **[docs/AI-VOICE.md](docs/AI-VOICE.md)**.

## Adding offline packages

Edit `src/core/data/packages.ts`. `availableOffline: true` may only be used for packages
actually bundled with the runtime (numpy, pandas, stdlib). Anything else must stay
`false` — the UI then honestly says the package is not available offline.

## Adding lessons / tasks

The curriculum lives in `content/curriculum/` (source) and is published to
`public/generated/curriculum/sections.json` (generated from the PDF by
`tools/extract.mjs`). See "Regenerating the curriculum" below for the maintainer flow;
the app renders whatever the schema contains — no page changes needed for content.
The bundled datasets seed fresh tables on every query run.

## Authored practice packs & topic guides (maintainer)

The bank ships two layers. `source: "curriculum"` records are seeded from the extracted
PDF; `source: "authored"` records are hand-written in `content/questions/expansion/*.json`
(short keys `s/t/d/i/q/a/x` = section, type, difficulty, importance, question, answer,
explanation). Authored records carry provenance — `sourceVersion`, `verifiedAt`, a track
tag and a `batch` id like `track:sql:v1` — so a hand-written item can never be mistaken
for extracted content.

Question types are `theory`, `interview`, `coding`, `logic`, `debug`, `solved`, `defense`
and `checkpoint`; `defense` (project-defense answers) is first-class: it has its own label,
its own stage mapping and its own filter in the Question Bank.

```bash
npm run questions:expand-track -- --track=sql --file=content/questions/expansion/sql.json
npm run questions:quota                 # per-track x per-type quota gate (exits 1 if short)
npm run questions:quota -- --report     # ...and regenerate CONTENT-REPORT.md
```

`questions:expand-track` is append-only and idempotent: it merges into the section banks,
skips duplicate ids *and* duplicate question text, re-validates, then rewrites the manifest.
`questions:quota` is the gate: it expects +20 new items of every type in every track
(8 tracks x 8 types x 20 = 1,280) and reports per-section totals against the 50-item
baseline, so "complete" can never be claimed while a section is thin.

The "CODE KAISE KARTE HAIN" guide layer lives in `content/curriculum/guides/<track>.json`
(one guide per required topic) and is measured against `content/curriculum/topics/<track>.json`:

```bash
npm run curriculum:guides         # dry run: validate guides, execute every example
npm run curriculum:guides:write   # apply into public/generated/curriculum/sections.json
npm run curriculum:topics         # required-topic coverage matrix
```

Every example is executed with the local Python interpreter and the stored `output` is the
real stdout; an example that needs a bundled-only module (numpy/pandas/sklearn) keeps its
documented output and is marked `verified: false` so the UI can say so. Guide code steps are
instructional fragments (a Dockerfile line, a SQL clause) and are deliberately not executed.
Guides are additive: a guide attaches to an existing concept when the title matches, and
otherwise creates a new concept marked `authoredTopic: true` — extracted PDF notes are never
overwritten, and a re-run refreshes only the topics a guide owns. Run this pass *after*
`curriculum:learn:write` / `curriculum:stages:write`, since it edits sections.json last.

### Jupyter notebooks (content/notebooks)

The Python practice lives in real `.ipynb` files (`content/notebooks/`). They are browsable and
runnable in the app's **Notebook Lab** (deep-linkable at `/notebooks?nb=<file>`), inline inside
any lesson stage whose section owns one, and from the Learning Path — all against the offline
Pyodide runtime. Each notebook gets its own kernel session, so names never leak between them:

```bash
npm run notebooks          # dry run: validate every notebook and execute every cell
npm run notebooks:write    # execute + stamp real stdout, publish to public/notebooks/
npm run notebooks:check    # structure matrix (cells, verified, app-only)
```

The pass is honest by construction: each cell is executed with the local Python interpreter
and its real stdout is stored as a Jupyter `stream` output, cells share one interpreter session
(so a cell may use a name imported by an earlier cell, exactly like Jupyter), and a cell that
teaches an exception declares `metadata.expectError: true` so its real traceback is stored
instead of hiding the failure. Cells that need `numpy`/`pandas` declare `metadata.appOnly:
true`: the pass checks the wheel is actually bundled under `public/pyodide` and marks them
`verified: false, verifiedHow: "app-runtime"` — they run for real in the browser (the bundled
CSV datasets are seeded into the virtual filesystem, so `pd.read_csv('students.csv')` works
offline). Nothing is fabricated: an app-only cell stores no output until the learner runs it.

### 16-part topic workspaces

Every section can additionally carry a **topic workspace** (`section.topic`), which organises
that one topic end to end instead of leaving its content spread across mixed extracts:

1. Topic introduction · 2. Concepts/theory · 3. Syntax · 4. Simple examples · 5. Real-world
examples · 6. Interview questions · 7. Practice questions (5 difficulty levels) · 8. Coding
practice · 9. Debugging questions · 10. Challenges (quick/coding/advanced/interview/build) ·
11-13. Simple / medium / hard projects · 14. Project improvement tasks (Version 1 → 4) ·
15. Interview-based practical tasks · 16. Revision checklist — plus project questions grouped
as understanding/coding/advanced/interview.

Sources live in `content/curriculum/packs/<sectionId>.json` (one file per topic so a topic can
be authored and reviewed alone):

```bash
npm run packs -- --section=s08   # dry run: shape check + execute every snippet
npm run packs:write              # apply into public/generated/curriculum/sections.json
npm run packs:check              # per-section 16-part quality matrix
```

Topic purity is enforced, not assumed: the pass refuses to write when a question repeats
inside a topic, when a pack is missing a part (no coding practice, no debugging, no revision
checklist…), or when a snippet is dishonest — every "runnable" snippet must really run, every
"broken" snippet must really fail, and a *logic* bug (`mode: "logic"`) must run cleanly and
produce output that differs from its fix. Stored `output` values are real stdout; snippets
that need a module this machine lacks are marked `verified: false` rather than faked. A
section without a pack renders exactly as before, so a topic can be filled in later without a
half-built lesson. `CONTENT-REPORT.md` lists which sections are structured and which are not.

## Data storage (local only)

- Progress, XP, streak, attempts, mistakes, notes, bookmarks, saved code: `localStorage` (`aiml:state:v1`), versioned.
- Large blobs (if any) use IndexedDB; nothing leaves the machine.
- **Export/Import progress** (JSON backup) lives in Settings.

## Backup

Use Settings → Export progress to save `aiml-progress.json`. Import restores everything
(progress, streak, mistakes, notes, saved code).

## Troubleshooting

- **Python says "Loading …" forever** — first boot is slow; run once while online so the
  service worker caches the runtime, then it works offline.
- **SQL shows a wasm/MIME error** — make sure `public/sqljs/sql-wasm-browser.wasm` exists
  and the server serves `.wasm` as `application/wasm`.
- **App won't load offline** — it must be fully loaded once while online; check the SW is
  registered (DevTools → Application → Service Workers) and no old cache (`aiml-v1`) remains.
- **Hard reset** — Settings → reset, or delete the `aiml:state:v1` localStorage key.

## Further learning (optional, online, third-party)

This lab is fully self-contained and offline. If you also want guided practice with a
structured path, [boot.dev](https://www.boot.dev) is a reasonable companion:

1. Create a free account at <https://www.boot.dev>.
2. Try a few of the demo lessons first — the free account is enough for that.
3. If it clicks, the plans are at <https://www.boot.dev/pricing>; the code **FREEBUFF**
takes 25% off a membership, and the annual plan is the steeper saving.

The individual courses are listed at <https://www.boot.dev/courses>, but for most
learners the onboarding quiz plus a structured learning path beats cherry-picking
courses one by one.

Nothing in this app depends on that third-party service, no link here carries tracking
parameters, and the code is simply a promotional discount passed along to this project —
treat it like any other coupon and decide for yourself whether the paid tier is worth it.

## Regenerating the curriculum from the PDF (optional, maintainer)

```bash
node tools/extract.mjs "<path-to-pdf.pdf>"   # writes public/generated/curriculum/*.json
```

Extraction summary: 163 concepts · 179 interview Q&A · 245 coding tasks · 172 logic cards ·
120 solved practices · 29 mini projects · 87 project-lab tiers · 20 checkpoint questions ·
39 mock-interview questions · 60 cross-skill intensive questions.

### Importing the V10 answer PDF into the question banks (optional, maintainer)

The V10 "Senior Visual Answer Edition" is a separate, far larger document than
`public/pdf/guide.pdf`: 3,239 pages, 13,582 answered items, laid out as 29 sections ×
9 stages × 52 items. `scripts/pdf-questions.cjs` reads it with `pdftotext -layout`
(cached in `.freebuff/`, exactly like `learn.cjs`) and curates it into each section's own
bank.

```bash
npm run questions:pdf -- --pdf="<path-to-v10.pdf>"        # dry run: report only
npm run questions:pdf:write -- --pdf="<path-to-v10.pdf>"  # merge + rewrite the manifest
```

Default run is a DRY RUN. It reports every count it is about to change — parsed items,
dropped duplicates, section-tied rewrites, highlights and the size delta — and validates
the whole pack before writing. Re-running the import is a no-op: ids are appended the same
way `questions:expand-track` appends them, and `mergeIntoBank` skips ids *and* texts.

All curation is deterministic; nothing is invented:

* **Stage → type** uses the schema's eight types only. MINI PROJECT reuses `coding`
  (adding a type would break the locked 1,280-item authorship quota) and carries the
  `mini-project` tag so the UI can still tell the two apart.
* **Difficulty** maps 1:1 — BASIC→easy, INTERMEDIATE→medium, ADVANCED→hard, SENIOR→expert.
* **Importance** keeps the PDF's own order intact — CRITICAL→`must_know` (P0),
  HIGH→`high_value` (P1), CORE→`advanced` (P2).
* **Duplicates are removed, never hidden.** A question repeated *inside* one section keeps
  its strongest variant and the copies are dropped (the PDF boilerplates its
  edge/performance/refactor tasks, so some sections only have 13–17 unique texts out of
  52). A question repeated *across* sections is made section-specific instead, which is
  the fix `questions.test.cjs` asks for, so no section loses coverage. The curated set is
  asserted globally unique *before* anything is written, so this command can never leave
  the pack in a state the test suite rejects.
* **Highlighting** writes a `MUST-KNOW` tag on the section's top priority band
  intersected with the PDF's SENIOR difficulty, then sorts those items first inside the
  bank. The Question Bank already renders the first two tags as chips, so the highlight
  needs no CSS and no page changes.
* **Improvement is structural**: pdftotext wrap artefacts are rejoined (including the MINI
  PROJECT fragment that the template splits across the ANSWER marker), wrapped words are
  re-joined, and an answer's `Use:` clause is dropped when the `USE / IMPACT` line already
  carries that sentence — which is what fills `explanation`.

Sections the PDF labels CRITICAL wholesale (s13–s24, s26–s29) are why the highlight is an
intersection rather than the band alone: the band by itself would flag 61% of the
document. The rule lives in one constant (`HIGHLIGHT_RULE`) in `scripts/lib/pdfqa.cjs`.

Every imported record carries `pdfPage`, `pdfStage` and `pdfImportance`, so any item can
be traced back to the page it came from. The PDF itself is not committed — it would ship
in `dist/` — so a re-run needs the file path (or the cached layout text).

### Where those questions appear in a lesson (maintainer)

Each **lesson stage carries its own slice of the bank**, so a stage can be practised without
leaving it: LEARN → `theory`, INTERVIEW → `interview`, CODING LAB → `coding`, LOGIC → `logic`,
DEBUG → `debug`, Practice Solutions → `solved`, MINI PROJECT → the `mini-project` tag,
DEFENSE → `defense`, CHECKPOINT → `checkpoint`. Project Lab has no slice, because the PDF has
no project band — that stage stays built from the section's own project tiers.

The mapping lives once, in `STAGE_QNA` in `src/core/data/questions.ts`, and both the panel and
the counts read it. `src/components/learning/StageQnA.tsx` renders the questions with reveal-answer,
self-grading and paging, and writes the **same `qb:<id>` attempt keys as the Question Bank** —
so a question graded in a lesson is graded everywhere, and nothing is counted twice. It does
not touch the mastery gates: practice is not a gate, and the thresholds are unchanged.

The stage rail and the hero stats read their numbers from `manifest.json` (`byType`, `byStage`
and `miniProject`), never from a hard-coded list, so the count on a tile always matches the
questions behind it. A stage outside a topic's mastery gates still shows its count — that case
is exactly where a hidden count reads as "no content".
