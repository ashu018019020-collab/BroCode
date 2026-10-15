# Localization guide

How English and Hinglish work in BroCode: the model, the authoring rules, where the language is
applied, and the exact coverage that exists today. Every number below was produced by
`npm run i18n:report` and `npm run i18n:sections` against the current repository.

## The two languages

- **English** — simple, correct, beginner-friendly.
- **Hinglish** — natural Hindi in **Roman script**, mixed with the standard English technical
  vocabulary (`function`, `loop`, `dictionary`, `API`, `train`). **Never Devanagari.** Code, imports,
  commands, file paths, API fields, database column names and expected program output are never
  translated.

The locale ids are `en` and `hi`. `hi` means Hinglish, not Hindi. `hinglish` is a **legacy** stored id
that is still read (and normalised to `hi`), so a learner who chose a language before the rename keeps
it.

## The content model — both forms are legal at once, forever

A translatable authored field is **either**:

- a **plain value** — not translated yet, or genuinely language-neutral (`"Python"`, a code sample, an
  id); or
- an **`{ en, hi }` map** — both languages authored, the reader picks.

`src/core/data/localize.ts` owns the resolver and the states:

| State | Meaning |
|---|---|
| `full` | a map with both sides non-empty |
| `partial` | a map with one side empty — **an empty string counts as MISSING**, so `hi: ''` shows English rather than a blank line |
| `plain` | a single value: not translated yet, or language-neutral |
| `missing` | absent or empty |

Keeping both forms legal is what makes a **batched** migration safe: a field with no Hinglish yet
shows the English it always had, so there is never a half-translated screen and never a flag day.

## Where the language is applied — the load-bearing rule

**Once, at the data boundary.** A component never receives an `{ en, hi }` map and never compares
language codes.

| Content | Boundary | What a component sees |
|---|---|---|
| Course names | `src/core/data/courses.ts` (`resolveCard`, `resolveFile`) | plain `CourseCard.name` |
| Section names | `src/core/data/curriculum.tsx` + `core/learning/section-names.ts` | plain `Section.title` |
| UI strings | `src/app/i18n/index.tsx` (`t()`) | a resolved string |

Why it matters: the raw JSON stays cached and language-independent, so switching language does **not**
re-fetch or re-parse the 1.5 MB course file or the 1 MB curriculum. Only the resolved values are
re-derived, in a `useMemo`.

`LanguageToggle` calls `setLang`, which swaps packs in place — it never navigates and never resets the
lesson, the scroll position, the answers on screen, or any accumulated progress.

## Adding a UI string

1. Add the key to **both** packs in `src/app/i18n/locales.ts` (`en` and `hinglish`).
2. Keep every `{placeholder}` on both sides — `npm run i18n:check` fails if one is dropped, because a
   translation without its `{n}` renders a sentence with a hole in it.
3. Run `npm run i18n:check`.

Missing keys are never hidden: in development the app warns once per key and falls back to English, so
a developer finds out immediately instead of a learner finding a raw `fallback.nav.courses`.

## Adding a Hinglish content name

### Course name
Edit `content/courses/courses.json` — `name` becomes `{ "en": "...", "hi": "..." }`, then
`npm run courses:write`. `scripts/courses.cjs` publishes it and `src/core/data/courses.ts` resolves it.

### Section name
Section titles are the **exception**, and the reason is documented in `docs/CONTENT-PIPELINE.md`:
`sections.json` is extracted from the PDF and then repaired in place by four scripts, so a translation
written into it survives only until the next extraction. Section names therefore live in an authored
overlay:

1. Edit `content/curriculum/i18n/sections.json` — `"s01": "Variables aur Data Types"`.
2. Run `npm run i18n:sections:write`.
3. The app fetches `generated/curriculum/i18n.json` and resolves it at the curriculum data boundary.

The generator fails if an id matches no section (a typo that could never render) or is blank. English
titles, ids and ordering are never changed by the overlay, and a section with no entry simply keeps
its English title.

## Translation-coverage report

```bash
npm run i18n:check     # locale packs: key parity, empty strings, {placeholder} survival
npm run i18n:report    # content coverage per authored source, plus the overlay ledger
npm run i18n:sections  # dry run of the section-name overlay; :write publishes
```

Coverage numbers are owned by `scripts/lib/i18n-coverage.cjs` and `scripts/lib/i18n-sections.cjs` so
tests can hold them — a report that can be wrong about its own denominator is worse than no report.

## Coverage today (measured, not estimated)

| Surface | Coverage |
|---|---|
| UI keys (`src/app/i18n/locales.ts`) | **402 keys × 2 languages — 100%**, no empty strings, every `{placeholder}` survives |
| Course names | **11/11 — 100%** bilingual `{ en, hi }` |
| Course descriptions | 0/11 — not translated yet |
| Section names | **29/29 — 100%** via the authored overlay |
| Track titles + descriptions | **0/16 — not translated yet** |
| Section content (concepts, prose, questions, projects) | **not translated** — see below |
| Question banks (13 865 questions), playbook (476 items), notebooks, curriculum packs | **not translated** |

The report prints this as `11/67 authored fields carry both languages inline` plus
`29/29 section names have a reviewed Hinglish name`. Both lines are true and neither is a claim about
the other.

### The honest size of what remains

29 section names are not the curriculum. The generated `sections.json` is ~1 MB and its translatable
prose spans, per section: concepts (`title`, `body`, `tip` and the `guide` teaching layer), recap,
practice, interview Q&A, coding tasks, logic cards, solved examples, the mini project, project tiers
and checkpoints — plus the 16-part topic packs and 13 865 bank questions. That is on the order of
10⁵ strings.

**No runtime machine translation is used, and none should be.** A translated lesson carries the same
contract as an authored one: code must still run, expected output must still be correct, and
assessment answers must still be right. Translating it is an authoring project, done in reviewed
batches — which is exactly what the `plain` / `partial` / `full` model is built to support.

### Recommended next batches (in value order)

1. **Track titles and descriptions** (16 fields) — highest visibility per string, and the ledger
   already counts them. Needs a small coercion fix in `guides.cjs` / `curriculum.cjs` / `questions.cjs`
   / `ai-index.cjs`, which print track titles.
2. **Course descriptions** (11 fields) — already modelled and resolved at the boundary; pure authoring.
3. **Section-level prose, section by section**, starting with `s01`–`s08` (Python Core), through the
   packs and guides that already exist.
4. **Bank questions**, by section, through `content/questions/expansion/`.
5. **AI retrieval in both languages** — the index stores one canonical plain string per field (English),
   so a Hinglish query matches poorly today. This is an architecture change, not a translation task.

## What must never change during translation

- `id` values, section numbers, `ref` targets, ordering.
- Code syntax, imports, identifiers, commands, file paths, API endpoints, DB field names.
- Expected program output, rubric keywords, and assessment answer correctness.
- The `{placeholder}` names inside UI strings.
