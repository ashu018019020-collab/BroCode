import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Check, Gauge, Loader2, RefreshCw, Trash2, Volume2, WifiOff } from 'lucide-react';
import { readVoiceTelemetry, clearVoiceTelemetry } from '../../core/storage/voice-telemetry';
import { summarizeVoiceTelemetry, type VoiceEngineTag } from '../../core/platform/voice-telemetry';

/**
 * Production voice health — readiness, latency and fallback counts, on one screen.
 *
 * It reports two DIFFERENT things and never blends them:
 *
 *  · **The deployment** — what `GET /api/voice/health` says right now: which engine the production
 *    build would use, whether it really answered (the route force-probes the inference service),
 *    which variables are present (names only), and the round-trip time of that check. This is the
 *    authoritative half: it is the same answer the voice route itself uses.
 *  · **This browser** — which engine actually spoke for every answer read aloud here, how long the
 *    audio took, and how often the answer fell back to the built-in voice. These numbers are counted
 *    after real playback (see `core/platform/voice-telemetry.ts` for why they cannot be counted
 *    server-side on a per-isolate serverless host), so they are labelled as device-local.
 *
 * The page refuses to invent an aggregate: no shared store is wired, so it says "this browser"
 * rather than pretending to know every visitor.
 */

const HEALTH_PATH = './api/voice/health';
const STATUS_PATH = './api/voice/status';

interface HealthReport {
  ok?: boolean;
  code?: string;
  engine?: string;
  ready?: boolean;
  verified?: boolean;
  detail?: string;
  env?: Record<string, 'set' | 'missing'>;
  hints?: string[];
  requestId?: string;
}

interface StatusReport {
  configured?: boolean;
  engine?: string;
  engineLabel?: string;
  ready?: boolean;
  reason?: string | null;
}

const ENGINE_LABEL: Record<VoiceEngineTag, string> = {
  supertonic: 'Supertonic 3 (server)',
  google: 'Google Neural2 (server)',
  browser: 'Built-in browser voice',
};

function ms(value: number | null): string {
  if (value === null) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

function pct(value: number | null): string {
  // A share of zero answers is unknown, not 0% — the same rule the rest of the app uses.
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export default function VoiceHealth() {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [status, setStatus] = useState<StatusReport | null>(null);
  const [probeMs, setProbeMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState(() => readVoiceTelemetry());

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    setTelemetry(readVoiceTelemetry());
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const [healthResponse, statusResponse] = await Promise.all([
        fetch(HEALTH_PATH, { headers: { Accept: 'application/json' } }),
        fetch(STATUS_PATH, { headers: { Accept: 'application/json' } }),
      ]);
      const doneAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      setProbeMs(Math.round(doneAt - startedAt));
      // 503 is a valid ANSWER here (not configured / not ready), so the body is read either way.
      setHealth(await healthResponse.json().catch(() => null));
      setStatus(await statusResponse.json().catch(() => null));
    } catch {
      setError('The voice health endpoint did not answer. The site itself is still usable.');
      setHealth(null);
      setStatus(null);
      setProbeMs(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const summary = useMemo(() => summarizeVoiceTelemetry(telemetry), [telemetry]);
  const ready = health?.ok === true;
  const engine = health?.engine ?? status?.engine ?? 'none';

  return (
    <div>
      <div className="row spread" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1 className="row" style={{ gap: 10 }}><Activity size={24} color="var(--cyan)" /> VOICE HEALTH</h1>
          <p className="muted small" style={{ maxWidth: 720 }}>
            What the production voice path is doing right now: engine readiness, how long the audio
            takes to arrive, and how often answers fall back to the built-in voice.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn small" onClick={() => { void refresh(); }} disabled={busy}>
            {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Refresh
          </button>
        </div>
      </div>

      {error && (
        <p className="voice-error small" role="status" style={{ marginTop: 10 }}>
          <AlertTriangle size={13} /> {error}
        </p>
      )}

      {/* ---------------- deployment readiness ---------------- */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
          <h2 className="row" style={{ gap: 8, margin: 0 }}>
            {ready ? <Check size={16} color="var(--green)" /> : <WifiOff size={16} color="var(--amber)" />}
            Deployment
          </h2>
          <span className={`chip ${ready ? 'easy' : 'hard'}`} aria-live="polite">
            {health === null && !error ? 'Checking…' : ready ? 'Ready' : (health?.code ?? 'Unavailable')}
          </span>
        </div>

        <div className="kpi-row">
          <div className={`kpi ${ready ? 'tone-green' : 'tone-amber'}`}>
            <span className="ic"><Volume2 size={15} /></span>
            <div>
              <div className="n">{engine === 'supertonic' ? 'Supertonic 3' : engine === 'google' ? 'Google Neural2' : 'None'}</div>
              <div className="l">configured engine</div>
            </div>
          </div>
          <div className="kpi tone-blue">
            <span className="ic"><Gauge size={15} /></span>
            <div>
              <div className="n">{ms(probeMs)}</div>
              <div className="l">health probe round trip</div>
            </div>
          </div>
          <div className="kpi tone-violet">
            <span className="ic"><Check size={15} /></span>
            <div>
              <div className="n">{health?.verified === true ? 'Verified' : health?.ready === true ? 'Unverified' : 'No'}</div>
              {/* A key present is not a working voice: `verified` means the engine really answered. */}
              <div className="l">engine answered</div>
            </div>
          </div>
          <div className="kpi">
            <span className="ic"><Activity size={15} /></span>
            <div>
              <div className="n">{status?.ready === true ? 'Ready' : 'Fallback'}</div>
              <div className="l">status route</div>
            </div>
          </div>
        </div>

        {health?.detail && <p className="small muted" style={{ margin: '6px 0' }}>{health.detail}</p>}

        {health?.env && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {Object.entries(health.env).map(([name, state]) => (
              <span key={name} className={`chip ${state === 'set' ? 'easy' : 'hard'}`}>
                {name}: {state}
              </span>
            ))}
          </div>
        )}

        {Array.isArray(health?.hints) && health!.hints!.length > 0 && (
          <ul className="small muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {health!.hints!.map((hint) => <li key={hint}>{hint}</li>)}
          </ul>
        )}

        {health?.requestId && (
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            Server request id <code>{health.requestId}</code> — quote it when reading the function logs.
          </p>
        )}
      </div>

      {/* ---------------- device-local counters ---------------- */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
          <h2 className="row" style={{ gap: 8, margin: 0 }}><Volume2 size={16} color="var(--violet)" /> This browser</h2>
          <div className="row" style={{ gap: 8 }}>
            <span className="chip">{summary.total} answers</span>
            <button
              type="button"
              className="btn small ghost"
              onClick={() => { clearVoiceTelemetry(); setTelemetry(readVoiceTelemetry()); }}
              disabled={summary.total === 0 && summary.failureTotal === 0}
            >
              <Trash2 size={12} /> Clear
            </button>
          </div>
        </div>

        <div className="kpi-row">
          <div className="kpi tone-green">
            <span className="ic"><Volume2 size={15} /></span>
            <div>
              <div className="n">{summary.byEngine.supertonic}</div>
              <div className="l">Supertonic answers</div>
            </div>
          </div>
          <div className="kpi tone-blue">
            <span className="ic"><Volume2 size={15} /></span>
            <div>
              <div className="n">{summary.byEngine.google}</div>
              <div className="l">Google answers</div>
            </div>
          </div>
          <div className="kpi tone-amber">
            <span className="ic"><WifiOff size={15} /></span>
            <div>
              <div className="n">{summary.byEngine.browser}</div>
              <div className="l">browser-voice fallbacks</div>
            </div>
          </div>
          <div className="kpi">
            <span className="ic"><Gauge size={15} /></span>
            <div>
              <div className="n">{pct(summary.serverShare)}</div>
              <div className="l">server share · fallback {pct(summary.browserShare)}</div>
            </div>
          </div>
        </div>

        <div className="grid2" style={{ marginTop: 8 }}>
          <div>
            <h3 className="small" style={{ margin: '0 0 6px' }}>Time to first audio</h3>
            <p className="small muted" style={{ margin: 0 }}>
              p50 <b>{ms(summary.p50)}</b> · p95 <b>{ms(summary.p95)}</b> · {summary.samples} sample
              {summary.samples === 1 ? '' : 's'} (browser-voice answers are not timed)
            </p>
            <p className="small muted" style={{ margin: '6px 0 0' }}>
              Last answer{summary.lastAt ? `: ${new Date(summary.lastAt).toLocaleString()}` : ': none recorded yet'}
            </p>
          </div>
          <div>
            <h3 className="small" style={{ margin: '0 0 6px' }}>Failures ({summary.failureTotal})</h3>
            {summary.failures.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>No voice request has failed in this browser.</p>
            ) : (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {summary.failures.map(({ code, count }) => (
                  <span key={code} className="chip hard">{code} × {count}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="small muted" style={{ margin: '10px 0 0' }}>
          Counted on this device only ({ENGINE_LABEL.browser} vs server engines), because each Vercel
          function keeps its own memory — a site-wide aggregate would need a store, and this page will
          not display a number it cannot back.
        </p>
      </div>
    </div>
  );
}
