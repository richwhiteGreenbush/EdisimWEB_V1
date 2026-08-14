import * as THREE from 'three';
import { HAMMER_ICON_SIZE, HAMMER_ICON_MARGIN } from './config.js';

const CLICK_MOVE_THRESHOLD = 6; // px
const CLICK_TIME_THRESHOLD = 500; // ms

// An amber hammer badge. Same canvas-drawn recipe as PlayIcon's green play and the web
// browser panel's blue pencil, with its own colour and glyph so the three floating icons
// are never mistaken for one another: green ▶ runs a program, blue ✎ edits a panel,
// amber 🔨 builds a shape.
function buildHammerIconTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fillStyle = '#f2a541';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#9a6212';
  ctx.stroke();

  ctx.save();
  ctx.translate(64, 64);
  ctx.rotate(-Math.PI / 5);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-5, -12, 10, 44); // handle, hanging below the head
  ctx.beginPath();
  ctx.roundRect(-28, -30, 56, 20, 5); // head
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-28, -30);
  ctx.lineTo(-40, -24);
  ctx.lineTo(-40, -16);
  ctx.lineTo(-28, -10);
  ctx.closePath();
  ctx.fill(); // claw end
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// The floating hammer over every construction piece. Clicking one opens PrimitiveMenu.
//
// Icons are SELF-SYNCED from the registry every frame rather than pushed at from
// WorldStore/clear paths the way play icons are. Whether a piece has a hammer is a pure
// function of "is there a live record of kind 'primitive' with this id" -- unlike a play
// icon, which tracks a program being written or cleared -- so deriving it each tick means
// there is no refresh() call for a future bulk-removal path to forget, and no way to
// leak an icon for an object that is already gone.
export class ConstructionManager {
  constructor({ scene, camera, canvas, registry, onHammerClick }) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.registry = registry;
    this.onHammerClick = onHammerClick;

    this.texture = buildHammerIconTexture();
    this.icons = new Map(); // id -> Sprite
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.downPos = null;
    this.downTime = 0;

    this.onPointerDown = (e) => {
      if (e.button !== 0) return;
      this.downPos = { x: e.clientX, y: e.clientY };
      this.downTime = performance.now();
    };
    this.onPointerUp = (e) => this.tryPick(e);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  addIcon(id) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.texture, depthTest: false, transparent: true })
    );
    sprite.scale.set(HAMMER_ICON_SIZE, HAMMER_ICON_SIZE, 1);
    sprite.renderOrder = 999;
    sprite.userData.placedId = id;
    this.scene.add(sprite);
    this.icons.set(id, sprite);
    return sprite;
  }

  removeIcon(id) {
    const sprite = this.icons.get(id);
    if (!sprite) return;
    this.scene.remove(sprite);
    // The material is this sprite's own; the texture behind it is shared by every icon
    // and outlives them all, so it is deliberately never disposed here.
    sprite.material.dispose();
    this.icons.delete(id);
  }

  // Recomputed from a fresh Box3 every frame, so an icon follows a piece that is being
  // stretched or dragged rather than lagging behind it.
  positionIcon(sprite, object3D) {
    const box = new THREE.Box3().setFromObject(object3D);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    sprite.position.set(center.x, box.max.y + HAMMER_ICON_MARGIN, center.z);
  }

  tick() {
    const live = new Set();
    for (const [id, item] of this.registry.items) {
      if (item.record?.kind !== 'primitive') continue;
      live.add(id);
      this.positionIcon(this.icons.get(id) || this.addIcon(id), item.object3D);
    }
    for (const id of [...this.icons.keys()]) {
      if (!live.has(id)) this.removeIcon(id);
    }
  }

  clear() {
    for (const id of [...this.icons.keys()]) this.removeIcon(id);
  }

  tryPick(e) {
    if (e.button !== 0 || !this.downPos) return;
    const dx = e.clientX - this.downPos.x;
    const dy = e.clientY - this.downPos.y;
    const dist = Math.hypot(dx, dy);
    const dt = performance.now() - this.downTime;
    this.downPos = null;
    if (dist > CLICK_MOVE_THRESHOLD || dt > CLICK_TIME_THRESHOLD) return; // was a look-drag
    if (e.target !== this.canvas) return; // click landed on UI, not the world
    if (!this.icons.size) return;

    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // Sprite.raycast() reads modelViewMatrix, which three.js only refreshes as a side
    // effect of an actual renderer.render() call -- repositioning a sprite in tick() does
    // NOT update it. A click is an async DOM event that can land between frames with no
    // render in between, so refresh it here or the raycast silently misses a sprite
    // sitting right under the cursor.
    this.camera.updateMatrixWorld();
    const icons = [...this.icons.values()];
    for (const icon of icons) {
      icon.updateMatrixWorld(true);
      icon.modelViewMatrix.multiplyMatrices(this.camera.matrixWorldInverse, icon.matrixWorld);
    }
    const hits = this.raycaster.intersectObjects(icons, false);
    if (!hits.length) return;

    // PlayIconManager and ObjectMenu both register their own pointerdown/pointerup pair
    // on this same canvas/window AFTER this manager, so they run later in this very
    // dispatch. ObjectMenu's would raycast the same click, find nothing where the icon
    // floats in empty space above the piece, and close() the panel this handler is about
    // to open. Stopping propagation on a confirmed hit -- and only then -- keeps every
    // other click (ground, objects, misses) reaching them exactly as before.
    e.stopImmediatePropagation?.();

    const id = hits[0].object.userData.placedId;
    this.onHammerClick?.(id, e.clientX, e.clientY);
  }
}
