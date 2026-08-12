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

const UP = new THREE.Vector3(0, 1, 0);
const SCREEN_AXIS = new THREE.Vector3(0, 0, 1);
// -90 degrees about X: turns the device frame (screen facing the user, +Z out of the
// screen) into the camera frame three.js expects (looking down -Z).
const DEVICE_TO_CAMERA = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

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
    this.notice('Headset connected — look around, arrow keys still walk. Take the headset off or press its menu button to come back.');
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
