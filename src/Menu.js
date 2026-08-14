import { PRESET_WORLDS } from './WorldPresets.js';
import { PRIMITIVE_SHAPES, SHAPE_LABELS } from './Primitives.js';

export class Menu {
  constructor({
    onImportClick,
    onDrawClick,
    onLightOrbClick,
    onWebBrowserClick,
    onCreatePrimitiveClick,
    onClearClick,
    onSaveWorldClick,
    onLoadWorldClick,
    onLoadPresetClick,
    onVRClick,
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

    // The top level is three expanding groups plus Clear World: "Load Object" for the
    // things you put INTO a world, "Create Model" for building one out of shapes, and
    // "Load World" for the worlds themselves. All are built by _group(), and opening any
    // one closes the others, so the panel never shows two trees of options at once.
    this.groups = [];

    // Kept as a field: main.js flips it via setImportEnabled() while a load is running.
    this.importBtn = this._button(
      'Import',
      'Add a model (.gltf/.glb/.obj) or image (.png/.jpg/.gif) — or drag files anywhere onto the window'
    );
    this.importBtn.addEventListener('click', () => onImportClick?.());

    const drawBtn = this._button('Draw', 'Freehand-sketch a shape that inflates into a 3D balloon figure');
    drawBtn.addEventListener('click', () => onDrawClick?.());

    const lightOrbBtn = this._button('Light Orb', 'Place a glowing orb of light in front of you');
    lightOrbBtn.addEventListener('click', () => onLightOrbClick?.());

    const webBrowserBtn = this._button(
      'Web Browser',
      'Place a live, interactive web page in front of you — some sites block being embedded'
    );
    webBrowserBtn.addEventListener('click', () => onWebBrowserClick?.());

    const loadObject = this._group('Load Object', 'Add something to the world in front of you', [
      this.importBtn,
      drawBtn,
      lightOrbBtn,
      webBrowserBtn,
    ]);

    // Create Model: each button drops one construction piece in front of the student.
    // Built from PRIMITIVE_SHAPES so the shape list lives in exactly one place.
    const shapeButtons = PRIMITIVE_SHAPES.map((shape) => {
      const btn = this._button(
        SHAPE_LABELS[shape],
        `Add a ${SHAPE_LABELS[shape].toLowerCase()} to build with — click the hammer above it to change it`
      );
      btn.addEventListener('click', () => onCreatePrimitiveClick?.(shape));
      return btn;
    });

    const createModel = this._group(
      'Create Model',
      'Build your own model out of simple shapes, then render it into one object',
      shapeButtons
    );

    // The ready-made worlds are built from PRESET_WORLDS rather than hardcoded here, so
    // adding another world is a one-line change in WorldPresets.js and shows up in the
    // menu for free.
    //
    // A preset marked `hidden` is skipped. That is not a half-built world being kept back
    // -- it is a world whose only door is somewhere inside another world (1940's New York
    // hangs off the billboard behind the Library), and listing it here would give away the
    // one thing that makes finding it worth anything.
    const worldButtons = [];
    for (const [name, preset] of Object.entries(PRESET_WORLDS)) {
      if (preset.hidden) continue;
      const btn = this._button(preset.label, `${preset.hint} — replaces everything currently placed`);
      btn.addEventListener('click', () => {
        this.closeGroups();
        onLoadPresetClick?.(name);
      });
      worldButtons.push(btn);
    }

    // The .json file pair closes the group, save above load. They wear menu-subitem-alt
    // so they read as a different kind of action from the ready-made worlds above them:
    // those replace what you have, these two move a world between people. Both halves
    // have to be here — a student who can only load a file can receive someone else's
    // world but never send their own.
    const saveWorldBtn = this._button(
      'Save World',
      'Download this world as a file — keep it, or send it to someone else to open'
    );
    saveWorldBtn.classList.add('menu-subitem-alt');
    saveWorldBtn.addEventListener('click', () => {
      this.closeGroups();
      onSaveWorldClick?.();
    });
    worldButtons.push(saveWorldBtn);

    const loadWorldFileBtn = this._button(
      'Load World File',
      'Open a world file you saved earlier, or one someone sent you — this replaces everything currently placed'
    );
    loadWorldFileBtn.classList.add('menu-subitem-alt');
    loadWorldFileBtn.addEventListener('click', () => {
      this.closeGroups();
      onLoadWorldClick?.();
    });
    worldButtons.push(loadWorldFileBtn);

    const loadWorld = this._group(
      'Load World',
      'Load a ready-made world, save this one to a file, or open a world file',
      worldButtons
    );

    this.clearBtn = this._button('Clear World', 'Remove everything you have placed');
    this.clearBtn.addEventListener('click', () => onClearClick?.());

    this.vrBtn = this._button(
      'VR Headset View',
      'Split the screen into a left-eye and right-eye image for a VR headset — uses a connected headset if it finds one'
    );
    this.vrBtn.classList.add('menu-btn-vr');
    this.vrBtn.addEventListener('click', () => onVRClick?.());

    const hint = document.createElement('div');
    hint.className = 'menu-hint';
    hint.textContent = 'Arrow keys to walk & turn · drag to look';

    this.panel.append(
      loadObject.toggle,
      loadObject.panel,
      createModel.toggle,
      createModel.panel,
      loadWorld.toggle,
      loadWorld.panel,
      this.clearBtn,
      this.vrBtn,
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

  // A top-level button that expands to reveal its own list of actions. The label is
  // stored separately from the button's text because the text carries the ▸/▾ marker
  // and gets rewritten every time the group opens or closes.
  _group(label, title, buttons) {
    const toggle = this._button(`${label} ▸`, title);

    const panel = document.createElement('div');
    panel.className = 'menu-submenu';
    panel.hidden = true;
    for (const btn of buttons) {
      btn.classList.add('menu-subitem');
      panel.appendChild(btn);
    }

    const group = { label, toggle, panel };
    toggle.addEventListener('click', () => this.setGroupOpen(group, panel.hidden));
    this.groups.push(group);
    return group;
  }

  // Opens `group` and closes every other one. Passing null (see closeGroups) closes
  // them all, since no group can match.
  setGroupOpen(group, open) {
    for (const candidate of this.groups) {
      const isOpen = open && candidate === group;
      candidate.panel.hidden = !isOpen;
      candidate.toggle.textContent = `${candidate.label} ${isOpen ? '▾' : '▸'}`;
      candidate.toggle.classList.toggle('menu-btn-open', isOpen);
    }
  }

  closeGroups() {
    this.setGroupOpen(null, false);
  }

  setCollapsed(collapsed) {
    this.panel.hidden = collapsed;
    this.toggleBtn.textContent = collapsed ? '☰ Menu' : '✕ Close';
    this.root.classList.toggle('menu-collapsed', collapsed);
    if (collapsed) this.closeGroups();
  }

  toggle() {
    this.setCollapsed(!this.panel.hidden);
  }

  setImportEnabled(enabled) {
    this.importBtn.disabled = !enabled;
  }

  // The VR button doubles as the way back out, so its label has to track the state --
  // including when the headset itself ends the session, which never touches this menu.
  setVRActive(active) {
    this.vrBtn.textContent = active ? 'Exit VR Headset View' : 'VR Headset View';
    this.vrBtn.classList.toggle('menu-btn-open', active);
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
