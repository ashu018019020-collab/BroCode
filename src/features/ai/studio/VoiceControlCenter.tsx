import {
  AlertTriangle, AudioLines, Gauge, Info, Mic2, MicOff, Pause, Play, RefreshCw,
  RotateCcw, Square, Sparkles, Volume2, VolumeX,
} from 'lucide-react';
import {
  mentorVoiceHint, mentorVoiceLabel, type SpeechPreference,
} from '../../../core/voice/mentor-voice';
import { languageLabel, type MentorVoice } from '../../../components/shared/useMentorVoice';
import { AIVoiceOrb } from './AIVoiceOrb';

/**
 * The voice control center.
 *
 * The learner meets ONE voice — `BroCode Natural Voice` — and never a list of device names. Which
 * installed voices sit behind that profile is resolved on every load, so an uninstalled or
 * wrong-language pick cannot stick, and the technical names live only inside the collapsed
 * "Voice details" block (that block is also where the last platform error is readable).
 *
 * Every control maps to a verb on the shared adapter, and every disabled state is a fact: nothing has
 * been spoken yet, nothing is playing, no voice is installed.
 */
export interface VoiceControlCenterProps {
  voice: MentorVoice;
  onSpeakLast: () => void;
  onMic: () => void;
  hasSpoken: boolean;
  /** The answer engine's own state — a voice problem must never be shown as an AI problem. */
  aiBusy: boolean;
  aiError: string | null;
  onDismissAiError: () => void;
  /** Hands-free is not just a preference: enabling it opens the microphone. */
  onHandsFree: (on: boolean) => void;
}

const LANGUAGES: SpeechPreference[] = ['auto', 'en', 'hi'];

const PROFILE_STATUS: Record<MentorVoice['profile']['status'], string> = {
  ready: 'Ready',
  partial: 'Limited voices',
  unavailable: 'Voice unavailable',
};

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

export function VoiceControlCenter({
  voice, onSpeakLast, onMic, hasSpoken, aiBusy, aiError, onDismissAiError, onHandsFree,
}: VoiceControlCenterProps) {
  const { state, locale, profile } = voice;
  const status = mentorVoiceLabel(state, locale);
  const aiState = aiError ? 'bad' : aiBusy ? 'busy' : 'ok';
  const aiLabel = aiError ? 'Error' : aiBusy ? 'Thinking' : 'Ready';
  const profileReady = profile.status === 'ready';
  const handsFreeStatus = !voice.recognitionSupported
    ? 'Voice input unavailable here'
    : voice.micPermission === 'denied'
      ? 'Microphone blocked in this browser'
      : voice.listening
        ? 'Listening now'
        : 'Reopens the mic after each answer';

  return (
    <section className="voice-card glass" aria-label="Voice control center">
      {/* Two separate facts: the answer engine and the voice each report their own state. */}
      <div className={`ai-health ${aiState}`} role="status" aria-live="polite" title={aiError ?? 'Answers are built in this browser from the bundled lessons.'}>
        <span className="ai-health-dot" aria-hidden="true" />
        <span className="ai-health-text">
          <b>Answer engine</b>
          <em>{aiLabel}</em>
        </span>
      </div>

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

      {/* The single profile. No dropdown, no device voice names on the surface. */}
      <div className={`voice-profile ${profile.status}`}>
        <span className="voice-profile-mark" aria-hidden="true"><Sparkles size={16} /></span>
        <div className="voice-profile-text">
          <strong>{profile.name}</strong>
          <span>{profile.subtitle} · {profile.detail}</span>
        </div>
        <div className="voice-profile-side">
          <span className={`voice-profile-status ${profile.status}`}>{PROFILE_STATUS[profile.status]}</span>
          <button
            type="button"
            className="voice-profile-test"
            onClick={voice.testVoice}
            disabled={!voice.supported || profile.status === 'unavailable'}
            title="Hear this voice read a short sample"
          >
            <Play size={11} /> Test voice
          </button>
        </div>
      </div>

      {voice.serverNote && (
        <p className="voice-hint" role="status">
          <Sparkles size={12} /> {voice.serverNote}
        </p>
      )}

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
          onChange={onHandsFree}
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
          onClick={onSpeakLast}
          disabled={!voice.supported || !voice.enabled}
          title="Read the last answer aloud"
        >
          <AudioLines size={15} /> Speak
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
          className={`ctl mute${voice.enabled ? '' : ' on'}`}
          onClick={() => voice.setEnabled(!voice.enabled)}
          aria-pressed={!voice.enabled}
          title={voice.enabled ? 'Mute spoken answers' : 'Unmute spoken answers'}
        >
          {voice.enabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          {voice.enabled ? 'Mute' : 'Unmute'}
        </button>
      </div>

      <div className="voice-settings">
        <div className="field">
          <span id="voice-language-label">Language</span>
          <div className="segmented" role="radiogroup" aria-labelledby="voice-language-label">
            {LANGUAGES.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={voice.langPref === id}
                className={voice.langPref === id ? 'on' : ''}
                onClick={() => voice.setLangPref(id)}
              >
                {languageLabel(id)}
              </button>
            ))}
          </div>
        </div>

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

      {profile.message && (
        <p className="voice-warning" role="status">
          <Info size={13} /> <span>{profile.message}</span>
        </p>
      )}

      {aiError && (
        <p className="voice-error" role="alert">
          <AlertTriangle size={13} />
          <span>{aiError}</span>
          <button type="button" className="link" onClick={onDismissAiError}>Dismiss</button>
        </p>
      )}

      {!voice.enabled && (
        <p className="voice-warning" role="status">
          <VolumeX size={13} />
          <span>Spoken answers are muted, so no answer will be read aloud.</span>
          <button type="button" className="link" onClick={() => voice.setEnabled(true)}>Unmute</button>
        </p>
      )}

      {!profileReady && voice.supported && !profile.message && (
        <p className="voice-warning" role="status">
          <Info size={13} />
          <span>This device has a voice for one of the two languages. Hindi and English answers will not sound alike.</span>
        </p>
      )}

      {/* Technical names, counts and the raw platform error — collapsed, never in the way. */}
      <details className="diagnostics">
        <summary><Info size={12} /> Voice details</summary>
        <dl>
          <div><dt>Speech synthesis</dt><dd>{voice.supported ? 'Supported' : 'Not available'}</dd></div>
          <div><dt>Speech recognition</dt><dd>{voice.recognitionSupported ? 'Supported' : 'Not available'}</dd></div>
          <div>
            <dt>Installed voices</dt>
            <dd>{voice.diagnostics.voices} · {voice.diagnostics.hindi} Hindi · {voice.diagnostics.english} English</dd>
          </div>
          <div><dt>Hindi voice</dt><dd>{voice.diagnostics.selected.split(' / ')[0]}</dd></div>
          <div><dt>English voice</dt><dd>{voice.diagnostics.selected.split(' / ')[1]}</dd></div>
          <div>
            <dt>Profile</dt>
            <dd>{voice.diagnostics.shared ? 'One voice serves both languages' : 'Two voices behind one profile'}</dd>
          </div>
          <div>
            <dt>AI voice</dt>
            <dd>{voice.serverVoice === 'ready'
              ? `${voice.serverVoiceId ?? 'ready'} · generated on the server`
              : voice.serverVoice === 'checking' ? 'Checking…' : 'Device voice · this browser'}</dd>
          </div>
          <div><dt>Language</dt><dd>{languageLabel(voice.langPref)} → {locale.toUpperCase()}</dd></div>
          <div><dt>Playback</dt><dd>{voice.playback}</dd></div>
          <div><dt>Microphone</dt><dd>{voice.listening ? 'Listening' : 'Stopped'} · {voice.micPermission}</dd></div>
          <div><dt>Answer engine</dt><dd>{aiError ? 'Error' : aiBusy ? 'Thinking' : 'Ready'}</dd></div>
          <div><dt>Last error</dt><dd>{voice.error ?? 'None'}</dd></div>
        </dl>
        <div className="diagnostics-actions">
          <button type="button" className="link subtle" onClick={voice.refreshVoices}>
            <RefreshCw size={11} /> Refresh voices
          </button>
        </div>
      </details>

      {voice.micError && (
        <p className="voice-error" role="alert">
          <AlertTriangle size={13} />
          <span>{voice.micError}</span>
          <button type="button" className="link" onClick={voice.dismissMicError}>Dismiss</button>
        </p>
      )}

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
    </section>
  );
}
