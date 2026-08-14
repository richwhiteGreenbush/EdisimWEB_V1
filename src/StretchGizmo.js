import * as THREE from 'three';
import { STRETCH_HANDLE_RADIUS, STRETCH_MIN_SIZE, STRETCH_LIFT_GAP } from './config.js';

const HANDLE_CORNERS = [];
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) HANDLE_CORNERS.push([sx, sy, sz]);

// "Stretch to shape": a blue semi-transparent box with grabbable corners around one
// construction piece. It carries all three ways of positioning a piece, deliberately, so
// that shaping and arranging are one mode rather than three:
//
//   corner handle (pale blue)  -- stretch, holding the opposite corner still
//   the box body               -- slide along the ground
//   lift handle (green, above) -- raise and lower
//
// The lift handle is not optional polish. Body-drag re-seats the piece on the terrain
// every frame, so without a separate vertical grab nothing could ever be stacked on top
// of anything else -- no head on a body, no snowman, no second storey.
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

    // The lift handle, floating clear above the box in a different colour. Without it a
    // piece can only ever slide about on the ground, and a model whose parts sit ON one
    // another -- a head on a body, a snowman, anything stacked -- simply cannot be built.
    // Dragging the box body is deliberately kept flat (it re-seats on the terrain each
    // frame), so raising a piece needs its own grab point rather than a hidden modifier
    // key nobody would find on a tablet.
    this.liftHandle = new THREE.Mesh(
      new THREE.SphereGeometry(STRETCH_HANDLE_RADIUS * 1.25, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x3fb37f, depthTest: false })
    );
    this.liftHandle.renderOrder = 998;
    this.liftHandle.userData.lift = true;
    this.group.add(this.liftHandle);

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
    this.liftHandle = null;
    this.liftStem = null;
    this.handles = [];
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

    this.liftHandle.position.set(centre.x, box.max.y + STRETCH_LIFT_GAP, centre.z);
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

    // The lift handle floats clear of everything else, so nothing can be behind it.
    if (this.raycaster.intersectObject(this.liftHandle, false)[0]) {
      this.drag = {
        mode: 'lift',
        pointerId: e.pointerId,
        startY: item.object3D.position.y,
        // How far the piece's own base sits below its origin, so it can be stopped at
        // the ground rather than sinking into it.
        baseDrop: item.object3D.position.y - box.min.y,
      };
      // A vertical plane facing the camera: only the Y of the hit is used, so its exact
      // depth does not matter, but it must not be edge-on to the view.
      const flat = this.camera.getWorldDirection(new THREE.Vector3());
      flat.y = 0;
      if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
      this.plane.setFromNormalAndCoplanarPoint(flat.normalize().negate(), this.liftHandle.position);
      this.raycaster.ray.intersectPlane(this.plane, this.hit);
      this.drag.grabY = this.hit.y;
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
        // jump under the cursor, and how far its origin sits above its base, so it can
        // be re-seated on whatever ground it is dragged over.
        grabOffset: item.object3D.position.clone().sub(bodyHit.point),
        lift: item.object3D.position.y - box.min.y,
      };
      this.plane.set(new THREE.Vector3(0, 1, 0), -bodyHit.point.y);
      e.stopPropagation();
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
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return;

    if (this.drag.mode === 'lift') {
      const { startY, grabY, baseDrop } = this.drag;
      const object3D = item.object3D;
      // Never below the ground it is standing on -- a buried piece looks like a bug and
      // there is no way to get it back except by guessing where it went.
      const floor = this.groundHeightAt(object3D.position.x, object3D.position.z) + baseDrop;
      object3D.position.y = Math.max(floor, startY + (this.hit.y - grabY));
      this.sync();
      return;
    }

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
      item.object3D.position.set(target.x, this.groundHeightAt(target.x, target.z) + this.drag.lift, target.z);
    }

    this.sync();
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
