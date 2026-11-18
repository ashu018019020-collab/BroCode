/**
 * /course/sql once carried its own static "Modules & topics" catalog beside the Masterclass panel,
 * so the same 37 modules were listed twice and the two copies could disagree. The panel is the single
 * owner of modules, topics, progress and outcomes; the page supplies only the course header.
 *
 * The page is .tsx, and the test loader only resolves .ts, so it is read as TEXT — the same approach
 * `course-banks.test.mjs` takes for the Question Bank. That is enough for this rule: a second static
 * catalog has to appear in this file to reach the screen.
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
    /import \{ MasterclassPanel \} from '\.\.\/labs\/SqlMasterclass';/,
    'the module list must come from the shared panel, not a local copy',
  );
  assert.match(
    page,
    /<MasterclassPanel\s[^>]*file=\{file\}/,
    'the panel must be given the published artifact',
  );
  assert.match(
    read('src/features/courses/CoursePage.tsx'),
    /slug === 'sql' \? <SqlCoursePage \/>/,
    'the sql catalog slug must route to this page',
  );
});

test('/course/sql owns no second module catalog', () => {
  // A second catalog means the page walks the artifact itself — the panel already does that.
  assert.doesNotMatch(page, /\bfile\.modules\b/, 'the page must not read the module list');
  assert.doesNotMatch(
    page,
    /(?:\bmodules|\.topics)\s*\.\s*(?:map|filter|reduce|forEach|flatMap)\s*\(/,
    'the page must not iterate modules or topics',
  );
  // The removed catalog was a <details> block headed "Modules & topics" with its own count line.
  assert.doesNotMatch(page, /<details\b/, 'a second catalog was a <details> block');
  assert.doesNotMatch(page, /Modules\s*(?:&|and)\s*topics/i, 'the panel already labels that list');
  // Counts are the panel's business too: re-summing the six bank families here is the duplicate
  // header stats that were removed (and made the page and the panel able to print different totals).
  assert.doesNotMatch(
    page,
    /stats\.(?:learn|interview|labs|logic|debug|revision)/,
    'the page must not recompute the bank-item total',
  );
  assert.doesNotMatch(page, /sql-module/, 'the removed catalog styles must not come back');
  assert.doesNotMatch(
    read('src/styles/06-pages.css'),
    /\.sql-module/,
    'the stylesheet must not carry the removed catalog rules',
  );
});
