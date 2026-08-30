import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/theme.css';

// iOS Safari's soft keyboard shrinks the *visual* viewport but not the *layout*
// viewport, so the app's `height:100%` chain stays full-screen. When you focus an
// input near the bottom, the browser then scrolls the whole document up to reveal
// it — the top bar slides away and the layout "moves up". Pin the root to the
// visual-viewport height so the app always fits the area above the keyboard: the
// top bar stays put and only the scrollable content readjusts.
function fitVisualViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const h = `${Math.round(vv.height)}px`;
  document.documentElement.style.height = h;
  document.body.style.height = h;
}
window.visualViewport?.addEventListener('resize', fitVisualViewport);
window.visualViewport?.addEventListener('scroll', fitVisualViewport);
fitVisualViewport();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
