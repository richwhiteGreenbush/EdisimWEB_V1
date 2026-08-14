import * as THREE from 'three';
import {
  STRETCH_HANDLE_RADIUS,
  STRETCH_MIN_SIZE,
  STRETCH_LIFT_GAP,
  ROTATE_SNAP_DEGREES,
  ROTATE_RING_GAP,
  ROTATE_RING_TUBE,
} from './config.js';

const HANDLE_CORNERS = [];
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) HANDLE_CORNERS.push([sx, sy, sz]);

// Pixels of pointer travel before the green handle commits to lifting or to sliding.
// Small enough that the piece starts following almost immediately, large enough that the
// jitter of a finger landing on a tablet doesn't decide the axis.
const MOVE_AXIS_THRESHOLD = 8;

const ROTATE_SNAP = (ROTATE_SNAP_DEGREES * Math.PI) / 180;

// The three rotation rings, in WORLD orientation -- they do not turn with the piece.
// A ring that follows the object is the CAD convention, but it means the control a
// student grabbed moves out from under them as they use it. Fixed rings stay exactly
// where they were: the flat one always spins the piece on the spot, the upright ones
// always tip it, whatever state the piece is already in.
//
// Colours are deliberately none of the ones already in use here -- the box body is blue
// and the move handle green -- so no ring can be mistaken for either.
const RINGS = [
  { axis: 'y', color: 0xf2a541, rotation: [Math.PI / 2, 0, 0] }, // flat: spin on the spot
  { axis: 'x', color: 0xf2545b, rotation: [0, Math.PI / 2, 0] }, // upright: tip forward/back
  { axis: 'z', color: 0xb98cf5, rotation: [0, 0, 0] }, // upright: tip side to side
];

const AXIS_VECTORS = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

// The basis each ring's angle is measured in. A positive turn about an axis carries the
// first vector toward the second (right-hand rule), so measuring atan2(d·v, d·u) is what
// makes the piece follow the pointer round rather than mirror it.
const AXIS_BASIS = {
  x: [AXIS_VECTORS.y, AXIS_VECTORS.z],
  y: [AXIS_VECTORS.z, AXIS_VECTORS.x],
  z: [AXIS_VECTORS.x, AXIS_VECTORS.y],
};

// The build gizmo: the overlay behind both "Stretch to Shape" and "Rotate Shape". One
// class, two modes, because everything around the grabs -- the capture-phase listeners,
// the Done chip, hiding the hammer, writing the transform back -- is identical and only
// the handles differ.
//
//   stretch mode                       rotate mode
//   ------------                       -----------
//   corner handle (pale blue) stretch  ring (amber/red/violet) turn about that world axis
//   the box body              slide    the box body            slide
//   move handle (green)       move     move handle (green)     move
//
// The green handle is not optional polish. A piece that can only travel along the ground
// can never be stacked on anything -- no head on a body, no snowman, no second storey --
// and a piece that can only go straight up and down can be lifted to the right height and
// still not be lined up over the piece it is meant to sit on. It therefore carries all
// three axes: the first few pixels of a drag decide whether this is a lift (mostly
// vertical pointer travel) or a slide (mostly sideways), and that choice holds for the
// rest of the drag. One handle, one gesture, no modifier key for a tablet to not have.
export class BuildGizmo {
  constructor({ scene, camera, canvas, registry, worldStore, groundHeightAt, constructionManager }) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.registry = registry;
    this.worldStore = worldStore;
    this.groundHeightAt = groundHeightAt;
    this.constructionManager = constructionManager;

    this.activeId = null;
    this.mode = null;
    this.group = null;
    this.bodyMesh = null;
    this.edges = null;
    this.handles = [];
    this.rings = [];
    this.ringRadius = 0;
    this.drag = null;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.plane = new THREE.Plane();
    this.hit = new THREE.Vector3();

    this.chip = document.createElement('button');
    this.chip.type = 'button';
    this.chip.className = 'stretch-done-chip';
    this.chip.hidden = true;
    this.chip.addEventListener('click', () => this.deactivate());
    document.body.appendChild(this.chip);

    // Capture phase on window, and it has to be. PlayerController registers its
    // look-drag pointerdown on the canvas when the app boots, long before this class
    // exists, and stopImmediatePropagation from a later listener on the same element
    // cannot suppress an earlier one. A capture-phase window listener runs before every
    // target-phase canvas listener no matter what order they were added in, so this is
    // the only place a grab can be claimed away from the camera look.
    this.onPointerDown = (e) => this.handlePointerDown(e);
    this.onPointerMove = (e) => this.handlePointerMove(e);
    this.onPointerUp = (e) => this.handlePointerUp(e);
    this.onKeyDown = (e) => {
      if (e.key === 'Escape' && this.activeId) this.deactivate();
    };
    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('pointermove', this.onPointerMove, true);
    window.addEventListener('pointerup', this.onPointerUp, true);
    window.addEventListener('pointercancel', this.onPointerUp, true);
    window.addEventListener('keydown', this.onKeyDown);
  }

  get active() {
    return this.activeId !== null;
  }

  activate(id, mode = 'stretch') {
    const item = this.registry.get(id);
    if (!item) return;
    this.deactivate();
    this.activeId = id;
    this.mode = mode;

    this.group = new THREE.Group();

    this.bodyMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x3d8bf2,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.group.add(this.bodyMesh);

    this.edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x3d8bf2, depthTest: false, transparent: true, opacity: 0.9 })
    );
    this.edges.renderOrder = 997;
    this.group.add(this.edges);

    if (mode === 'rotate') {
      this.buildRings(item.object3D);
    } else {
      for (const corner of HANDLE_CORNERS) {
        const handle = new THREE.Mesh(
          new THREE.SphereGeometry(STRETCH_HANDLE_RADIUS, 14, 10),
          new THREE.MeshBasicMaterial({ color: 0x9ecbff, depthTest: false })
        );
        handle.renderOrder = 998;
        handle.userData.corner = corner;
        this.handles.push(handle);
        this.group.add(handle);
      }
    }

    // The move handle, floating clear above everything else in a different colour. It is
    // the only grab that works in mid-air: it raises and lowers a piece, and slides it
    // about at whatever height it has been raised to, which is what lining one piece up
    // over another actually needs. Deliberately a little larger than a corner handle --
    // it is the one control a student reaches for on every single piece.
    this.moveHandle = new THREE.Mesh(
      new THREE.SphereGeometry(STRETCH_HANDLE_RADIUS * 1.45, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x3fb37f, depthTest: false })
    );
    this.moveHandle.renderOrder = 999;
    this.moveHandle.userData.move = true;
    this.group.add(this.moveHandle);

    this.liftStem = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]),
      new THREE.LineBasicMaterial({ color: 0x3fb37f, depthTest: false, transparent: true, opacity: 0.8 })
    );
    this.liftStem.renderOrder = 997;
    this.group.add(this.liftStem);

    this.scene.add(this.group);
    if (this.constructionManager) this.constructionManager.suppressId = id;
    this.chip.textContent = mode === 'rotate' ? '✓ Done rotating' : '✓ Done stretching';
    this.chip.hidden = false;
    this.sync();
  }

  // Rings are sized ONCE, from the piece's corner distance, because nothing in rotate
  // mode changes how big the piece is -- turning it and sliding it both leave its own
  // measurements alone. Sizing off the corner distance rather than off any one axis is
  // what guarantees a ring never cuts through the piece it is wrapped around.
  buildRings(object3D) {
    const { half } = this.frame(object3D, null);
    this.ringRadius = half.length() + ROTATE_RING_GAP;
    for (const spec of RINGS) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(this.ringRadius, ROTATE_RING_TUBE, 10, 64),
        new THREE.MeshBasicMaterial({ color: spec.color, depthTest: false })
      );
      ring.rotation.set(spec.rotation[0], spec.rotation[1], spec.rotation[2]);
      ring.renderOrder = 998;
      ring.userData.ringAxis = spec.axis;
      this.rings.push(ring);
      this.group.add(ring);
    }
  }

  deactivate() {
    this.drag = null;
    this.activeId = null;
    this.mode = null;
    this.chip.hidden = true;
    if (this.constructionManager) this.constructionManager.suppressId = null;
    if (!this.group) return;
    // These overlay objects are not in the registry, so nothing else will dispose them.
    this.group.traverse((node) => {
      node.geometry?.dispose();
      node.material?.dispose();
    });
    this.scene.remove(this.group);
    this.group = null;
    this.bodyMesh = null;
    this.edges = null;
    this.moveHandle = null;
    this.liftStem = null;
    this.handles = [];
    this.rings = [];
  }

  // The piece's own box: its centre, its half-extents along its OWN axes, and how it is
  // turned. Everything the gizmo draws and every measurement it takes works in this
  // frame rather than in the world AABB, because now that a piece can be rotated the two
  // are different things: the AABB of a turned box is larger than the box and its sides
  // do not line up with it, so stretching from it would pull the piece along the wrong
  // directions entirely.
  frame(object3D, box) {
    const geometry = object3D.geometry;
    if (!geometry) {
      // A Group rather than a Mesh -- not something construction mode produces, but the
      // gizmo should degrade to the old axis-aligned behaviour rather than throw.
      const fallback = box || new THREE.Box3().setFromObject(object3D);
      return {
        centre: fallback.getCenter(new THREE.Vector3()),
        half: fallback.getSize(new THREE.Vector3()).multiplyScalar(0.5),
        quaternion: new THREE.Quaternion(),
      };
    }
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    return {
      // Every primitive geometry is authored centred on its own origin, so the piece's
      // position IS the centre of its own box however it has been turned.
      centre: object3D.position.clone(),
      half: new THREE.Vector3(
        (size.x * Math.abs(object3D.scale.x)) / 2,
        (size.y * Math.abs(object3D.scale.y)) / 2,
        (size.z * Math.abs(object3D.scale.z)) / 2
      ),
      quaternion: object3D.quaternion.clone(),
    };
  }

  // The piece's own axes in world space, in x/y/z order.
  worldAxes(quaternion) {
    return [
      AXIS_VECTORS.x.clone().applyQuaternion(quaternion),
      AXIS_VECTORS.y.clone().applyQuaternion(quaternion),
      AXIS_VECTORS.z.clone().applyQuaternion(quaternion),
    ];
  }

  cornerAt(corner, centre, half, quaternion) {
    return new THREE.Vector3(corner[0] * half.x, corner[1] * half.y, corner[2] * half.z)
      .applyQuaternion(quaternion)
      .add(centre);
  }

  // How far the piece's base floats above the terrain directly under its origin. Every
  // drag carries this rather than an absolute Y, so a piece keeps the height it was given
  // while still following the hills it is dragged over -- and a piece sitting on the
  // ground (elevation 0) stays sitting on it.
  elevationOf(object3D, box) {
    return box.min.y - this.groundHeightAt(object3D.position.x, object3D.position.z);
  }

  currentBox() {
    const item = this.registry.get(this.activeId);
    if (!item) return null;
    const box = new THREE.Box3().setFromObject(item.object3D);
    return box.isEmpty() ? null : box;
  }

  // Refits the overlay to whatever the piece currently measures. Called every frame, so
  // the box tracks the piece live through a stretch rather than snapping at the end.
  sync() {
    if (!this.group) return;
    const item = this.registry.get(this.activeId);
    const box = this.currentBox();
    if (!item || !box) {
      this.deactivate();
      return;
    }
    const { centre, half, quaternion } = this.frame(item.object3D, box);

    this.bodyMesh.position.copy(centre);
    this.bodyMesh.quaternion.copy(quaternion);
    this.bodyMesh.scale.copy(half).multiplyScalar(2);
    this.edges.position.copy(centre);
    this.edges.quaternion.copy(quaternion);
    this.edges.scale.copy(half).multiplyScalar(2);

    for (const handle of this.handles) {
      handle.position.copy(this.cornerAt(handle.userData.corner, centre, half, quaternion));
    }
    for (const ring of this.rings) ring.position.copy(centre);

    // The move handle has to clear the RINGS too, not just the piece: an upright ring
    // reaches a full radius above the centre, which on anything wider than it is tall is
    // higher than the piece itself, and a green ball sitting on a ring reads as part of
    // it and steals its clicks.
    const top = Math.max(box.max.y, this.rings.length ? centre.y + this.ringRadius : -Infinity);
    this.moveHandle.position.set(centre.x, top + STRETCH_LIFT_GAP, centre.z);
    this.liftStem.position.set(centre.x, top, centre.z);
    this.liftStem.scale.set(1, STRETCH_LIFT_GAP, 1);
  }

  tick() {
    if (this.activeId) this.sync();
  }

  setPointer(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  handlePointerDown(e) {
    if (!this.activeId || e.button !== 0 || this.drag) return;
    if (e.target !== this.canvas) return; // a click on the menu or the Done chip
    const item = this.registry.get(this.activeId);
    if (!item) return;

    this.camera.updateMatrixWorld();
    this.group.updateMatrixWorld(true);
    this.setPointer(e);

    const box = this.currentBox();
    if (!box) return;
    const { centre, half, quaternion } = this.frame(item.object3D, box);

    // The move handle floats clear of everything else, so nothing can be behind it.
    if (this.raycaster.intersectObject(this.moveHandle, false)[0]) {
      this.drag = {
        mode: 'handle',
        // Which axis this drag turned out to be is not known yet: it is decided by the
        // direction of the first MOVE_AXIS_THRESHOLD pixels of travel, in
        // resolveHandleAxis() below.
        axis: null,
        pointerId: e.pointerId,
        downX: e.clientX,
        downY: e.clientY,
        // How far the piece's own base sits below its origin, so it can be stopped at
        // the ground rather than sinking into it.
        baseDrop: item.object3D.position.y - box.min.y,
        elevation: this.elevationOf(item.object3D, box),
      };
      e.stopPropagation();
      return;
    }

    const ringHit = this.rings.length && this.raycaster.intersectObjects(this.rings, false)[0];
    if (ringHit) {
      const axis = ringHit.object.userData.ringAxis;
      // The drag is measured on the ring's OWN plane, so the pointer's angle round the
      // axis is exactly the angle the piece is turned to. Looking along that plane
      // edge-on gives no intersection at all, which is the one viewpoint a ring can't be
      // used from -- walk round a quarter turn, same as the far stretch handle.
      this.plane.setFromNormalAndCoplanarPoint(AXIS_VECTORS[axis], centre);
      if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return;
      const angle = this.angleOn(this.hit, centre, axis);
      this.drag = {
        mode: 'rotate',
        pointerId: e.pointerId,
        axis,
        centre: centre.clone(),
        startQuat: item.object3D.quaternion.clone(),
        lastAngle: angle,
        // Turn accumulated so far, in radians and UNWRAPPED, so a drag can wind past a
        // half turn instead of snapping back the other way at the ±180° seam.
        total: 0,
        // The height the piece is to be held at for the whole turn -- see rotateByRing().
        elevation: Math.max(0, this.elevationOf(item.object3D, box)),
      };
      e.stopPropagation();
      return;
    }

    // Corner handles sit ON the box's corners, so a hit on both is always meant for the
    // handle.
    const handleHit = this.handles.length && this.raycaster.intersectObjects(this.handles, false)[0];
    if (handleHit) {
      const corner = handleHit.object.userData.corner;
      const grab = this.cornerAt(corner, centre, half, quaternion);
      this.drag = {
        mode: 'stretch',
        pointerId: e.pointerId,
        corner,
        // The corner diagonally opposite the grabbed one, held fixed for the whole
        // drag: that is what makes this read as stretching rather than resizing.
        anchor: this.cornerAt(corner.map((s) => -s), centre, half, quaternion),
        axes: this.worldAxes(quaternion),
        startSize: half.clone().multiplyScalar(2),
        startScale: item.object3D.scale.clone(),
      };
      // A plane facing the camera through the grabbed corner: the pointer's world
      // position on it is well-defined from any viewing angle. The one axis nearly
      // parallel to the view is poorly constrained by it -- walk round the piece to
      // stretch that one.
      const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
      this.plane.setFromNormalAndCoplanarPoint(normal, grab);
      e.stopPropagation();
      return;
    }

    const bodyHit = this.raycaster.intersectObject(this.bodyMesh, false)[0];
    if (bodyHit) {
      this.drag = {
        mode: 'move',
        pointerId: e.pointerId,
        // Where the piece's own origin sits relative to the grab point, so it doesn't
        // jump under the cursor; how far its origin sits above its base; and how high
        // that base is floating, so a piece already raised onto another one slides
        // across at that height instead of dropping back to the grass.
        grabOffset: item.object3D.position.clone().sub(bodyHit.point),
        baseDrop: item.object3D.position.y - box.min.y,
        elevation: this.elevationOf(item.object3D, box),
      };
      this.plane.set(new THREE.Vector3(0, 1, 0), -bodyHit.point.y);
      e.stopPropagation();
    }
  }

  // Where a point sits around one world axis, as an angle.
  angleOn(point, centre, axis) {
    const d = point.clone().sub(centre);
    const [u, v] = AXIS_BASIS[axis];
    return Math.atan2(d.dot(v), d.dot(u));
  }

  // Commits the green handle's drag to raising/lowering or to sliding, and sets up the
  // plane that drag will be measured against. Called once, on the first pointer move that
  // clears MOVE_AXIS_THRESHOLD -- so the piece absorbs those few pixels and then follows
  // the pointer exactly, with no jump at the moment the mode is picked.
  resolveHandleAxis(axis, object3D) {
    this.drag.axis = axis;

    if (axis === 'y') {
      // A vertical plane facing the camera: only the Y of the hit is used, so its exact
      // depth does not matter, but it must not be edge-on to the view.
      const flat = this.camera.getWorldDirection(new THREE.Vector3());
      flat.y = 0;
      if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
      this.plane.setFromNormalAndCoplanarPoint(flat.normalize().negate(), this.moveHandle.position);
      this.drag.startY = object3D.position.y;
      if (this.raycaster.ray.intersectPlane(this.plane, this.hit)) this.drag.grabY = this.hit.y;
      return;
    }

    // Sliding runs on a horizontal plane at the handle's own height, so the piece tracks
    // the pointer across the ground plane in BOTH flat directions at once: sideways
    // pointer travel walks it left and right, up-and-down travel pushes it away and pulls
    // it back. That is the whole reason this mode exists -- a piece raised onto another
    // one still has to be lined up over it in X and Z.
    this.plane.set(new THREE.Vector3(0, 1, 0), -this.moveHandle.position.y);
    if (this.raycaster.ray.intersectPlane(this.plane, this.hit)) {
      this.drag.grabPoint = this.hit.clone();
      this.drag.startPos = object3D.position.clone();
    }
  }

  handlePointerMove(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const item = this.registry.get(this.activeId);
    if (!item) {
      this.drag = null;
      return;
    }
    e.stopPropagation();

    this.setPointer(e);

    if (this.drag.mode === 'handle') {
      if (!this.drag.axis) {
        const dx = e.clientX - this.drag.downX;
        const dy = e.clientY - this.drag.downY;
        if (Math.hypot(dx, dy) < MOVE_AXIS_THRESHOLD) return;
        // Mostly-vertical pointer travel means "lift"; anything else means "slide".
        // Dragging up the screen to raise something is the gesture everybody tries
        // first, so it gets the tie.
        this.resolveHandleAxis(Math.abs(dy) >= Math.abs(dx) ? 'y' : 'xz', item.object3D);
      }
      if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return;
      this.moveByHandle(item.object3D);
      this.sync();
      return;
    }

    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return;

    if (this.drag.mode === 'rotate') {
      this.rotateByRing(item.object3D);
    } else if (this.drag.mode === 'stretch') {
      this.stretchByCorner(item.object3D);
    } else {
      const target = this.hit.clone().add(this.drag.grabOffset);
      this.seat(item.object3D, target.x, target.z);
    }

    this.sync();
  }

  rotateByRing(object3D) {
    const { axis, centre, startQuat } = this.drag;
    const angle = this.angleOn(this.hit, centre, axis);
    // Accumulate wrapped increments rather than comparing against the starting angle:
    // that is what lets a single drag wind past half a turn, where a raw difference
    // would read the ±180° crossing as a near-full turn back the other way.
    let step = angle - this.drag.lastAngle;
    step = Math.atan2(Math.sin(step), Math.cos(step));
    this.drag.total += step;
    this.drag.lastAngle = angle;

    // Snapping is what makes this usable for building rather than merely possible.
    // Square corners and neat 45° braces are most of what a model needs, and hitting
    // them by eye on a trackpad is hopeless; the step still leaves 24 positions.
    const snapped = Math.round(this.drag.total / ROTATE_SNAP) * ROTATE_SNAP;
    const turn = new THREE.Quaternion().setFromAxisAngle(AXIS_VECTORS[axis], snapped);
    // Pre-multiply: the turn is about the WORLD axis the ring is drawn on, applied on
    // top of however the piece was already turned. Post-multiplying would rotate about
    // the piece's own axis instead, which is not the ring the student is holding.
    object3D.quaternion.copy(turn.multiply(startQuat));

    // Turning a piece swings its corners about, so its lowest point moves even though it
    // has not been dragged anywhere: a 2ft cube on the grass reaches 0.41ft below itself
    // at 45°. Hold the height it started the turn at instead -- which means recomputing
    // how far its base now sits below its origin, since that is what the rotation just
    // changed.
    //
    // A one-way "push it up out of the ground" clamp is the obvious version of this and
    // it is wrong: it lifts the piece at 45° and has nothing to bring it back down at
    // 90°, so every quarter turn leaves the piece hovering a few inches in the air.
    const box = new THREE.Box3().setFromObject(object3D);
    if (box.isEmpty()) return;
    const baseDrop = object3D.position.y - box.min.y;
    const floor = this.groundHeightAt(object3D.position.x, object3D.position.z);
    object3D.position.y = floor + this.drag.elevation + baseDrop;
  }

  // Holds the corner opposite the grabbed one exactly still while the piece grows or
  // shrinks along its OWN three axes. With an unturned piece those are the world axes and
  // this is the obvious per-axis arithmetic; with a turned one it is the same arithmetic
  // projected onto the piece's axes, which is why the axes are captured at grab time.
  stretchByCorner(object3D) {
    const { corner, anchor, axes, startSize, startScale } = this.drag;
    const reach = this.hit.clone().sub(anchor);
    const centre = anchor.clone();
    for (let i = 0; i < 3; i++) {
      const key = ['x', 'y', 'z'][i];
      const newSize = Math.max(Math.abs(reach.dot(axes[i])), STRETCH_MIN_SIZE);
      object3D.scale[key] = (startScale[key] * newSize) / startSize[key];
      // Every primitive geometry is authored centred on its own origin, so keeping the
      // anchor corner still means putting the centre exactly half the new size away from
      // it, on the side the grabbed corner is on.
      centre.addScaledVector(axes[i], Math.sign(corner[i]) * (newSize / 2));
    }
    object3D.position.copy(centre);
  }

  // Puts a piece down at (x, z) at the height it was already floating at. Everything that
  // moves a piece horizontally goes through here, so "keeps its height, follows the
  // hills" is one rule rather than a property of whichever handle was grabbed.
  seat(object3D, x, z) {
    const { elevation, baseDrop } = this.drag;
    object3D.position.set(x, this.groundHeightAt(x, z) + elevation + baseDrop, z);
  }

  moveByHandle(object3D) {
    if (this.drag.axis === 'y') {
      const { startY, grabY, baseDrop } = this.drag;
      if (grabY === undefined) return;
      // Never below the ground it is standing on -- a buried piece looks like a bug and
      // there is no way to get it back except by guessing where it went.
      const floor = this.groundHeightAt(object3D.position.x, object3D.position.z) + baseDrop;
      object3D.position.y = Math.max(floor, startY + (this.hit.y - grabY));
      // Lifting sets the height every later slide will preserve, so it has to be
      // recorded here too -- otherwise raising a piece and then sliding it would put it
      // straight back down to wherever it was when the drag started.
      this.drag.elevation = Math.max(
        0,
        object3D.position.y - baseDrop - this.groundHeightAt(object3D.position.x, object3D.position.z)
      );
      return;
    }

    const { grabPoint, startPos } = this.drag;
    if (!grabPoint) return;
    this.seat(object3D, startPos.x + (this.hit.x - grabPoint.x), startPos.z + (this.hit.z - grabPoint.z));
  }

  handlePointerUp(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    e.stopPropagation();
    this.drag = null;
    this.persist();
  }

  persist() {
    const item = this.registry.get(this.activeId);
    if (!item?.record) return;
    item.record.transform = {
      position: item.object3D.position.toArray(),
      rotation: [item.object3D.rotation.x, item.object3D.rotation.y, item.object3D.rotation.z],
      scale: item.object3D.scale.toArray(),
    };
    this.worldStore?.saveObject(item.record);
  }
}
