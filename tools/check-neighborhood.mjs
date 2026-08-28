// Regression check for The Neighborhood props (src/props/NeighborhoodProps.js).
//
//   node tools/check-neighborhood.mjs
//
// Open edges (an edge used by exactly one triangle, counted by WELDED POSITION over two
// grid sizes -- see tools/check-andes.mjs for the method) are counted per prop and
// compared against the RECORDED BASELINE below. Baselines are not zero where a builder
// uses `chain` (tree trunks), whose tube rims are geometrically open and buried inside
// their socket balls -- the check-wonder rule. Everything else here is extruded shells,
// lofts, lathes and boxes, all closed by construction, so most baselines ARE zero and a
// regression shows as a rise. PlaneGeometry texture plates (signs, dials) sit on solid
// backings and are skipped.
import * as THREE from 'three';

const ctx = {
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {}, fillRect() {}, clearRect() {}, drawImage() {}, save() {}, restore() {},
  beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() {},
  translate() {}, rotate() {}, scale() {}, setTransform() {}, fillText() {}, strokeRect() {},
  quadraticCurveTo() {}, bezierCurveTo() {},
  measureText: () => ({ width: 10 }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
};
globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx }) };
globalThis.HTMLCanvasElement = class {};

const N = await import('../src/props/NeighborhoodProps.js');

function boundaryEdges(geometry, cell) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const key = (i) => `${Math.round(pos.getX(i) / cell)},${Math.round(pos.getY(i) / cell)},${Math.round(pos.getZ(i) / cell)}`;
  const seen = new Map();
  const n = idx ? idx.count : pos.count;
  const at = (k) => (idx ? idx.getX(k) : k);
  for (let t = 0; t < n; t += 3) {
    const a = key(at(t)), b = key(at(t + 1)), c = key(at(t + 2));
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

// [builder, options, baseline open-edge count]. Update a baseline ONLY after looking at
// the prop and confirming the change is buried chain rims, not a visible hole.
const CASES = [
  ['nbHouse', {}, 0],
  ['nbHouse', { storeys: 1, colour: 0xf1eddf, ridgeAxis: 'z', porch: false, seed: 31 }, 0],
  ['nbHouse', { colour: 0xb23a30, roofColour: 0x585e66, shutters: 0xf3f0e6, seed: 32 }, 0],
  ['nbColonial', {}, 0],
  ['nbChapel', {}, 0],
  ['nbShop', {}, 0],
  ['nbShop', { awning: 0xc23b3b, seed: 41 }, 0],
  ['nbBrickBlock', {}, 0],
  ['nbBrickBlock', { storeys: 2, width: 40, storefronts: true, entrance: false, seed: 42 }, 0],
  ['nbRedBlock', {}, 0],
  ['nbFactory', {}, 0],
  ['nbTowerHall', {}, 0],
  ['nbModernSchool', {}, 0],
  ['nbMotel', {}, 0],
  ['nbBarn', {}, 0],
  ['nbStreetGrid', {}, 0],
  ['nbTrolley', {}, 0],
  ['nbCar', {}, 0],
  ['nbCar', { style: 'coupe', seed: 51 }, 0],
  ['nbCar', { style: 'wagon', seed: 52 }, 0],
  ['nbCar', { style: 'pickup', seed: 53 }, 0],
  ['nbCar', { style: 'van', seed: 54 }, 0],
  ['nbTractor', {}, 0],
  ['nbTree', {}, 78],
  ['nbTree', { variant: 'autumn', seed: 61 }, 78],
  ['nbConifer', {}, 0],
  ['nbHedge', {}, 0],
  ['nbRockHill', {}, 0],
  ['nbStopSign', {}, 0],
  ['nbMailbox', {}, 0],
  ['nbPicketFence', {}, 0],
];

let regressions = 0;
console.log('prop                 opts                       meshes    tris   open  baseline   baseY');
for (const [name, opts, baseline] of CASES) {
  const obj = N[name](opts);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  let meshes = 0, tris = 0, open = 0;
  obj.traverse((n2) => {
    if (!n2.isMesh) return;
    meshes++;
    const g = n2.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (g.type === 'PlaneGeometry') return; // texture plates on solid backings
    open += Math.min(boundaryEdges(g, 1e-4), boundaryEdges(g, 3.7e-4));
  });
  const flag = open > baseline ? '  << REGRESSION' : '';
  if (open > baseline) regressions++;
  const tag = Object.keys(opts).length ? JSON.stringify(opts).slice(0, 25) : '(defaults)';
  console.log(
    `${name.padEnd(20)} ${tag.padEnd(26)} ${String(meshes).padStart(5)} ${String(Math.round(tris)).padStart(7)}`
    + ` ${String(open).padStart(6)} ${String(baseline).padStart(9)}  ${box.min.y.toFixed(3).padStart(7)}${flag}`,
  );
}
console.log(regressions ? `\n${regressions} prop(s) ABOVE baseline -- inspect before shipping.` : '\nAll props at or below their recorded baselines.');
process.exit(regressions ? 1 : 0);
