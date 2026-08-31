import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/theme.css';

// In the Tauri desktop shell the window is transparent and the shell's own
// background is rounded at the bottom so the desktop shows through the corners,
// like a native app. A browser page fills its viewport squarely, so the
// `tauri-shell` class — and thus the rounded shell — is scoped to the desktop
// app only. Tauri v2 injects __TAURI_INTERNALS__ into the window before scripts run.
if ('__TAURI_INTERNALS__' in window) {
  document.documentElement.classList.add('tauri-shell');
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
