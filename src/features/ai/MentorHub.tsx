import { ShieldCheck, Sparkles } from 'lucide-react';
import { MentorStudio } from './studio/MentorStudio';

/**
 * The AI section's entry point.
 *
 * This file used to own a second tab bar over the same engines the studio now hosts. It keeps only
 * what the surrounding page needs — the title and the honest promise — and hands the whole section to
 * `MentorStudio`, so there is exactly one place where the AI Mentor's layout, voice and tools live.
 */
export default function MentorHub() {
  return (
    <div className="mentor-hub">
      <div className="row spread" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="row" style={{ gap: 10, margin: 0 }}>
            <span className="mentor-hub-icon"><Sparkles size={20} /></span>
            AI MENTOR
          </h1>
          <p className="muted small" style={{ maxWidth: 760, margin: '6px 0 0' }}>
            A voice-first learning studio: explain a concept, review your own code, or sit a spoken mock
            interview. Answers are retrieved from the bundled curriculum, and the voice is generated in
            this browser.
          </p>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="chip easy"><ShieldCheck size={11} /> Grounded answers</span>
          <span className="chip">Supertonic 3 voice</span>
          <span className="chip">English + Hinglish</span>
        </div>
      </div>

      <MentorStudio />
    </div>
  );
}
