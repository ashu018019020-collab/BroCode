/**
 * Top-level error boundary.
 *
 * Guarantees the app can never show a white screen: any render error inside a
 * route is caught here, reported honestly, and the learner is offered a safe
 * way out (retry the route, or reset the corrupted view state).
 *
 * The screen it renders is the product's RECOVERY MODE surface — the BroCode
 * badge, a plain-language title, a promise that progress is safe and three
 * labelled exits. The raw error lives inside <details>: visible to whoever
 * wants to troubleshoot, never shouted at a learner who just wants the page
 * back. It is bilingual like every other surface — the boundary sits inside
 * `I18nProvider`, so it reads the same packs as the rest of the app.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { CheckCircle2, Home, RefreshCw, RotateCcw, Wrench } from 'lucide-react';
import { useI18n } from '../../app/i18n';

interface Props { children: ReactNode }
interface State { error: Error | null; info: string }

/**
 * The three exits, as one component so the class boundary can render them
 * with hooks (a class cannot call `useI18n` itself).
 */
function RecoveryScreen({ error, info, onRetry }: { error: Error; info: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="recovery" role="alert">
      <div className="recovery-card fadeup">
        <span className="recovery-badge">
          <img src="./brocode.png" alt="" width={20} height={20} aria-hidden="true" />
          {t('error.badge')}
        </span>
        <h1 className="recovery-title">
          {t('error.title')} <em>{t('error.titleAccent')}</em>
        </h1>
        <p className="recovery-sub">{t('error.sub')}</p>

        <div className="recovery-safe" role="status">
          <CheckCircle2 size={22} aria-hidden="true" />
          <span>
            <b>{t('error.safe')}</b>
            <small>{t('error.safeSub')}</small>
          </span>
        </div>

        <div className="recovery-actions">
          <button className="recovery-exit primary" onClick={onRetry} type="button">
            <span className="row" style={{ gap: 7, alignItems: 'center' }}>
              <RotateCcw size={16} aria-hidden="true" /> <b>{t('error.retry')}</b>
            </span>
            <small>{t('error.retrySub')}</small>
          </button>
          <button
            className="recovery-exit"
            onClick={() => { window.location.hash = '#/'; onRetry(); }}
            type="button"
          >
            <span className="row" style={{ gap: 7, alignItems: 'center' }}>
              <Home size={16} aria-hidden="true" /> <b>{t('error.home')}</b>
            </span>
            <small>{t('error.homeSub')}</small>
          </button>
          <button className="recovery-exit danger" onClick={() => window.location.reload()} type="button">
            <span className="row" style={{ gap: 7, alignItems: 'center' }}>
              <RefreshCw size={16} aria-hidden="true" /> <b>{t('error.reload')}</b>
            </span>
            <small>{t('error.reloadSub')}</small>
          </button>
        </div>

        <details className="recovery-diag">
          <summary>
            <span className="row" style={{ gap: 7, alignItems: 'center' }}>
              <Wrench size={14} aria-hidden="true" /> {t('error.diagnostics')}
            </span>
            <small>{t('error.diagnosticsSub')}</small>
          </summary>
          <pre>{error.message}</pre>
          {info && <pre>{info}</pre>}
        </details>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept as a diagnostic trail, not a user-facing stack trace.
    this.setState({ info: info.componentStack ?? '' });
    console.error('[BroCode] render error:', error);
  }

  private retry = () => {
    const message = this.state.error?.message ?? '';
    if (/failed to fetch dynamically imported module|importing a module script failed|loading (?:css )?chunk .+ failed/i.test(message)) {
      window.location.reload();
      return;
    }
    this.setState({ error: null, info: '' });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <RecoveryScreen error={error} info={this.state.info} onRetry={this.retry} />;
  }
}
