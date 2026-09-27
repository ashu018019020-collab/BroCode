import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Send, Sparkles, Lightbulb, Bug, SkipForward, Eraser, Loader2, Target, Wrench, BookOpenCheck, Percent } from 'lucide-react';
import { useCurriculum } from '../data/curriculum';
import { useStore } from '../offline/store';
import {
  askLocal, quickAccuracy, quickAnswer, quickDebug, quickExplain, quickFix, quickHint, quickMistakes,
  quickNext, quickScoreAnswer, quickStatus, type Answer, type AssistantContext,
} from '../engine/assistant';
import { toast } from './Toast';

interface Turn { role: 'you' | 'bot'; text: string; answer?: Answer }

const ASK_KEY = 'aiml:assistant:log';

function loadLog(): Turn[] {
  try {
    const raw = localStorage.getItem(ASK_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-12) : [];
  } catch { return []; }
}

/**
 * Offline learning assistant.
 *
 * Works with zero network: free-text questions are answered by retrieving the
 * bundled curriculum (see engine/assistant.ts), and the quick actions call the
 * real tutor / progress engines. Conversation persists in localStorage.
 *
 * `context` is what makes the instance under a notebook useful while coding: it tells the engine
 * which lesson this is and, when a cell just failed, the error to explain. Without it the card is
 * the same general tutor the Dashboard has always shown. `embedded` keeps the styling tight enough
 * to sit inside a notebook without shouting.
 */
export function AssistantCard({ compact = false, embedded = false, context }: { compact?: boolean; embedded?: boolean; context?: AssistantContext }) {
  const { sections } = useCurriculum();
  const state = useStore();
  const [log, setLog] = useState<Turn[]>(loadLog);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem(ASK_KEY, JSON.stringify(log.slice(-12))); } catch { /* quota */ }
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [log]);

  /**
   * How many hints this surface has already been asked for.
   *
   * The log *is* the memory: it is persisted in localStorage, so the ladder keeps escalating across
   * a reload without the engine having to write anything into progress state. Without this, asking
   * twice returned the identical three lines — the complaint that started this fix.
   */
  const askedHints = log.filter((t) => t.role === 'you' && /hint|clue|madad/i.test(t.text)).length;

  const reply = (a: Answer, label: string) => {
    if (!a.text) { toast('Kuch samajh nahi aaya — dobara try karo.', 'warning'); return; }
    setLog((l) => [...l, { role: 'you', text: label }, { role: 'bot', text: a.text, answer: a }]);
  };

  const ask = (text: string) => {
    const question = text.trim();
    if (!question) return;
    setBusy(true);
    // Retrieval is local and instant; the short delay only avoids a jarring flash.
    window.setTimeout(() => {
      try {
        reply(askLocal(question, sections, state, context, askedHints), question);
      } catch {
        reply({ text: 'Assistant me kuch gadbad hui — question chhota karke dobara try karo.', sources: [], confidence: 0, kind: 'fallback' }, question);
      } finally {
        setBusy(false);
        setQ('');
      }
    }, 160);
  };

  return (
    <div className={`assistant${embedded ? ' embedded' : ''}`}>
      <div className="head">
        <span className="bot"><Bot size={18} color="var(--cyan)" /></span>
        <div style={{ flex: 1 }}>
          <b className="small">AI Assistant (Offline)</b>
          <div className="small muted">{busy ? 'Curriculum me dhoond raha hoon…' : 'Offline mode — local learning assistant.'}</div>
        </div>
        {context?.error && <span className="chip hard">● error</span>}
        <span className={`chip ${busy ? '' : 'easy'}`}>{busy ? <Loader2 size={11} className="spin" /> : '●'} {busy ? 'Thinking' : 'Ready'}</span>
      </div>

      {(context?.where || context?.error || context?.question) && (
        <div className="assistant-ctx small muted">
          {context?.where && <span>📍 {context.where}</span>}
          {context?.question && (
            <span title={context.question.text}>📄 {context.question.text.length > 70 ? `${context.question.text.slice(0, 70)}…` : context.question.text}</span>
          )}
          {context?.error && (
            <span className="ctx-err">🔴 Is cell ka error upar screen par hai — "Is galti ko fix karo" dabao, main usi line par fix bataunga.</span>
          )}
        </div>
      )}

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {/* Armed, not pushy: the error pane already explains a failure on its own, so this action
            waits to be asked — but it is the first button whenever something is actually broken. */}
        {context?.error && (
          <button className="btn small primary" onClick={() => reply(quickFix(state, sections, context), 'Is galti ko fix karo')}>
            <Wrench size={12} /> Is galti ko fix karo
          </button>
        )}
        {/* With a question in context, the item's own actions lead: its answer, the percentage of
            what the learner wrote, and a hint about THIS item rather than the topic. */}
        {context?.question && (
          <>
            <button className="btn small primary" onClick={() => reply(quickAnswer(state, sections, context), 'Poora answer')}>
              <BookOpenCheck size={12} /> Poora answer
            </button>
            <button className="btn small" onClick={() => reply(quickScoreAnswer(state, sections, context), 'Mera answer kitna sahi?')}>
              <Percent size={12} /> Mera answer kitna sahi?
            </button>
          </>
        )}
        <button className="btn small" onClick={() => reply(quickExplain(state, sections), 'Explain')}><Sparkles size={12} /> Explain</button>
        <button className="btn small" onClick={() => reply(quickHint(state, sections, context, askedHints), 'Hint')}><Lightbulb size={12} /> Give Hint</button>
        <button className="btn small" onClick={() => reply(quickMistakes(state, sections), 'Meri galtiyan')}><Target size={12} /> Meri galtiyan</button>
        <button className="btn small" onClick={() => reply(quickDebug(state, sections), 'Debug')}><Bug size={12} /> Debug</button>
        <button className="btn small" onClick={() => reply(quickNext(state, sections), 'Next Task')}><SkipForward size={12} /> Next Task</button>
        {!compact && <button className="btn small" onClick={() => reply(quickAccuracy(state, sections), 'Meri accuracy')}><Percent size={12} /> Meri accuracy</button>}
        {!compact && <button className="btn small" onClick={() => reply(quickStatus(state, sections), 'Status')}>Meri progress</button>}
      </div>

      {(log.length > 0 || busy) && (
        <div
          ref={scroller}
          className="fadeup"
          style={{
            marginTop: 10,
            // A viewport-relative cap, not a fixed 170px one. The old height was short enough that
            // the pointer resting on the assistant scrolled THIS box first — which reads as "the
            // page won't scroll" — and left long answers in a keyhole you had to scroll twice to
            // read. It still scrolls internally, it just no longer feels like a trap.
            maxHeight: embedded ? 'min(45vh, 340px)' : compact ? 'min(50vh, 380px)' : 'min(55vh, 440px)',
            overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}
        >
          {log.map((t, i) => (
            <div
              key={i}
              className="bubble"
              style={{
                marginTop: 0,
                alignSelf: t.role === 'you' ? 'flex-end' : 'flex-start',
                maxWidth: '92%',
                background: t.role === 'you' ? 'rgba(34,211,238,.12)' : 'rgba(0,0,0,.28)',
                fontSize: '.78rem',
              }}
            >
              {t.text}
              {t.answer?.sources?.length ? (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {t.answer.sources.slice(0, 2).map((s, si) => (
                    <Link key={si} className="chip" to={s.route} style={{ textDecoration: 'none' }}>
                      {s.title.slice(0, 42)}{s.title.length > 42 ? '…' : ''} →
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {busy && <div className="bubble" style={{ alignSelf: 'flex-start', marginTop: 0, fontSize: '.78rem' }}>…</div>}
        </div>
      )}

      <div className="ask">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') ask(q); }}
          placeholder={context?.question ? 'Is question ke baare me poocho…' : 'Ask anything about Python…'}
          aria-label="Ask the offline assistant"
        />
        <button className="btn primary" onClick={() => ask(q)} disabled={busy || !q.trim()} aria-label="Send question">
          {busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
        </button>
        {log.length > 0 && (
          <button className="btn small ghost" onClick={() => { setLog([]); toast('Conversation clear ho gayi.', 'info', 1600); }} aria-label="Clear conversation">
            <Eraser size={13} />
          </button>
        )}
      </div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        Answers bundled curriculum se retrieve hote hain — internet ki zaroorat nahi, aur galat answer invent nahi karta.
      </p>
    </div>
  );
}
