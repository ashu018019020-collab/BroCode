import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  AudioLines, BookOpen, Code2, History, Mic2, Search, Sparkles, Trash2, Wand2,
} from 'lucide-react';
import { useCurriculum } from '../../../core/data/curriculum';
import { useStore } from '../../../core/storage/store';
import { assistantContextForPage } from '../../../core/ai/context';
import { spokenReply } from '../../../core/ai/voice';
import { accountStorageKey, subscribeStorageAccount } from '../../../core/storage/account';
import { MENTOR_LOG_KEY } from '../../../core/platform/keys';
import { useMentorAsk } from '../useMentorAsk';
import { CodingCoachPanel } from '../CodingCoachPanel';
import { MockInterviewPanel } from '../MockInterviewPanel';
import { useMentorVoice } from '../../../components/shared/useMentorVoice';
import { speechLanguage } from '../../../core/voice/mentor-voice';
import { toast } from '../../../components/ui/Toast';
import { ConversationPanel } from './ConversationPanel';
import { SmartToolsPanel } from './SmartToolsPanel';
import { VoiceControlCenter } from './VoiceControlCenter';
import './studio.css';

type StudioTab = 'mentor' | 'coach' | 'interview' | 'reports' | 'tools';

const TABS: { id: StudioTab; label: string; icon: typeof AudioLines }[] = [
  { id: 'mentor', label: 'Voice Mentor', icon: AudioLines },
  { id: 'coach', label: 'Coding Coach', icon: Code2 },
  { id: 'interview', label: 'Mock Interview', icon: Mic2 },
  { id: 'reports', label: 'Reports & Progress', icon: History },
  { id: 'tools', label: 'Smart Tools', icon: Wand2 },
];

const STARTERS = [
  'Explain Python decorators in simple words',
  'Why is a tuple immutable?',
  'Explain SQL joins with an example',
  'Explain RAG in simple words',
];

/**
 * The AI Mentor studio.
 *
 * One shared voice hook, one shared conversation engine, three columns:
 *   left   — the thread's own history and the topic it is about,
 *   centre — the conversation, with code, sources and message actions,
 *   right  — the device-voice control center and the Smart Tools.
 *
 * The other tabs mount the EXISTING engines (Coding Coach, Mock Interview, Reports) rather than
 * copies, so the redesign cannot drift from the features it presents. Selection lives in `?tab=`,
 * so a tab is bookmarkable and the back button behaves.
 */
export function MentorStudio() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: StudioTab = TABS.some((item) => item.id === requested) ? (requested as StudioTab) : 'mentor';
  const location = useLocation();
  const { sections } = useCurriculum();
  const state = useStore();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'voice' | 'text'>('voice');

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
  const voice = useMentorVoice(chat.busy);
  const [dictation, setDictation] = useState<{ text: string; id: number } | null>(null);

  // An engine failure is its own event, not a voice problem: say it once, out loud in the UI.
  useEffect(() => {
    if (chat.error) toast(chat.error, 'warning');
  }, [chat.error]);

  const lastLearner = useMemo(() => {
    for (let i = chat.turns.length - 1; i >= 0; i -= 1) {
      if (chat.turns[i]?.role === 'learner') return chat.turns[i].text;
    }
    return '';
  }, [chat.turns]);

  const section = useMemo(() => {
    const id = params.get('section');
    if (id) return sections.find((entry) => entry.id === id) ?? null;
    const topic = String(context.topic ?? '').trim().toLowerCase();
    if (!topic) return null;
    return sections.find((entry) => entry.title.toLowerCase() === topic) ?? null;
  }, [params, sections, context.topic]);

  const topic = String(context.topic ?? '').trim() || section?.title || lastLearner;
  const code = useMemo(() => {
    for (let i = chat.turns.length - 1; i >= 0; i -= 1) {
      const match = /```[a-zA-Z0-9+#-]*\n([\s\S]*?)```/.exec(chat.turns[i]?.text ?? '');
      if (match?.[1]) return match[1].trim();
    }
    return '';
  }, [chat.turns]);

  const visibleTurns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return chat.turns;
    return chat.turns.filter((turn) => turn.text.toLowerCase().includes(needle));
  }, [chat.turns, query]);

  /**
   * Speak an answer. `auto` respects the Auto speak switch; a manual press bypasses it (pressing
   * Replay while Auto speak is off is an explicit request), while Mute still silences everything.
   */
  const speakFinal = useCallback((replyText: string, sources: { title: string }[] = [], auto = true) => {
    if (voice.muted) return;
    if (auto && !voice.autoSpeak) return;
    const speech = spokenReply(replyText, sources);
    if (!speech) return;
    voice.speak(speech, () => {
      if (voice.handsFree && !voice.muted) voice.startListening(handleTranscriptRef.current);
    });
  }, [voice]);

  /** Speak the newest mentor turn — independent of whether Auto speak was ever on. */
  const speakLast = useCallback(() => {
    for (let i = chat.turns.length - 1; i >= 0; i -= 1) {
      const turn = chat.turns[i];
      if (turn?.role === 'mentor' && turn.text.trim()) {
        speakFinal(turn.text, turn.sources ?? [], false);
        return;
      }
    }
  }, [chat.turns, speakFinal]);

  const ask = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    // Unlock speech inside this click: the answer arrives later, after an await, and a browser that
    // never saw a gesture refuses it. Interrupt FIRST — `interrupt()` cancels the platform queue,
    // which used to cancel the silent unlocking utterance we had just spoken.
    voice.interrupt();
    voice.prime();
    const lang = speechLanguage(clean, voice.langPref);
    const result = await chat.ask(clean, lang === 'hi' ? 'hi-IN' : 'en-IN');
    if (!result) {
      toast('The mentor could not answer that. Try the concept name, or a shorter question.', 'warning');
      return;
    }
    speakFinal(result.reply.spoken, result.answer?.sources?.map((source) => ({ title: source.title })) ?? []);
  }, [chat, speakFinal, voice]);

  // Read the switch from a ref: the recogniser holds the callback from the render that opened the
  // mic, so a captured `voice.handsFree` could still say OFF for the first transcript after enabling
  // it — the loop then stayed silent. The ref always answers for the CURRENT switch.
  const handsFreeRef = useRef(voice.handsFree);
  handsFreeRef.current = voice.handsFree;
  const handleTranscript = useCallback((text: string) => {
    // Hands-free is the automatic loop. Everywhere else the transcript is a DRAFT in the composer, so
    // a misheard word is edited before it becomes a question instead of costing an answer.
    if (handsFreeRef.current) { void ask(text); return; }
    setDictation({ text, id: Date.now() });
  }, [ask]);
  const handleTranscriptRef = useRef(handleTranscript);
  handleTranscriptRef.current = handleTranscript;

  // Hands-free is not just a stored preference: switching it on opens the microphone now, and off
  // releases it. The mic is never opened while the mentor is speaking.
  const setHandsFree = useCallback((on: boolean) => {
    voice.setHandsFree(on);
    if (!on) { voice.stopListening(); return; }
    if (!voice.recognitionSupported || voice.listening) return;
    voice.prime();
    voice.startListening(handleTranscriptRef.current);
  }, [voice]);

  const toggleMic = useCallback(() => {
    if (!voice.recognitionSupported) {
      toast('Voice input needs Chrome or Edge — this browser cannot listen. You can still type.', 'warning');
      return;
    }
    if (voice.micPermission === 'denied') {
      toast('The microphone is blocked. Allow it for this site in the browser settings, then press Ask again.', 'warning');
    }
    voice.prime();
    voice.toggleListening(handleTranscriptRef.current);
  }, [voice]);

  const select = (next: StudioTab) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('tab', next);
    setParams(nextParams, { replace: false });
  };

  const sourcesCited = chat.turns.reduce((total, turn) => total + (turn.sources?.length ?? 0), 0);
  const asked = chat.turns.filter((turn) => turn.role === 'learner').length;

  return (
    <div className="mentor-studio">
      <nav className="studio-nav" aria-label="AI Mentor sections">
        <span className="studio-brand">
          <Sparkles size={15} /> AI Mentor
        </span>
        <div className="studio-tabs" role="tablist">
          {TABS.map((item) => {
            const Icon = item.icon;
            const on = item.id === tab;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={on}
                className={`studio-tab${on ? ' on' : ''}`}
                onClick={() => select(item.id)}
              >
                <Icon size={14} /> <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {tab === 'mentor' && (
        <div className="studio-layout">
          <aside className="studio-rail">
            <section className="rail-card glass">
              <span className="eyebrow">Session</span>
              <h2 className="rail-h">{asked} question{asked === 1 ? '' : 's'} asked</h2>
              <p>{sourcesCited} lesson reference{sourcesCited === 1 ? '' : 's'} cited · {chat.turns.length} turns</p>
              <label className="search">
                <Search size={12} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search this conversation"
                  aria-label="Search this conversation"
                />
              </label>
              {query && <p className="small muted">{visibleTurns.length} matching turns</p>}
              <button type="button" className="ghost-btn wide" onClick={chat.clear}>
                <Trash2 size={12} /> Clear conversation
              </button>
            </section>

            <section className="rail-card glass">
              <span className="eyebrow">Current topic</span>
              <h2 className="rail-h">{topic || 'No topic yet'}</h2>
              <p>
                {section
                  ? `Section ${section.no} · ${section.title}`
                  : 'Ask a question and the lesson it came from is named under the answer.'}
              </p>
              {section && (
                <Link className="ghost-btn wide" to={`/lesson/${section.id}`}>
                  <BookOpen size={12} /> Open lesson
                </Link>
              )}
            </section>

            <section className="rail-card glass quiet">
              <span className="eyebrow">Next step</span>
              <h2 className="rail-h">Practise what you just learned</h2>
              <p>The question bank is the same one Practice and Mock Interview use.</p>
              <Link className="ghost-btn wide" to="/practice">
                <Wand2 size={12} /> Open practice
              </Link>
            </section>
          </aside>

          <ConversationPanel
            turns={visibleTurns}
            busy={chat.busy}
            interim={voice.interim}
            listening={voice.listening}
            locale={voice.locale}
            mode={mode}
            onMode={(next) => {
              setMode(next);
              voice.setAutoSpeak(next === 'voice');
              if (next === 'voice') voice.prime();
            }}
            onSend={(text) => { void ask(text); }}
            onClear={() => { voice.interrupt(); chat.clear(); }}
            onReplay={(text) => speakFinal(text, [], false)}
            onMic={toggleMic}
            dictation={dictation}
            onDictationTaken={() => setDictation(null)}
            starters={STARTERS}
          />

          <aside className="studio-right">
            <VoiceControlCenter
              voice={voice}
              hasSpoken={chat.turns.some((turn) => turn.role === 'mentor' && turn.text.trim().length > 0)}
              onSpeakLast={speakLast}
              onMic={toggleMic}
              aiBusy={chat.busy}
              aiError={chat.error}
              onDismissAiError={chat.dismissError}
              onHandsFree={setHandsFree}
            />
            <SmartToolsPanel
              busy={chat.busy}
              context={{
                topic,
                sectionId: section?.id,
                lastLearner,
                code,
                lang: voice.locale,
              }}
              onAsk={(prompt) => { void ask(prompt); }}
              onRoute={(route) => { window.location.hash = `#${route}`; }}
            />
          </aside>
        </div>
      )}

      {tab === 'tools' && (
        <div className="studio-wide">
          <SmartToolsPanel
            busy={chat.busy}
            context={{ topic, sectionId: section?.id, lastLearner, code, lang: voice.locale }}
            onAsk={(prompt) => {
              select('mentor');
              void ask(prompt);
            }}
            onRoute={(route) => { window.location.hash = `#${route}`; }}
          />
          <section className="rail-card glass wide">
            <span className="eyebrow">How these tools answer</span>
            <p>
              Explain, deep explanation, example, summary, comparison and review call the same grounded
              engine the conversation uses: the answer is retrieved from your bundled lessons and names
              the lesson it came from. Practice, quiz, interview, projects and the learning plan open the
              feature that actually runs them, so a score you see is a score that was measured.
            </p>
          </section>
        </div>
      )}

      {tab === 'coach' && (
        <div className="studio-panel">
          <CodingCoachPanel />
        </div>
      )}
      {tab === 'interview' && (
        <div className="studio-panel">
          <MockInterviewPanel />
        </div>
      )}
      {tab === 'reports' && (
        <div className="studio-panel">
          <MockInterviewPanel initialPhase="history" />
        </div>
      )}

      <p className="studio-foot">
        Answers come from the bundled lessons and are retrieved in this browser. Speech recognition and
        the spoken voice are browser services: the voice is one already installed on this device, so
        nothing is downloaded and no audio leaves the page for us to generate.
      </p>
    </div>
  );
}
