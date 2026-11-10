/**
 * Vercel Function: `POST /api/voice/realtime/session`.
 *
 * Mints a short-lived OpenAI Realtime client secret for a signed-in learner on this origin. The
 * permanent key never reaches the browser; the contract and errors live in
 * `server/realtime-handler.mjs`.
 */
import { createRealtimeSessionHandler } from '../../../server/realtime-handler.mjs';

export default createRealtimeSessionHandler();
