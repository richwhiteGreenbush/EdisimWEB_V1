const POLYHAVEN_URL = 'https://polyhaven.com';

export class Menu {
  constructor({ onImportClick, onDrawClick, onLightOrbClick, onWebBrowserClick, onClearClick, onSaveWorldClick, onLoadWorldClick }) {
    this.root = document.createElement('div');
    this.root.id = 'menu';

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.type = 'button';
    this.toggleBtn.id = 'menu-toggle';
    this.toggleBtn.className = 'menu-btn';
    this.toggleBtn.title = 'Menu';
    this.toggleBtn.addEventListener('click', () => this.toggle());

    this.panel = document.createElement('div');
    this.panel.id = 'menu-panel';
    this.panel.hidden = true;

    this.importBtn = this._button('Import', 'Add a model (.gltf/.glb/.obj) or image (.png/.jpg/.gif) — or drag files anywhere onto the window');
    this.importBtn.addEventListener('click', () => onImportClick?.());

    this.drawBtn = this._button('Draw', 'Freehand-sketch a shape that inflates into a 3D balloon figure');
    this.drawBtn.addEventListener('click', () => onDrawClick?.());

    this.lightOrbBtn = this._button('Light Orb', 'Place a glowing orb of light in front of you');
    this.lightOrbBtn.addEventListener('click', () => onLightOrbClick?.());

    this.webBrowserBtn = this._button(
      'Web Browser',
      'Place a live, interactive web page in front of you — some sites block being embedded'
    );
    this.webBrowserBtn.addEventListener('click', () => onWebBrowserClick?.());

    this.saveWorldBtn = this._button('Save World', 'Download the current world as a file you can load again later');
    this.saveWorldBtn.addEventListener('click', () => onSaveWorldClick?.());

    this.loadWorldBtn = this._button('Load World', 'Load a saved world file — this replaces everything currently placed');
    this.loadWorldBtn.addEventListener('click', () => onLoadWorldClick?.());

    this.clearBtn = this._button('Clear World', 'Remove everything you have placed');
    this.clearBtn.addEventListener('click', () => onClearClick?.());

    this.polyhavenLink = document.createElement('a');
    this.polyhavenLink.href = POLYHAVEN_URL;
    this.polyhavenLink.target = '_blank';
    this.polyhavenLink.rel = 'noopener noreferrer';
    this.polyhavenLink.className = 'menu-btn menu-link';
    this.polyhavenLink.textContent = 'Get free 3D models ↗';
    this.polyhavenLink.title = 'Free CC0 models, textures & HDRIs at polyhaven.com';

    const hint = document.createElement('div');
    hint.className = 'menu-hint';
    hint.textContent = 'Arrow keys to walk & turn · drag to look';

    this.panel.append(
      this.importBtn,
      this.drawBtn,
      this.lightOrbBtn,
      this.webBrowserBtn,
      this.saveWorldBtn,
      this.loadWorldBtn,
      this.clearBtn,
      this.polyhavenLink,
      hint
    );
    this.root.append(this.toggleBtn, this.panel);
    document.body.appendChild(this.root);

    this.toastHost = document.createElement('div');
    this.toastHost.id = 'toast-host';
    document.body.appendChild(this.toastHost);

    this.setCollapsed(true);
  }

  _button(label, title) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-btn';
    btn.textContent = label;
    if (title) btn.title = title;
    return btn;
  }

  setCollapsed(collapsed) {
    this.panel.hidden = collapsed;
    this.toggleBtn.textContent = collapsed ? '☰ Menu' : '✕ Close';
    this.root.classList.toggle('menu-collapsed', collapsed);
  }

  toggle() {
    this.setCollapsed(!this.panel.hidden);
  }

  setImportEnabled(enabled) {
    this.importBtn.disabled = !enabled;
  }

  toast(message, { tone = 'info', duration = 4000 } = {}) {
    const el = document.createElement('div');
    el.className = `toast toast-${tone}`;
    el.textContent = message;
    this.toastHost.appendChild(el);
    requestAnimationFrame(() => el.classList.add('toast-visible'));
    setTimeout(() => {
      el.classList.remove('toast-visible');
      setTimeout(() => el.remove(), 300);
    }, duration);
  }
}
