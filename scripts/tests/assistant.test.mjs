/**
 * Assistant tests — the offline AI that now sits UNDER every notebook.
 *
 * The assistant used to be a Dashboard-only widget that knew nothing about the code in front of the
 * learner: `askLocal(question, sections, state)` received only the question. That is fine for
 * "explain lambda" and useless for the actual moment help is wanted — a cell just raised and the
 * learner is staring at a traceback. Now the card receives an `AssistantContext` (section, the
 * cell's code, the real error), and these tests pin the three behaviours that makes possible:
 *
 *   1. SECTION BIAS — a question asked inside a lesson is answered from that lesson, measurably
 *      more often than the same question asked cold;
 *   2. ERROR GROUNDING — "is galti ko fix karo" quotes the real error kind and the real offending
 *      line, not a generic topic dump;
 *   3. HONESTY — with nothing broken it says so instead of inventing an error, and a question that
 *      matches nothing falls back to the on-screen error rather than "curriculum me nahi mila".
 *
 * Everything runs against the REAL engine and the REAL 29-section curriculum. Zero dependencies:
 * built-in node:test plus the project's TS resolver hook (see `_ts-resolve.mjs`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const { askLocal, quickFix, quickHint } = await load('src/core/ai/assistant.ts');

const raw = JSON.parse(read('public/generated/curriculum/sections.json'));
const all = Array.isArray(raw) ? raw : raw.sections;

/** A fresh learner: nothing attempted, nothing broken. */
const blank = () => ({
  version: 1,
  profile: { name: 'T', goal: 'g', level: 'Beginner', dailyMinutes: 60, onboarded: false },
  xp: 0,
  streak: { current: 0, last: '' },
  attempts: {},
  bookmarks: [],
  mistakes: [],
  review: {},
  interviewAnswers: {},
  defenseAnswers: {},
  savedCode: {},
  settings: { reduceMotion: false },
  activity: {},
  notes: [],
  jobPrep: {},
  readNotifs: [],
});

const NAME_ERROR = "Traceback (most recent call last):\n  File \"<exec>\", line 3, in <module>\nNameError: name 'c' is not defined";
const BROKEN = 'a = 1\nb = 2\nprint(a + c)\n';

/* ------------------------------- section bias ------------------------------ */

test('a question asked inside a lesson is cited from that lesson', () => {
  // Every concept title is a question a learner could plausibly type from inside that lesson —
  // the highest-value case there is: "I am reading about Accessing Values, explain it".
  let matched = 0;
  let biased = 0;
  let cold = 0;
  for (const s of all) {
    for (const c of s.learn?.concepts ?? []) {
      if (!c.title) continue;
      const inSection = (a) => (a.sources[0]?.route ?? '').startsWith(`/lesson/${s.id}/`);
      const withCtx = askLocal(c.title, all, blank(), { sectionId: s.id });
      if (withCtx.confidence <= 0) continue;      // nothing matched at all: not a bias datapoint
      matched++;
      if (inSection(withCtx)) biased++;
      if (inSection(askLocal(c.title, all, blank()))) cold++;
    }
  }
  assert.ok(matched > 100, `expected a real sample, got ${matched} matched probes`);
  // The bias must HELP, not just exist. This is what a flat score bonus failed to do: it was too
  // small to lift a real passage over a real match, and it was blind to how good the match was.
  assert.ok(biased > cold, `section preference did not help: ${biased} biased vs ${cold} cold (of ${matched})`);
  assert.ok(biased / matched >= 0.95, `in-section citations dropped to ${Math.round((biased / matched) * 100)}%`);
  assert.ok(cold / matched <= 0.85, `baseline moved — cold is now ${Math.round((cold / matched) * 100)}%`);
});

test('the rule does not leak — a question from another topic is not answered by this lesson', () => {
  // The failure mode of a blunt "always cite this section": ask about a section's subject while
  // sitting somewhere unrelated. Every one of those was asked at sectionId = a DIFFERENT section
  // (shifted by 7, so it is never a neighbour that shares vocabulary).
  let answered = 0;
  let leaked = 0;
  all.forEach((owner, i) => {
    const other = all[(i + 7) % all.length];
    for (const c of owner.learn?.concepts ?? []) {
      if (!c.title) continue;
      const a = askLocal(c.title, all, blank(), { sectionId: other.id });
      if (a.confidence <= 0) continue;            // nothing matched: not a leak datapoint
      answered++;
      // Citing the lesson we falsely claimed to be in, for a question about a different topic,
      // means the learner reads content that does not answer them.
      if (a.sources[0].route.startsWith(`/lesson/${other.id}/`)) leaked++;
    }
  });
  assert.ok(answered > 100, `expected a real sample, got ${answered}`);
  assert.ok(leaked / answered <= 0.20, `cross-topic leak rose to ${Math.round((leaked / answered) * 100)}% (${leaked}/${answered})`);
});

test('the named case — a Dictionaries heading is cited from Dictionaries', () => {
  // This is what a flat +0.08 bonus could never do: on a cold ask "Accessing Values" lost to s06's
  // prose at 0.44 while its own s12 passage scored ~0.30, and 0.30 + 0.08 still loses.
  const a = askLocal('Accessing Values', all, blank(), { sectionId: 's12' });
  assert.ok(a.sources[0].route.startsWith('/lesson/s12/'), `cited ${a.sources[0].route} while reading s12`);
  assert.ok(a.confidence > 0, 'the promoted passage must be a real match, not a placeholder');
  // The same question with no lesson in context is answered from wherever it matches best — the
  // preference must be a context effect, never a change to retrieval itself.
  const cold = askLocal('Accessing Values', all, blank());
  assert.ok(!cold.sources[0].route.startsWith('/lesson/s12/'));
});

test('the bias is stable — retrieval order still decides genuine ties', () => {
  // Two identical questions in the same section must return the same source. This guards the
  // `sort((a, b) => b.s - a.s || a.i - b.i)` stability clause: an unstable sort would make the
  // citation flicker between equally-scored passages on every keystroke.
  for (const s of all.slice(0, 8)) {
    const a = askLocal('variables aur data types', all, blank(), { sectionId: s.id });
    const b = askLocal('variables aur data types', all, blank(), { sectionId: s.id });
    assert.equal(a.sources[0]?.route, b.sources[0]?.route);
    assert.equal(a.confidence, b.confidence);
  }
});

/* ----------------------------- error grounding ----------------------------- */

test('quickFix quotes the real error kind and the real offending line', () => {
  const ans = quickFix(blank(), all, { sectionId: 's01', where: 's01 · Task 1', code: BROKEN, error: NAME_ERROR });
  assert.equal(ans.kind, 'debug');
  assert.match(ans.text, /NameError/);                 // the kind from the traceback
  assert.match(ans.text, /line 3/i);            // the line number the traceback named
  assert.match(ans.text, /print\(a \+ c\)/);            // sliced out of the learner's own code
  assert.match(ans.text, /s01 · Task 1/);              // it knows which surface this is
  // The citation must be the lesson the learner is in, not a global best guess.
  assert.ok(ans.sources[0].route.startsWith('/lesson/s01/'), `cited ${ans.sources[0].route}`);
});

test('quickFix reports the count of input() calls, so PROGRAM INPUT is actionable', () => {
  const code = 'n = int(input())\nm = int(input())\nprint(n + m)\n';
  const err = "Traceback (most recent call last):\n  File \"<exec>\", line 1, in <module>\nEOFError: EOF when reading a line";
  const ans = quickFix(blank(), all, { code, error: err });
  assert.match(ans.text, /PROGRAM INPUT/);
  assert.match(ans.text, /2×/);                        // exactly how many lines to provide
  assert.match(ans.text, /EOFError/);
});

test('quickFix works on a syntax error too — no traceback line is required', () => {
  const code = 'for i in range(3)\n    print(i)\n';
  const err = "Traceback (most recent call last):\n  File \"<exec>\", line 1\n    for i in range(3)\n                    ^\nSyntaxError: expected ':'";
  const ans = quickFix(blank(), all, { sectionId: 's07', code, error: err });
  assert.equal(ans.kind, 'debug');
  assert.match(ans.text, /SyntaxError/);
  assert.ok(ans.text.length > 80, 'a syntax error must still produce a real explanation');
});

/* -------------------------------- honesty --------------------------------- */

test('with nothing broken it refuses to invent an error', () => {
  const ans = quickFix(blank(), all, { sectionId: 's01', code: 'print("ok")' });
  assert.match(ans.text, /no error/i);
  assert.match(ans.text, /Run/i);                 // and tells you how to get a real one
  // It may NAME error kinds as teaching examples ("Error ka type (NameError, TypeError…) batata
  // hai…"), so the assertion is on the shape of an error REPORT, not on the words: the error path
  // always emits a bolded kind header, a "Kya hua:" line and the learner's offending line. None of
  // those may appear when nothing is broken — that is the difference between teaching and claiming.
  assert.doesNotMatch(ans.text, /\*\*[A-Za-z]+Error\*\*/);
  assert.doesNotMatch(ans.text, /Kya hua:/);
  assert.doesNotMatch(ans.text, /Tumhari line \d/);
});

test('a question that matches nothing answers the on-screen error instead', () => {
  const ctx = { sectionId: 's01', code: BROKEN, error: NAME_ERROR };
  const withErr = askLocal('zzzqqqx nothing matches this', all, blank(), ctx);
  assert.equal(withErr.kind, 'debug');                 // NOT 'fallback'
  assert.match(withErr.text, /NameError/);
  const withoutErr = askLocal('zzzqqqx nothing matches this', all, blank());
  assert.equal(withoutErr.kind, 'fallback');           // still honest when there is no error
});

test('the Dashboard instance is unchanged — no context means the old behaviour', () => {
  const a = askLocal('list vs tuple', all, blank());
  assert.equal(a.kind, 'curriculum');
  assert.ok(a.sources.length > 0 && a.sources[0].route.startsWith('/lesson/'));
  // A context with no error must not hijack a question that the curriculum can answer.
  const b = askLocal('list vs tuple', all, blank(), { sectionId: 's01' });
  assert.equal(b.kind, 'curriculum');
});

/* ----------------------- it is actually mounted everywhere ------------------ */

test('the assistant renders under the notebook engine, so every notebook surface gets it', () => {
  const nb = read('src/components/code/NotebookCells.tsx');
  // Mounted in the ONE shared engine that all notebook surfaces render through
  // (lesson stages, NotebookShelf, NumPy+Pandas Lab, Final Assessment, Notebook Lab).
  assert.match(nb, /<AssistantCard embedded context=\{assistantContext\}/);
  // …and it is fed the live error, cleared when a run succeeds, so it never talks about a bug
  // that has already been fixed.
  assert.match(nb, /setLastError\(res\.ok \? null : \{ code, error:/);
  assert.match(nb, /sectionId, where: where \?\? whereFromSlug\(slug\)/);
});

test('all ten lesson stages show the assistant — including the five with no notebook', () => {
  const lesson = read('src/features/learning/Lesson.tsx');
  for (const stage of ['Interview', 'Logic', 'Practice', 'Defense', 'Checkpoint']) {
    assert.match(lesson, new RegExp(`<AssistantCard context=\\{\\{ sectionId: sec\\.id, where: \`\\$\\{sec\\.id\\} · ${stage}\``), `stage ${stage} has no assistant`);
  }
  // And each stage function that DOES own a notebook must tell the assistant which section it is,
  // otherwise the bias silently degrades to a cold ask.
  const calls = lesson.match(/<JupyterNotebook[\s\S]*?\/>/g) ?? [];
  assert.ok(calls.length >= 5, `expected the lesson's notebook call sites, found ${calls.length}`);
  for (const c of calls) assert.match(c, /sectionId=\{sec\.id\}/);
});

test('JupyterNotebook forwards the section and a human label down to the engine', () => {
  const jn = read('src/components/code/JupyterNotebook.tsx');
  assert.match(jn, /sectionId=\{sectionId\}/);
  assert.match(jn, /const where = \[sectionId, asLabel\(title\)\]\.filter\(Boolean\)\.join\(' · '\)/);
  assert.match(jn, /where=\{where\}/);
  // One clipped label, shared by the engine and by the assistant that now sits at the card's end,
  // so the two can never describe the same place differently.
  assert.match(jn, /context=\{\{ sectionId, where, code: cellError\?\.code, error: cellError\?\.error \}\}/);
});

test('the context label is clipped — a strip, not a paragraph', () => {
  // The idea/practice labs pass whole prompts as their title. Unclipped, the strip rendered
  // `📍 s02 · BMI calculator likho jo weight (kg) aur height (m) se BMI nikaale…` — a sentence
  // inside a one-line affordance. Live, that loop produced 12 of them on the topic workspace.
  const jn = read('src/components/code/JupyterNotebook.tsx');
  assert.match(jn, /const asLabel = \(t\?: string\) => \(t && t\.length > \d+ \?/);
  assert.match(jn, /const where = \[sectionId, asLabel\(title\)\]\.filter\(Boolean\)/);
  assert.doesNotMatch(jn, /where=\{\[sectionId, title\]/, 'an unclipped title still feeds the strip');
});

/* --------------------------------- Give Hint -------------------------------- */

test('Give Hint answers from the surface on screen, not from global progress', () => {
  // The complaint that started this: three different sections returned byte-identical hints, and a
  // Learn stage was told to "Solve a coding task". Measured here against the real engine and the
  // real 29-section curriculum, which is how the bug was found in the first place.
  const state = blank();
  const ids = ['s01', 's05', 's09'];
  const hints = ids.map((id) => quickHint(state, all, { sectionId: id, where: `${id} · Task 1` }).text);
  assert.equal(new Set(hints).size, ids.length, `these sections shared one hint:\n${hints.join('\n---\n')}`);
  for (const text of hints) assert.doesNotMatch(text, /Solve a coding task/i, 'the generic ladder leaked back in');
  // The source must point at the lesson in view, or the learner is sent to read the wrong topic.
  ids.forEach((id, i) => {
    const a = quickHint(state, all, { sectionId: id });
    assert.ok(a.sources[0].route.startsWith(`/lesson/${id}/`), `${id} hint cited ${a.sources[0].route}`);
  });
});

test('asking twice on one surface moves to the next rung instead of repeating', () => {
  const state = blank();
  const ctx = { sectionId: 's03', where: 's03 · Task 2' };
  const rungs = (t) => t.split('\n').filter((l) => /^\d+\./.test(l)).length;
  const first = quickHint(state, all, ctx, 0).text;
  const second = quickHint(state, all, ctx, 1).text;
  const third = quickHint(state, all, ctx, 2).text;
  assert.notEqual(first, second, 'the second ask returned the first ask verbatim');
  assert.ok(rungs(second) > rungs(first), 'the second ask did not reveal another rung');
  assert.ok(rungs(third) >= rungs(second), 'the rungs went backwards');
});

test('with a traceback on screen the hint names the real line, then the fix', () => {
  const state = blank();
  const ctx = { sectionId: 's01', where: 's01 · Task 1', code: BROKEN, error: NAME_ERROR };
  const first = quickHint(state, all, ctx, 0).text;
  assert.match(first, /line 3/i, 'the hint did not name the failing line');
  assert.doesNotMatch(first, /Output\/Errors tab me poora traceback padho/, 'the generic ladder leaked through');
  // `hintLadder` only reveals the fix from the third attempt on — so the third ask differs.
  const third = quickHint(state, all, ctx, 2).text;
  assert.notEqual(first, third, 'the error hint never escalated');
  assert.ok(third.length > first.length, 'the fix rung never appeared by the third ask');
});

test('the hint reads no counter that nothing writes', () => {
  // The old `st:<sid>:hint`.tries read had no writer anywhere in src/, so the ladder was stuck on
  // rung one forever. The surface owns that count now, so the engine must stay a pure read.
  const ast = read('src/core/ai/assistant.ts');
  assert.doesNotMatch(ast, /:hint`\]/, 'the unwritten tries key is back in the engine');
  assert.match(ast, /quickHint\(state, sections, context, asked\)/, 'the typed-hint route drops the context');
  const card = read('src/components/shared/AssistantCard.tsx');
  assert.match(card, /quickHint\(state, sections, activeContext, askedHints\)/, 'the card drops page context or the count');
  assert.match(card, /askLocal\(question, sections, state, contextForIndex\(index\), askedHints, index\)/, 'typed questions lose resolved page context or the rung');
});
