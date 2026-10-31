// The village kit's crops: four 20ft plots that tile, and one apple tree.
//
// A FIELD IS MANY CHEAP PLANTS. A student may lay out twenty of these, so a plot is 18k triangles
// and its plants are merged bundles: alpha-tested crossed cards for what is fine and many (a tuft
// of wheat, a carrot top, a cluster of apple leaves), and thin real ribbons for what has to arch in
// space (a corn leaf, a rice blade). The shape is geometry and everything else is a NEAR-WHITE
// atlas multiplied by a vertex colour, the flower bed's rule, so one painted tuft serves a whole
// field with no two the same colour.
//
// THE TILE, which is what these models are for.
//   - Each plot occupies EXACTLY x and z from -10 to +10, and no plant crosses that line.
//   - Everything that varies over the soil (height, colour, the soil map's UVs) repeats exactly
//     every 20ft in both directions, so what stands at x = +10 is what the next copy's x = -10
//     needs. `tileNoise` is why: integer frequencies only.
//   - Rows are spaced so that the distance across a join is the distance between any two rows.
//   - The soil slopes softly away from its crest and reaches about y = 0.03 at the very edge, and
//     only THEN does it drop straight down to y = -0.4. The slope therefore happens above the grass
//     and the plunge below it. Slope all the way down to -0.4 and the grass comes through as a green
//     stripe between every pair of plots, which is exactly the border the tile must not have. On
//     the X sides the edge is simply the bottom of a furrow, so the join IS a furrow.
import * as THREE from 'three';
import { mergeParts } from '../../props/LoftKit.js';
import { seededRandom, canvasTexture, standard, mesh, group } from '../../PropKit.js';
import {
  lin, mix, clamp01, sstep, tube, Sculpt, sphereP, curveP, polygonize,
} from '../ModelKit.js';

const TAU = Math.PI * 2;
const EDGE = 10;
const LIMIT = 9.97; // no plant reaches further than this
const SKIRT_Y = -0.4;
const K = (2 * Math.PI) / 20;

const times = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const wrap20 = (v) => { const r = ((v + EDGE) % 20 + 20) % 20; return r - EDGE; };

// Noise that repeats every 20ft in x and in z: a short Fourier sum with whole-number frequencies.
function tileNoise(seed, terms = 7, maxFreq = 5) {
  const rng = seededRandom(seed * 2654435 + 977);
  for (let i = 0; i < 5; i++) rng();
  const T = [];
  let sum = 0;
  for (let i = 0; i < terms; i++) {
    let fx = Math.floor(rng() * (maxFreq + 1));
    const fz = Math.floor(rng() * (maxFreq + 1));
    if (!fx && !fz) fx = 1;
    const a = 1 / (0.6 + Math.hypot(fx, fz) * 0.4);
    T.push([fx * K * (rng() < 0.5 ? -1 : 1), fz * K, rng() * TAU, a]);
    sum += a;
  }
  return (x, z) => {
    let v = 0;
    for (const t of T) v += t[3] * Math.cos(t[0] * x + t[1] * z + t[2]);
    return (v / sum) * 1.6;
  };
}

// ---------------------------------------------------------------------------------------------
// A merged batch of plain arrays. A field is tens of thousands of numbers, and building a geometry
// per leaf only to merge them again costs far more than the field does.
// ---------------------------------------------------------------------------------------------
class Batch {
  constructor() { this.P = []; this.N = []; this.U = []; this.C = []; this.I = []; this.n = 0; }

  v(x, y, z, nx, ny, nz, u, v, c) {
    this.P.push(x, y, z); this.N.push(nx, ny, nz); this.U.push(u, v); this.C.push(c[0], c[1], c[2]);
    return this.n++;
  }

  tri(a, b, c) { this.I.push(a, b, c); }

  quad(a, b, c, d) { this.I.push(a, b, c, a, c, d); }

  // Copies another batch through a matrix, with an optional recolour of each vertex.
  add(other, matrix, recolour = null) {
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const p = new THREE.Vector3(); const q = new THREE.Vector3();
    const base = this.n;
    const out = [0, 0, 0];
    for (let i = 0; i < other.n; i++) {
      const lx = other.P[i * 3]; const ly = other.P[i * 3 + 1]; const lz = other.P[i * 3 + 2];
      p.set(lx, ly, lz).applyMatrix4(matrix);
      q.set(other.N[i * 3], other.N[i * 3 + 1], other.N[i * 3 + 2]).applyMatrix3(nm).normalize();
      out[0] = other.C[i * 3]; out[1] = other.C[i * 3 + 1]; out[2] = other.C[i * 3 + 2];
      if (recolour) recolour(lx, ly, lz, out);
      this.v(p.x, p.y, p.z, q.x, q.y, q.z, other.U[i * 2], other.U[i * 2 + 1], out);
    }
    for (const idx of other.I) this.I.push(base + idx);
  }

  // The rule that a plant never crosses the plot's edge, as a guarantee rather than a hope. Placement
  // keeps everything inside already; this catches the last inch of a leaf's width.
  keepInside(limit = LIMIT) {
    for (let i = 0; i < this.n; i++) {
      for (const k of [i * 3, i * 3 + 2]) {
        if (this.P[k] > limit) this.P[k] = limit;
        else if (this.P[k] < -limit) this.P[k] = -limit;
      }
    }
    return this;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setIndex(this.I);
    return g;
  }
}

// A solid of revolution, bottom-up, axis to axis, into a batch. `colorAt(y, angle, out)` paints it.
function latheInto(b, profile, sides, region, colorAt, { warp = null } = {}) {
  const rows = profile.length;
  const start = b.n;
  const c = [1, 1, 1];
  for (let i = 0; i < rows; i++) {
    const prev = profile[Math.max(0, i - 1)]; const next = profile[Math.min(rows - 1, i + 1)];
    let nr = next[1] - prev[1]; let ny = -(next[0] - prev[0]);
    const l = Math.hypot(nr, ny) || 1; nr /= l; ny /= l;
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * TAU;
      const sa = Math.sin(a); const ca = Math.cos(a);
      const r = profile[i][0] * (warp ? warp(a, i / (rows - 1)) : 1);
      colorAt(profile[i][1], a, c);
      b.v(r * sa, profile[i][1], r * ca, nr * sa, ny, nr * ca, mix(region[0], region[1], j / sides), mix(region[2], region[3], i / (rows - 1)), c);
    }
  }
  const stride = sides + 1;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = start + i * stride + j; const e = a + 1; const f = a + stride + 1; const g = a + stride;
      if (profile[i][0] === 0) b.tri(a, f, g);
      else if (profile[i + 1][0] === 0) b.tri(a, e, f);
      else b.quad(a, e, f, g);
    }
  }
}

// A thin closed tube in a batch, parallel transported, wound outward.
function tubeInto(b, pts, radii, sides, region, colorAt) {
  const n = pts.length;
  const V = pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const T = V.map((p, i) => V[Math.min(n - 1, i + 1)].clone().sub(V[Math.max(0, i - 1)]).normalize());
  let N = Math.abs(T[0].y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const start = b.n;
  const u = (region[0] + region[1]) / 2; const w = (region[2] + region[3]) / 2;
  const c = [1, 1, 1];
  const B = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    N = N.clone().addScaledVector(T[i], -N.dot(T[i])).normalize();
    B.crossVectors(T[i], N).normalize();
    const r = Array.isArray(radii) ? radii[i] : radii;
    colorAt(i / (n - 1), c);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * TAU;
      const nx = N.x * Math.cos(a) + B.x * Math.sin(a);
      const ny = N.y * Math.cos(a) + B.y * Math.sin(a);
      const nz = N.z * Math.cos(a) + B.z * Math.sin(a);
      b.v(V[i].x + nx * r, V[i].y + ny * r, V[i].z + nz * r, nx, ny, nz, u, w, c);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      b.quad(start + i * sides + j, start + i * sides + j2, start + (i + 1) * sides + j2, start + (i + 1) * sides + j);
    }
  }
  // Closed at both ends by a pole.
  colorAt(1, c);
  const end = V[n - 1].clone().addScaledVector(T[n - 1], (Array.isArray(radii) ? radii[n - 1] : radii) * 0.6);
  const pole = b.v(end.x, end.y, end.z, T[n - 1].x, T[n - 1].y, T[n - 1].z, u, w, c);
  colorAt(0, c);
  const stop = V[0].clone().addScaledVector(T[0], -(Array.isArray(radii) ? radii[0] : radii) * 0.6);
  const pole0 = b.v(stop.x, stop.y, stop.z, -T[0].x, -T[0].y, -T[0].z, u, w, c);
  for (let j = 0; j < sides; j++) {
    const j2 = (j + 1) % sides;
    b.tri(pole, start + (n - 1) * sides + j, start + (n - 1) * sides + j2);
    b.tri(pole0, start + j2, start + j);
  }
}

// A ribbon along a curve. Used under a DoubleSide material, so its one sheet shows both ways and its
// normal is the true one. A width of 0 ends in a point with one triangle rather than a sliver.
function ribbonInto(b, pts, widths, region, colorAt, sideHint = null) {
  const n = pts.length;
  const c = [1, 1, 1];
  const rows = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)]; const e = pts[Math.min(n - 1, i + 1)];
    const t = new THREE.Vector3(e[0] - a[0], e[1] - a[1], e[2] - a[2]).normalize();
    let s = sideHint ? new THREE.Vector3(sideHint[0], sideHint[1], sideHint[2]) : new THREE.Vector3().crossVectors(t, up);
    if (s.lengthSq() < 1e-6) s = new THREE.Vector3(1, 0, 0);
    s.addScaledVector(t, -s.dot(t)).normalize();
    const nrm = new THREE.Vector3().crossVectors(s, t).normalize();
    const w = widths[i] * 0.5;
    const v = mix(region[2], region[3], i / (n - 1));
    colorAt(i / (n - 1), c);
    const L = b.v(p[0] - s.x * w, p[1] - s.y * w, p[2] - s.z * w, nrm.x, nrm.y, nrm.z, region[0], v, c);
    const R = w > 0 ? b.v(p[0] + s.x * w, p[1] + s.y * w, p[2] + s.z * w, nrm.x, nrm.y, nrm.z, region[1], v, c) : L;
    rows.push([L, R]);
  }
  for (let i = 0; i < n - 1; i++) {
    const [a, e] = rows[i]; const [d, f] = rows[i + 1];
    if (d === f) b.tri(a, e, d);
    else if (a === e) b.tri(a, f, d);
    else b.quad(a, e, f, d);
  }
}

// A vertical quad of a few rows, emitted twice back to back with normals leaned upward. A field of
// these lit by their true normals goes half dark from any one side, and a DoubleSide material would
// flip a leaned normal under the ground. So a card costs double and every tuft takes the sun alike.
function standingCard(b, x, y, z, yaw, halfWidth, rows, region, { lean = [0, 0], up = 0.92 } = {}) {
  const wx = Math.cos(yaw); const wz = Math.sin(yaw);
  const nx = -wz; const nz = wx;
  const emit = (sign) => {
    const fx = nx * sign * 0.42; const fz = nz * sign * 0.42;
    const l = Math.hypot(fx, up, fz);
    const ids = [];
    rows.forEach(({ h, color, v }) => {
      const k = h / rows[rows.length - 1].h;
      const lx = lean[0] * k * k; const lz = lean[1] * k * k;
      const vv = mix(region[2], region[3], v);
      ids.push([
        b.v(x + lx - wx * halfWidth, y + h, z + lz - wz * halfWidth, fx / l, up / l, fz / l, region[0], vv, color),
        b.v(x + lx + wx * halfWidth, y + h, z + lz + wz * halfWidth, fx / l, up / l, fz / l, region[1], vv, color),
      ]);
    });
    for (let i = 0; i < ids.length - 1; i++) {
      const [a, e] = ids[i]; const [d, f] = ids[i + 1];
      if (sign > 0) b.quad(a, e, f, d); else b.quad(e, a, d, f);
    }
  };
  emit(1);
  emit(-1);
}

// How wide a card may be at this spot without any of it crossing the plot's edge.
function fitHalfWidth(x, z, yaw, hw, lean = [0, 0]) {
  const reachX = Math.abs(Math.cos(yaw)); const reachZ = Math.abs(Math.sin(yaw));
  let out = hw;
  if (reachX > 1e-3) out = Math.min(out, (LIMIT - Math.abs(x) - Math.abs(lean[0])) / reachX);
  if (reachZ > 1e-3) out = Math.min(out, (LIMIT - Math.abs(z) - Math.abs(lean[1])) / reachZ);
  return Math.max(0.04, out);
}

// A quad of a leaf or a flower, in one piece, under a DoubleSide material.
function flatCard(b, centre, right, forward, region, color, normal = null) {
  const n = normal ?? new THREE.Vector3().crossVectors(right, forward).normalize();
  const c = centre;
  const a = b.v(c.x - right.x - forward.x, c.y - right.y - forward.y, c.z - right.z - forward.z, n.x, n.y, n.z, region[0], region[2], color);
  const e = b.v(c.x + right.x - forward.x, c.y + right.y - forward.y, c.z + right.z - forward.z, n.x, n.y, n.z, region[1], region[2], color);
  const f = b.v(c.x + right.x + forward.x, c.y + right.y + forward.y, c.z + right.z + forward.z, n.x, n.y, n.z, region[1], region[3], color);
  const d = b.v(c.x - right.x + forward.x, c.y - right.y + forward.y, c.z - right.z + forward.z, n.x, n.y, n.z, region[0], region[3], color);
  b.quad(a, e, f, d);
}

// ---------------------------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------------------------

// The background is white at almost no alpha rather than transparent black. A transparent pixel on
// a canvas has no colour of its own, so filtering would mix black into every edge of every leaf and
// each mip level would draw a darker outline round it. This stays far below the alpha test.
function atlasTexture(w, h, paint) {
  return canvasTexture(w, h, (ctx, W, H) => {
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(0, 0, W, H);
    paint(ctx, W, H);
  });
}

const rect = (x, y, w, h, W, H) => [x / W, (x + w) / W, 1 - (y + h) / H, 1 - y / H];

// A tiling soil map in feet: near white, so the vertex colours say what soil it is.
function soilTexture(seed, { clods = 300, specks = 900, dark = 170 } = {}) {
  const rng = seededRandom(seed * 7919 + 13);
  for (let i = 0; i < 4; i++) rng();
  const t = canvasTexture(256, 256, (ctx, W, H) => {
    ctx.fillStyle = '#f0ebe4';
    ctx.fillRect(0, 0, W, H);
    const wrapped = (x, y, r, fn) => {
      for (const ox of [-W, 0, W]) {
        for (const oy of [-H, 0, H]) {
          if (x + ox + r < 0 || x + ox - r > W || y + oy + r < 0 || y + oy - r > H) continue;
          fn(x + ox, y + oy);
        }
      }
    };
    for (let i = 0; i < clods; i++) {
      const x = rng() * W; const y = rng() * H; const r = 3 + rng() * 9;
      const light = rng() < 0.5;
      const v = light ? 255 : Math.round(dark + 45 + rng() * 40);
      ctx.fillStyle = `rgba(${v},${Math.round(v * 0.97)},${Math.round(v * 0.92)},0.55)`;
      wrapped(x, y, r * 1.3, (px, py) => { ctx.beginPath(); ctx.ellipse(px, py, r * 1.3, r * 0.9, rng() * 3, 0, TAU); ctx.fill(); });
    }
    for (let i = 0; i < specks; i++) {
      const x = rng() * W; const y = rng() * H; const s = 0.7 + rng() * 1.4;
      const v = rng() < 0.55 ? Math.round(dark + rng() * 45) : 255;
      ctx.fillStyle = `rgb(${v},${Math.round(v * 0.96)},${Math.round(v * 0.9)})`;
      wrapped(x, y, s, (px, py) => ctx.fillRect(px, py, s, s));
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------------------------
// The soil: a height field on a station grid with a vertical skirt to y = -0.4 and a closed base.
// Its normals come from the height function with the coordinates wrapped, so a shaded crease cannot
// appear at the join: both copies see the same slope there.
// ---------------------------------------------------------------------------------------------
function buildSoil({ xs, zs, height, color, tile = 4, skip = null, wall = null, floorY = null }) {
  const b = new Batch();
  const c = [1, 1, 1];
  const e = 0.07;
  const nx = xs.length; const nz = zs.length;
  const id = new Int32Array(nx * nz).fill(-1);
  const wanted = (i, j) => !skip || !skip(xs[i], zs[j]);
  const hAt = (x, z) => height(wrap20(x), wrap20(z));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = xs[i]; const z = zs[j];
      if (!wanted(i, j) && !(i < nx - 1 && j < nz - 1 && wanted(i + 1, j + 1)) && !(i > 0 && j > 0 && wanted(i - 1, j - 1)) && !(i < nx - 1 && j > 0 && wanted(i + 1, j - 1)) && !(i > 0 && j < nz - 1 && wanted(i - 1, j + 1)) && !(i < nx - 1 && wanted(i + 1, j)) && !(i > 0 && wanted(i - 1, j)) && !(j < nz - 1 && wanted(i, j + 1)) && !(j > 0 && wanted(i, j - 1))) continue;
      const y = height(x, z);
      const gx = (hAt(x + e, z) - hAt(x - e, z)) / (2 * e);
      const gz = (hAt(x, z + e) - hAt(x, z - e)) / (2 * e);
      const l = Math.hypot(gx, 1, gz);
      color(x, z, y, c);
      id[i * nz + j] = b.v(x, y, z, -gx / l, 1 / l, -gz / l, (x + EDGE) / tile, (z + EDGE) / tile, c);
    }
  }
  for (let i = 0; i < nx - 1; i++) {
    for (let j = 0; j < nz - 1; j++) {
      const a = id[i * nz + j]; const f = id[i * nz + j + 1]; const g = id[(i + 1) * nz + j + 1]; const d = id[(i + 1) * nz + j];
      if (a < 0 || f < 0 || g < 0 || d < 0) continue;
      const cx = (xs[i] + xs[i + 1]) / 2; const cz = (zs[j] + zs[j + 1]) / 2;
      if (skip && skip(cx, cz)) continue;
      b.quad(a, f, g, d);
    }
  }
  // The rim, walked so that each wall quad faces outward.
  const rim = [];
  for (let i = 0; i < nx; i++) rim.push([xs[i], -EDGE, 0, -1]);
  for (let j = 1; j < nz; j++) rim.push([EDGE, zs[j], 1, 0]);
  for (let i = nx - 2; i >= 0; i--) rim.push([xs[i], EDGE, 0, 1]);
  for (let j = nz - 2; j >= 1; j--) rim.push([-EDGE, zs[j], -1, 0]);
  const rows = wall ? wall.rows : [0, 1];
  const walls = rim.map(([x, z]) => {
    const top = height(x, z);
    return rows.map((t) => {
      const y = mix(top, SKIRT_Y, t);
      let px = x; let pz = z;
      const inset = wall ? wall.inset(x, z, t) : 0;
      if (inset) {
        if (Math.abs(x) >= EDGE - 1e-6) px -= Math.sign(x) * inset;
        if (Math.abs(z) >= EDGE - 1e-6) pz -= Math.sign(z) * inset;
      }
      color(x, z, y, c);
      const k = wall ? wall.shade(y) : 0.82;
      return [px, y, pz, c[0] * k, c[1] * k, c[2] * k];
    });
  });
  for (let r = 0; r < rim.length; r++) {
    const p = walls[r]; const q = walls[(r + 1) % rim.length];
    const dx = q[0][0] - p[0][0]; const dz = q[0][2] - p[0][2];
    const dl = Math.hypot(dx, dz) || 1;
    const nX = dz / dl; const nZ = -dx / dl;
    const ox = Math.abs(nX) > 0.5 ? 1 : 0;
    for (let t = 0; t < rows.length - 1; t++) {
      const col = (k) => [k[3], k[4], k[5]];
      const uvOf = (k) => [(ox ? k[2] + EDGE : k[0] + EDGE) / tile, (k[1] + 1) / tile];
      const a0 = p[t]; const b0 = q[t]; const b1 = q[t + 1]; const a1 = p[t + 1];
      const A = b.v(a0[0], a0[1], a0[2], nX, 0, nZ, ...uvOf(a0), col(a0));
      const B = b.v(b0[0], b0[1], b0[2], nX, 0, nZ, ...uvOf(b0), col(b0));
      const C = b.v(b1[0], b1[1], b1[2], nX, 0, nZ, ...uvOf(b1), col(b1));
      const D = b.v(a1[0], a1[1], a1[2], nX, 0, nZ, ...uvOf(a1), col(a1));
      b.quad(A, B, C, D);
    }
  }
  // The underside, so the solid is closed.
  const last = rows.length - 1;
  const dim = [0.1, 0.08, 0.05];
  const hub = b.v(0, SKIRT_Y, 0, 0, -1, 0, 0, 0, dim);
  const ring = walls.map((w) => b.v(w[last][0], SKIRT_Y, w[last][2], 0, -1, 0, 0, 0, dim));
  for (let r = 0; r < ring.length; r++) b.tri(hub, ring[r], ring[(r + 1) % ring.length]);
  if (floorY !== null) {
    const m = 8.8;
    const a = b.v(-m, floorY, -m, 0, 1, 0, 0, 0, dim); const d = b.v(-m, floorY, m, 0, 1, 0, 0, 1, dim);
    const f = b.v(m, floorY, m, 0, 1, 0, 1, 1, dim); const g = b.v(m, floorY, -m, 0, 1, 0, 1, 0, dim);
    b.quad(a, d, f, g);
  }
  return b;
}

function soilMesh(batch, seed, opts = {}, repeat = 1) {
  const map = soilTexture(seed, opts);
  map.repeat.set(repeat, repeat);
  return mesh(batch.geometry(), standard({ map, bumpMap: map, bumpScale: opts.bump ?? 1.2, vertexColors: true, roughness: 0.98, metalness: 0 }));
}

function plantMesh(batch, map, { doubleSide = false, alphaTest = 0.4, roughness = 0.85 } = {}) {
  const params = { map, alphaTest, vertexColors: true, roughness, metalness: 0 };
  if (doubleSide) params.side = THREE.DoubleSide;
  return mesh(batch.geometry(), standard(params));
}

function range(a, b, step) {
  const out = [];
  const n = Math.round((b - a) / step);
  for (let i = 0; i <= n; i++) out.push(a + (i * (b - a)) / n);
  return out;
}

const uniq = (list) => [...new Set(list.map((v) => Math.round(v * 1000) / 1000))].sort((p, q) => p - q);

// ---------------------------------------------------------------------------------------------
// Wheat
// ---------------------------------------------------------------------------------------------
const WHEAT_CARD_FT = 3.7;
const WHEAT_CARD_WIDE = 1.3;
const WHEAT_ROWS = 16;

function paintWheatVariant(ctx, ox, W, H, rng, stalks) {
  const pxX = W / WHEAT_CARD_WIDE; // pixels per foot across
  const pxY = H / WHEAT_CARD_FT; // and up
  ctx.lineCap = 'round';
  // A few blades low down, behind everything, for the green at the foot of the crop.
  for (let i = 0; i < 6; i++) {
    const x0 = ox + W * (0.12 + rng() * 0.76);
    const dir = rng() < 0.5 ? -1 : 1;
    const reach = W * (0.1 + rng() * 0.12);
    const y1 = H * (0.5 + rng() * 0.2);
    const g = 215 + Math.floor(rng() * 30);
    ctx.strokeStyle = `rgb(${g},${g},${g - 14})`;
    ctx.lineWidth = 6 + rng() * 4;
    ctx.beginPath();
    ctx.moveTo(x0, H);
    ctx.quadraticCurveTo(x0 + dir * reach * 0.3, y1 - H * 0.06, Math.max(ox + 4, Math.min(ox + W - 4, x0 + dir * reach)), y1 + H * 0.05);
    ctx.stroke();
  }
  // Tall stalks last, so the highest heads are the ones in front. Parallel rather than fanned: a
  // tuft whose stalks meet at a point is a shuttlecock, and a field of those is a field of dusters.
  const order = [];
  for (let s = 0; s < stalks; s++) order.push({ f: (s + 0.5) / stalks, tip: 0.09 + rng() * 0.2 });
  order.sort((p, q) => q.tip - p.tip);
  for (const { f, tip } of order) {
    const baseX = ox + W * (0.1 + 0.8 * f + (rng() - 0.5) * 0.05);
    const topX = Math.max(ox + W * 0.1, Math.min(ox + W * 0.9, baseX + (rng() - 0.5) * W * 0.09));
    const headLen = 0.62 * pxY;
    const headTip = H * tip;
    const headBase = headTip + headLen;
    const halfW = 0.085 * pxX;
    const nod = (rng() - 0.5) * W * 0.05;
    const g = 226 + Math.floor(rng() * 24);
    ctx.strokeStyle = `rgb(${g},${g},${g - 12})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(baseX, H);
    ctx.quadraticCurveTo(mix(baseX, topX, 0.5), H * 0.55, topX, headBase);
    ctx.stroke();
    // The beard: one awn off each spikelet, sweeping up past the tip of the head.
    const rowsN = 8;
    for (let k = 0; k < rowsN; k++) {
      const t = k / (rowsN - 1);
      const yy = mix(headBase, headTip, t);
      const xx = topX + nod * t;
      for (const side of [-1, 1]) {
        const ang = side * (0.1 + 0.16 * (1 - t) + rng() * 0.06);
        const len = (0.3 + 0.1 * rng()) * pxY;
        const sx = xx + side * halfW * 0.7;
        const a = 214 + Math.floor(rng() * 30);
        ctx.strokeStyle = `rgb(${a},${a},${a - 20})`;
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.moveTo(sx, yy);
        ctx.lineTo(Math.max(ox + 2, Math.min(ox + W - 2, sx + Math.sin(ang) * len)), Math.max(2, yy - Math.cos(ang) * len));
        ctx.stroke();
      }
    }
    // A dark outline is what keeps one head from melting into the head behind it at ten feet, then
    // plump paired grains, darker at the throat of each.
    ctx.fillStyle = '#a8925e';
    ctx.beginPath();
    ctx.ellipse(topX + nod * 0.5, (headBase + headTip) / 2, halfW * 1.14, headLen * 0.54, 0, 0, TAU);
    ctx.fill();
    for (let k = 0; k < rowsN; k++) {
      const t = k / (rowsN - 1);
      const yy = mix(headBase, headTip, t);
      const taper = 0.45 + 0.75 * Math.sin(Math.PI * clamp01(0.14 + t * 0.8));
      const xx = topX + nod * t;
      for (const side of [-1, 1]) {
        const v = 240 + Math.floor(rng() * 15);
        ctx.fillStyle = `rgb(${v},${v - 3},${v - 22})`;
        ctx.beginPath();
        ctx.ellipse(xx + side * halfW * 0.5 * taper, yy, halfW * 0.56 * taper, headLen * 0.068, side * 0.45, 0, TAU);
        ctx.fill();
      }
    }
  }
}

function wheatPlot() {
  const rng = seededRandom(0x57484541);
  for (let i = 0; i < 4; i++) rng();
  const ripple = tileNoise(11, 7, 5);
  const blotch = tileNoise(12, 9, 8);
  const sway = [tileNoise(13, 4, 3), tileNoise(14, 4, 3)];
  const P = 20 / WHEAT_ROWS;
  const fz = (z) => sstep(EDGE - Math.abs(z), 0, 0.85);
  const ridge = (x) => 0.5 - 0.5 * Math.cos((TAU * (x + EDGE)) / P);
  const height = (x, z) => 0.035 + fz(z) * (0.018 + 0.125 * ridge(x) + 0.012 * ripple(x, z));
  const dry = lin(0x8e6d48); const pale = lin(0xa98a60); const deep = lin(0x5e432b);
  const soil = buildSoil({
    xs: range(-EDGE, EDGE, P / 4),
    zs: uniq([-10, -9.7, -9.4, -9.1, -8.6, ...range(-8, 8, 2), 8.6, 9.1, 9.4, 9.7, 10]),
    height,
    color: (x, z, y, out) => {
      const t = clamp01((y - 0.03) / 0.14);
      const c = mix3(deep, dry, t);
      const m = 0.5 + 0.5 * blotch(x, z);
      const r = mix3(c, pale, m * 0.35);
      out[0] = r[0]; out[1] = r[1]; out[2] = r[2];
    },
  });

  const map = atlasTexture(512, 1024, (ctx, W, H) => {
    const tufts = seededRandom(424243);
    for (let i = 0; i < 5; i++) tufts();
    paintWheatVariant(ctx, 0, W / 2, H, tufts, 7);
    paintWheatVariant(ctx, W / 2, W / 2, H, tufts, 8);
  });
  const regions = [[0.004, 0.496, 0, 1], [0.504, 0.996, 0, 1]];

  const gold = lin(0xd9b24a);
  const amber = lin(0xc99a35);
  const straw = lin(0xe2c465);
  const green = lin(0x7f9a3a);
  const root = lin(0x4f5f25);
  const plants = new Batch();
  const ALONG = 36;
  const q = 20 / ALONG;
  for (let i = 0; i < WHEAT_ROWS; i++) {
    const x = -EDGE + (i + 0.5) * P;
    for (let j = 0; j < ALONG; j++) {
      // Alternate rows are staggered by half a step, which fills the view down the rows. Row 0 and
      // row 15 are odd neighbours across a join, so the stagger continues through it.
      const z = -EDGE + (j + (i % 2 ? 0.25 : 0.75)) * q + (rng() - 0.5) * 0.08;
      const lx = sway[0](x, z) * 0.18 + (rng() - 0.5) * 0.14;
      const lz = sway[1](x, z) * 0.18 + (rng() - 0.5) * 0.14;
      // The rows either side of a join do not lean across it. Any lean there has to come out of the
      // card's own width to stay inside the plot, which opens a slot of bare soil right along the
      // join: the one place the field must look the same as everywhere else.
      const lean = [
        i === 0 || i === WHEAT_ROWS - 1 ? 0 : Math.max(-1, Math.min(1, lx)) * 0.3,
        Math.max(-1, Math.min(1, lz)) * Math.min(0.3, Math.max(0, LIMIT - Math.abs(z) - 0.2)),
      ];
      const tall = WHEAT_CARD_FT * (0.92 + rng() * 0.1);
      const y = height(x, z) - 0.07;
      const hue = rng();
      const v = 0.94 + rng() * 0.14;
      const top = times(hue < 0.5 ? mix3(gold, amber, hue * 1.5) : mix3(gold, straw, (hue - 0.5) * 1.2), v);
      const mid = times(mix3(straw, green, 0.5 + rng() * 0.16), v * 0.95);
      const bottom = times(root, 0.8 + rng() * 0.2);
      const rows = [
        { h: 0, color: bottom, v: 0 },
        { h: tall * 0.5, color: mid, v: 0.5 },
        { h: tall, color: top, v: 1 },
      ];
      const spin = (rng() - 0.5) * 0.3;
      for (const a of [Math.PI / 2 + spin, Math.PI / 2 + spin + 1.05, Math.PI / 2 + spin - 1.05]) {
        const hw = fitHalfWidth(x, z, a, WHEAT_CARD_WIDE / 2, lean);
        let r = regions[rng() < 0.5 ? 0 : 1];
        if (rng() < 0.5) r = [r[1], r[0], r[2], r[3]];
        standingCard(plants, x, y, z, a, hw, rows, r, { lean });
      }
    }
  }
  // One more line of wheat right at each X edge, in cards lying along the edge so they cannot cross
  // it. A crossed tuft can only reach so far before its corners would leave the plot, which left the
  // join as a slot of bare soil when looked along. These close it, and are the same crop as the rest.
  for (const side of [-1, 1]) {
    for (let j = 0; j < ALONG; j += 2) {
      const x = side * (9.85 + rng() * 0.04);
      const z = -EDGE + (j + (side > 0 ? 0.5 : 1.5)) * q + (rng() - 0.5) * 0.3;
      // Every other step, at uneven heights: a solid line of these is a hedge, seen from outside.
      const tall = WHEAT_CARD_FT * (0.8 + rng() * 0.22);
      const hue = rng();
      const v = 0.94 + rng() * 0.14;
      const top = times(hue < 0.5 ? mix3(gold, amber, hue * 1.5) : mix3(gold, straw, (hue - 0.5) * 1.2), v);
      const rows = [
        { h: 0, color: times(root, 0.9), v: 0 },
        { h: tall * 0.5, color: times(mix3(straw, green, 0.56), v * 0.95), v: 0.5 },
        { h: tall, color: top, v: 1 },
      ];
      const lean = [0, Math.max(-0.2, Math.min(0.2, (rng() - 0.5) * 0.3))];
      const a = Math.PI / 2;
      let r = regions[rng() < 0.5 ? 0 : 1];
      if (rng() < 0.5) r = [r[1], r[0], r[2], r[3]];
      standingCard(plants, x, height(x, z) - 0.05, z, a, fitHalfWidth(x, z, a, WHEAT_CARD_WIDE / 2, lean), rows, r, { lean });
    }
  }
  return group(soilMesh(soil, 21, { dark: 165 }, 1), plantMesh(plants.keepInside(), map, { alphaTest: 0.36 }));
}

// ---------------------------------------------------------------------------------------------
// Rice
// ---------------------------------------------------------------------------------------------
const WATER_Y = 0.35;
const WATERLINE = 8.95; // where the bund's inner face meets the water
const BUND_TOP = 1.0;

function ricePaddy() {
  const rng = seededRandom(0x52494345);
  for (let i = 0; i < 4; i++) rng();
  const lump = tileNoise(31, 7, 5);
  const grass = tileNoise(32, 9, 9);
  const speck = tileNoise(33, 8, 7);
  const R = 1.1; // the inner corner is rounded: nobody digs a square corner in mud
  const inner = (x, z) => {
    const qx = Math.abs(x) - (WATERLINE - R); const qz = Math.abs(z) - (WATERLINE - R);
    return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - R;
  };
  const crest = (x, z) => BUND_TOP + 0.045 * lump(x, z);
  const height = (x, z) => {
    const s = inner(x, z);
    const o = Math.max(Math.abs(x), Math.abs(z));
    if (s < 0) return WATER_Y + Math.max(s * 0.5, -0.2);
    // Up the inner face to a flat crest that runs to within a few inches of the plot's edge, where
    // it rolls off by no more than a crease. So two copies make one wide bund rather than two.
    const up = WATER_Y + (crest(x, z) - WATER_Y) * sstep(s, 0, 0.42);
    return up - 0.14 * sstep(o, 9.86, 10);
  };
  const mud = lin(0x4f3a26); const earth = lin(0x6f5238); const dry = lin(0x85694a);
  const turf = lin(0x5f8436);
  const color = (x, z, y, out) => {
    let c = mix3(mud, earth, sstep(y, WATER_Y, WATER_Y + 0.3));
    c = mix3(c, dry, sstep(y, 0.75, 1.0) * (0.5 + 0.4 * speck(x, z)));
    // Bunds grow grass, and the tufts on top are what stops a long one reading as a poured kerb.
    c = mix3(c, turf, sstep(grass(x, z), -0.25, 0.3) * sstep(y, 0.5, 0.8) * 0.8);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  };
  const across = [-10, -9.98, -9.94, -9.9, -9.7, -9.5, -9.33, -9.2, -9.08, -8.95, -8.8, -8.65, -8.45, -8.2, -7.9];
  const line = uniq([...across, ...range(-7.6, 7.6, 0.8), ...across.map((v) => -v)]);
  const wallInset = tileNoise(34, 7, 9);
  const soil = buildSoil({
    xs: line,
    zs: line,
    height,
    color,
    skip: (x, z) => inner(x, z) < -0.45,
    floorY: 0.15,
    // The outer face of the bund: a cut earth bank with some give in it, darkening to the foot. It
    // has to end at exactly x = 10 at top and bottom, so a neighbour's face meets it there.
    wall: {
      rows: [0, 0.28, 0.56, 1],
      inset: (x, z, t) => (t > 0 && t < 1 ? (0.05 + 0.035 * wallInset(x, z)) * Math.sin(t * Math.PI) : 0),
      shade: (y) => mix(0.62, 0.92, sstep(y, 0, 0.9)),
    },
  });

  // The rows run along Z, a little closer within the row than across it, so the rows read.
  const ROW_X = 1.75; const ROW_Z = 1.2;
  const clumps = [];
  for (let i = -5; i < 5; i++) {
    for (let j = -7; j < 7; j++) {
      clumps.push([(i + 0.5) * ROW_X + (rng() - 0.5) * 0.08, (j + 0.5) * ROW_Z + (rng() - 0.5) * 0.08]);
    }
  }

  // Water reflects the sky, so it is painted rather than lit: the pale blue-green of a bright sky,
  // soft cloud, and under each clump the dark reflection and the ring that stand it in the water.
  const WATER_HALF = 9.3;
  const toPx = (v, W) => ((v + WATER_HALF) / (2 * WATER_HALF)) * W;
  const paint = seededRandom(0x77617465);
  for (let i = 0; i < 4; i++) paint();
  const waterMap = canvasTexture(512, 512, (ctx, W, H) => {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#86bfbd');
    g.addColorStop(0.5, '#74b0b4');
    g.addColorStop(1, '#82bcb6');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      const x = paint() * W; const y = paint() * H; const rx = 30 + paint() * 90; const ry = 14 + paint() * 36;
      const soft = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      soft.addColorStop(0, 'rgba(190,226,222,0.5)');
      soft.addColorStop(1, 'rgba(190,226,222,0)');
      ctx.save();
      ctx.translate(x, y); ctx.rotate(paint() * 0.6); ctx.scale(rx, ry);
      ctx.fillStyle = soft;
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
      ctx.restore();
    }
    const ppf = W / (2 * WATER_HALF);
    for (const [cx, cz] of clumps) {
      const x = toPx(cx, W); const y = toPx(cz, H);
      const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      shade.addColorStop(0, 'rgba(46,92,60,0.62)');
      shade.addColorStop(0.55, 'rgba(58,110,74,0.3)');
      shade.addColorStop(1, 'rgba(70,120,90,0)');
      ctx.save();
      ctx.translate(x, y); ctx.scale(ppf * 0.62, ppf * 0.62);
      ctx.fillStyle = shade;
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(214,238,234,0.38)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(x, y, ppf * 0.34, ppf * 0.34, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(214,238,234,0.16)';
      ctx.beginPath(); ctx.ellipse(x, y, ppf * 0.52, ppf * 0.52, 0, 0, TAU); ctx.stroke();
    }
  });
  const water = new Batch();
  {
    const white = [1, 1, 1];
    const a = water.v(-WATER_HALF, WATER_Y, -WATER_HALF, 0, 1, 0, 0, 1, white);
    const d = water.v(-WATER_HALF, WATER_Y, WATER_HALF, 0, 1, 0, 0, 0, white);
    const f = water.v(WATER_HALF, WATER_Y, WATER_HALF, 0, 1, 0, 1, 0, white);
    const g = water.v(WATER_HALF, WATER_Y, -WATER_HALF, 0, 1, 0, 1, 1, white);
    water.quad(a, d, f, g);
  }
  const waterMesh = mesh(water.geometry(), standard({
    map: waterMap, emissive: 0xffffff, emissiveMap: waterMap, emissiveIntensity: 0.16, roughness: 0.3, metalness: 0,
  }));
  // A mirror does not take shadows, and it casts none.
  waterMesh.receiveShadow = false;
  waterMesh.castShadow = false;

  // Each clump is a fountain of real ribbons: they have to arch in space, and from above a crossed
  // card is only ever a star.
  const deep = lin(0x2f8a2c); const bright = lin(0x62b52f); const tip = lin(0xa8d648);
  const plants = new Batch();
  const NONE = [0, 1, 0, 1];
  for (const [cx, cz] of clumps) {
    const blades = 14;
    const spin = rng() * TAU;
    const tone = 0.92 + rng() * 0.16;
    for (let k = 0; k < blades; k++) {
      const inside = k < 4;
      const az = spin + (k / blades) * TAU * 2.6 + (rng() - 0.5) * 0.4;
      const rise = (inside ? 2.05 : 1.55) * (0.92 + rng() * 0.16);
      const reach = (inside ? 0.2 : 0.42 + rng() * 0.3);
      const droop = inside ? 0.05 : 0.14 + rng() * 0.14;
      const dx = Math.sin(az); const dz = Math.cos(az);
      const r0 = 0.05 + (inside ? 0 : 0.05);
      const pts = [];
      for (let s = 0; s <= 3; s++) {
        const t = s / 3;
        const out = r0 + reach * t * t;
        const up = WATER_Y - 0.05 + rise * t - droop * t * t * t;
        pts.push([cx + dx * out, up, cz + dz * out]);
      }
      ribbonInto(plants, pts, [0.07, 0.085, 0.06, 0], NONE, (t, c) => {
        const m = t < 0.5 ? mix3(deep, bright, t * 2) : mix3(bright, tip, (t - 0.5) * 2);
        c[0] = m[0] * tone; c[1] = m[1] * tone; c[2] = m[2] * tone;
      }, [dz, 0, -dx]);
    }
  }
  // Grass on the bund, a few blades at a time, and never past the plot's edge.
  const sprig = lin(0x6b9a3a); const sprigTip = lin(0x9fbf55);
  for (let i = 0; i < 74; i++) {
    const side = i % 4; const along = (rng() - 0.5) * 19;
    const off = 9.48 + rng() * 0.42;
    const x = side === 0 ? off : side === 1 ? -off : along;
    const z = side === 2 ? off : side === 3 ? -off : along;
    if (grass(x, z) < -0.2) continue;
    const y = height(x, z) - 0.03;
    for (let k = 0; k < 4; k++) {
      const az = rng() * TAU; const tall = 0.4 + rng() * 0.45; const bend = Math.min(0.16 + rng() * 0.12, Math.max(0.02, LIMIT - Math.max(Math.abs(x), Math.abs(z))));
      const dx = Math.sin(az); const dz = Math.cos(az);
      const pts = [[x, y, z], [x + dx * bend * 0.25, y + tall * 0.6, z + dz * bend * 0.25], [x + dx * bend, y + tall, z + dz * bend]];
      ribbonInto(plants, pts, [0.05, 0.04, 0], NONE, (t, c) => { const m = mix3(sprig, sprigTip, t); c[0] = m[0]; c[1] = m[1]; c[2] = m[2]; }, [dz, 0, -dx]);
    }
  }
  const blades = mesh(plants.keepInside().geometry(), standard({ vertexColors: true, roughness: 0.62, metalness: 0, side: THREE.DoubleSide }));
  return group(soilMesh(soil, 41, { dark: 165, bump: 1 }, 1), waterMesh, blades);
}

// ---------------------------------------------------------------------------------------------
// The vegetable garden
// ---------------------------------------------------------------------------------------------
function paintLeafVeins(ctx, cx, topY, baseY, halfW, count) {
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = 'rgba(170,190,140,0.75)';
  ctx.beginPath(); ctx.moveTo(cx, baseY); ctx.lineTo(cx, topY); ctx.stroke();
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const y = mix(baseY, topY, t);
    const w = halfW * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)) * 0.95;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(cx, y); ctx.quadraticCurveTo(cx + s * w * 0.5, y - (baseY - topY) * 0.05, cx + s * w, y - (baseY - topY) * 0.13); ctx.stroke();
    }
  }
}

function vegetableGarden() {
  const rng = seededRandom(0x56454745);
  for (let i = 0; i < 4; i++) rng();
  const ripple = tileNoise(51, 7, 5);
  const blotch = tileNoise(52, 9, 8);
  const PATH = 1; // half the width of the path
  // Row centres, measured from the path out, the same on both sides.
  const ROWS = [2.15, 4.05, 5.95, 7.95];
  const ridgeAt = (ax) => {
    let v = 0;
    for (const r of ROWS) { const d = (ax - r) / 0.62; v = Math.max(v, Math.exp(-d * d)); }
    return v;
  };
  const edgeFall = (x, z) => sstep(EDGE - Math.abs(x), 0, 0.5) * sstep(EDGE - Math.abs(z), 0, 0.5);
  const onPath = (x) => 1 - sstep(Math.abs(x), PATH - 0.06, PATH + 0.1);
  const height = (x, z) => {
    const bed = 0.1 + 0.11 * ridgeAt(Math.abs(x)) + 0.012 * ripple(x, z);
    return 0.035 + mix(bed * edgeFall(x, z), 0.03 * sstep(EDGE - Math.abs(z), 0, 0.5) + 0.012, onPath(x));
  };
  const loam = lin(0x4a3321); const rich = lin(0x5f432b); const tamped = lin(0xa08a68);
  const soil = buildSoil({
    xs: uniq([-10, -9.75, -9.5, ...range(-9.2, -1.5, 0.4), -1.1, -1.0, -0.9, 0, 0.9, 1.0, 1.1, ...range(1.5, 9.2, 0.4), 9.5, 9.75, 10]),
    zs: uniq([-10, -9.75, -9.5, ...range(-9, 9, 3), 9.5, 9.75, 10]),
    height,
    color: (x, z, y, out) => {
      const c = mix3(mix3(loam, rich, 0.5 + 0.5 * blotch(x, z)), tamped, onPath(x));
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    },
  });

  // One small atlas, all of it near white, all of its colour from the vertices.
  const W = 512; const H = 512;
  const R = {
    white: rect(4, 4, 8, 8, W, H),
    cabbage: rect(0, 20, 170, 170, W, H),
    head: rect(176, 20, 80, 170, W, H),
    fern: rect(262, 0, 250, 250, W, H),
    bean: rect(0, 200, 126, 126, W, H),
    pod: rect(132, 200, 60, 126, W, H),
    woven: rect(0, 340, 340, 170, W, H),
  };
  const paint = seededRandom(0x76656721);
  for (let i = 0; i < 4; i++) paint();
  const map = atlasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(4, 4, 8, 8);
    ctx.lineCap = 'round';
    // A cabbage leaf: broad, with a crinkled edge the alpha test cuts.
    {
      const x0 = 0; const y0 = 20; const s = 170;
      ctx.fillStyle = '#f6f8ee';
      ctx.beginPath();
      for (let i = 0; i <= 44; i++) {
        const a = (i / 44) * TAU;
        const r = 0.47 + 0.028 * Math.sin(a * 9) + 0.018 * Math.sin(a * 17);
        const px = x0 + s / 2 + Math.cos(a) * s * r;
        const py = y0 + s / 2 + Math.sin(a) * s * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.fill();
      paintLeafVeins(ctx, x0 + s / 2, y0 + 8, y0 + s - 4, s * 0.45, 5);
    }
    // The tight head: pale, veined from the base up.
    ctx.fillStyle = '#fbfcf2';
    ctx.fillRect(176, 20, 80, 170);
    ctx.strokeStyle = 'rgba(176,194,146,0.6)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const x = 176 + 7 + i * 13.5;
      ctx.beginPath(); ctx.moveTo(x, 190); ctx.quadraticCurveTo(x + (i - 2.5) * 2, 110, x + (i - 2.5) * -3, 20); ctx.stroke();
    }
    // A carrot top: a fountain of finely cut fronds, drawn stem by stem.
    {
      const cx = 262 + 125; const by = 250;
      for (let f = 0; f < 11; f++) {
        const lean = (f - 5) / 5;
        const tipX = cx + lean * 108;
        const tipY = 14 + Math.abs(lean) * 74 + paint() * 10;
        const g = 236 + Math.floor(paint() * 18);
        ctx.strokeStyle = `rgb(${g},${g},${g - 14})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(cx + lean * 8, by); ctx.quadraticCurveTo(cx + lean * 36, (by + tipY) / 2, tipX, tipY); ctx.stroke();
        for (let k = 3; k <= 16; k++) {
          const t = k / 16;
          const mt = 1 - t;
          const bx = mt * mt * (cx + lean * 8) + 2 * mt * t * (cx + lean * 36) + t * t * tipX;
          const by2 = mt * mt * by + 2 * mt * t * ((by + tipY) / 2) + t * t * tipY;
          const len = 26 * Math.sin(Math.PI * clamp01(1.08 - t));
          ctx.lineWidth = 2.6;
          for (const s of [-1, 1]) {
            ctx.beginPath(); ctx.moveTo(bx, by2); ctx.lineTo(bx + s * len * 0.92 + lean * 3, by2 - len * 0.5); ctx.stroke();
          }
        }
      }
    }
    // A bean's three leaflets.
    {
      const x0 = 63; const y0 = 263;
      ctx.fillStyle = '#f4f8ea';
      for (const [dx, dy, rot, s] of [[0, -28, 0, 1], [-30, 14, -1.3, 0.86], [30, 14, 1.3, 0.86]]) {
        ctx.save();
        ctx.translate(x0 + dx, y0 + dy); ctx.rotate(rot); ctx.scale(s, s);
        ctx.beginPath();
        ctx.moveTo(0, 30); ctx.bezierCurveTo(-34, 20, -28, -18, 0, -32); ctx.bezierCurveTo(28, -18, 34, 20, 0, 30);
        ctx.fill();
        ctx.strokeStyle = 'rgba(170,190,140,0.8)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, 28); ctx.lineTo(0, -26); ctx.stroke();
        ctx.restore();
      }
    }
    // A pod, with the beans showing in it.
    ctx.fillStyle = '#ecf2d8';
    ctx.fillRect(132, 200, 60, 126);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(162, 216 + i * 24, 20, 11, 0, 0, TAU); ctx.fill(); }
    // Wattle: rods running left and right, passing in front of a stake then behind the next. The
    // sheet is one whole period wide and repeats at its edges.
    {
      const x0 = 0; const y0 = 340; const w = 340; const h = 170;
      ctx.fillStyle = '#a79a84';
      ctx.fillRect(x0, y0, w, h);
      const rods = 8;
      const rh = h / rods;
      for (let r = 0; r < rods; r++) {
        const y = y0 + (r + 0.5) * rh;
        const phase = r % 2 ? 0.5 : 0;
        for (let k = -1; k < 3; k++) {
          const cx = x0 + (k + phase + 0.25) * (w / 2);
          const v = 232 + Math.floor(paint() * 22);
          ctx.fillStyle = `rgb(${v},${v - 6},${v - 20})`;
          ctx.beginPath(); ctx.ellipse(cx, y, w * 0.27, rh * 0.5, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.beginPath(); ctx.ellipse(cx, y - rh * 0.14, w * 0.2, rh * 0.14, 0, 0, TAU); ctx.fill();
        }
      }
    }
  });

  const plants = new Batch();
  const FLAT = R.white;

  // ---- Cabbage: one template, many copies, each turned and tinted. --------------------------
  const pale = lin(0xb9da7c); const cab = lin(0x86bc62); const outer = lin(0x5da554);
  const cabbage = new Batch();
  latheInto(cabbage, [[0, 0.02], [0.3, 0.05], [0.44, 0.2], [0.47, 0.42], [0.38, 0.66], [0.2, 0.79], [0, 0.82]], 8, R.head, (y, a, c) => {
    const m = mix3(cab, pale, sstep(y, 0.2, 0.75));
    c[0] = m[0]; c[1] = m[1]; c[2] = m[2];
  });
  const headRadius = (y) => {
    const t = clamp01(y / 0.82);
    return 0.47 * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)) + 0.02;
  };
  // A leaf lying round the head is a patch of a surface whose radius it asks for at each height.
  const leafPatch = (az, span, y0, y1, flare, droop, colorIn, colorOut) => {
    const cols = 3; const rowsN = 2;
    const ids = [];
    for (let i = 0; i <= rowsN; i++) {
      const t = i / rowsN;
      const y = mix(y0, y1, t) - droop * t * t;
      const r = headRadius(Math.min(0.8, mix(y0, y1, t))) + flare * t * t + 0.02;
      const m = mix3(colorIn, colorOut, t);
      const row = [];
      for (let j = 0; j <= cols; j++) {
        const s = j / cols - 0.5;
        const a = az + s * span;
        const sa = Math.sin(a); const ca = Math.cos(a);
        const ny = 0.35 + flare * t * 0.9;
        const l = Math.hypot(1, ny);
        row.push(cabbage.v(r * sa, y, r * ca, sa / l, ny / l, ca / l, mix(R.cabbage[0], R.cabbage[1], s + 0.5), mix(R.cabbage[2], R.cabbage[3], t), m));
      }
      ids.push(row);
    }
    for (let i = 0; i < rowsN; i++) {
      for (let j = 0; j < cols; j++) cabbage.quad(ids[i][j], ids[i][j + 1], ids[i + 1][j + 1], ids[i + 1][j]);
    }
  };
  for (let k = 0; k < 3; k++) leafPatch(k * 2.09, 1.9, 0.14, 0.72, 0.04, 0, cab, pale);
  for (let k = 0; k < 3; k++) leafPatch(k * 2.09 + 1.05, 2.0, 0.06, 0.56, 0.2, 0.02, outer, cab);
  for (let k = 0; k < 4; k++) leafPatch(k * 1.57 + 0.5, 1.75, 0.03, 0.42, 0.62, 0.12, outer, mix3(outer, cab, 0.6));

  const placeCabbage = (x, z) => {
    const y = height(x, z) - 0.03;
    const s = 0.94 + rng() * 0.16;
    const tone = 0.92 + rng() * 0.14;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * TAU), new THREE.Vector3(s, s, s));
    plants.add(cabbage, m, (lx, ly, lz, c) => { c[0] *= tone; c[1] *= tone; c[2] *= tone; });
  };

  // ---- Carrot: three crossed fern cards and an orange shoulder standing out of the soil. ------
  const orange = lin(0xe8761c); const orangeDeep = lin(0xc4570e);
  const shoulder = new Batch();
  latheInto(shoulder, [[0.1, -0.06], [0.135, 0.05], [0.1, 0.13], [0, 0.155]], 9, FLAT, (y, a, c) => {
    const m = mix3(orangeDeep, orange, sstep(y, -0.05, 0.12));
    c[0] = m[0]; c[1] = m[1]; c[2] = m[2];
  });
  const fern = lin(0x5aa63a); const fernTip = lin(0x8ad04c);
  const placeCarrot = (x, z) => {
    const y = height(x, z);
    const s = 0.92 + rng() * 0.2;
    plants.add(shoulder, new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.02, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
    const tall = 1.25 + rng() * 0.3;
    const spin = rng() * TAU;
    const tone = 0.9 + rng() * 0.18;
    const low = times(fern, tone * 0.7); const high = times(fernTip, tone);
    for (let k = 0; k < 3; k++) {
      const a = spin + (k * Math.PI) / 3;
      const hw = fitHalfWidth(x, z, a, 0.5);
      const wx = Math.cos(a) * hw; const wz = Math.sin(a) * hw;
      const n = plants;
      // Upright under DoubleSide the normal must lie level: leaned up, the far side's flips underground.
      const nx = -Math.sin(a); const nz = Math.cos(a);
      const yb = y + 0.1;
      const p0 = n.v(x - wx, yb, z - wz, nx, 0, nz, R.fern[0], R.fern[2], low);
      const p1 = n.v(x + wx, yb, z + wz, nx, 0, nz, R.fern[1], R.fern[2], low);
      const p2 = n.v(x + wx, yb + tall, z + wz, nx, 0, nz, R.fern[1], R.fern[3], high);
      const p3 = n.v(x - wx, yb + tall, z - wz, nx, 0, nz, R.fern[0], R.fern[3], high);
      n.quad(p0, p1, p2, p3);
    }
  };

  // ---- Beans: a row of three-pole tripods, a vine climbing each pole. --------------------------
  const pole = lin(0x8a6a48); const vine = lin(0x2f7d33); const beanLeaf = lin(0x4d9a3a); const beanHi = lin(0x74b84a);
  const podGreen = lin(0xb4dc52);
  const placeTripod = (cx, cz) => {
    const apex = [cx, 5.4, cz];
    const base = 0.98;
    const spin = rng() * 1;
    for (let p = 0; p < 3; p++) {
      const a = spin + (p / 3) * TAU;
      const gx = cx + Math.sin(a) * base; const gz = cz + Math.cos(a) * base;
      const gy = height(gx, gz) - 0.15;
      // The pole runs on past the lashing, which is what a lashed tripod does.
      const top = [mix(gx, apex[0], 1.12), mix(gy, apex[1], 1.12), mix(gz, apex[2], 1.12)];
      const tone = 0.9 + rng() * 0.2;
      tubeInto(plants, [[gx, gy, gz], top], [0.055, 0.04], 5, FLAT, (t, c) => { c[0] = pole[0] * tone; c[1] = pole[1] * tone; c[2] = pole[2] * tone; });
      // The vine: a helix round the pole, so it can be seen to be climbing.
      const turns = 3 + rng() * 0.4;
      const steps = 15;
      const reach = 0.86 + rng() * 0.06;
      const helix = [];
      const axis = new THREE.Vector3(apex[0] - gx, apex[1] - gy, apex[2] - gz).normalize();
      const s1 = new THREE.Vector3(axis.z, 0, -axis.x).normalize();
      const s2 = new THREE.Vector3().crossVectors(axis, s1).normalize();
      const phi = rng() * TAU;
      for (let k = 0; k <= steps; k++) {
        const t = (k / steps) * reach;
        const ang = phi + (k / steps) * turns * TAU;
        const cxx = mix(gx, apex[0], t); const cyy = mix(gy, apex[1], t); const czz = mix(gz, apex[2], t);
        const rr = 0.078;
        helix.push([
          cxx + (s1.x * Math.cos(ang) + s2.x * Math.sin(ang)) * rr,
          cyy + (s1.y * Math.cos(ang) + s2.y * Math.sin(ang)) * rr,
          czz + (s1.z * Math.cos(ang) + s2.z * Math.sin(ang)) * rr,
        ]);
      }
      tubeInto(plants, helix, 0.024, 3, FLAT, (t, c) => { c[0] = vine[0]; c[1] = vine[1]; c[2] = vine[2]; });
      // Leaves and pods hang off the vine.
      for (let k = 2; k <= steps - 1; k += 2) {
        const q = helix[k];
        const out = new THREE.Vector3(q[0] - cx, 0, q[2] - cz);
        if (out.lengthSq() < 0.01) out.set(1, 0, 0);
        out.normalize();
        out.applyAxisAngle(new THREE.Vector3(0, 1, 0), (rng() - 0.5) * 1.8);
        const size = 0.3 + rng() * 0.09;
        const clampOut = Math.min(size * 1.1, Math.max(0.02, LIMIT - Math.max(Math.abs(q[0]), Math.abs(q[2]))));
        const centre = new THREE.Vector3(q[0] + out.x * clampOut * 0.8, q[1] - 0.05, q[2] + out.z * clampOut * 0.8);
        const right = new THREE.Vector3(out.z, 0, -out.x).multiplyScalar(Math.min(size, clampOut));
        const forward = new THREE.Vector3(out.x * 0.6, -0.8, out.z * 0.6).normalize().multiplyScalar(-size);
        flatCard(plants, centre, right, forward, R.bean, times(mix3(beanLeaf, beanHi, rng()), 0.92 + rng() * 0.16));
      }
      for (let k = 3; k <= steps - 2; k += 2) {
        const q = helix[k];
        const away = (rng() - 0.5) * 0.12;
        const pts = [[q[0], q[1], q[2]], [q[0] + away, q[1] - 0.3, q[2] + 0.02], [q[0] + away * 1.4, q[1] - 0.62, q[2] + 0.05], [q[0] + away * 2.2, q[1] - 0.86, q[2] + 0.04]];
        ribbonInto(plants, pts, [0.06, 0.12, 0.115, 0], R.pod, (t, c) => { c[0] = podGreen[0]; c[1] = podGreen[1]; c[2] = podGreen[2]; }, [1, 0, 1]);
      }
    }
    // The lashing.
    const w = lin(0xc9b48a);
    tubeInto(plants, [[cx - 0.09, 5.32, cz], [cx + 0.09, 5.38, cz + 0.05], [cx, 5.44, cz - 0.08], [cx - 0.09, 5.5, cz + 0.02]], 0.05, 4, FLAT, (t, c) => { c[0] = w[0]; c[1] = w[1]; c[2] = w[2]; });
  };

  const along = (pitch, fn) => {
    const n = Math.floor(18.2 / pitch);
    for (let j = 0; j < n; j++) fn(-((n - 1) * pitch) / 2 + j * pitch);
  };
  // West of the path: carrots, cabbages, carrots, beans. East: cabbages, carrots, cabbages, beans.
  along(1.9, (z) => placeCabbage(-ROWS[1], z));
  along(1.9, (z) => placeCabbage(ROWS[0], z));
  along(1.9, (z) => placeCabbage(ROWS[2], z));
  along(0.85, (z) => placeCarrot(-ROWS[0], z + (rng() - 0.5) * 0.06));
  along(0.85, (z) => placeCarrot(-ROWS[2], z + (rng() - 0.5) * 0.06));
  along(0.85, (z) => placeCarrot(ROWS[1], z + (rng() - 0.5) * 0.06));
  for (const z of [-6.6, -2.2, 2.2, 6.6]) { placeTripod(-ROWS[3], z); placeTripod(ROWS[3], z); }

  // ---- The wattle, whose outer face is the plot's edge. Two copies' fences stand back to back and
  // read as one fence. It is a closed solid band with stakes through it, and it opens at the path.
  const hazel = lin(0xb8966a); const stake = lin(0x7a5c3e);
  const LINE = 9.86; const THICK = 0.1; const TALL = 1.05; const PITCH = 0.6;
  const wovenU = [R.woven[0], (R.woven[0] + R.woven[1]) / 2, R.woven[1]];
  const fence = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.round(len / PITCH);
    const dx = (bx - ax) / len; const dz = (bz - az) / len;
    const nx = dz; const nz = -dx; // the side the +t offset goes
    const ids = [];
    const c0 = times(hazel, 0.72); const c1 = times(hazel, 1);
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * len;
      const wob = 0.028 * (i % 2 ? 1 : -1);
      const x = ax + dx * s + nx * wob; const z = az + dz * s + nz * wob;
      const y0 = height(x, z) - 0.2;
      const u = wovenU[i % 2 ? 1 : 0];
      const row = [];
      for (const side of [1, -1]) {
        const px = x + nx * THICK * side; const pz = z + nz * THICK * side;
        row.push([
          plants.v(px, y0, pz, nx * side, 0, nz * side, u, R.woven[2], c0),
          plants.v(px, TALL, pz, nx * side, 0, nz * side, u, R.woven[3], c1),
          plants.v(px, TALL, pz, 0, 1, 0, u, R.woven[3], c1),
        ]);
      }
      ids.push(row);
      // A second u for the far end of each half period, so the sheet runs on rather than mirrors.
      if (i % 2 === 1 && i < n) {
        const u2 = wovenU[0];
        const twin = [];
        for (const side of [1, -1]) {
          const px = x + nx * THICK * side; const pz = z + nz * THICK * side;
          twin.push([
            plants.v(px, y0, pz, nx * side, 0, nz * side, u2, R.woven[2], c0),
            plants.v(px, TALL, pz, nx * side, 0, nz * side, u2, R.woven[3], c1),
            plants.v(px, TALL, pz, 0, 1, 0, u2, R.woven[3], c1),
          ]);
        }
        ids.push(twin);
      } else if (i % 2 === 1) {
        ids.push(null);
      }
      if (i % 2 === 0) {
        const tone = 0.85 + rng() * 0.3;
        const top = TALL + 0.08 + rng() * 0.12;
        tubeInto(plants, [[x, y0, z], [x, top, z]], 0.05, 4, FLAT, (t, c) => { c[0] = stake[0] * tone; c[1] = stake[1] * tone; c[2] = stake[2] * tone; });
      }
    }
    // Faces. The +t side and the -t side each wind so that they face outward.
    for (let k = 0; k < ids.length - 1; k++) {
      const p = ids[k]; const q = ids[k + 1];
      if (!p || !q) continue;
      if (p[0][0] === q[0][0]) continue;
      plants.quad(p[0][0], q[0][0], q[0][1], p[0][1]);
      plants.quad(q[1][0], p[1][0], p[1][1], q[1][1]);
      plants.quad(p[0][2], q[0][2], q[1][2], p[1][2]);
    }
  };
  const G = PATH + 0.16; // the gap each side of the path's centre
  fence(-LINE, -LINE, -G, -LINE);
  fence(G, -LINE, LINE, -LINE);
  fence(LINE, -LINE, LINE, LINE);
  fence(LINE, LINE, G, LINE);
  fence(-G, LINE, -LINE, LINE);
  fence(-LINE, LINE, -LINE, -LINE);
  return group(soilMesh(soil, 61, { dark: 175, bump: 1.4 }, 1), plantMesh(plants.keepInside(10), map, { doubleSide: true, alphaTest: 0.42 }));
}

// ---------------------------------------------------------------------------------------------
// The Three Sisters
// ---------------------------------------------------------------------------------------------
const MOUND_PITCH = 5;
const MOUND_R = 1.8;
const MOUND_H = 0.95;

function threeSistersGarden() {
  const rng = seededRandom(0x53495354);
  for (let i = 0; i < 4; i++) rng();
  const ripple = tileNoise(71, 7, 5);
  const blotch = tileNoise(72, 9, 8);
  const fall = (x, z) => sstep(EDGE - Math.abs(x), 0, 0.7) * sstep(EDGE - Math.abs(z), 0, 0.7);
  const ground = (x, z) => 0.035 + fall(x, z) * (0.1 + 0.018 * ripple(x, z));
  const loam = lin(0x56402a); const rich = lin(0x6e5233);
  const soilColor = (x, z, out) => {
    const c = mix3(loam, rich, 0.5 + 0.5 * blotch(x, z));
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  };
  const soil = buildSoil({
    xs: uniq([-10, -9.75, -9.5, ...range(-9, 9, 2), 9.5, 9.75, 10]),
    zs: uniq([-10, -9.75, -9.5, ...range(-9, 9, 2), 9.5, 9.75, 10]),
    height: ground,
    color: (x, z, y, out) => soilColor(x, z, out),
  });

  // Sixteen mounds on a 5ft pitch, so the 5ft between two rows carries on through a join.
  const mounds = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) mounds.push([(i - 1.5) * MOUND_PITCH, (j - 1.5) * MOUND_PITCH]);
  const moundHeight = (cx, cz, x, z) => {
    const r = Math.hypot(x - cx, z - cz) / MOUND_R;
    if (r >= 1) return 0;
    const k = 1 - r * r;
    return MOUND_H * k * k * (3 - 2 * k) * 0.5 + MOUND_H * 0.5 * k * k;
  };
  const surface = (x, z) => {
    let h = 0;
    for (const m of mounds) h = Math.max(h, moundHeight(m[0], m[1], x, z));
    return ground(x, z) + h;
  };
  // A dome in polar rows, written into the soil batch so its colour and its map carry straight on
  // from the ground it rises out of. Its foot is level, so there is no crease where it meets.
  for (const [cx, cz] of mounds) {
    const rings = 3; const sides = 10;
    const start = soil.n;
    const c = [1, 1, 1];
    soilColor(cx, cz, c);
    soil.v(cx, surface(cx, cz), cz, 0, 1, 0, (cx + EDGE) / 4, (cz + EDGE) / 4, c);
    for (let r = 1; r <= rings; r++) {
      const rad = (r / rings) * MOUND_R;
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * TAU;
        const x = cx + Math.sin(a) * rad; const z = cz + Math.cos(a) * rad;
        const e = 0.08;
        const gx = (surface(x + e, z) - surface(x - e, z)) / (2 * e);
        const gz = (surface(x, z + e) - surface(x, z - e)) / (2 * e);
        const l = Math.hypot(gx, 1, gz);
        soilColor(x, z, c);
        const k = 1.2 - 0.34 * (r / rings);
        const y = r === rings ? ground(x, z) - 0.02 : surface(x, z);
        soil.v(x, y, z, -gx / l, 1 / l, -gz / l, (x + EDGE) / 4, (z + EDGE) / 4, [c[0] * k, c[1] * k, c[2] * k]);
      }
    }
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      soil.tri(start, start + 1 + s, start + 1 + s2);
      for (let r = 0; r < rings - 1; r++) {
        const a = start + 1 + r * sides + s; const e = start + 1 + r * sides + s2;
        const f = start + 1 + (r + 1) * sides + s2; const g = start + 1 + (r + 1) * sides + s;
        soil.quad(a, g, f, e);
      }
    }
  }

  // The atlas.
  const W = 512; const H = 512;
  const R = {
    white: rect(4, 4, 8, 8, W, H),
    corn: rect(16, 0, 44, 256, W, H),
    tassel: rect(64, 0, 128, 256, W, H),
    bean: rect(196, 0, 120, 120, W, H),
    squash: rect(320, 0, 192, 192, W, H),
    cob: rect(196, 124, 60, 132, W, H),
    pod: rect(260, 124, 40, 132, W, H),
    ribs: rect(0, 262, 200, 120, W, H),
    petal: rect(208, 262, 120, 120, W, H),
  };
  const paint = seededRandom(0x7369737472);
  for (let i = 0; i < 4; i++) paint();
  const map = atlasTexture(W, H, (ctx) => {
    ctx.lineCap = 'round';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(4, 4, 8, 8);
    // A corn leaf: pale midrib, long veins.
    ctx.fillStyle = '#f2f6e6';
    ctx.fillRect(16, 0, 44, 256);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(16 + 18, 0, 8, 256);
    ctx.strokeStyle = 'rgba(190,206,160,0.7)';
    ctx.lineWidth = 1.2;
    for (const x of [22, 27, 31, 47, 51, 55]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke(); }
    // A tassel: a central spike and side branches, each one a beaded line.
    {
      const cx = 128;
      const bead = (x0, y0, x1, y1, n) => {
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = '#efe9cf';
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        for (let i = 2; i <= n; i++) {
          const t = i / n;
          ctx.fillStyle = i % 2 ? '#fff9e2' : '#e6dcb8';
          ctx.beginPath(); ctx.ellipse(mix(x0, x1, t), mix(y0, y1, t), 4.2, 5, 0, 0, TAU); ctx.fill();
        }
      };
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#efe9cf';
      ctx.beginPath(); ctx.moveTo(cx, 256); ctx.lineTo(cx, 6); ctx.stroke();
      bead(cx, 110, cx, 4, 12);
      for (let i = 0; i < 9; i++) {
        const y = 118 + i * 14;
        const s = i % 2 ? 1 : -1;
        const reach = 38 + (i / 9) * 22;
        bead(cx, y, cx + s * reach, y - 66 + (i / 9) * 26, 9);
      }
    }
    // A bean's three leaflets.
    {
      const x0 = 256; const y0 = 60;
      ctx.fillStyle = '#f4f8ea';
      for (const [dx, dy, rot, s] of [[0, -24, 0, 0.9], [-26, 12, -1.3, 0.78], [26, 12, 1.3, 0.78]]) {
        ctx.save();
        ctx.translate(x0 + dx, y0 + dy); ctx.rotate(rot); ctx.scale(s, s);
        ctx.beginPath();
        ctx.moveTo(0, 30); ctx.bezierCurveTo(-34, 20, -28, -18, 0, -32); ctx.bezierCurveTo(28, -18, 34, 20, 0, 30);
        ctx.fill();
        ctx.strokeStyle = 'rgba(170,190,140,0.8)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, 28); ctx.lineTo(0, -26); ctx.stroke();
        ctx.restore();
      }
    }
    // A squash leaf: broad, five blunt lobes, a heart-shaped base, pale veins and the silver flecks
    // along them that squash leaves really have.
    {
      const cx = 416; const cy = 96; const s = 92;
      ctx.fillStyle = '#f2f6e4';
      ctx.beginPath();
      const n = 90;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * TAU; // measured from straight up
        const lobes = 0.8 + 0.2 * Math.abs(Math.cos(a * 2.5));
        const notch = 1 - 0.62 * Math.exp(-(((a - Math.PI) / 0.28) ** 2));
        const r = s * lobes * notch;
        const px = cx + Math.sin(a) * r; const py = cy - Math.cos(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      for (const a of [0, 1.26, -1.26, 2.45, -2.45]) {
        ctx.beginPath(); ctx.moveTo(cx, cy + s * 0.28); ctx.lineTo(cx + Math.sin(a) * s * 0.76, cy - Math.cos(a) * s * 0.76); ctx.stroke();
        for (const side of [-1, 1]) {
          for (let t = 0.3; t < 0.8; t += 0.16) {
            const bx = cx + Math.sin(a) * s * t; const by = cy - Math.cos(a) * s * t;
            ctx.lineWidth = 1.6;
            ctx.strokeStyle = 'rgba(188,204,160,0.85)';
            ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + Math.sin(a + side * 0.8) * s * 0.17, by - Math.cos(a + side * 0.8) * s * 0.17); ctx.stroke();
          }
        }
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffffff';
      }
    }
    // A cob: rows of kernels.
    ctx.fillStyle = '#ddcda8';
    ctx.fillRect(196, 124, 60, 132);
    for (let c = 0; c < 9; c++) {
      for (let r = 0; r < 22; r++) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(196 + 3.4 + c * 6.6, 124 + 3 + r * 6, 2.9, 2.6, 0, 0, TAU); ctx.fill();
      }
    }
    // A bean pod.
    ctx.fillStyle = '#ecf2d8';
    ctx.fillRect(260, 124, 40, 132);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(280, 140 + i * 25, 15, 11, 0, 0, TAU); ctx.fill(); }
    // A squash's ribs: dark seams at five whole repeats, so the wrap has no join.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 262, 200, 120);
    for (let i = 0; i < 5; i++) {
      const x = (i + 0.5) * 40;
      ctx.strokeStyle = 'rgba(180,140,90,0.75)';
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(x, 262); ctx.lineTo(x, 382); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,240,180,0.6)';
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(x + 20, 262); ctx.lineTo(x + 20, 382); ctx.stroke();
    }
    // A blossom's five pointed petals.
    {
      const cx = 268; const cy = 322;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const a = (i / 60) * TAU;
        const r = 36 + 22 * Math.abs(Math.cos(a * 2.5)) ** 0.7;
        const px = cx + Math.sin(a) * r; const py = cy - Math.cos(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.fill();
      ctx.strokeStyle = 'rgba(214,150,70,0.8)';
      ctx.lineWidth = 2.4;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + Math.PI / 5 * 0;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(a) * 50, cy - Math.cos(a) * 50); ctx.stroke();
      }
      ctx.fillStyle = '#d6982e';
      ctx.beginPath(); ctx.arc(cx, cy, 11, 0, TAU); ctx.fill();
    }
  });

  const plants = new Batch();
  const FLAT = R.white;
  const up = new THREE.Vector3(0, 1, 0);
  const paintWith = (col) => (t, c) => { c[0] = col[0]; c[1] = col[1]; c[2] = col[2]; };

  // ---- Corn ---------------------------------------------------------------------------------
  const stalkLo = lin(0x6f9a3a); const stalkHi = lin(0x9cb84f);
  const leafLo = lin(0x4d9436); const leafHi = lin(0x7cb841); const leafTip = lin(0xa6c452);
  const tasselCol = lin(0xd8bb6a);
  const husk = lin(0x8db650); const kernel = lin(0xf0c22e); const silk = lin(0x9a5a2a);
  const vineCol = lin(0x2c6f33); const beanLeaf = lin(0x3f8c3a); const beanLeafHi = lin(0x62a844);
  const podCols = [lin(0xb2dc4e), lin(0xb2dc4e), lin(0x8a4aa0)];

  const earT = new Batch();
  // An ear on its stem: the husk peels back from the tip, showing the cob. Painted on one solid.
  latheInto(earT, [[0, 0], [0.09, 0.14], [0.125, 0.45], [0.1, 0.78], [0, 1.02]], 7, R.cob, (y, a, c) => {
    const lip = 0.48 + 0.07 * Math.sin(a * 3);
    const m = y < lip ? husk : kernel;
    const tipT = sstep(y, 0.92, 1.0);
    const k = mix3(m, silk, tipT);
    c[0] = k[0]; c[1] = k[1]; c[2] = k[2];
  });

  const inside = (v) => Math.max(-LIMIT, Math.min(LIMIT, v));
  const clampLen = (x, z, dx, dz, L) => {
    let out = L;
    if (Math.abs(dx) > 1e-3) out = Math.min(out, ((dx > 0 ? LIMIT - x : LIMIT + x) / Math.abs(dx)));
    if (Math.abs(dz) > 1e-3) out = Math.min(out, ((dz > 0 ? LIMIT - z : LIMIT + z) / Math.abs(dz)));
    return out;
  };

  const spots = [];
  mounds.forEach(([cx, cz], index) => {
    const count = index % 4 === 1 && (index >> 2) % 2 === 0 ? 4 : 3;
    const spin = rng() * TAU;
    for (let n = 0; n < count; n++) {
      const a = spin + (n / count) * TAU;
      const sx = cx + Math.sin(a) * 0.6; const sz = cz + Math.cos(a) * 0.6;
      const by = surface(sx, sz) - 0.34;
      const H0 = 6.7 + rng() * 0.6;
      const lx = (rng() - 0.5) * 0.5; const lz = (rng() - 0.5) * 0.5;
      const at = (y) => {
        const t = clamp01((y - by) / (H0 - by));
        return [sx + lx * t * t, sz + lz * t * t];
      };
      // The stalk.
      const stalkPts = [];
      for (let k = 0; k <= 3; k++) { const y = mix(by, H0, k / 3); const [px, pz] = at(y); stalkPts.push([px, y, pz]); }
      const tone = 0.92 + rng() * 0.16;
      tubeInto(plants, stalkPts, [0.105, 0.08, 0.058, 0.03], 5, FLAT, (t, c) => {
        const m = mix3(stalkLo, stalkHi, t);
        c[0] = m[0] * tone; c[1] = m[1] * tone; c[2] = m[2] * tone;
      });
      // Long arching leaves in two ranks, the way corn really carries them.
      const LEAVES = 6;
      const rank = rng() * TAU;
      for (let k = 0; k < LEAVES; k++) {
        const t = k / (LEAVES - 1);
        const y = mix(by + 1.1, H0 - 1.25, t);
        const [px, pz] = at(y);
        let az = rank + k * Math.PI + (rng() - 0.5) * 0.55;
        const wanted = mix(3.15, 2.2, t) * (0.94 + rng() * 0.12);
        // A leaf that would cross the edge turns back into the plot, rather than being cut short:
        // a short wide leaf reads as an arrowhead stuck on the stalk.
        for (const turn of [0, 0.7, -0.7, 1.4, -1.4, 2.2, -2.2, Math.PI]) {
          const dx2 = Math.sin(az + turn); const dz2 = Math.cos(az + turn);
          if (clampLen(px, pz, dx2, dz2, wanted * 0.96) >= wanted * 0.95) { az += turn; break; }
        }
        const dx = Math.sin(az); const dz = Math.cos(az);
        const L = Math.min(wanted, clampLen(px, pz, dx, dz, wanted * 0.96) / 0.96);
        const pts = [];
        const arch = mix(0.95, 1.2, t);
        for (let s = 0; s <= 4; s++) {
          const u = s / 4;
          const out = L * 0.96 * (u * (0.72 + 0.28 * u));
          const rise = L * arch * (0.62 * u - 0.72 * u * u);
          pts.push([px + dx * out, y + rise, pz + dz * out]);
        }
        const w = 0.34 * (0.9 + rng() * 0.2);
        ribbonInto(plants, pts, [w * 0.6, w, w * 0.92, w * 0.6, 0], R.corn, (v, c) => {
          const m = v < 0.5 ? mix3(leafLo, leafHi, v * 2) : mix3(leafHi, leafTip, (v - 0.5) * 2);
          c[0] = m[0] * tone; c[1] = m[1] * tone; c[2] = m[2] * tone;
        });
      }
      // The tassel, crossed cards standing on the top of the stalk.
      const [tx, tz] = at(H0);
      const tSpin = rng() * TAU;
      for (let k = 0; k < 2; k++) {
        const a2 = tSpin + (k * Math.PI) / 2;
        const right = new THREE.Vector3(Math.cos(a2) * 0.34, 0, Math.sin(a2) * 0.34);
        const forward = new THREE.Vector3(0, 0.62, 0);
        const centre = new THREE.Vector3(tx, H0 + 0.52, tz);
        flatCard(plants, centre, right, forward, R.tassel, times(tasselCol, tone), new THREE.Vector3(-Math.sin(a2), 0, Math.cos(a2)));
      }
      // An ear, sometimes two, on the side that does not have a leaf right over it.
      const ears = rng() < 0.4 ? 2 : 1;
      for (let k = 0; k < ears; k++) {
        const ey = by + 2.7 + k * 0.85 + rng() * 0.3;
        const [ex, ez] = at(ey);
        const eaz = rank + Math.PI / 2 + k * Math.PI + (rng() - 0.5) * 0.5;
        const dir = new THREE.Vector3(Math.sin(eaz) * 0.42, 0.9, Math.cos(eaz) * 0.42).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
        const s = 0.82 + rng() * 0.14;
        const m = new THREE.Matrix4().compose(new THREE.Vector3(ex, ey, ez), q, new THREE.Vector3(s * 1.05, s, s * 1.05));
        plants.add(earT, m);
      }
      // A bean climbing it: a helix on the stalk's own axis, so it cannot leave the stalk.
      const turns = 3.25 + rng() * 0.4;
      const steps = 22;
      const phi = rng() * TAU;
      const helix = [];
      const y0 = by + 0.15; const y1 = by + (H0 - by) * (0.78 + rng() * 0.08);
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const y = mix(y0, y1, t);
        const [hx, hz] = at(y);
        const ang = phi + t * turns * TAU;
        const rr = mix(0.135, 0.09, t);
        helix.push([hx + Math.cos(ang) * rr, y, hz + Math.sin(ang) * rr]);
      }
      // A tape standing on edge rather than a tube: a third of the triangles, and at this thickness
      // nobody can see which it is. Its width is what must not fall under a pixel at ten feet.
      ribbonInto(plants, helix, helix.map(() => 0.07), FLAT, paintWith(vineCol), [0, 1, 0]);
      for (let k = 3; k < steps; k += 4) {
        const q = helix[k];
        const [hx, hz] = at(q[1]);
        const out = new THREE.Vector3(q[0] - hx, 0, q[2] - hz).normalize();
        const size = 0.3 + rng() * 0.07;
        const centre = new THREE.Vector3(inside(q[0] + out.x * size * 0.85), q[1] - 0.08, inside(q[2] + out.z * size * 0.85));
        const right = new THREE.Vector3(out.z, 0, -out.x).multiplyScalar(size);
        const forward = new THREE.Vector3(out.x * 0.55, 0.82, out.z * 0.55).normalize().multiplyScalar(size);
        flatCard(plants, centre, right, forward, R.bean, times(mix3(beanLeaf, beanLeafHi, rng()), 0.95 + rng() * 0.1));
      }
      for (let k = 5; k < steps; k += 4) {
        const q = helix[k];
        const away = (rng() - 0.5) * 0.08;
        const col = podCols[Math.floor(rng() * podCols.length)];
        const pts = [[q[0], q[1], q[2]], [q[0] + away, q[1] - 0.26, q[2] + 0.02], [q[0] + away * 1.6, q[1] - 0.52, q[2] + 0.04], [q[0] + away * 2.4, q[1] - 0.72, q[2] + 0.02]];
        ribbonInto(plants, pts, [0.05, 0.1, 0.1, 0], R.pod, paintWith(col), [1, 0, 1]);
      }
      spots.push([sx, sz]);
    }
  });

  // ---- Squash -------------------------------------------------------------------------------
  // The fruit first, so the leaves can be told where not to lie: a squash under a leaf is a squash
  // nobody can see. They sit in the alleys between the mounds, where the corn does not stand.
  const fruitSpots = [];
  const offMounds = (x, z, margin) => mounds.every((m) => Math.hypot(x - m[0], z - m[1]) > MOUND_R * margin);
  const squashCols = [lin(0xf0a01e), lin(0xf2c02c), lin(0xe88a18)];
  const stemCol = lin(0x7a9a3c);
  const fruit = new Batch();
  latheInto(fruit, [[0, 0], [0.4, 0.05], [0.53, 0.3], [0.44, 0.6], [0.2, 0.74], [0, 0.72]], 10, R.ribs, (y, a, c) => { c[0] = 1; c[1] = 1; c[2] = 1; });
  const stemT = new Batch();
  tubeInto(stemT, [[0, 0.7, 0], [0.03, 0.82, 0.01], [0.07, 0.94, 0.03]], [0.05, 0.04, 0.05], 4, FLAT, (t, c) => { c[0] = stemCol[0]; c[1] = stemCol[1]; c[2] = stemCol[2]; });
  for (let i = 0; i < 60 && fruitSpots.length < 12; i++) {
    const ix = Math.floor(rng() * 5); const iz = Math.floor(rng() * 5);
    const x = (ix - 2) * MOUND_PITCH * 0.94 + (rng() - 0.5) * 2.2;
    const z = (iz - 2) * MOUND_PITCH * 0.94 + (rng() - 0.5) * 2.2;
    if (Math.abs(x) > 9.1 || Math.abs(z) > 9.1 || !offMounds(x, z, 0.92)) continue;
    if (fruitSpots.some((f) => Math.hypot(f[0] - x, f[1] - z) < 2.2)) continue;
    fruitSpots.push([x, z]);
  }
  fruitSpots.forEach(([x, z], i) => {
    const s = 0.85 + rng() * 0.3;
    const stretch = i % 3 === 1 ? 1.3 : 1;
    const q = new THREE.Quaternion().setFromAxisAngle(up, rng() * TAU);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, surface(x, z) - 0.05, z), q, new THREE.Vector3(s, s * stretch * 0.92, s));
    const col = squashCols[i % squashCols.length];
    plants.add(fruit, m, (lx, ly, lz, c) => {
      const belly = 0.78 + 0.22 * sstep(ly, 0, 0.3);
      c[0] = col[0] * belly; c[1] = col[1] * belly; c[2] = col[2] * belly;
    });
    plants.add(stemT, m);
  });

  // Vines sprawl from each mound's foot out along the alleys and turn as they go.
  const squashDark = lin(0x2f6f2a); const squashMid = lin(0x3f8630); const squashHi = lin(0x5a9a3a);
  const vineSq = lin(0x5a8a36);
    const blocked = (x, z) => fruitSpots.some((f) => Math.hypot(f[0] - x, f[1] - z) < 0.82)
    || spots.some((f) => Math.hypot(f[0] - x, f[1] - z) < 0.45);
  mounds.forEach(([cx, cz]) => {
    for (let v = 0; v < 2; v++) {
      let az = rng() * TAU;
      let x = cx + Math.sin(az) * MOUND_R * 0.55; let z = cz + Math.cos(az) * MOUND_R * 0.55;
      const pts = [[x, surface(x, z) + 0.03, z]];
      const STEPS = 6;
      for (let k = 1; k <= STEPS; k++) {
        az += (rng() - 0.5) * 1.1;
        const nx = x + Math.sin(az) * 0.8; const nz = z + Math.cos(az) * 0.8;
        // Vines keep inside the plot by turning, not by being cut.
        if (Math.abs(nx) > 9.55 || Math.abs(nz) > 9.55) { az += Math.PI / 2; continue; }
        x = nx; z = nz;
        pts.push([x, surface(x, z) + 0.05, z]);
      }
      if (pts.length > 2) ribbonInto(plants, pts, pts.map(() => 0.085), FLAT, paintWith(vineSq));
    }
  });
  // Broad leaves, tipped toward the light on short stalks, folded a little on the midrib. Skipped
  // on the crown of a mound and over each fruit, so all three plants can still be seen.
  let bloomCount = 0;
  const blossom = new Batch();
  {
    const yellow = lin(0xf6b81c); const deep2 = lin(0xe88a12);
    latheInto(blossom, [[0.035, 0], [0.08, 0.13], [0.2, 0.27], [0.34, 0.31]], 7, R.petal, (y, a, c) => {
      const m = mix3(deep2, yellow, sstep(y, 0.05, 0.25));
      c[0] = m[0]; c[1] = m[1]; c[2] = m[2];
    });
  }
  // On a jittered grid rather than along the vines, so they cover the ground evenly and the cover
  // runs on through a join. A few are left out, so there is soil to see between them.
  const leafSpots = [];
  const LEAF_PITCH = 1.3;
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      if (rng() < 0.12) continue;
      leafSpots.push([-EDGE + (i + 0.5) * (20 / 16) + (rng() - 0.5) * LEAF_PITCH * 0.7, -EDGE + (j + 0.5) * (20 / 16) + (rng() - 0.5) * LEAF_PITCH * 0.7]);
    }
  }
  for (const [lx, lz] of leafSpots) {
    if (blocked(lx, lz)) continue;
    const size = 0.62 + rng() * 0.26;
    const margin = LIMIT - size * 1.02;
    const x = Math.max(-margin, Math.min(margin, lx)); const z = Math.max(-margin, Math.min(margin, lz));
    if (mounds.some((m) => Math.hypot(x - m[0], z - m[1]) < MOUND_R * 0.72)) continue;
    const base = surface(x, z);
    const lift = 0.22 + rng() * 0.62;
    const az = rng() * TAU;
    const tip = 0.16 + rng() * 0.26;
    const fx = Math.sin(az); const fz = Math.cos(az);
    const forward = new THREE.Vector3(fx * Math.cos(tip), Math.sin(tip), fz * Math.cos(tip)).multiplyScalar(size);
    const right = new THREE.Vector3(fz, 0, -fx).multiplyScalar(size);
    const col = times(mix3(squashDark, rng() < 0.5 ? squashMid : squashHi, rng()), 0.92 + rng() * 0.18);
    const y = base + lift;
    const nrm = new THREE.Vector3().crossVectors(right, forward).normalize();
    if (nrm.y < 0) nrm.negate();
    const fold = 0.09 * size;
    const rib = (s, t) => {
      const p = new THREE.Vector3(x, y, z).addScaledVector(right, s).addScaledVector(forward, t);
      p.y += Math.abs(s) * fold * 2.2 - t * t * 0.02;
      const u = mix(R.squash[0], R.squash[1], s * 0.5 + 0.5);
      const v = mix(R.squash[2], R.squash[3], t * 0.5 + 0.5);
      return plants.v(p.x, p.y, p.z, nrm.x, nrm.y, nrm.z, u, v, col);
    };
    const a0 = rib(-1, -1); const a1 = rib(0, -1); const a2 = rib(1, -1);
    const b0 = rib(-1, 1); const b1 = rib(0, 1); const b2 = rib(1, 1);
    // Wound to face up, the side the normal is on. Faced down, a DoubleSide material flips the normal
    // for anybody looking from above, and every leaf in the field goes black.
    plants.quad(b0, b1, a1, a0);
    plants.quad(b1, b2, a2, a1);
    if (lift > 0.36) ribbonInto(plants, [[x, base - 0.02, z], [x, y - 0.02, z]], [0.06, 0.05], FLAT, paintWith(vineSq), [fz, 0, -fx]);
    // A blossom stands up out of the leaves now and then.
    if (bloomCount < 12 && rng() < 0.2) {
      bloomCount += 1;
      const bx = Math.max(-9.5, Math.min(9.5, x + fz * 0.5)); const bz = Math.max(-9.5, Math.min(9.5, z - fx * 0.5));
      const q = new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3((rng() - 0.5) * 0.7, 1, (rng() - 0.5) * 0.7).normalize());
      plants.add(blossom, new THREE.Matrix4().compose(new THREE.Vector3(bx, y + 0.1, bz), q, new THREE.Vector3(1, 1, 1)));
    }
  }

  return group(soilMesh(soil, 81, { dark: 175, bump: 1.2 }, 1), plantMesh(plants.keepInside(), map, { doubleSide: true, alphaTest: 0.42 }));
}

// ---------------------------------------------------------------------------------------------
// The apple tree
// ---------------------------------------------------------------------------------------------
function paintLeafCluster(ctx, x0, W, H, rng) {
  // A spray of broad oval leaves round a twig, with air between them. The gaps are what let light
  // through the crown, and what stop a mass of these reading as a solid ball.
  ctx.lineCap = 'round';
  const cx = x0 + W / 2; const cy = H / 2;
  const leaf = (x, y, rot, s, g) => {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
    ctx.fillStyle = `rgb(${g},${g},${g - 8})`;
    ctx.beginPath();
    ctx.moveTo(0, -30);
    ctx.bezierCurveTo(25, -20, 23, 16, 0, 30);
    ctx.bezierCurveTo(-23, 16, -25, -20, 0, -30);
    ctx.fill();
    ctx.strokeStyle = `rgba(${g - 62},${g - 44},${g - 84},0.85)`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(0, 26); ctx.stroke();
    ctx.restore();
  };
  ctx.strokeStyle = '#b0a080';
  ctx.lineWidth = 4;
  for (const [ax, ay] of [[0.14, 0.85], [0.82, 0.18], [0.8, 0.8], [0.2, 0.2]]) {
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x0 + W * ax, H * ay); ctx.stroke();
  }
  const placed = [];
  for (let i = 0; i < 900 && placed.length < 52; i++) {
    const a = rng() * TAU; const r = Math.sqrt(rng()) * W * 0.45;
    const x = cx + Math.cos(a) * r; const y = cy + Math.sin(a) * r;
    if (placed.some((p) => Math.hypot(p[0] - x, p[1] - y) < W * 0.07)) continue;
    placed.push([x, y]);
    leaf(x, y, a + (rng() - 0.5) * 1.5 + Math.PI / 2, (W / 256) * (0.42 + rng() * 0.2), 208 + Math.floor(rng() * 47));
  }
}

function appleTree() {
  const rng = seededRandom(0x4150504c);
  for (let i = 0; i < 4; i++) rng();
  const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
  const along = (p, t) => {
    const f = t * (p.length - 1); const i = Math.min(p.length - 2, Math.floor(f));
    return lerp3(p[i], p[i + 1], f - i);
  };

  // The crown is a broad dome of overlapping lobes. Its outline is leaves, not lobes: the lobes only
  // say where leaves go and which way each one should shade, and what comes out reads as boughs of
  // foliage with bays of sky between them, where one big ellipsoid reads as a mushroom.
  const lobes = [{ c: [0.2, 13.9, -0.3], r: [5.1, 2.9, 5.1], az: 0 }];
  for (let i = 0; i < 4; i++) {
    const az = 0.4 + (i / 4) * TAU + (rng() - 0.5) * 0.3;
    const rad = 4.8 + rng() * 0.5;
    lobes.push({ c: [Math.sin(az) * rad, 12.3 + rng() * 0.4, Math.cos(az) * rad], r: [3.95, 2.75, 3.95], az });
  }
  for (let i = 0; i < 6; i++) {
    const az = 1.05 + (i / 6) * TAU + (rng() - 0.5) * 0.28;
    const rad = 6.85 + rng() * 0.3;
    const rx = 2.75 + rng() * 0.3;
    lobes.push({ c: [Math.sin(az) * rad, 9.9 + rng() * 0.6, Math.cos(az) * rad], r: [rx, 2.3, rx], az });
  }

  // ---- The trunk and its first forks are one sculpted surface, so a fork is a real fork. ---------
  const bark = lin(0x6e5238);
  const sculpt = new Sculpt(0.21);
  const FORK = [0.12, 4.5, -0.08];
  sculpt.add(curveP([[0.02, 0.32, 0.02], [-0.16, 1.5, 0.08], [0.17, 2.9, -0.12], FORK], [0.8, 0.68, 0.62, 0.6], 12), bark);
  const ROOTS = 6;
  for (let i = 0; i < ROOTS; i++) {
    const a = (i / ROOTS) * TAU + rng() * 0.5;
    const out = 1.6 + rng() * 0.7;
    sculpt.add(curveP([
      [Math.sin(a) * 0.22, 1.25, Math.cos(a) * 0.22],
      [Math.sin(a) * 0.68, 0.42, Math.cos(a) * 0.68],
      [Math.sin(a) * (out * 0.66), 0.03, Math.cos(a) * (out * 0.66)],
      [Math.sin(a + 0.25) * out, -0.3, Math.cos(a + 0.25) * out],
    ], [0.42, 0.32, 0.2, 0.11], 9), bark, { k: 0.34 });
  }
  // Healed wounds. An old apple is mostly those.
  sculpt.add(sphereP([0.5, 1.9, 0.3], 0.26), bark, { k: 0.3 });
  sculpt.add(sphereP([-0.42, 3.2, -0.34], 0.24), bark, { k: 0.3 });
  sculpt.add(sphereP([0.3, 3.7, 0.42], 0.17), bark, { k: 0.26 });
  const limbs = [];
  const bough = (a, b, c, d, r) => {
    const pts = [a, b, c, d];
    limbs.push(pts);
    sculpt.add(curveP(pts, r, 10), bark, { k: 0.32 });
  };
  const az0 = 0.7;
  const out = (az, rad, y) => [Math.sin(az) * rad, y, Math.cos(az) * rad];
  // Two big forks and a leader, each fork dividing again. Four limbs out of one point is a candelabra.
  const P1 = out(az0, 2.2, 7.1);
  const P2 = out(az0 + 2.75, 2.3, 7.4);
  bough([0.05, 3.9, -0.05], out(az0, 0.9, 5.2), out(az0 + 0.1, 1.6, 6.2), P1, [0.42, 0.38, 0.3, 0.26]);
  bough([0.05, 3.9, -0.05], out(az0 + 2.75, 0.9, 5.4), out(az0 + 2.65, 1.65, 6.4), P2, [0.42, 0.38, 0.3, 0.26]);
  bough([0.08, 4.0, -0.05], out(az0 + 1.5, 0.5, 6), out(az0 + 1.7, 0.8, 8), out(az0 + 1.5, 1.2, 10.4), [0.36, 0.3, 0.24, 0.14]);
  bough(P1, out(az0 - 0.45, 3.1, 8.2), out(az0 - 0.65, 4.2, 9.3), out(az0 - 0.7, 5.3, 10.6), [0.26, 0.21, 0.17, 0.12]);
  bough(P1, out(az0 + 0.45, 2.9, 8.5), out(az0 + 0.65, 3.6, 10), out(az0 + 0.7, 4.3, 11.7), [0.26, 0.21, 0.17, 0.12]);
  bough(P2, out(az0 + 2.35, 3.2, 8.2), out(az0 + 2.2, 4.3, 9.2), out(az0 + 2.05, 5.4, 10.5), [0.26, 0.21, 0.17, 0.12]);
  bough(P2, out(az0 + 3.2, 3, 8.6), out(az0 + 3.35, 3.8, 10.1), out(az0 + 3.5, 4.5, 11.8), [0.26, 0.21, 0.17, 0.12]);
  const ridge = (x, y, z) => Math.sin(Math.atan2(x, z) * 3 + y * 0.8);
  sculpt.map((d, x, y, z) => d + 0.035 * ridge(x, y, z) * (y < 5 ? 1 : 0.3));
  const trunkGeo = polygonize(sculpt, {
    uvScale: 0.36,
    tint: (x, y, z, nx, ny, nz, c) => {
      const k = 0.8 + 0.22 * ridge(x, y, z);
      c[0] = bark[0] * k; c[1] = bark[1] * k; c[2] = bark[2] * k;
    },
  });

  // ---- Branches: each aims at a lobe, then each twig at that lobe's surface, so wood reaches leaf. -
  const woodParts = [{ geometry: trunkGeo, keepColor: true }];
  const twigs = [];
  const branch = (start, end, r0, r1, sides, steps, sag, color) => {
    const mid = lerp3(start, end, 0.55);
    mid[0] += (rng() - 0.5) * sag; mid[2] += (rng() - 0.5) * sag; mid[1] += (rng() - 0.25) * sag;
    woodParts.push({ geometry: tube([start, mid, end], [r0, mix(r0, r1, 0.55), r1], { sides, steps, round: 0 }), color });
    return [start, mid, end];
  };
  const samples = [];
  limbs.forEach((pts) => { for (const t of [0.5, 0.75, 1]) samples.push(along(pts, t)); });
  const surfaceOf = (lobe, dx, dy, dz, k) => [lobe.c[0] + dx * lobe.r[0] * k, lobe.c[1] + dy * lobe.r[1] * k, lobe.c[2] + dz * lobe.r[2] * k];
  const randomDir = () => {
    const y = rng() * 1.5 - 0.65; const a = rng() * TAU; const s = Math.sqrt(Math.max(0, 1 - y * y));
    return [Math.sin(a) * s, y, Math.cos(a) * s];
  };
  lobes.forEach((lobe, li) => {
    let best = samples[0]; let bestD = 1e9;
    for (const s of samples) { const d = Math.hypot(s[0] - lobe.c[0], s[1] - lobe.c[1], s[2] - lobe.c[2]); if (d < bestD) { bestD = d; best = s; } }
    const path = branch(best, lerp3(best, lobe.c, 0.82), 0.1, 0.05, 5, 4, 0.7, 0x5e4630);
    const count = li === 0 ? 7 : 5;
    for (let c = 0; c < count; c++) {
      const s = along(path, 0.45 + c * 0.1);
      const [dx, dy, dz] = randomDir();
      const e = surfaceOf(lobe, dx, dy, dz, 0.98 + rng() * 0.08);
      twigs.push(branch(s, e, 0.05, 0.015, 3, 3, 0.45, 0x6a5140));
    }
  });

  const fissures = seededRandom(0x6261726b);
  for (let i = 0; i < 4; i++) fissures();
  const barkMap = canvasTexture(256, 256, (ctx, W, H) => {
    ctx.fillStyle = '#efe9df';
    ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      const x = fissures() * W; const y = fissures() * H; const len = 40 + fissures() * 110;
      const dark = fissures() < 0.7;
      ctx.strokeStyle = dark ? `rgba(122,104,84,${0.4 + fissures() * 0.4})` : 'rgba(255,250,240,0.5)';
      ctx.lineWidth = dark ? 1.2 + fissures() * 2.6 : 2 + fissures() * 3;
      const wob = (fissures() - 0.5) * 22;
      for (const ox of [-W, 0, W]) {
        for (const oy of [-H, 0, H]) {
          ctx.beginPath();
          ctx.moveTo(x + ox, y + oy);
          ctx.quadraticCurveTo(x + ox + wob, y + oy + len * 0.5, x + ox + wob * 0.2, y + oy + len);
          ctx.stroke();
        }
      }
    }
    // mergeParts gives every branch tube a uv of (0,0), so that corner of the sheet must be plain bark.
    ctx.fillStyle = '#efe9df';
    ctx.fillRect(0, H - 8, 8, 8);
  });
  barkMap.wrapS = THREE.RepeatWrapping;
  barkMap.wrapT = THREE.RepeatWrapping;
  const woodMesh = mesh(mergeParts(woodParts), standard({ map: barkMap, bumpMap: barkMap, bumpScale: 2, vertexColors: true, roughness: 0.96, metalness: 0 }));

  // ---- Leaves ---------------------------------------------------------------------------------
  const map = atlasTexture(512, 256, (ctx, W, H) => {
    const r = seededRandom(0x6c656166);
    for (let i = 0; i < 4; i++) r();
    paintLeafCluster(ctx, 0, 248, H, r);
    paintLeafCluster(ctx, 256, 248, H, r);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(505, 0, 7, 7);
  });
  const REG = [rect(0, 0, 248, 256, 512, 256), rect(256, 0, 248, 256, 512, 256)];
  const FLAT = rect(506, 1, 5, 5, 512, 256);
  const leaves = new Batch();
  const lush = lin(0x4a8c34); const bright = lin(0x76b040); const shade = lin(0x2d6a2c);
  const card = (lobe, dx, dy, dz, k, size) => {
    const px = lobe.c[0] + dx * lobe.r[0] * k; const py = lobe.c[1] + dy * lobe.r[1] * k; const pz = lobe.c[2] + dz * lobe.r[2] * k;
    // Each corner takes the lobe's outward normal, leaned toward the crown's own, so a bough shades
    // as one round mass and the whole crown as a bigger one. Back to back so it holds from either side.
    const toTree = new THREE.Vector3(px / 9, (py - 12) / 6, pz / 9);
    const nrm = new THREE.Vector3(dx, dy + 0.2, dz).normalize().multiplyScalar(0.7).addScaledVector(toTree, 0.45);
    nrm.y += 0.38; // so the underside of the crown, where a child stands and looks up, still takes the sky
    nrm.normalize();
    const face = new THREE.Vector3(nrm.x + (rng() - 0.5) * 1.4, nrm.y + (rng() - 0.5) * 1.4, nrm.z + (rng() - 0.5) * 1.4).normalize();
    const a = Math.abs(face.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(a, face).normalize();
    const upV = new THREE.Vector3().crossVectors(face, right).normalize();
    const spin = rng() * TAU;
    const r2 = right.clone().multiplyScalar(Math.cos(spin)).addScaledVector(upV, Math.sin(spin)).multiplyScalar(size);
    const u2 = upV.clone().multiplyScalar(Math.cos(spin)).addScaledVector(right, -Math.sin(spin)).multiplyScalar(size);
    const reg = REG[rng() < 0.5 ? 0 : 1];
    // Darker low down and deep in: the crown's own shade, which a shadow map will not give it alone.
    const lift = sstep(py, 7.5, 14);
    const deep = sstep(k, 0.62, 1);
    const tone = (0.62 + 0.26 * deep + 0.26 * lift * deep) * (0.92 + rng() * 0.16);
    const hue = rng();
    const col = times(hue < 0.3 ? mix3(lush, shade, 0.55) : mix3(lush, bright, (hue - 0.3) * 1.1), tone);
    const corners = [[-1, -1, reg[0], reg[2]], [1, -1, reg[1], reg[2]], [1, 1, reg[1], reg[3]], [-1, 1, reg[0], reg[3]]];
    const emit = () => corners.map(([sx, sy, u, v]) => leaves.v(px + r2.x * sx + u2.x * sy, py + r2.y * sx + u2.y * sy, pz + r2.z * sx + u2.z * sy, nrm.x, nrm.y, nrm.z, u, v, col));
    const f = emit(); const b = emit();
    leaves.quad(f[0], f[1], f[2], f[3]);
    leaves.quad(b[3], b[2], b[1], b[0]);
  };
  const insideOther = (i, x, y, z) => lobes.some((l, j) => j !== i && Math.hypot((x - l.c[0]) / l.r[0], (y - l.c[1]) / l.r[1], (z - l.c[2]) / l.r[2]) < 0.62);
  lobes.forEach((lobe, i) => {
    const N = Math.round(lobe.r[0] * lobe.r[0] * 6.4);
    for (let n = 0; n < N; n++) {
      const y = 1 - (2 * (n + 0.5)) / N;
      const s = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = n * 2.399963 + i * 1.3;
      const dx = Math.sin(phi) * s; const dz = Math.cos(phi) * s;
      const k = rng() < 0.22 ? 0.66 + rng() * 0.16 : 0.86 + rng() * 0.18;
      const x = lobe.c[0] + dx * lobe.r[0] * k; const yy = lobe.c[1] + y * lobe.r[1] * k; const z = lobe.c[2] + dz * lobe.r[2] * k;
      if (insideOther(i, x, yy, z)) continue;
      card(lobe, dx, y, dz, k, 0.82 + rng() * 0.36);
    }
  });

  // ---- Apples ---------------------------------------------------------------------------------
  const red = lin(0xcf2a1e); const deepRed = lin(0xa01c18); const blush = lin(0xdfa63a); const stemC = lin(0x5a4228);
  const white = (y, a, c) => { c[0] = 1; c[1] = 1; c[2] = 1; };
  const appleLow = new Batch();
  latheInto(appleLow, [[0, 0.02], [0.16, 0.05], [0.215, 0.2], [0.17, 0.33], [0.06, 0.365], [0, 0.325]], 9, FLAT, white);
  const appleHigh = new Batch();
  latheInto(appleHigh, [[0, 0.015], [0.1, 0.022], [0.185, 0.1], [0.215, 0.21], [0.175, 0.32], [0.08, 0.37], [0, 0.325]], 12, FLAT, white);
  const stem = new Batch();
  tubeInto(stem, [[0, 0.3, 0], [0.012, 0.4, 0.008], [0.03, 0.47, 0.016]], 0.013, 3, FLAT, (t, c) => { c[0] = stemC[0]; c[1] = stemC[1]; c[2] = stemC[2]; });
  const stemLow = new Batch();
  ribbonInto(stemLow, [[0, 0.3, 0], [0.012, 0.4, 0.008], [0.03, 0.47, 0.016]], [0.03, 0.026, 0.022], FLAT, (t, c) => { c[0] = stemC[0]; c[1] = stemC[1]; c[2] = stemC[2]; }, [1, 0, 0.4]);
  const paintApple = (m, tb, tone, tail) => {
    const dir = rng() * TAU;
    const bl = 0.2 + rng() * 0.4;
    leaves.add(tb, m, (x, y, z, c) => {
      const side = (x * Math.sin(dir) + z * Math.cos(dir)) / 0.21;
      const base = mix3(red, deepRed, 0.5 + 0.5 * Math.sin(Math.atan2(x, z) * 3 + dir));
      const e = mix3(base, blush, sstep(side, 0.25, 1) * bl);
      const under = 0.76 + 0.24 * sstep(y, 0.02, 0.2);
      c[0] = e[0] * tone * under; c[1] = e[1] * tone * under; c[2] = e[2] * tone * under;
    });
    leaves.add(tail, m);
  };
  const hangAt = (p) => {
    // An apple hangs from its stem, so its own top is at the twig.
    const lean = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3((rng() - 0.5) * 0.5, 1, (rng() - 0.5) * 0.5).normalize());
    const s = 0.98 + rng() * 0.24;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1] - 0.44 * s, p[2]), lean, new THREE.Vector3(s, s, s));
    paintApple(m, appleLow, 0.98 + rng() * 0.2, stemLow);
  };
  for (const twig of twigs) {
    hangAt(along(twig, 0.86 + rng() * 0.14));
    if (rng() < 0.32) hangAt(along(twig, 0.55 + rng() * 0.25));
  }
  // Windfalls in the grass, each tipped over onto a different side.
  const FALLEN = [[2.6, 1.4], [-3.4, 2.1], [4.8, -2.3], [-1.6, -4.3], [6.2, 2.9], [-5.6, -1.2], [0.9, 5.4], [-4.1, 4.9], [3.3, -5.3]];
  for (const [x, z] of FALLEN) {
    const s = 0.92 + rng() * 0.14;
    const axis = new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(axis, 1 + rng() * 1.1);
    const pivot = new THREE.Vector3(0, -0.19 * s, 0).applyQuaternion(q);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x + pivot.x, 0.16 + pivot.y, z + pivot.z), q, new THREE.Vector3(s, s, s));
    paintApple(m, appleHigh, 0.88 + rng() * 0.12, stem);
  }

  return group(woodMesh, plantMesh(leaves.keepInside(10.2), map, { alphaTest: 0.45, roughness: 0.78 }));
}

export const BUILDERS = {
  'wheat-plot': wheatPlot,
  'rice-paddy': ricePaddy,
  'vegetable-garden': vegetableGarden,
  'three-sisters-garden': threeSistersGarden,
  'apple-tree': appleTree,
};
