import {
  AlertTriangle, AudioLines, Check, Gauge, Info, Mic2, MicOff, Pause, Play, RefreshCw,
  RotateCcw, Square, Volume2, VolumeX,
} from 'lucide-react';
import {
  mentorVoiceHint, mentorVoiceLabel, type SpeechPreference,
} from '../../../core/voice/mentor-voice';
import { describeVoice } from '../../../core/voice/voice-discovery';
import { languageLabel, type MentorVoice } from '../../../components/shared/useMentorVoice';
import { AIVoiceOrb } from './AIVoiceOrb';

/**
 * The voice control center.
 *
 * Every control maps to a verb on the shared adapter and every disabled state is a fact (nothing has
 * been spoken yet, nothing is playing, no voice is installed) rather than a placeholder. The two
 * switches the learner actually uses are proper `role="switch"` cards with their own state line — not
 * two cramped checkboxes sharing a row — and the diagnostics list is the honest answer to "why is
 * there no sound?": the detected voices, the selected one, the platform state and the last error.
 *
 * There is no download progress here because there is nothing to download: the sound is a voice the
 * device already has.
 */
export interface VoiceControlCenterProps {
  voice: MentorVoice;
  onSpeakLast: () => void;
  onMic: () => void;
  hasSpoken: boolean;
}

const LANGUAGES: SpeechPreference[] = ['auto', 'en', 'hi'];

function ToggleCard({
  title, description, checked, status, onChange, icon, disabled, tone,
}: {
  title: string;
  description: string;
  checked: boolean;
  status: string;
  onChange: (next: boolean) => void;
  icon: React.ReactNode;
  disabled?: boolean;
  tone?: 'cyan' | 'mint';
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={title}
      className={`toggle-card${checked ? ' on' : ''}${tone ? ` ${tone}` : ''}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="toggle-icon" aria-hidden="true">{icon}</span>
      <span className="toggle-body">
        <span className="toggle-title">{title}</span>
        <span className="toggle-desc">{description}</span>
        <span className="toggle-state">
          <b>{checked ? 'ON' : 'OFF'}</b>
          <span>{status}</span>
        </span>
      </span>
      <span className="toggle-track" aria-hidden="true"><span className="knob" /></span>
    </button>
  );
}

export function VoiceControlCenter({ voice, onSpeakLast, onMic, hasSpoken }: VoiceControlCenterProps) {
  const { state, locale } = voice;
  const status = mentorVoiceLabel(state, locale);
  const handsFreeStatus = !voice.recognitionSupported
    ? 'Voice input unavailable here'
    : voice.micPermission === 'denied'
      ? 'Microphone blocked in this browser'
      : voice.listening
        ? 'Listening now'
        : 'Reopens the mic after each answer';

  return (
    <section className="voice-card glass" aria-label="Voice control center">
      <header className="voice-head">
        <div>
          <span className="eyebrow">Voice control</span>
          <h2>Voice</h2>
        </div>
        <span className={`state-pill ${state}`} role="status" aria-live="polite">
          {state === 'speaking' && <AudioLines size={12} />}
          {status}
        </span>
      </header>

      <AIVoiceOrb state={state} levelRef={voice.levelRef} micLevelRef={voice.micLevelRef} label={status} />

      <p className="voice-hint">{mentorVoiceHint(state, locale)}</p>

      {/* The two switches, as cards: a real target, a real state, and no shared checkbox row. */}
      <div className="toggle-grid">
        <ToggleCard
          title="Auto speak"
          description="Every finished answer is read aloud."
          checked={voice.autoSpeak}
          status={voice.autoSpeak ? 'Answers speak automatically' : 'Only Speak reads aloud'}
          onChange={voice.setAutoSpeak}
          icon={<Volume2 size={15} />}
          tone="cyan"
          disabled={!voice.supported}
        />
        <ToggleCard
          title="Hands-free"
          description="The mic reopens after the voice finishes."
          checked={voice.handsFree}
          status={handsFreeStatus}
          onChange={voice.setHandsFree}
          icon={<Mic2 size={15} />}
          tone="mint"
          disabled={!voice.recognitionSupported}
        />
      </div>

      <div className="voice-actions">
        <button
          type="button"
          className={`ctl primary${voice.listening ? ' on' : ''}`}
          onClick={onMic}
          aria-pressed={voice.listening}
          title={voice.listening ? 'Stop listening' : 'Ask by voice'}
        >
          {voice.listening ? <MicOff size={15} /> : <Mic2 size={15} />}
          {voice.listening ? 'Stop' : 'Ask'}
        </button>
        <button
          type="button"
          className="ctl"
          onClick={voice.paused ? voice.resume : voice.pause}
          disabled={!voice.speaking && !voice.paused}
          title={voice.paused ? 'Continue the spoken answer' : 'Pause the spoken answer'}
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
          disabled={!voice.speaking && !voice.paused}
          title="Stop the voice and drop anything queued"
        >
          <Square size={14} /> Stop
        </button>
        <button
          type="button"
          className={`ctl${voice.enabled ? ' on' : ''}`}
          onClick={() => voice.setEnabled(!voice.enabled)}
          aria-pressed={voice.enabled}
          title={voice.enabled ? 'Turn spoken answers off' : 'Turn spoken answers on'}
        >
          {voice.enabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          {voice.enabled ? 'Voice on' : 'Muted'}
        </button>
        <button
          type="button"
          className="ctl"
          onClick={onSpeakLast}
          disabled={!hasSpoken || !voice.enabled}
          title="Read the last answer aloud"
        >
          <AudioLines size={15} /> Speak last
        </button>
      </div>

      <div className="voice-settings">
        <label className="field">
          <span>Language</span>
          <select
            value={voice.langPref}
            onChange={(event) => voice.setLangPref(event.target.value as SpeechPreference)}
          >
            {LANGUAGES.map((id) => (
              <option key={id} value={id}>{languageLabel(id)}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Voice · {locale === 'hi' ? 'Hindi' : 'English'}</span>
          <div className="field-row">
            <select
              value={voice.voiceURI}
              onChange={(event) => voice.selectVoice(locale, event.target.value)}
              disabled={!voice.availableVoices.length}
            >
              <option value="">
                {voice.availableVoices.length ? 'Best available (automatic)' : 'No voice installed'}
              </option>
              {voice.availableVoices.map((item) => (
                <option key={item.voiceURI} value={item.voiceURI}>
                  {item.name} · {item.lang}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-btn"
              onClick={() => voice.previewVoice()}
              disabled={!voice.availableVoices.length}
              title="Hear the selected voice"
              aria-label="Preview the selected voice"
            >
              <Play size={13} />
            </button>
          </div>
        </label>

        <label className="field speed">
          <span><Gauge size={12} /> Speed · {voice.speed.toFixed(1)}×</span>
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

      {voice.availability && (
        <p className="voice-warning" role="status">
          <Info size={13} /> <span>{voice.availability}</span>
        </p>
      )}

      <p className="voice-foot">{voice.note}</p>

      <details className="diagnostics">
        <summary><Info size={12} /> Voice diagnostics</summary>
        <dl>
          <div><dt>Speech synthesis</dt><dd>{voice.supported ? 'Supported' : 'Not available'}</dd></div>
          <div><dt>Speech recognition</dt><dd>{voice.recognitionSupported ? 'Supported' : 'Not available'}</dd></div>
          <div><dt>Installed voices</dt><dd>{voice.counts.total} · {voice.counts.hindi} Hindi · {voice.counts.english} English</dd></div>
          <div><dt>Selected voice</dt><dd>{describeVoice(voice.selectedVoice)}</dd></div>
          <div><dt>Language</dt><dd>{languageLabel(voice.langPref)} → {locale.toUpperCase()}</dd></div>
          <div><dt>Playback</dt><dd>{voice.playback}</dd></div>
          <div><dt>Spoken answers</dt><dd>{voice.enabled ? 'On' : 'Off'}</dd></div>
          <div><dt>Hands-free</dt><dd>{voice.handsFree ? 'On' : 'Off'}</dd></div>
          <div><dt>Microphone</dt><dd>{voice.micPermission}</dd></div>
          <div><dt>Last error</dt><dd>{voice.error ?? 'None'}</dd></div>
        </dl>
        <div className="diagnostics-actions">
          <button type="button" className="link" onClick={voice.testVoice} disabled={!voice.supported}>
            <Play size={11} /> Test voice
          </button>
          <button type="button" className="link subtle" onClick={voice.refreshVoices}>
            <RefreshCw size={11} /> Refresh list
          </button>
        </div>
      </details>

      {voice.error && (
        <p className="voice-error" role="alert">
          <AlertTriangle size={13} />
          <span>{voice.error}</span>
          <button type="button" className="link" onClick={voice.dismissError}>Dismiss</button>
        </p>
      )}

      {!voice.supported && voice.ready && (
        <p className="voice-warning" role="status">
          <Info size={13} />
          <span>
            This browser has no speech synthesis. Answers are still written in full — try Chrome, Edge
            or Safari to hear them.
          </span>
        </p>
      )}

      {voice.supported && voice.counts.hindi === 0 && (
        <p className="voice-warning" role="status">
          <Check size={13} />
          <span>
            No Hindi voice is installed. English answers sound natural; Hindi ones fall back to the
            English voice.
          </span>
        </p>
      )}
    </section>
  );
}
