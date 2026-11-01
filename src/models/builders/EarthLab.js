import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, standard, canvasTexture, seededRandom } from '../../PropKit.js';
import { mergeParts, gearWheel, extrudeOutline } from '../../props/LoftKit.js';
import {
  Sculpt, polygonize, onSurface, sphereP, ellipsoidP, segsP, curveP, boxP, tube, lathe, alongMatrix, signedVolume, lin, clamp01, mix, sstep, tintVertices,
} from '../ModelKit.js';
import { reducedMotion } from '../../Settings.js';

// The Model Database's Earth science family: a seismograph, a weather station, a soil profile, the
// ocean's zones and how a fossil forms. Authored in feet, origin at the base centre, front toward +Z.
// Every figure a label states is worked out here from its rule and asserted, so a builder throws
// rather than teach something false.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
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
function plateCell(ctx, x, y, w, h, lines, { ground = '#efe6cc', ink = '#1d1a14', edge = '#7c6a44', big = 0.5 } = {}) {
  ctx.fillStyle = ground;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(2, h * 0.035);
  ctx.strokeRect(x + h * 0.05, y + h * 0.05, w - h * 0.1, h - h * 0.1);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (lines.length === 1) {
    fitFont(ctx, lines[0], w * 0.9, h * 0.62);
    ctx.fillText(lines[0], x + w / 2, y + h * 0.53);
    return;
  }
  // The first line is the name and the rest are smaller.
  const rest = lines.length - 1;
  const h0 = h * 0.84 * big; const h1 = (h * 0.84 * (1 - big)) / rest;
  fitFont(ctx, lines[0], w * 0.9, h0 * 0.88);
  ctx.fillText(lines[0], x + w / 2, y + h * 0.08 + h0 * 0.52);
  lines.slice(1).forEach((line, i) => {
    fitFont(ctx, line, w * 0.9, h1 * 0.84, '500');
    ctx.fillText(line, x + w / 2, y + h * 0.08 + h0 + h1 * (i + 0.5));
  });
}
const uvRect = (W, H, x, y, w, h) => [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H];

function dataTexture(texture) { texture.colorSpace = THREE.NoColorSpace; return texture; }
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

function rod(a, b, r, sides = 8, round = 1) {
  return tube([a, b], r, { straight: true, steps: 1, sides, round });
}

function block(x0, y0, z0, x1, y1, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

// A box along a line. `up` says which way its height runs.
function beam(a, b, w, h, up = [0, 1, 0]) {
  const { m, len } = alongMatrix(a, b, up);
  const g = new THREE.BoxGeometry(w, h, len);
  g.translate(0, 0, len / 2);
  g.applyMatrix4(m);
  return g;
}

// A box whose uv runs in feet on every face, the top optionally drawn in. For anything carrying a
// tile, since BoxGeometry stretches one image over each face.
function boxFeet(x0, y0, z0, x1, y1, z1, inset = 0) {
  const pos = []; const uv = [];
  const face = (a, b, c, d) => {
    for (const v of [a, b, c, a, c, d]) { pos.push(v[0], v[1], v[2]); uv.push(v[3], v[4]); }
  };
  const X0 = x0 + inset; const X1 = x1 - inset; const Z0 = z0 + inset; const Z1 = z1 - inset;
  face([x0, y0, z1, x0, y0], [x1, y0, z1, x1, y0], [X1, y1, Z1, X1, y1], [X0, y1, Z1, X0, y1]);
  face([x1, y0, z0, x1, y0], [x0, y0, z0, x0, y0], [X0, y1, Z0, X0, y1], [X1, y1, Z0, X1, y1]);
  face([x1, y0, z1, z1, y0], [x1, y0, z0, z0, y0], [X1, y1, Z0, Z0, y1], [X1, y1, Z1, Z1, y1]);
  face([x0, y0, z0, z0, y0], [x0, y0, z1, z1, y0], [X0, y1, Z1, Z1, y1], [X0, y1, Z0, Z0, y1]);
  face([X0, y1, Z1, X0, Z1], [X1, y1, Z1, X1, Z1], [X1, y1, Z0, X1, Z0], [X0, y1, Z0, X0, Z0]);
  face([x0, y0, z0, x0, z0], [x1, y0, z0, x1, z0], [x1, y0, z1, x1, z1], [x0, y0, z1, x0, z1]);
  return soup(pos, uv, 20);
}

// A flat printed plate, its face on +Z and its back at z = -depth, centre at the origin. The rim
// samples one corner of its own rectangle, so the edge is plain rather than a squashed print.
function printedPlate(w, h, depth, [u0, v0, u1, v1]) {
  return gridSolid(1, 1,
    (i, j) => [(i - 0.5) * w, (j - 0.5) * h, 0],
    (i, j) => [(i - 0.5) * w, (j - 0.5) * h, -depth],
    { uvTop: (i, j) => [mix(u0, u1, i), mix(v0, v1, j)], uvBottom: () => [u0 + 0.002, v0 + 0.002], crease: 20 });
}

const latheX = (profile, segments) => lathe(profile, segments).rotateZ(-Math.PI / 2);
const latheZ = (profile, segments) => lathe(profile, segments).rotateX(Math.PI / 2);

function hexBolt(x, y, z, r = 0.05, h = 0.06) {
  // Flat-faced: a hexagon smooth-shaded is a pebble.
  const g = lathe([[0, 0], [r, 0], [r, h * 0.7], [r * 0.72, h], [0, h]], 6).toNonIndexed();
  g.computeVertexNormals();
  g.translate(x, y, z);
  return g;
}

// ===========================================================================================
// SEISMOGRAPH
// ===========================================================================================
//
// A horizontal-motion instrument of the 1880s kind. The ground, the pier, the frame and the drum all
// move together; the big hung mass tends to stay where it is; the pen hangs from the mass, so it
// draws the difference along the drum's axle. The paper therefore carries TIME round the drum and
// the ground's motion ALONG it, as a real drum recorder does.
//
// The drum turns at one revolution a minute, so one second is six degrees of paper. Everything on the
// paper is worked out from that and from one earthquake: arrivals are distance over speed.
export const SEIS = {
  PIER_TOP: 2.6, BED_TOP: 2.74,
  AXLE_Y: 3.95, R: 1.0, L: 3.4, DRUM_X: 1.35,
  PEN_PHI: -50, PEN_DX: -0.34,
  RPM: 1,
  KM: 50, VP: 6.0, VS: 3.5, VR: 2.9,
  TP: 4, TNOW: 20,
};
SEIS.OMEGA = (SEIS.RPM * TAU) / 60;
SEIS.ORIGIN = SEIS.TP - SEIS.KM / SEIS.VP;
SEIS.TS = SEIS.ORIGIN + SEIS.KM / SEIS.VS;
SEIS.TR = SEIS.ORIGIN + SEIS.KM / SEIS.VR;
SEIS.PEN_X = SEIS.DRUM_X + SEIS.PEN_DX;
// The tip, a hair under the paper's surface so a faceted drum cannot leave daylight under it.
SEIS.TIP = [SEIS.PEN_X, SEIS.AXLE_Y + (SEIS.R - 0.001) * Math.sin(SEIS.PEN_PHI * DEG), (SEIS.R - 0.001) * Math.cos(SEIS.PEN_PHI * DEG)];

// Elevation on the drum at rest of what was written at paper time t. It moves up the front as the
// drum turns, so what was written first is highest.
const seisPhi = (t) => SEIS.PEN_PHI + (SEIS.RPM * 6) * (SEIS.TNOW - t);

// The record: how far the pen sits from its rest line along the axle at paper time t, in feet.
// P is small and fast, S larger and slower, surface waves largest and slowest, with the longer
// periods arriving first. Nothing moves before the P wave, and the line is quiet again at the pen.
export function seisAmp(t) {
  if (t < SEIS.TP) return 0;
  const env = (a, rise, decay) => (t < a ? 0 : sstep(t - a, 0, rise) * Math.exp(-(t - a) / decay));
  const dP = t - SEIS.TP; const dS = t - SEIS.TS; const dR = t - SEIS.TR;
  let v = 0.075 * env(SEIS.TP, 0.3, 4.2) * Math.sin((TAU * dP) / 0.62);
  if (dS > 0) v += 0.24 * env(SEIS.TS, 0.4, 2.8) * Math.sin((TAU * dS) / 1.05 + 0.4 * Math.sin(dS));
  if (dR > 0) v += 0.56 * env(SEIS.TR, 0.9, 3.6) * Math.sin((TAU * dR * (1 + 0.035 * dR)) / 2.3);
  return v * (1 - sstep(t, 16.5, SEIS.TNOW - 0.4));
}

function paintSeisPaper(ctx, W, H) {
  const { L, DRUM_X, PEN_X, TP, TS, TR } = SEIS;
  const x0 = DRUM_X - L / 2;
  const pxFt = W / L;
  const px = (x) => (x - x0) * pxFt;
  const py = (phi) => {
    let p = phi; while (p < -135) p += 360; while (p >= 225) p -= 360;
    return H * (1 - (p + 135) / 360);
  };
  ctx.fillStyle = '#f3eedd';
  ctx.fillRect(0, 0, W, H);
  // Rulings across the paper, one a second, heavier every five.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let t = 0; t < 60; t++) {
    const y = py(seisPhi(t));
    const major = t % 5 === 0;
    ctx.fillStyle = major ? '#a9b8c9' : '#d9dfe2';
    ctx.fillRect(0, y - (major ? 1 : 0.5), W, major ? 2 : 1);
    if (major) {
      ctx.fillStyle = '#51627a';
      ctx.font = `600 ${Math.round(pxFt * 0.085)}px ${FONT}`;
      ctx.fillText(`${t} s`, px(x0 + 0.05), y - pxFt * 0.05);
    }
  }
  // Which way time runs.
  const ax = px(x0 + 0.42); const ay0 = py(seisPhi(TP - 3.6)); const ay1 = py(seisPhi(TP - 1.0));
  ctx.strokeStyle = '#51627a'; ctx.fillStyle = '#51627a'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(ax, ay0); ctx.lineTo(ax, ay1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ax - 7, ay1 - 10); ctx.lineTo(ax + 7, ay1 - 10); ctx.lineTo(ax, ay1 + 2); ctx.fill();
  ctx.font = `700 ${Math.round(pxFt * 0.085)}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('TIME', ax + 9, (ay0 + ay1) / 2);

  // The gap, with the figure a student would read off the ruler.
  const gx = px(PEN_X - 0.42);
  const gy0 = py(seisPhi(TP)); const gy1 = py(seisPhi(TS));
  ctx.strokeStyle = '#7b2d1f'; ctx.fillStyle = '#7b2d1f'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(gx + 8, gy0); ctx.lineTo(gx, gy0); ctx.lineTo(gx, gy1); ctx.lineTo(gx + 8, gy1);
  ctx.stroke();
  ctx.textAlign = 'right';
  ctx.font = `700 ${Math.round(pxFt * 0.1)}px ${FONT}`;
  ctx.fillText('GAP', gx - 6, (gy0 + gy1) / 2 - pxFt * 0.06);
  ctx.fillText(`${(TS - TP).toFixed(1)} s`, gx - 6, (gy0 + gy1) / 2 + pxFt * 0.06);

  // The three labels, each on a leader at its true arrival.
  const label = (t, text, colour) => {
    const y = py(seisPhi(t));
    ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = 2.5;
    const reach = t === TR ? 0.62 : 0.34;
    ctx.beginPath(); ctx.moveTo(px(PEN_X + 0.02), y); ctx.lineTo(px(PEN_X + reach), y); ctx.stroke();
    ctx.beginPath(); ctx.arc(px(PEN_X), y, 5, 0, TAU); ctx.fill();
    ctx.textAlign = 'left';
    fitFont(ctx, text, W - px(PEN_X + reach) - 12, pxFt * 0.15, '800');
    ctx.fillText(text, px(PEN_X + reach) + 7, y);
  };
  label(TP, 'P WAVES', '#0d5b45');
  label(TS, 'S WAVES', '#8a2f12');
  label(TR, 'SURFACE WAVES', '#3f2a86');

  // The trace, last, over everything. One whole minute round the drum, so the line meets itself.
  ctx.strokeStyle = '#10234f';
  ctx.lineWidth = 3.4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let lastY = null;
  for (let t = 0; t <= 60.001; t += 0.012) {
    const x = px(PEN_X + seisAmp(t));
    const y = py(seisPhi(t));
    if (lastY === null || Math.abs(y - lastY) > H / 2) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    lastY = y;
  }
  ctx.stroke();
}

function buildSeismograph() {
  const S = SEIS;
  const root = new THREE.Group();
  // What the science requires of the record, or nothing is built.
  if (!(S.TP < S.TS && S.TS < S.TR && S.TR < S.TNOW)) throw new Error('seismograph: arrivals out of order');
  if (Math.abs(S.TS - S.TP - (S.KM / S.VS - S.KM / S.VP)) > 1e-9) throw new Error('seismograph: S minus P is not distance over speed');
  const peak = (a, b) => { let m = 0; for (let t = a; t < b; t += 0.01) m = Math.max(m, Math.abs(seisAmp(t))); return m; };
  if (!(peak(S.TP, S.TS) < peak(S.TS, S.TR) && peak(S.TS, S.TR) < peak(S.TR, S.TNOW))) throw new Error('seismograph: amplitudes do not grow P, S, surface');
  if (peak(0, S.TP) !== 0 || Math.abs(seisAmp(S.TNOW)) > 1e-3) throw new Error('seismograph: the line is not quiet');
  if (peak(S.TR, S.TNOW) > S.L / 2 + S.PEN_DX - 0.02) throw new Error('seismograph: the trace runs off the paper');
  if (Math.abs(Math.hypot(S.TIP[1] - S.AXLE_Y, S.TIP[2]) - S.R) > 0.002) throw new Error('seismograph: the pen does not touch the paper');

  const IRON = 0x4d6157; const IRON2 = 0x3c4c44; const BRASS = 0xb08d4e; const STEEL = 0x8b9196;
  const X = 3.75; const Z = 1.6;

  // The pier: a battered block of board-formed concrete on a wider footing.
  const concrete = wrapRepeat(canvasTexture(512, 512, (ctx, w, h) => {
    const n = latticeNoise(211);
    paintTexels(ctx, 0, 0, w, h, (x, y, out) => {
      const m = n(x / 40, y / 40) * 0.5 + n(x / 9, y / 9) * 0.3 + n(x / 2.5, y / 2.5) * 0.2;
      const board = Math.floor(y / 102);
      const off = ((board * 37) % 11) / 11;
      const grain = n(x / 90 + off * 50, y / 3 + board * 7);
      const v = 112 + m * 44 + grain * 16 + off * 12;
      const seam = y % 102 < 3 ? 0.72 : 1;
      out[0] = v * seam; out[1] = v * 0.985 * seam; out[2] = v * 0.94 * seam;
    });
  }), 1 / 3, 1 / 3);
  const pierParts = [
    { geometry: boxFeet(-X - 0.25, 0, -Z - 0.25, X + 0.25, 0.45, Z + 0.25, 0.04), keepColor: true },
    { geometry: boxFeet(-X, 0.45, -Z, X, S.PIER_TOP, Z, 0.06), keepColor: true },
  ];
  root.add(mesh(mergeParts(pierParts), standard({ map: concrete, bumpMap: concrete, bumpScale: 0.6, roughness: 0.95, metalness: 0 })));

  // Everything fixed to the pier. It moves with the ground.
  const parts = [];
  const add = (geometry, color) => parts.push({ geometry, color });
  add(block(-X + 0.12, S.PIER_TOP, -Z + 0.12, X - 0.12, S.BED_TOP, Z - 0.12), IRON2);
  for (const bx of [-3.3, -1.1, 1.1, 3.3]) for (const bz of [-1.28, 1.28]) add(hexBolt(bx, S.BED_TOP - 0.005, bz, 0.075, 0.09), STEEL);

  // The frame: an I-section column, a boom and a gusset, in the cast iron of the time.
  const cx = -3.05; const cz = -0.25; const top = 7.0;
  add(block(cx - 0.42, S.BED_TOP, cz - 0.62, cx + 0.42, S.BED_TOP + 0.12, cz + 0.62), IRON);
  add(block(cx - 0.3, S.BED_TOP, cz - 0.04, cx + 0.3, top, cz + 0.04), IRON);
  add(block(cx - 0.3, S.BED_TOP, cz - 0.3, cx - 0.22, top, cz + 0.3), IRON);
  add(block(cx + 0.22, S.BED_TOP, cz - 0.3, cx + 0.3, top, cz + 0.3), IRON);
  for (const [bx, bz] of [[-0.3, -0.48], [0.3, -0.48], [-0.3, 0.48], [0.3, 0.48]]) add(hexBolt(cx + bx, S.BED_TOP + 0.115, cz + bz, 0.055, 0.07), STEEL);
  add(block(cx - 0.34, top - 0.02, cz - 0.34, cx + 0.34, top + 0.03, cz + 0.34), IRON);
  const boomEnd = -1.15; const by1 = 6.98; const by0 = 6.58;
  add(block(cx - 0.3, by1 - 0.07, cz - 0.3, boomEnd, by1, cz + 0.3), IRON);
  add(block(cx - 0.3, by0, cz - 0.3, boomEnd, by0 + 0.07, cz + 0.3), IRON);
  add(block(cx - 0.3, by0, cz - 0.04, boomEnd, by1, cz + 0.04), IRON);
  // Two gussets, one each side of the web line.
  for (const gz of [cz - 0.26, cz + 0.26]) {
    add(beam([cx + 0.28, 4.75, gz], [cx + 1.62, by0 + 0.02, gz], 0.08, 0.16, [0, 0, 1]), IRON);
  }
  // A foot on the bedplate to brace the column front to back.
  add(beam([cx, S.BED_TOP + 0.05, 1.2], [cx, 4.6, cz + 0.26], 0.12, 0.14, [1, 0, 0]), IRON);
  add(beam([cx, S.BED_TOP + 0.05, -1.35], [cx, 4.6, cz - 0.26], 0.12, 0.14, [1, 0, 0]), IRON);
  add(block(cx - 0.18, S.BED_TOP, 1.05, cx + 0.18, S.BED_TOP + 0.09, 1.4), IRON);
  add(block(cx - 0.18, S.BED_TOP, -1.5, cx + 0.18, S.BED_TOP + 0.09, -1.15), IRON);

  // The pivot: a yoke under the boom, with a knife-edge pin across it, and the rod hung from the pin.
  const mx = -1.55; const my = 3.92; const mr = 0.8; const mz = cz;
  const pivotY = 6.2;
  for (const yz of [mz - 0.13, mz + 0.13]) add(block(mx - 0.1, pivotY - 0.1, yz - 0.025, mx + 0.1, by0 + 0.02, yz + 0.025), IRON2);
  add(latheZ([[0, -0.2], [0.05, -0.2], [0.05, 0.2], [0, 0.2]], 14).translate(mx, pivotY, mz), BRASS);
  add(lathe([[0, -0.09], [0.07, -0.09], [0.08, 0.05], [0.05, 0.1], [0, 0.1]], 14).translate(mx, pivotY - 0.03, mz), BRASS);
  add(rod([mx, pivotY - 0.05, mz], [mx, my + mr - 0.08, mz], 0.038, 10, 1), STEEL);
  add(lathe([[0, -0.1], [0.13, -0.1], [0.13, 0.03], [0.07, 0.14], [0.05, 0.3], [0, 0.32]], 18).translate(mx, my + mr - 0.02, mz), BRASS);

  // The mass, a turned iron ball with a raised girdle.
  // Rows on the girdle's own edges, so its paint and its step are as sharp as a turned edge.
  const prof = [];
  const GIRD = 0.15;
  for (let i = -24; i <= 24; i++) {
    const sn = (i / 24) * 1;
    const a = sn * (Math.PI / 2);
    if (Math.abs(Math.sin(a)) < GIRD + 0.02) continue;
    prof.push([Math.max(0, Math.cos(a) * mr), Math.sin(a) * mr]);
  }
  prof[0][0] = 0; prof[prof.length - 1][0] = 0;
  const rAt = (yy) => Math.sqrt(1 - yy * yy) * mr;
  const low = prof.filter((q) => q[1] < 0); const high = prof.filter((q) => q[1] > 0);
  const girdle = [
    [rAt(GIRD), -GIRD * mr], [rAt(GIRD) * 1.035, -GIRD * mr * 0.97], [rAt(0) * 1.035, -GIRD * mr * 0.4], [rAt(0) * 1.035, GIRD * mr * 0.4], [rAt(GIRD) * 1.035, GIRD * mr * 0.97], [rAt(GIRD), GIRD * mr],
  ];
  const ball = lathe([...low, ...girdle, ...high], 64);
  tintVertices(ball, (x, y, z, out) => {
    const onBand = Math.abs(y) < GIRD * mr * 0.985;
    const c = onBand ? lin(0x8a948d) : lin(0x4d5450);
    const sheen = 0.9 + 0.22 * clamp01(y / mr + 0.4);
    out[0] = c[0] * sheen; out[1] = c[1] * sheen; out[2] = c[2] * sheen;
  });
  ball.translate(mx, my, mz);
  parts.push({ geometry: ball, keepColor: true });

  // The arm: rigid, from the mass, round the front of the drum to the pen. The last length is on the
  // drum's own radial, and its point is SEIS.TIP.
  const nr = [0, Math.sin(S.PEN_PHI * DEG), Math.cos(S.PEN_PHI * DEG)];
  const out = (d) => [S.TIP[0] + nr[0] * d, S.TIP[1] + nr[1] * d, S.TIP[2] + nr[2] * d];
  const elbow = out(0.3);
  const armStart = [mx + mr * 0.56, my - mr * 0.42, mz + mr * 0.5];
  add(tube([armStart, [mx + mr * 1.05, elbow[1] + 0.12, mz + 0.8], [mx + 1.6, elbow[1] + 0.02, elbow[2]], [S.PEN_X - 0.3, elbow[1], elbow[2]], elbow], [0.042, 0.034, 0.028, 0.026, 0.026], { sides: 8, steps: 28, round: 1 }), STEEL);
  add(lathe([[0, -0.06], [0.09, -0.06], [0.1, 0.0], [0.08, 0.06], [0, 0.07]], 14).applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.45, -0.3, 0.84).normalize()))).translate(armStart[0], armStart[1], armStart[2]), BRASS);
  // The pen: a little inkwell on the arm and a stylus to the paper, ending in a point at the tip.
  add(tube([out(0.36), out(0.17)], [0.06, 0.05], { straight: true, steps: 2, sides: 12, round: 1 }), 0x7b2d1f);
  add(tube([out(0.18), out(0)], [0.03, 0], { straight: true, steps: 2, sides: 10, round: 1 }), BRASS);

  // The bearing pedestals, cast to a waist, carrying the axle.
  const pedX = [S.DRUM_X - S.L / 2 - 0.2, S.DRUM_X + S.L / 2 + 0.2];
  const pedOutline = [[-0.72, S.BED_TOP], [0.72, S.BED_TOP], [0.72, S.BED_TOP + 0.14], [0.26, S.BED_TOP + 0.34], [0.16, S.AXLE_Y - 0.2], [0.22, S.AXLE_Y], [0.16, S.AXLE_Y + 0.2], [-0.16, S.AXLE_Y + 0.2], [-0.22, S.AXLE_Y], [-0.16, S.AXLE_Y - 0.2], [-0.26, S.BED_TOP + 0.34], [-0.72, S.BED_TOP + 0.14]];
  for (const px of pedX) {
    const g = extrudeOutline(pedOutline, 0.16);
    g.rotateY(Math.PI / 2);
    g.translate(px, 0, 0);
    add(g, IRON);
    add(latheX([[0, -0.15], [0.17, -0.15], [0.17, 0.15], [0, 0.15]], 20).translate(px, S.AXLE_Y, 0), BRASS);
    for (const bz of [-0.56, 0.56]) add(hexBolt(px, S.BED_TOP + 0.135, bz, 0.05, 0.06), STEEL);
  }

  // The clockwork, at the +X end: a brass frame, a spring barrel, the key and a pinion to the big wheel.
  const wheelX = pedX[1] + 0.3;
  const gR = 0.62; const gN = 60; const pR = 0.155; const pN = 15;
  const depth = gR * (2.1 / gN) * 1.9;
  const centre = gR + pR - depth;
  if (Math.abs(pR * gN - gR * pN) > 1e-9) throw new Error('seismograph: the wheel and pinion do not share a tooth size');
  const py = S.AXLE_Y - centre * Math.sin(45 * DEG); const pz = -centre * Math.cos(45 * DEG);
  const px0 = wheelX - 0.12; const px1 = wheelX + 0.12;
  // Two open brass frames rather than two solid plates, so the barrel and the pinion can be seen.
  for (const fx of [px0 - 0.02, px1 + 0.02]) {
    add(block(fx - 0.02, S.BED_TOP, pz - 0.66, fx + 0.02, S.BED_TOP + 0.09, pz + 0.3), BRASS);
    add(block(fx - 0.02, py + 0.2, pz - 0.66, fx + 0.02, py + 0.28, pz + 0.3), BRASS);
    add(block(fx - 0.02, S.BED_TOP, pz - 0.66, fx + 0.02, py + 0.28, pz - 0.58), BRASS);
    add(block(fx - 0.02, S.BED_TOP, pz + 0.22, fx + 0.02, py + 0.28, pz + 0.3), BRASS);
    add(block(fx - 0.02, py - 0.05, pz - 0.66, fx + 0.02, py + 0.03, pz + 0.3), BRASS);
  }
  for (const [ay, az] of [[S.BED_TOP + 0.05, pz - 0.62], [S.BED_TOP + 0.05, pz + 0.26], [py + 0.24, pz - 0.62], [py + 0.24, pz + 0.26]]) {
    add(latheX([[0, px0 - 0.07], [0.028, px0 - 0.07], [0.028, px1 + 0.07], [0, px1 + 0.07]], 8).translate(0, ay, az), STEEL);
  }
  const barrelY = py - 0.02; const barrelZ = pz - 0.32;
  add(latheX([[0, -0.08], [0.25, -0.08], [0.26, 0], [0.25, 0.08], [0, 0.08]], 26).translate(wheelX, barrelY, barrelZ), 0x93742f);
  add(latheX([[0, px1], [0.035, px1], [0.035, px1 + 0.2], [0, px1 + 0.2]], 10).translate(0, barrelY, barrelZ), STEEL);
  add(beam([px1 + 0.2, barrelY - 0.12, barrelZ], [px1 + 0.2, barrelY + 0.12, barrelZ], 0.035, 0.09, [0, 0, 1]), STEEL);
  add(lathe([[0, 0], [0.05, 0], [0.045, 0.1], [0.02, 0.12], [0, 0.12]], 10).rotateX(-0.2).translate(wheelX, py + 0.26, pz + 0.05), BRASS);

  root.add(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.62, metalness: 0.28 })));

  // THE DRUM, which is what turns. Its own frame: the axle is local X and the origin is on it.
  const drum = new THREE.Group();
  drum.position.set(S.DRUM_X, S.AXLE_Y, 0);
  const W = 768; const H = 1424;
  const paperMap = canvasTexture(W, H, (ctx) => paintSeisPaper(ctx, W, H));
  const NU = 144;
  const ringAt = (r) => (i, j) => {
    const phi = -135 * DEG + (i / NU) * TAU;
    return [(j - 0.5) * S.L, r * Math.sin(phi), r * Math.cos(phi)];
  };
  const paper = gridSolid(NU, 1, ringAt(S.R), ringAt(S.R - 0.03), {
    uvTop: (i, j) => [j, i / NU],
    uvBottom: () => [0.002, 0.001],
    crease: 15,
  });
  drum.add(mesh(paper, standard({ map: paperMap, roughness: 0.82, metalness: 0 })));
  const hw = [];
  const fl = [[0, -0.045], [S.R + 0.03, -0.045], [S.R + 0.045, -0.025], [S.R + 0.045, 0.025], [S.R + 0.03, 0.045], [0, 0.045]];
  for (const side of [-1, 1]) {
    const fx = side * (S.L / 2 + 0.045);
    hw.push({ geometry: latheX(fl, 72).translate(fx, 0, 0), color: IRON });
    hw.push({ geometry: latheX([[0, -0.1], [0.24, -0.1], [0.24, 0.1], [0, 0.1]], 22).translate(side * (S.L / 2 + 0.09), 0, 0), color: IRON2 });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      const sx = side * (S.L / 2 + 0.1);
      hw.push({ geometry: beam([sx, Math.sin(a) * 0.15, Math.cos(a) * 0.15], [sx, Math.sin(a) * (S.R - 0.05), Math.cos(a) * (S.R - 0.05)], 0.05, 0.11, [1, 0, 0]), color: IRON2 });
    }
  }
  hw.push({ geometry: latheX([[0, -S.L / 2 - 0.42], [0.07, -S.L / 2 - 0.42], [0.075, -S.L / 2 - 0.38], [0.075, S.L / 2 + 0.64], [0.07, S.L / 2 + 0.68], [0, S.L / 2 + 0.68]], 18), color: STEEL });
  // The clip that holds the paper's two ends, round at the back when the drum is at rest.
  const clipPhi = 225 * DEG;
  const clip = (d) => [Math.sin(clipPhi) * (S.R + d), Math.cos(clipPhi) * (S.R + d)];
  hw.push({ geometry: beam([-S.L / 2, clip(0)[0], clip(0)[1]], [S.L / 2, clip(0)[0], clip(0)[1]], 0.1, 0.03, [0, clip(1)[0], clip(1)[1]]), color: STEEL });
  // The big wheel on the axle, turned so a tooth points at the pinion's gap at rest.
  const wheel = gearWheel(gR, gN, 0.09, { hub: 0.12 });
  wheel.rotateZ(3 * DEG);
  wheel.rotateY(Math.PI / 2);
  wheel.translate(wheelX - S.DRUM_X, 0, 0);
  hw.push({ geometry: wheel, color: BRASS });
  // A rim and a web, with lightening holes shown as dark recessed discs, either face.
  for (const side of [-1, 1]) {
    const wx = wheelX - S.DRUM_X + side * 0.045;
    hw.push({ geometry: lathe([[0, -0.012], [0.53, -0.012], [0.53, 0.012], [0.49, 0.012], [0.49, 0.004], [0, 0.004]], 56).rotateZ(side > 0 ? -Math.PI / 2 : Math.PI / 2).translate(wx, 0, 0), color: 0xc29c56 });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + 0.26;
      const hole = lathe([[0, 0], [0.105, 0], [0.105, 0.012], [0, 0.012]], 16).rotateZ(side > 0 ? -Math.PI / 2 : Math.PI / 2);
      hole.translate(wx, Math.sin(a) * 0.31, Math.cos(a) * 0.31);
      hw.push({ geometry: hole, color: 0x2a1f10 });
    }
  }
  drum.add(mesh(mergeParts(hw), standard({ vertexColors: true, roughness: 0.55, metalness: 0.3 })));
  root.add(drum);

  // The pinion, its own turning part, four times as fast the other way.
  const pinionGroup = new THREE.Group();
  pinionGroup.position.set(wheelX, py, pz);
  const pinion = gearWheel(pR, pN, 0.12, { hub: 0.05 });
  pinion.rotateZ(-3 * DEG);
  pinion.rotateY(Math.PI / 2);
  const arbor = latheX([[0, -0.14], [0.03, -0.14], [0.03, 0.14], [0, 0.14]], 10);
  pinionGroup.add(mesh(mergeParts([{ geometry: pinion, color: 0xc29c56 }, { geometry: arbor, color: STEEL }]), standard({ vertexColors: true, roughness: 0.5, metalness: 0.3 })));
  root.add(pinionGroup);

  // Plates, each under the part it names, on the pier's face.
  const rows = [
    ['FRAME', 'moves with the ground', -3.0],
    ['HEAVY MASS', 'tends to stay still', mx],
    ['PEN', 'draws the difference', S.PEN_X],
    ['PAPER DRUM', 'one turn a minute', S.PEN_X + 1.75],
  ];
  const AW = 512; const RH = 128;
  const plateMap = canvasTexture(AW, RH * rows.length, (ctx) => {
    rows.forEach(([a, b], i) => plateCell(ctx, 0, i * RH, AW, RH, [a, b], { ground: '#c9a964', ink: '#1a140a', edge: '#6d5526', big: 0.56 }));
  });
  const plates = rows.map(([, , px2], i) => {
    const g = printedPlate(1.36, 0.34, 0.04, uvRect(AW, RH * rows.length, 0, i * RH, AW, RH));
    g.translate(px2, 2.05, Z - 0.035 + 0.032);
    return { geometry: g, keepColor: true };
  });
  root.add(mesh(mergeParts(plates), standard({ map: plateMap, roughness: 0.55, metalness: 0.1 })));

  root.userData.tick = {
    update(dt) {
      if (reducedMotion()) return;
      drum.rotation.x -= dt * S.OMEGA;
      pinionGroup.rotation.x += dt * S.OMEGA * (gN / pN);
    },
    dispose() {},
  };
  return root;
}

// ===========================================================================================
// WEATHER STATION
// ===========================================================================================
//
// Life size. The door of a Stevenson screen opens to the POLE, so that the Sun cannot reach the
// thermometers while somebody reads them, which in the northern hemisphere makes the door's side north.
// So +Z is NORTH here, and the compass follows from that: a student standing at the front is looking
// south, and east is on their left. It is checked below rather than drawn by eye.
//
// The vane's arrow points into the wind, so it says the wind is from the west, and that is the side
// the cups' open mouths are not leading on: a cup is pushed in the mouth, so it travels back first.
export const WX = {
  GT: 0.18, HALF: 6,
  SCREEN: { x: -2.15, z: -1.25, W: 2.6, D: 1.9, FLOOR: 3.5, TOP: 5.3, ROWS: 12 },
  MAST: { x: 3.15, z: -2.2 },
  DIRS: { N: [0, 0, 1], E: [-1, 0, 0], S: [0, 0, -1], W: [1, 0, 0] },
  CUPS: 3, SPIN: TAU,
  DRY: 68, WET: 59,
};

// Where a reading sits on a thermometer's scale, in feet up the board from its foot. One function,
// for the printed ticks and for the red column.
const wxScale = (t) => 0.2 + (t / 120) * 1.0;

function paintWxAtlas(ctx, A) {
  const { W, H } = A;
  ctx.fillStyle = '#cfcabb';
  ctx.fillRect(0, 0, W, H);
  // The pad: a compass rose in concrete. Canvas right is +X and canvas down is +Z, which is what a
  // student at the front sees, so north is at the bottom and east on the left.
  const S = 512; const c = S / 2;
  const n = latticeNoise(77);
  paintTexels(ctx, 0, 0, S, S, (x, y, out) => {
    const v = 150 + n(x / 18, y / 18) * 26 + n(x / 3, y / 3) * 16;
    out[0] = v; out[1] = v * 0.985; out[2] = v * 0.94;
  });
  ctx.strokeStyle = '#2c3a4a'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(c, c, S * 0.455, 0, TAU); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(c, c, S * 0.32, 0, TAU); ctx.stroke();
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * TAU;
    const long = k % 9 === 0 ? 0.05 : 0.025;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * S * 0.455, c + Math.sin(a) * S * 0.455);
    ctx.lineTo(c + Math.cos(a) * S * (0.455 - long), c + Math.sin(a) * S * (0.455 - long));
    ctx.stroke();
  }
  // The eight points, the cardinal four long.
  const point = (a, reach, wide, c0, c1) => {
    const ca = Math.cos(a); const sa = Math.sin(a);
    const px = -sa; const py = ca;
    ctx.fillStyle = c0;
    ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + ca * reach, c + sa * reach); ctx.lineTo(c + ca * wide + px * wide, c + sa * wide + py * wide); ctx.fill();
    ctx.fillStyle = c1;
    ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + ca * reach, c + sa * reach); ctx.lineTo(c + ca * wide - px * wide, c + sa * wide - py * wide); ctx.fill();
  };
  for (let k = 0; k < 4; k++) point(Math.PI / 4 + (k * Math.PI) / 2, S * 0.2, S * 0.035, '#46586c', '#7f8c96');
  for (let k = 0; k < 4; k++) point((k * Math.PI) / 2, S * 0.31, S * 0.05, '#1e2c3c', '#a53a2a');
  ctx.fillStyle = '#10161d';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `800 ${S * 0.1}px ${FONT}`;
  // Each letter's top toward the middle, so it reads from outside the circle.
  const letter = (t, x, y, rot) => { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillText(t, 0, 0); ctx.restore(); };
  const r = S * 0.385;
  letter('N', c, c + r, 0);
  letter('S', c, c - r, Math.PI);
  letter('E', c - r, c, Math.PI / 2);
  letter('W', c + r, c, -Math.PI / 2);

  // The four letters for the arms of the rose up the mast.
  ['N', 'E', 'S', 'W'].forEach((t, i) => {
    const R = A.letter(i);
    ctx.fillStyle = '#20262c';
    ctx.fillRect(R[0], R[1], R[2], R[3]);
    ctx.fillStyle = '#f4f1e6';
    ctx.font = `800 ${R[3] * 0.74}px ${FONT}`;
    ctx.fillText(t, R[0] + R[2] / 2, R[1] + R[3] * 0.54);
  });

  // The thermometers' boards.
  [['DRY', WX.DRY], ['WET', WX.WET]].forEach(([name], i) => {
    const [x, y, w, h] = A.scale(i);
    ctx.fillStyle = '#f6f3e8';
    ctx.fillRect(x, y, w, h);
    const ft = h / 1.4;
    const yy = (t) => y + h - wxScale(t) * ft;
    ctx.textBaseline = 'middle';
    for (let t = 0; t <= 120; t += 2) {
      const big = t % 10 === 0;
      ctx.fillStyle = '#1b1d20';
      ctx.fillRect(x + w * 0.56, yy(t) - (big ? 1.2 : 0.6), big ? w * 0.3 : w * 0.17, big ? 2.4 : 1.2);
      if (big && t % 20 === 0) {
        ctx.textAlign = 'right';
        ctx.font = `700 ${Math.round(ft * 0.052)}px ${FONT}`;
        ctx.fillText(String(t), x + w * 0.34, yy(t));
      }
    }
    ctx.textAlign = 'center';
    fitFont(ctx, name, w * 0.9, ft * 0.07, '800');
    ctx.fillText(name, x + w / 2, y + ft * 0.05);
    ctx.font = `700 ${Math.round(ft * 0.05)}px ${FONT}`;
    ctx.fillText('deg F', x + w / 2, y + ft * 0.115);
  });

  // The name plates.
  const names = [['STEVENSON SCREEN', 'keeps the Sun off the thermometers'], ['ANEMOMETER', 'and WIND VANE'], ['RAIN GAUGE', 'funnel and collector']];
  names.forEach((lines, i) => {
    const [x, y, w, h] = A.plate(i);
    plateCell(ctx, x, y, w, h, lines, { ground: '#f2edd8', ink: '#16181c', edge: '#39424a', big: 0.58 });
  });
}

function letterCube(c, size, uvOf) {
  const pos = []; const uv = [];
  const h = size / 2;
  const up = new THREE.Vector3(0, 1, 0);
  const push = (p, u, v) => { pos.push(p.x, p.y, p.z); uv.push(u, v); };
  const faces = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0]];
  const C = new THREE.Vector3(...c);
  for (const f of faces) {
    const n = new THREE.Vector3(...f);
    const right = up.clone().cross(n);
    const corner = (a, b) => C.clone().addScaledVector(n, h).addScaledVector(right, a * h).addScaledVector(up, b * h);
    const [u0, v0, u1, v1] = uvOf;
    const bl = corner(-1, -1); const br = corner(1, -1); const tr = corner(1, 1); const tl = corner(-1, 1);
    push(bl, u0, v0); push(br, u1, v0); push(tr, u1, v1);
    push(bl, u0, v0); push(tr, u1, v1); push(tl, u0, v1);
  }
  // Blank top and bottom, sampling the plate's dark ground.
  const uu = uvOf[0] + 0.002; const vv = uvOf[1] + 0.002;
  const P = (a, b, d) => C.clone().add(new THREE.Vector3(a * h, d * h, b * h));
  for (const [a, b, q, e] of [[P(-1, 1, 1), P(1, 1, 1), P(1, -1, 1), P(-1, -1, 1)], [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1)]]) {
    for (const t of [a, b, q, a, q, e]) push(t, uu, vv);
  }
  return soup(pos, uv, 20);
}

function buildWeatherStation() {
  const { GT, HALF, SCREEN: SC, MAST, DIRS } = WX;
  const up = new THREE.Vector3(0, 1, 0);
  // N x U = E on a right-handed globe. A mirrored compass is the one mistake here a map reader sees.
  const east = new THREE.Vector3(...DIRS.N).cross(up);
  if (east.distanceTo(new THREE.Vector3(...DIRS.E)) > 1e-9) throw new Error('weather station: the compass is mirrored');
  if (!(WX.WET < WX.DRY)) throw new Error('weather station: a wet bulb cannot read above a dry one');

  const root = new THREE.Group();
  const WHITE = 0xe6e4dc; const SHADE = 0xcfccc2; const GALV = 0x99a2a6; const STEEL = 0x70787d; const BRASS = 0xb48f4c; const TIMBER = 0xdedbd0;

  // The plot.
  const grassTile = wrapRepeat(canvasTexture(1024, 1024, (ctx, w, h) => {
    const a = latticeNoise(31); 
    paintTexels(ctx, 0, 0, w, h, (x, y, out) => {
      const big = a(x / 90, y / 90);
      const mid = a(x / 16 + 7, y / 16);
      const fine = a(x / 2.4, y / 2.4);
      const stripe = Math.floor((x / w) * 8) % 2 === 0 ? 1.05 : 0.95;
      const k = (0.55 + big * 0.35 + mid * 0.25 + fine * 0.35) * stripe;
      out[0] = 58 * k + (fine > 0.8 ? 14 : 0); out[1] = 92 * k + (fine > 0.8 ? 16 : 0); out[2] = 40 * k;
    });
  }), 1 / 12, 1 / 12);
  grassTile.offset.set(0.5, 0.5);
  root.add(mesh(boxFeet(-HALF, 0.09, -HALF, HALF, GT, HALF), standard({ map: grassTile, roughness: 0.96, metalness: 0 })));

  const parts = [];
  const add = (geometry, color) => { parts.push({ geometry, color }); };
  add(block(-HALF, 0, -HALF, HALF, 0.09, HALF), 0x57412a);

  // THE STEVENSON SCREEN ---------------------------------------------------------------
  const cx = SC.x; const cz = SC.z; const hw = SC.W / 2; const hd = SC.D / 2;
  const POST = 0.1;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = cx + sx * (hw - POST / 2); const pz = cz + sz * (hd - POST / 2);
    add(block(px - POST / 2, SC.FLOOR, pz - POST / 2, px + POST / 2, SC.TOP, pz + POST / 2), WHITE);
    // The legs stand a little in from the corners and splay out to the ground.
    const lx = cx + sx * (hw - 0.34); const lz = cz + sz * (hd - 0.3);
    add(beam([lx + sx * 0.28, GT - 0.1, lz + sz * 0.22], [lx, SC.FLOOR + 0.02, lz], 0.18, 0.18), TIMBER);
    add(lathe([[0, 0], [0.19, 0], [0.16, 0.08], [0, 0.09]], 14).translate(lx + sx * 0.28, GT - 0.01, lz + sz * 0.22), 0x8f8c84);
  }
  // Rails tying the legs below the box, and on them the name plate.
  const railY = 2.05;
  for (const sz of [-1, 1]) add(beam([cx - hw + 0.02, railY, cz + sz * (hd - 0.13)], [cx + hw - 0.02, railY, cz + sz * (hd - 0.13)], 0.08, 0.16), TIMBER);
  for (const sx of [-1, 1]) add(beam([cx + sx * (hw - 0.17), railY, cz - hd + 0.02], [cx + sx * (hw - 0.17), railY, cz + hd - 0.02], 0.08, 0.16), TIMBER);
  // Floor: three boards with gaps, because air comes up through it as well.
  const FLOOR_T = 0.06;
  add(block(cx - hw, SC.FLOOR - 0.14, cz - hd, cx + hw, SC.FLOOR - 0.08, cz - hd + 0.12), WHITE);
  add(block(cx - hw, SC.FLOOR - 0.14, cz + hd - 0.12, cx + hw, SC.FLOOR - 0.08, cz + hd), WHITE);
  add(block(cx - hw, SC.FLOOR - 0.14, cz - hd, cx - hw + 0.12, SC.FLOOR - 0.08, cz + hd), WHITE);
  add(block(cx + hw - 0.12, SC.FLOOR - 0.14, cz - hd, cx + hw, SC.FLOOR - 0.08, cz + hd), WHITE);
  for (let i = 0; i < 3; i++) {
    const z0 = cz - hd + 0.12 + (i * (SC.D - 0.24)) / 3;
    add(block(cx - hw + 0.1, SC.FLOOR - 0.1, z0 + 0.03, cx + hw - 0.1, SC.FLOOR - 0.1 + FLOOR_T, z0 + (SC.D - 0.24) / 3 - 0.03), SHADE);
  }

  // Double louvres, as real slats. The outer leaf sheds rain by sloping down and out, the inner one
  // the other way, so air can pass and light cannot.
  const SLAT_W = 0.2; const SLAT_T = 0.024;
  const S45 = Math.SQRT1_2;
  const pitch = (SC.TOP - SC.FLOOR - 0.12) / SC.ROWS;
  if (SLAT_W * S45 <= pitch) throw new Error('weather station: the louvres do not overlap, so sunlight would pass');
  let slats = 0;
  const leaf = (list, a, b, normal, inner, y) => {
    const n = new THREE.Vector3(...normal);
    const width = n.clone().multiplyScalar(inner ? -S45 : S45).addScaledVector(up, -S45);
    const wv = [width.x, width.y, width.z];
    // beam's height runs along `up`, which has to be square to the run.
    list.push({ geometry: beam([a[0], y, a[1]], [b[0], y, b[1]], SLAT_T, SLAT_W, wv), color: WHITE });
    slats += 1;
  };
  const wall = (list, a, b, normal, y0) => {
    const off = (p, d) => [p[0] + normal[0] * d, p[1] + normal[2] * d];
    for (let r = 0; r < SC.ROWS; r++) {
      const y = y0 + (r + 0.5) * pitch;
      leaf(list, off(a, -0.02), off(b, -0.02), normal, false, y);
      leaf(list, off(a, -0.2), off(b, -0.2), normal, true, y);
    }
  };
  const y0 = SC.FLOOR + 0.04;
  wall(parts, [cx + hw - 0.01, cz - hd + 0.04], [cx + hw - 0.01, cz + hd - 0.04], [1, 0, 0], y0);
  wall(parts, [cx - hw + 0.01, cz - hd + 0.04], [cx - hw + 0.01, cz + hd - 0.04], [-1, 0, 0], y0);
  wall(parts, [cx - hw + 0.04, cz - hd + 0.01], [cx + hw - 0.04, cz - hd + 0.01], [0, 0, -1], y0);
  // Corner rails top and bottom, closing the box.
  add(block(cx - hw, SC.FLOOR - 0.04, cz - hd, cx + hw, SC.FLOOR + 0.02, cz - hd + 0.1), WHITE);
  for (const sx of [-1, 1]) add(block(cx + sx * hw - (sx > 0 ? 0.1 : 0), SC.FLOOR - 0.04, cz - hd, cx + sx * hw + (sx < 0 ? 0.1 : 0), SC.FLOOR + 0.02, cz + hd), WHITE);
  add(block(cx - hw, SC.FLOOR - 0.04, cz + hd - 0.1, cx + hw, SC.FLOOR + 0.02, cz + hd), WHITE);

  // Double roof: a solid ceiling, an air gap on spacers, and a pitched roof over it with an overhang.
  add(block(cx - hw, SC.TOP - 0.02, cz - hd, cx + hw, SC.TOP + 0.06, cz + hd), WHITE);
  for (const sx of [-0.8, 0, 0.8]) for (const sz of [-0.8, 0.8]) {
    add(block(cx + sx * hw - 0.06, SC.TOP + 0.05, cz + sz * hd - 0.06, cx + sx * hw + 0.06, SC.TOP + 0.26, cz + sz * hd + 0.06), SHADE);
  }
  const ridge = SC.TOP + 0.56; const eave = SC.TOP + 0.2; const over = 0.26;
  for (const side of [-1, 1]) {
    const roofA = [cx, ridge, cz + side * 0];
    const roofB = [cx, eave, cz + side * (hd + over)];
    const n = new THREE.Vector3(0, hd + over, side * (ridge - eave)).normalize();
    const { m, len } = alongMatrix(roofA, roofB, [n.x, n.y, n.z]);
    const g = new THREE.BoxGeometry(SC.W + 2 * over, 0.05, len + 0.015);
    g.translate(0, 0, len / 2);
    g.applyMatrix4(m);
    add(g, WHITE);
  }
  add(rod([cx - hw - over, ridge + 0.015, cz], [cx + hw + over, ridge + 0.015, cz], 0.035, 8, 0), SHADE);

  // Inside: two rails across the box, and two thermometers on them.
  const inZ = cz + 0.05;
  for (const ry of [SC.FLOOR + 0.38, SC.FLOOR + 1.52]) add(block(cx - hw + 0.2, ry - 0.045, inZ - 0.06, cx + hw - 0.2, ry + 0.045, inZ - 0.015), TIMBER);
  add(block(cx - 0.72, SC.FLOOR + 0.3, inZ - 0.08, cx - 0.66, SC.FLOOR + 1.6, inZ - 0.02), SHADE);
  add(block(cx + 0.66, SC.FLOOR + 0.3, inZ - 0.08, cx + 0.72, SC.FLOOR + 1.6, inZ - 0.02), SHADE);
  const boardFoot = SC.FLOOR + 0.26;
  const boardH = 1.4; const boardW = 0.3;
  const thermX = [cx - 0.32, cx + 0.32];
  const board3D = (i) => {
    const x = thermX[i];
    const T = i === 0 ? WX.DRY : WX.WET;
    const bulbY = boardFoot + wxScale(0) - 0.09;
    const topY = boardFoot + wxScale(120);
    const tx = x + 0.033;
    const ty = boardFoot + wxScale(T);
    // The glass, the mercury to its reading, the bulb.
    add(rod([tx, bulbY, inZ + 0.05], [tx, topY + 0.02, inZ + 0.05], 0.021, 8, 1), 0xdfe6e8);
    add(rod([tx, bulbY, inZ + 0.066], [tx, ty, inZ + 0.066], 0.0105, 6, 0), 0xc4261c);
    add(lathe([[0, -0.05], [0.02, -0.045], [0.034, -0.02], [0.036, 0.01], [0.02, 0.05], [0, 0.07]], 12).translate(tx, bulbY - 0.04, inZ + 0.05), i === 0 ? 0xc4261c : 0xe9e4d2);
    // Clips.
    for (const cy of [bulbY + 0.1, topY - 0.05]) add(block(tx - 0.04, cy - 0.012, inZ + 0.015, tx + 0.04, cy + 0.012, inZ + 0.082), BRASS);
    if (i === 1) {
      // The wet bulb's muslin wick, down into its little pot of water on the floor.
      add(tube([[tx, bulbY - 0.09, inZ + 0.05], [tx + 0.01, bulbY - 0.2, inZ + 0.09], [tx + 0.03, SC.FLOOR + 0.1, inZ + 0.13]], [0.016, 0.012, 0.012], { sides: 6, steps: 8 }), 0xe9e4d2);
      add(lathe([[0, 0], [0.11, 0], [0.12, 0.13], [0.1, 0.14], [0.09, 0.09], [0, 0.09]], 18).translate(tx + 0.03, SC.FLOOR - 0.045, inZ + 0.13), 0x8fa3ad);
    }
  };
  board3D(0); board3D(1);

  // The door: hinged on its left, open a little past square, itself double-louvred.
  const doorW = SC.W - 0.05; const doorH = SC.TOP - SC.FLOOR;
  const door = [];
  const dPart = (geometry) => door.push({ geometry, color: WHITE });
  dPart(block(0, 0, -0.1, 0.09, doorH, 0));
  dPart(block(doorW - 0.09, 0, -0.1, doorW, doorH, 0));
  dPart(block(0, 0, -0.1, doorW, 0.09, 0));
  dPart(block(0, doorH - 0.09, -0.1, doorW, doorH, 0));
  const dRows = Math.round((doorH - 0.2) / 0.1);
  for (let r = 0; r < dRows; r++) {
    const y = 0.09 + (r + 0.5) * ((doorH - 0.18) / dRows);
    for (const [zz, s] of [[-0.015, 1], [-0.085, -1]]) {
      const w = [0, -S45, s * S45];
      door.push({ geometry: beam([0.05, y, zz], [doorW - 0.05, y, zz], 0.014, 0.1, w), color: WHITE });
      slats += 1;
    }
  }
  door.push({ geometry: lathe([[0, 0], [0.04, 0], [0.04, 0.03], [0.02, 0.05], [0.03, 0.09], [0, 0.1]], 10).rotateX(Math.PI / 2).translate(doorW - 0.05, doorH / 2, 0), color: BRASS });
  for (const hy of [0.25, doorH - 0.25]) door.push({ geometry: block(-0.02, hy - 0.08, -0.02, 0.2, hy + 0.08, 0.008), color: 0x4a4f53 });
  const OPEN = 112 * DEG;
  const dm = new THREE.Matrix4().makeRotationY(-OPEN);
  dm.setPosition(cx - hw + 0.02, SC.FLOOR, cz + hd);
  parts.push({ geometry: mergeParts(door).applyMatrix4(dm), keepColor: true });
  // The frame the door would close on, so the opening has a real edge.
  add(block(cx - hw, SC.TOP - 0.1, cz + hd - 0.1, cx + hw, SC.TOP - 0.02, cz + hd), WHITE);
  if (slats !== SC.ROWS * 2 * 3 + dRows * 2) throw new Error('weather station: the louvres are not all double');

  // THE MAST ---------------------------------------------------------------------------
  const mx = MAST.x; const mz = MAST.z;
  const padR = 1.15;
  const PAD_Y = GT + 0.05;
  add(lathe([[0, 0.05], [0.2, 0.05], [0.2, PAD_Y + 0.05], [0.12, PAD_Y + 0.14], [0, PAD_Y + 0.14]], 18).translate(mx, 0, mz), STEEL);
  const mastTop = 9.15;
  add(lathe([[0, GT], [0.11, GT], [0.1, 4], [0.075, 7.6], [0.06, mastTop - 0.05], [0.04, mastTop], [0, mastTop]], 16).translate(mx, 0, mz), GALV);
  for (const y of [3.6, 7.2]) add(lathe([[0, y - 0.1], [0.135, y - 0.1], [0.135, y + 0.1], [0, y + 0.1]], 16).translate(mx, 0, mz), STEEL);
  // Guy wires, on three anchors.
  for (let k = 0; k < 3; k++) {
    const a = 0.35 + (k / 3) * TAU;
    const ax = THREE.MathUtils.clamp(mx + Math.cos(a) * 2.3, -HALF + 0.4, HALF - 0.4);
    const az = THREE.MathUtils.clamp(mz + Math.sin(a) * 2.3, -HALF + 0.4, HALF - 0.4);
    add(rod([mx, 7.1, mz], [ax, GT + 0.1, az], 0.012, 5, 0), 0x565c60);
    add(lathe([[0, 0], [0.09, 0], [0.05, 0.09], [0.0, 0.14]], 8).translate(ax, GT - 0.02, az), STEEL);
  }
  // The rose under the vane: four arms and a letter on each, on the true bearing.
  const roseY = 8.78; const armLen = 0.8;
  const letterCubes = [];
  const A = {
    W: 1024, H: 1024,
    letter: (i) => [512 + i * 128, 0, 128, 128],
    scale: (i) => [512 + i * 100, 128, 82, 384],
    plate: (i) => [0, 512 + i * 160, 1024, 160],
  };
  const atlasUv = (R) => uvRect(A.W, A.H, R[0], R[1], R[2], R[3]);
  ['N', 'E', 'S', 'W'].forEach((t, i) => {
    const d = DIRS[t];
    const at = [mx + d[0] * armLen, roseY, mz + d[2] * armLen];
    add(rod([mx, roseY, mz], at, 0.022, 8, 1), 0x2a2f33);
    letterCubes.push({ geometry: letterCube(at, 0.3, atlasUv(A.letter(i))), keepColor: true });
  });
  add(lathe([[0, roseY - 0.09], [0.1, roseY - 0.09], [0.1, roseY + 0.09], [0, roseY + 0.09]], 14).translate(mx, 0, mz), 0x2a2f33);

  // The vane: an arrow pointing into the wind, its tail far bigger than its head so that the wind
  // turns it that way. It stands still here. It is authored along +X, which is west.
  const vy = 9.5;
  add(rod([mx, mastTop - 0.08, mz], [mx, vy + 0.1, mz], 0.022, 8, 1), 0x2a2f33);
  add(lathe([[0, -0.06], [0.055, -0.06], [0.055, 0.06], [0.03, 0.09], [0, 0.1]], 12).translate(mx, vy - 0.03, mz), BRASS);
  const dirW = DIRS.W;
  if (dirW[0] !== 1) throw new Error('weather station: the vane is authored along +X');
  // Three flat pieces, each its own colour: a head, a shaft, and a swallow-tailed fin.
  const vaneBit = (outline, color) => add(extrudeOutline(outline, 0.03).translate(mx, vy, mz), color);
  vaneBit([[1.55, 0], [0.92, 0.24], [0.92, -0.24]], 0xc8331f);
  vaneBit([[0.96, 0.045], [-0.72, 0.045], [-0.72, -0.045], [0.96, -0.045]], 0x3b4247);
  vaneBit([[-0.62, 0.05], [-1.0, 0.38], [-1.55, 0.38], [-1.26, 0], [-1.55, -0.38], [-1.0, -0.38], [-0.62, -0.05]], 0xc8331f);

  // The side arm that carries the cups, clear of the rose and of the vane.
  const armEnd = mx - 1.75;
  const armY = 7.75;
  add(rod([mx, armY, mz], [armEnd, armY, mz], 0.036, 10, 1), GALV);
  add(rod([mx, armY + 0.5, mz], [mx - 0.8, armY + 0.02, mz], 0.015, 6, 1), STEEL);
  const anY = armY + 0.72;
  add(lathe([[0, armY - 0.07], [0.055, armY - 0.07], [0.055, anY - 0.18], [0.1, anY - 0.14], [0.1, anY - 0.06], [0.05, anY - 0.03], [0, anY - 0.03]], 16).translate(armEnd, 0, mz), STEEL);

  // THE CUPS, which turn. A cup is pushed in the mouth, so it travels convex side first, and that
  // fixes which way round each has to be for the direction this group spins.
  const rotor = new THREE.Group();
  rotor.position.set(armEnd, anY, mz);
  const rp = [];
  const cupR = 0.2; const reach = 0.55;
  const cupProfile = [[0, -cupR]];
  for (let i = 1; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2); cupProfile.push([Math.cos(a) * cupR, Math.sin(a) * cupR]); }
  cupProfile.push([cupR - 0.012, 0.004]);
  for (let i = 7; i >= 1; i--) { const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2); cupProfile.push([Math.cos(a) * (cupR - 0.018), Math.sin(a) * (cupR - 0.018)]); }
  cupProfile.push([0, -cupR + 0.018]);
  rp.push({ geometry: lathe([[0, -0.03], [0.07, -0.03], [0.07, 0.03], [0.04, 0.09], [0, 0.11]], 16), color: 0x3b4247 });
  for (let k = 0; k < WX.CUPS; k++) {
    const a = (k / WX.CUPS) * TAU;
    const rad = [Math.cos(a), 0, Math.sin(a)];
    rp.push({ geometry: rod([0, 0.02, 0], [rad[0] * reach, 0.02, rad[2] * reach], 0.016, 7, 1), color: 0x3b4247 });
    // Velocity of a point under +Y spin is Y x r = (rz, 0, -rx); the mouth faces the other way.
    const mouth = new THREE.Vector3(-rad[2], 0, rad[0]);
    const g = lathe(cupProfile, 22);
    tintVertices(g, (x, y, z, o) => {
      const inside = Math.hypot(x, y, z) < cupR - 0.006;
      const c = inside ? lin(0x7f878c) : lin(0xd9d7cf);
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
    });
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), mouth)));
    g.translate(rad[0] * (reach + cupR * 0.75), 0.02, rad[2] * (reach + cupR * 0.75));
    rp.push({ geometry: g, keepColor: true });
  }
  rotor.add(mesh(mergeParts(rp), standard({ vertexColors: true, roughness: 0.5, metalness: 0.12 })));
  root.add(rotor);

  // THE RAIN GAUGE ---------------------------------------------------------------------
  const gx = 1.25; const gz = 2.35; const gr = 0.34; const gTop = 1.15;
  // Collector below, funnel seated in it above: a real rim is sharp so that a raindrop is either in
  // or out. The funnel is one closed solid, its mouth a real cone down to a dark hole.
  const seam = GT + 0.62;
  add(lathe([[0, GT - 0.02], [gr * 0.98, GT - 0.02], [gr * 0.98, seam], [0, seam]], 36).translate(gx, 0, gz), GALV);
  const fun = lathe([
    [0, seam - 0.02], [gr * 1.0, seam - 0.02], [gr * 1.0, gTop + GT - 0.045], [gr * 1.0, gTop + GT - 0.04], [gr * 1.03, gTop + GT - 0.015], [gr * 0.985, gTop + GT], [gr * 0.965, gTop + GT - 0.03], [gr * 0.955, gTop + GT - 0.035], [gr * 0.9, gTop + GT - 0.1],
    [0.075, seam + 0.2], [0.05, seam + 0.13], [0, seam + 0.13],
  ], 36);
  tintVertices(fun, (x, y, z, o) => {
    const rad = Math.hypot(x, z);
    let c = lin(0xa8aeb0);
    if (y > GT + gTop - 0.042 && rad > gr * 0.96) c = lin(BRASS);
    else if (rad < gr * 0.97 && y > seam) c = lin(0x6c7377);
    if (rad < 0.085 && y < seam + 0.22) c = lin(0x101214);
    o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
  });
  fun.translate(gx, 0, gz);
  parts.push({ geometry: fun, keepColor: true });
  add(lathe([[0, seam - 0.05], [gr * 1.02, seam - 0.05], [gr * 1.02, seam + 0.03], [0, seam + 0.03]], 36).translate(gx, 0, gz), STEEL);
  // Its stake and plate.
  add(block(gx + 1.06, GT - 0.05, gz - 0.04, gx + 1.14, 1.2, gz + 0.04), TIMBER);

  // The fence: low posts and two rails, with a gap at the front to walk through.
  const F = HALF - 0.28; const FH = 1.5;
  const postsAt = [];
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const t = -F + (i / steps) * 2 * F;
    postsAt.push([t, -F], [t, F], [-F, t], [F, t]);
  }
  const seen = new Set();
  for (const [px, pz] of postsAt) {
    const key = `${px.toFixed(2)},${pz.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cap = 0.06;
    const shape = [[-cap, GT - 0.05], [cap, GT - 0.05], [cap, FH], [0, FH + 0.09], [-cap, FH]];
    const g = extrudeOutline(shape, cap * 2);
    g.translate(px, 0, pz);
    add(g, 0xece9df);
  }
  const rail = (a, b) => { for (const y of [0.62, 1.22]) add(block(Math.min(a[0], b[0]) - 0.02, y - 0.045, Math.min(a[1], b[1]) - 0.02, Math.max(a[0], b[0]) + 0.02, y + 0.045, Math.max(a[1], b[1]) + 0.02), 0xece9df); };
  rail([-F, -F], [F, -F]);
  rail([-F, -F], [-F, F]);
  rail([F, -F], [F, F]);
  const stepX = (2 * F) / steps;
  rail([-F, F], [-F + 2 * stepX, F]);
  rail([F - 2 * stepX, F], [F, F]);

  // Grass, in blades. A blade is a closed three-sided spike, and none grows on the pad or the gauge.
  const rng = seededRandom(4411);
  const gp = []; const gc = [];
  const colA = lin(0x2c5120); const colB = lin(0x6c8f42);
  const pushV = (v, c) => { gp.push(v[0], v[1], v[2]); gc.push(c[0], c[1], c[2]); };
  for (let t = 0; t < 2600; t++) {
    const x = (rng() * 2 - 1) * (HALF - 0.1); const z = (rng() * 2 - 1) * (HALF - 0.1);
    if (Math.hypot(x - mx, z - mz) < padR + 0.05 || Math.hypot(x - gx, z - gz) < gr + 0.06) continue;
    const n = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const ox = x + (rng() - 0.5) * 0.14; const oz = z + (rng() - 0.5) * 0.14;
      const h = 0.14 + rng() * 0.22; const w = 0.016 + rng() * 0.012;
      const a = rng() * TAU;
      const lean = 0.03 + rng() * 0.09; const la = rng() * TAU;
      const tip = [ox + Math.cos(la) * lean, GT + h, oz + Math.sin(la) * lean];
      const tone = rng();
      const baseC = [colA[0] * (0.8 + tone * 0.4), colA[1] * (0.8 + tone * 0.4), colA[2] * (0.8 + tone * 0.4)];
      const tipC = [colB[0] * (0.75 + tone * 0.5), colB[1] * (0.75 + tone * 0.5), colB[2] * (0.75 + tone * 0.5)];
      const b = [0, 1, 2].map((q) => [ox + Math.cos(a + (q * TAU) / 3) * w, GT - 0.01, oz + Math.sin(a + (q * TAU) / 3) * w]);
      // Each side wound counter-clockwise from outside.
      for (const [p, q] of [[0, 2], [2, 1], [1, 0]]) { pushV(b[p], baseC); pushV(b[q], baseC); pushV(tip, tipC); }
    }
  }
  const grass = new THREE.BufferGeometry();
  grass.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  grass.setAttribute('color', new THREE.Float32BufferAttribute(gc, 3));
  // Lit from above whichever way a blade faces, as a lawn is seen.
  const gn = new Float32Array(gp.length);
  for (let i = 1; i < gn.length; i += 3) gn[i] = 1;
  grass.setAttribute('normal', new THREE.BufferAttribute(gn, 3));
  parts.push({ geometry: grass, keepColor: true });

  root.add(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.72, metalness: 0.08 })));

  // Everything printed.
  const atlas = canvasTexture(A.W, A.H, (ctx) => paintWxAtlas(ctx, A));
  const printed = [...letterCubes];
  // The pad, a disc lying on the grass, with its rose.
  const PAD_N = 48;
  const padGeo = (() => {
    const pos = []; const uv = [];
    const u0 = 0; const v0 = 1 - 512 / A.H; const uS = 512 / A.W; const vS = 512 / A.H;
    const uvAt = (x, z) => [u0 + ((x / padR) * 0.5 + 0.5) * uS, v0 + (1 - ((z / padR) * 0.5 + 0.5)) * vS];
    const push = (x, y, z, q) => { pos.push(mx + x, y, mz + z); uv.push(q[0], q[1]); };
    for (let k = 0; k < PAD_N; k++) {
      const a0 = (k / PAD_N) * TAU; const a1 = ((k + 1) / PAD_N) * TAU;
      const x0 = Math.cos(a0) * padR; const z0 = Math.sin(a0) * padR; const x1 = Math.cos(a1) * padR; const z1 = Math.sin(a1) * padR;
      // Top fan.
      push(0, PAD_Y, 0, uvAt(0, 0)); push(x1, PAD_Y, z1, uvAt(x1, z1)); push(x0, PAD_Y, z0, uvAt(x0, z0));
      // Rim and underside, plain concrete.
      const q = uvAt(padR * 0.95, 0);
      push(x0, PAD_Y, z0, q); push(x1, PAD_Y, z1, q); push(x1, GT - 0.03, z1, q);
      push(x0, PAD_Y, z0, q); push(x1, GT - 0.03, z1, q); push(x0, GT - 0.03, z0, q);
      push(0, GT - 0.03, 0, q); push(x0, GT - 0.03, z0, q); push(x1, GT - 0.03, z1, q);
    }
    return soup(pos, uv, 30);
  })();
  printed.push({ geometry: padGeo, keepColor: true });
  // The two thermometer boards. Foot of the board at boardFoot; its printed scale is 1.4ft tall.
  thermX.forEach((x, i) => {
    const g = printedPlate(boardW, boardH, 0.03, atlasUv(A.scale(i)));
    g.translate(x, boardFoot + boardH / 2, inZ + 0.015);
    printed.push({ geometry: g, keepColor: true });
  });
  // The name plates.
  const namePlate = (i, w, h, x, y, z, ry = 0) => {
    const g = printedPlate(w, h, 0.03, atlasUv(A.plate(i)));
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    printed.push({ geometry: g, keepColor: true });
  };
  namePlate(0, 1.9, 0.3, cx, railY + 0.02, cz + hd - 0.13 + 0.07);
  namePlate(1, 1.25, 0.2, mx, 5.2, mz + 0.11);
  namePlate(2, 1.25, 0.2, gx + 1.1, 1.1, gz + 0.06);
  root.add(mesh(mergeParts(printed), standard({ map: atlas, roughness: 0.78, metalness: 0 })));

  root.userData.tick = {
    update(dt) {
      if (!reducedMotion()) rotor.rotation.y += dt * WX.SPIN;
    },
    dispose() {},
  };
  return root;
}

// ===========================================================================================
// SOIL PROFILE
// ===========================================================================================
//
// A block about life size, cut clean on +Z. The master horizons, top down, are O, A, B, C and R, and
// their boundaries are one set of functions used for every painted face, every plate and every
// root, so a plate cannot name the wrong layer. A true O or A horizon can be a matter of inches;
// these are drawn thick enough to read, which the report notes.
export const SOIL = {
  HALF_X: 4, HALF_Z: 2, BASE: 0.12,
  FACE: 2,
  NAMES: [
    ['O', 'Leaf litter and humus'],
    ['A', 'Topsoil'],
    ['B', 'Subsoil, rich in clay'],
    ['C', 'Broken, weathered rock'],
    ['R', 'Solid bedrock'],
  ],
};

const soilGround = (x, z) => 9.08 + 0.07 * Math.sin(x * 0.9 + z * 0.8 + 0.5) + 0.05 * Math.sin(x * 2.1 - z * 1.3 + 1.7) + 0.022 * Math.sin(x * 5.3 + z * 3.1);
const soilOA = (x, z) => soilGround(x, z) - 0.5 - 0.09 * Math.sin(x * 1.9 + z * 0.9 + 0.3) - 0.035 * Math.sin(x * 6.1 - z * 2.1 + 2);
const soilAB = (x, z) => 6.78 + 0.22 * Math.sin(x * 1.05 + z * 0.5 + 1.1) + 0.12 * Math.sin(x * 2.7 - z * 0.8 + 0.4) + 0.05 * Math.sin(x * 7.1 + z * 1.9);
const soilBC = (x, z) => 4.42 + 0.3 * Math.sin(x * 0.8 - z * 0.6 + 2.6) + 0.2 * Math.sin(x * 2.2 + z * 1.1 + 0.7) + 0.1 * Math.sin(x * 5.3 - z * 1.7 + 1.9);
const soilCR = (x, z) => 2.06 + 0.3 * Math.sin(x * 1.25 + z * 0.7 + 4.1) + 0.24 * Math.sin(x * 2.9 - z * 1.2 + 2.2) + 0.14 * Math.sin(x * 6.7 + z * 2.3 + 0.5);
export const SOIL_BOUNDS = [soilGround, soilOA, soilAB, soilBC, soilCR];

// Which horizon a point is in: 0 O, 1 A, 2 B, 3 C, 4 R.
export const soilHorizon = (x, y, z) => {
  if (y > soilOA(x, z)) return 0;
  if (y > soilAB(x, z)) return 1;
  if (y > soilBC(x, z)) return 2;
  if (y > soilCR(x, z)) return 3;
  return 4;
};

function soilPainter() {
  const n1 = latticeNoise(101); const n2 = latticeNoise(202); const n3 = latticeNoise(303);
  const ramp = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
  return (x, y, yO, yA, yB, yC, out) => {
    // A little noise on the height a point is asked at, so a boundary is a soil's and not a ruler's.
    const fine = n3(x * 26, y * 26);
    const yy = y + (fine - 0.5) * 0.045;
    const coarse = n1(x * 2.3 + 11, y * 2.3);
    const crumb = n2(x * 15, y * 15);
    let c;
    if (yy > yO) {
      // O: nearly black, with flakes of leaf not yet rotted lying flat.
      const flake = n2(x * 9, y * 42);
      c = [27 + fine * 18, 21 + fine * 12, 15 + fine * 9];
      if (flake > 0.68) { const k = (flake - 0.68) / 0.32; c = ramp(c, [112, 76, 38], Math.min(1, k * 1.9)); }
    } else if (yy > yA) {
      // A: dark and crumbly, reddening a little downward.
      const t = clamp01((yO - yy) / Math.max(0.1, yO - yA));
      c = ramp([50, 36, 26], [84, 58, 38], t ** 1.5);
      const k = 0.72 + crumb * 0.42 + (fine - 0.5) * 0.3;
      c = [c[0] * k, c[1] * k, c[2] * k];
      if (fine > 0.86) c = ramp(c, [150, 132, 104], (fine - 0.86) * 3);
    } else if (yy > yB) {
      // B: redder, clay-rich, breaking into blocks along fine cracks, with pale mottles.
      const t = clamp01((yA - yy) / Math.max(0.1, yA - yB));
      c = ramp([150, 80, 42], [176, 104, 58], t);
      const k = 0.84 + crumb * 0.2 + coarse * 0.12;
      c = [c[0] * k, c[1] * k, c[2] * k];
      const m = n1(x * 5.2, y * 7.4 + 3);
      if (m > 0.72) c = ramp(c, [186, 142, 106], (m - 0.72) * 1.3);
      const crack = Math.min(Math.abs(n1(x * 3.4 + 40, y * 0.9) - 0.5), Math.abs(n2(x * 1.2, y * 3.1 + 9) - 0.5) * 2.2);
      if (crack < 0.007) { const q = 0.66 + (crack / 0.007) * 0.34; c = [c[0] * q, c[1] * q, c[2] * q]; }
    } else if (yy > yC) {
      // C: the rock falling apart. The matrix is sandy and rusty, and the broken pieces go on top.
      c = ramp([170, 138, 92], [146, 122, 88], clamp01((yB - yy) / Math.max(0.1, yB - yC)));
      const k = 0.8 + crumb * 0.28 + (fine - 0.5) * 0.22;
      c = [c[0] * k, c[1] * k, c[2] * k];
    } else {
      // R: one solid mass, grey and bedded, with few joints.
      const bed = yy * 3.4 + (coarse - 0.5) * 0.7;
      const f = bed - Math.floor(bed);
      c = [112, 114, 118];
      const k = 0.86 + n2(x * 1.2, yy * 7) * 0.2 + (fine - 0.5) * 0.12;
      c = [c[0] * k, c[1] * k, c[2] * k];
      if (f < 0.035) c = [c[0] * 0.66, c[1] * 0.66, c[2] * 0.66];
      // Joints: a few nearly upright cracks through the beds, each on its own line.
      for (const jx of [-2.55, -0.4, 1.35, 3.1]) {
        const w = x - jx - (n1(jx + 9, yy * 1.3) - 0.5) * 0.34 - yy * 0.06;
        if (Math.abs(w) < 0.012) { c = [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55]; break; }
      }
    }
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  };
}

// The stones, one seeded list, and the rule the card and the brief state: larger and more frequent
// going down, with none at all drawn in the solid rock because a stone needs something to be in.
export function soilStones() {
  const rng = seededRandom(7711);
  const FACE = SOIL.FACE;
  const list = [];
  const counts = [0, 26, 86, 230, 0];
  const sizes = [[0, 0], [0.025, 0.06], [0.05, 0.14], [0.1, 0.42], [0, 0]];
  for (let h = 1; h <= 3; h++) {
    let placed = 0;
    for (let t = 0; t < 6000 && placed < counts[h]; t++) {
      const x = mix(-3.98, 3.98, rng());
      const yTop = SOIL_BOUNDS[h](x, FACE); const yBot = SOIL_BOUNDS[h + 1](x, FACE);
      const f = rng() ** (h === 3 ? 0.7 : 1);
      const y = mix(yTop, yBot, f);
      const scale = h === 3 ? mix(0.35, 1, f) : 0.6 + 0.4 * f;
      const size = mix(sizes[h][0], sizes[h][1], rng() ** 1.6) * scale + sizes[h][0] * 0.3;
      if (soilHorizon(x, y, FACE) !== h) continue;
      const sides = 6 + Math.floor(rng() * 4);
      const pts = [];
      const squash = 0.62 + rng() * 0.32;
      const spin = rng() * TAU;
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * TAU;
        const r = size * (0.72 + rng() * 0.42);
        const px = Math.cos(a) * r; const py = Math.sin(a) * r * squash;
        pts.push([px * Math.cos(spin) - py * Math.sin(spin), px * Math.sin(spin) + py * Math.cos(spin)]);
      }
      list.push({ h, x, y, size, pts, tone: rng() });
      placed += 1;
    }
  }
  return list;
}

function paintSoilOverlays(ctx, FX) {
  const FACE = SOIL.FACE;
  const X = FX.x; const Y = FX.y; const P = FX.ppf;
  const stones = soilStones();
  stones.sort((a, b) => a.size - b.size);
  for (const st of stones) {
    const base = st.h === 3 ? [138 + st.tone * 34, 128 + st.tone * 30, 112 + st.tone * 26] : st.h === 2 ? [122 + st.tone * 50, 108 + st.tone * 40, 88 + st.tone * 36] : [116 + st.tone * 56, 104 + st.tone * 48, 90 + st.tone * 40];
    const path = () => {
      ctx.beginPath();
      st.pts.forEach(([a, b], i) => { const qx = X(st.x + a); const qy = Y(st.y + b); if (i) ctx.lineTo(qx, qy); else ctx.moveTo(qx, qy); });
      ctx.closePath();
    };
    path();
    ctx.fillStyle = `rgb(${base[0] | 0},${base[1] | 0},${base[2] | 0})`;
    ctx.fill();
    // Shadow under its lower edge and a lit upper one, so a flat paint sits in the soil.
    ctx.lineWidth = Math.max(1, st.size * P * 0.1);
    ctx.strokeStyle = 'rgba(30,20,12,0.55)';
    ctx.stroke();
    ctx.beginPath();
    const top = [...st.pts].sort((a, b) => b[1] - a[1]).slice(0, 3).sort((a, b) => a[0] - b[0]);
    top.forEach(([a, b], i) => { const qx = X(st.x + a * 0.72); const qy = Y(st.y + b * 0.72); if (i) ctx.lineTo(qx, qy); else ctx.moveTo(qx, qy); });
    ctx.strokeStyle = 'rgba(235,225,205,0.4)';
    ctx.lineWidth = Math.max(1, st.size * P * 0.07);
    ctx.stroke();
  }

  // Fine roots, too small to model: mostly in A, a thinner few on into B.
  const rng = seededRandom(5150);
  ctx.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    let x = mix(-3.6, 3.6, rng());
    let y = soilAB(x, FACE) + 0.1 + rng() * (soilOA(x, FACE) - soilAB(x, FACE) - 0.1);
    const deep = i % 7 === 0;
    let a = -Math.PI / 2 + (rng() - 0.5) * 1.6;
    const len = 12 + Math.floor(rng() * (deep ? 26 : 14));
    ctx.beginPath(); ctx.moveTo(X(x), Y(y));
    for (let k = 0; k < len; k++) {
      a += (rng() - 0.5) * 0.7;
      a = mix(a, -Math.PI / 2, 0.08);
      x += Math.cos(a) * 0.045; y += Math.sin(a) * 0.045;
      if (!deep && y < soilAB(x, FACE) + 0.02) break;
      if (y < soilBC(x, FACE) + 0.5) break;
      ctx.lineTo(X(x), Y(y));
    }
    ctx.strokeStyle = deep ? 'rgba(214,190,150,0.8)' : 'rgba(205,178,134,0.78)';
    ctx.lineWidth = deep ? 1.1 : 1.4;
    ctx.stroke();
  }

  // Worm burrows: dark, with a paler packed lining, wandering through the A horizon.
  for (const path of SOIL_BURROWS) {
    const trace = () => {
      ctx.beginPath();
      path.forEach(([a, b], i) => { if (i) ctx.lineTo(X(a), Y(b)); else ctx.moveTo(X(a), Y(b)); });
    };
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#6a4d33'; ctx.lineWidth = 0.1 * P; trace(); ctx.stroke();
    ctx.strokeStyle = '#120c08'; ctx.lineWidth = 0.068 * P; trace(); ctx.stroke();
  }

  // The mole's run, far wider than anything else in the soil, with soil packed hard round it.
  const run = SOIL_MOLE_RUN;
  const traceRun = () => {
    ctx.beginPath();
    run.forEach(([a, b], i) => { if (i) ctx.lineTo(X(a), Y(b)); else ctx.moveTo(X(a), Y(b)); });
  };
  ctx.strokeStyle = '#7a5a3c'; ctx.lineWidth = 0.52 * P; traceRun(); ctx.stroke();
  ctx.strokeStyle = '#0d0907'; ctx.lineWidth = 0.42 * P; traceRun(); ctx.stroke();

  // The ants' gallery: chambers on a shaft, with eggs stored in the lowest.
  ctx.strokeStyle = '#6e4a2c'; ctx.lineWidth = 0.075 * P;
  for (const seg of SOIL_ANT_SHAFTS) {
    ctx.beginPath();
    seg.forEach(([a, b], i) => { if (i) ctx.lineTo(X(a), Y(b)); else ctx.moveTo(X(a), Y(b)); });
    ctx.stroke();
  }
  ctx.strokeStyle = '#100a07'; ctx.lineWidth = 0.05 * P;
  for (const seg of SOIL_ANT_SHAFTS) {
    ctx.beginPath();
    seg.forEach(([a, b], i) => { if (i) ctx.lineTo(X(a), Y(b)); else ctx.moveTo(X(a), Y(b)); });
    ctx.stroke();
  }
  for (const [cx, cy, rx, ry] of SOIL_ANT_ROOMS) {
    ctx.fillStyle = '#6e4a2c';
    ctx.beginPath(); ctx.ellipse(X(cx), Y(cy), (rx + 0.035) * P, (ry + 0.035) * P, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#100a07';
    ctx.beginPath(); ctx.ellipse(X(cx), Y(cy), rx * P, ry * P, 0, 0, TAU); ctx.fill();
  }
  const eggRoom = SOIL_ANT_ROOMS[SOIL_ANT_ROOMS.length - 1];
  for (let i = 0; i < 16; i++) {
    const ex = eggRoom[0] + (rng() - 0.5) * eggRoom[2] * 1.5;
    const ey = eggRoom[1] - eggRoom[3] * 0.45 + rng() * eggRoom[3] * 0.35;
    ctx.fillStyle = '#efe6cf';
    ctx.beginPath(); ctx.ellipse(X(ex), Y(ey), 0.026 * P, 0.015 * P, rng() * 3, 0, TAU); ctx.fill();
  }
}

// A wandering 2D path, smoothed, so a burrow is a curve and a worm can lie along exactly that curve.
function smooth2D(points, n = 40) {
  const c = new THREE.CatmullRomCurve3(points.map((q) => new THREE.Vector3(q[0], q[1], 0)), false, 'catmullrom', 0.5);
  const out = [];
  for (let i = 0; i <= n; i++) { const v = c.getPoint(i / n); out.push([v.x, v.y]); }
  return out;
}
const SOIL_BURROWS = [
  [[-0.55, 8.46], [-0.42, 8.1], [-0.62, 7.8], [-0.34, 7.48], [-0.5, 7.12], [-0.36, 6.92]],
  [[0.5, 8.3], [0.72, 8.0], [0.6, 7.7], [0.86, 7.45], [1.12, 7.5], [1.2, 7.25]],
  [[-2.1, 8.44], [-2.32, 8.12], [-2.0, 7.86], [-1.78, 7.6], [-1.98, 7.32]],
  [[3.3, 8.3], [3.12, 8.0], [3.34, 7.7], [3.1, 7.42]],
].map((q) => smooth2D(q));
const SOIL_MOLE_RUN = smooth2D([[-3.05, 6.94], [-2.5, 6.92], [-1.9, 6.84], [-1.3, 6.92], [-0.95, 6.86]]);
const SOIL_ANT_ROOMS = [[2.36, 7.82, 0.2, 0.11], [1.96, 7.36, 0.17, 0.095], [2.62, 6.98, 0.23, 0.11], [2.22, 6.44, 0.32, 0.15]];
const SOIL_ANT_SHAFTS = [
  [[2.3, 8.62], [2.42, 8.2], [2.36, 7.82]],
  [[2.36, 7.82], [2.2, 7.55], [1.96, 7.36]],
  [[2.36, 7.82], [2.55, 7.4], [2.62, 6.98]],
  [[2.62, 6.98], [2.46, 6.7], [2.22, 6.44]],
].map((q) => smooth2D(q, 16));

function soilWorm(parts, path, r) {
  const n = 64; const sides = 8;
  const g = tube(path, [r * 0.6, r, r, r * 0.85, r * 0.4].slice(0, 5), {
    sides, steps: n, round: 2,
    section: (t) => { const k = 1 + 0.07 * Math.cos(t * 16 * TAU); return [k, k]; },
  });
  const rows = g.attributes.position.count / sides;
  const pink = lin(0xd4897c); const saddle = lin(0xf0b9a3); const dark = lin(0x9a5a50);
  tintVertices(g, (x, y, z, out, i) => {
    const row = Math.floor(i / sides) / rows;
    const seg = 0.5 + 0.5 * Math.cos(row * 16 * TAU);
    const c = row > 0.22 && row < 0.34 ? saddle : pink;
    const q = mix(0.78, 1.06, seg);
    out[0] = mix(c[0], dark[0], 0.12) * q; out[1] = mix(c[1], dark[1], 0.12) * q; out[2] = mix(c[2], dark[2], 0.12) * q;
  });
  parts.push({ geometry: g, keepColor: true });
}

// A leaf: a closed lens along `dir`, flat side to `up`.
function leafBlade(p, dir, up, L, W, thick = 0.008) {
  const d = new THREE.Vector3(...dir).normalize();
  const u0 = new THREE.Vector3(...up);
  const side = new THREE.Vector3().crossVectors(u0, d).normalize();
  const nrm = new THREE.Vector3().crossVectors(d, side).normalize();
  const at = (i, j, lift) => {
    const t = i / 8; const v = j / 4 - 0.5;
    const w = W * Math.sin(Math.PI * t ** 0.8) ** 0.8;
    const fold = Math.abs(v) * W * 0.2 * Math.sin(Math.PI * t);
    return [
      p[0] + d.x * L * t + side.x * v * 2 * w + nrm.x * (fold + lift * (1 - 4 * v * v)),
      p[1] + d.y * L * t + side.y * v * 2 * w + nrm.y * (fold + lift * (1 - 4 * v * v)),
      p[2] + d.z * L * t + side.z * v * 2 * w + nrm.z * (fold + lift * (1 - 4 * v * v)),
    ];
  };
  return gridSolid(8, 4, (i, j) => at(i, j, thick), (i, j) => at(i, j, -thick), { crease: 80 });
}

function grainy(geometry, seed, amt = 0.1) {
  // A rough stone from a sphere, displaced by direction so a shared corner stays shared.
  const n = latticeNoise(seed);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
    const k = 1 + (n(x * 7 + z * 3 + 10, y * 7 - z * 2 + 10) - 0.5) * amt * 2;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function buildSoilProfile() {
  const { HALF_X: HX, HALF_Z: HZ, BASE, FACE } = SOIL;
  // The layers must be in order, everywhere, with room in each one.
  for (let x = -HX; x <= HX; x += 0.1) {
    for (const z of [-HZ, 0, HZ]) {
      for (let k = 0; k < 4; k++) {
        if (SOIL_BOUNDS[k](x, z) - SOIL_BOUNDS[k + 1](x, z) < 0.3) throw new Error(`soil: horizons ${k} and ${k + 1} pinch out at x=${x}`);
      }
    }
  }
  if (SOIL.NAMES.length !== 5) throw new Error('soil: there are five master horizons here');
  const stones = soilStones();
  const tally = [0, 0, 0, 0, 0]; const mean = [0, 0, 0, 0, 0];
  for (const st of stones) { tally[st.h] += 1; mean[st.h] += st.size; }
  for (let h = 1; h <= 3; h++) mean[h] /= tally[h];
  if (!(tally[1] < tally[2] && tally[2] < tally[3] && mean[1] < mean[2] && mean[2] < mean[3])) throw new Error('soil: stones must grow larger and more frequent going down');
  if (tally[4] !== 0) throw new Error('soil: no loose stones in solid rock');

  const root = new THREE.Group();

  // THE BLOCK. One atlas: the front large, the rest coarser, all from one function.
  const AW = 1536; const FH = 1190; const FW = 1024;
  const TOPY = FH / (FW / (2 * HX)); // feet the front's row reaches: 9.3
  const R = {
    top: { x: 1024, y: 0, w: 512, h: 256 },
    back: { x: 1024, y: 256, w: 512, h: 594 },
    right: { x: 1024, y: 850, w: 160, h: 340 },
    left: { x: 1184, y: 850, w: 160, h: 340 },
  };
  const paint = soilPainter();
  const n = latticeNoise(909);
  const map = canvasTexture(AW, FH, (ctx) => {
    ctx.fillStyle = '#332a20'; ctx.fillRect(0, 0, AW, FH);
    // Front.
    const col = [];
    for (let i = 0; i < FW; i++) {
      const x = -HX + ((i + 0.5) / FW) * (2 * HX);
      col.push([soilOA(x, FACE), soilAB(x, FACE), soilBC(x, FACE), soilCR(x, FACE)]);
    }
    paintTexels(ctx, 0, 0, FW, FH, (i, j, out) => {
      const x = -HX + ((i + 0.5) / FW) * (2 * HX);
      const y = TOPY * (1 - (j + 0.5) / FH);
      const c = col[i];
      paint(x, y, c[0], c[1], c[2], c[3], out);
    });
    const ppf = FW / (2 * HX);
    paintSoilOverlays(ctx, { x: (x) => (x + HX) * ppf, y: (y) => (TOPY - y) * ppf, ppf });
    // The back and the two sides, by the same function. The eye is never as close to them.
    const side = (r, posAt) => {
      paintTexels(ctx, r.x, r.y, r.w, r.h, (i, j, out) => {
        const [x, z] = posAt((i + 0.5) / r.w);
        const y = TOPY * (1 - (j + 0.5) / r.h);
        paint(x, y, soilOA(x, z), soilAB(x, z), soilBC(x, z), soilCR(x, z), out);
      });
    };
    side(R.back, (u) => [HX - u * 2 * HX, -HZ]);
    side(R.right, (u) => [HX, HZ - u * 2 * HZ]);
    side(R.left, (u) => [-HX, -HZ + u * 2 * HZ]);
    // The ground: brown and leafy, with its own grass.
    paintTexels(ctx, R.top.x, R.top.y, R.top.w, R.top.h, (i, j, out) => {
      const a = n(i / 14, j / 14); const b = n(i / 3 + 50, j / 3); const g = n(i / 40 + 9, j / 40);
      const base = [58 + b * 36, 46 + b * 32, 26 + b * 16];
      const moss = sstep(g, 0.42, 0.66);
      out[0] = mix(base[0], 66 + a * 26, moss); out[1] = mix(base[1], 84 + a * 34, moss); out[2] = mix(base[2], 36 + a * 14, moss);
    });
  });
  const uvFront = (x, y) => [((x + HX) / (2 * HX)) * (FW / AW), y / TOPY];
  const uvR = (r, u, v) => [(r.x + u * r.w) / AW, 1 - (r.y + (1 - v) * r.h) / FH];
  const pos = []; const uv = [];
  const quad = (a, b, c, d) => { for (const v of [a, b, c, a, c, d]) { pos.push(v[0], v[1], v[2]); uv.push(v[3], v[4]); } };
  const NX = 96; const NZ = 48;
  const yHere = (x, z) => soilGround(x, z);
  for (let i = 0; i < NX; i++) {
    const x0 = -HX + (i / NX) * 2 * HX; const x1 = -HX + ((i + 1) / NX) * 2 * HX;
    const y0 = yHere(x0, HZ); const y1 = yHere(x1, HZ);
    quad([x0, BASE, HZ, ...uvFront(x0, BASE)], [x1, BASE, HZ, ...uvFront(x1, BASE)], [x1, y1, HZ, ...uvFront(x1, y1)], [x0, y0, HZ, ...uvFront(x0, y0)]);
    const b0 = yHere(x0, -HZ); const b1 = yHere(x1, -HZ);
    const ub0 = (HX - x0) / (2 * HX); const ub1 = (HX - x1) / (2 * HX);
    quad([x1, BASE, -HZ, ...uvR(R.back, ub1, BASE / TOPY)], [x0, BASE, -HZ, ...uvR(R.back, ub0, BASE / TOPY)], [x0, b0, -HZ, ...uvR(R.back, ub0, b0 / TOPY)], [x1, b1, -HZ, ...uvR(R.back, ub1, b1 / TOPY)]);
  }
  for (let j = 0; j < NZ; j++) {
    const z0 = -HZ + (j / NZ) * 2 * HZ; const z1 = -HZ + ((j + 1) / NZ) * 2 * HZ;
    const r0 = yHere(HX, z0); const r1 = yHere(HX, z1);
    const ur0 = (HZ - z0) / (2 * HZ); const ur1 = (HZ - z1) / (2 * HZ);
    quad([HX, BASE, z1, ...uvR(R.right, ur1, BASE / TOPY)], [HX, BASE, z0, ...uvR(R.right, ur0, BASE / TOPY)], [HX, r0, z0, ...uvR(R.right, ur0, r0 / TOPY)], [HX, r1, z1, ...uvR(R.right, ur1, r1 / TOPY)]);
    const l0 = yHere(-HX, z0); const l1 = yHere(-HX, z1);
    const ul0 = (z0 + HZ) / (2 * HZ); const ul1 = (z1 + HZ) / (2 * HZ);
    quad([-HX, BASE, z0, ...uvR(R.left, ul0, BASE / TOPY)], [-HX, BASE, z1, ...uvR(R.left, ul1, BASE / TOPY)], [-HX, l1, z1, ...uvR(R.left, ul1, l1 / TOPY)], [-HX, l0, z0, ...uvR(R.left, ul0, l0 / TOPY)]);
  }
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NZ; j++) {
      const x0 = -HX + (i / NX) * 2 * HX; const x1 = -HX + ((i + 1) / NX) * 2 * HX;
      const z0 = -HZ + (j / NZ) * 2 * HZ; const z1 = -HZ + ((j + 1) / NZ) * 2 * HZ;
      const v = (x, z) => [x, yHere(x, z), z, ...uvR(R.top, (x + HX) / (2 * HX), 1 - (z + HZ) / (2 * HZ))];
      quad(v(x0, z1), v(x1, z1), v(x1, z0), v(x0, z0));
    }
  }
  const under = uvR(R.top, 0.5, 0.5);
  quad([-HX, BASE, -HZ, ...under], [HX, BASE, -HZ, ...under], [HX, BASE, HZ, ...under], [-HX, BASE, HZ, ...under]);
  root.add(mesh(soup(pos, uv, 32), standard({ map, bumpMap: map, bumpScale: 0.9, roughness: 0.95, metalness: 0 })));

  // THE LIVING THINGS AND ANYTHING PROUD OF THE FACE ---------------------------------------
  const life = [];
  const rng = seededRandom(1212);
  const fz = FACE;

  // A low plinth, so the block is standing on something.
  life.push({ geometry: block(-HX - 0.1, 0, -HZ - 0.1, HX + 0.1, BASE, HZ + 0.1), color: 0x3d2a1e });

  // The plant, near the cut, and its roots: real tubes, half proud of the face.
  const px = 0.15; const pz = FACE - 0.12; const py = soilGround(px, pz);
  const ROOT_TAN = 0xc9a26d;
  const roots = [];
  const growRoot = (startX, targetY, spread, r0) => {
    const pts = [[px, py + 0.02, pz], [px + (startX - px) * 0.3, py - 0.14, FACE - 0.02]];
    let x = startX; let y = py - 0.42;
    pts.push([x, y, fz + r0 * 0.1]);
    const steps = Math.max(4, Math.round((y - targetY) / 0.22));
    for (let i = 0; i < steps; i++) {
      x += (rng() - 0.5) * 0.2 + spread * 0.16;
      y -= (y - targetY) / (steps - i);
      pts.push([x, y, fz + r0 * 0.1 * (1 - i / steps)]);
    }
    return pts;
  };
  const addRoot = (pts, r0) => {
    const rad = pts.map((_, i) => r0 * (1 - (i / (pts.length - 1))) ** 0.8 + 0.005);
    life.push({ geometry: tube(pts, rad, { sides: 7, steps: pts.length * 3, round: 1 }), color: ROOT_TAN });
    roots.push(pts);
  };
  // In the A horizon, spreading. Then the few taproots, on into the B.
  const shallow = [[-0.72, 7.3, -1.1], [-0.38, 7.1, -0.5], [0.42, 7.2, 0.6], [0.72, 7.35, 1.2], [-1.0, 7.75, -1.6], [1.02, 7.7, 1.7], [-0.14, 7.05, -0.15]];
  const deep = [[0.08, 5.1, 0.05], [0.26, 5.7, 0.28], [-0.3, 5.95, -0.35]];
  for (const [sx, ty, sp] of shallow) addRoot(growRoot(px + sx, ty, sp, 0.05), 0.05);
  for (const [sx, ty, sp] of deep) addRoot(growRoot(px + sx, ty, sp, 0.07), 0.07);
  // Side roots, from each main root.
  const side = [];
  for (const main of roots) {
    for (let k = 2; k < main.length - 1; k += 2) {
      const m = main[k];
      const dir = rng() > 0.5 ? 1 : -1;
      const len = 0.3 + rng() * 0.4;
      const tipX = m[0] + dir * len; const tipY = m[1] - 0.1 - rng() * 0.26;
      const path = [m, [mix(m[0], tipX, 0.5), mix(m[1], tipY, 0.35), fz + 0.004], [tipX, tipY, fz + 0.002]];
      life.push({ geometry: tube(path, [0.016, 0.01, 0.002], { sides: 5, steps: 6, round: 1 }), color: ROOT_TAN });
      side.push([tipX, tipY]);
    }
  }
  // What the card asks a student to notice, and what the block must then show.
  const endsIn = (pt) => soilHorizon(pt[0], pt[1], FACE);
  const mains = roots.map((q) => endsIn(q[q.length - 1]));
  const inA = mains.filter((h) => h === 1).length; const inB = mains.filter((h) => h === 2).length;
  if (inA !== 7 || inB !== 3) throw new Error(`soil: main roots end A ${inA}, B ${inB}, wanted 7 and 3`);
  const allTips = [...mains, ...side.map(endsIn)];
  if (allTips.filter((h) => h <= 1).length / allTips.length < 0.7) throw new Error('soil: most of the roots should stay in the topsoil');

  // Stem, branches and leaves of the small plant.
  const G1 = 0x4e8a34; const G2 = 0x3a7429; const STEM = 0x7a6242;
  const top = 2.5;
  life.push({ geometry: tube([[px, py - 0.05, pz], [px + 0.04, py + 0.8, pz - 0.02], [px - 0.03, py + 1.7, pz + 0.03], [px + 0.02, py + top, pz]], [0.05, 0.036, 0.022, 0.008], { sides: 9, steps: 18 }), color: STEM });
  for (let i = 0; i < 16; i++) {
    const t = 0.25 + (i / 15) * 0.75;
    const ang = i * 2.4;
    const lx = px + Math.cos(ang) * 0.03; const ly = py + t * top; const lz = pz + Math.sin(ang) * 0.03;
    const L = mix(0.75, 0.36, t);
    const dir = [Math.cos(ang), 0.28 - t * 0.1, Math.sin(ang)];
    life.push({ geometry: leafBlade([lx, ly, lz], dir, [0, 1, 0.25], L, L * 0.34), color: i % 2 ? G1 : G2 });
  }
  // The seedling: two seed leaves and the first true pair.
  const sx = -2.35; const sz = 1.2; const sy = soilGround(sx, sz);
  life.push({ geometry: tube([[sx, sy - 0.03, sz], [sx + 0.01, sy + 0.28, sz], [sx, sy + 0.52, sz]], [0.018, 0.013, 0.007], { sides: 7, steps: 9 }), color: 0x7ea04d });
  for (const q of [0, Math.PI]) {
    life.push({ geometry: leafBlade([sx, sy + 0.28, sz], [Math.cos(q), 0.18, Math.sin(q)], [0, 1, 0], 0.22, 0.09), color: 0x99b95f });
    life.push({ geometry: leafBlade([sx, sy + 0.5, sz], [Math.cos(q + 1.57), 0.4, Math.sin(q + 1.57)], [0, 1, 0], 0.3, 0.1), color: G1 });
  }
  // Fallen leaves and grass.
  const FALL = [0xb4792d, 0x8f5a24, 0xc28f33, 0x7a4a22, 0x9f6a2a];
  for (let i = 0; i < 44; i++) {
    const x = mix(-3.9, 3.9, rng()); const z = mix(-1.9, 1.9, rng());
    const L = 0.24 + rng() * 0.2;
    const a = rng() * TAU;
    const dx = Math.cos(a); const dz = Math.sin(a);
    const bx = x - dx * L * 0.5; const bz = z - dz * L * 0.5;
    if (Math.abs(bx + dx * L) > 3.98 || Math.abs(bz + dz * L) > 1.98 || Math.abs(bx) > 3.98 || Math.abs(bz) > 1.98) continue;
    life.push({ geometry: leafBlade([bx, soilGround(x, z) + 0.016, bz], [dx, 0.02, dz], [0, 1, 0], L, L * 0.34, 0.006), color: FALL[i % FALL.length] });
  }
  const bladeColor = [lin(0x2f5420), lin(0x76923f)];
  const gp = []; const gc = [];
  for (let i = 0; i < 70; i++) {
    const x = mix(-3.85, 3.85, rng()); const z = mix(-1.85, 1.85, rng());
    if (Math.hypot(x - px, z - pz) < 0.4 || Math.hypot(x - sx, z - sz) < 0.4) continue;
    const y = soilGround(x, z);
    const nb = 5 + Math.floor(rng() * 5);
    for (let k = 0; k < nb; k++) {
      const a = rng() * TAU; const w = 0.012 + rng() * 0.008; const h = 0.32 + rng() * 0.4;
      const ox = x + (rng() - 0.5) * 0.12; const oz = z + (rng() - 0.5) * 0.12;
      const la = rng() * TAU; const lean = h * (0.12 + rng() * 0.3);
      const tip = [ox + Math.cos(la) * lean, y + h, oz + Math.sin(la) * lean];
      const b = [0, 1, 2].map((q) => [ox + Math.cos(a + (q * TAU) / 3) * w, y - 0.02, oz + Math.sin(a + (q * TAU) / 3) * w]);
      for (const [p, q] of [[0, 2], [2, 1], [1, 0]]) {
        gp.push(...b[p], ...b[q], ...tip);
        gc.push(...bladeColor[0], ...bladeColor[0], ...bladeColor[1]);
      }
    }
  }
  const tuft = new THREE.BufferGeometry();
  tuft.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  tuft.setAttribute('color', new THREE.Float32BufferAttribute(gc, 3));
  const gn = new Float32Array(gp.length); for (let i = 1; i < gn.length; i += 3) gn[i] = 1;
  tuft.setAttribute('normal', new THREE.BufferAttribute(gn, 3));
  life.push({ geometry: tuft, keepColor: true });

  // Earthworms, each lying in its own painted burrow.
  const onFace = (path, lift) => path.map(([a, b]) => [a, b, fz + lift]);
  soilWorm(life, onFace(SOIL_BURROWS[0].filter((_, i) => i >= 7 && i <= 31 && i % 3 === 1), 0.004), 0.05);
  soilWorm(life, onFace(SOIL_BURROWS[1].filter((_, i) => i >= 2 && i <= 26 && i % 3 === 2), 0.004), 0.048);
  soilWorm(life, onFace(SOIL_BURROWS[2].filter((_, i) => i >= 10 && i <= 34 && i % 3 === 1), 0.004), 0.046);

  // Ants: head, thorax and abdomen on a waist, in their gallery, each six legs. Enlarged about four
  // times, because a true-size ant on this block would not show at all.
  const ant = (x, y, ang) => {
    const c = Math.cos(ang); const s = Math.sin(ang);
    const P = (a, b, d = 0) => [x + a * c - b * s, y + a * s + b * c, fz + 0.02 + d];
    const blob = (a, b, r, sq = 0.8) => {
      const g = new THREE.SphereGeometry(r, 9, 7);
      g.scale(1.2, sq, 0.75);
      g.rotateZ(ang);
      const q = P(a, b);
      g.translate(q[0], q[1], q[2]);
      life.push({ geometry: g, color: 0x4c2413 });
    };
    blob(0.075, 0, 0.026); blob(0.015, 0, 0.022); blob(-0.075, 0, 0.038);
    life.push({ geometry: rod(P(0.075, 0), P(-0.075, 0), 0.008, 5, 0), color: 0x3a1a0d });
    for (const off of [-1, 1]) {
      for (const q of [0.04, 0.012, -0.02]) {
        const hip = P(q, off * 0.012, 0.004);
        const knee = P(q + q * 0.5, off * 0.055, 0.012);
        const foot = P(q + q * 1.3 - 0.01, off * 0.095, 0);
        life.push({ geometry: tube([hip, knee, foot], [0.006, 0.005, 0.003], { sides: 4, steps: 4, round: 0 }), color: 0x2f1409 });
      }
      life.push({ geometry: tube([P(0.095, off * 0.01, 0.006), P(0.135, off * 0.03, 0.012), P(0.15, off * 0.012, 0.008)], [0.004, 0.003, 0.002], { sides: 4, steps: 4, round: 0 }), color: 0x2f1409 });
    }
  };
  ant(2.33, 8.3, -1.2); ant(2.42, 7.95, -1.75); ant(2.1, 7.45, -2.4); ant(2.52, 7.3, -1.4); ant(2.34, 6.62, -2.2); ant(2.1, 6.5, 0.4);

  // The beetle, walking across the topsoil on a little chamber of its own. Much enlarged too.
  const bx = -1.32; const by = 8.02;
  const bug = (geo, x, y, z, color) => { geo.translate(x, y, z); life.push({ geometry: geo, color }); };
  const elytra = new THREE.SphereGeometry(0.1, 18, 12); elytra.scale(1.0, 1.55, 0.72);
  tintVertices(elytra, (x, y, z, o) => {
    const seam = Math.abs(x) < 0.006;
    const stripe = 0.82 + 0.26 * Math.abs(Math.sin(x * 62));
    const c = seam ? [0.01, 0.01, 0.02] : lin(0x1d4f3a);
    const sheen = 0.9 + clamp01(z / 0.07) * 0.5;
    o[0] = c[0] * stripe * sheen; o[1] = c[1] * stripe * sheen; o[2] = c[2] * stripe * sheen;
  });
  elytra.translate(bx, by - 0.04, fz + 0.03);
  life.push({ geometry: elytra, keepColor: true });
  const pron = new THREE.SphereGeometry(0.075, 14, 10); pron.scale(1.05, 0.72, 0.72); bug(pron, bx, by + 0.14, fz + 0.03, 0x173c2d);
  const headB = new THREE.SphereGeometry(0.045, 12, 8); headB.scale(1, 0.85, 0.72); bug(headB, bx, by + 0.215, fz + 0.03, 0x142a22);
  for (const off of [-1, 1]) {
    for (const [ly, reach, foot] of [[0.14, 0.15, 0.2], [0.02, 0.17, 0.0], [-0.1, 0.17, -0.2]]) {
      life.push({ geometry: tube([[bx + off * 0.05, by + ly, fz + 0.03], [bx + off * reach, by + ly + (foot - ly) * 0.25, fz + 0.045], [bx + off * (reach + 0.1), by + foot, fz + 0.006]], [0.012, 0.009, 0.004], { sides: 5, steps: 6, round: 1 }), color: 0x101412 });
    }
    life.push({ geometry: tube([[bx + off * 0.025, by + 0.245, fz + 0.04], [bx + off * 0.09, by + 0.32, fz + 0.03], [bx + off * 0.12, by + 0.4, fz + 0.01]], [0.006, 0.005, 0.003], { sides: 4, steps: 6, round: 0 }), color: 0x101412 });
  }

  // A few real stones, standing out of the face where the rock is breaking up.
  const proud = stones.filter((st) => st.h >= 2 && st.size > (st.h === 3 ? 0.24 : 0.11) && Math.abs(st.x) + st.size < 3.82 && !(st.x - st.size < -2.2));
  for (let i = 0; i < proud.length; i += 2) {
    const st = proud[i];
    const g = grainy(new THREE.IcosahedronGeometry(st.size * 0.8, 2), 40 + i, 0.2);
    g.scale(1.1, 0.8, 0.5);
    g.translate(st.x, st.y, fz + st.size * 0.06);
    const v = st.tone;
    const col = new THREE.Color().setRGB((130 + v * 40) / 255, (120 + v * 34) / 255, (104 + v * 30) / 255, THREE.SRGBColorSpace);
    life.push({ geometry: g, color: col.getHex() });
  }

  // The mole, half out of its run: a velvet barrel, a pointed snout, a pink nose, and the huge spade
  // forepaws that are the whole animal. Sculpted, so nothing on it can float.
  const mx = -2.1; const my = 6.86; const mz = fz + 0.1;
  const fur = lin(0x3e3a3f); const pink = lin(0xd98f83);
  const sc = new Sculpt(0.024);
  sc.add(ellipsoidP([mx, my, mz], [0.32, 0.17, 0.17]), fur);
  sc.add(ellipsoidP([mx + 0.31, my - 0.012, mz], [0.14, 0.085, 0.09]), fur, { k: 0.08 });
  sc.add(ellipsoidP([mx + 0.42, my - 0.018, mz], [0.05, 0.034, 0.036]), pink, { k: 0.02 });
  for (const side2 of [-1, 1]) {
    const shoulder = [mx + 0.18, my - 0.08, mz + side2 * 0.1];
    const palm = [mx + 0.3, my - 0.15, mz + side2 * 0.17];
    sc.add(curveP([shoulder, palm], [0.05, 0.05], 4), fur, { k: 0.05 });
    sc.add(ellipsoidP(palm, [0.09, 0.024, 0.075], [0.2, 0, side2 * 0.25]), pink, { k: 0.012 });
    for (let f = 0; f < 5; f++) {
      const a = (f - 2) * 0.32;
      const claw = [palm[0] + Math.cos(a) * 0.12, palm[1] - 0.012, palm[2] + Math.sin(a) * 0.095];
      sc.add(curveP([palm, claw], [0.02, 0.008], 3), lin(0xe7dcc5), { k: 0.008 });
    }
  }
  sc.add(curveP([[mx - 0.28, my + 0.02, mz], [mx - 0.42, my + 0.05, mz]], [0.022, 0.01], 3), pink, { k: 0.02 });
  sc.sub(boxP([mx, my, fz - 0.3], [1.2, 1.2, 0.25]));
  const moleG = polygonize(sc, { bounds: [mx - 0.6, my - 0.34, fz - 0.05, mx + 0.6, my + 0.26, mz + 0.26] });
  life.push({ geometry: moleG, keepColor: true });

  root.add(mesh(mergeParts(life), standard({ vertexColors: true, roughness: 0.72, metalness: 0.04 })));

  // The plates, one to a horizon, each at its own horizon's middle at the plate's own x.
  const PW = 720; const PH = 120;
  const plateMap = canvasTexture(PW, PH * 5, (ctx) => {
    SOIL.NAMES.forEach(([letter, name], i) => {
      const y = i * PH;
      ctx.fillStyle = '#f0e8d0'; ctx.fillRect(0, y, PW, PH);
      ctx.fillStyle = '#23201a'; ctx.fillRect(0, y, PH, PH);
      ctx.fillStyle = '#f7efd8';
      ctx.font = `800 ${PH * 0.74}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(letter, PH / 2, y + PH * 0.54);
      ctx.fillStyle = '#1b1812';
      fitFont(ctx, name, PW - PH - 28, PH * 0.42, '700');
      ctx.textAlign = 'left';
      ctx.fillText(name, PH + 14, y + PH * 0.54);
      ctx.strokeStyle = '#4e4633'; ctx.lineWidth = 3; ctx.strokeRect(1.5, y + 1.5, PW - 3, PH - 3);
    });
  });
  const PLATE_X = -3.02; const PLATE_W = 1.8; const PLATE_H = 0.3;
  const plates = SOIL.NAMES.map((_, i) => {
    const hi = i === 0 ? soilGround(PLATE_X, FACE) : SOIL_BOUNDS[i](PLATE_X, FACE);
    const lo = i === 4 ? BASE : SOIL_BOUNDS[i + 1](PLATE_X, FACE);
    const y = (hi + lo) / 2;
    if (soilHorizon(PLATE_X, y, FACE) !== i) throw new Error(`soil: plate ${SOIL.NAMES[i][0]} is not on its horizon`);
    if (y + PLATE_H / 2 > hi || y - PLATE_H / 2 < lo) throw new Error(`soil: plate ${SOIL.NAMES[i][0]} is wider than its horizon`);
    const g = printedPlate(PLATE_W, PLATE_H, 0.05, uvRect(PW, PH * 5, 0, i * PH, PW, PH));
    g.translate(PLATE_X, y, FACE + 0.035);
    return { geometry: g, keepColor: true };
  });
  root.add(mesh(mergeParts(plates), standard({ map: plateMap, roughness: 0.7, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Shared by the blocks below
// ---------------------------------------------------------------------------------------------

// Lays out plates of known size in feet on one canvas, each with its own type, at one resolution.
function plateAtlas(entries, ppf = 190, W = 1024, styleOf = () => ({})) {
  let x = 0; let y = 0; let rowH = 0;
  const cells = entries.map((e) => {
    const w = Math.min(W, Math.round(e.w * ppf)); const h = Math.round(e.h * ppf);
    if (x + w > W) { x = 0; y += rowH + 2; rowH = 0; }
    const cell = [x, y, w, h];
    x += w + 2; rowH = Math.max(rowH, h);
    return cell;
  });
  const H = y + rowH;
  const map = canvasTexture(W, H, (ctx) => {
    entries.forEach((e, i) => {
      const [a, b, c, d] = cells[i];
      if (e.draw) e.draw(ctx, a, b, c, d);
      else plateCell(ctx, a, b, c, d, e.lines, styleOf(e));
    });
  });
  return { map, uv: (i) => uvRect(W, H, ...cells[i]) };
}

// A signed distance to a closed polygon in the plane: negative inside. Inigo Quilez's form.
function polygonSDF(pts) {
  const n = pts.length;
  return (x, y) => {
    let d = (x - pts[0][0]) ** 2 + (y - pts[0][1]) ** 2;
    let s = 1;
    for (let i = 0, j = n - 1; i < n; j = i, i++) {
      const ex = pts[j][0] - pts[i][0]; const ey = pts[j][1] - pts[i][1];
      const wx = x - pts[i][0]; const wy = y - pts[i][1];
      const t = clamp01((wx * ex + wy * ey) / (ex * ex + ey * ey));
      const bx = wx - ex * t; const by = wy - ey * t;
      d = Math.min(d, bx * bx + by * by);
      const c1 = y >= pts[i][1]; const c2 = y < pts[j][1]; const c3 = ex * wy > ey * wx;
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
    }
    return s * Math.sqrt(d);
  };
}

// A closed block with its faces in atlas coordinates. uv functions give each face's own mapping.
function cutBlockInto(pos, uvs, { x0, x1, z0, z1, y0, top, uv, NX = 60, NZ = 24 }) {
  const quad = (a, b, c, d) => { for (const v of [a, b, c, a, c, d]) { pos.push(v[0], v[1], v[2]); uvs.push(v[3], v[4]); } };
  for (let i = 0; i < NX; i++) {
    const a = mix(x0, x1, i / NX); const b = mix(x0, x1, (i + 1) / NX);
    const ya = top(a, z1); const yb = top(b, z1);
    quad([a, y0, z1, ...uv.front(a, y0)], [b, y0, z1, ...uv.front(b, y0)], [b, yb, z1, ...uv.front(b, yb)], [a, ya, z1, ...uv.front(a, ya)]);
    const ba = top(a, z0); const bb = top(b, z0);
    quad([b, y0, z0, ...uv.back(b, y0)], [a, y0, z0, ...uv.back(a, y0)], [a, ba, z0, ...uv.back(a, ba)], [b, bb, z0, ...uv.back(b, bb)]);
  }
  for (let j = 0; j < NZ; j++) {
    const a = mix(z0, z1, j / NZ); const b = mix(z0, z1, (j + 1) / NZ);
    const ra = top(x1, a); const rb = top(x1, b);
    quad([x1, y0, b, ...uv.right(b, y0)], [x1, y0, a, ...uv.right(a, y0)], [x1, ra, a, ...uv.right(a, ra)], [x1, rb, b, ...uv.right(b, rb)]);
    const la = top(x0, a); const lb = top(x0, b);
    quad([x0, y0, a, ...uv.left(a, y0)], [x0, y0, b, ...uv.left(b, y0)], [x0, lb, b, ...uv.left(b, lb)], [x0, la, a, ...uv.left(a, la)]);
  }
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NZ; j++) {
      const a = mix(x0, x1, i / NX); const b = mix(x0, x1, (i + 1) / NX);
      const c = mix(z0, z1, j / NZ); const d = mix(z0, z1, (j + 1) / NZ);
      const v = (x, z) => [x, top(x, z), z, ...uv.top(x, z)];
      quad(v(a, d), v(b, d), v(b, c), v(a, c));
    }
  }
  const q = uv.top((x0 + x1) / 2, (z0 + z1) / 2);
  quad([x0, y0, z0, ...q], [x1, y0, z0, ...q], [x1, y0, z1, ...q], [x0, y0, z1, ...q]);
}

// ===========================================================================================
// OCEAN ZONES
// ===========================================================================================
//
// Five zones at EQUAL heights, because at true scale the sunlit zone would be a third of an inch on a
// column this size. The boundaries are the conventional figures, and the plates and the ruler are
// written from this one table.
export const OCEAN = {
  HX: 4, HZ: 1.6, FACE: 1.6, Y0: 0.5, YTOP: 17.6,
  ZONES: [
    { name: 'SUNLIGHT ZONE', from: 0, to: 650 },
    { name: 'TWILIGHT ZONE', from: 650, to: 3300 },
    { name: 'MIDNIGHT ZONE', from: 3300, to: 13000 },
    { name: 'ABYSS', from: 13000, to: 20000 },
    { name: 'TRENCH', from: 20000, to: 36000 },
  ],
};
OCEAN.ZH = (OCEAN.YTOP - OCEAN.Y0) / OCEAN.ZONES.length;
const fmtFt = (v) => `${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ft`;
export const zoneRange = (z) => (z.from >= 20000 ? `below ${fmtFt(z.from)}` : `${String(z.from).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}-${fmtFt(z.to)}`);
export const zoneTop = (i) => OCEAN.YTOP - i * OCEAN.ZH;

// The water's edge against the rock on each side, as x for a given y, lowest first.
const OCEAN_R = [[0.62, 0], [0.72, 0.42], [1.1, 0.62], [2.0, 0.78], [3.0, 0.92], [3.8, 1.02], [4.02, 1.2], [4.12, 1.7], [4.22, 2.4], [4.55, 2.95], [5.6, 3.05], [7.2, 3.2], [8.6, 3.3], [10.2, 3.5], [11.4, 3.75], [12.8, 4.02]];
const OCEAN_L = [[0.62, 0], [0.75, -0.5], [1.4, -0.7], [2.4, -0.85], [3.3, -1.0], [3.85, -1.15], [4.1, -1.5], [4.2, -2.2], [4.3, -2.8], [5.2, -3.0], [7, -3.25], [9, -3.5], [11, -3.8], [12.2, -4.02]];
function tableAt(t, y) {
  if (y <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (y <= t[i][0]) return mix(t[i - 1][1], t[i][1], (y - t[i - 1][0]) / (t[i][0] - t[i - 1][0]));
  return t[t.length - 1][1];
}
const oceanRock = polygonSDF([
  ...[...OCEAN_R].reverse().map(([y, x]) => [x, y]),
  ...OCEAN_L.slice(1).map(([y, x]) => [x, y]),
  [-4.02, 0.4], [4.02, 0.4],
]);
// The height of the sea floor under x, found by asking where the rock begins.
function oceanFloorY(x) {
  for (let y = 6; y > 0.5; y -= 0.01) if (oceanRock(x, y) < 0) return y;
  return 0.5;
}
const oceanWave = (x, z) => 0.075 * Math.sin(x * 3.1 + z * 1.6) + 0.04 * Math.sin(x * 5.7 - z * 3.2 + 1) + 0.022 * Math.sin(x * 9.3 + z * 6.1 + 2);
const oceanTopY = (x, z) => OCEAN.YTOP + oceanWave(x, z);

// One smooth darkening from bright blue to black, with the stops on the zone boundaries.
const OCEAN_STOPS = [[0x2c, 0xa8, 0xea], [0x0e, 0x66, 0xae], [0x0a, 0x25, 0x56], [0x05, 0x0e, 0x26], [0x02, 0x05, 0x0f], [0, 0, 0]];
export function oceanWater(y, out) {
  const u = clamp01((OCEAN.YTOP - y) / (OCEAN.YTOP - OCEAN.Y0)) * 5;
  const i = Math.min(4, Math.floor(u));
  const f = u - i;
  // A Catmull-Rom through the stops, so no boundary shows as a change of slope, clamped to its span.
  const P = (k) => OCEAN_STOPS[Math.max(0, Math.min(5, k))];
  for (let c = 0; c < 3; c++) {
    const p0 = P(i - 1)[c]; const p1 = P(i)[c]; const p2 = P(i + 1)[c]; const p3 = P(i + 2)[c];
    const v = 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
    out[c] = Math.max(Math.min(p1, p2), Math.min(Math.max(p1, p2), v));
  }
  return out;
}

const OCEAN_LURE = [0.55, 9.75];

function paintOcean(ctx, R) {
  const { HX, HZ, YTOP, Y0 } = OCEAN;
  const noise = latticeNoise(61);
  const rng = seededRandom(909);
  const c = [0, 0, 0];
  const tmp = [0, 0, 0];
  const rock = (x, y, out) => {
    const k = noise(x * 2.1 + 8, y * 2.1) * 0.6 + noise(x * 9, y * 9) * 0.4;
    const v = 42 + k * 44;
    out[0] = v; out[1] = v * 0.96; out[2] = v * 0.92;
  };
  const shade = (x, y, atFace, out, nx = x) => {
    oceanWater(y, c);
    const xl = tableAt(OCEAN_L, y); const xr = tableAt(OCEAN_R, y);
    if (y < OCEAN_R[OCEAN_R.length - 1][0] + 0.01 && (x < xl || x > xr) && y > Y0 - 0.01 || y < 0.62) { rock(nx, y, tmp); out[0] = tmp[0]; out[1] = tmp[1]; out[2] = tmp[2]; return; }
    // Soft shafts of light from above, which fade out where the light does.
    const ray = Math.max(0, Math.sin((x + (YTOP - y) * 0.22) * 1.9 + 0.8)) ** 3;
    const fade = sstep(y, 12.2, 17.2);
    const lift = atFace ? ray * fade * 46 : 0;
    const dither = (noise(x * 41, y * 41) - 0.5) * 2.2;
    out[0] = c[0] + lift * 0.55 + dither; out[1] = c[1] + lift * 0.85 + dither; out[2] = c[2] + lift + dither;
    if (atFace) {
      // The glow of the anglerfish's lure, on the water round it.
      const d = Math.hypot(x - OCEAN_LURE[0], y - OCEAN_LURE[1]);
      const g = Math.exp(-d * d * 3.2) * 52;
      out[0] += g * 0.25; out[1] += g * 0.85; out[2] += g * 0.8;
    }
  };
  // Front.
  const f = R.front;
  paintTexels(ctx, f.x, f.y, f.w, f.h, (i, j, out) => {
    const x = -HX + ((i + 0.5) / f.w) * 2 * HX;
    const y = (1 - (j + 0.5) / f.h) * OCEAN.ROWTOP;
    shade(x, y, true, out);
  });
  const P = f.w / (2 * HX);
  const X = (x) => f.x + (x + HX) * P;
  const Y = (y) => f.y + (OCEAN.ROWTOP - y) * P;
  // Marine snow, thicker where there is more to rot, drifting down through all of it.
  for (let i = 0; i < 620; i++) {
    const x = mix(-HX, HX, rng()); const y = mix(Y0, YTOP, rng());
    if (x < tableAt(OCEAN_L, y) || x > tableAt(OCEAN_R, y)) continue;
    const a = 0.24 + rng() * 0.34;
    ctx.fillStyle = `rgba(214,226,232,${a.toFixed(2)})`;
    ctx.beginPath(); ctx.arc(X(x), Y(y), 0.5 + rng() * 0.8, 0, TAU); ctx.fill();
  }
  // The boundaries, as a fine dashed line right across the water.
  ctx.strokeStyle = 'rgba(232,240,246,0.55)';
  ctx.lineWidth = 1.4;
  for (let z = 1; z < 5; z++) {
    const y = zoneTop(z);
    const xl = tableAt(OCEAN_L, y); const xr = tableAt(OCEAN_R, y);
    for (let x = xl; x < xr; x += 0.3) {
      ctx.beginPath(); ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(Math.min(xr, x + 0.17)), Y(y)); ctx.stroke();
    }
  }
  // The back and the sides.
  const side = (r, posAt) => {
    paintTexels(ctx, r.x, r.y, r.w, r.h, (i, j, out) => {
      const u = (i + 0.5) / r.w;
      const x = posAt(u);
      const y = (1 - (j + 0.5) / r.h) * OCEAN.ROWTOP;
      shade(x, y, false, out, x + u * 3.2);
    });
  };
  side(R.back, (u) => HX - u * 2 * HX);
  side(R.right, () => HX);
  side(R.left, () => -HX);
  // The sea from above: blue, with the crests going to foam.
  const t = R.top;
  paintTexels(ctx, t.x, t.y, t.w, t.h, (i, j, out) => {
    const x = -HX + ((i + 0.5) / t.w) * 2 * HX;
    const z = -HZ + ((j + 0.5) / t.h) * 2 * HZ;
    const w = oceanWave(x, z);
    const n = noise(i / 6, j / 6);
    const foam = sstep(w + (n - 0.5) * 0.09, 0.075, 0.13);
    out[0] = mix(34 + w * 140, 226, foam); out[1] = mix(136 + w * 220, 240, foam); out[2] = mix(198 + w * 180, 245, foam);
  });
}

// A fin: a closed lens-edged plate along a curved spine, with a width at each spine point. N is the
// plate's facing. Its root is simply buried in the body, so it can never come adrift, and a thin
// edge costs nothing, where a sculpt would need a cell as fine as the fin is thick.
function fin(points, widths, N, thick = 0.04, steps = 12) {
  const c = new THREE.CatmullRomCurve3(points.map((q) => new THREE.Vector3(q[0], q[1], q[2])), false, 'catmullrom', 0.5);
  const n = new THREE.Vector3(N[0], N[1], N[2]).normalize();
  const m = widths.length - 1;
  const widthAt = (t) => {
    const u = t * m; const i = Math.min(m - 1, Math.floor(u));
    return mix(widths[i], widths[i + 1], u - i);
  };
  const at = (i, j, lift) => {
    const t = i / steps;
    const p = c.getPoint(t);
    const T = c.getTangent(t);
    const side = new THREE.Vector3().crossVectors(n, T).normalize();
    const w = widthAt(t);
    const v = j / 2 - 0.5;
    const edge = 1 - 4 * v * v; // zero at both edges, so the rim is thin
    const q = p.clone().addScaledVector(side, v * w).addScaledVector(n, lift * (0.25 + 0.75 * edge) * (0.3 + 0.7 * (1 - t)));
    return [q.x, q.y, q.z];
  };
  return gridSolid(steps, 2, (i, j) => at(i, j, thick / 2), (i, j) => at(i, j, -thick / 2), { crease: 60 });
}

function buildOceanZones() {
  const { HX, HZ, FACE, Y0, YTOP, ZONES, ZH } = OCEAN;
  OCEAN.ROWTOP = 18;
  // What is printed has to be what is true.
  if (ZONES.length !== 5) throw new Error('ocean: five zones');
  for (let i = 1; i < 5; i++) if (ZONES[i].from !== ZONES[i - 1].to) throw new Error('ocean: zones must meet');
  if (Math.abs(ZH * 5 - (YTOP - Y0)) > 1e-9) throw new Error('ocean: zones must be equal heights');
  if (zoneRange(ZONES[0]) !== '0-650 ft' || zoneRange(ZONES[1]) !== '650-3,300 ft' || zoneRange(ZONES[2]) !== '3,300-13,000 ft' || zoneRange(ZONES[3]) !== '13,000-20,000 ft' || zoneRange(ZONES[4]) !== 'below 20,000 ft') throw new Error('ocean: a zone is misprinted');
  const lum = [0, 0, 0];
  let last = 1e9;
  for (let y = YTOP; y >= Y0; y -= 0.05) {
    oceanWater(y, lum);
    const L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
    if (L > last + 1e-6) throw new Error('ocean: the water must only get darker going down');
    last = L;
  }

  const root = new THREE.Group();

  // THE COLUMN --------------------------------------------------------------------------
  const FW = 576; const AW = 832; const AH = 1296;
  const RT = 18;
  const R = {
    front: { x: 0, y: 0, w: FW, h: AH },
    back: { x: FW, y: 0, w: 256, h: 648 },
    right: { x: FW, y: 648, w: 64, h: 648 },
    left: { x: FW + 64, y: 648, w: 64, h: 648 },
    top: { x: FW + 128, y: 648, w: 128, h: 104 },
  };
  OCEAN.ROWTOP = RT;
  const map = canvasTexture(AW, AH, (ctx) => paintOcean(ctx, R));
  const uvR = (r, u, v) => [(r.x + u * r.w) / AW, 1 - (r.y + (1 - v) * r.h) / AH];
  const pos = []; const uvs = [];
  cutBlockInto(pos, uvs, {
    x0: -HX, x1: HX, z0: -HZ, z1: HZ, y0: Y0 - 0.02, top: oceanTopY, NX: 72, NZ: 20,
    uv: {
      front: (x, y) => uvR(R.front, (x + HX) / (2 * HX), y / RT),
      back: (x, y) => uvR(R.back, (HX - x) / (2 * HX), y / RT),
      right: (z, y) => uvR(R.right, (HZ - z) / (2 * HZ), y / RT),
      left: (z, y) => uvR(R.left, (z + HZ) / (2 * HZ), y / RT),
      top: (x, z) => uvR(R.top, (x + HX) / (2 * HX), 1 - (z + HZ) / (2 * HZ)),
    },
  });
  const column = mesh(soup(pos, uvs, 40), standard({ map, roughness: 0.82, metalness: 0 }));
  // Open water takes no shadow: a fish-shaped dark patch on it would read as a second, darker fish.
  column.receiveShadow = false;
  root.add(column);

  // THE ROCK, proud of the cut, so the sea floor is a real ledge an animal can stand on -----
  const ripple = (x, y) => Math.sin(x * 3.3 + y * 1.4) * Math.sin(y * 2.9 - x * 1.1) * 0.09 + Math.sin(x * 7.1 - y * 5.3) * Math.sin(y * 6.7 + x * 4.3) * 0.04;
  const PROUD = 0.92;
  const rockPrim = {
    box: [-4.02, Y0 - 0.1, FACE - 0.14, 4.02, 12.9, FACE + PROUD + 0.22],
    f: (x, y, z) => {
      const d0 = oceanRock(x, y);
      const d = d0 + ripple(x, y) * sstep(y, 0.7, 3.5) * 1 + 0.015;
      const inside = -d;
      const front = FACE + 0.1 + PROUD * sstep(inside, 0, 0.36) + ripple(y * 1.3, x * 1.3) * 1.6 + 0.09 * Math.sin(x * 2.2 + y * 1.9);
      return Math.max(d, z - front, FACE - 0.12 - z, Math.abs(x) - 4.015, Y0 - 0.04 - y);
    },
  };
  const rc = new Sculpt(0.15);
  rc.add(rockPrim, 0x57544f);
  const rockTone = latticeNoise(14);
  const rockGeo = polygonize(rc, {
    uvScale: 1.3,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const k = rockTone(x * 2.5 + 3, y * 2.5 + z) * 0.55 + rockTone(x * 8, y * 8 + z * 4) * 0.45;
      // Pale ooze settles on whatever faces up. Bare dark rock everywhere else.
      const ooze = sstep(ny, 0.6, 0.9) * (0.45 + 0.55 * (1 - sstep(y, 4.6, 6)));
      const r = mix(0.05, 0.135, k); const g = mix(0.046, 0.12, k); const b = mix(0.044, 0.105, k);
      rgb[0] = mix(r, 0.46, ooze * 0.85); rgb[1] = mix(g, 0.42, ooze * 0.85); rgb[2] = mix(b, 0.33, ooze * 0.85);
    },
  });
  const rockBump = wrapRepeat(dataTexture(canvasTexture(256, 256, (ctx, w, h) => {
    const n = latticeNoise(55);
    paintTexels(ctx, 0, 0, w, h, (x, y, out) => {
      const v = 128 + (n(x / 16, y / 16) - 0.5) * 120 + (n(x / 4, y / 4) - 0.5) * 80;
      out[0] = v; out[1] = v; out[2] = v;
    });
  })));
  root.add(mesh(rockGeo, standard({ vertexColors: true, bumpMap: rockBump, bumpScale: 1.4, roughness: 0.96, metalness: 0 })));

  // THE ANIMALS, each sunk a little into the cut so it is not hanging in the air --------------
  const life = [];
  const glow = [];
  const rng = seededRandom(3303);

  // PLANKTON, much enlarged: green diatoms that make food from sunlight and copepods that eat them.
  const plankPos = [];
  for (let t = 0; t < 400 && plankPos.length < 42; t++) {
    const x = mix(-3.85, 3.85, rng()); const y = mix(zoneTop(1) + 0.3, YTOP - 0.25, rng());
    if (x < -0.5 && x > -3 && y > zoneTop(0) - 1.05) continue;
    if (plankPos.some((q) => Math.hypot(q[0] - x, q[1] - y) < 0.36)) continue;
    if (Math.hypot(x - 1.25, (y - 15.95) * 1.9) < 1.5) continue;
    plankPos.push([x, y]);
  }
  plankPos.forEach(([x, y], i) => {
    const z = FACE + 0.015;
    if (i % 3 === 2) {
      // A copepod: a teardrop body, a pair of long feelers.
      const a = rng() * TAU;
      const c = Math.cos(a); const s = Math.sin(a);
      const P = (u, v) => [x + u * c - v * s, y + u * s + v * c, z + 0.03];
      life.push({ geometry: tube([P(-0.12, 0), P(-0.02, 0), P(0.07, 0)], [0.008, 0.032, 0.026], { sides: 6, steps: 4, round: 1 }), color: 0xe8c07e });
      for (const o of [-1, 1]) life.push({ geometry: tube([P(0.07, o * 0.012), P(0.1, o * 0.08), P(0.04, o * 0.17)], [0.007, 0.005, 0.002], { sides: 3, steps: 3, round: 0 }), color: 0xe8c07e });
    } else {
      // A diatom: a little glass-ribbed disc in green-gold.
      const r = 0.05 + rng() * 0.04;
      const g = lathe([[0, -0.012], [r, -0.012], [r * 1.05, 0], [r, 0.012], [r * 0.5, 0.022], [0, 0.026]], 12);
      g.rotateX(Math.PI / 2 + (rng() - 0.5) * 0.7);
      g.rotateZ(rng() * 3);
      g.translate(x, y, z + 0.01);
      life.push({ geometry: g, color: i % 2 ? 0x7cc85c : 0xb7d258 });
    }
  });

  // DOLPHIN. Sculpted: spindle, melon, beak, the three fins and the flukes.
  {
    const cx = 1.25; const cy = 15.95; const cz = FACE + 0.27;
    const s = new Sculpt(0.05);
    const G = lin(0x6f818f);
    const spine = [[-1.28, -0.16], [-0.95, -0.03], [-0.5, 0.06], [0, 0.1], [0.5, 0.09], [0.82, 0.03], [1.0, 0.0]];
    const radii = [0.05, 0.09, 0.2, 0.29, 0.26, 0.16, 0.1];
    const P3 = spine.map(([a, b]) => [cx + a, cy + b, cz]);
    s.add(curveP(P3, radii, 72), G);
    s.add(curveP([[cx + 0.98, cy, cz], [cx + 1.3, cy - 0.06, cz]], [0.075, 0.042], 5), G, { k: 0.05 });
    s.add(ellipsoidP([cx + 0.86, cy + 0.08, cz], [0.14, 0.11, 0.1]), G, { k: 0.09 });
    // Dorsal, flipper and flukes.
    life.push({ geometry: fin([[cx + 0.06, cy + 0.3, cz], [cx - 0.1, cy + 0.46, cz], [cx - 0.26, cy + 0.68, cz]], [0.42, 0.24, 0.02], [0, 0, 1], 0.06), color: 0x66788a });
    life.push({ geometry: fin([[cx + 0.36, cy - 0.12, cz + 0.2], [cx + 0.28, cy - 0.32, cz + 0.28], [cx + 0.08, cy - 0.48, cz + 0.3]], [0.2, 0.17, 0.02], [0.25, 0.1, 1], 0.045), color: 0x66788a });
    for (const o of [-1, 1]) life.push({ geometry: fin([[cx - 1.22, cy - 0.15, cz], [cx - 1.36, cy - 0.16, cz + o * 0.16], [cx - 1.5, cy - 0.12, cz + o * 0.36]], [0.2, 0.24, 0.02], [0.05, 1, o * 0.16], 0.04), color: 0x66788a });
    const bird = lin(0xe6e8e4); const mid = G;
    const g = polygonize(s, {
      tint: (x, y, z, nx, ny, nz, rgb) => {
        const a = x - cx;
        // The belly's pale line runs below the mid-line, lifting a little toward the face.
        const line = cy - 0.08 - 0.05 * Math.sin(a * 2.1 + 0.5) + (a > 0.8 ? 0.03 : 0);
        const t = sstep(y, line + 0.02, line - 0.05) * sstep(a, -1.05, -0.7);
        rgb[0] = mix(mid[0], bird[0], t); rgb[1] = mix(mid[1], bird[1], t); rgb[2] = mix(mid[2], bird[2], t);
        if (a > 1.0 && Math.abs(y - (cy - 0.035 - (a - 1) * 0.16)) < 0.008) { rgb[0] *= 0.35; rgb[1] *= 0.35; rgb[2] *= 0.35; }
      },
    });
    life.push({ geometry: g, keepColor: true });
    const eye = new THREE.SphereGeometry(0.024, 10, 8);
    eye.translate(cx + 0.82, cy + 0.015, cz + 0.145);
    life.push({ geometry: eye, color: 0x0f1012 });
  }

  // SWORDFISH, in the twilight, where it hunts by day. The bill, the tall sickle fin, the crescent tail.
  {
    const cx = 1.15; const cy = 12.45; const cz = FACE + 0.27;
    const s = new Sculpt(0.05);
    const B = lin(0x2c3f63);
    const BH = 0x2c3f63;
    // Heading -X.
    const ax = [[1.42, 0.02], [1.05, 0.0], [0.5, 0.02], [0, 0.03], [-0.55, 0.02], [-0.9, -0.01]];
    s.add(curveP(ax.map(([a, b]) => [cx + a, cy + b, cz]), [0.05, 0.09, 0.2, 0.27, 0.22, 0.12], 72), B);
    // The bill: long, tapering and flattened, a third of the fish.
    life.push({
      geometry: tube([[cx - 0.72, cy, cz], [cx - 1.1, cy + 0.015, cz], [cx - 1.55, cy + 0.04, cz], [cx - 2.08, cy + 0.075, cz]], [0.1, 0.05, 0.028, 0.002], {
        sides: 8, steps: 12, round: 0, frame: () => [0, 0, 1], section: () => [1.0, 0.72],
      }),
      color: 0x24344f,
    });
    // First dorsal: a tall sickle, swept back. Anal and pectoral fins, and the crescent tail.
    life.push({ geometry: fin([[cx - 0.22, cy + 0.2, cz], [cx - 0.17, cy + 0.5, cz], [cx + 0.0, cy + 0.82, cz], [cx + 0.22, cy + 1.02, cz]], [0.5, 0.3, 0.16, 0.02], [0, 0, 1], 0.05), color: BH });
    life.push({ geometry: fin([[cx + 0.42, cy - 0.12, cz], [cx + 0.52, cy - 0.34, cz], [cx + 0.72, cy - 0.5, cz]], [0.26, 0.15, 0.02], [0, 0, 1], 0.04), color: BH });
    life.push({ geometry: fin([[cx - 0.46, cy - 0.1, cz + 0.17], [cx - 0.26, cy - 0.38, cz + 0.22], [cx + 0.1, cy - 0.62, cz + 0.22]], [0.2, 0.15, 0.02], [0.2, 0.15, 1], 0.04), color: 0x5d6d85 });
    for (const o of [-1, 1]) life.push({ geometry: fin([[cx + 1.33, cy + 0.02, cz], [cx + 1.56, cy + o * 0.3, cz], [cx + 1.92, cy + o * 0.72, cz]], [0.2, 0.17, 0.02], [0, 0, 1], 0.04), color: BH });
    const belly = lin(0xc3cad0);
    const g = polygonize(s, {
      tint: (x, y, z, nx, ny, nz, rgb) => {
        const a = x - cx;
        const t = sstep(y, cy + 0.02, cy - 0.1) * (a > -0.95 && a < 1.15 && y < cy + 0.08 ? 1 : 0);
        rgb[0] = mix(rgb[0], belly[0], t); rgb[1] = mix(rgb[1], belly[1], t); rgb[2] = mix(rgb[2], belly[2], t);
      },
    });
    life.push({ geometry: g, keepColor: true });
    const eye = new THREE.SphereGeometry(0.052, 12, 10);
    tintVertices(eye, (x, y, z, o) => { const c = Math.hypot(x, y) < 0.022 ? lin(0x06070a) : lin(0xdcdfd8); o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; });
    eye.translate(cx - 0.72, cy + 0.03, cz + 0.135);
    life.push({ geometry: eye, keepColor: true });
  }

  // ANGLERFISH. A big head that is mostly mouth, needle teeth, a stalk with a lure. Facing -X, to the
  // left, with the lure held out in front of the mouth, which is the point of it.
  {
    const cx = 1.5; const cy = 8.96; const cz = FACE + 0.5;
    const s = new Sculpt(0.055);
    const B = lin(0x6b4a3a);
    s.add(ellipsoidP([cx, cy, cz], [0.72, 0.6, 0.5]), B);
    s.add(curveP([[cx + 0.5, cy + 0.02, cz], [cx + 0.92, cy + 0.08, cz], [cx + 1.16, cy + 0.12, cz]], [0.3, 0.12, 0.06], 8), B, { k: 0.12 });
    // Tail fan and a fin on the flank.
    for (const o of [-0.28, 0, 0.28]) life.push({ geometry: fin([[cx + 1.08, cy + 0.11, cz], [cx + 1.3, cy + 0.14 + o * 0.6, cz], [cx + 1.48, cy + 0.16 + o * 1.25, cz]], [0.13, 0.2, 0.1], [0, 0, 1], 0.03), color: 0x7b5a44 });
    life.push({ geometry: fin([[cx + 0.2, cy - 0.06, cz + 0.42], [cx + 0.4, cy - 0.15, cz + 0.52], [cx + 0.6, cy - 0.3, cz + 0.52]], [0.15, 0.26, 0.05], [0.1, 0.25, 1], 0.03), color: 0x7b5a44 });
    // The lower jaw jutting forward, and the mouth cut between them.
    s.add(ellipsoidP([cx - 0.52, cy - 0.26, cz], [0.46, 0.2, 0.38], [0, 0, 0.2]), B, { k: 0.1 });
    const dark = lin(0x1a0a0c);
    s.sub(ellipsoidP([cx - 0.68, cy - 0.11, cz], [0.5, 0.17, 0.42], [0, 0, 0.1]), dark, { k: 0.02, ck: 0.03 });
    const g = polygonize(s, {
      tint: (x, y, z, nx, ny, nz, rgb) => {
        const mott = 0.92 + 0.14 * Math.sin(x * 5 + y * 3) * Math.sin(y * 6 - z * 4);
        rgb[0] *= mott; rgb[1] *= mott; rgb[2] *= mott;
      },
    });
    life.push({ geometry: g, keepColor: true });
    // Teeth: long curved needles, seated in the lip by asking how far round it they are.
    const ivory = 0xe8e2c8;
    const field = s.snapshot();
    const lip = (t, upper) => {
      const a = (t - 0.5) * Math.PI * 0.9;
      const guess = [cx - 0.68 - Math.cos(a) * 0.5, cy - 0.11 + (upper ? 0.16 : -0.16), cz + Math.sin(a) * 0.42];
      return onSurface(field, guess, -0.012);
    };
    for (let i = 0; i < 9; i++) {
      const t = (i + 0.5) / 9;
      const u = lip(t, true); const l = lip(t, false);
      const L1 = 0.09 + 0.05 * Math.sin(t * Math.PI);
      // Upper teeth down and back a little, lowers up and back, so they cross without meeting.
      life.push({ geometry: tube([[u[0], u[1] + 0.012, u[2]], [u[0] + 0.006, u[1] - L1 * 0.55, u[2]], [u[0] + 0.03, u[1] - L1, u[2]]], [0.016, 0.01, 0.001], { sides: 5, steps: 4, round: 0 }), color: ivory });
      life.push({ geometry: tube([[l[0], l[1] - 0.012, l[2]], [l[0] + 0.006, l[1] + L1 * 0.55, l[2]], [l[0] + 0.03, l[1] + L1, l[2]]], [0.016, 0.01, 0.001], { sides: 5, steps: 4, round: 0 }), color: ivory });
    }
    // Small eye.
    const eye = new THREE.SphereGeometry(0.05, 12, 8);
    tintVertices(eye, (x, y, z, o) => { const c = Math.hypot(x, y) < 0.02 ? lin(0x050505) : lin(0xc9cfc0); o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; });
    eye.translate(cx - 0.34, cy + 0.29, cz + 0.36);
    life.push({ geometry: eye, keepColor: true });
    // The stalk grows from the head, arching forward, and ends in the lure.
    const lure = [OCEAN_LURE[0], OCEAN_LURE[1], cz + 0.02];
    life.push({ geometry: tube([[cx - 0.2, cy + 0.54, cz], [cx - 0.36, cy + 0.98, cz + 0.01], [cx - 0.68, cy + 1.02, cz + 0.02], [lure[0] + 0.02, lure[1] + 0.06, lure[2]]], [0.03, 0.021, 0.015, 0.012], { sides: 7, steps: 20, round: 1 }), color: 0x8b6a54 });
    glow.push({ geometry: new THREE.SphereGeometry(0.08, 16, 12).translate(lure[0], lure[1], lure[2]) });
    if (Math.hypot(lure[0] - OCEAN_LURE[0], lure[1] - OCEAN_LURE[1]) > 1e-9) throw new Error('ocean: the painted glow is not on the lure');
  }

  // A little glowing jelly below it: the card's "many animals make their own light". The bell's rim
  // and its tentacles' tips are the glow mesh.
  {
    const cx = -0.45; const cy = 8.35; const cz = FACE + 0.2;
    const bell = lathe([[0, -0.11], [0.14, -0.11], [0.2, -0.09], [0.22, -0.04], [0.19, 0.05], [0.12, 0.13], [0, 0.17]], 18);
    bell.translate(cx, cy, cz);
    life.push({ geometry: bell, color: 0x7e5f8f });
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU;
      const p = [cx + Math.cos(a) * 0.15, cy - 0.1, cz + Math.sin(a) * 0.1];
      life.push({ geometry: tube([p, [p[0] + (rng() - 0.5) * 0.14, p[1] - 0.25, p[2]], [p[0] + (rng() - 0.5) * 0.2, p[1] - 0.5, p[2] - 0.03]], [0.008, 0.006, 0.002], { sides: 4, steps: 8, round: 0 }), color: 0xbda3d4 });
      glow.push({ geometry: new THREE.SphereGeometry(0.018, 7, 5).translate(cx + Math.cos(a) * 0.205, cy - 0.095, cz + Math.sin(a) * 0.15) });
    }
  }

  // TRIPOD FISH, standing on the abyssal mud on three long fin rays, facing into the current.
  {
    const cx = -1.72; const floor = oceanFloorY(cx);
    const stilt = 0.72;
    const cy = floor + stilt + 0.1; const cz = FACE + 0.5;
    const s = new Sculpt(0.03);
    const B = lin(0xc2bfae);
    s.add(curveP([[cx + 0.42, cy + 0.01, cz], [cx + 0.2, cy + 0.03, cz], [cx - 0.12, cy + 0.03, cz], [cx - 0.5, cy + 0.0, cz], [cx - 0.82, cy - 0.04, cz]], [0.05, 0.1, 0.11, 0.07, 0.02], 16), B);
    s.add(ellipsoidP([cx + 0.31, cy + 0.03, cz], [0.14, 0.095, 0.085]), B, { k: 0.05 });
    // Dorsal fin along the back.
    life.push({ geometry: fin([[cx + 0.2, cy + 0.09, cz], [cx - 0.1, cy + 0.14, cz], [cx - 0.5, cy + 0.08, cz]], [0.1, 0.15, 0.02], [0, 0, 1], 0.02), color: 0x9f9c8c });
    // Two pelvic stilts and one from the tail: the three legs that name it. Each ends on the mud.
    const feet = [
      [cx + 0.16, oceanFloorY(cx + 0.16) - 0.01, cz + 0.2],
      [cx + 0.16, oceanFloorY(cx + 0.16) - 0.01, cz - 0.18],
      [cx - 0.92, oceanFloorY(cx - 0.92) - 0.01, cz],
    ];
    const STILT = 0xd6d2c0;
    const leg = (a, b, c) => life.push({ geometry: tube([a, b, c], [0.03, 0.018, 0.012], { sides: 6, steps: 12, round: 1 }), color: STILT });
    leg([cx + 0.08, cy - 0.04, cz + 0.05], [cx + 0.13, cy - 0.42, cz + 0.13], feet[0]);
    leg([cx + 0.08, cy - 0.04, cz - 0.05], [cx + 0.13, cy - 0.42, cz - 0.11], feet[1]);
    leg([cx - 0.76, cy - 0.04, cz], [cx - 0.87, cy - 0.42, cz], feet[2]);
    // Long pectoral rays swept up and forward: it feels for food with them.
    life.push({ geometry: tube([[cx + 0.15, cy, cz + 0.07], [cx + 0.46, cy + 0.26, cz + 0.15], [cx + 0.86, cy + 0.32, cz + 0.15]], [0.016, 0.01, 0.004], { sides: 5, steps: 10, round: 1 }), color: STILT });
    const g = polygonize(s);
    life.push({ geometry: g, keepColor: true });
    const eye = new THREE.SphereGeometry(0.018, 8, 6);
    eye.translate(cx + 0.36, cy + 0.06, cz + 0.08);
    life.push({ geometry: eye, color: 0x161412 });
  }

  // THE VENT: a chimney of minerals, black smoke rising, and tube worms at its foot.
  {
    const cx = 2.42; const floor = oceanFloorY(cx); const cz = FACE + 0.56;
    const s = new Sculpt(0.07);
    const T = lin(0x6a5a4b);
    s.add(curveP([[cx, floor - 0.2, cz], [cx + 0.03, floor + 0.55, cz], [cx - 0.03, floor + 1.15, cz], [cx + 0.02, floor + 1.72, cz]], [0.32, 0.24, 0.17, 0.11], 12), T);
    const lump = seededRandom(17);
    for (let k = 0; k < 16; k++) {
      const t = lump(); const a = lump() * TAU;
      const r = mix(0.24, 0.1, t);
      s.add(sphereP([cx + Math.cos(a) * r, floor + t * 1.68, cz + Math.sin(a) * r], 0.05 + lump() * 0.07), T, { k: 0.05 });
    }
    s.add(curveP([[cx + 0.3, floor - 0.1, cz + 0.05], [cx + 0.42, floor + 0.32, cz + 0.08], [cx + 0.44, floor + 0.72, cz + 0.08]], [0.14, 0.095, 0.06], 8), T, { k: 0.08 });
    s.sub(sphereP([cx + 0.02, floor + 1.76, cz], 0.075), lin(0x120d0a), { k: 0.02 });
    const yel = lin(0xb39a48); const red = lin(0x7a4a2c);
    const chimney = polygonize(s, {
      tint: (x, y, z, nx, ny, nz, rgb) => {
        const q = Math.sin(x * 19 + y * 13) * Math.sin(y * 17 - z * 11);
        const t = sstep(q, 0.25, 0.7);
        rgb[0] = mix(rgb[0], y > floor + 1.1 ? yel[0] : red[0], t * 0.65); rgb[1] = mix(rgb[1], y > floor + 1.1 ? yel[1] : red[1], t * 0.65); rgb[2] = mix(rgb[2], y > floor + 1.1 ? yel[2] : red[2], t * 0.65);
      },
    });
    life.push({ geometry: chimney, keepColor: true });
    // The smoke: dark billows, widening as they rise, sunk into the cut at the back.
    const m = new Sculpt(0.075);
    const smoke = lin(0x2f2e34);
    const sr = seededRandom(23);
    const puffs = 15;
    for (let k = 0; k < puffs; k++) {
      const t = k / (puffs - 1);
      const r = mix(0.08, 0.27, t ** 0.8) * (0.75 + sr() * 0.5);
      const swing = Math.sin(t * 5.2) * 0.14 * t;
      const x = cx + 0.02 + swing + (sr() - 0.5) * 0.36 * t - t * 0.14;
      m.add(sphereP([x, floor + 1.84 + t * 1.42, cz - t * 0.2 + (sr() - 0.5) * 0.1], r), smoke, { k: 0.035 });
    }
    const sm = polygonize(m, {
      tint: (x, y, z, nx, ny, nz, rgb) => {
        const k = 0.72 + 0.62 * clamp01(ny * 0.5 + 0.5) + 0.2 * Math.sin(x * 7 + y * 6);
        rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
      },
    });
    life.push({ geometry: sm, keepColor: true });
    // Tube worms: white tubes in a thicket, each with a red plume.
    const wr = seededRandom(404);
    let worms = 0;
    for (let k = 0; k < 40 && worms < 18; k++) {
      const x = cx - 0.96 + wr() * 0.7; const z = FACE + 0.28 + wr() * 0.5;
      if (x < 1.25) continue;
      const y0 = oceanFloorY(x) - 0.04;
      const h = 0.4 + wr() * 0.5;
      const tip = [x + (wr() - 0.5) * 0.14, y0 + h, z + (wr() - 0.5) * 0.1];
      life.push({ geometry: tube([[x, y0, z], [mix(x, tip[0], 0.4) + 0.012, y0 + h * 0.5, mix(z, tip[2], 0.4)], tip], [0.028, 0.024, 0.021], { sides: 7, steps: 8, round: 0 }), color: 0xe7e2d3 });
      const plume = new THREE.SphereGeometry(0.044, 9, 7);
      plume.scale(1, 1.7, 1);
      plume.translate(tip[0], tip[1] + 0.05, tip[2]);
      life.push({ geometry: plume, color: 0xc2271f });
      worms += 1;
    }
  }

  // THE RESEARCH SUBMERSIBLE, tiny, far down in the trench with its lamps on.
  {
    const cx = 0.03; const cy = 1.92; const cz = FACE + 0.26;
    const s = new Sculpt(0.022);
    const Y = lin(0xe6b52c); const W2 = lin(0xe6e6df);
    s.add(ellipsoidP([cx, cy + 0.05, cz], [0.24, 0.085, 0.1]), Y);
    s.add(sphereP([cx + 0.1, cy - 0.03, cz], 0.095), W2, { k: 0.015 });
    s.add(boxP([cx - 0.05, cy + 0.13, cz], [0.06, 0.02, 0.03], null, 0.016), Y, { k: 0.015 });
    s.add(curveP([[cx - 0.2, cy + 0.03, cz], [cx - 0.3, cy + 0.04, cz]], [0.03, 0.036], 3), lin(0x3a3f44), { k: 0.012 });
    const METAL = 0x3a3f44;
    for (const o of [-1, 1]) {
      life.push({ geometry: rod([cx - 0.16, cy - 0.125, cz + o * 0.06], [cx + 0.12, cy - 0.125, cz + o * 0.06], 0.012, 5, 1), color: METAL });
      life.push({ geometry: rod([cx - 0.08, cy, cz + o * 0.05], [cx - 0.08, cy - 0.125, cz + o * 0.06], 0.008, 4, 0), color: METAL });
      life.push({ geometry: rod([cx + 0.08, cy - 0.07, cz + o * 0.05], [cx + 0.08, cy - 0.125, cz + o * 0.06], 0.008, 4, 0), color: METAL });
    }
    // A manipulator arm.
    life.push({ geometry: tube([[cx + 0.15, cy - 0.08, cz + 0.05], [cx + 0.25, cy - 0.11, cz + 0.06], [cx + 0.31, cy - 0.06, cz + 0.06]], 0.008, { sides: 5, steps: 6, round: 1 }), color: METAL });
    const g = polygonize(s);
    life.push({ geometry: g, keepColor: true });
    const port = new THREE.SphereGeometry(0.038, 12, 8);
    port.translate(cx + 0.17, cy - 0.015, cz + 0.05);
    life.push({ geometry: port, color: 0x143044 });
    for (const q of [[0.25, 0.07, 0.03], [0.25, 0.07, -0.03]]) {
      life.push({ geometry: rod([cx + 0.18, cy + 0.06, cz + q[2]], [cx + q[0], cy + q[1], cz + q[2]], 0.008, 5, 0), color: 0x3a3f44 });
      glow.push({ geometry: new THREE.SphereGeometry(0.018, 8, 6).translate(cx + q[0], cy + q[1], cz + q[2]) });
    }
  }

  // THE BOAT on the surface: a small research ship, with a sharp bow toward +X.
  {
    const cx = 1.15; const cz = 0.15; const w = oceanTopY(cx, cz);
    const s = new Sculpt(0.05);
    const HULL = lin(0xbd3a26); const WHITE = lin(0xece8df);
    // A hull is a long ellipsoid cut flat for a deck and a straight stem.
    s.add(ellipsoidP([cx, w + 0.04, cz], [1.2, 0.3, 0.32]), HULL);
    s.sub(boxP([cx, w + 0.5, cz], [2, 0.32, 1]), null, { k: 0.01 });
    s.add(boxP([cx - 0.2, w + 0.28, cz], [0.42, 0.11, 0.2], null, 0.015), WHITE, { k: 0.008 });
    s.add(boxP([cx + 0.02, w + 0.47, cz], [0.18, 0.09, 0.14], null, 0.012), WHITE);
    s.add(curveP([[cx - 0.42, w + 0.3, cz], [cx - 0.42, w + 0.58, cz]], [0.055, 0.05], 3), lin(0x28343e));
    life.push({ geometry: rod([cx + 0.02, w + 0.54, cz], [cx + 0.02, w + 1.02, cz], [0.018, 0.01], 6, 1), color: 0x28343e });
    life.push({ geometry: rod([cx - 0.14, w + 0.82, cz], [cx + 0.18, w + 0.82, cz], 0.008, 5, 1), color: 0x28343e });
    const g = polygonize(s, {
      tint: (x, y, z, nx, ny, nz, rgb) => {
        // A waterline stripe, and the deck painted.
        if (ny > 0.8 && y > w + 0.16 && y < w + 0.2) { rgb[0] = 0.45; rgb[1] = 0.35; rgb[2] = 0.22; }
      },
    });
    life.push({ geometry: g, keepColor: true });
    // Windows on the wheelhouse.
    for (let k = 0; k < 4; k++) {
      life.push({ geometry: block(cx - 0.13 + k * 0.09, w + 0.47, cz + 0.142, cx - 0.07 + k * 0.09, w + 0.53, cz + 0.15), color: 0x1c2c38 });
    }
  }
  root.add(mesh(mergeParts(life), standard({ vertexColors: true, roughness: 0.55, metalness: 0.04 })));

  // The glowing parts, which are really emissive.
  if (glow.length) {
    root.add(mesh(mergeParts(glow.map((q) => ({ geometry: q.geometry, color: 0xffffff }))), standard({ vertexColors: true, color: 0xffffff, emissive: 0x8ff2e4, emissiveIntensity: 2.2, roughness: 0.4, metalness: 0 })));
  }

  // A plinth and the depth ruler, on the column's left edge.
  const hard = [];
  hard.push({ geometry: block(-HX - 0.14, 0, -HZ - 0.14, HX + 0.14, Y0, HZ + PROUD + 0.2), color: 0x2e2a26 });
  hard.push({ geometry: block(-HX - 0.09, Y0, FACE - 0.1, -HX - 0.02, YTOP + 0.02, FACE + 0.05), color: 0xe7e2d3 });
  for (let i = 0; i <= 5; i++) hard.push({ geometry: block(-HX - 0.38, zoneTop(i) - 0.012, FACE - 0.05, -HX, zoneTop(i) + 0.012, FACE + 0.055), color: 0xe7e2d3 });

  // Everything printed, from the one table.
  const zp = ZONES.map((z) => ({ lines: [z.name, zoneRange(z)], w: 2.25, h: 0.56 }));
  const ticks = [0, 650, 3300, 13000, 20000, 36000].map((v) => ({ lines: [fmtFt(v)], w: 0.84, h: 0.22 }));
  const notes = [
    { lines: ['ZONES DRAWN AT EQUAL HEIGHTS. NOT TO SCALE: THE LOWER ZONES ARE FAR DEEPER.'], w: 5.6, h: 0.3 },
    { lines: ['CHALLENGER DEEP', 'nearly 36,000 ft'], w: 1.7, h: 0.42 },
  ];
  const tags = ['Plankton', 'Dolphin', 'Swordfish', 'Anglerfish', 'Tripod fish', 'Tube worms and vent', 'Research submersible'].map((t) => ({ lines: [t], w: t.length > 14 ? 1.3 : 0.86, h: 0.17 }));
  const entries = [...zp, ...ticks, ...notes, ...tags];
  const atlas = plateAtlas(entries, 180, 1024, (e) => (e.h < 0.2 ? { ground: '#e6ebee', ink: '#10202c', edge: '#5b6b76' } : { ground: '#f0ecdd', ink: '#0d1c2a', edge: '#46596a', big: 0.54 }));
  const printed = [];
  const put = (i, x, y, z, depth = 0.03) => {
    const e = entries[i];
    const g = printedPlate(e.w, e.h, depth, atlas.uv(i));
    g.translate(x, y, z);
    printed.push({ geometry: g, keepColor: true });
  };
  // Zone plates: down the left, near the top of each zone. The last lives on the rock.
  const PX = -1.68;
  ZONES.forEach((z, i) => {
    const y = zoneTop(i) - 0.56;
    if (i < 4) put(i, PX, y, FACE + 0.03, 0.05);
    else put(i, -2.66, zoneTop(4) - 1.0, FACE + PROUD + 0.44, 0.7);
  });
  ticks.forEach((t, i) => put(5 + i, -HX - 0.38 - 0.44 + 0.02, zoneTop(i) - (i === 5 ? -0.09 : 0.07), FACE + 0.05, 0.05));
  put(11, 0, 0.26, HZ + PROUD + 0.2 + 0.018, 0.03);
  put(12, 2.72, 1.5, FACE + PROUD + 0.44, 0.7);
  const tagAt = [[-2.75, 14.65], [1.72, 15.15], [2.3, 11.42], [0.6, 8.0], [-1.72, oceanFloorY(-1.72) + 1.28], [1.3, 5.4], [-0.03, 2.5]];
  tagAt.forEach(([x, y], i) => put(13 + i, x, y, FACE + 0.04, 0.05));
  root.add(mesh(mergeParts(hard), standard({ vertexColors: true, roughness: 0.7, metalness: 0.02 })));
  root.add(mesh(mergeParts(printed), standard({ map: atlas.map, roughness: 0.7, metalness: 0 })));
  return root;
}

// ===========================================================================================
// HOW A FOSSIL FORMS
// ===========================================================================================
//
// Five cut blocks along X. One fish, one list of layers. The skeleton is computed once below and the
// same numbers paint its bones in blocks 2 to 5, ghost them on the whole fish in block 1, and model them
// in relief in block 5. The layers are a stack in one coordinate, s, measured up from the bed the fish
// lay on, so a block is only a choice of where s is at its own (x, y): the colours cannot disagree.
export const FOSSIL = {
  PITCH: 5, HALF: 2, HZ: 1.4, Y0: 0.32, H: 4,
  S_FISH: 0.44,
  TILT: -16 * DEG,
  SETTLE: -3 * DEG,
  // Where the fish's centre sits in each block's own height, and whether its rock is tilted.
  CY: [2.24, 2.34, 0.99, 1.82, 2.02],
  TILTED: [false, false, false, true, true],
};

// Thickness up from the bottom of the stack, with s = 0 being the river bed.
const FOSSIL_LAYERS = [
  { s0: -6.0, c: [150, 128, 104], name: 'old sandstone' },
  { s0: -3.3, c: [164, 106, 72], name: 'rusty sand' },
  { s0: -2.4, c: [205, 184, 146], name: 'buff sand' },
  { s0: -1.5, c: [138, 134, 104], name: 'olive silt' },
  { s0: -0.7, c: [186, 158, 118], name: 'tan sand' },
  { s0: 0, c: [172, 170, 150], name: 'grey mud, the fish' },
  { s0: 1.0, c: [222, 208, 170], name: 'pale sand' },
  { s0: 1.35, c: [112, 110, 104], name: 'dark mud' },
  { s0: 1.85, c: [196, 150, 82], name: 'ochre sand' },
  { s0: 2.1, c: [160, 88, 58], name: 'red silt' },
  { s0: 2.4, c: [228, 218, 192], name: 'cream ash' },
  { s0: 2.6, c: [96, 104, 116], name: 'slate mud' },
  { s0: 2.95, c: [204, 176, 92], name: 'yellow sand' },
  { s0: 3.1, c: [132, 96, 70], name: 'brown silt' },
  { s0: 3.45, c: [176, 176, 170], name: 'pale limestone' },
  { s0: 3.7, c: [136, 74, 62], name: 'dark red' },
  { s0: 4.1, c: [198, 170, 130], name: 'buff top' },
];
export const fossilLayerAt = (s) => {
  let i = 0;
  while (i < FOSSIL_LAYERS.length - 1 && s >= FOSSIL_LAYERS[i + 1].s0) i++;
  return i;
};

// A block's own coordinates to the stack.
export function fossilS(k, xb, yb) {
  const t = FOSSIL.TILTED[k] ? FOSSIL.TILT : 0;
  return FOSSIL.S_FISH + xb * -Math.sin(t) + (yb - FOSSIL.CY[k]) * Math.cos(t);
}
const fossilWob = (xb) => 0.02 * Math.sin(xb * 3.1 + 1.7) + 0.011 * Math.sin(xb * 7.7 + 0.4);

// How the stack is seen at a point: one function, whatever block is asking.
function fossilPainter() {
  const n1 = latticeNoise(721); const n2 = latticeNoise(99);
  // A lookup, because this runs per texel.
  const RES = 200; const LO = -6; const HI = 6;
  const lut = new Uint8Array((HI - LO) * RES + 1);
  for (let i = 0; i < lut.length; i++) lut[i] = fossilLayerAt(LO + i / RES);
  return (s, xb, yb, rock, out) => {
    const q = s + fossilWob(xb);
    const idx = lut[Math.max(0, Math.min(lut.length - 1, Math.round((q - LO) * RES)))];
    const c = FOSSIL_LAYERS[idx].c;
    const grain = n1(xb * 32, yb * 32) - 0.5;
    const lam = Math.sin(q * 70 + n2(xb * 0.9, q * 3) * 3 + idx) * 0.045;
    let k = 1 + grain * 0.2 + lam;
    const nextUp = FOSSIL_LAYERS[idx + 1]?.s0 ?? 99;
    const edge = Math.min(q - FOSSIL_LAYERS[idx].s0, nextUp - q);
    if (edge < 0.008) k *= 0.8;
    if (rock) {
      // Turned to rock: the same colours, cemented, and cut by a few upright joints.
      k *= 1 + (n2(xb * 8, yb * 8) - 0.5) * 0.1;
      for (const jx of [-1.45, -0.1, 1.1]) {
        const w = xb - jx - (n2(jx + 20, q * 0.8) - 0.5) * 0.3;
        if (Math.abs(w) < 0.007) { k *= 0.62; break; }
      }
    }
    out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
  };
}

// THE FISH. A generic bony fish, 3 feet from nose to tail, in its own frame: head toward +X, the
// centre of the body at the origin.
const FISH_TOP = [[1.18, 0], [1.0, 0.16], [0.7, 0.3], [0.3, 0.4], [-0.1, 0.4], [-0.5, 0.3], [-0.9, 0.17], [-1.2, 0.075], [-1.34, 0.055]];
const FISH_BOT = [[1.18, 0], [1.0, -0.12], [0.7, -0.28], [0.3, -0.4], [-0.1, -0.4], [-0.5, -0.3], [-0.9, -0.18], [-1.2, -0.08], [-1.34, -0.06]];
function fishEdge(table, x) {
  if (x >= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x >= table[i][0]) {
      const t = (table[i - 1][0] - x) / (table[i - 1][0] - table[i][0]);
      const p0 = table[Math.max(0, i - 2)][1]; const p1 = table[i - 1][1]; const p2 = table[i][1]; const p3 = table[Math.min(table.length - 1, i + 1)][1];
      return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
    }
  }
  return table[table.length - 1][1];
}
export const FISH_COUNTS = { VERTEBRAE: 28, RIBS: 12, DORSAL: 13, ANAL: 8, PECTORAL: 7, PELVIC: 6, CAUDAL: 16 };

// All of it as lines of bone: {pts, w, kind}, plus the vertebrae as {x, y, r}. Computed once a build
// and handed to everything that draws the fish.
export function fishSkeleton() {
  const C = FISH_COUNTS;
  const lines = [];
  const mid = (x) => -0.012 + 0.018 * Math.sin(x * 2);
  const verts = [];
  for (let i = 0; i < C.VERTEBRAE; i++) {
    const x = mix(0.6, -1.3, i / (C.VERTEBRAE - 1));
    verts.push({ x, y: mid(x), r: mix(0.031, 0.019, i / (C.VERTEBRAE - 1)) });
  }
  verts.forEach((v, i) => {
    const backX = v.x - 0.09;
    lines.push({ pts: [[v.x, v.y], [v.x - 0.05, mix(v.y, fishEdge(FISH_TOP, backX), 0.5)], [backX, v.y + (fishEdge(FISH_TOP, backX) - v.y) * 0.86]], w: 0.016, kind: 'neural' });
    if (i < C.RIBS) {
      const end = [v.x - 0.13, v.y + (fishEdge(FISH_BOT, v.x - 0.13) - v.y) * 0.9];
      lines.push({ pts: [[v.x, v.y], [v.x + 0.02, mix(v.y, end[1], 0.35)], [v.x - 0.03, mix(v.y, end[1], 0.72)], end], w: 0.016, kind: 'rib' });
    } else {
      lines.push({ pts: [[v.x, v.y], [v.x - 0.05, mix(v.y, fishEdge(FISH_BOT, backX), 0.5)], [backX, v.y + (fishEdge(FISH_BOT, backX) - v.y) * 0.86]], w: 0.014, kind: 'haemal' });
    }
  });
  // Fin rays.
  for (let i = 0; i < C.DORSAL; i++) {
    const x = mix(0.2, -0.68, i / (C.DORSAL - 1)); const y = fishEdge(FISH_TOP, x);
    const L = mix(0.33, 0.13, i / (C.DORSAL - 1));
    lines.push({ pts: [[x, y - 0.1], [x, y], [x - L * 0.42, y + L * 0.86]], w: 0.011, kind: 'ray' });
  }
  for (let i = 0; i < C.ANAL; i++) {
    const x = mix(-0.5, -0.98, i / (C.ANAL - 1)); const y = fishEdge(FISH_BOT, x);
    const L = mix(0.22, 0.09, i / (C.ANAL - 1));
    lines.push({ pts: [[x, y + 0.06], [x, y], [x - L * 0.5, y - L * 0.84]], w: 0.01, kind: 'ray' });
  }
  for (let i = 0; i < C.PECTORAL; i++) {
    const a = mix(198, 232, i / (C.PECTORAL - 1)) * DEG;
    const L = mix(0.38, 0.22, i / (C.PECTORAL - 1));
    lines.push({ pts: [[0.54, -0.1], [0.54 + Math.cos(a) * L, -0.1 + Math.sin(a) * L]], w: 0.01, kind: 'ray' });
  }
  for (let i = 0; i < C.PELVIC; i++) {
    const a = mix(208, 246, i / (C.PELVIC - 1)) * DEG;
    const L = mix(0.27, 0.15, i / (C.PELVIC - 1));
    lines.push({ pts: [[0.02, -0.37], [0.02 + Math.cos(a) * L, -0.37 + Math.sin(a) * L]], w: 0.01, kind: 'ray' });
  }
  for (let i = 0; i < C.CAUDAL; i++) {
    const f = i / (C.CAUDAL - 1) - 0.5;
    const a = Math.PI + f * 1.16;
    const L = 0.3 + Math.abs(f) * 0.48;
    lines.push({ pts: [[-1.32, f * 0.08], [-1.32 + Math.cos(a) * L, f * 0.08 + Math.sin(a) * L]], w: 0.011, kind: 'ray' });
  }
  // The skull, drawn as its main bones: the roof, the jaws, the eye socket, the gill cover and the
  // shoulder arch that the pectoral fin hangs from.
  const skull = [
    { pts: [[1.17, 0.015], [1.02, 0.17], [0.82, 0.255], [0.6, 0.29]], w: 0.032 },
    { pts: [[1.17, 0.015], [1.0, 0.0], [0.86, -0.045], [0.72, -0.1]], w: 0.03 },
    { pts: [[1.13, -0.03], [0.98, -0.11], [0.84, -0.16], [0.72, -0.16]], w: 0.032 },
    { pts: [[0.72, -0.1], [0.72, -0.16]], w: 0.026 },
    { pts: [[0.76, 0.02], [0.72, -0.08], [0.64, -0.2], [0.56, -0.25]], w: 0.024 },
    { pts: [[0.62, 0.22], [0.5, 0.14], [0.45, -0.02], [0.5, -0.17], [0.56, -0.25]], w: 0.026 },
    { pts: [[0.6, 0.29], [0.66, 0.1], [0.62, 0.22]], w: 0.02 },
    { pts: [[0.52, 0.2], [0.44, 0.02], [0.47, -0.2], [0.54, -0.34]], w: 0.03 },
    { pts: [[1.0, 0.15], [0.96, 0.03], [1.1, 0.01]], w: 0.018 },
    { pts: [[0.6, 0.29], [0.64, 0.02], [0.76, 0.02]], w: 0.022 },
  ];
  const orbit = { x: 0.84, y: 0.1, r: 0.082 };
  const teeth = [];
  for (let i = 0; i < 7; i++) {
    const x = mix(1.12, 0.86, i / 6);
    const y = mix(0.0, -0.05, i / 6);
    teeth.push({ pts: [[x, y], [x - 0.008, y - 0.038]], w: 0.009 });
  }
  if (verts.length !== C.VERTEBRAE) throw new Error('fish: vertebra count');
  if (lines.filter((q) => q.kind === 'rib').length !== C.RIBS) throw new Error('fish: rib count');
  return { lines, verts, skull, orbit, teeth };
}

function fishOutlinePts() {
  const pts = [];
  for (let i = 0; i <= 40; i++) { const x = mix(1.18, -1.34, i / 40); pts.push([x, fishEdge(FISH_TOP, x)]); }
  for (let i = 40; i >= 0; i--) { const x = mix(1.18, -1.34, i / 40); pts.push([x, fishEdge(FISH_BOT, x)]); }
  return pts;
}

// Draws the skeleton onto a canvas through T(fishX, fishY) -> [px, py], with P canvas pixels a foot.
function paintBones(ctx, S, T, P, { bone, stain = null, halo = null }) {
  const line = (pts, width) => {
    ctx.beginPath();
    pts.forEach(([a, b], i) => { const [x, y] = T(a, b); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.lineWidth = width * P;
    ctx.stroke();
  };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (stain) {
    // The stain the soft body left behind: a body-shaped shadow in the mud.
    ctx.fillStyle = stain;
    ctx.beginPath();
    fishOutlinePts().forEach(([a, b], i) => { const [x, y] = T(a, b); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath(); ctx.fill();
  }
  const pass = (colour, extra) => {
    ctx.strokeStyle = colour; ctx.fillStyle = colour;
    for (const q of S.lines) line(q.pts, q.w + extra);
    for (const q of S.skull) line(q.pts, q.w + extra);
    for (const q of S.teeth) line(q.pts, q.w + extra);
    for (const v of S.verts) {
      const [x, y] = T(v.x, v.y);
      ctx.beginPath(); ctx.arc(x, y, (v.r + extra) * P, 0, TAU); ctx.fill();
    }
    const [ox, oy] = T(S.orbit.x, S.orbit.y);
    ctx.beginPath(); ctx.arc(ox, oy, S.orbit.r * P, 0, TAU); ctx.lineWidth = (0.022 + extra) * P; ctx.stroke();
  };
  if (halo) pass(halo, 0.012);
  pass(bone, 0);
}

function buildFossilFormation() {
  const { PITCH, HALF, HZ, Y0, CY, TILTED, TILT, SETTLE, S_FISH } = FOSSIL;
  const S = fishSkeleton();

  // The story must hold, or nothing is built.
  for (let k = 0; k < 5; k++) {
    if (Math.abs(fossilS(k, 0, CY[k]) - S_FISH) > 1e-9) throw new Error(`fossil: the fish left its layer in block ${k + 1}`);
  }
  const bedY = (k) => CY[k] - S_FISH; // the bed at x = 0, in blocks that are level
  const LAYER_TOPS = [null, fossilS(1, 0, 4), fossilS(2, 0, 4)];
  const above = (top) => FOSSIL_LAYERS.filter((L) => L.s0 >= S_FISH && L.s0 < top).length;
  if (!(above(LAYER_TOPS[2]) >= above(LAYER_TOPS[1]) + 4)) throw new Error('fossil: block 3 should lie under many more layers than block 2');
  for (let i = 1; i < FOSSIL_LAYERS.length; i++) if (FOSSIL_LAYERS[i].s0 <= FOSSIL_LAYERS[i - 1].s0) throw new Error('fossil: layers out of order');

  const X = (k) => (k - 2) * PITCH;
  const fishTheta = (k) => SETTLE + (TILTED[k] ? TILT : 0);

  // Each block's top, in its own height.
  const n = latticeNoise(3030);
  const ripple = (x, z) => 0.022 * Math.sin(x * 5.2 + z * 1.3) + 0.012 * Math.sin(x * 11 - z * 3);
  const TOP = [
    (x, z) => bedY(0) + ripple(x, z) * 0.7,
    (x, z) => 4 + ripple(x, z) * 0.6 - 0.02,
    (x, z) => 4 + 0.02 * Math.sin(x * 2.1 + z) - 0.02,
    (x, z) => {
      // Worn down: an uneven surface with a valley cut across it, the beds truncated.
      const v = (x - 0.45 - z * 0.16) / 0.72;
      return 3.7 - 0.26 * Math.sin(x * 1.1 + 1) - 0.78 * Math.exp(-v * v) - 0.14 * (z / HZ) + 0.05 * Math.sin(x * 5 + z * 3) + (n(x * 1.3 + 7, z * 1.3 + 7) - 0.5) * 0.22;
    },
    (x, z) => {
      // A hillside that has worn right down to the fish: at the cut its surface lies just over the
      // fish's fin tips, on the dip of the beds, and it climbs away toward the back.
      const line = CY[4] + 0.8 + x * Math.tan(fishTheta(4));
      return line + 0.5 * ((HZ - z) / (2 * HZ)) * 1.9 + (z < HZ ? 0.03 * Math.sin(x * 3 + z * 4) * ((HZ - z) / HZ) : 0);
    },
  ];

  // THE ATLAS. Five faces large, the fish's skin, and the rest of each block coarse.
  const F = 576; const P = F / 4;
  const AW = F * 3; const FACES_H = F * 2; const REST_H = 384; const AH = FACES_H + REST_H;
  const faceCell = (k) => [(k % 3) * F, Math.floor(k / 3) * F];
  const skinCell = [2 * F, F];
  const restCell = (k) => {
    const col = k % 3; const row = k < 3 ? 0 : 1;
    const x = col * 576; const y = FACES_H + row * 192;
    return { back: [x, y, 164, 192], right: [x + 164, y, 115, 192], left: [x + 279, y, 115, 192], top: [x + 394, y, 164, 115] };
  };
  const YR = 4.8; // the height each coarse cell's rows reach
  const SKIN = { x0: -2.0, x1: 1.32, y0: -1.66, y1: 1.66 };
  const skinUV = (fx, fy) => [(skinCell[0] + ((fx - SKIN.x0) / (SKIN.x1 - SKIN.x0)) * F) / AW, 1 - (skinCell[1] + (1 - (fy - SKIN.y0) / (SKIN.y1 - SKIN.y0)) * F) / AH];

  const paintS = fossilPainter();
  const grass = latticeNoise(66);
  const map = canvasTexture(AW, AH, (ctx) => {
    ctx.fillStyle = '#6d6252'; ctx.fillRect(0, 0, AW, AH);
    for (let k = 0; k < 5; k++) {
      const [ox, oy] = faceCell(k);
      const rock = k >= 2;
      paintTexels(ctx, ox, oy, F, F, (i, j, out) => {
        const xb = -HALF + ((i + 0.5) / F) * 2 * HALF;
        const yb = 4 * (1 - (j + 0.5) / F);
        paintS(fossilS(k, xb, yb), xb, yb, rock, out);
      });
      if (k === 0) continue;
      const th = fishTheta(k); const c = Math.cos(th); const sn = Math.sin(th);
      const T = (fx, fy) => {
        const xb = fx * c - fy * sn; const yb = CY[k] + fx * sn + fy * c;
        return [ox + (xb + HALF) * P, oy + (4 - yb) * P];
      };
      if (k === 1) paintBones(ctx, S, T, P, { bone: '#f4ecd2', stain: 'rgba(92,88,70,0.26)', halo: 'rgba(70,62,44,0.34)' });
      else paintBones(ctx, S, T, P, { bone: '#231a16', stain: 'rgba(60,50,40,0.18)', halo: 'rgba(216,200,160,0.3)' });
    }
    // The fish's skin: dark back, silver belly, scales, and the same skeleton as a ghost beneath it,
    // so a student can see that this fish and the bones in the next block are one.
    const px = (fx) => skinCell[0] + ((fx - SKIN.x0) / (SKIN.x1 - SKIN.x0)) * F;
    const py = (fy) => skinCell[1] + (1 - (fy - SKIN.y0) / (SKIN.y1 - SKIN.y0)) * F;
    const PF = F / (SKIN.x1 - SKIN.x0);
    paintTexels(ctx, skinCell[0], skinCell[1], F, F, (i, j, out) => {
      const fx = SKIN.x0 + ((i + 0.5) / F) * (SKIN.x1 - SKIN.x0);
      const fy = SKIN.y1 - ((j + 0.5) / F) * (SKIN.y1 - SKIN.y0);
      const top = fishEdge(FISH_TOP, fx); const bot = fishEdge(FISH_BOT, fx);
      if (fx > 1.18 || fx < -1.34 || fy > top + 0.02 || fy < bot - 0.02) {
        out[0] = 112; out[1] = 124; out[2] = 104;
        return;
      }
      const t = clamp01((fy - bot) / Math.max(0.01, top - bot));
      const back = [58, 90, 84]; const belly = [214, 220, 208];
      const m = sstep(t, 0.28, 0.72);
      const sc = 0.92 + 0.14 * Math.abs(Math.sin((fx + fy) * 34)) * Math.abs(Math.sin((fx - fy) * 34));
      const head = fx > 0.52 ? 1.05 : sc;
      out[0] = mix(belly[0], back[0], m) * head; out[1] = mix(belly[1], back[1], m) * head; out[2] = mix(belly[2], back[2], m) * head;
    });
    const Tf = (fx, fy) => [px(fx), py(fy)];
    // Fin rays over the fins, then the ghost of every bone.
    ctx.strokeStyle = 'rgba(50,60,46,0.75)';
    ctx.lineCap = 'round';
    for (const q of S.lines) {
      if (q.kind !== 'ray') continue;
      ctx.beginPath();
      q.pts.forEach(([a, b], i) => { const [x, y] = Tf(a, b); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.save();
    ctx.beginPath();
    fishOutlinePts().forEach(([a, b], i) => { const [x, y] = Tf(a, b); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath(); ctx.clip();
    ctx.globalAlpha = 0.34;
    paintBones(ctx, { ...S, lines: S.lines.filter((q) => q.kind !== 'ray') }, Tf, PF, { bone: '#fff8e4' });
    ctx.restore();
    // The gill cover's edge, the lateral line, and a dull eye.
    ctx.strokeStyle = 'rgba(30,44,40,0.55)'; ctx.lineWidth = 2.4;
    ctx.beginPath();
    [[0.53, 0.25], [0.46, 0.08], [0.46, -0.1], [0.54, -0.28]].forEach(([a, b], i) => { const [x, y] = Tf(a, b); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.strokeStyle = 'rgba(30,44,40,0.4)'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i <= 30; i++) { const a = mix(0.45, -1.3, i / 30); const [x, y] = Tf(a, 0.05 + 0.03 * Math.sin(a * 2)); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
    const [ex, ey] = Tf(S.orbit.x, S.orbit.y);
    ctx.fillStyle = '#d7d4c2'; ctx.beginPath(); ctx.arc(ex, ey, 0.072 * PF, 0, TAU); ctx.fill();
    ctx.fillStyle = '#36342c'; ctx.beginPath(); ctx.arc(ex, ey, 0.036 * PF, 0, TAU); ctx.fill();

    // The rest of each block, by the same function.
    for (let k = 0; k < 5; k++) {
      const r = restCell(k);
      const rock = k >= 2;
      const rowsY = (j, h) => YR * (1 - (j + 0.5) / h);
      paintTexels(ctx, ...r.back.slice(0, 2), r.back[2], r.back[3], (i, j, out) => {
        const xb = HALF - ((i + 0.5) / r.back[2]) * 2 * HALF; const yb = rowsY(j, r.back[3]);
        paintS(fossilS(k, xb, yb), xb, yb, rock, out);
      });
      paintTexels(ctx, ...r.right.slice(0, 2), r.right[2], r.right[3], (i, j, out) => {
        const yb = rowsY(j, r.right[3]);
        paintS(fossilS(k, HALF, yb), HALF, yb, rock, out);
      });
      paintTexels(ctx, ...r.left.slice(0, 2), r.left[2], r.left[3], (i, j, out) => {
        const yb = rowsY(j, r.left[3]);
        paintS(fossilS(k, -HALF, yb), -HALF, yb, rock, out);
      });
      paintTexels(ctx, ...r.top.slice(0, 2), r.top[2], r.top[3], (i, j, out) => {
        const xb = -HALF + ((i + 0.5) / r.top[2]) * 2 * HALF; const z = -HZ + ((j + 0.5) / r.top[3]) * 2 * HZ;
        const yb = TOP[k](xb, z);
        paintS(fossilS(k, xb, yb), xb, yb, rock, out);
        const g = grass(xb * 2.2 + k * 7, z * 2.2) * 0.65 + grass(xb * 9, z * 9) * 0.35;
        // Which surfaces are green, and how much: none under water, patchy on rock that is wearing away.
        let green = 0;
        if (k === 2) green = sstep(g, 0.34, 0.56);
        if (k === 3) green = sstep(g, 0.5, 0.66) * 0.9;
        if (k === 4) green = sstep(g + (0 - z) * 0.32, 0.6, 0.76);
        // The two young surfaces are still loose sand and mud, whatever is under them.
        if (k <= 1) {
          const sand = k === 0 ? [176, 156, 120] : FOSSIL_LAYERS[8].c;
          const q = 0.82 + g * 0.36;
          out[0] = sand[0] * q; out[1] = sand[1] * q; out[2] = sand[2] * q;
        }
        out[0] = mix(out[0], 62 + g * 30, green); out[1] = mix(out[1], 84 + g * 38, green); out[2] = mix(out[2], 42 + g * 16, green);
      });
    }
  });

  const uvRectOf = (cell, u, v) => [(cell[0] + u * cell[2]) / AW, 1 - (cell[1] + (1 - v) * cell[3]) / AH];
  const pos = []; const uvs = [];
  for (let k = 0; k < 5; k++) {
    const cx = X(k);
    const r = restCell(k);
    const [fx, fy] = faceCell(k);
    const faceC = [fx, fy, F, F];
    cutBlockInto(pos, uvs, {
      x0: cx - HALF, x1: cx + HALF, z0: -HZ, z1: HZ, y0: Y0,
      top: (x, z) => Y0 + TOP[k](x - cx, z),
      NX: k >= 3 ? 40 : 24, NZ: k >= 3 ? 28 : 12,
      uv: {
        front: (x, y) => uvRectOf(faceC, (x - cx + HALF) / (2 * HALF), Math.min(1, (y - Y0) / 4)),
        back: (x, y) => uvRectOf(r.back, (cx + HALF - x) / (2 * HALF), Math.min(1, (y - Y0) / YR)),
        right: (z, y) => uvRectOf(r.right, (HZ - z) / (2 * HZ), Math.min(1, (y - Y0) / YR)),
        left: (z, y) => uvRectOf(r.left, (z + HZ) / (2 * HZ), Math.min(1, (y - Y0) / YR)),
        top: (x, z) => uvRectOf(r.top, (x - cx + HALF) / (2 * HALF), 1 - (z + HZ) / (2 * HZ)),
      },
    });
  }
  const blocks = soup(pos, uvs, 38);

  // THE WHOLE FISH, block 1. A sculpted body flattened side to side, plate fins from the same rays,
  // and the skin mapped straight on from the side, so the skeleton's ghost lines up with its own table.
  const fishParts = [];
  {
    const sc = new Sculpt(0.032);
    const stations = [];
    for (let i = 0; i <= 26; i++) {
      const x = mix(1.14, -1.34, i / 26);
      const t = fishEdge(FISH_TOP, x); const b = fishEdge(FISH_BOT, x);
      stations.push({ p: [x, (t + b) / 2, 0], r: Math.max(0.04, (t - b) / 2) });
    }
    sc.add(segsP(stations.map((q) => q.p), stations.map((q) => q.r)), 0xffffff);
    const body = polygonize(sc, { normalH: 0.8 });
    body.scale(1, 1, 0.52);
    body.computeVertexNormals();
    fishParts.push({ geometry: body });
    const planar = [0, 0, 1];
    const spread = (list, thick = 0.018) => {
      // A fin plate down the middle of its own rays, as wide as each ray is long.
      const spine = list.map((q) => { const a = q.pts[q.pts.length === 3 ? 1 : 0]; const b = q.pts[q.pts.length - 1]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]; });
      const widths = list.map((q) => { const a = q.pts[q.pts.length === 3 ? 1 : 0]; const b = q.pts[q.pts.length - 1]; return Math.hypot(b[0] - a[0], b[1] - a[1]) * 1.04; });
      return fin(spine, widths, planar, thick, Math.max(6, list.length));
    };
    const rayList = S.lines.filter((q) => q.kind === 'ray');
    const C = FISH_COUNTS;
    let at = 0;
    const take = (nRays) => { const l = rayList.slice(at, at + nRays); at += nRays; return l; };
    fishParts.push({ geometry: spread(take(C.DORSAL)) });
    fishParts.push({ geometry: spread(take(C.ANAL)) });
    const pect = take(C.PECTORAL); const pelv = take(C.PELVIC); const caud = take(C.CAUDAL);
    // Pectoral and pelvic fins are fans from one point, so they lie on the flank as plates.
    const fan = (list, z) => {
      const a = list[0].pts[0];
      const tips = list.map((q) => q.pts[q.pts.length - 1]);
      const posF = [];
      const push = (q, zz) => posF.push(q[0], q[1], zz);
      const zLo = z - 0.008; const zHi = z + 0.008;
      for (let i = 0; i < tips.length - 1; i++) {
        push(a, zHi); push(tips[i], zHi); push(tips[i + 1], zHi);
        push(a, zLo); push(tips[i + 1], zLo); push(tips[i], zLo);
        push(tips[i], zHi); push(tips[i], zLo); push(tips[i + 1], zLo);
        push(tips[i], zHi); push(tips[i + 1], zLo); push(tips[i + 1], zHi);
      }
      const q0 = tips[0]; const q1 = tips[tips.length - 1];
      push(a, zHi); push(a, zLo); push(q0, zLo); push(a, zHi); push(q0, zLo); push(q0, zHi);
      push(a, zHi); push(q1, zHi); push(q1, zLo); push(a, zHi); push(q1, zLo); push(a, zLo);
      return soup(posF, new Array((posF.length / 3) * 2).fill(0), 50);
    };
    fishParts.push({ geometry: fan(pect, 0.2) });
    fishParts.push({ geometry: fan(pelv, 0.1) });
    // The tail: the same rays, fanned from the end of the spine.
    fishParts.push({ geometry: fan(caud, 0) });
    const eye = new THREE.SphereGeometry(0.072, 14, 10);
    eye.scale(1, 1, 0.45);
    eye.translate(S.orbit.x, S.orbit.y, 0.13);
    fishParts.push({ geometry: eye });
  }
  const fishGeo = mergeParts(fishParts.map((q) => ({ geometry: q.geometry, color: 0xffffff })));
  // Straight-on uv from the fish's own (x, y), so paint and table cannot disagree.
  {
    const p = fishGeo.attributes.position; const uv = fishGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) { const q = skinUV(p.getX(i), p.getY(i)); uv.setXY(i, q[0], q[1]); }
    uv.needsUpdate = true;
    const m = new THREE.Matrix4().makeRotationZ(fishTheta(0));
    m.setPosition(X(0), Y0 + CY[0], 0.2);
    fishGeo.applyMatrix4(m);
    fishGeo.deleteAttribute('color');
  }
  const blockGeo = blocks;
  const fishForMerge = fishGeo.index ? fishGeo.toNonIndexed() : fishGeo;
  const allGeo = mergeParts([{ geometry: blockGeo, keepColor: true }, { geometry: fishForMerge, keepColor: true }]);
  allGeo.deleteAttribute('color');
  const root = new THREE.Group();
  root.add(mesh(allGeo, standard({ map, bumpMap: map, bumpScale: 0.45, roughness: 0.9, metalness: 0 })));

  // Everything else: the plinth, arrows, what lies on the surfaces, and the fossil standing proud.
  const props = [];
  const rng = seededRandom(1984);
  const PL_Z = HZ + 1.08;
  props.push({ geometry: block(-12.25, 0, -HZ - 0.2, 12.25, Y0, PL_Z), color: 0x4a3525 });
  const RED = 0xb6402a;
  for (let k = 0; k < 4; k++) {
    const a = X(k) + HALF + 0.12; const b = X(k + 1) - HALF - 0.12;
    const g = extrudeOutline([[a, 0.1], [b - 0.3, 0.1], [b - 0.3, 0.26], [b, 0], [b - 0.3, -0.26], [b - 0.3, -0.1], [a, -0.1]], 0.04);
    g.rotateX(-Math.PI / 2);
    g.translate(0, Y0 + 0.02, 0);
    props.push({ geometry: g, color: RED });
  }

  // Block 1: pebbles on the bed, weed, and the water over it all.
  const bedAt = (xb, z) => Y0 + TOP[0](xb, z);
  for (let i = 0; i < 46; i++) {
    const xb = mix(-1.9, 1.9, rng()); const z = mix(-1.3, 1.3, rng());
    const r = 0.03 + rng() ** 2 * 0.07;
    const g = grainy(new THREE.IcosahedronGeometry(r, 1), 10 + i, 0.14);
    g.scale(1.2, 0.62, 0.9);
    g.translate(X(0) + xb, bedAt(xb, z) + r * 0.2, z);
    const v = 120 + rng() * 80;
    props.push({ geometry: g, color: new THREE.Color().setRGB(v / 255, (v * 0.96) / 255, (v * 0.88) / 255, THREE.SRGBColorSpace).getHex() });
  }
  for (const [xb, z, h] of [[-1.6, -0.9, 1.4], [-1.25, -1.05, 1.15], [-1.75, -0.45, 0.95], [1.5, -0.95, 1.5], [1.72, -0.7, 1.05], [1.28, -1.1, 1.2]]) {
    const b = [X(0) + xb, bedAt(xb, z) - 0.02, z];
    const lean = rng() * 0.3 - 0.15;
    props.push({ geometry: tube([b, [b[0] + lean * 0.3, b[1] + h * 0.33, z + 0.03], [b[0] + lean * 0.8, b[1] + h * 0.66, z - 0.02], [b[0] + lean * 1.4, b[1] + h, z + 0.04]], [0.03, 0.024, 0.018, 0.004], { sides: 6, steps: 12, round: 1 }), color: 0x4d7a3a });
    props.push({ geometry: leafBlade([b[0] + lean * 0.5, b[1] + h * 0.45, z], [lean + 0.55, 0.6, 0.15], [0, 0.2, 1], h * 0.36, 0.04), color: 0x5b8a42 });
    props.push({ geometry: leafBlade([b[0] + lean * 0.9, b[1] + h * 0.68, z], [lean - 0.55, 0.6, -0.12], [0, 0.2, 1], h * 0.3, 0.035), color: 0x5b8a42 });
  }

  // Block 4: rubble in the valley the erosion has cut, and a few tufts that took hold.
  const topAt = (k, xb, z) => Y0 + TOP[k](xb, z);
  for (let i = 0; i < 34; i++) {
    const z = mix(-1.25, 1.2, rng()); const xb = 0.45 + z * 0.16 + (rng() - 0.5) * 1.05;
    const r = 0.04 + rng() ** 2 * 0.12;
    const g = grainy(new THREE.IcosahedronGeometry(r, 1), 200 + i, 0.2);
    g.scale(1.15, 0.72, 0.95);
    g.translate(X(3) + xb, topAt(3, xb, z) + r * 0.25, z);
    const L = FOSSIL_LAYERS[Math.floor(rng() * FOSSIL_LAYERS.length)].c;
    props.push({ geometry: g, color: new THREE.Color().setRGB(L[0] / 255, L[1] / 255, L[2] / 255, THREE.SRGBColorSpace).getHex() });
  }

  // Grass, on the land blocks only.
  const gp = []; const gc = [];
  const bladeC = [lin(0x2f5420), lin(0x7a9845)];
  const tuft = (k, xb, z, nb, hh) => {
    const y = topAt(k, xb, z);
    for (let q = 0; q < nb; q++) {
      const ox = X(k) + xb + (rng() - 0.5) * 0.12; const oz = z + (rng() - 0.5) * 0.12;
      const a = rng() * TAU; const h = hh * (0.6 + rng() * 0.7); const w = 0.012 + rng() * 0.006;
      const la = rng() * TAU; const l = h * 0.3;
      const tip = [ox + Math.cos(la) * l, y + h, oz + Math.sin(la) * l];
      const b = [0, 1, 2].map((m) => [ox + Math.cos(a + (m * TAU) / 3) * w, y - 0.02, oz + Math.sin(a + (m * TAU) / 3) * w]);
      for (const [m, o] of [[0, 2], [2, 1], [1, 0]]) { gp.push(...b[m], ...b[o], ...tip); gc.push(...bladeC[0], ...bladeC[0], ...bladeC[1]); }
    }
  };
  for (let i = 0; i < 70; i++) tuft(2, mix(-1.85, 1.85, rng()), mix(-1.25, 1.25, rng()), 7, 0.22);
  for (let i = 0; i < 20; i++) { const xb = mix(-1.85, 1.85, rng()); if (Math.abs(xb - 0.45) > 0.7) tuft(3, xb, mix(-1.25, 1.25, rng()), 6, 0.2); }
  for (let i = 0; i < 44; i++) tuft(4, mix(-1.85, 1.85, rng()), mix(-1.3, 0.1, rng()), 7, 0.24);
  const tuftGeo = new THREE.BufferGeometry();
  tuftGeo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  tuftGeo.setAttribute('color', new THREE.Float32BufferAttribute(gc, 3));
  const gn = new Float32Array(gp.length); for (let i = 1; i < gn.length; i += 3) gn[i] = 1;
  tuftGeo.setAttribute('normal', new THREE.BufferAttribute(gn, 3));
  props.push({ geometry: tuftGeo, keepColor: true });

  // Block 5: the fossil itself, every bone from the same table, standing a little proud of the rock
  // as it does once a collector has cleaned it, and the tools that did it.
  {
    const th = fishTheta(4); const c = Math.cos(th); const sn = Math.sin(th);
    const W = (fx, fy, lift = 0.012) => [X(4) + fx * c - fy * sn, Y0 + CY[4] + fx * sn + fy * c, HZ + lift];
    const BONE = 0x2a2019;
    const boneTube = (pts, w) => {
      props.push({ geometry: tube(pts.map(([a, b]) => W(a, b)), w * 0.6, { sides: 5, steps: Math.max(2, (pts.length - 1) * 2), round: 1, straight: pts.length === 2 }), color: BONE });
    };
    for (const q of S.lines) boneTube(q.pts, q.w);
    for (const q of S.skull) boneTube(q.pts, q.w);
    for (const v of S.verts) {
      const g = new THREE.SphereGeometry(v.r, 8, 6);
      g.scale(1.1, 1.1, 0.7);
      const a = W(v.x, v.y);
      g.translate(a[0], a[1], a[2]);
      props.push({ geometry: g, color: BONE });
    }
    const orbit = [];
    for (let i = 0; i <= 14; i++) { const a = (i / 14) * TAU; orbit.push([S.orbit.x + Math.cos(a) * S.orbit.r, S.orbit.y + Math.sin(a) * S.orbit.r]); }
    boneTube(orbit, 0.022);

    // The hammer and brush lie on the hillside, just above the fish.
    const k = 4;
    const surf = (xb, z, lift) => [X(k) + xb, topAt(k, xb, z) + lift, z];
    const hA = surf(0.58, 0.98, 0.05); const hB = surf(-0.42, 0.62, 0.05);
    props.push({ geometry: rod(hA, hB, 0.034, 8, 1), color: 0x24588f });
    props.push({ geometry: rod(surf(0.58, 0.98, 0.05), surf(0.02, 0.78, 0.05), 0.044, 8, 1), color: 0x1b4170 });
    // The head, across the end of the handle: a square face on one side, a pick on the other.
    const along = new THREE.Vector3(hB[0] - hA[0], hB[1] - hA[1], hB[2] - hA[2]).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const across = new THREE.Vector3().crossVectors(up, along).normalize();
    const hc = new THREE.Vector3(hB[0], hB[1], hB[2]).addScaledVector(along, 0.03);
    const sideA = hc.clone().addScaledVector(across, 0.22); const sideB = hc.clone().addScaledVector(across, -0.36);
    props.push({ geometry: beam(hc.toArray(), sideA.toArray(), 0.1, 0.1, [0, 1, 0]), color: 0x7f8a90 });
    props.push({ geometry: tube([hc.toArray(), hc.clone().addScaledVector(across, -0.18).toArray(), sideB.toArray()], [0.05, 0.036, 0.003], { sides: 6, steps: 6, round: 0 }), color: 0x7f8a90 });
    props.push({ geometry: beam(sideA.toArray(), sideA.clone().addScaledVector(across, 0.02).toArray(), 0.13, 0.13, [0, 1, 0]), color: 0x949fa5 });
    // The brush: a wooden handle, a ferrule and a flat of bristles.
    const bA = surf(1.32, 0.9, 0.035); const bB = surf(0.86, 0.72, 0.035); const bC = surf(0.76, 0.68, 0.035); const bD = surf(0.56, 0.6, 0.03);
    props.push({ geometry: rod(bA, bB, [0.018, 0.03], 8, 1), color: 0xa2743e });
    props.push({ geometry: rod(bB, bC, [0.034, 0.042], 8, 0), color: 0xb9a15a });
    const bdir = new THREE.Vector3(bD[0] - bC[0], bD[1] - bC[1], bD[2] - bC[2]).normalize();
    const bside = new THREE.Vector3().crossVectors(up, bdir).normalize();
    for (let q = -3; q <= 3; q++) {
      const off = q * 0.016;
      const a = new THREE.Vector3(...bC).addScaledVector(bside, off); const e = new THREE.Vector3(...bD).addScaledVector(bside, off * 1.15);
      props.push({ geometry: rod(a.toArray(), e.toArray(), [0.012, 0.004], 4, 0), color: 0xe2d3a6 });
    }
    // Chips of the rock that came off the fish, lying below it on the face's foot.
    for (let i = 0; i < 16; i++) {
      const xb = mix(-1.6, 1.8, rng()); const z = mix(HZ + 0.05, HZ + 0.62, rng());
      const r = 0.03 + rng() ** 2 * 0.06;
      const g = grainy(new THREE.IcosahedronGeometry(r, 0), 300 + i, 0.2);
      g.translate(X(4) + xb, Y0 + r * 0.6, z);
      const L = FOSSIL_LAYERS[5].c;
      props.push({ geometry: g, color: new THREE.Color().setRGB(L[0] / 255, L[1] / 255, L[2] / 255, THREE.SRGBColorSpace).getHex() });
    }
  }
  root.add(mesh(mergeParts(props), standard({ vertexColors: true, roughness: 0.74, metalness: 0.06 })));

  // The river, a clear slab with a gently moving-looking top, and the fish inside it.
  const waterTop = Y0 + 3.72;
  const water = gridSolid(40, 18,
    (i, j) => { const x = mix(X(0) - HALF, X(0) + HALF, i / 40); const z = mix(-HZ, HZ, j / 18); return [x, waterTop + 0.03 * Math.sin(x * 3 + z * 2) + 0.015 * Math.sin(x * 7 - z * 5), z]; },
    (i, j) => { const x = mix(X(0) - HALF, X(0) + HALF, i / 40); const z = mix(-HZ, HZ, j / 18); return [x, Y0 + bedY(0) - 0.06, z]; },
    { crease: 40 });
  const waterMesh = mesh(water, standard({ color: 0x3f9fce, transparent: true, opacity: 0.32, roughness: 0.2, metalness: 0, depthWrite: false }));
  waterMesh.castShadow = false;
  waterMesh.receiveShadow = false;
  root.add(waterMesh);

  // The plates: a numbered tile on each block's face, and a caption for each on the plinth.
  const CAPS = [
    ['1. A fish dies', 'It sinks to the river bed,', 'whole, under shallow water.'],
    ['2. Quick burial', 'Sand and mud bury it. The soft', 'parts rot and the skeleton stays.'],
    ['3. Deeper, and turned to rock', 'More layers pile on. Minerals replace', 'the bones, and the sediment turns to rock.'],
    ['4. Lifted and worn', 'The rock is lifted and tilted,', 'and erosion wears the top away.'],
    ['5. Exposed and found', 'The fossil comes to the surface', 'of a hillside, and someone finds it.'],
  ];
  const entries = [
    ...CAPS.map((lines) => ({ lines, w: 3.9, h: 0.78 })),
    ...[1, 2, 3, 4, 5].map((nb) => ({
      w: 0.52, h: 0.52,
      draw: (ctx, x, y, w, h) => {
        ctx.fillStyle = '#1b2733'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#e8dcb8'; ctx.lineWidth = 3; ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
        ctx.fillStyle = '#f5ecd2'; ctx.font = `800 ${h * 0.72}px ${FONT}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(nb), x + w / 2, y + h * 0.54);
      },
    })),
  ];
  const atlas = plateAtlas(entries, 150, 1024, () => ({ ground: '#f1e9d0', ink: '#16130d', edge: '#6f6243', big: 0.42 }));
  const printed = [];
  CAPS.forEach((_, k) => {
    const g = printedPlate(3.9, 0.78, 0.03, atlas.uv(k));
    g.rotateX(-0.82);
    g.translate(X(k), Y0 + 0.2, HZ + 0.6);
    printed.push({ geometry: g, keepColor: true });
    const nb = printedPlate(0.52, 0.52, 0.03, atlas.uv(5 + k));
    nb.translate(X(k) + HALF - 0.36, Y0 + 0.62, HZ + 0.018);
    printed.push({ geometry: nb, keepColor: true });
  });
  root.add(mesh(mergeParts(printed), standard({ map: atlas.map, roughness: 0.65, metalness: 0 })));
  return root;
}

export const BUILDERS = {
  seismograph: () => buildSeismograph(),
  'weather-station': () => buildWeatherStation(),
  'soil-profile': () => buildSoilProfile(),
  'ocean-zones': () => buildOceanZones(),
  'fossil-formation': () => buildFossilFormation(),
};
