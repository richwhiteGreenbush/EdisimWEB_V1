// Regression check for the Sunflower props (src/props/SunflowerProps.js).
//
//   node tools/check-sunflower.mjs
//
// Two things are measured, per prop:
//
//  * OPEN EDGES -- an edge used by exactly one triangle, counted by WELDED POSITION over
//    two grid sizes and taking the minimum (the method tools/check-andes.mjs works out:
//    a merged geometry keeps each part's own corner copies, so an index-based count calls
//    a closed solid open, and a vertex sitting exactly on one lattice boundary will not be
//    on the other). The baseline is NOT zero and is not meant to be: these models are full
//    of `chain` runs, whose tube rims are geometrically open and buried inside their socket
//    balls, and of `solidSurface` blades whose thickness goes to zero at the margin so the
//    two faces close by coincidence rather than by a rim. What this catches is REGRESSION:
//    a new hole shows up as a count above the recorded baseline.
//
//  * TRIANGLES AND MESHES, because this world's whole budget argument is that a field of a
//    hundred and fifty flowers is only affordable if a background plant costs a fifth of a
//    foreground one and a stand of seven is one prop rather than seven.
//
// Update a baseline ONLY after looking at the prop and confirming the change is buried
// rims, not a visible hole.
import * as THREE from 'three';

const ctx = {
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {}, fillRect() {}, clearRect() {}, drawImage() {}, save() {}, restore() {},
  beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, fill() {}, stroke() {},
  translate() {}, rotate() {}, scale() {}, setTransform() {}, fillText() {}, strokeRect() {},
  rect() {}, clip() {}, arcTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, setLineDash() {},
  measureText: () => ({ width: 10 }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
};
globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx }) };
globalThis.HTMLCanvasElement = class {};

const S = await import('../src/props/SunflowerProps.js');

function boundaryEdges(geometry, cell) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const key = (i) => `${Math.round(pos.getX(i) / cell)},${Math.round(pos.getY(i) / cell)},${Math.round(pos.getZ(i) / cell)}`;
  const seen = new Map();
  const n = idx ? idx.count : pos.count;
  const at = (k) => (idx ? idx.getX(k) : k);
  for (let t = 0; t < n; t += 3) {
    const a = key(at(t)); const b = key(at(t + 1)); const c = key(at(t + 2));
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

// [builder, options, open-edge baseline, triangle ceiling in thousands]
//
// EVERY BASELINE BELOW IS MEASURED, and the ones that are not zero are accounted for --
// an open-edge count nobody can explain is a hole waiting to be found by a student:
//
//   fieldMouse 655 = head 127 (14 whiskers x 2 rims x 5 sides, less the tip rings that
//     weld away at 0.009ft radius, + the 12-edge philtrum) + legs 120+120+132+132 (three
//     chain spans of 12 sides = 72, plus 4 front toes / 5 back toes at 12 each) + tail 24.
//     Every one of those rims is inside a cap or socket ball; chain puts them there.
//   nestBank 1232 = soil 140 (5 prised-out roots, 4 chain rims of 7 sides each) + throat
//     32 (one 16-sided tube, both rims inside the arch) + crown grass 1060 (104 blades of
//     5 sides, base rims sunk 0.62ft into the bank, tips at 0.02ft radius).
//   nestCutaway 792 = the nest's loose straws, whose ends are CUT ends and meant to show.
//   prairieGrass 160 = 16 blades x 2 rims x 5 sides; bases sunk below the ground plane.
//
// Anything that pushes a count ABOVE one of these has added a rim, and the question to ask
// of a new rim is not "is it small" but "what is it inside".
const CASES = [
  ['sunflower', { detail: 'hero', stage: 'bloom' }, 148, 28],
  ['sunflower', { detail: 'hero', stage: 'mature' }, 148, 28],
  ['sunflower', { detail: 'field', stage: 'bloom' }, 58, 8],
  ['sunflower', { detail: 'far', stage: 'bloom' }, 12, 2],
  ['sunflowerStand', { count: 7, detail: 'far' }, 84, 6],
  ['sunflowerStand', { count: 5, detail: 'field' }, 290, 32],
  ['fieldMouse', {}, 655, 24],
  ['fieldMouse', { carry: 'seed' }, 655, 24],
  ['fallenHead', {}, 30, 28],
  ['seedScatter', {}, 0, 8],
  ['nestBank', {}, 1232, 16],
  ['nestCutaway', {}, 792, 20],
  ['prairieGrass', {}, 160, 3],
  ['prairieFlower', {}, 24, 8],
  ['nestMaterial', { kind: 'grass' }, 208, 2],
  ['nestMaterial', { kind: 'feather' }, 12, 2],
  ['nestMaterial', { kind: 'down' }, 140, 2],
  ['nestMaterial', { kind: 'leaf' }, 0, 2],
  ['mouseRunway', { points: [[0, 0], [0, -40], [10, -80]] }, 6, 8],
  ['soilClods', {}, 0, 2],
  ['bumbleBee', {}, 64, 4],
];

let failed = 0;
const box = new THREE.Box3();
const size = new THREE.Vector3();
for (const [name, opts, baseline, triCap] of CASES) {
  const t0 = Date.now();
  const obj = S[name](opts);
  const ms = Date.now() - t0;
  let tris = 0; let meshes = 0; let open = 0;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    open += Math.min(boundaryEdges(g, 0.01), boundaryEdges(g, 0.017));
  });
  box.setFromObject(obj);
  box.getSize(size);
  const overOpen = open > baseline;
  const overTri = tris / 1000 > triCap;
  if (overOpen || overTri) failed++;
  console.log(
    `${overOpen || overTri ? 'FAIL' : 'ok  '} ${name} ${JSON.stringify(opts)}\n`
    + `      ${(tris / 1000).toFixed(1)}k tris (cap ${triCap}k)  ${meshes} meshes  `
    + `open ${open} (baseline ${baseline})  `
    + `box ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}  ${ms}ms`,
  );
}
console.log(failed ? `\n${failed} case(s) over baseline` : '\nall props within baseline');
process.exit(failed ? 1 : 0);
