import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, standard, canvasTexture, seededRandom } from '../../PropKit.js';
import { mergeParts, smoothNoise3 } from '../../props/LoftKit.js';
import {
  Sculpt, polygonize, segsP, tube, lathe, outward, alongMatrix, signedVolume, lin, clamp01, mix, sstep,
} from '../ModelKit.js';

// The Model Database's fifth science family: a cut-away Sun, a Moon phases table, a glacier valley
// in a block, Newton's reflecting telescope and a hydraulic lift. Authored in feet, origin at the
// base centre, front toward +Z.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
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

// Value noise on a lattice that wraps at n, much faster per texel than a hashed 3D noise.
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

// A row of an atlas: a plain plate with type measured to fit. rect is in canvas pixels.
function plateCell(ctx, x, y, w, h, lines, { ground = '#efe6cc', ink = '#1d1a14', edge = '#7c6a44', px = null } = {}) {
  ctx.fillStyle = ground;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(2, h * 0.035);
  ctx.strokeRect(x + h * 0.05, y + h * 0.05, w - h * 0.1, h - h * 0.1);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const rowH = (h * 0.84) / lines.length;
  lines.forEach((line, i) => {
    fitFont(ctx, line, w * 0.9, px ?? rowH * 0.82);
    ctx.fillText(line, x + w / 2, y + h * 0.08 + rowH * (i + 0.5));
  });
}
const uvRect = (W, H, x, y, w, h) => [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H];

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

// A straight round bar between two points with rounded ends. r may be [r0, r1].
function rod(a, b, r, sides = 8, round = 1) {
  return tube([a, b], r, { straight: true, steps: 1, sides, round });
}

function block(x0, y0, z0, x1, y1, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

// A flat printed plate, its face on +Z and its back at z = -depth, centre at the origin. The rim
// samples one corner of its own rectangle, so the edge is plain rather than a squashed print.
function printedPlate(w, h, depth, [u0, v0, u1, v1]) {
  return gridSolid(1, 1,
    (i, j) => [(i - 0.5) * w, (j - 0.5) * h, 0],
    (i, j) => [(i - 0.5) * w, (j - 0.5) * h, -depth],
    { uvTop: (i, j) => [mix(u0, u1, i), mix(v0, v1, j)], uvBottom: () => [u0 + 0.002, v0 + 0.002], crease: 20 });
}

// Colour by what a polished surface would reflect, by its own normal. There is no environment map
// anywhere in this app, so a mirror finish has to be painted.
function polished(geometry, color, lift = 1) {
  const nrm = geometry.attributes.normal;
  const arr = new Float32Array(nrm.count * 3);
  const [r, g, b] = Array.isArray(color) ? color : lin(color);
  for (let i = 0; i < nrm.count; i++) {
    const nx = nrm.getX(i); const ny = nrm.getY(i); const nz = nrm.getZ(i);
    const az = Math.atan2(nx, nz);
    const hz = 0.02 + 0.03 * Math.sin(az * 2 + 0.7) + 0.012 * Math.sin(az * 5 + 2.1);
    const skyT = clamp01((ny - hz) / (1 - hz));
    const groundT = clamp01((hz - ny) / (1 + hz));
    const sky = mix(1.08, 0.5, skyT ** 0.55);
    const ground = mix(0.2, 0.62, groundT ** 0.7);
    const k = mix(ground, sky, sstep(ny - hz, -0.035, 0.05)) * lift;
    arr[i * 3] = clamp01(r * k); arr[i * 3 + 1] = clamp01(g * k); arr[i * 3 + 2] = clamp01(b * k);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return { geometry, keepColor: true };
}

// An arrow lying in a plane: a shaft and a head with a real thickness and a bevel.
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

const unlit = (extra = {}) => new THREE.MeshBasicMaterial({ vertexColors: true, ...extra });

const COAST = [
  // North America, Central America and Baja
  [[-168, 65.5], [-164, 67], [-166, 68.5], [-157, 71], [-141, 70], [-128, 70], [-115, 68], [-108, 68], [-95, 68], [-94, 72], [-85, 69.5], [-81, 68], [-85, 66], [-94, 61], [-93, 58], [-85, 55.5], [-82, 53], [-79, 51], [-79, 55], [-77, 59], [-78, 62], [-70, 61], [-65, 60], [-60, 55], [-56, 52], [-60, 50], [-66, 50], [-65, 48], [-61, 46], [-66, 44], [-70, 43.5], [-70, 41.5], [-74, 40], [-76, 37], [-75.5, 35], [-81, 31.5], [-80, 27], [-80.5, 25], [-82, 27], [-83, 29.5], [-89, 30], [-94, 29.5], [-97, 27.5], [-97.5, 22], [-95, 18.5], [-91, 18.5], [-90.5, 21], [-87, 21.5], [-88, 16], [-84, 15.5], [-83.5, 11], [-81, 9], [-78, 9], [-77.5, 7.5], [-80, 7.5], [-83, 8], [-86, 11], [-91, 14], [-95, 16], [-104, 19], [-106, 23], [-110, 27], [-113, 31], [-114.5, 30], [-110, 23], [-112, 25], [-115, 29], [-118, 34], [-121, 35], [-124, 40], [-124, 46], [-123, 49], [-130, 54], [-133, 57], [-140, 60], [-147, 61], [-152, 59], [-158, 57], [-164, 55], [-158, 58.5], [-162, 60], [-165, 62]],
  [[-85, 22], [-80, 23], [-75, 20.5], [-78, 20], [-82, 22]],
  [[-74, 19.8], [-69, 19.5], [-69, 18.2], [-74, 18.2]],
  [[-80, 73], [-72, 71], [-62, 66], [-66, 62], [-75, 65], [-80, 70]],
  [[-117, 71], [-105, 73], [-102, 69], [-115, 69]],
  [[-90, 76], [-75, 77], [-62, 82], [-75, 83], [-92, 81]],
  // Greenland and Iceland
  [[-73, 78], [-60, 82], [-32, 83.5], [-18, 80], [-22, 72], [-32, 68], [-42, 62], [-44, 60], [-50, 62], [-54, 68], [-58, 75]],
  [[-24, 65.5], [-18, 66.5], [-14, 65], [-18, 63.5], [-22, 64]],
  // South America
  [[-78, 8], [-72, 12], [-66, 10.5], [-60, 8], [-52, 5], [-50, 0], [-44, -2.5], [-37, -5], [-35, -8], [-39, -15], [-41, -22], [-48, -26], [-53, -34], [-58, -35], [-57, -38], [-65, -41], [-66, -45], [-69, -51], [-68, -55], [-72, -53], [-75, -48], [-73, -40], [-71, -30], [-70, -18], [-76, -14], [-81, -5], [-80, 0], [-77, 4]],
  // Africa and Madagascar
  [[-6, 35.7], [3, 37], [10, 37], [11, 33.5], [20, 31], [25, 32], [32, 31], [34, 28], [37, 21], [39, 16], [43, 11.5], [51, 12], [47, 4], [40, -3], [39, -8], [40.5, -15], [35, -20], [35, -24], [32.5, -28], [28, -33], [20, -35], [18, -33], [15, -26], [12, -17], [13.5, -8], [9, -1], [9.5, 4], [4, 6], [-4, 5], [-8, 4.5], [-13, 8.5], [-17, 14.5], [-16.5, 20], [-13, 27], [-10, 30], [-9, 33]],
  [[43, -12], [50, -15], [50, -25], [45, -25], [43, -20]],
  // Eurasia
  [[-9, 37], [-9, 43], [-2, 43.5], [-1, 46], [-4.5, 48.5], [2, 51], [5, 53], [8.5, 54], [8, 57], [10.5, 57.5], [10.5, 54.5], [14, 54], [19, 54.5], [21, 57], [24, 59], [30, 60], [23, 60], [21, 62], [25, 65.5], [22, 65.5], [17, 61], [18, 59], [15, 56], [12.5, 56], [11, 59], [6, 58], [5, 62], [12, 65.5], [17, 69], [25, 71], [31, 70], [41, 67], [35, 64.5], [40, 65], [44, 68], [54, 68.5], [60, 69], [68, 68.5], [72, 73], [80, 73], [88, 75.5], [104, 77.5], [113, 74], [130, 71.5], [140, 73], [160, 70], [170, 70], [180, 68.5], [180, 65], [177, 62.5], [170, 60], [163, 60], [162, 56], [157, 51], [156, 57], [160, 61], [154, 59], [143, 59], [135, 54.5], [141, 53], [140, 48], [133, 43], [128, 39], [129, 35.5], [126, 34.5], [126, 37.5], [125, 40], [121, 39], [118, 38], [122, 37], [120, 34], [122, 30], [120, 26], [117, 23.5], [110, 21], [108, 21.5], [106, 19], [109, 14], [109, 11.5], [105, 9], [103, 11], [100, 13.5], [99.5, 9], [103, 5], [104, 1.5], [101, 3], [98.5, 8], [98, 14], [95, 16], [94, 18.5], [91.5, 22], [88, 21.5], [86, 20], [80, 15.5], [80, 11], [77.5, 8], [75, 12], [73, 18], [72.5, 21], [69, 22.5], [67, 25], [61, 25], [57, 26], [56, 27], [51, 28], [48, 30], [50, 26.5], [52, 24], [56, 25], [59.5, 22.5], [55, 17], [45, 13], [43, 13], [40, 20], [35, 28], [34.5, 31.5], [36, 36], [30, 36.5], [27, 37], [26, 40], [29, 41], [35, 42], [41, 41.5], [38, 45], [33, 45.5], [30, 46], [28, 42], [24, 40.5], [23, 37], [21, 38], [19.5, 42], [14, 45], [12.5, 44], [18, 40], [16, 38], [12, 42], [9, 44], [3, 43], [0, 39], [-2, 36.7], [-5.5, 36]],
  // Islands of Europe and Asia
  [[-5.5, 50], [1, 51], [1.5, 53], [-1.5, 55], [-2, 57.5], [-5, 58.5], [-6, 56], [-3, 54], [-5, 52]],
  [[-10, 52], [-6, 52], [-6, 55], [-10, 54.5]],
  [[130, 33], [135, 34], [140, 35], [141.5, 39], [141, 41], [139.5, 39], [136, 36.5], [131, 34.5]],
  [[140, 42], [145, 43.5], [142, 45.5]],
  [[142, 46], [143.5, 50], [143, 54], [142, 50]],
  [[120, 25], [122, 25], [121, 22]],
  [[120, 18], [122, 18], [124, 13], [126, 7], [122, 7], [120, 13]],
  [[95, 5.5], [104, -2], [106, -6], [101, -3]],
  [[109, 1], [113, 3], [117, 7], [119, 1], [116, -4], [110, -2]],
  [[105, -6.5], [114, -7.5], [114, -8.5], [106, -7.5]],
  [[119, -5], [121, 1], [125, 1.5], [122, -5]],
  [[131, -1], [141, -2.5], [147, -6], [150, -10], [143, -9], [138, -8], [133, -4]],
  [[80, 9.5], [82, 7], [80.5, 6]],
  // Australia, Tasmania and New Zealand
  [[114, -22], [122, -18], [126, -14], [130, -12], [135, -12], [136, -15], [140, -17.5], [142, -11], [145, -15], [149, -21], [153, -26], [153, -31], [150, -37], [146, -39], [141, -38], [136, -35.5], [135, -34], [131, -31.5], [124, -33], [116, -35], [115, -31]],
  [[145, -41], [148, -41], [147, -43.5]],
  [[173, -35], [178, -38], [175, -41.5], [174, -39]],
  [[172, -41], [174, -42], [170, -46.5], [167, -45.5]],
];

// [lon, lat, half-width, half-height, colour, alpha]: soft climate fields painted through the
// land clip. Blobs rather than latitude bands, because the real Sahara is not the real Gobi.
const BIOMES = [
  [10, 22, 42, 11, '#d4b06a', 1], [45, 24, 14, 10, '#d9b56e', 1], [60, 38, 22, 8, '#c2a971', 0.8],
  [100, 42, 22, 7, '#bfa770', 0.8], [133, -25, 16, 9, '#c79a5c', 1], [20, -25, 9, 8, '#bfa365', 0.75],
  [-110, 35, 11, 7, '#bb9e68', 0.75], [-69, -30, 5, 14, '#a8946c', 0.65], [-69, -45, 5, 8, '#b1a077', 0.7],
  [-62, -5, 16, 11, '#2c7038', 0.7], [20, -2, 14, 8, '#2d7238', 0.7], [110, 3, 22, 10, '#2f7039', 0.7],
  [-95, 55, 34, 9, '#335f3c', 0.9], [90, 60, 55, 9, '#355f42', 0.9], [20, 62, 22, 7, '#3b6a44', 0.8],
  [-90, 70, 34, 6, '#8b957f', 0.75], [100, 72, 60, 4, '#98a08c', 0.75], [-85, 38, 14, 8, '#4e8644', 0.8],
  [10, 48, 16, 6, '#5a8d49', 0.8], [80, 25, 10, 7, '#5f8a42', 0.8], [115, 30, 11, 7, '#4d8440', 0.8],
];
const RANGES = [
  [[-140, 62], [-125, 52], [-115, 42], [-108, 34], [-100, 22]],
  [[-76, 6], [-78, -5], [-72, -18], [-70, -32], [-72, -48]],
  [[70, 36], [80, 33], [90, 29], [98, 27]],
  [[5, 46], [12, 47], [18, 46]],
];

// Rounds a hand-plotted ring and then roughens it. Corner-cutting takes the straight ruled edges
// off, and a smooth field of the position wobbles the result, so a coast reads as a coast. A field
// and not a fresh random number, or two neighbouring points would disagree and the line would fray.
function naturalCoast(ring, wobble) {
  let pts = ring;
  for (let pass = 0; pass < 2; pass++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    pts = out;
  }
  return pts.map(([x, y]) => [
    x + (smoothNoise3(x * 0.33, y * 0.33, 1.7) - 0.5) * wobble + (smoothNoise3(x * 0.9, y * 0.9, 4.1) - 0.5) * wobble * 0.5,
    y + (smoothNoise3(x * 0.33, y * 0.33, 8.3) - 0.5) * wobble + (smoothNoise3(x * 0.9, y * 0.9, 6.2) - 0.5) * wobble * 0.5,
  ]);
}
function paintEarthMap(ctx, w, h, { seed = 31415, detail = 1 } = {}) {
  const px = (lon) => ((lon + 180) / 360) * w;
  const py = (lat) => ((90 - lat) / 180) * h;
  const rings = COAST.map((ring) => naturalCoast(ring, ring.length > 8 ? 2.6 : 1.2));
  const trace = () => {
    ctx.beginPath();
    for (const ring of rings) {
      ring.forEach(([lon, lat], i) => (i ? ctx.lineTo(px(lon), py(lat)) : ctx.moveTo(px(lon), py(lat))));
      ctx.closePath();
    }
  };
  const ocean = ctx.createLinearGradient(0, 0, 0, h);
  ocean.addColorStop(0, '#16436f');
  ocean.addColorStop(0.5, '#1a5f9e');
  ocean.addColorStop(1, '#163f68');
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, w, h);

  // Continental shelf: a wide pale stroke under the land, which is what gives a coastline an edge.
  ctx.lineJoin = 'round';
  trace();
  ctx.strokeStyle = 'rgba(70,150,180,0.3)';
  ctx.lineWidth = w * 0.005;
  ctx.stroke();

  trace();
  ctx.fillStyle = '#4c8440';
  ctx.fill();

  ctx.save();
  trace();
  ctx.clip();
  const rng = seededRandom(seed);
  for (const [lon, lat, hw, hh, color, alpha] of BIOMES) {
    const blobs = detail > 0.6 ? 14 : 5;
    // A radial gradient to nothing, so a climate has no edge. Solid ellipses, however faint, stack
    // up into visible rings.
    for (let i = 0; i < blobs; i++) {
      const r = 0.7 + rng() * 0.6;
      ctx.save();
      ctx.translate(px(lon + (rng() - 0.5) * hw * 1.4), py(lat + (rng() - 0.5) * hh * 1.4));
      ctx.rotate((rng() - 0.5) * 0.6);
      ctx.scale((hw / 360) * w * r, (hh / 180) * h * r);
      const soft = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      soft.addColorStop(0, color);
      soft.addColorStop(0.55, color);
      soft.addColorStop(1, `${color}00`);
      ctx.globalAlpha = alpha * 0.42;
      ctx.fillStyle = soft;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  // Mountains as a scatter of short dark strokes along each range, rather than one painted road.
  for (const range of RANGES) {
    for (let i = 0; i < range.length - 1; i++) {
      for (let k = 0; k < 26; k++) {
        const t = rng();
        const lon = range[i][0] + (range[i + 1][0] - range[i][0]) * t + (rng() - 0.5) * 3;
        const lat = range[i][1] + (range[i + 1][1] - range[i][1]) * t + (rng() - 0.5) * 3;
        ctx.fillStyle = rng() > 0.3 ? 'rgba(104,88,66,0.24)' : 'rgba(226,220,210,0.24)';
        ctx.beginPath();
        ctx.ellipse(px(lon), py(lat), w * 0.002, h * 0.003, rng() * 3, 0, TAU);
        ctx.fill();
      }
    }
  }
  // Greenland's ice sheet and the high Arctic islands.
  ctx.fillStyle = '#eef4f7';
  ctx.beginPath();
  ctx.ellipse(px(-40), py(74), (20 / 360) * w, (13 / 180) * h, 0, 0, TAU);
  ctx.fill();
  ctx.fillRect(0, 0, w, py(78));
  ctx.restore();

  // Sea ice and Antarctica, both with torn edges so neither is a ruled line across the map.
  const edge = seededRandom(seed + 9);
  ctx.fillStyle = '#e9f1f6';
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let lon = -180; lon <= 180; lon += 4) {
    const peninsula = Math.exp(-(((lon + 62) / 9) ** 2)) * 8;
    ctx.lineTo(px(lon), py(-70 + peninsula + (edge() - 0.5) * 3 + Math.sin(lon * 0.07) * 2));
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let lon = -180; lon <= 180; lon += 5) ctx.lineTo(px(lon), py(81 + Math.sin(lon * 0.05) * 1.5 + Math.sin(lon * 0.17 + 1) * 0.8));
  ctx.lineTo(w, 0);
  ctx.closePath();
  ctx.fill();

  // The Caspian and the Great Lakes, painted back in as water.
  ctx.fillStyle = '#1b5a8f';
  ctx.beginPath();
  ctx.ellipse(px(51), py(42), w * 0.0035, h * 0.022, 0.1, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(px(-87), py(44.5), w * 0.0025, h * 0.012, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(px(-82), py(46.5), w * 0.0065, h * 0.0045, -0.2, 0, TAU);
  ctx.fill();
}
// ===========================================================================================
// THE SUN, WITH A WEDGE REMOVED
// ===========================================================================================
//
// Radius 5ft. The zones are drawn at about their true fractions of the radius: the core to 0.25, the
// radiative zone to 0.71, the convection zone to the surface. Only the photosphere is exaggerated,
// since at true scale it is a few hundred miles of 432,000 and would be no line at all.
//
// THE SURFACE IS NOT A BRIGHT MATERIAL, IT IS A DARK ONE WITH A BRIGHT MAP. The map is both `map`
// (under a darkened colour) and `emissiveMap` at a moderate intensity, so the granulation and the
// sunspots survive whatever sky the model is placed under, and nothing clips to a flat white disc.

const SUN = {
  R: 5, CY: 5.95, ALPHA: 46 * DEG,
  CORE: 0.25, RAD: 0.71, CONV: 0.98,
  CUP: 3.05,
};

// [azimuth from +Z in degrees, latitude, umbra radius in degrees]. Real sunspots stay within about
// 35 degrees of the equator, and they come in groups with a leader and a straggling tail. These are
// placed where the wedge leaves surface to see them from the front and from each side.
const SUNSPOTS = [
  // right of the wedge, in reach of the prominence's feet
  [76, 15, 2.5], [79.5, 13, 1.5], [73, 12.5, 1.3], [82, 16, 1.0], [70.5, 15.5, 0.9],
  // left of the wedge
  [-72, 21, 2.7], [-68, 24, 1.5], [-75.5, 19, 1.6], [-65, 22, 0.9], [-78, 22.5, 1.0],
  [-82, -14, 1.9], [-78, -16.5, 1.2], [-85.5, -13, 1.0],
  // round the sides and back
  [118, -19, 2.4], [122, -17, 1.2], [114.5, -21, 1.1],
  [160, 12, 2.2], [164, 14, 1.3], [156, 10, 1.0],
  [-135, -24, 2.1], [-131, -26, 1.2], [-139, -22, 1.0],
  [-165, 26, 1.8], [-160, 24, 1.0],
  [100, 28, 1.3], [96, 30, 0.8],
];

// Directions of the prominence loops' footpoints, so the surface glows where the arch lands.
const SUN_LOOP = { TH0: 54 * DEG, TH1: 86 * DEG, RISE: 1.85, Z: 0.05 };
const SUN_LOOP2 = { TH0: -118 * DEG, TH1: -96 * DEG, RISE: 0.72, Z: 0.1 };

function sunDir(azDeg, latDeg) {
  const az = azDeg * DEG; const la = latDeg * DEG;
  return [Math.sin(az) * Math.cos(la), Math.sin(la), Math.cos(az) * Math.cos(la)];
}

function paintSunSurface(ctx, w, h) {
  const N = 64;
  const rng = seededRandom(90210);
  // One jittered site per lattice cell, and how bright a granule that cell is.
  const SX = new Float32Array(N * N * N); const SY = new Float32Array(N * N * N); const SZ = new Float32Array(N * N * N);
  const SB = new Float32Array(N * N * N);
  for (let i = 0; i < SX.length; i++) { SX[i] = rng(); SY[i] = rng(); SZ[i] = rng(); SB[i] = rng(); }
  const big = latticeNoise(11, 24);
  const mid = latticeNoise(12, 48);
  const warpA = latticeNoise(13, 64);
  const warpB = latticeNoise(14, 64);
  const fine = latticeNoise(15, 64);
  const SCALE = 32; // lattice cells per unit of direction: a granule about 0.16ft across here
  const spots = SUNSPOTS.map(([az, la, r]) => {
    const d = sunDir(az, la);
    const e1 = new THREE.Vector3(0, 1, 0).cross(V(...d)).normalize();
    const e2 = V(...d).cross(e1).normalize();
    return { d, e1, e2, um: r * DEG, pen: r * 2.15 * DEG, fac: r * 4.6 * DEG };
  });
  const flares = [];
  for (const L of [SUN_LOOP, SUN_LOOP2]) {
    for (const th of [L.TH0, L.TH1]) flares.push([Math.sin(th), Math.cos(th), 0]);
  }
  const cosW = Math.cos(SUN.ALPHA - 0.03);
  paintTexels(ctx, 0, 0, w, h, (x, y, out) => {
    const az = ((x + 0.5) / w) * TAU;
    const la = Math.PI / 2 - ((y + 0.5) / h) * Math.PI;
    const cl = Math.cos(la);
    const dx = Math.sin(az) * cl; const dy = Math.sin(la); const dz = Math.cos(az) * cl;
    // No texel is ever seen inside the wedge.
    if (Math.cos(az) > cosW && Math.abs(az - Math.PI) > 1) { out[0] = 200; out[1] = 90; out[2] = 20; return; }
    // The lattice is warped, or the boundaries of its cells are ruled lines and the Sun is a mosaic.
    const wu = (x / w) * 64; const wv = (y / h) * 32;
    const wx = (warpA(wu, wv) - 0.5) * 1.3; const wy = (warpB(wu, wv) - 0.5) * 1.3; const wz = (warpA(wv + 9, wu + 3) - 0.5) * 1.3;
    const px = dx * SCALE + 128 + wx; const py = dy * SCALE + 128 + wy; const pz = dz * SCALE + 128 + wz;
    const ix = Math.floor(px); const iy = Math.floor(py); const iz = Math.floor(pz);
    let f1 = 9; let f2 = 9; let b1 = 0.5;
    for (let k = -1; k <= 1; k++) {
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const cx = ix + i; const cy = iy + j; const cz = iz + k;
          const at = (cx % N) + (cy % N) * N + (cz % N) * N * N;
          const ax = cx + SX[at] - px; const ay = cy + SY[at] - py; const az2 = cz + SZ[at] - pz;
          const dd = ax * ax + ay * ay + az2 * az2;
          if (dd < f1) { f2 = f1; f1 = dd; b1 = SB[at]; } else if (dd < f2) f2 = dd;
        }
      }
    }
    const lane = sstep(Math.sqrt(f2) - Math.sqrt(f1), 0, 0.62); // 0 on the dark lane, 1 in a granule's middle
    const u = (x / w) * 24; const v = (y / h) * 12;
    const mottling = big(u, v) * 0.6 + mid(u * 2 + 3, v * 2 + 7) * 0.4;
    let L = 0.33 + 0.26 * lane + 0.12 * (b1 - 0.5) + 0.85 * (mottling - 0.5) + 0.1 * (fine((x / w) * 512, (y / h) * 256) - 0.5);

    // Sunspots: a near-black umbra, a fibrous penumbra, and the bright faculae that crowd them.
    let shade = 1;
    let fac = 0;
    for (let s = 0; s < spots.length; s++) {
      const sp = spots[s];
      const dot = dx * sp.d[0] + dy * sp.d[1] + dz * sp.d[2];
      if (dot < 0.9) continue;
      const a = Math.acos(Math.min(1, dot));
      if (a > sp.fac) continue;
      fac = Math.max(fac, 1 - a / sp.fac);
      if (a > sp.pen * 1.15) continue;
      const ph = Math.atan2(dx * sp.e1.x + dy * sp.e1.y + dz * sp.e1.z, dx * sp.e2.x + dy * sp.e2.y + dz * sp.e2.z);
      const wob = 1 + 0.1 * Math.sin(ph * 5 + s) + 0.06 * Math.sin(ph * 11 + s * 2);
      const q = a / wob;
      if (q < sp.pen) {
        const fibre = 0.55 + 0.45 * Math.sin(ph * 46 + 3 * Math.sin(ph * 7 + s));
        const um = sstep(q, sp.um * 0.92, sp.um * 1.08);
        const pen = mix(0.34, 0.6, fibre) * mix(0.8, 1.15, (q - sp.um) / (sp.pen - sp.um));
        shade = Math.min(shade, mix(0.06, pen, um));
      }
    }
    L += fac * fac * 0.2;
    // Where a loop lands the surface brightens: a flare ribbon, kept small.
    for (let f = 0; f < flares.length; f++) {
      const fd = flares[f];
      const dot = dx * fd[0] + dy * fd[1] + dz * fd[2];
      if (dot > 0.988) L += sstep(dot, 0.988, 0.9985) * 0.42;
    }
    L = clamp01(L);
    // Sun's colours as they should appear: lanes of deep orange, granules of amber to pale gold.
    let r; let g; let b;
    if (L < 0.5) { const t = L / 0.5; r = mix(165, 246, t); g = mix(52, 132, t); b = mix(8, 18, t); } else {
      const t = (L - 0.5) / 0.5; r = mix(246, 255, t); g = mix(132, 216, t); b = mix(18, 92, t);
    }
    // A spot darkens toward a deep brown rather than toward grey.
    out[0] = r * shade; out[1] = g * shade * mix(0.6, 1, shade); out[2] = b * shade * mix(0.35, 1, shade);
  });
}

// One disc, its left half on the left face of the wedge and its right half on the right. All the
// zones come from the same fractions as everything else, and the convection cells are a stream
// function, so what is rising and what is sinking is measured rather than dabbed on.
function paintSunSection(ctx, S) {
  const c = S / 2;
  const Rp = S / 2 - 1;
  const rough = latticeNoise(31, 64);
  const CELLS = 19; // up-and-down pairs round the whole circle
  const inv = 1 / Rp;
  paintTexels(ctx, 0, 0, S, S, (x, y, out) => {
    const px = (x + 0.5 - c) * inv; const py = (c - y - 0.5) * inv;
    const rho = Math.hypot(px, py);
    if (rho >= 1) { out[0] = 255; out[1] = 214; out[2] = 92; return; }
    let r; let g; let b;
    const n1 = rough(px * 22 + 40, py * 22 + 40);
    if (rho < SUN.CORE) {
      const t = rho / SUN.CORE;
      r = 255; g = mix(244, 214, t * t) + (n1 - 0.5) * 8; b = mix(170, 84, t * t) + (n1 - 0.5) * 22;
    } else if (rho < SUN.RAD) {
      const t = (rho - SUN.CORE) / (SUN.RAD - SUN.CORE);
      r = mix(255, 246, t); g = mix(186, 136, t) + (n1 - 0.5) * 18; b = mix(44, 18, t) + (n1 - 0.5) * 8;
    } else if (rho < SUN.CONV) {
      const s = (rho - SUN.RAD) / (SUN.CONV - SUN.RAD);
      const ph = Math.atan2(py, px) + (rough(px * 7 + 11, py * 7 + 5) - 0.5) * 0.05;
      const across = Math.sin(Math.PI * s);
      const v = Math.cos(CELLS * ph) * across;       // + is rising, - is sinking
      const psi = Math.sin(CELLS * ph) * across;     // stream function: its contours are the flow
      const hot = clamp01(0.5 + v * 0.75);
      r = mix(104, 255, hot); g = mix(14, 148, hot ** 1.5); b = mix(18, 24, hot);
      // The bands: closed streamlines round every cell.
      const band = Math.abs(Math.sin(psi * Math.PI * 3.2));
      const line = sstep(band, 0, 0.17);
      const k = mix(0.72, 1, line);
      r *= k; g *= k; b *= k;
    } else {
      r = 255; g = 226; b = 104;
    }
    // Boundaries are drawn: three zones of three colours still want an edge between them.
    const edge = Math.min(Math.abs(rho - SUN.CORE), Math.abs(rho - SUN.RAD), Math.abs(rho - SUN.CONV));
    if (edge < 0.0026) { const k = 0.34 + (edge / 0.0026) * 0.5; r *= k; g *= k; b *= k; }
    out[0] = r; out[1] = g; out[2] = b;
  });

  // A photon's random walk: why energy takes so long to cross the radiative zone. Each one starts
  // at the core and is only ever a short step from where it was.
  const rng = seededRandom(4242);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let w = 0; w < 26; w++) {
    let a = rng() * TAU;
    let rr = SUN.CORE + 0.004;
    ctx.strokeStyle = 'rgba(255,240,170,0.8)';
    ctx.lineWidth = S / 900;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * rr * Rp, c - Math.sin(a) * rr * Rp);
    for (let i = 0; i < 150; i++) {
      const dir = rng() * TAU;
      const step = 0.012 + rng() * 0.012;
      const nx = Math.cos(a) * rr + Math.cos(dir) * step;
      const ny = Math.sin(a) * rr + Math.sin(dir) * step;
      const r2 = Math.hypot(nx, ny);
      if (r2 < SUN.CORE + 0.006) continue;
      a = Math.atan2(ny, nx);
      rr = r2 + 0.0024; // the slightest drift outward
      if (rr > SUN.RAD - 0.008) break;
      ctx.lineTo(c + Math.cos(a) * rr * Rp, c - Math.sin(a) * rr * Rp);
    }
    ctx.stroke();
  }

  // Which way each column of the convection zone is going. Cream up, near-black down.
  const mid = (SUN.RAD + SUN.CONV) / 2 * Rp;
  const CELLS2 = CELLS * 2;
  for (let i = 0; i < CELLS2; i++) {
    const ph = (i / CELLS2) * TAU;
    const up = i % 2 === 0;
    ctx.save();
    ctx.translate(c + Math.cos(ph) * mid, c - Math.sin(ph) * mid);
    ctx.rotate(-ph);
    ctx.fillStyle = up ? '#fff4c0' : '#26060a';
    ctx.strokeStyle = ctx.fillStyle;
    const L = S * 0.03;
    const dir = up ? 1 : -1;
    ctx.lineWidth = S / 340;
    ctx.beginPath();
    ctx.moveTo(-dir * L * 0.5, 0);
    ctx.lineTo(dir * L * 0.22, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(dir * L * 0.55, 0);
    ctx.lineTo(dir * L * 0.14, -L * 0.27);
    ctx.lineTo(dir * L * 0.14, L * 0.27);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

const SUN_PLATES = [
  ['CORE', 1],
  ['RADIATIVE ZONE', 1],
  ['CONVECTION ZONE', 1],
  ['PHOTOSPHERE', 1],
  ['ENERGY WANDERS OUT|FOR MANY THOUSANDS OF YEARS', 2],
  ['HOT GAS RISES,|COOL GAS SINKS', 2],
  ['THE VISIBLE SURFACE', 1],
  ['HYDROGEN FUSES INTO HELIUM IN THE CORE', 1],
];

function buildSun() {
  const { R, CY, ALPHA } = SUN;
  const root = new THREE.Group();

  // The surface, everywhere the wedge is not.
  const rows = 96;
  const cols = 120;
  const pos = []; const nor = []; const uvs = []; const idx = [];
  for (let i = 0; i <= rows; i++) {
    const lat = -Math.PI / 2 + (i / rows) * Math.PI;
    for (let j = 0; j <= cols; j++) {
      const az = ALPHA + (j / cols) * (TAU - 2 * ALPHA);
      const n = [Math.sin(az) * Math.cos(lat), Math.sin(lat), Math.cos(az) * Math.cos(lat)];
      pos.push(n[0] * R, n[1] * R + CY, n[2] * R);
      nor.push(...n);
      uvs.push(az / TAU, lat / Math.PI + 0.5);
    }
  }
  const ring = cols + 1;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * ring + j; const b = a + 1; const c = a + ring; const d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const surface = new THREE.BufferGeometry();
  surface.setIndex(idx);
  surface.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  surface.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  surface.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const skin = canvasTexture(1400, 700, (ctx, w, h) => paintSunSurface(ctx, w, h));
  root.add(mesh(surface, standard({
    map: skin, color: 0x5a5a5a, roughness: 0.92, metalness: 0,
    emissive: 0xffffff, emissiveMap: skin, emissiveIntensity: 0.62, bumpMap: skin, bumpScale: 0.6,
  })));

  // The two cut faces: fans, opaque and flat, with a rim sharing the surface's own edge.
  const fpos = []; const fnor = []; const fuv = [];
  for (const side of [1, -1]) {
    const az = side * ALPHA;
    const e = V(Math.sin(az), 0, Math.cos(az));
    const n = V(-side * Math.cos(az), 0, side * Math.sin(az));
    const C = V(0, CY, 0);
    for (let i = 0; i < rows; i++) {
      const la = -Math.PI / 2 + (i / rows) * Math.PI;
      const lb = -Math.PI / 2 + ((i + 1) / rows) * Math.PI;
      const vert = (lat) => {
        const rho = Math.cos(lat); const y = Math.sin(lat);
        return { p: e.clone().multiplyScalar(rho * R).add(V(0, y * R + CY, 0)), uv: [0.5 + side * rho * 0.5 * (639 / 640), 0.5 + y * 0.5 * (639 / 640)] };
      };
      const a = vert(la); const b = vert(lb);
      const cross = a.p.clone().sub(C).cross(b.p.clone().sub(C));
      const order = cross.dot(n) > 0 ? [a, b] : [b, a];
      for (const v of [{ p: C, uv: [0.5, 0.5] }, order[0], order[1]]) {
        fpos.push(v.p.x, v.p.y, v.p.z);
        fnor.push(n.x, n.y, n.z);
        fuv.push(v.uv[0], v.uv[1]);
      }
    }
  }
  const faces = new THREE.BufferGeometry();
  faces.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
  faces.setAttribute('normal', new THREE.Float32BufferAttribute(fnor, 3));
  faces.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
  const section = canvasTexture(1280, 1280, (ctx, w) => paintSunSection(ctx, w));
  const facesMesh = mesh(faces, standard({
    map: section, color: 0x555555, roughness: 0.95, metalness: 0,
    emissive: 0xffffff, emissiveMap: section, emissiveIntensity: 0.72,
  }));
  facesMesh.castShadow = false;
  root.add(facesMesh);

  // Everything that glows on its own terms: unlit, with its light baked in per vertex, because a
  // single flat emissive colour on a sculpted solid is a silhouette. The core ball, and the loops.
  const glow = [];

  // The core is a real ball standing in the wedge, a little mottled, paling toward the side facing out.
  const coreR = R * SUN.CORE;
  const core = new THREE.SphereGeometry(coreR, 56, 38);
  core.translate(0, CY, 0);
  {
    const p = core.attributes.position; const nrm = core.attributes.normal;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const front = clamp01(nrm.getX(i) * 0.1 + nrm.getY(i) * 0.18 + nrm.getZ(i) * 0.98);
      const n = smoothNoise3(p.getX(i) * 3.1, p.getY(i) * 3.1, p.getZ(i) * 3.1);
      const t = clamp01(front ** 2.6 * 1.02 + (n - 0.5) * 0.3);
      col[i * 3] = 1; col[i * 3 + 1] = mix(0.5, 0.92, t); col[i * 3 + 2] = mix(0.03, 0.58, t);
    }
    core.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  glow.push({ geometry: core, keepColor: true });

  // A prominence: a rope of glowing gas held up by a magnetic loop, its feet in the surface. It is a
  // sculpt of braided strands, so it cannot come apart.
  const loopAt = (L, t, rOff = 0) => {
    const th = mix(L.TH0, L.TH1, t);
    const r = R - 0.1 + L.RISE * Math.sin(Math.PI * t) ** 0.72 + rOff;
    return [r * Math.sin(th), CY + r * Math.cos(th), L.Z];
  };
  const sculptLoop = (L, cell, strands, thick) => {
    const s = new Sculpt(cell);
    const N = 48;
    const axisP = []; for (let i = 0; i <= N; i++) axisP.push(loopAt(L, i / N));
    const ropeRadii = axisP.map((_, i) => thick * (0.45 + 0.55 * Math.sin((Math.PI * i) / N)));
    s.add(segsP(axisP, ropeRadii), [1, 0.5, 0.1]);
    for (let k = 0; k < strands; k++) {
      const pts = []; const rad = [];
      const turns = 2.2 + k * 0.45;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const a = t * turns * TAU + (k / strands) * TAU;
        const swell = 0.45 + 0.55 * Math.sin(Math.PI * t);
        const off = thick * (1.25 + 0.45 * Math.sin(t * 9 + k)) * swell;
        const c = loopAt(L, t, Math.cos(a) * off);
        c[2] += Math.sin(a) * off;
        pts.push(c);
        rad.push(thick * 0.5 * (0.5 + 0.65 * swell) * (0.72 + 0.28 * Math.sin(t * 17 + k * 2)));
      }
      s.add(segsP(pts, rad), [1, 0.5, 0.1], { k: thick * 0.22 });
    }
    return s;
  };
  const heat = (x, y, z, nx, ny, nz, out) => {
    // Hottest on the side facing the Sun's centre and at the top of the arch, dull red in the folds.
    const dx = x; const dy = y - CY; const dz = z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const inward = -(nx * dx + ny * dy + nz * dz) / d;
    const front = Math.max(0, nz);
    const n = smoothNoise3(x * 5.2, y * 5.2, z * 5.2);
    const t = clamp01(0.3 + inward * 0.42 + front * 0.22 + (n - 0.5) * 1.1);
    out[0] = mix(0.85, 1, t); out[1] = mix(0.05, 0.56, t * t); out[2] = mix(0, 0.07, t * t * t);
  };
  glow.push({ geometry: polygonize(sculptLoop(SUN_LOOP, 0.042, 5, 0.15), { tint: heat }), keepColor: true });
  glow.push({ geometry: polygonize(sculptLoop(SUN_LOOP2, 0.036, 3, 0.085), { tint: heat }), keepColor: true });
  // Finer threads tracing the same magnetic arch, nested inside and out of the main rope: coronal loops.
  {
    const rng = seededRandom(5150);
    for (const [L, count] of [[SUN_LOOP, 7], [SUN_LOOP2, 3]]) {
      for (let k = 0; k < count; k++) {
        const rise = L.RISE * mix(0.62, 1.1, k / (count - 1)) * (0.97 + rng() * 0.06);
        const zOff = (rng() - 0.5) * L.RISE * 0.3;
        const tMid = 0.5 + (rng() - 0.5) * 0.08;
        const shrink = 0.5 + 0.5 * mix(0.62, 1.1, k / (count - 1));
        const th0 = mix(L.TH0, L.TH1, 0.5 - 0.5 * shrink); const th1 = mix(L.TH0, L.TH1, 0.5 + 0.5 * shrink);
        const pts = [];
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          const th = mix(th0, th1, t);
          const r = R - 0.06 + rise * Math.sin(Math.PI * t ** (Math.log(0.5) / Math.log(tMid))) ** 0.8;
          pts.push([r * Math.sin(th), CY + r * Math.cos(th), L.Z + zOff * Math.sin(Math.PI * t) ** 0.6]);
        }
        const thin = (L === SUN_LOOP ? 0.017 : 0.012) * (0.7 + rng() * 0.6);
        const g = tube(pts, thin, { sides: 5, steps: 26, round: 1 });
        const hue = rng();
        glow.push({ geometry: g, color: new THREE.Color(1, mix(0.2, 0.62, hue), mix(0.0, 0.08, hue)).getHex(THREE.LinearSRGBColorSpace) });
      }
    }
  }
  const glowMesh = mesh(mergeParts(glow), unlit());
  glowMesh.castShadow = false;
  root.add(glowMesh);

  // A low dark stand with a bowl of the Sun's own radius, so it is seated with no gap.
  const cupR = SUN.CUP;
  const cupY = CY - Math.sqrt(R * R - cupR * cupR);
  const bowl = [];
  for (let i = 0; i <= 10; i++) {
    const r = cupR * (1 - i / 10);
    bowl.push([r, CY - Math.sqrt((R - 0.015) ** 2 - r * r)]);
  }
  const stand = [];
  stand.push({
    geometry: lathe([
      [0, 0], [3.85, 0], [3.95, 0.07], [3.95, 0.3], [3.8, 0.36], [3.74, 0.48], [3.4, 0.54], [3.3, 0.66], [2.5, 0.72],
      [1.9, 0.86], [1.7, 0.98], [1.88, 1.08], [2.5, 1.26], [cupR + 0.06, cupY - 0.1], [cupR + 0.06, cupY + 0.02],
      ...bowl,
    ], 84),
    color: 0x2c2e38,
  });
  stand.push({ geometry: lathe([[3.9, 0.16], [3.99, 0.16], [3.99, 0.23], [3.9, 0.23]], 84), color: 0xb08a48 });
  stand.push({ geometry: lathe([[cupR, cupY - 0.09], [cupR + 0.095, cupY - 0.09], [cupR + 0.095, cupY + 0.04], [cupR, cupY + 0.04]], 84), color: 0xb08a48 });
  root.add(mesh(mergeParts(stand), standard({ vertexColors: true, roughness: 0.55, metalness: 0.2 })));

  // Printed plates. An atlas of one column.
  const W = 1024; const rowH = 128; const H = rowH * SUN_PLATES.length;
  const rects = [];
  const atlas = canvasTexture(W, H, (ctx) => {
    SUN_PLATES.forEach(([text], i) => {
      plateCell(ctx, 0, i * rowH, W, rowH, text.split('|'), { ground: '#17151a', ink: '#ffe9a8', edge: '#b58c44' });
      rects.push(uvRect(W, H, 0, i * rowH, W, rowH));
    });
  });
  const plates = [];
  const onFace = (side, along, y, w, h, row) => {
    const az = side * ALPHA;
    const e = V(Math.sin(az), 0, Math.cos(az));
    const n = V(-side * Math.cos(az), 0, side * Math.sin(az));
    const X = side > 0 ? e.clone() : e.clone().negate();
    const m = new THREE.Matrix4().makeBasis(X, V(0, 1, 0), n);
    m.setPosition(e.clone().multiplyScalar(along).add(V(0, CY + y, 0)).addScaledVector(n, 0.05));
    const g = printedPlate(w, h, 0.06, rects[row]);
    g.applyMatrix4(m);
    plates.push({ geometry: g, keepColor: true });
    return { centre: m };
  };
  // The right face names the zones, the left says what happens in them.
  onFace(1, 2.5, 1.0, 2.0, 0.34, 1);
  onFace(1, 3.8, -1.72, 1.6, 0.3, 2);
  onFace(1, 2.9, 3.15, 1.5, 0.32, 3);
  onFace(-1, 2.5, 1.0, 2.2, 0.56, 4);
  onFace(-1, 3.8, -1.72, 1.5, 0.54, 5);
  onFace(-1, 2.9, 3.15, 1.75, 0.32, 6);
  // CORE sits on the ball itself, thick enough that its back is buried in it.
  {
    const g = printedPlate(0.86, 0.3, 0.3, rects[0]);
    const look = V(0.1, 0.2, 1).normalize();
    const X = V(1, 0, 0).addScaledVector(look, -look.x).normalize();
    const Y = look.clone().cross(X).normalize();
    const m = new THREE.Matrix4().makeBasis(X, Y, look);
    m.setPosition(look.clone().multiplyScalar(coreR + 0.02).add(V(0, CY, 0)));
    g.applyMatrix4(m);
    plates.push({ geometry: g, keepColor: true });
  }
  // The stand's own plate, read from the front.
  {
    const g = printedPlate(2.7, 0.2, 0.28, rects[7]);
    g.translate(0, 0.19, 4.03);
    plates.push({ geometry: g, keepColor: true });
  }
  root.add(mesh(mergeParts(plates), standard({
    map: atlas, roughness: 0.6, metalness: 0, emissive: 0xffffff, emissiveMap: atlas, emissiveIntensity: 0.35,
  })));

  // The wire from PHOTOSPHERE to the rim, and a small bead where it lands. Brass, on the right face.
  const wire = [];
  {
    const e = V(Math.sin(ALPHA), 0, Math.cos(ALPHA));
    const n = V(-Math.cos(ALPHA), 0, Math.sin(ALPHA));
    const toRim = (along, y, lift) => e.clone().multiplyScalar(along).add(V(0, CY + y, 0)).addScaledVector(n, lift).toArray();
    const rimY = 3.7;
    const rimA = Math.sqrt((R * 0.986) ** 2 - rimY * rimY);
    wire.push({ geometry: rod(toRim(3.5, 3.2, 0.035), toRim(rimA, rimY, 0.035), 0.022, 6), color: 0xffe9a8 });
    wire.push({ geometry: new THREE.SphereGeometry(0.06, 12, 9).translate(...toRim(rimA, rimY, 0.04)), color: 0xffe9a8 });
    const e2 = V(-Math.sin(ALPHA), 0, Math.cos(ALPHA));
    const n2 = V(Math.cos(ALPHA), 0, Math.sin(ALPHA));
    const toRim2 = (along, y, lift) => e2.clone().multiplyScalar(along).add(V(0, CY + y, 0)).addScaledVector(n2, lift).toArray();
    wire.push({ geometry: rod(toRim2(3.65, 3.25, 0.035), toRim2(rimA, rimY, 0.035), 0.022, 6), color: 0xffe9a8 });
    wire.push({ geometry: new THREE.SphereGeometry(0.06, 12, 9).translate(...toRim2(rimA, rimY, 0.04)), color: 0xffe9a8 });
  }
  const wireMesh = mesh(mergeParts(wire), unlit());
  wireMesh.castShadow = false;
  root.add(wireMesh);

  return root;
}

// ===========================================================================================
// THE MOON PHASES TABLE
// ===========================================================================================
//
// Every sphere here is unlit and carries its own light per vertex, computed from one fixed direction,
// which is the Stand on the Earth decision: a lit ball under the world's sun would change phase with
// the Time of Day slider, HiFi's environment would lift the dark side, and a fill bright enough for
// the table would wash it out. Here half of each ball is bright and half dark under any sky.
//
// THE LIGHT IS PARALLEL, and that is on purpose. Worked out from the lamp as a point two feet from the
// New Moon, the neighbouring Moons would each be lit from a noticeably different direction and the
// two crescents would come out wrong. The real Sun is so far away that its rays are parallel across
// the whole orbit, and the lamp stands for it: a bulb at the focus of a parabolic reflector, which
// really does throw a parallel beam. It stands 8 degrees above the plane of the orbit as seen from
// the Earth, so the New Moon does not hide it, which is the same reason a real New Moon does not
// usually eclipse the Sun, the real orbit being tilted about 5 degrees.
//
// Each sphere's rings are built ABOUT THE LIGHT DIRECTION, so the terminator runs exactly along a row
// of mesh edges and comes out a clean circle from every angle, at a fraction of the triangles a
// lat-long sphere would need to look as sharp.
//
// The order: seen from above, counterclockwise is +X toward -Z toward -X toward +Z. So from the New
// Moon at -X the orbit runs through +Z (first quarter), +X (full) and -Z (third quarter).

export const MOON_TABLE = {
  R: 7, TOP: 4, PLANE: 5.15, ORBIT: 4.7, MOON_R: 0.6, EARTH_R: 0.95,
  LAMP: [-5.92, 6.02, 0], LAMP_R: 0.24, DISH_R: 0.62, DISH_DEPTH: 0.44,
  LIGHT: [-1, 0, 0], // the direction toward the Sun, the same at every Moon
};

// Angle counterclockwise from above, measured from +X, of each phase's Moon. New Moon is at 180,
// between the Earth and the lamp, and the rest follow in the direction the Moon really goes.
export const MOON_PHASES = [
  { name: 'NEW', orbit: 180, lit: 0, side: 0 },
  { name: 'WAXING CRESCENT', orbit: 225, lit: 0.1464, side: 1 },
  { name: 'FIRST QUARTER', orbit: 270, lit: 0.5, side: 1 },
  { name: 'WAXING GIBBOUS', orbit: 315, lit: 0.8536, side: 1 },
  { name: 'FULL', orbit: 0, lit: 1, side: 0 },
  { name: 'WANING GIBBOUS', orbit: 45, lit: 0.8536, side: -1 },
  { name: 'THIRD QUARTER', orbit: 90, lit: 0.5, side: -1 },
  { name: 'WANING CRESCENT', orbit: 135, lit: 0.1464, side: -1 },
];

const moonAt = (phase) => {
  const a = phase.orbit * DEG;
  return [Math.cos(a) * MOON_TABLE.ORBIT, MOON_TABLE.PLANE, -Math.sin(a) * MOON_TABLE.ORBIT];
};

// 0 in shadow, 1 in full light, exactly 0.5 on the terminator, with the soft edge a real one has.
function daylight(dot) {
  const t = clamp01((dot + 0.028) / 0.056);
  return t * t * (3 - 2 * t);
}

// A sphere whose rings run round the light direction, its colour worked out from that direction.
function litSphere(radius, centre, L, { sides = 48, rows = 26, night = 0.03, tone = 0.25, uv = null } = {}) {
  const axis = V(...L).normalize();
  const e1 = Math.abs(axis.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0);
  e1.addScaledVector(axis, -e1.dot(axis)).normalize();
  const e2 = axis.clone().cross(e1).normalize();
  const band = Math.asin(0.028);
  const thetas = [];
  for (let i = 0; i <= rows; i++) thetas.push((i / rows) * Math.PI);
  for (const t of [Math.PI / 2 - band, Math.PI / 2, Math.PI / 2 + band]) thetas.push(t);
  thetas.sort((a, b) => a - b);
  const clean = thetas.filter((t, i) => i === 0 || t - thetas[i - 1] > 1e-3);
  const n = clean.length;
  const pos = []; const nor = []; const col = []; const uvs = [];
  for (let i = 0; i < n; i++) {
    const th = clean[i];
    const dot = Math.cos(th);
    const k = night + (1 - night) * daylight(dot) * (1 - tone + tone * Math.sqrt(Math.max(0, dot)));
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * TAU;
      const d = axis.clone().multiplyScalar(dot)
        .addScaledVector(e1, Math.sin(th) * Math.cos(a))
        .addScaledVector(e2, Math.sin(th) * Math.sin(a));
      pos.push(centre[0] + d.x * radius, centre[1] + d.y * radius, centre[2] + d.z * radius);
      nor.push(d.x, d.y, d.z);
      col.push(k, k, k);
      const w = uv ? uv(d) : [0, 0];
      uvs.push(w[0], w[1]);
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      const a = i * sides + j; const b = i * sides + j2; const c = (i + 1) * sides + j2; const d = (i + 1) * sides + j;
      if (i > 0) idx.push(a, d, b);
      if (i < n - 2) idx.push(b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return signedVolume(g) < 0 ? null : g;
}

// The Moon's map is one disc in an azimuthal projection about the near side: u and v follow the angle
// from the point facing the Earth. No seam anywhere, and the far side (which faces outward, and
// which has almost no maria in reality either) fades to one plain highland at the rim of the disc,
// where the projection pinches.
function paintMoonMap(ctx, S) {
  const c = S / 2;
  const n1 = latticeNoise(71, 64);
  const n2 = latticeNoise(72, 64);
  paintTexels(ctx, 0, 0, S, S, (x, y, out) => {
    const px = (x + 0.5 - c) / c; const py = (y + 0.5 - c) / c;
    const g = 190 + (n1(px * 6 + 20, py * 6 + 20) - 0.5) * 40 + (n2(px * 24 + 30, py * 24 + 30) - 0.5) * 20 + (n2(px * 64 + 5, py * 64 + 9) - 0.5) * 10;
    out[0] = g; out[1] = g * 0.975; out[2] = g * 0.935;
  });
  const toMap = (ox, oy) => {
    const r = Math.min(0.999, Math.hypot(ox, oy));
    const th = Math.asin(r);
    const k = r > 0 ? (th / Math.PI) / r : 0;
    return [c + ox * k * S, c - oy * k * S];
  };
  // The near side's maria, in orthographic position on the disc as seen from the northern half of the
  // Earth: Imbrium upper left, Crisium alone at the upper right. Representative, not a survey.
  const MARIA = [
    [-0.26, 0.55, 0.3, 0.27], [0.3, 0.46, 0.18, 0.17], [0.43, 0.15, 0.23, 0.2], [0.75, 0.3, 0.09, 0.11],
    [-0.62, 0.22, 0.27, 0.42], [-0.44, -0.02, 0.26, 0.18], [-0.18, -0.36, 0.22, 0.17], [-0.56, -0.42, 0.12, 0.12],
    [0.66, -0.08, 0.15, 0.17], [0.46, -0.28, 0.09, 0.09], [0.02, 0.78, 0.42, 0.05], [0, 0.15, 0.12, 0.1],
  ];
  const rng = seededRandom(73);
  for (const [ox, oy, rx, ry] of MARIA) {
    for (let i = 0; i < 16; i++) {
      const a = rng() * TAU; const q = rng() ** 0.6;
      const [mx, my] = toMap(ox + Math.cos(a) * rx * q * 0.72, oy + Math.sin(a) * ry * q * 0.72);
      const rr = (Math.max(rx, ry) * (0.3 + rng() * 0.28) * S) / Math.PI;
      const grad = ctx.createRadialGradient(mx, my, 0, mx, my, rr);
      grad.addColorStop(0, 'rgba(58,58,64,0.86)');
      grad.addColorStop(0.72, 'rgba(58,58,64,0.7)');
      grad.addColorStop(1, 'rgba(58,58,64,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(mx, my, rr, 0, TAU);
      ctx.fill();
    }
  }
  // Craters are soft fills, never outlines: a stroked circle on a planet reads as a soap bubble. A
  // faint dark floor, and a paler halo of thrown-out rock round it.
  for (let i = 0; i < 300; i++) {
    const a = rng() * TAU;
    const mapR = rng() ** 0.5 * 0.44 * S;
    const mx = c + Math.cos(a) * mapR; const my = c + Math.sin(a) * mapR;
    const rr = (0.004 + rng() ** 3 * 0.016) * S;
    const grad = ctx.createRadialGradient(mx, my, 0, mx, my, rr * 1.7);
    grad.addColorStop(0, 'rgba(92,90,86,0.34)');
    grad.addColorStop(0.5, 'rgba(92,90,86,0.2)');
    grad.addColorStop(0.62, 'rgba(236,232,222,0.24)');
    grad.addColorStop(1, 'rgba(236,232,222,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(mx, my, rr * 1.7, 0, TAU); ctx.fill();
  }
  // Tycho and Copernicus, with their bright rays.
  for (const [ox, oy, count, reach] of [[-0.09, -0.72, 14, 0.2], [-0.33, 0.16, 9, 0.075], [-0.62, 0.14, 6, 0.04]]) {
    const [mx, my] = toMap(ox, oy);
    for (let i = 0; i < count; i++) {
      const a = rng() * TAU; const L = reach * S * (0.5 + rng() * 0.6);
      const grad = ctx.createLinearGradient(mx, my, mx + Math.cos(a) * L, my + Math.sin(a) * L);
      grad.addColorStop(0, 'rgba(250,246,234,0.55)');
      grad.addColorStop(1, 'rgba(250,246,234,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = S * 0.0035;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + Math.cos(a) * L, my + Math.sin(a) * L); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(252,248,238,0.92)';
    ctx.beginPath(); ctx.arc(mx, my, S * 0.006, 0, TAU); ctx.fill();
  }
  // The rim of the disc, which is the middle of the far side, settles to one plain tone.
  const fade = ctx.createRadialGradient(c, c, S * 0.44, c, c, S * 0.5);
  fade.addColorStop(0, 'rgba(188,183,174,0)');
  fade.addColorStop(1, 'rgba(188,183,174,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, S, S);
}

// A small picture of the phase as it looks from the Earth: a lit disc built from a half and an ellipse.
function drawPhaseIcon(ctx, x, y, r, phase) {
  ctx.fillStyle = '#23252c';
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  if (phase.lit > 0.001) {
    ctx.fillStyle = '#f6efd8';
    if (phase.lit > 0.999) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    } else {
      const side = phase.side; // + is lit on the right
      const k = Math.abs(1 - 2 * phase.lit); // the terminator's half-width as a fraction of r
      ctx.beginPath();
      ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, side < 0);
      // Back up the terminator: bulging toward the dark side when gibbous, the lit side when crescent.
      ctx.ellipse(x, y, r * k, r, 0, Math.PI / 2, -Math.PI / 2, (phase.lit < 0.5) === (side > 0));
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.strokeStyle = '#8c7a50';
  ctx.lineWidth = Math.max(2, r * 0.07);
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
}

function paintMoonTabletop(ctx, S) {
  const k = S / 14;
  const X = (x) => S / 2 + x * k;
  const Y = (z) => S / 2 + z * k;
  ctx.fillStyle = '#10131f';
  ctx.fillRect(0, 0, S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, '#1d2336');
  g.addColorStop(1, '#0d101a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  // Parallel sunlight across the whole table, every ray the same direction.
  ctx.lineCap = 'round';
  for (let z = -5.7; z <= 5.71; z += 0.95) {
    if (Math.abs(z) < 0.6) continue;
    const half = Math.sqrt(Math.max(0, 6.1 * 6.1 - z * z));
    ctx.strokeStyle = 'rgba(255,214,106,0.17)';
    ctx.lineWidth = k * 0.035;
    ctx.beginPath(); ctx.moveTo(X(-half), Y(z)); ctx.lineTo(X(half), Y(z)); ctx.stroke();
    for (const mark of [-0.72, -0.02, 0.68]) {
      const ax = half * mark;
      ctx.fillStyle = 'rgba(255,214,106,0.42)';
      ctx.beginPath();
      ctx.moveTo(X(ax + 0.2), Y(z));
      ctx.lineTo(X(ax - 0.07), Y(z - 0.09));
      ctx.lineTo(X(ax - 0.07), Y(z + 0.09));
      ctx.closePath();
      ctx.fill();
    }
  }
  // The orbit, with its direction: counterclockwise from above, arrows between the Moons.
  ctx.strokeStyle = 'rgba(190,206,240,0.85)';
  ctx.lineWidth = k * 0.04;
  ctx.beginPath(); ctx.arc(X(0), Y(0), MOON_TABLE.ORBIT * k, 0, TAU); ctx.stroke();
  for (const ph of MOON_PHASES) {
    // Half way to the next Moon in the direction of travel.
    const a = (ph.orbit + 22.5) * DEG;
    const px = Math.cos(a) * MOON_TABLE.ORBIT; const pz = -Math.sin(a) * MOON_TABLE.ORBIT;
    const tx = -Math.sin(a); const tz = -Math.cos(a); // d/da of (cos a, -sin a)
    const nx = -tz; const nz = tx;
    ctx.fillStyle = '#c9d7f6';
    ctx.beginPath();
    ctx.moveTo(X(px + tx * 0.32), Y(pz + tz * 0.32));
    ctx.lineTo(X(px - tx * 0.12 + nx * 0.16), Y(pz - tz * 0.12 + nz * 0.16));
    ctx.lineTo(X(px - tx * 0.12 - nx * 0.16), Y(pz - tz * 0.12 - nz * 0.16));
    ctx.closePath();
    ctx.fill();
  }
  // The words, read from the front of the table.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffe08c';
  fitFont(ctx, 'SUNLIGHT', k * 1.7, k * 0.3);
  ctx.fillText('SUNLIGHT', X(-1.9), Y(-3.45));
  ctx.fillStyle = '#d2def8';
  fitFont(ctx, 'THE MOON GOES THIS WAY', k * 3.1, k * 0.24);
  ctx.fillText('THE MOON GOES THIS WAY', X(0), Y(3.05));
  ctx.fillStyle = '#e8ecf8';
  fitFont(ctx, 'HALF OF THE MOON IS ALWAYS LIT.', k * 5.0, k * 0.26);
  ctx.fillText('HALF OF THE MOON IS ALWAYS LIT.', X(0), Y(1.72));
  fitFont(ctx, 'WHAT CHANGES IS HOW MUCH OF IT WE CAN SEE.', k * 5.8, k * 0.22);
  ctx.fillText('WHAT CHANGES IS HOW MUCH OF IT WE CAN SEE.', X(0), Y(2.14));
}

function buildMoonPhases() {
  const T = MOON_TABLE;
  if (MOON_PHASES.length !== 8) throw new Error('moon-phases: there must be exactly eight Moons');
  const root = new THREE.Group();
  const L = T.LIGHT;

  // The Moons. Each keeps one face toward the Earth, as the real one does, and each is lit from the
  // same direction whichever way that face happens to be turned.
  const map = canvasTexture(1024, 1024, (ctx, w) => paintMoonMap(ctx, w));
  const moons = [];
  for (const phase of MOON_PHASES) {
    const c = moonAt(phase);
    const near = V(-c[0], 0, -c[2]).normalize();   // toward the Earth
    const lookDir = near.clone().negate();         // an Earth-bound viewer looks along this
    const right = lookDir.clone().cross(V(0, 1, 0)).normalize();
    const uv = (d) => {
      const th = Math.acos(clamp01(d.dot(near) * 0.5 + 0.5) * 2 - 1);
      const ex = d.dot(right); const ey = d.y;
      const q = Math.hypot(ex, ey) || 1;
      const rho = (th / Math.PI) * 0.5 * 0.998;
      return [0.5 + (ex / q) * rho, 0.5 + (ey / q) * rho];
    };
    const g = litSphere(T.MOON_R, c, L, { sides: 48, rows: 24, uv });
    if (!g) throw new Error('moon-phases: a Moon came out inside out');
    moons.push({ geometry: g, keepColor: true });
  }
  const moonMesh = mesh(mergeParts(moons), unlit({ map }));
  moonMesh.castShadow = true;
  moonMesh.receiveShadow = false;
  moonMesh.name = 'moons';
  root.add(moonMesh);

  // The Earth, lit the same way. It is split into one triangle list so that u can be unwrapped
  // triangle by triangle across the map's seam.
  const earthC = [0, T.PLANE, 0];
  const TILT = 23.4 * DEG;
  const cT = Math.cos(TILT); const sT = Math.sin(TILT);
  // North leans toward the student at the front of the table: an equinox, the neutral case.
  const earthUv = (d) => {
    const y = d.y * cT + d.z * sT;
    const z = -d.y * sT + d.z * cT;
    return [Math.atan2(d.x, z) / TAU + 0.5, Math.asin(THREE.MathUtils.clamp(y, -1, 1)) / Math.PI + 0.5];
  };
  const eg0 = litSphere(T.EARTH_R, earthC, L, { sides: 72, rows: 40, night: 0.05, tone: 0.2, uv: earthUv });
  const eg = eg0.toNonIndexed();
  const uvA = eg.attributes.uv;
  for (let t = 0; t < uvA.count; t += 3) {
    const u = [uvA.getX(t), uvA.getX(t + 1), uvA.getX(t + 2)];
    const hi = Math.max(...u);
    for (let k = 0; k < 3; k++) if (hi - u[k] > 0.5) uvA.setX(t + k, u[k] + 1);
  }
  const earthMap = canvasTexture(1024, 512, (ctx, w, h) => paintEarthMap(ctx, w, h, { seed: 2718, detail: 0.5 }));
  earthMap.wrapS = THREE.RepeatWrapping;
  const earthMesh = mesh(eg, unlit({ map: earthMap }));
  earthMesh.receiveShadow = false;
  root.add(earthMesh);

  // The lamp: a small Sun. Unlit, hottest in the middle, with a crown of short rays.
  const lampParts = [];
  {
    // The bulb, and the inside of the reflector lit by it. Both unlit: the lamp is the light.
    const g = new THREE.SphereGeometry(T.LAMP_R, 32, 22);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const fx = clamp01(p.getX(i) / T.LAMP_R * 0.5 + 0.5);
      col[i * 3] = 1; col[i * 3 + 1] = mix(0.8, 0.98, fx); col[i * 3 + 2] = mix(0.34, 0.7, fx);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.translate(T.LAMP[0], T.LAMP[1], T.LAMP[2]);
    lampParts.push({ geometry: g, keepColor: true });
    // The reflector: one closed lathe, brass outside and lit by the bulb inside, opening along +X.
    const D = T.DISH_DEPTH; const RD = T.DISH_R; const thick = 0.035;
    const outer = []; const inner = [];
    for (let i = 0; i <= 12; i++) {
      const q = i / 12;
      outer.push([q ? (RD + thick) * q : 0, D * q * q - thick]);
      inner.push([RD * (1 - q), D * (1 - q) * (1 - q)]);
    }
    const dish = lathe([...outer, [RD + thick, D + 0.025], [RD - 0.012, D + 0.025], ...inner], 44);
    const dp = dish.attributes.position;
    const isInside = new Uint8Array(dp.count);
    for (let i = 0; i < dp.count; i++) {
      const r = Math.hypot(dp.getX(i), dp.getZ(i));
      isInside[i] = dp.getY(i) >= D * (r / RD) ** 2 - 0.006 && r < RD - 0.002 ? 1 : 0;
    }
    dish.rotateZ(-Math.PI / 2);
    polished(dish, 0xc29a4e, 0.92);
    const dc = dish.attributes.color;
    for (let i = 0; i < dp.count; i++) {
      if (!isInside[i]) continue;
      const q = clamp01(dp.getX(i) / D);
      const fold = 0.88 + 0.12 * Math.sin(Math.atan2(dp.getY(i), dp.getZ(i)) * 18);
      dc.setXYZ(i, 1, mix(0.9, 0.56, q) * fold, mix(0.46, 0.1, q) * fold);
    }
    // The bulb sits at the parabola's focus: r^2 = 4 f x, with r = RD at x = D.
    const focus = (RD * RD) / (4 * D);
    dish.translate(T.LAMP[0] - focus, T.LAMP[1], T.LAMP[2]);
    lampParts.push({ geometry: dish, keepColor: true });
  }
  const lampMesh = mesh(mergeParts(lampParts), unlit());
  lampMesh.castShadow = false;
  lampMesh.receiveShadow = false;
  root.add(lampMesh);

  // The table: one turned solid with a bevelled rim for the labels, under a painted top.
  const wood = [];
  wood.push({
    geometry: lathe([
      [0, 0], [3.5, 0], [3.5, 0.1], [3.2, 0.2], [2, 0.42], [1.15, 0.8], [0.86, 1.35], [0.78, 2.4], [0.94, 2.86], [1.5, 3.12],
      [3.4, 3.22], [6.84, 3.26], [6.97, 3.32], [7, 3.42], [7, 3.56], [6.2, 3.99], [0, 3.99],
    ], 112),
    color: 0x2c1d15,
  });
  const brass = 0xc29a4e;
  const metal = [];
  metal.push(polished(lathe([[6.17, 3.97], [6.24, 3.97], [6.24, 4.03], [6.19, 4.05], [6.17, 4.03]], 112), brass));
  metal.push(polished(lathe([[T.ORBIT - 0.05, 3.99], [T.ORBIT + 0.05, 3.99], [T.ORBIT + 0.05, 4.03], [T.ORBIT, 4.05], [T.ORBIT - 0.05, 4.03]], 112), brass));
  for (const phase of MOON_PHASES) {
    const [x, y, z] = moonAt(phase);
    metal.push(polished(lathe([[0, 4], [0.27, 4], [0.27, 4.05], [0.16, 4.11], [0.09, 4.18], [0.075, 4.26], [0, 4.26]], 22).translate(x, 0, z), brass));
    metal.push(polished(rod([x, 4.1, z], [x, y - T.MOON_R + 0.06, z], 0.05, 10, 0), brass));
    metal.push(polished(lathe([[0, y - T.MOON_R - 0.04], [0.085, y - T.MOON_R - 0.04], [0.11, y - T.MOON_R + 0.03], [0, y - T.MOON_R + 0.07]], 16).translate(x, 0, z), brass));
  }
  // The Earth's stand: a short post into a collar on the south pole's side.
  metal.push(polished(lathe([[0, 3.99], [0.72, 3.99], [0.72, 4.05], [0.3, 4.14], [0.14, 4.26], [0.12, T.PLANE - T.EARTH_R + 0.02], [0, T.PLANE - T.EARTH_R + 0.06]], 40), brass));
  // The lamp's stalk and foot, reaching the back of its reflector; the bulb's own holder.
  const [lx, ly, lz] = T.LAMP;
  const dishX = lx - (T.DISH_R * T.DISH_R) / (4 * T.DISH_DEPTH);
  metal.push(polished(lathe([[0, 3.99], [0.27, 3.99], [0.27, 4.05], [0.14, 4.15], [0.075, 4.3], [0.06, ly - 0.05], [0, ly - 0.05]], 28).translate(dishX - 0.06, 0, lz), brass));
  metal.push(polished(rod([dishX - 0.08, ly, lz], [lx - 0.1, ly, lz], 0.06, 12, 0), 0x8a6f3c));
  root.add(mesh(mergeParts([...wood, ...metal]), standard({ vertexColors: true, roughness: 0.44, metalness: 0.12 })));

  // The painted top, a very shallow disc.
  const top = lathe([[0, 3.98], [6.18, 3.98], [6.18, 4.008], [0, 4.008]], 112);
  {
    const p = top.attributes.position; const uv = top.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 7) / 14, (7 - p.getZ(i)) / 14);
  }
  const topMap = canvasTexture(1024, 1024, (ctx, w) => paintMoonTabletop(ctx, w));
  root.add(mesh(top, standard({ map: topMap, roughness: 0.62, metalness: 0, emissive: 0xffffff, emissiveMap: topMap, emissiveIntensity: 0.3 })));

  // The rim labels, each a curved plate lying on the bevel under its own Moon. A student outside the
  // table reads along increasing bearing, which is what u follows.
  const W = 1024; const rowH = 160; const H = rowH * 8;
  const labels = canvasTexture(W, H, (ctx) => {
    MOON_PHASES.forEach((phase, i) => {
      plateCell(ctx, 0, i * rowH, W, rowH, [''], { ground: '#ecdfbe', edge: '#6e5c34' });
      drawPhaseIcon(ctx, rowH * 0.62, i * rowH + rowH / 2, rowH * 0.34, phase);
      ctx.fillStyle = '#1b1812';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitFont(ctx, phase.name, W - rowH * 1.5, rowH * 0.46);
      ctx.fillText(phase.name, rowH * 1.2 + (W - rowH * 1.4) / 2, i * rowH + rowH / 2 + rowH * 0.02);
    });
  });
  const plateParts = [];
  const rI = 6.2; const yI = 3.99; const rO = 7; const yO = 3.56;
  const bevelR = (s) => mix(rO, rI, s);
  const bevelY = (s) => mix(yO, yI, s);
  MOON_PHASES.forEach((phase, index) => {
    const c = moonAt(phase);
    const b = Math.atan2(c[0], c[2]);
    const span = 3.05 / 6.6;
    const nu = 10;
    const [u0, v0, u1, v1] = uvRect(W, H, 0, index * rowH, W, rowH);
    const s0 = 0.14; const s1 = 0.86;
    const at = (i, j, lift) => {
      const a = b + (i / nu - 0.5) * span;
      const s = mix(s0, s1, j);
      const r = bevelR(s) + lift * 0.47; const y = bevelY(s) + lift * 0.88;
      return [Math.sin(a) * r, y, Math.cos(a) * r];
    };
    plateParts.push({
      geometry: gridSolid(nu, 1,
        (i, j) => at(i, j, 0.03),
        (i, j) => at(i, j, -0.05),
        { uvTop: (i, j) => [mix(u0, u1, i / nu), mix(v0, v1, j)], uvBottom: () => [u0 + 0.002, v0 + 0.002], crease: 24 }),
      keepColor: true,
    });
  });
  root.add(mesh(mergeParts(plateParts), standard({ map: labels, roughness: 0.6, metalness: 0, emissive: 0xffffff, emissiveMap: labels, emissiveIntensity: 0.18 })));
  return root;
}

// ===========================================================================================
// THE GLACIER VALLEY
// ===========================================================================================
//
// THE PROBLEM THIS LAYOUT SOLVES: a section through a valley must cut ACROSS it, so the valley shown
// on the +Z cut has to run along Z, and it has to hold ice. But a glacier that runs out through the cut
// can have no snout, no terminal moraine and no lake in the model. So the main glacier runs along X,
// from the peaks at +X to its snout at -X, and the cut slices across a TRIBUTARY glacier flowing in
// from the removed front to join it. That is true to life, and it is also where a medial moraine
// comes from: two glaciers meeting, each carrying rock along its edge, and the two edges becoming one
// dark stripe down the middle of the ice. The river leaving the lake runs out through its own small
// V-shaped gorge, and the cut slices that too, beside the U.
//
// Everything is one heightfield worked out once on a fine grid. The mesh reads it, the painted map
// reads it per texel, and the cut face reads its last row, so a painted edge and a solid edge cannot
// disagree. Crevasses and moraine stripes are far finer than the mesh, so they are paint.

const GL = {
  X0: -7, X1: 7, Z0: -4.5, Z1: 4.5, BASE: 0.3, WL: 1.52,
  FX: 336, FZ: 216, // the field's cells
  NX: 176, NZ: 113, // the mesh's cells
};

// A table of [x, y], ascending in x, read with smoothing.
function tableAt(table, x) {
  if (x <= table[0][0]) return table[0][1];
  const last = table.length - 1;
  if (x >= table[last][0]) return table[last][1];
  for (let i = 0; i < last; i++) {
    if (x <= table[i + 1][0]) {
      const t = (x - table[i][0]) / (table[i + 1][0] - table[i][0]);
      return mix(table[i][1], table[i + 1][1], t * t * (3 - 2 * t) * 0.45 + t * 0.55);
    }
  }
  return table[last][1];
}

const GL_BED = [[-7, 2.7], [-5.2, 1.95], [-4.4, 1.42], [-1.6, 1.42], [1, 2.02], [3, 2.85], [3.7, 3.45], [4.4, 4.15], [5.3, 4.5], [5.9, 5.1], [6.5, 6.4], [7, 7]];
const GL_ICE = [[-1.62, 1.42], [-1.35, 2.02], [-0.7, 2.5], [1, 3.02], [2.9, 3.52], [3.7, 4.25], [4.4, 4.88], [5.3, 5.2], [6.1, 5.62]];
const GL_TBED = [[-1.2, 2.0], [1, 2.0], [4.6, 2.0]];
const GL_TICE = [[-0.5, 3.02], [1, 3.18], [4.6, 3.46]];

const glMainZ = (x) => -1.35 + 0.34 * Math.sin((x + 1) * 0.55);
const glMainW = (x) => 1.5 + 0.48 * sstep(x, 3.8, 5.2) - 0.16 * sstep(-x, 0.5, 3);
const glTribX = (z) => 1.55 + 0.14 * Math.sin(z * 0.8);
const GL_TW = 2.05;
const glGorgeX = (z) => -4.35 + 0.1 * Math.sin(z * 2.1);

const GL_PEAKS = [
  [5.6, -3.4, 6.62, 2.4], [3.3, -3.7, 5.8, 2.0], [6.55, 0.7, 6.0, 2.2], [1.0, -3.9, 5.0, 1.9], [-1.4, -4.0, 3.9, 1.8],
  [5.0, 3.6, 5.2, 1.9], [6.7, 3.8, 5.0, 1.5], [-4.6, -4.3, 3.1, 1.5], [-6.6, -2.6, 2.9, 1.5], [-6.8, 3.6, 2.7, 1.3], [-1.9, 4.2, 3.55, 1.1],
];

const GL_RIVER = [[-4.55, -0.72], [-5.1, -0.55], [-6.0, -0.32], [-6.35, 0.75], [-5.85, 1.9], [-4.75, 2.55], [-4.36, 3.05]];
const GL_RIVER_LEN = (() => {
  const L = [0];
  for (let i = 1; i < GL_RIVER.length; i++) L.push(L[i - 1] + Math.hypot(GL_RIVER[i][0] - GL_RIVER[i - 1][0], GL_RIVER[i][1] - GL_RIVER[i - 1][1]));
  return L;
})();

// The outer arc is the terminal moraine, damming the lake; the inner arc hugs the present snout.
function ellipseArc(cx, cz, rx, rz, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = mix(a0, a1, i / n) * DEG;
    out.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz, mix(a0, a1, i / n)]);
  }
  return out;
}
const GL_TERMINAL = ellipseArc(-3.3, -1.35, 1.72, 2.2, 36, 324, 72);
const GL_SNOUT_ARC = ellipseArc(-1.42, -1.3, 0.62, 1.22, 112, 248, 24);
const distToArc = (arc, x, z) => {
  let best = 1e9; let at = 0;
  for (let i = 0; i < arc.length - 1; i++) {
    const a = arc[i]; const b = arc[i + 1];
    const bx = b[0] - a[0]; const bz = b[1] - a[1];
    const t = clamp01(((x - a[0]) * bx + (z - a[1]) * bz) / (bx * bx + bz * bz));
    const d = Math.hypot(x - a[0] - bx * t, z - a[1] - bz * t);
    if (d < best) { best = d; at = mix(a[2], b[2], t); }
  }
  return [best, at];
};

function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// The dark stripes on the ice, each carrying the height of a low ridge. Worked out in one place, so
// the ice's surface and its paint agree on where they are.
function glMedialLines(x) {
  const c = glMainZ(x);
  return [
    c + 0.52 + 0.1 * Math.sin(x * 1.3), // the tributary's east margin and the main ice's south margin, joined
    c - 0.34 + 0.08 * Math.sin(x * 1.1 + 2),
  ];
}

// All the fields, once. The ice's own surface is not held to the block's outline, so it is computed
// wherever a valley is and simply loses to the rock outside it.
function glacierFields() {
  const { FX, FZ, X0, X1, Z0, Z1 } = GL;
  const n = (FX + 1) * (FZ + 1);
  const bed = new Float32Array(n); const ice = new Float32Array(n); const till = new Float32Array(n);
  const water = new Float32Array(n);
  const riverT = new Float32Array(n); const riverL = new Float32Array(n); const riverD = new Float32Array(n);
  const top = new Float32Array(n);
  for (let j = 0; j <= FZ; j++) {
    const z = mix(Z0, Z1, j / FZ);
    for (let i = 0; i <= FX; i++) {
      const x = mix(X0, X1, i / FX);
      const at = i + j * (FX + 1);
      // The mountains. Ridged noise is what makes an arete a knife rather than a hump.
      let M = 2.3 + 2.4 * sstep(x, -3, 5.5) + 0.5 * sstep(-z, 1, 4.5) + 0.62 * sstep(z, 2.3, 3.4) * (1 - sstep(x, -1, 1));
      M += (smoothNoise3(x * 0.42 + 5, z * 0.42 + 3, 1.3) - 0.5) * 0.7;
      for (const [cx, cz, H, r] of GL_PEAKS) {
        const dp = Math.hypot(x - cx, z - cz) / r;
        if (dp < 1) { const cone = H - (H - 2.4) * dp ** 0.85; M = -smin(-M, -cone, 0.5); }
      }
      const ridged = 1 - Math.abs(smoothNoise3(x * 1.05 + 9, z * 1.05 + 4, 2.7) * 2 - 1);
      const ridged2 = 1 - Math.abs(smoothNoise3(x * 2.6 + 2, z * 2.6 + 7, 5.1) * 2 - 1);
      const hi = sstep(M, 2.9, 5.6);
      M += (ridged - 0.62) * (0.2 + 0.9 * hi) + (ridged2 - 0.62) * (0.08 + 0.26 * hi);

      const dM = z - glMainZ(x);
      const WM = glMainW(x);
      const dT = x - glTribX(z);
      // Each valley keeps a shoulder of rock along it, or the ice would spill over its own banks.
      M += (dM > 0 ? 0.42 : 0.9) * Math.exp(-(((Math.abs(dM) - WM * 1.2) / 0.85) ** 2)) * sstep(x, -3.2, -1.2);
      if (z > -0.5) M += (dT < 0 ? 0.42 : 0.7) * Math.exp(-(((Math.abs(dT) - GL_TW * 1.12) / 0.7) ** 2)) * sstep(z, 0.1, 1.2);
      // The headwall at the back of the cirque.
      M += 1.1 * Math.exp(-(((x - 6.7) / 0.8) ** 2)) * Math.exp(-((dM / 3) ** 2));

      // The main valley: a U, flat in the floor and steepening fast up its walls.
      const B1 = tableAt(GL_BED, x) + 2.6 * (Math.abs(dM) / WM) ** 2.8;
      // The tributary, which the cut slices across.
      // It ends where it joins the main valley: past that it climbs away, or it would cut on through the
      // far wall and out of the back of the block.
      const beyond = Math.max(0, glMainZ(x) + 0.2 - z);
      const B2 = tableAt(GL_TBED, z) + 2.5 * (Math.abs(dT) / GL_TW) ** 2.8 + 3.2 * beyond * beyond;
      let B = smin(M, smin(B1, B2, 0.3), 0.32);

      // The lake's basin.
      const e = Math.hypot((x + 3.3) / 1.45, (z + 1.35) / 1.85);
      const lakeBed = 1.3 + 3.2 * Math.max(0, e - 0.75) ** 2;
      B = smin(B, lakeBed, 0.12);

      // The outwash plain along the river, and the V-shaped gorge it leaves by.
      let bestD = 1e9; let bestT = 0; let bestL = 0;
      for (let s = 0; s < GL_RIVER.length - 1; s++) {
        const a = GL_RIVER[s]; const b = GL_RIVER[s + 1];
        const bx = b[0] - a[0]; const bz = b[1] - a[1];
        const len2 = bx * bx + bz * bz;
        const t = clamp01(((x - a[0]) * bx + (z - a[1]) * bz) / len2);
        const ox = x - a[0] - bx * t; const oz = z - a[1] - bz * t;
        const d = Math.hypot(ox, oz);
        if (d < bestD) {
          bestD = d;
          bestT = mix(GL_RIVER_LEN[s], GL_RIVER_LEN[s + 1], t) / GL_RIVER_LEN[GL_RIVER_LEN.length - 1];
          bestL = (ox * bz - oz * bx) / Math.sqrt(len2);
        }
      }
      riverT[at] = bestT; riverL[at] = bestL; riverD[at] = bestD;
      const hw = mix(0.86, 0.24, sstep(bestT, 0.72, 1));
      const plainF = mix(1.42, 1.2, bestT);
      B = smin(B, plainF + 1.05 * Math.max(0, bestD - hw) ** 1.4, 0.1);
      if (z > 2.5) {
        const dG = Math.abs(x - glGorgeX(z));
        const gF = mix(1.2, 1.02, sstep(z, 3, 4.5));
        const V = gF + 1.28 * dG ** 1.06;
        B = smin(B, V, 0.04);
      }

      // Moraines are rubble heaped on the rock, so they add.
      let tillAmount = 0;
      {
        // The arcs are ellipses, so anything well off them can be told without measuring every segment.
        const eOuter = Math.hypot((x + 3.3) / 1.72, (z + 1.35) / 2.2);
        const [dArc, angle] = Math.abs(eOuter - 1) < 0.5 ? distToArc(GL_TERMINAL, x, z) : [9, 0];
        if (dArc < 0.9) {
          const gap = sstep(Math.abs(angle - 161), 8, 15);
          const lump = 0.82 + 0.36 * smoothNoise3(x * 2.3, z * 2.3, 8.1);
          const h = 0.42 * Math.exp(-((dArc / 0.24) ** 2)) * gap * lump;
          B += h;
          tillAmount = Math.max(tillAmount, clamp01((h - 0.03) * 4));
        }
        const eInner = Math.hypot((x + 1.42) / 0.62, (z + 1.3) / 1.22);
        const [dIn] = Math.abs(eInner - 1) < 0.9 && x < -1 ? distToArc(GL_SNOUT_ARC, x, z) : [9];
        if (dIn < 0.5) {
          const h = 0.25 * Math.exp(-((dIn / 0.13) ** 2));
          B += h;
          tillAmount = Math.max(tillAmount, clamp01(h * 6));
        }
      }

      // The ice. Convex across, with the moraine stripes standing proud of it.
      let I = -99;
      if (x > -1.62 && x < 6.5 && Math.abs(dM) < WM) {
        const q = dM / WM;
        I = tableAt(GL_ICE, x) - 0.15 * q * q;
        // Blocks of serac across the icefall, where a sudden steepening has torn the ice.
        const fall = sstep(x, 2.9, 3.2) * (1 - sstep(x, 4.3, 4.7));
        if (fall > 0) I += fall * 0.09 * Math.abs(Math.sin((x - 0.5 * q * q) * 15.7)) * (0.6 + 0.8 * smoothNoise3(x * 3, z * 3, 4.4));
        for (const line of glMedialLines(x)) {
          if (x < 3.1) I += 0.055 * Math.exp(-(((z - line) / 0.09) ** 2));
        }
        // The back of the cirque rounds up into the snow rather than ending on a line.
        I -= sstep(x, 5.9, 6.5) * 1.2;
      }
      if (z > glMainZ(x) + 0.35 && z < 4.6 && Math.abs(dT) < GL_TW) {
        const q = dT / GL_TW;
        const J = tableAt(GL_TICE, z) - 0.2 * q * q - 0.7 * sstep(Math.abs(q), 0.72, 1);
        I = I < -50 ? J : -smin(-I, -J, 0.26);
      }
      const onIce = I > B;

      // The lake lies wherever its basin is under water and inside the terminal moraine.
      const inBasin = e < 1.12 || (x > -3.7 && x < -1.3 && Math.abs(dM) < 1.5);
      const wet = !onIce && B < GL.WL && inBasin;

      // Held as signed thicknesses, so an edge between two cells can be found by interpolating
      // rather than coming out as a staircase of whole cells.
      bed[at] = B; ice[at] = I > -50 ? Math.max(-0.4, I - B) : -0.4; till[at] = tillAmount; water[at] = inBasin ? clamp01((GL.WL - B) * 4 + 0.5) - 0.5 : -0.5;
      top[at] = onIce ? I : (wet ? GL.WL : B);
    }
  }
  // Slope and a soft baked shade off the true surface, which is finer than the mesh. Fields rather
  // than a look-up per texel, or a threshold on them comes out as a staircase of whole cells.
  const slope = new Float32Array(n); const lit = new Float32Array(n);
  const cell = (X1 - X0) / FX; const s = FX + 1;
  for (let j = 0; j <= FZ; j++) {
    for (let i = 0; i <= FX; i++) {
      const iL = Math.max(0, i - 1); const iR = Math.min(FX, i + 1); const jU = Math.max(0, j - 1); const jD = Math.min(FZ, j + 1);
      const gx = (top[iR + j * s] - top[iL + j * s]) / ((iR - iL) * cell);
      const gz = (top[i + jD * s] - top[i + jU * s]) / ((jD - jU) * cell);
      slope[i + j * s] = Math.hypot(gx, gz);
      lit[i + j * s] = 0.68 + 0.34 * ((gx * 0.32 + 0.8 + gz * 0.5) / Math.hypot(gx, 1, gz) - 0.5);
    }
  }
  return { bed, ice, till, water, riverT, riverL, riverD, top, slope, lit };
}

function bilinear(field, fx, fz) {
  const { FX, FZ } = GL;
  const i = Math.min(FX - 1, Math.floor(fx)); const j = Math.min(FZ - 1, Math.floor(fz));
  const tx = fx - i; const tz = fz - j;
  const s = FX + 1;
  const a = field[i + j * s]; const b = field[i + 1 + j * s]; const c = field[i + (j + 1) * s]; const d = field[i + 1 + (j + 1) * s];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

function paintGlacierTop(ctx, w, h, F) {
  const { FX, FZ, X0, X1, Z0, Z1 } = GL;
  const rough = latticeNoise(401, 64);
  const rough2 = latticeNoise(402, 64);
  const pxX = (X1 - X0) / w; const pxZ = (Z1 - Z0) / h;

  // Where the crevasses are, in (along, across) coordinates of the ice they cross. `across` is -1 to 1.
  // Crevasses bow downstream at the centre, which flows fastest, and there are far more in the fall.
  const crevasse = (along, across, x, z) => {
    const bow = along - 0.32 * across * across;
    const fall = sstep(along, 2.95, 3.25) * (1 - sstep(along, 4.3, 4.7));
    let best = 0;
    // The icefall's close transverse rifts.
    if (fall > 0) {
      const sp = 0.13;
      const ph = bow / sp + (rough(x * 3 + 5, z * 3 + 5) - 0.5) * 1.1;
      const dist = Math.abs(ph - Math.round(ph)) * sp;
      const width = 0.03 * (0.5 + rough2(x * 4 + 11, z * 4 + 2));
      best = Math.max(best, fall * (1 - sstep(dist, width * 0.3, width)));
    }
    // Below it, wider-spaced arcs broken into runs.
    if (along < 3.1 && along > -1.5) {
      const sp = 0.36;
      const ph = bow / sp + (rough(x * 2 + 2, z * 2 + 9) - 0.5) * 0.7;
      const k = Math.round(ph);
      const dist = Math.abs(ph - k) * sp;
      const run = rough2(k * 3.7 + 3, across * 2.6 + 9 + k * 0.9);
      if (run > 0.47) {
        const width = 0.036 * sstep(run, 0.47, 0.62) * (0.5 + 0.9 * rough(x * 7 + 1, z * 7 + 3));
        best = Math.max(best, 1 - sstep(dist, width * 0.25, Math.max(0.002, width)));
      }
    }
    // Marginal crevasses, raked up-glacier from each edge at about 45 degrees.
    const edge = Math.abs(across);
    if (edge > 0.6 && along < 3) {
      const ph = (along + (edge - 0.6) * 1.0 + (rough(x * 3 + 8, z * 3 + 4) - 0.5) * 0.3) / 0.27;
      const k = Math.round(ph);
      const dist = Math.abs(ph - k) * 0.27;
      const live = rough2(k * 2.1 + (across > 0 ? 7 : 0), 3.3);
      const width = 0.017 * (0.5 + rough2(k * 2.1, across * 3.1 + 2));
      if (live > 0.42) best = Math.max(best, sstep(edge, 0.6, 0.72) * (1 - sstep(dist, width * 0.3, width)));
    }
    return best;
  };

  // What depends on x alone or z alone is worked out once per column and once per row.
  const colMainZ = new Float32Array(w); const colMainW = new Float32Array(w); const colIce = new Float32Array(w);
  for (let c = 0; c < w; c++) {
    const x = X0 + (c + 0.5) * pxX;
    colMainZ[c] = glMainZ(x); colMainW[c] = glMainW(x); colIce[c] = x > -1.62 ? tableAt(GL_ICE, x) : -99;
  }
  const rowTribX = new Float32Array(h); const rowTIce = new Float32Array(h);
  for (let r = 0; r < h; r++) {
    const z = Z0 + (r + 0.5) * pxZ;
    rowTribX[r] = glTribX(z); rowTIce[r] = tableAt(GL_TICE, z);
  }
  paintTexels(ctx, 0, 0, w, h, (px, py, out) => {
    const x = X0 + (px + 0.5) * pxX;
    const z = Z0 + (py + 0.5) * pxZ;
    const fx = (px + 0.5) / w * FX; const fz = (py + 0.5) / h * FZ;
    const slope = bilinear(F.slope, fx, fz);
    const lit = bilinear(F.lit, fx, fz);
    const y = bilinear(F.top, fx, fz);
    const n1 = rough(x * 2.3 + 40, z * 2.3 + 40);
    const n2 = rough2(x * 7 + 20, z * 7 + 20);
    const n3 = rough(x * 21 + 8, z * 21 + 8);
    let r; let g; let b;
    const onIce = bilinear(F.ice, fx, fz) > 0;
    if (onIce) {
      // Which ice is this? Measured in the same coordinates the surface was built from.
      const dM = z - colMainZ[px];
      const WM = colMainW[px];
      const iceTopM = colIce[px] - 0.15 * (dM / WM) ** 2;
      const dT = x - rowTribX[py];
      const iceTopT = z > colMainZ[px] + 0.35 ? rowTIce[py] - 0.2 * (dT / GL_TW) ** 2 : -99;
      const inMain = iceTopM >= iceTopT;
      const thick = y - bilinear(F.bed, fx, fz);
      const along = inMain ? x : -z + 3.2; // the tributary is measured as running on into the main ice
      const across = inMain ? dM / (WM * 0.86) : dT / (GL_TW * 0.9);
      r = 212; g = 232; b = 243;
      // Firn near the head is snow in all but name, so it melts into the snowfields round it; the
      // tongue goes greyer and dirtier toward the snout.
      const firn = inMain ? sstep(x, 3.7, 4.5) : 0;
      r = mix(r, 232, firn); g = mix(g, 239, firn); b = mix(b, 246, firn);
      const dirt = sstep(-x, -2.3, 1.4);
      r -= 34 * dirt; g -= 26 * dirt; b -= 18 * dirt;
      const nv = (n2 - 0.5) * 14 + (n3 - 0.5) * 8;
      r += nv; g += nv; b += nv;
      // Banding: the summer-and-winter ogives below the icefall.
      if (inMain && x < 2.85) {
        const og = Math.sin(((x - 0.5 * (dM / WM) ** 2) / 0.46) * TAU + (n1 - 0.5) * 2);
        const k = 1 + og * 0.045;
        r *= k; g *= k; b *= k;
      }
      const cr = crevasse(along, across, x, z);
      if (cr > 0) {
        r = mix(r, 22, cr); g = mix(g, 92, cr); b = mix(b, 168, cr);
      }
      // Moraine: a broken dark band where the ice meets the rock on each side, and the medial stripes.
      let dark = (1 - sstep(thick + (n2 - 0.5) * 0.11, 0.07, 0.17)) * (1 - sstep(x, 2.9, 3.7));
      // A bergschrund: the one great rift where the moving ice tears away from the snow above it.
      if (inMain) {
        const bs = 5.62 + 0.42 * (1 - across * across) * -1 + (n1 - 0.5) * 0.14;
        const wid = 0.035 + (n2 - 0.5) * 0.02;
        if (Math.abs(x - bs) < wid && Math.abs(across) < 0.9) { r = 26; g = 96; b = 172; }
      }
      if (inMain && x < 3.1) {
        for (const line of glMedialLines(x)) {
          const taper = 1 - 0.3 * sstep(x, 2.2, 3.1);
          dark = Math.max(dark, 1 - sstep(Math.abs(z - line) + (n3 - 0.5) * 0.06 + (n2 - 0.5) * 0.07, 0.04 * taper, 0.12 * taper));
        }
      }
      if (!inMain) {
        const line = rowTribX[py] + 0.42 + 0.07 * Math.sin(z * 2);
        dark = Math.max(dark, 1 - sstep(Math.abs(x - line) + (n3 - 0.5) * 0.06 + (n2 - 0.5) * 0.07, 0.03, 0.1));
      }
      if (dark > 0) {
        const rock = 62 + n3 * 60;
        r = mix(r, rock, dark); g = mix(g, rock * 0.94, dark); b = mix(b, rock * 0.88, dark);
      }
      // The snout is black with the rock it has been carrying and cut by meltwater.
      const snout = 1 - sstep(x, -1.62, -1.15);
      if (snout > 0) {
        const k = snout * (0.5 + n2 * 0.5);
        r = mix(r, 92, k); g = mix(g, 94, k); b = mix(b, 98, k);
      }
    } else if (bilinear(F.water, fx, fz) > 0) {
      // Rock flour is what turns glacial meltwater milky turquoise.
      const dInlet = Math.hypot(x + 1.75, z - glMainZ(-1.75));
      const milk = clamp01(1 - dInlet / 2.1) * 0.8 + (n1 - 0.5) * 0.28;
      const depth = clamp01((GL.WL - bilinear(F.bed, fx, fz)) / 0.16);
      r = mix(136, 62, depth); g = mix(226, 196, depth); b = mix(214, 202, depth);
      r = mix(r, 170, clamp01(milk)); g = mix(g, 232, clamp01(milk)); b = mix(b, 224, clamp01(milk));
      const ripple = (n3 - 0.5) * 6;
      r += ripple; g += ripple; b += ripple;
      out[0] = r; out[1] = g; out[2] = b;
      return;
    } else {
      // Rock first, in tilted beds, then whatever lies on it.
      const bedding = Math.sin((y + x * 0.22 - z * 0.14) * 24 + (n1 - 0.5) * 7);
      const n4 = rough2(x * 46 + 3, z * 46 + 6);
      const v = 122 + (n1 - 0.5) * 44 + (n2 - 0.5) * 34 + (n3 - 0.5) * 34 + (n4 - 0.5) * 22 + bedding * 5;
      r = v * 1.03; g = v * 0.975; b = v * 0.93;
      // Joints: the fine dark lines a crag is broken along.
      const joint = Math.abs(rough(x * 5.3 + z * 1.7 + 31, z * 5.3 - x * 1.7 + 11) - 0.5);
      if (joint < 0.022) { const k = 0.62 + joint * 12; r *= k; g *= k; b *= k; }
      if (rough(x * 0.8 + 3, z * 0.8 + 3) > 0.54) { r *= 1.06; g *= 0.97; b *= 0.9; }
      // Snow holds wherever the slope lets it, down to a ragged line.
      const snowLine = 4.05 + (n1 - 0.5) * 1.1 + (n2 - 0.5) * 0.3;
      const holds = 1 - sstep(slope + (n2 - 0.5) * 0.7, 1.7, 2.7);
      const snow = sstep(y, snowLine, snowLine + 0.32) * holds;
      // Scoured pale rock, just above the ice: the trimline, where the glacier was recently thicker.
      const dM = z - colMainZ[px];
      if (x > -1.5 && Math.abs(dM) < 2.6) {
        const aboveIce = y - colIce[px];
        const trim = (1 - sstep(aboveIce, 0.32, 0.62)) * sstep(aboveIce, -0.2, 0.05);
        r = mix(r, 148, trim * 0.6); g = mix(g, 143, trim * 0.6); b = mix(b, 136, trim * 0.6);
      }
      // Sparse green below the snow where the ground is gentle, in patches.
      const greenable = (1 - sstep(y, 2.5, 3.5)) * (1 - sstep(slope, 0.8, 1.7));
      const patch = sstep(rough(x * 1.3 + 13, z * 1.3 + 17) + (n2 - 0.5) * 0.4, 0.34, 0.54);
      const green = greenable * patch * 0.95;
      if (green > 0) {
        const lush = 0.75 + n2 * 0.5;
        r = mix(r, 92 * lush, green); g = mix(g, 136 * lush, green); b = mix(b, 62 * lush, green);
      }
      // Gravel and river.
      const riverD = bilinear(F.riverD, fx, fz);
      const riverT = bilinear(F.riverT, fx, fz);
      const hw = mix(0.86, 0.24, sstep(riverT, 0.72, 1));
      const gravel = 1 - sstep(riverD, hw * 0.92, hw * 1.25);
      if (gravel > 0) {
        const grit = 148 + (n3 - 0.5) * 60 + (n2 - 0.5) * 30;
        r = mix(r, grit * 1.02, gravel); g = mix(g, grit * 0.97, gravel); b = mix(b, grit * 0.9, gravel);
      }
      // Till: rubble, dark and lumpy.
      const till = bilinear(F.till, fx, fz);
      if (till > 0.02) {
        const k = clamp01(till * 1.5);
        const lump = 146 + (rough(x * 44 + 1, z * 44 + 3) - 0.5) * 54 + (n3 - 0.5) * 36 + (n2 - 0.5) * 18;
        r = mix(r, lump * 1.04, k); g = mix(g, lump * 0.97, k); b = mix(b, lump * 0.84, k);
      }
      if (snow > 0) {
        const s2 = 228 + (n3 - 0.5) * 6;
        r = mix(r, s2, snow); g = mix(g, s2 + 4, snow); b = mix(b, s2 + 12, snow);
      }
      // The braided threads: channels that wander, cross and rejoin in (t, l) along the river.
      if (riverD < hw * 1.2) {
        const t = riverT;
        const l = bilinear(F.riverL, fx, fz);
        const amp = hw * 0.74 * (1 - sstep(t, 0.72, 0.98));
        let wet = 0;
        for (let k = 0; k < 5; k++) {
          const c = amp * (Math.sin(t * (8 + k * 3.1) + k * 1.9) * 0.62 + Math.sin(t * (17 + k * 4.3) + k * 3.7) * 0.38);
          const ww = (k === 0 ? 0.075 : 0.042) * (0.6 + 0.8 * rough(t * 40 + k * 7, k * 3.3));
          wet = Math.max(wet, 1 - sstep(Math.abs(l - c), ww * 0.55, ww));
        }
        if (wet > 0) {
          r = mix(r, 112, wet); g = mix(g, 214, wet); b = mix(b, 214, wet);
        }
      }
      if (z > 2.9) {
        const dG = Math.abs(x - glGorgeX(z));
        const thread = 1 - sstep(dG, 0.05, 0.1);
        if (thread > 0) { r = mix(r, 92, thread); g = mix(g, 198, thread); b = mix(b, 208, thread); }
      }
    }
    out[0] = r * (lit * 1.02 + 0.08); out[1] = g * (lit * 1.02 + 0.08); out[2] = b * (lit * 0.98 + 0.12);
  });
}

// The four sides of the block, in one sheet. The front is the hero, painted at full size; the other
// three carry only the rock's beds, because a student looks at them in passing.
const GL_ATLAS = { W: 1280, H: 854, FRONT_H: 500, YTOP: 5.75 };
const GL_BACK = { x: 0, w: 640, y: 500, h: 354, ytop: 7.4 };
const GL_SIDE_L = { x: 640, w: 320, y: 500, h: 354, ytop: 7.4 };
const GL_SIDE_R = { x: 960, w: 320, y: 500, h: 354, ytop: 7.4 };

function paintGlacierSides(ctx, F) {
  const { W, FRONT_H, YTOP } = GL_ATLAS;
  const rough = latticeNoise(403, 64);
  const rough2 = latticeNoise(404, 64);
  const { FX, FZ, X0, X1, BASE } = GL;
  const frontBed = (x) => bilinear(F.bed, ((x - X0) / (X1 - X0)) * FX, FZ);
  const frontThick = (x) => bilinear(F.ice, ((x - X0) / (X1 - X0)) * FX, FZ);
  const beds = (x, y) => {
    // Beds tilted, of very different thicknesses, a little faulted. The band coordinate is warped
    // before it is quantised, or an even alternation of equal bands reads as a beach umbrella.
    const fault = x > 0.1 ? 0.3 : 0;
    const v = y + x * 0.2 + fault + (rough(x * 0.7 + 3, y * 0.7 + 3) - 0.5) * 0.55;
    const warped = v * 2.6 + Math.sin(v * 1.7) * 0.8 + Math.sin(v * 3.9 + 1) * 0.35;
    const band = Math.floor(warped);
    const tones = [[92, 86, 84], [120, 106, 92], [76, 74, 80], [108, 94, 82], [130, 118, 104], [84, 80, 76], [98, 88, 90]];
    return tones[((band % tones.length) + tones.length) % tones.length];
  };
  const bedCol = new Float32Array(W); const iceCol = new Float32Array(W);
  for (let c = 0; c < W; c++) {
    const x = X0 + ((c + 0.5) / W) * (X1 - X0);
    const T = frontThick(x);
    bedCol[c] = frontBed(x);
    iceCol[c] = T > 0 ? bedCol[c] + T : -99;
  }
  const tribBedAtCut = tableAt(GL_TBED, GL.Z1);
  const gorgeAtCut = glGorgeX(GL.Z1);
  const tribAtCut = glTribX(GL.Z1);
  paintTexels(ctx, 0, 0, W, FRONT_H, (px, py, out) => {
    const x = X0 + ((px + 0.5) / W) * (X1 - X0);
    const y = YTOP - ((py + 0.5) / FRONT_H) * (YTOP - BASE);
    const B = bedCol[px];
    const I = iceCol[px];
    const n2 = rough2(x * 9 + 7, y * 9 + 7);
    const n3 = rough(x * 24 + 2, y * 24 + 5);
    let r; let g; let b;
    const wetTop = 1.16;
    const inGorge = Math.abs(x - gorgeAtCut) < 0.7;
    if (y > B && I > -50 && y <= I + 0.05) {
      // Ice, with the layering that follows the bed it flowed over, darkening toward its base.
      const dT = x - tribAtCut;
      const depth = clamp01((I - y) / Math.max(0.1, I - B));
      r = mix(214, 96, depth ** 1.5); g = mix(236, 168, depth ** 1.5); b = mix(246, 222, depth ** 1.5);
      const qy = (y - tribBedAtCut) / Math.max(0.1, I - tribBedAtCut);
      const flow = qy - 0.42 * Math.abs(dT / GL_TW) ** 2.6;
      const bandI = Math.sin(flow * 44 + (n2 - 0.5) * 1.2);
      const k = 1 - 0.1 * sstep(bandI, 0.55, 0.98);
      r *= k; g *= k; b *= k;
      // Rock dragged along at the base.
      const nearBed = 1 - sstep(y - B + (n3 - 0.5) * 0.08, 0.05, 0.17);
      if (nearBed > 0) { const rock = 60 + n3 * 40; r = mix(r, rock, nearBed); g = mix(g, rock, nearBed); b = mix(b, rock * 1.05, nearBed); }
      // Crevasses reach down from the surface, narrowing as they go.
      for (const cx of [0.05, 0.62, 1.34, 2.06, 2.74]) {
        const dep = I - y;
        const reach = 0.5 + 0.28 * Math.sin(cx * 7);
        if (dep < reach) {
          const half = 0.05 * (1 - dep / reach);
          if (Math.abs(x - cx - (n2 - 0.5) * 0.03) < half) { r = 16; g = 76; b = 150; }
        }
      }
    } else if (inGorge && y > B && y < wetTop) {
      const dp = clamp01((wetTop - y) / 0.16);
      r = mix(92, 34, dp); g = mix(200, 132, dp); b = mix(214, 176, dp);
    } else {
      const t = beds(x, y);
      const k = 0.82 + (n2 - 0.5) * 0.3 + (n3 - 0.5) * 0.22;
      r = t[0] * k; g = t[1] * k; b = t[2] * k;
      // Thin cracks through the beds.
      const crack = Math.abs(Math.sin(x * 2.9 + y * 0.8 + (rough2(x * 2, y * 2) - 0.5) * 3.2));
      if (crack < 0.02) { r *= 0.62; g *= 0.62; b *= 0.62; }
      // River gravel under the gorge's water.
      if (inGorge && y < B + 0.001 && y > B - 0.14 + (n2 - 0.5) * 0.04) {
        const grit = 120 + (n3 - 0.5) * 80;
        r = grit * 1.02; g = grit * 0.96; b = grit * 0.86;
      }
      // Soil and rubble thin on the very top.
      const skin = 1 - sstep(B - y, 0.015, 0.05);
      if (skin > 0 && !(I > -50 && I > B)) { r = mix(r, 74, skin); g = mix(g, 68, skin); b = mix(b, 52, skin); }
    }
    out[0] = r; out[1] = g; out[2] = b;
  });
  // The other three faces in plain beds.
  for (const R of [GL_BACK, GL_SIDE_L, GL_SIDE_R]) {
    paintTexels(ctx, R.x, R.y, R.w, R.h, (px, py, out) => {
      const x = (px / R.w) * 14 - 7;
      const y = R.ytop - ((py + 0.5) / R.h) * (R.ytop - BASE);
      const t = beds(x * (R === GL_BACK ? 1 : 0.64), y);
      const k = 0.78 + (rough2(x * 9 + 7, y * 9 + 7) - 0.5) * 0.3 + (rough(x * 24 + 2, y * 24 + 5) - 0.5) * 0.22;
      out[0] = t[0] * k; out[1] = t[1] * k; out[2] = t[2] * k;
    });
  }

  // The profiles themselves, drawn along the true bed: that line is the point of the whole face.
  const X = (x) => ((x - X0) / (X1 - X0)) * W;
  const Y = (y) => ((YTOP - y) / (YTOP - BASE)) * FRONT_H;
  const trace = (x0, x1) => {
    ctx.beginPath();
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const x = mix(x0, x1, i / steps);
      if (i) ctx.lineTo(X(x), Y(frontBed(x))); else ctx.moveTo(X(x), Y(frontBed(x)));
    }
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const uC = glTribX(GL.Z1); const vC = glGorgeX(GL.Z1);
  for (const [x0, x1, color] of [[uC - 1.96, uC + 1.96, '#fff06a'], [vC - 1.2, vC + 1.2, '#fff06a']]) {
    trace(x0, x1);
    ctx.strokeStyle = 'rgba(20,16,12,0.75)';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.2;
    ctx.stroke();
  }
  // What is what, printed on the cut.
  const printed = (text, x, y, maxFt, px, fill = '#fff7d8', shadow = 'rgba(12,10,8,0.9)') => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = fitFont(ctx, text, (maxFt * W) / (X1 - X0), px * (W / 1536));
    ctx.lineWidth = size * 0.2;
    ctx.strokeStyle = shadow;
    ctx.strokeText(text, X(x), Y(y));
    ctx.fillStyle = fill;
    ctx.fillText(text, X(x), Y(y));
  };
  printed('U-SHAPED VALLEY', uC, 1.42, 3.6, 40);
  printed('CARVED BY A GLACIER', uC, 1.06, 3.6, 28);
  printed('ICE', uC, 3.18, 1.4, 42, '#0f3f7a', 'rgba(232,246,252,0.85)');
  printed('V-SHAPED VALLEY', vC, 0.86, 2.9, 32);
  printed('CUT BY A RIVER', vC, 0.56, 2.9, 25);
  printed('BEDROCK', 5.3, 2.0, 2.2, 36);
}

function buildGlacier() {
  const F = glacierFields();
  const { FX, FZ, NX, NZ, X0, X1, Z0, Z1, BASE } = GL;
  const root = new THREE.Group();

  // The land.
  const pos = []; const uvs = []; const idx = [];
  const topAt = (i, j) => bilinear(F.top, (i / NX) * FX, (j / NZ) * FZ);
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      pos.push(mix(X0, X1, i / NX), topAt(i, j), mix(Z0, Z1, j / NZ));
      uvs.push(i / NX, 1 - j / NZ);
    }
  }
  const ring = NX + 1;
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = i + j * ring; const b = a + 1; const c = a + ring; const d = c + 1;
      // Split along the steeper diagonal's shorter drop, so a ridge does not saw.
      const hA = pos[a * 3 + 1]; const hB = pos[b * 3 + 1]; const hC = pos[c * 3 + 1]; const hD = pos[d * 3 + 1];
      if (Math.abs(hA - hD) < Math.abs(hB - hC)) idx.push(a, c, d, a, d, b);
      else idx.push(a, c, b, b, c, d);
    }
  }
  const land = new THREE.BufferGeometry();
  land.setIndex(idx);
  land.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  land.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  land.computeVertexNormals();
  const topMap = canvasTexture(1400, 900, (ctx, w, h) => paintGlacierTop(ctx, w, h, F));
  root.add(mesh(land, standard({ map: topMap, roughness: 0.88, metalness: 0, bumpMap: topMap, bumpScale: 0.9 })));

  // The four cut sides and the floor, sharing the land's own edge vertices so no crack can open.
  const { W, H, FRONT_H, YTOP } = GL_ATLAS;
  const sp = []; const su = [];
  const quad = (a, b, c, d) => {
    for (const v of [a, b, c, a, c, d]) { sp.push(v[0], v[1], v[2]); su.push(v[3], v[4]); }
  };
  const frontV = (x, y) => [(x - X0) / (X1 - X0), 1 - ((YTOP - y) / (YTOP - BASE)) * (FRONT_H / H)];
  const rectV = (R, u, y) => [(R.x + u * R.w) / W, 1 - (R.y + ((R.ytop - y) / (R.ytop - BASE)) * R.h) / H];
  for (let i = 0; i < NX; i++) {
    const x0 = mix(X0, X1, i / NX); const x1 = mix(X0, X1, (i + 1) / NX);
    const y0 = topAt(i, NZ); const y1 = topAt(i + 1, NZ);
    // Front, +Z. Counter-clockwise from outside.
    quad([x0, BASE, Z1, ...frontV(x0, BASE)], [x1, BASE, Z1, ...frontV(x1, BASE)], [x1, y1, Z1, ...frontV(x1, y1)], [x0, y0, Z1, ...frontV(x0, y0)]);
    // Back, -Z.
    const b0 = topAt(i, 0); const b1 = topAt(i + 1, 0);
    quad([x1, BASE, Z0, ...rectV(GL_BACK, 1 - (i + 1) / NX, BASE)], [x0, BASE, Z0, ...rectV(GL_BACK, 1 - i / NX, BASE)], [x0, b0, Z0, ...rectV(GL_BACK, 1 - i / NX, b0)], [x1, b1, Z0, ...rectV(GL_BACK, 1 - (i + 1) / NX, b1)]);
  }
  for (let j = 0; j < NZ; j++) {
    const z0 = mix(Z0, Z1, j / NZ); const z1 = mix(Z0, Z1, (j + 1) / NZ);
    // +X.
    const r0 = topAt(NX, j); const r1 = topAt(NX, j + 1);
    quad([X1, BASE, z1, ...rectV(GL_SIDE_R, 1 - (j + 1) / NZ, BASE)], [X1, BASE, z0, ...rectV(GL_SIDE_R, 1 - j / NZ, BASE)], [X1, r0, z0, ...rectV(GL_SIDE_R, 1 - j / NZ, r0)], [X1, r1, z1, ...rectV(GL_SIDE_R, 1 - (j + 1) / NZ, r1)]);
    // -X.
    const l0 = topAt(0, j); const l1 = topAt(0, j + 1);
    quad([X0, BASE, z0, ...rectV(GL_SIDE_L, j / NZ, BASE)], [X0, BASE, z1, ...rectV(GL_SIDE_L, (j + 1) / NZ, BASE)], [X0, l1, z1, ...rectV(GL_SIDE_L, (j + 1) / NZ, l1)], [X0, l0, z0, ...rectV(GL_SIDE_L, j / NZ, l0)]);
  }
  const sides = new THREE.BufferGeometry();
  sides.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sides.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
  sides.computeVertexNormals();
  const sideMap = canvasTexture(W, H, (ctx) => paintGlacierSides(ctx, F));
  const sideMesh = mesh(sides, standard({ map: sideMap, roughness: 0.92, metalness: 0, emissive: 0xffffff, emissiveMap: sideMap, emissiveIntensity: 0.26 }));
  root.add(sideMesh);

  // The little things standing on the land, each asked where the ground is.
  const heightAt = (x, z) => bilinear(F.top, ((x - X0) / (X1 - X0)) * FX, ((z - Z0) / (Z1 - Z0)) * FZ);
  const scene = [];
  const rng = seededRandom(909);
  // Trees for scale: a few, tiny, only where a tree could stand.
  let trees = 0;
  for (let tries = 0; tries < 1400 && trees < 22; tries++) {
    const x = mix(-6.9, -0.6, rng()); const z = mix(-4.4, 4.45, rng());
    const fx = ((x - X0) / (X1 - X0)) * FX; const fz = ((z - Z0) / (Z1 - Z0)) * FZ;
    const y = heightAt(x, z);
    if (bilinear(F.ice, fx, fz) > -0.1 || bilinear(F.water, fx, fz) > -0.1 || bilinear(F.till, fx, fz) > 0.04) continue;
    if (y < 1.62 || y > 3.05) continue;
    if (bilinear(F.riverD, fx, fz) < 1) continue;
    const slope = Math.hypot(heightAt(x + 0.1, z) - heightAt(x - 0.1, z), heightAt(x, z + 0.1) - heightAt(x, z - 0.1)) / 0.2;
    if (slope > 1.05) continue;
    const size = 0.3 + rng() * 0.2;
    const tone = lin(rng() > 0.5 ? 0x2f6b3c : 0x3c7a42);
    const crown = lathe([
      [0, 0.09], [0.11, 0.09], [0.075, 0.2], [0.09, 0.2], [0.055, 0.31], [0.066, 0.31], [0.0, 0.46],
    ].map(([r, h]) => [r * (size / 0.42) * 1.15, h * (size / 0.42)]), 7);
    crown.translate(x, y - 0.015, z);
    scene.push({ geometry: crown, color: new THREE.Color(tone[0], tone[1], tone[2]).getHex(THREE.LinearSRGBColorSpace) });
    scene.push({ geometry: rod([x, y - 0.03, z], [x, y + size * 0.26, z], size * 0.03, 5, 0), color: 0x4a3423 });
    trees++;
  }
  // Boulders on the terminal moraine, sitting in the rubble.
  for (let i = 0; i < 46; i++) {
    const p = GL_TERMINAL[Math.floor(rng() * (GL_TERMINAL.length - 1))];
    if (Math.abs(p[2] - 161) < 15) continue;
    const a = rng() * TAU; const o = rng() * 0.24;
    const x = p[0] + Math.cos(a) * o; const z = p[1] + Math.sin(a) * o;
    const y = heightAt(x, z);
    const s = 0.045 + rng() ** 2 * 0.08;
    const g = new THREE.IcosahedronGeometry(s, 0);
    g.rotateX(rng() * 3); g.rotateY(rng() * 3);
    g.scale(1, 0.72, 0.9);
    g.translate(x, y + s * 0.2, z);
    const v = 0x7a + Math.floor(rng() * 0x30);
    scene.push({ geometry: g, color: (v << 16) | (v << 8) | Math.floor(v * 0.92) });
  }
  // Three signposts. Each stands right on what it names and faces the front of the block.
  const signs = [
    ['CREVASSE', 1.55, glMainZ(1.55) + 0.05, 0.5],
    ['MORAINE', -4.82, -2.3, 0.42],
    ['MELTWATER', -6.2, 1.05, 0.42],
  ];
  const rowH = 128; const AW = 640;
  const signTex = canvasTexture(AW, rowH * signs.length, (ctx) => {
    signs.forEach(([text], i) => plateCell(ctx, 0, i * rowH, AW, rowH, [text], { ground: '#f6ecd0', ink: '#14120e', edge: '#3a3226' }));
  });
  const plates = [];
  signs.forEach(([, x, z, tall], i) => {
    const y = heightAt(x, z);
    const w = 1.0; const hgt = 0.22;
    scene.push({ geometry: rod([x, y - 0.05, z], [x, y + tall + hgt * 0.5, z], 0.018, 6, 0), color: 0x2b2620 });
    const g = printedPlate(w, hgt, 0.018, uvRect(AW, rowH * signs.length, 0, i * rowH, AW, rowH));
    g.translate(x, y + tall + hgt * 0.4, z + 0.03);
    plates.push({ geometry: g, keepColor: true });
  });
  root.add(mesh(mergeParts(scene), standard({ vertexColors: true, roughness: 0.86, metalness: 0 })));
  root.add(mesh(mergeParts(plates), standard({ map: signTex, roughness: 0.6, metalness: 0, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.14 })));

  // A plinth, in dark walnut with a brass line.
  const plinth = [];
  plinth.push({ geometry: block(X0 - 0.14, 0, Z0 - 0.14, X1 + 0.14, BASE - 0.03, Z1 + 0.14), color: 0x3d2a1e });
  plinth.push({ geometry: block(X0 - 0.07, BASE - 0.04, Z0 - 0.07, X1 + 0.07, BASE + 0.005, Z1 + 0.07), color: 0xb9914b });
  root.add(mesh(mergeParts(plinth), standard({ vertexColors: true, roughness: 0.6, metalness: 0.05 })));
  return root;
}

// ===========================================================================================
// NEWTON'S REFLECTING TELESCOPE
// ===========================================================================================
//
// Twelve times life. The surviving instrument, Newton's second of about 1671, is a tube about 6 inches
// long with a metal mirror about 1.3 inches across. Built here with its axis along local +Z and then
// tilted up, the open end leading, so a program's "move forward" takes it where it is looking.
//
// The light really goes the way the rods say. Each rod is computed: parallel rays come in through the
// open end, reflect off a concave mirror of the right focal length to converge, are turned 90 degrees
// by a flat mirror at 45 degrees, and come to a focus in the eyepiece. The eyepiece rises from the
// tube's TOP because that puts the whole light path in one plane, square to the window in the +X side.

const SCOPE = {
  L: 5.9, RO: 0.86, RI: 0.79,            // the tube
  WIN0: 0.62, WIN1: 5.32, WINA: 58 * DEG, // the window, along the tube and either side of +X
  MIRROR_Z: 0.34, MIRROR_R: 0.68,         // the primary's rim plane, and its radius
  FOCAL: 5.36,                            // primary to focus, measured along the light
  DIAG_Z: 4.5,                            // where the axis meets the flat mirror
  TILT: 22 * DEG, BALL_Y: 2.34, MID: 2.75,
  BALL_R: 0.6, HANG: 1.86,                // the ball's centre, and how far below the tube's axis it hangs
};

// The path of one ray, in the tube's own frame. y0 is its height above the axis as it enters.
export function reflectorRay(y0) {
  const { MIRROR_Z, FOCAL, DIAG_Z, L } = SCOPE;
  const R = FOCAL * 2;
  // Where it strikes the concave sphere, whose centre is on the axis in front of the mirror.
  const vertexZ = MIRROR_Z;
  const zs = vertexZ + R - Math.sqrt(R * R - y0 * y0);
  const strike = [0, y0, zs];
  // The true reflected direction off the sphere: this is what makes the focus a measured thing.
  const n = V(0, -y0, vertexZ + R - zs).normalize();
  const dIn = V(0, 0, -1);
  const dOut = dIn.clone().sub(n.clone().multiplyScalar(2 * dIn.dot(n)));
  // The flat mirror is the plane y - (z - DIAG_Z) = 0 tilted 45 degrees, so that light travelling
  // back up the tube (+Z) leaves straight up (+Y).
  const t = (DIAG_Z + 0 - strike[2] + strike[1]) / (dOut.z - dOut.y);
  const hit = [0, strike[1] + dOut.y * t, strike[2] + dOut.z * t];
  // Reflect across that 45 degree plane: (y, z) directions swap.
  const d2 = V(0, dOut.z, dOut.y);
  const remaining = Math.max(0.1, FOCAL - t);
  const focus = [0, hit[1] + d2.y * remaining, hit[2] + d2.z * remaining];
  return { entry: [0, y0, L + 0.55], strike, hit, d2, focus };
}

function paintScopeSkin(ctx, w, h) {
  // Left three quarters: pebbled dark leather. Right quarter: the card's raw edge and the dull black inside.
  const rough = latticeNoise(501, 64);
  const fine = latticeNoise(502, 64);
  const lw = Math.floor(w * 0.75);
  paintTexels(ctx, 0, 0, w, h, (x, y, out) => {
    if (x < lw) {
      const u = x / lw * 28; const v = y / h * 14;
      const cell = fine(u * 3.3, v * 3.3);
      const pore = 1 - sstep(Math.abs(cell - 0.5), 0, 0.09);
      const k = 50 + (rough(u, v) - 0.5) * 9 + (cell - 0.5) * 14 - pore * 7;
      out[0] = k * 1.26; out[1] = k * 0.88; out[2] = k * 0.6;
    } else if (y < h / 2) {
      const k = 158 + (rough(x * 0.08, y * 0.5) - 0.5) * 34;
      out[0] = k * 1.03; out[1] = k * 0.92; out[2] = k * 0.74;
    } else {
      const k = 74 + (rough(x * 0.1, y * 0.1) - 0.5) * 14;
      out[0] = k * 1.08; out[1] = k * 0.94; out[2] = k * 0.8;
    }
  });
}

function paintWoodGrain(ctx, w, h, seed = 511) {
  const rough = latticeNoise(seed, 64);
  const fine = latticeNoise(seed + 1, 64);
  paintTexels(ctx, 0, 0, w, h, (x, y, out) => {
    const u = x / w; const v = y / h;
    const warp = (rough(u * 5, v * 2) - 0.5) * 1.6;
    const ring = Math.sin((u * 9 + warp * 1.4) * TAU * 0.5);
    const grain = (fine(u * 44, v * 2.2) - 0.5) * 0.42 + (fine(u * 170, v * 9) - 0.5) * 0.26;
    const k = clamp01(0.84 + ring * 0.05 + grain * 0.5);
    out[0] = 255 * k; out[1] = 240 * k; out[2] = 222 * k;
  });
}

function buildReflector() {
  const S = SCOPE;
  const root = new THREE.Group();

  // From the tube's frame into the model's. The whole tube turns about the ball's centre, which is
  // what a ball mount does, so the point (0, -HANG, MID) in the tube's frame lands on the ball.
  const toWorld = new THREE.Matrix4()
    .makeTranslation(0, S.BALL_Y, 0)
    .multiply(new THREE.Matrix4().makeRotationX(-S.TILT))
    .multiply(new THREE.Matrix4().makeTranslation(0, S.HANG, -S.MID));
  const world = (g) => { g.applyMatrix4(toWorld); return g; };

  const SKIN_U = 0.75;
  const skin = [];
  // Outer: leather. Inner: dull black. Edges: the card's raw colour.
  const segment = (a0, a1, z0, z1, nA) => {
    const P = (a, z, r) => [Math.cos(a) * r, Math.sin(a) * r, z];
    const pos = []; const uv = [];
    const put = (p, u, v) => { pos.push(p[0], p[1], p[2]); uv.push(u, v); };
    const quad = (a, b, c, d) => { for (const q of [a, b, c, a, c, d]) put(q[0], q[1], q[2]); };
    const edgeUV = [0.87, 0.75]; const inUV = [0.87, 0.25];
    for (let i = 0; i < nA; i++) {
      const aA = mix(a0, a1, i / nA); const aB = mix(a0, a1, (i + 1) / nA);
      const uA = (aA / TAU) * SKIN_U; const uB = (aB / TAU) * SKIN_U;
      const v0 = z0 / S.L; const v1 = z1 / S.L;
      quad([P(aA, z0, S.RO), uA, v0], [P(aB, z0, S.RO), uB, v0], [P(aB, z1, S.RO), uB, v1], [P(aA, z1, S.RO), uA, v1]);
      quad([P(aB, z0, S.RI), ...inUV], [P(aA, z0, S.RI), ...inUV], [P(aA, z1, S.RI), ...inUV], [P(aB, z1, S.RI), ...inUV]);
      quad([P(aB, z0, S.RO), ...edgeUV], [P(aA, z0, S.RO), ...edgeUV], [P(aA, z0, S.RI), ...edgeUV], [P(aB, z0, S.RI), ...edgeUV]);
      quad([P(aA, z1, S.RO), ...edgeUV], [P(aB, z1, S.RO), ...edgeUV], [P(aB, z1, S.RI), ...edgeUV], [P(aA, z1, S.RI), ...edgeUV]);
    }
    const open = a1 - a0 < TAU - 1e-4;
    if (open) {
      quad([P(a0, z0, S.RI), ...edgeUV], [P(a0, z0, S.RO), ...edgeUV], [P(a0, z1, S.RO), ...edgeUV], [P(a0, z1, S.RI), ...edgeUV]);
      quad([P(a1, z0, S.RO), ...edgeUV], [P(a1, z0, S.RI), ...edgeUV], [P(a1, z1, S.RI), ...edgeUV], [P(a1, z1, S.RO), ...edgeUV]);
    }
    return soup(pos, uv, 35);
  };
  skin.push({ geometry: world(segment(0, TAU, 0, S.WIN0, 72)), keepColor: true });
  skin.push({ geometry: world(segment(0, TAU, S.WIN1, S.L, 72)), keepColor: true });
  skin.push({ geometry: world(segment(S.WINA, TAU - S.WINA, S.WIN0, S.WIN1, 52)), keepColor: true });
  // Close the back of the tube with a disc, inside the rear ring.
  const back = lathe([[0, 0], [S.RO, 0], [S.RO, 0.03], [0, 0.03]], 72);
  back.rotateX(Math.PI / 2); // +Y to +Z
  const backUv = back.attributes.uv; for (let i = 0; i < backUv.count; i++) backUv.setXY(i, 0.87, 0.25);
  skin.push({ geometry: world(back.translate(0, 0, -0.005)), keepColor: true });
  const skinMap = canvasTexture(1024, 512, (ctx, w, h) => paintScopeSkin(ctx, w, h));
  const tubeMesh = mesh(mergeParts(skin), standard({ map: skinMap, roughness: 0.74, metalness: 0, bumpMap: skinMap, bumpScale: 0.3 }));
  root.add(tubeMesh);

  // Metal: bright speculum for the mirrors, brass for everything that holds them. Metalness stays
  // low, since there is no environment map, and the polish is painted by the surface's own normal.
  const speculum = 0xdcd6c6;
  const brass = 0xbf9a52;
  const metal = [];
  const mirrorLathe = (profile, seg, color, lift) => {
    const g = lathe(profile, seg);
    g.rotateX(Math.PI / 2);
    return polished(world(g), color, lift);
  };
  // The primary: a real concave face in a brass cell. Its true sag is under a quarter of an inch at
  // this scale, so the curve is drawn about ten times deeper, or it would read as a flat disc.
  const R = S.FOCAL * 2;
  const sagDrawn = (S.MIRROR_R * S.MIRROR_R) / (2 * R) * 10;
  const concave = [];
  for (let i = 0; i <= 14; i++) {
    const r = S.MIRROR_R * (1 - i / 14);
    concave.push([r, S.MIRROR_Z + sagDrawn * (r / S.MIRROR_R) ** 2]);
  }
  const lathed = mirrorLathe([
    [0, S.MIRROR_Z - 0.26], [S.MIRROR_R + 0.08, S.MIRROR_Z - 0.26], [S.MIRROR_R + 0.08, S.MIRROR_Z + sagDrawn + 0.05],
    [S.MIRROR_R + 0.005, S.MIRROR_Z + sagDrawn + 0.05], ...concave,
  ], 56, speculum, 1.1);
  // The rim and back of the cell are brass; the face is speculum, told apart by being inside the rim.
  {
    const p = lathed.geometry.attributes.position; const n = lathed.geometry.attributes.normal; const c = lathed.geometry.attributes.color;
    const inv = toWorld.clone().invert();
    const v = V();
    const [br, bg, bb] = lin(brass);
    const [sr, sg, sb] = lin(speculum);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(inv);
      const rad = Math.hypot(v.x, v.y);
      if (!(rad < S.MIRROR_R + 0.002 && v.z > S.MIRROR_Z - 0.02)) {
        const k = 0.7;
        c.setXYZ(i, br * k + 0.02 * (n.getY(i) + 1), bg * k + 0.02 * (n.getY(i) + 1), bb * k);
      } else {
        // A mirror face: bright, with the soft ring a slightly hollow metal surface shows.
        const ring = 0.86 + 0.14 * Math.cos(rad * 6.5);
        c.setXYZ(i, sr * ring, sg * ring, sb * ring);
      }
    }
  }
  metal.push(lathed);

  // The flat: an elliptical mirror at 45 degrees on its slim arm.
  const yR = reflectorRay(0.5);
  const diagRadius = Math.abs(yR.hit[1]) * 1.32 + 0.06;
  {
    // A short flat cylinder whose +Y face looks back down the tube and up.
    const disc = lathe([[0, -0.05], [diagRadius, -0.05], [diagRadius + 0.012, -0.012], [diagRadius, 0], [0, 0]], 30);
    disc.scale(1, 1, 1.42);
    // Stretch along the tilt direction so it is a true ellipse in the plane of the mirror.
    disc.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 4));
    disc.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, S.DIAG_Z));
    const part = polished(world(disc), speculum, 1.2);
    const c = disc.attributes.color; const n = disc.attributes.normal;
    const faceNormal = V(0, 1, -1).normalize().transformDirection(toWorld);
    const [sr, sg, sb] = lin(speculum);
    for (let i = 0; i < c.count; i++) {
      const dot = n.getX(i) * faceNormal.x + n.getY(i) * faceNormal.y + n.getZ(i) * faceNormal.z;
      if (dot > 0.9) c.setXYZ(i, sr * 1.08, sg * 1.08, sb * 1.08);
      else { const k = 0.5; c.setXYZ(i, sr * k, sg * k * 0.8, sb * k * 0.44); }
    }
    metal.push(part);
  }
  // The arm, from the mirror's back up to the tube's wall, clear of the rising light.
  const backOf = [0, -0.035, S.DIAG_Z + 0.035];
  const armTop = [0, S.RI + 0.02, S.DIAG_Z + 0.62];
  metal.push(polished(world(rod(backOf, armTop, 0.028, 8, 1)), brass, 0.95));

  // The eyepiece: a saddle on the tube, a sleeve, a turned brass barrel and a small eye lens.
  const focus = reflectorRay(0.5).focus;
  const eyeZ = S.DIAG_Z;
  const eyeTop = focus[1] + 0.32;
  {
    const prof = [
      [0, S.RO - 0.06], [0.32, S.RO - 0.06], [0.32, S.RO + 0.08], [0.24, S.RO + 0.12], [0.2, S.RO + 0.15], [0.2, S.RO + 0.34],
      [0.235, S.RO + 0.36], [0.235, S.RO + 0.42], [0.17, S.RO + 0.45], [0.17, eyeTop - 0.1], [0.215, eyeTop - 0.07], [0.215, eyeTop], [0.15, eyeTop + 0.012], [0.135, eyeTop - 0.012], [0, eyeTop - 0.02],
    ];
    const barrel = lathe(prof, 26);
    barrel.translate(0, 0, eyeZ);
    metal.push(polished(world(barrel), brass, 1));
  }
  // The rear knob that adjusts the primary, a turned boss.
  {
    const knob = lathe([[0, -0.28], [0.16, -0.28], [0.17, -0.2], [0.1, -0.16], [0.075, -0.1], [0.11, -0.03], [0.11, 0.02], [0, 0.02]], 22);
    knob.rotateX(Math.PI / 2);
    metal.push(polished(world(knob), brass, 1));
  }
  // Fine brass bands at both ends of the tube.
  for (const [z0, z1] of [[-0.02, 0.1], [S.L - 0.14, S.L + 0.014]]) {
    const band = lathe([[S.RO + 0.02, z0], [S.RO + 0.02, z1], [S.RI - 0.012, z1], [S.RI - 0.012, z0], [S.RO + 0.02, z0]], 72);
    band.rotateX(Math.PI / 2);
    metal.push(polished(outward(world(band)), brass, 1));
  }
  root.add(mesh(mergeParts(metal), standard({ vertexColors: true, roughness: 0.34, metalness: 0.35, emissive: 0x2a2620, emissiveIntensity: 1 })));

  // The light itself: thin rods, unlit, one colour per leg so a student can follow it round.
  const rays = [];
  const IN = 0xffe14a; const BACK = 0xff9a1f; const UP_RAY = 0xff3e24;
  const rayRod = (a, b, color, r = 0.019) => {
    rays.push({ geometry: world(rod(a, b, r, 7, 1)), color });
  };
  const arrowAt = (a, b, color, along = 0.62) => {
    const A = V(...a); const B = V(...b);
    const d = B.clone().sub(A).normalize();
    const tip = A.clone().lerp(B, along);
    const g = lathe([[0, -0.13], [0.058, -0.13], [0, 0.03]], 10);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d);
    g.applyMatrix4(new THREE.Matrix4().compose(tip, q, V(1, 1, 1)));
    rays.push({ geometry: world(g), color });
  };
  for (const y0 of [0.5, -0.5]) {
    const ray = reflectorRay(y0);
    rayRod(ray.entry, ray.strike, IN);
    arrowAt(ray.entry, ray.strike, IN, 0.24);
    arrowAt(ray.entry, ray.strike, IN, 0.68);
    rayRod(ray.strike, ray.hit, BACK);
    arrowAt(ray.strike, ray.hit, BACK, 0.5);
    rayRod(ray.hit, ray.focus, UP_RAY);
    arrowAt(ray.hit, ray.focus, UP_RAY, 0.45);
    if (y0 > 0) {
      // Out through the eye lens, on past the top of the eyepiece.
      const top = [0, eyeTop + 0.46, ray.focus[2]];
      rays.push({ geometry: world(rod([0, ray.focus[1], ray.focus[2]], top, 0.022, 7, 1)), color: UP_RAY });
      arrowAt([0, eyeTop, ray.focus[2]], top, UP_RAY, 0.86);
    }
  }
  const rayMesh = mesh(mergeParts(rays), unlit());
  rayMesh.castShadow = false;
  rayMesh.receiveShadow = false;
  root.add(rayMesh);

  // The ball-and-socket and the base, in turned wood. The cup is the ball's own radius and comes up
  // past its equator, so the ball is held but free, and there is no gap to see daylight through.
  const wood = [];
  const CY = S.BALL_Y;
  const BR = S.BALL_R;
  const ball = new THREE.SphereGeometry(BR, 44, 30);
  ball.translate(0, CY, 0);
  wood.push({ geometry: ball, color: 0xb98a58 });
  const bowl = [];
  for (let i = 0; i <= 12; i++) {
    const a = mix(0.2, -Math.PI / 2, i / 12);
    bowl.push([(BR + 0.006) * Math.cos(a), CY + (BR + 0.006) * Math.sin(a)]);
  }
  bowl[12][0] = 0;
  wood.push({
    geometry: lathe([
      [0, 0], [1.34, 0], [1.34, 0.08], [1.3, 0.13], [1.3, 0.42], [1.34, 0.47], [1.34, 0.56], [1.22, 0.62], [0.9, 0.66],
      [0.7, 0.76], [0.54, 0.98], [0.46, 1.2], [0.46, 1.26], [0.54, 1.32], [0.68, CY - 0.5], [0.78, CY - 0.18], [0.78, CY + 0.08], [0.76, CY + BR * 0.2 + 0.03],
      [(BR + 0.006) * Math.cos(0.2) + 0.03, CY + (BR + 0.006) * Math.sin(0.2) + 0.03],
      ...bowl,
    ], 64),
    color: 0xa87748,
  });
  // A saddle hugging the tube's underside, in the tube's frame. It stops short of the window's edge
  // on the +X side, and its top is sunk a hair into the leather so no daylight shows along it.
  const SAD_X = 0.44; const SAD_Z = 0.74; const SAD_BOT = -S.RO - 0.2;
  const saddle = gridSolid(14, 2,
    (i, j) => {
      const x = mix(-SAD_X, SAD_X, i / 14);
      return [x, -Math.sqrt(S.RO * S.RO - x * x) + 0.012, S.MID + mix(-SAD_Z, SAD_Z, j / 2)];
    },
    (i, j) => {
      const x = mix(-SAD_X - 0.02, SAD_X + 0.02, i / 14);
      return [x, SAD_BOT, S.MID + mix(-SAD_Z - 0.04, SAD_Z + 0.04, j / 2)];
    }, { crease: 40 });
  wood.push({ geometry: world(saddle), color: 0x8a5f36 });
  // The neck, running square to the tube from the saddle into the ball.
  const neck = lathe([[0, -S.HANG + BR * 0.6], [0.2, -S.HANG + BR * 0.6], [0.24, -S.HANG + BR * 1.02], [0.2, -S.HANG + BR * 1.14], [0.19, SAD_BOT - 0.2], [0.31, SAD_BOT - 0.1], [0.36, SAD_BOT + 0.02], [0, SAD_BOT + 0.02]], 24);
  neck.translate(0, 0, S.MID);
  wood.push({ geometry: world(neck), color: 0xa87748 });

  // Brass: straps that run round the tube everywhere but across the window, a clamp ring, its screw.
  const brassBits = [];
  for (const zOff of [-0.56, 0.56]) {
    const a0 = S.WINA + 0.015; const a1 = TAU - S.WINA - 0.015;
    const pointOn = (a, z, r) => [Math.cos(a) * r, Math.sin(a) * r, S.MID + zOff + z];
    const strap = gridSolid(44, 1,
      (i, j) => pointOn(mix(a0, a1, i / 44), mix(-0.05, 0.05, j), S.RO + 0.03),
      (i, j) => pointOn(mix(a0, a1, i / 44), mix(-0.05, 0.05, j), S.RO - 0.01), { crease: 30 });
    brassBits.push(polished(world(strap), brass, 0.9));
  }
  const ringY = CY + BR * 0.2 - 0.1;
  brassBits.push(polished(lathe([[0.74, ringY - 0.1], [0.82, ringY - 0.1], [0.84, ringY - 0.03], [0.84, ringY + 0.03], [0.82, ringY + 0.1], [0.74, ringY + 0.1]], 56), brass, 1));
  brassBits.push(polished(rod([0.8, ringY, 0.12], [1.12, ringY, 0.2], 0.035, 8, 1), brass, 1));
  brassBits.push(polished(new THREE.SphereGeometry(0.075, 14, 10).translate(1.14, ringY, 0.205), brass, 1.1));
  root.add(mesh(mergeParts(brassBits), standard({ vertexColors: true, roughness: 0.38, metalness: 0.3 })));

  // Plates on the inside of the far wall, curved to it, square to anyone looking in at the window.
  // From the +X side +Z is on the left, so the type runs from the open end toward the closed end.
  const plateText = ['BIG CURVED MIRROR', 'SMALL FLAT MIRROR', 'LIGHT COMES IN'];
  const PW = 768; const PH = 112;
  const plateMap = canvasTexture(PW, PH * plateText.length, (ctx) => {
    plateText.forEach((text, i) => plateCell(ctx, 0, i * PH, PW, PH, [text], { ground: '#efe4c4', ink: '#201a10', edge: '#7a6438' }));
  });
  const plateParts = [];
  [[1.42, 0, 1.3], [3.3, 1, 1.3], [4.72, 2, 1.0]].forEach(([zc, row, len]) => {
    const [u0, v0, u1, v1] = uvRect(PW, PH * plateText.length, 0, row * PH, PW, PH);
    const hgt = 0.19; const yc = row === 0 ? 0 : (row === 1 ? -0.42 : -0.26);
    const on = (i, j, r) => {
      const y = yc + (j / 3 - 0.5) * hgt;
      return [-Math.sqrt(r * r - y * y), y, zc + (0.5 - i / 2) * len];
    };
    const g = gridSolid(2, 3,
      (i, j) => on(i, j, S.RI - 0.012),
      (i, j) => on(i, j, S.RI + 0.015),
      { uvTop: (i, j) => [mix(u0, u1, i / 2), mix(v0, v1, j / 3)], uvBottom: () => [u0 + 0.002, v0 + 0.002], crease: 22 });
    plateParts.push({ geometry: world(g), keepColor: true });
  });
  root.add(mesh(mergeParts(plateParts), standard({ map: plateMap, roughness: 0.62, metalness: 0, emissive: 0xffffff, emissiveMap: plateMap, emissiveIntensity: 0.42 })));

  const grain = canvasTexture(512, 512, (ctx, w, h) => paintWoodGrain(ctx, w, h, 511));
  wrapRepeat(grain, 2, 2);
  root.add(mesh(mergeParts(wood), standard({ vertexColors: true, map: grain, roughness: 0.56, metalness: 0, bumpMap: dataTexture(grain.clone()), bumpScale: 0.45 })));
  return root;
}

// ===========================================================================================
// THE HYDRAULIC LIFT
// ===========================================================================================
//
// The one number is the ratio of the diameters, and everything else is worked out from it. Pascal's
// principle: a liquid at rest in one connected body has one pressure at any one height. So 1 lb on
// the small piston and 16 lb on the wide one balance only when their undersides are at the same
// height, which is why the two pistons, and the two columns of oil under them, are the same number.

const LIFT_BOARD_Z = -0.24;
export const LIFT = {
  D_SMALL: 0.5,                // bore of the narrow cylinder, feet (6 inches)
  RATIO: 4,                    // the wide bore's diameter is exactly this many times the narrow one's
  WALL: 0.03,
  X_SMALL: -2.5, X_WIDE: 1.75,
  BENCH_TOP: 1.86,
  FOOT_TOP: 2.26,
  PISTON_Y: 3.98,              // underside of both pistons
  PISTON_H: 0.2,
  GLASS_TOP: 5.82,
  LB_SMALL: 1, LB_WIDE: 16,
  DENSITY_VOL: 0.0518,         // the volume in cubic feet of the 1 lb weight, as drawn
};
LIFT.D_WIDE = LIFT.D_SMALL * LIFT.RATIO;
LIFT.AREA_SMALL_SQIN = Math.PI * ((LIFT.D_SMALL * 12) / 2) ** 2;
LIFT.AREA_WIDE_SQIN = Math.PI * ((LIFT.D_WIDE * 12) / 2) ** 2;

function buildHydraulicLift() {
  const L = LIFT;
  const areaRatio = (L.D_WIDE / L.D_SMALL) ** 2;
  if (Math.abs(L.D_WIDE / L.D_SMALL - 4) > 1e-9) throw new Error('hydraulic-lift: the wide bore must be exactly 4 times the narrow one');
  if (Math.abs(areaRatio - 16) > 1e-9) throw new Error('hydraulic-lift: the areas must differ by exactly 16 times');
  if (Math.abs(L.LB_WIDE / L.LB_SMALL - areaRatio) > 1e-9) throw new Error('hydraulic-lift: the two weights do not balance on these areas');
  const pSmall = L.LB_SMALL / L.AREA_SMALL_SQIN;
  const pWide = L.LB_WIDE / L.AREA_WIDE_SQIN;
  if (Math.abs(pSmall - pWide) > 1e-9) throw new Error('hydraulic-lift: the pressures under the two pistons differ');
  const root = new THREE.Group();

  const rS = L.D_SMALL / 2; const rW = L.D_WIDE / 2;

  // Weights of one metal, so the sizes tell the truth: 16 times the weight is 16 times the volume.
  const volS = L.DENSITY_VOL; const volW = volS * (L.LB_WIDE / L.LB_SMALL);
  const dWsmall = 0.34; const dWwide = 1.46;
  const hWsmall = volS / (Math.PI * (dWsmall / 2) ** 2);
  const hWwide = volW / (Math.PI * (dWwide / 2) ** 2);

  // The solid things inside the glass and everything else opaque with its colour in its vertices.
  const opaque = [];
  const steel = 0x9aa0a6; const brass = 0xc19a50; const seal = 0x201c1a; const iron = 0x3a3d44;

  // Oil: one connected body, through the pipe and up both cylinders to the same height. Coloured by
  // height, so a student can see it is the same oil in both.
  const oilColor = (y) => {
    const t = clamp01((y - L.FOOT_TOP) / (L.PISTON_Y - L.FOOT_TOP));
    return [mix(0.5, 0.92, t), mix(0.12, 0.36, t), mix(0.005, 0.03, t)];
  };
  const tintOil = (g) => {
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const c = oilColor(p.getY(i));
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return { geometry: g, keepColor: true };
  };
  const oilColumn = (x, r) => {
    const rows = 10;
    const prof = [[0, L.FOOT_TOP - 0.04]];
    for (let i = 0; i <= rows; i++) prof.push([r - 0.004, mix(L.FOOT_TOP - 0.04, L.PISTON_Y - 0.004, i / rows)]);
    prof.push([0, L.PISTON_Y - 0.004]);
    return lathe(prof, r > 0.4 ? 64 : 32).translate(x, 0, 0);
  };
  opaque.push(tintOil(oilColumn(L.X_SMALL, rS)));
  opaque.push(tintOil(oilColumn(L.X_WIDE, rW)));
  const pipeY = L.BENCH_TOP + 0.2;
  const pipeR = 0.1; const pipeZ = 0;
  const pipeX0 = L.X_SMALL; const pipeX1 = L.X_WIDE;
  opaque.push(tintOil(rod([pipeX0, pipeY, pipeZ], [pipeX1, pipeY, pipeZ], pipeR - 0.012, 16, 0)));

  // The pistons: a real head with two dark seal rings, the top dished to seat its weight.
  const piston = (x, r) => {
    const y0 = L.PISTON_Y; const H = L.PISTON_H;
    const prof = [
      [0, y0], [r - 0.003, y0], [r - 0.003, y0 + H * 0.2], [r - 0.012, y0 + H * 0.2], [r - 0.012, y0 + H * 0.34], [r - 0.003, y0 + H * 0.34],
      [r - 0.003, y0 + H * 0.56], [r - 0.012, y0 + H * 0.56], [r - 0.012, y0 + H * 0.7], [r - 0.003, y0 + H * 0.7], [r - 0.003, y0 + H],
      [r * 0.92, y0 + H], [r * 0.86, y0 + H * 1.02], [0, y0 + H * 1.02],
    ];
    const head = lathe(prof, r > 0.4 ? 72 : 36);
    head.translate(x, 0, 0);
    opaque.push(polished(head, steel, 0.96));
    for (const f of [0.27, 0.63]) {
      const ring = lathe([[r - 0.012, y0 + H * (f - 0.08)], [r - 0.002, y0 + H * (f - 0.06)], [r - 0.002, y0 + H * (f + 0.06)], [r - 0.012, y0 + H * (f + 0.08)]], r > 0.4 ? 72 : 36);
      ring.translate(x, 0, 0);
      opaque.push({ geometry: outward(ring), color: seal });
    }
  };
  piston(L.X_SMALL, rS);
  piston(L.X_WIDE, rW);

  // The weights, in cast iron, standing on their pistons. A short lifting knob on each.
  const pTop = L.PISTON_Y + L.PISTON_H * 1.02;
  const weight = (x, d, h, knob) => {
    const r = d / 2;
    const chamfer = Math.min(0.03, r * 0.14);
    const body = lathe([
      [0, pTop], [r - chamfer, pTop], [r, pTop + chamfer], [r, pTop + h - chamfer], [r - chamfer, pTop + h],
      [knob * 0.7, pTop + h], [knob * 0.45, pTop + h + knob * 0.5], [knob * 0.9, pTop + h + knob * 1.1], [knob * 0.45, pTop + h + knob * 1.65], [0, pTop + h + knob * 1.7],
    ], r > 0.4 ? 64 : 32);
    body.translate(x, 0, 0);
    opaque.push(polished(body, iron, 1.05));
  };
  weight(L.X_SMALL, dWsmall, hWsmall, 0.05);
  weight(L.X_WIDE, dWwide, hWwide, 0.13);

  // Brass feet the glass stands in, with the pipe plumbed into them, and a rim round each glass top.
  const foot = (x, r) => {
    const R = r + L.WALL;
    const prof = [
      [0, L.BENCH_TOP], [R + 0.18, L.BENCH_TOP], [R + 0.18, L.BENCH_TOP + 0.05], [R + 0.13, L.BENCH_TOP + 0.09], [R + 0.13, L.FOOT_TOP - 0.05],
      [R + 0.09, L.FOOT_TOP - 0.01], [R + 0.075, L.FOOT_TOP + 0.05], [R + 0.004, L.FOOT_TOP + 0.05], [R + 0.004, L.FOOT_TOP], [r - 0.02, L.FOOT_TOP], [0, L.FOOT_TOP - 0.05],
    ];
    const g = lathe(prof, r > 0.4 ? 72 : 40);
    g.translate(x, 0, 0);
    opaque.push(polished(g, brass, 1));
    const rim = lathe([[R - 0.008, L.GLASS_TOP - 0.05], [R + 0.03, L.GLASS_TOP - 0.05], [R + 0.05, L.GLASS_TOP - 0.02], [R + 0.05, L.GLASS_TOP + 0.015], [R + 0.03, L.GLASS_TOP + 0.04], [r + 0.006, L.GLASS_TOP + 0.04], [r + 0.006, L.GLASS_TOP - 0.01], [R - 0.008, L.GLASS_TOP - 0.01]], r > 0.4 ? 72 : 40);
    rim.translate(x, 0, 0);
    opaque.push(polished(outward(rim), brass, 1));
  };
  foot(L.X_SMALL, rS);
  foot(L.X_WIDE, rW);
  // Glands where the pipe enters each foot.
  for (const x of [L.X_SMALL + rS + L.WALL + 0.13, L.X_WIDE - rW - L.WALL - 0.13]) {
    const g = rod([x - 0.08, pipeY, 0], [x + 0.08, pipeY, 0], pipeR + 0.035, 18, 0);
    opaque.push(polished(g, brass, 0.92));
  }

  // The valve, half way along the pipe, open: its handle lies along the pipe, which is the convention.
  const vX = (L.X_SMALL + rS + L.X_WIDE - rW) / 2 - 0.08;
  {
    const body = new THREE.SphereGeometry(0.2, 28, 20);
    body.scale(1.15, 1, 1);
    body.translate(vX, pipeY, 0);
    opaque.push(polished(body, brass, 1));
    for (const sx of [-1, 1]) opaque.push(polished(rod([vX + sx * 0.17, pipeY, 0], [vX + sx * 0.32, pipeY, 0], 0.135, 18, 0), brass, 0.92));
    opaque.push(polished(rod([vX, pipeY + 0.14, 0], [vX, pipeY + 0.34, 0], 0.05, 12, 1), steel, 1));
    opaque.push({ geometry: rod([vX - 0.34, pipeY + 0.35, 0], [vX + 0.34, pipeY + 0.35, 0], 0.042, 10, 2), color: 0xb5241c });
    opaque.push(polished(new THREE.SphereGeometry(0.07, 14, 10).translate(vX, pipeY + 0.35, 0), steel, 1));
    opaque.push(polished(rod([vX, pipeY + 0.35, -0.04], [vX, pipeY + 0.64, -0.04], 0.018, 8, 1), steel, 1));
  }

  // The arrows, standing beside each cylinder in the plane the student reads from: a long red one
  // going down, a short green one going up. Their lengths are not to the 16 to 1 scale, and the
  // plates say so in numbers.
  const arrowZ = 0.22;
  const down = 0xc8281e; const up = 0x1f9a43;
  const armS = L.X_SMALL - rS - 0.42; const armW = L.X_WIDE + rW + 0.42;
  opaque.push({ geometry: flatArrow([armS, 5.2, arrowZ], [armS, 3.3, arrowZ], 0.15, 0.05, [0, 0, 1], 0.3), color: down });
  opaque.push({ geometry: flatArrow([armW, 3.72, arrowZ], [armW, 4.5, arrowZ], 0.17, 0.05, [0, 0, 1], 0.32), color: up });
  // Each arrow and its plate stand on a slim post, so nothing hangs in the air.
  for (const [x, top] of [[armS, 5.2], [armW, 4.42]]) {
    opaque.push(polished(rod([x, L.BENCH_TOP - 0.01, arrowZ - 0.07], [x, top, arrowZ - 0.07], 0.028, 10, 1), brass, 0.95));
    opaque.push(polished(rod([x, top - 0.1, arrowZ - 0.07], [x, top - 0.1, arrowZ - 0.02], 0.024, 8, 0), brass, 0.95));
    opaque.push(polished(lathe([[0, L.BENCH_TOP], [0.11, L.BENCH_TOP], [0.11, L.BENCH_TOP + 0.03], [0.05, L.BENCH_TOP + 0.08], [0, L.BENCH_TOP + 0.09]], 18).translate(x, 0, arrowZ - 0.07), brass, 0.95));
  }

  root.add(mesh(mergeParts(opaque), standard({ vertexColors: true, roughness: 0.42, metalness: 0.22 })));

  // The glass: the one transparent mesh. Two closed tubes and the pipe, wall and all.
  const glass = [];
  const tubeOf = (x, r) => {
    const R = r + L.WALL;
    const prof = [[r + 0.002, L.FOOT_TOP], [R, L.FOOT_TOP], [R, L.GLASS_TOP], [r + 0.002, L.GLASS_TOP]];
    const g = lathe(prof, r > 0.4 ? 72 : 36);
    g.translate(x, 0, 0);
    return outward(g);
  };
  glass.push({ geometry: tubeOf(L.X_SMALL, rS), color: 0xdbeaf2 });
  glass.push({ geometry: tubeOf(L.X_WIDE, rW), color: 0xdbeaf2 });
  glass.push({ geometry: rod([pipeX0 + rS + L.WALL + 0.13, pipeY, 0], [pipeX1 - rW - L.WALL - 0.13, pipeY, 0], pipeR, 18, 0), color: 0xdbeaf2 });
  const glassMesh = mesh(mergeParts(glass), standard({
    vertexColors: true, transparent: true, opacity: 0.25, roughness: 0.08, metalness: 0, depthWrite: false,
  }));
  glassMesh.castShadow = false;
  glassMesh.renderOrder = 2;
  root.add(glassMesh);

  // The bench, in worked timber.
  const wood = [];
  const BW = 4.0; const BD = 1.56; const T0 = L.BENCH_TOP - 0.2;
  const planks = 5;
  for (let i = 0; i < planks; i++) {
    const z0 = mix(-BD, BD, i / planks); const z1 = mix(-BD, BD, (i + 1) / planks);
    const g = block(-BW, T0, z0 + 0.006, BW, L.BENCH_TOP, z1 - 0.006);
    const uv = g.attributes.uv; const p = g.attributes.position;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (p.getZ(k) + p.getY(k)) * 0.3 + i * 0.37, p.getX(k) * 0.09 + i * 0.21);
    wood.push({ geometry: g, color: i % 2 ? 0xb07e4c : 0xa4733f });
  }
  // A dark line under the planks fills their joints.
  wood.push({ geometry: block(-BW + 0.03, T0 - 0.02, -BD + 0.03, BW - 0.03, L.BENCH_TOP - 0.05, BD - 0.03), color: 0x3e2a18 });
  const uvLeg = (g) => {
    const p = g.attributes.position; const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (p.getX(k) + p.getZ(k)) * 0.3, p.getY(k) * 0.14);
    return g;
  };
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (BW - 0.34); const z = sz * (BD - 0.28);
      wood.push({ geometry: uvLeg(block(x - 0.15, 0, z - 0.15, x + 0.15, T0 - 0.02, z + 0.15)), color: 0x8a5f36 });
    }
    wood.push({ geometry: uvLeg(block(sx * (BW - 0.34) - 0.08, 0.44, -BD + 0.28, sx * (BW - 0.34) + 0.08, 0.68, BD - 0.28)), color: 0x7c5430 });
  }
  wood.push({ geometry: uvLeg(block(-BW + 0.34, 0.5, -0.08, BW - 0.34, 0.72, 0.08)), color: 0x7c5430 });
  for (const sz of [-1, 1]) {
    wood.push({ geometry: uvLeg(block(-BW + 0.4, T0 - 0.36, sz * (BD - 0.1) - 0.06, BW - 0.4, T0 - 0.01, sz * (BD - 0.1) + 0.06)), color: 0x7c5430 });
  }
  const grain = canvasTexture(512, 512, (ctx, w, h) => paintWoodGrain(ctx, w, h, 611));
  wrapRepeat(grain, 1, 1);
  root.add(mesh(mergeParts(wood), standard({ vertexColors: true, map: grain, roughness: 0.66, metalness: 0, bumpMap: dataTexture(grain.clone()), bumpScale: 0.5 })));

  // The printing. All of it is computed from the numbers above.
  const fmt = (v, n = 1) => v.toFixed(n);
  const W = 1024; const H = 1024;
  const R = (y, h, x = 0, w = W) => ({ px: [x, y, w, h], uv: uvRect(W, H, x, y, w, h) });
  const rows = {
    formula: R(0, 256),
    areaS: R(256, 170),
    areaW: R(426, 170),
    pushS: R(596, 110, 0, 512),
    pushW: R(596, 110, 512, 512),
    w1: R(706, 90, 0, 256),
    w16: R(706, 90, 256, 256),
    valve: R(706, 90, 512, 512),
    level: R(796, 90),
  };
  const sheet = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#efe6cc';
    ctx.fillRect(0, 0, W, H);
    // The formula board.
    {
      const [x, y, w, h] = rows.formula.px;
      plateCell(ctx, x, y, w, h, [''], { ground: '#14283c', edge: '#c9a65c' });
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffe9ae';
      fitFont(ctx, 'pressure = force / area', w * 0.9, 96);
      ctx.fillText('pressure = force / area', w / 2, y + h * 0.34);
      ctx.fillStyle = '#d7e8f4';
      const line = `${L.LB_SMALL} lb / ${fmt(L.AREA_SMALL_SQIN)} sq in = ${L.LB_WIDE} lb / ${fmt(L.AREA_WIDE_SQIN)} sq in`;
      fitFont(ctx, line, w * 0.9, 56, '600');
      ctx.fillText(line, w / 2, y + h * 0.7);
    }
    plateCell(ctx, ...rows.areaS.px, [`SMALL PISTON, ${fmt(L.D_SMALL * 12, 0)} in across`, `AREA ${fmt(L.AREA_SMALL_SQIN)} sq in`], {});
    plateCell(ctx, ...rows.areaW.px, [`WIDE PISTON, ${fmt(L.D_WIDE * 12, 0)} in across: ${L.RATIO} TIMES AS WIDE`, `AREA ${fmt(L.AREA_WIDE_SQIN)} sq in: ${areaRatio} TIMES AS BIG`], {});
    plateCell(ctx, ...rows.pushS.px, [`PUSH DOWN ${areaRatio} in`], { ground: '#f6d7cf', edge: '#a42a20' });
    plateCell(ctx, ...rows.pushW.px, ['RISES 1 in'], { ground: '#d4ecd4', edge: '#1f7a39' });
    plateCell(ctx, ...rows.w1.px, ['1 lb'], { ground: '#2a2c32', ink: '#f6f0dc', edge: '#8a8f98' });
    plateCell(ctx, ...rows.w16.px, ['16 lb'], { ground: '#2a2c32', ink: '#f6f0dc', edge: '#8a8f98' });
    plateCell(ctx, ...rows.valve.px, ['VALVE OPEN'], {});
    plateCell(ctx, ...rows.level.px, ['BOTH PISTONS AT THE SAME HEIGHT, SO THEY BALANCE'], { ground: '#14283c', ink: '#ffe9ae', edge: '#c9a65c' });
  });
  const plates = [];
  const flat = (rect, w, h, x, y, z, depth = 0.03) => {
    const g = printedPlate(w, h, depth, rect.uv);
    g.translate(x, y, z);
    plates.push({ geometry: g, keepColor: true });
  };
  const apronZ = BD + 0.006 + 0.001;
  flat(rows.areaS, 2.7, 0.45, L.X_SMALL + 0.12, T0 - 0.06, apronZ, 0.09);
  flat(rows.areaW, 2.7, 0.45, L.X_WIDE, T0 - 0.06, apronZ, 0.09);
  root.add(mesh(mergeParts(plates.concat(buildLiftPlates(L, rows, rS, rW, pTop, hWsmall, hWwide, dWsmall, dWwide, vX, pipeY))), standard({
    map: sheet, roughness: 0.58, metalness: 0, emissive: 0xffffff, emissiveMap: sheet, emissiveIntensity: 0.14,
  })));

  // The board's two slim legs, and the two thin rods marking the level from piston to piston.
  const fixtures = [];
  const boardZ = LIFT_BOARD_Z; const boardCX = (L.X_SMALL + rS + L.X_WIDE - rW) / 2;
  for (const dx of [-1.12, 1.12]) {
    fixtures.push(polished(rod([boardCX + dx, L.BENCH_TOP - 0.01, boardZ - 0.05], [boardCX + dx, L.PISTON_Y + 0.13, boardZ - 0.05], 0.035, 10, 1), brass, 0.95));
    fixtures.push(polished(lathe([[0, L.BENCH_TOP], [0.1, L.BENCH_TOP], [0.1, L.BENCH_TOP + 0.03], [0.05, L.BENCH_TOP + 0.07], [0, L.BENCH_TOP + 0.08]], 16).translate(boardCX + dx, 0, boardZ - 0.05), brass, 0.95));
  }
  // The level itself: a thin red rod at the height of the pistons' undersides, from glass to glass.
  const levelZ = boardZ - 0.015;
  const leftEnd = L.X_SMALL + Math.sqrt(Math.max(0, (rS + L.WALL) ** 2 - levelZ * levelZ));
  const rightEnd = L.X_WIDE - Math.sqrt((rW + L.WALL) ** 2 - levelZ * levelZ);
  fixtures.push({ geometry: rod([leftEnd, L.PISTON_Y, levelZ], [rightEnd, L.PISTON_Y, levelZ], 0.016, 8, 0), color: 0xc8281e });
  root.add(mesh(mergeParts(fixtures), standard({ vertexColors: true, roughness: 0.4, metalness: 0.25 })));
  return root;
}

// The plates that do not lie flat on the bench: bands round each weight and small flags beside each arrow.
function buildLiftPlates(L, rows, rS, rW, pTop, hS, hW, dS, dW, vX, pipeY) {
  const parts = [];
  // A printed band around the front of a weight, slightly proud of the casting.
  const band = (rect, x, y, r, arc, hgt) => {
    const [u0, v0, u1, v1] = rect.uv;
    const nu = 16;
    const on = (i, j, rad) => {
      const a = ((i / nu) - 0.5) * arc;
      return [x + Math.sin(a) * rad, y + (j - 0.5) * hgt, Math.cos(a) * rad];
    };
    parts.push({
      geometry: gridSolid(nu, 1,
        (i, j) => on(i, j, r + 0.008),
        (i, j) => on(i, j, r - 0.02),
        { uvTop: (i, j) => [mix(u0, u1, i / nu), mix(v0, v1, j)], uvBottom: () => [u0 + 0.002, v0 + 0.002], crease: 26 }),
      keepColor: true,
    });
  };
  band(rows.w1, L.X_SMALL, pTop + hS * 0.5, dS / 2, 2.2, 0.135);
  band(rows.w16, L.X_WIDE, pTop + hW * 0.5, dW / 2, 1.1, 0.3);
  const flag = (rect, w, h, x, y, z) => {
    const g = printedPlate(w, h, 0.03, rect.uv);
    g.translate(x, y, z);
    parts.push({ geometry: g, keepColor: true });
  };
  // The formula board, and the strip on the level rod's own line.
  const boardZ = LIFT_BOARD_Z; const boardCX = (L.X_SMALL + rS + L.X_WIDE - rW) / 2;
  flag(rows.formula, 2.5, 0.625, boardCX, L.PISTON_Y - 0.47, boardZ);
  flag(rows.level, 2.5, 0.2, boardCX, L.PISTON_Y, boardZ + 0.02);
  const armZ = 0.22;
  flag(rows.pushS, 1.0, 0.22, L.X_SMALL - rS - 0.42, 3.02, armZ);
  flag(rows.pushW, 1.0, 0.22, L.X_WIDE + rW + 0.42, 3.44, armZ);
  // The valve's plate stands on the pipe's own shaft, behind the handle.
  flag(rows.valve, 0.86, 0.17, vX, pipeY + 0.6, 0.0);
  return parts;
}

export const BUILDERS = {
  'sun-cutaway': () => buildSun(),
  'moon-phases': () => buildMoonPhases(),
  'glacier-block': () => buildGlacier(),
  'newtons-reflector': () => buildReflector(),
  'hydraulic-lift': () => buildHydraulicLift(),
};
