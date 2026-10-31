import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, standard, canvasTexture, seededRandom } from '../../PropKit.js';
import { mergeParts, extrudeOutline, solidSurface } from '../../props/LoftKit.js';
import {
  Sculpt, polygonize, sphereP, ellipsoidP, segsP, tube, lin, clamp01, mix, sstep, alongMatrix, tintVertices, signedVolume,
} from '../ModelKit.js';

// The Model Database's second Space family: Saturn, the Hubble Space Telescope, a Voyager probe, and
// three Earth science blocks (rock layers, a plate boundary, the water cycle). Authored in feet,
// origin at the base centre, front toward +Z. Everything a student reads off these models is painted
// per texel from the same functions the geometry is built from, so a painted edge and a solid edge
// cannot disagree.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const bytes = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

// ---------------------------------------------------------------------------------------------
// Painting. A canvas holds sRGB bytes, so colours here are written as they should appear.
// ---------------------------------------------------------------------------------------------
function paintTexels(ctx, w, h, fn) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const out = [0, 0, 0, 255];
  let o = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[3] = 255;
      fn(x, y, out);
      d[o++] = out[0]; d[o++] = out[1]; d[o++] = out[2]; d[o++] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Value noise on a lattice that wraps, so anything painted with it tiles, and much faster per texel
// than a hashed 3D noise. x and y are in lattice cells.
function latticeNoise(seed, n = 64) {
  const rng = seededRandom(seed);
  const L = new Float32Array(n * n);
  for (let i = 0; i < L.length; i++) L[i] = rng();
  return (x, y) => {
    const xi = Math.floor(x); const yi = Math.floor(y);
    let fx = x - xi; let fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % n) + n) % n; const y0 = ((yi % n) + n) % n;
    const x1 = (x0 + 1) % n; const y1 = (y0 + 1) % n;
    const a = L[x0 + y0 * n]; const b = L[x1 + y0 * n];
    const c = L[x0 + y1 * n]; const d = L[x1 + y1 * n];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
const fbm2 = (noise, x, y) => noise(x, y) * 0.62 + noise(x * 2.03 + 7.1, y * 2.03 + 3.3) * 0.38;

const blend = (out, c, t) => {
  out[0] += (c[0] - out[0]) * t; out[1] += (c[1] - out[1]) * t; out[2] += (c[2] - out[2]) * t;
};
const shade = (out, k) => { out[0] *= k; out[1] *= k; out[2] *= k; };

function dataTexture(texture) { texture.colorSpace = THREE.NoColorSpace; return texture; }

function wrapRepeat(texture, rx = 1, ry = 1) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(rx, ry);
  return texture;
}

// Text measured to fit a width, in a real font. Ordinary letters only.
function fitFont(ctx, text, maxWidth, size, weight = '700', family = 'Arial, Helvetica, sans-serif') {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  const width = ctx.measureText(text).width;
  if (width > maxWidth) { s = (s * maxWidth) / width; ctx.font = `${weight} ${s}px ${family}`; }
  return s;
}

// ---------------------------------------------------------------------------------------------
// Solids
// ---------------------------------------------------------------------------------------------

// A solid of revolution about +Y with UVs under the caller's control, written bottom-up, axis to
// axis. Its corners stay crisp and its seam is welded, because toCreasedNormals joins by position.
function turned(profile, segments, { uTiles = 1, vScale = 1, crease = 28, vFn = null, start = 0 } = {}) {
  const n = profile.length;
  const pos = [];
  const uv = [];
  const idx = [];
  const ring = segments + 1;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const [r, y] = profile[i];
    if (i) s += Math.hypot(r - profile[i - 1][0], y - profile[i - 1][1]);
    for (let j = 0; j <= segments; j++) {
      const a = start + (j / segments) * TAU;
      pos.push(r * Math.sin(a), y, r * Math.cos(a));
      uv.push((j / segments) * uTiles, vFn ? vFn(r, y, s, i) : s * vScale);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * ring + j; const b = a + 1; const d = a + ring; const c = d + 1;
      if (profile[i][0] > 1e-5) idx.push(a, b, c);
      if (profile[i + 1][0] > 1e-5) idx.push(a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return toCreasedNormals(g, crease * DEG);
}

// A straight round bar between two points with rounded ends. r may be [r0, r1].
function rod(a, b, r, sides = 8, round = 1) {
  return tube([a, b], r, { straight: true, steps: 1, sides, round });
}

// A square-section beam between two points, with its depth along `up`.
function beam(a, b, w, h, up = [0, 1, 0]) {
  const { m, len } = alongMatrix(a, b, up);
  const g = new THREE.BoxGeometry(w, h, len);
  g.translate(0, 0, len / 2);
  g.applyMatrix4(m);
  return g;
}

// A closed slab between two matching grids, with faces that stay flat at their rims: a door on a
// curved shell, a panel, an arrow. Consistently wound by construction and turned outward by measuring.
function gridSolid(nu, nv, top, bottom, { uvTop = null, uvBottom = null, crease = 30 } = {}) {
  const pos = [];
  const uvs = [];
  const tri = (a, b, c) => {
    for (const v of [a, b, c]) { pos.push(v.p[0], v.p[1], v.p[2]); uvs.push(v.uv[0], v.uv[1]); }
  };
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
  const T = (i, j) => ({ p: top(i, j), uv: uvTop ? uvTop(i, j) : [0, 0] });
  const B = (i, j) => ({ p: bottom(i, j), uv: uvBottom ? uvBottom(i, j) : (uvTop ? uvTop(i, j) : [0, 0]) });
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      quad(T(i, j), T(i + 1, j), T(i + 1, j + 1), T(i, j + 1));
      quad(B(i, j + 1), B(i + 1, j + 1), B(i + 1, j), B(i, j));
    }
    quad(T(i, 0), B(i, 0), B(i + 1, 0), T(i + 1, 0));
    quad(T(i, nv), T(i + 1, nv), B(i + 1, nv), B(i, nv));
  }
  for (let j = 0; j < nv; j++) {
    quad(T(0, j), T(0, j + 1), B(0, j + 1), B(0, j));
    quad(T(nu, j), B(nu, j), B(nu, j + 1), T(nu, j + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  // Which way round it came out depends on the handedness of the caller's (i, j): measured here.
  if (signedVolume(g) < 0) {
    for (const [array, size] of [[pos, 3], [uvs, 2]]) {
      for (let t = 0; t < array.length; t += size * 3) {
        for (let k = 0; k < size; k++) {
          const a = t + size + k; const b = t + size * 2 + k;
          const v = array[a]; array[a] = array[b]; array[b] = v;
        }
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }
  return toCreasedNormals(g, crease * DEG);
}

// A flat label card with its printed face on +Z, in the plane of a cut face.
function labelCard(cx, cy, z, w, h, depth, [u0, v0, u1, v1]) {
  return gridSolid(1, 1,
    (i, j) => [cx + (i - 0.5) * w, cy + (j - 0.5) * h, z + depth],
    (i, j) => [cx + (i - 0.5) * w, cy + (j - 0.5) * h, z - 0.03],
    { uvTop: (i, j) => [mix(u0, u1, i), mix(v0, v1, j)], uvBottom: () => [u0 + 0.002, v0 + 0.002] });
}

// An arrow lying in a plane: a shaft and a head with a real thickness and a bevel. Used on the cut
// faces, and for what a student reads from across a room, so it is built to be seen rather than kept thin.
function flatArrow(from, to, width, thick, facing = [0, 0, 1], headLen = null) {
  const A = V(...from);
  const B = V(...to);
  const T = B.clone().sub(A);
  const L = T.length();
  T.normalize();
  const F = V(...facing).normalize();
  const N = F.clone().cross(T).normalize();
  const hl = headLen ?? width * 1.5;
  const stations = [[0, width / 2], [L - hl, width / 2], [L - hl, width], [L, 0.0012]];
  const cols = [-1, -0.72, 0.72, 1];
  const at = (i, j, lift) => {
    const [s, w] = stations[i];
    const p = A.clone().addScaledVector(T, s).addScaledVector(N, cols[j] * w).addScaledVector(F, lift);
    return [p.x, p.y, p.z];
  };
  return gridSolid(3, 3,
    (i, j) => at(i, j, j === 0 || j === 3 ? thick * 0.55 : thick),
    (i, j) => at(i, j, -0.04),
    { crease: 25 });
}

// ===========================================================================================
// SATURN
// ===========================================================================================

// Latitude bands, south to north, muted the way Saturn's are: butterscotch and cream over a pale
// equator, going grey-blue toward the north pole.
const SATURN_BANDS = [
  [-90, 0x7c6a4c], [-80, 0x8f7a54], [-72, 0xb0935f], [-64, 0x9c7c4c], [-57, 0xc1a36c], [-49, 0xa27f4a], [-42, 0xc8aa72],
  [-35, 0xab874f], [-28, 0xd3b882], [-21, 0xb39059], [-14, 0xdcc48e], [-6, 0xe7d4a4], [3, 0xe9d8aa], [10, 0xd0b079],
  [16, 0xb48f56], [23, 0xd9c08a], [30, 0xa9854e], [37, 0xcdb07a], [44, 0xa17f4b], [51, 0xc1a771], [58, 0x9a7f52],
  [65, 0xa79872], [72, 0x8f9486], [79, 0x6f8894], [90, 0x577a92],
];

function paintSaturnGlobe(ctx, w, h) {
  const table = [];
  const rng = seededRandom(6201);
  // Fine striping that belongs to a latitude, not to a texel: most of what makes a band read as cloud.
  const fine = new Float32Array(720);
  let run = 0;
  for (let i = 0; i < fine.length; i++) {
    if (i % 3 === 0) run = run * 0.6 + (rng() - 0.5) * 0.11;
    fine[i] = run;
  }
  for (let i = 0; i < 720; i++) {
    const lat = -90 + i / 4;
    let k = 0;
    while (k < SATURN_BANDS.length - 2 && lat > SATURN_BANDS[k + 1][0]) k++;
    const [la, ca] = SATURN_BANDS[k];
    const [lb, cb] = SATURN_BANDS[k + 1];
    const t = sstep(lat, mix(la, lb, 0.22), mix(la, lb, 0.78));
    const A = bytes(ca); const B = bytes(cb);
    const f = 1 + fine[i];
    table.push([mix(A[0], B[0], t) * f, mix(A[1], B[1], t) * f, mix(A[2], B[2], t) * f]);
  }
  const noise = latticeNoise(3301, 64);
  const storms = [[-34, 2.1, 3.0, 9, 0.32], [31, 4.7, 2.2, 6.5, 0.22], [8, 0.9, 1.7, 7.5, 0.2], [-14, 5.4, 1.5, 4.5, 0.18]];
  const pale = bytes(0xf3e6c4);
  const hexDark = bytes(0x4d6f88);
  const hexEdge = bytes(0x7fa0ad);
  paintTexels(ctx, w, h, (x, y, out) => {
    const fu = x / w;
    const lat0 = 90 - ((y + 0.5) / h) * 180;
    const lon = fu * TAU;
    // Zonal winds shear everything sideways, so the wander is long in longitude and short in latitude.
    const nx = fu * 16;
    const ny = (lat0 + 90) * 0.42;
    const wander = (fbm2(noise, nx, ny) - 0.5) * 2.4 + (noise(fu * 48, ny * 2.6) - 0.5) * 0.7;
    const lat = lat0 + wander * Math.cos(lat0 * DEG);
    const c = table[Math.max(0, Math.min(719, Math.round((lat + 90) * 4 - 0.5)))];
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    const mottle = 1 + (noise(fu * 96, ny * 5.1) - 0.5) * 0.05;
    shade(out, mottle);
    for (const [sl, so, dl, dw, a] of storms) {
      let dlon = (lon - so) / DEG;
      dlon = ((dlon + 540) % 360) - 180;
      const d = (lat0 - sl) ** 2 / (dl * dl) + (dlon * Math.cos(sl * DEG)) ** 2 / (dw * dw);
      if (d < 1) blend(out, pale, a * (1 - d));
    }
    // The hexagonal jet stream round the north pole.
    if (lat0 > 70) {
      const r = 90 - lat0;
      const sect = (((lon + 0.4) % (TAU / 6)) + TAU / 6) % (TAU / 6);
      const edge = 12.5 / Math.cos(sect - TAU / 12);
      const inside = sstep(edge - r, -0.5, 0.5);
      blend(out, hexDark, inside * 0.55);
      blend(out, hexEdge, (1 - Math.min(1, Math.abs(r - edge) / 1.1)) * 0.6);
    }
  });
}

// Radii in Saturn radii, from the published ring boundaries. The D ring is left out: it is so faint
// that a painted one reads as a mistake.
const RING = { in: 1.239, c: 1.527, bMid: 1.64, b: 1.951, cassini: 2.027, a: 2.269, encke: 2.214, f: 2.326, out: 2.345 };

function paintSaturnRings(ctx, w, h, shadowAngle) {
  const rng = seededRandom(1610);
  const ringlets = new Float32Array(w);
  for (let n = 0; n < 240; n++) {
    const at = Math.floor(rng() * w);
    const len = 1 + Math.floor(rng() * rng() * 40);
    const v = (rng() - 0.5) * 0.28;
    for (let i = at; i < Math.min(w, at + len); i++) ringlets[i] += v;
  }
  const profile = [];
  const cC = bytes(0x7a6f60); const cBi = bytes(0xa89878); const cB = bytes(0xd2c09a);
  const cCas = bytes(0x2a2622); const cA = bytes(0xa59880);
  for (let i = 0; i < w; i++) {
    const rho = mix(RING.in, RING.out, (i + 0.5) / w);
    let c; let alpha;
    if (rho < RING.c) {
      const t = (rho - RING.in) / (RING.c - RING.in);
      c = cC; alpha = mix(0.34, 0.62, t);
    } else if (rho < RING.bMid) {
      c = cBi; alpha = 0.97;
    } else if (rho < RING.b) {
      c = cB; alpha = 1;
    } else if (rho < RING.cassini) {
      c = cCas; alpha = 0.26;
    } else if (rho < RING.a) {
      c = cA; alpha = 0.93;
      if (Math.abs(rho - RING.encke) < 0.0065) { c = cCas; alpha = 0.3; }
    } else if (Math.abs(rho - RING.f) < 0.006) {
      c = cA; alpha = 0.7;
    } else {
      c = cCas; alpha = 0;
    }
    const k = 1 + ringlets[i];
    const fade = rho < RING.in + 0.012 ? (rho - RING.in) / 0.012 : 1;
    profile.push([Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k), alpha * Math.max(0.1, fade) * (0.92 + 0.08 * Math.min(1.2, k))]);
  }
  // The planet's shadow: a cylinder of radius 1 down-sun cuts the ring plane in an ellipse. The sun
  // stands BETA above that plane, which is what makes the shadow's far end a curve, not a straight cut.
  const BETA = 13 * DEG;
  const sinB = Math.sin(BETA);
  const sx = Math.sin(shadowAngle); const sz = Math.cos(shadowAngle);
  paintTexels(ctx, w, h, (x, y, out) => {
    const p = profile[x];
    out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; out[3] = Math.min(255, p[3] * 255);
    const rho = mix(RING.in, RING.out, (x + 0.5) / w);
    const a = (1 - (y + 0.5) / h) * TAU;
    const px = rho * Math.sin(a); const pz = rho * Math.cos(a);
    const along = px * sx + pz * sz;
    if (along > 0) {
      const across = px * sz - pz * sx;
      const d = Math.sqrt(across * across + (along * sinB) ** 2);
      const dark = 1 - sstep(d, 0.965, 1.035);
      if (dark > 0) { const k = 1 - dark * 0.8; out[0] *= k; out[1] *= k; out[2] *= k; }
    }
  });
}

// A thin disc with a real edge. u runs out across the rings and v round them. BOTH broad faces carry
// the normal of the lit face: a real ring lets light through, and this is what keeps the underside
// from going black under a sun that can only ever reach the top.
function ringDisc(rIn, rOut, thick, segments) {
  const pos = []; const nor = []; const uv = []; const idx = [];
  const add = (r, y, a, n, u) => {
    pos.push(r * Math.sin(a), y, r * Math.cos(a));
    nor.push(n[0], n[1], n[2]);
    uv.push(u, a / TAU);
    return pos.length / 3 - 1;
  };
  const strip = (r0, y0, u0, r1, y1, u1, normal) => {
    const base = pos.length / 3;
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * TAU;
      add(r0, y0, a, normal(a), u0);
      add(r1, y1, a, normal(a), u1);
    }
    for (let j = 0; j < segments; j++) {
      const a = base + j * 2; const b = a + 1; const c = a + 2; const d = a + 3;
      idx.push(a, c, d, a, d, b);
    }
  };
  const h = thick / 2;
  const radial = (s) => (a) => [s * Math.sin(a), 0, s * Math.cos(a)];
  // Each strip runs from its first edge to its second with the outside on the left of travel.
  strip(rOut, -h, 0.992, rOut, h, 0.992, radial(1));
  strip(rOut, h, 1, rIn, h, 0, () => [0, 1, 0]);
  strip(rIn, h, 0.006, rIn, -h, 0.006, radial(-1));
  strip(rIn, -h, 0, rOut, -h, 1, () => [0, 1, 0]);
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function buildSaturn() {
  const R = 2.5;
  const FLAT = 0.902; // polar radius over equatorial: Saturn is about a tenth flattened
  const H = 6.35;
  const TILT = 26.7 * DEG;
  // The lean is mostly toward the walk-up, so the rings are open to a student rather than edge-on.
  const LEAN = 62 * DEG;
  const axis = V(Math.sin(TILT) * Math.cos(LEAN), Math.cos(TILT), Math.sin(TILT) * Math.sin(LEAN));
  const q = new THREE.Quaternion().setFromUnitVectors(UP, axis);
  const toWorld = new THREE.Matrix4().compose(V(0, H, 0), q, V(1, 1, 1));

  const globeGeo = new THREE.SphereGeometry(R, 128, 88);
  const gp = globeGeo.attributes.position;
  const gn = globeGeo.attributes.normal;
  for (let i = 0; i < gp.count; i++) {
    const nx = gn.getX(i); const ny = gn.getY(i) / FLAT; const nz = gn.getZ(i);
    const l = Math.hypot(nx, ny, nz) || 1;
    gn.setXYZ(i, nx / l, ny / l, nz / l);
    gp.setY(i, gp.getY(i) * FLAT);
  }
  globeGeo.applyMatrix4(toWorld);
  const globeMap = canvasTexture(1024, 512, paintSaturnGlobe);
  const globe = mesh(globeGeo, standard({ map: globeMap, roughness: 0.86, metalness: 0 }));

  // The shadow falls behind the globe and to the right as seen from the front, where it shows.
  const shadowWorld = V(0.62, 0, -0.78).applyQuaternion(q.clone().invert());
  const shadowAngle = Math.atan2(shadowWorld.x, shadowWorld.z);
  const ringMap = canvasTexture(1024, 512, (ctx, w, h) => paintSaturnRings(ctx, w, h, shadowAngle));
  ringMap.wrapT = THREE.RepeatWrapping;
  const ringGeo = ringDisc(R * RING.in, R * RING.out, 0.05, 256);
  ringGeo.applyMatrix4(toWorld);
  const rings = mesh(ringGeo, standard({
    map: ringMap, transparent: true, alphaTest: 0.03, depthWrite: false, roughness: 0.92, metalness: 0,
    emissive: 0xffffff, emissiveMap: ringMap, emissiveIntensity: 0.16,
  }));
  rings.receiveShadow = false;

  // The stand reaches the south pole from behind and below, on the side where the rings lift away
  // from it, so nothing crosses the ring plane.
  const pole = V(0, H, 0).addScaledVector(axis, -R * FLAT);
  const before = pole.clone().addScaledVector(axis, -1.0);
  const parts = [];
  parts.push({
    geometry: turned([
      [0, 0], [2.7, 0], [2.78, 0.05], [2.78, 0.2], [2.62, 0.26], [2.55, 0.34], [1.9, 0.42], [1.05, 0.5], [0.42, 0.62], [0.26, 0.86], [0, 0.86],
    ], 72, { crease: 30 }),
    color: 0x77523a,
  });
  parts.push({ geometry: turned([[2.74, 0.12], [2.82, 0.12], [2.82, 0.17], [2.74, 0.17]], 72), color: 0xc29a4e });
  const stemPts = [[0, 0.7, 0], [before.x * 0.55, 2.2, before.z * 0.55], [before.x, before.y, before.z], [pole.x + axis.x * 0.25, pole.y + axis.y * 0.25, pole.z + axis.z * 0.25]];
  parts.push({ geometry: tube(stemPts, [0.11, 0.085, 0.07, 0.065], { sides: 14, steps: 48, round: 1 }), color: 0xc29a4e });
  const collar = turned([[0, -0.32], [0.09, -0.32], [0.1, -0.2], [0.17, -0.1], [0.34, 0.02], [0.38, 0.1], [0.3, 0.14], [0, 0.14]], 32, { crease: 40 });
  collar.applyMatrix4(new THREE.Matrix4().compose(pole, q, V(1, 1, 1)));
  parts.push({ geometry: collar, color: 0xb88f46 });
  const stand = mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.42, metalness: 0.22 }));

  const root = new THREE.Group();
  root.add(globe, stand, rings);
  return root;
}

// ===========================================================================================
// HUBBLE SPACE TELESCOPE, authored at true size: 43.5ft long, 14ft across the aft section, 10ft
// across the forward shell, mirror 7.9ft. The tube is really hollow, so a student who walks round
// to the aperture looks down baffles at the mirror.
// ===========================================================================================

// Silver blanket: sheets taped edge to edge, each crinkled its own way. Painted twice from one
// seed, as colour and as bump data, so the creases that catch the light are the ones that are drawn.
function paintHubbleFoil(ctx, w, h, { data = false } = {}) {
  const rng = seededRandom(1990);
  ctx.fillStyle = data ? '#808080' : '#e9ebee';
  ctx.fillRect(0, 0, w, h);
  const cols = 5;
  const rows = 4;
  const cw = w / cols;
  const ch = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tone = rng();
      if (!data) {
        const v = Math.round(208 + tone * 44);
        ctx.fillStyle = `rgb(${v},${v},${Math.min(255, v + 3)})`;
        ctx.fillRect(c * cw, r * ch, cw, ch);
      }
    }
  }
  // Crinkle: pale and dark facets, then fine creases.
  const wrap = (fn) => {
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) { ctx.save(); ctx.translate(dx, dy); fn(); ctx.restore(); }
  };
  const facets = [];
  for (let i = 0; i < 300; i++) {
    const x = rng() * w; const y = rng() * h; const s = 10 + rng() * 42; const a = rng() * TAU;
    const pts = [];
    const n = 3 + Math.floor(rng() * 2);
    for (let k = 0; k < n; k++) {
      const t = a + (k / n) * TAU + (rng() - 0.5) * 0.8;
      pts.push([x + Math.cos(t) * s * (0.6 + rng() * 0.5), y + Math.sin(t) * s * (0.6 + rng() * 0.5)]);
    }
    facets.push({ pts, light: rng() > 0.48, a: 0.1 + rng() * 0.22 });
  }
  const creases = [];
  for (let i = 0; i < 420; i++) {
    const x = rng() * w; const y = rng() * h; const a = rng() * TAU; const len = 6 + rng() * rng() * 46;
    creases.push([x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 0.7 + rng() * 1.3]);
  }
  wrap(() => {
    for (const f of facets) {
      ctx.fillStyle = f.light ? `rgba(255,255,255,${f.a * 1.5})` : `rgba(150,154,162,${f.a * 0.7})`;
      ctx.beginPath();
      f.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
    }
    for (const [x, y, ex, ey, lw] of creases) {
      ctx.lineWidth = lw;
      ctx.strokeStyle = 'rgba(96,100,110,0.55)';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath(); ctx.moveTo(x + 1.1, y + 1.1); ctx.lineTo(ex + 1.1, ey + 1.1); ctx.stroke();
    }
  });
  // Tape along the seams between sheets.
  for (let c = 0; c <= cols; c++) {
    ctx.fillStyle = 'rgba(92,96,104,0.75)'; ctx.fillRect(c * cw - 4, 0, 8, h);
    ctx.fillStyle = 'rgba(250,250,250,0.95)'; ctx.fillRect(c * cw - 2.5, 0, 5, h);
  }
  for (let r = 0; r <= rows; r++) {
    ctx.fillStyle = 'rgba(92,96,104,0.75)'; ctx.fillRect(0, r * ch - 4, w, 8);
    ctx.fillStyle = 'rgba(250,250,250,0.95)'; ctx.fillRect(0, r * ch - 2.5, w, 5);
  }
}

// Solar cells above v = 0.24, and the array's plain back below v = 0.2.
function paintSolarCells(ctx, w, h) {
  const rng = seededRandom(2009);
  const top = h * 0.76;
  ctx.fillStyle = '#8d9299';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#0d1c44';
  ctx.fillRect(0, 0, w, top);
  const cols = 48;
  const rows = 8;
  const cw = w / cols;
  const ch = top / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const l = 31 + rng() * 5;
      ctx.fillStyle = `hsl(${218 + rng() * 8}, ${72 + rng() * 14}%, ${l}%)`;
      ctx.fillRect(c * cw + 1.4, r * ch + 1.4, cw - 2.8, ch - 2.8);
      ctx.fillStyle = 'rgba(200,220,250,0.26)';
      for (let k = 1; k < 3; k++) ctx.fillRect(c * cw + 1.4, r * ch + (k / 3) * ch - 0.5, cw - 2.8, 1);
    }
  }
  // Silver buses every few modules, across and along the array.
  ctx.fillStyle = '#c9ced6';
  for (let c = 0; c <= cols; c += 6) ctx.fillRect(c * cw - 2, 0, 4, top);
  for (let r = 0; r <= rows; r += 4) ctx.fillRect(0, r * ch - 2, w, 4);
  // The back: stiffening bars.
  ctx.fillStyle = '#6f747c';
  for (let c = 0; c <= cols; c += 6) ctx.fillRect(c * cw - 3, top + 8, 6, h - top - 8);
  for (let k = 1; k < 3; k++) ctx.fillRect(0, top + 8 + ((h - top - 8) * k) / 3, w, 5);
}

function buildHubble() {
  const AY = 8.75; // height of the telescope's axis
  const Z0 = -2.6; // the door reaches far forward, so the tube sits a little back of the cradle's centre
  const tubeM = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, AY, Z0);
  const alongZ = (g) => g.applyMatrix4(tubeM);
  const at = (a, r, z) => [r * Math.cos(a), AY + r * Math.sin(a), z + Z0];
  const FOIL_FT = 12;

  // A patch of a cylinder about the telescope's axis: a door, a pad, a saddle lining.
  const arcPatch = (r0, r1, a0, a1, z0, z1, nu = 8, nv = 1) => {
    const ang = (i) => mix(a0, a1, i / nu);
    const zed = (j) => mix(z0, z1, j / nv);
    return gridSolid(nu, nv,
      (i, j) => at(ang(i), r1, zed(j)),
      (i, j) => at(ang(i), r0, zed(j)),
      { uvTop: (i, j) => [(ang(i) * r1) / FOIL_FT, zed(j) / FOIL_FT] });
  };

  const foil = [];
  const struct = [];
  const SILVER = 0xc6cacf;
  const DARK = 0x15171b;
  const STEEL = 0x54616d;
  const RAIL = 0xe2b21e;

  // --- The shell, aft to fore ---------------------------------------------------------------
  const foilTurn = (profile, r, color) => {
    foil.push({
      geometry: alongZ(turned(profile, 96, { uTiles: Math.max(1, Math.round((TAU * r) / FOIL_FT)), vScale: 1 / FOIL_FT, crease: 26 })),
      color,
    });
  };
  // Aft shroud: 14ft across, the wide section that holds the instruments.
  foilTurn([[0, -21.75], [5.6, -21.75], [6.3, -21.62], [6.8, -21.2], [7, -20.7], [7, -10.3], [6.86, -10.15], [0, -10.15]], 7, 0xb6babf);
  // Support systems equipment section: a darker ring under its ten bay doors, then the cone down.
  foilTurn([[0, -10.2], [6.88, -10.2], [6.88, -5.1], [6.6, -5.1], [6.6, -5.85], [0, -5.85]], 6.9, 0x34383d);
  foilTurn([[0, -5.2], [6.88, -5.2], [6.2, -4.75], [5.12, -4.2], [5.05, -3.7], [4.92, -3.7], [4.92, -5.8], [0, -5.8]], 6.2, 0xc2c5ca);
  // Forward shell, 10ft across, with its stiffening bands.
  // (Neither this nor the shield has a cap: the tube is a real tube, and a cap across it is what you
  // would see instead of the mirror.)
  const fwd = [[5.05, -4.2]];
  for (const z of [-1, 2.4, 5.6]) fwd.push([5.05, z - 0.14], [5.11, z - 0.08], [5.11, z + 0.08], [5.05, z + 0.14]);
  fwd.push([5.05, 8.3]);
  foilTurn(fwd, 5.05, SILVER);
  // Light shield, out to the aperture. The profile stops at the rim: its other side is the inner wall.
  const shield = [[5.14, 8.2]];
  for (const z of [10.9, 13.6, 16.3, 19]) shield.push([5.14, z - 0.12], [5.2, z - 0.06], [5.2, z + 0.06], [5.14, z + 0.12]);
  shield.push([5.14, 21.45], [5.25, 21.55], [5.25, 21.75], [4.9, 21.75]);
  foilTurn(shield, 5.14, 0xd2d5d9);

  // Inside the shield: dark wall with knife-edged baffles, which is what stops stray light.
  const inner = [[4.9, 21.75]];
  for (let z = 21.2; z > -3.4; z -= 2.3) inner.push([4.86, z + 0.1], [4.86, z], [4.38, z - 0.04], [4.86, z - 0.12]);
  inner.push([4.7, -5.6], [0, -5.6]);
  // Each knife edge is paler than the wall behind it, or the whole shaft is one flat black hole.
  const innerGeo = turned(inner, 72, { crease: 30 });
  tintVertices(innerGeo, (x, y, z, out) => {
    const rad = Math.hypot(x, z);
    const k = mix(0.2, 0.05, sstep(rad, 4.42, 4.8)) * mix(0.5, 1, sstep(y, -4, 18));
    out[0] = k; out[1] = k * 1.03; out[2] = k * 1.1;
  });
  foil.push({ geometry: alongZ(innerGeo), keepColor: true });

  // The primary mirror, 7.9ft across, with its central baffle. It gets a faint glow of its own
  // because no sunlight reaches it down a shadowed tube, and without one it is a hole.
  const MZ = -5.3; const MR = 3.95;
  const mirrorProfile = [[0.86, MZ + 0.02], [MR, MZ + (MR * MR) / 72]];
  for (let i = 1; i <= 7; i++) { const r = mix(MR, 0.86, i / 7); mirrorProfile.push([r, MZ + (r * r) / 72]); }
  const mirrorGeo = alongZ(turned([[0, MZ - 0.1], [MR + 0.06, MZ - 0.1], [MR + 0.06, MZ + 0.24], ...mirrorProfile.slice(1), [0, MZ + 0.01]], 64, { crease: 20 }));
  struct.push({ geometry: alongZ(turned([[0, MZ], [0.84, MZ], [0.84, MZ + 7], [0.9, MZ + 7.05], [0.9, MZ + 7.2], [0, MZ + 7.2]], 24, { crease: 40 })), color: 0x3a3e45 });
  // The secondary mirror's baffle, held on four thin spider vanes, 16ft ahead of the primary.
  const SZ = MZ + 16;
  struct.push({ geometry: alongZ(turned([[0, SZ], [1.05, SZ], [1.05, SZ + 2.2], [0, SZ + 2.2]], 28, { crease: 40 })), color: 0x4a4f57 });
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * TAU) / 4;
    struct.push({ geometry: beam(at(a, 1.0, SZ + 1.2), at(a, 4.5, SZ + 1.2), 0.05, 0.42, [0, 0, 1]), color: 0x4a4f57 });
  }

  // --- The aperture door, standing open about 105 degrees on a hinge at the top of the rim -----
  const hinge = V(0, AY + 5.3, 21.85 + Z0);
  const doorM = new THREE.Matrix4()
    .makeTranslation(hinge.x, hinge.y, hinge.z)
    .multiply(new THREE.Matrix4().makeRotationX(-105 * DEG))
    .multiply(new THREE.Matrix4().makeTranslation(-hinge.x, -hinge.y, -hinge.z))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, AY, 21.95 + Z0));
  const door = turned([[0, 0], [5.0, 0], [5.22, 0.1], [5.22, 0.2], [5.04, 0.32], [0, 0.32]], 64, { uTiles: 3, vScale: 1 / FOIL_FT, crease: 26 });
  foil.push({ geometry: door.applyMatrix4(doorM), color: 0xd8dade });
  const doorIn = turned([[0, -0.05], [4.75, -0.05], [4.75, 0.04], [0, 0.04]], 48, { crease: 40 });
  struct.push({ geometry: doorIn.applyMatrix4(doorM), color: 0xaeb4bc });
  const doorP = (x, y) => V(x, y, -0.05).applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, 0)).applyMatrix4(
    new THREE.Matrix4().makeTranslation(hinge.x, hinge.y, hinge.z)
      .multiply(new THREE.Matrix4().makeRotationX(-105 * DEG))
      .multiply(new THREE.Matrix4().makeTranslation(-hinge.x, -hinge.y, -hinge.z))
      .multiply(new THREE.Matrix4().makeTranslation(0, AY, 21.95 + Z0)),
  ).toArray();
  for (const [x0, y0, x1, y1] of [[-4.3, 0, 4.3, 0], [0, -4.3, 0, 4.3], [-3, -3, 3, 3], [-3, 3, 3, -3]]) {
    struct.push({ geometry: beam(doorP(x0, y0), doorP(x1, y1), 0.16, 0.16, [0, 0, 1]), color: 0xd0d3d8 });
  }
  // The hinge and its brace, tied into the rim.
  const rimTop = at(Math.PI / 2, 5.2, 21.3);
  const hingeArr = hinge.toArray();
  struct.push({ geometry: rod([-1.5, hingeArr[1], hingeArr[2]], [1.5, hingeArr[1], hingeArr[2]], 0.17, 12), color: 0x8b919a });
  for (const x of [-1.2, 1.2]) {
    struct.push({ geometry: beam([x, rimTop[1] - 0.15, rimTop[2] - 0.7], [x, hingeArr[1], hingeArr[2]], 0.24, 0.16), color: 0x8b919a });
  }
  const doorStrut = doorP(0, 1.8);
  struct.push({ geometry: rod(at(Math.PI / 2, 5.25, 18.6), doorStrut, 0.08, 8), color: 0x8b919a });

  // --- Bay doors -----------------------------------------------------------------------------
  // Ten equipment bays round the ring, each with a handrail: the doors astronauts opened on every
  // servicing visit, and the first thing to look for.
  const BAYS = 10;
  for (let k = 0; k < BAYS; k++) {
    const mid = ((k + 0.5) / BAYS) * TAU + 0.12;
    const half = (TAU / BAYS) * 0.45;
    foil.push({ geometry: arcPatch(6.8, 7.06, mid - half, mid + half, -10.05, -5.2, 5, 1), color: k % 2 ? 0xdcdee1 : 0xc2c6cb });
    struct.push({ geometry: rod(at(mid - half * 0.55, 7.42, -7.6), at(mid + half * 0.55, 7.42, -7.6), 0.07, 6), color: RAIL });
    for (const s of [-0.55, 0.55]) struct.push({ geometry: rod(at(mid + half * s, 7.0, -7.6), at(mid + half * s, 7.45, -7.6), 0.06, 6), color: RAIL });
    // Thermal louvres on every other door.
    if (k % 2 === 0) {
      for (let n = 0; n < 5; n++) {
        const z = -9.5 + n * 0.72;
        struct.push({ geometry: arcPatch(7.02, 7.09, mid - half * 0.34, mid + half * 0.34, z, z + 0.42, 2, 1), color: 0x31353b });
      }
    }
  }
  // Large doors on the aft shroud: the science instrument bays.
  const AFT_DOORS = 4;
  for (let k = 0; k < AFT_DOORS; k++) {
    const mid = Math.PI / 4 + (k / AFT_DOORS) * TAU;
    foil.push({ geometry: arcPatch(6.9, 7.1, mid - 0.56, mid + 0.56, -20.2, -11.2, 12, 1), color: 0xe4e5e4 });
    // Two door leaves, the seam between them, and the latches.
    struct.push({ geometry: arcPatch(7.07, 7.125, mid - 0.018, mid + 0.018, -20.1, -11.3, 1, 1), color: 0x3b3f46 });
    for (const s of [-0.34, 0.34]) {
      struct.push({ geometry: rod(at(mid + s, 7.5, -19), at(mid + s, 7.5, -12.4), 0.08, 6), color: RAIL });
      for (const z of [-19, -15.7, -12.4]) struct.push({ geometry: rod(at(mid + s, 7.05, z), at(mid + s, 7.5, z), 0.06, 6), color: RAIL });
    }
    // A dark white-edged radiator between instrument doors.
    const gap = mid + Math.PI / 4;
    foil.push({ geometry: arcPatch(6.96, 7.04, gap - 0.14, gap + 0.14, -19, -12.4, 4, 1), color: 0x8a8f96 });
  }
  // Long handrails on the forward shell and the light shield.
  const longRail = (a, r, z0, z1) => {
    struct.push({ geometry: rod(at(a, r + 0.42, z0), at(a, r + 0.42, z1), 0.08, 6), color: RAIL });
    const n = Math.max(2, Math.round((z1 - z0) / 3.1));
    for (let i = 0; i <= n; i++) {
      const z = mix(z0, z1, i / n);
      struct.push({ geometry: rod(at(a, r - 0.02, z), at(a, r + 0.44, z), 0.06, 6), color: RAIL });
    }
  };
  for (const a of [0.25, 2.2, 3.6, 5.45]) longRail(a, 5.08, -3.3, 7.8);
  for (const a of [0.55, 2.6, 4.2]) longRail(a, 5.16, 9, 20.4);

  // Star tracker shades and a magnetometer on the forward section, proud and sunk in.
  for (const a of [4.72, 5.1]) {
    struct.push({ geometry: rod(at(a, 4.9, -2.6), at(a, 6.1, -1.3), [0.42, 0.56], 16), color: 0xcfd2d6 });
  }
  for (const s of [-1, 1]) {
    const p = at(Math.PI / 2 + s * 0.48, 5.2, 20.5);
    struct.push({ geometry: new THREE.SphereGeometry(0.38, 14, 8).scale(1, 0.55, 1.4).translate(p[0], p[1], p[2]), color: 0xd6d8db });
  }
  // Trunnions that latch into the shuttle's bay, and grapple fixtures for its arm.
  for (const s of [-1, 1]) {
    struct.push({ geometry: rod([s * 6.9, AY - 0.4, -13.8 + Z0], [s * 8.25, AY - 0.4, -13.8 + Z0], 0.3, 14), color: 0x9a9fa6 });
    struct.push({ geometry: rod([s * 5, AY, -3.2 + Z0 + 6.8], [s * 5.75, AY, -3.2 + Z0 + 6.8], 0.3, 14), color: 0x9a9fa6 });
  }
  // Aft bulkhead: the capture ring added on the last servicing mission, its pins and vents.
  const AFT = -21.75;
  struct.push({ geometry: alongZ(turned([[0, AFT - 0.05], [2.7, AFT - 0.05], [2.7, AFT + 0.02], [0, AFT + 0.02]], 48)), color: 0x6b7078 });
  struct.push({ geometry: alongZ(turned([[2.05, AFT + 0.02], [2.05, AFT - 0.55], [2.5, AFT - 0.55], [2.5, AFT + 0.02]].reverse(), 48)), color: 0xbcc0c6 });
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + (k * TAU) / 3;
    struct.push({ geometry: rod(at(a, 2.28, AFT), at(a, 2.28, AFT - 1.15), [0.17, 0.09], 12), color: 0x8b919a });
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    struct.push({ geometry: beam(at(a, 2.75, AFT - 0.02), at(a, 6.1, AFT - 0.02), 0.09, 0.09, [0, 0, 1]), color: 0x7a7f87 });
  }

  // --- High-gain antennas on masts ------------------------------------------------------------
  // The real masts stand opposite each other; one straight down would go through the cradle, so on
  // display both are swung up, either side of the top.
  const hga = (a, zOn) => {
    const root = at(a, 5.0, zOn);
    const tip = at(a, 16.0, zOn);
    const white = 0xe6e6e2;
    struct.push({ geometry: rod(root, tip, [0.2, 0.13], 10), color: 0xd0a542 });
    for (let i = 1; i < 4; i++) {
      const p = at(a, mix(6.5, 14.5, i / 4), zOn);
      struct.push({ geometry: new THREE.SphereGeometry(0.2, 10, 6).translate(p[0], p[1], p[2]), color: 0x9a9fa6 });
    }
    const R = 2.15;
    const dish = [];
    for (let i = 0; i <= 8; i++) { const r = (i / 8) * R; dish.push([r, (r * r) / 5.4 - 0.1]); }
    const inner2 = [];
    for (let i = 8; i >= 0; i--) { const r = (i / 8) * R * 0.985; inner2.push([r, (r * r) / 5.4]); }
    const q = new THREE.Quaternion().setFromUnitVectors(UP, V(0.12 * Math.sign(Math.cos(a)), 0.2, 0.97).normalize());
    const m = new THREE.Matrix4().compose(V(...tip).add(V(0, 0, 0.2)), q, V(1, 1, 1));
    struct.push({ geometry: turned([...dish, ...inner2], 36, { crease: 50 }).applyMatrix4(m), color: white });
    const hub = V(0, 1.15, 0).applyMatrix4(m).toArray();
    for (let k = 0; k < 3; k++) {
      const ang = (k / 3) * TAU;
      const foot = V(Math.sin(ang) * 1.1, 0.24, Math.cos(ang) * 1.1).applyMatrix4(m).toArray();
      struct.push({ geometry: rod(foot, hub, 0.035, 5), color: 0xb8bcc2 });
    }
    struct.push({ geometry: new THREE.SphereGeometry(0.17, 12, 8).translate(hub[0], hub[1], hub[2]), color: 0xcaa24a });
    struct.push({ geometry: new THREE.SphereGeometry(0.34, 12, 8).translate(tip[0], tip[1], tip[2]), color: 0x9a9fa6 });
  };
  hga(Math.PI / 2 - 0.82, 2.6);
  hga(Math.PI / 2 + 0.82, 2.6);

  // --- Solar arrays -------------------------------------------------------------------------
  // Two rigid wings, each 25ft by 8.2ft, on booms out of the equipment section. Tipped about their
  // own spines to face the walk-up: flat to the sky a wing is a line to anyone standing beside it.
  const WING_Z = -7.6 + Z0;
  const TIP = 58 * DEG;
  const nDir = V(0, Math.cos(TIP), Math.sin(TIP));
  const wDir = V(0, -Math.sin(TIP), Math.cos(TIP));
  const array = [];
  const X0 = 9.6; const X1 = 34.6; const IN = 0.34; const OUT = 4.1; const TH = 0.09;
  for (const s of [-1, 1]) {
    const spine = (x) => V(s * x, AY, WING_Z);
    for (const side of [-1, 1]) {
      const panelAt = (i, j, lift) => {
        const x = i ? X1 : X0;
        const w = j ? OUT : IN;
        const p = spine(x).addScaledVector(wDir, side * w).addScaledVector(nDir, lift);
        return [p.x, p.y, p.z];
      };
      array.push({
        geometry: gridSolid(1, 1,
          (i, j) => panelAt(i, j, TH),
          (i, j) => panelAt(i, j, -TH),
          {
            uvTop: (i, j) => [(i ? 0.995 : 0.005), mix(side > 0 ? 0.62 : 0.62, side > 0 ? 0.995 : 0.245, j)],
            uvBottom: (i, j) => [i ? 0.995 : 0.005, mix(0.01, 0.2, j)],
          }),
        keepColor: true,
      });
      // The frame round each blanket stands a little proud of the cells, so it casts a real edge.
      const f = (x, w) => { const p = spine(x).addScaledVector(wDir, side * w); return [p.x, p.y, p.z]; };
      const up = nDir.toArray();
      struct.push({ geometry: beam(f(X0 - 0.06, OUT + 0.05), f(X1 + 0.06, OUT + 0.05), 0.12, 0.26, up), color: 0xb8bcc3 });
      struct.push({ geometry: beam(f(X0 - 0.06, IN - 0.05), f(X1 + 0.06, IN - 0.05), 0.12, 0.26, up), color: 0xb8bcc3 });
      for (const x of [X0, (X0 * 2 + X1) / 3, (X0 + X1 * 2) / 3, X1]) {
        struct.push({ geometry: beam(f(x, IN), f(x, OUT), 0.1, 0.25, up), color: 0xb8bcc3 });
      }
    }
    // The boom and its spine, one straight bar from the hull to the tip.
    struct.push({ geometry: rod([s * 6.9, AY, WING_Z], [s * (X1 + 0.3), AY, WING_Z], [0.22, 0.12], 12), color: 0xaab0b8 });
    struct.push({ geometry: rod([s * 6.9, AY, WING_Z], [s * 9.2, AY, WING_Z], 0.5, 16), color: 0x9a9fa6 });
    struct.push({ geometry: new THREE.BoxGeometry(1.2, 1.1, 1.1).translate(s * 7.45, AY, WING_Z), color: 0x8b919a });
  }

  // --- The display cradle ---------------------------------------------------------------------
  const saddle = (radius, halfW, zc, depth) => {
    const out = [[-halfW, 0], [halfW, 0], [halfW, AY - Math.sqrt(radius * radius - halfW * halfW)]];
    for (let i = 1; i <= 24; i++) {
      const x = mix(halfW, -halfW, i / 24);
      out.push([x, AY - Math.sqrt(radius * radius - x * x)]);
    }
    const g = extrudeOutline(out, depth);
    g.translate(0, 0, zc);
    return g;
  };
  const AFT_R = 7.16; const FWD_R = 5.22;
  const aftSaddleZ = -16.2 + Z0; const fwdSaddleZ = 1.2 + Z0;
  struct.push({ geometry: saddle(AFT_R, 5.3, aftSaddleZ, 1.6), color: STEEL });
  struct.push({ geometry: saddle(FWD_R, 4.2, fwdSaddleZ, 1.6), color: STEEL });
  // Padded linings, so the shell does not sit on a bare edge.
  const liner = (r0, r1, halfW, zc, depth) => {
    const reach = Math.asin(halfW / r1);
    struct.push({ geometry: arcPatch(r0, r1, -Math.PI / 2 - reach, -Math.PI / 2 + reach, zc - Z0 - depth / 2, zc - Z0 + depth / 2, 22, 1), color: 0x27292d });
  };
  liner(7.0, AFT_R + 0.04, 5.2, aftSaddleZ, 1.8);
  liner(5.05, FWD_R + 0.04, 4.1, fwdSaddleZ, 1.8);
  const frameZ = [-24.6, 22];
  for (const x of [-4.1, 4.1]) {
    struct.push({ geometry: new THREE.BoxGeometry(0.9, 1.05, frameZ[1] - frameZ[0]).translate(x, 0.525, (frameZ[0] + frameZ[1]) / 2), color: 0x3c4650 });
  }
  for (const z of [frameZ[0] + 0.5, aftSaddleZ, -7, fwdSaddleZ, 11, frameZ[1] - 0.5]) {
    struct.push({ geometry: new THREE.BoxGeometry(9.1, 0.8, 0.8).translate(0, 0.42, z), color: 0x3c4650 });
  }
  // Diagonal braces from the frame to the forward saddle, which stands tall.
  for (const s of [-1, 1]) {
    struct.push({ geometry: beam([s * 3.7, 0.9, fwdSaddleZ - 8], [s * 3.5, 5.0, fwdSaddleZ - 0.7], 0.4, 0.4), color: 0x3c4650 });
    struct.push({ geometry: beam([s * 3.7, 0.9, fwdSaddleZ + 8], [s * 3.5, 5.0, fwdSaddleZ + 0.7], 0.4, 0.4), color: 0x3c4650 });
    for (const z of [frameZ[0] + 1, -7, 11, frameZ[1] - 1]) {
      struct.push({ geometry: new THREE.BoxGeometry(1.5, 0.12, 1.5).translate(s * 4.1, 0.06, z), color: 0x2c333a });
    }
  }

  // --- Materials --------------------------------------------------------------------------------
  const foilMap = wrapRepeat(canvasTexture(1024, 1024, (ctx, w, h) => paintHubbleFoil(ctx, w, h)));
  const foilBump = dataTexture(wrapRepeat(canvasTexture(512, 512, (ctx, w, h) => paintHubbleFoil(ctx, w, h, { data: true }))));
  const foilMesh = mesh(mergeParts(foil), standard({ vertexColors: true, map: foilMap, bumpMap: foilBump, bumpScale: 1.4, roughness: 0.3, metalness: 0.2 }));
  const structMesh = mesh(mergeParts(struct), standard({ vertexColors: true, roughness: 0.55, metalness: 0.16 }));
  const cellMap = canvasTexture(1024, 400, paintSolarCells);
  const arrayMesh = mesh(mergeParts(array), standard({ map: cellMap, roughness: 0.52, metalness: 0.1 }));
  const mirror = mesh(mirrorGeo, standard({ color: 0xbfd0df, roughness: 0.24, metalness: 0.2, emissive: 0x6a8aa8, emissiveIntensity: 0.55 }));
  mirror.castShadow = false;
  mirror.receiveShadow = false;

  const root = new THREE.Group();
  root.add(foilMesh, structMesh, arrayMesh, mirror);
  return root;
}

// ===========================================================================================
// VOYAGER, life size. Authored in the spacecraft's own frame, with its dish looking along local +Y
// and the bus at the origin, then tipped as one piece so the big dish opens toward the walk-up. The
// student stands in front of a twelve-foot dish at eye height; the record is on the bus's flank.
// ===========================================================================================

const DISH_R = 6;
const DISH_F = 5.2;
const dishY = (r) => (r * r) / (4 * DISH_F);

// Honeycomb gores and rings on the dish's face. u runs round it, v from the middle (0.04) to the
// rim (1). Below v = 0.03 is plain white for its back.
function paintVoyagerDish(ctx, w, h) {
  ctx.fillStyle = '#f2f2ee';
  ctx.fillRect(0, 0, w, h);
  const rng = seededRandom(1977);
  // Each gore a slightly different white, which is what reads as separate panels.
  const gores = 16;
  for (let k = 0; k < gores; k++) {
    const v = 228 + Math.floor(rng() * 24);
    ctx.fillStyle = `rgb(${v},${v},${v - 4})`;
    ctx.fillRect((k / gores) * w, 0, w / gores, h);
  }
  ctx.fillStyle = 'rgba(92,96,102,0.85)';
  for (let k = 0; k <= gores; k++) ctx.fillRect((k / gores) * w - 1.5, 0, 3, h * 0.985);
  for (const f of [0.26, 0.5, 0.74, 0.96]) ctx.fillRect(0, h * (1 - f) - 1.5, w, 3);
  ctx.fillStyle = 'rgba(92,96,102,0.5)';
  for (let k = 0; k < gores; k++) {
    for (const f of [0.26, 0.5, 0.74]) {
      for (let n = 1; n < 3; n++) {
        const x = ((k + n / 3) / gores) * w;
        ctx.fillRect(x - 0.8, h * (1 - f) - h * 0.08, 1.6, h * 0.16);
      }
    }
  }
}

// The bus's ten flanks in u, gold blanket with tape and crinkle, four of them silver louvres.
function paintVoyagerBus(ctx, w, h) {
  const rng = seededRandom(1610);
  const faces = 10;
  const louvred = new Set([1, 4, 6, 9]);
  for (let k = 0; k < faces; k++) {
    const x0 = (k / faces) * w;
    const fw = w / faces;
    const g = ctx.createLinearGradient(x0, 0, x0 + fw, h);
    g.addColorStop(0, '#f0c75a');
    g.addColorStop(0.5, '#d9a436');
    g.addColorStop(1, '#efc350');
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, fw, h);
    // Crinkle as broad pale and dark facets with a few short creases: long thin lines read as straw.
    for (let i = 0; i < 44; i++) {
      const px = x0 + rng() * fw; const py = rng() * h; const a = rng() * TAU; const l = 6 + rng() * 15;
      ctx.fillStyle = rng() > 0.5 ? 'rgba(255,236,170,0.3)' : 'rgba(150,100,24,0.22)';
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const t = a + (k / 3) * TAU + (rng() - 0.5) * 0.9;
        ctx.lineTo(px + Math.cos(t) * l, py + Math.sin(t) * l);
      }
      ctx.closePath(); ctx.fill();
    }
    for (let i = 0; i < 18; i++) {
      const px = x0 + rng() * fw; const py = rng() * h; const a = rng() * TAU; const l = 3 + rng() * 8;
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = rng() > 0.5 ? 'rgba(120,76,10,0.32)' : 'rgba(255,240,180,0.45)';
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); ctx.stroke();
    }
    if (louvred.has(k)) {
      ctx.fillStyle = '#2b2f36';
      ctx.fillRect(x0 + fw * 0.14, h * 0.16, fw * 0.72, h * 0.68);
      for (let n = 0; n < 8; n++) {
        ctx.fillStyle = n % 2 ? '#dfe2e6' : '#c3c7cd';
        ctx.fillRect(x0 + fw * 0.17 + (n / 8) * fw * 0.66, h * 0.19, (fw * 0.66) / 8 - 3, h * 0.62);
      }
    }
    ctx.fillStyle = 'rgba(130,88,18,0.9)';
    ctx.fillRect(x0 - 2, 0, 4, h);
  }
}

// The record's cover, gold, with what is really engraved on it in spirit: a stylus and record at the
// left, the pulsar map at the lower left, the two-dot hydrogen key at the bottom. Representative
// marks, not an engraving of the real plate.
function paintGoldenRecord(ctx, w, h) {
  const cx = w / 2; const cy = h / 2; const R = w / 2;
  const g = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.2, R * 0.1, cx, cy, R);
  g.addColorStop(0, '#f7da7a'); g.addColorStop(0.6, '#e4ae3a'); g.addColorStop(1, '#c58b1d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 1;
  for (let r = R * 0.22; r < R * 0.97; r += 3.2) {
    ctx.strokeStyle = (r | 0) % 2 ? 'rgba(112,72,8,0.4)' : 'rgba(255,240,180,0.35)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  }
  ctx.fillStyle = '#c9942a';
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.2, 0, TAU); ctx.fill();
  ctx.fillStyle = '#5d3c08';
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.035, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#5d3c08';
  ctx.lineWidth = 2.5;
  // The pulsar map: lines fanning from one point.
  const px = cx - R * 0.46; const py = cy + R * 0.42;
  const rng = seededRandom(14);
  for (let k = 0; k < 14; k++) {
    const a = rng() * TAU; const l = R * (0.1 + rng() * 0.2);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); ctx.stroke();
  }
  // Hydrogen: two circles joined by a line.
  const hx = cx + R * 0.4; const hy = cy + R * 0.58;
  ctx.beginPath(); ctx.arc(hx - R * 0.09, hy, R * 0.045, 0, TAU); ctx.moveTo(hx + R * 0.135, hy); ctx.arc(hx + R * 0.09, hy, R * 0.045, 0, TAU); ctx.moveTo(hx - R * 0.045, hy); ctx.lineTo(hx + R * 0.045, hy); ctx.stroke();
  // A little waveform, and the record seen from above with its stylus.
  ctx.beginPath(); ctx.arc(cx - R * 0.46, cy - R * 0.4, R * 0.16, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - R * 0.74, cy - R * 0.62); ctx.lineTo(cx - R * 0.5, cy - R * 0.5); ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const x = cx + R * 0.26 + (i / 40) * R * 0.44;
    const y = cy - R * 0.42 + Math.sin(i * 0.9) * R * 0.05 * Math.sin((i / 40) * Math.PI);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.stroke();
}

// An open lattice boom between two points, with three longerons and diagonal braces.
function latticeBoom(list, a, b, width, bays, color, up = [0, 1, 0], rodR = 0.028) {
  const { dir, side, up: upV, len } = alongMatrix(a, b, up);
  const A = V(...a);
  const vert = (i, k) => {
    const t = (i / bays) * len;
    const ang = ((k + (i % 2) * 0) / 3) * TAU + Math.PI / 2;
    return A.clone().addScaledVector(dir, t)
      .addScaledVector(side, Math.cos(ang) * width)
      .addScaledVector(upV, Math.sin(ang) * width).toArray();
  };
  for (let k = 0; k < 3; k++) {
    list.push({ geometry: rod(vert(0, k), vert(bays, k), rodR, 5), color });
    for (let i = 0; i < bays; i++) {
      list.push({ geometry: rod(vert(i, k), vert(i + 1, (k + 1) % 3), rodR * 0.8, 4, 0), color });
      list.push({ geometry: rod(vert(i, k), vert(i, (k + 1) % 3), rodR * 0.8, 4, 0), color });
    }
  }
}

function buildVoyager() {
  // Tipped back 60 degrees from pointing straight up. Any less and a student at eye height sees only
  // the dish's back and rim, since it stands well above their head.
  const TIP = 60 * DEG;
  const BUS = V(0, 4.6, 1.0);
  const placeM = new THREE.Matrix4().makeRotationX(TIP).setPosition(BUS);
  const parts = [];    // matte painted structure
  const blanket = [];  // gold bus, with its painted map
  const dishParts = [];
  const WHITE = 0xe2e2dd;
  const GREY = 0x8b9098;
  const SILVER = 0xc4c8cd;
  const GOLD = 0xd9a93a;
  const DARK = 0x5f6268;

  // Bearing round the bus: a is measured from local +Z toward local +X, as `turned` measures it.
  const dirAt = (deg) => [Math.sin(deg * DEG), 0, Math.cos(deg * DEG)];
  const out = (deg, r, y = 0) => { const d = dirAt(deg); return [d[0] * r, y, d[2] * r]; };
  const APO = 2.9;
  const CIRC = APO / Math.cos(18 * DEG);

  // --- The bus: ten sides, 5.8ft across its flats and 1.5ft deep --------------------------------
  const BUSH = 0.75;
  const busGeo = turned([[CIRC, -BUSH], [CIRC, BUSH]], 10, { uTiles: 1, crease: 24, vFn: (r, y) => (y + BUSH) / (2 * BUSH) });
  blanket.push({ geometry: busGeo, keepColor: true });
  // Top and bottom decks, in plain silver, closing the box.
  parts.push({ geometry: turned([[0, -BUSH], [CIRC * 1.0, -BUSH]], 10, { crease: 24 }), color: SILVER });
  parts.push({ geometry: turned([[CIRC * 1.0, BUSH], [0, BUSH]], 10, { crease: 24 }), color: SILVER });
  // Edge rails along the bus's corners, which is what makes a blanket read as wrapped round a frame.
  for (let k = 0; k < 10; k++) {
    const a = k * 36;
    const p = out(a, CIRC + 0.01);
    parts.push({ geometry: rod([p[0], -BUSH, p[2]], [p[0], BUSH, p[2]], 0.05, 6), color: 0x9a9fa6 });
    const q = out(a + 36, CIRC + 0.01);
    for (const y of [-BUSH, BUSH]) parts.push({ geometry: rod([p[0], y, p[2]], [q[0], y, q[2]], 0.05, 6), color: 0x9a9fa6 });
  }

  // --- The propellant tank, hanging below the bus, and its thrusters ----------------------------
  parts.push({ geometry: new THREE.SphereGeometry(1.25, 32, 20).translate(0, -1.25, 0), color: SILVER });
  for (let k = 0; k < 8; k++) {
    const a = 22.5 + k * 45;
    const p = out(a, 2.0, -BUSH - 0.1);
    parts.push({ geometry: rod(p, out(a, 1.05, -1.9), 0.05, 6), color: GREY });
  }
  for (let k = 0; k < 4; k++) {
    const a = 45 + k * 90;
    const p = out(a, 2.4, -BUSH);
    const bell = turned([[0, -0.62], [0.2, -0.62], [0.09, -0.22], [0.1, 0.04], [0, 0.04]], 14, { crease: 40 });
    parts.push({ geometry: bell.translate(p[0], p[1], p[2]), color: 0x6c7077 });
  }

  // --- The dish ---------------------------------------------------------------------------------
  const Y0 = 2.45; // the dish's vertex, above the bus
  const back = [];
  const front = [];
  for (let i = 0; i <= 18; i++) {
    const r = (i / 18) * DISH_R;
    back.push([r, Y0 + dishY(r) - 0.2]);
    front.push([DISH_R - r, Y0 + dishY(DISH_R - r)]);
  }
  const dishGeo = turned([...back, [DISH_R + 0.03, Y0 + dishY(DISH_R) - 0.05], ...front], 96, {
    crease: 40,
    vFn: (r, y, s, i) => (i <= 19 ? 0.012 : 0.04 + 0.95 * (r / DISH_R)),
  });
  dishParts.push({
    geometry: tintVertices(dishGeo, (x, y, z, c) => {
      const rad = Math.hypot(x, z);
      const isBack = y < Y0 + dishY(rad) - 0.1;
      const k = isBack ? 0.74 : 0.86;
      c[0] = k; c[1] = k; c[2] = k * 0.98;
    }),
    keepColor: true,
  });
  // Ribs behind the dish, from the hub to near the rim: a smooth egg from behind without them.
  const RIBS = 16;
  for (let k = 0; k < RIBS; k++) {
    const a = (k * 360) / RIBS;
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const r = mix(1.2, DISH_R - 0.25, i / 8);
      pts.push(out(a, r, Y0 + dishY(r) - 0.28));
    }
    parts.push({ geometry: tube(pts, 0.07, { sides: 6, steps: 16, round: 1 }), color: 0xbcbfc3 });
  }
  for (const r of [2.6, 4.3]) {
    const y = Y0 + dishY(r) - 0.3;
    parts.push({ geometry: turned([[r - 0.06, y - 0.05], [r + 0.06, y - 0.05], [r + 0.06, y + 0.05], [r - 0.06, y + 0.05], [r - 0.06, y - 0.05]], 64, { crease: 40 }), color: 0xbcbfc3 });
  }
  // The conical truss between the bus's top deck and the dish's hub.
  for (let k = 0; k < 10; k++) {
    const a = k * 36;
    parts.push({ geometry: rod(out(a, 2.5, BUSH), out(a + 18, 1.3, Y0 + dishY(1.3) - 0.3), 0.06, 6), color: 0xc8cbcf });
    parts.push({ geometry: rod(out(a + 36, 2.5, BUSH), out(a + 18, 1.3, Y0 + dishY(1.3) - 0.3), 0.06, 6), color: 0xc8cbcf });
  }
  parts.push({ geometry: turned([[0, BUSH], [1.05, BUSH], [0.85, 1.5], [0.85, Y0 + 0.02], [0, Y0 + 0.02]], 24, { crease: 40 }), color: 0xaeb2b8 });

  // The feed horn on the dish's axis, the subreflector above it on three struts.
  const FEED_Y = Y0 + 0.02;
  parts.push({ geometry: turned([[0, FEED_Y], [0.46, FEED_Y], [0.42, FEED_Y + 0.5], [0.38, FEED_Y + 0.95], [0.44, FEED_Y + 1.02], [0.72, FEED_Y + 1.9], [0.64, FEED_Y + 1.93], [0.26, FEED_Y + 1.1], [0, FEED_Y + 1.05]], 28, { crease: 30 }), color: WHITE });
  const SUB_Y = Y0 + 4.05;
  const subBack = [];
  const subFront = [];
  for (let i = 0; i <= 8; i++) {
    const r = (i / 8) * 0.95;
    subBack.push([r, SUB_Y + 0.22 - (r * r) * 0.12]);
    subFront.push([0.95 - r, SUB_Y + 0.03 - ((0.95 - r) ** 2) * 0.12]);
  }
  // Written bottom-up: the reflecting face first, then round the rim to the back.
  parts.push({ geometry: turned([...subFront.slice().reverse(), [0.97, SUB_Y + 0.02], ...subBack.slice().reverse()], 32, { crease: 40 }), color: WHITE });
  for (let k = 0; k < 3; k++) {
    const a = 30 + k * 120;
    const r = 3.2;
    parts.push({ geometry: rod(out(a, r, Y0 + dishY(r) - 0.04), out(a, 0.55, SUB_Y + 0.08), 0.06, 8), color: WHITE });
    parts.push({ geometry: new THREE.SphereGeometry(0.12, 10, 6).translate(...out(a, r, Y0 + dishY(r))), color: 0xbcbfc3 });
  }

  // --- The science boom, along +X, with the scan platform at its end ------------------------------
  const SCI = 90;
  const sciRoot = out(SCI, APO - 0.02, 0.1);
  const sciEnd = out(SCI, 10.6, 0.1);
  latticeBoom(parts, sciRoot, sciEnd, 0.3, 7, 0xb9bdc3, [0, 1, 0], 0.035);
  // Cosmic ray telescope in gold by the bus, then low-energy charged particle, then the plasma cups.
  const inst = (x, y, z, w, h, d, color) => { parts.push({ geometry: new THREE.BoxGeometry(w, h, d).translate(x, y, z), color }); };
  inst(4.2, 0.42, 0, 0.8, 0.42, 0.62, GOLD);
  inst(4.2, 0.68, 0, 0.38, 0.12, 0.38, 0x4a4d52);
  parts.push({ geometry: rod([6.1, 0.05, 0], [6.1, 0.72, 0], 0.3, 16), color: GOLD });
  parts.push({ geometry: turned([[0, 0.7], [0.33, 0.7], [0.24, 0.96], [0, 0.96]], 18, { crease: 36 }).translate(6.1, 0, 0), color: 0xdfe0e2 });
  // The plasma instrument: three big cups in a triangle.
  parts.push({ geometry: new THREE.BoxGeometry(1.0, 0.45, 1.0).translate(7.8, 0.1, 0.2), color: SILVER });
  for (let k = 0; k < 3; k++) {
    const a = k * 120;
    const p = out(a, 0.33, 0.33);
    parts.push({ geometry: turned([[0, 0], [0.26, 0], [0.3, 0.3], [0.24, 0.32], [0.2, 0.08], [0, 0.08]], 18, { crease: 40 }).translate(p[0] + 7.8, p[1], p[2] + 0.2), color: 0x9fa4ab });
  }
  // The scan platform: a turntable, and the cameras a student knows Voyager for.
  const PLAT = [10.9, 0.15, 0];
  parts.push({ geometry: new THREE.BoxGeometry(1.5, 1.0, 1.5).translate(PLAT[0], PLAT[1], PLAT[2]), color: DARK });
  parts.push({ geometry: new THREE.SphereGeometry(0.42, 14, 8).translate(PLAT[0] - 0.68, PLAT[1], PLAT[2]), color: 0x9a9fa6 });
  const AIM = V(0.22, 0.86, 0.46).normalize();
  const instQ = new THREE.Quaternion().setFromUnitVectors(UP, AIM);
  const onPlat = (g, dx, dz) => {
    const m = new THREE.Matrix4().compose(V(PLAT[0] + dx, PLAT[1] + 0.35, PLAT[2] + dz), instQ, V(1, 1, 1));
    return g.applyMatrix4(m);
  };
  const scope = (rA, rB, L, shade2 = WHITE) => turned([[0, 0], [rA, 0], [rA, L * 0.82], [rB, L], [rB * 0.8, L], [rB * 0.8, L - 0.16], [0, L - 0.16]], 22, { crease: 38 });
  parts.push({ geometry: onPlat(scope(0.34, 0.36, 3.1), -0.3, 0.32), color: WHITE });   // narrow-angle camera
  parts.push({ geometry: onPlat(scope(0.24, 0.27, 1.7), 0.38, 0.42), color: WHITE });   // wide-angle camera
  parts.push({ geometry: onPlat(scope(0.62, 0.68, 1.9), 0.0, -0.42), color: GOLD });    // infrared spectrometer
  parts.push({ geometry: onPlat(new THREE.BoxGeometry(0.42, 1.6, 0.42).translate(0, 0.8, 0), -0.52, -0.42), color: 0x2f3136 });
  parts.push({ geometry: onPlat(scope(0.16, 0.2, 1.0), 0.6, -0.12), color: 0xbcbfc3 });

  // --- The RTG boom, opposite: three power units in a line, kept out at arm's length --------------
  const RTG = 270;
  latticeBoom(parts, out(RTG, APO - 0.02, -0.1), out(RTG, 6.6, -0.1), 0.3, 4, 0xb9bdc3, [0, 1, 0], 0.035);
  const RTG_FINS = 8;
  const unit = (xc) => {
    const L = 1.9;
    const m = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(xc, -0.1, 0);
    parts.push({ geometry: turned([[0, -L / 2], [0.56, -L / 2], [0.66, -L / 2 + 0.1], [0.66, L / 2 - 0.1], [0.56, L / 2], [0, L / 2]], 24, { crease: 32 }).applyMatrix4(m), color: DARK });
    for (const y of [-L / 2 + 0.04, L / 2 - 0.04]) {
      parts.push({ geometry: turned([[0, y - 0.04], [0.74, y - 0.04], [0.74, y + 0.04], [0, y + 0.04]], 24, { crease: 32 }).applyMatrix4(m), color: 0x7c8087 });
    }
    for (let k = 0; k < RTG_FINS; k++) {
      const a = (k / RTG_FINS) * TAU;
      const fin = new THREE.BoxGeometry(0.5, L - 0.34, 0.05).translate(0.84, 0, 0);
      fin.applyMatrix4(new THREE.Matrix4().makeRotationY(a));
      parts.push({ geometry: fin.applyMatrix4(m), color: 0x72757b });
    }
  };
  unit(-7.2); unit(-9.25); unit(-11.3);
  parts.push({ geometry: rod([-6.5, -0.1, 0], [-12.3, -0.1, 0], 0.09, 8), color: 0x7c8087 });

  // --- The magnetometer boom: really 43ft, shortened here so it fits a room ------------------------
  // On this tip local -Z points up and away, so this is the one direction with room for it.
  const MAG = 192;
  const magRoot = out(MAG, APO - 0.02, 0.3);
  const MAG_LEN = 15;
  const magTip = out(MAG, APO + MAG_LEN, 0.3);
  latticeBoom(parts, magRoot, magTip, 0.22, 12, 0xd9d1b8, [0, 1, 0], 0.024);
  const magCan = out(MAG, APO + 0.55, 0.3);
  parts.push({ geometry: rod(out(MAG, APO - 0.1, 0.3), magCan, 0.42, 16), color: GOLD });
  for (const f of [0.5, 1]) {
    const p = out(MAG, APO + MAG_LEN * f, 0.3);
    const q = out(MAG, APO + MAG_LEN * f + 0.5, 0.3);
    parts.push({ geometry: rod(p, q, 0.17, 12), color: f === 1 ? 0xe2e2dd : 0xbcbfc3 });
  }

  // --- Two plasma wave antennas, thin whips: really 33ft, shortened here ---------------------------
  for (const [deg, L] of [[228, 13], [152, 13]]) {
    const base = out(deg, APO, -0.2);
    parts.push({ geometry: rod(base, out(deg, APO + L, 0.8), [0.05, 0.022], 6), color: 0xc9b98c });
    parts.push({ geometry: new THREE.SphereGeometry(0.1, 10, 6).translate(base[0], base[1], base[2]), color: GREY });
  }

  // --- The Golden Record, on the bus's flank that faces a student walking round to it ------------
  const REC = 54; // a face normal of the decagon: 18 + 36k
  const n = V(...dirAt(REC));
  const tang = V(n.z, 0, -n.x);
  const faceM = new THREE.Matrix4().makeBasis(tang, UP, n).setPosition(n.clone().multiplyScalar(APO));
  // A dark mount with bolts, so a gold disc does not disappear against a gold blanket.
  parts.push({ geometry: new THREE.BoxGeometry(1.36, 1.36, 0.1).translate(0, 0, 0.03).applyMatrix4(faceM), color: 0x2d2f33 });
  for (const [x, y] of [[-0.58, -0.58], [0.58, -0.58], [-0.58, 0.58], [0.58, 0.58]]) {
    parts.push({ geometry: new THREE.SphereGeometry(0.045, 8, 5).scale(1, 1, 0.5).translate(x, y, 0.08).applyMatrix4(faceM), color: 0xc4c8cd });
  }
  const recRing = turned([[0, 0], [0.56, 0], [0.56, 0.05], [0.5, 0.06], [0.5, 0.03], [0, 0.03]], 40, { crease: 40 });
  recRing.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0, 0.06));
  parts.push({ geometry: recRing.applyMatrix4(faceM), color: 0xa9adb4 });
  // The disc: planar UV, so the painted cover lies on it the right way up.
  const discGeo = new THREE.CircleGeometry(0.5, 56);
  discGeo.translate(0, 0, 0.1);
  const discBack = new THREE.CylinderGeometry(0.5, 0.5, 0.04, 56, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.08);
  const recordParts = [{ geometry: discGeo.applyMatrix4(faceM), keepColor: true }, { geometry: discBack.applyMatrix4(faceM), keepColor: true }];

  // --- Everything so far is in the spacecraft's frame: tip it as one piece ------------------------
  const bake = (list) => { for (const p of list) p.geometry.applyMatrix4(placeM); return list; };
  bake(parts); bake(blanket); bake(dishParts); bake(recordParts);

  // --- The display stand, in the world's frame ----------------------------------------------------
  const tankC = V(0, -1.25, 0).applyMatrix4(placeM);
  const stand = [];
  stand.push({
    geometry: turned([[0, 0], [3.5, 0], [3.58, 0.05], [3.58, 0.18], [3.42, 0.24], [3.3, 0.32], [1.3, 0.42], [0.62, 0.56], [0.42, 0.9], [0, 0.9]], 64, { crease: 30 }),
    color: 0x66707a,
  });
  const postTop = [tankC.x, tankC.y, tankC.z];
  stand.push({ geometry: tube([[0, 0.7, 0], [0, 1.7, 0], [tankC.x, tankC.y - 1.6, tankC.z], postTop], [0.3, 0.26, 0.22, 0.22], { sides: 18, steps: 24, round: 1 }), color: 0x7c8590 });

  const dishMap = canvasTexture(1024, 512, paintVoyagerDish);
  dishMap.wrapS = THREE.RepeatWrapping;
  const busMap = canvasTexture(1024, 128, paintVoyagerBus);
  busMap.wrapS = THREE.RepeatWrapping;
  const recordMap = canvasTexture(512, 512, paintGoldenRecord);

  const root = new THREE.Group();
  root.add(
    mesh(mergeParts(dishParts), standard({ vertexColors: true, map: dishMap, roughness: 0.62, metalness: 0, side: THREE.FrontSide })),
    mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.55, metalness: 0.14 })),
    mesh(mergeParts(blanket), standard({ map: busMap, roughness: 0.34, metalness: 0.22 })),
    mesh(mergeParts(recordParts), standard({ map: recordMap, roughness: 0.3, metalness: 0.3, emissive: 0x6b4a0a, emissiveIntensity: 0.25 })),
    mesh(mergeParts(stand), standard({ vertexColors: true, roughness: 0.5, metalness: 0.2 })),
  );
  return root;
}

// ===========================================================================================
// ROCK LAYERS AND FOSSILS. A block of flat-lying sedimentary rock with a river canyon cut through
// its top, sawn clean on all four sides. One table of layers, indexed by Q (feet above the block's
// floor, less a gentle regional warp), feeds the two big painted cut faces, the strip that colours
// the canyon walls and the two plainer sides, and the placing of every fossil. So a layer lines up
// wherever two surfaces meet, including where the canyon breaks through the cut face.
// ===========================================================================================

const STRATA_BASE = 0.32;   // the top of the plinth
const STRATA_W = 5;         // half width
const STRATA_D = 4;         // half depth
const STRATA_TOP = 7.0;     // Q of the plateau
const STRATA_STRIP_Q = 7.5; // Q at the top of the strip texture

// Bottom (oldest) to top (youngest). [top Q, colour, kind, name]
const STRATA = [
  [0.72, 0x7c3c2c, 'sand', 'Dark red sandstone'],
  [1.5, 0x7d9184, 'shale', 'Green-grey shale'],
  [2.08, 0xe0d2a8, 'lime', 'Cream limestone'],
  [2.72, 0x565a63, 'shale', 'Dark grey shale'],
  [3.72, 0xb6c0c6, 'lime', 'Pale grey limestone'],
  [4.24, 0xd28b45, 'silt', 'Orange siltstone'],
  [5.24, 0xb24a31, 'sand', 'Red sandstone'],
  [5.72, 0xe7cf8e, 'cross', 'Yellow sandstone'],
  [6.16, 0x7f6a86, 'shale', 'Purple mudstone'],
  [6.68, 0xcdbd97, 'lime', 'Buff limestone'],
  [6.8, 0x5b4128, 'soil', 'Soil'],
  [99, 0x74a648, 'turf', 'Turf'],
];

// A slow regional sag in the beds. Small on purpose: these are undisturbed layers, and a card says so.
const strataWarp = (x, z) => 0.1 * Math.sin(x * 0.31 + 0.6) + 0.06 * Math.sin(z * 0.42 - 0.4) + 0.012 * x;

const riverX = (z) => 0.55 + 1.05 * Math.sin(z * 0.72 + 0.5) + 0.42 * Math.sin(z * 1.55 + 1.9);
const riverSlope = (z) => 1.05 * 0.72 * Math.cos(z * 0.72 + 0.5) + 0.42 * 1.55 * Math.cos(z * 1.55 + 1.9);
const CANYON_FLOOR = 3.62;
const WATER_Q = 3.72;

// The canyon's cross-section against distance from the river: cliffs in the hard beds, benches on
// the soft ones. Written against the layer table, which is why the steps land where the rock changes.
const CANYON_STEPS = [[0, CANYON_FLOOR], [0.38, CANYON_FLOOR], [0.6, 4.24], [0.94, 4.34], [1.2, 5.74], [1.56, 5.86], [1.86, 6.92], [2.5, STRATA_TOP]];
function canyonProfile(d) {
  if (d >= 2.5) return STRATA_TOP;
  for (let i = 0; i < CANYON_STEPS.length - 1; i++) {
    const [a, ya] = CANYON_STEPS[i];
    const [b, yb] = CANYON_STEPS[i + 1];
    if (d <= b) { const t = (d - a) / (b - a); return ya + (yb - ya) * (t * t * (3 - 2 * t)); }
  }
  return STRATA_TOP;
}

function makeStrataHeight() {
  const noise = latticeNoise(4407, 32);
  return (x, z) => {
    const wob = (noise(x * 1.4 + 16, z * 1.4 + 16) - 0.5) * 0.3 + (noise(x * 3.4 + 4, z * 3.4 + 9) - 0.5) * 0.09;
    const dist = Math.abs(x - riverX(z)) / Math.sqrt(1 + riverSlope(z) ** 2) + wob;
    const plateau = (noise(x * 0.8 + 5, z * 0.8 + 2) - 0.5) * 0.24 + (noise(x * 2.6, z * 2.6 + 7) - 0.5) * 0.06;
    const fade = sstep(dist, 1.86, 2.5);
    const y = canyonProfile(Math.max(0, dist)) + plateau * fade;
    return STRATA_BASE + y + strataWarp(x, z);
  };
}

// The rock at one point of a cut face, in sRGB bytes. Q decides the bed; the rest is the bed's own grain.
function makeRockPainter() {
  const cols = STRATA.map((row) => bytes(row[1]));
  const blotch = latticeNoise(811, 64);
  const grain = latticeNoise(127, 128);
  const rng = seededRandom(5150);
  const speck = new Float32Array(4096);
  for (let i = 0; i < speck.length; i++) speck[i] = rng();
  // The two coordinates along a face and up it, in feet.
  return (s, q, ix, iy, out) => {
    const wiggle = (blotch(s * 3.1 + 11, q * 0.9) - 0.5) * 0.05;
    const Q = q + wiggle;
    let k = 0;
    while (Q > STRATA[k][0]) k++;
    const base = cols[k];
    const kind = STRATA[k][2];
    const bottom = k ? STRATA[k - 1][0] : 0;
    const top = STRATA[k][0];
    out[0] = base[0]; out[1] = base[1]; out[2] = base[2];
    // One texel of blend across a bed's edge, so the line is crisp without being a staircase.
    if (top - Q < 0.008 && k < cols.length - 1) blend(out, cols[k + 1], (1 - (top - Q) / 0.008) * 0.5);
    else if (k && Q - bottom < 0.008) blend(out, cols[k - 1], (1 - (Q - bottom) / 0.008) * 0.5);
    const big = fbm2(blotch, s * 1.1 + 3, q * 2.4 + k * 5);
    const n = speck[((ix * 73) ^ (iy * 179)) & 4095];
    let m = 1 + (big - 0.5) * 0.24;
    if (kind === 'sand' || kind === 'cross') {
      m *= 1 + (n - 0.5) * 0.16;
      // Thin darker partings.
      const p = (q - bottom) * 6 + (blotch(s * 0.8, q) - 0.5) * 1.2;
      if (p % 1 < 0.06) m *= 0.86;
      if (kind === 'cross') {
        // Cross-bedding: dune faces, slanted lines between flat sets.
        const set = Math.floor((q - bottom) * 4.2);
        const phase = (s * 1.6 + q * (set % 2 ? 3.4 : 2.8) * (set % 2 ? 1 : -1) + set * 1.7) % 0.34;
        if (phase < 0.05 && phase > -0.28) m *= 0.84;
      }
    } else if (kind === 'shale' || kind === 'silt') {
      // Fissile: many fine flat laminae, broken up along their length.
      const lam = (q + (grain(s * 2, q * 0.4) - 0.5) * 0.03) * (kind === 'shale' ? 34 : 20);
      m *= 1 + Math.sin(lam * TAU) * (kind === 'shale' ? 0.075 : 0.05);
      m *= 1 + (n - 0.5) * 0.08;
    } else if (kind === 'lime') {
      // Beds and vertical joints, in staggered blocks.
      const bedH = (top - bottom) / 3;
      const bed = Math.floor((q - bottom) / bedH);
      const within = (q - bottom) / bedH - bed;
      if (within < 0.045 || within > 0.965) m *= 0.74;
      const seed = Math.sin(bed * 12.9 + k * 3.3) * 0.5 + 0.5;
      const joint = ((s + seed * 2.3) / (1.05 + seed * 0.5)) % 1;
      const jw = joint < 0 ? joint + 1 : joint;
      if (jw < 0.012) m *= 0.76;
      m *= 1 + (grain(s * 7, q * 7) - 0.5) * 0.16;
      m *= 1 + (n - 0.5) * 0.06;
    } else if (kind === 'turf') {
      m = 0.82 + n * 0.3;
    } else if (kind === 'soil') {
      m *= 0.9 + n * 0.25;
    }
    // A bedding plane is a crisp dark line, whichever pair of rocks it separates.
    if (k > 0 && k < 10) m *= mix(0.62, 1, sstep(Q - bottom, 0.012, 0.024));
    shade(out, m);
  };
}

// The two big faces, unique per texel: +Z at the left of the sheet, +X beside it, 100px to the foot.
const STRATA_PX = 100;
const STRATA_SHEET_W = 2048;
const STRATA_SHEET_H = 768;
const stZ = (x, y) => [((x + STRATA_W) * STRATA_PX + 8) / STRATA_SHEET_W, ((y - STRATA_BASE) * STRATA_PX + 8) / STRATA_SHEET_H];
const stX = (z, y) => [((STRATA_D - z) * STRATA_PX + 1032) / STRATA_SHEET_W, ((y - STRATA_BASE) * STRATA_PX + 8) / STRATA_SHEET_H];

function paintStrataSheet(ctx, w, h, height) {
  const paint = makeRockPainter();
  const water = bytes(0x2f8dd6);
  // Halos of darker rock round the fossils, which is what a real fossil in a real face has.
  const halos = STRATA_FOSSILS.map(([face, a, y, rx, ry]) => ({ face, a, y, rx: rx * 1.25, ry: ry * 1.25 }));
  paintTexels(ctx, w, h, (px, py, out) => {
    const y = STRATA_BASE + (h - 1 - py - 8) / STRATA_PX;
    let s; let x; let z; let face;
    if (px < 1024) { x = (px - 8) / STRATA_PX - STRATA_W; z = STRATA_D; s = x; face = 'z'; } else { z = STRATA_D - (px - 1032) / STRATA_PX; x = STRATA_W; s = STRATA_W + (STRATA_D - z); face = 'x'; }
    const q = y - STRATA_BASE - strataWarp(x, z);
    paint(s, q, px, py, out);
    for (const halo of halos) {
      if (halo.face !== face) continue;
      const a = face === 'z' ? x : z;
      const dx = (a - halo.a) / halo.rx; const dy = (y - STRATA_BASE - halo.y) / halo.ry;
      const d = dx * dx + dy * dy;
      if (d < 1) shade(out, 0.82 + 0.18 * d);
    }
    if (face === 'z' && q > CANYON_FLOOR - 0.02 && q < WATER_Q + 0.01 && Math.abs(x - riverX(STRATA_D)) < 0.42) {
      out[0] = water[0]; out[1] = water[1]; out[2] = water[2];
    }
  });

  // A small printed ruler at the back edge of the +X face, naming the beds and saying which way is
  // older. The model's teaching does not depend on it, since a stretch would ruin it.
  const px = (z) => stX(z, 0)[0] * w;
  const py = (q) => h - 8 - (q * STRATA_PX) - (STRATA_BASE * 0);
  const xText = px(-STRATA_D) - 8;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let k = 0; k < 10; k++) {
    const q0 = k ? STRATA[k - 1][0] : 0;
    const q1 = STRATA[k][0];
    const name = STRATA[k][3];
    fitFont(ctx, name, 170, 19, '700');
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(20,14,8,0.85)';
    ctx.strokeText(name, xText, py((q0 + q1) / 2));
    ctx.fillStyle = '#fbf6e4';
    ctx.fillText(name, xText, py((q0 + q1) / 2));
  }
  // The arrow up the front left edge of the +Z face: time.
  const ax = 44;
  ctx.strokeStyle = 'rgba(20,14,8,0.85)';
  ctx.fillStyle = '#fbf6e4';
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(ax, py(0.3)); ctx.lineTo(ax, py(6.2)); ctx.stroke();
  ctx.strokeStyle = '#fbf6e4';
  ctx.lineWidth = 4.5;
  ctx.beginPath(); ctx.moveTo(ax, py(0.3)); ctx.lineTo(ax, py(6.2)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ax - 15, py(6.2)); ctx.lineTo(ax + 15, py(6.2)); ctx.lineTo(ax, py(6.48)); ctx.closePath();
  ctx.strokeStyle = 'rgba(20,14,8,0.85)'; ctx.lineWidth = 3; ctx.stroke(); ctx.fill();
  ctx.textAlign = 'left';
  ctx.save();
  ctx.translate(ax + 22, py(5.95));
  ctx.rotate(Math.PI / 2);
  for (const [text, at] of [['YOUNGER', 0], ['OLDER', 470]]) {
    fitFont(ctx, text, 130, 23, '800');
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(20,14,8,0.85)';
    ctx.strokeText(text, at, 0);
    ctx.fillStyle = '#fbf6e4';
    ctx.fillText(text, at, 0);
  }
  ctx.restore();
}

// The strip: Q up its height, tiling in u. Colours the canyon walls and the two plainer sides, and
// is near-white in its turf band, because there vertex colours carry the green.
function paintStrataStrip(ctx, w, h) {
  const paint = makeRockPainter();
  paintTexels(ctx, w, h, (px, py, out) => {
    const q = ((h - 1 - py + 0.5) / h) * STRATA_STRIP_Q;
    // Mirrored across the sheet, so the tile has no seam for the eye to find on a long wall.
    const s = Math.abs((px / w) * 2 - 1) * 4;
    paint(s, q, px, py, out);
    if (q > 6.84) {
      const v = 214 + ((px * 37) ^ (py * 91)) % 41;
      out[0] = v; out[1] = v; out[2] = v;
    }
  });
}

// --- Fossils --------------------------------------------------------------------------------
// [face, along the face, Q (height above the block's floor), half width, half height, kind].
// Lowest to highest is oldest to youngest, and the kinds are in the order they appear in the record.
const STRATA_FOSSILS = [
  ['z', -3.35, 1.08, 0.42, 0.34, 'trilobite'],
  ['z', -1.45, 1.13, 0.5, 0.36, 'trilobite'],
  ['z', 0.65, 1.06, 0.42, 0.32, 'trilobite'],
  ['z', 3.25, 1.12, 0.44, 0.34, 'trilobite'],
  ['z', -2.45, 1.8, 0.27, 0.24, 'shell'],
  ['z', -0.35, 1.78, 0.27, 0.24, 'shell'],
  ['z', 1.75, 1.82, 0.3, 0.25, 'shell'],
  ['z', 4.1, 1.77, 0.26, 0.23, 'shell'],
  ['z', -1.8, 3.2, 1.05, 0.42, 'fish'],
  ['z', 2.6, 3.14, 0.82, 0.34, 'fish'],
  ['z', -2.75, 4.76, 1.32, 0.3, 'bone'],
  ['x', 2.7, 1.1, 0.42, 0.34, 'trilobite'],
  ['x', 0.3, 1.81, 0.27, 0.24, 'shell'],
  ['x', 2.35, 3.98, 0.24, 0.22, 'ammonite'],
  ['x', -0.3, 3.98, 0.22, 0.2, 'ammonite'],
  ['x', 1.1, 4.8, 0.95, 0.24, 'vertebrae'],
];

// Each builder works in a frame where x runs along the face, y up it and +z straight out of it, with
// the face at z = 0. Everything is a closed solid half sunk in the rock, so nothing can float.
const sculptTube = (points, radii) => {
  const n = (points.length - 1) * 6;
  const curve = new THREE.CatmullRomCurve3(points.map((p) => V(...p)));
  const P = []; const Rr = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    P.push(curve.getPoint(t).toArray());
    const at = t * (radii.length - 1);
    const j = Math.min(radii.length - 2, Math.floor(at));
    Rr.push(mix(radii[j], radii[j + 1], at - j));
  }
  return segsP(P, Rr);
};

function fossilTrilobite(list, color, L) {
  // Head shield, a stack of thorax segments and a tail shield, with the three lobes that give the
  // animal its name running down all of them: a raised axis between two flatter side lobes. The thorax
  // has to be the longest part, or the head reads as a little face with a nose.
  const W = L * 0.72;
  const SEGMENTS = 8;
  const AXIS = W * 0.27;
  const headY = L * 0.66;
  const tailY = -L * 0.76;
  const thoraxTop = L * 0.42;
  const thoraxEnd = -L * 0.56;
  list.push({ geometry: new THREE.SphereGeometry(1, 16, 8).scale(W * 1.02, L * 0.34, 0.07).translate(0, headY, 0), color });
  // The head's raised middle is the same width as the axis it continues into.
  list.push({ geometry: new THREE.SphereGeometry(1, 10, 6).scale(AXIS * 1.02, L * 0.3, 0.115).translate(0, headY + L * 0.02, 0), color });
  for (const s of [-1, 1]) {
    // Eyes low on the cheeks, as raised crescents rather than dark dots.
    list.push({ geometry: new THREE.SphereGeometry(1, 8, 5).scale(L * 0.075, L * 0.05, 0.05).translate(s * W * 0.56, headY + L * 0.04, 0.06), color: 0x2c241c });
    // Cheek spines, trailing back along the body's edge.
    list.push({ geometry: tube([[s * W * 0.94, headY - L * 0.1, 0], [s * W * 1.02, thoraxTop - L * 0.1, 0], [s * W * 0.96, thoraxTop - L * 0.5, 0]], [0.036, 0.024, 0.004], { sides: 4, steps: 6, round: 1 }), color });
  }
  for (let i = 0; i < SEGMENTS; i++) {
    const t = (i + 0.5) / SEGMENTS;
    const y = mix(thoraxTop, thoraxEnd, t);
    const w = W * mix(0.96, 0.66, t);
    list.push({
      geometry: tube([[-w, y - L * 0.07, 0], [-w * 0.45, y, 0], [0, y + L * 0.012, 0], [w * 0.45, y, 0], [w, y - L * 0.07, 0]],
        [0.014, 0.036, 0.04, 0.036, 0.014], { sides: 4, steps: 6, round: 1 }),
      color,
    });
    list.push({ geometry: new THREE.SphereGeometry(1, 8, 5).scale(AXIS * mix(1, 0.74, t), L * 0.066, 0.09).translate(0, y + L * 0.012, 0), color });
  }
  list.push({ geometry: new THREE.SphereGeometry(1, 14, 7).scale(W * 0.68, L * 0.27, 0.06).translate(0, tailY, 0), color });
  list.push({ geometry: new THREE.SphereGeometry(1, 8, 5).scale(AXIS * 0.72, L * 0.22, 0.09).translate(0, tailY + L * 0.03, 0), color });
}

function fossilShell(list, color, R) {
  // A ribbed brachiopod: a fan with a hinge at the bottom.
  list.push({
    geometry: solidSurface({
      nu: 36,
      nv: 7,
      axis: [0, 0, 1],
      point: (u, v) => {
        const a = (u - 0.5) * 2.5;
        const r = R * (0.05 + v * 0.95);
        return [Math.sin(a) * r * 1.05, -R * 0.45 + Math.cos(a) * r * 0.96, 0];
      },
      thick: (u, v) => {
        const edge = Math.min(1, v * 10, (1 - v) * 9, Math.min(u, 1 - u) * 26);
        const ribs = 1 + Math.cos((u - 0.5) * TAU * 6) * 0.15 * sstep(v, 0.1, 0.4);
        const growth = 1;
        return (0.03 + 0.1 * Math.sin(Math.min(1, v + 0.15) * Math.PI * 0.85)) * ribs * growth * edge;
      },
    }),
    color,
  });
}

function fossilAmmonite(list, color, R) {
  // A flat planispiral: a coiled tube, ribbed by its own stations, with the eye of the coil sunk.
  const pts = [];
  const radii = [];
  const TURNS = 3.1;
  const STEPS = 90;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const a = t * TURNS * TAU;
    const r = R * Math.exp((t - 1) * 1.9) * 0.82;
    pts.push([Math.cos(a) * r, Math.sin(a) * r, 0]);
    const ribbed = 1 + Math.sin(t * 150) * 0.12;
    radii.push(r * 0.2 * ribbed + 0.008);
  }
  const g = tube(pts, radii, { sides: 6, steps: STEPS, round: 1 });
  g.scale(1, 1, 0.72);
  list.push({ geometry: g, color });
}

function fossilFish(list, color, L) {
  // A skeleton: spine, ribs, skull and fins, each a real solid half out of the rock, and laid out
  // the way a fish is found, on its side.
  const spine = [];
  const radii = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    spine.push([mix(-L * 0.62, L * 0.72, t), Math.sin(t * 2.4 - 0.2) * L * 0.035, 0]);
    radii.push(mix(0.028, 0.016, t) * (L / 1));
  }
  list.push({ geometry: tube(spine, radii, { sides: 8, steps: 40, round: 1 }), color });
  const RIBS = 13;
  for (let i = 0; i < RIBS; i++) {
    const t = i / (RIBS - 1);
    const x = mix(-L * 0.42, L * 0.46, t);
    const h = Math.sin((t * 0.86 + 0.14) * Math.PI) * L * 0.31 + L * 0.03;
    const c = Math.sin(((x + L * 0.62) / (L * 1.34)) * 2.4 - 0.2) * L * 0.035;
    for (const s of [-1, 1]) {
      list.push({
        geometry: tube([[x, c, 0], [x + L * 0.03, c + s * h * 0.55, 0], [x + L * 0.1, c + s * h, 0]], [0.016 * L, 0.012 * L, 0.003], { sides: 4, steps: 5, round: 1 }),
        color,
      });
    }
  }
  // The skull, and an eye socket in it.
  const skull = tube([[-L * 0.56, 0, 0], [-L * 0.68, 0.005, 0], [-L * 0.86, -L * 0.012, 0], [-L * 1.02, -L * 0.04, 0]], [L * 0.2, L * 0.195, L * 0.13, L * 0.035], { sides: 16, steps: 12, round: 2 });
  skull.scale(1, 1, 0.32);
  list.push({ geometry: skull, color });
  // The gill cover's edge and the eye.
  list.push({ geometry: tube([[-L * 0.58, L * 0.15, 0.045], [-L * 0.52, 0, 0.055], [-L * 0.58, -L * 0.16, 0.045]], 0.016 * L, { sides: 5, steps: 8, round: 1 }), color: 0x161210 });
  list.push({ geometry: new THREE.SphereGeometry(L * 0.058, 12, 8).scale(1, 1, 0.6).translate(-L * 0.8, L * 0.04, 0.05), color: 0xd8cdb4 });
  list.push({ geometry: new THREE.SphereGeometry(L * 0.03, 10, 6).scale(1, 1, 0.6).translate(-L * 0.8, L * 0.04, 0.074), color: 0x161210 });
  // The jaw.
  list.push({ geometry: tube([[-L * 0.6, -L * 0.11, 0], [-L * 0.76, -L * 0.13, 0], [-L * 0.93, -L * 0.06, 0]], [0.03 * L, 0.024 * L, 0.012 * L], { sides: 6, steps: 8, round: 1 }), color });
  // Tail fin, dorsal rays.
  for (let k = -3; k <= 3; k++) {
    const a = k * 0.22;
    list.push({ geometry: tube([[L * 0.72, spine[12][1], 0], [L * 0.72 + Math.cos(a) * L * 0.27, spine[12][1] + Math.sin(a) * L * 0.27, 0]], [0.014 * L, 0.003], { sides: 4, steps: 3, round: 1 }), color });
  }
  for (let i = 0; i < 6; i++) {
    const x = mix(-L * 0.08, L * 0.24, i / 5);
    const top = Math.sin(((x + L * 0.62) / (L * 1.34)) * 2.4 - 0.2) * L * 0.035 + L * 0.31;
    list.push({ geometry: tube([[x, top - L * 0.03, 0], [x + L * 0.09, top + L * 0.11, 0]], [0.012 * L, 0.002], { sides: 4, steps: 3, round: 1 }), color });
  }
}

function fossilBone(list, color, L) {
  // A dinosaur's thigh bone, not a cartoon's. A femur is not symmetrical: a thick slightly bowed shaft,
  // a head turned off to one side at the hip end with the trochanter's crest beside it, a ridge part
  // way down the shaft, and two broad knuckles of unequal size at the knee. One field, so the ends
  // grow out of the shaft, and only the half standing out of the rock is meshed.
  const base = lin(color);
  const sculpt = new Sculpt(0.055);
  const c = (x) => x * L;
  sculpt.add(sculptTube([[c(-0.88), 0.02, 0], [c(-0.5), 0.02, 0], [c(0.1), -0.03, 0], [c(0.68), -0.05, 0], [c(0.92), -0.02, 0]], [0.26, 0.17, 0.15, 0.17, 0.27]), color);
  sculpt.add(sculptTube([[c(-0.82), 0.1, 0], [c(-1.0), 0.26, 0], [c(-1.08), 0.33, 0]], [0.19, 0.17, 0.17]), color, { k: 0.1 });
  sculpt.add(sphereP([c(-1.1), 0.36, 0], 0.235), color, { k: 0.08 });
  sculpt.add(ellipsoidP([c(-0.9), -0.15, 0], [0.34, 0.19, 0.15]), color, { k: 0.14 });
  sculpt.add(ellipsoidP([c(-0.16), -0.16, 0], [0.3, 0.09, 0.08]), color, { k: 0.1 });
  sculpt.add(ellipsoidP([c(1.0), 0.15, 0], [0.26, 0.21, 0.16]), color, { k: 0.08 });
  sculpt.add(ellipsoidP([c(1.03), -0.22, 0], [0.22, 0.17, 0.14]), color, { k: 0.08 });
  const hw = L * 1.5;
  const geometry = polygonize(sculpt, {
    bounds: [-hw, -0.6, -0.05, hw, 0.8, 0.5],
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const n = Math.sin(x * 6.1 + y * 3) * Math.sin(y * 11.3 - x * 2) * 0.5 + Math.sin(x * 17 + y * 21) * 0.22;
      const k = 0.88 + n * 0.2;
      rgb[0] = base[0] * k; rgb[1] = base[1] * k; rgb[2] = base[2] * k;
    },
  });
  list.push({ geometry, keepColor: true });
}

function fossilVertebrae(list, color, L) {
  // A run of tail vertebrae, each a spool with a spine, in the same bed as the thigh bone.
  const N = 7;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const x = mix(-L, L, t);
    const y = Math.sin(t * 2.6) * 0.06;
    const k = mix(1, 0.7, t);
    const spool = turned([[0, -0.13], [0.11, -0.13], [0.13, -0.11], [0.085, 0], [0.13, 0.11], [0.11, 0.13], [0, 0.13]], 10, { crease: 40 });
    spool.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2 + 0.05));
    spool.scale(k, k, k);
    list.push({ geometry: spool.translate(x, y, 0), color });
    list.push({ geometry: tube([[x, y + 0.06 * k, 0], [x + 0.08 * k, y + 0.28 * k, 0]], [0.035 * k, 0.012], { sides: 6, steps: 3, round: 1 }), color });
    list.push({ geometry: tube([[x, y - 0.06 * k, 0], [x + 0.06 * k, y - 0.24 * k, 0]], [0.03 * k, 0.012], { sides: 6, steps: 3, round: 1 }), color });
  }
}

function buildRockStrata() {
  const height = makeStrataHeight();
  const NX = 106;
  const NZ = 86;
  const xAt = (i) => -STRATA_W + (i / NX) * 2 * STRATA_W;
  const zAt = (j) => -STRATA_D + (j / NZ) * 2 * STRATA_D;

  // --- The top: terrain, whose UV reads the strip by the layer it has reached -------------------
  const pos = []; const uvs = []; const col = []; const idx = [];
  const hgt = new Float32Array((NX + 1) * (NZ + 1));
  const vnoise = latticeNoise(9091, 32);
  const greenA = lin(0x5a8f33); const greenB = lin(0x8aaf48); const greenC = lin(0x3f7a2c);
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const x = xAt(i); const z = zAt(j);
      const y = height(x, z);
      hgt[i + j * (NX + 1)] = y;
      const q = y - STRATA_BASE - strataWarp(x, z);
      pos.push(x, y, z);
      uvs.push((x * 0.85 + z * 0.55) / 4, q / STRATA_STRIP_Q);
      const n = fbm2(vnoise, x * 2.2 + 8, z * 2.2 + 4);
      const t = n > 0.5 ? (n - 0.5) * 3 : 0;
      const g = [mix(greenA[0], greenB[0], clamp01(t)), mix(greenA[1], greenB[1], clamp01(t)), mix(greenA[2], greenB[2], clamp01(t))];
      const dark = fbm2(vnoise, x * 5.5 + 1, z * 5.5 + 19);
      if (dark < 0.38) { g[0] = greenC[0]; g[1] = greenC[1]; g[2] = greenC[2]; }
      const turf = sstep(q, 6.76, 6.82);
      col.push(mix(1, g[0], turf), mix(1, g[1], turf), mix(1, g[2], turf));
    }
  }
  const row = NX + 1;
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = i + j * row; const b = a + 1; const c = a + row; const d = c + 1;
      // +x then +z is clockwise from above, so this order faces up.
      idx.push(a, c, b, b, c, d);
    }
  }
  const terrain = new THREE.BufferGeometry();
  terrain.setIndex(idx);
  terrain.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  terrain.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  terrain.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  terrain.computeVertexNormals();
  const stripParts = [{ geometry: terrain, keepColor: true }];

  // The two plainer sides, from the same terrain edge, in the strip.
  const side = (count, pointAt, normal) => {
    const p = []; const u = []; const n = []; const ii = [];
    // Three rows. Above Q 6.82 the strip's band is near-white, waiting for a vertex colour these sides
    // do not have, so the last few inches hold one green row of it instead of climbing into the white.
    const TURF_Q = 6.82;
    for (let k = 0; k <= count; k++) {
      const [x, z] = pointAt(k);
      const top = height(x, z);
      const a = x * 0.85 + z * 0.55;
      const warp = strataWarp(x, z);
      const qTop = top - STRATA_BASE - warp;
      const qMid = Math.min(qTop, TURF_Q);
      p.push(x, top, z, x, STRATA_BASE + warp + qMid, z, x, STRATA_BASE, z);
      u.push(a / 4, qMid / STRATA_STRIP_Q, a / 4, qMid / STRATA_STRIP_Q, a / 4, Math.max(0.002, -warp / STRATA_STRIP_Q));
      n.push(...normal, ...normal, ...normal);
    }
    for (let k = 0; k < count; k++) {
      for (let r = 0; r < 2; r++) {
        const a = k * 3 + r; const b = a + 1; const c = a + 3; const d = a + 4;
        ii.push(a, b, d, a, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(ii);
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    return g;
  };
  const windFacing = (g, dir) => {
    const P = g.attributes.position; const I = g.index;
    const A = V().fromBufferAttribute(P, I.getX(0)); const B = V().fromBufferAttribute(P, I.getX(1)); const C = V().fromBufferAttribute(P, I.getX(2));
    if (B.sub(A).cross(C.sub(A)).dot(dir) < 0) {
      for (let t = 0; t < I.count; t += 3) { const b = I.getX(t + 1); I.setX(t + 1, I.getX(t + 2)); I.setX(t + 2, b); }
    }
    return g;
  };
  stripParts.push({ geometry: windFacing(side(NX, (k) => [xAt(k), -STRATA_D], [0, 0, -1]), V(0, 0, -1)), keepColor: true });
  stripParts.push({ geometry: windFacing(side(NZ, (k) => [-STRATA_W, zAt(k)], [-1, 0, 0]), V(-1, 0, 0)), keepColor: true });

  // The two cut faces share the terrain's edge vertex for vertex, so there is no crack along the top.
  const faceGeo = (count, pointAt, uvAt, normal) => {
    const p = []; const u = []; const n = []; const ii = [];
    for (let k = 0; k <= count; k++) {
      const [x, z] = pointAt(k);
      const top = height(x, z);
      p.push(x, top, z, x, STRATA_BASE, z);
      u.push(...uvAt(x, z, top), ...uvAt(x, z, STRATA_BASE));
      n.push(...normal, ...normal);
    }
    for (let k = 0; k < count; k++) {
      const a = k * 2; const b = a + 1; const c = a + 2; const d = a + 3;
      ii.push(a, b, d, a, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(ii);
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    return windFacing(g, V(...normal));
  };
  const faceParts = [
    { geometry: faceGeo(NX, (k) => [xAt(k), STRATA_D], (x, z, y) => stZ(x, y), [0, 0, 1]), keepColor: true },
    { geometry: faceGeo(NZ, (k) => [STRATA_W, zAt(k)], (x, z, y) => stX(z, y), [1, 0, 0]), keepColor: true },
  ];

  // --- The river: a shallow sheet in the canyon floor, with a real lip where the block is cut ---
  const water = [];
  const RN = 90;
  const RW = 0.46;
  const wp = []; const wc = []; const wi = [];
  const shallow = lin(0x4fb0e8); const deep = lin(0x1f74c4);
  for (let j = 0; j <= RN; j++) {
    const z = -STRATA_D + (j / RN) * 2 * STRATA_D;
    const cx = riverX(z);
    for (let k = 0; k <= 4; k++) {
      const f = k / 4;
      const x = cx - RW + 2 * RW * f;
      const y = STRATA_BASE + WATER_Q + strataWarp(cx, z);
      wp.push(x, y, z);
      const t = 1 - Math.abs(f - 0.5) * 2;
      const ripple = 0.86 + 0.24 * (0.5 + 0.5 * Math.sin(z * 9 + f * 5));
      wc.push(mix(shallow[0], deep[0], t) * ripple, mix(shallow[1], deep[1], t) * ripple, mix(shallow[2], deep[2], t) * ripple);
    }
  }
  for (let j = 0; j < RN; j++) {
    for (let k = 0; k < 4; k++) {
      const a = j * 5 + k; const b = a + 1; const c = a + 5; const d = c + 1;
      wi.push(a, c, b, b, c, d);
    }
  }
  const sheet = new THREE.BufferGeometry();
  sheet.setIndex(wi);
  sheet.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  sheet.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3));
  sheet.computeVertexNormals();
  water.push({ geometry: sheet, keepColor: true });

  // --- Fossils and scenery -----------------------------------------------------------------------
  const solids = [];
    const BONE = 0xd8c398;
  const onFace = (face, along, q, geometryList) => {
    const y = STRATA_BASE + q + strataWarp(face === 'z' ? along : STRATA_W, face === 'z' ? STRATA_D : along);
    const m = face === 'z'
      ? new THREE.Matrix4().makeTranslation(along, y, STRATA_D)
      : new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(STRATA_W, y, along);
    for (const part of geometryList) { part.geometry.applyMatrix4(m); solids.push(part); }
  };
  for (const [face, along, q, rx, ry, kind] of STRATA_FOSSILS) {
    const list = [];
    if (kind === 'trilobite') fossilTrilobite(list, 0x5a4c3d, ry * 1.04);
    else if (kind === 'shell') fossilShell(list, 0xe4d6b4, rx * 1.05);
    else if (kind === 'ammonite') fossilAmmonite(list, 0xf4e6c5, rx * 1.05);
    else if (kind === 'fish') fossilFish(list, 0x40362b, rx * 0.86);
    else if (kind === 'bone') fossilBone(list, BONE, rx * 0.82);
    else if (kind === 'vertebrae') fossilVertebrae(list, BONE, rx * 0.86);
    onFace(face, along, q, list);
  }

  // Trees on the plateau and the benches, sized like a real tree seen from far above. Placed by asking
  // the terrain, and never on a cliff.
  const rng = seededRandom(2718);
  const tree = (x, z, size, kind) => {
    const y = height(x, z);
    const dark = rng() > 0.5;
    if (kind === 0) {
      const c1 = dark ? 0x2f6a2b : 0x3f7f34;
      solids.push({ geometry: new THREE.ConeGeometry(size * 0.42, size * 0.8, 7).translate(x, y + size * 0.48, z), color: c1 });
      solids.push({ geometry: new THREE.ConeGeometry(size * 0.32, size * 0.62, 7).translate(x, y + size * 0.84, z), color: c1 });
      solids.push({ geometry: new THREE.CylinderGeometry(size * 0.05, size * 0.07, size * 0.3, 6).translate(x, y + size * 0.1, z), color: 0x4e3a27 });
    } else {
      const c1 = dark ? 0x4b8d33 : 0x6aa63f;
      solids.push({ geometry: new THREE.IcosahedronGeometry(size * 0.42, 1).scale(1, 0.85, 1).translate(x, y + size * 0.5, z), color: c1 });
      solids.push({ geometry: new THREE.IcosahedronGeometry(size * 0.28, 0).translate(x + size * 0.2, y + size * 0.36, z + size * 0.1), color: c1 });
      solids.push({ geometry: new THREE.CylinderGeometry(size * 0.05, size * 0.07, size * 0.3, 6).translate(x, y + size * 0.12, z), color: 0x4e3a27 });
    }
  };
  let placed = 0;
  for (let n = 0; n < 500 && placed < 50; n++) {
    const x = (rng() - 0.5) * (STRATA_W * 2 - 0.5);
    const z = (rng() - 0.5) * (STRATA_D * 2 - 0.5);
    const d = Math.abs(x - riverX(z)) / Math.sqrt(1 + riverSlope(z) ** 2);
    if (d < 2.35) continue;
    tree(x, z, 0.34 + rng() * 0.3, rng() > 0.45 ? 0 : 1);
    placed++;
  }
  // A few on the upper bench, where the soft bed has weathered flat.
  for (let n = 0; n < 12; n++) {
    const z = -3.4 + (n / 11) * 6.8;
    const s = n % 2 ? 1 : -1;
    const x = riverX(z) + s * (1.39 + rng() * 0.07) * Math.sqrt(1 + riverSlope(z) ** 2);
    if (Math.abs(x) < 4.7) tree(x, z, 0.2 + rng() * 0.08, 1);
  }

  // The plinth, in dark walnut with a brass line.
  const plinth = [];
  plinth.push({ geometry: new THREE.BoxGeometry(STRATA_W * 2 + 0.7, STRATA_BASE - 0.02, STRATA_D * 2 + 0.7).translate(0, (STRATA_BASE - 0.02) / 2, 0), color: 0x6a4a33 });
  plinth.push({ geometry: new THREE.BoxGeometry(STRATA_W * 2 + 0.36, 0.04, STRATA_D * 2 + 0.36).translate(0, STRATA_BASE - 0.015, 0), color: 0xc0984c });
  solids.push(...plinth);

  const sheetMap = canvasTexture(STRATA_SHEET_W, STRATA_SHEET_H, (ctx, w, h) => paintStrataSheet(ctx, w, h, height));
  const stripMap = wrapRepeat(canvasTexture(256, 1024, paintStrataStrip));

  const root = new THREE.Group();
  root.add(
    mesh(mergeParts(faceParts), standard({ map: sheetMap, bumpMap: sheetMap, bumpScale: 0.9, roughness: 0.92, metalness: 0 })),
    mesh(mergeParts(stripParts), standard({ vertexColors: true, map: stripMap, roughness: 0.94, metalness: 0 })),
    mesh(mergeParts(water), standard({ vertexColors: true, roughness: 0.2, metalness: 0.1 })),
    mesh(mergeParts(solids), standard({ vertexColors: true, roughness: 0.66, metalness: 0 })),
  );
  return root;
}

// ===========================================================================================
// PLATE BOUNDARY. A subduction zone in a block, cut clean on +Z. The section is the point, and it
// stands in real relief: the mantle is furthest back, the sinking ocean plate is in front of that,
// and the continent is in front of both, so from any angle a student sees one plate go under the
// other. The cut through the section is one set of curves, used for the solids and the painting.
// ===========================================================================================

const PB = { BASE: 0.28, HX: 6, HZ: 3.5, SEA: 5.2, TRENCH: -0.85, COAST: 0.5, RECESS: 0.14 };
const PB_VENT = 3.15;
const PB_THICK = 0.76;

const slabTopAt = (x) => {
  if (x <= -2.2) return 4.62;
  if (x <= 0.2) return 4.62 - 0.177 * (x + 2.2) ** 2;
  return 3.6 - 0.85 * (x - 0.2);
};
const slabSlopeAt = (x) => (x <= -2.2 ? 0 : x <= 0.2 ? 0.354 * (x + 2.2) : 0.85);
const slabBottomAt = (x) => slabTopAt(x) - PB_THICK * Math.sqrt(1 + slabSlopeAt(x) ** 2);
const mohoAt = (x) => 3.5 - 0.72 * Math.exp(-(((x - 3.2) / 1.3) ** 2));
const continentFloorAt = (x) => Math.max(mohoAt(x), slabTopAt(x));

function makePlateTerrain() {
  const noise = latticeNoise(7070, 32);
  const CONES = [
    { x: PB_VENT, z: PB.HZ, H: 1.12, r: 1.42, crater: 0.17 },
    { x: 3.42, z: -0.2, H: 0.95, r: 1.12, crater: 0.1 },
    { x: PB_VENT, z: -PB.HZ, H: 1.0, r: 1.3, crater: 0.13 },
  ];
  // Without the cones: the coast, the plain and the range the volcanoes stand on.
  const ground = (x, z) => {
    const wob = (noise(z * 0.7 + 4, 3.5) - 0.5) * 0.55;
    const X = x + wob * sstep(x, -0.4, 0.5) * (1 - sstep(x, 1.5, 2.4));
    let y;
    if (X < PB.COAST) y = mix(slabTopAt(PB.TRENCH), PB.SEA, clamp01((X - PB.TRENCH) / (PB.COAST - PB.TRENCH)));
    else y = PB.SEA + 0.22 * sstep(X, PB.COAST, 2.0);
    const ridgeX = 3.2 + 0.28 * Math.sin(z * 1.05 + 0.7);
    const range = Math.exp(-(((x - ridgeX) / 0.86) ** 2));
    const crags = fbm2(noise, x * 1.8 + 9, z * 1.8 + 2);
    y += range * (0.42 + crags * 0.34);
    y += 0.34 * sstep(x, 3.2, 5.1) * (0.85 + crags * 0.3);
    y += sstep(x, 1.2, 2.4) * (fbm2(noise, x * 3.4, z * 3.4) - 0.5) * 0.15;
    return y;
  };
  const coneAt = (x, z) => {
    let top = 0;
    for (const c of CONES) {
      const dx = x - c.x; const dz = z - c.z;
      const d = Math.hypot(dx, dz);
      if (d >= c.r) continue;
      const a = Math.atan2(dz, dx);
      const gully = 1 + 0.07 * Math.sin(a * 9 + c.x * 3) * sstep(d, c.crater, c.r * 0.4);
      let h = c.H * (1 - d / c.r) ** 1.22 * gully;
      if (d < c.crater) h = c.H * (1 - c.crater / c.r) ** 1.22 - (c.crater - d) * 0.9;
      top = Math.max(top, h);
    }
    return top;
  };
  return { ground, coneAt, height: (x, z) => ground(x, z) + coneAt(x, z), CONES };
}

function paintPlateSection(ctx, w, h, terrain) {
  const PPF = w / 12;
  const noise = latticeNoise(3141, 64);
  const hash = seededRandom(90210);
  const speck = new Float32Array(4096);
  for (let i = 0; i < speck.length; i++) speck[i] = hash();
  const FZ = PB.HZ;
  // Everything that depends only on x is worked out once a column.
  const col = [];
  for (let px = 0; px < w; px++) {
    const x = (px + 0.5) / PPF - 6;
    const ground = terrain.ground(x, FZ);
    col.push({
      x,
      top: slabTopAt(x),
      bot: slabBottomAt(x),
      slope: slabSlopeAt(x),
      floor: continentFloorAt(x),
      ground,
      surface: terrain.height(x, FZ),
    });
  }
  const C = (hex) => bytes(hex);
  const waterTop = C(0x3aa6e8); const waterDeep = C(0x0d4a9a);
  const crustD = C(0x262c35); const lithos = C(0x3f464f); const sediment = C(0x8d7c64);
  const contU = C(0xe6d3a8); const contM = C(0xd6bd8d); const contL = C(0xbfa77f);
  const wedgeA = C(0xc9b083); const wedgeB = C(0x9c8f78);
  const mantleHi = C(0xffb245); const mantleLo = C(0xe25618);
  const meltA = C(0xfff08a); const meltB = C(0xff8c1e); const meltEdge = C(0x8a2a0c);
  const coneA = C(0x5f5a57); const coneB = C(0x3f3b3a); const coneC = C(0x87807a);

  // The melt, written as a function of y: the line it rises along, and how wide it is there.
  const meltStartX = 2.42;
  const meltStartY = slabTopAt(meltStartX);
  const CHAMBER = { x: PB_VENT, y: 4.15, rx: 0.56, ry: 0.32 };
  const plumeX = (y) => {
    const t = clamp01((y - meltStartY) / (CHAMBER.y - meltStartY));
    return mix(meltStartX, CHAMBER.x, t * t * (3 - 2 * t)) + Math.sin(y * 3.4) * 0.05;
  };
  const plumeW = (y) => {
    const t = clamp01((y - meltStartY) / (CHAMBER.y - meltStartY));
    return 0.085 + 0.015 * Math.sin(y * 5.3 + 1) + 0.075 * (1 - sstep(t, 0, 0.35));
  };
  const summit = terrain.height(PB_VENT + 0.17, FZ);

  paintTexels(ctx, w, h, (px, py, out) => {
    const c = col[px];
    const { x } = c;
    const y = (h - 1 - py + 0.5) / PPF;
    const n = speck[((px * 97) ^ (py * 211)) & 4095];
    // Above the sloping margin is water, not more continent. Above the land is still painted as rock,
    // since the land's outline differs a little between the front cut and the back one.
    const landed = c.ground >= PB.SEA;
    const onContinent = x >= PB.TRENCH && y > c.floor && (y <= c.ground || landed);
    const onWater = !onContinent && !landed && y > (x < PB.TRENCH ? c.top : c.ground);

    if (onContinent) {
      // The continent: pale, and stacked. Near the trench its rock is scraped-off sediment, folded.
      const depth = c.ground - y;
      const a = sstep(depth, 0.4, 0.5); const b = sstep(depth, 1.25, 1.42);
      out[0] = mix(mix(contU[0], contM[0], a), contL[0], b);
      out[1] = mix(mix(contU[1], contM[1], a), contL[1], b);
      out[2] = mix(mix(contU[2], contM[2], a), contL[2], b);
      // Granite's coarse grain in the lower crust, thin beds in the upper.
      if (depth < 0.45) shade(out, 1 + Math.sin(y * 62 + noise(x * 0.8, y) * 3) * 0.035);
      else if (n > 0.86) shade(out, 0.84);
      else if (n < 0.08) shade(out, 1.1);
      // Sediment scraped off the sinking plate, crumpled against the continent's edge. Its boundary
      // leans the way the plate does, so it reads as pushed there rather than as a ruled block.
      const scrape = 1 - sstep(x - (c.floor < y ? (y - c.floor) * 0.7 : 0), 0.62, 0.78);
      if (scrape > 0) {
        const fold = Math.sin((y + Math.sin(x * 6.4) * 0.11 - x * 0.46) * 22);
        const t = 0.5 + 0.5 * fold;
        out[0] = mix(out[0], mix(wedgeA[0], wedgeB[0], t), scrape);
        out[1] = mix(out[1], mix(wedgeA[1], wedgeB[1], t), scrape);
        out[2] = mix(out[2], mix(wedgeA[2], wedgeB[2], t), scrape);
      }
      shade(out, 1 + (fbm2(noise, x * 1.3 + 4, y * 1.3) - 0.5) * 0.12);
      // A cone's layers of ash and lava, parallel to its own flank.
      if (y > c.ground - 0.02 && Math.abs(x - PB_VENT) < 1.5) {
        const band = (y + Math.abs(x - PB_VENT) * 0.86 + noise(x * 2, y * 2) * 0.05) * 7.5;
        const f = band - Math.floor(band);
        const tone = f < 0.33 ? coneA : f < 0.66 ? coneB : coneC;
        out[0] = tone[0]; out[1] = tone[1]; out[2] = tone[2];
        if (n > 0.8) shade(out, 0.88);
      }
    } else if (onWater) {
      const t = clamp01((PB.SEA - y) / 0.95);
      out[0] = mix(waterTop[0], waterDeep[0], t); out[1] = mix(waterTop[1], waterDeep[1], t); out[2] = mix(waterTop[2], waterDeep[2], t);
      const wave = Math.sin(x * 9 + Math.sin(y * 8) * 1.4 + y * 15);
      shade(out, 1 + wave * 0.04);
    } else if (y <= c.top && y > c.bot) {
      // The ocean plate, dark, with its rock lines running along it so its dip is visible in the grain.
      const d = (c.top - y) / Math.sqrt(1 + c.slope * c.slope);
      if (d < 0.06) { out[0] = sediment[0]; out[1] = sediment[1]; out[2] = sediment[2]; } else if (d < 0.32) {
        out[0] = crustD[0]; out[1] = crustD[1]; out[2] = crustD[2];
        const pillow = ((x * 5.6 + noise(x * 2.1, d * 8) * 0.6) % 1 + 1) % 1;
        if (pillow < 0.05) shade(out, 1.5);
      } else {
        out[0] = lithos[0]; out[1] = lithos[1]; out[2] = lithos[2];
      }
      shade(out, 1 + Math.sin(d * 40 + noise(x, d * 3) * 2) * 0.05 + (n - 0.5) * 0.1);
    } else {
      // The mantle: solid rock creeping slowly, hotter and so brighter the deeper it goes. Soft blotches
      // only, because bands of any contrast read as wood grain.
      const t = 1 - clamp01(y / 4.8);
      const flow = fbm2(noise, x * 0.5 + y * 0.2 + 21, y * 0.8 - x * 0.12);
      const k = clamp01(t * 0.8 + 0.08 + (flow - 0.5) * 0.3);
      out[0] = mix(mantleLo[0], mantleHi[0], k); out[1] = mix(mantleLo[1], mantleHi[1], k); out[2] = mix(mantleLo[2], mantleHi[2], k);
      shade(out, 1 + (n - 0.5) * 0.05);
    }

    // The conduit and the magma chamber in the crust and the cone.
    const chamber = ((x - CHAMBER.x) / CHAMBER.rx) ** 2 + ((y - CHAMBER.y) / CHAMBER.ry) ** 2;
    if (chamber < 1) {
      out[0] = mix(meltA[0], meltB[0], sstep(chamber, 0.15, 0.82));
      out[1] = mix(meltA[1], meltB[1], sstep(chamber, 0.15, 0.82));
      out[2] = mix(meltA[2], meltB[2], sstep(chamber, 0.15, 0.82));
      if (chamber > 0.86) { out[0] = meltEdge[0]; out[1] = meltEdge[1]; out[2] = meltEdge[2]; }
    } else if (y > CHAMBER.y && y < summit + 0.3) {
      const off = Math.abs(x - PB_VENT - Math.sin(y * 2.4) * 0.02);
      const half = 0.055 + 0.03 * sstep(y, CHAMBER.y + 0.25, CHAMBER.y) * 3;
      if (off < half + 0.016) {
        const edge = off > half;
        const hot = edge ? meltEdge : off < half * 0.55 ? meltA : meltB;
        out[0] = hot[0]; out[1] = hot[1]; out[2] = hot[2];
      }
    }
    // The plume from the sinking plate up to the chamber.
    if (y > meltStartY - 0.05 && y < CHAMBER.y) {
      const off = Math.abs(x - plumeX(y));
      const half = plumeW(y);
      if (off < half + 0.018) {
        const edge = off > half;
        const hot = edge ? meltEdge : off < half * 0.5 ? meltA : meltB;
        out[0] = hot[0]; out[1] = hot[1]; out[2] = hot[2];
      }
    }
  });

  // Marks drawn over the painting, with no words in them, since the back face reuses this sheet.
  const X = (x) => (x + 6) * PPF;
  const Y = (y) => h - y * PPF;
  // Mantle circulation: broad curved arrows, dragged along by the plate above.
  const flowArrow = (pts, color = 'rgba(255,240,190,0.86)') => {
    ctx.lineWidth = 9;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2; const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(X(pts[i][0]), Y(pts[i][1]), X(mx), Y(my));
    }
    const a = pts[pts.length - 2]; const b = pts[pts.length - 1];
    ctx.lineTo(X(b[0]), Y(b[1]));
    ctx.stroke();
    const ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    const s = 25;
    ctx.beginPath();
    ctx.moveTo(X(b[0]) + Math.cos(ang) * s, Y(b[1]) + Math.sin(ang) * s);
    ctx.lineTo(X(b[0]) + Math.cos(ang + 2.5) * s, Y(b[1]) + Math.sin(ang + 2.5) * s);
    ctx.lineTo(X(b[0]) + Math.cos(ang - 2.5) * s, Y(b[1]) + Math.sin(ang - 2.5) * s);
    ctx.closePath();
    ctx.fill();
  };
  flowArrow([[-1.9, 1.15], [-3.4, 0.82], [-4.9, 1.25], [-5.2, 2.2], [-4.4, 3.2], [-3.0, 3.42]]);
  flowArrow([[-2.3, 3.36], [-1.5, 3.05], [-1.0, 2.4], [-1.2, 1.7]]);
  flowArrow([[5.35, 0.68], [5.52, 1.55], [5.0, 2.15], [4.2, 1.92], [3.75, 1.4]]);

  // Earthquakes, along the interface where the two plates grind past each other.
  const star = (x, y, r) => {
    const n = 8;
    ctx.beginPath();
    for (let k = 0; k < n * 2; k++) {
      const a = (k / (n * 2)) * TAU;
      const R = k % 2 ? r * 0.42 : r;
      const px = X(x) + Math.cos(a) * R; const py = Y(y) + Math.sin(a) * R;
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#fff36a';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#b3160c';
    ctx.stroke();
  };
  for (const [x, r] of [[-0.3, 15], [0.35, 20], [1.05, 17], [1.75, 14], [2.2, 11]]) star(x, slabTopAt(x) - 0.14, r);
}

// The top of the block in plan, and a strip of printed labels under it.
const PB_TOP_W = 1024;
const PB_TOP_H = 768;
const PB_PLAN_H = 598;
const pbPlanUV = (x, z) => [(x + PB.HX) / (2 * PB.HX), 1 - (((PB.HZ - z) / (2 * PB.HZ)) * PB_PLAN_H) / PB_TOP_H];

// [text, x, y, width, height, recess]: the height and width are what the printed letters are fitted to.
const PB_LABELS = [
  ['OCEAN', -4.55, 4.92, 1.0, 0.33, 0],
  ['OCEAN PLATE', -4.55, 4.26, 1.5, 0.34, 0.5],
  ['TRENCH', -1.32, 4.98, 1.0, 0.33, 0],
  ['CONTINENTAL PLATE', 4.82, 4.78, 2.1, 0.36, 0],
  ['MANTLE', -3.2, 2.15, 1.5, 0.44, 1],
  ['MAGMA RISES', 4.2, 2.62, 1.45, 0.34, 1],
  ['EARTHQUAKES', 0.2, 1.72, 1.55, 0.34, 1],
  ['VOLCANO', 4.95, 5.42, 1.2, 0.34, 0],
];

function paintPlateTop(ctx, w, h, terrain) {
  const noise = latticeNoise(555, 64);
  const fieldNoise = latticeNoise(909, 64);
  const NX = 180; const NZ = 106;
  const grid = new Float32Array((NX + 1) * (NZ + 1));
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      grid[i + j * (NX + 1)] = terrain.height(-PB.HX + (i / NX) * 2 * PB.HX, -PB.HZ + (j / NZ) * 2 * PB.HZ);
    }
  }
  const lookup = (x, z) => {
    const u = ((x + PB.HX) / (2 * PB.HX)) * NX; const v = ((z + PB.HZ) / (2 * PB.HZ)) * NZ;
    const i = Math.min(NX - 1, Math.max(0, Math.floor(u))); const j = Math.min(NZ - 1, Math.max(0, Math.floor(v)));
    const fu = u - i; const fv = v - j;
    const a = grid[i + j * (NX + 1)]; const b = grid[i + 1 + j * (NX + 1)];
    const c = grid[i + (j + 1) * (NX + 1)]; const d = grid[i + 1 + (j + 1) * (NX + 1)];
    return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
  };
  const deep = bytes(0x0e4f9e); const blue = bytes(0x2288d8); const shoal = bytes(0x4cc6da);
  const sand = bytes(0xe4d39c); const greenA = bytes(0x7fb84a); const greenB = bytes(0x5da03e);
  const forest = bytes(0x2f6f33); const rock = bytes(0x7c6c5a); const ash = bytes(0x5a5553); const snow = bytes(0xf4f6f8);
  const lava = bytes(0xff6a14); const lavaHot = bytes(0xffd24a);
  const LAVA = [[PB_VENT + 0.1, PB.HZ - 0.08], [PB_VENT + 0.32, PB.HZ - 0.3], [PB_VENT + 0.44, PB.HZ - 0.6], [PB_VENT + 0.72, PB.HZ - 0.85]];
  const lavaDist = (x, z) => {
    let best = 9;
    for (let i = 0; i < LAVA.length - 1; i++) {
      const [ax, az] = LAVA[i]; const [bx, bz] = LAVA[i + 1];
      const dx = bx - ax; const dz = bz - az;
      const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return best;
  };
  paintTexels(ctx, w, h, (px, py, out) => {
    const rowFromBottom = h - 1 - py;
    if (rowFromBottom < h - PB_PLAN_H) { out[0] = 22; out[1] = 32; out[2] = 52; return; }
    const x = (px + 0.5) / w * 2 * PB.HX - PB.HX;
    const z = ((py + 0.5) / PB_PLAN_H) * 2 * PB.HZ - PB.HZ;
    const y = lookup(x, z);
    const n = fbm2(noise, x * 2.2 + 3, z * 2.2 + 5);
    if (y < PB.SEA) {
      // Water: blue, dark over the trench, turquoise over the shelf, and a line of surf at the shore.
      const overTrench = Math.exp(-(((x - PB.TRENCH + (n - 0.5) * 0.3) / 0.62) ** 2));
      out[0] = mix(blue[0], deep[0], overTrench); out[1] = mix(blue[1], deep[1], overTrench); out[2] = mix(blue[2], deep[2], overTrench);
      const shelf = sstep(y, PB.SEA - 0.32, PB.SEA - 0.03) * sstep(x, -0.4, 0.2);
      blend(out, shoal, shelf);
      if (y > PB.SEA - 0.022) blend(out, snow, 0.75);
      const ripple = Math.sin(x * 16 + Math.sin(z * 5 + x) * 2.2) * Math.sin(z * 11 + x * 3);
      shade(out, 1 + ripple * 0.07 + (n - 0.5) * 0.12);
      return;
    }
    const lift = y - PB.SEA;
    // Fields and forest on the plain, then rock, with the bare cones standing out of it.
    const fld = fieldNoise(Math.floor(x * 2.1 + 7) * 3.1, Math.floor(z * 2.6 + 3) * 2.3);
    if (lift < 0.05) { out[0] = sand[0]; out[1] = sand[1]; out[2] = sand[2]; } else {
      const g = fld > 0.5 ? greenA : greenB;
      out[0] = g[0]; out[1] = g[1]; out[2] = g[2];
      const treey = sstep(n + lift * 0.45, 0.72, 0.82);
      blend(out, forest, treey);
      const high = sstep(lift + (n - 0.5) * 0.5, 0.86, 1.1);
      blend(out, rock, high);
    }
    const coneMix = sstep(terrain.coneAt(x, z), 0.03, 0.22);
    blend(out, ash, coneMix);
    if (lift + (n - 0.5) * 0.25 > 1.6 && Math.hypot(x - PB_VENT, z - PB.HZ) > 1.2) blend(out, snow, 0.95);
    shade(out, 0.92 + (noise(x * 14, z * 14) - 0.5) * 0.28);
    // The active cone's last flow, and its dark, burnt summit.
    const dVent = Math.hypot(x - PB_VENT, z - PB.HZ);
    if (dVent < 0.5) shade(out, mix(0.6, 1, dVent / 0.5));
    const dl = lavaDist(x, z);
    const widen = 0.05 + (noise(x * 6, z * 6) - 0.5) * 0.02;
    if (dl < widen) {
      out[0] = mix(lavaHot[0], lava[0], dl / widen); out[1] = mix(lavaHot[1], lava[1], dl / widen); out[2] = mix(lavaHot[2], lava[2], dl / widen);
    }
  });
  // The label strip. Rows of cards, measured to fit.
  const stripTop = PB_PLAN_H;
  const rows = 2; const cols = 4;
  const cw = w / cols; const ch = (h - stripTop) / rows;
  PB_LABELS.forEach(([text, , , cardW, cardH], i) => {
    const cx = (i % cols) * cw; const cy = stripTop + Math.floor(i / cols) * ch;
    ctx.fillStyle = '#16233c';
    ctx.fillRect(cx, cy, cw, ch);
    ctx.fillStyle = '#f7f3e5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // A cell is stretched onto a card of its own shape, so the letters are drawn squeezed the other way.
    const squeeze = (cw / ch) / (cardW / cardH);
    ctx.save();
    ctx.translate(cx + cw / 2, cy + ch / 2 + 2);
    ctx.scale(squeeze, 1);
    fitFont(ctx, text, (cw - 26) / squeeze, 52, '800');
    ctx.fillText(text, 0, 0);
    ctx.restore();
    ctx.strokeStyle = '#f2c14e';
    ctx.lineWidth = 4;
    ctx.strokeRect(cx + 5, cy + 5, cw - 10, ch - 10);
  });
}
function pbLabelUV(i) {
  const cols = 4; const rows = 2;
  const cw = 1 / cols; const ch = (PB_TOP_H - PB_PLAN_H) / PB_TOP_H / rows;
  const r = Math.floor(i / cols);
  const u0 = (i % cols) * cw; const v1 = 1 - PB_PLAN_H / PB_TOP_H - r * ch;
  return [u0 + 0.002, v1 - ch + 0.002, u0 + cw - 0.002, v1 - 0.002];
}

function buildPlateBoundary() {
  const { BASE, HX, HZ, SEA, RECESS } = PB;
  const terrain = makePlateTerrain();
  const { height } = terrain;
  const SECTION_W = 1536;
  const SECTION_H = 1024;
  const PPF = SECTION_W / 12;
  const uvOf = (x, y) => [(x + 6) / 12, (y * PPF) / SECTION_H];

  // The land's top: a grid sharing its front and back rows with the cut faces.
  const LAND_X0 = 0.0;
  const NX = 100; const NZ = 110;
  const lxAt = (i) => LAND_X0 + (i / NX) * (HX - LAND_X0);
  const lzAt = (j) => -HZ + (j / NZ) * 2 * HZ;
  const lp = []; const lu = []; const li = [];
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const x = lxAt(i); const z = lzAt(j);
      lp.push(x, height(x, z), z);
      lu.push(...pbPlanUV(x, z));
    }
  }
  const row = NX + 1;
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = i + j * row; const b = a + 1; const c = a + row; const d = c + 1;
      li.push(a, c, b, b, c, d);
    }
  }
  const landTop = new THREE.BufferGeometry();
  landTop.setIndex(li);
  landTop.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  landTop.setAttribute('uv', new THREE.Float32BufferAttribute(lu, 2));
  landTop.computeVertexNormals();

  // The water's top, carrying the ripple in its normals.
  const WX = 1.8;
  const WNX = 46; const WNZ = 20;
  const wp = []; const wu = []; const wi = [];
  for (let j = 0; j <= WNZ; j++) {
    for (let i = 0; i <= WNX; i++) {
      const x = -HX + (i / WNX) * (WX + HX); const z = -HZ + (j / WNZ) * 2 * HZ;
      wp.push(x, SEA, z);
      wu.push(...pbPlanUV(x, z));
    }
  }
  for (let j = 0; j < WNZ; j++) {
    for (let i = 0; i < WNX; i++) {
      const a = i + j * (WNX + 1); const b = a + 1; const c = a + WNX + 1; const d = c + 1;
      wi.push(a, c, b, b, c, d);
    }
  }
  const waterTop = new THREE.BufferGeometry();
  waterTop.setIndex(wi);
  waterTop.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  waterTop.setAttribute('uv', new THREE.Float32BufferAttribute(wu, 2));
  waterTop.computeVertexNormals();

  // --- The section, in depth order ------------------------------------------------------------
  const section = [];
  const FZ = HZ;
  const strip = (xs, topF, botF, zFront, depth = RECESS) => gridSolid(xs.length - 1, 1,
    (i, j) => [xs[i], j ? topF(xs[i]) : botF(xs[i]), zFront],
    (i, j) => [xs[i], (j ? topF(xs[i]) : botF(xs[i])) - (j ? 0.025 : 0), zFront - depth],
    { uvTop: (i, j) => uvOf(xs[i], j ? topF(xs[i]) : botF(xs[i])), crease: 35 });
  const span = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => mix(a, b, i / n));

  // The mantle is the back wall of the recess, and it runs behind everything.
  section.push({
    geometry: gridSolid(1, 1,
      (i, j) => [i ? HX : -HX, j ? SEA : BASE, FZ - RECESS],
      (i, j) => [i ? HX : -HX, j ? SEA : BASE, FZ - RECESS - 0.05],
      { uvTop: (i, j) => uvOf(i ? HX : -HX, j ? SEA : BASE) }),
    keepColor: true,
  });
  // The ocean plate, stopped where it leaves the block's floor.
  const slabEnd = (() => { let x = 2; while (slabTopAt(x) > BASE + 0.001 && x < HX) x += 0.01; return x; })();
  const slabXs = [...span(-HX, -2.2, 6), ...span(-2.2, 0.2, 24).slice(1), ...span(0.2, slabEnd, 30).slice(1)];
  section.push({ geometry: strip(slabXs, slabTopAt, (x) => Math.max(BASE, slabBottomAt(x)), FZ - RECESS / 2, RECESS / 2), keepColor: true });
  // The continent, and its ends. Its top row is the terrain's front row, vertex for vertex.
  const contXs = [...span(PB.TRENCH, LAND_X0, 12), ...Array.from({ length: NX }, (_, i) => lxAt(i + 1))];
  const landFront = (x) => (x >= LAND_X0 ? height(x, FZ) : mix(slabTopAt(PB.TRENCH), height(LAND_X0, FZ), (x - PB.TRENCH) / (LAND_X0 - PB.TRENCH)));
  section.push({ geometry: strip(contXs, landFront, (x) => Math.max(BASE, Math.min(landFront(x) - 0.002, continentFloorAt(x))), FZ), keepColor: true });
  // The water, in front of the plate and stopping at the shore.
  let coast = LAND_X0;
  while (landFront(coast) < SEA && coast < 2) coast += 0.01;
  const wXs = [...span(-HX, -2.2, 6), ...span(-2.2, PB.TRENCH, 14).slice(1), ...span(PB.TRENCH, coast, 16).slice(1)];
  const seabed = (x) => (x < PB.TRENCH ? slabTopAt(x) : landFront(x));
  section.push({ geometry: strip(wXs, () => SEA, (x) => Math.min(SEA - 0.002, seabed(x)), FZ), keepColor: true });

  // The back and the two sides: flat, in the same painting. There are no words in the painting, so
  // its mirror image on the back is still a true section.
  const flatFace = (count, pointAt, uAt, normal) => {
    const p = []; const u = []; const n = []; const ii = [];
    for (let k = 0; k <= count; k++) {
      const [x, z] = pointAt(k);
      const top = Math.max(height(x, z), SEA);
      const [uu, v0] = uvOf(uAt(x), BASE);
      const [, v1] = uvOf(uAt(x), top);
      p.push(x, top, z, x, BASE, z);
      u.push(uu, v1, uu, v0);
      n.push(...normal, ...normal);
    }
    for (let k = 0; k < count; k++) {
      const a = k * 2; const b = a + 1; const c = a + 2; const d = a + 3;
      ii.push(a, b, d, a, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(ii);
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    const P = g.attributes.position;
    const A = V().fromBufferAttribute(P, ii[0]); const B = V().fromBufferAttribute(P, ii[1]); const C = V().fromBufferAttribute(P, ii[2]);
    if (B.sub(A).cross(C.sub(A)).dot(V(...normal)) < 0) { g.setIndex(ii.map((_, t) => ii[t % 3 === 1 ? t + 1 : t % 3 === 2 ? t - 1 : t])); }
    return g;
  };
  const backXs = [...span(-HX, LAND_X0, 24), ...Array.from({ length: NX }, (_, i) => lxAt(i + 1))];
  section.push({ geometry: flatFace(backXs.length - 1, (k) => [backXs[k], -HZ], (x) => x, [0, 0, -1]), keepColor: true });
  section.push({ geometry: flatFace(NZ, (k) => [HX, lzAt(k) * (FZ - RECESS + HZ) / (2 * HZ) + (FZ - RECESS - HZ) / 2], () => HX - 0.02, [1, 0, 0]), keepColor: true });
  section.push({ geometry: flatFace(NZ, (k) => [-HX, lzAt(k) * (FZ - RECESS + HZ) / (2 * HZ) + (FZ - RECESS - HZ) / 2], () => -HX + 0.02, [-1, 0, 0]), keepColor: true });

  // --- Printed labels -------------------------------------------------------------------------
  const labels = [];
  PB_LABELS.forEach(([, x, y, w, h, recess], i) => {
    labels.push({ geometry: labelCard(x, y, FZ - RECESS * recess, w, h, 0.035, pbLabelUV(i)), keepColor: true });
  });

  // --- Solids in front of the section ----------------------------------------------------------
  const solids = [];
  const ARROW = 0xf9fafc;
  const OUTLINE = 0x121a2a;
  const arrow = (from, to, w, z, facing = [0, 0, 1]) => {
    const f = [from[0], from[1], from[2] ?? z];
    const t = [to[0], to[1], to[2] ?? z];
    solids.push({ geometry: flatArrow(f, t, w + 0.07, 0.06, facing, (w + 0.07) * 1.55), color: OUTLINE });
    const fn = V(...facing);
    solids.push({ geometry: flatArrow(V(...f).addScaledVector(fn, 0.015).toArray(), V(...t).addScaledVector(fn, 0.015).toArray(), w, 0.1, facing, w * 1.55), color: ARROW });
  };
  // Along the plate on the flat, then down its dip: one journey, two arrows.
  arrow([-3.6, 4.26], [-1.8, 4.26 - 0.02], 0.19, FZ - RECESS / 2);
  const dipA = 0.45; const dipB = 2.0;
  arrow([dipA, slabTopAt(dipA) - 0.42], [dipB, slabTopAt(dipB) - 0.42], 0.19, FZ - RECESS / 2);
  // The continent's own motion, the other way, toward the boundary.
  arrow([5.72, 4.2], [4.2, 4.2], 0.19, FZ);
  // And the same on the sea, for a student who only looks from above.
  for (const z of [1.2, -1.4]) {
    solids.push({ geometry: flatArrow([-5.1, SEA + 0.02, z], [-2.5, SEA + 0.02, z], 0.32, 0.07, [0, 1, 0], 0.62), color: ARROW });
  }

  // Trees on the plain, sized like trees at this scale: tiny, and many.
  const rng = seededRandom(1492);
  let placed = 0;
  for (let n = 0; n < 900 && placed < 60; n++) {
    const x = 0.9 + rng() * 2.2;
    const z = -HZ + 0.15 + rng() * (2 * HZ - 0.3);
    const y = height(x, z);
    if (y < SEA + 0.1 || y > SEA + 0.8 || terrain.coneAt(x, z) > 0.02) continue;
    const s = 0.12 + rng() * 0.1;
    const c = rng() > 0.5 ? 0x2d6a2e : 0x3f8236;
    solids.push({ geometry: new THREE.ConeGeometry(s * 0.42, s * 1.3, 6).translate(x, y + s * 0.65, z), color: c });
    placed++;
  }

  // The plinth.
  solids.push({ geometry: new THREE.BoxGeometry(2 * HX + 0.6, BASE - 0.02, 2 * HZ + 0.6).translate(0, (BASE - 0.02) / 2, 0), color: 0x2d3440 });
  solids.push({ geometry: new THREE.BoxGeometry(2 * HX + 0.26, 0.04, 2 * HZ + 0.26).translate(0, BASE - 0.015, 0), color: 0xc0984c });

  // The ash column: one field, leaning downwind and spreading as it climbs.
  const summitY = height(PB_VENT + 0.17, FZ);
  const smoke = new Sculpt(0.085);
  const ventY = summitY - 0.06;
  const SMOKE = [[0, 0, 0, 0.16], [0.03, 0.34, -0.02, 0.2], [0.07, 0.72, -0.06, 0.28], [0.17, 1.1, -0.1, 0.34], [0.3, 1.45, -0.13, 0.42], [0.5, 1.78, -0.18, 0.48], [0.76, 2.04, -0.22, 0.46], [1.08, 2.26, -0.26, 0.4]];
  for (const [dx, dy, dz, r] of SMOKE) smoke.add(sphereP([PB_VENT + dx, ventY + dy, HZ - 0.2 + dz], r), 0x000000, { k: 0.14 });
  const puffRng = seededRandom(1883);
  for (const [dx, dy, dz, r] of SMOKE.slice(1)) {
    for (let k = 0; k < 6; k++) {
      const a = puffRng() * TAU;
      smoke.add(sphereP([PB_VENT + dx + Math.cos(a) * r * 0.8, ventY + dy + (puffRng() - 0.5) * r * 1.4, HZ - 0.2 + dz + Math.sin(a) * r * 0.8], r * (0.36 + puffRng() * 0.22)), 0x000000, { k: 0.05 });
    }
  }
  const pale = lin(0xb7b4b0); const sooty = lin(0x4f4c4b);
  const smokeGeo = polygonize(smoke, {
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const t = sstep(y - ventY, 0.05, 1.2);
      const lit = 0.84 + 0.2 * ny;
      rgb[0] = mix(sooty[0], pale[0], t) * lit; rgb[1] = mix(sooty[1], pale[1], t) * lit; rgb[2] = mix(sooty[2], pale[2], t) * lit;
    },
  });
  solids.push({ geometry: smokeGeo, keepColor: true });

  // --- What glows: the magma as a real solid standing proud of the section ----------------------
  const hot = [];
  const meltStartX = 2.42;
  const meltStartY = slabTopAt(meltStartX);
  const CH = { x: PB_VENT, y: 4.15 };
  const path = [];
  const radii = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const y = mix(meltStartY - 0.03, CH.y, t);
    const s = t * t * (3 - 2 * t);
    path.push([mix(meltStartX, CH.x, s) + Math.sin(y * 3.4) * 0.05, y, mix(FZ - RECESS * 0.55, FZ, sstep(y, 2.5, 3.1))]);
    radii.push(0.085 + 0.015 * Math.sin(y * 5.3 + 1) + 0.075 * (1 - sstep(t, 0, 0.35)));
  }
  const plume = tube(path, radii, { sides: 12, steps: 42, round: 2 });
  hot.push({
    geometry: tintVertices(plume, (x, y, z, c) => {
      const t = sstep(y, meltStartY, CH.y);
      c[0] = 1; c[1] = mix(0.22, 0.5, t); c[2] = mix(0.02, 0.06, t);
    }),
    keepColor: true,
  });
  hot.push({ geometry: new THREE.SphereGeometry(1, 28, 16).scale(0.56, 0.32, 0.1).translate(CH.x, CH.y, FZ), color: 0xff8a18 });
  const conduit = [];
  const cr = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const y = mix(CH.y, summitY - 0.08, t);
    conduit.push([PB_VENT + Math.sin(y * 2.4) * 0.02, y, FZ]);
    cr.push(0.06);
  }
  hot.push({ geometry: tube(conduit, cr, { sides: 8, steps: 22, round: 1 }), color: 0xffb02e });
  // A glowing crater floor, sunk in the cone.
  hot.push({ geometry: new THREE.SphereGeometry(1, 18, 8).scale(0.13, 0.05, 0.12).translate(PB_VENT, summitY - 0.17, HZ - 0.05), color: 0xffa020 });

  const sectionMap = canvasTexture(SECTION_W, SECTION_H, (ctx, w, h) => paintPlateSection(ctx, w, h, terrain));
  const topMap = canvasTexture(PB_TOP_W, PB_TOP_H, (ctx, w, h) => paintPlateTop(ctx, w, h, terrain));

  const root = new THREE.Group();
  root.add(
    mesh(mergeParts(section), standard({ map: sectionMap, roughness: 0.88, metalness: 0 })),
    mesh(mergeParts([{ geometry: landTop, keepColor: true }, ...labels]), standard({ map: topMap, roughness: 0.92, metalness: 0 })),
    mesh(mergeParts([{ geometry: waterTop, keepColor: true }]), standard({ map: topMap.clone(), roughness: 0.22, metalness: 0.08 })),
    mesh(mergeParts(solids), standard({ vertexColors: true, roughness: 0.62, metalness: 0 })),
    mesh(mergeParts(hot), standard({ vertexColors: true, roughness: 0.5, metalness: 0, emissive: 0xff5a06, emissiveIntensity: 0.5 })),
  );
  return root;
}

// ===========================================================================================
// THE WATER CYCLE. A landscape in a block: sea at the left, a snow-capped mountain at the right, a
// river between them, and the four stages as big curved arrows that ARE the composition. Each arrow
// carries its name as part of its own surface, so the word follows the curve, and both of its faces
// read the right way round. Under the land is a section showing where the rain goes when it soaks in.
// ===========================================================================================

const WC = { BASE: 0.28, HX: 6, HZ: 4, SEA: 2.4, TOP_Y: 6.24 };
const WC_RIVER = [[3.25, -0.35], [2.5, 0.05], [1.85, 1.0], [1.1, 0.7], [0.35, 1.5], [-0.6, 1.05], [-1.45, 1.75], [-2.7, 1.5]];

function makeWaterTerrain() {
  const noise = latticeNoise(6026, 64);
  const curve = new THREE.CatmullRomCurve3(WC_RIVER.map(([x, z]) => V(x, 0, z)));
  const river = [];
  for (let i = 0; i <= 80; i++) { const p = curve.getPoint(i / 80); river.push([p.x, p.z]); }
  const riverDist = (x, z) => {
    let best = 1e9; let at = 0;
    for (let i = 0; i < river.length - 1; i += 1) {
      const [ax, az] = river[i]; const [bx, bz] = river[i + 1];
      const dx = bx - ax; const dz = bz - az;
      const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
      const d = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
      if (d < best) { best = d; at = (i + t) / (river.length - 1); }
    }
    return [Math.sqrt(best), at];
  };
  // Before the river is cut: sea floor, shore, plain, foothills and the peaks.
  const raw = (x, z) => {
    const wob = (noise(z * 0.55 + 7, 2.5) - 0.5) * 1.1;
    const X = x + 2.05 + wob;
    let y = WC.SEA - 0.72 + 0.78 * sstep(X, -1.5, 0.35);
    y += 0.42 * sstep(X, 0.35, 3.6);
    y += (fbm2(noise, x * 0.9 + 3, z * 0.9 + 1) - 0.5) * 0.22 * sstep(X, 0.3, 1.5);
    const peak = (cx, cz, sx, sz, H) => H * Math.exp(-(((x - cx) ** 2) / sx + ((z - cz) ** 2) / sz));
    const main = peak(3.75, -1.2, 5.0, 3.6, 1);
    const second = peak(5.3, 1.05, 1.0, 1.25, 1);
    const third = peak(1.9, -3.0, 1.6, 1.2, 1);
    // Ridges: a folded noise field whose creases grow sharper and deeper with height, which is what
    // stops a mountain reading as a smooth hill.
    const rn = fbm2(noise, x * 1.5 + 11, z * 1.5 + 4);
    const ridge = 1 - Math.abs(rn * 2 - 1) * 1.65;
    const rn2 = noise(x * 3.5 + 2, z * 3.5 + 18);
    const craggy = ridge * 0.62 + (1 - Math.abs(rn2 * 2 - 1) * 1.8) * 0.2;
    y += main ** 1.15 * (4.0 + craggy * 1.15);
    y += second * (1.9 + craggy * 0.7);
    y += third * (1.3 + craggy * 0.6);
    return y;
  };
  const height = (x, z) => {
    const base = raw(x, z);
    if (x < -3.6 || x > 4.2 || z > 3 || z < -1.7) return base;
    const [d, at] = riverDist(x, z);
    const cut = (0.15 + 0.5 * (1 - sstep(at, 0, 0.4))) * Math.exp(-((d / mix(0.3, 0.42, at)) ** 2));
    return base - cut;
  };
  return { height, river, riverDist };
}

function paintWaterSection(ctx, w, h, height) {
  const PPF = w / 12;
  const noise = latticeNoise(1202, 64);
  const FZ = WC.HZ;
  const rng = seededRandom(404);
  const speck = new Float32Array(4096);
  for (let i = 0; i < speck.length; i++) speck[i] = rng();
  const surfaces = [];
  for (let px = 0; px < w; px++) surfaces.push(height((px + 0.5) / PPF - 6, FZ));
  const soil = bytes(0x5a3d22); const unsat = bytes(0xc9a873); const sat = bytes(0x4f99c9);
  const bed = bytes(0x6c6e72); const bedB = bytes(0x7e7f82);
  const sea = bytes(0x2f96e0); const seaDeep = bytes(0x0f5aa8); const sand = bytes(0xd7c084);
  paintTexels(ctx, w, h, (px, py, out) => {
    const x = (px + 0.5) / PPF - 6;
    const y = (h - 1 - py + 0.5) / PPF;
    const g = surfaces[px];
    const n = speck[((px * 89) ^ (py * 163)) & 4095];
    // The water table: a shallow copy of the land, falling to meet the sea at the shore.
    const table = Math.min(g - 0.42, WC.SEA - 0.2 + Math.max(0, g - WC.SEA) * 0.32) + (noise(x * 0.5, 2) - 0.5) * 0.08;
    const bedrock = 1.2 + 0.14 * Math.sin(x * 0.7 + 1) + (fbm2(noise, x * 1.1, 8) - 0.5) * 0.2;
    if (y > g && y <= WC.SEA + 0.04) {
      const t = clamp01((WC.SEA - y) / 0.75);
      out[0] = mix(sea[0], seaDeep[0], t); out[1] = mix(sea[1], seaDeep[1], t); out[2] = mix(sea[2], seaDeep[2], t);
      shade(out, 1 + Math.sin(x * 9 + y * 19) * 0.04);
    } else if (y < bedrock) {
      const f = Math.floor(y * 8 + Math.sin(x * 2.1) * 0.5) % 2;
      const c = f ? bed : bedB;
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
      if (n > 0.8) shade(out, 0.88);
      shade(out, 1 + (fbm2(noise, x * 2, y * 2) - 0.5) * 0.18);
    } else if (y < table) {
      // Saturated ground: gravel with water filling the gaps, so grains and blue together.
      out[0] = sat[0]; out[1] = sat[1]; out[2] = sat[2];
      if (n > 0.8) shade(out, 0.74 + n * 0.2);
      else if (n < 0.1) shade(out, 1.2);
      shade(out, 1 + (fbm2(noise, x * 1.8 + 6, y * 3) - 0.5) * 0.12);
    } else if (y > g + 0.02 && g > WC.SEA) {
      // Above this column's front-edge ground: only the back and the sides ever show it, where the
      // land stands higher, and it is the mountain's own rock.
      const f = Math.floor(y * 6 + Math.sin(x * 2.1) * 0.5) % 2;
      const c = f ? bed : bedB;
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
      shade(out, 1.15 + (fbm2(noise, x * 2, y * 2) - 0.5) * 0.2);
    } else if (y > g - 0.14 && g > WC.SEA) {
      out[0] = soil[0]; out[1] = soil[1]; out[2] = soil[2];
      shade(out, 0.86 + n * 0.3);
    } else if (g <= WC.SEA + 0.03 && y > g - 0.12) {
      out[0] = sand[0]; out[1] = sand[1]; out[2] = sand[2];
      shade(out, 0.9 + n * 0.2);
    } else {
      out[0] = unsat[0]; out[1] = unsat[1]; out[2] = unsat[2];
      if (n > 0.86) shade(out, 0.82);
      shade(out, 1 + (fbm2(noise, x * 1.5, y * 3 + 4) - 0.5) * 0.14);
      // A hard edge to the water table, which is the point of the drawing.
      if (y - table < 0.018) { out[0] = 28; out[1] = 90; out[2] = 150; }
    }
  });
  // Water soaking down, and creeping toward the sea, as simple drawn arrows. No words here: the back
  // of the block reuses this sheet in mirror image.
  const X = (x) => (x + 6) * PPF;
  const Y = (y) => h - y * PPF;
  ctx.strokeStyle = '#eef8ff';
  ctx.fillStyle = '#eef8ff';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  const dash = (x0, y0, x1, y1) => {
    ctx.beginPath(); ctx.moveTo(X(x0), Y(y0)); ctx.lineTo(X(x1), Y(y1)); ctx.stroke();
    const a = Math.atan2(-(y1 - y0), x1 - x0);
    ctx.beginPath();
    ctx.moveTo(X(x1) + Math.cos(a) * 12, Y(y1) + Math.sin(a) * 12);
    ctx.lineTo(X(x1) + Math.cos(a + 2.5) * 11, Y(y1) + Math.sin(a + 2.5) * 11);
    ctx.lineTo(X(x1) + Math.cos(a - 2.5) * 11, Y(y1) + Math.sin(a - 2.5) * 11);
    ctx.closePath(); ctx.fill();
  };
  for (const [x0, y0, x1, y1] of [[4.7, 2.0, 3.5, 1.96], [0.5, 1.92, -0.6, 1.9], [-1.1, 1.88, -2.2, 1.84], [-2.75, 1.8, -3.6, 1.78]]) dash(x0, y0, x1, y1);
}

// Plan of the block's top: land and sea, painted once from the real heights.
function paintWaterTop(ctx, w, h, terrain) {
  const noise = latticeNoise(2929, 64);
  const NX = 200; const NZ = 134;
  const grid = new Float32Array((NX + 1) * (NZ + 1));
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) grid[i + j * (NX + 1)] = terrain.height(-WC.HX + (i / NX) * 2 * WC.HX, -WC.HZ + (j / NZ) * 2 * WC.HZ);
  }
  const lookup = (x, z) => {
    const u = ((x + WC.HX) / (2 * WC.HX)) * NX; const v = ((z + WC.HZ) / (2 * WC.HZ)) * NZ;
    const i = Math.min(NX - 1, Math.max(0, Math.floor(u))); const j = Math.min(NZ - 1, Math.max(0, Math.floor(v)));
    const fu = u - i; const fv = v - j;
    const a = grid[i + j * (NX + 1)]; const b = grid[i + 1 + j * (NX + 1)];
    const c = grid[i + (j + 1) * (NX + 1)]; const d = grid[i + 1 + (j + 1) * (NX + 1)];
    return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
  };
  const sea = bytes(0x2a8fe0); const deep = bytes(0x0f5eb0); const shoal = bytes(0x55cfd8); const foam = bytes(0xf4fbfc);
  const sand = bytes(0xe6d59c); const meadow = bytes(0x86bd4d); const forest = bytes(0x2e6e32); const moor = bytes(0x7d8a4c);
  const rock = bytes(0x786d62); const rockD = bytes(0x57504a); const snow = bytes(0xe4eaf0);
  const FIELD = [0xd9c04a, 0x9ccc56, 0xc98f4c, 0x6fae48, 0xe0cf72, 0xa8742f].map(bytes);
  paintTexels(ctx, w, h, (px, py, out) => {
    const x = (px + 0.5) / w * 2 * WC.HX - WC.HX;
    const z = ((py + 0.5) / h) * 2 * WC.HZ - WC.HZ;
    const y = lookup(x, z);
    const n = fbm2(noise, x * 1.8 + 2, z * 1.8 + 5);
    if (y < WC.SEA) {
      const depth = WC.SEA - y;
      out[0] = mix(sea[0], deep[0], clamp01(depth * 1.5)); out[1] = mix(sea[1], deep[1], clamp01(depth * 1.5)); out[2] = mix(sea[2], deep[2], clamp01(depth * 1.5));
      blend(out, shoal, 1 - sstep(depth, 0.02, 0.24));
      if (depth < 0.018) blend(out, foam, 0.8);
      const ripple = Math.sin(x * 15 + Math.sin(z * 6) * 2) * Math.sin(z * 12 + x * 4);
      shade(out, 1 + ripple * 0.07 + (n - 0.5) * 0.1);
      return;
    }
    const lift = y - WC.SEA;
    if (lift < 0.07) {
      out[0] = sand[0]; out[1] = sand[1]; out[2] = sand[2];
    } else {
      out[0] = meadow[0]; out[1] = meadow[1]; out[2] = meadow[2];
      // A patchwork of fields on the flat ground between the shore and the foothills.
      if (lift < 0.8 && x > -1.5 && x < 2.2 && z > -1.8) {
        const cx = Math.floor((x + z * 0.16) * 1.65 + 40);
        const cz = Math.floor((z - x * 0.16) * 2.05 + 40);
        const k = (cx * 7 + cz * 13) % FIELD.length;
        const f = FIELD[k];
        out[0] = f[0]; out[1] = f[1]; out[2] = f[2];
        const fx = ((x + z * 0.16) * 1.65 + 40) % 1; const fz = ((z - x * 0.16) * 2.05 + 40) % 1;
        // Furrows, and a hedge along each edge.
        shade(out, 1 + Math.sin((fx * (k % 2 ? 24 : 0) + fz * (k % 2 ? 0 : 24)) * TAU) * 0.05);
        if (fx < 0.035 || fz < 0.04) { out[0] = 62; out[1] = 112; out[2] = 52; }
      }
      const treeline = sstep(lift + (n - 0.5) * 0.8, 0.8, 1.05);
      blend(out, forest, treeline);
      blend(out, moor, sstep(lift + (n - 0.5) * 0.6, 1.9, 2.15));
      const rocky = sstep(lift + (n - 0.5) * 0.7, 2.25, 2.55);
      const crag = fbm2(noise, x * 5, z * 5);
      out[0] = mix(out[0], mix(rockD[0], rock[0], crag), rocky);
      out[1] = mix(out[1], mix(rockD[1], rock[1], crag), rocky);
      out[2] = mix(out[2], mix(rockD[2], rock[2], crag), rocky);
    }
    if (lift + (n - 0.5) * 0.55 + (noise(x * 9, z * 9) - 0.5) * 0.25 > 3.1) blend(out, snow, 0.97);
    shade(out, 0.94 + (noise(x * 15, z * 15) - 0.5) * 0.2);
  });
}

// Four rows, one per arrow, each a strip laid along that arrow, then a row of small cards.
const WC_ROWS = 5;
const WC_ARROWS = [
  { text: 'EVAPORATION', color: '#e6741a', edge: '#ffd9a8', ink: '#6b2c00', points: [[-5.05, 2.0, 0.9], [-4.85, 4.0, 0.9], [-4.15, 6.3, 0.9], [-3.0, 8.15, 0.8], [-1.95, 9.3, 0.5]], width: 0.98, font: 0.64 },
  { text: 'CONDENSATION', color: '#7a56d6', edge: '#e0d4ff', ink: '#2c1668', points: [[-2.15, 10.95, 0.35], [-0.95, 12.15, 0.5], [1.2, 12.6, 0.6], [3.3, 12.05, 0.55], [4.55, 11.0, 0.45]], width: 0.95, font: 0.6 },
  { text: 'PRECIPITATION', color: '#1668d2', edge: '#c6e2ff', ink: '#062d68', points: [[0.72, 9.95, 1.15], [0.98, 8.55, 1.15], [1.72, 7.25, 0.9], [2.75, 6.0, 0.25]], width: 0.84, font: 0.5 },
  { text: 'RUNOFF', color: '#0a9483', edge: '#c8fff4', ink: '#024138', points: [[2.75, 4.02, 2.9], [1.25, 3.68, 3.3], [-0.45, 3.42, 3.42], [-2.75, 3.14, 2.8]], width: 0.86, font: 0.58, facing: [0, 0.62, 0.78] },
];
const WC_CARDS = ['GROUNDWATER', 'OCEAN'];

const wcCurveOf = (points) => new THREE.CatmullRomCurve3(points.map((p) => V(...p)), false, 'centripetal');

function paintWaterArrows(ctx, w, h) {
  const rowH = h / WC_ROWS;
  WC_ARROWS.forEach((a, r) => {
    const y0 = r * rowH;
    ctx.fillStyle = a.color;
    ctx.fillRect(0, y0, w, rowH);
    // The edge stripe, top and bottom of the row: it runs the length of the shaft.
    ctx.fillStyle = a.edge;
    ctx.fillRect(0, y0, w, rowH * 0.075);
    ctx.fillRect(0, y0 + rowH * 0.925, w, rowH * 0.075);
    const curve = wcCurveOf(a.points);
    const L = curve.getLength();
    const headLen = a.width * 1.55;
    const shaftEnd = (L - headLen) / L;
    const uMid = shaftEnd * 0.54;
    const pxU = w / L;
    const pxV = rowH / a.width;
    const T = curve.getTangentAt(uMid);
    const leftward = T.x < 0;
    ctx.save();
    ctx.translate(uMid * w, y0 + rowH / 2);
    ctx.scale(pxU / 100, pxV / 100);
    if (leftward) ctx.rotate(Math.PI);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(ctx, a.text, (L - headLen - a.width * 0.5) * 100, a.font * 100, '800');
    ctx.lineJoin = 'round';
    ctx.lineWidth = 11;
    ctx.strokeStyle = a.ink;
    ctx.strokeText(a.text, 0, 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(a.text, 0, 3);
    ctx.restore();
  });
  // Cards.
  const y0 = (WC_ROWS - 1) * rowH;
  const cw = w / WC_CARDS.length;
  WC_CARDS.forEach((text, i) => {
    ctx.fillStyle = '#16233c';
    ctx.fillRect(i * cw, y0, cw, rowH);
    ctx.fillStyle = '#f7f3e5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(ctx, text, cw - 40, rowH * 0.62, '800');
    ctx.fillText(text, i * cw + cw / 2, y0 + rowH / 2 + 2);
    ctx.strokeStyle = '#f2c14e';
    ctx.lineWidth = 5;
    ctx.strokeRect(i * cw + 6, y0 + 6, cw - 12, rowH - 12);
  });
}

// One arrow: a closed solid with a bevelled edge. Its back face's u is mirrored about the middle of
// the word, so the word reads forward from behind as well. Which is what a label on a thing a student
// walks all the way round has to do.
function sweptArrow(spec, row) {
  const curve = wcCurveOf(spec.points);
  const L = curve.getLength();
  const headLen = spec.width * 1.55;
  const headW = spec.width * 0.95;
  const F = V(...(spec.facing ?? [0, 0, 1])).normalize();
  const TH = 0.1;
  const BEV = 0.07;
  const stations = [];
  const SHAFT_N = Math.max(10, Math.round((L - headLen) / 0.18));
  for (let i = 0; i <= SHAFT_N; i++) stations.push([(i / SHAFT_N) * (L - headLen), spec.width / 2]);
  stations.push([L - headLen, headW]);
  for (let i = 1; i <= 5; i++) stations.push([mix(L - headLen, L, i / 5), headW * (1 - i / 5) + 0.0012]);
  const across = [-1, -1, 1, 1];
  const inset = [0, BEV, BEV, 0];
  const frames = stations.map(([s]) => {
    const t = clamp01(s / L);
    const c = curve.getPointAt(t);
    const T = curve.getTangentAt(t);
    const N = F.clone().cross(T).normalize();
    return { c, N };
  });
  const point = (i, j, side) => {
    const { c, N } = frames[i];
    const w = Math.max(0.0005, stations[i][1] - inset[j]);
    const lift = (j === 0 || j === 3 ? TH * 0.35 : TH) * side;
    return c.clone().addScaledVector(N, across[j] * w).addScaledVector(F, lift).toArray();
  };
  const rowH = 1 / WC_ROWS;
  const v0 = 1 - (row + 1) * rowH;
  const shaftEnd = (L - headLen) / L;
  const uMid = shaftEnd * 0.54;
  const uvAt = (i, j, mirrored) => {
    const s = stations[i][0] / L;
    const w = stations[i][1];
    const lateral = clamp01(across[j] * (w - inset[j]) / spec.width + 0.5);
    // A head wider than the row keeps inside its colour rather than picking up the edge stripe twice.
    const v = w > spec.width / 2 + 1e-4 || s > shaftEnd + 1e-4 ? mix(0.12, 0.88, lateral) : lateral;
    const u = mirrored ? clamp01(2 * uMid - s) : s;
    return [u, v0 + v * rowH];
  };
  return gridSolid(stations.length - 1, 3,
    (i, j) => point(i, j, 1),
    (i, j) => point(i, j, -1),
    { uvTop: (i, j) => uvAt(i, j, false), uvBottom: (i, j) => uvAt(i, j, true), crease: 32 });
}

function cloudGeometry(cx, cy, cz, sx, sz, seed, topColor, underColor) {
  const rng = seededRandom(seed);
  const sculpt = new Sculpt(0.115);
  // A body with no sharp rim of its own: without the lumps round its edge a flat-based cloud is a saucer.
  sculpt.add(ellipsoidP([cx, cy, cz], [sx * 0.82, 0.5, sz * 0.82]), 0x000000);
  const RIM = 13;
  for (let i = 0; i < RIM; i++) {
    const a = (i / RIM) * TAU + rng() * 0.3;
    const r = 0.78 + rng() * 0.16;
    sculpt.add(sphereP([cx + Math.cos(a) * r * sx, cy - 0.08 + rng() * 0.16, cz + Math.sin(a) * r * sz], 0.36 + rng() * 0.26), 0x000000, { k: 0.14 });
  }
  const TOPS = 12;
  for (let i = 0; i < TOPS; i++) {
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * 0.74;
    const fall = 1 - r * 0.45;
    sculpt.add(sphereP([cx + Math.cos(a) * r * sx, cy + 0.26 + rng() * 0.34 * fall, cz + Math.sin(a) * r * sz], (0.42 + rng() * 0.42) * fall), 0x000000, { k: 0.1 });
  }
  // Rising air reaches the height where it condenses, which gives a real cumulus its level base, but
  // softly, or the base meets the sides in a hard rim.
  const baseY = cy - 0.36;
  sculpt.map((d, x, y) => {
    const p = baseY - y;
    const k = 0.22;
    const h = Math.max(k - Math.abs(d - p), 0) / k;
    return Math.max(d, p) + h * h * k * 0.25;
  });
  const top = lin(topColor); const under = lin(underColor);
  return polygonize(sculpt, {
    bounds: [cx - sx - 1, cy - 0.8, cz - sz - 1, cx + sx + 1, cy + 1.7, cz + sz + 1],
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const t = sstep(y - cy, -0.36, 0.35) * 0.7 + sstep(ny, -0.6, 0.5) * 0.3;
      rgb[0] = mix(under[0], top[0], t); rgb[1] = mix(under[1], top[1], t); rgb[2] = mix(under[2], top[2], t);
    },
  });
}

function buildWaterCycle() {
  const { BASE, HX, HZ, SEA, TOP_Y } = WC;
  const terrain = makeWaterTerrain();
  const { height } = terrain;
  const SECTION_W = 1024;
  const SECTION_H = 532;
  const PPF = SECTION_W / 12;
  const uvOf = (x, y) => [(x + 6) / 12, (y * PPF) / SECTION_H];

  const topUV = (x, z) => [(x + HX) / (2 * HX), 1 - (z + HZ) / (2 * HZ)];

  // --- The land --------------------------------------------------------------------------------
  const X0 = -3.9;
  const NX = 112; const NZ = 94;
  const xAt = (i) => X0 + (i / NX) * (HX - X0);
  const zAt = (j) => -HZ + (j / NZ) * 2 * HZ;
  const lp = []; const lu = []; const li = [];
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const x = xAt(i); const z = zAt(j);
      lp.push(x, height(x, z), z);
      lu.push(...topUV(x, z));
    }
  }
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = i + j * (NX + 1); const b = a + 1; const c = a + NX + 1; const d = c + 1;
      li.push(a, c, b, b, c, d);
    }
  }
  const land = new THREE.BufferGeometry();
  land.setIndex(li);
  land.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  land.setAttribute('uv', new THREE.Float32BufferAttribute(lu, 2));
  land.computeVertexNormals();

  // --- The sea and the river -------------------------------------------------------------------
  const water = [];
  const SX1 = -0.6;
  const wp = []; const wu = []; const wi = [];
  const SNX = 26; const SNZ = 20;
  for (let j = 0; j <= SNZ; j++) {
    for (let i = 0; i <= SNX; i++) {
      const x = -HX + (i / SNX) * (SX1 + HX); const z = -HZ + (j / SNZ) * 2 * HZ;
      wp.push(x, SEA, z);
      wu.push(...topUV(x, z));
    }
  }
  for (let j = 0; j < SNZ; j++) {
    for (let i = 0; i < SNX; i++) {
      const a = i + j * (SNX + 1); const b = a + 1; const c = a + SNX + 1; const d = c + 1;
      wi.push(a, c, b, b, c, d);
    }
  }
  const seaTop = new THREE.BufferGeometry();
  seaTop.setIndex(wi);
  seaTop.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  seaTop.setAttribute('uv', new THREE.Float32BufferAttribute(wu, 2));
  seaTop.computeVertexNormals();
  water.push({ geometry: seaTop, keepColor: true });

  // The river is a ribbon lying in the channel the terrain cut for it, widening toward the sea, and
  // its colour comes from a patch of open water on the same sheet.
  const riverPts = terrain.river;
  const rp = []; const ru = []; const ri = [];
  const seaUV = topUV(-5.4, -3.2);
  const RN = riverPts.length - 1;
  for (let k = 0; k <= RN; k++) {
    const [x, z] = riverPts[k];
    const [px, pz] = riverPts[Math.max(0, k - 1)];
    const [qx, qz] = riverPts[Math.min(RN, k + 1)];
    const tx = qx - px; const tz = qz - pz;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len; const nz = tx / len;
    const f = k / RN;
    const hw = mix(0.07, 0.25, f);
    const y = Math.max(SEA + 0.008, height(x, z) + 0.03);
    rp.push(x + nx * hw, y, z + nz * hw, x - nx * hw, y, z - nz * hw);
    ru.push(...seaUV, ...seaUV);
  }
  for (let k = 0; k < RN; k++) {
    const a = k * 2; const b = a + 1; const c = a + 2; const d = a + 3;
    ri.push(a, b, d, a, d, c);
  }
  const ribbon = new THREE.BufferGeometry();
  ribbon.setIndex(ri);
  ribbon.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  ribbon.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2));
  ribbon.computeVertexNormals();
  // Measured, since its direction decides which way it faces.
  if (ribbon.attributes.normal.getY(0) < 0) {
    for (let t = 0; t < ri.length; t += 3) { const b = ri[t + 1]; ri[t + 1] = ri[t + 2]; ri[t + 2] = b; }
    ribbon.setIndex(ri);
    ribbon.computeVertexNormals();
  }
  water.push({ geometry: ribbon, keepColor: true });

  // --- The cut sides, sharing the land's edge rows ----------------------------------------------
  const section = [];
  const flatFace = (count, pointAt, uAt, normal) => {
    const p = []; const u = []; const n = []; const ii = [];
    for (let k = 0; k <= count; k++) {
      const [x, z] = pointAt(k);
      const top = Math.max(height(x, z), SEA);
      const [uu, v0] = uvOf(uAt(x), BASE);
      const [, v1] = uvOf(uAt(x), top);
      p.push(x, top, z, x, BASE, z);
      u.push(uu, v1, uu, v0);
      n.push(...normal, ...normal);
    }
    for (let k = 0; k < count; k++) {
      const a = k * 2; const b = a + 1; const c = a + 2; const d = a + 3;
      ii.push(a, b, d, a, d, c);
    }
    const P = new THREE.Float32BufferAttribute(p, 3);
    const A = V().fromBufferAttribute(P, ii[0]); const B = V().fromBufferAttribute(P, ii[1]); const C = V().fromBufferAttribute(P, ii[2]);
    const flip = B.sub(A).cross(C.sub(A)).dot(V(...normal)) < 0;
    const g = new THREE.BufferGeometry();
    g.setIndex(flip ? ii.map((_, t) => ii[t % 3 === 1 ? t + 1 : t % 3 === 2 ? t - 1 : t]) : ii);
    g.setAttribute('position', P);
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    return g;
  };
  const edgeXs = [...Array.from({ length: 11 }, (_, i) => -HX + (i / 11) * (X0 + HX)), ...Array.from({ length: NX + 1 }, (_, i) => xAt(i))];
  section.push({ geometry: flatFace(edgeXs.length - 1, (k) => [edgeXs[k], HZ], (x) => x, [0, 0, 1]), keepColor: true });
  section.push({ geometry: flatFace(edgeXs.length - 1, (k) => [edgeXs[k], -HZ], (x) => x, [0, 0, -1]), keepColor: true });
  section.push({ geometry: flatFace(NZ, (k) => [HX, zAt(k)], () => HX - 0.02, [1, 0, 0]), keepColor: true });
  section.push({ geometry: flatFace(NZ, (k) => [-HX, zAt(k)], () => -HX + 0.02, [-1, 0, 0]), keepColor: true });

  // --- The four arrows, the two cards ----------------------------------------------------------
  const arrows = WC_ARROWS.map((spec, row) => ({ geometry: sweptArrow(spec, row), keepColor: true }));
  const cardUV = (i) => {
    const n = WC_CARDS.length;
    return [i / n + 0.002, 0.002, (i + 1) / n - 0.002, 1 / WC_ROWS - 0.002];
  };
  arrows.push({ geometry: labelCard(1.8, 1.72, HZ, 2.2, 0.38, 0.035, cardUV(0)), keepColor: true });
  arrows.push({ geometry: labelCard(-4.6, 2.08, HZ, 1.15, 0.36, 0.035, cardUV(1)), keepColor: true });

  // --- What stands on the land -----------------------------------------------------------------
  const solids = [];
  const STALK = 0x79828d;
  const rng = seededRandom(1776);
  const riverClear = (x, z, m) => terrain.riverDist(x, z)[0] > m;

  // Trees: conifers on the lower mountain, broadleaf round the fields.
  let placed = 0;
  for (let n = 0; n < 1600 && placed < 84; n++) {
    const x = -2.2 + rng() * 7.9;
    const z = -HZ + 0.15 + rng() * (2 * HZ - 0.3);
    const y = height(x, z);
    const lift = y - SEA;
    if (lift < 0.14 || lift > 2.1 || !riverClear(x, z, 0.32)) continue;
    const inFields = lift < 0.8 && x > -1.5 && x < 2.2 && z > -1.8;
    if (inFields && rng() > 0.1) continue;
    const s = 0.34 + rng() * 0.26;
    if (lift > 0.75) {
      const c = rng() > 0.5 ? 0x25602b : 0x30703a;
      solids.push({ geometry: new THREE.ConeGeometry(s * 0.34, s * 0.78, 7).translate(x, y + s * 0.5, z), color: c });
      solids.push({ geometry: new THREE.ConeGeometry(s * 0.25, s * 0.6, 7).translate(x, y + s * 0.86, z), color: c });
    } else {
      solids.push({ geometry: new THREE.IcosahedronGeometry(s * 0.34, 1).scale(1, 0.9, 1).translate(x, y + s * 0.42, z), color: rng() > 0.5 ? 0x4c8f35 : 0x63a33e });
      solids.push({ geometry: new THREE.CylinderGeometry(s * 0.04, s * 0.06, s * 0.3, 5).translate(x, y + s * 0.12, z), color: 0x4e3a27 });
    }
    placed++;
  }
  // A farm, for a sense of scale.
  const FX = 0.85; const FZ = -0.7;
  const farmY = height(FX, FZ);
  solids.push({ geometry: new THREE.BoxGeometry(0.62, 0.34, 0.42).translate(FX, farmY + 0.17, FZ), color: 0xb5372a });
  solids.push({ geometry: new THREE.ConeGeometry(0.42, 0.26, 4).rotateY(Math.PI / 4).scale(1.05, 1, 0.72).translate(FX, farmY + 0.47, FZ), color: 0x4f4a48 });
  solids.push({ geometry: new THREE.CylinderGeometry(0.11, 0.11, 0.6, 12).translate(FX + 0.45, farmY + 0.3, FZ - 0.05), color: 0xc8c6c0 });
  solids.push({ geometry: new THREE.SphereGeometry(0.11, 12, 6, 0, TAU, 0, Math.PI / 2).translate(FX + 0.45, farmY + 0.6, FZ - 0.05), color: 0x8f8c86 });

  // The clouds, each carried on one thin stalk from the back of the land.
  const CLOUD1 = [-0.85, 10.55, 0.1];
  const CLOUD2 = [3.7, 10.15, -0.2];
  solids.push({ geometry: cloudGeometry(CLOUD1[0], CLOUD1[1], CLOUD1[2], 2.2, 1.35, 77, 0xf0f3f6, 0xd4dae1), keepColor: true });
  solids.push({ geometry: cloudGeometry(CLOUD2[0], CLOUD2[1], CLOUD2[2], 2.5, 1.55, 91, 0x9aa6b3, 0x6d7885), keepColor: true });
  const stalk = (x, z, yTop) => {
    const y = height(x, z);
    solids.push({ geometry: rod([x, y - 0.1, z], [x, yTop, z], 0.035, 8), color: STALK });
    solids.push({ geometry: new THREE.CylinderGeometry(0.14, 0.18, 0.08, 12).translate(x, y + 0.03, z), color: STALK });
  };
  stalk(-1.1, -2.2, CLOUD1[1]);
  stalk(5.0, -2.6, CLOUD2[1]);

  // Real rain, each drop a thin capped streak, falling at one slant and stopping above the ground.
  const STREAK = 0x3fa2ff;
  for (let n = 0; n < 84; n++) {
    const x = CLOUD2[0] - 2.1 + rng() * 4.2;
    const z = CLOUD2[2] - 1.3 + rng() * 2.6;
    const ground = height(x, z);
    const yMax = CLOUD2[1] - 0.36;
    if (yMax - ground < 0.9) continue;
    const y = ground + 0.35 + rng() * (yMax - ground - 0.9);
    const L = 0.42 + rng() * 0.3;
    solids.push({ geometry: rod([x, y + L, z], [x - L * 0.14, y, z], 0.026, 5), color: STREAK });
  }

  // Vapour off the sea: thin rising wisps beside the arrow that names them.
  for (let n = 0; n < 7; n++) {
    const x0 = -5.5 + rng() * 2.2;
    const z0 = 0.9 + rng() * 2.6;
    const pts = [];
    const H = 0.9 + rng() * 1;
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push([x0 + Math.sin(t * 7 + n) * 0.08, SEA - 0.03 + t * H, z0 + Math.cos(t * 6 + n) * 0.06]);
    }
    solids.push({ geometry: tube(pts, [0.03, 0.034, 0.03, 0.022, 0.012], { sides: 5, steps: 14, round: 1 }), color: 0xf5fbff });
  }

  // Three short stalks for the arrow that lies over the land, and one for the one in front of the cloud.
  const runoff = wcCurveOf(WC_ARROWS[3].points);
  for (const t of [0.2, 0.55, 0.86]) {
    const p = runoff.getPointAt(t);
    const y = Math.max(SEA, height(p.x, p.z));
    solids.push({ geometry: rod([p.x, y - 0.05, p.z], [p.x, p.y, p.z], 0.045, 8), color: STALK });
  }

  // The plinth.
  solids.push({ geometry: new THREE.BoxGeometry(2 * HX + 0.6, BASE - 0.02, 2 * HZ + 0.6).translate(0, (BASE - 0.02) / 2, 0), color: 0x2d3440 });
  solids.push({ geometry: new THREE.BoxGeometry(2 * HX + 0.26, 0.04, 2 * HZ + 0.26).translate(0, BASE - 0.015, 0), color: 0xc0984c });

  // --- The Sun, on its stalk from the far corner of the sea ------------------------------------
  const SUN = [-4.95, 10.7, -2.5];
  const sun = [];
  sun.push({ geometry: new THREE.SphereGeometry(1.02, 40, 24).translate(SUN[0], SUN[1], SUN[2]), color: 0xffd23a });
  const RAYS = 16;
  for (let k = 0; k < RAYS; k++) {
    const a = (k / RAYS) * TAU;
    const longRay = k % 2 === 0;
    const from = [SUN[0] + Math.cos(a) * 0.9, SUN[1] + Math.sin(a) * 0.9, SUN[2]];
    const to = [SUN[0] + Math.cos(a) * (longRay ? 1.95 : 1.55), SUN[1] + Math.sin(a) * (longRay ? 1.95 : 1.55), SUN[2]];
    sun.push({ geometry: rod(from, to, [0.2, 0.012], 8, 0), color: 0xffb52e });
  }
  solids.push({ geometry: rod([SUN[0], SEA - 0.1, SUN[2]], [SUN[0], SUN[1] - 0.8, SUN[2]], 0.04, 8), color: STALK });

  const sectionMap = canvasTexture(SECTION_W, SECTION_H, (ctx, w, h) => paintWaterSection(ctx, w, h, height));
  const topMap = canvasTexture(1024, 683, (ctx, w, h) => paintWaterTop(ctx, w, h, terrain));
  const arrowMap = canvasTexture(1024, 640, paintWaterArrows);

  const root = new THREE.Group();
  root.add(
    mesh(mergeParts(section), standard({ map: sectionMap, roughness: 0.9, metalness: 0 })),
    mesh(mergeParts([{ geometry: land, keepColor: true }]), standard({ map: topMap, roughness: 0.92, metalness: 0 })),
    mesh(mergeParts(water), standard({ map: topMap.clone(), roughness: 0.24, metalness: 0.06 })),
    mesh(mergeParts(arrows), standard({ map: arrowMap, roughness: 0.46, metalness: 0 })),
    mesh(mergeParts(solids), standard({ vertexColors: true, roughness: 0.68, metalness: 0 })),
    mesh(mergeParts(sun), standard({ vertexColors: true, roughness: 0.5, metalness: 0, emissive: 0xffb020, emissiveIntensity: 0.85 })),
  );
  return root;
}

export const BUILDERS = {
  'saturn-planet': () => buildSaturn(),
  'hubble-telescope': () => buildHubble(),
  'voyager-probe': () => buildVoyager(),
  'rock-strata-block': () => buildRockStrata(),
  'plate-boundary-block': () => buildPlateBoundary(),
  'water-cycle-diorama': () => buildWaterCycle(),
};
