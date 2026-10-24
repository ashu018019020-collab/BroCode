import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';

const LOADING_STATES = [
  'Preparing BroCode...',
  'Loading Curriculum...',
  'Organizing Your Skills...',
  'Preparing Challenges...',
  'Almost Ready...',
  "Let's Code! 🚀",
];

interface Props {
  ready?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onComplete?: () => void;
}

export function CurriculumLoader({ ready = false, error, onRetry, onComplete }: Props) {
  const [stateIndex, setStateIndex] = useState(0);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (error) return;
    if (ready) {
      setStateIndex(LOADING_STATES.length - 1);
      const timer = window.setTimeout(() => {
        setExiting(true);
        window.setTimeout(() => onComplete?.(), 520);
      }, 480);
      return () => window.clearTimeout(timer);
    }

    const timer = window.setInterval(() => {
      setStateIndex((index) => (index + 1) % (LOADING_STATES.length - 1));
    }, 1250);
    return () => window.clearInterval(timer);
  }, [error, onComplete, ready]);

  return (
    <div className={`curriculum-loader${exiting ? ' exiting' : ''}`} role="status" aria-live="polite">
      <div className="curriculum-loader-panel">
        <div className="loader-art-frame" aria-hidden="true">
          <span className="loader-logo-aura" />
          <span className="loader-progress-sweep" />
          <span className="loader-particle p1">✦</span>
          <span className="loader-particle p2">·</span>
          <span className="loader-particle p3">✧</span>
          <span className="loader-particle p4">·</span>
          <span className="loader-particle p5">✦</span>
          <span className="loader-particle p6">✧</span>
          <img
            className="loader-art"
            src="./brocode-pixel-loader.gif"
            alt=""
            width="791"
            height="768"
            decoding="async"
          />
        </div>

        {error ? (
          <div className="loader-copy loader-error">
            <b>Curriculum couldn’t load</b>
            <span>{error}</span>
            {onRetry && (
              <button className="btn small" type="button" onClick={onRetry}>
                <RotateCcw size={13} /> Try again
              </button>
            )}
          </div>
        ) : (
          <div className="loader-copy">
            <span className="loader-status-light" aria-hidden="true" />
            <span key={stateIndex} className="loader-message">
              {LOADING_STATES[stateIndex]}
            </span>
            <span className="loader-stage-track" aria-hidden="true">
              <i style={{ width: `${((stateIndex + 1) / LOADING_STATES.length) * 100}%` }} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
