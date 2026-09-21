// Repaints the terrain's ground mask from whatever is standing in the world.
//
// A main-app layout says nothing about the ground -- it has no need to, the ground there is
// one flat-coloured plane. Here the ground grows grass, so every prop has to keep the lawn out
// from under itself, and since five hundred props cannot each be asked, the answer is read off
// their GEOMETRY: any triangle that is low, wide and facing up is a floor of some kind, and is
// stamped into the mask where it lies. Path-like props stamp gravel; everything else stamps
// bare earth. Native props declare a footprint instead, and ponds carve a basin.

import * as THREE from 'three';

const PATHLIKE = /path|road|street|plaza|walk|avenue|runway|pad|deck|court|field|track|terrace|step|floor|paving/;
const _a = new THREE.Vector3(); const _b = new THREE.Vector3(); const _c = new THREE.Vector3();
const _ab = new THREE.Vector3(); const _ac = new THREE.Vector3(); const _box = new THREE.Box3();

// The cuts in the ground a world asks for: pond basins, and any RECTANGULAR cut a native
// prop declares. The rectangles are read off `PROP_CARVES` rather than off a live native's
// metadata, because the carve has to be known BEFORE the terrain is built and a prop's
// native model is only made when the bridge first sees it -- on the frame after.
const PROP_CARVES = {
  // Turkle Street's carriageways. A kerbed street is a trough five inches below the lawn,
  // so without this the terrain draws straight over the road. The two bands are the
  // carriageways (from `turkle/plan.js`) and the four diagonals are the kerb returns, which
  // are a crescent between an arc and a square corner -- a rectangle on the diagonal is the
  // one axis-aligned shape that fits one.
  'ts-street': () => [
    { x: 0, z: 34, w: 344, d: 26.2, depth: 0.62, feather: 1.0 },
    { x: -70, z: 0, w: 26.2, d: 344, depth: 0.62, feather: 1.0 },
    // The returns' flares, centred on the MID-RADIUS of the crescent rather than on the
    // middle of the corner square -- see RETURN_BANDS in props/Turkle.js. The feather is
    // narrow on purpose: the kerb solid is 0.7ft wide and buried a foot deep, so a
    // transition that fits inside it is a transition nobody can see.
    ...[[-54.3, 18.3, -1], [-85.7, 18.3, 1], [-54.3, 49.7, 1], [-85.7, 49.7, -1]].map(([x, z, sense]) => ({
      x, z, w: 24, d: 8.6, yaw: (sense * Math.PI) / 4, depth: 0.62, feather: 1.0,
    })),
  ],
};

export function pondCarves(registry, natives) {
  if (!natives.enabled) return [];
  const carves = [];
  for (const { record, object3D } of registry.items.values()) {
    if (record?.kind !== 'preset-prop') continue;
    if (record.prop === 'park-pond') {
      const r = (record.options?.radius ?? 22) * (object3D.scale?.x ?? 1);
      carves.push({ x: object3D.position.x, z: object3D.position.z, r: r + 0.5, depth: Math.min(9, 2.4 + r * 0.12) });
      continue;
    }
    const make = PROP_CARVES[record.prop];
    if (!make) continue;
    const yaw = new THREE.Euler().setFromQuaternion(object3D.quaternion, 'YXZ').y;
    const ox = object3D.position.x; const oz = object3D.position.z;
    for (const c of make(record.options ?? {})) {
      carves.push({
        ...c,
        x: ox + c.x * Math.cos(yaw) + c.z * Math.sin(yaw),
        z: oz - c.x * Math.sin(yaw) + c.z * Math.cos(yaw),
        yaw: (c.yaw ?? 0) + yaw,
      });
    }
  }
  return carves;
}

export function paintGroundMask({ terrain, registry, bridge, natives }) {
  terrain.clearMask();
  const classic = (x, z) => terrain.rimHeightAt(x, z);
  let stamped = 0;
  for (const { record, object3D } of registry.items.values()) {
    if (!object3D || !record) continue;
    const entry = bridge.nodes.get(object3D);
    if (entry?.native) {
      // A footprint may be ONE stamp or a LIST of them, and it may name its own channel.
      // Turkle Street is why: a street network is a plus shape with four rounded corners, and
      // one rectangle either misses two carriageways or paints a hundred feet of somebody's
      // lawn as road. A stamp's `cx`/`cz` are in the prop's OWN frame, so a list of them
      // turns with it.
      const f = natives.footprints.get(entry.node);
      const x = object3D.position.x; const z = object3D.position.z;
      const yaw = new THREE.Euler().setFromQuaternion(object3D.quaternion, 'YXZ').y;
      const scale = object3D.scale?.x ?? 1;
      for (const stamp of Array.isArray(f) ? f : f ? [f] : []) {
        const channel = stamp.channel ?? 'bare';
        const cx = (stamp.cx ?? 0) * scale; const cz = (stamp.cz ?? 0) * scale;
        const wx = x + cx * Math.cos(yaw) + cz * Math.sin(yaw);
        const wz = z - cx * Math.sin(yaw) + cz * Math.cos(yaw);
        if (stamp.r) terrain.paintCircle(channel, wx, wz, stamp.r * scale, stamp.strength ?? 1, 0.1);
        else terrain.paintRect(channel, wx, wz, stamp.w * scale, stamp.d * scale, yaw + (stamp.yaw ?? 0), stamp.strength ?? 1);
      }
      if (record.prop === 'park-pond') { const r = (record.options?.radius ?? 22) * object3D.scale.x; terrain.paintCircle('bare', x, z, r + 0.8, 1, 0.05); terrain.paintCircle('worn', x, z, r + 6, 0.8, 0.3); }
      continue;
    }
    if (record.kind !== 'preset-prop' && record.kind !== 'built-model' && record.kind !== 'primitive') continue;
    const channel = PATHLIKE.test(record.prop ?? '') ? 'path' : 'bare';
    terrain.beginTriangles(channel);
    object3D.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.visible) return;
      const g = mesh.geometry; const pos = g.attributes.position;
      if (!pos) return;
      if (!g.boundingBox) g.computeBoundingBox();
      _box.copy(g.boundingBox).applyMatrix4(mesh.matrixWorld);
      const gy = classic((_box.min.x + _box.max.x) / 2, (_box.min.z + _box.max.z) / 2);
      if (_box.min.y > gy + 4) return; // nothing of this mesh is near the ground
      const m = mesh.matrixWorld; const index = g.index;
      const count = index ? index.count : pos.count;
      for (let i = 0; i + 2 < count; i += 3) {
        const ia = index ? index.getX(i) : i; const ib = index ? index.getX(i + 1) : i + 1; const ic = index ? index.getX(i + 2) : i + 2;
        _a.fromBufferAttribute(pos, ia).applyMatrix4(m);
        if (_a.y > gy + 4.5) continue;
        _b.fromBufferAttribute(pos, ib).applyMatrix4(m); _c.fromBufferAttribute(pos, ic).applyMatrix4(m);
        _ab.subVectors(_b, _a); _ac.subVectors(_c, _a); _ab.cross(_ac);
        const area2 = _ab.length();
        if (area2 < 1.2 || Math.abs(_ab.y) / area2 < 0.72) continue; // tiny, or not roughly level
        const ly = classic((_a.x + _b.x + _c.x) / 3, (_a.z + _b.z + _c.z) / 3);
        const top = Math.max(_a.y, _b.y, _c.y);
        if (top > ly + 1.6 || top < ly - 1.2) continue; // a roof, or something buried
        terrain.paintTriangle(channel, _a.x, _a.z, _b.x, _b.z, _c.x, _c.z);
        stamped++;
      }
    });
  }
  terrain.commitMask();
  return stamped;
}
