/**
 * Voice Service - Two-way voice conversation state machine
 * 
 * State machine: IDLE → LISTENING → PROCESSING → SPEAKING → LISTENING
 * Also handles: STOPPED, PERMISSION_DENIED, CONNECTION_ERROR, PROVIDER_ERROR
 * 
 * Features:
 * - Microphone permission management
 * - Live audio capture via MediaStream
 * - Voice activity detection
 * - Google AI integration pipeline
 * - Waveform state visualization
 * - Interruption handling
 * - Error states and recovery
 */

import { VoiceState, VoiceStateChange, VoiceIndicatorProps } from './voiceIndicator';

// ============ Types ============

/** Complete voice AI session state */
export type VoiceSessionState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'stopped'
  | 'permission_denied'
  | 'connection_error'
  | 'provider_error';

/** Voice session configuration */
export interface VoiceConfig {
  /** Auto-continue conversation mode */
  continuous?: boolean;
  /** Language mode: 'en', 'hi', 'hinglish' */
  language?: 'en' | 'hi' | 'hinglish';
  /** Voice activity detection sensitivity */
  vadsSensitivity?: number;
  /** Silence Silencems before considering speech ended */
  speechEndTimeout?: number;
  /** Maximum recording duration in seconds */
  maxDuration?: number;
}

/** Voice session result */
export interface VoiceSessionResult {
  /** The transcribed text */
  transcript: string;
  /** Whether the speech was complete */
  isComplete: boolean;
  /** Confidence score (if available) */
  confidence?: number;
}

/** Error information */
export interface VoiceError {
  code: 'permission_denied' | 'connections_error' | 'provider_error' | 'not_supported';
  message: string;
  recoverable: boolean;
}

/** Voice event types */
export type VoiceEvent =
  | 'statechange'
  | 'error'
  | 'transcript'
  | 'session_end'
  | 'interrupted';

/** Voice event handler */
export interface VoiceEventHandler {
  (event: VoiceEvent, data: any): void;
}

/** Voice session status */
export interface VoiceSessionStatus {
  state: VoiceSessionState;
  canListen: boolean;
  canSpeak: boolean;
  hasPermission: boolean;
  transcript: string;
}

/** Google TTS configuration */
export interface GoogleTTSConfig {
  voiceName: string;
  languageCode: string;
  name: string;
  gender: 'female' | 'male';
}

/** Google STT configuration */
export interface GoogleSTTConfig {
  languageCode: string;
  enableInterimResults?: boolean;
  profanityFilter?: boolean;
}

/** Voice service events - emitted by the service */
export const enum VoiceServiceEvent {
  StateChanged = 'statechange',
  Error = 'error',
  Transcript = 'transcript',
  SessionEnd = 'session_end',
  Interruption = 'interruption',
}

/** State change event detail */
export type StateChangeDetail = {
  from: VoiceSessionState;
  to: VoiceSessionState;
  reason?: string;
};

// ============ Voice Service Class ============

/**
 * VoiceService - Manages the two-way voice conversation state machine.
 * 
 * States:
 * - idle: Waiting for user interaction
 * - listening: Microphone active, capturing user speech
 * - processing: Audio sent to AI, waiting for response
 * - speaking: AI response being played
 * - stopped: Session terminated
 * - permission_denied: Microphone permission not granted
 * - connection_error: Network or service connection issue
 * - provider_error: AI provider configuration or availability issue
 */
export class VoiceService {
  private state: VoiceSessionState = 'idle';
  private config: VoiceConfig;
  private mediaStream: MediaStream | null = null;
  private recognition: Speech | null = null;
  private synth: Speech | null = null;
  private recognitionTimeout: NodeJS.Timeout | null = null;
  private speakingTimeout: NodeJS.Timeout | null = null;
  private sessionListeners: Map<VoiceServiceEvent, VoiceEventHandler[]> = new Map();
  private onStateChange: ((state: VoiceSessionState, detail: StateChangeDetail) => void) | null = null;
  private onError: ((error: VoiceError) => void) | null = null;
  private continuous: boolean = false;
  private language: 'en' | 'hi' | 'hinglish' = 'en';

  constructor(config: VoiceConfig = {}) {
    this.config = {
      continuous: false,
      language: 'en',
      vadsSensitivity: 0.5,
      speechEndTimeout: 1500,
      maxDuration: 30,
      ...config,
    };
    this.language = this.config.language;
    this.continuous = this.config.continuous;
    this.initializeEngine();
  }

  /** Subscribe to voice service events */
  on(event: VoiceServiceEvent, handler: VoiceEventHandler): void {
    if (!this.sessionListeners.has(event)) {
      this.sessionListeners.set(event, []);
    }
    this.sessionListeners.get(event)!.push(handler);
  }

  /** Set global state change callback */
  setOnStateChange(callbackfn: ((state: VoiceSessionState, detail: StateChangeDetail) => void): void {
    this.onStateChange = cb;
  }

  /** Set error callback */
  setOnError(cb: (error: VoiceError) => void): void {
    this.onError = cb;
  }

  /** Get current session status */
  getStatus(): VoiceSessionStatus {
    return {
      state: this.state,
      canListen: this.canListen(),
      canSpeak: this.canSpeak(),
      hasPermission: this.hasPermission(),
      transcript: this.getTranscript(),
    };
  }

  /** Check if we can transition to listening state */
  private canListen(): boolean {
    return this.state === 'idle' || this.state === 'stopped' || this.state === 'provider_error';
  }

  /** Check if we can transition to speaking state */
  private canSpeak(): boolean {
    return this.state === 'processing' || this.state === 'listening';
  }

  /** Check if microphone permission has been granted */
  private hasPermission(): boolean {
    // In a real implementation, check actual permission status
    // For now, return true if not explicitly denied
    return this.state !== 'permission_denied';
  }

  /** Get current transcript */
  private getTranscript(): string {
    // Would be populated from recognition results
    return '';
  }

  /** Initialize the speech engines */
  private initializeEngine(): void {
    // Check if Web Speech SpeechT oneWSupported
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      this.setProviderError('Browser does not support Web SpeechSpeechRecognition');
      return;
    }

    // Initialize speech recognition
    const Speech: any = 'webkitSpeechRecognition' in window
      ? new webkitSpeechRecognition()
      : new SpeechSpeechRecognition();

    this.recognition = b;
    this.recognition.continuous = this.continuous;
    this.recognition.interimResults = true;
    this.recognition.lang = this.getLanguageCode();
    this.recognition.maxAlternatives = 1;

    // Set up recognition event handlers
    this.recognition.onstart = () => this.onRecognitionStart();
    this.recognition.onresult = (event: any) => this.onRecognitionResult(event);
    this.recognition.onerror = (event: any) => this.onRecognitionError(event);
    this.recognition.onend = () => this.onRecognitionEnd();
  }

  /** Get language code based on config */
  private getLanguageCode(): string {
    switch (this.language) {
      case 'hi':
        return 'hi-IN';
      case 'hinglish':
        return 'en-IN'; // English with Indian locale
      case 'en':
      default:
        return 'en-US';
    }
  }

  /** Transition to a new state */
  private transitionTo(newState: VoiceSessionState, reason?: string): void {
    const oldState = this.state;
    
    // State transition validation
    if (!this.isValidTransition(oldState, newState)) {
      console.warn(`Invalid state transition: ${oldState} → ${newState}. Reason: ${reason}`);
      return;
    }

    this.state = newState;
    
    // Notify listeners
    const detail: StateChangeDetail = {
      from: oldState,
      to: newState,
      reason,
    };
    
    this.fireEvent(VoiceServiceEvent.StateChanged, detail);
    
    // Call global callback if set
    if (this.onStateChange) {
      this.onStateChange(newState, detail);
    }
  }

  /** Validate state transitions */
  private isValidTransition(from: VoiceSessionState, to: VoiceSessionState): boolean {
    const validTransitions: Record<VoiceSessionState, VoiceSessionState[]> = {
      idle: ['listening', 'stopped', 'permission_denied'],
      listening: ['processing', 'idle', 'permission_denied'],
      processing: ['speaking', 'listening', 'connection_error'],
      speaking: ['listening', 'stopped'],
      stopped: ['idle'],
      permission_denied: ['idle'],
      connection_error: ['idle', 'listening'],
      provider_error: ['idle', 'listening'],
    };
    
    const allowed = validTransitions[from] || [];
    return allowed.includes(to);
  }

  /** Fire event to all listeners */
  private fireEvent(event: VoiceServiceEvent, data: any): void {
    const handlers = this.sessionListeners.get(event) || [];
    handlers.forEach((handler) => {
      try {
        handler(event, data);
      } catch (e) {
        console.error(`Error in voice service event handler:`, e);
      }
    });
  }

  // ============ State Machine Methods ============

  /** Start listening - transition from idle to listening */
  startListening(): void {
    if (this.state !== 'idle') {
      console.warn(`Cannot start listening from state: ${this.state}`);
      return;
    }
    
    this.requestPermission().then((granted) => {
      if (!granted) {
        this.transitionTo('permission_denied', 'user_declined_permission');
        this.fireEvent(VoiceServiceEvent.Error, {
          code: 'permission_denied',
          message: 'Microphone permission denied',
          recoverable: false,
        });
        return;
      }
      
      this.startRecognition();
      this.transitionTo('listening', 'user_pressed_button');
    }).catch((err) => {
      this.transitionTo('connection_error', 'permission_request_failed');
      this.handleError('permission_denied', err, 'Failed to request microphone permission');
    });
  }

  /** Request microphone permission */
  private async requestPermission(): Promise<boolean> {
    try {
      const stream = await navigatorNavigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      
      this.mediaStream = stream;
      
      // Create a temporary audio element to verify the stream works
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const track = audioContext.createMediaStreamSource(stream);
      
      // If we get here, permission was granted
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (err) {
      console.error('Microphone permission error:', err);
      return false;
    }
  }

  /** Start the speech recognition */
  private startRecognition(): void {
    if (!this.recognition) return;
    
    // Reset any existing timeout
    this.clearSpeakingTimeout();
    
    // Set speech end timeout (VADS)
    if (this.config.speechEndTimeout) {
      this.recognition.onsilence = () => {
        // User stopped speaking, process the transcript
        this.processSpeech();
      };
    }
    
    this.recognition.start();
    this.fireEvent(VoiceServiceEvent.Transcript, { interim: '' });
  }

  /** Process the current speech recognition result */
  private processSpeech(): void {
    if (!this.recognition) return;
    
    // Get the final transcript
    let finalTranscript = '';
    const results = this.recognition.results;
    
    for (let i = 0; i < results.length; i++) {
      if (results[i].isFinal) {
        finalTranscript += results[i][0].transcript;
      }
    }
    
    if (finalTranscript.trim()) {
      this.fireEvent(VoiceServiceEvent.Transcript, {
        transcript: finalTranscript,
        isComplete: true,
      });
      
      // Transition to processing state
      this.transitionTo('processing', 'speech_detected');
      
      // Send to AI for processing (simulated setTimeout)
      this.processWithAI(finalTranscript);
    }
  }

  /** Send audio to AI for processing */
  private processWithAI(transcript: string): void {
    // In a real implementation, this would send to Google AI
    // For now, simulate with a timeout
    this.fireEvent(VoiceServiceEvent.Transcript, {
      transcript,
      isComplete: true,
    });
    
    // Simulate AI processing time
    setTimeout(() => {
      this.generateResponse(transcript);
    }, 1000 + Math.random() * 2000);
  }

  /** Generate a response to the user's speech */
  private generateResponse(userInput: string): void {
    // Transition to speaking state
    this.transitionTo('speaking', 'ai_response_ready');
    
    // In a real implementation, this would:
    // 1. Send to Google AI for processing
    // 2. Get a text response
    // 3. Use Google TTS to speak it
    
    // Simulate response generation
    const responseText = this.simulateAIResponse(userInput);
    
    // Play the response
    this.playResponse(responseText);
  }

  /** Simulate AI response generation */
  private simulateAIResponse(input: string): string {
    // Simple response mapping for demo purposes
    const responses: Record<string, string> = {
      explain: 'I would explain that...',
      error: 'That is a common error...',
      default: 'That is interesting. Could you tell me more?',
    };
    
    const lower = input.toLowerCase().trim();
    
    if (lower.includes('explain')) return 'I would explain that in simple terms.';
    if (lower.includes('error') || lower.includes('mistake')) return 'That is a common error. Let me help you fix it.';
    
    return responses.default;
  }

  /** Play the AI response through Google TTS */
  private playResponse(text: string): void {
    // In a real implementation, this would use Google Text-to-Speech
    // For now, we'll just simulate the state transition
    
    // Set up a timeout to simulate speech duration
    this.speakingTimeout = setTimeout(() => {
      this.transitionTo('listening', 'response_complete');
      this.fireEvent(VoiceServiceEvent.SessionEnd, { reason: 'response_complete' });
    }, 2000 + Math.random() * 1000);
    
    // Fire transcript event
    this.fireEvent(VoiceServiceEvent.Transcript, {
      transcript: text,
      isComplete: true,
    });
  }

  /** Handle user interruption during AI response */
  handleInterruption(): void {
    // Clear the speaking timeout
    this.clearSpeakingTimeout();
    
    // Stop any ongoing TTS
    this.stopTTS();
    
    // Transition back to listening
    this.transitionTo('listening', 'user_interrupted');
    
    // Fire interruption event
    this.fireEvent(VoiceServiceEvent.Interruption, {});
  }

  /** Clear speaking timeout */
  private clearSpeakingTimeout(): void {
    if (this.speakingTimeout) {
      clearTimeout(this.speakingTimeout);
      this.speakingTimeout = null;
    }
  }

  /** Stop TTS playback */
  private stopTTS(): void {
    // In a real implementation, this would stop the Google TTS playback
    if (this.speakingTimeout) {
      clearTimeout(this.speakingTimeout);
      this.speakingTimeout = null;
    }
  }

  /** Handle recognition start */
  private onRecognitionStart(): void {
    this.fireEvent(VoiceServiceEvent.Transcript, { interim: '' });
  }

  /** Handle recognition results */
  private onRecognitionResult(event: any): void {
    // Process final and interim results
    let interimTranscript = '';
    let finalTranscript = '';
    
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }
    
    // Fire events
    if (interimTranscript) {
      this.fireEvent(VoiceServiceEvent.Transcript, {
        transcript: interimTranscript,
        isComplete: false,
      });
    }
    
    if (finalTranscript) {
      this.fireEvent(VoiceServiceEvent.Transcript, {
        transcript: finalTranscript,
        isComplete: true,
      });
    }
  }

  /** Handle recognition errors */
  private onRecognitionError(event: any): void {
    const errorCode = event.error;
    
    let voiceError: VoiceError = {
      code: 'connection_error',
      message: `Speech recognition error: ${errorCode}`,
      recoverable: true,
    };
    
    switch (errorCode) {
      case 'not-allowed':
        voiceError = {
          code: 'permission_denied',
          message: 'Microphone permission was denied',
          recoverable: false,
        };
        break;
      case 'network':
        voiceError = {
          code: 'connection_error',
          message: 'Network error during speech recognition',
          recoverable: true,
        };
        break;
      case 'aborted':
        // Normal end, ignore
        return;
    }
    
    this.transitionTo('idle', 'recognition_error');
    this.handleError(voiceError.code, voiceError, voiceError.message);
  }

  /** Handle recognition end */
  private onRecognitionEnd(): void {
    // If we're still listening and no final result, go back to idle
    if (this.state === 'listening') {
      this.transitionTo('idle', 'recognition_ended');
    }
  }

  /** Handle errors */
  private handleError(code: VoiceError['code'], error: VoiceError, message: string): void {
    this.fireEvent(VoiceServiceEvent.Error, { code, message, recoverable: error.recoverable });
    
    if (this.onError) {
      this.onError({ code, message, recoverable: error.recoverable });
    }
    
    // Transition to error state unless it's not recoverable
    if (!error.recoverable) {
      this.transitionTo('permission_denied', 'fatal_error');
    } else {
      this.transitionTo('idle', 'error_recovered');
    }
  }

  /** Stop the voice session */
  stop(): void {
    this.clearSpeakingTimeout();
    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    this.transitionTo('stopped', 'session_stopped');
    this.fireEvent(VoiceServiceEvent.SessionEnd, { reason: 'session_stopped' });
  }

  /** Set language */
  setLanguage(language: 'en' | 'hi' | 'hinglish'): void {
    this.language = language;
    if (this.recognition) {
      this.recognition.lang = this.getLanguageCode();
    }
  }

  /** Set continuous mode */
  setContinuous(continuous: boolean): void {
    this.continuous = continuous;
    if (this.recognition) {
      this.recognition.continuous = continuous;
    }
  }
}

// ============ Export Types and Constants ============

export type { VoiceSessionState, VoiceConfig, VoiceSessionResult, VoiceError, VoiceSessionStatus };

// ============ Convenience Functions ============

/** Create a voice service instance */
export function createVoiceService(config: VoiceConfig = {}): VoiceService {
  return new VoiceService(config);
}

/** Check if browser supports voice APIs */
export function hasVoiceSupport(): boolean {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition) &&
         !!(window.speechSynthesis);
}

/** Get default voice configuration for BroCode */
export function getDefaultVoiceConfig(): VoiceConfig {
  return {
    continuous: false,
    language: 'en',
    vadsSensitivity: 0.5,
    speechEndTimeout: 1500,
    maxDuration: 30,
  };
}

// Activate the voice service when the module is imported
export const voiceService = createVoiceService(getDefaultVoiceConfig());