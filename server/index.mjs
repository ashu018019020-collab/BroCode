import 'dotenv/config';
import { createAuthServer } from './app.mjs';
import { createSupabaseServices } from './supabase.mjs';
import { createStore } from './db-config.mjs';

const port = Number(process.env.API_PORT ?? 8787);
const allowedOrigin = process.env.WEB_ORIGIN
  ?? (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('API_PORT must be a valid TCP port.');
}
if (!allowedOrigin) {
  throw new Error('Set WEB_ORIGIN to the exact production web-app origin.');
}
const webUrl = new URL(allowedOrigin);
if (webUrl.origin !== allowedOrigin || webUrl.pathname !== '/') {
  throw new Error('WEB_ORIGIN must contain only the scheme, hostname, and optional port.');
}
if (process.env.NODE_ENV === 'production' && webUrl.protocol !== 'https:') {
  throw new Error('WEB_ORIGIN must use HTTPS in production.');
}

// Enforcement follows NODE_ENV: production requires TLS. Set ENFORCE_HTTPS=off when a trusted proxy
// terminates TLS without forwarding X-Forwarded-Proto.
const enforceHttps = (process.env.ENFORCE_HTTPS ?? (process.env.NODE_ENV === 'production' ? 'on' : 'off')) !== 'off';

const supabase = createSupabaseServices();
// Postgres when DATABASE_URL is real, otherwise the Supabase-Auth store — the account system must
// start and work with the keys that are configured, not fail because a database is missing.
const { store, label } = await createStore({ admin: supabase.admin });
const server = createAuthServer({
  store,
  supabaseAuth: supabase.auth,
  supabaseAdmin: supabase.admin,
  allowedOrigin,
  enforceHttps,
  storeLabel: label,
  googleTtsKey: process.env.GOOGLE_TTS_API_KEY ?? '',
  googleTtsVoices: {
    'hi-IN': process.env.GOOGLE_TTS_VOICE_HI ?? '',
    'en-IN': process.env.GOOGLE_TTS_VOICE_EN ?? '',
  },
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, () => {
    server.removeListener('error', reject);
    console.log(`BroCode Supabase account API listening on port ${port} (account store: ${label}).`);
    console.log(process.env.GOOGLE_TTS_API_KEY?.trim()
      ? 'Google Neural2 voice enabled for the tutor (server-side key).'
      : 'No GOOGLE_TTS_API_KEY — the tutor speaks with the browser voice only.');
    if (enforceHttps) console.log('Plain-HTTP requests are redirected to HTTPS and HSTS is sent.');
    resolve();
  });
});

async function shutdown() {
  server.close(async (error) => {
    try {
      await store.close();
      if (error) {
        console.error('Failed to close the account API cleanly.', error.code ?? error.name);
        process.exitCode = 1;
      }
    } catch (closeError) {
      console.error('Failed to close the Supabase database pool cleanly.', closeError.code ?? closeError.name);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
