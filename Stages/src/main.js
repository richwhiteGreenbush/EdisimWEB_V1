// Edusim Stages: make games, stories and animations with blocks.
//
// A sibling of the main Edusim app, served at /stages/ (see edusim-stage-plan.md at the repo root
// and Stages/CLAUDE.md). Nothing here is shared with the main app's world, its database or its
// saved work.
import './styles.css';
import { App } from './ui/App.js';

const app = new App(document.getElementById('app'));
app.boot().catch((err) => {
  console.error(err);
  document.getElementById('app').insertAdjacentHTML('beforeend', `<p class="boot-error">Edusim Stages could not start: ${String(err.message || err)}</p>`);
});

if (import.meta.env.DEV) window.__stages = app;

// Offline: once Stages has loaded, a service worker keeps a copy so it opens without a network.
if ('serviceWorker' in navigator && !import.meta.env.DEV && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
