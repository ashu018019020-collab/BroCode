/**
 * Vercel Function: `GET|POST /api/ai/chat`.
 *
 * Same origin, same bounded prompt and same typed failures as the account API — the contract lives
 * in `server/mentor-chat.mjs`. Set `LLM_API_KEY` (+ optional `LLM_API_BASE` / `LLM_MODEL`) in the
 * host's environment; without them this answers 503 and the mentor keeps its local answer.
 */
import { createMentorChatHandler } from '../../server/mentor-chat.mjs';

export default createMentorChatHandler();
