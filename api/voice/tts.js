/**
 * Vercel Function: `POST /api/voice/tts`.
 *
 * Same origin, same budget, same typed failures as the account API — see
 * `server/voice-handler.mjs`. Set `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` in the host's
 * environment (never `VITE_`-prefixed, never in the bundle); without them this answers 503 with a
 * sentence the UI shows, and no model is ever downloaded by the visitor.
 */
import { createTtsHandler } from '../../server/voice-handler.mjs';

export default createTtsHandler();
