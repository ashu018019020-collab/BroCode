import { BookOpen, Mic2, MicOff, Pause, Play, RotateCcw, Volume2, VolumeX, X } from 'lucide-react';
import {
  MAX_RATE, MIN_RATE, VOICE_LANGS, ttsEngineNote, voiceStatusLabel, voiceSupportNote, type VoiceLangId,
} from '../../core/ai/voice';
import type { VoiceTutor } from './useVoiceTutor';
import { AiVoiceRow } from './AiVoiceRow';

/**
 * The voice agent's controls — one row, inside the assistant.
 *
 * Three states are visible at all times, because a microphone that is open without saying so is the
 * one thing a tutor must never do: the mic button says "Listening…" while it is listening, the status
 * line says "Speaking…" while the answer is read, and "Stop" is always reachable while it talks.
 *
 * `onExplainScreen` and `onReadLesson` are the two spoken teaching actions. They are separate from
 * the text "Explain" card because their jobs are different: Explain answers about the concept,
 * Explain screen narrates what is in front of the learner (real route, progress, open question,
 * current error), and Read lesson reads that lesson's authored content in order.
 */
export function VoiceBar({
  voice, onAsk, onExplainScreen, onReadLesson, onGuide,
}: {
  voice: VoiceTutor;
  /** Called with the final transcript — the caller decides what to do with it. */
  onAsk: (text: string) => void;
  onExplainScreen: () => void;
  onReadLesson: () => void;
  /** Starts guided navigation: a ring on the real next control, named by its own label. */
  onGuide: () => void;
}) {
  const note = voiceSupportNote(voice.supported);
  const status = voiceStatusLabel(voice.status, voice.lang);

  return (
    <div className="voice">
      <div className="voice-bar" role="group" aria-label="Voice tutor controls">
        <button
          type="button"
          className={`voice-chip mic${voice.listening ? ' on' : ''}`}
          onClick={() => voice.toggleListening(onAsk)}
          aria-pressed={voice.listening}
          aria-label={voice.listening ? 'Stop listening to the microphone' : 'Ask the AI by voice'}
          title={voice.listening ? 'Stop listening' : 'Speak your question'}
        >
          {voice.listening ? <MicOff size={14} /> : <Mic2 size={14} />}
          <span>{voice.listening ? (voice.lang === 'hi-IN' ? 'Sun raha hoon' : 'Listening') : (voice.lang === 'hi-IN' ? 'Bolo' : 'Speak')}</span>
        </button>

        <button
          type="button"
          className={`voice-chip${voice.speakReplies ? ' on' : ''}`}
          onClick={() => voice.setSpeakReplies(!voice.speakReplies)}
          aria-pressed={voice.speakReplies}
          aria-label="Read every assistant answer aloud"
          title={voice.speakReplies ? 'Answers are read aloud — click to mute' : 'Read every answer aloud'}
        >
          {voice.speakReplies ? <Volume2 size={14} /> : <VolumeX size={14} />}
          <span>{voice.speakReplies ? 'Voice on' : 'Voice off'}</span>
        </button>

        {voice.speaking && (
          <button
            type="button"
            className="voice-chip stop"
            onClick={voice.paused ? voice.resumeSpeaking : voice.pauseSpeaking}
            aria-label={voice.paused ? 'Resume speaking' : 'Pause speaking'}
          >
            {voice.paused ? <Play size={13} /> : <Pause size={13} />}
            <span>{voice.paused ? 'Resume' : 'Pause'}</span>
          </button>
        )}
        {(voice.speaking || voice.listening) && (
          <button
            type="button"
            className="voice-chip stop"
            onClick={() => { voice.stopListening(); voice.stopSpeaking(); }}
            aria-label="Stop the voice tutor"
          >
            <X size={13} />
            <span>Stop</span>
          </button>
        )}
        {!voice.speaking && !voice.listening && voice.lastSpoken && (
          <button
            type="button"
            className="voice-chip"
            onClick={voice.replay}
            aria-label="Replay the last spoken answer"
            title="Replay the last answer"
          >
            <RotateCcw size={13} />
            <span>Replay</span>
          </button>
        )}

        {/* Only while something is happening: next to the "Voice off" toggle, an idle "Voice off"
            status said the same thing twice and read as two controls. */}
        {voice.status !== 'off' && (
          <span className={`voice-state ${voice.status}`} aria-live="polite">
            <i aria-hidden="true" />
            {status}
            {(voice.speaking || voice.listening) && (
              <span className="voice-wave" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((bar) => <b key={bar} />)}
              </span>
            )}
          </span>
        )}
      </div>

      <div className="voice-bar teaching">
        <button type="button" className="voice-chip" onClick={onExplainScreen} aria-label="Explain the page I am on">
          <span aria-hidden="true">📍</span>
          <span>Explain this screen</span>
        </button>
        <button type="button" className="voice-chip" onClick={onReadLesson} aria-label="Read this lesson aloud">
          <BookOpen size={14} />
          <span>Read lesson</span>
        </button>
        <button type="button" className="voice-chip" onClick={onGuide} aria-label="Guide me to the next step">
          <Play size={13} />
          <span>Guide me</span>
        </button>

        <details className="voice-more">
          <summary className="small muted">Voice settings</summary>
          <div className="voice-more-body">
            <label className="small muted" htmlFor="voice-lang">Language</label>
            <select
              id="voice-lang"
              value={voice.lang}
              onChange={(event) => voice.setLang(event.target.value as VoiceLangId)}
            >
              {VOICE_LANGS.map((lang) => <option key={lang.id} value={lang.id}>{lang.label}</option>)}
            </select>
            <label className="small muted" htmlFor="voice-rate">Speed</label>
            <input
              id="voice-rate"
              type="range"
              min={MIN_RATE}
              max={MAX_RATE}
              step={0.1}
              value={voice.rate}
              onChange={(event) => voice.setRate(Number(event.target.value))}
              aria-valuetext={`${voice.rate.toFixed(1)} times normal speed`}
            />
            <span className="small muted">{voice.rate.toFixed(1)}×</span>
            {/* Which engine is ACTUALLY speaking — never a promise the deployment cannot keep. */}
            <span className="small muted" style={{ marginTop: 6 }} aria-live="polite">
              {ttsEngineNote(voice.engine, voice.cloudConfigured, {
                state: voice.aiVoice.state,
                percent: voice.aiVoice.percent,
                error: voice.aiVoice.error,
                downloaded: voice.aiCached,
              })}
            </span>
            <AiVoiceRow voice={voice} />
          </div>
        </details>
      </div>

      {voice.interim && <p className="voice-interim small" aria-live="polite">“{voice.interim}”</p>}

      {voice.error && (
        <p className="voice-error small" role="status">
          <span>{voice.error}</span>
          <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} onClick={voice.dismissError} aria-label="Dismiss the voice message">
            <X size={12} />
          </button>
        </p>
      )}

      {note && <p className="small muted voice-note">{note}</p>}
    </div>
  );
}
