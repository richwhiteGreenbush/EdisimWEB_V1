import * as THREE from 'three';
import { EYE_HEIGHT, WORLD_BOUND_RADIUS } from './config.js';
import { EASE } from './Motion.js';
import { cameraMovesOn, reducedMotion } from './Settings.js';

// ONE camera, borrowed.
//
// Nobody sees this file and every camera feature needs it. Forty-one worlds are composed
// for exactly one viewpoint -- a five-foot person, fov 70 VERTICAL -- and this is how the
// app leaves that viewpoint and comes back.
//
// THE LOAD-BEARING DECISION IS THAT IT WRITES THE SAME CAMERA OBJECT.
//
// The instinctive move is a second camera swapped in at the render line, and it is wrong
// here for a reason that is specific to this app: WebBrowserPanel renders the entire
// CSS3D layer through the app camera captured at ITS construction, and
// WorldPresets.browserStation() puts a live panel at the spawn of every preset world but
// My World. Render a different camera and every one of those panels stays painted for a
// viewpoint nobody is looking through -- while ObjectMenu, PlayIconManager,
// ConstructionManager and BuildGizmo, which all raycast against that same reference, miss
// every click at the same moment.
//
// This is also the exact INVERSE of what VRView has to do. VRView needs proxy cameras
// because WebXRManager and StereoEffect overwrite whatever camera they are handed. Nothing
// overwrites the app camera except PlayerController.update(), so within one frame the
// later writer simply wins -- and main.js is arranged so that later writer is this.
//
// Consequences worth stating rather than rediscovering:
//
//   * ARROW-KEY TURNING LIVES INSIDE PlayerController.update() (lines 124-125), which is
//     the thing being suppressed. A rig that wants a keyboard student to be able to turn
//     has to apply TURN_SPEED itself, off player.keys. `drive` does exactly that.
//   * take() REFUSES WHILE VR IS ACTIVE. VRView builds its dolly from camera.position.y
//     and player.yaw, and the stereo path copies camera.quaternion outright, so a rig
//     driving the camera goes straight into the headset at full amplitude. Shaking a
//     headset's view is the standard way to make somebody unwell.
//   * IT IS STRICTLY ONE AT A TIME. Two features fighting over the eyes is the one failure
//     that has no good frame to render.

const TURN_SPEED = 1.6; // rad/s, matching PlayerController's own arrow-key turn rate

export class Cinema {
  constructor({ camera, player, registry, menu } = {}) {
    this.camera = camera;
    this.player = player;
    this.registry = registry;
    this.menu = menu;
    this.vrView = null;

    this.rig = null;
    this.rigName = null;
    this.returnPose = null;
    this.blend = 0;        // 0..1 as we ease into the rig
    this.blendFrom = null; // the pose we left, for the ease-in
    this.onEndCallback = null;

    // Reused so a per-frame rig allocates nothing.
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._box = new THREE.Box3();
    this._q = new THREE.Quaternion();

    // THE WAY OUT, and it cannot be Escape alone. Half this app's students are on a
    // touchscreen where there is no Escape key at all, and a camera rig takes over the
    // whole screen -- a mode with no visible exit is a trap. Same argument, same
    // placement and the same z-index as BuildGizmo's Done chip: above the drag ghost,
    // below toasts, and clear of the toast band so the hint and the only exit button do
    // not land on top of each other.
    this.chip = document.createElement('button');
    this.chip.type = 'button';
    this.chip.className = 'cinema-chip';
    this.chip.hidden = true;
    this.chip.addEventListener('click', () => this.release());
    document.body.appendChild(this.chip);

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.rig) return;
      // Only when a rig is actually running, so this never competes with VRView's own
      // Escape (which cannot be live at the same time anyway -- take() refuses in VR) or
      // with UrlPrompt's capture-phase handler.
      e.stopPropagation();
      this.release();
    });
  }

  attach({ vrView }) {
    if (vrView) this.vrView = vrView;
  }

  get active() {
    return Boolean(this.rig);
  }

  // Where the student was standing, so release() can put them back EXACTLY there rather
  // than at the world's spawn. Being returned to spawn after looking at your own rocket
  // is the sort of thing that reads as the app losing your place.
  capturePose() {
    return {
      x: this.camera.position.x,
      z: this.camera.position.z,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
    };
  }

  // rig: { update(dt, ctx), end?(), name?, allowLook?: boolean }
  //
  // ctx carries the camera and a few helpers so a rig body stays short.
  take(name, rig) {
    if (this.vrView?.active) {
      this.menu?.toast('Come out of the headset view first.', { tone: 'error' });
      return false;
    }
    if (!rig) return false;
    // Hand over rather than refuse. A student pressing "ride it" while already orbiting
    // something means "do this instead", and an app that says no there feels stuck.
    if (this.rig) this.release({ restore: false });

    this.returnPose = this.capturePose();
    this.blendFrom = {
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
    };
    this.rig = rig;
    this.rigName = name;
    // A student who has asked for no camera movement gets the destination immediately.
    // Still arriving, just not travelling.
    this.blend = cameraMovesOn() ? 0 : 1;
    document.body.classList.add('cinema-active');
    this.chip.textContent = rig.driving ? '\u2713 Done driving' : '\u2713 Back to me';
    this.chip.hidden = false;
    return true;
  }

  release({ restore = true } = {}) {
    if (!this.rig) return;
    const rig = this.rig;
    this.rig = null;
    this.rigName = null;
    document.body.classList.remove('cinema-active');
    this.chip.hidden = true;
    rig.end?.();
    if (restore && this.returnPose) {
      // resetTo() rather than writing the camera directly: it also clears held keys and
      // zeroes analog movement, so a student who was walking when the rig took over does
      // not resume sliding across the world the instant it hands back.
      this.player.resetTo(this.returnPose);
    }
    this.returnPose = null;
    this.onEndCallback?.();
    this.onEndCallback = null;
  }

  // Called from the animate loop AFTER programManager.tick(), and that ordering is the
  // whole reason a ride does not judder: the program is what moves the ridden object this
  // frame, so a camera reading it earlier is always exactly one frame stale -- invisible
  // under `glide`, a full eight feet of lag under `forever { moveForward 8 }`.
  //
  // Returns true when it drove the camera, so main.js can skip player.update().
  tick(dt) {
    if (!this.rig) return false;

    // A rig whose subject has been deleted has nothing to look at.
    if (this.rig.subjectId && !this.registry?.get(this.rig.subjectId)) {
      this.release();
      return false;
    }

    const ctx = {
      camera: this.camera,
      player: this.player,
      registry: this.registry,
      dt,
      done: () => this.release(),
      look: (target) => this.camera.lookAt(target),
    };

    const finished = this.rig.update?.(dt, ctx);

    // Ease IN from wherever the student was standing. Without this every camera feature
    // in the app begins with a hard cut, which reads as a glitch rather than as a move.
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 0.55);
      const k = EASE.smooth(this.blend);
      this.camera.position.lerpVectors(this.blendFrom.position, this.camera.position, k);
      this.camera.quaternion.slerpQuaternions(this.blendFrom.quaternion, this.camera.quaternion, k);
    }

    if (finished === true) this.release();
    return true;
  }

  // --- Framing ------------------------------------------------------------------
  //
  // How far back to stand to see the whole of something.
  //
  // fov 70 is VERTICAL, so on a 16:9 screen the horizontal half-angle is about 51.6deg
  // and the vertical only 35 -- the TIGHTER of the two is what actually crops, and using
  // the vertical alone puts a 41ft T. rex seen broadside off both edges of the screen.
  frameDistance(object3D) {
    this._box.setFromObject(object3D);
    if (this._box.isEmpty()) return { centre: object3D.position.clone(), distance: 12, radius: 4 };
    const centre = this._box.getCenter(new THREE.Vector3());
    const size = this._box.getSize(this._v);
    const radius = Math.max(0.35, size.length() / 2);

    const vHalf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const half = Math.min(vHalf, hHalf);
    let distance = (radius / Math.sin(half)) * 1.12;

    // Clamp BOTH ends, and both ends really happen. A wildflower solves to about 0.4ft,
    // which is inside camera.near of 0.1 and would put the near plane through the flower;
    // Whimsical World's Mars solves to 593ft, which is outside WORLD_BOUND_RADIUS and past
    // every theme's fogFar, so the "hero shot" would be a rectangle of fog.
    distance = THREE.MathUtils.clamp(distance, 2.5, WORLD_BOUND_RADIUS * 0.9);
    return { centre, distance, radius };
  }
}

// --- The rigs -------------------------------------------------------------------
//
// Each is thirty to eighty lines and costs ZERO draw calls, because none of them adds a
// render -- they replace the one the app was already doing.

// SHOW ME WHAT I BUILT. A five-foot child has no way to see the top of the twelve-foot
// rocket they just made. This lifts the view off their shoulders and turns the whole
// thing slowly against the sky.
export function orbitRig(cinema, id, { turns = 1, seconds = 9 } = {}) {
  const item = cinema.registry.get(id);
  if (!item) return null;
  const { centre, distance } = cinema.frameDistance(item.object3D);
  // Start from roughly where the student is standing, so the move reads as lifting off
  // rather than as teleporting round the far side.
  const start = Math.atan2(
    cinema.camera.position.x - centre.x,
    cinema.camera.position.z - centre.z,
  );
  let t = 0;
  return {
    subjectId: id,
    update(dt, ctx) {
      t += dt;
      const p = Math.min(1, t / seconds);
      const angle = start + p * turns * Math.PI * 2;
      // Rise as it goes: a level orbit shows the silhouette and never the top, and the
      // top is the half a child standing under it has never seen.
      const lift = 0.35 + 0.5 * Math.sin(p * Math.PI);
      ctx.camera.position.set(
        centre.x + Math.sin(angle) * distance,
        centre.y + distance * lift * 0.55,
        centre.z + Math.cos(angle) * distance,
      );
      ctx.camera.lookAt(centre);
      return p >= 1;
    },
  };
}

// WATCH IT RUN. You finish programming the delivery van, press play, and today you lose
// it. This holds it in frame and eases back to your feet when the program stops.
export function watchRig(cinema, id, { maxSeconds = 22 } = {}) {
  const item = cinema.registry.get(id);
  if (!item) return null;
  const { distance } = cinema.frameDistance(item.object3D);
  const box = new THREE.Box3();
  const centre = new THREE.Vector3();
  const want = new THREE.Vector3();
  let t = 0;
  return {
    subjectId: id,
    update(dt, ctx) {
      t += dt;
      const live = ctx.registry.get(id);
      if (!live) return true;
      box.setFromObject(live.object3D);
      if (box.isEmpty()) return true;
      box.getCenter(centre);
      // Trail behind and above, easing toward the ideal spot rather than snapping to it,
      // so a sharp turn by the subject reads as the camera following rather than as a cut.
      want.set(centre.x, centre.y + distance * 0.42, centre.z + distance);
      ctx.camera.position.lerp(want, Math.min(1, dt * 2.2));
      ctx.camera.lookAt(centre);
      // A `forever` never ends, so the cap is what stops this becoming the permanent view.
      if (t > maxSeconds) return true;
      return false;
    },
  };
}

// RIDE IT. Click the trolley and you are floating over its roof as it shuttles the rails
// it was already running on. Every program a student writes becomes something to sit in.
//
// `mode` is 'chase' (behind and above) or 'eyes' (on board, looking where it looks).
export function rideRig(cinema, id, { mode = 'chase' } = {}) {
  const item = cinema.registry.get(id);
  if (!item) return null;
  const box = new THREE.Box3().setFromObject(item.object3D);
  const size = box.getSize(new THREE.Vector3());
  const reach = Math.max(2.5, size.length() * 0.55);
  // The bearing the vehicle was pointing when we climbed on, so look-about can be
  // measured relative to it. atan2(x, z) and not atan2(z, x): a plain Object3D's facing
  // is its +Z, which is the same convention every prop in src/props/ is authored to.
  const mountDir = new THREE.Vector3();
  item.object3D.getWorldDirection(mountDir);
  const mountYaw = Math.atan2(mountDir.x, mountDir.z);
  const centre = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const want = new THREE.Vector3();
  const look = new THREE.Vector3();
  const b = new THREE.Box3();
  return {
    subjectId: id,
    update(dt, ctx) {
      const live = ctx.registry.get(id);
      if (!live) return true;
      const obj = live.object3D;
      b.setFromObject(obj);
      if (b.isEmpty()) return true;
      b.getCenter(centre);
      // getWorldDirection is the object's own +Z, which is the forward every prop in
      // src/props/ is authored to and the same one ProgramRunner's moveForward uses.
      obj.getWorldDirection(fwd);

      // DO NOT parent the camera to the object: `changeSize` multiplies object3D.scale,
      // and a parented camera inherits that straight into its near and far planes.
      if (mode === 'eyes') {
        want.copy(centre).addScaledVector(fwd, reach * 0.55);
        want.y = b.max.y + 0.6;
        ctx.camera.position.copy(want);
        look.copy(want).addScaledVector(fwd, 10);
      } else {
        want.copy(centre).addScaledVector(fwd, -reach * 2.1);
        want.y = b.max.y + reach * 0.9;
        ctx.camera.position.lerp(want, Math.min(1, dt * 3.5));
        look.copy(centre);
      }
      // Looking about while riding is free, but it needs the mount yaw subtracted or
      // dismounting leaves the student facing wherever the vehicle happened to be going.
      const dYaw = ctx.player.yaw - mountYaw;
      if (Math.abs(dYaw) > 0.001 || Math.abs(ctx.player.pitch) > 0.001) {
        ctx.camera.lookAt(look);
        ctx.camera.rotateY(dYaw);
        ctx.camera.rotateX(ctx.player.pitch);
      } else {
        ctx.camera.lookAt(look);
      }
      return false;
    },
  };
}

// BE THIS THING. The arrow keys walk the dinosaur; the camera swings round behind a beat
// late, which is the whole feeling. Put its marker down first and you are steering a
// giant pen -- MarkerTrail samples position every frame regardless of who moved it.
export function driveRig(cinema, id, { speed = 9 } = {}) {
  const item = cinema.registry.get(id);
  if (!item) return null;
  const obj = item.object3D;
  const b = new THREE.Box3().setFromObject(obj);
  const size = b.getSize(new THREE.Vector3());
  const reach = Math.max(4, size.length() * 0.7);
  const fwd = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const want = new THREE.Vector3();
  // Hoisted: this runs every frame, and a Box3 per frame per driven object is exactly the
  // sort of allocation that turns into a stutter on the machine this is built for.
  const driveBox = new THREE.Box3();

  // Elevation above the terrain, PRESERVED rather than clamped -- the difference between
  // a dinosaur that walks over hills and one that snaps flat to the grass the instant it
  // moves. Same rule BuildGizmo's elevationOf/seat pair follows.
  const groundAt = (x, z) => cinema.player.groundHeightAt(x, z);
  const elevation = obj.position.y - groundAt(obj.position.x, obj.position.z);

  return {
    subjectId: id,
    driving: true,
    update(dt, ctx) {
      const keys = ctx.player.keys;
      // Turning has to be done HERE: it lives inside PlayerController.update(), which is
      // the thing being suppressed while a rig is active.
      if (keys.has('ArrowLeft')) obj.rotation.y += TURN_SPEED * dt;
      if (keys.has('ArrowRight')) obj.rotation.y -= TURN_SPEED * dt;
      let drive = 0;
      if (keys.has('ArrowUp')) drive += 1;
      if (keys.has('ArrowDown')) drive -= 1;
      drive += ctx.player.analogForward || 0;

      if (drive !== 0) {
        obj.getWorldDirection(fwd);
        obj.position.addScaledVector(fwd, speed * dt * Math.sign(drive) * Math.min(1, Math.abs(drive)));
        // WORLD_BOUND_RADIUS only ever clamped the PLAYER. Anything a rig drives has to
        // reimplement it, or it walks out into the fog and cannot be got back -- and this
        // app has no undo.
        const radius = Math.hypot(obj.position.x, obj.position.z);
        if (radius > WORLD_BOUND_RADIUS) {
          obj.position.x *= WORLD_BOUND_RADIUS / radius;
          obj.position.z *= WORLD_BOUND_RADIUS / radius;
        }
        obj.position.y = groundAt(obj.position.x, obj.position.z) + elevation;
      }

      driveBox.setFromObject(obj);
      driveBox.getCenter(centre);
      obj.getWorldDirection(fwd);
      want.copy(centre).addScaledVector(fwd, -reach * 2.2);
      want.y = driveBox.max.y + reach * 0.85;
      // A beat late on purpose.
      ctx.camera.position.lerp(want, Math.min(1, dt * 2.6));
      ctx.camera.lookAt(centre);
      return false;
    },
  };
}

// LOOK THROUGH ME. A placed camera prop's own viewpoint: its origin, its own +Z.
export function lookThroughRig(cinema, id) {
  const item = cinema.registry.get(id);
  if (!item) return null;
  const fwd = new THREE.Vector3();
  const look = new THREE.Vector3();
  const eye = new THREE.Vector3();
  return {
    subjectId: id,
    update(dt, ctx) {
      const live = ctx.registry.get(id);
      if (!live) return true;
      const obj = live.object3D;
      obj.getWorldDirection(fwd);
      // Up the body of the tripod rather than at its base: every prop here is authored
      // with its origin at its BASE CENTRE, so the camera's own lens is above that.
      eye.copy(obj.position).addScaledVector(new THREE.Vector3(0, 1, 0), 3.6 * obj.scale.y);
      ctx.camera.position.copy(eye);
      look.copy(eye).addScaledVector(fwd, 20);
      ctx.camera.lookAt(look);
      return false;
    },
  };
}

// THE ARRIVAL SWOOP. Every world in this project is composed around one arrival frame --
// the CLAUDE.md notes for each of them argue about it at length -- and until now that
// frame was delivered as a hard cut. This drops into it from above and ahead.
export function arrivalRig(cinema, spawn, { seconds = 2.1 } = {}) {
  if (reducedMotion() || !cameraMovesOn()) return null;
  const player = cinema.player;
  const x = spawn?.x ?? 0;
  const z = spawn?.z ?? 6;
  const yaw = spawn?.yaw ?? 0;
  const groundY = player.groundHeightAt(x, z) + EYE_HEIGHT;
  // Behind and above the spawn, looking the way the spawn looks -- so the move ends on
  // exactly the composed frame rather than swinging past it.
  const back = 26;
  const from = new THREE.Vector3(
    x + Math.sin(yaw) * back,
    groundY + 22,
    z + Math.cos(yaw) * back,
  );
  const to = new THREE.Vector3(x, groundY, z);
  const lookTo = new THREE.Vector3(x - Math.sin(yaw) * 30, groundY - 1.5, z - Math.cos(yaw) * 30);
  let t = 0;
  return {
    update(dt, ctx) {
      t += dt;
      const p = Math.min(1, t / seconds);
      const k = EASE.outCubic(p);
      ctx.camera.position.lerpVectors(from, to, k);
      ctx.camera.lookAt(lookTo);
      return p >= 1;
    },
    end() {
      // Land the student exactly on the spawn the world asked for.
      player.resetTo(spawn);
    },
  };
}

// FLY. A drone camera -- the one viewpoint from which a student can see the shape of the
// whole thing they have built.
//
// Vertical control is free and needs no extra key: getWorldDirection() includes PITCH, so
// looking up and pressing forward climbs, which is what everybody tries first.
export function flyRig(cinema, { speed = 26 } = {}) {
  const cam = cinema.camera;
  const pos = cam.position.clone();
  let yaw = cinema.player.yaw;
  let pitch = -0.35;
  pos.y = Math.max(pos.y + 18, cinema.player.groundHeightAt(pos.x, pos.z) + 24);
  const fwd = new THREE.Vector3();
  return {
    update(dt, ctx) {
      const keys = ctx.player.keys;
      if (keys.has('ArrowLeft')) yaw += TURN_SPEED * dt;
      if (keys.has('ArrowRight')) yaw -= TURN_SPEED * dt;
      // The look-drag still works while flying, because PlayerController's pointer
      // handlers are independent of update() -- they only write player.yaw/pitch.
      yaw = ctx.player.yaw;
      pitch = ctx.player.pitch;
      ctx.camera.rotation.set(pitch, yaw, 0, 'YXZ');
      let drive = 0;
      if (keys.has('ArrowUp')) drive += 1;
      if (keys.has('ArrowDown')) drive -= 1;
      drive += ctx.player.analogForward || 0;
      if (drive !== 0) {
        ctx.camera.getWorldDirection(fwd);
        pos.addScaledVector(fwd, speed * dt * Math.sign(drive));
      }
      // Never below head height over the terrain, and never outside the world.
      const floor = ctx.player.groundHeightAt(pos.x, pos.z) + EYE_HEIGHT;
      pos.y = Math.max(pos.y, floor);
      const radius = Math.hypot(pos.x, pos.z);
      if (radius > WORLD_BOUND_RADIUS) {
        pos.x *= WORLD_BOUND_RADIUS / radius;
        pos.z *= WORLD_BOUND_RADIUS / radius;
      }
      ctx.camera.position.copy(pos);
      return false;
    },
    end() {
      // Put them down on the ground under wherever they flew to, rather than back at the
      // start -- being returned to the start after flying somewhere loses the whole point
      // of having flown there.
      cinema.returnPose = { x: pos.x, z: pos.z, yaw, pitch: 0 };
    },
  };
}
