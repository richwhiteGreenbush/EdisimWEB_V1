import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, standard, canvasTexture, seededRandom } from '../../PropKit.js';
import { mergeParts, smoothNoise3 } from '../../props/LoftKit.js';
import {
  Sculpt, polygonize, ellipsoidP, sphereP, tube, lathe, signedVolume, lin, clamp01, mix, sstep, tintVertices,
} from '../ModelKit.js';
import { reducedMotion } from '../../Settings.js';

// The Model Database's sky family: a black hole, a comet, a solar eclipse bench, Earth's magnetic
// field and the life cycle of a star. Authored in feet, origin at the base centre, front toward +Z.
//
// EVERYTHING THAT GLOWS IS UNLIT AND CARRIES ITS OWN LIGHT, as the Moon phases table's spheres do. No
// point lights, and nothing that a Time of Day slider or HiFi's environment can wash out. Soft glows
// are nested shells whose alpha comes from a one-dimensional ramp read through u, so one small white
// texture gives every vertex in a merged mesh its own alpha without any custom shader.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const FONT = 'Arial, Helvetica, sans-serif';

// ---------------------------------------------------------------------------------------------
// Painting. A canvas holds sRGB bytes, so colours here are written as they should appear.
// ---------------------------------------------------------------------------------------------
function paintRGBA(ctx, x0, y0, w, h, fn) {
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
  ctx.putImageData(img, x0, y0);
}

// Value noise that wraps at nx by ny, so a pattern can run round a disk without a seam.
function periodicNoise(seed, nx, ny) {
  const rng = seededRandom(seed);
  const L = new Float32Array(nx * ny);
  for (let i = 0; i < L.length; i++) L[i] = rng();
  return (x, y) => {
    const xi = Math.floor(x); const yi = Math.floor(y);
    let fx = x - xi; let fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % nx) + nx) % nx; const y0 = ((yi % ny) + ny) % ny;
    const x1 = (x0 + 1) % nx; const y1 = (y0 + 1) % ny;
    const a = L[x0 + y0 * nx]; const b = L[x1 + y0 * nx];
    const c = L[x0 + y1 * nx]; const e = L[x1 + y1 * nx];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
  };
}

// A colour ramp in sRGB bytes: stops is [[t, r, g, b], ...] in increasing t.
function rampInto(stops, t, out) {
  if (t <= stops[0][0]) { out[0] = stops[0][1]; out[1] = stops[0][2]; out[2] = stops[0][3]; return; }
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const a = stops[i - 1]; const b = stops[i];
      const k = (t - a[0]) / (b[0] - a[0]);
      out[0] = mix(a[1], b[1], k); out[1] = mix(a[2], b[2], k); out[2] = mix(a[3], b[3], k);
      return;
    }
  }
  const z = stops[stops.length - 1];
  out[0] = z[1]; out[1] = z[2]; out[2] = z[3];
}

function fitFont(ctx, text, maxWidth, size, weight = '700', family = FONT) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  const width = ctx.measureText(text).width;
  if (width > maxWidth) { s = (s * maxWidth) / width; ctx.font = `${weight} ${s}px ${family}`; }
  return s;
}

// One column of printed plates. Each entry is { w, h, lines } in feet, and its cell keeps that
// shape, so the type is never stretched. Returns the texture and each plate's uv rectangle.
function plateAtlas(entries, { ground = '#15171f', ink = '#f4e7bd', edge = '#a98a4a', W = 768 } = {}) {
  const heights = entries.map((e) => Math.round((W * e.h) / e.w));
  const H = heights.reduce((a, b) => a + b, 0);
  const rects = [];
  let y = 0;
  const offsets = heights.map((hh) => { const o = y; y += hh; return o; });
  const texture = canvasTexture(W, H, (ctx) => {
    entries.forEach((e, i) => {
      const h = heights[i]; const top = offsets[i];
      ctx.fillStyle = e.ground ?? ground;
      ctx.fillRect(0, top, W, h);
      ctx.strokeStyle = e.edge ?? edge;
      ctx.lineWidth = Math.max(2, h * 0.04);
      ctx.strokeRect(h * 0.06, top + h * 0.06, W - h * 0.12, h - h * 0.12);
      ctx.fillStyle = e.ink ?? ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const rowH = (h * 0.8) / e.lines.length;
      e.lines.forEach((line, k) => {
        fitFont(ctx, line, W * 0.9, rowH * 0.8);
        ctx.fillText(line, W / 2, top + h * 0.1 + rowH * (k + 0.5));
      });
    });
  });
  entries.forEach((e, i) => rects.push([0, 1 - (offsets[i] + heights[i]) / H, 1, 1 - offsets[i] / H]));
  return { texture, rects };
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

// A closed slab between two matching grids, turned outward by measuring.
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

// A flat printed plate, face on +Z, back at z = -depth, centre at the origin. The rim samples one
// corner of its own rectangle, so the edge is plain rather than a squashed print.
function printedPlate(w, h, depth, [u0, v0, u1, v1]) {
  return gridSolid(1, 1,
    (i, j) => [(i - 0.5) * w, (j - 0.5) * h, 0],
    (i, j) => [(i - 0.5) * w, (j - 0.5) * h, -depth],
    { uvTop: (i, j) => [mix(u0, u1, i), mix(v0, v1, j)], uvBottom: () => [u0 + 0.004, v0 + 0.004], crease: 20 });
}

// Sets a plate at a point, turned by yaw and tipped back by `tilt` so it reads from above.
function placed(geometry, pos, { yaw = 0, tilt = 0 } = {}) {
  const m = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationX(-tilt));
  m.setPosition(pos[0], pos[1], pos[2]);
  geometry.applyMatrix4(m);
  return geometry;
}

// A closed slab from a counterclockwise-from-above outline [x, z], with the top inset by a small
// bevel and a uv read off plan position.
function outlineSlab(outline, y0, y1, uvAt, bevel = 0.03, rimUV = null) {
  const pos = []; const uvs = [];
  const n = outline.length;
  let cx = 0; let cz = 0;
  for (const p of outline) { cx += p[0] / n; cz += p[1] / n; }
  const inset = (p) => {
    const dx = p[0] - cx; const dz = p[1] - cz; const d = Math.hypot(dx, dz) || 1;
    return [p[0] - (dx / d) * bevel, p[1] - (dz / d) * bevel];
  };
  const tri = (a, b, c) => {
    for (const v of [a, b, c]) {
      pos.push(v[0], v[1], v[2]);
      const uv = rimUV && v[1] < y1 - 1e-6 ? rimUV : uvAt(v[0], v[2]);
      uvs.push(uv[0], uv[1]);
    }
  };
  for (let i = 0; i < n; i++) {
    const a = outline[i]; const b = outline[(i + 1) % n];
    const ia = inset(a); const ib = inset(b);
    tri([cx, y1, cz], [ia[0], y1, ia[1]], [ib[0], y1, ib[1]]);
    tri([ia[0], y1, ia[1]], [a[0], y1 - bevel, a[1]], [b[0], y1 - bevel, b[1]]);
    tri([ia[0], y1, ia[1]], [b[0], y1 - bevel, b[1]], [ib[0], y1, ib[1]]);
    tri([a[0], y1 - bevel, a[1]], [a[0], y0, a[1]], [b[0], y0, b[1]]);
    tri([a[0], y1 - bevel, a[1]], [b[0], y0, b[1]], [b[0], y1 - bevel, b[1]]);
    tri([cx, y0, cz], [b[0], y0, b[1]], [a[0], y0, a[1]]);
  }
  return soup(pos, uvs, 28);
}

function roundedRect(x0, x1, z0, z1, rad, seg = 8) {
  const pts = [];
  const corner = (cx, cz, a0) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * rad, cz + Math.sin(a) * rad]);
    }
  };
  corner(x1 - rad, z1 - rad, 0);
  corner(x0 + rad, z1 - rad, Math.PI / 2);
  corner(x0 + rad, z0 + rad, Math.PI);
  corner(x1 - rad, z0 + rad, Math.PI * 1.5);
  return pts;
}

// ---------------------------------------------------------------------------------------------
// Glow: unlit materials, and a one-dimensional alpha ramp read through u
// ---------------------------------------------------------------------------------------------
const unlit = (extra = {}) => new THREE.MeshBasicMaterial({ vertexColors: true, ...extra });

function alphaRamp() {
  const t = canvasTexture(256, 4, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.004)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

const glowMaterial = (map, extra = {}) => new THREE.MeshBasicMaterial({
  map, vertexColors: true, transparent: true, depthWrite: false, ...extra,
});

// Paints a geometry's colour and its alpha, the second through u.
function paintGlow(geometry, fn) {
  const p = geometry.attributes.position;
  const col = new Float32Array(p.count * 3);
  const uv = new Float32Array(p.count * 2);
  const out = [1, 1, 1, 1];
  for (let i = 0; i < p.count; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), out);
    col[i * 3] = out[0]; col[i * 3 + 1] = out[1]; col[i * 3 + 2] = out[2];
    uv[i * 2] = clamp01(out[3]); uv[i * 2 + 1] = 0.5;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return { geometry, keepColor: true };
}

// One soft shell, lumpy if asked. The lumps are a smooth function of direction, so it cannot tear.
function glowShell(c, r, color, alpha, { lump = 0, freq = 2.2, seed = 0, ws = 32, hs = 20, shift = [0, 0, 0] } = {}) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const dx = p.getX(i) / r; const dy = p.getY(i) / r; const dz = p.getZ(i) / r;
    const k = lump ? 1 + lump * (smoothNoise3(dx * freq + seed, dy * freq + 7, dz * freq - seed) - 0.5) * 2 : 1;
    p.setXYZ(i, c[0] + shift[0] + dx * r * k, c[1] + shift[1] + dy * r * k, c[2] + shift[2] + dz * r * k);
  }
  const col = Array.isArray(color) ? color : lin(color);
  return paintGlow(g, (x, y, z, out) => { out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = alpha; });
}

// The stand all five share: a low round dark base and a slim post, with one brass line.
function slimStand(parts, baseR, topY, { x = 0, z = 0, post = 0.075, color = 0x23252d } = {}) {
  const b = lathe([
    [0, 0], [baseR, 0], [baseR, 0.11], [baseR * 0.97, 0.16], [baseR * 0.62, 0.22], [post * 3.2, 0.3], [post * 1.7, 0.42], [0, 0.46],
  ], 72);
  b.translate(x, 0, z);
  parts.push({ geometry: b, color });
  const ring = lathe([[baseR * 0.985, 0.075], [baseR * 1.012, 0.075], [baseR * 1.012, 0.115], [baseR * 0.985, 0.115]], 72);
  ring.translate(x, 0, z);
  parts.push({ geometry: ring, color: 0xa98a4a });
  parts.push({ geometry: rod([x, 0.3, z], [x, topY, z], post, 12, 1), color });
}

// ===========================================================================================
// THE BLACK HOLE
// ===========================================================================================
//
// The black sphere's radius IS the event horizon, and the disk's inner edge stands at three times
// it, the innermost stable circular orbit of a non-spinning black hole: gas can circle no closer,
// which is why there is a real gap. Temperature falls as r^(-3/4), the thin-disk law, and sets the
// colour ramp's position, so white-hot inside and deep red outside is that law and not a gradient
// drawn by eye. The ramp itself is colour for reading: a real disk this hot peaks in the ultraviolet.
//
// THE BRIGHT SIDE IS DOPPLER BEAMING AND IT DOES NOT TURN WITH THE GAS. Gas moving toward whoever
// is looking is brighter by D^3, D = 1 / (gamma (1 - beta cos a)), and that pattern belongs to the
// viewer, not to the disk. Painted into the turning texture it would carry the bright side round
// and teach something false. So the streaks are the map and turn with the group, and the beaming is
// the vertex colour, repainted against wherever the viewer stands. At rest the viewer is on +Z, and
// the gas moving toward +Z is on the -X half: `rotation.y` carries +X toward -Z, counterclockwise
// seen from above. Orbital speed is the Schwarzschild local value, beta = sqrt((rs / 2) / (r - rs)),
// which is exactly one half at the inner edge.
//
// THE RING IS AN INVERTED HULL. A slightly larger sphere drawn BackSide shows only where it peeks
// past the black sphere's silhouette, so it is a perfect thin circle from every direction with no
// billboard and no tick, which is also how a real photon ring behaves. A true photon orbit is at 1.5
// horizon radii and the shadow seen from far off is 2.6; this hugs the sphere for legibility.

export const BLACK_HOLE = { RS: 1.25, ISCO: 3.75, ROUT: 7, CY: 5.7, TILT: 30 * DEG, JET: 5.9, TURN_SECONDS: 20 };

export function dopplerBeam(r, cosA) {
  const beta = Math.min(0.95, Math.sqrt((BLACK_HOLE.RS / 2) / (r - BLACK_HOLE.RS)));
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  const D = 1 / (gamma * (1 - beta * cosA));
  return D * D * D;
}

// The flow direction: gas spirals in while circling the way the group turns, so along a streamline
// phi rises as r falls. `pitch` is opened out from the real, nearly circular flow so it can be seen.
const BH_FLOW_K = 1 / Math.tan(11 * DEG);

function paintAccretion(ctx, S) {
  const { ISCO, ROUT } = BLACK_HOLE;
  const n1 = periodicNoise(1101, 96, 6);
  const n2 = periodicNoise(1102, 40, 4);
  const n3 = periodicNoise(1103, 192, 12);
  const n4 = periodicNoise(1104, 16, 3);
  const Tout = (ROUT / ISCO) ** -0.75;
  const stops = [[0, 255, 252, 240], [0.05, 255, 240, 190], [0.2, 255, 186, 80], [0.46, 246, 104, 28], [0.76, 186, 38, 14], [1, 112, 14, 10]];
  const rgb = [0, 0, 0];
  paintRGBA(ctx, 0, 0, S, S, (ix, iy, out) => {
    const x = ((ix + 0.5) / S - 0.5) * 2 * ROUT;
    const z = (0.5 - (iy + 0.5) / S) * 2 * ROUT;
    const r = Math.hypot(x, z);
    if (r < ISCO * 0.97) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 255; return; }
    const phi = Math.atan2(-z, x);
    const lnr = Math.log(r / ISCO);
    const s = phi + BH_FLOW_K * lnr; // constant along a streamline
    const a = s / TAU; const b = phi / TAU;
    const f1 = n1(a * 96, b * 6);
    const f2 = n2(a * 40, b * 4 + 0.3);
    const f3 = n3(a * 192, b * 12);
    const f4 = n4(a * 16, b * 3);
    const streak = f2 * 0.42 + f1 * 0.36 + f3 * 0.22;
    const T = (r / ISCO) ** -0.75;
    const t = (1 - T) / (1 - Tout);
    rampInto(stops, t + (f4 - 0.5) * 0.1, rgb);
    let k = 0.42 + 1.25 * sstep(streak, 0.28, 0.72);
    // Dark lanes between the bands, and the blinding inner edge.
    k *= 0.72 + 0.28 * sstep(f2, 0.3, 0.5);
    const edge = 1 - sstep(r, ISCO, ISCO * 1.09);
    k = mix(k, 1.25, edge);
    out[0] = Math.min(255, rgb[0] * k + edge * 40);
    out[1] = Math.min(255, rgb[1] * k + edge * 60);
    out[2] = Math.min(255, rgb[2] * k + edge * 60);
    // The outer edge is torn along the flow rather than cut: alpha-tested, so no transparency.
    const limit = ROUT * (0.885 + 0.115 * sstep(n4(a * 16, 0.5) * 0.65 + n2(a * 40, 0.5) * 0.35, 0.3, 0.68));
    out[3] = 255 * clamp01((limit - r) / 0.07 + 0.5) * clamp01((r - ISCO * 0.985) / 0.03 + 1);
  });
}

function buildBlackHole() {
  const { RS, ISCO, ROUT, CY, TILT, JET } = BLACK_HOLE;
  const root = new THREE.Group();

  // The disk's frame. +30 degrees about X leans its axis toward +Z, so a 5ft student standing well back
  // sees it as an open ellipse with the streaks and the bright side showing, not as a thin stripe.
  const tilt = new THREE.Group();
  tilt.position.set(0, CY, 0);
  tilt.rotation.x = TILT;
  root.add(tilt);
  const spin = new THREE.Group();
  tilt.add(spin);

  // The event horizon: truly black, whatever the sky is doing.
  const horizon = mesh(new THREE.SphereGeometry(RS, 72, 48), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  tilt.add(horizon);

  // The photon ring: two nested hulls, white hot inside an orange edge.
  const hull = [
    { geometry: new THREE.SphereGeometry(RS * 1.04, 96, 48), color: 0xffffff },
    { geometry: new THREE.SphereGeometry(RS * 1.085, 96, 48), color: 0xff9a3a },
  ];
  const hullG = mergeParts(hull);
  const hullCount = hullG.attributes.position.count;
  const hullBase = Float32Array.from(hullG.attributes.color.array);
  hullG.attributes.color.setUsage(THREE.DynamicDrawUsage);
  const hullMesh = mesh(hullG, unlit({ side: THREE.BackSide, toneMapped: false }));
  hullMesh.castShadow = false;
  hullMesh.receiveShadow = false;
  tilt.add(hullMesh);

  // The disk: a thin solid, thickening outward, its two faces sharing one planar map.
  const NR = 14; const NA = 168;
  const pos = []; const uvs = []; const idx = [];
  const radii = [];
  const halfThick = (r) => 0.012 + 0.016 * (r - ISCO);
  const uvOf = (x, z) => [x / (2 * ROUT) + 0.5, z / (2 * ROUT) + 0.5];
  for (const side of [1, -1]) {
    for (let i = 0; i <= NR; i++) {
      const r = mix(ISCO, ROUT, i / NR);
      for (let j = 0; j <= NA; j++) {
        const phi = (j / NA) * TAU;
        const x = Math.cos(phi) * r; const z = -Math.sin(phi) * r;
        pos.push(x, side * halfThick(r), z);
        const uv = uvOf(x, z);
        uvs.push(uv[0], uv[1]);
        radii.push(r);
      }
    }
  }
  const row = NA + 1; const sheet = (NR + 1) * row;
  for (let i = 0; i < NR; i++) {
    for (let j = 0; j < NA; j++) {
      const a = i * row + j; const b = a + 1; const c = a + row; const d = c + 1;
      idx.push(a, c, d, a, d, b); // top, facing +Y
      idx.push(a + sheet, d + sheet, c + sheet, a + sheet, b + sheet, d + sheet); // bottom, facing -Y
    }
  }
  for (let j = 0; j < NA; j++) {
    const a = j; const b = j + 1; const c = j + sheet; const d = j + 1 + sheet;
    idx.push(a, b, d, a, d, c); // inner rim
    const oa = NR * row + j; const ob = oa + 1; const oc = oa + sheet; const od = ob + sheet;
    idx.push(oa, od, ob, oa, oc, od); // outer rim
  }
  const diskCount = pos.length / 3;

  // Three hair-thin dark arms carry the disk from the horizon across the gap: they read the map's
  // black centre, and stay out of the beaming repaint because they come after diskCount.
  const arms = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + 0.5;
    const c = Math.cos(a); const s = Math.sin(a);
    arms.push({ geometry: rod([c * RS * 0.96, -0.012, s * RS * 0.96], [c * ISCO * 1.03, -0.012, s * ISCO * 1.03], 0.012, 6, 1), color: 0xffffff });
  }
  const armG = mergeParts(arms);
  const ap = armG.attributes.position;
  const base = pos.length / 3;
  for (let i = 0; i < ap.count; i++) { pos.push(ap.getX(i), ap.getY(i), ap.getZ(i)); uvs.push(0.5, 0.5); radii.push(0); }
  for (let i = 0; i < armG.index.count; i++) idx.push(armG.index.getX(i) + base);

  const diskG = new THREE.BufferGeometry();
  diskG.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  diskG.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  diskG.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.length).fill(1), 3));
  diskG.setIndex(idx);
  diskG.computeVertexNormals();
  diskG.attributes.color.setUsage(THREE.DynamicDrawUsage);
  const map = canvasTexture(1024, 1024, (ctx, w) => paintAccretion(ctx, w));
  const diskMesh = mesh(diskG, unlit({ map, alphaTest: 0.5, toneMapped: false }));
  diskMesh.castShadow = false;
  diskMesh.receiveShadow = false;
  spin.add(diskMesh);

  // Beaming, repainted. `phi` is a vertex's angle in the disk's own frame, so the angle in the
  // tilted frame is phi plus however far the group has turned.
  const IMAX = dopplerBeam(ISCO, 1);
  const P = diskG.attributes.position.array;
  const C = diskG.attributes.color;
  const view = V(0, Math.sin(TILT), Math.cos(TILT));
  const shade = (I) => clamp01(1.5 * (I / IMAX) ** 0.42);
  const repaint = (theta) => {
    const nx = view.x; const nz = view.z;
    const cs = Math.cos(theta); const sn = Math.sin(theta);
    for (let i = 0; i < diskCount; i++) {
      const x0 = P[i * 3]; const z0 = P[i * 3 + 2];
      const r = radii[i];
      // Into the tilted frame: rotation.y by theta.
      const x = x0 * cs + z0 * sn; const z = -x0 * sn + z0 * cs;
      const vx = z / r; const vz = -x / r;
      const k = shade(dopplerBeam(r, vx * nx + vz * nz));
      // Dimmer is also redder, as a receding source really is, so the far side never reads as grey.
      C.array[i * 3] = k; C.array[i * 3 + 1] = k ** 1.3; C.array[i * 3 + 2] = k ** 2;
    }
    C.needsUpdate = true;
    // The ring's light comes from the same gas, so its bright side follows.
    const hp = hullG.attributes.position.array;
    const hc = hullG.attributes.color;
    for (let i = 0; i < hullCount; i++) {
      const x = hp[i * 3]; const z = hp[i * 3 + 2];
      const l = Math.hypot(x, z) || 1;
      const cosA = (z / l) * nx + (-x / l) * nz;
      const k = mix(0.42, 1, sstep(cosA, -0.8, 0.8));
      hc.array[i * 3] = hullBase[i * 3] * k; hc.array[i * 3 + 1] = hullBase[i * 3 + 1] * k; hc.array[i * 3 + 2] = hullBase[i * 3 + 2] * k;
    }
    hc.needsUpdate = true;
  };
  repaint(0);

  // The two jets along the spin axis, one soft transparent mesh: a narrow apex at the horizon opening
  // into a real cone, a pale core inside a blue sheath, both fading with distance.
  const ramp = alphaRamp();
  const glow = [];
  const blue = lin(0x1250ff); const pale = lin(0xa8d4ff);
  for (const sign of [1, -1]) {
    const a = [0, sign * RS * 0.98, 0];
    const b = [0, sign * JET, 0];
    const core = tube([a, b], [0.04, 0.2], { straight: true, steps: 40, sides: 16, round: 0 });
    glow.push(paintGlow(core, (x, y, z, out) => {
      const t = clamp01((Math.abs(y) - RS) / (JET - RS));
      const knot = 0.72 + 0.56 * smoothNoise3(y * 1.7 + sign * 5, 0.4, 0.8);
      out[0] = pale[0]; out[1] = pale[1]; out[2] = pale[2];
      out[3] = (1 - t) ** 0.95 * knot * sstep(t, 0, 0.02);
    }));
    const sheath = tube([a, b], [0.08, 0.56], { straight: true, steps: 40, sides: 26, round: 0 });
    glow.push(paintGlow(sheath, (x, y, z, out) => {
      const t = clamp01((Math.abs(y) - RS) / (JET - RS));
      const az = Math.atan2(x, z);
      const fil = 0.6 + 0.8 * smoothNoise3(Math.cos(az) * 2.4, Math.sin(az) * 2.4, y * 0.35 + sign);
      out[0] = blue[0]; out[1] = blue[1]; out[2] = blue[2];
      out[3] = 0.72 * (1 - t) ** 1.05 * fil;
    }));
  }
  const jetMesh = mesh(mergeParts(glow), glowMaterial(ramp, { toneMapped: false, fog: false }));
  jetMesh.castShadow = false;
  jetMesh.receiveShadow = false;
  tilt.add(jetMesh);

  // The stand, its post stopping inside the horizon, plus a lectern for the plate.
  const standParts = [];
  slimStand(standParts, 2.15, CY - RS * 0.5, { post: 0.07 });
  standParts.push({ geometry: placed(block(-1.34, -0.02, -0.24, 1.34, 0.3, 0.02), [0, 0.12, 1.28], { tilt: 38 * DEG }), color: 0x23252d });
  root.add(mesh(mergeParts(standParts), standard({ vertexColors: true, roughness: 0.6, metalness: 0.15 })));

  const plates = [{ w: 2.5, h: 0.5, lines: ['THE BLACK SPHERE IS THE EVENT HORIZON', 'ARTIST’S VIEW, NOT TO SCALE'] }];
  const { texture, rects } = plateAtlas(plates);
  const plate = placed(printedPlate(2.5, 0.5, 0.02, rects[0]), [0, 0.46, 1.4], { tilt: 38 * DEG });
  root.add(mesh(plate, standard({ map: texture, roughness: 0.6, metalness: 0, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.35 })));

  const step = TAU / BLACK_HOLE.TURN_SECONDS;
  const camLocal = V();
  let last = 0;
  let turned = 0;
  root.userData.tick = {
    update(dt, camera) {
      if (!reducedMotion()) { spin.rotation.y += dt * step; turned += dt * step; }
      let moved = false;
      if (camera) {
        tilt.updateWorldMatrix(true, false);
        camLocal.copy(camera.position);
        tilt.worldToLocal(camLocal);
        if (camLocal.lengthSq() > 1e-6) {
          camLocal.normalize();
          if (camLocal.dot(view) < 0.9996) { view.copy(camLocal); moved = true; }
        }
      }
      // Repainted only once it has turned a degree and a half, or the viewer has moved.
      if (moved || Math.abs(turned - last) > 1.5 * DEG) { last = turned; repaint(spin.rotation.y); }
    },
    dispose() {},
  };
  return root;
}

// ===========================================================================================
// THE COMET
// ===========================================================================================
//
// The comet is the model: a head at eye level, a coma nearly six feet across, tails over twelve feet
// long, and only a slim rail under them. Saturated colour on high alpha, with no tone mapping, so it
// holds against a pale sky as well as a dark one.
//
// One real orbit in one plane, written as a conic with the lamp at its focus. The comet is inbound at
// true anomaly -135 degrees, eccentricity 0.9, and the orbit is turned so the lamp-to-comet line runs
// along +X. THE PLANE IS TIPPED 20 DEGREES TOWARD +Z ABOUT THAT LINE, because a tail in a level plane at
// eye height is seen exactly edge-on, so its whole fan disappears. The arc of the orbit is a real rod in
// that same plane, so everything stays in one true plane, and every rule below is unchanged by the tip.
//
// THE ION TAIL IS THE UNIT VECTOR FROM THE LAMP THROUGH THE HEAD, computed from the two positions and
// asserted. The solar wind carries ions straight out, so it is dead straight and dead radial.
//
// THE DUST TAIL IS NOT DRAWN, IT IS RELEASED. Dust feels the Sun's gravity reduced by light pressure,
// by a factor (1 - beta), so each grain coasts on its own orbit from wherever the comet was when it
// left. Each edge of the tail is a syndyne: the place at this moment of all the grains of one beta,
// let go at every earlier point of the orbit, integrated with leapfrog. That is why it curves, and why
// it lags on the side the comet has come from. The beta values are chosen to give a tail of the right
// size on a model this small, and the fan is widened a little past them, as ejection speed does.
//
// THE SMALL COMETS ride the same arc, each tail computed straight away from the lamp, and on the
// outbound leg that means it travels tail first, which is the answer to the card's question.
//
// Everything soft is ONE transparent mesh with one atlas. The coma is ten crossed squares through the
// centre, all reading one high-resolution dithered radial gradient: with no depth writes they sum to a
// smooth falloff from any direction, with no contour bands, and each is two triangles.

export const COMET = {
  H: 6, SUN_X: -7.8, Z0: -2, R_HEAD: 4, E: 0.9, NU: -135 * DEG, SUN_R: 0.6, TILT: 20 * DEG,
  ION_END: 9, COMA_R: 2.95, RAIL: [-8.7, 3.7],
};

// A point in the orbit's plane, as (x, distance along the tipped axis), into the world.
const cometWorld = (x, zp) => [x, COMET.H - zp * Math.sin(COMET.TILT), COMET.Z0 + zp * Math.cos(COMET.TILT)];

export function cometOrbit() {
  const { SUN_X, R_HEAD, E, NU } = COMET;
  const p = R_HEAD * (1 + E * Math.cos(NU));
  const om = -NU; // theta = nu + om, so the head is at theta 0, straight out along +X
  const mu = 1;
  const k = Math.sqrt(mu / p);
  const P = [Math.cos(om), Math.sin(om)];
  const Q = [-Math.sin(om), Math.cos(om)];
  // In the plane (X, W), W = -zp, counterclockwise seen from above the plane, relative to the lamp.
  const rel = (nu) => {
    const r = p / (1 + E * Math.cos(nu));
    const th = nu + om;
    return {
      r, x: r * Math.cos(th), y: r * Math.sin(th),
      vx: k * (-Math.sin(nu) * P[0] + (E + Math.cos(nu)) * Q[0]),
      vy: k * (-Math.sin(nu) * P[1] + (E + Math.cos(nu)) * Q[1]),
    };
  };
  // Plane coordinates: [x, zp], with the lamp at zp = 0.
  const plane = (nu) => { const s = rel(nu); return [SUN_X + s.x, -s.y]; };
  // The grains of one beta, let go at every earlier point on the orbit, where they are now. In plane
  // coordinates, starting at the head and resampled to `count` points evenly along `length`.
  const syndyne = (beta, length, count) => {
    const h = Math.sqrt(mu * p);
    const m = mu * (1 - beta);
    const dn = 0.25 * DEG;
    const raw = [plane(NU)];
    let nu = NU; let t = 0; let run = 0;
    for (let i = 1; i < 4000 && run < length * 1.02; i++) {
      t += ((p / (1 + E * Math.cos(nu))) ** 2 / h) * dn;
      nu -= dn;
      if (i % 12) continue;
      const s = rel(nu);
      let { x, y, vx, vy } = s;
      const steps = 160; const d = t / steps;
      for (let j = 0; j < steps; j++) {
        let r3 = Math.hypot(x, y) ** 3;
        vx -= (0.5 * d * m * x) / r3; vy -= (0.5 * d * m * y) / r3;
        x += d * vx; y += d * vy;
        r3 = Math.hypot(x, y) ** 3;
        vx -= (0.5 * d * m * x) / r3; vy -= (0.5 * d * m * y) / r3;
      }
      const pt = [SUN_X + x, -y];
      const last = raw[raw.length - 1];
      run += Math.hypot(pt[0] - last[0], pt[1] - last[1]);
      raw.push(pt);
    }
    const lens = [0];
    for (let i = 1; i < raw.length; i++) lens.push(lens[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
    const total = Math.min(length, lens[lens.length - 1]);
    const out = [];
    let at = 0;
    for (let i = 0; i <= count; i++) {
      const want = (i / count) * total;
      while (at < lens.length - 2 && lens[at + 1] < want) at += 1;
      const f = (want - lens[at]) / ((lens[at + 1] - lens[at]) || 1);
      out.push([mix(raw[at][0], raw[at + 1][0], f), mix(raw[at][1], raw[at + 1][1], f)]);
    }
    return out;
  };
  return { p, q: p / (1 + E), rel, plane, syndyne, head: plane(NU), sun: [SUN_X, 0] };
}

// The atlas, in canvas pixels [x, y, w, h].
const COMET_ATLAS = {
  S: 1024, ION: [0, 0, 1024, 256], DUST: [0, 256, 1024, 256], COMA: [0, 512, 512, 512], CORONA: [512, 512, 256, 256], JET: [768, 512, 256, 128],
};
const cometUV = ([x, y, w, h], u, v) => [(x + u * w) / COMET_ATLAS.S, 1 - (y + v * h) / COMET_ATLAS.S];

function paintCometAtlas(ctx) {
  const { ION, DUST, COMA, CORONA, JET } = COMET_ATLAS;
  const nI = periodicNoise(2201, 5, 26);
  const nI2 = periodicNoise(2202, 14, 60);
  const nI3 = periodicNoise(2205, 30, 8);
  paintRGBA(ctx, ION[0], ION[1], ION[2], ION[3], (ix, iy, out) => {
    const u = (ix + 0.5) / ION[2]; const v = (iy + 0.5) / ION[3];
    const q = v * 2 - 1;
    // Streamers run the length of the tail, with knots where a stretch of it has broken up.
    const ray = nI(u * 5, v * 26) * 0.62 + nI2(u * 14, v * 60) * 0.38;
    const knot = nI3(u * 30, v * 8);
    const k = sstep(ray + (knot - 0.5) * 0.16, 0.42, 0.62);
    const edge = (1 - q * q) ** 0.8;
    const fade = sstep(u, 0, 0.02) * (1 - u) ** 0.7 * (1 - sstep(u, 0.86, 1));
    const hot = (1 - u) ** 7 * (1 - Math.abs(q));
    out[0] = mix(mix(10, 70, k), 190, hot);
    out[1] = mix(mix(72, 150, k), 228, hot);
    out[2] = 255;
    out[3] = 255 * clamp01(fade * edge * (0.26 + 1.05 * k));
  });
  const nD = periodicNoise(2203, 46, 7);
  const nD2 = periodicNoise(2204, 7, 34);
  const nD3 = periodicNoise(2206, 3, 12);
  paintRGBA(ctx, DUST[0], DUST[1], DUST[2], DUST[3], (ix, iy, out) => {
    const u = (ix + 0.5) / DUST[2]; const v = (iy + 0.5) / DUST[3];
    const q = v * 2 - 1;
    // Long bands of one grain size along the fan, and striae across it, from dust let go together.
    const band = nD2(u * 7, v * 34) * 0.6 + nD3(u * 3, v * 12) * 0.4;
    const stria = nD(u * 46, v * 7);
    const k = sstep(band, 0.32, 0.66) * 0.72 + sstep(stria, 0.42, 0.7) * 0.28;
    const edge = (1 - q * q) ** 0.62;
    const fade = sstep(u, 0, 0.05) * (1 - u) ** 0.78 * (1 - sstep(u, 0.86, 1));
    out[0] = 255;
    out[1] = mix(mix(138, 198, k), 120, u * 0.8);
    out[2] = mix(mix(4, 52, k), 0, u);
    out[3] = 255 * clamp01(fade * edge * (0.5 + 0.8 * k));
  });
  // The coma: one radial gradient, dithered, so low alpha cannot show steps however many layers add up.
  const rngC = seededRandom(2208);
  const rays = periodicNoise(2207, 64, 4);
  const stops = [[0, 228, 255, 250], [0.34, 150, 250, 238], [0.62, 28, 214, 226], [1, 6, 150, 225]];
  const rgb = [0, 0, 0];
  paintRGBA(ctx, COMA[0], COMA[1], COMA[2], COMA[3], (ix, iy, out) => {
    const x = ((ix + 0.5) / COMA[2]) * 2 - 1; const y = ((iy + 0.5) / COMA[3]) * 2 - 1;
    const r = Math.hypot(x, y);
    if (r >= 1) { out[0] = 10; out[1] = 130; out[2] = 225; out[3] = 0; return; }
    rampInto(stops, r, rgb);
    out[0] = rgb[0]; out[1] = rgb[1]; out[2] = rgb[2];
    const a = (Math.atan2(y, x) + Math.PI) / TAU;
    const ray = 0.9 + 0.2 * rays(a * 64, r * 3.9);
    // Falls to nothing at the rim with no kink, and is empty out to the nucleus's own reach: these squares
    // pass through its centre, so any alpha there would cut hard lines across its face.
    const fall = (1 - r * r) ** 1.5;
    const dip = sstep(r, 0.36, 0.6);
    const alpha = 255 * 0.56 * fall * dip * ray;
    out[3] = Math.floor(alpha + rngC());
  });
  const raysC = periodicNoise(2209, 48, 4);
  paintRGBA(ctx, CORONA[0], CORONA[1], CORONA[2], CORONA[3], (ix, iy, out) => {
    const x = ((ix + 0.5) / CORONA[2]) * 2 - 1; const y = ((iy + 0.5) / CORONA[3]) * 2 - 1;
    const r = Math.hypot(x, y);
    out[0] = 255; out[1] = mix(190, 96, r); out[2] = mix(50, 0, r);
    if (r >= 1) { out[3] = 0; return; }
    const a = (Math.atan2(y, x) + Math.PI) / TAU;
    out[3] = Math.floor(255 * 0.46 * sstep(r, 0.55, 0.68) * (1 - r * r) ** 1.5 * (0.7 + 0.6 * raysC(a * 48, r * 3.9)) + rngC());
  });
  paintRGBA(ctx, JET[0], JET[1], JET[2], JET[3], (ix, iy, out) => {
    const u = (ix + 0.5) / JET[2]; const q = ((iy + 0.5) / JET[3]) * 2 - 1;
    out[0] = mix(255, 190, u); out[1] = mix(255, 246, u); out[2] = 255;
    out[3] = 255 * sstep(u, 0, 0.04) * (1 - u) ** 0.8 * Math.exp(-((q * 1.7) ** 2)) * (1 - sstep(Math.abs(q), 0.8, 1));
  });
}

// A sheet along a centre line, mapped onto one atlas cell, u along it and v across.
function cometSheet(center, side, half, cell, { rows = 30, cols = 6 } = {}) {
  const pos = []; const uv = []; const idx = [];
  for (let i = 0; i <= rows; i++) {
    const s = i / rows;
    for (let j = 0; j <= cols; j++) {
      const q = (j / cols) * 2 - 1;
      const c = center(s); const d = side(s); const w = half(s) * q;
      pos.push(c[0] + d[0] * w, c[1] + d[1] * w, c[2] + d[2] * w);
      const t = cometUV(cell, s, q * 0.5 + 0.5);
      uv.push(t[0], t[1]);
    }
  }
  const r = cols + 1;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * r + j;
      idx.push(a, a + r, a + r + 1, a, a + r + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, color: 0xffffff };
}

// `count` squares through one point, their normals spread over a hemisphere, all reading one radial
// gradient cell. Two triangles each.
function crossedGlow(c, radius, cell, count) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (i + 0.5) / count;
    const ring = Math.sqrt(1 - y * y);
    const a = i * 2.39996;
    const n = V(Math.cos(a) * ring, y, Math.sin(a) * ring);
    const e1 = (Math.abs(n.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0)).cross(n).normalize();
    const e2 = n.clone().cross(e1).normalize();
    const pos = []; const uv = [];
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(c[0] + (e1.x * sx + e2.x * sy) * radius, c[1] + (e1.y * sx + e2.y * sy) * radius, c[2] + (e1.z * sx + e2.z * sy) * radius);
      const t = cometUV(cell, sx * 0.5 + 0.5, sy * 0.5 + 0.5);
      uv.push(t[0], t[1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    parts.push({ geometry: g, color: 0xffffff });
  }
  return parts;
}

function buildComet() {
  const { H, SUN_X, Z0, SUN_R, ION_END, COMA_R, RAIL, TILT } = COMET;
  const orbit = cometOrbit();
  const root = new THREE.Group();
  const [hx, hzp] = orbit.head;
  const head = cometWorld(hx, hzp);
  const sun = cometWorld(SUN_X, 0);

  // The plane's own axes, and the ion tail's direction, from the two positions.
  const ionU = V(head[0] - sun[0], head[1] - sun[1], head[2] - sun[2]).normalize();
  const planeZ = V(0, -Math.sin(TILT), Math.cos(TILT));
  const planeN = V(0, Math.cos(TILT), Math.sin(TILT));
  if (Math.abs(V(head[0] - sun[0], head[1] - sun[1], head[2] - sun[2]).cross(ionU).length()) > 1e-9) throw new Error('comet: the ion tail must point directly away from the lamp');
  const ionLen = (ION_END - hx) / ionU.x;
  if (ionLen < 12 || ionLen > 14) throw new Error('comet: the ion tail should be 12 to 14 feet long');
  const ionAt = (s) => [head[0] + ionU.x * ionLen * s, head[1] + ionU.y * ionLen * s, head[2] + ionU.z * ionLen * s];

  // The dust tail's two edges, and the fan between them.
  const N = 34;
  const edgeA = orbit.syndyne(0.75, 11.8, N);
  const edgeB = orbit.syndyne(2.6, 13.6, N);
  if (edgeA[N][1] <= hzp + 0.5 || edgeB[N][1] <= hzp + 0.5) throw new Error('comet: the dust tail must lag on the side the comet came from');
  const at = (edge, s) => {
    const f = clamp01(s) * N; const i = Math.min(N - 1, Math.floor(f)); const k = f - i;
    return [mix(edge[i][0], edge[i + 1][0], k), mix(edge[i][1], edge[i + 1][1], k)];
  };

  const glow = [];
  // ION: four sheets crossed about the one straight axis, so it has body from any side.
  const ionHalf = (s) => 0.14 + 1.5 * s ** 0.85;
  for (const d of [0, 45, 90, 135]) {
    const c = Math.cos(d * DEG); const n = Math.sin(d * DEG);
    const dir = [planeZ.x * c + planeN.x * n, planeZ.y * c + planeN.y * n, planeZ.z * c + planeN.z * n];
    glow.push(cometSheet(ionAt, () => dir, ionHalf, COMET_ATLAS.ION, { rows: 28, cols: 6 }));
  }
  // DUST: the broad fan lies in the orbit's plane between the two syndynes, drawn after the ion tail
  // since it is the nearer from the front. Sheets across it give it body from the side.
  const midP = (s) => { const a = at(edgeA, s); const b = at(edgeB, s); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
  const midAt = (s) => { const m = midP(s); return cometWorld(m[0], m[1]); };
  const across = (s) => {
    const a = at(edgeA, s); const b = at(edgeB, s);
    let dx = b[0] - a[0]; let dz = b[1] - a[1];
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) { dx = 0.4; dz = -1; }
    const L = Math.hypot(dx, dz);
    return [dx / L, dz / L];
  };
  const fanDir = (s) => { const q = across(s); return [q[0], -q[1] * Math.sin(TILT), q[1] * Math.cos(TILT)]; };
  const fanHalf = (s) => { const a = at(edgeA, s); const b = at(edgeB, s); return Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.56 + 0.1 + 0.9 * s; };
  for (const d of [62, 118, 90]) {
    const c = Math.cos(d * DEG); const n = Math.sin(d * DEG);
    glow.push(cometSheet(midAt, (s) => {
      const f = fanDir(s);
      return [f[0] * c + planeN.x * n, f[1] * c + planeN.y * n, f[2] * c + planeN.z * n];
    }, (s) => 0.1 + 1.55 * s ** 0.9, COMET_ATLAS.DUST, { rows: 28, cols: 6 }));
  }
  glow.push(cometSheet(midAt, fanDir, fanHalf, COMET_ATLAS.DUST, { rows: 36, cols: 10 }));

  // The lamp's corona, then the coma, whose centre slides tailward because the wind holds the sunward
  // side in, so the nucleus sits forward of the middle of its glow.
  glow.push(...crossedGlow(sun, 1.12, COMET_ATLAS.CORONA, 6));
  const comaC = [head[0] + ionU.x * 0.12, head[1], head[2]];
  glow.push(...crossedGlow(comaC, COMA_R, COMET_ATLAS.COMA, 10));
  // Gas jets off the sunlit side of the nucleus, bent round by the wind toward the tail. Soft ribbons,
  // two crossed to each jet.
  const toSun = ionU.clone().negate();
  const nucAxis = V(0.3, 0.88, 0.36).normalize();
  const nucSide = V().crossVectors(nucAxis, toSun).normalize();
  for (const [along, out, len] of [[0.75, 0.1, 2.3], [-0.68, 0.2, 2.5], [0.15, -0.55, 2.0], [-0.1, 0.55, 2.2], [0.42, -0.3, 1.8]]) {
    const start = V(...head).addScaledVector(nucAxis, along * 0.95).addScaledVector(nucSide, out * 0.4).addScaledVector(toSun, 0.12);
    const dir = toSun.clone().addScaledVector(nucAxis, along * 0.5).addScaledVector(nucSide, out).normalize();
    const p1 = start.clone().addScaledVector(dir, len * 0.72);
    const p2 = start.clone().addScaledVector(dir, len * 0.8).addScaledVector(ionU, len * 0.72).addScaledVector(nucAxis, along * 0.5);
    const center = (s) => {
      const a = (1 - s) ** 2; const b = 2 * s * (1 - s); const c = s * s;
      return [start.x * a + p1.x * b + p2.x * c, start.y * a + p1.y * b + p2.y * c, start.z * a + p1.z * b + p2.z * c];
    };
    const e1 = V().crossVectors(dir, nucAxis).normalize();
    const e2 = V().crossVectors(dir, e1).normalize();
    for (const e of [e1, e2]) {
      glow.push(cometSheet(center, () => [e.x, e.y, e.z], (s) => 0.05 + 0.62 * s, COMET_ATLAS.JET, { rows: 10, cols: 2 }));
    }
  }
  const atlas = canvasTexture(COMET_ATLAS.S, COMET_ATLAS.S, (ctx) => paintCometAtlas(ctx));
  atlas.wrapS = THREE.ClampToEdgeWrapping;
  atlas.wrapT = THREE.ClampToEdgeWrapping;
  const glowMesh = mesh(mergeParts(glow), glowMaterial(atlas, { side: THREE.DoubleSide, toneMapped: false, fog: false }));
  glowMesh.castShadow = false;
  glowMesh.receiveShadow = false;

  // The nucleus: a big dark peanut, its long axis across the view so the two lobes show, lit only from
  // the lamp, so the terminator runs down its length: bright rock and ice one side, black the other.
  const solid = [];
  const nuc = new Sculpt(0.045);
  const rock = lin(0x38332e);
  const lobeA = nucAxis.clone().multiplyScalar(-0.42); const lobeB = nucAxis.clone().multiplyScalar(0.62);
  const nRot = [0.32, 0.2, -0.3];
  nuc.add(ellipsoidP(lobeA.toArray(), [0.82, 0.76, 0.72], nRot), rock);
  nuc.add(ellipsoidP(lobeB.toArray(), [0.56, 0.6, 0.54], nRot), rock, { k: 0.3 });
  const rngN = seededRandom(2209);
  for (let i = 0; i < 26; i++) {
    const useA = rngN() > 0.38;
    const c = useA ? lobeA : lobeB; const R = useA ? 0.76 : 0.56;
    const yy = rngN() * 2 - 1; const az = rngN() * TAU; const ring = Math.sqrt(1 - yy * yy);
    const rr = 0.05 + rngN() ** 2 * 0.17;
    nuc.sub(sphereP([c.x + Math.cos(az) * ring * R, c.y + yy * R, c.z + Math.sin(az) * ring * R], rr), null, { k: 0.06 });
  }
  nuc.map((d, x, y, z) => d + 0.09 * (smoothNoise3(x * 2.6 + 2, y * 2.6, z * 2.6) - 0.5) * 2 + 0.035 * (smoothNoise3(x * 8, y * 8, z * 8 + 5) - 0.5) * 2);
  const nucG = polygonize(nuc, {
    normalH: 0.45,
    tint: (x, y, z, nx, ny, nz, out) => {
      const lit = Math.max(0, nx * toSun.x + ny * toSun.y + nz * toSun.z);
      const n = smoothNoise3(x * 5, y * 5, z * 5);
      const f = smoothNoise3(x * 15, y * 15, z * 15);
      const ice = sstep(n * 0.7 + f * 0.3, 0.68, 0.74) * sstep(lit, 0.3, 0.6);
      // Sunlit rock is warm and bright, and past the terminator there is almost nothing.
      const k = 0.022 + 1.5 * lit ** 0.8;
      const base = 0.24 + 0.3 * n + 0.16 * (f - 0.5);
      out[0] = clamp01(mix(base * k * 1.12, 1, ice * 0.9));
      out[1] = clamp01(mix(base * k * 0.86, 1, ice * 0.9));
      out[2] = clamp01(mix(base * k * 0.62 + 0.01, 1, ice * 0.9));
    },
  });
  nucG.translate(head[0], head[1], head[2]);
  solid.push({ geometry: nucG, keepColor: true });

  // The lamp: mottled, never one flat disc.
  const lamp = new THREE.SphereGeometry(SUN_R, 48, 32);
  tintVertices(lamp, (x, y, z, out) => {
    const f = 3.4;
    const n = smoothNoise3(x * f + 3, y * f, z * f) * 0.62 + smoothNoise3(x * f * 2.5, y * f * 2.5 + 2, z * f * 2.5) * 0.38;
    const t = sstep(n, 0.3, 0.72);
    out[0] = 1; out[1] = mix(0.2, 0.6, t); out[2] = mix(0, 0.1, t);
  });
  lamp.translate(...sun);
  solid.push({ geometry: lamp, keepColor: true });

  // The orbit: a slim rod along the conic itself, the lamp at its focus and the head on it.
  const arcColor = 0xc2183c;
  const arc = [];
  const NU0 = -158; const NU1 = 138;
  for (let i = 0; i <= 90; i++) {
    const [x, zp] = orbit.plane(mix(NU0, NU1, i / 90) * DEG);
    arc.push(cometWorld(x, zp));
  }
  solid.push({ geometry: tube(arc, 0.042, { steps: 130, sides: 7, round: 1 }), color: arcColor });
  // Which way it travels: a small head on each leg.
  for (const nuDeg of [-122, 118, 12]) {
    const a = cometWorld(...orbit.plane(nuDeg * DEG));
    const b = cometWorld(...orbit.plane((nuDeg + 3) * DEG));
    const g = lathe([[0, 0], [0.15, 0], [0, 0.42]], 12);
    g.rotateX(Math.PI / 2);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), V(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize()));
    g.translate(a[0], a[1], a[2]);
    solid.push({ geometry: g, color: arcColor });
  }
  // The small comets, each tail computed straight away from the lamp.
  const MINI = [-150, -95, -58, 58, 95, 136];
  const miniBlue = lin(0x0d5cff); const miniPale = lin(0x8fd0ff);
  for (const nuDeg of MINI) {
    const [x, zp] = orbit.plane(nuDeg * DEG);
    const p = V(...cometWorld(x, zp));
    const u = p.clone().sub(V(...sun)).normalize();
    if (Math.abs(u.dot(p.clone().sub(V(...sun)).normalize()) - 1) > 1e-9) throw new Error('comet: a small comet’s tail must point away from the lamp');
    const end = p.clone().addScaledVector(u, 1.05);
    const tail = tube([p.toArray(), end.toArray()], [0.13, 0.008], { straight: true, steps: 6, sides: 9, round: 0 });
    tintVertices(tail, (tx, ty, tz, out) => {
      const t = clamp01(((tx - p.x) * u.x + (ty - p.y) * u.y + (tz - p.z) * u.z) / 1.05);
      out[0] = mix(miniPale[0], miniBlue[0], sstep(t, 0, 0.5)); out[1] = mix(miniPale[1], miniBlue[1], sstep(t, 0, 0.5)); out[2] = mix(miniPale[2], miniBlue[2], sstep(t, 0, 0.5));
    });
    solid.push({ geometry: tail, keepColor: true });
    solid.push({ geometry: new THREE.SphereGeometry(0.15, 14, 10).translate(p.x, p.y, p.z), color: 0x4a4038 });
  }

  // Label leaders end on a small bead in the thing they name.
  const leader = (from, to) => {
    solid.push({ geometry: rod(from, to, 0.016, 6, 1), color: 0x2b2a2c });
    solid.push({ geometry: new THREE.SphereGeometry(0.06, 10, 8).translate(to[0], to[1], to[2]), color: 0xffe48a });
  };

  // The stand: one slim low rail under the lamp, the head and the tails' label post.
  const frame = [];
  const dark = 0x23252d;
  frame.push({ geometry: outlineSlab(roundedRect(RAIL[0], RAIL[1], Z0 - 0.42, Z0 + 0.42, 0.34), 0, 0.15, () => [0, 0], 0.03), color: dark });
  frame.push({ geometry: block(RAIL[0] + 0.3, 0.145, Z0 - 0.025, RAIL[1] - 0.3, 0.158, Z0 + 0.025), color: 0xa98a4a });
  const postAt = (x, topY, r) => {
    frame.push({ geometry: lathe([[0, 0.14], [0.36, 0.14], [0.36, 0.2], [0.14, 0.27], [r * 1.4, 0.4], [0, 0.42]], 28).translate(x, 0, Z0), color: dark });
    frame.push({ geometry: rod([x, 0.3, Z0], [x, topY, Z0], r, 12, 1), color: dark });
  };
  postAt(SUN_X, H - SUN_R * 0.75, 0.07);
  frame.push({ geometry: lathe([[0, -0.24], [0.2, -0.24], [0.22, -0.12], [0.07, -0.02], [0, 0]], 22).translate(sun[0], H - SUN_R + 0.03, sun[2]), color: dark });
  postAt(hx, H - 0.45, 0.06);
  const TAIL_POST = 2.7;
  postAt(TAIL_POST, 3.7, 0.055);
  // A short strut from the lamp's post carries the orbit where it swings closest.
  {
    const [px, pzp] = orbit.plane(0);
    const peri = cometWorld(px, pzp);
    frame.push({ geometry: rod([SUN_X, H - SUN_R - 0.18, Z0], peri, 0.026, 8, 1), color: dark });
  }

  // The five plates, upright on their posts, near a student's eye line.
  const entries = [
    { w: 1.1, h: 0.46, lines: ['SUN'] },
    { w: 1.85, h: 0.46, lines: ['NUCLEUS'] },
    { w: 1.3, h: 0.46, lines: ['COMA'] },
    { w: 1.75, h: 0.46, lines: ['ION TAIL'] },
    { w: 1.95, h: 0.46, lines: ['DUST TAIL'] },
  ];
  const { texture, rects } = plateAtlas(entries);
  const plates = [];
  const plateOn = (i, postX, side, y) => {
    const { w, h } = entries[i];
    const x = side === 0 ? postX : postX + side * (w / 2 + 0.1);
    plates.push({ geometry: placed(printedPlate(w, h, 0.04, rects[i]), [x, y, Z0 + 0.1], {}), keepColor: true });
    frame.push({ geometry: block(Math.min(postX, x - w * 0.3), y - 0.09, Z0 + 0.0, Math.max(postX, x + w * 0.3), y + 0.09, Z0 + 0.07), color: dark });
    return [x, y + h / 2, Z0 + 0.06];
  };
  plateOn(0, SUN_X, 0, 3.7);
  const nucTop = plateOn(1, hx, -1, 2.45);
  const comaTop = plateOn(2, hx, 1, 2.45);
  const ionTop = plateOn(3, TAIL_POST, -1, 3.35);
  const dustTop = plateOn(4, TAIL_POST, 1, 3.35);
  leader(nucTop, [head[0] - 0.22, head[1] - 0.62, head[2] + 0.34]);
  leader(comaTop, [comaC[0] + 1.25, comaC[1] - 1.45, comaC[2] + 0.2]);
  const ionX = (ionTop[0] - hx) / (ionLen * ionU.x);
  leader(ionTop, ionAt(ionX));
  let dustS = 0.5;
  for (let s = 0.1; s < 0.95; s += 0.01) { if (midAt(s)[0] > dustTop[0] + 0.5) { dustS = s; break; } }
  leader(dustTop, midAt(dustS));

  const solidMesh = mesh(mergeParts(solid), unlit({ toneMapped: false }));
  solidMesh.receiveShadow = false;
  const frameMesh = mesh(mergeParts(frame), standard({ vertexColors: true, roughness: 0.6, metalness: 0.15 }));
  const plateMesh = mesh(mergeParts(plates), standard({ map: texture, roughness: 0.6, metalness: 0, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.35 }));
  root.add(frameMesh, solidMesh, plateMesh, glowMesh);
  return root;
}

// ===========================================================================================
// THE EARTH MAP, as Science5 paints it: real coasts by longitude and latitude
// ===========================================================================================
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

// Colours a sphere by how squarely each vertex faces one point, the light being worked out here and
// not left to whatever sky the model is standing under. `floor` keeps a night side legible.
function litFrom(geometry, light, floor = 0.1, tone = [1, 1, 1]) {
  const p = geometry.attributes.position;
  const n = geometry.attributes.normal;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const dx = light[0] - p.getX(i); const dy = light[1] - p.getY(i); const dz = light[2] - p.getZ(i);
    const l = Math.hypot(dx, dy, dz) || 1;
    const k = Math.max(0, (n.getX(i) * dx + n.getY(i) * dy + n.getZ(i) * dz) / l);
    const b = floor + (1 - floor) * sstep(k, -0.02, 0.5);
    col[i * 3] = tone[0] * b; col[i * 3 + 1] = tone[1] * b; col[i * 3 + 2] = tone[2] * b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return { geometry, keepColor: true };
}

// Remaps a geometry's uv into one rectangle of an atlas.
function intoCell(geometry, [u0, v0, u1, v1]) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, mix(u0, u1, uv.getX(i)), mix(v0, v1, uv.getY(i)));
  return geometry;
}

// A disc of a small circle on a globe, as [lon, lat] points in degrees.
function smallCircle(latDeg, lonDeg, radiusDeg, n = 40) {
  const la = latDeg * DEG; const r = radiusDeg * DEG;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const b = (i / n) * TAU;
    const lat = Math.asin(Math.sin(la) * Math.cos(r) + Math.cos(la) * Math.sin(r) * Math.cos(b));
    const lon = lonDeg * DEG + Math.atan2(Math.sin(b) * Math.sin(r) * Math.cos(la), Math.cos(r) - Math.sin(la) * Math.sin(lat));
    pts.push([lon / DEG, lat / DEG]);
  }
  return pts;
}

// ===========================================================================================
// THE SOLAR ECLIPSE BENCH
// ===========================================================================================
//
// Three balls on one line, and two cones that are not drawn but solved. The radii are for clarity,
// and the one thing fixed is the fact the bench exists to show: THE MOON IS PLACED WHERE THE TIP OF ITS
// UMBRA JUST REACHES THE EARTH. An outer tangent from the Sun's edge to the Moon's edge meets the axis
// at the umbra's apex, with sin(alpha) = R / (distance from the Sun) = r / (distance from the Moon).
// Fix the apex on the Earth's surface and pick r, and that gives the Moon's position with no choice
// left. That is why, seen from the tip, the Sun and the Moon are exactly the same angular size, which
// is the card's "400 times wider and 400 times farther" with other numbers. The inner tangents cross
// between the Sun and the Moon, and bound the penumbra. All of it is asserted in the builder.

export const ECLIPSE = {
  Y: 4.05, Z: -0.7, SUN_X: -6.4, SUN_R: 1.35, EARTH_X: 6.55, EARTH_R: 1.15, MOON_R: 0.28, BENCH: 1.2,
  EARTH_LAT: 23.4, EARTH_LON: -100,
};

export function eclipseGeometry() {
  const { SUN_X, SUN_R: R, EARTH_X, EARTH_R: Re, MOON_R: r } = ECLIPSE;
  const apex = EARTH_X - Re;
  const a = apex - SUN_X;
  const D = a * (1 - r / R);
  const moonX = SUN_X + D;
  const sinA = R / a; const cosA = Math.sqrt(1 - sinA * sinA);
  const tanA = sinA / cosA;
  // Touch points of the outer tangent, in (x, rho).
  const outerSun = [SUN_X + R * sinA, R * cosA];
  const outerMoon = [moonX + r * sinA, r * cosA];
  // The inner tangents cross here.
  const crossX = moonX - (D * r) / (R + r);
  const sinB = (R + r) / D; const cosB = Math.sqrt(1 - sinB * sinB);
  const tanB = sinB / cosB;
  const innerMoon = [moonX - r * sinB, r * cosB];
  const innerSun = [SUN_X + R * sinB, -R * cosB];
  // Where the inner tangent lands on the Earth: the nearer root of line against sphere.
  const A = 1 + tanB * tanB;
  const Bq = -2 * EARTH_X - 2 * crossX * tanB * tanB;
  const Cq = EARTH_X * EARTH_X + crossX * crossX * tanB * tanB - Re * Re;
  const disc = Bq * Bq - 4 * A * Cq;
  const landX = (-Bq - Math.sqrt(disc)) / (2 * A);
  const landRho = (landX - crossX) * tanB;
  const penumbraDeg = Math.atan2(landRho, EARTH_X - landX) / DEG;
  return { apex, a, D, moonX, sinA, cosA, tanA, outerSun, outerMoon, crossX, sinB, cosB, tanB, innerMoon, innerSun, landX, landRho, penumbraDeg, disc };
}

const ECL_ATLAS = {
  S: 1024, EARTH: [0, 0, 1024, 508], SUN: [0, 516, 504, 252], MOON: [0, 772, 504, 252], SKY: [516, 516, 508, 508],
};
const eclCell = ([x, y, w, h]) => {
  const S = ECL_ATLAS.S;
  return [(x + 1) / S, 1 - (y + h - 1) / S, (x + w - 1) / S, 1 - (y + 1) / S];
};

function paintEclipseAtlas(ctx, geo) {
  const { EARTH_LAT, EARTH_LON, EARTH_R } = ECLIPSE;
  const [ex, ey, ew, eh] = ECL_ATLAS.EARTH;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ex, ey, ew, eh);
  ctx.clip();
  paintEarthMap(ctx, ew, eh, { seed: 7301, detail: 0.5 });
  // The soft penumbra, darkest at the middle, out to the exact radius where the inner tangent lands.
  const px = (lon) => ((lon + 180) / 360) * ew;
  const py = (lat) => ((90 - lat) / 180) * eh;
  const layers = 26;
  const umbraDeg = (0.075 / EARTH_R) / DEG;
  for (let i = 0; i < layers; i++) {
    const rad = mix(geo.penumbraDeg, umbraDeg, i / layers);
    ctx.fillStyle = 'rgba(4,5,14,0.05)';
    ctx.beginPath();
    smallCircle(EARTH_LAT, EARTH_LON, rad).forEach(([lon, lat], k) => (k ? ctx.lineTo(px(lon), py(lat)) : ctx.moveTo(px(lon), py(lat))));
    ctx.closePath();
    ctx.fill();
  }
  // The outer edge of the penumbra as a fine line, since a soft edge has nowhere to be pointed at.
  ctx.strokeStyle = 'rgba(255,236,170,0.75)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  smallCircle(EARTH_LAT, EARTH_LON, geo.penumbraDeg, 72).forEach(([lon, lat], k) => (k ? ctx.lineTo(px(lon), py(lat)) : ctx.moveTo(px(lon), py(lat))));
  ctx.closePath();
  ctx.stroke();
  // The umbra's spot, with a hard edge, since inside it the Sun is simply gone.
  ctx.fillStyle = '#02030a';
  ctx.beginPath();
  smallCircle(EARTH_LAT, EARTH_LON, umbraDeg).forEach(([lon, lat], k) => (k ? ctx.lineTo(px(lon), py(lat)) : ctx.moveTo(px(lon), py(lat))));
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // The Sun: granulated, with a few spot groups, so it is never one flat disc.
  const [sx, sy, sw, sh] = ECL_ATLAS.SUN;
  const g1 = periodicNoise(7302, 150, 76);
  const g2 = periodicNoise(7303, 48, 24);
  const g3 = periodicNoise(7308, 12, 6);
  const stops = [[0, 214, 84, 10], [0.45, 244, 140, 26], [0.75, 252, 182, 52], [1, 255, 222, 112]];
  const rgb = [0, 0, 0];
  const spots = [[0.2, 0.42, 0.018], [0.225, 0.44, 0.011], [0.62, 0.58, 0.02], [0.64, 0.56, 0.01], [0.86, 0.38, 0.014]];
  paintRGBA(ctx, sx, sy, sw, sh, (ix, iy, out) => {
    const u = ix / sw; const v = iy / sh;
    // A warp, or the lattice shows as squares. It is periodic too, so it adds no seam.
    const wu = u + (g2(u * 48 + 11, v * 24) - 0.5) * 0.022;
    const wv = v + (g2(u * 48, v * 24 + 7) - 0.5) * 0.04;
    const t = g1(wu * 150, wv * 75) * 0.42 + g2(wu * 48, wv * 24) * 0.36 + g3(u * 12, v * 6) * 0.22;
    rampInto(stops, sstep(t, 0.26, 0.74), rgb);
    let k = 1;
    for (const [su, sv, sr] of spots) {
      const d = Math.hypot((u - su) * 2, v - sv);
      k = Math.min(k, 0.12 + 0.88 * sstep(d, sr * 0.6, sr * 1.25));
    }
    out[0] = rgb[0] * k; out[1] = rgb[1] * k; out[2] = rgb[2] * k;
  });

  // The Moon: grey, with dark maria and bright craters.
  const [mx, my, mw, mh] = ECL_ATLAS.MOON;
  const m1 = periodicNoise(7304, 12, 6);
  const m2 = periodicNoise(7305, 60, 30);
  paintRGBA(ctx, mx, my, mw, mh, (ix, iy, out) => {
    const u = ix / mw; const v = iy / mh;
    const mare = sstep(m1(u * 12, v * 6), 0.46, 0.6);
    const fine = m2(u * 60, v * 30);
    const b = mix(178, 108, mare) + (fine - 0.5) * 46;
    out[0] = b; out[1] = b * 0.985; out[2] = b * 0.96;
  });

  // The sky inside the umbra: the Moon's black disc and the white corona, with streamers that run out
  // along the Sun's equator and short brushes at its poles.
  const [kx, ky, ks] = ECL_ATLAS.SKY;
  const c1 = periodicNoise(7306, 48, 8);
  const c2 = periodicNoise(7307, 128, 12);
  const rimR = 0.23; // of the half width
  paintRGBA(ctx, kx, ky, ks, ks, (ix, iy, out) => {
    const x = ((ix + 0.5) / ks) * 2 - 1; const y = ((iy + 0.5) / ks) * 2 - 1;
    const r = Math.hypot(x, y);
    const a = Math.atan2(y, x);
    if (r <= rimR) { out[0] = 1; out[1] = 1; out[2] = 3; return; }
    const az = (a + Math.PI) / TAU;
    const rays = c1(az * 48, r * 2.5) * 0.45 + c2(az * 128, r * 3) * 0.55;
    const lobes = Math.abs(Math.cos(a + 0.35)) ** 4;
    const fall = (rimR / r) ** (3.4 - 1.5 * lobes);
    const v = clamp01(fall * (0.72 + 0.75 * sstep(rays, 0.3, 0.7)) * (0.72 + 0.7 * lobes));
    const rim = 1 - sstep(r, rimR, rimR * 1.07);
    const w = clamp01(v + rim);
    out[0] = mix(8, 255, w); out[1] = mix(12, 255, w); out[2] = mix(30, 252, w);
  });
  // Three small pink prominences on the limb, and a couple of stars, the planets you can see then.
  const cx = kx + ks / 2; const cy = ky + ks / 2; const hw = ks / 2;
  for (const [a, sz] of [[0.6, 0.016], [2.7, 0.012], [4.4, 0.02]]) {
    ctx.fillStyle = '#ff6d8c';
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * hw * (rimR + 0.006), cy + Math.sin(a) * hw * (rimR + 0.006), hw * sz * 1.6, hw * sz, a + Math.PI / 2, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#10121e';
  ctx.beginPath();
  ctx.arc(cx, cy, hw * rimR * 0.985, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  for (const [dx, dy, sz] of [[-0.74, -0.52, 0.012], [0.7, 0.56, 0.009], [0.66, -0.68, 0.007], [-0.6, 0.72, 0.006]]) {
    ctx.beginPath();
    ctx.arc(cx + dx * hw, cy + dy * hw, sz * hw, 0, TAU);
    ctx.fill();
  }
}

function buildSolarEclipse() {
  const { Y, Z, SUN_X, SUN_R, EARTH_X, EARTH_R, MOON_R, BENCH, EARTH_LAT, EARTH_LON } = ECLIPSE;
  const geo = eclipseGeometry();
  const { moonX, apex, tanA, tanB, crossX, landX, landRho, outerSun, outerMoon, innerSun, innerMoon } = geo;

  // The whole lesson, checked every time it is built.
  const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
  if (!near(apex, EARTH_X - EARTH_R)) throw new Error('solar-eclipse: the umbra tip must lie on the Earth');
  if (!near((apex - SUN_X) * geo.sinA, SUN_R) || !near((apex - moonX) * geo.sinA, MOON_R)) throw new Error('solar-eclipse: the outer tangent must touch both spheres');
  if (!near((moonX - crossX) * geo.sinB, MOON_R) || !near((crossX - SUN_X) * geo.sinB, SUN_R)) throw new Error('solar-eclipse: the inner tangent must touch both spheres');
  if (!near(Math.hypot(landX - EARTH_X, landRho), EARTH_R, 1e-7)) throw new Error('solar-eclipse: the penumbra must land on the Earth');
  if (geo.disc <= 0 || landRho >= EARTH_R) throw new Error('solar-eclipse: the penumbra must land on the near face of the Earth');
  if (!near(Math.asin(SUN_R / (apex - SUN_X)), Math.asin(MOON_R / (apex - moonX)))) throw new Error('solar-eclipse: from the tip the Sun and Moon must look the same size');

  const root = new THREE.Group();
  const P = (x, rho = 0, side = 1) => [x, Y + side * rho, Z];

  // The three bodies, all on the line, all lit by arithmetic from the Sun's centre.
  const atlasMap = canvasTexture(ECL_ATLAS.S, ECL_ATLAS.S, (ctx) => paintEclipseAtlas(ctx, geo));
  atlasMap.anisotropy = 8;
  const bodies = [];
  const light = [SUN_X, Y, Z];
  const sunG = intoCell(new THREE.SphereGeometry(SUN_R, 72, 48), eclCell(ECL_ATLAS.SUN));
  sunG.translate(SUN_X, Y, Z);
  bodies.push({ geometry: sunG, color: 0xffffff });

  const moonG = intoCell(new THREE.SphereGeometry(MOON_R, 48, 32), eclCell(ECL_ATLAS.MOON));
  moonG.translate(moonX, Y, Z);
  bodies.push(litFrom(moonG, light, 0.13));

  // The Earth, axis tipped toward the Sun, turned so its printed spot is on the line.
  const earthG = intoCell(new THREE.SphereGeometry(EARTH_R, 96, 64), eclCell(ECL_ATLAS.EARTH));
  const phi = (EARTH_LON + 180) * DEG;
  earthG.rotateY(-phi);
  earthG.rotateZ(EARTH_LAT * DEG);
  earthG.translate(EARTH_X, Y, Z);
  bodies.push(litFrom(earthG, light, 0.3));

  // The sky inside the umbra, a printed disc in a brass rim on its own low stand.
  const INSET = { x: -0.9, z: 2.4, y: 2.35, r: 1.08, tilt: 24 * DEG };
  const face = new THREE.CircleGeometry(INSET.r, 72);
  intoCell(face, eclCell(ECL_ATLAS.SKY));
  const placeInset = (g) => placed(g, [INSET.x, INSET.y, INSET.z], { tilt: INSET.tilt });
  bodies.push({ geometry: placeInset(face), color: 0xffffff });

  const bodyMesh = mesh(mergeParts(bodies), unlit({ map: atlasMap }));
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = false;

  // The cones and the corona: one transparent mesh. The penumbra first, then the umbra inside it.
  const glow = [];
  const penumbraG = tube([P(innerMoon[0]), P(landX)], [innerMoon[1], landRho], { straight: true, steps: 24, sides: 60, round: 0 });
  glow.push(paintGlow(penumbraG, (x, y, z, out) => {
    out[0] = 0.015; out[1] = 0.018; out[2] = 0.05;
    out[3] = 0.2;
  }));
  const umbraG = tube([P(outerMoon[0]), P(apex)], [outerMoon[1], 0.0005], { straight: true, steps: 24, sides: 40, round: 0 });
  glow.push(paintGlow(umbraG, (x, y, z, out) => { out[0] = 0; out[1] = 0; out[2] = 0.01; out[3] = 0.62; }));
  // The corona: nested lumps, then soft streamers, all fading outward.
  const coronaCol = lin(0xffe6a8);
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    glow.push(glowShell(light, SUN_R * mix(1.62, 1.03, t), coronaCol, mix(0.012, 0.07, t), { lump: 0.1, freq: 2.8, seed: 3.1, ws: 30, hs: 18 }));
  }
  const rngC = seededRandom(7311);
  for (let i = 0; i < 60; i++) {
    const zz = rngC() * 2 - 1;
    const az = rngC() * TAU;
    const ring = Math.sqrt(1 - zz * zz);
    const d = [Math.cos(az) * ring, zz, Math.sin(az) * ring];
    const len = SUN_R * mix(1.42, 2.1, rngC() ** 1.6);
    const a = [light[0] + d[0] * SUN_R * 0.96, light[1] + d[1] * SUN_R * 0.96, light[2] + d[2] * SUN_R * 0.96];
    const b = [light[0] + d[0] * len, light[1] + d[1] * len, light[2] + d[2] * len];
    const g = tube([a, b], [SUN_R * mix(0.035, 0.075, rngC()), 0.006], { straight: true, steps: 8, sides: 6, round: 0 });
    glow.push(paintGlow(g, (x, y, z, out) => {
      const r = Math.hypot(x - light[0], y - light[1], z - light[2]);
      out[0] = coronaCol[0]; out[1] = coronaCol[1]; out[2] = coronaCol[2];
      out[3] = 0.24 * (1 - sstep(r, SUN_R, len));
    }));
  }
  const glowMesh = mesh(mergeParts(glow), glowMaterial(alphaRamp()));
  glowMesh.castShadow = false;
  glowMesh.receiveShadow = false;

  // The true tangent lines, in the one upright plane: thin rods, so the cones can be seen being made.
  const lines = [];
  const thin = 0.011;
  // An inner tangent runs from one side of the Sun, through the crossing, to the other side of the Earth.
  for (const side of [1, -1]) {
    lines.push({ geometry: rod(P(outerSun[0], outerSun[1], side), P(apex), thin, 6, 1), color: 0xffe9b0 });
    lines.push({ geometry: rod(P(innerSun[0], -innerSun[1], -side), P(landX, landRho, side), thin, 6, 1), color: 0xe0a24e });
  }

  // Bench, stalks and lecterns.
  const dark = 0x23252d;
  const frame = [];
  frame.push({ geometry: outlineSlab(roundedRect(-8.1, 8.1, Z - 1.25, Z + 1.25, 0.32), BENCH - 0.2, BENCH, () => [0, 0]), color: dark });
  for (const x of [-6.2, 6.2]) {
    frame.push({ geometry: block(x - 0.16, 0.14, Z - 0.75, x + 0.16, BENCH - 0.18, Z + 0.75), color: 0x1b1d24 });
    frame.push({ geometry: block(x - 0.42, 0, Z - 1.05, x + 0.42, 0.15, Z + 1.05), color: 0x1b1d24 });
  }
  frame.push({ geometry: block(-6.1, 0.48, Z - 0.1, 6.1, 0.72, Z + 0.1), color: 0x1b1d24 });
  // A brass line inlaid under the axis, a hair proud, the line the three stand on.
  frame.push({ geometry: block(SUN_X, BENCH - 0.005, Z - 0.02, EARTH_X, BENCH + 0.006, Z + 0.02), color: 0xb08f4c });
  const stalk = (x, topY, r) => {
    frame.push({ geometry: lathe([[0, BENCH - 0.02], [r * 5, BENCH - 0.02], [r * 5, BENCH + 0.05], [r * 2.2, BENCH + 0.11], [r * 1.3, BENCH + 0.22], [0, BENCH + 0.24]], 28).translate(x, 0, Z), color: dark });
    frame.push({ geometry: rod([x, BENCH + 0.1, Z], [x, topY, Z], r, 10, 1), color: dark });
  };
  stalk(SUN_X, Y - SUN_R * 0.8, 0.075);
  stalk(moonX, Y - MOON_R * 0.5, 0.035);
  stalk(EARTH_X, Y - EARTH_R * 0.8, 0.06);

  // The inset's stand, rim and back.
  slimStand(frame, 0.95, INSET.y - 0.05, { x: INSET.x, z: INSET.z - 0.06, post: 0.05 });
  const rim = lathe([[0, -0.1], [INSET.r + 0.05, -0.1], [INSET.r + 0.09, -0.07], [INSET.r + 0.09, 0.03], [INSET.r + 0.04, 0.05], [INSET.r, 0.02], [INSET.r, -0.012], [0, -0.012]], 72);
  rim.rotateX(Math.PI / 2);
  frame.push({ geometry: placeInset(rim), color: 0xa98a4a });

  // Printed plates.
  const entries = [
    { w: 0.9, h: 0.28, lines: ['SUN'] },
    { w: 0.95, h: 0.28, lines: ['MOON'] },
    { w: 1.05, h: 0.28, lines: ['EARTH'] },
    { w: 1.1, h: 0.28, lines: ['UMBRA'] },
    { w: 1.45, h: 0.28, lines: ['PENUMBRA'] },
    { w: 2.3, h: 0.28, lines: ['SIZES AND DISTANCES NOT TO SCALE'] },
    { w: 1.7, h: 0.42, lines: ['THE SKY FROM', 'INSIDE THE UMBRA'] },
  ];
  const { texture, rects } = plateAtlas(entries);
  const plates = [];
  const lectern = (i, x, z = Z + 0.82, y = BENCH) => {
    const { w, h } = entries[i];
    const g = placed(printedPlate(w, h, 0.03, rects[i]), [x, y + 0.2, z], { tilt: 40 * DEG });
    plates.push({ geometry: g, keepColor: true });
    frame.push({ geometry: block(x - w * 0.3, y - 0.01, z - 0.17, x + w * 0.3, y + 0.2, z - 0.03), color: dark });
  };
  lectern(0, SUN_X);
  lectern(1, moonX - 0.55);
  lectern(2, EARTH_X);
  lectern(3, 3.65);
  lectern(4, 5.05 - 0.15);
  lectern(5, -3.75);
  // The inset's own plate, at the foot of its stand.
  {
    const { w, h } = entries[6];
    const z = INSET.z + 0.42;
    plates.push({ geometry: placed(printedPlate(w, h, 0.03, rects[6]), [INSET.x, 0.38, z], { tilt: 42 * DEG }), keepColor: true });
    frame.push({ geometry: block(INSET.x - 0.45, 0.1, z - 0.2, INSET.x + 0.45, 0.38, z - 0.05), color: dark });
  }

  // Leaders to the two cones: a bead on the axis for the umbra, and on the outer edge for the penumbra.
  const leader = (from, to) => {
    lines.push({ geometry: rod(from, to, 0.011, 6, 1), color: 0x8f8263 });
    lines.push({ geometry: new THREE.SphereGeometry(0.038, 10, 8).translate(to[0], to[1], to[2]), color: 0xf4e7bd });
  };
  const umbraBeadX = mix(outerMoon[0], apex, 0.42);
  leader([3.65, BENCH + 0.22, Z + 0.68], P(umbraBeadX, (apex - umbraBeadX) * tanA * 0.2, -1));
  const penX = mix(innerMoon[0], landX, 0.82);
  leader([4.9, BENCH + 0.22, Z + 0.68], P(penX, (penX - crossX) * tanB * 0.92, -1));

  const lineMesh = mesh(mergeParts(lines), unlit());
  lineMesh.castShadow = false;
  lineMesh.receiveShadow = false;
  const frameMesh = mesh(mergeParts(frame), standard({ vertexColors: true, roughness: 0.62, metalness: 0.12 }));
  const plateMesh = mesh(mergeParts(plates), standard({ map: texture, roughness: 0.6, metalness: 0, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.35 }));
  root.add(frameMesh, bodyMesh, lineMesh, plateMesh, glowMesh);
  return root;
}

// ===========================================================================================
// EARTH'S MAGNETIC FIELD
// ===========================================================================================
//
// Every field line starts as the textbook dipole, r = L R sin^2(theta), about a dipole axis 11 degrees
// from the spin axis, pointing at the geomagnetic pole in Arctic Canada, then goes through one smooth
// analytic deformation. Inside about 1.1 Earth radii the deformation is exactly nothing, so every line
// enters the planet at the true dipole footprint, at colatitude asin(1 / sqrt(L)).
//
// THE DEFORMATION: a soft limit at the magnetopause, using Shue's shape r0 (2 / (1 + cos A))^alpha with A
// measured from the sunward direction, which is what compresses the day side. A soft limit on the
// distance from the Sun-Earth line, which is what makes the far field a tail rather than a balloon.
// And a stretch along +X growing with distance on the night side. The real standoff is about 10 Earth
// radii and the real tail hundreds; the card says the field is much shortened, and it is.
//
// The field runs out of the planet near the south and back in near the north, as the small arrowheads
// show, which is why a compass's north end points north. The lobe lines are open, cut at the tail.

export const MAGNETO = {
  R: 3, CY: 6.3, SPIN: 23.4 * DEG, DIPOLE: 11, POLE_LAT: 79, POLE_LON: -72, FACE_LON: -110,
  R0: 5.2, ALPHA: 0.5, RHO_MAX: 5.45, X_LIM: 9.5, X_TAIL: 9.2, NOSE: 6.3, RC: 5.2,
};

export function magnetoFrames() {
  const { SPIN, FACE_LON, POLE_LAT, POLE_LON, DIPOLE } = MAGNETO;
  const gamma = (-90 - FACE_LON) * DEG;
  const body = new THREE.Matrix4().makeRotationZ(-SPIN).multiply(new THREE.Matrix4().makeRotationY(gamma));
  const dirOf = (lat, lon) => {
    const phi = (lon + 180) * DEG; const la = lat * DEG;
    return V(-Math.cos(phi) * Math.cos(la), Math.sin(la), Math.sin(phi) * Math.cos(la));
  };
  const spinAxis = V(0, 1, 0).applyMatrix4(body).normalize();
  const dipole = dirOf(POLE_LAT, POLE_LON).applyMatrix4(body).normalize();
  // In the dipole's frame, longitude zero is the plane holding the Sun.
  const e1 = V(-1, 0, 0).addScaledVector(dipole, dipole.x).normalize();
  const e2 = V().crossVectors(dipole, e1).normalize();
  return { body, dirOf, spinAxis, dipole, e1, e2, angle: spinAxis.angleTo(dipole) / DEG, expected: DIPOLE };
}

// One deformation for everything: p is relative to the Earth's centre. Written to be the identity
// inside g's lower bound, smooth everywhere, and to leave the sign of x alone.
export function magnetoDeform(p) {
  const { R, R0, ALPHA, RHO_MAX, X_LIM } = MAGNETO;
  const x = p.x; const y = p.y; const z = p.z;
  const r = Math.hypot(x, y, z);
  if (r < 1e-6) return p.clone();
  const g = sstep(r / R, 1.08, 2.3);
  const cosA = clamp01((1 - x / r) / 2) * 2 - 1; // -x / r, safely
  const rmp = R0 * (2 / Math.max(0.04, 1 + cosA)) ** ALPHA;
  const r1 = (r ** -4 + rmp ** -4) ** -0.25;
  const k = mix(1, r1 / r, g);
  let nx = x * k; let ny = y * k; let nz = z * k;
  const rho = Math.hypot(ny, nz);
  if (rho > 1e-6) {
    const rho1 = (rho ** -4 + RHO_MAX ** -4) ** -0.25;
    const m = mix(1, rho1 / rho, g);
    ny *= m; nz *= m;
  }
  const u = Math.max(0, x / r);
  nx *= 1 + g * u * u * 0.26 * Math.max(0, r / R - 1);
  // The tail is much shortened, as the card says, so a closed line closes before the model ends.
  if (nx > 1e-6) nx = (nx ** -5 + X_LIM ** -5) ** -0.2;
  return V(nx, ny, nz);
}

// A dipole line as a list of points, plunging below the surface at both ends.
export function dipoleLine(L, lambda, frames, n) {
  const { R } = MAGNETO;
  const { dipole, e1, e2 } = frames;
  const foot = Math.asin(Math.sqrt(0.92 / L)); // r = 0.92 R, inside the planet
  const out = [];
  for (let i = 0; i <= n; i++) {
    const th = mix(foot, Math.PI - foot, i / n);
    const r = L * R * Math.sin(th) ** 2;
    const across = e1.clone().multiplyScalar(Math.cos(lambda)).addScaledVector(e2, Math.sin(lambda));
    out.push(across.multiplyScalar(r * Math.sin(th)).addScaledVector(dipole, r * Math.cos(th)));
  }
  return out;
}

// Deep, saturated colour with no tone mapping: these have to read against a pale sky and green hills.
const MAG_LINES = [
  { L: 2.2, color: 0x0048ff, lons: 4 },
  { L: 3.0, color: 0x1c14e8, lons: 6 },
  { L: 4.4, color: 0x7000d8, lons: 6 },
  { L: 7.5, color: 0xb800b0, lons: 4 },
];
const MAG_LOBES = [{ L: 16, color: 0xe00070 }];

function coneAt(p, dir, len, r) {
  const g = lathe([[0, 0], [r, 0], [0, len]], 14);
  g.rotateX(Math.PI / 2);
  const d = dir.clone().normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d);
  g.applyQuaternion(q);
  g.translate(p.x, p.y, p.z);
  return g;
}

function buildMagnetosphere() {
  const { R, CY, X_TAIL, NOSE, RC, DIPOLE } = MAGNETO;
  const frames = magnetoFrames();
  if (Math.abs(frames.angle - DIPOLE) > 0.6) throw new Error(`earth-magnetosphere: the dipole is ${frames.angle.toFixed(2)} degrees from the spin axis`);
  const root = new THREE.Group();
  const O = V(0, CY, 0);
  const toWorld = (v) => v.clone().add(O);

  // The Earth, in its body frame, with a wedge left out of the grid so the wall lines up exactly.
  const ROWS = 64; const COLS = 96;
  const HOLE = { i0: 14, i1: 29, j0: 16, j1: 28 };
  const latOf = (i) => -90 + (i / ROWS) * 180;
  const lonOf = (j) => -180 + (j / COLS) * 360;
  const earthPos = []; const earthNor = []; const earthUv = []; const earthIdx = [];
  for (let i = 0; i <= ROWS; i++) {
    for (let j = 0; j <= COLS; j++) {
      const d = frames.dirOf(latOf(i), lonOf(j));
      earthPos.push(d.x * R, d.y * R, d.z * R);
      earthNor.push(d.x, d.y, d.z);
      earthUv.push(j / COLS, i / ROWS);
    }
  }
  const row = COLS + 1;
  for (let i = 0; i < ROWS; i++) {
    for (let j = 0; j < COLS; j++) {
      if (i >= HOLE.i0 && i < HOLE.i1 && j >= HOLE.j0 && j < HOLE.j1) continue;
      const a = i * row + j; const b = a + 1; const c = a + row; const e = c + 1;
      earthIdx.push(a, b, e, a, e, c);
    }
  }
  const earthG = new THREE.BufferGeometry();
  earthG.setAttribute('position', new THREE.Float32BufferAttribute(earthPos, 3));
  earthG.setAttribute('normal', new THREE.Float32BufferAttribute(earthNor, 3));
  earthG.setAttribute('uv', new THREE.Float32BufferAttribute(earthUv, 2));
  earthG.setIndex(earthIdx);
  if (signedVolume(earthG) < 0) throw new Error('earth-magnetosphere: the Earth came out inside out');
  earthG.applyMatrix4(frames.body);
  earthG.translate(0, CY, 0);
  const earthMap = canvasTexture(1536, 768, (ctx, w, h) => paintEarthMap(ctx, w, h, { seed: 8101, detail: 1 }));
  const earthMesh = mesh(earthG, standard({ map: earthMap, roughness: 0.85, metalness: 0, emissive: 0xffffff, emissiveMap: earthMap, emissiveIntensity: 0.28 }));
  earthMesh.receiveShadow = false;

  const glowLines = [];

  // The wedge's four walls, each coloured zone by zone at the true fractions of the radius: the inner
  // core to 0.19, the molten outer core to 0.55, the mantle to the crust. Wound toward the hole.
  const holeDir = frames.dirOf((latOf(HOLE.i0) + latOf(HOLE.i1)) / 2, (lonOf(HOLE.j0) + lonOf(HOLE.j1)) / 2);
  const wallPos = []; const wallCol = [];
  const zones = [[0, 0.19], [0.19, 0.546], [0.546, 0.985], [0.985, 1]];
  const zoneColor = (z, r, q) => {
    const n = smoothNoise3(q.x * 3.6 * r * 4 + 2, q.y * 3.6 * r * 4, q.z * 3.6 * r * 4);
    if (z === 0) return [1, mix(0.72, 0.88, n), mix(0.2, 0.42, n)];
    if (z === 1) { const t = sstep(n, 0.3, 0.7); return [1, mix(0.2, 0.46, t), mix(0.01, 0.05, t)]; }
    if (z === 2) { const t = (r - 0.546) / 0.44; return [mix(0.55, 0.2, t) + (n - 0.5) * 0.08, mix(0.13, 0.08, t), mix(0.04, 0.05, t)]; }
    return [0.3, 0.26, 0.2];
  };
  const wall = (edge, steps, shade) => {
    zones.forEach(([r0, r1], z) => {
      const bands = z === 1 ? 7 : z === 2 ? 5 : 2;
      for (let b = 0; b < bands; b++) {
        const ra = mix(r0, r1, b / bands); const rb = mix(r0, r1, (b + 1) / bands);
        for (let k = 0; k < steps; k++) {
          const d0 = edge(k / steps); const d1 = edge((k + 1) / steps);
          const q = [d0.clone().multiplyScalar(ra * R), d1.clone().multiplyScalar(ra * R), d1.clone().multiplyScalar(rb * R), d0.clone().multiplyScalar(rb * R)];
          const tris = [[0, 1, 2], [0, 2, 3]];
          for (const t of tris) {
            const A = q[t[0]]; const B = q[t[1]]; const C = q[t[2]];
            const n = B.clone().sub(A).cross(C.clone().sub(A));
            if (n.lengthSq() < 1e-12) continue;
            const order = n.dot(holeDir) > 0 ? [A, B, C] : [A, C, B];
            for (const P of order) {
              wallPos.push(P.x, P.y, P.z);
              const r = P.length() / R;
              const c = zoneColor(z, Math.min(Math.max(r, r0 + 1e-3), r1 - 1e-3), P.clone().normalize());
              wallCol.push(c[0] * shade, c[1] * shade, c[2] * shade);
            }
          }
        }
      }
    });
  };
  const lat0 = latOf(HOLE.i0); const lat1 = latOf(HOLE.i1); const lon0 = lonOf(HOLE.j0); const lon1 = lonOf(HOLE.j1);
  // Each wall a little different in tone, or the pit reads as one flat panel.
  wall((t) => frames.dirOf(mix(lat0, lat1, t), lon0), HOLE.i1 - HOLE.i0, 0.72);
  wall((t) => frames.dirOf(mix(lat0, lat1, t), lon1), HOLE.i1 - HOLE.i0, 1);
  wall((t) => frames.dirOf(lat0, mix(lon0, lon1, t)), HOLE.j1 - HOLE.j0, 0.86);
  wall((t) => frames.dirOf(lat1, mix(lon0, lon1, t)), HOLE.j1 - HOLE.j0, 0.56);
  const wallG = new THREE.BufferGeometry();
  wallG.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
  wallG.setAttribute('color', new THREE.Float32BufferAttribute(wallCol, 3));
  wallG.computeVertexNormals();
  wallG.applyMatrix4(frames.body);
  wallG.translate(0, CY, 0);
  const wallMesh = mesh(wallG, unlit({ side: THREE.DoubleSide }));
  wallMesh.castShadow = false;

  // The field lines.
  const lineRadius = 0.075;
  const lines = [];
  const addRun = (run, color, openEnd) => {
    if (run.length < 4) return;
    const radii = run.map((_, i) => {
      const fromEnd = run.length - 1 - i;
      return openEnd && fromEnd < 4 ? lineRadius * (fromEnd / 4) * 0.98 + 0.002 : lineRadius;
    });
    const g = tube(run.map((q) => [q.x, q.y + CY, q.z]), radii, { steps: openEnd ? 34 : 62, sides: 7, round: 1 });
    glowLines.push({ geometry: g, color });
    lines.push({ run, color });
  };
  const deformed = (pts) => pts.map(magnetoDeform);
  const cutAtTail = (pts) => {
    const runs = [];
    let cur = [];
    for (const q of pts) {
      if (q.x > X_TAIL) { if (cur.length) runs.push(cur); cur = []; } else cur.push(q);
    }
    if (cur.length) runs.push(cur);
    return runs;
  };
  let cones = 0;
  MAG_LINES.forEach(({ L, color, lons }) => {
    for (let k = 0; k < lons; k++) {
      const lambda = (k / lons) * TAU;
      const n = 70;
      const pts = deformed(dipoleLine(L, lambda, frames, n));
      const runs = cutAtTail(pts);
      runs.forEach((run, ri) => {
        // Going from theta small (north) to large (south), a run is cut at its tail end only.
        if (runs.length === 1) { addRun(run, color, false); return; }
        addRun(ri === 0 ? run : [...run].reverse(), color, true);
      });
      // An arrowhead at the crest of the closed lines, showing the field's direction: from south to
      // north outside the planet. Index n/2 is the magnetic equator; toward index 0 is north.
      if (runs.length === 1) {
        const mid = Math.floor(n / 2);
        const a = pts[mid]; const b = pts[mid - 2];
        glowLines.push({ geometry: coneAt(toWorld(a), b.clone().sub(a), 0.62, 0.22), color });
        cones += 1;
      }
    }
  });
  if (cones < 10) throw new Error('earth-magnetosphere: too few closed field lines');
  // The lobes: open lines from each polar cap, on the night half only.
  MAG_LOBES.forEach(({ L, color }) => {
    for (const lambda of [130, 180, 230]) {
      const pts = deformed(dipoleLine(L, lambda * DEG, frames, 180));
      const half = pts.length >> 1;
      const north = pts.slice(0, half); const south = pts.slice(half + 1).reverse();
      for (const part of [north, south]) {
        const runs = cutAtTail(part);
        // Thin the samples: the far parts of these are long and straight.
        const thin = runs[0].filter((_, i) => i % 3 === 0 || i === runs[0].length - 1);
        addRun(thin, color, true);
      }
    }
  });

  // A check: every line plunges into the planet at both its ends.
  for (const { L } of MAG_LINES) {
    const pts = dipoleLine(L, 1.1, frames, 60);
    if (pts[0].length() >= R || pts[60].length() >= R) throw new Error('earth-magnetosphere: a field line stops short of the planet');
    const foot = Math.asin(1 / Math.sqrt(L)) / DEG;
    if (foot > 55) throw new Error('earth-magnetosphere: a footprint is too far from the pole');
  }

  // Auroral ovals, round each magnetic pole: a closed curtain, green at the foot and red at the crown,
  // further from the pole on the night side, as a real oval is.
  const oval = (axis, sign) => {
    const a = axis.clone().multiplyScalar(sign);
    const u1 = V(1, 0, 0).addScaledVector(a, -a.x).normalize(); // toward midnight
    const u2 = V().crossVectors(a, u1).normalize();
    const point = (t, lift, off) => {
      const psi = t * TAU;
      const colat = (17.5 + 5.5 * Math.cos(psi) + 0.85 * Math.sin(psi * 9 + 1) + 0.5 * Math.sin(psi * 23)) * DEG + off;
      const d = u1.clone().multiplyScalar(Math.cos(psi) * Math.sin(colat)).addScaledVector(u2, Math.sin(psi) * Math.sin(colat)).addScaledVector(a, Math.cos(colat));
      return d.multiplyScalar(R * lift);
    };
    const NU = 120;
    const height = (t) => 1.058 + 0.024 * (0.5 + 0.5 * Math.sin(t * TAU * 13));
    // A broad low band lying on the surface, so the oval shows from any side, and the curtain over it.
    const band = gridSolid(NU, 1,
      (i, j) => { const t = i / NU; const q = point(t, 1.009, mix(-0.05, 0.05, j)); return [q.x, q.y + CY, q.z]; },
      (i, j) => { const t = i / NU; const q = point(t, 0.995, mix(-0.05, 0.05, j)); return [q.x, q.y + CY, q.z]; },
      { crease: 60 });
    tintVertices(band, (x, y, z, out) => { out[0] = 0.008; out[1] = 0.5; out[2] = 0.07; });
    glowLines.push({ geometry: band, keepColor: true });
    const curtain = gridSolid(NU, 3,
      (i, j) => { const t = i / NU; const q = point(t, mix(0.998, height(t), j / 3), 0.012); return [q.x, q.y + CY, q.z]; },
      (i, j) => { const t = i / NU; const q = point(t, mix(0.998, height(t), j / 3), -0.012); return [q.x, q.y + CY, q.z]; },
      { crease: 60 });
    tintVertices(curtain, (x, y, z, out) => {
      const h = (Math.hypot(x, y - CY, z) / R - 1) / 0.066;
      const crown = sstep(h, 0.82, 1);
      out[0] = mix(0.015, 0.8, crown); out[1] = mix(0.72, 0.06, crown); out[2] = mix(0.12, 0.1, crown);
    });
    glowLines.push({ geometry: curtain, keepColor: true });
    return Array.from({ length: 48 }, (_, i) => point(i / 48, 1.03, 0));
  };
  oval(frames.dipole, 1);
  const southOval = oval(frames.dipole, -1);

  // The two pins: white for the spin axis, green for the magnetic axis, so their offset can be seen.
  for (const [axis, col] of [[frames.spinAxis, 0xf4f4ee], [frames.dipole, 0x3fff72]]) {
    for (const sign of [1, -1]) {
      const a = axis.clone().multiplyScalar(sign * R * 0.97);
      const b = axis.clone().multiplyScalar(sign * R * 1.19);
      glowLines.push({ geometry: rod(toWorld(a).toArray(), toWorld(b).toArray(), 0.022, 8, 1), color: col });
      glowLines.push({ geometry: new THREE.SphereGeometry(0.052, 12, 9).translate(...toWorld(b).toArray()), color: col });
    }
  }

  // The solar wind. A streamline round the shock is rho^2 = rho0^2 + rho_b(x)^2, which conserves the
  // flow between it and the axis, with rho_b the parabola's own radius softened so it has no kink.
  const shockAt = (x) => {
    const w = 0.5;
    const soft = w * Math.log1p(Math.exp((x + NOSE) / w));
    return 2 * RC * soft;
  };
  const ARROWS = [[1.3, 90], [2.7, 90], [4.1, 90], [1.3, -90], [2.7, -90], [4.1, -90]];
  const yellow = 0xff8a00;
  const X0 = -8.2;
  ARROWS.forEach(([rho0, ang]) => {
    const c = Math.cos(ang * DEG); const n = Math.sin(ang * DEG);
    const pts = [];
    for (let x = X0; x < -1.4; x += 0.28) {
      const rho = Math.sqrt(rho0 * rho0 + shockAt(x));
      if (rho > 5.7) break;
      pts.push(V(x, CY + n * rho, c * rho));
    }
    const end = pts[pts.length - 1];
    const before = pts[pts.length - 2];
    const dir = end.clone().sub(before);
    glowLines.push({ geometry: tube(pts.map((q) => q.toArray()), 0.11, { steps: pts.length * 2, sides: 10, round: 1 }), color: yellow });
    glowLines.push({ geometry: coneAt(end, dir, 0.85, 0.34), color: yellow });
  });
  // One straight arrow head on, stopping at the nose of the shock.
  glowLines.push({ geometry: rod([X0, CY, 0], [-NOSE - 1, CY, 0], 0.11, 10, 1), color: yellow });
  glowLines.push({ geometry: coneAt(V(-NOSE - 1, CY, 0), V(1, 0, 0), 0.85, 0.34), color: yellow });

  // The bow shock: a faint paraboloid, plus the arc itself in the two planes through the Sun line.
  const shockRho = 5.7;
  const SH_R = 18; const SH_A = 48;
  const shPos = []; const shIdx = [];
  for (let i = 0; i <= SH_R; i++) {
    const rho = (i / SH_R) * shockRho;
    for (let j = 0; j <= SH_A; j++) {
      const a = (j / SH_A) * TAU;
      shPos.push(-NOSE + (rho * rho) / (2 * RC), CY + Math.sin(a) * rho, Math.cos(a) * rho);
    }
  }
  for (let i = 0; i < SH_R; i++) {
    for (let j = 0; j < SH_A; j++) {
      const a = i * (SH_A + 1) + j;
      shIdx.push(a, a + 1, a + SH_A + 2, a, a + SH_A + 2, a + SH_A + 1);
    }
  }
  const shockG = new THREE.BufferGeometry();
  shockG.setAttribute('position', new THREE.Float32BufferAttribute(shPos, 3));
  shockG.setIndex(shIdx);
  shockG.computeVertexNormals();
  const shockCol = lin(0xffb030);
  const shockPart = paintGlow(shockG, (x, y, z, out) => {
    const rho = Math.hypot(y - CY, z);
    const stripe = 0.72 + 0.28 * Math.sin(Math.atan2(y - CY, z) * 11 + rho * 2.4);
    out[0] = shockCol[0]; out[1] = shockCol[1]; out[2] = shockCol[2];
    out[3] = 0.2 * (1 - sstep(rho, 3.1, shockRho)) * stripe;
  });
  const shockMesh = mesh(mergeParts([shockPart]), glowMaterial(alphaRamp(), { side: THREE.DoubleSide, toneMapped: false, fog: false }));
  shockMesh.castShadow = false;
  shockMesh.receiveShadow = false;
  for (const ang of [0, 90]) {
    for (const sign of [1, -1]) {
      const c = Math.cos(ang * DEG) * sign; const n = Math.sin(ang * DEG) * sign;
      const pts = [];
      for (let i = 0; i <= 22; i++) {
        const rho = (i / 22) * shockRho;
        pts.push([-NOSE + (rho * rho) / (2 * RC), CY + n * rho, c * rho]);
      }
      glowLines.push({ geometry: tube(pts, 0.035, { steps: 40, sides: 6, round: 1 }), color: 0xe08a00 });
    }
  }

  // The stands: the Earth's own, and a slim post that the wind arrows' tails rest on.
  const frame = [];
  slimStand(frame, 2.05, CY - R * 0.9, { post: 0.085 });
  const WX = X0 - 0.02;
  slimStand(frame, 0.95, CY + 4.1, { x: WX, post: 0.05 });

  // Printed plates.
  const entries = [
    { w: 1.9, h: 0.42, lines: ['SOLAR WIND'] },
    { w: 2.4, h: 0.42, lines: ['MAGNETIC FIELD'] },
    { w: 1.45, h: 0.42, lines: ['AURORA'] },
    { w: 2.9, h: 0.72, lines: ['WHITE PIN: THE SPIN AXIS', 'GREEN PIN: THE MAGNETIC AXIS', 'ORANGE: THE MOLTEN OUTER CORE'] },
  ];
  const { texture, rects } = plateAtlas(entries);
  const plates = [];
  // On the wind rack's post.
  plates.push({ geometry: placed(printedPlate(1.9, 0.42, 0.03, rects[0]), [WX, 1.25, 0.07], {}), keepColor: true });
  frame.push({ geometry: block(WX - 0.5, 1.1, -0.05, WX + 0.5, 1.4, 0.05), color: 0x23252d });
  // On the Earth's post, one each side, each with a leader up to what it names.
  const py = 2.35;
  plates.push({ geometry: placed(printedPlate(2.4, 0.42, 0.03, rects[1]), [-1.32, py - 0.5, 0.14], {}), keepColor: true });
  frame.push({ geometry: block(-1.2, py - 0.59, 0.03, -0.02, py - 0.41, 0.11), color: 0x23252d });
  plates.push({ geometry: placed(printedPlate(1.45, 0.42, 0.03, rects[2]), [-0.96, py, 0.14], {}), keepColor: true });
  frame.push({ geometry: block(-0.8, py - 0.09, 0.03, -0.02, py + 0.09, 0.11), color: 0x23252d });
  // The legend on the base.
  plates.push({ geometry: placed(printedPlate(2.9, 0.72, 0.03, rects[3]), [0, 0.5, 1.28], { tilt: 42 * DEG }), keepColor: true });
  frame.push({ geometry: placed(block(-1, -0.3, -0.2, 1, 0.14, -0.03), [0, 0.46, 1.28], { tilt: 42 * DEG }), color: 0x23252d });

  // Leaders.
  const leader = (from, to) => {
    glowLines.push({ geometry: rod(from, to, 0.016, 6, 1), color: 0x2b2a2c });
    glowLines.push({ geometry: new THREE.SphereGeometry(0.06, 10, 8).translate(to[0], to[1], to[2]), color: 0xffe48a });
  };
  // Each leader goes to the nearest point of what it names, so it never crosses the globe.
  {
    const from = V(-0.96, py + 0.2, 0.1);
    let best = null; let bestD = 1e9;
    for (const q of southOval) { const w = toWorld(q); const d = w.distanceTo(from); if (d < bestD) { bestD = d; best = w; } }
    leader(from.toArray(), best.toArray());
  }
  // The MAGNETIC FIELD leader runs up to a real point on a real line, L = 3.
  {
    const line = deformed(dipoleLine(3.0, (2 / 8) * TAU, frames, 70));
    const from = V(-2.3, py - 0.28, 0.1);
    let best = line[0]; let bestD = 1e9;
    for (const q of line) {
      const w = toWorld(q);
      const d = w.distanceTo(from);
      if (q.length() > R * 1.1 && d < bestD) { bestD = d; best = w; }
    }
    leader(from.toArray(), best.toArray());
  }

  const lineMesh = mesh(mergeParts(glowLines), unlit({ toneMapped: false, fog: false }));
  lineMesh.castShadow = false;
  lineMesh.receiveShadow = false;
  const frameMesh = mesh(mergeParts(frame), standard({ vertexColors: true, roughness: 0.62, metalness: 0.12 }));
  const plateMesh = mesh(mergeParts(plates), standard({ map: texture, roughness: 0.6, metalness: 0, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.35 }));
  root.add(frameMesh, earthMesh, wallMesh, lineMesh, plateMesh, shockMesh);
  return root;
}

// ===========================================================================================
// THE LIFE CYCLE OF A STAR
// ===========================================================================================
//
// A table of stations, read left to right, with the paths written as data and asserted: the shared
// nebula, then five stages on the low-mass path and six on the high-mass one with its two ends. Sizes
// are for reading and are checked for order, not to scale, as the card says.
//
// Each star's colour follows its surface temperature: the blue star is hottest of the living stars,
// the two giants have cool red surfaces, and the giants' cells are enormous, because a giant's
// convection cells really are huge against its surface.

const TOP_Y = 2.5;
export const STAR_STAGES = {
  nebula: { x: -6.35, z: 0, y: 4.55, r: 1.3, plate: 'NEBULA' },
  main: { x: -3.75, z: 1.95, y: 3.4, r: 0.34, plate: 'MAIN-SEQUENCE STAR' },
  giant: { x: -1.15, z: 1.95, y: 3.72, r: 0.86, plate: 'RED GIANT' },
  planetary: { x: 2.05, z: 1.95, y: 3.72, r: 0.95, plate: 'PLANETARY NEBULA' },
  dwarf: { x: 6.0, z: 1.95, y: 3.3, r: 0.1, plate: 'WHITE DWARF' },
  blue: { x: -2.6, z: -1.95, y: 4.75, r: 0.62, plate: 'BLUE STAR' },
  supergiant: { x: 0.45, z: -1.95, y: 5.55, r: 1.42, plate: 'RED SUPERGIANT' },
  supernova: { x: 3.85, z: -1.95, y: 5.3, r: 0.34, plate: 'SUPERNOVA' },
  neutron: { x: 6.55, z: -0.85, y: 3.75, r: 0.07, plate: 'NEUTRON STAR' },
  blackhole: { x: 6.75, z: -3.0, y: 4.35, r: 0.24, plate: 'BLACK HOLE' },
};
export const LOW_MASS_PATH = ['nebula', 'main', 'giant', 'planetary', 'dwarf'];
export const HIGH_MASS_PATH = ['nebula', 'blue', 'supergiant', 'supernova', 'neutron', 'blackhole'];
const TABLE = [-8, 8, -3.95, 3.65];

function paintStarTable(ctx, w, h) {
  const [x0, x1, z0, z1] = TABLE;
  const S = w / (x1 - x0);
  const px = (x) => (x - x0) * S;
  const pz = (z) => (z - z0) * S;
  ctx.fillStyle = '#0d0f19';
  ctx.fillRect(0, 0, w, h);
  const rng = seededRandom(9101);
  for (let i = 0; i < 420; i++) {
    const b = rng();
    ctx.fillStyle = `rgba(${200 + rng() * 55},${205 + rng() * 50},255,${0.1 + b * 0.42})`;
    ctx.beginPath();
    ctx.arc(rng() * w, rng() * h, 0.4 + b * 1, 0, TAU);
    ctx.fill();
  }
  const st = STAR_STAGES;
  const path = (points, color) => {
    // Points are [x, z]; a pair's control point is optional, as [x, z, cx, cz].
    const draw = (lw, col, cap) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw * S;
      ctx.lineCap = cap;
      ctx.beginPath();
      points.forEach((q, i) => {
        if (i === 0) ctx.moveTo(px(q[0]), pz(q[1]));
        else if (q.length > 2) ctx.quadraticCurveTo(px(q[2]), pz(q[3]), px(q[0]), pz(q[1]));
        else ctx.lineTo(px(q[0]), pz(q[1]));
      });
      ctx.stroke();
    };
    draw(0.26, '#a98a4a', 'butt');
    draw(0.19, color, 'butt');
    // The head, in brass and colour, along the last segment's own direction.
    const e = points[points.length - 1];
    const from = e.length > 2 ? [e[2], e[3]] : points[points.length - 2];
    const a = Math.atan2(e[1] - from[1], e[0] - from[0]);
    for (const [grow, col] of [[0.06, '#a98a4a'], [0, color]]) {
      ctx.save();
      ctx.translate(px(e[0]), pz(e[1]));
      ctx.rotate(a);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo((0.44 + grow * 1.6) * S, 0);
      ctx.lineTo(-grow * 0.7 * S, (0.28 + grow) * S);
      ctx.lineTo(-grow * 0.7 * S, -(0.28 + grow) * S);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  };
  const amber = '#e6a32e'; const blue = '#3f8fe8';
  // From the nebula, the fork: a curve to each row.
  path([[st.nebula.x + 1.1, 0.34], [st.main.x - 0.85, st.main.z, st.nebula.x + 2.2, st.main.z]], amber);
  path([[st.nebula.x + 1.1, -0.34], [st.blue.x - 0.95, st.blue.z, st.nebula.x + 2.2, st.blue.z]], blue);
  // Along each row, one arrow between each pair of neighbours.
  const between = (a, b, gapA, gapB, color) => {
    const dx = b.x - a.x; const dz = b.z - a.z; const l = Math.hypot(dx, dz);
    path([[a.x + (dx / l) * gapA, a.z + (dz / l) * gapA], [b.x - (dx / l) * (gapB + 0.44), b.z - (dz / l) * (gapB + 0.44)]], color);
  };
  between(st.main, st.giant, 0.55, 0.5, amber);
  between(st.giant, st.planetary, 0.5, 0.55, amber);
  between(st.planetary, st.dwarf, 0.55, 0.45, amber);
  between(st.blue, st.supergiant, 0.55, 0.5, blue);
  between(st.supergiant, st.supernova, 0.5, 0.55, blue);
  between(st.supernova, st.neutron, 0.65, 0.45, blue);
  between(st.supernova, st.blackhole, 0.65, 0.45, blue);
  // A ring where each post stands.
  ctx.strokeStyle = 'rgba(255,214,120,0.8)';
  ctx.lineWidth = 0.03 * S;
  for (const key of Object.keys(st)) {
    ctx.beginPath();
    ctx.arc(px(st[key].x), pz(st[key].z), 0.34 * S, 0, TAU);
    ctx.stroke();
  }
  // The margin and a brass line, last, so nothing reaches the rim.
  ctx.strokeStyle = '#0d0f19';
  ctx.lineWidth = 0.3 * S;
  ctx.strokeRect(0, 0, w, h);
  ctx.strokeStyle = '#a98a4a';
  ctx.lineWidth = 3;
  ctx.strokeRect(0.16 * S, 0.16 * S, w - 0.32 * S, h - 0.32 * S);
}

const STAR_ATLAS = { W: 1024, H: 1024, FINE: [0, 500], CELLS: [512, 500], WHITE: [1000 / 1024, 4 / 1024] };

function paintStarAtlas(ctx) {
  const { W, FINE, CELLS } = STAR_ATLAS;
  const a = periodicNoise(9102, 110, 56);
  const b = periodicNoise(9103, 34, 18);
  const c = periodicNoise(9104, 22, 12);
  const d = periodicNoise(9105, 9, 5);
  const e = periodicNoise(9106, 60, 30);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, STAR_ATLAS.H);
  paintRGBA(ctx, 0, FINE[0], W, FINE[1], (ix, iy, out) => {
    const u = ix / W; const v = iy / FINE[1];
    const wu = u + (b(u * 34, v * 18 + 3) - 0.5) * 0.012; const wv = v + (b(u * 34 + 5, v * 18) - 0.5) * 0.022;
    const t = a(wu * 110, wv * 56) * 0.55 + b(wu * 34, wv * 18) * 0.45;
    const k = mix(196, 255, sstep(t, 0.28, 0.68));
    out[0] = k; out[1] = k; out[2] = k;
  });
  paintRGBA(ctx, 0, CELLS[0], W, CELLS[1], (ix, iy, out) => {
    const u = ix / W; const v = iy / CELLS[1];
    const wu = u + (e(u * 60, v * 30) - 0.5) * 0.02; const wv = v + (e(u * 60 + 9, v * 30) - 0.5) * 0.035;
    const t = c(wu * 22, wv * 12) * 0.62 + d(wu * 9, wv * 5) * 0.2 + e(wu * 60, wv * 30) * 0.18;
    // Bright boiling cells with dark lanes between them, the look of a red giant's surface.
    const k = mix(150, 255, sstep(t, 0.3, 0.66));
    out[0] = k; out[1] = k; out[2] = k;
  });
}

function buildStarLifeCycle() {
  // The two paths, as the plates will read them.
  if (LOW_MASS_PATH.length !== 5) throw new Error('star-life-cycle: the low-mass path has five stages, with the nebula');
  if (HIGH_MASS_PATH.length !== 6) throw new Error('star-life-cycle: the high-mass path has six stages, with the nebula and both ends');
  if (LOW_MASS_PATH[0] !== 'nebula' || HIGH_MASS_PATH[0] !== 'nebula') throw new Error('star-life-cycle: both paths start from the one nebula');
  for (const key of [...LOW_MASS_PATH, ...HIGH_MASS_PATH]) if (!STAR_STAGES[key]) throw new Error(`star-life-cycle: no such stage ${key}`);
  const st = STAR_STAGES;
  const ascending = [['dwarf', 'main'], ['main', 'giant'], ['neutron', 'dwarf'], ['blue', 'supergiant'], ['giant', 'supergiant'], ['main', 'blue']];
  for (const [a, b] of ascending) if (st[a].r >= st[b].r) throw new Error(`star-life-cycle: ${a} must be drawn smaller than ${b}`);

  const root = new THREE.Group();
  const unlitParts = [];
  const whiteUV = (g) => {
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { arr[i * 2] = STAR_ATLAS.WHITE[0]; arr[i * 2 + 1] = STAR_ATLAS.WHITE[1]; }
    g.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
    return g;
  };
  const addFlat = (geometry, color) => { unlitParts.push({ geometry: whiteUV(geometry), color }); };
  const addTinted = (geometry) => { whiteUV(geometry); unlitParts.push({ geometry, keepColor: true }); };

  // A star: the atlas supplies the texture, the vertex colour its hue, shifted by a large soft mottle.
  const atlasCell = (row) => [0, 1 - (row[0] + row[1]) / STAR_ATLAS.H, 1, 1 - row[0] / STAR_ATLAS.H];
  const star = (key, rows, c0, c1, { ws = 44, hs = 28, row = STAR_ATLAS.FINE, freq = 1.7 } = {}) => {
    const S = st[key];
    const g = intoCell(new THREE.SphereGeometry(S.r, ws, hs), atlasCell(row));
    const A = lin(c0); const B = lin(c1);
    tintVertices(g, (x, y, z, out) => {
      const f = freq / S.r;
      const t = sstep(smoothNoise3(x * f + rows, y * f, z * f), 0.3, 0.7);
      out[0] = mix(A[0], B[0], t); out[1] = mix(A[1], B[1], t); out[2] = mix(A[2], B[2], t);
    });
    g.translate(S.x, S.y, S.z);
    unlitParts.push({ geometry: g, keepColor: true });
  };
  star('main', 1, 0xffc23c, 0xffec94, { ws: 40, hs: 26 });
  star('giant', 2, 0xf0501a, 0xff9440, { row: STAR_ATLAS.CELLS, ws: 48, hs: 30 });
  star('blue', 3, 0x6a9cff, 0xb8d4ff);
  star('supergiant', 4, 0xdc3612, 0xff7c2c, { row: STAR_ATLAS.CELLS, ws: 64, hs: 40 });
  star('dwarf', 5, 0xe9f2ff, 0xffffff, { ws: 18, hs: 12 });
  star('neutron', 6, 0xbcdcff, 0xffffff, { ws: 16, hs: 10 });

  // The nebula: a dark sculpted heart of dust with new stars coming out of it. The glowing gas round it
  // is further down, as torn translucent shells.
  const rngN = seededRandom(9107);
  const N = st.nebula;
  const cloud = new Sculpt(0.085);
  const maroon = lin(0x4a1030);
  for (let i = 0; i < 12; i++) {
    const a = rngN() * TAU; const yy = rngN() * 2 - 1;
    const ring = Math.sqrt(1 - yy * yy);
    const d = 0.2 + rngN() * 0.5;
    const r = mix(0.2, 0.42, rngN());
    cloud.add(sphereP([N.x + Math.cos(a) * ring * d * N.r * 0.85, N.y + yy * d * N.r * 0.6, N.z + Math.sin(a) * ring * d * N.r * 0.6], r), maroon, { k: 0.26 });
  }
  // Pillars, the columns of dense gas stars are born in, rising up out of the dust.
  for (const [dx, dy, dz, r] of [[-0.42, 0.45, 0.42, 0.16], [0.08, 0.62, 0.5, 0.13], [0.52, 0.38, 0.36, 0.14]]) {
    cloud.add(sphereP([N.x + dx, N.y + dy - 0.42, N.z + dz], r * 1.5), maroon, { k: 0.2 });
    cloud.add(sphereP([N.x + dx, N.y + dy - 0.1, N.z + dz], r), maroon, { k: 0.2 });
    cloud.add(sphereP([N.x + dx * 1.02, N.y + dy + 0.13, N.z + dz], r * 0.72), maroon, { k: 0.16 });
  }
  cloud.map((d, x, y, z) => d + 0.08 * (smoothNoise3(x * 2.4 + 3, y * 2.4, z * 2.4) - 0.5) * 2 + 0.03 * (smoothNoise3(x * 6, y * 6 + 2, z * 6) - 0.5) * 2);
  const cloudG = polygonize(cloud, {
    normalH: 0.7,
    tint: (x, y, z, nx, ny, nz, out) => {
      // Dark dust, its rims catching the light of the stars inside it.
      const lane = smoothNoise3(x * 2.6, y * 2.6 + 5, z * 2.6 - 3);
      const fine = smoothNoise3(x * 6, y * 6, z * 6);
      const rim = sstep(1 - Math.abs(nz), 0.45, 0.95) * 0.5 + sstep(ny, 0.5, 0.95) * 0.5;
      const t = clamp01(rim * 0.6 + (lane - 0.5) * 0.7 + (fine - 0.5) * 0.3);
      out[0] = mix(0.06, 0.92, t * t); out[1] = mix(0.012, 0.2, t * t); out[2] = mix(0.05, 0.3, t);
    },
  });
  addTinted(cloudG);
  // New stars: small bright beads standing proud of the dust, at the tips of the pillars and beyond.
  const beadPts = [[-0.44, 0.76, 0.46], [0.08, 0.9, 0.5], [0.55, 0.64, 0.38], [-0.1, -0.42, 0.92], [-0.98, -0.1, 0.5], [0.98, -0.16, 0.42], [-0.68, 0.32, 0.8], [0.52, -0.56, 0.72]];
  for (const [dx, dy, dz] of beadPts) {
    addFlat(new THREE.SphereGeometry(0.05, 10, 8).translate(N.x + dx, N.y + dy, N.z + dz), 0xffffff);
  }

  // The planetary nebula: the star's own outer layers, puffed off as a hollow shell, with the hot bare
  // core at its centre. Two thin nested shells, one printed by vertex, wide open at the poles.
  const glow = [];
  const PN = st.planetary;
  const axis = V(0.35, 0.55, 0.76).normalize();
  const hollow = (radius, ca, cb, top, seed, ws = 40, hs = 28) => {
    const g = new THREE.SphereGeometry(radius, ws, hs);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const d = V(p.getX(i), p.getY(i), p.getZ(i)).normalize();
      const k = 1 + 0.08 * (smoothNoise3(d.x * 2.4 + seed, d.y * 2.4, d.z * 2.4) - 0.5) * 2 + 0.035 * (smoothNoise3(d.x * 7, d.y * 7 + seed, d.z * 7) - 0.5) * 2;
      p.setXYZ(i, d.x * radius * k, d.y * radius * k, d.z * radius * k);
    }
    g.computeVertexNormals();
    const A = lin(ca); const B = lin(cb);
    const part = paintGlow(g, (x, y, z, out) => {
      const l = Math.hypot(x, y, z) || 1;
      const lat = (x * axis.x + y * axis.y + z * axis.z) / l;
      const waist = 1 - sstep(Math.abs(lat), 0.15, 0.82);
      const n = sstep(smoothNoise3((x / l) * 4.6 + seed, (y / l) * 4.6, (z / l) * 4.6), 0.34, 0.68);
      out[0] = mix(A[0], B[0], n); out[1] = mix(A[1], B[1], n); out[2] = mix(A[2], B[2], n);
      out[3] = top * (0.08 + 0.92 * waist) * (0.45 + 0.75 * n);
    });
    g.translate(PN.x, PN.y, PN.z);
    return part;
  };
  const star2 = new THREE.SphereGeometry(0.09, 20, 14).translate(PN.x, PN.y, PN.z);
  addFlat(star2, 0xffffff);

  // The supernova: a hot core and a burst of real ejecta, long and short together, lobed, each spike
  // white at the root and red at the tip, with knots of gas at the longest tips.
  const SN = st.supernova;
  const snCore = new THREE.SphereGeometry(SN.r, 36, 24);
  tintVertices(snCore, (x, y, z, out) => {
    const f = 4 / SN.r * 0.5;
    const t = sstep(smoothNoise3(x * f, y * f + 3, z * f), 0.3, 0.7);
    out[0] = 1; out[1] = mix(0.72, 1, t); out[2] = mix(0.3, 0.92, t);
  });
  snCore.translate(SN.x, SN.y, SN.z);
  addTinted(snCore);
  const rngS = seededRandom(9108);
  const SPIKES = 190;
  const hotA = [1, 0.9, 0.62]; const hotB = [1, 0.36, 0.03]; const hotC = [0.62, 0.03, 0.01];
  for (let i = 0; i < SPIKES; i++) {
    const yy = 1 - ((i + 0.5) / SPIKES) * 2;
    const ring = Math.sqrt(1 - yy * yy);
    const az = i * 2.39996 + (rngS() - 0.5) * 0.3;
    const d = [Math.cos(az) * ring, yy, Math.sin(az) * ring];
    const lobe = smoothNoise3(d[0] * 1.8 + 7, d[1] * 1.8, d[2] * 1.8);
    const lengthK = mix(0.55, 1.75, sstep(lobe, 0.28, 0.72)) * mix(0.6, 1.08, rngS());
    const tipR = SN.r + lengthK;
    const a = [SN.x + d[0] * SN.r * 0.9, SN.y + d[1] * SN.r * 0.9, SN.z + d[2] * SN.r * 0.9];
    const b = [SN.x + d[0] * tipR, SN.y + d[1] * tipR, SN.z + d[2] * tipR];
    const g = tube([a, b], [mix(0.06, 0.1, rngS()), 0.004], { straight: true, steps: 3, sides: 5, round: 0 });
    tintVertices(g, (x, y, z, out) => {
      const t = clamp01((Math.hypot(x - SN.x, y - SN.y, z - SN.z) - SN.r) / lengthK);
      const c0 = t < 0.45 ? hotA : hotB; const c1 = t < 0.45 ? hotB : hotC;
      const k = t < 0.45 ? t / 0.45 : (t - 0.45) / 0.55;
      out[0] = mix(c0[0], c1[0], k); out[1] = mix(c0[1], c1[1], k); out[2] = mix(c0[2], c1[2], k);
    });
    addTinted(g);
    if (lengthK > 1.3 && i % 3 === 0) {
      addFlat(new THREE.IcosahedronGeometry(0.05 + rngS() * 0.04, 1).translate(b[0], b[1], b[2]), rngS() > 0.5 ? 0xff7a2c : 0xffc24a);
    }
  }

  // The black hole, small: the same two ideas as the big model, a black ball and a hull ring.
  const BH = st.blackhole;
  addFlat(new THREE.SphereGeometry(BH.r, 36, 24).translate(BH.x, BH.y, BH.z), 0x000000);
  const hullG = new THREE.SphereGeometry(BH.r * 1.07, 40, 24).translate(BH.x, BH.y, BH.z);
  const hullMesh = mesh(mergeParts([{ geometry: hullG, color: 0xffe2a8 }]), unlit({ side: THREE.BackSide }));
  hullMesh.castShadow = false;
  hullMesh.receiveShadow = false;
  // A hot, tilted, thin disk with a real gap, its colour by radius.
  {
    const rin = BH.r * 1.55; const rout = BH.r * 2.9;
    const m = new THREE.Matrix4().makeRotationX(15 * DEG);
    m.setPosition(BH.x, BH.y, BH.z);
    const ringG = gridSolid(72, 4,
      (i, j) => { const a = (i / 72) * TAU; const r = mix(rin, rout, j / 4); return [Math.cos(a) * r, 0.012, Math.sin(a) * r]; },
      (i, j) => { const a = (i / 72) * TAU; const r = mix(rin, rout, j / 4); return [Math.cos(a) * r, -0.012, Math.sin(a) * r]; },
      { crease: 40 });
    tintVertices(ringG, (x, y, z, out) => {
      const t = (Math.hypot(x, z) - rin) / (rout - rin);
      const a = Math.atan2(z, x);
      const bright = 0.72 + 0.28 * Math.sin(a + 2.6);
      out[0] = 1 * bright; out[1] = mix(0.72, 0.1, t) * bright; out[2] = mix(0.34, 0.02, t) * bright;
    });
    ringG.applyMatrix4(m);
    addTinted(ringG);
  }

  // Soft halos. Order matters with no depth writes: hollow shells first, then the outer halos.
  glow.push(hollow(0.95, 0xff5a2a, 0xff8c3c, 1, 1.3));
  glow.push(hollow(0.66, 0x2fe6d6, 0x8dffd8, 0.72, 4.1, 32, 22));
  const halo = (key, col, reach, top, shells = 3, ws = 20, hs = 11) => {
    const S = st[key];
    for (let i = 0; i < shells; i++) {
      const t = i / (shells - 1 || 1);
      glow.push(glowShell([S.x, S.y, S.z], S.r * mix(reach, 1.03, t), col, mix(0.03, top, t), { ws, hs }));
    }
  };
  halo('main', 0xffc860, 2.2, 0.11);
  halo('giant', 0xff6a30, 1.34, 0.1);
  halo('blue', 0x9cc4ff, 1.7, 0.12);
  halo('supergiant', 0xff5a24, 1.2, 0.09, 3, 26, 14);
  halo('dwarf', 0xe6f0ff, 3.6, 0.14, 3, 14, 8);
  halo('neutron', 0xcfe4ff, 3.8, 0.16, 3, 14, 8);
  // The nebula's outer gas, faint and irregular, and the burst's expanding shell.
  const nebA = lin(0xe02a7a); const nebB = lin(0xff8db0); const nebC = lin(0x3fd0d8);
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const radius = N.r * mix(1.26, 0.62, t);
    const seed = 3.3 + i * 1.91;
    const g = new THREE.SphereGeometry(radius, 30, 20);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const dx = p.getX(k) / radius; const dy = p.getY(k) / radius; const dz = p.getZ(k) / radius;
      // Wide in x, like a real cloud, and heaved about by a noise of direction.
      const q = 1 + 0.26 * (smoothNoise3(dx * 1.7 + 11, dy * 1.7, dz * 1.7) - 0.5) * 2;
      p.setXYZ(k, N.x + dx * radius * q * 1.14, N.y + dy * radius * q * 0.92, N.z + dz * radius * q * 0.9);
    }
    glow.push(paintGlow(g, (x, y, z, out) => {
      const dx = (x - N.x) / radius; const dy = (y - N.y) / radius; const dz = (z - N.z) / radius;
      // Torn by a noise that differs per shell, which is what makes it gas and not an onion.
      const tear = sstep(smoothNoise3(dx * 2.3 + seed, dy * 2.3, dz * 2.3 - seed) * 0.7 + smoothNoise3(dx * 5 - seed, dy * 5, dz * 5) * 0.3, 0.4, 0.62);
      const hue = smoothNoise3(dx * 1.4 - seed, dy * 1.4 + 2, dz * 1.4);
      const c = t > 0.55 ? nebC : hue > 0.5 ? nebB : nebA;
      const k = t > 0.55 ? clamp01((t - 0.55) * 2.2) : 1;
      out[0] = mix(nebA[0], c[0], k); out[1] = mix(nebA[1], c[1], k); out[2] = mix(nebA[2], c[2], k);
      out[3] = mix(0.26, 0.2, t) * tear;
    }));
  }
  const burstCol = lin(0xff8a3a);
  for (let i = 0; i < 3; i++) {
    const t = i / 2;
    glow.push(glowShell([SN.x, SN.y, SN.z], mix(1.72, 0.74, t), burstCol, mix(0.04, 0.09, t), { lump: 0.14, freq: 2.2, seed: 2.2 + i * 0.03, ws: 28, hs: 16 }));
  }
  const glowMesh = mesh(mergeParts(glow), glowMaterial(alphaRamp()));
  glowMesh.castShadow = false;
  glowMesh.receiveShadow = false;

  // The table.
  const [x0, x1, z0, z1] = TABLE;
  const tableW = 1024; const tableH = Math.round((tableW * (z1 - z0)) / (x1 - x0));
  const tableMap = canvasTexture(tableW, tableH, (ctx, w, h) => paintStarTable(ctx, w, h));
  const top = outlineSlab(roundedRect(x0, x1, z0, z1, 0.45), TOP_Y - 0.24, TOP_Y, (x, z) => [(x - x0) / (x1 - x0), 1 - (z - z0) / (z1 - z0)], 0.035, [0.004, 0.996]);
  const tableMesh = mesh(top, standard({ map: tableMap, roughness: 0.7, metalness: 0, emissive: 0xffffff, emissiveMap: tableMap, emissiveIntensity: 0.28 }));

  const frame = [];
  const dark = 0x23252d;
  for (const lx of [x0 + 0.65, x1 - 0.65]) {
    for (const lz of [z0 + 0.55, z1 - 0.55]) {
      frame.push({ geometry: lathe([[0, 0], [0.22, 0], [0.2, 0.08], [0.13, 0.16], [0.17, TOP_Y - 0.28], [0.24, TOP_Y - 0.24], [0, TOP_Y - 0.22]], 18).translate(lx, 0, lz), color: dark });
    }
  }
  frame.push({ geometry: block(x0 + 0.6, 0.9, -0.09, x1 - 0.6, 1.1, 0.09), color: 0x1b1d24 });
  for (const lx of [x0 + 0.65, x1 - 0.65]) frame.push({ geometry: block(lx - 0.08, 0.9, z0 + 0.55, lx + 0.08, 1.1, z1 - 0.55), color: 0x1b1d24 });
  // The posts, each stopping inside what it carries.
  for (const key of Object.keys(st)) {
    const S = st[key];
    const reach = key === 'nebula' ? 0.2 : S.r * 0.5;
    const r = S.r < 0.2 ? 0.024 : 0.05;
    const topY = key === 'planetary' ? S.y - 0.05 : S.y - reach;
    frame.push({ geometry: lathe([[0, TOP_Y - 0.01], [0.2, TOP_Y - 0.01], [0.2, TOP_Y + 0.04], [0.08, TOP_Y + 0.1], [r * 1.3, TOP_Y + 0.2], [0, TOP_Y + 0.22]], 24).translate(S.x, 0, S.z), color: dark });
    frame.push({ geometry: rod([S.x, TOP_Y + 0.1, S.z], [S.x, topY, S.z], r, 10, 1), color: dark });
  }

  // Plates: one tipped lectern in front of each post, and the two that name the paths, in the paths' colours.
  const keys = Object.keys(st);
  const entries = keys.map((k) => ({ w: Math.max(1.05, st[k].plate.length * 0.098 + 0.28), h: 0.26, lines: [st[k].plate] }));
  entries.push({ w: 1.5, h: 0.3, lines: ['LOW-MASS STAR'], ground: '#3a2a08', ink: '#ffdc8a' });
  entries.push({ w: 1.5, h: 0.3, lines: ['HIGH-MASS STAR'], ground: '#0b2748', ink: '#a9d4ff' });
  const { texture, rects } = plateAtlas(entries);
  const plates = [];
  const TILT = 42 * DEG;
  const lectern = (i, x, z) => {
    const { w, h } = entries[i];
    plates.push({ geometry: placed(printedPlate(w, h, 0.03, rects[i]), [x, TOP_Y + 0.19, z], { tilt: TILT }), keepColor: true });
    frame.push({ geometry: block(x - w * 0.3, TOP_Y - 0.01, z - 0.16, x + w * 0.3, TOP_Y + 0.19, z - 0.03), color: dark });
  };
  keys.forEach((k, i) => {
    const S = st[k];
    const dz = k === 'nebula' ? 1.3 : 0.76;
    lectern(i, Math.min(S.x, 6.9 - entries[i].w / 2), S.z + dz);
  });
  lectern(keys.length, -5.8, st.main.z + 0.76);
  lectern(keys.length + 1, -5.15, -1.75);

  const atlas = canvasTexture(STAR_ATLAS.W, STAR_ATLAS.H, (ctx) => paintStarAtlas(ctx));
  const unlitMesh = mesh(mergeParts(unlitParts), unlit({ map: atlas }));
  unlitMesh.receiveShadow = false;
  const frameMesh = mesh(mergeParts(frame), standard({ vertexColors: true, roughness: 0.62, metalness: 0.12 }));
  const plateMesh = mesh(mergeParts(plates), standard({ map: texture, roughness: 0.6, metalness: 0, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.35 }));
  root.add(tableMesh, frameMesh, unlitMesh, hullMesh, plateMesh, glowMesh);
  return root;
}

export const BUILDERS = {
  'black-hole': () => buildBlackHole(),
  comet: () => buildComet(),
  'solar-eclipse': () => buildSolarEclipse(),
  'earth-magnetosphere': () => buildMagnetosphere(),
  'star-life-cycle': () => buildStarLifeCycle(),
};
