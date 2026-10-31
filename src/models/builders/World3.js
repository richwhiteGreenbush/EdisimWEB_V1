// Builders for the Model Database's third set of world landmarks and arts: the Golden Gate Bridge,
// the Treasury at Petra, the Sydney Opera House, a potter's wheel and a drum kit.
//
// Three of these are carried by something that can be computed, so it is computed rather than
// drawn: the bridge's cable is the parabola its own span and sag give, Petra's strata are one
// function of world position painted across cliff and carving alike, and every shell of the Opera
// House is cut from a sphere of one radius, with the radius checked at every vertex by
// `operaShellReport` below.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mergeParts, smoothNoise3 } from '../../props/LoftKit.js';
import {
  seededRandom, canvasTexture, standard, mesh, group,
} from '../../PropKit.js';
import {
  lin, mix, clamp01, sstep, tintVertices, grainBump, tube, lathe, outward,
  Sculpt, polygonize, ellipsoidP, sphereP, curveP,
} from '../ModelKit.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const times = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// A monotone cubic through [x, y] stations, so a surveyed profile never overshoots between them.
function pchip(table) {
  const n = table.length;
  const xs = table.map((r) => r[0]);
  const ys = table.map((r) => r[1]);
  const d = [];
  for (let i = 0; i < n - 1; i += 1) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = [d[0]];
  for (let i = 1; i < n - 1; i += 1) m.push(d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]));
  m.push(d[n - 2]);
  return (x) => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    let i = 0;
    while (x > xs[i + 1]) i += 1;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t; const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

function fbm(x, y, z, octaves = 3) {
  let s = 0; let a = 0.5; let f = 1; let t = 0;
  for (let i = 0; i < octaves; i += 1) {
    s += smoothNoise3(x * f, y * f, z * f) * a;
    t += a; a *= 0.5; f *= 2.03;
  }
  return s / t;
}

function repeatFeet(texture, feet, feetV = feet) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / feet, 1 / feetV);
  return texture;
}

// A triangle soup with face normals (or normals handed in) and a colour per corner. Every polygon
// MEASURES its winding against an outward hint rather than assuming it.
class Soup {
  constructor() { this.p = []; this.n = []; this.t = []; this.c = []; }

  face(pts, col, hint = null, { uv = null, normals = null } = {}) {
    let P = pts;
    let C = col.length === 3 && typeof col[0] === 'number' ? null : col;
    const flat = C ? null : col;
    let UV = uv;
    let N = normals;
    let nrm = norm(cross(sub(P[1], P[0]), sub(P[P.length - 1], P[0])));
    if (Math.abs(nrm[0]) + Math.abs(nrm[1]) + Math.abs(nrm[2]) < 1e-9) return;
    if (hint && dot(nrm, hint) < 0) {
      P = [...P].reverse();
      if (C) C = [...C].reverse();
      if (UV) UV = [...UV].reverse();
      if (N) N = [...N].reverse();
      nrm = [-nrm[0], -nrm[1], -nrm[2]];
    }
    const ax = Math.abs(nrm[0]); const ay = Math.abs(nrm[1]); const az = Math.abs(nrm[2]);
    for (let i = 1; i < P.length - 1; i += 1) {
      for (const k of [0, i, i + 1]) {
        const q = P[k];
        this.p.push(q[0], q[1], q[2]);
        if (N) this.n.push(N[k][0], N[k][1], N[k][2]);
        else this.n.push(nrm[0], nrm[1], nrm[2]);
        if (UV) this.t.push(UV[k][0], UV[k][1]);
        else if (ay > 0.72) this.t.push(q[0], q[2]);
        else if (ax > az) this.t.push(q[2], q[1]);
        else this.t.push(q[0], q[1]);
        const c = C ? C[k] : flat;
        this.c.push(c[0], c[1], c[2]);
      }
    }
  }

  // An eight-cornered solid: bottom four then top four, going round.
  hexa(b, t, col, { skipBottom = false, topCol = null } = {}) {
    const c = [0, 0, 0];
    for (const q of [...b, ...t]) { c[0] += q[0] / 8; c[1] += q[1] / 8; c[2] += q[2] / 8; }
    for (let i = 0; i < 4; i += 1) {
      const j = (i + 1) % 4;
      const quad = [b[i], b[j], t[j], t[i]];
      const mid = scl(add(add(quad[0], quad[1]), add(quad[2], quad[3])), 0.25);
      this.face(quad, col, sub(mid, c));
    }
    this.face(t, topCol ?? col, [0, 1, 0]);
    if (!skipBottom) this.face(b, col, [0, -1, 0]);
  }

  box(x0, y0, z0, x1, y1, z1, col, opts) {
    this.hexa(
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
      [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
      col,
      opts,
    );
  }

  // A square-section member from a to b, open at both ends because both ends are buried in what
  // they join: eight triangles a member is what makes a real lattice affordable.
  bar(a, b, s, ref, col, s2 = s) {
    const dir = norm(sub(b, a));
    let side = cross(dir, ref);
    if (Math.hypot(side[0], side[1], side[2]) < 1e-5) side = cross(dir, [0.3, 0.2, 0.9]);
    side = norm(side);
    const up = norm(cross(side, dir));
    const corner = (p, w, h) => [p[0] + side[0] * w + up[0] * h, p[1] + side[1] * w + up[1] * h, p[2] + side[2] * w + up[2] * h];
    const signs = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    const norms = [up, [-side[0], -side[1], -side[2]], [-up[0], -up[1], -up[2]], side];
    for (let i = 0; i < 4; i += 1) {
      const j = (i + 1) % 4;
      const q0 = corner(a, signs[i][0] * s, signs[i][1] * s);
      const q1 = corner(a, signs[j][0] * s, signs[j][1] * s);
      const q2 = corner(b, signs[j][0] * s2, signs[j][1] * s2);
      const q3 = corner(b, signs[i][0] * s2, signs[i][1] * s2);
      const nn = norms[i];
      const list = dot(cross(sub(q1, q0), sub(q3, q0)), nn) > 0 ? [q0, q1, q2, q0, q2, q3] : [q0, q2, q1, q0, q3, q2];
      for (const q of list) {
        this.p.push(q[0], q[1], q[2]);
        this.n.push(nn[0], nn[1], nn[2]);
        this.t.push(0, 0);
        this.c.push(col[0], col[1], col[2]);
      }
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.t, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return g;
  }
}

// Harbour water, shared by the bridge and the Opera House: fine wind ripple as a near-white tile,
// multiplied by the blue a vertex tint gives it. Corners stay white for anything mapped to 0,0.
function rippleTile(seed) {
  const rng = seededRandom(seed);
  const t = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#d2d6da';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i += 1) {
      const x = rng() * w; const y = rng() * h; const len = 6 + rng() * 26;
      const light = rng() > 0.42;
      const v = light ? 245 + rng() * 10 : 150 + rng() * 34;
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.22 + rng() * 0.5})`;
      ctx.lineWidth = 0.7 + rng() * 1.5;
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          ctx.beginPath();
          ctx.moveTo(x + ox - len / 2, y + oy);
          ctx.quadraticCurveTo(x + ox, y + oy - 1.8 - rng() * 1.5, x + ox + len / 2, y + oy);
          ctx.stroke();
        }
      }
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Near-white grass and scrub, for any ground carried by its vertex colour.
function grassTile(seed) {
  const rng = seededRandom(seed);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4200; i += 1) {
      const x = rng() * w; const y = rng() * h;
      const v = 150 + rng() * 105;
      ctx.fillStyle = `rgba(${v},${v},${v * 0.92},${0.2 + rng() * 0.5})`;
      ctx.fillRect(x, y, 1 + rng() * 2.6, 1 + rng() * 2.6);
    }
  });
}

// ---------------------------------------------------------------------------
// The Golden Gate Bridge, 1/200
// ---------------------------------------------------------------------------

// Every length below is the real bridge's in FEET, turned into model feet by GG, so a figure can be
// checked against a reference: main span 4,200, side spans 1,125, tower 746 above the water, cable
// sag 476, Fort Point arch 320, San Francisco viaduct 1,450, Marin viaduct 738. They add to the
// 8,981ft the card's 1.7 miles rounds.
const GG = 1 / 200;
const GG_WATER = 0.2; // the water's surface above the plinth's underside
const GG_MAIN = 4200 * GG;
const GG_SIDE = 1125 * GG;
const GG_SOUTH_END = -22.45;
const GG_S2 = GG_SOUTH_END + 1450 * GG; // the south end of the Fort Point arch
const GG_S1 = GG_S2 + 320 * GG; // the north end of it, where the south side span lands
const GG_TS = GG_S1 + GG_SIDE; // south tower
const GG_TN = GG_TS + GG_MAIN; // north tower
const GG_N1 = GG_TN + GG_SIDE; // north side span's pylon
const GG_NORTH_END = GG_N1 + 738 * GG;
const GG_MID = (GG_TS + GG_TN) / 2;
// Above the water, in model feet. The real tower is 3.73; thickening the deck pushed the road up
// against the cable's low point, so the saddle went to 3.70 and the tower's top to 3.77.
const GG_SADDLE = 3.7;
const GG_SAG = 476 * GG;
const GG_TOP = 3.77;
const GG_PYLON_SADDLE = 1.46;
const GG_DECK_DEPTH = 0.17; // the truss: 25ft real is 0.125, thickened
const GG_DECK_HALF = 0.39; // 45ft real is 0.225: thickened to hold up from across a lawn
const GG_ROAD_HALF = 0.31;

const ggDeck = pchip([
  [GG_SOUTH_END, 1.0], [GG_S2, 1.05], [GG_S1, 1.08], [GG_TS, 1.2], [GG_MID, 1.24], [GG_TN, 1.2], [GG_N1, 1.09], [GG_NORTH_END, 1.02],
]);

// THE CABLE. Under a load spread evenly along the deck a cable hangs in a parabola, so the main span
// is y = low + sag(2s/L)^2 and nothing about it was chosen. The side spans carry the same load at
// the same horizontal pull, which fixes their sag at the main sag times (side/main)^2.
const ggCableMain = (x) => (GG_SADDLE - GG_SAG) + GG_SAG * ((x - GG_MID) / (GG_MAIN / 2)) ** 2;
const GG_SIDE_SAG = GG_SAG * (GG_SIDE / GG_MAIN) ** 2;
function ggCableSide(x, xTower, xPylon) {
  const t = (x - xTower) / (xPylon - xTower);
  return mix(GG_SADDLE, GG_PYLON_SADDLE, t) - 4 * GG_SIDE_SAG * t * (1 - t);
}
function ggCableY(x) {
  if (x <= GG_TS) return ggCableSide(x, GG_TS, GG_S1);
  if (x >= GG_TN) return ggCableSide(x, GG_TN, GG_N1);
  return ggCableMain(x);
}
// The cable sits over the tower leg at the top and over the truss at mid-span, which is a splay of
// 0.09ft in plan across 21ft. The real one is parallel: the deck is what is thickened here, and it
// needs the road to pass between the legs.
function ggCableZ(x) {
  const h = clamp01((ggCableY(x) - ggDeck(x)) / (GG_SADDLE - 1.2));
  return 0.4 + 0.085 * h;
}

function ggShoreSouth(z) { return -13.0 - 0.17 * z * z + (smoothNoise3(z * 0.9, 3.1, 1.7) - 0.5) * 0.9; }
function ggShoreNorth(z) { return 13.72 + 0.16 * z * z + (smoothNoise3(z * 0.8, 9.2, 4.4) - 0.5) * 0.8; }

// Height above the water. +Z is the bay side, -Z the ocean, +X north, as a viewer in the bay sees
// it: the high ground on both headlands is on the ocean side, Crissy Field and Fort Baker are low
// on the bay side.
function ggLand(x, z) {
  const lump = fbm(x * 0.55 + 30, z * 0.55, 1.3, 3) - 0.5;
  const fine = fbm(x * 2.1, z * 2.1, 7.7, 2) - 0.5;
  let h;
  if (x < 0) {
    const d = ggShoreSouth(z) - x;
    const land = sstep(d, -0.5, 0.42);
    const ocean = sstep(-z, -1.0, 1.6);
    const up = mix(0.1 + 0.42 * sstep(d, 3, 8.5), 0.15 + 1.25 * sstep(d, 0.05, 2.6) + 0.45 * sstep(d, 3, 8), ocean);
    h = -0.2 + land * (0.2 + up + lump * mix(0.25, 0.9, ocean) + fine * 0.14);
  } else {
    const d = x - ggShoreNorth(z);
    const land = sstep(d, -0.5, 0.3);
    const ocean = sstep(-z, -1.2, 1.2);
    const up = mix(0.16 + 0.8 * sstep(d, 0.8, 7.5), 0.3 + 2.1 * sstep(d, 0.0, 2.7) + 0.5 * sstep(d, 3, 8), ocean);
    h = -0.2 + land * (0.2 + up + lump * mix(0.4, 1.0, ocean) + fine * 0.16);
  }
  // The road's corridor: nothing may stand in front of the steel, and no hill can come through the deck.
  const cut = ggDeck(clamp(x, GG_SOUTH_END, GG_NORTH_END)) - GG_DECK_DEPTH - 0.1;
  const k = sstep(Math.abs(z), 0.85, 1.75);
  if (h > cut) h = mix(cut, h, k);
  return h;
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function goldenGateBridge() {
  const rng = seededRandom(1937);
  const steel = new Soup();
  const conc = new Soup();
  const orange = lin(0xc8421f);
  const orangeHi = lin(0xd94f26);
  const orangeLo = lin(0xa53418);
  const W = GG_WATER;
  const concrete = lin(0xc2bcae);
  const concreteLo = lin(0x97917f);

  const ground = (x, z) => W + ggLand(x, z);

  // --- the towers -------------------------------------------------------------------------------
  // Five tiers, each set back from the one below, which is the stepped Art Deco silhouette. The
  // legs' inner faces keep one line so the deck can pass between them. Portal struts above the road,
  // X-bracing below it: that change at deck level is the most recognisable thing about these towers.
  const TIERS = [
    { y0: 0.24, y1: 0.98, ax: 0.235, zo: 0.74 },
    { y0: 0.98, y1: 1.9, ax: 0.21, zo: 0.69 },
    { y0: 1.9, y1: 2.56, ax: 0.175, zo: 0.635 },
    { y0: 2.56, y1: 3.14, ax: 0.145, zo: 0.59 },
    { y0: 3.14, y1: GG_TOP, ax: 0.118, zo: 0.555 },
  ];
  const ZI = 0.41;
  const PORTALS = [
    { y0: 1.82, y1: 2.02 }, { y0: 2.48, y1: 2.66 }, { y0: 3.06, y1: 3.22 }, { y0: 3.58, y1: GG_TOP - 0.01 },
  ];

  function portal(xT, y0, y1, ax) {
    const a = ax * 0.72;
    const yy0 = W + y0; const yy1 = W + y1;
    steel.box(xT - a, yy0, -ZI - 0.02, xT + a, yy1, ZI + 0.02, orange);
    // Stepped corbels in every corner of the opening, and a shallower step above the strut.
    for (const s of [-1, 1]) {
      for (let k = 1; k <= 3; k += 1) {
        const inset = 0.062 * k;
        steel.box(xT - a * (1 - 0.1 * k), yy0 - 0.03 * (4 - k), s * ZI, xT + a * (1 - 0.1 * k), yy0, s * (ZI - inset), orangeLo);
        if (y1 < GG_TOP - 0.05) steel.box(xT - a * (1 - 0.1 * k), yy1, s * ZI, xT + a * (1 - 0.1 * k), yy1 + 0.018 * (4 - k), s * (ZI - inset), orangeLo);
      }
    }
    // Vertical fins across both faces of the strut.
    const ribs = 7;
    for (let r = 0; r < ribs; r += 1) {
      const z = mix(-ZI + 0.05, ZI - 0.05, r / (ribs - 1));
      for (const f of [-1, 1]) steel.box(xT + f * a, yy0 + 0.006, z - 0.017, xT + f * (a + 0.012), yy1 - 0.006, z + 0.017, orangeHi);
    }
  }

  function tower(xT) {
    for (const s of [-1, 1]) {
      for (let t = 0; t < TIERS.length; t += 1) {
        const T = TIERS[t];
        const yb = W + T.y0; const yt = W + T.y1;
        const prev = TIERS[t - 1];
        const zi = s * ZI;
        const zo = s * T.zo;
        const lift = prev ? 0.045 : 0;
        // The setback: a sloped shoulder from the tier below.
        if (prev) {
          steel.hexa(
            [[xT - prev.ax, yb, zi], [xT + prev.ax, yb, zi], [xT + prev.ax, yb, s * prev.zo], [xT - prev.ax, yb, s * prev.zo]],
            [[xT - T.ax, yb + lift, zi], [xT + T.ax, yb + lift, zi], [xT + T.ax, yb + lift, zo], [xT - T.ax, yb + lift, zo]],
            orangeHi,
            { skipBottom: true },
          );
        }
        steel.box(xT - T.ax, yb + lift, zi, xT + T.ax, yt, zo, orange, { skipBottom: true });
        // Fluting: the riveted cells of each shaft read as ribs running the height of the tier.
        const y0 = yb + lift + 0.012; const y1 = yt - 0.012;
        for (const f of [-1, 1]) {
          for (const k of [0.16, 0.5, 0.84]) {
            const z = mix(zi, zo, k);
            steel.box(xT + f * T.ax, y0, z - 0.016, xT + f * (T.ax + 0.01), y1, z + 0.016, orangeHi);
          }
        }
        for (const k of [-0.62, 0, 0.62]) {
          const x = xT + k * T.ax;
          steel.box(x - 0.02, y0, zo, x + 0.02, y1, zo + s * 0.01, orangeHi);
        }
      }
      // The crown: a stepped cap and the saddle housing the cable climbs into.
      const T = TIERS[4];
      const top = W + GG_TOP;
      steel.box(xT - T.ax * 0.86, top, s * (ZI + 0.005), xT + T.ax * 0.86, top + 0.022, s * (T.zo - 0.012), orangeHi);
      steel.box(xT - T.ax * 0.66, top + 0.022, s * (ZI + 0.02), xT + T.ax * 0.66, top + 0.04, s * (T.zo - 0.03), orange);
      const zs = s * ggCableZ(xT);
      steel.box(xT - T.ax * 0.8, W + GG_SADDLE - 0.05, zs - 0.05, xT + T.ax * 0.8, top + 0.002, zs + 0.05, orangeLo);
      // An aircraft beacon on each leg.
      conc.face([[xT - 0.012, top + 0.04, zs - 0.012], [xT + 0.012, top + 0.04, zs - 0.012], [xT, top + 0.075, zs]], [0.75, 0.04, 0.03], [0, 0.4, -1]);
      conc.face([[xT + 0.012, top + 0.04, zs - 0.012], [xT, top + 0.04, zs + 0.016], [xT, top + 0.075, zs]], [0.75, 0.04, 0.03], [1, 0.4, 0.4]);
      conc.face([[xT, top + 0.04, zs + 0.016], [xT - 0.012, top + 0.04, zs - 0.012], [xT, top + 0.075, zs]], [0.75, 0.04, 0.03], [-1, 0.4, 0.4]);
    }
    for (let p = 0; p < PORTALS.length; p += 1) portal(xT, PORTALS[p].y0, PORTALS[p].y1, TIERS[p + 1].ax);
    // Below the road: a strut, then two tiers of X-bracing on both faces of the tower.
    const dk = W + ggDeck(xT) - GG_DECK_DEPTH;
    const a0 = TIERS[0].ax * 0.72;
    steel.box(xT - a0, dk - 0.13, -ZI, xT + a0, dk - 0.02, ZI, orange);
    const levels = [W + 0.26, W + 0.6, dk - 0.13];
    for (let l = 0; l < 2; l += 1) {
      for (const f of [-1, 1]) {
        const x = xT + f * a0 * 0.8;
        steel.bar([x, levels[l], -ZI], [x, levels[l + 1], ZI], 0.022, [1, 0, 0], orangeLo);
        steel.bar([x, levels[l], ZI], [x, levels[l + 1], -ZI], 0.022, [1, 0, 0], orangeLo);
      }
      if (l === 0) steel.box(xT - a0, levels[1] - 0.03, -ZI, xT + a0, levels[1] + 0.03, ZI, orange);
    }
  }
  tower(GG_TS);
  tower(GG_TN);

  // The south pier stands out in the strait inside a concrete fender; the north one is on the shore.
  function pier(xT, fender) {
    conc.box(xT - 0.42, W - 0.1, -1.0, xT + 0.42, W + 0.16, 1.0, concrete);
    conc.box(xT - 0.34, W + 0.16, -0.88, xT + 0.34, W + 0.26, 0.88, concrete);
    if (!fender) return;
    const n = 64;
    const rx = 0.82; const rz = 1.5; const th = 0.09; const up = 0.15;
    const pt = (a, k, y) => [xT + Math.sin(a) * rx * k, y, Math.cos(a) * rz * k];
    const kIn = 1 - th / rx;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2; const b = ((i + 1) / n) * Math.PI * 2;
      const hint = [Math.sin((a + b) / 2), 0.001, Math.cos((a + b) / 2)];
      conc.face([pt(a, 1, W - 0.1), pt(b, 1, W - 0.1), pt(b, 1, W + up), pt(a, 1, W + up)], concreteLo, hint);
      conc.face([pt(a, kIn, W - 0.1), pt(b, kIn, W - 0.1), pt(b, kIn, W + up), pt(a, kIn, W + up)], concreteLo, scl(hint, -1));
      conc.face([pt(a, 1, W + up), pt(b, 1, W + up), pt(b, kIn, W + up), pt(a, kIn, W + up)], concrete, [0, 1, 0]);
      conc.face([pt(a, kIn, W + 0.02), pt(b, kIn, W + 0.02), [xT, W + 0.02, 0]], times(concreteLo, 0.8), [0, 1, 0]);
    }
  }
  pier(GG_TS, true);
  pier(GG_TN, false);

  // --- the deck, one panel every 50 real feet ----------------------------------------------------
  // A Warren truss down both sides, floor beams, and lateral X-bracing under the road. Fifty feet is
  // the real panel, and it is also the real hanger spacing, so the hangers can be counted against it.
  const PANEL = 50 * GG;
  const roadParts = new Soup();
  const truss = (x0, x1, half = GG_DECK_HALF, depth = GG_DECK_DEPTH) => {
    const n = Math.max(1, Math.round((x1 - x0) / PANEL));
    for (let i = 0; i < n; i += 1) {
      const a = mix(x0, x1, i / n); const b = mix(x0, x1, (i + 1) / n);
      const m = (a + b) / 2;
      const ya = W + ggDeck(a); const yb = W + ggDeck(b); const ym = W + ggDeck(m);
      for (const s of [-1, 1]) {
        const z = s * half;
        const ref = [0, 0, 1];
        steel.bar([a, ya - 0.016, z], [b, yb - 0.016, z], 0.017, ref, orange);
        steel.bar([a, ya - depth, z], [b, yb - depth, z], 0.015, ref, orange);
        steel.bar([a, ya - depth, z], [m, ym - 0.016, z], 0.0085, ref, orangeLo);
        steel.bar([m, ym - 0.016, z], [b, yb - depth, z], 0.0085, ref, orangeLo);
        if (i % 2 === 0) steel.bar([a, ya - 0.016, z], [a, ya - depth, z], 0.0075, ref, orangeLo);
      }
      steel.bar([a, ya - depth, -half], [a, ya - depth, half], 0.009, [1, 0, 0], orangeLo);
      if (i % 2 === 0) {
        steel.bar([a, ya - depth, -half], [b, yb - depth, half], 0.006, [0, 1, 0], orangeLo);
        steel.bar([a, ya - depth, half], [b, yb - depth, -half], 0.006, [0, 1, 0], orangeLo);
      }
    }
    for (const s of [-1, 1]) {
      const yb = W + ggDeck(x1);
      steel.bar([x1, yb - 0.016, s * half], [x1, yb - depth, s * half], 0.0075, [0, 0, 1], orangeLo);
    }
  };
  truss(GG_TS, GG_TN);
  truss(GG_S1, GG_TS);
  truss(GG_TN, GG_N1);

  // The road and its sidewalks, in one strip from end to end. Each panel keeps its height, so the
  // road crowns over the middle of the span.
  const stations = [];
  for (let x = GG_SOUTH_END; x < GG_NORTH_END - 1e-3; x += 0.5) stations.push(x);
  stations.push(GG_NORTH_END);
  const walk = lin(0xa8a498);
  for (let i = 0; i < stations.length - 1; i += 1) {
    const a = stations[i]; const b = stations[i + 1];
    const ya = W + ggDeck(a); const yb = W + ggDeck(b);
    const u0 = a * 2; const u1 = b * 2;
    roadParts.face(
      [[a, ya, -GG_ROAD_HALF], [b, yb, -GG_ROAD_HALF], [b, yb, GG_ROAD_HALF], [a, ya, GG_ROAD_HALF]],
      [1, 1, 1],
      [0, 1, 0],
      { uv: [[u0, 0], [u1, 0], [u1, 1], [u0, 1]] },
    );
    // The underside and the fascia, so the deck is a solid slab under its road.
    conc.hexa(
      [[a, ya - 0.05, -GG_DECK_HALF], [b, yb - 0.05, -GG_DECK_HALF], [b, yb - 0.05, GG_DECK_HALF], [a, ya - 0.05, GG_DECK_HALF]],
      [[a, ya - 0.003, -GG_DECK_HALF], [b, yb - 0.003, -GG_DECK_HALF], [b, yb - 0.003, GG_DECK_HALF], [a, ya - 0.003, GG_DECK_HALF]],
      times(concreteLo, 0.75),
    );
    for (const s of [-1, 1]) {
      const z0 = s * GG_ROAD_HALF; const z1 = s * (GG_DECK_HALF - 0.004);
      conc.hexa(
        [[a, ya - 0.004, z0], [b, yb - 0.004, z0], [b, yb - 0.004, z1], [a, ya - 0.004, z1]],
        [[a, ya + 0.012, z0], [b, yb + 0.012, z0], [b, yb + 0.012, z1], [a, ya + 0.012, z1]],
        walk,
        { skipBottom: true },
      );
      // The railing along the outside of the walk, and the fence on the kerb.
      steel.bar([a, ya + 0.046, s * GG_DECK_HALF], [b, yb + 0.046, s * GG_DECK_HALF], 0.0055, [0, 0, 1], orangeHi);
      steel.bar([a, ya + 0.012, s * GG_DECK_HALF], [b, yb + 0.012, s * GG_DECK_HALF], 0.0065, [0, 0, 1], orange);
    }
  }
  // Rail posts and lamp standards.
  for (let x = GG_SOUTH_END; x < GG_NORTH_END; x += PANEL * 2) {
    const y = W + ggDeck(x);
    for (const s of [-1, 1]) steel.bar([x, y, s * GG_DECK_HALF], [x, y + 0.05, s * GG_DECK_HALF], 0.004, [0, 0, 1], orange);
  }
  for (let x = GG_S1 + 0.55; x < GG_N1; x += 2.3) {
    const y = W + ggDeck(x);
    for (const s of [-1, 1]) {
      const z = s * (GG_ROAD_HALF + 0.015);
      steel.bar([x, y, z], [x, y + 0.16, z], 0.0045, [1, 0, 0], orange);
      steel.bar([x, y + 0.16, z], [x, y + 0.16, z - s * 0.045], 0.0045, [1, 0, 0], orange);
    }
  }

  // --- the main cables, the hangers --------------------------------------------------------------
  const cablePath = (x0, x1, n) => {
    const P = [];
    for (let i = 0; i <= n; i += 1) { const x = mix(x0, x1, i / n); P.push([x, W + ggCableY(x), ggCableZ(x)]); }
    return P;
  };
  const cableParts = [];
  const cableR = 0.032; // 3ft real is 0.0075 at this scale: over four times the true thickness, so it reads.
  for (const s of [-1, 1]) {
    const mir = (P) => P.map((p) => [p[0], p[1], s * p[2]]);
    cableParts.push({ geometry: tube(mir(cablePath(GG_TS, GG_TN, 70)), cableR, { sides: 8, steps: 100, round: 1 }), color: 0xc8421f });
    cableParts.push({ geometry: tube(mir(cablePath(GG_S1 - 0.04, GG_TS, 18)), cableR, { sides: 8, steps: 24, round: 1 }), color: 0xc8421f });
    cableParts.push({ geometry: tube(mir(cablePath(GG_TN, GG_N1 + 0.04, 18)), cableR, { sides: 8, steps: 24, round: 1 }), color: 0xc8421f });
  }
  // Real hanger spacing is 50ft, one every 0.25ft here: 83 per side in the main span. Each is pulled
  // in by the splay to land on the truss's top chord.
  const hanger = (x) => {
    const yc = W + ggCableY(x); const yd = W + ggDeck(x);
    const zc = ggCableZ(x);
    for (const s of [-1, 1]) steel.bar([x, yc - cableR * 0.5, s * zc], [x, yd - 0.01, s * GG_DECK_HALF], 0.0072, [0, 0, 1], orangeHi);
  };
  let hangers = 0;
  const countMain = Math.round(GG_MAIN / PANEL);
  for (let i = 1; i < countMain; i += 1) { hanger(mix(GG_TS, GG_TN, i / countMain)); hangers += 2; }
  const countSide = Math.round(GG_SIDE / PANEL);
  for (let i = 1; i < countSide; i += 1) {
    hanger(mix(GG_S1, GG_TS, i / countSide));
    hanger(mix(GG_TN, GG_N1, i / countSide));
    hangers += 4;
  }

  // --- pylons, anchorages, the Fort Point arch, the viaducts --------------------------------------
  // Art Deco concrete: stepped shafts, grooved, with the road passing between each pair.
  function pylon(x, topY) {
    for (const s of [-1, 1]) {
      const z0 = s * 0.415;
      const base = Math.max(W - 0.05, Math.min(ground(x, s * 0.5), ground(x, s * 0.9)) - 0.15);
      const steps = [[base, 0.36, 0.86], [W + ggDeck(x) - 0.25, 0.3, 0.78], [W + ggDeck(x) + 0.12, 0.24, 0.72], [topY - 0.14, 0.18, 0.66]];
      for (let i = 0; i < steps.length; i += 1) {
        const [y0, a, zo] = steps[i];
        const y1 = i < steps.length - 1 ? steps[i + 1][0] : topY;
        conc.box(x - a, y0, z0, x + a, y1, s * zo, concrete);
        for (const f of [-1, 1]) {
          for (const k of [0.25, 0.75]) {
            const z = mix(z0, s * zo, k);
            conc.box(x + f * a, y0 + 0.02, z - 0.012, x + f * (a + 0.008), y1 - 0.01, z + 0.012, concreteLo);
          }
        }
      }
      conc.box(x - 0.14, topY, z0 - s * 0.01, x + 0.14, topY + 0.03, s * 0.6, concreteLo);
    }
  }
  pylon(GG_S1, W + GG_PYLON_SADDLE + 0.02);
  pylon(GG_S2, W + GG_PYLON_SADDLE - 0.08);
  pylon(GG_N1, W + GG_PYLON_SADDLE + 0.02);

  // The arch over the old fort: two ribs, each a two-chord truss, with posts up to the deck.
  const archY0 = W + 0.42;
  const archTop = W + ggDeck((GG_S1 + GG_S2) / 2) - GG_DECK_DEPTH - 0.02;
  const archAt = (t) => [mix(GG_S2, GG_S1, t), archY0 + (archTop - archY0) * (1 - (2 * t - 1) ** 2)];
  for (const s of [-1, 1]) {
    const z = s * 0.3;
    const n = 12;
    for (let i = 0; i < n; i += 1) {
      const [xa, ya] = archAt(i / n); const [xb, yb] = archAt((i + 1) / n);
      const k = 0.09;
      steel.bar([xa, ya, z], [xb, yb, z], 0.016, [0, 0, 1], orange);
      steel.bar([xa, ya - k, z], [xb, yb - k, z], 0.016, [0, 0, 1], orange);
      steel.bar([xa, ya, z], [xb, yb - k, z], 0.007, [0, 0, 1], orangeLo);
      steel.bar([xa, ya - k, z], [xa, ya, z], 0.007, [0, 0, 1], orangeLo);
      steel.bar([xa, ya, z], [xa, W + ggDeck(xa) - 0.02, z], 0.008, [0, 0, 1], orange);
      steel.bar([xa, ya, -0.3], [xa, ya, 0.3], 0.006, [1, 0, 0], orangeLo);
    }
  }
  truss(GG_S2, GG_S1, 0.34, 0.08);

  // The anchorages: stepped concrete blocks the cables run down into, which is where the pull goes.
  function anchorage(x, dir) {
    const dy = W + ggDeck(x);
    const blocks = [
      { a: 0.56, y0: W - 0.05, y1: dy - 0.2, z0: 0.98 },
      { a: 0.45, y0: dy - 0.2, y1: dy - 0.05, z0: 0.88 },
      { a: 0.3, y0: dy - 0.05, y1: dy + 0.12, z0: 0.74 },
    ];
    for (const s of [-1, 1]) {
      for (const b of blocks) {
        const zi = s * (GG_DECK_HALF + 0.015);
        conc.box(x - b.a, b.y0, zi, x + b.a, b.y1, s * b.z0, concrete);
        for (let r = -2; r <= 2; r += 1) {
          conc.box(x + (r / 2) * b.a * 0.8 - 0.012, b.y0 + 0.02, s * b.z0, x + (r / 2) * b.a * 0.8 + 0.012, b.y1 - 0.01, s * (b.z0 + 0.008), concreteLo);
        }
      }
    }
    // Under the road the two blocks are one.
    conc.box(x - 0.56, W - 0.05, -GG_DECK_HALF - 0.02, x + 0.56, dy - GG_DECK_DEPTH - 0.02, GG_DECK_HALF + 0.02, concrete);
    // Cable from the last pylon down into the block.
    const xP = dir < 0 ? GG_S1 : GG_N1;
    for (const s of [-1, 1]) {
      const zP = s * ggCableZ(xP);
      cableParts.push({
        geometry: tube([[xP, W + GG_PYLON_SADDLE, zP], [x - dir * 0.1, dy + 0.06, s * 0.56]], cableR * 0.95, { sides: 8, steps: 6, round: 1, straight: true }),
        color: 0xc8421f,
      });
    }
  }
  anchorage(GG_S2 - 0.62, -1);
  anchorage(GG_N1 + 1.1, 1);

  // Steel towers carrying the viaducts over the Presidio and into Marin.
  function bent(x) {
    const yd = W + ggDeck(x);
    const top = yd - 0.15;
    for (const s of [-1, 1]) {
      const y0 = Math.min(ground(x, s * 0.3), top - 0.02) - 0.08;
      steel.bar([x - 0.06, y0, s * 0.36], [x - 0.04, top, s * 0.3], 0.018, [0, 0, 1], orange);
      steel.bar([x + 0.06, y0, s * 0.36], [x + 0.04, top, s * 0.3], 0.018, [0, 0, 1], orange);
      steel.bar([x - 0.06, y0 + (top - y0) * 0.5, s * 0.33], [x + 0.06, top, s * 0.3], 0.006, [0, 0, 1], orangeLo);
    }
    steel.box(x - 0.05, top - 0.015, -0.34, x + 0.05, top + 0.02, 0.34, orange);
    const yGround = Math.max(ground(x, 0), W);
    const n = Math.max(1, Math.round((top - yGround) / 0.2));
    for (let k = 0; k < n; k += 1) {
      const y0 = mix(yGround, top, k / n); const y1 = mix(yGround, top, (k + 1) / n);
      steel.bar([x, y0, -0.32], [x, y1, 0.32], 0.0065, [1, 0, 0], orangeLo);
      steel.bar([x, y0, 0.32], [x, y1, -0.32], 0.0065, [1, 0, 0], orangeLo);
    }
  }
  truss(GG_SOUTH_END, GG_S2 - 1.15, 0.34, 0.14);
  for (let x = GG_SOUTH_END + 0.45; x < GG_S2 - 1.25; x += 1.0) bent(x);
  truss(GG_N1 + 1.65, GG_NORTH_END, 0.34, 0.14);
  bent(GG_N1 + 2.3);
  bent(GG_N1 + 3.1);

  // Fort Point: the brick fort the arch was built to save, on the very tip of the south shore.
  {
    const brick = lin(0x9b5135);
    const brickHi = lin(0xb4664a);
    const x = (GG_S1 + GG_S2) / 2 + 0.05;
    const y0 = W + 0.02;
    conc.box(x - 0.62, y0, -0.46, x + 0.62, y0 + 0.31, 0.46, brick);
    conc.box(x - 0.66, y0 + 0.31, -0.5, x + 0.66, y0 + 0.335, 0.5, brickHi);
    // Tiers of gun ports: dark panels a hair proud, the only way a hole is made here.
    for (const tier of [0.06, 0.15, 0.24]) {
      for (let i = 0; i < 9; i += 1) {
        const px = x - 0.54 + i * 0.135;
        for (const s of [-1, 1]) conc.face([[px - 0.022, y0 + tier, s * 0.462], [px + 0.022, y0 + tier, s * 0.462], [px + 0.022, y0 + tier + 0.05, s * 0.462], [px - 0.022, y0 + tier + 0.05, s * 0.462]], [0.03, 0.02, 0.018], [0, 0, s]);
      }
    }
  }

  // --- the headlands ----------------------------------------------------------------------------
  const BASE_Z = 3.2;
  const X0 = -22.62; const X1 = 22.62;
  const BASE_TOP = 0.1;
  const land = new Soup();
  const grassLo = lin(0x3f7c33);
  const grassHi = lin(0x68a243);
  const gold = lin(0xa8a04c);
  const rock = lin(0x806b52);
  const sand = lin(0xbba886);
  const scrub = lin(0x2f6130);
  const landColor = (x, z, h, slope) => {
    const patch = fbm(x * 0.8 + 5, z * 0.8, 3.3, 3);
    const c = mix3(grassLo, grassHi, sstep(patch, 0.36, 0.66));
    // Scrub in dark drifts, dry grass on the tops, and rock only on the real cliffs by the water.
    mixInto3(c, scrub, sstep(fbm(x * 2.3, z * 2.3, 6.2, 2), 0.5, 0.62) * 0.75);
    mixInto3(c, gold, sstep(fbm(x * 0.45, z * 0.45, 9.1, 2), 0.54, 0.72) * sstep(h, 0.3, 1) * 0.5);
    mixInto3(c, rock, sstep(slope, 1.0, 1.7) * (1 - sstep(h, 0.3, 0.8)));
    mixInto3(c, sand, 1 - sstep(h, 0.012, 0.06));
    return c;
  };
  const CELL = 0.17;
  function landPatch(xa, xb) {
    const nx = Math.round((xb - xa) / CELL);
    const nz = Math.round((2 * BASE_Z) / CELL);
    const pos = []; const col = []; const uv = []; const idx = [];
    const hAt = (x, z) => Math.max(ggLand(x, z), BASE_TOP - W);
    for (let j = 0; j <= nz; j += 1) {
      const z = mix(-BASE_Z, BASE_Z, j / nz);
      for (let i = 0; i <= nx; i += 1) {
        const x = mix(xa, xb, i / nx);
        const h = hAt(x, z);
        const slope = Math.hypot(hAt(x + 0.06, z) - hAt(x - 0.06, z), hAt(x, z + 0.06) - hAt(x, z - 0.06)) / 0.12;
        pos.push(x, W + h, z);
        const c = landColor(x, z, h, slope);
        col.push(c[0], c[1], c[2]);
        uv.push(x * 1.6, z * 1.6);
      }
    }
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const a = j * (nx + 1) + i; const b = a + 1; const c = a + nx + 1; const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Skirts down the sides of the block, in bare rock.
    const skirt = new Soup();
    const bandAt = (p0, p1, hint) => {
      skirt.face([[p0[0], BASE_TOP, p0[2]], [p1[0], BASE_TOP, p1[2]], p1, p0], times(rock, 0.8), hint);
    };
    const P = (x, z) => [x, W + hAt(x, z), z];
    for (let i = 0; i < nx; i += 1) {
      const a = mix(xa, xb, i / nx); const b = mix(xa, xb, (i + 1) / nx);
      for (const s of [-1, 1]) if (Math.max(ggLand(a, s * BASE_Z), ggLand(b, s * BASE_Z)) > 0) bandAt(P(a, s * BASE_Z), P(b, s * BASE_Z), [0, 0, s]);
    }
    const outerX = xa < 0 ? xa : xb;
    for (let j = 0; j < nz; j += 1) {
      const a = mix(-BASE_Z, BASE_Z, j / nz); const b = mix(-BASE_Z, BASE_Z, (j + 1) / nz);
      bandAt(P(outerX, a), P(outerX, b), [Math.sign(outerX), 0, 0]);
    }
    return [{ geometry: g, keepColor: true }, { geometry: skirt.geometry(), keepColor: true }];
  }
  const landParts = [...landPatch(X0, -11.4), ...landPatch(12.6, X1)];

  // Trees: a dark windbreak of cypress and eucalyptus on the Presidio, scrub on the Marin side.
  const treeParts = [];
  const treeDark = lin(0x25572a);
  const treeMid = lin(0x356d31);
  for (let i = 0; i < 1400 && treeParts.length < 300; i += 1) {
    const south = rng() > 0.42;
    const x = south ? mix(X0 + 0.2, -13.6, rng()) : mix(15, X1 - 0.2, rng());
    const z = mix(-BASE_Z + 0.15, BASE_Z - 0.15, rng());
    if (Math.abs(z) < 1.3) continue;
    const h = ggLand(x, z);
    if (h < 0.2) continue;
    if (fbm(x * 0.7, z * 0.7, 14.2, 2) < (south ? 0.47 : 0.56)) continue;
    const r = 0.055 + rng() * 0.06;
    // Twenty faces with radial normals: at this scale a tree is about 0.3ft tall, and a wood of
    // small dark crowns reads as a wood where a few big smooth ones read as lollipops.
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const P = ico.attributes.position;
    const N = ico.attributes.normal;
    for (let k = 0; k < P.count; k += 1) N.setXYZ(k, P.getX(k), P.getY(k), P.getZ(k));
    ico.scale(r, r * (1.2 + rng() * 1.3), r);
    ico.translate(x, W + h + r * 0.9, z);
    const c = mix3(treeDark, treeMid, rng());
    treeParts.push({ geometry: ico, tint: () => c, keepColor: true });
  }

  // --- the strait -------------------------------------------------------------------------------
  const nx = 90; const nz = 12;
  const wPos = []; const wCol = []; const wUv = []; const wIdx = [];
  const deep = lin(0x1c6aa8);
  const mid = lin(0x2a86bd);
  const shallow = lin(0x5db6c4);
  for (let j = 0; j <= nz; j += 1) {
    const z = mix(-BASE_Z, BASE_Z, j / nz);
    for (let i = 0; i <= nx; i += 1) {
      const x = mix(X0, X1, i / nx);
      wPos.push(x, W, z);
      const near = Math.max(0, 1 - sstep(-ggLand(x, z), 0.02, 0.17));
      const c = mix3(deep, mid, fbm(x * 0.35, z * 0.8, 21.5, 3));
      mixInto3(c, shallow, near * 0.9);
      wCol.push(c[0], c[1], c[2]);
      wUv.push(x / 2.6, z / 2.6);
    }
  }
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const a = j * (nx + 1) + i; const b = a + 1; const c = a + nx + 1; const d = c + 1;
      wIdx.push(a, c, b, b, c, d);
    }
  }
  const water = new THREE.BufferGeometry();
  water.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
  water.setAttribute('color', new THREE.Float32BufferAttribute(wCol, 3));
  water.setAttribute('uv', new THREE.Float32BufferAttribute(wUv, 2));
  const up = new Float32Array(wPos.length);
  for (let i = 1; i < up.length; i += 3) up[i] = 1;
  water.setAttribute('normal', new THREE.BufferAttribute(up, 3));
  water.setIndex(wIdx);

  // The plinth and the cut edge of the water.
  const plinth = lin(0x2e3338);
  conc.box(X0 - 0.04, 0, -BASE_Z - 0.04, X1 + 0.04, BASE_TOP, BASE_Z + 0.04, plinth);
  const waterEdge = lin(0x124a78);
  // The cut edge of the water, only where it is water: on the same plane as the land's skirt it
  // z-fights wherever the two overlap.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 120; i += 1) {
      const a = mix(X0, X1, i / 120); const b = mix(X0, X1, (i + 1) / 120);
      if (Math.max(ggLand(a, s * BASE_Z), ggLand(b, s * BASE_Z)) > 0) continue;
      conc.face([[a, BASE_TOP, s * BASE_Z], [b, BASE_TOP, s * BASE_Z], [b, W - 0.002, s * BASE_Z], [a, W - 0.002, s * BASE_Z]], waterEdge, [0, 0, s]);
    }
  }

  // --- traffic and shipping, for scale ------------------------------------------------------------
  const lanes = [-0.26, -0.155, -0.052, 0.052, 0.155, 0.26];
  const carColours = [0xdedede, 0x20262e, 0xb32c24, 0x2c5ea8, 0xd8c35a, 0x6e7680, 0xf2f2ee];
  for (let i = 0; i < 58; i += 1) {
    const x = mix(GG_SOUTH_END + 0.5, GG_NORTH_END - 0.5, rng());
    const z = lanes[Math.floor(rng() * lanes.length)];
    const y = W + ggDeck(x);
    const long = 0.05; const wide = 0.021;
    const c = lin(carColours[Math.floor(rng() * carColours.length)]);
    conc.box(x - long, y + 0.002, z - wide, x + long, y + 0.02, z + wide, c);
    conc.box(x - long * 0.6, y + 0.02, z - wide * 0.82, x + long * 0.45, y + 0.034, z + wide * 0.82, mix3(c, [0.03, 0.04, 0.05], 0.55));
  }
  function freighter(x, z, dir) {
    const L = 0.85; const B = 0.13;
    const hull = lin(0x2b2f36); const red = lin(0x8c2f28); const white = lin(0xe5e3dc);
    const y = W;
    // A hull in section: wide at the deck, narrowing to the stem.
    const station = (t, k) => [x + dir * mix(-L, L, t), y + 0.1, z + k * B * (t > 0.75 ? 1 - ((t - 0.75) / 0.25) ** 1.5 * 0.98 : 1)];
    for (let i = 0; i < 12; i += 1) {
      const t0 = i / 12; const t1 = (i + 1) / 12;
      for (const k of [-1, 1]) {
        const a = station(t0, k); const b = station(t1, k);
        conc.face([[a[0], y - 0.01, a[2]], [b[0], y - 0.01, b[2]], b, a], [[...red], [...red], [...hull], [...hull]], [0, 0, k]);
      }
      conc.face([station(t0, -1), station(t1, -1), station(t1, 1), station(t0, 1)], lin(0x7c7468), [0, 1, 0]);
    }
    conc.face([[x - dir * L, y - 0.01, z - B], [x - dir * L, y - 0.01, z + B], [x - dir * L, y + 0.1, z + B], [x - dir * L, y + 0.1, z - B]], hull, [-dir, 0, 0]);
    // Bridge house aft, one funnel, and containers forward.
    conc.box(x - dir * L * 0.92, y + 0.1, z - B * 0.8, x - dir * L * 0.55, y + 0.26, z + B * 0.8, white);
    conc.box(x - dir * L * 0.82, y + 0.26, z - B * 0.45, x - dir * L * 0.66, y + 0.34, z + B * 0.45, lin(0xa02e24));
    const boxes = [0xb6402c, 0x2f6aa5, 0x3d7f53, 0xd8a32c];
    for (let i = 0; i < 6; i += 1) {
      const c = lin(boxes[Math.floor(rng() * boxes.length)]);
      const px = x + dir * mix(-L * 0.42, L * 0.58, i / 5);
      conc.box(px - 0.075, y + 0.1, z - B * 0.82, px + 0.075, y + 0.16 + 0.05 * (i % 2), z + B * 0.82, c);
    }
  }
  freighter(-1.6, 1.5, 1);
  // Foam off the bow and along the hull, a hair above the water.
  const foam = [0.92, 0.95, 0.96];
  conc.face([[-1.6 + 0.8, W + 0.004, 1.5 - 0.17], [-1.6 + 0.95, W + 0.004, 1.5], [-1.6 + 0.8, W + 0.004, 1.5 + 0.17], [-1.6 - 1.7, W + 0.004, 1.5 + 0.06], [-1.6 - 1.7, W + 0.004, 1.5 - 0.06]], foam, [0, 1, 0]);
  function sailboat(x, z, flip) {
    const y = W;
    const hull = [0.82, 0.82, 0.8];
    conc.hexa([[x - 0.1, y, z - 0.02], [x + 0.11, y, z], [x - 0.1, y, z + 0.02], [x - 0.1, y, z]], [[x - 0.12, y + 0.03, z - 0.03], [x + 0.14, y + 0.03, z], [x - 0.12, y + 0.03, z + 0.03], [x - 0.12, y + 0.03, z]], hull);
    const sail = [0.9, 0.9, 0.86];
    conc.face([[x - 0.02, y + 0.05, z + 0.003], [x + 0.13 * flip, y + 0.05, z + 0.03], [x - 0.02, y + 0.42, z + 0.003]], sail, [0, 0, 1]);
    conc.face([[x - 0.02, y + 0.05, z - 0.003], [x + 0.13 * flip, y + 0.05, z + 0.024], [x - 0.02, y + 0.42, z - 0.003]], sail, [0, 0, -1]);
    conc.face([[x - 0.02, y + 0.05, z], [x - 0.17, y + 0.05, z - 0.02], [x - 0.02, y + 0.33, z]], sail, [0, 0, 1]);
    conc.face([[x - 0.02, y + 0.05, z - 0.004], [x - 0.17, y + 0.05, z - 0.024], [x - 0.02, y + 0.33, z - 0.004]], sail, [0, 0, -1]);
  }
  sailboat(4.6, 1.95, 1);
  sailboat(7.9, -1.4, -1);
  sailboat(-5.2, -2.3, 1);

  // --- materials --------------------------------------------------------------------------------
  // Riveted plate: the tower's cells, near white so International Orange stays the vertex colour's.
  const plate = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f4f2f0';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(70,30,20,0.36)';
    ctx.fillRect(0, 0, 3, h);
    ctx.fillRect(w / 2, 0, 3, h);
    ctx.fillRect(0, 0, w, 3);
    ctx.fillRect(0, h / 2, w, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 4; i < w; i += 16) {
      for (const k of [10, h / 2 + 10]) { ctx.fillRect(i, k, 3, 3); ctx.fillRect(k, i, 3, 3); }
    }
  });
  repeatFeet(plate, 0.26);
  const steelMesh = mesh(
    mergeParts([{ geometry: steel.geometry(), keepColor: true }, ...cableParts]),
    standard({ vertexColors: true, map: plate, roughness: 0.56, metalness: 0.08 }),
  );

  const asphalt = canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#2e3033';
    ctx.fillRect(0, 0, w, h);
    const r2 = seededRandom(46);
    for (let i = 0; i < 2600; i += 1) {
      const v = 30 + r2() * 46;
      ctx.fillStyle = `rgba(${v},${v},${v + 3},0.5)`;
      ctx.fillRect(r2() * w, r2() * h, 1.6, 1.6);
    }
    // Six lanes, so five dashed lines. Two dashes to a tile, each lane 0.1ft wide.
    ctx.fillStyle = '#e9e7df';
    for (let k = 1; k < 6; k += 1) {
      const y = (k / 6) * h;
      for (const x of [0, w / 2]) ctx.fillRect(x + 28, y - 1.6, 130, 3.2);
    }
    ctx.fillStyle = '#f0ece0';
    ctx.fillRect(0, 1, w, 3);
    ctx.fillRect(0, h - 4, w, 3);
  });
  asphalt.wrapS = THREE.RepeatWrapping;
  const roadMesh = mesh(roadParts.geometry(), standard({ map: asphalt, roughness: 0.9, metalness: 0 }));

  const grass = grassTile(1906);
  grass.wrapS = THREE.RepeatWrapping;
  grass.wrapT = THREE.RepeatWrapping;
  const landMesh = mesh(mergeParts([...landParts, ...treeParts]), standard({ vertexColors: true, map: grass, bumpMap: grass, bumpScale: 0.6, roughness: 0.96, metalness: 0 }));

  const concMesh = mesh(conc.geometry(), standard({ vertexColors: true, roughness: 0.82, metalness: 0 }));

  const ripple = rippleTile(1775);
  const waterMesh = mesh(water, standard({ vertexColors: true, map: ripple, bumpMap: ripple, bumpScale: 0.25, roughness: 0.42, metalness: 0 }));
  waterMesh.castShadow = false;

  const g = group(steelMesh, roadMesh, landMesh, concMesh, waterMesh);
  g.userData.hangers = hangers;
  return g;
}

function mixInto3(c, d, t) { c[0] = mix(c[0], d[0], t); c[1] = mix(c[1], d[1], t); c[2] = mix(c[2], d[2], t); }

// ---------------------------------------------------------------------------
// The Treasury at Petra, about 1/6
// ---------------------------------------------------------------------------

// THE STRATA ARE ONE FUNCTION OF WORLD POSITION, painted per texel and laid over cliff and carving
// by the same planar projection, so a band runs off the raw rock and straight on across a column.
// That is the whole of what makes it read as cut from the rock rather than placed against it, and
// it could not be a tint, because the facade's flat faces have almost no vertices to carry one.
// u is sheared by z so that a face turned sideways still gets a different u at each point.
const PT_W = 30; const PT_H = 27;
const ptU = (x, z) => (x + 0.55 * z + PT_W / 2) / PT_W;
const ptV = (y) => y / PT_H;

// A coarse grid of random values, read bilinearly: fast enough to ask two million times.
function noiseGrid(seed, n = 96) {
  const rng = seededRandom(seed);
  const a = new Float32Array(n * n);
  for (let i = 0; i < a.length; i += 1) a[i] = rng();
  return (x, y) => {
    const fx = x - Math.floor(x); const fy = y - Math.floor(y);
    const ix = ((Math.floor(x) % n) + n) % n; const iy = ((Math.floor(y) % n) + n) % n;
    const jx = (ix + 1) % n; const jy = (iy + 1) % n;
    const sx = fx * fx * (3 - 2 * fx); const sy = fy * fy * (3 - 2 * fy);
    const p = a[ix + iy * n] + (a[jx + iy * n] - a[ix + iy * n]) * sx;
    const q = a[ix + jy * n] + (a[jx + jy * n] - a[ix + jy * n]) * sx;
    return p + (q - p) * sy;
  };
}

// The beds, bottom to top: their thickness varies by an order of magnitude, the difference between
// a section and a stripe. Each bed also says how far it weathers back from the face.
const PT_BEDS = (() => {
  const rng = seededRandom(106);
  // Close to one another on purpose. This is one rock changing its mind, not a flag: at full
  // contrast the first pass read as a beach umbrella, and the eye stopped seeing the architecture.
  const palette = [
    { c: [198, 118, 92], soft: 0.3, n: 6 }, // rose
    { c: [208, 132, 102], soft: 0.15, n: 5 }, // salmon
    { c: [184, 102, 84], soft: 0.5, n: 3 }, // deep rose
    { c: [212, 146, 114], soft: 0, n: 2 }, // pale, hard
    { c: [166, 86, 78], soft: 0.85, n: 2, thin: true }, // wine, soft
    { c: [202, 124, 86], soft: 0.25, n: 3 }, // orange-rose
    { c: [214, 156, 124], soft: 0.05, n: 1, thin: true }, // cream
    { c: [142, 76, 74], soft: 1, n: 1, thin: true }, // purple
  ];
  const bag = [];
  for (const p of palette) for (let i = 0; i < p.n; i += 1) bag.push(p);
  const beds = [];
  let y = -6;
  while (y < 40) {
    const roll = rng();
    let t = roll < 0.45 ? 0.12 + rng() * 0.28 : roll < 0.85 ? 0.4 + rng() * 0.7 : 1.1 + rng() * 1.2;
    const p = bag[Math.floor(rng() * bag.length)];
    if (p.thin) t = Math.min(t, 0.32);
    const jitter = 0.96 + rng() * 0.08;
    beds.push({ y0: y, y1: y + t, c: p.c.map((v) => v * jitter), soft: p.soft, lam: 1.4 + rng() * 2.6, ph: rng() * 6 });
    y += t;
  }
  return beds;
})();
const PT_LUT_N = 4096; const PT_LUT_Y0 = -6; const PT_LUT_Y1 = 40;
function ptBuildLut() {
  const col = new Float32Array(PT_LUT_N * 3);
  const soft = new Float32Array(PT_LUT_N);
  let b = 0;
  for (let i = 0; i < PT_LUT_N; i += 1) {
    const y = mix(PT_LUT_Y0, PT_LUT_Y1, i / (PT_LUT_N - 1));
    while (b < PT_BEDS.length - 1 && y > PT_BEDS[b].y1) b += 1;
    const B = PT_BEDS[b];
    const t = (y - B.y0) / (B.y1 - B.y0);
    // A fine lamination inside the bed, and a thin dark parting at its base.
    // Irregular on purpose: an even sine here is growth rings, and the rock reads as polished wood.
    const lam = 1 + (smoothNoise3(y * B.lam * 2.3, B.ph, 1.5) - 0.5) * 0.09;
    const part = t < 0.05 ? 0.9 : 1;
    col[i * 3] = B.c[0] * lam * part; col[i * 3 + 1] = B.c[1] * lam * part; col[i * 3 + 2] = B.c[2] * lam * part;
    soft[i] = B.soft;
  }
  // The relief is taken from a blurred copy: a bed thinner than the mesh can draw must not alias.
  const blurred = new Float32Array(PT_LUT_N);
  const R = Math.round((0.22 / (PT_LUT_Y1 - PT_LUT_Y0)) * PT_LUT_N);
  let sum = 0;
  for (let i = 0; i < PT_LUT_N; i += 1) {
    sum += soft[i];
    if (i > 2 * R) sum -= soft[i - 2 * R - 1];
    blurred[Math.max(0, i - R)] = sum / Math.min(i + 1, 2 * R + 1);
  }
  return { col, soft: blurred };
}

function petraStrata(lut, holds) {
  const n1 = noiseGrid(11); const n2 = noiseGrid(12); const n3 = noiseGrid(13); const n4 = noiseGrid(14);
  const speck = seededRandom(77);
  const SPECK = new Float32Array(4096);
  for (let i = 0; i < 4096; i += 1) SPECK[i] = 0.96 + speck() * 0.08;
  const SIZE = 1536;
  return canvasTexture(SIZE, SIZE, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const scale = (PT_LUT_N - 1) / (PT_LUT_Y1 - PT_LUT_Y0);
    let o = 0;
    for (let r = 0; r < h; r += 1) {
      const y = (1 - (r + 0.5) / h) * PT_H;
      for (let c = 0; c < w; c += 1) {
        const x = ((c + 0.5) / w) * PT_W - PT_W / 2;
        // Long lazy warps, swirls in some places and not others: Petra's sandstone is famous for them.
        const swirl = n4(x * 0.11 + 3, y * 0.11);
        const big = (n1(x * 0.16, y * 0.2) - 0.5) * 1.5;
        const mid = (n2(x * 0.55, y * 0.75) - 0.5) * (0.3 + swirl * 0.9);
        const fine = (n3(x * 2.2, y * 3.2) - 0.5) * 0.09;
        const wy = y + 0.035 * x + big + mid + fine;
        let i = Math.round((wy - PT_LUT_Y0) * scale);
        if (i < 0) i = 0; else if (i >= PT_LUT_N) i = PT_LUT_N - 1;
        const k = SPECK[(c * 7 + r * 131) & 4095];
        // Iron stain across the beds, which is what keeps a bed from one flat colour along its run.
        const stain = 0.86 + 0.26 * n2(x * 0.32 + 40, y * 0.42);
        const v = lut.col;
        d[o] = v[i * 3] * k * stain; d[o + 1] = v[i * 3 + 1] * k * stain * 0.985; d[o + 2] = v[i * 3 + 2] * k * stain * 0.97; d[o + 3] = 255;
        o += 4;
      }
    }
    ctx.putImageData(img, 0, 0);
    for (const hold of holds) {
      const cx = ptU(hold.x, hold.z) * w; const cy = (1 - ptV(hold.y)) * h;
      const hw = (hold.w * 0.8 / PT_W) * w; const hh = (0.1 / PT_H) * h;
      ctx.fillStyle = 'rgba(62,34,30,0.72)';
      ctx.fillRect(cx - hw, cy - hh, hw * 2, hh * 2);
      ctx.fillStyle = 'rgba(232,186,150,0.5)';
      ctx.fillRect(cx - hw, cy + hh, hw * 2, 2.2);
    }
  });
}

// An eroded robed figure in low relief, authored at base centre facing +Z, with its back flat
// against the wall. The sculpture on this facade really is this worn, which is the honest level of
// detail: no face, the stance, and the fall of the drapery.
function ptFigure(h, pose) {
  const s = new Sculpt(h * 0.036);
  const c = [1, 1, 1];
  const U = h / 3.4;
  const add3 = (x, y, z) => [x * U, y * U, z * U];
  const flat = 0.72; // depth over width
  s.add(ellipsoidP(add3(0, 2.0, 0.1), [0.42 * U, 0.62 * U, 0.3 * U * flat]), c);
  s.add(sphereP(add3(0, 3.0, 0.15), 0.23 * U), c, { k: 0.1 * U });
  s.add(curveP([add3(0, 2.72, 0.13), add3(0, 2.95, 0.15)], [0.11 * U, 0.1 * U]), c, { k: 0.1 * U });
  // Skirt: a tapered sweep, wider at the hem.
  s.add(curveP([add3(0, 1.75, 0.08), add3(pose.hip ?? 0.05, 0.9, 0.1), add3((pose.hip ?? 0.05) * 1.6, 0.06, 0.1)], [0.38 * U, 0.52 * U, 0.62 * U]), c, { k: 0.18 * U });
  if (pose.kind === 'axe') {
    // An arm raised with an axe over the head.
    s.add(curveP([add3(-0.38, 2.42, 0.1), add3(-0.68, 2.86, 0.12), add3(-0.42, 3.3, 0.14)], [0.11 * U, 0.09 * U, 0.08 * U]), c, { k: 0.06 * U });
    s.add(curveP([add3(-0.42, 3.3, 0.14), add3(0.2, 3.42, 0.14)], [0.05 * U, 0.05 * U]), c, { k: 0.03 * U });
    s.add(ellipsoidP(add3(0.26, 3.34, 0.14), [0.13 * U, 0.2 * U, 0.05 * U]), c, { k: 0.03 * U });
    s.add(curveP([add3(0.38, 2.42, 0.1), add3(0.56, 1.92, 0.14), add3(0.44, 1.5, 0.16)], [0.11 * U, 0.09 * U, 0.08 * U]), c, { k: 0.06 * U });
  } else {
    // A cornucopia held in the crook of one arm.
    s.add(curveP([add3(-0.38, 2.42, 0.1), add3(-0.54, 1.86, 0.18), add3(-0.26, 1.72, 0.24)], [0.11 * U, 0.09 * U, 0.09 * U]), c, { k: 0.06 * U });
    s.add(curveP([add3(-0.2, 1.42, 0.24), add3(-0.42, 1.95, 0.3), add3(-0.62, 2.62, 0.26), add3(-0.74, 2.9, 0.2)], [0.03 * U, 0.1 * U, 0.17 * U, 0.2 * U]), c, { k: 0.06 * U });
    s.add(curveP([add3(0.38, 2.42, 0.1), add3(0.52, 1.9, 0.14), add3(0.4, 1.4, 0.16)], [0.11 * U, 0.09 * U, 0.08 * U]), c, { k: 0.06 * U });
  }
  s.map((d, x, y, z) => d + (fbm(x * 3.2 / U, y * 3.2 / U, z * 3.2 / U, 2) - 0.5) * 0.09 * U + 0.012 * U * Math.sin((x + y * 0.28) * 34 / U));
  return polygonize(s, { normalH: 0.8 });
}

// One of the Dioscuri beside his horse, the panels between the outer columns. So worn on the real
// facade that a horse's forequarters and a standing man are all anybody can read.
function ptDioscuros(h) {
  const s = new Sculpt(h * 0.032);
  const c = [1, 1, 1];
  const U = h / 4.4;
  const A = (x, y, z) => [x * U, y * U, z * U];
  // The man.
  s.add(ellipsoidP(A(-0.34, 2.55, 0.1), [0.34 * U, 0.6 * U, 0.2 * U]), c);
  s.add(sphereP(A(-0.34, 3.52, 0.15), 0.22 * U), c, { k: 0.1 * U });
  s.add(curveP([A(-0.34, 3.2, 0.13), A(-0.34, 3.46, 0.15)], [0.1 * U, 0.1 * U]), c, { k: 0.09 * U });
  s.add(curveP([A(-0.5, 2.0, 0.1), A(-0.56, 1.0, 0.12), A(-0.58, 0.06, 0.12)], [0.19 * U, 0.14 * U, 0.12 * U]), c, { k: 0.1 * U });
  s.add(curveP([A(-0.18, 2.0, 0.1), A(-0.1, 1.0, 0.12), A(-0.06, 0.06, 0.12)], [0.19 * U, 0.14 * U, 0.12 * U]), c, { k: 0.1 * U });
  s.add(curveP([A(-0.02, 3.0, 0.1), A(0.26, 2.72, 0.16), A(0.5, 2.92, 0.24)], [0.1 * U, 0.09 * U, 0.08 * U]), c, { k: 0.06 * U });
  // The horse, head high, forequarters out of the wall.
  s.add(ellipsoidP(A(0.42, 1.92, 0.06), [0.52 * U, 0.58 * U, 0.26 * U]), c, { k: 0.08 * U });
  s.add(curveP([A(0.54, 2.25, 0.1), A(0.68, 2.98, 0.14), A(0.74, 3.46, 0.16)], [0.3 * U, 0.2 * U, 0.14 * U]), c, { k: 0.12 * U });
  s.add(curveP([A(0.74, 3.5, 0.16), A(0.62, 3.24, 0.22), A(0.44, 3.02, 0.26)], [0.15 * U, 0.12 * U, 0.08 * U]), c, { k: 0.06 * U });
  s.add(curveP([A(0.3, 1.5, 0.1), A(0.32, 0.8, 0.14), A(0.3, 0.06, 0.14)], [0.14 * U, 0.09 * U, 0.08 * U]), c, { k: 0.08 * U });
  s.add(curveP([A(0.74, 1.5, 0.1), A(0.82, 1.04, 0.22), A(0.62, 0.74, 0.24)], [0.13 * U, 0.09 * U, 0.08 * U]), c, { k: 0.08 * U });
  s.map((d, x, y, z) => d + (fbm(x * 2.6 / U, y * 2.6 / U, z * 2.6 / U, 2) - 0.5) * 0.11 * U);
  return polygonize(s, { normalH: 0.85 });
}

// A Corinthian capital for a column of radius 1, standing at y = 0, one unit tall in its own terms:
// a bell, two tiers of worn acanthus and four corner volutes under a square abacus. The Nabataean
// version is plainer and floral, and leaves that read as leaves at six feet are all it needs.
function ptCapitalGeometry() {
  const parts = [];
  parts.push({ geometry: lathe([[0, 0], [1.02, 0], [1.02, 0.06], [0.96, 0.1], [1.02, 0.5], [1.32, 1.72], [1.2, 1.78], [0, 1.78]], 12), color: 0xffffff });
  const leaf = (a, y, r, w, hgt, tip) => {
    const g = new THREE.SphereGeometry(1, 5, 4);
    // A leaf is a cupped spoon curling out at the tip.
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i += 1) {
      const py = P.getY(i);
      P.setZ(i, P.getZ(i) * 0.26 + tip * (py + 1) * (py + 1) * 0.5);
    }
    g.scale(w, hgt, 1);
    g.computeVertexNormals();
    const m = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeTranslation(0, y, r));
    g.applyMatrix4(m);
    return g;
  };
  for (let i = 0; i < 6; i += 1) {
    parts.push({ geometry: leaf((i / 6) * Math.PI * 2 + 0.2, 0.42, 0.98, 0.34, 0.44, 0.16), color: 0xffffff });
    parts.push({ geometry: leaf(((i + 0.5) / 6) * Math.PI * 2 + 0.2, 0.98, 1.1, 0.34, 0.52, 0.2), color: 0xffffff });
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const g = new THREE.SphereGeometry(0.24, 6, 4);
    g.translate(sx * 1.08, 1.56, sz * 1.08);
    parts.push({ geometry: g, color: 0xffffff });
  }
  const ab = new Soup();
  const W = 1.54;
  ab.hexa([[-W + 0.16, 1.74, -W + 0.16], [W - 0.16, 1.74, -W + 0.16], [W - 0.16, 1.74, W - 0.16], [-W + 0.16, 1.74, W - 0.16]], [[-W, 2.0, -W], [W, 2.0, -W], [W, 2.0, W], [-W, 2.0, W]], [1, 1, 1]);
  parts.push({ geometry: ab.geometry(), keepColor: true });
  return mergeParts(parts);
}

function petraTreasury() {
  const rng = seededRandom(312);
  const lut = ptBuildLut();
  const soup = new Soup();
  const parts = [];
  const FLOOR = 0.12; // the rock floor's height over the base's underside
  const AGE = (y, ao = 1) => { const t = ao * mix(0.82, 1, sstep(y, 0, 8)); return [t, t, t]; };
  const B = (x0, y0, z0, x1, y1, z1, ao = 1) => soup.box(x0, y0, z0, x1, y1, z1, AGE((y0 + y1) / 2, ao));
  const BS = (x0, y0, z0, x1, y1, z1, ao = 1) => { B(x0, y0, z0, x1, y1, z1, ao); B(-x0, y0, z0, -x1, y1, z1, ao); };

  // All heights in feet over the rock floor; the real elevations by a factor of about 6.
  const PLAT = 0.6;
  const Z_COL = 0.95; const Z_ENT = 1.35; const Z_WALL = 0; const Z_PORCH = -2.4;
  const HALF = 6.95;
  const LOW = { base: PLAT, top: 7.15, cap: 7.95, arch: 8.35, frieze: 8.95, cor: 9.28 };
  const UP = { floor: 11.4, top: 16.0, cap: 16.7, arch: 17.0, frieze: 17.42, cor: 17.76 };
  const ZU_WALL = -1.35; const ZU_COL = -0.55; const ZU_ENT = -0.2;

  // --- the platform and three steps ---------------------------------------------------------------
  B(-HALF - 0.2, -0.12, Z_PORCH, HALF + 0.2, PLAT, Z_ENT + 0.4, 0.92);
  for (let i = 0; i < 3; i += 1) {
    const z = Z_ENT + 0.4 + (3 - i) * 0.42;
    B(-HALF - 0.5 + i * 0.12, -0.12, Z_ENT + 0.3, HALF + 0.5 - i * 0.12, ((i + 1) / 3) * PLAT - 0.02, z, 0.86);
  }

  // --- the lower walls -----------------------------------------------------------------------------
  // The porch: its back wall, its two side walls, and a ceiling, which is the entablature's underside.
  B(-HALF, PLAT, Z_PORCH - 0.3, HALF, LOW.cap, Z_PORCH, 0.62);
  BS(2.72, PLAT, Z_PORCH, 3.0, LOW.cap, Z_WALL, 0.72);
  // The side bays, between each inner column and the outer pier, each with its panel.
  BS(3.0, PLAT, Z_PORCH, HALF, LOW.cap, Z_WALL, 0.95);
  // The outer pier the end column stands engaged in.
  BS(6.05, PLAT, Z_WALL, HALF, LOW.cap, Z_COL + 0.02, 0.98);

  // The door. There is no CSG, so the void is a near-black panel a hair proud of the wall inside a
  // projecting architrave, and the frame's own shadow is what says "hole".
  const doorW = 1.2; const doorH = 5.6;
  const ZD = Z_PORCH;
  soup.face([[-doorW, PLAT, ZD + 0.02], [doorW, PLAT, ZD + 0.02], [doorW, doorH, ZD + 0.02], [-doorW, doorH, ZD + 0.02]], [0.012, 0.009, 0.009], [0, 0, 1]);
  for (const [o, p, ao] of [[0.34, 0.1, 0.72], [0.2, 0.2, 0.8], [0.08, 0.28, 0.72]]) {
    BS(doorW + o - 0.14, PLAT, ZD, doorW + o, doorH + o, ZD + p, ao);
    B(-doorW - o, doorH + o - 0.14, ZD, doorW + o, doorH + o, ZD + p, ao);
  }
  // Its own small pediment.
  {
    const y0 = doorH + 0.5; const ya = y0 + 0.82; const w = doorW + 0.62;
    B(-w, y0 - 0.16, ZD, w, y0, ZD + 0.36, 0.8);
    soup.face([[-w + 0.1, y0, ZD + 0.1], [w - 0.1, y0, ZD + 0.1], [0, ya - 0.1, ZD + 0.1]], AGE(y0, 0.7), [0, 0, 1]);
    for (const s of [-1, 1]) {
      soup.hexa(
        [[0, ya - 0.14, ZD], [s * (w + 0.1), y0 - 0.02, ZD], [s * (w + 0.1), y0 - 0.02, ZD + 0.36], [0, ya - 0.14, ZD + 0.36]],
        [[0, ya + 0.06, ZD], [s * (w + 0.1), y0 + 0.16, ZD], [s * (w + 0.1), y0 + 0.16, ZD + 0.36], [0, ya + 0.06, ZD + 0.36]],
        AGE(y0, 0.82),
      );
    }
  }
  // A doorway to a side chamber in each porch wall.
  for (const s of [-1, 1]) {
    const x = s * 2.715;
    soup.face([[x, PLAT, -1.95], [x, PLAT, -0.55], [x, 4.0, -0.55], [x, 4.0, -1.95]], [0.015, 0.011, 0.011], [-s, 0, 0]);
    B(x, PLAT, -2.14, x - s * 0.1, 4.2, -1.95, 0.7);
    B(x, PLAT, -0.55, x - s * 0.1, 4.2, -0.36, 0.7);
    B(x, 4.0, -2.14, x - s * 0.1, 4.2, -0.36, 0.7);
  }

  // --- columns --------------------------------------------------------------------------------------
  const capital = ptCapitalGeometry();
  const placeCapital = (x, y, z, r, yaw = 0, h = 1) => {
    const m = new THREE.Matrix4().makeTranslation(x, y, z)
      .multiply(new THREE.Matrix4().makeRotationY(yaw))
      .multiply(new THREE.Matrix4().makeScale(r, h, r));
    const g = capital.clone();
    g.applyMatrix4(m);
    parts.push({ geometry: g, keepColor: true });
  };
  // A column with an attic base and entasis. Its surface is pitted by the same weather everywhere,
  // worst near the ground, where the sand-laden floods have eaten the real ones.
  const column = (x, y0, y1, z, r, sinkBase = 0) => {
    const H = y1 - y0;
    const R = r * 1.28;
    const profile = [
      [0, 0], [R * 1.06, 0], [R * 1.06, H * 0.018], [R, H * 0.03], [r * 1.14, H * 0.042], [r * 1.05, H * 0.05], [r, H * 0.058],
      [r * 1.0, H * 0.2], [r * 0.985, H * 0.4], [r * 0.95, H * 0.6], [r * 0.9, H * 0.8], [r * 0.86, H * 0.97], [r * 0.9, H * 0.985], [r * 0.9, H], [0, H],
    ];
    const g = lathe(profile, 14);
    const P = g.attributes.position;
    const seed = x * 3.1 + z;
    for (let i = 0; i < P.count; i += 1) {
      const px = P.getX(i); const py = P.getY(i); const pz = P.getZ(i);
      const a = Math.hypot(px, pz);
      if (a < 1e-4) continue;
      const wear = mix(0.11, 0.03, sstep(py, 0, H * 0.45));
      const k = 1 + (fbm(px * 2.1 + seed, py * 1.6, pz * 2.1, 2) - 0.5) * 2 * wear;
      P.setX(i, px * k); P.setZ(i, pz * k);
    }
    g.computeVertexNormals();
    g.translate(x, y0 - sinkBase, z);
    tintVertices(g, (vx, vy, vz, out) => { const v = AGE(vy)[0]; out[0] = v; out[1] = v; out[2] = v; });
    parts.push({ geometry: g, keepColor: true });
  };
  const LOWER = [1.5, 3.9, 6.35];
  const rLow = 0.33;
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      const x = s * LOWER[i];
      column(x, LOW.base, LOW.top, Z_COL, rLow);
      placeCapital(x, LOW.top, Z_COL, rLow * 0.9, 0, 0.42);
    }
  }

  // Dentils, which are the fine dark line every photograph of this cornice has under it.
  const dentils = (x0, x1, y, z, h = 0.15, step = 0.27) => {
    const n = Math.floor((x1 - x0) / step);
    for (let i = 0; i < n; i += 1) {
      const x = x0 + (i + 0.5) * ((x1 - x0) / n);
      B(x - step * 0.3, y - h, z - 0.12, x + step * 0.3, y, z + 0.11, 0.96);
    }
  };
  // A straight run of entablature: stepped architrave, flat frieze, dentils, cornice.
  const entablature = (x0, x1, L, zb, zf, ao = 1) => {
    B(x0 + 0.1, L.cap, zb, x1 - 0.1, L.cap + (L.arch - L.cap) * 0.5, zf - 0.14, ao * 0.96);
    B(x0, L.cap + (L.arch - L.cap) * 0.5, zb, x1, L.arch, zf - 0.08, ao);
    B(x0 + 0.03, L.arch, zb, x1 - 0.03, L.frieze, zf - 0.13, ao * 0.97);
    B(x0, L.frieze, zb, x1, L.frieze + (L.cor - L.frieze) * 0.34, zf + 0.04, ao);
    dentils(x0 + 0.1, x1 - 0.1, L.frieze + (L.cor - L.frieze) * 0.34, zf + 0.13, (L.cor - L.frieze) * 0.2);
    B(x0 - 0.1, L.frieze + (L.cor - L.frieze) * 0.34, zb, x1 + 0.1, L.cor - (L.cor - L.frieze) * 0.2, zf + 0.2, ao);
    B(x0 - 0.18, L.cor - (L.cor - L.frieze) * 0.2, zb, x1 + 0.18, L.cor, zf + 0.32, ao);
  };
  entablature(-HALF, HALF, LOW, Z_PORCH - 0.3, Z_ENT);

  // The frieze's relief: running vine scrolls broken by a vase at each column, which is what is
  // actually carved there, with griffins that have long since gone to shapes.
  const vine = (x0, x1, y0, y1, z, n, lift = 0.05) => {
    const yc = (y0 + y1) / 2; const a = (y1 - y0) * 0.38;
    const w = (x1 - x0) / n;
    const r = Math.max(0.028, (y1 - y0) * 0.07);
    const pts = [];
    for (let i = 0; i <= n * 4; i += 1) {
      const t = i / (n * 4);
      pts.push([mix(x0, x1, t), yc + Math.sin(t * n * Math.PI * 2) * a * 0.55, z + lift * 0.4]);
    }
    parts.push({ geometry: tube(pts, r * 0.7, { sides: 5, steps: n * 8, round: 1 }), tint: () => AGE(yc), keepColor: true });
    for (let i = 0; i < n; i += 1) {
      const cx = x0 + (i + 0.25) * w + (i % 2 ? 0.5 * w : 0);
      const sgn = i % 2 ? -1 : 1;
      const cy = yc + sgn * a * 0.42;
      // A curl off the main stem, ending in a little rosette.
      const curl = [];
      for (let k = 0; k <= 5; k += 1) {
        const q = k / 5 * 4.2;
        curl.push([cx + Math.cos(q) * a * (0.5 - k * 0.06), cy + Math.sin(q) * a * (0.5 - k * 0.06) * 0.9, z + lift]);
      }
      parts.push({ geometry: tube(curl, r * 0.62, { sides: 4, steps: 8, round: 0 }), tint: () => AGE(yc), keepColor: true });
    }
  };
  const friezeVase = (x, y0, y1, z) => {
    const h = y1 - y0;
    const g = lathe([[0, 0], [h * 0.22, 0], [h * 0.13, h * 0.1], [h * 0.3, h * 0.45], [h * 0.22, h * 0.72], [h * 0.12, h * 0.82], [h * 0.22, h * 0.95], [0, h * 0.95]], 10);
    g.scale(1, 1, 0.6);
    g.translate(x, y0, z);
    parts.push({ geometry: g, tint: () => AGE(y0), keepColor: true });
  };
  {
    const y0 = LOW.arch + 0.05; const y1 = LOW.frieze - 0.03; const z = Z_ENT - 0.13;
    const stops = [-HALF + 0.1, -LOWER[1], -LOWER[0], 0, LOWER[0], LOWER[1], HALF - 0.1];
    for (let i = 0; i < stops.length - 1; i += 1) {
      vine(stops[i] + 0.2, stops[i + 1] - 0.2, y0, y1, z, Math.max(2, Math.round((stops[i + 1] - stops[i]) / 0.75)));
      if (i > 0) friezeVase(stops[i], y0, y1, z);
    }
  }

  // --- the lower pediment, over the four central columns ----------------------------------------------
  const PW = 5.05; const PA = 1.95;
  const PY = LOW.cor; const PZ = 1.3;
  const prism = (w, y0, ya, z0, z1, ao) => {
    const col = AGE(y0, ao);
    soup.face([[-w, y0, z1], [w, y0, z1], [0, ya, z1]], col, [0, 0, 1]);
    soup.face([[-w, y0, z0], [w, y0, z0], [0, ya, z0]], col, [0, 0, -1]);
  };
  prism(PW - 0.1, PY, PY + PA - 0.1, -0.9, PZ - 0.1, 0.94);
  const rake = (w, y0, ya, z0, z1, lift, ao) => {
    for (const s of [-1, 1]) {
      soup.hexa(
        [[0, ya, z0], [s * w, y0, z0], [s * w, y0, z1], [0, ya, z1]],
        [[0, ya + lift, z0], [s * w, y0 + lift, z0], [s * w, y0 + lift, z1], [0, ya + lift, z1]],
        AGE(y0, ao),
      );
    }
  };
  rake(PW, PY - 0.02, PY + PA - 0.12, -0.9, PZ + 0.02, 0.14, 0.97);
  rake(PW + 0.1, PY + 0.08, PY + PA - 0.03, -0.9, PZ + 0.14, 0.12, 1);
  rake(PW + 0.2, PY + 0.17, PY + PA + 0.05, -0.9, PZ + 0.28, 0.15, 1);
  // Dentils up each rake.
  for (const s of [-1, 1]) {
    for (let i = 1; i < 16; i += 1) {
      const t = i / 16;
      const x = s * PW * (1 - t) * 0.97; const y = mix(PY - 0.02, PY + PA - 0.12, t) - 0.03;
      B(x - 0.07, y - 0.08, PZ - 0.14, x + 0.07, y + 0.05, PZ + 0.08, 0.95);
    }
  }
  // The tympanum: a central rosette and acanthus scrolls growing out of it.
  {
    const zT = PZ - 0.1; const yc = PY + 0.62;
    const ros = lathe([[0, 0], [0.34, 0], [0.34, 0.05], [0.28, 0.09], [0.14, 0.13], [0, 0.14]], 14);
    ros.rotateX(Math.PI / 2);
    ros.translate(0, yc, zT);
    parts.push({ geometry: ros, tint: () => AGE(10), keepColor: true });
    for (const s of [-1, 1]) {
      for (const [k, h] of [[1, 0], [0.62, 0.05]]) {
        const pts = [];
        const L = 3.5 * k;
        for (let i = 0; i <= 12; i += 1) {
          const t = i / 12;
          pts.push([s * (0.28 + t * L), yc + h - 0.38 + Math.sin(t * Math.PI * 2.4) * 0.15 * (1 - t * 0.6), zT + 0.05]);
        }
        parts.push({ geometry: tube(pts, [0.05, 0.035], { sides: 5, steps: 18, round: 1 }), tint: () => AGE(10), keepColor: true });
      }
      for (let i = 0; i < 4; i += 1) {
        const q = 1.0 + i * 0.85;
        const cx = s * q; const cy = yc - 0.3 + Math.sin(i * 1.9) * 0.1;
        const r = 0.2 - i * 0.022;
        const curl = [];
        for (let k = 0; k <= 7; k += 1) {
          const a = k / 7 * 5.5;
          curl.push([cx + s * Math.cos(a) * r * (1 - k * 0.09), cy + r * 0.8 + Math.sin(a) * r * (1 - k * 0.09), zT + 0.06]);
        }
        parts.push({ geometry: tube(curl, 0.024, { sides: 4, steps: 12, round: 0 }), tint: () => AGE(10), keepColor: true });
      }
    }
  }

  // --- the attic, then the upper storey --------------------------------------------------------------
  B(-HALF, LOW.cor, -2.3, HALF, UP.floor - 0.18, -0.3, 0.96);
  B(-HALF - 0.08, UP.floor - 0.18, -2.3, HALF + 0.08, UP.floor, -0.15, 1);
  // Panels on the attic beside the pediment.
  BS(5.45, LOW.cor + 0.25, -0.3, 6.6, UP.floor - 0.42, -0.24, 0.9);
  // Upper wall and the deep gaps either side of the tholos.
  B(-HALF, UP.floor, -2.3, HALF, UP.cap, -1.72, 0.7);
  BS(2.95, UP.floor, -1.72, HALF, UP.cap, ZU_WALL, 0.95);
  BS(6.25, UP.floor, ZU_WALL, HALF, UP.cap, ZU_COL + 0.02, 0.98);

  const UPPER = [3.5, 6.35];
  const rUp = 0.27;
  for (const s of [-1, 1]) {
    for (const ux of UPPER) {
      const x = s * ux;
      column(x, UP.floor, UP.top, ZU_COL, rUp);
      placeCapital(x, UP.top, ZU_COL, rUp * 0.9, 0, 0.38);
    }
    entablature(Math.min(s * 2.95, s * HALF), Math.max(s * 2.95, s * HALF), UP, -2.0, ZU_ENT);
    const y0 = UP.arch + 0.04; const y1 = UP.frieze - 0.03;
    const xa = s < 0 ? -HALF + 0.1 : 3.06; const xb = s < 0 ? -3.06 : HALF - 0.1;
    vine(xa, xb, y0, y1, ZU_ENT - 0.13, 5, 0.04);
    // The half pediment, rising toward the tholos and stopping dead: this is the "broken" pediment.
    const Yc = UP.cor; const Ytip = Yc + 1.45;
    const xIn = s * 2.95; const xOut = s * (HALF + 0.05);
    const zb = -2.0; const zf = -0.28;
    const col = AGE(14, 0.95);
    soup.face([[xIn, Yc, zf], [xOut, Yc, zf], [xIn, Ytip - 0.1, zf]], col, [0, 0, 1]);
    soup.face([[xIn, Yc, zb], [xOut, Yc, zb], [xIn, Ytip - 0.1, zb]], col, [0, 0, -1]);
    soup.face([[xIn, Yc, zf], [xIn, Ytip - 0.1, zf], [xIn, Ytip - 0.1, zb], [xIn, Yc, zb]], col, [-s, 0, 0]);
    for (const [o, l, proj] of [[0, 0.14, 0.04], [0.1, 0.12, 0.16], [0.2, 0.14, 0.3]]) {
      const yIn = Ytip - 0.12 + o; const yOut = Yc + o - 0.02;
      const xO = xOut + s * o * 1.2;
      soup.hexa(
        [[xIn, yIn, zb], [xO, yOut, zb], [xO, yOut, zf + proj], [xIn, yIn, zf + proj]],
        [[xIn, yIn + l, zb], [xO, yOut + l, zb], [xO, yOut + l, zf + proj], [xIn, yIn + l, zf + proj]],
        col,
      );
    }
    // The block the eagle stood on, worn to a lump.
    B(xIn - s * 0.02, Ytip + 0.1, -0.85, xIn + s * 0.48, Ytip + 0.28, -0.2, 0.96);
    {
      const e = new THREE.SphereGeometry(0.24, 10, 8);
      e.scale(0.8, 1.25, 0.8);
      e.translate(xIn + s * 0.24, Ytip + 0.5, -0.5);
      parts.push({ geometry: e, tint: () => AGE(16), keepColor: true });
      const h = new THREE.SphereGeometry(0.1, 8, 6);
      h.translate(xIn + s * 0.2, Ytip + 0.82, -0.42);
      parts.push({ geometry: h, tint: () => AGE(16), keepColor: true });
    }
  }

  // --- the tholos --------------------------------------------------------------------------------------
  const TZ = -1.55;
  const TR = 1.52;
  {
    const drum = lathe([[0, UP.floor - 0.1], [TR + 0.5, UP.floor - 0.1], [TR + 0.5, UP.floor], [TR + 0.34, UP.floor + 0.14], [TR, UP.floor + 0.22], [TR, UP.cap], [0, UP.cap]], 48);
    drum.translate(0, 0, TZ);
    parts.push({ geometry: drum, tint: () => AGE(14, 0.92), keepColor: true });
    const COLR = TR + 0.28;
    for (const deg of [-66, -22, 22, 66]) {
      const a = (deg * Math.PI) / 180;
      const x = Math.sin(a) * COLR; const z = TZ + Math.cos(a) * COLR;
      column(x, UP.floor, UP.top, z, 0.22);
      placeCapital(x, UP.top, z, 0.2, a, 0.38);
    }
    const ring = lathe([
      [0, UP.cap - 0.02], [TR + 0.52, UP.cap - 0.02], [TR + 0.52, UP.arch - 0.14], [TR + 0.58, UP.arch - 0.1], [TR + 0.58, UP.arch],
      [TR + 0.5, UP.arch], [TR + 0.5, UP.frieze], [TR + 0.6, UP.frieze + 0.08], [TR + 0.74, UP.frieze + 0.1], [TR + 0.8, UP.cor - 0.08], [TR + 0.9, UP.cor], [0, UP.cor],
    ], 64);
    ring.translate(0, 0, TZ);
    parts.push({ geometry: ring, tint: () => AGE(16), keepColor: true });
    // Dentils and vine round the ring, placed by bearing because a straight run cannot follow it.
    const RF = TR + 0.5;
    for (let i = 0; i < 44; i += 1) {
      const a = mix(-2.1, 2.1, i / 43);
      const g = new THREE.BoxGeometry(0.11, 0.14, 0.2);
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(a));
      g.translate(Math.sin(a) * (RF + 0.14), UP.frieze + 0.02, TZ + Math.cos(a) * (RF + 0.14));
      parts.push({ geometry: g, tint: () => AGE(16, 0.96), keepColor: true });
    }
    const vinePts = [];
    for (let i = 0; i <= 80; i += 1) {
      const a = mix(-2.0, 2.0, i / 80);
      vinePts.push([Math.sin(a) * (RF + 0.02), mix(UP.arch, UP.frieze, 0.5) + Math.sin(a * 11) * 0.09, TZ + Math.cos(a) * (RF + 0.02)]);
    }
    parts.push({ geometry: tube(vinePts, 0.032, { sides: 5, steps: 90, round: 1 }), tint: () => AGE(16), keepColor: true });
    // The roof: a concave tent of carved scales, narrowing to the capital that carries the urn.
    const ROOF_TOP = UP.cor + 2.55;
    const rProfile = [];
    const N = 10;
    rProfile.push([0, UP.cor - 0.02]);
    for (let i = 0; i <= N; i += 1) {
      const t = i / N;
      rProfile.push([mix(TR + 0.72, 0.36, 1 - (1 - t) ** 1.9), mix(UP.cor, ROOF_TOP, t)]);
    }
    rProfile.push([0, ROOF_TOP]);
    const roof = lathe(rProfile, 64);
    {
      const P = roof.attributes.position;
      for (let i = 0; i < P.count; i += 1) {
        const px = P.getX(i); const pz = P.getZ(i); const py = P.getY(i);
        const r = Math.hypot(px, pz);
        if (r < 0.01 || py <= UP.cor + 0.001) continue;
        const a = Math.atan2(px, pz);
        const t = (py - UP.cor) / (ROOF_TOP - UP.cor);
        const k = 1 + Math.abs(Math.cos(a * 8)) ** 1.4 * 0.055 * (1 - t);
        P.setX(i, px * k); P.setZ(i, pz * k);
      }
      roof.computeVertexNormals();
    }
    roof.translate(0, 0, TZ);
    parts.push({ geometry: roof, tint: () => AGE(18), keepColor: true });
    // Capital, then the urn: the thing the Treasury is named for, because people thought gold was in it.
    placeCapital(0, ROOF_TOP - 0.03, TZ, 0.34, 0, 0.3);
    const yU = ROOF_TOP + 0.5;
    const urn = lathe([
      [0, yU], [0.5, yU], [0.5, yU + 0.1], [0.24, yU + 0.17], [0.2, yU + 0.3], [0.42, yU + 0.56], [0.56, yU + 0.82], [0.54, yU + 1.04],
      [0.36, yU + 1.24], [0.24, yU + 1.3], [0.3, yU + 1.38], [0.24, yU + 1.42], [0.08, yU + 1.5], [0, yU + 1.56],
    ], 28);
    urn.translate(0, 0, TZ);
    parts.push({ geometry: urn, tint: () => AGE(20), keepColor: true });
  }

  // --- reliefs -------------------------------------------------------------------------------------------
  const place = (geo, x, y, z, yaw = 0) => {
    const g = geo.clone();
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationY(yaw)));
    parts.push({ geometry: g, keepColor: true });
  };
  const dios = ptDioscuros(4.5);
  const diosM = mirrorXGeometry(dios);
  place(dios, 5.03, PLAT, Z_WALL - 0.06);
  place(diosM, -5.03, PLAT, Z_WALL - 0.06);
  const amazon = ptFigure(3.3, { kind: 'axe', hip: 0.08 });
  const amazonM = mirrorXGeometry(amazon);
  place(amazon, 4.92, UP.floor + 0.05, ZU_WALL - 0.04);
  place(amazonM, -4.92, UP.floor + 0.05, ZU_WALL - 0.04);
  const tyche = ptFigure(3.1, { kind: 'horn', hip: 0.03 });
  place(tyche, 0, UP.floor + 0.3, TZ + TR - 0.1);
  // Niches round each panel, built forward as frames.
  for (const s of [-1, 1]) {
    const x = s * 4.92;
    B(x - 1.05, UP.floor + 0.02, ZU_WALL, x - 0.94, 15.5, ZU_WALL + 0.12, 0.9);
    B(x + 0.94, UP.floor + 0.02, ZU_WALL, x + 1.05, 15.5, ZU_WALL + 0.12, 0.9);
    B(x - 1.05, 15.4, ZU_WALL, x + 1.05, 15.55, ZU_WALL + 0.14, 0.9);
    soup.face([[x - 0.94, UP.floor + 0.02, ZU_WALL + 0.012], [x + 0.94, UP.floor + 0.02, ZU_WALL + 0.012], [x + 0.94, 15.4, ZU_WALL + 0.012], [x - 0.94, 15.4, ZU_WALL + 0.012]], [0.5, 0.5, 0.5], [0, 0, 1]);
  }

  // --- the cliff --------------------------------------------------------------------------------------------
  const nA = noiseGrid(21); const nB = noiseGrid(22); const nC = noiseGrid(23);
  const softAt = (x, y) => {
    const wy = y + 0.035 * x + (nA(x * 0.16, y * 0.2) - 0.5) * 1.1;
    let i = Math.round(((wy - PT_LUT_Y0) / (PT_LUT_Y1 - PT_LUT_Y0)) * (PT_LUT_N - 1));
    i = i < 0 ? 0 : i >= PT_LUT_N ? PT_LUT_N - 1 : i;
    return lut.soft[i];
  };
  const NICHE_HALF = 7.45; const NICHE_TOP = 22.9; const ZB = -2.3;
  const skyline = (x) => 24.2 + (nA(x * 0.32 + 9, 2.2) - 0.5) * 2.2 + (nB(x * 1.1, 4.1) - 0.5) * 0.7 - 0.009 * x * x;
  // How far inside the carved niche a point on the rock face is: a rounded rectangle with its edge
  // wandering a little, because this was cut with chisels, not a saw.
  const nicheEdge = (x, y) => {
    const wob = (nB(x * 0.8, y * 0.8) - 0.5) * 0.3;
    const dx = Math.abs(x) - (NICHE_HALF - 1.5);
    const dy = y - (NICHE_TOP - 1.5);
    const ox = Math.max(dx, 0); const oy = Math.max(dy, 0);
    return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - 1.5 + wob;
  };
  const rockZ = (x, y) => {
    const ax = Math.abs(x);
    // The cliffs embrace the facade and lean back as they rise.
    const lean = 2.25 - 0.12 * y - 0.0015 * y * y;
    const embrace = 0.045 * Math.max(0, ax - 7) * Math.max(0, ax - 7) * (1 - y / 34);
    const lobes = (nA(x * 0.22 + 4, y * 0.18) - 0.5) * 1.9 + (nB(x * 0.6, y * 0.5) - 0.5) * 0.8;
    // A ridged field is what turns a cushion into stone: its crease has no rounding at the bottom.
    const ridge = 1 - Math.abs(nC(x * 0.95, y * 0.8) * 2 - 1);
    const crack = 1 - Math.abs(nA(x * 0.62 + 20, y * 0.13 + 7) * 2 - 1);
    // Vertical joints running through the beds, and each bed weathering back by its softness.
    return lean + embrace + lobes - ridge * ridge * 0.42 - crack ** 6 * 0.75 - softAt(x, y) * 0.62;
  };
  const faceZ = (x, y) => {
    const e = nicheEdge(x, y);
    const rock = rockZ(x, y);
    const inner = ZB + 0.0;
    // The cut return: nearly a wall, slightly battered, not a smooth blend.
    const k = sstep(e, -0.02, 0.36);
    return mix(inner, Math.max(rock, inner + 0.6), k);
  };

  const XR = 9.7; const NX = 90; const NY = 100;
  const backRows = 10;
  const colsX = [];
  for (let i = 0; i <= NX; i += 1) colsX.push(mix(-XR, XR, i / NX));
  const profile = (x) => {
    const Yt = skyline(x);
    const rows = [];
    for (let j = 0; j <= NY; j += 1) {
      const y = mix(-0.12, Yt, j / NY);
      rows.push([x, y, faceZ(x, y)]);
    }
    // Over the top and down the back, as rounded weathered rock with its own lobes, so a student who
    // walks round finds a hill and not the back of a stage flat.
    const zTop = rows[NY][2];
    const back = (t, zBase, yy) => {
      const lump = (nA(x * 0.17 + 40, yy * 0.13) - 0.5) * 3.2 + (nB(x * 0.33 + 9, yy * 0.27) - 0.5) * 1.1;
      return [x, yy, zBase + lump * t];
    };
    rows.push([x, Yt + 0.15, zTop - 0.9]);
    rows.push(back(0.4, -3.0, Yt - 0.15));
    rows.push(back(0.8, -3.8, Yt - 1.4));
    rows.push(back(1, -4.4, Yt - 3.6));
    rows.push(back(1, -4.7, Yt * 0.68));
    rows.push(back(1, -4.95, Yt * 0.52));
    rows.push(back(1, -5.25, Yt * 0.36));
    rows.push(back(1, -5.45, Yt * 0.2));
    rows.push(back(0.6, -5.5, Yt * 0.08));
    rows.push([x, -0.12, -5.5]);
    return rows;
  };
  // The loop is closed under the floor by repeating the first row, or the block's two ends and its
  // underside each keep a wedge of daylight.
  const nRows = NY + 1 + backRows + 1;
  const gridRows = colsX.map(profile).map((r) => [...r, r[0]]);
  // The block's two ends: each profile drawn in to a point, a rough rounded end to the outcrop.
  const endCol = (rows, dir, f, dx) => {
    const c = [dir * (XR + dx), 10, -1.4];
    return rows.map((p) => [p[0] + dir * dx, mix(p[1], c[1], f), mix(p[2], c[2], f)]);
  };
  const allCols = [
    endCol(gridRows[0], -1, 1, 0.55), endCol(gridRows[0], -1, 0.62, 0.42),
    ...gridRows,
    endCol(gridRows[NX], 1, 0.62, 0.42), endCol(gridRows[NX], 1, 1, 0.55),
  ];
  const cPos = []; const cCol = []; const cIdx = [];
  const nCols = allCols.length;
  for (let i = 0; i < nCols; i += 1) {
    for (let j = 0; j < nRows; j += 1) {
      const p = allCols[i][j];
      cPos.push(p[0], p[1], p[2]);
      // Black varnish runs down the raw rock in vertical streaks; the carved niche stays paler,
      // being a fresher surface and out of the rain.
      const inNiche = 1 - sstep(nicheEdge(p[0], p[1]), -0.1, 0.5);
      const streak = sstep(nB(p[0] * 1.5, p[1] * 0.07 + 3), 0.42, 0.72);
      const top = sstep(p[1], 15, 24);
      const isBack = j > NY ? 1 : 0;
      const v = isBack ? mix(0.88, 0.74, sstep(nA(p[0] * 0.4, p[1] * 0.1), 0.4, 0.7)) : mix(mix(0.92, 0.6, streak * (0.35 + 0.65 * top)), 0.92, inNiche);
      cCol.push(v, v * 0.985, v * 0.97);
    }
  }
  const hidden = (x, y) => Math.abs(x) < HALF - 0.4 && y < 10.8;
  for (let i = 0; i < nCols - 1; i += 1) {
    for (let j = 0; j < nRows - 1; j += 1) {
      const pa = allCols[i][j]; const pb = allCols[i + 1][j + 1];
      if (j < NY && hidden(pa[0], pa[1]) && hidden(pb[0], pb[1])) continue;
      const a = i * nRows + j; const b = i * nRows + j + 1; const c = (i + 1) * nRows + j + 1; const d = (i + 1) * nRows + j;
      cIdx.push(a, d, c, a, c, b);
    }
  }
  const cliff = new THREE.BufferGeometry();
  cliff.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
  cliff.setAttribute('color', new THREE.Float32BufferAttribute(cCol, 3));
  cliff.setIndex(cIdx);
  cliff.computeVertexNormals();
  // The block's ends are long thin fans, and interpolated normals across them draw pale streaks.
  {
    const N = cliff.attributes.normal;
    for (const [i, dir] of [[0, -1], [1, -1], [nCols - 2, 1], [nCols - 1, 1]]) {
      for (let j = 0; j < nRows; j += 1) N.setXYZ(i * nRows + j, dir, 0, 0);
    }
  }
  parts.push({ geometry: cliff, keepColor: true });

  // Rows of cut footholds climbing the rock beside the facade. Whoever carved this worked from the
  // top down, and these are what is left of how they got there. They are PAINTED on the strata sheet
  // at the rock's own height: as solids on a surface this uneven each one floats or buries itself.
  const holds = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 16; i += 1) {
      const y = 2.0 + i * 1.28 + (s < 0 ? 0.5 : 0) + Math.sin(i * 2.3 + s) * 0.2;
      const x = s * (NICHE_HALF + 0.46 + Math.sin(i * 1.7) * 0.12);
      holds.push({ x, y: y + FLOOR, z: faceZ(x, y), w: 0.17 + (i % 3) * 0.03 });
    }
  }

  // Boulders fallen from above, sunk into the sand at the cliff's foot.
  for (let i = 0; i < 16; i += 1) {
    const big = i < 5;
    const s = i % 2 ? -1 : 1;
    const x = s * mix(7.6, 9.8, rng());
    const r = big ? 0.55 + rng() * 0.55 : 0.2 + rng() * 0.25;
    const z = faceZ(x, 0.2) + mix(0.3, 1.8, rng());
    const g = ptRock(100 + i, [r * (1 + rng() * 0.4), r * (0.7 + rng() * 0.3), r * (0.9 + rng() * 0.3)], big ? 2 : 1);
    g.translate(x, r * 0.25, z);
    parts.push({ geometry: g, tint: () => [0.86, 0.85, 0.83], keepColor: true });
  }

  // --- merge, and lay the one painting over all of it -----------------------------------------------------
  parts.unshift({ geometry: soup.geometry(), keepColor: true });
  const rockGeo = mergeParts(parts);
  const P = rockGeo.attributes.position;
  const UV = rockGeo.attributes.uv;
  for (let i = 0; i < P.count; i += 1) UV.setXY(i, ptU(P.getX(i), P.getZ(i)), ptV(P.getY(i)));
  rockGeo.translate(0, FLOOR, 0);
  const strata = petraStrata(lut, holds);
  const grain = grainBump(4, { size: 256, dots: 2400, min: 0.8, max: 2.6, contrast: 0.6 });
  grain.repeat.set(PT_W / 1.1, PT_H / 1.1);
  const rock = mesh(rockGeo, standard({ vertexColors: true, map: strata, bumpMap: grain, bumpScale: 0.32, roughness: 0.94, metalness: 0 }));

  // --- the floor of the Siq's mouth: pink sand over the base ----------------------------------------------
  const FX = 10.3; const FZ0 = -5.7; const FZ1 = 6.9;
  const nx = 30; const nz = 20;
  const fPos = []; const fCol = []; const fUv = []; const fIdx = [];
  const sand = lin(0xd2a184); const sandDk = lin(0xb37f65);
  const sandY = (x, z) => FLOOR + (fbm(x * 0.4, z * 0.4, 2.2, 3) - 0.5) * 0.09 - 0.02;
  for (let j = 0; j <= nz; j += 1) {
    const z = mix(FZ0, FZ1, j / nz);
    for (let i = 0; i <= nx; i += 1) {
      const x = mix(-FX, FX, i / nx);
      fPos.push(x, sandY(x, z), z);
      const c = mix3(sandDk, sand, fbm(x * 0.5 + 3, z * 0.5, 8.1, 3) * 1.3 - 0.15);
      fCol.push(c[0], c[1], c[2]);
      fUv.push(x * 0.5, z * 0.5);
    }
  }
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const a = j * (nx + 1) + i; const b = a + 1; const c = a + nx + 1; const d = c + 1;
      fIdx.push(a, c, b, b, c, d);
    }
  }
  const floor = new THREE.BufferGeometry();
  floor.setAttribute('position', new THREE.Float32BufferAttribute(fPos, 3));
  floor.setAttribute('color', new THREE.Float32BufferAttribute(fCol, 3));
  floor.setAttribute('uv', new THREE.Float32BufferAttribute(fUv, 2));
  floor.setIndex(fIdx);
  floor.computeVertexNormals();
  const skirt = new Soup();
  const edge = lin(0x8a5f4c);
  for (let i = 0; i < nx; i += 1) {
    const a = mix(-FX, FX, i / nx); const b = mix(-FX, FX, (i + 1) / nx);
    skirt.face([[a, 0, FZ1], [b, 0, FZ1], [b, sandY(b, FZ1), FZ1], [a, sandY(a, FZ1), FZ1]], edge, [0, 0, 1]);
    skirt.face([[a, 0, FZ0], [b, 0, FZ0], [b, sandY(b, FZ0), FZ0], [a, sandY(a, FZ0), FZ0]], edge, [0, 0, -1]);
  }
  for (let j = 0; j < nz; j += 1) {
    const a = mix(FZ0, FZ1, j / nz); const b = mix(FZ0, FZ1, (j + 1) / nz);
    for (const s of [-1, 1]) skirt.face([[s * FX, 0, a], [s * FX, 0, b], [s * FX, sandY(s * FX, b), b], [s * FX, sandY(s * FX, a), a]], edge, [s, 0, 0]);
  }
  skirt.face([[-FX, 0, FZ0], [FX, 0, FZ0], [FX, 0, FZ1], [-FX, 0, FZ1]], edge, [0, -1, 0]);
  const sandTile = grassTile(611);
  sandTile.wrapS = THREE.RepeatWrapping;
  sandTile.wrapT = THREE.RepeatWrapping;
  const sandMesh = mesh(mergeParts([{ geometry: floor, keepColor: true }, { geometry: skirt.geometry(), keepColor: true }]), standard({ vertexColors: true, map: sandTile, bumpMap: sandTile, bumpScale: 0.7, roughness: 0.98, metalness: 0 }));
  return group(rock, sandMesh);
}

// A rock that broke: the support function of a convex polyhedron, read off per direction, so the
// flats come out with no CSG and no risk of tearing. See VolcanoProps' boulder.
function ptRock(seed, radii, detail = 2) {
  const rng = seededRandom(seed);
  const planes = [];
  const cuts = 8;
  for (let i = 0; i < cuts; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / cuts + (rng() - 0.5) * 0.25;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * 2.39996 + rng() * 0.7;
    planes.push({ n: norm([Math.cos(a) * r, y, Math.sin(a) * r]), h: mix(0.62, 0.92, rng()) });
  }
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const d = norm([pos.getX(i), pos.getY(i), pos.getZ(i)]);
    let rad = 1.05;
    for (const pl of planes) {
      const k = dot(d, pl.n);
      if (k > 0.05) rad = Math.min(rad, pl.h / k);
    }
    pos.setXYZ(i, d[0] * rad * radii[0], d[1] * rad * radii[1], d[2] * rad * radii[2]);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const out = toCreasedNormals(g, (34 * Math.PI) / 180);
  out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  return out;
}

// Reflects a merged indexed or non-indexed geometry across x = 0, repairing winding and normals.
function mirrorXGeometry(geometry) {
  const g = geometry.clone();
  const p = g.attributes.position;
  const nrm = g.attributes.normal;
  for (let i = 0; i < p.count; i += 1) {
    p.setX(i, -p.getX(i));
    if (nrm) nrm.setX(i, -nrm.getX(i));
  }
  const idx = g.index;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  return g;
}

// ---------------------------------------------------------------------------
// The Sydney Opera House, about 1/20
// ---------------------------------------------------------------------------

// THE SPHERICAL SOLUTION. After years of failing to build the competition's free curves, Utzon cut
// every shell from the surface of one imagined sphere, of radius 246ft, so that every rib could be
// cast from one set of moulds. So that is how these are built, not imitated: a half shell here is a
// spherical triangle with a corner at its foot on the podium and its far edge along the ridge, and
// the ridge is where the sphere meets the hall's plane of symmetry. Every point on it is the
// centre plus R times a unit vector, the two side edges are great circles, and each half's mirror
// meets it along the ridge. `operaShellReport` measures that at every vertex.
const OP_R = 246 / 20;
const OP_WATER = 0.3;
const OP_TOP = OP_WATER + 2.0; // podium top
const OP_SHIFT_Z = 0.9; // the block sits a little south of centre, and this centres it on the origin

// Each half shell, in its hall's own frame: u across, w along the axis with +w north. A and B are
// the ridge's two ends as [y, w], wF is the foot along the axis and d is how far off the hall's
// plane the sphere's centre stands, which alone decides how sharp the ridge is and how wide the foot.
// A hall is three north-facing shells nested down toward the harbour, backed by one facing south.
const OP_HALLS = [
  {
    name: 'concert', x: 4.75, z: 1.5, yaw: 0.05,
    shells: [
      { A: [9.3, -3.7], B: [11.25, 1.7], wF: -2.5, d: 7.5 },
      { A: [7.4, -0.2], B: [9.15, 5.3], wF: 0.95, d: 7.5 },
      { A: [5.4, 3.3], B: [6.85, 8.7], wF: 4.25, d: 8.0 },
      { A: [9.5, -2.9], B: [6.5, -8.6], wF: -3.75, d: 7.9 },
    ],
  },
  {
    name: 'opera', x: -4.6, z: 1.8, yaw: -0.05,
    shells: [
      { A: [8.8, -3.5], B: [10.65, 1.5], wF: -2.4, d: 7.9 },
      { A: [7.0, -0.2], B: [8.65, 4.95], wF: 0.9, d: 7.9 },
      { A: [5.1, 3.1], B: [6.55, 8.2], wF: 4.0, d: 8.4 },
      { A: [9.0, -2.8], B: [6.2, -8.2], wF: -3.6, d: 8.3 },
    ],
  },
  {
    name: 'restaurant', x: 9.05, z: -10.05, yaw: 0.05, base: OP_TOP - 0.45,
    shells: [
      { A: [5.0, -1.5], B: [6.05, 1.35], wF: -0.85, d: 9.6 },
      { A: [3.95, -0.1], B: [4.6, 2.75], wF: 0.45, d: 10.0 },
      { A: [5.2, -1.05], B: [3.85, -3.15], wF: -1.15, d: 10.1 },
    ],
  },
];

// The geometry of one half shell in hall coordinates, for u > 0, with its sphere's centre at u < 0.
function opSolve(spec, base) {
  const { A, B, d, wF } = spec;
  const rho = Math.sqrt(OP_R * OP_R - d * d);
  const my = (A[0] + B[0]) / 2; const mw = (A[1] + B[1]) / 2;
  const dy = B[0] - A[0]; const dw = B[1] - A[1];
  const L = Math.hypot(dy, dw);
  const h = Math.sqrt(rho * rho - (L * L) / 4);
  let ny = -dw / L; let nw = dy / L;
  if (ny > 0) { ny = -ny; nw = -nw; }
  const yc = my + h * ny; const wc = mw + h * nw;
  const yF = base - 0.2;
  const uF = -d + Math.sqrt(OP_R * OP_R - (yF - yc) ** 2 - (wF - wc) ** 2);
  const C = [-d, yc, wc];
  const unit = (p) => norm(sub(p, C));
  const uFoot = unit([uF, yF, wF]);
  const aA = Math.atan2(A[1] - wc, A[0] - yc);
  let aB = Math.atan2(B[1] - wc, B[0] - yc);
  if (Math.abs(aB - aA) > Math.PI) aB += aB < aA ? Math.PI * 2 : -Math.PI * 2;
  // Unit direction to the ridge at s, then the great circle from the foot to it.
  const ridgeDir = (s) => {
    const a = mix(aA, aB, s);
    return unit([0, yc + Math.cos(a) * rho, wc + Math.sin(a) * rho]);
  };
  const dirAt = (s, t) => {
    const r = ridgeDir(s);
    const om = Math.acos(clamp(dot(uFoot, r), -1, 1));
    const so = Math.sin(om) || 1;
    const a = Math.sin((1 - t) * om) / so; const b = Math.sin(t * om) / so;
    return norm([uFoot[0] * a + r[0] * b, uFoot[1] * a + r[1] * b, uFoot[2] * a + r[2] * b]);
  };
  return { C, dirAt, ridgeLen: rho * Math.abs(aB - aA), uF };
}

// A closed half shell: outer sphere, inner sphere, and rims. The outer normal is the radius itself,
// which is exact, so the shading has no faceting to give the sphere away.
function opHalfShell(sol, { ns, nt, th }) {
  const { C, dirAt } = sol;
  const pos = []; const nrm = []; const uv = []; const idx = [];
  const lids = Math.max(4, Math.round(sol.ridgeLen / 0.72)); // two lids to a tile
  const om = OP_R; // arc length is radius times angle, near enough for a tile
  for (let j = 0; j <= nt; j += 1) {
    for (let i = 0; i <= ns; i += 1) {
      const s = i / ns; const t = j / nt;
      const d = dirAt(s, t);
      pos.push(C[0] + d[0] * OP_R, C[1] + d[1] * OP_R, C[2] + d[2] * OP_R);
      nrm.push(d[0], d[1], d[2]);
      // Length up the rib, measured from the foot: the tile narrows toward it exactly as the real
      // tile lids do, because the lids run along the ribs and the ribs fan out of the foot.
      const arc = Math.acos(clamp(dot(dirAt(s, 0), d), -1, 1)) * om;
      uv.push(s * lids, arc / 1.45);
    }
  }
  const row = ns + 1;
  for (let j = 0; j < nt; j += 1) {
    for (let i = 0; i < ns; i += 1) {
      const a = j * row + i; const b = a + 1; const c = a + row; const e = c + 1;
      idx.push(a, b, e, a, e, c);
    }
  }
  // Which way that winding came out depends on the ridge's direction, so measure it against the radius.
  {
    const p = (k) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
    const m = Math.floor(nt / 2) * row + Math.floor(ns / 2);
    const f = cross(sub(p(m + 1), p(m)), sub(p(m + row + 1), p(m)));
    const n = [nrm[m * 3], nrm[m * 3 + 1], nrm[m * 3 + 2]];
    if (dot(f, n) < 0) for (let k = 0; k < idx.length; k += 3) { const q = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = q; }
  }
  const outer = new THREE.BufferGeometry();
  outer.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  outer.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  outer.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  outer.setIndex(idx);

  // The inner sheet and the rim are the shell's thickness: smooth concrete, at a lower resolution
  // since all that can be seen of them is a band just inside each mouth.
  const rimSoup = new Soup();
  const WHITE = [1, 1, 1];
  const rIn = OP_R - th;
  const P = (s, t, r) => { const d = dirAt(s, t); return [C[0] + d[0] * r, C[1] + d[1] * r, C[2] + d[2] * r]; };
  const NS2 = Math.max(6, Math.round(ns / 2)); const NT2 = Math.max(4, Math.round(nt / 2));
  for (let i = 0; i < NS2; i += 1) {
    for (let j = 0; j < NT2; j += 1) {
      const s0 = i / NS2; const s1 = (i + 1) / NS2; const t0 = j / NT2; const t1 = (j + 1) / NT2;
      const d = dirAt((s0 + s1) / 2, (t0 + t1) / 2);
      rimSoup.face([P(s0, t0, rIn), P(s1, t0, rIn), P(s1, t1, rIn), P(s0, t1, rIn)], WHITE, [-d[0], -d[1], -d[2]], { uv: [[0, 0], [0, 0], [0, 0], [0, 0]] });
    }
  }
  const midEdge = (s) => P(s, 0.5, OP_R);
  const centre = P(0.5, 0.5, OP_R);
  for (const s of [0, 1]) {
    for (let j = 0; j < nt; j += 1) {
      const t0 = j / nt; const t1 = (j + 1) / nt;
      rimSoup.face([P(s, t0, OP_R), P(s, t1, OP_R), P(s, t1, rIn), P(s, t0, rIn)], WHITE, sub(midEdge(s), centre), { uv: [[0, 0], [0, 0], [0, 0], [0, 0]] });
    }
  }
  for (let i = 0; i < ns; i += 1) {
    const s0 = i / ns; const s1 = (i + 1) / ns;
    rimSoup.face([P(s0, 1, OP_R), P(s1, 1, OP_R), P(s1, 1, rIn), P(s0, 1, rIn)], WHITE, [1, 0.01, 0], { uv: [[0, 0], [0, 0], [0, 0], [0, 0]] });
  }
  return { outer, rim: rimSoup.geometry() };
}

// Measures the card's claim. Every vertex of every shell's outer surface is compared with its own
// sphere: the same radius for all of them. Returned so that a check script can state it.
export function operaShellReport() {
  let worst = 0; let count = 0; let shells = 0;
  for (const hall of OP_HALLS) {
    for (const spec of hall.shells) {
      const sol = opSolve(spec, hall.base ?? OP_TOP);
      const { outer } = opHalfShell(sol, { ns: 30, nt: 16, th: 0.2 });
      const p = outer.attributes.position;
      for (let i = 0; i < p.count; i += 1) {
        const e = Math.abs(Math.hypot(p.getX(i) - sol.C[0], p.getY(i) - sol.C[1], p.getZ(i) - sol.C[2]) - OP_R);
        if (e > worst) worst = e;
        count += 1;
      }
      shells += 2;
    }
  }
  return { radiusFeet: OP_R, shells, vertices: count, worstErrorFeet: worst };
}

function opChevronTile() {
  // One tile is two lids. Each lid is glossy white chevrons in a matte cream border, which is what
  // the real roof is: a million tiles, in two finishes, set in herringbone on each rib's tile lid.
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#e7dcc4';
    ctx.fillRect(0, 0, w, h);
    const lids = 2; const rows = 16;
    const lw = w / lids; const rh = h / rows;
    for (let l = 0; l < lids; l += 1) {
      const x0 = l * lw;
      const border = lw * 0.11;
      const cx = x0 + lw / 2;
      ctx.fillStyle = '#f5f0e3';
      ctx.fillRect(x0 + border, 0, lw - border * 2, h);
      for (let r = -1; r <= rows; r += 1) {
        const y = r * rh;
        for (let k = 0; k < 2; k += 1) {
          const yy = y + (k * rh) / 2;
          const tone = k ? '#faf7ef' : '#efe8d8';
          ctx.fillStyle = tone;
          ctx.beginPath();
          ctx.moveTo(x0 + border, yy + rh * 0.42);
          ctx.lineTo(cx, yy);
          ctx.lineTo(x0 + lw - border, yy + rh * 0.42);
          ctx.lineTo(x0 + lw - border, yy + rh * 0.42 + rh / 2);
          ctx.lineTo(cx, yy + rh / 2);
          ctx.lineTo(x0 + border, yy + rh * 0.42 + rh / 2);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.strokeStyle = 'rgba(150,136,108,0.5)';
      ctx.lineWidth = 2;
      for (let r = -1; r <= rows * 2; r += 1) {
        const yy = (r * rh) / 2;
        ctx.beginPath();
        ctx.moveTo(x0 + border, yy + rh * 0.42);
        ctx.lineTo(cx, yy);
        ctx.lineTo(x0 + lw - border, yy + rh * 0.42);
        ctx.stroke();
      }
      // The cream borders, and the dark joint between one lid and the next.
      ctx.fillStyle = '#d9cdb1';
      ctx.fillRect(x0, 0, border, h);
      ctx.fillRect(x0 + lw - border, 0, border, h);
      ctx.fillStyle = 'rgba(88,76,58,0.75)';
      ctx.fillRect(x0 - 3, 0, 6, h);
    }
    ctx.fillStyle = 'rgba(88,76,58,0.75)';
    ctx.fillRect(w - 3, 0, 6, h);
    // Corner texel, which the rims and the inner sheet read: plain concrete cream.
    ctx.fillStyle = '#d9cdb1';
    ctx.fillRect(0, h - 3, 6, 3);
  });
}

function sydneyOperaHouse() {
  const rng = seededRandom(1973);
  const shellParts = [];
  const glass = new Soup();
  const pod = new Soup();
  const thick = 0.22;
  const hallMatrix = (hall) => new THREE.Matrix4().makeTranslation(hall.x, 0, hall.z + OP_SHIFT_Z).multiply(new THREE.Matrix4().makeRotationY(hall.yaw));
  
  for (const hall of OP_HALLS) {
    const M = hallMatrix(hall);
    const base = hall.base ?? OP_TOP;
    const big = hall.name !== 'restaurant';
    const sols = [];
    for (const spec of hall.shells) {
      const sol = opSolve(spec, base);
      const { outer, rim } = opHalfShell(sol, { ns: big ? 30 : 20, nt: big ? 16 : 12, th: big ? thick : thick * 0.75 });
      for (const flip of [false, true]) {
        for (const [geo, isRim] of [[outer, false], [rim, true]]) {
          let g;
          if (flip) {
            g = isRim ? rim.clone() : outer.clone();
            const P = g.attributes.position; const N = g.attributes.normal;
            for (let i = 0; i < P.count; i += 1) { P.setX(i, -P.getX(i)); N.setX(i, -N.getX(i)); }
            if (g.index) {
              const idx = g.index;
              for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, a); }
            } else {
              for (const name of ['position', 'normal', 'uv', 'color']) {
                const at = g.attributes[name];
                const k = at.itemSize;
                for (let t = 0; t < at.count; t += 3) {
                  for (let c = 0; c < k; c += 1) {
                    const v = at.array[(t + 1) * k + c];
                    at.array[(t + 1) * k + c] = at.array[(t + 2) * k + c];
                    at.array[(t + 2) * k + c] = v;
                  }
                }
              }
            }
          } else {
            g = geo.clone();
          }
          g.applyMatrix4(M);
          if (isRim) shellParts.push({ geometry: g, keepColor: true });
          else shellParts.push({ geometry: g, color: 0xffffff });
        }
      }
      sols.push({ sol, spec });
      // The glazed ends: dark tinted glass filling each mouth, set back from the rim on the shell's
      // own inner surface. Solid panels by direction, and a horizontal strip per step up the edge,
      // so the sheet follows the arch without any arithmetic of its own.
      const facing = spec.B[1] > spec.A[1] ? 1 : -1;
      for (const [recess, dir] of [[0.87, facing], [0.14, -facing]]) {
        const rG = OP_R - thick + 0.03;
        const n = 12;
        const at = (t) => { const d = sol.dirAt(recess, t); return [sol.C[0] + d[0] * rG, sol.C[1] + d[1] * rG, sol.C[2] + d[2] * rG]; };
        const world = (p, s) => { const v = new THREE.Vector3(s * p[0], p[1], p[2]).applyMatrix4(M); return [v.x, v.y, v.z]; };
        const hint = (() => { const a = new THREE.Vector3(0, 0.05, dir).transformDirection(M); return [a.x, a.y, a.z]; })();
        for (let k = 0; k < n; k += 1) {
          const t0 = k / n; const t1 = (k + 1) / n;
          const a = at(t0); const b = at(t1);
          const q = [world(a, 1), world(a, -1), world(b, -1), world(b, 1)];
          const uvs = [[a[0] * 1.1, a[1] * 0.9], [-a[0] * 1.1, a[1] * 0.9], [-b[0] * 1.1, b[1] * 0.9], [b[0] * 1.1, b[1] * 0.9]];
          const lift = (v) => { const k = mix(0.5, 1, sstep(v, base, base + 6)); return [k, k, k]; };
          glass.face(q, [lift(a[1]), lift(a[1]), lift(b[1]), lift(b[1])], hint, { uv: uvs });
        }
      }
    }
    // The V between two neighbouring shells is glazed down at the podium, seen from the side. Its
    // outline is the two edges up to where they cross in elevation, each read off its own sphere.
    const order = [...sols].sort((a, b) => a.spec.wF - b.spec.wF);
    for (let i = 0; i < order.length - 1; i += 1) {
      const S0 = order[i]; const S1 = order[i + 1];
      const s0 = S0.spec.B[1] > S0.spec.A[1] ? 1 : 0; // the edge of the southern shell that faces north
      const s1 = S1.spec.B[1] > S1.spec.A[1] ? 0 : 1;
      const r = OP_R - thick - 0.02;
      const edgeAt = (S, sv, t) => { const d = S.sol.dirAt(sv, t); return [S.sol.C[0] + d[0] * r, S.sol.C[1] + d[1] * r, S.sol.C[2] + d[2] * r]; };
      let best = null;
      for (let a = 1; a <= 30; a += 1) {
        for (let b = 1; b <= 30; b += 1) {
          const p = edgeAt(S0, s0, a / 30); const q = edgeAt(S1, s1, b / 30);
          const dd = Math.hypot(p[1] - q[1], p[2] - q[2]);
          if (!best || dd < best.dd) best = { dd, a: a / 30, b: b / 30 };
        }
      }
      for (const side of [-1, 1]) {
        const w = (p) => { const v = new THREE.Vector3(side * p[0], p[1], p[2]).applyMatrix4(M); return [v.x, v.y, v.z]; };
        const hint = (() => { const a = new THREE.Vector3(side, 0.15, 0).transformDirection(M); return [a.x, a.y, a.z]; })();
        // A flat sheet set back behind both edges: following the two edges' own u, the panes fold along
        // every triangle and the mullions read as cracks.
        const uPlane = Math.min(edgeAt(S0, s0, best.a)[0], edgeAt(S1, s1, best.b)[0]) - 0.03;
        const n = 8;
        for (let k = 0; k < n; k += 1) {
          const flat = (q) => [uPlane, q[1], q[2]];
          const p0 = flat(edgeAt(S0, s0, (k / n) * best.a)); const p1 = flat(edgeAt(S0, s0, ((k + 1) / n) * best.a));
          const q0 = flat(edgeAt(S1, s1, (k / n) * best.b)); const q1 = flat(edgeAt(S1, s1, ((k + 1) / n) * best.b));
          const pts = [w(p0), w(q0), w(q1), w(p1)];
          const uvs = [p0, q0, q1, p1].map((v) => [v[2] * 1.1, v[1] * 0.9]);
          const c = [0.7, 0.7, 0.7];
          glass.face(pts, [c, c, c, c], hint, { uv: uvs });
        }
      }
    }
  }

  // --- the podium -------------------------------------------------------------------------------------
  const Z = OP_SHIFT_Z;
  const tan = lin(0xc4a483); const tanLo = lin(0xa58969); const tanHi = lin(0xd2b89a);
  const planTop = [ // going round, counter-clockwise seen from above in (x, z), +X side first
    [11.6, -11.6], [11.6, 2.6], [11.0, 6.5], [9.6, 9.6], [7.2, 11.2], [3.4, 11.9], [0, 12.1], [-3.4, 11.9], [-7.2, 11.2], [-9.6, 9.6], [-11.0, 6.5], [-11.6, 2.6], [-11.6, -11.6],
  ].map(([x, z]) => [x, z + Z]);
  // Moves a closed plan outward by `o` along each corner's mitre.
  const offsetPlan = (plan, o) => plan.map((p, i) => {
    const a = plan[(i + plan.length - 1) % plan.length]; const b = plan[(i + 1) % plan.length];
    const n1 = norm([p[1] - a[1], 0, a[0] - p[0]]); const n2 = norm([b[1] - p[1], 0, p[0] - b[0]]);
    const m = norm(add(n1, n2));
    const k = 1 / Math.max(0.5, dot(m, n1));
    return [p[0] + m[0] * o * k, p[1] + m[2] * o * k];
  });
  const ringWall = (plan, y0, y1, col, skipSouth = false) => {
    for (let i = 0; i < plan.length; i += 1) {
      const a = plan[i]; const b = plan[(i + 1) % plan.length];
      if (skipSouth && i === plan.length - 1) continue;
      const out = [(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2 - Z];
      const L = Math.hypot(a[0] - b[0], a[1] - b[1]);
      pod.face([[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], col, out, { uv: [[0, y0], [L, y0], [L, y1], [0, y1]] });
    }
  };
  const ringFlat = (inner, outer, y, col, skipSouth = false) => {
    for (let i = 0; i < inner.length; i += 1) {
      const j = (i + 1) % inner.length;
      if (skipSouth && i === inner.length - 1) continue;
      pod.face([[inner[i][0], y, inner[i][1]], [inner[j][0], y, inner[j][1]], [outer[j][0], y, outer[j][1]], [outer[i][0], y, outer[i][1]]], col, [0, 1, 0]);
    }
  };
  // Top surface, as a fan from the middle: the plan is convex.
  const centre = [0, 0 + Z];
  for (let i = 0; i < planTop.length; i += 1) {
    const a = planTop[i]; const b = planTop[(i + 1) % planTop.length];
    pod.face([[centre[0], OP_TOP, centre[1]], [a[0], OP_TOP, a[1]], [b[0], OP_TOP, b[1]]], tanHi, [0, 1, 0]);
  }
  // Steps down round the harbour side of the top, then the great folded wall, then a broad walk at
  // the water. The south side belongs to the grand stair and is left out of every ring.
  const STEP = 0.11; const RISE = 0.055;
  let cur = planTop; let y = OP_TOP;
  for (let i = 0; i < 6; i += 1) {
    const next = offsetPlan(planTop, STEP * (i + 1));
    ringWall(cur, y - RISE, y, tan, true);
    ringFlat(cur, next, y - RISE, i % 2 ? tanHi : mix3(tanHi, tan, 0.5), true);
    cur = next; y -= RISE;
  }
  const yWalk = OP_WATER + 0.42;
  // The podium's wall carries the great folded beams' rhythm: ribs at a real structural module.
  ringWall(cur, yWalk, y, tanLo, true);
  const walkOuter = offsetPlan(cur, 1.5);
  ringFlat(cur, walkOuter, yWalk, tan, true);
  ringWall(walkOuter, OP_WATER - 0.2, yWalk, lin(0x8f7558), true);
  for (let i = 0; i < cur.length - 1; i += 1) {
    const a = cur[i]; const b = cur[i + 1];
    const L = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const n = Math.max(1, Math.round(L / 0.86));
    const nx = (b[1] - a[1]) / L; const nz = (a[0] - b[0]) / L;
    const sign = dot([nx, 0, nz], [a[0] + b[0], 0, a[1] + b[1] - 2 * Z]) > 0 ? 1 : -1;
    for (let k = 0; k < n; k += 1) {
      const t = (k + 0.5) / n;
      const x = mix(a[0], b[0], t); const z = mix(a[1], b[1], t);
      const ox = nx * sign; const oz = nz * sign;
      const w = 0.13; const tx = -oz * w; const tz = ox * w;
      const d = 0.12;
      pod.hexa(
        [[x - tx, yWalk, z - tz], [x + tx, yWalk, z + tz], [x + tx + ox * d, yWalk, z + tz + oz * d], [x - tx + ox * d, yWalk, z - tz + oz * d]],
        [[x - tx, y - 0.02, z - tz], [x + tx, y - 0.02, z + tz], [x + tx + ox * 0.02, y - 0.02, z + tz + oz * 0.02], [x - tx + ox * 0.02, y - 0.02, z - tz + oz * 0.02]],
        tan,
        { skipBottom: true },
      );
    }
  }

  // --- the grand stair ----------------------------------------------------------------------------------
  // Monumental: about 97m across in life, one of the largest exterior stairs in the world, so 16ft
  // here. It lands the visitor on the forecourt side, facing the shells' backs.
  const zTopS = -11.6 + Z;
  const xS0 = -11.6; const xS1 = 5.7;
  const STEPS = 34;
  const treadZ = 0.112; const stepY = (OP_TOP - yWalk) / STEPS;
  let zS = zTopS;
  const landingAt = 17;
  for (let i = 0; i < STEPS; i += 1) {
    const yTop = OP_TOP - i * stepY;
    const land = i === landingAt ? 0.75 : 0;
    const zNext = zS - treadZ - land;
    pod.box(xS0, yWalk - 0.3, zNext, xS1, yTop, zS, i % 2 ? tanHi : mix3(tanHi, tan, 0.4));
    zS = zNext;
  }
  const zBottom = zS;
  // Everything west of the stair is the terrace the restaurant sits on: a solid mass to the south wall.
  pod.box(xS1, yWalk - 0.3, zBottom, 11.6, OP_TOP - 0.45, zTopS, tan);
  pod.box(xS1, yWalk - 0.3, zBottom, xS1 + 0.3, OP_TOP + 0.06, zTopS, tanHi);
  // The restaurant's terrace is lower than the podium, so a low wall closes the step between them.
  pod.box(xS1 + 0.3, OP_TOP - 0.45, zTopS - 0.02, 11.6, OP_TOP, zTopS + 0.02, tan);
  for (let i = 0; i < 16; i += 1) {
    const x = mix(xS1 + 0.6, 11.3, i / 15);
    pod.box(x - 0.1, yWalk, zBottom - 0.06, x + 0.1, OP_TOP - 0.5, zBottom, tanLo);
  }
  pod.box(-11.72, yWalk - 0.3, zBottom, -11.6, OP_TOP + 0.06, zTopS, tanLo);
  // The east wall of the stair runs to the walk, and the west terrace wall too.
  pod.box(11.6, yWalk - 0.3, zBottom, 11.72, OP_TOP - 0.42, zTopS, tanLo);

  // --- land to the south, harbour all round ---------------------------------------------------------------
  const BX = 14.6; const BZ0 = -18.9 + Z; const BZ1 = 16.9 + Z - 1.6;
  const BASE_TOP = 0.16;
  const paving = lin(0xb5a68f);
  const yLand = yWalk - 0.03;
  const zLand = zBottom + 0.05;
  pod.box(-BX, BASE_TOP, BZ0, BX, yLand, zLand, paving);
  // Gardens on the east side, with the sea wall of Farm Cove below them.
  const grassParts = [];
  {
    const n = 26; const m = 14;
    const pos = []; const col = []; const idx = []; const uv = [];
    const x0 = -BX; const x1 = -6.2; const z0 = BZ0; const z1 = zLand;
    const hAt = (x, z) => yLand + 0.02 + 0.5 * sstep(x1 - 0.2 - x, 0.2, 6) * sstep(z1 - 0.2 - z, 0.0, 1.8) * (0.7 + fbm(x * 0.4, z * 0.4, 3.3, 2) * 0.6);
    for (let j = 0; j <= m; j += 1) {
      for (let i = 0; i <= n; i += 1) {
        const x = mix(x0, x1, i / n); const z = mix(z0, z1, j / m);
        pos.push(x, hAt(x, z), z);
        const c = mix3(lin(0x4d8a3a), lin(0x71a84a), fbm(x * 0.7, z * 0.7, 5.3, 3));
        col.push(c[0], c[1], c[2]);
        uv.push(x, z);
      }
    }
    for (let j = 0; j < m; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const a = j * (n + 1) + i; const b = a + 1; const c = a + n + 1; const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    grassParts.push({ geometry: g, keepColor: true });
    for (let i = 0; i < 40; i += 1) {
      const x = mix(-BX + 0.5, -7.2, rng()); const z = mix(BZ0 + 0.4, z1 - 0.3, rng());
      const r = 0.34 + rng() * 0.3;
      const ico = new THREE.IcosahedronGeometry(1, 1);
      ico.scale(r, r * (1 + rng() * 0.4), r);
      ico.translate(x, hAt(x, z) + 0.45 + r * 0.8, z);
      const c = mix3(lin(0x2a5a2c), lin(0x47803a), rng());
      grassParts.push({ geometry: ico, tint: () => c, keepColor: true });
      const tr = tube([[x, hAt(x, z) - 0.05, z], [x, hAt(x, z) + 0.7, z]], 0.05, { sides: 5, steps: 1, round: 0, straight: true });
      grassParts.push({ geometry: tr, color: 0x4f3a2a });
    }
  }
  // The plinth.
  pod.box(-BX - 0.05, 0, BZ0 - 0.05, BX + 0.05, BASE_TOP, BZ1 + 0.05, lin(0x2e3338));
  // A pair of yachts, for scale: 40ft is 2ft here.
  const sailboat = (x, z, flip) => {
    const y = OP_WATER;
    const hull = [0.82, 0.82, 0.8]; const sail = [0.9, 0.9, 0.86];
    pod.hexa([[x - 0.75, y, z - 0.16], [x + 0.9, y, z], [x - 0.75, y, z + 0.16], [x - 0.75, y, z]], [[x - 0.85, y + 0.2, z - 0.22], [x + 1.05, y + 0.2, z], [x - 0.85, y + 0.2, z + 0.22], [x - 0.85, y + 0.2, z]], hull);
    pod.bar([x, y + 0.2, z], [x, y + 2.7, z], 0.02, [0, 0, 1], [0.25, 0.25, 0.27]);
    pod.face([[x + 0.03, y + 0.42, z + 0.01], [x + 0.03 + 0.95 * flip, y + 0.42, z + 0.12], [x + 0.03, y + 2.65, z + 0.01]], sail, [0, 0, 1]);
    pod.face([[x + 0.03, y + 0.42, z - 0.01], [x + 0.03 + 0.95 * flip, y + 0.42, z + 0.1], [x + 0.03, y + 2.65, z - 0.01]], sail, [0, 0, -1]);
  };
  sailboat(13.4, 8, -1);
  sailboat(-13.6, 3.5, 1);

  // --- water --------------------------------------------------------------------------------------------
  const wx = 34; const wz = 42;
  const wPos = []; const wCol = []; const wUv = []; const wIdx = []; const wNrm = [];
  const deep = lin(0x1e6ea8); const mid = lin(0x2f8fbc); const shore = lin(0x5eb6bc);
  const distPod = (x, z) => {
    const ex = Math.abs(x) - 13.2; const ez = Math.max(z - (12.1 + Z + 1.6), -(z - zLand));
    return Math.max(Math.max(ex, 0), Math.max(ez, 0));
  };
  for (let j = 0; j <= wz; j += 1) {
    const z = mix(BZ0, BZ1, j / wz);
    for (let i = 0; i <= wx; i += 1) {
      const x = mix(-BX, BX, i / wx);
      wPos.push(x, OP_WATER, z);
      wNrm.push(0, 1, 0);
      const c = mix3(deep, mid, fbm(x * 0.3, z * 0.3, 11.3, 3));
      mixInto3(c, shore, (1 - sstep(distPod(x, z), 0.0, 1.0)) * 0.55);
      wCol.push(c[0], c[1], c[2]);
      wUv.push(x / 3.2, z / 3.2);
    }
  }
  for (let j = 0; j < wz; j += 1) {
    for (let i = 0; i < wx; i += 1) {
      const a = j * (wx + 1) + i; const b = a + 1; const c = a + wx + 1; const d = c + 1;
      wIdx.push(a, c, b, b, c, d);
    }
  }
  const water = new THREE.BufferGeometry();
  water.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
  water.setAttribute('normal', new THREE.Float32BufferAttribute(wNrm, 3));
  water.setAttribute('color', new THREE.Float32BufferAttribute(wCol, 3));
  water.setAttribute('uv', new THREE.Float32BufferAttribute(wUv, 2));
  water.setIndex(wIdx);
  const edgeC = lin(0x124a78);
  for (const s of [-1, 1]) pod.face([[s * BX, BASE_TOP, zLand], [s * BX, BASE_TOP, BZ1], [s * BX, OP_WATER - 0.002, BZ1], [s * BX, OP_WATER - 0.002, zLand]], edgeC, [s, 0, 0]);
  pod.face([[-BX, BASE_TOP, BZ1], [BX, BASE_TOP, BZ1], [BX, OP_WATER - 0.002, BZ1], [-BX, OP_WATER - 0.002, BZ1]], edgeC, [0, 0, 1]);

  // --- materials -----------------------------------------------------------------------------------------
  const chevron = opChevronTile();
  chevron.wrapS = THREE.RepeatWrapping;
  chevron.wrapT = THREE.RepeatWrapping;
  const bump = opChevronTile();
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.colorSpace = THREE.NoColorSpace;
  const shells = mesh(mergeParts(shellParts), standard({ vertexColors: true, map: chevron, bumpMap: bump, bumpScale: 0.35, roughness: 0.42, metalness: 0 }));

  const glassTile = canvasTexture(256, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#6e5a44'); g.addColorStop(1, '#7c6449');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c0a578';
    ctx.fillRect(0, 0, 7, h);
    ctx.fillRect(w / 2, 0, 5, h);
    ctx.fillRect(0, 0, w, 5);
    ctx.fillRect(0, h / 2, w, 3);
  });
  glassTile.wrapS = THREE.RepeatWrapping;
  glassTile.wrapT = THREE.RepeatWrapping;
  const glassMesh = mesh(glass.geometry(), standard({ vertexColors: true, map: glassTile, roughness: 0.22, metalness: 0.3, side: THREE.DoubleSide }));

  // Pink granite aggregate, in big slabs with a dark joint, which is what stops a broad flat
  // terrace reading as a sheet of card.
  const aggregate = (() => {
    const r2 = seededRandom(9);
    return canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#e3e0da';
      ctx.fillRect(0, 0, w, h);
      for (let j = 0; j < 4; j += 1) {
        for (let i = 0; i < 4; i += 1) {
          const v = 228 + r2() * 20;
          ctx.fillStyle = `rgb(${v},${v * 0.985},${v * 0.96})`;
          ctx.fillRect((i * w) / 4, (j * h) / 4, w / 4, h / 4);
        }
      }
      for (let i = 0; i < 3800; i += 1) {
        const v = 130 + r2() * 125;
        ctx.fillStyle = `rgba(${v},${v * 0.92},${v * 0.86},${0.2 + r2() * 0.4})`;
        ctx.fillRect(r2() * w, r2() * h, 1.5, 1.5);
      }
      ctx.fillStyle = 'rgba(90,74,60,0.42)';
      for (let i = 0; i < 4; i += 1) {
        ctx.fillRect((i * w) / 4, 0, 3, h);
        ctx.fillRect(0, (i * h) / 4, w, 3);
      }
    });
  })();
  repeatFeet(aggregate, 3.6);
  const podium = mesh(pod.geometry(), standard({ vertexColors: true, map: aggregate, bumpMap: aggregate, bumpScale: 0.4, roughness: 0.9, metalness: 0 }));
  const lawn = grassTile(10);
  repeatFeet(lawn, 1.6);
  const gardens = mesh(mergeParts(grassParts), standard({ vertexColors: true, map: lawn, roughness: 0.95, metalness: 0 }));

  const ripple = rippleTile(1788);
  const waterMesh = mesh(water, standard({ vertexColors: true, map: ripple, bumpMap: ripple, bumpScale: 0.25, roughness: 0.42, metalness: 0 }));
  waterMesh.castShadow = false;
  return group(shells, glassMesh, podium, gardens, waterMesh);
}

// ---------------------------------------------------------------------------
// Worked timber, shared by the potter's wheel and the drum kit's hoops
// ---------------------------------------------------------------------------

// A squared timber, authored along Z: 4 or 8 flat sides, end grain darker than the faces. UVs are in
// tile units with the grain running along the length, and each piece starts somewhere different.
function beamGeo(len, w, h, { chamfer = 0, tile = [1, 2], color, rng = null, capShade = 0.6, jitter = 0.07 }) {
  const hw = w / 2; const hh = h / 2;
  const c = Math.min(chamfer, hw * 0.9, hh * 0.9);
  const outline = c > 0
    ? [[hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c], [-hw + c, -hh], [hw - c, -hh]]
    : [[hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]];
  const u0 = rng ? rng() : 0; const v0 = rng ? rng() : 0;
  const k = rng ? 1 + (rng() - 0.5) * jitter * 2 : 1;
  const base = new THREE.Color(color);
  const side = [base.r * k, base.g * k, base.b * k];
  const cap = [side[0] * capShade, side[1] * capShade, side[2] * capShade];
  const pos = []; const nor = []; const uvs = []; const col = [];
  const tri = (a, b, cc, n, tone, uvA, uvB, uvC) => {
    pos.push(...a, ...b, ...cc);
    nor.push(...n, ...n, ...n);
    uvs.push(...uvA, ...uvB, ...uvC);
    for (let i = 0; i < 3; i += 1) col.push(...tone);
  };
  const z0 = -len / 2; const z1 = len / 2;
  let run = u0 * tile[0];
  for (let i = 0; i < outline.length; i += 1) {
    const [ax, ay] = outline[i];
    const [bx, by] = outline[(i + 1) % outline.length];
    const seg = Math.hypot(bx - ax, by - ay);
    const n = [(by - ay) / seg, -(bx - ax) / seg, 0];
    const ua = run / tile[0]; const ub = (run + seg) / tile[0];
    const va = v0 + z0 / tile[1]; const vb = v0 + z1 / tile[1];
    tri([ax, ay, z0], [bx, by, z0], [bx, by, z1], n, side, [ua, va], [ub, va], [ub, vb]);
    tri([ax, ay, z0], [bx, by, z1], [ax, ay, z1], n, side, [ua, va], [ub, vb], [ua, vb]);
    run += seg;
  }
  for (let i = 1; i < outline.length - 1; i += 1) {
    const [ax, ay] = outline[0]; const [bx, by] = outline[i]; const [cx, cy] = outline[i + 1];
    const uv = (x, y) => [u0 + x / tile[0], v0 + y / (tile[0] * 3)];
    tri([ax, ay, z1], [bx, by, z1], [cx, cy, z1], [0, 0, 1], cap, uv(ax, ay), uv(bx, by), uv(cx, cy));
    tri([ax, ay, z0], [cx, cy, z0], [bx, by, z0], [0, 0, -1], cap, uv(ax, ay), uv(cx, cy), uv(bx, by));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

function fromTo(geometry, a, b, up = null) {
  const A = new THREE.Vector3(a[0], a[1], a[2]);
  const B = new THREE.Vector3(b[0], b[1], b[2]);
  const z = B.clone().sub(A).normalize();
  let ref = up ? new THREE.Vector3(up[0], up[1], up[2]).normalize() : new THREE.Vector3(0, 1, 0);
  if (Math.abs(ref.dot(z)) > 0.985) ref = Math.abs(z.z) > 0.7 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const x = new THREE.Vector3().crossVectors(ref, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(A.add(B).multiplyScalar(0.5));
  return geometry.applyMatrix4(m);
}

function timber(list, color, a, b, w, h, opts = {}) {
  const len = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  if (len < 1e-4) return;
  const g = beamGeo(len, w, h, { color, ...opts });
  list.push({ geometry: fromTo(g, a, b, opts.up), keepColor: true });
}

// A near-white tile of long streaks, as both map and bump: it multiplies the vertex colour, so one
// canvas serves every wood in a model. A texel of 150 is 30% of the colour in linear, not 59%.
function grainMaps({ seed = 3, knots = 3, strength = 0.5, width = 256, height = 512, streaks = 150 } = {}) {
  const rng = seededRandom(seed);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f6f3ee';
  ctx.fillRect(0, 0, width, height);
  const wrapX = (draw) => { for (const dx of [-width, 0, width]) draw(dx); };
  for (let i = 0; i < 26; i += 1) {
    const x = rng() * width;
    const w = 6 + rng() * 34;
    const shade = 214 + Math.round(rng() * 34);
    ctx.fillStyle = `rgba(${shade},${shade - 8},${shade - 18},0.42)`;
    wrapX((dx) => ctx.fillRect(x + dx, 0, w, height));
  }
  for (let i = 0; i < streaks; i += 1) {
    const x = rng() * width;
    const amp = 1 + rng() * 5;
    const cycles = 1 + Math.floor(rng() * 3);
    const phase = rng() * Math.PI * 2;
    const dark = 150 + Math.round(rng() * 70);
    ctx.strokeStyle = `rgba(${dark},${dark - 14},${dark - 30},${0.25 + rng() * 0.5})`;
    ctx.lineWidth = 0.6 + rng() * 1.5;
    wrapX((dx) => {
      ctx.beginPath();
      for (let y = 0; y <= height; y += 16) {
        const px = x + dx + Math.sin((y / height) * Math.PI * 2 * cycles + phase) * amp;
        if (y === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
      }
      ctx.stroke();
    });
  }
  for (let i = 0; i < knots; i += 1) {
    const x = 40 + rng() * (width - 80);
    const y = 50 + rng() * (height - 100);
    for (let r = 10; r > 2; r -= 2.4) {
      const dark = 165 + (13 - r) * -2;
      ctx.strokeStyle = `rgba(${dark},${dark - 22},${dark - 44},0.32)`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.62, r * 1.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const make = (space) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = space;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { map: make(THREE.SRGBColorSpace), bumpMap: make(THREE.NoColorSpace), bumpScale: strength };
}

// Rewrites a turned part's UVs as a plan view in tile units, so its top shows boards rather than a
// pinwheel of grain converging on the axis.
function planUV(g, tile = 1.1) {
  const P = g.attributes.position;
  const U = g.attributes.uv;
  for (let i = 0; i < P.count; i += 1) U.setXY(i, (P.getX(i) + P.getY(i) * 0.4) / tile, (P.getZ(i) + P.getY(i) * 0.3) / (tile * 2));
  return g;
}

// A closed flattened ball, the way a splash of slip or a boss sits on a surface.
function blob(r, flat = 0.4, w = 8, h = 6) {
  const g = new THREE.SphereGeometry(r, w, h);
  g.attributes.uv.array.fill(0);
  g.scale(1, flat, 1);
  return g;
}

// ---------------------------------------------------------------------------
// A potter's kick wheel, life size
// ---------------------------------------------------------------------------

// A wall revolved about the y axis on a grid of its own, because a throwing spiral has to run across
// the rows. Closed in the angle by modulo rather than by a duplicate seam, so nothing can crease there.
function spiralWall(rowsY, radiusAt, { sides = 72, outward: out = true, u = true } = {}) {
  const nr = rowsY.length;
  const pos = []; const uv = []; const idx = [];
  for (let j = 0; j < nr; j += 1) {
    for (let i = 0; i < sides; i += 1) {
      const a = (i / sides) * Math.PI * 2;
      const r = radiusAt(rowsY[j], a);
      pos.push(Math.sin(a) * r, rowsY[j], Math.cos(a) * r);
      if (u) uv.push((i / sides) * 6, rowsY[j] * 6); else uv.push(0, 0);
    }
  }
  for (let j = 0; j < nr - 1; j += 1) {
    for (let i = 0; i < sides; i += 1) {
      const i2 = (i + 1) % sides;
      const a = j * sides + i; const b = j * sides + i2; const c = (j + 1) * sides + i2; const d = (j + 1) * sides + i;
      if (out) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function pottersWheel() {
  const rng = seededRandom(5000);
  const wood = []; const clay = []; const stone = []; const iron = []; const glazed = [];
  const oak = 0x8b6a45; const oakDk = 0x6e5236; const pine = 0x9a805b;
  const grainOpt = { tile: [0.9, 2.6], rng, chamfer: 0.016 };
  const Z0 = 0.35; // the wheel's axis
  const X = 1.32; const ZF = Z0 + 1.02; const ZB = Z0 - 1.02;
  const HEAD_Y = 2.4;

  // --- the floor: wide worn boards -------------------------------------------------------------------
  const FX = 2.9; const FZ0 = -2.55; const FZ1 = 2.3;
  const FN = 11;
  for (let i = 0; i < FN; i += 1) {
    const z0 = mix(FZ0, FZ1, i / FN); const z1 = mix(FZ0, FZ1, (i + 1) / FN);
    timber(wood, i % 3 === 0 ? pine : i % 3 === 1 ? 0x8e7551 : 0xa18a62, [-FX, 0.05, (z0 + z1) / 2], [FX, 0.05, (z0 + z1) / 2], (z1 - z0) - 0.012, 0.1, { tile: [1.2, 4.2], rng, chamfer: 0.012, up: [0, 1, 0], capShade: 0.55 });
  }
  const FLOOR = 0.1;

  // --- the frame -------------------------------------------------------------------------------------
  const post = 0.2;
  for (const x of [-X, X]) {
    for (const z of [ZF, ZB]) timber(wood, oak, [x, FLOOR - 0.02, z], [x, 2.14, z], post, post, grainOpt);
    // Skids along the floor and rails at the top, with a pegged end standing proud.
    timber(wood, oakDk, [x, FLOOR + 0.1, ZB - 0.2], [x, FLOOR + 0.1, ZF + 0.2], 0.22, 0.2, grainOpt);
    timber(wood, oak, [x, 2.02, ZB - 0.18], [x, 2.02, ZF + 0.18], 0.16, 0.2, grainOpt);
    timber(wood, oak, [x, 1.0, ZB], [x, 1.0, ZF], 0.13, 0.16, grainOpt);
  }
  for (const z of [ZF, ZB]) timber(wood, oak, [-X - 0.18, 2.02, z], [X + 0.18, 2.02, z], 0.16, 0.2, grainOpt);
  // The two cross beams that hold the shaft's bearings: one low, one just under the tray.
  timber(wood, oakDk, [-X - 0.1, FLOOR + 0.1, Z0], [X + 0.1, FLOOR + 0.1, Z0], 0.34, 0.2, grainOpt);
  timber(wood, oak, [-X - 0.1, 1.86, Z0], [X + 0.1, 1.86, Z0], 0.2, 0.22, grainOpt);
  // Pegs through the joints.
  for (const x of [-X, X]) {
    for (const z of [ZF, ZB]) {
      for (const y of [2.02, 1.0]) {
        const p = lathe([[0, 0], [0.028, 0], [0.028, 0.03], [0.02, 0.036], [0, 0.036]], 8);
        p.rotateZ(x > 0 ? -Math.PI / 2 : Math.PI / 2);
        p.translate(x + Math.sign(x) * 0.09, y, z);
        wood.push({ geometry: planUV(p), color: 0x62462a });
      }
    }
  }

  // --- the splash tray -------------------------------------------------------------------------------
  const TX = X + 0.26; const TZ0 = ZB - 0.22; const TZ1 = ZF + 0.22;
  const trayY = 2.14;
  const boards = 7;
  for (let i = 0; i < boards; i += 1) {
    const z0 = mix(TZ0, TZ1, i / boards); const z1 = mix(TZ0, TZ1, (i + 1) / boards);
    timber(wood, oak, [-TX, trayY + 0.04, (z0 + z1) / 2], [TX, trayY + 0.04, (z0 + z1) / 2], z1 - z0 - 0.008, 0.08, { tile: [0.9, 3], rng, up: [0, 1, 0] });
  }
  const wallH = 0.28; const wallT = 0.075;
  const trayTop = trayY + 0.08;
  for (const z of [TZ0, TZ1]) timber(wood, oak, [-TX, trayTop + wallH / 2, z], [TX, trayTop + wallH / 2, z], wallT, wallH, { ...grainOpt, up: [0, 1, 0] });
  for (const x of [-TX, TX]) timber(wood, oak, [x, trayTop + wallH / 2, TZ0], [x, trayTop + wallH / 2, TZ1], wallT, wallH, { ...grainOpt, up: [0, 1, 0] });

  // --- the flywheel, the thing the whole machine is about ---------------------------------------------
  const FY0 = FLOOR + 0.2; const FR = 1.14; const FH = 0.34;
  const fly = lathe([
    [0, FY0], [FR - 0.05, FY0], [FR - 0.01, FY0 + 0.03], [FR, FY0 + 0.07], [FR, FY0 + FH - 0.07], [FR - 0.015, FY0 + FH - 0.025], [FR - 0.05, FY0 + FH],
    [FR - 0.2, FY0 + FH + 0.004], [FR - 0.42, FY0 + FH - 0.012], [0.28, FY0 + FH - 0.01], [0.26, FY0 + FH + 0.03], [0.17, FY0 + FH + 0.05], [0, FY0 + FH + 0.05],
  ], 88);
  fly.translate(0, 0, Z0);
  // Cast stone, darkened where a foot has been kicking at it for years, and banded at its rim.
  const stoneC = lin(0x7c776d); const stoneDk = lin(0x4f4941);
  stone.push({
    geometry: fly,
    keepColor: true,
    tint: (p) => {
      const r = Math.hypot(p.x, p.z - Z0);
      const onTop = p.y > FY0 + FH - 0.04;
      const a = Math.atan2(p.x, p.z - Z0);
      const worn = onTop ? sstep(r, 0.55, 0.78) * (1 - sstep(r, 0.98, 1.1)) : 0;
      const n = fbm(p.x * 2.2, p.y * 8, p.z * 2.2, 3);
      const k = 0.82 + n * 0.36;
      const c = mix3(times(stoneC, k), stoneDk, worn * (0.55 + 0.35 * Math.sin(a * 3 + 1)));
      return c;
    },
  });
  // Iron hub, shaft, collars and the thrust bearing on the bottom beam.
  const hub = lathe([[0, FY0 + FH + 0.04], [0.16, FY0 + FH + 0.04], [0.16, FY0 + FH + 0.09], [0.09, FY0 + FH + 0.13], [0.07, FY0 + FH + 0.18], [0, FY0 + FH + 0.18]], 18);
  hub.translate(0, 0, Z0);
  iron.push({ geometry: hub, color: 0x4a4a4c });
  iron.push({ geometry: tube([[0, FLOOR + 0.16, Z0], [0, HEAD_Y, Z0]], 0.058, { sides: 14, steps: 1, round: 1, straight: true }), color: 0x77787c });
  const bearing = (y, r = 0.14) => {
    const g = lathe([[0, y - 0.04], [r, y - 0.04], [r, y + 0.03], [r * 0.72, y + 0.06], [0, y + 0.06]], 16);
    g.translate(0, 0, Z0);
    iron.push({ geometry: g, color: 0x3f3f42 });
    const nuts = 4;
    for (let i = 0; i < nuts; i += 1) {
      const a = (i / nuts) * Math.PI * 2 + 0.4;
      const b = lathe([[0, y], [0.024, y], [0.024, y + 0.05], [0, y + 0.05]], 6);
      b.translate(Math.sin(a) * r * 0.82, 0, Z0 + Math.cos(a) * r * 0.82);
      iron.push({ geometry: b, color: 0x56565a });
    }
  };
  bearing(FLOOR + 0.22);
  bearing(1.99);

  // --- the seat, and the footrest ------------------------------------------------------------------------
  const SEAT = 1.78;
  for (const x of [-X, X]) {
    timber(wood, oak, [x, SEAT - 0.13, ZB + 0.15], [x, SEAT - 0.17, -2.32], 0.13, 0.18, grainOpt);
    timber(wood, oak, [x * 0.72, FLOOR - 0.02, -2.2], [x * 0.72, SEAT - 0.12, -2.2], 0.15, 0.15, grainOpt);
    timber(wood, oakDk, [x, 0.72, ZB], [x * 0.72, 0.7, -2.2], 0.11, 0.13, grainOpt);
  }
  timber(wood, oak, [-X * 0.72, 0.7, -2.2], [X * 0.72, 0.7, -2.2], 0.11, 0.12, grainOpt);
  const seatW = 5;
  for (let i = 0; i < seatW; i += 1) {
    const z0 = mix(-2.42, -1.42, i / seatW); const z1 = mix(-2.42, -1.42, (i + 1) / seatW);
    const zc = (z0 + z1) / 2;
    const y = SEAT + (zc + 1.9) * 0.05;
    timber(wood, 0xab8451, [-1.02, y, zc], [1.02, y + 0.001, zc], z1 - z0 - 0.012, 0.09, { tile: [0.9, 2.6], rng, chamfer: 0.018, up: [(0), 1, -0.05] });
  }
  // The footrest, a worn board bolted across the frame on the left, above the flywheel's rim.
  timber(wood, 0xa58150, [-X - 0.08, 0.74, ZB + 0.5], [-0.55, 0.74, ZB + 0.28], 0.34, 0.07, { ...grainOpt, up: [0, 1, 0] });
  timber(wood, oakDk, [-X, 0.67, ZB + 0.2], [-X, 0.67, ZB + 0.72], 0.14, 0.1, grainOpt);

  // --- the head, with its wet clay ----------------------------------------------------------------------
  const headR = 0.56;
  const headG = lathe([[0, HEAD_Y], [headR - 0.015, HEAD_Y], [headR, HEAD_Y + 0.015], [headR, HEAD_Y + 0.085], [headR - 0.012, HEAD_Y + 0.1], [0, HEAD_Y + 0.1]], 64);
  headG.translate(0, 0, Z0);
  wood.push({ geometry: planUV(headG), keepColor: true, tint: (p) => { const r = Math.hypot(p.x, p.z - Z0); return mix3(lin(0x8a6a44), lin(0x93674a), sstep(r, 0.3, 0.5)); } });
  const HY = HEAD_Y + 0.1;
  const CLAY = lin(0x98583a); const CLAY_WET = lin(0x6e3c26); const SLIP = lin(0xb88560);

  // THE POT, in the middle of being pulled: thick at the foot, a tall collared cylinder with a fat
  // rolled lip. The throwing marks are a true spiral, one line running from the foot to the lip as
  // the wheel turned under the potter's fingers, so they are a phase in the radius rather than rings.
  const potH = 0.98;
  const profile = pchip([[0, 0.5], [0.05, 0.47], [0.14, 0.43], [0.3, 0.405], [0.5, 0.395], [0.68, 0.38], [0.84, 0.358], [0.94, 0.35], [0.975, 0.362], [1, 0.362]]);
  const PITCH = 0.074;
  // Pressure varies as a hand moves, so the ridge swells and dies away rather than running like a screw.
  const pressure = (y, a) => 0.4 + 1.1 * fbm(y * 3.1 + 1.7, Math.sin(a) * 0.9, Math.cos(a) * 0.9, 2);
  const ridge = (y, a, amp) => amp * pressure(y, a) * Math.sin(((y / PITCH) + (a / (Math.PI * 2))) * Math.PI * 2);
  const wobble = (y, a) => 0.006 * Math.sin(a * 2 + y * 4) + 0.004 * Math.sin(a * 3 + 1.2 - y * 7);
  const outerR = (y, a) => {
    const t = y / potH;
    const lipFade = 1 - sstep(t, 0.9, 0.96);
    const footFade = sstep(t, 0.02, 0.1);
    return profile(t) + ridge(y, a, 0.0068) * lipFade * footFade + wobble(y, a);
  };
  const rowsO = [];
  const NRO = 118;
  for (let j = 0; j <= NRO; j += 1) rowsO.push((j / NRO) * potH);
  const outerWall = spiralWall(rowsO, outerR, { sides: 72 });
  // The lip rolls over and the wall comes back down inside, with the ridges the left hand left.
  const innerR = (y, a) => {
    const t = y / potH;
    const wallT = mix(0.13, 0.05, sstep(t, 0.1, 0.72));
    return Math.max(0.04, profile(t) - wallT + ridge(y, a + 2, 0.008) * sstep(t, 0.14, 0.24) * (1 - sstep(t, 0.9, 0.95)) + wobble(y, a));
  };
  const floorY = 0.13;
  const rowsI = [];
  const NRI = 44;
  for (let j = 0; j <= NRI; j += 1) rowsI.push(mix(floorY, potH, j / NRI));
  const innerWall = spiralWall(rowsI, innerR, { sides: 72, outward: false });
  // The rolled lip, the pot's floor (with the spiral a thumb leaves opening a pot), and the pool of
  // slip at the foot, as parts of one surface of revolution.
  const lipN = 8;
  const lipPos = []; const lipIdx = []; const lipUv = [];
  for (let j = 0; j <= lipN; j += 1) {
    const q = j / lipN;
    for (let i = 0; i < 72; i += 1) {
      const a = (i / 72) * Math.PI * 2;
      const ro = outerR(potH, a); const ri = innerR(potH, a);
      const rc = (ro + ri) / 2; const rw = (ro - ri) / 2;
      const ang = q * Math.PI;
      const r = rc + Math.cos(ang) * rw;
      const y = potH + Math.sin(ang) * rw * 0.9;
      lipPos.push(Math.sin(a) * r, y, Math.cos(a) * r);
      lipUv.push((i / 72) * 6, y * 6);
    }
  }
  for (let j = 0; j < lipN; j += 1) {
    for (let i = 0; i < 72; i += 1) {
      const i2 = (i + 1) % 72;
      const a = j * 72 + i; const b = j * 72 + i2; const c = (j + 1) * 72 + i2; const d = (j + 1) * 72 + i;
      lipIdx.push(a, b, c, a, c, d);
    }
  }
  const lip = new THREE.BufferGeometry();
  lip.setAttribute('position', new THREE.Float32BufferAttribute(lipPos, 3));
  lip.setAttribute('uv', new THREE.Float32BufferAttribute(lipUv, 2));
  lip.setIndex(lipIdx);
  lip.computeVertexNormals();
  const floorG = new THREE.BufferGeometry();
  {
    const fp = []; const fi = []; const fu = [];
    const rings = 10; const seg = 72;
    fp.push(0, floorY - 0.006, 0); fu.push(0, 0);
    for (let j = 1; j <= rings; j += 1) {
      for (let i = 0; i < seg; i += 1) {
        const a = (i / seg) * Math.PI * 2;
        const r = (j / rings) * innerR(floorY, a);
        const y = floorY - 0.006 + 0.006 * Math.sin((r / 0.05 + a / (Math.PI * 2)) * Math.PI * 2);
        fp.push(Math.sin(a) * r, y, Math.cos(a) * r);
        fu.push(Math.sin(a) * r * 6, Math.cos(a) * r * 6);
      }
    }
    for (let i = 0; i < seg; i += 1) fi.push(0, 1 + i, 1 + (i + 1) % seg);
    for (let j = 0; j < rings - 1; j += 1) {
      for (let i = 0; i < seg; i += 1) {
        const i2 = (i + 1) % seg;
        const a = 1 + j * seg + i; const b = 1 + j * seg + i2; const c = 1 + (j + 1) * seg + i2; const d = 1 + (j + 1) * seg + i;
        fi.push(a, d, c, a, c, b);
      }
    }
    floorG.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    floorG.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
    floorG.setIndex(fi);
    floorG.computeVertexNormals();
  }
  const potTint = (geo, inside) => {
    tintVertices(geo, (x, y, z, out) => {
      const a = Math.atan2(x, z);
      const t = y / potH;
      // Ridges catch less slip than the grooves between them.
      const ph = Math.sin(((y / PITCH) + (a / (Math.PI * 2))) * Math.PI * 2);
      let c = mix3(CLAY, CLAY_WET, 0.3 + 0.25 * ph);
      // Slip smeared up by a wet hand: broad bands of pale, wandering round.
      const smear = fbm(a * 1.3 + 4, y * 4.2, 2.2, 3);
      mixInto3(c, SLIP, sstep(smear, 0.46, 0.68) * 0.55 * (inside ? 0.3 : 1));
      mixInto3(c, SLIP, (1 - sstep(t, 0.02, 0.12)) * 0.5);
      if (inside) mixInto3(c, CLAY_WET, 0.3 + 0.5 * (1 - sstep(t, 0.15, 0.7)));
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
  };
  potTint(outerWall, false); potTint(innerWall, true); potTint(lip, false); potTint(floorG, true);
  for (const g of [outerWall, innerWall, lip, floorG]) {
    g.translate(0, HY, Z0);
    clay.push({ geometry: g, keepColor: true });
  }

  // The slurry pooled on the tray, stirred by the wheel into arcs round the head.
  {
    const nx = 34; const nz = 26;
    const pos = []; const col = []; const idx = []; const uv = [];
    const x0 = -TX + 0.03; const x1 = TX - 0.03; const z0 = TZ0 + 0.03; const z1 = TZ1 - 0.03;
    for (let j = 0; j <= nz; j += 1) {
      for (let i = 0; i <= nx; i += 1) {
        const x = mix(x0, x1, i / nx); const z = mix(z0, z1, j / nz);
        const r = Math.hypot(x, z - Z0);
        const a = Math.atan2(x, z - Z0);
        const deep = fbm(x * 1.4 + 2, z * 1.4, 3.7, 3);
        const y = trayTop + 0.015 + (deep - 0.5) * 0.03 + Math.sin(r * 16 + a) * 0.003;
        pos.push(x, y, z);
        const c = mix3(CLAY_WET, SLIP, sstep(deep, 0.42, 0.68) * 0.75);
        mixInto3(c, CLAY, 0.25);
        col.push(c[0], c[1], c[2]);
        uv.push(0, 0);
      }
    }
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const a = j * (nx + 1) + i; const b = a + 1; const c = a + nx + 1; const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    clay.push({ geometry: g, keepColor: true });
  }
  // The collar of the head's shaft through the slurry, and a pool of slip on the head itself.
  {
    const c = lathe([[0, trayTop - 0.01], [0.2, trayTop - 0.01], [0.17, trayTop + 0.07], [0.11, trayTop + 0.12], [0.07, trayTop + 0.26], [0, trayTop + 0.26]], 18);
    c.translate(0, 0, Z0);
    iron.push({ geometry: c, color: 0x5a5a5c });
    const pool = lathe([[0, HY - 0.003], [0.545, HY - 0.003], [0.555, HY + 0.002], [0.5, HY + 0.012], [0.3, HY + 0.012], [0, HY + 0.012]], 56);
    pool.translate(0, 0, Z0);
    pool.attributes.uv.array.fill(0);
    clay.push({ geometry: pool, keepColor: true, tint: (p) => { const r = Math.hypot(p.x, p.z - Z0); return mix3(SLIP, CLAY_WET, 0.5 * sstep(r, 0.5, 0.55)); } });
  }
  // Splashes: slip thrown off the wheel onto the tray's inner walls and the frame.
  const splat = (x, y, z, r) => {
    const g = blob(r, 0.26);
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(rng() * 0.5));
    g.translate(x, y, z);
    clay.push({ geometry: g, color: rng() > 0.5 ? 0xa86e4b : 0x8d5639 });
  };
  for (let i = 0; i < 30; i += 1) {
    const a = rng() * Math.PI * 2;
    const inX = Math.abs(Math.sin(a)) > Math.abs(Math.cos(a)) * 1.1;
    if (inX) {
      const s = Math.sign(Math.sin(a));
      const g = blob(0.018 + rng() * 0.036, 0.26);
      g.rotateZ(Math.PI / 2);
      g.translate(s * (TX - wallT / 2 - 0.002), trayTop + 0.05 + rng() * 0.2, mix(TZ0 + 0.2, TZ1 - 0.2, rng()));
      clay.push({ geometry: g, color: rng() > 0.5 ? 0xa86e4b : 0x8d5639 });
    } else {
      const s = Math.sign(Math.cos(a));
      const g = blob(0.018 + rng() * 0.036, 0.26);
      g.rotateX(Math.PI / 2);
      g.translate(mix(-TX + 0.2, TX - 0.2, rng()), trayTop + 0.05 + rng() * 0.2, Z0 + s * (TZ1 - Z0 - wallT / 2 - 0.002));
      clay.push({ geometry: g, color: rng() > 0.5 ? 0xa86e4b : 0x8d5639 });
    }
  }
  for (let i = 0; i < 9; i += 1) splat(mix(-1.3, 1.3, rng()), FY0 + FH + 0.004, Z0 + mix(-0.7, 0.8, rng()), 0.02 + rng() * 0.03);

  // Scraps of trimmed clay in the tray, and a wedged ball ready for the next pot.
  const clayLump = (x, z, r, seed, flat = 0.82) => {
    const g = new THREE.SphereGeometry(1, 18, 12);
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i += 1) {
      const k = 1 + (fbm(P.getX(i) * 2 + seed, P.getY(i) * 2, P.getZ(i) * 2, 2) - 0.5) * 0.5;
      P.setXYZ(i, P.getX(i) * r * k, P.getY(i) * r * k * flat, P.getZ(i) * r * k);
    }
    g.computeVertexNormals();
    g.translate(x, trayTop + r * flat * 0.85, z);
    g.attributes.uv.array.fill(0);
    clay.push({ geometry: g, color: 0x8d5238 });
  };
  clayLump(1.05, Z0 + 0.82, 0.2, 4);
  clayLump(-1.2, Z0 - 0.6, 0.09, 8, 0.6);
  clayLump(-1.05, Z0 - 0.82, 0.06, 12, 0.6);
  clayLump(-0.98, Z0 - 0.5, 0.05, 15, 0.6);

  // --- the kit on the tray: sponge, wire, rib, needle ----------------------------------------------------
  {
    const g = new THREE.SphereGeometry(1, 26, 18);
    const P = g.attributes.position;
    const dk = lin(0x8d6c35); const lt = lin(0xdcb462);
    const colors = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i += 1) {
      const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
      const pit = fbm(x * 3.6 + 7, y * 3.6, z * 3.6, 2);
      const k = 1 + (pit - 0.5) * 0.65 + (fbm(x * 1.2, y * 1.2, z * 1.2, 2) - 0.5) * 0.5;
      P.setXYZ(i, x * 0.2 * k, y * 0.13 * k, z * 0.17 * k);
      const c = mix3(dk, lt, sstep(pit, 0.38, 0.6));
      colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    g.translate(0.92, trayTop + 0.11, Z0 - 0.72);
    stone.push({ geometry: g, keepColor: true });
    // Wire cutter: two turned toggles and a twist of wire draped over the tray's front wall.
    const wy = trayTop + wallH;
    const zw = TZ1 + wallT * 0.5;
    const path = [[-0.72, trayTop + 0.04, TZ1 - 0.34], [-0.6, trayTop + 0.04, TZ1 - 0.22], [-0.44, trayTop + 0.1, TZ1 - 0.1], [-0.34, wy + 0.008, TZ1 - 0.01], [-0.3, wy + 0.009, TZ1 + 0.03], [-0.28, wy - 0.07, zw + 0.02], [-0.3, wy - 0.3, zw + 0.022], [-0.36, wy - 0.44, zw + 0.02], [-0.42, wy - 0.56, zw + 0.02]];
    iron.push({ geometry: tube(path, 0.0075, { sides: 5, steps: 36, round: 1 }), color: 0x88898c });
    const tog = (p, dir) => {
      const t = tube([[p[0] - dir[0], p[1] - dir[1], p[2] - dir[2]], [p[0] + dir[0], p[1] + dir[1], p[2] + dir[2]]], [0.024, 0.03, 0.024], { sides: 8, steps: 4, round: 1 });
      wood.push({ geometry: t, color: 0xb88b52 });
    };
    tog(path[0], [0.05, 0, -0.05]);
    tog(path[path.length - 1], [0.07, 0.0, 0]);
    // A wooden rib, kidney shaped, on the tray: one of a potter's oldest tools.
    const out = [];
    for (let i = 0; i < 24; i += 1) { const a = (i / 24) * Math.PI * 2; out.push([Math.cos(a) * 0.2 * (1 + 0.14 * Math.cos(a * 2)), Math.sin(a) * 0.12 * (1 - 0.26 * Math.max(0, Math.sin(a)))]); }
    const rib = extrudeOutlineSimple(out, 0.022);
    rib.rotateX(-Math.PI / 2);
    rib.rotateY(0.6);
    rib.translate(0.5, trayTop + 0.04, Z0 + 0.86);
    wood.push({ geometry: rib, color: 0xc29b62 });
    // A needle tool, resting on the rail.
    iron.push({ geometry: tube([[-1.08, trayTop + wallH + 0.012, TZ0 + 0.3], [-0.9, trayTop + wallH + 0.012, TZ0 + 0.0]], [0.006, 0.004], { sides: 5, steps: 2, round: 1, straight: true }), color: 0x88898c });
  }

  // --- the bucket --------------------------------------------------------------------------------------
  {
    const BX = 1.86; const BZ = 1.42; const BH = 1.0; const R0 = 0.4; const R1 = 0.5;
    const staves = 18;
    const by = FLOOR;
    for (let i = 0; i < staves; i += 1) {
      const a = (i / staves) * Math.PI * 2;
      const w = (2 * Math.PI * 0.45) / staves + 0.006;
      const a0 = [BX + Math.sin(a) * R0, by, BZ + Math.cos(a) * R0];
      const a1 = [BX + Math.sin(a) * R1, by + BH, BZ + Math.cos(a) * R1];
      const tone = [0xa17c4d, 0x8d6b42, 0xb18c58][i % 3];
      timber(wood, tone, a0, a1, w, 0.05, { tile: [0.9, 2.6], rng, up: [Math.sin(a), 0, Math.cos(a)], jitter: 0.1 });
    }
    // The bottom, and the cloudy water inside.
    const floorB = lathe([[0, by + 0.02], [R0, by + 0.02], [R0, by + 0.05], [0, by + 0.05]], 28);
    floorB.translate(BX, 0, BZ);
    wood.push({ geometry: planUV(floorB), color: 0x7e5f3a });
    const w = lathe([[0, by + BH - 0.3], [mix(R0, R1, 0.7) - 0.005, by + BH - 0.3], [mix(R0, R1, 0.7) - 0.005, by + BH - 0.26], [0, by + BH - 0.26]], 36);
    w.translate(BX, 0, BZ);
    w.attributes.uv.array.fill(0);
    clay.push({ geometry: w, keepColor: true, tint: (p) => mix3(lin(0x5e4636), lin(0x7c5f4b), sstep(fbm(p.x * 3, 0, p.z * 3, 2), 0.4, 0.62)) });
    // Iron hoops, and the bail handle.
    for (const t of [0.14, 0.82]) {
      const y = by + BH * t;
      const r = mix(R0, R1, t) + 0.027;
      const h = lathe([[r - 0.04, y - 0.03], [r, y - 0.03], [r + 0.006, y], [r, y + 0.03], [r - 0.04, y + 0.03]], 36);
      // Open along its inside, where it is pressed against the staves.
      h.translate(BX, 0, BZ);
      iron.push({ geometry: outward(h), color: 0x3d3d40 });
    }
    const rTop = R1 + 0.03;
    const hA = [BX - rTop, by + BH - 0.06, BZ]; const hB = [BX + rTop, by + BH - 0.06, BZ];
    const pts = [hA];
    for (let i = 1; i < 12; i += 1) {
      const t = i / 12;
      pts.push([mix(hA[0], hB[0], t), by + BH - 0.06 + Math.sin(t * Math.PI) * 0.1, BZ + Math.sin(t * Math.PI) * 0.62]);
    }
    pts.push(hB);
    iron.push({ geometry: tube(pts, 0.016, { sides: 7, steps: 28, round: 1 }), color: 0x4a4a4e });
    // Slip dribbled down the side.
    for (let i = 0; i < 8; i += 1) {
      const a = rng() * 6.28;
      const y = by + 0.4 + rng() * 0.5;
      const t = (y - by) / BH;
      const r = mix(R0, R1, t) + 0.028;
      const g = blob(0.02 + rng() * 0.02, 0.3);
      g.scale(1, 1, 1);
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
      g.translate(BX + Math.sin(a) * r, y, BZ + Math.cos(a) * r);
      clay.push({ geometry: g, color: 0x9d6545 });
    }
  }

  // --- the stool, and two finished pots ------------------------------------------------------------------
  {
    const SX = -2.2; const SZ = 1.25; const SH = 1.35; const R = 0.72;
    const top = lathe([[0, SH - 0.09], [R - 0.03, SH - 0.09], [R, SH - 0.06], [R, SH - 0.02], [R - 0.02, SH], [0, SH]], 48);
    top.translate(SX, 0, SZ);
    wood.push({ geometry: planUV(top), color: 0xa98352 });
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const f0 = [SX + Math.sin(a) * 0.66, FLOOR - 0.01, SZ + Math.cos(a) * 0.66];
      const f1 = [SX + Math.sin(a) * 0.46, SH - 0.06, SZ + Math.cos(a) * 0.46];
      wood.push({ geometry: tube([f0, f1], [0.055, 0.042], { sides: 10, steps: 2, round: 1, straight: true }), color: 0x8e6b40 });
      const b = (((i + 1) % 3) / 3) * Math.PI * 2 + 0.5;
      const h = 0.48;
      const p0 = [mix(f0[0], f1[0], h), mix(f0[1], f1[1], h), mix(f0[2], f1[2], h)];
      const p1 = [SX + Math.sin(b) * mix(0.66, 0.46, h), mix(f0[1], f1[1], h), SZ + Math.cos(b) * mix(0.66, 0.46, h)];
      wood.push({ geometry: tube([p0, p1], 0.028, { sides: 7, steps: 1, round: 1, straight: true }), color: 0x8e6b40 });
    }
    // A glazed jar: the glaze stops short of the foot in a wavy line and pools darker in the throat,
    // which is how anybody knows a glaze from paint.
    const jarY = SH; const JX = SX - 0.2; const JZ = SZ - 0.2;
    const pts = [[0, 0], [0.16, 0], [0.18, 0.015], [0.2, 0.06], [0.26, 0.2], [0.325, 0.38], [0.345, 0.5], [0.32, 0.62], [0.24, 0.73], [0.14, 0.78], [0.122, 0.82], [0.145, 0.88], [0.178, 0.92], [0.17, 0.935], [0.13, 0.905], [0.1, 0.84], [0.09, 0.76], [0, 0.72]];
    const fine = [];
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], 0)), false, 'catmullrom', 0.3);
    for (let i = 0; i <= 44; i += 1) { const v = curve.getPoint(i / 44); fine.push([Math.max(0, v.x), v.y]); }
    fine[0] = [0, 0]; fine[fine.length - 1] = [0, 0.72];
    const jar = lathe(fine, 60);
    const blue = lin(0x1f5b78); const blueDk = lin(0x123b56); const tanC = lin(0xb59172); const rim = lin(0x8fb0ae);
    tintVertices(jar, (x, y, z, out) => {
      const a = Math.atan2(x, z);
      const line = 0.13 + Math.sin(a * 5 + 1) * 0.018 + Math.sin(a * 11) * 0.008;
      const c = y < line ? tanC : mix3(blue, blueDk, 0.25 + 0.5 * sstep(fbm(a * 1.2, y * 5, 1, 2), 0.4, 0.62));
      if (y > 0.86) mixInto3(c, rim, 0.45);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    jar.translate(JX, jarY, JZ);
    glazed.push({ geometry: jar, keepColor: true });
    // An open terracotta bowl with a slip-painted band, fired and unglazed outside.
    const BX = SX + 0.3; const BZ = SZ + 0.25;
    const bowlO = [[0, 0], [0.13, 0], [0.145, 0.025], [0.2, 0.075], [0.27, 0.17], [0.31, 0.26], [0.325, 0.3]];
    const bowlI = [[0.31, 0.308], [0.29, 0.26], [0.21, 0.155], [0.11, 0.085], [0, 0.065]];
    const dense = (pts, n) => {
      const cv = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(q[0], q[1], 0)), false, 'catmullrom', 0.3);
      const list = [];
      for (let i = 0; i <= n; i += 1) { const v = cv.getPoint(i / n); list.push([Math.max(0, v.x), v.y]); }
      return list;
    };
    const oList = dense(bowlO, 26); const iList = dense(bowlI, 12);
    oList[0] = [0, 0]; iList[iList.length - 1] = [0, 0.065];
    const bowl = lathe([...oList, ...iList], 60);
    const terra = lin(0xb4603b); const cream = lin(0xe2cda6); const dark = lin(0x53291a);
    const nRows = oList.length + iList.length;
    tintVertices(bowl, (x, y, z, out, i) => {
      // lathe reverses the profile, so the row number counts back from the inside's centre.
      const row = nRows - 1 - (i % nRows);
      let c = terra;
      if (row < oList.length) {
        if (y > 0.19 && y < 0.26) c = cream;
        if ((y > 0.175 && y < 0.19) || (y > 0.26 && y < 0.272)) c = dark;
      } else {
        c = mix3(terra, dark, 0.14);
      }
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    bowl.translate(BX, jarY, BZ);
    glazed.push({ geometry: bowl, keepColor: true });
  }

  // --- materials --------------------------------------------------------------------------------------
  const wg = grainMaps({ seed: 77, knots: 4, strength: 0.7, streaks: 180 });
  const woodMesh = mesh(mergeParts(wood), standard({ vertexColors: true, map: wg.map, bumpMap: wg.bumpMap, bumpScale: wg.bumpScale, roughness: 0.78, metalness: 0 }));

  // Fine finger lines, as a diagonal tile that wraps: on the pot's u, v they run with the spiral.
  const fingerLines = (space) => {
    const r2 = seededRandom(303);
    const t = canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#f4f1ee';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i += 1) {
        const y = r2() * h;
        const v = 170 + r2() * 70;
        ctx.strokeStyle = `rgba(${v},${v * 0.96},${v * 0.92},${0.3 + r2() * 0.5})`;
        ctx.lineWidth = 0.7 + r2() * 1.6;
        for (const oy of [-h, 0, h]) {
          ctx.beginPath();
          ctx.moveTo(0, y + oy);
          ctx.lineTo(w, y + oy + 7);
          ctx.stroke();
        }
      }
    });
    t.colorSpace = space;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const clayMesh = mesh(mergeParts(clay), standard({ vertexColors: true, map: fingerLines(THREE.SRGBColorSpace), bumpMap: fingerLines(THREE.NoColorSpace), bumpScale: 0.5, roughness: 0.3, metalness: 0 }));

  const stoneTile = grainBump(2, { size: 256, dots: 2200, min: 0.8, max: 2.2, contrast: 0.5 });
  stoneTile.repeat.set(3, 3);
  const stoneMesh = mesh(mergeParts(stone), standard({ vertexColors: true, bumpMap: stoneTile, bumpScale: 0.6, roughness: 0.9, metalness: 0 }));
  const ironMesh = mesh(mergeParts(iron), standard({ vertexColors: true, roughness: 0.48, metalness: 0.42 }));
  const glazedMesh = mesh(mergeParts(glazed), standard({ vertexColors: true, roughness: 0.2, metalness: 0 }));
  return group(woodMesh, clayMesh, stoneMesh, ironMesh, glazedMesh);
}

// A short closed extrusion from an outline, wound by measurement.
function extrudeOutlineSimple(outline, depth) {
  const s = new Soup();
  const cx = outline.reduce((v, p) => v + p[0], 0) / outline.length;
  const cy = outline.reduce((v, p) => v + p[1], 0) / outline.length;
  const white = [1, 1, 1];
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i]; const b = outline[(i + 1) % outline.length];
    const mid = [(a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy, 0];
    s.face([[a[0], a[1], -depth / 2], [b[0], b[1], -depth / 2], [b[0], b[1], depth / 2], [a[0], a[1], depth / 2]], white, mid);
    s.face([[cx, cy, depth / 2], [a[0], a[1], depth / 2], [b[0], b[1], depth / 2]], white, [0, 0, 1]);
    s.face([[cx, cy, -depth / 2], [a[0], a[1], -depth / 2], [b[0], b[1], -depth / 2]], white, [0, 0, -1]);
  }
  return s.geometry();
}


// ---------------------------------------------------------------------------
// A five-piece drum kit, life size
// ---------------------------------------------------------------------------

// A wrapped ring: a surface of revolution with a duplicated seam column, so u can run the whole way
// round without wrapping backwards across the last strip, and with the seam's normals welded so it
// cannot crease. Profile bottom-up; `closed` joins its last point to its first.
function wrappedRing(profile, { seg = 48, uTile = 2, vTile = 1, closed = false } = {}) {
  const prof = closed ? [...profile, profile[0]] : profile;
  const n = prof.length;
  const r0 = profile.reduce((m, p) => Math.max(m, p[0]), 0);
  const uRepeat = Math.max(1, Math.round((2 * Math.PI * r0) / uTile));
  const pos = []; const uv = []; const idx = [];
  let run = 0;
  const along = [0];
  for (let i = 1; i < n; i += 1) { run += Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]); along.push(run); }
  for (let c = 0; c <= seg; c += 1) {
    const a = (c / seg) * Math.PI * 2;
    for (let i = 0; i < n; i += 1) {
      pos.push(Math.sin(a) * prof[i][0], prof[i][1], Math.cos(a) * prof[i][0]);
      uv.push((c / seg) * uRepeat, along[i] / vTile);
    }
  }
  for (let c = 0; c < seg; c += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const p = c * n + i; const q = p + 1; const s = (c + 1) * n + i + 1; const t = (c + 1) * n + i;
      idx.push(p, t, s, p, s, q);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const N = g.attributes.normal;
  for (let i = 0; i < n; i += 1) {
    const a = i; const b = seg * n + i;
    const v = norm([N.getX(a) + N.getX(b), N.getY(a) + N.getY(b), N.getZ(a) + N.getZ(b)]);
    N.setXYZ(a, v[0], v[1], v[2]); N.setXYZ(b, v[0], v[1], v[2]);
  }
  return g;
}

// Chrome is painted, since there is no environment for it to reflect: a bright band where a surface
// faces the sky, a dark line at the horizon, and a slow alternation round the vertical so an upright
// tube still has its long streak. Vertex normals carry it, so it holds at any metalness under 0.5.
function polish(geometry, base, { dark = 0.1, light = 1, turns = 3 } = {}) {
  const N = geometry.attributes.normal;
  const col = new Float32Array(N.count * 3);
  for (let i = 0; i < N.count; i += 1) {
    const nx = N.getX(i); const ny = N.getY(i); const nz = N.getZ(i);
    const sky = sstep(ny, 0.1, 0.5);
    const hv = 0.5 + 0.5 * Math.cos(Math.atan2(nx, nz) * turns + 0.7);
    const round = mix(dark, light, hv * hv * hv);
    const below = ny < -0.25 ? mix(1, 0.5, sstep(-ny, 0.25, 0.8)) : 1;
    const v = mix(round, light * 0.92, sky * 0.72) * below;
    col[i * 3] = base[0] * v; col[i * 3 + 1] = base[1] * v; col[i * 3 + 2] = base[2] * v;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geometry;
}

function cymbalTexture() {
  // Per texel: a cymbal's identity is its lathe grooves, tonal rings a turner cuts into both faces,
  // and the two bright wedges those grooves throw back as a highlight. Both are painted here.
  const rng = seededRandom(1623);
  const SIZE = 1024;
  const dents = [];
  for (let i = 0; i < 260; i += 1) {
    const a = rng() * 6.283; const r = 0.26 + rng() * 0.68;
    dents.push({ x: 0.5 + 0.5 * Math.cos(a) * r, y: 0.5 + 0.5 * Math.sin(a) * r, rad: 0.009 + rng() * 0.008 });
  }
  return canvasTexture(SIZE, SIZE, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    let o = 0;
    const hc = w / 2;
    const noise = new Float32Array(1024);
    for (let i = 0; i < 1024; i += 1) noise[i] = rng();
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const dx = (x - hc + 0.5) / hc; const dy = (y - hc + 0.5) / hc;
        const r = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        const bell = r < 0.2;
        // Grooves: a fine ring every five texels with a slower beat in its depth.
        const gv = 0.5 + 0.5 * Math.sin(r * 320);
        const beat = noise[Math.floor(r * 720) & 1023];
        // The fan of highlight, opposite wedges that sharpen toward the edge.
        const fan = Math.abs(Math.cos(a - 0.7)) ** 18 * sstep(r, 0.16, 0.42);
        const fan2 = Math.abs(Math.cos(a + 0.9)) ** 40 * sstep(r, 0.3, 0.6) * 0.4;
        let k = bell ? 0.86 + 0.14 * Math.cos(r * 40) : 0.6 + 0.24 * gv + 0.16 * beat;
        k = mix(k, 1.16, Math.min(1, fan + fan2) * 0.78);
        // Polished bright at the bell, patina darker out toward the edge.
        const edge = 1 - 0.12 * sstep(r, 0.82, 1);
        const v = k * edge;
        d[o] = Math.min(255, 232 * v); d[o + 1] = Math.min(255, 176 * v); d[o + 2] = Math.min(255, 92 * v); d[o + 3] = 255;
        o += 4;
      }
    }
    ctx.putImageData(img, 0, 0);
    // The hammer dents: small soft arcs that break up the rings.
    for (const dent of dents) {
      ctx.strokeStyle = 'rgba(92,58,22,0.25)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(dent.x * w, dent.y * h, dent.rad * w, 0, 3.14);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,226,170,0.25)';
      ctx.beginPath();
      ctx.arc(dent.x * w, dent.y * h, dent.rad * w, 3.14, 6.28);
      ctx.stroke();
    }
  });
}

function drumKit() {
  const shells = []; const heads = []; const metal = []; const bronze = []; const dark = [];
  const RUG = 0.035;
  const chromeBase = lin(0xe6eaf0);
  const metalAdd = (g) => { polish(g, chromeBase); metal.push({ geometry: g, keepColor: true }); };
  const bake = (g, M) => { g.applyMatrix4(M); return g; };
  const rod = (a, b, r, sides = 8, round = 1) => tube([a, b], r, { sides, steps: 1, round, straight: true });
  const mPoint = (M, x, y, z) => { const v = new THREE.Vector3(x, y, z).applyMatrix4(M); return [v.x, v.y, v.z]; };

  // --- one drum ---------------------------------------------------------------------------------------
  // Authored along +Y, so a tom, a snare and a bass drum are all the same builder at another matrix.
  // Every lug and tension rod is real repeated geometry: there is one casing per column, a rod from
  // it to each hoop that has one, and a bolt with a washer on the hoop's flange.
  function drum(M, { r, d, lugs, bass = false, hoopH = 0.075, frontRing = false, doubleLug = false }) {
    const y0 = -d / 2; const y1 = d / 2;
    shells.push({ geometry: bake(wrappedRing([[r, y0], [r, y1]], { seg: bass ? 72 : 56 }), M), color: 0xffffff });
    // A thin chrome or wood-and-sparkle hoop at each end. A wooden bass hoop takes the same wrap as
    // the shell, which is how they are really finished.
    const hoopProfile = bass
      ? [[r - 0.005, 0], [r + 0.03, 0], [r + 0.045, 0.012], [r + 0.045, hoopH + 0.015], [r + 0.03, hoopH + 0.03], [r - 0.005, hoopH + 0.03]]
      : [[r - 0.012, 0], [r + 0.014, 0], [r + 0.016, hoopH * 0.72], [r + 0.03, hoopH * 0.82], [r + 0.034, hoopH * 0.95], [r + 0.02, hoopH], [r - 0.012, hoopH]];
    const seg = bass ? 64 : 44;
    for (const end of [1, -1]) {
      const yEnd = end > 0 ? y1 : y0;
      const prof = hoopProfile.map(([rr, h]) => [rr, end > 0 ? yEnd + h - 0.012 : yEnd - h + 0.012]);
      const ordered = end > 0 ? prof : [...prof].reverse();
      if (bass) {
        shells.push({ geometry: bake(wrappedRing(ordered, { seg, closed: true }), M), color: 0xffffff });
      } else {
        const g = wrappedRing(ordered, { seg, closed: true });
        bake(g, M);
        metalAdd(g);
      }
      // The coated head: a dome so shallow it only catches the light at its edges, seated in the
      // hoop by its own collar. Its map is planar, so the wear lands in the middle of the circle.
      const front = frontRing && end > 0;
      const rows = front
        ? [[0, 0.004], [r * 0.2, 0.004], [r * 0.5, 0.004], [r * 0.74, 0.004], [r * 0.76, 0.004], [r * 0.82, 0.004], [r * 0.84, 0.004], [r * 0.94, 0.003], [r - 0.018, 0.001]]
        : [[0, 0.004], [r * 0.5, 0.004], [r * 0.86, 0.003], [r - 0.018, 0.001]];
      const headProfile = [[0, -0.02], [r - 0.012, -0.02], [r - 0.012, -0.002], ...[...rows].reverse()];
      const hg = lathe(headProfile.map(([rr, h]) => [rr, h]), seg);
      const P = hg.attributes.position; const U = hg.attributes.uv;
      // The audience's head is never struck, so it reads the clean part of the sheet, not the wear.
      for (let i = 0; i < P.count; i += 1) {
        if (front) U.setXY(i, 0.02 + (P.getX(i) / (2 * r) + 0.5) * 0.12, 0.02 + (P.getZ(i) / (2 * r) + 0.5) * 0.12);
        else U.setXY(i, P.getX(i) / (2 * r) + 0.5, P.getZ(i) / (2 * r) + 0.5);
      }
      const tint = (p) => {
        const rad = Math.hypot(p.x, p.z);
        if (front && rad > r * 0.745 && rad < r * 0.835) return lin(0x1d54b6);
        return [1, 1, 1];
      };
      // End -1 is the same dome turned over about the drum's own x axis, a proper rotation.
      const local = new THREE.Matrix4().makeTranslation(0, end > 0 ? y1 + hoopH * 0.5 : y0 - hoopH * 0.5, 0);
      if (end < 0) local.multiply(new THREE.Matrix4().makeRotationX(Math.PI));
      tintGeo(hg, tint);
      heads.push({ geometry: bake(hg, new THREE.Matrix4().multiplyMatrices(M, local)), keepColor: true });
    }
    // Lugs.
    for (let i = 0; i < lugs; i += 1) {
      const a = ((i + 0.5) / lugs) * Math.PI * 2;
      const sx = Math.sin(a); const cz = Math.cos(a);
      const onShell = (rr, y) => mPoint(M, sx * rr, y, cz * rr);
      const casing = (yc, h) => {
        const tp = onShell(r + 0.012, yc + h / 2); const bt = onShell(r + 0.012, yc - h / 2);
        metalAdd(tube([bt, tp], [0.018, 0.031, 0.018], { sides: 8, steps: 4, round: 2, straight: true }));
        // Two screw heads holding it to the shell, and the shell's seat under it.
        return [tp, bt];
      };
      const rodR = bass ? 0.0145 : 0.0105;
      const rRod = r + (bass ? 0.075 : 0.036);
      const toHoop = (yFrom, yHoop) => {
        const from = onShell(rRod - 0.012, yFrom); const to = onShell(rRod, yHoop);
        metalAdd(rod(from, to, rodR, 6));
        const dirUp = norm(sub(to, from));
        // Bolt head and washer on the flange.
        const seat = onShell(rRod, yHoop);
        const washer = add(seat, scl(dirUp, 0.001));
        metalAdd(tube([washer, add(washer, scl(dirUp, 0.008))], 0.028, { sides: 10, steps: 1, round: 0, straight: true }));
        metalAdd(tube([add(washer, scl(dirUp, 0.008)), add(washer, scl(dirUp, bass ? 0.05 : 0.036))], bass ? 0.026 : 0.019, { sides: 6, steps: 1, round: 1, straight: true }));
      };
      if (doubleLug) {
        casing(y1 - 0.2, 0.2);
        casing(y0 + 0.2, 0.2);
        toHoop(y1 - 0.16, y1 + hoopH - 0.015);
        toHoop(y0 + 0.16, y0 - hoopH + 0.015);
      } else {
        const hh = bass ? 0.34 : Math.min(d * 0.42, 0.34);
        casing(0, hh);
        toHoop(hh * 0.42, y1 + (bass ? hoopH * 0.6 : hoopH - 0.015));
        toHoop(-hh * 0.42, y0 - (bass ? hoopH * 0.6 : hoopH - 0.015));
      }
      // A bass drum's rods end in a claw hooked over its wooden hoop, on each side of the drum.
      if (bass) {
        for (const e of [1, -1]) {
          const yHoop = e > 0 ? y1 + hoopH * 0.25 : y0 - hoopH * 0.25;
          const claw = [onShell(rRod, yHoop - e * 0.03), onShell(r + 0.056, yHoop + e * 0.05), onShell(r + 0.022, yHoop + e * 0.07)];
          metalAdd(tube(claw, 0.017, { sides: 6, steps: 6, round: 1 }));
        }
      }
    }
  }

  // --- stands -------------------------------------------------------------------------------------------
  // A tripod: three legs from a sliding collar, three braces from a lower one, rubber feet, and a
  // tube that telescopes at a wing-nut clamp. Every stand in the kit is one of these.
  function tripod(x, z, top, { spread = 0.62, collarY = 0.72, lowerY = 0.3, r0 = 0.048, r1 = 0.034, joint = null } = {}) {
    const base = RUG + 0.012;
    const jy = joint ?? mix(collarY, top, 0.46);
    metalAdd(rod([x, lowerY - 0.08, z], [x, jy, z], r0, 12));
    metalAdd(rod([x, jy - 0.04, z], [x, top, z], r1, 12));
    const collar = (y, r, h) => { metalAdd(bake(lathe([[0, y - h], [r, y - h], [r, y + h], [0, y + h]], 14), new THREE.Matrix4().makeTranslation(x, 0, z))); };
    collar(collarY, r0 + 0.03, 0.035);
    collar(lowerY, r0 + 0.022, 0.028);
    collar(jy, r0 + 0.016, 0.042);
    // The wing nut on the height clamp.
    const wx = x + Math.sin(0.8) * (r0 + 0.05); const wz = z + Math.cos(0.8) * (r0 + 0.05);
    metalAdd(rod([x, jy, z], [wx, jy, wz], 0.012, 6));
    metalAdd(tube([[wx - 0.035, jy, wz + 0.02], [wx + 0.035, jy, wz - 0.02]], 0.014, { sides: 6, steps: 1, round: 1, straight: true }));
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2 + 0.52;
      const foot = [x + Math.sin(a) * spread, base + 0.018, z + Math.cos(a) * spread];
      metalAdd(rod([x + Math.sin(a) * 0.045, collarY, z + Math.cos(a) * 0.045], foot, 0.024, 8));
      const braceAt = 0.46;
      const bp = [mix(x, foot[0], braceAt), mix(collarY, foot[1], braceAt), mix(z, foot[2], braceAt)];
      metalAdd(rod([x + Math.sin(a) * 0.05, lowerY, z + Math.cos(a) * 0.05], bp, 0.016, 7));
      const tip = lathe([[0, 0], [0.04, 0], [0.042, 0.03], [0.03, 0.06], [0, 0.06]], 10);
      tip.translate(foot[0], RUG, foot[2]);
      dark.push({ geometry: tip, color: 0x18181a });
    }
  }

  // --- a cymbal ---------------------------------------------------------------------------------------
  // Turned from one sheet: a bell, a long shallow bow, and an edge thin enough to shimmer. It is
  // solid, with an underside that matches. Its map is planar, so the grooves are true circles.
  function cymbal(M, R, { bell = 0.2, fall = 0.085, seg = 72, thick = 0.014, bellH = 0.11 } = {}) {
    const top = [];
    const nBell = 4;
    for (let i = 0; i <= nBell; i += 1) {
      const t = i / nBell;
      const rr = t * bell * R;
      const y = bellH * R * (Math.cos(t * Math.PI * 0.5) ** 0.8) + (fall * R * 0.9 * (1 - bell * 0));
      top.push([rr, y]);
    }
    const nBow = 8;
    const bowY0 = fall * R * 0.9;
    for (let i = 1; i <= nBow; i += 1) {
      const t = i / nBow;
      top.push([mix(bell * R, R, t), bowY0 * (1 - t ** 1.25) - 0.02 * R * t]);
    }
    const under = [...top].reverse().map(([rr, y], i, arr) => {
      const edge = 1 - i / (arr.length - 1);
      return [rr, y - thick * mix(1, 0.35, edge) * (rr > bell * R ? 1 : 1.4)];
    });
    // Under first, from the axis outward, then back over the top: lathe's bottom-up convention.
    // The underside is seen less and needs fewer rows than the top: every other one.
    const underFew = under.filter((q, i) => i % 2 === 0 || i === under.length - 1);
    const profile = [...[...underFew].reverse(), ...[...top].reverse()];
    profile[0] = [0, profile[0][1]];
    const g = lathe(profile, seg);
    const P = g.attributes.position; const U = g.attributes.uv;
    for (let i = 0; i < P.count; i += 1) U.setXY(i, P.getX(i) / (2 * R) + 0.5, P.getZ(i) / (2 * R) + 0.5);
    bronze.push({ geometry: bake(g, M), color: 0xffffff });
    // Felt, sleeve and wing nut on top of the bell, and the felt under it.
    const yTop = (bellH + fall * 0.9) * R;
    const felt = lathe([[0, yTop + 0.002], [0.05, yTop + 0.002], [0.05, yTop + 0.03], [0, yTop + 0.03]], 12);
    dark.push({ geometry: bake(felt, M), color: 0xb33a30 });
    const wing = lathe([[0, yTop + 0.03], [0.026, yTop + 0.03], [0.02, yTop + 0.075], [0, yTop + 0.09]], 10);
    metalAdd(bake(wing, M));
    const wingA = mPoint(M, -0.05, yTop + 0.055, 0); const wingB = mPoint(M, 0.05, yTop + 0.055, 0);
    metalAdd(tube([wingA, wingB], 0.012, { sides: 6, steps: 1, round: 1, straight: true }));
  }

  // --- the bass drum, on the floor, with its head toward the audience ------------------------------------
  const BR = 22 / 24; const BD = 1.5;
  const BY = BR + RUG + 0.05; const BZ = 0.42;
  const MB = new THREE.Matrix4().makeTranslation(0, BY, BZ).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  drum(MB, { r: BR, d: BD, lugs: 10, bass: true, hoopH: 0.075, frontRing: true });
  // Spurs: a leg out each side, forward and down, stopping it walking away from the pedal.
  for (const s of [-1, 1]) {
    const root = [s * 0.74, BY - 0.56, BZ + 0.42];
    const foot = [s * 1.2, RUG + 0.05, BZ + 0.72];
    const plate = lathe([[0, -0.02], [0.05, -0.02], [0.05, 0.03], [0, 0.03]], 12);
    plate.rotateX(Math.PI / 2);
    plate.rotateY(Math.atan2(s * 0.8, 0.6));
    plate.translate(s * 0.71, BY - 0.56, BZ + 0.42);
    metalAdd(plate);
    metalAdd(rod(root, foot, 0.027, 10));
    const tip = lathe([[0, 0], [0.045, 0], [0.045, 0.05], [0.028, 0.09], [0, 0.09]], 10);
    tip.translate(foot[0], RUG, foot[2]);
    dark.push({ geometry: tip, color: 0x18181a });
  }
  // --- the pedal, on the batter side --------------------------------------------------------------------
  {
    const zHoop = BZ - BD / 2 - 0.08;
    const zAxle = zHoop - 0.1;
    const plateY = RUG + 0.01;
    // Baseplate and heel.
    dark.push({ geometry: extrudeOutlineSimpleY([[-0.21, zHoop - 0.26], [0.21, zHoop - 0.26], [0.17, zHoop - 1.08], [-0.17, zHoop - 1.08]], plateY, 0.02), color: 0x2a2a2d });
    // The footboard, hinged at the heel and raised at the toe, with a chain up to the cam.
    const heel = [0, plateY + 0.05, zHoop - 1.04]; const toe = [0, plateY + 0.34, zHoop - 0.3];
    timberMetal(dark, 0x3a3a3e, heel, toe, 0.3, 0.035);
    const yAxle = plateY + 0.86;
    for (const s of [-1, 1]) metalAdd(rod([s * 0.19, plateY + 0.02, zAxle], [s * 0.17, yAxle, zAxle], 0.03, 10));
    metalAdd(rod([-0.19, yAxle, zAxle], [0.19, yAxle, zAxle], 0.02, 10));
    // A cam and the chain: twelve links are all a chain needs at this size.
    const cam = lathe([[0, -0.02], [0.08, -0.02], [0.08, 0.02], [0, 0.02]], 16);
    cam.rotateZ(Math.PI / 2);
    cam.translate(0, yAxle, zAxle);
    metalAdd(cam);
    const links = 9;
    for (let i = 0; i < links; i += 1) {
      const t = i / links; const t2 = (i + 1) / links;
      const a = [0, mix(toe[1] + 0.02, yAxle - 0.07, t), mix(toe[2] - 0.0, zAxle - 0.09, t)];
      const b = [0, mix(toe[1] + 0.02, yAxle - 0.07, t2), mix(toe[2] - 0.0, zAxle - 0.09, t2)];
      metalAdd(tube([a, b], 0.009, { sides: 5, steps: 1, round: 1, straight: true, section: () => [i % 2 ? 1.5 : 0.6, i % 2 ? 0.6 : 1.5] }));
    }
    // The beater, swung back off the head, and its felt.
    const bTop = [0, yAxle + 0.6, zAxle - 0.28];
    metalAdd(rod([0, yAxle, zAxle], bTop, 0.016, 8));
    const felt = new THREE.SphereGeometry(0.1, 16, 12);
    felt.scale(1, 0.72, 1);
    felt.translate(bTop[0], bTop[1], bTop[2]);
    dark.push({ geometry: felt, color: 0xd8d4c6 });
    // The clamp onto the hoop, and the spring post beside the frame.
    metalAdd(rod([0, plateY + 0.02, zAxle + 0.02], [0, BY - BR - 0.03, zHoop + 0.03], 0.03, 8));
    metalAdd(rod([0.17, yAxle - 0.2, zAxle], [0.17, yAxle + 0.12, zAxle - 0.03], 0.012, 6));
  }

  // --- the rack toms, on a post rising out of the bass drum ----------------------------------------------
  const postTopY = 2.34;
  metalAdd(rod([0, BY + BR - 0.03, BZ - 0.05], [0, postTopY, BZ - 0.05], 0.05, 12));
  metalAdd(bake(lathe([[0, 0], [0.12, 0], [0.12, 0.05], [0.07, 0.09], [0, 0.09]], 16), new THREE.Matrix4().makeTranslation(0, BY + BR - 0.015, BZ - 0.05)));
  metalAdd(bake(lathe([[0, -0.07], [0.078, -0.07], [0.078, 0.07], [0, 0.07]], 14), new THREE.Matrix4().makeTranslation(0, postTopY - 0.04, BZ - 0.05)));
  const tiltM = (x, y, z, tiltX, tiltZ) => new THREE.Matrix4().makeTranslation(x, y, z)
    .multiply(new THREE.Matrix4().makeRotationZ(tiltZ))
    .multiply(new THREE.Matrix4().makeRotationX(tiltX));
  // Tilted toward the drummer sitting behind them, as anyone playing wants.
  const TOMS = [
    { x: 0.62, y: 2.62, z: 0.2, r: 10 / 24, d: 0.68, roll: -0.09 },
    { x: -0.66, y: 2.62, z: 0.2, r: 12 / 24, d: 0.78, roll: 0.09 },
  ];
  for (const t of TOMS) {
    const M = tiltM(t.x, t.y, t.z, -0.36, t.roll);
    drum(M, { r: t.r, d: t.d, lugs: 6 });
    const seat = mPoint(M, -Math.sign(t.x) * (t.r + 0.018), -0.03, 0.08);
    metalAdd(tube([[0, postTopY - 0.04, BZ - 0.05], [t.x * 0.4, postTopY - 0.02, BZ - 0.08], seat], 0.032, { sides: 10, steps: 8, round: 1 }));
    metalAdd(tube([seat, mPoint(M, -Math.sign(t.x) * (t.r + 0.002), -0.03, 0.08)], 0.06, { sides: 12, steps: 1, round: 1, straight: true }));
  }

  // --- the snare ----------------------------------------------------------------------------------------
  const SNX = 0.66; const SNY = 2.0; const SNZ = -0.98; const SR = 14 / 24; const SD = 5.5 / 12;
  const MS = tiltM(SNX, SNY, SNZ, -0.1, -0.03);
  drum(MS, { r: SR, d: SD, lugs: 8 });
  tripod(SNX, SNZ, SNY - SD / 2 - 0.2, { spread: 0.58, collarY: 0.62, lowerY: 0.3, joint: 1.1 });
  // The basket: three arms out from the top of the stand to rubber-tipped forks under the rim.
  {
    const hub = [SNX, SNY - SD / 2 - 0.22, SNZ];
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2 + 0.2;
      const out = mPoint(MS, Math.sin(a) * (SR + 0.03), -SD / 2 - 0.05, Math.cos(a) * (SR + 0.03));
      metalAdd(rod(hub, out, 0.018, 8));
      metalAdd(tube([out, mPoint(MS, Math.sin(a) * (SR + 0.035), -SD / 2 + 0.03, Math.cos(a) * (SR + 0.035))], 0.022, { sides: 8, steps: 1, round: 1, straight: true }));
    }
    // THE SNARES, on the card and under the bottom head: a bed of twenty coiled wires stretched
    // across it, each a real strand. They lie against the bottom head, and that is the drum's sound.
    const yB = -SD / 2 - 0.075 - 0.015;
    const strands = 20; const width = 0.3; const reach = SR * 0.9;
    for (let i = 0; i < strands; i += 1) {
      const x = mix(-width / 2, width / 2, i / (strands - 1));
      const pts = [];
      const coils = 7;
      for (let k = 0; k <= coils; k += 1) {
        const t = k / coils;
        pts.push(mPoint(MS, x, yB, mix(-reach, reach, t)));
      }
      metalAdd(tube(pts, 0.0042, { sides: 4, steps: coils, round: 0 }));
    }
    // Their end plates, the strainer with its throw-off lever on the near side, and the butt on the far.
    for (const e of [-1, 1]) {
      metalAdd(tube([mPoint(MS, -width / 2 - 0.03, yB, e * reach), mPoint(MS, width / 2 + 0.03, yB, e * reach)], 0.012, { sides: 6, steps: 1, round: 1, straight: true, section: () => [1.6, 0.8] }));
      metalAdd(tube([mPoint(MS, 0, yB + 0.004, e * reach), mPoint(MS, 0, yB + 0.09, e * (SR + 0.06)), mPoint(MS, 0, 0.0, e * (SR + 0.055))], 0.016, { sides: 7, steps: 6, round: 1 }));
      metalAdd(tube([mPoint(MS, -0.05, 0, e * (SR + 0.03)), mPoint(MS, 0.05, 0, e * (SR + 0.03))], 0.04, { sides: 8, steps: 1, round: 1, straight: true }));
    }
    metalAdd(tube([mPoint(MS, 0.05, 0.01, -(SR + 0.06)), mPoint(MS, 0.16, 0.03, -(SR + 0.07))], 0.012, { sides: 6, steps: 1, round: 1, straight: true }));
  }

  // --- the floor tom, standing on its own three legs --------------------------------------------------------
  {
    const FTX = -1.42; const FTZ = -0.86; const FTR = 16 / 24; const FTD = 1.33;
    const FTY = 1.28;
    const M = new THREE.Matrix4().makeTranslation(FTX, FTY, FTZ);
    drum(M, { r: FTR, d: FTD, lugs: 8, doubleLug: true });
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      const s = Math.sin(a); const c = Math.cos(a);
      const bracket = lathe([[0, -0.1], [0.05, -0.1], [0.05, 0.1], [0, 0.1]], 10);
      bracket.translate(FTX + s * (FTR + 0.03), FTY + 0.05, FTZ + c * (FTR + 0.03));
      metalAdd(bracket);
      const foot = [FTX + s * (FTR + 0.16), RUG + 0.04, FTZ + c * (FTR + 0.16)];
      metalAdd(rod([FTX + s * (FTR + 0.05), FTY + 0.18, FTZ + c * (FTR + 0.05)], foot, 0.027, 10));
      const tip = lathe([[0, 0], [0.042, 0], [0.042, 0.05], [0.03, 0.07], [0, 0.07]], 10);
      tip.translate(foot[0], RUG, foot[2]);
      dark.push({ geometry: tip, color: 0x18181a });
    }
    // A pair of hickory sticks left lying across it.
    const yTop = FTY + FTD / 2 + 0.06;
    const stick = (x0, z0, x1, z1, lift) => {
      const a = [FTX + x0, yTop + 0.03 + lift, FTZ + z0]; const b = [FTX + x1, yTop + 0.03 + lift, FTZ + z1];
      const g = tube([a, [mix(a[0], b[0], 0.72), a[1], mix(a[2], b[2], 0.72)], [mix(a[0], b[0], 0.97), a[1], mix(a[2], b[2], 0.97)], b], [0.03, 0.03, 0.012, 0.018], { sides: 9, steps: 12, round: 2 });
      dark.push({ geometry: g, color: 0xd2a970 });
    };
    stick(-0.46, -0.3, 0.66, 0.42, 0);
    stick(-0.36, -0.46, 0.8, 0.22, 0.026);
  }

  // --- the hi-hat --------------------------------------------------------------------------------------------
  {
    const X = 1.76; const Z = -0.86;
    const topY = 3.08;
    tripod(X, Z, 2.68, { spread: 0.56, collarY: 0.5, lowerY: 0.3, joint: 1.6 });
    const HR = 14 / 24;
    // Two cymbals face to face, edges almost touching: the upper one bell up, the lower turned over
    // on the stand's cup, which is the rotation that keeps it right way out.
    const yL = 2.78; const yU = yL + 0.082;
    cymbal(new THREE.Matrix4().makeTranslation(X, yL, Z).multiply(new THREE.Matrix4().makeRotationX(Math.PI)), HR, { bellH: 0.09, fall: 0.06, seg: 72 });
    cymbal(new THREE.Matrix4().makeTranslation(X, yU, Z), HR, { bellH: 0.09, fall: 0.06, seg: 72 });
    metalAdd(rod([X, 0.4, Z], [X, topY, Z], 0.013, 8));
    metalAdd(bake(lathe([[0, -0.05], [0.032, -0.05], [0.04, 0.0], [0.032, 0.05], [0, 0.05]], 12), new THREE.Matrix4().makeTranslation(X, yU + 0.16, Z)));
    // The pedal: its own footboard, and the pull rod down the middle of the tube.
    const plateY = RUG + 0.012;
    const heel = [X - 0.02, plateY + 0.05, Z - 1.08]; const toe = [X, plateY + 0.34, Z - 0.3];
    dark.push({ geometry: extrudeOutlineSimpleY([[X - 0.16, Z - 0.16], [X + 0.16, Z - 0.16], [X + 0.14, Z - 1.14], [X - 0.16, Z - 1.14]], plateY, 0.02), color: 0x2a2a2d });
    timberMetal(dark, 0x3a3a3e, heel, toe, 0.28, 0.03);
    metalAdd(rod([X, toe[1] + 0.01, toe[2] + 0.02], [X, 0.42, Z], 0.016, 7));
  }

  // --- the crash, on a boom ---------------------------------------------------------------------------------
  const boom = (bx, bz, top, tx, ty, tz, R, tiltX, tiltZ, seg) => {
    tripod(bx, bz, top, { spread: 0.62, collarY: 0.74, lowerY: 0.32, joint: top * 0.6 });
    // The boom's own knuckle, then the arm out to the cymbal, with a counterweight on its short end.
    const kn = [bx, top + 0.02, bz];
    metalAdd(new THREE.SphereGeometry(0.06, 12, 8).translate(kn[0], kn[1], kn[2]));
    const end = [tx, ty - 0.04, tz];
    metalAdd(rod(kn, end, 0.024, 10));
    const back = norm(sub(kn, end));
    const cw = add(kn, scl(back, 0.32));
    metalAdd(rod(kn, cw, 0.024, 10));
    metalAdd(tube([add(cw, scl(back, -0.02)), add(cw, scl(back, 0.1))], 0.05, { sides: 12, steps: 1, round: 1, straight: true }));
    const M = tiltM(tx, ty, tz, tiltX, tiltZ);
    metalAdd(rod(end, mPoint(M, 0, 0.1, 0), 0.016, 8));
    cymbal(M, R, { seg });
  };
  boom(2.15, 0.62, 3.15, 1.3, 4.0, 0.2, 16 / 24, -0.2, 0.12, 72);

  // --- the ride, the big one on the drummer's right ---------------------------------------------------------
  boom(-2.3, 0.45, 2.75, -1.62, 3.32, 0.02, 20 / 24, -0.16, -0.14, 80);

  // --- the stool ----------------------------------------------------------------------------------------------
  {
    const X = 0; const Z = -2.36; const H = 1.86;
    tripod(X, Z, H - 0.08, { spread: 0.56, collarY: 0.5, lowerY: 0.26, r0: 0.06, r1: 0.05, joint: 1.1 });
    const seat = lathe([[0, H - 0.1], [0.48, H - 0.1], [0.545, H - 0.06], [0.565, H], [0.545, H + 0.08], [0.45, H + 0.13], [0.24, H + 0.155], [0, H + 0.16]], 40);
    seat.translate(X, 0, Z);
    dark.push({ geometry: seat, keepColor: true, tint: (p) => { const r = Math.hypot(p.x - X, p.z - Z); return r > 0.5 ? lin(0x1c1c20) : lin(0x2a2a30); } });
    const under = lathe([[0, H - 0.14], [0.2, H - 0.14], [0.2, H - 0.09], [0, H - 0.09]], 20);
    under.translate(X, 0, Z);
    metalAdd(under);
  }

  // --- the rug, under all of it --------------------------------------------------------------------------------
  const RX = 3.0; const RZ0 = -3.15; const RZ1 = 1.95;
  const rugS = new Soup();
  rugS.face([[-RX, RUG, RZ0], [RX, RUG, RZ0], [RX, RUG, RZ1], [-RX, RUG, RZ1]], [1, 1, 1], [0, 1, 0], { uv: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  const edgeC = lin(0x4d1c18);
  rugS.face([[-RX, 0, RZ1], [RX, 0, RZ1], [RX, RUG, RZ1], [-RX, RUG, RZ1]], edgeC, [0, 0, 1], { uv: [[0, 0], [0, 0], [0, 0], [0, 0]] });
  rugS.face([[-RX, 0, RZ0], [RX, 0, RZ0], [RX, RUG, RZ0], [-RX, RUG, RZ0]], edgeC, [0, 0, -1], { uv: [[0, 0], [0, 0], [0, 0], [0, 0]] });
  rugS.face([[RX, 0, RZ0], [RX, 0, RZ1], [RX, RUG, RZ1], [RX, RUG, RZ0]], edgeC, [1, 0, 0], { uv: [[0, 0], [0, 0], [0, 0], [0, 0]] });
  rugS.face([[-RX, 0, RZ0], [-RX, 0, RZ1], [-RX, RUG, RZ1], [-RX, RUG, RZ0]], edgeC, [-1, 0, 0], { uv: [[0, 0], [0, 0], [0, 0], [0, 0]] });
  rugS.face([[-RX, 0, RZ0], [RX, 0, RZ0], [RX, 0, RZ1], [-RX, 0, RZ1]], edgeC, [0, -1, 0], { uv: [[0, 0], [0, 0], [0, 0], [0, 0]] });
  const rugTex = canvasTexture(1024, 1024, (ctx, w, h) => {
    const r2 = seededRandom(404);
    ctx.fillStyle = '#7d2a22';
    ctx.fillRect(0, 0, w, h);
    const band = (m, col) => { ctx.strokeStyle = col; ctx.lineWidth = m[1]; ctx.strokeRect(m[0], m[0], w - 2 * m[0], h - 2 * m[0]); };
    band([34, 28], '#2a2333');
    band([64, 8], '#d8b777');
    band([86, 16], '#7b2a22');
    band([104, 6], '#d8b777');
    // A row of diamonds round the border, and a medallion the drum kit stands on.
    ctx.fillStyle = '#d8b777';
    const dia = (x, y, r) => { ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); };
    for (let i = 0; i < 26; i += 1) {
      const t = (i + 0.5) / 26;
      for (const [x, y] of [[t * w, 34], [t * w, h - 34], [34, t * h], [w - 34, t * h]]) dia(x, y, 9);
    }
    ctx.fillStyle = '#2a2333';
    dia(w / 2, h / 2, 330);
    ctx.fillStyle = '#7d2a22';
    dia(w / 2, h / 2, 296);
    ctx.fillStyle = '#b07a4a';
    dia(w / 2, h / 2, 210);
    ctx.fillStyle = '#2a2333';
    dia(w / 2, h / 2, 130);
    // Weave: short tufts of light and dark over everything.
    for (let i = 0; i < 26000; i += 1) {
      const v = r2() > 0.5 ? 255 : 0;
      ctx.fillStyle = `rgba(${v},${v},${v},${0.03 + r2() * 0.07})`;
      ctx.fillRect(r2() * w, r2() * h, 1 + r2() * 2.4, 1);
    }
  });
  const rugMesh = mesh(rugS.geometry(), standard({ vertexColors: true, map: rugTex, roughness: 0.97, metalness: 0 }));

  // --- materials --------------------------------------------------------------------------------------------
  const sparkle = (() => {
    const r2 = seededRandom(1962);
    const t = canvasTexture(1024, 512, (ctx, w, h) => {
      ctx.fillStyle = '#143f9e';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 30000; i += 1) {
        const roll = r2();
        const v = roll > 0.72 ? ['#8fbaff', '#d6e6ff', '#ffffff'][Math.floor(r2() * 3)] : roll > 0.36 ? '#2c67d8' : '#0c2c76';
        const s = roll > 0.93 ? 2.4 : 1.3;
        ctx.fillStyle = v;
        ctx.globalAlpha = 0.45 + r2() * 0.55;
        ctx.fillRect(r2() * w, r2() * h, s, s);
      }
      ctx.globalAlpha = 1;
    });
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    return t;
  })();
  const shellMesh = mesh(mergeParts(shells), standard({ vertexColors: true, map: sparkle, roughness: 0.22, metalness: 0.25 }));

  const coated = (() => {
    const r2 = seededRandom(70);
    return canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#ecebe2';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i += 1) {
        const v = 215 + r2() * 40;
        ctx.fillStyle = `rgba(${v},${v},${v * 0.97},0.35)`;
        ctx.fillRect(r2() * w, r2() * h, 1.6, 1.6);
      }
      // Stick wear where the sticks land, and the head's dark collar at the rim.
      for (let i = 0; i < 300; i += 1) {
        const a = r2() * 6.283; const d = r2() * 120;
        ctx.fillStyle = `rgba(136,132,120,${0.05 + r2() * 0.13})`;
        ctx.beginPath();
        ctx.ellipse(w / 2 + Math.cos(a) * d - 8, h / 2 + Math.sin(a) * d + 10, 2 + r2() * 5, 1 + r2() * 2, r2() * 3, 0, 6.283);
        ctx.fill();
      }
    });
  })();
  const headMesh = mesh(mergeParts(heads), standard({ vertexColors: true, map: coated, roughness: 0.62, metalness: 0 }));

  const metalMesh = mesh(mergeParts(metal), standard({ vertexColors: true, roughness: 0.26, metalness: 0.45 }));
  const cymbalMap = cymbalTexture();
  const bronzeMesh = mesh(mergeParts(bronze), standard({ vertexColors: true, map: cymbalMap, roughness: 0.34, metalness: 0.25 }));
  const darkMesh = mesh(mergeParts(dark), standard({ vertexColors: true, roughness: 0.62, metalness: 0.05 }));
  return group(shellMesh, headMesh, metalMesh, bronzeMesh, darkMesh, rugMesh);
}

// mergeParts' tint callback, applied up front because a head's colour has to survive the matrix.
function tintGeo(g, fn) {
  const P = g.attributes.position;
  const col = new Float32Array(P.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < P.count; i += 1) {
    p.set(P.getX(i), P.getY(i), P.getZ(i));
    const c = fn(p);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// A flat plate from a plan outline in (x, z), wound by measurement.
function extrudeOutlineSimpleY(plan, y, h) {
  const s = new Soup();
  const white = [1, 1, 1];
  const cx = plan.reduce((v, p) => v + p[0], 0) / plan.length;
  const cz = plan.reduce((v, p) => v + p[1], 0) / plan.length;
  for (let i = 0; i < plan.length; i += 1) {
    const a = plan[i]; const b = plan[(i + 1) % plan.length];
    const out = [(a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz];
    s.face([[a[0], y, a[1]], [b[0], y, b[1]], [b[0], y + h, b[1]], [a[0], y + h, a[1]]], white, out);
    s.face([[cx, y + h, cz], [a[0], y + h, a[1]], [b[0], y + h, b[1]]], white, [0, 1, 0]);
    s.face([[cx, y, cz], [a[0], y, a[1]], [b[0], y, b[1]]], white, [0, -1, 0]);
  }
  return s.geometry();
}

function timberMetal(list, color, a, b, w, h) {
  const g = beamGeo(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), w, h, { color, chamfer: 0.008, capShade: 0.8 });
  list.push({ geometry: fromTo(g, a, b, [0, 1, 0]), keepColor: true });
}

export const BUILDERS = {
  'golden-gate-bridge': goldenGateBridge,
  'petra-treasury': petraTreasury,
  'sydney-opera-house': sydneyOperaHouse,
  'potters-wheel': pottersWheel,
  'drum-kit': drumKit,
};
