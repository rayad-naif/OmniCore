import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './context/AuthContext';
import './index.css';
import App from './App';
import { loadBranding } from './lib/branding';

const root = document.getElementById('root')!;
// White-label branding (agency custom domains) is applied before first paint
// when it arrives quickly; otherwise the default renders and updates in place.
void loadBranding().finally(() => {
  createRoot(root).render(
    <StrictMode>
      <AuthProvider>
        <App />
      </AuthProvider>
    </StrictMode>,
  );
});

// Register the service worker so the dashboard is installable ("Add to Home Screen").
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/dashboard/sw.js', { scope: '/dashboard/' })
      .catch(() => {
        /* installability is best-effort */
      });
  });
}
