import { AlertTriangle, Check, Download, Loader2, RotateCw, Volume2 } from 'lucide-react';
import { SUPERTONIC_WEIGHT_BYTES, supertonicSizeLabel } from '../../core/ai/supertonic';
import type { VoiceTutor } from './useVoiceTutor';

/**
 * The AI voice's status line — what will actually speak, and what it costs the first time.
 *
 * Two engines can answer. A hosted Supertonic service (or Google) is used when the deployment has
 * one and prints "Server-powered" ONLY after the health probe answered. On a deployment without a
 * server — which is what the production site is — the SAME Supertonic model runs in this browser, so
 * the row reports that engine's real state: downloading with true byte progress, ready on this
 * device, or the actual failure with Retry. It never shows a dead deployment-unavailable message
 * while a working on-device engine exists, and it never calls the built-in browser voice AI audio.
 */
export function AiVoiceRow({ voice }: { voice: VoiceTutor }) {
  const { state, engine } = voice.serverVoice;
  const ai = voice.aiVoice;
  const size = supertonicSizeLabel(SUPERTONIC_WEIGHT_BYTES);
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
      ) : ai.state === 'ready' ? (
        <span className="row" style={{ gap: 5 }}>
          <Volume2 size={12} aria-hidden="true" />
          <span>
            <b>AI voice</b> · Supertonic 3 · Hindi + English · on this device
          </span>
        </span>
      ) : ai.state === 'loading' ? (
        <>
          <span className="row" style={{ gap: 5 }}>
            <Loader2 size={12} aria-hidden="true" />
            <span>
              Preparing the AI voice on this device… {ai.percent}% of {size} (one time)
            </span>
          </span>
          <button type="button" className="btn small ghost" onClick={voice.cancelAiVoice}>
            Cancel
          </button>
        </>
      ) : ai.state === 'error' ? (
        <>
          <span className="row" style={{ gap: 5 }}>
            <AlertTriangle size={12} aria-hidden="true" />
            <span>{ai.error ?? 'The AI voice could not load on this device.'}</span>
          </span>
          <button type="button" className="btn small ghost" onClick={voice.downloadAiVoice}>
            <RotateCw size={12} /> Retry
          </button>
        </>
      ) : state === 'checking' ? (
        <span className="row" style={{ gap: 5 }}>
          <Loader2 size={12} aria-hidden="true" />
          <span>Checking the AI voice…</span>
        </span>
      ) : (
        <>
          <span className="row" style={{ gap: 5 }}>
            <Download size={12} aria-hidden="true" />
            <span>
              <b>AI voice</b> · Supertonic 3 · Hindi + English — runs on this device, loads on the first
              answer ({size}, one time).
            </span>
          </span>
          <button type="button" className="btn small ghost" onClick={voice.downloadAiVoice}>
            Load now
          </button>
        </>
      )}
    </div>
  );
}
