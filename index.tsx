/**
 * AirGap v2 - Application Entry Point
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import PWAUpdatePrompt from './components/PWAUpdatePrompt';
import { ToastProvider } from './components/Toast';
import './index.css';

// Air-gapped: no remote logging. Surface unhandled errors loudly in the console.
console.info('[AirGap] application initializing');

window.onerror = (message, source, lineno, colno, error) => {
  console.error('Global error:', { message, source, lineno, colno, error });
};

window.onunhandledrejection = (event) => {
  console.error('Unhandled promise rejection:', event.reason);
};

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

const root = createRoot(rootElement);

root.render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
        <PWAUpdatePrompt />
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>
);
