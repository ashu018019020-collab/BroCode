/**
 * The mentor's teaching turn — `src/core/ai/mentor.ts`.
 *
 * What these tests protect, because each is a promise the UI makes to a learner:
 *
 *   1. A retrieved passage is RESHAPED, never rewritten: the title is not read as the explanation,
 *      and a missing reason/example becomes an explicit refusal, not invented content.
 *   2. "samjha nahi" / a repeated ask gets the short version, not the same wall of text again.
 *   3. A greeting may name the page it was asked from, and must not invent one when there is none.
 *   4. The spoken form never reads a route aloud, and no turn ever claims code was run or tested.
 *
 * Zero dependencies: node:test plus the project's TS resolver hook.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const mentor = await load('src/core/ai/mentor.ts');

const squash = (s) => String(s).replace(/\s+/g, ' ').trim();

/** A realistic retrieved passage: bold title, body, a causal paragraph, a fence, a real source. */
const answer = {
  text: [
    '**Lists**',
    '',
    'A list is an ordered collection you can change. It keeps items in the order you add them.',
    '',
    'It matters because order is often the whole point of the data, since an index lets you fetch one item directly.',
    '',
    'For example, you can append a score and read it back by position:',
    '',
    '```python',
    'scores = [10, 20]',
    'scores.append(30)',
    'print(scores[1])',
    '```',
  ].join('\n'),
  sources: [{ title: 'Python basics', route: '/lesson/s04/learn' }],
  confidence: 0.8,
  kind: 'curriculum',
};

/* --------------------------------- intents --------------------------------- */

test('mentor: the intent is what the learner is asking FOR, not the topic', () => {
  assert.equal(mentor.classifyMentorIntent('Hi'), 'greeting');
  assert.equal(mentor.classifyMentorIntent('namaste mentor'), 'greeting');
  assert.equal(mentor.classifyMentorIntent('thanks!'), 'thanks');
  assert.equal(mentor.classifyMentorIntent('shukriya'), 'thanks');
  assert.equal(mentor.classifyMentorIntent('repeat that'), 'repeat');
  assert.equal(mentor.classifyMentorIntent('samajh nahi aaya'), 'repeat');
  assert.equal(mentor.classifyMentorIntent('explain in simple words'), 'simpler');
  assert.equal(mentor.classifyMentorIntent('give me an example'), 'example');
  assert.equal(mentor.classifyMentorIntent('why does this work?'), 'why');
  assert.equal(mentor.classifyMentorIntent('just give me a hint'), 'hint');
  assert.equal(mentor.classifyMentorIntent('what next?'), 'next');
  assert.equal(mentor.classifyMentorIntent('test me on loops'), 'practice');
  assert.equal(mentor.classifyMentorIntent('what is a list'), 'explain');
  assert.equal(mentor.classifyMentorIntent('   '), 'unknown');
});

/* ------------------------------ teaching blocks ----------------------------- */

test('mentor: blocks come from the passage, and the bold title is not the explanation', () => {
  const blocks = mentor.teachingBlocks(answer, 'en-IN');
  assert.deepEqual(blocks.map((block) => block.kind), ['simple', 'why', 'example', 'where']);

  const simple = blocks[0].text;
  assert.match(simple, /ordered collection/, 'the plain idea is the first body paragraph');
  assert.doesNotMatch(simple, /^Lists\b/, 'the title must not be read aloud as the explanation');

  assert.equal(blocks[2].code, true, 'a fenced block is the example');
  assert.equal(blocks[2].text, 'scores = [10, 20]\nscores.append(30)\nprint(scores[1])');
  assert.equal(blocks[3].text, 'Python basics (/lesson/s04/learn)', 'the source is named with its route');
});

test('mentor: a passage with no reason or example produces refusals, never invented content', () => {
  const bare = {
    text: '**Tuples**\n\nA tuple is an ordered collection you cannot change.',
    sources: [{ title: 'Python basics', route: '/lesson/s05/learn' }],
  };
  const blocks = mentor.teachingBlocks(bare, 'en-IN');
  assert.deepEqual(blocks.map((block) => block.kind), ['simple', 'where'], 'nothing is fabricated');

  const full = mentor.mentorTurn('what is a tuple', bare, { lang: 'en-IN' });
  const kinds = full.blocks.map((block) => block.kind);
  assert.ok(kinds.includes('refusal'), 'the missing reason/example is stated as a refusal');
  assert.match(full.text, /will not/);
  assert.doesNotMatch(full.text, /```/, 'no code is invented for a lesson without one');
});

/* -------------------------------- the answer -------------------------------- */

test('mentor: an empty retrieval is answered honestly, with no topic and no blocks', () => {
  const turn = mentor.mentorTurn('what is quantum gardening', null, { lang: 'en-IN' });
  assert.equal(turn.blocks.length, 0);
  assert.match(turn.text, /could not find this exact topic/i);
  assert.equal(turn.topic, undefined, 'no title means no invented title');
});

test('mentor: the spoken turn drops the route and never claims a run or a test', () => {
  const turn = mentor.mentorTurn('what is a list', answer, { lang: 'en-IN' });
  assert.match(turn.spoken, /ordered collection/);
  assert.doesNotMatch(turn.spoken, /\/lesson\//, 'a route is a place to click, not a sentence');
  assert.doesNotMatch(turn.spoken, /```/, 'fence markers must never be spoken');
  assert.doesNotMatch(`${turn.text} ${turn.spoken}`, /\b(I ran|I tested|I executed|the tests? passed)\b/i);
  assert.match(turn.text, /```python/, 'the screen still shows the code block');
});

test('mentor: repeating the same ask returns the short version, not the whole wall again', () => {
  const first = mentor.mentorTurn('what is a list', answer, { lang: 'en-IN' });
  const again = mentor.mentorTurn('What is a list', answer, {
    lang: 'en-IN',
    history: [
      { role: 'learner', text: 'what is a list' },
      { role: 'mentor', text: first.text },
    ],
  });
  assert.equal(again.intent, 'repeat');
  assert.equal(again.repeat, true);
  assert.equal(again.blocks.length, 1, 'one block: the short version');
  assert.ok(again.spoken.length < first.spoken.length, 'the repeat is genuinely shorter');

  const hindiRepeat = mentor.mentorTurn('samajh nahi aaya', answer, { lang: 'hi-IN' });
  assert.equal(hindiRepeat.blocks.length, 1);
  assert.match(hindiRepeat.text, /short version|chhota|short/i);
});

test('mentor: example and why requests use the passage, or refuse by name', () => {
  const example = mentor.mentorTurn('show me an example', answer, { lang: 'en-IN' });
  assert.equal(example.intent, 'example');
  assert.equal(example.blocks[0].kind, 'example');

  const why = mentor.mentorTurn('why does this work?', answer, { lang: 'en-IN' });
  assert.equal(why.blocks[0].kind, 'why');
  assert.match(why.spoken, /because|since/i);

  const noExample = mentor.mentorTurn('example do', {
    text: '**Sets**\n\nA set stores unique values.',
    sources: [{ title: 'Sets', route: '/lesson/s06/learn' }],
  }, { lang: 'hi-IN' });
  assert.equal(noExample.blocks[0].kind, 'refusal');
  assert.match(noExample.text, /bana kar nahi bataunga|example nahi/i);
});

test('mentor: a greeting can name the page, and never invents one when there is none', () => {
  const placed = mentor.mentorGreeting('Python · Loops · Coding lab', 'en-IN');
  assert.match(placed.text, /You are on Python · Loops · Coding lab/);
  assert.equal(placed.blocks.length, 0);

  const bare = mentor.mentorGreeting(undefined, 'en-IN');
  assert.doesNotMatch(bare.text, /You are on/);
  assert.match(bare.text, /BroCode mentor/);

  const hindi = mentor.mentorGreeting('SQL joins', 'hi-IN');
  assert.match(hindi.text, /Abhi tum SQL joins par ho/);
});

/* ------------------------- retrieved practice items ------------------------- */

test('mentor: a practice item with no authored answer is refused, not read as the lesson', () => {
  const practice = {
    text: 'Question: **How do you reverse a linked list in place?**',
    sources: [{ title: 'DSA practice', route: '/questions/dsa-reverse' }],
  };

  const turn = mentor.mentorTurn('explain reversing a linked list', practice, { lang: 'en-IN' });
  assert.deepEqual(turn.blocks.map((block) => block.kind), ['refusal'], 'a question is never a teaching block');
  assert.equal(turn.blocks[0].label, 'This is a practice question');
  assert.match(turn.text, /will not invent the theory/);
  assert.equal(turn.topic, 'How do you reverse a linked list in place?', 'the question is named, the theory is not invented');
  assert.doesNotMatch(turn.text, /In simple words/);
  assert.doesNotMatch(`${turn.text} ${turn.spoken}`, /I will not invent the theory.*(route|\/)/);

  const hindi = mentor.mentorTurn('samjha do reversing', practice, { lang: 'hi-IN' });
  assert.equal(hindi.blocks[0].kind, 'refusal');
  assert.match(hindi.text, /practice question hai/);

  // Asking FOR practice is the one intent where the question itself is the right answer to show.
  const asked = mentor.mentorTurn('test me on linked lists', practice, { lang: 'en-IN' });
  assert.equal(asked.intent, 'practice');
  assert.equal(asked.blocks[0].label, 'This is a practice question');
  assert.match(asked.text, /reverse a linked list in place/);
});

test('mentor: a Question/Answer passage teaches the ANSWER, titling it with the question', () => {
  const qa = {
    text: [
      'Question: **What is a closure in JavaScript?**',
      '',
      'Answer: A closure is a function that still remembers the variables from the place it was created, even after that place is gone.',
      '',
      'Why: JavaScript keeps those variables alive as long as the inner function can reach them.',
    ].join('\n'),
    sources: [{ title: 'JavaScript closures', route: '/lesson/js-closures/learn' }],
  };

  const turn = mentor.mentorTurn('what is a closure', qa, { lang: 'en-IN' });
  assert.equal(turn.topic, 'What is a closure in JavaScript?');
  const simple = turn.blocks.find((block) => block.kind === 'simple');
  assert.match(simple.text, /still remembers the variables/, 'the answer is the simple block');
  assert.doesNotMatch(simple.text, /Question:/, 'the question label is not read out');
  const why = turn.blocks.find((block) => block.kind === 'why');
  assert.ok(why, 'the authored Why paragraph is kept');
  assert.match(why.text, /keeps those variables alive/);
});

test('mentor: the same answer switches language without translating content itself', () => {
  const hindi = mentor.mentorTurn('kyun', answer, { lang: 'hi-IN' });
  assert.equal(hindi.blocks[0].label, 'Kyun aisa hota hai');
  assert.match(hindi.text, /It matters because order is often the whole point/, 'the lesson text is quoted, not machine-translated');
  assert.match(hindi.spoken, /Kyun aisa hota hai/);

  const full = mentor.mentorTurn('list samjhao', answer, { lang: 'hi-IN' });
  assert.match(full.text, /Simple bhasha mein/);
  assert.ok(full.followUps.every((item) => typeof item === 'string' && item.length > 0));
});

/* ---------------------------- the platform's own course ---------------------------- */

const REAL_SECTIONS = (() => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'generated', 'curriculum', 'sections.json'), 'utf8'));
  return Array.isArray(raw) ? raw : raw.sections;
})();

test('mentor: "what can I learn here?" is a platform question, not a topic question', () => {
  for (const ask of ['what can I learn here?', 'BroCode kya sikhata hai', 'kitne sections hain', 'syllabus batao']) {
    assert.equal(mentor.classifyMentorIntent(ask), 'project', `should be a platform question: ${ask}`);
  }
  assert.equal(mentor.isProjectQuestion('this app me kya kya hai'), true);

  // A lesson question must never be answered with a table of contents.
  for (const ask of ['python course ka example do', 'list vs tuple', 'SQL join samjhao', 'practice question do']) {
    assert.notEqual(mentor.isProjectQuestion(ask), true, `a lesson question was misread as a platform question: ${ask}`);
  }
});

test('mentor: the platform answer is built from the loaded curriculum and invents nothing', () => {
  const reply = mentor.projectOverview(REAL_SECTIONS, 'en-IN');
  assert.ok(reply, 'the loaded curriculum is enough to answer');
  assert.equal(reply.intent, 'project');

  assert.match(reply.text, new RegExp(`${REAL_SECTIONS.length} sections`),
    'the real count, not a rounded claim');
  const first = REAL_SECTIONS[0];
  const last = REAL_SECTIONS[REAL_SECTIONS.length - 1];
  assert.ok(reply.text.includes(first.title), 'the first real section is named');
  assert.ok(reply.text.includes(last.title), 'the last real section is named');

  // Every numbered line in the list must be a section the file really contains.
  const listed = reply.text.split('\n').map((line) => /^(\d+)\.\s+(.+)$/.exec(line)).filter(Boolean);
  assert.equal(listed.length, REAL_SECTIONS.length, 'one line per real section, none added');
  for (const [, no, title] of listed) {
    assert.ok(REAL_SECTIONS.some((section) => String(section.no) === no && section.title === title),
      `invented curriculum entry: ${no}. ${title}`);
  }

  // The spoken form is short and never reads a route or a fabricated figure.
  assert.ok(reply.spoken.length < 400, 'the spoken overview stays a sentence or two');
  assert.doesNotMatch(reply.spoken, /\/lesson|https?:/);
  assert.match(reply.spoken, new RegExp(`${REAL_SECTIONS.length} sections`));
  assert.deepEqual(reply.blocks, [], 'nothing was retrieved, so nothing is quoted');
});

test('mentor: the platform answer speaks Hinglish and needs a real curriculum', () => {
  const hindi = mentor.projectOverview(REAL_SECTIONS, 'hi-IN');
  const english = mentor.projectOverview(REAL_SECTIONS, 'en-IN');
  assert.notEqual(hindi.spoken, english.spoken, 'the spoken form follows the chosen language');
  assert.match(hindi.spoken, /sections hain/);

  // No curriculum loaded → the caller falls through to normal retrieval instead of showing nothing.
  assert.equal(mentor.projectOverview([], 'en-IN'), null);
  assert.equal(mentor.projectOverview([{ no: 1 }], 'en-IN'), null, 'a titleless section cannot be described');
});
