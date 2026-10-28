/**
 * Vercel Function: `GET /api/voice/status`.
 *
 * Thin on purpose — the engine and the response contract live in `server/vercel-voice.mjs`, shared
 * with the account API. The function is instantiated once per warm instance, so the engine's health
 * probe cache is reused across requests.
 */
import { createStatusHandler } from '../../server/vercel-voice.mjs';

export default createStatusHandler();
