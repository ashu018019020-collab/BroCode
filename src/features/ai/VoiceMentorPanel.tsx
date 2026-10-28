import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  AudioLines, Bot, Cloud, CloudOff, Eraser, Loader2, Mic2, MicOff, Pause, Play,
  RotateCcw, Send, Square, Volume2, VolumeX, WifiOff,
} from 'lucide-react';
import { useCurriculum } from '../../core/data/curriculum';
import { useStore } from '../../core/storage/store';
import { useI18n } from '../../app/i18n';
import { assistantContextForPage } from '../../core/ai/context';
import { mentorGreeting } from '../../core/ai/mentor';
import {
  MAX_RATE, MIN_RATE, VOICE_LANGS, normalizeVoicePref, resolveVoiceLang, spokenReply,
  mentorStateLabel, mentorUiState, micPermissionDenied, ttsEngineNote, voiceSupportNote,
  type VoiceLangId, type VoicePref,
} from '../../core/ai/voice';
import { accountStorageKey, subscribeStorageAccount } from '../../core/storage/account';
import { MENTOR_LOG_KEY } from '../../core/platform/keys';
import { useVoiceTutor } from '../../components/shared/useVoiceTutor';
import { AiVoiceRow } from '../../components/shared/AiVoiceRow';
import { useRealtimeVoice } from '../../components/shared/useRealtimeVoice';
import { toast } from '../../components/ui/Toast';
import { useMentorAsk } from './useMentorAsk';
import { MentorText } from './MentorText';

const STARTERS = [
  'Explain Python decorators in simple words',
  'Why is a tuple immutable?',
  'Explain SQL joins with an example',
  'Explain RAG in simple words',
];

/** Never translated: these are language names, like the selector's own note in the packs. */
const PREF_LABELS: Record<VoicePref, string> = {
  auto: 'Auto (detect)',
  'en-IN': 'English',
  'hi-IN': 'Hindi / Hinglish',
};

/**
 * The Voice Mentor tab.
 *
 * Two engines, one visible choice:
 *   · BROWSER (default, no key): speech recognition + the existing tutor voice, with the local
 *     retrieval engine answering. Chrome's recognition is a browser service, so the panel says so.
 *   · CLOUD REALTIME (optional): the server mints a short-lived secret and the browser talks to
 *     OpenAI's WebRTC endpoint directly. When the server has no key, this panel says so and the
 *     browser loop stays the path — never a dead button.
 *
 * The microphone is opened only by a press. Hands-free mode reopens it after an answer finishes,
 * and only when the speech really finished (`onEnd`), never after Stop or an interruption.
 */
export function VoiceMentorPanel() {
  const location = useLocation();
  const { t } = useI18n();
  const { sections } = useCurriculum();
  const state = useStore();
  const logKey = useSyncExternalStore(
    subscribeStorageAccount,
    () => accountStorageKey(MENTOR_LOG_KEY),
    () => MENTOR_LOG_KEY,
  );
  const context = useMemo(() => {
    const page = assistantContextForPage(location.pathname, location.search, sections, state);
    return { ...page, where: 'AI Mentor', route: '/ai-mentor' };
  }, [location.pathname, location.search, sections, state]);
  const chat = useMentorAsk(logKey, context);

  const voice = useVoiceTutor(chat.busy);
  const realtime = useRealtimeVoice();
  const [draft, setDraft] = useState('');
  const [muted, setMuted] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  /** `auto` means "decide per turn from what they typed", never "assume a language". */
  const [langPref, setLangPref] = useState<VoicePref>('auto');
  /** A session that has been stopped, so a later connect is reported as a reconnect, not a first try. */
  const [sessionEnded, setSessionEnded] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const handsFreeRef = useRef(handsFree);
  handsFreeRef.current = handsFree;
  const langPrefRef = useRef(langPref);
  langPrefRef.current = langPref;
  const live = realtime.status === 'connected';

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [chat.turns.length, realtime.turns.length, realtime.partial, chat.busy]);

  /** Answer through the local mentor, then speak it and (optionally) reopen the mic. */
  const runAsk = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    // Resolve the preference for THIS turn, so an English question answered in an otherwise Hindi
    // conversation still gets English retrieval and an English voice.
    const lang = resolveVoiceLang(langPrefRef.current, clean);
    voiceRef.current.setLang(lang);
    const result = await chat.ask(clean, lang);
    if (!result) {
      toast('The mentor could not answer that. Try the concept name, or type a shorter question.', 'warning');
      return;
    }
    // A platform answer carries no retrieved sources: it came from the loaded curriculum, so there
    // is nothing to cite and nothing to speak from `answer`.
    const sources = result.answer?.sources ?? [];
    if (!mutedRef.current) {
      const speech = spokenReply(result.reply.spoken, sources);
      voiceRef.current.speak(speech, sources, () => {
        if (handsFreeRef.current && !mutedRef.current) {
          voiceRef.current.startListening(handleTranscriptRef.current);
        }
      });
    }
  }, [chat]);

  const handleTranscript = useCallback((text: string) => {
    void runAsk(text);
  }, [runAsk]);
  const handleTranscriptRef = useRef(handleTranscript);
  handleTranscriptRef.current = handleTranscript;

  const submit = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setDraft('');
    if (live) {
      realtime.sendText(clean);
      return;
    }
    void runAsk(clean);
  };

  const clearConversation = () => {
    voice.stopListening();
    voice.stopSpeaking();
    chat.clear();
  };

  const connectRealtime = async () => {
    voice.stopListening();
    voice.stopSpeaking();
    setSessionEnded(false);
    const lang = resolveVoiceLang(langPref, voice.lang);
    voice.setLang(lang);
    const ok = await realtime.connect(lang);
    if (ok) toast('Cloud realtime is connecting. Speak after it says live.', 'info');
  };

  const endRealtime = () => {
    realtime.disconnect();
    setSessionEnded(true);
  };

  const activeTurns = live ? realtime.turns : chat.turns;
  const interim = voice.interim || realtime.partial;
  // ONE state for the whole surface, announced with aria-live below: the learner should never have
  // to infer "listening" from an animation that runs while nothing is listening.
  const uiState = mentorUiState({
    voice: voice.status,
    realtime: realtime.status,
    busy: chat.busy,
    muted,
    micDenied: micPermissionDenied(voice.error),
    ended: sessionEnded,
  });
  const status = mentorStateLabel(uiState, voice.lang);
  const supportNote = voiceSupportNote(voice.supported);
  const greeting = mentorGreeting('AI Mentor', voice.lang);

  return (
    <div className="mentor-grid">
      <section className="card mentor-chat" aria-label="Mentor conversation">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 className="row" style={{ gap: 8, margin: 0 }}>
              <Bot size={18} color="var(--cyan)" />
              {live ? 'Live voice mentor' : 'Voice mentor'}
            </h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              {live
                ? 'Connected to the realtime voice. Speak naturally — interrupt it any time.'
                : 'Grounded in the bundled curriculum. It teaches in four steps and says when a lesson has no example.'}
            </p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {live && <span className="chip easy">● Live</span>}
            <span className={`chip ${chat.busy ? '' : 'easy'}`}>
              {chat.busy ? <><Loader2 size={11} className="spin" /> Searching</> : 'Ready'}
            </span>
            <button type="button" className="btn small ghost" onClick={clearConversation} aria-label="Clear the mentor conversation">
              <Eraser size={13} /> Clear
            </button>
          </div>
        </div>

        <div className="mentor-log" ref={scroller} aria-live="polite">
          {!activeTurns.length && !chat.busy && (
            <div className="mentor-empty">
              <span className="mentor-empty-icon"><AudioLines size={26} color="var(--cyan)" /></span>
              <b>Ask by voice or type</b>
              <p className="small muted">
                {voice.lang === 'hi-IN'
                  ? greeting.text
                  : `I will explain the idea, why it works, an example from your lesson, and where to practise it.`}
              </p>
            </div>
          )}
          {activeTurns.map((turn, index) => (
            <div
              key={`${turn.role}-${index}`}
              className={`bubble assistant-bubble ${turn.role === 'learner' ? 'from-user' : 'from-assistant'}`}
              style={{ alignSelf: turn.role === 'learner' ? 'flex-end' : 'flex-start' }}
            >
              {live || turn.role === 'learner'
                ? <span style={{ whiteSpace: 'pre-wrap' }}>{turn.text}</span>
                : <MentorText text={turn.text} />}
              {'sources' in turn && turn.sources?.length ? (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {turn.sources.slice(0, 2).map((source, si) => (
                    <Link key={si} className="chip" to={source.route} style={{ textDecoration: 'none' }}>
                      {source.title.slice(0, 42)}{source.title.length > 42 ? '…' : ''} →
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {(chat.busy || realtime.status === 'connecting') && (
            <div className="bubble from-assistant small" style={{ alignSelf: 'flex-start' }}>
              <Loader2 size={12} className="spin" /> {realtime.status === 'connecting' ? 'Opening the realtime session…' : 'Looking through your lessons…'}
            </div>
          )}
          {interim && (
            <p className="voice-interim small" aria-live="polite">“{interim}”</p>
          )}
        </div>

        <form
          className="mentor-ask"
          onSubmit={(event) => { event.preventDefault(); submit(draft); }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={live ? 'Type to the realtime mentor…' : 'Ask about Python, SQL, ML, RAG or your code…'}
            aria-label="Ask the mentor"
          />
          {!live && (
            <button
              type="button"
              className={`icon-btn mentor-mic${voice.listening ? ' listening' : ''}`}
              onClick={() => voice.toggleListening(handleTranscript)}
              aria-pressed={voice.listening}
              aria-label={voice.listening ? 'Stop listening' : 'Ask by voice'}
              title={voice.listening ? 'Stop listening' : 'Ask by voice'}
            >
              {voice.listening ? <MicOff size={16} /> : <Mic2 size={16} />}
            </button>
          )}
          <button type="submit" className="assistant-send" disabled={!draft.trim() || chat.busy} aria-label="Send the question">
            <Send size={16} />
          </button>
        </form>

        <div className="row mentor-starters" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {STARTERS.map((starter) => (
            <button key={starter} type="button" className="btn small" onClick={() => submit(starter)}>
              {starter}
            </button>
          ))}
        </div>

        <p className="small muted" style={{ margin: '8px 0 0' }}>
          {live
            ? 'The realtime model is the conversational partner in this mode. Its session has a hard time limit and closes automatically.'
            : 'Answers come from the bundled lessons and are retrieved in your browser. Speech recognition is a browser service; Chrome may send audio to its vendor to transcribe it.'}
        </p>
      </section>

      <aside className="card mentor-voice" aria-label="Voice controls">
        <div className={`mentor-orb ${live ? 'live' : voice.status}`} aria-hidden="true">
          <span className="mentor-orb-core"><AudioLines size={30} /></span>
          <span className="mentor-wave">
            {[0, 1, 2, 3, 4, 5, 6].map((bar) => <b key={bar} style={{ animationDelay: `${bar * 90}ms` }} />)}
          </span>
        </div>
        <div className="mentor-voice-status" aria-live="polite">
          <b>{status}</b>
          <span className="small muted">
            {live
              ? `${realtime.model ?? 'realtime'} · ${realtime.voice ?? 'voice'}`
              : voice.engine === 'cloud'
                ? 'Google Neural2 voice'
                : voice.engine === 'browser'
                  ? 'Browser voice'
                  : 'Ready'}
          </span>
        </div>

        {!live && (
          <>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                type="button"
                className={`btn ${voice.listening ? 'primary' : ''}`}
                onClick={() => voice.toggleListening(handleTranscript)}
                aria-pressed={voice.listening}
              >
                {voice.listening ? <><Square size={13} /> Stop listening</> : <><Mic2 size={14} /> {voice.lang === 'hi-IN' ? 'Bolo' : 'Speak'}</>}
              </button>
              {(voice.speaking || voice.listening) && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => { voice.stopListening(); voice.stopSpeaking(); }}
                  aria-label="Interrupt the mentor"
                >
                  <Square size={13} /> Interrupt
                </button>
              )}
              <button
                type="button"
                className="btn"
                onClick={voice.paused ? voice.resumeSpeaking : voice.pauseSpeaking}
                disabled={!voice.speaking}
                aria-label={voice.paused ? 'Resume the spoken answer' : 'Pause the spoken answer'}
              >
                {voice.paused ? <><Play size={13} /> Resume</> : <><Pause size={13} /> Pause</>}
              </button>
              <button
                type="button"
                className="btn"
                onClick={voice.replay}
                disabled={!voice.lastSpoken || voice.speaking}
                aria-label="Replay the last spoken answer"
              >
                <RotateCcw size={13} /> Replay
              </button>
              <button
                type="button"
                className={`btn ${muted ? '' : 'primary'}`}
                onClick={() => setMuted((value) => !value)}
                aria-pressed={!muted}
                aria-label={muted ? 'Unmute spoken answers' : 'Mute spoken answers'}
              >
                {muted ? <><VolumeX size={13} /> Muted</> : <><Volume2 size={13} /> Voice on</>}
              </button>
            </div>

            <label className="mentor-check small">
              <input type="checkbox" checked={handsFree} onChange={(event) => setHandsFree(event.target.checked)} />
              <span>Hands-free: reopen the mic after each spoken answer</span>
            </label>

            <div className="mentor-settings">
              <label className="small muted" htmlFor="mentor-lang">Language</label>
              <select
                id="mentor-lang"
                value={langPref}
                onChange={(event) => {
                  const pref = normalizeVoicePref(event.target.value);
                  setLangPref(pref);
                  if (pref !== 'auto') voice.setLang(pref);
                }}
                title={langPref === 'auto' ? 'Each question decides English or Hindi from what you actually typed.' : undefined}
              >
                {(['auto', 'en-IN', 'hi-IN'] as VoicePref[]).map((id) => (
                  <option key={id} value={id}>{PREF_LABELS[id]}</option>
                ))}
              </select>
              <label className="small muted" htmlFor="mentor-rate">Speed</label>
              <div className="row" style={{ gap: 6 }}>
                <input
                  id="mentor-rate"
                  type="range"
                  min={MIN_RATE}
                  max={MAX_RATE}
                  step={0.1}
                  value={voice.rate}
                  onChange={(event) => voice.setRate(Number(event.target.value))}
                  aria-valuetext={`${voice.rate.toFixed(1)} times normal speed`}
                />
                <span className="small muted">{voice.rate.toFixed(1)}×</span>
              </div>
              <p className="small muted" style={{ margin: 0 }} aria-live="polite">
                {ttsEngineNote(voice.engine, voice.serverVoice, voice.aiVoice)}
              </p>
              <AiVoiceRow voice={voice} />
            </div>
          </>
        )}

        {live && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button type="button" className="btn" onClick={realtime.toggleMute} aria-pressed={realtime.muted}>
              {realtime.muted ? <><MicOff size={13} /> Mic muted</> : <><Mic2 size={13} /> Mute mic</>}
            </button>
            <button type="button" className="btn" onClick={realtime.interrupt} aria-label="Interrupt the realtime mentor">
              <Square size={13} /> Interrupt
            </button>
            <button type="button" className="btn" onClick={endRealtime}>
              <CloudOff size={13} /> Disconnect
            </button>
          </div>
        )}

        <div className="mentor-provider">
          <div className="row spread" style={{ gap: 8 }}>
            <b className="small row" style={{ gap: 6 }}>
              {realtime.configured === true ? <Cloud size={14} color="var(--cyan)" /> : <WifiOff size={14} color="var(--muted)" />}
              Cloud realtime voice
            </b>
            <span className={`chip ${realtime.configured === true ? 'easy' : ''}`}>
              {realtime.configured === null ? 'Checking…' : realtime.configured ? 'Configured' : 'Not configured'}
            </span>
          </div>
          <p className="small muted" style={{ margin: '6px 0' }}>
            {realtime.configured === true
              ? 'Optional low-latency conversation. Signed-in sessions only; the server issues a short-lived secret and applies a session limit.'
              : realtime.configured === false
                ? 'This server has no OpenAI realtime key. The browser voice above is fully functional and needs no key.'
                : 'Checking this server for the optional realtime voice…'}
          </p>
          {realtime.configured === true && !live && (
            <div className="mentor-consent">
              <label className="mentor-check small">
                <input
                  type="checkbox"
                  checked={realtime.consent}
                  onChange={(event) => realtime.setConsent(event.target.checked)}
                />
                <span>
                  <b>{t('ai.onlineVoice.title')}</b> — {t('ai.onlineVoice.consent')}
                </span>
              </label>
              <p className="small muted" style={{ margin: '4px 0 0' }}>{t('ai.onlineVoice.charges')}</p>
            </div>
          )}
          {realtime.configured === true && !live && (
            <button
              type="button"
              className="btn small primary"
              onClick={() => { void connectRealtime(); }}
              disabled={realtime.status === 'connecting' || !realtime.consent}
            >
              {realtime.status === 'connecting'
                ? <><Loader2 size={12} className="spin" /> Connecting…</>
                : !realtime.consent
                  ? <><Cloud size={13} /> {t('ai.onlineVoice.enable')}</>
                  : <><Cloud size={13} /> Connect realtime</>}
            </button>
          )}
          {live && (
            <p className="small muted" style={{ margin: 0 }}>
              Language is fixed for this session. Disconnect, switch language, then reconnect to change it.
            </p>
          )}
          {realtime.error && (
            <p className="voice-error small" role="status">
              <span>{realtime.error}</span>
              <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} onClick={realtime.dismissError} aria-label="Dismiss the realtime message">
                ×
              </button>
            </p>
          )}
        </div>

        {voice.error && (
          <p className="voice-error small" role="status">
            <span>{voice.error}</span>
            <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} onClick={voice.dismissError} aria-label="Dismiss the voice message">
              ×
            </button>
          </p>
        )}
        {supportNote && <p className="small muted voice-note">{supportNote}</p>}
        <p className="small muted voice-note" style={{ margin: 0 }}>
          No audio is recorded or stored. Only the transcript stays on this device.
        </p>
      </aside>
    </div>
  );
}
