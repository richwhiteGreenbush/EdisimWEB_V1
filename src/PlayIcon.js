import * as THREE from 'three';
import { PLAY_ICON_SIZE, PLAY_ICON_MARGIN } from './config.js';
import { recordHasProgram } from './ProgramManager.js';

const CLICK_MOVE_THRESHOLD = 6; // px -- beyond this, a mousedown->mouseup is a look-drag, not a click
const CLICK_TIME_THRESHOLD = 500; // ms

// Sprites always face the camera, which is exactly the "floating icon" behavior
// we want here -- no custom billboarding needed.
function buildIconTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fillStyle = '#2ecc71';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#1a7a44';
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(50, 38);
  ctx.lineTo(50, 90);
  ctx.lineTo(96, 64);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Shows a clickable "play" billboard above any placed object that has a saved
// program, so the user can (re)start its script on demand -- independent of the
// automatic resume that already happens when a world is loaded.
export class PlayIconManager {
  constructor({ scene, camera, domElement, registry, programManager, menu }) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.registry = registry;
    this.programManager = programManager;
    this.menu = menu;

    this.icons = new Map(); // id -> Sprite
    this.texture = buildIconTexture();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.downPos = null;
    this.downTime = 0;

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  // Call whenever a record's program may have changed (saved, cleared, loaded).
  refresh(id, record, object3D) {
    const hasProgram = recordHasProgram(record);
    const existing = this.icons.get(id);

    if (hasProgram && !existing) {
      const material = new THREE.SpriteMaterial({ map: this.texture, depthTest: false, transparent: true });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(PLAY_ICON_SIZE, PLAY_ICON_SIZE, 1);
      sprite.renderOrder = 999;
      sprite.userData.placedId = id;
      this.scene.add(sprite);
      this.icons.set(id, sprite);
      this.positionIcon(sprite, object3D);
    } else if (!hasProgram && existing) {
      this.removeIcon(id);
    } else if (hasProgram && existing) {
      this.positionIcon(existing, object3D);
    }
  }

  removeIcon(id) {
    const sprite = this.icons.get(id);
    if (!sprite) return;
    this.scene.remove(sprite);
    sprite.material.dispose();
    this.icons.delete(id);
  }

  clear() {
    for (const id of [...this.icons.keys()]) this.removeIcon(id);
  }

  positionIcon(sprite, object3D) {
    const box = new THREE.Box3().setFromObject(object3D);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    sprite.position.set(center.x, box.max.y + PLAY_ICON_MARGIN, center.z);
  }

  // Keeps icons following their object every frame, since a running program can
  // move/resize its own object (and Size/Move edits can too).
  tick() {
    if (!this.icons.size) return;
    for (const [id, sprite] of this.icons) {
      const item = this.registry.get(id);
      if (!item) {
        this.removeIcon(id);
        continue;
      }
      this.positionIcon(sprite, item.object3D);
    }
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
    if (!this.icons.size) return;
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // Sprite.raycast() reads modelViewMatrix, which three.js only refreshes as a
    // side effect of an actual renderer.render() call -- repositioning a sprite (or
    // moving the camera) via tick() does NOT update it. A click can land between
    // frames with no render in between, so it must be refreshed explicitly here or
    // the raycast can silently miss a sprite that's visually right under the cursor.
    this.camera.updateMatrixWorld();
    const icons = [...this.icons.values()];
    for (const icon of icons) {
      icon.updateMatrixWorld(true);
      icon.modelViewMatrix.multiplyMatrices(this.camera.matrixWorldInverse, icon.matrixWorld);
    }
    const hits = this.raycaster.intersectObjects(icons, false);
    if (!hits.length) return;

    const id = hits[0].object.userData.placedId;
    const item = this.registry.get(id);
    if (!recordHasProgram(item?.record)) return;

    this.programManager?.startFromRecord(id, item.record, item.object3D);
    this.menu?.toast('Running program.', { tone: 'success' });
  }
}
