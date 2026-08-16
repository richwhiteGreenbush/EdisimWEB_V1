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

    // The top level reads in the order a student actually needs it: "Load World" (go
    // somewhere), "Create Model" (make something there), then Clear World and the VR
    // toggle. "Load Object" is no longer top-level -- it is a dropdown INSIDE Create
    // Model, because importing a model, drawing a balloon, dropping a light orb and
    // hanging a browser panel are all the same job as building a shape: putting a thing
    // of your own into the world.
    //
    // Two levels of group, therefore, tracked separately. `setGroupOpen` closes every
    // other top-level group so the panel never shows two trees at once; a NESTED group
    // must not take part in that, or opening it would close the parent it lives inside
    // and hide itself along with it.
    this.groups = [];
    this.nestedGroups = [];

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

    const loadObject = this._group(
      'Load Object',
      'Add something to the world in front of you',
      [this.importBtn, drawBtn, lightOrbBtn, webBrowserBtn],
      { nested: true }
    );

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

    // The four shapes come first because they are what this group is for; Load Object
    // follows as a dropdown of its own. Its toggle AND its panel are handed over as
    // ordinary children -- _group() appends whatever it is given and only tags the
    // buttons, which is what lets one group sit inside another with no other plumbing.
    const createModel = this._group(
      'Create Model',
      'Build your own model out of simple shapes, then render it into one object',
      [...shapeButtons, loadObject.toggle, loadObject.panel]
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

    // The .json file pair closes the group, save above load. They wear menu-subitem-alt,
    // which is a distinctly different COLOUR from the world buttons above them rather
    // than a quieter version of the same one -- these two are a different kind of action
    // entirely. Every button above replaces the world you are standing in; these move a
    // world between people, and one of them is the only button in this menu that does not
    // change what is on screen at all. Both halves have to be here — a student who can
    // only load a file can receive someone else's world but never send their own.
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

    // Load World first: it is the question a student answers before any other -- where am
    // I going to build this? Create Model second, carrying Load Object inside it. Then the
    // two whole-session actions. loadObject's own toggle and panel are NOT appended here;
    // they are already inside createModel's panel.
    this.panel.append(
      loadWorld.toggle,
      loadWorld.panel,
      createModel.toggle,
      createModel.panel,
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

  // A button that expands to reveal its own list of actions. The label is stored
  // separately from the button's text because the text carries the ▸/▾ marker and gets
  // rewritten every time the group opens or closes.
  //
  // `children` may hold another group's toggle and panel, which is how Load Object sits
  // inside Create Model. Only BUTTONS are tagged as sub-items: a nested group's panel is
  // a div, and giving it a button's styling would draw a box round the whole subtree.
  _group(label, title, children, { nested = false } = {}) {
    const toggle = this._button(`${label} ▸`, title);
    if (nested) toggle.classList.add('menu-subitem-group');

    const panel = document.createElement('div');
    panel.className = nested ? 'menu-submenu menu-submenu-nested' : 'menu-submenu';
    panel.hidden = true;
    for (const child of children) {
      if (child.tagName === 'BUTTON') child.classList.add('menu-subitem');
      panel.appendChild(child);
    }

    const group = { label, toggle, panel, nested };
    if (nested) {
      this.nestedGroups.push(group);
      toggle.addEventListener('click', () => this.setNestedOpen(group, panel.hidden));
    } else {
      this.groups.push(group);
      toggle.addEventListener('click', () => this.setGroupOpen(group, panel.hidden));
    }
    return group;
  }

  _paintToggle(group, isOpen) {
    group.panel.hidden = !isOpen;
    group.toggle.textContent = `${group.label} ${isOpen ? '▾' : '▸'}`;
    group.toggle.classList.toggle('menu-btn-open', isOpen);
  }

  // Opens `group` and closes every other one. Passing null (see closeGroups) closes
  // them all, since no group can match.
  //
  // Nested groups always collapse with it: whichever top-level tree is being shown, a
  // sub-dropdown left open inside a hidden one would spring back the next time its
  // parent opened, in a state the student did not leave it in.
  setGroupOpen(group, open) {
    for (const candidate of this.nestedGroups) this._paintToggle(candidate, false);
    for (const candidate of this.groups) this._paintToggle(candidate, open && candidate === group);
  }

  // The same one-at-a-time rule among nested groups, without touching their parent.
  setNestedOpen(group, open) {
    for (const candidate of this.nestedGroups) this._paintToggle(candidate, open && candidate === group);
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
