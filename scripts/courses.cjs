#!/usr/bin/env node
/**
 * npm run courses | courses:write
 *
 * Derives the course index from data that already exists — it never edits authored content.
 * Sources, each tagged with course + chapter (step number) + type:
 *
 *   · 36 roadmap steps (roadmap.ts — the learning spine),
 *   · 29 curriculum sections (sections.json — chapters/questions carry section ids),
 *   · 8 tracks (views over the courses, derived by majority of their sections),
 *   · 476 Playbook practice items (chapter → step through the roadmap's own mapping),
 *   · 13,865 question-bank questions (section → step through content/courses/courses.json),
 *   · 5 notebooks, 87 project blueprints, and the mock/intensive interview-prep references.
 *
 * Dry run by default: it prints the count report and fails on any authored-map problem or an item
 * that fits no course (the "unsorted" bucket must stay empty). `--write` publishes
 * `public/generated/courses/index.json` plus one `<slug>.json` per course. Generated files are
 * byte-for-byte asserted against this builder by scripts/tests/courses.test.mjs, so artifact and
 * code ship together.
 *
 * Rules kept: content/ stays the only authored source; public/generated/ is never hand-edited; no
 * new dependencies; no route/key changes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'content', 'courses', 'courses.json');
const SECTIONS = path.join(ROOT, 'public', 'generated', 'curriculum', 'sections.json');
const EXTRAS = path.join(ROOT, 'public', 'generated', 'curriculum', 'extras.json');
const QUESTIONS_MANIFEST = path.join(ROOT, 'public', 'generated', 'questions', 'manifest.json');
const PLAYBOOK_MANIFEST = path.join(ROOT, 'public', 'generated', 'playbook', 'manifest.json');
const PLAYBOOK_ITEMS = path.join(ROOT, 'public', 'generated', 'playbook', 'items.json');
const TRACKS_INDEX = path.join(ROOT, 'public', 'generated', 'tracks', 'index.json');
const NOTEBOOKS = path.join(ROOT, 'public', 'notebooks', 'manifest.json');
const OUT = path.join(ROOT, 'public', 'generated', 'courses');

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`\x1b[31m✕\x1b[0m ${m}`);
const warn = (m) => console.log(`\x1b[33m⚠\x1b[0m ${m}`);

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const questionFile = (sectionId) => path.join(ROOT, 'public', 'generated', 'questions', `${sectionId}.json`);
const trackFile = (slug) => path.join(ROOT, 'public', 'generated', 'tracks', `${slug}.json`);

/** The earliest PDF page a section's page map mentions, or null. */
function firstPage(pages) {
  let min = null;
  for (const value of Object.values(pages ?? {})) {
    for (const page of Array.isArray(value) ? value : []) {
      if (typeof page === 'number' && (min === null || page < min)) min = page;
    }
  }
  return min;
}

/** One tagged item. Key order is fixed so the generated JSON is byte-stable. */
function makeItem({
  course, chapter, type, subtype, difficulty, title, pdf_page, primary_section,
  related_chapters, related_sections, related_courses, related_refs, ref, tags,
}) {
  return {
    id: '',
    course,
    chapter,
    type,
    ...(subtype ? { subtype } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...(title ? { title } : {}),
    ...(typeof pdf_page === 'number' ? { pdf_page } : {}),
    ...(primary_section ? { primary_section } : {}),
    ...(related_chapters?.length ? { related_chapters } : {}),
    ...(related_sections?.length ? { related_sections } : {}),
    ...(related_courses?.length ? { related_courses } : {}),
    ...(related_refs?.length ? { related_refs } : {}),
    ref,
    tags: Array.isArray(tags) ? tags : [],
  };
}

function normalizeInterviewText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

const PLAN_TYPES = ['lesson', 'practice', 'question', 'interview', 'lab', 'project', 'reference'];

/** Counts by plan type, plus the total. */
function countByType(items) {
  const counts = { total: items.length };
  for (const type of PLAN_TYPES) counts[type] = 0;
  for (const item of items) counts[item.type] = (counts[item.type] ?? 0) + 1;
  return counts;
}

/**
 * Build the whole derived index in memory.
 *
 * Returns `{ index, files, stats }`; nothing touches disk. The test calls this to prove the
 * published files match a fresh build.
 */
async function build() {
  const roadmap = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'learning', 'roadmap.ts')).href);
  const source = readJson(SOURCE);
  const courses = (source.courses ?? []).slice().sort((a, b) => a.number - b.number);

  const problems = [];
  const warnings = [];
  const unsorted = [];
  const interviewPrepReferences = { count: 0, ids: [] };

  /* ---- 1. the authored map: 11 courses partition 1…36, every section once ---- */

  if (courses.length !== 11) problems.push(`courses.json declares ${courses.length} courses, expected 11`);
  const stepOwner = new Map();
  const sectionOwner = new Map();

  for (const course of courses) {
    if (!course.slug || !course.name) problems.push(`course ${course.number}: slug and name are required`);
    for (const step of course.steps ?? []) {
      if (stepOwner.has(step)) problems.push(`step ${step} belongs to both ${stepOwner.get(step).slug} and ${course.slug}`);
      else stepOwner.set(step, course);
    }
    for (const [sectionId, step] of Object.entries(course.sections ?? {})) {
      if (sectionOwner.has(sectionId)) problems.push(`section ${sectionId} is mapped twice`);
      else sectionOwner.set(sectionId, { course, step });
      if (!(course.steps ?? []).includes(step)) problems.push(`${sectionId} maps to step ${step}, which is not a step of ${course.slug}`);
    }
  }
  for (let step = 1; step <= roadmap.STEP_COUNT; step += 1) {
    if (!stepOwner.has(step)) problems.push(`step ${step} belongs to no course`);
  }

  const labRoutesByCourse = new Map(courses.map((course) => [course.slug, {}]));
  for (const [rawStep, routes] of Object.entries(source.labRoutes ?? {})) {
    const step = Number(rawStep);
    const course = stepOwner.get(step);
    if (!Number.isInteger(step) || !course) {
      problems.push(`lab routes map to unknown roadmap step ${rawStep}`);
      continue;
    }
    if (!Array.isArray(routes) || routes.some((route) => typeof route !== 'string' || !/^\/[a-z0-9-]+$/.test(route))) {
      problems.push(`step ${step} has an invalid lab route list`);
      continue;
    }
    if (new Set(routes).size !== routes.length) problems.push(`step ${step} repeats a lab route`);
    labRoutesByCourse.get(course.slug)[step] = routes;
  }

  const interviewTopics = source.interviewTopics ?? {};
  for (const [category, step] of Object.entries(interviewTopics)) {
    if (!Number.isInteger(step) || !stepOwner.has(step)) {
      problems.push(`interview category "${category}" maps to unknown roadmap step ${step}`);
    }
  }

  /* ---- 2. chapter → step / page from the roadmap and the playbook manifest ---- */

  const book = readJson(PLAYBOOK_MANIFEST);
  const chapterPage = new Map(book.chapters.map((chapter) => [chapter.no, chapter.pdfPage]));
  const chapterSections = new Map(book.chapters.map((chapter) => [chapter.no, [
    ...new Set([chapter.sectionId, ...Object.keys(chapter.sections ?? {})].filter(Boolean)),
  ]]));
  const chapterStep = new Map();
  for (const step of roadmap.STEPS) for (const chapter of step.chapters) chapterStep.set(chapter, step.no);

  /* ---- 3. tag every family ---- */

  const byCourse = new Map(courses.map((course) => [course.slug, []]));
  const families = { steps: 0, sections: 0, tracks: 0, playbook: 0, questions: 0, notebooks: 0, projects: 0, interviewPrep: 0 };
  const push = (slug, item) => byCourse.get(slug).push(item);
  const ownerOf = (sectionId) => sectionOwner.get(sectionId);

  for (const step of roadmap.STEPS) {
    const course = stepOwner.get(step.no);
    const pages = step.chapters.map((chapter) => chapterPage.get(chapter)).filter((page) => typeof page === 'number');
    push(course.slug, makeItem({
      course: course.slug,
      chapter: step.no,
      type: 'lesson',
      subtype: step.kind,
      title: step.title,
      pdf_page: pages.length ? Math.min(...pages) : undefined,
      ref: { kind: 'step', id: `step-${step.no}` },
    }));
    families.steps += 1;
  }

  const sections = readJson(SECTIONS);
  for (const section of sections) {
    const owner = ownerOf(section.id);
    if (!owner) { unsorted.push({ family: 'section', id: section.id }); continue; }
    push(owner.course.slug, makeItem({
      course: owner.course.slug,
      chapter: owner.step,
      type: 'lesson',
      title: section.title,
      pdf_page: firstPage(section.pages),
      primary_section: section.id,
      ref: { kind: 'section', id: section.id },
    }));
    families.sections += 1;
  }

  const trackViews = readJson(TRACKS_INDEX);
  for (const entry of trackViews) {
    const track = readJson(trackFile(entry.slug));
    const owners = (track.chapters ?? []).map((chapter) => ownerOf(chapter.id)).filter(Boolean);
    const tally = new Map();
    for (const owner of owners) tally.set(owner.course.slug, (tally.get(owner.course.slug) ?? 0) + 1);
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!best) { unsorted.push({ family: 'track', id: entry.slug }); continue; }
    const course = courses.find((candidate) => candidate.slug === best[0]);
    const steps = [...new Set(owners.filter((owner) => owner.course.slug === best[0]).map((owner) => owner.step))].sort((a, b) => a - b);
    const sectionsForTrack = [...new Set((track.chapters ?? []).map((chapter) => chapter.id)
      .filter((sectionId) => ownerOf(sectionId)?.course.slug === best[0]))].sort();
    const primarySection = sectionsForTrack.find((sectionId) => ownerOf(sectionId).step === steps[0]);
    push(course.slug, makeItem({
      course: course.slug,
      chapter: Math.min(...steps),
      type: 'reference',
      title: track.title,
      primary_section: primarySection,
      related_chapters: steps.filter((step) => step !== Math.min(...steps)),
      related_sections: sectionsForTrack.filter((sectionId) => sectionId !== primarySection),
      ref: { kind: 'track', id: track.id },
    }));
    families.tracks += 1;
  }

  const playbookItems = readJson(PLAYBOOK_ITEMS).items;
  for (const item of playbookItems) {
    const step = chapterStep.get(item.chapter);
    const course = step ? stepOwner.get(step) : null;
    if (!course) { unsorted.push({ family: 'playbook', id: item.id }); continue; }
    push(course.slug, makeItem({
      course: course.slug,
      chapter: step,
      type: 'practice',
      subtype: item.type,
      difficulty: item.difficulty,
      pdf_page: chapterPage.get(item.chapter),
      primary_section: chapterSections.get(item.chapter)?.[0],
      related_sections: (chapterSections.get(item.chapter) ?? []).slice(1),
      ref: { kind: 'playbook', id: item.id },
    }));
    families.playbook += 1;
  }

  const questionsManifest = readJson(QUESTIONS_MANIFEST);
  for (const summary of questionsManifest.sections) {
    const owner = ownerOf(summary.sectionId);
    const bank = readJson(questionFile(summary.sectionId));
    const published = (bank.questions ?? []).filter((question) => question.status === 'PUBLISHED');
    if (published.length !== summary.published) {
      warnings.push(`${summary.sectionId}: bank holds ${published.length} published questions, manifest says ${summary.published}`);
    }
    for (const question of published) {
      if (!owner) { unsorted.push({ family: 'question', id: question.id }); continue; }
      const interview = question.type === 'interview' || question.type === 'defense';
      push(owner.course.slug, makeItem({
        course: owner.course.slug,
        chapter: owner.step,
        type: interview ? 'interview' : 'question',
        subtype: question.type,
        difficulty: question.difficulty,
        pdf_page: question.pdfPage,
        primary_section: summary.sectionId,
        ref: { kind: 'question', id: question.id },
        tags: (question.tags ?? []).slice(0, 3),
      }));
      families.questions += 1;
    }
  }

  const notebooks = readJson(NOTEBOOKS);
  for (const notebook of notebooks.notebooks ?? []) {
    const owner = ownerOf(notebook.section);
    if (!owner) { unsorted.push({ family: 'notebook', id: notebook.file }); continue; }
    push(owner.course.slug, makeItem({
      course: owner.course.slug,
      chapter: owner.step,
      type: 'lab',
      title: notebook.title,
      primary_section: notebook.section,
      ref: { kind: 'notebook', id: notebook.file },
      tags: notebook.level ? [notebook.level] : [],
    }));
    families.notebooks += 1;
  }

  for (const section of sections) {
    const owner = ownerOf(section.id);
    (section.projectLab ?? []).forEach((project, index) => {
      if (!owner) { unsorted.push({ family: 'project', id: `${section.id}:project:${index}` }); return; }
      push(owner.course.slug, makeItem({
        course: owner.course.slug,
        chapter: owner.step,
        type: 'project',
        subtype: project.tier,
        title: project.name,
        primary_section: section.id,
        ref: { kind: 'project', id: `${section.id}:project:${index}` },
      }));
      families.projects += 1;
    });
  }

  const extras = readJson(EXTRAS);
  const interviewByContent = new Map();
  const addInterview = (question, subtype, ref, category) => {
    interviewPrepReferences.count += 1;
    interviewPrepReferences.ids.push(ref);
    const step = interviewTopics[category];
    const interviewCourse = stepOwner.get(step);
    if (!interviewCourse) {
      unsorted.push({ family: 'interview', id: `${ref.kind}:${ref.id}`, category });
      return;
    }
    const q = normalizeInterviewText(question.q);
    const a = normalizeInterviewText(question.a);
    if (!q || !a) {
      unsorted.push({ family: 'interview', id: `${ref.kind}:${ref.id}`, reason: 'missing question or answer' });
      return;
    }
    const contentKey = `${q}\u0000${a}`;
    const existing = interviewByContent.get(contentKey);
    if (existing) {
      if (!existing.related_refs) existing.related_refs = [];
      existing.related_refs.push(ref);
      if (category && !existing.tags.includes(category)) existing.tags.push(category);
      if (step !== existing.chapter) {
        existing.related_chapters = [...new Set([...(existing.related_chapters ?? []), step])]
          .filter((related) => related !== existing.chapter).sort((x, y) => x - y);
      }
      if (interviewCourse.slug !== existing.course) {
        existing.related_courses = [...new Set([...(existing.related_courses ?? []), interviewCourse.slug])].sort();
      }
      return;
    }
    const item = makeItem({
      course: interviewCourse.slug,
      chapter: step,
      type: 'interview',
      subtype,
      title: question.q,
      ref,
      tags: category ? [category] : [],
    });
    interviewByContent.set(contentKey, item);
    push(interviewCourse.slug, item);
    families.interviewPrep += 1;
  };
  for (const [roundIndex, round] of (extras.mockInterview ?? []).entries()) {
    for (const [questionIndex, question] of (round.questions ?? []).entries()) {
      addInterview(
        question,
        'mock',
        { kind: 'mock', id: `mock:${round.round ?? roundIndex + 1}:${questionIndex}` },
        question.cat,
      );
    }
  }
  for (const [index, question] of (extras.intensive ?? []).entries()) {
    addInterview(question, 'intensive', { kind: 'intensive', id: `intensive:${index}` }, question.cat);
  }

  for (const chapter of book.chapters) {
    const actual = playbookItems.filter((item) => item.chapter === chapter.no).length;
    if (actual !== chapter.items) warnings.push(`playbook chapter ${chapter.no}: manifest says ${chapter.items} items, items.json holds ${actual}`);
  }

  /* ---- 4. derived ids + per-course files ---- */

  const files = new Map();
  for (const course of courses) {
    const items = byCourse.get(course.slug);
    items.sort((a, b) => a.chapter - b.chapter
      || a.type.localeCompare(b.type)
      || a.ref.kind.localeCompare(b.ref.kind)
      || a.ref.id.localeCompare(b.ref.id));
    const sequence = new Map();
    for (const item of items) {
      const key = `${item.chapter}:${item.type}`;
      const next = (sequence.get(key) ?? 0) + 1;
      sequence.set(key, next);
      item.id = `${course.slug}-${String(item.chapter).padStart(2, '0')}-${item.type}-${String(next).padStart(4, '0')}`;
    }
    files.set(`${course.slug}.json`, {
      slug: course.slug,
      number: course.number,
      name: course.name,
      tone: course.tone,
      logo: course.logo,
      steps: course.steps,
      sections: course.sections ?? {},
      lab_routes: labRoutesByCourse.get(course.slug),
      counts: countByType(items),
      items,
    });
  }

  // The index carries the same `lab_routes` the course files do, for the same reason `sections` is
  // here: the Labs hub resolves "which runtime does this topic open?" for all eleven courses at once,
  // and fetching eleven course files (python.json alone is 1.5 MB) to answer it would be absurd.
  // One authored map, published twice, never re-typed in a component.
  const index = {
    courses: courses.map((course) => ({
      slug: course.slug,
      number: course.number,
      name: course.name,
      tone: course.tone,
      logo: course.logo,
      steps: course.steps,
      sections: course.sections ?? {},
      lab_routes: labRoutesByCourse.get(course.slug),
      counts: countByType(byCourse.get(course.slug)),
    })),
    families,
    totals: { courses: courses.length, items: [...byCourse.values()].reduce((sum, items) => sum + items.length, 0) },
  };

  return { index, files, stats: { families, unsorted, problems, warnings, interviewPrepReferences } };
}

/* ----------------------------------- CLI ---------------------------------- */

async function main() {
  const write = process.argv.includes('--write');
  const { index, files, stats } = await build();

  console.log(`\n— Courses (${write ? 'write' : 'dry run'}) —\n`);
  const order = ['steps', 'sections', 'tracks', 'playbook', 'questions', 'notebooks', 'projects', 'interviewPrep'];
  console.log(`   ${order.map((key) => `${key} ${stats.families[key]}`).join(' · ')}`);
  console.log(`   courses: ${index.courses.length} · items: ${index.totals.items} · unsorted: ${stats.unsorted.length}\n`);

  for (const course of index.courses) {
    const counts = course.counts;
    console.log(`   ${String(course.number).padStart(2, '0')} ${course.slug.padEnd(24)} ${String(counts.total).padStart(6)} items  (${counts.lesson} lesson · ${counts.practice} practice · ${counts.question} question · ${counts.interview} interview · ${counts.lab} lab · ${counts.project} project · ${counts.reference} reference)`);
  }

  for (const warning of stats.warnings) warn(warning);
  for (const problem of stats.problems) bad(problem);
  for (const item of stats.unsorted) bad(`unsorted: ${item.family} ${item.id}`);

  if (stats.problems.length || stats.unsorted.length) {
    bad(`${stats.problems.length + stats.unsorted.length} problem(s) — nothing written.`);
    process.exit(1);
  }

  const total = order.reduce((sum, key) => sum + stats.families[key], 0);
  ok(`all ${total} items tagged; every step and section belongs to exactly one course`);

  if (!write) {
    console.log('\n   dry run — run: npm run courses:write\n');
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
  for (const [name, body] of files) fs.writeFileSync(path.join(OUT, name), JSON.stringify(body));
  ok(`wrote public/generated/courses/ (index.json + ${files.size} course files)`);
  console.log('');
}

if (require.main === module) {
  main().catch((error) => {
    bad(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = { build, countByType, firstPage };
