/**
 * The interview room's VOICE SESSION STATE — pure, no React, no DOM.
 *
 * `useVoiceTutor` owns the actual audio (it is the only file that touches SpeechRecognition and
 * speechSynthesis, and it cannot be loaded by a test — see the test-loader ceiling in AGENTS.md).
 * But "which actions are legal, and what event moves the interview where" is a DECISION, and every
 * decision that can go wrong must be testable. This module is that decision, reduced to its
 * smallest testable form — the wiring is only allowed to follow it, never to deviate from it.
 *
 * The one rule it exists to enforce (the Answer-by-Voice bug): the microphone and the speaker are
 * SEPARATE machines. Starting to listen, finishing an answer, submitting, or an evaluation error
 * must never disable the voice — every phase path eventually returns to `idle`, which is the
 * "ready, voice mode still on" state the next question speaks from. Cancellation is reserved for
 * INTENTIONAL actions (Stop speaking, pause, leave, session shutdown), which is why
 * {type:'speak-cancelled'} is a distinct event from a phase transition and why the hook is only
 * permitted to call `speechSynthesis.cancel()` when it has one of those four reasons.
 */

/** The observable phases of one voice turn, named once. */
export type VoicePhase =
  /** Ready. Voice mode still on; the next question/feedback may speak at any time. */
  | 'idle'
  /** The AI is speaking (the question, a hint, or the feedback). */
  | 'speaking'
  /** The microphone is open and capturing the candidate's answer. */
  | 'listening'
  /** A transcript was submitted; the evaluation request is in flight. */
  | 'processing'
  /** The learner paused the interview (clock and speech held, session not lost). */
  | 'paused'
  /** A voice or evaluation failure was surfaced; recovery is offered. */
  | 'error';

export type VoiceEvent =
  | { type: 'speak-start' }
  | { type: 'speak-end' }
  /** Speech was stopped ON PURPOSE (Stop, pause, navigation, shutdown) — never as cleanup. */
  | { type: 'speak-cancelled' }
  | { type: 'listen-start' }
  | { type: 'listen-end' }
  | { type: 'submit' }
  | { type: 'submit-failed' }
  | { type: 'evaluation-ready' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'error' }
  | { type: 'recover' }
  | { type: 'reset' };

/**
 * One transition table entry per (phase, event). Reading it top to bottom answers the acceptance
 * question directly: NO event path leaves the session stranded out of `idle` — `{ listen-start }`,
 * `{ listen-end }`, `{ submit }`, `{ evaluation-ready }` all return to a state that can speak.
 */
export function stepVoiceSession(phase: VoicePhase, event: VoiceEvent): VoicePhase {
  switch (event.type) {
    // Speech begins from wherever the turn stands; the mic can also catch a verdict mid-speech.
    case 'speak-start':
      return phase === 'paused' ? 'paused' : 'speaking';
    // Speech finishing on its own always lands back on ready — never "voice off".
    case 'speak-end':
      return 'idle';
    // Intentional stop: the point of listening-while-talking (barge-in) and the Stop button.
    case 'speak-cancelled':
      return phase === 'paused' ? 'paused' : 'idle';
    // Barge-in: the learner talking outranks the AI talking. Voice mode is untouched.
    case 'listen-start':
      return 'listening';
    case 'listen-end':
      return 'idle';
    case 'submit':
      return phase === 'processing' ? phase : 'processing'; // duplicate submits are ignored here
    case 'submit-failed':
      return 'idle';
    case 'evaluation-ready':
      return 'speaking';
    case 'pause':
      return 'paused';
    case 'resume':
      return 'idle';
    case 'error':
      return 'error';
    case 'recover':
      return 'idle';
    // Reset is always available: a finished turn can never trap the session.
    case 'reset':
      return 'idle';
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/** The actions the live view offers, and whether they are legal in the current phase. */
export type VoiceAction =
  | 'speak-question'
  | 'repeat-question'
  | 'stop-speaking'
  | 'answer-by-voice'
  | 'stop-listening'
  | 'pause-speech'
  | 'resume-speech'
  | 'submit'
  | 'skip'
  | 'next-question'
  | 'pause-interview'
  | 'resume-interview';

export function actionLegal(action: VoiceAction, phase: VoicePhase): boolean {
  switch (action) {
    case 'speak-question':
    case 'repeat-question':
      // Speaking is possible in every phase except while the mic owns the turn (echo risk) and
      // while the interview is paused. A finished evaluation never blocks it.
      return phase !== 'listening' && phase !== 'paused';
    case 'stop-speaking':
      return phase === 'speaking';
    case 'answer-by-voice':
      return phase !== 'listening' && phase !== 'paused' && phase !== 'processing';
    case 'stop-listening':
      return phase === 'listening';
    case 'pause-speech':
    case 'resume-speech':
      return phase === 'speaking';
    case 'submit':
      return phase !== 'listening' && phase !== 'processing' && phase !== 'paused';
    case 'skip':
    case 'next-question':
      return phase !== 'processing' && phase !== 'listening';
    case 'pause-interview':
      return phase !== 'paused';
    case 'resume-interview':
      return phase === 'paused';
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

/**
 * The one label the status chip shows. Deliberately SAME-NAMED as what is actually true, so the
 * UI cannot claim "listening" while an evaluation is in flight.
 */
export function phaseLabel(phase: VoicePhase): string {
  switch (phase) {
    case 'speaking': return 'AI speaking';
    case 'listening': return 'Listening';
    case 'processing': return 'Evaluating answer';
    case 'paused': return 'Paused';
    case 'error': return 'Voice error';
    default: return 'Ready';
  }
}

/**
 * Whether an AUTO advance may fire. Guarded explicitly so a follow-up speech, a needs-clarification
 * verdict, or an in-flight recording can never advance the queue underneath the learner.
 */
export function mayAutoAdvance(input: {
  phase: VoicePhase;
  ended: boolean;
  autoNext: boolean;
  finalVerdict: boolean;
}): boolean {
  return input.phase === 'speaking' && input.ended && input.autoNext && input.finalVerdict;
}
