import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// PWA: register the local service worker (no external requests).
// Production only — in the dev server a stale cache would shadow freshly
// re-optimized Vite deps and produce duplicate-React module graphs.
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL ?? '/';
    navigator.serviceWorker.register(new URL(`${base}sw.js`, document.baseURI).href).catch(() => {});
  });
}
