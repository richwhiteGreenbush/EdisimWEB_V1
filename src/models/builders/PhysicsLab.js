import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, standard, canvasTexture, seededRandom } from '../../PropKit.js';
import { mergeParts } from '../../props/LoftKit.js';
import { tube, outward, alongMatrix, signedVolume, tintVertices, lin, clamp01, mix, sstep } from '../ModelKit.js';
import { reducedMotion } from '../../Settings.js';

// The Model Database's physics bench: a Van de Graaff generator, a Foucault pendulum, an Archimedes
// screw, Galileo's ramp and Young's double slit. Authored in feet, origin at the base centre, front
// toward +Z. Every number a card or a mark depends on is computed here from the real rule, and the
// tables below are exported so a script can hold them to that rule.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const FONT = 'Arial, Helvetica, sans-serif';

// ---------------------------------------------------------------------------------------------
// Painting. A canvas holds sRGB bytes, so colours here are written as they should appear.
// ---------------------------------------------------------------------------------------------
function paintTexels(ctx, x0, y0, w, h, fn) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const out = [0, 0, 0];
  let o = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      fn(x, y, out);
      d[o++] = out[0]; d[o++] = out[1]; d[o++] = out[2]; d[o++] = 255;
    }
  }
  ctx.putImageData(img, x0, y0);
}

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

function fitFont(ctx, text, maxWidth, size, weight = '700', family = FONT) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  const width = ctx.measureText(text).width;
  if (width > maxWidth) { s = (s * maxWidth) / width; ctx.font = `${weight} ${s}px ${family}`; }
  return s;
}

const dataTexture = (texture) => { texture.colorSpace = THREE.NoColorSpace; return texture; };
function wrapRepeat(texture, rx = 1, ry = 1) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(rx, ry);
  return texture;
}

// Value noise that wraps at nx by ny cells, so that a tile built from it has no seam.
function periodicNoise(seed, nx, ny) {
  const rng = seededRandom(seed);
  const L = new Float32Array(nx * ny);
  for (let i = 0; i < L.length; i++) L[i] = rng();
  return (u, v) => {
    const x = u * nx; const y = v * ny;
    const xi = Math.floor(x); const yi = Math.floor(y);
    let fx = x - xi; let fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % nx) + nx) % nx; const y0 = ((yi % ny) + ny) % ny;
    const x1 = (x0 + 1) % nx; const y1 = (y0 + 1) % ny;
    const a = L[x0 + y0 * nx]; const b = L[x1 + y0 * nx];
    const c = L[x0 + y1 * nx]; const d = L[x1 + y1 * nx];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

// Near-white grain running along u, to multiply a timber's vertex colour. Its u and v are in feet
// (timber() lays them so), and the tile is 4ft by 1.4ft.
function paintWoodGrain(ctx, w, h, seed) {
  const rough = periodicNoise(seed, 2, 5);
  const fine = periodicNoise(seed + 1, 2, 44);
  const finer = periodicNoise(seed + 2, 9, 170);
  paintTexels(ctx, 0, 0, w, h, (x, y, out) => {
    const u = x / w; const v = y / h;
    const warp = (rough(u, v) - 0.5) * 1.6;
    const ring = Math.sin((v * 9 + warp * 1.4) * TAU);
    const grain = (fine(u, v) - 0.5) * 0.42 + (finer(u, v) - 0.5) * 0.26;
    const k = clamp01(0.84 + ring * 0.05 + grain * 0.5);
    out[0] = 255 * k; out[1] = 243 * k; out[2] = 226 * k;
  });
}
function woodMaterial(seed, { roughness = 0.62, bumpScale = 0.45 } = {}) {
  const map = wrapRepeat(canvasTexture(512, 512, (c, w, h) => paintWoodGrain(c, w, h, seed)), 1 / 4, 1 / 1.4);
  return standard({ vertexColors: true, map, roughness, metalness: 0, bumpMap: dataTexture(map.clone()), bumpScale });
}

// ---------------------------------------------------------------------------------------------
// Solids
// ---------------------------------------------------------------------------------------------

// Triangles as flat arrays of position and uv, measured outward and given creased normals.
function soup(pos, uv, crease = 30) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (signedVolume(g) < 0) {
    for (const [array, size] of [[pos, 3], [uv, 2]]) {
      for (let t = 0; t < array.length; t += size * 3) {
        for (let k = 0; k < size; k++) {
          const a = t + size + k; const b = t + size * 2 + k;
          const v = array[a]; array[a] = array[b]; array[b] = v;
        }
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  }
  return toCreasedNormals(g, crease * DEG);
}

// A closed slab between two matching grids. Wound by construction and turned outward by measuring,
// because which way it comes out depends on the handedness of the caller's (i, j).
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
  return soup(pos, uvs, crease);
}

// A solid of revolution about +Y, written bottom-up. It may end on the axis or close on itself.
function turned(profile, segments, { uTiles = 1, vScale = 1, crease = 28 } = {}) {
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
      const a = (j / segments) * TAU;
      pos.push(r * Math.sin(a), y, r * Math.cos(a));
      uv.push((j / segments) * uTiles, s * vScale);
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

const rod = (a, b, r, sides = 8, round = 1) => tube([a, b], r, { straight: true, steps: 1, sides, round });

function ball(r, at, detail = 16) {
  const g = new THREE.SphereGeometry(r, detail, Math.max(6, Math.round(detail * 0.66)));
  g.translate(at[0], at[1], at[2]);
  return g;
}

function block(x0, y0, z0, x1, y1, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

// A squared timber with chamfered arrises between two points. UVs are in feet, with the grain along u.
function timber(a, b, w, h = w, { up = [0, 1, 0], chamfer = null, seed = 0 } = {}) {
  const { m, len } = alongMatrix(a, b, up);
  const c = chamfer ?? Math.min(w, h) * 0.09;
  const hw = w / 2; const hh = h / 2;
  const sec = [[hw - c, -hh], [hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c], [-hw + c, -hh]];
  const pos = []; const uv = [];
  const put = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u + seed * 0.73, v + seed * 0.37); };
  let per = 0;
  for (let i = 0; i < 8; i++) {
    const [x0, y0] = sec[i]; const [x1, y1] = sec[(i + 1) % 8];
    const l = Math.hypot(x1 - x0, y1 - y0);
    put(x0, y0, 0, 0, per); put(x1, y1, 0, 0, per + l); put(x1, y1, len, len, per + l);
    put(x0, y0, 0, 0, per); put(x1, y1, len, len, per + l); put(x0, y0, len, len, per);
    per += l;
  }
  for (let i = 0; i < 8; i++) {
    const [x0, y0] = sec[i]; const [x1, y1] = sec[(i + 1) % 8];
    put(0, 0, 0, 0.2, 0.2); put(x1, y1, 0, 0.2 + x1 * 0.2, 0.2 + y1); put(x0, y0, 0, 0.2 + x0 * 0.2, 0.2 + y0);
    put(0, 0, len, 0.2, 0.2); put(x0, y0, len, 0.2 + x0 * 0.2, 0.2 + y0); put(x1, y1, len, 0.2 + x1 * 0.2, 0.2 + y1);
  }
  const g = soup(pos, uv, 24);
  g.applyMatrix4(m);
  return g;
}

function standAt(p, dir) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, V(dir[0], dir[1], dir[2]).normalize());
  return new THREE.Matrix4().compose(V(p[0], p[1], p[2]), q, V(1, 1, 1));
}
const stood = (g, p, dir = [0, 1, 0]) => { g.applyMatrix4(standAt(p, dir)); return g; };
// A turned thing whose axis should run along +X, with its own bottom toward -X.
const alongX = (g) => { g.rotateZ(-Math.PI / 2); return g; };

// A flat printed plate, its face on +Z and its back at z = -depth, centre at the origin.
function printedPlate(w, h, depth, [u0, v0, u1, v1]) {
  const hw = w / 2; const hh = h / 2;
  const pos = []; const uv = [];
  const rimU = u0 + 0.002; const rimV = v0 + 0.002;
  const put = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u, v); };
  const quad = (a, b, c, d) => { for (const p of [a, b, c, a, c, d]) put(...p); };
  quad([-hw, -hh, 0, u0, v0], [hw, -hh, 0, u1, v0], [hw, hh, 0, u1, v1], [-hw, hh, 0, u0, v1]);
  quad([-hw, hh, -depth, rimU, rimV], [hw, hh, -depth, rimU, rimV], [hw, -hh, -depth, rimU, rimV], [-hw, -hh, -depth, rimU, rimV]);
  quad([-hw, -hh, -depth, rimU, rimV], [hw, -hh, -depth, rimU, rimV], [hw, -hh, 0, rimU, rimV], [-hw, -hh, 0, rimU, rimV]);
  quad([hw, hh, -depth, rimU, rimV], [-hw, hh, -depth, rimU, rimV], [-hw, hh, 0, rimU, rimV], [hw, hh, 0, rimU, rimV]);
  quad([hw, -hh, -depth, rimU, rimV], [hw, hh, -depth, rimU, rimV], [hw, hh, 0, rimU, rimV], [hw, -hh, 0, rimU, rimV]);
  quad([-hw, hh, -depth, rimU, rimV], [-hw, -hh, -depth, rimU, rimV], [-hw, -hh, 0, rimU, rimV], [-hw, hh, 0, rimU, rimV]);
  return soup(pos, uv, 30);
}

// Colour by what a polished surface would reflect, by its own normal: sky above a dark horizon and a
// floor below. There is no environment map anywhere in this app, so a mirror finish has to be painted.
function polishInto(nx, ny, nz, out, [r, g, b], lift = 1) {
  const az = Math.atan2(nx, nz);
  const hz = 0.02 + 0.03 * Math.sin(az * 2 + 0.7) + 0.012 * Math.sin(az * 5 + 2.1);
  const skyT = clamp01((ny - hz) / (1 - hz));
  const groundT = clamp01((hz - ny) / (1 + hz));
  const sky = mix(1.08, 0.5, skyT ** 0.55);
  const ground = mix(0.2, 0.62, groundT ** 0.7);
  const k = mix(ground, sky, sstep(ny - hz, -0.035, 0.05)) * lift;
  out[0] = clamp01(r * k); out[1] = clamp01(g * k); out[2] = clamp01(b * k);
}
function polished(geometry, color, lift = 1) {
  const nrm = geometry.attributes.normal;
  const arr = new Float32Array(nrm.count * 3);
  const out = [1, 1, 1];
  const c = Array.isArray(color) ? color : lin(color);
  for (let i = 0; i < nrm.count; i++) {
    polishInto(nrm.getX(i), nrm.getY(i), nrm.getZ(i), out, c, lift);
    arr[i * 3] = out[0]; arr[i * 3 + 1] = out[1]; arr[i * 3 + 2] = out[2];
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return { geometry, keepColor: true };
}

// A polyline as a closed, sharp-cornered tube, which is what a spark is.
function boltSolid(pts, radii, sides = 5) {
  const pos = [];
  const idx = [];
  const n = pts.length;
  let N = Math.abs(pts[1].clone().sub(pts[0]).normalize().y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(n - 1, i + 1)];
    const T = b.clone().sub(a).normalize();
    N = N.clone().addScaledVector(T, -N.dot(T)).normalize();
    const B = V().crossVectors(T, N);
    for (let j = 0; j < sides; j++) {
      const an = (j / sides) * TAU;
      const c = Math.cos(an) * radii[i]; const s = Math.sin(an) * radii[i];
      pos.push(pts[i].x + N.x * c + B.x * s, pts[i].y + N.y * c + B.y * s, pts[i].z + N.z * c + B.z * s);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      const p = i * sides + j; const q = i * sides + j2; const r = (i + 1) * sides + j2; const s = (i + 1) * sides + j;
      idx.push(p, q, r, p, r, s);
    }
  }
  const c0 = pos.length / 3; pos.push(pts[0].x, pts[0].y, pts[0].z);
  const c1 = pos.length / 3; pos.push(pts[n - 1].x, pts[n - 1].y, pts[n - 1].z);
  for (let j = 0; j < sides; j++) {
    const j2 = (j + 1) % sides;
    idx.push(c0, j2, j);
    idx.push(c1, (n - 1) * sides + j, (n - 1) * sides + j2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return outward(g);
}

// A big polished sphere shows its whole surroundings at once, so its horizon cannot be one hard line
// or the ball reads as two-tone. Pale overhead, brightest toward the horizon, a soft dark band just
// under it, and the floor's light coming back up from below.
function domePolish(geometry, color, lift = 1) {
  const nrm = geometry.attributes.normal;
  const arr = new Float32Array(nrm.count * 3);
  const [r, g, b] = Array.isArray(color) ? color : lin(color);
  for (let i = 0; i < nrm.count; i++) {
    const nx = nrm.getX(i); const ny = nrm.getY(i); const nz = nrm.getZ(i);
    const az = Math.atan2(nx, nz);
    const hz = 0.05 + 0.04 * Math.sin(az * 2 + 0.7) + 0.02 * Math.sin(az * 5 + 2.1);
    const up = ny - hz;
    let k;
    if (up >= 0) k = mix(1.18, 0.66, clamp01(up / (1 - hz)) ** 0.7);
    else k = mix(0.3, 0.86, clamp01(-up / (1 + hz)) ** 0.62);
    // The soft edge between the two, and a pale window in the sky, as a room has.
    k = mix(k, 0.3, 1 - sstep(Math.abs(up), 0.0, 0.11));
    const w = sstep(nz, 0.28, 0.42) * sstep(ny, 0.3, 0.42) * (1 - sstep(ny, 0.66, 0.74)) * sstep(nx, -0.3, -0.2) * (1 - sstep(nx, 0.12, 0.2));
    k = mix(k, 1.32, w * 0.55);
    k *= lift;
    arr[i * 3] = clamp01(r * k); arr[i * 3 + 1] = clamp01(g * k); arr[i * 3 + 2] = clamp01(b * k);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return { geometry, keepColor: true };
}

function noShadow(m) { m.castShadow = false; m.receiveShadow = false; return m; }

// ===========================================================================================
// THE VAN DE GRAAFF GENERATOR
// ===========================================================================================
//
// The belt is a real closed band over two real rollers. A real machine hides its upper roller inside
// the dome, and here it sits just under the dome's mouth so that the cut-away can show it, with a
// bright strap running from the upper comb up into the dome to show where the charge goes.

const VG = {
  CX: -0.72, BASE: 0.42,
  COL_R: 0.62, COL_IN: 0.575, CUT: 68 * DEG,
  DOME_R: 1.45, DOME_Y: 6.55, MOUTH: 0.72,
  ROLL_LO: 1.08, ROLL_HI: 4.68, ROLL_R: 0.2, ROLL_HALF: 0.31,
  BELT_HALF: 0.21, BELT_T: 0.035,
  COMB_LO: 1.68, COMB_HI: 4.12, POINTS: 11,
  SPHERE_R: 0.5, SPHERE_Y: 6.22, GAP: 0.74,
};

function vdgBelt() {
  const { ROLL_LO, ROLL_HI, ROLL_R, BELT_HALF, BELT_T } = VG;
  // The loop in the (y, z) plane: up the front run, over the top roller, down the back, round the bottom.
  const stations = [];
  const ARC = 18;
  const STRAIGHT = 10;
  const addArc = (cy, a0, a1) => {
    for (let i = 0; i <= ARC; i++) {
      const a = mix(a0, a1, i / ARC);
      stations.push([cy, Math.sin(a), Math.cos(a)]);
    }
  };
  // Each station is a roller centre and an outward unit (sin, cos), meaning y and z.
  addArc(ROLL_LO, -Math.PI / 2 - 0.0001, 0);
  for (let i = 1; i < STRAIGHT; i++) stations.push([mix(ROLL_LO, ROLL_HI, i / STRAIGHT), 0, 1]);
  addArc(ROLL_HI, 0, Math.PI);
  for (let i = 1; i < STRAIGHT; i++) stations.push([mix(ROLL_HI, ROLL_LO, i / STRAIGHT), 0, -1]);
  addArc(ROLL_LO, Math.PI, Math.PI * 1.5 - 0.0002);
  const n = stations.length - 1;
  const at = (i, j, r) => {
    const [cy, sy, cz] = stations[i];
    return [mix(-BELT_HALF, BELT_HALF, j), cy + sy * r, cz * r];
  };
  return gridSolid(n, 1, (i, j) => at(i, j, ROLL_R + BELT_T), (i, j) => at(i, j, ROLL_R + 0.002), { crease: 40 });
}

function buildVanDeGraaff() {
  const { CX, BASE, COL_R, COL_IN, CUT, DOME_R, DOME_Y, MOUTH, ROLL_LO, ROLL_HI, ROLL_R, ROLL_HALF, COMB_LO, COMB_HI, POINTS, SPHERE_R, SPHERE_Y, GAP } = VG;
  const root = new THREE.Group();
  const wood = [];
  const paint = [];
  const metal = [];
  const clear = [];
  const col = (x, y, z) => [CX + x, y, z];
  const STEEL = 0xd2d6db; const BRASS = 0xd9ab45; const DARK = 0x23262b; const ENAMEL = 0x2d4a63; const PALE = 0xece6d6;
  const shine = (g, color = STEEL, lift = 1) => metal.push(polished(g, color, lift));

  // --- The base: a walnut board and an enamelled plinth ---
  wood.push({ geometry: timber([-2.85, 0.1, 0], [2.85, 0.1, 0], 3.3, 0.2, { chamfer: 0.035 }), color: 0x6d452a });
  paint.push({ geometry: timber([-2.68, 0.31, 0], [2.68, 0.31, 0], 2.96, 0.22, { chamfer: 0.04 }), color: ENAMEL });

  // --- The column: clear, with its +Z side cut away ---
  const cutFrom = CUT; const cutTo = TAU - CUT;
  const Y0 = BASE + 0.34; const Y1 = 5.22;
  {
    const az = (i) => mix(cutFrom, cutTo, i / 56);
    const shell = (r) => (i, j) => { const a = az(i); return col(r * Math.sin(a), j ? Y1 : Y0, r * Math.cos(a)); };
    clear.push({ geometry: gridSolid(56, 1, shell(COL_R), shell(COL_IN), { crease: 40 }), color: 0xeef2ee });
    const ring = (y0, y1) => {
      const g = turned([[COL_IN, y0], [COL_R, y0], [COL_R, y1], [COL_IN, y1], [COL_IN, y0]], 64, { crease: 40 });
      g.translate(CX, 0, 0);
      return g;
    };
    clear.push({ geometry: ring(BASE, Y0), color: 0xdcecf4 });
    clear.push({ geometry: ring(Y1, 5.62), color: 0xdcecf4 });
    // A pale opaque bead down each cut edge, so the shape of the cut can be read against anything.
    for (const a of [cutFrom, cutTo]) {
      const r = (COL_R + COL_IN) / 2;
      paint.push({ geometry: rod(col(r * Math.sin(a), Y0, r * Math.cos(a)), col(r * Math.sin(a), Y1, r * Math.cos(a)), 0.032, 8, 1), color: PALE });
    }
    for (const y of [Y0, Y1]) {
      const g = turned([[COL_R - 0.05, y - 0.05], [COL_R + 0.025, y - 0.05], [COL_R + 0.025, y + 0.05], [COL_R - 0.05, y + 0.05], [COL_R - 0.05, y - 0.05]], 64, { crease: 40 });
      g.translate(CX, 0, 0);
      paint.push({ geometry: g, color: PALE });
    }
  }
  // The foot flange it stands in, on the plinth.
  {
    const g = turned([[0, BASE - 0.02], [0.95, BASE - 0.02], [0.95, BASE + 0.05], [0.9, BASE + 0.09], [0.68, BASE + 0.12], [0.66, BASE + 0.2], [0.58, BASE + 0.2], [0.58, BASE + 0.06], [0, BASE + 0.06]], 56);
    g.translate(CX, 0, 0);
    shine(g, 0xb9bec5);
    const rng = 8;
    for (let i = 0; i < rng; i++) {
      const a = (i + 0.5) / rng * TAU;
      shine(ball(0.035, col(0.82 * Math.sin(a), BASE + 0.1, 0.82 * Math.cos(a)), 8), 0x8e949b);
    }
  }

  // --- The belt, the rollers and their axles ---
  {
    const belt = vdgBelt();
    belt.translate(CX, 0, 0);
    paint.push({ geometry: belt, color: 0x6b3d24 });
    // The joint in the belt: a darker lap across it, on the run that faces the student.
    paint.push({ geometry: block(CX - VG.BELT_HALF - 0.002, 2.74, ROLL_R + VG.BELT_T - 0.004, CX + VG.BELT_HALF + 0.002, 2.86, ROLL_R + VG.BELT_T + 0.008), color: 0x3b2114 });
    // A roller crowned in the middle, which is what keeps a real belt from walking off.
    const rollerProfile = (R) => [[0, -ROLL_HALF], [R * 0.86, -ROLL_HALF], [R * 0.95, -ROLL_HALF + 0.015], [R * 0.97, -0.16], [R, 0], [R * 0.97, 0.16], [R * 0.95, ROLL_HALF - 0.015], [R * 0.86, ROLL_HALF], [0, ROLL_HALF]];
    const lo = alongX(turned(rollerProfile(ROLL_R), 40));
    lo.translate(CX, ROLL_LO, 0);
    shine(lo, 0xc7ccd2);
    const hi = alongX(turned(rollerProfile(ROLL_R), 40));
    hi.translate(CX, ROLL_HI, 0);
    paint.push({ geometry: hi, color: PALE });
    for (const y of [ROLL_LO, ROLL_HI]) {
      shine(rod(col(-0.7, y, 0), col(0.7, y, 0), 0.042, 12, 1), 0xb4b9c0);
      for (const s of [-1, 1]) {
        // A bearing block let into the column wall on each side.
        paint.push({ geometry: timber(col(s * (COL_R - 0.05), y, 0), col(s * (COL_R + 0.11), y, 0), 0.26, 0.26, { chamfer: 0.03 }), color: PALE });
      }
    }
  }

  // --- The combs: a bar and a row of needles aimed at the belt, stopping just short of it ---
  {
    const beltFace = ROLL_R + VG.BELT_T;
    const TIP_GAP = 0.018;
    const BAR_Z = beltFace + TIP_GAP + 0.19;
    for (const y of [COMB_LO, COMB_HI]) {
      shine(rod(col(-0.4, y, BAR_Z), col(0.4, y, BAR_Z), 0.024, 8, 1), BRASS);
      for (let i = 0; i < POINTS; i++) {
        const x = mix(-0.2, 0.2, i / (POINTS - 1));
        const tubeG = tube([col(x, y, BAR_Z), col(x, y, beltFace + TIP_GAP)], [0.016, 0], { straight: true, steps: 1, sides: 6, round: 0 });
        shine(tubeG, 0xeadfb8, 1.05);
      }
      for (const s of [-1, 1]) {
        const a = s > 0 ? cutFrom : cutTo;
        const r = (COL_R + COL_IN) / 2;
        const edge = col(r * Math.sin(a), y, r * Math.cos(a));
        shine(rod(col(s * 0.4, y, BAR_Z), edge, 0.018, 6, 1), BRASS);
        shine(ball(0.034, col(s * 0.4, y, BAR_Z), 8), BRASS);
        shine(ball(0.04, edge, 8), BRASS);
      }
    }
    if (POINTS !== 11) throw new Error('van-de-graaff: comb count');
    // The upper comb's strap, up the inside of the cut and into the dome, where the charge goes.
    const strapPts = [col(0.3, COMB_HI, BAR_Z), col(0.32, 4.6, BAR_Z + 0.1), col(0.3, 5.3, 0.36), col(0.24, 5.9, 0.28)];
    shine(tube(strapPts, 0.016, { steps: 18, sides: 6, round: 1 }), BRASS, 1.05);
    // The lower comb's lead, down to the base.
    const leadPts = [col(-0.3, COMB_LO, BAR_Z), col(-0.42, 1.2, BAR_Z + 0.08), col(-0.5, BASE + 0.3, 0.42), col(-0.5, BASE + 0.04, 0.48)];
    shine(tube(leadPts, 0.016, { steps: 18, sides: 6, round: 1 }), BRASS, 1.05);
  }

  // --- The motor on the -X side, driving the lower roller directly ---
  {
    const L = 1.02; const R = 0.36;
    const MX = -COL_R - 0.2 - L; // its near end
    const prof = [[0, 0], [R * 0.62, 0], [R * 0.82, 0.05], [R * 0.9, 0.12]];
    const FINS = 12;
    for (let i = 0; i < FINS; i++) {
      const y = mix(0.16, L - 0.16, i / (FINS - 1));
      prof.push([R * 0.9, y - 0.022], [R, y - 0.015], [R, y + 0.015], [R * 0.9, y + 0.022]);
    }
    prof.push([R * 0.9, L - 0.1], [R * 0.82, L - 0.04], [R * 0.62, L], [0, L]);
    const body = alongX(turned(prof, 28, { crease: 36 }));
    body.translate(CX + MX, ROLL_LO, 0);
    paint.push({ geometry: body, color: 0x3a6b58 });
    // The cradle under it.
    for (const t of [0.12, L - 0.12]) {
      paint.push({ geometry: timber(col(MX + t, BASE - 0.02, 0), col(MX + t, ROLL_LO - R * 0.72, 0), 0.74, 0.14, { up: [1, 0, 0], chamfer: 0.02 }), color: DARK });
    }
    paint.push({ geometry: timber(col(MX - 0.08, BASE + 0.03, 0), col(MX + L + 0.08, BASE + 0.03, 0), 0.9, 0.1, { chamfer: 0.02 }), color: DARK });
    // The shaft out of the end bell into the roller's axle, through the wall's bearing.
    shine(rod(col(MX + L - 0.04, ROLL_LO, 0), col(-COL_R, ROLL_LO, 0), 0.055, 12, 1), 0xb4b9c0);
    // Terminal box and its conduit, across the plinth to the switch.
    paint.push({ geometry: timber(col(MX + L * 0.38, ROLL_LO + R * 0.82, 0), col(MX + L * 0.38 + 0.34, ROLL_LO + R * 0.82, 0), 0.28, 0.2, { chamfer: 0.025 }), color: 0x2c5546 });
    const switchX = -1.15;
    paint.push({ geometry: tube([col(MX + L * 0.38 + 0.17, ROLL_LO + R * 0.82 + 0.08, 0.1), [CX + MX + L * 0.2, 1.12, 0.62], [CX + MX + L * 0.2, 0.62, 0.86], [switchX, BASE + 0.05, 1.0]], 0.025, { steps: 22, sides: 6, round: 1 }), color: 0x17181a });
    paint.push({ geometry: timber([switchX - 0.22, BASE + 0.05, 1.0], [switchX + 0.22, BASE + 0.05, 1.0], 0.34, 0.12, { chamfer: 0.02 }), color: DARK });
    shine(rod([switchX, BASE + 0.1, 1.0], [switchX + 0.07, BASE + 0.26, 1.0], 0.022, 8, 1), 0xd2d6db);
    shine(ball(0.04, [switchX + 0.075, BASE + 0.27, 1.0], 10), 0xc94a3a);
  }

  // --- The dome: polish painted in, and a curled lip round its mouth ---
  {
    const prof = [[0, 5.46], [MOUTH - 0.1, 5.44], [MOUTH - 0.05, 5.32]];
    // A rolled lip, so that nothing sharp shows at the mouth.
    const lipY = DOME_Y - Math.sqrt(DOME_R * DOME_R - MOUTH * MOUTH);
    const LIP = 0.05;
    for (let i = 0; i <= 8; i++) {
      const a = mix(Math.PI, 2 * Math.PI, i / 8);
      prof.push([MOUTH + Math.cos(a) * LIP, lipY - 0.02 + Math.sin(a) * LIP]);
    }
    const a0 = Math.asin(MOUTH / DOME_R);
    const RINGS = 44;
    for (let i = 1; i <= RINGS; i++) {
      const a = mix(a0, Math.PI, i / RINGS);
      prof.push([i === RINGS ? 0 : DOME_R * Math.sin(a), DOME_Y - DOME_R * Math.cos(a)]);
    }
    const g = turned(prof, 96, { crease: 40 });
    g.translate(CX, 0, 0);
    const part = domePolish(g, 0xe4e7ea, 1);
    // The recess inside the mouth is dark, not a mirror of the sky.
    const cAttr = part.geometry.attributes.color;
    const pAttr = part.geometry.attributes.position;
    for (let i = 0; i < pAttr.count; i++) {
      if (pAttr.getY(i) < 5.46 && Math.hypot(pAttr.getX(i) - CX, pAttr.getZ(i)) < MOUTH - 0.03) cAttr.setXYZ(i, 0.05, 0.05, 0.06);
    }
    metal.push(part);
  }

  // --- The discharge sphere on its grounded arm ---
  const dist = DOME_R + GAP + SPHERE_R;
  const dy = SPHERE_Y - DOME_Y;
  const SX = CX + Math.sqrt(dist * dist - dy * dy);
  {
    const sphereProf = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI;
      sphereProf.push([i === 0 || i === 32 ? 0 : SPHERE_R * Math.sin(a), SPHERE_Y - SPHERE_R * Math.cos(a)]);
    }
    const g = turned(sphereProf, 64, { crease: 40 });
    g.translate(SX, 0, 0);
    metal.push(domePolish(g, 0xe4e7ea, 1));
    const POST_X = SX + 0.26;
    const KNUCKLE = [POST_X, 3.25, 0];
    const footP = turned([[0, BASE - 0.02], [0.34, BASE - 0.02], [0.34, BASE + 0.05], [0.26, BASE + 0.09], [0.1, BASE + 0.13], [0.08, BASE + 0.26], [0, BASE + 0.26]], 36);
    footP.translate(POST_X, 0, 0);
    shine(footP, 0x9aa0a7);
    shine(rod([POST_X, BASE + 0.1, 0], KNUCKLE, 0.052, 14, 1), 0xe4e7ea, 1.25);
    shine(ball(0.115, KNUCKLE, 18), 0x8f959c);
    shine(alongX(turned([[0, -0.15], [0.045, -0.15], [0.045, 0.15], [0, 0.15]], 10)).translate(POST_X, 3.25, 0), 0x6d7278);
    shine(rod(KNUCKLE, [SX, SPHERE_Y - SPHERE_R * 0.8, 0], 0.044, 14, 1), 0xe4e7ea, 1.25);
    // A small collar where the arm meets the sphere, sunk into both.
    shine(stood(turned([[0, -0.1], [0.095, -0.1], [0.11, 0.0], [0.07, 0.1], [0, 0.1]], 22), [SX, SPHERE_Y - SPHERE_R * 0.98, 0]), 0xa8adb4);
    // The ground wire: down the post in a slack curve to a lug on the plinth, and the mark for it.
    paint.push({ geometry: tube([[POST_X + 0.04, 3.12, 0.08], [POST_X + 0.34, 2.3, 0.2], [POST_X + 0.26, 1.2, 0.32], [POST_X + 0.05, BASE + 0.05, 0.72]], 0.024, { steps: 28, sides: 7, round: 1 }), color: 0x2f8f43 });
    shine(ball(0.05, [POST_X + 0.05, BASE + 0.04, 0.72], 10), BRASS);
    const gx = POST_X + 0.05; const gz = 0.98;
    for (let i = 0; i < 3; i++) {
      const w = 0.3 - i * 0.1;
      metal.push(polished(block(gx - w / 2, BASE, gz + i * 0.07, gx + w / 2, BASE + 0.012, gz + i * 0.07 + 0.03), BRASS));
    }
    metal.push(polished(block(gx - 0.015, BASE, gz - 0.14, gx + 0.015, BASE + 0.012, gz), BRASS));
  }

  // --- The spark: thin, jagged and branching, landing on both metal surfaces ---
  const sparks = [];
  {
    const rng = seededRandom(1923);
    const C0 = V(CX, DOME_Y, 0); const C1 = V(SX, SPHERE_Y, 0);
    const dir = C1.clone().sub(C0).normalize();
    const onDome = (d) => C0.clone().addScaledVector(d, DOME_R - 0.015);
    const onSphere = (d) => C1.clone().addScaledVector(d, SPHERE_R - 0.015);
    const zigzag = (A, B, levels, amp) => {
      let pts = [A, B];
      let a = amp;
      for (let l = 0; l < levels; l++) {
        const next = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
          const m = pts[i].clone().lerp(pts[i + 1], 0.32 + rng() * 0.36);
          m.x += (rng() - 0.5) * a * 0.55; m.y += (rng() - 0.5) * a * 1.6; m.z += (rng() - 0.5) * a * 1.6;
          next.push(m, pts[i + 1]);
        }
        pts = next;
        a *= 0.56;
      }
      return pts;
    };
    const line = (pts, r0, r1, color) => {
      const radii = pts.map((_, i) => mix(r0, r1, i / (pts.length - 1)));
      sparks.push({ geometry: boltSolid(pts, radii, 6), color });
    };
    const main = zigzag(onDome(dir), onSphere(dir.clone().negate()), 5, 0.3);
    line(main, 0.021, 0.017, 0xffffff);
    // Branches leave the channel and strike either surface, or die in the air.
    const fromOn = [6, 11, 15, 20, 25];
    fromOn.forEach((at, i) => {
      const P = main[at];
      let end;
      if (i === 0) end = onDome(V(0.82, 0.32, 0.5).normalize());
      else if (i === 1) end = onDome(V(0.86, -0.46, -0.24).normalize());
      else if (i === 2) end = P.clone().add(V(0.12, 0.26, 0.2));
      else if (i === 3) end = onSphere(V(-0.72, 0.56, 0.42).normalize());
      else end = onSphere(V(-0.8, -0.5, -0.36).normalize());
      line(zigzag(P, end, 3, 0.16), 0.012, 0.005, 0xe6dcff);
    });
    if (main.length < 26) throw new Error('van-de-graaff: spark too short');
  }

  // --- The name plate on the plinth's face ---
  const plateMap = canvasTexture(512, 96, (ctx, w, h) => {
    ctx.fillStyle = '#d9b869';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#6a5321';
    ctx.lineWidth = 3;
    ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.fillStyle = '#231b0c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(ctx, 'VAN DE GRAAFF GENERATOR', w * 0.88, 44);
    ctx.fillText('VAN DE GRAAFF GENERATOR', w / 2, h / 2 + 2);
  });
  const plate = printedPlate(1.5, 0.15, 0.015, [0, 0, 1, 1]);
  plate.translate(0.6, 0.31, 1.495);

  root.add(mesh(mergeParts(wood), woodMaterial(4017)));
  root.add(mesh(mergeParts(paint), standard({ vertexColors: true, roughness: 0.5, metalness: 0 })));
  root.add(mesh(mergeParts(metal), standard({ vertexColors: true, roughness: 0.2, metalness: 0.42 })));
  const clearMesh = mesh(mergeParts(clear), standard({ vertexColors: true, roughness: 0.14, metalness: 0, transparent: true, opacity: 0.58, depthWrite: false }));
  noShadow(clearMesh);
  clearMesh.renderOrder = 2;
  root.add(clearMesh);
  root.add(noShadow(mesh(mergeParts(sparks), new THREE.MeshBasicMaterial({ vertexColors: true }))));
  root.add(mesh(plate, standard({ map: plateMap, roughness: 0.42, metalness: 0.15 })));
  return root;
}

// ===========================================================================================
// THE FOUCAULT PENDULUM
// ===========================================================================================

export const FOUCAULT = {
  G: 32.2, // ft/s^2
  PIVOT: 21.0,
  BOB_Y: 1.95,
  POINT: 1.44, // bob centre to the tip of its point
  AMP: 8 * DEG,
  TURN: 600, // seconds for the plane to go once round, sped up
  MARKS: 24,
  PEGS: 48,
  PEG_R: 3.25,
  DISK_R: 5.1,
  DISK_TOP: 0.26,
};
FOUCAULT.L = FOUCAULT.PIVOT - FOUCAULT.BOB_Y;
FOUCAULT.T = TAU * Math.sqrt(FOUCAULT.L / FOUCAULT.G);

function paintFoucaultFloor(ctx, S) {
  const F = FOUCAULT;
  const c = S / 2;
  const px = (S / 2) / F.DISK_R;
  // The stone: pale in the middle where the bob swings, deep blue in the ring of hours.
  const noise = latticeNoise(733, 64);
  const noise2 = latticeNoise(734, 64);
  paintTexels(ctx, 0, 0, S, S, (x, y, out) => {
    const dx = (x + 0.5 - c) / px; const dy = (y + 0.5 - c) / px;
    const r = Math.hypot(dx, dy);
    const cloud = (noise(dx * 1.4 + 40, dy * 1.4 + 40) - 0.5) * 0.09 + (noise2(dx * 7 + 40, dy * 7 + 40) - 0.5) * 0.05;
    const dark = sstep(r, 3.46, 3.5);
    const k = 1 + cloud;
    const R = mix(226, 34, dark); const G = mix(217, 62, dark); const B = mix(196, 104, dark);
    out[0] = clamp01((R * k) / 255) * 255; out[1] = clamp01((G * k) / 255) * 255; out[2] = clamp01((B * k) / 255) * 255;
  });
  // The 24 lines the marks stand on, run on inward so that the swing can be read against them.
  ctx.strokeStyle = 'rgba(70,60,44,0.55)';
  ctx.lineWidth = 1.6;
  for (let i = 0; i < F.MARKS; i++) {
    const a = (i / F.MARKS) * TAU;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * 0.5 * px, c + Math.sin(a) * 0.5 * px);
    ctx.lineTo(c + Math.cos(a) * 3.46 * px, c + Math.sin(a) * 3.46 * px);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(70,60,44,0.75)';
  ctx.lineWidth = 2.2;
  for (const r of [0.5, 3.0]) {
    ctx.beginPath();
    ctx.arc(c, c, r * px, 0, TAU);
    ctx.stroke();
  }
  ctx.strokeStyle = '#d9b869';
  ctx.lineWidth = 4;
  for (const r of [3.5, 5.0]) {
    ctx.beginPath();
    ctx.arc(c, c, r * px, 0, TAU);
    ctx.stroke();
  }
  // The hour numerals, read from outside the disk. 24 is where the swing starts, on +X, and they
  // count clockwise seen from above, which is the way this swing turns in the northern hemisphere.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < F.MARKS; i++) {
    const a = (i / F.MARKS) * TAU;
    ctx.save();
    ctx.translate(c + Math.cos(a) * 4.55 * px, c + Math.sin(a) * 4.55 * px);
    ctx.rotate(a - Math.PI / 2);
    ctx.fillStyle = '#f3e6c2';
    ctx.font = `700 ${Math.round(0.56 * px)}px ${FONT}`;
    ctx.fillText(String(i === 0 ? 24 : i), 0, 0);
    ctx.restore();
  }
}

function buildFoucault() {
  const F = FOUCAULT;
  const root = new THREE.Group();
  const frame = [];
  const metal = [];
  const pegsAndMarks = [];
  const IRON = 0x2e4256; const CAST = 0x20262e;

  // --- The floor disk ---
  const floorMap = canvasTexture(1024, 1024, (ctx, w) => paintFoucaultFloor(ctx, w));
  const disk = turned([[0, 0], [F.DISK_R, 0], [F.DISK_R, F.DISK_TOP - 0.05], [F.DISK_R - 0.05, F.DISK_TOP], [F.DISK_R * 0.5, F.DISK_TOP], [0, F.DISK_TOP]], 128, { crease: 30 });
  {
    const P = disk.attributes.position; const U = disk.attributes.uv;
    for (let i = 0; i < P.count; i++) U.setXY(i, 0.5 + P.getX(i) / (2 * F.DISK_R), 0.5 - P.getZ(i) / (2 * F.DISK_R));
  }
  root.add(mesh(disk, standard({ map: floorMap, roughness: 0.6, metalness: 0 })));

  // --- EXACTLY 24 hour marks, computed, standing proud of the stone ---
  const markAngles = [];
  for (let i = 0; i < F.MARKS; i++) markAngles.push((i / F.MARKS) * TAU);
  if (markAngles.length !== 24) throw new Error('foucault-pendulum: there must be 24 hour marks');
  for (const a of markAngles) {
    const r0 = 3.56; const r1 = 4.1;
    const c = Math.cos(a); const s = Math.sin(a);
    const big = Math.round(a / (TAU / 24)) % 6 === 0;
    const g = timber([c * r0, F.DISK_TOP + 0.022, s * r0], [c * r1, F.DISK_TOP + 0.022, s * r1], big ? 0.14 : 0.09, 0.05, { chamfer: 0.012 });
    pegsAndMarks.push(polished(g, 0xe6bd5e, 1.05));
  }
  // --- The ring of standing pegs, just outside the reach of the point ---
  const peg = turned([[0, 0], [0.062, 0], [0.062, 0.05], [0.036, 0.09], [0.033, 0.3], [0.05, 0.33], [0.05, 0.37], [0.03, 0.41], [0, 0.42]], 10, { crease: 40 });
  for (let i = 0; i < F.PEGS; i++) {
    const a = ((i + 0.5) / F.PEGS) * TAU;
    const g = peg.clone();
    g.translate(Math.cos(a) * F.PEG_R, F.DISK_TOP - 0.005, Math.sin(a) * F.PEG_R);
    tintVertices(g, (x, y, z, out) => {
      const c = y > F.DISK_TOP + 0.28 ? lin(0xd93a2b) : lin(0xe9e0cc);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    pegsAndMarks.push({ geometry: g, keepColor: true });
  }
  // A small brass stud at the very centre, under the point at rest.
  pegsAndMarks.push(polished(turned([[0, F.DISK_TOP - 0.01], [0.17, F.DISK_TOP - 0.01], [0.15, F.DISK_TOP + 0.02], [0.05, F.DISK_TOP + 0.04], [0, F.DISK_TOP + 0.045]], 24), 0xe6bd5e));

  // --- The tripod: three steel legs, two hoops and a cast head ---
  const FOOT_R = 7.4; const HEAD_R = 0.62; const LEG_Y0 = 0.42; const LEG_Y1 = 21.5;
  const legAz = [Math.PI, Math.PI / 3, -Math.PI / 3];
  const legAt = (az, y) => {
    const t = (y - LEG_Y0) / (LEG_Y1 - LEG_Y0);
    const r = mix(FOOT_R, HEAD_R, t);
    return [r * Math.sin(az), y, r * Math.cos(az)];
  };
  for (const az of legAz) {
    const a = legAt(az, LEG_Y0); const b = legAt(az, LEG_Y1);
    frame.push({ geometry: tube([a, b], [0.27, 0.18], { straight: true, steps: 6, sides: 18, round: 0 }), color: IRON });
    // The shoe: a cast foot on a stone pad.
    const pad = timber([a[0] - Math.sin(az) * 0.9, 0.12, a[2] - Math.cos(az) * 0.9], [a[0] + Math.sin(az) * 0.9, 0.12, a[2] + Math.cos(az) * 0.9], 1.5, 0.24, { chamfer: 0.04 });
    frame.push({ geometry: pad, color: 0x8d8778 });
    const dir = V(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    const shoe = turned([[0, -0.2], [0.46, -0.2], [0.46, -0.06], [0.36, 0.02], [0.31, 0.42], [0.31, 0.55], [0, 0.55]], 22);
    frame.push({ geometry: stood(shoe, [a[0], 0.46, a[2]], [dir.x, dir.y, dir.z]), color: CAST });
    for (let k = 0; k < 4; k++) {
      const an = az + (k + 0.5) * (TAU / 4);
      frame.push({ geometry: ball(0.055, [a[0] + Math.sin(an) * 0.6, 0.25, a[2] + Math.cos(an) * 0.6], 10), color: 0x5a5e62 });
    }
    // Flanged joints, about one every five feet.
    for (const y of [5.4, 10.6, 15.8]) {
      const p = legAt(az, y);
      const rr = mix(0.27, 0.18, (y - LEG_Y0) / (LEG_Y1 - LEG_Y0));
      const flange = turned([[0, -0.1], [rr + 0.1, -0.1], [rr + 0.1, -0.03], [rr + 0.02, 0.0], [rr + 0.1, 0.03], [rr + 0.1, 0.1], [0, 0.1]], 22, { crease: 34 });
      frame.push({ geometry: stood(flange, p, [dir.x, dir.y, dir.z]), color: 0x3c5469 });
    }
  }
  // Two hoops. A ring rather than straight ties, since a tie between two legs would cross the swing.
  for (const y of [6.3, 13.2]) {
    const R = Math.hypot(legAt(0, y)[0], legAt(0, y)[2]);
    const hoop = new THREE.TorusGeometry(R, y < 10 ? 0.085 : 0.07, 10, 96);
    hoop.rotateX(Math.PI / 2);
    hoop.translate(0, y, 0);
    frame.push({ geometry: hoop, color: IRON });
    for (const az of legAz) {
      const p = legAt(az, y);
      frame.push({ geometry: ball(0.31, p, 16), color: 0x3c5469 });
    }
  }
  // The head: a cast plate the three legs socket into, with a clamp whose tip is the pivot.
  {
    const head = turned([[0, 21.25], [0.98, 21.25], [1.0, 21.32], [1.0, 21.5], [0.92, 21.58], [0.5, 21.66], [0.34, 21.8], [0.3, 21.9], [0.2, 22.0], [0, 22.02]], 44);
    frame.push({ geometry: head, color: CAST });
    for (const az of legAz) {
      const p = legAt(az, 21.2);
      const b = legAt(az, 21.3);
      const dir = [b[0] - p[0], b[1] - p[1], b[2] - p[2]];
      frame.push({ geometry: stood(turned([[0, -0.2], [0.24, -0.2], [0.27, -0.12], [0.27, 0.1], [0, 0.1]], 18), p, dir), color: 0x3c5469 });
    }
    const clamp = turned([[0, F.PIVOT - 0.015], [0.03, F.PIVOT - 0.01], [0.055, F.PIVOT + 0.04], [0.11, F.PIVOT + 0.09], [0.13, F.PIVOT + 0.15], [0.2, F.PIVOT + 0.18], [0.2, F.PIVOT + 0.28], [0, F.PIVOT + 0.28]], 26);
    metal.push(polished(clamp, 0xc2c7cd));
  }

  // --- What swings. Under `plane` (the slow turn) and `swing` (the fast one), both at the pivot ---
  const plane = new THREE.Group();
  plane.name = 'swing-plane';
  plane.position.set(0, F.PIVOT, 0);
  const swing = new THREE.Group();
  swing.name = 'swing';
  swing.rotation.z = F.AMP;
  plane.add(swing);
  const bobParts = [];
  const bobY = -F.L;
  const WIRE_R = 0.02;
  const R = 0.98; const Rv = 0.84;
  // The bob: heavy brass, with a point underneath and a clamp nut on the wire.
  {
    const prof = [[0, -F.POINT]];
    prof.push([0.012, -F.POINT + 0.03], [0.05, -F.POINT + 0.28], [0.075, -F.POINT + 0.42]);
    prof.push([0.13, -Rv - 0.09], [0.135, -Rv - 0.05]);
    for (let i = 0; i <= 36; i++) {
      const a = mix(-78 * DEG, 78 * DEG, i / 36);
      prof.push([R * Math.cos(a), Rv * Math.sin(a)]);
    }
    prof.push([0.16, Rv + 0.05], [0.12, Rv + 0.1], [0.12, Rv + 0.22], [0.06, Rv + 0.27], [0, Rv + 0.28]);
    const bob = turned(prof, 72, { crease: 36 });
    const part = polished(bob, 0xdba53e, 1.02);
    // The point is steel, and a dark engraved line runs round the equator.
    const C = part.geometry.attributes.color; const P = part.geometry.attributes.position;
    const steel = lin(0xced2d6);
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i);
      if (y < -Rv - 0.08) {
        const k = C.getX(i) / lin(0xdba53e)[0];
        C.setXYZ(i, clamp01(steel[0] * k), clamp01(steel[1] * k), clamp01(steel[2] * k));
      }
    }
    part.geometry.translate(0, bobY, 0);
    bobParts.push(part);
    // Two raised bands on the belly, which is what stops it reading as a plain ball.
    for (const y of [-0.28, 0.28]) {
      const r = R * Math.sqrt(1 - (y / Rv) ** 2);
      const band = new THREE.TorusGeometry(r, 0.02, 8, 72);
      band.rotateX(Math.PI / 2);
      band.translate(0, bobY + y, 0);
      bobParts.push(polished(band, 0xb5842b, 0.95));
    }
  }
  // The wire, from the pivot at the group's origin down into the bob's top nut.
  bobParts.push(polished(rod([0, 0.03, 0], [0, bobY + Rv + 0.2, 0], WIRE_R, 8, 0), 0xd4d7dc, 1.05));
  swing.add(mesh(mergeParts(bobParts), standard({ vertexColors: true, roughness: 0.22, metalness: 0.45 })));

  root.add(mesh(mergeParts(frame), standard({ vertexColors: true, roughness: 0.55, metalness: 0.12 })));
  root.add(mesh(mergeParts(metal), standard({ vertexColors: true, roughness: 0.24, metalness: 0.42 })));
  root.add(mesh(mergeParts(pegsAndMarks), standard({ vertexColors: true, roughness: 0.36, metalness: 0.1 })));
  root.add(plane);

  // The pendulum swings at its true period for this wire. The plane's slow clockwise turn, seen from
  // above as it goes in the northern hemisphere, is what the card says is sped up.
  const omega = TAU / F.T;
  const spin = TAU / F.TURN;
  let t = 0;
  root.userData.tick = {
    update(dt) {
      if (reducedMotion()) return;
      t += dt;
      swing.rotation.z = F.AMP * Math.cos(omega * t);
      plane.rotation.y = -spin * t;
    },
    dispose() {},
  };
  return root;
}

// ===========================================================================================
// THE ARCHIMEDES SCREW
// ===========================================================================================
//
// THE WATER DOES NOT TURN. A helix rotating about its axis is the same set of points as that helix
// sliding along its axis, so in a frame moving up the shaft at pitch x turns per second the blade
// stands perfectly still. Each pocket is therefore a rigid shape that keeps its heading and slides
// along the shaft, and it stays against the blade at every instant, in the same low place in the
// trough. Put in the turning group, the water would orbit the shaft, which is exactly what a student
// must not be shown.
//
// THE NEAR WALL IS CLEAR, AND IT HAS TO BE. Water is held at the very bottom of a tube, so with an
// opaque wall a student whose eye is level with the screw sees none of it: 25 degrees of elevation
// would be needed and a 5ft eye never gets that. Cutting the wall away instead would leave the water
// standing against nothing, which teaches something false. The helix is wound so that the low point
// falls on this side, and each pocket's face against the wall is what the student reads.

export const SCREW = {
  ALPHA: 25 * DEG,
  LENGTH: 14,
  R: 1.7, // the trough's inner radius, and the blade's outer one
  R0: 0.42, // the shaft
  PITCH: 3.0,
  BLADE_T: 0.06,
  DEPTH: 1.05, // how deep a pocket is at its deepest
  TURN: 4, // seconds for one turn
  X0: -7.05, Y0: 1.85,
  POOL_Y: 1.85,
  RIM_NEAR: 60 * DEG, RIM_FAR: 300 * DEG, // the channel's edges, as a bearing round the shaft from straight up
  GLASS_END: 170 * DEG, // the clear wall runs from the near rim to here, and the staves from here to the far rim
  FIRST: 0.9, // where the first pocket's low point starts along the shaft
  POCKETS: 3, // in the running group; a fourth is on its way out over the lip
  BLADE_END: 13.92,
};
{
  const S = SCREW;
  S.S = Math.sin(S.ALPHA); S.C = Math.cos(S.ALPHA);
  // The blade is x = Xb + (pitch / tau) * phi. Height along its outer edge is
  //   x sin(a) + R cos(a) cos(phi), so d/dphi = (p / tau) sin(a) - R cos(a) sin(phi) = 0.
  S.K = (S.PITCH / TAU) * Math.tan(S.ALPHA) / S.R; // sin of the low point's offset from straight down
  S.PHI_LOW = Math.PI - Math.asin(S.K); // a little below straight down on the +Z, student's, side
  // Where along the shaft the blade's phi = PHI_LOW is at t = 0.
  S.XB = S.FIRST - (S.PITCH / TAU) * S.PHI_LOW;
  S.SPEED = S.PITCH / S.TURN;
  // Water runs back along the channel only over the crest where the blade meets the shaft.
  const k0 = (S.PITCH / TAU) * Math.tan(S.ALPHA) / S.R0;
  if (k0 >= 1) throw new Error('archimedes-screw: this pitch and tilt would hold no water at all');
  const height = (phi, rho) => (S.PITCH / TAU) * phi * S.S + rho * Math.cos(phi) * S.C;
  S.SPILL_DEPTH = height(Math.asin(k0), S.R0) - height(S.PHI_LOW, S.R);
  if (S.DEPTH >= S.SPILL_DEPTH) throw new Error('archimedes-screw: a pocket this deep would spill back');
}
const screwX = (phi) => SCREW.XB + (SCREW.PITCH / TAU) * phi; // the blade's mid surface, in the shaft's own frame
// A point at distance s along the shaft, radius rho and bearing phi, in the root's frame.
function screwPoint(s, rho, phi) {
  const { X0, Y0, S, C } = SCREW;
  const n = rho * Math.cos(phi);
  return [X0 + s * C - n * S, Y0 + s * S + n * C, rho * Math.sin(phi)];
}

// One pocket, with its low point at x = 0. Between the blade and a level surface, in shaft coordinates.
// Every top vertex lies exactly on one plane, so however the grid falls the surface is dead flat. Its
// outer face, against the wall, is what a student looks at through the glass.
function pocketGeometry() {
  const { S, C, R, R0, DEPTH, PITCH, PHI_LOW, RIM_NEAR, RIM_FAR, BLADE_T } = SCREW;
  const LOW = R * Math.cos(PHI_LOW) * C; // the height of the low point
  const LEVEL = LOW + DEPTH;
  const xb = (phi) => (PITCH / TAU) * (phi - PHI_LOW);
  const xTop = (phi, rho) => (LEVEL - rho * Math.cos(phi) * C) / S;
  const PH0 = 80 * DEG; const PH1 = 264 * DEG;
  const NP = 64; const NR = 14;
  const phiAt = (i) => mix(PH0, PH1, i / NP);
  const rhoAt = (j) => mix(R0 - 0.03, R + 0.03, j / NR);
  // The water must not reach the channel's rims, or the ends of this grid, or the next turn of the blade.
  for (const phi of [RIM_NEAR, RIM_FAR, PH0, PH1]) {
    if (xTop(phi, R + 0.03) > xb(phi)) throw new Error('archimedes-screw: a pocket would spill over the channel rim');
  }
  for (let i = 0; i <= NP; i++) {
    for (let j = 0; j <= NR; j++) {
      if (xTop(phiAt(i), rhoAt(j)) >= xb(phiAt(i)) + PITCH - BLADE_T) throw new Error('archimedes-screw: a pocket reaches the next turn');
    }
  }
  // Each grid triangle is CLIPPED where the level surface meets the blade, rather than having its dry
  // corners dragged onto the blade. A dragged corner lifts its facet off the level plane, and all along
  // the waterline that reads as a row of little teeth. Clipped, every top vertex is on the plane, and the
  // cut edge lies inside the blade's own thickness.
  const wetness = (v) => xTop(v.phi, v.rho) - xb(v.phi);
  const pos = [];
  const uv = [];
  const topOf = (v) => [xTop(v.phi, v.rho), v.rho * Math.cos(v.phi), v.rho * Math.sin(v.phi)];
  const botOf = (v) => [xb(v.phi) - 0.012, v.rho * Math.cos(v.phi), v.rho * Math.sin(v.phi)];
  const emit = (...points) => { for (const q of points) { pos.push(q[0], q[1], q[2]); uv.push(0, 0); } };
  const clip = (poly) => {
    const out = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k]; const b = poly[(k + 1) % poly.length];
      const ga = wetness(a); const gb = wetness(b);
      if (ga >= 0) out.push(a);
      if ((ga >= 0) !== (gb >= 0)) {
        const t = ga / (ga - gb);
        // A vertex made by a cut stays on the row it was cut from, so that the wall's rim stays closed.
        const row = a.row !== undefined && a.row === b.row ? a.row : undefined;
        out.push({ phi: mix(a.phi, b.phi, t), rho: mix(a.rho, b.rho, t), row, cut: true });
      }
    }
    return out;
  };
  const face = (corners) => {
    const poly = clip(corners);
    if (poly.length < 3) return;
    for (let k = 1; k < poly.length - 1; k++) {
      emit(topOf(poly[0]), topOf(poly[k]), topOf(poly[k + 1]));
      emit(botOf(poly[k + 1]), botOf(poly[k]), botOf(poly[0]));
    }
    // Side faces: along the wall, along the shaft, and along the cut, which closes it inside the blade.
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k]; const q = poly[(k + 1) % poly.length];
      const onRow = p.row !== undefined && p.row === q.row;
      if (onRow || (p.cut && q.cut)) emit(topOf(q), topOf(p), botOf(p), topOf(q), botOf(p), botOf(q));
    }
  };
  for (let i = 0; i < NP; i++) {
    for (let j = 0; j < NR; j++) {
      const corner = (ii, jj) => ({ phi: phiAt(ii), rho: rhoAt(jj), row: jj === 0 || jj === NR ? jj : undefined });
      const a = corner(i, j); const b = corner(i + 1, j); const c = corner(i + 1, j + 1); const d = corner(i, j + 1);
      face([a, b, c]);
      // The diagonal is not a boundary, and row is only ever shared along a real row.
      face([a, c, d]);
    }
  }
  const g = soup(pos, uv, 20);
  const deep = lin(0x0a5fe6); const pale = lin(0x2f9df5);
  tintVertices(g, (x, y, z, out) => {
    const phi = (Math.atan2(z, y) + TAU) % TAU;
    const k = sstep(x - xb(phi), 0.0, 0.22);
    out[0] = mix(pale[0], deep[0], k); out[1] = mix(pale[1], deep[1], k); out[2] = mix(pale[2], deep[2], k);
  });
  return g;
}

function paintRipple(ctx, w, h, seed) {
  const a = periodicNoise(seed, 4, 4);
  const b = periodicNoise(seed + 1, 8, 8);
  // The top half of the canvas is ripple, for the still water. The bottom half is white, and everything
  // else that shares this mesh samples it, so that stone and iron carry no ripple.
  paintTexels(ctx, 0, 0, w, h, (x, y, out) => {
    const u = x / w; const v = (y / h) * 2;
    if (v >= 1) { out[0] = 255; out[1] = 255; out[2] = 255; return; }
    const warp = a(u, v) * 0.9 + b(u, v) * 0.3;
    const ripple = Math.sin((v * 8 + warp * 1.5) * TAU) * 0.5 + 0.5;
    const k = 0.88 + 0.12 * ripple ** 2.5;
    out[0] = 255 * k; out[1] = 255 * k; out[2] = 255 * k;
  });
}

function buildScrew() {
  const A = SCREW;
  const { R, R0, PITCH, LENGTH, BLADE_T, ALPHA, RIM_NEAR, RIM_FAR, GLASS_END, POOL_Y, TURN, FIRST, POCKETS } = A;
  const root = new THREE.Group();
  const wood = [];
  const paint = [];
  const glass = [];
  const P = screwPoint;
  const rng = seededRandom(287);
  const tone = (c, v = 0.09) => { const k = 1 + (rng() - 0.5) * 2 * v; const col = new THREE.Color(c); col.multiplyScalar(k); return col.getHex(); };

  const OAK = 0x927048; const DARKOAK = 0x6c5236; const IRON = 0x34383d; const STONE = 0x9c9587;

  // --- The channel: staves on the far side and underneath, glass on the student's side ---
  const WALL = 0.14;
  const GLASS_T = 0.05;
  {
    const STAVES = 10;
    const GAP_A = 0.004;
    for (let k = 0; k < STAVES; k++) {
      const a0 = mix(GLASS_END, RIM_FAR, k / STAVES) + GAP_A; const a1 = mix(GLASS_END, RIM_FAR, (k + 1) / STAVES) - GAP_A;
      const seed = k * 3.1;
      const uv = (i, j) => [i * LENGTH + seed, mix(a0, a1, j / 3) * R + seed * 0.61];
      const g = gridSolid(1, 3,
        (i, j) => P(i * LENGTH, R, mix(a0, a1, j / 3)),
        (i, j) => P(i * LENGTH, R + WALL, mix(a0, a1, j / 3)),
        { uvTop: uv, uvBottom: uv, crease: 24 });
      // Pale, because this is what the blue water is seen against.
      wood.push({ geometry: g, color: tone(0xd9c49c, 0.06) });
    }
    // What the gaps show is the dark caulking behind them.
    const NA = 40;
    const liner = gridSolid(1, NA,
      (i, j) => P(0.02 + i * (LENGTH - 0.04), R + 0.03, mix(GLASS_END + 0.02, RIM_FAR - 0.02, j / NA)),
      (i, j) => P(0.02 + i * (LENGTH - 0.04), R + WALL - 0.03, mix(GLASS_END + 0.02, RIM_FAR - 0.02, j / NA)),
      { crease: 40 });
    paint.push({ geometry: liner, color: 0x2a1c10 });
    // The clear wall itself, closed and with a real thickness.
    const NG = 40;
    const clearWall = gridSolid(1, NG,
      (i, j) => P(i * LENGTH, R, mix(RIM_NEAR, GLASS_END, j / NG)),
      (i, j) => P(i * LENGTH, R + GLASS_T, mix(RIM_NEAR, GLASS_END, j / NG)),
      { crease: 40 });
    glass.push({ geometry: clearWall, color: 0xe6f3fa });
    // Capping rails along both rims, and a slim sill where the glass meets the staves.
    const rail = (phi, w, h, rho, seed) => timber(P(-0.02, rho, phi), P(LENGTH + 0.02, rho, phi), w, h, { seed, chamfer: 0.02 });
    wood.push({ geometry: rail(RIM_FAR, 0.2, 0.17, R + WALL / 2, 1.3), color: DARKOAK });
    wood.push({ geometry: rail(RIM_NEAR, 0.12, 0.12, R + GLASS_T / 2, 2.7), color: DARKOAK });
    wood.push({ geometry: rail(GLASS_END + 0.012, 0.1, 0.09, R + WALL * 0.62, 4.1), color: DARKOAK });
    // Slim iron hoops, few of them, since each one crosses the view of the water.
    for (const s of [0.45, 4.8, 9.3, 13.75]) {
      const hw = 0.045;
      const NB = 60;
      const rho = (phi) => (phi < GLASS_END ? R + GLASS_T : R + WALL);
      const hoop = gridSolid(1, NB,
        (i, j) => { const phi = mix(RIM_NEAR - 0.02, RIM_FAR + 0.02, j / NB); return P(s - hw + i * 2 * hw, Math.max(R + GLASS_T, rho(phi)) + 0.03, phi); },
        (i, j) => { const phi = mix(RIM_NEAR - 0.02, RIM_FAR + 0.02, j / NB); return P(s - hw + i * 2 * hw, R + GLASS_T - 0.01, phi); },
        { crease: 40 });
      paint.push({ geometry: hoop, color: IRON });
      for (const phi of [RIM_FAR + 0.02, Math.PI]) {
        paint.push({ geometry: ball(0.038, P(s, R + WALL + 0.035, phi), 8), color: 0x1f2226 });
      }
    }
  }

  // --- The frame: sills, two saddles and the bearing yoke, all kept below the channel's near side ---
  const SILL_Z = 2.15;
  const X_END = 9.15;
  {
    for (const z of [-SILL_Z, SILL_Z]) {
      wood.push({ geometry: timber([-1.72, 0.14, z], [X_END, 0.14, z], 0.3, 0.28, { seed: z, chamfer: 0.03 }), color: tone(DARKOAK) });
    }
    const saddle = (s, seed) => {
      const b = P(s, R + WALL + 0.02, Math.PI);
      const yBeam = b[1] - 0.14;
      const x = b[0];
      wood.push({ geometry: timber([x, yBeam, -SILL_Z - 0.28], [x, yBeam, SILL_Z + 0.28], 0.34, 0.28, { seed, up: [1, 0, 0] }), color: tone(OAK) });
      for (const z of [-SILL_Z, SILL_Z]) {
        wood.push({ geometry: timber([x, 0.26, z], [x, yBeam - 0.12, z], 0.3, 0.3, { seed: seed + z, up: [1, 0, 0] }), color: tone(OAK) });
        wood.push({ geometry: timber([x + 1.1, 0.26, z], [x + 0.05, Math.max(1.0, yBeam * 0.62), z], 0.16, 0.16, { seed: seed + 5, up: [0, 0, 1] }), color: tone(DARKOAK) });
      }
      // Chocks that carry the curve of the channel down onto the flat beam.
      for (const off of [-1.0, 1.0]) {
        const rho = R + (off > 0 ? GLASS_T : WALL);
        const q = P(s, rho, Math.PI + Math.asin(-off / rho));
        wood.push({ geometry: timber([x, yBeam + 0.12, off], [x, q[1] + 0.06, off], 0.3, 0.4, { seed: seed + off, up: [1, 0, 0], chamfer: 0.03 }), color: tone(DARKOAK) });
      }
    };
    saddle(5.9, 1);
    saddle(10.6, 2);
    for (const x of [P(5.9, R, Math.PI)[0], P(10.6, R, Math.PI)[0], 8.9]) {
      wood.push({ geometry: timber([x, 0.3, -SILL_Z - 0.2], [x, 0.3, SILL_Z + 0.2], 0.28, 0.2, { seed: x, up: [1, 0, 0] }), color: tone(DARKOAK) });
    }
  }

  // --- The upper bearing, on a yoke, whose two posts also carry the top channel's near end ---
  const S_BEAR = 14.72;
  const YOKE = P(S_BEAR, 0, 0);
  {
    const b = YOKE;
    const beamY = b[1] - 0.42;
    wood.push({ geometry: timber([b[0], beamY, -SILL_Z - 0.26], [b[0], beamY, SILL_Z + 0.26], 0.34, 0.32, { seed: 7, up: [1, 0, 0] }), color: tone(OAK) });
    for (const z of [-SILL_Z, SILL_Z]) {
      wood.push({ geometry: timber([b[0], 0.26, z], [b[0], beamY - 0.14, z], 0.32, 0.32, { seed: z + 11, up: [1, 0, 0] }), color: tone(OAK) });
    }
    paint.push({ geometry: timber([b[0] - 0.3, beamY + 0.2, 0], [b[0] + 0.3, beamY + 0.2, 0], 0.5, 0.1, { chamfer: 0.02 }), color: IRON });
    const pil = alongX(turned([[0, -0.22], [0.14, -0.22], [0.19, -0.18], [0.19, 0.18], [0.14, 0.22], [0, 0.22]], 24));
    pil.applyMatrix4(new THREE.Matrix4().makeRotationZ(ALPHA));
    pil.translate(b[0], b[1], b[2]);
    paint.push({ geometry: pil, color: 0x2c3036 });
    paint.push({ geometry: timber([b[0], beamY + 0.2, 0], [b[0], b[1] - 0.05, 0], 0.26, 0.26, { up: [1, 0, 0], chamfer: 0.02 }), color: IRON });
  }

  // --- The wooden trough at the top, running on along +X ---
  const TR = { X0: 5.72, X1: 9.05, HZ: 1.06, BOTTOM: 4.72, RIM: 5.62, WATER: 5.36 };
  {
    const { X0: tx0, X1: tx1, HZ, BOTTOM, RIM } = TR;
    const THICK = 0.17;
    for (let k = 0; k < 5; k++) {
      const z0 = mix(-HZ, HZ, k / 5); const z1 = mix(-HZ, HZ, (k + 1) / 5);
      wood.push({ geometry: timber([tx0, BOTTOM + THICK / 2, (z0 + z1) / 2], [tx1, BOTTOM + THICK / 2, (z0 + z1) / 2], z1 - z0 - 0.012, THICK, { seed: k * 2.3, chamfer: 0.012 }), color: tone(0xa97f4e) });
    }
    const PLANKS = 3;
    for (const sz of [-1, 1]) {
      for (let k = 0; k < PLANKS; k++) {
        const y0 = mix(BOTTOM, RIM, k / PLANKS); const y1 = mix(BOTTOM, RIM, (k + 1) / PLANKS);
        wood.push({ geometry: timber([tx0, (y0 + y1) / 2, sz * (HZ + THICK / 2)], [tx1, (y0 + y1) / 2, sz * (HZ + THICK / 2)], THICK, y1 - y0 - 0.012, { seed: k * 3.7 + sz, chamfer: 0.012 }), color: tone(0xa97f4e) });
      }
    }
    for (const x of [tx0, tx1]) {
      for (let k = 0; k < PLANKS; k++) {
        const y0 = mix(BOTTOM, RIM, k / PLANKS); const y1 = mix(BOTTOM, RIM, (k + 1) / PLANKS);
        const hz = HZ + THICK;
        wood.push({ geometry: timber([x, (y0 + y1) / 2, -hz], [x, (y0 + y1) / 2, hz], THICK, y1 - y0 - 0.012, { seed: k + x, up: [0, 1, 0], chamfer: 0.012 }), color: tone(0x8f6a3f) });
      }
    }
    // Bearers under it, on the yoke's posts at one end and on two posts of its own at the other.
    const xFar = tx1 - 0.15;
    for (const x of [YOKE[0], 7.6, xFar]) {
      wood.push({ geometry: timber([x, BOTTOM - 0.15, -SILL_Z - 0.2], [x, BOTTOM - 0.15, SILL_Z + 0.2], 0.3, 0.3, { seed: x, up: [1, 0, 0] }), color: tone(OAK) });
    }
    for (const sz of [-1, 1]) {
      wood.push({ geometry: timber([xFar, 0.26, sz * SILL_Z], [xFar, BOTTOM - 0.27, sz * SILL_Z], 0.3, 0.3, { seed: xFar * sz, up: [1, 0, 0] }), color: tone(OAK) });
    }
    for (const x of [tx0 + 0.75, tx1 - 0.75]) {
      for (const sz of [-1, 1]) {
        paint.push({ geometry: block(x - 0.07, BOTTOM - 0.05, sz * (HZ + THICK) - 0.015, x + 0.07, RIM + 0.03, sz * (HZ + THICK) + 0.015), color: IRON });
      }
    }
  }

  // --- The pool: coursed stone round a blue basin ---
  const POOL = { X0: -8.85, X1: -1.85, Z: 2.75, TOP: 2.1 };
  {
    const { X0: px0, X1: px1, Z: pz, TOP } = POOL;
    const WALLT = 0.5;
    const COURSES = 4;
    const stones = (ax0, ax1, fixed, alongXAxis) => {
      for (let c = 0; c < COURSES; c++) {
        const y0 = mix(0, TOP, c / COURSES); const y1 = mix(0, TOP, (c + 1) / COURSES);
        const len = ax1 - ax0;
        const n = Math.round(len / 1.15);
        const shift = c % 2 ? 0.5 : 0;
        for (let k = -1; k < n; k++) {
          const a0 = Math.max(ax0, ax0 + ((k + shift) / n) * len);
          const a1 = Math.min(ax1, ax0 + ((k + 1 + shift) / n) * len);
          if (a1 - a0 < 0.05) continue;
          const yc = (y0 + y1) / 2;
          const a = alongXAxis ? [a0 + 0.008, yc, fixed] : [fixed, yc, a0 + 0.008];
          const b = alongXAxis ? [a1 - 0.008, yc, fixed] : [fixed, yc, a1 - 0.008];
          const col = new THREE.Color(STONE).multiplyScalar(0.82 + rng() * 0.3).getHex();
          paint.push({ geometry: timber(a, b, WALLT, y1 - y0 - 0.012, { chamfer: 0.035 }), color: col });
        }
      }
    };
    stones(px0, px1, pz - WALLT / 2, true);
    stones(px0, px1, -pz + WALLT / 2, true);
    stones(-pz + WALLT, pz - WALLT, px0 + WALLT / 2, false);
    stones(-pz + WALLT, pz - WALLT, px1 - WALLT / 2, false);
    // Coping along the top.
    for (const [a, b] of [[[px0 - 0.06, TOP + 0.05, pz - WALLT / 2], [px1 + 0.06, TOP + 0.05, pz - WALLT / 2]], [[px0 - 0.06, TOP + 0.05, -pz + WALLT / 2], [px1 + 0.06, TOP + 0.05, -pz + WALLT / 2]], [[px0 + WALLT / 2, TOP + 0.05, -pz], [px0 + WALLT / 2, TOP + 0.05, pz]], [[px1 - WALLT / 2, TOP + 0.05, -pz], [px1 - WALLT / 2, TOP + 0.05, pz]]]) {
      paint.push({ geometry: timber(a, b, WALLT + 0.14, 0.1, { chamfer: 0.03 }), color: 0xb0a998 });
    }
    paint.push({ geometry: block(px0 + 0.1, 0, -pz + 0.1, px1 - 0.1, 0.12, pz - 0.1), color: 0x28495c });
  }

  // --- The water that stays put: the pool, the trough and the fall between them ---
  const still = [];
  const STILL_DEEP = 0x0f6fe0;
  {
    const { X0: px0, X1: px1, Z: pz } = POOL;
    // Mapped once across the ripple half of the shared canvas (see paintRipple).
    const rippled = (g, x0, x1, z0, z1) => {
      const U = g.attributes.uv; const Q = g.attributes.position;
      for (let i = 0; i < Q.count; i++) U.setXY(i, mix(0.01, 0.99, (Q.getX(i) - x0) / (x1 - x0)), mix(0.51, 0.99, (Q.getZ(i) - z0) / (z1 - z0)));
      return g;
    };
    const pool = rippled(block(px0 + 0.3, POOL_Y - 0.5, -pz + 0.3, px1 - 0.3, POOL_Y, pz - 0.3), px0 + 0.3, px1 - 0.3, -pz + 0.3, pz - 0.3);
    still.push({ geometry: pool, color: STILL_DEEP });
    const tx0 = TR.X0 + 0.08; const tx1 = TR.X1 - 0.08;
    const tw = rippled(block(tx0, TR.BOTTOM + 0.1, -TR.HZ + 0.005, tx1, TR.WATER, TR.HZ - 0.005), tx0, tx1, -TR.HZ, TR.HZ);
    still.push({ geometry: tw, color: STILL_DEEP });
    // What spills over the lip: a thin sheet falling from the channel's low point into the trough.
    const lip = P(LENGTH + 0.02, R - 0.02, A.PHI_LOW);
    const pts = [[lip[0] - 0.24, lip[1] + 0.08, lip[2]], [lip[0] + 0.04, lip[1] - 0.02, lip[2]], [lip[0] + 0.2, lip[1] - 0.34, lip[2]], [lip[0] + 0.3, TR.WATER + 0.02, lip[2]]];
    const fall = tube(pts, [0.075, 0.09, 0.07, 0.11], { steps: 18, sides: 12, round: 1, frame: () => [0, 0, 1], section: () => [3.2, 0.5] });
    still.push({ geometry: fall, color: 0x3ea4f2 });
    const splash = seededRandom(41);
    for (let i = 0; i < 14; i++) {
      const a = splash() * TAU; const r = 0.1 + splash() * 0.34;
      const b = ball(0.03 + splash() * 0.05, [0, 0, 0], 8);
      b.scale(1.6, 0.35, 1.6);
      b.translate(lip[0] + 0.3 + Math.cos(a) * r, TR.WATER + 0.008, lip[2] + Math.sin(a) * r * 1.3);
      still.push({ geometry: b, color: 0xa8daf6 });
    }
  }

  // --- What turns. `spinner` sits in the shaft's own frame: x along the shaft, y across and up, z across ---
  const holder = new THREE.Group();
  holder.name = 'shaft-frame';
  holder.position.set(A.X0, A.Y0, 0);
  holder.rotation.z = ALPHA;
  const spinner = new THREE.Group();
  spinner.name = 'screw';
  holder.add(spinner);
  const turning = [];
  {
    // The blade: one real helix with a real thickness, from the foot to just short of the lip.
    const phi0 = (0.08 - A.XB) * (TAU / PITCH);
    const phi1 = (A.BLADE_END - A.XB) * (TAU / PITCH);
    const turns = Math.abs(phi1 - phi0) / TAU;
    const NU = Math.round(turns * 72);
    const NV = 5;
    const at = (i, j, off) => {
      const phi = mix(phi0, phi1, i / NU);
      const rho = mix(R0 - 0.05, R, j / NV);
      return [screwX(phi) + off, rho * Math.cos(phi), rho * Math.sin(phi)];
    };
    const blade = gridSolid(NU, NV, (i, j) => at(i, j, BLADE_T / 2), (i, j) => at(i, j, -BLADE_T / 2), { crease: 40 });
    turning.push({ geometry: blade, color: 0xb5512a });
    if (turns < 4.4) throw new Error('archimedes-screw: too few turns');
    // A bright strip along the blade's outer edge, one line running the whole way round: most of what
    // makes the eye follow it as one spiral rather than a row of fins.
    const edge = [];
    const NE = Math.round(turns * 60);
    for (let i = 0; i <= NE; i++) {
      const phi = mix(phi0, phi1, i / NE);
      edge.push([screwX(phi), (R - 0.012) * Math.cos(phi), (R - 0.012) * Math.sin(phi)]);
    }
    turning.push({ geometry: tube(edge, 0.042, { steps: NE, sides: 6, round: 1 }), color: 0xf4d08a });
    // The shaft, with the bands and the crank's boss on it. Mid oak, so that it is not a black beam
    // across the middle of the view.
    const prof = [[0, -0.25], [R0 * 0.36, -0.25], [R0 * 0.44, -0.2], [R0 * 0.44, -0.06], [R0, -0.04], [R0, LENGTH], [R0 * 0.72, LENGTH + 0.06], [0.1, LENGTH + 0.14], [0.1, LENGTH + 1.2], [0, LENGTH + 1.22]];
    turning.push({ geometry: alongX(turned(prof, 32)), color: 0xa98a5e });
    // The crank: an iron arm and a turned wooden grip.
    const CX = LENGTH + 1.0;
    const ARM = 1.12;
    turning.push({ geometry: alongX(turned([[0, -0.1], [0.17, -0.1], [0.2, -0.07], [0.2, 0.07], [0.17, 0.1], [0, 0.1]], 22)).translate(CX, 0, 0), color: 0x3c4046 });
    turning.push({ geometry: timber([CX, 0, 0], [CX, ARM, 0], 0.12, 0.2, { up: [1, 0, 0], chamfer: 0.02 }), color: 0x3c4046 });
    turning.push({ geometry: alongX(turned([[0, -0.08], [0.1, -0.08], [0.11, 0.0], [0.08, 0.08], [0, 0.08]], 16)).translate(CX, ARM, 0), color: 0x3c4046 });
    turning.push({ geometry: rod([CX, ARM, 0], [CX + 0.14, ARM, 0], 0.04, 10, 0), color: 0x3c4046 });
    turning.push({ geometry: alongX(turned([[0, 0], [0.055, 0], [0.085, 0.08], [0.1, 0.32], [0.095, 0.62], [0.07, 0.74], [0, 0.76]], 18)).translate(CX + 0.1, ARM, 0), color: 0xb07a42 });
    // Iron bands on the shaft, which also show it turning.
    for (const s of [0.04, LENGTH - 0.25]) {
      turning.push({ geometry: alongX(turned([[0, -0.05], [R0 + 0.02, -0.05], [R0 + 0.02, 0.05], [0, 0.05]], 28)).translate(s, 0, 0), color: 0x34383d });
    }
  }
  spinner.add(mesh(mergeParts(turning), standard({ vertexColors: true, roughness: 0.46, metalness: 0.12 })));

  // --- The pockets: they slide up the shaft and they do not turn ---
  const one = pocketGeometry();
  one.computeBoundingBox();
  const wedge = one.boundingBox.max.x; // how far up the shaft a pocket's edge reaches from its low point
  const anchors = [];
  for (let k = 0; k < POCKETS; k++) anchors.push(FIRST + k * PITCH);
  const running = [];
  for (let k = 0; k < POCKETS; k++) {
    const g = one.clone();
    g.translate(anchors[k], 0, 0);
    running.push({ geometry: g, keepColor: true });
  }
  // A little of the water's own colour as a glow, so that its side face stays saturated blue when it
  // is turned away from the sun. A flat emissive is safe on one colour of thing.
  const pocketMaterial = () => standard({ vertexColors: true, roughness: 0.22, metalness: 0, emissive: 0x0646b8, emissiveIntensity: 0.55 });
  const array = new THREE.Group();
  array.name = 'pockets';
  array.add(mesh(mergeParts(running), pocketMaterial()));
  holder.add(array);
  // The last pocket, which pours away over the lip as it reaches the end. It is authored about its
  // own low point, so that shrinking it draws the water down into the corner of blade and channel
  // rather than off the wall.
  const lastAnchor = FIRST + POCKETS * PITCH;
  const LOWY = R * Math.cos(A.PHI_LOW); const LOWZ = R * Math.sin(A.PHI_LOW);
  const last = new THREE.Group();
  last.name = 'last-pocket';
  last.position.set(lastAnchor, LOWY, LOWZ);
  if (lastAnchor + wedge > LENGTH) throw new Error('archimedes-screw: the last pocket starts out past the lip');
  const lastGeo = one.clone();
  lastGeo.translate(0, -LOWY, -LOWZ);
  last.add(mesh(mergeParts([{ geometry: lastGeo, keepColor: true }]), pocketMaterial()));
  holder.add(last);
  root.add(holder);

  root.add(mesh(mergeParts(wood), woodMaterial(2201)));
  // Stone, iron and still water share one mesh and one small canvas. Everything but the water samples
  // the canvas's white half.
  const dry = mergeParts(paint);
  dry.attributes.uv.array.fill(0.25);
  const wet = mergeParts(still);
  {
    const U = wet.attributes.uv;
    for (let i = 0; i < U.count; i++) if (U.getY(i) < 0.5) U.setXY(i, 0.25, 0.25);
  }
  const rippleMap = canvasTexture(256, 256, (c, w, h) => paintRipple(c, w, h, 91));
  root.add(mesh(mergeParts([{ geometry: dry, keepColor: true }, { geometry: wet, keepColor: true }]), standard({ vertexColors: true, map: rippleMap, roughness: 0.55, metalness: 0.03 })));
  const glassMesh = mesh(mergeParts(glass), standard({ vertexColors: true, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false }));
  noShadow(glassMesh);
  glassMesh.renderOrder = 2;
  root.add(glassMesh);

  // The screw turns; each pocket rises one pitch per turn; and the whole array is the same picture
  // again after exactly one turn, so it wraps with no jump.
  const omega = TAU / TURN;
  // The water pours away as its upper edge reaches the end of the channel, so none of it ever hangs
  // in the air past the lip, and it is gone by the time the next one takes its place.
  const drainOf = (offset) => Math.min(1, (LENGTH - lastAnchor - offset) / wedge) * (1 - sstep(offset, PITCH * 0.8, PITCH * 0.995));
  let t = 0;
  root.userData.tick = {
    update(dt) {
      if (reducedMotion()) return;
      t += dt;
      spinner.rotation.x = -omega * t;
      const offset = ((t % TURN) / TURN) * PITCH;
      array.position.x = offset;
      last.position.x = lastAnchor + offset;
      const k = Math.max(0.001, drainOf(offset));
      last.scale.set(k, k, k);
    },
    dispose() {},
  };
  return root;
}

// ===========================================================================================
// GALILEO'S RAMP
// ===========================================================================================

export const RAMP = {
  LENGTH: 18,
  TILT: 3.3 * DEG,
  UNIT: 0.66, // one unit of distance on the scale, in feet along the ramp
  BELLS: [1, 4, 9, 16, 25],
  Z_START: -8.2,
  BALL_R: 0.17,
  G: 32.2,
  HOLD: 1.4, // waits at the top before it is let go
  RUNOUT: 0.3, // seconds from the last bell to the stop
  RUNOUT_FT: 0.2,
  PAUSE: 2.2,
};
{
  const G = RAMP;
  G.RUN = G.UNIT * 25;
  // A solid ball rolling without slipping has a = (5/7) g sin(tilt), since some of the energy goes
  // into its spin. That is why it is slower than a slide, and it changes nothing about the squares.
  G.A = (5 / 7) * G.G * Math.sin(G.TILT);
  G.ROLL = Math.sqrt((2 * G.RUN) / G.A); // the time to the last bell
  G.STEP = G.ROLL / 5; // the equal step of time between bells
  G.CYCLE = G.HOLD + G.ROLL + G.RUNOUT + G.PAUSE;
}
// How far the ball has gone, in feet along the ramp, at a time into the cycle.
export function rampBallS(time) {
  const G = RAMP;
  const t = ((time % G.CYCLE) + G.CYCLE) % G.CYCLE;
  if (t < G.HOLD) return 0;
  const r = t - G.HOLD;
  if (r < G.ROLL) return 0.5 * G.A * r * r;
  const e = (r - G.ROLL) / G.RUNOUT;
  if (e < 1) return G.RUN + G.RUNOUT_FT * (1 - (1 - e) ** 2);
  return G.RUN + G.RUNOUT_FT;
}

function paintRampScale(ctx, W, H, zHi, length) {
  const G = RAMP;
  const X = (n) => ((zHi - (G.Z_START + n * G.UNIT)) / length) * W; // u runs toward -Z, which is uphill
  ctx.fillStyle = '#ecdcae';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#5b4522';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, W - 4, H - 4);
  ctx.fillStyle = '#2b2012';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let n = 0; n <= 25; n++) {
    const major = n % 5 === 0;
    ctx.fillRect(X(n) - (major ? 2.5 : 1.5), 4, major ? 5 : 3, H * (major ? 0.42 : 0.3));
    ctx.font = `700 ${Math.round(H * (major ? 0.42 : 0.36))}px ${FONT}`;
    ctx.fillText(String(n), X(n), H * 0.47);
  }
}

function buildRamp() {
  const G = RAMP;
  const root = new THREE.Group();
  const wood = [];
  const paint = [];
  const metal = [];
  const rng = seededRandom(1604);
  const tone = (c, v = 0.09) => { const k = 1 + (rng() - 0.5) * 2 * v; return new THREE.Color(c).multiplyScalar(k).getHex(); };
  const OAK = 0x9d7345; const DARK = 0x6c4a2b; const IRON = 0x34373b; const BRONZE = 0xc89a3e;

  // The ramp's own frame: y = 0 is the top of the rails, z runs downhill.
  const H = 3.25;
  const M = new THREE.Matrix4().compose(V(0, H, 0), new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), G.TILT), V(1, 1, 1));
  const local = (g) => { g.applyMatrix4(M); return g; };
  const pt = (x, y, z) => { const v = V(x, y, z).applyMatrix4(M); return [v.x, v.y, v.z]; };
  const HL = G.LENGTH / 2;
  const FLOOR = -0.1; const HW = 0.2; const RAILW = 0.42;
  const BOARD = 0.34;

  // --- The ramp: a board and two rails, which make the groove; and a strip of pale vellum in it ---
  wood.push({ geometry: local(timber([0, FLOOR - BOARD / 2, -HL], [0, FLOOR - BOARD / 2, HL], (HW + RAILW) * 2, BOARD, { chamfer: 0.03, seed: 1 })), color: 0x8a6036 });
  for (const s of [-1, 1]) {
    const x = s * (HW + RAILW / 2);
    wood.push({ geometry: local(timber([x, FLOOR / 2, -HL], [x, FLOOR / 2, HL], RAILW, -FLOOR, { chamfer: 0.016, seed: 2 + s })), color: 0xb0814b });
  }
  paint.push({ geometry: local(block(-HW, FLOOR - 0.004, -HL + 0.1, HW, FLOOR + 0.006, HL - 0.05)), color: 0xe9dcb8 });

  // --- The start block behind the ball, the buffer at the bottom ---
  {
    const z = G.Z_START - G.BALL_R - 0.12;
    wood.push({ geometry: local(timber([0, 0.04, z - 0.1], [0, 0.04, z + 0.1], (HW + 0.1) * 2, 0.3, { chamfer: 0.025, seed: 9 })), color: 0x6c4a2b });
    const zb = G.Z_START + G.RUN + G.RUNOUT_FT + G.BALL_R + 0.14;
    wood.push({ geometry: local(timber([0, 0.04, zb], [0, 0.04, zb + 0.14], (HW + 0.1) * 2, 0.34, { chamfer: 0.025, seed: 10 })), color: 0x6c4a2b });
    // A leather pad on the buffer's face.
    paint.push({ geometry: local(timber([0, FLOOR + 0.16, zb - 0.13], [0, FLOOR + 0.16, zb + 0.01], HW * 2 - 0.02, 0.28, { chamfer: 0.04 })), color: 0x4a2c1a });
  }

  // --- EXACTLY five bells, on arches, at 1, 4, 9, 16 and 25 units ---
  if (G.BELLS.length !== 5) throw new Error('galileo-ramp: there must be five bells');
  G.BELLS.forEach((n, i) => {
    if (n !== (i + 1) ** 2) throw new Error('galileo-ramp: bells must stand at the squares');
    if (i && n - G.BELLS[i - 1] !== 2 * i + 1) throw new Error('galileo-ramp: gaps must be the odd numbers');
  });
  G.BELLS.forEach((n) => {
    const z = G.Z_START + n * G.UNIT;
    // The arch: a brass-capped iron hoop bolted to both rails.
    const W = HW + RAILW * 0.5; const CROWN = 0.9;
    const pts = [];
    for (let k = 0; k <= 22; k++) {
      const a = Math.PI - (k / 22) * Math.PI;
      pts.push(pt(W * Math.cos(a), CROWN * Math.pow(Math.sin(a), 0.72), z));
    }
    metal.push(polished(tube(pts, 0.03, { steps: 44, sides: 8, round: 1 }), 0x6b7076, 1.0));
    for (const s of [-1, 1]) {
      paint.push({ geometry: local(timber([s * (W - 0.13), 0.02, z], [s * (W + 0.13), 0.02, z], 0.16, 0.05, { chamfer: 0.012 })), color: IRON });
      for (const d of [-1, 1]) {
        paint.push({ geometry: local(ball(0.02, [s * (W + d * 0.09), 0.05, z], 8)), color: 0x1d1f22 });
      }
    }
    // The bell hangs straight down, not square to the ramp, so it is placed by world vertical.
    const crown = pt(0, CROWN, z);
    const BELL = [[0, -0.31], [0.13, -0.31], [0.145, -0.33], [0.155, -0.31], [0.14, -0.27], [0.105, -0.21], [0.086, -0.14], [0.08, -0.08], [0.058, -0.03], [0.022, -0.012], [0.022, 0.03], [0, 0.03]];
    const bell = turned(BELL, 32, { crease: 40 });
    bell.translate(crown[0], crown[1] - 0.04, crown[2]);
    metal.push(polished(bell, BRONZE, 1.02));
    // The feeler: a thin wire hanging from inside the bell into the ball's path, ending in a bead.
    const yMouth = crown[1] - 0.04 - 0.31;
    const ballTop = pt(0, FLOOR + 0.006 + 2 * G.BALL_R, z)[1];
    const tip = ballTop - 0.05;
    metal.push(polished(rod([crown[0], yMouth + 0.2, crown[2]], [crown[0], tip, crown[2]], 0.008, 6, 1), 0xb7bcc2));
    metal.push(polished(ball(0.028, [crown[0], tip, crown[2]], 10), BRONZE));
  });

  // --- The scale, in units along the +X side ---
  const SCALE_LEN = G.LENGTH - 0.6;
  const SCALE_H = 0.3;
  const zHi = 0.0 + SCALE_LEN / 2 + 0.1;
  const zC = zHi - SCALE_LEN / 2;
  const scaleMap = canvasTexture(2048, 40, (ctx, w, h) => paintRampScale(ctx, w, h, zHi, SCALE_LEN));
  const plate = printedPlate(SCALE_LEN, SCALE_H, 0.02, [0, 0, 1, 1]);
  plate.rotateY(Math.PI / 2);
  plate.translate(HW + RAILW + 0.018, FLOOR - BOARD / 2, zC);
  local(plate);

  // --- Two trestles, the taller at the top of the ramp, and a stretcher between ---
  const trestle = (z, seed) => {
    const top = pt(0, FLOOR - BOARD, z);
    const yCap = top[1] - 0.14;
    wood.push({ geometry: timber([-1.25, yCap, top[2]], [1.25, yCap, top[2]], 0.34, 0.28, { seed, chamfer: 0.03 }), color: tone(OAK) });
    const zc = top[2];
    for (const s of [-1, 1]) {
      const footX = s * 1.62;
      const headX = s * 0.92;
      for (const dz of [-1, 1]) {
        const a = [footX, 0.06, zc + dz * 0.55];
        const b = [headX, yCap - 0.1, zc + dz * 0.12];
        wood.push({ geometry: timber(a, b, 0.22, 0.2, { seed: seed + s + dz, up: [1, 0, 0] }), color: tone(OAK) });
      }
      // Sole plate.
      wood.push({ geometry: timber([footX, 0.07, zc - 0.85], [footX, 0.07, zc + 0.85], 0.3, 0.14, { seed: seed + 7 * s, chamfer: 0.02 }), color: tone(DARK) });
      paint.push({ geometry: ball(0.038, [headX + s * 0.14, yCap, zc + 0.17], 8), color: 0x1f1a14 });
      paint.push({ geometry: ball(0.038, [headX + s * 0.14, yCap, zc - 0.17], 8), color: 0x1f1a14 });
    }
    // A rail across each frame, front and back.
    const yR = yCap * 0.42;
    const xR = mix(1.62, 0.92, (yR - 0.06) / (yCap - 0.16));
    for (const dz of [-1, 1]) {
      const zz = zc + dz * mix(0.55, 0.12, (yR - 0.06) / (yCap - 0.16));
      wood.push({ geometry: timber([-xR - 0.12, yR, zz + dz * 0.1], [xR + 0.12, yR, zz + dz * 0.1], 0.08, 0.2, { seed: seed + 11 + dz, chamfer: 0.015 }), color: tone(DARK) });
    }
    return { yR, zc };
  };
  const a = trestle(-5.6, 20);
  const b = trestle(5.6, 40);
  wood.push({ geometry: timber([0, a.yR, a.zc], [0, b.yR, b.zc], 0.16, 0.26, { seed: 60, chamfer: 0.02 }), color: tone(DARK) });
  // Two struts from the stretcher's ends up to the middle of the ramp, which is where 18ft of board sags.
  const midY = pt(0, FLOOR - BOARD, 0)[1] - 0.06;
  wood.push({ geometry: timber([0, a.yR + 0.1, a.zc], [0, midY, 0], 0.14, 0.18, { seed: 61, up: [1, 0, 0], chamfer: 0.02 }), color: tone(DARK) });
  wood.push({ geometry: timber([0, b.yR + 0.1, b.zc], [0, midY, 0], 0.14, 0.18, { seed: 62, up: [1, 0, 0], chamfer: 0.02 }), color: tone(DARK) });

  root.add(mesh(mergeParts(wood), woodMaterial(1609)));
  root.add(mesh(mergeParts(paint), standard({ vertexColors: true, roughness: 0.7, metalness: 0.05 })));
  root.add(mesh(mergeParts(metal), standard({ vertexColors: true, roughness: 0.24, metalness: 0.42 })));
  root.add(mesh(plate, standard({ map: scaleMap, roughness: 0.75, metalness: 0 })));

  // --- The ball, in the ramp's own frame ---
  const frame = new THREE.Group();
  frame.name = 'ramp-frame';
  frame.position.set(0, H, 0);
  frame.rotation.x = G.TILT;
  const roller = new THREE.Group();
  roller.name = 'ball';
  roller.position.set(0, FLOOR + 0.006 + G.BALL_R, G.Z_START);
  const spin = new THREE.Group();
  roller.add(spin);
  frame.add(roller);
  {
    const g = new THREE.SphereGeometry(G.BALL_R, 48, 32);
    const brass = lin(0xe0ae48);
    const part = polished(g, brass, 1.06);
    // A dark line round it, in a plane that holds the rolling axis, so the roll can be seen.
    const C = part.geometry.attributes.color; const P = part.geometry.attributes.position;
    for (let i = 0; i < P.count; i++) {
      if (Math.abs(P.getZ(i)) < G.BALL_R * 0.13) C.setXYZ(i, 0.12, 0.07, 0.03);
    }
    spin.add(mesh(mergeParts([part]), standard({ vertexColors: true, roughness: 0.2, metalness: 0.45 })));
  }
  root.add(frame);

  let t = 0;
  root.userData.tick = {
    update(dt) {
      if (reducedMotion()) return;
      t = (t + dt) % G.CYCLE;
      const s = rampBallS(t);
      roller.position.z = G.Z_START + s;
      spin.rotation.x = s / G.BALL_R;
    },
    dispose() {},
  };
  return root;
}

// ===========================================================================================
// THE DOUBLE SLIT
// ===========================================================================================
//
// ONE DESCRIPTION OF THE WAVES, USED TWICE. The bench's painting and the screen's stripes both come
// from dsWave() with the same spacing, wavelength and distance, so a nodal line on the bench cannot
// land anywhere but on a dark stripe.

export const SLITS = {
  LAMBDA: 0.22, // the wavelength as drawn, in feet
  SPACING: 1.6, // centre to centre
  WIDTH: 0.08,
  Z_CARD: 0,
  Z_SCREEN: 4.55,
  Z_LAMP: -4.05, // the lamp's window
  BEAM: 1.8, // half the width of the straight waves
  BENCH_W: 5.6, BENCH_L: 10, BENCH_Y: 2.45,
  SCREEN_HW: 2.62, SCREEN_Y0: 0.2, SCREEN_Y1: 3.15,
};
// The two waves at a point on the bench: each falls off as 1/sqrt(r), which is what a wave spreading
// in a plane does, and each leaves its slit in step with the other.
export function dsWave(x, z) {
  const { SPACING, Z_CARD, LAMBDA } = SLITS;
  const k = TAU / LAMBDA;
  const r1 = Math.hypot(x - SPACING / 2, z - Z_CARD);
  const r2 = Math.hypot(x + SPACING / 2, z - Z_CARD);
  const a1 = 1 / Math.sqrt(Math.max(r1, 0.02));
  const a2 = 1 / Math.sqrt(Math.max(r2, 0.02));
  return {
    snapshot: a1 * Math.cos(k * r1) + a2 * Math.cos(k * r2),
    re: a1 * Math.cos(k * r1) + a2 * Math.cos(k * r2),
    im: a1 * Math.sin(k * r1) + a2 * Math.sin(k * r2),
    r1,
    r2,
  };
}
export function dsIntensity(x, z = SLITS.Z_SCREEN) {
  const w = dsWave(x, z);
  return w.re * w.re + w.im * w.im;
}
// Where the path difference is (m + 1/2) wavelengths at distance z: found by bisection, not assumed.
export function dsNodeX(m, z = SLITS.Z_SCREEN) {
  const { LAMBDA, SPACING, Z_CARD } = SLITS;
  const want = (m + 0.5) * LAMBDA;
  const diff = (x) => Math.hypot(x + SPACING / 2, z - Z_CARD) - Math.hypot(x - SPACING / 2, z - Z_CARD);
  if (want >= SPACING) return null;
  let a = 0; let b = 200;
  for (let i = 0; i < 60; i++) {
    const c = (a + b) / 2;
    if (diff(c) < want) a = c; else b = c;
  }
  return (a + b) / 2;
}

const RED = [226, 28, 12]; const NAVY = [18, 44, 96]; const PAPER = [244, 236, 214];

// The bench top. Canvas right is -Z and canvas down is +X, so it reads upright from the +X side.
function paintBench(ctx, W, H) {
  const { LAMBDA, Z_CARD, Z_SCREEN, Z_LAMP, BEAM, BENCH_W, BENCH_L } = SLITS;
  const k = TAU / LAMBDA;
  const sx = BENCH_L / W; const sy = BENCH_W / H;
  const tone = (v, out) => {
    const m = Math.min(1, Math.abs(v));
    const t = m ** 0.75;
    const c = v >= 0 ? RED : NAVY;
    out[0] = mix(PAPER[0], c[0], t); out[1] = mix(PAPER[1], c[1], t); out[2] = mix(PAPER[2], c[2], t);
  };
  paintTexels(ctx, 0, 0, W, H, (px, py, out) => {
    const z = BENCH_L / 2 - (px + 0.5) * sx;
    const x = (py + 0.5) * sy - BENCH_W / 2;
    if (z >= Z_CARD && z <= Z_SCREEN) {
      tone(dsWave(x, z).snapshot * 0.86, out);
    } else if (z < Z_CARD && z >= Z_LAMP) {
      // Straight fronts, in step with both slits at the card.
      const fade = sstep(BEAM - Math.abs(x), 0, 0.12);
      tone(Math.cos(k * (z - Z_CARD)) * 0.86 * fade, out);
    } else {
      out[0] = PAPER[0]; out[1] = PAPER[1]; out[2] = PAPER[2];
    }
  });
  // A dark wooden edge round the painting. The plate's rim samples this corner, so it is the bench's edge too.
  ctx.strokeStyle = '#4e321c';
  ctx.lineWidth = 16;
  ctx.strokeRect(0, 0, W, H);
}

function paintScreen(ctx, W, H) {
  const { SCREEN_HW } = SLITS;
  const peak = dsIntensity(0);
  const low = [20, 14, 22]; const mid = [214, 34, 22]; const high = [255, 222, 190];
  paintTexels(ctx, 0, 0, W, H, (px, py, out) => {
    const x = ((px + 0.5) / W - 0.5) * 2 * SCREEN_HW;
    const y = 1 - (py + 0.5) / H;
    const I = dsIntensity(x) / peak;
    const c = I < 0.5 ? mix(0, 1, I / 0.5) : 1;
    let r = mix(low[0], mid[0], c); let g = mix(low[1], mid[1], c); let b = mix(low[2], mid[2], c);
    if (I >= 0.5) {
      const t = (I - 0.5) / 0.5;
      r = mix(mid[0], high[0], t); g = mix(mid[1], high[1], t); b = mix(mid[2], high[2], t);
    }
    // The light has an edge above and below, and the board round it is white.
    const v = sstep(y, 0.13, 0.2) * (1 - sstep(y, 0.86, 0.93));
    const white = 248;
    out[0] = mix(white, r, v); out[1] = mix(white, g, v); out[2] = mix(white, b, v);
  });
  ctx.fillStyle = '#2b2622';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const yText = H * 0.935;
  ctx.font = `700 ${Math.round(H * 0.06)}px ${FONT}`;
  const hw = SCREEN_HW;
  // The label points at a real dark stripe: the second out from the middle, where it has room.
  const nodeX = dsNodeX(1);
  const uDark = (nodeX / (2 * hw) + 0.5) * W;
  ctx.fillText('bright', W / 2, yText);
  ctx.fillText('dark', uDark, yText);
  ctx.fillRect(W / 2 - 1.5, H * 0.87, 3, H * 0.03);
  ctx.fillRect(uDark - 1.5, H * 0.87, 3, H * 0.03);
}

function buildDoubleSlit() {
  const S = SLITS;
  const root = new THREE.Group();
  const wood = [];
  const dark = [];
  const B = S.BENCH_Y;
  const HW = S.BENCH_W / 2; const HL = S.BENCH_L / 2;
  const rng = seededRandom(1801);
  const tone = (c, v = 0.08) => { const k = 1 + (rng() - 0.5) * 2 * v; return new THREE.Color(c).multiplyScalar(k).getHex(); };
  const OAK = 0x8d6237; const DEEP = 0x5f3f24;
  if (S.LAMBDA >= S.SPACING) throw new Error('double-slit: no pattern is possible');

  // --- The painted bench top ---
  const CW = 2048; const CH = Math.round((CW * S.BENCH_W) / S.BENCH_L);
  const benchMap = canvasTexture(CW, CH, (ctx, w, h) => paintBench(ctx, w, h));
  const TOPT = 0.34;
  // A printed plate: its u runs toward -Z and its v toward -X, and its rim samples plain paper.
  const topGeo = printedPlate(S.BENCH_L, S.BENCH_W, TOPT, [0, 0, 1, 1]);
  topGeo.rotateX(-Math.PI / 2);
  topGeo.rotateY(Math.PI / 2);
  topGeo.translate(0, B, 0);
  root.add(mesh(topGeo, standard({ map: benchMap, roughness: 0.78, metalness: 0 })));

  // --- The bench under it: apron, four legs, stretchers ---
  const LEG_X = HW - 0.34; const LEG_Z = HL - 0.4;
  const APRON = 0.5;
  for (const [a, b, w, h] of [
    [[-LEG_X, B - TOPT - APRON / 2, LEG_Z], [LEG_X, B - TOPT - APRON / 2, LEG_Z], 0.16, APRON],
    [[-LEG_X, B - TOPT - APRON / 2, -LEG_Z], [LEG_X, B - TOPT - APRON / 2, -LEG_Z], 0.16, APRON],
    [[LEG_X, B - TOPT - APRON / 2, -LEG_Z], [LEG_X, B - TOPT - APRON / 2, LEG_Z], 0.16, APRON],
    [[-LEG_X, B - TOPT - APRON / 2, -LEG_Z], [-LEG_X, B - TOPT - APRON / 2, LEG_Z], 0.16, APRON],
  ]) wood.push({ geometry: timber(a, b, w, h, { chamfer: 0.02, seed: a[0] + a[2] }), color: tone(OAK) });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      wood.push({ geometry: timber([sx * LEG_X, 0, sz * LEG_Z], [sx * LEG_X, B - TOPT, sz * LEG_Z], 0.36, 0.36, { up: [1, 0, 0], chamfer: 0.035, seed: sx * 3 + sz }), color: tone(DEEP) });
    }
    wood.push({ geometry: timber([sx * LEG_X, 0.7, -LEG_Z], [sx * LEG_X, 0.7, LEG_Z], 0.14, 0.26, { chamfer: 0.02, seed: sx + 5 }), color: tone(OAK) });
  }
  wood.push({ geometry: timber([-LEG_X, 0.7, 0], [LEG_X, 0.7, 0], 0.26, 0.2, { chamfer: 0.02, seed: 8 }), color: tone(OAK) });

  // --- The card: dark, and with two real openings. Built from the list of openings, so that it
  //     has exactly as many slits as that list has entries ---
  const slitCentres = [-S.SPACING / 2, S.SPACING / 2];
  if (slitCentres.length !== 2) throw new Error('double-slit: there must be exactly two slits');
  const CARD_HW = HW - 0.28;
  const CARD_T = 0.05;
  const SL0 = B + 0.16; const SL1 = B + 1.92; // the slits' bottom and top
  const CARD_TOP = B + 2.2;
  {
    const panel = (x0, x1, y0, y1) => dark.push({ geometry: block(x0, y0, S.Z_CARD - CARD_T / 2, x1, y1, S.Z_CARD + CARD_T / 2), color: 0x1c1d22 });
    let x = -CARD_HW;
    for (const c of slitCentres) {
      panel(x, c - S.WIDTH / 2, SL0, SL1);
      x = c + S.WIDTH / 2;
    }
    panel(x, CARD_HW, SL0, SL1);
    panel(-CARD_HW, CARD_HW, B, SL0);
    panel(-CARD_HW, CARD_HW, SL1, CARD_TOP);
    // A thin bright lining round each opening, which is what lets a slit a inch wide read from afar.
    for (const c of slitCentres) {
      for (const d of [-1, 1]) {
        const xe = c + d * (S.WIDTH / 2 + 0.018);
        dark.push({ geometry: block(xe - 0.018, SL0, S.Z_CARD - CARD_T / 2 - 0.006, xe + 0.018, SL1, S.Z_CARD + CARD_T / 2 + 0.006), color: 0xc8cdd2 });
      }
      for (const y of [SL0 - 0.018, SL1 + 0.018]) {
        dark.push({ geometry: block(c - S.WIDTH / 2 - 0.036, y - 0.018, S.Z_CARD - CARD_T / 2 - 0.006, c + S.WIDTH / 2 + 0.036, y + 0.018, S.Z_CARD + CARD_T / 2 + 0.006), color: 0xc8cdd2 });
      }
    }
    // A wooden holder: a sole, and an upright at each end.
    wood.push({ geometry: timber([-CARD_HW - 0.1, B + 0.04, S.Z_CARD], [CARD_HW + 0.1, B + 0.04, S.Z_CARD], 0.4, 0.08, { chamfer: 0.02, seed: 21 }), color: tone(DEEP) });
    for (const s of [-1, 1]) {
      wood.push({ geometry: timber([s * (CARD_HW + 0.03), B, S.Z_CARD], [s * (CARD_HW + 0.03), CARD_TOP + 0.08, S.Z_CARD], 0.2, 0.2, { up: [1, 0, 0], chamfer: 0.02, seed: 22 + s }), color: tone(DEEP) });
    }
    wood.push({ geometry: timber([-CARD_HW - 0.1, CARD_TOP + 0.03, S.Z_CARD], [CARD_HW + 0.1, CARD_TOP + 0.03, S.Z_CARD], 0.14, 0.1, { chamfer: 0.02, seed: 25 }), color: tone(DEEP) });
  }

  // --- The screen: a white board painted on both faces, as a real translucent screen shows from both ---
  const SY0 = B + S.SCREEN_Y0; const SY1 = B + S.SCREEN_Y1;
  const SHW = S.SCREEN_HW;
  const SCH = 512; const SCW = Math.round((SCH * SHW * 2) / (S.SCREEN_Y1 - S.SCREEN_Y0));
  const screenMap = canvasTexture(1024, Math.round((1024 * SCH) / SCW), (ctx, w, h) => paintScreen(ctx, w, h));
  const SCREEN_T = 0.05;
  const screenGeo = gridSolid(1, 1,
    (i, j) => [i ? SHW : -SHW, j ? SY1 : SY0, S.Z_SCREEN - SCREEN_T / 2],
    (i, j) => [i ? SHW : -SHW, j ? SY1 : SY0, S.Z_SCREEN + SCREEN_T / 2],
    { uvTop: (i, j) => [1 - i, j], uvBottom: (i, j) => [i, j], crease: 40 });
  screenGeo.userData.screen = true;
  root.add(mesh(screenGeo, standard({ map: screenMap, roughness: 0.8, metalness: 0 })));
  {
    const F = 0.14;
    const fw = 0.2;
    const Z = S.Z_SCREEN;
    wood.push({ geometry: timber([-SHW - F, SY1 + F / 2 - 0.01, Z], [SHW + F, SY1 + F / 2 - 0.01, Z], fw, F, { chamfer: 0.02, seed: 31 }), color: tone(DEEP) });
    wood.push({ geometry: timber([-SHW - F, SY0 - F / 2 + 0.01, Z], [SHW + F, SY0 - F / 2 + 0.01, Z], fw, F, { chamfer: 0.02, seed: 32 }), color: tone(DEEP) });
    for (const s of [-1, 1]) {
      wood.push({ geometry: timber([s * (SHW + F / 2 - 0.01), B, Z], [s * (SHW + F / 2 - 0.01), SY1 + F, Z], F, fw, { up: [1, 0, 0], chamfer: 0.02, seed: 33 + s }), color: tone(DEEP) });
      wood.push({ geometry: timber([s * (SHW + F / 2 - 0.01), B + 0.05, Z - 0.42], [s * (SHW + F / 2 - 0.01), B + 0.05, Z + 0.42], 0.22, 0.1, { chamfer: 0.02, seed: 36 + s }), color: tone(DEEP) });
    }
  }

  // --- The lamp: a dark iron hood with a wide lit window, a chimney and a flex ---
  const lampGlow = [];
  {
    const Zw = S.Z_LAMP; const LW = 1.42; const LY0 = B + 0.18; const LH = 1.32; const LD = 0.62;
    const BOX = 0x25282d;
    // Bottom and top first; the window is framed by real rails, with the glass behind them.
    dark.push({ geometry: timber([-LW, LY0 + 0.0, Zw - LD / 2], [LW, LY0 + 0.0, Zw - LD / 2], LD, 0.14, { chamfer: 0.02 }), color: BOX });
    dark.push({ geometry: timber([-LW, LY0 + LH, Zw - LD / 2], [LW, LY0 + LH, Zw - LD / 2], LD, 0.14, { chamfer: 0.02 }), color: BOX });
    for (const s of [-1, 1]) {
      dark.push({ geometry: block(s * LW - 0.07, LY0, Zw - LD, s * LW + 0.07, LY0 + LH, Zw), color: BOX });
    }
    dark.push({ geometry: block(-LW, LY0, Zw - LD - 0.04, LW, LY0 + LH, Zw - LD + 0.03), color: BOX });
    // The window's glass, a little back from the frame. The only emissive thing in this model.
    lampGlow.push({ geometry: block(-LW + 0.06, LY0 + 0.06, Zw - 0.09, LW - 0.06, LY0 + LH - 0.06, Zw - 0.05), color: 0x4a1208 });
    // The hood: a sloped plate over the window and two cheeks.
    const hood = gridSolid(1, 1,
      (i, j) => [i ? LW + 0.12 : -LW - 0.12, j ? LY0 + LH + 0.1 : LY0 + LH - 0.22, j ? Zw - LD * 0.3 : Zw + 0.62],
      (i, j) => [i ? LW + 0.12 : -LW - 0.12, (j ? LY0 + LH + 0.1 : LY0 + LH - 0.22) + 0.05, j ? Zw - LD * 0.3 : Zw + 0.62],
      { crease: 30 });
    dark.push({ geometry: hood, color: 0x2f3338 });
    for (const s of [-1, 1]) {
      const X = s * (LW + 0.1);
      const cheek = gridSolid(1, 1,
        (i, j) => [X - 0.02, i ? (j ? LY0 + LH + 0.06 : LY0 + LH - 0.2) : (LY0 + 0.3), j ? Zw - 0.1 : (i ? Zw + 0.62 : Zw + 0.1)],
        (i, j) => [X + 0.02, i ? (j ? LY0 + LH + 0.06 : LY0 + LH - 0.2) : (LY0 + 0.3), j ? Zw - 0.1 : (i ? Zw + 0.62 : Zw + 0.1)],
        { crease: 30 });
      dark.push({ geometry: cheek, color: 0x2f3338 });
    }
    // Legs and a chimney with a cap.
    for (const s of [-1, 1]) {
      dark.push({ geometry: timber([s * (LW - 0.1), B, Zw - LD / 2], [s * (LW - 0.1), LY0, Zw - LD / 2], 0.24, 0.5, { up: [1, 0, 0], chamfer: 0.02 }), color: BOX });
    }
    const chim = turned([[0, 0], [0.26, 0], [0.26, 0.06], [0.2, 0.1], [0.19, 0.5], [0.3, 0.54], [0.32, 0.62], [0.2, 0.72], [0, 0.74]], 24);
    chim.translate(0, LY0 + LH + 0.05, Zw - LD / 2 - 0.05);
    dark.push({ geometry: chim, color: 0x2f3338 });
    // Louvres on the back, and the flex over the end of the bench.
    for (let i = 0; i < 4; i++) {
      dark.push({ geometry: block(-0.8, LY0 + 0.3 + i * 0.22, Zw - LD - 0.07, 0.8, LY0 + 0.36 + i * 0.22, Zw - LD), color: 0x4a4f55 });
    }
    dark.push({ geometry: tube([[1.1, LY0 + 0.4, Zw - LD - 0.03], [1.25, LY0 + 0.1, Zw - LD - 0.2], [1.5, B + 0.03, HL * -1 + 0.14], [1.75, B - 0.35, -HL - 0.04], [1.9, 0.4, -HL - 0.1], [2.0, 0.02, -HL - 0.15]], 0.028, { steps: 40, sides: 6, round: 1 }), color: 0x141518 });
  }

  // --- Names, on a strip along the bench's +X edge ---
  const labelMap = canvasTexture(2048, 64, (ctx, w, h) => {
    ctx.fillStyle = '#e6d8b0';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#5b4522';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.fillStyle = '#231b0c';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const X = (z) => ((HL - z) / S.BENCH_L) * w;
    const put = (text, z, room) => {
      fitFont(ctx, text, room * (w / S.BENCH_L), h * 0.6);
      ctx.fillText(text, X(z), h / 2);
    };
    put('SCREEN', S.Z_SCREEN - 0.05, 1.0);
    put('THE WAVES FROM TWO SLITS OVERLAP', (S.Z_CARD + S.Z_SCREEN) / 2 + 0.05, 3.1);
    put('TWO SLITS', S.Z_CARD, 0.9);
    put('STRAIGHT WAVES', (S.Z_LAMP + S.Z_CARD) / 2, 1.8);
    put('LAMP', S.Z_LAMP - 0.3, 0.8);
  });
  const label = printedPlate(S.BENCH_L - 0.1, (S.BENCH_L - 0.1) * 64 / 2048, 0.02, [0, 0, 1, 1]);
  label.rotateY(Math.PI / 2);
  label.translate(HW + 0.018, B - TOPT * 0.5, 0);

  root.add(mesh(mergeParts(wood), woodMaterial(1802)));
  root.add(mesh(mergeParts(dark), standard({ vertexColors: true, roughness: 0.55, metalness: 0.08 })));
  root.add(mesh(label, standard({ map: labelMap, roughness: 0.75, metalness: 0 })));
  const glow = mesh(mergeParts(lampGlow), standard({ vertexColors: true, color: 0xffffff, emissive: 0xff2c10, emissiveIntensity: 1.05, roughness: 0.6, metalness: 0 }));
  glow.castShadow = false;
  root.add(glow);
  return root;
}

export const BUILDERS = {
  'van-de-graaff': () => buildVanDeGraaff(),
  'foucault-pendulum': () => buildFoucault(),
  'archimedes-screw': () => buildScrew(),
  'galileo-ramp': () => buildRamp(),
  'double-slit': () => buildDoubleSlit(),
};
