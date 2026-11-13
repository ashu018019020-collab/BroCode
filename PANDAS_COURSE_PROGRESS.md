# Pandas Mastery — implementation progress

Honest ledger for the Pandas course. Counts are **records that shipped**, not targets.

## Shipped

| Measure | Value |
|---|---|
| Course page | `/pandas` (own route, `Protect`-wrapped, in the sitemap) |
| Course card | `/courses` grid, own panda mark, beside NumPy Mastery |
| Modules | 20 (`p01`…`p20`), ten learning sections each |
| Published entries | **970** |
| Authored topics | 100, every code sample executed against pandas 3.0.5 |
| Debug challenges | 40 (broken sample + real error/wrong output + executed fix) |
| Independent coding tasks | 20 (one per module, expected output executed) |
| Interview bank | 40 authored Q&A beside 100 verified-output questions |
| Defense bank | 40 authored Q&A with steps |
| Mini projects / Project Labs | 20 / 20 |

Published section counts: Learn 100, Interview 140, Coding Lab 20, Logic 100, Debug 40,
Practice Solutions 100, Mini Project 20, Project Lab 20, Defense 40, Checkpoint 390.

## Architecture (same as NumPy Mastery, separate records)

- `content/pandas-mastery/` is the only authored source: `course.json` + `modules-*.json`.
- `scripts/pandas-fill-outputs.cjs` executes every topic sample, every debug fix and every task
  solution, and stores what Python actually printed (topics, `fixedOutput`, `expected`). A topic
  whose code raises is a failure, not an empty card.
- `scripts/pandas-course.cjs` validates the source and publishes ONE artifact,
  `public/generated/pandas-course/index.json`; `--write` publishes, the default is a dry run.
- `src/core/learning/pcourse.ts` owns the rules (`pmod:<module>:<section>` progress, report, search);
  `src/core/data/pcourse.ts` is the loader; `src/features/pandas-mastery/` holds the page and the mark.
- The NumPy course's `nmod:` family is never touched, so a Pandas module can never complete a NumPy
  module with the same number.

## Regenerating

```
node scripts/pandas-fill-outputs.cjs   # re-execute the samples → outputs
npm run pandas-course:write            # validate + publish the artifact
npm run pandas-course                  # dry run only
```

`sitemap:write` is required after adding the route (done); `ai:index:write` is not yet wired to this
course — the assistant index still covers NumPy only.

## Not done (stated, not hidden)

1. **Question volume is below the brief's 50-per-section target.** The brief asks for 7,000+
   question-bank items; this build ships 970 total (~49 per module), and the course page prints that
   shortfall from the artifact rather than claiming a target.
2. **No BroCode-specific datasets are wired.** The examples use small synthetic tables shaped like
   BroCode records (courses, lessons, attempts); no production table or private row is read, and no
   data inventory was possible without the database credentials.
3. **The AI Tutor and Voice Tutor do not know this course yet.** They still resolve NumPy context.
4. **The playground does not preload the Pandas datasets**; the course snippets are runnable in the
   existing Lab by pasting them.
5. **No pandas tests exist yet.** The generator validates the artifact; the suite has no per-course
   test for Pandas (the NumPy course has nine).

## Verification

`npm run typecheck` clean · `npm test` 1083 pass, 6 skipped, 0 fail · `npm run build` ok
(`PCoursePage-*.js` emitted) · dev server serves `/generated/pandas-course/index.json`.
