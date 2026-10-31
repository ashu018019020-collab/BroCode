/**
 * PostHog AI Observability for the server's LLM calls.
 *
 * The wrapper is exercised offline with an injected `fetch` and an injected PostHog client, the same
 * way the evaluator itself is tested: a provider that answers, a provider that refuses and a provider
 * that never answers must each produce the right trace — and none of them may change the answer the
 * route already had.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { AI_GENERATION_EVENT, createAiObservability, readChatCompletion } from '../../server/ai-observability.mjs';

function fakeClient() {
  const events = [];
  return {
    events,
    captureAi(message) {
      events.push(message);
    },
    flush: async () => {},
    shutdown: async () => {},
  };
}

function chatPayload({ content = '{"score": 80}', model = 'gpt-4o-mini', prompt = 120, completion = 40 } = {}) {
  return {
    model,
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
  };
}

function fakeResponse(body, { ok = true, status = 200 } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok,
    status,
    json: async () => JSON.parse(text),
    clone: () => ({ text: async () => text }),
  };
}

const request = (body = {}) => ({
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: [
      { role: 'system', content: 'Mark the answer.' },
      { role: 'user', content: 'A list is mutable, a tuple is not.' },
    ],
    ...body,
  }),
});

/* ------------------------------- disabled path ----------------------------- */

test('ai observability: no key means the same fetch, with no client and no events', () => {
  const observability = createAiObservability({ apiKey: '', client: null });
  assert.equal(observability.enabled, false);
  const fetchImpl = async () => fakeResponse(chatPayload());
  assert.equal(observability.wrapFetch({ fetchImpl }), fetchImpl, 'the wrapper is the identity');
});

/* -------------------------------- generation ------------------------------- */

test('ai observability: a generation is captured with model, latency and the tokens the provider reported', async () => {
  const client = fakeClient();
  const observability = createAiObservability({ client });
  const response = fakeResponse(chatPayload());
  const observed = observability.wrapFetch({
    fetchImpl: async () => response,
    distinctId: 'learner-1',
    spanName: 'interview_evaluation',
  });

  const returned = await observed('https://api.openai.com/v1/chat/completions', request());

  assert.equal(returned, response, 'the caller gets the exact response object back');
  assert.equal(client.events.length, 1);
  const [event] = client.events;
  assert.equal(event.event, AI_GENERATION_EVENT);
  assert.equal(event.distinctId, 'learner-1');
  assert.equal(event.properties.$ai_model, 'gpt-4o-mini');
  assert.equal(event.properties.$ai_input_tokens, 120);
  assert.equal(event.properties.$ai_output_tokens, 40);
  assert.equal(event.properties.$ai_span_name, 'interview_evaluation');
  assert.equal(event.properties.$ai_provider, 'openai');
  assert.equal(event.properties.$ai_base_url, 'https://api.openai.com');
  assert.equal(event.properties.$ai_stop_reason, 'stop');
  assert.equal(event.properties.$ai_http_status, 200);
  assert.ok(event.properties.$ai_latency >= 0, 'latency is a number of seconds');
  assert.match(event.properties.$ai_trace_id, /^[0-9a-f-]{36}$/);
  assert.equal(event.properties.$ai_is_error, undefined);
});

test('ai observability: prompt and completion text are redacted unless content capture is on', async () => {
  const redacted = fakeClient();
  const quiet = createAiObservability({ client: redacted });
  await quiet.wrapFetch({ fetchImpl: async () => fakeResponse(chatPayload()) })('https://api.openai.com/v1/chat/completions', request());
  assert.equal(redacted.events[0].properties.$ai_input, undefined);
  assert.equal(redacted.events[0].properties.$ai_output_choices, undefined);

  const full = fakeClient();
  const verbose = createAiObservability({ client: full, captureContent: true });
  await verbose.wrapFetch({ fetchImpl: async () => fakeResponse(chatPayload()) })('https://api.openai.com/v1/chat/completions', request());
  assert.deepEqual(full.events[0].properties.$ai_input, [
    { role: 'system', content: 'Mark the answer.' },
    { role: 'user', content: 'A list is mutable, a tuple is not.' },
  ]);
  assert.equal(full.events[0].properties.$ai_output_choices[0].content, '{"score": 80}');
});

/* --------------------------------- failures -------------------------------- */

test('ai observability: a network failure is traced as an error and the original error is rethrown', async () => {
  const client = fakeClient();
  const observability = createAiObservability({ client });
  const failure = new Error('the provider did not answer');
  failure.name = 'TimeoutError';
  const observed = observability.wrapFetch({
    fetchImpl: async () => {
      throw failure;
    },
    distinctId: 'learner-2',
  });

  await assert.rejects(observed('https://api.openai.com/v1/chat/completions', request()), (error) => error === failure);
  assert.equal(client.events.length, 1);
  assert.equal(client.events[0].properties.$ai_is_error, true);
  assert.equal(client.events[0].properties.$ai_error, 'TimeoutError');
  assert.equal(client.events[0].properties.$ai_output_tokens, undefined, 'no usage is invented for a call that failed');
});

test('ai observability: a refused HTTP call is traced with the status and no response body', async () => {
  const client = fakeClient();
  const observability = createAiObservability({ client, captureContent: true });
  const response = fakeResponse({ error: { message: 'rate limited' } }, { ok: false, status: 429 });
  const returned = await observability
    .wrapFetch({ fetchImpl: async () => response })
    ('https://api.openai.com/v1/chat/completions', request());

  assert.equal(returned, response);
  assert.equal(client.events[0].properties.$ai_http_status, 429);
  assert.equal(client.events[0].properties.$ai_is_error, true);
  assert.equal(client.events[0].properties.$ai_output_choices, undefined);
});

test('ai observability: a broken PostHog client never breaks the LLM call', async () => {
  const observability = createAiObservability({
    client: {
      captureAi() {
        throw new Error('posthog exploded');
      },
    },
    logger: { warn() {} },
  });
  const response = fakeResponse(chatPayload());
  const returned = await observability
    .wrapFetch({ fetchImpl: async () => response })
    ('https://api.openai.com/v1/chat/completions', request());
  assert.equal(returned, response);
});

/* --------------------------------- parsing --------------------------------- */

test('ai observability: an unreadable provider body yields no invented tokens', () => {
  assert.deepEqual(readChatCompletion({ choices: [] }), {
    model: undefined,
    output: undefined,
    inputTokens: undefined,
    outputTokens: undefined,
    stopReason: undefined,
  });
});
