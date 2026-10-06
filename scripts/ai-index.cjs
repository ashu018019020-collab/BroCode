#!/usr/bin/env node
/**
 * npm run ai:index | ai:index:write
 *
 * Builds the assistant's compact, local retrieval corpus from published curriculum data. The
 * output is replaceable derived data: no source file is edited, and removed source records vanish
 * from the next generated index without touching learner progress or authored content.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const GENERATED = path.join(ROOT, 'public', 'generated');
const OUT_DIR = path.join(GENERATED, 'ai');
const OUT_PATH = path.join(OUT_DIR, 'knowledge.json.gz');
const LEGACY_OUT_PATH = path.join(OUT_DIR, 'knowledge.json');
const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'of', 'and', 'or', 'to', 'in', 'on',
  'for', 'with', 'as', 'at', 'by', 'it', 'its', 'this', 'that', 'from', 'we', 'you', 'your',
  'ka', 'ki', 'ke', 'hai', 'hain', 'aur', 'ek', 'me', 'mein', 'se', 'par', 'ko',
]);

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const textOf = (...values) => values
  .flat(Infinity)
  .filter((value) => typeof value === 'string' || typeof value === 'number')
  .map(String)
  .filter((value) => value.trim())
  .join('\n');
const limit = (value, size) => {
  const text = String(value ?? '').trim();
  return text.length > size ? `${text.slice(0, size - 1).trimEnd()}…` : text;
};
const tokens = (text) => (String(text ?? '').toLowerCase().match(/[a-z0-9_]+/g) ?? [])
  .filter((token) => token.length > 1 && !STOP.has(token));

async function buildAiIndex() {
  const sectionsPath = path.join(GENERATED, 'curriculum', 'sections.json');
  const extrasPath = path.join(GENERATED, 'curriculum', 'extras.json');
  const questionsDir = path.join(GENERATED, 'questions');
  const playbookPath = path.join(GENERATED, 'playbook', 'items.json');
  const playbookManifestPath = path.join(GENERATED, 'playbook', 'manifest.json');
  const coursesIndexPath = path.join(GENERATED, 'courses', 'index.json');
  const tracksIndexPath = path.join(GENERATED, 'tracks', 'index.json');
  const notebookManifestPath = path.join(ROOT, 'public', 'notebooks', 'manifest.json');
  const inputPaths = [
    sectionsPath, extrasPath, playbookPath, playbookManifestPath, coursesIndexPath, tracksIndexPath,
    notebookManifestPath,
  ];
  const sectionsRaw = readJson(sectionsPath);
  const sections = Array.isArray(sectionsRaw) ? sectionsRaw : sectionsRaw.sections;
  const extras = readJson(extrasPath);
  const courseIndex = readJson(coursesIndexPath);
  const trackIndex = readJson(tracksIndexPath);
  const playbook = readJson(playbookPath);
  const playbookManifest = readJson(playbookManifestPath);
  const notebookManifest = readJson(notebookManifestPath);

  const [roadmap, career] = await Promise.all([
    import(pathToFileURL(path.join(ROOT, 'src', 'core', 'learning', 'roadmap.ts')).href),
    import(pathToFileURL(path.join(ROOT, 'src', 'core', 'learning', 'career.ts')).href),
  ]);

  const sectionMap = new Map(sections.map((section) => [section.id, section]));
  const courseBySection = new Map();
  const courseByStep = new Map();
  const courseSteps = [];
  for (const course of courseIndex.courses ?? []) {
    const steps = (course.steps ?? []).map((number) => {
      const step = roadmap.STEPS.find((entry) => entry.no === number);
      const info = { number, title: step?.title ?? `Step ${number}`, route: `/course/${course.slug}/${number}` };
      courseByStep.set(number, { ...info, course });
      courseSteps.push({ ...info, course: course.slug });
      return info;
    });
    for (const [sectionId, chapter] of Object.entries(course.sections ?? {})) {
      if (courseBySection.has(sectionId)) throw new Error(`Section ${sectionId} is assigned to multiple courses`);
      courseBySection.set(sectionId, { course, chapter });
    }
    course.steps = steps;
  }

  const docs = [];
  const docIds = new Set();
  const sourceFiles = new Set(inputPaths);
  const add = (record) => {
    if (!record.id || docIds.has(record.id)) throw new Error(`Missing or duplicate AI document id: ${record.id}`);
    const relation = record.sectionId ? courseBySection.get(record.sectionId) : undefined;
    const route = record.route ?? (record.sectionId
      ? `/lesson/${record.sectionId}/${record.routeStage ?? 'learn'}`
      : '/courses');
    const doc = {
      id: record.id,
      kind: record.kind,
      title: limit(record.title, 500),
      ...(record.sectionId ? { sectionId: record.sectionId } : {}),
      ...(record.sectionTitle ? { sectionTitle: limit(record.sectionTitle, 180) } : {}),
      ...(record.type ? { type: record.type } : {}),
      ...(record.difficulty ? { difficulty: record.difficulty } : {}),
      ...(relation ? {
        course: relation.course.slug,
        courseTitle: relation.course.name,
        chapter: relation.chapter,
        chapterTitle: courseByStep.get(relation.chapter)?.title ?? '',
      } : record.course ? {
        course: record.course,
        ...(record.courseTitle ? { courseTitle: record.courseTitle } : {}),
        ...(record.chapter ? { chapter: record.chapter } : {}),
        ...(record.chapterTitle ? { chapterTitle: record.chapterTitle } : {}),
      } : {}),
      route,
      source: limit(record.source, 220),
      sourceRef: limit(record.sourceRef, 320),
      ...(record.tags?.length ? { tags: record.tags.map((tag) => limit(tag, 80)).filter(Boolean) } : {}),
      ...(record.answer ? { answer: limit(record.answer, 2400) } : {}),
      ...(record.explanation ? { explanation: limit(record.explanation, 1200) } : {}),
      ...(record.body ? { body: limit(record.body, 5000) } : {}),
    };
    docIds.add(doc.id);
    docs.push(doc);
  };

  for (const section of sections) {
    const base = {
      sectionId: section.id,
      sectionTitle: section.title,
    };
    for (const [index, concept] of (section.learn?.concepts ?? []).entries()) {
      const guide = concept.guide;
      const guideText = guide ? textOf(
        guide.what, guide.why, guide.whereUsed, guide.prereqs, guide.howItWorks, guide.syntax,
        guide.examples?.map((item) => [item.code, item.output, item.explain]),
        guide.howToCode?.map((item) => [item.step, item.detail, item.code]),
        guide.commonMistakes, guide.bestPractices, guide.realWorld,
        guide.practice?.map((item) => item.text),
        guide.interview?.map((item) => [item.q, item.a]),
        guide.miniChallenge, guide.debugTask, guide.related, guide.revision, guide.interviewTip,
      ) : '';
      add({
        ...base, id: `lesson:${section.id}:concept:${index}`, kind: 'concept',
        title: concept.title, body: textOf(concept.body, concept.tip, concept.code, concept.output, guideText),
        route: `/lesson/${section.id}/learn`, routeStage: 'learn',
        source: concept.authoredTopic ? 'Authored concept guide' : 'Curriculum lesson',
        sourceRef: `public/generated/curriculum/sections.json#${section.id}.learn.concepts[${index}]`,
      });
    }
    for (const [index, practice] of (section.learn?.practice ?? []).entries()) {
      add({
        ...base, id: `lesson:${section.id}:practice:${index}`, kind: 'practice',
        type: 'practice', difficulty: practice.difficulty, title: practice.text, body: practice.text,
        route: `/lesson/${section.id}/practice`, routeStage: 'practice',
        source: 'Curriculum lesson practice',
        sourceRef: `public/generated/curriculum/sections.json#${section.id}.learn.practice[${index}]`,
      });
    }
    if (section.learn?.recap) add({
      ...base, id: `lesson:${section.id}:recap`, kind: 'recap',
      title: `${section.title} recap`, body: textOf(section.learn.recap, section.learn.remember),
      route: `/lesson/${section.id}/learn`, source: 'Curriculum recap',
      sourceRef: `public/generated/curriculum/sections.json#${section.id}.learn.recap`,
    });
    for (const [index, item] of (section.interview ?? []).entries()) add({
      ...base, id: `lesson:${section.id}:interview:${index}`, kind: 'interview',
      type: 'interview', title: item.q, answer: item.a, explanation: textOf(item.tip, item.fu),
      route: `/lesson/${section.id}/interview`, routeStage: 'interview',
      source: 'Curriculum interview question',
      sourceRef: `public/generated/curriculum/sections.json#${section.id}.interview[${index}]`,
    });
    for (const [index, item] of (section.coding ?? []).entries()) if (item.text || item.solution) add({
      ...base, id: `lesson:${section.id}:coding:${index}`, kind: item.difficulty === 'debug' ? 'debug' : 'coding',
      type: item.difficulty === 'debug' ? 'debug' : 'coding', difficulty: item.difficulty,
      title: item.text, answer: item.solution, explanation: item.check,
      route: `/lesson/${section.id}/${item.difficulty === 'debug' ? 'debug' : 'coding'}`,
      routeStage: item.difficulty === 'debug' ? 'debug' : 'coding',
      source: 'Curriculum coding task',
      sourceRef: `public/generated/curriculum/sections.json#${section.id}.coding[${index}]`,
    });
    for (const [index, item] of (section.logic ?? []).entries()) add({
      ...base, id: `lesson:${section.id}:logic:${index}`, kind: 'logic',
      type: 'logic', title: item.text, answer: item.answer, explanation: item.kind,
      route: `/lesson/${section.id}/logic`, routeStage: 'logic',
      source: 'Curriculum logic question',
      sourceRef: `public/generated/curriculum/sections.json#${section.id}.logic[${index}]`,
    });
    for (const [index, item] of (section.solved ?? []).entries()) add({
      ...base, id: `lesson:${section.id}:solved:${index}`, kind: 'solved',
      type: 'solved', difficulty: item.difficulty, title: item.text, answer: item.solution,
      explanation: item.result, route: `/lesson/${section.id}/solved`, routeStage: 'solved',
      source: 'Curriculum solved example',
      sourceRef: `public/generated/curriculum/sections.json#${section.id}.solved[${index}]`,
    });
    if (section.mini?.name) add({
      ...base, id: `lesson:${section.id}:mini-project`, kind: 'project',
      title: section.mini.name, body: textOf(
        section.mini.what, section.mini.use, section.mini.architecture, section.mini.files,
        section.mini.buildTarget, section.mini.output, section.mini.code, section.mini.explanation,
        section.mini.interview, section.mini.edgeCases,
      ),
      route: `/lesson/${section.id}/mini`, source: 'Curriculum mini project',
      sourceRef: `public/generated/curriculum/sections.json#${section.id}.mini`,
    });
    for (const [index, item] of (section.projectLab ?? []).entries()) add({
      ...base, id: `lesson:${section.id}:project:${index}`, kind: 'project',
      type: 'project', difficulty: item.tier, title: item.name,
      body: textOf(item.what, item.use, item.architecture, item.files, item.buildTarget, item.code,
        item.defense, item.debugCue, item.followUp),
      route: `/lesson/${section.id}/project`, routeStage: 'project',
      source: 'Curriculum project lab',
      sourceRef: `public/generated/curriculum/sections.json#${section.id}.projectLab[${index}]`,
    });
    for (const [index, item] of (section.checkpoint ?? []).entries()) add({
      ...base, id: `lesson:${section.id}:checkpoint:${index}`, kind: 'checkpoint',
      type: 'checkpoint', title: item.q, answer: item.key,
      route: `/lesson/${section.id}/checkpoint`, routeStage: 'checkpoint',
      source: 'Curriculum checkpoint',
      sourceRef: `public/generated/curriculum/sections.json#${section.id}.checkpoint[${index}]`,
    });

    const topic = section.topic;
    if (topic) {
      const topicBody = textOf(
        topic.intro, topic.theory, topic.syntax,
        topic.examples?.map((item) => [item.code, item.output, item.explain]),
        topic.realWorld,
        Object.values(topic.practice ?? {}).flat().map((item) => [item.q, item.a, item.explain, item.code, item.tip]),
        topic.coding?.map((item) => [item.question, item.build, item.hint, item.solution, item.explanation, item.better, item.followUp]),
        topic.debugging?.map((item) => [item.broken, item.error, item.why, item.fix, item.correct, item.lesson]),
        topic.challenges?.map((item) => [item.kind, item.prompt, item.hint, item.deliverable]),
        topic.projects?.map((item) => [item.name, item.problem, item.objective, item.features, item.steps, item.code, item.explanation, item.interview, item.resume]),
        Object.values(topic.projectQuestions ?? {}),
        topic.interview?.map((item) => [item.q, item.a, item.tip]),
        topic.interviewTasks?.map((item) => [item.q, item.a, item.deliverable]),
        topic.revision,
      );
      if (topicBody) add({
        ...base, id: `lesson:${section.id}:authored-topic-pack`, kind: 'topic-pack',
        title: `${section.title} authored topic guide`, body: topicBody,
        route: `/lesson/${section.id}/learn`, source: 'Authored topic pack',
        sourceRef: `public/generated/curriculum/sections.json#${section.id}.topic`,
      });
    }
  }

  const chapters = new Map((playbookManifest.chapters ?? []).map((item) => [String(item.no), item]));
  for (const round of extras.mockInterview ?? []) {
    for (const [index, question] of (round.questions ?? []).entries()) add({
      id: `mock:${round.round}:${index}`, kind: 'interview', type: 'interview',
      title: question.q, answer: question.a,
      route: '/mock-interviews', source: `Mock Interview · round ${round.round}`,
      sourceRef: `public/generated/curriculum/extras.json#mockInterview[${round.round}].questions[${index}]`,
    });
  }
  for (const [index, question] of (extras.intensive ?? []).entries()) add({
    id: `intensive:${index}`, kind: 'interview', type: 'interview',
    title: question.q, answer: question.a,
    route: '/final-assessment', source: 'Intensive interview set',
    sourceRef: `public/generated/curriculum/extras.json#intensive[${index}]`,
  });

  const bankFiles = fs.readdirSync(questionsDir).filter((name) => name.endsWith('.json') && name !== 'manifest.json').sort();
  let bankQuestions = 0;
  for (const file of bankFiles) {
    const filePath = path.join(questionsDir, file);
    sourceFiles.add(filePath);
    const sectionId = file.replace(/\.json$/, '');
    const bank = readJson(filePath);
    for (const [index, question] of (bank.questions ?? []).entries()) {
      if (question.status && question.status !== 'PUBLISHED') continue;
      const course = courseBySection.get(question.sectionId ?? sectionId);
      add({
        id: `bank:${question.id ?? `${sectionId}:${index}`}`,
        kind: question.type === 'defense' ? 'defense-question' : 'question',
        sectionId: question.sectionId ?? sectionId,
        sectionTitle: sectionMap.get(question.sectionId ?? sectionId)?.title,
        type: question.type, difficulty: question.difficulty, title: question.question,
        answer: question.answer, explanation: question.explanation,
        tags: question.tags,
        course: course?.course.slug,
        courseTitle: course?.course.name,
        chapter: course?.chapter,
        chapterTitle: courseByStep.get(course?.chapter)?.title,
        route: `/questions?section=${encodeURIComponent(question.sectionId ?? sectionId)}&type=${encodeURIComponent(question.type ?? '')}`,
        source: `Question Bank · ${question.source ?? 'published'}${question.sourceVersion ? ` · ${question.sourceVersion}` : ''}`,
        sourceRef: `public/generated/questions/${file}#${question.id ?? index}${question.pdfPage ? ` (PDF p.${question.pdfPage})` : ''}`,
      });
      bankQuestions++;
    }
  }

  const bankQuestionsByText = new Map();
  for (const doc of docs) {
    if (doc.kind !== 'question' || !doc.title) continue;
    const key = doc.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!bankQuestionsByText.has(key)) bankQuestionsByText.set(key, doc);
  }
  for (const item of playbook.items ?? []) {
    const key = String(item.question ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    const bankDoc = bankQuestionsByText.get(key);
    if (bankDoc) {
      bankDoc.source = `${bankDoc.source} · Playbook V15`;
      bankDoc.sourceRef += `; public/generated/playbook/items.json#${item.id}`;
      continue;
    }
    const sectionId = item.sectionId;
    const chapter = Number(item.chapter);
    add({
      id: `playbook:${item.id}`, kind: 'playbook', sectionId,
      sectionTitle: item.sectionTitle ?? sectionMap.get(sectionId)?.title,
      type: item.type, difficulty: item.difficulty, title: item.question,
      answer: item.answer, course: courseBySection.get(sectionId)?.course.slug,
      courseTitle: courseBySection.get(sectionId)?.course.name,
      chapter: courseBySection.get(sectionId)?.chapter ?? (Number.isFinite(chapter) ? chapter : undefined),
      route: `/playbook`,
      source: `Playbook V15 · chapter ${item.chapter ?? 'unassigned'}${chapters.get(String(item.chapter))?.title ? `: ${chapters.get(String(item.chapter)).title}` : ''}`,
      sourceRef: `public/generated/playbook/items.json#${item.id}`,
    });
  }
  inputPaths.push(...bankFiles.map((file) => path.join(questionsDir, file)), playbookPath);

  for (const chapter of roadmap.STEPS) {
    const courseInfo = courseByStep.get(chapter.no);
    add({
      id: `roadmap:step-${chapter.no}`, kind: 'roadmap', title: chapter.title,
      body: textOf(chapter.topics, chapter.goal, chapter.lab, chapter.project,
        (chapter.chapters ?? []).map((no) => {
          const ref = chapters.get(String(no));
          return ref ? `Playbook chapter ${no}: ${ref.title}` : '';
        })),
      ...(courseInfo ? { course: courseInfo.course.slug, courseTitle: courseInfo.course.name, chapter: chapter.no, chapterTitle: chapter.title } : {}),
      route: courseInfo?.route ?? '/courses', source: 'Canonical 36-step roadmap',
      sourceRef: `src/core/learning/roadmap.ts#STEPS[${chapter.no}]`,
    });
  }

  const trackCourses = new Map();
  for (const track of trackIndex) {
    const filePath = path.join(GENERATED, 'tracks', `${track.slug}.json`);
    sourceFiles.add(filePath);
    const trackDoc = readJson(filePath);
    for (const chapter of trackDoc.chapters ?? []) {
      for (const topic of chapter.topics ?? []) add({
        id: `track:${track.slug}:${topic.id}`, kind: 'track-topic',
        sectionId: topic.sectionId, sectionTitle: sectionMap.get(topic.sectionId)?.title,
        title: topic.title, body: textOf(trackDoc.description, chapter.title, topic.importance, topic.level),
        course: courseBySection.get(topic.sectionId)?.course.slug,
        courseTitle: courseBySection.get(topic.sectionId)?.course.name,
        chapter: courseBySection.get(topic.sectionId)?.chapter,
        route: `/track/${track.slug}`, source: `Track · ${trackDoc.title}`,
        sourceRef: `public/generated/tracks/${track.slug}.json#${topic.id}`,
        tags: [topic.importance, topic.level],
      });
    }
    const firstSectionId = trackDoc.chapters?.flatMap((chapter) => chapter.topics ?? [])[0]?.sectionId;
    const trackCourse = firstSectionId ? courseBySection.get(firstSectionId) : undefined;
    if (trackCourse) trackCourses.set(track.slug, trackCourse.course.slug);
  }

  const courseItems = courseIndex.courses.map((course) => ({
    slug: course.slug, title: course.name,
    route: `/course/${course.slug}/${course.steps[0]?.number ?? course.steps[0] ?? 1}`,
    steps: course.steps, sections: course.sections,
  }));
  for (const notebook of notebookManifest.notebooks ?? []) {
    const notebookPath = path.join(ROOT, 'public', 'notebooks', notebook.file);
    sourceFiles.add(notebookPath);
    const data = readJson(notebookPath);
    for (const [index, cell] of (data.cells ?? []).entries()) {
      const cellText = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '');
      if (!cellText.trim()) continue;
      const sectionId = notebook.section;
      add({
        id: `notebook:${notebook.file}:${cell.id ?? index}`,
        kind: cell.cell_type === 'code' ? 'notebook-code' : 'notebook',
        sectionId, sectionTitle: sectionMap.get(sectionId)?.title,
        title: `${notebook.title} · ${cell.cell_type === 'code' ? 'code example' : 'lesson note'}`,
        body: cellText,
        course: courseBySection.get(sectionId)?.course.slug,
        courseTitle: courseBySection.get(sectionId)?.course.name,
        chapter: courseBySection.get(sectionId)?.chapter,
        route: `/notebooks`, source: `Notebook · ${notebook.title}`,
        sourceRef: `public/notebooks/${notebook.file}#${cell.id ?? index}`,
        tags: [notebook.topic, notebook.level].filter(Boolean),
      });
    }
  }

  for (const item of career.CAREER_CHECKLIST ?? []) add({
    id: `career:checklist:${item.id}`, kind: 'career',
    title: item.label, body: textOf(item.hint, item.phase, item.weight),
    route: item.to, source: 'Career readiness checklist',
    sourceRef: `src/core/learning/career.ts#CAREER_CHECKLIST:${item.id}`,
    tags: [item.phase],
  });
  for (const role of career.TARGET_ROLES ?? []) add({
    id: `career:role:${role.id}`, kind: 'career',
    title: role.label, body: textOf(role.blurb, role.tracks),
    route: '/career', source: 'Career target roles',
    sourceRef: `src/core/learning/career.ts#TARGET_ROLES:${role.id}`,
    tags: role.tracks,
  });
  for (const sourcePath of new Set(inputPaths)) sourceFiles.add(sourcePath);
  const hash = crypto.createHash('sha256');
  for (const sourcePath of [...sourceFiles].sort()) {
    hash.update(path.relative(ROOT, sourcePath).replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(sourcePath));
    hash.update('\0');
  }

  const postings = new Map();
  docs.forEach((doc, index) => {
    const searchable = textOf(
      doc.title, doc.body, doc.answer, doc.explanation, doc.tags,
      doc.sectionTitle, doc.courseTitle, doc.chapterTitle, doc.type, doc.difficulty,
    );
    for (const term of new Set(tokens(searchable))) {
      const posting = postings.get(term) ?? [];
      posting.push(index);
      postings.set(term, posting);
    }
  });
  const byKind = {};
  for (const doc of docs) byKind[doc.kind] = (byKind[doc.kind] ?? 0) + 1;

  return {
    version: 1,
    sourceHash: hash.digest('hex'),
    counts: {
      documents: docs.length, bankQuestions,
      sections: sections.length, courses: courseItems.length,
      tracks: trackIndex.length, playbook: (playbook.items ?? []).length,
      notebooks: (notebookManifest.notebooks ?? []).length, byKind,
      mockInterviews: (extras.mockInterview ?? []).reduce((sum, round) => sum + (round.questions ?? []).length, 0),
      intensiveInterviewQuestions: (extras.intensive ?? []).length,
    },
    courses: courseItems,
    trackRoutes: trackIndex.map((track) => ({
      slug: track.slug, title: track.title, route: `/track/${track.slug}`,
      ...(trackCourses.has(track.slug) ? { course: trackCourses.get(track.slug) } : {}),
    })),
    documents: docs,
    postings: Object.fromEntries([...postings.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function writeAiIndex(index) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, zlib.gzipSync(Buffer.from(JSON.stringify(index)), { level: 9 }));
  if (fs.existsSync(LEGACY_OUT_PATH)) fs.unlinkSync(LEGACY_OUT_PATH);
}

function report(index, written) {
  const bytes = Buffer.byteLength(JSON.stringify(index));
  const compressedBytes = zlib.gzipSync(Buffer.from(JSON.stringify(index)), { level: 9 }).length;
  console.log(`\n${written ? 'wrote' : 'dry run —'} public/generated/ai/knowledge.json.gz`);
  console.log(`  ${index.counts.documents} documents · ${index.counts.bankQuestions} bank questions · ${index.counts.sections} sections`);
  console.log(`  ${index.counts.playbook} playbook items · ${index.counts.tracks} tracks · ${index.counts.courses} courses · ${index.counts.notebooks} notebooks`);
  console.log(`  index: ${(bytes / 1024 / 1024).toFixed(2)} MB raw · ${(compressedBytes / 1024 / 1024).toFixed(2)} MB gzip${written ? '' : ' — run with --write to save'}`);
}

if (require.main === module) {
  buildAiIndex().then((index) => {
    const write = process.argv.includes('--write');
    if (write) writeAiIndex(index);
    report(index, write);
  }).catch((error) => {
    console.error(`AI index generation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

module.exports = { buildAiIndex, writeAiIndex, OUT_PATH };
