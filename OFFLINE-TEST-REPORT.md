# OFFLINE TEST REPORT — AI Engineer Master Lab

Validated **2026-09-21** on the live running app (dev `:5173` and production build `:4173`,
`vite preview` of `dist/`). All checks below were executed against the real UI, not just code.

## Environment

- Windows, Chrome-family browser via automation; Node 22 (toolchain only)
- Production bundle: 267 KB JS (85 KB gzip) + code-split pdf worker (96 KB gzip) + sql.js (15 KB gzip)
- Bundled runtimes: Pyodide 0.26 / Python 3.12.1 + numpy 1.26 + pandas 2.2 (48 MB local),
  sql.js SQLite WASM, pdf.js + source PDF (9.1 MB), curriculum JSON (317 KB)

## Results

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | App opens, dashboard renders | ✅ | Welcome, Today's Mission (6 tasks), Next Best Action, 6 track bars, Mastered/Needs-practice — all from PDF-derived data |
| 2 | Navigation (all routes) | ✅ | Sidebar links navigate; lesson tabs (10 stages) switch; roadmap nodes render all 29 sections |
| 3 | Learning path / roadmap | ✅ | 29 sections with status chips (AVAILABLE/CURRENT/…), %, concept/coding/interview counts, PDF page links |
| 4 | PDF reader (local pdf.js) | ✅ | Canvas renders page 1 of the bundled PDF (72 KB raster confirmed); page navigation present |
| 5 | Global search (Ctrl+K) | ✅ | Palette opens; "broadcasting" returns NumPy hits incl. PDF interview Q with page ref; Esc closes |
| 6 | Python executes offline | ✅ | `import numpy as np; a=np.arange(6); print(a.mean())` → `2.5` (numpy wheel loaded from local files) |
| 6b | Pandas executes offline | ✅ | `pd.read_csv('students.csv')` → `(8, 5)` + head/describe on the built app; datasets seeded into the Pyodide FS; groupby/HAVING workflows verified (see Dataset Lab below) |
| 7 | Python production build | ✅ | `PROD-OK 3.12.1` — Pyodide boots from the built bundle, no CDN |
| 8 | stdin / input() | ✅ | `age = input("Age: ")` with Program input `25` → `Next year: 26` |
| 9 | Error path + friendly decomposition | ✅ | Traceback captured; ERROR → WHAT HAPPENED / LIKELY CAUSE / HOW TO DEBUG panel implemented (OSError/EOFError mapped for input cases) |
| 10 | Coding task completion | ✅ | A successful run marks the task complete (gate reads `st:<id>:codingN`); the PDF's CHECK guidance renders with each task |
| 11 | SQL lab (SQLite WASM) | ✅ | GROUP BY query returned a result table on the built app; datasets seeded locally |
| 12 | Projects / lesson flow | ✅ | 10-stage lesson (Learn→…→Checkpoint) with per-stage components; mini/project/defense stages present |
| 13 | Checkpoint gating (no fake completion) | ✅ | Section 01 shows per-gate PASS/FAIL (Interview ≥70%, Coding ≥70%, Logic ≥70%, Debug ≥70%, Practice, Mini, Project, Defense ≥60, Checkpoint ≥70%) and exact missing list — Mastery locked until gates pass |
| 14 | Progress saves | ✅ | `aiml:state:v1` in localStorage; seeded value survived full reload |
| 15 | Interview bank / mock / intensive | ✅ | 179 section Q&A + 39 mock + 60 intensive searchable and rendered with model answers |
| 16 | Service worker / PWA | ✅ | SW registered (scope `/`), cache `aiml-v2` only; v1 cache auto-purged |
| 17 | No external requests | ✅ | Network log on production: only localhost:4173 (curriculum JSON etc.); zero cross-origin calls |
| 18 | Console clean | ✅ | No errors on production load or during runs (after fixes below) |
| 19 | Dataset Lab (pandas on bundled data) | ✅ | Datasets tab in NumPy+Pandas Lab: previews + per-dataset load/filter/groupby/join/missing-value workflows; verified live: students groupby → Delhi 79.33 / Mumbai 85.0 / Pune 75.67; employees HAVING → AI 92500 / Data 73500; real NaNs then fillna via outer-join miss |
| 20 | Cross-surface dataset access | ✅ | Same `pd.read_csv('sales.csv')` works in the Code Playground (revenue-by-product verified) — worker-level seeding, not page-level |
| 21 | numpy regression | ✅ | NumPy-tab examples unchanged after the FS-seeding change |

## Defects found & fixed during this validation

1. **Python output lost** — worker captured the init-time id in the stdout/stderr closures, so
   every `print` was buffered under the wrong key → "(no output)". Fixed by binding streams to
   the active run id; runs are now serialized.
2. **`input()` crashed (OSError)** — stdin was never wired. Added a Program-input box in
   CodeLab routed through the worker (`setStdin`), plus OSError/EOFError explanations.
3. **Stop button hung awaiters** — terminating the worker left `pythonReady()` pending
   forever; now resolved and a fresh worker starts.
4. **sql.js served the wrong wasm name** — the browser build requests
   `sql-wasm-browser.wasm`; only `sql-wasm.wasm` was bundled, so the dev server's HTML
   fallback broke instantiation. Bundled the correct file.
5. **Service worker cache poisoning** — a failed asset fetch (the wasm above) cached the HTML
   fallback because it returned 200. SW now never caches `text/html` under asset paths, and
   the cache version was bumped to purge existing bad entries.

## Remaining notes

- First Python boot takes ~30–60 s (unpacking the runtime once); subsequent runs are fast.
- GenAI/Agentic/defense scoring are deterministic rubric simulations by design (no fake AI
  claims); no online API is used anywhere.

## Defects found & fixed during Dataset Lab validation (2026-09-22)

6. **pandas could never run** — the bundled Pyodide lock listed only numpy + pandas, but
   pandas 2.2.0 declares `python-dateutil`/`pytz`/`six`; `loadPackagesFromImports` aborted
   with "No known package with name 'python-dateutil'". Fixed by merging the three entries
   into the bundled lock (`.freebuff/merge-lock.cjs`).
7. **SRI mismatch on the dependency wheels** — wheels fetched from PyPI carry different bytes
   (and digests) than Pyodide's release build, so lock-driven integrity blocked them. Fixed by
   recording the SHA-256 of the actual shipped wheel bytes in the lock entries; Pyodide's own
   validation then passes against the files we serve, fully offline. Digested bytes are
   verified-size PyPI artifacts (~746 KB total).
