import { AlertTriangle, Check, Loader2, RotateCw } from 'lucide-react';
import type { VoiceTutor } from './useVoiceTutor';
import { FEMALE_PRESETS, TOTAL_MODEL_BYTES, VOICE_PRESETS, bytesProgressLabel, formatBytes, type VoicePreset } from '../../core/voice/assets';
import type { VoiceStatus as StatusShape } from '../../core/voice/protocol';
import { clamp01 } from '../../core/voice/protocol';

/**
 * The voice engine's status — real, and never aspirational.
 *
 * The model runs in THIS browser, so the row reports what the worker said: bytes crossing the network
 * while the checkpoint arrives, "starting" while the four sessions are built, "ready" once a preset is
 * loaded, and the engine's own error code when it could not start. "Ready" is only ever printed after
 * the graphs loaded: an HTTP 200 for a 250 MB file proves nothing about whether ONNX Runtime could
 * parse it.
 *
 * The first visit is the only slow one, and the panel says so out loud — a bar, megabytes, and the
 * promise that this is paid once.
 */
export function AiVoiceRow({ voice }: { voice: VoiceTutor }) {
  const status: StatusShape = voice.voiceStatus;
  const { phase, code, detail } = status;
  const ready = phase === 'ready' || phase === 'speaking';

  return (
    <div className="small muted" style={{ marginTop: 8, display: 'grid', gap: 6 }} aria-live="polite">
      {ready ? (
        <span className="row" style={{ gap: 5 }}>
          <Check size={12} aria-hidden="true" />
          <span>
            <b>AI voice</b> · Supertonic 3 · {voice.preset} · Hindi + English · runs in this browser
          </span>
        </span>
      ) : phase === 'error' ? (
        <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="row" style={{ gap: 5 }}>
            <AlertTriangle size={12} aria-hidden="true" />
            <span>
              Supertonic 3 could not load{code ? ` (${code})` : ''}
              {detail ? `: ${detail}` : '.'}
            </span>
          </span>
          <button type="button" className="btn small ghost" onClick={voice.refreshServerVoice}>
            <RotateCw size={12} /> Retry
          </button>
          <button type="button" className="btn small ghost" onClick={() => void voice.clearVoiceCache()}>
            Clear voice cache
          </button>
        </span>
      ) : (
        <>
          <VoiceLoadProgress status={status} />
          <span>
            {phase === 'idle'
              ? `Supertonic 3 · ${voice.preset} · downloads on the first Speak (${formatBytes(status.totalBytes ?? TOTAL_MODEL_BYTES)}, then cached)`
              : 'One-time download. It stays in this browser, so later answers speak immediately.'}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * The bar itself — shared by the settings row and the mentor panel so both describe the same state.
 *
 * Bytes are the headline where they exist, because "259 of 379 MB" answers the real question ("how
 * long?") in a way a percentage cannot. Once the download is done there is nothing to count, so the
 * bar turns indeterminate and says what it is doing instead of inventing a number.
 */
export function VoiceLoadProgress({ status }: { status: StatusShape }) {
  const downloading = status.phase === 'downloading';
  const pct = Math.round(clamp01(status.progress ?? 0) * 100);
  const received = Number(status.receivedBytes ?? 0);
  const total = Number(status.totalBytes ?? 0);
  const preparing = status.phase === 'initializing';

  return (
    <div className="voice-load">
      <div
        className={`voice-load-track${downloading ? '' : ' indeterminate'}`}
        role="progressbar"
        aria-label="Supertonic 3 model download"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={downloading ? pct : undefined}
        aria-valuetext={downloading ? `${pct}%, ${bytesProgressLabel(received, total)}` : status.message}
      >
        <span className="voice-load-fill" style={{ width: `${downloading ? Math.max(2, pct) : 35}%` }} />
      </div>
      <div className="voice-load-line">
        <span>{downloading ? <b>{bytesProgressLabel(received, total)}</b> : <b>{preparing ? 'Starting the engine…' : 'Waiting to start'}</b>}</span>
        <span>{downloading ? `${pct}%` : ''}</span>
      </div>
    </div>
  );
}

/**
 * What the Speak button says while the engine is not ready yet — an acknowledgement that the press
 * landed, which is the difference between "slow" and "broken".
 */
export function VoicePrepareChip({ status }: { status: StatusShape }) {
  if (status.phase !== 'downloading' && status.phase !== 'initializing') return null;
  const pct = Math.round(clamp01(status.progress ?? 0) * 100);
  return (
    <span className="voice-prep small muted" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      {status.phase === 'downloading' ? `Preparing voice… ${pct}%` : 'Starting voice…'}
    </span>
  );
}

/** True while the engine is busy loading, so callers can label a button without re-deriving it. */
export function isVoicePreparing(status: StatusShape): boolean {
  return status.phase === 'downloading' || status.phase === 'initializing';
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
