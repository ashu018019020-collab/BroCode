/**
 * Vercel Function: `GET /api/voice/status`.
 *
 * The site is served as a static bundle, so the voice routes have to exist as functions on the same
 * origin the browser calls. Thin on purpose: the contract lives in `server/voice-handler.mjs` and the
 * provider in `server/tts.mjs`, shared with the account API.
 */
import { createStatusHandler } from '../../server/voice-handler.mjs';

export default createStatusHandler();
