/**
 * UI entry (FigmaLint-style). Imports ONLY: react, react-dom/client, ./styles.css, ./App.
 * FORBIDDEN: any import from ../main or src/main/. This bundle must stay completely separate from plugin code.
 *
 * -----------------------------------------------------------------------------
 * INVESTIGATION: Plugin UI "reload" / white flash during documentation generation
 * -----------------------------------------------------------------------------
 * Flow when user clicks "Create Handoff Doc":
 * 1. handleScanScreens() -> validateApiKey() or executeScanScreens()
 * 2. setIsScanning(true), setScanProgress('...'), parent.postMessage({ type: 'scan-screens', ... })
 * 3. Main thread receives in figma.ui.onmessage -> handleScanScreens() (async)
 * 4. Main sends progress messages -> UI setScanProgress(); eventually scan-complete -> setIsScanning(false)
 *
 * Where could a reload be triggered?
 * - figma.closePlugin() is NOT called anywhere in the codebase.
 * - No route changes or conditional rendering that unmounts the root App.
 * - Error boundary only catches render errors; it does not unmount the tree on catch.
 * - localStorage is NOT cleared during the process (we only read/write on change or mount).
 *
 * Root cause identified: React.StrictMode (dev only) intentionally double-mounts
 * components: mount -> unmount (cleanup) -> mount again. That unmount clears
 * React state (including apiKey in state) and removes the message handler
 * (window.onmessage = null in effect cleanup). So we see a "flash" and
 * state appears reset. After remount, state is re-initialized from useState
 * initializers (loadFromStorage); if the key was saved to localStorage it
 * restores, but the brief unmount looks like a reload and can miss progress
 * messages.
 *
 * Targeted fix: Remove StrictMode so the plugin UI does not double-mount.
 * We keep ErrorBoundary to catch errors without full crash. localStorage
 * restore on mount remains as fallback for any other reload source.
 * -----------------------------------------------------------------------------
 */
import { createRoot } from 'react-dom/client';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import './styles.css';
import App from './App';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  state = { hasError: false, error: '' };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[FlowDoc UI] Error boundary caught:', error.message, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, color: '#fff', background: '#1a1a1a', fontFamily: 'Inter, sans-serif' }}>
          <p style={{ margin: '0 0 8px', fontWeight: 600 }}>Something went wrong</p>
          <p style={{ margin: 0, fontSize: 13, color: '#a0a0a0' }}>{this.state.error}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: '' })}
            style={{ marginTop: 16, padding: '8px 16px', background: '#0066cc', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('app');
if (root) {
  createRoot(root).render(
    <ErrorBoundary>
      <App />
      <SpeedInsights />
    </ErrorBoundary>
  );
}
