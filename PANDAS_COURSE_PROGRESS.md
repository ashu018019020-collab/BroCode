# Pandas Mastery — implementation progress

Honest ledger for the Pandas course. Counts are **records that shipped**, not targets.

## Shipped

| Measure | Value |
|---|---|
| Course page | `/pandas` (own route, `Protect`-wrapped, in the sitemap) |
| Course card | `/courses` grid, own panda mark, beside NumPy Mastery |
| Modules | 20 (`p01`…`p20`), ten learning sections each |
| Published entries | **1,880** |
| Authored topics | 180, every code sample executed against pandas 3.0.5 |
| Debug challenges | 160 (broken sample + real error/wrong output + executed fix) |
| Independent coding tasks | 140 (expected output executed) |
| Interview bank | 100 authored Q&A beside 180 verified-output questions |
| Defense bank | 40 authored Q&A with steps |
| Authored MCQs | 135 (four options each, answer one of them) |
| Mini projects / Project Labs | 20 / 20 |

Published section counts: Learn 180, Interview 260, Coding Lab 140, Logic 180, Debug 160,
Practice Solutions 180, Mini Project 20, Project Lab 20, Defense 40, Checkpoint 700.

Per module: Learn 9 · Interview 13 · Coding Lab 7 · Logic 9 · Debug 8 · Practice 9 ·
Mini 1 · Lab 1 · Defense 2 · Checkpoint 34–36 (95 entries in p01–p10, 93 in p11–p20).

## Growth layer (deepening-1…4.json)

The question bank grows through authored layers instead of rewriting the module files, the same way
the NumPy course grows: `deepening-*.json` is an object keyed by module id, and the generator merges
its topics, debug challenges, coding tasks, interview items and `mcq` bank into the matching module.

| Layer | Modules | Adds per module |
|---|---|---|
| `deepening-1.json` | p01–p05 | 4 topics, 2 tasks, 2 debug, 2 interview, 8 MCQs |
| `deepening-2.json` | p06–p10 | 4 topics, 2 tasks, 2 debug, 2 interview, 7 MCQs |
| `deepening-3.json` | p11–p15 | 4 topics, 2 tasks, 2 debug, 2 interview, 6 MCQs |
| `deepening-4.json` | p16–p20 | 4 topics, 2 tasks, 2 debug, 2 interview, 6 MCQs |
| `deepening-5.json` | p01–p05 | 4 coding tasks, 4 debug challenges |
| `deepening-6.json` | p06–p10 | 4 coding tasks, 4 debug challenges |
| `deepening-7.json` | p11–p15 | 4 coding tasks, 4 debug challenges |
| `deepening-8.json` | p16–p20 | 4 coding tasks, 4 debug challenges |

Every added topic, task solution, debug fix and broken sample is executed by
`scripts/pandas-fill-outputs.cjs`, which now reads both shapes (a module array and an id-keyed
layer). A debug entry is accepted only when the broken code raises, or when it prints the wrong
result, declares that wrong output in `error`, and the fix prints something different. The published
MCQs carry `format: "mcq"` so the checkpoint validator checks them against four options instead of
the three-output quiz shape.

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

1. **Question volume is still below the brief's 50-per-section target.** The brief asks for 7,000+
   bank items; this build ships 1,880 (94 per module), up from 970 and then 1,720. No section reaches
   50: Learn 9, Interview 13, Coding 7, Logic 9, Debug 8, Practice 9, Defense 2, Checkpoint 34–36.
   Coding Lab and Debug were the target of the last two layers and now stand at 7 and 8 of 50, so
   roughly 43 tasks and 42 challenges per module (about 1,700 items) are still missing. They were not
   filled in this pass; the artifact's `stats.targetPerSection` records the target so the shortfall
   stays visible rather than being rounded away.
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

After the growth layers: `pandas-fill-outputs` executed 180 topics, 160 debug fixes and 140 task
solutions; `pandas-course --write` published 1,880 entries; the same three gates passed again
(1089 tests, 0 fail). The filler now accepts file arguments so a two-layer re-run fits the command
timeout instead of re-executing the whole course.
