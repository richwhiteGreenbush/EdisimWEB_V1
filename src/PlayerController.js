import * as THREE from 'three';
import {
  MOVE_SPEED,
  TURN_SPEED,
  LOOK_SENSITIVITY,
  TOUCH_LOOK_SENSITIVITY,
  MAX_PITCH,
  EYE_HEIGHT,
  WORLD_BOUND_RADIUS,
} from './config.js';

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

    // HOW TALL THE STUDENT IS, in feet, at runtime.
    //
    // The CONSTANT EYE_HEIGHT must not move -- it is the calibration point every prop in
    // this project is sized against, and MODEL_TARGET_HEIGHT sits beside it. This is a
    // separate, per-session value that defaults to it, so that setting yourself four
    // inches tall re-opens all forty-one worlds as somewhere nobody has been without
    // changing what a foot means anywhere else.
    //
    // A Bug's Life is the case that earns it: that whole world is already built at sixty
    // times life size, and the joke has never once completed because the student arrives
    // at normal height.
    this.eyeHeight = EYE_HEIGHT;

    this.keys = new Set();

    // The one pointer currently dragging the view -- a mouse button or a finger. Held
    // by id rather than as a boolean so a second finger (on the D-pad, or a pinch)
    // can never hijack or end a look that another finger started.
    this.lookPointerId = null;
    this.lookSensitivity = LOOK_SENSITIVITY;
    this.lastX = 0;
    this.lastY = 0;

    // Analog walking, -1..1 on each axis, fed in every frame by whoever owns an
    // analog stick (today: VRView, from the headset controllers' thumbsticks).
    // Movement itself stays here so the terrain follow and the world-bound clamp
    // below apply to it exactly as they do to the arrow keys.
    this.analogForward = 0;
    this.analogStrafe = 0;

    this.raycaster = new THREE.Raycaster();
    this.rayOrigin = new THREE.Vector3();

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    // Pointer Events, not mouse events: a browser only synthesises compatibility
    // mouse events for a TAP, never for a drag, so a mousemove-based look simply did
    // not exist on a phone or tablet. One handler set now covers mouse, finger and
    // stylus, which also matches how every other custom drag in this app is built.
    // #scene sets `touch-action: none` so the browser hands us the whole gesture
    // instead of claiming it part-way through as a scroll or a zoom.
    this.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
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

  onPointerDown(e) {
    if (e.button !== 0) return; // right/middle mouse buttons are not look-drags
    if (this.lookPointerId !== null) return; // already looking with another pointer
    this.lookPointerId = e.pointerId;
    // A phone screen is a few hundred pixels across, so the same radians-per-pixel
    // that feels right for a mouse on a desktop display makes a finger swipe barely
    // turn the head at all.
    this.lookSensitivity = e.pointerType === 'mouse' ? LOOK_SENSITIVITY : TOUCH_LOOK_SENSITIVITY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  onPointerMove(e) {
    if (e.pointerId !== this.lookPointerId) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    this.yaw -= dx * this.lookSensitivity;
    this.pitch -= dy * this.lookSensitivity;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
  }

  // Also the pointercancel handler: the browser takes a touch away (a system gesture,
  // a call coming in) without ever sending pointerup, and a look left stuck to a
  // finger that no longer exists would follow the next unrelated pointermove.
  onPointerUp(e) {
    if (e.pointerId !== this.lookPointerId) return;
    this.lookPointerId = null;
  }

  // Analog walk input in the range -1..1: +forward walks the way the player faces,
  // +strafe steps to their right. Applied on the next update() and additive with the
  // arrow keys, so a thumbstick and the keyboard can't fight over the same frame.
  setAnalogMove(forward = 0, strafe = 0) {
    this.analogForward = forward;
    this.analogStrafe = strafe;
  }

  update(dt) {
    if (this.keys.has('ArrowLeft')) this.yaw += TURN_SPEED * dt;
    if (this.keys.has('ArrowRight')) this.yaw -= TURN_SPEED * dt;

    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    let moveZ = this.analogForward;
    let moveX = this.analogStrafe;
    if (this.keys.has('ArrowUp')) moveZ += 1;
    if (this.keys.has('ArrowDown')) moveZ -= 1;

    const pos = this.camera.position;

    const drive = Math.hypot(moveZ, moveX);
    if (drive > 0) {
      // Clamp rather than normalize: a stick held half over is meant to walk at half
      // speed, but a stick pushed diagonally while ArrowUp is also down must not add
      // up to faster than MOVE_SPEED.
      if (drive > 1) {
        moveZ /= drive;
        moveX /= drive;
      }
      const step = MOVE_SPEED * dt * (this.moveScale ?? 1);
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // Facing is (-sin, -cos); the player's right is that turned 90deg: (cos, -sin).
      pos.x += (-sin * moveZ + cos * moveX) * step;
      pos.z += (-cos * moveZ - sin * moveX) * step;
    }

    const radius = Math.hypot(pos.x, pos.z);
    if (radius > WORLD_BOUND_RADIUS) {
      const scale = WORLD_BOUND_RADIUS / radius;
      pos.x *= scale;
      pos.z *= scale;
    }

    pos.y = this.groundHeightAt(pos.x, pos.z) + this.eyeHeight;
  }

  // Scaled walking, and a near plane that suits the size.
  //
  // The step has to scale or an ant crosses the Park in the time a person crosses a room,
  // which does not read as being small -- it reads as the world having shrunk. The near
  // plane has to drop for the opposite reason: at 0.1 a two-inch student standing next to
  // a grass blade has the blade clipped away in front of their face.
  setEyeHeight(feet) {
    const next = Math.max(0.15, Math.min(60, Number(feet) || EYE_HEIGHT));
    this.eyeHeight = next;
    const ratio = next / EYE_HEIGHT;
    this.moveScale = Math.max(0.06, Math.min(6, ratio));
    this.camera.near = THREE.MathUtils.clamp(0.1 * ratio, 0.01, 0.5);
    this.camera.updateProjectionMatrix();
    // Re-seat immediately, or the student stays at their old height until they next walk.
    const pos = this.camera.position;
    pos.y = this.groundHeightAt(pos.x, pos.z) + this.eyeHeight;
  }

  // Drops the player back at a world's intended starting point. Loading a preset world
  // replaces everything around them, so without this they can end up standing inside a
  // building (or a mile out on empty terrain) the instant a new world appears.
  resetTo({ x = 0, z = 6, yaw = 0, pitch = 0 } = {}) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.keys.clear();
    this.setAnalogMove(0, 0);
    this.camera.position.set(x, this.groundHeightAt(x, z) + this.eyeHeight, z);
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
