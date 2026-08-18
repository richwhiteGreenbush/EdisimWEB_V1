import * as THREE from 'three';
import { applyColorTint } from './ColorTint.js';
import { PALETTE_SWATCHES } from './config.js';

const CLICK_MOVE_THRESHOLD = 6; // px -- beyond this, a mousedown->mouseup is a look-drag, not a click
const CLICK_TIME_THRESHOLD = 500; // ms

export class ObjectMenu {
  constructor({ scene, camera, domElement, registry, menu, worldStore, programEditor, onPortalClick }) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.registry = registry;
    this.menu = menu;
    this.worldStore = worldStore;
    this.programEditor = programEditor;
    this.onPortalClick = onPortalClick;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.downPos = null;
    this.downTime = 0;
    this.activeId = null;

    this.panel = document.createElement('div');
    this.panel.id = 'object-menu';
    this.panel.hidden = true;
    document.body.appendChild(this.panel);

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onOutsideClick = this.onOutsideClick.bind(this);

    this.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointerdown', this.onOutsideClick);
  }

  onOutsideClick(e) {
    if (this.panel.hidden) return;
    if (this.panel.contains(e.target)) return;
    this.close();
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    this.downPos = { x: e.clientX, y: e.clientY };
    this.downTime = performance.now();
  }

  onPointerUp(e) {
    if (e.button !== 0 || !this.downPos) return;
    const dx = e.clientX - this.downPos.x;
    const dy = e.clientY - this.downPos.y;
    const dist = Math.hypot(dx, dy);
    const dt = performance.now() - this.downTime;
    this.downPos = null;
    if (dist > CLICK_MOVE_THRESHOLD || dt > CLICK_TIME_THRESHOLD) return; // was a look-drag, not a click
    if (e.target !== this.domElement) return; // click landed on UI, not the world

    this.tryPick(e.clientX, e.clientY);
  }

  // True when the nearest thing under the pointer is a web browser panel's bezel. The
  // flag lives on the bezel mesh, which is the registered root, so resolveRoot gets there
  // from any descendant.
  isBehindPanel(hitObject) {
    const id = this.registry.resolveRoot(hitObject);
    return !!(id && this.registry.get(id)?.object3D?.userData?.isWebBrowser);
  }

  tryPick(clientX, clientY) {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // Web browser panels are deliberately excluded here -- they're reachable only
    // through their own dedicated floating edit icon (see WebBrowserPanel.js), never
    // through a raycast click on the panel itself. That's not just a UX choice: the
    // CSS3D iframe layer sits on top of and normally consumes every click before it
    // ever reaches the canvas, but relying solely on that DOM-layer occlusion would
    // make "click the browser" -> "open the object menu" one real-browser rendering
    // quirk away from misfiring (iframes are notorious for inconsistent hit-testing
    // under CSS 3D transforms). Excluding the bezel from the pickable set here means
    // a stray hit can never open the menu, regardless of what the DOM layer does.
    //
    // Create Model's construction pieces are excluded for a related reason: until the
    // student renders them into a finished model they are parts, not objects, and this
    // menu's Program action applies to whole objects. They are reachable only through
    // their own floating hammer icon (ConstructionManager) -- and once rendered, the
    // model that replaces them carries no such flag and picks up normally.
    //
    // A PANEL IS OPAQUE TO CLICKS, which is why it is left IN the pickable set and
    // rejected after the fact rather than filtered out before the raycast. Filtered out,
    // the ray does not stop at the panel -- it carries straight on and returns whatever
    // is BEHIND it, so a click on a video's play button that reached the canvas opened
    // Size/Move/Program on the workbench standing behind the screen. That reads as the
    // panel itself having opened a menu, and it is worse than the bug the filter was
    // added to prevent. A panel hides what is behind it, so a click on one selects
    // nothing at all.
    const pickable = this.registry.getRootObjects().filter((obj) => !obj.userData.isConstruction);
    const hits = this.raycaster.intersectObjects(pickable, true);
    if (!hits.length) {
      this.close();
      return;
    }
    if (this.isBehindPanel(hits[0].object)) {
      this.close();
      return;
    }

    const id = this.registry.resolveRoot(hits[0].object);
    if (!id) {
      this.close();
      return;
    }

    // A world portal is a DOOR, not an object: clicking it travels to the world it names
    // rather than opening Size/Move/Program on the signboard.
    //
    // The flag is read off the live object3D, which CommonProps.worldPortal() stamps when
    // it builds -- not off the record. That keeps the whole thing free of per-kind code:
    // a portal is an ordinary `preset-prop` record everywhere else in the app, so it
    // saves, exports to a world file, rehydrates and duplicates with nothing added, and
    // the flag comes back on every rebuild because the builder always sets it.
    //
    // The cost is that a portal cannot be resized, moved or programmed, since this is the
    // only path to that panel for a prop. That is the right trade for a door.
    const portalWorld = this.registry.get(id)?.object3D?.userData?.portalWorld;
    if (portalWorld) {
      this.close();
      this.onPortalClick?.(portalWorld);
      return;
    }

    this.open(id, clientX, clientY);
  }

  open(id, clientX, clientY) {
    this.activeId = id;
    this.panel.hidden = false;
    this.renderRoot();
    this.positionAt(clientX, clientY);
  }

  close() {
    this.panel.hidden = true;
    this.panel.innerHTML = '';
    this.activeId = null;
  }

  positionAt(clientX, clientY) {
    // Panel content is already rendered and unhidden by the time this runs, so
    // getBoundingClientRect() reflects final layout immediately -- clamping
    // synchronously (instead of deferring to a rAF) avoids a one-frame flash/jump
    // when opening near a screen edge.
    this.panel.style.left = `${clientX}px`;
    this.panel.style.top = `${clientY}px`;
    const rect = this.panel.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    this.panel.style.left = `${Math.max(8, Math.min(clientX, maxX))}px`;
    this.panel.style.top = `${Math.max(8, Math.min(clientY, maxY))}px`;
  }

  button(label, onClick, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = extraClass ? `menu-btn ${extraClass}` : 'menu-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  renderRoot() {
    this.panel.innerHTML = '';
    const item = this.registry.get(this.activeId);
    const title = document.createElement('div');
    title.className = 'om-title';
    title.textContent = 'Object';
    this.panel.appendChild(title);
    // Size and Move are deliberately NOT here any more.
    //
    // They were the two actions that changed an object by typing a number into a form,
    // and both are now things you write instead: `set size to`, `change size by`, `move
    // forward`, `glide` and `go back to start`. Keeping a second, hidden way to do the
    // same jobs meant a student could resize something and then be unable to explain how,
    // and it made the programming tool look like the long way round rather than the point.
    if (item?.record?.kind === 'light-orb') {
      this.panel.appendChild(this.button('Color', () => this.renderColor()));
    }
    this.panel.appendChild(this.button('Program', () => this.openProgramEditor()));
    this.panel.appendChild(this.button('Close', () => this.close(), 'om-close'));
  }

  renderColor() {
    this.panel.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'om-title';
    title.textContent = 'Glow Color';
    this.panel.appendChild(title);

    const item = this.registry.get(this.activeId);
    const wrap = document.createElement('label');
    wrap.className = 'om-field';
    const span = document.createElement('span');
    span.textContent = 'Color';
    const input = document.createElement('input');
    input.type = 'color';
    input.value = item?.record?.color || PALETTE_SWATCHES[0];
    wrap.append(span, input);
    this.panel.appendChild(wrap);

    const row = document.createElement('div');
    row.className = 'om-row';
    row.appendChild(this.button('Apply', () => this.applyColor(input.value)));
    this.panel.appendChild(row);

    this.panel.appendChild(this.button('Back', () => this.renderRoot(), 'om-back'));
  }


  applyColor(hex) {
    const item = this.registry.get(this.activeId);
    if (!item) return this.close();
    item.record.color = hex;
    applyColorTint(item.object3D, hex);
    this.worldStore?.saveObject(item.record);
    this.menu?.toast('Glow color updated.', { tone: 'success' });
    this.close();
  }

  openProgramEditor() {
    if (!this.programEditor) {
      this.menu?.toast('Programming objects is coming in a future update.');
      this.close();
      return;
    }
    const id = this.activeId;
    this.close();
    this.programEditor.open(id);
  }
}
