import { AlertTriangle, Check, Loader2, Volume2 } from 'lucide-react';
import { serverVoiceNote } from '../../core/voice/tts';
import type { VoiceTutor } from './useVoiceTutor';

/**
 * The AI voice's status line — what will actually speak, and the one choice the learner owns.
 *
 * The voice is generated on this deployment's server, so readiness is a fact the API reports. When it
 * has no key the row says so and offers the browser's own voice as a BUTTON: switching a learner onto
 * a robotic voice must be their decision, never a silent fallback.
 */
export function AiVoiceRow({ voice }: { voice: VoiceTutor }) {
  const note = serverVoiceNote(voice.serverVoice, voice.voiceId, voice.supported.synthesis);

  return (
    <div
      className="small muted"
      style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
      aria-live="polite"
    >
      {voice.useDeviceVoice ? (
        <>
          <span className="row" style={{ gap: 5 }}>
            <Volume2 size={12} aria-hidden="true" />
            <span><b>Device voice</b> · this browser · Hindi + English</span>
          </span>
          <button type="button" className="btn small ghost" onClick={() => voice.setUseDeviceVoice(false)}>
            Use server voice
          </button>
        </>
      ) : voice.serverVoice === 'ready' ? (
        <span className="row" style={{ gap: 5 }}>
          <Check size={12} aria-hidden="true" />
          <span><b>AI voice</b> · {note}</span>
        </span>
      ) : voice.serverVoice === 'checking' ? (
        <span className="row" style={{ gap: 5 }}>
          <Loader2 size={12} aria-hidden="true" />
          <span>{note}</span>
        </span>
      ) : (
        <>
          <span className="row" style={{ gap: 5 }}>
            <AlertTriangle size={12} aria-hidden="true" />
            <span>{note}</span>
          </span>
          {voice.supported.synthesis && (
            <button type="button" className="btn small ghost" onClick={() => voice.setUseDeviceVoice(true)}>
              Use device voice
            </button>
          )}
        </>
      )}
    </div>
  );
}
