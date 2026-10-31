/**
 * PostHog AI Observability for the server's own LLM calls.
 *
 * Why a wrapper instead of the provider SDKs: this server talks to its provider with plain `fetch`
 * (`server/interview.mjs`), deliberate so the request, the timeout and the injected `fetchImpl` are
 * all testable offline. Swapping in a provider SDK just to get tracing would change the AI path.
 * Instead this module wraps the existing `fetch` and reports what already happened: the model, the
 * latency, the token usage the provider returned, and whether it errored. The request and response
 * objects are passed through untouched, so a PostHog outage can never change an answer.
 *
 * The key is SERVER-ONLY (`POSTHOG_API_KEY`, never `VITE_`-prefixed). With no key the wrapper is the
 * `fetch` it was given — byte-for-byte the old behaviour, no client, no network, no queue.
 *
 * Privacy: prompt and completion text are REDACTED by default. `server/interview.mjs` and
 * `docs/SECURITY.md` promise that a learner's answer is not logged, and that promise should not
 * depend on which observability vendor is configured. An operator who has decided otherwise sets
 * `POSTHOG_AI_CAPTURE_CONTENT=1`; the traces still carry model, latency, tokens and cost either way.
 */

import { randomUUID } from 'node:crypto';
import { PostHog } from 'posthog-node';

export const POSTHOG_DEFAULT_HOST = 'https://us.i.posthog.com';
export const AI_GENERATION_EVENT = '$ai_generation';
/** Content is trimmed before it leaves the process: a trace is a debugging aid, not an archive. */
export const AI_MAX_CONTENT_CHARS = 8000;

const enabledFlag = (value) => /^(1|true|on|yes)$/i.test(String(value ?? '').trim());

function clampText(value) {
  if (typeof value !== 'string') return value;
  return value.length > AI_MAX_CONTENT_CHARS ? `${value.slice(0, AI_MAX_CONTENT_CHARS)}…` : value;
}

/** Roles PostHog accepts; anything else (a tool payload, a stray key) is dropped rather than guessed. */
function normalizeInput(messages) {
  if (!Array.isArray(messages)) return undefined;
  const list = messages
    .filter((message) => message && typeof message === 'object' && ['system', 'user', 'assistant'].includes(message.role))
    .map((message) => ({ role: message.role, content: clampText(typeof message.content === 'string' ? message.content : '') }))
    .filter((message) => message.content);
  return list.length ? list : undefined;
}

/** The parts of an OpenAI-style chat completion that are worth reporting, and nothing else. */
export function readChatCompletion(payload) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const content = choice?.message?.content;
  const usage = payload?.usage ?? {};
  const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : undefined);
  return {
    model: typeof payload?.model === 'string' ? payload.model : undefined,
    output: typeof content === 'string' && content.trim()
      ? [{ role: 'assistant', content: clampText(content) }]
      : undefined,
    inputTokens: number(usage.prompt_tokens),
    outputTokens: number(usage.completion_tokens),
    stopReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
  };
}

/** Read the request body once, defensively: a body this module cannot parse is simply not reported. */
function readRequest(input, init) {
  const url = typeof input === 'string' ? input : input?.url ?? '';
  let body = null;
  try {
    body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
  } catch {
    body = null;
  }
  return {
    url,
    baseUrl: url ? new URL(url).origin : undefined,
    model: typeof body?.model === 'string' ? body.model : undefined,
    messages: Array.isArray(body?.messages) ? body.messages : undefined,
    temperature: Number.isFinite(Number(body?.temperature)) ? Number(body.temperature) : undefined,
    stream: body?.stream === true,
  };
}

/** The response body without consuming it — `clone()` leaves the caller's stream intact. */
async function readResponseJson(response) {
  try {
    if (!response || typeof response.clone !== 'function') return null;
    const text = await response.clone().text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function createAiObservability({
  apiKey = process.env.POSTHOG_API_KEY ?? '',
  host = process.env.POSTHOG_HOST || POSTHOG_DEFAULT_HOST,
  captureContent = enabledFlag(process.env.POSTHOG_AI_CAPTURE_CONTENT),
  logger = console,
  client = null,
  flushAt = 20,
  flushInterval = 5000,
  now = Date.now,
} = {}) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  const posthog = client ?? (key ? new PostHog(key, { host, flushAt, flushInterval }) : null);

  /** One generation, on the AI capture endpoint. Never throws: observability cannot fail a lesson. */
  function captureGeneration({ distinctId, ...properties }) {
    if (!posthog) return undefined;
    try {
      const cleaned = {};
      for (const [name, value] of Object.entries(properties)) {
        if (value !== undefined) cleaned[name] = value;
      }
      const message = {
        distinctId: distinctId || 'brocode-server',
        event: AI_GENERATION_EVENT,
        properties: cleaned,
      };
      if (typeof posthog.captureAi === 'function') posthog.captureAi(message);
      else posthog.capture(message);
      return AI_GENERATION_EVENT;
    } catch (error) {
      logger.warn?.('PostHog AI observability could not capture a generation.', error?.name ?? 'unknown');
      return undefined;
    }
  }

  /**
   * Wrap a `fetch` so every call through it becomes an `$ai_generation`. `distinctId` ties the trace
   * to the signed-in learner; `spanName` names the call in the trace view.
   */
  function wrapFetch({ fetchImpl = globalThis.fetch, distinctId = '', sessionId = null, spanName = 'llm_call', provider = 'openai' } = {}) {
    if (!posthog) return fetchImpl;

    return async function observedFetch(input, init = {}) {
      const startedAt = now();
      const request = readRequest(input, init);
      const base = {
        $ai_trace_id: randomUUID(),
        $ai_span_name: spanName,
        $ai_provider: provider,
        $ai_model: request.model,
        $ai_request_url: request.url || undefined,
        $ai_base_url: request.baseUrl,
        $ai_stream: request.stream || undefined,
        $ai_temperature: request.temperature,
      };
      if (sessionId) base.$ai_session_id = sessionId;
      if (captureContent) base.$ai_input = normalizeInput(request.messages);

      let response;
      try {
        response = await fetchImpl(input, init);
      } catch (error) {
        captureGeneration({
          ...base,
          distinctId,
          $ai_latency: (now() - startedAt) / 1000,
          $ai_is_error: true,
          $ai_error: error?.name ?? 'network-error',
        });
        throw error;
      }

      const latency = (now() - startedAt) / 1000;
      const payload = response?.ok === false ? null : await readResponseJson(response);
      const completion = readChatCompletion(payload);

      if (response?.ok === false) {
        // The provider answered and refused. Report the status and the code, never a body (it can
        // echo the prompt back, and that is exactly the text we promised not to log).
        captureGeneration({
          ...base,
          distinctId,
          $ai_model: completion.model ?? base.$ai_model,
          $ai_http_status: response.status,
          $ai_latency: latency,
          $ai_is_error: true,
          $ai_error: `http-${response.status}`,
        });
        return response;
      }

      captureGeneration({
        ...base,
        distinctId,
        $ai_model: completion.model ?? base.$ai_model,
        $ai_http_status: response?.status,
        $ai_latency: latency,
        $ai_input_tokens: completion.inputTokens,
        $ai_output_tokens: completion.outputTokens,
        $ai_stop_reason: completion.stopReason,
        ...(captureContent ? { $ai_output_choices: completion.output } : {}),
      });
      return response;
    };
  }

  async function flush() {
    if (!posthog) return;
    try {
      await posthog.flush?.();
    } catch (error) {
      logger.warn?.('PostHog AI observability could not flush.', error?.name ?? 'unknown');
    }
  }

  async function shutdown() {
    if (!posthog) return;
    try {
      await posthog.shutdown?.();
    } catch (error) {
      logger.warn?.('PostHog AI observability could not shut down cleanly.', error?.name ?? 'unknown');
    }
  }

  return { enabled: Boolean(posthog), captureGeneration, wrapFetch, flush, shutdown };
}
