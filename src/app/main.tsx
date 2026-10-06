import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from '../core/auth/AuthProvider';
import { mountSpotlight } from '../components/shared/spotlight';
import { mountStudyTracker } from '../core/storage/study';
import '../styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);

// The pointer-tracked spotlight is pure DOM — one delegated listener for the whole app, independent
// of the component tree — so it is mounted here and not in a component that remounts per route.
// It attaches nothing on a touch device or under `prefers-reduced-motion: reduce`.
mountSpotlight();

// Study time is measured for as long as the app is open, so the tracker lives at module scope too.
// It counts only visible, in-use time and writes to the store on a slow timer (see offline/study.ts).
mountStudyTracker();

/**
 * Service worker policy.
 *
 * Production: register the local worker — it precaches the offline assets
 * (Pyodide, Monaco, curriculum, question banks) so the app works with no network.
 *
 * Dev: actively UNREGISTER any worker + purge its caches, then reload once. A
 * worker left over from an earlier production/preview run on this origin would
 * otherwise serve cached `sections.json` and stale chunks cache-first, which is
 * invisible in the UI and looks like "the app is broken".
 */
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      const base = import.meta.env.BASE_URL ?? '/';
      navigator.serviceWorker.register(new URL(`${base}sw.js`, document.baseURI).href).catch(() => {});
    });
  } else {
    const PURGED = 'aiml:sw-purged';
    navigator.serviceWorker.getRegistrations().then(async (regs) => {
      if (!regs.length) return;
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      // Reload once so this page stops being controlled by the removed worker.
      if (navigator.serviceWorker.controller && !sessionStorage.getItem(PURGED)) {
        sessionStorage.setItem(PURGED, '1');
        location.reload();
      }
    }).catch(() => {});
  }
}
