/**
 * The ONE server-side model call.
 *
 * The app answers from its own curriculum by default; this endpoint is the optional second engine.
 * It exists so the API key never reaches a browser: the SPA posts a question + the retrieved lesson
 * excerpts, and this function forwards them to any OpenAI-compatible chat endpoint.
 *
 * Set on the host (Vercel → Settings → Environment Variables), never in the repo:
 *   LLM_API_KEY   required — the provider key
 *   LLM_API_BASE  optional — default https://api.openai.com/v1 (any OpenAI-compatible base works)
 *   LLM_MODEL     optional — default gpt-4o-mini
 *
 * Without a key this answers 503 `not_configured`, and the client keeps using the local engine —
 * a missing key degrades the product, it never breaks it.
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

function config() {
  const key = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
  const base = (process.env.LLM_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  const model = process.env.LLM_MODEL || DEFAULT_MODEL;
  return { key, base, model };
}

/** Vercel usually pre-parses the JSON body; a plain Node request still arrives as a stream. */
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
function sanitizeMessages(value) {
  if (!Array.isArray(value)) return [];
  const messages = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const role = entry.role;
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

export default async function handler(req, res) {
  const { key, base, model } = config();

  // A cheap probe, so the studio can say "AI answers are on" before the first question.
  if (req.method === 'GET') {
    return send(res, 200, { configured: Boolean(key), model: key ? model : null });
  }
  if (req.method !== 'POST') {
    return send(res, 405, { error: 'method_not_allowed', message: 'Use POST.' });
  }
  if (!key) {
    return send(res, 503, {
      error: 'not_configured',
      message: 'No LLM_API_KEY is set on this deployment, so answers use the bundled curriculum.',
    });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 400, { error: 'invalid_json', message: 'The request body must be JSON.' });
  }

  const messages = sanitizeMessages(body?.messages);
  if (!messages.length) {
    return send(res, 400, { error: 'messages_required', message: 'At least one message is required.' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        max_tokens: 600,
      }),
      signal: controller.signal,
    });

    const raw = await upstream.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }

    if (!upstream.ok) {
      // The provider's own message is useful for the operator and harmless for the learner.
      const message = data?.error?.message || `The model provider answered ${upstream.status}.`;
      return send(res, 502, { error: 'upstream', status: upstream.status, message });
    }

    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) {
      return send(res, 502, { error: 'empty_reply', message: 'The model returned no text.' });
    }
    return send(res, 200, { reply: reply.trim(), model: data?.model || model });
  } catch (cause) {
    const timedOut = cause?.name === 'AbortError';
    return send(res, timedOut ? 504 : 502, {
      error: timedOut ? 'timeout' : 'network',
      message: timedOut ? 'The model took too long to answer.' : 'The model service could not be reached.',
    });
  } finally {
    clearTimeout(timer);
  }
}
