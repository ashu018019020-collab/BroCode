/**
 * The ONE server-side model call, shared by every host BroCode runs on.
 *
 * The AI Mentor answers from the bundled curriculum by default. This handler is the optional second
 * engine: the browser posts a question plus the lesson excerpts it already retrieved, and this side
 * holds the provider key. Nothing here is fine-tuning — "training" the mentor means handing it the
 * course on every question, so the same model cannot drift away from what the lessons say.
 *
 * Environment (host dashboard only — never `VITE_`-prefixed, never in the repo):
 *   LLM_API_KEY   required — the provider key
 *   LLM_API_BASE  optional — default https://api.openai.com/v1 (any OpenAI-compatible base works)
 *   LLM_MODEL     optional — default gpt-4o-mini
 *
 * Without a key it answers 503 `not_configured` and the client keeps its local answer. A missing key
 * degrades the mentor; it never breaks the chat.
 *
 * The shape mirrors `server/voice-handler.mjs` on purpose: `api/ai/chat.js` is a three-line wrapper,
 * so the Vercel function and the account API share one contract.
 */

const DEFAULT_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
/** Bounded on purpose: a public endpoint must not forward an unbounded prompt. */
const MAX_MESSAGES = 16;
const MAX_CONTENT_CHARS = 6000;
const MAX_TOTAL_CHARS = 24000;
const UPSTREAM_TIMEOUT_MS = 25000;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function mentorChatConfig(env = process.env) {
  return {
    key: env.LLM_API_KEY || env.OPENAI_API_KEY || '',
    base: (env.LLM_API_BASE || DEFAULT_BASE).replace(/\/+$/, ''),
    model: env.LLM_MODEL || DEFAULT_MODEL,
  };
}

/** Vercel pre-parses the JSON body; a plain Node request still arrives as a stream. */
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_TOTAL_CHARS * 8) throw new Error('body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Keep the shape the provider expects, and cap what an anonymous caller can spend. */
export function sanitizeMessages(value) {
  if (!Array.isArray(value)) return [];
  const messages = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { role } = entry;
    if (role !== 'system' && role !== 'user' && role !== 'assistant') continue;
    const content = typeof entry.content === 'string' ? entry.content.slice(0, MAX_CONTENT_CHARS) : '';
    if (!content.trim()) continue;
    messages.push({ role, content });
  }
  const bounded = messages.slice(-MAX_MESSAGES);
  let total = 0;
  const kept = [];
  for (let i = bounded.length - 1; i >= 0; i -= 1) {
    total += bounded[i].content.length;
    if (total > MAX_TOTAL_CHARS) break;
    kept.unshift(bounded[i]);
  }
  return kept;
}

export function createMentorChatHandler({ fetchImpl, env = process.env } = {}) {
  return async function handler(req, res) {
    // Resolved per request: a test (or a host that patches fetch later) must not be stuck with the
    // function that happened to exist when this module was imported.
    const doFetch = fetchImpl ?? globalThis.fetch;
    const { key, base, model } = mentorChatConfig(env);

    // A cheap probe, so the studio can say "AI answers are on" before the first question.
    if (req.method === 'GET') {
      send(res, 200, { configured: Boolean(key), model: key ? model : null });
      return;
    }
    if (req.method !== 'POST') {
      send(res, 405, { error: 'method_not_allowed', message: 'Use POST.' });
      return;
    }
    if (!key) {
      send(res, 503, {
        error: 'not_configured',
        message: 'No LLM_API_KEY is set on this deployment, so answers use the bundled curriculum.',
      });
      return;
    }

    let body;
    try {
      body = await readBody(req);
    } catch {
      send(res, 400, { error: 'invalid_json', message: 'The request body must be JSON.' });
      return;
    }

    const messages = sanitizeMessages(body?.messages);
    if (!messages.length) {
      send(res, 400, { error: 'messages_required', message: 'At least one message is required.' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const upstream = await doFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 600 }),
        signal: controller.signal,
      });

      const raw = await upstream.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }

      if (!upstream.ok) {
        const message = data?.error?.message || `The model provider answered ${upstream.status}.`;
        send(res, 502, { error: 'upstream', status: upstream.status, message });
        return;
      }

      const reply = data?.choices?.[0]?.message?.content;
      if (typeof reply !== 'string' || !reply.trim()) {
        send(res, 502, { error: 'empty_reply', message: 'The model returned no text.' });
        return;
      }
      send(res, 200, { reply: reply.trim(), model: data?.model || model });
    } catch (cause) {
      const timedOut = cause?.name === 'AbortError';
      send(res, timedOut ? 504 : 502, {
        error: timedOut ? 'timeout' : 'network',
        message: timedOut ? 'The model took too long to answer.' : 'The model service could not be reached.',
      });
    } finally {
      clearTimeout(timer);
    }
  };
}
