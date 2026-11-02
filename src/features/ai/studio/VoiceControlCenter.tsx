import {
  AlertTriangle, AudioLines, Gauge, Loader2, Mic2, MicOff, Pause, Play, RotateCcw,
  Square, Trash2, Volume2, VolumeX, Zap,
} from 'lucide-react';
import { VOICE_PRESETS, type VoicePreset } from '../../../core/voice/assets';
import {
  mentorVoiceHint, mentorVoiceLabel, speechEngineNote, type SpeechPreference,
} from '../../../core/voice/mentor-voice';
import type { MentorVoice } from '../../../components/shared/useMentorVoice';
import { AIVoiceOrb } from './AIVoiceOrb';

/**
 * The right-hand control center: one orb, one status, every real control.
 *
 * Each button maps to a verb on the shared voice hook, and every disabled state is a fact (nothing
 * spoken yet, nothing to resume, muted) rather than a placeholder. The download bar only exists while
 * bytes are actually moving, and it reports the real byte counts the worker measured.
 */
export interface VoiceControlCenterProps {
  voice: MentorVoice;
  onSpeakLast: () => void;
  onMic: () => void;
  hasSpoken: boolean;
}

const LANG_LABELS: Record<SpeechPreference, string> = {
  auto: 'Auto detect',
  en: 'English',
  hi: 'Hindi / Hinglish',
};

export function VoiceControlCenter({ voice, onSpeakLast, onMic, hasSpoken }: VoiceControlCenterProps) {
  const { state, locale } = voice;
  const busy = state === 'loading' || state === 'preparing' || state === 'generating';
  const statusLabel = mentorVoiceLabel(state, locale);

  return (
    <section className="voice-card glass" aria-label="Voice control center">
      <header className="voice-head">
        <div>
          <span className="eyebrow">Voice control</span>
          <h2>Supertonic&nbsp;3</h2>
        </div>
        <span className={`state-pill ${state}`} aria-live="polite">
          {busy ? <Loader2 size={12} className="spin" /> : <Zap size={12} />}
          {statusLabel}
        </span>
      </header>

      <AIVoiceOrb
        state={state}
        levelRef={voice.levelRef}
        micLevelRef={voice.micLevelRef}
        label={statusLabel}
      />

      <p className="voice-hint">{mentorVoiceHint(state, locale)}</p>

      {/* ONE progress indicator, and only while it means something real. */}
      {(state === 'loading' || state === 'preparing') && (
        <div className="voice-progress" role="status" aria-live="polite">
          <div className="track"><span style={{ width: `${Math.round(voice.progress * 100)}%` }} /></div>
          <div className="row spread small">
            <span>{voice.file && voice.file !== 'done' ? voice.file : 'Loading model files'}</span>
            <span className="mono">
              {Math.round(voice.progress * 100)}%
              {voice.totalBytes > 0 ? ` · ${voice.totalLabel}` : ''}
            </span>
          </div>
        </div>
      )}

      <div className="voice-actions">
        <button
          type="button"
          className={`ctl primary${voice.listening ? ' on' : ''}`}
          onClick={onMic}
          aria-pressed={voice.listening}
          title={voice.listening ? 'Stop listening' : 'Ask by voice'}
        >
          {voice.listening ? <MicOff size={15} /> : <Mic2 size={15} />}
          {voice.listening ? 'Stop' : 'Speak'}
        </button>
        <button
          type="button"
          className="ctl"
          onClick={voice.paused ? voice.resume : voice.pause}
          disabled={!voice.speaking && !voice.paused}
          title={voice.paused ? 'Resume where it stopped' : 'Pause the spoken answer'}
        >
          {voice.paused ? <Play size={15} /> : <Pause size={15} />}
          {voice.paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="ctl" onClick={voice.replay} disabled={!hasSpoken}>
          <RotateCcw size={15} /> Replay
        </button>
        <button
          type="button"
          className="ctl"
          onClick={voice.interrupt}
          disabled={!voice.speaking && !voice.generating}
          title="Stop the voice and drop the queue"
        >
          <Square size={14} /> Interrupt
        </button>
        <button
          type="button"
          className={`ctl${voice.muted ? '' : ' on'}`}
          onClick={() => voice.setMuted(!voice.muted)}
          aria-pressed={!voice.muted}
          title={voice.muted ? 'Unmute spoken answers' : 'Mute spoken answers'}
        >
          {voice.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          {voice.muted ? 'Muted' : 'Voice on'}
        </button>
        <button
          type="button"
          className="ctl"
          onClick={onSpeakLast}
          disabled={!hasSpoken || voice.muted}
          title="Speak the last answer again"
        >
          <AudioLines size={15} /> Speak last
        </button>
      </div>

      <div className="voice-toggles">
        <label className="switch">
          <input
            type="checkbox"
            checked={voice.autoSpeak}
            onChange={(event) => voice.setAutoSpeak(event.target.checked)}
          />
          <span>Auto speak</span>
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={voice.handsFree}
            onChange={(event) => voice.setHandsFree(event.target.checked)}
          />
          <span>Hands-free</span>
        </label>
      </div>

      <div className="voice-settings">
        <label>
          <span>Language</span>
          <select
            value={voice.langPref}
            onChange={(event) => voice.setLangPref(event.target.value as SpeechPreference)}
          >
            {(Object.keys(LANG_LABELS) as SpeechPreference[]).map((id) => (
              <option key={id} value={id}>{LANG_LABELS[id]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Voice</span>
          <select
            value={voice.preset}
            onChange={(event) => voice.setPreset(event.target.value as VoicePreset)}
          >
            {VOICE_PRESETS.map((preset) => (
              <option key={preset} value={preset}>{preset}</option>
            ))}
          </select>
        </label>
        <label className="speed">
          <span><Gauge size={12} /> {voice.speed.toFixed(1)}×</span>
          <input
            type="range"
            min={0.7}
            max={1.4}
            step={0.1}
            value={voice.speed}
            onChange={(event) => voice.setSpeed(Number(event.target.value))}
            aria-label="Speech speed"
          />
        </label>
      </div>

      <div className="voice-foot">
        <p>{speechEngineNote(voice.preset, locale)}</p>
        {state === 'idle' && (
          <button type="button" className="link" onClick={voice.prepare}>
            Download model now
          </button>
        )}
        <button
          type="button"
          className="link subtle"
          onClick={() => { void voice.clearCache(); }}
          title="Remove the cached model files — the next answer downloads them again"
        >
          <Trash2 size={11} /> Clear cache
        </button>
      </div>

      {voice.error && (
        <p className="voice-error" role="alert">
          <AlertTriangle size={13} />
          <span>{voice.error}</span>
          <button type="button" className="link" onClick={voice.dismissError}>Dismiss</button>
        </p>
      )}
    </section>
  );
}
