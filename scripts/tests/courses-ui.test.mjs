/**
 * The courses UI: the 11-course grid, the course step index and the 7-tab step page.
 *
 * The data side of courses is already pinned by `courses.test.mjs` (every item tagged, artifacts
 * byte-equal to their generator). This file pins what the SCREENS do with it:
 *
 *   · the seven tabs are the plan's seven, in its order — a reordered tab is a changed promise;
 *   · every logo the pack names is bundled offline, and no bundled mark is left orphaned;
 *   · a lab shortcut points at a real route, mapped the way the plan says (SQL → step 8, RAG →
 *     step 20, Agentic → steps 23–28, Projects → step 30), and a step with no lab says so;
 *   · a step with sections divides by their mastery, a step without sections by item coverage,
 *     and a reading-only step reports NO percentage rather than a 0%;
 *   · /courses, /course/:slug and /course/:slug/:step are registered in all five places, and
 *     every `courses.*` string the screens use exists in BOTH language packs.
 *
 * Zero dependencies — node:test, `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// The pure engine imports nothing at all, which is what makes it loadable without the TS hook.
const cs = await load('src/core/learning/courses.ts');
const paths = await load('src/core/learning/paths.ts');

const index = JSON.parse(read('public/generated/courses/index.json'));
const appSrc = read('src/app/App.tsx');
const routes = new Set([...appSrc.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));

/* ------------------------------- the tabs -------------------------------- */

test('courses: the step page has the plan’s seven tabs, in its order', () => {
  assert.deepEqual(cs.COURSE_TABS, ['lesson', 'practice', 'questions', 'interview', 'lab', 'pdf', 'notes']);
  assert.equal(new Set(cs.COURSE_TABS).size, 7, 'a tab may not appear twice');
  assert.ok(cs.isCourseTab('practice') && cs.isCourseTab('notes'));
  assert.ok(!cs.isCourseTab('projects') && !cs.isCourseTab(null), 'an unknown tab must fall back, not render empty');
  for (const tab of cs.COURSE_TABS) {
    assert.ok(cs.TAB_KEY[tab], `${tab} has no locale key`);
  }
});

test('courses: tab items are a filter over the step’s own tags, never a second copy', () => {
  const items = [
    { id: 'a', course: 'python', chapter: 4, type: 'lesson', ref: { kind: 'section', id: 's01' }, tags: [] },
    { id: 'b', course: 'python', chapter: 4, type: 'practice', ref: { kind: 'playbook', id: 's01:interview:0' }, tags: [] },
    { id: 'c', course: 'python', chapter: 4, type: 'question', subtype: 'coding', ref: { kind: 'question', id: 's01:coding:0' }, tags: [] },
    { id: 'd', course: 'python', chapter: 4, type: 'interview', subtype: 'interview', ref: { kind: 'question', id: 's01:interview:0' }, tags: [] },
    { id: 'e', course: 'python', chapter: 4, type: 'lab', ref: { kind: 'notebook', id: 'python.ipynb' }, tags: [] },
    { id: 'f', course: 'python', chapter: 4, type: 'project', subtype: 'simple', ref: { kind: 'project', id: 's01:project:0' }, tags: [] },
    { id: 'g', course: 'python', chapter: 4, type: 'reference', ref: { kind: 'track', id: 'python' }, tags: [] },
    { id: 'h', course: 'python', chapter: 4, type: 'lesson', pdf_page: 12, ref: { kind: 'step', id: 'step-4' }, tags: [] },
    { id: 'x', course: 'python', chapter: 5, type: 'question', ref: { kind: 'question', id: 's02:theory:0' }, tags: [] },
  ];
  const own = cs.itemsOfStep(items, 4);
  assert.deepEqual(own.map((i) => i.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  assert.deepEqual(cs.tabItems(own, 'lesson').map((i) => i.id), ['a', 'h']);
  assert.deepEqual(cs.tabItems(own, 'lab').map((i) => i.id), ['e', 'f'], 'a build belongs to the lab tab');
  assert.deepEqual(cs.tabItems(own, 'pdf').map((i) => i.id), ['h']);
  assert.deepEqual(cs.tabItems(own, 'notes'), []);
  const counts = cs.tabCounts(own);
  assert.equal(counts.questions, 1);
  assert.equal(counts.interview, 1);
  assert.equal(counts.practice, 1);
});

test('courses: canonical items retain every related source reference', () => {
  const item = {
    id: 'interview-canonical',
    course: 'python',
    chapter: 4,
    type: 'interview',
    ref: { kind: 'mock', id: 'mock:1:0' },
    related_refs: [{ kind: 'mock', id: 'mock:2:3' }],
    tags: ['PYTHON'],
  };
  assert.deepEqual(cs.itemRefs(item), [item.ref, ...item.related_refs]);
  assert.equal(cs.anyItemRefTouched(item, (ref) => ref.id === 'mock:2:3'), true,
    'an attempt on a merged-away prompt still covers the canonical course item');
  assert.match(read('src/core/data/courses.ts'), /anyItemRefTouched\(item,/,
    'progress must read the canonical key and its preserved aliases');
});

test('courses: existing reference material opens already filtered to the owning section', () => {
  const stepPage = read('src/features/courses/StepPage.tsx');
  const concepts = read('src/features/learning/ConceptHub.tsx');
  const cheats = read('src/features/tools/CheatSheets.tsx');
  assert.match(stepPage, /\/concepts\?section=\$\{sec!\.id\}/);
  assert.match(stepPage, /\/cheat-sheets\?section=\$\{sec!\.id\}/);
  assert.match(concepts, /sectionFilter && s\.id !== sectionFilter/);
  assert.match(cheats, /sectionFilter && s\.id !== sectionFilter/);
});

/* ------------------------------- the logos -------------------------------- */

test('courses: every logo the pack names is bundled offline, with no orphan marks', () => {
  const dir = path.join(ROOT, 'src/assets/logos');
  const files = new Set(fs.readdirSync(dir));
  const named = new Set(index.courses.map((c) => c.logo));
  for (const logo of named) {
    assert.ok(files.has(`${logo}.svg`), `course logo "${logo}" has no src/assets/logos/${logo}.svg`);
  }
  for (const file of files) {
    if (!file.endsWith('.svg')) continue;
    assert.ok(named.has(file.slice(0, -4)), `src/assets/logos/${file} is not named by any course`);
  }
  // Every <img> needs alt text and a fallback — the rule the plan states for course logos.
  const logo = read('src/components/shared/CourseLogo.tsx');
  assert.match(logo, /alt=\{`\$\{name\} logo`\}/, 'the course logo must carry real alt text');
  assert.match(logo, /onError=\{\(\) => setFailed\(true\)\}/, 'a broken file must fall back to a mark');
});

/* ------------------------------ lab shortcuts ----------------------------- */

test('courses: authored lab relationships generate shortcuts to real routes', () => {
  const plan = JSON.parse(read('content/courses/courses.json'));
  const stepCourse = new Map(plan.courses.flatMap((course) => course.steps.map((step) => [step, course.slug])));
  for (const [rawStep, links] of Object.entries(plan.labRoutes)) {
    const step = Number(rawStep);
    const slug = stepCourse.get(step);
    assert.ok(slug, `lab step ${step} has no course owner`);
    for (const link of links) assert.ok(routes.has(link), `step ${step} shortcut ${link} has no <Route path>`);
    const courseFile = JSON.parse(read(`public/generated/courses/${slug}.json`));
    assert.deepEqual(courseFile.lab_routes[step], links, `step ${step} lab mapping drifted from the authored course map`);
  }
  assert.deepEqual(plan.labRoutes['8'], ['/sql'], 'C5 SQL Lab');
  assert.ok(plan.labRoutes['6'].includes('/numpy-pandas') && plan.labRoutes['7'].includes('/numpy-pandas'), 'C4 NumPy + Pandas');
  assert.ok(plan.labRoutes['4'].includes('/notebooks') && plan.labRoutes['5'].includes('/notebooks'), 'C3 Notebook Lab');
  for (const step of [18, 19, 20, 21, 22]) assert.ok(plan.labRoutes[String(step)].includes('/ai-lab'), `C8 step ${step} -> GenAI Lab`);
  assert.ok(plan.labRoutes['20'].includes('/rag-lab'), 'C8 step 20 -> RAG Lab');
  for (const step of [23, 24, 25, 26, 27, 28]) assert.deepEqual(plan.labRoutes[String(step)], ['/agentic'], `C9 step ${step}`);
  assert.deepEqual(plan.labRoutes['30'], ['/projects'], 'C10 step 30 -> mini projects');
  assert.equal(plan.labRoutes['13'], undefined, 'a step with no lab says so instead of borrowing one');
});

/* ------------------ notebooks are owned by their course chapter ------------------ */

/**
 * The notebooks are OWNED by the courses: `scripts/courses.cjs` tags each one as a `lab` item in
 * the chapter that owns its section (content/courses/courses.json's section map — the SAME map the
 * question bank and the project blueprints go through). These pins hold the ownership contract:
 *
 *   · every published notebook appears as exactly ONE lab item, in the course whose sections.json
 *     section it names — no orphans, no double ownership, no generic dumping ground;
 *   · every lab item resolves to a real published file (a reference to nothing cannot render);
 *   · the lab id follows the plan's own `<course>-<step>-lab-<seq>` convention, so the item sits
 *     in the chapter's sequence rather than floating outside it;
 *   · the step-page row opens the FILE (the same deep link the Learning Path chips use) and
 *     prints the notebook's real per-cell progress, so the course location is a HOME, not a
 *     pointer back to a shelf.
 */
test('courses: every notebook is owned by exactly one course chapter, cells intact', () => {
  const manifest = JSON.parse(read('public/notebooks/manifest.json'));
  const sections = JSON.parse(read('public/generated/curriculum/sections.json'));

  const index = JSON.parse(read('public/generated/courses/index.json'));

  // section → {course, step}, from the same authored map the generator used.
  const sectionOwner = new Map();
  for (const course of index.courses) {
    for (const [sid, step] of Object.entries(course.sections ?? {})) sectionOwner.set(sid, { slug: course.slug, step });
  }

  const labItems = [];
  for (const slug of index.courses.map((c) => c.slug)) {
    for (const item of JSON.parse(read(`public/generated/courses/${slug}.json`)).items) {
      if (item.ref?.kind === 'notebook') labItems.push({ course: slug, item });
    }
  }

  // One lab item per published notebook, in the course that owns its section.
  const byFile = new Map(labItems.map((x) => [x.item.ref.id, x]));
  for (const nb of manifest.notebooks) {
    const entry = byFile.get(nb.file);
    assert.ok(entry, `${nb.file} is published but no course owns it`);
    byFile.delete(nb.file);
    const owner = sectionOwner.get(nb.section);
    assert.ok(owner, `${nb.file} names section ${nb.section}, which no course maps`);
    assert.equal(entry.course, owner.slug, `${nb.file} must live in ${owner.slug} (section ${nb.section})`);
    assert.equal(entry.item.chapter, owner.step, `${nb.file} must sit in ${owner.slug}'s step ${owner.step} chapter`);
    assert.match(entry.item.id, new RegExp(`^${owner.slug}-${String(owner.step).padStart(2, '0')}-lab-\\d{4}$`),
      'the lab id follows the plan\'s own <course>-<step>-lab-<seq> convention');
    assert.ok(sections.some((s) => s.id === nb.section), `section ${nb.section} must exist in the curriculum`);
  }
  assert.deepEqual([...byFile.keys()], [], 'a lab item that names no published notebook is a dead reference');

  // The step page opens the FILE (deep link) and can compute real progress for it.
  const stepPage = read('src/features/courses/StepPage.tsx');
  assert.match(stepPage, /to=\{`\/notebooks\?nb=\$\{file\}`\}/, 'course lab rows must deep-link the notebook file');
  assert.match(stepPage, /notebookCellsRunFor\(state\.attempts, file\)/, 'course lab rows must show per-notebook progress');
  assert.match(stepPage, /item\.title \?\? meta\?\.title \?\? file/, 'the row falls back through title → manifest → file');

  // Code cells are counted from the published file, and the manifest agrees with it — the counts
  // the course row prints can never drift from the notebook the link opens.
  for (const nb of manifest.notebooks) {
    const pub = JSON.parse(read(`public/notebooks/${nb.file}`));
    const code = pub.cells.filter((c) => c.cell_type === 'code').length;
    assert.equal(code, nb.codeCells, `${nb.file}: manifest codeCells must equal the published file's`);
  }
});

test('courses: a step and a section always resolve to their owning course', () => {
  // The retired Learning Path used to answer "where is step 18 read?" with a page of its own.
  // These two resolvers answer it now, and they must agree with the PUBLISHED plan rather than
  // with a hand-typed list — that is what lets every surface point at a real course step.
  const index = JSON.parse(read('public/generated/courses/index.json'));
  for (const card of index.courses) {
    for (const step of card.steps) {
      assert.equal(cs.courseOfStep(index.courses, step)?.slug, card.slug,
        `step ${step} must resolve to ${card.slug}`);
    }
    for (const [sid, step] of Object.entries(card.sections ?? {})) {
      const own = cs.courseOfSection(index.courses, sid);
      assert.equal(own?.card.slug, card.slug, `${sid} must resolve to ${card.slug}`);
      assert.equal(own?.step, step, `${sid} must resolve to its own step (${step})`);
    }
  }
  // The eleven courses partition the roadmap: no step is homeless, and nothing resolves by guess.
  const published = [...new Set(index.courses.flatMap((c) => c.steps))].sort((a, b) => a - b);
  assert.deepEqual(published, Array.from({ length: 36 }, (_, i) => i + 1),
    'the courses must cover 1…36 exactly once each');
  assert.equal(cs.courseOfStep(index.courses, 99), null);
  assert.equal(cs.courseOfSection(index.courses, 's99'), null);
});
/* -------------------------------- measures -------------------------------- */

const item = (over = {}) => ({
  id: 'x', course: 'c', chapter: 1, type: 'question',
  ref: { kind: 'question', id: 's01:theory:0' }, tags: [], ...over,
});

test('courses: a step with sections divides by mastery, one without by item coverage', () => {
  const items = [
    item({ chapter: 4, type: 'lesson', ref: { kind: 'section', id: 's01' } }),
    item({ chapter: 4 }),
    item({ chapter: 4, type: 'reference', ref: { kind: 'track', id: 'python' } }),
  ];
  const sections = cs.measureStep({ step: 4, items, sectionPct: 42, isTouched: () => false });
  assert.equal(sections.source, 'sections');
  assert.equal(sections.pct, 42);
  assert.equal(sections.status, 'active');
  assert.equal(sections.items, 2, 'the reference track is navigation, not a measurable item');
  assert.equal(sections.touched, 0);

  const coverage = cs.measureStep({
    step: 9,
    items: [
      item({ chapter: 9 }),
      item({ chapter: 9, type: 'practice', ref: { kind: 'playbook', id: 's19:interview:0' } }),
      item({ chapter: 9, type: 'lesson', ref: { kind: 'step', id: 'step-9' } }),
    ],
    sectionPct: null,
    isTouched: (i) => i.type === 'question',
  });
  assert.equal(coverage.source, 'items');
  assert.equal(coverage.items, 2, 'the step’s own lesson has no record to count');
  assert.equal(coverage.touched, 1);
  assert.equal(coverage.pct, 50);
  assert.equal(coverage.status, 'active');

  const reading = cs.measureStep({
    step: 1,
    items: [item({ chapter: 1, type: 'lesson', ref: { kind: 'step', id: 'step-1' } })],
    sectionPct: null,
    isTouched: () => false,
  });
  assert.equal(reading.pct, null, 'a reading step is not 0%');
  assert.equal(reading.source, 'none');
  assert.equal(reading.status, 'new');
});

test('courses: 100% of a real denominator clears a step, and Continue skips reading steps', () => {
  const file = {
    slug: 'x', number: 1, name: 'X', tone: 'cyan', logo: 'brain', steps: [1, 4, 5], sections: { s01: 4 },
    counts: {}, items: [
      item({ chapter: 1, type: 'lesson', ref: { kind: 'step', id: 'step-1' } }),
      item({ chapter: 4, type: 'lesson', ref: { kind: 'section', id: 's01' } }),
      item({ chapter: 5 }),
    ],
  };
  const measures = cs.measureSteps(file, (step) => (step === 4 ? 100 : null), () => true);
  assert.equal(measures.get(4).status, 'clear');
  assert.equal(measures.get(1).pct, null);
  assert.equal(measures.get(5).pct, 100, 'the untracked step divides by its own items');

  const progress = cs.courseProgressFrom(measures);
  assert.equal(progress.steps.total, 3);
  assert.equal(progress.steps.clear, 2);
  assert.equal(progress.steps.measured, 2);
  assert.equal(progress.steps.started, 2);
  assert.equal(progress.pct, 100);
  assert.equal(cs.nextStep(file, measures), 1, 'everything measurable is clear → the first step');

  const cold = cs.measureSteps(file, () => null, () => false);
  assert.equal(cs.nextStep(file, cold), 4, 'step 01 has no denominator, so step 04 is the first workable one');

  const empty = cs.courseProgressFrom(new Map());
  assert.equal(empty.pct, null, 'no steps measured is not a 0%');
  assert.deepEqual(empty.steps, { total: 0, clear: 0, measured: 0, started: 0 });
});

test('courses: a course card without sections shows no ring, never a zero', () => {
  const card = { slug: 'de', number: 6, name: 'DE', tone: 'violet', logo: 'spark', steps: [9], sections: {}, counts: {} };
  assert.equal(cs.sectionAvg(card, () => 0), null);
  assert.equal(cs.sectionsClear(card, () => 100), 0);

  const backed = { ...card, sections: { s20: 13, s21: 15 } };
  assert.equal(cs.sectionAvg(backed, (sid) => (sid === 's20' ? 50 : 100)), 75);
  assert.equal(cs.sectionsClear(backed, (sid) => (sid === 's20' ? 50 : 100)), 1);
});

test('courses: a PDF page opens the book it belongs to', () => {
  assert.equal(cs.pdfSourceOf(item({ type: 'practice', pdf_page: 22, ref: { kind: 'playbook', id: 's01:interview:0' } })), 'playbook');
  assert.equal(cs.pdfSourceOf(item({ pdf_page: 13, ref: { kind: 'question', id: 's01:theory:0' } })), 'guide');
  assert.equal(cs.pdfSourceOf(item({ type: 'lesson', pdf_page: 3, ref: { kind: 'step', id: 'step-1' } })), 'playbook');
  assert.equal(cs.pdfSourceOf(item({ type: 'lesson', pdf_page: 7, ref: { kind: 'section', id: 's01' } })), 'guide');
  assert.equal(cs.pdfSourceOf(item({ type: 'lab', ref: { kind: 'notebook', id: 'x.ipynb' } })), null);

  const pages = cs.pdfPages([
    item({ type: 'practice', pdf_page: 22, ref: { kind: 'playbook', id: 'p1' } }),
    item({ type: 'lesson', pdf_page: 3, ref: { kind: 'step', id: 'step-1' } }),
    item({ type: 'practice', pdf_page: 22, ref: { kind: 'playbook', id: 'p2' } }),
    item({ pdf_page: 13, ref: { kind: 'question', id: 'q1' } }),
  ], 'playbook');
  assert.deepEqual(pages, [3, 22], 'pages dedupe and sort; the other book is not mixed in');
});

/* --------------------------- the dashboard strip -------------------------- */

test('courses: a card-only measure divides by the step’s own sections, and nothing else', () => {
  const card = {
    slug: 'python', number: 3, name: 'Python', tone: 'blue', logo: 'python',
    steps: [4, 5], sections: { s01: 4, s02: 4, s03: 5 }, counts: {},
  };
  const pct = { s01: 40, s02: 60, s03: 0 };
  const measures = cs.cardMeasures(card, (sid) => pct[sid] ?? 0);
  assert.equal(measures.get(4).pct, 50, 'a step with two sections averages them');
  assert.equal(measures.get(4).source, 'sections');
  assert.equal(measures.get(4).items, 0, 'the card carries no items — none may be invented');
  assert.equal(measures.get(5).pct, 0);
  assert.equal(cs.nextStep(card, measures), 4, 'the first not-clear measured step is the target');
  assert.equal(cs.nextStep(card, cs.cardMeasures(card, () => 100)), 4,
    'all measured steps clear → the first step, not a made-up one');

  const mixed = { ...card, steps: [4, 5, 6], sections: { s01: 4 } };
  const withGap = cs.cardMeasures(mixed, () => 30);
  assert.equal(withGap.get(6).pct, null, 'a step with no sections has no card-visible denominator');
  assert.equal(withGap.get(6).source, 'none');
});

test('courses: the active course is the started, unfinished one with the most mastery', () => {
  const card = (slug, number, sections, steps) => ({
    slug, number, name: slug, tone: 'cyan', logo: 'brain', steps, sections, counts: {},
  });
  const python = card('python', 3, { s01: 4 }, [4]);
  const genai = card('genai', 8, { s22: 18 }, [18]);
  const sql = card('sql', 5, { s19: 8 }, [8]);
  const de = card('de', 6, {}, [9, 10]);
  const pct = { s01: 40, s22: 70, s19: 100 };
  const of = (sid) => pct[sid] ?? 0;

  assert.equal(cs.activeCourse([python, genai, sql, de], of).slug, 'genai',
    'most mastery wins — not the lowest course number');
  assert.equal(cs.activeCourse([python, sql], of).slug, 'python',
    'a fully cleared course is not active');
  assert.equal(cs.activeCourse([python, de], of).slug, 'python',
    'a course with no sections is never picked — its card holds no activity to prove');
  assert.equal(cs.activeCourse([de], of), null);
  assert.equal(
    cs.activeCourse([python, card('stats', 2, { s25: 3 }, [3])], (sid) => (sid === 's01' || sid === 's25' ? 40 : 0)).slug,
    'stats', 'a tie goes to the lower course number');
  assert.equal(cs.activeCourse([de, card('x', 1, { s01: 4 }, [4])], () => 0), null,
    'no section work yet → no active course');
});

/* ----------------------------- registration ------------------------------- */

test('courses: a step URL is legal only when the step is the course\u2019s own', () => {
  const python = {
    slug: 'python', number: 3, name: 'Python', tone: 'blue', logo: 'python',
    steps: [4, 5], sections: {}, counts: {},
  };
  assert.equal(cs.hasStep(python, 4), true);
  assert.equal(cs.hasStep(python, 5), true);
  assert.equal(cs.hasStep(python, 30), false, 'step 30 belongs to another course — it may not print under Python');
  assert.equal(cs.hasStep(python, 0), false);
  assert.equal(cs.hasStep(python, 99), false);
  assert.equal(cs.hasStep({ ...python, steps: [] }, 4), false);

  // The global 1…36 test alone is what let /course/python/30 render another course's step.
  const stepPage = read('src/features/courses/StepPage.tsx');
  assert.match(stepPage, /hasStep\(course, no\)/, 'StepPage must validate the step against its own course');
  assert.match(stepPage, /courses\.stepNotFound/, 'a step the course does not own needs its own message');
});

test('courses: the three routes are registered in all five places', () => {
  for (const route of ['/courses', '/course/:slug', '/course/:slug/:step']) {
    assert.ok(routes.has(route), `${route} has no <Route path>`);
  }
  const navRoutes = new Set([...appSrc.matchAll(/\{\s*to:\s*'([^']+)'/g)].map((m) => m[1]));
  assert.ok(navRoutes.has('/courses'), 'NAV must carry the courses hub (label + icon source)');
  assert.match(read('src/core/platform/search.ts'), /route: '\/courses'/, 'the palette must find /courses');
  for (const route of ['/courses', '/course/:slug', '/course/:slug/:step']) {
    assert.ok(paths.PATH_ROUTE_ALLOWLIST.includes(route),
      `${route} must be allowlisted as owned by the courses grid`);
  }
  // The page files really exist next to their lazy imports.
  for (const page of ['CoursesHome', 'CoursePage', 'StepPage']) {
    assert.ok(fs.existsSync(path.join(ROOT, `src/features/courses/${page}.tsx`)), `${page}.tsx is missing`);
  }
  assert.match(appSrc, /lazy\(\(\) => import\('\.\.\/features\/courses\/CoursesHome'\)\)/);
});

test('courses: every courses.* string the screens use exists in BOTH language packs', () => {
  const locales = read('src/app/i18n/locales.ts');
  const enBlock = locales.slice(locales.indexOf('export const en ='), locales.indexOf('export type LocaleKey'));
  const hiBlock = locales.slice(locales.indexOf('export const hinglish'));
  const enKeys = new Set([...enBlock.matchAll(/'([^']+)':/g)].map((m) => m[1]));
  const hiKeys = new Set([...hiBlock.matchAll(/'([^']+)':/g)].map((m) => m[1]));

  const sources = [
    'src/features/courses/CoursesHome.tsx',
    'src/features/courses/CoursePage.tsx',
    'src/features/courses/StepPage.tsx',
    'src/features/learning/ConceptHub.tsx',
    'src/features/tools/CheatSheets.tsx',
    'src/core/learning/courses.ts',
    // The Dashboard's continue strip reuses courses.step / the unit keys, so it is scanned too.
    'src/features/dashboard/Dashboard.tsx',
  ];
  const used = new Set();
  // Quoted keys (t('courses.x'), TAB_KEY values, SUBTYPE_KEY values)…
  for (const file of sources) {
    for (const m of read(file).matchAll(/'(courses\.[a-zA-Z.]+)'/g)) used.add(m[1]);
  }
  // …plus the keys a template literal builds that a quoted scan cannot see.
  for (const status of ['new', 'active', 'clear']) used.add(`courses.status.${status}`);

  assert.ok(used.size >= 40, `expected the full key set, saw ${used.size}`);
  for (const key of used) {
    assert.ok(enKeys.has(key), `English pack is missing "${key}"`);
    assert.ok(hiKeys.has(key), `Hinglish pack is missing "${key}"`);
  }

  // The strip's own keys live outside `courses.*`, so they get their own pass.
  const dashKeys = new Set(
    [...read('src/features/dashboard/Dashboard.tsx').matchAll(/'(dash\.courses[A-Za-z]*)'/g)].map((m) => m[1]),
  );
  assert.ok(dashKeys.size >= 5, `expected the strip key set, saw ${dashKeys.size}`);
  for (const key of dashKeys) {
    assert.ok(enKeys.has(key), `English pack is missing "${key}"`);
    assert.ok(hiKeys.has(key), `Hinglish pack is missing "${key}"`);
  }
});
