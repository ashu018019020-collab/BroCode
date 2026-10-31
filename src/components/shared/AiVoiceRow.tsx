import { AlertTriangle, Check, Loader2, RotateCw } from 'lucide-react';
import type { VoiceTutor } from './useVoiceTutor';
import { FEMALE_PRESETS, VOICE_PRESETS, type VoicePreset } from '../../core/voice/presets';
import { isVoicePreparing, type VoiceStatus as StatusShape } from '../../core/voice/protocol';

/**
 * The voice engine's status — real, and never aspirational.
 *
 * The model runs on the BroCode server, so this row reports what the DEPLOYMENT said: `connecting`
 * while the status probe is in flight, `preparing` while the inference service is still loading the
 * checkpoint on its first boot, `idle` once it is warm, and the route's own code when it answered
 * with a fault. "Ready" is only ever printed after `GET /api/voice/status` returned `ready: true`.
 *
 * There is deliberately no download bar here any more. The browser receives a few hundred kilobytes
 * of WAV per sentence; nothing is cached on the device and nothing is counted in megabytes. A bar
 * that measured a download that no longer happens was the bug wearing a progress indicator.
 */
export function AiVoiceRow({ voice }: { voice: VoiceTutor }) {
  const status: StatusShape = voice.voiceStatus;
  const { phase, code, detail } = status;
  const label = voice.serverVoice.engine === 'google' ? 'Google Neural2' : 'Supertonic 3';

  return (
    <div className="small muted" style={{ marginTop: 8, display: 'grid', gap: 6 }} aria-live="polite">
      {phase === 'idle' || phase === 'speaking' || phase === 'paused' || phase === 'completed' || phase === 'generating' ? (
        <span className="row" style={{ gap: 5 }}>
          <Check size={12} aria-hidden="true" />
          <span>
            <b>AI voice</b> · {label} · {voice.preset} · Hindi + English · runs on the BroCode server
          </span>
        </span>
      ) : phase === 'error' || phase === 'disconnected' ? (
        <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="row" style={{ gap: 5, alignItems: 'flex-start' }}>
            <AlertTriangle size={12} aria-hidden="true" />
            <span>
              {phase === 'disconnected' ? 'The AI voice is offline' : 'The AI voice could not speak'}
              {code ? ` (${code})` : ''}
              {detail ? `: ${detail}` : '.'}
            </span>
          </span>
          {/*
            Retry appears ONLY where pressing it can change something. A missing voice or a rejected
            secret is configuration: offering Retry there trains the learner to press a button that
            cannot work, which is the "permanent Retry" this screen used to have.
          */}
          {phase === 'error' && code !== 'voice-auth-failed' && code !== 'voice-unconfigured' && (
            <button type="button" className="btn small ghost" onClick={voice.refreshServerVoice}>
              <RotateCw size={12} /> Retry
            </button>
          )}
        </span>
      ) : (
        <span className="row" style={{ gap: 5 }}>
          <Loader2 size={12} className="spin" aria-hidden="true" />
          <span>
            {phase === 'connecting'
              ? 'Connecting to the AI voice on the BroCode server…'
              : 'The voice service is loading its model — this is the first request after a restart.'}
          </span>
        </span>
      )}
      {voice.presets.length > 1 && (
        <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {voice.presets.map((preset) => (
            <span key={preset} className={`chip${preset === voice.preset ? ' easy' : ''}`}>{preset}</span>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * What the Speak button says while the voice is not ready yet — an acknowledgement that the press
 * landed, which is the difference between "slow" and "broken".
 */
export function VoicePrepareChip({ status }: { status: StatusShape }) {
  if (!isVoicePreparing(status)) return null;
  return (
    <span className="voice-prep small muted" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      {status.phase === 'generating' ? 'Generating voice…' : status.phase === 'preparing' ? 'Preparing voice…' : 'Connecting…'}
    </span>
  );
}

/**
 * The preset picker: the five female voices first, because the mentor ships as a female tutor, and
 * the male five behind them for anyone who prefers one.
 *
 * Every option here is a real `voice_styles/*.json` in the pinned checkpoint, and the list is
 * narrowed to what the backend reported once `GET /api/voice/status` has answered — a voice the
 * server does not have is never offered.
 */
export function VoicePresetPicker({
  value,
  onChange,
  available = VOICE_PRESETS,
  disabled = false,
}: {
  value: VoicePreset;
  onChange: (preset: VoicePreset) => void;
  available?: readonly VoicePreset[];
  disabled?: boolean;
}) {
  const female = available.filter((preset) => (FEMALE_PRESETS as readonly string[]).includes(preset));
  const male = available.filter((preset) => !(FEMALE_PRESETS as readonly string[]).includes(preset));
  return (
    <>
      <label className="small muted" htmlFor="mentor-preset">Voice</label>
      <select
        id="mentor-preset"
        value={value}
        onChange={(event) => onChange(event.target.value as VoicePreset)}
        disabled={disabled}
      >
        {female.length > 0 && (
          <optgroup label="Female">
            {female.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
          </optgroup>
        )}
        {male.length > 0 && (
          <optgroup label="Male">
            {male.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
          </optgroup>
        )}
      </select>
    </>
  );
}
