import { useSearchParams } from 'react-router-dom';
import { AudioLines, Code2, History, Mic2, ShieldCheck, Sparkles } from 'lucide-react';
import { VoiceMentorPanel } from './VoiceMentorPanel';
import { CodingCoachPanel } from './CodingCoachPanel';
import { MockInterviewPanel } from './MockInterviewPanel';

type TabId = 'mentor' | 'coach' | 'interview' | 'reports';

const TABS: { id: TabId; label: string; icon: typeof AudioLines; hint: string }[] = [
  { id: 'mentor', label: 'Voice Mentor', icon: AudioLines, hint: 'Talk or type — answers grounded in your lessons' },
  { id: 'coach', label: 'Coding Coach', icon: Code2, hint: 'Run code, read the real error, preview a fix' },
  { id: 'interview', label: 'Mock Interview', icon: Mic2, hint: 'Spoken round with follow-ups and a report' },
  { id: 'reports', label: 'Reports', icon: History, hint: 'Past rounds, scorecards and revision plans' },
];

/**
 * The AI section, in one place.
 *
 * This page is a SHELL, not a second assistant: every tab renders the same engines the rest of
 * BroCode uses — the offline retrieval assistant, the bundled Python/JS runners, the curriculum
 * question banks and the per-account store. The tabs are ordinary links in the URL (`?tab=`), so a
 * report or a coach view can be bookmarked and the browser's back button behaves.
 *
 * The "offline" claim in the header is deliberate: the answers and scoring work with zero network.
 * Only the optional realtime voice upgrade needs a server key, and the Voice Mentor tab says so.
 */
export default function MentorHub() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: TabId = requested === 'coach' || requested === 'interview' || requested === 'reports' ? requested : 'mentor';
  const active = TABS.find((item) => item.id === tab) ?? TABS[0];

  const select = (next: TabId) => {
    const paramsNext = new URLSearchParams(params);
    paramsNext.set('tab', next);
    setParams(paramsNext, { replace: false });
  };

  return (
    <div className="mentor-hub">
      <div className="row spread" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="row" style={{ gap: 10, margin: 0 }}>
            <span className="mentor-hub-icon"><Sparkles size={20} /></span>
            AI MENTOR
          </h1>
          <p className="muted small" style={{ maxWidth: 760, margin: '6px 0 0' }}>
            A voice-first learning studio: explain a concept, debug your own code, or sit a spoken
            mock interview. Answers and scores are grounded in the bundled curriculum and real run
            evidence — the app never asks you to trust a number it did not measure.
          </p>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="chip easy"><ShieldCheck size={11} /> Offline answers</span>
          <span className="chip">Voice optional</span>
          <span className="chip">English + Hinglish</span>
        </div>
      </div>

      <div className="mentor-tabs" role="tablist" aria-label="AI Mentor sections">
        {TABS.map((item) => {
          const Icon = item.icon;
          const on = item.id === tab;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={on}
              className={`mentor-tab${on ? ' on' : ''}`}
              onClick={() => select(item.id)}
              title={item.hint}
            >
              <Icon size={15} />
              <span>{item.label}</span>
              {on && <small>{item.hint}</small>}
            </button>
          );
        })}
      </div>

      <section className="mentor-tabpanel" role="tabpanel" aria-label={`${active.label} panel`}>
        {tab === 'mentor' && <VoiceMentorPanel />}
        {tab === 'coach' && <CodingCoachPanel />}
        {tab === 'interview' && <MockInterviewPanel />}
        {tab === 'reports' && <MockInterviewPanel initialPhase="history" />}
      </section>
    </div>
  );
}
