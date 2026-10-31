import 'dotenv/config';
import { createAiObservability } from './ai-observability.mjs';
import { createAuthServer } from './app.mjs';
import { createSupabaseServices } from './supabase.mjs';
import { createStore } from './db-config.mjs';
import { TTS_VOICES, voiceOverrides } from './tts.mjs';

// Render (and most PaaS hosts) inject PORT; a local run and `npm run dev:api` use API_PORT, which keeps
// priority so the Vite proxy target and the server can never disagree.
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);
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
// PostHog AI Observability: server-only, created once and shut down with the process so the last
// generations are flushed. Without POSTHOG_API_KEY this is a disabled, no-network instance.
const aiObservability = createAiObservability();
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
  aiObservability,
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, () => {
    server.removeListener('error', reject);
    console.log(`BroCode Supabase account API listening on port ${port} (account store: ${label}).`);
    // The voice ids the engine will actually speak — an operator's pin included, never a guess.
    const speaking = {
      ...TTS_VOICES,
      ...voiceOverrides({ hi: process.env.AZURE_SPEECH_VOICE_HI, en: process.env.AZURE_SPEECH_VOICE_EN }),
    };
    console.log(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION
      ? `Speech out runs on Azure AI Speech (${speaking['hi-IN']} / ${speaking['en-IN']}), synthesised here.`
      : 'No AZURE_SPEECH_KEY: /api/voice/tts answers 503 and the client uses its device voice only.');
    if (aiObservability.enabled) console.log('PostHog AI observability enabled for server AI calls.');
    if (enforceHttps) console.log('Plain-HTTP requests are redirected to HTTPS and HSTS is sent.');
    resolve();
  });
});

async function shutdown() {
  server.close(async (error) => {
    try {
      await aiObservability.shutdown();
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
