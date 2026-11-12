/**
 * Part 8 of the brief: the NumPy course uses the EXISTING assistant, not a second one.
 *
 * The integration is three couplings that a refactor could silently break — the scope kind the store
 * accepts, the page that publishes a scoped tutor, and the shell that opens the dock on a custom event.
 * None of these files can be imported by a test (they are .tsx / React), so the contract is read as
 * text, the same way `playbook.test.mjs` holds the route table.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('the tutor scope accepts a module scope', () => {
  const scope = read('src/components/shared/tutorScope.ts');
  assert.match(scope, /kind:\s*'step'\s*\|\s*'build'\s*\|\s*'module'/);
  assert.match(scope, /export function usePublishTutorScope/);
});

test('the NumPy module publishes a scoped tutor with real context', () => {
  const page = read('src/features/numpy-mastery/NWorkspace.tsx');
  assert.match(page, /usePublishTutorScope\(\{/);
  assert.match(page, /kind: 'module'/);
  assert.match(page, /chapterTitle: module\.title/);
  assert.match(page, /untouched: \$\{untouched\.join/);
  const prompts = page.match(/prompts: \[[\s\S]*?\],/);
  assert.ok(prompts, 'no prompts published');
  assert.ok((prompts[0].match(/`/g) || []).length >= 2 || prompts[0].split('\n').length >= 4,
    'the scoped tutor needs several starter prompts');
});

test('the shell opens the same dock on the page event', () => {
  const app = read('src/app/App.tsx');
  assert.match(app, /addEventListener\('bi:open-ai', open\)/);
  assert.match(app, /removeEventListener\('bi:open-ai', open\)/);
  const page = read('src/features/numpy-mastery/NWorkspace.tsx');
  assert.match(page, /dispatchEvent\(new CustomEvent\('bi:open-ai'\)\)/);
});

test('there is exactly one assistant dock, and the course does not add another', () => {
  const app = read('src/app/App.tsx');
  assert.equal((app.match(/<AiDock /g) || []).length, 1);
  const page = read('src/features/numpy-mastery/NWorkspace.tsx');
  assert.ok(!/AiDock|AssistantCard/.test(page), 'the course must not render its own assistant');
});
