# Content pipeline

How authored content becomes what the app loads. Every statement below was verified against the
scripts and confirmed by running the generators in the `scripts/*.cjs` dry-run mode (all clean).

## The one rule

**`content/**` is authored. `public/generated/**` is output. `public/**` is never hand-edited.**

`src/core/data/*` is *only* the TypeScript that fetches the published files. There is no JSON under
`src/`.

Dry run is the default for every generator; `--write` (or a `:write` npm script) publishes.

## Module responsibilities

| Layer | Location | Responsibility |
|---|---|---|
| Authored source | `content/**` | The only place content is written by hand. Not served, never in `dist/`. |
| Generators | `scripts/*.cjs`, `scripts/lib/*.cjs`, `tools/extract.mjs` | Read source, validate, optionally execute snippets, emit artifacts. |
| Published artifacts | `public/generated/**` | What the app fetches. Asserted byte-for-byte by tests where it is generated. |
| Bundled runtimes | `public/{pyodide,sqljs,pdf,notebooks}/` | Third-party runtimes, the source PDF, published notebooks. Inputs, not generated. |
| Data access | `src/core/data/*` | Fetch + type + **localize**. No maths, no gates, no JSON. |
| Pure logic | `src/core/{learning,assessment,ai,platform}/*` | Rules. No React, no store — enforced by `engines.test.mjs`. |

## The `sections.json` accumulation — the thing to understand first

`public/generated/curriculum/sections.json` is the app's single largest classroom artifact (29
sections, ~1 MB). It is **not** produced by one script. It is produced by `tools/extract.mjs` and then
**repaired in place by four more scripts, in order**:

| # | Command | Reads | Writes | What it does |
|---|---|---|---|---|
| 1 | `node tools/extract.mjs` | `public/pdf/guide.pdf` | `generated/curriculum/{sections,meta}.json` | Base extraction from the source PDF. Needs the PDF, which is not committed. |
| 2 | `npm run curriculum:learn:write` | PDF (layout pass), `content/curriculum/learn-overrides.json` | `sections.json` | Rebuilds `learn.concepts` code/output **and executes every snippet**, keeping only matching output. |
| 3 | `npm run curriculum:stages:write` | `content/curriculum/stage-overrides.json` | `sections.json` | Replaces boilerplate stage cards the PDF repeated verbatim in every module. |
| 4 | `npm run curriculum:guides:write` | `content/curriculum/guides/*.json`, `content/curriculum/topics/*.json` | `sections.json` | Attaches the authored "CODE KAISE KARTE HAIN" guide layer; executes every example. |
| 5 | `npm run packs:write` | `content/curriculum/packs/<sectionId>.json` | `sections.json` | Attaches the authored 16-part topic workspace. Additive per section. |

**Consequence, and the reason this table exists:** the four repair steps are additive overlays applied
to a generated base. A translation written *into* `sections.json` therefore survives until the next
extraction. That is why the Hinglish section names live in `content/curriculum/i18n/sections.json` and
are merged by a separate generator — see `docs/LOCALIZATION-GUIDE.md`.

## The rest of the graph

Order matters. This is the real dependency order, not the alphabetical one:

```
content/questions/**  content/notebooks/**  content/tracks/**
        │
        ├─► npm run questions:seed / :manifest      → public/generated/questions/**
        ├─► npm run notebooks:write                 → public/notebooks/**
        ├─► npm run playbook:write                  → public/generated/playbook/**
        │
        ▼
public/generated/curriculum/sections.json   (the 5-step accumulation above)
        │
        ├─► npm run search:index:write   reads sections + questions  → public/generated/search/index.json
        ├─► npm run questions:pdf:write  reads the guide PDF + banks → merges into questions/**
        │
        ▼
npm run courses:write      reads sections + tracks + playbook + questions + notebooks
                           → public/generated/courses/{index,<slug>}.json
        │
        ▼
npm run ai:index:write     reads EVERYTHING above → public/generated/ai/knowledge.json.gz
npm run i18n:sections:write reads sections + authored i18n overlay
                           → public/generated/curriculum/i18n.json
npm run sitemap:write      reads src/app/App.tsx + registries → public/sitemap.xml, robots.txt
npm run og:write           renders → public/brocode-og.png  (needs local Chrome/Edge)
```

`courses:write` must run **after** questions/playbook/notebooks, because it tags every item with
`{course, chapter, ref}` from all of them. `ai:index` must run **after** `courses:write`, because it
reads the published course index. Running them out of order produces an artifact that still parses
but describes stale counts — which the tests catch, not the scripts.

## Published-artifact contracts (what the tests hold)

| Artifact | Enforced by |
|---|---|
| `public/generated/courses/**` — byte-for-byte against a fresh build | `scripts/tests/courses.test.mjs` |
| `public/generated/search/index.json` — byte-for-byte | `scripts/tests/searchindex.test.mjs` |
| `public/generated/ai/knowledge.json.gz` — byte-for-byte + document shape | `scripts/tests/ai-index.test.mjs` |
| `public/generated/curriculum/i18n.json` — byte-for-byte against the authored overlay | `scripts/tests/i18n.test.mjs` |
| `public/sitemap.xml` — every route registered, every URL real | `scripts/tests/sitemap.test.mjs` |
| `public/brocode-og.png` — declared size + the `index.html` og/twitter tags | `scripts/tests/sitemap.test.mjs` |
| Everything else under `public/generated/` — read by the app, validated by `curriculum:validate` | `scripts/tests/curriculum.test.cjs` |

A stale artifact therefore fails the suite rather than shipping. If a contract test fails, regenerate
with the `:write` command rather than editing the JSON.

## Cross-reference validation

`npm run course:audit` is the read-only integrity check and re-runs the course generator in dry mode
before checking its own output. Verified clean:

```
source items 14551 · migrated items 14551 · index range 1…36 · index gaps none
unmapped items 0 · unresolved refs 0 · true duplicates 0 · orphan items 0
resolvable ids: bankIds 13865 · playbookIds 476 · notebookIds 5 · sectionIds 29
                trackIds 8 · projects 87 · mocks 99 · questionBanks 29
```

`npm run curriculum:validate` separately holds: 8 tracks present, all `unlocked === true`, no `locked`
state anywhere, topic ids globally unique, every chapter id resolves to a real section, and no orphan
sections.

## Private content must not reach `public/`

`public/generated/` is served to every visitor and ships in `dist/`. Two rules keep private material
out:

1. `content/curriculum/packs/` and `content/questions/expansion/` are authored working material;
   only what a generator deliberately projects into `generated/` becomes public.
2. `ai-index.test.mjs` asserts `index.documents.every((item) => !item.sourceRef.includes('resume-removed'))`
   — removed/private archive records must never re-enter the retrieval corpus.

`content/archive/` (1.8 MB) and `content/questions/expansion/` (746 KB) are the two largest authored
directories and are **not** published directly; they are inputs.

## Known gaps

- `tools/extract.mjs` needs `public/pdf/guide.pdf`, which is not committed (it would ship in `dist/`).
  A full rebuild from the PDF is therefore not reproducible from a clean checkout; steps 2–5 and all
  downstream generators are.
- 20 of 29 sections are not yet restructured into the 16-part topic workspace (`npm run doctor`).
- The generators write `sections.json` with `JSON.stringify` (no indentation), so a diff of that file
  is not human-reviewable. Treat `git diff` on it as a hash change, not a review.
