// Regression check for the Machu Picchu prop families (src/props/andes/).
//
//   node tools/check-andes.mjs
//
// It exists because of the one requirement this world was rebuilt against: LEAVE NO OPEN
// SPACES. That is mechanically checkable -- an edge used by exactly one triangle is a hole
// -- and it is the kind of thing that regresses silently, because a hole is only visible
// from the one angle that looks into it.
//
// BOUNDARY EDGES ARE COUNTED BY WELDED POSITION, NOT BY INDEX. A merged geometry keeps each
// part's own copies of its corners (and every BoxGeometry face keeps its own copies of the
// box's), so an index-based count calls a perfectly closed solid open. Two half-cell-offset
// grids are used: with a single grid a vertex sitting exactly on a grid line rounds two ways
// between the two faces sharing it and invents boundary edges, and a coarser grid instead
// welds together two stones that genuinely only touch. An edge open in BOTH grids is real.
import * as THREE from 'three';

// PropKit's relief()/canvasTexture() need a canvas; nothing here reads the pixels back.
const ctx = {
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {}, fillRect() {}, clearRect() {}, drawImage() {}, save() {}, restore() {},
  beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() {},
  translate() {}, rotate() {}, scale() {}, setTransform() {}, fillText() {},
  quadraticCurveTo() {}, bezierCurveTo() {},
  measureText: () => ({ width: 10 }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
};
globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx }) };
globalThis.HTMLCanvasElement = class {};

const A = await import('../src/props/AndesProps.js');

function boundaryEdges(geometry, cell) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  // NO HALF-CELL OFFSET. Adding one shifts the lattice and splits vertices that share a
  // position across two cells, which INVENTS boundary edges: it reported 324 on a peak that
  // has none. Two different cell SIZES are the guard instead -- a vertex sitting exactly on
  // a boundary in one grid will not sit on one in the other.
  const key = (i) => `${Math.round(pos.getX(i) / cell)},${Math.round(pos.getY(i) / cell)},${Math.round(pos.getZ(i) / cell)}`;
  const seen = new Map();
  const n = idx ? idx.count : pos.count;
  const at = (k) => (idx ? idx.getX(k) : k);
  for (let t = 0; t < n; t += 3) {
    const a = key(at(t)), b = key(at(t + 1)), c = key(at(t + 2));
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (p === q) continue;                       // a degenerate edge is not a hole
      const e = p < q ? `${p}|${q}` : `${q}|${p}`;
      seen.set(e, (seen.get(e) || 0) + 1);
    }
  }
  let open = 0;
  for (const v of seen.values()) if (v === 1) open++;
  return open;
}

const CASES = [
  ['andeanPeak', {}], ['andeanPeak', { height: 132, baseRadius: 62, sugarloaf: true, seed: 29 }],
  ['andeanPeak', { height: 96, baseRadius: 58, sugarloaf: false, snow: true, seed: 37 }],
  ['cloudBank', { width: 200, depth: 70, seed: 31 }],
  ['incaWall', { width: 20, height: 9, doorway: true, niches: 2, seed: 5 }],
  ['incaWall', { width: 22, height: 10, doorway: false, niches: 3, seed: 17 }],
  ['incaTerraces', { width: 62, steps: 7, rise: 4.5, tread: 8.5, curve: 4, seed: 7 }],
  ['incaStairs', { width: 7, steps: 14, rise: 1.1, run: 1.35, seed: 19 }],
  ['incaHouse', { width: 18, depth: 12, wallHeight: 8, roofed: true, seed: 100 }],
  ['incaHouse', { width: 15, depth: 11, wallHeight: 8, roofed: false, seed: 118 }],
  ['templeOfTheSun', { radius: 11, height: 12, seed: 11 }],
  ['intihuatana', { height: 6, seed: 13 }],
  ['incaFountain', { height: 4.2, seed: 23 }],
  ['graniteOutcrop', { size: 9, seed: 500 }],
  ['ichuGrass', { radius: 6, count: 20, seed: 600 }],
  ['polylepisTree', { height: 15, seed: 53 }],
  ['andeanFlowers', { radius: 4.5, count: 38, seed: 67 }],
  ['terraceCrop', { kind: 'maize', width: 13, depth: 6, seed: 71 }],
  ['terraceCrop', { kind: 'potato', width: 12, depth: 5.5, seed: 79 }],
];

let worst = 0;
console.log('prop                 opts                       meshes    tris  openEdges   baseY');
for (const [name, opts] of CASES) {
  const obj = A[name](opts);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  let meshes = 0, tris = 0, open = 0;
  obj.traverse((n) => {
    if (!n.isMesh) return;
    meshes++;
    const g = n.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    // Two grids; an edge has to be open in both to count.
    open += Math.min(boundaryEdges(g, 1e-4), boundaryEdges(g, 3.7e-4));
  });
  worst = Math.max(worst, open);
  const tag = Object.keys(opts).length ? JSON.stringify(opts).slice(0, 25) : '(defaults)';
  console.log(
    `${name.padEnd(20)} ${tag.padEnd(26)} ${String(meshes).padStart(5)} ${String(Math.round(tris)).padStart(7)}`
    + `   ${String(open).padStart(8)}  ${box.min.y.toFixed(3).padStart(7)}`,
  );
}
console.log(`\nworst open-edge count across all cases: ${worst}`);
