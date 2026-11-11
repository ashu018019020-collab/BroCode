import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowUp, BookOpen, Check, Code2, Copy, Eraser, Loader2, Mic2, MicOff,
  RotateCcw, Send, Sparkles, Square, ThumbsDown, ThumbsUp, Type, Volume2, VolumeX,
} from 'lucide-react';
import { turnVoteKey, type MentorHistoryTurn } from '../../../core/ai/mentor';
import { toast } from '../../../components/ui/Toast';
import { MentorText } from '../MentorText';

/**
 * The conversation column.
 *
 * The answer is computed by the local grounded engine before this renders, so "streaming" here is a
 * progressive REVEAL of text that already exists — it is never presented as tokens arriving from a
 * model that is not there. Speaking starts on the final text, not on the reveal, so the voice never
 * reads half a sentence and then replays it.
 */
export interface ConversationPanelProps {
  turns: MentorHistoryTurn[];
  busy: boolean;
  interim: string;
  listening: boolean;
  locale: 'en' | 'hi';
  mode: 'voice' | 'text';
  onMode: (mode: 'voice' | 'text') => void;
  onSend: (text: string) => void;
  onClear: () => void;
  onReplay: (text: string) => void;
  onMic: () => void;
  /**
   * The speaker switch, rendered under the composer.
   *
   * It is ONE control for "read answers aloud", independent of the Voice/Text mode (which is about
   * how the learner ASKS). The state is the voice hook's persisted `enabled`, not component state, so
   * a reload keeps the choice and a silenced mentor really cannot be heard — `speak()` itself returns
   * early when it is off.
   */
  voiceOn: boolean;
  /** True while an answer is actually playing, so the bar can offer Stop. */
  speaking?: boolean;
  onVoiceToggle: () => void;
  onStopSpeaking?: () => void;
  starters: string[];
  /**
   * A finished dictation waiting for review. It lands in the composer — editable — instead of being
   * sent straight into the thread, so a misheard word never becomes a question.
   */
  dictation?: { text: string; id: number } | null;
  onDictationTaken?: () => void;
  /** The engine's own failure, shown IN the thread with a retry — never only as a toast. */
  error?: string | null;
  onRetry?: () => void;
  /** Persisted thumbs by `turnVoteKey`, so the saved state survives a reload. */
  votes?: Record<string, 'up' | 'down'>;
  onVote?: (turn: MentorHistoryTurn, value: 'up' | 'down') => void;
}

const REVEAL_CHARS_PER_TICK = 3;
const REVEAL_TICK_MS = 16;

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Progressively reveal the newest mentor answer. Older turns render whole. */
function useReveal(text: string, animate: boolean): string {
  const [count, setCount] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate || reducedMotion()) { setCount(text.length); return; }
    setCount(0);
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (cancelled) return;
      setCount((current) => {
        const next = current + REVEAL_CHARS_PER_TICK;
        if (next >= text.length) {
          window.clearInterval(timer);
          return text.length;
        }
        return next;
      });
    }, REVEAL_TICK_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [text, animate]);
  return text.slice(0, Math.min(count, text.length));
}

function codeFromTurns(turns: MentorHistoryTurn[]): string {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const match = /```[a-zA-Z0-9+#-]*\n([\s\S]*?)```/.exec(turns[i]?.text ?? '');
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text)
    .then(() => toast('Copied to the clipboard.', 'success'))
    .catch(() => toast('This browser blocked the clipboard.', 'warning'));
}

function Bubble({
  turn, newest, onReplay, vote, onVote,
}: {
  turn: MentorHistoryTurn;
  newest: boolean;
  onReplay: (text: string) => void;
  vote: 'up' | 'down' | null;
  onVote?: (turn: MentorHistoryTurn, value: 'up' | 'down') => void;
}) {
  const isMentor = turn.role === 'mentor';
  const revealed = useReveal(turn.text, isMentor && newest);
  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;
  const [showSources, setShowSources] = useState(false);
  const sources = isMentor ? (turn.sources ?? []) : [];

  return (
    <article className={`msg ${isMentor ? 'from-mentor' : 'from-learner'}`}>
      <div className="msg-body">
        {isMentor
          ? <MentorText text={revealed} />
          : <p className="learner-text">{turn.text}</p>}

        {isMentor && revealed.length < turn.text.length && (
          <span className="reveal-caret" aria-hidden="true" />
        )}

        {sources.length > 0 && (
          <div className="sources">
            <button type="button" className="sources-toggle" onClick={() => setShowSources((value) => !value)}>
              <BookOpen size={12} /> {sources.length} lesson{sources.length === 1 ? '' : 's'} cited
              <span aria-hidden="true">{showSources ? '−' : '+'}</span>
            </button>
            {showSources && (
              <div className="source-list">
                {sources.map((source, index) => (
                  <Link key={`${source.route}-${index}`} to={source.route} className="source">
                    <span>{source.title}</span>
                    <ArrowUp size={11} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="msg-actions">
        <button type="button" onClick={() => copyText(turn.text)} title="Copy this message">
          <Copy size={12} /> Copy
        </button>
        {isMentor && (
          <>
            <button type="button" onClick={() => onReplay(turn.text)} title="Read this answer aloud again">
              <Volume2 size={12} /> Replay
            </button>
            <button
              type="button"
              className={vote === 'up' ? 'on' : ''}
              aria-pressed={vote === 'up'}
              onClick={() => {
                if (!onVote) return;
                onVote(turn, 'up');
                // True now: the vote is written to this account's storage, not a component's state.
                toast('Feedback saved on this device.', 'success');
              }}
              title="This answer was useful"
            >
              <ThumbsUp size={12} />
            </button>
            <button
              type="button"
              className={vote === 'down' ? 'on' : ''}
              aria-pressed={vote === 'down'}
              onClick={() => {
                if (!onVote) return;
                onVote(turn, 'down');
                toast('Feedback saved on this device.', 'info');
              }}
              title="This answer was not useful"
            >
              <ThumbsDown size={12} />
            </button>
          </>
        )}
      </div>
    </article>
  );
}

export function ConversationPanel({
  turns, busy, interim, listening, locale, mode, onMode, onSend, onClear, onReplay, onMic, starters,
  voiceOn, speaking, onVoiceToggle, onStopSpeaking,
  dictation, onDictationTaken, error, onRetry, votes, onVote,
}: ConversationPanelProps) {
  const [draft, setDraft] = useState('');
  const [code, setCode] = useState('');
  const [codeOpen, setCodeOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastLearnerCode = useMemo(() => codeFromTurns(turns), [turns]);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [turns.length, busy, interim]);

  // A dictated question is a draft: the learner edits it and presses Enter, which is also the only
  // way a mis-transcribed word can be fixed before it costs an answer.
  useEffect(() => {
    if (!dictation?.text) return;
    setDraft(dictation.text);
    onDictationTaken?.();
    const field = input.current;
    if (field) {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }
  }, [dictation, onDictationTaken]);

  const send = () => {
    const text = draft.trim();
    const snippet = code.trim();
    if (!text && !snippet) return;
    const message = snippet ? `${text || 'Review this code.'}\n\n\`\`\`\n${snippet}\n\`\`\`` : text;
    setDraft('');
    setCode('');
    setCodeOpen(false);
    onSend(message);
  };

  return (
    <section className="chat-card glass" aria-label="Mentor conversation">
      <header className="chat-head">
        <div className="chat-title">
          <span className="avatar-chip"><Sparkles size={15} /></span>
          <div>
            <h2>AI Mentor</h2>
            <p>
              Grounded in your bundled curriculum · {turns.filter((turn) => turn.role === 'learner').length} question
              {turns.filter((turn) => turn.role === 'learner').length === 1 ? '' : 's'} this thread
            </p>
          </div>
        </div>
        <div className="chat-tools">
          <div className="segmented" role="group" aria-label="Conversation mode">
            <button type="button" className={mode === 'voice' ? 'on' : ''} onClick={() => onMode('voice')}>
              <Mic2 size={12} /> Voice
            </button>
            <button type="button" className={mode === 'text' ? 'on' : ''} onClick={() => onMode('text')}>
              <Type size={12} /> Text
            </button>
          </div>
          <button type="button" className="ghost-btn" onClick={onClear} title="Clear this conversation">
            <Eraser size={13} /> Clear
          </button>
        </div>
      </header>

      {/*
        * NOT `aria-live` on the whole log: the newest answer is revealed a few characters at a time,
        * so a live region here made a screen reader re-announce the answer on every tick. A separate
        * status line speaks the two things that actually matter — searching, and answered.
        */}
      <span className="sr-only" role="status" aria-live="polite">
        {busy ? 'Searching the bundled lessons…' : turns.length ? 'The mentor answered.' : ''}
      </span>
      <div className="chat-log" ref={scroller}>
        {!turns.length && !busy && (
          <div className="empty">
            <span className="empty-orb" aria-hidden="true"><Sparkles size={22} /></span>
            <h3>Ask me anything from your lessons</h3>
            <p>
              I answer from the bundled curriculum, name the lesson I used, and say when a topic has no
              example instead of inventing one.
            </p>
            <div className="starter-row">
              {starters.map((starter) => (
                <button key={starter} type="button" className="starter" onClick={() => onSend(starter)}>
                  {starter}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, index) => (
          <Bubble
            key={`${turn.role}-${index}-${turn.text.slice(0, 12)}`}
            turn={turn}
            newest={index === turns.length - 1}
            onReplay={onReplay}
            vote={votes?.[turnVoteKey(turn)] ?? null}
            onVote={onVote}
          />
        ))}

        {error && (
          <div className="chat-error" role="alert">
            <AlertTriangle size={13} />
            <span>{error}</span>
            {onRetry && (
              <button type="button" className="link" onClick={onRetry}>Try again</button>
            )}
          </div>
        )}

        {busy && (
          <div className="thinking" role="status">
            <span className="dots" aria-hidden="true"><i /><i /><i /></span>
            Searching the lessons…
          </div>
        )}
        {interim && <p className="interim">“{interim}”</p>}
      </div>

      <form
        className="composer"
        onSubmit={(event) => { event.preventDefault(); send(); }}
      >
        {codeOpen && (
          <div className="code-drawer">
            <div className="row spread">
              <span><Code2 size={12} /> Code to review</span>
              <button type="button" className="link" onClick={() => { setCodeOpen(false); setCode(''); }}>
                Remove
              </button>
            </div>
            <textarea
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Paste code here — Debug my code and Code review will use it."
              spellCheck={false}
              aria-label="Code to review"
            />
          </div>
        )}

        <div className="composer-row">
          <button
            type="button"
            className={`mic${listening ? ' on' : ''}`}
            onClick={onMic}
            aria-pressed={listening}
            aria-label={listening ? 'Stop listening' : 'Ask by voice'}
            title={listening ? 'Stop listening' : 'Ask by voice'}
          >
            {listening ? <MicOff size={16} /> : <Mic2 size={16} />}
          </button>
          <textarea
            ref={input}
            value={draft}
            rows={1}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={
              locale === 'hi'
                ? 'Python, SQL, ML ya RAG ke baare mein poocho…'
                : 'Ask about Python, SQL, ML, RAG or paste an error…'
            }
            aria-label="Ask the mentor"
          />
          <button
            type="button"
            className={`code-btn${codeOpen ? ' on' : ''}`}
            onClick={() => setCodeOpen((value) => !value)}
            title="Add a code block"
            aria-pressed={codeOpen}
          >
            <Code2 size={15} />
          </button>
          <button type="submit" className="send" disabled={busy || (!draft.trim() && !code.trim())} aria-label="Send">
            {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
          </button>
        </div>

        <div className="composer-foot">
          <span>
            {mode === 'voice' ? <><Mic2 size={11} /> Voice mode — ask by mic, or type.</> : <><Type size={11} /> Text mode — type your question.</>}
          </span>
          {lastLearnerCode && <span className="ok"><Check size={11} /> Code detected</span>}
          <span className="hint">Enter sends · Shift + Enter adds a line</span>
        </div>

        {/* The speaker switch. Its label states the effect in both directions, and Stop only appears
            while there is something to stop. */}
        <div className="voice-bar">
          <button
            type="button"
            className={`voice-toggle${voiceOn ? ' on' : ''}`}
            onClick={onVoiceToggle}
            aria-pressed={voiceOn}
            title={voiceOn ? 'Turn the spoken answers off' : 'Turn the spoken answers on'}
          >
            {voiceOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
            <span>{voiceOn ? 'Voice on — answers are read aloud' : 'Voice off — press to hear answers'}</span>
          </button>
          {voiceOn && speaking && onStopSpeaking && (
            <button type="button" className="voice-stop" onClick={onStopSpeaking} title="Stop reading this answer">
              <Square size={11} /> Stop
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
