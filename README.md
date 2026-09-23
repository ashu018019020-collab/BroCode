# AI ENGINEER MASTER LAB

> Learn → Code → Practice → Build → Master

A **premium offline-first AI Python Learning IDE** built from
**Python_Complete_Guide_AI_Engineer_SMART_SECTION_REBUILD_V5_2026.pdf** (457 pages).
The PDF is the primary source of truth: all 29 sections, interview Q&A, coding/logic/debug
tasks, solved practice, mini projects, project labs, checkpoints and mock interviews were
extracted from it and transformed into an interactive curriculum — nothing is invented.

## What's inside

- **AI Python Learning Studio** — a VS Code-style IDE (Monaco editor, file explorer,
  Program Input, Output Console, offline AI Tutor, honest package manager) with real
  in-browser Python (bundled Pyodide, NumPy + pandas wheels included).
- **Error intelligence** — tracebacks are parsed to file/line/column, the exact line is
  highlighted in the editor, and a teaching card explains the mistake in Hinglish or
  English with hints and a one-click Fix It where derivable.
- **Learning dashboard + roadmap** — 8 tracks (Python Core → Interview + Projects) mapped
  onto the 29 PDF sections, with prerequisite gates, real XP/levels, streaks, daily
  mission, mistake tracker and spaced review.
- **Hinglish-first i18n** — instant Hinglish/English toggle, persisted locally; missing
  keys fall back to English.
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

## Offline mode

Everything executes locally — no CDN, no fonts, no external APIs:

| Capability | Bundled runtime (local files in `public/`) |
|---|---|
| Python 3.12 + numpy + pandas | `public/pyodide` (Pyodide WASM + filtered wheel set, ~48 MB) |
| SQL (SQLite) | sql.js WASM in `public/sqljs` |
| PDF reader | pdf.js + worker in `public/pdf`, source PDF in `public/pdf/` |
| Curriculum + search | `public/curriculum/*.json` (extracted from the PDF) |
| Datasets | students, sales, customers, employees, expenses, chat_logs (in-app) |

A service worker (`public/sw.js`, cache `aiml-v2`) caches the app shell and assets at
runtime. After the first full load, disconnect the internet and reload — the app works
completely offline. Install as a PWA from the browser menu for a standalone window.

Notes:
- The service worker never caches HTML responses under asset paths (prevents a poisoned
  cache if a file is temporarily missing).
- GenAI/Agentic labs are **simulations** (deterministic, offline). Any optional online
  feature would be clearly labeled — the core course never needs one.

## Python runtime setup

Nothing to do: the worker loads `pyodide.mjs` from its local folder (path resolved against
the site base URL, so it works in dev, preview and any static host). First run takes
~30–60 s to unpack the runtime; afterwards it is served from cache. `input()` reads from
the "Program input" box under the editor (one value per line).

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

`src/i18n/` holds the packs: `locales.ts` (English + Hinglish dictionaries, keyed) and
`index.tsx` (`I18nProvider`, `useI18n().t`, instant switch, `localStorage` persistence,
English fallback for missing keys). Adding strings: add the key to `en`, then translate
in `hinglish`. UI labels only — lesson content is PDF-authored.

## Adding offline packages

Edit `src/data/packages.ts`. `availableOffline: true` may only be used for packages
actually bundled with the runtime (numpy, pandas, stdlib). Anything else must stay
`false` — the UI then honestly says the package is not available offline.

## Adding lessons / tasks

The curriculum lives in `public/curriculum/sections.json` (generated from the PDF by
`tools/extract.mjs`). See "Regenerating the curriculum" below for the maintainer flow;
the app renders whatever the schema contains — no page changes needed for content.
The bundled datasets seed fresh tables on every query run.

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

## Regenerating the curriculum from the PDF (optional, maintainer)

```bash
node tools/extract.mjs "<path-to-pdf.pdf>"   # writes public/curriculum/*.json
```

Extraction summary: 163 concepts · 179 interview Q&A · 245 coding tasks · 172 logic cards ·
120 solved practices · 29 mini projects · 87 project-lab tiers · 20 checkpoint questions ·
39 mock-interview questions · 60 cross-skill intensive questions.
