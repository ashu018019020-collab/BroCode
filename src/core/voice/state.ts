/**
 * The one place a voice phase is decided.
 *
 * Two things report into it — the deployment (`GET /api/voice/status`) and this tab's own playback —
 * and the rule for combining them is: **playback wins while it is happening, because it is the only
 * thing that is certainly true.** A service that says "ready" while nothing is playing is idle; a
 * service that says "ready" while audio is coming out of the speaker is speaking. Nothing here
 * guesses: a phase is only ever `speaking` because a buffer source was started, and only ever
 * `preparing` because the service said it is still loading.
 *
 * `failure` is a real state, not a toast: an unreachable deployment is `disconnected` (a calm,
 * recoverable state with a Retry) while a service that answered with a fault is `error` with the
 * route's own code beside it. That distinction is what keeps "Retry" off the screen when pressing it
 * could never help — a missing voice or a rejected secret is configuration, not a blip.
 */
import { INITIAL_VOICE_STATUS, type VoiceStatus } from './protocol';
import type { ServerVoiceStatus, VoiceFailure } from './server';

/** What THIS TAB is doing with the speaker. Never inferred from a timer. */
export type PlaybackState = 'idle' | 'generating' | 'speaking' | 'paused' | 'completed';

export interface VoiceStatusInput {
  /** `null` until the first status probe returns. */
  server: ServerVoiceStatus | null;
  failure: VoiceFailure | null;
  playback: PlaybackState;
}

export function deriveVoiceStatus({ server, failure, playback }: VoiceStatusInput): VoiceStatus {
  if (playback === 'generating') return { phase: 'generating', message: 'Generating speech…' };
  if (playback === 'speaking') return { phase: 'speaking', message: 'Speaking' };
  if (playback === 'paused') return { phase: 'paused', message: 'Paused' };
  if (playback === 'completed') return { phase: 'completed', message: 'Finished' };

  if (failure) {
    if (failure.code === 'voice-aborted') return { ...INITIAL_VOICE_STATUS, phase: 'idle', message: 'Ready' };
    if (failure.code === 'voice-offline' || failure.code === 'voice-unconfigured') {
      return { phase: 'disconnected', message: 'Voice offline', code: failure.code, detail: failure.message };
    }
    return { phase: 'error', message: 'Voice error', code: failure.code, detail: failure.message };
  }

  if (!server) return { ...INITIAL_VOICE_STATUS };
  if (server.ready) return { phase: 'idle', message: 'Ready' };
  // A service that NAMES itself (`engine !== 'none'`) exists but is not answering ready yet — its
  // model is still loading. The route's `configured` flag means "ready AND exists", so it cannot be
  // the test here: that would report a warming service as dead and hide a real first-boot wait.
  if (server.engine !== 'none') {
    return {
      phase: 'preparing',
      message: 'Preparing the voice…',
      detail: server.reason ?? undefined,
    };
  }
  return {
    phase: 'disconnected',
    message: 'Voice offline',
    code: 'voice-unconfigured',
    detail: server.reason ?? 'No AI voice is configured on this deployment.',
  };
}
