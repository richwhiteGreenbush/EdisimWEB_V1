import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, standard, canvasTexture, seededRandom } from '../../PropKit.js';
import { mergeParts, extrudeOutline, solidLoft, smoothNoise3 } from '../../props/LoftKit.js';
import {
  Sculpt, polygonize, ellipsoidP, tube, lathe, outward, alongMatrix, tintVertices, signedVolume, lin, clamp01, mix, sstep,
} from '../ModelKit.js';

// The Model Database's fourth science family: the James Webb Space Telescope, a limestone cave, the
// Space Shuttle orbiter, an electric motor and a Tesla coil. Authored in feet, origin at the base
// centre, front toward +Z.

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

// Value noise on a lattice that wraps, much faster per texel than a hashed 3D noise.
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

// A closed slab between two matching grids. Consistently wound by construction, turned outward by
// measuring, because which way it comes out depends on the handedness of the caller's (i, j).
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

// A solid of revolution about +Y with UVs under the caller's control, written bottom-up, axis to axis.
function turned(profile, segments, { uTiles = 1, vScale = 1, crease = 28, vFn = null } = {}) {
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
function beam(a, b, w, h = w, up = [0, 1, 0]) {
  const { m, len } = alongMatrix(a, b, up);
  const g = new THREE.BoxGeometry(w, h, len);
  g.translate(0, 0, len / 2);
  g.applyMatrix4(m);
  return g;
}

function block(x0, y0, z0, x1, y1, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

// Stands a thing authored along +Y at p, pointing along dir.
function standAt(p, dir) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, V(dir[0], dir[1], dir[2]).normalize());
  return new THREE.Matrix4().compose(V(p[0], p[1], p[2]), q, V(1, 1, 1));
}
const stood = (geometry, p, dir) => { geometry.applyMatrix4(standAt(p, dir)); return geometry; };

// A flat printed plate, its face on +Z and its back at z = -depth, centre at the origin. The rim
// samples one corner of its own rectangle, so the edge is plain rather than a squashed print.
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
// warm ground below. `palette` tints it, which is all the difference between steel, brass and copper.
// There is no environment map anywhere in this app, so a mirror finish has to be painted.
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

// ===========================================================================================
// THE JAMES WEBB SPACE TELESCOPE
// ===========================================================================================
//
// True size, shown at about 1/3 by the catalogue. Eighteen flat-topped hexagons, 1.32 m across their
// flats, in two rings round a missing centre: which is what puts three in each outer column, the two
// "wings" that fold back to fit the rocket. The sunshield's long axis runs across the telescope's
// line of sight and its five layers fan apart toward the edge.

const WEBB = {
  F: 4.33, // flat to flat, 1.32 m
  GAP: 0.07, // really about a quarter of an inch: opened a little so each segment reads at 1/3 scale
  RC: 52.1, // the primary's radius of curvature, 15.88 m
  L: 34.75, // half the 69.5ft length of the shield
  D: 23.25, // half its 46.5ft width
  S0: 17.5, // the shield's middle layer
  ZP: -6, // the primary's vertex
  CY: 37.5, // the primary's centre height
  SECONDARY: 23.5, // the secondary stands 7.16 m in front of the primary
};
WEBB.R = WEBB.F / Math.sqrt(3);

function webbCells() {
  const cells = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      if (dist === 1 || dist === 2) cells.push({ x: 1.5 * WEBB.R * q, y: WEBB.F * (r + q / 2), dist });
    }
  }
  if (cells.length !== 18) throw new Error(`james-webb-telescope: ${cells.length} mirror segments, not 18`);
  if (cells.filter((c) => c.dist === 1).length !== 6) throw new Error('james-webb-telescope: the inner ring must hold 6');
  return cells;
}

const webbSurface = (x, y) => WEBB.ZP + (x * x + y * y) / (2 * WEBB.RC);

// One segment: a domed fan of small triangles on the primary's own paraboloid, a chamfered rim and a
// flat back. Fine enough that a painted reflection can sweep across it.
function webbSegment(cell, index, rng) {
  const { R, GAP, CY } = WEBB;
  const r = R - GAP / Math.sqrt(3);
  const n = 6;
  const pos = []; const uv = [];
  const corner = (k) => [Math.cos((k * Math.PI) / 3) * r, Math.sin((k * Math.PI) / 3) * r];
  const at = (a, b, i, j) => {
    const lx = ((i - j) * a[0] + j * b[0]) / n;
    const ly = ((i - j) * a[1] + j * b[1]) / n;
    const x = cell.x + lx; const y = cell.y + ly;
    return [x, y + CY, webbSurface(x, y) - (i === n ? 0.05 : 0)];
  };
  const push = (...pts) => { for (const p of pts) { pos.push(p[0], p[1], p[2]); uv.push(0, 0); } };
  const back = (p) => [p[0], p[1], webbSurface(cell.x, cell.y) - 0.42];
  for (let k = 0; k < 6; k++) {
    const a = corner(k); const b = corner(k + 1);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        push(at(a, b, i, j), at(a, b, i + 1, j), at(a, b, i + 1, j + 1));
        if (j < i) push(at(a, b, i, j), at(a, b, i + 1, j + 1), at(a, b, i, j + 1));
      }
    }
    for (let j = 0; j < n; j++) {
      const p = at(a, b, n, j); const q = at(a, b, n, j + 1);
      push(p, back(p), back(q), p, back(q), q);
    }
    for (let j = 0; j < n; j++) push(back(at(a, b, n, j)), back([cell.x, cell.y + CY]), back(at(a, b, n, j + 1)));
  }
  const g = soup(pos, uv, 24);
  // Gold is the identification, so its reflections are painted: each mirror holds its own slice of
  // the room, dark amber through to pale, so the eighteen read as eighteen.
  const deep = lin(0xb9800f); const mid = lin(0xf6bd28); const high = lin(0xfff2a8); const rim = lin(0x6e4a10);
  const phase = rng() * TAU; const dirA = 0.5 + rng() * 1.2;
  const reach = 0.28 + rng() * 0.2;
  tintVertices(g, (x, y, z, out, i) => {
    const nz = g.attributes.normal.getZ(i);
    if (nz < 0.75) { out[0] = rim[0]; out[1] = rim[1]; out[2] = rim[2]; return; }
    const lx = (x - cell.x) / R; const ly = (y - CY - cell.y) / R;
    const s = lx * Math.cos(dirA) + ly * Math.sin(dirA);
    // A broad sweep over the whole primary, broken per segment, then one bright band.
    const whole = Math.sin((x * 0.2 + (y - CY) * 0.31) + 0.7) * 0.5 + 0.5;
    const t = clamp01(0.36 + 0.34 * whole + 0.3 * s * reach * 3 + 0.14 * Math.sin(phase));
    const band = Math.exp(-(((s - Math.sin(phase) * 0.45) / 0.26) ** 2)) * 0.3;
    const a = t < 0.5 ? deep : mid; const b = t < 0.5 ? mid : high;
    const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    for (let c = 0; c < 3; c++) out[c] = clamp01(mix(mix(a[c], b[c], k), high[c], band));
  });
  return { geometry: g, keepColor: true };
}

function paintWebbFoil(ctx, w, h) {
  const rng = seededRandom(1990);
  ctx.fillStyle = '#f7f7f7';
  ctx.fillRect(0, 0, w, h);
  // Fine crinkle: a foil film is never flat, and it is this that says "film" rather than "plate".
  for (let i = 0; i < 900; i++) {
    const x = rng() * w; const y = rng() * h;
    const a = rng() * Math.PI; const l = 8 + rng() * 34;
    const v = rng() > 0.5 ? 255 : 196 + rng() * 40;
    ctx.strokeStyle = `rgba(${v},${v},${v},${0.28 + rng() * 0.4})`;
    ctx.lineWidth = 0.8 + rng() * 1.4;
    for (const ox of [-w, 0, w]) {
      for (const oy of [-h, 0, h]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
        ctx.stroke();
      }
    }
  }
  // The heat-sealed seams between the membrane's gores.
  ctx.fillStyle = 'rgba(120,112,128,0.42)';
  for (let i = 0; i < 4; i++) ctx.fillRect(0, (i * h) / 4, w, 3);
  ctx.fillStyle = 'rgba(120,112,128,0.2)';
  for (let i = 0; i < 2; i++) ctx.fillRect((i * w) / 2, 0, 3, h);
  // A rip-stop lattice, faint.
  ctx.strokeStyle = 'rgba(130,126,136,0.16)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 32; i++) {
    ctx.beginPath(); ctx.moveTo((i * w) / 32, 0); ctx.lineTo((i * w) / 32, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, (i * h) / 32); ctx.lineTo(w, (i * h) / 32); ctx.stroke();
  }
}

function paintWebbPlate(ctx, w, h) {
  // Top half: the name plate. Bottom half: a tile of solar cells.
  ctx.fillStyle = '#16233c';
  ctx.fillRect(0, 0, w, h / 2);
  ctx.strokeStyle = '#d2a94c';
  ctx.lineWidth = 8;
  ctx.strokeRect(12, 12, w - 24, h / 2 - 24);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f7ecd0';
  fitFont(ctx, 'JAMES WEBB SPACE TELESCOPE', w - 90, 70, '800');
  ctx.fillText('JAMES WEBB SPACE TELESCOPE', w / 2, h * 0.17);
  ctx.fillStyle = '#d7deea';
  fitFont(ctx, 'Sunshield about 70 feet long. Shown at about 1/3 of life size', w - 90, 36, '600');
  ctx.fillText('Sunshield about 70 feet long. Shown at about 1/3 of life size', w / 2, h * 0.34);
  ctx.fillStyle = '#10213f';
  ctx.fillRect(0, h / 2, w, h / 2);
  // A dark patch for the array's plain back.
  ctx.fillStyle = '#23252b';
  ctx.fillRect(w - 16, 0, 16, 8);
  const N = 20; const cw = w / N; const ch = (h / 2) / 5;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < N; c++) {
      const v = (c * 7 + r * 13) % 9;
      ctx.fillStyle = `rgb(${24 + v * 2},${48 + v * 3},${112 + v * 5})`;
      ctx.fillRect(c * cw + 2, h / 2 + r * ch + 2, cw - 4, ch - 4);
    }
  }
}
const WEBB_PLATE_UV = [0, 0.5, 1, 1];
const WEBB_CELLS_UV = [0, 0, 1, 0.5];

function buildWebb() {
  const { F, R, L, D, S0, ZP, CY, SECONDARY } = WEBB;
  const gold = [];
  const struct = [];
  const foil = [];
  const print = [];
  const add = (geometry, color) => { struct.push({ geometry, color }); return geometry; };
  const BLACK = 0x34373f;
  const CARBON = 0x43464f;
  const GREY = 0x5c6068;
  const SILVER = 0xb9bec6;
  const FOIL_GOLD = 0xd8a32c;

  // --- The primary: exactly 18, asserted ---
  const cells = webbCells();
  const rng = seededRandom(2021);
  cells.forEach((cell, i) => gold.push(webbSegment(cell, i, rng)));

  // Behind every segment a black plate at full size, so each gap is black rather than daylight.
  const plate = (cell) => {
    const pts = [];
    for (let k = 0; k < 6; k++) pts.push([Math.cos((k * Math.PI) / 3) * R, Math.sin((k * Math.PI) / 3) * R]);
    const g = outward(extrudeOutline(pts, 0.5));
    g.translate(cell.x, cell.y + CY, webbSurface(cell.x, cell.y) - 0.58);
    return g;
  };
  for (const cell of cells) add(plate(cell), CARBON);

  // --- The backplane: a black lattice joining every neighbouring cell, in two depths ---
  const backZ = (cell, d) => webbSurface(cell.x, cell.y) - d;
  for (let a = 0; a < cells.length; a++) {
    const A = cells[a];
    for (let b = a + 1; b < cells.length; b++) {
      const B = cells[b];
      if (Math.hypot(A.x - B.x, A.y - B.y) > F * 1.1) continue;
      add(beam([A.x, A.y + CY, backZ(A, 0.9)], [B.x, B.y + CY, backZ(B, 0.9)], 0.42), BLACK);
      add(beam([A.x, A.y + CY, backZ(A, 3.1)], [B.x, B.y + CY, backZ(B, 3.1)], 0.34), BLACK);
    }
    add(beam([A.x, A.y + CY, backZ(A, 0.7)], [A.x, A.y + CY, backZ(A, 3.2)], 0.34), BLACK);
  }
  // The central spine carrying the instruments, wider than the wings folded off it.
  for (const sx of [-1, 1]) {
    add(beam([sx * 3.3, CY - 8.6, ZP - 3.6], [sx * 3.3, CY + 8.6, ZP - 3.6], 0.9), BLACK);
    add(beam([sx * 3.3, CY - 8.6, ZP - 1.2], [sx * 3.3, CY + 8.6, ZP - 1.2], 0.6), BLACK);
  }
  for (let i = 0; i < 6; i++) {
    const y = CY - 8.6 + (i * 17.2) / 5;
    add(beam([-3.3, y, ZP - 3.6], [3.3, y, ZP - 3.6], 0.7), BLACK);
    if (i < 5) {
      const y2 = CY - 8.6 + ((i + 1) * 17.2) / 5;
      add(beam([i % 2 ? -3.3 : 3.3, y, ZP - 3.6], [i % 2 ? 3.3 : -3.3, y2, ZP - 3.6], 0.42), CARBON);
    }
  }

  // The fixed baffle standing up through the hole in the middle, with the tertiary hidden inside it.
  const baffle = turned([
    [0, -0.3], [2.1, -0.3], [2.1, 0.6], [1.62, 1.1], [1.28, 2.3], [1.04, 3.5], [1.12, 3.75], [0.86, 3.75], [0.68, 3.2], [0, 3.2],
  ], 24, { crease: 32 });
  baffle.rotateX(Math.PI / 2);
  baffle.translate(0, CY, ZP - 0.1);
  add(baffle, 0x17181c);

  // --- The secondary, on its three long struts ---
  const Zs = ZP + SECONDARY;
  const sm = turned([[0, -0.45], [1.1, -0.45], [1.22, -0.28], [1.22, 0], [0.8, 0.09], [0, 0.14]], 28, { crease: 40 });
  // Authored along +Y with its mirror on top, then aimed back at the primary.
  sm.rotateX(-Math.PI / 2);
  sm.translate(0, CY, Zs);
  gold.push(polished(sm, 0xf0b32c, 1.0));
  const hub = turned([[0, 0], [1.3, 0], [1.34, 0.12], [1.34, 0.5], [0.8, 0.8], [0, 0.86]], 20, { crease: 35 });
  hub.rotateX(Math.PI / 2);
  hub.translate(0, CY, Zs + 0.25);
  add(hub, BLACK);
  // One strut comes down from above the mirror and two come up from below its wings, which is what
  // gives Webb's star pictures their short horizontal spike.
  const roots = [[0, F * 2.56], [R * 3.92, -F * 1.5], [-R * 3.92, -F * 1.5]];
  roots.forEach(([x, y], i) => {
    const foot = [x, y + CY, ZP + (x * x + y * y) / (2 * WEBB.RC) - 0.9];
    const head = [x * 0.1, y * 0.1 + CY, Zs + 0.5];
    add(rod(foot, head, [0.27, 0.2], 10, 1), GREY);
    // A knuckle where it meets the backplane, and a second at the hub.
    const k = turned([[0, -0.42], [0.34, -0.42], [0.46, -0.2], [0.46, 0.2], [0.34, 0.42], [0, 0.42]], 12, { crease: 40 });
    k.applyMatrix4(new THREE.Matrix4().makeRotationZ(i ? 0.7 * Math.sign(x) : 0));
    k.translate(foot[0], foot[1], foot[2]);
    add(k, BLACK);
    // A stub strut carrying the foot back onto the lattice.
    const inner = x === 0 ? [0, F * 1.9 + CY, ZP - 2.2] : [Math.sign(x) * R * 3, -F + CY, ZP - 1.8];
    add(rod(foot, inner, 0.2, 8, 1), BLACK);
  });

  // --- The instrument box behind the mirror, its radiators silver ---
  add(block(-3.2, CY - 5.7, ZP - 9.4, 3.2, CY + 1.2, ZP - 4.2), BLACK);
  add(block(-2.9, CY - 5.3, ZP - 9.7, 2.9, CY + 0.8, ZP - 9.3), GREY);
  for (let i = 0; i < 8; i++) add(block(-2.7, CY - 5.05 + i * 0.76, ZP - 9.92, 2.7, CY - 4.68 + i * 0.76, ZP - 9.6), SILVER);
  // The side panels of foil on it.
  for (const s of [-1, 1]) gold.push(polished(block(s * 3.16, CY - 5.1, ZP - 8.9, s * 3.36, CY + 0.7, ZP - 4.8), FOIL_GOLD, 0.8));

  // --- The tower: telescoping, between the cold side and the warm ---
  const TZ = ZP - 6.5;
  const towerTop = CY - 5.6;
  const tower = turned([[0, 0], [1.75, 0], [1.75, 0.5], [1.3, 0.7], [1.3, towerTop - S0 - 3.8], [1.05, towerTop - S0 - 3.6], [1.05, towerTop - S0], [0, towerTop - S0]], 20, { crease: 35 });
  tower.translate(0, S0, TZ);
  add(tower, GREY);
  for (const k of [0.34, 0.6]) {
    const collar = turned([[0, -0.18], [1.48, -0.18], [1.48, 0.18], [0, 0.18]], 20, { crease: 35 });
    collar.translate(0, mix(S0, towerTop, k), TZ);
    add(collar, BLACK);
  }
  // Four slim stays that carry the load off the tower's foot.
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    add(rod([dx * 1.1, towerTop - 1, TZ + dz * 1.1], [dx * 3.6, S0 + 2.6, TZ + dz * 3.6], 0.13, 6, 1), GREY);
  }

  // --- The core through the shield, and the bus on the warm side ---
  add(block(-4.4, S0 - 4.8, TZ - 4.4, 4.4, S0 + 2.8, TZ + 4.4), BLACK);
  const BUS_T = S0 - 4.8; const BUS_B = S0 - 10.2;
  add(block(-5.2, BUS_B, TZ - 5.2, 5.2, BUS_T, TZ + 5.2), 0x2d2f35);
  // Gold foil on the bus's faces, standing proud of it, and a pale radiator on each flank.
  for (const s of [-1, 1]) {
    gold.push(polished(block(-4.5, BUS_B + 0.6, TZ + s * 5.18 - 0.08, 4.5, BUS_T - 0.7, TZ + s * 5.18 + 0.1), FOIL_GOLD, 0.82));
    add(block(s * 5.15, BUS_B + 0.8, TZ - 4, s * 5.32, BUS_T - 0.8, TZ + 4), SILVER);
    for (let i = 0; i < 6; i++) add(block(s * 5.3, BUS_B + 1.05 + i * 0.84, TZ - 3.7, s * 5.42, BUS_B + 1.3 + i * 0.84, TZ + 3.7), GREY);
  }
  // Star trackers: two little hooded cones on the bus's forward top edge.
  for (const s of [-1, 1]) {
    const star = turned([[0, 0], [0.55, 0], [0.55, 0.4], [0.95, 1.6], [0.82, 1.6], [0.42, 0.7], [0, 0.7]], 14, { crease: 40 });
    stood(star, [s * 2.2, BUS_B + 1.3, TZ + 5.2], [s * 0.2, -0.5, 1]);
    add(star, SILVER);
  }

  // The solar array: flat and rigid, off the bus's aft edge, its cells on the underside facing the Sun.
  {
    const x0 = -10.5; const x1 = 10.5;
    const y0 = BUS_B + 0.3; const z0 = TZ - 5.1; const z1 = TZ - 13;
    const dy = -1.2;
    const P = (i, j, lift) => [mix(x0, x1, i), y0 + dy * j + lift, mix(z0, z1, j)];
    const panel = gridSolid(1, 1, (i, j) => P(i, j, 0), (i, j) => P(i, j, -0.28), {
      uvTop: () => [0.992, 0.996],
      uvBottom: (i, j) => [mix(WEBB_CELLS_UV[0], WEBB_CELLS_UV[2], i), mix(WEBB_CELLS_UV[1], WEBB_CELLS_UV[3], j)],
    });
    print.push({ geometry: panel, color: 0xffffff });
    add(block(x0 - 0.15, y0 - 0.34, z0 - 0.1, x1 + 0.15, y0 + 0.14, z0 + 0.5), GREY);
    add(beam([x0, y0 + 0.12, z0], [x0, y0 + dy + 0.12, z1], 0.22), GREY);
    add(beam([x1, y0 + 0.12, z0], [x1, y0 + dy + 0.12, z1], 0.22), GREY);
    add(beam([0, y0 + 0.12, z0], [0, y0 + dy + 0.12, z1], 0.22), GREY);
    add(beam([x0, y0 + dy + 0.12, z1], [x1, y0 + dy + 0.12, z1], 0.22), GREY);
  }
  // The high-gain antenna, on a short arm under the bus's forward edge. Its dish opens forward and down.
  {
    const at = [3.4, BUS_B - 3.1, TZ + 4.8];
    add(rod([2.8, BUS_B + 0.2, TZ + 3.6], at, 0.2, 8, 1), GREY);
    const dish = turned([[0, -0.35], [0.55, -0.32], [1.2, -0.05], [1.9, 0.55], [1.86, 0.62], [1.1, 0.14], [0.5, -0.1], [0, -0.16]], 28, { crease: 45 });
    stood(dish, at, [0.25, -0.5, 1]);
    struct.push(polished(dish, 0xd8dadd, 0.95));
  }

  // --- The sunshield: five separate layers, each a real solid, fanning apart toward the edge ---
  const halfDepth = (x, k) => {
    const X = Math.abs(x) / (L * k);
    const CORNER = 0.215; // the flat fore and aft ends
    if (X <= CORNER) return D * k * (1 - 0.018 * (1 - (X / CORNER) ** 2));
    const t = (X - CORNER) / (1 - CORNER);
    // A membrane under tension is a catenary, so its long edges bow in.
    return Math.max(0.05, D * k * ((1 - t) - 0.075 * Math.sin(Math.PI * t)));
  };
  const LAYERS = [0xbd90c2, 0xd0a2c4, 0xdcb9cd, 0xd8ced9, 0xdfe2e9];
  const NU = 46; const NV = 16;
  for (let layer = 0; layer < 5; layer++) {
    // The cold layers are a little smaller, so from above each one's rim is seen inside the next.
    const k = 1 - (layer - 0) * 0.02;
    const xAt = (i) => {
      const u = (i / NU) * 2 - 1;
      return L * k * (Math.sign(u) * (1 - (1 - Math.abs(u)) ** 1.12));
    };
    const zAt = (i, j) => {
      const x = xAt(i);
      // Asymmetric, as the real thing is: the aft end runs a little shorter than the fore.
      const d = halfDepth(x, k);
      return ((j / NV) * 2 - 1) * d;
    };
    const yAt = (i, j) => {
      const x = xAt(i); const z = zAt(i, j);
      const rad = Math.max(Math.abs(x) / L, Math.abs(z) / D);
      const spread = 1 + 1.15 * rad ** 1.4;
      // Long soft tension ripples, running out from the corners.
      const ripple = 0.1 * Math.sin(z * 0.62 + x * 0.09 + layer * 1.4) * rad + 0.05 * Math.sin(x * 0.5 - z * 0.3 + layer);
      return S0 + (layer - 2) * spread + ripple;
    };
    const THICK = 0.13;
    const uvOf = (i, j) => [xAt(i) / 16, zAt(i, j) / 16];
    const geometry = gridSolid(NU, NV,
      (i, j) => [xAt(i), yAt(i, j) + THICK / 2, zAt(i, j)],
      (i, j) => [xAt(i), yAt(i, j) - THICK / 2, zAt(i, j)],
      { uvTop: uvOf, uvBottom: uvOf, crease: 35 });
    const base = lin(LAYERS[layer]);
    const white = lin(0xfbfbff);
    const rimC = lin(layer < 2 ? 0x8f4f9e : layer < 4 ? 0xb06a9f : 0x8d8fa0);
    const nrm = geometry.attributes.normal;
    tintVertices(geometry, (x, y, z, out, i) => {
      if (Math.abs(nrm.getY(i)) < 0.55) { out[0] = rimC[0]; out[1] = rimC[1]; out[2] = rimC[2]; return; }
      // A soft travelling sheen, the only thing that says "mirror film" rather than "paint".
      const sheen = 0.5 + 0.5 * Math.sin(x * 0.22 + z * 0.14 + layer * 2.1);
      const streak = Math.exp(-((((x * 0.46 - z * 0.88 + layer * 5) % 26) / 3.2) ** 2));
      const lightness = 0.8 + 0.2 * sheen;
      for (let c = 0; c < 3; c++) out[c] = clamp01(mix(base[c] * lightness, white[c], streak * 0.5));
    });
    foil.push({ geometry, keepColor: true });
  }

  // Booms out to the two tips and pallets to the fore and aft ends; spreader bars tie the layers.
  const under = S0 - 2 * 1.05 - 0.5;
  for (const s of [-1, 1]) {
    add(rod([s * 4.6, under, TZ * 0.6], [s * L * 0.985, S0 - 5.2, 0], [0.3, 0.17], 8, 1), GREY);
    add(rod([s * L * 0.985, S0 - 5.6, 0], [s * L * 0.92, S0 + 5.2, 0], 0.11, 6, 1), SILVER);
    // The fore and aft pallets.
    add(beam([s * 3.2, under, TZ + s * 3.8], [s * 3, S0 - 4.1, s * D * 0.98], 0.56), CARBON);
    add(beam([-s * 3.2, under, TZ + s * 3.8], [-s * 3, S0 - 4.1, s * D * 0.98], 0.56), CARBON);
    add(beam([-L * 0.205, S0 - 4.5, s * D * 0.985], [L * 0.205, S0 - 4.5, s * D * 0.985], 0.4), CARBON);
    add(beam([-3, S0 - 4.4, s * D * 0.9], [3, S0 - 4.4, s * D * 0.9], 0.4), CARBON);
    for (const c of [-1, 1]) {
      add(rod([c * L * 0.205, S0 - 4.8, s * D * 0.985], [c * L * 0.19, S0 + 4.7, s * D * 0.93], 0.11, 6, 1), SILVER);
    }
  }
  // The momentum trim tab, on the aft end.
  add(beam([0, S0 - 4.2, -D * 0.98], [0, S0 - 4, -D - 1.1], 0.3), GREY);
  add(block(-3.8, S0 - 4.15, -D - 4.5, 3.8, S0 - 3.95, -D - 1), 0x34363d);

  // --- The tall slim display mount ---
  const mast = lathe([
    [0, 0], [8, 0], [8, 0.42], [7.5, 0.72], [3.2, 1.05], [1.6, 1.6], [1.05, 2.8], [0.86, 5], [0.86, BUS_B - 3], [1.2, BUS_B - 2], [2.4, BUS_B - 0.7], [3, BUS_B + 0.1], [0, BUS_B + 0.1],
  ], 40);
  struct.push({ geometry: mast, color: 0x2b2e36 });
  // The mast stands on the shield's centre, so a short arm carries it across to the bus.
  add(beam([0, BUS_B - 0.4, 0], [0, BUS_B - 0.4, TZ], 2.4, 1.5), 0x2b2e36);
  // A name plate at the foot of the mount, tilted up at the reader.
  const nameplate = printedPlate(11, 1.9, 0.2, WEBB_PLATE_UV);
  nameplate.applyMatrix4(new THREE.Matrix4().compose(V(0, 1.65, 6.2), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.62, 0, 0)), V(1, 1, 1)));
  print.push({ geometry: nameplate, color: 0xffffff });

  const group = new THREE.Group();
  group.add(mesh(mergeParts(gold), standard({ vertexColors: true, metalness: 0.45, roughness: 0.26 })));
  group.add(mesh(mergeParts(struct), standard({ vertexColors: true, metalness: 0.15, roughness: 0.6 })));
  const crinkle = canvasTexture(512, 512, paintWebbFoil);
  const crinkleBump = dataTexture(new THREE.CanvasTexture(crinkle.image));
  group.add(mesh(mergeParts(foil), standard({
    vertexColors: true, metalness: 0.12, roughness: 0.34,
    // A membrane's underside only ever sees the bounce, and a big flat face in shade is a black slab.
    emissive: 0x2e2734, emissiveIntensity: 1,
    map: wrapRepeat(crinkle), bumpMap: wrapRepeat(crinkleBump), bumpScale: 0.9,
  })));
  group.add(mesh(mergeParts(print), standard({ map: canvasTexture(1024, 512, paintWebbPlate), roughness: 0.5, metalness: 0.05 })));
  return group;
}

// ===========================================================================================
// THE LIMESTONE CAVE
// ===========================================================================================
//
// There is no CSG, so the hollow is built VOID FIRST. The chamber is one surface facing inward, its
// front ring is the hole in the cut face, and that face is triangulated round the ring: walls, face
// and flanks close into one solid. Ceiling and floor are height functions, which is the point: every
// stalactite asks the ceiling where it is, every stalagmite asks the floor, and nothing can float.

const CAVE = {
  XL: -7, XR: 5.7, XS: 7, // the block's left edge, its right flank, and the far side of the stream
  ZF: 4, ZB: -4,
  BASE: 0.3,
  CX: -0.8,
  ZBACK: -3.15, // the back of the chamber, leaving a wall of rock behind it
  WATER: 0.66,
  POOL: { x: 0.55, z: 1.15, rx: 2.25, rz: 1.45 },
};

const caveN = (x, y, z) => smoothNoise3(x, y, z) * 2 - 1;
const CAVE_STREAM = [[3.95, 0.25], [3.45, 0.42], [3.0, 0.66], [2.55, 0.92]];

function caveTop(x, z) {
  const hump = 1.25 * Math.exp(-(((x + 1.6) / 4.2) ** 2));
  const fall = 1.9 * sstep(x, 2.2, CAVE.XR);
  const n = 0.2 * caveN(x * 0.42 + 3, 1.7, z * 0.42) + 0.08 * caveN(x * 1.1, 4.2, z * 1.1 + 2);
  return 7.9 + hump - fall + n + 0.1 * (z / 4);
}

const caveT = (z) => clamp01((CAVE.ZF - z) / (CAVE.ZF - CAVE.ZBACK));
// Exactly zero at the very back, or the last ring leaves a slit that shows the sky.
const caveW = (t) => (t >= 1 ? 0 : 4.95 * Math.sqrt(Math.max(0.00002, 1 - t ** 2.7)));
const caveCeil = (t) => 6.25 + 0.5 * Math.sin(Math.min(1, t * 1.25) * Math.PI) - 1.1 * sstep(t, 0.55, 1);
const caveFloor = (t) => 0.78 + 0.12 * t + 0.5 * sstep(t, 0.8, 1);
const caveMid = (t) => mix(caveFloor(t), caveCeil(t), 0.42);

function caveDip(x, z) {
  const { POOL } = CAVE;
  const e = Math.hypot((x - POOL.x) / POOL.rx, (z - POOL.z) / POOL.rz)
    + 0.13 * Math.sin(Math.atan2(z - POOL.z, x - POOL.x) * 3 + 0.8);
  let d = 0.44 * (1 - sstep(e, 0.45, 1));
  // The stream's channel, from the low passage on the right wall into the pool.
  let best = 1e9;
  for (let i = 0; i < CAVE_STREAM.length - 1; i++) {
    const [ax, az] = CAVE_STREAM[i]; const [bx, bz] = CAVE_STREAM[i + 1];
    const tx = bx - ax; const tz = bz - az;
    const k = clamp01(((x - ax) * tx + (z - az) * tz) / (tx * tx + tz * tz));
    best = Math.min(best, Math.hypot(x - ax - tx * k, z - az - tz * k));
  }
  d = Math.max(d, 0.3 * Math.exp(-((best / 0.34) ** 2)));
  return d;
}

// Both functions take world x and z and are what the mesh itself is built from.
function caveCeilingAt(x, z) {
  const t = caveT(z);
  const W = caveW(t);
  const mid = caveMid(t);
  const c = W > 0 ? Math.min(1, Math.abs(x - CAVE.CX) / W) ** (1 / 0.86) : 0;
  const s = Math.sqrt(Math.max(0, 1 - c * c));
  const hu = caveCeil(t) - mid;
  return mid + hu * s ** 0.8 + (0.42 * caveN(x * 0.62, 1.2, z * 0.62) + 0.14 * caveN(x * 1.7, 3.1, z * 1.7)) * s;
}
function caveFloorAt(x, z) {
  const t = caveT(z);
  const W = caveW(t);
  const mid = caveMid(t);
  const c = W > 0 ? Math.min(1, Math.abs(x - CAVE.CX) / W) ** (1 / 0.72) : 0;
  const s = Math.sqrt(Math.max(0, 1 - c * c));
  const hd = mid - caveFloor(t);
  return mid - hd * s ** 0.34 + (0.06 * caveN(x * 0.8, 7.2, z * 0.8) + 0.03 * caveN(x * 2.2, 8.1, z * 2.2)) * s - caveDip(x, z) * s;
}

// A point round the chamber's section at depth t. u = 0 is the +x wall, running over the roof.
function cavePoint(t, u) {
  const W = caveW(t);
  const a = u * TAU;
  const ca = Math.cos(a); const sa = Math.sin(a);
  const up = sa >= 0;
  const zz = mix(CAVE.ZF, CAVE.ZBACK, t);
  const X = CAVE.CX + Math.sign(ca) * Math.abs(ca) ** (up ? 0.86 : 0.72) * W;
  const y = up ? caveCeilingAt(X, zz) : caveFloorAt(X, zz);
  // The walls wander, so the hole's edge is not a clean oval.
  const wob = 1 + 0.045 * Math.sin(y * 2.3 + 0.7 + zz * 0.6) * Math.abs(ca) + 0.028 * Math.sin(y * 5.1 + zz) * Math.abs(ca);
  return [CAVE.CX + (X - CAVE.CX) * wob, y, zz];
}

const CAVE_ATLAS = { W: 1024, H: 1024, SPLIT: 0.375, YMAX: 9.6 };
const CAVE_PERIM = (CAVE.ZF - CAVE.ZB) * 2 + (CAVE.XR - CAVE.XL);
// Region A is the cut face. Region B is the three outer flanks, unrolled.
const caveUvA = (x, y) => [(x - CAVE.XL) / (CAVE.XR - CAVE.XL), CAVE_ATLAS.SPLIT + (1 - CAVE_ATLAS.SPLIT) * clamp01((y - CAVE.BASE) / (CAVE_ATLAS.YMAX - CAVE.BASE))];
const caveUvB = (s, y) => [s / CAVE_PERIM, CAVE_ATLAS.SPLIT * 0.995 * clamp01((y - CAVE.BASE) / (CAVE_ATLAS.YMAX - CAVE.BASE))];
// The clean corner of region A, mirrored into itself for the floor.
const CAVE_PATCH = { X0: 3.05, Y0: 8.15 };
function caveUvFloor(x, z) {
  const mirror = (v, a, b) => { const L = b - a; let q = (v - a) / L; q = ((q % 2) + 2) % 2; return a + (q > 1 ? 2 - q : q) * L; };
  return caveUvA(mirror(x * 0.8, CAVE_PATCH.X0 + 0.05, CAVE.XR - 0.05), mirror(z * 0.8, CAVE_PATCH.Y0 + 0.05, CAVE_ATLAS.YMAX - 0.05));
}
function cavePerimPoint(s) {
  const D = CAVE.ZF - CAVE.ZB; const W = CAVE.XR - CAVE.XL;
  if (s < D) return [CAVE.XL, CAVE.ZF - s];
  if (s < D + W) return [CAVE.XL + (s - D), CAVE.ZB];
  return [CAVE.XR, CAVE.ZB + (s - D - W)];
}

function paintCaveRock(ctx, w, h) {
  const SPLIT_ROW = Math.round(h * (1 - CAVE_ATLAS.SPLIT));
  // The beds: an order of magnitude apart in thickness, because an even alternation is a beach umbrella.
  const rng = seededRandom(3350);
  const CREAM = [[222, 211, 184], [205, 193, 164], [232, 224, 203], [196, 186, 160], [214, 206, 186], [186, 174, 146]];
  const SHALE = [[126, 116, 98], [108, 100, 88], [142, 128, 104]];
  const RES = 96; // per foot
  const bedOf = new Int16Array(12 * RES);
  const beds = [];
  let y = 0;
  while (y < 12) {
    const thin = rng() < 0.34;
    const th = thin ? 0.06 + rng() * 0.14 : 0.28 + rng() * rng() * 1.05;
    const pale = !thin || rng() < 0.25;
    const list = pale ? CREAM : SHALE;
    beds.push({ c: list[Math.floor(rng() * list.length)], y0: y, y1: y + th, pale });
    for (let r = Math.floor(y * RES); r < Math.min(12 * RES, (y + th) * RES); r++) bedOf[r] = beds.length - 1;
    y += th;
  }
  const noiseA = latticeNoise(3351); const noiseB = latticeNoise(3352); const noiseC = latticeNoise(3353);
  const warp = (s) => 0.1 * Math.sin(s * 0.31 + 0.6) + 0.05 * Math.sin(s * 0.83 + 2) + 0.016 * s;
  const paintRock = (s, Y, soilDepth) => {
    const q = Y + warp(s) + 1.2;
    const row = Math.max(0, Math.min(12 * RES - 1, Math.floor(q * RES)));
    const bed = beds[bedOf[row]];
    const edge = Math.min(q - bed.y0, bed.y1 - q);
    // Long in the bed and short across it, because sediment settles in sheets.
    const n1 = noiseA(s * 0.7, q * 3.2);
    const n2 = noiseB(s * 3.6, q * 13);
    const n3 = noiseC(s * 19, q * 31);
    let k = 0.8 + 0.2 * n1 + 0.15 * n2 + 0.12 * n3;
    // The bedding plane itself: a crisp dark line, and it weathers back into a little shadow.
    k *= mix(0.62, 1, sstep(edge, 0.006, 0.035)) * mix(0.9, 1, sstep(edge, 0.03, 0.1));
    let r = bed.c[0] * k; let g = bed.c[1] * k; let b = bed.c[2] * k;
    if (soilDepth < 0.62) {
      // Soil over the rock, with a dark humus at the top. Its lower edge is broken.
      const brk = soilDepth + (noiseB(s * 3.1, 2.2) - 0.5) * 0.3 + (n3 - 0.5) * 0.08;
      const t = 1 - sstep(brk, 0.3, 0.42);
      const humus = 1 - sstep(soilDepth, 0.05, 0.22);
      const sr = mix(112, 58, humus) * (0.8 + 0.4 * n2); const sg = mix(84, 42, humus) * (0.8 + 0.4 * n2); const sb = mix(58, 28, humus) * (0.8 + 0.4 * n2);
      r = mix(r, sr, t); g = mix(g, sg, t); b = mix(b, sb, t);
    }
    return [r, g, b];
  };
  // Region A, the cut face.
  paintTexels(ctx, 0, 0, w, SPLIT_ROW, (ix, iy, out) => {
    const u = (ix + 0.5) / w;
    const v = 1 - (iy + 0.5) / SPLIT_ROW;
    const x = mix(CAVE.XL, CAVE.XR, u);
    const Y = mix(CAVE.BASE, CAVE_ATLAS.YMAX, v);
    if (x > CAVE_PATCH.X0 && Y > CAVE_PATCH.Y0) {
      // A corner no rock ever samples, above the hill's falling shoulder, keeps the cave floor's
      // own colour: wet clay and flowstone, with no bedding in it.
      const a = noiseA(x * 2.2, Y * 3.1); const b = noiseB(x * 8, Y * 9); const c2 = noiseC(x * 30, Y * 33);
      const k = 0.62 + 0.42 * a + 0.3 * b + 0.2 * c2;
      out[0] = 160 * k; out[1] = 144 * k; out[2] = 120 * k;
      return;
    }
    const c = paintRock(x, Y, caveTop(x, CAVE.ZF) - Y);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  });
  // Region B, the flanks.
  paintTexels(ctx, 0, SPLIT_ROW, w, h - SPLIT_ROW, (ix, iy, out) => {
    const u = (ix + 0.5) / w;
    const v = 1 - (iy + 0.5) / (h - SPLIT_ROW);
    const s = u * CAVE_PERIM;
    const Y = mix(CAVE.BASE, CAVE_ATLAS.YMAX, v);
    const [x, z] = cavePerimPoint(s);
    const c = paintRock(s + 3, Y, caveTop(x, z) - Y);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  });
  // Vertical joints, offset bed by bed, down which the water came. Drawn on top, in the rock's own shadow.
  const jr = seededRandom(3360);
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = jr() * w;
    const y0 = jr() * SPLIT_ROW * 0.6 + SPLIT_ROW * 0.22;
    const L = 40 + jr() * 200;
    ctx.strokeStyle = `rgba(62,52,40,${0.3 + jr() * 0.3})`;
    ctx.lineWidth = 1 + jr() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    let px = x;
    for (let yy = y0; yy < y0 + L; yy += 16) { px += (jr() - 0.5) * 5; ctx.lineTo(px, yy + 16); }
    ctx.stroke();
  }
  // Dark nodules of chert and pale shell fragments, because limestone is made of old sea floor.
  for (let i = 0; i < 90; i++) {
    const x = jr() * w; const yy = jr() * SPLIT_ROW;
    if (x > w * 0.75 && yy < SPLIT_ROW * 0.18) continue;
    ctx.fillStyle = jr() < 0.5 ? 'rgba(70,64,56,0.55)' : 'rgba(244,238,220,0.7)';
    ctx.beginPath();
    ctx.ellipse(x, yy, 1.5 + jr() * 5, 1 + jr() * 2, 0, 0, TAU);
    ctx.fill();
  }
}

function paintCaveWater(ctx, w, h, reflect) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0b1f24');
  grad.addColorStop(0.6, '#123239');
  grad.addColorStop(1, '#1d4a50');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // What a still pool is: the ceiling, upside down. Every stalactite over it is painted where it
  // would be seen, running toward the viewer from the spot under its tip. Soft, three passes wide.
  const { POOL } = CAVE;
  const X0 = POOL.x - POOL.rx * 1.25; const X1 = POOL.x + POOL.rx * 1.25;
  const Z0 = POOL.z - POOL.rz * 1.25; const Z1 = POOL.z + POOL.rz * 1.25;
  for (const f of reflect) {
    const px = ((f.x - X0) / (X1 - X0)) * w;
    const py = ((f.z - Z0) / (Z1 - Z0)) * h;
    const len = 40 + f.len * 95;
    for (const [hw, alpha] of [[2.4, 0.09], [1.5, 0.12], [0.7, 0.2]]) {
      const half = (2 + f.r * 34) * hw;
      const g = ctx.createLinearGradient(px, py, px, py + len);
      g.addColorStop(0, `rgba(205,190,155,${alpha})`);
      g.addColorStop(1, 'rgba(205,190,155,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(px - half, py);
      ctx.lineTo(px + half, py);
      ctx.lineTo(px + half * 0.2, py + len);
      ctx.lineTo(px - half * 0.2, py + len);
      ctx.closePath();
      ctx.fill();
    }
  }
  // The bottom tenth of the sheet is running water for the streams: brighter, and combed along its flow.
  const sr = seededRandom(1212);
  ctx.fillStyle = '#2a6d76';
  ctx.fillRect(0, h * 0.9, w, h * 0.1);
  for (let i = 0; i < 90; i++) {
    const v = sr();
    ctx.fillStyle = v > 0.5 ? `rgba(190,232,232,${0.1 + sr() * 0.35})` : `rgba(14,60,70,${0.2 + sr() * 0.3})`;
    ctx.fillRect(sr() * w, h * 0.9 + sr() * h * 0.1, 18 + sr() * 70, 1 + sr() * 2.2);
  }
  // Two faint rings where a drip has just landed.
  ctx.strokeStyle = 'rgba(190,220,220,0.2)';
  ctx.lineWidth = 2;
  for (const [cx, cy, r] of [[w * 0.42, h * 0.5, 22], [w * 0.42, h * 0.5, 38], [w * 0.62, h * 0.62, 18]]) {
    ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.8, 0, 0, TAU); ctx.stroke();
  }
}

// A drip formation: a closed, soft, lumpy taper from `a` (buried in the rock) to `b` (the free tip).
// The section is never a circle, and the length carries slow bulges, because calcite is laid down in
// runs. `profile(t)` is the radius from root to tip.
function dripSolid(a, b, profile, seed, { sides = 10, rows = 9, lump = 0.12, wander = 0.05, tipRound = 2 } = {}) {
  const rng = seededRandom(seed);
  const ph1 = rng() * TAU; const ph2 = rng() * TAU; const ph3 = rng() * TAU; const ph4 = rng() * TAU;
  const A = V(...a); const B = V(...b);
  const T = B.clone().sub(A);
  const L = T.length(); T.normalize();
  const N = Math.abs(T.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0);
  N.addScaledVector(T, -N.dot(T)).normalize();
  const M = V().crossVectors(T, N);
  const pos = [];
  const ring = (t, r) => {
    const wx = Math.sin(t * 3.4 + ph1) * wander * L * t;
    const wy = Math.sin(t * 2.7 + ph2) * wander * L * t;
    const c = A.clone().addScaledVector(T, t * L).addScaledVector(N, wx).addScaledVector(M, wy);
    for (let j = 0; j < sides; j++) {
      const an = (j / sides) * TAU;
      const k = 1 + lump * (Math.sin(an * 2 + ph3 + t * 3) * 0.7 + Math.sin(an * 3 + ph4 - t * 5) * 0.55);
      const rr = r * k;
      pos.push(c.x + (N.x * Math.cos(an) + M.x * Math.sin(an)) * rr, c.y + (N.y * Math.cos(an) + M.y * Math.sin(an)) * rr, c.z + (N.z * Math.cos(an) + M.z * Math.sin(an)) * rr);
    }
    return c;
  };
  ring(0, profile(0));
  for (let i = 1; i <= rows; i++) {
    const t = i / rows;
    ring(t, profile(t) * (1 + 0.1 * Math.sin(t * 8.5 + ph2) * (1 - t * 0.5)));
  }
  const rTip = profile(1);
  for (let k = 1; k <= tipRound; k++) {
    const phi = (k / (tipRound + 1)) * (Math.PI / 2);
    ring(1 + (Math.sin(phi) * rTip) / L, rTip * Math.cos(phi));
  }
  const nr = rows + 1 + tipRound;
  const idx = [];
  for (let i = 0; i < nr - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      const p = i * sides + j; const q = i * sides + j2; const r = (i + 1) * sides + j2; const s = (i + 1) * sides + j;
      idx.push(p, q, r, p, r, s);
    }
  }
  const tip = pos.length / 3;
  pos.push(B.x + T.x * rTip * 0.9 + 0, B.y + T.y * rTip * 0.9, B.z + T.z * rTip * 0.9);
  const root = pos.length / 3;
  pos.push(A.x, A.y, A.z);
  for (let j = 0; j < sides; j++) {
    const j2 = (j + 1) % sides;
    idx.push(tip, (nr - 1) * sides + j, (nr - 1) * sides + j2);
    idx.push(root, j2, j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return outward(g);
}

// Wet calcite, painted: cream with iron-stained amber runs and a bright streak where it faces the
// light. `from`..`to` is the part's own height range, so the colour runs down each one.
function calcitePaint(geometry, seed, { amber = 0.5 } = {}) {
  const nrm = geometry.attributes.normal;
  const rng = seededRandom(seed);
  const ph = rng() * TAU; const k = 0.6 + rng() * 0.5;
  const CREAM = lin(0xd9caa6); const BUFF = lin(0xbd9c68); const AMBER = lin(0x96592a); const WET = lin(0xfff6e0);
  tintVertices(geometry, (x, y, z, out, i) => {
    const nx = nrm.getX(i); const ny = nrm.getY(i); const nz = nrm.getZ(i);
    const az = Math.atan2(nx, nz);
    const run = 0.5 + 0.5 * Math.sin(az * 3 + ph + y * 1.1) * Math.sin(y * 3.1 * k + ph);
    const a = clamp01(run * 1.3 * amber);
    let r = mix(CREAM[0], BUFF[0], a * 1.4 > 1 ? 1 : a * 1.4); let g = mix(CREAM[1], BUFF[1], a * 1.4 > 1 ? 1 : a * 1.4); let b = mix(CREAM[2], BUFF[2], a * 1.4 > 1 ? 1 : a * 1.4);
    const stain = sstep(a, 0.42, 0.85);
    r = mix(r, AMBER[0], stain); g = mix(g, AMBER[1], stain); b = mix(b, AMBER[2], stain);
    // The wet highlight: it follows the normal, so it stays where a lamp at the mouth would put it.
    const h = clamp01(nx * 0.3 + ny * 0.45 + nz * 0.84);
    const spec = h ** 14 * 0.75;
    out[0] = mix(r, WET[0], spec); out[1] = mix(g, WET[1], spec); out[2] = mix(b, WET[2], spec);
  });
  return { geometry, keepColor: true };
}

function buildCave() {
  const { XL, XR, XS, ZF, ZB, BASE, CX, ZBACK, WATER, POOL } = CAVE;
  const rockParts = [];

  // --- The chamber, void first ---
  const SIDES = 104; const ROWS = 26;
  const ring0 = [];
  const mirrorInto = (q) => {
    // A wall running back keeps its bedding lines; the mirror keeps the texture on the face region.
    const a = XL + 0.1; const b = CAVE_PATCH.X0 - 0.1; const span = b - a;
    let v = (q - a) / span; v = ((v % 2) + 2) % 2; if (v > 1) v = 2 - v;
    return a + v * span;
  };
  // Roof and walls first, then the floor. Two grids, because the floor samples its own corner of the
  // atlas, and one row of triangles spanning the two would smear the whole sheet across the wall.
  for (const half of ['roof', 'floor']) {
    const n = SIDES / 2;
    const pos = []; const uv = []; const col = []; const idx = [];
    const ring = n + 1;
    for (let i = 0; i <= ROWS; i++) {
      const t = (i / ROWS) ** 0.86;
      for (let j = 0; j <= n; j++) {
        const u = half === 'roof' ? (j / n) * 0.5 : 0.5 + (j / n) * 0.5;
        const p = cavePoint(t, u >= 1 ? 0 : u);
        pos.push(p[0], p[1], p[2]);
        const depth = ZF - p[2];
        if (i === 0 && j < n) ring0.push(new THREE.Vector2(p[0], p[1]));
        if (half === 'roof') {
          const [uu, vv] = caveUvA(mirrorInto(p[0] + Math.sign(p[0] - CX) * depth * 0.55), Math.min(p[1], 7.1));
          uv.push(uu, vv);
          // Well below the lit cut face from the first inch, so the mouth reads as a hole, and going
          // down into the dark toward the back. A warm cast, as a show cave's lamps would give it.
          const dark = mix(0.54, 0.24, sstep(t, 0.02, 0.9));
          const pale = 0.05 * (0.5 + 0.5 * Math.sin(p[0] * 1.3 + p[1] * 2.4 + p[2]));
          const k = dark + pale;
          col.push(k * 1.05, k * 0.93, k * 0.78);
        } else {
          const [uu, vv] = caveUvFloor(p[0] + p[1] * 0.6, p[2] + p[1] * 0.8);
          uv.push(uu, vv);
          const dark = mix(0.42, 0.17, sstep(t, 0.0, 0.8));
          const wet = 0.05 * (0.5 + 0.5 * Math.sin(p[0] * 2.1 + p[2] * 1.4));
          // Wet beside the water, which is what makes the pool sit IN the floor.
          const shore = 1 - 0.34 * sstep(caveDip(p[0], p[2]), 0.01, 0.2);
          const k = (dark + wet) * shore;
          col.push(k * 1.02, k * 0.94, k * 0.82);
        }
      }
    }
    for (let i = 0; i < ROWS; i++) {
      for (let j = 0; j < n; j++) {
        const a = i * ring + j; const b = a + 1; const c = (i + 1) * ring + j + 1; const d = (i + 1) * ring + j;
        idx.push(a, b, c, a, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // It has to face INTO the void. Measured in the middle, where the answer is obvious.
    const mid = Math.round(n / 2) + ring * 6;
    const wrong = half === 'roof' ? g.attributes.normal.getY(mid) > 0 : g.attributes.normal.getY(mid) < 0;
    if (wrong) {
      for (let i = 0; i < idx.length; i += 3) { const v = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = v; }
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    rockParts.push({ geometry: g, keepColor: true });
  }

  // --- The cut face, triangulated round the chamber's own front ring ---
  const faceGeometry = (() => {
    const contour = [];
    contour.push(new THREE.Vector2(XL, BASE), new THREE.Vector2(XR, BASE));
    const N = 56;
    for (let i = N; i >= 0; i--) { const x = mix(XL, XR, i / N); contour.push(new THREE.Vector2(x, caveTop(x, ZF))); }
    let area = THREE.ShapeUtils.area(contour);
    if (area < 0) contour.reverse();
    const hole = ring0.slice();
    if (THREE.ShapeUtils.area(hole) > 0) hole.reverse();
    area = 0;
    const faces = THREE.ShapeUtils.triangulateShape(contour, [hole]);
    const all = [...contour, ...hole];
    const pos = []; const uv = [];
    for (const f of faces) {
      for (const k of f) { pos.push(all[k].x, all[k].y, ZF); const q = caveUvA(all[k].x, all[k].y); uv.push(q[0], q[1]); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    if (g.attributes.normal.getZ(0) < 0) {
      for (let t = 0; t < pos.length; t += 9) for (let k = 0; k < 3; k++) { const v = pos[t + 3 + k]; pos[t + 3 + k] = pos[t + 6 + k]; pos[t + 6 + k] = v; }
      for (let t = 0; t < uv.length; t += 6) for (let k = 0; k < 2; k++) { const v = uv[t + 2 + k]; uv[t + 2 + k] = uv[t + 4 + k]; uv[t + 4 + k] = v; }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
    }
    return g;
  })();
  rockParts.push({ geometry: faceGeometry, color: 0xffffff });

  // --- The three outer flanks, unrolled from one strip of the atlas ---
  {
    const pos = []; const uv = [];
    const N = 64;
    for (let i = 0; i < N; i++) {
      const s0 = (i / N) * CAVE_PERIM; const s1 = ((i + 1) / N) * CAVE_PERIM;
      const [x0, z0] = cavePerimPoint(s0); const [x1, z1] = cavePerimPoint(s1 - 1e-5);
      const t0 = caveTop(x0, z0); const t1 = caveTop(x1, z1);
      const q = (x, y, z, s) => { pos.push(x, y, z); const c = caveUvB(s, y); uv.push(c[0], c[1]); };
      q(x0, BASE, z0, s0); q(x1, BASE, z1, s1); q(x1, t1, z1, s1);
      q(x0, BASE, z0, s0); q(x1, t1, z1, s1); q(x0, t0, z0, s0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    // The strip runs round the outside of the block, front left, back, front right: checked, not assumed.
    g.computeVertexNormals();
    const nx = g.attributes.normal.getX(0);
    if (nx > 0) {
      for (let t = 0; t < pos.length; t += 9) for (let k = 0; k < 3; k++) { const v = pos[t + 3 + k]; pos[t + 3 + k] = pos[t + 6 + k]; pos[t + 6 + k] = v; }
      for (let t = 0; t < uv.length; t += 6) for (let k = 0; k < 2; k++) { const v = uv[t + 2 + k]; uv[t + 2 + k] = uv[t + 4 + k]; uv[t + 4 + k] = v; }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    }
    rockParts.push({ geometry: toCreasedNormals(g, 30 * DEG), color: 0xffffff });
  }

  // --- The formations. Each stalactite has its stalagmite under it, because that is what makes one ---
  const drip = [];
  const placedSpots = [];
  const rng = seededRandom(1818);
  const inPool = (x, z) => Math.hypot((x - POOL.x) / POOL.rx, (z - POOL.z) / POOL.rz) < 1.0;
  const clear = (x, z, gap) => placedSpots.every((p) => Math.hypot(p[0] - x, p[1] - z) > gap);
  const reflect = [];
  const stalactite = (x, z, len, r, seed) => {
    const top = caveCeilingAt(x, z);
    const g = dripSolid([x, top + 0.28, z], [x, top - len, z], (t) => mix(r * 1.5, r * 0.95, sstep(t, 0, 0.16)) * (1 - t) ** 0.72 + 0.022, seed, { sides: 10, rows: 9, wander: 0.035 });
    drip.push(calcitePaint(g, seed, { amber: 0.42 + rng() * 0.4 }));
    if (inPool(x, z)) reflect.push({ x, z, len, r });
    return top - len;
  };
  const stalagmite = (x, z, h, r, seed) => {
    const base = caveFloorAt(x, z);
    // Broad-footed and blunt: splash spreads it, so a stalagmite is never a sharp cone.
    const g = dripSolid([x, base - 0.25, z], [x, base + h, z], (t) => (r * mix(1.75, 1, sstep(t, 0, 0.2)) * (1 - t) ** 0.78 + 0.035) * (1 + 0.16 * Math.sin(t * 21 + seed)), seed, { sides: 11, rows: 13, wander: 0.04, lump: 0.17, tipRound: 2 });
    drip.push(calcitePaint(g, seed + 1, { amber: 0.35 + rng() * 0.4 }));
    return base + h;
  };
  // Columns: at least three, where a stalactite and a stalagmite have met.
  const COLUMNS = [[-3.0, 0.75, 0.36], [-1.35, -0.45, 0.5], [2.35, -0.75, 0.36], [-0.15, -2.15, 0.33], [-4.3, 2.05, 0.3]];
  let columns = 0;
  for (const [x, z, r] of COLUMNS) {
    if (Math.abs(x - CX) > caveW(caveT(z)) * 0.85) throw new Error(`limestone-cave: column at ${x}, ${z} is in the wall`);
    const top = caveCeilingAt(x, z); const base = caveFloorAt(x, z);
    const h = top - base;
    // The waist is where the two growing tips joined, a little off the middle.
    const joint = 0.42 + rng() * 0.2;
    const seed = 700 + columns * 11;
    const g = dripSolid([x, base - 0.25, z], [x, top + 0.3, z], (t) => {
      const fromMeet = Math.abs(t - joint) / Math.max(joint, 1 - joint);
      const foot = 0.6 * (1 - sstep(t, 0, 0.16)) + 0.45 * sstep(t, 0.84, 1);
      // Rings of old growth, stronger where it is thick, which is what stops it reading as a bone.
      const rings = 0.2 * (smoothNoise3(t * 9, seed * 0.13, 1.5) - 0.5) + 0.1 * (smoothNoise3(t * 26, seed * 0.17, 4.5) - 0.5);
      return r * (0.62 + 0.55 * fromMeet ** 1.1 + foot + rings);
    }, seed, { sides: 18, rows: 40, wander: 0, lump: 0.22, tipRound: 0 });
    drip.push(calcitePaint(g, seed, { amber: 0.55 }));
    placedSpots.push([x, z]);
    if (h > 1) columns += 1;
  }
  if (columns < 3) throw new Error(`limestone-cave: ${columns} columns, needs at least 3`);

  // The rest by search, not by hand: spaced apart, inside the chamber, clear of the pool for the
  // stalagmites but free to hang over it, which is what paints the reflection.
  let tries = 0; let count = 0; let pairs = 0;
  while (count < 46 && tries < 3000) {
    tries += 1;
    const z = mix(3.3, -2.2, rng() ** 0.9);
    const t = caveT(z);
    const W = caveW(t);
    const x = CX + (rng() * 2 - 1) * W * 0.74; // the wall wanders, so stay well inside it
    const big = count < 12;
    if (!clear(x, z, big ? 0.72 : 0.42)) continue;
    const ceil = caveCeilingAt(x, z); const flo = caveFloorAt(x, z);
    const room = ceil - flo;
    if (room < 1.4) continue;
    const seed = 900 + count * 7;
    const len = Math.min(room * 0.42, big ? 0.9 + rng() * 1.2 : 0.28 + rng() * 0.7);
    const r = big ? 0.12 + rng() * 0.07 : 0.05 + rng() * 0.05;
    stalactite(x, z, len, r, seed);
    placedSpots.push([x, z]);
    count += 1;
    if (!inPool(x, z) && caveDip(x, z) < 0.03 && (big || rng() < 0.45)) {
      const h = Math.min(room * 0.34, (big ? 0.55 : 0.2) + rng() * (big ? 0.9 : 0.4));
      stalagmite(x, z, h, big ? 0.17 + rng() * 0.08 : 0.08 + rng() * 0.05, seed + 3);
      pairs += 1;
    }
  }
  if (pairs < 12) throw new Error(`limestone-cave: only ${pairs} stalagmites`);

  // A flowstone curtain: one wavy, folded, closed sheet hanging from the roof, with its hem scalloped
  // and banded the way cave "bacon" is. Each band is one season's stain.
  {
    const x0 = 0.35; const x1 = 3.05;
    const NU = 72; const NV = 9;
    const lineZ = (x) => -1.55 + 0.26 * Math.sin(x * 1.1 + 0.4);
    const fold = (x) => 0.2 * Math.sin(x * 9.5) + 0.07 * Math.sin(x * 4.3 + 1) + 0.04 * Math.sin(x * 23 + 1);
    const hemY = (x) => {
      const fx = (x - x0) / (x1 - x0);
      const ceil = caveCeilingAt(x, lineZ(x));
      return Math.max(caveFloorAt(x, lineZ(x)) + 1.2, ceil - 0.8 - 2 * Math.sin(fx * Math.PI) ** 0.9 - 0.2 * Math.sin(x * 9.5 + 1.2) ** 2);
    };
    const P = (i, j, off) => {
      const x = mix(x0, x1, i / NU);
      const z0 = lineZ(x);
      const top = caveCeilingAt(x, z0) + 0.26;
      const bottom = hemY(x);
      const v = j / NV;
      const y = mix(top, bottom, v);
      const f = fold(x) * sstep(v, 0.0, 0.5);
      // Pinched to a knife-edge at the hem and thick where it meets the roof.
      const th = mix(0.09, 0.018, v);
      return [x, y, z0 + f + off * th];
    };
    const g = gridSolid(NU, NV, (i, j) => P(i, j, 1), (i, j) => P(i, j, -1), { crease: 80 });
    const nrm = g.attributes.normal;
    const CREAM = lin(0xdcc8a0); const AMBER = lin(0xb0733a); const RUST = lin(0x7a4220);
    tintVertices(g, (x, y, z, out, i) => {
      const band = 0.5 + 0.5 * Math.sin(x * 19 + 1.1 * Math.sin(y * 2));
      const b2 = 0.5 + 0.5 * Math.sin(x * 47 + y);
      const t = sstep(band, 0.55, 0.85) * 0.75;
      const u = sstep(band * b2, 0.6, 0.9) * 0.7;
      const h = clamp01(nrm.getX(i) * 0.3 + nrm.getZ(i) * 0.9) ** 10 * 0.5;
      for (let c = 0; c < 3; c++) out[c] = clamp01(mix(mix(mix(CREAM[c], AMBER[c], t), RUST[c], u), 1, h));
    });
    drip.push({ geometry: g, keepColor: true });
  }

  // Flowstone: sculpted, because it is one soft surface poured over the wall and the floor.
  {
    const FS = new Sculpt(0.12);
    const fx = -4.0; const fz = -0.75;
    const lobes = [
      [fx - 0.25, 2.75, fz - 0.4, 0.62, 0.95, 0.5], [fx + 0.1, 2.15, fz, 0.72, 0.78, 0.58], [fx + 0.4, 1.45, fz + 0.2, 0.88, 0.6, 0.72],
      [fx + 0.65, 0.95, fz + 0.32, 1.02, 0.32, 0.92], [fx - 0.65, 2.25, fz + 0.1, 0.55, 0.85, 0.5], [fx - 0.45, 1.4, fz + 0.42, 0.62, 0.6, 0.55],
      [fx + 0.95, 1.65, fz - 0.45, 0.56, 0.72, 0.46], [fx + 1.25, 0.95, fz - 0.2, 0.74, 0.3, 0.62],
    ];
    const paleF = lin(0xb8a47c);
    lobes.forEach(([x, y, z, a, b, c]) => FS.add(ellipsoidP([x, y, z], [a, b, c]), paleF, { k: 0.18 }));
    // Flutes running down the fall: a frozen cascade is grooved along the way it flowed.
    FS.map((d, x, y, z) => d + 0.038 * Math.sin((x * 1.0 + z * 0.55) * 10.5 + 0.7 * Math.sin(y * 2.2)) + 0.014 * Math.sin(y * 19));
    const flow = polygonize(FS, {
      tint: (x, y, z, nx, ny, nz, out) => {
        const wave = 0.5 + 0.5 * Math.sin((x + z * 0.55) * 10.5 + 0.7 * Math.sin(y * 2.2));
        const stain = 0.72 * (1 - wave) + 0.28 * smoothNoise3(x * 0.9, y * 0.5, z * 0.9);
        const h = clamp01(nx * 0.3 + ny * 0.45 + nz * 0.84) ** 12 * 0.5;
        out[0] = mix(mix(0.6, 0.27, stain), 1, h); out[1] = mix(mix(0.5, 0.15, stain), 0.95, h); out[2] = mix(mix(0.34, 0.06, stain), 0.85, h);
      },
      normalH: 0.5,
    });
    drip.push({ geometry: flow, keepColor: true });
  }

  // The rimstone dam along the pool's front edge, where water sheeting over has laid down a lip.
  {
    const lip = [];
    for (let a = 0.24; a <= 0.76; a += 0.04) {
      const an = a * TAU - Math.PI / 2 + Math.PI;
      const ang = an;
      const e = 1.03 - 0.13 * Math.sin(ang * 3 + 0.8) * 0.5;
      const x = POOL.x + Math.cos(ang) * POOL.rx * e;
      const z = POOL.z + Math.sin(ang) * POOL.rz * e;
      lip.push([x, caveFloorAt(x, z) + 0.02, z]);
    }
    // Tapered away to nothing at both ends, and low, so it grows out of the floor rather than lying on it.
    const radii = lip.map((_, i) => 0.012 + 0.13 * Math.sin((i / (lip.length - 1)) * Math.PI) ** 0.7);
    const g = tube(lip, radii, { sides: 8, steps: lip.length * 3, round: 0 });
    const pl = g.attributes.position;
    for (let i = 0; i < pl.count; i++) {
      const x = pl.getX(i); const z = pl.getZ(i);
      const f = caveFloorAt(x, z);
      pl.setY(i, f + (pl.getY(i) - f) * 0.62 - 0.03);
    }
    g.computeVertexNormals();
    drip.push(calcitePaint(g, 412, { amber: 0.75 }));
  }

  // --- The low passage the stream comes in by: a dark mouth standing proud of the wall, framed ---
  const passage = (at, facing, w, h, list, color) => {
    // `at` is the sill centre, `facing` a unit vector in plan. A dark plate first, then a rough arch
    // of rock round it, which is what makes a dark plate read as a hole.
    const side = V(facing[1], 0, -facing[0]);
    const f = V(facing[0], 0, facing[1]);
    const P = (s, y, off) => [at[0] + side.x * s + f.x * off, at[1] + y, at[2] + side.z * s + f.z * off];
    const plate = gridSolid(18, 1,
      (i, j) => {
        const s = mix(-w / 2, w / 2, i / 18);
        const top = h * Math.sqrt(Math.max(0, 1 - (s / (w / 2)) ** 2)) ** 0.8;
        return P(s, j ? top : -0.05, 0.0);
      },
      (i, j) => {
        const s = mix(-w / 2, w / 2, i / 18);
        const top = h * Math.sqrt(Math.max(0, 1 - (s / (w / 2)) ** 2)) ** 0.8;
        return P(s, j ? top : -0.05, -0.1);
      },
      { crease: 30 });
    list.push({ geometry: plate, color: 0x0d0c0b });
    const arch = [];
    for (let i = 0; i <= 18; i++) {
      const a = Math.PI * (i / 18);
      const s = Math.cos(a) * (w / 2 + 0.06);
      const y = (h + 0.04) * Math.sin(a) ** 0.8;
      arch.push(P(s, y, 0.02));
    }
    const radii = arch.map((_, i) => 0.17 + 0.05 * Math.sin(i * 1.9) + 0.03 * Math.sin(i * 4.3));
    // Rough-hewn, so the frame is broken rock and not a piped ring.
    const g = tube(arch, radii, { sides: 10, steps: 44, round: 2 });
    const pp = g.attributes.position; const nn = g.attributes.normal;
    for (let i = 0; i < pp.count; i++) {
      const k = 0.075 * caveN(pp.getX(i) * 3.3, pp.getY(i) * 3.3, pp.getZ(i) * 3.3) + 0.03 * caveN(pp.getX(i) * 8, pp.getY(i) * 8, pp.getZ(i) * 8);
      pp.setXYZ(i, pp.getX(i) + nn.getX(i) * k, pp.getY(i) + nn.getY(i) * k, pp.getZ(i) + nn.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  };
  const inletZ = CAVE_STREAM[0][1];
  const inletX = CX + caveW(caveT(inletZ)) * 0.93;
  const inlet = passage([inletX, caveFloorAt(inletX - 0.3, inletZ) + 0.02, inletZ], [-0.86, 0.5], 1.5, 0.95, drip);
  tintVertices(inlet, (x, y, z, out) => {
    const k = 0.07 + 0.12 * smoothNoise3(y * 4, z * 4, x * 4);
    out[0] = k * 1.1; out[1] = k * 0.98; out[2] = k * 0.8;
  });
  drip.push({ geometry: inlet, keepColor: true });
  const outlet = passage([XR + 0.03, 0.42, 0.75], [1, 0], 2.15, 1.75, drip);
  tintVertices(outlet, (x, y, z, out) => {
    const k = 0.26 + 0.34 * smoothNoise3(y * 4, z * 4, x * 4);
    out[0] = k * 1.08; out[1] = k; out[2] = k * 0.84;
  });
  drip.push({ geometry: outlet, keepColor: true });

  // --- Water ---
  const water = [];
  {
    const X0 = POOL.x - POOL.rx * 1.25; const X1 = POOL.x + POOL.rx * 1.25;
    const Z0 = POOL.z - POOL.rz * 1.25; const Z1 = POOL.z + POOL.rz * 1.25;
    // v runs with z, so a painted stalactite lands under its own tip.
    const pool = gridSolid(1, 1,
      (i, j) => [mix(X0, X1, i), WATER, mix(Z0, Z1, j)],
      (i, j) => [mix(X0, X1, i), WATER - 0.2, mix(Z0, Z1, j)],
      { uvTop: (i, j) => [i, 1 - j], uvBottom: () => [0.02, 0.98] });
    water.push({ geometry: pool, color: 0xffffff });
    // The stream through the chamber, from under the arch to the pool.
    const ribbon = (path, width, y) => {
      const n = path.length - 1;
      const P = (i, s, lift) => {
        const a = path[Math.max(0, i - 1)]; const b = path[Math.min(n, i + 1)];
        const tx = b[0] - a[0]; const tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1;
        const w = typeof width === 'function' ? width(i / n) : width;
        return [path[i][0] - (tz / L) * s * w, y + lift, path[i][1] + (tx / L) * s * w];
      };
      return gridSolid(n, 1, (i, j) => P(i, j * 2 - 1, 0), (i, j) => P(i, j * 2 - 1, -0.12), {
        uvTop: (i, j) => [i * 0.3, 0.012 + j * 0.076], uvBottom: () => [0.5, 0.05], crease: 50,
      });
    };
    water.push({ geometry: ribbon([[inletX + 0.05, inletZ - 0.02], ...CAVE_STREAM.slice(1), [2.2, 1.05]], (t) => mix(0.28, 0.42, t), WATER + 0.02), color: 0xffffff });
    // Outside: the stream that the hill swallows.
    water.push({ geometry: ribbon([[6.35, ZB], [6.5, -3], [6.42, -2], [6.45, -1], [6.3, -0.1], [6.0, 0.45], [5.76, 0.75]], (t) => mix(0.46, 0.6, t), 0.62), color: 0xffffff });
  }

  // --- The hill's top and the stream bank ---
  const green = [];
  {
    const NX = 72; const NZ = 40;
    const P = (i, j, y0) => {
      const x = mix(XL, XR, i / NX); const z = mix(ZB, ZF, j / NZ);
      return [x, y0 === null ? caveTop(x, z) : y0, z];
    };
    const pos = []; const col = [];
    const q = (x, y, z) => {
      pos.push(x, y, z);
      const n = smoothNoise3(x * 1.1, 2, z * 1.1); const n2 = smoothNoise3(x * 3.7, 5, z * 3.7);
      const dry = sstep(n, 0.52, 0.72) * 0.6;
      col.push(mix(0.075, 0.2, dry) * (0.72 + 0.56 * n2), mix(0.2, 0.25, dry) * (0.72 + 0.56 * n2), mix(0.03, 0.055, dry) * (0.72 + 0.5 * n2));
    };
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NZ; j++) {
        const a = P(i, j, null); const b = P(i + 1, j, null); const c = P(i + 1, j + 1, null); const d = P(i, j + 1, null);
        q(...a); q(...d); q(...c); q(...a); q(...c); q(...b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    const smooth = toCreasedNormals(g, 60 * DEG);
    green.push({ geometry: smooth, keepColor: true });
  }
  // The bank beside the stream: gravel by the water, grass above it, a real low solid.
  {
    const NX = 14; const NZ = 30;
    const bank = (x, z) => {
      const path = 6.38 + 0.1 * Math.sin(z * 1.2) - 0.6 * sstep(z, -0.6, 0.8);
      const d = Math.abs(x - path);
      const n = 0.03 * smoothNoise3(x * 2.4, 3, z * 2.4);
      const edgeRaise = 0.28 * sstep(x, 6.75, XS) + 0.12 * (1 - sstep(x, XR, 5.95));
      return BASE + 0.26 + 0.22 * sstep(d, 0.42, 0.9) + n + edgeRaise;
    };
    const g = gridSolid(NX, NZ,
      (i, j) => { const x = mix(XR, XS, i / NX); const z = mix(ZB, ZF, j / NZ); return [x, bank(x, z), z]; },
      (i, j) => { const x = mix(XR, XS, i / NX); const z = mix(ZB, ZF, j / NZ); return [x, BASE, z]; },
      { crease: 50 });
    const nrm = g.attributes.normal;
    tintVertices(g, (x, y, z, out, i) => {
      if (nrm.getY(i) < 0.3) { out[0] = 0.13; out[1] = 0.1; out[2] = 0.07; return; }
      const n = smoothNoise3(x * 6, 1, z * 6);
      const g2 = sstep(y, BASE + 0.34, BASE + 0.5);
      out[0] = mix(0.5, 0.15, g2) * (0.7 + 0.6 * n); out[1] = mix(0.44, 0.33, g2) * (0.7 + 0.6 * n); out[2] = mix(0.33, 0.07, g2) * (0.7 + 0.6 * n);
    });
    green.push({ geometry: g, keepColor: true });
  }

  // Tufts along the top and the cut edge, so the lawn has an edge against the sky.
  {
    const tr = seededRandom(1931);
    const cone = new THREE.ConeGeometry(0.05, 0.2, 3, 1, true);
    cone.translate(0, 0.15, 0);
    for (let i = 0; i < 420; i++) {
      const edge = i < 130;
      const x = edge ? mix(XL + 0.1, XR - 0.1, tr()) : mix(XL + 0.2, XR - 0.2, tr());
      const z = edge ? ZF - 0.04 - tr() * 0.22 : mix(ZB + 0.2, ZF - 0.2, tr());
      const y = caveTop(x, z) - 0.03;
      const s = 0.65 + tr() * 1.1;
      const h = 0.4 + tr() * 0.25;
      green.push({
        geometry: cone, color: new THREE.Color().setRGB(0.07 + h * 0.1, 0.18 + h * 0.2, 0.03),
        position: [x, y, z], rotation: [(tr() - 0.5) * 0.5, tr() * 6, (tr() - 0.5) * 0.5], scale: [s, s * (0.8 + tr()), s],
      });
    }
  }

  // Trees: a few, small enough to say how big the hill is, each a crown of soft overlapping puffs.
  const tree = (x, z, h, seed, tone) => {
    const tr = seededRandom(seed);
    const y0 = caveTop(x, z) - 0.1;
    const lean = [(tr() - 0.5) * 0.3, (tr() - 0.5) * 0.3];
    const fork = [x + lean[0], y0 + h * 0.5, z + lean[1]];
    green.push({ geometry: tube([[x, y0, z], [x + lean[0] * 0.4, y0 + h * 0.25, z + lean[1] * 0.4], fork], [h * 0.05, h * 0.036, h * 0.024], { sides: 8, steps: 8 }), color: 0x4f3a26 });
    const puffs = [[0, 0.72, 0, 0.32], [0.26, 0.6, 0.1, 0.25], [-0.25, 0.62, -0.05, 0.25], [0.05, 0.6, 0.26, 0.24], [-0.05, 0.62, -0.26, 0.24], [0.1, 0.84, -0.08, 0.23]];
    for (const [dx, dy, dz, r] of puffs) {
      const g = new THREE.SphereGeometry(r * h, 14, 10);
      const p = g.attributes.position;
      const cx = fork[0] + dx * h; const cy = y0 + dy * h; const cz = fork[2] + dz * h;
      for (let i = 0; i < p.count; i++) {
        const nx = p.getX(i) / (r * h); const ny = p.getY(i) / (r * h); const nz = p.getZ(i) / (r * h);
        const k = 1 + 0.2 * caveN(nx * 2 + seed, ny * 2, nz * 2) + 0.08 * caveN(nx * 5, ny * 5 + seed, nz * 5);
        p.setXYZ(i, cx + nx * r * h * k, cy + ny * r * h * k * 0.92, cz + nz * r * h * k);
      }
      g.computeVertexNormals();
      tintVertices(g, (xx, yy, zz, out) => {
        const lit = clamp01((yy - (y0 + h * 0.42)) / (h * 0.62));
        const n = smoothNoise3(xx * 4, yy * 4, zz * 4);
        const k = (0.42 + 0.74 * lit) * (0.78 + 0.5 * n);
        out[0] = tone[0] * k; out[1] = tone[1] * k; out[2] = tone[2] * k;
      });
      green.push({ geometry: g, keepColor: true });
    }
    // Branches into the crown.
    for (const [dx, dz] of [[0.2, 0.05], [-0.2, -0.06], [0.03, 0.2]]) {
      green.push({ geometry: tube([fork, [fork[0] + dx * h, y0 + h * 0.62, fork[2] + dz * h]], [h * 0.022, h * 0.012], { sides: 6, steps: 3, straight: true }), color: 0x4f3a26 });
    }
  };
  tree(-4.9, -1.7, 2.5, 11, lin(0x2f6a22));
  tree(-1.9, -2.6, 3.1, 22, lin(0x3a7524));
  tree(2.3, -1.6, 2.3, 33, lin(0x56802a));

  // Boulders of bare limestone breaking through the turf: where the rock below shows.
  {
    const br = seededRandom(405);
    for (const [x, z, r] of [[0.4, 1.6, 0.42], [-3.3, 2.5, 0.33], [3.6, 2.3, 0.36], [-5.7, 0.6, 0.3], [1.0, -2.8, 0.38], [4.6, -0.8, 0.28]]) {
      const g = new THREE.SphereGeometry(r, 14, 10);
      const p = g.attributes.position;
      const ph = br() * 9;
      const y = caveTop(x, z);
      for (let i = 0; i < p.count; i++) {
        const nx = p.getX(i) / r; const ny = p.getY(i) / r; const nz = p.getZ(i) / r;
        const k = 1 + 0.2 * caveN(nx * 1.4 + ph, ny * 1.4, nz * 1.4);
        p.setXYZ(i, x + nx * r * k * 1.3, y + ny * r * k * 0.62, z + nz * r * k);
      }
      g.computeVertexNormals();
      tintVertices(g, (xx, yy, zz, out) => {
        const k = 0.26 + 0.2 * smoothNoise3(xx * 3, yy * 7, zz * 3);
        out[0] = k * 1.02; out[1] = k * 0.96; out[2] = k * 0.82;
      });
      green.push({ geometry: g, keepColor: true });
    }
  }

  // The plinth: dark, plain, and part of the same solid as the block on it.
  const plinth = block(XL - 0.12, 0, ZB - 0.12, XS + 0.12, BASE, ZF + 0.32);
  green.push({ geometry: plinth, color: 0x2d2720 });

  const group = new THREE.Group();
  const rockMap = canvasTexture(1024, 1024, paintCaveRock);
  const rockBump = dataTexture(new THREE.CanvasTexture(rockMap.image));
  const rock = mesh(mergeParts(rockParts), standard({ vertexColors: true, map: rockMap, bumpMap: rockBump, bumpScale: 1.4, roughness: 0.78, metalness: 0 }));
  // The hill would throw its own shadow over everything inside it, and a model nobody can see into
  // teaches nothing. The chamber takes the light as a show cave's lamps would give it.
  rock.receiveShadow = false;
  group.add(rock);
  const dripMesh = mesh(mergeParts(drip), standard({ vertexColors: true, roughness: 0.36, metalness: 0 }));
  dripMesh.receiveShadow = false;
  group.add(dripMesh);
  group.add(mesh(mergeParts(green), standard({ vertexColors: true, roughness: 0.9, metalness: 0 })));
  const waterMesh = mesh(mergeParts(water), standard({
    map: canvasTexture(512, 512, (ctx, w, h) => paintCaveWater(ctx, w, h, reflect)), roughness: 0.08, metalness: 0.25,
  }));
  waterMesh.castShadow = false;
  waterMesh.receiveShadow = false;
  group.add(waterMesh);
  return group;
}

// ===========================================================================================
// THE SPACE SHUTTLE ORBITER
// ===========================================================================================
//
// True size, shown at about 1/5 by the catalogue, nose on +Z. `s` is distance back from the nose, `h`
// is height above the belly. The hull is ONE closed solid: its section changes shape along s, and for
// the sixty feet of the payload bay its upper half IS the inside of the bay. The two bulkheads are the
// rows of quads where the section jumps from crown to bay, so there is no gap to close.

const SH = { BELLY: 5.4, SILL: 10.6, RB: 7.7, XS: 8.9, W: 9.2, Z0: 61, BAY0: 39, BAY1: 99, END: 116, EQ: 5 };
const shZ = (s) => SH.Z0 - s;

// Cubic Hermite through a table of [s, v].
function shTable(table, s) {
  const n = table.length;
  if (s <= table[0][0]) return table[0][1];
  if (s >= table[n - 1][0]) return table[n - 1][1];
  let i = 0;
  while (s > table[i + 1][0]) i++;
  const [x0, y0] = table[i]; const [x1, y1] = table[i + 1];
  const h = x1 - x0;
  const m0 = i > 0 ? (y1 - table[i - 1][1]) / (x1 - table[i - 1][0]) : (y1 - y0) / h;
  const m1 = i < n - 2 ? (table[i + 2][1] - y0) / (table[i + 2][0] - x0) : (y1 - y0) / h;
  const t = (s - x0) / h;
  const t2 = t * t; const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1;
}
const SH_TOP = [[0, 5.3], [1.5, 6.4], [4, 7.7], [10, 9.5], [16, 11.1], [20, 13.2], [25, 16.9], [30, 18.6], [36, 19.2], [39, 19.2], [99, 19.2], [108, 18.9], [116, 17.4]];
function shW(s) {
  if (s <= 36) { const x = s / 36; return SH.W * Math.max(0, 1 - (1 - x) ** 2.5) ** 0.7; }
  return SH.W + 1.5 * sstep(s, 94, 110);
}
const shTop = (s) => shTable(SH_TOP, s);
const shBot = (s) => 5.2 * (1 - Math.min(s / 40, 1)) ** 2.7 + 1.1 * sstep(s, 108, 116);
const shEq = (s) => mix(shBot(s) + (shTop(s) - shBot(s)) * 0.42, SH.EQ, sstep(s, 13, 30));
const shUpP = (s) => mix(0.92, 0.62, sstep(s, 6, 30));

// The outer skin at s, upper half: v = 0 is the +x equator, 0.5 the crown, 1 the -x equator.
function shCrown(s, v) {
  const a = v * Math.PI;
  const c = Math.cos(a); const sn = Math.sin(a);
  const p = shUpP(s);
  return [Math.sign(c) * Math.abs(c) ** p * shW(s), shEq(s) + (shTop(s) - shEq(s)) * sn ** p];
}
function shBay(s, v) {
  const w = shW(s);
  const { XS, RB, SILL, EQ } = SH;
  if (v < 0.06) { const k = v / 0.06; return [mix(w, XS, k), mix(EQ, SILL, k)]; }
  if (v < 0.1) { const k = (v - 0.06) / 0.04; return [mix(XS, RB, k), SILL]; }
  if (v <= 0.9) { const a = ((v - 0.1) / 0.8) * Math.PI; return [Math.cos(a) * RB, SILL - Math.sin(a) * RB]; }
  if (v <= 0.94) { const k = (v - 0.9) / 0.04; return [-mix(RB, XS, k), SILL]; }
  const k = (v - 0.94) / 0.06;
  return [-mix(XS, w, k), mix(SILL, EQ, k)];
}
// The lower half: u = 0 at the -x equator round the belly to 1 at the +x equator.
function shKeel(s, u) {
  const a = Math.PI + u * Math.PI;
  const c = Math.cos(a); const sn = Math.sin(a);
  const w = shW(s);
  const eq = shEq(s); const b = shBot(s);
  const pX = 0.52; const pY = mix(0.8, 0.46, sstep(s, 2, 26));
  return [Math.sign(c) * Math.abs(c) ** pX * w, eq - (eq - b) * Math.abs(sn) ** pY];
}

// Which outer panels are the black high-temperature tiles.
function shIsBlack(s, x, h) {
  if (s < 12.5) return true;
  const chine = (s < 40 ? mix(5.2, 1.55, sstep(s, 10, 40)) : 1.55) + shBot(s) * 0.4;
  if (h < chine) return true;
  // The mask round the forward windows and over the nose.
  if (s < 27.2 && h > mix(8.2, 15.2, clamp01((s - 12) / 15))) return true;
  return false;
}

function paintShuttleTiles(ctx, w, h) {
  const rng = seededRandom(1981);
  ctx.fillStyle = '#979797';
  ctx.fillRect(0, 0, w, h);
  const N = 16;
  const c = w / N;
  for (let r = 0; r < N; r++) {
    for (let k = 0; k < N; k++) {
      const v = Math.round(232 + rng() * 23);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(k * c + 1, r * c + 1, c - 2, c - 2);
    }
  }
}

function paintShuttlePrint(ctx, w, h) {
  // Top half: the stand's plate. Then the two markings, in ordinary letters on the hull's own white.
  ctx.fillStyle = '#16233c';
  ctx.fillRect(0, 0, w, h / 2);
  ctx.strokeStyle = '#c9b070';
  ctx.lineWidth = 8;
  ctx.strokeRect(12, 12, w - 24, h / 2 - 24);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f7ecd0';
  fitFont(ctx, 'SPACE SHUTTLE ORBITER', w - 90, 76, '800');
  ctx.fillText('SPACE SHUTTLE ORBITER', w / 2, h * 0.17);
  ctx.fillStyle = '#d7deea';
  fitFont(ctx, 'About 122 feet long. Shown at about 1/5 of life size', w - 90, 38, '600');
  ctx.fillText('About 122 feet long. Shown at about 1/5 of life size', w / 2, h * 0.35);
  ctx.fillStyle = '#d6d6cf';
  ctx.fillRect(0, h / 2, w, h / 2);
  ctx.fillStyle = '#16181c';
  fitFont(ctx, 'ORBITER', w - 40, 92, '800');
  ctx.fillText('ORBITER', w / 2, h * 0.625);
  fitFont(ctx, 'USA', w - 40, 110, '800');
  ctx.fillText('USA', w / 2, h * 0.875);
}
const SH_PLATE_UV = [0, 0.5, 1, 1];
const SH_NAME_UV = [0.14, 0.25, 0.86, 0.5];
const SH_USA_UV = [0.3, 0, 0.7, 0.25];

// Colour per quad, so a boundary is crisp and stair-stepped along the tiles instead of smeared. Every
// grid here emits its quads as consecutive pairs of triangles, and soup() keeps that order.
function faceTint(g, fn) {
  const p = g.attributes.position; const nrm = g.attributes.normal;
  const arr = new Float32Array(p.count * 3);
  const out = [1, 1, 1];
  const QUAD = 6;
  for (let t = 0; t < p.count; t += QUAD) {
    let cx = 0; let cy = 0; let cz = 0; let nx = 0; let ny = 0; let nz = 0;
    const end = Math.min(p.count, t + QUAD);
    for (let k = t; k < end; k++) {
      cx += p.getX(k); cy += p.getY(k); cz += p.getZ(k);
      nx += nrm.getX(k); ny += nrm.getY(k); nz += nrm.getZ(k);
    }
    const m = end - t;
    const L = Math.hypot(nx, ny, nz) || 1;
    fn(cx / m, cy / m, cz / m, nx / L, ny / L, nz / L, out, t / QUAD);
    for (let k = t; k < end; k++) { arr[k * 3] = out[0]; arr[k * 3 + 1] = out[1]; arr[k * 3 + 2] = out[2]; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return { geometry: g, keepColor: true };
}

function shuttleHull() {
  const { BAY0, BAY1, END, BELLY } = SH;
  const NU = 56; const NL = 30;
  const stations = [0.02, 0.1, 0.3, 0.7, 1.3, 2, 3, 4.5, 6, 8, 10, 12, 14, 16, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 32, 34, 36, 37.5, BAY0 - 0.001];
  const bayRows = [];
  for (let s = BAY0; s <= BAY1 + 0.001; s += 5) bayRows.push(s);
  stations.push(...bayRows);
  stations.push(BAY1 + 0.001, 100.5, 103, 105, 107, 109, 111, 113, 114.5, END);
  const isBay = (s) => s >= BAY0 && s <= BAY1;
  const rows = stations.map((s) => {
    const pts = [];
    for (let j = 0; j <= NU; j++) {
      const v = j / NU;
      pts.push(isBay(s) ? shBay(s, v) : shCrown(s, v));
    }
    for (let j = 1; j < NL; j++) pts.push(shKeel(s, j / NL));
    return { s, pts };
  });
  const M = NU + NL;
  const pos = []; const uv = []; const kind = [];
  // Arc length round the row, for the tile grid.
  const arcs = rows.map((row) => {
    const a = [0];
    for (let j = 1; j <= M; j++) {
      const p = row.pts[(j - 1) % M]; const q = row.pts[j % M];
      a.push(a[j - 1] + Math.hypot(q[0] - p[0], q[1] - p[1]));
    }
    return a;
  });
  const vert = (r, j) => {
    const row = rows[r];
    const q = row.pts[j % M];
    pos.push(q[0], q[1] + BELLY, shZ(row.s));
    uv.push(row.s / 8, arcs[r][j] / 8);
  };
  for (let r = 0; r < rows.length - 1; r++) {
    for (let j = 0; j < M; j++) {
      vert(r, j); vert(r, j + 1); vert(r + 1, j + 1);
      vert(r, j); vert(r + 1, j + 1); vert(r + 1, j);
    }
  }
  // Close the aft end and the nose tip with fans.
  const fan = (r, flip) => {
    const row = rows[r];
    const eq = shEq(row.s);
    for (let j = 0; j < M; j++) {
      const a = row.pts[j]; const b = row.pts[(j + 1) % M];
      const z = shZ(row.s);
      const A = [a[0], a[1] + BELLY, z]; const B = [b[0], b[1] + BELLY, z]; const C = [0, eq + BELLY, z];
      for (const q of flip ? [C, B, A] : [C, A, B]) { pos.push(q[0], q[1], q[2]); uv.push(0.031, 0.031); }
    }
  };
  fan(rows.length - 1, true);
  fan(0, false);
  const g = soup(pos, uv, 42);
  const WHITE = lin(0xdfdfd8); const BLACK = lin(0x2a2a2e); const CAP = lin(0x4e4e50); const LINER = lin(0xd2d0c4); const BULK = lin(0xa9abae); const FLOOR = lin(0x9b9d9e);
  const set = (out, c) => { out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; };
  return faceTint(g, (x, y, z, nx, ny, nz, out) => {
    const s = SH.Z0 - z; const h = y - BELLY;
    if (s >= BAY0 && s <= BAY1) {
      const rad = Math.hypot(x, h - SH.SILL);
      if (rad < SH.RB + 0.25 && h < SH.SILL + 0.01) { set(out, h < SH.SILL - 6.7 ? FLOOR : LINER); return; }
      if (h > SH.SILL - 0.05 && Math.abs(x) < SH.XS + 0.1) { set(out, BULK); return; }
    }
    if (Math.abs(nz) > 0.86 && (Math.abs(s - BAY0) < 0.05 || Math.abs(s - BAY1) < 0.05)) { set(out, BULK); return; }
    if (s > END - 0.01) { set(out, lin(0x1c1c1f)); return; }
    if (s < 5) { set(out, CAP); return; }
    set(out, shIsBlack(s, x, h) ? BLACK : WHITE);
  });
}

// The wing's plan: double delta, at 78 degrees then 45 degrees, with its trailing edge running a little forward.
const shLE = (x) => (x <= 19 ? mix(38, 86, (x - 9) / 10) : mix(86, 106, (x - 19) / 20));
const shTE = (x) => mix(120, 116, (x - 9) / 30);
const shWingLow = (x) => 0.12 + (x - 8.5) * 0.058;
const shWingT = (x) => mix(4.6, 0.85, clamp01((x - 8.5) / 30.5));
const shWingF = (c) => 1.55 * c ** 0.46 * (1 - c) ** 0.6;
const shWingTop = (x, c) => shWingLow(x) + Math.max(0.09, shWingT(x) * shWingF(c));
const shWingBot = (x, c) => shWingLow(x) - 0.13 * shWingT(x) * shWingF(c);

// Rows run at fixed distances from the leading edge and the elevon hinge, so the carbon strip and the
// hinge line are real rows of the mesh and come out straight.
const SH_RCC = 2.4;
const shHinge = (C) => C - Math.min(11.5, C * 0.66);
function shWingRow(x, j) {
  const C = shTE(x) - shLE(x);
  const H = shHinge(C);
  const front = [0, 0.08, 0.28, 0.7, 1.4, SH_RCC];
  if (j < front.length) return front[j];
  const J1 = front.length - 1;
  if (j <= J1 + 8) return mix(SH_RCC, H, (j - J1) / 8);
  if (j === J1 + 9) return H + 0.42;
  return mix(H + 0.42, C, (j - J1 - 9) / 3);
}
function shuttleWing(side) {
  const xs = [8.5, 10, 12, 14, 16, 17.5, 19, 21, 23, 23.75, 24.25, 25, 27, 29, 31, 33, 35, 36.5, 38, 39];
  const NI = xs.length - 1; const NJ = 17;
  const cOf = (x, j) => shWingRow(x, j) / (shTE(x) - shLE(x));
  const P = (i, j, top) => {
    const x = xs[i]; const c = cOf(x, j);
    const s = shLE(x) + shWingRow(x, j);
    return [side * x, (top ? shWingTop(x, c) : shWingBot(x, c)) + SH.BELLY, shZ(s)];
  };
  const uvOf = (i, j) => { const x = xs[i]; return [x / 8, (shLE(x) + shWingRow(x, j)) / 8]; };
  const g = gridSolid(NI, NJ, (i, j) => P(i, j, true), (i, j) => P(i, j, false), { uvTop: uvOf, uvBottom: uvOf, crease: 38 });
  const WHITE = lin(0xdfdfd8); const BLACK = lin(0x2a2a2e); const RCC = lin(0x4a4a4d); const LINE = lin(0x37373a);
  const set = (out, c) => { out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; };
  return faceTint(g, (x, y, z, nx, ny, nz, out) => {
    const X = Math.abs(x); const s = SH.Z0 - z;
    const d = s - shLE(X);
    const C = shTE(X) - shLE(X);
    if (ny < -0.2) { set(out, d < 0.3 ? RCC : BLACK); return; }
    // Leading edge: the reinforced carbon panels, grey, wrapping over the top.
    if (d < SH_RCC) { set(out, RCC); return; }
    // The elevons: two to a side, with a dark line round each.
    const H = shHinge(C);
    if (X > 11 && d > H && d < H + 0.42) { set(out, LINE); return; }
    if (d > H + 0.42 && X > 23.75 && X < 24.25) { set(out, LINE); return; }
    set(out, WHITE);
  });
}

function shuttleFin() {
  const H0 = 18.4 + SH.BELLY; const H1 = 45.6 + SH.BELLY;
  const TS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.515, 0.53, 0.6, 0.7, 0.8, 0.9, 1];
  const CS = [0, 0.012, 0.035, 0.07, 0.1, 0.2, 0.35, 0.5, 0.6, 0.615, 0.635, 0.75, 0.9, 1];
  const NI = TS.length - 1; const NJ = CS.length - 1;
  const P = (i, j, sign) => {
    const t = TS[i]; const c = CS[j];
    const y = mix(H0, H1, t);
    const le = mix(87, 115, t); const te = mix(117, 122.5, t);
    const s = mix(le, te, c);
    const th = mix(1.25, 0.34, t) * 1.5 * c ** 0.42 * (1 - c) ** 0.65 + 0.03;
    return [sign * th, y, shZ(s)];
  };
  const uvOf = (i, j) => [mix(mix(87, 115, TS[i]), mix(117, 122.5, TS[i]), CS[j]) / 8, mix(H0, H1, TS[i]) / 8];
  const g = gridSolid(NI, NJ, (i, j) => P(i, j, 1), (i, j) => P(i, j, -1), { uvTop: uvOf, uvBottom: uvOf, crease: 50 });
  const WHITE = lin(0xdfdfd8); const RCC = lin(0x3c3c3f); const LINE = lin(0x303032);
  const set = (out, c) => { out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; };
  return faceTint(g, (x, y, z, nx, ny, nz, out) => {
    const t = (y - H0) / (H1 - H0); const s = SH.Z0 - z;
    const le = mix(87, 115, t); const te = mix(117, 122.5, t);
    const c = (s - le) / (te - le);
    if (c < 0.07) { set(out, RCC); return; }
    // The rudder that splits in two to make a speed brake.
    if (c > 0.615 && c < 0.635) { set(out, LINE); return; }
    if (c > 0.635 && t > 0.515 && t < 0.53) { set(out, LINE); return; }
    set(out, WHITE);
  });
}

// Long, low and flat-topped, sunk well into the shoulder of the hull. Too round and too proud and they
// are two footballs balanced on the fuselage.
function shuttlePod(side) {
  const a = side * 6.7; const B = SH.BELLY + 16.3;
  const st = [
    [95, 0.1, 0.05, 0.05, 0.8], [95.8, 1.4, 0.72, 0.9, 0.8], [97.5, 2.6, 1.5, 2, 0.75], [100, 3.5, 2.25, 3, 0.68], [104, 4.15, 2.85, 3.8, 0.62],
    [109, 4.5, 3.25, 4.2, 0.58], [113, 4.5, 3.3, 4.2, 0.58], [115.6, 4.3, 3.15, 4.1, 0.58], [116.2, 3.9, 2.8, 3.7, 0.6], [116.4, 0.05, 0.05, 0.05, 0.6],
  ].map(([s, w, up, dn, round]) => ({ d: shZ(s), w, up, dn, round, a, b: B }));
  const raw = outward(solidLoft(st, { sides: 40, samples: 45 }));
  const g = toCreasedNormals(raw.index ? raw.toNonIndexed() : raw, 50 * DEG);
  // Tile UVs in feet, lying along the pod.
  const uvA = g.attributes.uv; const pA = g.attributes.position;
  for (let i = 0; i < uvA.count; i++) uvA.setXY(i, (SH.Z0 - pA.getZ(i)) / 8, (pA.getY(i) + Math.abs(pA.getX(i)) * 0.8) / 8);
  const WHITE = lin(0xdfdfd8); const BLACK = lin(0x2a2a2e);
  const set = (out, c) => { out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; };
  return faceTint(g, (x, y, z, nx, ny, nz, out) => {
    const s = SH.Z0 - z;
    set(out, s > 115.3 ? BLACK : WHITE);
  });
}

function buildShuttle() {
  const { BELLY, SILL, RB, XS, BAY0, BAY1, END } = SH;
  const hull = [];
  const struct = [];
  const shiny = [];
  const print = [];
  const WHITE = 0xdcdcd5; const GREY = 0x6d7075; const DARK = 0x2c2e32; const STEEL = 0x8b9198;
  const Y = (h) => BELLY + h;
  const add = (geometry, color) => { struct.push({ geometry, color }); return geometry; };

  hull.push(shuttleHull());
  hull.push(shuttleWing(1), shuttleWing(-1));
  hull.push(shuttleFin());
  hull.push(shuttlePod(1), shuttlePod(-1));

  // --- The body flap, under the engines ---
  {
    const P = (i, j, top) => {
      const x = mix(-9.8, 9.8, i);
      const s = mix(END - 1.2, 122.4, j);
      const th = mix(1.45, 0.42, j);
      return [x, Y(1.55 + (top ? th / 2 : -th / 2)), shZ(s)];
    };
    const g = gridSolid(1, 1, (i, j) => P(i, j, true), (i, j) => P(i, j, false), {
      uvTop: (i, j) => [i * 2, j], uvBottom: (i, j) => [i * 2, j], crease: 30,
    });
    hull.push(faceTint(g, (x, y, z, nx, ny, nz, out) => {
      const c = lin(ny > 0.5 ? 0x8f8f8c : 0x2a2a2e);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    }));
  }

  // --- The three main engines, one over two, and the two OMS nozzles above them ---
  const bell = (R, L, x, h, s0, tilt = [0, 0]) => {
    const profile = [
      [0, -1.2 * (L / 10)], [R * 0.36, -1.2 * (L / 10)], [R * 0.3, 0], [R * 0.45, L * 0.2], [R * 0.66, L * 0.42], [R * 0.83, L * 0.64], [R * 0.95, L * 0.86], [R, L],
      [R * 0.95, L], [R * 0.89, L * 0.86], [R * 0.78, L * 0.64], [R * 0.6, L * 0.42], [R * 0.4, L * 0.2], [R * 0.22, L * 0.05], [0, L * 0.03],
    ];
    const g = turned(profile, 34, { crease: 30 });
    g.rotateX(-Math.PI / 2);
    if (tilt[0] || tilt[1]) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tilt[0], tilt[1], 0)));
    g.translate(x, Y(h), shZ(s0));
    const nrm = g.attributes.normal;
    const SILVER = lin(0xc2c6cc);
    const out0 = [1, 1, 1];
    tintVertices(g, (px, py, pz, out, i) => {
      const nx = nrm.getX(i); const ny = nrm.getY(i); const nz = nrm.getZ(i);
      const rx = px - x; const ry = py - Y(h);
      const outward2 = nx * rx + ny * ry;
      const along = (shZ(s0) - pz) / L;
      if (outward2 < 0) {
        // Inside the bell: burnt dark, with a glow of oxide near the throat.
        const k = mix(0.05, 0.13, along);
        out[0] = k * 1.1; out[1] = k * 0.9; out[2] = k * 0.8;
        return;
      }
      polishInto(nx, ny, nz, out0, SILVER, 1.25);
      out0[0] = Math.max(out0[0], 0.34); out0[1] = Math.max(out0[1], 0.35); out0[2] = Math.max(out0[2], 0.38);
      const tube2 = 0.9 + 0.1 * Math.sin(Math.atan2(ry, rx) * 34);
      const band = along > 0.42 && along < 0.46 ? 0.55 : 1;
      out[0] = out0[0] * tube2 * band; out[1] = out0[1] * tube2 * band; out[2] = out0[2] * tube2 * band;
    });
    shiny.push({ geometry: g, keepColor: true });
    // The dome and heat shield where it enters the base.
    const dome = turned([[0, -0.9], [R * 0.72, -0.9], [R * 0.72, -0.2], [R * 0.48, 0.5], [0, 0.9]], 22, { crease: 40 });
    dome.rotateX(-Math.PI / 2);
    dome.translate(x, Y(h), shZ(END));
    add(dome, 0x3b3c40);
  };
  bell(3.75, 10, 0, 14.4, 113.5);
  bell(3.75, 10, 4.95, 7.55, 113.5);
  bell(3.75, 10, -4.95, 7.55, 113.5);
  for (const sx of [-1, 1]) bell(1.45, 4.4, sx * 6.7, 16.2, 114.8, [0, 0]);

  // --- The bay's structure: frames round the wall, sill rails along the top ---
  const frameArc = (s, r = 0.13) => {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI;
      pts.push([Math.cos(a) * (RB - 0.02), Y(SILL) - Math.sin(a) * (RB - 0.02), shZ(s)]);
    }
    return tube(pts, r, { sides: 6, steps: 24, round: 1 });
  };
  for (let s = BAY0 + 6; s < BAY1 - 2; s += 6) add(frameArc(s), 0x9fa3a7);
  for (const sx of [-1, 1]) {
    add(block(sx * RB - 0.22, Y(SILL), shZ(BAY1), sx * RB + 0.22, Y(SILL) + 0.28, shZ(BAY0)), GREY);
    // A longeron along the wall, and the hinges that carry each door.
    for (let s = BAY0 + 3; s < BAY1; s += 8) {
      add(block(sx * XS - 0.3, Y(SILL) - 0.1, shZ(s + 0.7), sx * XS + 0.3, Y(SILL) + 0.5, shZ(s - 0.7)), STEEL);
    }
  }
  add(block(-1.6, Y(SILL - RB) - 0.02, shZ(BAY1), 1.6, Y(SILL - RB) + 0.26, shZ(BAY0)), 0x74787d);

  // The airlock tunnel from the forward bulkhead, and the laboratory module on its trunnions.
  const LAB0 = 47; const LAB1 = 71;
  const LR = 6.4; const LC = SILL - 1.3;
  {
    const tunnel = turned([[0, 0], [2.2, 0], [2.2, LAB0 - BAY0 + 0.3], [0, LAB0 - BAY0 + 0.3]], 20, { crease: 35 });
    tunnel.rotateX(-Math.PI / 2);
    tunnel.translate(0, Y(LC), shZ(BAY0));
    add(tunnel, 0xcfcfc8);
    add(turned([[0, 0], [3, 0], [3, 0.7], [0, 0.7]], 22, { crease: 35 }).rotateX(-Math.PI / 2).translate(0, Y(LC), shZ(BAY0 + 0.1)), STEEL);
    const L = LAB1 - LAB0;
    const lab = turned([
      [0, 0], [LR * 0.45, 0], [LR * 0.96, 0.9], [LR, 1.6], [LR, 6], [LR + 0.1, 6.05], [LR + 0.1, 6.5], [LR, 6.55], [LR, L * 0.5], [LR + 0.1, L * 0.5 + 0.05], [LR + 0.1, L * 0.5 + 0.5], [LR, L * 0.5 + 0.55],
      [LR, L - 6.5], [LR + 0.1, L - 6.45], [LR + 0.1, L - 6], [LR, L - 5.95], [LR, L - 1.6], [LR * 0.96, L - 0.9], [LR * 0.45, L], [0, L],
    ], 32, { crease: 30, uTiles: 4, vScale: 0.125 });
    lab.rotateX(-Math.PI / 2);
    lab.translate(0, Y(LC), shZ(LAB0));
    const nrm = lab.attributes.normal;
    tintVertices(lab, (x, y, z, out, i) => {
      const a = Math.atan2(x, y - Y(LC));
      const band = Math.abs(Math.abs(a) - 0.9) < 0.1;
      const c = lin(band ? 0x7f8d9c : 0xe4e3dc);
      const k = 0.92 + 0.08 * nrm.getY(i);
      out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
    });
    struct.push({ geometry: lab, keepColor: true });
    // The trunnions that hold it in the sills.
    for (const sx of [-1, 1]) {
      for (const s of [LAB0 + 5, LAB1 - 5]) add(beam([sx * LR * 0.86, Y(LC + 1.1), shZ(s)], [sx * (RB + 0.1), Y(SILL + 0.1), shZ(s)], 0.42), STEEL);
    }
    add(beam([0, Y(LC - LR + 0.1), shZ(LAB0 + 12)], [0, Y(SILL - RB + 0.1), shZ(LAB0 + 12)], 1.1), STEEL);
    // Its roof: a radiator, a viewport, a scuff plate.
    add(block(-2.3, Y(LC + LR - 0.1), shZ(LAB1 - 4.5), 2.3, Y(LC + LR + 0.34), shZ(LAB0 + 13.5)), 0xc4c6c9);
    for (let k = 0; k < 7; k++) add(block(-2.1, Y(LC + LR + 0.3), shZ(LAB1 - 4.7 - k * 0.8), 2.1, Y(LC + LR + 0.44), shZ(LAB1 - 5 - k * 0.8)), 0x8c9096);
    const port = turned([[0, 0], [1.05, 0], [1.05, 0.34], [0.8, 0.42], [0, 0.42]], 18, { crease: 40 });
    port.translate(0, Y(LC + LR - 0.1), shZ(LAB0 + 7.5));
    add(port, 0x25272c);
  }

  // A science satellite on its tilt table, raised to go, with the arm's hand coming down to it.
  {
    const pivot = [0, SILL - 5.2, 94.5];
    const tilt = 50 * DEG;
    const axis = V(0, Math.sin(tilt), Math.cos(tilt)); // in (x, h, -s)-ish: toward the nose and up
    const m = new THREE.Matrix4().compose(
      V(pivot[0], Y(pivot[1]), shZ(pivot[2])),
      new THREE.Quaternion().setFromUnitVectors(UP, axis),
      V(1, 1, 1),
    );
    const R = 3.7; const LEN = 15.5;
    const body = turned([[0, 0], [R, 0], [R, LEN * 0.68], [R * 0.9, LEN * 0.7], [R * 0.9, LEN * 0.76], [R * 0.72, LEN * 0.8], [R * 0.72, LEN * 0.93], [R * 0.3, LEN], [0, LEN]], 24, { crease: 25 });
    body.applyMatrix4(m);
    const foil = polished(body, 0xe6ac2c, 0.92);
    // A crumpled-foil look: the same polish, broken up facet by facet.
    const col = foil.geometry.attributes.color; const pb = foil.geometry.attributes.position;
    for (let i = 0; i < col.count; i++) {
      const k = 0.78 + 0.34 * smoothNoise3(pb.getX(i) * 0.9, pb.getY(i) * 1.1, pb.getZ(i) * 0.9);
      col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
    }
    shiny.push(foil);
    const place = (g) => { g.applyMatrix4(m); return g; };
    // Bands round the drum.
    for (const k of [0.1, 0.67]) {
      add(place(turned([[0, LEN * k - 0.1], [R + 0.06, LEN * k - 0.1], [R + 0.06, LEN * k + 0.1], [0, LEN * k + 0.1]], 24, { crease: 30 })), 0x3a3c41);
    }
    // Two folded solar panels against its flanks.
    for (const sx of [-1, 1]) {
      const panel = block(sx * (R + 0.02), LEN * 0.14, -2.3, sx * (R + 0.34), LEN * 0.64, 2.3);
      place(panel);
      shiny.push({ geometry: panel, color: 0x20448f });
      for (let k = 0; k < 4; k++) add(place(block(sx * (R + 0.3), LEN * (0.2 + k * 0.13), -2.3, sx * (R + 0.4), LEN * (0.2 + k * 0.13) + 0.09, 2.3)), 0x8a8f96);
    }
    // A dish on top, white, opening away from the drum.
    const dish = turned([[0, 0], [0.5, 0], [0.5, 0.5], [2.0, 1.15], [2.6, 1.85], [2.55, 1.95], [1.9, 1.4], [0.45, 0.85], [0, 0.8]], 26, { crease: 42 });
    dish.translate(0, LEN - 0.1, 0);
    place(dish);
    add(dish, 0xe2e2dc);
    // The tilt table's two arms and the trunnion it pivots on.
    for (const sx of [-1, 1]) {
      const foot = [sx * 3.6, Y(pivot[1]), shZ(pivot[2])];
      add(beam(foot, [sx * RB * 0.86, Y(SILL), shZ(pivot[2] + 2)], 0.5), STEEL);
      add(beam(foot, [sx * 2.1, Y(SILL - RB + 0.2), shZ(pivot[2] - 2)], 0.5), STEEL);
      const up = V(sx * 3.75, pivot[1], 0);
      const a = up.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(0, BELLY, shZ(pivot[2])));
      add(beam([a.x, a.y, a.z], [sx * (R + 0.05), Y(pivot[1]) + axis.y * 6, shZ(pivot[2]) + axis.z * 6], 0.46), DARK);
    }
    add(rod([-3.7, Y(pivot[1]), shZ(pivot[2])], [3.7, Y(pivot[1]), shZ(pivot[2])], 0.6, 12, 1), GREY);
  }

  // --- The robot arm, on the port sill, raised over the bay ---
  {
    const P = (x, h, s) => [x, Y(h), shZ(s)];
    const shoulder = P(8.5, SILL + 1.3, 46);
    const elbow = P(9.5, 27, 61);
    const wrist = P(1.6, 23.5, 82.4);
    const hand = P(0.75, 18.4, 83.5);
    const boom = (a, b, r) => add(rod(a, b, r, 14, 1), 0xe3e3dc);
    boom(shoulder, elbow, 0.62);
    boom(elbow, wrist, 0.62);
    // Dark joint housings, each a real ball the booms plug into.
    const ball = (p, r, color = DARK) => { add(new THREE.SphereGeometry(r, 16, 12).translate(p[0], p[1], p[2]), color); };
    ball(shoulder, 1.0); ball(elbow, 0.98); ball(wrist, 0.9);
    // The pedestal on the sill.
    add(turned([[0, 0], [1.25, 0], [1.25, 0.34], [0.95, 0.6], [0.8, 1.4], [0, 1.4]], 16, { crease: 40 }).translate(8.5, Y(SILL), shZ(46)), GREY);
    // Black bands, one near each end of a boom, with a pale thermal blanket between.
    const band = (a, b, t, half, r) => {
      const A = V(...a).lerp(V(...b), t - half); const B = V(...a).lerp(V(...b), t + half);
      add(rod([A.x, A.y, A.z], [B.x, B.y, B.z], r, 14, 0), 0x35373c);
    };
    for (const [a, b] of [[shoulder, elbow], [elbow, wrist]]) { band(a, b, 0.09, 0.02, 0.66); band(a, b, 0.91, 0.02, 0.66); }
    // The two television cameras, at the elbow and the wrist.
    const cam = (p, off) => {
      add(block(p[0] + off[0] - 0.3, p[1] + off[1] - 0.3, p[2] + off[2] - 0.5, p[0] + off[0] + 0.3, p[1] + off[1] + 0.3, p[2] + off[2] + 0.5), 0xcfcfc9);
      add(rod([p[0], p[1], p[2]], [p[0] + off[0], p[1] + off[1], p[2] + off[2]], 0.13, 6, 0), DARK);
    };
    cam(elbow, [-1.25, 0.4, -0.3]);
    cam(wrist, [-1.1, 0.5, 0.4]);
    // The wrist down to the end effector: a dark drum with the snare that takes hold of a satellite.
    add(rod(wrist, hand, [0.52, 0.5], 14, 0), 0x35373c);
    add(rod(hand, [hand[0] - 0.12, hand[1] - 2.3, hand[2] + 0.1], 0.72, 16, 1), 0x25272b);
  }

  // --- The doors, open, carrying their radiators on their inner faces ---
  const OPEN = 165 * DEG;
  const R0 = XS;
  const doorPoint = (side, a, s, r) => {
    const dx = r * Math.cos(a) - R0; const dy = r * Math.sin(a);
    const x = dx * Math.cos(OPEN) + dy * Math.sin(OPEN);
    const y = -dx * Math.sin(OPEN) + dy * Math.cos(OPEN);
    return [side * (R0 + x), Y(SILL) + y, shZ(s)];
  };
  for (const side of [-1, 1]) {
    const NA = 14; const NS = 12;
    const s0 = BAY0 + 0.3; const s1 = BAY1 - 0.3;
    const A = (i) => (i / NA) * (Math.PI / 2);
    const door = gridSolid(NA, NS,
      (i, j) => doorPoint(side, A(i), mix(s0, s1, j / NS), R0),
      (i, j) => doorPoint(side, A(i), mix(s0, s1, j / NS), R0 - 0.3),
      {
        uvTop: (i, j) => [mix(s0, s1, j / NS) / 8, (A(i) * R0) / 8],
        uvBottom: (i, j) => [mix(s0, s1, j / NS) / 8, (A(i) * R0) / 8],
        crease: 40,
      });
    hull.push({ geometry: door, color: 0xdfdfd8 });
    // Four radiator panels on each door, tube-striped, standing proud of its inner face.
    const PANELS = 4;
    for (let p = 0; p < PANELS; p++) {
      const sa = mix(s0 + 2, s1 - 2, p / PANELS) + 0.4; const sb = mix(s0 + 2, s1 - 2, (p + 1) / PANELS) - 0.4;
      const a0 = 0.17; const a1 = Math.PI / 2 - 0.05;
      const NP = 22;
      const g = gridSolid(NP, 2,
        (i, j) => doorPoint(side, mix(a0, a1, i / NP), mix(sa, sb, j / 2), R0 - 0.42),
        (i, j) => doorPoint(side, mix(a0, a1, i / NP), mix(sa, sb, j / 2), R0 - 0.28),
        { crease: 60 });
      // Silver, by what it would reflect, with a darker line for each coolant tube.
      const silver = lin(0xecf0f4); const tmp = [1, 1, 1];
      shiny.push(faceTint(g, (x, y, z, nx, ny, nz, out) => {
        polishInto(nx, ny, nz, tmp, silver, 1);
        const C = doorPoint(side, 0, 50, 0);
        const ang = Math.atan2(y - C[1], Math.abs(x) - Math.abs(C[0]));
        const stripe = Math.floor(((ang + 7) / (a1 - a0)) * NP * 0.5) % 2 ? 1 : 0.8;
        const lift = 0.42;
        out[0] = Math.min(1, mix(tmp[0], 1, lift)) * stripe; out[1] = Math.min(1, mix(tmp[1], 1, lift)) * stripe; out[2] = Math.min(1, mix(tmp[2], 1, lift)) * stripe;
      }));
    }
    // A hinge line of dark fittings along the sill.
    for (let s = BAY0 + 3; s < BAY1; s += 8) {
      const a = doorPoint(side, 0.06, s, R0 - 0.15);
      add(beam([side * XS, Y(SILL) + 0.2, shZ(s)], a, 0.34), 0x53565c);
    }
  }

  // --- The windows: panes lying on the hull's own surface, dark and glossy ---
  const pane = (s0, s1, v0, v1, lift = 0.06) => {
    const P = (i, j, d) => {
      const s = mix(s0, s1, j);
      const v = mix(v0, v1, i);
      const q = shCrown(s, v);
      const cx = 0; const cy = shEq(s);
      const dx = q[0] - cx; const dy = q[1] - cy; const L = Math.hypot(dx, dy) || 1;
      return [q[0] + (dx / L) * d, Y(q[1] + (dy / L) * d), shZ(s)];
    };
    const g = gridSolid(3, 3, (i, j) => P(i / 3, j / 3, lift), (i, j) => P(i / 3, j / 3, -0.4), { crease: 60 });
    return polished(g, 0x2f4356, 0.95);
  };
  // Six across the front, wrapped round the cabin, then the two overhead and a pair on each side.
  const WIN0 = 20.9; const WIN1 = 24.6;
  for (const [a, b] of [[0.455, 0.545], [0.36, 0.445], [0.555, 0.64], [0.28, 0.35], [0.65, 0.72]]) {
    shiny.push(pane(WIN0, WIN1 + (a < 0.3 || a > 0.64 ? -0.5 : 0), a, b));
  }
  shiny.push(pane(WIN0 + 0.2, WIN1 - 0.6, 0.22, 0.27));
  shiny.push(pane(WIN0 + 0.2, WIN1 - 0.6, 0.73, 0.78));
  shiny.push(pane(27.6, 30.6, 0.44, 0.49));
  shiny.push(pane(27.6, 30.6, 0.51, 0.56));
  // The two aft windows, looking back into the bay, on the forward bulkhead.
  for (const sx of [-1, 1]) {
    const g = block(sx * 1.1 - 1.05, Y(SILL + 2.2), shZ(BAY0) - 0.02, sx * 1.1 + 1.05, Y(SILL + 4.1), shZ(BAY0) + 0.3);
    shiny.push({ geometry: g, color: 0x1b2632 });
  }
  // The crew hatch, on the port side, with its little round window.
  {
    const R = 1.75;
    const h = 7.2; const s = 31;
    const hatch = turned([[0, 0], [R, 0], [R, 0.12], [R - 0.14, 0.2], [0, 0.2]], 22, { crease: 40 });
    hatch.rotateZ(-Math.PI / 2);
    hatch.translate(SH.W - 0.1, Y(h), shZ(s));
    hull.push({ geometry: hatch, color: 0xc7c7c0 });
    const port = turned([[0, 0], [0.42, 0], [0.42, 0.26], [0, 0.26]], 14, { crease: 40 });
    port.rotateZ(-Math.PI / 2);
    port.translate(SH.W + 0.0, Y(h), shZ(s));
    shiny.push({ geometry: port, color: 0x1b2632 });
  }

  // The little RCS jets on the pods: dark mouths in a row.
  const jet = (x, h, s, dir) => {
    const g = turned([[0, -0.4], [0.3, -0.4], [0.34, 0.06], [0.26, 0.06], [0.2, -0.2], [0, -0.2]], 9, { crease: 40 });
    stood(g, [x, Y(h), shZ(s)], dir);
    add(g, 0x141416);
  };
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 4; k++) jet(sx * (6.7 + 4.42), 16.8 - k * 0.8, 110 + k * 0.5, [sx, 0, 0]);
  }

  // --- Markings, in ordinary letters: a generic name and USA ---
  // The doors hide the mid-fuselage, so the flanks that can be read are the cabin's and the tail's.
  // Each plate is laid on the hull's own surface, so a widening flank cannot swallow one end of it.
  const flankX = (sz, h) => {
    const eq = shEq(sz); const p = shUpP(sz);
    const sn = clamp01((h - eq) / (shTop(sz) - eq)) ** (1 / p);
    return Math.sqrt(Math.max(0, 1 - sn * sn)) ** p * shW(sz);
  };
  const hullPlate = (sx, s0, s1, h0, h1, [u0, v0, u1, v1]) => {
    const NS = 8;
    // Letters run toward the tail on the port side and toward the nose on the starboard, so both read
    // left to right from outside.
    const P = (i, j, lift) => {
      const q = i / NS;
      const sz = sx > 0 ? mix(s0, s1, q) : mix(s1, s0, q);
      const h = mix(h0, h1, j);
      return [sx * (flankX(sz, h) + lift), Y(h), shZ(sz)];
    };
    return gridSolid(NS, 1, (i, j) => P(i, j, 0.05), (i, j) => P(i, j, -0.3), {
      uvTop: (i, j) => [mix(u0, u1, i / NS), mix(v0, v1, j)], uvBottom: () => [u0 + 0.005, v0 + 0.005], crease: 50,
    });
  };
  for (const sx of [-1, 1]) {
    print.push({ geometry: hullPlate(sx, 100.5, 113, 6.4, 8.6, SH_NAME_UV), color: 0xffffff });
    print.push({ geometry: hullPlate(sx, 33.4, 38.4, 8.4, 10.5, SH_USA_UV), color: 0xffffff });
  }
  {
    // USA on the starboard wing's top, lying on its real surface.
    const X0 = -31; const X1 = -21; const Sa = 103.5; const Sb = 110;
    const top = (x, s) => {
      const X = Math.abs(x);
      const c = (s - shLE(X)) / (shTE(X) - shLE(X));
      return shWingTop(X, clamp01(c));
    };
    const N = 6;
    const [u0, v0, u1, v1] = SH_USA_UV;
    const g = gridSolid(N, N,
      (i, j) => { const x = mix(X0, X1, i / N); const s = mix(Sa, Sb, j / N); return [x, Y(top(x, s)) + 0.05, shZ(s)]; },
      (i, j) => { const x = mix(X0, X1, i / N); const s = mix(Sa, Sb, j / N); return [x, Y(top(x, s)) - 0.2, shZ(s)]; },
      { uvTop: (i, j) => [mix(u0, u1, i / N), mix(v0, v1, j / N)], uvBottom: () => [u0 + 0.01, v0 + 0.01], crease: 50 });
    print.push({ geometry: g, color: 0xffffff });
  }

  // --- The low display cradle ---
  {
    const steel = 0x323a46; const yellow = 0x4a4c50;
    const saddle = (s, half, feet) => {
      // A cross beam on two feet, with padded saddles that really touch the belly.
      add(block(-half, 1.3, shZ(s + 1.1), half, 2.6, shZ(s - 1.1)), steel);
      for (const sx of feet) {
        add(block(sx - 1.4, 0, shZ(s + 2), sx + 1.4, 0.4, shZ(s - 2)), 0x20252c);
        add(block(sx - 0.9, 0.4, shZ(s + 1.1), sx + 0.9, 1.3, shZ(s - 1.1)), steel);
      }
    };
    saddle(26, 8, [-6.4, 6.4]);
    saddle(64, 11, [-8.8, 8.8]);
    saddle(101, 14, [-11.8, 11.8]);
    const pad = (x, s) => {
      const h = s < 40 ? shBot(s) : 0;
      add(block(x - 1.6, 2.6, shZ(s + 0.95), x + 1.6, Y(h) + 0.12, shZ(s - 0.95)), yellow);
    };
    for (const sx of [-1, 1]) { pad(sx * 2.8, 64); pad(sx * 4.5, 101); pad(sx * 2.4, 26); }
    // Two long rails tie the three together, low on the floor.
    for (const sx of [-1, 1]) {
      add(block(sx * 6.4 - 0.5, 0, shZ(103), sx * 6.4 + 0.5, 0.8, shZ(24)), steel);
    }
    const plate = printedPlate(9, 2.25, 0.3, SH_PLATE_UV);
    plate.applyMatrix4(new THREE.Matrix4().compose(V(0, 1.95, shZ(26) + 1.42), new THREE.Quaternion(), V(1, 1, 1)));
    print.push({ geometry: plate, color: 0xffffff });
  }

  const group = new THREE.Group();
  const tiles = wrapRepeat(canvasTexture(512, 512, paintShuttleTiles));
  const tilesBump = wrapRepeat(dataTexture(new THREE.CanvasTexture(tiles.image)));
  group.add(mesh(mergeParts(hull), standard({ vertexColors: true, map: tiles, bumpMap: tilesBump, bumpScale: 0.6, roughness: 0.66, metalness: 0 })));
  group.add(mesh(mergeParts(struct), standard({ vertexColors: true, roughness: 0.58, metalness: 0.12 })));
  group.add(mesh(mergeParts(shiny), standard({ vertexColors: true, roughness: 0.24, metalness: 0.42 })));
  group.add(mesh(mergeParts(print), standard({ map: canvasTexture(1024, 512, paintShuttlePrint), roughness: 0.62, metalness: 0 })));
  return group;
}

// ===========================================================================================
// THE ELECTRIC MOTOR
// ===========================================================================================
//
// A two-pole motor with its side cut away, the shaft running along X and the cut facing +Z. The polarity
// is worked out rather than decorated. The top brush is wired to the battery's plus terminal; it bears
// on the segment on the rotor's +b side; that segment feeds the coils in the sense that makes the
// front of the rotor a north pole. A north pole is drawn down toward the S magnet, so the front of the
// rotor moves down: counterclockwise as seen from the wheel end, which is what the arrows say.

const EM = {
  Y: 1.74, Z: -0.3, // the shaft
  THETA: 62 * DEG, // the rotor's angle, measured from +Z toward +Y. Turned so the winding faces the cut.
  CASE_R0: 1.12, CASE_R1: 1.27,
  MAG_R0: 0.72,
  ROTOR_R: 0.68,
  X_CASE: 1.05, X_MAG: 0.85, X_CORE: 0.65,
  COMM_X: -1.52, COMM_R: 0.27,
};
// The point at radius r and angle phi about the shaft, at x.
const emAt = (r, phi, x) => [x, EM.Y + r * Math.sin(phi), EM.Z + r * Math.cos(phi)];

// A closed curved slab about the shaft. Its outer face carries uvOuter(i, j) and its inner uvInner.
function emShell(r0, r1, a0, a1, x0, x1, { na = 24, nx = 1, uvOuter = null, uvInner = null } = {}) {
  const A = (i) => mix(a0, a1, i / na);
  const X = (j) => mix(x0, x1, j / nx);
  return gridSolid(na, nx,
    (i, j) => emAt(r1, A(i), X(j)),
    (i, j) => emAt(r0, A(i), X(j)),
    { uvTop: uvOuter ?? (() => [0, 0]), uvBottom: uvInner ?? uvOuter ?? (() => [0, 0]), crease: 35 });
}

// A plate from any simple outline, extruded along its local Z, with its caps triangulated properly: the
// armature's outline is not star-shaped, and a fan from the centre would fill the winding slots.
function extrudeAny(outline, depth) {
  const pts = outline.map(([x, y]) => new THREE.Vector2(x, y));
  if (THREE.ShapeUtils.area(pts) < 0) pts.reverse();
  const faces = THREE.ShapeUtils.triangulateShape(pts, []);
  const pos = []; const uv = [];
  const z0 = -depth / 2; const z1 = depth / 2;
  const v = (p, z) => { pos.push(p.x, p.y, z); uv.push(0, 0); };
  for (const [a, b, c] of faces) {
    v(pts[a], z1); v(pts[b], z1); v(pts[c], z1);
    v(pts[c], z0); v(pts[b], z0); v(pts[a], z0);
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    v(a, z0); v(b, z0); v(b, z1);
    v(a, z0); v(b, z1); v(a, z1);
  }
  return soup(pos, uv, 35);
}

// One lamination of the double-T armature, in (a, b): a along the arms.
function emRotorOutline(inset = 0) {
  const R = EM.ROTOR_R - inset; const RI = 0.56 + inset; const HALF = 0.15 - inset;
  const SPAN = 42 * DEG;
  const pts = [];
  const N = 10;
  for (const s of [1, -1]) {
    for (let i = 0; i <= N; i++) {
      const a = -SPAN + (i / N) * 2 * SPAN;
      pts.push([s * R * Math.cos(a), s * R * Math.sin(a)]);
    }
    // Round under the shoe to the arm, and down the arm's side.
    for (let i = 0; i <= 4; i++) {
      const a = SPAN + (i / 4) * (Math.asin(HALF / RI) - SPAN);
      pts.push([s * RI * Math.cos(a), s * RI * Math.sin(a)]);
    }
    pts.push([s * 0, s * HALF]);
    for (let i = 0; i <= 0; i++) pts.push([-s * RI * Math.cos(Math.asin(HALF / RI)), s * HALF]);
    for (let i = 0; i <= 4; i++) {
      const a = Math.asin(HALF / RI) + (i / 4) * (SPAN - Math.asin(HALF / RI));
      pts.push([-s * RI * Math.cos(a), s * RI * Math.sin(a)]);
    }
  }
  return pts;
}

function paintMotorBase(ctx, w, h) {
  const rng = seededRandom(1821);
  ctx.fillStyle = '#6d4426';
  ctx.fillRect(0, 0, w, h);
  // Walnut: long streaks, a few darker runs, slow waves through them.
  for (let i = 0; i < 520; i++) {
    const y0 = rng() * h; const a = 5 + rng() * 14; const f = 0.004 + rng() * 0.01; const ph = rng() * 6;
    const dark = rng() < 0.62;
    ctx.strokeStyle = dark ? `rgba(40,20,8,${0.08 + rng() * 0.22})` : `rgba(176,122,74,${0.06 + rng() * 0.16})`;
    ctx.lineWidth = 0.6 + rng() * 2.4;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 32) { const y = y0 + Math.sin(x * f + ph) * a; if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
  }
  // A printed strip along the front edge, like a laboratory's own label.
  const INK = '#f3e6c6';
  ctx.fillStyle = 'rgba(20,12,6,0.74)';
  ctx.fillRect(14, h - 86, w - 28, 72);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  const X = (x) => ((x + 3.1) / 6.2) * w;
  for (const [text, x] of [['COMMUTATOR AND BRUSHES', -1.3], ['ARMATURE COIL', -0.12], ['FIELD MAGNETS', 1.04]]) {
    fitFont(ctx, text, 180, 26, '700');
    ctx.fillText(text, X(x), h - 50);
  }
  // The rotation arrow, on the base by the wheel, with what it is seen from.
  const cx = X(2.36); const cy = h * 0.53; const R = 62;
  ctx.fillStyle = 'rgba(20,12,6,0.74)';
  ctx.fillRect(cx - 104, cy - 96, 208, 205);
  ctx.strokeStyle = '#ffd25a';
  ctx.lineWidth = 15;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  // Counterclockwise on the page, from the lower right round the top.
  ctx.arc(cx, cy - 10, R, 0.35, -Math.PI * 1.25, true);
  ctx.stroke();
  const ang = -Math.PI * 1.25;
  const hx = cx + Math.cos(ang) * R; const hy = cy - 10 + Math.sin(ang) * R;
  ctx.fillStyle = '#ffd25a';
  ctx.save();
  ctx.translate(hx, hy);
  // Tangent for travel in the counterclockwise sense.
  ctx.rotate(ang - Math.PI / 2);
  ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(-14, -21); ctx.lineTo(-14, 21); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#c9ccd2';
  ctx.beginPath(); ctx.arc(cx, cy - 10, 20, 0, TAU); ctx.fill();
  ctx.fillStyle = INK;
  fitFont(ctx, 'TURNS THIS WAY', 190, 25, '800');
  ctx.fillText('TURNS THIS WAY', cx, cy + 72);
  fitFont(ctx, 'seen from the wheel end', 190, 20, '600');
  ctx.fillText('seen from the wheel end', cx, cy + 94);
}

const EM_ATLAS = { RED: [0, 0.75, 0.5, 1], BLUE: [0, 0.5, 0.5, 0.75], REDL: [0, 0.375, 0.5, 0.5], BLUEL: [0, 0.25, 0.5, 0.375], LABEL: [0.5, 0, 1, 1], WHEEL: [0, 0, 0.125, 0.25] };
function paintMotorAtlas(ctx, w, h) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const band = (y0, y1, col, letter, n) => {
    ctx.fillStyle = col;
    ctx.fillRect(0, y0, w / 2, y1 - y0);
    ctx.fillStyle = '#fbfbf6';
    ctx.font = `900 ${Math.round((y1 - y0) * 0.72)}px ${FONT}`;
    for (let i = 0; i < n; i++) ctx.fillText(letter, ((i + 0.5) / n) * (w / 2), (y0 + y1) / 2 + 3);
  };
  band(0, h * 0.25, '#c91f1f', 'N', 3);
  band(h * 0.25, h * 0.5, '#1d4fb8', 'S', 3);
  band(h * 0.5, h * 0.625, '#c91f1f', 'N', 5);
  band(h * 0.625, h * 0.75, '#1d4fb8', 'S', 5);
  // The wheel's face: the same arrow, this time seen from the end it is true of.
  ctx.fillStyle = '#b98f3e';
  ctx.fillRect(0, h * 0.75, w * 0.125, h * 0.25);
  const cx = w * 0.0625; const cy = h * 0.875; const R = h * 0.082;
  ctx.strokeStyle = '#201408';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0.35, -Math.PI * 1.25, true);
  ctx.stroke();
  const ang = -Math.PI * 1.25;
  ctx.fillStyle = '#201408';
  ctx.save();
  ctx.translate(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
  ctx.rotate(ang - Math.PI / 2);
  ctx.beginPath(); ctx.moveTo(19, 0); ctx.lineTo(-9, -14); ctx.lineTo(-9, 14); ctx.closePath(); ctx.fill();
  ctx.restore();
  // The battery's wrapper, a plain made-up maker's label.
  const X0 = w / 2;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#d7342a');
  grad.addColorStop(0.48, '#d7342a');
  grad.addColorStop(0.5, '#f4efe0');
  grad.addColorStop(1, '#f4efe0');
  ctx.fillStyle = grad;
  ctx.fillRect(X0, 0, w / 2, h);
  ctx.fillStyle = '#fff7e4';
  fitFont(ctx, 'DRY CELL', w / 2 - 50, 62, '900');
  ctx.fillText('DRY CELL', X0 + w / 4, h * 0.14);
  fitFont(ctx, 'BATTERY', w / 2 - 50, 62, '900');
  ctx.fillText('BATTERY', X0 + w / 4, h * 0.3);
  ctx.fillStyle = '#16233c';
  fitFont(ctx, '6 VOLT', w / 2 - 60, 74, '900');
  ctx.fillText('6 VOLT', X0 + w / 4, h * 0.66);
  fitFont(ctx, '+ red      - black', w / 2 - 50, 36, '700');
  ctx.fillText('+ red      - black', X0 + w / 4, h * 0.84);
}

function buildMotor() {
  const { Y, Z, THETA, CASE_R0, CASE_R1, MAG_R0, X_CASE, X_MAG, X_CORE, COMM_X, COMM_R } = EM;
  const iron = [];
  const metal = [];
  const printed = [];
  const wood = [];
  const add = (geometry, color) => { iron.push({ geometry, color }); return geometry; };
  const COPPER = 0xe8813a; const BRASS = 0xd9ab45; const STEEL = 0xc9ced4;
  const shine = (g, color, lift = 1) => metal.push(polished(g, color, lift));
  const axisX = (g, x) => { g.rotateZ(-Math.PI / 2); g.translate(x, Y, Z); return g; };

  // --- The base ---
  {
    const X0 = -3.1; const X1 = 3.1; const Z0 = -1.45; const Z1 = 1.45;
    const g = gridSolid(1, 1,
      (i, j) => [mix(X0, X1, i), 0.3, mix(Z1, Z0, j)],
      (i, j) => [mix(X0, X1, i), 0, mix(Z1, Z0, j)],
      { uvTop: (i, j) => [i, j], uvBottom: (i, j) => [i, j] });
    wood.push({ geometry: g, color: 0xffffff });
  }

  // --- The case: the back and the floor of a cylinder, with its cut edges left bright ---
  const A0 = 98 * DEG; const A1 = 300 * DEG;
  {
    const shell = emShell(CASE_R0, CASE_R1, A0, A1, -X_CASE, X_CASE, { na: 40 });
    const BLUE = lin(0x2b5f76); const INNER = lin(0x4d5a60); const CUT = lin(0x9fa6ac);
    const nrm = shell.attributes.normal;
    tintVertices(shell, (x, y, z, out, i) => {
      const ry = y - Y; const rz = z - Z; const r = Math.hypot(ry, rz);
      const radial = (nrm.getY(i) * ry + nrm.getZ(i) * rz) / r;
      let c = BLUE;
      if (Math.abs(radial) < 0.5) c = CUT;
      else if (radial < 0) c = INNER;
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    iron.push({ geometry: shell, keepColor: true });
    // Ribs on the outside, and two flanges at the ends, both lying on the same arc.
    for (let k = -3; k <= 3; k++) {
      const x = k * 0.29;
      add(emShell(CASE_R1 - 0.01, CASE_R1 + 0.05, A0 + 0.02, A1 - 0.02, x - 0.035, x + 0.035, { na: 36 }), 0x24505f);
    }
    for (const sx of [-1, 1]) {
      add(emShell(CASE_R1 - 0.01, CASE_R1 + 0.09, A0 + 0.02, A1 - 0.02, sx * X_CASE - 0.06, sx * X_CASE + 0.02 * sx + 0.04, { na: 36 }), 0x24505f);
    }
    // Feet: cast into the underside of the shell and bolted down to the board.
    for (const sx of [-1, 1]) {
      const zc = Z - 0.25;
      add(block(sx * 0.78 - 0.26, 0.3, zc - 0.82, sx * 0.78 + 0.26, 0.42, zc + 0.5), 0x24505f);
      add(block(sx * 0.78 - 0.14, 0.42, zc - 0.5, sx * 0.78 + 0.14, Y - CASE_R1 + 0.12, zc + 0.18), 0x24505f);
      for (const dz of [-0.62, 0.32]) {
        const bolt = turned([[0, 0], [0.075, 0], [0.075, 0.05], [0.04, 0.07], [0, 0.07]], 6, { crease: 40 });
        bolt.translate(sx * 0.78, 0.42, zc + dz);
        shine(bolt, STEEL);
      }
    }
  }

  // --- The two curved field magnets ---
  {
    const NA = 28;
    // The north pole above and the south below. Their faces print the letter, in every view that shows one.
    const top = emShell(MAG_R0, CASE_R0 + 0.005, 46 * DEG, 134 * DEG, -X_MAG, X_MAG, {
      na: NA,
      // Runs up the face from the cut edge, so the letters stand upright to someone looking down at them.
      uvOuter: (i, j) => [mix(EM_ATLAS.RED[0], EM_ATLAS.RED[2], j), mix(EM_ATLAS.RED[1], EM_ATLAS.RED[3], i / NA)],
      uvInner: () => [0.02, 0.98],
    });
    printed.push({ geometry: top, color: 0xffffff });
    const bottom = emShell(MAG_R0, CASE_R0 + 0.005, 226 * DEG, 314 * DEG, -X_MAG, X_MAG, {
      na: NA,
      uvOuter: () => [0.02, 0.73],
      // The inside of the lower magnet faces up, so that is where a student reads its letter.
      uvInner: (i, j) => [mix(EM_ATLAS.BLUE[0], EM_ATLAS.BLUE[2], j), mix(EM_ATLAS.BLUE[3], EM_ATLAS.BLUE[1], i / NA)],
    });
    printed.push({ geometry: bottom, color: 0xffffff });
    // Letters on the two front cut faces as well, laid proud on the flat edge of each magnet.
    const edge = (phi, rect, flip) => {
      const W = X_MAG * 2 - 0.1; const H = CASE_R0 - MAG_R0 - 0.05;
      const g = printedPlate(W, H, 0.03, rect);
      const r = (MAG_R0 + CASE_R0) / 2;
      const p = emAt(r, phi, 0);
      // Local x along the shaft, local y along the radius, and the face along the edge's own normal.
      const radial = V(0, Math.sin(phi), Math.cos(phi));
      const tangent = V(0, Math.cos(phi), -Math.sin(phi)).multiplyScalar(flip);
      const X = V().crossVectors(radial, tangent);
      const m = new THREE.Matrix4().makeBasis(X, radial, tangent);
      m.setPosition(p[0] + tangent.x * 0.012, p[1] + tangent.y * 0.012, p[2] + tangent.z * 0.012);
      g.applyMatrix4(m);
      printed.push({ geometry: g, color: 0xffffff });
    };
    edge(314 * DEG, EM_ATLAS.BLUEL, 1);
    edge(46 * DEG, EM_ATLAS.REDL, -1);
  }

  // --- The shaft and its two bearings ---
  const SHAFT_R = 0.085;
  shine(rodX(-2.5, 3.0, SHAFT_R), STEEL, 1.05);
  const bearing = (x) => {
    // A cast pedestal standing on the board, its top a disc round the bearing.
    const ped = [];
    const R = 0.46;
    for (let i = 0; i <= 18; i++) {
      const a = -0.15 + (i / 18) * (Math.PI + 0.3);
      ped.push([Z + Math.cos(a) * R, Y + Math.sin(a) * R]);
    }
    ped.push([Z - 0.62, 0.68], [Z - 0.78, 0.3], [Z + 0.78, 0.3], [Z + 0.62, 0.68]);
    const g = extrudeAny(ped, 0.2);
    g.rotateY(Math.PI / 2);
    g.translate(x, 0, 0);
    add(g, 0x24505f);
    add(block(x - 0.2, 0.3, Z - 0.86, x + 0.2, 0.36, Z + 0.86), 0x1f3f4c);
    // Outer race, a ring of real balls, inner race: all proud of the casting on both sides.
    const races = turned([[0, -0.15], [0.385, -0.15], [0.4, -0.13], [0.4, 0.13], [0.385, 0.15], [0.3, 0.15], [0.29, 0.1], [0.19, 0.1], [0.18, 0.15], [0.1, 0.15], [0.1, 0.17], [0, 0.17]], 28, { crease: 28 });
    const racesB = races.clone();
    racesB.rotateX(Math.PI);
    // The track the balls run in goes dark, so the balls show against it.
    for (const g of [axisX(races, x), axisX(racesB, x)]) {
      polished(g, STEEL, 1.02);
      const col = g.attributes.color; const pp = g.attributes.position;
      for (let i = 0; i < col.count; i++) {
        const r = Math.hypot(pp.getY(i) - Y, pp.getZ(i) - Z);
        if (r > 0.17 && r < 0.31) col.setXYZ(i, 0.05, 0.05, 0.06);
      }
      metal.push({ geometry: g, keepColor: true });
    }
    for (const s of [-1, 1]) {
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * TAU + 0.2;
        const ball = new THREE.SphereGeometry(0.062, 10, 8);
        const p = emAt(0.24, a, x + s * 0.09);
        ball.translate(p[0], p[1], p[2]);
        shine(ball, 0xf1f3f5, 1.1);
      }
    }
  };
  bearing(-2.2);
  bearing(1.62);

  // --- The armature: a stack of real laminations on the shaft, with a dark core showing between them ---
  const a = V(0, Math.sin(THETA), Math.cos(THETA));
  const b = V(0, Math.cos(THETA), -Math.sin(THETA));
  const rotorM = new THREE.Matrix4().makeBasis(a, b, V(-1, 0, 0));
  rotorM.setPosition(0, Y, Z);
  {
    const core = extrudeAny(emRotorOutline(0.012), X_CORE * 2 - 0.02);
    core.applyMatrix4(rotorM);
    add(core, 0x171a1d);
    const PLATES = 22;
    const pitch = (X_CORE * 2) / PLATES;
    const tmp = emRotorOutline(0);
    for (let k = 0; k < PLATES; k++) {
      const plate = extrudeAny(tmp, pitch - 0.012);
      plate.translate(0, 0, -X_CORE + (k + 0.5) * pitch);
      plate.applyMatrix4(rotorM);
      const v = k % 2 ? 0x8d97a1 : 0x7a848e;
      iron.push({ geometry: plate, color: v });
    }
  }
  // The rotor's own frame: a along the arm, b across it, c along the shaft.
  const rotorP = (pa, pb, px) => [px, Y + a.y * pa + b.y * pb, Z + a.z * pa + b.z * pb];

  // --- The windings: every turn a real wire, wound three layers deep round each arm ---
  const WIRE = 0.0235;
  const coilPath = (sign) => {
    // The sense round the arm is the same on both, right-handed about +a, because the two arms are the
    // two ends of one electromagnet. Worked out on paper: x cross b is a, so increasing t is that sense.
    const pts = [];
    const TURNS = 8; const LAYERS = 3; const PER = 14;
    const A0c = 0.185; const A1c = 0.44;
    const path = (t, layer, level) => {
      const lx = X_CORE + 0.03 + layer * 0.05;
      const lb = 0.15 + 0.03 + layer * 0.05;
      const an = t * TAU;
      const c = Math.cos(an); const s = Math.sin(an);
      const X = Math.sign(c) * Math.abs(c) ** 0.3 * lx;
      const B = Math.sign(s) * Math.abs(s) ** 0.3 * lb;
      const pa = sign * mix(A0c, A1c, level);
      return rotorP(pa, B, X);
    };
    for (let layer = 0; layer < LAYERS; layer++) {
      for (let turn = 0; turn < TURNS; turn++) {
        for (let k = 0; k < PER; k++) {
          const t = turn + k / PER + layer * TURNS;
          const local = (turn + k / PER) / TURNS;
          const level = layer % 2 ? 1 - local : local;
          pts.push(path(t, layer, level));
        }
      }
    }
    return pts;
  };
  const coilFront = coilPath(1);
  const coilBack = coilPath(-1);
  const wind = (pts, seed) => {
    const g = tube(pts, WIRE, { sides: 6, steps: pts.length - 1, round: 1 });
    const nrm = g.attributes.normal;
    const base = lin(COPPER); const tmp = [1, 1, 1];
    tintVertices(g, (x, y, z, out, i) => {
      polishInto(nrm.getX(i), nrm.getY(i), nrm.getZ(i), tmp, base, 1.08);
      // Enamel is never quite one colour turn to turn.
      const k = 0.88 + 0.2 * Math.sin(i * 0.031 + seed);
      out[0] = Math.min(1, tmp[0] * k); out[1] = Math.min(1, tmp[1] * k); out[2] = Math.min(1, tmp[2] * k);
    });
    metal.push({ geometry: g, keepColor: true });
  };
  wind(coilFront, 1);
  wind(coilBack, 4);

  // --- The commutator: two copper halves on a dark mica drum, with the gap along the arms ---
  const X0c = COMM_X - 0.21; const X1c = COMM_X + 0.21;
  const mica = turned([[0, -0.26], [SHAFT_R + 0.1, -0.26], [COMM_R - 0.05, -0.2], [COMM_R - 0.05, 0.2], [SHAFT_R + 0.1, 0.34], [0, 0.34]], 22, { crease: 30 });
  add(axisX(mica, COMM_X), 0x151515);
  const segCopper = lin(0xf09a4e);
  for (const s of [1, -1]) {
    const mid = THETA + s * Math.PI / 2;
    const SPAN = 80 * DEG;
    const seg = emShell(COMM_R - 0.08, COMM_R, mid - SPAN, mid + SPAN, X0c, X1c, { na: 20 });
    metal.push(polished(seg, segCopper, 1.08));
    // The riser, where the wire is soldered on.
    const riser = emShell(COMM_R - 0.05, COMM_R + 0.05, mid - 0.32, mid + 0.32, X1c - 0.02, X1c + 0.06, { na: 8 });
    metal.push(polished(riser, segCopper, 1));
  }
  // A dark collar carrying the shaft between the commutator and the rotor.
  const collar = turned([[0, -0.32], [0.13, -0.32], [0.13, 0.32], [0, 0.32]], 16, { crease: 40 });
  add(axisX(collar, -0.92), 0x2b2f34);
  // The leads. The top brush bears on the +b segment, which feeds the start of the front coil.
  const riserAt = (s) => {
    const mid = THETA + s * Math.PI / 2;
    return emAt(COMM_R + 0.03, mid, X1c + 0.02);
  };
  const lead = (from, to, bow) => {
    const m = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 + bow[1], (from[2] + to[2]) / 2 + bow[2]];
    const g = tube([from, m, to], 0.024, { sides: 6, steps: 16, round: 1 });
    metal.push(polished(g, COPPER, 1.05));
  };
  // The coil's wire runs in at the -x end of the windings, so both leads reach it straight.
  lead(riserAt(1), coilFront[0], [0, 0.05, 0.05]);
  lead(riserAt(-1), coilBack[coilBack.length - 1], [0, -0.05, -0.05]);
  // Across the rotor from the end of one coil to the start of the other, round the shaft.
  {
    const from = coilFront[coilFront.length - 1]; const to = coilBack[0];
    const around = rotorP(0, 0.4, X_CORE + 0.16);
    const g = tube([from, around, to], 0.024, { sides: 6, steps: 18, round: 1 });
    metal.push(polished(g, COPPER, 1.05));
  }

  // --- Two spring-loaded carbon brushes, pressing on the commutator from above and below ---
  const POST_Z = Z - 0.98;
  const brush = (dir) => {
    const yAt = (r) => Y + dir * r;
    // The carbon itself. Sunk a hundredth of a foot into the copper: it presses, so it touches.
    const CONTACT = COMM_R - 0.012;
    const carbon = block(COMM_X - 0.1, Math.min(yAt(CONTACT), yAt(0.7)), Z - 0.08, COMM_X + 0.1, Math.max(yAt(CONTACT), yAt(0.7)), Z + 0.08);
    if (Math.abs(yAt(CONTACT) - Y) >= COMM_R) throw new Error('electric-motor: a brush does not reach the commutator');
    add(carbon, 0x202225);
    // A guide collar it slides in.
    const c0 = yAt(0.38); const c1 = yAt(0.52);
    const lo = Math.min(c0, c1); const hi = Math.max(c0, c1);
    for (const [x0, z0, x1, z1] of [[COMM_X - 0.14, Z - 0.12, COMM_X + 0.14, Z - 0.08], [COMM_X - 0.14, Z + 0.08, COMM_X + 0.14, Z + 0.12], [COMM_X - 0.14, Z - 0.12, COMM_X - 0.1, Z + 0.12], [COMM_X + 0.1, Z - 0.12, COMM_X + 0.14, Z + 0.12]]) {
      shine(block(x0, lo, z0, x1, hi, z1), BRASS, 1);
    }
    // The bracket: a top plate, two rods down to the collar, an arm back to the post.
    const P0 = yAt(0.98); const P1 = yAt(1.03);
    shine(block(COMM_X - 0.2, Math.min(P0, P1), Z - 0.16, COMM_X + 0.2, Math.max(P0, P1), Z + 0.16), BRASS, 1);
    for (const sx of [-1, 1]) {
      shine(rod([COMM_X + sx * 0.16, yAt(0.42), Z], [COMM_X + sx * 0.16, yAt(1), Z], 0.024, 8, 0), BRASS, 1);
    }
    shine(block(COMM_X - 0.07, Math.min(yAt(0.97), yAt(1.05)), POST_Z, COMM_X + 0.07, Math.max(yAt(0.97), yAt(1.05)), Z + 0.02), BRASS, 1);
    // The coil spring, its ends sunk into the carbon's top and the underside of the plate.
    const pts = [];
    const TURNS = 6; const PER = 10;
    for (let k = 0; k <= TURNS * PER; k++) {
      const t = k / PER;
      const an = t * TAU;
      const rr = yAt(mix(0.69, 0.99, k / (TURNS * PER)));
      pts.push([COMM_X + Math.cos(an) * 0.06, rr, Z + Math.sin(an) * 0.06]);
    }
    const spring = tube(pts, 0.0145, { sides: 5, steps: pts.length - 1, round: 0 });
    shine(spring, 0xdfe3e8, 1.05);
    // The pigtail: flexible copper from the carbon to the bracket.
    const tail = tube([[COMM_X - 0.1, yAt(0.62), Z + 0.05], [COMM_X - 0.25, yAt(0.75), Z + 0.1], [COMM_X - 0.19, yAt(0.99), Z + 0.1]], 0.02, { sides: 6, steps: 14, round: 1 });
    metal.push(polished(tail, COPPER, 1));
  };
  brush(1);
  brush(-1);
  // The insulated post both brackets are clamped to.
  add(block(COMM_X - 0.09, 0.3, POST_Z - 0.09, COMM_X + 0.09, Y + 1.18, POST_Z + 0.09), 0x1f1a16);
  add(block(COMM_X - 0.22, 0.3, POST_Z - 0.2, COMM_X + 0.22, 0.38, POST_Z + 0.2), 0x1f1a16);

  // --- The wheel at the far end, whose painted face says which way it turns ---
  const WX = 2.46;
  {
    const prof = [
      [0, -0.28], [0.18, -0.28], [0.2, -0.2], [0.22, -0.16], [0.56, -0.13], [0.58, -0.2], [0.76, -0.2], [0.78, -0.17], [0.7, -0.03], [0.7, 0.03], [0.78, 0.17], [0.76, 0.2], [0.58, 0.2], [0.56, 0.13], [0.22, 0.16], [0.2, 0.2], [0.18, 0.28], [0, 0.28],
    ];
    const g = turned(prof, 40, { crease: 32 });
    // A turned rim and web, with a darkened groove.
    const wheelBase = lin(BRASS);
    polished(axisX(g, WX), wheelBase, 1.05);
    metal.push({ geometry: g, keepColor: true });
    const [u0, v0, u1, v1] = EM_ATLAS.WHEEL;
    // The print is a disc in a square: only the part within the round face is seen.
    const pos = []; const uv = [];
    const N = 28; const R = 0.54;
    const cx = (u0 + u1) / 2; const cy = (v0 + v1) / 2;
    const F = WX + 0.185;
    const put = (y, z, x, ru, rv) => { pos.push(x, y, z); uv.push(ru, rv); };
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * TAU; const a1 = ((i + 1) / N) * TAU;
      const Pt = (an) => [Y + Math.sin(an) * R, Z - Math.cos(an) * R, cx + Math.cos(an) * (u1 - u0) * 0.5, cy + Math.sin(an) * (v1 - v0) * 0.5];
      const A = Pt(a0); const B = Pt(a1);
      // Face, toward +x.
      put(Y, Z, F, cx, cy); put(A[0], A[1], F, A[2], A[3]); put(B[0], B[1], F, B[2], B[3]);
      // Rim down into the wheel, and a back, which closes the disc.
      put(A[0], A[1], F, A[2], A[3]); put(A[0], A[1], F - 0.03, A[2], A[3]); put(B[0], B[1], F - 0.03, B[2], B[3]);
      put(A[0], A[1], F, A[2], A[3]); put(B[0], B[1], F - 0.03, B[2], B[3]); put(B[0], B[1], F, B[2], B[3]);
      put(Y, Z, F - 0.03, cx, cy); put(B[0], B[1], F - 0.03, B[2], B[3]); put(A[0], A[1], F - 0.03, A[2], A[3]);
    }
    printed.push({ geometry: soup(pos, uv, 30), color: 0xffffff });
  }

  // --- The big battery, the two binding posts, and every wire actually reaching something ---
  const BX = -2.52; const BZ = 0.68;
  {
    // A dark case, and the wrapper printed on each of its four sides, so no side shows its label mirrored.
    const H = 1.42; const W = 0.56;
    add(block(BX - W, 0.3, BZ - W, BX + W, 0.3 + H, BZ + W), 0x202227);
    for (let k = 0; k < 4; k++) {
      const plate = printedPlate(W * 2, H, 0.03, EM_ATLAS.LABEL);
      const yaw = (k * Math.PI) / 2;
      plate.applyMatrix4(new THREE.Matrix4().compose(
        V(BX + Math.sin(yaw) * (W + 0.012), 0.3 + H / 2, BZ + Math.cos(yaw) * (W + 0.012)),
        new THREE.Quaternion().setFromAxisAngle(UP, yaw), V(1, 1, 1),
      ));
      printed.push({ geometry: plate, color: 0xffffff });
    }
    add(block(BX - W - 0.015, 0.3 + H - 0.1, BZ - W - 0.015, BX + W + 0.015, 0.3 + H + 0.05, BZ + W + 0.015), 0x202227);
    add(block(BX - W - 0.015, 0.3, BZ - W - 0.015, BX + W + 0.015, 0.34, BZ + W + 0.015), 0x202227);
  }
  const terminal = (x, y, z, color) => {
    const g = turned([[0, 0], [0.13, 0], [0.13, 0.04], [0.06, 0.06], [0.06, 0.13], [0.12, 0.14], [0.12, 0.2], [0.05, 0.23], [0, 0.23]], 14, { crease: 35 });
    g.translate(x, y, z);
    shine(g, color, 1.02);
  };
  const TOPB = 0.3 + 1.42 + 0.05;
  const PLUS = [BX + 0.26, TOPB, BZ + 0.1]; const MINUS = [BX - 0.26, TOPB, BZ + 0.1];
  terminal(PLUS[0], PLUS[1], PLUS[2], BRASS);
  terminal(MINUS[0], MINUS[1], MINUS[2], STEEL);
  const postA = [-1.52, 0.3, 0.95]; const postB = [-0.82, 0.3, 0.95];
  const bindingPost = (p, cap) => {
    const body = turned([[0, 0], [0.17, 0], [0.17, 0.05], [0.09, 0.08], [0.09, 0.32], [0, 0.32]], 16, { crease: 35 });
    body.translate(p[0], p[1], p[2]);
    shine(body, BRASS, 1);
    const knob = turned([[0, 0], [0.13, 0], [0.15, 0.04], [0.15, 0.12], [0.1, 0.16], [0, 0.16]], 14, { crease: 35 });
    knob.translate(p[0], p[1] + 0.3, p[2]);
    add(knob, cap);
  };
  bindingPost(postA, 0xb22020);
  bindingPost(postB, 0x1a1a1c);
  const WIRE_R = 0.035;
  const cable = (pts, color) => add(tube(pts, WIRE_R, { sides: 8, steps: pts.length * 6, round: 1 }), color);
  const RED = 0xc4271f; const BLK = 0x17181b;
  const postTop = (p) => [p[0], p[1] + 0.2, p[2]];
  cable([[PLUS[0], PLUS[1] + 0.12, PLUS[2]], [PLUS[0] + 0.12, PLUS[1] + 0.3, PLUS[2] + 0.12], [-1.72, 1.32, 0.92], [postA[0] - 0.03, 0.7, postA[2]], postTop(postA)], RED);
  cable([[MINUS[0], MINUS[1] + 0.12, MINUS[2]], [MINUS[0] - 0.02, MINUS[1] + 0.34, MINUS[2] + 0.34], [-2.0, 1.1, 1.18], [-1.3, 0.5, 1.2], [postB[0] - 0.08, 0.42, postB[2] + 0.1], postTop(postB)], BLK);
  // Post A over the top to the upper bracket; post B along the board and up to the lower one.
  const armTop = [COMM_X, Y + 1.03, Z - 0.5];
  const armLow = [COMM_X, Y - 1.03, Z - 0.5];
  cable([postTop(postA), [-1.82, 1.05, 0.72], [-1.95, 2.5, 0.3], [-1.86, 3.14, -0.32], [-1.62, 3.04, Z - 0.5], [armTop[0], armTop[1] + 0.02, armTop[2]]], RED);
  cable([postTop(postB), [-0.72, 0.68, 0.72], [-0.98, 0.42, 0.1], [-1.2, 0.38, -0.4], [-1.42, 0.5, Z - 0.5], [armLow[0], armLow[1] - 0.01, armLow[2]]], BLK);

  const group = new THREE.Group();
  group.add(mesh(mergeParts(iron), standard({ vertexColors: true, roughness: 0.46, metalness: 0.2 })));
  group.add(mesh(mergeParts(metal), standard({ vertexColors: true, roughness: 0.24, metalness: 0.45 })));
  group.add(mesh(mergeParts(printed), standard({ map: canvasTexture(1024, 512, paintMotorAtlas), roughness: 0.42, metalness: 0.05 })));
  const woodMap = canvasTexture(1024, 480, paintMotorBase);
  group.add(mesh(mergeParts(wood), standard({ map: woodMap, roughness: 0.55, metalness: 0 })));
  return group;
}

// A round bar along X, with chamfered ends.
function rodX(x0, x1, r) {
  const L = x1 - x0;
  const g = turned([[0, 0], [r * 0.8, 0], [r, r * 0.2], [r, L - r * 0.2], [r * 0.8, L], [0, L]], 18, { crease: 35 });
  g.rotateZ(-Math.PI / 2);
  g.translate(x0, EM.Y, EM.Z);
  return g;
}

// ===========================================================================================
// THE TESLA COIL
// ===========================================================================================
//
// A flat spiral of thick copper tube, a tall coil of fine enamel wire on a green former, a polished
// toroid, a bank of capacitors and a spark gap, with arcs of lightning stopped in mid-air. The arcs are
// unlit solids, so they stay bright in any world and at any time of day.

const TC = {
  BASE_Y: 0.34,
  PRIM_Y: 0.86, // the primary's height
  SEC_R: 0.34,
  SEC_Y0: 0.74, SEC_Y1: 5.42,
  TOR_Y: 5.98, TOR_R: 0.98, TOR_r: 0.36,
};

function paintTeslaBase(ctx, w, h) {
  const rng = seededRandom(1891);
  ctx.fillStyle = '#7c4f2a';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 420; i++) {
    const y0 = rng() * h; const a = 4 + rng() * 11; const f = 0.006 + rng() * 0.012; const ph = rng() * 6;
    ctx.strokeStyle = rng() < 0.6 ? `rgba(44,22,8,${0.1 + rng() * 0.22})` : `rgba(190,134,80,${0.06 + rng() * 0.16})`;
    ctx.lineWidth = 0.7 + rng() * 2.2;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 24) { const y = y0 + Math.sin(x * f + ph) * a; if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
  }
  // The brass plate on the front edge.
  const px = w * 0.26; const py = h * 0.8; const pw = w * 0.48; const ph = h * 0.15;
  ctx.fillStyle = '#c7a24c';
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = '#6d5520';
  ctx.lineWidth = 4;
  ctx.strokeRect(px + 7, py + 7, pw - 14, ph - 14);
  ctx.fillStyle = '#2b2008';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, 'TESLA COIL', pw - 50, 46, '800');
  ctx.fillText('TESLA COIL', px + pw / 2, py + ph / 2 + 2);
}

// One jagged, branching bolt, grown by midpoint-free random walk: each step wanders from the line it was
// aimed along, and forks at random. Everything goes into `segments` as a polyline with radii.
function growArc(rng, start, dir, length, radius, depth, out) {
  const steps = Math.max(3, Math.round(length / 0.2));
  const d = V(...dir).normalize();
  const pts = [V(...start)];
  const radii = [radius];
  const stepLen = length / steps;
  let p = V(...start);
  const heading = d.clone();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Jagged rather than wiggly: long nearly straight runs, then a sudden kink.
    const kink = rng() < 0.42 ? 1.25 : 0.2;
    heading.x += (rng() - 0.5) * kink; heading.y += (rng() - 0.5) * kink * 0.8; heading.z += (rng() - 0.5) * kink;
    heading.lerp(d, 0.24).normalize();
    p = p.clone().addScaledVector(heading, stepLen * (0.7 + rng() * 0.6));
    pts.push(p);
    radii.push(radius * (1 - t) ** 0.8 + 0.0035);
    if (depth > 0 && i < steps && rng() < 0.3 + depth * 0.08) {
      const side = heading.clone();
      side.x += (rng() - 0.5) * 1.4; side.y += (rng() - 0.5) * 1.1 - 0.12; side.z += (rng() - 0.5) * 1.4;
      growArc(rng, [p.x, p.y, p.z], [side.x, side.y, side.z], length * (1 - t) * (0.38 + rng() * 0.32), radii[i] * 0.7, depth - 1, out);
    }
  }
  out.push({ pts, radii });
}

// A polyline as a closed, sharp-cornered tube. Parallel transport keeps the rings from twisting, and
// the corners stay hard: a bolt that has been smoothed reads as a noodle.
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

// The breakout point: a little spike on the ring's upper shoulder, because a bolt leaves from a point.
const TC_NUB_AZ = 0.34;
const TC_NUB = {
  at: [Math.sin(TC_NUB_AZ) * (TC.TOR_R + TC.TOR_r * 0.72), TC.TOR_Y + TC.TOR_r * 0.66, Math.cos(TC_NUB_AZ) * (TC.TOR_R + TC.TOR_r * 0.72)],
  dir: [Math.sin(TC_NUB_AZ) * 0.72, 0.69, Math.cos(TC_NUB_AZ) * 0.72],
};

function buildTesla() {
  const { BASE_Y, PRIM_Y, SEC_R, SEC_Y0, SEC_Y1, TOR_Y, TOR_R, TOR_r } = TC;
  const metal = [];
  const dark = [];
  const wood = [];
  const COPPER = 0xe8813a; const BRASS = 0xd9ab45; const STEEL = 0xc9ced4; const GREEN = 0x2f7d4a;
  const shine = (g, color, lift = 1) => metal.push(polished(g, color, lift));
  const add = (g, color) => { dark.push({ geometry: g, color }); return g; };
  const FLOOR = BASE_Y;

  // --- The base: a square wooden board on four turned feet ---
  {
    const X = 2.1; const Zb = 2.1; const Y0 = 0.1;
    const g = gridSolid(1, 1,
      (i, j) => [mix(-X, X, i), BASE_Y, mix(Zb, -Zb, j)],
      (i, j) => [mix(-X, X, i), Y0, mix(Zb, -Zb, j)],
      { uvTop: (i, j) => [i, j], uvBottom: (i, j) => [i, j] });
    wood.push({ geometry: g, color: 0xffffff });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const foot = turned([[0, 0], [0.22, 0], [0.24, 0.04], [0.15, 0.1], [0, 0.1]], 14, { crease: 40 });
        foot.translate(sx * (X - 0.3), 0, sz * (Zb - 0.3));
        dark.push({ geometry: foot, color: 0x3a2413 });
      }
    }
  }

  // --- The secondary: a green former, and on it many turns of real fine wire ---
  {
    const former = turned([
      [0, SEC_Y0 - 0.02], [SEC_R - 0.015, SEC_Y0 - 0.02], [SEC_R - 0.015, SEC_Y1 + 0.02], [0, SEC_Y1 + 0.02],
    ], 40, { crease: 40 });
    const nrm = former.attributes.normal;
    const green = lin(GREEN); const out0 = [1, 1, 1];
    tintVertices(former, (x, y, z, out, i) => {
      polishInto(nrm.getX(i), nrm.getY(i), nrm.getZ(i), out0, green, 0.95);
      out[0] = out0[0]; out[1] = out0[1]; out[2] = out0[2];
    });
    metal.push({ geometry: former, keepColor: true });
    // A thick end collar at each end of the winding, varnished, sunk into the former.
    for (const y of [SEC_Y0 + 0.08, SEC_Y1 - 0.08]) {
      const collar = turned([[0, y - 0.05], [SEC_R + 0.025, y - 0.05], [SEC_R + 0.04, y - 0.02], [SEC_R + 0.04, y + 0.02], [SEC_R + 0.025, y + 0.05], [0, y + 0.05]], 40, { crease: 35 });
      metal.push(polished(collar, 0x246a3c, 0.9));
    }
    // The winding. A pitch this fine is what says "thousands of turns", and every one is a real turn.
    const WIRE = 0.0118;
    const PITCH = 0.0335;
    const y0 = SEC_Y0 + 0.36; const y1 = SEC_Y1 - 0.34;
    const TURNS = Math.round((y1 - y0) / PITCH);
    if (TURNS < 100) throw new Error(`tesla-coil: only ${TURNS} visible turns`);
    const PER = 14;
    const pts = [];
    const n = TURNS * PER;
    for (let k = 0; k <= n; k++) {
      const t = k / PER;
      const a = t * TAU;
      const rr = SEC_R - 0.015 + WIRE * 0.55;
      pts.push([Math.cos(a) * rr, mix(y0, y1, k / n), Math.sin(a) * rr]);
    }
    const coil = tube(pts, WIRE, { sides: 4, steps: n, round: 0 });
    const nc = coil.attributes.normal;
    const cc = lin(0xba5a26); const tmp = [1, 1, 1];
    tintVertices(coil, (x, y, z, out, i) => {
      polishInto(nc.getX(i), nc.getY(i), nc.getZ(i), tmp, cc, 1.1);
      out[0] = tmp[0]; out[1] = tmp[1]; out[2] = tmp[2];
    });
    metal.push({ geometry: coil, keepColor: true });
    // The secondary's foot, a turned block standing on the board, and the ground strap off it.
    const foot = turned([[0, FLOOR], [0.62, FLOOR], [0.62, FLOOR + 0.06], [0.5, FLOOR + 0.1], [0.44, SEC_Y0 + 0.06], [0, SEC_Y0 + 0.06]], 28, { crease: 35 });
    dark.push({ geometry: foot, color: 0x24262b });
    // From the top of the winding, a wire up into the toroid's stem.
    const stem = turned([[0, SEC_Y1], [0.3, SEC_Y1], [0.28, SEC_Y1 + 0.08], [0.14, SEC_Y1 + 0.14], [0.11, TOR_Y - 0.1], [0, TOR_Y - 0.1]], 22, { crease: 35 });
    shine(stem, STEEL, 1.0);
  }

  // --- The toroid: spun metal, painted with what it would reflect, because metalness above about 0.5
  // renders black in an app with no environment map ---
  {
    // A real ring: the tube goes all the way round, with a shallow spun dish across the middle.
    const prof = [];
    const N = 40;
    prof.push([0, TOR_Y - TOR_r * 0.34], [TOR_R - TOR_r * 1.15, TOR_Y - TOR_r * 0.34]);
    for (let i = 0; i <= N; i++) {
      const a = -Math.PI * 0.86 + (i / N) * Math.PI * 1.72;
      prof.push([TOR_R + Math.cos(a) * TOR_r, TOR_Y + Math.sin(a) * TOR_r]);
    }
    prof.push([TOR_R - TOR_r * 1.15, TOR_Y + TOR_r * 0.28], [0, TOR_Y + TOR_r * 0.22]);
    const g = turned(prof, 76, { crease: 50 });
    const nrm = g.attributes.normal;
    tintVertices(g, (x, y, z, out, i) => {
      const nx = nrm.getX(i); const ny = nrm.getY(i); const nz = nrm.getZ(i);
      // Polished aluminium, painted: bright sky on top, a hard dark horizon just below the rim, the
      // warm floor underneath, and one window of bright light moving round it. It must not go black.
      const az = Math.atan2(nx, nz);
      const hz = 0.1 + 0.05 * Math.sin(az * 3 + 1);
      const sky = mix(1.0, 0.74, clamp01(ny));
      const ground = mix(0.2, 0.5, clamp01(-ny));
      let k = mix(mix(ground, 0.26, sstep(ny, hz - 0.2, hz - 0.02)), sky, sstep(ny, hz - 0.02, hz + 0.09));
      const line = Math.exp(-(((ny - hz - 0.28) / 0.05) ** 2)) * 0.22;
      k -= line;
      const glint = Math.exp(-(((az - 0.6) / 0.5) ** 2)) * Math.exp(-(((ny - 0.56) / 0.2) ** 2));
      out[0] = Math.min(1, k * 0.97 + glint * 0.5);
      out[1] = Math.min(1, k * 0.985 + glint * 0.5);
      out[2] = Math.min(1, k * 1.03 + glint * 0.5);
    });
    metal.push({ geometry: g, keepColor: true });
    // The little breakout point the biggest arc leaves from.
    const nub = turned([[0, 0], [0.05, 0], [0.04, 0.16], [0.016, 0.22], [0, 0.22]], 10, { crease: 45 });
    stood(nub, TC_NUB.at, TC_NUB.dir);
    shine(nub, STEEL, 1);
  }

  // --- The primary: a wide flat spiral of thick tube, on four slotted arms, a few turns only ---
  const PRIM_TURNS = 5.5;
  const PR0 = 0.72; const PR1 = 1.68;
  // The phase brings its outer end round to the spark gap, so its lead is short rather than a bar across it.
  const primaryAt = (t) => {
    const a = t * TAU + (43 - 180) * DEG;
    const r = mix(PR0, PR1, t / PRIM_TURNS);
    return [Math.cos(a) * r, PRIM_Y, Math.sin(a) * r];
  };
  {
    const pts = [];
    const n = Math.round(PRIM_TURNS * 26);
    for (let k = 0; k <= n; k++) pts.push(primaryAt((k / n) * PRIM_TURNS));
    const g = tube(pts, 0.058, { sides: 9, steps: n, round: 1 });
    metal.push(polished(g, COPPER, 1.08));
    // The strike ring outside it, an open hoop on insulators, which keeps a wild arc off the spiral.
    for (let k = 0; k < 4; k++) {
      const a = 67 * DEG + (k * Math.PI) / 2;
      const c = Math.cos(a); const s = Math.sin(a);
      // A slotted arm under the spiral, an insulator at each end.
      dark.push({ geometry: beam([c * 0.46, PRIM_Y - 0.1, s * 0.46], [c * 1.82, PRIM_Y - 0.1, s * 1.82], 0.13, 0.12), color: 0xb79c6a });
      for (const R of [0.6, 1.72]) {
        const post = turned([[0, FLOOR], [0.09, FLOOR], [0.075, FLOOR + 0.05], [0.09, FLOOR + 0.12], [0.07, FLOOR + 0.17], [0.09, FLOOR + 0.24], [0.06, PRIM_Y - 0.12], [0, PRIM_Y - 0.12]], 10, { crease: 45 });
        post.translate(c * R, 0, s * R);
        dark.push({ geometry: post, color: 0x7d3a22 });
      }
    }
  }

  // --- The capacitor bank: six cans on a rack, wired in a row ---
  const BANK = [-1.55, FLOOR, 1.42];
  const bankTops = [];
  for (let k = 0; k < 6; k++) {
    const x = BANK[0] + (k % 3) * 0.32 - 0.18;
    const z = BANK[2] + (k < 3 ? 0.18 : -0.18);
    const can = turned([[0, 0], [0.135, 0], [0.145, 0.03], [0.145, 0.5], [0.12, 0.54], [0, 0.54]], 16, { crease: 35 });
    can.translate(x, FLOOR + 0.1, z);
    const nrm = can.attributes.normal; const tmp = [1, 1, 1]; const blue = lin(0x2a5fb0); const band = lin(0xe9e5d4);
    tintVertices(can, (px, py, pz, out, i) => {
      polishInto(nrm.getX(i), nrm.getY(i), nrm.getZ(i), tmp, Math.abs(py - (FLOOR + 0.1 + 0.28)) < 0.06 ? band : blue, 0.95);
      out[0] = tmp[0]; out[1] = tmp[1]; out[2] = tmp[2];
    });
    metal.push({ geometry: can, keepColor: true });
    const post = turned([[0, 0], [0.032, 0], [0.032, 0.11], [0, 0.11]], 8, { crease: 40 });
    post.translate(x, FLOOR + 0.62, z);
    shine(post, BRASS, 1);
    bankTops.push([x, FLOOR + 0.72, z]);
  }
  add(block(BANK[0] - 0.42, FLOOR, BANK[2] - 0.36, BANK[0] + 0.4, FLOOR + 0.1, BANK[2] + 0.36), 0x2c2f35);
  // Bus bars across the tops of each row of three.
  for (const r of [0, 3]) shine(rod(bankTops[r], bankTops[r + 2], 0.022, 6, 1), BRASS, 1);
  shine(rod(bankTops[2], bankTops[5], 0.022, 6, 1), BRASS, 1);

  // --- The spark gap: two polished brass balls on insulating pillars, with a little frozen spark ---
  const GAP = [1.5, FLOOR, 1.42];
  const gapY = FLOOR + 0.72;
  const gapBall = (sx) => {
    const X = GAP[0] + sx * 0.17;
    const stand = turned([[0, 0], [0.12, 0], [0.12, 0.04], [0.06, 0.08], [0.05, 0.2], [0.07, 0.24], [0.05, 0.28], [0.07, 0.32], [0.05, 0.36], [0.05, 0.6], [0, 0.6]], 12, { crease: 40 });
    stand.translate(GAP[0] + sx * 0.42, FLOOR + 0.1, GAP[2]);
    dark.push({ geometry: stand, color: 0x6f3420 });
    const arm = rod([GAP[0] + sx * 0.42, gapY, GAP[2]], [X, gapY, GAP[2]], 0.026, 8, 1);
    shine(arm, BRASS, 1);
    const ball = new THREE.SphereGeometry(0.115, 20, 14);
    ball.translate(X, gapY, GAP[2]);
    shine(ball, BRASS, 1.12);
    const cap = new THREE.SphereGeometry(0.05, 12, 8);
    cap.translate(GAP[0] + sx * 0.42, gapY, GAP[2]);
    shine(cap, BRASS, 1);
  };
  gapBall(-1);
  gapBall(1);
  add(block(GAP[0] - 0.62, FLOOR, GAP[2] - 0.22, GAP[0] + 0.62, FLOOR + 0.1, GAP[2] + 0.22), 0x2c2f35);

  // --- The supply: a transformer in a black box, behind the coil, feeding the bank ---
  {
    const TX = 0; const TZ = -1.68;
    add(block(TX - 0.7, FLOOR, TZ - 0.28, TX + 0.7, FLOOR + 0.74, TZ + 0.28), 0x24262b);
    for (let k = 0; k < 7; k++) add(block(TX - 0.62 + k * 0.2, FLOOR + 0.05, TZ + 0.27, TX - 0.56 + k * 0.2, FLOOR + 0.68, TZ + 0.31), 0x34373d);
    const terminal = (sx) => {
      const g = turned([[0, 0], [0.065, 0], [0.052, 0.05], [0.066, 0.1], [0.052, 0.15], [0.066, 0.2], [0.03, 0.25], [0, 0.25]], 10, { crease: 45 });
      g.translate(TX + sx * 0.44, FLOOR + 0.74, TZ);
      dark.push({ geometry: g, color: 0x7d3a22 });
    };
    terminal(-1);
    terminal(1);
  }

  // --- The wiring: thick, visible, and every end into a terminal ---
  const CABLE = 0.024;
  const cable = (pts, color) => add(tube(pts, CABLE, { sides: 7, steps: pts.length * 6, round: 1 }), color);
  const copperLead = (pts) => metal.push(polished(tube(pts, CABLE, { sides: 7, steps: pts.length * 6, round: 1 }), COPPER, 1.05));
  const primaryOuter = primaryAt(PRIM_TURNS);
  // Bank to one side of the gap; the other side of the gap to the spiral's outer end.
  copperLead([bankTops[2], [-0.5, FLOOR + 0.74, 1.8], [0.5, FLOOR + 0.66, 1.8], [GAP[0] - 0.42, gapY, GAP[2]]]);
  copperLead([[GAP[0] + 0.42, gapY, GAP[2]], [GAP[0] + 0.5, FLOOR + 0.5, GAP[2] - 0.4], [primaryOuter[0] + 0.28, PRIM_Y + 0.06, primaryOuter[2] + 0.05], primaryOuter]);
  // The tapping clip on an inner turn of the spiral, and its lead back to the bank.
  const tap = primaryAt(3.755);
  const clip = rod([tap[0] - 0.05, PRIM_Y - 0.1, tap[2]], [tap[0] + 0.05, PRIM_Y + 0.11, tap[2]], 0.05, 8, 1);
  shine(clip, BRASS, 1);
  copperLead([bankTops[3], [bankTops[3][0] + 0.2, FLOOR + 0.92, bankTops[3][2] - 0.14], [tap[0] - 0.08, PRIM_Y + 0.26, tap[2] + 0.06], [tap[0], PRIM_Y + 0.1, tap[2]]]);
  // The transformer to both sides of the bank.
  cable([[-0.44, FLOOR + 0.98, -1.68], [-1.1, FLOOR + 0.7, -1.3], [-2, FLOOR + 0.35, 0.4], [-2.02, FLOOR + 0.5, 1.28], bankTops[0]], 0xb12a22);
  cable([[0.44, FLOOR + 0.98, -1.68], [1.2, FLOOR + 0.6, -1.5], [2.0, FLOOR + 0.3, 0.2], [2.0, FLOOR + 0.42, 1.2], [GAP[0] + 0.42, gapY - 0.02, GAP[2]]], 0x17181b);

  // --- The arcs: thin, jagged, branching, and stopped where they were ---
  const arcs = [];
  const rng = seededRandom(1893);
  const spawns = [
    // Longest first. Direction, reach, thickness. Up and out to every side, with one striking down.
    [TC_NUB_AZ, 0.5, 3.5, 0.036, 3], [2.5, 0.28, 3.2, 0.032, 3], [4.25, 0.34, 2.9, 0.03, 3], [5.45, 0.6, 2.4, 0.028, 2],
    [1.35, 0.75, 1.75, 0.022, 2], [3.4, 0.7, 1.75, 0.02, 2], [0.95, 0.15, 1.8, 0.02, 2], [5.0, 0.05, 1.55, 0.018, 2], [3.0, -0.1, 1.6, 0.018, 1], [1.95, 0.45, 1.3, 0.016, 1],
  ];
  spawns.forEach(([az, up, len, r, depth], n) => {
    let start = [Math.sin(az) * (TOR_R + TOR_r * 0.85), TOR_Y + TOR_r * 0.3, Math.cos(az) * (TOR_R + TOR_r * 0.85)];
    // The biggest leaves from the breakout point's own tip.
    if (n === 0) start = TC_NUB.at.map((v, k) => v + TC_NUB.dir[k] * 0.18);
    growArc(rng, start, [Math.sin(az), up, Math.cos(az)], len, r, depth, arcs);
  });
  const core = [];
  const glow = [];
  for (const { pts, radii } of arcs) {
    core.push({ geometry: boltSolid(pts, radii), color: 0xf1ebff });
    // Only what is thick enough to matter carries the violet halo, or the budget goes on threads.
    if (radii[0] > 0.012) glow.push({ geometry: boltSolid(pts, radii.map((v) => v * 2.1 + 0.008), 6), color: 0xa98cff });
  }
  // The little spark caught across the gap, between the balls.
  const sparks = [];
  growArc(seededRandom(77), [GAP[0] - 0.08, gapY, GAP[2]], [1, 0.02, 0], 0.16, 0.022, 0, sparks);
  for (const { pts, radii } of sparks) core.push({ geometry: boltSolid(pts, radii), color: 0xf1ebff });

  const group = new THREE.Group();
  group.add(mesh(mergeParts(metal), standard({ vertexColors: true, roughness: 0.2, metalness: 0.45 })));
  group.add(mesh(mergeParts(dark), standard({ vertexColors: true, roughness: 0.5, metalness: 0.1 })));
  group.add(mesh(mergeParts(wood), standard({ map: canvasTexture(1024, 1024, paintTeslaBase), roughness: 0.52, metalness: 0 })));
  const coreMesh = mesh(mergeParts(core), new THREE.MeshBasicMaterial({ vertexColors: true }));
  coreMesh.castShadow = false;
  coreMesh.receiveShadow = false;
  group.add(coreMesh);
  const glowMesh = mesh(mergeParts(glow), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.2, depthWrite: false }));
  glowMesh.castShadow = false;
  glowMesh.receiveShadow = false;
  group.add(glowMesh);
  return group;
}

export const BUILDERS = {
  'james-webb-telescope': () => buildWebb(),
  'limestone-cave': () => buildCave(),
  'space-shuttle': () => buildShuttle(),
  'electric-motor': () => buildMotor(),
  'tesla-coil': () => buildTesla(),
};
