/**
 * Vercel Function: `GET /api/voice/realtime/status`.
 *
 * The browser probes this before offering online voice. Public, because it only names two booleans;
 * the provider key stays in the host environment and is never returned.
 */
import { createRealtimeStatusHandler } from '../../../server/realtime-handler.mjs';

export default createRealtimeStatusHandler();
