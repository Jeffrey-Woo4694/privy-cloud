import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/theme.css';

// iOS Safari's soft keyboard shrinks the *visual* viewport but not the *layout*
// viewport, so the app's `height:100%` chain stays full-height. The focused send
// box then falls under the keyboard and iOS scrolls the whole page up to reveal
// it — the top bar slides away. Pin the *body* to the visual-viewport height (and
// leave <html> alone — resizing the initial containing block is what broke the
// layout before) so the app reshapes to the area above the keyboard: the top bar
// stays put and the flex:1 history shrinks.
//
// Only the `resize` event is handled (not `scroll`): during the keyboard's opening
// animation iOS fires many scroll events, and resetting the page on each one makes
// the layout jitter. The resize event is the single "the keyboard is open" signal.
function fitVisualViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  document.body.style.height = `${Math.round(vv.height)}px`;
  window.scrollTo(0, 0); // undo any iOS auto-scroll toward the focused input
}
window.visualViewport?.addEventListener('resize', fitVisualViewport);
fitVisualViewport();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
