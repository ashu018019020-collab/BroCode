import { useCallback, useEffect, useRef, useState } from 'react';
import { authApi, type RealtimeVoiceSession } from '../../core/auth/client';
import { ONLINE_VOICE_CONSENT_KEY } from '../../core/platform/keys';

/**
 * The optional OpenAI Realtime voice, adapted from the WebRTC flow in
 * `openai/openai-realtime-console` (MIT).
 *
 * What is deliberately different from the reference:
 *   · the browser receives a SHORT-LIVED client secret from BroCode's own API, never the permanent
 *     key, and never talks to a server that forwards raw audio;
 *   · the session instructions (language, teaching shape, no fake test results) are set when the
 *     server mints the secret, so the browser cannot rewrite the rules;
 *   · a hard session timer and a full teardown run even if the network dies;
 *   · the assistant transcript is shown as it streams, and a user transcript is added only when the
 *     service reports a completed transcription — the UI never displays an invented sentence.
 *
 * This is an UPGRADE. `configured` starts as null (unknown), becomes false when the API is absent or
 * has no key, and the page keeps using the browser voice in that case. No part of BroCode depends on
 * this hook working.
 */

export type RealtimeStatus = 'off' | 'connecting' | 'connected' | 'error' | 'unavailable';

export interface RealtimeTurn {
  role: 'learner' | 'assistant';
  text: string;
  final: boolean;
}

export interface RealtimeVoice {
  supported: boolean;
  /** null until the API's configuration probe answers. */
  configured: boolean | null;
  status: RealtimeStatus;
  error: string | null;
  muted: boolean;
  turns: RealtimeTurn[];
  /** Assistant partial text while it is being spoken. */
  partial: string;
  model: string | null;
  voice: string | null;
  /**
   * The learner's explicit consent to send microphone audio to the online provider for a session.
   * Persisted on this device, false by default, and required by both this hook and the server.
   */
  consent: boolean;
  setConsent: (value: boolean) => void;
  connect: (lang: 'en-IN' | 'hi-IN') => Promise<boolean>;
  disconnect: () => void;
  sendText: (text: string) => void;
  toggleMute: () => void;
  interrupt: () => void;
  dismissError: () => void;
}

const STATUS_PATH = './api/voice/realtime/status';

function realtimeSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof window.RTCPeerConnection === 'function'
    && typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia;
}

function micErrorCopy(error: unknown): string {
  const name = (error as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone permission is blocked. Allow it in the address bar, then reconnect.';
  }
  if (name === 'NotFoundError') return 'No microphone was found. Connect one and reconnect.';
  return 'The microphone could not be opened. Check the device and permission, then reconnect.';
}

export function useRealtimeVoice(): RealtimeVoice {
  const supported = useRef(realtimeSupported()).current;
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>(supported ? 'off' : 'unavailable');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState<RealtimeTurn[]>([]);
  const [partial, setPartial] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const [voice, setVoice] = useState<string | null>(null);
  const [consent, setConsentState] = useState<boolean>(() => {
    try { return localStorage.getItem(ONLINE_VOICE_CONSENT_KEY) === '1'; } catch { return false; }
  });
  const consentRef = useRef(consent);
  consentRef.current = consent;

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const draftRef = useRef('');
  const timerRef = useRef<number | null>(null);
  const alive = useRef(true);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const disconnect = useCallback(() => {
    clearTimer();
    try { dcRef.current?.close(); } catch { /* already closed */ }
    dcRef.current = null;
    for (const track of micRef.current?.getTracks() ?? []) {
      try { track.stop(); } catch { /* already stopped */ }
    }
    micRef.current = null;
    try { pcRef.current?.close(); } catch { /* already closed */ }
    pcRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
      audioRef.current = null;
    }
    draftRef.current = '';
    if (alive.current) {
      setPartial('');
      setMuted(false);
      setStatus((current) => (current === 'error' || current === 'unavailable' ? current : 'off'));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      disconnect();
    };
  }, [disconnect]);

  // One probe, like the browser-voice hook. A static host answers its own HTML or 404 here; both
  // mean "not configured", which is the truth the label needs.
  useEffect(() => {
    if (!supported) { setConfigured(false); return; }
    let live = true;
    fetch(STATUS_PATH, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      // A configured key behind a disabled switch is not available online voice — the label must
      // not offer a connection the server will refuse.
      .then((payload) => { if (live) setConfigured(payload?.configured === true && payload?.enabled !== false); })
      .catch(() => { if (live) setConfigured(false); });
    return () => { live = false; };
  }, [supported]);

  const pushTurn = useCallback((turn: RealtimeTurn) => {
    setTurns((previous) => [...previous, turn].slice(-60));
  }, []);

  const handleEvent = useCallback((raw: string) => {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = typeof event.type === 'string' ? event.type : '';
    if (type === 'response.audio_transcript.delta' && typeof event.delta === 'string') {
      draftRef.current += event.delta;
      setPartial(draftRef.current);
      return;
    }
    if (type === 'response.audio_transcript.done') {
      const transcript = typeof event.transcript === 'string' ? event.transcript : draftRef.current;
      if (transcript.trim()) pushTurn({ role: 'assistant', text: transcript.trim(), final: true });
      draftRef.current = '';
      setPartial('');
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.completed' && typeof event.transcript === 'string') {
      if (event.transcript.trim()) pushTurn({ role: 'learner', text: event.transcript.trim(), final: true });
      return;
    }
    if (type === 'response.done') {
      if (draftRef.current.trim()) pushTurn({ role: 'assistant', text: draftRef.current.trim(), final: true });
      draftRef.current = '';
      setPartial('');
      return;
    }
    if (type === 'error') {
      const message = (event.error as { message?: unknown } | undefined)?.message;
      setError(typeof message === 'string' && message.trim()
        ? message
        : 'The realtime voice reported an error. Disconnect and use the browser voice.');
    }
  }, [pushTurn]);

  const setConsent = useCallback((value: boolean) => {
    consentRef.current = value;
    setConsentState(value);
    try {
      if (value) localStorage.setItem(ONLINE_VOICE_CONSENT_KEY, '1');
      else localStorage.removeItem(ONLINE_VOICE_CONSENT_KEY);
    } catch { /* private mode: the session then just stays off */ }
    // Withdrawing consent ends a live session immediately — the audio must stop on the same action.
    if (!value) disconnect();
  }, [disconnect]);

  const connect = useCallback(async (lang: 'en-IN' | 'hi-IN'): Promise<boolean> => {
    if (!consentRef.current) {
      setStatus('off');
      setError('Turn on "Online AI Voice" to start a live session. The browser voice works without it.');
      return false;
    }
    if (!supported) {
      setStatus('unavailable');
      setError('This browser does not support WebRTC audio for the realtime voice. The browser voice still works.');
      return false;
    }
    disconnect();
    setStatus('connecting');
    setError(null);
    setTurns([]);
    setPartial('');

    let session: RealtimeVoiceSession;
    try {
      session = await authApi.voiceRealtime(lang, true);
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not start the realtime voice session.');
      return false;
    }
    if (!alive.current) return false;
    setModel(session.model);
    setVoice(session.voice);

    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (cause) {
      setStatus('error');
      setError(micErrorCopy(cause));
      return false;
    }
    if (!alive.current) {
      for (const track of mic.getTracks()) track.stop();
      return false;
    }

    try {
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      const audio = new Audio();
      audio.autoplay = true;
      audioRef.current = audio;
      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio.play().catch(() => {
          setError('The browser blocked audio playback. Press the page once, then reconnect.');
        });
      };

      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;
      dc.addEventListener('open', () => {
        if (!alive.current) return;
        setStatus('connected');
        setError(null);
      });
      dc.addEventListener('message', (event) => handleEvent(String(event.data)));
      dc.addEventListener('close', () => {
        if (!alive.current || pcRef.current !== pc) return;
        setStatus((current) => (current === 'error' ? current : 'off'));
      });

      micRef.current = mic;
      for (const track of mic.getTracks()) pc.addTrack(track, mic);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const response = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(session.model)}`, {
        method: 'POST',
        body: offer.sdp ?? '',
        headers: {
          Authorization: `Bearer ${session.clientSecret}`,
          'Content-Type': 'application/sdp',
        },
      });
      if (!response.ok) {
        throw new Error(response.status === 401
          ? 'The realtime session expired. Reconnect to get a fresh one.'
          : `The realtime service refused the call (HTTP ${response.status}).`);
      }
      const sdp = await response.text();
      await pc.setRemoteDescription({ type: 'answer', sdp });

      // The server's ceiling is enforced locally too: a forgotten tab must not keep a billable
      // session open after the page stopped showing the timer.
      timerRef.current = window.setTimeout(() => {
        setError(`The ${Math.round(session.maxSessionSeconds / 60)}-minute realtime limit was reached. The session closed; reconnect for another round.`);
        disconnect();
        setStatus('off');
      }, Math.max(30, session.maxSessionSeconds) * 1000);

      pc.addEventListener('connectionstatechange', () => {
        if (!alive.current || pcRef.current !== pc) return;
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          setError('The realtime connection dropped. Reconnect, or keep using the browser voice.');
          setStatus('error');
        }
      });
      return true;
    } catch (cause) {
      disconnect();
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not connect the realtime voice.');
      return false;
    }
  }, [disconnect, handleEvent, supported]);

  const sendText = useCallback((text: string) => {
    const clean = text.trim();
    const dc = dcRef.current;
    if (!clean || !dc || dc.readyState !== 'open') return;
    dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: clean }] },
    }));
    dc.send(JSON.stringify({ type: 'response.create' }));
    pushTurn({ role: 'learner', text: clean, final: true });
  }, [pushTurn]);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      for (const track of micRef.current?.getAudioTracks() ?? []) track.enabled = !next;
      return next;
    });
  }, []);

  const interrupt = useCallback(() => {
    const dc = dcRef.current;
    if (dc?.readyState === 'open') dc.send(JSON.stringify({ type: 'response.cancel' }));
    draftRef.current = '';
    setPartial('');
  }, []);

  return {
    supported,
    configured,
    status,
    error,
    muted,
    turns,
    partial,
    model,
    voice,
    consent,
    setConsent,
    connect,
    disconnect,
    sendText,
    toggleMute,
    interrupt,
    dismissError: () => setError(null),
  };
}
