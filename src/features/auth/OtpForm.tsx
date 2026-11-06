import { useEffect, useRef, useState } from 'react';
import { authApi, type AuthUser } from '../../core/auth/client';
import { authErrorCopy, isEmail } from '../../core/auth/messages';

/**
 * Sign in with a one-time code instead of a password.
 *
 * Two steps on purpose: request the code, then type it. The address is carried from step 1 to 2, so
 * a learner never retypes it and cannot verify a code against a different address than the one it
 * was sent to. Supabase issues, expires and rate-limits the code; this form only moves it.
 *
 * `shouldCreateUser: false` lives in `authApi.requestEmailCode`: a code opens an EXISTING account,
 * so the admin role follows the account rather than the sign-in method.
 */
const SEND_COOLDOWN_SECONDS = 60;

export default function OtpForm({ onSuccess }: { onSuccess?: (user: AuthUser) => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sentAt, setSentAt] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const codeRef = useRef<HTMLInputElement>(null);

  /** Seconds left before another code may be sent; 0 means the button is free. */
  const wait = sentAt ? Math.max(0, SEND_COOLDOWN_SECONDS - Math.floor((clock - sentAt) / 1000)) : 0;
  useEffect(() => {
    if (!wait) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [wait]);

  useEffect(() => {
    if (stage === 'code') codeRef.current?.focus();
  }, [stage]);

  const send = async () => {
    setError('');
    setNotice('');
    if (!isEmail(email) || busy || wait > 0) return;
    setBusy(true);
    try {
      await authApi.requestEmailCode(email);
      setStage('code');
      setSentAt(Date.now());
      setClock(Date.now());
      setNotice(`A 6-digit code is on its way to ${email.trim()}. It expires shortly — enter it below.`);
    } catch (cause) {
      setError(authErrorCopy(cause instanceof Error ? cause.message : 'The code could not be sent.'));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError('');
    if (code.trim().length < 6 || busy) return;
    setBusy(true);
    try {
      const account = await authApi.verifyEmailCode(email, code);
      onSuccess?.(account);
    } catch (cause) {
      setError(authErrorCopy(cause instanceof Error ? cause.message : 'That code was not accepted.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-otp" role="group" aria-label="Sign in with an email code">
      <p className="muted small" style={{ marginTop: 0 }}>
        No password needed: we email a one-time code to the address on your account. Only existing
        accounts can use this.
      </p>
      <label className="auth-field">
        <span>Email</span>
        <input
          autoComplete="email"
          disabled={stage === 'code' || busy}
          inputMode="email"
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          type="email"
          value={email}
        />
      </label>
      {stage === 'code' && (
        <label className="auth-field">
          <span>6-digit code</span>
          <input
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            ref={codeRef}
            type="text"
            value={code}
          />
        </label>
      )}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {notice && <p className="auth-message" role="status">{notice}</p>}
      {stage === 'email' ? (
        <button className="btn auth-wide primary" disabled={!isEmail(email) || busy} onClick={() => void send()} type="button">
          {busy ? 'Sending…' : 'Email me a code'}
        </button>
      ) : (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={code.length < 6 || busy} onClick={() => void verify()} type="button">
            {busy ? 'Checking…' : 'Verify & sign in'}
          </button>
          <button className="btn" disabled={busy || wait > 0} onClick={() => void send()} type="button">
            {wait > 0 ? `Resend in ${wait}s` : 'Send a new code'}
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => { setStage('email'); setCode(''); setError(''); setNotice(''); }}
            type="button"
          >
            Change email
          </button>
        </div>
      )}
    </div>
  );
}
