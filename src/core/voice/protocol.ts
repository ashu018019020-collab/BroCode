/**
 * The nine states the voice surface can be in — as data, so the UI and the tests share one list.
 *
 * These describe a CONVERSATION WITH A SERVER, which is why there is no `downloading` phase any
 * more: the model is loaded once on the inference service, and the browser only ever waits for a
 * small WAV. What can still take time is the connection, the service's first-request warm-up, and
 * the synthesis itself, and each of those is its own state so the panel can say which one it is.
 *
 *   idle         — the service answered and is ready. Nothing is playing.
 *   connecting   — asking `GET /api/voice/status` whether a voice exists at all.
 *   preparing    — the service is up but still loading the model (its first boot).
 *   generating   — a request is in flight and no audio has started yet.
 *   speaking     — audio is actually playing. Never set from a timer.
 *   paused       — playback is held at its position (the audio clock is suspended).
 *   completed    — the answer finished playing.
 *   disconnected — the service is unreachable or unconfigured. A real state, not an error dialog.
 *   error        — the service answered with a failure; `code` says which.
 */
export type VoicePhase =
  | 'idle'
  | 'connecting'
  | 'preparing'
  | 'generating'
  | 'speaking'
  | 'paused'
  | 'completed'
  | 'disconnected'
  | 'error';

export interface VoiceStatus {
  phase: VoicePhase;
  /** Short line for the panel. Never "Loading…" with no subject for more than one state. */
  message: string;
  /** The route's own machine code (`VOICE_NOT_CONFIGURED`, `VOICE_TIMEOUT`, …), when it sent one. */
  code?: string;
  /** A sentence the learner can act on. Only ever set with `phase: 'error'`. */
  detail?: string;
  /** 0–1, only where a real fraction exists (the connection probe does not have one). */
  progress?: number;
}

export const INITIAL_VOICE_STATUS: VoiceStatus = {
  phase: 'connecting',
  message: 'Connecting to the AI voice…',
};

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Copy for each phase, so no component invents its own wording. */
export const PHASE_COPY: Record<VoicePhase, string> = {
  idle: 'Ready',
  connecting: 'Connecting to the AI voice…',
  preparing: 'Preparing the voice…',
  generating: 'Generating speech…',
  speaking: 'Speaking',
  paused: 'Paused',
  completed: 'Finished',
  disconnected: 'Voice offline',
  error: 'Voice error',
};

/**
 * Can the engine speak right now?
 *
 * `generating` counts: the request is already accepted, so a control must not treat the engine as
 * unavailable in the half-second before the first sample. `disconnected` and `error` are the only
 * two states that mean "this will not work until something changes".
 */
export function isVoiceReady(status: Pick<VoiceStatus, 'phase'>): boolean {
  return status.phase !== 'disconnected' && status.phase !== 'error';
}

/** A wait the learner should be told about, rather than a failure. */
export function isVoicePreparing(status: Pick<VoiceStatus, 'phase'>): boolean {
  return status.phase === 'connecting' || status.phase === 'preparing' || status.phase === 'generating';
}

/** Is audio (or a press that will produce it) currently owning the speaker? */
export function isVoiceActive(status: Pick<VoiceStatus, 'phase'>): boolean {
  return status.phase === 'speaking' || status.phase === 'paused' || status.phase === 'generating';
}
