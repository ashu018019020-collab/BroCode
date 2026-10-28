/**
 * Vercel Function: `POST /api/voice/tts`.
 *
 * Proxies to the configured voice engine (Supertonic `services/supertonic-tts/`, or Google Cloud TTS) and
 * returns audio with `X-Voice-Engine` so the client never guesses which engine spoke. See
 * `server/vercel-voice.mjs` for validation, origin checks, rate limiting and error sanitization.
 */
import { createTtsHandler } from '../../server/vercel-voice.mjs';

export default createTtsHandler();
