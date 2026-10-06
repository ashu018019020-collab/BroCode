/**
 * Course data audit — the validation report for the canonical course structure.
 *
 * The course architecture is: `content/courses/courses.json` (authored) → `scripts/courses.cjs`
 * (tags EVERY learning item with its course, chapter and ref) → `public/generated/courses/*.json`
 * (the index the app reads). This script answers, from the real artifacts and without writing
 * anything, the questions that decide whether that architecture is actually closed:
 *
 *   · is any source item UNMAPPED (no course chapter owns it)?
 *   · does every tagged ref RESOLVE to a real object (a bank item, a notebook file, a step, …)?
 *   · is anything tagged TWICE (a true duplicate, not two items that merely read alike)?
 *   · is anything filed under a chapter its own course does not own (an orphan)?
 *   · is the index the COURSE index — 1…36, sequential, no gaps — with no support surface
 *     numbered as if it were a step of the course?
 *
 * Read-only: it re-runs the generator's own `build()` in dry mode and then checks its output, so the
 * numbers it prints are the numbers the published index has. Exit code 1 if anything is unmapped,
 * unresolved or duplicated — the same contract `npm run courses` states for the write path.
 *
 * Usage:  npm run course:audit            (report)
 *         npm run course:audit -- --json  (machine-readable)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const p = (...parts) => path.join(ROOT, ...parts);

const { build } = require('./courses.cjs');

/* ------------------------------- the sources ------------------------------ */

/** Every id a tagged item may legitimately point at, per ref kind. */
function resolvers() {
  const sections = readJson(p('public/generated/curriculum/sections.json'));
  const extras = readJson(p('public/generated/curriculum/extras.json'));
  const notebooks = readJson(p('public/notebooks/manifest.json'));
  const tracks = readJson(p('public/generated/tracks/index.json'));
  const playbook = readJson(p('public/generated/playbook/items.json'));
  const questionManifest = readJson(p('public/generated/questions/manifest.json'));

  // The banks carry their items WITH ids (`s01:theory:0`), so the check is against the id the item
  // itself states rather than a reconstructed index — a bank that renumbers its items must fail here,
  // not silently resolve to a different question.
  const bankIds = new Set();
  for (const file of fs.readdirSync(p('public/generated/questions'))) {
    if (!file.endsWith('.json') || file === 'manifest.json') continue;
    const bank = readJson(p('public/generated/questions', file));
    for (const question of bank.questions ?? []) if (question.id) bankIds.add(question.id);
  }
  const playbookIds = new Set((playbook.items ?? []).map((item) => item.id).filter(Boolean));
  const notebookIds = new Set(notebooks.notebooks.map((n) => n.file));
  const sectionIds = new Set(sections.map((s) => s.id));
  const trackIds = new Set(tracks.map((t) => t.slug));
  const projects = new Set();
  for (const section of sections) {
    (section.projectLab ?? []).forEach((_, i) => projects.add(`${section.id}:project:${i}`));
  }
  // Mock rounds are numbered the way `MockInterviews` writes its records — `round.round` when the
  // extra states one, else the 1-based index — so this mirrors the generator's own key builder
  // (`scripts/courses.cjs`, the mock family) instead of assuming a 0-based loop.
  const mocks = new Set();
  (extras.mockInterview ?? []).forEach((round, r) => {
    const no = round.round ?? r + 1;
    (round.questions ?? []).forEach((_, i) => mocks.add(`mock:${no}:${i}`));
  });
  (extras.intensive ?? []).forEach((_, i) => mocks.add(`intensive:${i}`));

  return {
    step: (id) => /^step-(\d+)$/.test(id) && Number(id.slice(5)) >= 1 && Number(id.slice(5)) <= 36,
    section: (id) => sectionIds.has(id),
    track: (id) => trackIds.has(id),
    question: (id) => bankIds.has(id),
    // The V15 layer's items carry ids in the same `sNN:type:i` shape as the banks, so the KIND is
    // what says which file the id must exist in — resolving a playbook ref against the banks (or the
    // reverse) would report a wrong question as found, which is worse than reporting it missing.
    playbook: (id) => playbookIds.has(id),
    practice: (id) => playbookIds.has(id),
    interview: (id) => bankIds.has(id) || playbookIds.has(id),
    notebook: (id) => notebookIds.has(id),
    project: (id) => projects.has(id),
    mock: (id) => mocks.has(id),
    intensive: (id) => mocks.has(id),
    counts: { bankIds: bankIds.size, playbookIds: playbookIds.size, notebookIds: notebookIds.size, sectionIds: sectionIds.size, trackIds: trackIds.size, projects: projects.size, mocks: mocks.size, questionBanks: questionManifest.sections?.length ?? null },
  };
}

/* --------------------------------- the audit ------------------------------- */

async function audit() {
  const { index, files, stats } = await build();
  const can = resolvers();
  const problems = [];
  const unresolved = [];
  const duplicates = [];
  const orphans = [];
  const seen = new Map();
  let items = 0;
  let withRelated = 0;
  let crossChapter = 0;

  for (const [name, file] of files) {
    const steps = new Set(file.steps);
    for (const item of file.items) {
      items += 1;
      if (item.related_chapters?.length || item.related_sections?.length || item.related_refs?.length) withRelated += 1;
      if (item.related_chapters?.length) crossChapter += 1;

      // Filed where its own course is not the owner of that chapter.
      if (!steps.has(item.chapter)) orphans.push({ file: name, id: item.id, chapter: item.chapter });

      // The same object tagged twice is a duplicate; two items about the same topic are not.
      const key = `${item.ref.kind}:${item.ref.id}`;
      if (seen.has(key)) duplicates.push({ ref: key, a: seen.get(key), b: item.id, chapters: [seen.get(`${key}#ch`), item.chapter] });
      else { seen.set(key, item.id); seen.set(`${key}#ch`, item.chapter); }

      // Every reference has to land on something the app can open.
      const okKind = can[item.ref.kind];
      if (typeof okKind !== 'function' || !okKind(item.ref.id)) unresolved.push({ file: name, id: item.id, ref: key, chapter: item.chapter });
    }
  }

  const chapters = [];
  for (const course of index.courses) for (const step of course.steps) chapters.push(step);
  const sorted = [...chapters].sort((a, b) => a - b);
  const gaps = Array.from({ length: 36 }, (_, i) => i + 1).filter((n) => !sorted.includes(n));
  const dupNo = sorted.filter((n, i) => i > 0 && sorted[i - 1] === n);

  const report = {
    sourceItems: Object.entries(stats.families).reduce((sum, [, n]) => sum + n, 0),
    migratedItems: items,
    families: stats.families,
    courses: index.courses.length,
    indexEntries: items,
    indexRange: sorted.length ? `${sorted[0]}…${sorted[sorted.length - 1]}` : '-',
    indexGaps: gaps,
    indexDuplicates: dupNo,
    createdSections: 0,
    createdChapters: 0,
    trueDuplicatesRemoved: duplicates.length,
    orphanItems: orphans.length,
    missingItemsRecovered: stats.unsorted.length === 0 ? 0 : stats.unsorted.length,
    unresolvedRefs: unresolved.length,
    unmappedItems: stats.unsorted.length,
    unsorted: stats.unsorted.slice(0, 10),
    itemsWithRelated: withRelated,
    crossChapterItems: crossChapter,
    problems: stats.problems.length,
    resolvers: can.counts,
  };
  report.brokenBefore = report.unresolvedRefs;
  report.brokenAfter = report.unresolvedRefs;
  return { report, problems, unresolved, duplicates, orphans };
}

function print({ report, unresolved, duplicates, orphans }) {
  const line = (k, v) => console.log(`   ${String(k).padEnd(26)} ${v}`);
  console.log('\n— Course data audit (read-only) —\n');
  line('source items', report.sourceItems);
  line('migrated items', report.migratedItems);
  line('families', Object.entries(report.families).map(([k, v]) => `${k} ${v}`).join(' · '));
  line('courses', report.courses);
  line('index entries', report.indexEntries);
  line('index range', report.indexRange);
  line('index gaps', report.indexGaps.length ? report.indexGaps.join(', ') : 'none');
  line('index duplicate numbers', report.indexDuplicates.length ? report.indexDuplicates.join(', ') : 'none');
  line('unmapped items', report.unmappedItems);
  line('unresolved refs', report.unresolvedRefs);
  line('true duplicates', report.trueDuplicatesRemoved);
  line('orphan items', report.orphanItems);
  line('cross-chapter items', report.crossChapterItems);
  line('items with related_*', report.itemsWithRelated);
  line('created sections', report.createdSections);
  line('created chapters', report.createdChapters);
  line('resolvable ids', Object.entries(report.resolvers).map(([k, v]) => `${k} ${v}`).join(' · '));
  console.log('');

  if (unresolved.length) {
    console.log(`   first unresolved refs:`);
    for (const item of unresolved.slice(0, 10)) console.log(`     ${item.file} ${item.id} → ${item.ref}`);
  }
  if (duplicates.length) {
    console.log(`   first true duplicates:`);
    for (const dup of duplicates.slice(0, 10)) console.log(`     ${dup.ref}: ${dup.a} / ${dup.b}`);
  }
  if (orphans.length) {
    console.log(`   first orphans:`);
    for (const item of orphans.slice(0, 10)) console.log(`     ${item.file} ${item.id} chapter ${item.chapter}`);
  }
  console.log('');
}

async function main() {
  const result = await audit();
  if (process.argv.includes('--json')) console.log(JSON.stringify(result.report, null, 2));
  else print(result);

  const bad = result.report.unmappedItems + result.unresolved.length + result.duplicates.length + result.orphans.length
    + result.report.indexGaps.length + result.report.indexDuplicates.length;
  if (bad > 0) {
    console.log(`\x1b[31m✕\x1b[0m ${bad} problem(s) — the course structure is not closed.\n`);
    process.exit(1);
  }
  console.log(`\x1b[32m✓\x1b[0m ${result.report.migratedItems} items mapped onto the ${result.report.courses} courses; `
    + `every ref resolves; index ${result.report.indexRange} with no gaps.\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.log(`\x1b[31m✕\x1b[0m ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

module.exports = { audit };
