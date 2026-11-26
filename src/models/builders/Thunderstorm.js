import * as THREE from 'three';
import { mesh, standard, canvasTexture, seededRandom } from '../../PropKit.js';
import { mergeParts, smoothNoise3 } from '../../props/LoftKit.js';
import { Sculpt, sphereP, ellipsoidP, polygonize, fieldD, lathe, tube, outward, clamp01, mix, sstep } from '../ModelKit.js';
import { reducedMotion } from '../../Settings.js';

// A mature thunderstorm, a cumulonimbus with its anvil, cut in half so that the face toward the
// student (+Z) shows what is inside: warm air rising, the freezing level, hail growing in the
// supercooled middle of the cloud, and electric charge pulled apart until lightning jumps.
//
// ONE SCALE UP AND ACROSS. 1 ft of model is 6,250 ft of storm (0.16 ft per thousand feet), so a
// 5,000 ft cloud base stands 0.8 ft over the fields and the overshooting top reaches 53,000 ft at
// 9 ft. Only the hail, the charge signs, the houses and the trees are drawn far larger than real.
//
// THE CUT FACE IS A TEXTURE. The cloud is sculpted as a field and polygonised with the front half
// removed, so the section comes out as a flat face. Its triangles are lifted into their own mesh
// and painted per texel from the same heights and columns that place the arrows, the hail paths and
// the charges, so the painted freezing line and the freezing-level tick on the ruler cannot drift.
//
// WHAT MOVES lives in ONE mesh whose buffer is rewritten each frame: hailstones riding the paths,
// the charge signs drifting apart, and two lightning bolts that are collapsed to a point while
// they are off. The root never moves, and reducedMotion() leaves the model as one still diagram.

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// The one description everything reads
// ---------------------------------------------------------------------------------------------
const GY = 0.5; // the fields, on top of the plinth
const S = 0.16; // feet of model per thousand feet of storm
const altY = (kft) => GY + kft * S;
const BASE_Y = altY(5); // the flat dark cloud base
const FZ = altY(15); // 0 °C, 32 °F: a summer freezing level
const M10 = altY(20); // -10 °C
const M20 = altY(26); // -20 °C
const M40 = altY(34); // -40 °C: above this every drop has frozen
const TROPO = altY(44); // the top of the troposphere, where the anvil spreads
const TOP = altY(53); // the overshooting top

const PL = { x0: -6, x1: 6, z0: -3.4, z1: 2.6 };
const xc = (y) => -0.6 + 0.08 * (y - BASE_Y); // the tower's axis, leaning downwind
const towerR = (y) => 2.65 - 0.55 * sstep(y, 2.5, 7);
const xu = (y) => xc(y) - 0.75; // the updraft, on the inflow side
const XD = 1.75; // the rain-cooled downdraft, on the forward side under the anvil

// Rain shaft under the forward flank.
const RAIN = { x: 1.8, rx: 1.25, rz: 1.5 };

// How far proud of the cut face each layer stands.
const Z_PLATE = 0.045;
const Z_ARROW = 0.15;
const Z_CHARGE = 0.26;
const Z_HAIL = 0.33;
const Z_BOLT = 0.4;

// The extent of the cut-face painting.
const CUT = { x0: -4.4, x1: 6.8, y0: 0.9, y1: 9.3 };

// Charge regions, the tripole: upper positive, main negative between -10 and -20 °C, a small lower
// positive near the freezing level, and positive charge induced on the ground underneath.
const CHARGE = {
  mixed: { x0: -1.35, x1: 0.75, y0: 4.2, y1: 5.5 },
  upper: { x0: -1.25, x1: 2.0, y0: 6.3, y1: 7.15 },
  anvil: { x0: 2.35, x1: 3.55, y0: 6.95, y1: 7.2 },
  main: { x0: -1.55, x1: 0.95, y0: M10 + 0.12, y1: M20 + 0.02 },
  lower: { x0: 0.65, x1: 1.45, y0: FZ - 0.3, y1: FZ + 0.12 },
  ground: { x0: -1.5, x1: 0.9, z0: 0.35, z1: 1.15 },
};
if (!(CHARGE.main.y0 > M10 && CHARGE.main.y1 < M20 + 0.05)) throw new Error('thunderstorm-cutaway: the main negative charge must sit between -10 and -20 °C');
if (!(CHARGE.upper.y0 > M40)) throw new Error('thunderstorm-cutaway: the upper positive charge must be in the all-ice top');

const smax = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
};

const FONT = 'Arial, Helvetica, sans-serif';
function fitFont(ctx, text, maxWidth, size, weight = '800') {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  const width = ctx.measureText(text).width;
  if (width > maxWidth) { s = (s * maxWidth) / width; ctx.font = `${weight} ${s}px ${FONT}`; }
  return s;
}

function hash2(i, j) {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ---------------------------------------------------------------------------------------------
// The cloud, as one sculpted field
// ---------------------------------------------------------------------------------------------
const CELL = 0.1;

function cloudSculpt() {
  const rng = seededRandom(4021);
  const W = [1, 1, 1];
  const sc = new Sculpt(CELL);
  // The tower: a stack of round masses up the leaning axis.
  for (let y = BASE_Y + 0.35; y <= TROPO - 0.2; y += 0.6) {
    const r = towerR(y) * 0.86;
    sc.add(ellipsoidP([xc(y), y, -0.05], [r, 0.85, r * 0.95]), W, { k: 0.5 });
  }
  // The forward flank: lower cloud under the anvil, where the rain comes out.
  for (const [x, y, rx, ry, rz] of [[1.75, 1.95, 1.55, 0.72, 1.55], [2.45, 2.6, 1.15, 0.72, 1.3], [3.05, 1.85, 0.95, 0.6, 1.15]]) {
    sc.add(ellipsoidP([x, y, -0.15], [rx, ry, rz]), W, { k: 0.4 });
  }
  // A flanking line of younger towers feeding in from the inflow side.
  for (const [x, y, r] of [[-3.55, 1.75, 0.62], [-4.05, 1.55, 0.46], [-3.4, 2.3, 0.5], [-3.75, 2.05, 0.42]]) sc.add(sphereP([x, y, -0.4], r), W, { k: 0.2 });
  // Cauliflower turrets, each carrying a few smaller ones: a cloud's lumps have lumps.
  const turrets = [];
  for (let i = 0; i < 96; i++) {
    const y = mix(BASE_Y + 0.45, TROPO + 0.05, rng() ** 0.8);
    const a = rng() * TAU;
    const r = towerR(y);
    const rad = mix(0.36, 0.82, rng()) * (0.78 + 0.35 * sstep(y, 3, 7));
    const rr = r * mix(0.74, 0.9, rng());
    const x = xc(y) + Math.cos(a) * rr;
    const z = Math.sin(a) * rr * 0.95 - 0.05;
    if (z > rad + 0.1) continue; // wholly in the half that is cut away
    sc.add(sphereP([x, y, z], rad), W, { k: 0.18 });
    turrets.push([x, y, z, rad, a]);
  }
  for (const [x, y, z, rad, a] of turrets) {
    const n = y > 3.5 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      // Out and up from the turret's own centre.
      const b = a + (rng() - 0.5) * 1.6;
      const up = 0.25 + rng() * 0.75;
      const h = Math.sqrt(1 - up * up);
      const dx = Math.cos(b) * h; const dy = up; const dz = Math.sin(b) * h;
      const r2 = rad * mix(0.38, 0.55, rng());
      const cz = z + dz * rad * 0.82;
      if (cz > r2 + 0.1) continue;
      sc.add(sphereP([x + dx * rad * 0.82, y + dy * rad * 0.82, cz], r2), W, { k: 0.1 });
    }
  }
  // The flat dark base.
  sc.map((d, x, y) => smax(d, BASE_Y - y, 0.12));
  // A wall cloud hanging under the updraft.
  sc.add(ellipsoidP([xu(BASE_Y) + 0.15, BASE_Y - 0.02, -0.3], [0.85, 0.26, 0.8]), W, { k: 0.25 });
  // The anvil: a chain spreading downwind, thinning toward its tip and fanning wider.
  for (let x = -2.5; x <= 6.0; x += 0.4) {
    const thick = mix(0.58, 0.27, sstep(x, -0.8, 6.0)) * (1 + 0.14 * Math.sin(x * 2.3 + 0.7));
    // In plan it is a fan: narrow where it leaves the tower, widening downwind, rounded at the tip.
    let rz = x < -1 ? mix(1.3, 1.9, sstep(x, -2.6, -1)) : mix(1.9, 3.3, sstep(x, -1, 5.0));
    rz *= 1 - 0.5 * sstep(x, 5.0, 6.1);
    rz *= 1 + 0.12 * Math.sin(x * 1.9 + 1) + 0.06 * Math.sin(x * 4.1);
    sc.add(ellipsoidP([x, TROPO - thick * 0.72, -0.15], [0.6, thick, rz]), W, { k: 0.45 });
  }
  // Puffs along the anvil's upwind half, where it is still made of fresh tops.
  for (let i = 0; i < 16; i++) {
    const x = mix(-2.2, 2.6, rng());
    const z = -mix(0.0, 1.6, rng());
    sc.add(sphereP([x, TROPO - 0.25, z], mix(0.25, 0.42, rng())), W, { k: 0.15 });
  }
  // The tropopause stops it like a ceiling: everything below is clipped flat at TROPO.
  sc.map((d, x, y) => smax(d, y - TROPO, 0.08));
  // The overshooting top, punched through the ceiling over the strongest updraft.
  const ox = xc(TROPO) - 0.35;
  sc.add(ellipsoidP([ox, TROPO + 0.1, -0.15], [1.15, TOP - TROPO - 0.3, 1.05]), W, { k: 0.4 });
  for (let i = 0; i < 12; i++) {
    const a = rng() * TAU; const up = 0.2 + rng() * 0.8; const h = Math.sqrt(1 - up * up);
    const cz = -0.15 + Math.sin(a) * h * 0.95;
    const r2 = mix(0.3, 0.48, rng());
    if (cz > r2 + 0.1) continue;
    sc.add(sphereP([ox + Math.cos(a) * h * 1.0, TROPO + 0.1 + up * (TOP - TROPO - 0.55), cz], r2), W, { k: 0.12 });
  }
  // Mammatus, the pouches that hang under an anvil.
  for (let i = 0; i < 34; i++) {
    const x = mix(1.9, 5.6, rng());
    const thick = mix(0.58, 0.27, sstep(x, -0.8, 6.0)) * (1 + 0.14 * Math.sin(x * 2.3 + 0.7));
    const under = TROPO - thick * 1.72;
    const z = -mix(0.0, 2.3, rng()) * (1 - 0.4 * sstep(x, 4.6, 5.6));
    sc.add(sphereP([x, under - 0.02, z], mix(0.14, 0.22, rng())), W, { k: 0.1 });
  }
  // A gentle wobble, low in frequency so the grid has nine samples to a cycle.
  sc.map((d, x, y, z) => d + 0.1 * (smoothNoise3(x * 1.1 + 7.1, y * 1.1 + 2.3, z * 1.1 + 4.9) - 0.5));
  // The cut: nothing in front of z = 0.
  sc.map((d, x, y, z) => Math.max(d, z));
  return sc;
}

// Cloud shading as vertex colour: pale tops, grey sides, a dark grey-blue base.
function cloudTint(x, y, z, nx, ny, nz, rgb) {
  const h = clamp01((y - BASE_Y) / (TOP - BASE_Y));
  const up = 0.5 + 0.5 * ny;
  let v = 0.36 + 0.4 * up + 0.2 * h;
  // Shadowed crevices read darker: a coarse noise as stand-in for occlusion.
  v *= 0.88 + 0.2 * smoothNoise3(x * 2.2 + 1.3, y * 2.2, z * 2.2 + 8.1);
  const blue = 0.08 * (1 - h);
  let r = v - blue * 0.9; let g = v - blue * 0.5; let b = v + blue * 0.25;
  // The base: dark, and blue-grey.
  const base = (ny < -0.55 ? 1 : 0) * (1 - sstep(y, BASE_Y + 0.15, BASE_Y + 0.6));
  r = mix(r, 0.13, base); g = mix(g, 0.15, base); b = mix(b, 0.21, base);
  // The anvil's underside, in its own shade.
  const anvilUnder = (ny < -0.5 ? 1 : 0) * sstep(y, TROPO - 1.4, TROPO - 0.9);
  r = mix(r, 0.32, anvilUnder * 0.6); g = mix(g, 0.35, anvilUnder * 0.6); b = mix(b, 0.43, anvilUnder * 0.6);
  // The anvil is ice: fibrous streaks running downwind, the way cirrus is drawn out.
  const fib = sstep(y, TROPO - 0.9, TROPO - 0.4) * sstep(x, 0.5, 2.0);
  const k = 1 - fib * 0.1 * smoothNoise3(x * 0.35 + 3, y * 0.5, z * 1.2 + 6);
  rgb[0] = r * k; rgb[1] = g * k; rgb[2] = b * k;
}

function buildCloud() {
  const sc = cloudSculpt();
  const snap = { ops: sc.ops };
  const tint = (x, y, z, nx, ny, nz, rgb) => {
    cloudTint(x, y, z, nx, ny, nz, rgb);
    // Occlusion, asked of the field itself: how much cloud is there just off this surface?
    const o1 = clamp01((0.16 - fieldD(snap.ops, x + nx * 0.16, y + ny * 0.16, z + nz * 0.16)) / 0.16);
    const o2 = clamp01((0.42 - fieldD(snap.ops, x + nx * 0.42, y + ny * 0.42, z + nz * 0.42)) / 0.42);
    const k = 1 - 0.3 * o1 - 0.3 * o2;
    rgb[0] *= k; rgb[1] *= k; rgb[2] *= k * 1.02;
  };
  const g = polygonize(sc, { tint, uvScale: 0.55, bounds: [-4.9, BASE_Y - 0.5, -3.9, 6.9, TOP + 0.3, 0.12] });
  const P = g.attributes.position;
  const idx = g.index.array;
  const cloudIdx = [];
  const netsCut = [];
  const near = (i) => Math.abs(P.getZ(i)) < 0.012;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]; const b = idx[t + 1]; const c = idx[t + 2];
    let cut = near(a) && near(b) && near(c);
    if (cut) {
      const ux = P.getX(b) - P.getX(a); const uy = P.getY(b) - P.getY(a);
      const vx = P.getX(c) - P.getX(a); const vy = P.getY(c) - P.getY(a);
      if (ux * vy - uy * vx <= 0) cut = false; // must face +Z
    }
    if (cut) netsCut.push(a, b, c); else cloudIdx.push(a, b, c);
  }
  // The cut is flat, so it does not need the surface-nets grid: it is re-triangulated from its own
  // outline, which is the cloud's open rim. The rim is snapped to z = 0 on both sides of the seam.
  const count = new Map();
  const ekey = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);
  for (let t = 0; t < cloudIdx.length; t += 3) {
    for (const [a, b] of [[cloudIdx[t], cloudIdx[t + 1]], [cloudIdx[t + 1], cloudIdx[t + 2]], [cloudIdx[t + 2], cloudIdx[t]]]) {
      const k = ekey(a, b);
      count.set(k, (count.get(k) || 0) + 1);
    }
  }
  const next = new Map();
  for (let t = 0; t < cloudIdx.length; t += 3) {
    for (const [a, b] of [[cloudIdx[t], cloudIdx[t + 1]], [cloudIdx[t + 1], cloudIdx[t + 2]], [cloudIdx[t + 2], cloudIdx[t]]]) {
      if (count.get(ekey(a, b)) !== 1) continue;
      if (!next.has(a)) next.set(a, []);
      next.get(a).push(b);
    }
  }
  const loops = [];
  for (const startV of next.keys()) {
    while (next.get(startV).length) {
      const loop = [startV];
      let v = next.get(startV).pop();
      let guard = 0;
      while (v !== startV && guard++ < 100000) {
        loop.push(v);
        const outs = next.get(v);
        if (!outs || !outs.length) break;
        v = outs.pop();
      }
      if (v === startV && loop.length >= 3) loops.push(loop);
    }
  }
  // The rim follows the grid, so it comes out as a staircase. Relaxed along itself, in the plane,
  // it becomes the clean outline of a section; the cloud's own triangles follow it.
  for (const loop of loops) {
    const n = loop.length;
    for (let it = 0; it < 5; it++) {
      const xs = loop.map((i) => P.getX(i)); const ys = loop.map((i) => P.getY(i));
      for (let k = 0; k < n; k++) {
        const a = (k + n - 1) % n; const b = (k + 1) % n;
        P.setXY(loop[k], xs[k] * 0.5 + (xs[a] + xs[b]) * 0.25, ys[k] * 0.5 + (ys[a] + ys[b]) * 0.25);
      }
    }
  }
  const area2 = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  let netsArea = 0;
  for (let t = 0; t < netsCut.length; t += 3) {
    const [a, b, c] = [netsCut[t], netsCut[t + 1], netsCut[t + 2]];
    netsArea += area2(P.getX(a), P.getY(a), P.getX(b), P.getY(b), P.getX(c), P.getY(c)) / 2;
  }
  let tris = [];
  let fanArea = 0;
  for (const loop of loops) {
    const contour = loop.map((i) => new THREE.Vector2(P.getX(i), P.getY(i)));
    const faces = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [a, b, c] of faces) {
      const ia = loop[a]; const ib = loop[b]; const ic = loop[c];
      const ar = area2(P.getX(ia), P.getY(ia), P.getX(ib), P.getY(ib), P.getX(ic), P.getY(ic)) / 2;
      if (Math.abs(ar) < 1e-9) continue;
      if (ar > 0) tris.push(ia, ib, ic); else tris.push(ia, ic, ib);
      fanArea += Math.abs(ar);
    }
  }
  // If the outline was not clean enough to triangulate, keep the grid's own cut.
  if (!(Math.abs(fanArea - netsArea) < netsArea * 0.01)) tris = netsCut;
  for (const loop of loops) for (const i of loop) P.setZ(i, 0);
  const cutPos = []; const cutUV = []; const cutNrm = [];
  for (const i of tris) {
    const x = P.getX(i); const y = P.getY(i);
    cutPos.push(x, y, 0);
    cutNrm.push(0, 0, 1);
    cutUV.push((x - CUT.x0) / (CUT.x1 - CUT.x0), (y - CUT.y0) / (CUT.y1 - CUT.y0));
  }
  g.setIndex(cloudIdx);
  const cutGeo = new THREE.BufferGeometry();
  cutGeo.setAttribute('position', new THREE.Float32BufferAttribute(cutPos, 3));
  cutGeo.setAttribute('normal', new THREE.Float32BufferAttribute(cutNrm, 3));
  cutGeo.setAttribute('uv', new THREE.Float32BufferAttribute(cutUV, 2));
  cutGeo.userData.fallback = tris === netsCut;
  return { cloudGeo: g, cutGeo };
}

// ---------------------------------------------------------------------------------------------
// The cut face, painted per texel
// ---------------------------------------------------------------------------------------------
function makeNoise(seed) {
  const rng = seededRandom(seed);
  const N = 64;
  const L = new Float32Array(N * N);
  for (let i = 0; i < L.length; i++) L[i] = rng();
  return (x, y) => {
    const xi = Math.floor(x); const yi = Math.floor(y);
    let fx = x - xi; let fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % N) + N) % N; const y0 = ((yi % N) + N) % N;
    const x1 = (x0 + 1) % N; const y1 = (y0 + 1) % N;
    const a = L[x0 + y0 * N]; const b = L[x1 + y0 * N];
    const c = L[x0 + y1 * N]; const d = L[x1 + y1 * N];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

// The isotherms bow upward in the updraft, which is warmer than the air around it.
const isoLift = (x, y) => 0.3 * Math.exp(-(((x - xu(y)) / 1.0) ** 2));

function paintSection(ctx, w, h) {
  const noise = makeNoise(733);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const WARM_LO = [244, 196, 160]; const WARM_HI = [238, 216, 200];
  const SUP_LO = [196, 212, 242]; const SUP_HI = [208, 204, 240];
  const ICE = [226, 240, 252];
  let o = 0;
  for (let j = 0; j < h; j++) {
    const y = CUT.y1 - ((j + 0.5) / h) * (CUT.y1 - CUT.y0);
    for (let i = 0; i < w; i++) {
      const x = CUT.x0 + ((i + 0.5) / w) * (CUT.x1 - CUT.x0);
      const yy = y - isoLift(x, y);
      // Temperature bands.
      let R; let G; let B;
      const tw = clamp01((yy - BASE_Y) / (FZ - BASE_Y));
      const ts = clamp01((yy - FZ) / (M40 - FZ));
      if (yy < FZ) { R = mix(WARM_LO[0], WARM_HI[0], tw); G = mix(WARM_LO[1], WARM_HI[1], tw); B = mix(WARM_LO[2], WARM_HI[2], tw); } else { R = mix(SUP_LO[0], SUP_HI[0], ts); G = mix(SUP_LO[1], SUP_HI[1], ts); B = mix(SUP_LO[2], SUP_HI[2], ts); }
      const ice = sstep(yy, M40 - 0.06, M40 + 0.06);
      R = mix(R, ICE[0], ice); G = mix(G, ICE[1], ice); B = mix(B, ICE[2], ice);
      // Billows in section.
      const puff = noise(x * 1.7 + 3, y * 1.7) * 0.6 + noise(x * 4.2, y * 4.2 + 9) * 0.4;
      const shade = 0.9 + 0.17 * (puff - 0.5);
      R *= shade; G *= shade; B *= shade;
      // The updraft: warm, streaked upward.
      const uw = Math.exp(-(((x - xu(y)) / 0.62) ** 2)) * (1 - sstep(y, 5.8, 7.3)) * sstep(y, BASE_Y - 0.4, BASE_Y + 0.4);
      const ustreak = 0.75 + 0.5 * noise((x - xu(y)) * 9, y * 0.9);
      R = mix(R, 250, uw * 0.42 * ustreak); G = mix(G, 160, uw * 0.42 * ustreak); B = mix(B, 110, uw * 0.42 * ustreak);
      // The downdraft and the rain core: cooler, darker, streaked downward.
      const dw = Math.exp(-(((x - XD) / 0.95) ** 2)) * (1 - sstep(y, 4.4, 5.6));
      R = mix(R, 118, dw * 0.38); G = mix(G, 138, dw * 0.38); B = mix(B, 178, dw * 0.38);
      if (dw > 0.05) {
        if (yy < FZ + 0.15) {
          const s = noise((x + y * 0.18) * 26, y * 1.4);
          if (s > 0.7) { const k = dw * (s - 0.7) * 2.4; R = mix(R, 70, k); G = mix(G, 96, k); B = mix(B, 150, k); }
        } else {
          const s = noise(x * 30 + 11, y * 30);
          if (s > 0.86) { const k = dw * 0.9; R = mix(R, 250, k); G = mix(G, 252, k); B = mix(B, 255, k); }
        }
      }
      // Faint halos where the charge sits.
      const halo = (c, col, k) => {
        const cx = (c.x0 + c.x1) / 2; const cy = (c.y0 + c.y1) / 2;
        const ex = (x - cx) / ((c.x1 - c.x0) / 2 + 0.45); const ey = (y - cy) / ((c.y1 - c.y0) / 2 + 0.3);
        const e = Math.exp(-(ex * ex + ey * ey) * 1.4) * k;
        R = mix(R, col[0], e); G = mix(G, col[1], e); B = mix(B, col[2], e);
      };
      halo(CHARGE.upper, [248, 168, 168], 0.32);
      halo(CHARGE.anvil, [248, 168, 168], 0.28);
      halo(CHARGE.main, [150, 172, 250], 0.4);
      halo(CHARGE.lower, [248, 168, 168], 0.28);
      // The freezing line, dashed, and the -40 line, dotted.
      if (Math.abs(yy - FZ) < 0.022 && ((x * 3.2) % 1 + 1) % 1 < 0.62) { R = 28; G = 78; B = 200; }
      if (Math.abs(yy - M40) < 0.014 && ((x * 6) % 1 + 1) % 1 < 0.4) { R = 60; G = 92; B = 168; }
      d[o++] = Math.min(255, Math.max(0, R)); d[o++] = Math.min(255, Math.max(0, G)); d[o++] = Math.min(255, Math.max(0, B)); d[o++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // A few words painted on the section itself.
  const px = (x) => ((x - CUT.x0) / (CUT.x1 - CUT.x0)) * w;
  const py = (y) => ((CUT.y1 - y) / (CUT.y1 - CUT.y0)) * h;
  const ftPx = w / (CUT.x1 - CUT.x0);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const word = (text, x, y, size, color, maxFt) => {
    ctx.fillStyle = color;
    fitFont(ctx, text, maxFt * ftPx, size * ftPx, '700');
    ctx.fillText(text, px(x), py(y));
  };
  word('\u221240 °F: all ice above', 0.05, M40 + 0.14, 0.16, '#1f3f86', 1.3);
  word('Water droplets', -0.8, BASE_Y + 0.42, 0.15, '#8a4a22', 1.05);
  word('Supercooled water and ice', -0.8, FZ + 0.4, 0.14, '#3a4f90', 1.95);
  word('Rain', XD + 0.35, BASE_Y + 0.35, 0.16, '#24406e', 0.8);
}

// ---------------------------------------------------------------------------------------------
// The landscape and plinth
// ---------------------------------------------------------------------------------------------
const groundH = (x, z) => GY + 0.03 * (Math.sin(x * 1.3 + z * 0.7) + Math.sin(z * 1.9 - x * 0.6)) * sstep(Math.min(x - PL.x0, PL.x1 - x, z - PL.z0, PL.z1 - z), 0, 0.4) - 0.015;

const RIVER = [[-6.2, 1.75], [-4.6, 1.25], [-3.0, 1.7], [-1.3, 2.1], [0.4, 1.7], [2.0, 2.05], [3.6, 1.55], [5.0, 1.85], [6.2, 1.5]];
function riverDist(x, z) {
  let best = 1e9;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, az] = RIVER[i]; const [bx, bz] = RIVER[i + 1];
    const vx = bx - ax; const vz = bz - az;
    const t = clamp01(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz));
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return best;
}

const FIELD_COLORS = [0x6f9a3e, 0x87a84a, 0xc6b25a, 0xa9a24e, 0x8c6c46, 0x5c8a38, 0x97b252].map((c) => new THREE.Color(c));
function groundColor(x, z) {
  const u = x * 0.92 + z * 0.39; const v = -x * 0.39 + z * 0.92;
  const k = Math.floor(hash2(Math.floor(u / 0.95), Math.floor(v / 0.72)) * FIELD_COLORS.length);
  const c = FIELD_COLORS[k];
  let r = c.r; let g = c.g; let b = c.b;
  // Wet and dark under the rain shaft.
  const wet = Math.exp(-(((x - RAIN.x) / (RAIN.rx + 0.5)) ** 2 + ((z + 0.3) / (RAIN.rz + 0.6)) ** 2) * 1.6);
  r *= 1 - 0.38 * wet; g *= 1 - 0.32 * wet; b *= 1 - 0.2 * wet;
  const rd = riverDist(x, z);
  const water = 1 - sstep(rd, 0.1, 0.2);
  const water2 = new THREE.Color(0x3a6aa4);
  r = mix(r, water2.r, water); g = mix(g, water2.g, water); b = mix(b, water2.b, water);
  return [r, g, b];
}

function buildGroundBlock() {
  const NX = 60; const NZ = 30;
  const pos = []; const nrm = []; const col = []; const index = [];
  const xs = (i) => mix(PL.x0, PL.x1, i / NX);
  const zs = (j) => mix(PL.z0, PL.z1, j / NZ);
  // Top grid.
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const x = xs(i); const z = zs(j);
      pos.push(x, groundH(x, z), z);
      nrm.push(0, 1, 0);
      col.push(...groundColor(x, z));
    }
  }
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i; const b = a + 1; const c = a + NX + 2; const e = a + NX + 1;
      index.push(a, e, c, a, c, b);
    }
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  top.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  top.setIndex(index);
  top.computeVertexNormals();
  // The perimeter, counterclockwise from above.
  const ring = [];
  for (let i = 0; i < NX; i++) ring.push([xs(i), PL.z1]);
  for (let j = NZ; j > 0; j--) ring.push([PL.x1, zs(j)]);
  for (let i = NX; i > 0; i--) ring.push([xs(i), PL.z0]);
  for (let j = 0; j < NZ; j++) ring.push([PL.x0, zs(j)]);
  const sp = []; const sc = [];
  const WOOD = new THREE.Color(0x3d2b1f); const SOIL = new THREE.Color(0x6b4a30);
  const push = (p, c) => { sp.push(...p); sc.push(c.r, c.g, c.b); };
  for (let k = 0; k < ring.length; k++) {
    const [ax, az] = ring[k]; const [bx, bz] = ring[(k + 1) % ring.length];
    const ah = groundH(ax, az); const bh = groundH(bx, bz);
    // Soil below the turf, then the walnut plinth.
    for (const [y0a, y1a, y0b, y1b, c] of [[GY - 0.14, ah, GY - 0.14, bh, SOIL], [0, GY - 0.14, 0, GY - 0.14, WOOD]]) {
      push([ax, y0a, az], c); push([bx, y0b, bz], c); push([bx, y1b, bz], c);
      push([ax, y0a, az], c); push([bx, y1b, bz], c); push([ax, y1a, az], c);
    }
    push([0, 0, 0], WOOD); push([bx, 0, bz], WOOD); push([ax, 0, az], WOOD);
  }
  const sides = new THREE.BufferGeometry();
  sides.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sides.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
  sides.computeVertexNormals();
  return [{ geometry: top, keepColor: true }, { geometry: outward(sides), keepColor: true }];
}

function buildScenery(parts) {
  const rng = seededRandom(918);
  // Forests, for scale. A tree here is drawn about twenty times too big.
  const tree = (x, z, s) => {
    const h = 0.2 * s; const r = 0.07 * s;
    const g = lathe([[0, 0], [r, h * 0.18], [r * 0.5, h * 0.62], [0, h]], 6);
    g.translate(x, groundH(x, z) - 0.01, z);
    parts.push({ geometry: g, color: [0x2f5a2a, 0x3b6b2e, 0x285024][Math.floor(rng() * 3)] });
  };
  for (const [cx, cz, rx, rz, n] of [[-4.6, -2.3, 1.0, 0.7, 26], [4.9, -2.1, 0.8, 0.9, 22], [-2.6, 1.05, 0.55, 0.3, 9], [5.2, 0.9, 0.5, 0.45, 10]]) {
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU; const q = Math.sqrt(rng());
      const x = cx + Math.cos(a) * rx * q; const z = cz + Math.sin(a) * rz * q;
      if (riverDist(x, z) < 0.25) continue;
      tree(x, z, 0.8 + rng() * 0.5);
    }
  }
  // A small town in the path of the gust front.
  for (let i = 0; i < 14; i++) {
    const x = 3.0 + (i % 5) * 0.27 + (rng() - 0.5) * 0.06;
    const z = 0.55 + Math.floor(i / 5) * 0.3 + (rng() - 0.5) * 0.05;
    const yb = groundH(x, z) - 0.01;
    const w = 0.15; const hgt = 0.09; const dep = 0.12;
    const body = new THREE.BoxGeometry(w, hgt, dep);
    body.translate(x, yb + hgt / 2, z);
    parts.push({ geometry: body, color: [0xeee6d4, 0xd9c7a6, 0xb8664a, 0xe2ddd0][Math.floor(rng() * 4)] });
    const roof = new THREE.ConeGeometry(w * 0.78, 0.07, 4);
    roof.rotateY(Math.PI / 4);
    roof.scale(1, 1, dep / w);
    roof.translate(x, yb + hgt + 0.035, z);
    parts.push({ geometry: roof, color: [0x7a3a2c, 0x4f4f56, 0x8a4d35][Math.floor(rng() * 3)] });
  }
}

// ---------------------------------------------------------------------------------------------
// Labels, arrows and the altitude ruler: one mesh on one atlas
// ---------------------------------------------------------------------------------------------
const LABELS = [
  { key: 'anvil', text: 'ANVIL', w: 1.05, h: 0.34, fg: '#16304e' },
  { key: 'updraft', text: 'UPDRAFT', w: 1.2, h: 0.36, fg: '#b2361a' },
  { key: 'downdraft', text: 'DOWNDRAFT', w: 1.4, h: 0.36, fg: '#1f4fa8' },
  { key: 'hail', text: 'HAIL GROWS HERE', w: 1.75, h: 0.36, fg: '#16304e' },
  { key: 'minus', text: '− CHARGE', w: 1.15, h: 0.36, fg: '#1f4fc4' },
  { key: 'plus', text: '+ CHARGE', w: 1.15, h: 0.36, fg: '#c0261b' },
  { key: 'ground', text: '+ CHARGE ON THE GROUND', w: 2.0, h: 0.32, fg: '#c0261b' },
  { key: 'freeze', text: 'FREEZING LEVEL|(32°F)', w: 1.3, h: 0.46, fg: '#1f4fc4' },
  { key: 'alt', text: 'HEIGHT', w: 0.95, h: 0.27, fg: '#16304e' },
  { key: 'k10', text: '10,000 ft', w: 0.95, h: 0.25, fg: '#16304e' },
  { key: 'k20', text: '20,000 ft', w: 0.95, h: 0.25, fg: '#16304e' },
  { key: 'k30', text: '30,000 ft', w: 0.95, h: 0.25, fg: '#16304e' },
  { key: 'k40', text: '40,000 ft', w: 0.95, h: 0.25, fg: '#16304e' },
  { key: 'k50', text: '50,000 ft', w: 0.95, h: 0.25, fg: '#16304e' },
];
const ATLAS_W = 1024;
function atlasLayout() {
  let y = 0;
  const rects = {};
  for (const l of LABELS) {
    const hp = Math.round((ATLAS_W * l.h) / l.w);
    rects[l.key] = { y, hp };
    y += hp;
  }
  const white = y; y += 16;
  const cream = y; y += 16;
  return { rects, white, cream, H: y };
}

function paintAtlas(layout) {
  return (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    for (const l of LABELS) {
      const { y, hp } = layout.rects[l.key];
      ctx.fillStyle = '#f5f0e2';
      ctx.fillRect(0, y, w, hp);
      ctx.strokeStyle = '#1e3a5a';
      const lw = Math.max(6, hp * 0.06);
      ctx.lineWidth = lw;
      ctx.strokeRect(lw, y + lw, w - lw * 2, hp - lw * 2);
      ctx.fillStyle = l.fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = l.text.split('|');
      const rowH = (hp - lw * 4) / lines.length;
      lines.forEach((line, i) => {
        fitFont(ctx, line, w - lw * 8, rowH * 0.78);
        ctx.fillText(line, w / 2, y + lw * 2 + rowH * (i + 0.54));
      });
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, layout.white, w, 16);
    ctx.fillStyle = '#f5f0e2';
    ctx.fillRect(0, layout.cream, w, 16);
  };
}

function fillUV(g, u, v) {
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { arr[i * 2] = u; arr[i * 2 + 1] = v; }
  g.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
  return g;
}

function plateGeo(key, layout, t = 0.04) {
  const l = LABELS.find((q) => q.key === key);
  const g = new THREE.BoxGeometry(l.w, l.h, t);
  const { y, hp } = layout.rects[key];
  const H = layout.H;
  const v1 = 1 - y / H; const v0 = 1 - (y + hp) / H;
  const creamV = 1 - (layout.cream + 8) / H;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    if (i >= 16 && i < 20) uv.setXY(i, mix(0.004, 0.996, uv.getX(i)), mix(v0 + 0.001, v1 - 0.001, uv.getY(i)));
    else uv.setXY(i, 0.5, creamV);
  }
  return { g, l };
}

// Base at the origin, +Y along dir.
function standAt(base, dir) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return new THREE.Matrix4().compose(base, q, new THREE.Vector3(1, 1, 1));
}

function arrowGeos(points, r, { head = 2.5, sides = 8 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  const L = curve.getLength();
  const headLen = r * head * 2.3;
  const uEnd = 1 - headLen / L;
  const steps = Math.max(8, Math.round(L / 0.22));
  const shaft = [];
  for (let i = 0; i <= steps; i++) shaft.push(curve.getPointAt((i / steps) * uEnd).toArray());
  const tubeGeo = tube(shaft, r, { steps, sides, round: 2 });
  const base = curve.getPointAt(uEnd);
  const tip = curve.getPointAt(1);
  const cone = lathe([[0, -0.04 * headLen], [r * head, -0.04 * headLen], [r * head * 0.95, 0.03 * headLen], [0.001, headLen]], sides + 4);
  cone.applyMatrix4(standAt(base, tip.clone().sub(base)));
  return [tubeGeo, cone];
}

function buildLabels() {
  const layout = atlasLayout();
  const H = layout.H;
  const whiteV = 1 - (layout.white + 8) / H;
  const parts = [];
  const plate = (key, x, y, z, { tilt = 0 } = {}) => {
    const { g } = plateGeo(key, layout);
    const m = new THREE.Matrix4().makeRotationX(tilt);
    m.setPosition(x, y, z);
    g.applyMatrix4(m);
    parts.push({ geometry: g, keepColor: true });
  };
  const solid = (g, color) => { fillUV(g, 0.5, whiteV); parts.push({ geometry: g, color }); };
  const arrow = (pts, r, color, opts) => { for (const g of arrowGeos(pts, r, opts)) solid(g, color); };

  // Plates on the cut face.
  plate('anvil', 4.45, TROPO - 0.37, Z_PLATE);
  plate('updraft', -2.45, 2.35, Z_PLATE);
  plate('downdraft', 2.75, 2.45, Z_PLATE);
  plate('hail', 0.38, 4.97, Z_PLATE);
  plate('minus', -2.3, 4.2, Z_PLATE);
  plate('plus', -1.95, 7.17, Z_PLATE);

  // The altitude ruler, standing on the fields at the left, on the same scale as the storm.
  const RX = -5.55; const RZ = 0.2;
  const NAVY = 0x22344f;
  solid(tube([[RX, groundH(RX, RZ) - 0.02, RZ], [RX, altY(50) + 0.42, RZ]], 0.035, { sides: 10, steps: 1, round: 2, straight: true }), NAVY);
  solid(lathe([[0, -0.02], [0.13, -0.02], [0.13, 0.03], [0.06, 0.06], [0, 0.07]], 16).translate(RX, groundH(RX, RZ) - 0.03, RZ), NAVY);
  for (const k of [10, 20, 30, 40, 50]) {
    const y = altY(k);
    solid(tube([[RX - 0.06, y, RZ], [RX + 0.12, y, RZ]], 0.022, { sides: 8, steps: 1, round: 1, straight: true }), NAVY);
    plate(`k${k}`, RX + 0.1 + 0.475, y, RZ);
  }
  plate('alt', RX + 0.1 + 0.475, altY(50) + 0.58, RZ);
  // The freezing-level tick, and a blue rod running from it to the dashed line on the section.
  plate('freeze', RX + 0.1 + 0.65, FZ, RZ);
  const BLUE = 0x2a5fd0;
  solid(tube([[RX + 0.1 + 1.28, FZ, RZ], [-3.45, FZ, 0.1], [-2.9, FZ, 0.03]], 0.028, { sides: 8, steps: 6, round: 1 }), BLUE);
  solid(tube([[RX - 0.06, FZ, RZ], [RX + 0.12, FZ, RZ]], 0.026, { sides: 8, steps: 1, round: 1, straight: true }), BLUE);

  // The ground's own charge sign, leaning back on two posts in front of the storm.
  {
    const x = -0.3; const z = 1.95; const y = groundH(x, z) + 0.36;
    plate('ground', x, y, z, { tilt: -0.55 });
    for (const s of [-1, 1]) {
      const px = x + s * 0.7;
      solid(tube([[px, groundH(px, z - 0.12) - 0.02, z - 0.12], [px, y - 0.02, z - 0.06]], 0.022, { sides: 8, steps: 1, round: 1, straight: true }), 0x8a6a3e);
    }
  }

  // Warm, damp air flowing in at low level and up the updraft into the anvil.
  const WARM = 0xe2481c;
  const za = Z_ARROW;
  arrow([[-5.0, 0.86, 0.32], [-3.6, 0.9, 0.3], [-2.35, 1.1, za], [-1.8, 1.75, za], [xu(2.8) - 0.32, 2.8, za], [xu(4.5) - 0.3, 4.5, za], [xu(6.0) - 0.25, 6.0, za], [-0.9, 6.85, za], [0.3, 7.15, za], [1.5, 7.2, za]], 0.065, WARM);
  arrow([[xu(1.6) + 0.3, 1.6, za], [xu(3.2) + 0.32, 3.2, za], [xu(4.8) + 0.3, 4.8, za], [xu(6.0) + 0.38, 6.0, za], [0.2, 6.65, za], [1.6, 6.9, za], [3.3, 6.95, za]], 0.055, WARM);
  // Cold air sinking out of the rain, and spreading along the ground as the gust front.
  const COLD = 0x2a63d4;
  arrow([[XD - 0.4, 4.9, za], [XD - 0.45, 3.6, za], [XD - 0.42, 2.2, za], [XD - 0.3, 1.05, za], [XD + 0.3, 0.72, 0.3], [XD + 1.4, 0.68, 0.45], [XD + 2.6, 0.7, 0.5]], 0.06, COLD);
  arrow([[XD + 0.15, 4.3, za], [XD + 0.18, 3.0, za], [XD + 0.15, 1.6, za], [XD + 0.0, 0.95, za], [XD - 0.5, 0.7, 0.3], [XD - 1.6, 0.68, 0.45]], 0.05, COLD);
  return { geometry: mergeParts(parts), layout };
}

// ---------------------------------------------------------------------------------------------
// Rain
// ---------------------------------------------------------------------------------------------
function buildRain() {
  const pos = []; const uv = [];
  const yTop = BASE_Y + 0.04; const yBot = GY - 0.1;
  const quad = (a, b, c, d, ua, ub) => {
    for (const [p, u, v] of [[a, ua, 1], [b, ub, 1], [c, ub, 0], [a, ua, 1], [c, ub, 0], [d, ua, 0]]) { pos.push(...p); uv.push(u, v); }
  };
  const N = 30;
  let s = 0;
  const slant = 0.22; // the rain is blown forward a little as it falls
  for (let i = 0; i < N; i++) {
    const t0 = Math.PI + (i / N) * Math.PI; const t1 = Math.PI + ((i + 1) / N) * Math.PI;
    const ax = RAIN.x + RAIN.rx * Math.cos(t0); const az = RAIN.rz * Math.sin(t0) - 0.01;
    const bx = RAIN.x + RAIN.rx * Math.cos(t1); const bz = RAIN.rz * Math.sin(t1) - 0.01;
    const u0 = s; s += Math.hypot(bx - ax, bz - az) * 0.9; const u1 = s;
    quad([ax, yTop, az], [bx, yTop, bz], [bx + slant, yBot, bz], [ax + slant, yBot, az], u0, u1);
  }
  // The flat front of the shaft, on the cut.
  const M = 12;
  for (let i = 0; i < M; i++) {
    const ax = RAIN.x - RAIN.rx + (i / M) * 2 * RAIN.rx; const bx = RAIN.x - RAIN.rx + ((i + 1) / M) * 2 * RAIN.rx;
    quad([ax, yTop, -0.012], [bx, yTop, -0.012], [bx + slant, yBot, -0.012], [ax + slant, yBot, -0.012], (ax - RAIN.x) * 0.9, (bx - RAIN.x) * 0.9);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function rainTexture() {
  const rng = seededRandom(52);
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 460; i++) {
      const x = rng() * w; const a = 0.25 + rng() * 0.45;
      const y0 = rng() * h * 0.3; const y1 = y0 + h * (0.35 + rng() * 0.65);
      ctx.strokeStyle = `rgba(210,222,238,${a})`;
      ctx.lineWidth = 0.8 + rng() * 2.2;
      for (const ox of [-w, 0, w]) {
        ctx.beginPath(); ctx.moveTo(x + ox, y0); ctx.lineTo(x + ox + 8, y1); ctx.stroke();
      }
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function cloudBump() {
  const rng = seededRandom(77);
  const tex = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#6c6c6c';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const x = rng() * w; const y = rng() * h; const r = 8 + rng() * 30;
      const light = 140 + Math.floor(rng() * 100);
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          g.addColorStop(0, `rgba(${light},${light},${light},0.8)`);
          g.addColorStop(1, `rgba(${light},${light},${light},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, 0, TAU);
          ctx.fill();
        }
      }
    }
  });
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// What moves: hail, charge and lightning, in one rewritten buffer
// ---------------------------------------------------------------------------------------------

// Most hailstones grow on one pass up through the updraft; a few drop out and are caught again
// once. The paths are drawn that way, and a stone that goes round twice comes out bigger.
// NSSL: stones grow by collecting supercooled water as the updraft carries them, and they are not
// lofted to the top of the storm. So every path turns over inside the supercooled zone, below -40.
const HAIL_PATHS = [
  { count: 30, pts: [[xu(1.45) - 0.3, 1.45], [xu(1.85) - 0.08, 1.85], [xu(2.4), 2.4], [xu(3.5) + 0.02, 3.5], [xu(4.9) + 0.03, 4.9], [-0.78, 5.45], [0.0, 5.75], [0.85, 5.62], [1.45, 4.95], [1.72, 3.9], [1.82, 2.6], [1.85, 1.4], [1.88, GY + 0.07]] },
  { count: 8, pts: [[xu(1.45) - 0.3, 1.45], [xu(1.85) - 0.08, 1.85], [xu(2.4), 2.4], [xu(3.6) + 0.04, 3.6], [xu(4.4) + 0.02, 4.4], [-1.5, 4.62], [-1.68, 4.15], [-1.55, 3.62], [xu(3.35) - 0.05, 3.35], [xu(4.1) + 0.1, 4.1], [xu(5.0) + 0.1, 5.0], [-0.62, 5.55], [0.1, 5.82], [0.95, 5.66], [1.5, 4.9], [1.75, 3.7], [1.84, 2.3], [1.9, GY + 0.07]] },
];

for (const path of HAIL_PATHS) if (!(Math.max(...path.pts.map((q) => q[1])) < M40)) throw new Error('thunderstorm-cutaway: a hail path climbs out of the supercooled zone');

function hailTrack(pathPts) {
  const curve = new THREE.CatmullRomCurve3(pathPts.map(([x, y]) => new THREE.Vector3(x, y, 0)), false, 'centripetal');
  const NS = 500;
  const pts = []; const radius = []; const times = [];
  let time = 0; let grown = 0;
  let prev = curve.getPointAt(0);
  let peakPassed = false;
  for (let i = 0; i <= NS; i++) {
    const p = curve.getPointAt(i / NS);
    const ds = p.distanceTo(prev);
    const rising = p.y >= prev.y;
    if (!rising && p.x > 1.0) peakPassed = true;
    const inZone = p.y > FZ && p.y < M40;
    // Slow while it is held up in the growth zone, quick when it falls out.
    const v = rising ? (inZone ? 0.3 : 0.55) : (peakPassed ? 1.5 : 0.6);
    time += ds / v;
    if (inZone && !peakPassed) grown += ds * (rising ? 1 : 0.6);
    const melt = peakPassed ? 1 - 0.12 * sstep(FZ - p.y, 0, 1.4) : 1;
    pts.push(p.clone());
    radius.push(grown);
    times.push(time);
    radius[i] = { g: grown, melt };
    prev = p;
  }
  return { pts, radius, times, total: time };
}

function buildDynamic() {
  const rng = seededRandom(5150);
  const items = [];
  const posArr = []; const nrmArr = []; const colArr = []; const uvArr = [];
  const add = (geometry, color, u, kind, data) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = g.attributes.position; const n = g.attributes.normal;
    const start = posArr.length / 3;
    const src = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      src[i * 3] = p.getX(i); src[i * 3 + 1] = p.getY(i); src[i * 3 + 2] = p.getZ(i);
      posArr.push(p.getX(i), p.getY(i), p.getZ(i));
      nrmArr.push(n.getX(i), n.getY(i), n.getZ(i));
      colArr.push(color[0], color[1], color[2]);
      uvArr.push(u, 0.5);
    }
    items.push({ start, count: p.count, src, kind, ...data });
  };

  // Hail.
  const hailGeo = () => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    const n = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).normalize();
      n[i * 3] = v.x; n[i * 3 + 1] = v.y; n[i * 3 + 2] = v.z;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    return g;
  };
  const tracks = HAIL_PATHS.map((p) => hailTrack(p.pts));
  const gMax = Math.max(...tracks.map((t) => t.radius[t.radius.length - 1].g));
  HAIL_PATHS.forEach((path, pi) => {
    const track = tracks[pi];
    for (let i = 0; i < path.count; i++) {
      add(hailGeo(), [0.92, 0.95, 1.0], 0.125, 'hail', {
        track, offset: (i / path.count) * track.total + rng() * 0.6,
        dx: (rng() - 0.5) * 0.26, dz: (rng() - 0.5) * 0.12, size: 0.85 + rng() * 0.3, gMax,
      });
    }
  });

  // Charge signs. A plus is two crossed bars, a minus one.
  const glyph = (plus, flat) => {
    const list = [new THREE.BoxGeometry(0.24, 0.07, 0.06)];
    if (plus) list.push(new THREE.BoxGeometry(0.07, 0.24, 0.06));
    const g = mergeParts(list.map((geometry) => ({ geometry, color: 0xffffff })));
    if (flat) g.rotateX(-Math.PI / 2);
    return g;
  };
  const RED = [0.86, 0.09, 0.06]; const BLUE = [0.08, 0.26, 0.95];
  const inBox = (b) => [mix(b.x0, b.x1, rng()), mix(b.y0, b.y1, rng())];
  const mixed = () => inBox(CHARGE.mixed);
  for (let i = 0; i < 11; i++) add(glyph(true, false), RED, 0.375, 'charge', { from: mixed(), to: inBox(CHARGE.upper), ph: rng() * TAU });
  for (let i = 0; i < 4; i++) add(glyph(true, false), RED, 0.375, 'charge', { from: mixed(), to: inBox(CHARGE.anvil), ph: rng() * TAU });
  for (let i = 0; i < 13; i++) add(glyph(false, false), BLUE, 0.625, 'charge', { from: mixed(), to: inBox(CHARGE.main), ph: rng() * TAU });
  for (let i = 0; i < 3; i++) add(glyph(true, false), RED, 0.375, 'charge', { from: mixed(), to: [mix(CHARGE.lower.x0, CHARGE.lower.x1, (i + 0.5) / 3), mix(CHARGE.lower.y0, CHARGE.lower.y1, 0.3 + 0.4 * rng())], ph: rng() * TAU });
  for (let i = 0; i < 8; i++) {
    const x = mix(CHARGE.ground.x0, CHARGE.ground.x1, (i + rng() * 0.6) / 8);
    const z = mix(CHARGE.ground.z0, CHARGE.ground.z1, rng());
    add(glyph(true, true), RED, 0.375, 'groundCharge', { at: [x, groundH(x, z) + 0.06, z] });
  }

  // Lightning: a jagged channel with a few forks, as tubes and joint balls.
  const boltParts = (seed, legs, forks) => {
    const r2 = seededRandom(seed);
    const segs = [];
    const jag = (pts, sub, amp) => {
      const out = [pts[0]];
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, ay] = pts[k]; const [bx, by] = pts[k + 1];
        const len = Math.hypot(bx - ax, by - ay);
        const nx = -(by - ay) / len; const ny = (bx - ax) / len;
        for (let s = 1; s <= sub; s++) {
          const t = s / sub;
          const off = s === sub ? 0 : (r2() - 0.5) * 2 * amp;
          out.push([mix(ax, bx, t) + nx * off, mix(ay, by, t) + ny * off]);
        }
      }
      return out;
    };
    const main = jag(legs, 4, 0.11);
    for (let k = 0; k < main.length - 1; k++) segs.push([main[k], main[k + 1], 0.04]);
    for (const [at, angle, n] of forks) {
      const [ax, ay] = main[at]; const [bx, by] = main[at + 1];
      const base = Math.atan2(by - ay, bx - ax) + angle;
      let p = main[at];
      for (let s = 0; s < n; s++) {
        const a = base + (r2() - 0.5) * 0.9;
        const step = 0.14 + r2() * 0.1;
        const q = [p[0] + Math.cos(a) * step, p[1] + Math.sin(a) * step];
        segs.push([p, q, 0.022 * (1 - s / (n + 1)) + 0.008]);
        p = q;
      }
    }
    const geos = [];
    for (const [a, b, r] of segs) {
      const zA = Z_BOLT + (hash2(a[0] * 13, a[1] * 7) - 0.5) * 0.04;
      const zB = Z_BOLT + (hash2(b[0] * 13, b[1] * 7) - 0.5) * 0.04;
      geos.push(tube([[a[0], a[1], zA], [b[0], b[1], zB]], r, { sides: 6, steps: 1, round: 0, straight: true }));
      const ball = new THREE.IcosahedronGeometry(r * 1.12, 0);
      ball.translate(b[0], b[1], zB);
      geos.push(ball);
    }
    return mergeParts(geos.map((geometry) => ({ geometry, color: 0xffffff })));
  };
  // Cloud to ground: from the main negative charge down through the base to the charged ground.
  const cg = boltParts(31, [[-0.35, M10 + 0.45], [-0.15, 3.0], [0.05, BASE_Y + 0.1], [-0.05, 0.95], [0.12, GY + 0.0]], [[3, -0.6, 4], [7, 0.55, 5], [11, -0.5, 4], [15, 0.6, 3]]);
  // In the cloud: from the negative charge up into the positive top and out along the anvil.
  const ic = boltParts(47, [[-0.4, M10 + 0.55], [-0.55, 5.0], [-0.5, 5.9], [0.3, 6.45], [1.4, 6.85], [2.7, 7.05]], [[2, -0.8, 4], [9, 0.7, 4], [13, -0.6, 4], [17, 0.5, 4]]);
  const BOLT = [0.88, 0.86, 1.0];
  add(cg, BOLT, 0.875, 'bolt', { which: 0 });
  add(ic, BOLT, 0.875, 'bolt', { which: 1 });

  const P = new Float32Array(posArr);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrmArr, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.5, 4.6, 0.3), 7.5);

  const HIDE = [xc(5), 5, -1.2];
  const CYCLE = 6.5;
  const write = (time) => {
    const p = ((time / CYCLE + 0.008) % 1 + 1) % 1;
    const cycle = Math.floor(time / CYCLE + 0.008);
    // The flash, flickering: on, off, on.
    const lit = (p < 0.022) || (p > 0.034 && p < 0.07);
    // Charge separates over the cycle, and a stroke takes much of it away again.
    const sep = p < 0.07 ? 1 : 0.25 + 0.75 * sstep(p, 0.12, 0.88);
    for (const it of items) {
      const { start, count, src } = it;
      let cx = 0; let cy = 0; let cz = 0; let s = 1; let hide = false;
      if (it.kind === 'hail') {
        const tr = it.track;
        const tt = ((time + it.offset) % tr.total + tr.total) % tr.total;
        // Binary search the time table.
        let lo = 0; let hi = tr.times.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tr.times[mid] <= tt) lo = mid; else hi = mid; }
        const f = clamp01((tt - tr.times[lo]) / Math.max(1e-6, tr.times[hi] - tr.times[lo]));
        const a = tr.pts[lo]; const b = tr.pts[hi];
        cx = mix(a.x, b.x, f) + it.dx * sstep(a.y, BASE_Y - 0.4, BASE_Y + 0.4);
        cy = mix(a.y, b.y, f);
        cz = Z_HAIL + it.dz;
        const rr = tr.radius[lo];
        s = (0.03 + 0.1 * (rr.g / it.gMax)) * rr.melt * it.size;
        const u = tt / tr.total;
        s *= sstep(u, 0, 0.03) * (1 - sstep(u, 0.975, 1));
      } else if (it.kind === 'charge') {
        const w = Math.sin(time * 0.9 + it.ph);
        cx = mix(it.from[0], it.to[0], sep) + 0.05 * w;
        cy = mix(it.from[1], it.to[1], sep) + 0.04 * Math.cos(time * 1.1 + it.ph);
        cz = Z_CHARGE;
        s = 0.6 + 0.4 * sep;
      } else if (it.kind === 'groundCharge') {
        [cx, cy, cz] = it.at;
        s = 0.3 + 0.7 * sep;
      } else {
        hide = !(lit && (cycle % 2 === 0 ? it.which === 0 : it.which === 1));
      }
      const o = start * 3;
      if (it.kind === 'bolt') {
        for (let i = 0; i < count; i++) {
          if (hide) { P[o + i * 3] = HIDE[0]; P[o + i * 3 + 1] = HIDE[1]; P[o + i * 3 + 2] = HIDE[2]; } else {
            P[o + i * 3] = src[i * 3]; P[o + i * 3 + 1] = src[i * 3 + 1]; P[o + i * 3 + 2] = src[i * 3 + 2];
          }
        }
        continue;
      }
      if (hide || s < 1e-4) s = 1e-4;
      for (let i = 0; i < count; i++) {
        P[o + i * 3] = cx + src[i * 3] * s;
        P[o + i * 3 + 1] = cy + src[i * 3 + 1] * s;
        P[o + i * 3 + 2] = cz + src[i * 3 + 2] * s;
      }
    }
    return lit;
  };
  return { geometry: g, write };
}

function rampTexture() {
  const tex = canvasTexture(64, 4, (ctx) => {
    for (const [x, c] of [[0, '#000000'], [16, '#4a120e'], [32, '#0e2052'], [48, '#f2eeff']]) { ctx.fillStyle = c; ctx.fillRect(x, 0, 16, 4); }
  });
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

// ---------------------------------------------------------------------------------------------
function buildThunderstorm() {
  const root = new THREE.Group();
  root.name = 'thunderstorm-cutaway';

  const groundParts = buildGroundBlock();
  buildScenery(groundParts);
  const ground = mesh(mergeParts(groundParts), standard({ vertexColors: true, roughness: 0.92, metalness: 0 }));

  const { cloudGeo, cutGeo } = buildCloud();
  const cloudMat = standard({ vertexColors: true, bumpMap: cloudBump(), bumpScale: 0.6, roughness: 0.97, metalness: 0, emissive: 0x8a93a8, emissiveIntensity: 0.3 });
  const cloud = mesh(cloudGeo, cloudMat);
  const sectionMap = canvasTexture(1792, 1344, paintSection);
  const cutMat = standard({ map: sectionMap, roughness: 0.92, metalness: 0, emissive: 0xffffff, emissiveMap: sectionMap, emissiveIntensity: 0.26 });
  const cut = mesh(cutGeo, cutMat);
  cut.castShadow = false;

  const { geometry: labelGeo, layout } = buildLabels();
  const labelMap = canvasTexture(ATLAS_W, layout.H, paintAtlas(layout));
  const labels = mesh(labelGeo, standard({ vertexColors: true, map: labelMap, roughness: 0.6, metalness: 0, emissive: 0xffffff, emissiveMap: labelMap, emissiveIntensity: 0.12 }));
  labels.castShadow = false;

  const rain = mesh(buildRain(), standard({ map: rainTexture(), transparent: true, depthWrite: false, opacity: 0.85, side: THREE.DoubleSide, roughness: 1, metalness: 0, color: 0x9caabf }));
  rain.castShadow = false;
  rain.receiveShadow = false;

  const dyn = buildDynamic();
  const moving = mesh(dyn.geometry, standard({ vertexColors: true, emissive: 0xffffff, emissiveMap: rampTexture(), roughness: 0.45, metalness: 0 }));
  moving.castShadow = false;

  root.add(ground, cloud, cut, labels, rain, moving);

  // The still diagram: charge pulled apart and the stroke that follows, and no flashing.
  dyn.write(0);
  if (!reducedMotion()) {
    let t = 0;
    let wasLit = null;
    root.userData.tick = {
      update(dt) {
        t += dt;
        const lit = dyn.write(t);
        dyn.geometry.attributes.position.needsUpdate = true;
        if (lit !== wasLit) {
          cloudMat.emissiveIntensity = lit ? 0.62 : 0.3;
          cutMat.emissiveIntensity = lit ? 0.42 : 0.26;
          wasLit = lit;
        }
      },
      dispose() {},
    };
  }
  return root;
}

export const BUILDERS = {
  'thunderstorm-cutaway': () => buildThunderstorm(),
};
