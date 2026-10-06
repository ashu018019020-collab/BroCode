/**
 * Top-level error boundary.
 *
 * Guarantees the app can never show a white screen: any render error inside a
 * route is caught here, reported honestly, and the learner is offered a safe
 * way out (retry the route, or reset the corrupted view state).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

interface Props { children: ReactNode }
interface State { error: Error | null; info: string }

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
    return (
      <div className="content" style={{ paddingTop: 40 }}>
        <div className="card fadeup" style={{ maxWidth: 720, margin: '0 auto' }}>
          <h2 className="row" style={{ gap: 10 }}>
            <AlertTriangle size={20} color="var(--amber)" /> Kuch galat ho gaya is screen par
          </h2>
          <p className="muted small">
            Tumhari progress safe hai — localStorage me save hai. Neeche wala error sirf is page ka hai.
          </p>
          <pre className="codeblock" style={{ whiteSpace: 'pre-wrap' }}>{error.message}</pre>
          {this.state.info && (
            <details style={{ marginTop: 8 }}>
              <summary className="small muted" style={{ cursor: 'pointer' }}>Technical details</summary>
              <pre className="codeblock" style={{ whiteSpace: 'pre-wrap', fontSize: '.72rem' }}>{this.state.info}</pre>
            </details>
          )}
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <button className="btn primary" onClick={this.retry}><RotateCcw size={14} /> Dobara try karo</button>
            <button className="btn" onClick={() => { window.location.hash = '#/'; this.retry(); }}><Home size={14} /> Dashboard</button>
            <button className="btn danger" onClick={() => window.location.reload()}>App reload karo</button>
          </div>
        </div>
      </div>
    );
  }
}
