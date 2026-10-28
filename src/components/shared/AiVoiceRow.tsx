import { AlertTriangle, Check, Loader2, RotateCw } from 'lucide-react';
import type { VoiceTutor } from './useVoiceTutor';

/**
 * The AI voice's status line — three facts, no download.
 *
 * The model runs on the server (`voice-service/`), so there is nothing for a learner to install, cache
 * or wait for. What is left to show is which engine answered the readiness probe and whether it is
 * ready; when it is not, the row says so plainly and offers the only useful action: ask again.
 *
 * "Server-powered" is printed only for `ready`, which the server only reports after its inference
 * service has actually answered a health check — the label is evidence, not aspiration.
 */
export function AiVoiceRow({ voice }: { voice: VoiceTutor }) {
  const { state, engine } = voice.serverVoice;
  const name = engine === 'supertonic' ? 'Supertonic 3' : engine === 'google' ? 'Google Neural2' : null;

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
            <b>AI voice</b> · {name ?? 'Server voice'} · Hindi + English · Server-powered
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
