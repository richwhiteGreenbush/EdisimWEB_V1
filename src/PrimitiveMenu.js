import * as THREE from 'three';
import { loadImageElement } from './MediaLoader.js';
import {
  touchingPrimitives,
  renderModelFromCluster,
  removePrimitive,
  clusterIds,
  SHAPE_LABELS,
} from './Primitives.js';
import {
  PALETTE_SWATCHES,
  PRIMITIVE_DEFAULT_COLOR,
  IMAGE_MAX_BYTES,
  ROTATE_SNAP_DEGREES,
} from './config.js';

const TEXTURE_EXTENSIONS = ['png', 'jpg', 'jpeg'];

// The panel behind a construction piece's hammer icon. Structurally a sibling of
// ObjectMenu -- same floating panel, same screen-at-a-time navigation with a Back
// button, same synchronous edge clamp -- but a different set of actions, because a piece
// under construction is a part rather than a finished object.
export class PrimitiveMenu {
  constructor({ registry, menu, worldStore, buildGizmo }) {
    this.registry = registry;
    this.menu = menu;
    this.worldStore = worldStore;
    this.buildGizmo = buildGizmo;
    this.activeId = null;

    this.panel = document.createElement('div');
    this.panel.id = 'primitive-menu';
    this.panel.hidden = true;
    document.body.appendChild(this.panel);

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = TEXTURE_EXTENSIONS.map((ext) => `.${ext}`).join(',');
    this.fileInput.style.display = 'none';
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files[0];
      this.fileInput.value = '';
      if (file) this.applyImage(file);
    });
    document.body.appendChild(this.fileInput);

    this.onOutsideClick = (e) => {
      if (this.panel.hidden) return;
      if (this.panel.contains(e.target)) return;
      this.close();
    };
    window.addEventListener('pointerdown', this.onOutsideClick);
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
    // Measured and clamped synchronously: the content is already laid out by the time
    // this runs, so deferring to a rAF would only add a visible jump near a screen edge.
    this.panel.style.left = `${clientX}px`;
    this.panel.style.top = `${clientY}px`;
    const rect = this.panel.getBoundingClientRect();
    this.panel.style.left = `${Math.max(8, Math.min(clientX, window.innerWidth - rect.width - 8))}px`;
    this.panel.style.top = `${Math.max(8, Math.min(clientY, window.innerHeight - rect.height - 8))}px`;
  }

  button(label, onClick, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = extraClass ? `menu-btn ${extraClass}` : 'menu-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  title(text) {
    const el = document.createElement('div');
    el.className = 'om-title';
    el.textContent = text;
    this.panel.appendChild(el);
  }

  note(text) {
    const el = document.createElement('div');
    el.className = 'pm-note';
    el.textContent = text;
    this.panel.appendChild(el);
  }

  // Every screen re-fetches the piece rather than caching it: a Render Model or a Clear
  // World can take it out from under an open panel.
  activeItem() {
    const item = this.registry.get(this.activeId);
    if (!item) this.close();
    return item;
  }

  renderRoot() {
    this.panel.innerHTML = '';
    const item = this.activeItem();
    if (!item) return;

    this.title(`Build Piece · ${SHAPE_LABELS[item.record.shape] || 'Shape'}`);
    this.panel.appendChild(this.button('Apply Texture', () => this.renderTexture()));
    this.panel.appendChild(
      this.button('Stretch to Shape', () => {
        // The gizmo needs the screen to itself: its handles live exactly where this
        // panel would be floating.
        this.close();
        this.buildGizmo.activate(item.record.id, 'stretch');
        this.menu?.toast('Drag a corner to stretch. Drag the green ball to move the piece anywhere.');
      })
    );
    this.panel.appendChild(
      this.button('Rotate Shape', () => {
        this.close();
        this.buildGizmo.activate(item.record.id, 'rotate');
        this.menu?.toast(`Drag a coloured ring to turn the piece. It snaps every ${ROTATE_SNAP_DEGREES}°.`);
      })
    );
    this.panel.appendChild(this.button('Connect to Primitive', () => this.renderConnect()));
    this.panel.appendChild(this.button('Remove Shape', () => this.removeShape(), 'pm-remove'));
    this.panel.appendChild(this.button('Render Model', () => this.renderModel(), 'pm-render'));
    this.panel.appendChild(this.button('Close Menu', () => this.close(), 'om-close'));
  }

  // --- Apply Texture -------------------------------------------------------------

  renderTexture() {
    this.panel.innerHTML = '';
    const item = this.activeItem();
    if (!item) return;

    this.title('Apply Texture');

    const swatches = document.createElement('div');
    swatches.className = 'pm-swatches';
    // The build yellow first, then the app-wide palette -- the one shared colour list,
    // so a piece can be painted the same colours the Draw tool and the program blocks use.
    for (const hex of [PRIMITIVE_DEFAULT_COLOR, ...PALETTE_SWATCHES]) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'pm-swatch';
      swatch.style.background = hex;
      swatch.title = hex;
      if (!item.record.files?.length && item.record.color?.toLowerCase() === hex.toLowerCase()) {
        swatch.classList.add('pm-swatch-selected');
      }
      swatch.addEventListener('click', () => this.applyColor(hex));
      swatches.appendChild(swatch);
    }
    this.panel.appendChild(swatches);

    const wrap = document.createElement('label');
    wrap.className = 'om-field';
    const span = document.createElement('span');
    span.textContent = 'Any colour';
    const input = document.createElement('input');
    input.type = 'color';
    input.value = item.record.files?.length ? PRIMITIVE_DEFAULT_COLOR : item.record.color || PRIMITIVE_DEFAULT_COLOR;
    input.addEventListener('change', () => this.applyColor(input.value));
    wrap.append(span, input);
    this.panel.appendChild(wrap);

    this.panel.appendChild(this.button('Upload an Image…', () => this.fileInput.click()));
    this.note(
      item.record.files?.length
        ? `Wearing “${item.record.files[0].name}” — pick a colour to go back to plain.`
        : 'A picture wraps around the whole shape.'
    );

    this.panel.appendChild(this.button('Back', () => this.renderRoot(), 'om-back'));
  }

  // Colour and image are mutually exclusive: a material carrying both multiplies them,
  // so a "yellow" photo-textured cube would come out muddy and the student would have no
  // way to explain why. Applying either clears the other.
  applyColor(hex) {
    const item = this.activeItem();
    if (!item) return;
    const material = item.object3D.material;
    material.map?.dispose();
    material.map = null;
    material.color.set(hex);
    material.needsUpdate = true;

    item.record.color = hex;
    delete item.record.files;
    this.worldStore.saveObject(item.record);
    this.renderTexture();
  }

  async applyImage(file) {
    const item = this.activeItem();
    if (!item) return;

    const ext = file.name.split('.').pop().toLowerCase();
    if (!TEXTURE_EXTENSIONS.includes(ext)) {
      this.menu?.toast('Use a .png or .jpg image.', { tone: 'error' });
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      this.menu?.toast('That image is too big.', { tone: 'error' });
      return;
    }

    const url = URL.createObjectURL(file);
    let img;
    try {
      img = await loadImageElement(url);
    } catch {
      this.menu?.toast('Could not read that image.', { tone: 'error' });
      return;
    } finally {
      URL.revokeObjectURL(url);
    }

    // The piece can be gone by the time the decode finishes.
    const current = this.registry.get(item.record.id);
    if (!current) return;

    const texture = new THREE.Texture(img);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;

    const material = current.object3D.material;
    material.map?.dispose();
    material.map = texture;
    material.color.set('#ffffff'); // or the colour would tint the picture
    material.needsUpdate = true;

    current.record.files = [{ name: file.name, type: file.type, data: file }];
    current.record.color = '#ffffff';
    this.worldStore.saveObject(current.record);
    this.menu?.toast('Picture applied!', { tone: 'success' });
    if (!this.panel.hidden) this.renderTexture();
  }

  // --- Connect -------------------------------------------------------------------

  renderConnect() {
    this.panel.innerHTML = '';
    const item = this.activeItem();
    if (!item) return;

    this.title('Connect to Primitive');

    const touching = touchingPrimitives(this.activeId, this.registry);
    const already = new Set(item.record.connections || []);
    if (!touching.length) {
      this.note('Nothing is touching this piece yet. Use Stretch to Shape and drag the blue box until two pieces overlap, then come back.');
    } else {
      for (const entry of touching) {
        const label = SHAPE_LABELS[entry.record.shape] || 'Shape';
        const joined = already.has(entry.id) || (entry.record.connections || []).includes(this.activeId);
        const btn = this.button(joined ? `${label} ✓ joined` : `Join the ${label.toLowerCase()}`, () =>
          this.connectTo(entry.id)
        );
        btn.disabled = joined;
        this.panel.appendChild(btn);
      }
      const size = clusterIds(this.activeId, this.registry).length;
      this.note(
        size > 1
          ? `This model is ${size} pieces so far — Render Model will fuse them all.`
          : 'Joined pieces become one model when you press Render Model.'
      );
    }

    this.panel.appendChild(this.button('Back', () => this.renderRoot(), 'om-back'));
  }

  connectTo(otherId) {
    const item = this.activeItem();
    if (!item) return;
    const connections = new Set(item.record.connections || []);
    connections.add(otherId);
    item.record.connections = [...connections];
    this.worldStore.saveObject(item.record);
    this.menu?.toast('Pieces joined!', { tone: 'success' });
    this.renderConnect();
  }

  // --- Remove --------------------------------------------------------------------

  // Deliberately unconfirmed. A construction piece is two clicks from existing again,
  // nothing else in this app asks "are you sure", and a confirm step on the one button a
  // student presses when they have put a shape down by mistake would be in the way far
  // more often than it saved anybody.
  async removeShape() {
    const item = this.activeItem();
    if (!item) return;
    const id = item.record.id;
    const label = (SHAPE_LABELS[item.record.shape] || 'Shape').toLowerCase();

    this.close();
    // The gizmo holds this id and draws a box around a mesh that is about to be gone.
    if (this.buildGizmo?.activeId === id) this.buildGizmo.deactivate();

    try {
      await removePrimitive({ id, registry: this.registry, worldStore: this.worldStore });
      this.menu?.toast(`Removed the ${label}.`, { tone: 'success' });
    } catch (err) {
      console.error('Failed to remove a build piece:', err);
      this.menu?.toast('Could not remove that shape.', { tone: 'error' });
    }
  }

  // --- Render --------------------------------------------------------------------

  async renderModel() {
    const id = this.activeId;
    this.close();
    this.buildGizmo.deactivate();
    try {
      await renderModelFromCluster({ rootId: id, registry: this.registry, worldStore: this.worldStore, menu: this.menu });
    } catch (err) {
      console.error('Failed to render the model:', err);
      this.menu?.toast('Could not render that model.', { tone: 'error' });
    }
  }
}
