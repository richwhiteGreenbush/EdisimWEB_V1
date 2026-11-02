import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  Batch, signs, addPalm, seededRandom, mixc, shade, clamp01, sstep, mix, noise2, fbm, TAU,
} from '../geo/GeoKit.js';
import { mesh, standard, canvasTexture } from '../../PropKit.js';
import {
  Sculpt, polygonize, tube, ellipsoidP, curveP, boxP, lin,
} from '../ModelKit.js';
import { reducedMotion } from '../../Settings.js';

// The Giza plateau around 2500 BCE, as a diorama. One idea carries it: A PYRAMID WAS NEVER ALONE. Each
// one is the far end of a machine that starts at the water, so stone and offerings come in at a
// harbor, a valley temple stands on the quay, a causeway climbs to a mortuary temple, and the pyramid
// stands behind that, among queens' pyramids and streets of officials' tombs, with the town that fed
// the builders to the south.
//
// THE PLAN IS REAL, AND THE MONUMENTS ARE NOT TO ITS SCALE. Positions are in metres from the centre of
// the Great Pyramid and every one goes through planX/planZ, north at the back like the city dioramas.
// To scale at this size the Great Pyramid would be less than three feet wide, so monuments are drawn
// 1.4 times larger, which is as far as it goes before Khufu's and Khafre's footprints meet. The ground
// heights are squeezed to match. Where the harbor and the Nile lay is an informed reconstruction, and
// the card says so. The casing is on, because white and smooth is what these were.
//
// Beside the plan stands the Great Pyramid cut in half, to a larger scale of its own, with its real
// passages and chambers drawn from the table below. Six meshes: ground, water, monuments, scenery,
// boats, labels. Authored in feet, origin at the base centre, front toward +Z.

const W = 19; const D = 15;
const M_PER_FT = 80; // metres of plan to a foot of model
const CX = 60; const CN = -400; // the plan's centre, in metres east and north of the Great Pyramid
export const planX = (x) => (x - CX) / M_PER_FT;
export const planZ = (n) => -(n - CN) / M_PER_FT;
const ofX = (X) => X * M_PER_FT + CX;
const ofN = (Z) => -Z * M_PER_FT + CN;
const X0 = -W / 2; const Z0 = -D / 2; const ZF = D / 2;
const PLINTH = 0.3;
const WATER = 1.2;
const FONT = 'Arial, Helvetica, sans-serif';
export const ENLARGE = 1.4;
const FT = (metres) => (metres * ENLARGE) / M_PER_FT;

// Real base and height in metres, and where each stands. The ground each one sits on is what makes
// Khafre's look the taller from most of the plateau, when Khufu's is.
export const PYRAMIDS = {
  khufu: { x: 0, n: 0, base: 230.3, height: 146.6, pad: 2.2 },
  khafre: { x: -328, n: -344, base: 215.3, height: 143.5, pad: 2.38 },
  menkaure: { x: -569, n: -743, base: 103.4, height: 65, pad: 2.3 },
};
const QUEENS = [
  { x: 212, n: -24, base: 47, height: 30, pad: 2.2 }, { x: 212, n: -86, base: 47, height: 30, pad: 2.2 }, { x: 212, n: -148, base: 46, height: 29, pad: 2.2 },
  { x: -620, n: -868, base: 44, height: 28, pad: 2.28 }, { x: -556, n: -868, base: 31, height: 21, pad: 2.28 }, { x: -505, n: -868, base: 31, height: 21, pad: 2.28 },
];

// The Great Pyramid's inside, in metres: + is south of its centre, y is above its base. Passages run
// in a straight line from the numbers Egyptologists measured, and the shape of the drawing follows.
const SLOPE = (26.43 * Math.PI) / 180;
const ENTRANCE = { north: 101.8, y: 17 };
const along = (p, metres, dir = 1) => ({ north: p.north - Math.cos(SLOPE) * metres, y: p.y + dir * Math.sin(SLOPE) * metres });
const JUNCTION = along(ENTRANCE, 28, -1);
const DESC_END = along(JUNCTION, 72, -1);
const GALLERY_FOOT = along(JUNCTION, 39.3, 1);
export const INSIDE = {
  pyramidBase: 230.3,
  pyramidHeight: 146.6,
  entrance: ENTRANCE,
  junction: JUNCTION,
  descendingEnd: DESC_END,
  galleryFoot: GALLERY_FOOT,
  galleryHead: { north: GALLERY_FOOT.north - 41.7, y: GALLERY_FOOT.y + 21 },
  queens: { north: 2.6, south: 2.6, floor: 21.4, height: 6.3 },
  kings: { northEdge: -8.6, width: 5.2, height: 5.8 },
  underground: { centreNorth: 5, width: 8.4, floor: -29, height: 4 },
};

// ---------------------------------------------------------------------------------------------
// One description of the ground. The mesh, the painting and the cut faces all read it.
// ---------------------------------------------------------------------------------------------
const lerpTable = (table, v) => {
  if (v >= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (v >= table[i][0]) return mix(table[i][1], table[i - 1][1], (v - table[i][0]) / (table[i - 1][0] - table[i][0]));
  }
  return table[table.length - 1][1];
};
const EDGE = [[200, 480], [0, 455], [-250, 430], [-380, 440], [-560, 300], [-760, 170], [-1000, 50]];
const WADI = [[-320, -1040], [-50, -880], [200, -800], [440, -770]];

const segDist = (ax, an, bx, bn, x, n) => {
  const dx = bx - ax; const dn = bn - an;
  const t = clamp01(((x - ax) * dx + (n - an) * dn) / (dx * dx + dn * dn));
  return Math.hypot(x - ax - dx * t, n - an - dn * t);
};
function wadiDistance(x, n) {
  let d = 1e9;
  for (let i = 0; i < WADI.length - 1; i++) d = Math.min(d, segDist(WADI[i][0], WADI[i][1], WADI[i + 1][0], WADI[i + 1][1], x, n));
  return d;
}
// Water by plan: a harbor basin before the temples, the channel along the east edge, a canal to
// Khufu's valley temple.
function waterAmount(x, n) {
  const q = Math.hypot((x - 690) / 138, (n + 420) / 390);
  const basin = 1 - sstep(q, 0.86, 1);
  const river = sstep(x, 762, 784);
  const canal = 1 - sstep(segDist(630, -70, 552, 88, x, n), 16, 26);
  return Math.max(basin, river, canal);
}
const QUARRY = { x0: -70, x1: 200, n0: -640, n1: -390 };

export function ground(X, Z) {
  const x = ofX(X); const n = ofN(Z);
  const edge = lerpTable(EDGE, n);
  const s = sstep(edge - x, -42, 48);
  const low = mix(1.56, 1.37, sstep(x, 520, 600)) + 0.02 * fbm(x * 0.012, n * 0.012, 2, 3);
  const flood = mix(low, 0.78, waterAmount(x, n));
  let top = 2.2 + 0.2 * sstep(x, -40, -500) + 0.1 * sstep(n, -160, -520) + 0.05 * fbm(x * 0.008, n * 0.008, 3, 5);
  top -= 0.5 * Math.exp(-((wadiDistance(x, n) / 95) ** 2));
  // The quarry the Great Pyramid's stone came out of, on the south side.
  const qx = Math.min(x - QUARRY.x0, QUARRY.x1 - x); const qn = Math.min(n - QUARRY.n0, QUARRY.n1 - n);
  const pit = sstep(Math.min(qx, qn), -6, 34);
  top -= pit * 0.26;
  // The hollow the Sphinx was carved out of, which is a quarry too.
  const sphinxPit = Math.max(Math.abs(x - 322) / 86, Math.abs(n + 432) / 52);
  top -= (1 - sstep(sphinxPit, 0.82, 1.02)) * 0.34;
  let y = mix(flood, top, s);
  for (const p of [...Object.values(PYRAMIDS), ...QUEENS]) {
    const half = ((p.base * ENLARGE) / 2) * 1.18 + 14;
    const m = Math.max(Math.abs(x - p.x), Math.abs(n - p.n));
    y = mix(p.pad, y, sstep(m, half, half + 34));
  }
  return y;
}

const paintRegion = (ctx, x0, y0, w, h, fn) => {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  let o = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      d[o++] = c[0]; d[o++] = c[1]; d[o++] = c[2]; d[o++] = 255;
    }
  }
  ctx.putImageData(img, x0, y0);
};

function label(ctx, text, x, y, size, room, { bg = 'rgba(16,20,26,0.8)', fg = '#ffffff' } = {}) {
  ctx.save();
  let s = size;
  ctx.font = `700 ${s}px ${FONT}`;
  const tw = ctx.measureText(text).width;
  if (tw > room) { s *= room / tw; ctx.font = `700 ${s}px ${FONT}`; }
  const width = Math.min(tw, room);
  const pad = s * 0.4;
  ctx.fillStyle = bg;
  ctx.fillRect(x - width / 2 - pad, y - s * 0.72, width + pad * 2, s * 1.44);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + s * 0.03);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// The ground and its cut faces, on one atlas
// ---------------------------------------------------------------------------------------------
const NX = 112; const NZ = 88;

function strataColor(X, y, g) {
  const x = ofX(X);
  const under = g - y;
  if (under < 0) return [40, 34, 28];
  const grain = noise2(x * 0.3, y * 26, 12) * 0.5 + noise2(x * 0.7, y * 60, 13) * 0.5;
  if (x > 560) {
    // Dark Nile silt over gravel, on the floodplain.
    const silt = mixc([62, 48, 36], [78, 62, 44], grain * 0.5 + 0.5);
    return under < 0.55 ? silt : mixc([120, 102, 78], [146, 126, 96], Math.sin(y * 24) * 0.5 + 0.5);
  }
  // The limestone the plateau is made of, and the stone of the pyramids' core, in tilted beds. Beds
  // that are soft and hard in turn are why a carved Sphinx weathers into ridges.
  const bed = y + (x * 0.00032) + 0.05 * fbm(x * 0.01, y * 2, 2, 31);
  const t = Math.sin(bed * 21) * 0.5 + 0.5;
  const rock = mixc([190, 170, 130], [216, 198, 158], t);
  if (under < 0.05) return mixc([214, 190, 142], rock, under / 0.05);
  return shade(rock, 1 + grain * 0.1);
}

function buildGround() {
  let topF = 0;
  for (let i = 0; i <= NX; i++) topF = Math.max(topF, ground(X0 + (i / NX) * W, ZF));
  const AW = 1700; const TW = 1440; const TH = Math.round(TW * D / W);
  const FH = Math.round(AW * (topF - PLINTH) / W);
  const SH = 60;
  const AH = TH + FH + SH * 3;
  const FY = TH; const SY = TH + FH;
  const pxPerFoot = AW / W;
  const map = canvasTexture(AW, AH, (ctx) => {
    ctx.fillStyle = '#b39c78';
    ctx.fillRect(0, 0, AW, AH);
    paintRegion(ctx, 0, 0, TW, TH, (px, py) => {
      const X = X0 + ((px + 0.5) / TW) * W; const Z = Z0 + ((py + 0.5) / TH) * D;
      const x = ofX(X); const n = ofN(Z);
      const h = ground(X, Z);
      const nz = fbm(x * 0.02, n * 0.02, 3, 21) * 0.5 + 0.5;
      const fine = noise2(x * 0.22, n * 0.22, 9);
      const edge = lerpTable(EDGE, n);
      const on = sstep(edge - x, -42, 48);
      if (x > 540 && on < 0.5) {
        if (waterAmount(x, n) > 0.45) return [140, 118, 86];
        // The fields, each its own small rectangle along a straight bank.
        const cell = noise2(Math.floor(x / 34) * 5.1, Math.floor(n / 26) * 3.7, 41);
        const c = mixc(mixc([72, 128, 54], [120, 160, 62], cell * 0.5 + 0.5), [176, 156, 84], sstep(cell, 0.3, 0.5));
        const mx = ((x % 34) + 34) % 34; const mn = ((n % 26) + 26) % 26;
        const bank = Math.min(mx, 34 - mx, mn, 26 - mn);
        return shade(mixc([116, 94, 64], c, sstep(bank, 1.4, 2.8)), 1 + fine * 0.08);
      }
      // Desert: pale gravelly rock on top, sand drifted into anything low, and quarry floors bright.
      let c = mixc([186, 146, 96], [208, 170, 118], nz);
      c = mixc(c, [170, 132, 86], Math.exp(-((wadiDistance(x, n) / 90) ** 2)));
      const scarp = 1 - Math.min(1, Math.abs(edge - x) / 60);
      c = mixc(c, [150, 122, 88], scarp * on);
      const qx = Math.min(x - QUARRY.x0, QUARRY.x1 - x); const qn = Math.min(n - QUARRY.n0, QUARRY.n1 - n);
      if (qx > 0 && qn > 0) {
        // Stepped floors, from cutting the blocks out in rows.
        const row = ((x + n * 0.25) / 19) % 1;
        const cutLine = Math.abs(((row + 1) % 1) - 0.5) > 0.44 ? 0.8 : 1;
        c = shade(mixc([216, 196, 154], [200, 176, 130], nz), cutLine);
      }
      const sp = Math.max(Math.abs(x - 322) / 86, Math.abs(n + 432) / 52);
      if (sp < 0.92) c = mixc([204, 176, 130], [182, 150, 106], nz);
      // Paved courts round each pyramid.
      for (const p of Object.values(PYRAMIDS)) {
        const half = ((p.base * ENLARGE) / 2) * 1.14;
        if (Math.max(Math.abs(x - p.x), Math.abs(n - p.n)) < half) c = mixc([236, 226, 198], [222, 210, 178], fine * 0.5 + 0.5);
      }
      // Tracks worn from the quarry to the Great Pyramid, a pale fan.
      const track = segDist(30, -390, -10, -170, x, n);
      c = mixc(c, [224, 198, 150], (1 - sstep(track, 6, 26)) * 0.5);
      return shade(c, 1 + fine * 0.07);
    });
    // The front cut face.
    const yOf = (py) => topF - ((py + 0.5) / FH) * (topF - PLINTH);
    paintRegion(ctx, 0, FY, AW, FH, (px, py) => {
      const X = X0 + ((px + 0.5) / AW) * W;
      return strataColor(X, yOf(py), ground(X, ZF));
    });
    const fx = (X) => ((X - X0) / W) * AW;
    const fy = (y) => FY + ((topF - y) / (topF - PLINTH)) * FH;
    const L = (text, X, y, feet, room) => label(ctx, text, fx(X), fy(y), feet * pxPerFoot, room * pxPerFoot);
    L('The Giza Plateau, about 2500 BCE', -5.4, 1.6, 0.34, 7.4);
    L('North is at the back. Monuments are drawn 1.4 times larger than the plan.', -5.4, 1.1, 0.19, 7.4);
    L('Limestone: the pyramids stand on it, and most of their stone was cut from it', 2.2, 1.28, 0.2, 7.2);
    L('Nile silt', 8.25, 0.85, 0.2, 2);
    // A compass, because a plan has to say which way is up.
    ctx.fillStyle = '#ffffff';
    const cx = fx(-9); const cy = fy(1.55);
    ctx.beginPath();
    ctx.moveTo(cx, cy - 22); ctx.lineTo(cx - 9, cy + 7); ctx.lineTo(cx + 9, cy + 7);
    ctx.fill();
    ctx.font = `700 22px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, cy + 28);

    // The other three sides, as plain strips.
    SIDES.forEach((side, row) => {
      paintRegion(ctx, 0, SY + row * SH, AW, SH, (px, py) => {
        const t = (px + 0.5) / AW;
        const X = mix(side[0][0], side[1][0], t); const Z = mix(side[0][1], side[1][1], t);
        const y = SIDE_TOP - ((py + 0.5) / SH) * (SIDE_TOP - PLINTH);
        const g = ground(X, Z);
        if (y > Math.max(g, WATER)) return [40, 34, 28];
        if (y > g) return [40, 100, 120];
        return strataColor(X, y, g);
      });
    });
  });

  const uTop = TW / AW;
  const ring = NX + 1;
  const pos = new Float32Array(ring * (NZ + 1) * 3); const uv = new Float32Array(ring * (NZ + 1) * 2);
  const hs = new Float32Array(ring * (NZ + 1));
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const k = i + j * ring;
      const X = X0 + (i / NX) * W; const Z = Z0 + (j / NZ) * D;
      hs[k] = ground(X, Z);
      pos[k * 3] = X; pos[k * 3 + 1] = hs[k]; pos[k * 3 + 2] = Z;
      uv[k * 2] = (i / NX) * uTop; uv[k * 2 + 1] = 1 - ((j / NZ) * TH) / AH;
    }
  }
  const idx = [];
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = i + j * ring; const b = a + 1; const c = a + ring; const e = c + 1;
      if (Math.max(hs[a], hs[b], hs[c], hs[e]) < WATER - 0.03) continue;
      if (Math.abs(hs[a] - hs[e]) < Math.abs(hs[b] - hs[c])) idx.push(a, c, e, a, e, b); else idx.push(a, c, b, b, c, e);
    }
  }
  const land = new THREE.BufferGeometry();
  land.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  land.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  land.setIndex(idx);
  land.computeVertexNormals();
  const parts = [land.toNonIndexed()];

  // The front: one polygon, its top edge the ground, its detail all in the texture.
  {
    const pts = [new THREE.Vector2(X0, PLINTH), new THREE.Vector2(-X0, PLINTH)];
    for (let i = NX; i >= 0; i--) { const X = X0 + (i / NX) * W; pts.push(new THREE.Vector2(X, Math.max(ground(X, ZF), WATER))); }
    const g0 = new THREE.ShapeGeometry(new THREE.Shape(pts));
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.attributes.position;
    const u = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      u[i * 2] = (p.getX(i) - X0) / W;
      u[i * 2 + 1] = 1 - (FY + ((topF - p.getY(i)) / (topF - PLINTH)) * FH) / AH;
      p.setZ(i, ZF);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(u, 2));
    parts.push(g);
  }
  // The other three, wound outward.
  SIDES.forEach((side, row) => {
    const n = side[2];
    const P = []; const U = [];
    const vOf = (y) => 1 - (SY + row * SH + ((SIDE_TOP - y) / (SIDE_TOP - PLINTH)) * SH) / AH;
    for (let i = 0; i < n; i++) {
      const t0 = i / n; const t1 = (i + 1) / n;
      const x0 = mix(side[0][0], side[1][0], t0); const z0 = mix(side[0][1], side[1][1], t0);
      const x1 = mix(side[0][0], side[1][0], t1); const z1 = mix(side[0][1], side[1][1], t1);
      const a = Math.max(ground(x0, z0), WATER); const b = Math.max(ground(x1, z1), WATER);
      const v = [[x0, PLINTH, z0, t0], [x1, PLINTH, z1, t1], [x1, b, z1, t1], [x0, PLINTH, z0, t0], [x1, b, z1, t1], [x0, a, z0, t0]];
      for (const [px, py, pz, tt] of v) { P.push(px, py, pz); U.push(tt, vOf(py)); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    parts.push(g);
  });
  for (const g of parts) {
    g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  }
  return mesh(mergeGeometries(parts, false), standard({ map, bumpMap: map, bumpScale: 0.3, roughness: 0.94, metalness: 0, side: THREE.DoubleSide }));
}
const SIDE_TOP = 3.1;
const SIDES = [
  [[-X0, ZF], [-X0, Z0], NZ], // right
  [[-X0, Z0], [X0, Z0], NX], // back
  [[X0, Z0], [X0, ZF], NZ], // left
];

// ---------------------------------------------------------------------------------------------
// The water
// ---------------------------------------------------------------------------------------------
function buildWater() {
  const TW = 1100; const TH = Math.round(TW * D / W);
  const map = canvasTexture(TW, TH, (ctx) => {
    paintRegion(ctx, 0, 0, TW, TH, (px, py) => {
      const X = X0 + ((px + 0.5) / TW) * W; const Z = Z0 + ((py + 0.5) / TH) * D;
      const x = ofX(X); const n = ofN(Z);
      if (x < 480) return [40, 80, 96];
      const depth = WATER - ground(X, Z);
      // The Nile in flood carries silt, so it runs brown-green rather than blue.
      const c = mixc([126, 136, 92], [70, 106, 96], sstep(depth, 0, 0.3));
      const flow = fbm(x * 0.02, n * 0.006, 3, 7) * 16;
      return [c[0] + flow, c[1] + flow, c[2] + flow];
    });
  });
  const plate = new THREE.BufferGeometry();
  plate.setAttribute('position', new THREE.Float32BufferAttribute([3.6, WATER, Z0, -X0, WATER, Z0, 3.6, WATER, ZF, -X0, WATER, ZF], 3));
  const u0 = (3.6 - X0) / W;
  plate.setAttribute('uv', new THREE.Float32BufferAttribute([u0, 1, 1, 1, u0, 0, 1, 0], 2));
  plate.setIndex([0, 2, 1, 1, 2, 3]);
  plate.computeVertexNormals();
  const m = mesh(plate, standard({ map, roughness: 0.34, metalness: 0.03, side: THREE.DoubleSide }));
  m.castShadow = false;
  return m;
}

// ---------------------------------------------------------------------------------------------
// The monuments that need a surface: the pyramids, and the cut-in-half one with its drawing
// ---------------------------------------------------------------------------------------------
const secScale = 4.096; // px per metre on the section's half of the atlas
const SEC_W = 1024; const SEC_MIN_X = -125; const SEC_MAX_Y = 150; const SEC_MIN_Y = -34;

function pyramidAtlas() {
  const rng = seededRandom(2560);
  return canvasTexture(2048, 1024, (ctx) => {
    // Left half: one face. Polished casing, so the courses are faint and the tone is what varies.
    ctx.fillStyle = '#f3efe4';
    ctx.fillRect(0, 0, 1024, 1024);
    const rows = 72;
    for (let r = 0; r < rows; r++) {
      const y = (r / rows) * 1024;
      const v = 232 + rng() * 22;
      ctx.fillStyle = `rgb(${v},${v - 3},${v - 11})`;
      ctx.fillRect(0, y, 1024, 1024 / rows);
      ctx.fillStyle = 'rgba(120,108,88,0.34)';
      ctx.fillRect(0, y, 1024, 1.7);
      let x = rng() * 30;
      while (x < 1024) {
        ctx.fillStyle = 'rgba(120,108,88,0.2)';
        ctx.fillRect(x, y, 1.3, 1024 / rows);
        x += 22 + rng() * 34;
      }
    }
    // A little dust settled low down and a little staining, or the faces read as plastic.
    const low = ctx.createLinearGradient(0, 760, 0, 1024);
    low.addColorStop(0, 'rgba(188,160,116,0)');
    low.addColorStop(1, 'rgba(188,160,116,0.5)');
    ctx.fillStyle = low;
    ctx.fillRect(0, 760, 1024, 264);

    // Right half: the section. y up in metres, x east-west of the drawing with north to the left.
    const px = (x) => 1024 + (x - SEC_MIN_X) * secScale;
    const py = (y) => (SEC_MAX_Y - y) * secScale;
    // Bedrock below, limestone core above, in course lines.
    ctx.fillStyle = '#b89f76';
    ctx.fillRect(1024, py(0), SEC_W, (0 - SEC_MIN_Y) * secScale + 2);
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(110,88,62,${0.08 + rng() * 0.16})`;
      ctx.fillRect(1024, py(-rng() * 34), SEC_W, 2);
    }
    ctx.fillStyle = '#d3bd92';
    ctx.fillRect(1024, 0, SEC_W, py(0));
    for (let i = 0; i < 74; i++) {
      const y = py(i * 2);
      ctx.fillStyle = 'rgba(120,96,64,0.22)';
      ctx.fillRect(1024, y, SEC_W, 1.5);
      let x = 1024 + rng() * 26;
      while (x < 2048) {
        ctx.fillRect(x, y - 2 * secScale, 1.3, 2 * secScale);
        x += 18 + rng() * 26;
      }
    }
    // The white casing, drawn a little thick so that it can be seen.
    const H = INSIDE.pyramidHeight; const half = INSIDE.pyramidBase / 2;
    ctx.strokeStyle = '#f6f2e6';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(px(-half), py(0)); ctx.lineTo(px(0), py(H)); ctx.lineTo(px(half), py(0));
    ctx.stroke();
    // Everything hollow, dark. A section reads by its voids.
    const hollow = '#1c1712';
    const line = (a, b, width) => {
      ctx.strokeStyle = hollow;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(px(-a.north), py(a.y)); ctx.lineTo(px(-b.north), py(b.y));
      ctx.stroke();
    };
    const { junction, descendingEnd, galleryFoot, galleryHead, queens, kings, underground } = INSIDE;
    line(ENTRANCE, descendingEnd, 7);
    line(junction, galleryFoot, 7);
    // The Grand Gallery is tall, which is the whole point of showing it.
    ctx.fillStyle = hollow;
    const gh = 8.6;
    ctx.beginPath();
    ctx.moveTo(px(-galleryFoot.north), py(galleryFoot.y));
    ctx.lineTo(px(-galleryHead.north), py(galleryHead.y));
    ctx.lineTo(px(-galleryHead.north), py(galleryHead.y + gh));
    ctx.lineTo(px(-galleryFoot.north), py(galleryFoot.y + gh));
    ctx.closePath();
    ctx.fill();
    // A corbelled roof is why it looks stepped.
    ctx.strokeStyle = 'rgba(214,190,146,0.5)';
    ctx.lineWidth = 1.5;
    for (let k = 1; k < 7; k++) {
      ctx.beginPath();
      ctx.moveTo(px(-galleryFoot.north), py(galleryFoot.y + (gh * k) / 7));
      ctx.lineTo(px(-galleryHead.north), py(galleryHead.y + (gh * k) / 7));
      ctx.stroke();
    }
    // To the Queen's Chamber, on the centre line, with its pointed roof.
    line({ north: galleryFoot.north, y: galleryFoot.y - 0.5 }, { north: queens.north, y: queens.floor + 1 }, 6);
    ctx.fillStyle = hollow;
    ctx.beginPath();
    ctx.moveTo(px(-queens.north), py(queens.floor));
    ctx.lineTo(px(queens.south), py(queens.floor));
    ctx.lineTo(px(queens.south), py(queens.floor + 4.7));
    ctx.lineTo(px(0), py(queens.floor + queens.height));
    ctx.lineTo(px(-queens.north), py(queens.floor + 4.7));
    ctx.closePath();
    ctx.fill();
    // On to the King's Chamber, in red Aswan granite, and the stacked spaces above it.
    const kx0 = -kings.northEdge; const kFloor = galleryHead.y + 0.3;
    line({ north: galleryHead.north, y: kFloor + 0.6 }, { north: kings.northEdge, y: kFloor + 0.6 }, 6);
    ctx.fillStyle = '#7a3f3a';
    ctx.fillRect(px(kx0 - 1.2), py(kFloor + kings.height + 1.2), (kings.width + 2.4) * secScale, (kings.height + 2.4) * secScale);
    ctx.fillStyle = hollow;
    ctx.fillRect(px(kx0), py(kFloor + kings.height), kings.width * secScale, kings.height * secScale);
    for (let i = 0; i < 5; i++) {
      const y0 = kFloor + kings.height + 2.4 + i * 3.1;
      ctx.fillStyle = '#7a3f3a';
      ctx.fillRect(px(kx0 - 1), py(y0 + 2.9), (kings.width + 2) * secScale, 2.9 * secScale);
      ctx.fillStyle = hollow;
      ctx.fillRect(px(kx0), py(y0 + 1.7), kings.width * secScale, 1.1 * secScale);
    }
    // The gabled top of the stack.
    const gableY = kFloor + kings.height + 2.4 + 5 * 3.1;
    ctx.fillStyle = '#a58a60';
    ctx.beginPath();
    ctx.moveTo(px(kx0 - 2.4), py(gableY));
    ctx.lineTo(px(kx0 + kings.width / 2), py(gableY + 4.2));
    ctx.lineTo(px(kx0 + kings.width + 2.4), py(gableY));
    ctx.closePath();
    ctx.fill();
    // The shafts: the King's two reach the faces, the Queen's two stop inside the masonry.
    const faceY = (x) => H * (1 - Math.abs(x) / half);
    const shaft = (x, y, dir, angle, stopAt = null) => {
      const dx = Math.cos(angle) * dir; const dy = Math.sin(angle);
      let cx = x; let cy = y; let walked = 0;
      while (cy < faceY(cx) - 0.5 && (stopAt === null || walked < stopAt)) { cx += dx; cy += dy; walked += 1; }
      ctx.strokeStyle = 'rgba(28,23,18,0.85)';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(px(x), py(y)); ctx.lineTo(px(cx), py(cy));
      ctx.stroke();
    };
    shaft(kx0 + kings.width, kFloor + 1, 1, Math.PI / 4);
    shaft(kx0, kFloor + 1, -1, (32 * Math.PI) / 180);
    shaft(queens.south, queens.floor + 2.4, 1, (39 * Math.PI) / 180, 62);
    shaft(-queens.north, queens.floor + 2.4, -1, (39 * Math.PI) / 180, 62);
    // The chamber cut into the rock, and never finished.
    ctx.fillStyle = hollow;
    const uX = -underground.centreNorth;
    ctx.fillRect(px(uX - underground.width / 2), py(underground.floor + underground.height), underground.width * secScale, underground.height * secScale);
    line(descendingEnd, { north: underground.centreNorth + underground.width / 2, y: descendingEnd.y }, 5);

    // The words. Leader lines, so nothing has to be crammed against what it names.
    const tag = (text, x, y, tx, ty, room = 56, size = 25) => {
      ctx.strokeStyle = '#141414';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px(x), py(y)); ctx.lineTo(px(tx), py(ty));
      ctx.stroke();
      label(ctx, text, px(x), py(y), size, room * secScale, { bg: 'rgba(250,246,234,0.94)', fg: '#16130f' });
    };
    tag('King’s Chamber', 52, 50, kx0 + kings.width, kFloor + 2.8, 40);
    tag('Relieving chambers', 36, 70, kx0 + kings.width + 0.5, kFloor + kings.height + 8, 44);
    tag('Queen’s Chamber', 52, 26, queens.south, queens.floor + 2.4, 40);
    tag('Grand Gallery', -30, 57, -galleryHead.north - 20, galleryHead.y - 3, 34);
    tag('Ascending passage', -66, 28, -junction.north + 18, junction.y + 9.5, 44);
    tag('Entrance', -60, 47, -ENTRANCE.north, ENTRANCE.y, 25);
    tag('Descending passage', -40, -14, -junction.north + 40, junction.y - 19.5, 50);
    tag('Underground chamber', 44, -18, uX + underground.width / 2, underground.floor + 2, 52);
    tag('Air shafts', 14, 92, 26, 73, 22, 19);
    label(ctx, 'Limestone core', px(0), py(112), 18, 26 * secScale, { bg: 'rgba(250,246,234,0.9)', fg: '#16130f' });
    label(ctx, 'To its own scale. North is on the left.', px(0), py(6), 21, 118 * secScale, { bg: 'rgba(16,20,26,0.8)', fg: '#ffffff' });
  });
}

function pyramidMesh() {
  const P = []; const N = []; const U = []; const C = [];
  const push = (a, b, c, uva, uvb, uvc, col, centre) => {
    const ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ac = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const n = ab.cross(ac).normalize();
    const out = new THREE.Vector3((a[0] + b[0] + c[0]) / 3 - centre[0], (a[1] + b[1] + c[1]) / 3 - centre[1], (a[2] + b[2] + c[2]) / 3 - centre[2]);
    let list = [[a, uva], [b, uvb], [c, uvc]];
    if (n.dot(out) < 0) { n.negate(); list = [[a, uva], [c, uvc], [b, uvb]]; }
    for (const [p, uv] of list) { P.push(p[0], p[1], p[2]); N.push(n.x, n.y, n.z); U.push(uv[0], uv[1]); C.push(col[0], col[1], col[2]); }
  };
  const FACE_L = 0.002; const FACE_R = 0.498;
  // A face runs from a corner pair at v=0 to its apex at v=1, on the left half of the atlas.
  const faceUV = (t, v) => [mix(FACE_L, FACE_R, 0.5 + (t - 0.5) * (1 - v)), v];
  const pyramid = (cx, y, cz, base, height, colour, band = null) => {
    const h = base / 2;
    const corners = [[cx - h, y, cz + h], [cx + h, y, cz + h], [cx + h, y, cz - h], [cx - h, y, cz - h]];
    const centre = [cx, y + height * 0.25, cz];
    const apex = [cx, y + height, cz];
    for (let i = 0; i < 4; i++) {
      const a = corners[i]; const b = corners[(i + 1) % 4];
      if (band) {
        const at = (p) => [mix(p[0], apex[0], band.f), mix(p[1], apex[1], band.f), mix(p[2], apex[2], band.f)];
        const a2 = at(a); const b2 = at(b);
        push(a, b, b2, faceUV(0, 0), faceUV(1, 0), faceUV(1, band.f), band.colour, centre);
        push(a, b2, a2, faceUV(0, 0), faceUV(1, band.f), faceUV(0, band.f), band.colour, centre);
        push(a2, b2, apex, faceUV(0, band.f), faceUV(1, band.f), [0.25, 1], colour, centre);
      } else {
        push(a, b, apex, faceUV(0, 0), faceUV(1, 0), [0.25, 1], colour, centre);
      }
    }
    push(corners[0], corners[2], corners[1], [0.25, 0.02], [0.25, 0.02], [0.25, 0.02], colour, [cx, y + 1, cz]);
    push(corners[0], corners[3], corners[2], [0.25, 0.02], [0.25, 0.02], [0.25, 0.02], colour, [cx, y + 1, cz]);
  };
  const WHITE = lin(0xd8d0bc);
  const GRANITE = lin(0xb08474);
  for (const [key, p] of Object.entries(PYRAMIDS)) {
    pyramid(planX(p.x), p.pad, planZ(p.n), FT(p.base), FT(p.height), WHITE, key === 'menkaure' ? { f: 0.2, colour: GRANITE } : null);
  }
  const queen = lin(0xcfc4ac);
  for (const q of QUEENS) pyramid(planX(q.x), q.pad, planZ(q.n), FT(q.base), FT(q.height), queen);

  // The cut-in-half one. Back half only, with its section on the flat face toward the student.
  const G = insetLayout();
  const uSec = (m) => 0.5 + (((m - SEC_MIN_X) * secScale) / SEC_W) * 0.5;
  const vSec = (m) => 1 - ((SEC_MAX_Y - m) * secScale) / 1024;
  const white = [1, 1, 1];
  const apex = [G.x, G.y + G.h, G.z];
  const L = [G.x - G.half, G.y, G.z]; const R = [G.x + G.half, G.y, G.z];
  const BL = [G.x - G.half, G.y, G.z - G.half]; const BR = [G.x + G.half, G.y, G.z - G.half];
  const centre = [G.x, G.y + 0.4, G.z - 0.6];
  const clip = (n) => [uSec(n[0]), vSec(n[1])];
  const H = INSIDE.pyramidHeight;
  const half = INSIDE.pyramidBase / 2;
  push(L, R, apex, clip([-half, 0]), clip([half, 0]), [uSec(0), vSec(H)], white, centre);
  const backCol = lin(0xd8d0bc);
  push(R, BR, apex, faceUV(0, 0), faceUV(1, 0), [0.25, 1], backCol, centre);
  push(BR, BL, apex, faceUV(0, 0), faceUV(1, 0), [0.25, 1], backCol, centre);
  push(BL, L, apex, faceUV(0, 0), faceUV(1, 0), [0.25, 1], backCol, centre);
  // Its footing: the bedrock the bottom chamber is cut into, in the same drawing.
  const low = G.y - (SEC_MIN_Y * -1) * G.scale;
  const fl = [G.x - G.half, low, G.z]; const fr = [G.x + G.half, low, G.z];
  const fbl = [G.x - G.half, low, G.z - G.half]; const fbr = [G.x + G.half, low, G.z - G.half];
  const fc = [G.x, (low + G.y) / 2, G.z - G.half / 2];
  const rock = lin(0xa89068);
  push(fl, fr, R, clip([-half, SEC_MIN_Y]), clip([half, SEC_MIN_Y]), clip([half, 0]), white, fc);
  push(fl, R, L, clip([-half, SEC_MIN_Y]), clip([half, 0]), clip([-half, 0]), white, fc);
  const plain = [0.25, 0.02];
  for (const [a, b, c, e] of [[fr, fbr, BR, R], [fbr, fbl, BL, BR], [fbl, fl, L, BL]]) {
    push(a, b, c, plain, plain, plain, rock, fc);
    push(a, c, e, plain, plain, plain, rock, fc);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return mesh(g, standard({ vertexColors: true, map: pyramidAtlas(), roughness: 0.74, metalness: 0 }));
}

// The cutaway's place: on its own shelf beside the plan, flush with the plan's front, so it hides
// nothing. Inside it the whole model is shifted so that the base is centred on the origin.
function insetLayout() {
  const scale = 5.7 / INSIDE.pyramidBase;
  const y = PLINTH + 34 * scale + 0.02;
  return { x: X0 - 3.5, y, z: ZF - 0.35, half: 2.85, h: INSIDE.pyramidHeight * scale, scale };
}

// ---------------------------------------------------------------------------------------------
// The Sphinx, small enough here that its shape is all it has
// ---------------------------------------------------------------------------------------------
function sphinxGeometry() {
  const s = new Sculpt(0.022);
  const STONE = 0xc9a874; const DARK = 0xb08f5e; const HEAD = 0xdcc294;
  const FACE = 0xd0ae7c;
  // Authored facing +X, in feet: a real 73m long and 20m high, at twice the plan's scale, so about
  // 1.8ft by 0.5ft. It is far longer and lower than instinct says, and it was built as a head far too
  // big when it came out at the proportions of a seated dog. The head is small on a very long lion.
  s.add(boxP([-0.3, 0.14, 0], [0.54, 0.13, 0.16], null, 0.09), STONE);
  s.add(ellipsoidP([0.2, 0.19, 0], [0.24, 0.17, 0.19]), STONE, { k: 0.05 }); // the chest and shoulders
  s.add(ellipsoidP([-0.72, 0.15, 0], [0.18, 0.15, 0.18]), STONE, { k: 0.05 }); // the rump
  for (const side of [-1, 1]) {
    // Long forelegs laid out in front, each ending in a square paw.
    s.add(curveP([[0.2, 0.08, side * 0.12], [0.56, 0.06, side * 0.125], [0.86, 0.052, side * 0.125]], [0.075, 0.055, 0.05], 8), DARK, { k: 0.04 });
    s.add(boxP([0.9, 0.048, side * 0.125], [0.055, 0.045, 0.06], null, 0.018), DARK, { k: 0.018 });
    // The folded hind leg along the flank.
    s.add(ellipsoidP([-0.62, 0.09, side * 0.16], [0.18, 0.085, 0.05]), DARK, { k: 0.03 });
    s.add(curveP([[-0.5, 0.04, side * 0.185], [-0.26, 0.04, side * 0.185]], [0.04, 0.034], 4), DARK, { k: 0.025 });
    // The two lappets of the royal head-cloth, wide at the temple and falling onto the chest.
    s.add(curveP([[0.3, 0.46, side * 0.1], [0.33, 0.36, side * 0.115], [0.36, 0.25, side * 0.075]], [0.034, 0.04, 0.024], 5), HEAD, { k: 0.015 });
  }
  // A short neck, then the head set forward, the cloth a flat fan behind a small face.
  s.add(curveP([[0.16, 0.3, 0], [0.24, 0.42, 0]], [0.1, 0.07], 4), STONE, { k: 0.04 });
  s.add(ellipsoidP([0.26, 0.47, 0], [0.09, 0.07, 0.125]), HEAD, { k: 0.02 }); // the cloth over the crown
  s.add(ellipsoidP([0.16, 0.45, 0], [0.09, 0.065, 0.1]), HEAD, { k: 0.03 }); // falling behind the head
  s.add(ellipsoidP([0.335, 0.455, 0], [0.05, 0.068, 0.056]), FACE, { k: 0.012, ck: 0.01 }); // the face
  s.sub(boxP([0, -0.4, 0], [2, 0.4, 2]));
  const tint = (x, y, z, nx, ny, nz, rgb) => {
    if (y < 0.3) {
      // The rock's own beds, which weather into the ridges the real one has.
      const k = 0.84 + 0.18 * (Math.sin(y * 92) * 0.5 + 0.5);
      rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
    } else if (x < 0.32) {
      // The pleats of the head-cloth.
      const k = 0.8 + 0.24 * (Math.sin((y * 3.4 + Math.abs(z) * 2.2) * 32) > 0 ? 1 : 0);
      rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
    } else if (x > 0.36 && Math.abs(y - 0.47) < 0.014 && Math.abs(Math.abs(z) - 0.024) < 0.016) {
      // Eyes, as two shadows, since at this size that is all they are.
      rgb[0] *= 0.5; rgb[1] *= 0.5; rgb[2] *= 0.5;
    }
  };
  return polygonize(s, { tint });
}

// ---------------------------------------------------------------------------------------------
// Everything else that stands on the plateau
// ---------------------------------------------------------------------------------------------
const LIME = 0xc8b48c; const PALE = 0xdccba6; const GRANITE_DK = 0x8e665a;
const BRICK = 0x96764e; const BRICK2 = 0x876844; const BRICK3 = 0xa6845a;

function buildScenery(root) {
  const batch = new Batch();
  const rng = seededRandom(2500);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const blockAt = (X, Y, Z, w, h, d, color, yaw = 0) => batch.add(box, color, { position: [X, Y + h / 2, Z], scale: [w, h, d], rotation: [0, yaw, 0] });

  // The stepped base, with a shelf running out to the west for the cutaway.
  const G = insetLayout();
  batch.add(box, 0x3b2a1c, { position: [0, PLINTH * 0.31, 0], scale: [W + 0.6, PLINTH * 0.62, D + 0.6] });
  batch.add(box, 0x4a3524, { position: [0, PLINTH * 0.81, 0], scale: [W + 0.3, PLINTH * 0.38, D + 0.3] });
  const shelfW = 7.2;
  const shelfX = X0 - shelfW / 2;
  const shelfD = 3.9; const shelfZ = ZF - shelfD / 2 + 0.3;
  batch.add(box, 0x3b2a1c, { position: [shelfX, PLINTH * 0.31, shelfZ], scale: [shelfW, PLINTH * 0.62, shelfD] });
  batch.add(box, 0x4a3524, { position: [shelfX, PLINTH * 0.81, shelfZ - 0.05], scale: [shelfW - 0.3, PLINTH * 0.38, shelfD - 0.3] });

  // A temple is a walled court with a hall behind it. The hall is on the pyramid's side.
  const temple = (x, n, w, d, h, color, roofColor, { yaw = 0, wall = 0.05 } = {}) => {
    const X = planX(x); const Z = planZ(n);
    const y = ground(X, Z) - 0.03;
    blockAt(X - w * 0.22, y, Z, w * 0.56, h, d, color, yaw);
    blockAt(X - w * 0.22, y + h, Z, w * 0.5, 0.02, d * 0.92, roofColor, yaw);
    const c = Math.cos(yaw); const s = Math.sin(yaw);
    const courtX = X + w * 0.28 * c; const courtZ = Z - w * 0.28 * s;
    blockAt(courtX + (w * 0.22 - wall / 2) * c, y, courtZ - (w * 0.22 - wall / 2) * s, wall, h * 0.74, d, color, yaw);
    blockAt(courtX + s * (d / 2 - wall / 2), y, courtZ + c * (d / 2 - wall / 2), w * 0.44, h * 0.74, wall, color, yaw);
    blockAt(courtX - s * (d / 2 - wall / 2), y, courtZ - c * (d / 2 - wall / 2), w * 0.44, h * 0.74, wall, color, yaw);
    blockAt(courtX, y + 0.012, courtZ, w * 0.44 - wall, 0.03, d - wall, 0xe0d0ac, yaw);
  };
  // Each causeway is walled and roofed, and follows the ground it climbs.
  const causeway = (points, width, h, color) => {
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, an] = points[i]; const [bx, bn] = points[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bn - an) / 28));
      for (let k = 0; k < steps; k++) {
        const x0 = mix(ax, bx, k / steps); const n0 = mix(an, bn, k / steps);
        const x1 = mix(ax, bx, (k + 1) / steps); const n1 = mix(an, bn, (k + 1) / steps);
        const X0a = planX(x0); const Z0a = planZ(n0); const X1a = planX(x1); const Z1a = planZ(n1);
        const y0 = ground(X0a, Z0a); const y1 = ground(X1a, Z1a);
        const len = Math.hypot(X1a - X0a, Z1a - Z0a);
        const yaw = Math.atan2(-(Z1a - Z0a), X1a - X0a);
        const pitch = Math.atan2(y1 - y0, len);
        const mx = (X0a + X1a) / 2; const mz = (Z0a + Z1a) / 2; const my = (y0 + y1) / 2;
        batch.add(box, color, { position: [mx, my + h / 2 - 0.02, mz], scale: [len * 1.04, h + 0.04, width], rotation: [0, yaw, pitch] });
        batch.add(box, PALE, { position: [mx, my + h + 0.005, mz], scale: [len * 1.04, 0.012, width * 0.78], rotation: [0, yaw, pitch] });
      }
    }
  };
  // A wall round each pyramid's court.
  const enclosure = (x, n, half, y) => {
    const X = planX(x); const Z = planZ(n); const t = 0.03; const h = 0.07;
    blockAt(X, y, Z - half, half * 2 + t, h, t, PALE);
    blockAt(X, y, Z + half, half * 2 + t, h, t, PALE);
    blockAt(X - half, y, Z, t, h, half * 2 + t, PALE);
    blockAt(X + half, y, Z, t, h, half * 2 + t, PALE);
  };

  // --- Khufu ---
  const K = PYRAMIDS.khufu;
  enclosure(K.x, K.n, (FT(K.base) / 2) * 1.14, K.pad);
  temple(208, 0, 0.62, 0.74, 0.1, LIME, PALE);
  causeway([[244, 8], [430, 70], [522, 92]], 0.14, 0.11, LIME);
  temple(556, 92, 0.72, 0.62, 0.15, LIME, PALE);
  // The sealed boat pits on the south side, where the Khufu ship was found, as long stone lids.
  const ky = K.pad + 0.006;
  blockAt(planX(-55), ky, planZ(-192), 0.62, 0.014, 0.075, 0x8a7654);
  blockAt(planX(62), ky, planZ(-192), 0.62, 0.014, 0.075, 0x8a7654);
  // The boat-shaped pits on the east side, in the rock.
  for (const [x, n] of [[176, 58], [176, -58]]) batch.add(new THREE.SphereGeometry(1, 10, 4), 0x4a3c28, { position: [planX(x), K.pad - 0.004, planZ(n)], scale: [0.09, 0.012, 0.42] });

  // --- Khafre: its causeway runs to the Sphinx's own quay ---
  const F = PYRAMIDS.khafre;
  enclosure(F.x, F.n, (FT(F.base) / 2) * 1.14, F.pad);
  temple(-122, -344, 0.86, 0.9, 0.13, LIME, PALE);
  causeway([[-82, -348], [120, -408], [334, -486], [354, -492]], 0.14, 0.11, LIME);
  temple(396, -500, 0.74, 0.78, 0.2, GRANITE_DK, 0xa27868); // faced in red granite
  temple(404, -428, 0.62, 0.66, 0.13, 0xb29464, PALE); // the Sphinx's own temple, in front of it

  // --- Menkaure ---
  const M = PYRAMIDS.menkaure;
  enclosure(M.x, M.n, (FT(M.base) / 2) * 1.2, M.pad);
  temple(-440, -743, 0.6, 0.62, 0.1, LIME, PALE);
  causeway([[-408, -743], [-120, -760], [64, -772]], 0.12, 0.08, BRICK3);
  temple(96, -772, 0.62, 0.6, 0.11, BRICK3, PALE);

  // --- The Sphinx, facing the sunrise along +X ---
  {
    const X = planX(322); const Z = planZ(-432);
    batch.add(sphinxGeometry(), null, { position: [X - 0.22, ground(X, Z) - 0.03, Z] });
  }

  // --- Tombs of the officials, in the streets Khufu laid out for them ---
  const mastaba = new THREE.CylinderGeometry(0.62, 0.707, 1, 4);
  mastaba.rotateY(Math.PI / 4);
  const tone = () => { const v = 0.54 + rng() * 0.16; return [v, v * 0.88, v * 0.66]; };
  const tomb = (x, n, w = 0.36, d = 0.14) => {
    const X = planX(x); const Z = planZ(n);
    batch.add(mastaba, tone(), { position: [X, ground(X, Z) + 0.045, Z], scale: [w, 0.13, d] });
  };
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 9; col++) {
      const x = -620 + col * 46 + (row % 2) * 12; const n = 170 - row * 28;
      if (Math.max(Math.abs(x - K.x), Math.abs(n - K.n)) > (FT(K.base) / 2) * 1.2 * M_PER_FT + 8) tomb(x, n);
    }
  }
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 3; col++) {
      const x = 268 + col * 46; const n = -34 - row * 30;
      if (x < 420) tomb(x, n, 0.34, 0.15);
    }
  }
  for (let col = 0; col < 3; col++) tomb(280 + col * 46, 170, 0.34, 0.15);
  for (let col = 0; col < 3; col++) tomb(280 + col * 46, 130, 0.34, 0.15);

  // --- The Wall of the Crow, and its great gate ---
  {
    const n = -786;
    for (const [x0, x1] of [[10, 100], [120, 232]]) {
      const X = planX((x0 + x1) / 2); const Z = planZ(n);
      const w = (x1 - x0) / M_PER_FT;
      const y = ground(X, Z);
      batch.add(box, 0xb6a27c, { position: [X, y + 0.09, Z], scale: [w, 0.24, 0.17] });
      batch.add(box, 0xcab890, { position: [X, y + 0.222, Z], scale: [w, 0.024, 0.13] });
    }
    const gx = planX(110); const gz = planZ(n);
    batch.add(box, 0xcab890, { position: [gx, ground(gx, gz) + 0.2, gz], scale: [0.26, 0.06, 0.19] });
  }

  // --- The town, about 400m south of the Sphinx: galleries in blocks, bakeries, houses, a wall ---
  {
    const brickTone = () => [BRICK, BRICK2, BRICK3][Math.floor(rng() * 3)];
    const lot = (x, n, wM, dM, h, color) => {
      const X = planX(x); const Z = planZ(n);
      batch.add(box, color, { position: [X, ground(X, Z) + h / 2 - 0.01, Z], scale: [wM / M_PER_FT, h + 0.02, dM / M_PER_FT] });
    };
    // Four blocks of long sleeping galleries, the plainest proof of how many men this fed.
    for (let g = 0; g < 4; g++) {
      const ox = 300 + g * 66;
      for (let i = 0; i < 7; i++) lot(ox, -846 - i * 10.5, 54, 6.8, 0.075, brickTone());
      lot(ox, -878, 56, 3.5, 0.03, 0x7a5c3a);
    }
    // Bakeries with their ovens, in a row, darker from the fires.
    for (let i = 0; i < 6; i++) lot(286 + i * 22, -932, 14, 12, 0.07, 0x6a5238);
    // The big houses of the people in charge, with their walled yards.
    for (const [x, n] of [[470, -930], [508, -930], [532, -880], [536, -840]]) { lot(x, n, 22, 20, 0.09, BRICK3); lot(x + 8, n - 8, 8, 8, 0.12, BRICK2); }
    // The crowded houses along the east, as a scatter.
    for (let i = 0; i < 26; i++) lot(510 + rng() * 44, -962 + rng() * 54, 5 + rng() * 8, 5 + rng() * 8, 0.05 + rng() * 0.05, brickTone());
    // The wall on three sides, and the main street through it.
    lot(420, -824, 280, 4, 0.13, 0xa38458);
    lot(286, -890, 4, 130, 0.13, 0xa38458);
    // The builders' own cemetery, on the slope above, as small domes of mud brick.
    const dome = new THREE.SphereGeometry(1, 7, 4, 0, TAU, 0, Math.PI / 2);
    for (let i = 0; i < 22; i++) {
      const x = 120 + rng() * 110; const n = -930 + rng() * 96;
      const X = planX(x); const Z = planZ(n); const s = 0.04 + rng() * 0.04;
      batch.add(dome, 0x8e7048, { position: [X, ground(X, Z) - 0.01, Z], scale: [s, s * 1.1, s] });
    }
  }

  // --- A stone quay along the harbor, the palms of the valley ---
  const quay = [[566, -200], [556, -340], [560, -500], [566, -640]];
  for (let i = 0; i < quay.length - 1; i++) {
    const [ax, an] = quay[i]; const [bx, bn] = quay[i + 1];
    const X = planX((ax + bx) / 2); const Z = planZ((an + bn) / 2);
    const len = Math.hypot(bx - ax, bn - an) / M_PER_FT;
    const yaw = Math.atan2(planZ(an) - planZ(bn), planX(bx) - planX(ax));
    batch.add(box, 0xbda87e, { position: [X, 1.34, Z], scale: [len, 0.16, 0.13], rotation: [0, yaw, 0] });
  }
  for (const [x, n] of [[600, 140], [650, 150], [700, 130], [690, 40], [744, 90], [624, 30], [580, -860], [640, -890], [700, -880], [726, -950], [604, -960], [664, -968]]) {
    const X = planX(x); const Z = planZ(n);
    addPalm(batch, X, ground(X, Z) - 0.01, Z, 0.34 + rng() * 0.12, rng, { fronds: 5, frond: 0x2f7a38 });
  }

  // Signs. Each stands beside what it names, with its pole clear of the thing.
  const sign = (text, x, n, lift) => {
    const X = planX(x); const Z = planZ(n);
    const g = Math.max(ground(X, Z), WATER);
    return { text, x: X, z: Z, y: g + lift, ground: g };
  };
  signs(root, batch, [
    sign('Great Pyramid of Khufu', 10, -204, 0.42),
    sign('Pyramid of Khafre', -328, -528, 0.42),
    sign('Pyramid of Menkaure', -684, -716, 0.5),
    sign('Great Sphinx', 318, -372, 0.9),
    sign('Valley temple', 462, -558, 0.46),
    sign('Causeway', 100, -372, 0.5),
    sign('Queens’ pyramids', 272, -176, 0.5),
    sign('Officials’ tombs', -470, 12, 0.5),
    sign('Stone quarry', 60, -650, 0.42),
    sign('Wall of the Crow', 110, -824, 0.42),
    sign('Builders’ town', 420, -806, 0.42),
    sign('Harbor', 650, -760, 0.42),
    sign('To the Nile', 792, -40, 0.5),
    { text: 'Inside the Great Pyramid', x: G.x, z: G.z - 1, y: G.y + G.h + 0.25, ground: G.y + G.h - 0.3 },
  ], { plate: 0.28, post: 0x5a4c3c });
  root.add(batch.mesh());
}

// ---------------------------------------------------------------------------------------------
// Boats. One mesh, each boat's part of it rewritten from its own loop round the harbor.
// ---------------------------------------------------------------------------------------------
function boatTemplate(sail, cargo) {
  const parts = [];
  const paint = (g, col) => {
    const n = g.index ? g.toNonIndexed() : g;
    const c = new Float32Array(n.attributes.position.count * 3);
    const rgb = lin(col);
    for (let i = 0; i < c.length; i += 3) { c[i] = rgb[0]; c[i + 1] = rgb[1]; c[i + 2] = rgb[2]; }
    n.setAttribute('color', new THREE.BufferAttribute(c, 3));
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'color'].includes(k)) n.deleteAttribute(k);
    return n;
  };
  // A papyrus-bundle hull with its ends swept up, and a nearly flat deck.
  const hull = tube([[0, 0.1, 0.36], [0, 0.03, 0.22], [0, 0.015, 0], [0, 0.03, -0.22], [0, 0.11, -0.36]], [0.006, 0.05, 0.065, 0.05, 0.006], { sides: 8, steps: 12, round: 0 });
  hull.scale(1.25, 0.62, 1);
  parts.push(paint(hull, 0xb09a5a));
  if (sail) {
    const mast = new THREE.CylinderGeometry(0.006, 0.008, 0.36, 5);
    mast.translate(0, 0.2, 0.04);
    parts.push(paint(mast, 0x6a5238));
    const cloth = new THREE.BoxGeometry(0.24, 0.2, 0.006);
    cloth.translate(0, 0.26, 0.04);
    parts.push(paint(cloth, 0xe8e0c8));
  }
  if (cargo) {
    const block = new THREE.BoxGeometry(0.075, 0.05, 0.14);
    block.translate(0, 0.055, 0.02);
    parts.push(paint(block, cargo));
    const b2 = new THREE.BoxGeometry(0.07, 0.04, 0.11);
    b2.translate(0, 0.05, -0.14);
    parts.push(paint(b2, cargo));
  }
  return mergeGeometries(parts, false);
}

function buildBoats() {
  const tpls = [boatTemplate(true, 0xdcd4bc), boatTemplate(true, 0xa8644e), boatTemplate(false, 0xdcd4bc), boatTemplate(true, null)];
  // A long loop in the basin and the channel, one way up and the other way back, as boats keep to.
  const cx = planX(698); const cz = planZ(-420); const rx = 0.84; const rz = 3.05;
  const list = tpls.map((g, i) => ({ g, phase: (i / tpls.length) * TAU + 0.5 }));
  let total = 0;
  for (const b of list) { b.at = total; total += b.g.attributes.position.count; }
  const P = new Float32Array(total * 3); const N = new Float32Array(total * 3); const C = new Float32Array(total * 3);
  for (const b of list) C.set(b.g.attributes.color.array, b.at * 3);
  const write = (time) => {
    for (const b of list) {
      const a = b.phase + time * 0.045;
      const x = cx + Math.cos(a) * rx; const z = cz + Math.sin(a) * rz;
      const dx = -Math.sin(a) * rx; const dz = Math.cos(a) * rz;
      const l = Math.hypot(dx, dz);
      const hx = dx / l; const hz = dz / l;
      const src = b.g.attributes.position.array; const nor = b.g.attributes.normal.array;
      const bob = 0.004 * Math.sin(time * 1.3 + b.phase * 3);
      let o = b.at * 3;
      for (let i = 0; i < b.g.attributes.position.count; i++) {
        const u = src[i * 3]; const v = src[i * 3 + 1]; const w = src[i * 3 + 2];
        P[o] = x + u * hz + w * hx; P[o + 1] = WATER + 0.005 + v + bob; P[o + 2] = z - u * hx + w * hz;
        const nu = nor[i * 3]; const nw = nor[i * 3 + 2];
        N[o] = nu * hz + nw * hx; N[o + 1] = nor[i * 3 + 1]; N[o + 2] = -nu * hx + nw * hz;
        o += 3;
      }
    }
  };
  write(0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, WATER, cz), 5);
  const m = mesh(g, standard({ vertexColors: true, roughness: 0.68, metalness: 0 }));
  m.update = (time) => {
    write(time);
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
  };
  return m;
}

function buildGiza() {
  const root = new THREE.Group();
  root.name = 'giza-plateau-diorama';
  // Everything is laid out on the plan's own coordinates, and then the plan and its shelf together are
  // moved so that the whole base is centred on the origin.
  const plan = new THREE.Group();
  plan.position.x = 3.6;
  root.add(plan);
  plan.add(buildGround());
  plan.add(buildWater());
  plan.add(pyramidMesh());
  const boats = buildBoats();
  plan.add(boats);
  buildScenery(plan);
  if (!reducedMotion()) {
    let t = 0;
    root.userData.tick = { update(dt) { t += dt; boats.update(t); } };
  }
  return root;
}

export const BUILDERS = {
  'giza-plateau-diorama': () => buildGiza(),
};
