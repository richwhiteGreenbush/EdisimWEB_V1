// Regression check for Turkle Street's props (src/props/TurkleProps.js).
//
//   node tools/check-turkle.mjs
//
// Open edges -- an edge used by exactly one triangle, counted by WELDED POSITION over two
// grid sizes (see tools/check-andes.mjs for the method) -- per prop, against a RECORDED
// BASELINE. Most of this world is extruded shells, swept profiles and chamfered boxes, all
// closed by construction, so most baselines are zero and a regression shows as a rise.
//
// Four baselines are deliberately NOT zero, and each is a surface rather than a solid:
//
//  * `ts-street` -- the gutter pan and the asphalt are cut from ONE grid and abut along a
//    shared edge. Each half is therefore open along that seam and closed everywhere else;
//    the seam is a join, not a hole, because both sides carry identical vertices. This is
//    the whole reason the plan module exists, and the number is the seam's own length.
//  * `ts-utility-pole` -- the spans are open-ended tubes. A wire has no end caps because a
//    wire has no ends inside this world; it leaves for the next pole.
//  * `ts-street-sign`, `ts-chain-fence` -- a sign blade and a chain-link fabric are
//    PLANES. They are supposed to be open; that is what a sheet is.
//  * `ts-street-tree`, `ts-mulch-ring` -- swept limb ends buried inside the crown, and a
//    circle fan plus a part-torus hook. The check-wonder rule: assert no prop EXCEEDS its
//    inspected baseline, so a regression shows as a rise rather than being hidden by a
//    blanket zero that was never true.
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

const T = await import('../src/props/TurkleProps.js');

function boundaryEdges(geometry, cell) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  if (!idx) return 0;
  const key = (i) => `${Math.round(pos.getX(i) / cell)},${Math.round(pos.getY(i) / cell)},${Math.round(pos.getZ(i) / cell)}`;
  const seen = new Map();
  for (let t = 0; t < idx.count; t += 3) {
    const a = key(idx.getX(t)); const b = key(idx.getX(t + 1)); const c = key(idx.getX(t + 2));
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (p === q) continue;
      const e = p < q ? `${p}|${q}` : `${q}|${p}`;
      seen.set(e, (seen.get(e) || 0) + 1);
    }
  }
  let open = 0;
  for (const v of seen.values()) if (v === 1) open++;
  return open;
}

// [builder, options, baseline]. Raise a baseline ONLY after looking at the prop and
// confirming the change is a buried rim or an honest sheet, not a visible hole.
const CASES = [
  ['tsStreet', { aprons: [{ x: 36, width: 16 }, { x: 94, width: 14 }, { x: -32.5, width: 14, side: 'south', back: 56 }, { x: 40, width: 14, side: 'south', back: 56 }] }, 1200],
  ['tsDriveway', { length: 64, width: 16 }, 0],
  ['tsDriveway', { length: 10, width: 14, seed: 8 }, 0],
  ['tsWalk', { length: 36, width: 3.6 }, 0],
  ['tsWalk', { length: 52, width: 4, seed: 4 }, 0],
  ['tsRanchHouse', {}, 0],
  ['tsGarage', {}, 0],
  ['tsNeighborHouse', {}, 0],
  ['tsNeighborHouse', { roof: 'gable', garage: true, seed: 22 }, 0],
  ['tsNeighborHouse', { roof: 'gable', roofKind: 'seam', seed: 24 }, 0],
  ['tsPrivacyFence', { length: 24 }, 0],
  ['tsPrivacyFence', { length: 9, gate: true, seed: 33 }, 0],
  ['tsChainFence', { length: 112 }, 4],
  ['tsUtilityPole', { spans: [{ dx: 104, dz: 3.5 }], drops: [{ dx: -18, dz: -63.5 }] }, 60],
  ['tsUtilityPole', { spans: [], transformer: false, seed: 48 }, 0],
  ['tsStreetSign', {}, 8],
  ['tsMailbox', {}, 0],
  ['tsAcUnit', {}, 0],
  ['tsTrashCart', {}, 0],
  ['tsPumpkin', {}, 0],
  ['tsStreetTree', { kind: 'hackberry', height: 40, seed: 51 }, 320],
  ['tsStreetTree', { kind: 'elm', height: 42, seed: 53 }, 320],
  ['tsStreetTree', { kind: 'oak', height: 34, seed: 59 }, 420],
  ['tsStreetTree', { kind: 'maple', height: 30, seed: 54 }, 320],
  ['tsStreetTree', { kind: 'autumn', height: 32, seed: 57 }, 320],
  ['tsShrub', { kind: 'juniper' }, 0],
  ['tsShrub', { kind: 'grass', seed: 99 }, 0],
  ['tsMulchRing', { radius: 7 }, 48],
  ['tsFoundationBed', { width: 12, depth: 4.2 }, 0],
  ['tsLeafDrift', { radius: 17, count: 300 }, 0],
];

let regressions = 0;
console.log('prop                 opts                          meshes     tris   open  baseline   baseY');
for (const [name, opts, baseline] of CASES) {
  const obj = T[name](opts);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  let tris = 0; let meshes = 0; let open = 0;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    open += Math.min(boundaryEdges(g, 0.004), boundaryEdges(g, 0.0071));
  });
  const bad = open > baseline;
  if (bad) regressions++;
  const label = Object.entries(opts).filter(([k]) => k !== 'aprons' && k !== 'spans' && k !== 'drops').map(([k, v]) => `${k}=${v}`).join(' ').slice(0, 28);
  console.log(
    `${name.padEnd(20)} ${label.padEnd(29)} ${String(meshes).padStart(4)} ${String(Math.round(tris)).padStart(8)} ${String(open).padStart(6)} ${String(baseline).padStart(9)} ${box.min.y.toFixed(2).padStart(7)}${bad ? '   <-- REGRESSION' : ''}`,
  );
}
console.log(regressions ? `\n${regressions} props exceed their baseline` : '\nevery prop is within its recorded baseline');
process.exit(regressions ? 1 : 0);
