import * as THREE from 'three';
import { STRETCH_HANDLE_RADIUS, STRETCH_MIN_SIZE, STRETCH_LIFT_GAP } from './config.js';

const HANDLE_CORNERS = [];
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) HANDLE_CORNERS.push([sx, sy, sz]);

// Pixels of pointer travel before the green handle commits to lifting or to sliding.
// Small enough that the piece starts following almost immediately, large enough that the
// jitter of a finger landing on a tablet doesn't decide the axis.
const MOVE_AXIS_THRESHOLD = 8;

// "Stretch to shape": a blue semi-transparent box with grabbable corners around one
// construction piece. It carries all three ways of positioning a piece, deliberately, so
// that shaping and arranging are one mode rather than three:
//
//   corner handle (pale blue)  -- stretch, holding the opposite corner still
//   the box body               -- slide, keeping whatever height the piece is at
//   move handle (green, above) -- raise/lower AND slide, in mid-air
//
// The green handle is not optional polish. A piece that can only travel along the ground
// can never be stacked on anything -- no head on a body, no snowman, no second storey --
// and a piece that can only go straight up and down can be lifted to the right height and
// still not be lined up over the piece it is meant to sit on. It therefore carries all
// three axes: the first few pixels of a drag decide whether this is a lift (mostly
// vertical pointer travel) or a slide (mostly sideways), and that choice holds for the
// rest of the drag. One handle, one gesture, no modifier key for a tablet to not have.
export class StretchGizmo {
  constructor({ scene, camera, canvas, registry, worldStore, groundHeightAt, constructionManager }) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.registry = registry;
    this.worldStore = worldStore;
    this.groundHeightAt = groundHeightAt;
    this.constructionManager = constructionManager;

    this.activeId = null;
    this.group = null;
    this.bodyMesh = null;
    this.edges = null;
    this.handles = [];
    this.drag = null;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.plane = new THREE.Plane();
    this.hit = new THREE.Vector3();

    this.chip = document.createElement('button');
    this.chip.type = 'button';
    this.chip.className = 'stretch-done-chip';
    this.chip.textContent = '✓ Done stretching';
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

  activate(id) {
    if (!this.registry.get(id)) return;
    this.deactivate();
    this.activeId = id;

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

    // The move handle, floating clear above the box in a different colour. It is the only
    // grab that works in mid-air: it raises and lowers a piece, and slides it about at
    // whatever height it has been raised to, which is what lining one piece up over
    // another actually needs. Deliberately a little larger than a corner handle -- it is
    // the one control a student reaches for on every single piece.
    this.moveHandle = new THREE.Mesh(
      new THREE.SphereGeometry(STRETCH_HANDLE_RADIUS * 1.45, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x3fb37f, depthTest: false })
    );
    this.moveHandle.renderOrder = 998;
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
    this.chip.hidden = false;
    this.sync();
  }

  deactivate() {
    this.drag = null;
    this.activeId = null;
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
  }

  // How far the piece's base floats above the terrain directly under its origin. Both
  // drag modes carry this rather than an absolute Y, so a piece keeps the height it was
  // given while still following the hills it is dragged over -- and a piece sitting on
  // the ground (elevation 0) stays sitting on it.
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
    const box = this.currentBox();
    if (!box) {
      this.deactivate();
      return;
    }
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());

    this.bodyMesh.scale.copy(size);
    this.bodyMesh.position.copy(centre);
    this.edges.scale.copy(size);
    this.edges.position.copy(centre);

    for (const handle of this.handles) {
      const [sx, sy, sz] = handle.userData.corner;
      handle.position.set(
        centre.x + (sx * size.x) / 2,
        centre.y + (sy * size.y) / 2,
        centre.z + (sz * size.z) / 2
      );
    }

    this.moveHandle.position.set(centre.x, box.max.y + STRETCH_LIFT_GAP, centre.z);
    this.liftStem.position.set(centre.x, box.max.y, centre.z);
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
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

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

    // Handles first: they sit ON the box's corners, so a hit on both is always meant
    // for the handle.
    const handleHit = this.raycaster.intersectObjects(this.handles, false)[0];
    if (handleHit) {
      const corner = handleHit.object.userData.corner;
      const grab = new THREE.Vector3(
        centre.x + (corner[0] * size.x) / 2,
        centre.y + (corner[1] * size.y) / 2,
        centre.z + (corner[2] * size.z) / 2
      );
      this.drag = {
        mode: 'stretch',
        pointerId: e.pointerId,
        corner,
        // The corner diagonally opposite the grabbed one, held fixed for the whole
        // drag: that is what makes this read as stretching rather than resizing.
        anchor: new THREE.Vector3(
          centre.x - (corner[0] * size.x) / 2,
          centre.y - (corner[1] * size.y) / 2,
          centre.z - (corner[2] * size.z) / 2
        ),
        startSize: size.clone(),
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

    if (this.drag.mode === 'stretch') {
      const { corner, anchor, startSize, startScale } = this.drag;
      const object3D = item.object3D;
      for (let axis = 0; axis < 3; axis++) {
        const key = ['x', 'y', 'z'][axis];
        const newSize = Math.max(Math.abs(this.hit[key] - anchor[key]), STRETCH_MIN_SIZE);
        object3D.scale[key] = (startScale[key] * newSize) / startSize[key];
        // Every primitive geometry is authored centred on its own origin, so keeping
        // the anchor corner still means putting the centre exactly half the new size
        // away from it, on the side the grabbed corner is on.
        object3D.position[key] = anchor[key] + Math.sign(corner[axis]) * (newSize / 2);
      }
    } else {
      const target = this.hit.clone().add(this.drag.grabOffset);
      this.seat(item.object3D, target.x, target.z);
    }

    this.sync();
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
      this.drag.elevation = Math.max(0, object3D.position.y - baseDrop - this.groundHeightAt(object3D.position.x, object3D.position.z));
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
