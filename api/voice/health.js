/**
 * Vercel Function: `GET /api/voice/health`.
 *
 * The operator's view of the voice path — which engine this deployment would use, whether it really
 * answered, which environment variables are present (names only, never values) and what to do next.
 * It returns 200 only when the configured engine is actually ready, so it doubles as an uptime check.
 *
 *   curl -s https://mybrocode.vercel.app/api/voice/health | jq
 *
 * See `server/voice-diagnostics.mjs` for the codes and the no-secrets rules.
 */
import { createHealthHandler } from '../../server/vercel-voice.mjs';

export default createHealthHandler();
