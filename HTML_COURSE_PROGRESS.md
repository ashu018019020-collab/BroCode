# HTML Mastery — build ledger

The HTML course shipped through the same pipeline as C++, NumPy and Pandas:

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

| Section | Layer 1 | With deepening-1 | Section | Layer 1 | With deepening-1 |
| --- | ---: | ---: | --- | ---: | ---: |
| Learn | 60 | 60 | Practice Solutions | 60 | 60 |
| Interview | 100 | **160** | Mini Project | 20 | 20 |
| Coding Lab | 20 | **60** | Project Lab | 20 | 20 |
| Logic | 60 | 60 | Defense | 40 | 40 |
| Debug | 40 | **80** | Checkpoint | 236 | 236 |
| **Total** | **656** | **796** | | | |

20 modules, 39–42 records each. Difficulty split: 249 easy, 326 medium, 221 hard.

Question-bank categories (an item can count in more than one, so these do not sum to 796):
concept 140, output 280, quiz 160, written 60, coding 60, debug 80, project 40.

Quiz composition: 40 authored MCQs, 60 true/false, 60 fill-in-the-blank, plus topic prediction
checkpoints. Written checkpoints carry a three-line self-assessment rubric.

`deepening-1a.json` / `deepening-1b.json` add, for every module: 2 independent coding labs, 2 debug
challenges (broken + fixed markup), and 3 interview questions. That is 40 labs, 40 debug pairs and
60 interview answers.

## What was actually verified

- `node scripts/html-course.cjs` (dry run) and `--write`: 20 modules, 796 entries, no duplicate ids,
  no duplicate question text inside a section, no empty section, every MCQ answer is one of its four
  options, every coding task and debug fix carries an output.
- `npm run typecheck`: clean.
- `npm test`: 1089 pass, 0 fail (includes the one-h1 page contract and the route/path coverage test).
- `npm run build`: succeeds; `/html` and `/generated/html-course/index.json` return 200 on the dev server.
- Playground preview is a sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`), so
  learner markup cannot read app storage/cookies or navigate the parent page.

**Not executed:** HTML has no compiler here. Every recorded `output`/`expected` is authored from the
markup in the lesson and reviewed by inspection, not produced by a compiler or headless browser run.
The C++ ledger's "compiled with g++" guarantee does **not** apply to this course. The playground is
the execution path for learners.

## Wiring

- Route `/html` (protected, lazy) and `/html?module=htmlNN&section=...`.
- Course card in `/courses`, rendered before the CSS and JavaScript cards.
- `PATH_ROUTE_ALLOWLIST` entry so the path-coverage test stays honest.
- `npm run html-course` / `html-course:write`.
- Own keys: `htmlmod:<module>:<section>`, `htmlans:<entry>` drafts, `htmllast` resume point.
- The course page is standalone: the assistant card that sat under the playground was removed on
  request, and the module records render above the module playground.

## Gaps against the full brief — honest list

1. **Coding labs: 60 shipped, 150 requested.** Three per module now; still 90 short.
2. **Debug/Logic: 80 + 60 shipped, 100 + 100 requested.**
3. **Interview: 160 shipped**, past the "at least 100" target. The authored cards still carry one
   answer each, not the full nine-field interview card.
4. **Projects: 20 mini projects + 20 labs shipped, the 15 curated projects and the capstone rubric
   are not.** Module 20 teaches the capstone structure but no separate graded rubric page exists.
5. **Playground** covers editor, Run, Reset, Copy, Example, Clear, full-screen, responsive widths and
   per-module drafts. It does not compare learner output against a lab's expected result, and it has
   no HTML-specific starter templates beyond the default document and the semantic example.
6. **AI/voice tutor**: no assistant card is embedded in the HTML course surfaces (removed on
   request), so the playground does not send its document to a tutor. There are no HTML-specific
   tutor prompts; the global assistant is reachable from its own page.
7. **Admin**: no new admin surface. The course is a generated artifact like C++ and is not editable
   from the Owner Control Center; content changes go through `content/html-mastery/` + the generator.

## Next growth (in order)

1. `deepening-2.json`: 2 more labs and 1 more debug pair per module (→ 100 labs, 100 debug), plus
   1 more interview question per module (→ 180 interview).
2. `deepening-3.json`: further labs toward 150 and a second logic pass toward 100.
3. `deepening-4.json`: the 15 curated projects with requirements, starter, rubric and reference
   solution, surfaced as a Projects tab on the course page.
4. Playground: per-lab expected-output comparison and lab starter templates.
