import { useRef, useEffect, useState } from 'react';
import { useStore } from '../../core/storage/store';

// Voice state enum
export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error' | 'stopped';

// Voice state change callback
export type VoiceStateChange = {
  state: VoiceState;
  message?: string;
};

// Voice waveform config
const WAVEFORM_CONFIG = {
  idle: { height: '2px', color: 'var(--muted)' },
  listening: { height: '4px', color: 'var(--cyan)' },
  processing: { height: '3px', color: 'var(--accent)' },
  speaking: { height: '5px', color: 'var(--primary)' },
  error: { height: '2px', color: 'var(--error)' },
  stopped: { height: '2px', color: 'var(--muted)' },
};

interface VoiceIndicatorProps {
  state: VoiceState;
  /** Optional custom message to display alongside the waveform */
  message?: string;
  /** Whether to show the waveform at all */
  showWaveform?: boolean;
  /** Class override for custom styling */
  className?: string;
}

/**
 * VoiceIndicator - A small waveform visual that reflects the current voice AI state.
 * 
 * The waveform animates based on the voice state:
 * - idle: calm, single bar
 * - listening: pulse animation (mic listening)
 * - processing: three moving bars
 * - speaking: animated wave pattern
 * - error: red indicator
 * - stopped: stopped animation
 */
export function VoiceIndicator({
  state,
  message,
  showWaveform = true,
  className,
}: VoiceIndicatorProps) {
  const [animate, setAnimate] = useState(false);
  const waveformRef = useRef<HTMLDivElement>(null);

  // Start animation when state changes to non-idle
  useEffect(() => {
    if (state !== 'idle' && state !== 'stopped') {
      setAnimate(true);
    } else {
      setAnimate(false);
    }
  }, [state]);

  // Pulse animation for listening state
  useEffect(() => {
    if (state === 'listening' || state === 'speaking') {
      const timeoutId = setTimeout(() => setAnimate((prev) => !prev), 500);
      return () => clearTimeout(timeoutId);
    }
  }, [state]);

  const config = WAVEFORM_CONFIG[state];
  const barCount = state === 'speaking' ? 5 : state === 'processing' ? 3 : 1;

  return (
    <div
      ref={waveformRef}
      className=`voice-indicator ${className}`
      style={{
        width: showWaveform ? '24px' : '0',
        height: config.height,
        backgroundColor: config.color,
        borderRadius: '2px',
        margin: '0 4px',
        transition: 'height 0.3s ease, background-color 0.2s ease',
        ...(state === 'listening' || state === 'speaking' ? {
          animation: `waveformPulse 1.5s ease-in-out infinite`,
          WebkitAnimation: `waveformPulse 1.5s ease-in-out infinite`,
        } : {}),
      }}
      aria-label={message || `Voice ${state}`}
    >
      {showWaveform && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            margin: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            width: '100%',
          }}
        >
          {Array.from({ length: barCount }).map((_, i) => (
            <div
              key={i}
              style={{
                width: '4px',
                backgroundColor: config.color,
                margin: '2px 0',
                borderRadius: '2px',
                transition: 'height 0.3s ease',
                height: animate ? '80%'%'%'' : '20%',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * VoiceStateDisplay - Display the current voice state with label
 */
export function VoiceStateDisplay({ state, message }: { state: VoiceState; message?: string }) {
  const stateLabels: Record<VoiceState, string> = {
    idle: 'Idle',
    listening: 'Listening',
    processing: 'Processing',
    speaking: 'Speaking',
    error: 'Error',
    stopped: 'Stopped',
  };

  const stateColors: Record<VoiceState, string> = {
    idle: 'var(--muted)',
    listening: 'var(--cyan)',
    processing: 'var(--accent)',
    speaking: 'var(--primary)',
    error: 'var(--error)',
    stopped: 'var(--muted)',
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium" style={{ color: stateColors[state] }}>
        {stateLabels[state]}
      </span>
      {message && <span className="text-xs text-muted/-muted" style={{ color: 'var(--muted)' }}>{message}</span>}
    </div>
  );
}

/**
 * VoiceChip - Main voice chip component that integrates the indicator
 * This is the component that should be used in the UI alongside the voice button
 */
export function VoiceChip({ 
  onToggle,
  onError,
  initialState: initialStateProp,
  ...rest 
}: {
  onToggle: (state: VoiceState) => void;
  onError?: (error: Error) => void;
  initialState?: VoiceState;
  [key: string]: any;
}) {
  const store = useStore();
  const [state, setState] = useState<VoiceState>(initialStateProp || 'idle');
  const [error, setError] = useState<Error | null>(null);

  // Notify parent of state change
  useEffect(() => {
    onToggle(state);
  }, [state, onToggle]);

  // Handle error state
  useEffect(() => {
    if (error) {
      setState('error');
      onError?.(error);
      // Reset after 3 seconds
      const timer = setTimeout(() => {
        setState('idle');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  return (
    <div
      {...rest}
      className="relative inline-flex items-center rounded-md border border-transparent bg-white px-3 py-1.5 text-sm font-medium shadow-sm focus:outlineoutline-none focus:ring-2 focus:ring-offsetprimary focus:ring-primary data-[state=idle]:bg-[color:var(--background)]"
      data-state={state}
    >
      {/* Voice state indicator */}
      <VoiceIndicator state={state} message={rest.message} />

      {/* Voice action button */}
      <button
        onClick={() => onToggle(state === 'idle' ? 'listening' : 'idle')}
')}
)
        className="rounded-md bg-primary px-2 py-0.5 text-sm font-medium text-white hover:bg-[color:var(--primary)]hover:text-white"
        aria-label={state === 'idle' ? 'Start voice session' : 'Stop voice session'}
      >
        {state === 'idle' ? 'Listen' : 'Stop'}
      </button>
    </div>
  );
}