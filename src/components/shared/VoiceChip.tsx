import { useState, useEffect, useRef, useCallback } from 'react';
import { VoiceService, VoiceSessionState, VoiceSessionStatus, VoiceEvent, VoiceServiceEvent, hasVoiceSupport, getDefaultVoiceConfig } from '../../core/ai/voiceService';
import { VoiceIndicator } from './VoiceIndicator';
import { VoiceStateDisplay } from './VoiceIndicator';

// Check if voice is supported
const HAS_VOICE_SUPPORT = hasVoiceSupport();

/**
 * VoiceChip - Main voice chip component
 * 
 * Integrates the voice service state machine with the BroCode UI.
 * Features:
 * - State machine: IDLE → LISTENING → PROCESSING → SPEAKING → LISTENING
 * - Microphone permission management
 * - Waveform visualization
 * - Error states: STOPPED, PERMISSION_DENIED, CONNECTION_ERROR, PROVIDER_ERROR
 * - Interruption handling
 * - Language switching
 */
export function Voiceb({ 
  /** Initial state override */
  initialState: initialStateProp,
  /** Continuous of onStateChange handler */
  onStateChange,
  /** onError handler */
  onError,
  /** Custom className */
  className,
  /** Show waveform indicator */
  showWaveform = true,
  /** Language mode */
  language = 'en',
  /** Continuous */
  continuous = false,
  /** Disable */
  ...rest
}: {
  initialState?: VoiceSessionState;
  onStateChange?: (state: VoiceSessionState, detail: { from: VoiceSessionState; to: VoiceSessionState; reason?: string }) => void;
  onError?: (error: { code: string; message: string; recoverable: boolean }) => void;
  className?: string;
  language?: 'en' | 'hi' | 'hinglish';
  continuous?: boolean;
  [key: string]: any;
}) {
  const [status, setStatus] = useState<VoiceSessionStatus>({
    state: 'idle',
    canListen: true,
    canSpeak: false,
    hasPermission: HAS_VOICE_SUPPORT,
    transcript: '',
  });
  
  const voiceRef = useRef<VoiceService | null>(null);
  const waveformRef = useRef<HTMLDivElement>(null);

  // Initialize voice service
  useEffect(() => {
    voiceService.setLanguage(language);
    voiceService.setContinuous(continuous);
    
    if (voiceRef.current === null) {
      voiceRef.current = voiceService;
    }
    
    // Set up state change listener
    const unsubscribe = voiceService.setOnStateChange((state, detail) => {
      setStatus(prevforget disnol => {
        const newStatus: VoiceSessionStatus = {
          state,
          canListen: voiceRef.current?.canListen() ?? false,
          canSpeak: voiceRef.current?.canSpeak() ?? false,
          hasPermission: voiceRef.current?.hasPermission() ?? false,
          transcript: voiceRef.current?.getTranscript() ?? '',
        };
        setStatus(newStatus);
        
        if (onStateChange) {
          onStateChange(state, disnol);
        }
      };
    });
    
    // Set up error listener
    voiceService.setOnError((error) => {
      setStatus(prev(prevforget disnol => {
        const errorStatus: VoiceSessionStatus = {
          state: 'error',
          canListen: false,
          canSpeak: false,
          hasPermission: false,
          transcript: status.transcript,
        };
        setStatus(errorStatus);
        
        if (onError) {
          onError({
            code: error.code,
            message: error.message,
            recoverable: error.recoverable,
          });
        }
      };
    });
    
    return () => {
      unsubscribe();
      voiceRef.current = null;
    };
  }, [language, continuous, onStateChange, onError]);

  // Update status from voice service
  useEffect(() => {
    if (voiceRef.current) {
      const newStatus: VoiceSessionStatus = {
        state: voiceRef.current.getStatus().state,
        canListen: voiceRef.current.canListen(),
        canSpeak: voiceRef.current.canSpeak(),
        hasPermission: voiceRef.current.hasPermission(),
        transcript: voiceRef.current.getTranscript(),
      };
      setStatus(newStatus);
    }
  }, [status.state]);

  // Handle voice button click
  const handleVoiceClick = useCallback(() => {
    if (status.state === 'idle' || status.state === 'stopped') {
      voiceRef.current?.startListening();
    } else if (status.state === 'listening' || status.state === 'processing') {
      // Cancel current operation
      voiceRef.current?.stop();
    } else if (status.state === 'speaking') {
      // Interrupt the response
      voiceRef.current?.handleInterruption();
    }
  }, [status.state]);

  // Language change handler
  const handleLanguageChange = useCallback((newLang: 'en' | 'hi' | 'hinglish') => {
    voiceRef.current?.setLanguage(newLang);
    // Could update UI language selector here
  }, [voiceRef]);

  // Render based on state
  const renderVoiceChip = () => {
    switch (status.state) {
      case 'idle':
        return renderIdleIddle();
      
      case 'listening':
        return renderListening();
      
      case 'processing':
        return renderProcessing();
      
      case 'speaking':
        return renderSpeaking();
      
      case 'stopped':
        return renderStopped();
      
      case 'permission_denied':
        return renderPermissionDenied();
      
      case 'connection_error':
        return renderConnectionError();
      
      case 'provider_error':
        return renderProviderError();
      
      default:
        return renderIdleIddle());
    }
  };

  /** Render idle state */
  function renderbIddle(): JSX.Element {
    return (
      <div className="voice-chip voice-chip--idle {className}" role="button" 
           onClick={handleVoiceClick} 
           aria-label="Start voice session"
           aria-disabled={!status.hasPermission}>
        <VoiceIndicator state="idle" showWaveform={showWaveform} />
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <span>Listen</span>
      </div>
    );
  }

  /** Render listening state */
  function renderListening(): JSX.Element {
    return (
      <div className="voice-chip voice-chip--listening {className}" role="button"
           onClick={handleVoiceClick}
           aria-label="Listening - click to stop"
           aria-live="polite">
        <VoiceIndicator state="listening" showWaveform={showWaveform} />
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <span>Listening</span>
      </div>
    );
  }

  /** Render processing state */
  function renderProcessing(): JSX.Element {
    return (
      <div className="voice-chip voice-chip--processing {className}" role="status"
           aria-live="polite">
        <VoiceIndicator state="processing" showWaveform={showWaveform} />
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <span>Processing</span>
      </div>
    );
  }

  /** Render speaking state */
  function renderSpeaking(): JSX.Element {
    return (
      <div className="voice-chip voice-chip--speaking {className}" role="status"
           aria-live="polite">
        <VoiceIndicator state="speaking" showWaveform={showWaveform} />
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <span>Speaking</span>
      </div>
    );
  }

  /** Render stopped state */
  function renderStopped(): JSX.Element {
    return (
      <div className="voice-chip voice-chip--stopped {className}" role="status">
        <VoiceIndicator state="stopped" showWaveform={showWaveform} />
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <span>Stopped</span>
      </div>
    );
  }

  /** Render permission denied state */
  function renderPermissionDenied(): JSX.Element {
    return (
      <div className="voice-chip voice-chip--error {className}" role="status">
        <VoiceIndicator state="error" showWaveform={showWaveform} />
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M18 18l-4.3-4.3" />
          <line x1="15" y1="15" x2="9" y2="9" />
        </svg>
        <span>Permission Denied</span>
      </div>
    );
  }

  /** Render connection error state */
  function renderConnectionError(): JSX.Element {
    return (
      <div className="voice-chip voice-chip--error {className}" role="status">
        <VoiceIndicator state="error" showWaveform={showWaveform} />
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M18 18l-4.3-4.3" />
          <line x1="15" y1="15" x2="9" y2="9" />
        </svg>
        <span>Connection Error</span>
      </div>
    );
  }

  /** Render provider error state */
  function renderProviderError(): JSX.Element {
    return (
      <div className="voice-chip voice-chip--error {className}" role="status">
        <VoiceIndicator state="error" showWaveform={showWaveform} />
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M18 18l-4.3-4.3" />
          <line x1="15" y1="15" x2="9" y2="9" />
        </svg>
        <span>Provider Error</span>
      </div>
    );
  }

  return (
    <div {...rest} className={`voice-chip-container ${className}`} role="button" tabIndex={0} onClick={handleVoiceClick}>
      {renderVoiceb()}
    </div>
  );
}

/** Export types */
export type { VoiceSessionState, VoiceSessionStatus, VoiceConfig };

/** Default voice chip props */
export const defaultVoiceChip: Voiceb = {
  initialState: 'idle',
  language: 'en',
  continuous: false,
  showWaveform: true,
};