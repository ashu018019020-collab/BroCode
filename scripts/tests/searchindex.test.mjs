/**
 * The question search index and the palette's deep search.
 *
 * Before this, Ctrl+K searched the curriculum only: ~2,000 authored items from sections.json. The
 * 13,865 bank questions — the app's largest body of content, and where every Playbook V15 item lives
 * — were unreachable, because the banks are 11 MB and no page loads more than one section.
 *
 * Three failure modes matter, and none of them throws:
 *
 *   · the index drifting from the banks (a stale artifact sends learners to questions that no longer
 *     exist, or hides ones that were just authored) — so the counts are re-derived from the banks;
 *   · a ranker that matches noise (measured live: a plain substring match made "cte" return 402
 *     questions because the letters sit inside "expe[cte]d"), burying the one right answer;
 *   · a hit that lands on a 644-question list instead of the question clicked — the deep link has to
 *     carry the query the bank will filter by.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

register('./_ts-resolve.mjs', import.meta.url);

const eng = await load('src/core/platform/searchindex.ts');
const { buildSearchIndex, TEXT_LIMIT } = await import(pathToFileURL(path.join(ROOT, 'scripts/searchindex.cjs')).href);

const raw = JSON.parse(read('public/generated/search/index.json'));
const index = eng.decodeIndex(raw);
const sections = JSON.parse(read('public/generated/curriculum/sections.json'));
const playbook = JSON.parse(read('public/generated/playbook/items.json'));
const bankIds = fs.readdirSync(path.join(ROOT, 'public', 'generated', 'questions')).filter((f) => f.endsWith('.json') && f !== 'manifest.json');

/** Every published bank question on disk, in the order the index promises to use. */
const bankRows = () => {
  const order = new Map(sections.map((s, i) => [s.id, i]));
  const out = [];
  for (const sid of bankIds.map((f) => f.replace(/\.json$/, '')).sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b))) {
    const bank = JSON.parse(read(`public/generated/questions/${sid}.json`));
    for (const q of bank.questions) {
      if (q.status && q.status !== 'PUBLISHED') continue;
      if (String(q.question ?? '').trim().length < 8) continue;
      out.push(q.id);
    }
  }
  return out;
};

/* --------------------------- the artifact is true --------------------------- */

test('index: every bank question is in it, and nothing else is', () => {
  const expected = bankRows();
  assert.equal(index.items.length, expected.length, 'row count must equal the published bank questions');
  assert.deepEqual(index.items.map((r) => r.id), expected, 'and in the same section-then-id order');
  assert.equal(new Set(index.items.map((r) => r.id)).size, index.items.length, 'ids must be unique');
  assert.equal(index.counts.items, index.items.length);
  assert.equal(index.counts.sections, new Set(index.items.map((r) => r.sectionId)).size);
  assert.equal(index.counts.playbook, index.items.filter((r) => eng.chapterOf(r)).length);
  assert.equal(index.counts.playbook, playbook.items.length, 'every V15 item reached a bank, so every one is searchable');
});

test('index: rows point at real sections and carry usable text', () => {
  const ids = new Set(sections.map((s) => s.id));
  for (const row of index.items) {
    assert.ok(ids.has(row.sectionId), `${row.id}: unknown section ${row.sectionId}`);
    assert.ok(row.id.startsWith(`${row.sectionId}:`), `${row.id}: id must belong to its section`,);
    assert.ok(row.text.trim().length >= 8, `${row.id}: text too short to search`);
    assert.ok(row.text.length <= TEXT_LIMIT, `${row.id}: ${row.text.length} chars exceeds the ${TEXT_LIMIT} budget`);
    assert.ok(!/[\n\r]/.test(row.text), `${row.id}: text must stay one line`);
  }
  assert.deepEqual(
    index.sections.map(([id]) => id).sort(),
    [...new Set(index.items.map((r) => r.sectionId))].sort(),
    'the section lookup table must cover exactly the sections present',
  );
});

test('index: the committed file IS the build output, byte for byte', () => {
  // No timestamp and no map iteration order: regenerating over unchanged banks must reproduce the
  // file, or the artifact's diff stops being reviewable and staleness becomes invisible.
  const rebuilt = JSON.stringify(buildSearchIndex());
  assert.equal(rebuilt, JSON.stringify(raw), 'public/generated/search/index.json is stale — run npm run search:index:write');
});

test('index: chapters ride along so a hit can name where it came from', () => {
  const manifest = JSON.parse(read('public/generated/playbook/manifest.json'));
  assert.deepEqual(
    index.chapters.map(([n]) => n),
    manifest.chapters.map((c) => String(c.no)),
    'the chapter table must mirror the playbook manifest',
  );
  // The manifest names the number `no`; reading `chapter` (the key in items.json) yields a table
  // keyed "undefined" whose lookups always miss — empty titles, no error, nothing to notice.
  assert.ok(!index.chapters.some(([n]) => !/^\d+$/.test(n)), 'no chapter row may be keyed by a missing field');
  assert.ok(!JSON.stringify(raw).includes('undefined'), 'the artifact must never contain the string "undefined"');
  const row = index.items.find((r) => eng.chapterOf(r));
  const chapter = eng.chapterOf(row);
  assert.match(chapter, /^\d+$/, 'a V15 row carries its chapter, not a difficulty');
  assert.ok(eng.chapterTitle(index, chapter).length > 0, 'and the chapter has a real title');
  assert.match(eng.detailFor(index, row), /Playbook V15 · ch\./, 'which the palette prints');
});

test('index: the palette pays about a tenth of a section bank for the whole set', () => {
  const bytes = Buffer.byteLength(JSON.stringify(raw));
  assert.ok(bytes < 2_000_000, `index is ${(bytes / 1024).toFixed(0)} KB — over the 2 MB budget`);
  assert.ok(bytes / index.items.length < 160, 'tuple rows must stay under 160 bytes each');
  assert.match(read('src/core/data/searchindex.ts'), /enabled/, 'the loader must be lazy — it is 1.6 MB');
  assert.match(read('public/sw.js'), /url\.pathname\.includes\('\/generated\/'\)/, 'and offline-cached');
});

/* ------------------------------- the ranking ------------------------------- */

test('search: a term matches at a word start, not inside another word', () => {
  // The bug this pins: with plain substring matching, "cte" returned 402 questions (expe[cte]d,
  // dire[cte]d, colle[cte]d …) and the actual CTE questions were buried under them.
  const cte = eng.searchBankIndex(index, 'cte', 40);
  assert.ok(cte.length > 0 && cte.length < 60, `"cte" returned ${cte.length} — boundary matching is off`);
  for (const h of cte) assert.match(h.row.text.toLowerCase(), /(^|[^a-z0-9])cte/, `${h.row.text} should not match`);

  const dijkstra = eng.searchBankIndex(index, 'dijkstra');
  assert.equal(dijkstra.length, 1, 'the V15 complexity question is the only Dijkstra question');
  assert.equal(dijkstra[0].row.sectionId, 's28');
  assert.equal(eng.chapterOf(dijkstra[0].row), '16');
});

test('search: ranks the subject of a question above a mention, and ANDs multiple terms', () => {
  const hits = eng.searchBankIndex(index, 'cte kya');
  assert.ok(hits.length > 0, 'two terms still find the CTE questions');
  for (const h of hits) {
    assert.ok(/cte/.test(h.row.text.toLowerCase()) && /kya/.test(h.row.text.toLowerCase()), 'every term must be present');
  }
  const scores = hits.map((h) => h.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'results must come back ranked');
  assert.equal(hits[0].row.text.startsWith('CTE'), true, 'the question ABOUT CTEs wins');

  assert.deepEqual(eng.searchBankIndex(index, 'c'), [], 'one character is not a search');
  assert.deepEqual(eng.searchBankIndex(index, '   '), [], 'whitespace is not a search');
  assert.deepEqual(eng.searchBankIndex(index, 'zzzzqqqqxyzzy'), [], 'no match means no rows');
  assert.ok(eng.searchBankIndex(index, 'sql', 5).length <= 5, 'the limit is respected');
});

test('search: is fast enough to run on every keystroke over the whole bank', () => {
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) eng.searchBankIndex(index, 'di', 12);
  const per = (Date.now() - t0) / 20;
  assert.ok(per < 60, `${per.toFixed(1)} ms per keystroke over ${index.items.length} rows is too slow`);
});

/* ------------------------- the deep link into the bank ------------------------- */

test('search: a hit routes to the question, not just to its section', () => {
  const row = index.items.find((r) => r.id === 's28:theory:56');
  const route = eng.routeFor(row);
  assert.match(route, /^\/questions\?/, 'the bank is the page that can answer it');
  const params = new URLSearchParams(route.split('?')[1]);
  assert.equal(params.get('section'), 's28');
  assert.equal(params.get('find'), row.text.slice(0, 60), 'the query the bank filters by');
  assert.equal(params.get('playbook'), '1', 'a V15 item also ticks the playbook filter');

  const plain = index.items.find((r) => !eng.chapterOf(r));
  assert.equal(new URLSearchParams(eng.routeFor(plain).split('?')[1]).get('playbook'), null,
    'a curriculum question must NOT tick the V15 filter');
  assert.ok(route.length < 220, 'the URL must stay short enough to share');

  // …and the bank really reads those params — the contract has two ends.
  const bank = read('src/features/practice/QuestionBank.tsx');
  assert.match(bank, /params\.get\('find'\)/, 'the bank seeds its search box from ?find=');
  assert.match(bank, /search: urlParams\(\)\.get\('find'\) \?\? ''/, 'and a section change keeps it');
});

test('search: the palette shows bank hits, and never calls a loading index "no results"', () => {
  const palette = read('src/components/shared/CommandPalette.tsx');
  assert.match(palette, /searchBankIndex\(bank, q, BANK_LIMIT\)/, 'the palette must search the bank');
  assert.match(palette, /bankLoading/, 'and it must know whether the index has arrived');
  assert.ok(
    palette.indexOf('No results for') < palette.indexOf('ko raha hai') ||
      /bankLoading && <div className="muted small" style=\{?\{? padding: 10 \}?\}?>Curriculum me kuch nahi mila/.test(palette),
    'an empty result list while the index loads must not read as "nothing found"',
  );
  // The index must not load until the palette is open.
  const app = read('src/app/App.tsx');
  assert.match(app, /useQuestionIndex\(paletteOpen\)/, 'App must pass the palette-open flag, not `true`');
});
