import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State {
  error: Error | null;
}

interface Props {
  children: React.ReactNode;
}

/**
 * Catches render-time and lifecycle errors so a bad decode or corrupt blob
 * doesn't blank the whole PWA. Users can recover without closing the app.
 */
class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Intentionally noisy in the console — we have no remote logging in an air-gapped app.
    console.error('AirGap boundary caught:', error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ error: null });
  };

  private handleHardReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="h-[100dvh] w-screen bg-[#020617] text-slate-100 flex items-center justify-center p-6">
        <div className="glass-card max-w-md w-full border-red-500/20 text-center">
          <div className="w-16 h-16 bg-red-500/15 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-2xl font-black font-display tracking-tight mb-2">Something broke</h2>
          <p className="text-sm text-slate-400 mb-6">
            {this.state.error.message || 'An unexpected error occurred.'}
          </p>
          <div className="flex gap-3">
            <button
              onClick={this.handleReset}
              className="btn-premium btn-secondary flex-1 h-12"
            >
              Dismiss
            </button>
            <button
              onClick={this.handleHardReload}
              className="btn-premium btn-primary flex-1 h-12"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
