/**
 * The optional AI engine: the proxy's contract, the client's grounding, and the promise that a
 * missing model degrades to the local answer instead of breaking the chat.
 *
 * These are the parts a screenshot cannot show: that the key never reaches the browser, that the
 * model is handed the course rather than asked to remember it, and that every upstream failure
 * (no key, 404 on a dev server, HTML instead of JSON, empty text, network throw) returns null.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

register('./_ts-resolve.mjs', import.meta.url);

const llm = await load('src/core/ai/llm.ts');
const proxy = (await import(pathToFileURL(path.join(ROOT, 'api', 'ai', 'chat.js')).href)).default;

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

/* ------------------------------ the client ------------------------------ */

test('llm: the prompt carries the lesson excerpts, not a request to remember them', () => {
  const messages = llm.buildMessages('What is a decorator?', {
    passages: ['[Decorators · s28]\nA decorator wraps a function and adds behaviour.'],
    lang: 'hi',
    history: [
      { role: 'learner', text: 'python functions' },
      { role: 'mentor', text: 'Functions are reusable blocks.' },
    ],
  });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /A decorator wraps a function/);
  assert.match(messages[0].content, /CURRICULUM EXCERPTS/);
  assert.ok(messages.some((m) => /Hinglish/.test(m.content)), 'a Hindi answer is asked for in Hinglish');
  assert.deepEqual(messages.at(-1), { role: 'user', content: 'What is a decorator?' });
  assert.ok(messages.some((m) => m.role === 'assistant' && m.content === 'Functions are reusable blocks.'));
});

test('llm: with no excerpt the prompt says so instead of pretending', () => {
  const [system] = llm.buildMessages('what is quantum gardening');
  assert.match(system.content, /nothing in the course matched this question/);
});

test('llm: an answer that arrives is trimmed, bounded and named', async () => {
  const answer = await llm.askLlm('what is a tuple', {}, {
    fetch: async () => jsonResponse({ reply: '  A tuple is immutable.  ', model: 'test-model' }),
  });
  assert.deepEqual(answer, { text: 'A tuple is immutable.', model: 'test-model' });
});

test('llm: every failure is null, so the local answer survives', async () => {
  const cases = [
    ['not configured', async () => jsonResponse({ error: 'not_configured' }, 503)],
    ['dev server returning index.html', async () => jsonResponse('<!doctype html><html></html>')],
    ['empty reply', async () => jsonResponse({ reply: '   ' })],
    ['upstream error', async () => jsonResponse({ error: 'upstream' }, 502)],
    ['network throw', async () => { throw new Error('offline'); }],
  ];
  for (const [label, handler] of cases) {
    assert.equal(await llm.askLlm('anything', {}, { fetch: handler }), null, label);
  }
  assert.equal(await llm.askLlm('   ', {}, { fetch: async () => jsonResponse({ reply: 'x' }) }), null);
});

test('llm: the status probe reports a configured model and never throws', async () => {
  assert.deepEqual(await llm.llmStatus({ fetch: async () => jsonResponse({ configured: true, model: 'm1' }) }),
    { configured: true, model: 'm1' });
  assert.deepEqual(await llm.llmStatus({ fetch: async () => jsonResponse('not json') }),
    { configured: false, model: null });
  assert.deepEqual(await llm.llmStatus({ fetch: async () => { throw new Error('offline'); } }),
    { configured: false, model: null });
});

test('llm: the browser bundle never holds a key or a provider URL', () => {
  const client = read('src/core/ai/llm.ts');
  assert.doesNotMatch(client, /process\.env/, 'the client cannot read server secrets');
  assert.doesNotMatch(client, /sk-[A-Za-z0-9]/, 'no key literal');
  assert.doesNotMatch(client, /api\.openai\.com|api\.z\.ai/, 'the provider is chosen on the server');
  assert.match(client, /'\/api\/ai\/chat'/, 'exactly one endpoint: the same-origin proxy');
});

/* ------------------------------- the proxy ------------------------------- */

function callProxy({ method = 'POST', body, key } = {}) {
  const previous = process.env.LLM_API_KEY;
  if (key === undefined) delete process.env.LLM_API_KEY;
  else process.env.LLM_API_KEY = key;
  const result = { status: 0, body: null, headers: {} };
  const res = {
    set statusCode(value) { result.status = value; },
    get statusCode() { return result.status; },
    setHeader(name, value) { result.headers[name] = value; },
    end(payload) { result.body = JSON.parse(payload); },
  };
  return proxy({ method, body }, res).then(() => {
    if (previous === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previous;
    return result;
  });
}

test('proxy: without a key it says so instead of failing the chat', async () => {
  const health = await callProxy({ method: 'GET' });
  assert.deepEqual(health.body, { configured: false, model: null });
  const post = await callProxy({ body: { messages: [{ role: 'user', content: 'hi' }] } });
  assert.equal(post.status, 503);
  assert.equal(post.body.error, 'not_configured');
});

test('proxy: a configured key is used server-side and the reply is returned', async () => {
  const previousFetch = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    return jsonResponse({ model: 'upstream-model', choices: [{ message: { content: 'Grounded answer.' } }] });
  };
  try {
    const result = await callProxy({ key: 'test-key', body: { messages: [{ role: 'user', content: 'hi' }] } });
    assert.equal(result.status, 200);
    assert.equal(result.body.reply, 'Grounded answer.');
    assert.equal(result.body.model, 'upstream-model');
    assert.match(seen.url, /\/chat\/completions$/, 'any OpenAI-compatible base works');
    assert.equal(seen.init.headers.Authorization, 'Bearer test-key');
    assert.equal(result.headers['Cache-Control'], 'no-store');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('proxy: bad method, bad body and oversized prompts are refused', async () => {
  assert.equal((await callProxy({ method: 'PUT', key: 'k' })).status, 405);
  assert.equal((await callProxy({ key: 'k', body: { messages: [] } })).status, 400);
  assert.equal((await callProxy({ key: 'k', body: { messages: [{ role: 'system', content: '' }] } })).status, 400);
  const many = Array.from({ length: 40 }, (_, i) => ({ role: 'user', content: `q${i}` }));
  const previousFetch = globalThis.fetch;
  let forwarded = null;
  globalThis.fetch = async (_url, init) => {
    forwarded = JSON.parse(init.body);
    return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
  };
  try {
    await callProxy({ key: 'k', body: { messages: many } });
    assert.ok(forwarded.messages.length <= 16, 'the proxy caps how much an anonymous caller can spend');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('proxy: an upstream failure is a readable 502, never a hang', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ error: { message: 'bad model' } }, 400);
  try {
    const result = await callProxy({ key: 'k', body: { messages: [{ role: 'user', content: 'hi' }] } });
    assert.equal(result.status, 502);
    assert.equal(result.body.message, 'bad model');
  } finally {
    globalThis.fetch = previousFetch;
  }
});
