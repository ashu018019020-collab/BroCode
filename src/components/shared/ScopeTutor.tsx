import { useRef, useState } from 'react';
import { Bot, Sparkles } from 'lucide-react';
import { useI18n } from '../../app/i18n';
import type { AssistantContext } from '../../core/ai/assistant';
import { AssistantCard } from './AssistantCard';

/**
 * THE TUTOR, SCOPED TO WHAT IS ON SCREEN.
 *
 * One component for both surfaces that needed it — a roadmap step and a Project Lab build. It does
 * not add a second chat: it renders the SAME `AssistantCard` the Dashboard, notebooks and question
 * bank use, with the page's authored context and a handful of starter questions. A prompt is not
 * answered by a new engine either — it is handed to the card as a seed, so it travels the exact
 * path a typed question takes (retrieval → answer → sources).
 *
 * The briefing above the prompts is deliberate: it prints what the tutor is being told, so a learner
 * can see the answers are grounded in this page's own material rather than in a guess.
 */
export function ScopeTutor({
  kind, context, prompts, briefing,
}: {
  kind: 'step' | 'build';
  context: AssistantContext;
  prompts: string[];
  briefing: string;
}) {
  const { t } = useI18n();
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(null);
  /** A monotonic nonce, so clicking the same prompt twice asks it twice. */
  const nonce = useRef(0);

  return (
    <div className="card scope-tutor">
      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <span className="chip"><Bot size={12} /> {t('tutor.scope.chip')}</span>
          <h2 style={{ margin: '6px 0 2px' }}>
            {t(kind === 'build' ? 'tutor.scope.buildTitle' : 'tutor.scope.title')}
          </h2>
          <p className="small muted" style={{ margin: 0 }}>{t('tutor.scope.sub')}</p>
        </div>
      </div>

      <p className="small scope-brief">{briefing}</p>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="btn small"
            title={prompt}
            onClick={() => {
              nonce.current += 1;
              setSeed({ text: prompt, nonce: nonce.current });
            }}
          >
            <Sparkles size={11} />
            {prompt.length > 58 ? `${prompt.slice(0, 57).trimEnd()}…` : prompt}
          </button>
        ))}
      </div>

      <AssistantCard embedded compact context={context} seed={seed ?? undefined} />
    </div>
  );
}
