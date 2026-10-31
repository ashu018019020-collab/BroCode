import { AlertTriangle, Check, Loader2, RotateCw } from 'lucide-react';
import type { VoiceTutor } from './useVoiceTutor';

/**
 * The AI voice's status line — three facts, no download.
 *
 * The voice is the browser's own synthesiser, so there is nothing to install, cache or download and no
 * server to wait for.
 */
export function AiVoiceRow({ voice }: { voice: VoiceTutor }) {
  const { state, engine } = voice.serverVoice;

  return (
    <div
      className="small muted"
      style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
      aria-live="polite"
    >
      {state === 'ready' ? (
        <span className="row" style={{ gap: 5 }}>
          <Check size={12} aria-hidden="true" />
          <span>
            <b>AI voice</b> · this browser · Hindi + English · nothing to download
          </span>
        </span>
      ) : state === 'checking' ? (
        <span className="row" style={{ gap: 5 }}>
          <Loader2 size={12} aria-hidden="true" />
          <span>Checking the AI voice…</span>
        </span>
      ) : (
        <>
          <span className="row" style={{ gap: 5 }}>
            <AlertTriangle size={12} aria-hidden="true" />
            <span>
              AI voice is unavailable on this deployment — the built-in browser voice reads answers.
            </span>
          </span>
          <button type="button" className="btn small ghost" onClick={voice.refreshServerVoice}>
            <RotateCw size={12} /> Retry
          </button>
        </>
      )}
    </div>
  );
}
