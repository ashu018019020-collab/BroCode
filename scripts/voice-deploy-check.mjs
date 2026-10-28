/**
 * Verify a DEPLOYED voice service, and whether the production site is wired to it.
 *
 * This is the operator's check after `render.yaml` is applied: it proves the container is reachable
 * over HTTPS, that the shared secret is actually enforced, that Hindi and English both produce
 * playable WAV bytes, and whether `https://<site>/api/voice/status` reports that engine. It is the
 * only way to know the live site is using the voice rather than falling back.
 *
 *   TTS_SERVICE_URL=https://brocode-voice.onrender.com \
 *   TTS_SERVICE_SECRET=... \
 *   npm run voice:check
 *
 *   npm run voice:check -- --url https://... --public https://mybrocode.vercel.app
 *
 * Never prints the secret. Exits non-zero when the service or the wiring is not ready, so it can gate
 * a release.
 */
const argv = process.argv.slice(2);
const args = new Map();
for (let i = 0; i < argv.length; i += 1) {
  const raw = argv[i];
  if (!raw.startsWith('--')) continue;
  const [key, inline] = raw.replace(/^--/, '').split('=');
  if (inline !== undefined) { args.set(key, inline); continue; }
  // Both `--url=X` and `--url X` are accepted: npm passes the second form through unchanged,
  // and a bare `--url` with no value must not silently become the string "true".
  const following = argv[i + 1];
  if (following && !following.startsWith('--')) { args.set(key, following); i += 1; }
  else args.set(key, 'true');
}

const SERVICE = String(args.get('url') ?? process.env.TTS_SERVICE_URL ?? '').trim().replace(/\/+$/, '');
const SECRET = String(args.get('secret') ?? process.env.TTS_SERVICE_SECRET ?? '').trim();
const PUBLIC = String(args.get('public') ?? 'https://mybrocode.vercel.app').trim().replace(/\/+$/, '');

if (!SERVICE) {
  console.error('Set TTS_SERVICE_URL (or pass --url=... / --url ...) to the deployed voice service.');
  process.exit(2);
}
if (!/^https?:\/\//.test(SERVICE)) {
  console.error(`--url must be an http(s) URL; got "${SERVICE}".`);
  process.exit(2);
}
if (!SECRET) {
  console.error('Set TTS_SERVICE_SECRET to the same token the account API uses. Never paste it into a file.');
  process.exit(2);
}

let failures = 0;
const ok = (label, detail) => console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
const bad = (label, detail) => {
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
};

async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* HTML from a proxy is not JSON */ }
  return { response, body, text };
}

console.log(`\nVoice service: ${SERVICE}`);

/* 1. Is the container up, and has the model loaded? */
try {
  const { response, body } = await json(`${SERVICE}/healthz`);
  if (body?.ready === true) {
    ok('healthz ready', `${body.sampleRate} Hz · ${body.steps} steps · style ${body.style ?? 'F1'}`);
  } else {
    bad('healthz ready', body?.error ?? `HTTP ${response.status} — the model may still be downloading`);
  }
} catch (cause) {
  bad('healthz reachable', cause?.message ?? String(cause));
}

/* 2. Is the shared secret enforced? An open endpoint is a denial-of-service target. */
try {
  const response = await fetch(`${SERVICE}/v1/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Hello', lang: 'en-IN' }),
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 401) ok('rejects an unauthenticated request');
  else bad('rejects an unauthenticated request', `HTTP ${response.status} (expected 401)`);
} catch (cause) {
  bad('auth check', cause?.message ?? String(cause));
}

/* 3. Hindi and English audio, over the wire, as a browser would receive it. */
for (const [id, text, lang] of [
  ['English', 'Welcome to BroCode. Let us begin your AI engineering interview.', 'en-IN'],
  ['Hindi', 'नमस्ते! आज हम BroCode में Python प्रोग्रामिंग सीखेंगे।', 'hi-IN'],
]) {
  const began = Date.now();
  try {
    const response = await fetch(`${SERVICE}/v1/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ text, lang, rate: 1 }),
      signal: AbortSignal.timeout(60000),
    });
    const type = response.headers.get('content-type') ?? '';
    const bytes = Buffer.from(await response.arrayBuffer());
    const riff = bytes.subarray(0, 4).toString('ascii');
    const engine = response.headers.get('x-voice-engine') ?? '(not reported)';
    if (response.ok && type.startsWith('audio/') && riff === 'RIFF' && bytes.length > 10_000) {
      ok(`${id} speech`, `${(bytes.length / 1024).toFixed(0)} kB · ${engine} · ${Date.now() - began} ms`);
    } else {
      bad(`${id} speech`, `HTTP ${response.status} · ${type || 'no type'} · ${bytes.length} bytes`);
    }
  } catch (cause) {
    bad(`${id} speech`, cause?.message ?? String(cause));
  }
}

/* 4. Has PRODUCTION been told about this service? This is the wiring half. */
try {
  const { response, body, text } = await json(`${PUBLIC}/api/voice/status`);
  if (body?.configured === true && body?.engine === 'supertonic') {
    ok('production is wired', `${PUBLIC}/api/voice/status → engine=supertonic`);
  } else if (body) {
    bad('production is wired', `status says ${JSON.stringify({ configured: body.configured, engine: body.engine, reason: body.reason })}`);
    console.log('        → set TTS_SERVICE_URL and TTS_SERVICE_SECRET on the API deployment, then redeploy it.');
  } else {
    bad('production is wired', `HTTP ${response.status} and no JSON from ${PUBLIC}/api/voice/status`);
    console.log('        → the account API is not served at that origin; the voice route has to be deployed there too.');
    if (text) console.log(`        first bytes: ${text.slice(0, 60).replace(/\s+/g, ' ')}`);
  }
} catch (cause) {
  bad('production is wired', cause?.message ?? String(cause));
}

console.log(failures === 0
  ? '\nServer voice deployed, authenticated and wired. The settings row should read "AI voice · Supertonic 3 · Hindi + English · Server-powered".\n'
  : `\n${failures} check(s) failed. Fix those before claiming the voice is live.\n`);
process.exit(failures === 0 ? 0 : 1);
