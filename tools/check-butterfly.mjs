// Regression check for the Butterfly Garden props (src/props/ButterflyProps.js).
//
//   node tools/check-butterfly.mjs
//
// Four things are measured, per prop:
//
//  * OPEN EDGES -- an edge used by exactly one triangle, counted by WELDED POSITION over
//    two grid sizes and taking the minimum (the method tools/check-andes.mjs works out: a
//    merged geometry keeps each part's own corner copies, so an index-based count calls a
//    closed solid open, and a vertex sitting exactly on one lattice boundary will not be
//    on the other). The baseline is NOT zero and is not meant to be -- these models are
//    full of `chain` runs whose tube rims are geometrically open and buried inside their
//    socket balls, and of `solidSurface` blades whose thickness goes to zero at the margin
//    so the two faces close by coincidence rather than by a rim. What this catches is
//    REGRESSION: a new hole shows up as a count above the recorded baseline.
//
//  * TRIANGLES, because this world's budget argument is that thirty butterflies in the air
//    are only affordable if a background border costs a fifth of a foreground one.
//
//  * THE WING BANDS. The failure this is looking for is silent and specific: solidSurface
//    lays its two sheets down in an order that depends on the handedness of its own
//    tangents, so a MIRRORED wing's first sheet is the bottom where the other side's is the
//    top. Get it wrong and a Blue Morpho flies with its cryptic brown underside on top and
//    its blue underneath -- which is not a crash, not a hole, and not visible in any count.
//    Every upward-facing wing vertex must sample an UPPER band of the atlas, on both wings,
//    for all five species.
//
//  * THE ROOT NEVER MOVES. RootMotion.js's contract: four separate places in this app read
//    the live transform off a registered object and write it into IndexedDB, so a butterfly
//    that animated its own root would bake a mid-flight pose the first time anybody touched
//    it with the build gizmo, and walk across the garden over a term with no way back.
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
  measureText: (t) => ({ width: String(t).length * 9 }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
};
globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx }) };
globalThis.HTMLCanvasElement = class {};

const B = await import('../src/props/ButterflyProps.js');

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
// The non-zero baselines are accounted for, because an open-edge count nobody can explain
// is a hole waiting to be found by a student:
//
//   butterfly ~ four wings, each a solidSurface whose thickness goes to zero at the two
//     margins and the tip but NOT at the root, so each wing leaves one rim at v = 0 --
//     every one of them buried inside the thorax. Plus the antenna and leg chains, whose
//     span rims sit inside their own socket balls, and the open-ended proboscis coil.
//   monarchCaterpillar ~ the four filament tips taper to radius 0 (closed) but every
//     chain span leaves a rim inside its socket; the spiracles are closed.
//   emergingAdult ~ the split case is a SHELL and is supposed to be open at the split:
//     that is the one open edge in this file that a student is meant to see.
//   gardenFlower / nectarBed ~ every petal and leaf is a blade whose thickness vanishes at
//     three of its four boundaries; what is left is the base rim, inside the receptacle.
//   chrysalis 48 = the cremaster tube (2 rims x 8, one inside the shell and one inside the
//     silk pad) + the hanging twig and its branch (2 x 9 and 2 x 7, one end underground and
//     the rest inside each other). `tube` is a sleeve and does not cap itself.
//   lifecyclePlinth 4 / speciesBoard 4 = the sign face, which is a flat DoubleSide
//     PlaneGeometry and is an open surface by construction, as every sign in this app is.
const CASES = [
  ['butterfly', { species: 'monarch' }, 700, 12],
  ['butterfly', { species: 'swallowtail' }, 900, 13],
  ['butterfly', { species: 'morpho' }, 700, 12],
  ['butterfly', { species: 'zebra' }, 700, 12],
  ['butterfly', { species: 'peacock' }, 700, 12],
  ['butterfly', { species: 'monarch', detail: 'field' }, 600, 7],
  ['butterfly', { species: 'monarch', detail: 'far' }, 500, 4],
  ['butterfly', { species: 'monarch', pose: 'perch' }, 800, 12],
  ['butterfly', { species: 'monarch', pose: 'spread', size: 9 }, 800, 12],
  ['butterflyEgg', {}, 0, 20],
  ['monarchCaterpillar', {}, 400, 12],
  ['chrysalis', {}, 48, 10],
  ['emergingAdult', {}, 2000, 18],
  ['lifecyclePlinth', {}, 4, 3],
  ['gardenFlower', { kind: 'coneflower' }, 1600, 14],
  ['gardenFlower', { kind: 'milkweed' }, 1200, 14],
  ['gardenFlower', { kind: 'buddleia' }, 900, 20],
  ['gardenFlower', { kind: 'zinnia' }, 2200, 16],
  ['gardenFlower', { kind: 'lantana' }, 1400, 14],
  ['gardenFlower', { kind: 'cosmos' }, 1400, 14],
  ['gardenFlower', { kind: 'susan' }, 2000, 16],
  ['gardenFlower', { kind: 'aster' }, 2600, 18],
  ['gardenFlower', { kind: 'marigold' }, 1800, 18],
  ['nectarBed', { kinds: ['coneflower', 'susan'], detail: 'field' }, 2600, 22],
  ['nectarBed', { kinds: ['zinnia', 'lantana'], detail: 'far' }, 1600, 14],
  ['gardenPath', { points: [[0, 0], [0, -60], [10, -120]] }, 0, 8],
  ['puddlingPool', {}, 0, 4],
  ['gardenGrass', {}, 400, 3],
  ['speciesBoard', {}, 4, 2],
];

let failed = 0;
const box = new THREE.Box3();
const size = new THREE.Vector3();
for (const [name, opts, baseline, triCap] of CASES) {
  const t0 = Date.now();
  const obj = B[name](opts);
  const ms = Date.now() - t0;
  let tris = 0; let meshes = 0; let open = 0;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    open += Math.min(boundaryEdges(g, 0.004), boundaryEdges(g, 0.0068));
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

// --- the two invariants that no triangle count can catch ---------------------
const AW = B.ATLAS.w; const BW = B.ATLAS.band;
const bandOf = (u) => {
  const px = u * AW;
  if (px < BW) return 'foreUp';
  if (px < BW * 2) return 'foreUn';
  if (px < BW * 3) return 'hindUp';
  if (px < BW * 4) return 'hindUn';
  return 'blank';
};
let swapped = 0;
for (const key of B.SPECIES_ORDER) {
  const o = B.butterfly({ species: key, seed: 3 });
  const rig = o.children[0];
  for (const pivot of rig.children.filter((c) => c.type === 'Group')) {
    const m = pivot.children[0];
    const nor = m.geometry.attributes.normal; const uv = m.geometry.attributes.uv;
    const up = { Up: 0, Un: 0 }; const dn = { Up: 0, Un: 0 };
    for (let i = 0; i < nor.count; i++) {
      const ny = nor.getY(i);
      if (Math.abs(ny) < 0.85) continue;
      const b = bandOf(uv.getX(i));
      if (b === 'blank') continue;
      (ny > 0 ? up : dn)[b.endsWith('Up') ? 'Up' : 'Un']++;
    }
    if (!(up.Up > up.Un * 20 && dn.Un > dn.Up * 20)) {
      swapped++;
      console.log(`FAIL ${key} wing at x=${pivot.position.x.toFixed(2)}: upward faces Up ${up.Up}/Un ${up.Un}, downward Up ${dn.Up}/Un ${dn.Un}`);
    }
  }
}
console.log(swapped ? `\n${swapped} wing(s) have their upper and under surfaces swapped`
  : '\nwing bands: every upward face samples an UPPER band, both wings, all five species');

let moved = 0;
for (const pose of ['fly', 'perch', 'emerge', 'spread']) {
  const o = B.butterfly({ species: 'monarch', seed: 11, pose, range: 20, floor: 4, ceiling: 18 });
  const start = o.position.clone();
  for (let i = 0; i < 900; i++) o.userData.tick.update(1 / 60);
  const drift = o.position.distanceTo(start);
  if (drift > 1e-9) { moved++; console.log(`FAIL pose ${pose}: the registered root moved ${drift.toFixed(6)}ft`); }
}
console.log(moved ? `${moved} pose(s) animate the ROOT -- see RootMotion.js`
  : 'root motion: every pose animates the rig and leaves the registered root alone');

failed += swapped + moved;
console.log(failed ? `\n${failed} check(s) failed` : '\nall props within baseline');
process.exit(failed ? 1 : 0);
