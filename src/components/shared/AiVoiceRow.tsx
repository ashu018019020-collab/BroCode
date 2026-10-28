import { Download, Loader2, Volume2 } from 'lucide-react';
import { SUPERTONIC_WEIGHT_BYTES, supertonicSizeLabel } from '../../core/ai/supertonic';
import type { VoiceTutor } from './useVoiceTutor';

/**
 * The one control for the on-device voice, shared by every surface that speaks.
 *
 * Three facts and nothing else: which voice this is, what it costs the first time, and what it is
 * doing right now. The size is printed BEFORE the download, because 398 MB is the learner's
 * bandwidth and storage, not a detail to discover halfway through. While it loads the line shows real
 * percentage and a Cancel; when it fails it shows the reason and the same button retries.
 *
 * It is not a toggle. Turning the AI voice "on" without the weights would just be a promise the app
 * cannot keep — downloading IS the opt-in, and the built-in voice keeps reading answers either way.
 */
export function AiVoiceRow({ voice }: { voice: VoiceTutor }) {
  const { state, percent, error } = voice.aiVoice;
  const size = supertonicSizeLabel(SUPERTONIC_WEIGHT_BYTES);

  return (
    <div
      className="small muted"
      style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
      aria-live="polite"
    >
      <span>
        <b>AI voice</b> · Supertonic 3 · Hindi + English, running in this browser
      </span>

      {state === 'ready' ? (
        <span className="row" style={{ gap: 4 }}>
          <Volume2 size={12} /> Ready · {size} stored on this device
        </span>
      ) : state === 'loading' ? (
        <>
          <span className="row" style={{ gap: 4 }}>
            <Loader2 size={12} /> {percent}% of {size}
          </span>
          <button type="button" className="btn small ghost" onClick={voice.cancelAiVoice}>Cancel</button>
        </>
      ) : (
        <>
          <button type="button" className="btn small" onClick={voice.downloadAiVoice}>
            <Download size={12} /> {voice.aiCached ? 'Load AI voice' : `Download ${size} (one time)`}
          </button>
          {voice.aiCached && <span>The weights are already stored here; loading is local.</span>}
          {error && <span style={{ color: 'var(--amber)' }}>{error}</span>}
        </>
      )}
    </div>
  );
}
