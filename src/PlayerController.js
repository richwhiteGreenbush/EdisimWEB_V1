import * as THREE from 'three';
import { MOVE_SPEED, TURN_SPEED, LOOK_SENSITIVITY, MAX_PITCH, EYE_HEIGHT, WORLD_BOUND_RADIUS } from './config.js';

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const DOWN = new THREE.Vector3(0, -1, 0);

// So arrow keys move a text cursor in the web browser panel's address bar (or any
// other text input) instead of also walking/turning the avatar underneath it.
function isEditableTarget(target) {
  if (!target) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

export class PlayerController {
  constructor(camera, domElement, ground) {
    this.camera = camera;
    this.domElement = domElement;
    this.ground = ground;

    this.yaw = 0;
    this.pitch = 0;

    this.keys = new Set();
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;

    this.raycaster = new THREE.Raycaster();
    this.rayOrigin = new THREE.Vector3();

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.domElement.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
  }

  onKeyDown(e) {
    if (isEditableTarget(e.target)) return;
    if (ARROW_KEYS.has(e.code) || ARROW_KEYS.has(e.key)) {
      e.preventDefault();
      this.keys.add(e.code || e.key);
    }
  }

  onKeyUp(e) {
    this.keys.delete(e.code || e.key);
  }

  onMouseDown(e) {
    if (e.button !== 0) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  onMouseMove(e) {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    this.yaw -= dx * LOOK_SENSITIVITY;
    this.pitch -= dy * LOOK_SENSITIVITY;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
  }

  onMouseUp(e) {
    if (e.button !== 0) return;
    this.dragging = false;
  }

  update(dt) {
    if (this.keys.has('ArrowLeft')) this.yaw += TURN_SPEED * dt;
    if (this.keys.has('ArrowRight')) this.yaw -= TURN_SPEED * dt;

    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    let moveZ = 0;
    if (this.keys.has('ArrowUp')) moveZ += 1;
    if (this.keys.has('ArrowDown')) moveZ -= 1;

    const pos = this.camera.position;

    if (moveZ !== 0) {
      const step = moveZ * MOVE_SPEED * dt;
      pos.x += -Math.sin(this.yaw) * step;
      pos.z += -Math.cos(this.yaw) * step;
    }

    const radius = Math.hypot(pos.x, pos.z);
    if (radius > WORLD_BOUND_RADIUS) {
      const scale = WORLD_BOUND_RADIUS / radius;
      pos.x *= scale;
      pos.z *= scale;
    }

    pos.y = this.groundHeightAt(pos.x, pos.z) + EYE_HEIGHT;
  }

  // Drops the player back at a world's intended starting point. Loading a preset world
  // replaces everything around them, so without this they can end up standing inside a
  // building (or a mile out on empty terrain) the instant a new world appears.
  resetTo({ x = 0, z = 6, yaw = 0, pitch = 0 } = {}) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.keys.clear();
    this.camera.position.set(x, this.groundHeightAt(x, z) + EYE_HEIGHT, z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  groundHeightAt(x, z) {
    if (!this.ground) return 0;
    this.rayOrigin.set(x, 50, z);
    this.raycaster.set(this.rayOrigin, DOWN);
    const hits = this.raycaster.intersectObject(this.ground);
    return hits.length > 0 ? hits[0].point.y : 0;
  }
}
