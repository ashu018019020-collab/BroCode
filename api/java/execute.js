/**
 * Vercel Function: `POST /api/java/execute`.
 *
 * Same contract as the Node API's `/api/java/execute`: same-origin only, a bounded body, and real
 * compiler output. Running Java needs no account — it is a tool, so the course can be tried before
 * sign-up; the budget is keyed by caller instead of by account. The compiler credentials, when the
 * host has any, stay in the environment and never reach the bundle.
 */
import { JavaExecError, createJavaExecutor } from '../../server/j-runner.mjs';

const MAX_BODY_BYTES = 40 * 1024;
const executor = createJavaExecutor();

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new JavaExecError(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new JavaExecError(400, 'Request body must be JSON.'); }
}

async function signedIn(req) {
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  const url = String(process.env.SUPABASE_URL ?? '').trim();
  const key = String(process.env.SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  if (!token || !url || !key) return null;
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method === 'GET') return send(res, 200, executor.status());
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  const origin = req.headers.origin;
  const allowed = String(process.env.APP_ORIGIN ?? '').trim();
  if (!origin || (allowed && origin !== allowed)) return send(res, 403, { error: 'Request origin is not allowed.' });
  const user = await signedIn(req);
  const key = `${user?.id ?? 'anon'}:${req.headers['x-forwarded-for'] ?? 'local'}`;
  if (!executor.allow(key)) return send(res, 429, { error: 'Too many compile requests. Try again in a minute.' });
  try {
    const body = await readBody(req);
    return send(res, 200, await executor.run(body));
  } catch (error) {
    if (error instanceof JavaExecError) return send(res, error.status, { error: error.message });
    return send(res, 500, { error: 'The compiler request could not be completed.' });
  }
}
