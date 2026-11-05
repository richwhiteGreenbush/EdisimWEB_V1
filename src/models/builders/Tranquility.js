import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  terrainBlock, Batch, signs, seededRandom, clamp01, sstep, mix, mixc, noise2, fbm, sampledField, TAU,
} from '../geo/GeoKit.js';
import { mesh, standard, canvasTexture } from '../../PropKit.js';
import { tube, lathe, outward } from '../ModelKit.js';

// Tranquility Base, the Apollo 11 landing site, as a museum diorama. One idea carries it: THE WHOLE
// FIRST MOONWALK COVERED A VERY SMALL AREA. So the plan is drawn true to scale, every trail the two
// astronauts walked is painted into the regolith at that scale, and a soccer field is drawn on the
// same ground at the same scale, which is the comparison the Apollo Lunar Surface Journal itself
// makes. Armstrong's walk out to Little West Crater, the longest of the day, ends inside it.
//
// The equipment is the one thing enlarged, by ENLARGE, so a seismometer the size of a suitcase can
// be seen at all. It cannot be enlarged further: the flag stood about 8 m from the lander, and at
// much more than 1.4 times the lander's own legs reach it. No astronauts: the people are told by
// their footprints, which is how the site is seen from orbit today.
//
// Six meshes: ground, cut faces, base (the terrain block), the hardware batch, the signs, and one
// textured mesh for the flag, the lander's flag decal and the two instruments' printed faces.
// Authored in feet, origin at the base centre, front toward +Z, which is south. East is +X.

const W = 18; const D = 12;
const X0 = -W / 2; const Z0 = -D / 2;
const PLINTH = 0.3;
const GROUND = 1.45;
// Metres of the real site per foot of plan, horizontally and vertically alike: the craters and the
// regolith in the cut face are at their true depths.
export const M_PER_FT = 6.5;
const M = M_PER_FT;
// The plan's centre, in metres east and north of the lander.
const E0 = 22; const N0 = -5;
export const ENLARGE = 1.4;
// Feet of model per metre of hardware.
const K = ENLARGE / M;
export const planX = (e) => (e - E0) / M;
export const planZ = (n) => -(n - N0) / M;
const planE = (x) => x * M + E0;
const planN = (z) => -z * M + N0;

// Where everything stood, in metres east and north of the lander. The laser reflector is placed
// from the NSSDC site coordinates (about 21.5 m south), the seismometer about 7.5 m beyond it on the
// line from the camera (Apollo Lunar Surface Journal), the flag about 8 m out, and Little West
// Crater, about 30 m across, about 60 m east. The rest follow the published traverse maps
// approximately, and the card says so.
export const SITE = {
  flag: [-7.6, 3.1],
  swc: [-7.0, -4.6],
  tv: [-12, 15],
  lrrr: [-1.2, -21.5],
  psep: [0.9, -28.7],
  crater: { e: 80.5, n: -2, r: 15, depth: 4.5 },
  pitch: { e: 26, n: -7, length: 105, width: 68 },
};
export const REGOLITH_M = 4.4;
const TEX_W = 2048;
const TEX_H = Math.round(TEX_W * D / W);
const PX = TEX_W / W; // texels per foot, the same both ways

// ---------------------------------------------------------------------------------------------
// The craters. One list, read by the mesh, the painting and the cut faces.
// ---------------------------------------------------------------------------------------------
function bowl(q, rim) {
  if (q < 1) return -1 + (1 + rim) * q * q;
  if (q < 2.2) { const t = (2.2 - q) / 1.2; return rim * t * t; }
  return 0;
}

class Buckets {
  constructor(cell) {
    this.cell = cell;
    this.cols = Math.ceil(W / cell) + 1;
    this.rows = Math.ceil(D / cell) + 1;
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }

  add(c, reach) {
    const i0 = Math.max(0, Math.floor((c.x - reach - X0) / this.cell));
    const i1 = Math.min(this.cols - 1, Math.floor((c.x + reach - X0) / this.cell));
    const j0 = Math.max(0, Math.floor((c.z - reach - Z0) / this.cell));
    const j1 = Math.min(this.rows - 1, Math.floor((c.z + reach - Z0) / this.cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cells[i + j * this.cols].push(c);
  }

  at(x, z) {
    const i = Math.min(this.cols - 1, Math.max(0, Math.floor((x - X0) / this.cell)));
    const j = Math.min(this.rows - 1, Math.max(0, Math.floor((z - Z0) / this.cell)));
    return this.cells[i + j * this.cols];
  }
}

function segDist(u, v, ax, ay, bx, by) {
  const dx = bx - ax; const dy = by - ay;
  const t = clamp01(((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy || 1e-9));
  return Math.hypot(u - ax - dx * t, v - ay - dy * t);
}

function makeCraters(rng) {
  const big = new Buckets(1);
  const small = new Buckets(0.5);
  const list = [];
  const crater = (e, n, r, ratio, rim, fresh) => {
    const c = { x: planX(e), z: planZ(n), R: r / M, depth: (2 * r * ratio) / M, rim, fresh, e, n, r };
    list.push(c);
    return c;
  };
  const LW = SITE.crater;
  big.add(crater(LW.e, LW.n, LW.r, LW.depth / (2 * LW.r), 0.12, 0.7), (2.2 * LW.r) / M);
  // A pair of overlapping craters a few strides east of the lander.
  big.add(crater(12, 4.6, 2.8, 0.15, 0.1, 0.4), (2.2 * 2.8) / M);
  big.add(crater(15.6, 2.4, 2.1, 0.14, 0.1, 0.3), (2.2 * 2.1) / M);
  const keepClear = [[0, 0, 8.5], [...SITE.flag, 2.5], [...SITE.swc, 2.5], [...SITE.tv, 2.5], [...SITE.lrrr, 2.5], [...SITE.psep, 3]];
  let tries = 0;
  let placed = 0;
  while (placed < 160 && tries < 4000) {
    tries++;
    const e = planE(X0 + rng() * W);
    const n = planN(Z0 + rng() * D);
    const r = 0.7 * Math.pow(10, rng() ** 2.4);
    if (Math.hypot(e - LW.e, n - LW.n) < LW.r + r * 0.6) continue;
    if (keepClear.some(([ke, kn, kr]) => Math.hypot(e - ke, n - kn) < kr + r)) continue;
    // A big crater cut by a face reads as a chip out of the block's corner rather than a crater.
    const x = planX(e); const z = planZ(n);
    if (r > 2 && Math.min(W / 2 - Math.abs(x), D / 2 - Math.abs(z)) < (1.4 * r) / M) continue;
    // Nobody walked through the middle of a crater bigger than a stride or two, so the big ones are
    // kept off the trails.
    if (r > 1.6 && PATHS.some((path) => path.some((p, i) => i > 0 && segDist(e, n, ...path[i - 1], ...p) < r + 0.8))) continue;
    const ratio = 0.06 + rng() * rng() * 0.13;
    big.add(crater(e, n, r, ratio, 0.04 + ratio * 0.5, ratio > 0.14 ? 0.5 : 0), (2.2 * r) / M);
    placed++;
  }
  // Craters too small for the mesh, used only to shade the painting.
  const fine = [];
  for (let i = 0; i < 2600; i++) {
    const e = planE(X0 + rng() * W);
    const n = planN(Z0 + rng() * D);
    if (Math.hypot(e, n) < 6) continue;
    const r = 0.12 + rng() * rng() * 0.8;
    const c = { x: planX(e), z: planZ(n), R: r / M, depth: (2 * r * (0.08 + rng() * 0.08)) / M, rim: 0.1, fresh: rng() > 0.86 ? 0.4 : 0 };
    fine.push(c);
    small.add(c, 2.2 * c.R);
  }
  return { big, small, list };
}

function cratered(buckets, x, z) {
  let y = 0;
  for (const c of buckets.at(x, z)) {
    const q = Math.hypot(x - c.x, z - c.z) / c.R;
    if (q < 2.2) y += bowl(q, c.rim) * c.depth;
  }
  return y;
}

// A fresh crater throws out brighter rock, so its rim and a halo round it are lighter than the
// older ground around it.
function halo(buckets, x, z) {
  let h = 0;
  for (const c of buckets.at(x, z)) {
    if (!c.fresh) continue;
    const q = Math.hypot(x - c.x, z - c.z) / c.R;
    if (q < 2.2) h = Math.max(h, c.fresh * (q < 1 ? 0.35 + 0.65 * q * q : 1 - sstep(q, 1, 2.2)));
  }
  return h;
}

// ---------------------------------------------------------------------------------------------
// The trails. Rasterised once at the painting's own resolution, so each bootprint is a few texels.
// ---------------------------------------------------------------------------------------------
const ringPath = (r, n = 26) => Array.from({ length: n + 1 }, (_, i) => {
  const a = Math.PI + (i / n) * TAU * 0.96;
  return [Math.cos(a) * r, Math.sin(a) * r];
});
export const PATHS = [
  // Armstrong's walk, the longest of the day: from the experiments out to the rim of Little West
  // Crater, along it, and back to the lander.
  [[-0.5, -21], [8, -17], [20, -12.5], [33, -8.5], [46, -5.5], [57, -3.6], [63.5, -2.8]],
  [[63.5, -2.8], [64.6, -0.5], [64.2, 2.2], [62.5, 3.6]],
  [[62.5, 3.6], [50, 4.2], [37, 4.4], [24, 3.6], [12, 1.4], [4, 0.6]],
  // Out to the television camera and back.
  [[-3.5, 1.5], [-6.5, 6.5], [-9.5, 11.5], [-11.6, 14.6]],
  [[-12.4, 14.8], [-9.2, 10.6], [-6.0, 5.6], [-3.0, 2.4]],
  // Carrying the two experiments out, and back.
  [[-1.6, -3.5], [-2.1, -9], [-1.8, -15], [-1.4, -20.8], [0.4, -27.6]],
  [[1.6, -27.8], [1.4, -21], [1.0, -14], [0.6, -8], [0.2, -3.8]],
  // The flag and the solar wind sheet.
  [[-3.2, 0.8], [-5.4, 1.9], [-7.2, 2.9]],
  [[-3, -1.4], [-5, -3.2], [-6.6, -4.4]],
  // The walk round the lander, photographing it from every side.
  ringPath(7.6),
];
const CABLE = [[-12, 14.6], [-10.4, 11.2], [-7.6, 8.6], [-5.2, 5.2], [-2.8, 2.4]];

function toPx(e, n) { return [(planX(e) - X0) * PX, (planZ(n) - Z0) * PX]; }
const PX_PER_M = PX / M;

function stamp(arr, cx, cy, a, b, ang, value) {
  const reach = Math.max(a, b) + 1;
  const c = Math.cos(ang); const s = Math.sin(ang);
  const x0 = Math.max(0, Math.floor(cx - reach)); const x1 = Math.min(TEX_W - 1, Math.ceil(cx + reach));
  const y0 = Math.max(0, Math.floor(cy - reach)); const y1 = Math.min(TEX_H - 1, Math.ceil(cy + reach));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = px + 0.5 - cx; const dy = py + 0.5 - cy;
      const lx = (dx * c + dy * s) / a; const ly = (-dx * s + dy * c) / b;
      const q = lx * lx + ly * ly;
      if (q >= 1) continue;
      const v = value * (1 - sstep(q, 0.45, 1));
      const k = px + py * TEX_W;
      if (v > arr[k]) arr[k] = v;
    }
  }
}

function walk(path, step, fn) {
  let carry = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [ae, an] = path[i]; const [be, bn] = path[i + 1];
    const len = Math.hypot(be - ae, bn - an);
    const de = (be - ae) / len; const dn = (bn - an) / len;
    let s = carry;
    while (s < len) { fn(ae + de * s, an + dn * s, de, dn); s += step; }
    carry = s - len;
  }
}

function makeTrails(rng) {
  const band = new Float32Array(TEX_W * TEX_H);
  const prints = new Float32Array(TEX_W * TEX_H);
  const boot = (e, n, de, dn, side, value = 1) => {
    const ox = -dn * side * 0.12; const on = de * side * 0.12;
    const [px, py] = toPx(e + ox + (rng() - 0.5) * 0.08, n + on + (rng() - 0.5) * 0.08);
    // Texel y runs south, so a northward heading is a negative texel step.
    const ang = Math.atan2(-dn, de) + (rng() - 0.5) * 0.3;
    stamp(prints, px, py, 0.16 * PX_PER_M, 0.065 * PX_PER_M, ang, value);
  };
  for (const path of PATHS) {
    walk(path, 0.25, (e, n) => {
      const [px, py] = toPx(e, n);
      stamp(band, px, py, 0.5 * PX_PER_M, 0.5 * PX_PER_M, 0, 0.75);
    });
    let side = 1;
    walk(path, 0.42, (e, n, de, dn) => { boot(e, n, de, dn, side); side = -side; });
  }
  // The ground round the lander was trampled all over.
  for (let i = 0; i < 950; i++) {
    const a = rng() * TAU; const r = 3 + Math.sqrt(rng()) * 8.5;
    const e = Math.cos(a) * r; const n = Math.sin(a) * r;
    const h = rng() * TAU;
    boot(e, n, Math.cos(h), Math.sin(h), rng() > 0.5 ? 1 : -1, 0.4 + rng() * 0.4);
  }
  for (let py = 0; py < TEX_H; py++) {
    for (let px = 0; px < TEX_W; px++) {
      const e = planE(X0 + (px + 0.5) / PX); const n = planN(Z0 + (py + 0.5) / PX);
      const r = Math.hypot(e, n);
      if (r < 12) { const k = px + py * TEX_W; band[k] = Math.max(band[k], 0.8 * (1 - sstep(r, 6, 12))); }
    }
  }
  // The television cable, laid on the ground from the camera back to the lander.
  walk(CABLE, 0.08, (e, n) => {
    const [px, py] = toPx(e, n);
    stamp(prints, px, py, 0.09 * PX_PER_M, 0.09 * PX_PER_M, 0, 0.75);
  });
  return { band, prints };
}

const texel = (x, z) => {
  const px = Math.min(TEX_W - 1, Math.max(0, Math.floor((x - X0) * PX)));
  const py = Math.min(TEX_H - 1, Math.max(0, Math.floor((z - Z0) * PX)));
  return px + py * TEX_W;
};

// ---------------------------------------------------------------------------------------------
// The soccer field, at the same scale as everything else: its markings as runs of points in metres
// east and north of the lander, stamped into the painting the way the trails are. The lines are
// drawn wider than the real 12 cm, because at this scale that is a fraction of a texel.
// ---------------------------------------------------------------------------------------------
export function pitchMarkings() {
  const P = SITE.pitch;
  const hl = P.length / 2; const hw = P.width / 2;
  const at = (u, v) => [P.e + u, P.n + v];
  const runs = [];
  const line = (a, b, c, d) => runs.push([at(a, b), at(c, d)]);
  const arc = (cu, cv, r, a0, a1) => {
    const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) * r / 0.3));
    runs.push(Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return at(cu + Math.cos(a) * r, cv + Math.sin(a) * r); }));
  };
  line(-hl, -hw, hl, -hw); line(hl, -hw, hl, hw); line(hl, hw, -hl, hw); line(-hl, hw, -hl, -hw);
  line(0, -hw, 0, hw);
  arc(0, 0, 9.15, 0, TAU);
  for (const s of [-1, 1]) {
    const g = s * hl; const box = s * (hl - 16.5); const six = s * (hl - 5.5); const spot = s * (hl - 11);
    line(g, -20.16, box, -20.16); line(box, -20.16, box, 20.16); line(box, 20.16, g, 20.16);
    line(g, -9.16, six, -9.16); line(six, -9.16, six, 9.16); line(six, 9.16, g, 9.16);
    // The arc at the edge of the penalty area, outside the box only: it meets the box line where
    // cos(a) = 5.5 / 9.15.
    const half = Math.acos(5.5 / 9.15);
    if (s > 0) arc(spot, 0, 9.15, Math.PI - half, Math.PI + half); else arc(spot, 0, 9.15, -half, half);
    runs.push([at(spot, 0), at(spot, 0)]);
    // Corner arcs: the quarter circle from the goal line round to the touch line, inside the field.
    for (const cv of [-hw, hw]) {
      const toGoal = s > 0 ? Math.PI : 0;
      let toTouch = cv > 0 ? -Math.PI / 2 : Math.PI / 2;
      if (Math.abs(toTouch - toGoal) > Math.PI) toTouch += toTouch < toGoal ? TAU : -TAU;
      arc(g, cv, 1, toGoal, toTouch);
    }
  }
  runs.push([at(0, 0), at(0, 0)]);
  return runs;
}

function makePitch() {
  const lines = new Float32Array(TEX_W * TEX_H);
  for (const run of pitchMarkings()) {
    const dot = run.length === 2 && run[0][0] === run[1][0] && run[0][1] === run[1][1];
    if (dot) {
      const [px, py] = toPx(...run[0]);
      stamp(lines, px, py, 0.4 * PX_PER_M, 0.4 * PX_PER_M, 0, 1);
      continue;
    }
    walk(run, 0.12, (e, n) => {
      const [px, py] = toPx(e, n);
      stamp(lines, px, py, 0.27 * PX_PER_M, 0.27 * PX_PER_M, 0, 1);
    });
    const [px, py] = toPx(...run[run.length - 1]);
    stamp(lines, px, py, 0.27 * PX_PER_M, 0.27 * PX_PER_M, 0, 1);
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Hardware helpers. Everything is a closed solid.
// ---------------------------------------------------------------------------------------------
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const rod = (a, b, r, sides = 6) => tube([a, b], r, { sides, steps: 1, round: 0, straight: true });

// A closed solid lofted through sections of equal point count, capped with centre fans. Facets
// are kept flat, because the lander was all flat panels.
function loft(sections, { flat = true } = {}) {
  const n = sections[0].length;
  const pos = [];
  for (const s of sections) for (const p of s) pos.push(p[0], p[1], p[2]);
  const idx = [];
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      const a = i * n + j; const b = i * n + j2; const c = (i + 1) * n + j2; const d = (i + 1) * n + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  for (const [si, flip] of [[0, true], [sections.length - 1, false]]) {
    const s = sections[si];
    const cen = s.reduce((acc, p) => [acc[0] + p[0] / n, acc[1] + p[1] / n, acc[2] + p[2] / n], [0, 0, 0]);
    const ci = pos.length / 3;
    pos.push(cen[0], cen[1], cen[2]);
    for (let j = 0; j < n; j++) {
      const a = si * n + j; const b = si * n + ((j + 1) % n);
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g = outward(g);
  if (flat) { g = g.toNonIndexed(); g.computeVertexNormals(); } else g.computeVertexNormals();
  return g;
}

// A thin closed plate laid on a face: the quad sunk a little into it and lifted out along `n`.
function plate(quad, n, thick, sink = 0.02) {
  const N = n.clone().normalize();
  const lo = quad.map((p) => V3(...p).addScaledVector(N, -sink).toArray());
  const hi = quad.map((p) => V3(...p).addScaledVector(N, thick).toArray());
  return loft([lo, hi]);
}

function boxG(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function xform(g, m) { const c = g.clone(); c.applyMatrix4(m); return c; }

// ---------------------------------------------------------------------------------------------
// The Lunar Module, at the end of the moonwalk with both stages on the pad. Authored in the real
// vehicle's feet with +Z out of the hatch, and carried into the plan by one matrix. A lighter build
// than the Model Database's own Lunar Module, which is five meshes on its own.
// ---------------------------------------------------------------------------------------------
const GOLD = 0xe2a636; const AMBER = 0xcf9228; const BLACK = 0x2c2a28; const SILVER = 0xc4c6c9;
const CABIN = 0x9fa2a6; const CABIN_DARK = 0x6f7276; const DARK = 0x262628; const STRUT = 0x9a9995;

function lunarModule(add, decal) {
  const APO = 6.9; const CHAMFER = 2.6; const DECK = 10.7; const BELLY = 5.0;
  const half = APO - CHAMFER;
  const oct = [[-half, APO], [half, APO], [APO, half], [APO, -half], [half, -APO], [-half, -APO], [-APO, -half], [-APO, half]];
  add(loft([oct.map(([x, z]) => [x, BELLY, z]), oct.map(([x, z]) => [x, DECK, z])]), GOLD);
  // The short faces, amber with black insulation over their upper part.
  for (const i of [1, 3, 5, 7]) {
    const p = oct[i]; const q = oct[(i + 1) % 8];
    const n = V3((p[0] + q[0]) / 2, 0, (p[1] + q[1]) / 2).normalize();
    add(plate([[p[0], BELLY + 0.2, p[1]], [q[0], BELLY + 0.2, q[1]], [q[0], DECK - 2.3, q[1]], [p[0], DECK - 2.3, p[1]]], n, 0.06), AMBER);
    add(plate([[p[0], DECK - 2.3, p[1]], [q[0], DECK - 2.3, q[1]], [q[0], DECK - 0.06, q[1]], [p[0], DECK - 0.06, p[1]]], n, 0.08), BLACK);
  }
  // The belly heat shield and the descent engine bell under it.
  add(lathe([[0, BELLY - 0.6], [2.0, BELLY - 0.5], [3.5, BELLY - 0.05], [3.5, BELLY + 0.02], [0, BELLY + 0.02]], 24), 0x8a8378);
  add(lathe([[0, 1.55], [2.47, 1.55], [2.0, 2.25], [1.45, 3.5], [1.08, 4.75], [1.04, 5.0], [0, 5.0]], 20), 0x5c4d44);

  // Landing gear, a plus in plan, each leg in a frame of (t across, y up, o outward).
  for (const [ex, ez, front] of [[0, 1, true], [1, 0, false], [0, -1, false], [-1, 0, false]]) {
    const Wf = (t, y, o) => [ez * t + ex * o, y, -ex * t + ez * o];
    const top = Wf(0, 9.5, 8.0); const pad = Wf(0, 0.72, 14.0);
    const at = (f) => [mix(top[0], pad[0], f), mix(top[1], pad[1], f), mix(top[2], pad[2], f)];
    add(rod(top, at(0.68), 0.44, 8), GOLD);
    add(rod(at(0.66), pad, 0.27, 8), 0xc4c5c6);
    add(rod(Wf(0, 9.5, APO - 0.05), top, 0.2, 6), GOLD);
    for (const t of [-3.4, 3.4]) add(rod(Wf(t, 10.15, APO - 0.05), Wf(0, 9.75, 7.8), 0.16, 5), GOLD);
    const waist = at(0.56);
    for (const t of [-half + 0.1, half - 0.1]) add(rod(Wf(t, BELLY + 0.35, APO - 0.04), waist, 0.2, 6), AMBER);
    add(rod(Wf(0, BELLY + 0.2, APO - 0.04), waist, 0.11, 5), STRUT);
    const padGeo = lathe([[0, 0], [0.82, 0], [1.3, 0.2], [1.55, 0.44], [1.5, 0.56], [1.0, 0.52], [0.38, 0.62], [0, 0.72]], 18);
    padGeo.translate(pad[0], 0, pad[2]);
    add(padGeo, SILVER);
    if (front) {
      // The ladder rides the front strut, and the porch is level with the deck at the hatch.
      const dO = 14.0 - 8.0; const dY = 0.72 - 9.5; const len = Math.hypot(dO, dY);
      const nO = -dY / len; const nY = dO / len;
      const lad = (f, t) => Wf(t, 9.5 + dY * f + nY * 0.62, 8.0 + dO * f + nO * 0.62);
      for (const t of [-0.88, 0.88]) add(rod(lad(-0.1, t), lad(0.78, t), 0.08, 4), 0xd0d1d2);
      for (let i = 0; i < 8; i++) {
        const f = -0.05 + (0.78 * i) / 7;
        add(rod(lad(f, -0.88), lad(f, 0.88), 0.06, 4), 0xe2e2e2);
      }
      const porchO = lad(-0.1, 0)[2] + 0.3;
      add(boxG(3.9, 0.14, porchO - APO + 0.2, 0, DECK + 0.08, (APO - 0.2 + porchO) / 2), 0x9fa0a0);
      for (const s of [-1, 1]) add(tube([[s * 1.95, DECK + 0.14, porchO - 0.05], [s * 1.95, DECK + 3.05, porchO - 1.0], [s * 1.9, DECK + 3.65, 5.3]], 0.06, { sides: 4, steps: 6 }), 0xd8d8d6);
    }
  }
  // The equipment bay left of the ladder, and the flag and the country's name right of it.
  add(plate([[-4.05, 9.8, APO], [-1.45, 9.8, APO], [-1.45, 6.2, APO], [-4.05, 6.2, APO]], V3(0, 0, 1), 0.2), SILVER);
  decal(boxG(2.6, 2.35, 0.12, 2.75, 8.72, APO + 0.04), 4, 'lm');

  // --- The ascent stage, all flat panels, because it flew only in space.
  const Y = (y) => DECK + y;
  const sec = (z, pts) => pts.map(([x, y]) => [x, Y(y), z]);
  add(boxG(5.9, 1.0, 7.4, 0, Y(0.42), 0.3), 0x47484b);
  const NOSE = [[-1.5, 0.5], [1.5, 0.5], [1.85, 2.1], [1.72, 4.55], [1.15, 5.25], [-1.15, 5.25], [-1.72, 4.55], [-1.85, 2.1]];
  const FULL = [[-3.15, 0.2], [3.15, 0.2], [4.35, 1.95], [4.75, 4.55], [3.0, 7.0], [-3.0, 7.0], [-4.75, 4.55], [-4.35, 1.95]];
  const AFTC = [[-3.15, 0.2], [3.15, 0.2], [4.35, 1.95], [4.6, 4.55], [3.0, 6.95], [-3.0, 6.95], [-4.6, 4.55], [-4.35, 1.95]];
  add(loft([sec(5.3, NOSE), sec(2.75, FULL), sec(-0.75, AFTC)]), CABIN);
  const MID = [[-3.3, 0.5], [3.3, 0.5], [3.7, 1.9], [3.7, 4.6], [2.5, 6.25], [-2.5, 6.25], [-3.7, 4.6], [-3.7, 1.9]];
  add(loft([sec(-0.73, MID), sec(-3.3, MID)]), CABIN_DARK);
  add(boxG(4.6, 3.2, 1.2, 0, Y(3.3), -3.85), 0x4a4b4e);
  add(boxG(5.8, 3.7, 1.95, 0, Y(3.35), -5.33), 0x3b3c40);
  // The propellant tanks bulging from the flanks.
  for (const [x, r] of [[-3.5, 2.35], [3.05, 2.25]]) {
    const g = new THREE.SphereGeometry(r, 12, 8);
    g.scale(1, 0.86, 1);
    g.translate(x, Y(2.75), -2.05);
    add(g, 0x8f9296);
  }
  // The docking tunnel on top, and the hump over the ascent engine behind it.
  add(lathe([[0, 6.6], [1.45, 6.6], [1.45, 7.6], [1.62, 7.7], [1.62, 7.95], [0, 7.95]], 18).translate(0, DECK, 0.15), 0x8b8e92);
  add(lathe([[0, 5.6], [1.7, 5.6], [1.75, 6.3], [1.45, 6.8], [0.9, 7.1], [0, 7.2]], 14).translate(0, DECK, -2.6), 0x7a7d80);
  // The windows: dark triangles on the facets between the nose and the full section.
  for (const s of [-1, 1]) {
    const facet = (fs, ft) => {
      const a = V3(s * 1.85, Y(2.1), 5.3); const b = V3(s * 1.72, Y(4.55), 5.3);
      const c = V3(s * 4.75, Y(4.55), 2.75); const d = V3(s * 4.35, Y(1.95), 2.75);
      return a.clone().lerp(d, fs).lerp(b.clone().lerp(c, fs), ft);
    };
    const n = facet(1, 0).sub(facet(0, 0)).cross(facet(0, 1).sub(facet(0, 0))).normalize();
    if (n.z < 0) n.negate();
    const tri = [facet(0.14, 0.86), facet(0.84, 0.86), facet(0.22, 0.2)];
    add(plate(tri.map((p) => p.toArray()), n, 0.1), 0x141c26);
  }
  // The square hatch in the flat of the nose.
  add(plate([[-1.3, Y(0.8), 5.3], [1.3, Y(0.8), 5.3], [1.3, Y(3.4), 5.3], [-1.3, Y(3.4), 5.3]], V3(0, 0, 1), 0.14), 0xb2b4b6);
  // The four thruster clusters on their outriggers.
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const c = sz > 0 ? [sx * 6.15, Y(4.75), 3.4] : [sx * 5.0, Y(4.75), -5.6];
    add(boxG(0.8, 0.8, 0.8, ...c), 0x4f5154);
    const root = sz > 0 ? [sx * 4.4, Y(4.7), 2.1] : [sx * 2.8, Y(4.6), -4.6];
    add(rod(root, c, 0.09, 5), 0x8c8e91);
    for (const dir of [[0, 1, 0], [0, -1, 0], [sx, 0, 0], [0, 0, sz]]) {
      const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), V3(...dir));
      const m = new THREE.Matrix4().compose(V3(...c).addScaledVector(V3(...dir), 0.35), q, V3(1, 1, 1));
      add(xform(new THREE.ConeGeometry(0.28, 0.8, 8).translate(0, 0.4, 0), m), 0xbdb7a8);
    }
  }
  // The rendezvous radar dish over the nose and the steerable S-band dish on its boom.
  const dish = (x, y, z, r, tilt, yaw) => {
    const m = new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(new THREE.Matrix4().makeRotationX(tilt));
    add(xform(lathe([[0, 0], [r, r * 0.4], [r * 0.9, r * 0.48], [0, r * 0.12]], 16), m), 0xe2e2df);
  };
  add(rod([-1.1, Y(6.25), 3.15], [-1.1, Y(7.6), 3.1], 0.12, 6), 0x77797c);
  dish(-1.1, Y(7.6), 3.1, 1.0, 0.55, 0.15);
  add(rod([2.2, Y(5.7), -1.6], [3.0, Y(7.7), -1.9], 0.09, 6), 0x77797c);
  dish(3.05, Y(7.7), -1.95, 1.05, -0.6, 1.0);
  add(tube([[-2.2, Y(5.9), -2.2], [-2.45, Y(9.4), -2.4], [-2.95, Y(12.2), -3.1]], 0.05, { sides: 4, steps: 6 }), 0xd5d5d5);
}

// ---------------------------------------------------------------------------------------------
// The painted faces: the flag, the lander's decal, the reflector's array and the solar cells.
// ---------------------------------------------------------------------------------------------
const ATLAS_W = 1024; const ATLAS_H = 512;
const REGION = {
  flag: [0, 0, 600, 360],
  lm: [620, 0, 1020, 360],
  lrrr: [0, 380, 128, 508],
  cells: [150, 380, 406, 508],
};
const uvRect = (r) => [r[0] / ATLAS_W, 1 - r[3] / ATLAS_H, r[2] / ATLAS_W, 1 - r[1] / ATLAS_H];

function drawFlag(ctx, x, y, w, h) {
  for (let i = 0; i < 13; i++) {
    ctx.fillStyle = i % 2 ? '#f3f2ec' : '#b52a39';
    ctx.fillRect(x, y + (i * h) / 13, w, h / 13 + 0.6);
  }
  const cw = w * 0.4; const ch = (h * 7) / 13;
  ctx.fillStyle = '#26316a';
  ctx.fillRect(x, y, cw, ch);
  ctx.fillStyle = '#f6f6f6';
  for (let r = 0; r < 9; r++) {
    const cols = r % 2 ? 5 : 6;
    for (let c = 0; c < cols; c++) {
      ctx.beginPath();
      ctx.arc(x + (cw * (c + (r % 2 ? 1 : 0.5))) / 6, y + ch * ((r + 0.8) / 10), Math.max(1.2, w * 0.007), 0, TAU);
      ctx.fill();
    }
  }
}

function paintAtlas(ctx) {
  ctx.fillStyle = '#d9a437';
  ctx.fillRect(0, 0, ATLAS_W, ATLAS_H);
  const [fx0, fy0, fx1, fy1] = REGION.flag;
  drawFlag(ctx, fx0, fy0, fx1 - fx0, fy1 - fy0);
  // The lander's decal, painted on its own foil colour so it reads as paint on the blanket.
  const [lx0, ly0, lx1] = REGION.lm;
  const lw = lx1 - lx0;
  drawFlag(ctx, lx0 + 40, ly0 + 24, lw - 80, (lw - 80) * 0.53);
  ctx.fillStyle = '#17171a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 54;
  ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`;
  while (ctx.measureText('UNITED').width > lw - 90 && size > 18) { size -= 2; ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`; }
  ctx.fillText('UNITED', lx0 + lw / 2, ly0 + 24 + (lw - 80) * 0.53 + 50);
  ctx.fillText('STATES', lx0 + lw / 2, ly0 + 24 + (lw - 80) * 0.53 + 50 + size * 1.05);
  // A hundred corner-cube reflectors in rows of ten, in a bright frame.
  const [rx0, ry0, rx1, ry1] = REGION.lrrr;
  ctx.fillStyle = '#cfd1d3';
  ctx.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
  ctx.fillStyle = '#1b1e24';
  ctx.fillRect(rx0 + 8, ry0 + 8, rx1 - rx0 - 16, ry1 - ry0 - 16);
  const cell = (rx1 - rx0 - 16) / 10;
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      ctx.fillStyle = (i + j) % 3 ? '#5d6a7c' : '#7b8899';
      ctx.beginPath();
      ctx.arc(rx0 + 8 + cell * (i + 0.5), ry0 + 8 + cell * (j + 0.5), cell * 0.36, 0, TAU);
      ctx.fill();
    }
  }
  const [cx0, cy0, cx1, cy1] = REGION.cells;
  ctx.fillStyle = '#1a2a4c';
  ctx.fillRect(cx0, cy0, cx1 - cx0, cy1 - cy0);
  ctx.strokeStyle = '#7c8aa6';
  ctx.lineWidth = 2;
  for (let x = cx0; x <= cx1; x += 16) { ctx.beginPath(); ctx.moveTo(x, cy0); ctx.lineTo(x, cy1); ctx.stroke(); }
  for (let y = cy0; y <= cy1; y += 16) { ctx.beginPath(); ctx.moveTo(cx0, y); ctx.lineTo(cx1, y); ctx.stroke(); }
}

// A box whose face `face` (BoxGeometry order +x, -x, +y, -y, +z, -z) carries a region of the atlas,
// and whose other faces sample one texel of that region's own edge: foil for the lander's decal,
// aluminium for the reflector's frame, the panels' own blue for the solar cells.
const EDGE = { lm: [630, 350], lrrr: [3, 383], cells: [154, 384] };
function decalBox(g, face, region) {
  const [u0, v0, u1, v1] = uvRect(REGION[region]);
  const [ex, ey] = EDGE[region];
  const eu = (ex + 0.5) / ATLAS_W; const ev = 1 - (ey + 0.5) / ATLAS_H;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const f = Math.floor(i / 4);
    if (f === face) uv.setXY(i, mix(u0, u1, uv.getX(i)), mix(v0, v1, uv.getY(i)));
    else uv.setXY(i, eu, ev);
  }
  return g.toNonIndexed();
}

// The flag: a thin closed sheet, rippled where the top rod did not extend all the way, which is why
// the Apollo 11 flag looks as if it is waving. Authored in metres with the hoist at the origin.
function flagSheet() {
  const w = 1.45; const h = 0.91; const top = 2.08; const t = 0.012;
  const nu = 18; const nv = 6;
  const [u0, v0, u1, v1] = uvRect(REGION.flag);
  const P = (i, j, side) => {
    const u = i / nu; const v = j / nv;
    const ripple = 0.055 * Math.sin(u * Math.PI * 3.4 + 0.4) * sstep(u, 0, 0.12) + 0.02 * Math.sin(v * 2.1 + u * 9);
    return [u * w, top - v * h, ripple + side * t * 0.5];
  };
  const pos = []; const uv = [];
  const push = (p, q) => { pos.push(...p); uv.push(...q); };
  const tq = (i, j) => [mix(u0, u1, i / nu), mix(v1, v0, j / nv)];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const quad = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      // Front (+z), wound counter-clockwise from the front, and the back the other way.
      for (const k of [0, 3, 2, 0, 2, 1]) push(P(...quad[k], 1), tq(...quad[k]));
      for (const k of [0, 1, 2, 0, 2, 3]) push(P(...quad[k], -1), tq(...quad[k]));
    }
  }
  const edge = [];
  for (let i = 0; i < nu; i++) edge.push([i, 0], [i + 1, 0]);
  for (let j = 0; j < nv; j++) edge.push([nu, j], [nu, j + 1]);
  for (let i = nu; i > 0; i--) edge.push([i, nv], [i - 1, nv]);
  for (let j = nv; j > 0; j--) edge.push([0, j], [0, j - 1]);
  const rimUV = [mix(u0, u1, 0.7), mix(v0, v1, 0.04)];
  for (let k = 0; k < edge.length; k += 2) {
    const a = edge[k]; const b = edge[k + 1];
    const af = P(...a, 1); const bf = P(...b, 1); const ab = P(...a, -1); const bb = P(...b, -1);
    for (const p of [af, ab, bb, af, bb, bf]) push(p, rimUV);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g = outward(g);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------
function buildTranquility() {
  const rng = seededRandom(19690720);
  const craters = makeCraters(rng);
  const LW = craters.list[0];
  const trails = makeTrails(rng);
  const pitch = makePitch();

  const raw = (x, z) => GROUND + 0.018 * fbm(x * 0.35, z * 0.35, 3, 11) + 0.008 * fbm(x * 1.4, z * 1.4, 2, 12) + cratered(craters.big, x, z);
  const height = sampledField(W, D, 720, 480, raw);
  const fineField = sampledField(W, D, 1400, 933, (x, z) => raw(x, z) + cratered(craters.small, x, z) + 0.0015 * noise2(x * 38, z * 38, 13));
  const fine = (x, z) => fineField(x, z) - 0.0028 * trails.prints[texel(x, z)] - 0.0008 * trails.band[texel(x, z)];

  const paint = (x, z) => {
    const k = texel(x, z);
    const e = planE(x); const n = planN(z);
    const m = 8 * fbm(x * 0.5, z * 0.5, 3, 21) + 4 * noise2(x * 9, z * 9, 22);
    let c = [127 + m, 125 + m, 121 + m * 0.95];
    // Brighter where fresh craters threw out rock, and round the lander, where the descent engine's
    // exhaust scoured the surface: both show from orbit.
    const bright = 1 + 0.13 * Math.max(halo(craters.big, x, z), halo(craters.small, x, z) * 0.6) + 0.07 * (1 - sstep(Math.hypot(e, n), 9, 32));
    c = [c[0] * bright, c[1] * bright, c[2] * bright];
    // Disturbed regolith is darker than the undisturbed surface, which is how the tracks are seen.
    const dark = 1 - 0.2 * trails.band[k] - 0.24 * trails.prints[k];
    c = [c[0] * dark, c[1] * dark, c[2] * dark];
    // Faint, so it reads as a drawing laid over the Moon rather than a field painted on it.
    if (pitch[k] > 0) c = mixc(c, [214, 230, 248], 0.5 * pitch[k]);
    return c;
  };

  const strata = (x, z, y, ground) => {
    const dm = (ground - y) * M;
    const h = x + z;
    const reg = REGOLITH_M + 0.5 * noise2(h * 0.7, 3, 31);
    // Under Little West, the rock it broke and threw back in.
    const lw = Math.hypot(x - LW.x, z - LW.z) / LW.R;
    if (lw < 1.05 && dm < 1.2 + 0.3 * noise2(h * 3, y * 3, 35)) {
      const sp = noise2(h * 48, y * 48, 36);
      return sp > 0.35 ? [150, 146, 138] : [118, 114, 108];
    }
    if (dm < reg) {
      const sp = noise2(h * 52, y * 52, 33);
      const base = mixc([98, 95, 90], [112, 108, 102], sstep(dm, 0, 0.8));
      if (sp > 0.5 + 0.25 * (1 - dm / reg)) return [146, 142, 134];
      return base;
    }
    if (dm < reg + 1.6) {
      const f = noise2(h * 7, y * 7, 34);
      const crack = Math.abs(f) < 0.05 || Math.abs(noise2(h * 7 + 40, y * 9, 37)) < 0.04;
      return crack ? [52, 52, 55] : mixc([88, 88, 90], [104, 102, 98], clamp01(f + 0.5));
    }
    const ves = noise2(h * 70, y * 70, 38) > 0.6;
    const band = 0.5 + 0.5 * Math.sin(y * M * 1.3 + 0.8 * noise2(h * 0.6, y, 39));
    return ves ? [46, 46, 50] : mixc([66, 66, 70], [78, 77, 80], band);
  };

  const block = terrainBlock({
    w: W, d: D, plinth: PLINTH, nx: 160, nz: 106, height, fine, paint, strata,
    texW: TEX_W, relief: 0.32, lightAmount: 0.55, roughness: 0.94, strip: 320, plinthColor: 0x2e241b,
    labels: [
      { text: 'REGOLITH: LOOSE DUST AND BROKEN ROCK, ABOUT 4.4 M DEEP', x: -3.6, y: 1.1, size: 0.11 },
      { text: 'MARE BASALT: OLD LAVA ROCK', x: -3.6, y: 0.55, size: 0.11 },
      { text: 'PLAN TO SCALE: 1 FT = 6.5 M · EQUIPMENT 1.4 TIMES LARGER', x: 4.2, y: 0.55, size: 0.1 },
    ],
  });
  const { root } = block;
  const groundAt = (e, n) => height(planX(e), planZ(n));

  const batch = new Batch();
  const decals = [];

  // The lander, its hatch toward the west, which is where its shadow fell.
  const lmMatrix = new THREE.Matrix4().compose(
    V3(planX(0), groundAt(0, 0) - 0.012, planZ(0)),
    new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), -Math.PI / 2),
    V3(1, 1, 1).multiplyScalar(0.3048 * K),
  );
  lunarModule(
    (g, color) => batch.add(xform(g, lmMatrix), color),
    (g, face, region) => decals.push(xform(decalBox(g, face, region), lmMatrix)),
  );

  // Hardware authored in metres at its own spot on the plan.
  const at = (e, n, yaw = 0) => new THREE.Matrix4().compose(
    V3(planX(e), groundAt(e, n) - 0.004, planZ(n)),
    new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), yaw),
    V3(K, K, K),
  );
  const put = (g, color, m) => batch.add(xform(g, m), color);

  // The flag, its top rod pointing east, so its face is toward the front of the model.
  {
    const m = at(...SITE.flag);
    put(rod([0, -0.1, 0], [0, 2.14, 0], 0.022, 8), 0xd9dadb, m);
    put(rod([0, 2.1, 0.0], [1.47, 2.1, 0.0], 0.014, 6), 0xd9dadb, m);
    decals.push(xform(flagSheet(), m));
  }
  // The solar wind sheet: aluminium foil on a staff, turned to face the Sun in the east.
  {
    const m = at(...SITE.swc);
    put(rod([0, -0.1, 0], [0, 1.62, 0], 0.02, 6), 0xbcbec0, m);
    put(rod([0, 1.6, -0.18], [0, 1.6, 0.18], 0.012, 5), 0xbcbec0, m);
    put(boxG(0.012, 1.3, 0.3, 0.02, 0.95, 0), 0xe4e6e8, m);
  }
  // The television camera on its tripod, looking back at the lander.
  {
    // Local +Z is the lens; from the camera the lander lies 12 m east and 15 m south.
    const yaw = Math.atan2(12, 15);
    const m = at(...SITE.tv, yaw);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      put(rod([Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42], [0, 1.25, 0], 0.016, 5), 0xc9cacb, m);
    }
    put(boxG(0.18, 0.15, 0.3, 0, 1.33, 0), 0x2a2b2e, m);
    put(rod([0, 1.33, 0.14], [0, 1.33, 0.24], 0.045, 10), 0x111214, m);
  }
  // The laser reflector: a hundred corner cubes in an aluminium panel, tilted toward the Earth.
  {
    const m = at(...SITE.lrrr);
    put(boxG(0.62, 0.12, 0.5, 0, 0.06, 0), 0xc7c9cc, m);
    put(rod([-0.2, 0.1, 0.18], [-0.2, 0.42, 0.05], 0.02, 5), 0xa9abae, m);
    put(rod([0.2, 0.1, 0.18], [0.2, 0.42, 0.05], 0.02, 5), 0xa9abae, m);
    const panel = boxG(0.48, 0.05, 0.48);
    const tilt = new THREE.Matrix4().makeTranslation(0, 0.32, 0).multiply(new THREE.Matrix4().makeRotationZ(0.4));
    decals.push(xform(decalBox(panel, 2, 'lrrr'), m.clone().multiply(tilt)));
  }
  // The seismometer, between its two solar panels, with its small antenna.
  {
    const m = at(...SITE.psep);
    put(boxG(0.66, 0.06, 0.66, 0, 0.03, 0), 0x9b9a96, m);
    put(boxG(0.46, 0.4, 0.46, 0, 0.26, 0), 0xd5a23c, m);
    put(new THREE.CylinderGeometry(0.15, 0.17, 0.14, 12).translate(0, 0.53, 0), 0xd7d9dc, m);
    put(rod([0.12, 0.45, 0.12], [0.12, 1.0, 0.12], 0.012, 5), 0xd0d0d0, m);
    put(new THREE.ConeGeometry(0.06, 0.12, 8).translate(0.12, 1.06, 0.12), 0xe0e0e0, m);
    for (const s of [-1, 1]) {
      const wing = boxG(1.0, 0.025, 0.58);
      const mw = new THREE.Matrix4().makeTranslation(s * 0.75, 0.42, 0).multiply(new THREE.Matrix4().makeRotationZ(s * 0.12));
      decals.push(xform(decalBox(wing, 2, 'cells'), m.clone().multiply(mw)));
      put(rod([s * 0.23, 0.4, 0], [s * 0.3, 0.42, 0], 0.03, 5), 0x8f9093, m);
    }
  }
  // Rocks thrown out of Little West, round its rim, at the plan's own scale.
  for (let i = 0; i < 70; i++) {
    const a = rng() * TAU; const r = LW.r * (0.85 + rng() * 0.7);
    const e = LW.e + Math.cos(a) * r; const n = LW.n + Math.sin(a) * r;
    const x = planX(e); const z = planZ(n);
    if (x > W / 2 - 0.08 || Math.abs(z) > D / 2 - 0.08) continue;
    const s = (0.15 + rng() * rng() * 0.75) / M;
    const g = new THREE.IcosahedronGeometry(1, 0);
    batch.add(g, [0.2 + rng() * 0.06, 0.195 + rng() * 0.05, 0.185 + rng() * 0.05], {
      position: [x, height(x, z) + s * 0.25, z], scale: [s * (0.8 + rng() * 0.5), s * (0.5 + rng() * 0.4), s * (0.8 + rng() * 0.5)], rotation: [rng() * 3, rng() * 3, 0],
    });
  }

  // Signs, low and beside what they name, on posts as thin as the flag's own pole. The kit's own posts
  // are sized for a landscape, and next to a suitcase-sized seismometer they read as telegraph poles.
  const sign = (text, e, n, lift) => {
    const x = planX(e); const z = planZ(n);
    const g = height(x, z);
    batch.add(rod([x, g - 0.02, z], [x, g + lift + 0.01, z], 0.0075, 6), 0x8b8f94);
    return { text, x, z, y: g + lift, ground: g + lift - 0.001 };
  };
  signs(root, batch, [
    sign('Eagle, the Lunar Module', 12, -8.5, 0.36),
    sign('U.S. flag', -13.5, 3.5, 0.46),
    sign('TV camera', -19, 15.5, 0.34),
    sign('Solar wind foil', -14.5, -6, 0.24),
    sign('Laser reflector', -6.8, -20.8, 0.26),
    sign('Seismometer', 8.5, -28.7, 0.24),
    sign('Little West Crater', 59, 8, 0.3),
    sign('Armstrong’s longest walk', 34, -11.8, 0.18),
    sign('A soccer field, same scale', SITE.pitch.e - SITE.pitch.length / 2 + 12, SITE.pitch.n - SITE.pitch.width / 2 + 2.6, 0.14),
    sign('Tranquility Base · Apollo 11 · 20 July 1969', 40, -41.6, 0.16),
  ], { plate: 0.13 });

  root.add(batch.mesh({ roughness: 0.62, metalness: 0.1 }));

  const atlas = canvasTexture(ATLAS_W, ATLAS_H, (ctx) => paintAtlas(ctx));
  const decalMesh = mesh(mergeGeometries(decals), standard({ map: atlas, roughness: 0.66, metalness: 0.05 }));
  root.add(decalMesh);
  return root;
}

export const BUILDERS = {
  'tranquility-base': () => buildTranquility(),
};
