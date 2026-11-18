/**
 * /course/sql once carried its own static "Modules & topics" catalog and its own totals beside the
 * Masterclass panel, so the same 37 modules were listed twice and the two copies could disagree.
 * The panel is the single owner of modules, topics, counts and progress; the page supplies a header.
 *
 * The page is .tsx and the test loader resolves only .ts, so it is read as TEXT — the same approach
 * `course-banks.test.mjs` takes for the Question Bank. That is enough: a second catalog has to read
 * the artifact's modules or stats to reach the screen, which is what these rules forbid.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const page = read('src/features/courses/SqlCoursePage.tsx');

test('/course/sql renders the shared Masterclass panel', () => {
  assert.match(
    page,
    /import \{[^}]*\bMasterclassPanel\b[^}]*\} from '\.\.\/labs\/SqlMasterclass';/,
    'the module list must come from the shared panel, not a local copy',
  );
  assert.match(page, /<MasterclassPanel\s[^>]*file=\{file\}/, 'the panel must be given the published artifact');
  assert.match(
    read('src/features/courses/CoursePage.tsx'),
    /slug === 'sql' \? <SqlCoursePage \/>/,
    'the sql catalog slug must route to this page',
  );
});

test('/course/sql keeps the open module and bank in the URL', () => {
  assert.match(page, /useSearchParams\(\)/, 'the page must read the selection from the URL');
  assert.match(page, /masterclassSelection\(params,/, 'the params go through the shared validator');
  assert.match(
    page,
    /<MasterclassPanel[\s\S]*?moduleId=\{selection\.moduleId\}[\s\S]*?bank=\{selection\.bank\}[\s\S]*?level=\{selection\.level\}/,
    'the panel must be controlled by the URL selection',
  );
  assert.match(page, /onLevelChange=\{\(level\) => select\(\{ level \}\)\}/, 'changing the level must write the URL');
  assert.match(page, /onModuleChange=\{\(moduleId\) => select\(\{ moduleId \}\)\}/, 'opening a module must write the URL');
  // One place, two pages: the Lab reads the same two params and the link between them carries both.
  assert.match(read('src/features/labs/SQLLab.tsx'), /masterclassSelection\(/, 'the Lab must read the same selection');
  const panel = read('src/features/labs/SqlMasterclass.tsx');
  assert.match(
    panel,
    /\?module=\$\{module\.id\}&bank=\$\{bank\}&level=\$\{level\}/,
    'the Lab link must carry the module and the bank',
  );
  assert.match(panel, /example=\$\{topic\.id\}/, 'every topic example must link into the Lab');
  const lab = read('src/features/labs/SQLLab.tsx');
  assert.match(lab, /selection\.topicId/, 'the Lab must load the example the link names');
  assert.match(lab, /level=\{selection\.level\}/, 'the Lab must share the same level');
});

test('/course/sql owns no module list or counts', () => {
  // The ONE module read the page needs is the URL validator's; a second read is the removed catalog.
  assert.equal((page.match(/\bfile\??\.modules\b/g) ?? []).length, 1, 'module ids are read only to validate the URL');
  assert.match(page, /masterclassSelection\(params, file\?\.modules/, 'that read belongs to the shared validator');
  assert.doesNotMatch(page, /\{[^}]*\bmodules\b[^}]*\}\s*=\s*file/, 'a destructured module list is the same second catalog');
  // Counts are the panel's business too: any stats read duplicates the header number it prints.
  assert.doesNotMatch(page, /\bfile\??\.stats\b/, 'the panel already prints the totals');
});

test('the panel publishes each module’s authored schema', () => {
  const panel = read('src/features/labs/SqlMasterclass.tsx');
  // The disclosure belongs to the module, not to a lab existing: MySQL and SQLite have no lab route.
  assert.match(panel, /\{labSchema\.length > 0 && \(/, 'the schema must render even where no lab exists');
  assert.match(panel, /navigator\.clipboard\?\.writeText\(schemaText\)/, 'the authored DDL must be copyable');
  assert.match(panel, /Copy setup/, 'the copy action must be labelled');
  assert.match(panel, /Run this module in SQL Lab/, 'the lab jump stays for the course that has one');
});
