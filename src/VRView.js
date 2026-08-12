import * as THREE from 'three';
import { StereoEffect } from 'three/examples/jsm/effects/StereoEffect.js';
import { EYE_HEIGHT } from './config.js';

// Menu ▸ VR Headset View. Two very different paths behind one button:
//
//   'xr'     — a real WebXR immersive session. This is the good one: the headset does
//              its own per-eye projection, its own lens distortion and its own 6DoF
//              head tracking at the display's refresh rate. Used whenever the browser
//              reports an immersive-vr device (a Quest browsing to the page, a tethered
//              headset on a desktop browser with WebXR).
//   'stereo' — a fullscreen side-by-side left/right image via three's StereoEffect,
//              plus device-orientation head-look. This is what a phone dropped into a
//              Cardboard-style holder needs, and it is also the only way a student on a
//              plain laptop can see what the stereo view even is.
//
// ArrayCamera was the third option considered and is not used directly: WebXRManager
// already builds and drives an ArrayCamera internally for the XR path, so reaching for
// one by hand would mean reimplementing the pose plumbing that comes free with
// renderer.xr, and it would do nothing at all for the phone-in-a-holder case.

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

// **One world unit in this app is one FOOT** (config.js). WebXR reference spaces and
// THREE.StereoCamera both work in METRES, so every length crossing that boundary has to
// be converted. Miss it and a 13ft T. rex is handed to the headset as 13 metres, and
// the whole world renders 3.28x oversized around a giant player.
const FEET_PER_METRE = 3.280839895;

// A real adult interpupillary distance is about 64mm. StereoCamera's default eyeSep is
// 0.064 because it assumes metres; in feet that is two thirds of an INCH between the
// eyes, which flattens the stereo effect to almost nothing.
const EYE_SEPARATION = 0.064 * FEET_PER_METRE;

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

// The trigger is this app's left mouse button: hold it and swing the controller, and
// the view turns the way the controller swung, exactly as a left-drag does on a
// desktop. 1 means the turn matches the swing degree for degree, which is what makes
// it feel like dragging something rather than nudging a rate control.
const VR_LOOK_GAIN = 1;

// Thumbsticks rest a little off centre and drift as they wear, so a raw axis reading
// is never reliably zero -- without a deadzone the player slowly slides across the
// world with nobody touching anything.
const STICK_DEADZONE = 0.18;

const TWO_PI = Math.PI * 2;

const UP = new THREE.Vector3(0, 1, 0);
const SCREEN_AXIS = new THREE.Vector3(0, 0, 1);
// -90 degrees about X: turns the device frame (screen facing the user, +Z out of the
// screen) into the camera frame three.js expects (looking down -Z).
const DEVICE_TO_CAMERA = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

// A thin line down the controller's -Z, so the player can see what they are pointing
// at while they drag. Authored in METRES like everything else parented to the dolly --
// the dolly's scale is what turns this into a ~3.3ft ray in the world.
function buildPointerRay() {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  const material = new THREE.LineBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.7 });
  return new THREE.Line(geometry, material);
}

// The xr-standard gamepad mapping puts the touchpad on axes 0/1 and the thumbstick on
// axes 2/3, and a controller may report either, both, or (older hardware) only the
// first pair. Whichever is actually deflected is the one the player is using.
function stickOffset(axes) {
  if (axes.length < 4) return 0;
  const pad = Math.hypot(axes[0] ?? 0, axes[1] ?? 0);
  const stick = Math.hypot(axes[2] ?? 0, axes[3] ?? 0);
  return stick >= pad ? 2 : 0;
}

function deadzoned(value) {
  const magnitude = Math.abs(value);
  if (magnitude < STICK_DEADZONE) return 0;
  // Rescaled from the edge of the deadzone rather than returned raw: otherwise a stick
  // nudged just past the threshold jumps straight to a fifth of full walking speed
  // instead of easing in from a standstill.
  const scaled = (magnitude - STICK_DEADZONE) / (1 - STICK_DEADZONE);
  return Math.sign(value) * Math.min(1, scaled);
}

export class VRView {
  constructor({ renderer, scene, camera, player, onNotice }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.player = player;
    this.onNotice = onNotice;

    this.mode = null; // null | 'xr' | 'stereo'
    this.session = null;
    this.effect = null;

    // Inert until a session actually starts -- renderer.render() only consults the XR
    // camera while xr.isPresenting is true -- so this is safe to leave on.
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');

    // The XR rig. A dedicated camera under a dolly, NOT the player's camera:
    // WebXRManager overwrites the transform of whatever camera it is handed, so
    // reparenting the real one would fight PlayerController for control of it every
    // frame. Instead the dolly is driven FROM the player each frame and the headset
    // pose is applied on top of it, so walking with the arrow keys and leaning in the
    // room both work and neither knows about the other.
    //
    // The dolly's scale is the metres->feet conversion: WebXRManager computes the eye
    // transform as `dolly.matrixWorld * pose`, so scaling the dolly is what makes a
    // 1.7m-tall person 5.6ft tall in this world instead of 1.7ft.
    this.dolly = new THREE.Group();
    this.dolly.name = 'vr-dolly';
    this.dolly.scale.setScalar(FEET_PER_METRE);
    this.xrCamera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
    this.dolly.add(this.xrCamera);

    this.setupControllers();

    // Head-look for the stereo path. A proxy camera rather than the player's own, for
    // the same reason as above: PlayerController owns camera.rotation and would
    // overwrite anything written there on its next update().
    this.viewCamera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
    this.deviceQuaternion = new THREE.Quaternion();
    this.yawQuaternion = new THREE.Quaternion();
    this.deviceEuler = new THREE.Euler();
    this.screenQuaternion = new THREE.Quaternion();
    this.hasDeviceOrientation = false;

    this.onDeviceOrientation = this.onDeviceOrientation.bind(this);
    this.onFullscreenChange = this.onFullscreenChange.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onSessionEnd = this.onSessionEnd.bind(this);
  }

  get active() {
    return this.mode !== null;
  }

  // ---------------------------------------------------------------------------
  // Controllers: trigger-drag to look, thumbstick to walk
  // ---------------------------------------------------------------------------

  // Both controllers are parented to the DOLLY, not to the scene. WebXRManager writes
  // the raw pose into each one's local matrix, so a controller sitting under the dolly
  // is automatically carried along as the player walks and turns, and its local
  // transform stays in metres for the dolly's scale to convert -- the same arrangement
  // that makes the headset pose work.
  setupControllers() {
    this.controllers = [];
    this.controllerState = new Map(); // controller -> { dragging, lastYaw }
    this.controllerEuler = new THREE.Euler(0, 0, 0, 'YXZ');

    for (let i = 0; i < 2; i += 1) {
      const controller = this.renderer.xr.getController(i);
      controller.add(buildPointerRay());
      controller.addEventListener('selectstart', () => this.onSelectStart(controller));
      controller.addEventListener('selectend', () => this.onSelectEnd(controller));
      // A controller put down, switched off or run flat during a drag never sends
      // selectend, which would leave the view pinned to a pose that stopped updating.
      controller.addEventListener('disconnected', () => this.onSelectEnd(controller));
      this.dolly.add(controller);
      this.controllers.push(controller);
      this.controllerState.set(controller, { dragging: false, lastYaw: 0 });
    }
  }

  onSelectStart(controller) {
    const state = this.controllerState.get(controller);
    state.dragging = true;
    // Anchor the drag where the controller is NOW, so the first frame of the drag
    // turns by zero rather than by however far the controller has moved since the
    // last time anyone looked at it.
    state.lastYaw = this.controllerYaw(controller);
  }

  onSelectEnd(controller) {
    this.controllerState.get(controller).dragging = false;
  }

  // Measured in the DOLLY's frame, which is the whole trick. The controller is a child
  // of the dolly and its pose is written relative to the reference space, so this yaw
  // does NOT include the player's own yaw -- feeding the delta back into player.yaw
  // therefore can't feed itself and spin the world up like a flywheel, which reading a
  // world-space yaw here would do.
  controllerYaw(controller) {
    this.controllerEuler.setFromQuaternion(controller.quaternion, 'YXZ');
    return this.controllerEuler.y;
  }

  // Only YAW. Pitching the rig from a controller tilts the horizon under someone
  // wearing a headset, which is a well-known way to make them ill -- and looking up
  // and down is exactly what the headset's own tracking already does for free.
  updateControllerLook() {
    for (const controller of this.controllers) {
      const state = this.controllerState.get(controller);
      if (!state.dragging) continue;

      const yaw = this.controllerYaw(controller);
      if (!controller.visible) {
        // Tracking lost mid-drag (hand out of the cameras' view). Re-anchor instead of
        // turning, so the view doesn't snap when the controller is picked back up.
        state.lastYaw = yaw;
        continue;
      }

      let delta = yaw - state.lastYaw;
      if (delta > Math.PI) delta -= TWO_PI;
      else if (delta < -Math.PI) delta += TWO_PI;
      state.lastYaw = yaw;

      this.player.yaw += delta * VR_LOOK_GAIN;
    }
  }

  // Read every frame from the live input sources rather than being cached on connect:
  // a controller can wake, sleep or be swapped hands mid-session, and inputSources is
  // the only thing that always reflects what is actually in the player's hands.
  updateControllerMove() {
    let forward = 0;
    let strafe = 0;

    for (const source of this.session?.inputSources ?? []) {
      const axes = source.gamepad?.axes;
      if (!axes) continue;
      const stick = stickOffset(axes);
      strafe += deadzoned(axes[stick] ?? 0);
      // A gamepad's Y axis is NEGATIVE when the stick is pushed away from the player,
      // and away is forward.
      forward -= deadzoned(axes[stick + 1] ?? 0);
    }

    // Both sticks pushed the same way is still one person walking, not two.
    const drive = Math.hypot(forward, strafe);
    if (drive > 1) {
      forward /= drive;
      strafe /= drive;
    }

    this.player.setAnalogMove(forward, strafe);
  }

  // Leaving VR with a stick held (or a trigger down) must not leave the player walking
  // or turning forever in the flat view, where nothing is feeding these any more.
  releaseControllers() {
    for (const state of this.controllerState.values()) state.dragging = false;
    this.player.setAnalogMove(0, 0);
  }

  // ---------------------------------------------------------------------------
  // Entering and leaving
  // ---------------------------------------------------------------------------

  async toggle() {
    if (this.active) {
      await this.exit();
      return false;
    }
    return this.enter();
  }

  async enter() {
    if (this.active) return true;

    if (await this.enterXR()) return true;
    return this.enterStereo();
  }

  async enterXR() {
    if (!navigator.xr) return false;
    let supported = false;
    try {
      supported = await navigator.xr.isSessionSupported('immersive-vr');
    } catch {
      return false;
    }
    if (!supported) return false;

    let session;
    try {
      session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
      });
    } catch (err) {
      console.warn('Could not start a VR session:', err);
      return false;
    }

    this.session = session;
    session.addEventListener('end', this.onSessionEnd);
    await this.renderer.xr.setSession(session);

    this.scene.add(this.dolly);
    this.mode = 'xr';
    document.body.classList.add('vr-active');
    this.notice(
      'Headset connected — push a thumbstick to walk, hold a trigger and swing the controller to turn. ' +
        'Take the headset off or press its menu button to come back.'
    );
    return true;
  }

  async enterStereo() {
    this.effect = new StereoEffect(this.renderer);
    this.effect.setEyeSeparation(EYE_SEPARATION);
    this.effect.setSize(window.innerWidth, window.innerHeight);

    this.mode = 'stereo';
    document.body.classList.add('vr-active');
    this.syncViewCameraLens();

    // Fullscreen is requested, not required: it can reject (an iframe without the
    // allowfullscreen permission, a browser that wants a different gesture), and a
    // windowed split view is still perfectly usable, so a rejection must not abort.
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      /* windowed stereo is fine */
    }
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    window.addEventListener('keydown', this.onKeyDown);

    await this.startHeadTracking();
    this.notice(
      this.hasDeviceOrientation
        ? 'Side-by-side VR view. Slide the phone into a headset and look around — press Esc to come back.'
        : 'Side-by-side VR view — one image per eye. Press Esc to come back.'
    );
    return true;
  }

  async exit() {
    if (!this.active) return;

    if (this.mode === 'xr') {
      const session = this.session;
      this.session = null;
      if (session) {
        session.removeEventListener('end', this.onSessionEnd);
        try {
          await session.end();
        } catch {
          /* already ending */
        }
      }
      this.scene.remove(this.dolly);
      this.releaseControllers();
    } else {
      this.stopHeadTracking();
      document.removeEventListener('fullscreenchange', this.onFullscreenChange);
      window.removeEventListener('keydown', this.onKeyDown);
      this.effect = null;
      // StereoEffect leaves the viewport and scissor set to the RIGHT-eye half and
      // never restores them, so without this the flat view comes back squeezed into
      // the right-hand side of the canvas.
      const width = window.innerWidth;
      const height = window.innerHeight;
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, width, height);
      this.renderer.setScissor(0, 0, width, height);
      this.renderer.setSize(width, height);
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch {
          /* already leaving */
        }
      }
    }

    this.mode = null;
    document.body.classList.remove('vr-active');
  }

  onSessionEnd() {
    // The headset's own menu button, or taking it off, ends the session without going
    // through exit(). Tidy up so the flat view comes back correctly.
    this.session = null;
    this.scene.remove(this.dolly);
    this.releaseControllers();
    this.mode = null;
    document.body.classList.remove('vr-active');
    this.onNotice?.({ type: 'exited' });
  }

  onFullscreenChange() {
    // Esc leaves fullscreen without telling us anything else -- treat that as "done".
    if (this.mode === 'stereo' && !document.fullscreenElement) {
      this.exit().then(() => this.onNotice?.({ type: 'exited' }));
    }
  }

  onKeyDown(event) {
    if (event.key === 'Escape' && this.mode === 'stereo') {
      this.exit().then(() => this.onNotice?.({ type: 'exited' }));
    }
  }

  // ---------------------------------------------------------------------------
  // Head tracking for the stereo path
  // ---------------------------------------------------------------------------

  async startHeadTracking() {
    if (typeof DeviceOrientationEvent === 'undefined') return;

    // iOS 13+ gates the sensor behind a permission prompt that MUST be triggered by a
    // user gesture. enter() is called straight off the menu click, so this is still
    // inside one.
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return;
      } catch {
        return;
      }
    }
    window.addEventListener('deviceorientation', this.onDeviceOrientation);
  }

  stopHeadTracking() {
    window.removeEventListener('deviceorientation', this.onDeviceOrientation);
    this.hasDeviceOrientation = false;
  }

  onDeviceOrientation(event) {
    // A desktop browser fires this once with all-null values; that is not a sensor.
    if (event.alpha === null || event.beta === null || event.gamma === null) return;
    this.hasDeviceOrientation = true;

    const alpha = THREE.MathUtils.degToRad(event.alpha);
    const beta = THREE.MathUtils.degToRad(event.beta);
    const gamma = THREE.MathUtils.degToRad(event.gamma);
    const screenAngle = THREE.MathUtils.degToRad(screen.orientation?.angle ?? window.orientation ?? 0);

    // The device orientation spec's intrinsic Z-X'-Y'' rotation, which is 'YXZ' read
    // back the other way round in three's Euler order.
    this.deviceEuler.set(beta, alpha, -gamma, 'YXZ');
    this.deviceQuaternion.setFromEuler(this.deviceEuler);
    this.deviceQuaternion.multiply(DEVICE_TO_CAMERA);
    this.deviceQuaternion.multiply(this.screenQuaternion.setFromAxisAngle(SCREEN_AXIS, -screenAngle));
  }

  // ---------------------------------------------------------------------------
  // Per-frame
  // ---------------------------------------------------------------------------

  syncViewCameraLens() {
    this.viewCamera.fov = this.camera.fov;
    this.viewCamera.aspect = this.camera.aspect;
    this.viewCamera.near = this.camera.near;
    this.viewCamera.far = this.camera.far;
    this.viewCamera.updateProjectionMatrix();
  }

  // Returns true when it has drawn the frame, so main.js's loop can skip its own
  // renderer.render() without needing to know which mode is running.
  render() {
    if (this.mode === 'xr') {
      // Both of these write to the player, and the dolly is positioned from the player
      // immediately below -- so a turn or a step taken this frame is already in the
      // pose the headset is about to be shown, with no frame of lag on the turn.
      this.updateControllerLook();
      this.updateControllerMove();

      // local-floor puts the pose origin on the floor, so the dolly sits at the
      // player's FEET rather than at their eyes -- the headset supplies the height.
      const position = this.camera.position;
      this.dolly.position.set(position.x, position.y - EYE_HEIGHT, position.z);
      this.dolly.rotation.y = this.player.yaw;
      this.renderer.render(this.scene, this.xrCamera);
      return true;
    }

    if (this.mode === 'stereo') {
      this.viewCamera.position.copy(this.camera.position);
      if (this.hasDeviceOrientation) {
        // Turning with the arrow keys still works: the player's yaw is applied on top
        // of wherever the phone is pointing.
        this.yawQuaternion.setFromAxisAngle(UP, this.player.yaw);
        this.viewCamera.quaternion.copy(this.yawQuaternion).multiply(this.deviceQuaternion);
      } else {
        this.viewCamera.quaternion.copy(this.camera.quaternion);
      }
      this.effect.render(this.scene, this.viewCamera);
      return true;
    }

    return false;
  }

  resize(width, height) {
    if (this.mode === 'stereo') {
      this.effect.setSize(width, height);
      this.syncViewCameraLens();
    }
  }

  notice(message) {
    this.onNotice?.({ type: 'entered', mode: this.mode, message });
  }
}
