// Audit of Turkle Street: every record built in node, counted, measured and framed.
//
//   node tools/turkle/audit.mjs
//
// There is no headless browser in this checkout, so this is what "measured rather than
// assumed" has to mean here. It builds each record's real geometry, so the triangle and
// mesh counts are the same arithmetic renderer.info reports (no shadow pass, no overdraw);
// and it lists every prop's BEARING and ANGULAR WIDTH from the spawn, because the arrival
// frame is the thing this project gets wrong most often and the only way to catch it before
// a render is to list it.
import * as THREE from 'three';

const ctx = {
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {}, fillRect() {}, clearRect() {}, drawImage() {}, save() {}, restore() {},
  beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, fill() {}, stroke() {},
  translate() {}, rotate() {}, scale() {}, setTransform() {}, fillText() {}, strokeRect() {},
  quadraticCurveTo() {}, bezierCurveTo() {},
  measureText: (t) => ({ width: String(t).length * 9 }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
};
globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx }) };
globalThis.HTMLCanvasElement = class {};

const { buildPresetWorldRecords } = await import('../../src/WorldPresets.js');
const { terrainHeightAt } = await import('../../src/SceneSetup.js');
const { WORLD_THEMES } = await import('../../src/config.js');
const { buildProp } = await import('../../src/props/index.js');

const theme = WORLD_THEMES.turkle;
const { records, spawn } = buildPresetWorldRecords('turkle', { groundHeightAt: (x, z) => terrainHeightAt(theme, x, z) });

// A 16:9 screen sees `atan(tan(35 deg) * 16/9)` either side of the sightline: 51.2 degrees.
const HALF_H = (Math.atan(Math.tan((35 * Math.PI) / 180) * (16 / 9)) * 180) / Math.PI;
const HALF_V = 35;
const EYE = 5;

let tris = 0; let meshes = 0; let geoms = 0;
const rows = [];
const kinds = new Map();
for (const r of records) {
  if (r.kind !== 'preset-prop') continue;
  const obj = buildProp(r.prop, r.options);
  const t = r.transform;
  obj.position.set(t.position[0], t.position[1], t.position[2]);
  obj.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2]);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  let pt = 0; let pm = 0;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    pm++; geoms++;
    pt += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  tris += pt; meshes += pm;
  kinds.set(r.prop, (kinds.get(r.prop) ?? 0) + 1);
  rows.push({ prop: r.prop, x: t.position[0], z: t.position[2], y: t.position[1], box, tris: pt, meshes: pm });
}

console.log(`records ${records.length}   props ${rows.length}   meshes ${meshes}   triangles ${Math.round(tris).toLocaleString()}`);
console.log(`spawn  x ${spawn.x}  z ${spawn.z}  yaw ${spawn.yaw}`);
console.log('');

// --- per-prop cost, heaviest first ------------------------------------------
const byKind = new Map();
for (const r of rows) {
  const k = byKind.get(r.prop) ?? { n: 0, tris: 0, meshes: 0 };
  k.n++; k.tris += r.tris; k.meshes += r.meshes;
  byKind.set(r.prop, k);
}
console.log('prop                 count      each     total   meshes');
for (const [prop, k] of [...byKind].sort((a, b) => b[1].tris - a[1].tris)) {
  console.log(`${prop.padEnd(20)} ${String(k.n).padStart(5)} ${String(Math.round(k.tris / k.n)).padStart(9)} ${String(Math.round(k.tris)).padStart(9)} ${String(k.meshes).padStart(8)}`);
}
console.log('');

// --- the arrival frame -------------------------------------------------------
// yaw turns the camera; it looks down its own -Z, so the sightline is (-sin yaw, -cos yaw).
const sx = spawn.x; const sz = spawn.z;
const look = Math.atan2(-Math.sin(spawn.yaw), -Math.cos(spawn.yaw));
const bearing = (x, z) => {
  let a = Math.atan2(x - sx, -(z - sz)) - Math.atan2(Math.sin(look), -Math.cos(look));
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return (a * 180) / Math.PI;
};
console.log('IN THE ARRIVAL FRAME (bearing in degrees, - is left; half-frame is +-51.2 h, +-35 v)');
console.log('prop                    dist   bearing span        rises to');
const frame = [];
for (const r of rows) {
  const corners = [];
  for (const cx of [r.box.min.x, r.box.max.x]) for (const cz of [r.box.min.z, r.box.max.z]) corners.push(bearing(cx, cz));
  const near = Math.hypot((r.box.min.x + r.box.max.x) / 2 - sx, (r.box.min.z + r.box.max.z) / 2 - sz);
  const lo = Math.min(...corners); const hi = Math.max(...corners);
  if (hi - lo > 180) continue;                    // the player is inside it (the street)
  if (lo > HALF_H || hi < -HALF_H) continue;      // out of frame
  const dist = Math.max(3, Math.hypot((r.box.min.x + r.box.max.x) / 2 - sx, (r.box.min.z + r.box.max.z) / 2 - sz));
  const up = (Math.atan2(r.box.max.y - EYE, dist) * 180) / Math.PI;
  frame.push({ r, lo, hi, dist, up });
}
frame.sort((a, b) => a.dist - b.dist);
for (const f of frame) {
  const clip = f.lo < -HALF_H || f.hi > HALF_H ? ' <clipped>' : '';
  const over = f.up > HALF_V ? ' <over the top>' : '';
  console.log(`${f.r.prop.padEnd(20)} ${f.dist.toFixed(0).padStart(6)}  ${f.lo.toFixed(1).padStart(7)}..${f.hi.toFixed(1).padStart(6)}  ${f.up.toFixed(1).padStart(6)}${clip}${over}`);
}
console.log('');

// --- hidden-behind check: is anything the world is FOR behind something else? --
const HERO = new Set(['ts-ranch-house', 'ts-garage', 'ts-driveway', 'ts-street-sign', 'ts-mailbox']);
for (const h of frame.filter((f) => HERO.has(f.r.prop))) {
  for (const o of frame) {
    if (o === h || o.dist >= h.dist) continue;
    if (o.lo <= h.lo && o.hi >= h.hi && o.up > 2) {
      console.log(`COVERED: ${o.r.prop} at ${o.dist.toFixed(0)}ft completely spans ${h.r.prop} at ${h.dist.toFixed(0)}ft`);
    }
  }
}

// --- footprint overlaps -------------------------------------------------------
// Two solid props sharing ground is the commonest layout bug and the hardest to see from
// inside the world, because you have to walk round the corner to find it.
// `ts-utility-pole` is deliberately NOT in this set: its bounding box contains its own
// SPANS, which reach a hundred feet to the next pole, so it "overlaps" every building on the
// block and drowns the check in noise. A planting bed laid against the wall it belongs to is
// not a clash either.
const SOLID = new Set(['ts-ranch-house', 'ts-garage', 'ts-neighbor-house', 'ts-privacy-fence',
  'ts-chain-fence', 'ts-mulch-ring', 'ts-foundation-bed', 'ts-street-sign',
  'ts-ac-unit', 'ts-trash-cart', 'ts-mailbox']);
const ALLOWED = new Set(['ts-ranch-house|ts-foundation-bed', 'ts-ranch-house|ts-privacy-fence',
  'ts-neighbor-house|ts-foundation-bed', 'ts-garage|ts-privacy-fence']);
let clashes = 0;
for (let i = 0; i < rows.length; i++) {
  for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i]; const b = rows[j];
    if (!SOLID.has(a.prop) || !SOLID.has(b.prop)) continue;
    if (ALLOWED.has(`${a.prop}|${b.prop}`) || ALLOWED.has(`${b.prop}|${a.prop}`)) continue;
    const ox = Math.min(a.box.max.x, b.box.max.x) - Math.max(a.box.min.x, b.box.min.x);
    const oz = Math.min(a.box.max.z, b.box.max.z) - Math.max(a.box.min.z, b.box.min.z);
    const oy = Math.min(a.box.max.y, b.box.max.y) - Math.max(a.box.min.y, b.box.min.y);
    if (ox > 0.6 && oz > 0.6 && oy > 0.6) {
      console.log(`OVERLAP: ${a.prop}(${a.x},${a.z}) x ${b.prop}(${b.x},${b.z})  ${ox.toFixed(1)} x ${oz.toFixed(1)} ft`);
      clashes++;
    }
  }
}
console.log(clashes ? `${clashes} footprint clashes` : 'no footprint clashes');

// --- is anything standing in the road? ---------------------------------------
// The commonest way to get a street world wrong, and the hardest to see from the arrival:
// a house whose garage wing reaches over the kerb reads perfectly from the front and stands
// in the carriageway from every other angle.
const { curbDistance, PLAN } = await import('../../src/props/turkle/plan.js');
//
// A return's flare is the square between the two kerbs MINUS the quarter disc of grass, and
// the square is signed: for the north-east corner it runs from the arc centre back toward
// the junction, not eighteen feet in both directions. Written unsigned it calls a strip of
// somebody's front lawn "carriageway" and buries the check in false positives.
const RETURN_QUADS = [[-39, 3, -1, 1], [-101, 3, 1, 1], [-39, 65, -1, -1], [-101, 65, 1, -1]];
const paved = (x, z) => {
  if (z > PLAN.turkleN && z < PLAN.turkleS) return true;
  if (x > PLAN.seventhW && x < PLAN.seventhE) return true;
  for (const [cx, cz, sx, sz] of RETURN_QUADS) {
    const u = (x - cx) * sx; const v = (z - cz) * sz;
    if (u > 0 && u < 18 && v > 0 && v < 18 && Math.hypot(x - cx, z - cz) > 18) return true;
  }
  return false;
};
// A tree's CROWN is supposed to overhang the road -- that is what a street lined with
// hackberry looks like -- so a tree is judged on its trunk. Everything else is judged on
// its whole footprint.
const TRUNK_ONLY = new Set(['ts-street-tree', 'ts-leaf-drift', 'ts-street-sign', 'ts-utility-pole', 'ts-mailbox']);
let inRoad = 0;
for (const r of rows) {
  if (r.prop === 'ts-street' || r.prop === 'ts-driveway' || r.prop === 'ts-walk') continue;
  const corners = TRUNK_ONLY.has(r.prop)
    ? [[r.x, r.z]]
    : [[r.box.min.x, r.box.min.z], [r.box.max.x, r.box.min.z], [r.box.min.x, r.box.max.z], [r.box.max.x, r.box.max.z]];
  for (const [x, z] of corners) {
    if (paved(x, z)) { console.log(`IN THE ROAD: ${r.prop} at (${r.x}, ${r.z}) has a corner at (${x.toFixed(0)}, ${z.toFixed(0)})`); inRoad++; break; }
  }
}
console.log(inRoad ? `${inRoad} props standing in the carriageway` : 'nothing standing in the carriageway');

// --- is anything outside the walkable world? ---------------------------------
let out = 0;
for (const r of rows) {
  const far = Math.max(Math.hypot(r.box.min.x, r.box.min.z), Math.hypot(r.box.max.x, r.box.max.z));
  if (far > 195 && !['ts-street', 'ts-utility-pole', 'ts-street-tree', 'ts-walk', 'ts-chain-fence'].includes(r.prop)) {
    console.log(`OUTSIDE THE BOUND: ${r.prop} at (${r.x}, ${r.z}) reaches ${far.toFixed(0)}ft`);
    out++;
  }
}
console.log(out ? `${out} props past the world bound` : 'nothing solid past the world bound');
