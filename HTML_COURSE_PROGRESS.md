# HTML Mastery — build ledger

The HTML course ships through the same pipeline as C++, NumPy and Pandas:

```
content/html-mastery/**.json   authored source (the only place content is edited)
scripts/html-course.cjs        validates + projects the ten sections
public/generated/html-course/index.json   published artifact (generated; never hand-edited)
src/core/learning/htmlcourse.ts           pure rules, own `htmlmod:` storage family
src/core/data/htmlcourse.ts               loader for the artifact
src/features/html-mastery/                page, official HTML5 mark, sandboxed playground
```

Growth layers live in `deepening-*.json` and merge into a module by id, so a module grows without
rewriting the file it lives in.

## Published counts (counted from the artifact, 2026-11-14)

| Section | Base | + layer 1 | + layer 2 |
| --- | ---: | ---: | ---: |
| Learn | 60 | 60 | 60 |
| Interview | 100 | 160 | 160 |
| Coding Lab | 20 | 60 | **100** |
| Logic | 60 | 60 | 60 |
| Debug | 40 | 80 | **100** |
| Practice Solutions | 60 | 60 | 60 |
| Mini Project | 20 | 20 | 20 |
| Project Lab | 20 | 20 | 20 |
| Defense | 40 | 40 | 40 |
| Checkpoint | 236 | 236 | 236 |
| **Total** | **656** | **796** | **856** |

20 modules, 42–45 records each. Difficulty split: 269 easy, 366 medium, 221 hard.

Question-bank categories (an item can count in more than one, so these do not sum to 856):
concept 140, output 280, quiz 160, written 60, coding **100**, debug **100**, project 40.

Quiz composition: 40 authored MCQs, 60 true/false, 60 fill-in-the-blank, plus topic prediction
checkpoints. Written checkpoints carry a three-line self-assessment rubric.

Layer additions per module:
- `deepening-1a/1b`: 2 coding labs, 2 debug challenges, 3 interview questions.
- `deepening-2a/2b`: 2 coding labs, 1 debug challenge.

## What was actually verified

- `node scripts/html-course.cjs` (dry run) and `--write`: 20 modules, 856 entries, no duplicate ids,
  no duplicate question text inside a section or across modules, no empty section, every MCQ answer
  is one of its four options.
- `node .freebuff/audit-html-course.cjs`: **0 errors**, 36 intentional warnings (one-line debug fixes
  and the html20 page-plan snippet). Every task solution is a complete document with doctype, lang,
  charset, title and a balanced body.
- `npm run typecheck` clean; `npm test` **1089 pass / 0 fail**; `npm run build` succeeds.
- `/html` and `/generated/html-course/index.json` return 200 on the dev server.
- Playground preview is a sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`), so
  learner markup cannot read app storage/cookies or navigate the parent page.

**Not executed:** HTML has no compiler here. Every recorded `output`/`expected` is authored from the
markup in the lesson and reviewed by inspection, not produced by a compiler or headless browser run.
The C++ ledger's "compiled with g++" guarantee does **not** apply to this course. The playground is
the execution path for learners. An in-browser run of the app could not be completed in this
workspace: the preview is signed out, the account service was unavailable, and Playwright document
injection timed out.

## Wiring

- Route `/html` (protected, lazy) and `/html?module=htmlNN&section=...`.
- Course card in `/courses`, rendered before the CSS and JavaScript cards.
- `PATH_ROUTE_ALLOWLIST` entry so the path-coverage test stays honest.
- `npm run html-course` / `html-course:write`.
- Own keys: `htmlmod:<module>:<section>`, `htmlans:<entry>` drafts, `htmllast` resume point.
- Course page order: hero → modules and search → playground → bank → progress → outcomes. Every
  module opens at the top; module records render above the module playground.
- The assistant card that sat under the playground was removed on request; the module surfaces hold
  no tutor card, and the global assistant is reachable from its own page.

## Gaps against the full brief — honest list

1. **Coding labs: 100 shipped, 150 requested.** Five per module; 50 short.
2. **Debug: 100 shipped — target met.** Logic is 60 of the 100 requested.
3. **Interview: 160 shipped**, past the "at least 100" target. Each card still carries one answer,
   not the full nine-field interview card.
4. **Projects: 20 mini projects + 20 labs shipped, the 15 curated projects and the capstone rubric
   are not.** Module 20 teaches the capstone structure but no separate graded rubric page exists.
5. **Playground** covers editor, Run, Reset, Copy, Example, Clear, full-screen, responsive widths and
   per-module drafts. It does not compare learner output against a lab's expected result, and it has
   no HTML-specific starter templates beyond the default document and the semantic example.
6. **AI/voice tutor**: no assistant card is embedded in the HTML course surfaces, so the playground
   does not send its document to a tutor. There are no HTML-specific tutor prompts.
7. **Admin**: no new admin surface. The course is a generated artifact like C++ and is not editable
   from the Owner Control Center; content changes go through `content/html-mastery/` + the generator.

## Next growth (in order)

1. `deepening-3.json`: 50 more labs (→ 150) and 40 more logic questions (→ 100).
2. `deepening-4.json`: the 15 curated projects with requirements, starter, rubric and reference
   solution, surfaced as a Projects tab on the course page.
3. Playground: per-lab expected-output comparison and lab starter templates.
