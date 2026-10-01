/**
 * Interview Mode's skill sections — the mapping, pinned.
 *
 * Every failure mode here is silent and only shows up on the page weeks later: a new curriculum
 * section title ("MLOps + Docker + Git + AWS") quietly claimed by the ML rule, "Variables & Data
 * Types" claimed by the data rule, an interview section claimed by the data rule because it says
 * "Data Scientist" in the middle. In each case the page still renders — the section is simply the
 * wrong one, and the learner sees a Docker question under "ML + NLP".
 *
 * The lists below are the 45 real labels the page can produce, read from the three sources that
 * feed it (29 curriculum section titles, 13 mock-interview round labels, 4 intensive labels — `ML`
 * is shared). If a source ever grows a label, this test will not know about it, but the new label
 * lands in `more` — a visible section — instead of vanishing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const iv = await load('src/core/assessment/interview.ts');

/** Curriculum section titles, in section order. */
const SECTIONS = [
  'Variables & Data Types', 'Operators', 'Input & Output', 'Strings', 'String Methods',
  'if / elif / else', 'for & while Loops', 'Lists', 'List Methods', 'Tuples', 'Sets', 'Dictionaries',
  'OOP (Object Oriented Programming)', 'Functions & Reusable Python', 'Exceptions, Files & Modules',
  'Advanced Python & Performance', 'NumPy for AI & Data Science', 'Pandas for Data Science',
  'SQL + Databases', 'Machine Learning + scikit-learn', 'NLP + Transformers',
  'Generative AI, LLMs & RAG', 'Agentic AI + LangChain + n8n', 'APIs, Flask/FastAPI & Production Python',
  'Data Analytics + Power BI', 'MLOps + Docker + Git + AWS',
  'AI Engineer + Data Scientist Interview Mastery', 'Coding Patterns, Projects & Final Practice',
  'Resume Project Interview Labs',
];
/** Mock-interview round and intensive-drill labels. */
const SHORT = ['PYTHON', 'DATA', 'SQL', 'ML', 'NLP', 'GENAI', 'AGENTS', 'APIS', 'RESUME', 'BEHAVIOR', 'CODING', 'SYSTEM', 'CAREER', 'AI API', 'Agentic AI', 'Power BI'];

const EXPECTED = {
  python: [...SECTIONS.slice(0, 16), 'PYTHON'],
  data: ['NumPy for AI & Data Science', 'Pandas for Data Science', 'Data Analytics + Power BI', 'DATA', 'Power BI'],
  sql: ['SQL + Databases', 'SQL'],
  ml: ['Machine Learning + scikit-learn', 'NLP + Transformers', 'ML', 'NLP'],
  genai: ['Generative AI, LLMs & RAG', 'GENAI'],
  agentic: ['Agentic AI + LangChain + n8n', 'AGENTS', 'Agentic AI'],
  apis: ['APIs, Flask/FastAPI & Production Python', 'MLOps + Docker + Git + AWS', 'APIS', 'AI API', 'SYSTEM'],
  career: [
    'AI Engineer + Data Scientist Interview Mastery', 'Coding Patterns, Projects & Final Practice',
    'Resume Project Interview Labs', 'RESUME', 'BEHAVIOR', 'CODING', 'CAREER',
  ],
};

test('interview: every real category label lands in its skill', () => {
  for (const [id, labels] of Object.entries(EXPECTED)) {
    for (const label of labels) assert.equal(iv.skillOf(label), id, `${JSON.stringify(label)} belongs to ${id}`);
  }
  // The three sources together produce 45 distinct labels, and every one of them is claimed — the
  // totals are asserted so a label written twice (or dropped) fails here rather than on the page.
  const all = [...SECTIONS, ...SHORT];
  assert.equal(new Set(all).size, 45, 'the three sources produce 45 distinct labels');
  assert.equal(Object.values(EXPECTED).flat().length, 45);
  assert.equal(new Set(Object.values(EXPECTED).flat()).size, 45, 'no label is claimed by two skills');
});

test('interview: a label is claimed by the narrow rule, never by a word inside it', () => {
  // Each of these is one keyword away from the wrong section, and each wrong answer still renders.
  assert.equal(iv.skillOf('MLOps + Docker + Git + AWS'), 'apis', '"MLOps" is not the ML rule');
  assert.equal(iv.skillOf('Machine Learning + scikit-learn'), 'ml');
  assert.equal(iv.skillOf('Variables & Data Types'), 'python', '"Data Types" is not the data rule');
  assert.equal(iv.skillOf('Data Analytics + Power BI'), 'data');
  assert.equal(iv.skillOf('AI Engineer + Data Scientist Interview Mastery'), 'career', 'an interview section, despite "Data Scientist"');
  assert.equal(iv.skillOf('APIs, Flask/FastAPI & Production Python'), 'apis', 'an APIs section, despite "Python"');
});

test('interview: an unknown label is kept, not dropped', () => {
  // A label the curriculum invented later still finds a home if it names a technology, and lands in
  // `more` — a rendered section — if it does not. Either way the question stays reachable.
  assert.equal(iv.skillOf('Docker & Kubernetes'), 'apis');
  assert.equal(iv.skillOf('Kubernetes Operators for LLM Serving'), 'genai', 'a keyword anywhere in the label is enough');
  assert.equal(iv.skillOf('Kafka Streams'), 'more');
  assert.equal(iv.skillOf(''), 'more');
  const known = new Set([...iv.SKILL_GROUPS.map((g) => g.id), iv.MORE_TOPICS.id]);
  for (const label of ['Kafka Streams', 'Kubernetes Operators for LLM Serving', 'Blockchain for AI', 'zzz']) {
    assert.ok(known.has(iv.skillOf(label)), `${label} must land in a section the page renders`);
    assert.ok(iv.groupCategories([{ name: label, count: 1 }]).length === 1, `${label} must not vanish`);
  }
});

test('interview: the sections are the learning path, and no two share a colour or an icon', () => {
  const ids = iv.SKILL_GROUPS.map((g) => g.id);
  assert.deepEqual(ids, ['python', 'data', 'sql', 'ml', 'genai', 'agentic', 'apis', 'career'], 'the order mirrors the tracks');
  // "sare button alg alg" — a colour used twice is two skills that look like one.
  const tones = [...iv.SKILL_GROUPS, iv.MORE_TOPICS].map((g) => g.tone);
  assert.equal(new Set(tones).size, tones.length, 'every section has its own tone');
  const icons = [...iv.SKILL_GROUPS, iv.MORE_TOPICS].map((g) => g.icon);
  assert.equal(new Set(icons).size, icons.length, 'every section has its own icon');
  assert.ok(iv.SKILL_GROUPS.every((g) => g.label && g.hint), 'every section is labelled and explained');
});

test('interview: the grouping loses no question and no category', () => {
  const cats = [...SECTIONS, ...SHORT].map((name, i) => ({ name, count: i + 1 }));
  const before = JSON.parse(JSON.stringify(cats));
  const sections = iv.groupCategories(cats);
  assert.deepEqual(cats, before, 'the input is not sorted in place');
  assert.equal(sections.reduce((n, s) => n + s.count, 0), cats.reduce((n, c) => n + c.count, 0));
  assert.equal(sections.reduce((n, s) => n + s.cats.length, 0), cats.length);
  const seen = sections.flatMap((s) => s.cats.map((c) => c.name));
  assert.equal(new Set(seen).size, cats.length, 'a category appears in exactly one section');
  // Empty skills are dropped: with one source selected, most sections have nothing in them.
  assert.deepEqual(sections.map((s) => s.id), iv.SKILL_GROUPS.map((g) => g.id));
  assert.equal(iv.groupCategories([]).length, 0);
  // Inside a section the topics are alphabetical, so the order does not follow however the banks loaded.
  // `localeCompare`, not a code-unit sort: a plain `.sort()` files "for & while Loops" after "Tuples".
  for (const s of sections) {
    const names = s.cats.map((c) => c.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  }
  // The fallback is a real section, so an unmapped skill is visible on the page.
  const more = iv.groupCategories([{ name: 'Kafka Streams', count: 3 }]);
  assert.deepEqual(more.map((s) => s.id), ['more']);
  assert.equal(more[0].count, 3);
});

test('interview: the category filter reads a skill key as a skill, and anything else as one label', () => {
  assert.equal(iv.ALL_CATS, 'ALL');
  assert.equal(iv.skillKey('python'), '#python');
  assert.ok(iv.catMatchesFilter('ALL', 'Lists'));
  assert.ok(iv.catMatchesFilter('', 'Lists'));
  assert.ok(iv.catMatchesFilter('Lists', 'Lists'));
  assert.ok(!iv.catMatchesFilter('Tuples', 'Lists'));
  // A whole skill: every one of its categories passes, and nothing outside it does.
  assert.ok(iv.catMatchesFilter(iv.skillKey('python'), 'Sets'));
  assert.ok(!iv.catMatchesFilter(iv.skillKey('python'), 'SQL'));
  // A label that merely starts with `#` is not a skill id, and must not match everything.
  assert.ok(!iv.catMatchesFilter('#', 'Sets'));
  assert.ok(!iv.catMatchesFilter('#nope', 'Sets'));
});
