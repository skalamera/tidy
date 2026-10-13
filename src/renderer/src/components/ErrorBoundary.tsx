import { Component, type ErrorInfo, type ReactNode } from 'react';
import { tidy } from '../api';
import { Logo } from './Brand';

/** If a screen throws while drawing, show a way out instead of a blank window, and send the error to Tidy's log. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    tidy().reportError(`${error.stack ?? String(error)}${info.componentStack ?? ''}`);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="welcome crash" role="alert">
        <Logo size={72} />
        <h1>Something went wrong on this screen</h1>
        <p>Your documents and answers are saved. Reload Tidy to pick up where you left off.</p>
        <button className="btn primary big" onClick={() => window.location.reload()}>
          Reload Tidy
        </button>
      </main>
    );
  }
}
