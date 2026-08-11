import * as THREE from 'three';
import { scaleToHeight } from './ModelLoader.js';
import { applyColorTint } from './ColorTint.js';
import { MODEL_TARGET_HEIGHT, PALETTE_SWATCHES } from './config.js';

const CLICK_MOVE_THRESHOLD = 6; // px -- beyond this, a mousedown->mouseup is a look-drag, not a click
const CLICK_TIME_THRESHOLD = 500; // ms

export class ObjectMenu {
  constructor({ scene, camera, domElement, registry, menu, worldStore, programEditor }) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.registry = registry;
    this.menu = menu;
    this.worldStore = worldStore;
    this.programEditor = programEditor;

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
    const pickable = this.registry.getRootObjects().filter((obj) => !obj.userData.isWebBrowser);
    const hits = this.raycaster.intersectObjects(pickable, true);
    if (!hits.length) {
      this.close();
      return;
    }

    const id = this.registry.resolveRoot(hits[0].object);
    if (!id) {
      this.close();
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

  numberField(labelText, defaultValue) {
    const wrap = document.createElement('label');
    wrap.className = 'om-field';
    const span = document.createElement('span');
    span.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(defaultValue);
    wrap.append(span, input);
    return { wrap, input };
  }

  renderRoot() {
    this.panel.innerHTML = '';
    const item = this.registry.get(this.activeId);
    const title = document.createElement('div');
    title.className = 'om-title';
    title.textContent = 'Object';
    this.panel.appendChild(title);
    this.panel.appendChild(this.button('Size', () => this.renderSize()));
    this.panel.appendChild(this.button('Move', () => this.renderMove()));
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

  renderSize() {
    this.panel.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'om-title';
    title.textContent = 'Size';
    this.panel.appendChild(title);

    const { wrap, input } = this.numberField('Resize to (%)', 100);
    this.panel.appendChild(wrap);

    const row = document.createElement('div');
    row.className = 'om-row';
    row.appendChild(this.button('Apply', () => this.applySizePercent(Number(input.value))));
    row.appendChild(this.button('Reset to 5ft tall', () => this.resetToTargetHeight()));
    this.panel.appendChild(row);

    this.panel.appendChild(this.button('Back', () => this.renderRoot(), 'om-back'));
  }

  renderMove() {
    this.panel.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'om-title';
    title.textContent = 'Move (relative to you)';
    this.panel.appendChild(title);

    const back = this.numberField('Backward (ft)', 0);
    const up = this.numberField('Up (ft)', 0);
    this.panel.appendChild(back.wrap);
    this.panel.appendChild(up.wrap);

    const row = document.createElement('div');
    row.className = 'om-row';
    row.appendChild(this.button('Apply', () => this.applyMove(Number(back.input.value), Number(up.input.value))));
    this.panel.appendChild(row);

    this.panel.appendChild(this.button('Back', () => this.renderRoot(), 'om-back'));
  }

  persistTransform(id) {
    const item = this.registry.get(id);
    if (!item?.record) return;
    item.record.transform = {
      position: item.object3D.position.toArray(),
      rotation: [item.object3D.rotation.x, item.object3D.rotation.y, item.object3D.rotation.z],
      scale: item.object3D.scale.toArray(),
    };
    this.worldStore?.saveObject(item.record);
  }

  applySizePercent(percent) {
    const item = this.registry.get(this.activeId);
    if (!item) return this.close();
    if (!Number.isFinite(percent) || percent <= 0) {
      this.menu?.toast('Enter a size percentage greater than 0.', { tone: 'error' });
      return;
    }
    item.object3D.scale.multiplyScalar(percent / 100);
    this.persistTransform(this.activeId);
    this.menu?.toast(`Resized to ${percent}% of its previous size.`, { tone: 'success' });
    this.close();
  }

  resetToTargetHeight() {
    const item = this.registry.get(this.activeId);
    if (!item) return this.close();
    scaleToHeight(item.object3D, MODEL_TARGET_HEIGHT);
    this.persistTransform(this.activeId);
    this.menu?.toast(`Reset to ${MODEL_TARGET_HEIGHT}ft tall.`, { tone: 'success' });
    this.close();
  }

  applyMove(backFt, upFt) {
    const item = this.registry.get(this.activeId);
    if (!item) return this.close();
    if (!Number.isFinite(backFt) || !Number.isFinite(upFt)) {
      this.menu?.toast('Enter valid numbers for move distance.', { tone: 'error' });
      return;
    }

    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() > 1e-6) dir.normalize();
    else dir.set(0, 0, -1);

    item.object3D.position.x += dir.x * backFt;
    item.object3D.position.z += dir.z * backFt;
    item.object3D.position.y += upFt;
    this.persistTransform(this.activeId);
    this.menu?.toast(`Moved ${backFt}ft back and ${upFt}ft up.`, { tone: 'success' });
    this.close();
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
