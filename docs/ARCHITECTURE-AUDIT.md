# Architecture audit

An evidence-based record of what was inspected, what was found, and what was changed. Every finding
below cites a file, a command, or a measured number. Findings that could not be reproduced from the
source are labelled as unconfirmed or as a deliberate decision rather than a defect.

Baseline commands and their results are in the "Verification" section at the end.

## Verdict

The architecture is **fundamentally sound and does not need restructuring.** The layer model
(`content/` → generators → `public/generated/` → `src/core/*` pure → store → features) is real,
consistently followed, and machine-enforced. This audit changed **less** than it investigated on
purpose: the leverage is in boundary clarity and automated validation, not in moving files.

Confirmed strengths, each verified rather than assumed:

| Area | Evidence |
|---|---|
| Canonical content ownership is real | `courses.test.mjs` asserts published course files match a fresh build byte-for-byte |
| Pure core is enforced, not hoped for | `engines.test.mjs` sweeps `core/{learning,assessment,ai,platform}` for React and store imports |
| Cross-references all resolve | `npm run course:audit`: 14 551 items, 0 unmapped, 0 unresolved, 0 true duplicates, 0 orphans, index 1…36 no gaps |
| Server authorization is server-side | `requireAdmin()` reads the DB role on every request; role lives in admin-only `app_metadata` |
| Database access is closed by default | RLS enabled + `REVOKE ALL ... FROM anon, authenticated` on both tables |
| Local runtimes are real | Pyodide, sql.js, pdf.js and notebooks are bundled; `sw.js` caches `/generated/` and `/notebooks` |

## Confirmed defects (found and fixed in this work)

### D1 — The AI index leaked bilingual `{ en, hi }` objects into a plain-string field

`content/courses/courses.json` course names became `{ en, hi }`, but `scripts/ai-index.cjs` read
`.name` raw at **5 of 6** sites. Measured on the generator as it stood:

```
courseTitle non-string: 15385     ← 0 before the bilingual change
```

The failure is silent — nothing throws. `[object Object]` reaches the assistant's context line
(`core/ai/context.ts` builds `where` from `course?.title`, and `assistant.ts` prints
`[sectionTitle ?? courseTitle ?? source, title]`), and it **poisons retrieval**, because
`knowledge.ts` tokenizes `courseTitle` when matching a learner's goal.

Compounding it, `validateKnowledgeIndex` checked only six required fields, so an object in
`courseTitle` passed validation and shipped.

**Fix:** conversion moved to the single authored→plain boundary, and course relations now store
**slugs instead of records**, so a call site cannot read `.name` and forget. Two guards added:
`assertPlainStrings` (generator, fails the build) and a much stricter `validateKnowledgeIndex`
(rejects the artifact at load). Regenerated: `public/generated/ai/knowledge.json.gz` now has **0
documents with a non-plain field**.

### D2 — The suite aborted instead of reporting a failure (Node 24 buffer diff)

The byte-for-byte AI-index assertion died with `RangeError: Array buffer allocation failed`. Root
cause proven by measurement: Node 24's `assert.deepEqual` builds an assertion diff that renders **both**
buffers when they differ — **~450 bytes of ArrayBuffers per input byte**, so the two 2.5 MB gzip
buffers allocated **~20 GB** (RSS reached 4359 MB). It also made the suite ~3× slower, because twelve
tests each triggered it.

**Fix:** `Buffer.compare` plus a bounded failure message naming the sizes, the first differing byte and
the fix command. The suite went from 62 s to 19 s.

### D3 — Documented workflow commands did not exist

`scripts/i18n.cjs` and `src/app/i18n/index.tsx` both reference `npm run i18n:check`. Neither it nor
`i18n:report` was registered in `package.json`. Both are now registered and pass.

### D4 — The coverage report silently undercounted

`scripts/i18n.cjs` opened the tracks **index** with a **file** reader, so every field came back
`undefined`, eight files were dropped, and the row still printed a confident total. Extracted to
`scripts/lib/i18n-coverage.cjs` so a test holds it; the tracks row now reads `16 fields in 8 file(s)`.

## Deliberate design choices — investigated, NOT defects

Recording these so they are decisions rather than open questions:

| Observation | Verdict |
|---|---|
| Route knowledge is duplicated five ways (44 `Route`, `NAV`, `PAGES`, `EXTRA_PATHS`, `PATH_ROUTE_ALLOWLIST`) | **Held together by a test** that regex-reads `App.tsx`. Real duplication, but a single registry is a risky refactor with no current failure. Deferred, not missed. |
| `App.tsx` doubles as a shared label/icon module (8 importers) and is 946 lines | Cohesive enough for now; splitting it touches 8 files for no behaviour change. |
| Two modules named `playbook.ts` | **Not duplicates.** One is the pure item contract, the other the fetch/type loader. Merging would push a React-adjacent loader into the purity sweep. |
| `setState` serializes the whole `AppState` synchronously | Measured trade-off (1.18 MB, ~17 ms per write at full bank use), and the saved-answer hook debounces 400 ms for exactly this reason. |
| `Sections.json` is written by five separate scripts | Documented in `docs/CONTENT-PIPELINE.md`. It is an accumulate-and-repair pipeline, not an accident. |
| Two Supabase account stores (`store.mjs` Prisma, `auth-store.mjs` Auth-only) | **One interface, two backends**, chosen at boot by `db-config.mjs`. This is what lets the product work before a Postgres password exists. Not duplication. |
| `sections.json` is committed under `public/generated/` | Deliberate: the extraction step needs the source PDF, which is not committed, so the artifact must be. |
| Monaco is a 4.3 MB chunk | Real and measured, and lazy-loaded. Pre-existing, documented warning; only worth changing against a measured goal. |
| No rate limiting on `presence` / `sign-in-event` | Authenticated and cheap; stated as a deployment task in `docs/SECURITY.md` rather than silently absent. |

## Improvements implemented in this work

1. **Bilingual section names, end to end** (29/29, reviewed Hinglish). Authored overlay
   (`content/curriculum/i18n/sections.json`) → generator (`scripts/i18n-sections.cjs`) → published
   merge (`public/generated/curriculum/i18n.json`) → resolved at the curriculum data boundary
   (`core/learning/section-names.ts` + `core/data/curriculum.tsx`). An overlay id that matches no
   section fails the build instead of silently never rendering.
2. **The AI corpus can no longer carry a localized object**, guarded at generation and at load.
3. **The overlay ledger**, reported separately from the inline `{ en, hi }` counts because it is a
   different shape of evidence — folding them together would compare unlike things to make one
   percentage look better.
4. **Testability of the localize boundary.** The name *rule* lives in `core/learning/section-names.ts`
   with no runtime imports so `npm test` can load it; the *fetching* half lives in `core/data/`. This
   mirrors the existing `core/learning/courses.ts` + `core/data/courses.ts` split and is required by
   the test runner's synchronous module linker.
5. **Documentation** that did not previously exist: `docs/CONTENT-PIPELINE.md` (the verified dependency
   graph), `docs/SECURITY.md` (the verified model, no secret values), `docs/LOCALIZATION-GUIDE.md`
   (authoring rules and measured coverage).

## Second pass — theme, styling and the imported-photo boundary

### D6 — The app opened in DARK mode, and could flash dark before switching

`core/storage/ui.ts` declared `theme: 'dark'` as the product default. Worse, the theme was applied by
`applyTheme()` at module load, which runs *after* the document has painted once — so even a stored
light preference showed a dark frame first. `index.html` also pinned `theme-color` to the dark hex, so
a phone's status bar stayed dark on a light page.

**Fix:** light is the default; the attribute is now written by a tiny inline boot script in `<head>`
that runs before the first paint, and it owns `theme-color`. Existing learners are handled without
touching the stored state shape: a new `aiml:theme:choice` marker distinguishes a real choice from the
old dark implication, so `{theme:'dark'}` with no marker resolves to light while an explicit dark
choice is honoured forever.

### D7 — Every light-theme accent failed WCAG AA, and one failed badly

Measured on the real stylesheet with the WCAG relative-luminance formula. Accents are small bold text
and pills on the page (`#f2f4fa`) and on cards (`#ffffff`):

| Token | Was | On white | On page | Now |
|---|---|---|---|---|
| `--amber` | `#d97706` | 3.19 | 2.87 | `#a55a05` → 5.17 / 4.70 |
| `--green` | `#059669` | 3.77 | 3.39 | `#047e58` → 5.08 / 4.62 |
| `--primary` / `--cyan` | `#0891b2` | 3.68 | 3.31 | `#077894` → 5.09 / 4.63 |
| `--pink` | `#db2777` | 4.60 | 4.13 | `#ce2570` → 5.09 / 4.63 |
| `--red` | `#dc2626` | 4.83 | 4.34 | `#d52525` → 5.10 / 4.63 |
| 7 of 11 `.tone-*` | — | 3.2–4.6 | lower | restated, all ≥ 4.6 on both |

Amber — the "needs attention" colour — was the least readable text in the app. `--blue`, `--violet`
and `--purple` already passed and were deliberately left alone. `scripts/tests/theme.test.mjs` now
computes the ratio from the real CSS and fails the suite below 4.6, so a later "brighter looks nicer"
edit cannot silently undo it.

### D8 — A crafted progress file could inject an unvalidated `profile.avatar`

`importProgress` merged a learner-supplied file into state with `{ ...defaultState(), ...parsed }`, and
the avatar reached `<img src>` unchecked — bypassing the canvas the photo picker uses, with **no size
cap**. Since `setState` rewrites the whole `AppState` to localStorage on every write, an oversized
avatar could push the state past the quota and make **progress stop saving**. Full analysis in
`docs/SECURITY.md`; `core/platform/avatar.ts` now owns the rule and applies it at both entry points.

### D9 — Inverted `aria-pressed` on the theme toggle

`aria-pressed={prefs.theme === 'light'}` described the *current* theme as a pressed state while the
button's label announced the *action* — so a screen reader heard "pressed" in one theme and "not
pressed" in the other for the same control. Removed, with the reasoning recorded in place so it is not
re-added.

### Dependency advisories — recorded, not forced

`npm audit --omit=dev`: 8 advisories, none exploitable in this app, every fix a breaking major. The
reasons and the recommended upgrade order are in `docs/SECURITY.md`.

## Verification

All commands run in `D:\project\BroCode` on Windows, Node v24.21.0.

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm test` | **475 tests, 475 pass, 0 fail** (baseline before all of this work: 450 pass / 3 fail of 453) |
| `npm run build` | exit 0, `✓ built in 1m 34s`; only the pre-existing Monaco >1500 kB warning |
| `npm run i18n:check` | 402 keys in both packs, no empty strings, every `{placeholder}` survives |
| `npm run i18n:report` | 11/67 inline bilingual + 29/29 section names |
| `npm run i18n:sections` | 29/29, every id resolves, every section has an English fallback |
| `npm run course:audit` | 14551 items, 0 unmapped / unresolved / orphan / duplicate |
| `npm run curriculum:validate` | 8 tracks, all unlocked, topic ids unique, no orphan sections |
| `npm run doctor` | environment ready |
| `scripts/{courses,guides,packs,notebooks,sitemap,searchindex,ai-index}` dry runs | all clean, no drift |
| `npm audit --omit=dev` | 8 advisories (4 moderate, 4 high) — analysed and recorded, none reachable |
| Secret scan of `dist/` and `src/` | clean; `.env` untracked; no `dist/.env` |
| Boot script + `theme-color` in `dist/index.html` | present; `theme-color` is the light page colour |

## Test-count note

`AGENTS.md` stated 410 tests; the measured count is **475** (453 at the start of this work, plus the
localization and theme/avatar test files). The `AGENTS.md` figure — and now its timing figure — has
been corrected to the measured value. Test files added here: `scripts/tests/i18n.test.mjs` (12) and
`scripts/tests/theme.test.mjs` (8).
