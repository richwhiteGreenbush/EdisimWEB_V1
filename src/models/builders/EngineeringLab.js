import * as THREE from 'three';
import { toCreasedNormals, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, standard, canvasTexture, seededRandom, relief } from '../../PropKit.js';
import { mergeParts, gearWheel, gearOutline } from '../../props/LoftKit.js';
import { tube, lin, clamp01, mix, sstep, alongMatrix } from '../ModelKit.js';
import { terrainBlock, Batch, addBroadleaf, fbm, noise2, pathDistance, smoothPath, sampledField, rgb, mixc } from '../geo/GeoKit.js';
import { reducedMotion } from '../../Settings.js';

// The Model Database's engineering bench: a four-stroke engine, Babbage's Difference Engine, four
// kinds of bridge, the Pont du Gard and the Ziggurat of Ur. Authored in feet, origin at the base
// centre, front toward +Z. The rules a model teaches are computed here and exported below, so that a
// script can hold them to the rule: the slider-crank, the valve timing, the method of differences.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const FONT = 'Arial, Helvetica, sans-serif';

// ---------------------------------------------------------------------------------------------
// Solids. Everything hard-edged here is a soup of triangles given creased normals.
// ---------------------------------------------------------------------------------------------
function soup(pos, uv, crease = 30) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return toCreasedNormals(g, crease * DEG);
}

const polyArea = (p) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i]; const [x1, y1] = p[(i + 1) % p.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
};

// Triangles covering an outline with holes, every one of them counter-clockwise.
function capTris(outer, holes) {
  const faces = THREE.ShapeUtils.triangulateShape(outer.map(([x, y]) => new THREE.Vector2(x, y)), holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y))));
  const all = [...outer, ...holes.flat()];
  return faces.map(([a, b, c]) => {
    const A = all[a]; const B = all[b]; const C = all[c];
    return (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]) >= 0 ? [A, B, C] : [A, C, B];
  });
}

// A closed outline extruded along Z, from z0 up to z1. Any outline, concave or with holes, since a
// fan from a centroid cannot cap a comb of cooling fins. UVs are in feet.
function prism(outline, z0, z1, { holes = [], front = true, back = true, crease = 32 } = {}) {
  const outer = polyArea(outline) > 0 ? outline : [...outline].reverse();
  const hs = holes.map((h) => (polyArea(h) < 0 ? h : [...h].reverse()));
  const pos = []; const uv = [];
  const put = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u, v); };
  for (const loop of [outer, ...hs]) {
    let run = 0;
    for (let i = 0; i < loop.length; i++) {
      const [ax, ay] = loop[i]; const [bx, by] = loop[(i + 1) % loop.length];
      const l = Math.hypot(bx - ax, by - ay);
      put(ax, ay, z0, run, z0); put(bx, by, z0, run + l, z0); put(bx, by, z1, run + l, z1);
      put(ax, ay, z0, run, z0); put(bx, by, z1, run + l, z1); put(ax, ay, z1, run, z1);
      run += l;
    }
  }
  if (front || back) {
    for (const [A, B, C] of capTris(outer, hs)) {
      if (front) { put(A[0], A[1], z1, A[0], A[1]); put(B[0], B[1], z1, B[0], B[1]); put(C[0], C[1], z1, C[0], C[1]); }
      if (back) { put(A[0], A[1], z0, A[0], A[1]); put(C[0], C[1], z0, C[0], C[1]); put(B[0], B[1], z0, B[0], B[1]); }
    }
  }
  return soup(pos, uv, crease);
}

// A surface of revolution about +Y from a profile [r, y]. Walk the profile counter-clockwise in the
// (r, y) plane, so bottom-up along the outside, and every face comes out facing away from the
// material. Edges lying on the axis are dropped. A sweep under a full turn is left open at its two
// ends, for a cut face to close.
function lathed(profile, segments, { start = 0, sweep = TAU, crease = 32, closed = false } = {}) {
  const pos = []; const uv = [];
  const n = profile.length;
  const last = closed ? n : n - 1;
  let run = 0;
  for (let i = 0; i < last; i++) {
    const [r0, y0] = profile[i]; const [r1, y1] = profile[(i + 1) % n];
    const l = Math.hypot(r1 - r0, y1 - y0);
    if (r0 < 1e-5 && r1 < 1e-5) { run += l; continue; }
    const rm = Math.max(r0, r1);
    for (let j = 0; j < segments; j++) {
      const a0 = start + (j / segments) * sweep; const a1 = start + ((j + 1) / segments) * sweep;
      const A = [r0 * Math.sin(a0), y0, r0 * Math.cos(a0), a0 * rm, run];
      const B = [r0 * Math.sin(a1), y0, r0 * Math.cos(a1), a1 * rm, run];
      const C = [r1 * Math.sin(a1), y1, r1 * Math.cos(a1), a1 * rm, run + l];
      const D = [r1 * Math.sin(a0), y1, r1 * Math.cos(a0), a0 * rm, run + l];
      const tri = (p, q, s) => { for (const v of [p, q, s]) { pos.push(v[0], v[1], v[2]); uv.push(v[3], v[4]); } };
      if (r0 > 1e-5) tri(A, B, C);
      if (r1 > 1e-5) tri(A, C, D);
    }
    run += l;
  }
  return soup(pos, uv, crease);
}
const axisZ = (g) => { g.rotateX(Math.PI / 2); return g; };
const axisX = (g) => { g.rotateZ(-Math.PI / 2); return g; };

function block(x0, y0, z0, x1, y1, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}
// A box whose UVs are in feet, for anything carrying a tiled map: a BoxGeometry stretches the tile
// once across every face, which turns a long wall of brick into planks.
function feetBlock(x0, y0, z0, x1, y1, z1) {
  if (x1 - x0 >= z1 - z0) return prism([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1, { crease: 30 });
  const g = prism([[z0, y0], [z1, y0], [z1, y1], [z0, y1]], -x1, -x0, { crease: 30 });
  g.rotateY(-Math.PI / 2);
  return g;
}
const rod = (a, b, r, sides = 10, round = 1) => tube([a, b], r, { straight: true, steps: 1, sides, round });
function ball(r, at, detail = 14) {
  const g = new THREE.SphereGeometry(r, detail, Math.max(6, Math.round(detail * 0.66)));
  g.translate(at[0], at[1], at[2]);
  return g;
}
const arcPts = (cx, cy, r, a0, a1, n) => {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
};
const mirrorOutline = (p) => p.map(([x, y]) => [-x, y]).reverse();

// The convex hull of a set of [x, y], counter-clockwise.
function hull2(points) {
  const P = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of P) { while (lower.length > 1 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (const p of [...P].reverse()) { while (upper.length > 1 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
}

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

function fitFont(ctx, text, maxWidth, size, weight = '700', family = FONT) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  const width = ctx.measureText(text).width;
  if (width > maxWidth) { s = (s * maxWidth) / width; ctx.font = `${weight} ${s}px ${family}`; }
  return s;
}
const noShadow = (m) => { m.castShadow = false; m.receiveShadow = false; return m; };

// ---------------------------------------------------------------------------------------------
// Rigid parts in one mesh. A machine with nine moving parts cannot spend nine draw calls, so the
// parts share a mesh and each frame's transforms are written into its vertices. Positions and normals
// only, which is what the HiFi bridge re-uploads: it does not follow a UV rewrite.
// ---------------------------------------------------------------------------------------------
class RigidSkin {
  constructor() { this.items = []; this.ranges = new Map(); }

  add(name, geometry, color = null) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const n = g.attributes.position.count;
    if (color !== null) {
      const c = new THREE.Color(color);
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(key)) g.deleteAttribute(key);
    g = mergeVertices(g, 1e-5);
    this.items.push({ name, g });
    return this;
  }

  build(material, sphere) {
    let vCount = 0; let iCount = 0;
    for (const { g } of this.items) { vCount += g.attributes.position.count; iCount += g.index.count; }
    const P = new Float32Array(vCount * 3); const N = new Float32Array(vCount * 3);
    const C = new Float32Array(vCount * 3); const U = new Float32Array(vCount * 2);
    const I = new Uint32Array(iCount);
    let v = 0; let at = 0;
    for (const { name, g } of this.items) {
      const count = g.attributes.position.count;
      P.set(g.attributes.position.array, v * 3);
      N.set(g.attributes.normal.array, v * 3);
      C.set(g.attributes.color.array, v * 3);
      U.set(g.attributes.uv.array, v * 2);
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i++) I[at + i] = idx[i] + v;
      at += idx.length;
      if (!this.ranges.has(name)) this.ranges.set(name, []);
      this.ranges.get(name).push([v, count]);
      v += count;
    }
    this.restP = P.slice(); this.restN = N.slice();
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(I, 1));
    this.pos = new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage);
    this.nrm = new THREE.BufferAttribute(N, 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.pos);
    geometry.setAttribute('normal', this.nrm);
    geometry.setAttribute('color', new THREE.BufferAttribute(C, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    geometry.boundingSphere = sphere;
    this.mesh = mesh(geometry, material);
    return this.mesh;
  }

  // Writes one named part at a matrix. A scale along an axis is allowed, which a spring needs.
  set(name, m) {
    const e = m.elements;
    const P = this.pos.array; const N = this.nrm.array; const rp = this.restP; const rn = this.restN;
    // The inverse transpose, up to a factor, is the cofactor matrix.
    const a = e[0]; const b = e[4]; const c = e[8]; const d = e[1]; const f = e[5]; const g = e[9]; const h = e[2]; const i2 = e[6]; const j = e[10];
    const c00 = f * j - g * i2; const c01 = g * h - d * j; const c02 = d * i2 - f * h;
    const c10 = c * i2 - b * j; const c11 = a * j - c * h; const c12 = b * h - a * i2;
    const c20 = b * g - c * f; const c21 = c * d - a * g; const c22 = a * f - b * d;
    for (const [start, count] of this.ranges.get(name)) {
      for (let k = start; k < start + count; k++) {
        const o = k * 3;
        const x = rp[o]; const y = rp[o + 1]; const z = rp[o + 2];
        P[o] = a * x + b * y + c * z + e[12];
        P[o + 1] = d * x + f * y + g * z + e[13];
        P[o + 2] = h * x + i2 * y + j * z + e[14];
        const nx = rn[o]; const ny = rn[o + 1]; const nz = rn[o + 2];
        const qx = c00 * nx + c10 * ny + c20 * nz;
        const qy = c01 * nx + c11 * ny + c21 * nz;
        const qz = c02 * nx + c12 * ny + c22 * nz;
        const l = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1;
        N[o] = qx / l; N[o + 1] = qy / l; N[o + 2] = qz / l;
      }
    }
  }

  commit() { this.pos.needsUpdate = true; this.nrm.needsUpdate = true; }
}

// ===========================================================================================
// THE FOUR-STROKE ENGINE
// ===========================================================================================
//
// Cut in half down the plane z = 0. Everything that stands still and everything that holds a surface
// a part runs against is cut, with the cut painted as a machined section. The rod, the crank, the
// cams and the valves are left whole in front of the cut, since they are what is being watched.
//
// The crank axis runs along Z, so the crank, the rod and the cam lobes all turn in the plane being
// looked at. A cam's profile is worked out backward from the lift it has to give, with a small round
// follower, so a valve touches its lobe at every instant, and the 180 degree opening the card's four
// strokes need is exactly what the lobe delivers.

const ENG = {
  BASE: 0.36,
  C: 1.78, R: 0.62, L: 2.02,
  PIN_TO_CROWN: 0.42, SKIRT: 0.38, BORE: 0.72,
  DECK: 4.96, APEX: 5.24, HEAD_TOP: 5.74, COVER_TOP: 7.16, HALF: 1.6, DEPTH: 1.2,
  VALVE_X: 0.36, SEAT: 0.27, LIFT: 0.17, TIP_S: 1.24, RETAINER_S: 1.1,
  CAM_RB: 0.26, FOLLOWER: 0.06,
  PERIOD: 6, START: 400,
};
const ROOF = Math.atan2(ENG.APEX - ENG.DECK, ENG.BORE);
const VAXIS = [Math.sin(ROOF), Math.cos(ROOF)];
const VHEAD_Y = ENG.APEX - Math.tan(ROOF) * ENG.VALVE_X;
const CAM_S = ENG.TIP_S + ENG.CAM_RB + ENG.FOLLOWER;
const SPRING_S = (ENG.HEAD_TOP - VHEAD_Y) / VAXIS[1];

const wrap720 = (t) => ((t % 720) + 720) % 720;

// A table a script can hold to the rule. Angles are crank degrees, 0 at the top of the intake stroke.
export const ENGINE = {
  ...ENG,
  STROKES: ['INTAKE', 'COMPRESSION', 'POWER', 'EXHAUST'],
  CAM_POS: [VAXIS[0] * CAM_S + ENG.VALVE_X, VHEAD_Y + VAXIS[1] * CAM_S],
  crankPin(theta) { const a = theta * DEG; return [ENG.R * Math.sin(a), ENG.C + ENG.R * Math.cos(a)]; },
  pistonPinY(theta) { const a = theta * DEG; const s = ENG.R * Math.sin(a); return ENG.C + ENG.R * Math.cos(a) + Math.sqrt(ENG.L * ENG.L - s * s); },
  crownY(theta) { return ENGINE.pistonPinY(theta) + ENG.PIN_TO_CROWN; },
  rodAngle(theta) { return Math.asin((ENG.R / ENG.L) * Math.sin(theta * DEG)); },
  stroke(theta) { return Math.floor(wrap720(theta) / 180); },
  // A cam turns at half the crank's speed, so 180 crank degrees of opening is 90 cam degrees.
  lobeLift(camDeg) { const g = Math.abs(camDeg); return g >= 45 ? 0 : ENG.LIFT * Math.cos(2 * g * DEG) ** 2; },
  camFromNose(theta, noseAt) { let d = wrap720(theta - noseAt); if (d > 360) d -= 720; return d / 2; },
  intakeLift(theta) { return ENGINE.lobeLift(ENGINE.camFromNose(theta, 90)); },
  exhaustLift(theta) { return ENGINE.lobeLift(ENGINE.camFromNose(theta, 630)); },
};

function camOutline() {
  const R0 = ENG.CAM_RB + ENG.FOLLOWER;
  const pitch = (g) => { const r = R0 + ENGINE.lobeLift(g / DEG); return [Math.sin(g) * r, -Math.cos(g) * r]; };
  const n = 120;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const g = (i / n) * TAU;
    const p = pitch(g);
    const a = pitch(g - 0.002); const b = pitch(g + 0.002);
    const tx = b[0] - a[0]; const ty = b[1] - a[1];
    const l = Math.hypot(tx, ty);
    // Going round this way the outside is on the right of the direction of travel.
    let nx = ty / l; let ny = -tx / l;
    if (nx * p[0] + ny * p[1] < 0) { nx = -nx; ny = -ny; }
    pts.push([p[0] - nx * ENG.FOLLOWER, p[1] - ny * ENG.FOLLOWER]);
  }
  return pts;
}

function engineFacePainter(ctx, W, H) {
  // The cut: machined steel with a drawing's section hatching.
  const fw = W / 2;
  ctx.fillStyle = '#c6ccd2';
  ctx.fillRect(0, 0, fw, H);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, fw, H); ctx.clip();
  ctx.strokeStyle = 'rgba(70,80,92,0.5)';
  ctx.lineWidth = 3;
  for (let i = -H; i < fw + H; i += 26) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke(); }
  ctx.restore();

  // The strokes plate.
  const px = fw; const py = 0; const pw = W * 0.34; const ph = H * 0.6;
  ctx.fillStyle = '#f0ece0';
  ctx.fillRect(px, py, pw, ph);
  ctx.fillStyle = '#23272c';
  ctx.textBaseline = 'middle';
  const rows = [
    { n: '1', title: 'INTAKE', body: ['Piston goes down.', 'Intake valve open.', 'Fuel and air come in.'], chip: '#5ea9f2' },
    { n: '2', title: 'COMPRESSION', body: ['Piston goes up.', 'Both valves shut.', 'The mixture is squeezed.'], chip: '#2f72d8' },
    { n: '3', title: 'POWER', body: ['A spark lights it.', 'Both valves shut.', 'Burning gas pushes down.'], chip: '#ff8a1e' },
    { n: '4', title: 'EXHAUST', body: ['Piston goes up.', 'Exhaust valve open.', 'Burnt gas goes out.'], chip: '#9a9b9c' },
  ];
  const rowH = ph / 4;
  const rail = pw * 0.15;
  rows.forEach((r, i) => {
    const y = py + i * rowH;
    if (i) { ctx.fillStyle = '#b9b3a2'; ctx.fillRect(px + rail, y - 2, pw - rail, 4); }
    ctx.fillStyle = r.chip;
    ctx.fillRect(px + rail, y + 6, pw * 0.05, rowH - 12);
    ctx.fillStyle = '#20242a';
    ctx.textAlign = 'left';
    const tx = px + rail + pw * 0.075;
    const maxW = pw - rail - pw * 0.1;
    fitFont(ctx, `${r.n}. ${r.title}`, maxW, 62, '800');
    ctx.fillText(`${r.n}. ${r.title}`, tx, y + rowH * 0.22);
    ctx.fillStyle = '#3b3f45';
    let fs = 44;
    for (const line of r.body) { ctx.font = `600 ${fs}px ${FONT}`; const w = ctx.measureText(line).width; if (w > maxW) fs = (fs * maxW) / w; }
    ctx.font = `600 ${fs}px ${FONT}`;
    r.body.forEach((line, k) => ctx.fillText(line, tx, y + rowH * (0.46 + k * 0.19)));
  });
  ctx.fillStyle = '#20242a';
  ctx.fillRect(px + rail * 0.42, py + 8, 7, ph - 16);

  // The parts board. Each name stands at the height of its part.
  const bx = W * 0.85; const bw = W * 0.15; const bh = H * 0.6;
  ctx.fillStyle = '#2a3036';
  ctx.fillRect(bx, 0, bw, bh);
  for (const [name, y] of ENGINE_PARTS) {
    const cy = ((PARTS_TOP - y) / (PARTS_TOP - PARTS_BOTTOM)) * bh;
    ctx.fillStyle = '#f0ece0';
    ctx.textAlign = 'left';
    ctx.font = `800 ${PART_FONT}px ${FONT}`;
    let font = PART_FONT;
    const lines = name.split('|');
    for (const line of lines) { const w = ctx.measureText(line).width; if (w > bw * 0.76) font = Math.min(font, (PART_FONT * bw * 0.76) / w); }
    ctx.font = `800 ${font}px ${FONT}`;
    lines.forEach((line, k) => ctx.fillText(line, bx + 12, cy + (k - (lines.length - 1) / 2) * font * 1.1));
    ctx.fillStyle = '#f2b632';
    ctx.beginPath();
    ctx.moveTo(bx + bw - 4, cy);
    ctx.lineTo(bx + bw - 34, cy - 18);
    ctx.lineTo(bx + bw - 34, cy + 18);
    ctx.closePath();
    ctx.fill();
  }

  // The title plate.
  const ty = H * 0.6; const tw = fw; const th = H * 0.2;
  ctx.fillStyle = '#2a3036';
  ctx.fillRect(fw, ty, tw, th);
  ctx.fillStyle = '#f0ece0';
  ctx.textAlign = 'center';
  fitFont(ctx, 'FOUR-STROKE ENGINE', tw * 0.9, 96, '800');
  ctx.fillText('FOUR-STROKE ENGINE', fw + tw / 2, ty + th * 0.34);
  ctx.fillStyle = '#e8c56a';
  fitFont(ctx, 'The crank turns twice for one set of four strokes', tw * 0.92, 50, '700');
  ctx.fillText('The crank turns twice for one set of four strokes', fw + tw / 2, ty + th * 0.72);
}
const PARTS_TOP = 7.0; const PARTS_BOTTOM = 0.95;
const PART_FONT = 40;
const ENGINE_PARTS = [
  ['CAMSHAFT', 6.55], ['SPARK|PLUG', 6.0], ['VALVES', 5.45], ['CYLINDER', 4.6], ['PISTON', 3.85], ['CONNECTING|ROD', 2.85], ['CRANKSHAFT', 1.78], ['FLYWHEEL|(BEHIND)', 1.2],
];

function buildFourStroke() {
  const E = ENG;
  const root = new THREE.Group();
  const body = [];
  const faces = [];
  const plates = [];
  const crankParts = [];
  const skin = new RigidSkin();

  const IRON = 0x585e65; const FIN = 0x8b9096; const ALLOY = 0xa4a9ae; const COVER = 0xa8342c;
  const LINER = 0xc9ced2; const BASE = 0x4a3323; const BASE_TOP = 0x6a4a31; const STEEL = 0xd9dcdf;
  const CREAM = 0xc4bda9; const ORANGE = 0xd9682a; const YELLOW = 0xe0b53a; const FLY = 0x4d5359;
  const INTAKE = 0x3f86dc; const EXHAUST = 0xb5562c;

  // The cut face: x, y in feet on to the left half of the atlas.
  const FX = 4.2; const FY = 8.4;
  const face = (outline, holes = []) => {
    const outer = polyArea(outline) > 0 ? outline : [...outline].reverse();
    const pos = []; const uv = [];
    for (const tri of capTris(outer, holes.map((h) => (polyArea(h) < 0 ? h : [...h].reverse())))) {
      for (const p of tri) { pos.push(p[0], p[1], 0); uv.push(((p[0] + FX / 2) / FX) * 0.5, p[1] / FY); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    faces.push({ geometry: g, color: 0xffffff });
  };

  // --- The base, with a slot for the flywheel ---
  const baseOutline = [[-4.0, 2.2], [4.0, 2.2], [4.0, -2.4], [-4.0, -2.4]].map(([x, z]) => [x, -z]);
  const slot = [[-1.95, -1.42], [1.95, -1.42], [1.95, -2.03], [-1.95, -2.03]].map(([x, z]) => [x, -z]);
  const baseG = prism(baseOutline, 0, E.BASE - 0.08, { holes: [slot] });
  baseG.rotateX(-Math.PI / 2);
  body.push({ geometry: baseG, color: BASE });
  const inset = [[-3.88, 2.08], [3.88, 2.08], [3.88, -2.28], [-3.88, -2.28]].map(([x, z]) => [x, -z]);
  const baseTop = prism(inset, E.BASE - 0.08, E.BASE, { holes: [slot] });
  baseTop.rotateX(-Math.PI / 2);
  body.push({ geometry: baseTop, color: BASE_TOP });

  // --- The crankcase, cut. A U in the cut plane, closed behind by its back wall ---
  const RO = 1.16; const RI = 0.96; const NECK_O = 0.98; const NECK_I = 0.78; const NECK_TOP = 2.84;
  const aOuter = Math.acos(NECK_O / RO);
  const aInner = Math.acos(NECK_I / RI);
  const outerPath = [[-NECK_O, NECK_TOP], ...arcPts(0, E.C, RO, Math.PI - aOuter, TAU + aOuter, 44).map((p) => p)];
  outerPath.push([NECK_O, NECK_TOP]);
  const innerPath = [[NECK_I, NECK_TOP], ...arcPts(0, E.C, RI, aInner, -Math.PI - aInner, 40), [-NECK_I, NECK_TOP]];
  const caseU = [...outerPath, ...innerPath];
  body.push({ geometry: prism(caseU, -E.DEPTH, 0, { front: false }), color: IRON });
  face(caseU);
  const caseFull = [...outerPath];
  body.push({ geometry: prism(caseFull, -E.DEPTH, -1.04), color: IRON });
  body.push({ geometry: prism(caseFull, -1.04, -1.02), color: CREAM });
  // Its feet.
  const foot = [[-1.5, E.BASE], [1.5, E.BASE], [1.5, E.BASE + 0.14], [0.95, E.BASE + 0.14], [0.72, E.C - 1.0], [-0.72, E.C - 1.0], [-0.95, E.BASE + 0.14], [-1.5, E.BASE + 0.14]];
  body.push({ geometry: prism(foot, -E.DEPTH, 0.0, { front: false }), color: IRON });
  face(foot);
  for (const x of [-1.25, 1.25]) {
    body.push({ geometry: lathed([[0.1, 0], [0.1, 0.05], [0, 0.05]], 6, { crease: 40 }).translate(x, E.BASE + 0.14, -0.55), color: STEEL });
  }

  // --- The cylinder: a finned half-turning round a pale liner ---
  const finProfile = [[0.76, NECK_TOP], [1.2, NECK_TOP], [1.2, 2.98], [0.92, 2.98]];
  const FINS = 10;
  const finStart = 3.08; const finPitch = 0.186; const finT = 0.09;
  for (let i = 0; i < FINS; i++) {
    const y = finStart + i * finPitch;
    finProfile.push([0.92, y], [1.18, y + 0.012], [1.18, y + finT - 0.012], [0.92, y + finT]);
  }
  finProfile.push([0.92, E.DECK], [0.76, E.DECK]);
  const sweepBack = { start: Math.PI / 2, sweep: Math.PI, closed: true };
  body.push({ geometry: lathed(finProfile, 56, sweepBack), color: FIN });
  face(finProfile);
  face(mirrorOutline(finProfile));
  const linerProfile = [[E.BORE, NECK_TOP - 0.04], [0.76, NECK_TOP - 0.04], [0.76, E.DECK], [E.BORE, E.DECK]];
  body.push({ geometry: lathed(linerProfile, 56, sweepBack), color: LINER });
  face(linerProfile);
  face(mirrorOutline(linerProfile));

  // --- The head: islands either side of the two ports and the chamber ---
  const H0 = E.DECK; const HT = E.HEAD_TOP; const HW = E.HALF;
  const seatDir = [Math.cos(ROOF), -Math.sin(ROOF)];
  const sOut = [E.VALVE_X + seatDir[0] * E.SEAT, VHEAD_Y + seatDir[1] * E.SEAT];
  const sIn = [E.VALVE_X - seatDir[0] * E.SEAT, VHEAD_Y - seatDir[1] * E.SEAT];
  const throatOut = [sOut[0] + VAXIS[0] * 0.12, sOut[1] + VAXIS[1] * 0.12];
  const throatIn = [sIn[0] + VAXIS[0] * 0.22, sIn[1] + VAXIS[1] * 0.22];
  const lowerR = [[E.BORE, H0], [HW, H0], [HW, 5.24], [0.86, 5.24], throatOut, sOut];
  const lowerL = mirrorOutline(lowerR);
  const upperHalf = [[HW, 5.56], [HW, HT]];
  const upper = [
    ...upperHalf, [-HW, HT], [-HW, 5.56], [-0.62, 5.6], [-0.32, 5.54], [-throatIn[0], throatIn[1]], [-sIn[0], sIn[1]], [0, E.APEX],
    sIn, throatIn, [0.32, 5.54], [0.62, 5.6],
  ];
  for (const outline of [lowerR, lowerL, upper]) {
    body.push({ geometry: prism(outline, -0.3, 0, { front: false, back: false }), color: ALLOY });
    face(outline);
  }
  const headRect = [[-HW, H0], [HW, H0], [HW, HT], [-HW, HT]];
  body.push({ geometry: prism(headRect, -E.DEPTH, -0.3), color: ALLOY });
  // The ports' back walls, dark and coloured for what runs through them.
  const portR = [[HW, 5.24], [HW, 5.56], [0.62, 5.6], [0.32, 5.54], throatIn, sIn, [0.06, 5.0], sOut, throatOut, [0.86, 5.24]];
  body.push({ geometry: prism(portR, -0.3, -0.29, { back: false }), color: 0x5a3c2c });
  body.push({ geometry: prism(mirrorOutline(portR), -0.3, -0.29, { back: false }), color: 0x2e4f7c });
  // Cooling ribs along the head's back and sides, and the stubs of the two pipes.
  for (const side of [-1, 1]) {
    const pipe = [[0.2, 0], [0.26, 0], [0.26, 0.08], [0.2, 0.08], [0.2, 0.36], [0.26, 0.36], [0.26, 0.42], [0.15, 0.42], [0.15, 0]];
    const half = lathed(pipe, 20, { start: Math.PI / 2, sweep: Math.PI, closed: true });
    if (side > 0) { axisX(half); half.translate(HW, 5.4, 0); } else {
      half.rotateZ(Math.PI / 2); half.translate(-HW, 5.4, 0);
    }
    body.push({ geometry: half, color: side > 0 ? EXHAUST : INTAKE });
    const xy = pipe.map(([r, y]) => [HW + y, 5.4 + r]);
    const xyD = pipe.map(([r, y]) => [HW + y, 5.4 - r]);
    for (const o of [xy, xyD]) face(side > 0 ? o : mirrorOutline(o));
  }

  // --- The cam box, cut, with a pale wall behind the cams ---
  const CT = E.COVER_TOP; const CH = 0.14;
  const cover = [[HW, HT], [HW, CT - 0.14], [HW - 0.14, CT], [-HW + 0.14, CT], [-HW, CT - 0.14], [-HW, HT], [-HW + CH, HT], [-HW + CH, CT - CH], [HW - CH, CT - CH], [HW - CH, HT]];
  body.push({ geometry: prism(cover, -0.6, 0, { front: false }), color: COVER });
  face(cover);
  const coverBack = [[HW, HT], [HW, CT - 0.14], [HW - 0.14, CT], [-HW + 0.14, CT], [-HW, CT - 0.14], [-HW, HT]];
  body.push({ geometry: prism(coverBack, -E.DEPTH, -0.6, { front: false }), color: COVER });
  const coverIn = [[-HW + CH, HT], [HW - CH, HT], [HW - CH, CT - CH], [-HW + CH, CT - CH]];
  body.push({ geometry: prism(coverIn, -0.62, -0.6), color: CREAM });

  // Valve guides, sunk into the head's top. Each valve's stem slides through one.
  for (const side of [-1, 1]) {
    const q = new THREE.Matrix4().makeRotationZ(-side * ROOF);
    const guide = lathed([[0.075, -0.1], [0.14, -0.1], [0.14, 0.02], [0.075, 0.02]], 16, { closed: true });
    guide.applyMatrix4(q);
    guide.translate(side * (E.VALVE_X + VAXIS[0] * SPRING_S), HT, 0);
    body.push({ geometry: guide, color: 0x70757c });
  }

  // --- The spark plug, enlarged with everything else, and its lead ---
  const plugY = E.APEX - 0.06;
  body.push({
    geometry: lathed([
      [0, plugY], [0.032, plugY], [0.032, plugY + 0.08], [0.09, plugY + 0.08], [0.1, plugY + 0.1], [0.1, 5.58],
      [0.16, 5.58], [0.16, HT + 0.02], [0.105, HT + 0.05], [0.09, HT + 0.12],
    ], 18), color: 0xb7bbc0,
  });
  const ceramic = [[0.09, HT + 0.1]];
  for (let i = 0; i < 6; i++) { const y = HT + 0.12 + i * 0.075; ceramic.push([0.082, y], [0.1, y + 0.022], [0.1, y + 0.04], [0.082, y + 0.062]); }
  const cerTop = HT + 0.12 + 6 * 0.075;
  ceramic.push([0.07, cerTop + 0.1], [0.04, cerTop + 0.14], [0.04, cerTop + 0.26], [0.058, cerTop + 0.28], [0.058, cerTop + 0.34], [0, cerTop + 0.36]);
  body.push({ geometry: lathed(ceramic, 18, { crease: 50 }), color: 0xe7e4dc });
  // The side electrode, a little hook under the centre one.
  body.push({ geometry: tube([[0.085, plugY + 0.08, 0], [0.085, plugY - 0.025, 0], [0.0, plugY - 0.045, 0]], 0.018, { sides: 6, steps: 6, round: 1 }), color: 0xb7bbc0 });
  body.push({ geometry: tube([[0, cerTop + 0.3, 0], [0, CT - 0.3, -0.02], [0, CT + 0.1, -0.25], [0, CT + 0.1, -0.8], [0, CT - 0.2, -1.1]], 0.04, { sides: 8, steps: 22, round: 1 }), color: 0x20242a });

  // --- The timing belt on the back: one description of three wheels, a 2:1 ratio you can count ---
  const CAM_X = ENGINE.CAM_POS[0]; const CAM_Y = ENGINE.CAM_POS[1];
  const beltCircles = [[0, E.C, 0.3], [CAM_X, CAM_Y, 0.6], [-CAM_X, CAM_Y, 0.6]];
  const hullOf = (extra) => {
    const pts = [];
    for (const [x, y, r] of beltCircles) for (const p of arcPts(x, y, r + extra, 0, TAU * (47 / 48), 47)) pts.push(p);
    return hull2(pts);
  };
  body.push({ geometry: prism(hullOf(0.055), -1.41, -1.27, { holes: [hullOf(0.0)] }), color: 0x24262a });

  // Two bars carry the cams' far ends and the crank's, from the back of the block.
  for (const x of [-CAM_X, CAM_X]) body.push({ geometry: rod([x, CAM_Y, -E.DEPTH + 0.05], [x, CAM_Y, -1.26], 0.17, 16, 0), color: 0x70757c });

  // --- The boards ---
  const plateZ = 0.55;
  const atlasRect = (u0, v0, u1, v1) => [u0, 1 - v1, u1, 1 - v0];
  const STROKE_W = 1.85; const STROKE_H = 3.3; const STROKE_X = 2.95; const STROKE_C = 3.9;
  const strokeM = new THREE.Matrix4().compose(V(STROKE_X, STROKE_C, plateZ), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -10 * DEG), V(1, 1, 1));
  const strokePlate = printedPlate(STROKE_W, STROKE_H, 0.05, atlasRect(0.5, 0, 0.84, 0.6));
  strokePlate.applyMatrix4(strokeM);
  plates.push({ geometry: strokePlate, color: 0xffffff });
  for (const dx of [-0.6, 0.6]) {
    const p = new THREE.Vector3(dx, -STROKE_H / 2, -0.06).applyMatrix4(strokeM);
    body.push({ geometry: rod([p.x, E.BASE - 0.05, p.z], [p.x, p.y + 0.4, p.z], 0.05, 10, 0), color: 0x2b2f35 });
  }
  const PART_W = 1.3; const PARTS_H = PARTS_TOP - PARTS_BOTTOM; const PART_X = -2.78;
  const partsM = new THREE.Matrix4().compose(V(PART_X, (PARTS_TOP + PARTS_BOTTOM) / 2, plateZ), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), 10 * DEG), V(1, 1, 1));
  const partsPlate = printedPlate(PART_W, PARTS_H, 0.05, atlasRect(0.85, 0, 1, 0.6));
  partsPlate.applyMatrix4(partsM);
  plates.push({ geometry: partsPlate, color: 0xffffff });
  for (const dx of [-0.4, 0.4]) {
    const p = new THREE.Vector3(dx, -PARTS_H / 2, -0.06).applyMatrix4(partsM);
    body.push({ geometry: rod([p.x, E.BASE - 0.05, p.z], [p.x, p.y + 0.4, p.z], 0.05, 10, 0), color: 0x2b2f35 });
  }
  const titleM = new THREE.Matrix4().compose(V(0, E.BASE + 0.455, 1.572), new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -42 * DEG), V(1, 1, 1));
  const titlePlate = printedPlate(3.6, 1.0, 0.06, atlasRect(0.5, 0.6, 1, 0.8));
  titlePlate.applyMatrix4(titleM);
  plates.push({ geometry: titlePlate, color: 0xffffff });
  const wedge = prism([[1.2, E.BASE], [1.92, E.BASE], [1.92, E.BASE + 0.04], [1.2, E.BASE + 0.84]], -1.86, 1.86);
  wedge.rotateY(-Math.PI / 2);
  body.push({ geometry: wedge, color: 0x2a3036 });

  // --- What turns with the crank: web, counterweight, sprocket, flywheel. Local axis at the origin ---
  const R = E.R;
  const web = [...arcPts(0, 0, 0.85, 208 * DEG, 332 * DEG, 26), ...arcPts(0, R, 0.29, -8 * DEG, 188 * DEG, 18)];
  crankParts.push({ geometry: prism(web, -0.42, -0.16), color: ORANGE });
  crankParts.push({ geometry: axisZ(lathed([[0, -0.16], [0.26, -0.16], [0.26, -0.11], [0.2, -0.08], [0, -0.08]], 24)), color: 0xe6e8ea });
  crankParts.push({ geometry: rod([0, 0, -0.45], [0, 0, -1.92], 0.17, 16, 0), color: 0xb9bdc2 });
  crankParts.push({ geometry: rod([0, R, -0.3], [0, R, 0.1], 0.135, 18, 0), color: STEEL });
  crankParts.push({ geometry: axisZ(lathed([[0, 0.1], [0.18, 0.1], [0.18, 0.13], [0.14, 0.155], [0, 0.155]], 18)), color: 0xeef0f2, position: [0, R, 0] });
  const small = gearWheel(0.3, 14, 0.14);
  crankParts.push({ geometry: small, color: 0xc9ccd0, position: [0, 0, -1.34] });
  // The flywheel: a rim, a web with five windows, and a stripe to see it turn by.
  const FW = 1.7;
  const windows = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3;
    windows.push(arcPts(Math.cos(a) * 0.93, Math.sin(a) * 0.93, 0.37, 0, TAU * (23 / 24), 23));
  }
  crankParts.push({ geometry: prism(arcPts(0, 0, FW - 0.2, 0, TAU * (63 / 64), 63), -1.78, -1.68, { holes: windows }), color: FLY });
  crankParts.push({
    geometry: axisZ(lathed([[FW - 0.26, -1.92], [FW - 0.03, -1.92], [FW, -1.89], [FW, -1.58], [FW - 0.03, -1.55], [FW - 0.26, -1.55]], 80, { closed: true, crease: 40 })),
    color: 0x6d7379,
  });
  crankParts.push({ geometry: axisZ(lathed([[0, -1.96], [0.36, -1.96], [0.36, -1.5], [0, -1.5]], 28)), color: 0x6d7379 });
  crankParts.push({ geometry: axisZ(lathed([[0, -1.48], [0.24, -1.48], [0.24, -1.45], [0, -1.45]], 16)), color: 0xe6e8ea });
  const stripeA = 90 * DEG;
  const stripe = prism(arcPts(0, 0, FW + 0.008, stripeA - 0.14, stripeA + 0.14, 8).concat(arcPts(0, 0, FW - 0.26, stripeA + 0.14, stripeA - 0.14, 8)), -1.56, -1.53);
  crankParts.push({ geometry: stripe, color: 0xf2c531 });
  crankParts.push({ geometry: stripe.clone().translate(0, 0, -0.39), color: 0xf2c531 });
  for (let i = 0; i < 2; i++) {
    const a = stripeA + Math.PI * (i ? 0.5 : -0.5);
    crankParts.push({ geometry: prism(arcPts(0, 0, FW - 0.02, a - 0.05, a + 0.05, 3).concat(arcPts(0, 0, FW - 0.26, a + 0.05, a - 0.05, 3)), -1.56, -1.53), color: 0xece6d6 });
  }

  // --- The moving parts, each authored about its own origin ---
  const REDGE = E.BORE - 0.015;
  // The piston, cut: a crown and a skirt with grooves, and a ring in each groove.
  const crown = E.PIN_TO_CROWN; const skirt = -E.SKIRT;
  const groove = 0.64;
  const pistonP = [[0.61, skirt], [REDGE, skirt]];
  const ringYs = [0.33, 0.235, 0.14];
  for (let i = ringYs.length - 1; i >= 0; i--) { pistonP.push([REDGE, ringYs[i] - 0.03], [groove, ringYs[i] - 0.03], [groove, ringYs[i] + 0.03], [REDGE, ringYs[i] + 0.03]); }
  pistonP.push([REDGE, crown], [0, crown], [0, 0.2], [0.61, 0.2]);
  skin.add('piston', lathed(pistonP, 48, { ...sweepBack, closed: true }), 0x5f666e);
  // Its cut face. It is one solid across the middle, so one outline, in machined colour.
  // The outline runs up the right, then down the left, then along the underside to close.
  const pistonRight = pistonP.slice(0, -3);
  const pistonCut = [...pistonRight, ...mirrorOutline(pistonRight), [-0.61, 0.2], [0.61, 0.2]];
  skin.add('piston', prism(pistonCut, -0.001, 0, { back: false }), 0xeef1f4);
  for (const y of ringYs) {
    const ringP = [[groove, y - 0.026], [REDGE + 0.004, y - 0.026], [REDGE + 0.004, y + 0.026], [groove, y + 0.026]];
    skin.add('piston', lathed(ringP, 48, { ...sweepBack, closed: true }), 0x2c3036);
    for (const o of [ringP, mirrorOutline(ringP)]) skin.add('piston', prism(o, -0.001, 0, { back: false }), 0x3a3f46);
  }
  // The bosses that carry the pin, and the pin itself, left whole so it can be seen through the rod.
  skin.add('piston', rod([0, 0, -0.6], [0, 0, -0.16], 0.21, 20, 0), 0x8d939a);
  skin.add('piston', block(-0.21, 0, -0.6, 0.21, 0.25, -0.16), 0x8d939a);
  skin.add('piston', rod([0, 0, -0.5], [0, 0, 0.16], 0.1, 16, 0), 0xe9ebed);

  // The connecting rod: a real tapered I-beam, big end at the origin.
  const L = E.L;
  const rodBody = [
    [0.12, 0.25], [0.075, L - 0.14], [-0.075, L - 0.14], [-0.12, 0.25],
  ];
  skin.add('rod', prism(rodBody, -0.1, 0.1), YELLOW);
  skin.add('rod', prism([[0.075, 0.28], [0.045, L - 0.2], [-0.045, L - 0.2], [-0.075, 0.28]], -0.112, 0.112), 0xa67f22);
  skin.add('rod', prism(arcPts(0, 0, 0.29, 0, TAU * (31 / 32), 31), -0.11, 0.11), YELLOW);
  skin.add('rod', prism(arcPts(0, L, 0.2, 0, TAU * (23 / 24), 23), -0.1, 0.1), YELLOW);
  skin.add('rod', block(-0.36, -0.045, -0.115, 0.36, 0.045, 0.115), 0xc99e2f);
  for (const x of [-0.29, 0.29]) skin.add('rod', rod([x, -0.2, 0], [x, 0.2, 0], 0.045, 8, 0), 0x56595e);

  // A valve along its own +Y, its seat face at the origin.
  const valve = (name, color) => {
    skin.add(name, lathed([
      [0, 0], [E.SEAT - 0.01, 0], [E.SEAT, 0.015], [E.SEAT - 0.02, 0.04], [0.09, 0.13], [0.05, 0.2],
      [0.04, 0.26], [0.04, E.RETAINER_S - 0.02],
    ], 22, { crease: 60 }), color);
    skin.add(name, lathed([[0.04, E.RETAINER_S - 0.02], [0.17, E.RETAINER_S - 0.02], [0.17, E.RETAINER_S + 0.03], [0.05, E.RETAINER_S + 0.05], [0.04, E.TIP_S - 0.04], [0, E.TIP_S - 0.04]], 18), 0xcfd2d6);
    skin.add(name, ball(E.FOLLOWER, [0, E.TIP_S, 0]), 0xeef0f2);
  };
  valve('intake', INTAKE);
  valve('exhaust', EXHAUST);

  // A spring of unit length along +Y: the transform stretches it between its two seats.
  const springG = () => {
    const pts = [];
    const COILS = 5; const N = COILS * 14;
    for (let i = 0; i <= N; i++) {
      const t = i / N; const a = t * COILS * TAU;
      pts.push([Math.cos(a) * 0.125, 0.02 + t * 0.96, Math.sin(a) * 0.125]);
    }
    return tube(pts, 0.018, { sides: 6, steps: N, round: 0 });
  };
  skin.add('springI', springG(), 0x6fb56f);
  skin.add('springE', springG(), 0x6fb56f);

  // A cam with its nose along -Y, its bright end facing the viewer, and its sprocket out the back.
  const cam = (name, color) => {
    skin.add(name, prism(camOutline(), -0.2, 0.2, { crease: 50 }), 0xc9cdd2);
    skin.add(name, rod([0, 0, 0.1], [0, 0, -1.42], 0.11, 16, 0), 0x9ea3a9);
    skin.add(name, axisZ(lathed([[0, 0.2], [0.09, 0.2], [0.09, 0.215], [0, 0.215]], 14)), color);
    skin.add(name, axisZ(lathed([[0, 0.2], [0.055, 0.2], [0.055, 0.218], [0, 0.218]], 10)).translate(0, -0.27, 0), color);
    skin.add(name, gearWheel(0.6, 28, 0.14).translate(0, 0, -1.34), 0xc9ccd0);
    skin.add(name, axisZ(lathed([[0, -1.46], [0.17, -1.46], [0.17, -1.41], [0, -1.41]], 16)), 0x707479);
  };
  cam('camI', INTAKE);
  cam('camE', EXHAUST);

  // The pointer that runs down the strokes plate.
  skin.add('pointer', prism([[-0.2, 0.07], [0.02, 0], [-0.2, -0.07]], 0, 0.06, { crease: 40 }), 0xd8332a);

  // --- The meshes ---
  const face2 = canvasTexture(2048, 2048, engineFacePainter);
  // A canvas's first row is the top of the atlas: the cut face is painted on the whole left half, so
  // only the plate rectangles above need to mind which way up that is.
  face2.anisotropy = 8;
  const faceMesh = mesh(mergeParts([...faces, ...plates]), standard({ map: face2, roughness: 0.46, metalness: 0.08, vertexColors: true }));
  faceMesh.castShadow = false;
  root.add(faceMesh);
  root.add(mesh(mergeParts(body), standard({ vertexColors: true, roughness: 0.6, metalness: 0.12, ...relief('metal', { seed: 11, repeat: 0.8 }) })));
  const crankGroup = new THREE.Group();
  crankGroup.position.set(0, E.C, 0);
  // Built turned to the pose at t = 0, so that the group's rotation starts at zero and a box drawn
  // round the wheel is its true size rather than the box of a box turned 40 degrees.
  const crankG = mergeParts(crankParts);
  crankG.rotateZ(-E.START * DEG);
  crankGroup.add(mesh(crankG, standard({ vertexColors: true, roughness: 0.42, metalness: 0.2 })));
  root.add(crankGroup);
  const skinMesh = skin.build(standard({ vertexColors: true, roughness: 0.34, metalness: 0.2 }), new THREE.Sphere(V(0, 3.9, -0.3), 6.2));
  root.add(skinMesh);

  // The gas: a solid column behind the cut face. Only its bottom edge moves.
  const GZ0 = -0.28; const GZ1 = -0.02;
  const Y0 = 3.0;
  const gasG = prism([[-E.BORE - 0.01, Y0], [E.BORE + 0.01, Y0], [E.BORE + 0.01, E.DECK + 0.02], [0, E.APEX + 0.02], [-E.BORE - 0.01, E.DECK + 0.02]], GZ0, GZ1, { crease: 20 });
  const gasPos = gasG.attributes.position;
  gasG.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const gasBottom = [];
  for (let i = 0; i < gasPos.count; i++) if (Math.abs(gasPos.getY(i) - Y0) < 1e-4) gasBottom.push(i);
  gasG.boundingSphere = new THREE.Sphere(V(0, 4.3, -0.15), 1.6);
  // Hottest under the head, a little deeper at the piston.
  const gasCol = new Float32Array(gasPos.count * 3);
  for (let i = 0; i < gasPos.count; i++) {
    const k = mix(0.82, 1, clamp01((gasPos.getY(i) - Y0) / 2));
    gasCol[i * 3] = k; gasCol[i * 3 + 1] = k; gasCol[i * 3 + 2] = k;
  }
  gasG.setAttribute('color', new THREE.BufferAttribute(gasCol, 3));
  const gasMat = standard({ vertexColors: true, roughness: 0.85, metalness: 0, color: 0xff9020, emissive: 0x000000 });
  const gas = noShadow(mesh(gasG, gasMat));
  root.add(gas);

  // The spark, shown only for a moment at the top of the compression stroke.
  const sparkG = mergeParts([
    { geometry: ball(0.075, [0, plugY - 0.03, 0], 10), color: 0xfffbe0 },
    ...[0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * TAU + 0.26;
      return { geometry: rod([0, plugY - 0.03, 0.02], [Math.cos(a) * 0.2, plugY - 0.03 + Math.sin(a) * 0.2, 0.02], 0.016, 5, 0), color: 0xfff4b0 };
    }),
  ]);
  const spark = noShadow(mesh(sparkG, new THREE.MeshBasicMaterial({ vertexColors: true })));
  spark.visible = false;
  root.add(spark);

  // --- The pose, from the rule and from nothing else ---
  const m = new THREE.Matrix4(); const m2 = new THREE.Matrix4();
  const camPose = (name, side, theta, noseAt) => {
    const [cx, cy] = ENGINE.CAM_POS;
    const psi = side * -ROOF;
    const phi = ENGINE.camFromNose(theta, noseAt) * DEG;
    m.makeRotationZ(psi - phi).setPosition(side * cx, cy, 0);
    skin.set(name, m);
  };
  const valvePose = (name, spring, side, lift) => {
    const ax = side * VAXIS[0]; const ay = VAXIS[1];
    m.makeRotationZ(-side * ROOF).setPosition(side * E.VALVE_X - ax * lift, VHEAD_Y - ay * lift, 0);
    skin.set(name, m);
    const len = E.RETAINER_S - SPRING_S - lift;
    m2.makeScale(1, len, 1);
    m.makeRotationZ(-side * ROOF).setPosition(side * E.VALVE_X + ax * SPRING_S, VHEAD_Y + ay * SPRING_S, 0).multiply(m2);
    skin.set(spring, m);
  };
  const gasColor = new THREE.Color();
  const cA = new THREE.Color(); const cB = new THREE.Color();
  const blend = (a, b, t) => gasColor.copy(cA.setHex(a)).lerp(cB.setHex(b), clamp01(t));
  const setPose = (thetaIn) => {
    const theta = wrap720(thetaIn);
    crankGroup.rotation.z = -(theta - E.START) * DEG;
    const pinY = ENGINE.pistonPinY(theta);
    m.identity().setPosition(0, pinY, 0);
    skin.set('piston', m);
    const [px, py] = ENGINE.crankPin(theta);
    m.makeRotationZ(ENGINE.rodAngle(theta)).setPosition(px, py, 0);
    skin.set('rod', m);
    camPose('camI', -1, theta, 90);
    camPose('camE', 1, theta, 630);
    valvePose('intake', 'springI', -1, ENGINE.intakeLift(theta));
    valvePose('exhaust', 'springE', 1, ENGINE.exhaustLift(theta));
    // A red pointer sliding down the plate, one row per 180 degrees.
    m.makeTranslation(-STROKE_W / 2 + 0.25, STROKE_H / 2 - (theta / 720) * STROKE_H, 0.005);
    m.premultiply(strokeM);
    skin.set('pointer', m);
    skin.commit();
    // The gas column ends on the piston's crown.
    const crownY = pinY + E.PIN_TO_CROWN;
    for (const i of gasBottom) gasPos.setY(i, crownY);
    gasPos.needsUpdate = true;
    // Its colour: blue mixture, squeezed and deepening, a white flash, orange fading, then grey.
    let glow = 0.12;
    if (theta < 180) blend(0x74b6f4, 0x5ea9f2, theta / 180);
    else if (theta < 360) blend(0x5ea9f2, 0x2a6cd6, (theta - 180) / 180);
    else if (theta < 395) { blend(0xfff2b0, 0xff9a24, (theta - 360) / 35); glow = 0.7; } else if (theta < 540) { blend(0xff9a24, 0xd9581c, (theta - 395) / 145); glow = mix(0.42, 0.18, (theta - 395) / 145); } else if (theta < 570) blend(0xb3693c, 0x8f8f8d, (theta - 540) / 30);
    else blend(0x8f8f8d, 0xa8a8a6, (theta - 570) / 150);
    gasMat.color.copy(gasColor);
    gasMat.emissive.copy(gasColor).multiplyScalar(glow);
    spark.visible = theta >= 352 && theta < 374;
  };

  setPose(E.START);
  let t = 0;
  root.userData.tick = {
    update(dt) {
      if (reducedMotion()) return;
      t += dt;
      setPose(E.START + (t / E.PERIOD) * 720);
    },
    dispose() {},
  };
  return root;
}

// ===========================================================================================
// THE DIFFERENCE ENGINE
// ===========================================================================================
//
// THE NUMBERS ARE WORKED OUT, not played back. Every crank cycle does what the real machine does:
// the middle column is added into the left, then the right is added into the middle. The squares come
// out because that is what the method of differences does, and a carry ripples up a column because
// each wheel starts a little after the one below it.
//
// Twenty wheels cannot spend twenty draw calls, so they share one mesh, and only the ones turning
// have their vertices rewritten. The crank and pinion are one group and the great gear and cam stack
// another, so turning the handle costs nothing at all.

const DIFF = {
  ZW: 0.75, WHEEL_YS: [1.85, 2.7, 3.55, 4.4], PLACES: 4,
  COLS: [-2.6, -0.4, 1.8], SECTORS: [-1.5, 0.7],
  WHEEL_R: 0.52, BAND: 0.23, FLANGE_R: 0.63, FLANGE_TEETH: 30, SECTOR_TEETH: 26,
  CAM_Y: 3.55, CAM_Z: -1.2, CAMS: 22,
  PERIOD: 6, CRANKS_PER_CYCLE: 3, ADDS: 24,
};
DIFF.SECTOR_R = (DIFF.FLANGE_R * DIFF.SECTOR_TEETH) / DIFF.FLANGE_TEETH;

// A table a script can hold to the rule. Cycle c has added c times, and the last cycle puts it back.
export const DIFF_ENGINE = {
  ...DIFF,
  START: { left: 1, middle: 3, right: 2 },
  step(s) { return { left: s.left + s.middle, middle: s.middle + s.right, right: s.right }; },
  state(cycle) {
    let s = { ...DIFF_ENGINE.START };
    const c = ((cycle % (DIFF.ADDS + 1)) + DIFF.ADDS + 1) % (DIFF.ADDS + 1);
    for (let i = 0; i < c; i++) s = DIFF_ENGINE.step(s);
    return s;
  },
  sequence() {
    const out = [];
    for (let c = 0; c <= DIFF.ADDS; c++) out.push(DIFF_ENGINE.state(c));
    return out;
  },
  digit(value, place) { return Math.floor(value / 10 ** place) % 10; },
};

function paintDigitBand(ctx, W, H) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const band = H * 0.5625; // the top of the canvas; everything below it is plain white
  const cell = W / 10;
  ctx.fillStyle = '#f6efe0';
  ctx.fillRect(0, 0, W, band);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let d = 0; d < 10; d++) {
    const cx = (d + 0.5) * cell;
    // The numeral stamped into a slightly paler field, as these were.
    ctx.fillStyle = '#fffaf0';
    ctx.fillRect(cx - cell * 0.42, band * 0.06, cell * 0.84, band * 0.88);
    ctx.fillStyle = '#1a140c';
    fitFont(ctx, String(d), cell * 0.7, band * 0.86, '800', 'Georgia, "Times New Roman", serif');
    ctx.fillText(String(d), cx, band * 0.53, cell);
    ctx.fillStyle = 'rgba(70,50,20,0.6)';
    ctx.fillRect(d * cell - 3, 0, 6, band);
  }
}

function differencePlates(ctx, W, H) {
  ctx.fillStyle = '#d9c28a';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const names = [
    ['SQUARES', 'n × n: 1, 4, 9, 16, 25'],
    ['FIRST DIFFERENCE', 'goes up by 2 each turn'],
    ['SECOND DIFFERENCE', 'stays at 2'],
  ];
  const cw = W / 3; const rowH = H * 0.25;
  names.forEach(([a, b], i) => {
    ctx.fillStyle = '#241a0c';
    fitFont(ctx, a, cw * 0.9, rowH * 0.36, '800');
    ctx.fillText(a, cw * (i + 0.5), rowH * 0.33);
    ctx.fillStyle = '#4d3a18';
    fitFont(ctx, b, cw * 0.9, rowH * 0.26, '700');
    ctx.fillText(b, cw * (i + 0.5), rowH * 0.72);
    ctx.strokeStyle = '#5b4520'; ctx.lineWidth = 6;
    ctx.strokeRect(cw * i + 8, 8, cw - 16, rowH - 16);
  });
  const ty = rowH; const th = H * 0.14;
  ctx.fillStyle = '#241a0c';
  ctx.fillRect(0, ty, W, th);
  ctx.fillStyle = '#efd89c';
  const title = 'BABBAGE\u2019S DIFFERENCE ENGINE';
  fitFont(ctx, title, W * 0.97, th * 0.46, '800');
  ctx.fillText(title, W / 2, ty + th * 0.3);
  ctx.fillStyle = '#e7cf94';
  const line = 'Read each column from top to bottom, in its slot. Each turn adds the middle into the left, then the right into the middle.';
  fitFont(ctx, line, W * 0.97, th * 0.3, '700');
  ctx.fillText(line, W / 2, ty + th * 0.74);
  // Two arrow plates, each saying which way a number goes. Drawn, since an arrow glyph depends on a font.
  const ay = ty + th + 8; const ah = H - ay - 8;
  const aw = W / 2;
  for (let i = 0; i < 2; i++) {
    const x = i * aw;
    ctx.fillStyle = '#241a0c';
    ctx.beginPath();
    const y0 = ay + ah * 0.34; const y1 = ay + ah * 0.66;
    ctx.moveTo(x + aw * 0.08, ay + ah * 0.5);
    ctx.lineTo(x + aw * 0.3, ay + ah * 0.12);
    ctx.lineTo(x + aw * 0.3, y0);
    ctx.lineTo(x + aw * 0.92, y0);
    ctx.lineTo(x + aw * 0.92, y1);
    ctx.lineTo(x + aw * 0.3, y1);
    ctx.lineTo(x + aw * 0.3, ay + ah * 0.88);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e7cf94';
    fitFont(ctx, 'ADDS TO', aw * 0.55, ah * 0.22, '800');
    ctx.fillText('ADDS TO', x + aw * 0.6, ay + ah * 0.5);
  }
}

function buildDifferenceEngine() {
  const D = DIFF;
  const root = new THREE.Group();
  const iron = [];
  const metal = [];
  const plates = [];
  const crankParts = [];
  const gearParts = [];
  const skin = new RigidSkin();

  const IRON = 0x4a5055; const IRON2 = 0x5c6369; const BRASS = 0xc2953e; const BRASS2 = 0xa67f2e; const STEEL = 0xc7cbcf; const OAK = 0x5c4029;

  const X0 = -5.5; const X1 = 4.65; // the outer faces of the two end frames
  const FRONT = 1.55; const ARC_Z0 = -0.35; const ARC_Z1 = -0.1;
  const BED = 1.2; const TOP = 6.25; const RAIL_Y = 5.55;
  const PILLARS = [-3.6, -1.5, 0.7, 2.9];

  // Along X: an outline in (z, y), extruded through [w0, w1] along world x.
  const crossPrism = (outline, x0, x1, opts = {}) => {
    const g = prism(outline, -x1, -x0, opts);
    g.rotateY(-Math.PI / 2);
    return g;
  };

  // --- The floor it stands on ---
  iron.push({ geometry: block(-5.85, 0, -2.45, 5.85, 0.1, 2.05), color: OAK });
  iron.push({ geometry: block(-5.7, 0.1, -2.35, 5.7, 0.14, 1.95), color: 0x6e4d32 });

  // --- The two end frames, each a cast arch ---
  const endOutline = [[-2.3, 0.14], [1.9, 0.14], [1.9, 0.34], [FRONT + 0.1, 0.5], [FRONT + 0.05, 5.4], [FRONT + 0.05, TOP], [-0.5, TOP + 0.1], [-1.1, TOP - 0.3], [-1.55, 5.1], [-2.0, 2.0], [-2.3, 0.34]];
  const archWin = (z0, z1, y0, y1) => {
    const zc = (z0 + z1) / 2; const r = (z1 - z0) / 2;
    return [[z0, y0], [z1, y0], ...arcPts(zc, y1 - r, r, 0, Math.PI, 18).slice(0, 19)];
  };
  for (const [x0, x1] of [[X0, X0 + 0.22], [X1 - 0.22, X1]]) {
    iron.push({ geometry: crossPrism(endOutline, x0, x1, { holes: [archWin(-0.65, 1.3, 1.0, 5.35)] }), color: IRON });
    // A gilt line round the arch, on the outer face.
    const outer = x0 < 0 ? x0 - 0.012 : x1;
    metal.push({ geometry: crossPrism(archWin(-0.72, 1.37, 0.93, 5.42), outer, outer + 0.012, { holes: [archWin(-0.67, 1.32, 0.98, 5.37)] }), color: BRASS });
  }
  // A lid, so the machine does not read as a box with no top.
  iron.push({ geometry: block(X0 + 0.1, TOP - 0.1, ARC_Z1 - 0.2, X1 - 0.1, TOP, FRONT - 0.1), color: IRON2 });

  // --- The back arcade, with an arch for each column to stand against ---
  const arcadeOutline = [[X0 + 0.1, 0.6], [X1 - 0.1, 0.6], [X1 - 0.1, TOP], [X0 + 0.1, TOP]];
  const bays = [[-4.33, 1.25], [-2.6, 1.7], [-0.4, 1.7], [1.8, 1.7], [3.5, 1.2]];
  const archXY = (c, w, y0, y1) => {
    const r = w / 2;
    return [[c - r, y0], [c + r, y0], ...arcPts(c, y1 - r, r, 0, Math.PI, 20).slice(0, 21)];
  };
  iron.push({ geometry: prism(arcadeOutline, ARC_Z0, ARC_Z1, { holes: bays.map(([c, w]) => archXY(c, w, 1.28, 5.42)) }), color: IRON2 });
  // A raised moulding round each arch: the same outline, a ring proud of the wall.
  for (const [c, w] of bays) {
    const ringOut = archXY(c, w + 0.2, 1.2, 5.52);
    const ringIn = archXY(c, w, 1.28, 5.42);
    iron.push({ geometry: prism(ringOut, ARC_Z1 - 0.01, ARC_Z1 + 0.05, { holes: [ringIn], back: false }), color: IRON });
  }

  // --- The front: a top rail cut into arches, a bottom rail, and thin turned pillars ---
  const railEdges = [X0 + 0.1, ...PILLARS, X1 - 0.1];
  const railOut = [[railEdges[0], TOP], [railEdges[0], 4.95]];
  // Walking left to right along the underside of the rail, one arch per bay.
  for (let i = 0; i < railEdges.length - 1; i++) {
    const a = railEdges[i]; const b = railEdges[i + 1];
    const c = (a + b) / 2; const r = (b - a) / 2;
    for (let k = 0; k <= 20; k++) {
      const ang = Math.PI - (k / 20) * Math.PI;
      railOut.push([c + Math.cos(ang) * r, 4.95 + Math.sin(ang) * (RAIL_Y - 0.1 - 4.95)]);
    }
  }
  railOut.push([railEdges[railEdges.length - 1], TOP]);
  const spandrels = PILLARS.map((x) => arcPts(x, 5.0, 0.16, 0, TAU * (15 / 16), 15));
  iron.push({ geometry: prism(railOut, FRONT - 0.2, FRONT, { holes: spandrels }), color: IRON });
  iron.push({ geometry: block(X0 + 0.1, 0.72, FRONT - 0.22, X1 - 0.1, BED, FRONT), color: IRON });
  iron.push({ geometry: block(X0 + 0.1, 0.92, ARC_Z0, X1 - 0.1, BED, FRONT - 0.2), color: IRON2 });
  iron.push({ geometry: block(X0 + 0.1, 0.72, ARC_Z0 - 0.15, X1 - 0.1, BED, ARC_Z0 + 0.1), color: IRON });
  // A bar across the tops of the columns, which is what holds the shafts upright.
  iron.push({ geometry: block(X0 + 0.1, 5.02, D.ZW - 0.11, X1 - 0.1, 5.16, D.ZW + 0.11), color: IRON2 });
  for (const x of [...D.COLS, ...D.SECTORS]) iron.push({ geometry: block(x - 0.1, 5.04, ARC_Z1 - 0.02, x + 0.1, 5.14, FRONT - 0.18), color: IRON });
  for (const x of PILLARS) {
    metal.push({
      geometry: lathed([[0, BED], [0.15, BED], [0.15, BED + 0.1], [0.095, BED + 0.2], [0.07, BED + 0.5], [0.075, 3.2], [0.11, 3.28], [0.075, 3.36], [0.07, 5.0], [0.1, 5.15], [0.14, 5.32], [0, 5.32]], 16, { crease: 44 }).translate(x, 0, FRONT - 0.13),
      color: 0x565c61,
    });
  }
  // Gilt lines on the castings, which is how Victorian machinery was finished.
  for (const y of [TOP - 0.06, RAIL_Y + 0.03]) metal.push({ geometry: block(X0 + 0.12, y, FRONT - 0.01, X1 - 0.12, y + 0.03, FRONT + 0.012), color: BRASS });
  for (const y of [BED - 0.04, 0.75]) metal.push({ geometry: block(X0 + 0.12, y, FRONT - 0.01, X1 - 0.12, y + 0.03, FRONT + 0.012), color: BRASS });

  // --- The column and sector shafts, each collared where it passes through bed and bar ---
  for (const x of [...D.COLS, ...D.SECTORS]) {
    const isCol = D.COLS.includes(x);
    metal.push({ geometry: rod([x, BED - 0.02, D.ZW], [x, 5.3, D.ZW], 0.07, 12, 0), color: STEEL });
    metal.push({ geometry: lathed([[0, BED], [0.2, BED], [0.2, BED + 0.08], [0.11, BED + 0.14], [0, BED + 0.14]], 18).translate(x, 0, D.ZW), color: BRASS2 });
    metal.push({ geometry: lathed([[0, 5.14], [0.15, 5.14], [0.15, 5.2], [0.09, 5.3], [0, 5.36]], 16).translate(x, 0, D.ZW), color: isCol ? BRASS : BRASS2 });
  }

  // A wheel shows five digits at a time, and nothing else says which of them is the answer. So each
  // column stands behind two iron bars that leave one slot, with the row to read in it. Thin rails
  // only added two red lines to a wall of digits: the neighbours have to be covered.
  for (const x of D.COLS) {
    for (const s of [-1, 1]) {
      const inner = x + s * 0.18; const outer = x + s * 0.58;
      const zBack = D.ZW + D.FLANGE_R + 0.03; const zFront = zBack + 0.05;
      metal.push({ geometry: block(Math.min(inner, outer), BED + 0.1, zBack, Math.max(inner, outer), 5.03, zFront), color: 0x33363a });
      metal.push({ geometry: block(x + s * 0.17, BED + 0.1, zFront - 0.01, x + s * 0.2, 5.03, zFront + 0.015), color: 0xc22a22 });
      metal.push({ geometry: block(Math.min(inner, outer), BED, D.ZW - 0.08, Math.max(inner, outer), BED + 0.12, zFront), color: 0x33363a });
      metal.push({ geometry: block(Math.min(inner, outer), 4.98, D.ZW - 0.08, Math.max(inner, outer), 5.04, zFront), color: 0x33363a });
    }
  }

  // --- Wheels and sectors ---
  const WHITE_U = 0.5; const WHITE_V = 0.2;
  const whiteUV = (g) => { const uv = g.attributes.uv; if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, WHITE_U, WHITE_V); return g; };
  // The band carries the digits. Digit d is centred on azimuth d x 36 degrees, u running with azimuth,
  // which is left to right to somebody looking at it from outside.
  const digitBand = () => {
    const N = 80; const R = D.WHEEL_R; const H = D.BAND;
    const pos = []; const uv = []; const nrm = []; const idx = [];
    for (let j = 0; j <= N; j++) {
      const a = (j / N) * TAU - 18 * DEG;
      for (const [y, v] of [[-H, 1 - 0.5625], [H, 1]]) {
        pos.push(R * Math.sin(a), y, R * Math.cos(a));
        nrm.push(Math.sin(a), 0, Math.cos(a));
        uv.push(j / N, v);
      }
    }
    for (let j = 0; j < N; j++) {
      const a = j * 2; const b = a + 1; const c = a + 2; const e = a + 3;
      idx.push(a, c, e, a, e, b);
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return g;
  };
  const gearY = (radius, teeth, thick, y) => {
    const g = gearWheel(radius, teeth, thick);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    return whiteUV(g);
  };
  const wheelNames = [];
  for (let col = 0; col < 3; col++) {
    for (let place = 0; place < D.PLACES; place++) {
      const name = `w${col}${place}`;
      wheelNames.push(name);
      skin.add(name, digitBand(), BRASS);
      skin.add(name, whiteUV(lathed([[0.07, -D.BAND - 0.06], [D.WHEEL_R + 0.03, -D.BAND - 0.06], [D.WHEEL_R + 0.03, -D.BAND], [D.WHEEL_R, -D.BAND + 0.002], [0.07, -D.BAND + 0.002]], 40, { closed: true, crease: 40 })), 0xa67f2e);
      skin.add(name, whiteUV(lathed([[0.07, D.BAND - 0.002], [D.WHEEL_R, D.BAND - 0.002], [D.WHEEL_R + 0.03, D.BAND], [D.WHEEL_R + 0.03, D.BAND + 0.03], [0.07, D.BAND + 0.03]], 40, { closed: true, crease: 40 })), 0xa67f2e);
      skin.add(name, gearY(D.FLANGE_R, D.FLANGE_TEETH, 0.07, D.BAND + 0.065), BRASS2);
    }
  }
  for (let col = 0; col < 2; col++) {
    for (let place = 0; place < D.PLACES; place++) {
      const name = `s${col}${place}`;
      skin.add(name, gearY(D.SECTOR_R, D.SECTOR_TEETH, 0.07, D.BAND + 0.065), BRASS);
      skin.add(name, whiteUV(lathed([[0, -0.1], [0.14, -0.1], [0.14, 0.1], [0.11, D.BAND + 0.12], [0, D.BAND + 0.12]], 16)), 0x8e6c28);
    }
  }

  // --- The great gear and the cam stack, on one shaft running along the back ---
  const CY = D.CAM_Y; const CZ = D.CAM_Z;
  const GX = X1 + 0.2;
  const camOut = (phase) => {
    const pts = [];
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * TAU;
      let d = a - phase; d = Math.atan2(Math.sin(d), Math.cos(d));
      const k = Math.abs(d) < 1.15 ? Math.cos((d / 1.15) * (Math.PI / 2)) ** 2 : 0;
      const r = 0.36 + 0.4 * k;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return pts;
  };
  const camSpan = (X1 - 0.5) - (X0 + 0.5);
  for (let i = 0; i < D.CAMS; i++) {
    const x = X0 + 0.5 + (camSpan * (i + 0.5)) / D.CAMS;
    // Each cam is turned a little from the last, so the row of noses runs round as a spiral.
    const g = prism(camOut((i / D.CAMS) * TAU), -0.14, 0.14, { crease: 40 });
    g.rotateY(Math.PI / 2);
    g.translate(x, 0, 0);
    gearParts.push({ geometry: g, color: i % 2 ? 0xbfc3c7 : 0xd3d6d9 });
  }
  const shaftG = rod([X0 - 0.1, 0, 0], [GX + 0.22, 0, 0], 0.13, 16, 0);
  gearParts.push({ geometry: shaftG, color: 0x8f949a });

  // The great gear's teeth meet the pinion's gap on the line between their centres.
  const GEAR_T = 48; const PIN_T = 16; const GEAR_R = 1.1; const PIN_R = 0.37;
  const depthOf = (r, t) => r * (2.1 / t) * 1.9;
  const centres = (GEAR_R - depthOf(GEAR_R, GEAR_T) / 2) + (PIN_R - depthOf(PIN_R, PIN_T) / 2);
  const PDY = -1.2; const PDZ = Math.sqrt(centres * centres - PDY * PDY);
  const PY = CY + PDY; const PZ = CZ + PDZ;
  const gearHoles = [];
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * TAU;
    const pts = [...arcPts(0, 0, 0.84, a - 0.4, a + 0.4, 8), ...arcPts(0, 0, 0.4, a + 0.3, a - 0.3, 6)];
    gearHoles.push(pts);
  }
  const greatGear = prism(gearOutline(GEAR_R, GEAR_T), -0.08, 0.08, { holes: gearHoles, crease: 40 });
  greatGear.rotateZ(Math.atan2(PDY, -PDZ));
  greatGear.rotateY(Math.PI / 2);
  greatGear.translate(GX, 0, 0);
  gearParts.push({ geometry: greatGear, color: BRASS });
  // Its web and bosses, so that it is a wheel and not a plate.
  gearParts.push({ geometry: axisX(lathed([[0, -0.2], [0.3, -0.2], [0.34, -0.14], [0.34, 0.14], [0.3, 0.2], [0, 0.2]], 28, { crease: 40 })).translate(GX, 0, 0), color: BRASS2 });
  const pinion = gearWheel(PIN_R, PIN_T, 0.2);
  pinion.rotateZ(Math.atan2(-PDY, PDZ) + Math.PI / PIN_T);
  pinion.rotateY(Math.PI / 2);
  pinion.translate(GX, 0, 0);
  crankParts.push({ geometry: pinion, color: 0xd3a64a });
  // A bearing for each shaft, sunk into the right-hand end frame.
  for (const [y, z] of [[CY, CZ], [PY, PZ]]) {
    iron.push({ geometry: axisX(lathed([[0, X1 - 0.3], [0.26, X1 - 0.3], [0.26, X1 + 0.07], [0.19, X1 + 0.09], [0, X1 + 0.09]], 18)).translate(0, y, z), color: IRON2 });
  }
  iron.push({ geometry: axisX(lathed([[0, X0 - 0.14], [0.26, X0 - 0.14], [0.26, X0 + 0.26], [0, X0 + 0.26]], 18)).translate(0, CY, CZ), color: IRON2 });

  // The handle: a shaft, an arm, and a wooden grip.
  crankParts.push({ geometry: rod([X1 - 0.3, 0, 0], [GX + 0.5, 0, 0], 0.09, 14, 0), color: 0x9a9fa5 });
  const ARM = 0.88; const ARM_X = GX + 0.46;
  crankParts.push({ geometry: tube([[ARM_X, 0, 0], [ARM_X, ARM, 0]], [0.1, 0.06], { sides: 10, steps: 3, round: 1, section: () => [1, 0.55], frame: () => [1, 0, 0] }), color: 0x7f8489 });
  crankParts.push({ geometry: axisX(lathed([[0, GX + 0.34], [0.14, GX + 0.34], [0.14, GX + 0.58], [0, GX + 0.58]], 18)), color: 0x7f8489 });
  crankParts.push({ geometry: rod([ARM_X - 0.02, ARM, 0], [ARM_X + 0.12, ARM, 0], 0.05, 10, 0), color: 0x9a9fa5 });
  crankParts.push({ geometry: axisX(lathed([[0, ARM_X + 0.08], [0.06, ARM_X + 0.08], [0.095, ARM_X + 0.14], [0.11, ARM_X + 0.3], [0.09, ARM_X + 0.46], [0.05, ARM_X + 0.5], [0, ARM_X + 0.5]], 16, { crease: 60 })).translate(0, ARM, 0), color: 0x6b3f22 });

  // --- The plates ---
  const FACE = FRONT + 0.012;
  const rect = (x0, y0, x1, y1) => [x0, 1 - y1, x1, 1 - y0];
  D.COLS.forEach((x, i) => {
    const g = printedPlate(1.6, 0.6, 0.02, rect(i / 3, 0, (i + 1) / 3, 0.25));
    g.translate(x, (TOP + RAIL_Y) / 2, FACE + 0.012);
    plates.push({ geometry: g, color: 0xffffff });
  });
  const title = printedPlate(6.6, 0.43, 0.02, rect(0, 0.25, 1, 0.39));
  title.translate((D.COLS[0] + D.COLS[2]) / 2, 0.96, FACE + 0.012);
  plates.push({ geometry: title, color: 0xffffff });
  D.SECTORS.forEach((x, i) => {
    const g = printedPlate(0.5, 0.34, 0.02, rect(i * 0.5, 0.39, (i + 1) * 0.5, 0.995));
    g.translate(x, (TOP + RAIL_Y) / 2, FACE + 0.012);
    plates.push({ geometry: g, color: 0xffffff });
  });

  // --- The meshes ---
  root.add(mesh(mergeParts(iron), standard({ vertexColors: true, roughness: 0.62, metalness: 0.2, ...relief('metal', { seed: 7, repeat: 0.7 }) })));
  root.add(mesh(mergeParts(metal), standard({ vertexColors: true, roughness: 0.36, metalness: 0.32 })));
  root.add(noShadow(mesh(mergeParts(plates), standard({ vertexColors: true, map: canvasTexture(2048, 1024, differencePlates), roughness: 0.5, metalness: 0.1 }))));

  const crankGroup = new THREE.Group();
  crankGroup.position.set(0, PY, PZ);
  crankGroup.add(mesh(mergeParts(crankParts), standard({ vertexColors: true, roughness: 0.42, metalness: 0.3 })));
  root.add(crankGroup);
  const gearGroup = new THREE.Group();
  gearGroup.position.set(0, CY, CZ);
  gearGroup.add(mesh(mergeParts(gearParts), standard({ vertexColors: true, roughness: 0.34, metalness: 0.38 })));
  root.add(gearGroup);

  const skinMat = standard({ vertexColors: true, map: canvasTexture(2048, 512, paintDigitBand), roughness: 0.38, metalness: 0.3 });
  skinMat.map.anisotropy = 8;
  root.add(skin.build(skinMat, new THREE.Sphere(V(-0.4, 3.1, D.ZW), 5)));

  // --- The state of every wheel, as a pure function of time ---
  const easeIn = (x) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
  // Digit positions run on upward: a wheel only ever turns forward, the way a real one does.
  const rolled = (from, to, place, p, p0, p1) => {
    const d0 = DIFF_ENGINE.digit(from, place); const d1 = DIFF_ENGINE.digit(to, place);
    const delta = (d1 - d0 + 10) % 10;
    if (!delta) return d0;
    // The units go first and each carry follows, which is how the column ripples upward.
    const span = (p1 - p0);
    const start = p0 + span * 0.16 * place;
    const dur = span * 0.52;
    return d0 + delta * easeIn((p - start) / dur);
  };
  const shown = new Map();
  const mwheel = new THREE.Matrix4();
  const place = (name, x, y, angle) => {
    const key = shown.get(name);
    if (key === angle) return false;
    shown.set(name, angle);
    mwheel.makeRotationY(angle).setPosition(x, y, D.ZW);
    skin.set(name, mwheel);
    return true;
  };
  const setPose = (t) => {
    const total = D.PERIOD * (D.ADDS + 1);
    const tt = ((t % total) + total) % total;
    const cycle = Math.floor(tt / D.PERIOD);
    const p = (tt / D.PERIOD) - cycle;
    const now = DIFF_ENGINE.state(cycle);
    const next = DIFF_ENGINE.state(cycle + 1);
    const isReset = cycle === D.ADDS;
    let changed = false;
    for (let place_ = 0; place_ < D.PLACES; place_++) {
      const y = D.WHEEL_YS[place_];
      const left = isReset ? rolled(now.left, next.left, place_, p, 0.08, 0.5) : rolled(now.left, next.left, place_, p, 0.06, 0.48);
      const middle = isReset ? rolled(now.middle, next.middle, place_, p, 0.08, 0.5) : rolled(now.middle, next.middle, place_, p, 0.52, 0.94);
      const right = DIFF_ENGINE.digit(now.right, place_);
      if (place(`w0${place_}`, D.COLS[0], y, -left * 36 * DEG)) changed = true;
      if (place(`w1${place_}`, D.COLS[1], y, -middle * 36 * DEG)) changed = true;
      if (place(`w2${place_}`, D.COLS[2], y, -right * 36 * DEG)) changed = true;
      // A sector meshes with the wheel on its left, so it turns against it, faster by the tooth ratio.
      const ratio = D.FLANGE_TEETH / D.SECTOR_TEETH;
      if (place(`s0${place_}`, D.SECTORS[0], y, left * 36 * DEG * ratio)) changed = true;
      if (place(`s1${place_}`, D.SECTORS[1], y, middle * 36 * DEG * ratio)) changed = true;
    }
    if (changed) skin.commit();
    const turn = (tt / D.PERIOD) * TAU;
    gearGroup.rotation.x = turn;
    crankGroup.rotation.x = -turn * D.CRANKS_PER_CYCLE;
  };
  setPose(0);
  let t = 0;
  root.userData.tick = {
    update(dt) {
      if (reducedMotion()) return;
      t += dt;
      setPose(t);
    },
    dispose() {},
  };
  return root;
}

// ===========================================================================================
// FOUR KINDS OF BRIDGE
// ===========================================================================================
//
// One river in a U, so one water and two reaches, with two bridges over each at the same span. The
// paint is the point: blue is squeezed and red is stretched, so what a student compares is not four
// shapes but four ways of getting the same truck's weight down to the same ground.

const BRIDGE = {
  W: 19.4, D: 13.4, WATER: 0.62, BED: 0.28, LAND: 1.46, DECK: 1.52, C: 5.0, ROWS: [4.05, -1.3],
  LANES: 0.2, TRUCK_PERIOD: 16, ROAD_X: 3.86,
  // The suspension bridge's towers and cable.
  TOWER_X: 2.6, TOWER_TOP: 3.75, SAG_Y: 1.78, ANCHOR_X: 4.25,
  // The Warren truss.
  PANELS: 6, TRUSS_HALF: 3.6, TRUSS_H: 1.25,
  // The stone arch.
  ARCH_HALF: 2.95, ARCH_SPRING: 0.55, ARCH_RISE: 0.85, RING: 0.28, HUMP: 0.42, HUMP_HALF: 3.75,
};
const archRadius = ((BRIDGE.ARCH_HALF ** 2) + (BRIDGE.ARCH_RISE ** 2)) / (2 * BRIDGE.ARCH_RISE);

export const BRIDGES = {
  ...BRIDGE,
  // A cable carrying a level deck hangs in a parabola.
  cableY(x) {
    const u = x / BRIDGE.TOWER_X;
    return BRIDGE.SAG_Y + (BRIDGE.TOWER_TOP - BRIDGE.SAG_Y) * u * u;
  },
  // A Warren truss's diagonals, with what a load on the deck does to each: from each end they alternate.
  trussMembers() {
    const { PANELS, TRUSS_HALF, TRUSS_H, DECK } = BRIDGE;
    const panel = (2 * TRUSS_HALF) / PANELS;
    const out = [];
    const low = (i) => [-TRUSS_HALF + panel * i, DECK];
    const high = (i) => [-TRUSS_HALF + panel * (i + 0.5), DECK + TRUSS_H];
    for (let i = 0; i < PANELS; i++) {
      const left = i < PANELS / 2;
      // Going in from a support, the first diagonal rises to the top chord and is squeezed.
      out.push({ a: low(i), b: high(i), force: left ? 'C' : 'T', kind: 'diagonal' });
      out.push({ a: high(i), b: low(i + 1), force: left ? 'T' : 'C', kind: 'diagonal' });
      out.push({ a: low(i), b: low(i + 1), force: 'T', kind: 'bottom chord' });
      if (i < PANELS - 1) out.push({ a: high(i), b: high(i + 1), force: 'C', kind: 'top chord' });
    }
    return out;
  },
  archCentreY() { return BRIDGE.ARCH_SPRING + BRIDGE.ARCH_RISE - archRadius; },
  humpY(x) {
    const u = clamp01(1 - Math.abs(x) / BRIDGE.HUMP_HALF);
    return BRIDGE.DECK + BRIDGE.HUMP * sstep(u, 0, 1);
  },
};

// A squared member from a to b, for anything in a truss.
function strut(a, b, w, h = w) {
  const { m, len } = alongMatrix(a, b, [0, 0, 1]);
  const g = new THREE.BoxGeometry(w, h, len);
  g.translate(0, 0, len / 2);
  g.applyMatrix4(m);
  return g;
}

function bridgePlates(ctx, W, H) {
  ctx.fillStyle = '#f0ebdc';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const rows = [
    ['BEAM BRIDGE', 'Top squeezed, bottom stretched'],
    ['TRUSS BRIDGE', 'Triangles share out the push and the pull'],
    ['ARCH BRIDGE', 'The whole stone ring is squeezed'],
    ['SUSPENSION BRIDGE', 'Cables stretched, towers squeezed'],
  ];
  const cw = W / 2; const rh = H * 0.32; // legend takes the rest, the bottom 36%
  rows.forEach(([a, b], i) => {
    const cx = (i % 2 + 0.5) * cw; const y = Math.floor(i / 2) * rh;
    ctx.strokeStyle = '#2a2f35'; ctx.lineWidth = 8;
    ctx.strokeRect((i % 2) * cw + 8, y + 8, cw - 16, rh - 16);
    ctx.fillStyle = '#20252b';
    fitFont(ctx, a, cw * 0.86, rh * 0.32, '800');
    ctx.fillText(a, cx, y + rh * 0.36);
    ctx.fillStyle = '#3f454c';
    fitFont(ctx, b, cw * 0.88, rh * 0.2, '700');
    ctx.fillText(b, cx, y + rh * 0.7);
  });
  // The legend.
  const ly = rh * 2; const lh = H - ly;
  ctx.fillStyle = '#20252b';
  ctx.fillRect(0, ly, W, lh);
  const chip = (x, color, a, b) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, ly + lh * 0.18, lh * 0.64, lh * 0.64);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f4f0e4';
    fitFont(ctx, a, W * 0.34, lh * 0.34, '800');
    ctx.fillText(a, x + lh * 0.76, ly + lh * 0.35);
    fitFont(ctx, b, W * 0.34, lh * 0.2, '600');
    ctx.fillStyle = '#d6d2c6';
    ctx.fillText(b, x + lh * 0.76, ly + lh * 0.68);
  };
  chip(W * 0.03, '#3576dc', 'BLUE: SQUEEZED', 'Compression: pushed together');
  chip(W * 0.52, '#d0392f', 'RED: STRETCHED', 'Tension: pulled apart');
}

function buildBridges() {
  const B = BRIDGE;
  const BLUE = 0x2f6fd6; const RED = 0xcf352c; const GREY = 0x8e9398; const ROAD = 0x3a3d41; const STONE = 0xa9a292; const PALE = 0xe6e2d6;
  const W = B.W; const D = B.D;

  // --- The river: one path, and everything else asked of it ---
  const path = smoothPath([[-B.C, 8], [-B.C, 3], [-B.C, -1.2], [-4.8, -3.3], [-2.9, -4.6], [0, -4.85], [2.9, -4.6], [4.8, -3.3], [B.C, -1.2], [B.C, 3], [B.C, 8]], 260);
  const halfW = (t) => mix(1.0, 2.0, sstep(Math.abs(t - 0.5), 0.1, 0.26));
  const slopeW = (t) => mix(0.72, 1.3, sstep(Math.abs(t - 0.5), 0.1, 0.26));
  const edgeField = sampledField(W, D, 240, 170, (x, z) => { const q = pathDistance(path, x, z); return q.d - halfW(q.t); });
  const slopeField = sampledField(W, D, 120, 85, (x, z) => slopeW(pathDistance(path, x, z).t));
  const height = (x, z) => {
    const e = edgeField(x, z);
    if (e < 0) return mix(B.WATER - 0.03, B.BED, sstep(-e, 0, 0.75));
    const hills = 0.09 * sstep(Math.abs(z - B.ROWS[0]), 0.8, 1.6) * sstep(Math.abs(z - B.ROWS[1]), 0.8, 1.6) * (0.5 + fbm(x * 0.5, z * 0.5, 3, 4));
    return mix(B.WATER - 0.03, B.LAND + Math.max(0, hills), sstep(e, 0, slopeField(x, z)));
  };
  const onRoad = (x, z) => {
    for (const zb of B.ROWS) {
      if (Math.abs(z - zb) < 0.5 && Math.abs(Math.abs(x) - B.C) > B.ROAD_X - 0.04) return { line: Math.abs(z - zb) < 0.022 && ((x * 2.2 + 100) % 1) < 0.55, edge: Math.abs(z - zb) > 0.44 };
    }
    return null;
  };
  const paint = (x, z, y, slope) => {
    const g = fbm(x * 1.4, z * 1.4, 4, 2) * 0.5 + 0.5;
    let c = mixc(rgb(0x5f8a3f), rgb(0x7ca34c), g);
    const fine = noise2(x * 11, z * 11, 8) * 6;
    c = [c[0] + fine, c[1] + fine, c[2] + fine];
    const e = edgeField(x, z);
    // Rock where it is steep, a pale strip of gravel at the waterline.
    c = mixc(c, mixc(rgb(0x7f7768), rgb(0x9b9383), g), sstep(slope, 0.5, 1.0));
    c = mixc(c, rgb(0xc9b98f), 1 - sstep(e, 0.02, 0.2));
    const r = onRoad(x, z);
    if (r) {
      c = rgb(0x45474a);
      if (r.line) c = rgb(0xece8d8);
      if (r.edge) c = rgb(0x8f8c80);
    }
    return c;
  };
  const block_ = terrainBlock({
    w: W, d: D, plinth: 0.3, nx: 130, nz: 90, height, water: B.WATER, paint, texW: 1500, relief: 0.35,
    waterPaint: (x, z, depth) => {
      const streak = fbm(x * 2.2, z * 0.7, 3, 11) * 10;
      const c = mixc(rgb(0x6fb4c6), rgb(0x2a6f96), sstep(depth, 0, 0.3));
      return [c[0] + streak, c[1] + streak, c[2] + streak];
    },
    sectionWater: (depth) => mixc(rgb(0x4e9fbe), rgb(0x1f5f8a), sstep(depth, 0, 0.4)),
  });
  const root = block_.root;
  // Its plinth goes into the bridges' mesh, to stay within six.
  const lastChild = root.children[root.children.length - 1];
  root.remove(lastChild);
  lastChild.geometry.dispose();
  lastChild.material.dispose();

  const parts = [];
  const add = (geometry, color, x = 0, z = 0) => parts.push({ geometry, color, position: [x, 0, z] });
  add(block(-W / 2 - 0.25, 0, -D / 2 - 0.25, W / 2 + 0.25, 0.18, D / 2 + 0.25), 0x3b2a1c);
  add(block(-W / 2 - 0.1, 0.18, -D / 2 - 0.1, W / 2 + 0.1, 0.3, D / 2 + 0.1), 0x4c3625);

  const HALF_W = 0.44; // half the deck's width
  const road = (cx, zb, x0, x1, yAt) => {
    // A deck you can drive on: segments follow yAt, and a dashed white line runs down the middle.
    const n = yAt ? 40 : 1;
    for (let i = 0; i < n; i++) {
      const a = mix(x0, x1, i / n); const b = mix(x0, x1, (i + 1) / n);
      const ya = yAt ? yAt(a) : B.DECK; const yb = yAt ? yAt(b) : B.DECK;
      const o = [[a, ya], [b, yb], [b, yb - 0.05], [a, ya - 0.05]];
      add(prism(o, -HALF_W, HALF_W, { crease: 40 }), ROAD, cx, zb);
      const on = Math.floor((a + 100) * 2.4) % 2 === 0;
      if (on) add(prism([[a, ya + 0.003], [b, yb + 0.003], [b, yb - 0.01], [a, ya - 0.01]], -0.018, 0.018, { crease: 40 }), PALE, cx, zb);
    }
    if (!yAt) {
      for (let x = x0; x < x1 - 0.2; x += 0.42) add(block(x, B.DECK - 0.004, -0.018, x + 0.22, B.DECK + 0.004, 0.018), PALE, cx, zb);
    }
  };
  // A stone abutment where each deck meets the bank, sunk into it.
  const abutment = (cx, zb, x0, x1) => {
    for (const side of [-1, 1]) {
      const a = side > 0 ? x0 : -x1; const b = side > 0 ? x1 : -x0;
      add(block(a, 0.75, -HALF_W - 0.1, b, B.LAND, HALF_W + 0.1), STONE, cx, zb);
    }
  };

  // --- The beam: three plain spans of girder on two piers ---
  {
    const cx = -B.C; const zb = B.ROWS[0];
    road(cx, zb, -B.ROAD_X, B.ROAD_X);
    abutment(cx, zb, 3.3, 4.05);
    const joints = [-B.ROAD_X, -1.3, 1.3, B.ROAD_X];
    for (let i = 0; i < 3; i++) {
      const x0 = joints[i] + 0.025; const x1 = joints[i + 1] - 0.025;
      add(block(x0, 1.36, -HALF_W, x1, B.DECK - 0.05, HALF_W), BLUE, cx, zb);
      add(block(x0, 1.06, -0.09, x1, 1.36, 0.09), GREY, cx, zb);
      for (const z of [-0.3, 0.3]) add(block(x0, 1.06, z - 0.09, x1, 1.36, z + 0.09), GREY, cx, zb);
      add(block(x0, 0.95, -HALF_W, x1, 1.06, HALF_W), RED, cx, zb);
    }
    // The piers: squeezed, top to bottom, with a stone cap.
    for (const x of [-1.3, 1.3]) {
      add(block(x - 0.2, 0.84, -HALF_W - 0.05, x + 0.2, 0.95, HALF_W + 0.05), BLUE, cx, zb);
      add(prism([[-0.15, B.BED], [0.15, B.BED], [0.11, 0.86], [-0.11, 0.86]], -0.36, 0.36, { crease: 30 }), BLUE, cx + x, zb);
    }
  }

  // --- The truss: a Warren truss each side, the deck hung between ---
  {
    const cx = -B.C; const zb = B.ROWS[1];
    road(cx, zb, -B.ROAD_X, B.ROAD_X);
    abutment(cx, zb, 3.3, 4.05);
    add(block(-B.ROAD_X, B.DECK - 0.17, -HALF_W, B.ROAD_X, B.DECK - 0.05, HALF_W), GREY, cx, zb);
    for (const side of [-1, 1]) {
      const z = side * (HALF_W + 0.03);
      for (const { a, b, force, kind } of BRIDGES.trussMembers()) {
        const big = kind === 'diagonal' ? 0.075 : 0.105;
        add(strut([a[0], a[1], z], [b[0], b[1], z], big, big), force === 'C' ? BLUE : RED, cx, zb);
      }
      // A gusset ball at every node, so a member cannot end in the air.
      const panel = (2 * B.TRUSS_HALF) / B.PANELS;
      for (let i = 0; i <= B.PANELS; i++) add(ball(0.085, [-B.TRUSS_HALF + panel * i, B.DECK, z], 8), 0x5b6066, cx, zb);
      for (let i = 0; i < B.PANELS; i++) add(ball(0.085, [-B.TRUSS_HALF + panel * (i + 0.5), B.DECK + B.TRUSS_H, z], 8), 0x5b6066, cx, zb);
    }
    // Cross members over the road, carrying nothing the paint is about.
    const panel = (2 * B.TRUSS_HALF) / B.PANELS;
    for (let i = 0; i < B.PANELS; i++) {
      const x = -B.TRUSS_HALF + panel * (i + 0.5);
      add(block(x - 0.035, B.DECK + B.TRUSS_H - 0.035, -HALF_W, x + 0.035, B.DECK + B.TRUSS_H + 0.035, HALF_W), GREY, cx, zb);
    }
  }

  // --- The arch: a true ring of real voussoirs, with the road over its back ---
  {
    const cx = B.C; const zb = B.ROWS[0];
    const humpY = BRIDGES.humpY;
    road(cx, zb, -B.ROAD_X, B.ROAD_X, humpY);
    abutment(cx, zb, 3.3, 4.05);
    const R = archRadius; const CY = BRIDGES.archCentreY();
    const half = Math.asin(B.ARCH_HALF / R);
    const N = 25;
    const rng = seededRandom(23);
    const ringPt = (a, r) => [Math.sin(a) * r, CY + Math.cos(a) * r];
    const stones = [];
    for (let i = 0; i < N; i++) {
      const gap = 0.0045;
      const a0 = -half + ((2 * half) * i) / N + gap; const a1 = -half + ((2 * half) * (i + 1)) / N - gap;
      // Every stone slightly different in how far it stands proud, as they are.
      const r2 = R + B.RING + (i % 2 ? 0.035 : 0);
      const o = [ringPt(a0, R), ringPt(a1, R), ringPt(a1, r2), ringPt(a0, r2)];
      const c = new THREE.Color(BLUE).multiplyScalar(0.84 + rng() * 0.3);
      stones.push({ geometry: prism(o, -HALF_W, HALF_W, { crease: 30 }), color: c.getHex() });
    }
    for (const st of stones) add(st.geometry, st.color, cx, zb);
    // The fill between the ring and the road: one solid, its underside the ring's back.
    const fill = [];
    for (let i = 0; i <= 40; i++) { const a = -half + (2 * half * i) / 40; fill.push(ringPt(a, R + B.RING - 0.01)); }
    const xEnd = B.ARCH_HALF + 0.75;
    const topPts = [];
    for (let i = 0; i <= 40; i++) { const x = mix(xEnd, -xEnd, i / 40); topPts.push([x, humpY(x) - 0.04]); }
    add(prism([...fill, [xEnd, fill[fill.length - 1][1]], ...topPts, [-xEnd, fill[0][1]]], -HALF_W + 0.015, HALF_W - 0.015, { crease: 30 }), STONE, cx, zb);
    // Solid skewbacks, so the ring has something to push on.
    for (const side of [-1, 1]) {
      const p = ringPt(side * half, R);
      const o = [[p[0] - side * 0.12, p[1] - 0.14], [p[0] + side * 1.0, p[1] - 0.14], [p[0] + side * 1.0, p[1] + 0.48], [p[0] + side * 0.1, p[1] + 0.34]];
      add(prism(o, -HALF_W - 0.04, HALF_W + 0.04, { crease: 30 }), STONE, cx, zb);
    }
  }

  // --- The suspension bridge: cable parabola from the formula, hangers read off it ---
  {
    const cx = B.C; const zb = B.ROWS[1];
    road(cx, zb, -B.ROAD_X, B.ROAD_X);
    add(block(-B.ROAD_X, B.DECK - 0.15, -HALF_W, B.ROAD_X, B.DECK - 0.05, HALF_W), GREY, cx, zb);
    abutment(cx, zb, 3.3, 4.05);
    const TX = B.TOWER_X; const TT = B.TOWER_TOP; const Z = HALF_W + 0.05;
    for (const side of [-1, 1]) {
      const x = side * TX;
      // Two legs and two portals, all squeezed. Stone below the deck takes them into the river bed.
      add(block(x - 0.2, B.BED, -Z - 0.16, x + 0.2, 1.0, Z + 0.16), STONE, cx, zb);
      for (const s2 of [-1, 1]) {
        const lz = s2 * Z;
        add(prism([[-0.13, 1.0], [0.13, 1.0], [0.08, TT], [-0.08, TT]], lz - 0.08, lz + 0.08, { crease: 30 }), BLUE, cx + x, zb);
      }
      for (const y of [TT - 0.12, 2.65]) add(block(x - 0.08, y - 0.08, -Z, x + 0.08, y + 0.08, Z), BLUE, cx, zb);
      add(block(x - 0.1, 1.16, -Z, x + 0.1, B.DECK - 0.15, Z), BLUE, cx, zb);
    }
    for (const side of [-1, 1]) {
      const z = side * Z;
      const pts = [];
      // The side span, straight from the anchorage to the tower top.
      const ax = -B.ANCHOR_X; const ay = B.LAND + 0.1;
      for (let i = 0; i < 6; i++) { const u = i / 6; pts.push([mix(ax, -TX, u), mix(ay, TT, u), z]); }
      for (let i = 0; i <= 44; i++) { const x = mix(-TX, TX, i / 44); pts.push([x, BRIDGES.cableY(x), z]); }
      for (let i = 1; i <= 6; i++) { const u = i / 6; pts.push([mix(TX, -ax, u), mix(TT, ay, u), z]); }
      add(tube(pts, 0.04, { sides: 8, steps: pts.length * 2, round: 1 }), RED, cx, zb);
      // Hangers at even spacing, from the deck to wherever the cable is.
      const step = 0.325;
      for (let x = -B.ANCHOR_X + 0.32; x < B.ANCHOR_X - 0.2; x += step) {
        const y = Math.abs(x) < TX ? BRIDGES.cableY(x) : mix(TT, ay, (Math.abs(x) - TX) / (B.ANCHOR_X - TX));
        if (Math.abs(Math.abs(x) - TX) < 0.1 || y < B.DECK + 0.06) continue;
        add(rod([x, B.DECK - 0.1, z], [x, y, z], 0.017, 5, 0), 0xd9423a, cx, zb);
      }
    }
    // The anchorages: great stone blocks the cables are tied into.
    for (const side of [-1, 1]) {
      const a = side * B.ANCHOR_X;
      add(block(a - 0.35, 1.0, -HALF_W - 0.22, a + 0.35, B.LAND + 0.3, HALF_W + 0.22), 0x7f7a6d, cx, zb);
    }
  }

  // --- A few small trees, for scale ---
  const trees = new Batch();
  const rng = seededRandom(91);
  const clear = (x, z) => {
    if (edgeField(x, z) < 1.35) return false;
    for (const zb of B.ROWS) if (Math.abs(z - zb) < 1.0) return false;
    if (Math.abs(x) < 2.4) return false;
    return Math.abs(x) < W / 2 - 0.25 && Math.abs(z) < D / 2 - 0.25;
  };
  let placedTrees = 0;
  for (let i = 0; i < 300 && placedTrees < 30; i++) {
    const x = (rng() - 0.5) * W; const z = (rng() - 0.5) * D;
    if (!clear(x, z)) continue;
    addBroadleaf(trees, x, height(x, z), z, 0.75 + rng() * 0.55, rng, undefined, { detail: 1 });
    placedTrees += 1;
  }
  for (const g of trees.parts) parts.push({ geometry: g, keepColor: true });

  // --- The plates, low tablets you read looking down ---
  const plates = [];
  const tablet = (x, z, w, h, [u0, v0, u1, v1]) => {
    const g = printedPlate(w, h, 0.03, [u0, 1 - v1, u1, 1 - v0]);
    g.rotateX(-48 * DEG);
    g.translate(x, B.LAND + 0.12 + (h / 2) * Math.sin(42 * DEG), z);
    plates.push({ geometry: g, color: 0xffffff });
    // A short stand under each one, so it does not float.
    for (const dx of [-w * 0.32, w * 0.32]) parts.push({ geometry: rod([x + dx, height(x + dx, z) - 0.06, z], [x + dx, B.LAND + 0.12 + (h / 2) * Math.sin(42 * DEG), z - 0.03], 0.03, 8, 0), color: 0x2b2f35 });
  };
  const NW = 1.9; const NH = 0.58;
  const inner = 1.08;
  tablet(-inner, B.ROWS[0] + 1.15, NW, NH, [0, 0, 0.5, 0.32]);
  tablet(-inner, B.ROWS[1] + 1.15, NW, NH, [0.5, 0, 1, 0.32]);
  tablet(inner, B.ROWS[0] + 1.15, NW, NH, [0, 0.32, 0.5, 0.64]);
  tablet(inner, B.ROWS[1] + 1.15, NW, NH, [0.5, 0.32, 1, 0.64]);
  // The legend stands on the block's front face, the first thing a student reads.
  const legend = printedPlate(4.5, 0.8, 0.02, [0, 0, 1, 0.36]);
  legend.translate(0, 0.77, D / 2 + 0.025);
  plates.push({ geometry: legend, color: 0xffffff });
  root.add(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.62, metalness: 0.04 })));
  root.add(noShadow(mesh(mergeParts(plates), standard({ vertexColors: true, map: canvasTexture(2048, 1024, bridgePlates), roughness: 0.6 }))));

  // --- One tiny truck per bridge, in one mesh ---
  const skin = new RigidSkin();
  const truckNames = ['truck0', 'truck1', 'truck2', 'truck3'];
  const truckColors = [0xf0c02c, 0xf0c02c, 0xf0c02c, 0xf0c02c];
  truckNames.forEach((name, i) => {
    const C = truckColors[i];
    skin.add(name, block(-0.34, 0.1, -0.13, 0.12, 0.34, 0.13), C);
    skin.add(name, prism([[0.13, 0.08], [0.36, 0.08], [0.36, 0.2], [0.3, 0.32], [0.13, 0.32]], -0.125, 0.125, { crease: 30 }), 0x2e3338);
    skin.add(name, block(-0.36, 0.06, -0.12, 0.36, 0.1, 0.12), 0x2a2d31);
    for (const x of [-0.24, 0.22]) {
      for (const z of [-0.12, 0.12]) skin.add(name, axisZ(lathed([[0, -0.03], [0.055, -0.03], [0.055, 0.03], [0, 0.03]], 10)).translate(x, 0.055, z), 0x16181b);
    }
  });
  const skinMesh = skin.build(standard({ vertexColors: true, roughness: 0.5, metalness: 0.1 }), new THREE.Sphere(V(0, 1.8, 0.8), 11));
  root.add(skinMesh);

  const trucks = [
    { name: 'truck0', cx: -B.C, zb: B.ROWS[0], y: () => B.DECK, phase: 0.2 },
    { name: 'truck1', cx: -B.C, zb: B.ROWS[1], y: () => B.DECK, phase: 0.74 },
    { name: 'truck2', cx: B.C, zb: B.ROWS[0], y: (x) => BRIDGES.humpY(x), phase: 0.72 },
    { name: 'truck3', cx: B.C, zb: B.ROWS[1], y: () => B.DECK, phase: 0.28 },
  ];
  const RUN = B.ROAD_X - 0.42;
  const qY = new THREE.Quaternion(); const qZ = new THREE.Quaternion(); const m = new THREE.Matrix4();
  const AY = V(0, 1, 0); const AZ = V(0, 0, 1);
  const pos = V(); const one = V(1, 1, 1);
  const setPose = (t) => {
    for (const tr of trucks) {
      const f = (t / B.TRUCK_PERIOD + tr.phase) % 1;
      const L = 0.44; // of each half period, driving
      let x; let yaw; let lane;
      if (f < L) { x = mix(-RUN, RUN, f / L); yaw = 0; lane = 1; } else if (f < 0.5) { const u = sstep((f - L) / (0.5 - L), 0, 1); x = RUN; yaw = Math.PI * u; lane = 1 - 2 * u; } else if (f < 0.5 + L) { x = mix(RUN, -RUN, (f - 0.5) / L); yaw = Math.PI; lane = -1; } else { const u = sstep((f - 0.5 - L) / (0.5 - L), 0, 1); x = -RUN; yaw = Math.PI + Math.PI * u; lane = -1 + 2 * u; }
      const y = tr.y(x);
      const e = 0.02;
      const slope = (tr.y(x + e) - tr.y(x - e)) / (2 * e);
      qZ.setFromAxisAngle(AZ, Math.atan(slope));
      qY.setFromAxisAngle(AY, yaw);
      qZ.multiply(qY);
      // Driving on the right of the road, whichever way it is going.
      pos.set(tr.cx + x, y + 0.002, tr.zb + lane * B.LANES);
      m.compose(pos, qZ, one);
      skin.set(tr.name, m);
    }
    skin.commit();
  };
  setPose(0);
  let t = 0;
  root.userData.tick = {
    update(dt) {
      if (reducedMotion()) return;
      t += dt;
      setPose(t);
    },
    dispose() {},
  };
  return root;
}

// ===========================================================================================
// THE PONT DU GARD
// ===========================================================================================
//
// Shortened, with the tiers kept in true proportion at 1/20: two big rows whose piers stand one above
// the other, and a row of little arches carrying the channel. What identifies it, in order: the three
// stepped tiers, the great central arch over the river, the rows of stones left standing proud of the
// face, and the warm limestone. A student at ground level looks UP at the channel, so a length of its
// front wall has gone rather than its roof, which is the only way anybody on foot could see the water.

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

function hashCell(i, j, seed = 1) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Near-white coursed masonry, wrapped in both directions. `rows` courses and `stones` stones per course.
function paintCourses(ctx, W, H, { rows, stones, seed, joint = 0.62, blotch = 0.12, varyRow = 0.05, stain = 0, warm = [1, 0.965, 0.885] }) {
  const big = periodicNoise(seed, 5, 5);
  const mid = periodicNoise(seed + 1, 22, 22);
  const fine = periodicNoise(seed + 2, 120, 120);
  const streak = periodicNoise(seed + 3, 34, 3);
  const img = ctx.createImageData(W, H);
  const d = img.data;
  let o = 0;
  const jx = stones / W; const jy = rows / H;
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const rowF = v * rows;
    const row = Math.floor(rowF);
    const fy = rowF - row;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const colF = u * stones + (row % 2) * 0.5 + (hashCell(row, 7, seed) - 0.5) * 0.3;
      const col = Math.floor(colF);
      const fx = colF - col;
      const tone = 1 - varyRow * 2 * hashCell(((col % stones) + stones) % stones, row, seed + 5);
      const dj = Math.min(fy, 1 - fy) / jy;
      const di = Math.min(fx, 1 - fx) / jx;
      const line = Math.min(dj, di * 1.2);
      const jt = line < 1.1 ? joint : line < 2.4 ? mix(joint, 1, (line - 1.1) / 1.3) : 1;
      // A lit top edge on each course, since a coursed wall is read by the shadow lines.
      const lip = fy < 0.12 ? 1.03 : (fy > 0.86 ? 0.95 : 1);
      const k = tone * jt * lip * (1 - blotch * big(u, v) - blotch * 0.8 * mid(u, v)) * (0.96 + 0.09 * fine(u, v)) * (1 - stain * sstep(streak(u, v), 0.6, 0.86));
      d[o++] = 255 * clamp01(k * warm[0]);
      d[o++] = 255 * clamp01(k * warm[1]);
      d[o++] = 255 * clamp01(k * warm[2]);
      d[o++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function tileMaterial(tile, size, seed, opts, params = {}) {
  const map = canvasTexture(tile, tile, (c, w, h) => paintCourses(c, w, h, { seed, ...opts }));
  map.wrapS = THREE.RepeatWrapping; map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1 / size, 1 / size);
  const bump = map.clone();
  bump.colorSpace = THREE.NoColorSpace;
  return standard({ vertexColors: true, map, bumpMap: bump, bumpScale: 0.5, roughness: 0.86, metalness: 0, ...params });
}

const PONT = {
  W: 32, D: 11, WATER: 0.75,
  T1: 4.4, T2: 7.7, T3: 8.85, WATER_TOP: 9.09, WALL_TOP: 9.2, SLAB_TOP: 9.28,
  Z1: 0.5, Z2: 0.375, Z3: 0.25,
  // The two big rows. A pier here is a pier in both, which is what carries the load straight down.
  LOW: [{ c: 0, r: 2 }, { c: -4.5, r: 1.5 }, { c: 4.5, r: 1.5 }],
  MID: [{ c: 0, r: 2 }, { c: -4.5, r: 1.5 }, { c: 4.5, r: 1.5 }, { c: -8.6, r: 1.4 }, { c: 8.6, r: 1.4 }, { c: -12.5, r: 1.25 }, { c: 12.5, r: 1.25 }],
  TOP_N: 23, TOP_PITCH: 1.28, TOP_R: 0.39,
  OPEN: 5.6,
};

export const AQUEDUCT = {
  ...PONT,
  // Real counts against what is shown, for the label and for a script.
  REAL: { lower: 6, middle: 11, top: 35 },
  SHOWN: { lower: PONT.LOW.length, middle: PONT.MID.length, top: PONT.TOP_N },
  ground(x, z = 0) {
    const ax = Math.abs(x - 0.35 * Math.sin(z * 0.35));
    if (ax < 2.2) return mix(PONT.WATER - 0.03, 0.46, sstep(2.2 - ax, 0, 0.8));
    const t = clamp01((ax - 5.5) / 10.5);
    const slope = 0.95 + 6.6 * t ** 1.6;
    const bank = mix(PONT.WATER - 0.03, 0.95, sstep(ax, 2.2, 3.4));
    return Math.max(bank, slope);
  },
};

function buildPontDuGard() {
  const P = PONT;
  const stone = [];
  const detail = [];

  // --- The valley ---
  const rough = (x, z) => 0.3 * sstep(Math.abs(x), 6, 9) * fbm(x * 0.45, z * 0.45, 4, 6) + 0.05 * sstep(Math.abs(x), 3, 4.5) * fbm(x * 1.6, z * 1.6, 3, 2);
  const height = (x, z) => AQUEDUCT.ground(x, z) + rough(x, z);
  const paint = (x, z, y, slope) => {
    const g = fbm(x * 0.9, z * 0.9, 4, 3) * 0.5 + 0.5;
    const speck = fbm(x * 5, z * 5, 2, 8) * 0.5 + 0.5;
    const scrub = mixc(rgb(0x5b7038), rgb(0x76854a), g);
    let c = mixc(scrub, rgb(0x9a927a), sstep(speck, 0.52, 0.7) * 0.6);
    c = mixc(c, rgb(0xb0a68c), sstep(slope, 0.55, 1.15));
    const ax = Math.abs(x - 0.35 * Math.sin(z * 0.35));
    const gravel = mixc(rgb(0xd4c8ac), rgb(0xb7a98c), speck);
    c = mixc(c, gravel, 1 - sstep(ax, 3.2, 5.2));
    return c;
  };
  const block_ = terrainBlock({
    w: P.W, d: P.D, plinth: 0.3, nx: 180, nz: 56, height, water: P.WATER, paint, texW: 1800, relief: 0.4, waterSeed: 12,
    waterPaint: (x, z, depth) => {
      const streak = fbm(x * 2.5, z * 0.7, 3, 11) * 12;
      const c = mixc(rgb(0x6fb6a4), rgb(0x2f7e86), sstep(depth, 0, 0.28));
      return [c[0] + streak, c[1] + streak, c[2] + streak];
    },
    sectionWater: (depth) => mixc(rgb(0x4f9c98), rgb(0x1f5f6c), sstep(depth, 0, 0.3)),
    strata: (x, z, y) => {
      const band = y * 2.6 + 0.4 * noise2(x * 0.3, z * 0.3, 5);
      const t = band - Math.floor(band);
      const n = noise2(x * 3, y * 7, 9) * 7;
      const c = mixc(rgb(0xa8996f), rgb(0xc4b48e), t < 0.5 ? t * 2 : 2 - t * 2);
      return [c[0] + n, c[1] + n, c[2] + n];
    },
    labels: [
      { text: 'PONT DU GARD', x: -10.6, y: 1.42, size: 0.42 },
      { text: 'Shown: 3 + 7 + 23 arches. Real: 6 + 11 + 35', x: 10.8, y: 1.42, size: 0.3 },
    ],
  });
  const root = block_.root;
  const lastChild = root.children[root.children.length - 1];
  root.remove(lastChild);
  lastChild.geometry.dispose();
  lastChild.material.dispose();
  // The ground is an open sheet, and a valley's slopes all lean inward, so a closed-solid volume means
  // nothing for it: it measures negative while facing the right way. Nobody can see its underside.
  block_.landMesh.material.side = THREE.DoubleSide;
  const W2 = P.W / 2; const D2 = P.D / 2;
  detail.push({ geometry: block(-W2 - 0.25, 0, -D2 - 0.25, W2 + 0.25, 0.18, D2 + 0.25), color: 0x3b2a1c });
  detail.push({ geometry: block(-W2 - 0.1, 0.18, -D2 - 0.1, W2 + 0.1, 0.3, D2 + 0.1), color: 0x4c3625 });

  const rng = seededRandom(77);
  const SPRING_LOW = (a) => P.T1 - 0.15 - a.r;
  const SPRING_MID = (a) => P.T2 - 0.15 - a.r;
  const arch = (c, r, spring, bottom, n = 28) => [[c - r, bottom], [c + r, bottom], ...arcPts(c, spring, r, 0, Math.PI, n)];

  // --- The lower tier ---
  const L_END = 7.0;
  const lowerOutline = [[-L_END, 0.34], [L_END, 0.34], [L_END, P.T1], [-L_END, P.T1]];
  stone.push({ geometry: prism(lowerOutline, -P.Z1, P.Z1, { holes: P.LOW.map((a) => arch(a.c, a.r, SPRING_LOW(a), 0.4)) }), color: 0xcdb78e });
  // Cutwaters on the two piers that stand at the river's edge, which is what keeps a flood off them.
  for (const x of [-2.5, 2.5]) {
    for (const dir of [-1, 1]) {
      const pts = [[-0.5, -dir * (P.Z1 - 0.02)], [0.5, -dir * (P.Z1 - 0.02)], [0, -dir * (P.Z1 + 0.75)]];
      const cut = prism(pts, 0.34, 1.9, { crease: 25 });
      cut.rotateX(-Math.PI / 2);
      cut.translate(x, 0, 0);
      stone.push({ geometry: cut, color: 0xbfaa82 });
    }
  }

  // --- The middle tier: wider, its outer arches running down on to the hillside ---
  const M_END = 15.3;
  const midOutline = [[-M_END, 0.34], [-L_END, 0.34], [-L_END, P.T1], [L_END, P.T1], [L_END, 0.34], [M_END, 0.34], [M_END, P.T2], [-M_END, P.T2]];
  const midHoles = P.MID.map((a) => {
    const bottom = Math.abs(a.c) < 7 ? P.T1 + 0.0 : 0.5;
    return { a, poly: arch(a.c, a.r, SPRING_MID(a), Math.abs(a.c) < 7 ? P.T1 + 0.12 : bottom) };
  });
  stone.push({ geometry: prism(midOutline, -P.Z2, P.Z2, { holes: midHoles.map((h) => h.poly) }), color: 0xd6c096 });

  // --- The top tier, in little arches, and the channel on its back ---
  const topW = P.TOP_N * P.TOP_PITCH;
  const T_END = 15.3;
  const topArches = [];
  for (let i = 0; i < P.TOP_N; i++) topArches.push({ c: -topW / 2 + P.TOP_PITCH * (i + 0.5), r: P.TOP_R });
  const topSpring = P.T3 - 0.25 - P.TOP_R;
  stone.push({
    geometry: prism([[-T_END, P.T2], [T_END, P.T2], [T_END, P.T3], [-T_END, P.T3]], -P.Z3, P.Z3, { holes: topArches.map((a) => arch(a.c, a.r, topSpring, P.T2 + 0.05, 12)) }),
    color: 0xdcc69c,
  });
  // The channel's walls. Its front wall has gone along the opened length, and its ends are broken in steps.
  const O = P.OPEN; const WT = P.WALL_TOP; const T3 = P.T3;
  stone.push({ geometry: feetBlock(-T_END, T3, -P.Z3, T_END, WT, -0.13), color: 0xcfb98f });
  for (const side of [-1, 1]) {
    const a = side * O; const b = side * T_END;
    stone.push({ geometry: feetBlock(Math.min(a + side * 0.5, b), T3, 0.13, Math.max(a + side * 0.5, b), WT, P.Z3), color: 0xcfb98f });
    // The break: three courses, stepping back.
    for (let k = 0; k < 3; k++) {
      const h0 = T3 + (k * (WT - T3)) / 3; const h1 = T3 + ((k + 1) * (WT - T3)) / 3;
      const x0 = a + side * (k * 0.17); const x1 = a + side * 0.5;
      stone.push({ geometry: feetBlock(Math.min(x0, x1), h0, 0.13, Math.max(x0, x1), h1, P.Z3), color: 0xc9b388 });
    }
  }
  // The floor's front lip along the opening, so the water shows from below.
  // --- Stone cover slabs, separate stones with a gap between them, stopping short of the opening ---
  for (let x = -T_END + 0.02; x < T_END - 0.5; x += 0.56) {
    if (Math.abs(x + 0.26) < O + 0.25) {
      // Over the opening only every other slab survives, on the back wall, to show how it was roofed.
      if (Math.floor((x + 100) / 0.56) % 3) continue;
      const tilt = block(x, WT, -P.Z3 - 0.01, x + 0.52, P.SLAB_TOP, 0.06);
      detail.push({ geometry: tilt, color: 0xcab48c });
      continue;
    }
    const c = new THREE.Color(0xd4bf97).multiplyScalar(0.86 + rng() * 0.24);
    detail.push({ geometry: block(x, WT, -P.Z3 - 0.02, x + 0.52, P.SLAB_TOP, P.Z3 + 0.02), color: c.getHex() });
  }

  // --- Voussoirs: real wedges, proud of the wall on both faces ---
  const voussoirs = (c, r, spring, ring, N, faceZ, dz, tone) => {
    const G = 0.008;
    for (let i = 0; i < N; i++) {
      const a0 = Math.PI - (Math.PI * i) / N - G; const a1 = Math.PI - (Math.PI * (i + 1)) / N + G;
      const key = i === Math.floor(N / 2);
      const rO = r + ring * (key ? 1.22 : (i % 2 ? 1.0 : 0.92));
      const pt = (a, q) => [c + Math.cos(a) * q, spring + Math.sin(a) * q];
      const o = [pt(a1, r - 0.012), pt(a1, rO), pt(a0, rO), pt(a0, r - 0.012)];
      const col = new THREE.Color(tone).multiplyScalar(0.8 + rng() * 0.28);
      for (const f of [1, -1]) {
        const z0 = f > 0 ? faceZ - 0.01 : -faceZ - dz; const z1 = f > 0 ? faceZ + dz : -faceZ + 0.01;
        detail.push({ geometry: prism(o, z0, z1, { crease: 25 }), color: col.getHex() });
      }
    }
  };
  for (const a of P.LOW) voussoirs(a.c, a.r, SPRING_LOW(a), 0.42, a.r >= 2 ? 25 : 19, P.Z1, 0.035, 0xc8b288);
  for (const a of P.MID) voussoirs(a.c, a.r, SPRING_MID(a), 0.38, a.r >= 2 ? 25 : (a.r >= 1.4 ? 19 : 17), P.Z2, 0.035, 0xd2bc92);
  for (const a of topArches) voussoirs(a.c, a.r, topSpring, 0.13, 9, P.Z3, 0.016, 0xdac49a);

  // --- The string courses that mark each tier ---
  const course = (x0, x1, y, z, h = 0.1) => detail.push({ geometry: block(x0, y, -z, x1, y + h, z), color: 0xc2ac82 });
  course(-L_END, L_END, P.T1 - 0.1, P.Z1 + 0.05);
  course(-T_END, T_END, P.T2 - 0.1, P.Z2 + 0.05);
  course(-T_END, T_END, P.T3 - 0.08, P.Z3 + 0.035, 0.08);

  // --- The bosses: the signature. Stones left standing proud in rows, for the scaffolding that built it ---
  const inHole = (arches, x, y, spring, m) => arches.some((a) => {
    const sp = spring(a);
    if (Math.abs(x - a.c) > a.r + m) return false;
    if (y <= sp) return true;
    return Math.hypot(x - a.c, y - sp) < a.r + m;
  });
  const addBosses = (x0, x1, y0, y1, arches, spring, faceZ) => {
    for (let y = y0; y < y1; y += 0.62) {
      for (let x = x0; x < x1; x += 0.58) {
        const jx = x + (Math.floor(y * 3) % 2) * 0.29;
        if (inHole(arches, jx, y, spring, 0.56) || jx > x1) continue;
        if (y < height(jx, faceZ) + 0.25) continue;
        const w = 0.075 + rng() * 0.03; const h = 0.05 + rng() * 0.02; const d = 0.05 + rng() * 0.03;
        for (const f of [1, -1]) {
          const zA = f > 0 ? faceZ - 0.01 : -faceZ - d; const zB = f > 0 ? faceZ + d : -faceZ + 0.01;
          detail.push({ geometry: block(jx - w, y - h, zA, jx + w, y + h, zB), color: new THREE.Color(0xd9c49c).multiplyScalar(0.92 + rng() * 0.18).getHex() });
        }
      }
    }
  };
  addBosses(-L_END + 0.2, L_END - 0.2, 1.0, P.T1 - 0.25, P.LOW, SPRING_LOW, P.Z1);
  addBosses(-M_END + 0.25, M_END - 0.25, P.T1 + 0.35, P.T2 - 0.25, P.MID, SPRING_MID, P.Z2);
  addBosses(-M_END + 0.25, -L_END, 1.2, P.T1 + 0.2, P.MID, SPRING_MID, P.Z2);
  addBosses(L_END, M_END - 0.25, 1.2, P.T1 + 0.2, P.MID, SPRING_MID, P.Z2);

  // --- The channel's water, and rocks along the river ---
  detail.push({ geometry: block(-T_END + 0.02, T3, -0.13, T_END - 0.02, P.WATER_TOP, 0.13), color: 0x2f8fb0 });
  for (let i = 0; i < 46; i++) {
    const x = (rng() - 0.5) * 12; const z = (rng() - 0.5) * (P.D - 0.8);
    const r = 0.08 + rng() * rng() * 0.34;
    const ax = Math.abs(x - 0.35 * Math.sin(z * 0.35));
    if (ax < 1.9 || Math.abs(z) < 1.15 && Math.abs(x) < 7) continue;
    const g = new THREE.IcosahedronGeometry(1, 1);
    const sx = r * (1 + rng() * 0.6); const sy = r * (0.6 + rng() * 0.4); const sz = r * (0.8 + rng() * 0.6);
    g.scale(sx, sy, sz); g.rotateY(rng() * 3);
    g.translate(x, height(x, z) + sy * 0.3, z);
    detail.push({ geometry: g, color: new THREE.Color(0xb5aa92).multiplyScalar(0.72 + rng() * 0.3).getHex() });
  }

  // Scrub oak on the hillsides, kept back from the bridge's faces.
  const trees = new Batch();
  let placed = 0;
  for (let i = 0; i < 260 && placed < 34; i++) {
    const x = (rng() - 0.5) * P.W; const z = (rng() - 0.5) * P.D;
    if (Math.abs(x) < 7.5 || Math.abs(z) < 1.5 || Math.abs(x) > P.W / 2 - 0.3 || Math.abs(z) > P.D / 2 - 0.3) continue;
    addBroadleaf(trees, x, height(x, z), z, 0.9 + rng() * 0.8, rng, [0x4c6a34, 0x5d7a3e, 0x3f5a2e], { detail: 1, trunk: 0x4f3f2d });
    placed += 1;
  }
  for (const g of trees.parts) detail.push({ geometry: g, keepColor: true });

  root.add(mesh(mergeParts(stone), tileMaterial(1024, 6, 41, { rows: 22, stones: 9, joint: 0.66, blotch: 0.16, varyRow: 0.06, stain: 0.12 })));
  root.add(mesh(mergeParts(detail), standard({ vertexColors: true, roughness: 0.82, metalness: 0, ...relief('stone', { seed: 5, repeat: 0.7, strength: 0.3 }) })));

  // --- Water running along the opened length: lighter patches sliding by, unseen at both ends ---
  const flow = [];
  const PITCH = 4.8;
  const steps = 4;
  const frng = seededRandom(19);
  const pattern = [];
  for (let i = 0; i < steps; i++) pattern.push({ at: (i / steps) * PITCH + frng() * 0.3, len: 0.42 + frng() * 0.34, y: 0.06 + frng() * 0.1 });
  for (let k = -3; k <= 2; k++) {
    for (const q of pattern) {
      const x = k * PITCH + q.at;
      const top = P.WATER_TOP;
      flow.push({ geometry: block(x, top - q.y - 0.05, 0.128, x + q.len, top - q.y, 0.1335), color: 0xbfeaf2 });
      flow.push({ geometry: block(x + 0.06, top - 0.002, -0.128, x + q.len - 0.06, top + 0.004, 0.1335), color: 0xbfeaf2 });
      flow.push({ geometry: block(x + 0.2, top - q.y - 0.14, 0.128, x + 0.2 + q.len * 0.6, top - q.y - 0.11, 0.1335), color: 0x8fd6e6 });
    }
  }
  const flowGroup = new THREE.Group();
  flowGroup.add(noShadow(mesh(mergeParts(flow), standard({ vertexColors: true, roughness: 0.3, metalness: 0, emissive: 0x153d4a }))));
  root.add(flowGroup);

  const SPEED = 0.9;
  let t = 0;
  root.userData.tick = {
    update(dt) {
      if (reducedMotion()) return;
      t += dt;
      // The train is periodic, so it can wrap by one period with nothing to see.
      flowGroup.position.x = (t * SPEED) % PITCH;
    },
    dispose() {},
  };
  return root;
}

// ===========================================================================================
// THE ZIGGURAT OF UR
// ===========================================================================================
//
// What identifies it, in order: three monumental stairs meeting at one gate; a strong batter with
// regular shallow buttresses all the way round; a skin of baked brick in dark bitumen; and rows of
// weeper holes. Bricks are a texture laid in feet with v taken from height, so a course stays level on
// a sloped wall and does not stretch. The lowest stage is the only one that survives well, so the
// reconstructed upper stages and the shrine are painted a shade apart, and a plate says why.

const ZIG = {
  BASE_Y: 0.3, CZ: -1.0,
  STAGES: [
    { a: 5.25, b: 3.75, h: 1.9, k: 0.46, cz: 0, color: 0xc08f60 },
    { a: 3.45, b: 2.35, h: 1.1, k: 0.24, cz: -0.28, color: 0xd5b08a },
    { a: 2.15, b: 1.5, h: 0.8, k: 0.16, cz: -0.42, color: 0xddbc99 },
  ],
  SHRINE: { a: 1.05, b: 0.78, h: 0.72, color: 0xd9c8ab },
  PITCH: 0.56, BUTT_W: 0.22, BUTT_D: 0.095,
};

function buttressed(a, b, cx, cz, pitch, w, d) {
  const pts = [];
  const sides = [
    { from: [-a, b], along: [1, 0], out: [0, 1], len: 2 * a },
    { from: [a, b], along: [0, -1], out: [1, 0], len: 2 * b },
    { from: [a, -b], along: [-1, 0], out: [0, -1], len: 2 * a },
    { from: [-a, -b], along: [0, 1], out: [-1, 0], len: 2 * b },
  ];
  const put = (S, s, o) => pts.push([cx + S.from[0] + S.along[0] * s + S.out[0] * o, cz + S.from[1] + S.along[1] * s + S.out[1] * o]);
  for (const S of sides) {
    const n = Math.max(2, Math.round(S.len / pitch));
    const step = S.len / n;
    // A heavier pier at each corner, then one at each pitch between.
    put(S, 0, d * 1.3);
    put(S, w * 0.9, d * 1.3);
    put(S, w * 0.9, 0);
    for (let i = 1; i < n; i++) {
      const c = step * i;
      put(S, c - w / 2, 0); put(S, c - w / 2, d); put(S, c + w / 2, d); put(S, c + w / 2, 0);
    }
    put(S, S.len - w * 0.9, 0);
    put(S, S.len - w * 0.9, d * 1.3);
  }
  return pts;
}

// A wall leaning inward: `outline` is the plan at the bottom, walked counter-clockwise from above. UVs
// are in feet with v the height, which is what keeps a course of brick level on a slope.
function battered(outline, y0, y1, sx, sz, cx, cz) {
  const pos = []; const uv = [];
  const put = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u, v); };
  const top = outline.map(([x, z]) => [cx + (x - cx) * sx, cz + (z - cz) * sz]);
  let run = 0;
  for (let i = 0; i < outline.length; i++) {
    const j = (i + 1) % outline.length;
    const l = Math.hypot(outline[j][0] - outline[i][0], outline[j][1] - outline[i][1]);
    const a0 = [outline[i][0], y0, outline[i][1], run, y0];
    const b0 = [outline[j][0], y0, outline[j][1], run + l, y0];
    const b1 = [top[j][0], y1, top[j][1], run + l, y1];
    const a1 = [top[i][0], y1, top[i][1], run, y1];
    for (const v of [a0, b0, b1, a0, b1, a1]) put(...v);
    run += l;
  }
  for (const [A, B, C] of capTris(top.map(([x, z]) => [x, -z]), [])) {
    // capTris is counter-clockwise in (x, -z), which is facing up here.
    for (const p of [A, B, C]) put(p[0], y1, -p[1], p[0], -p[1]);
  }
  return soup(pos, uv, 25);
}

// Steps as a closed solid: a run along `u`, seen from the side, with a flat bottom.
function stepOutline(u0, u1, y0, y1, n) {
  const pts = [[u0, y0 - 0.3], [u1, y0 - 0.3]];
  for (let i = n; i > 0; i--) {
    const uA = mix(u0, u1, i / n); const uB = mix(u0, u1, (i - 1) / n);
    const y = mix(y0, y1, i / n);
    pts.push([uA, y], [uB, y]);
  }
  return pts;
}

function paintCourtyard(ctx, W, H) {
  const big = periodicNoise(3, 7, 7); const mid = periodicNoise(4, 26, 26); const fine = periodicNoise(5, 140, 140);
  const img = ctx.createImageData(W, H);
  const d = img.data;
  let o = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W; const v = y / H;
      const k = 0.86 + 0.16 * big(u, v) + 0.1 * mid(u, v) + 0.1 * fine(u, v);
      d[o++] = clamp01(0.74 * k) * 255; d[o++] = clamp01(0.62 * k) * 255; d[o++] = clamp01(0.45 * k) * 255; d[o++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // The worn path up to the stair, and the footing lines of what once stood round the court.
  const rng = seededRandom(8);
  ctx.fillStyle = 'rgba(150,112,76,0.34)';
  ctx.fillRect(W * 0.44, H * 0.55, W * 0.12, H * 0.45);
  ctx.strokeStyle = 'rgba(112,84,58,0.5)';
  ctx.lineWidth = 7;
  for (let i = 0; i < 14; i++) {
    const x = rng() * W; const y = rng() * H; const w = 40 + rng() * 140; const h = 30 + rng() * 100;
    if (x > W * 0.14 && x < W * 0.84 && y > H * 0.07 && y < H * 0.8) continue;
    ctx.strokeRect(x, y, w, h);
  }
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${90 + rng() * 60},${70 + rng() * 40},${50 + rng() * 30},${0.1 + rng() * 0.2})`;
    ctx.fillRect(rng() * W, rng() * H, 2 + rng() * 5, 2 + rng() * 4);
  }
}

function buildZiggurat() {
  const Z = ZIG;
  const root = new THREE.Group();
  const brick = [];
  const detail = [];
  const Y0 = Z.BASE_Y;
  const DARK = 0x1c1612; const STAIR_UP = 0xdcbe98;

  // --- The base and the court ---
  const GW = 7.4; const GD = 6.7;
  detail.push({ geometry: block(-GW - 0.15, 0, -GD - 0.15, GW + 0.15, 0.14, GD + 0.15), color: 0x4c3625 });
  detail.push({ geometry: block(-GW, 0.14, -GD, GW, Y0 - 0.004, GD), color: 0x9c8460 });
  const court = new THREE.PlaneGeometry(2 * GW, 2 * GD);
  court.rotateX(-Math.PI / 2);
  court.translate(0, Y0, 0);
  const courtTex = canvasTexture(1024, 1024, paintCourtyard);
  const courtMesh = mesh(court, standard({ map: courtTex, roughness: 0.96, metalness: 0 }));
  courtMesh.castShadow = false;
  root.add(courtMesh);

  // --- The low wall of the court: a line that says how big all this is ---
  const WM = 0.3; const WT = 0.22; const WH = 0.3;
  const wallRun = (x0, z0, x1, z1) => brick.push({ geometry: feetBlock(Math.min(x0, x1), Y0 - 0.02, Math.min(z0, z1), Math.max(x0, x1), Y0 + WH, Math.max(z0, z1)), color: 0xa98158 });
  const OX = GW - WM; const OZ = GD - WM;
  wallRun(-OX, -OZ, OX, -OZ + WT);
  wallRun(-OX, -OZ, -OX + WT, OZ);
  wallRun(OX - WT, -OZ, OX, OZ);
  const GATE = 1.3;
  wallRun(-OX, OZ - WT, -GATE, OZ);
  wallRun(GATE, OZ - WT, OX, OZ);
  for (const x of [-GATE, GATE]) brick.push({ geometry: feetBlock(x - 0.3, Y0 - 0.02, OZ - WT - 0.1, x + 0.3, Y0 + WH + 0.28, OZ + 0.1), color: 0xb48b60 });

  // --- The three stages ---
  let y = Y0;
  const tops = [];
  const stageInfo = [];
  Z.STAGES.forEach((S, i) => {
    const cz = Z.CZ + S.cz;
    const plan = buttressed(S.a, S.b, 0, cz, Z.PITCH, Z.BUTT_W, Z.BUTT_D);
    const sx = (S.a - S.k) / S.a; const sz = (S.b - S.k) / S.b;
    const g = battered(plan, y, y + S.h, sx, sz, 0, cz);
    brick.push({ geometry: g, color: S.color });
    stageInfo.push({ ...S, y0: y, y1: y + S.h, cz, sx, sz });
    y += S.h;
    tops.push(y);
    // A parapet round the terrace, thin and low.
    const aT = S.a * sx + 0.02; const bT = S.b * sz + 0.02;
    const ph = 0.09; const pt = 0.06;
    const rail = (x0, z0, x1, z1) => brick.push({ geometry: feetBlock(x0, y - 0.01, z0, x1, y + ph, z1), color: S.color });
    rail(-aT, cz - bT, aT, cz - bT + pt);
    rail(-aT, cz - bT, -aT + pt, cz + bT);
    rail(aT - pt, cz - bT, aT, cz + bT);
    const gap = i === 0 ? 0.95 : 0.55;
    rail(-aT, cz + bT - pt, -gap, cz + bT);
    rail(gap, cz + bT - pt, aT, cz + bT);
  });

  // --- Weeper holes, in rows, in the lowest stage ---
  const S0 = stageInfo[0];
  const faceAt = (half, s, yy) => half * (1 - (1 - s) * ((yy - S0.y0) / S0.h));
  const weepers = [];
  const holeW = 0.05; const holeH = 0.075;
  const weep = (x, yy, z, nx, nz) => {
    // A black slot with a stone frame round it, built forward of the wall, since there is no cutting a hole.
    const side = nx !== 0;
    const m = (cx, cy, cz, w, h, dpt, col) => {
      const hw = side ? dpt : w; const hd = side ? w : dpt;
      weepers.push({ geometry: block(cx - hw, cy - h, cz - hd, cx + hw, cy + h, cz + hd), color: col });
    };
    const fx = x + nx * 0.025; const fz = z + nz * 0.025;
    m(fx, yy, fz, holeW, holeH, 0.022, DARK);
    const frame = 0x8e7150;
    const ox = nz !== 0 ? holeW + 0.02 : 0; const oz = nx !== 0 ? holeW + 0.02 : 0;
    m(fx - ox, yy, fz - oz, 0.02, holeH + 0.02, 0.018, frame);
    m(fx + ox, yy, fz + oz, 0.02, holeH + 0.02, 0.018, frame);
    m(fx, yy + holeH + 0.02, fz, holeW + 0.04, 0.02, 0.022, 0xa48660);
  };
  const rowsY = [S0.y0 + 0.36, S0.y0 + 0.74, S0.y0 + 1.12, S0.y0 + 1.5];
  // Where a side flight's top surface is, at this x: a hole below it is behind the stair.
  const flightTop = (x) => mix(S0.y1, S0.y0, clamp01((Math.abs(x) - 0.98) / (4.72 - 0.98)));
  for (const yy of rowsY) {
    const nA = Math.round((2 * S0.a) / Z.PITCH); const stepA = (2 * S0.a) / nA;
    const nB = Math.round((2 * S0.b) / Z.PITCH); const stepB = (2 * S0.b) / nB;
    for (let i = 0; i < nA; i++) {
      const x = -S0.a + stepA * (i + 0.5);
      const xs = x * (1 - (1 - S0.sx) * ((yy - S0.y0) / S0.h));
      const zf = S0.cz + faceAt(S0.b, S0.sz, yy);
      // On the front only those clear of the side stairs are built, in a band climbing above them.
      if (yy > flightTop(x) + 0.28) weep(xs, yy, zf, 0, 1);
      weep(xs, yy, S0.cz - faceAt(S0.b, S0.sz, yy), 0, -1);
    }
    for (let i = 0; i < nB; i++) {
      const z = -S0.b + stepB * (i + 0.5);
      const zs = S0.cz + z * (1 - (1 - S0.sz) * ((yy - S0.y0) / S0.h));
      const xf = faceAt(S0.a, S0.sx, yy);
      weep(xf, yy, zs, 1, 0);
      weep(-xf, yy, zs, -1, 0);
    }
  }
  for (const w of weepers) detail.push(w);

  // --- The three stairs, meeting at the landing under the gate ---
  const H1 = S0.y1; // the top of the first stage
  const frontZ = S0.cz + S0.b;
  const LANDZ0 = S0.cz + S0.b * S0.sz - 0.1; const LANDZ1 = frontZ + 0.72;
  const crossSolid = (outline, x0, x1) => { const g = prism(outline, -x1, -x0, { crease: 25 }); g.rotateY(-Math.PI / 2); return g; };
  const STEP = (run) => Math.max(5, Math.round(run / 0.13));
  // A stair is read by its risers, which face away from a high sun: treads pale, risers dark.
  const stepsPart = (g, tread, riser, side) => {
    const n = g.attributes.normal; const arr = new Float32Array(n.count * 3);
    const T = lin(tread); const R = lin(riser); const Sd = lin(side);
    for (let i = 0; i < n.count; i++) {
      const c = n.getY(i) > 0.7 ? T : (n.getY(i) < -0.2 ? Sd : (Math.abs(n.getX(i)) > 0.7 && riserAxis === 'z') || (Math.abs(n.getZ(i)) > 0.7 && riserAxis === 'x') ? Sd : R);
      arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    detail.push({ geometry: g, keepColor: true });
  };
  let riserAxis = 'z';
  // The central flight, straight out from the front. Its outline is in (z, y).
  const CW = 0.62;
  const centreFoot = LANDZ1 + 3.15;
  stepsPart(crossSolid(stepOutline(centreFoot, LANDZ1, Y0, H1, STEP(3.15)), -CW, CW), 0xd1a678, 0x6b4a2c, 0x9d7348);
  // Its side walls, a little higher than the treads and sloping with them.
  const parapet = (uFoot, uTop, y0, y1, h) => [[uFoot, y0 - 0.02], [uTop, y0 - 0.02], [uTop, y1 + h], [uFoot, y0 + h]];
  for (const side of [-1, 1]) {
    const a2 = side > 0 ? CW : -CW - 0.11; const b2 = side > 0 ? CW + 0.11 : -CW;
    brick.push({ geometry: crossSolid(parapet(centreFoot + 0.05, LANDZ1, Y0, H1, 0.1), a2, b2), color: 0xa97e52 });
  }
  // The two side flights, climbing along the wall to the landing. Their outlines are in (x, y).
  const SIDE_W = 0.62;
  const LX = 0.98;
  const sideFoot = 4.72;
  riserAxis = 'x';
  for (const side of [-1, 1]) {
    const flight = stepOutline(side * sideFoot, side * LX, Y0, H1, STEP(sideFoot - LX));
    const z1 = frontZ + 0.72; const z0 = z1 - SIDE_W;
    stepsPart(prism(flight, z0, z1, { crease: 25 }), 0xd1a678, 0x6b4a2c, 0x9d7348);
    const front = parapet(side * (sideFoot + 0.05), side * LX, Y0, H1, 0.1);
    brick.push({ geometry: prism(front, z1, z1 + 0.11, { crease: 25 }), color: 0xa97e52 });
    // Filled solid back to the wall, or there would be a slot behind it down to the ground.
    const backing = [[side * sideFoot, Y0 - 0.02], [side * LX, Y0 - 0.02], [side * LX, H1 - 0.05], [side * sideFoot, Y0 + 0.01]];
    brick.push({ geometry: prism(backing, S0.cz + S0.b * S0.sz - 0.04, z0, { crease: 25 }), color: 0xa97e52 });
  }
  // The landing: a solid block where the three arrive.
  brick.push({ geometry: feetBlock(-LX - 0.02, Y0 - 0.02, LANDZ0, LX + 0.02, H1, LANDZ1 + 0.11), color: 0xb78857 });

  // --- The gate, over the landing ---
  const gateZ = (LANDZ0 + LANDZ1) / 2 - 0.1;
  const GH = 0.72; const GW2 = 0.58; const GD2 = 0.34;
  const gate = (buttressed(GW2, GD2, 0, gateZ, 0.3, 0.1, 0.04));
  brick.push({ geometry: battered(gate, H1 - 0.01, H1 + GH, 0.94, 0.92, 0, gateZ), color: 0xbf9365 });
  for (let i = -2; i <= 2; i++) detail.push({ geometry: block(i * 0.23 - 0.07, H1 + GH - 0.01, gateZ - 0.3, i * 0.23 + 0.07, H1 + GH + 0.1, gateZ + 0.3), color: 0xa98158 });
  const doorZ = gateZ + GD2 * 0.92 + 0.04;
  const arched = (w, h) => [[-w, 0], [w, 0], [w, h], ...arcPts(0, h, w, 0, Math.PI, 12).slice(1)];
  // A doorway, built forward: a dark panel, and an arched frame standing further out than it.
  const doorG = prism(arched(0.19, 0.28), 0, 0.03, { crease: 30 });
  doorG.translate(0, H1, doorZ);
  detail.push({ geometry: doorG, color: DARK });
  const frameOuter = arched(0.26, 0.28);
  const frameG = prism(frameOuter, 0, 0.05, { holes: [arched(0.19, 0.28).map(([x, yy]) => [x, Math.max(yy, 0.001)])], crease: 30 });
  frameG.translate(0, H1, doorZ);
  detail.push({ geometry: frameG, color: 0x8e6d48 });

  // --- The upper flights, continuing on the same axis ---
  const S1 = stageInfo[1]; const S2 = stageInfo[2];
  const flightUp = (zFoot, zTop, yFoot, yTop, hw, color) => {
    riserAxis = 'z';
    stepsPart(crossSolid(stepOutline(zFoot, zTop, yFoot, yTop, STEP(Math.abs(zFoot - zTop))), -hw, hw), color, 0x7c5a3a, 0xa98a64);
    for (const side of [-1, 1]) {
      const a = side > 0 ? hw : -hw - 0.06; const b = side > 0 ? hw + 0.06 : -hw;
      brick.push({ geometry: crossSolid(parapet(zFoot + 0.03, zTop, yFoot, yTop, 0.08), a, b), color: 0xbf9d76 });
    }
  };
  const s1Front = S1.cz + S1.b * S1.sz;
  const s1Foot = S1.cz + S1.b + 0.45;
  flightUp(s1Foot, s1Front - 0.15, H1, S1.y1, 0.36, STAIR_UP);
  const s2Front = S2.cz + S2.b * S2.sz;
  const s2Foot = S2.cz + S2.b + 0.28;
  flightUp(s2Foot, s2Front - 0.1, S1.y1, S2.y1, 0.28, STAIR_UP);

  // --- The shrine ---
  const SH = Z.SHRINE;
  const shCz = S2.cz - 0.08;
  brick.push({ geometry: battered(buttressed(SH.a, SH.b, 0, shCz, 0.42, 0.14, 0.05), S2.y1, S2.y1 + SH.h, 0.97, 0.96, 0, shCz), color: SH.color });
  detail.push({ geometry: block(-SH.a * 0.97 - 0.06, S2.y1 + SH.h - 0.01, shCz - SH.b * 0.96 - 0.06, SH.a * 0.97 + 0.06, S2.y1 + SH.h + 0.07, shCz + SH.b * 0.96 + 0.06), color: 0xb6a486 });
  const sDoorZ = shCz + SH.b * 0.965 + 0.05;
  const sDoor = prism(arched(0.15, 0.27), 0, 0.03, { crease: 30 });
  sDoor.translate(0, S2.y1, sDoorZ);
  detail.push({ geometry: sDoor, color: DARK });
  const sFrame = prism(arched(0.21, 0.27), 0, 0.05, { holes: [arched(0.15, 0.27).map(([x, yy]) => [x, Math.max(yy, 0.001)])], crease: 30 });
  sFrame.translate(0, S2.y1, sDoorZ);
  detail.push({ geometry: sFrame, color: 0xb9a584 });

  // --- The plate, a low tablet beside the stair ---
  const plate = printedPlate(3.4, 0.86, 0.03, [0, 0, 1, 1]);
  plate.rotateX(-48 * DEG);
  plate.translate(-3.95, Y0 + 0.5, 5.15);
  detail.push({ geometry: rod([-5.0, Y0 - 0.02, 5.1], [-5.0, Y0 + 0.42, 5.1], 0.03, 8, 0), color: 0x3a2d22 });
  detail.push({ geometry: rod([-2.9, Y0 - 0.02, 5.1], [-2.9, Y0 + 0.42, 5.1], 0.03, 8, 0), color: 0x3a2d22 });
  const plateTex = canvasTexture(1024, 260, (ctx, W, H) => {
    ctx.fillStyle = '#ece4d0';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#3a2d1e'; ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2a2015';
    fitFont(ctx, 'ZIGGURAT OF UR', W * 0.9, 76, '800');
    ctx.fillText('ZIGGURAT OF UR', W / 2, H * 0.28);
    ctx.fillStyle = '#4a3b2a';
    fitFont(ctx, 'Darker bottom stage: survives. Paler upper', W * 0.9, 42, '700');
    ctx.fillText('Darker bottom stage: survives. Paler upper', W / 2, H * 0.6);
    fitFont(ctx, 'stages and shrine: a reconstruction.', W * 0.9, 42, '700');
    ctx.fillText('stages and shrine: a reconstruction.', W / 2, H * 0.8);
  });
  root.add(noShadow(mesh(plate, standard({ map: plateTex, roughness: 0.6 }))));

  root.add(mesh(mergeParts(brick), tileMaterial(1024, 2.4, 61, { rows: 26, stones: 7, joint: 0.32, blotch: 0.12, varyRow: 0.09, stain: 0.16, warm: [1, 0.95, 0.88] }, { bumpScale: 0.6 })));
  root.add(mesh(mergeParts(detail), standard({ vertexColors: true, roughness: 0.84, metalness: 0, ...relief('stone', { seed: 9, repeat: 1.5, strength: 0.3 }) })));
  return root;
}

// ===========================================================================================

export const BUILDERS = {
  'four-stroke-engine': () => buildFourStroke(),
  'difference-engine': () => buildDifferenceEngine(),
  'bridge-types': () => buildBridges(),
  'roman-aqueduct': () => buildPontDuGard(),
  'ziggurat-of-ur': () => buildZiggurat(),
};
