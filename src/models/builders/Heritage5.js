import * as THREE from 'three';
import { seededRandom } from '../../PropKit.js';
import {
  revolve, mergeParts, outlineArea, smoothNoise3, solidSurface, solidLoft, smoothed,
} from '../../props/LoftKit.js';
import {
  tube, lin, clamp01, mix, sstep, outward, tintVertices,
} from '../ModelKit.js';

// The Model Database's fifth batch of heritage objects.
//
//   telegraph-key    a key, a sounder with its tape, a gravity cell and a code chart on a desk.
//   goddard-rocket   the 1926 rocket in its launch frame, life size, on a patch of snow.
//   shaduf           a Nile shaduf, life size, on a banked channel with crops on the high side.
//   greek-trireme    TRUE size, 120ft, with all 170 oars.
//   us-capitol       1/20, computed from a table of plan and elevation figures.
//
// Feet at scale 1, origin at the base centre, fresh materials per build, seededRandom only.

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const vec = (p) => new THREE.Vector3(p[0], p[1], p[2]);

function dropDegenerate(g) {
  const pos = g.attributes.position;
  const old = g.index.array;
  const keep = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < old.length; i += 3) {
    a.fromBufferAttribute(pos, old[i]);
    b.fromBufferAttribute(pos, old[i + 1]);
    c.fromBufferAttribute(pos, old[i + 2]);
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-16) keep.push(old[i], old[i + 1], old[i + 2]);
  }
  g.setIndex(keep);
  return g;
}

// A surface of revolution about +Y from `[r, y]` or `[r, y, 'h']` points (h doubles the point, which
// keeps a hard edge), running axis to axis. Its direction is measured, because `revolve` takes its
// winding from it.
function spin(points, { segments = 24 } = {}) {
  const flat = points.map((p) => [p[0], p[1]]);
  const pts = outlineArea(flat) > 0 ? [...points].reverse() : points;
  const out = [];
  for (const p of pts) {
    out.push([p[0], p[1]]);
    if (p[2]) out.push([p[0], p[1]]);
  }
  return outward(dropDegenerate(revolve(out, { segments })));
}

// Geometry authored along +Y, centred on the origin, carried to lie from a to b.
function alongY(geometry, a, b) {
  const A = vec(a);
  const B = vec(b);
  const dir = B.clone().sub(A).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
  return geometry.applyMatrix4(new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
}

function rod(list, color, a, b, r, { sides = 10, r2 = null } = {}) {
  const len = vec(a).distanceTo(vec(b));
  if (len < 1e-4) return;
  list.push({ geometry: alongY(new THREE.CylinderGeometry(r2 ?? r, r, len, sides), a, b), color });
}

function pipe(list, color, points, r, { sides = 8, steps = null, round = 2, section = null, frame = null } = {}) {
  list.push({ geometry: tube(points, r, { sides, steps: steps ?? (points.length - 1) * 5, round, section, frame }), color });
}

function block(list, color, w, h, d, pos, rot = null) {
  list.push({ geometry: new THREE.BoxGeometry(w, h, d), color, position: pos, rotation: rot });
}

function dot(list, color, r, pos, { sides = 10, flat = null, up = null } = {}) {
  const g = new THREE.SphereGeometry(r, sides, Math.max(4, sides >> 1));
  if (flat) g.scale(1, flat, 1);
  if (up) g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, vec(up).normalize()));
  list.push({ geometry: g, color, position: pos });
}

// A box from a to b with `up` fixing which way its `h` runs, so a timber can lie at any angle.
function bar(list, color, a, b, w, h, { up = null } = {}) {
  const A = vec(a);
  const B = vec(b);
  const len = A.distanceTo(B);
  if (len < 1e-4) return;
  const z = B.clone().sub(A).normalize();
  let ref = up ? vec(up).normalize() : Y_AXIS.clone();
  if (Math.abs(ref.dot(z)) > 0.985) ref = Math.abs(z.z) > 0.7 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const x = new THREE.Vector3().crossVectors(ref, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(A.add(B).multiplyScalar(0.5));
  list.push({ geometry: new THREE.BoxGeometry(w, h, len).applyMatrix4(m), color });
}

function texOf(canvas, space, wrap = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = space;
  if (wrap) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

// Polish without an environment map: what the sky would have reflected goes into the vertex colours.
function sheen(geometry, { add = 0, tint = [0.86, 0.93, 1], gain = 0 } = {}) {
  const N = geometry.attributes.normal;
  const C = geometry.attributes.color;
  for (let i = 0; i < N.count; i++) {
    const s = (0.5 + 0.5 * N.getY(i)) ** 3;
    const k = 1 + gain * (s - 0.3);
    const lift = s * add;
    C.setXYZ(i, C.getX(i) * k + lift * tint[0], C.getY(i) * k + lift * tint[1], C.getZ(i) * k + lift * tint[2]);
  }
  return geometry;
}

function meshFrom(geometry, params, { shadow = true, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, ...params }));
  m.castShadow = shadow;
  m.receiveShadow = receive;
  return m;
}

function groupOf(...meshes) {
  const g = new THREE.Group();
  for (const m of meshes) if (m) g.add(m);
  return g;
}

// UVs in feet off whichever axis a vertex's normal is nearest to, with the long way along u, so one
// tile lies at one size on every face of every timber in a merged mesh.
function planarUV(geometry, scale = 1) {
  const P = geometry.attributes.position;
  const N = geometry.attributes.normal;
  const uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const ax = Math.abs(N.getX(i)); const ay = Math.abs(N.getY(i)); const az = Math.abs(N.getZ(i));
    let u; let v;
    if (ay >= ax && ay >= az) { u = P.getX(i); v = P.getZ(i); } else if (az >= ax) { u = P.getX(i); v = P.getY(i); } else { u = P.getZ(i); v = P.getY(i); }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

// A collector of hard-edged flat quads with their own normals, colours and UVs. Non-indexed on
// purpose: a crisp corner is two normals at one position. a, b, c, d run counter-clockwise from outside.
class Soup {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; }

  quad(a, b, c, d, uv, col) {
    const ab = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const ad = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
    let nx = ab[1] * ad[2] - ab[2] * ad[1];
    let ny = ab[2] * ad[0] - ab[0] * ad[2];
    let nz = ab[0] * ad[1] - ab[1] * ad[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const cols = Array.isArray(col[0]) ? col : [col, col, col, col];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const v = [a, b, c, d][i];
      this.p.push(v[0], v[1], v[2]);
      this.n.push(nx, ny, nz);
      this.u.push(uv[i][0], uv[i][1]);
      this.c.push(cols[i][0], cols[i][1], cols[i][2]);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return g;
  }
}

// A helix of real wire round the +Y axis.
function helix(cx, y0, y1, cz, R, turns, wire, { sides = 6, perTurn = 16 } = {}) {
  const pts = [];
  const n = Math.round(turns * perTurn);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    pts.push([cx + Math.cos(a) * R, mix(y0, y1, t), cz + Math.sin(a) * R]);
  }
  return tube(pts, wire, { sides, steps: n, round: 1 });
}

// A grain tile: near-white, its lines running along u, used as map and bump on every timber.
function grainTile(seed, { size = 256, base = 236, streaks = 120 } = {}) {
  const { canvas, ctx } = makeCanvas(size, size);
  const rng = seededRandom(seed);
  ctx.fillStyle = `rgb(${base},${base - 3},${base - 8})`;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < streaks; i++) {
    const y = rng() * size;
    const v = base - 14 - Math.round(rng() * 40);
    ctx.strokeStyle = `rgba(${v},${v - 8},${v - 20},${0.2 + rng() * 0.4})`;
    ctx.lineWidth = 0.5 + rng() * 1.4;
    const wob = 0.4 + rng() * 1.1;
    for (const dy of [-size, 0, size]) {
      ctx.beginPath();
      ctx.moveTo(0, y + dy);
      // Whole cycles across the tile, so it wraps without a seam.
      for (let x = 8; x <= size; x += 8) ctx.lineTo(x, y + dy + Math.sin((x / size) * Math.PI * 4) * wob);
      ctx.stroke();
    }
  }
  return canvas;
}

// ---------------------------------------------------------------------------
// The Morse telegraph
// ---------------------------------------------------------------------------

// INTERNATIONAL Morse, the code a student will find today. It is NOT what the 1844 line ran on:
// Morse and Vail's American code differs in eleven letters (C F J L O P Q R X Y Z). The chart says
// which it is, and the tape is encoded from this same table so a student can decode it with the chart.
const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..',
  J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
  S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
};
const TAPE_MESSAGE = 'WHAT HATH GOD WROUGHT';
const TAPE_ROW_UNITS = 64;
const TAPE_FT_PER_UNIT = 0.05;

// Dot 1, dash 3, 1 between elements, 3 between letters, 7 between words: the standard timing.
function morseMarks(message) {
  const marks = [];
  let at = 0;
  const words = message.split(' ');
  words.forEach((word, w) => {
    [...word].forEach((letter, l) => {
      const code = MORSE[letter];
      if (!code) throw new Error(`no Morse for ${letter}`);
      [...code].forEach((sym, s) => {
        const len = sym === '-' ? 3 : 1;
        marks.push({ at, len });
        at += len;
        if (s < code.length - 1) at += 1;
      });
      if (l < word.length - 1) at += 3;
    });
    if (w < words.length - 1) at += 7;
  });
  return { marks, units: at };
}

// The chart in the upper three quarters of the atlas, the tape in rows below it, blank paper at the foot.
const PAPER = { W: 1024, H: 1024, chartH: 768, rowY: 776, rowH: 64, blankY: 990 };

function paperAtlas() {
  const { W, chartH, rowY, rowH } = PAPER;
  const { canvas, ctx } = makeCanvas(W, PAPER.H);
  ctx.fillStyle = '#f4ecd6';
  ctx.fillRect(0, 0, W, PAPER.H);
  const rng = seededRandom(1844);
  for (let i = 0; i < 500; i++) {
    const v = 226 + Math.round(rng() * 24);
    ctx.fillStyle = `rgba(${v},${v - 7},${v - 28},0.3)`;
    ctx.fillRect(rng() * W, rng() * chartH, 6 + rng() * 40, 2 + rng() * 14);
  }
  // Border and title.
  ctx.strokeStyle = '#3a2413';
  ctx.lineWidth = 6;
  ctx.strokeRect(14, 14, W - 28, chartH - 28);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(24, 24, W - 48, chartH - 48);
  ctx.fillStyle = '#2a1a0d';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 58;
  const title = 'INTERNATIONAL MORSE CODE';
  do { ctx.font = `800 ${size}px Georgia, serif`; size -= 1; } while (ctx.measureText(title).width > W - 120 && size > 20);
  ctx.fillText(title, W / 2, 66);
  ctx.fillStyle = '#7a1f12';
  ctx.fillRect(60, 104, W - 120, 3);
  // Twenty-six rows in three columns, the marks drawn to the code's own 1 : 3 timing.
  const letters = Object.keys(MORSE);
  if (letters.length !== 26 || new Set(Object.values(MORSE)).size !== 26) throw new Error('Morse table is wrong');
  const cols = 3;
  const perCol = 9;
  const top = 118;
  const rowPx = 62;
  const colW = (W - 80) / cols;
  const unit = 17;
  letters.forEach((letter, i) => {
    const c = Math.floor(i / perCol);
    const r = i % perCol;
    const x = 40 + c * colW;
    const y = top + r * rowPx + rowPx / 2;
    ctx.fillStyle = '#2a1a0d';
    ctx.font = '800 48px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(letter, x + 36, y + 2);
    let mx = x + 74;
    for (const sym of MORSE[letter]) {
      ctx.fillStyle = '#16100a';
      if (sym === '.') {
        ctx.beginPath();
        ctx.arc(mx + unit / 2, y, unit * 0.52, 0, Math.PI * 2);
        ctx.fill();
        mx += unit;
      } else {
        const h = unit * 0.9;
        ctx.beginPath();
        ctx.roundRect(mx, y - h / 2, unit * 3, h, h / 2);
        ctx.fill();
        mx += unit * 3;
      }
      mx += unit;
    }
  });
  ctx.fillStyle = '#3a2413';
  ctx.font = 'italic 25px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('A dash lasts as long as three dots. Morse and Vail’s 1844 code differed in some letters.', W / 2, chartH - 44);

  // The tape: every mark goes on the row its unit falls in, in the same ink.
  const { marks, units } = morseMarks(TAPE_MESSAGE);
  const px = W / TAPE_ROW_UNITS;
  ctx.fillStyle = '#efe6cd';
  ctx.fillRect(0, rowY, W, rowH * 3);
  ctx.fillStyle = '#20264a';
  for (const m of marks) {
    let left = m.at;
    let remain = m.len;
    while (remain > 0) {
      const row = Math.floor(left / TAPE_ROW_UNITS);
      const inRow = Math.min(remain, (row + 1) * TAPE_ROW_UNITS - left);
      const x = (left - row * TAPE_ROW_UNITS) * px;
      const y = rowY + row * rowH + rowH * 0.5;
      const h = rowH * 0.3;
      ctx.beginPath();
      ctx.roundRect(x, y - h / 2, inRow * px, h, h / 2);
      ctx.fill();
      left += inRow;
      remain -= inRow;
    }
  }
  if (units > TAPE_ROW_UNITS * 3) throw new Error('tape message outruns its rows');
  ctx.fillStyle = '#f2ead2';
  ctx.fillRect(0, PAPER.blankY, W, PAPER.H - PAPER.blankY);
  return texOf(canvas, THREE.SRGBColorSpace, false);
}

// A closed strip of paper along a path. Its side is parallel transported, so it can curve in plan,
// fold over a desk's edge and lie flat on the floor without twisting.
function ribbonFrames(path, width, startSide, floor = null) {
  const curve = new THREE.CatmullRomCurve3(path.map(vec), false, 'catmullrom', 0.5);
  const len = curve.getLength();
  const N = Math.max(60, Math.round(len * 16));
  const pts = [];
  let side = vec(startSide).normalize();
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = curve.getPointAt(t);
    if (floor) p.y = Math.max(p.y, floor(p));
    const T = curve.getTangentAt(t);
    side = side.clone().addScaledVector(T, -side.dot(T)).normalize();
    pts.push({ p, T, side, up: new THREE.Vector3().crossVectors(side, T).normalize(), s: t * len });
  }
  return { pts, len, width };
}

function ribbonSpan(frames, s0, s1, thick, uvAt, soup, col) {
  const { pts, width } = frames;
  const lerp = (s) => {
    const k = THREE.MathUtils.clamp((s / frames.len) * (pts.length - 1), 0, pts.length - 1 - 1e-6);
    const i = Math.floor(k);
    const f = k - i;
    return {
      p: pts[i].p.clone().lerp(pts[i + 1].p, f),
      side: pts[i].side.clone().lerp(pts[i + 1].side, f).normalize(),
      up: pts[i].up.clone().lerp(pts[i + 1].up, f).normalize(),
      s,
    };
  };
  const stops = [s0];
  for (const f of pts) if (f.s > s0 + 1e-4 && f.s < s1 - 1e-4) stops.push(f.s);
  stops.push(s1);
  const corner = (f, a, b) => {
    const c = f.p.clone().addScaledVector(f.side, a * width * 0.5).addScaledVector(f.up, b * thick);
    return [c.x, c.y, c.z];
  };
  const blank = [[0.5, 0.02], [0.51, 0.02], [0.51, 0.025], [0.5, 0.025]];
  const quad = (a, b, c, d, uv) => {
    // Quads here are authored in frame order, so the winding is fixed by measuring against `up`.
    soup.quad(a, b, c, d, uv, col);
  };
  for (let i = 0; i < stops.length - 1; i++) {
    const A = lerp(stops[i]);
    const B = lerp(stops[i + 1]);
    const a0 = corner(A, -1, 1); const a1 = corner(A, 1, 1); const a2 = corner(A, 1, 0); const a3 = corner(A, -1, 0);
    const b0 = corner(B, -1, 1); const b1 = corner(B, 1, 1); const b2 = corner(B, 1, 0); const b3 = corner(B, -1, 0);
    // top face: the printed one
    quad(a1, b1, b0, a0, [uvAt(A.s, 1), uvAt(B.s, 1), uvAt(B.s, 0), uvAt(A.s, 0)]);
    // bottom and the two edges
    quad(a3, b3, b2, a2, blank);
    quad(a2, b2, b1, a1, blank);
    quad(a0, b0, b3, a3, blank);
    if (i === 0) quad(a0, a3, a2, a1, blank);
    if (i === stops.length - 2) quad(b1, b2, b3, b0, blank);
  }
}

const brassParts = (list) => {
  const g = mergeParts(list);
  return sheen(g, { add: 0.5, tint: [1, 0.86, 0.55], gain: 0.5 });
};

function telegraphKey() {
  const wood = [];
  const brass = [];
  const dark = [];
  const paper = new Soup();
  const glass = [];
  const fluid = [];
  const OAK = 0xa56b35; const WALNUT = 0x5c3518; const MAHOG = 0x6e2d18; const IRON = 0x34373c;
  const BRASS = 0xd7a43c; const BRASS2 = 0xb98a2d; const BLACK = 0x121214; const PLAT = 0xdfe2e6; const STEEL = 0x9aa2aa;
  const GREEN = 0x1f8f45; const ZINC = 0x8f98a0;
  const D = 1.5; // the desk's top

  // --- the desk ----------------------------------------------------------------------------------
  block(wood, OAK, 8, 0.16, 4.4, [0, D - 0.08, 0]);
  block(wood, 0x8f5a2b, 7.92, 0.04, 4.32, [0, D - 0.18, 0]);
  block(wood, 0x7f4f27, 7.3, 0.42, 3.8, [0, D - 0.39, 0]);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * 3.48; const z = sz * 1.76;
      wood.push({
        geometry: spin([[0, 0], [0.13, 0], [0.15, 0.08], [0.1, 0.2], [0.13, 0.4], [0.17, 0.48], [0.17, 0.6], [0.12, 0.68], [0.19, 0.76], [0.19, 1.14], [0, 1.14]], { segments: 18 }),
        color: 0x7a4b25,
        position: [x, 0, z],
      });
    }
  }
  block(wood, 0x7f4f27, 0.16, 0.14, 3.2, [-3.48, 0.34, 0]);
  block(wood, 0x7f4f27, 0.16, 0.14, 3.2, [3.48, 0.34, 0]);
  block(wood, 0x7f4f27, 6.8, 0.14, 0.16, [0, 0.34, 0]);
  // Three drawer fronts proud of the apron, each with a brass pull.
  for (const x of [-2.4, 0, 2.4]) {
    block(wood, 0x996233, 2.2, 0.3, 0.05, [x, D - 0.39, 1.92]);
    dot(brass, BRASS, 0.05, [x, D - 0.39, 1.97], { sides: 10 });
  }

  // --- the key -----------------------------------------------------------------------------------
  const KX = -2.3; const KZ = 0.75;
  const PIV = [KX, D + 0.62, KZ - 0.3];
  const lift = 0.05; // the rise of the lever per foot toward the knob: the gap at the contacts is open
  const leverY = (z) => PIV[1] + (z - PIV[2]) * lift;
  wood.push({ geometry: spinRect(1.2, 0.16, 2.7), color: WALNUT, position: [KX, D + 0.08, KZ] });
  block(brass, BRASS2, 0.54, 0.035, 1.72, [KX, D + 0.175, KZ - 0.42]); // the frame
  // Trunnions, axle, and the knurled lock-nuts on either end.
  for (const sx of [-1, 1]) {
    const x = KX + sx * 0.22;
    brass.push({
      geometry: spin([[0, D + 0.19], [0.09, D + 0.19], [0.09, D + 0.24], [0.05, D + 0.3], [0.045, D + 0.56], [0.075, D + 0.6], [0.075, D + 0.66], [0, D + 0.68]], { segments: 14 }),
      color: BRASS,
      position: [x, 0, PIV[2]],
    });
    rod(brass, BRASS, [x, PIV[1], PIV[2]], [x + sx * 0.14, PIV[1], PIV[2]], 0.032, { sides: 10 });
    rod(dark, STEEL, [x + sx * 0.14, PIV[1], PIV[2]], [x + sx * 0.24, PIV[1], PIV[2]], 0.06, { sides: 12 });
  }
  rod(brass, BRASS, [KX - 0.22, PIV[1], PIV[2]], [KX + 0.22, PIV[1], PIV[2]], 0.035, { sides: 12 });
  // The lever: one tapered bar, deepest over the pivot.
  const LZ0 = KZ - 1.22; const LZ1 = KZ + 1.12;
  const lz = [LZ0, KZ - 0.85, PIV[2] - 0.15, PIV[2] + 0.1, KZ + 0.4, KZ + 0.8, LZ1];
  brass.push({
    geometry: tube(lz.map((z) => [KX, leverY(z), z]), [0.04, 0.052, 0.078, 0.078, 0.052, 0.045, 0.042], { sides: 12, steps: 36, round: 2, section: () => [1.3, 0.85], frame: () => [0, 1, 0] }),
    color: BRASS,
  });
  // The knob: a turned stem and a black hard-rubber mushroom, the part a hand knows.
  const KY = leverY(KZ + 0.98);
  brass.push({ geometry: spin([[0, KY - 0.02], [0.05, KY - 0.02], [0.04, KY + 0.08], [0.06, KY + 0.12], [0.06, KY + 0.17], [0, KY + 0.17]], { segments: 14 }), color: BRASS, position: [KX, 0, KZ + 0.98] });
  dark.push({
    geometry: sheen(tintVertices(spin([[0, KY + 0.12], [0.2, KY + 0.12], [0.26, KY + 0.15], [0.27, KY + 0.19], [0.21, KY + 0.23], [0.2, KY + 0.28], [0.23, KY + 0.34], [0.2, KY + 0.41], [0.1, KY + 0.46], [0, KY + 0.47]], { segments: 30 }), (x, y, z, out) => { out[0] = 0.012; out[1] = 0.012; out[2] = 0.014; }), { add: 0.08 }),
    keepColor: true,
    position: [KX, 0, KZ + 0.98],
  });
  // The contacts: a platinum point on the lever, a platinum anvil on its own insulated pad. The gap
  // between them is the switch, so it is left visibly open.
  const CZ = KZ + 0.56;
  const upperTip = leverY(CZ) - 0.1;
  const gap = 0.06;
  brass.push({ geometry: spin([[0, leverY(CZ) - 0.05], [0.04, leverY(CZ) - 0.05], [0.04, leverY(CZ) + 0.1], [0.075, leverY(CZ) + 0.11], [0.075, leverY(CZ) + 0.2], [0, leverY(CZ) + 0.21]], { segments: 12 }), color: BRASS, position: [KX, 0, CZ] });
  dark.push({ geometry: spin([[0, upperTip], [0.035, upperTip], [0.04, leverY(CZ) - 0.04], [0, leverY(CZ) - 0.03]], { segments: 10 }), color: PLAT, position: [KX, 0, CZ] });
  dark.push({ geometry: spin([[0, D + 0.16], [0.13, D + 0.16], [0.13, D + 0.2], [0, D + 0.2]], { segments: 16 }), color: BLACK, position: [KX, 0, CZ] });
  brass.push({ geometry: spin([[0, D + 0.19], [0.1, D + 0.19], [0.09, D + 0.23], [0.055, D + 0.27], [0.05, upperTip - gap - 0.05], [0, upperTip - gap - 0.05]], { segments: 14 }), color: BRASS, position: [KX, 0, CZ] });
  dark.push({ geometry: spin([[0, upperTip - gap - 0.06], [0.05, upperTip - gap - 0.06], [0.04, upperTip - gap], [0, upperTip - gap]], { segments: 10 }), color: PLAT, position: [KX, 0, CZ] });
  // The spring: real wire, in front of the pivot, which is the side that lifts the knob.
  const SPZ = KZ + 0.12;
  dark.push({ geometry: helix(KX, D + 0.19, leverY(SPZ) - 0.06, SPZ, 0.062, 6, 0.012, { sides: 5, perTurn: 12 }), color: STEEL });
  brass.push({ geometry: spin([[0, D + 0.17], [0.09, D + 0.17], [0.08, D + 0.2], [0, D + 0.2]], { segments: 12 }), color: BRASS, position: [KX, 0, SPZ] });
  brass.push({ geometry: spin([[0, leverY(SPZ) - 0.1], [0.028, leverY(SPZ) - 0.1], [0.028, leverY(SPZ) + 0.08], [0.085, leverY(SPZ) + 0.09], [0.085, leverY(SPZ) + 0.16], [0, leverY(SPZ) + 0.17]], { segments: 12 }), color: BRASS, position: [KX, 0, SPZ] });
  // The back stop: a screw through the lever's tail landing on a pad. It limits how far the knob rises.
  const BKZ = KZ - 1.05;
  const backY = leverY(BKZ);
  brass.push({ geometry: spin([[0, D + 0.19], [0.03, D + 0.19], [0.03, backY + 0.08], [0.07, backY + 0.09], [0.07, backY + 0.16], [0, backY + 0.17]], { segments: 12 }), color: BRASS, position: [KX, 0, BKZ] });
  rod(dark, STEEL, [KX, backY + 0.045, BKZ], [KX, backY + 0.08, BKZ], 0.06, { sides: 6 });
  // The two posts. One sits on the frame's own tab, the other on the strap that runs round to the anvil.
  const postParts = (x, z, y0) => {
    brass.push({
      geometry: spin([[0, y0], [0.1, y0], [0.1, y0 + 0.04], [0.06, y0 + 0.08], [0.06, y0 + 0.2], [0.05, y0 + 0.22], [0.05, y0 + 0.26], [0.085, y0 + 0.27], [0.085, y0 + 0.35], [0.06, y0 + 0.37], [0, y0 + 0.38]], { segments: 14 }),
      color: BRASS,
      position: [x, 0, z],
    });
    return [x, y0 + 0.15, z];
  };
  const POST_Y = D + 0.16;
  const key1 = postParts(KX - 0.42, KZ - 1.02, POST_Y);
  const key2 = postParts(KX + 0.42, KZ - 1.02, POST_Y);
  block(brass, BRASS2, 0.3, 0.025, 0.12, [KX - 0.3, D + 0.172, KZ - 1.02]);
  block(brass, BRASS2, 0.1, 0.025, 1.68, [KX + 0.42, D + 0.172, KZ - 0.18]);
  block(brass, BRASS2, 0.46, 0.025, 0.1, [KX + 0.2, D + 0.172, CZ]);
  for (const [dx, dz] of [[-0.5, -1.2], [0.5, -1.2], [-0.5, 1.2], [0.5, 1.2]]) dot(brass, BRASS2, 0.035, [KX + dx, D + 0.16, KZ + dz], { sides: 8, flat: 0.5 });

  // --- the sounder -------------------------------------------------------------------------------
  const SX = 0.95; const SZ = 0.25;
  wood.push({ geometry: spinRect(1.7, 0.18, 3.1), color: MAHOG, position: [SX, D + 0.09, SZ + 0.15] });
  const SB = D + 0.18;
  block(dark, IRON, 1.05, 0.1, 0.36, [SX, SB + 0.05, SZ - 0.1]); // the yoke that closes the magnet
  const coilY0 = SB + 0.1;
  const coilY1 = coilY0 + 0.86;
  for (const sx of [-1, 1]) {
    const x = SX + sx * 0.32;
    // The spool, brass cheeks on an iron core, and the winding as real insulated wire: two layers.
    brass.push({ geometry: spin([[0, coilY0], [0.27, coilY0], [0.27, coilY0 + 0.05], [0.17, coilY0 + 0.06], [0.17, coilY1 - 0.06], [0.27, coilY1 - 0.05], [0.27, coilY1], [0.08, coilY1 + 0.01], [0, coilY1 + 0.01]], { segments: 26 }), color: BRASS, position: [x, 0, SZ - 0.1] });
    dark.push({ geometry: spin([[0, coilY1], [0.075, coilY1], [0.075, coilY1 + 0.06], [0, coilY1 + 0.07]], { segments: 14 }), color: IRON, position: [x, 0, SZ - 0.1] });
    dark.push({ geometry: helix(x, coilY0 + 0.075, coilY1 - 0.075, SZ - 0.1, 0.205, 25, 0.0165, { sides: 5, perTurn: 15 }), color: GREEN });
    dark.push({ geometry: new THREE.CylinderGeometry(0.195, 0.195, coilY1 - coilY0 - 0.12, 20), color: 0x115c2b, position: [x, (coilY0 + coilY1) / 2, SZ - 0.1] });
  }
  // The armature, a soft-iron bar just clear of the poles, and the brass lever it hangs from.
  const SPY = coilY1 + 0.3;
  const LEV0 = SZ - 1.28;
  const LEV1 = SZ + 1.2;
  const PVZ = SZ - 0.98;
  const sLeverY = (z) => SPY + (z - PVZ) * 0.025;
  const ARM_Z = SZ - 0.1;
  block(dark, IRON, 1.05, 0.1, 0.22, [SX, sLeverY(ARM_Z) - 0.11, ARM_Z]);
  for (const sx of [-1, 1]) rod(dark, STEEL, [SX + sx * 0.32, sLeverY(ARM_Z) - 0.08, ARM_Z], [SX + sx * 0.32, sLeverY(ARM_Z) - 0.02, ARM_Z], 0.05, { sides: 10 });
  brass.push({
    geometry: tube([LEV0, PVZ - 0.1, PVZ + 0.2, SZ + 0.3, SZ + 0.85, LEV1].map((z) => [SX, sLeverY(z), z]), [0.042, 0.06, 0.07, 0.06, 0.05, 0.045], { sides: 12, steps: 34, round: 2, section: () => [1.25, 0.8], frame: () => [0, 1, 0] }),
    color: BRASS,
  });
  block(brass, BRASS, 0.36, 0.06, 0.26, [SX, sLeverY(ARM_Z) - 0.045, ARM_Z]);
  // The pivot pillars, its axle and their cones.
  for (const sx of [-1, 1]) {
    const x = SX + sx * 0.24;
    brass.push({ geometry: spin([[0, SB], [0.11, SB], [0.11, SB + 0.05], [0.055, SB + 0.1], [0.05, SPY - 0.06], [0.075, SPY - 0.03], [0.075, SPY + 0.05], [0, SPY + 0.06]], { segments: 14 }), color: BRASS, position: [x, 0, PVZ] });
    rod(brass, BRASS, [x, SPY, PVZ], [x + sx * 0.12, SPY, PVZ], 0.035, { sides: 10 });
  }
  rod(brass, BRASS, [SX - 0.24, SPY, PVZ], [SX + 0.24, SPY, PVZ], 0.03, { sides: 10 });
  // The retractile spring, from the lever's tail down to the base, which keeps the front end up.
  const TZ = SZ - 1.2;
  dark.push({ geometry: helix(SX, SB + 0.22, sLeverY(TZ) - 0.08, TZ, 0.04, 9, 0.009, { sides: 5, perTurn: 10 }), color: STEEL });
  brass.push({ geometry: spin([[0, SB], [0.08, SB], [0.07, SB + 0.04], [0.025, SB + 0.07], [0.025, SB + 0.24], [0, SB + 0.24]], { segments: 10 }), color: BRASS, position: [SX, 0, TZ] });
  // The stops the lever clicks between. That click is what an operator listened to.
  const STOPZ = SZ + 0.74;
  const stopY = sLeverY(STOPZ);
  brass.push({ geometry: spin([[0, SB], [0.1, SB], [0.1, SB + 0.05], [0.05, SB + 0.1], [0.045, stopY - 0.13], [0.07, stopY - 0.11], [0.07, stopY - 0.06], [0, stopY - 0.06]], { segments: 14 }), color: BRASS, position: [SX, 0, STOPZ] });
  for (const sx of [-1, 1]) {
    rod(brass, BRASS, [SX + sx * 0.2, SB, STOPZ], [SX + sx * 0.2, stopY + 0.3, STOPZ], 0.042, { sides: 10 });
    dot(brass, BRASS, 0.06, [SX + sx * 0.2, stopY + 0.3, STOPZ], { sides: 10 });
    dot(brass, BRASS2, 0.075, [SX + sx * 0.2, SB + 0.01, STOPZ], { sides: 10, flat: 0.5 });
  }
  rod(brass, BRASS, [SX - 0.2, stopY + 0.3, STOPZ], [SX + 0.2, stopY + 0.3, STOPZ], 0.045, { sides: 10 });
  brass.push({ geometry: spin([[0, stopY + 0.09], [0.03, stopY + 0.09], [0.03, stopY + 0.4], [0.07, stopY + 0.41], [0.07, stopY + 0.48], [0, stopY + 0.49]], { segments: 12 }), color: BRASS, position: [SX, 0, STOPZ] });

  // The sounder's two posts on the rear corners of its base, with the magnet's own leads to them.
  const snd1 = postParts(SX - 0.68, SZ - 0.72, SB - 0.01);
  const snd2 = postParts(SX + 0.68, SZ - 0.72, SB - 0.01);
  dark.push({ geometry: tube([[SX - 0.68, SB + 0.1, SZ - 0.7], [SX - 0.62, SB + 0.05, SZ - 0.5], [SX - 0.55, SB + 0.05, SZ - 0.28], [SX - 0.47, coilY0 + 0.12, SZ - 0.18]], 0.018, { sides: 5, steps: 12 }), color: GREEN });
  dark.push({ geometry: tube([[SX + 0.68, SB + 0.1, SZ - 0.7], [SX + 0.62, SB + 0.05, SZ - 0.5], [SX + 0.55, SB + 0.05, SZ - 0.28], [SX + 0.47, coilY0 + 0.12, SZ - 0.18]], 0.018, { sides: 5, steps: 12 }), color: GREEN });
  // The jumper from one coil to the next: the current goes round both.
  dark.push({ geometry: tube([[SX - 0.18, coilY1 - 0.14, SZ + 0.04], [SX - 0.04, coilY1 - 0.1, SZ + 0.2], [SX + 0.04, coilY1 - 0.1, SZ + 0.2], [SX + 0.18, coilY1 - 0.14, SZ + 0.04]], 0.016, { sides: 5, steps: 10 }), color: GREEN });

  // --- the register: a stylus on the lever's nose, a roller under it, and the tape ---------------
  const RZ = SZ + 1.2;
  const rollerY = sLeverY(RZ) - 0.26;
  brass.push({ geometry: spin([[0, sLeverY(RZ) - 0.2], [0.018, sLeverY(RZ) - 0.2], [0.03, sLeverY(RZ) - 0.14], [0.03, sLeverY(RZ) + 0.03], [0, sLeverY(RZ) + 0.05]], { segments: 10 }), color: BRASS, position: [SX, 0, RZ] });
  rod(brass, BRASS, [SX, rollerY, RZ - 0.22], [SX, rollerY, RZ + 0.22], 0.06, { sides: 16 });
  for (const sz of [-1, 1]) {
    const z = RZ + sz * 0.22;
    rod(brass, BRASS, [SX, D + 0.14, z], [SX, rollerY + 0.03, z], 0.03, { sides: 10 });
    dot(brass, BRASS, 0.045, [SX, rollerY, z], { sides: 10 });
  }
  // The paper reel, on its own arbour on the left: a real roll of tape with brass cheeks.
  const RLX = SX - 0.98; const RLY = rollerY + 0.06;
  const reelG = spin([[0, -0.135, 'h'], [0.3, -0.135, 'h'], [0.3, 0.135, 'h'], [0, 0.135, 'h']], { segments: 34 });
  reelG.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  tintVertices(reelG, (x, y, z, out) => {
    const r = Math.hypot(x - 0, y - 0);
    const lay = 0.5 + 0.5 * Math.sin(r * 90);
    const c = Math.abs(z) > 0.134 ? mix(0.56, 0.74, lay) : 0.76;
    out[0] = c; out[1] = c * 0.93; out[2] = c * 0.76;
  });
  fluid.push({ geometry: reelG, keepColor: true, position: [RLX, RLY, RZ] });
  for (const sz of [-1, 1]) {
    rod(brass, BRASS, [RLX, RLY, RZ + sz * 0.135], [RLX, RLY, RZ + sz * 0.16], 0.13, { sides: 16 });
    bar(brass, BRASS2, [RLX, RLY, RZ + sz * 0.19], [RLX + 0.08, D + 0.06, RZ + sz * 0.19], 0.07, 0.03, { up: [0, 0, 1] });
  }
  rod(brass, BRASS, [RLX, RLY, RZ - 0.22], [RLX, RLY, RZ + 0.22], 0.03, { sides: 10 });
  block(wood, MAHOG, 0.42, 0.08, 0.56, [RLX + 0.08, D + 0.04, RZ]);
  // Blank tape from the reel to the roller.
  const TAPE_W = 0.24;
  const paperWhite = [0.8, 0.74, 0.58];
  const blankUv = () => [0.5, 1 - (PAPER.blankY + 12) / PAPER.H];
  const toRoller = ribbonFrames([[RLX + 0.02, RLY + 0.305, RZ], [RLX + 0.45, RLY + 0.22, RZ], [SX - 0.07, rollerY + 0.065, RZ]], TAPE_W * 0.98, [0, 0, 1]);
  ribbonSpan(toRoller, 0, toRoller.len, 0.008, () => blankUv(), paper, paperWhite);

  // The printed tape, from the free end on the floor back to the stylus, because the free end carries
  // the START of the message: read left to right along the floor, it reads in the order it was sent.
  const { units } = morseMarks(TAPE_MESSAGE);
  const tapeLen = units * TAPE_FT_PER_UNIT;
  const FY = 0.015;
  const floorRun = [
    [SX + 1.5, FY + 0.008, 3.25], [SX + 0.4, FY, 3.45], [SX - 1, FY, 3.3], [SX - 2.4, FY, 3.45],
  ].reverse();
  const tapePath = [
    ...floorRun,
    [SX + 2.22, FY, 3.05], [SX + 2.4, FY + 0.02, 2.62], [SX + 2.42, 0.12, 2.37], [SX + 2.42, 0.8, 2.26], [SX + 2.42, D - 0.1, 2.235], [SX + 2.42, D + 0.015, 2.2],
    [SX + 2.4, D + 0.016, 2.0], [SX + 2.2, D + 0.016, 1.62], [SX + 1.9, D + 0.016, RZ + 0.03], [SX + 1.3, D + 0.03, RZ], [SX + 0.7, rollerY - 0.55, RZ], [SX + 0.28, rollerY - 0.05, RZ], [SX + 0.07, rollerY + 0.065, RZ],
  ];
  // A spline undershoots at a sharp rise, so the tape is told where the desk is rather than trusted to clear it.
  const printed = ribbonFrames(tapePath, TAPE_W, [0, 0, 1], (p) => (p.z < 2.19 ? D + 0.012 : 0.012));
  // Whatever length the path came to, the marks are laid to fit it, and the fit is checked below.
  const ftPerUnit = printed.len / units;
  if (Math.abs(printed.len - tapeLen) / tapeLen > 0.14) throw new Error(`telegraph tape is ${printed.len.toFixed(2)}ft, wanted about ${tapeLen.toFixed(2)}ft`);
  const uvOnTape = (s, across) => {
    const unit = s / ftPerUnit;
    const row = Math.min(2, Math.floor((unit - 1e-6) / TAPE_ROW_UNITS));
    const u = (unit - row * TAPE_ROW_UNITS) / TAPE_ROW_UNITS;
    const y = PAPER.rowY + row * PAPER.rowH + across * PAPER.rowH;
    return [u, 1 - y / PAPER.H];
  };
  for (let row = 0; row < 3; row++) {
    const s0 = Math.min(printed.len, row * TAPE_ROW_UNITS * ftPerUnit);
    const s1 = Math.min(printed.len, (row + 1) * TAPE_ROW_UNITS * ftPerUnit);
    if (s1 - s0 < 1e-4) continue;
    const mid = (s) => uvOnTape(THREE.MathUtils.clamp(s, s0 + 1e-4, s1 - 1e-4), 0);
    ribbonSpan(printed, s0, s1, 0.008, (s, across) => {
      const base = mid(s);
      return [base[0], 1 - (PAPER.rowY + row * PAPER.rowH + across * PAPER.rowH) / PAPER.H];
    }, paper, paperWhite);
  }

  // --- the battery: a gravity cell ---------------------------------------------------------------
  const BX = 3.0; const BZ = -0.75;
  const JR = 0.68; const JH = 1.82;
  wood.push({ geometry: spinRect(1.7, 0.1, 1.7), color: WALNUT, position: [BX, D + 0.05, BZ] });
  const JY = D + 0.1;
  glass.push({
    geometry: spin([[0, JY], [JR - 0.08, JY], [JR, JY + 0.1], [JR, JY + JH - 0.14], [JR + 0.05, JY + JH - 0.08], [JR + 0.05, JY + JH], [JR - 0.05, JY + JH], [JR - 0.06, JY + JH - 0.14], [JR - 0.06, JY + 0.14], [JR - 0.14, JY + 0.07], [0, JY + 0.06]], { segments: 40 }),
    color: 0xd4eaf0,
    position: [BX, 0, BZ],
  });
  // The blue copper-sulphate layer at the bottom and the paler zinc-sulphate floating on it.
  const LQ = JY + JH * 0.76;
  const liquid = spin([[0, JY + 0.07], [JR - 0.14, JY + 0.08], [JR - 0.07, JY + 0.15], [JR - 0.07, JY + 0.4], [JR - 0.07, JY + 0.6], [JR - 0.07, JY + 0.68], [JR - 0.07, JY + 0.8], [JR - 0.07, LQ - 0.1], [JR - 0.075, LQ], [0, LQ]], { segments: 36 });
  tintVertices(liquid, (x, y, z, out) => {
    const t = sstep(y, JY + 0.58, JY + 0.85);
    out[0] = mix(0.012, 0.42, t); out[1] = mix(0.09, 0.66, t); out[2] = mix(0.72, 0.86, t);
  });
  fluid.push({ geometry: liquid, keepColor: true, position: [BX, 0, BZ] });
  // The copper leaf on the floor, its lead rising through the fluid in black gutta-percha.
  const LID = JY + JH + 0.02;
  // The zinc crowfoot, hung from the bar by its neck, its fingers splayed down into the liquid.
  const ZY = LQ + 0.2;
  dark.push({ geometry: spin([[0, ZY - 0.16], [0.21, ZY - 0.16], [0.26, ZY - 0.06], [0.2, ZY + 0.08], [0.07, ZY + 0.13], [0.06, LID], [0, LID]], { segments: 18 }), color: ZINC });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const r0 = 0.16; const r1 = 0.43;
    dark.push({
      geometry: tube([
        [Math.cos(a) * r0, ZY - 0.05, Math.sin(a) * r0],
        [Math.cos(a) * (r1 - 0.06), ZY - 0.1, Math.sin(a) * (r1 - 0.06)],
        [Math.cos(a) * r1, ZY - 0.34, Math.sin(a) * r1],
        [Math.cos(a) * (r1 - 0.02), ZY - 0.6, Math.sin(a) * (r1 - 0.02)],
      ], [0.055, 0.05, 0.04, 0.022], { sides: 6, steps: 10, round: 1 }),
      color: ZINC,
    });
  }
  // Carry the crowfoot from the jar's axis to where the jar stands.
  for (let i = 1; i <= 9; i++) dark[dark.length - i].position = [BX, 0, BZ];
  // The bar across the rim that hangs the zinc and carries both posts.
  block(wood, OAK, 1.62, 0.1, 0.34, [BX, LID + 0.05, BZ]);
  const COP_LEAD = [BX + 0.46, BZ + 0.0];
  pipe(dark, BLACK, [[COP_LEAD[0], LID + 0.06, COP_LEAD[1]], [COP_LEAD[0], LQ - 0.03, COP_LEAD[1]]], 0.03, { sides: 8, steps: 3 });
  const bat1 = postParts(BX + 0.46, BZ, LID + 0.09);
  const bat2 = postParts(BX - 0.46, BZ, LID + 0.09);
  // The zinc's strap to its post.
  block(brass, ZINC, 0.46, 0.022, 0.09, [BX - 0.23, LID + 0.112, BZ]);

  // --- one complete circuit --------------------------------------------------------------------
  // Battery plus to the key, the key to the sounder, the sounder back to battery minus. Nothing but the
  // key's own gap interrupts it, and the walk below is what says so.
  const POSTS = { 'bat+': bat1, 'bat-': bat2, key1, key2, snd1, snd2 };
  const INSIDE = [['key1', 'key2'], ['snd1', 'snd2'], ['bat+', 'bat-']];
  const WIRES = [
    { from: 'bat-', to: 'snd2', color: 0x2a2f33, via: [[BX - 1.0, D + 0.75, BZ + 0.1], [SX + 1.25, D + 0.08, -0.8], [SX + 0.95, D + 0.08, -0.72]] },
    { from: 'snd1', to: 'key2', color: 0xcc3a22, via: [[SX - 0.95, D + 0.16, SZ - 0.86], [-0.85, D + 0.05, -0.72], [KX + 0.75, D + 0.05, KZ - 1.12]] },
    { from: 'bat+', to: 'key1', color: 0xe7b12a, via: [[BX + 0.62, D + 1.0, BZ - 0.38], [BX + 0.1, D + 0.05, BZ - 1.0], [0.8, D + 0.05, -1.72], [-1.0, D + 0.05, -1.86], [KX - 0.1, D + 0.05, -1.05], [KX - 0.68, D + 0.05, KZ - 1.0]] },
  ];
  // The walk.
  const links = new Map(Object.keys(POSTS).map((k) => [k, []]));
  for (const [a, b] of INSIDE) { links.get(a).push(b); links.get(b).push(a); }
  for (const w of WIRES) {
    if (!POSTS[w.from] || !POSTS[w.to]) throw new Error('telegraph wire to no post');
    links.get(w.from).push(w.to);
    links.get(w.to).push(w.from);
  }
  for (const v of links.values()) if (v.length !== 2) throw new Error('telegraph circuit is not a simple loop');
  let at = 'bat+'; let prev = null; let visited = 0;
  do {
    const next = links.get(at).find((n) => n !== prev) ?? prev;
    prev = at; at = next; visited += 1;
  } while (at !== 'bat+' && visited < 8);
  if (visited !== 6) throw new Error('telegraph circuit is not one loop through all six posts');
  // The wires run straight into their posts' waists, each ending inside the brass.
  for (const w of WIRES) {
    const A = POSTS[w.from]; const B = POSTS[w.to];
    dark.push({ geometry: tube([A, ...w.via, B], 0.034, { sides: 8, steps: 18 * (w.via.length + 1), round: 1 }), color: w.color });
  }

  // --- the chart on its stand ------------------------------------------------------------------
  const CX = -2.05; const CZ2 = -1.3;
  const CW = 3.5; const CH = CW * (PAPER.chartH / PAPER.W);
  const tilt = 0.14;
  const cBot = D + 0.34;
  const ptOn = (x, y, off = 0) => {
    const dy = y;
    return [CX + x, cBot + dy * Math.cos(tilt), CZ2 - dy * Math.sin(tilt) + off * Math.cos(tilt)];
  };
  const face = 0.05;
  const uv = [[1, 1 - PAPER.chartH / PAPER.H], [1, 1], [0, 1], [0, 1 - PAPER.chartH / PAPER.H]];
  const hw = CW / 2;
  const bl = ptOn(-hw, 0, face); const br = ptOn(hw, 0, face); const tr = ptOn(hw, CH, face); const tl = ptOn(-hw, CH, face);
  const bl0 = ptOn(-hw, 0, face - 0.01); const br0 = ptOn(hw, 0, face - 0.01); const tr0 = ptOn(hw, CH, face - 0.01); const tl0 = ptOn(-hw, CH, face - 0.01);
  const blankQ = [[0.5, 0.02], [0.51, 0.02], [0.51, 0.025], [0.5, 0.025]];
  const white = [0.92, 0.9, 0.84];
  paper.quad(br, tr, tl, bl, uv, white);
  paper.quad(bl0, tl0, tr0, br0, blankQ, white);
  paper.quad(br0, tr0, tr, br, blankQ, white);
  paper.quad(tl0, bl0, bl, tl, blankQ, white);
  paper.quad(tr0, tl0, tl, tr, blankQ, white);
  paper.quad(bl0, br0, br, bl, blankQ, white);
  // The board behind it, a mitred frame round it, a ledge under it, two legs and a back strut.
  const brd = new THREE.BoxGeometry(CW + 0.26, CH + 0.26, 0.08);
  const rotM = new THREE.Matrix4().makeRotationX(-tilt);
  const midP = ptOn(0, CH / 2, 0);
  wood.push({ geometry: brd.applyMatrix4(rotM.clone().setPosition(midP[0], midP[1], midP[2])), color: 0x6f4420 });
  const frameBar = (x0, y0, x1, y1) => {
    const a = ptOn(x0, y0, 0.05); const b = ptOn(x1, y1, 0.05);
    bar(wood, 0x83502a, a, b, 0.11, 0.09, { up: [0, Math.sin(tilt), Math.cos(tilt)] });
  };
  frameBar(-hw - 0.06, -0.12, -hw - 0.06, CH + 0.12);
  frameBar(hw + 0.06, -0.12, hw + 0.06, CH + 0.12);
  frameBar(-hw - 0.12, CH + 0.06, hw + 0.12, CH + 0.06);
  frameBar(-hw - 0.12, -0.06, hw + 0.12, -0.06);
  // Posts outside the frame and struts behind the board: nothing stands in front of the chart.
  for (const sx of [-1, 1]) {
    const x = sx * (hw + 0.17);
    const top = ptOn(x, CH * 0.86, 0.0);
    bar(wood, 0x83502a, [CX + x, D + 0.02, CZ2 + 0.04], top, 0.12, 0.09, { up: [0, 0, 1] });
    bar(wood, 0x83502a, [CX + x, D + 0.05, CZ2 + 0.3], [CX + x, D + 0.05, CZ2 - 0.8], 0.17, 0.1, { up: [0, 1, 0] });
    const inner = sx * (hw - 0.5);
    const back = ptOn(inner, CH * 0.72, -0.05);
    bar(wood, 0x704521, [CX + inner, D + 0.05, CZ2 - 0.74], back, 0.1, 0.06, { up: [0, 0, 1] });
    bar(wood, 0x83502a, [CX + inner, D + 0.05, CZ2 - 0.74], [CX + x, D + 0.05, CZ2 - 0.74], 0.1, 0.1, { up: [0, 1, 0] });
  }
  block(wood, 0x83502a, CW + 0.1, 0.05, 0.22, [CX, cBot - 0.14, CZ2 + 0.11]);

  // --- assemble ---------------------------------------------------------------------------------
  const woodG = planarUV(mergeParts(wood), 0.42);
  const woodC = grainTile(1844);
  const woodM = meshFrom(woodG, {
    map: texOf(woodC, THREE.SRGBColorSpace), bumpMap: texOf(woodC, THREE.NoColorSpace), bumpScale: 0.6, roughness: 0.62, metalness: 0.02,
  });
  const brassM = meshFrom(brassParts(brass), { roughness: 0.3, metalness: 0.5 });
  const darkM = meshFrom(mergeParts(dark), { roughness: 0.55, metalness: 0.1 });
  const paperM = meshFrom(paper.geometry(), { map: paperAtlas(), roughness: 0.92, metalness: 0 });
  const fluidM = meshFrom(mergeParts(fluid), { roughness: 0.38, metalness: 0 });
  const glassM = meshFrom(mergeParts(glass), { transparent: true, opacity: 0.3, roughness: 0.08, metalness: 0, depthWrite: false }, { shadow: false, receive: false });
  return groupOf(woodM, brassM, darkM, paperM, fluidM, glassM);
}

// A rounded slab: a turned-edge base block, width x height x depth, centred.
function spinRect(w, h, d) {
  const hw = w / 2; const hd = d / 2; const hh = h / 2;
  const c = Math.min(0.035, h * 0.3);
  const s = new Soup();
  const Q = (a, b, cc, e) => s.quad(a, b, cc, e, [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1]);
  // Top, its chamfer, the sides, bottom: every edge catches a highlight, which is what makes it joinery.
  const a = hw - c; const b = hd - c;
  Q([-a, hh, b], [a, hh, b], [a, hh, -b], [-a, hh, -b]);
  Q([-hw, hh - c, hd], [hw, hh - c, hd], [a, hh, b], [-a, hh, b]);
  Q([hw, hh - c, -hd], [-hw, hh - c, -hd], [-a, hh, -b], [a, hh, -b]);
  Q([hw, hh - c, hd], [hw, hh - c, -hd], [a, hh, -b], [a, hh, b]);
  Q([-hw, hh - c, -hd], [-hw, hh - c, hd], [-a, hh, b], [-a, hh, -b]);
  Q([-hw, -hh, hd], [hw, -hh, hd], [hw, hh - c, hd], [-hw, hh - c, hd]);
  Q([hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh - c, -hd], [hw, hh - c, -hd]);
  Q([hw, -hh, hd], [hw, -hh, -hd], [hw, hh - c, -hd], [hw, hh - c, hd]);
  Q([-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh - c, hd], [-hw, hh - c, -hd]);
  Q([-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd]);
  const g = s.geometry();
  g.deleteAttribute('color');
  return g;
}

// ---------------------------------------------------------------------------
// Goddard's rocket
// ---------------------------------------------------------------------------

// Motor at the top, tanks far below it, joined by the feed lines that also hold the motor up. A conical
// shield over the liquid-oxygen tank keeps the flame off the tanks. Below the gasoline tank a starting
// hose runs to a cylinder of pressurised oxygen. The arrangement follows Clark University's account;
// the dimensions of every part are this model's reading of the photographs, not published figures.
const GD = {
  base: 0.34, rail: 11.35, legX0: 2.05, legX1: 0.72,
  capY: 11.25, shoulderY: 10.65, throatY: 10.35, exitY: 9.6,
  coneTop: 5.0, coneY: 4.15, coneR: 0.58,
  loxY0: 2.75, loxY1: 4.1, loxR: 0.32,
  gasY0: 1.0, gasY1: 2.3, gasR: 0.3,
  lineX: 0.3, lineR: 0.03,
};
const gdLegX = (y) => mix(GD.legX0, GD.legX1, (y - 0.3) / (GD.rail - 0.3));

function gdPatchRadius(a) {
  return 4.55 + 0.42 * Math.sin(a * 3 + 1.1) + 0.26 * Math.sin(a * 7 + 0.4) + 0.12 * Math.sin(a * 13 + 2);
}
function gdGround(x, z) {
  const r = Math.hypot(x, z);
  const a = Math.atan2(z, x);
  const m = sstep(gdPatchRadius(a) - r, -0.1, 0.18);
  const drift = 0.06 * smoothNoise3(x * 0.5 + 3, 0, z * 0.5) + 0.03 * smoothNoise3(x * 1.6, 4, z * 1.6);
  const edge = sstep(5.5 - r, 0, 0.5);
  return { y: edge * (0.035 + 0.02 * smoothNoise3(x * 2.4, 9, z * 2.4)) + m * (0.1 + drift), m };
}

// A closed disc of ground from a height function.
function gdPatch() {
  const rings = 34; const sectors = 110; const R = 5.5;
  const pos = []; const col = []; const idx = [];
  const SNOW = lin(0xdfe6ee); const SHADE = lin(0xb6c8e2); const GRASS = lin(0x8d7a48); const MUD = lin(0x52412c);
  for (let i = 0; i <= rings; i++) {
    const r = Math.max(0.002, (i / rings) * R);
    for (let j = 0; j < sectors; j++) {
      const a = (j / sectors) * Math.PI * 2;
      const x = Math.cos(a) * r; const z = Math.sin(a) * r;
      const { y, m } = gdGround(x, z);
      pos.push(x, y, z);
      const n = smoothNoise3(x * 1.1, 2, z * 1.1);
      const c = [mix(SNOW[0], SHADE[0], n * 0.7), mix(SNOW[1], SHADE[1], n * 0.7), mix(SNOW[2], SHADE[2], n * 0.7)];
      const g = smoothNoise3(x * 2.6, 7, z * 2.6);
      const soil = [mix(GRASS[0], MUD[0], g), mix(GRASS[1], MUD[1], g), mix(GRASS[2], MUD[2], g)];
      col.push(mix(soil[0], c[0], m), mix(soil[1], c[1], m), mix(soil[2], c[2], m));
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sectors; j++) {
      const j2 = (j + 1) % sectors;
      const a = i * sectors + j; const b = i * sectors + j2; const c = (i + 1) * sectors + j; const d = (i + 1) * sectors + j2;
      idx.push(a, b, c, c, b, d);
    }
  }
  // The underside has its own rim, or it would shade the patch's edge as a black ring.
  const bottom = pos.length / 3;
  pos.push(0, 0, 0); col.push(0.1, 0.08, 0.06);
  const rimStart = rings * sectors;
  for (let j = 0; j < sectors; j++) {
    pos.push(pos[(rimStart + j) * 3], pos[(rimStart + j) * 3 + 1], pos[(rimStart + j) * 3 + 2]);
    col.push(0.1, 0.08, 0.06);
  }
  for (let j = 0; j < sectors; j++) idx.push(bottom, bottom + 1 + j, bottom + 1 + ((j + 1) % sectors));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  planarUV(g, 0.5);
  return g;
}

function goddardRocket() {
  const iron = [];
  const metal = [];
  const wood = [];
  const IRON = 0x3f444a; const IRON2 = 0x2c3034; const STEEL = 0x8e979f; const TANK = 0xb4bdc3; const SHIELD = 0xc9d0d4;
  const COPPER = 0xc77838; const BRASS = 0xc99a3e; const RUBBER = 0x16171a; const WIRE = 0xb02a1e; const PLANK = 0x8a6a42; const CYL = 0x2f5a3e;
  const rng = seededRandom(1926);

  // --- the low stand, nailed up out of what was in the barn ----------------------------------------
  const skidY = 0.26;
  for (const sz of [-1, 1]) block(wood, PLANK, 5.0, 0.2, 0.26, [0, skidY, sz * 1.35], [0, sz * 0.012, 0]);
  for (const sx of [-1, 1]) block(wood, 0x7a5c38, 0.3, 0.1, 3.3, [sx * 2.05, skidY + 0.13, 0], [0, sx * 0.015, 0]);
  block(wood, 0x977448, 1.5, 0.07, 3.0, [0, skidY + 0.1, 0]);
  block(wood, 0x806040, 0.9, 0.06, 0.9, [0, GD.base + 0.01, 0]);
  for (const [x, z] of [[-2.35, -1.35], [2.35, -1.35], [-2.35, 1.35], [2.35, 1.35]]) {
    rod(wood, 0x6c5232, [x, 0.02, z], [x, skidY + 0.2, z + 0.02], 0.09, { sides: 7 });
  }

  // --- the frame: pipe, in an A, with elbows that are simply balls of iron ------------------------
  const R = 0.055;
  const join = (p, r = R * 1.45) => dot(iron, IRON2, r, p, { sides: 10 });
  for (const sx of [-1, 1]) {
    const a = [sx * GD.legX0, 0.4, 0]; const b = [sx * GD.legX1, GD.rail, 0];
    rod(iron, IRON, a, b, R, { sides: 10 });
    iron.push({ geometry: spin([[0, 0], [0.13, 0], [0.13, 0.05], [0.075, 0.08], [0.075, 0.22], [0, 0.22]], { segments: 12 }), color: IRON2, position: [a[0], 0.38, 0] });
    join(b);
    // Side stays forward and back, which is all that keeps it from falling over in the wind.
    const y = 8.4;
    const on = [sx * gdLegX(y), y, 0];
    join(on, R * 1.3);
    for (const sz of [-1, 1]) {
      const foot = [sx * 2.18, skidY + 0.1, sz * 1.35];
      rod(iron, IRON, foot, on, 0.034, { sides: 8 });
      iron.push({ geometry: spin([[0, 0], [0.075, 0], [0.075, 0.03], [0.045, 0.06], [0.045, 0.13], [0, 0.13]], { segments: 10 }), color: IRON2, position: [foot[0], skidY + 0.09, foot[2]] });
    }
  }
  // Everything that crosses the frame runs BEHIND the rocket's axis, the top rail too: a rail or a brace
  // across the plane of the legs would be standing in the way of the thing the frame exists to release.
  const BACK = -0.72;
  for (const sx of [-1, 1]) {
    rod(iron, IRON, [sx * GD.legX1, GD.rail, 0], [sx * GD.legX1, GD.rail, BACK], R * 0.9, { sides: 10 });
    join([sx * GD.legX1, GD.rail, BACK]);
  }
  rod(iron, IRON, [-GD.legX1, GD.rail, BACK], [GD.legX1, GD.rail, BACK], R * 0.9, { sides: 10 });
  for (const y of [3.1, 6.6, 8.9]) {
    rod(iron, IRON, [-gdLegX(y), y, BACK], [gdLegX(y), y, BACK], 0.038, { sides: 8 });
    for (const sx of [-1, 1]) {
      rod(iron, IRON, [sx * gdLegX(y), y, 0], [sx * gdLegX(y), y, BACK], 0.038, { sides: 8 });
      join([sx * gdLegX(y), y, 0], 0.075);
      join([sx * gdLegX(y), y, BACK], 0.06);
    }
  }
  // Two guide rods the rocket rises between, far enough apart to clear the shield's rim.
  const GX = 0.65;
  for (const sx of [-1, 1]) {
    rod(iron, 0x666c72, [sx * GX, 3.1, 0], [sx * GX, GD.rail - 0.1, 0], 0.022, { sides: 7 });
    for (const y of [3.1, 6.6, 8.9]) {
      rod(iron, 0x666c72, [sx * GX, y, 0], [sx * GX, y, BACK], 0.018, { sides: 6 });
      join([sx * GX, y, 0], 0.04);
      join([sx * GX, y, BACK], 0.04);
    }
    rod(iron, 0x666c72, [sx * GX, GD.rail - 0.1, 0], [sx * gdLegX(GD.rail - 0.1), GD.rail - 0.1, 0], 0.018, { sides: 6 });
    join([sx * GX, GD.rail - 0.1, 0], 0.04);
  }

  // --- the motor -----------------------------------------------------------------------------------
  const rocket = metal;
  rocket.push({
    geometry: tintVertices(spin([
      [0, GD.exitY + 0.22, 'h'], [0.09, GD.exitY + 0.22], [0.135, GD.exitY + 0.015, 'h'], [0.175, GD.exitY, 'h'], [0.18, GD.exitY + 0.04], [0.095, GD.exitY + 0.52], [0.068, GD.throatY - 0.04], [0.075, GD.throatY + 0.06], [0.2, GD.shoulderY - 0.05, 'h'], [0.215, GD.shoulderY, 'h'],
      [0.215, GD.shoulderY + 0.37, 'h'], [0.19, GD.shoulderY + 0.43], [0.1, GD.shoulderY + 0.51], [0.07, GD.capY - 0.02], [0, GD.capY],
    ], { segments: 28 }), (x, y, z, out) => {
      const r = Math.hypot(x, z);
      const inner = y < GD.exitY + 0.25 && r < 0.13;
      const c = inner ? [0.012, 0.012, 0.014] : lin(y > GD.throatY ? 0x9a9fa3 : 0x7b7f82);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    }),
    keepColor: true,
  });
  for (const y of [GD.shoulderY + 0.02, GD.shoulderY + 0.35]) {
    rocket.push({ geometry: spin([[0, y - 0.03, 'h'], [0.25, y - 0.03, 'h'], [0.25, y + 0.03, 'h'], [0, y + 0.03, 'h']], { segments: 28 }), color: STEEL });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      dot(rocket, 0x5b6065, 0.02, [Math.cos(a) * 0.235, y + 0.035, Math.sin(a) * 0.235], { sides: 6 });
    }
  }
  // The two feed lines: the oxygen on one side, the gasoline on the other. They are the rocket's
  // backbone, and there is nothing else holding the motor to the tanks.
  const X = GD.lineX;
  const inletY = GD.shoulderY + 0.17;
  const coneAt = (r) => GD.coneTop - (r / GD.coneR) * (GD.coneTop - GD.coneY);
  const rLine = 0.33;
  const oxLine = [
    [0.2, inletY, 0], [X - 0.02, inletY, 0], [X + 0.03, inletY - 0.05, 0], [X + 0.03, inletY - 0.14, 0], [X, 9.8, 0], [X, 7.5, 0], [X, 5.4, 0], [X, 4.72, 0], [X + 0.02, coneAt(rLine) - 0.3, 0],
    [X - 0.02, GD.loxY1 - 0.16, 0], [X - 0.1, GD.loxY1 - 0.06, 0],
  ];
  const gasLine = [
    [-0.2, inletY, 0], [-X + 0.02, inletY, 0], [-X - 0.03, inletY - 0.05, 0], [-X - 0.03, inletY - 0.14, 0], [-X, 9.8, 0], [-X, 7.5, 0], [-X, 5.4, 0], [-X, 4.72, 0], [-X - 0.05, coneAt(rLine) - 0.32, 0],
    [-X - 0.1, 3.6, 0], [-X - 0.1, 2.8, 0], [-X - 0.06, GD.gasY1 + 0.26, 0], [-0.24, GD.gasY1 + 0.1, 0], [-0.19, GD.gasY1 - 0.1, 0],
  ];
  pipe(rocket, COPPER, oxLine, GD.lineR, { sides: 10, steps: 90, round: 1 });
  pipe(rocket, COPPER, gasLine, GD.lineR, { sides: 10, steps: 100, round: 1 });
  // The feed lines' unions, and light cross ties to keep the two from wandering apart.
  for (const y of [9.1, 7.9, 6.6, 5.4]) {
    rod(rocket, 0x7f868c, [-X, y, 0], [X, y, 0], 0.016, { sides: 7 });
    for (const sx of [-1, 1]) {
      rocket.push({ geometry: spin([[0, y - 0.05, 'h'], [0.05, y - 0.05, 'h'], [0.05, y + 0.05, 'h'], [0, y + 0.05, 'h']], { segments: 10 }), color: BRASS, position: [sx * X, 0, 0] });
    }
  }
  // Slides that ride the guide rods.
  for (const y of [9.1, 6.6]) {
    for (const sx of [-1, 1]) {
      rod(rocket, 0x7f868c, [sx * X, y, 0], [sx * (GX - 0.015), y, 0], 0.016, { sides: 7 });
      rocket.push({ geometry: spin([[0, y - 0.06, 'h'], [0.045, y - 0.06, 'h'], [0.045, y + 0.06, 'h'], [0, y + 0.06, 'h']], { segments: 10 }), color: 0x7f868c, position: [sx * GX, 0, 0] });
    }
  }

  // --- the shield and the tanks ----------------------------------------------------------------------
  const shield = spin([[0, GD.coneY - 0.02, 'h'], [GD.coneR - 0.01, GD.coneY - 0.02, 'h'], [GD.coneR, GD.coneY, 'h'], [GD.coneR - 0.02, GD.coneY + 0.03, 'h'], [0.03, GD.coneTop - 0.02, 'h'], [0, GD.coneTop]], { segments: 48 });
  rocket.push({ geometry: shield, color: SHIELD });
  // A soldered seam down the sheet.
  const seamA = 2.2;
  const seamAt = (y) => (GD.coneR * (GD.coneTop - y)) / (GD.coneTop - GD.coneY);
  pipe(rocket, 0x9aa1a6, [[Math.cos(seamA) * seamAt(4.92), 4.92, Math.sin(seamA) * seamAt(4.92)], [Math.cos(seamA) * seamAt(GD.coneY + 0.04), GD.coneY + 0.04, Math.sin(seamA) * seamAt(GD.coneY + 0.04)]], 0.012, { sides: 6, steps: 3 });
  // Collars where the feed lines pass through the sheet, sunk into it so no daylight shows.
  for (const sx of [-1, 1]) {
    const y = coneAt(rLine);
    rocket.push({ geometry: spin([[0, y - 0.05], [0.055, y - 0.05], [0.055, y + 0.02], [0.035, y + 0.05], [0, y + 0.05]], { segments: 10 }), color: BRASS, position: [sx * X, 0, 0] });
  }
  const tankProfile = (y0, y1, r) => {
    const d = r * 0.5;
    return [[0, y0], [r * 0.5, y0 + d * 0.12], [r * 0.85, y0 + d * 0.5], [r, y0 + d, 'h'], [r + 0.012, y0 + d + 0.015, 'h'], [r + 0.012, y0 + d + 0.05, 'h'], [r, y0 + d + 0.065, 'h'],
      [r, y1 - d - 0.065, 'h'], [r + 0.012, y1 - d - 0.05, 'h'], [r + 0.012, y1 - d - 0.015, 'h'], [r, y1 - d, 'h'], [r * 0.85, y1 - d * 0.5], [r * 0.5, y1 - d * 0.12], [0, y1]];
  };
  rocket.push({ geometry: spin(tankProfile(GD.loxY0, GD.loxY1, GD.loxR), { segments: 36 }), color: TANK });
  rocket.push({ geometry: spin(tankProfile(GD.gasY0, GD.gasY1, GD.gasR), { segments: 36 }), color: 0xa7a68e });
  dot(rocket, BRASS, 0.05, [-0.205, GD.gasY1 - 0.055, 0], { sides: 10 });
  for (const [y0, y1, r] of [[GD.loxY0, GD.loxY1, GD.loxR], [GD.gasY0, GD.gasY1, GD.gasR]]) {
    const d = r * 0.5;
    for (const y of [y0 + d + 0.035, y1 - d - 0.035]) {
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + 0.1;
        dot(rocket, 0x6f7479, 0.014, [Math.cos(a) * (r + 0.012), y, Math.sin(a) * (r + 0.012)], { sides: 6 });
      }
    }
  }
  // The shield stands on three short struts off the oxygen tank's shoulder.
  for (let i = 0; i < 3; i++) {
    const a = 0.9 + (i / 3) * Math.PI * 2;
    rod(rocket, 0x7f868c, [Math.cos(a) * 0.2, GD.loxY1 - 0.08, Math.sin(a) * 0.2], [Math.cos(a) * 0.36, GD.coneY + 0.01, Math.sin(a) * 0.36], 0.018, { sides: 6 });
  }
  // The oxygen tank's relief valve, poking out under the rim of the shield.
  rod(rocket, BRASS, [0.12, GD.loxY1 - 0.1, 0.24], [0.14, GD.loxY1 + 0.0, 0.3], 0.024, { sides: 8 });
  dot(rocket, BRASS, 0.04, [0.14, GD.loxY1 + 0.0, 0.3], { sides: 8 });
  // The strut between the tanks, and three stubby legs the rocket simply stands on.
  rod(rocket, 0x7f868c, [0, GD.gasY1 - 0.02, 0], [0, GD.loxY0 + 0.02, 0], 0.045, { sides: 10 });
  for (let i = 0; i < 3; i++) {
    const a = 0.5 + (i / 3) * Math.PI * 2;
    const top = [Math.cos(a) * 0.16, GD.gasY0 + 0.05, Math.sin(a) * 0.16];
    const foot = [Math.cos(a) * 0.3, GD.base + 0.04, Math.sin(a) * 0.3];
    rod(rocket, 0x6d7379, foot, top, 0.024, { sides: 7 });
    dot(rocket, 0x4e5358, 0.04, foot, { sides: 8, flat: 0.5 });
  }
  // The pressure line, thin as a pencil, from the oxygen tank down to the gasoline tank: oxygen boiling
  // off in its own tank is what pushes the propellants up.
  pipe(rocket, COPPER, [[0.1, GD.loxY0 + 0.05, 0.25], [0.2, GD.loxY0 - 0.08, 0.27], [0.21, GD.gasY1 + 0.08, 0.26], [0.13, GD.gasY1 - 0.05, 0.22]], 0.014, { sides: 7, steps: 16, round: 1 });
  // A hand valve on the oxygen line.
  const VY = 4.55;
  rocket.push({ geometry: spin([[0, VY + 0.13], [0.04, VY + 0.13], [0.06, VY + 0.08], [0.06, VY - 0.08], [0.04, VY - 0.13], [0, VY - 0.13]], { segments: 10 }), color: BRASS, position: [X, 0, 0] });

  // --- the starting hose ------------------------------------------------------------------------------
  const gy = (x, z) => gdGround(x, z).y + 0.045;
  const hoseStart = [0.02, GD.gasY0 + 0.02, 0];
  const cylX = -3.0; const cylZ = 1.95;
  const cylY = gy(cylX, cylZ) + 0.2;
  const hose = [hoseStart, [0.02, GD.gasY0 - 0.2, 0.08], [0.1, 0.56, 0.4], [-0.1, skidY + 0.2, 1.05]];
  for (const [x, z] of [[-0.6, 1.75], [-1.05, 2.2], [-1.55, 2.1]]) hose.push([x, gy(x, z), z]);
  // The cylinder's own neck, worked out from how it lies below.
  const neck = [cylX - 0.3 + 0.92 * Math.cos(0.5), cylY, cylZ - 0.92 * Math.sin(0.5)];
  hose.push([neck[0] + 0.4, gy(neck[0] + 0.4, neck[2] + 0.2) + 0.02, neck[2] + 0.2], neck);
  pipe(rocket, RUBBER, hose, 0.036, { sides: 8, steps: 64, round: 1 });
  rocket.push({ geometry: spin([[0, GD.gasY0 - 0.02], [0.05, GD.gasY0 - 0.02], [0.05, GD.gasY0 + 0.06], [0, GD.gasY0 + 0.06]], { segments: 10 }), color: BRASS, position: [0.02, 0, 0] });
  // The cylinder of pressurised oxygen it runs to, lying on the snow.
  const cylG = spin([[0, -0.82], [0.13, -0.81], [0.2, -0.74], [0.22, -0.65, 'h'], [0.22, 0.55, 'h'], [0.16, 0.7], [0.07, 0.78], [0.05, 0.86], [0.05, 0.92], [0, 0.92]], { segments: 20 });
  cylG.applyMatrix4(new THREE.Matrix4().makeRotationY(0.5).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2)));
  rocket.push({ geometry: cylG, color: CYL, position: [cylX - 0.3, cylY, cylZ] });

  // --- the igniter ---------------------------------------------------------------------------------
  const IGY = GD.exitY - 0.14;
  rocket.push({ geometry: spin([[0, IGY - 0.05], [0.05, IGY - 0.05], [0.06, IGY + 0.03], [0, IGY + 0.03]], { segments: 10 }), color: 0x2a2a2c });
  rod(rocket, 0x7f868c, [0, IGY, 0], [X, IGY + 0.2, 0], 0.012, { sides: 6 });
  const wirePts = [[0.04, IGY - 0.02, 0.02], [0.3, IGY - 0.1, 0.06], [gdLegX(8.5) - 0.02, 8.5, 0.09]];
  for (const y of [7, 5.5, 4, 2.5, 1.2]) wirePts.push([gdLegX(y) + 0.02 + 0.03 * Math.sin(y * 2), y, 0.08 + 0.02 * Math.cos(y * 3)]);
  const boxX = 3.0; const boxZ = 1.45;
  wirePts.push([gdLegX(0.6) + 0.14, 0.55, 0.28], [2.6, gy(2.6, 1.0) + 0.02, 1.0], [boxX - 0.2, gy(boxX - 0.2, boxZ) + 0.12, boxZ - 0.05]);
  pipe(rocket, WIRE, wirePts, 0.015, { sides: 6, steps: 90, round: 1 });
  // Its switch box, a small wooden case on the snow with two terminals.
  block(wood, 0x6e4e2c, 0.55, 0.3, 0.4, [boxX, gy(boxX, boxZ) + 0.12, boxZ]);
  block(wood, 0x806040, 0.6, 0.03, 0.45, [boxX, gy(boxX, boxZ) + 0.28, boxZ]);
  for (const sx of [-1, 1]) rod(rocket, BRASS, [boxX + sx * 0.14, gy(boxX, boxZ) + 0.27, boxZ], [boxX + sx * 0.14, gy(boxX, boxZ) + 0.38, boxZ], 0.028, { sides: 8 });
  // Tufts of last year's grass coming through at the edge of the snow.
  const grass = [];
  for (let i = 0; i < 80; i++) {
    const a = rng() * Math.PI * 2;
    const rr = gdPatchRadius(a) + (rng() - 0.35) * 0.75;
    if (rr > 5.3) continue;
    const x = Math.cos(a) * rr; const z = Math.sin(a) * rr;
    const y = gdGround(x, z).y - 0.02;
    for (let b = 0; b < 4; b++) {
      const lean = rng() * Math.PI * 2;
      const h = 0.35 + rng() * 0.45;
      const dx = Math.cos(lean) * h * 0.4; const dz = Math.sin(lean) * h * 0.4;
      const ox = (rng() - 0.5) * 0.14; const oz = (rng() - 0.5) * 0.14;
      grass.push({
        geometry: tube([[x + ox, y, z + oz], [x + ox + dx * 0.2, y + h * 0.55, z + oz + dz * 0.2], [x + ox + dx, y + h, z + oz + dz]], [0.018, 0.014, 0], { sides: 3, steps: 4, round: 0 }),
        color: rng() > 0.5 ? 0xa58d55 : 0x8a7240,
      });
    }
  }

  const ironG = mergeParts(iron);
  sheen(ironG, { add: 0.06 });
  const metalG = mergeParts(metal);
  sheen(metalG, { add: 0.2, gain: 0.25 });
  const woodC = grainTile(1926);
  const woodM = meshFrom(planarUV(mergeParts(wood), 0.7), {
    map: texOf(woodC, THREE.SRGBColorSpace), bumpMap: texOf(woodC, THREE.NoColorSpace), bumpScale: 0.6, roughness: 0.82,
  });
  const snowM = meshFrom(gdPatch(), { roughness: 0.92, metalness: 0, bumpScale: 0.5, bumpMap: grainTexture(1926) }, { shadow: false });
  const grassM = meshFrom(mergeParts(grass), { roughness: 0.95 });
  return groupOf(
    meshFrom(ironG, { roughness: 0.56, metalness: 0.35 }),
    meshFrom(metalG, { roughness: 0.38, metalness: 0.4 }),
    woodM,
    snowM,
    grassM,
  );
}

// Fine crystal scatter for snow, as a bump tile.
function grainTexture(seed) {
  const { canvas, ctx } = makeCanvas(256, 256);
  const rng = seededRandom(seed);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2200; i++) {
    const v = 128 + Math.round((rng() - 0.5) * 150);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(rng() * 256, rng() * 256, 1 + rng() * 2.4, 1 + rng() * 2.4);
  }
  return texOf(canvas, THREE.NoColorSpace);
}

// ---------------------------------------------------------------------------
// The shaduf
// ---------------------------------------------------------------------------

// A river-side plot, 18 feet square, cut square at its edges like a museum diorama. The low channel runs
// across its front (+Z), the pole reaches out over it, and everything behind the bank is the higher
// field the water is being lifted to.
const SD = {
  half: 9.2, F: 1.9, W: 0.72, chanZ: 5.85, chanHalf: 1.72, pivot: [0, 9.42, -4.4], ang: 0.105, arm: 10.6, butt: 4.4,
};
const sdPoleDir = [0, Math.sin(SD.ang), Math.cos(SD.ang)];
// The pole's slight natural arch: it is one tree, and a tree is not straight.
const sdBend = (t) => 0.22 * (1 - ((t - 3.1) / 7.5) ** 2);
const sdPolePoint = (t) => [0, SD.pivot[1] + t * sdPoleDir[1] + sdBend(t), SD.pivot[2] + t * sdPoleDir[2]];
const SD_DITCHES = [
  [[0, 1.6], [0, -8.9]],
  [[-8.9, -1.0], [8.9, -1.0]],
  [[-8.9, -6.6], [8.9, -6.6]],
];
const SD_BASIN = [0, 2.1];

function sdSegDist(x, z, a, b) {
  const bx = b[0] - a[0]; const bz = b[1] - a[1];
  const t = clamp01(((x - a[0]) * bx + (z - a[1]) * bz) / (bx * bx + bz * bz));
  return Math.hypot(x - (a[0] + bx * t), z - (a[1] + bz * t));
}
function sdDitchDist(x, z) {
  let d = 1e9;
  for (const [a, b] of SD_DITCHES) d = Math.min(d, sdSegDist(x, z, a, b));
  return d;
}
function sdHeight(x, z) {
  const low = SD.chanZ - SD.chanHalf; const high = SD.chanZ + SD.chanHalf;
  // The cross section, from the field across the bank, into the channel and up the far levee.
  let y = SD.F;
  y += 0.34 * sstep(z, 2.9, 3.4);
  const inBank = sstep(z, 3.5, low + 0.3);
  y = mix(y, 0.22, inBank);
  const far = sstep(z, high - 0.25, high + 0.65);
  y = mix(y, 1.12, far);
  y -= 0.16 * sstep(z, high + 0.8, SD.half);
  if (z > low && z < high) y -= 0.05 * (1 - ((z - SD.chanZ) / SD.chanHalf) ** 2);
  if (z < 3.2) {
    const d = sdDitchDist(x, z);
    const b = Math.hypot(x - SD_BASIN[0], z - SD_BASIN[1]);
    const cut = Math.max(1 - sstep(d, 0.24, 0.62), 1 - sstep(b, 0.72, 1.12));
    const lip = Math.max(Math.exp(-(((d - 0.82) / 0.2) ** 2)), Math.exp(-(((b - 1.3) / 0.22) ** 2)));
    y += lip * 0.13 - cut * 0.42;
    // Hand-hoed unevenness in the beds.
    y += 0.05 * (smoothNoise3(x * 0.7, 3, z * 0.7) - 0.5);
  } else {
    y += 0.2 * (smoothNoise3(x * 0.38, 8, z * 0.5) - 0.5) + 0.07 * (smoothNoise3(x * 1.1, 2, z * 1.1) - 0.5);
  }
  return y;
}

function sdEarthTile() {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const rng = seededRandom(3000);
  ctx.fillStyle = '#efe9dc';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const v = 214 + Math.round(rng() * 40);
    ctx.fillStyle = `rgba(${v},${v - 5},${v - 14},0.5)`;
    ctx.fillRect(rng() * S, rng() * S, 2 + rng() * 22, 2 + rng() * 12);
  }
  // A dried-mud crack net: the Voronoi-like lines from a jittered grid, wrapped in both axes.
  const G = 16;
  const pts = [];
  for (let i = 0; i < G; i++) {
    pts.push([]);
    for (let j = 0; j < G; j++) pts[i].push([(i + 0.15 + rng() * 0.7) * (S / G), (j + 0.15 + rng() * 0.7) * (S / G)]);
  }
  const at = (i, j) => {
    const p = pts[(i + G) % G][(j + G) % G];
    return [p[0] + Math.floor(i / G) * S, p[1] + Math.floor(j / G) * S];
  };
  ctx.strokeStyle = 'rgba(70,54,38,0.42)';
  for (let i = -1; i <= G; i++) {
    for (let j = -1; j <= G; j++) {
      const a = at(i, j);
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        if (rng() < 0.08) continue;
        const b = at(i + di, j + dj);
        ctx.lineWidth = 0.6 + rng() * 1.2;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo((a[0] + b[0]) / 2 + (rng() - 0.5) * 8, (a[1] + b[1]) / 2 + (rng() - 0.5) * 8);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
    }
  }
  return canvas;
}

function sdBrickTile() {
  const W = 512; const H = 512;
  const { canvas, ctx } = makeCanvas(W, H);
  const rng = seededRandom(1500);
  ctx.fillStyle = '#bcae94';
  ctx.fillRect(0, 0, W, H);
  // Sun-dried mud brick in stretcher bond, the mortar being more of the same mud: 8 courses to a tile.
  const rows = 8; const cols = 4;
  const rh = H / rows; const cw = W / cols;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? cw / 2 : 0;
    for (let c = -1; c <= cols; c++) {
      const v = 216 + Math.round(rng() * 38);
      ctx.fillStyle = `rgb(${v},${v - 6},${v - 20})`;
      ctx.fillRect(c * cw + off + 3, r * rh + 3, cw - 6, rh - 6);
      for (let k = 0; k < 8; k++) {
        const q = v - 22 - Math.round(rng() * 20);
        ctx.fillStyle = `rgba(${q},${q - 6},${q - 18},0.4)`;
        ctx.fillRect(c * cw + off + 4 + rng() * (cw - 12), r * rh + 4 + rng() * (rh - 12), 2 + rng() * 10, 1 + rng() * 2);
      }
    }
  }
  return canvas;
}

// A brick pier that batters as it rises, as flat quads with UVs in feet.
function sdPier(soup, cx, cz, y0, y1, hw0, hd0, hw1, hd1, col) {
  const k = 0.5;
  const q = (a, b, c, d, u0, u1) => soup.quad(a, b, c, d, [[u0 * k, y0 * k], [u1 * k, y0 * k], [u1 * k, y1 * k], [u0 * k, y1 * k]], col);
  const P = (sx, y, sz) => (y === y0 ? [cx + sx * hw0, y, cz + sz * hd0] : [cx + sx * hw1, y, cz + sz * hd1]);
  q(P(-1, y0, 1), P(1, y0, 1), P(1, y1, 1), P(-1, y1, 1), cx - hw0, cx + hw0);
  q(P(1, y0, -1), P(-1, y0, -1), P(-1, y1, -1), P(1, y1, -1), cx - hw0, cx + hw0);
  q(P(1, y0, 1), P(1, y0, -1), P(1, y1, -1), P(1, y1, 1), cz - hd0, cz + hd0);
  q(P(-1, y0, -1), P(-1, y0, 1), P(-1, y1, 1), P(-1, y1, -1), cz - hd0, cz + hd0);
  soup.quad(P(-1, y1, 1), P(1, y1, 1), P(1, y1, -1), P(-1, y1, -1), [[0, 0], [1, 0], [1, 1], [0, 1]], col);
  soup.quad(P(-1, y0, -1), P(1, y0, -1), P(1, y0, 1), P(-1, y0, 1), [[0, 0], [1, 0], [1, 1], [0, 1]], col);
}

// Wrapped turns of rope round a nearly straight run from a toward b.
function sdLash(points, centre, dir, radius, turns, length, wire) {
  const D = vec(dir).normalize();
  const ref = Math.abs(D.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const A = new THREE.Vector3().crossVectors(D, ref).normalize();
  const B = new THREE.Vector3().crossVectors(D, A).normalize();
  const n = Math.round(turns * 14);
  const list = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    const r = typeof radius === 'function' ? radius(t) : radius;
    const c = vec(centre).addScaledVector(D, (t - 0.5) * length);
    c.addScaledVector(A, Math.cos(a) * r).addScaledVector(B, Math.sin(a) * r);
    list.push([c.x, c.y, c.z]);
  }
  points.push({ geometry: tube(list, wire, { sides: 6, steps: n, round: 1 }), color: 0x9a7c4c });
}

function shaduf() {
  const earth = [];
  const wood = [];
  const crops = [];
  const water = [];
  const bricks = new Soup();
  const rng = seededRandom(1500);
  const half = SD.half;
  const SILT = lin(0x9a7f55); const DRY = lin(0xad9568); const WET = lin(0x4a3825); const BED = lin(0x5d472c); const CUT = lin(0x6a5238); const CUT2 = lin(0x4d3a26);

  // --- the ground ----------------------------------------------------------------------------------
  const N = 84;
  const pos = []; const col = []; const idx = [];
  const groundColor = (x, y, z) => {
    const nearDitch = z < 3.4 ? 1 - sstep(Math.min(sdDitchDist(x, z), Math.hypot(x - SD_BASIN[0], z - SD_BASIN[1]) - 0.6), 0.2, 1.05) : 0;
    const nearChan = 1 - sstep(y, SD.W + 0.04, SD.W + 0.95);
    const bed = z < 3.1 ? 0.55 : 0;
    const n = smoothNoise3(x * 0.9, 1, z * 0.9);
    const c = [mix(SILT[0], DRY[0], n), mix(SILT[1], DRY[1], n), mix(SILT[2], DRY[2], n)];
    for (let k = 0; k < 3; k++) c[k] = mix(c[k], BED[k], bed);
    const wet = Math.max(nearDitch, nearChan);
    for (let k = 0; k < 3; k++) c[k] = mix(c[k], WET[k], wet);
    return c;
  };
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = ((i / N) * 2 - 1) * half; const z = ((j / N) * 2 - 1) * half;
      const y = sdHeight(x, z);
      pos.push(x, y, z);
      const c = groundColor(x, y, z);
      col.push(c[0], c[1], c[2]);
    }
  }
  const st = N + 1;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const a = i * st + j; const b = a + 1; const c = (i + 1) * st + j; const d = c + 1;
      idx.push(a, b, c, c, b, d);
    }
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  top.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  top.setIndex(idx);
  top.computeVertexNormals();
  planarUV(top, 0.3);
  earth.push({ geometry: top, keepColor: true });
  // The sawn-off sides of the block, banded like the silt they are, and its floor.
  const skirt = new Soup();
  const band = (y) => {
    const n = 0.5 + 0.5 * Math.sin(y * 13 + 2 * Math.sin(y * 5));
    return [mix(CUT[0], CUT2[0], n), mix(CUT[1], CUT2[1], n), mix(CUT[2], CUT2[2], n)];
  };
  const seg = N;
  const edge = (fx, fz) => {
    for (let i = 0; i < seg; i++) {
      const t0 = i / seg; const t1 = (i + 1) / seg;
      const p0 = [fx(t0), fz(t0)]; const p1 = [fx(t1), fz(t1)];
      const y0 = sdHeight(p0[0], p0[1]); const y1 = sdHeight(p1[0], p1[1]);
      const rows = 3;
      for (let r = 0; r < rows; r++) {
        const a0 = (r / rows) * y0; const a1 = ((r + 1) / rows) * y0;
        const b0 = (r / rows) * y1; const b1 = ((r + 1) / rows) * y1;
        const uv = [[p0[0] + p0[1], a0], [p1[0] + p1[1], b0], [p1[0] + p1[1], b1], [p0[0] + p0[1], a1]].map((v) => [v[0] * 0.28, v[1] * 0.28]);
        const cc = [band(a0), band(b0), band(b1), band(a1)];
        skirt.quad([p0[0], a0, p0[1]], [p1[0], b0, p1[1]], [p1[0], b1, p1[1]], [p0[0], a1, p0[1]], uv, cc);
      }
    }
  };
  edge((t) => mix(-half, half, t), () => half);
  edge((t) => mix(half, -half, t), () => -half);
  edge(() => half, (t) => mix(half, -half, t));
  edge(() => -half, (t) => mix(-half, half, t));
  skirt.quad([-half, 0, -half], [half, 0, -half], [half, 0, half], [-half, 0, half], [[0, 0], [1, 0], [1, 1], [0, 1]], CUT2);
  earth.push({ geometry: skirt.geometry(), keepColor: true });

  // --- the water ------------------------------------------------------------------------------------
  const CHAN = 0x2a7f86; const DITCH = 0x318b92;
  water.push({ geometry: new THREE.BoxGeometry(half * 2 - 0.02, SD.W - 0.12, SD.chanHalf * 2 + 1.4), color: CHAN, position: [0, (SD.W + 0.12) / 2, SD.chanZ] });
  const DY = SD.F - 0.26;
  for (const [a, b] of SD_DITCHES) {
    const mx = (a[0] + b[0]) / 2; const mz = (a[1] + b[1]) / 2;
    const lx = Math.min(half * 2 - 0.04, Math.abs(b[0] - a[0]) + 0.6); const lz = Math.min(half * 2 - 0.04, Math.abs(b[1] - a[1]) + 0.6);
    water.push({ geometry: new THREE.BoxGeometry(lx, 0.14, lz), color: DITCH, position: [mx, DY - 0.07, mz] });
  }
  water.push({ geometry: new THREE.CylinderGeometry(1.0, 1.0, 0.14, 28), color: DITCH, position: [SD_BASIN[0], DY - 0.07, SD_BASIN[1]] });

  // --- the two mud-brick piers and the crossbar -------------------------------------------------------
  const PX = 1.72; const PZ = SD.pivot[2];
  const BAR_Y = SD.pivot[1] - 0.4;
  const PTOP = BAR_Y - 0.1;
  const BRICK = lin(0xb09570);
  for (const sx of [-1, 1]) {
    sdPier(bricks, sx * PX, PZ, SD.F - 0.3, PTOP, 0.86, 0.72, 0.58, 0.5, BRICK);
    // A skim of mud round the foot, where it meets the field, and a mud cap the bar is bedded in.
    earth.push({ geometry: smoothed(new THREE.SphereGeometry(1, 20, 10)), color: 0x7f6443, position: [sx * PX, SD.F - 0.06, PZ], scale: [1.12, 0.34, 0.98] });
    earth.push({ geometry: new THREE.SphereGeometry(1, 16, 8), color: 0x90734d, position: [sx * PX, PTOP + 0.03, PZ], scale: [0.68, 0.16, 0.6] });
  }
  const barC = 0x6d4c2a;
  wood.push({ geometry: tube([[-2.65, BAR_Y, PZ], [-1, BAR_Y + 0.02, PZ], [1, BAR_Y + 0.01, PZ], [2.65, BAR_Y - 0.01, PZ]], [0.22, 0.25, 0.25, 0.21], { sides: 14, steps: 18, round: 2 }), color: barC });

  // --- the pole: one bent tree, thick at the butt ----------------------------------------------------
  const poleTs = [];
  for (let i = 0; i <= 8; i++) poleTs.push(mix(-SD.butt, SD.arm, i / 8));
  const poleG = tube(poleTs.map(sdPolePoint), [0.25, 0.235, 0.215, 0.2, 0.175, 0.155, 0.13, 0.11, 0.09], { sides: 14, steps: 48, round: 2 });
  tintVertices(poleG, (x, y, z, out) => {
    const n = 0.5 + 0.5 * Math.sin(z * 2.2 + 3 * smoothNoise3(x * 3, y * 3, z * 0.6));
    const c = lin(0x8b6a3e);
    const k = 0.72 + 0.42 * n;
    out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
  });
  wood.push({ geometry: poleG, keepColor: true });
  // A rawhide lashing over the pole and bar, the only bearing a shaduf has.
  // Tight coils on the bar either side of the pole, then two crossed passes over the pole itself.
  const pv = sdPolePoint(0);
  for (const sx of [-1, 1]) sdLash(wood, [sx * 0.33, BAR_Y, PZ], [1, 0, 0], 0.285, 6, 0.24, 0.036);
  for (const sz of [-1, 1]) {
    for (const off of [-0.05, 0.05]) {
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const a = (t * 2 - 1) * (Math.PI * 0.62);
        const x = Math.sin(a) * 0.36;
        pts.push([x, pv[1] - 0.12 + Math.cos(a) * 0.34, PZ + off + sz * x * 0.8]);
      }
      wood.push({ geometry: tube(pts, 0.036, { sides: 6, steps: 24, round: 1 }), color: 0x9a7c4c });
    }
  }
  for (const sx of [-1, 1]) {
    // Pegs through the bar keep the pole from walking along it.
    rod(wood, 0x5e3f22, [sx * 0.62, BAR_Y + 0.12, PZ], [sx * 0.62, BAR_Y + 0.62, PZ], 0.05, { sides: 8 });
    dot(wood, 0x5e3f22, 0.05, [sx * 0.62, BAR_Y + 0.62, PZ], { sides: 8 });
  }

  // --- the counterweight: a great lump of dried Nile mud moulded onto the butt, then tied on ---------
  const LC = [0, sdPolePoint(-3.72)[1] - 0.46, sdPolePoint(-3.72)[2]];
  const lumpRadius = (dx, dy, dz) => 1.0 * (1 + 0.16 * (smoothNoise3(dx * 1.6 + 2, dy * 1.6, dz * 1.6) - 0.5) * 2 + 0.05 * (smoothNoise3(dx * 4, dy * 4 + 3, dz * 4) - 0.5) * 2);
  const LS = [1.12, 0.94, 1.02];
  const lumpAt = (dx, dy, dz, lift = 0) => {
    const l = Math.hypot(dx, dy, dz) || 1;
    const u = [dx / l, dy / l, dz / l];
    const r = lumpRadius(u[0], u[1], u[2]) + lift;
    return [LC[0] + u[0] * r * LS[0], LC[1] + u[1] * r * LS[1], LC[2] + u[2] * r * LS[2]];
  };
  const lump = new THREE.IcosahedronGeometry(1, 12);
  {
    const P = lump.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const q = lumpAt(P.getX(i), P.getY(i), P.getZ(i));
      P.setXYZ(i, q[0], q[1], q[2]);
    }
  }
  const lumpSmooth = smoothed(lump);
  tintVertices(lumpSmooth, (x, y, z, out) => {
    const n = smoothNoise3(x * 1.2, y * 1.2, z * 1.2);
    const c = lin(0x7a5e3a);
    const k = 0.8 + 0.45 * n;
    out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
  });
  planarUV(lumpSmooth, 0.9);
  earth.push({ geometry: lumpSmooth, keepColor: true });
  // Rope round it, in the two directions, each turn lying on the lump's own surface.
  for (const off of [-0.34, 0.1, 0.5]) {
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const dir = [Math.cos(a), Math.sin(a), off];
      pts.push(lumpAt(dir[0], dir[1], dir[2], 0.02));
    }
    wood.push({ geometry: tube(pts, 0.042, { sides: 6, steps: 48, round: 1 }), color: 0x9a7c4c });
  }
  for (const off of [-0.38, 0.38]) {
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const dir = [off, Math.cos(a), Math.sin(a)];
      pts.push(lumpAt(dir[0], dir[1], dir[2], 0.02));
    }
    wood.push({ geometry: tube(pts, 0.042, { sides: 6, steps: 48, round: 1 }), color: 0x9a7c4c });
  }

  // --- the rope and the bucket ------------------------------------------------------------------------
  const tip = sdPolePoint(SD.arm - 0.2);
  const ropeLen = 6.1;
  const handleY = tip[1] - ropeLen;
  sdLash(wood, tip, sdPoleDir, 0.115, 5, 0.34, 0.036);
  wood.push({ geometry: tube([[tip[0], tip[1] - 0.05, tip[2]], [0.03, tip[1] - 2, tip[2] + 0.015], [-0.02, tip[1] - 4, tip[2] - 0.01], [0, handleY, tip[2]]], 0.04, { sides: 7, steps: 28, round: 1 }), color: 0x9a7c4c });
  const BY = handleY - 1.15; // the bucket's foot
  const BZ = tip[2];
  const BR = 0.66;
  const bucket = spin([
    [0, BY], [0.3, BY + 0.01], [0.46, BY + 0.09], [0.57, BY + 0.35], [BR - 0.03, BY + 0.72], [BR, BY + 0.9, 'h'], [BR - 0.04, BY + 0.94, 'h'], [BR - 0.08, BY + 0.9, 'h'], [0.54, BY + 0.5], [0.42, BY + 0.2], [0, BY + 0.14],
  ], { segments: 34 });
  tintVertices(bucket, (x, y, z, out) => {
    const n = smoothNoise3(x * 3, y * 4, z * 3);
    const c = lin(0x93653a);
    const k = 0.72 + 0.5 * n;
    out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
  });
  wood.push({ geometry: bucket, keepColor: true, position: [0, 0, BZ] });
  // The bent-cane hoop that holds its mouth open.
  const hoop = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    hoop.push([Math.cos(a) * (BR - 0.015), BY + 0.91, BZ + Math.sin(a) * (BR - 0.015)]);
  }
  wood.push({ geometry: tube(hoop, 0.042, { sides: 7, steps: 40, round: 1 }), color: 0xa98d58 });
  for (let i = 0; i < 3; i++) {
    const a = 0.5 + (i / 3) * Math.PI * 2;
    rod(wood, 0x9a7c4c, [Math.cos(a) * (BR - 0.02), BY + 0.92, BZ + Math.sin(a) * (BR - 0.02)], [0, handleY + 0.03, BZ], 0.024, { sides: 5 });
    dot(wood, 0x9a7c4c, 0.03, [Math.cos(a) * (BR - 0.02), BY + 0.92, BZ + Math.sin(a) * (BR - 0.02)], { sides: 6 });
  }
  dot(wood, 0x8a6c40, 0.07, [0, handleY + 0.03, BZ], { sides: 8 });
  // The four sewn seams of a hide bucket, as real cord lying on its wall.
  const wall = [[0.03, 0.002], [0.3, 0.012], [0.46, 0.09], [0.57, 0.35], [BR - 0.03, 0.72], [BR, 0.9]];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    wood.push({ geometry: tube(wall.map(([r, y]) => [Math.cos(a) * (r + 0.004), BY + y, BZ + Math.sin(a) * (r + 0.004)]), 0.017, { sides: 5, steps: 14, round: 1 }), color: 0x3e2612 });
  }
  // Water in it, up near the brim, and running off it.
  water.push({ geometry: new THREE.CylinderGeometry(0.54, 0.46, 0.16, 26), color: 0x3a9aa4, position: [0, BY + 0.68, BZ] });
  const drips = [[0.2, 0.04], [0.12, 0.15], [-0.18, 0.3], [0.02, 0.5], [0.15, 0.73], [-0.1, 0.95]];
  drips.forEach(([dx, f], i) => {
    const y = mix(BY - 0.15, SD.W + 0.1, f);
    const g = new THREE.SphereGeometry(0.038 + (i % 3) * 0.006, 8, 6);
    water.push({ geometry: g, color: 0x8fd3da, position: [dx, y, BZ + (i % 2 ? 0.08 : -0.06)], scale: [0.8, 1.4, 0.8] });
  });

  // --- the crops: rows of green wheat on the higher field ------------------------------------------
  const plant = (x, z, h, heads) => {
    const y = sdHeight(x, z) - 0.04;
    const leaves = 6;
    for (let k = 0; k < leaves; k++) {
      const a = rng() * Math.PI * 2;
      const tall = h * (0.7 + rng() * 0.45);
      const out = 0.14 + rng() * 0.55;
      const ox = Math.cos(a); const oz = Math.sin(a);
      const g = tube([
        [x + ox * 0.03, y, z + oz * 0.03],
        [x + ox * out * 0.25, y + tall * 0.55, z + oz * out * 0.25],
        [x + ox * out * 0.72, y + tall * 0.92, z + oz * out * 0.72],
        [x + ox * out * 1.15, y + tall * 0.98, z + oz * out * 1.15],
      ], [0.056, 0.054, 0.036, 0], { sides: 3, steps: 3, round: 0, section: () => [0.5, 1] });
      const hue = 0.27 + (rng() - 0.5) * 0.05;
      const c = new THREE.Color().setHSL(hue, 0.62, 0.3 + rng() * 0.12);
      crops.push({ geometry: g, color: c.getHex() });
    }
    if (heads) {
      const dx = (rng() - 0.5) * 0.25; const dz = (rng() - 0.5) * 0.25;
      const sy = y + h * 1.12;
      crops.push({ geometry: tube([[x, y, z], [x + dx * 0.4, y + h * 0.7, z + dz * 0.4], [x + dx, sy, z + dz]], 0.02, { sides: 3, steps: 5, round: 0 }), color: 0x6f9b35 });
      const ear = new THREE.SphereGeometry(0.045, 6, 5);
      ear.scale(1, 4.2, 1);
      crops.push({ geometry: ear, color: 0xc2b862, position: [x + dx, sy + 0.14, z + dz] });
    }
  };
  for (let row = 0; row < 11; row++) {
    const z0 = -8.6 + row * 1.05;
    for (let i = 0; i < 20; i++) {
      const x = -8.65 + i * 0.91 + (rng() - 0.5) * 0.26;
      const z = z0 + (rng() - 0.5) * 0.24;
      if (sdDitchDist(x, z) < 0.86) continue;
      if (Math.hypot(x - SD_BASIN[0], z - SD_BASIN[1]) < 1.65) continue;
      if (Math.abs(Math.abs(x) - PX) < 1.55 && Math.abs(z - PZ) < 1.3) continue;
      if (z > 2.45) continue;
      plant(x, z, 1.25 + rng() * 0.75, rng() < 0.4);
    }
  }
  // A few clumps of reed on the far levee, kept to the corners so they frame the channel without hiding it.
  for (const [cx, cz] of [[-7.6, 8.45], [-6.2, 8.65], [7.3, 8.5], [8.2, 8.6]]) {
    for (let k = 0; k < 9; k++) {
      const x = cx + (rng() - 0.5) * 0.9; const z = cz + (rng() - 0.5) * 0.7;
      const y = sdHeight(x, z) - 0.05;
      const h = 2.2 + rng() * 1.4; const dx = (rng() - 0.5) * 0.7; const dz = (rng() - 0.5) * 0.7;
      crops.push({ geometry: tube([[x, y, z], [x + dx * 0.2, y + h * 0.6, z + dz * 0.2], [x + dx, y + h, z + dz]], [0.045, 0.034, 0], { sides: 3, steps: 5, round: 0 }), color: 0x4d7f2a });
    }
  }

  const earthC = sdEarthTile();
  const earthM = meshFrom(mergeParts(earth), { map: texOf(earthC, THREE.SRGBColorSpace), bumpMap: texOf(earthC, THREE.NoColorSpace), bumpScale: 0.8, roughness: 0.96, metalness: 0 });
  const woodC = grainTile(1500);
  const woodM = meshFrom(mergeParts(wood), { map: texOf(woodC, THREE.SRGBColorSpace), bumpMap: texOf(woodC, THREE.NoColorSpace), bumpScale: 0.7, roughness: 0.86, metalness: 0 });
  // A swept tube's own UVs are not in feet, so the timbers take theirs from the world.
  planarUV(woodM.geometry, 0.55);
  const brickC = sdBrickTile();
  const brickM = meshFrom(bricks.geometry(), { map: texOf(brickC, THREE.SRGBColorSpace), bumpMap: texOf(brickC, THREE.NoColorSpace), bumpScale: 0.9, roughness: 0.95, metalness: 0 });
  const cropM = meshFrom(mergeParts(crops), { roughness: 0.74, metalness: 0 });
  const waterG = planarUV(mergeParts(water), 0.4);
  const waterM = meshFrom(waterG, {
    transparent: true, opacity: 0.84, roughness: 0.16, metalness: 0.05, bumpMap: grainTexture(77), bumpScale: 0.35,
  }, { shadow: false });
  return groupOf(earthM, woodM, brickM, cropM, waterM);
}

// ---------------------------------------------------------------------------
// The Greek trireme
// ---------------------------------------------------------------------------

// True size. Length, beam and the 2.9ft oar spacing follow the Olympias reconstruction and the ship
// sheds at Piraeus as I recall them; the sheer and the sternpost follow vase paintings and that
// reconstruction, and are a reading rather than a measurement. 31 top, 27 middle and 27 bottom oars a
// side is the figure from the Athenian naval inventories, as reconstructed by Morrison and Coates.
const TR = {
  wl: 3.4, OARS: { top: 31, mid: 27, low: 27 }, spacing: 2.9,
  midY: 6.8, lowY: 4.7, outY: 9.4, out: 1.9,
};
const trS = (z) => (z + 56) / 110.5;
const trKeel = (s) => (s < 0.14 ? 9.5 * ((0.14 - s) / 0.14) ** 1.8 : 0) + (s > 0.9 ? 1.9 * ((s - 0.9) / 0.1) ** 2 : 0);
const trSheer = (s) => 9 + (s > 0.7 ? 3.4 * ((s - 0.7) / 0.3) ** 2.2 : 0) + (s < 0.32 ? 7 * ((0.32 - s) / 0.32) ** 2 : 0);
function trBeam(s) {
  const g = s >= 0.52 ? Math.max(0, 1 - ((s - 0.52) / 0.48) ** 2.3) ** 1.05 : Math.max(0, 1 - ((0.52 - s) / 0.52) ** 2.6) ** 0.9;
  return 0.16 + 6.3 * g;
}
const trE = (s, y) => {
  const k = trKeel(s);
  return clamp01((y - k) / Math.max(0.01, trSheer(s) - k));
};
function trHalf(s, y) {
  const e = trE(s, y);
  const p = mix(0.58, 1.05, sstep(s, 0.76, 1)) + 0.28 * sstep(1 - s, 0.8, 1);
  return 0.14 + (trBeam(s) - 0.14) * e ** p * (1 - 0.045 * sstep(e, 0.78, 1));
}
function trZ(s, y) {
  const e = trE(s, y);
  return -56 + 110.5 * s - 3.2 * e ** 1.6 * sstep(s, 0.86, 1) - 2.1 * e * sstep(1 - s, 0.86, 1);
}
const trP = (s, y, side, lift = 0) => [side * (trHalf(s, y) + lift), y, trZ(s, y)];
const trDeckY = (z) => 11 + 0.42 * (z / 44) ** 2;

function trNormal(s, y, side) {
  const h = 0.004; const hy = 0.04;
  const a = trP(Math.min(1, s + h), y, side); const b = trP(Math.max(0, s - h), y, side);
  const c = trP(s, Math.min(y + hy, trSheer(s)), side); const d = trP(s, Math.max(trKeel(s), y - hy), side);
  const dz = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dy = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
  let nx = dy[1] * dz[2] - dy[2] * dz[1]; let ny = dy[2] * dz[0] - dy[0] * dz[2]; let nz = dy[0] * dz[1] - dy[1] * dz[0];
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  return side > 0 ? [nx, ny, nz] : [-nx, -ny, -nz];
}

// The hull as bands of rows, each band in one flat run of paint, so a paint line falls on a grid line
// and is sharp from any distance. Then a deck across the sheer, and both ends closed.
function trHull() {
  const N = 112;
  const sAt = (i) => clamp01(0.5 - 0.5 * Math.cos(Math.PI * (i / N)));
  const BLACK = [0.028, 0.024, 0.024]; const RED = lin(0xa8481f); const RED2 = lin(0x8a3817); const OCHRE = lin(0xc98f36); const DECK = lin(0xa98a5c);
  const pos = []; const nor = []; const uv = []; const col = []; const idx = [];
  const bandRows = (fn0, fn1, rows, colorFn) => {
    for (const side of [-1, 1]) {
      const base = pos.length / 3;
      for (let i = 0; i <= N; i++) {
        const s = sAt(i);
        for (let r = 0; r <= rows; r++) {
          const y = mix(fn0(s), fn1(s), r / rows);
          const p = trP(s, y, side);
          const n = trNormal(s, y, side);
          pos.push(p[0], p[1], p[2]);
          nor.push(n[0], n[1], n[2]);
          uv.push(p[2] / 8, y / 8);
          const c = colorFn(s, y);
          col.push(c[0], c[1], c[2]);
        }
      }
      const stride = rows + 1;
      for (let i = 0; i < N; i++) {
        for (let r = 0; r < rows; r++) {
          const a = base + i * stride + r; const b = a + 1; const c = a + stride + 1; const d = a + stride;
          if (side > 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
        }
      }
    }
  };
  const blackTop = (s) => Math.max(trKeel(s), Math.min(trSheer(s) - 0.02, 3.95));
  const stripeLo = (s) => Math.max(blackTop(s), trSheer(s) - 1.15);
  const stripeHi = (s) => Math.max(stripeLo(s), trSheer(s) - 0.8);
  const redC = (s, y) => {
    const n = smoothNoise3(s * 34, y * 0.8, 3.3);
    return [mix(RED[0], RED2[0], n), mix(RED[1], RED2[1], n), mix(RED[2], RED2[2], n)];
  };
  bandRows(trKeel, blackTop, 8, () => BLACK);
  bandRows(blackTop, stripeLo, 7, redC);
  bandRows(stripeLo, stripeHi, 1, () => OCHRE);
  bandRows(stripeHi, trSheer, 2, () => BLACK);
  // The deck across the sheer, clipped to the hull's own width at every station.
  const across = 6;
  const base = pos.length / 3;
  for (let i = 0; i <= N; i++) {
    const s = sAt(i);
    const y = trSheer(s);
    const half = trHalf(s, y);
    const z = trZ(s, y);
    for (let j = 0; j <= across; j++) {
      const t = (j / across) * 2 - 1;
      pos.push(t * half, y + (1 - t * t) * half * 0.02, z);
      nor.push(0, 1, 0);
      uv.push((t * half) / 8, z / 8);
      col.push(DECK[0], DECK[1], DECK[2]);
    }
  }
  const st = across + 1;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < across; j++) {
      const a = base + i * st + j; const b = a + 1; const c = a + st; const d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function trPlankTile() {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const rng = seededRandom(480);
  ctx.fillStyle = '#efe9dd';
  ctx.fillRect(0, 0, S, S);
  // Thirteen strakes to the 8ft tile, with butts staggered along them: shell-first planking.
  const rows = 13;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    const v = 218 + Math.round(rng() * 34);
    ctx.fillStyle = `rgb(${v},${v - 4},${v - 11})`;
    ctx.fillRect(0, r * rh, S, rh);
    ctx.fillStyle = 'rgba(40,28,18,0.6)';
    ctx.fillRect(0, r * rh, S, 1.8);
    const butt = rng() * S;
    ctx.fillRect(butt, r * rh, 1.6, rh);
    // The double row of treenails along each seam, which is how these hulls were held together.
    ctx.fillStyle = 'rgba(50,34,20,0.34)';
    for (let k = 0; k < 16; k++) ctx.fillRect(k * (S / 16) + (r % 2) * 14, r * rh + 4, 1.6, 1.6);
  }
  return canvas;
}

// Sail cloth in the upper three quarters, the painted eye in the lower-left square.
function trAtlas() {
  const W = 1024; const H = 1024; const sailH = 768;
  const { canvas, ctx } = makeCanvas(W, H);
  const rng = seededRandom(490);
  ctx.fillStyle = '#f4ecd8';
  ctx.fillRect(0, 0, W, H);
  const cloths = 24;
  for (let i = 0; i < cloths; i++) {
    const v = 226 + Math.round(rng() * 26);
    ctx.fillStyle = `rgb(${v},${v - 5},${v - 18})`;
    ctx.fillRect((i / cloths) * W, 0, W / cloths, sailH);
    ctx.fillStyle = 'rgba(112,92,60,0.5)';
    ctx.fillRect((i / cloths) * W, 0, 1.6, sailH);
  }
  // The rows of brail rings and bands that give a Greek sail the chequered look it has on the vases.
  for (let r = 1; r < 8; r++) {
    const y = (r / 8) * sailH;
    ctx.fillStyle = 'rgba(120,98,62,0.55)';
    ctx.fillRect(0, y - 1.5, W, 3);
  }
  // Weather and a little staining toward the foot.
  for (let i = 0; i < 60; i++) {
    const v = 170 + Math.round(rng() * 30);
    ctx.fillStyle = `rgba(${v},${v - 12},${v - 34},0.07)`;
    const w = 40 + rng() * 140;
    ctx.fillRect(rng() * W, sailH * (0.55 + rng() * 0.45) - 40, w, 20 + rng() * 60);
  }
  ctx.fillStyle = '#7a2e16';
  ctx.fillRect(0, sailH - 18, W, 18);
  ctx.fillRect(0, 0, W, 10);
  // The eye: an almond on the hull's own red, outlined in black, with a dark iris in a coloured ring.
  const E = { x: 0, y: sailH, w: 256, h: 256 };
  ctx.fillStyle = '#9a4420';
  ctx.fillRect(E.x, E.y, E.w, E.h);
  const cx = E.x + E.w / 2; const cy = E.y + E.h / 2;
  const almond = () => {
    ctx.beginPath();
    ctx.moveTo(cx - 82, cy + 4);
    ctx.quadraticCurveTo(cx - 8, cy - 74, cx + 82, cy - 4);
    ctx.quadraticCurveTo(cx + 8, cy + 74, cx - 82, cy + 4);
    ctx.closePath();
  };
  almond();
  ctx.fillStyle = '#efe7d2';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#0e0c0b';
  ctx.stroke();
  ctx.fillStyle = '#b58a2e';
  ctx.beginPath(); ctx.arc(cx, cy, 33, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0e0c0b';
  ctx.beginPath(); ctx.arc(cx, cy, 24, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#efe7d2';
  ctx.beginPath(); ctx.arc(cx - 9, cy - 9, 5, 0, Math.PI * 2); ctx.fill();
  return { tex: texOf(canvas, THREE.SRGBColorSpace, false), sailV: (t) => 1 - t * (sailH / H), eyeUV: (u, v) => [0.25 * u, (1 - v) * 0.25] };
}

function greekTrireme() {
  const hull = [];
  const woodList = [];
  const fit = [];
  const bronze = [];
  const cloth = [];
  const panel = new Soup();
  const rng = seededRandom(480);
  const BLACK = 0x101012; const RED = 0x8a3418; const OCHRE = 0xc98f36; const ROPE = 0x8c7650; const STAND = 0x5a3e26;

  hull.push({ geometry: trHull(), keepColor: true });

  // --- the keel, the stem and the sweeping stern ----------------------------------------------------
  const keelPts = [];
  for (let i = 0; i <= 28; i++) {
    const s = 0.02 + (i / 28) * 0.97;
    keelPts.push([0, trKeel(s) + 0.1, trZ(s, trKeel(s))]);
  }
  fit.push({ geometry: tube(keelPts, 0.34, { sides: 8, steps: 70, round: 1, section: () => [1, 0.62], frame: () => [0, 1, 0] }), color: BLACK });
  const stemTop = trSheer(1);
  const stemZ = trZ(1, stemTop);
  const stemPts = [];
  for (let k = 0; k <= 6; k++) {
    const y = mix(3.5, stemTop, k / 6);
    stemPts.push([0, y, trZ(1, y)]);
  }
  stemPts.push([0, stemTop + 1.5, stemZ - 1.0], [0, stemTop + 3.0, stemZ - 2.6], [0, stemTop + 3.9, stemZ - 4.8], [0, stemTop + 3.7, stemZ - 6.6]);
  const stemG = tube(stemPts, [0.62, 0.6, 0.58, 0.56, 0.54, 0.52, 0.5, 0.44, 0.36, 0.26, 0.15], { sides: 10, steps: 66, round: 2, section: () => [0.62, 1], frame: () => [1, 0, 0] });
  fit.push({ geometry: tintVertices(stemG, (x, y, z, out) => {
    const c = y > stemTop + 3.1 ? lin(OCHRE) : y > stemTop + 2.6 ? lin(BLACK) : y > stemTop - 0.9 ? lin(RED) : lin(BLACK);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  }), keepColor: true });
  // The stern: the keel rises out of the water, narrows to a post and curls forward over the helmsman.
  const sTop = trSheer(0);
  const sZ = trZ(0, sTop);
  const sternPts = [[0, trKeel(0) - 0.4, trZ(0, trKeel(0)) + 0.8], [0, 12.5, trZ(0, 12.5) - 0.2], [0, sTop, sZ - 0.1], [0, 18.6, -60.2], [0, 22.0, -60.6], [0, 25.2, -58.9], [0, 27.1, -56.0], [0, 27.6, -53.4]];
  const sternG = tube(sternPts, [0.75, 0.9, 0.8, 0.6, 0.46, 0.34, 0.22, 0.1], { sides: 10, steps: 56, round: 2, section: () => [0.6, 1], frame: () => [1, 0, 0] });
  const sternTint = (x, y, z, out) => {
    const c = y > 26 ? lin(OCHRE) : y > 24.8 ? lin(BLACK) : y > 16.3 ? lin(RED) : lin(BLACK);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  };
  fit.push({ geometry: tintVertices(sternG, sternTint), keepColor: true });
  // The aphlaston's fan, thin curved ribs spreading off the post.
  [[-1.7, -1.6], [-0.9, -0.7], [0.9, -0.7], [1.7, -1.6]].forEach(([dx, dy]) => {
    const g = tube([[0, 18.2, -60.2], [dx * 0.36, 21, -60.5 + 0.1], [dx * 0.72, 23.9 + dy * 0.45, -59.4], [dx, 25.8 + dy, -57.1], [dx * 1.08, 26.1 + dy, -55.2]], [0.2, 0.2, 0.18, 0.14, 0.06], { sides: 7, steps: 26, round: 2, section: () => [0.6, 1], frame: () => [1, 0, 0] });
    fit.push({ geometry: tintVertices(g, (x, y, z, out) => {
      const c = y > 24 + dy * 0.6 ? lin(OCHRE) : y > 23 + dy * 0.6 ? lin(BLACK) : lin(RED);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    }), keepColor: true });
  });

  // --- the wales: heavy timbers that carry the ram's blow back along the hull ------------------------
  for (const side of [-1, 1]) {
    for (const [s0, s1, ym, yb] of [[0.992, 0.14, 5.7, 4.6], [0.982, 0.1, 8.15, 7.25]]) {
      const pts = [];
      for (let i = 0; i <= 26; i++) {
        const s = mix(s0, s1, i / 26);
        const y = mix(ym, yb, sstep(s, 0.84, 0.97));
        const c = Math.min(y, trSheer(s) - 0.15);
        pts.push(trP(s, c, side, 0.04));
      }
      fit.push({ geometry: tube(pts, 0.19, { sides: 7, steps: 70, round: 2, section: () => [0.75, 1.15], frame: () => [side, 0, 0] }), color: 0x1b130d });
    }
  }

  // --- the outrigger, the deck and the gallery between them ------------------------------------------
  const outHalf = (z) => {
    const s = trS(z);
    const taper = sstep(44.6 - Math.abs(z), 0, 9);
    return { hx: trHalf(s, TR.outY), out: TR.out * (0.25 + 0.75 * taper) };
  };
  const outY = (z) => TR.outY + 0.32 * (z / 45) ** 2;
  const q2 = (side, a, b, c, d, color) => {
    const M = (p) => [side * p[0], p[1], p[2]];
    // Written for side = +1; a reflection reverses the winding.
    // A level face's boards run across the ship and an upright face's along it, or the strakes go diagonal.
    const level = Math.abs(Math.max(a[1], b[1], c[1], d[1]) - Math.min(a[1], b[1], c[1], d[1])) < 0.35 && Math.abs(a[0] - c[0]) > 0.4;
    const uvf = (p) => [p[2] / 8, (level ? p[0] : p[1]) / 8];
    if (side > 0) panel.quad(M(d), M(c), M(b), M(a), [uvf(d), uvf(c), uvf(b), uvf(a)], color);
    else panel.quad(M(a), M(b), M(c), M(d), [uvf(a), uvf(b), uvf(c), uvf(d)], color);
  };
  const OUTC = lin(0x962f14); const OUTB = lin(0x201510); const OUTT = lin(0x9e7c46); const DECKC = lin(0xa98a5c); const DARK = lin(0x0f0c0a); const EDGE = lin(0x7a2a12);
  const OR = 40;
  for (const side of [-1, 1]) {
    for (let i = 0; i < OR; i++) {
      const z0 = mix(-45, 45, i / OR); const z1 = mix(-45, 45, (i + 1) / OR);
      const A = outHalf(z0); const B = outHalf(z1);
      const y0 = outY(z0); const y1 = outY(z1);
      const ring = (h, y, z) => [
        [h.hx - 0.4, y - 0.9, z], [h.hx + h.out - 0.12, y - 0.42, z], [h.hx + h.out, y + 0.1, z], [h.hx + h.out, y + 0.62, z], [h.hx - 0.4, y + 0.72, z],
      ];
      const a = ring(A, y0, z0); const b = ring(B, y1, z1);
      q2(side, a[0], b[0], b[1], a[1], OUTB); // underside
      q2(side, a[1], b[1], b[2], a[2], OUTC);
      q2(side, a[2], b[2], b[3], a[3], OUTC);
      q2(side, a[3], b[3], b[4], a[4], OUTT);
      if (i === 0) q2(side, a[0], a[1], a[3], a[4], OUTC);
      if (i === OR - 1) q2(side, b[1], b[0], b[4], b[3], OUTC);
    }
  }
  // A dark gallery behind the stanchions, where the top rowers sit, and the deck over them.
  const G0 = -40; const G1 = 42; const GN = 34;
  for (const side of [-1, 1]) {
    for (let i = 0; i < GN; i++) {
      const z0 = mix(G0, G1, i / GN); const z1 = mix(G0, G1, (i + 1) / GN);
      const s0 = trS(z0); const s1 = trS(z1);
      const h0 = trHalf(s0, trSheer(s0)); const h1 = trHalf(s1, trSheer(s1));
      const low0 = trSheer(s0) - 0.1; const low1 = trSheer(s1) - 0.1;
      const d0 = trDeckY(z0); const d1 = trDeckY(z1);
      q2(side, [h0 - 1.0, low0, z0], [h1 - 1.0, low1, z1], [h1 - 1.0, d1, z1], [h0 - 1.0, d0, z0], DARK);
      // The deck's top, its edge and its underside.
      const w0 = h0 - 0.1; const w1 = h1 - 0.1;
      q2(side, [0, d0 + 0.26, z0], [w0, d0 + 0.26, z0], [w1, d1 + 0.26, z1], [0, d1 + 0.26, z1], DECKC);
      q2(side, [w0, d0, z0], [w1, d1, z1], [w1, d1 + 0.26, z1], [w0, d0 + 0.26, z0], EDGE);
      q2(side, [0, d1, z1], [w1, d1, z1], [w0, d0, z0], [0, d0, z0], DARK);
    }
    const he0 = trHalf(trS(G0), trSheer(trS(G0))) - 0.1; const he1 = trHalf(trS(G1), trSheer(trS(G1))) - 0.1;
    q2(side, [0, trDeckY(G1) + 0.26, G1], [he1, trDeckY(G1) + 0.26, G1], [he1, trSheer(trS(G1)) - 0.1, G1], [0, trSheer(trS(G1)) - 0.1, G1], EDGE);
    q2(side, [he0, trDeckY(G0) + 0.26, G0], [0, trDeckY(G0) + 0.26, G0], [0, trSheer(trS(G0)) - 0.1, G0], [he0, trSheer(trS(G0)) - 0.1, G0], EDGE);
  }
  // Stanchions from the gunwale to the deck edge, a pair at every oar station, and the rail on top.
  const railTop = (z) => trDeckY(z) + 1.75;
  for (const side of [-1, 1]) {
    let prev = null;
    for (let i = 0; i <= 28; i++) {
      const z = mix(G0 + 0.6, G1 - 0.6, i / 28);
      const s = trS(z);
      const w = trHalf(s, trSheer(s)) - 0.22;
      if (i % 2 === 0) rod(fit, 0x4b2315, [side * w, trSheer(s) - 0.1, z], [side * w, trDeckY(z) + 0.05, z], 0.1, { sides: 7 });
      rod(fit, 0x3b2318, [side * w, trDeckY(z) + 0.2, z], [side * w, railTop(z), z], 0.055, { sides: 6 });
      if (prev) {
        rod(fit, OCHRE, [side * prev.w, railTop(prev.z), prev.z], [side * w, railTop(z), z], 0.065, { sides: 6 });
        rod(fit, 0x4b2315, [side * prev.w, trDeckY(prev.z) + 1.0, prev.z], [side * w, trDeckY(z) + 1.0, z], 0.035, { sides: 5 });
      }
      prev = { z, w };
    }
  }
  for (const z of [G0 + 0.6, G1 - 0.6]) {
    const s = trS(z);
    const w = trHalf(s, trSheer(s)) - 0.22;
    rod(fit, OCHRE, [-w, railTop(z), z], [w, railTop(z), z], 0.065, { sides: 6 });
  }
  // The catheads, heavy beams across the bow that guard the outrigger in a ram attack.
  const CZ = 44.5; const cs = trS(CZ);
  const cw = trHalf(cs, trSheer(cs));
  bar(fit, BLACK, [-cw - 1.5, trSheer(cs) + 0.15, CZ], [cw + 1.5, trSheer(cs) + 0.15, CZ], 0.95, 0.95);
  for (const side of [-1, 1]) block(fit, OCHRE, 0.12, 1.0, 1.0, [side * (cw + 1.5), trSheer(cs) + 0.15, CZ]);

  // --- the ram: cast bronze, three fins, at the waterline --------------------------------------------
  const RY = TR.wl;
  bronze.push({
    geometry: outward(solidLoft([
      { d: 51.2, w: 1.02, up: 2.5, dn: 1.6, b: RY, round: 0.55 },
      { d: 53, w: 0.98, up: 2.1, dn: 1.55, b: RY, round: 0.55 },
      { d: 55.2, w: 0.82, up: 1.05, dn: 1.1, b: RY, round: 0.6 },
      { d: 57.4, w: 0.66, up: 0.74, dn: 0.76, b: RY, round: 0.65 },
      { d: 60.2, w: 0.52, up: 0.6, dn: 0.6, b: RY, round: 0.7 },
      { d: 60.95, w: 0.28, up: 0.3, dn: 0.3, b: RY, round: 0.8 },
    ], { sides: 28, samples: 40 })),
    color: 0x8f6329,
  });
  for (const off of [-0.68, 0, 0.68]) {
    bronze.push({
      geometry: outward(solidLoft([
        { d: 54.3, w: 0.72, h: 0.07, b: RY + off * 1.2, round: 0.7 },
        { d: 56, w: 0.98, h: 0.1, b: RY + off * 1.1, round: 0.7 },
        { d: 59.8, w: 0.92, h: 0.12, b: RY + off, round: 0.7 },
        { d: 61.3, w: 0.62, h: 0.1, b: RY + off, round: 0.7 },
        { d: 61.6, w: 0.08, h: 0.03, b: RY + off, round: 0.8 },
      ], { sides: 16, samples: 24 })),
      color: 0x9b6d2f,
    });
  }
  bronze.push({
    geometry: outward(solidLoft([
      { d: 55, w: 0.07, up: 1.06, dn: 1.12, b: RY, round: 0.7 },
      { d: 59.8, w: 0.09, up: 0.72, dn: 0.72, b: RY, round: 0.7 },
      { d: 61.25, w: 0.08, up: 0.58, dn: 0.58, b: RY, round: 0.7 },
      { d: 61.55, w: 0.02, up: 0.05, dn: 0.05, b: RY, round: 0.8 },
    ], { sides: 12, samples: 18 })),
    color: 0x9b6d2f,
  });
  // The small upper beak over the main ram, in timber sheathed with bronze.
  bronze.push({
    geometry: outward(solidLoft([
      { d: 49.6, w: 0.5, h: 0.5, b: 7.15, round: 0.65 },
      { d: 51.6, w: 0.42, h: 0.42, b: 7.25, round: 0.65 },
      { d: 53.6, w: 0.26, h: 0.28, b: 7.5, round: 0.7 },
      { d: 54, w: 0.05, h: 0.05, b: 7.55, round: 0.7 },
    ], { sides: 14, samples: 16 })),
    color: 0x8f6329,
  });

  // --- 170 oars, 85 a side, every tier's blades reaching the same waterline ---------------------------
  // The tiers differ in where the oar comes out and so in how steeply it falls, which is the whole
  // reason three banks fit in one hull: all the blades reach the water together.
  const oars = [];
  let oarCount = 0;
  const BLADE = { top: 0xd1a148, mid: 0x9c3a18, low: 0x18120e };
  const oarFrom = (start, tier, side, z, len) => {
    const out = side;
    const dz = -1.5;
    const drop = start[1] - (TR.wl - 0.25);
    const dh = Math.sqrt(Math.max(0.01, len * len - drop * drop - dz * dz));
    const jitter = (rng() - 0.5) * 0.18;
    const tip = [start[0] + out * dh, TR.wl - 0.25 + jitter * 0.4, z + dz + jitter];
    rod(oars, 0xbea272, start, tip, 0.1, { sides: 5, r2: 0.072 });
    // The blade, flat side on to a viewer alongside.
    const t = 0.72;
    const b0 = [mix(start[0], tip[0], t), mix(start[1], tip[1], t), mix(start[2], tip[2], t)];
    bar(oars, BLADE[tier], b0, tip, 0.1, 0.62, { up: [0, 1, 0] });
    oarCount += 1;
  };
  for (const side of [-1, 1]) {
    for (let i = 0; i < TR.OARS.top; i++) {
      const z = (i - (TR.OARS.top - 1) / 2) * TR.spacing;
      const h = outHalf(z);
      const y = outY(z) + 0.28;
      const start = [side * (h.hx + h.out - 0.05), y, z];
      oarFrom(start, 'top', side, z, 9.6);
      // The slot in the outrigger's face the oar works through.
      block(fit, 0x0d0a08, 0.1, 0.55, 0.62, [side * (h.hx + h.out + 0.015), y, z]);
      // Knees under the outrigger, every second station.
      if (i % 2 === 0) {
        const s = trS(z);
        const low = outY(z) - 2.4;
        bar(fit, 0x2a1a10, trP(s, low, side, -0.05), [side * (h.hx + h.out - 0.14), outY(z) - 0.38, z], 0.17, 0.26, { up: [0, 0, 1] });
      }
    }
    for (const [tier, Y, n, off, len] of [['mid', TR.midY, TR.OARS.mid, 0.3, 10.2], ['low', TR.lowY, TR.OARS.low, -0.4, 10.6]]) {
      for (let i = 0; i < n; i++) {
        const z = (i - (n - 1) / 2) * TR.spacing + off;
        const s = trS(z);
        const p = trP(s, Y, side);
        oarFrom([p[0] - side * 0.1, Y, z], tier, side, z, len);
        // The port and its leather sleeve, as a low dark dome sunk in the planking.
        const sleeve = new THREE.SphereGeometry(0.34, 10, 5);
        sleeve.scale(0.5, 1, 1);
        fit.push({ geometry: sleeve, color: 0x130d09, position: p });
      }
    }
  }
  const expected = 2 * (TR.OARS.top + TR.OARS.mid + TR.OARS.low);
  if (oarCount !== expected || expected !== 170) throw new Error(`trireme has ${oarCount} oars, not 170`);

  // --- the two steering oars --------------------------------------------------------------------
  for (const side of [-1, 1]) {
    const z = -41;
    const s = trS(z);
    const w = trHalf(s, trSheer(s));
    const top = [side * (w + 0.25), trSheer(s) + 1.5, z];
    const tip = [side * (w + 1.8), 2.0, z - 9.6];
    rod(fit, 0x6d4d2d, top, tip, 0.2, { sides: 8, r2: 0.12 });
    bar(fit, 0x8a3418, [mix(top[0], tip[0], 0.72), mix(top[1], tip[1], 0.72), mix(top[2], tip[2], 0.72)], tip, 0.14, 1.5, { up: [0, 0.3, 1] });
    bar(fit, 0x4b2315, top, [side * (w - 1.7), trSheer(s) + 1.75, z + 0.6], 0.13, 0.13);
    block(fit, BLACK, 0.6, 0.65, 1.3, [side * (w - 0.05), trSheer(s) + 0.9, z]);
  }

  // --- the mast, the yard and the sail --------------------------------------------------------------
  const MZ = 3.5; const MTOP = 48;
  fit.push({ geometry: spin([[0, 9.5], [0.5, 9.5], [0.46, 20], [0.4, 34], [0.28, MTOP - 0.8], [0.3, MTOP - 0.4], [0.32, MTOP], [0, MTOP + 0.05]], { segments: 16 }), color: 0x6a4a2a, position: [0, 0, MZ] });
  block(fit, 0x4b2315, 1.5, 0.7, 1.5, [0, trDeckY(MZ) + 0.5, MZ]);
  const YY = 45.2; const YZ = MZ + 0.55;
  const YW = 18.5;
  const yardPts = [];
  for (let i = 0; i <= 10; i++) {
    const t = (i / 10) * 2 - 1;
    yardPts.push([t * YW, YY - 0.9 * t * t, YZ]);
  }
  fit.push({ geometry: tube(yardPts, [0.1, 0.17, 0.23, 0.28, 0.32, 0.34, 0.32, 0.28, 0.23, 0.17, 0.1], { sides: 10, steps: 44, round: 2 }), color: 0x5a3e24 });
  const parrel = new THREE.TorusGeometry(0.52, 0.1, 8, 18);
  parrel.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  fit.push({ geometry: parrel, color: ROPE, position: [0, YY, MZ] });
  // The sail, bellied forward on the following wind, with real thickness and a rim.
  const atlas = trAtlas();
  const SW = 34; const SH = 25.5;
  const sailPoint = (u, v) => {
    const x = (u - 0.5) * SW;
    const t = x / YW;
    const head = YY - 0.9 * t * t - 0.3;
    const y = head - v * (SH - 1.2 * Math.sin(Math.PI * u) ** 2);
    const belly = 3.4 * Math.sin(Math.PI * u) ** 0.75 * Math.sin(Math.PI * (0.06 + 0.88 * v)) ** 0.9;
    const ripple = 0.1 * Math.sin(u * Math.PI * 24) * sstep(v, 0.1, 0.5);
    return [x, y, YZ + 0.18 + belly + ripple];
  };
  const sailG = solidSurface({ nu: 44, nv: 26, point: sailPoint, thick: () => 0.05 });
  {
    const uv = sailG.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), atlas.sailV(uv.getY(i)));
  }
  cloth.push({ geometry: sailG, color: 0xf0e8d4 });
  // The brails, the lines that gather a sail up to its yard, running down its forward face; and at the
  // head, the row of ties that lash it on.
  for (let k = 1; k < 9; k++) {
    const u = k / 9;
    const pts = [];
    for (let j = 0; j <= 10; j++) {
      const q = sailPoint(u, j / 10);
      pts.push([q[0], q[1], q[2] + 0.1]);
    }
    fit.push({ geometry: tube(pts, 0.05, { sides: 5, steps: 22, round: 1 }), color: 0x8c6f45 });
    const head = sailPoint(u, 0);
    fit.push({ geometry: new THREE.SphereGeometry(0.17, 6, 4), color: ROPE, position: [head[0], head[1] + 0.1, YZ] });
  }
  // Standing and running rigging.
  const line = (a, b, r = 0.07) => rod(fit, ROPE, a, b, r, { sides: 5 });
  const hullAt = (z, side, y = null) => {
    const s = trS(z);
    return [side * (trHalf(s, trSheer(s)) - 0.12), y ?? trSheer(s) + 2.6, z];
  };
  line([0, MTOP - 0.8, MZ], [0, trSheer(0.92) + 0.3, 37], 0.09); // forestay
  line([0, MTOP - 0.8, MZ], [0, 12.2, -43], 0.09); // backstay
  for (const side of [-1, 1]) {
    line([0, MTOP - 3.2, MZ], hullAt(MZ - 7, side), 0.07);
    line([0, MTOP - 3.2, MZ], hullAt(MZ + 7, side), 0.07);
    // A sheet from each foot of the sail, aft to the quarter, and a brace from each yardarm.
    const foot = sailPoint(side > 0 ? 0.995 : 0.005, 0.995);
    line(foot, hullAt(-25, side), 0.06);
    const arm = [side * (YW - 0.5), YY - 0.75, YZ];
    line(arm, hullAt(-36, side), 0.05);
  }
  line([0, MTOP - 0.4, MZ], [0, YY + 0.2, YZ], 0.08);

  // --- the display cradle: keel blocks and shores --------------------------------------------------
  const SOLEX = 9.2;
  for (const sx of [-1, 1]) block(woodList, STAND, 0.7, 0.42, 92, [sx * SOLEX, 0.21, -1]);
  block(woodList, 0x4f3620, 1.5, 0.3, 94, [0, 0.15, -1]);
  for (const z of [-40, -24, -8, 8, 24, 40]) {
    block(woodList, STAND, SOLEX * 2 + 1.4, 0.34, 1.1, [0, 0.27, z]);
    const s = trS(z);
    const keelH = trKeel(s);
    if (keelH < 0.8) block(woodList, 0x6a4a2c, 1.4, 0.9, 2, [0, 0.45, z]);
    for (const side of [-1, 1]) {
      const y = keelH + 2.4;
      const on = trP(s, y, side, -0.08);
      bar(woodList, 0x6a4a2c, [side * SOLEX, 0.4, z], on, 0.42, 0.42, { up: [0, 0, 1] });
      const y2 = keelH + 0.9;
      const on2 = trP(s, y2, side, -0.06);
      bar(woodList, 0x5f4228, [side * 2.6, 0.3, z], on2, 0.34, 0.34, { up: [0, 0, 1] });
    }
  }

  // --- the painted eyes --------------------------------------------------------------------------
  for (const side of [-1, 1]) {
    const sE = trS(47.4); const yE = 8.72;
    const nu = 16; const nv = 10;
    const pos = []; const uvE = []; const idx = [];
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        const u = i / nu; const v = j / nv;
        // The whole patch is a circle's worth of ring, disc and pupil, on the hull's own surface.
        const a = u * 2 - 1; const b = v * 2 - 1;
        const r = Math.max(Math.abs(a), Math.abs(b)) || 1e-5;
        const n = Math.hypot(a, b) || 1e-5;
        const k = r / n;
        const da = a * k; const db = b * k;
        // The patch itself is the almond, so its edge lands on the painted outline and no square of
        // not-quite-hull-coloured paint shows round the eye.
        const al = 0.012 + 0.46 * (1 - da * da);
        const s = sE + da * 0.02;
        const y = yE + db * 1.42 * al;
        const q = trP(s, y, side, 0.07);
        pos.push(q[0], q[1], q[2]);
        const e = atlas.eyeUV(0.5 + da * 0.34, 0.5 + db * 0.34 * al);
        uvE.push(e[0], e[1]);
      }
    }
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = i * (nv + 1) + j; const b = a + 1; const c = (i + 1) * (nv + 1) + j; const d = c + 1;
        if (side > 0) idx.push(a, d, c, a, b, d); else idx.push(a, c, d, a, d, b);
      }
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    eg.setAttribute('uv', new THREE.Float32BufferAttribute(uvE, 2));
    eg.setIndex(idx);
    eg.computeVertexNormals();
    cloth.push({ geometry: eg, color: 0xffffff });
  }

  // --- assemble -------------------------------------------------------------------------------------
  hull.push({ geometry: panel.geometry(), keepColor: true });
  const plankC = trPlankTile();
  const hullM = meshFrom(mergeParts(hull), {
    map: texOf(plankC, THREE.SRGBColorSpace), bumpMap: texOf(plankC, THREE.NoColorSpace), bumpScale: 0.8, roughness: 0.72, metalness: 0,
  });
  const fitG = mergeParts(fit);
  const fitM = meshFrom(fitG, { roughness: 0.74, metalness: 0 });
  const oarM = meshFrom(mergeParts(oars), { roughness: 0.78, metalness: 0 });
  const bronzeG = mergeParts(bronze);
  tintVertices(bronzeG, (x, y, z, out, i) => {
    const C = bronzeG.attributes.color;
    const n = smoothNoise3(x * 2.2, y * 2.2, z * 0.8);
    const patina = sstep(n, 0.58, 0.82) * 0.55;
    out[0] = mix(C.getX(i), 0.22, patina); out[1] = mix(C.getY(i), 0.42, patina); out[2] = mix(C.getZ(i), 0.32, patina);
  });
  sheen(bronzeG, { add: 0.13, tint: [1, 0.82, 0.5], gain: 0.35 });
  const bronzeM = meshFrom(bronzeG, { roughness: 0.34, metalness: 0.5 });
  const clothM = meshFrom(mergeParts(cloth), { map: atlas.tex, roughness: 0.86, metalness: 0 });
  const woodC = grainTile(480);
  const woodM = meshFrom(planarUV(mergeParts(woodList), 0.3), {
    map: texOf(woodC, THREE.SRGBColorSpace), bumpMap: texOf(woodC, THREE.NoColorSpace), bumpScale: 0.6, roughness: 0.84, metalness: 0,
  });
  return groupOf(hullM, fitM, oarM, bronzeM, clothM, woodM);
}

// ---------------------------------------------------------------------------
// The United States Capitol, from a table
// ---------------------------------------------------------------------------

// True feet, 1/20, east front facing +Z. The 751 x 350ft plan and the 288ft height, including the
// 19.5ft statue, are published figures. The heights of the levels between are this model's reading of
// the elevations, NOT published figures: they are the first thing to change if a better source turns up.
const CP = {
  S: 1 / 20, BASE: 0.3,
  BLOCKS: [
    { x: [-176, 176], z: [-95, 95] }, // the central block
    { x: [-90, 90], z: [-175, -95] }, // its west projection
    { x: [176, 220], z: [-60, 70], mirror: true }, // the connecting corridors
    { x: [220, 375], z: [-120, 120], mirror: true }, // Senate and House wings
  ],
  WALL: 80, PODIUM: 28, COL_TOP: 66, ENT_TOP: 74,
  // The dome, walking up its outside: [radius, height].
  DRUM: 75, DRUM_TOP: 112, PERI_FLOOR: 116, PERI_R: 67, PERI_WALL: 57, PERI_TOP: 152, ENT: 160, ATTIC_R: 54, ATTIC_TOP: 186, SHELL_R: 50, SHELL_Y: 191, SHELL_H: 56,
  THOLOS_FLOOR: 249.5, THOLOS_TOP: 260.5, STATUE: 268.5, TOP: 288,
  // Counted against the published figures as I recall them: 36 columns round the peristyle, 24 on the
  // East Central Portico. The wings' and the 12 of the tholos are a representative reading.
  N_PERI: 36, N_RIB: 36, N_THOLOS: 12, N_CENTRE: 24, N_WING: 16, N_WEST: 10, N_END: 10,
};
const cpY = (t) => CP.BASE + t * CP.S;
const cpF = (t) => t * CP.S;

// The zones of the one facade atlas, in canvas rows. u repeats, v does not.
const CPZ = {
  W: 256, H: 2048, wallTop: 0, wallBot: 1024, peri: [1024, 1300], attic: [1300, 1500], shell: [1500, 1950], rail: [1950, 1998], blank: 2020,
};
const cpWallV = (t) => 1 - (CPZ.wallBot - t * 12.8) / CPZ.H;
const cpZoneV = (zone, t) => 1 - (zone[0] + (zone[1] - zone[0]) * (1 - t)) / CPZ.H;
const CP_BLANK_V = 1 - CPZ.blank / CPZ.H;

function capitolAtlas() {
  const { W, H } = CPZ;
  const { canvas, ctx } = makeCanvas(W, H);
  const rng = seededRandom(1793);
  ctx.fillStyle = '#f2efe6';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 1400; i++) {
    const v = 226 + Math.round(rng() * 26);
    ctx.fillStyle = `rgba(${v},${v - 2},${v - 8},0.45)`;
    ctx.fillRect(rng() * W, rng() * H, 6 + rng() * 34, 3 + rng() * 14);
  }
  const T = (t) => CPZ.wallBot - t * 12.8;
  const GLASS = '#29323b';
  const SH = 'rgba(70,64,54,0.55)';
  // Rusticated basement.
  for (let t = 0; t < 28; t += 2.6) {
    ctx.fillStyle = SH;
    ctx.fillRect(0, T(t) - 1.5, W, 3);
    const off = Math.round(t / 2.6) % 2 ? 0 : 64;
    for (let k = 0; k < 2; k++) ctx.fillRect(off + k * 128, T(t + 2.6), 2, 2.6 * 12.8);
  }
  const arch = (cx, y0, y1, w, fill) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, y1);
    ctx.lineTo(cx - w / 2, y0 + w / 2);
    ctx.arc(cx, y0 + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(cx + w / 2, y1);
    ctx.closePath();
    ctx.fill();
  };
  arch(128, T(21), T(6), 96, '#ded8ca');
  arch(128, T(20), T(6), 72, GLASS);
  ctx.fillStyle = '#cfc9ba';
  ctx.fillRect(127, T(19), 2.4, T(6) - T(19));
  // Belt course.
  ctx.fillStyle = '#fbf8f0';
  ctx.fillRect(0, T(30.4), W, 30);
  ctx.fillStyle = SH;
  ctx.fillRect(0, T(28) - 2, W, 3);
  ctx.fillRect(0, T(30.4), W, 2.4);
  // The main storey: pilasters on the bay edges, a tall pedimented window, a small one over it.
  for (const [x0, x1] of [[0, 22], [W - 22, W]]) {
    ctx.fillStyle = '#fbf8f0';
    ctx.fillRect(x0, T(63), x1 - x0, T(30.4) - T(63));
    ctx.fillStyle = 'rgba(70,64,54,0.35)';
    for (let k = 1; k < 3; k++) ctx.fillRect(x0 + (x1 - x0) * (k / 3), T(61), 1.4, T(32) - T(61));
  }
  ctx.fillStyle = 'rgba(70,64,54,0.5)';
  ctx.fillRect(22, T(63), 2.4, T(30.4) - T(63));
  ctx.fillRect(W - 24.4, T(63), 2.4, T(30.4) - T(63));
  const sash = (x, y0, y1, w, rows) => {
    ctx.fillStyle = '#d8d2c3';
    ctx.fillRect(x - 7, y0 - 7, w + 14, y1 - y0 + 12);
    ctx.fillStyle = SH;
    ctx.fillRect(x - 8, y1 + 4, w + 16, 3);
    ctx.fillStyle = GLASS;
    ctx.fillRect(x, y0, w, y1 - y0);
    ctx.fillStyle = '#cfc9ba';
    ctx.fillRect(x + w / 2 - 1.2, y0, 2.4, y1 - y0);
    for (let k = 1; k < rows; k++) ctx.fillRect(x, y0 + ((y1 - y0) * k) / rows, w, 2);
  };
  sash(80, T(50), T(35), 96, 4);
  ctx.fillStyle = '#fbf8f0';
  ctx.beginPath();
  ctx.moveTo(64, T(50.8)); ctx.lineTo(128, T(56)); ctx.lineTo(192, T(50.8)); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = SH;
  ctx.lineWidth = 2;
  ctx.stroke();
  sash(92, T(62), T(57.4), 72, 1);
  // Entablature: architrave, frieze, dentils, then the cornice's own shadow.
  ctx.fillStyle = '#fbf8f0';
  ctx.fillRect(0, T(72), W, T(64) - T(72));
  ctx.fillStyle = SH;
  ctx.fillRect(0, T(64) - 2, W, 2);
  ctx.fillRect(0, T(66), W, 1.6);
  ctx.fillStyle = 'rgba(70,64,54,0.75)';
  ctx.fillRect(0, T(70) - 2, W, 4);
  ctx.fillStyle = 'rgba(70,64,54,0.5)';
  for (let k = 0; k < 16; k++) ctx.fillRect(k * 16, T(70) - 13, 5, 10);
  // Attic.
  ctx.fillStyle = SH;
  for (let k = 0; k < 2; k++) ctx.fillRect(0, T(74 + k * 3), W, 1.6);
  // --- the peristyle's wall, one tile to a column bay ---
  const [p0, p1] = CPZ.peri;
  arch(W / 2, p0 + 36, p1 - 26, 92, '#ded8ca');
  arch(W / 2, p0 + 46, p1 - 26, 70, GLASS);
  ctx.fillStyle = '#cfc9ba';
  ctx.fillRect(W / 2 - 1.2, p0 + 56, 2.4, p1 - p0 - 82);
  for (let k = 1; k < 5; k++) ctx.fillRect(W / 2 - 35, p0 + 46 + k * 40, 70, 2);
  ctx.fillStyle = SH;
  ctx.fillRect(0, p1 - 16, W, 2);
  // --- the attic drum: a pilaster at each edge, a small window ---
  const [a0, a1] = CPZ.attic;
  ctx.fillStyle = '#fbf8f0';
  ctx.fillRect(0, a0, 34, a1 - a0);
  ctx.fillRect(W - 34, a0, 34, a1 - a0);
  ctx.fillStyle = SH;
  ctx.fillRect(34, a0, 2, a1 - a0);
  ctx.fillRect(W - 36, a0, 2, a1 - a0);
  ctx.fillRect(0, a0 + 14, W, 2);
  ctx.fillRect(0, a1 - 14, W, 2);
  sash(W / 2 - 34, a0 + 50, a1 - 50, 68, 2);
  // --- the shell: raised bands and two tiers of lucarnes between the ribs ---
  const [s0, s1] = CPZ.shell;
  const SHT = s1 - s0;
  const band = (f) => {
    const y = s0 + SHT * f;
    ctx.fillStyle = 'rgba(70,64,54,0.5)';
    ctx.fillRect(0, y + 8, W, 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, y, W, 8);
  };
  band(0.28);
  band(0.56);
  band(0.82);
  arch(W / 2, s0 + SHT * 0.615, s0 + SHT * 0.78, 58, GLASS);
  arch(W / 2, s0 + SHT * 0.33, s0 + SHT * 0.52, 46, GLASS);
  // --- the balusters, 6 to a tile ---
  const [r0, r1] = CPZ.rail;
  ctx.fillStyle = '#39362f';
  ctx.fillRect(0, r0, W, r1 - r0);
  ctx.fillStyle = '#f7f4eb';
  ctx.fillRect(0, r0, W, 11);
  ctx.fillRect(0, r1 - 8, W, 8);
  for (let k = 0; k < 6; k++) {
    const x = (k + 0.5) * (W / 6);
    ctx.fillRect(x - 11, r0 + 9, 22, r1 - r0 - 15);
  }
  const t = texOf(canvas, THREE.SRGBColorSpace);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function capitolLawnTile() {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const rng = seededRandom(1800);
  // Mown stripes, because a lawn this size is mown.
  for (let i = 0; i < 4; i++) {
    const v = i % 2 ? 234 : 252;
    ctx.fillStyle = `rgb(${v},${v},${v - 4})`;
    ctx.fillRect((i / 4) * S, 0, S / 4, S);
  }
  for (let i = 0; i < 2600; i++) {
    const v = 204 + Math.round(rng() * 50);
    ctx.fillStyle = `rgba(${v},${v},${v - 6},0.55)`;
    ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 3);
  }
  return canvas;
}

// A ring of the dome, walking up its outside from (r0, y0) to (r1, y1), its normal taken from the
// slope. `tiles` are repeats of the atlas's u round the circle.
function cpRing(list, color, r0, y0, r1, y1, { sides = 72, tiles = 36, v0 = CP_BLANK_V, v1 = CP_BLANK_V, cx = 0, cz = 0, n0 = null, n1 = null } = {}) {
  const pos = []; const nor = []; const uv = []; const idx = [];
  const dy = y1 - y0; const dr = r1 - r0;
  const l = Math.hypot(dy, dr) || 1;
  const N0 = n0 ?? [dy / l, -dr / l];
  const N1 = n1 ?? [dy / l, -dr / l];
  for (let j = 0; j <= sides; j++) {
    const a = (j / sides) * Math.PI * 2;
    const c = Math.cos(a); const sn = Math.sin(a);
    pos.push(cx + c * r0, y0, cz + sn * r0, cx + c * r1, y1, cz + sn * r1);
    nor.push(c * N0[0], N0[1], sn * N0[0], c * N1[0], N1[1], sn * N1[0]);
    const u = (j / sides) * tiles;
    uv.push(u, v0, u, v1);
  }
  for (let j = 0; j < sides; j++) {
    const A = j * 2; const D = A + 1; const B = A + 2; const C = A + 3;
    idx.push(A, D, C, A, C, B);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  list.push({ geometry: g, color });
}

function usCapitol() {
  const stone = [];
  const ground = [];
  const walls = new Soup();
  const rng = seededRandom(1793);
  const LIME = lin(0xe6e2d6); const WHITE = lin(0xe4e3db); const ROOF = lin(0x8d9196); const TREAD = lin(0xd2cdbf); const TERR = lin(0xc4bfb0);
  const BLANK = [[0.5, CP_BLANK_V], [0.51, CP_BLANK_V], [0.51, CP_BLANK_V], [0.5, CP_BLANK_V]];
  // A block's four walls in model feet, each face's v taken from the true heights t0..t1, and its top.
  const faces = (x0, x1, t0, t1, z0, z1, { top = ROOF, col = LIME, bay = 1, noBack = false, vmap = cpWallV } = {}) => {
    const y0 = cpY(t0); const y1 = cpY(t1);
    const v0 = vmap(t0); const v1 = vmap(t1);
    const quadF = (a, b, c, d, len) => {
      const n = Math.max(1, Math.round(len / bay));
      walls.quad(a, b, c, d, [[0, v0], [n, v0], [n, v1], [0, v1]], col);
    };
    quadF([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], x1 - x0);
    if (!noBack) quadF([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], x1 - x0);
    quadF([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], z1 - z0);
    quadF([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], z1 - z0);
    if (top) walls.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], BLANK, top);
  };
  // A balustrade along a run: a thin wall, painted with balusters on both faces.
  const railV = (t) => cpZoneV(CPZ.rail, t);
  const rail = (x0, z0, x1, z1, tBase, h = 6, thick = 0.09) => {
    const y0 = cpY(tBase); const y1 = cpY(tBase + h);
    const dx = x1 - x0; const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (dz / len) * thick * 0.5; const nz = (-dx / len) * thick * 0.5;
    const n = Math.max(1, Math.round(len / 0.7));
    const V0 = railV(0); const V1 = railV(1);
    const face = (ax, az, bx, bz) => walls.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [[0, V0], [n, V0], [n, V1], [0, V1]], LIME);
    face(x0 + nx, z0 + nz, x1 + nx, z1 + nz);
    face(x1 - nx, z1 - nz, x0 - nx, z0 - nz);
    walls.quad([x0 + nx, y1, z0 + nz], [x0 - nx, y1, z0 - nz], [x1 - nx, y1, z1 - nz], [x1 + nx, y1, z1 + nz], BLANK, LIME);
    walls.quad([x0 + nx, y0, z0 + nz], [x1 + nx, y0, z1 + nz], [x1 - nx, y0, z1 - nz], [x0 - nx, y0, z0 - nz], BLANK, LIME);
  };
  const railBox = (x0, x1, z0, z1, tBase) => {
    rail(x0, z1, x1, z1, tBase);
    rail(x1, z0, x0, z0, tBase);
    rail(x1, z1, x1, z0, tBase);
    rail(x0, z0, x0, z1, tBase);
  };

  // --- the masses, straight from the table ---------------------------------------------------------
  for (const b of CP.BLOCKS) {
    for (const sx of b.mirror ? [-1, 1] : [1]) {
      const xa = cpF(sx > 0 ? b.x[0] : -b.x[1]); const xb = cpF(sx > 0 ? b.x[1] : -b.x[0]);
      const za = cpF(b.z[0]); const zb = cpF(b.z[1]);
      faces(xa, xb, 0, CP.WALL, za, zb);
      railBox(xa, xb, za, zb, CP.WALL);
    }
  }
  // Low lead roofs behind the balustrades, each with its long skylight.
  const roofBlock = (x0, x1, z0, z1, h) => {
    const y0 = cpY(CP.WALL); const y1 = cpY(CP.WALL + h);
    const inset = 0.5;
    walls.quad([x0 + inset, y0, z1 - inset], [x1 - inset, y0, z1 - inset], [x1 - inset - 1.2, y1, z1 - inset - 1.2], [x0 + inset + 1.2, y1, z1 - inset - 1.2], BLANK, ROOF);
    walls.quad([x1 - inset, y0, z0 + inset], [x0 + inset, y0, z0 + inset], [x0 + inset + 1.2, y1, z0 + inset + 1.2], [x1 - inset - 1.2, y1, z0 + inset + 1.2], BLANK, ROOF);
    walls.quad([x1 - inset, y0, z1 - inset], [x1 - inset, y0, z0 + inset], [x1 - inset - 1.2, y1, z0 + inset + 1.2], [x1 - inset - 1.2, y1, z1 - inset - 1.2], BLANK, ROOF);
    walls.quad([x0 + inset, y0, z0 + inset], [x0 + inset, y0, z1 - inset], [x0 + inset + 1.2, y1, z1 - inset - 1.2], [x0 + inset + 1.2, y1, z0 + inset + 1.2], BLANK, ROOF);
    walls.quad([x0 + inset + 1.2, y1, z1 - inset - 1.2], [x1 - inset - 1.2, y1, z1 - inset - 1.2], [x1 - inset - 1.2, y1, z0 + inset + 1.2], [x0 + inset + 1.2, y1, z0 + inset + 1.2], BLANK, ROOF);
  };
  roofBlock(cpF(220), cpF(375), cpF(-120), cpF(120), 9);
  roofBlock(cpF(-375), cpF(-220), cpF(-120), cpF(120), 9);
  roofBlock(cpF(-176), cpF(176), cpF(-95), cpF(95), 5);

  // --- porticoes ------------------------------------------------------------------------------------
  const COL_R = cpF(1.75);
  const colH = cpF(CP.COL_TOP - CP.PODIUM);
  const colG = (() => {
    const h = colH; const r = COL_R;
    const g = spin([[0, 0], [r * 1.5, 0, 'h'], [r * 1.5, h * 0.025, 'h'], [r * 1.18, h * 0.04], [r, h * 0.06], [r * 0.97, h * 0.42], [r * 0.86, h * 0.86], [r * 1.02, h * 0.885, 'h'], [r * 1.42, h * 0.96], [r * 1.6, h * 0.97, 'h'], [r * 1.6, h, 'h'], [0, h]], { segments: 10 });
    return g;
  })();
  const blankUV = (g) => {
    const uv = new Float32Array(g.attributes.position.count * 2);
    for (let i = 0; i < uv.length; i += 2) { uv[i] = 0.5; uv[i + 1] = CP_BLANK_V; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  };
  blankUV(colG);
  let columns = 0;
  const column = (x, z) => {
    stone.push({ geometry: colG, color: 0xeeeadf, position: [x, cpY(CP.PODIUM), z] });
    columns += 1;
  };
  const entablature = (x0, x1, z0, z1, { railOn = true, sides = [1, 1, 1, 1] } = {}) => {
    const entV = (t) => cpWallV(CP.COL_TOP - 2 + (t - CP.COL_TOP));
    faces(x0, x1, CP.COL_TOP, CP.ENT_TOP, z0, z1, { top: LIME, noBack: false, vmap: entV });
    if (railOn) {
      if (sides[0]) rail(x0, z1, x1, z1, CP.ENT_TOP);
      if (sides[1]) rail(x1, z1, x1, z0, CP.ENT_TOP);
      if (sides[3]) rail(x0, z0, x0, z1, CP.ENT_TOP);
    }
  };
  const podium = (x0, x1, z0, z1) => faces(x0, x1, 0, CP.PODIUM, z0, z1, { top: TREAD, noBack: true });
  // A pediment: tympanum set back, raking cornices projecting from it, a roof falling back to the wall.
  const pediment = (x0, x1, zFront, zBack, rise) => {
    const cx = (x0 + x1) / 2;
    const y0 = cpY(CP.ENT_TOP); const yA = cpY(CP.ENT_TOP + rise);
    const inset = 0.05;
    walls.quad([x0 + 0.2, y0, zFront - inset], [x1 - 0.2, y0, zFront - inset], [cx, yA - 0.1, zFront - inset], [cx, yA - 0.1, zFront - inset], BLANK, lin(0xc9c4b6));
    const rake = (ax, ay, bx, by) => {
      const thick = 0.14;
      const d = 0.07;
      const A0 = [ax, ay, zFront + d]; const B0 = [bx, by, zFront + d];
      const A1 = [ax, ay + thick, zFront + d]; const B1 = [bx, by + thick, zFront + d];
      const A2 = [ax, ay + thick, zBack]; const B2 = [bx, by + thick, zBack];
      const A3 = [ax, ay, zFront - 0.2]; const B3 = [bx, by, zFront - 0.2];
      const fwd = bx > ax;
      const Q = (a, b, c, e, col) => (fwd ? walls.quad(a, b, c, e, BLANK, col) : walls.quad(e, c, b, a, BLANK, col));
      Q(A0, B0, B1, A1, WHITE);
      Q(A1, B1, B2, A2, ROOF);
      Q(A3, B3, B0, A0, lin(0xb9b4a6));
    };
    rake(x0 - 0.08, y0, cx, yA);
    rake(cx, yA, x1 + 0.08, y0);
    walls.quad([x0, y0, zFront], [x1, y0, zFront], [x1, y0 + 0.14, zFront], [x0, y0 + 0.14, zFront], BLANK, WHITE);
    walls.quad([x1, y0, zBack], [x0, y0, zBack], [cx, yA, zBack], [cx, yA, zBack], BLANK, lin(0xc9c4b6));
  };
  // Steps as treads and risers, with a cheek each side stepping down with them.
  const stairs = (cx, halfW, zTop, zBot, t0, t1, n, cheek = 0.42) => {
    const x0 = cx - halfW; const x1 = cx + halfW;
    for (let i = 0; i < n; i++) {
      const y0 = cpY(mix(t1, t0, i / n)); const y1 = cpY(mix(t1, t0, (i + 1) / n));
      const za = mix(zTop, zBot, i / n); const zb = mix(zTop, zBot, (i + 1) / n);
      const dir = Math.sign(zBot - zTop);
      // The riser falling from y0 to y1 at za... the tread at y1 runs from za to zb.
      if (dir > 0) {
        walls.quad([x0, y1, za], [x1, y1, za], [x1, y0, za], [x0, y0, za], BLANK, lin(0xb5b0a2));
        walls.quad([x0, y1, zb], [x1, y1, zb], [x1, y1, za], [x0, y1, za], BLANK, TREAD);
      } else {
        walls.quad([x1, y1, za], [x0, y1, za], [x0, y0, za], [x1, y0, za], BLANK, lin(0xb5b0a2));
        walls.quad([x0, y1, za], [x1, y1, za], [x1, y1, zb], [x0, y1, zb], BLANK, TREAD);
      }
    }
    // Cheek walls.
    const yT = cpY(t1) + 0.06; const yB = cpY(t0);
    for (const sx of [-1, 1]) {
      const xa = sx < 0 ? x0 - cheek : x1; const xb = sx < 0 ? x0 : x1 + cheek;
      const out = (a, b, c, e) => (Math.sign(zBot - zTop) > 0 ? walls.quad(a, b, c, e, BLANK, TERR) : walls.quad(e, c, b, a, BLANK, TERR));
      out([xb, yB, zBot], [xb, yB, zTop], [xb, yT, zTop], [xb, yB + 0.1, zBot]);
      out([xa, yB, zTop], [xa, yB, zBot], [xa, yB + 0.1, zBot], [xa, yT, zTop]);
      out([xa, yB + 0.1, zBot], [xb, yB + 0.1, zBot], [xb, yT, zTop], [xa, yT, zTop]);
      out([xa, yB, zBot], [xb, yB, zBot], [xb, yB + 0.1, zBot], [xa, yB + 0.1, zBot]);
    }
  };

  // East Central Portico: two rows of eight under the pediment and four more each side.
  {
    const SP = cpF(16);
    const zFace = cpF(95);
    const zF = cpF(136); const zFl = cpF(122);
    podium(cpF(-128), cpF(128), zFace, zFl + 0.2);
    podium(cpF(-72), cpF(72), zFl + 0.2, zF + 0.2);
    for (let i = 0; i < 8; i++) {
      const x = (i - 3.5) * SP;
      column(x, zF - 0.14);
      column(x, zFl - 0.14);
    }
    for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) column(sx * (4.5 + k) * SP, zFl - 0.14);
    if (columns !== CP.N_CENTRE) throw new Error(`central portico has ${columns} columns`);
    entablature(cpF(-128), cpF(-72), zFace, zFl + 0.05, { sides: [1, 0, 0, 1] });
    entablature(cpF(72), cpF(128), zFace, zFl + 0.05, { sides: [1, 1, 0, 0] });
    entablature(cpF(-72), cpF(72), zFace, zF + 0.05, { railOn: false });
    pediment(cpF(-72), cpF(72), zF + 0.05, zFace, 24);
    stairs(0, cpF(66), zF + 0.2, cpF(214), 0, CP.PODIUM, 20);
  }
  // Each wing's east portico: eight under a pediment, four each side.
  for (const sx of [-1, 1]) {
    const cx = sx * cpF(297.5);
    const SP = cpF(9.7);
    const zFace = cpF(120);
    const zF = cpF(153); const zFl = cpF(141);
    podium(cx - cpF(77), cx + cpF(77), zFace, zFl + 0.2);
    podium(cx - cpF(41), cx + cpF(41), zFl + 0.2, zF + 0.2);
    for (let i = 0; i < 8; i++) column(cx + (i - 3.5) * SP, zF - 0.14);
    for (const ex of [-1, 1]) for (let k = 0; k < 4; k++) column(cx + ex * (4.5 + k) * SP, zFl - 0.14);
    entablature(cx - cpF(77), cx - cpF(41), zFace, zFl + 0.05, { sides: [1, 0, 0, 1] });
    entablature(cx + cpF(41), cx + cpF(77), zFace, zFl + 0.05, { sides: [1, 1, 0, 0] });
    entablature(cx - cpF(41), cx + cpF(41), zFace, zF + 0.05, { railOn: false });
    pediment(cx - cpF(41), cx + cpF(41), zF + 0.05, zFace, 15);
    stairs(cx, cpF(34), zF + 0.2, cpF(206), 0, CP.PODIUM, 16);
    // The wing's far end: ten columns on a shallow podium, no pediment.
    const xe = sx * cpF(375);
    const SPE = cpF(14);
    const xa = Math.min(xe, xe + sx * cpF(16)); const xb = Math.max(xe, xe + sx * cpF(16));
    faces(xa, xb, 0, CP.PODIUM, cpF(-74), cpF(74), { top: TREAD });
    for (let i = 0; i < CP.N_END; i++) column(xe + sx * cpF(12), (i - 4.5) * SPE);
    const entV = (t) => cpWallV(CP.COL_TOP - 2 + (t - CP.COL_TOP));
    faces(xa, xb, CP.COL_TOP, CP.ENT_TOP, cpF(-74), cpF(74), { top: LIME, vmap: entV });
    rail(xe + sx * cpF(16), cpF(-74), xe + sx * cpF(16), cpF(74), CP.ENT_TOP);
  }
  // The west front's colonnade.
  {
    const zW = cpF(-175);
    const SP = cpF(16);
    faces(cpF(-90), cpF(90), 0, CP.PODIUM, zW - cpF(16), zW, { top: TREAD });
    for (let i = 0; i < CP.N_WEST; i++) column((i - (CP.N_WEST - 1) / 2) * SP, zW - cpF(12));
    const entV = (t) => cpWallV(CP.COL_TOP - 2 + (t - CP.COL_TOP));
    faces(cpF(-90), cpF(90), CP.COL_TOP, CP.ENT_TOP, zW - cpF(16), zW, { top: LIME, vmap: entV });
    rail(cpF(-90), zW - cpF(16), cpF(90), zW - cpF(16), CP.ENT_TOP);
  }
  const buildingColumns = columns;
  const expectBuilding = CP.N_CENTRE + 2 * CP.N_WING + 2 * CP.N_END + CP.N_WEST;
  if (buildingColumns !== expectBuilding) throw new Error(`capitol has ${buildingColumns} building columns, expected ${expectBuilding}`);

  // --- the west terrace, its two flights, and the plaza ---------------------------------------------
  const TERRACE = 21;
  const tx = cpF(310); const tz0 = cpF(-232); const tz1 = cpF(-175);
  faces(-tx, tx, 0, TERRACE, tz0, tz1, { top: lin(0xbcb7a8), col: TERR });
  rail(-tx, tz0, -cpF(92), tz0, TERRACE);
  rail(cpF(92), tz0, tx, tz0, TERRACE);
  rail(tx, tz0, tx, tz1, TERRACE);
  rail(-tx, tz1, -tx, tz0, TERRACE);
  stairs(0, cpF(78), tz0, cpF(-284), 0, TERRACE, 15);

  // --- the dome --------------------------------------------------------------------------------------
  const DY = cpY;
  const R = cpF;
  const ring = (r0, t0, r1, t1, opts) => cpRing(stone, 0xe6e5dd, R(r0), DY(t0), R(r1), DY(t1), opts);
  const zone = (z, a, b) => ({ v0: cpZoneV(z, a), v1: cpZoneV(z, b) });
  // The lower drum on the roof, then the gallery floor.
  ring(CP.DRUM + 6, CP.WALL + 4, CP.DRUM + 6, CP.WALL + 8);
  ring(CP.DRUM + 6, CP.WALL + 8, CP.DRUM, CP.WALL + 9);
  ring(CP.DRUM, CP.WALL + 9, CP.DRUM, CP.DRUM_TOP);
  ring(CP.DRUM, CP.DRUM_TOP, CP.DRUM + 3, CP.DRUM_TOP + 2);
  ring(CP.DRUM + 3, CP.DRUM_TOP + 2, CP.DRUM + 3, CP.PERI_FLOOR);
  ring(CP.DRUM + 3, CP.PERI_FLOOR, CP.PERI_WALL, CP.PERI_FLOOR);
  // The drum's buttress brackets.
  for (let j = 0; j < CP.N_PERI; j++) {
    const a = (j / CP.N_PERI) * Math.PI * 2;
    const bracket = new THREE.BoxGeometry(R(4), R(CP.DRUM_TOP - CP.WALL - 9), R(4));
    const m = new THREE.Matrix4().makeRotationY(-a).setPosition(Math.cos(a) * R(CP.DRUM + 1.4), DY((CP.DRUM_TOP + CP.WALL + 9) / 2), Math.sin(a) * R(CP.DRUM + 1.4));
    stone.push({ geometry: blankUV(bracket.applyMatrix4(m)), color: 0xeeede6 });
  }
  // The peristyle: the wall with its bays of windows, and the ring of columns in front.
  ring(CP.PERI_WALL, CP.PERI_FLOOR, CP.PERI_WALL, CP.PERI_TOP, zone(CPZ.peri, 0, 1));
  const periH = R(CP.PERI_TOP - CP.PERI_FLOOR);
  const pr = R(2);
  const periG = blankUV(spin([[0, 0], [pr * 1.45, 0, 'h'], [pr * 1.45, periH * 0.03, 'h'], [pr * 1.1, periH * 0.05], [pr, periH * 0.08], [pr * 0.88, periH * 0.85], [pr * 1.02, periH * 0.88, 'h'], [pr * 1.45, periH * 0.965], [pr * 1.6, periH * 0.975, 'h'], [pr * 1.6, periH, 'h'], [0, periH]], { segments: 10 }));
  for (let j = 0; j < CP.N_PERI; j++) {
    const a = (j / CP.N_PERI) * Math.PI * 2;
    stone.push({ geometry: periG, color: 0xeae9e1, position: [Math.cos(a) * R(CP.PERI_R), DY(CP.PERI_FLOOR), Math.sin(a) * R(CP.PERI_R)] });
  }
  // Its entablature, carried right out over the columns, with the gallery railing on top.
  const entR = CP.PERI_R + 3.5;
  ring(CP.PERI_WALL, CP.PERI_TOP, entR, CP.PERI_TOP);
  ring(entR, CP.PERI_TOP, entR, CP.ENT - 2, { v0: cpWallV(64), v1: cpWallV(70) , tiles: 72 });
  ring(entR, CP.ENT - 2, entR + 1.2, CP.ENT);
  ring(entR + 1.2, CP.ENT, CP.ATTIC_R, CP.ENT);
  ring(entR - 0.4, CP.ENT, entR - 0.4, CP.ENT + 6, { v0: cpZoneV(CPZ.rail, 0), v1: cpZoneV(CPZ.rail, 1), tiles: 72, sides: 144 });
  ring(entR - 0.4, CP.ENT + 6, entR - 1.2, CP.ENT + 6);
  // The attic drum and its cornice.
  ring(CP.ATTIC_R, CP.ENT, CP.ATTIC_R, CP.ATTIC_TOP, zone(CPZ.attic, 0, 1));
  ring(CP.ATTIC_R, CP.ATTIC_TOP, CP.ATTIC_R + 3, CP.ATTIC_TOP + 2);
  ring(CP.ATTIC_R + 3, CP.ATTIC_TOP + 2, CP.ATTIC_R + 3, CP.SHELL_Y);
  ring(CP.ATTIC_R + 3, CP.SHELL_Y, CP.SHELL_R, CP.SHELL_Y);
  // The shell, as tall as it is wide, painted by bay and ribbed in real geometry.
  const shellAt = (th) => {
    const c = Math.cos(th); const sn = Math.sin(th);
    return { r: CP.SHELL_R * c ** 0.9, t: CP.SHELL_Y + CP.SHELL_H * sn };
  };
  const TH_END = (76 * Math.PI) / 180;
  const ROWS = 22;
  for (let i = 0; i < ROWS; i++) {
    const a = (i / ROWS) * TH_END; const b = ((i + 1) / ROWS) * TH_END;
    const A = shellAt(a); const B = shellAt(b);
    const nAt = (th) => {
      const d = 0.002;
      const p = shellAt(th + d); const q = shellAt(th - d);
      const dt = p.t - q.t; const dr = p.r - q.r;
      const l = Math.hypot(dt, dr);
      return [dt / l, -dr / l];
    };
    const V = (th) => cpZoneV(CPZ.shell, th / TH_END);
    ring(A.r, A.t, B.r, B.t, { v0: V(a), v1: V(b), n0: nAt(a), n1: nAt(b) });
  }
  for (let j = 0; j < CP.N_RIB; j++) {
    const ang = (j / CP.N_RIB) * Math.PI * 2;
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const th = (i / 14) * TH_END;
      const q = shellAt(th);
      const rr = R(q.r) + 0.012;
      pts.push([Math.cos(ang) * rr, DY(q.t), Math.sin(ang) * rr]);
    }
    stone.push({ geometry: blankUV(tube(pts, [0.058, 0.05, 0.04, 0.03, 0.02], { sides: 5, steps: 14, round: 1 })), color: 0xf0efe8 });
  }
  // The tholos on top of it all.
  const capB = shellAt(TH_END);
  ring(capB.r, capB.t, capB.r + 3.5, capB.t + 1.5);
  ring(capB.r + 3.5, capB.t + 1.5, capB.r + 3.5, CP.THOLOS_FLOOR);
  ring(capB.r + 3.5, CP.THOLOS_FLOOR, 7.4, CP.THOLOS_FLOOR);
  ring(7.4, CP.THOLOS_FLOOR, 7.4, CP.THOLOS_TOP);
  const thR = R(0.9); const thH = R(CP.THOLOS_TOP - CP.THOLOS_FLOOR);
  const thG = blankUV(spin([[0, 0], [thR * 1.4, 0, 'h'], [thR * 1.4, thH * 0.04, 'h'], [thR, thH * 0.08], [thR * 0.9, thH * 0.86], [thR * 1.5, thH * 0.97, 'h'], [thR * 1.5, thH, 'h'], [0, thH]], { segments: 8 }));
  for (let j = 0; j < CP.N_THOLOS; j++) {
    const a = ((j + 0.5) / CP.N_THOLOS) * Math.PI * 2;
    stone.push({ geometry: thG, color: 0xeae9e1, position: [Math.cos(a) * R(11), DY(CP.THOLOS_FLOOR), Math.sin(a) * R(11)] });
  }
  ring(7.4, CP.THOLOS_TOP, 13, CP.THOLOS_TOP);
  ring(13, CP.THOLOS_TOP, 13, CP.THOLOS_TOP + 1.3);
  ring(13, CP.THOLOS_TOP + 1.3, 14, CP.THOLOS_TOP + 1.8);
  ring(14, CP.THOLOS_TOP + 1.8, 10.5, CP.THOLOS_TOP + 2);
  // A small cap dome, then a little globe the figure stands on.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * (Math.PI / 2); const b = ((i + 1) / 6) * (Math.PI / 2);
    ring(10.5 * Math.cos(a) ** 1.0, CP.THOLOS_TOP + 2 + 3.6 * Math.sin(a), Math.max(0.1, 10.5 * Math.cos(b)), CP.THOLOS_TOP + 2 + 3.6 * Math.sin(b), { sides: 28, tiles: 12 });
  }
  const globe = new THREE.SphereGeometry(R(1.6), 14, 8);
  stone.push({ geometry: blankUV(globe), color: 0x54462f, position: [0, DY(CP.STATUE - 1.3), 0] });
  // The Statue of Freedom as this scale can honestly show her: a small generic robed figure, helmeted,
  // with a staff-like sword in one hand and a shield in the other, and no attempt at a likeness.
  const FIG = 0x54462f;
  const FH = R(CP.TOP - CP.STATUE);
  const fY = DY(CP.STATUE);
  stone.push({
    geometry: blankUV(spin([[0, 0], [FH * 0.135, 0], [FH * 0.135, 0.02], [FH * 0.11, FH * 0.14], [FH * 0.1, FH * 0.3], [FH * 0.085, FH * 0.46], [FH * 0.07, FH * 0.54], [FH * 0.095, FH * 0.64], [FH * 0.075, FH * 0.71], [FH * 0.03, FH * 0.74], [0, FH * 0.75]], { segments: 14 })),
    color: FIG, position: [0, fY, 0],
  });
  // A round helmeted head, and a crest of feathers fanned across the top of it rather than one spike.
  const head = new THREE.SphereGeometry(FH * 0.06, 10, 7);
  stone.push({ geometry: blankUV(head), color: FIG, position: [0, fY + FH * 0.8, 0] });
  for (let k = -2; k <= 2; k++) {
    const a = k * 0.32;
    const tipX = Math.sin(a) * FH * 0.14; const tipY = FH * 0.8 + Math.cos(a) * FH * 0.2;
    stone.push({ geometry: blankUV(tube([[0, fY + FH * 0.82, 0], [tipX * 0.55, fY + FH * 0.92, 0], [tipX, fY + tipY, 0]], [0.016, 0.018, 0], { sides: 5, steps: 6, round: 0 })), color: FIG });
  }
  stone.push({ geometry: blankUV(tube([[FH * 0.06, fY + FH * 0.68, 0], [FH * 0.17, fY + FH * 0.55, 0.01], [FH * 0.19, fY + FH * 0.42, 0.02]], 0.016, { sides: 6, steps: 8 })), color: FIG });
  stone.push({ geometry: blankUV(tube([[-FH * 0.06, fY + FH * 0.68, 0], [-FH * 0.16, fY + FH * 0.56, 0.01], [-FH * 0.19, fY + FH * 0.42, 0.02]], 0.016, { sides: 6, steps: 8 })), color: FIG });
  // A sheathed sword hanging from one hand, a shield resting at the other side.
  stone.push({ geometry: blankUV(tube([[FH * 0.19, fY + FH * 0.42, 0.02], [FH * 0.21, fY + FH * 0.08, 0.02]], 0.011, { sides: 6, steps: 3 })), color: FIG });
  const shield = new THREE.CylinderGeometry(FH * 0.11, FH * 0.11, 0.012, 14);
  shield.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  stone.push({ geometry: blankUV(shield), color: FIG, position: [-FH * 0.22, fY + FH * 0.3, 0.02] });

  // --- the stepped base and the lawn -------------------------------------------------------------------
  const BW = 19.5; const BD = 14.5;
  const LAWN = 0x4c8a35; const LAWN2 = 0x467f31; const STEP = 0xb7b2a2; const PLAZA = 0xbfbaad; const PATH = 0xa8a395;
  const paved = [];
  block(paved, STEP, BW * 2, 0.1, BD * 2, [0, 0.05, 0]);
  block(ground, LAWN2, BW * 2 - 0.7, 0.1, BD * 2 - 0.7, [0, 0.15, 0]);
  block(ground, LAWN, BW * 2 - 1.4, 0.1, BD * 2 - 1.4, [0, 0.25, 0]);
  // The paved east plaza, and walks round the sides.
  block(paved, PLAZA, 32, 0.02, 4.0, [0, CP.BASE + 0.01, 11.6]);
  block(paved, PLAZA, 8, 0.02, 1.8, [0, CP.BASE + 0.01, 13.3]);
  block(paved, PATH, 1.2, 0.02, 21, [-17.2, CP.BASE + 0.01, 1]);
  block(paved, PATH, 1.2, 0.02, 21, [17.2, CP.BASE + 0.01, 1]);
  block(paved, PATH, 8.0, 0.02, 0.6, [0, CP.BASE + 0.01, -13.3]);
  // Trees down the sides and at the rear corners. They are far enough out to frame it and hide nothing.
  const tree = (x, z, h) => {
    const y = CP.BASE;
    rod(ground, 0x4c3a26, [x, y, z], [x, y + h * 0.45, z], 0.08, { sides: 7, r2: 0.05 });
    const n = 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng();
      const blob = new THREE.IcosahedronGeometry(h * (0.22 + rng() * 0.07), 2);
      ground.push({ geometry: smoothed(blob), color: rng() > 0.5 ? 0x3f7d33 : 0x4c8c3a, position: [x + Math.cos(a) * h * 0.17, y + h * (0.6 + rng() * 0.14), z + Math.sin(a) * h * 0.17] });
    }
    const mid = new THREE.IcosahedronGeometry(h * 0.27, 2);
    ground.push({ geometry: smoothed(mid), color: 0x46853a, position: [x, y + h * 0.7, z] });
  };
  for (const [x, z, h] of [[-18, 12, 2.2], [18, 12.2, 2.4], [-18.3, -3, 2.5], [18.3, -2.5, 2.2], [-18.1, -12.6, 2.5], [18, -12.8, 2.4], [-11, -13.5, 2.0], [11, -13.3, 2.1]]) tree(x, z, h);

  // --- assemble ------------------------------------------------------------------------------------
  stone.push({ geometry: walls.geometry(), keepColor: true });
  const stoneG = mergeParts(stone);
  const stoneM = meshFrom(stoneG, { map: capitolAtlas(), roughness: 0.74, metalness: 0 });
  const groundG = planarUV(mergeParts(ground), 0.16);
  const lawnC = capitolLawnTile();
  const groundM = meshFrom(groundG, { map: texOf(lawnC, THREE.SRGBColorSpace), bumpMap: texOf(lawnC, THREE.NoColorSpace), bumpScale: 0.25, roughness: 0.92, metalness: 0 });
  const pavedM = meshFrom(mergeParts(paved), { roughness: 0.9, metalness: 0 });
  return groupOf(stoneM, groundM, pavedM);
}

export const BUILDERS = {
  'telegraph-key': telegraphKey,
  'goddard-rocket': goddardRocket,
  shaduf,
  'greek-trireme': greekTrireme,
  'us-capitol': usCapitol,
};
