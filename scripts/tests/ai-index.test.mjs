/**
 * The assistant corpus is derived data. These tests pin its lineage and retrieval coverage against
 * the actual published curriculum, bank, playbook and course registries, not hand-made examples.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire, register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
register('./_ts-resolve.mjs', import.meta.url);

const require = createRequire(import.meta.url);
const { buildAiIndex, OUT_PATH } = require(path.join(ROOT, 'scripts', 'ai-index.cjs'));
const { retrieveKnowledge } = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'ai', 'knowledge.ts')).href);
const { askLocal } = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'ai', 'assistant.ts')).href);
const { assistantContextForPage } = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'ai', 'context.ts')).href);
const sectionsRaw = JSON.parse(read('public/generated/curriculum/sections.json'));
const sections = Array.isArray(sectionsRaw) ? sectionsRaw : sectionsRaw.sections;
const bankManifest = JSON.parse(read('public/generated/questions/manifest.json'));
const playbook = JSON.parse(read('public/generated/playbook/items.json'));
const courses = JSON.parse(read('public/generated/courses/index.json'));
const extras = JSON.parse(read('public/generated/curriculum/extras.json'));
const blankState = () => ({
  version: 1,
  profile: { name: 'Learner', goal: 'AI Engineer', level: 'Intermediate', dailyMinutes: 30, onboarded: true },
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
  study: {},
  notes: [],
  jobPrep: {},
  readNotifs: [],
});

test('AI index regeneration exactly matches the published artifact and current source counts', async () => {
  const index = await buildAiIndex();
  const packed = fs.readFileSync(OUT_PATH);
  const expected = zlib.gzipSync(Buffer.from(JSON.stringify(index)), { level: 9 });
  // NOT `assert.deepEqual(packed, expected)`: when the two 2.5 MB gzip buffers differ, Node builds an
  // assertion diff that renders BOTH buffers, which allocates ~450 bytes per input byte — measured at
  // ~20 GB of ArrayBuffers for this pair, so the run died with "Array buffer allocation failed"
  // instead of reporting the mismatch. `Buffer.compare` answers the same question in constant space,
  // and the failure path prints the actionable facts (sizes plus the first differing byte) rather
  // than megabytes of byte values.
  if (Buffer.compare(packed, expected) !== 0) {
    const limit = Math.min(packed.length, expected.length);
    let at = -1;
    for (let i = 0; i < limit; i += 1) if (packed[i] !== expected[i]) { at = i; break; }
    assert.fail(
      `public/generated/ai/knowledge.json.gz is stale: it is ${packed.length} bytes, a fresh build is `
      + `${expected.length} bytes (first difference at byte ${at === -1 ? 'end-of-shorter-buffer' : at}). `
      + 'Regenerate it with `npm run ai:index:write`.',
    );
  }
  assert.deepEqual(JSON.parse(zlib.gunzipSync(packed).toString('utf8')), index);
  assert.equal(index.counts.bankQuestions, bankManifest.total);
  assert.equal(index.counts.sections, sections.length);
  assert.equal(index.counts.courses, courses.courses.length);
  assert.equal(index.counts.playbook, playbook.items.length);
  assert.equal(index.counts.tracks, 8);
  assert.equal(index.counts.notebooks, 5);
  assert.equal(index.counts.mockInterviews, extras.mockInterview.reduce((sum, round) => sum + round.questions.length, 0));
  assert.equal(index.counts.intensiveInterviewQuestions, extras.intensive.length);
  assert.equal(new Set(index.documents.map((item) => item.id)).size, index.documents.length);
  assert.equal(index.sourceHash.length, 64);
  assert.equal(OUT_PATH, path.join(ROOT, 'public', 'generated', 'ai', 'knowledge.json.gz'));
});

test('the AI index corpus is plain strings everywhere — a localized { en, hi } field must never leak in', async () => {
  const index = await buildAiIndex();
  // The corpus is declared as plain strings and retrieval tokenizes title/courseTitle/body. An
  // authored { en, hi } map that reaches a document does not throw: it stringifies to
  // "[object Object]" on a learner's screen and poisons the inverted index. This is the regression
  // that shipped 15,265 documents with an object in `courseTitle`.
  for (const document of index.documents) {
    for (const [field, value] of Object.entries(document)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'string' || typeof value === 'number') continue;
      assert.ok(Array.isArray(value) && value.every((item) => typeof item === 'string'),
        `${document.id}.${field} is not a plain string: ${JSON.stringify(value)}`);
    }
  }
  const titled = index.documents.filter((document) => 'courseTitle' in document);
  assert.ok(titled.length > 15000, 'expected the corpus to be course-tagged as before');
  assert.ok(titled.every((document) => typeof document.courseTitle === 'string'));
  assert.deepEqual([...new Set(titled.map((document) => document.courseTitle))].sort(), [
    'AI Career Foundations', 'Agentic AI', 'Build, Production & System Design', 'Data Engineering',
    'Generative AI', 'Interview & Career', 'Machine Learning & NLP', 'NumPy & Pandas', 'Python',
    'SQL', 'Statistics & Data Analysis',
  ]);
  // `KnowledgeCourse.title` is rendered by the assistant's course list, so it is plain too.
  assert.ok(index.courses.every((course) => typeof course.title === 'string' && course.title.trim()));
});

test('validateKnowledgeIndex rejects the shapes that would render as [object Object]', async () => {
  const { validateKnowledgeIndex } = await import(
    pathToFileURL(path.join(ROOT, 'src', 'core', 'ai', 'knowledge.ts')).href
  );
  const index = await buildAiIndex();
  assert.equal(validateKnowledgeIndex(index), true, 'the published index must validate');

  const withLocalizedTitle = {
    ...index,
    documents: [{ ...index.documents[0], courseTitle: { en: 'SQL', hi: 'SQL' } }, ...index.documents.slice(1)],
  };
  assert.equal(validateKnowledgeIndex(withLocalizedTitle), false, 'a localized courseTitle must be rejected');

  const withLocalizedCourse = {
    ...index,
    courses: [{ ...index.courses[0], title: { en: 'Python', hi: 'Python' } }, ...index.courses.slice(1)],
  };
  assert.equal(validateKnowledgeIndex(withLocalizedCourse), false, 'a localized course title must be rejected');

  const withBadTags = {
    ...index,
    documents: [{ ...index.documents[0], tags: [{ en: 'a' }] }, ...index.documents.slice(1)],
  };
  assert.equal(validateKnowledgeIndex(withBadTags), false, 'non-string tags must be rejected');
});

test('the data loader transparently decompresses the lazy published asset', async () => {
  const { loadKnowledgeIndex } = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'data', 'knowledge.ts')).href);
  const originalFetch = globalThis.fetch;
  const packed = fs.readFileSync(OUT_PATH);
  globalThis.fetch = async (url) => {
    assert.equal(url, './generated/ai/knowledge.json.gz');
    return new Response(packed, { status: 200, headers: { 'content-type': 'application/gzip' } });
  };
  try {
    const index = await loadKnowledgeIndex();
    assert.equal(index.counts.bankQuestions, bankManifest.total);
    assert.equal(index.documents.length, index.counts.documents);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SQL interview queries retrieve real published answers with traceable source records', async () => {
  const index = await buildAiIndex();
  const hits = retrieveKnowledge(index, 'SQL interview question about CTE', { course: 'sql' });
  assert.ok(hits.length > 0, 'expected a real interview answer');
  assert.ok(hits.every(({ document }) => document.type === 'interview'));
  assert.ok(hits[0].document.answer?.length > 0);
  assert.match(hits[0].document.route, /^\/questions\?section=s19&type=interview$/);
  assert.match(hits[0].document.sourceRef, /^public\/generated\/questions\/s19\.json#/);
  assert.ok(hits[0].document.courseTitle);
  assert.ok(hits[0].document.chapterTitle);
});

test('assistant returns an actual SQL interview bank answer and its clickable provenance', async () => {
  const index = await buildAiIndex();
  const context = assistantContextForPage('/questions', '?section=s19&type=interview', sections, blankState(), index);
  const answer = askLocal('SQL interview question about CTE', sections, blankState(), context, 0, index);
  assert.equal(answer.kind, 'curriculum');
  assert.match(answer.text, /Question:/);
  assert.match(answer.text, /Answer:/);
  assert.ok(answer.sources[0].route.includes('/questions?section=s19&type=interview'));
  assert.match(answer.sources[0].reference, /public\/generated\/questions\/s19\.json#/);
  assert.equal(context.courseTitle, 'SQL');
  assert.equal(context.questionType, 'interview');
});

test('a next-topic request uses the current lesson and the real ordered concept list', async () => {
  const index = await buildAiIndex();
  const context = assistantContextForPage('/lesson/s07/learn', '', sections, blankState(), index);
  const answer = askLocal('What topic should I learn next after for loop?', sections, blankState(), context, 0, index);
  assert.equal(answer.kind, 'next');
  assert.match(answer.text, /After \*\*for loop\*\*, continue with \*\*while loop\*\*/);
  assert.equal(answer.sources[0].route, '/lesson/s07/learn');
  assert.match(answer.sources[0].reference, /s07\.learn\.concepts/);
});

test('course pages give the assistant the matching step, learner level and progress context', async () => {
  const index = await buildAiIndex();
  const context = assistantContextForPage('/course/sql/8', '', sections, blankState(), index);
  assert.equal(context.courseSlug, 'sql');
  assert.equal(context.courseTitle, 'SQL');
  assert.ok(context.chapterTitle);
  assert.equal(context.learningLevel, 'Intermediate');
  assert.ok(context.progressSummary);
});

test('project requests search the authored curriculum project records only', async () => {
  const index = await buildAiIndex();
  const hits = retrieveKnowledge(index, 'python project to build for practice');
  assert.ok(hits.length > 0, 'expected a project recommendation');
  assert.ok(hits.every(({ document }) => document.kind === 'project'));
  assert.ok(hits[0].document.route.startsWith('/lesson/'));
  assert.ok(hits[0].document.sourceRef.includes('projectLab') || hits[0].document.sourceRef.endsWith('.mini'));
});

test('unmatched questions still receive the honest local-curriculum fallback', async () => {
  const index = await buildAiIndex();
  const answer = askLocal('zzqvortex blarghmantic qwxjellophone', sections, blankState(), undefined, 0, index);
  assert.equal(answer.kind, 'fallback');
  assert.match(answer.text, /not found in the bundled curriculum/i);
  assert.doesNotMatch(answer.text, /zzqvortex.*is defined as/i);
});

test('section and course context measurably promote the matching lesson material', async () => {
  const index = await buildAiIndex();
  const cold = retrieveKnowledge(index, 'mutable immutable id memory', {}, 5);
  const warm = retrieveKnowledge(index, 'mutable immutable id memory', { sectionId: 's01', course: 'python' }, 5);
  assert.ok(cold.length && warm.length);
  assert.equal(warm[0].document.sectionId, 's01');
  assert.ok(warm[0].score > cold[0].score);
});

test('notebook source cells and the career readiness registry are indexed without outputs or private archives', async () => {
  const index = await buildAiIndex();
  assert.ok(index.documents.some((item) => item.kind === 'notebook' && item.sourceRef.startsWith('public/notebooks/')));
  assert.ok(index.documents.some((item) => item.kind === 'notebook-code'));
  assert.ok(index.documents.some((item) => item.kind === 'career' && item.sourceRef.includes('CAREER_CHECKLIST')));
  assert.ok(index.documents.every((item) => !item.sourceRef.includes('resume-removed')));
  assert.ok(index.documents.every((item) => !item.body?.includes('execution_count')));
});
