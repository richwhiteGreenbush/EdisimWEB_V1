// Regression check for the Alice in Wonderland props (src/props/WonderProps.js).
//
//   node tools/check-wonder.mjs
//
// The brief this world was built against is LEAVE NO OPEN SPACES. Open edges (an edge
// used by exactly one triangle, counted by WELDED POSITION over two grid sizes -- see
// tools/check-andes.mjs for the method) are counted per prop and compared against the
// RECORDED BASELINE below.
//
// The baseline is not zero, deliberately, and that is the difference from check-andes:
// these characters are built on `chain`, whose tube RIMS are geometrically open and
// buried inside their socket balls -- sealed visually, by construction, with a 2%
// cover margin too thin for any probe-based cover test to verify cheaply (tried:
// winding-number probes step straight through the margin and report noise). So every
// chain rim contributes a known, stable count. What this tool catches is REGRESSION:
// a new hole shows up as a count above baseline, and a fix shows up as one below.
// Inter-part gaps (a hat floating off a head) produce NO open edges at all and are
// hunted visually, which is where every world in this app was verified.
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

const W = await import('../src/props/WonderProps.js');

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

// [builder, options, baseline open-edge count]. Update a baseline ONLY after looking
// at the prop and confirming the change is buried chain rims, not a visible hole.
const CASES = [
  ['alice', {}, 1318],
  ['cheshireCat', {}, 2058],
  ['madHatter', {}, 772],
  ['whiteRabbit', {}, 970],
  ['teaTable', {}, 100],
  ['teaChair', {}, 64], ['teaChair', { tall: true, colour: 0xf2c94c, seed: 21 }, 64],
  ['giantTeacup', {}, 0],
  ['giantMushroom', {}, 44], ['giantMushroom', { height: 8, capColour: 0x8a5cc8, seed: 32 }, 44],
  ['mushroomRing', {}, 0],
  ['wonderTree', {}, 184], ['wonderTree', { canopy: 'blossom', seed: 38 }, 184],
  ['wonderTree', { perch: true, canopy: 'teal', seed: 37, height: 23 }, 256],
  ['wonderFlower', {}, 40],
  ['roseBush', {}, 0], ['roseBush', { painted: true, seed: 51 }, 12],
  ['heartHedge', {}, 64],
  ['rabbitHole', {}, 172],
  ['cardSoldier', {}, 316], ['cardSoldier', { suit: 'spade', rank: '5', seed: 60 }, 316],
  ['cardSoldier', { suit: 'club', rank: '7', seed: 62 }, 316],
  ['wonderSignpost', {}, 0],
  ['drinkMeTable', {}, 0],
  ['wonderClock', {}, 0],
];

let regressions = 0;
console.log('prop                 opts                       meshes    tris   open  baseline   baseY');
for (const [name, opts, baseline] of CASES) {
  const obj = W[name](opts);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  let meshes = 0, tris = 0, open = 0;
  obj.traverse((n) => {
    if (!n.isMesh) return;
    meshes++;
    const g = n.geometry;
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
