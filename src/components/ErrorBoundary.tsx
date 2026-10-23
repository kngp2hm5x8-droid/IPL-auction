import { Component, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button, EmptyState } from './ui';

/** Keeps a rendering bug in one page from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error: Error) {
    console.error('UI error', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <EmptyState
        icon={<TriangleAlert className="size-5 text-warn" />}
        title="Something went wrong"
        action={<Button variant="primary" onClick={() => window.location.reload()}>Reload</Button>}
      >
        This screen hit an unexpected error. Your room and auction are safe on the server — reloading will reconnect you.
      </EmptyState>
    );
  }
}
