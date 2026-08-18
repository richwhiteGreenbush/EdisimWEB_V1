import * as THREE from 'three';
import {
  MARKER_RADIUS, MARKER_SIDES, MARKER_MIN_STEP, MARKER_STROKE_POINTS, MARKER_MAX_POINTS,
} from './config.js';

// The marker: an in-world 3D pen that draws a coloured tube behind whatever object is
// holding it. `marker down` starts drawing, `marker up` stops, `marker color` changes the
// ink, `erase all marks` wipes every mark in the world.
//
// WHY A TUBE AND NOT A LINE. `THREE.Line` ignores linewidth on almost every platform --
// the WebGL spec makes it optional and Chrome has never implemented it -- so a "line" here
// is always exactly one pixel wide however far away it is, which is invisible from across
// a world and impossible to see in VR at all. A 3-inch tube is a real object with real
// thickness that behaves like everything else in the scene: it takes the sun, it casts a
// shadow, and it stays legible from any distance.
//
// THE COST MODEL IS THE WHOLE DESIGN. A pen that emits one small mesh per segment produces
// hundreds of draw calls in a few seconds of `forever`, which is the one thing an
// integrated GPU cannot survive; rebuilding a single TubeGeometry from the whole path
// every time it grows is O(n^2) and stalls the frame. So a stroke is ONE mesh with its
// buffers PRE-ALLOCATED to a fixed capacity and a growing draw range: appending a segment
// writes a ring of vertices and bumps a counter, which is O(1) and touches no allocator.
// When a stroke fills up it is closed and a new one starts from its last point, so a
// program can draw forever at a constant per-segment cost.

// A single continuous run of ink: one mesh, one draw call, one colour.
//
// Both ends are closed with a zero-radius ring, so a stroke is a capped solid rather than
// a pipe you can see down. That costs one ring at each end and is the same rule every prop
// in this project follows -- an open tube end is a hole, and a hole is what a 3-inch pipe
// viewed end-on actually shows.
class Stroke {
  constructor({ scene, material, capacity, radius, sides }) {
    this.capacity = capacity;
    this.radius = radius;
    this.sides = sides;
    this.ring = sides + 1;
    this.count = 0;
    this.closed = false;

    const verts = capacity * this.ring;
    this.geometry = new THREE.BufferGeometry();
    this.position = new THREE.Float32BufferAttribute(new Float32Array(verts * 3), 3);
    this.normal = new THREE.Float32BufferAttribute(new Float32Array(verts * 3), 3);
    this.colorAttr = new THREE.Float32BufferAttribute(new Float32Array(verts * 3), 3);
    this.uv = new THREE.Float32BufferAttribute(new Float32Array(verts * 2), 2);
    for (const a of [this.position, this.normal, this.colorAttr, this.uv]) a.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('normal', this.normal);
    this.geometry.setAttribute('color', this.colorAttr);
    this.geometry.setAttribute('uv', this.uv);
    // The index is written once, up front, for the whole capacity. Only the DRAW RANGE
    // moves as the stroke grows -- indices for rings that do not exist yet are never
    // reached, so there is nothing to rewrite per segment.
    const index = new Uint32Array((capacity - 1) * sides * 6);
    let k = 0;
    for (let i = 1; i < capacity; i++) {
      for (let j = 0; j < sides; j++) {
        const a = (i - 1) * this.ring + j;
        const b = i * this.ring + j;
        index[k++] = a; index[k++] = b; index[k++] = a + 1;
        index[k++] = a + 1; index[k++] = b; index[k++] = b + 1;
      }
    }
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry.setDrawRange(0, 0);
    // A stroke can be anywhere in the world, so a bounding sphere computed from the
    // pre-allocated (mostly zeroed) buffer would cull it wrongly. Frustum culling is off:
    // one extra draw call is far cheaper than a line that vanishes when you look away.
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    // Parallel transport: the frame is carried from ring to ring rather than recomputed,
    // which is what stops the tube twisting where the path bends. A Frenet frame flips
    // through every inflection and a straight run has no defined normal at all -- the same
    // reason LoftKit's sweepProfile transports its frame instead.
    this.up = new THREE.Vector3(0, 1, 0);
    this.side = new THREE.Vector3(1, 0, 0);
    this.last = new THREE.Vector3();
  }

  // `taper` writes the ring at zero radius, which is how both ends are capped.
  _writeRing(point, dir, colour, taper) {
    const i = this.count;
    if (i >= this.capacity) return false;

    if (dir.lengthSq() > 1e-8) {
      dir.normalize();
      // Re-orthogonalise the carried frame against the new direction.
      this.side.crossVectors(this.up, dir);
      if (this.side.lengthSq() < 1e-6) {
        this.side.crossVectors(new THREE.Vector3(0, 0, 1), dir);
        if (this.side.lengthSq() < 1e-6) this.side.set(1, 0, 0);
      }
      this.side.normalize();
      this.up.crossVectors(dir, this.side).normalize();
    }

    const r = taper ? 0 : this.radius;
    const base = i * this.ring;
    for (let j = 0; j <= this.sides; j++) {
      const a = (j / this.sides) * Math.PI * 2;
      const nx = this.side.x * Math.cos(a) + this.up.x * Math.sin(a);
      const ny = this.side.y * Math.cos(a) + this.up.y * Math.sin(a);
      const nz = this.side.z * Math.cos(a) + this.up.z * Math.sin(a);
      const v = base + j;
      this.position.setXYZ(v, point.x + nx * r, point.y + ny * r, point.z + nz * r);
      this.normal.setXYZ(v, nx, ny, nz);
      this.colorAttr.setXYZ(v, colour.r, colour.g, colour.b);
      this.uv.setXY(v, i / 8, j / this.sides);
    }
    this.count++;
    this.position.needsUpdate = true;
    this.normal.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.uv.needsUpdate = true;
    this.geometry.setDrawRange(0, Math.max(0, (this.count - 1) * this.sides * 6));
    this.last.copy(point);
    return true;
  }

  begin(point, colour) {
    const dir = new THREE.Vector3(0, 0, 1);
    this._writeRing(point, dir, colour, true);
    this._writeRing(point, dir, colour, false);
  }

  extend(point, colour) {
    const dir = point.clone().sub(this.last);
    return this._writeRing(point, dir, colour, false);
  }

  // Cap the far end. Called on marker up, on a colour change, when the stroke fills, and
  // whenever the world is about to be cleared -- so a stroke is never left open.
  finish(colour) {
    if (this.closed) return;
    this.closed = true;
    if (this.count > 0) {
      const dir = this.last.clone().sub(this._prevPoint());
      this._writeRing(this.last.clone(), dir, colour, true);
    }
  }

  _prevPoint() {
    const i = Math.max(0, this.count - 2) * this.ring;
    return new THREE.Vector3(this.position.getX(i), this.position.getY(i), this.position.getZ(i));
  }

  get full() {
    return this.count >= this.capacity - 1;
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.geometry.dispose();
  }
}

export class MarkerTrail {
  constructor({ scene, onNotice = null } = {}) {
    this.scene = scene;
    this.onNotice = onNotice;
    this.strokes = [];
    this.pens = new Map();
    this.points = 0;
    this.warned = false;
    // ONE material for every mark in the world, carrying per-vertex colour. A material per
    // stroke would be a material per colour change to create and dispose; vertex colours
    // make the whole feature a single material and a single disposal.
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.55, metalness: 0.05,
    });
  }

  _pen(id, object3D) {
    let pen = this.pens.get(id);
    if (!pen) {
      pen = { object3D, colour: new THREE.Color('#3d8bf2'), drawing: false, stroke: null };
      this.pens.set(id, pen);
    }
    if (object3D) pen.object3D = object3D;
    return pen;
  }

  // THE TIP IS AT THE OBJECT'S OWN ORIGIN, LIFTED BY THE TUBE'S RADIUS. Every prop in this
  // project is authored with its origin at its BASE CENTRE, so that puts the tube resting
  // ON the ground rather than half-buried in it -- and it follows the object up into the
  // air when `move up by` lifts it, which is what makes this a 3D marker rather than a
  // floor plan.
  _tip(object3D, out) {
    return out.copy(object3D.position).setY(object3D.position.y + MARKER_RADIUS);
  }

  setColor(id, hex, object3D = null) {
    const pen = this._pen(id, object3D);
    const next = new THREE.Color(hex || '#3d8bf2');
    if (pen.drawing && pen.stroke && !next.equals(pen.colour)) {
      // A stroke is one colour, so changing ink mid-line closes the current stroke and
      // opens a new one AT THE SAME POINT. Sharing the point is what keeps the join solid
      // instead of leaving a gap the width of one frame's travel.
      const at = pen.stroke.last.clone();
      pen.stroke.finish(pen.colour);
      pen.colour = next;
      pen.stroke = this._openStroke(at, pen.colour);
    } else {
      pen.colour = next;
    }
  }

  down(id, object3D) {
    const pen = this._pen(id, object3D);
    if (pen.drawing) return;
    pen.drawing = true;
    const at = this._tip(object3D, new THREE.Vector3());
    pen.stroke = this._openStroke(at, pen.colour);
  }

  up(id) {
    const pen = this.pens.get(id);
    if (!pen || !pen.drawing) return;
    pen.drawing = false;
    pen.stroke?.finish(pen.colour);
    pen.stroke = null;
  }

  _openStroke(at, colour) {
    if (this.points >= MARKER_MAX_POINTS) {
      if (!this.warned) {
        this.warned = true;
        this.onNotice?.('That is a lot of ink — use Erase All Marks to start again.');
      }
      return null;
    }
    const stroke = new Stroke({
      scene: this.scene, material: this.material,
      capacity: MARKER_STROKE_POINTS, radius: MARKER_RADIUS, sides: MARKER_SIDES,
    });
    stroke.begin(at, colour);
    this.strokes.push(stroke);
    this.points += 2;
    return stroke;
  }

  // Sampled once a frame rather than driven from the motion blocks, and that is deliberate.
  // `move forward` finishes inside one tick, so a block-driven pen could sample it -- but
  // `glide` interpolates across many frames and a rotating parent moves its child without
  // any block firing at all. Watching the object's actual position catches every one of
  // those with no per-block plumbing.
  //
  // There is NO teleport detection, on purpose. `move forward 8` completes in a single
  // frame, so an 8ft step is a perfectly ordinary line and any jump threshold would chop
  // legitimate strokes in half. `go back to start` therefore draws its return line, which
  // is exactly what Scratch's pen does and is the more predictable rule.
  tick() {
    if (!this.pens.size) return;
    const at = new THREE.Vector3();
    for (const [id, pen] of this.pens) {
      if (!pen.drawing || !pen.object3D) continue;
      if (!pen.object3D.parent) { this.up(id); continue; }
      this._tip(pen.object3D, at);
      if (!pen.stroke) { pen.stroke = this._openStroke(at.clone(), pen.colour); continue; }
      if (at.distanceTo(pen.stroke.last) < MARKER_MIN_STEP) continue;
      if (pen.stroke.full) {
        // A full stroke is closed and the next one starts from the same point, so a
        // forever loop draws one unbroken line across as many meshes as it needs.
        const carry = pen.stroke.last.clone();
        pen.stroke.finish(pen.colour);
        pen.stroke = this._openStroke(carry, pen.colour);
        if (!pen.stroke) continue;
      }
      pen.stroke.extend(at.clone(), pen.colour);
      this.points++;
    }
  }

  eraseAll() {
    for (const stroke of this.strokes) stroke.dispose(this.scene);
    this.strokes.length = 0;
    this.points = 0;
    this.warned = false;
    // Anything still holding its marker down keeps drawing, from where it is now. Lifting
    // every pen instead would make `erase all marks` inside a loop silently switch the
    // marker off, which is not what the block says it does.
    for (const [id, pen] of this.pens) {
      pen.stroke = null;
      if (pen.drawing && pen.object3D) {
        pen.stroke = this._openStroke(this._tip(pen.object3D, new THREE.Vector3()), pen.colour);
      }
      if (!pen.drawing) this.pens.get(id).stroke = null;
    }
  }

  // An object was deleted. Its pen state goes with it; its marks stay, because they are
  // marks on the world rather than part of the object that made them.
  forget(id) {
    const pen = this.pens.get(id);
    if (pen?.drawing) pen.stroke?.finish(pen.colour);
    this.pens.delete(id);
  }

  // Clear World and Load World both wipe the scene, and marks are part of what is on
  // screen. This must be called anywhere `registry.clear()` is -- the two are not linked
  // automatically, which is the same trap PlayIconManager.clear() carries.
  clear() {
    for (const stroke of this.strokes) stroke.dispose(this.scene);
    this.strokes.length = 0;
    this.pens.clear();
    this.points = 0;
    this.warned = false;
  }

  dispose() {
    this.clear();
    this.material.dispose();
  }
}
