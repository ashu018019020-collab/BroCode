import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRight, BookOpen, BookOpenCheck, Bot, Bug, CircleHelp, Eraser, Lightbulb, Loader2, Mic2, Percent,
  Send, ShieldCheck, Sparkles, Target, Wrench,
} from 'lucide-react';
import { useCurriculum } from '../../core/data/curriculum';
import { useStore } from '../../core/storage/store';
import { loadKnowledgeIndex } from '../../core/data/knowledge';
import { assistantContextForPage } from '../../core/ai/context';
import type { KnowledgeIndex } from '../../core/ai/knowledge';
import {
  askLocal, quickAccuracy, quickAnswer, quickDebug, quickExplain, quickFix, quickHint, quickMistakes,
  quickNext, quickScoreAnswer, quickStatus, type Answer, type AssistantContext,
} from '../../core/ai/assistant';
import { toast } from '../ui/Toast';
import { accountStorageKey, subscribeStorageAccount } from '../../core/storage/account';
import { useVoiceTutor } from './useVoiceTutor';
import { VoiceBar } from './VoiceBar';
import { isVoicePreparing } from '../../core/voice/protocol';
import { startGuide } from './guideStore';
import { lessonScript, screenBriefing, spokenReply } from '../../core/ai/voice';

interface Turn { role: 'you' | 'bot'; text: string; answer?: Answer }

const ASK_KEY = 'aiml:assistant:log';

function loadLog(key: string): Turn[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-12) : [];
  } catch { return []; }
}

/**
 * Local learning assistant.
 *
 * Works with zero network: free-text questions are answered by retrieving the
 * bundled curriculum (see engine/assistant.ts) — or by `engine/project.ts` when the question is
 * about this app rather than about Python — and the quick actions call the
 * real tutor / progress engines. Conversation persists in localStorage.
 *
 * `context` is what makes the instance under a notebook useful while coding: it tells the engine
 * which lesson this is and, when a cell just failed, the error to explain. Without it the card is
 * the same general tutor the Dashboard has always shown. `embedded` keeps the styling tight enough
 * to sit inside a notebook without shouting.
 */
export function AssistantCard({
  compact = false, embedded = false, context, onClose,
}: {
  compact?: boolean;
  embedded?: boolean;
  context?: AssistantContext;
  /** Present only inside the dock: the panel's own close control, in its own header. */
  onClose?: () => void;
}) {
  const logKey = useSyncExternalStore(
    subscribeStorageAccount,
    () => accountStorageKey(ASK_KEY),
    () => ASK_KEY,
  );
  return (
    <AssistantCardSession
      key={logKey}
      logKey={logKey}
      compact={compact}
      embedded={embedded}
      context={context}
      onClose={onClose}
    />
  );
}

function AssistantCardSession({
  compact = false, embedded = false, context, logKey, onClose,
}: {
  compact?: boolean;
  embedded?: boolean;
  context?: AssistantContext;
  logKey: string;
  onClose?: () => void;
}) {
  const { sections } = useCurriculum();
  const state = useStore();
  const location = useLocation();
  const [knowledge, setKnowledge] = useState<KnowledgeIndex | null>(null);
  const [log, setLog] = useState<Turn[]>(() => loadLog(logKey));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  /**
   * The spoken layer. `busy` feeds it so one status line can say "Thinking…" instead of the mic
   * pretending to listen while the retrieval engine is still working.
   */
  const voice = useVoiceTutor(busy);
  const contextForIndex = (index?: KnowledgeIndex | null): AssistantContext => {
    const pageContext = assistantContextForPage(location.pathname, location.search, sections, state, index);
    return {
      ...pageContext,
      ...context,
      sectionId: context?.sectionId ?? context?.question?.sectionId ?? pageContext.sectionId,
      questionType: context?.questionType ?? context?.question?.type ?? pageContext.questionType,
      where: context?.where ?? pageContext.where,
      route: pageContext.route,
      pageTitle: pageContext.pageTitle,
      courseSlug: pageContext.courseSlug,
      courseTitle: pageContext.courseTitle,
      chapterTitle: pageContext.chapterTitle,
      lessonTitle: pageContext.lessonTitle,
      learningLevel: pageContext.learningLevel,
      learningGoal: pageContext.learningGoal,
      progressSummary: pageContext.progressSummary,
    };
  };
  const activeContext = useMemo(
    () => contextForIndex(knowledge),
    [location.pathname, location.search, sections, state, knowledge, context],
  );

  useEffect(() => {
    try { localStorage.setItem(logKey, JSON.stringify(log.slice(-12))); } catch { /* quota */ }
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [log, logKey]);

  /**
   * A learner who navigated away has stopped listening to that page. Silence the old narration and
   * close the mic — but never START anything here: this app deliberately does not auto-narrate on
   * navigation, and an effect that spoke would read every page as soon as it opened.
   */
  useEffect(() => {
    voice.stopSpeaking();
    voice.stopListening();
    // Deliberately keyed on the route only; the voice object is rebuilt every render.
  }, [location.pathname, location.search]);

  /**
   * How many hints this surface has already been asked for.
   *
   * The log *is* the memory: it is persisted in localStorage, so the ladder keeps escalating across
   * a reload without the engine having to write anything into progress state. Without this, asking
   * twice returned the identical three lines — the complaint that started this fix.
   */
  const askedHints = log.filter((t) => t.role === 'you' && /hint|clue|madad/i.test(t.text)).length;

  /**
   * Every answer leaves through here, so the speaking rules exist once: an answer is read aloud when
   * the learner asked by voice or switched "Voice on", and a text-only answer never speaks.
   */
  const reply = (a: Answer, label: string, opts: { speak?: boolean } = {}) => {
    if (!a.text) { toast('That did not come through — try again.', 'warning'); return; }
    setLog((l) => [...l, { role: 'you', text: label }, { role: 'bot', text: a.text, answer: a }]);
    if (opts.speak || voice.speakReplies) voice.speak(spokenReply(a.text, a.sources), a.sources);
  };

  /** "Explain this screen" — narrated from the same context the cards use, never from a guess. */
  const explainScreen = () => {
    const text = screenBriefing(activeContext, voice.lang);
    reply({ text, sources: [], confidence: 1, kind: 'state' }, 'Explain this screen', { speak: true });
  };

  /**
   * Guided navigation. The request lives in a module store so the highlight survives this card
   * unmounting; the assistant lends it its voice so the guide speaks in the chosen language and
   * speed instead of starting a second synthesiser.
   */
  const guideMe = () => {
    startGuide({ goal: 'start-course', lang: voice.lang, say: (text) => voice.speak(text) });
  };

  /** "Read lesson" — this section's authored concepts, tips and recap, in order. */
  const readLesson = () => {
    const section = activeContext.sectionId ? sections.find((item) => item.id === activeContext.sectionId) : undefined;
    const text = lessonScript(section ?? null, voice.lang);
    reply(
      {
        text,
        sources: section ? [{ title: `${section.title} · lesson`, route: `/lesson/${section.id}/learn` }] : [],
        confidence: 1,
        kind: 'state',
      },
      'Read lesson',
      { speak: true },
    );
  };

  const ask = async (text: string, spoken = false) => {
    const question = text.trim();
    if (!question || busy) return;
    // The learner's new question outranks the old answer: stop it now, not when the new audio is
    // finally ready, or two answers talk over each other for the length of the retrieval.
    voice.stopSpeaking();
    // Pay the one-time model load WHILE retrieval runs instead of after the answer appears — but
    // only for an answer that will actually be spoken, never behind a learner who silenced the voice.
    if (spoken || voice.speakReplies) voice.preloadVoice();
    setBusy(true);
    try {
      let index = knowledge;
      if (!index) {
        try {
          index = await loadKnowledgeIndex();
          setKnowledge(index);
        } catch (error) {
          console.error('BroCode AI knowledge index could not be loaded:', error);
          toast('Knowledge pack failed to load — answering from the bundled lessons.', 'warning');
          reply(askLocal(question, sections, state, contextForIndex(), askedHints), question, { speak: spoken });
          return;
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 160));
      reply(askLocal(question, sections, state, contextForIndex(index), askedHints, index), question, { speak: spoken });
    } finally {
      setBusy(false);
      setQ('');
    }
  };

  /**
   * The one line the panel leads with. Every value is a REAL state: a retrieval in flight, the
   * synthesiser talking, the microphone open, or an error the voice engine reported — never a
   * decorative animation, and never "Listening" while nothing is listening.
   */
  const heroState = busy
    ? { tone: 'thinking', title: 'THINKING', sub: 'Searching your curriculum…' }
    : voice.speaking
      ? { tone: 'speaking', title: 'SPEAKING', sub: 'Answering aloud — interrupt any time' }
      : voice.listening
        ? { tone: 'listening', title: 'LISTENING', sub: 'Go ahead, I am listening' }
        : voice.error
          ? { tone: 'error', title: 'VOICE ISSUE', sub: 'The answer still works by typing' }
          : { tone: 'idle', title: 'READY TO HELP', sub: 'Ask, speak or share your screen' };
  const heroActive = heroState.tone === 'thinking' || heroState.tone === 'speaking' || heroState.tone === 'listening';

  // The lesson header, from the page context this card was given — never a guessed title.
  const contextTitle =
    activeContext.lessonTitle
    || activeContext.chapterTitle
    || activeContext.pageTitle
    || (activeContext.where ? activeContext.where.split(' · ').slice(-1)[0] : '');
  // The progress bar reads the measured figure out of the summary string; no summary means no bar.
  const masteryMatch = /(\d{1,3})\s*%\s*mastery/i.exec(activeContext.progressSummary ?? '');
  const masteryPct = masteryMatch ? Math.min(100, Math.max(0, Number(masteryMatch[1]))) : null;

  return (
    <div className={`assistant${embedded ? ' embedded' : ''}`}>
      <div className="head">
        <span className="bot"><Bot size={19} color="var(--cyan)" /></span>
        <div style={{ flex: 1 }}>
          <b className="assistant-title"><span>BroCode</span> AI</b>
          <div className="assistant-subtitle">Your personal coding mentor</div>
        </div>
        {activeContext.error && <span className="chip hard">● error</span>}
        {onClose && (
          <button type="button" className="assistant-close" onClick={onClose} aria-label="Close the AI panel">
            ✕
          </button>
        )}
      </div>

      <div className={`ai-hero ${heroState.tone}${heroActive ? ' is-active' : ''}`}>
        <div className="ai-hero-left">
          <span className="ai-hero-dot" aria-hidden="true" />
          <div className="ai-hero-copy">
            <b className="ai-hero-title" aria-live="polite">{heroState.title}</b>
            <span className="ai-hero-sub">{heroState.sub}</span>
          </div>
        </div>
        <div className="ai-hero-right">
          <span className="ai-wave" aria-hidden="true">{[0, 1, 2, 3, 4, 5, 6, 7].map((bar) => <b key={bar} />)}</span>
          {/* A STATE pill, not a second microphone: the Speak chip below is the control, so the
              panel never shows two buttons that do the same thing. */}
          <span className={`ai-hero-pill${voice.listening ? ' on' : ''}`} role="status">
            <Mic2 size={15} />
            <span>{
              voice.listening ? 'Listening…'
                : voice.speaking ? 'Speaking…'
                  // Auto-speak starts the one-time model download on the first answer: "Thinking…"
                  // for four minutes is the stuck-looking wait this surface must never show.
                  : isVoicePreparing(voice.voiceStatus) ? 'Loading voice…'
                    : busy ? 'Thinking…' : 'Mic ready'
            }</span>
          </span>
        </div>
      </div>

      <VoiceBar
        voice={voice}
        onAsk={(text) => { void ask(text, true); }}
        onExplainScreen={explainScreen}
        onReadLesson={readLesson}
        onGuide={guideMe}
      />

      <div className="ai-context">
        <span className="ai-context-icon" aria-hidden="true"><BookOpen size={19} /></span>
        <div className="ai-context-body">
          <span className="ai-context-label">CURRENT LEARNING CONTEXT</span>
          <b className="ai-context-title">{contextTitle || 'No lesson open yet'}</b>
          {masteryPct !== null && (
            <span className="ai-context-progress">
              <span className="ai-context-bar" role="img" aria-label={`${masteryPct}% mastery`}>
                <i style={{ width: `${masteryPct}%` }} />
              </span>
              <em>{masteryPct}%</em>
            </span>
          )}
          <span className="ai-context-stats">
            {activeContext.progressSummary
              ?? 'Progress and mistakes appear here once a lesson is open.'}
          </span>
          {activeContext.question && (
            <span className="ai-context-q" title={activeContext.question.text}>
              📄 {activeContext.question.text.length > 74 ? `${activeContext.question.text.slice(0, 74)}…` : activeContext.question.text}
            </span>
          )}
          {activeContext.error && (
            <span className="ai-context-err">
              🔴 This cell's error is on screen above — press "Fix this mistake" and I will point at the exact line to fix.
            </span>
          )}
        </div>
      </div>

      <div className="assistant-actions">
        <button className="assistant-action explain" onClick={() => reply(quickExplain(state, sections, activeContext), 'Explain')}>
          <span className="assistant-action-icon"><Sparkles size={18} /></span>
          <b>Explain</b><small>Simple concepts, clear examples</small>
          <span className="assistant-action-go" aria-hidden="true"><ArrowRight size={14} /></span>
        </button>
        <button className="assistant-action hint" onClick={() => reply(quickHint(state, sections, activeContext, askedHints), 'Hint')}>
          <span className="assistant-action-icon"><Lightbulb size={18} /></span>
          <b>Give Hint</b><small>One useful clue at a time</small>
          <span className="assistant-action-go" aria-hidden="true"><ArrowRight size={14} /></span>
        </button>
        <button className="assistant-action doubt" onClick={() => ask('I have a doubt about this topic. Please explain the concept and resolve my doubt.')}>
          <span className="assistant-action-icon"><CircleHelp size={18} /></span>
          <b>Solve Doubt</b><small>Ask anything</small>
          <span className="assistant-action-go" aria-hidden="true"><ArrowRight size={14} /></span>
        </button>
        <button className="assistant-action next" onClick={() => reply(quickNext(state, sections, activeContext, '', knowledge ?? undefined), 'Next Topic')}>
          <span className="assistant-action-icon"><ArrowRight size={18} /></span>
          <b>Next Topic</b><small>Your next learning step</small>
          <span className="assistant-action-go" aria-hidden="true"><ArrowRight size={14} /></span>
        </button>
      </div>

      {(activeContext.error || activeContext.question) && (
        <div className="ai-chips">
          {/* Armed, not pushy: the error pane already explains a failure on its own, so this action
              waits to be asked — but it is the first button whenever something is actually broken. */}
          {activeContext.error && (
            <button className="btn small primary" onClick={() => reply(quickFix(state, sections, activeContext), 'Fix this mistake')}>
              <Wrench size={12} /> Fix this mistake
            </button>
          )}
          {/* With a question in context, the item's own actions lead: its answer, the percentage of
              what the learner wrote, and a hint about THIS item rather than the topic. */}
          {activeContext.question && (
            <>
              <button className="btn small primary" onClick={() => reply(quickAnswer(state, sections, activeContext), 'Full answer')}>
                <BookOpenCheck size={12} /> Full answer
              </button>
              <button className="btn small" onClick={() => reply(quickScoreAnswer(state, sections, activeContext), 'How accurate is my answer?')}>
                <Percent size={12} /> How accurate is my answer?
              </button>
            </>
          )}
        </div>
      )}

      <div className="ai-pills">
        <button className="ai-pill" onClick={() => reply(quickMistakes(state, sections), 'My mistakes')}>
          <span className="ai-pill-icon" aria-hidden="true"><Target size={16} /></span>
          <b>My mistakes</b>
          <ArrowRight size={15} className="ai-pill-go" aria-hidden="true" />
        </button>
        <button className="ai-pill" onClick={() => reply(quickDebug(state, sections), 'Debug')}>
          <span className="ai-pill-icon" aria-hidden="true"><Bug size={16} /></span>
          <b>Debug code</b>
          <ArrowRight size={15} className="ai-pill-go" aria-hidden="true" />
        </button>
      </div>

      {!compact && (
        <div className="ai-chips">
          <button className="btn small" onClick={() => reply(quickAccuracy(state, sections), 'My accuracy')}><Percent size={12} /> My accuracy</button>
          <button className="btn small" onClick={() => reply(quickStatus(state, sections), 'Status')}>My progress</button>
        </div>
      )}

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
              className={`bubble assistant-bubble ${t.role === 'you' ? 'from-user' : 'from-assistant'}`}
              style={{
                alignSelf: t.role === 'you' ? 'flex-end' : 'flex-start',
              }}
            >
              {t.text}
              {t.answer?.sources?.length ? (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {t.answer.sources.slice(0, 2).map((s, si) => (
                    <Link key={si} className="chip" to={s.route} title={s.reference ?? s.title} style={{ textDecoration: 'none' }}>
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
        <div className="assistant-input">
          <Sparkles className="assistant-input-sparkle" size={18} aria-hidden="true" />
          <span className="assistant-input-div" aria-hidden="true" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ask(q); }}
            placeholder={activeContext.question ? 'Ask about this question…' : 'Ask BroCode AI anything…'}
            aria-label="Ask the AI assistant"
          />
          {/* The composer's own mic is the same switch as the Speak chip — one state, two doors. */}
          <button
            type="button"
            className={`assistant-mic${voice.listening ? ' on' : ''}`}
            onClick={() => voice.toggleListening((text) => { void ask(text, true); })}
            aria-pressed={voice.listening}
            aria-label={voice.listening ? 'Stop listening to the microphone' : 'Speak your question'}
          >
            <Mic2 size={16} />
          </button>
          <button className="assistant-send" onClick={() => ask(q)} disabled={busy || !q.trim()} aria-label="Send question">
            {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
          </button>
        </div>
        {log.length > 0 && (
          <button className="assistant-clear btn small ghost" onClick={() => { setLog([]); toast('Conversation cleared.', 'info', 1600); }} aria-label="Clear conversation">
            <Eraser size={13} />
          </button>
        )}
      </div>
      <p className="ai-foot small muted">
        <ShieldCheck size={13} aria-hidden="true" />
        <span>Answers grounded in your curriculum · No invented solutions</span>
      </p>
    </div>
  );
}
