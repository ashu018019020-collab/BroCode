/**
 * Verify the DEPLOYED voice, the way a browser receives it.
 *
 * Naming a voice proves nothing: this posts the three sentences a learner actually hears and reads
 * the bytes back. It checks the deployment, not a container — there is no separate voice service any
 * more, so the only origin that matters is the site's own.
 *
 *   npm run voice:check
 *   npm run voice:check -- --public https://mybrocode.vercel.app
 *
 * Never prints the key (it is never read here: the key lives in the host's environment). Exits
 * non-zero when the deployment cannot speak, so it can gate a release.
 */
import { TTS_VOICES } from '../server/tts.mjs';

const argv = process.argv.slice(2);
const args = new Map();
for (let i = 0; i < argv.length; i += 1) {
  const raw = argv[i];
  if (!raw.startsWith('--')) continue;
  const [key, inline] = raw.replace(/^--/, '').split('=');
  if (inline !== undefined) { args.set(key, inline); continue; }
  // Both `--public=X` and `--public X` are accepted: npm passes the second form through unchanged,
  // and a bare `--public` with no value must not silently become the string "true".
  const following = argv[i + 1];
  if (following && !following.startsWith('--')) { args.set(key, following); i += 1; }
  else args.set(key, 'true');
}

const PUBLIC = String(args.get('public') ?? process.env.PUBLIC_SITE_URL ?? 'https://mybrocode.vercel.app')
  .trim().replace(/\/+$/, '');

if (!/^https?:\/\//.test(PUBLIC)) {
  console.error(`--public must be an http(s) origin; got "${PUBLIC}".`);
  process.exit(2);
}

let failures = 0;
const ok = (label, detail) => console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
const bad = (label, detail) => {
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
};

async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* HTML from a proxy is not JSON */ }
  return { response, body, text };
}

/** MP3 with an ID3 tag or a bare frame sync; WAV/HTML/a JSON error is not speech. */
function looksLikeMp3(bytes) {
  if (bytes.length < 4) return false;
  const id3 = bytes.subarray(0, 3).toString('ascii') === 'ID3';
  const sync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  return id3 || sync;
}

console.log(`\nDeployed voice: ${PUBLIC}`);

/* 1. Is a provider configured on THIS deployment? The key itself is never asked for or shown. */
try {
  const { response, body, text } = await readJson(`${PUBLIC}/api/voice/status`);
  if (body?.configured === true) {
    const voices = body.voices && typeof body.voices === 'object' ? body.voices : {};
    ok('status configured', `engine=${body.engine} · hi=${voices['hi-IN'] ?? '?'} · en=${voices['en-IN'] ?? '?'}`);
    if (voices['hi-IN'] !== voices['en-IN']) ok('two languages, two voices');
    else bad('two languages, two voices', 'both languages answer with the same voice id');
  } else if (body) {
    bad('status configured', `configured=${JSON.stringify(body.configured)} engine=${JSON.stringify(body.engine)}`);
    console.log(`        → set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION on ${PUBLIC}'s host, then redeploy.`);
  } else {
    bad('status configured', `HTTP ${response.status} and no JSON from /api/voice/status`);
    if (text) console.log(`        first bytes: ${text.slice(0, 60).replace(/\s+/g, ' ')}`);
  }
} catch (cause) {
  bad('status reachable', cause?.message ?? String(cause));
}

/**
 * 2. The three sentences a learner hears. The middle one is deliberately Roman-script Hinglish: it
 *    is the input that used to be swallowed by a model that only spoke Devanagari, and the one most
 *    likely to come out unintelligible.
 */
const SAMPLES = [
  ['English', 'Welcome to BroCode. Let us begin your AI engineering interview.', 'en-IN'],
  ['Hinglish', 'Aaj hum Python ka function banayenge, aur phir usko test karenge.', 'hi-IN'],
  ['Hindi', 'नमस्ते! आज हम BroCode में Python प्रोग्रामिंग सीखेंगे।', 'hi-IN'],
];

for (const [id, text, lang] of SAMPLES) {
  const began = Date.now();
  try {
    const response = await fetch(`${PUBLIC}/api/voice/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: PUBLIC },
      body: JSON.stringify({ text, lang, rate: 1 }),
      signal: AbortSignal.timeout(40000),
    });
    const type = response.headers.get('content-type') ?? '';
    const bytes = Buffer.from(await response.arrayBuffer());
    const voice = response.headers.get('x-voice-id') ?? '(not reported)';
    if (response.ok && type.startsWith('audio/') && looksLikeMp3(bytes) && bytes.length > 5000) {
      ok(`${id} audio`, `${(bytes.length / 1024).toFixed(0)} kB · ${voice} · ${Date.now() - began} ms`);
    } else {
      // The route answers a machine code; name it instead of guessing from the status alone.
      let code = '';
      try { code = JSON.parse(bytes.toString('utf8'))?.code ?? ''; } catch { /* not JSON */ }
      bad(`${id} audio`, `HTTP ${response.status}${code ? ` ${code}` : ''} · ${type || 'no type'} · ${bytes.length} bytes`);
      if (code === 'TTS_NOT_CONFIGURED') {
        console.log('        → this deployment has no speech key; the voice is not generated anywhere else.');
      }
      if (code === 'TTS_UPSTREAM_401' || code === 'TTS_UPSTREAM_403') {
        console.log('        → the key was rejected: check it belongs to a Speech resource and the region matches.');
      }
    }
  } catch (cause) {
    bad(`${id} audio`, cause?.message ?? String(cause));
  }
}

/* 3. A request from another site must be refused, or anyone can spend the owner's characters. */
try {
  const response = await fetch(`${PUBLIC}/api/voice/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
    body: JSON.stringify({ text: 'Hi', lang: 'en-IN' }),
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 403) ok('refuses a foreign origin');
  else bad('refuses a foreign origin', `HTTP ${response.status} (expected 403)`);
} catch (cause) {
  bad('foreign-origin check', cause?.message ?? String(cause));
}

console.log(failures === 0
  ? `\nVoice is live on ${PUBLIC}. Expected voices: ${TTS_VOICES['hi-IN']} (Hindi + Hinglish) and ${TTS_VOICES['en-IN']} (English).\n`
  : `\n${failures} check(s) failed. Fix those before claiming the voice is live.\n`);
process.exit(failures === 0 ? 0 : 1);
