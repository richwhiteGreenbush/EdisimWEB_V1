// Builders for the second batch of the Model Database's Life entries: the plant cell, the flower,
// the oak section, the mammoth, the stegosaurus, the eagle and the penguin.
//
// THE ANIMALS ARE WHY THIS FILE HAS ITS OWN LOFT. The first batch's reused T. rex and Triceratops
// read as balloon-muscled, because a body made of balls and tubes can only ever bulge where a ball
// is. `axisLoft` below gives the Sculpt one solid whose section is SPLINED along the animal's
// length: width, depth above the axis and depth below it, each a smooth function. A back can then
// slope, a belly can sag and a neck can run into a shoulder with no join anywhere, and the
// anatomical landmarks are added to that one surface with broad fillets.
//
// SOFT COVERINGS ARE REAL GEOMETRY, BUT ONLY WHERE IT BUYS A SILHOUETTE. A mammoth's locks and an
// eagle's feathers are closed flat solids (`lock`, `featherGeo`) lying on the body, placed by asking
// the sculpted surface where it is. They carry one near-white strand or barb painting, multiplied by
// a colour per vertex, so one small texture serves every lock and every feather on the animal.

import * as THREE from 'three';
import { mergeParts, solidSurface, smoothNoise3 } from '../../props/LoftKit.js';
import { mesh, standard, seededRandom, canvasTexture } from '../../PropKit.js';
import {
  lin, clamp01, mix, sstep, mixInto, sphereP, ellipsoidP, segsP, curveP, boxP, torusP, Sculpt, onSurface, fieldNormal, polygonize, tube, lathe, mirrorX, tintVertices, alongMatrix, outward,
} from '../ModelKit.js';

// ---------------------------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------------------------

// A cubic Hermite through unevenly spaced stations, baked to a table so a field can read it cheaply.
function hermiteTable(xs, ys, size = 256) {
  const n = xs.length;
  const m = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1); const b = Math.min(n - 1, i + 1);
    m[i] = (ys[b] - ys[a]) / (xs[b] - xs[a]);
  }
  const x0 = xs[0]; const x1 = xs[n - 1];
  const table = new Float64Array(size + 1);
  let k = 0;
  for (let i = 0; i <= size; i++) {
    const x = mix(x0, x1, i / size);
    while (k < n - 2 && x > xs[k + 1]) k += 1;
    const h = xs[k + 1] - xs[k];
    const t = clamp01((x - xs[k]) / h);
    const t2 = t * t; const t3 = t2 * t;
    table[i] = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
  }
  return (x) => {
    const f = clamp01((x - x0) / (x1 - x0)) * size;
    const i = Math.min(size - 1, Math.floor(f));
    return table[i] + (table[i + 1] - table[i]) * (f - i);
  };
}

// One smooth body whose section is splined along an axis. Stations are written from the tail end
// up as [along, centre, halfWidth, above, below]: `along` runs on z (or y, with axis 'y'), `centre`
// is y (or z) and `above`/`below` are the section's two half-depths, so a belly can hang deeper than
// a back without a second solid. It is a bound rather than a true distance, but it is first-order
// right near the surface and polygonize divides by the slope.
function axisLoft(stations, axis = 'z') {
  const along = stations.map((s) => s[0]);
  const c = hermiteTable(along, stations.map((s) => s[1]));
  const w = hermiteTable(along, stations.map((s) => s[2]));
  const up = hermiteTable(along, stations.map((s) => s[3]));
  const dn = hermiteTable(along, stations.map((s) => s[4]));
  const a0 = along[0]; const a1 = along[along.length - 1];
  const wide = Math.max(...stations.map((s) => s[2]));
  const lo = Math.min(...stations.map((s) => s[1] - s[4]));
  const hi = Math.max(...stations.map((s) => s[1] + s[3]));
  const dist = (a, b, x) => {
    const t = a < a0 ? a0 : a > a1 ? a1 : a;
    const db = b - c(t);
    const rw = Math.max(1e-3, w(t));
    const rb = Math.max(1e-3, db > 0 ? up(t) : dn(t));
    const q = Math.hypot(x / rw, db / rb);
    const d = (q - 1) * Math.min(rw, rb);
    const over = a < a0 ? a0 - a : a > a1 ? a - a1 : 0;
    return over > 0 ? Math.hypot(Math.max(d, 0), over) : d;
  };
  if (axis === 'y') {
    return {
      box: [-wide, a0, lo, wide, a1, hi],
      f: (x, y, z) => dist(y, z, x),
      centre: c, width: w, above: up, below: dn,
    };
  }
  return {
    box: [-wide, lo, a0, wide, hi, a1],
    f: (x, y, z) => dist(z, y, x),
    centre: c, width: w, above: up, below: dn,
  };
}

// A solid squashed about a point, with the distance corrected by the tightest axis so it stays a
// bound. A beak or a flattened flipper is a curve chain with this round it.
function squash(prim, [sx, sy, sz], about = [0, 0, 0]) {
  const m = Math.min(sx, sy, sz);
  const [ax, ay, az] = about;
  const b = prim.box;
  const mapX = (v) => ax + (v - ax) * sx;
  const mapY = (v) => ay + (v - ay) * sy;
  const mapZ = (v) => az + (v - az) * sz;
  return {
    box: [mapX(b[0]), mapY(b[1]), mapZ(b[2]), mapX(b[3]), mapY(b[4]), mapZ(b[5])],
    f: (x, y, z) => prim.f(ax + (x - ax) / sx, ay + (y - ay) / sy, az + (z - az) / sz) * m,
  };
}

// The surface nets' skew UVs stretch to streaks along one band of normals, which a directional bump
// shows at once. This re-lays them per triangle along its dominant axis, splitting a vertex only
// where two faces disagree. Sideways-facing skin keeps v running up the animal, so a feather or a
// scale stays the right way up, and a seam in an isotropic pattern cannot be found.
function boxUV(geometry, scale) {
  const P = geometry.attributes.position;
  const N = geometry.attributes.normal;
  const C = geometry.attributes.color;
  const idx = geometry.index;
  const pos = []; const nor = []; const col = []; const uv = []; const out = [];
  const seen = new Map();
  const put = (v, axis) => {
    const key = v * 3 + axis;
    let at = seen.get(key);
    if (at !== undefined) return at;
    at = pos.length / 3;
    seen.set(key, at);
    const x = P.getX(v); const y = P.getY(v); const z = P.getZ(v);
    pos.push(x, y, z);
    nor.push(N.getX(v), N.getY(v), N.getZ(v));
    if (C) col.push(C.getX(v), C.getY(v), C.getZ(v));
    if (axis === 0) uv.push(z * scale, y * scale);
    else if (axis === 2) uv.push(x * scale, y * scale);
    else uv.push(x * scale, z * scale);
    return at;
  };
  const ab = new THREE.Vector3(); const ac = new THREE.Vector3(); const a = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t); const i1 = idx.getX(t + 1); const i2 = idx.getX(t + 2);
    a.fromBufferAttribute(P, i0);
    ab.fromBufferAttribute(P, i1).sub(a);
    ac.fromBufferAttribute(P, i2).sub(a);
    ab.cross(ac);
    const ax = Math.abs(ab.x); const ay = Math.abs(ab.y); const az = Math.abs(ab.z);
    const axis = ax >= ay && ax >= az ? 0 : az >= ay ? 2 : 1;
    out.push(put(i0, axis), put(i1, axis), put(i2, axis));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (C) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(out);
  return g;
}

// Walks a polygonised surface's own vertices in a seeded random order and hands back one per cell of a
// grid. Surface nets space their vertices evenly, so this covers a body evenly whatever its shape.
function scatterOn(geometry, spacing, rng, fn) {
  const P = geometry.attributes.position; const N = geometry.attributes.normal;
  const seen = new Set();
  const order = [];
  for (let i = 0; i < P.count; i++) order.push(i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
  for (const i of order) {
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    const key = `${Math.floor(x / spacing)},${Math.floor(y / spacing)},${Math.floor(z / spacing)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fn(x, y, z, N.getX(i), N.getY(i), N.getZ(i));
  }
}

function repeatWrap(texture, rx = 1, ry = 1) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(rx, ry);
  return texture;
}

// ---------------------------------------------------------------------------------------------
// Tree trunk section
// ---------------------------------------------------------------------------------------------

// THE COUNT IS THE MODEL. A student is told to count the rings, so the rings come out of a table of
// exactly TRUNK_RINGS widths and the painting asks that table, per texel, which ring each texel is
// in. There is no way to paint a 41st. The widths are a made-up climate record with the card's
// story in it: fast young growth, then a run of good years and a run of hard ones.
export const TRUNK_RINGS = 40;
const TRUNK_SAPWOOD_RINGS = 8;
const TRUNK_WOOD_R = 1.7;
const TRUNK_BARK_R = 1.98;
const TRUNK_TILT = Math.tan(0.23); // the saw ran about 13 degrees off level, toward the student
const TRUNK_HEIGHT = 3;

function trunkRingEdges() {
  const rng = seededRandom(40177);
  const hard = new Set([9, 10, 17, 24, 25, 26, 33]);
  const good = new Set([4, 5, 13, 14, 20, 29, 30, 37]);
  const raw = [];
  for (let i = 0; i < TRUNK_RINGS; i++) {
    let w = mix(1.5, 0.92, sstep(i, 0, 24)) * (0.86 + rng() * 0.28);
    if (hard.has(i)) w *= 0.56;
    if (good.has(i)) w *= 1.42;
    raw.push(w);
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  const edges = [0];
  for (const w of raw) edges.push(edges[edges.length - 1] + (w / sum) * TRUNK_WOOD_R);
  return edges;
}

// How far off round the rings run at this bearing. The same function shapes the wood's edge, so a
// ring can never be cut by the bark.
function trunkLobe(a) {
  return 1 + 0.03 * Math.sin(2 * a + 1.1) + 0.017 * Math.sin(3 * a + 2.3) + 0.009 * Math.sin(5 * a + 0.4);
}

// The bark's outer radius: long ridges that interlace, the diamond furrows of an old oak. A triangle
// wave with a plateau leaves V-shaped furrows and rough flat ridge tops.
function barkHeight(a, y) {
  const N = 22;
  const tri = (v) => 1 - Math.abs(2 * (v - Math.floor(v)) - 1);
  const c = (a / (Math.PI * 2)) * N;
  const wander = 0.16 * Math.sin(y * 2.3 + a * 5) + 0.09 * Math.sin(y * 4.1 - a * 9 + 1.4);
  // Two families of long diagonal furrows cross, and what stands between them is a plate.
  const plate = Math.min(tri(c + y * 0.5 + wander), tri(c - y * 0.5 + wander + 0.5) * 0.7 + tri(c + 0.25 + wander) * 0.3);
  const ridge = sstep(plate, 0.08, 0.5);
  const flake = 0.86 + 0.14 * Math.sin(y * 11 + a * 19 + 2 * Math.sin(a * 11));
  return ridge * flake;
}

function trunkBarkRadius(a, y) {
  const lobe = trunkLobe(a);
  return (TRUNK_WOOD_R * lobe) + 0.06 + (TRUNK_BARK_R - TRUNK_WOOD_R - 0.06) * barkHeight(a, y);
}

const trunkTopY = (z) => TRUNK_HEIGHT - z * TRUNK_TILT;

function treeTrunkSection() {
  const edges = trunkRingEdges();
  const COLS = 264;
  const ROWS = 40;
  const TEX_HALF = 2.12; // feet from the centre to the edge of the painting

  // --- The cut face, painted per texel -------------------------------------------------------
  const faceMap = canvasTexture(1536, 1536, (ctx, W, H) => {
    const img = ctx.createImageData(W, H);
    const data = img.data;
    const rng = seededRandom(40178);
    // Rays: the pale radial flecks oak is known for, each starting at its own depth.
    const RAYS = 720;
    const rayAt = new Float32Array(RAYS);
    const rayFrom = new Float32Array(RAYS);
    for (let i = 0; i < RAYS; i++) {
      rayAt[i] = rng() < 0.42 ? 0.35 + rng() * 0.65 : 0;
      rayFrom[i] = rng() * 0.8;
    }
    // Drying checks: a few thin radial cracks from near the pith. Thin enough never to read as a ring.
    const CHECKS = [[0.5, 0.74], [2.2, 0.58], [3.4, 0.82], [4.9, 0.46], [5.7, 0.63]];
    const heartEdge = edges[TRUNK_RINGS - TRUNK_SAPWOOD_RINGS];
    const PITH = [0.1, -0.07];
    const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
    const earlyHeart = [132, 90, 54]; const lateHeart = [64, 37, 20];
    const earlySap = [232, 202, 146]; const lateSap = [172, 130, 76];
    for (let py = 0; py < H; py++) {
      const pz = ((py + 0.5) / H) * 2 - 1;
      for (let px = 0; px < W; px++) {
        const fx = (((px + 0.5) / W) * 2 - 1) * TEX_HALF;
        const fz = pz * TEX_HALF;
        const r0 = Math.hypot(fx, fz);
        const frac = Math.min(1, r0 / TRUNK_WOOD_R);
        // The pith sits off centre, and the off-centring dies away toward the bark.
        const qx = fx - PITH[0] * (1 - frac);
        const qz = fz - PITH[1] * (1 - frac);
        const a = Math.atan2(qz, qx);
        const lobe = 1 + (trunkLobe(a) - 1) * clamp01(frac * 1.4);
        const fine = 0.0035 * Math.sin(a * 17 + Math.hypot(qx, qz) * 9) + 0.0022 * Math.sin(a * 41 + 2);
        const rho = (Math.hypot(qx, qz) + fine * frac) / lobe;
        let R; let G; let B;
        if (rho < TRUNK_WOOD_R) {
          // Which ring this texel is in, by the table.
          let lo = 0; let hi = TRUNK_RINGS;
          while (hi - lo > 1) { const m = (lo + hi) >> 1; if (edges[m] <= rho) lo = m; else hi = m; }
          const t = (rho - edges[lo]) / (edges[lo + 1] - edges[lo]);
          const heart = rho < heartEdge;
          const E = heart ? earlyHeart : earlySap;
          const L = heart ? lateHeart : lateSap;
          // Pale, porous spring wood, darkening to a hard summer line that ends the year abruptly.
          const k = t * t * (3 - 2 * t) * 0.72 + sstep(t, 0.74, 0.97) * 0.28;
          R = mix(E[0], L[0], k); G = mix(E[1], L[1], k); B = mix(E[2], L[2], k);
          // Each year's wood is a little different overall, which is what a real section shows.
          const yearTone = 0.94 + 0.12 * hash(lo, 3.7);
          R *= yearTone; G *= yearTone; B *= yearTone;
          // Ring-porous: big vessels in the spring wood only.
          if (t < 0.34 && hash(px, py) > 0.8) { const d = heart ? 0.74 : 0.84; R *= d; G *= d; B *= d; }
          // Medullary rays.
          const bin = (Math.floor(((a + Math.PI) / (Math.PI * 2)) * RAYS * 0.999));
          const ray = rayAt[bin];
          if (ray > 0 && rho / TRUNK_WOOD_R > rayFrom[bin]) {
            const lift = 0.13 * ray * (0.5 + 0.5 * Math.sin(rho * 90 + bin));
            R += (255 - R) * lift; G += (235 - G) * lift; B += (190 - B) * lift;
          }
          // Checks.
          for (const [ca, reach] of CHECKS) {
            let da = a - ca; if (da < -Math.PI) da += Math.PI * 2; if (da > Math.PI) da -= Math.PI * 2;
            const off = Math.abs(da + 0.018 * Math.sin(rho * 11 + ca)) * rho;
            const edge = TRUNK_WOOD_R * reach;
            const width = 0.008 * (1 - rho / edge);
            if (rho < edge && rho > 0.05 && off < width) { R *= 0.28; G *= 0.25; B *= 0.22; }
          }
          // The saw's faint parallel marks.
          const saw = 1 + 0.02 * Math.sin(fx * 58 + fz * 9 + Math.sin(fz * 3) * 2);
          R *= saw; G *= saw; B *= saw;
          // The pith.
          if (rho < 0.024) { R = 40; G = 24; B = 14; }
          // The cambium, a thin dark-green line the card names, right at the wood's edge.
          if (rho > TRUNK_WOOD_R - 0.012) { R = 96; G = 92; B = 42; }
        } else {
          // Living inner bark, then corky outer bark with short radial cracks in it.
          const depth = rho - TRUNK_WOOD_R;
          const crack = 0.5 + 0.5 * Math.sin(a * 70 + Math.sin(a * 31) * 3);
          if (depth < 0.03) { R = 122; G = 78; B = 48; } else {
            const v = 0.62 + 0.38 * crack;
            R = 66 * v; G = 48 * v; B = 34 * v;
          }
        }
        const at = (py * W + px) * 4;
        data[at] = R; data[at + 1] = G; data[at + 2] = B; data[at + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });

  // --- The face: a polar grid whose rim is exactly the bark's top row ------------------------
  const barkAt = (i, y) => {
    const a = (i / COLS) * Math.PI * 2;
    return trunkBarkRadius(a, y);
  };
  // The rim y depends on z and z on the radius, so settle it with a couple of passes.
  const rim = [];
  for (let i = 0; i < COLS; i++) {
    const a = (i / COLS) * Math.PI * 2;
    let y = TRUNK_HEIGHT;
    let r = 2;
    for (let k = 0; k < 4; k++) { r = barkAt(i, y); y = trunkTopY(Math.sin(a) * r); }
    rim.push({ a, r, y });
  }
  const facePos = []; const faceUv = []; const faceIdx = [];
  const faceRings = 7;
  facePos.push(0, trunkTopY(0), 0);
  faceUv.push(0.5, 0.5);
  const uvOf = (x, z) => [0.5 + x / (2 * TEX_HALF), 1 - (0.5 + z / (2 * TEX_HALF))];
  for (let j = 1; j <= faceRings; j++) {
    const f = j / faceRings;
    for (let i = 0; i < COLS; i++) {
      const x = Math.cos(rim[i].a) * rim[i].r * f;
      const z = Math.sin(rim[i].a) * rim[i].r * f;
      facePos.push(x, j === faceRings ? rim[i].y : trunkTopY(z), z);
      const uv = uvOf(x, z);
      faceUv.push(uv[0], uv[1]);
    }
  }
  const ringAt = (j, i) => 1 + (j - 1) * COLS + ((i + COLS) % COLS);
  for (let i = 0; i < COLS; i++) {
    faceIdx.push(0, ringAt(1, i + 1), ringAt(1, i));
    for (let j = 1; j < faceRings; j++) {
      const a = ringAt(j, i); const b = ringAt(j, i + 1); const c = ringAt(j + 1, i + 1); const d = ringAt(j + 1, i);
      faceIdx.push(a, b, c, a, c, d);
    }
  }
  const face = new THREE.BufferGeometry();
  face.setAttribute('position', new THREE.Float32BufferAttribute(facePos, 3));
  face.setAttribute('uv', new THREE.Float32BufferAttribute(faceUv, 2));
  face.setIndex(faceIdx);
  face.computeVertexNormals();

  // --- The bark: a grid in (bearing, height) -------------------------------------------------
  const pos = []; const col = []; const uvs = []; const idx = [];
  const RIDGE = lin(0x57493c); const RIDGE2 = lin(0x75675a); const FURROW = lin(0x100a06); const LICHEN = lin(0x8b9276); const MOSS = lin(0x46602a);
  const rgb = [0, 0, 0];
  for (let j = 0; j <= ROWS; j++) {
    const f = j / ROWS;
    for (let i = 0; i <= COLS; i++) {
      const ii = i % COLS;
      const a = rim[ii].a;
      const y = rim[ii].y * f;
      const r = j === ROWS ? rim[ii].r : trunkBarkRadius(a, y);
      const x = Math.cos(a) * r; const z = Math.sin(a) * r;
      pos.push(x, y, z);
      uvs.push((i / COLS) * 7, y * 1.1);
      const h = barkHeight(a, y);
      const tone = smoothNoise3(x * 1.3, y * 1.3, z * 1.3);
      rgb[0] = mix(RIDGE[0], RIDGE2[0], tone); rgb[1] = mix(RIDGE[1], RIDGE2[1], tone); rgb[2] = mix(RIDGE[2], RIDGE2[2], tone);
      // Lichen on the ridge tops, in patches, and moss low down on the shaded north side.
      const lichen = sstep(smoothNoise3(x * 3.3 + 4, y * 3.3, z * 3.3), 0.68, 0.84);
      mixInto(rgb, LICHEN, lichen * 0.45);
      const moss = sstep(0.9 - y, 0, 0.8) * sstep(-z, -0.6, 1.2) * sstep(smoothNoise3(x * 1.6, y * 1.6 + 7, z * 1.6), 0.42, 0.66);
      mixInto(rgb, MOSS, moss * 0.55);
      mixInto(rgb, FURROW, 1 - sstep(h, 0.06, 0.72));
      col.push(rgb[0], rgb[1], rgb[2]);
    }
  }
  const row = COLS + 1;
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const a = j * row + i; const b = a + 1; const c = a + row + 1; const d = a + row;
      // Bearing runs x toward z, which is clockwise seen from above, and y runs up.
      idx.push(a, d, c, a, c, b);
    }
  }
  const bark = new THREE.BufferGeometry();
  bark.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bark.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  bark.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  bark.setIndex(idx);
  bark.computeVertexNormals();
  // The grid's seam column is duplicated for its texture coordinate, so its normals are welded.
  const nrm = bark.attributes.normal;
  for (let j = 0; j <= ROWS; j++) {
    const a = j * row; const b = a + COLS;
    const nx = nrm.getX(a) + nrm.getX(b); const ny = nrm.getY(a) + nrm.getY(b); const nz = nrm.getZ(a) + nrm.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm.setXYZ(a, nx / l, ny / l, nz / l);
    nrm.setXYZ(b, nx / l, ny / l, nz / l);
  }

  // The sawn underside, so the section is a closed solid. It sits on the ground and is never seen.
  const under = new THREE.CircleGeometry(TRUNK_WOOD_R, 32).rotateX(Math.PI / 2);

  const barkBump = canvasTexture(512, 512, (ctx, w, h) => {
    const rng = seededRandom(40179);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    // Vertical flakes: bark's grain runs with the trunk.
    for (let i = 0; i < 2600; i++) {
      const x = rng() * w; const y = rng() * h; const l = 8 + rng() * 44; const t = 1 + rng() * 3;
      const v = Math.round(128 + (rng() > 0.5 ? 1 : -1) * (30 + rng() * 80));
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) ctx.fillRect(x + ox, y + oy, t, l);
    }
  });
  barkBump.colorSpace = THREE.NoColorSpace;
  repeatWrap(barkBump);

  const root = new THREE.Group();
  root.name = 'tree-trunk-section';
  root.add(mesh(face, standard({ map: faceMap, bumpMap: faceMap, bumpScale: 0.35, roughness: 0.72, metalness: 0 })));
  root.add(mesh(mergeParts([{ geometry: bark, keepColor: true }, { geometry: under, color: 0x6a4a2c }]), standard({ vertexColors: true, bumpMap: barkBump, bumpScale: 1.1, roughness: 0.95, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Plant cell
// ---------------------------------------------------------------------------------------------

// A rounded cube shell with its +X/+Y/+Z corner removed, as a closed solid of real thickness. There
// is no CSG, and surface nets would spend 60k triangles on what is mostly flat, so the outer and
// inner skins are one grid each with the removed cells skipped, and three rim strips close the cut.
// Both skins share the same centres of curvature, which is what makes the rims meet them exactly.
function cellShell({ h, r, t, centre, cut, outer, inner, rim, uvScale = 1 }) {
  const pos = []; const nor = []; const col = []; const uv = []; const idx = [];
  const FR = [0, 0.34, 0.68, 1];
  const linesFor = (radius, half, cutAt) => {
    const flat = half - radius;
    const set = new Set([cutAt]);
    for (const f of FR) { set.add(flat + f * radius); set.add(-flat - f * radius); }
    return [...set].sort((a, b) => a - b);
  };
  const clampQ = (v, flat) => (v > flat ? flat : v < -flat ? -flat : v);
  // A cube-surface point onto the rounded box of radius `rr` about the same inner box.
  const place = (p, flat, rr) => {
    const q = [clampQ(p[0], flat), clampQ(p[1], flat), clampQ(p[2], flat)];
    const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const n = [d[0] / l, d[1] / l, d[2] / l];
    return { p: [q[0] + n[0] * rr + centre[0], q[1] + n[1] * rr + centre[1], q[2] + n[2] * rr + centre[2]], n };
  };
  const skin = (half, radius, color, sign) => {
    const flat = half - radius;
    const lines = [linesFor(radius, half, cut[0]), linesFor(radius, half, cut[1]), linesFor(radius, half, cut[2])];
    for (let A = 0; A < 3; A++) {
      const B = (A + 1) % 3; const C = (A + 2) % 3;
      for (const s of [1, -1]) {
        const base = pos.length / 3;
        const nb = lines[B].length; const nc = lines[C].length;
        for (let i = 0; i < nb; i++) {
          for (let j = 0; j < nc; j++) {
            const p = [0, 0, 0];
            p[A] = s * half; p[B] = lines[B][i]; p[C] = lines[C][j];
            const v = place(p, flat, radius);
            pos.push(v.p[0], v.p[1], v.p[2]);
            nor.push(v.n[0] * sign, v.n[1] * sign, v.n[2] * sign);
            col.push(color[0], color[1], color[2]);
            uv.push(p[B] * uvScale, p[C] * uvScale);
          }
        }
        const flipFace = (s * sign) < 0;
        for (let i = 0; i < nb - 1; i++) {
          for (let j = 0; j < nc - 1; j++) {
            const m = [0, 0, 0];
            m[A] = s * half; m[B] = (lines[B][i] + lines[B][i + 1]) / 2; m[C] = (lines[C][j] + lines[C][j + 1]) / 2;
            if (m[0] > cut[0] && m[1] > cut[1] && m[2] > cut[2]) continue;
            const a = base + i * nc + j; const b = base + (i + 1) * nc + j; const c = base + (i + 1) * nc + j + 1; const d = base + i * nc + j + 1;
            if (flipFace) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
          }
        }
      }
    }
  };
  const flatO = h - r;
  skin(h, r, outer, 1);
  skin(h - t, r - t, inner, -1);
  // The rims. Each path runs along the cut on the cube's surface; the inner edge is the same point
  // pulled in by the wall thickness along its own radius of curvature.
  const lines = [linesFor(r, h, cut[0]), linesFor(r, h, cut[1]), linesFor(r, h, cut[2])];
  const up = (axis, from) => lines[axis].filter((v) => v >= from);
  const path = (normalAxis, a2, a3) => {
    // On plane normalAxis = cut: along the a2 = h face with a3 rising from its cut, then back along
    // the a3 = h face with a2 falling to its cut.
    const pts = [];
    for (const v of up(a3, cut[a3])) { const p = [0, 0, 0]; p[normalAxis] = cut[normalAxis]; p[a2] = h; p[a3] = v; pts.push(p); }
    for (const v of up(a2, cut[a2]).reverse()) {
      if (v === h) continue;
      const p = [0, 0, 0]; p[normalAxis] = cut[normalAxis]; p[a2] = v; p[a3] = h; pts.push(p);
    }
    const base = pos.length / 3;
    const n = [0, 0, 0]; n[normalAxis] = 1;
    for (const p of pts) {
      const o = place(p, flatO, r); const i = place(p, flatO, r - t);
      for (const v of [o, i]) {
        pos.push(v.p[0], v.p[1], v.p[2]);
        nor.push(n[0], n[1], n[2]);
        col.push(rim[0], rim[1], rim[2]);
        uv.push(v.p[a2] * uvScale, v.p[a3] * uvScale);
      }
    }
    const P = (k) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    for (let k = 0; k < pts.length - 1; k++) {
      const a = base + k * 2; const b = base + k * 2 + 1; const c = base + k * 2 + 3; const d = base + k * 2 + 2;
      // Measured rather than assumed, since these three paths are not all the same handedness.
      const face = P(b).sub(P(a)).cross(P(c).sub(P(a)));
      if (face.dot(new THREE.Vector3(n[0], n[1], n[2])) > 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
    }
  };
  path(0, 2, 1);
  path(1, 0, 2);
  path(2, 0, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// The organelle painting: one atlas, near white where a vertex colour is to carry the hue. A cut
// organelle's insides are finer than any mesh here, which is the argument for painting them.
const CELL_ATLAS = {
  plain: [0.76, 0.01, 0.98, 0.23],
  chloro: [0.0, 0.5, 0.5, 1.0],
  mito: [0.5, 0.5, 1.0, 1.0],
  nucleus: [0.0, 0.0, 0.5, 0.5],
  pores: [0.5, 0.25, 1.0, 0.5],
};

function cellAtlas() {
  return canvasTexture(1024, 1024, (ctx, W, H) => {
    const rng = seededRandom(7711);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    const S = 512;
    // Canvas y runs down and v runs up, so the top half of the canvas is v 0.5..1.
    // --- A chloroplast's section: pale stroma, dark grana in stacks, lamellae joining them.
    ctx.fillStyle = '#b9dd72';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = `rgba(226,240,150,${0.2 + rng() * 0.3})`;
      ctx.beginPath(); ctx.arc(rng() * S, rng() * S, 2 + rng() * 5, 0, Math.PI * 2); ctx.fill();
    }
    // Long lamellae run lengthwise; the stacks sit across them.
    ctx.strokeStyle = '#3f8a2c';
    ctx.lineWidth = 4;
    for (let k = 0; k < 5; k++) {
      const y = S * (0.18 + k * 0.16);
      ctx.beginPath(); ctx.moveTo(0, y);
      for (let x = 0; x <= S; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + k * 2) * 7);
      ctx.stroke();
    }
    for (let i = 0; i < 9; i++) {
      for (let k = 0; k < 4; k++) {
        const x = S * (0.08 + i * 0.105) + (k % 2) * 22;
        const y = S * (0.16 + k * 0.215) + (rng() - 0.5) * 12;
        const layers = 6 + Math.floor(rng() * 4);
        const w = 44 + rng() * 14;
        for (let l = 0; l < layers; l++) {
          ctx.fillStyle = l % 2 ? '#1f6a1f' : '#123f14';
          ctx.fillRect(x - w / 2, y - layers * 3.5 + l * 7, w, 6);
        }
      }
    }
    // --- A mitochondrion's section: an orange matrix with folded cristae coming in from both sides.
    ctx.fillStyle = '#f2a65c';
    ctx.fillRect(S, 0, S, S);
    ctx.lineCap = 'round';
    for (let i = 0; i < 11; i++) {
      const x = S + S * (0.06 + i * 0.09);
      const top = i % 2 === 0;
      ctx.strokeStyle = '#a2331c';
      ctx.lineWidth = 15;
      ctx.beginPath();
      ctx.moveTo(x, top ? 0 : S);
      ctx.quadraticCurveTo(x + 18, S * 0.5, x + 3, top ? S * 0.74 : S * 0.26);
      ctx.stroke();
      ctx.strokeStyle = '#ffdca8';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    // --- The nucleus's section: chromatin in a violet nucleoplasm, a double envelope with gaps at the pores.
    const cx = S / 2; const cy = S + S / 2; const R = S * 0.5;
    ctx.fillStyle = '#b48be0';
    ctx.fillRect(0, S, S, S);
    for (let i = 0; i < 520; i++) {
      const a = rng() * Math.PI * 2; const r = R * Math.sqrt(rng()) * 0.94;
      ctx.fillStyle = rng() > 0.5 ? 'rgba(92,44,150,0.55)' : 'rgba(216,186,244,0.5)';
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3 + rng() * 11, 2 + rng() * 5, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 12; ctx.strokeStyle = '#4a1f86';
    ctx.beginPath(); ctx.arc(cx, cy, R - 7, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 6; ctx.strokeStyle = '#e4d2f8';
    ctx.beginPath(); ctx.arc(cx, cy, R - 18, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 8; ctx.strokeStyle = '#4a1f86';
    ctx.beginPath(); ctx.arc(cx, cy, R - 26, 0, Math.PI * 2); ctx.stroke();
    // --- The nucleus's outside: pores in rings on a purple envelope.
    const py0 = S; const py1 = S + S / 2;
    ctx.fillStyle = '#8c52c8';
    ctx.fillRect(S, py0, S, S / 2);
    for (let i = 0; i < 300; i++) {
      const x = S + rng() * S; const y = py0 + rng() * (py1 - py0);
      const r = 3.5 + rng() * 2;
      ctx.fillStyle = '#c9a4ee'; ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3a176c'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(S, S + S / 2, S, S / 2);
  });
}

// A rectangle of the atlas, as a function of two 0..1 numbers.
const atlasUv = (rect, a, b) => [mix(rect[0], rect[2], a), mix(rect[1], rect[3], b)];
const setPlainUv = (g) => {
  const uv = g.attributes.uv;
  const [u, v] = atlasUv(CELL_ATLAS.plain, 0.5, 0.5);
  if (!uv) { g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); }
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, u, v);
  return g;
};

// A bean cut lengthwise, so the flat face shows what is inside: a dome below y = 0 and a painted
// face at y = 0. Authored with its length on X, bent toward +Z.
function halfBean({ L, W, D, bend, rect, dome, seed = 0 }) {
  const ROWS = 16; const COLS = 9;
  const centre = (s) => bend * (1 - s * s);
  const half = (s) => (W / 2) * Math.max(0.001, Math.sqrt(1 - s * s)) * (1 + 0.1 * Math.sin(s * 2 + seed));
  const sAt = (i) => -Math.cos((i / ROWS) * Math.PI);
  const pos = []; const idx = [];
  for (let i = 0; i <= ROWS; i++) {
    const s = sAt(i);
    for (let j = 0; j <= COLS; j++) {
      const phi = (j / COLS) * Math.PI;
      pos.push((L / 2) * s, -D * Math.sqrt(1 - s * s) * Math.sin(phi), centre(s) + half(s) * Math.cos(phi));
    }
  }
  const row = COLS + 1;
  for (let i = 0; i < ROWS; i++) {
    for (let j = 0; j < COLS; j++) {
      const a = i * row + j; const b = a + 1; const c = a + row + 1; const d = a + row;
      idx.push(a, b, c, a, c, d);
    }
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shell.setIndex(idx);
  shell.computeVertexNormals();
  setPlainUv(shell);
  tintVertices(shell, () => {});
  const shellCol = shell.attributes.color;
  const Pp = shell.attributes.position;
  const c0 = lin(dome);
  for (let i = 0; i < shellCol.count; i++) {
    const k = 0.72 + 0.28 * clamp01(-Pp.getY(i) / D);
    shellCol.setXYZ(i, c0[0] * k, c0[1] * k, c0[2] * k);
  }
  // The face. Its top-of-dome rim keeps the same outline, so the two share an edge.
  const fp = []; const fu = []; const fi = [];
  const FC = 6;
  for (let i = 0; i <= ROWS; i++) {
    const s = sAt(i);
    for (let j = 0; j <= FC; j++) {
      const f = 1 - (2 * j) / FC;
      fp.push((L / 2) * s, 0, centre(s) + half(s) * f);
      const uv = atlasUv(rect, (s + 1) / 2, (f + 1) / 2);
      fu.push(uv[0], uv[1]);
    }
  }
  const fr = FC + 1;
  for (let i = 0; i < ROWS; i++) {
    for (let j = 0; j < FC; j++) {
      const a = i * fr + j; const b = a + 1; const c = a + fr + 1; const d = a + fr;
      fi.push(a, c, b, a, d, c);
    }
  }
  const face = new THREE.BufferGeometry();
  face.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
  face.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
  face.setIndex(fi);
  face.computeVertexNormals();
  tintVertices(face, (x, y, z, out) => { out[0] = 1; out[1] = 1; out[2] = 1; });
  return { shell, face };
}

function plantCell() {
  const H = 4; const Y0 = 0.55; const CY = Y0 + H;
  const CUT = -1.2;       // the notch runs past the middle in plan, so the diagonal view reaches the back
  const FLOOR_Y = 3.0;    // the lower band stays, and the cytoplasm's surface is level with its top
  const cutLocal = [CUT, FLOOR_Y - CY, CUT];
  const WALL_T = 0.32; const GAP = 0.05; const MEM_T = 0.08;
  const memH = H - WALL_T - GAP;

  const wall = cellShell({
    h: H, r: 0.5, t: WALL_T, centre: [0, CY, 0], cut: cutLocal,
    outer: lin(0x3f9e36), inner: lin(0x0e2a0e), rim: lin(0x2d7f2b),
  });
  // The membrane stands a hair proud of the wall at the cut, which is what lets it read as a layer
  // of its own rather than a stripe painted on the wall's edge.
  const LIP = 0.045;
  const membrane = cellShell({
    h: memH, r: 0.13, t: MEM_T, centre: [0, CY, 0], cut: [CUT + LIP, cutLocal[1] + LIP, CUT + LIP],
    outer: lin(0xe8cf52), inner: lin(0xdcf5bd), rim: lin(0xf2dc55),
  });

  // --- The cytoplasm's surface: a slow swell over the whole floor -----------------------------
  const inner = memH - MEM_T - 0.01;
  const bedAt = (x, z) => FLOOR_Y - 0.03 + 0.035 * Math.sin(x * 1.7 + 1) * Math.sin(z * 1.4 + 2) + 0.012 * Math.sin(x * 4 + z * 3);
  const bed = new THREE.PlaneGeometry(inner * 2, inner * 2, 30, 30).rotateX(-Math.PI / 2);
  {
    const p = bed.attributes.position; const u = bed.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      p.setY(i, bedAt(p.getX(i), p.getZ(i)));
      u.setXY(i, p.getX(i), p.getZ(i));
    }
    bed.computeVertexNormals();
  }
  const bedColor = 0xcdeea8;

  const fibres = canvasTexture(512, 512, (ctx, w, h) => {
    const rng = seededRandom(7712);
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, 0, w, h);
    // Cellulose: long microfibrils in two crossing families. Wrapped by drawing each three times.
    for (let i = 0; i < 300; i++) {
      const x = rng() * w; const y = rng() * h; const a = (rng() > 0.5 ? 0.42 : -0.5) + (rng() - 0.5) * 0.14;
      const l = 120 + rng() * 240;
      const v = rng() > 0.45 ? 255 : 214;
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.3 + rng() * 0.4})`;
      ctx.lineWidth = 1 + rng() * 1.8;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        ctx.beginPath(); ctx.moveTo(x + ox, y + oy); ctx.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); ctx.stroke();
      }
    }
    // Pits: thin places where plasmodesmata cross into the next cell.
    for (let i = 0; i < 26; i++) {
      const x = rng() * w; const y = rng() * h;
      for (let k = 0; k < 7; k++) {
        const dx = (rng() - 0.5) * 42; const dy = (rng() - 0.5) * 42;
        ctx.fillStyle = 'rgba(96,120,84,0.6)';
        ctx.beginPath(); ctx.arc(x + dx, y + dy, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
  });
  repeatWrap(fibres, 0.42, 0.42);

  const speckle = canvasTexture(512, 512, (ctx, w, h) => {
    const rng = seededRandom(7713);
    ctx.fillStyle = '#f6f6f6';
    ctx.fillRect(0, 0, w, h);
    // Free ribosomes: fine dots, in the tiny clusters they really form.
    for (let i = 0; i < 300; i++) {
      const x = rng() * w; const y = rng() * h;
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = 'rgba(112,150,80,0.6)';
        ctx.beginPath(); ctx.arc(x + (rng() - 0.5) * 9, y + (rng() - 0.5) * 9, 1.1 + rng() * 0.8, 0, Math.PI * 2); ctx.fill();
      }
    }
  });
  repeatWrap(speckle, 0.45, 0.45);

  // --- Organelles -----------------------------------------------------------------------------
  const parts = [];
  const place = (geometry, origin, xDir, normal) => {
    const X = new THREE.Vector3(...xDir).normalize();
    const Y = new THREE.Vector3(...normal).normalize();
    X.addScaledVector(Y, -X.dot(Y)).normalize();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    const m = new THREE.Matrix4().makeBasis(X, Y, Z);
    m.setPosition(origin[0], origin[1], origin[2]);
    geometry.applyMatrix4(m);
    return geometry;
  };
  const addCut = (spec, origin, xDir, normal) => {
    const { shell, face } = halfBean(spec);
    parts.push({ geometry: place(shell, origin, xDir, normal), keepColor: true });
    parts.push({ geometry: place(face, origin, xDir, normal), keepColor: true });
  };
  // A whole bean, half sunk into whatever it lies against.
  const addWhole = (L, W, D, bend, color, origin, xDir, normal) => {
    const pts = [];
    for (let i = 0; i <= 6; i++) { const s = -1 + i / 3; pts.push([(L / 2) * s * 0.86, 0, bend * (1 - s * s)]); }
    const g = tube(pts, [0.5, 0.86, 1, 1, 1, 0.86, 0.5].map((k) => (k * W) / 2), {
      sides: 12, steps: 14, round: 3, frame: () => [0, 1, 0], section: () => [D / (W / 2) / 2, 1],
    });
    setPlainUv(g);
    const c = lin(color);
    tintVertices(g, (x, y, z, out) => {
      const k = 0.86 + 0.24 * smoothNoise3(x * 2.4, y * 2.4 + 3, z * 2.4);
      out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
    });
    parts.push({ geometry: place(g, origin, xDir, normal), keepColor: true });
  };

  const rng = seededRandom(7714);
  const CHL = { L: 1.35, W: 0.72, D: 0.34, bend: 0.13, rect: CELL_ATLAS.chloro, dome: 0x2e8b2e };
  // Pressed against the back walls by the vacuole, which is where a real cell's chloroplasts are.
  const wallAt = -inner + 0.02;
  const lay = (spots, onPlane) => {
    spots.forEach(([a, b], i) => {
      const t = rng() * Math.PI * 2;
      const { origin, xDir, normal } = onPlane(a, b, t);
      if (i % 3 === 2) addWhole(1.3, 0.7, 0.46, 0.1, 0x3cae38, origin, xDir, normal);
      else addCut({ ...CHL, seed: i }, origin, xDir, normal);
    });
  };
  // -X wall, seen past the vacuole's +Z side.
  lay([[1.6, 3.9], [2.9, 3.7], [1.1, 5.1], [2.3, 5.0], [3.05, 5.5], [1.45, 6.4], [2.7, 6.6], [1.1, 7.5], [2.2, 7.6], [3.05, 7.5]], (z, y, t) => ({
    origin: [wallAt, y, z], xDir: [0, Math.sin(t), Math.cos(t)], normal: [1, 0, 0],
  }));
  // -Z wall, seen past the vacuole's +X side.
  lay([[1.6, 3.9], [2.9, 3.7], [1.1, 5.1], [2.3, 5.0], [3.05, 5.5], [1.45, 6.4], [2.7, 6.6], [1.1, 7.5], [2.2, 7.6], [3.05, 7.5]], (x, y, t) => ({
    origin: [x, y, wallAt], xDir: [Math.cos(t), Math.sin(t), 0], normal: [0, 0, 1],
  }));
  // The ceiling, what shows of it.
  const ceil = CY + inner - 0.02;
  lay([[-2.6, 2.2], [-1.5, 3.0], [-0.6, 2.2], [2.2, -2.6], [3.0, -1.5], [2.2, -0.6]], (x, z, t) => ({
    origin: [x, ceil, z], xDir: [Math.cos(t), 0, Math.sin(t)], normal: [0, -1, 0],
  }));

  // Three big ones lying on the floor where a student can lean over them, with real grana standing
  // proud of the painted section: stacks of discs joined by lamellae.
  const hero = (cx, cz, yaw, tilt) => {
    const L = 2.05; const W = 1.1;
    // Tipped toward the open corner, so the section faces whoever is looking in.
    const normal = new THREE.Vector3(tilt, 1, tilt).normalize();
    const xDir = [Math.cos(yaw), 0, Math.sin(yaw)];
    const origin = [cx, bedAt(cx, cz) + 0.3, cz];
    addCut({ L, W, D: 0.5, bend: 0.2, rect: CELL_ATLAS.chloro, dome: 0x2e8b2e, seed: cx }, origin, xDir, normal.toArray());
    const tier = [[0, 0]];
    const LAYERS = 5; const TH = 0.042; const R = 0.135;
    for (let l = 0; l < LAYERS; l++) {
      const y0 = l * TH;
      tier.push([R, y0 + 0.002], [R, y0 + TH * 0.62], [R * 0.82, y0 + TH * 0.68], [R * 0.82, y0 + TH]);
    }
    tier.push([0, LAYERS * TH]);
    const stacks = [[-0.62, 0.12], [-0.3, -0.12], [-0.3, 0.34], [0.04, 0.08], [0.32, 0.36], [0.36, -0.1], [0.66, 0.14]];
    const DARK = lin(0x12501a); const LIGHT = lin(0x4bb33c);
    const toWorld = (g) => place(g, origin, xDir, normal.toArray());
    stacks.forEach(([sx, sz], k) => {
      const g = lathe(tier, 12).translate(sx, 0, sz);
      setPlainUv(g);
      tintVertices(g, (x, y, z, out) => {
        const band = Math.floor(y / TH) % 2;
        const c = band ? LIGHT : DARK;
        out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
      });
      parts.push({ geometry: toWorld(g), keepColor: true });
      if (k < stacks.length - 1) {
        const n = stacks[k + 1];
        const rod = tube([[sx, 0.03, sz], [(sx + n[0]) / 2, 0.05, (sz + n[1]) / 2], [n[0], 0.03, n[1]]], 0.024, { sides: 5, steps: 4, round: 1 });
        setPlainUv(rod);
        tintVertices(rod, (x, y, z, out) => { out[0] = LIGHT[0]; out[1] = LIGHT[1]; out[2] = LIGHT[2]; });
        parts.push({ geometry: toWorld(rod), keepColor: true });
      }
    });
  };
  hero(3.0, 0.95, 1.2, 0.34);
  hero(0.75, 2.95, 0.15, 0.34);

  // Mitochondria: smaller, orange-pink, cut open to show their folded cristae.
  const MIT = { L: 1.05, W: 0.46, D: 0.24, bend: 0.05, rect: CELL_ATLAS.mito, dome: 0xd9652e };
  for (const [x, z, yaw] of [[2.75, 3.05, 2.2], [1.9, 2.95, 0.1], [3.05, -0.5, 1.2], [1.2, -0.75, 0.3], [-0.85, 1.25, 1.6], [2.9, 2.2, 1.0]]) {
    const n = [0.28, 1, 0.28];
    addCut({ ...MIT, seed: x }, [x, bedAt(x, z) + 0.13, z], [Math.cos(yaw), 0, Math.sin(yaw)], n);
  }
  addCut({ ...MIT, seed: 3 }, [wallAt, 3.75, 3.2], [0, 0.4, 1], [1, 0, 0]);
  addCut({ ...MIT, seed: 4 }, [3.2, 3.75, wallAt], [1, 0.4, 0], [0, 0, 1]);

  // --- The nucleus: a sphere with a quarter opened toward the student --------------------------
  const NR = 1.08;
  const NC = [1.0, bedAt(1, 1) + 0.46, 1.0];
  {
    const sp = []; const su = []; const si = [];
    const NT = 26; const NP = 40;
    // phi runs from 90 degrees to 360: the removed wedge is local +X +Z, which is world +X +Z.
    for (let i = 0; i <= NT; i++) {
      const th = (i / NT) * Math.PI;
      for (let j = 0; j <= NP; j++) {
        const ph = Math.PI / 2 + (j / NP) * (Math.PI * 1.5);
        sp.push(NC[0] + NR * Math.sin(th) * Math.sin(ph), NC[1] + NR * Math.cos(th), NC[2] + NR * Math.sin(th) * Math.cos(ph));
        const uv = atlasUv(CELL_ATLAS.pores, (j / NP), 1 - i / NT);
        su.push(uv[0], uv[1]);
      }
    }
    const row = NP + 1;
    for (let i = 0; i < NT; i++) {
      for (let j = 0; j < NP; j++) {
        const a = i * row + j; const b = a + 1; const c = a + row + 1; const d = a + row;
        si.push(a, b, c, a, c, d);
      }
    }
    const shell = new THREE.BufferGeometry();
    shell.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    shell.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
    shell.setIndex(si);
    shell.computeVertexNormals();
    parts.push({ geometry: outward(shell), color: 0xffffff });
    // The two flat faces: half discs on the planes the wedge was cut along.
    const disc = (nx, nz) => {
      const dp = []; const du = []; const di = [];
      const RINGS = 7; const SEG = 20;
      dp.push(NC[0], NC[1], NC[2]);
      const c0 = atlasUv(CELL_ATLAS.nucleus, 0.5, 0.5);
      du.push(c0[0], c0[1]);
      for (let k = 1; k <= RINGS; k++) {
        const f = k / RINGS;
        for (let s = 0; s <= SEG; s++) {
          const a = (s / SEG) * Math.PI;
          const w = Math.sin(a) * f; const v = Math.cos(a) * f;
          dp.push(NC[0] + (nx ? 0 : w * NR), NC[1] + v * NR, NC[2] + (nz ? 0 : w * NR));
          const uv = atlasUv(CELL_ATLAS.nucleus, 0.5 + w / 2, 0.5 + v / 2);
          du.push(uv[0], uv[1]);
        }
      }
      const at = (k, s) => 1 + (k - 1) * (SEG + 1) + s;
      const want = new THREE.Vector3(nx, 0, nz);
      const tri = (a, b, c) => {
        const A = new THREE.Vector3(dp[a * 3], dp[a * 3 + 1], dp[a * 3 + 2]);
        const f = new THREE.Vector3(dp[b * 3], dp[b * 3 + 1], dp[b * 3 + 2]).sub(A).cross(new THREE.Vector3(dp[c * 3], dp[c * 3 + 1], dp[c * 3 + 2]).sub(A));
        if (f.dot(want) >= 0) di.push(a, b, c); else di.push(a, c, b);
      };
      for (let s = 0; s < SEG; s++) {
        tri(0, at(1, s), at(1, s + 1));
        for (let k = 1; k < RINGS; k++) { tri(at(k, s), at(k + 1, s), at(k + 1, s + 1)); tri(at(k, s), at(k + 1, s + 1), at(k, s + 1)); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(du, 2));
      g.setIndex(di);
      g.computeVertexNormals();
      parts.push({ geometry: g, color: 0xffffff });
    };
    disc(1, 0);
    disc(0, 1);
    // The nucleolus, a dark ball standing in the opened corner.
    const nucleolus = setPlainUv(new THREE.SphereGeometry(0.36, 20, 14));
    parts.push({ geometry: nucleolus, color: 0x3d1670, position: [NC[0] + 0.03, NC[1] + 0.06, NC[2] + 0.03] });
  }

  // --- Rough ER: folded ribbons wrapping the nucleus, studded with ribosomes -------------------
  const ER = 0xee6f9c;
  const erRng = seededRandom(7715);
  const ribbon = (r0, a0, a1, y0, height, folds) => {
    const g = solidSurface({
      nu: 64, nv: 3,
      point: (u, v) => {
        const a = mix(a0, a1, u);
        const fold = Math.sin(u * folds * Math.PI * 2);
        const rr = r0 + 0.17 * fold + 0.05 * Math.sin(v * 3 + u * 9);
        const x = NC[0] + Math.sin(a) * rr; const z = NC[2] + Math.cos(a) * rr;
        return [x, y0 + v * height * (0.8 + 0.2 * Math.sin(u * 11)), z];
      },
      thick: () => 0.026,
    });
    setPlainUv(g);
    parts.push({ geometry: outward(g), color: ER });
    for (let i = 0; i < 46; i++) {
      const u = erRng(); const v = erRng();
      const a = mix(a0, a1, u);
      const fold = Math.sin(u * folds * Math.PI * 2);
      const rr = r0 + 0.17 * fold + 0.05 * Math.sin(v * 3 + u * 9) + (erRng() > 0.5 ? 0.03 : -0.03);
      const dot = setPlainUv(new THREE.OctahedronGeometry(0.03, 0));
      parts.push({ geometry: dot, color: 0x8a2452, position: [NC[0] + Math.sin(a) * rr, y0 + v * height * (0.8 + 0.2 * Math.sin(u * 11)), NC[2] + Math.cos(a) * rr] });
    }
  };
  // Bearing 0 is +Z and pi/2 is +X, so these run down the two flanks a student can see.
  ribbon(NR + 0.16, 1.62, 3.0, FLOOR_Y - 0.1, 1.1, 7);
  ribbon(NR + 0.16, 4.85, 6.2, FLOOR_Y - 0.1, 1.1, 7);
  ribbon(NR + 0.55, 1.75, 2.9, FLOOR_Y - 0.1, 0.56, 6);
  ribbon(NR + 0.55, 4.95, 6.1, FLOOR_Y - 0.1, 0.56, 6);

  // --- A Golgi stack: curved flat sacs, which a cell needs and a student may ask about -----------
  {
    const gc = [3.0, FLOOR_Y + 0.03, -1.0];
    for (let k = 0; k < 5; k++) {
      const yy = gc[1] + k * 0.1;
      const span = 0.82 - Math.abs(k - 2) * 0.06;
      const g = solidSurface({
        nu: 20, nv: 5,
        point: (u, v) => {
          const a = (u - 0.5) * 1.5;
          const rr = 1.05 + (v - 0.5) * 0.52;
          return [gc[0] + Math.sin(a) * rr - 0.8, yy + 0.16 * Math.cos(a * 2) + (v - 0.5) * 0.04, gc[2] + Math.cos(a) * rr * span];
        },
        thick: (u, v) => 0.038 * Math.min(1, Math.sin(u * Math.PI) * 3) * Math.min(1, Math.sin(v * Math.PI) * 3) + 0.004,
      });
      setPlainUv(g);
      parts.push({ geometry: outward(g), color: k % 2 ? 0xf0b43c : 0xe69a24 });
    }
  }

  // --- The vacuole -----------------------------------------------------------------------------
  // Most of the cell's volume, and the thing an animal cell does not have. Opaque on purpose: this
  // project has learned several times that a see-through surface loses its colour.
  const vac = new THREE.SphereGeometry(1, 72, 52);
  {
    const p = vac.attributes.position;
    const VC = [-1.62, 5.5, -1.62]; const VR = [1.92, 2.62, 1.92];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
      // Pressed square by the walls it fills: a superellipsoid, with a slow wobble so it is a sac.
      const e = 0.8;
      const q = (Math.abs(x) ** (2 / e) + Math.abs(y) ** (2 / e) + Math.abs(z) ** (2 / e)) ** (e / 2);
      const wob = 1 + 0.035 * Math.sin(x * 3.1 + y * 2) * Math.sin(z * 2.7 + 1) + 0.016 * Math.sin(y * 7 + x * 5);
      const k = (1 / q) * wob;
      p.setXYZ(i, VC[0] + x * k * VR[0], VC[1] + y * k * VR[1], VC[2] + z * k * VR[2]);
    }
    vac.computeVertexNormals();
    // The sphere's seam column is duplicated: weld its normals, or a line runs down the sac.
    const n = vac.attributes.normal;
    for (let j = 0; j <= 52; j++) {
      const a = j * 73; const b = a + 72;
      const nx = n.getX(a) + n.getX(b); const ny = n.getY(a) + n.getY(b); const nz = n.getZ(a) + n.getZ(b);
      const l = Math.hypot(nx, ny, nz) || 1;
      n.setXYZ(a, nx / l, ny / l, nz / l); n.setXYZ(b, nx / l, ny / l, nz / l);
    }
    const LOW = lin(0x3f8fd0); const HIGH = lin(0x9fd9f4);
    tintVertices(vac, (x, y, z, out) => {
      const t = sstep(y, 3.2, 7.4);
      const swirl = 0.06 * Math.sin(x * 2.6 + y * 1.9 + z * 2.2);
      out[0] = mix(LOW[0], HIGH[0], t) + swirl * 0.4;
      out[1] = mix(LOW[1], HIGH[1], t) + swirl * 0.6;
      out[2] = mix(LOW[2], HIGH[2], t) + swirl * 0.5;
    });
  }

  // --- A low base -------------------------------------------------------------------------------
  const base = mergeParts([
    { geometry: new THREE.BoxGeometry(9.0, 0.3, 9.0).translate(0, 0.15, 0), color: 0x3a3f46 },
    { geometry: new THREE.BoxGeometry(8.6, 0.25, 8.6).translate(0, 0.42, 0), color: 0x4c5259 },
  ]);

  const root = new THREE.Group();
  root.name = 'plant-cell';
  root.add(mesh(mergeParts([{ geometry: wall, keepColor: true }]), standard({ vertexColors: true, map: fibres, bumpMap: fibres, bumpScale: 0.5, roughness: 0.62, metalness: 0 })));
  root.add(mesh(mergeParts([{ geometry: membrane, keepColor: true }, { geometry: bed, color: bedColor }]), standard({ vertexColors: true, map: speckle, roughness: 0.55, metalness: 0 })));
  root.add(mesh(mergeParts(parts), standard({ vertexColors: true, map: cellAtlas(), roughness: 0.42, metalness: 0 })));
  root.add(mesh(vac, standard({ vertexColors: true, roughness: 0.16, metalness: 0 })));
  root.add(mesh(base, standard({ vertexColors: true, roughness: 0.8, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Flower anatomy
// ---------------------------------------------------------------------------------------------

// A lily, about twelve times life size, with its front opened like a teaching model. A true lily's
// outer three "petals" ARE its sepals, so that is how this is built: an outer whorl below the inner
// one, narrower, flushed green from the base. The whorl facing +Z is cut back to short stubs.
//
// THE VEINS ARE LINES OF CONSTANT u. The painting's u runs across the tepal's own width, so a straight
// vertical line on the canvas follows the outline from the base to the tip by construction. That is
// why a painted canvas is the right tool here and a tint is not: a vein is under one mesh row wide.
function petalPainting() {
  return canvasTexture(1024, 1024, (ctx, W, H) => {
    const img = ctx.createImageData(W, H);
    const d = img.data;
    const CORE = [214, 42, 112]; const MARGIN = [244, 168, 200]; const THROAT = [214, 214, 96];
    const VEIN = [150, 20, 76]; const GREEN = [106, 160, 66]; const SEPAL_TIP = [226, 104, 150];
    const out = [0, 0, 0];
    for (let py = 0; py < H; py++) {
      const v = 1 - (py + 0.5) / H;
      for (let px = 0; px < W; px++) {
        const half = px < W / 2;
        const s = half ? (px + 0.5) / (W / 2) : (px + 0.5 - W / 2) / (W / 2);
        const U = s * 2 - 1;
        const core = Math.exp(-((U / 0.6) ** 2));
        if (half) {
          for (let i = 0; i < 3; i++) out[i] = mix(MARGIN[i], CORE[i], core * mix(0.95, 0.62, sstep(v, 0.55, 1)));
          const t = 1 - sstep(v, 0.07, 0.25);
          for (let i = 0; i < 3; i++) out[i] = mix(out[i], THROAT[i], t * (0.55 + 0.45 * core));
        } else {
          const t = sstep(v + 0.1 * Math.abs(U), 0.36, 0.84);
          for (let i = 0; i < 3; i++) out[i] = mix(GREEN[i], mix(SEPAL_TIP[i], MARGIN[i], Math.abs(U) * 0.7), t);
        }
        // Long parallel veins, which wander a little and fade toward the margin and the tip.
        const wob = U + 0.012 * Math.sin(v * 21 + U * 5);
        const line = Math.abs(Math.sin(wob * Math.PI * 8.5));
        const vein = (1 - sstep(line, 0, 0.16)) * (1 - 0.5 * Math.abs(U)) * (1 - 0.5 * sstep(v, 0.6, 1));
        const rib = Math.exp(-((U / 0.035) ** 2));
        const tone = half ? VEIN : [66, 116, 44];
        for (let i = 0; i < 3; i++) {
          out[i] = mix(out[i], tone[i], vein * 0.42);
          out[i] = mix(out[i], tone[i], rib * 0.6);
        }
        const at = (py * W + px) * 4;
        d[at] = out[0]; d[at + 1] = out[1]; d[at + 2] = out[2]; d[at + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // The freckles a lily carries down the middle of each petal, in the throat half.
    const rng = seededRandom(9021);
    for (let i = 0; i < 170; i++) {
      const U = (rng() + rng() - 1) * 0.72;
      const v = 0.14 + rng() * 0.46;
      const x = ((U + 1) / 2) * (W / 2); const y = (1 - v) * H;
      const r = 2 + rng() * 5.5;
      ctx.fillStyle = 'rgb(92,10,50)';
      ctx.beginPath(); ctx.ellipse(x, y, r * 0.8, r * 1.5, 0, 0, Math.PI * 2); ctx.fill();
    }
  });
}

function flowerAnatomy() {
  const TOP = 4.42;     // the receptacle, where everything in the flower is attached

  // A tepal: a centre line in the plane of its bearing, with width, cup, midrib and frill laid across.
  const tepal = ({ A, points, W, region, vcut = 1, seed = 0, nu = 18, nv = 30 }) => {
    const curve = new THREE.CatmullRomCurve3(points.map(([r, y]) => new THREE.Vector3(r, y, 0)), false, 'catmullrom', 0.5);
    const dx = Math.sin(A); const dz = Math.cos(A);
    const ex = Math.cos(A); const ez = -Math.sin(A);
    const width = (v) => W * Math.max(0.04, Math.sin(Math.PI * v ** 0.72) ** 0.62) * mix(0.42, 1, sstep(v, 0, 0.2));
    const g = solidSurface({
      nu, nv,
      point: (ui, vi) => {
        const v = vi * vcut;
        const U = ui * 2 - 1;
        const c = curve.getPoint(v);
        const tan = curve.getTangent(v);
        const nr = -tan.y; const ny = tan.x; // the upper, inner face's normal, in (radius, height)
        const w = width(v) / 2;
        const cup = 0.2 * w * (1 - U * U) * mix(1, 0.3, v);
        const groove = 0.055 * Math.exp(-((U / 0.09) ** 2)) * mix(1, 0.3, v);
        const frill = 0.075 * (U ** 4) * Math.sin(v * 19 + seed + U * 2) * sstep(v, 0.2, 0.5);
        const off = -cup - groove + frill;
        const rr = c.x + nr * off; const yy = c.y + ny * off;
        return [dx * rr + ex * U * w, yy, dz * rr + ez * U * w];
      },
      thick: (ui, vi) => 0.034 * mix(1, 0.42, Math.abs(ui * 2 - 1) ** 3) * mix(1, 0.5, vi * vcut),
    });
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, mix(region[0], region[1], uv.getX(i)), uv.getY(i) * vcut);
    return g;
  };
  const PETAL = [0.004, 0.496]; const SEPAL = [0.504, 0.996];
  const petalLine = (top) => [[0.26, TOP + 0.05], [0.5, TOP + 0.75], [0.95, TOP + 1.65], [1.55, TOP + 2.45], [2.25, top + 0.02], [2.85, top + 0.12], [3.12, top - 0.28]];
  const sepalLine = (top) => [[0.3, TOP - 0.02], [0.62, TOP + 0.62], [1.14, TOP + 1.42], [1.82, TOP + 2.08], [2.5, top], [3.0, top - 0.1], [3.2, top - 0.5]];
  const petals = [];
  // The back half stands whole. The upright back petal is what brings the whole model to 8ft.
  petals.push(tepal({ A: Math.PI, W: 1.72, region: PETAL, seed: 1, points: [[0.26, TOP + 0.05], [0.44, TOP + 0.85], [0.7, TOP + 1.75], [1.06, TOP + 2.5], [1.44, 7.56], [1.72, 7.98], [1.84, 8.12]] }));
  petals.push(tepal({ A: Math.PI * (2 / 3), W: 1.2, region: SEPAL, seed: 2, points: sepalLine(6.86) }));
  petals.push(tepal({ A: -Math.PI * (2 / 3), W: 1.2, region: SEPAL, seed: 3, points: sepalLine(6.86) }));
  // The two front petals are cut across, so their section shows and the flower reads as opened.
  // They are swung well out to the sides on a flatter line, like doors opened on the ovary.
  const openLine = [[0.34, TOP + 0.04], [0.82, TOP + 0.42], [1.42, TOP + 0.96], [2.02, TOP + 1.56], [2.6, TOP + 2.1], [3.0, TOP + 2.3], [3.2, TOP + 2.1]];
  petals.push(tepal({ A: 1.32, W: 1.72, region: PETAL, seed: 4, points: openLine, vcut: 0.44, nv: 12 }));
  petals.push(tepal({ A: -1.32, W: 1.72, region: PETAL, seed: 5, points: openLine, vcut: 0.44, nv: 12 }));
  // The front sepal is a stub, so it can never stand in front of the ovary.
  petals.push(tepal({ A: 0, W: 1.2, region: SEPAL, seed: 6, points: [[0.42, TOP - 0.02], [0.72, TOP + 0.02], [1.2, TOP + 0.02], [1.8, TOP - 0.1], [2.4, TOP - 0.3]], vcut: 0.34, nv: 6 }));

  // --- Everything green, and the working parts ------------------------------------------------
  const parts = [];
  const stemPts = [[0, 0.2, 0], [0.04, 1.5, 0.02], [0.02, 3.0, -0.02], [0, 4.0, 0], [0, TOP - 0.08, 0]];
  parts.push({ geometry: tube(stemPts, [0.2, 0.17, 0.15, 0.15, 0.17], { sides: 16, steps: 24, round: 1 }), color: 0x4f8e36 });
  // The receptacle: the stem's top flaring to take the whorls.
  parts.push({ geometry: lathe([[0, TOP - 0.86], [0.145, TOP - 0.86], [0.152, TOP - 0.6], [0.18, TOP - 0.34], [0.26, TOP - 0.14], [0.36, TOP - 0.02], [0.47, TOP + 0.08], [0.46, TOP + 0.18], [0.3, TOP + 0.26], [0, TOP + 0.28]], 28), color: 0x6aa345 });

  // Long narrow leaves up the stem, each a thick blade with a groove down its middle.
  const leaf = (y, A, L, W, droop) => {
    const dx = Math.sin(A); const dz = Math.cos(A);
    const ex = Math.cos(A); const ez = -Math.sin(A);
    const g = solidSurface({
      nu: 6, nv: 16,
      point: (u, v) => {
        const U = u * 2 - 1;
        const w = (W / 2) * Math.max(0.03, Math.sin(Math.PI * v ** 0.66) ** 0.8);
        const rr = 0.1 + L * v;
        const yy = y + L * 0.72 * v - droop * L * v * v - 0.04 * (1 - U * U) * (w / W);
        return [dx * rr + ex * U * w, yy, dz * rr + ez * U * w];
      },
      thick: (u, v) => 0.028 * (1 - 0.6 * Math.abs(u * 2 - 1)) * (1 - 0.5 * v),
    });
    tintVertices(g, (x, yy, z, out) => {
      const across = Math.abs((x * ex + z * ez)) / ((W / 2) + 1e-3);
      const k = 0.78 + 0.34 * sstep(across, 0, 0.5);
      out[0] = 0.13 * k; out[1] = 0.34 * k; out[2] = 0.075 * k;
    });
    parts.push({ geometry: g, keepColor: true });
  };
  leaf(1.1, 0.6, 2.3, 0.46, 0.92);
  leaf(1.55, 2.8, 2.2, 0.44, 0.92);
  leaf(2.05, 4.9, 2.1, 0.42, 0.88);
  leaf(2.55, 1.6, 1.8, 0.38, 0.84);
  leaf(3.0, 3.8, 1.6, 0.34, 0.8);
  leaf(3.42, 5.8, 1.3, 0.3, 0.74);

  // The ovary, opened on its +Z side: a wall, a central axis, and two chambers with their ovules.
  const OY = TOP + 0.84; const OH = 0.72; const OR = 0.47;
  const OUT = lin(0x79ad4a); const CUTC = lin(0xd8e8a0); const CHAMBER = lin(0x5f7f38);
  const ov = new Sculpt(0.032);
  ov.add(ellipsoidP([0, OY, 0], [OR * 0.82, OH, OR * 0.82]), OUT);
  for (const a of [Math.PI / 3, Math.PI, -Math.PI / 3]) ov.add(ellipsoidP([Math.sin(a) * 0.15, OY, Math.cos(a) * 0.15], [OR * 0.62, OH * 0.96, OR * 0.62]), OUT, { k: 0.06 });
  ov.add(curveP([[0, OY + OH - 0.2, 0], [0, OY + OH + 0.14, 0.01]], [0.15, 0.075], 6), OUT, { k: 0.14 });
  ov.add(curveP([[0, OY - OH + 0.15, 0], [0, OY - OH - 0.12, 0]], [0.2, 0.28], 6), OUT, { k: 0.1 });
  // The cut: everything forward of a plane, painted as cut tissue.
  const FACE = 0.1;
  ov.sub(boxP([0, OY, FACE + 1], [1.2, 1.4, 1]), CUTC);
  // Two chambers carved back into the cut, either side of the central axis.
  for (const side of [1, -1]) ov.sub(ellipsoidP([side * 0.255, OY + 0.01, FACE + 0.02], [0.17, OH * 0.72, 0.2]), CHAMBER, { k: 0.015, ck: 0.018 });
  parts.push({ geometry: polygonize(ov, { uvScale: 2, extraReach: 0.02 }), keepColor: true });
  // Ovules: two rows in each chamber, on the side toward the axis, which is where a lily carries them.
  const OVULE = 0xe6d48c;
  for (const side of [1, -1]) {
    for (const [ox, oz] of [[0.14, FACE + 0.015], [0.31, FACE - 0.03]]) {
      const n = 9;
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        const span = OH * 0.56 * Math.sqrt(1 - (ox > 0.2 ? 0.1 : 0));
        const y = OY + mix(-span, span, f);
        const g = new THREE.SphereGeometry(0.056, 9, 7).scale(1, 1.2, 0.92);
        parts.push({ geometry: g, color: OVULE, position: [side * ox + (i % 2) * 0.012 * side, y, oz] });
      }
    }
  }

  // The style and the stigma, which the pollen has to reach.
  const stigmaAt = [0.04, 7.52, 0.2];
  const stylePts = [[0, OY + OH + 0.02, 0.01], [0.01, 6.35, 0.05], [0.03, 7.05, 0.14], stigmaAt];
  parts.push({ geometry: tube(stylePts, [0.075, 0.056, 0.05, 0.056], { sides: 10, steps: 20, round: 1 }), color: 0xb5cf72 });
  const st = new Sculpt(0.017);
  const STIG = lin(0xa81f62);
  st.add(sphereP(stigmaAt, 0.075), lin(0x9dbb5e));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4;
    st.add(ellipsoidP([stigmaAt[0] + Math.sin(a) * 0.1, stigmaAt[1] + 0.07, stigmaAt[2] + Math.cos(a) * 0.1], [0.115, 0.08, 0.115]), STIG, { k: 0.05, ck: 0.03 });
  }
  st.map((d, x, y, z) => d + 0.004 * Math.sin(x * 62) * Math.sin(y * 57) * Math.sin(z * 66), [-2, 7, -2, 2, 8.4, 2]);
  parts.push({ geometry: polygonize(st, { uvScale: 2 }), keepColor: true });

  // --- The six stamens --------------------------------------------------------------------------
  const pollen = seededRandom(9022);
  const POLLEN = [0xf29a1c, 0xe67e12, 0xffb52e];
  const grain = (p, r = 0.017) => {
    parts.push({ geometry: new THREE.OctahedronGeometry(r, 1), color: POLLEN[Math.floor(pollen() * 3)], position: p });
  };
  // Six, as a lily has, but spread away from the front so none stands across the opened ovary.
  const STAMEN_AT = [0.98, 1.72, 2.62, -2.62, -1.72, -0.98];
  for (let k = 0; k < 6; k++) {
    const a = STAMEN_AT[k];
    const dx = Math.sin(a); const dz = Math.cos(a);
    const reach = 0.92 + 0.08 * (k % 2);
    const tipY = 7.0 + 0.1 * (k % 2);
    const tip = [dx * reach, tipY, dz * reach];
    const pts = [[dx * 0.34, TOP + 0.1, dz * 0.34], [dx * 0.52, TOP + 0.95, dz * 0.52], [dx * 0.64, 6.1, dz * 0.64], [dx * 0.84, 6.72, dz * 0.84], tip];
    parts.push({ geometry: tube(pts, [0.05, 0.04, 0.034, 0.03, 0.026], { sides: 8, steps: 18, round: 1 }), color: 0xcfdc8e });
    // The anther pivots at the filament's tip and lies across it, as a lily's does: two long
    // pollen sacs side by side, slit down their length and shedding.
    const tang = new THREE.Vector3(Math.cos(a + 0.3), 0.26 * (k % 2 ? 1 : -1), -Math.sin(a + 0.3)).normalize();
    const side = new THREE.Vector3(dx, 0.1, dz).normalize();
    const LEN = 0.52;
    for (const s of [1, -1]) {
      const off = side.clone().multiplyScalar(s * 0.058);
      const A = [tip[0] + off.x - tang.x * LEN, tip[1] + off.y - tang.y * LEN + 0.02, tip[2] + off.z - tang.z * LEN];
      const M = [tip[0] + off.x, tip[1] + off.y + 0.02, tip[2] + off.z];
      const B = [tip[0] + off.x + tang.x * LEN, tip[1] + off.y + tang.y * LEN + 0.02, tip[2] + off.z + tang.z * LEN];
      const g = tube([A, M, B], [0.05, 0.068, 0.05], { sides: 10, steps: 10, round: 2 });
      tintVertices(g, (x, y, z, out) => {
        const n = smoothNoise3(x * 16, y * 16, z * 16);
        const c = n > 0.5 ? 0.72 : 0.42;
        out[0] = c; out[1] = c * 0.32; out[2] = c * 0.05;
      });
      parts.push({ geometry: g, keepColor: true });
      // The dust is real: grains of it, thick along the slit.
      for (let i = 0; i < 26; i++) {
        const t = (pollen() * 2 - 1) * LEN * 1.02;
        const ang = pollen() * Math.PI * 2;
        const rr = 0.068 * Math.sqrt(1 - (t / (LEN * 1.25)) ** 2) * 1.02;
        const up = new THREE.Vector3().crossVectors(tang, side).normalize();
        grain([
          M[0] + tang.x * t + side.x * Math.cos(ang) * rr + up.x * Math.sin(ang) * rr,
          M[1] + tang.y * t + side.y * Math.cos(ang) * rr + up.y * Math.sin(ang) * rr,
          M[2] + tang.z * t + side.z * Math.cos(ang) * rr + up.z * Math.sin(ang) * rr,
        ]);
      }
    }
  }
  // A few grains caught on the stigma: this is what pollination is.
  for (let i = 0; i < 12; i++) {
    const a = pollen() * Math.PI * 2; const r = 0.05 + pollen() * 0.12;
    grain([stigmaAt[0] + Math.sin(a) * r, stigmaAt[1] + 0.13 + (0.13 - r) * 0.3, stigmaAt[2] + Math.cos(a) * r], 0.02);
  }

  // --- The base: a mound of soil on a turned stand ---------------------------------------------
  const stand = lathe([[0, 0], [1.75, 0], [1.75, 0.14], [1.68, 0.2], [1.56, 0.26], [1.5, 0.34], [0, 0.34]], 56);
  const soil = lathe([[0, 0.3], [1.42, 0.3], [1.34, 0.37], [1.02, 0.46], [0.62, 0.53], [0.28, 0.56], [0, 0.57]], 48);
  tintVertices(soil, (x, y, z, out) => {
    const k = 0.75 + 0.5 * smoothNoise3(x * 5, y * 5, z * 5);
    out[0] = 0.07 * k; out[1] = 0.045 * k; out[2] = 0.028 * k;
  });
  parts.push({ geometry: stand, color: 0x5b3a24 });
  parts.push({ geometry: soil, keepColor: true });

  const map = petalPainting();
  const root = new THREE.Group();
  root.name = 'flower-anatomy';
  root.add(mesh(mergeParts(petals.map((geometry) => ({ geometry, color: 0xffffff }))), standard({ map, bumpMap: map, bumpScale: 0.35, roughness: 0.5, metalness: 0 })));
  root.add(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.46, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Shared by the coated animals
// ---------------------------------------------------------------------------------------------

// One overlapping lock of hair: a closed, arched, pointed solid. The thickness goes to nothing all
// round its edge, so it needs no rim, and its u and v run across and along it for the strand map.
function lockGeo(root, dir, normal, L, W, { nv = 4, lift = 0.22, droop = 0.14, th = 0.03, wave = 0 } = {}) {
  const side = new THREE.Vector3().crossVectors(normal, dir).normalize();
  return solidSurface({
    nu: 2, nv,
    point: (u, v) => {
      const U = u * 2 - 1;
      const w = (W / 2) * Math.max(0.03, (0.62 + 0.38 * sstep(v, 0, 0.36)) * (1 - v ** 2.3));
      const arch = (1 - U * U) * w * 0.34;
      const a = L * v;
      const n = L * (lift * v - lift * 0.72 * v * v) + arch;
      const s = U * w + wave * L * Math.sin(v * 3.1) * v;
      return [
        root[0] + dir.x * a + normal.x * n + side.x * s,
        root[1] + dir.y * a + normal.y * n + side.y * s - droop * L * v * v,
        root[2] + dir.z * a + normal.z * n + side.z * s,
      ];
    },
    thick: (u, v) => th * Math.max(0, 1 - (u * 2 - 1) ** 2) * Math.sin(Math.PI * clamp01(v)),
  });
}

// Long hairs running with v, for a lock: near white, so the lock's own colour carries the hue.
function strandMap(seed) {
  const texture = canvasTexture(256, 256, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#ececec';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = rng() * w;
      const light = rng() > 0.55;
      ctx.strokeStyle = light ? `rgba(255,255,255,${0.35 + rng() * 0.5})` : `rgba(150,150,150,${0.35 + rng() * 0.55})`;
      ctx.lineWidth = 0.8 + rng() * 2;
      const bow = (rng() - 0.5) * 14;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x + bow, h / 2, x, h);
      ctx.stroke();
    }
  });
  return texture;
}

// ---------------------------------------------------------------------------------------------
// Woolly mammoth
// ---------------------------------------------------------------------------------------------

// True size, with the catalogue's 0.6 applied by the record. What makes this a mammoth and not an
// elephant in a coat, in the order the eye takes it: the HIGH DOME OF THE HEAD with a dip behind it,
// a SHOULDER HUMP from which the back falls away steeply to a low rump, tusks that cross in front
// rather than running straight, small ears, and a coat long enough to hang as a skirt.
//
// The body under the hair is coarse, on purpose: nobody can see it. The triangles are in the locks,
// and what they buy is a silhouette a smooth brown balloon can never have.
function woollyMammoth() {
  const rng = seededRandom(1212);
  const HIDE = lin(0x24120a);

  // --- The body: one lofted trunk with the legs growing out of it ------------------------------
  const body = new Sculpt(0.38);
  const torso = axisLoft([
    [-7.25, 6.8, 0.15, 0.15, 0.15],
    [-6.85, 6.9, 1.2, 1.05, 1.4],
    [-5.6, 6.7, 2.25, 1.75, 1.85],
    [-3, 6.8, 2.75, 2.45, 2.4],
    [-1, 7.0, 2.85, 3.0, 2.9],
    [1.4, 7.6, 2.7, 3.4, 3.3],
    [3.2, 8.0, 2.05, 2.42, 2.5],
    [4.6, 8.7, 1.5, 1.62, 2.0],
    [5.2, 8.9, 0.9, 1.0, 1.2],
  ]);
  body.add(torso, HIDE);
  for (const side of [1, -1]) {
    body.add(curveP([[side * 1.85, 7.4, 2.5], [side * 1.98, 4.6, 2.55], [side * 1.86, 2.0, 2.75], [side * 1.85, 0.9, 2.75]], [1.32, 0.96, 0.72, 0.74], 12), HIDE, { k: 1.1 });
    body.add(curveP([[side * 1.7, 7.0, -4.3], [side * 1.98, 4.2, -3.55], [side * 1.86, 2.0, -3.95], [side * 1.85, 0.9, -3.8]], [1.5, 1.0, 0.68, 0.72], 12), HIDE, { k: 1.1 });
  }
  body.add(curveP([[0, 7.5, -6.8], [0, 6.5, -7.35], [0, 5.45, -7.5]], [0.34, 0.2, 0.12], 8), HIDE, { k: 0.3 });
  const bodyGeo = polygonize(body, { uvScale: 1.2, extraReach: 0.1 });

  // --- The head ---------------------------------------------------------------------------------
  const head = new Sculpt(0.14);
  const SKIN = lin(0x513828);
  // The neck stub, so the head grows out of the shoulders rather than sitting on them.
  head.add(ellipsoidP([0, 9.2, 4.1], [1.55, 1.75, 1.5]), HIDE);
  // The dome: far higher than an elephant's, with a single peak.
  head.add(ellipsoidP([0, 10.0, 5.05], [1.42, 1.88, 1.42], [0.16, 0, 0]), HIDE, { k: 0.6 });
  // The face falling from the dome to the trunk's root.
  head.add(ellipsoidP([0, 8.85, 5.95], [1.22, 1.62, 0.98], [-0.2, 0, 0]), SKIN, { k: 0.5, ck: 0.3 });
  // The lower jaw and a small pointed lip below the trunk.
  head.add(ellipsoidP([0, 7.05, 5.6], [0.92, 0.7, 0.92]), SKIN, { k: 0.4 });
  head.add(ellipsoidP([0, 6.75, 6.28], [0.34, 0.3, 0.42], [0.5, 0, 0]), lin(0x4b3224), { k: 0.2 });
  for (const side of [1, -1]) {
    // The great bony sleeves the tusks come out of, which widen the face like a pair of cheeks.
    head.add(curveP([[side * 0.68, 8.9, 5.5], [side * 0.86, 8.0, 6.28], [side * 0.98, 7.2, 6.78]], [0.66, 0.62, 0.57], 8), SKIN, { k: 0.34 });
    // Small ears, set back, and thick: a big ear loses heat.
    head.add(ellipsoidP([side * 1.6, 10.15, 3.92], [0.2, 0.72, 0.54], [0.2, 0, side * -0.32]), SKIN, { k: 0.2 });
  }
  const headField = head.snapshot();
  // The eye: small, far forward, in a heavy socket.
  const EYE = [1, -1].map((side) => {
    const p = onSurface(headField, [side * 1.5, 9.5, 5.62]);
    const n = fieldNormal(headField, p);
    head.add(torusP(p, n, 0.2, 0.075), SKIN, { k: 0.08 });
    head.sub(sphereP([p[0], p[1], p[2]], 0.17), lin(0x120a06), { k: 0.03 });
    return { p, n };
  });
  const headGeo = polygonize(head, { uvScale: 1.2, extraReach: 0.05 });

  // --- The trunk: real rings, cut in along an analytic tube -------------------------------------
  const trunkCurve = new THREE.CatmullRomCurve3([
    [0, 8.65, 6.1], [0, 7.75, 6.92], [0, 6.05, 7.32], [0, 4.2, 7.22], [0, 2.75, 7.28], [0, 1.9, 7.85], [0, 1.72, 8.55],
  ].map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.5);
  const TL = trunkCurve.getLength();
  const RING = 0.27;
  const STEPS = 190;
  const trunkR0 = [0.8, 0.74, 0.58, 0.44, 0.33, 0.25, 0.21];
  const baseR = (t) => {
    const f = t * (trunkR0.length - 1); const i = Math.min(trunkR0.length - 2, Math.floor(f));
    return mix(trunkR0[i], trunkR0[i + 1], f - i);
  };
  const trunkPts = [];
  for (let i = 0; i <= 44; i++) { const p = trunkCurve.getPointAt(i / 44); trunkPts.push([p.x, p.y, p.z]); }
  const ringGroove = (t) => Math.abs(Math.cos((t * TL * Math.PI) / RING)) ** 7;
  const radii = [];
  for (let i = 0; i <= STEPS * 2; i++) {
    const t = i / (STEPS * 2);
    radii.push(baseR(t) * (1 - 0.055 * ringGroove(t)));
  }
  const SIDES = 10;
  const trunkGeo = tube(trunkPts, radii, { sides: SIDES, steps: STEPS, round: 2 });
  {
    const T = lin(0x4f3322); const TL2 = lin(0x745240); const G = lin(0x25150c);
    tintVertices(trunkGeo, (x, y, z, out, i) => {
      const row = Math.max(0, Math.floor(i / SIDES) - 2);
      const t = clamp01(row / STEPS);
      const groove = ringGroove(t);
      const front = clamp01(z - 6.5) * 0.3 + 0.2 * smoothNoise3(x * 2, y * 2, z * 2);
      out[0] = mix(mix(T[0], TL2[0], front), G[0], groove);
      out[1] = mix(mix(T[1], TL2[1], front), G[1], groove);
      out[2] = mix(mix(T[2], TL2[2], front), G[2], groove);
    });
  }
  // The tip: the two "fingers" frozen mammoths show, a broad upper one and a short lower one.
  const tipAt = trunkCurve.getPointAt(1);
  const fingerUp = tube([[0, tipAt.y, tipAt.z - 0.1], [0, tipAt.y + 0.1, tipAt.z + 0.2], [0, tipAt.y + 0.24, tipAt.z + 0.42]], [0.2, 0.16, 0.06], { sides: 9, steps: 7, round: 2 });
  const fingerLo = tube([[0, tipAt.y - 0.03, tipAt.z - 0.1], [0, tipAt.y - 0.13, tipAt.z + 0.16], [0, tipAt.y - 0.2, tipAt.z + 0.26]], [0.17, 0.13, 0.07], { sides: 9, steps: 6, round: 2 });

  // --- Skin mesh --------------------------------------------------------------------------------
  const skinParts = [
    { geometry: bodyGeo, keepColor: true },
    { geometry: headGeo, keepColor: true },
    { geometry: trunkGeo, keepColor: true },
    { geometry: fingerUp, color: 0x4b2c1c },
    { geometry: fingerLo, color: 0x4b2c1c },
  ];
  // Feet: round, flat-bottomed pillars, with hair coming down over their tops.
  const footAt = [[1.85, 2.75], [-1.85, 2.75], [1.85, -3.8], [-1.85, -3.8]];
  const ivoryParts = [];
  for (const [fx, fz] of footAt) {
    const foot = lathe([[0, 0], [0.92, 0], [1.02, 0.07], [1.0, 0.28], [0.9, 0.56], [0.78, 0.86], [0.72, 1.12], [0, 1.12]], 22).scale(1, 1, 1.08).translate(fx, 0, fz);
    skinParts.push({ geometry: foot, color: 0x3b2c22 });
    // Five blunt nails across the front.
    for (let n = -2; n <= 2; n++) {
      const a = n * 0.42;
      const r = 0.97;
      const g = new THREE.SphereGeometry(0.2, 12, 8).scale(1, 0.72, 0.6);
      g.rotateY(a);
      ivoryParts.push({ geometry: g, color: 0x8d7a58, position: [fx + Math.sin(a) * r, 0.16, fz + Math.cos(a) * r * 1.08] });
    }
  }

  // --- Tusks ------------------------------------------------------------------------------------
  // They leave the skull pointing down and out, swing forward and out, then up and back IN. That
  // spiral, ending nearly crossed in front, is the mammoth's own: an elephant's stay nearly straight.
  const tuskPts = [[0.76, 8.5, 5.9], [0.98, 7.1, 6.8], [1.42, 5.78, 7.95], [2.2, 5.0, 9.25], [2.95, 5.15, 10.5], [3.1, 6.2, 11.45], [2.45, 7.35, 11.95], [1.5, 7.95, 11.85]];
  const tuskRad = [0.47, 0.47, 0.43, 0.37, 0.3, 0.21, 0.12, 0.03];
  const tuskGeo = tube(tuskPts, tuskRad, { sides: 18, steps: 56, round: 0 });
  {
    const IV = lin(0xe6d5a8); const STAIN = lin(0x8c6a3c); const TIP = lin(0xcbb78c);
    tintVertices(tuskGeo, (x, y, z, out, i) => {
      const t = clamp01(Math.floor(i / 18) / 56);
      const stain = (1 - sstep(t, 0.1, 0.38)) * 0.75;
      const growth = 0.97 + 0.05 * Math.sin(t * 150) + 0.07 * (smoothNoise3(x * 1.5, y * 1.5, z * 1.5) - 0.5);
      out[0] = mix(mix(IV[0], TIP[0], sstep(t, 0.75, 1)), STAIN[0], stain) * growth;
      out[1] = mix(mix(IV[1], TIP[1], sstep(t, 0.75, 1)), STAIN[1], stain) * growth;
      out[2] = mix(mix(IV[2], TIP[2], sstep(t, 0.75, 1)), STAIN[2], stain) * growth;
    });
  }
  ivoryParts.push({ geometry: tuskGeo, keepColor: true });
  ivoryParts.push({ geometry: mirrorX(tuskGeo), keepColor: true });

  // --- The coat ---------------------------------------------------------------------------------
  const hair = [];
  const DARK = lin(0x37190c); const MID = lin(0x552a16); const RED = lin(0x6e3a1c); const GINGER = lin(0x8f5a2c);
  const hairCol = [0, 0, 0];
  const pushLock = (root, dir, normal, L, W, opts, baseTone) => {
    const g = lockGeo(root, dir, normal, L, W, opts);
    // Dark at the root and bright at the tip, which is what makes one lock read over the next.
    const rootKey = root;
    tintVertices(g, (x, y, z, out) => {
      const d = Math.hypot(x - rootKey[0], y - rootKey[1], z - rootKey[2]) / L;
      const k = mix(0.46, 1.14, sstep(d, 0.02, 0.86));
      out[0] = baseTone[0] * k; out[1] = baseTone[1] * k; out[2] = baseTone[2] * k;
    });
    hair.push({ geometry: g, keepColor: true });
  };
  const tone = (light) => {
    const r = rng();
    if (r < 0.07) { hairCol[0] = GINGER[0]; hairCol[1] = GINGER[1]; hairCol[2] = GINGER[2]; } else {
      const a = r < 0.5 ? DARK : MID; const b = r < 0.5 ? MID : RED;
      const t = clamp01(light + (rng() - 0.5) * 0.7);
      hairCol[0] = mix(a[0], b[0], t); hairCol[1] = mix(a[1], b[1], t); hairCol[2] = mix(a[2], b[2], t);
    }
    return [hairCol[0], hairCol[1], hairCol[2]];
  };
  const pick = (geometry, spacing, fn) => scatterOn(geometry, spacing, rng, fn);
  const flow = new THREE.Vector3(); const nrm = new THREE.Vector3();
  pick(bodyGeo, 0.6, (x, y, z, nx, ny, nz) => {
    if (y < 0.95 || Math.abs(x) < 0.3 && z < -7) return;
    if (z > 4.4 && y > 7.4 && Math.abs(x) < 1.3) return; // inside the head's own coat
    nrm.set(nx, ny, nz);
    const top = sstep(ny, 0.2, 0.85);
    // Hair falls: down the flank, parted away from the spine, and swept back a little.
    flow.set(Math.sign(x || 1) * (0.25 + 0.9 * top), -1, -0.42 - 0.3 * top);
    flow.addScaledVector(nrm, -flow.dot(nrm));
    if (flow.lengthSq() < 0.02) flow.set(0, -1, -0.2);
    flow.normalize();
    const leg = y < 4.1;
    const skirt = !leg && ny < 0.15 && y < 6.8;
    const droop = skirt ? 0.3 : 0.18;
    // Long, but never through the ground.
    const reach = (y - 0.3) / (Math.max(0, -flow.y) + droop);
    const L = Math.min(reach, leg ? 1.15 + rng() * 0.75 : skirt ? 2.7 + rng() * 1.6 : 1.8 + rng() * 0.9);
    const W = leg ? 0.34 + rng() * 0.16 : 0.4 + rng() * 0.26;
    const root = [x - nx * 0.05, y - ny * 0.05, z - nz * 0.05];
    pushLock(root, flow.clone(), nrm.clone(), L, W, { nv: 3, lift: skirt ? 0.26 : 0.16, droop, wave: (rng() - 0.5) * 0.1, th: 0.03 }, tone(skirt ? 0.2 : sstep(y, 5, 10.5)));
  });
  pick(headGeo, 0.47, (x, y, z, nx, ny, nz) => {
    if (y < 7.5 && z > 5.0) return;
    if (ny < -0.5) return;
    // Bare skin round the eyes, the tusk sleeves and the trunk's root.
    for (const e of EYE) if (Math.hypot(x - e.p[0], y - e.p[1], z - e.p[2]) < 0.42) return;
    const sleeve = Math.hypot(Math.abs(x) - 0.86, y - 8.0, z - 6.28);
    if (sleeve < 0.78 && z > 5.7) return;
    if (Math.abs(x) < 0.72 && z > 5.9 && y < 9.1) return;
    nrm.set(nx, ny, nz);
    const crown = sstep(y, 10.6, 11.5);
    flow.set(Math.sign(x || 1) * 0.5, -0.9 + crown * 0.4, -0.55 - crown * 0.3);
    flow.addScaledVector(nrm, -flow.dot(nrm));
    if (flow.lengthSq() < 0.02) flow.set(0, -1, -0.2);
    flow.normalize();
    const ear = Math.abs(x) > 1.35 && z < 4.6 && y > 9.1;
    // The topknot: the long shock of hair on the dome frozen specimens and cave paintings both show.
    const L = ear ? 0.6 + rng() * 0.3 : (crown > 0.2 ? 1.25 + rng() * 0.75 : 0.72 + rng() * 0.62) * (z > 5.7 ? 0.62 : 1);
    const W = (ear ? 0.28 : 0.3) + rng() * 0.12;
    pushLock([x - nx * 0.03, y - ny * 0.03, z - nz * 0.03], flow.clone(), nrm.clone(), L, W, { nv: 3, lift: 0.24, droop: 0.12, th: 0.022 }, tone(crown * 0.8 + 0.45));
  });
  // A few short hairs down the top of the trunk; the rings still read between them.
  for (let i = 0; i < 44; i++) {
    const t = 0.03 + rng() * 0.5;
    const c = trunkCurve.getPointAt(t);
    const tan = trunkCurve.getTangentAt(t);
    const a = (rng() - 0.5) * 2.5;
    const out = new THREE.Vector3(Math.sin(a) * 1, 0, Math.cos(a)).addScaledVector(tan, 0);
    out.addScaledVector(tan, -out.dot(tan)).normalize();
    const r = baseR(t);
    pushLock([c.x + out.x * r * 0.9, c.y + out.y * r * 0.9, c.z + out.z * r * 0.9], tan.clone(), out.clone(), 0.5 + rng() * 0.32, 0.2 + rng() * 0.08, { nv: 3, lift: 0.18, droop: 0.04, th: 0.014 }, tone(0.4));
  }
  // The tail's tuft of coarse black hair.
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2;
    const out = new THREE.Vector3(Math.cos(a), -0.1, Math.sin(a) * 0.9 - 0.25).normalize();
    pushLock([Math.cos(a) * 0.1, 5.75 - rng() * 0.3, -7.45 + Math.sin(a) * 0.1], new THREE.Vector3(Math.cos(a) * 0.14, -1, -0.12 + Math.sin(a) * 0.14).normalize(), out, 1.1 + rng() * 0.8, 0.24 + rng() * 0.1, { nv: 3, lift: 0.1, droop: 0, th: 0.016 }, [0.03, 0.02, 0.014]);
  }

  // --- Eyes -------------------------------------------------------------------------------------
  EYE.forEach((e) => {
    const g = new THREE.SphereGeometry(0.135, 14, 10);
    ivoryParts.push({ geometry: g, color: 0x1a0d06, position: [e.p[0] - e.n[0] * 0.06, e.p[1] - e.n[1] * 0.06, e.p[2] - e.n[2] * 0.06] });
    const shine = new THREE.SphereGeometry(0.03, 8, 6);
    ivoryParts.push({ geometry: shine, color: 0xf2e8d2, position: [e.p[0] + e.n[0] * 0.06, e.p[1] + e.n[1] * 0.06 + 0.05, e.p[2] + e.n[2] * 0.06 + 0.03] });
  });

  const root = new THREE.Group();
  root.name = 'woolly-mammoth';
  const strands = strandMap(1213);
  root.add(mesh(mergeParts(skinParts), standard({ vertexColors: true, roughness: 0.82, metalness: 0 })));
  root.add(mesh(mergeParts(hair), standard({ vertexColors: true, map: strands, bumpMap: strands, bumpScale: 0.7, roughness: 0.78, metalness: 0 })));
  root.add(mesh(mergeParts(ivoryParts), standard({ vertexColors: true, roughness: 0.34, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Stegosaurus
// ---------------------------------------------------------------------------------------------

// A pebbled hide: raised cells with a crease between, near white as colour and full range as bump.
function pebbleMap(seed) {
  const texture = canvasTexture(512, 512, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#c4c4c4';
    ctx.fillRect(0, 0, w, h);
    const N = 22;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = ((i + (j % 2) * 0.5 + (rng() - 0.5) * 0.5) / N) * w;
        const y = ((j + (rng() - 0.5) * 0.5) / N) * h;
        const r = (w / N) * (0.36 + rng() * 0.18);
        const v = 226 + Math.floor(rng() * 29);
        for (const ox of [-w, 0, w]) {
          for (const oy of [-h, 0, h]) {
            const g = ctx.createRadialGradient(x + ox - r * 0.2, y + oy - r * 0.2, r * 0.1, x + ox, y + oy, r);
            g.addColorStop(0, `rgb(${v},${v},${v})`);
            g.addColorStop(0.8, `rgb(${v - 18},${v - 18},${v - 18})`);
            g.addColorStop(1, 'rgba(180,180,180,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
    }
  });
  return repeatWrap(texture);
}

// True size, with the catalogue's 0.6 applied by the record. The profile is the whole animal: a tiny
// head carried near the ground, a back arching to its peak over the hips, short columns in front and
// long ones behind. Its torso is one lofted solid, so the neck, back and tail are a single unbroken
// line, and the limbs run into it through broad fillets. No part of it is a ball.
//
// Its colours are not known for any dinosaur, and the card should not imply they are.
export const STEGOSAURUS_PLATES = 17;

function stegosaurus() {
  const HIDE = lin(0x777a4a);
  const torso = axisLoft([
    [-15.3, 5.05, 0.05, 0.05, 0.05],
    [-14, 5.3, 0.24, 0.24, 0.24],
    [-12, 5.68, 0.42, 0.44, 0.44],
    [-9.5, 6.25, 0.72, 0.76, 0.76],
    [-7, 6.9, 1.12, 1.18, 1.2],
    [-4.6, 7.65, 1.72, 2.0, 1.9],
    [-2.4, 8.0, 2.05, 2.35, 2.6],
    [0.2, 7.35, 2.35, 2.6, 2.95],
    [2.6, 6.55, 2.2, 2.25, 2.55],
    [4.6, 5.7, 1.85, 1.7, 1.95],
    [6.4, 4.9, 1.25, 1.2, 1.45],
    [7.6, 4.45, 0.88, 0.82, 1.0],
    [8.7, 4.08, 0.6, 0.58, 0.66],
    [9.4, 3.86, 0.46, 0.44, 0.5],
  ]);
  const dorsal = (z) => torso.centre(z) + torso.above(z);

  const s = new Sculpt(0.18);
  s.add(torso, HIDE);
  for (const side of [1, -1]) {
    // --- The hind leg: long and straight, the femur longer than the shin, which marks a slow animal.
    // One long flat sheet of muscle from the hip, then a column that narrows steadily to the ankle.
    // No joint gets a ball of its own: a knee is a slight change of direction in one taper.
    s.add(ellipsoidP([side * 1.72, 7.0, -2.5], [0.82, 2.3, 1.72], [-0.1, 0, side * 0.05]), HIDE, { k: 1.2 });
    s.add(curveP([[side * 1.84, 6.4, -2.6], [side * 2.0, 4.6, -2.02], [side * 2.04, 3.6, -1.86], [side * 2.0, 2.4, -2.14], [side * 1.96, 1.1, -2.3], [side * 1.98, 0.4, -2.2]], [1.2, 0.86, 0.72, 0.6, 0.52, 0.62], 22), HIDE, { k: 0.9 });
    // The calf's belly behind the shin.
    s.add(ellipsoidP([side * 2.0, 2.95, -2.44], [0.42, 0.95, 0.4], [0.2, 0, 0]), HIDE, { k: 0.5 });
    // The foot spreads onto the ground, with three broad toes.
    s.add(ellipsoidP([side * 1.98, 0.32, -2.1], [0.74, 0.42, 0.82]), HIDE, { k: 0.4 });
    for (const t of [-1, 0, 1]) {
      s.add(ellipsoidP([side * 1.98 + t * 0.38, 0.22, -1.56 + (t === 0 ? 0.1 : -0.06)], [0.24, 0.24, 0.42]), HIDE, { k: 0.16 });
    }
    // --- The foreleg: short, massive, and set well forward under the shoulder.
    s.add(ellipsoidP([side * 1.85, 5.35, 3.85], [0.72, 1.55, 1.24], [0.14, 0, side * -0.07]), HIDE, { k: 1.0 });
    s.add(curveP([[side * 1.98, 4.85, 3.72], [side * 2.2, 3.5, 3.42], [side * 2.26, 2.4, 3.62], [side * 2.24, 1.1, 3.82], [side * 2.26, 0.34, 3.9]], [0.9, 0.66, 0.58, 0.5, 0.58], 18), HIDE, { k: 0.8 });
    s.add(ellipsoidP([side * 2.26, 0.26, 4.0], [0.64, 0.34, 0.64]), HIDE, { k: 0.3 });
    for (const t of [-2, -1, 0, 1, 2]) {
      s.add(ellipsoidP([side * 2.26 + t * 0.22, 0.17, 4.46 - Math.abs(t) * 0.08], [0.16, 0.18, 0.26]), HIDE, { k: 0.1 });
    }
  }
  // The tail's end, thickened where the spikes root.
  for (const z of [-12.7, -14]) {
    for (const side of [1, -1]) {
      const y = torso.centre(z);
      s.add(sphereP([side * torso.width(z) * 0.72, y + 0.08, z], 0.24), HIDE, { k: 0.2 });
    }
  }
  // The dorsal keel the plates are rooted in, so no plate stands on a bare curve.
  const keelP = []; const keelR = [];
  for (let i = 0; i <= 30; i++) {
    const z = mix(7.9, -12.4, i / 30);
    keelP.push([0, dorsal(z) - 0.08, z]);
    keelR.push(mix(0.2, 0.34, Math.sin((i / 30) * Math.PI)));
  }
  s.add(segsP(keelP, keelR), HIDE, { k: 0.34 });
  // A real groove behind the shoulder and over the thigh, where loose skin folds at the joints.
  for (const side of [1, -1]) {
    s.sub(curveP([[side * 2.5, 7.1, 2.2], [side * 2.45, 5.6, 2.15], [side * 2.2, 4.4, 2.5]], 0.07, 12), null, { k: 0.26 });
    s.sub(curveP([[side * 2.52, 7.9, 0.2], [side * 2.62, 6.3, -0.2], [side * 2.28, 4.8, 0.1]], 0.06, 12), null, { k: 0.24 });
  }
  // Slow swells of rib under the skin.
  s.map((d, x, y, z) => {
    if (d > 0.3 || d < -0.3 || y < 4.8 || y > 8.8) return d;
    return d + 0.022 * sstep(z, -1.8, 0) * (1 - sstep(z, 3.2, 4.6)) * Math.sin(z * 3.4) * sstep(Math.abs(x), 1.5, 2.1);
  }, [-3.2, 3.5, -2.5, 3.2, 9.5, 5.5]);
  // Flat on the ground.
  s.sub(boxP([0, -1, 0], [8, 1, 20]));

  // --- Paint --------------------------------------------------------------------------------------
  const OLIVE = lin(0x77794a); const OLIVE2 = lin(0x8d8c58); const RUST = lin(0x86502f); const DARK = lin(0x4b4c2c); const BELLY = lin(0xcdc497); const FOOT = lin(0x4d493a);
  const paint = (x, y, z, nx, ny, nz, rgb) => {
    const big = smoothNoise3(x * 0.55 + 7, y * 0.55, z * 0.55);
    const fine = smoothNoise3(x * 1.9, y * 1.9 + 3, z * 1.9);
    rgb[0] = mix(OLIVE[0], OLIVE2[0], big); rgb[1] = mix(OLIVE[1], OLIVE2[1], big); rgb[2] = mix(OLIVE[2], OLIVE2[2], big);
    // Broken rust bands down the flanks, wandering, and heaviest along the back.
    const onBody = z > -13 && z < 8;
    if (onBody) {
      const c = torso.centre(z);
      const u = (y - c) / Math.max(0.2, torso.above(z));
      const bar = Math.sin(z * 2.7 + 5 * smoothNoise3(z * 0.8, y * 0.5, x * 0.2) + 0.8 * Math.sin(y * 1.1));
      const rust = sstep(bar, 0.12, 0.62) * sstep(u, -0.5, 0.2) * (0.55 + 0.45 * fine);
      mixInto(rgb, RUST, rust * 0.7);
      mixInto(rgb, DARK, sstep(u, 0.72, 1.0) * 0.72);
    }
    // A pale underside: from the normal rather than the height, so a limb's inside goes pale too.
    const under = 1 - sstep(ny, -0.72, -0.08);
    const belly = onBody && y < torso.centre(z) ? under : under * 0.5;
    mixInto(rgb, BELLY, belly * (0.74 + 0.26 * fine));
    // The lower legs darken into horn-coloured feet.
    mixInto(rgb, FOOT, (1 - sstep(y, 0.5, 2.4)) * 0.8);
    const m = 0.9 + 0.2 * fine;
    rgb[0] *= m; rgb[1] *= m; rgb[2] *= m;
  };
  const bodyGeo = boxUV(polygonize(s, { tint: paint, uvScale: 1, extraReach: 0.08 }), 0.62);

  // --- The head: small, low and beaked, at a much finer grain ---------------------------------------
  const h = new Sculpt(0.052);
  const skull = axisLoft([
    [9.1, 3.96, 0.44, 0.42, 0.48],
    [9.7, 3.82, 0.46, 0.44, 0.5],
    [10.25, 3.72, 0.56, 0.5, 0.62],
    [10.85, 3.56, 0.5, 0.42, 0.5],
    [11.4, 3.32, 0.33, 0.3, 0.32],
    [11.85, 3.12, 0.2, 0.19, 0.2],
    [12.15, 3.0, 0.09, 0.08, 0.09],
  ]);
  h.add(skull, HIDE);
  const skullField = h.snapshot();
  const EYES = [1, -1].map((side) => onSurface(skullField, [side * 0.6, 3.86, 10.42]));
  EYES.forEach((e, i) => {
    const side = i === 0 ? 1 : -1;
    // A bony brow over the eye, and a socket for it to sit in.
    h.add(curveP([[e[0] - side * 0.01, e[1] + 0.12, e[2] - 0.2], [e[0] + side * 0.03, e[1] + 0.13, e[2]], [e[0] - side * 0.03, e[1] + 0.09, e[2] + 0.2]], 0.052, 8), HIDE, { k: 0.08 });
    h.sub(sphereP(e, 0.085), lin(0x1a1208), { k: 0.02 });
    // Nostril, and the cheek's line.
    const n = onSurface(skullField, [side * 0.2, 3.3, 11.62]);
    h.sub(ellipsoidP(n, [0.05, 0.035, 0.07]), lin(0x17120a), { k: 0.02 });
    h.add(curveP([[side * 0.52, 3.3, 10.12], [side * 0.46, 3.22, 10.72], [side * 0.3, 3.08, 11.22]], 0.04, 8), HIDE, { k: 0.1 });
  });
  // The mouth: a long groove running back from the beak.
  const mouth = [];
  for (let i = 0; i <= 24; i++) {
    const a = -1 + 2 * (i / 24);
    const z = mix(12.13, 10.32, Math.abs(a) ** 1.1);
    const c = skull.centre(z); const dn = skull.below(z);
    const hw = skull.width(z);
    const yy = c - dn * mix(0.52, 0.5, Math.abs(a));
    const xx = Math.sign(a) * hw * Math.sqrt(Math.max(0, 1 - 0.25)) * sstep(Math.abs(a), 0, 0.2);
    mouth.push(onSurface(skullField, [xx, yy, z], 0, 8));
  }
  h.sub(segsP(mouth, mouth.map(() => 0.034)), lin(0x2a1a10), { k: 0.04, ck: 0.034 });
  const BEAK = lin(0x4a3a24);
  const headPaint = (x, y, z, nx, ny, nz, rgb) => {
    if (rgb[0] < 0.05) return;
    paint(x, y, z, nx, ny, nz, rgb);
    mixInto(rgb, BEAK, sstep(z, 11.62, 11.82));
  };
  const headGeo = boxUV(polygonize(h, { tint: headPaint, uvScale: 1, extraReach: 0.03 }), 1.3);

  // --- Studs and horn -------------------------------------------------------------------------------
  const horn = [];
  const rng = seededRandom(2201);
  // Throat ossicles: the small bony discs that armoured Stegosaurus's neck.
  const neckField = s.snapshot();
  for (let i = 0; i < 64; i++) {
    const z = mix(6.8, 9.2, rng());
    const a = (rng() - 0.5) * 1.9;
    const c = torso.centre(Math.min(9.4, z));
    const p = onSurface(neckField, [Math.sin(a) * 1.5, c - Math.cos(a) * 1.5, z], 0, 7);
    const n = fieldNormal(neckField, p);
    const r = 0.04 + rng() * 0.06;
    const g = new THREE.SphereGeometry(r, 6, 4);
    horn.push({ geometry: g, color: 0x8f8862, position: [p[0] + n[0] * r * 0.15, p[1] + n[1] * r * 0.15, p[2] + n[2] * r * 0.15], scale: [1, 1, 1] });
  }
  // Blunt hoof-like nails, three behind and on the inner toes in front.
  const nail = (x, z, r) => {
    const g = new THREE.SphereGeometry(r, 9, 6).scale(1, 0.72, 1.05);
    horn.push({ geometry: g, color: 0x352c1c, position: [x, r * 0.64, z] });
  };
  for (const side of [1, -1]) {
    for (const t of [-1, 0, 1]) nail(side * 1.98 + t * 0.38, -1.2 + (t === 0 ? 0.1 : -0.06), 0.17);
    for (const t of [-2, -1, 0, 1, 2]) nail(side * 2.26 + t * 0.22, 4.68 - Math.abs(t) * 0.08, 0.1);
  }
  EYES.forEach((e) => {
    horn.push({ geometry: new THREE.SphereGeometry(0.088, 14, 10), color: 0xa8741a, position: [e[0], e[1], e[2]] });
    const side = Math.sign(e[0]);
    horn.push({ geometry: new THREE.SphereGeometry(0.045, 10, 8), color: 0x0c0806, position: [e[0] + side * 0.052, e[1], e[2] + 0.012] });
    horn.push({ geometry: new THREE.SphereGeometry(0.013, 6, 4), color: 0xffffff, position: [e[0] + side * 0.088, e[1] + 0.024, e[2] + 0.02] });
  });
  // The thagomizer: four spikes, back and out and a little up. Bone-pale at the root and dark at the
  // tip, each curving slightly as a keratin-sheathed spike does.
  const BONE = lin(0xa8996c); const TIP = lin(0x3a2e20);
  for (const [z, out, back, up, L] of [[-12.7, 0.84, -0.44, 0.32, 3.4], [-14, 0.66, -0.72, 0.26, 3.1]]) {
    for (const side of [1, -1]) {
      const dir = new THREE.Vector3(side * out, up, back).normalize();
      const y = torso.centre(z) + 0.08;
      const R = [side * torso.width(z) * 0.3, y, z];
      const P = (t, lift) => [R[0] + dir.x * L * t, R[1] + dir.y * L * t + lift, R[2] + dir.z * L * t];
      const g = tube([P(0, 0), P(0.35, 0.03), P(0.7, 0.04), P(1, 0.0)], [0.28, 0.22, 0.12, 0.0], { sides: 12, steps: 14, round: 0 });
      tintVertices(g, (x, yy, zz, c) => {
        const t = Math.hypot(x - R[0], yy - R[1], zz - R[2]) / L;
        const k = sstep(t, 0.35, 0.94);
        // The root goes the colour of the hide it grows out of, so the spike does not look stuck on.
        const skin = 1 - sstep(t, 0.1, 0.24);
        c[0] = mix(mix(BONE[0], TIP[0], k), OLIVE[0], skin); c[1] = mix(mix(BONE[1], TIP[1], k), OLIVE[1], skin); c[2] = mix(mix(BONE[2], TIP[2], k), OLIVE[2], skin);
      });
      horn.push({ geometry: g, keepColor: true });
    }
  }

  // --- The plates --------------------------------------------------------------------------------
  // Seventeen, in two staggered rows, alternating left and right, each overlapping the gap between
  // its neighbours on the far side. Largest over the hips, which is what the fossils show.
  const PLATE_Z = [7.35, 6.45, 5.45, 4.35, 3.15, 1.85, 0.4, -1.05, -2.55, -4.05, -5.5, -6.85, -8.05, -9.15, -10.15, -11.05, -11.85];
  const PLATE_H = [0.85, 1.05, 1.32, 1.62, 2.02, 2.42, 2.78, 3.02, 3.2, 3.2, 3.0, 2.66, 2.26, 1.86, 1.46, 1.12, 0.82];
  const plates = [];
  const RIM = lin(0x6e2f1c); const FIELD = lin(0x9b8a56); const ROOTC = lin(0x5b5a34);
  PLATE_Z.forEach((z, i) => {
    const H = PLATE_H[i];
    const W = H * mix(0.98, 0.76, Math.sin((i / 16) * Math.PI));
    const side = i % 2 === 0 ? 1 : -1;
    // A rounded kite: broad low shoulders, a blunt apex leaning a little toward the tail.
    const lean = mix(0.02, -0.14, i / 16);
    const outline = new THREE.CatmullRomCurve3([
      [0.34, 0], [0.5, 0.2], [0.5, 0.42], [0.3 + lean, 0.72], [0.04 + lean, 1.0], [-0.26 + lean, 0.74], [-0.5, 0.42], [-0.5, 0.2], [-0.34, 0], [0, -0.06],
    ].map(([a, b]) => new THREE.Vector3(a * W, b * H, 0)), true, 'catmullrom', 0.5);
    const hub = new THREE.Vector3(lean * W * 0.4, H * 0.4, 0);
    const TH = 0.12 + H * 0.045;
    const g = solidSurface({
      nu: 22, nv: 5, closedU: true,
      point: (u, v) => {
        const o = outline.getPoint(u);
        return [mix(hub.x, o.x, v), mix(hub.y, o.y, v), 0];
      },
      thick: (u, v) => {
        const o = outline.getPoint(u);
        const q = mix(hub.y, o.y, v) / H;
        return (TH * mix(1.3, 0.55, clamp01(q)) * (1 - v ** 2.4)) + 0.018;
      },
      axis: [0, 0, 1],
    });
    tintVertices(g, (x, y, zz, c) => {
      const o = Math.hypot((x - hub.x) / (W * 0.5), (y - hub.y) / (H * 0.6));
      const rim = sstep(o, 0.62, 0.98);
      const low = 1 - sstep(y / H, 0.02, 0.26);
      c[0] = mix(mix(FIELD[0], RIM[0], rim), ROOTC[0], low);
      c[1] = mix(mix(FIELD[1], RIM[1], rim), ROOTC[1], low);
      c[2] = mix(mix(FIELD[2], RIM[2], rim), ROOTC[2], low);
    });
    const puv = g.attributes.uv; const ppos = g.attributes.position;
    for (let k = 0; k < puv.count; k++) puv.setXY(k, ppos.getX(k) / W + 0.5, ppos.getY(k) / H);
    // Stood in the plane of the body, then leaned out from the spine and tipped to follow the back.
    const slope = Math.atan2(dorsal(z + 0.5) - dorsal(z - 0.5), 1);
    const m = new THREE.Matrix4().makeRotationY(-Math.PI / 2);
    const tipOut = new THREE.Matrix4().makeRotationZ(-side * 0.17);
    const follow = new THREE.Matrix4().makeRotationX(-slope * 0.72);
    const base = dorsal(z) - H * 0.13 - 0.1;
    const place = new THREE.Matrix4().makeTranslation(side * 0.2, base, z);
    place.multiply(tipOut).multiply(follow).multiply(m);
    g.applyMatrix4(place);
    plates.push({ geometry: g, keepColor: true });
  });
  // The grooves real plates carry are blood-vessel channels, fanning up from the root.
  const plateMap = canvasTexture(512, 512, (ctx, w, hh) => {
    const r = seededRandom(2202);
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, 0, w, hh);
    for (let i = 0; i < 170; i++) {
      const x0 = w / 2 + (r() - 0.5) * w * 0.5;
      const t = r() * 0.6;
      const spread = 1 + 0.9 * r();
      const x1 = w / 2 + (x0 - w / 2) * spread;
      ctx.strokeStyle = `rgba(185,176,160,${0.25 + r() * 0.4})`;
      ctx.lineWidth = 0.8 + r() * 1.8;
      ctx.beginPath();
      ctx.moveTo(mix(x0, x1, t), hh * (1 - t));
      ctx.quadraticCurveTo(mix(x0, x1, t + 0.15) + (r() - 0.5) * 12, hh * (1 - t - 0.2), mix(x0, x1, t + 0.4), hh * (0.6 - t));
      ctx.stroke();
    }
  });

  const pebbles = pebbleMap(2203);
  const root = new THREE.Group();
  root.name = 'stegosaurus';
  root.add(mesh(mergeParts([{ geometry: bodyGeo, keepColor: true }, { geometry: headGeo, keepColor: true }]), standard({ vertexColors: true, map: pebbles, bumpMap: pebbles, bumpScale: 0.6, roughness: 0.74, metalness: 0 })));
  root.add(mesh(mergeParts(plates), standard({ vertexColors: true, map: plateMap, bumpMap: plateMap, bumpScale: 0.7, roughness: 0.62, metalness: 0 })));
  root.add(mesh(mergeParts(horn), standard({ vertexColors: true, roughness: 0.42, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Bald eagle
// ---------------------------------------------------------------------------------------------

// One feather: a closed flat solid with its length on +Z, its width on X and its upper face on +Y.
// Thickness goes to nothing round the edge, so it needs no rim. `shape` says whose feather it is: a
// flight feather's outer primaries narrow abruptly, which is what spreads an eagle's wing into fingers.
function featherGeo(L, W, { nu = 3, nv = 6, shape = 'round', cup = 0.12, bend = 0, sweep = 0, th = 0.008 } = {}) {
  const profile = (v) => {
    if (shape === 'finger') return Math.min(1, (v / 0.1) ** 0.5) * mix(1, 0.5, sstep(v, 0.5, 0.72)) * Math.sqrt(Math.max(0.0015, 1 - v ** 7));
    if (shape === 'lance') return Math.max(0.03, Math.sin(Math.PI * v ** 0.7) ** 0.8);
    return Math.min(1, (v / 0.14) ** 0.55) * Math.sqrt(Math.max(0.0015, 1 - v ** 5));
  };
  return solidSurface({
    nu, nv,
    point: (u, v) => {
      const U = u * 2 - 1;
      const w = (W / 2) * profile(v);
      return [U * w + sweep * L * v * v, -cup * W * U * U + bend * L * v * v, L * v];
    },
    thick: (u, v) => th * Math.max(0, 1 - (u * 2 - 1) ** 4) * Math.sin(Math.PI * clamp01(v)) ** 0.4,
    axis: [0, 1, 0],
  });
}

// A feather on a body: root, the way it runs, and the way its upper face looks.
function placeFeather(geometry, root, dir, normal) {
  const end = [root[0] + dir.x, root[1] + dir.y, root[2] + dir.z];
  const { m } = alongMatrix(root, end, [normal.x, normal.y, normal.z]);
  return geometry.applyMatrix4(m);
}

// Barbs angled up from a pale shaft, near white so a feather's own colour carries the hue.
function featherMap(seed) {
  return canvasTexture(256, 512, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#e4e4e4';
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1.5;
    for (let y = h + 120; y > -20; y -= 3.4) {
      for (const side of [1, -1]) {
        const v = 190 + Math.floor(rng() * 65);
        ctx.strokeStyle = `rgb(${v},${v},${v})`;
        ctx.beginPath();
        ctx.moveTo(w / 2, y);
        ctx.quadraticCurveTo(w / 2 + (side * w) / 4, y - 26, w / 2 + (side * w) / 2, y - 92);
        ctx.stroke();
      }
    }
    // A few clean splits in the vane, the thing that says this is a real feather that has been used.
    for (let i = 0; i < 12; i++) {
      const side = rng() > 0.5 ? 1 : -1;
      const y = 40 + rng() * (h - 90);
      ctx.strokeStyle = 'rgba(70,70,70,0.55)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(w / 2 + (side * w) / 2, y);
      ctx.lineTo(w / 2 + side * w * (0.2 + rng() * 0.2), y + 38);
      ctx.stroke();
    }
    ctx.fillStyle = '#6f6f6f';
    ctx.fillRect(w / 2 - 3.5, 0, 7, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(w / 2 - 1.8, 0, 3.6, h);
  });
}

function baldEagle() {
  const rng = seededRandom(1782);
  const DARK = lin(0x2c1b11); const BROWN = lin(0x452c1a); const WARM = lin(0x5d3c22);
  const WHITE = lin(0xdedacd); const CREAM = lin(0xcfc8b2);
  const YELLOW = lin(0xf0b21a); const CERE = lin(0xf6c944);

  // --- The body under the feathers: coarse, since nobody can see it ----------------------------
  const b = new Sculpt(0.085);
  b.add(ellipsoidP([0, 2.72, 0.02], [0.6, 0.98, 0.56], [0.26, 0, 0]), BROWN);
  b.add(ellipsoidP([0, 2.72, 0.24], [0.54, 0.68, 0.46], [0.2, 0, 0]), BROWN, { k: 0.3 });
  b.add(ellipsoidP([0, 3.38, 0.04], [0.6, 0.4, 0.46]), BROWN, { k: 0.3 });
  b.add(curveP([[0, 2.24, -0.28], [0, 1.96, -0.46], [0, 1.72, -0.68]], [0.42, 0.28, 0.14], 8), BROWN, { k: 0.26 });
  // The wing's bones: shoulder, elbow, wrist, hand. Half raised, so the wrist comes level with the head.
  const S = [0.46, 3.5, -0.08]; const E = [0.98, 3.86, -0.3]; const W = [1.48, 4.32, -0.12]; const H = [1.92, 3.98, -0.24];
  for (const side of [1, -1]) {
    const m = (p) => [side * p[0], p[1], p[2]];
    b.add(curveP([m(S), m(E)], [0.25, 0.16], 8), BROWN, { k: 0.22 });
    b.add(curveP([m(E), m(W)], [0.16, 0.1], 8), BROWN, { k: 0.08 });
    b.add(curveP([m(W), m(H)], [0.1, 0.05], 6), BROWN, { k: 0.05 });
    // The thigh, wrapped in its long "trouser" feathers.
    b.add(ellipsoidP([side * 0.31, 2.1, 0.08], [0.27, 0.46, 0.3], [0.1, 0, side * -0.08]), BROWN, { k: 0.2 });
    b.add(curveP([[side * 0.3, 2.0, 0.08], [side * 0.28, 1.86, 0.1]], [0.17, 0.09], 4), BROWN, { k: 0.1 });
  }
  const bodyGeo = polygonize(b, {
    uvScale: 2,
    extraReach: 0.04,
    // White under the hood, so a gap between two white feathers shows white rather than brown.
    tint: (x, y, z, nx, ny, nz, rgb) => { if (y > 3.42 && Math.abs(x) < 0.82) { rgb[0] = WHITE[0]; rgb[1] = WHITE[1]; rgb[2] = WHITE[2]; } },
  });

  // --- The head: read at arm's length, in a far finer grain ---------------------------------------
  const h = new Sculpt(0.027);
  h.add(curveP([[0, 3.5, 0.03], [0, 3.72, 0.06], [0, 3.98, 0.12]], [0.33, 0.31, 0.27], 8), WHITE);
  // A flat crown and a heavy head, deep through the cheek.
  h.add(ellipsoidP([0, 4.02, 0.16], [0.3, 0.26, 0.38], [-0.08, 0, 0]), WHITE, { k: 0.14 });
  h.add(ellipsoidP([0, 3.92, 0.3], [0.255, 0.21, 0.26]), WHITE, { k: 0.1 });
  const skull = h.snapshot();
  const eyeOf = (side) => onSurface(skull, [side * 0.34, 4.02, 0.33], -0.022);
  const EYES = [eyeOf(1), eyeOf(-1)];
  // The beak's mass. Deep and narrow: the bulk of it is below the culmen, so it is two curves squashed
  // across, and the hook comes down well past the lower mandible.
  const culmen = [[0, 4.05, 0.38], [0, 4.07, 0.58], [0, 4.02, 0.76], [0, 3.88, 0.885], [0, 3.71, 0.86]];
  h.add(squash(curveP(culmen, [0.105, 0.105, 0.078, 0.04, 0.008], 26), [0.62, 1, 1]), YELLOW, { k: 0.05, ck: 0.024 });
  h.add(squash(curveP([[0, 3.94, 0.36], [0, 3.94, 0.56], [0, 3.91, 0.7], [0, 3.84, 0.81]], [0.115, 0.098, 0.066, 0.02], 16), [0.72, 1, 1]), YELLOW, { k: 0.05, ck: 0.024 });
  // The cere: the soft pale skin at the base of the upper beak, where the nostrils are.
  h.add(squash(curveP([[0, 4.06, 0.38], [0, 4.06, 0.53]], [0.118, 0.112], 6), [0.74, 1, 1]), CERE, { k: 0.03, ck: 0.015 });
  // The lower mandible, shorter, tucked under.
  h.add(squash(curveP([[0, 3.81, 0.34], [0, 3.8, 0.55], [0, 3.79, 0.71]], [0.082, 0.07, 0.024], 12), [0.72, 1, 1]), YELLOW, { k: 0.03, ck: 0.02 });
  // The gape: runs back to under the eye, which is what gives an eagle its scowl. Its path asks the
  // beak where its surface is, or it floats clear of a narrow beak and dimples the cheek instead.
  const beakField = h.snapshot();
  for (const side of [1, -1]) {
    const gape = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      gape.push(onSurface(beakField, [side * 0.22, mix(3.845, 3.905, t), mix(0.76, 0.3, t)], 0, 8));
    }
    h.sub(segsP(gape, gape.map(() => 0.021)), lin(0x3a2610), { k: 0.022, ck: 0.022 });
    // A nostril, a dark slit in the cere.
    h.sub(ellipsoidP(onSurface(beakField, [side * 0.2, 4.06, 0.49], 0, 8), [0.016, 0.022, 0.036], [0, 0, side * 0.5]), lin(0x24180c), { k: 0.008, ck: 0.008 });
    // The brow: a shelf of bone over the eye, running down toward the beak. It is the fierceness,
    // and it must stand outside the eye and cut off the top of the iris.
    const e = EYES[side > 0 ? 0 : 1];
    h.add(curveP([[e[0] - side * 0.03, e[1] + 0.058, e[2] - 0.17], [e[0] + side * 0.03, e[1] + 0.05, e[2] - 0.01], [e[0] + side * 0.005, e[1] + 0.008, e[2] + 0.13]], [0.028, 0.05, 0.026], 12), WHITE, { k: 0.04 });
    h.sub(sphereP(e, 0.056), lin(0x3a3226), { k: 0.012, ck: 0.012 });
  }
  const headPaint = (x, y, z, nx, ny, nz, rgb) => {
    // The hook's tip goes dark, as horn does; and a yellow patch runs back through the bare lores.
    const tip = sstep(z, 0.8, 0.87) * (1 - sstep(y, 3.86, 3.98));
    mixInto(rgb, lin(0x8a6410), tip * 0.8);
  };
  const headGeo = polygonize(h, { tint: headPaint, uvScale: 2.4, extraReach: 0.02, normalH: 0.5 });

  // --- The feathers ---------------------------------------------------------------------------------
  const feathers = [];
  const wing = [];
  const toneFeather = (g, root, L, c, { tipDark = 1, rootDark = 0.55 } = {}) => {
    tintVertices(g, (x, y, z, out) => {
      const d = Math.hypot(x - root[0], y - root[1], z - root[2]) / L;
      const k = mix(rootDark, tipDark, sstep(d, 0, 0.7));
      out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
    });
    return g;
  };
  const lerp3 = (a, c, t) => [mix(a[0], c[0], t), mix(a[1], c[1], t), mix(a[2], c[2], t)];
  const dorsal = new THREE.Vector3(0.05, 0.4, -1).normalize();
  const wingFeather = (root, dirV, L, Wd, color, opts, up = dorsal) => {
    const d = dirV.clone().normalize();
    const n = up.clone().addScaledVector(d, -up.dot(d)).normalize();
    const g = placeFeather(featherGeo(L, Wd, opts), root, d, n);
    wing.push({ geometry: toneFeather(g, root, L, color), keepColor: true });
  };
  // Primaries: ten from the hand, fanning from nearly straight down to well out, the outer six fingered.
  const P_N = 10;
  for (let i = 0; i < P_N; i++) {
    const t = i / (P_N - 1);
    const a = 0.22 + t * 0.62;
    const root = lerp3(W, H, 0.1 + t * 0.92);
    root[2] += i * 0.007;
    const d = new THREE.Vector3(Math.sin(a), -Math.cos(a), -0.1 - 0.05 * t);
    const L = mix(1.62, 1.92, Math.sin(t * Math.PI * 0.72));
    wingFeather(root, d, L, mix(0.32, 0.27, t), lerp3(DARK, BROWN, 0.15 + rng() * 0.2), { shape: i > 3 ? 'finger' : 'round', nu: 4, nv: 10, bend: 0.05, th: 0.012 });
  }
  // Secondaries: the broad row hanging from the forearm, each overlapping the next.
  const SEC = 13;
  for (let i = 0; i < SEC; i++) {
    const t = i / (SEC - 1);
    const root = lerp3(E, W, t);
    root[2] -= i * 0.005;
    const a = mix(-0.06, 0.28, t);
    const d = new THREE.Vector3(Math.sin(a), -Math.cos(a), -0.14);
    wingFeather(root, d, mix(1.5, 1.62, t), 0.34, lerp3(DARK, BROWN, 0.3 + rng() * 0.25), { nu: 3, nv: 8, bend: 0.05, th: 0.011 });
  }
  // Tertials, closing the gap between the wing and the back.
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const root = lerp3(S, E, 0.1 + t * 0.9);
    const d = new THREE.Vector3(mix(-0.2, 0, t), -1, -0.3);
    wingFeather(root, d, mix(1.22, 1.46, t), 0.34, lerp3(BROWN, WARM, rng() * 0.4), { nu: 3, nv: 7, bend: 0.04, th: 0.011 });
  }
  // Coverts, in rows on BOTH faces, because from the front a half-raised wing shows its underside.
  // A row's root is lifted off the wing's plane along the side it lies on.
  const covertRow = (A, C, n, L, Wd, off, faceSign, slide, tone0) => {
    const up = dorsal.clone().multiplyScalar(faceSign);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const p = lerp3(A, C, t);
      const root = [p[0] + up.x * off, p[1] + up.y * off - slide, p[2] + up.z * off];
      const a = mix(-0.04, 0.6, t);
      const d = new THREE.Vector3(Math.sin(a), -Math.cos(a), -0.14);
      wingFeather(root, d, L * (0.92 + rng() * 0.16), Wd, lerp3(tone0, WARM, rng() * 0.5), { nu: 2, nv: 3, th: 0.009 }, up);
    }
  };
  for (const face of [1, -1]) {
    covertRow(E, W, 15, 0.8, 0.27, 0.035, face, 0.02, BROWN);
    covertRow(W, H, 9, 0.86, 0.22, 0.04, face, 0.02, DARK);
    covertRow(S, E, 7, 0.8, 0.3, 0.05, face, 0.03, BROWN);
    covertRow(E, W, 13, 0.5, 0.23, 0.07, face, -0.03, BROWN);
    covertRow(S, E, 6, 0.54, 0.26, 0.09, face, -0.02, BROWN);
    covertRow(W, H, 6, 0.48, 0.18, 0.07, face, -0.03, BROWN);
  }
  const wingGeo = mergeParts(wing);
  feathers.push({ geometry: wingGeo, keepColor: true });
  feathers.push({ geometry: mirrorX(wingGeo), keepColor: true });

  // The tail: twelve broad white feathers, fanned a little, hanging behind the branch.
  for (let i = 0; i < 12; i++) {
    const f = (i - 5.5) / 5.5;
    const root = [f * 0.2, 1.98, -0.42 - Math.abs(f) * 0.03 - i * 0.002];
    const d = new THREE.Vector3(f * 0.3, -1, -0.56).normalize();
    const n = new THREE.Vector3(0, 0.5, -1); n.addScaledVector(d, -n.dot(d)).normalize();
    const g = placeFeather(featherGeo(1.36 - Math.abs(f) * 0.14, 0.34, { nu: 3, nv: 8, th: 0.011, bend: 0.02 }), root, d, n);
    feathers.push({ geometry: toneFeather(g, root, 1.3, WHITE, { rootDark: 0.82 }), keepColor: true });
  }
  // The white coverts over and under the tail's root.
  for (const face of [1, -1]) {
    for (let i = 0; i < 9; i++) {
      const f = (i - 4) / 4;
      const root = [f * 0.2, 2.02 + rng() * 0.1 - (face < 0 ? 0.22 : 0), -0.34 + face * -0.08];
      const d = new THREE.Vector3(f * 0.2, -1, -0.56 - 0.1 * face).normalize();
      const n = new THREE.Vector3(0, 0.5 * face, -1 * face); n.addScaledVector(d, -n.dot(d)).normalize();
      const g = placeFeather(featherGeo(0.72 + rng() * 0.1, 0.27, { nu: 2, nv: 4, th: 0.012 }), root, d, n);
      feathers.push({ geometry: toneFeather(g, root, 0.7, CREAM, { rootDark: 0.86 }), keepColor: true });
    }
  }

  // Contour feathers, laid on the surface in the direction they grow: from the head toward the tail.
  const flow = new THREE.Vector3(); const nrm = new THREE.Vector3();
  scatterOn(bodyGeo, 0.19, rng, (x, y, z, nx, ny, nz) => {
    nrm.set(nx, ny, nz);
    const onWing = Math.abs(x) > 0.82;
    if (onWing) flow.set(Math.sign(x) * 0.25, -1, -0.15);
    else flow.set(Math.sign(x || 1) * 0.1, -1, z < -0.1 ? -0.5 : -0.18);
    flow.addScaledVector(nrm, -flow.dot(nrm));
    if (flow.lengthSq() < 0.03) return;
    flow.normalize();
    const pants = !onWing && y < 2.35 && Math.abs(x) > 0.1 && z > -0.2;
    const hood = y > 3.42 + 0.1 * (smoothNoise3(x * 6, y * 3, z * 6) - 0.5) * 2 && !onWing;
    const L = hood ? 0.25 + rng() * 0.07 : onWing ? 0.28 + rng() * 0.1 : pants ? 0.52 + rng() * 0.16 : 0.42 + rng() * 0.16;
    const Wd = hood ? 0.13 : onWing ? 0.17 : pants ? 0.19 : 0.25 + rng() * 0.05;
    const c = hood ? WHITE : lerp3(lerp3(DARK, BROWN, rng()), WARM, sstep(y, 2.0, 3.2) * rng() * 0.7);
    const root = [x - nx * 0.012, y - ny * 0.012, z - nz * 0.012];
    const g = placeFeather(featherGeo(L, Wd, { nu: 2, nv: 3, shape: pants || hood ? 'lance' : 'round', cup: -0.1, th: 0.008 }), root, flow, nrm);
    feathers.push({ geometry: toneFeather(g, root, L, c, { rootDark: 0.6 }), keepColor: true });
  });
  // The white hood's hackles: long and pointed down the neck, flowing over the shoulders, and small on
  // the crown and the cheeks. Left off only round the eye and the beak.
  scatterOn(headGeo, 0.085, rng, (x, y, z, nx, ny, nz) => {
    if (z > 0.4 && y < 4.16) return;
    for (const e of EYES) if (Math.hypot(x - e[0], y - e[1], z - e[2]) < 0.085) return;
    nrm.set(nx, ny, nz);
    const neck = sstep(4.0 - y, 0, 0.3);
    flow.set(Math.sign(x || 1) * 0.12, mix(-0.5, -1, neck), mix(-1, -0.5, neck));
    flow.addScaledVector(nrm, -flow.dot(nrm));
    if (flow.lengthSq() < 0.03) return;
    flow.normalize();
    const L = 0.1 + 0.34 * neck + rng() * 0.05;
    const root = [x - nx * 0.006, y - ny * 0.006, z - nz * 0.006];
    const g = placeFeather(featherGeo(L, mix(0.07, 0.115, neck), { nu: 2, nv: 2, shape: 'lance', cup: -0.08, th: 0.006 }), root, flow, nrm);
    feathers.push({ geometry: toneFeather(g, root, L, WHITE, { rootDark: 0.78, tipDark: 1 }), keepColor: true });
  });
  // A second, denser pass over the mantle, where the hood's edge breaks up over the brown.
  scatterOn(bodyGeo, 0.115, rng, (x, y, z, nx, ny, nz) => {
    if (y < 3.3 || Math.abs(x) > 0.72) return;
    nrm.set(nx, ny, nz);
    flow.set(Math.sign(x || 1) * 0.18, -1, -0.32);
    flow.addScaledVector(nrm, -flow.dot(nrm));
    if (flow.lengthSq() < 0.03) return;
    flow.normalize();
    const L = 0.3 + rng() * 0.12;
    const root = [x - nx * 0.01, y - ny * 0.01, z - nz * 0.01];
    const g = placeFeather(featherGeo(L, 0.135, { nu: 2, nv: 2, shape: 'lance', cup: -0.08, th: 0.006 }), root, flow, nrm);
    feathers.push({ geometry: toneFeather(g, root, L, WHITE, { rootDark: 0.82 }), keepColor: true });
  });

  // --- The perch: a weathered snag and one thick limb -----------------------------------------------
  const BRANCH_Y = 1.4; const BRANCH_Z = 0.12; const BRANCH_R = 0.215;
  const p = new Sculpt(0.085);
  const BARK = lin(0x6a5a48);
  p.add(curveP([[-0.58, -0.1, 0.1], [-0.58, 0.6, 0.12], [-0.5, 1.18, 0.12], [-0.34, 1.42, 0.12]], [0.46, 0.33, 0.26, 0.2], 12), BARK);
  p.add(curveP([[-1.28, 1.36, 0.12], [-0.5, BRANCH_Y - 0.01, BRANCH_Z], [0.2, BRANCH_Y, BRANCH_Z], [1.05, BRANCH_Y + 0.03, BRANCH_Z - 0.02], [1.42, BRANCH_Y + 0.08, BRANCH_Z - 0.05]], [0.15, BRANCH_R, BRANCH_R, 0.17, 0.11], 16), BARK, { k: 0.14 });
  // A snapped stub on the limb, so it reads as a real branch rather than a bar.
  p.add(curveP([[0.74, BRANCH_Y + 0.02, BRANCH_Z - 0.1], [0.88, BRANCH_Y + 0.26, BRANCH_Z - 0.34]], [0.08, 0.05], 4), BARK, { k: 0.08 });
  // Roots spreading over the ground.
  for (const [rx, rz] of [[0.12, 0.62], [0.2, -0.58], [-1.3, 0.52], [-1.18, -0.66], [-0.56, 0.86], [-0.6, -0.82]]) {
    p.add(curveP([[-0.58, 0.28, 0.1], [(rx - 0.58) / 2, 0.14, (rz + 0.1) / 2], [rx, 0.02, rz]], [0.26, 0.16, 0.05], 8), BARK, { k: 0.18 });
  }
  p.map((d, x, y, z) => (d > 0.14 || d < -0.14 ? d : d + 0.016 * Math.sin((x + z * 0.6) * 7 + 2 * Math.sin(y * 5)) * Math.sin((z - y * 0.5) * 8)), [-2.2, 0, -1.6, 2, 2, 1.6]);
  p.sub(boxP([0, -1, 0], [4, 1, 4]));
  const DEAD = lin(0x6c5e4c); const DEEP = lin(0x221a12);
  const perchGeo = polygonize(p, {
    uvScale: 3,
    extraReach: 0.03,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const n = sstep(smoothNoise3(x * 5, y * 9, z * 5), 0.2, 0.8);
      rgb[0] = mix(DEEP[0], DEAD[0], n); rgb[1] = mix(DEEP[1], DEAD[1], n); rgb[2] = mix(DEEP[2], DEAD[2], n);
    },
  });

  // --- Feet ---------------------------------------------------------------------------------------------
  // Toes wrap the limb by construction: their paths are written round its own axis at its own radius.
  const horn = [];
  const SCALE = lin(0xeaa819); const SCALE_DARK = lin(0x9d6c0e);
  for (const side of [1, -1]) {
    const fx = side * 0.28;
    const onLimb = (x, a, rr) => [x, BRANCH_Y + Math.cos(a) * rr + 0.002, BRANCH_Z + Math.sin(a) * rr];
    // The bare yellow shank.
    horn.push({ geometry: tube([[fx, 1.98, 0.1], [fx, 1.8, 0.11], [fx, BRANCH_Y + BRANCH_R + 0.04, BRANCH_Z]], [0.07, 0.066, 0.078], { sides: 10, steps: 8, round: 1 }), color: 0xe8a818 });
    horn.push({ geometry: new THREE.SphereGeometry(0.1, 12, 9).scale(1.15, 0.7, 1.15), color: 0xe8a818, position: [fx, BRANCH_Y + BRANCH_R + 0.03, BRANCH_Z] });
    const toe = (dx, a0, a1, r0, r1) => {
      const pts = [];
      const N = 7;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push(onLimb(fx + dx * mix(0.25, 1, t), mix(a0, a1, t), BRANCH_R + mix(r0, r1, t) * 0.74));
      }
      const steps = 15; const sides = 8;
      const g = tube(pts, [r0, r1], { sides, steps, round: 1 });
      // Big scutes across the top of each toe, which is how a raptor's toes actually look.
      tintVertices(g, (x, y, z, out, i) => {
        const row = Math.floor(i / sides);
        const k = row % 3 === 0 ? 1 : 0;
        out[0] = mix(SCALE[0], SCALE_DARK[0], k); out[1] = mix(SCALE[1], SCALE_DARK[1], k); out[2] = mix(SCALE[2], SCALE_DARK[2], k);
      });
      horn.push({ geometry: g, keepColor: true });
      // The talon carries on round the limb and dives into the bark.
      const sign = Math.sign(a1 - a0);
      const cp = [];
      const x1 = fx + dx;
      for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        cp.push(onLimb(x1, a1 - sign * 0.07 + sign * t * 0.94, BRANCH_R + mix(r1 * 0.85, -0.03, t ** 1.6)));
      }
      const c = tube(cp, [r1 * 0.95, r1 * 0.8, r1 * 0.55, r1 * 0.3, 0], { sides: 8, steps: 10, round: 0 });
      horn.push({ geometry: c, color: 0x0d0b0a });
    };
    toe(-side * 0.12, -0.1, 1.5, 0.056, 0.044);
    toe(side * 0.02, -0.1, 1.75, 0.06, 0.046);
    toe(side * 0.16, -0.1, 1.5, 0.056, 0.044);
    toe(0, 0.1, -1.55, 0.062, 0.05);
  }
  // Pale, fierce eyes: an iris of straw yellow with a small black pupil, looking forward and out.
  EYES.forEach((e, i) => {
    const side = i === 0 ? 1 : -1;
    const gaze = new THREE.Vector3(side * 0.74, -0.04, 0.68).normalize();
    horn.push({ geometry: new THREE.SphereGeometry(0.05, 16, 12), color: 0xeed978, position: [e[0], e[1], e[2]] });
    horn.push({ geometry: new THREE.SphereGeometry(0.024, 12, 8), color: 0x050403, position: [e[0] + gaze.x * 0.03, e[1] + gaze.y * 0.03, e[2] + gaze.z * 0.03] });
    horn.push({ geometry: new THREE.SphereGeometry(0.007, 6, 4), color: 0xffffff, position: [e[0] + gaze.x * 0.048, e[1] + 0.012, e[2] + gaze.z * 0.046] });
  });

  const map = featherMap(1783);
  const bark = canvasTexture(256, 256, (ctx, w, hh) => {
    const r = seededRandom(1784);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, hh);
    for (let i = 0; i < 900; i++) {
      const v = Math.round(128 + (r() > 0.5 ? 1 : -1) * (24 + r() * 80));
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(r() * w, r() * hh, 1 + r() * 2.4, 6 + r() * 24);
    }
  });
  bark.colorSpace = THREE.NoColorSpace;
  repeatWrap(bark);

  const root = new THREE.Group();
  root.name = 'bald-eagle';
  root.add(mesh(mergeParts([{ geometry: headGeo, keepColor: true }]), standard({ vertexColors: true, roughness: 0.46, metalness: 0 })));
  root.add(mesh(mergeParts(feathers), standard({ vertexColors: true, map, bumpMap: map, bumpScale: 0.5, roughness: 0.68, metalness: 0 })));
  root.add(mesh(mergeParts([{ geometry: bodyGeo, keepColor: true }, { geometry: perchGeo, keepColor: true }]), standard({ vertexColors: true, bumpMap: bark, bumpScale: 2, roughness: 0.92, metalness: 0 })));
  root.add(mesh(mergeParts(horn), standard({ vertexColors: true, roughness: 0.3, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Emperor penguin
// ---------------------------------------------------------------------------------------------

// A penguin's coat really is scale-like: short stiff feathers overlapping in rows, pointing down. It
// is a bump and a shade rather than geometry because there are tens of thousands of them.
function penguinFeatherMap(seed) {
  const t = canvasTexture(512, 512, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(0, 0, w, h);
    const COLS = 16; const ROWS = 22;
    const cw = w / COLS; const ch = h / ROWS;
    // From the bottom up, so each higher row lies over the one below, as a feathered coat does.
    for (let j = ROWS + 1; j >= -2; j--) {
      for (let i = -1; i <= COLS + 1; i++) {
        const x = (i + (((j % 2) + 2) % 2) * 0.5) * cw + (rng() - 0.5) * cw * 0.2;
        const y = j * ch + (rng() - 0.5) * ch * 0.2;
        const v = 230 + Math.floor(rng() * 25);
        const g = ctx.createLinearGradient(0, y - ch, 0, y + ch * 1.3);
        g.addColorStop(0, `rgb(${v},${v},${v})`);
        g.addColorStop(0.72, `rgb(${v - 6},${v - 6},${v - 6})`);
        g.addColorStop(1, `rgb(${v - 30},${v - 30},${v - 30})`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, cw * 0.56, ch * 1.3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
  return repeatWrap(t);
}

function emperorPenguin() {
  const WHITE = lin(0xe6e3d9); const BLACK = lin(0x0f1216); const BACK = lin(0x20262f); const GOLD = lin(0xf0ab1f); const PALE = lin(0xf5e29a);
  const s = new Sculpt(0.043);
  const trunk = axisLoft([
    [0.3, 0.02, 0.08, 0.08, 0.08],
    [0.5, 0.02, 0.54, 0.46, 0.46],
    [0.85, 0.03, 0.74, 0.62, 0.58],
    [1.25, 0.05, 0.8, 0.66, 0.62],
    [1.8, 0.05, 0.74, 0.6, 0.57],
    [2.3, 0.04, 0.62, 0.5, 0.49],
    [2.75, 0.04, 0.47, 0.38, 0.38],
    [3.1, 0.06, 0.345, 0.29, 0.3],
    [3.35, 0.08, 0.285, 0.25, 0.27],
    [3.55, 0.1, 0.27, 0.25, 0.27],
    [3.82, 0.12, 0.21, 0.2, 0.22],
    [3.97, 0.12, 0.07, 0.07, 0.07],
  ], 'y');
  s.add(trunk, WHITE);
  // The face: the head carried forward, a chin, a slender start to the beak.
  s.add(ellipsoidP([0, 3.6, 0.17], [0.235, 0.25, 0.3], [-0.05, 0, 0]), BLACK, { k: 0.12 });
  // Shoulders for the flippers to root in.
  for (const side of [1, -1]) s.add(ellipsoidP([side * 0.42, 2.72, -0.02], [0.13, 0.22, 0.18]), BACK, { k: 0.2 });
  // The brood fold: the loose skin of the belly, hanging forward over the chick's back.
  s.add(ellipsoidP([0, 0.98, 0.52], [0.54, 0.34, 0.26], [0.2, 0, 0]), WHITE, { k: 0.34 });
  // The short wedge of the rump, running into the tail.
  s.add(curveP([[0, 0.8, -0.42], [0, 0.48, -0.55], [0, 0.26, -0.66]], [0.26, 0.15, 0.06], 8), BACK, { k: 0.26 });
  const headField = s.snapshot();

  // The beak: slender and down-curved. Black above; the lower half carries the orange-pink plate.
  const BEAKTOP = lin(0x0c0d0f); const STRIPE = lin(0xef8a68);
  s.add(squash(curveP([[0, 3.585, 0.36], [0, 3.56, 0.56], [0, 3.5, 0.74], [0, 3.41, 0.88]], [0.072, 0.056, 0.036, 0.01], 18), [0.82, 1, 1]), BEAKTOP, { k: 0.05, ck: 0.022 });
  s.add(squash(curveP([[0, 3.5, 0.36], [0, 3.49, 0.54], [0, 3.44, 0.72], [0, 3.39, 0.83]], [0.058, 0.048, 0.03, 0.01], 16), [0.86, 1, 1]), STRIPE, { k: 0.018, ck: 0.012 });
  const EYES = [1, -1].map((side) => onSurface(headField, [side * 0.28, 3.67, 0.27], -0.008));
  EYES.forEach((e) => s.sub(sphereP(e, 0.042), lin(0x07080a), { k: 0.008, ck: 0.01 }));
  // A soft undulation, so the coat is not a plastic egg. Low: this is an animal built to shed water.
  s.map((d, x, y, z) => (d > 0.1 || d < -0.1 ? d : d + 0.006 * Math.sin(y * 9 + x * 4) * Math.sin(z * 8 + x * 6)), [-1.2, 0.3, -1.2, 1.2, 3.1, 1.2]);

  // --- The paint. The whole likeness is where these three lines fall -----------------------------
  // The edge of the white front, as a bearing from straight ahead, by height. It narrows upward, and
  // a black spur comes forward from the back at the flipper's root.
  const frontLimit = hermiteTable([0.2, 0.9, 1.6, 2.2, 2.6, 2.95, 3.25], [2.4, 2.12, 1.86, 1.68, 1.5, 1.36, 1.3]);
  const edge = (x, y, z) => {
    const bearing = Math.abs(Math.atan2(x, z - trunk.centre(y)));
    const spur = 0.46 * Math.exp(-(((y - 2.62) / 0.11) ** 2));
    return (bearing - (frontLimit(y) - spur)) * Math.max(0.18, Math.hypot(x, z - trunk.centre(y)));
  };
  const hoodLine = (x, y, z) => {
    const bearing = Math.abs(Math.atan2(x, z - 0.1));
    return y - (3.1 + 0.05 * Math.cos(bearing * 2));
  };
  const paint = (x, y, z, nx, ny, nz, rgb) => {
    const isSkin = y < 3.98 && z < 0.5;
    if (!isSkin) return;
    const big = smoothNoise3(x * 3, y * 3, z * 3);
    const front = 1 - sstep(edge(x, y, z), -0.012, 0.012);
    // The cape: blue-grey down the back, going black where it meets the white.
    const cape = [mix(BLACK[0], BACK[0], 0.35 + big * 0.9), mix(BLACK[1], BACK[1], 0.35 + big * 0.9), mix(BLACK[2], BACK[2], 0.35 + big * 0.9)];
    const nearEdge = 1 - sstep(edge(x, y, z), 0.01, 0.14);
    cape[0] = mix(cape[0], BLACK[0], nearEdge); cape[1] = mix(cape[1], BLACK[1], nearEdge); cape[2] = mix(cape[2], BLACK[2], nearEdge);
    rgb[0] = mix(cape[0], WHITE[0], front); rgb[1] = mix(cape[1], WHITE[1], front); rgb[2] = mix(cape[2], WHITE[2], front);
    // Pale yellow fading down the upper chest, only on the white.
    const chest = sstep(y, 2.2, 3.0) * front;
    mixInto(rgb, PALE, chest * 0.92);
    // The black hood, whose line runs clean across the throat.
    const hood = sstep(hoodLine(x, y, z), -0.012, 0.012);
    rgb[0] = mix(rgb[0], BLACK[0], hood); rgb[1] = mix(rgb[1], BLACK[1], hood); rgb[2] = mix(rgb[2], BLACK[2], hood);
    // The ear patches: bold gold behind the eye, curving down the side of the neck and into the chest.
    const side = Math.abs(x);
    const bearing = Math.abs(Math.atan2(x, z - 0.08));
    const dy = (y - 3.2) / 0.23; const db = (bearing - 1.5) / 0.46;
    const blob = 1 - sstep(dy * dy + db * db, 0.55, 1.25);
    const dy2 = (y - 2.98) / 0.3; const db2 = (bearing - 1.02) / 0.34;
    const tail = 1 - sstep(dy2 * dy2 + db2 * db2, 0.25, 1.35);
    if (side > 0.02) mixInto(rgb, GOLD, Math.max(blob, tail * 0.82 * front * (1 - hood * 0.8)));
    const m = 0.94 + 0.12 * smoothNoise3(x * 8, y * 8, z * 8);
    rgb[0] *= m; rgb[1] *= m; rgb[2] *= m;
  };
  const snap = (x, y, z) => {
    const a = edge(x, y, z); const c = hoodLine(x, y, z);
    return Math.abs(a) < Math.abs(c) ? a : c;
  };
  const bodyGeo = boxUV(polygonize(s, { tint: paint, snap, uvScale: 1, extraReach: 0.03 }), 2.6);
  const parts = [{ geometry: bodyGeo, keepColor: true }];

  // --- Flippers: flat stiff blades, black outside and white inside ----------------------------------
  const flipper = solidSurface({
    nu: 6, nv: 20,
    point: (u, v) => {
      const U = u * 2 - 1;
      const w = 0.2 * Math.min(1, (v / 0.08) ** 0.5) * (1 - 0.5 * v) * Math.sqrt(Math.max(0.002, 1 - v ** 6)) + 0.02;
      const y = 2.84 - 1.42 * v;
      // Hung against the body's own side, which is the only way it can be seen at all.
      const x = trunk.width(y) - 0.05 + 0.16 * sstep(v, 0, 0.3) + 0.06 * v;
      const z = -0.02 + U * w - 0.1 * v;
      return [x, y, z];
    },
    thick: (u, v) => 0.034 * (1 - (u * 2 - 1) ** 4) * (1 - 0.65 * v) + 0.002,
  });
  {
    const half = flipper.attributes.position.count / 2;
    const OUTER = lin(0x12151a); const INNER = lin(0xdedbd0);
    tintVertices(flipper, (x, y, z, out, i) => {
      const c = i < half ? OUTER : INNER;
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
  }
  parts.push({ geometry: flipper, keepColor: true });
  parts.push({ geometry: mirrorX(flipper), keepColor: true });

  // The tail: a short brush of stiff black feathers that the bird leans back on.
  for (let i = 0; i < 9; i++) {
    const f = (i - 4) / 4;
    const root = [f * 0.13, 0.62 - Math.abs(f) * 0.04, -0.54];
    const d = new THREE.Vector3(f * 0.32, -0.92, -0.62).normalize();
    const n = new THREE.Vector3(0, 0.4, -1); n.addScaledVector(d, -n.dot(d)).normalize();
    const g = placeFeather(featherGeo(0.66, 0.13, { nu: 2, nv: 4, shape: 'lance', th: 0.012 }), root, d, n);
    parts.push({ geometry: g, color: 0x0f1216 });
  }

  // --- Feet: one sculpted, mirrored for the other ----------------------------------------------------
  const FOOT = lin(0x17161a);
  const fs = new Sculpt(0.03);
  const FX = 0.3;
  fs.add(curveP([[FX, 0.44, 0.04], [FX, 0.16, 0.12]], [0.21, 0.14], 6), FOOT);
  fs.add(squash(ellipsoidP([FX, 0.1, 0.22], [0.2, 0.1, 0.28]), [1, 1, 1]), FOOT, { k: 0.1 });
  const TOES = [[-0.26, 0.92], [0.02, 1.0], [0.3, 0.92]];
  const tipsAt = [];
  TOES.forEach(([a, l]) => {
    const tip = [FX + Math.sin(a) * l * 0.82, 0.05, 0.22 + Math.cos(a) * l * 0.82];
    fs.add(curveP([[FX + Math.sin(a) * 0.1, 0.1, 0.26], [FX + Math.sin(a) * l * 0.42, 0.085, 0.22 + Math.cos(a) * l * 0.42], tip], [0.075, 0.062, 0.048], 8), FOOT, { k: 0.05 });
    tipsAt.push({ tip, a });
  });
  // The web between the toes.
  fs.add(ellipsoidP([FX, 0.045, 0.56], [0.27, 0.042, 0.36]), lin(0x1f1d20), { k: 0.05 });
  // Rough scutes.
  fs.map((d, x, y, z) => (d > 0.05 || d < -0.05 ? d : d + 0.0035 * Math.sin(x * 62) * Math.sin(z * 56)), [-1, 0, -1, 1, 0.3, 1.2]);
  fs.sub(boxP([0, -1, 0], [2, 1, 2]));
  const foot = boxUV(polygonize(fs, { uvScale: 3, extraReach: 0.02 }), 3.1);
  parts.push({ geometry: foot, keepColor: true });
  parts.push({ geometry: mirrorX(foot), keepColor: true });
  const claws = [];
  for (const side of [1, -1]) {
    tipsAt.forEach(({ tip, a }) => {
      const base = [side * tip[0], tip[1], tip[2]];
      const dir = [side * Math.sin(a), 0, Math.cos(a)];
      claws.push({ geometry: tube([[base[0] - dir[0] * 0.03, 0.055, base[2] - dir[2] * 0.03], [base[0] + dir[0] * 0.06, 0.05, base[2] + dir[2] * 0.06], [base[0] + dir[0] * 0.13, 0.012, base[2] + dir[2] * 0.13]], [0.038, 0.028, 0.002], { sides: 7, steps: 7, round: 0 }), color: 0x0a0a0c });
    });
  }

  // --- The chick, on the parent's feet ---------------------------------------------------------------
  // It keeps its feet up off the ice, which is the whole reason a chick stands there.
  const DOWN = lin(0xa9adb3); const DOWN2 = lin(0x8d9198); const CAP = lin(0x101114); const MASK = lin(0xe9e6dd);
  const c = new Sculpt(0.03);
  const CZ = 0.98;
  c.add(ellipsoidP([0, 0.54, CZ], [0.35, 0.4, 0.32], [-0.14, 0, 0]), DOWN);
  c.add(ellipsoidP([0, 0.82, CZ + 0.02], [0.26, 0.26, 0.25]), DOWN, { k: 0.14 });
  const HY = 1.12; const HZ = CZ + 0.05;
  c.add(sphereP([0, HY, HZ], 0.205), DOWN, { k: 0.08 });
  const chickHead = c.snapshot();
  c.add(squash(curveP([[0, HY - 0.015, HZ + 0.18], [0, HY - 0.03, HZ + 0.27], [0, HY - 0.05, HZ + 0.33]], [0.04, 0.026, 0.007], 8), [0.84, 1, 1]), CAP, { k: 0.02, ck: 0.012 });
  const chickEyes = [1, -1].map((side) => onSurface(chickHead, [side * 0.16, HY + 0.05, HZ + 0.15], -0.006));
  chickEyes.forEach((e) => c.sub(sphereP(e, 0.026), lin(0x050507), { k: 0.006, ck: 0.006 }));
  for (const side of [1, -1]) {
    // Stubby flippers, and small dark feet resting on the parent's toes.
    c.add(squash(curveP([[side * 0.26, 0.76, CZ], [side * 0.37, 0.56, CZ + 0.02], [side * 0.4, 0.42, CZ + 0.03]], [0.08, 0.07, 0.04], 8), [0.8, 1, 1.15], [side * 0.3, 0.6, CZ]), DOWN2, { k: 0.08 });
    c.add(ellipsoidP([side * 0.15, 0.17, CZ + 0.12], [0.1, 0.055, 0.17]), lin(0x1c1b1f), { k: 0.08, ck: 0.05 });
  }
  // Soft clumps of down, which are the fluff in its outline.
  c.map((d, x, y, z) => (d > 0.08 || d < -0.08 ? d : d + 0.012 * Math.sin(x * 21 + y * 11) * Math.sin(z * 19 + y * 15)), [-0.6, 0.2, 0.5, 0.6, 1.4, 1.5]);
  c.sub(boxP([0, -0.9, 0], [1, 1, 3]));
  const chickPaint = (x, y, z, nx, ny, nz, rgb) => {
    if (rgb[0] < 0.08 && rgb[1] < 0.08) return;
    const n = smoothNoise3(x * 7, y * 7, z * 7);
    rgb[0] = mix(DOWN2[0], DOWN[0], n); rgb[1] = mix(DOWN2[1], DOWN[1], n); rgb[2] = mix(DOWN2[2], DOWN[2], n);
    // The head: a black cap and throat with a white mask round each eye.
    if (y > HY - 0.22) {
      const dx = Math.abs(x) - 0.105; const dy = y - (HY + 0.02); const dz = z - (HZ + 0.12);
      const mask = 1 - sstep(Math.hypot(dx / 0.13, dy / 0.13, dz / 0.15), 0.8, 1.1);
      const blackHead = sstep(y, HY - 0.2, HY - 0.15);
      mixInto(rgb, CAP, blackHead);
      mixInto(rgb, MASK, mask);
    }
  };
  const chickGeo = polygonize(c, { tint: chickPaint, uvScale: 2, extraReach: 0.02 });
  const chickUv = boxUV(chickGeo, 3.4);
  parts.push({ geometry: chickUv, keepColor: true });
  // Tufts of down standing off the surface, soft-edged, thin and many.
  const rng = seededRandom(1845);
  const dir = new THREE.Vector3(); const nrm = new THREE.Vector3();
  scatterOn(chickGeo, 0.066, rng, (x, y, z, nx, ny, nz) => {
    if (y > HY - 0.2) return;
    if (y < 0.22) return;
    nrm.set(nx, ny, nz);
    dir.set(0, -0.7, -0.15).addScaledVector(nrm, 0.65);
    dir.normalize();
    const n2 = nrm.clone().addScaledVector(dir, -nrm.dot(dir)).normalize();
    const L = 0.085 + rng() * 0.055;
    const g = lockGeo([x - nx * 0.01, y - ny * 0.01, z - nz * 0.01], dir.clone(), n2, L, 0.06 + rng() * 0.03, { nv: 2, lift: 0.1, droop: 0.15, th: 0.006 });
    const light = mix(0.17, 0.27, rng());
    tintVertices(g, (px, py, pz, out) => { out[0] = light; out[1] = light * 1.02; out[2] = light * 1.08; });
    parts.push({ geometry: g, keepColor: true });
  });

  // --- Eyes ------------------------------------------------------------------------------------------
  const glossy = [...claws];
  EYES.forEach((e) => {
    const side = Math.sign(e[0]);
    glossy.push({ geometry: new THREE.SphereGeometry(0.04, 14, 10), color: 0x241209, position: [e[0], e[1], e[2]] });
    glossy.push({ geometry: new THREE.SphereGeometry(0.009, 6, 4), color: 0xffffff, position: [e[0] + side * 0.03, e[1] + 0.018, e[2] + 0.016] });
  });
  chickEyes.forEach((e) => {
    const side = Math.sign(e[0]);
    glossy.push({ geometry: new THREE.SphereGeometry(0.026, 12, 8), color: 0x0b0a0c, position: [e[0], e[1], e[2]] });
    glossy.push({ geometry: new THREE.SphereGeometry(0.007, 6, 4), color: 0xffffff, position: [e[0] + side * 0.018, e[1] + 0.012, e[2] + 0.014] });
  });

  const map = penguinFeatherMap(1846);
  const root = new THREE.Group();
  root.name = 'emperor-penguin';
  root.add(mesh(mergeParts(parts), standard({ vertexColors: true, map, bumpMap: map, bumpScale: 0.4, roughness: 0.5, metalness: 0 })));
  root.add(mesh(mergeParts(glossy), standard({ vertexColors: true, roughness: 0.16, metalness: 0 })));
  return root;
}

export const BUILDERS = {
  'bald-eagle': baldEagle,
  'emperor-penguin': emperorPenguin,
  stegosaurus,
  'woolly-mammoth': woollyMammoth,
  'flower-anatomy': flowerAnatomy,
  'plant-cell': plantCell,
  'tree-trunk-section': treeTrunkSection,
};
