import { AlertTriangle, Check, Loader2, RotateCw } from 'lucide-react';
import type { VoiceTutor } from './useVoiceTutor';
import { FEMALE_PRESETS, VOICE_PRESETS, type VoicePreset } from '../../core/voice/assets';

/**
 * The voice engine's status line — real, never aspirational.
 *
 * The model runs in THIS browser (a worker holding the real Supertonic 3 graphs), so the row reports
 * what the worker said: bytes downloaded while the checkpoint arrives, "initializing" while the
 * sessions are created, "ready" once a preset is loaded, and the engine's own error code when it
 * could not start. "Ready" is only ever printed after the graphs loaded — an HTTP 200 for a 250 MB
 * file proves nothing about whether ONNX Runtime could parse it.
 *
 * Retry re-runs the real work (download + sessions), and Clear cache deletes only this model's Cache
 * Storage entry, never the learner's records.
 */
export function AiVoiceRow({ voice }: { voice: VoiceTutor }) {
  const { phase, progress, code, detail } = voice.voiceStatus;
  const ready = phase === 'ready' || phase === 'speaking';
  const busy = phase === 'downloading' || phase === 'initializing';
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <div
      className="small muted"
      style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
      aria-live="polite"
    >
      {ready ? (
        <span className="row" style={{ gap: 5 }}>
          <Check size={12} aria-hidden="true" />
          <span>
            <b>AI voice</b> · Supertonic 3 · {voice.preset} · Hindi + English · runs in this browser
          </span>
        </span>
      ) : busy ? (
        <span className="row" style={{ gap: 5 }}>
          <Loader2 size={12} aria-hidden="true" />
          <span>
            {phase === 'downloading'
              ? `Downloading Supertonic 3… ${pct}% (one time, then cached)`
              : 'Initializing Supertonic 3…'}
          </span>
        </span>
      ) : phase === 'error' ? (
        <>
          <span className="row" style={{ gap: 5 }}>
            <AlertTriangle size={12} aria-hidden="true" />
            <span>
              Supertonic 3 could not load{code ? ` (${code})` : ''}
              {detail ? `: ${detail}` : '.'} Check your connection and retry.
            </span>
          </span>
          <button type="button" className="btn small ghost" onClick={voice.refreshServerVoice}>
            <RotateCw size={12} /> Retry
          </button>
          <button type="button" className="btn small ghost" onClick={() => void voice.clearVoiceCache()}>
            Clear voice cache
          </button>
        </>
      ) : (
        <span className="row" style={{ gap: 5 }}>
          <span>Supertonic 3 · {voice.preset} · loads on first Speak (~379 MB, then cached)</span>
        </span>
      )}
    </div>
  );
}

/**
 * The preset picker: the five female voices first, because the mentor ships as a female tutor, and
 * the male pair behind them for anyone who prefers one. Every option is a real `voice_styles/*.json`
 * file from the pinned checkpoint — no option is decorative.
 */
export function VoicePresetPicker({
  value,
  onChange,
}: {
  value: VoicePreset;
  onChange: (preset: VoicePreset) => void;
}) {
  return (
    <>
      <label className="small muted" htmlFor="mentor-preset">Voice</label>
      <select id="mentor-preset" value={value} onChange={(event) => onChange(event.target.value as VoicePreset)}>
        <optgroup label="Female">
          {FEMALE_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
        </optgroup>
        <optgroup label="Male">
          {VOICE_PRESETS.filter((preset) => preset.startsWith('M')).map((preset) => (
            <option key={preset} value={preset}>{preset}</option>
          ))}
        </optgroup>
      </select>
    </>
  );
}
