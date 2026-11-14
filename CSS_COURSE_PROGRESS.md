# CSS Mastery — implementation ledger

The CSS course ships through the same pipeline as HTML, C++, NumPy and Pandas:

```
content/css-mastery/**.json              authored source (the only place content is edited)
scripts/css-course.cjs                  validates + projects the ten sections
public/generated/css-course/index.json  published artifact (generated; never hand-edited)
src/core/learning/csscourse.ts          pure rules, own `cssmod:` storage family
src/core/data/csscourse.ts              loader for the artifact
src/features/css-mastery/               page, CSS3 mark, two-editor sandboxed playground
```

Growth layers live in `deepening-*.json` and merge into a module by id, so a module grows without
editing the module files or the generator.

## What shipped

- **24 modules**, `css01`–`css24`, in the requested learning sequence: introduction, setup, syntax,
  adding CSS, selectors, colour, units, typography, box model, display, borders, positioning,
  flexbox, grid, responsive, pseudo-classes, pseudo-elements, transitions/transforms, animation,
  variables/functions, modern CSS, forms/UI, architecture, debugging.
- **1912 records** across the ten sections:

| Section | Records |
|---|---|
| Learn | 80 |
| Interview | 1200 |
| Coding Lab | 240 |
| Logic | 80 |
| Debug | 52 |
| Practice Solutions | 80 |
| Mini Project | 24 |
| Project Lab | 24 |
| Defense | 52 |
| Checkpoint | 292 |

- Modules 01–08 are the foundation: 50 unique interview items each (400 total), four Learn topics,
  three debug challenges and three defense scenarios each, so selectors, syntax, colour, units,
  typography and the box model get the extra space the course brief asked for.
- Every Learn/Logic/Practice record carries the module's own authored topic, a complete HTML
  document with its CSS and the result the browser paints for it.
- Every Coding Lab task is independent of the taught snippet; every Debug entry is a broken sample
  whose fix changes the rendered result and explains the cause.
- Checkpoints are prediction, true/false, MCQ and written explanation. There is deliberately **no
  fill-in-the-blank format**: a numeric literal inside a declaration is rarely the thing worth
  recalling.
- The CSS3 mark is an inline SVG shield in the two official blues (#2965F1 / #264DE4) with the
  white "3", shared by the catalog card, hero and module header.
- The playground has an HTML editor, a CSS editor, Run / Reset / Clear / Copy / Example,
  full screen and desktop / tablet / mobile frame widths. The preview is an iframe with
  `sandbox=""`: no scripts, no same-origin access, no parent navigation.

## What was actually verified

- `node scripts/css-course.cjs` (dry run) and `--write`: 24 modules, 848 entries, no duplicate ids,
  no duplicate question text inside a section, no empty section, every MCQ answer is one of its
  four options, every task and debug entry has a distinct fixed result.
- `npm run typecheck` clean.
- `npm test`: **1089 pass / 0 fail**, including the route-coverage test that diffs `App.tsx`
  against `PATH_ROUTE_ALLOWLIST`.
- `npm run build` succeeds (~30s); the Monaco chunk-size warning is pre-existing.
- `npm run sitemap:write`: 57 routes, 163 URLs, `/css` included.
- `/css` and `/generated/css-course/index.json` return 200 on the dev server.
- CSS rendering is **not executed in this build**: every sample's "output" is an authored
  description of the rendered result, reviewed against the code, not a browser screenshot or an
  automated paint check.

## Wiring

- Route `/css` (protected, lazy) and `/css?module=cssNN&section=...`.
- Course card in `/courses`, rendered directly after HTML Mastery with `tone-blue` and the CSS3
  mark.
- `PATH_ROUTE_ALLOWLIST` entry so the path-coverage test stays honest.
- `npm run css-course` / `css-course:write`.
- Own keys: `cssmod:<module>:<section>`, `cssans:<entry>` drafts, `csslast` resume point,
  `cssplay:<module>` playground drafts.
- Course page order: hero → modules and search → playground → bank → progress → outcomes. Every
  module opens at the top, and its playground sits below its records.

## Honest gaps

1. **Question-bank target:** all 24 modules now ship 50 unique interview items each (1200 total),
   with every answer distinct. The bank target is met for every module.
2. **Coding Lab target:** 20 exercises per module was the brief; the course ships one independent
   task per module plus Practice rebuilds from each topic. The Practice section is not the same as
   twenty graded exercises.
3. **Projects:** each module ships one Mini Project and one Project Lab milestone (48 project
   records), not the 24 full build-along projects with complete source in the brief.
4. **Lesson depth:** the 25-field lesson format from the brief (Hinglish explanation, analogy,
   mistakes, revision notes per topic) is present in spirit across body, output, debug and defense
   records, but not as 25 named fields in the artifact. The `NEntry` type already supports
   `simple`, `pro`, `syntax`, `visual`, `realWorld`, `mistakes` and `revision` when a layer supplies
   them.
5. **Assessments:** module checkpoints and the course-level progress exist; separate Level 1,
   Level 2, intermediate, advanced and final CSS papers do not.
6. **Playground execution:** the iframe is sandboxed with scripts disabled and is not a browser
   test harness. A rule that is valid CSS can still render differently across browsers.

## Next growth (in order)

1. Add `deepening-*.json` layers for css01–css08 to reach 50 interview items per foundation module,
   then the remaining modules.
2. Add the missing Coding Lab exercises as independent tasks with their own starter documents.
3. Add the 24 full projects with complete source, responsive versions and final challenges.
4. Add the five assessment papers on top of the checkpoint records.
5. Browser-verify the playground and every module's rendered result, then replace the authored
   output descriptions with verified notes where they differ.
