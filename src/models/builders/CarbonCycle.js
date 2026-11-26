import * as THREE from 'three';
import {
  terrainBlock, Batch, addBroadleaf, addPine, addHouse, blobGeometry, seededRandom,
  mixc, clamp01, sstep, mix, noise2, fbm, TAU,
} from '../geo/GeoKit.js';
import { mesh, standard, canvasTexture } from '../../PropKit.js';
import { reducedMotion } from '../../Settings.js';

// The carbon cycle, as a diagram standing on a landscape. ONE IDEA carries it: THE NATURAL FLOWS
// COME IN PAIRS THAT NEARLY BALANCE, AND THE FLOW FROM BURNING FUEL HAS NO PARTNER. So the block is
// a forest on the left, a coast and an ocean on the right, a mine, an oil well and a power plant
// between them, and a small volcano for comparison. Over it floats THE AIR, and every way carbon
// moves between the air and the rest is an arrow between the two.
//
// THE RULE: AN ARROW'S WIDTH IS PROPORTIONAL TO ITS FLOW. K feet of width per billion tonnes of
// carbon a year (GtC/yr), measured across the shaft in the plane the arrows are drawn in. Heads are
// not to scale. Two flows are far too small to draw that way (cutting forests and volcanoes), so
// they are drawn at MIN_W instead, striped, with an asterisk on their numbers, and the legend says
// so. Nothing else is adjusted: the fossil arrow really is fourteen times thinner than the one into
// the forest, which is the lesson.
//
// The beads moving along the arrows all travel at one speed, and an arrow carries as many lanes of
// them as its width holds, so a wider arrow carries more. On the two drawn at minimum width the
// beads are spaced out by the same factor the arrow was widened, so a bead on the volcano's arrow
// is rare. reducedMotion() leaves them where they are.
//
// Numbers: gross fluxes and stocks from IPCC AR6 WG1 Figure 5.12 (2010-2019 averages, natural plus
// the anthropogenic change); human emissions and the atmospheric growth rate from the Global Carbon
// Budget 2024 (Friedlingstein et al. 2025, ESSD 17, 965), for 2023. The air's stock is the 2024
// concentration times 2.124 GtC per ppm.
//
// Six meshes: ground, water and cut faces (terrainBlock, its wooden base folded into the scenery),
// the scenery batch, the arrows with the air and the moving beads, and the labels. Authored in
// feet, origin at the base centre, front toward +Z.

const AR6 = 'IPCC AR6 WG1 (2021) Chapter 5, Figure 5.12: 2010-2019 average, natural plus anthropogenic';
const GCB = 'Global Carbon Budget 2024 (Friedlingstein et al. 2025, Earth Syst. Sci. Data 17, 965): year 2023';

// Yearly flows, in billions of tonnes of carbon (GtC/yr).
export const CARBON_FLUXES = [
  { id: 'photosynthesis', name: 'Plants take in (photosynthesis)', from: 'air', to: 'land', gtc: 142, kind: 'natural', source: `${AR6}: 113 + 29` },
  { id: 'respiration', name: 'Breathing, rotting and fire', from: 'land', to: 'air', gtc: 137, kind: 'natural', source: `${AR6}: 111.1 + 25.6` },
  { id: 'ocean-uptake', name: 'Ocean takes in', from: 'air', to: 'ocean', gtc: 80, kind: 'natural', source: `${AR6}: 54.0 + 25.5` },
  { id: 'ocean-release', name: 'Ocean gives off', from: 'ocean', to: 'air', gtc: 78, kind: 'natural', source: `${AR6}: 54.6 + 23` },
  { id: 'fossil', name: 'Burning coal, oil and gas', from: 'fossil fuels', to: 'air', gtc: 10, kind: 'human', source: `${GCB}: 10.1 ± 0.5 (cement included)` },
  { id: 'land-use', name: 'Clearing forests', from: 'land', to: 'air', gtc: 1, kind: 'human', source: `${GCB}: 1.0 ± 0.7` },
  { id: 'volcanoes', name: 'Volcanoes', from: 'rocks', to: 'air', gtc: 0.1, kind: 'natural', source: 'IPCC AR6 WG1 Figure 5.12: volcanism 0.1' },
];

// What is held, in billions of tonnes of carbon (GtC).
export const CARBON_STORES = [
  { id: 'air', name: 'The air', gtc: 900, source: 'Global Carbon Budget 2024: 422.45 ppm in 2024, × 2.124 GtC per ppm = 897. AR6 Figure 5.12: 591 + 279 = 870 for 2019' },
  { id: 'plants', name: 'Plants on land', gtc: 450, source: 'IPCC AR6 WG1 Figure 5.12: vegetation 450' },
  { id: 'soil', name: 'Soil', gtc: 1700, source: 'IPCC AR6 WG1 Figure 5.12: soils 1700 (permafrost, 1200 more, is not shown)' },
  { id: 'fossil', name: 'Coal, oil and gas (known reserves)', gtc: 930, source: 'IPCC AR6 WG1 Figure 5.12: reserves 580 + 230 + 118, from BGR (2020)' },
  { id: 'surface-ocean', name: 'Surface ocean', gtc: 900, source: 'IPCC AR6 WG1 Figure 5.12: surface ocean 900' },
  { id: 'deep-ocean', name: 'Deep ocean', gtc: 37000, source: 'IPCC AR6 WG1 Figure 5.12: intermediate and deep sea 37,100' },
  { id: 'sediment', name: 'Seafloor mud', gtc: 1750, source: 'IPCC AR6 WG1 Figure 5.12: ocean floor surface sediments 1750' },
];

export const ARROW_FT_PER_GTC = 0.014;
export const MIN_ARROW_FT = 0.05;
// The width an arrow is drawn at, and whether that is to scale.
export function arrowWidth(gtc) {
  const w = gtc * ARROW_FT_PER_GTC;
  return w < MIN_ARROW_FT ? { width: MIN_ARROW_FT, toScale: false } : { width: w, toScale: true };
}

const W = 16; const D = 10;
const PLINTH = 0.32;
const SEA = 2.2;
const ZA = 0.8; // the plane the arrows are drawn in
const SKY = { y0: 7.2, y1: 8.3, z0: -2.75, z1: 1.3 };
const FONT = 'Arial, Helvetica, sans-serif';
const FLUX = Object.fromEntries(CARBON_FLUXES.map((f) => [f.id, f]));

// --- the landscape, in one place ---------------------------------------------------------------
const VOLCANO = [1.85, -2.15]; const VR = 1.12;
const CLEARING = { x0: -1.75, x1: -0.62, z0: -1.4, z1: 3.3 };
const MINE = [-0.45, 4.55]; const WELL = [1.55, 4.5];
const PLANT = [0.35, ZA]; const STACK = [1.02, ZA];
const LAND_Y = 2.42;

const shoreX = (z) => 2.6 + 0.25 * Math.sin(z * 0.55 + 0.7) + 0.08 * Math.sin(z * 1.7);
function landY(x, z) {
  const back = 0.42 * sstep(-z, 1.2, 5) * (1 - sstep(x, -2.2, 0.2));
  return LAND_Y + 0.05 * fbm(x * 0.32, z * 0.32, 3, 2) + back * (0.75 + 0.25 * noise2(x * 0.6, z * 0.6, 3));
}
function seaFloor(x, z) {
  const s = x - shoreX(z);
  const shelf = SEA - 0.12 - 0.18 * sstep(s, 0, 0.9);
  const deep = 0.82 + 0.04 * noise2(x * 0.7, z * 0.7, 6);
  return mix(shelf, deep, sstep(s, 1.0, 2.7));
}
function volcano(x, z) {
  const r = Math.hypot(x - VOLCANO[0], (z - VOLCANO[1]) * 1.08);
  if (r >= VR) return -Infinity;
  const q = r / VR;
  return LAND_Y + 1.25 * (1 - q) ** 1.2 * (1 + 0.04 * noise2(x * 5, z * 5, 9)) - 0.2 * (1 - sstep(r, 0.05, 0.2));
}
function height(x, z) {
  const s = sstep(x - shoreX(z), -0.5, 0.25);
  const y = mix(landY(x, z), seaFloor(x, z), s);
  return Math.max(y, volcano(x, z));
}
const fine = (x, z) => height(x, z) + 0.012 * noise2(x * 9, z * 9, 11) + 0.006 * noise2(x * 23, z * 23, 12);
const inClearing = (x, z) => x > CLEARING.x0 + 0.1 * Math.sin(z * 2.3) && x < CLEARING.x1 + 0.12 * Math.sin(z * 1.7 + 1) && z > CLEARING.z0 && z < CLEARING.z1;

// The fossil-fuel store, under the middle of the land.
const seamTop = (x) => 1.33 + 0.04 * Math.sin(x * 0.9);
const seamBot = (x) => 1.08 + 0.03 * Math.sin(x * 1.3 + 1);
const inSeam = (x, y) => x > -4.6 && x < 1.0 && y < seamTop(x) - 0.12 * sstep(x, 0.4, 1.0) && y > seamBot(x) + 0.1 * sstep(x, 0.4, 1.0);
const oilTop = (x) => 0.98 - 0.32 * ((x - 1.6) / 1.15) ** 2;
const inOil = (x, y) => Math.abs(x - 1.6) < 1.15 && y < oilTop(x) && y > 0.62;

function paint(x, z, y) {
  const n = noise2(x * 2.2, z * 2.2, 4) * 0.5 + noise2(x * 7, z * 7, 5) * 0.5;
  const rv = Math.hypot(x - VOLCANO[0], (z - VOLCANO[1]) * 1.08);
  if (rv < VR * 1.05 && y > LAND_Y + 0.05) {
    const ash = mixc([98, 88, 80], [132, 120, 108], n * 0.5 + 0.5);
    return rv < 0.24 ? mixc([170, 82, 44], [120, 62, 40], sstep(rv, 0.08, 0.24)) : ash;
  }
  if (y < SEA + 0.07) {
    const sand = mixc([212, 196, 152], [186, 170, 128], n * 0.5 + 0.5);
    return y < SEA - 0.05 ? mixc(sand, [120, 128, 116], sstep(SEA - y, 0.05, 0.8)) : sand;
  }
  if (inClearing(x, z)) return mixc([132, 98, 64], [108, 80, 52], n * 0.5 + 0.5);
  // A road from the mine to the plant, and the plant's yard.
  if (x > -0.6 && x < 2.3 && Math.abs(z - ZA) < 0.75) return mixc([126, 124, 116], [110, 108, 102], n * 0.5 + 0.5);
  if (Math.abs(x - mix(MINE[0], PLANT[0], clamp01((MINE[1] - z) / (MINE[1] - PLANT[1])))) < 0.14 && z < MINE[1] && z > PLANT[1]) return [104, 100, 94];
  if (x > -0.6 && x < 2.6) return mixc([118, 138, 86], [134, 150, 96], n * 0.5 + 0.5);
  return mixc([52, 88, 44], [74, 108, 54], n * 0.5 + 0.5);
}

function strata(x, z, y, ground) {
  const below = ground - y;
  const grain = noise2(x * 30, y * 30, 12) * 6;
  const add = (c) => [c[0] + grain, c[1] + grain, c[2] + grain];
  // The mine shaft and the well, at the front where they can be seen.
  const front = z > D / 2 - 0.05;
  if (front && Math.abs(x - MINE[0]) < 0.09 && y > seamBot(x) && below > 0) return Math.abs(x - MINE[0]) < 0.06 ? [70, 64, 58] : [150, 140, 120];
  if (front && Math.abs(x - WELL[0]) < 0.025 && y > 0.75 && below > 0) return [150, 154, 160];
  if (inSeam(x, y)) return add([62, 62, 66]);
  if (inOil(x, y)) return add(mixc([92, 66, 40], [66, 48, 30], sstep(y, 0.62, 0.95)));
  // Soil thins out to nothing down the beach, and sea mud thickens in its place.
  const k = sstep(ground - SEA, 0.0, 0.22);
  if (below < 0.24 * (1 - k)) return add(mixc([156, 146, 122], [138, 128, 106], below / 0.24));
  if (below < 0.3 * k) return add(mixc([70, 50, 34], [96, 70, 46], below / 0.3));
  if (below < 0.62 * k) return add([132, 102, 70]);
  const band = y * 3.4 + 0.3 * noise2(x * 0.5, y, 5);
  const t = band - Math.floor(band);
  return add(mixc([128, 112, 92], [150, 134, 110], t < 0.5 ? t * 2 : 2 - t * 2));
}

function sectionWater(depth) {
  if (depth < 0.34) return mixc([74, 156, 196], [52, 124, 176], depth / 0.34);
  return mixc([38, 92, 152], [20, 46, 98], sstep(depth, 0.34, 1.4));
}

// ---------------------------------------------------------------------------------------------
// Arrows. A path in the plane z = zc, swept with a rounded section: `width` across the path in
// that plane, `depth` along z. Written straight into arrays, non-indexed, with analytic normals.
// ---------------------------------------------------------------------------------------------
class Solids {
  constructor() { this.p = []; this.n = []; this.c = []; }

  // A flat triangle, wound so its face points away from `inside`.
  flat(a, b, c, inside, col) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = u[1] * v[2] - u[2] * v[1]; let ny = u[2] * v[0] - u[0] * v[2]; let nz = u[0] * v[1] - u[1] * v[0];
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const out = (a[0] - inside[0]) * nx + (a[1] - inside[1]) * ny + (a[2] - inside[2]) * nz;
    if (out < 0) { [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz; }
    this.p.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) { this.n.push(nx, ny, nz); this.c.push(...col); }
  }
}

const SE = 0.42; // superellipse exponent: a rounded rectangle
const sec = (a) => {
  const c = Math.cos(a); const s = Math.sin(a);
  return [Math.sign(c) * Math.abs(c) ** SE, Math.sign(s) * Math.abs(s) ** SE, Math.sign(c) * Math.abs(c) ** (2 - SE), Math.sign(s) * Math.abs(s) ** (2 - SE)];
};

// A dense, evenly spaced run of points along a cubic Bezier in the xy plane.
function bezierPath(P, ds = 0.06) {
  const raw = [];
  for (let i = 0; i <= 400; i++) {
    const t = i / 400; const u = 1 - t;
    raw.push([
      u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0],
      u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1],
    ]);
  }
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const L = cum[cum.length - 1];
  const n = Math.max(2, Math.ceil(L / ds));
  const pts = []; let j = 0;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * L;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const f = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    pts.push([mix(raw[j][0], raw[j + 1][0], f), mix(raw[j][1], raw[j + 1][1], f)]);
  }
  return { pts, L, ds: L / n };
}

// Tangent and in-plane normal at every sample of a path.
function frames(pts) {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b[0] - a[0]; const ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1;
    return { t: [tx / l, ty / l], n: [-ty / l, tx / l] };
  });
}

// Sweeps a closed solid along samples [i0, i1] of a path, capped at both ends.
function sweep(S, pts, fr, i0, i1, zc, width, depth, colorAt, sides = 16) {
  const rings = [];
  for (let i = i0; i <= i1; i++) {
    const [px, py] = pts[i]; const { n } = fr[i];
    const ring = [];
    for (let k = 0; k < sides; k++) {
      const [cx, cz, gx, gz] = sec((k / sides) * TAU);
      const ga = gx / (width / 2); const gb = gz / (depth / 2); const gl = Math.hypot(ga, gb) || 1;
      ring.push({
        p: [px + n[0] * cx * width / 2, py + n[1] * cx * width / 2, zc + cz * depth / 2],
        n: [n[0] * ga / gl, n[1] * ga / gl, gb / gl],
      });
    }
    rings.push({ ring, centre: [px, py, zc], col: colorAt(i) });
  }
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r]; const B = rings[r + 1];
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      const a = A.ring[k]; const b = A.ring[k2]; const c = B.ring[k]; const d = B.ring[k2];
      S.p.push(...a.p, ...b.p, ...c.p, ...b.p, ...d.p, ...c.p);
      S.n.push(...a.n, ...b.n, ...c.n, ...b.n, ...d.n, ...c.n);
      S.c.push(...A.col, ...A.col, ...B.col, ...A.col, ...B.col, ...B.col);
    }
  }
  // Caps share no vertices with the sides, so a block shades flat instead of like a pillow.
  for (const [R, inward] of [[rings[0], rings[1]], [rings[rings.length - 1], rings[rings.length - 2]]]) {
    for (let k = 0; k < sides; k++) S.flat(R.centre, R.ring[k].p, R.ring[(k + 1) % sides].p, inward.centre, R.col);
  }
}

// A triangular head, extruded through its depth, from point B along tangent t.
function head(S, B, t, n, zc, hw, hl, hd, col) {
  const L = [B[0] - n[0] * hw / 2, B[1] - n[1] * hw / 2]; const R = [B[0] + n[0] * hw / 2, B[1] + n[1] * hw / 2];
  const T = [B[0] + t[0] * hl, B[1] + t[1] * hl];
  const inside = [B[0] + t[0] * hl * 0.33, B[1] + t[1] * hl * 0.33, zc];
  const f = zc + hd / 2; const k = zc - hd / 2;
  const v = (p, z) => [p[0], p[1], z];
  S.flat(v(L, f), v(T, f), v(R, f), inside, col);
  S.flat(v(L, k), v(R, k), v(T, k), inside, col);
  for (const [a, b] of [[L, R], [R, T], [T, L]]) {
    S.flat(v(a, f), v(b, f), v(b, k), inside, col);
    S.flat(v(a, f), v(b, k), v(a, k), inside, col);
  }
  return T;
}

const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// The arrows, each a flow from CARBON_FLUXES, a path, and the plane it is drawn in.
const ARROWS = [
  { id: 'photosynthesis', color: 0x3f9f45, bead: 0xd8f5c0, zc: ZA, P: [[-6.0, 7.75], [-6.75, 6.35], [-7.0, 5.0], [-6.05, 4.0]] },
  { id: 'respiration', color: 0xa4b83a, bead: 0xf3f6c8, zc: ZA, P: [[-3.25, 4.0], [-2.3, 5.0], [-2.3, 6.3], [-3.2, 7.2]] },
  { id: 'land-use', color: 0xe8862a, bead: 0xffe2b8, zc: ZA, stripe: 0xfff2dc, P: [[-1.15, 2.72], [-1.05, 4.2], [-1.3, 5.8], [-1.2, 7.2]] },
  { id: 'fossil', color: 0xd42f24, bead: 0xffd0c8, zc: ZA, P: [[STACK[0], 4.02], [1.12, 5.2], [0.9, 6.2], [0.95, 7.2]] },
  { id: 'volcanoes', color: 0x9a7f6c, bead: 0xf4e2d2, zc: VOLCANO[1] + 0.12, stripe: 0xf2ece4, P: [[VOLCANO[0], 3.7], [1.9, 4.8], [1.7, 6.0], [1.8, 7.3]] },
  { id: 'ocean-uptake', color: 0x2f7ed0, bead: 0xcfe6ff, zc: ZA, P: [[4.1, 7.75], [3.35, 6.3], [3.1, 3.8], [3.9, SEA + 0.04]] },
  { id: 'ocean-release', color: 0x4fc0de, bead: 0xe0f8ff, zc: ZA, P: [[6.45, SEA + 0.04], [7.25, 3.8], [7.25, 6.0], [6.2, 7.2]] },
];

const BEAD_V = 0.42; // feet a second, the same on every arrow
const BEAD_LANE = 0.14; // one lane per this much true width
const BEAD_GAP = 0.6; // along a lane

function buildArrows() {
  const S = new Solids();
  const lanes = [];
  const labelSpots = {};
  for (const a of ARROWS) {
    const flux = FLUX[a.id];
    const { width, toScale } = arrowWidth(flux.gtc);
    const trueW = flux.gtc * ARROW_FT_PER_GTC;
    const depth = THREE.MathUtils.clamp(width * 0.32, 0.05, 0.2);
    const hw = Math.max(width * 1.5, width + 0.2);
    const hl = THREE.MathUtils.clamp(hw * 0.45, 0.26, 0.85);
    const { pts, L, ds } = bezierPath(a.P);
    const fr = frames(pts);
    const iHead = Math.max(2, Math.round((L - hl) / ds));
    const base = lin(a.color); const stripe = a.stripe ? lin(a.stripe) : null;
    const colorAt = (i) => (stripe && Math.floor((i * ds) / 0.18) % 2 ? stripe : base);
    sweep(S, pts, fr, 0, Math.min(pts.length - 1, iHead + 1), a.zc, width, depth, colorAt, toScale ? 14 : 8);
    const B = pts[iHead]; const { t, n } = fr[iHead];
    head(S, B, t, n, a.zc, hw, hl, Math.max(depth, 0.08), base);
    // Bead lanes on the front face of the shaft.
    const count = Math.max(1, Math.round(trueW / BEAD_LANE));
    const gap = BEAD_GAP * Math.max(1, BEAD_LANE / trueW);
    const r = THREE.MathUtils.clamp(width * 0.3, 0.028, 0.045);
    for (let l = 0; l < count; l++) {
      const o = count === 1 ? 0 : (((l + 0.5) / count) - 0.5) * width * 0.86;
      const zf = a.zc + (depth / 2) * (1 - (Math.abs(o) / (width / 2)) ** (2 / SE)) ** (SE / 2) + r * 0.35;
      lanes.push({ pts, fr, ds, shaft: iHead * ds, o, zf, gap, r, color: lin(a.bead), phase: (l * 0.37) % 1 });
    }
    labelSpots[a.id] = { pts, fr, ds, L, zc: a.zc, width, depth, toScale };
  }

  // THE AIR: a rounded bar the arrows run into.
  {
    const pts = []; for (let i = 0; i <= 8; i++) pts.push([-7.92 + (i / 8) * 15.84, (SKY.y0 + SKY.y1) / 2]);
    const fr = frames(pts);
    const zc = (SKY.z0 + SKY.z1) / 2;
    const sky = lin(0xbfe0f4); const sky2 = lin(0xd8eefa);
    sweep(S, pts, fr, 0, pts.length - 1, zc, SKY.y1 - SKY.y0, SKY.z1 - SKY.z0, (i) => (i % 2 ? sky : sky2), 20);
  }

  const staticCount = S.p.length / 3;
  // The beads: one small ball each, written every frame.
  const ball = new THREE.OctahedronGeometry(1, 0);
  const bp = ball.attributes.position.array; const bn = ball.attributes.normal.array;
  const per = bp.length / 3;
  const beads = [];
  for (const lane of lanes) {
    const n = Math.max(1, Math.round(lane.shaft / lane.gap));
    const loop = Math.max(lane.shaft, n * lane.gap);
    for (let i = 0; i < n; i++) beads.push({ lane, start: ((i + lane.phase) / n) * loop, loop });
  }
  const total = staticCount + beads.length * per;
  const P = new Float32Array(total * 3); const N = new Float32Array(total * 3); const C = new Float32Array(total * 3);
  P.set(S.p); N.set(S.n); C.set(S.c);
  beads.forEach((b, i) => {
    const o = (staticCount + i * per) * 3;
    for (let k = 0; k < per; k++) {
      N[o + k * 3] = bn[k * 3]; N[o + k * 3 + 1] = bn[k * 3 + 1]; N[o + k * 3 + 2] = bn[k * 3 + 2];
      C[o + k * 3] = b.lane.color[0]; C[o + k * 3 + 1] = b.lane.color[1]; C[o + k * 3 + 2] = b.lane.color[2];
    }
  });
  const write = (time) => {
    beads.forEach((b, i) => {
      const { lane } = b;
      const d = (b.start + time * BEAD_V) % b.loop;
      const o = (staticCount + i * per) * 3;
      let x; let y; let z; let r = lane.r;
      if (d > lane.shaft - 0.05) {
        // Between trips: folded to a point inside the shaft, where nothing can see it.
        [x, y] = lane.pts[0]; z = lane.zf - lane.r; r = 0;
      } else {
        const j = Math.min(lane.pts.length - 1, Math.round(d / lane.ds));
        const [px, py] = lane.pts[j]; const { n } = lane.fr[j];
        x = px + n[0] * lane.o; y = py + n[1] * lane.o; z = lane.zf;
      }
      for (let k = 0; k < per; k++) {
        P[o + k * 3] = x + bp[k * 3] * r; P[o + k * 3 + 1] = y + bp[k * 3 + 1] * r; P[o + k * 3 + 2] = z + bp[k * 3 + 2] * r * 0.6;
      }
    });
  };
  write(0);
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa);
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5, -0.5), 9.5);
  g.computeBoundingBox();
  const m = mesh(g, standard({ vertexColors: true, roughness: 0.55, metalness: 0 }));
  // Diagram, not scenery: a two-foot band laying its shadow across the forest reads as a fault.
  m.castShadow = false;
  m.receiveShadow = false;
  m.update = (time) => {
    write(time);
    pa.clearUpdateRanges?.();
    pa.addUpdateRange?.(staticCount * 3, beads.length * per * 3);
    pa.needsUpdate = true;
  };
  return { mesh: m, labelSpots };
}

// ---------------------------------------------------------------------------------------------
// Labels: every plate in one atlas, one mesh, readable from both sides, casting no shadow.
// Each plate is a list of lines, sized in feet, on a coloured ground.
// ---------------------------------------------------------------------------------------------
function labels(list) {
  const ATLAS = 2048; const PAD = 0.45;
  const probe = document.createElement('canvas').getContext('2d');
  let rowY = 0;
  for (const L of list) {
    let pxPerFt = 230;
    const measure = () => {
      let wide = 0;
      for (const line of L.lines) {
        probe.font = `${line.bold === false ? 400 : 700} ${line.size * pxPerFt}px ${FONT}`;
        wide = Math.max(wide, probe.measureText(line.text).width);
      }
      return wide;
    };
    let wide = measure();
    const padPx = () => PAD * L.lines[0].size * pxPerFt * 2;
    if (wide + padPx() > ATLAS - 8) { pxPerFt *= (ATLAS - 8) / (wide + padPx()); wide = measure(); }
    L.pxPerFt = pxPerFt;
    L.hFt = L.lines.reduce((s, line) => s + line.size * 1.28, 0) + L.lines[0].size * PAD;
    L.wPx = Math.ceil(Math.max(wide + padPx(), (L.minW ?? 0) * pxPerFt));
    L.hPx = Math.ceil(L.hFt * pxPerFt);
    L.row = rowY; rowY += L.hPx + 4;
  }
  const H = Math.ceil(rowY);
  const texture = canvasTexture(ATLAS, H, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ATLAS, H);
    for (const L of list) {
      ctx.fillStyle = L.bg;
      ctx.fillRect(0, L.row, L.wPx, L.hPx);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let y = L.row + L.lines[0].size * PAD * 0.5 * L.pxPerFt;
      for (const line of L.lines) {
        const s = line.size * L.pxPerFt;
        y += s * 0.64;
        ctx.font = `${line.bold === false ? 400 : 700} ${s}px ${FONT}`;
        ctx.fillStyle = line.color ?? L.fg ?? '#ffffff';
        ctx.fillText(line.text, L.wPx / 2, y + s * 0.04);
        y += s * 0.64;
      }
    }
  });
  const pos = []; const uv = []; const nor = [];
  for (const L of list) {
    const w = L.wPx / L.pxPerFt; const h = L.hPx / L.pxPerFt;
    const u0 = 0; const u1 = L.wPx / ATLAS; const v1 = 1 - L.row / H; const v0 = 1 - (L.row + L.hPx) / H;
    const yaw = L.yaw ?? 0; const c = Math.cos(yaw); const s = Math.sin(yaw);
    const P = (lx, ly, off) => [L.x + lx * c + off * s, L.y + ly, L.z - lx * s + off * c];
    const quad = (a, b, e, f, sign) => {
      for (const [p, u, v] of [[a, u0, v0], [b, u1, v0], [e, u1, v1], [a, u0, v0], [e, u1, v1], [f, u0, v1]]) {
        pos.push(...p); uv.push(u, v); nor.push(s * sign, 0, c * sign);
      }
    };
    const off = 0.006;
    quad(P(-w / 2, -h / 2, off), P(w / 2, -h / 2, off), P(w / 2, h / 2, off), P(-w / 2, h / 2, off), 1);
    if (L.back !== false) quad(P(w / 2, -h / 2, -off), P(-w / 2, -h / 2, -off), P(-w / 2, h / 2, -off), P(w / 2, h / 2, -off), -1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const m = mesh(g, standard({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.3, roughness: 0.85, metalness: 0 }));
  // No shadows from a label: a plate this wide lays a dark bar across whatever it names.
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

// ---------------------------------------------------------------------------------------------
// What stands on the land
// ---------------------------------------------------------------------------------------------
function buildScenery(batch, rng) {
  const ground = height;
  // The forest, thickest under the two land arrows so they visibly start and end in it.
  const placed = [];
  const clear = (x, z, r) => placed.every(([px, pz, pr]) => Math.hypot(px - x, pz - z) > (r + pr) * 0.62);
  const plant = (x, z, h, pine) => {
    if (inClearing(x, z) || x > -1.9 || x < -7.75 || z > 4.75 || z < -4.75) return false;
    const r = h * 0.38;
    if (!clear(x, z, r)) return false;
    const y = ground(x, z) - 0.02;
    if (pine) addPine(batch, x, y, z, h * 1.1, rng, 0x2f5a37);
    else addBroadleaf(batch, x, y, z, h, rng, [0x3d7a33, 0x4c8a3a, 0x2e6a2e, 0x5a9440]);
    placed.push([x, z, r]);
    return true;
  };
  // Under the arrows first, tall enough to reach them.
  for (const [x, z] of [[-6.1, ZA], [-5.5, ZA - 0.5], [-6.7, ZA + 0.5], [-3.3, ZA], [-2.75, ZA + 0.45], [-3.9, ZA - 0.4], [-4.6, ZA + 0.2]]) plant(x, z, 1.45 + rng() * 0.1, false);
  let guard = 0;
  while (placed.length < 30 && guard < 3000) {
    guard += 1;
    const x = -7.6 + rng() * 5.6; const z = -4.6 + rng() * 9.2;
    plant(x, z, 0.85 + rng() * 0.5, rng() < 0.45);
  }

  // The clearing: stumps, a log pile and a smouldering heap, which is where its arrow starts.
  for (let i = 0; i < 9; i++) {
    const x = mix(CLEARING.x0 + 0.2, CLEARING.x1 - 0.15, rng()); const z = mix(CLEARING.z0 + 0.3, CLEARING.z1 - 0.3, rng());
    if (Math.abs(x + 1.15) < 0.3 && Math.abs(z - ZA) < 0.4) continue;
    const y = ground(x, z);
    batch.add(new THREE.CylinderGeometry(0.045, 0.055, 0.1, 7), 0x6a4c32, { position: [x, y + 0.04, z] });
    batch.add(new THREE.CylinderGeometry(0.045, 0.045, 0.006, 7), 0xd8b880, { position: [x, y + 0.092, z] });
  }
  for (let i = 0; i < 4; i++) {
    const y = ground(-1.2, 2.5);
    batch.add(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 7), 0x7a5838, { position: [-1.25 + (i % 2) * 0.04, y + 0.05 + Math.floor(i / 2) * 0.075, 2.5 + (i - 1.5) * 0.08], rotation: [0, 0, Math.PI / 2] });
  }
  {
    const y = ground(-1.15, ZA);
    batch.add(blobGeometry(rng, 1, 0.2), 0x4a3a2c, { position: [-1.15, y + 0.06, ZA], scale: [0.2, 0.09, 0.18] });
    batch.add(blobGeometry(rng, 1, 0.2), 0xd86a2a, { position: [-1.15, y + 0.12, ZA], scale: [0.08, 0.06, 0.07] });
  }

  // The power plant, its stack, and the coal it burns.
  {
    const [x, z] = PLANT; const y = ground(x, z);
    batch.add(new THREE.BoxGeometry(1.0, 0.62, 0.72), 0xb8b2a4, { position: [x, y + 0.31, z] });
    batch.add(new THREE.BoxGeometry(1.06, 0.06, 0.78), 0x6a6a6e, { position: [x, y + 0.64, z] });
    batch.add(new THREE.BoxGeometry(0.46, 0.3, 0.5), 0xa8a294, { position: [x + 0.3, y + 0.8, z - 0.05] });
    for (let i = 0; i < 4; i++) batch.add(new THREE.BoxGeometry(0.14, 0.12, 0.01), 0x3c4a58, { position: [x - 0.36 + i * 0.24, y + 0.38, z + 0.365] });
    const [sx, sz] = STACK; const sy = ground(sx, sz);
    const H = 4.0 - sy;
    for (let i = 0; i < 6; i++) {
      const h0 = (i / 6) * H; const h1 = ((i + 1) / 6) * H;
      const r0 = mix(0.13, 0.085, h0 / H); const r1 = mix(0.13, 0.085, h1 / H);
      batch.add(new THREE.CylinderGeometry(r1, r0, h1 - h0, 14), i % 2 ? 0xc8443a : 0xeeeae2, { position: [sx, sy + (h0 + h1) / 2, sz] });
    }
    // A coal heap by the plant, and the cooling tower behind it.
    batch.add(blobGeometry(rng, 1, 0.1), 0x4a4a4e, { position: [x - 0.65, y + 0.02, z + 0.55], scale: [0.32, 0.18, 0.26] });
    const ct = new THREE.LatheGeometry([[0, 0], [0.42, 0], [0.34, 0.45], [0.3, 0.75], [0.33, 0.95], [0.3, 0.95], [0, 0.95]].map(([r, h]) => new THREE.Vector2(r, h)), 20);
    batch.add(ct, 0xd8d4ca, { position: [x + 0.9, ground(x + 0.9, z - 1.0) - 0.02, z - 1.0] });
  }

  // The coal mine at the front, over its shaft in the cut face.
  {
    const [x, z] = MINE; const y = ground(x, z);
    for (const s of [-1, 1]) {
      batch.add(new THREE.CylinderGeometry(0.025, 0.03, 0.95, 6), 0x5a4a3c, { position: [x + s * 0.18, y + 0.45, z - 0.06], rotation: [0, 0, s * 0.18] });
    }
    batch.add(new THREE.CylinderGeometry(0.025, 0.025, 0.75, 6), 0x5a4a3c, { position: [x + 0.05, y + 0.4, z - 0.32], rotation: [-0.42, 0, 0] });
    batch.add(new THREE.TorusGeometry(0.13, 0.022, 6, 16), 0x7a6a5a, { position: [x, y + 0.92, z - 0.06] });
    batch.add(new THREE.BoxGeometry(0.42, 0.24, 0.32), 0x8a7a66, { position: [x + 0.4, y + 0.12, z - 0.2] });
    batch.add(blobGeometry(rng, 1, 0.12), 0x3e3e42, { position: [x - 0.42, y, z - 0.25], scale: [0.26, 0.16, 0.22] });
  }
  // An oil well (a pumpjack) over the oil in the cut face.
  {
    const [x, z] = WELL; const y = ground(x, z);
    batch.add(new THREE.BoxGeometry(0.5, 0.05, 0.18), 0x5a5e64, { position: [x, y + 0.02, z] });
    batch.add(new THREE.CylinderGeometry(0.02, 0.02, 0.42, 6), 0x4a4e54, { position: [x - 0.05, y + 0.22, z - 0.05], rotation: [0, 0, 0.25] });
    batch.add(new THREE.CylinderGeometry(0.02, 0.02, 0.42, 6), 0x4a4e54, { position: [x + 0.05, y + 0.22, z - 0.05], rotation: [0, 0, -0.25] });
    batch.add(new THREE.BoxGeometry(0.62, 0.05, 0.05), 0xd8a82a, { position: [x, y + 0.44, z - 0.05], rotation: [0, 0, -0.12] });
    batch.add(new THREE.BoxGeometry(0.08, 0.16, 0.07), 0xd8a82a, { position: [x - 0.3, y + 0.44, z - 0.05] });
    batch.add(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 5), 0x9a9ea4, { position: [x, y + 0.2, z] });
  }
  // A small town behind the plant.
  for (const [x, z, w, d, h, wall, roof, yaw] of [
    [-1.2, -3.6, 0.42, 0.34, 0.26, 0xe0d2b8, 0x8a3a2c, 0.1], [-0.55, -3.9, 0.38, 0.32, 0.24, 0xc8d4dc, 0x5a4a44, -0.2],
    [0.05, -3.35, 0.46, 0.34, 0.28, 0xe8dcc0, 0x7a3a2a, 0.05], [-0.4, -2.75, 0.36, 0.3, 0.24, 0xd4c4a8, 0x4a5058, 0.3],
    [-1.05, -2.35, 0.4, 0.32, 0.25, 0xe4e0d4, 0x8a4a30, -0.1], [0.55, -4.1, 0.4, 0.32, 0.25, 0xd8c8b0, 0x6a3a2e, 0.15],
  ]) addHouse(batch, x, ground(x, z) - 0.02, z, w, d, h, wall, roof, yaw);
  for (const [x, z] of [[-0.95, -3.0], [0.4, -2.65], [-0.2, -4.3]]) addBroadleaf(batch, x, ground(x, z) - 0.02, z, 0.55, rng, [0x4c8a3a, 0x5a9440]);

  // The base, folded into this mesh to keep the count at six.
  const bw = W + 0.5; const bd = D + 0.5; const h = PLINTH;
  batch.add(new THREE.BoxGeometry(bw, h * 0.62, bd), 0x3b2a1c, { position: [0, h * 0.31, 0] });
  batch.add(new THREE.BoxGeometry(bw - h * 0.5, h * 0.38, bd - h * 0.5), 0x3b2a1c, { position: [0, h * 0.81, 0] });
}

// ---------------------------------------------------------------------------------------------
function buildCarbonCycle() {
  const fmt = (v) => (v >= 1000 ? v.toLocaleString('en-US') : String(v));
  const store = (id) => CARBON_STORES.find((s) => s.id === id).gtc;
  const block = terrainBlock({
    w: W, d: D, plinth: PLINTH, nx: 132, nz: 84, height, fine, water: SEA, paint, strata, sectionWater,
    texW: 1600, strip: 420, lightAmount: 0.5, relief: 0.3, waterSeed: 5,
    waterPaint: (x, z, depth) => mixc([96, 176, 190], [30, 86, 148], sstep(depth, 0, 0.9)),
    labels: [
      { text: `Soil: ${fmt(store('soil'))}`, x: -5.7, y: LAND_Y - 0.17, size: 0.2 },
      { text: `Coal, oil and gas: ${fmt(store('fossil'))}`, x: -2.4, y: 1.2, size: 0.2 },
      { text: 'Coal mine', x: MINE[0] + 0.62, y: 1.75, size: 0.15 },
      { text: 'Oil well', x: WELL[0] - 0.5, y: 1.55, size: 0.15 },
      { text: `Surface ocean: ${fmt(store('surface-ocean'))}`, x: 6.2, y: SEA - 0.17, size: 0.2 },
      { text: `Deep ocean: ${fmt(store('deep-ocean'))}`, x: 6.2, y: 1.35, size: 0.26 },
      { text: `Seafloor mud: ${fmt(store('sediment'))}`, x: 6.2, y: 0.68, size: 0.16 },
    ],
  });
  const root = block.root;
  root.name = 'carbon-cycle';
  // terrainBlock's own base is a fourth mesh; the scenery batch carries one instead.
  const baseMesh = root.children[root.children.length - 1];
  root.remove(baseMesh);
  baseMesh.geometry.dispose(); baseMesh.material.dispose();

  const rng = seededRandom(4217);
  const batch = new Batch();
  buildScenery(batch, rng);

  const { mesh: arrows, labelSpots } = buildArrows();
  root.add(arrows);

  // Every arrow's number, on a plate on its own face.
  const list = [];
  const at = (id, s, dx = 0, dy = 0) => {
    const L = labelSpots[id]; const j = Math.round((s * L.L) / L.ds);
    const [x, y] = L.pts[Math.min(L.pts.length - 1, j)];
    return { x: x + dx, y: y + dy, z: L.zc + L.depth / 2 + 0.05, backZ: L.zc - L.depth / 2 - 0.05 };
  };
  const human = '#a8261c'; const natural = '#1f4a2a'; const sea = '#173f6a';
  list.push({ ...at('photosynthesis', 0.5), bg: natural, lines: [{ text: 'Plants take in', size: 0.17 }, { text: '142', size: 0.42 }], back: false });
  list.push({ ...at('respiration', 0.5), bg: '#4a5418', lines: [{ text: 'Breathing, rot, fire', size: 0.17 }, { text: '137', size: 0.42 }], back: false });
  list.push({ ...at('ocean-uptake', 0.5), bg: sea, lines: [{ text: 'Ocean takes in', size: 0.17 }, { text: '80', size: 0.4 }], back: false });
  list.push({ ...at('ocean-release', 0.5), bg: '#1c5a70', lines: [{ text: 'Ocean gives off', size: 0.17 }, { text: '78', size: 0.4 }], back: false });
  list.push({ ...at('fossil', 0.66, -0.85), bg: human, lines: [{ text: 'Burning coal, oil, gas', size: 0.17 }, { text: '10', size: 0.4 }, { text: 'No arrow back to match it', size: 0.15, bold: false }], back: false });
  list.push({ ...at('land-use', 0.5, 0.62), bg: '#a8561c', lines: [{ text: 'Clearing forests', size: 0.15 }, { text: '1*', size: 0.3 }], back: false });
  list.push({ ...at('volcanoes', 0.12, 0.5), bg: '#5a4a40', lines: [{ text: 'Volcanoes', size: 0.15 }, { text: '0.1*', size: 0.3 }], back: false });
  // The same numbers on the back of each arrow, for anyone who walks round.
  for (const L of list.slice()) list.push({ ...L, z: L.backZ, yaw: Math.PI });
  // The air and the legend, on the front of the bar.
  list.push({ x: 0, y: 8.0, z: SKY.z1 + 0.02, bg: '#d8eefa', fg: '#12324a', lines: [{ text: `THE AIR: about ${store('air')} billion tonnes of carbon (CO2 at 422 parts per million)`, size: 0.27 }], back: false });
  list.push({ x: 0, y: 7.53, z: SKY.z1 + 0.02, bg: '#d8eefa', fg: '#12324a', lines: [{ text: 'Arrow width = billions of tonnes of carbon moved a year.  Store numbers = billions of tonnes held.', size: 0.17, bold: false }, { text: '* Too small to draw to scale, so drawn wider and striped.', size: 0.17, bold: false }], back: false });
  // Stores on the land, on short posts.
  const post = (x, z, top) => { const y = height(x, z); batch.add(new THREE.CylinderGeometry(0.022, 0.028, top - y, 6), 0x3a3e44, { position: [x, (top + y) / 2, z] }); };
  list.push({ x: -5.0, y: 3.1, z: 4.45, bg: '#fbf8ef', fg: '#1f2b33', lines: [{ text: `Plants: ${store('plants')}`, size: 0.2 }] });
  post(-5.0, 4.45, 2.98);
  root.add(batch.mesh());
  root.add(labels(list));

  if (!reducedMotion()) {
    let t = 0;
    root.userData.tick = { update(dt) { t += dt; arrows.update(t); } };
  }
  return root;
}

export const BUILDERS = {
  'carbon-cycle': () => buildCarbonCycle(),
};
