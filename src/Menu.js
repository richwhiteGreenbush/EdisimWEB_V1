import { PRESET_WORLDS } from './WorldPresets.js';

const POLYHAVEN_URL = 'https://polyhaven.com';

export class Menu {
  constructor({
    onImportClick,
    onDrawClick,
    onLightOrbClick,
    onWebBrowserClick,
    onClearClick,
    onSaveWorldClick,
    onLoadWorldClick,
    onLoadPresetClick,
  }) {
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

    // Load World opens a submenu of the ready-made worlds, with loading a saved .json
    // file kept as the last entry so the existing save/load round trip still has a
    // home. Built from PRESET_WORLDS rather than hardcoded here, so adding another
    // world is a one-line change in WorldPresets.js and shows up in the menu for free.
    this.loadWorldBtn = this._button('Load World ▸', 'Load one of the ready-made worlds, or a world file you saved earlier');
    this.loadWorldBtn.addEventListener('click', () => this.toggleLoadMenu());

    this.loadWorldSubmenu = document.createElement('div');
    this.loadWorldSubmenu.className = 'menu-submenu';
    this.loadWorldSubmenu.hidden = true;

    for (const [name, preset] of Object.entries(PRESET_WORLDS)) {
      const btn = this._button(preset.label, `${preset.hint} — replaces everything currently placed`);
      btn.classList.add('menu-subitem');
      btn.addEventListener('click', () => {
        this.setLoadMenuOpen(false);
        onLoadPresetClick?.(name);
      });
      this.loadWorldSubmenu.appendChild(btn);
    }

    const fromFileBtn = this._button('From a file…', 'Load a world you saved earlier — this replaces everything currently placed');
    fromFileBtn.classList.add('menu-subitem', 'menu-subitem-alt');
    fromFileBtn.addEventListener('click', () => {
      this.setLoadMenuOpen(false);
      onLoadWorldClick?.();
    });
    this.loadWorldSubmenu.appendChild(fromFileBtn);

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
      this.loadWorldSubmenu,
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
    if (collapsed) this.setLoadMenuOpen(false);
  }

  setLoadMenuOpen(open) {
    this.loadWorldSubmenu.hidden = !open;
    this.loadWorldBtn.textContent = open ? 'Load World ▾' : 'Load World ▸';
    this.loadWorldBtn.classList.toggle('menu-btn-open', open);
  }

  toggleLoadMenu() {
    this.setLoadMenuOpen(this.loadWorldSubmenu.hidden);
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
