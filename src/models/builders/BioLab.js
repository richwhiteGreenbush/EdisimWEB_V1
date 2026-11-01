// Builders for the Model Database's biology bench: the stages of mitosis, a section through a leaf, a
// bacterium, Darwin's finches, and a mushroom on its mycelium. A science teacher will use these, so
// anything a card or a plate says that can be counted is counted from a table and asserted here: a
// builder throws rather than ship a cell with the wrong number of chromosomes.
//
// Authored in feet, origin at the base centre, front toward +Z.

import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, standard, canvasTexture, seededRandom } from '../../PropKit.js';
import { mergeParts, smoothNoise3, solidSurface } from '../../props/LoftKit.js';
import {
  Sculpt, polygonize, ellipsoidP, curveP, onSurface, tube, lathe, tintVertices, signedVolume, grainBump, lin, clamp01, mix, sstep, alongMatrix, mixInto,
} from '../ModelKit.js';

const TAU = Math.PI * 2;
const FONT = 'Arial, Helvetica, sans-serif';
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function must(ok, message) {
  if (!ok) throw new Error(`BioLab: ${message}`);
}

// ---------------------------------------------------------------------------------------------
// Painting
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

// A row of an atlas: a plain plate with type measured to fit. A digit written after ^ is set as a
// subscript, because CO2 and O2 are names a chemistry teacher will look at.
function plateCell(ctx, x, y, w, h, lines, { ground = '#efe6cc', ink = '#1d1a14', edge = '#7c6a44' } = {}) {
  ctx.fillStyle = ground;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(2, h * 0.035);
  ctx.strokeRect(x + h * 0.05, y + h * 0.05, w - h * 0.1, h - h * 0.1);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const rowH = (h * 0.8) / lines.length;
  lines.forEach((line, i) => {
    const cy = y + h * 0.1 + rowH * (i + 0.5);
    const size = (i === 0 ? 0.8 : 0.66) * rowH;
    if (line.includes('^')) {
      const [a, b] = line.split('^');
      const s = fitFont(ctx, `${a}${b}`, w * 0.86, size);
      const wa = ctx.measureText(a).width;
      ctx.font = `700 ${s * 0.68}px ${FONT}`;
      const wb = ctx.measureText(b).width;
      ctx.font = `700 ${s}px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(a, x + w / 2 - (wa + wb) / 2, cy);
      ctx.font = `700 ${s * 0.68}px ${FONT}`;
      ctx.fillText(b, x + w / 2 - (wa + wb) / 2 + wa, cy + s * 0.2);
      ctx.textAlign = 'center';
    } else {
      fitFont(ctx, line, w * 0.88, size);
      ctx.fillText(line, x + w / 2, cy);
    }
  });
}

// A column of plates on one canvas. Hands back the texture and each row's uv rectangle.
function plateAtlas(rows, { W = 512, rowH = 96, ...style } = {}) {
  const H = rowH * rows.length;
  const texture = canvasTexture(W, H, (ctx) => {
    rows.forEach((text, i) => plateCell(ctx, 0, i * rowH, W, rowH, text.split('|'), style));
  });
  const rects = rows.map((_, i) => [0, 1 - ((i + 1) * rowH) / H, 1, 1 - (i * rowH) / H]);
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
  return toCreasedNormals(g, (crease * Math.PI) / 180);
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
  const g = new THREE.BoxGeometry(w, h, depth);
  g.translate(0, 0, -depth / 2);
  const uv = g.attributes.uv;
  // A box lays each face's four corners down in turn, and +Z is the fifth face.
  for (let i = 0; i < uv.count; i++) {
    if (i >= 16 && i < 20) uv.setXY(i, mix(u0, u1, uv.getX(i)), mix(v0, v1, uv.getY(i)));
    else uv.setXY(i, u0 + 0.004, v0 + (v1 - v0) * 0.02);
  }
  return g;
}

// A round ball with no more triangles than it needs, centred at c, scaled by s (a number or a triple).
function ball(c, s, w = 8, h = 6) {
  const g = new THREE.SphereGeometry(1, w, h);
  const [sx, sy, sz] = Array.isArray(s) ? s : [s, s, s];
  g.scale(sx, sy, sz);
  g.translate(c[0], c[1], c[2]);
  return g;
}

// A solid arrow from a to b, its point at b: a round shaft and a cone. Lathed, so it is wound correctly.
function arrow3(a, b, r, headR = r * 2.5, headL = headR * 2) {
  const A = V(a[0], a[1], a[2]);
  const B = V(b[0], b[1], b[2]);
  const L = A.distanceTo(B);
  const g = lathe([[0, 0], [r, 0], [r, L - headL], [headR, L - headL], [0.002, L], [0, L]], 14);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), B.clone().sub(A).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A, q, V(1, 1, 1)));
  return g;
}

// A plate on its own stalk standing on a floor at y0, with a slim leader running from the top of the
// plate to the thing it names. The leader's far end is sunk into its target.
function flagPlate(plates, metal, rect, { x, y, z, w, h, y0, target = null, via = null, tilt = 0, stalk = true, color = 0x35322c }) {
  const g = printedPlate(w, h, 0.07, rect);
  g.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, 0)), V(1, 1, 1)));
  plates.push({ geometry: g, keepColor: true });
  if (stalk) metal.push({ geometry: rod([x, y0 - 0.02, z - 0.1], [x, y - h * 0.1, z - 0.1], 0.028, 6, 0), color });
  if (target && via) {
    metal.push({ geometry: rod([x, y + h * 0.42, z - 0.04], via, 0.0115, 5, 1), color });
    metal.push({ geometry: rod(via, target, 0.0115, 5, 1), color });
  } else if (target) metal.push({ geometry: rod([x, y + h * 0.42, z - 0.04], target, 0.0115, 5, 1), color });
}

// ---------------------------------------------------------------------------------------------
// Stages of mitosis
// ---------------------------------------------------------------------------------------------

// The one table. A starting cell holds four chromosomes in two pairs: a long pair and a short pair,
// one of each from each parent, which is what the two colours mean. Every stage below is worked out
// from this list by the real rule, and each builder asserts what it drew against it.
const CHROMOSOMES = [
  { id: 'long-red', pair: 'long', parent: 'red', arm: 0.34 },
  { id: 'short-blue', pair: 'short', parent: 'blue', arm: 0.22 },
  { id: 'short-red', pair: 'short', parent: 'red', arm: 0.22 },
  { id: 'long-blue', pair: 'long', parent: 'blue', arm: 0.34 },
];
const CHROMO_COLOR = { red: lin(0xd8261f), blue: lin(0x1f5fd8) };

// The rule, as data. A doubled chromosome has two sister chromatids; anaphase splits every one and
// sends one sister to each pole, so each side gets exactly one copy of each original chromosome.
export function mitosisTable() {
  const loose = (side) => CHROMOSOMES.map((c) => ({ ...c, form: 'thread', side }));
  const doubled = CHROMOSOMES.map((c) => ({ ...c, form: 'X', side: 0 }));
  const split = doubled.flatMap((c) => [-1, 1].map((side) => ({ ...c, form: 'V', side })));
  return [
    { key: 'interphase', name: 'INTERPHASE', chromosomes: loose(0) },
    { key: 'prophase', name: 'PROPHASE', chromosomes: doubled },
    { key: 'metaphase', name: 'METAPHASE', chromosomes: doubled },
    { key: 'anaphase', name: 'ANAPHASE', chromosomes: split },
    { key: 'telophase', name: 'TELOPHASE', chromosomes: split.map((c) => ({ ...c, form: 'loosening' })) },
    { key: 'cytokinesis', name: 'CYTOKINESIS', chromosomes: [...loose(-1), ...loose(1)] },
  ];
}

function checkMitosisTable(table) {
  must(table.length === 6, 'six stages');
  const count = (s, f) => table.find((t) => t.key === s).chromosomes.filter(f).length;
  must(count('interphase', (c) => c.form === 'thread') === 4, 'interphase has 4 loose threads');
  must(count('prophase', (c) => c.form === 'X') === 4, 'prophase has 4 X chromosomes');
  must(count('metaphase', (c) => c.form === 'X') === 4, 'metaphase has 4 X chromosomes');
  must(count('anaphase', (c) => c.form === 'V') === 8, 'anaphase has 8 single chromatids');
  for (const side of [-1, 1]) {
    must(count('anaphase', (c) => c.side === side) === 4, 'anaphase sends 4 to each pole');
    must(count('telophase', (c) => c.side === side) === 4, 'telophase has 2 groups of 4');
    must(count('cytokinesis', (c) => c.side === side) === 4, 'each daughter has 4');
    // The daughters must carry what the parent carried, colour for colour and size for size.
    const daughter = table.find((t) => t.key === 'cytokinesis').chromosomes.filter((c) => c.side === side).map((c) => c.id).sort().join();
    must(daughter === CHROMOSOMES.map((c) => c.id).sort().join(), 'a daughter matches its parent');
  }
}

const MITOSIS = {
  TRAY_TOP: 1.0,
  R: 1.62,
  LIP: 0.1, // the membrane's real thickness
  FACE: -0.2, // how far the cut face of the cytoplasm is set back inside the membrane's rim
};

// An X chromosome: two sister chromatids back to back, joined at the centromere. Its long axis is
// `axis` in the XY plane, and everything rests on the cut face at height z.
function xChromosome(chromo, cen, c, z, angle = 0, lean = 0) {
  const r = 0.06;
  const color = CHROMO_COLOR[c.parent];
  const ca = Math.cos(angle); const sa = Math.sin(angle);
  const P = (u, v, w = 0) => [cen[0] + u * ca - v * sa, cen[1] + u * sa + v * ca, z + w];
  for (const side of [-1, 1]) {
    const A = c.arm;
    const pts = [
      P(side * A * 0.56 + side * 0.03, A, 0.0),
      P(side * A * 0.27 + side * 0.03, A * 0.55, 0.012),
      P(side * 0.05, 0, 0.02),
      P(side * A * 0.27 + side * 0.03, -A * 0.55, 0.012),
      P(side * A * 0.56 + side * 0.03, -A, 0.0),
    ];
    const g = tube(pts, r, { sides: 10, steps: 14, round: 2 });
    tintVertices(g, (x, y, zz, out) => {
      const v = (x - cen[0]) * -sa + (y - cen[1]) * ca;
      // A chromosome's banding, computed along its own length.
      const k = 0.86 + 0.26 * (Math.sin(v * 15 + lean) > 0.1 ? 1 : 0);
      out[0] = color[0] * k; out[1] = color[1] * k; out[2] = color[2] * k;
    });
    chromo.push({ geometry: g, keepColor: true });
  }
  chromo.push({ geometry: ball([cen[0], cen[1], z + 0.03], 0.084, 10, 8), color: 0xf2d24a });
  return P(0, 0, 0.03);
}

// A single chromatid dragged by its centromere: a V whose point leads toward the pole.
function vChromatid(chromo, cen, c, side, z, spread = 1, slack = 0) {
  const color = CHROMO_COLOR[c.parent];
  const A = c.arm;
  const pts = [];
  for (const q of [1, 0.55, 0, -0.55, -1]) {
    const a = Math.abs(q);
    pts.push([cen[0] - side * a * A * 0.82, cen[1] + q * A * 0.68 * spread + (slack ? slack * Math.sin(q * 3) : 0), z]);
  }
  const g = tube(pts, 0.062, { sides: 10, steps: 14, round: 2 });
  tintVertices(g, (x, y, zz, out) => {
    const k = 0.86 + 0.26 * (Math.sin((y - cen[1]) * 15 + A * 40) > 0.1 ? 1 : 0);
    out[0] = color[0] * k; out[1] = color[1] * k; out[2] = color[2] * k;
  });
  chromo.push({ geometry: g, keepColor: true });
  chromo.push({ geometry: ball([cen[0], cen[1], z + 0.012], 0.074, 10, 8), color: 0xf2d24a });
}

// A loose chromosome: one long thread wandering inside its nucleus, the same colour it always was.
function chromatinThread(chromo, c, centre, radius, z, rng) {
  const color = CHROMO_COLOR[c.parent];
  const turns = c.pair === 'long' ? 12 : 8;
  const pts = [];
  let a = rng() * TAU;
  let px = 0; let py = 0;
  for (let i = 0; i < turns; i++) {
    pts.push([centre[0] + px, centre[1] + py, z + 0.012 * Math.sin(i * 1.7)]);
    a += 0.9 + rng() * 1.5;
    const step = radius * (0.5 + rng() * 0.32);
    px += Math.cos(a) * step; py += Math.sin(a) * step;
    const d = Math.hypot(px, py);
    if (d > radius) { px *= (radius * 0.9) / d; py *= (radius * 0.9) / d; }
  }
  chromo.push({ geometry: tube(pts, 0.027, { sides: 6, steps: turns * 4, round: 1 }), color: new THREE.Color(color[0], color[1], color[2]) });
}

// Where each loose chromosome keeps to inside its nucleus: chromosomes hold territories of their own
// even when they look like a tangle, and it is what makes four of them countable.
const TERRITORIES = [[-0.42, 0.4], [0.42, 0.38], [-0.4, -0.42], [0.38, -0.44]];

// A centrosome: a pair of little barrels at right angles, with short rays standing round them.
function centrosome(chromo, fibres, p, z, rays = 12, reach = 0.26, rng = null, aim = 0) {
  const barrel = (dir) => {
    const q = 0.1;
    const a = [p[0] - dir[0] * q, p[1] - dir[1] * q, z + 0.04 - dir[2] * q];
    const b = [p[0] + dir[0] * q, p[1] + dir[1] * q, z + 0.04 + dir[2] * q];
    chromo.push({ geometry: rod(a, b, 0.05, 8, 1), color: 0x1f8c62 });
  };
  barrel([0, 1, 0]);
  barrel([1, 0, 0]);
  for (let i = 0; i < rays; i++) {
    const a = aim + ((i + 0.5) / rays) * TAU;
    const L = reach * (0.7 + (rng ? rng() * 0.5 : 0.25));
    fibres.push({ geometry: rod([p[0], p[1], z + 0.012], [p[0] + Math.cos(a) * L, p[1] + Math.sin(a) * L, z + 0.012], [0.012, 0.005], 5, 0), color: 0x2f9d80 });
  }
}

// The back half of a cell or a pair of lobes, turned about the spindle (X) axis, as a closed shell with
// the membrane's real thickness. `profile(t)` runs round the outline and returns [x, radius].
function membraneShell(profile, cx, cy, t, nu = 36, nv = 14) {
  const nrm = (s) => {
    const e = 0.004;
    const a = profile(Math.max(0, s - e)); const b = profile(Math.min(1, s + e));
    const dx = b[0] - a[0]; const dr = b[1] - a[1];
    const len = Math.hypot(dx, dr) || 1;
    return [-dr / len, dx / len];
  };
  const P = (s, phi, off) => {
    const [x, r] = profile(s);
    const n = nrm(s);
    const xx = x - n[0] * off;
    const rr = Math.max(0, r - (n[1] * off));
    return [cx + xx, cy + rr * Math.cos(phi), -rr * Math.sin(phi)];
  };
  const g = gridSolid(nu, nv,
    (i, j) => P(i / nu, (j / nv) * Math.PI, 0),
    (i, j) => P(i / nu, (j / nv) * Math.PI, t),
    { crease: 40 });
  return g;
}

function stageOutline(profile, cx, cy, n = 56) {
  // Upper edge left to right, then the lower edge back.
  const pts = [];
  for (let i = 0; i <= n; i++) { const [x, r] = profile(i / n); pts.push([cx + x, cy + r]); }
  for (let i = n - 1; i > 0; i--) { const [x, r] = profile(i / n); pts.push([cx + x, cy - r]); }
  return pts;
}

function faceDisc(outline, z, depth = 0.1) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1, steps: 1 });
  g.translate(0, 0, z - depth);
  return g;
}

function mitosisStages() {
  const table = mitosisTable();
  checkMitosisTable(table);
  const rng = seededRandom(4122);
  const { TRAY_TOP, R, LIP, FACE } = MITOSIS;
  const stage = (key) => table.find((t) => t.key === key);

  const shell = [];
  const face = [];
  const chromo = [];
  const fibres = [];
  const metal = [];
  const plates = [];
  const lens = [];

  const circle = (a, b = a) => (s) => { const t = s * Math.PI; return [-a * Math.cos(t), b * Math.sin(t)]; };
  const furrowed = (a, b, f, w) => (s) => { const t = s * Math.PI; const x = -a * Math.cos(t); return [x, b * Math.sin(t) * (1 - f * Math.exp(-((x / w) ** 2)))]; };

  const SLOTS = [
    { key: 'interphase', w: 3.3 },
    { key: 'prophase', w: 3.3 },
    { key: 'metaphase', w: 3.3 },
    { key: 'anaphase', w: 3.55 },
    { key: 'telophase', w: 3.8 },
    { key: 'cytokinesis', w: 4.05 },
  ];
  const GAP = 0.09;
  const total = SLOTS.reduce((s, a) => s + a.w, 0) + GAP * (SLOTS.length - 1);
  let run = -total / 2;
  for (const s of SLOTS) { s.cx = run + s.w / 2; run += s.w + GAP; }
  const HALF_X = total / 2 + 0.28;
  must(Math.abs(HALF_X * 2 - 22) < 1, `the tray is about 22ft long (${(HALF_X * 2).toFixed(1)})`);

  // Tray: dark, with a raised lip all round, and a rail of plates in front of the cells.
  const TRAY_Z = 2.0;
  shell.push({ geometry: gridSolid(6, 1,
    (i, j) => {
      // A soft section along x, rounded at the ends by a rim of its own.
      const u = [-HALF_X, -HALF_X + 0.08, -HALF_X + 0.14, HALF_X - 0.14, HALF_X - 0.08, HALF_X, HALF_X][i];
      const yy = [TRAY_TOP - 0.1, TRAY_TOP, TRAY_TOP, TRAY_TOP, TRAY_TOP, TRAY_TOP - 0.1, TRAY_TOP - 0.1][i];
      return [u, yy, j === 0 ? -TRAY_Z : TRAY_Z];
    },
    (i, j) => {
      const u = [-HALF_X, -HALF_X + 0.08, -HALF_X + 0.14, HALF_X - 0.14, HALF_X - 0.08, HALF_X, HALF_X][i];
      return [u, 0, j === 0 ? -TRAY_Z : TRAY_Z];
    }, { crease: 30 }), color: 0x20242c });
  // A brass-coloured line along the tray's top edge, so the long dark block has a finished face.
  shell.push({ geometry: block(-HALF_X, TRAY_TOP - 0.3, TRAY_Z - 0.01, HALF_X, TRAY_TOP - 0.22, TRAY_Z + 0.012), color: 0x9d7f3f });

  const drawn = {};
  const note = (key, what, n = 1) => { drawn[key] = drawn[key] ?? {}; drawn[key][what] = (drawn[key][what] ?? 0) + n; };
  const Z_FACE = FACE;
  const Z_CHROMO = Z_FACE + 0.085;
  const Z_NUC = Z_FACE + 0.055;

  // One whole membrane-and-cytoplasm for one profile.
  const cellBody = (profile, cx, cy) => {
    const g = membraneShell(profile, cx, cy, LIP);
    tintVertices(g, (x, y, z, out, i) => {
      const nz = g.attributes.normal.getZ(i);
      if (z > -0.02 && nz > 0.8) { out[0] = 0.86; out[1] = 0.78; out[2] = 0.58; return; } // the cut membrane
      const inner = g.attributes.normal.getX(i) * (x - cx) + g.attributes.normal.getY(i) * (y - cy) + nz * z < 0;
      if (inner) { out[0] = 0.62; out[1] = 0.42; out[2] = 0.3; } else { out[0] = 0.72; out[1] = 0.62; out[2] = 0.46; }
    });
    shell.push({ geometry: g, keepColor: true });
    const outline = stageOutline(profile, cx, cy).map(([x, y]) => {
      const dx = x - cx; const dy = y - cy; const d = Math.hypot(dx, dy) || 1;
      // Reaches well into the membrane, so the disc and the wall cannot show a line of daylight.
      return [cx + dx * (1 - (LIP * 0.45) / d), cy + dy * (1 - (LIP * 0.45) / d)];
    });
    face.push({ geometry: faceDisc(outline, Z_FACE), color: 0xe6b98f });
  };

  // A nucleus on the cut face: a shallow raised lens, and the envelope as a real ring on its edge.
  const nucleusLens = (c, r, color = 0xb7a4dc, h = 0.05) => {
    const g = lathe([[0, 0], [r * 1.005, 0], [r * 1.005, 0.01], [r * 0.8, h * 0.72], [r * 0.45, h * 0.96], [0, h]], 40);
    g.rotateX(Math.PI / 2);
    g.translate(c[0], c[1], Z_FACE - 0.005);
    lens.push({ geometry: g, color });
  };
  const envelopeArc = (c, r, from, to, tubeR = 0.028, color = 0x54369b) => {
    const pts = [];
    const n = Math.max(3, Math.round((to - from) / 0.2));
    for (let i = 0; i <= n; i++) { const a = from + ((to - from) * i) / n; pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, Z_FACE + 0.03]); }
    chromo.push({ geometry: tube(pts, tubeR, { sides: 7, steps: n * 2, round: 1 }), color });
  };
  const nucleolus = (c, r) => {
    const g = ball([c[0], c[1], Z_NUC], [r, r * 0.86, 0.05], 14, 8);
    chromo.push({ geometry: g, color: 0x3a2466 });
  };
  const fibre = (a, b, key, r = 0.017, count = true) => {
    fibres.push({ geometry: rod(a, b, r, 6, 0), color: 0x1d8f70 });
    if (count) note(key, 'fibres');
  };

  const CY = TRAY_TOP + R * 0.88;

  // --- Interphase: an intact nucleus holding four loose threads ---------------------------------
  {
    const { cx, key } = SLOTS[0];
    cellBody(circle(R), cx, CY);
    const c = [cx - 0.05, CY + 0.02];
    const r = 0.92;
    nucleusLens(c, r);
    envelopeArc(c, r, 0, TAU);
    nucleolus([c[0] + 0.02, c[1] - 0.02], 0.15);
    stage(key).chromosomes.forEach((k, i) => {
      chromatinThread(chromo, k, [c[0] + TERRITORIES[i][0] * r, c[1] + TERRITORIES[i][1] * r], r * 0.46, Z_NUC + 0.03, rng);
      note(key, 'thread');
    });
    centrosome(chromo, fibres, [cx + 1.08, CY + 0.72], Z_FACE + 0.03, 12, 0.2, rng);
  }

  // --- Prophase: doubled X chromosomes, the envelope breaking up, the spindle starting ---------
  {
    const { cx, key } = SLOTS[1];
    cellBody(circle(R), cx, CY);
    const c = [cx, CY + 0.02];
    const r = 0.96;
    // Only a broken ring of a paler envelope is left, thinner, as the nuclear membrane fades.
    for (const [a, b] of [[0.2, 0.75], [1.15, 1.75], [2.25, 2.85], [3.45, 4.0], [4.55, 5.2], [5.65, 6.0]]) envelopeArc(c, r, a, b, 0.016, 0x9c86c9);
    const spots = [[-0.36, 0.42, 0.5], [0.43, 0.38, -0.55], [-0.32, -0.46, -0.3], [0.38, -0.42, 0.75]];
    stage(key).chromosomes.forEach((k, i) => {
      const [dx, dy, a] = spots[i];
      xChromosome(chromo, [c[0] + dx, c[1] + dy], k, Z_CHROMO, a, i * 2.1);
      note(key, 'X');
    });
    const poleL = [cx - 1.18, CY + 0.34]; const poleR = [cx + 1.18, CY - 0.34];
    centrosome(chromo, fibres, poleL, Z_FACE + 0.03, 12, 0.26, rng);
    centrosome(chromo, fibres, poleR, Z_FACE + 0.03, 12, 0.26, rng, 0.2);
  }

  // --- Metaphase: four X chromosomes on the equator, a fibre from both poles to each centromere --
  let metaFibre = 0;
  {
    const { cx, key } = SLOTS[2];
    cellBody(circle(R), cx, CY);
    const list = stage(key).chromosomes;
    const heights = list.map((k) => k.arm * 2 + 0.14);
    const span = heights.reduce((a, b) => a + b, 0);
    must(span < R * 2 * 0.9, 'the plate fits inside the cell');
    let y = CY + span / 2;
    const poles = [[cx - R * 0.8, CY], [cx + R * 0.8, CY]];
    for (const p of poles) centrosome(chromo, fibres, p, Z_FACE + 0.03, 14, 0.27, rng);
    list.forEach((k, i) => {
      y -= heights[i] / 2;
      const cen = [cx, y];
      xChromosome(chromo, cen, k, Z_CHROMO, 0, i * 1.3);
      note(key, 'X');
      must(Math.abs(cen[0] - cx) < 1e-6, 'on the equator');
      for (const p of poles) {
        fibre([p[0], p[1], Z_FACE + 0.03], [cen[0], cen[1], Z_CHROMO + 0.02], key);
        metaFibre += Math.hypot(cen[0] - p[0], cen[1] - p[1]);
      }
      y -= heights[i] / 2;
    });
    metaFibre /= drawn[key].fibres;
  }

  // --- Anaphase: eight single chromatids, four to each pole, on shorter fibres -------------------
  {
    const { cx, key } = SLOTS[3];
    const a = 1.75; const b = 1.56;
    cellBody(circle(a, b), cx, CY);
    const poles = { '-1': [cx - a * 0.84, CY], 1: [cx + a * 0.84, CY] };
    for (const side of [-1, 1]) centrosome(chromo, fibres, poles[side], Z_FACE + 0.03, 14, 0.27, rng);
    const list = stage(key).chromosomes;
    let anaFibre = 0;
    let n = 0;
    for (const side of [-1, 1]) {
      const group = list.filter((k) => k.side === side);
      const heights = group.map((k) => k.arm * 1.36 + 0.24);
      const span = heights.reduce((s, h) => s + h, 0);
      let y = CY + span / 2;
      group.forEach((k, i) => {
        y -= heights[i] / 2;
        const cen = [cx + side * 0.62, y];
        vChromatid(chromo, cen, k, side, Z_CHROMO, 1);
        note(key, 'V');
        fibre([poles[side][0], poles[side][1], Z_FACE + 0.03], [cen[0], cen[1], Z_CHROMO], key);
        anaFibre += Math.hypot(cen[0] - poles[side][0], cen[1] - poles[side][1]);
        n += 1;
        y -= heights[i] / 2;
      });
    }
    must(anaFibre / n < metaFibre, 'anaphase fibres are shorter than metaphase fibres');
  }

  // --- Telophase: two groups of four, new envelopes forming, a furrow starting -------------------
  {
    const { cx, key } = SLOTS[4];
    const a = 1.88; const b = 1.56;
    const profile = furrowed(a, b, 0.3, 0.42);
    cellBody(profile, cx, CY);
    const list = stage(key).chromosomes;
    for (const side of [-1, 1]) {
      const c = [cx + side * 1.06, CY];
      const r = 0.68;
      // The new envelope: paler, and not yet closed.
      nucleusLens(c, r, 0xcabde6, 0.03);
      for (const [from, to] of [[0.5, 1.65], [2.0, 3.2], [3.55, 4.6], [4.95, 6.0]]) envelopeArc(c, r, from, to, 0.02, 0x6d4fb0);
      const group = list.filter((k) => k.side === side);
      // Four chromatids that have stopped being dragged and are starting to loosen, spread out in the new nucleus.
      group.forEach((k, i) => {
        const dx = i === 0 || i === 3 ? -0.2 : 0.2;
        const dy = i < 2 ? 0.28 : -0.28;
        vChromatid(chromo, [c[0] + side * 0.1 + dx, c[1] + dy], k, side, Z_NUC + 0.04, 0.9, 0.05);
        note(key, 'V');
      });
      centrosome(chromo, fibres, [cx + side * 1.68 * 0.98, CY + 0.34], Z_FACE + 0.03, 8, 0.14, rng);
    }
    // What is left of the spindle, running through the narrowing waist.
    for (const dy of [-0.14, 0, 0.14]) fibres.push({ geometry: rod([cx - 0.42, CY + dy * 1.1, Z_FACE + 0.02], [cx + 0.42, CY + dy * 1.1, Z_FACE + 0.02], 0.012, 5, 0), color: 0x2f9d80 });
  }

  // --- Cytokinesis: two whole new cells, each with its own nucleus and four loose threads --------
  {
    const { cx, key, w } = SLOTS[5];
    const Rd = (w - 0.1) / 4;
    const list = stage(key).chromosomes;
    for (const side of [-1, 1]) {
      const c0 = cx + side * (Rd + 0.05);
      const cyD = TRAY_TOP + Rd * 0.86;
      cellBody(circle(Rd), c0, cyD);
      const r = Rd * 0.58;
      nucleusLens([c0, cyD], r);
      envelopeArc([c0, cyD], r, 0, TAU, 0.024);
      nucleolus([c0 + r * 0.02, cyD - r * 0.02], r * 0.15);
      list.filter((q) => q.side === side).forEach((k, i) => {
        chromatinThread(chromo, k, [c0 + TERRITORIES[i][0] * r, cyD + TERRITORIES[i][1] * r], r * 0.46, Z_NUC + 0.03, rng);
        note(key, 'thread');
      });
      centrosome(chromo, fibres, [c0 + side * Rd * 0.66, cyD + Rd * 0.48], Z_FACE + 0.03, 8, 0.14, rng);
    }
  }

  // Every count, against the table, after drawing.
  must(drawn.interphase.thread === 4, 'interphase drew 4');
  must(drawn.prophase.X === 4, 'prophase drew 4');
  must(drawn.metaphase.X === 4 && drawn.metaphase.fibres === 8, 'metaphase drew 4 and 8 fibres');
  must(drawn.anaphase.V === 8 && drawn.anaphase.fibres === 8, 'anaphase drew 8 and 8 fibres');
  must(drawn.telophase.V === 8, 'telophase drew 8');
  must(drawn.cytokinesis.thread === 8, 'the daughters drew 4 each');

  // The plates: on a rail along the tray, tipped back to be read from a standing eye.
  const atlas = plateAtlas(table.map((t) => t.name), { W: 512, rowH: 96, ground: '#f0e7cf' });
  SLOTS.forEach((s, i) => {
    const w = Math.min(2.5, s.w * 0.72);
    const g = printedPlate(w, w * 0.2, 0.34, atlas.rects[i]);
    g.applyMatrix4(new THREE.Matrix4().compose(V(s.cx, TRAY_TOP + 0.16, 1.32), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.92, 0, 0)), V(1, 1, 1)));
    plates.push({ geometry: g, keepColor: true });
  });

  const root = new THREE.Group();
  root.add(mesh(mergeParts(shell), standard({ vertexColors: true, roughness: 0.62, metalness: 0 })));
  const speck = canvasTexture(512, 512, (ctx, w, h) => {
    const noise = latticeNoise(55, 128);
    const local = seededRandom(77);
    paintTexels(ctx, 0, 0, w, h, (x, y, out) => {
      const n = 0.5 * noise(x / 16, y / 16) + 0.5 * noise(x / 5, y / 5);
      const v = 224 + 28 * n;
      out[0] = v; out[1] = v; out[2] = v;
    });
    // Granules of cytoplasm, near white so the disc's own colour carries the hue.
    for (let i = 0; i < 1500; i++) {
      const v = 165 + Math.floor(local() * 40);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.beginPath();
      ctx.arc(local() * w, local() * h, 0.8 + local() * 1.5, 0, TAU);
      ctx.fill();
    }
  });
  speck.wrapS = THREE.RepeatWrapping; speck.wrapT = THREE.RepeatWrapping;
  speck.repeat.set(0.42, 0.42);
  root.add(mesh(mergeParts(face), standard({ vertexColors: true, map: speck, roughness: 0.85, metalness: 0 })));
  root.add(mesh(mergeParts(lens), standard({ vertexColors: true, roughness: 0.6, metalness: 0 })));
  root.add(mesh(mergeParts([...chromo, ...fibres]), standard({ vertexColors: true, roughness: 0.42, metalness: 0 })));
  root.add(mesh(mergeParts(plates), standard({ map: atlas.texture, roughness: 0.6, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Inside a leaf
// ---------------------------------------------------------------------------------------------

// A flat cell: a sphere pushed out toward its box, so it has soft corners and no edges to catch on.
function softBox(c, w, h, d, nx = 12, ny = 8, power = 0.46) {
  const g = new THREE.SphereGeometry(1, nx, ny);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const f = (v) => Math.sign(v) * Math.abs(v) ** power;
    P.setXYZ(i, c[0] + (f(P.getX(i)) * w) / 2, c[1] + (f(P.getY(i)) * h) / 2, c[2] + (f(P.getZ(i)) * d) / 2);
  }
  g.computeVertexNormals();
  return g;
}

// A chloroplast is a lens, sunk half into the cell it lives on.
function chloroplast(c, normal, r, color) {
  const g = new THREE.SphereGeometry(1, 6, 4);
  g.scale(r, r * 0.8, r * 0.42);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), V(normal[0], normal[1], normal[2]).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(V(c[0], c[1], c[2]), q, V(1, 1, 1)));
  return { geometry: g, color };
}

const LEAF = {
  Y0: 2.55, // the underside, about 2.5ft above the base
  HX: 4.5,
  HZ: 2.5,
  RECESS: 1.15, // how far back the opened front of the block goes
  // Thicknesses from the bottom. These six add to the leaf's 3ft and are the order the plates name.
  LOW_CUT: 0.07,
  LOW_EP: 0.23,
  SPONGY: 1.05,
  PALISADE: 1.25,
  UP_EP: 0.28,
  UP_CUT: 0.12,
  STOMATA: [-3.15, -1.5, 2.55],
  ZC: 1.95, // the middle of each stoma, front to back. The cut runs through it at z = HZ.
  GUARD_A: 0.38,
  GUARD_B: 1.0,
  GUARD_R: 0.17,
};

// What the block's other three faces are painted with: the same layers, drawn flat. The vein is only at
// the middle of the sheet, and the two ends of the block use the part of it without one.
function leafSidePainting() {
  const { LOW_CUT, LOW_EP, SPONGY, PALISADE, UP_EP, UP_CUT } = LEAF;
  const total = LOW_CUT + LOW_EP + SPONGY + PALISADE + UP_EP + UP_CUT;
  return canvasTexture(1024, 342, (ctx, W, H) => {
    const rng = seededRandom(9021);
    const yOf = (t) => H * (1 - t / total);
    ctx.fillStyle = '#10230f';
    ctx.fillRect(0, 0, W, H);
    const fill = (a, b, color) => { ctx.fillStyle = color; ctx.fillRect(0, yOf(b), W, yOf(a) - yOf(b)); };
    let t = 0;
    fill(t, t + LOW_CUT, '#e2c144'); t += LOW_CUT;
    const lowEp = t;
    fill(t, t + LOW_EP, '#a9c58a'); t += LOW_EP;
    const sp = t; t += SPONGY;
    const pa = t; t += PALISADE;
    const upEp = t;
    fill(t, t + UP_EP, '#b7d19a'); t += UP_EP;
    fill(t, t + UP_CUT, '#e8c94c');
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); };
    const P = W / (9 / 0.335);
    for (let x = 0; x < W; x += P) {
      ctx.fillStyle = `rgb(${72 + rng() * 22},${140 + rng() * 26},${58 + rng() * 14})`;
      rr(x + 1.2, yOf(upEp) + 1, P - 2.4, yOf(pa) - yOf(upEp) - 2, 5);
      ctx.fill();
      ctx.fillStyle = '#2f7f2c';
      for (let i = 0; i < 26; i++) {
        ctx.beginPath();
        ctx.arc(x + 3 + rng() * (P - 6), yOf(upEp) + 3 + rng() * (yOf(pa) - yOf(upEp) - 6), 1.5, 0, TAU);
        ctx.fill();
      }
    }
    // Spongy cells, each drawn as a lobed blob with dark air around it.
    for (let i = 0; i < 74; i++) {
      const x = rng() * W; const y = yOf(pa) + rng() * (yOf(sp) - yOf(pa));
      const r = 12 + rng() * 9;
      ctx.fillStyle = `rgb(${86 + rng() * 26},${146 + rng() * 26},${70 + rng() * 16})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.72 + rng() * 0.3), rng() * 3, 0, TAU);
      ctx.fill();
    }
    // The epidermis, flat clear cells with a line between them.
    ctx.strokeStyle = 'rgba(70,96,50,0.7)';
    ctx.lineWidth = 1.5;
    for (const [a, h] of [[lowEp, LOW_EP], [upEp, UP_EP]]) {
      for (let x = rng() * 16; x < W; x += 20 + rng() * 14) { ctx.beginPath(); ctx.moveTo(x, yOf(a)); ctx.lineTo(x, yOf(a + h)); ctx.stroke(); }
    }
    // The vein runs back through the block, so its far end shows at the middle of the far face.
    const cy = yOf(LOW_CUT + LOW_EP + 0.72);
    ctx.fillStyle = '#e7dcae';
    ctx.beginPath(); ctx.arc(W / 2, cy, 24, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7c4a2c';
    for (const [dx, dy, r] of [[-8, -9, 5], [5, -11, 6], [-1, -2, 4]]) { ctx.beginPath(); ctx.arc(W / 2 + dx, cy + dy, r, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#c9c07c';
    for (const [dx, dy] of [[-8, 8], [0, 11], [8, 8]]) { ctx.beginPath(); ctx.arc(W / 2 + dx, cy + dy, 3.5, 0, TAU); ctx.fill(); }
  });
}

// The surface of the leaf from above or below: the jigsaw of epidermal cells, near white.
function leafSkinMap(seed) {
  const tex = canvasTexture(512, 512, (ctx, W, H) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#f4f4ee';
    ctx.fillRect(0, 0, W, H);
    const N = 9;
    const jitter = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) jitter.push([(rng() - 0.5) * 22, (rng() - 0.5) * 22]);
    const node = (i, j) => { const [a, b] = jitter[((i + N) % N) + ((j + N) % N) * N]; return [(i * W) / N + a, (j * H) / N + b]; };
    ctx.strokeStyle = 'rgba(104,110,60,0.75)';
    ctx.lineWidth = 2.2;
    const wig = (p, q) => {
      const mx = (p[0] + q[0]) / 2 + (p[1] - q[1]) * 0.18; const my = (p[1] + q[1]) / 2 + (q[0] - p[0]) * 0.18;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.quadraticCurveTo(mx, my, q[0], q[1]); ctx.stroke();
    };
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const p = node(i, j); wig(p, node(i + 1, j)); wig(p, node(i, j + 1)); }
  });
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.5, 0.5);
  return tex;
}

function leafSection() {
  const L = LEAF;
  const rng = seededRandom(5150);
  const { Y0, HX, HZ, RECESS, LOW_CUT, LOW_EP, SPONGY, PALISADE, UP_EP, UP_CUT, ZC, GUARD_A, GUARD_B, GUARD_R } = L;
  must(Math.abs(LOW_CUT + LOW_EP + SPONGY + PALISADE + UP_EP + UP_CUT - 3) < 1e-6, 'the leaf is 3ft thick');
  must(L.STOMATA.length === 3, 'three stomata');
  const yEp = Y0 + LOW_CUT; const ySp = yEp + LOW_EP; const yPa = ySp + SPONGY; const yUp = yPa + PALISADE; const yCu = yUp + UP_EP; const yTop = yCu + UP_CUT;
  const VEIN = { c: [0, ySp + 0.74], R: 0.62 };

  const cells = [];
  const body = [];
  const wax = [];
  const stand = [];
  const plates = [];
  const sides = [];

  // --- The closed block behind the opened front ----------------------------------------------
  // Its front face is the dark back wall of the air spaces.
  body.push({ geometry: block(-HX + 0.01, ySp - 0.02, -HZ + 0.01, HX - 0.01, yCu + 0.02, RECESS), color: 0x0d1d0d });
  // Behind the palisade row, the same deep green, so a gap between two cells reads as shadow rather than sky.
  body.push({ geometry: block(-HX + 0.01, yPa - 0.02, RECESS - 0.01, HX - 0.01, yUp + 0.01, 2.14), color: 0x14330f });
  // The two epidermis slabs behind their front rows.
  body.push({ geometry: block(-HX + 0.01, yUp - 0.005, RECESS - 0.01, HX - 0.01, yCu + 0.01, 2.08), color: 0x9fbe80 });

  // --- The painted faces ---------------------------------------------------------------------
  const sideBox = (x0, x1, z0, z1, [u0, u1]) => {
    const g = block(x0, Y0, z0, x1, yTop, z1);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, mix(u0, u1, uv.getX(i)), uv.getY(i));
    sides.push({ geometry: g, keepColor: true });
  };
  sideBox(-HX - 0.02, -HX + 0.015, -HZ, HZ, [0.02, 0.4]);
  sideBox(HX - 0.015, HX + 0.02, -HZ, HZ, [0.6, 0.98]);
  sideBox(-HX, HX, -HZ - 0.02, -HZ + 0.015, [1, 0]);

  // --- Waxy cuticle, top and bottom -----------------------------------------------------------
  const skinUV = (g) => {
    const P = g.attributes.position; const uv = g.attributes.uv;
    const N = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      // Only the two faces of the leaf carry the mosaic: a cut edge samples plain wax.
      if (Math.abs(N.getY(i)) > 0.5) uv.setXY(i, P.getX(i), P.getZ(i));
      else uv.setXY(i, 0.11, 0.11);
    }
    return g;
  };
  wax.push({ geometry: skinUV(block(-HX, yCu, -HZ, HX, yTop, HZ + 0.03)), color: 0xf3da68 });

  // The plan of the lower skin, with a notch for each stoma. A notch's edge lies inside the outer half of
  // its guard cells, so the two cannot show a line of daylight, and the notch runs out through the cut face.
  const STEPS = 12;
  const tEnd = Math.asin(clamp01((HZ - ZC) / GUARD_B));
  const plan = () => {
    const pts = [[-HX, HZ]];
    for (const xs of L.STOMATA) {
      for (let i = 0; i <= STEPS; i++) {
        const t = mix(tEnd, -Math.PI / 2, i / STEPS);
        pts.push([xs - (GUARD_A * Math.cos(t) + GUARD_R * 0.4), ZC + GUARD_B * Math.sin(t)]);
      }
      for (let i = 1; i <= STEPS; i++) {
        const t = mix(-Math.PI / 2, tEnd, i / STEPS);
        pts.push([xs + (GUARD_A * Math.cos(t) + GUARD_R * 0.4), ZC + GUARD_B * Math.sin(t)]);
      }
    }
    pts.push([HX, HZ], [HX, -HZ], [-HX, -HZ]);
    return pts;
  };
  const planSlab = (y0, y1) => {
    // Shape y is -z, so the outline above runs counter-clockwise in the shape's own plane.
    const shape = new THREE.Shape(plan().map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1, steps: 1 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0, 0);
    return skinUV(g);
  };
  wax.push({ geometry: planSlab(Y0, yEp), color: 0xf3da68 });
  const lowSlab = planSlab(yEp, ySp);
  tintVertices(lowSlab, (x, y, z, out, i) => {
    // Its top is the floor of the air spaces, so it is dark; its edges are the pale epidermis.
    const up = lowSlab.attributes.normal.getY(i);
    if (up > 0.5) { out[0] = 0.03; out[1] = 0.07; out[2] = 0.03; } else { out[0] = 0.44; out[1] = 0.58; out[2] = 0.3; }
  });
  body.push({ geometry: lowSlab, keepColor: true });

  // --- The row of flat, clear epidermal cells along each face ---------------------------------
  const clear = (k) => { const c = new THREE.Color(0xc4dcaa); c.multiplyScalar(k); return c; };
  const inNotch = (x) => L.STOMATA.some((xs) => Math.abs(x - xs) < GUARD_A + GUARD_R * 1.05);
  const flatRow = (y0, y1, z, isLower) => {
    let x = -HX + 0.01;
    while (x < HX - 0.02) {
      let w = 0.52 + rng() * 0.28;
      if (HX - x - w < 0.3) w = HX - x - 0.01;
      const mid = x + w / 2;
      const clash = isLower && (inNotch(x + 0.02) || inNotch(x + w - 0.02) || inNotch(mid));
      if (clash) { x += 0.06; continue; }
      if (isLower) {
        // Cells run right up to the guard cells rather than leaving a slot of bare slab.
        for (const xs of L.STOMATA) {
          const edge = xs - (GUARD_A + GUARD_R * 1.0);
          if (x < edge && x + w > edge - 0.2 && x + w < xs) w = edge + 0.08 - x;
        }
      }
      cells.push({ geometry: softBox([x + w / 2, (y0 + y1) / 2, z], w + 0.02, y1 - y0 + 0.01, 0.44), color: clear(0.92 + rng() * 0.14) });
      x += w;
    }
  };
  flatRow(yUp, yCu, 2.22, false);
  flatRow(yEp, ySp, 2.33, true);

  // --- Palisade: tall cells packed with chloroplasts --------------------------------------------
  const veinTop = (x) => {
    const dx = Math.abs(x - VEIN.c[0]);
    return dx < VEIN.R + 0.02 ? VEIN.c[1] + Math.sqrt((VEIN.R + 0.03) ** 2 - dx * dx) + 0.1 : -1e3;
  };
  const PAL_N = Math.round((HX * 2) / 0.335);
  const palW = (HX * 2) / PAL_N;
  const GREENS = [0x1f7d1f, 0x25902a, 0x176b1c, 0x2b9a2d];
  let chloroCount = 0;
  for (let i = 0; i < PAL_N; i++) {
    const cx = -HX + (i + 0.5) * palW;
    const r = palW * 0.5;
    const rz = 0.17;
    const top = yUp - 0.005;
    const bottom = Math.max(yPa + 0.02 + rng() * 0.03, veinTop(cx - r * 0.5), veinTop(cx + r * 0.5), veinTop(cx));
    const h = top - bottom;
    if (h < r * 2.1) continue;
    const prof = [[0, 0]];
    for (let k = 1; k <= 3; k++) { const a = (k / 3) * (Math.PI / 2); prof.push([Math.sin(a) * r, r - Math.cos(a) * r]); }
    for (let k = 1; k < 5; k++) prof.push([r, r + ((h - 2 * r) * k) / 5]);
    for (let k = 0; k <= 2; k++) { const a = (k / 3) * (Math.PI / 2); prof.push([Math.cos(a) * r, h - r + Math.sin(a) * r]); }
    prof.push([0, h]);
    const g = lathe(prof, 14);
    g.scale(1, 1, rz / r);
    g.translate(cx, bottom, 2.31);
    cells.push({ geometry: g, color: new THREE.Color(0x8ecb6c).multiplyScalar(0.9 + rng() * 0.16) });
    // Chloroplasts sit in the rim of the cell, so they are placed on its own surface by angle and height.
    const rows = Math.max(3, Math.round((h - 2 * r) / 0.14));
    for (let row = 0; row < rows; row++) {
      const y = bottom + r * 0.6 + ((h - r * 1.2) * (row + 0.5)) / rows;
      for (const base of (row % 2 ? [-0.82, 0.05, 0.92] : [-0.42, 0.48])) {
        const a = base + (rng() - 0.5) * 0.3;
        const n = [Math.sin(a) / r, 0, Math.cos(a) / rz];
        const ln = Math.hypot(n[0], n[2]);
        const p = [cx + r * Math.sin(a), y + (rng() - 0.5) * 0.03, 2.31 + rz * Math.cos(a)];
        cells.push(chloroplast(p, [n[0] / ln, 0, n[2] / ln], 0.062, GREENS[Math.floor(rng() * GREENS.length)]));
        chloroCount += 1;
      }
    }
  }
  must(chloroCount > 250, 'the palisade is packed with chloroplasts');

  // --- Spongy layer: loose cells with real air between them ------------------------------------
  const clearOfChamber = (x, y) => !L.STOMATA.some((xs) => Math.abs(x - xs) < 0.62 && y < ySp + 0.66);
  const clearOfVein = (x, y, r) => Math.hypot(x - VEIN.c[0], y - VEIN.c[1]) > VEIN.R + r + 0.02;
  const spongy = [];
  const place = (z, count, scale, gap) => {
    let tries = 0;
    const placed = [];
    while (placed.length < count && tries < 4000) {
      tries += 1;
      const r = (0.145 + rng() * 0.07) * scale;
      const x = -HX + r + rng() * (HX * 2 - 2 * r);
      const y = ySp + r * 0.7 + rng() * (SPONGY - r * 1.2);
      if (!clearOfChamber(x, y) || !clearOfVein(x, y, r)) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r + gap)) continue;
      placed.push({ x, y, r, z });
    }
    spongy.push(...placed);
    return placed;
  };
  const front = place(2.2, 52, 1, 0.01);
  place(1.5, 34, 1.08, -0.02);
  must(front.length >= 24, `enough spongy cells ${front.length}`);
  for (const cell of spongy) {
    const isFront = cell.z > 2;
    const g = new THREE.SphereGeometry(1, isFront ? 12 : 8, isFront ? 8 : 6);
    const P = g.attributes.position;
    const sx = 1 + rng() * 0.35; const sy = 0.78 + rng() * 0.24; const ph = rng() * 9;
    const lobes = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
      const a = Math.atan2(y, x);
      const k = 1 + 0.13 * Math.sin(lobes * a + ph);
      P.setXYZ(i, cell.x + x * cell.r * sx * k, cell.y + y * cell.r * sy * k, cell.z + z * 0.3);
    }
    g.computeVertexNormals();
    const shade = isFront ? 1 : 0.42;
    cells.push({ geometry: g, color: new THREE.Color(0x77b95a).multiplyScalar(shade * (0.88 + rng() * 0.2)) });
    if (isFront) {
      // A few chloroplasts, far fewer than up in the palisade, which is the point of the two layers.
      const count = 5;
      for (let i = 0; i < count; i++) {
        const a = rng() * TAU; const b = rng() * 0.75;
        const nx = Math.sin(b) * Math.cos(a); const ny = Math.sin(b) * Math.sin(a); const nz = Math.cos(b);
        cells.push(chloroplast([cell.x + nx * cell.r * sx, cell.y + ny * cell.r * sy, cell.z + nz * 0.3], [nx, ny, nz], 0.055, GREENS[Math.floor(rng() * 4)]));
      }
    }
  }

  // --- The three stomata ---------------------------------------------------------------------
  // Each is a pair of real sausage-shaped guard cells with a real gap between them, cut through by the face
  // so that it shows its section there and its whole kidney shape from underneath. The pair meet at the back,
  // and they are the only cells of the skin with chloroplasts in them, which is true.
  let stomata = 0;
  for (const xs of L.STOMATA) {
    for (const side of [-1, 1]) {
      const pts = [];
      const n = 10;
      for (let i = 0; i <= n; i++) {
        const t = mix(-Math.PI / 2 + 0.02, tEnd, i / n);
        pts.push([xs + side * GUARD_A * Math.cos(t), Y0 + 0.15, ZC + GUARD_B * Math.sin(t)]);
      }
      const g = tube(pts, GUARD_R, { sides: 12, steps: 14, round: 0 });
      cells.push({ geometry: g, color: 0x86bf52 });
      for (let i = 0; i < 7; i++) {
        const t = mix(-1.0, tEnd - 0.08, (i + 0.5) / 7);
        const a = rng() * TAU;
        const ca = Math.cos(a); const sa = Math.sin(a);
        const nrm = [side * ca * Math.cos(t), sa, ca * Math.sin(t) * 0.4];
        const p = [xs + side * GUARD_A * Math.cos(t) + nrm[0] * GUARD_R, Y0 + 0.15 + nrm[1] * GUARD_R, ZC + GUARD_B * Math.sin(t) + nrm[2] * GUARD_R];
        cells.push(chloroplast(p, nrm, 0.045, GREENS[i % 4]));
      }
    }
    // The dark of the air space the opening leads into, which is what you see up through it.
    stomata += 1;
  }
  must(stomata === 3, 'exactly three stomata');
  const pairGap = 2 * (GUARD_A - GUARD_R);
  must(pairGap > 0.2, 'each stoma has a real opening');

  // --- The vein: xylem above, phloem below, inside a pale bundle sheath ------------------------
  const FZ = 2.42;
  const { c: vc, R: vR } = VEIN;
  // The bundle's body runs back into the block and its face is a pale plate.
  const barrel = new THREE.CylinderGeometry(vR, vR, FZ - RECESS, 28, 1);
  barrel.rotateX(Math.PI / 2);
  barrel.translate(vc[0], vc[1], (FZ + RECESS) / 2);
  cells.push({ geometry: barrel, color: 0xc9bf8d });
  const SHEATH = 15;
  for (let i = 0; i < SHEATH; i++) {
    const a = (i / SHEATH) * TAU;
    cells.push({ geometry: softBox([vc[0] + Math.cos(a) * vR, vc[1] + Math.sin(a) * vR, 2.3], 0.28, 0.28, 0.4, 10, 7, 0.82), color: new THREE.Color(0xeee3b2).multiplyScalar(0.95 + rng() * 0.1) });
  }
  // Xylem: five dark open tubes, big in the middle, all in the upper half.
  const XYLEM = [[0, 0.26, 0.135], [-0.27, 0.2, 0.105], [0.27, 0.21, 0.105], [-0.13, 0.03, 0.08], [0.15, 0.03, 0.085]];
  for (const [dx, dy, r] of XYLEM) {
    must(dy >= 0, 'xylem is the upper part of the bundle');
    const x = vc[0] + dx; const y = vc[1] + dy;
    const wall = 0.03;
    // No CSG, so a tube's opening stands forward of the face and its dark floor is a real depth below the rim.
    const sleeve = lathe([[0, -0.05], [r, -0.05], [r, 0.17], [r - wall, 0.17], [r - wall, 0.015], [0, 0.015]], 18);
    tintVertices(sleeve, (a, b, c, out) => {
      const inner = Math.hypot(a, c) < r - wall * 0.5 && b < 0.165;
      const k = inner ? 0.05 : 1;
      out[0] = 0.28 * k; out[1] = 0.085 * k; out[2] = 0.035 * k;
    });
    sleeve.rotateX(Math.PI / 2);
    sleeve.translate(x, y, FZ);
    cells.push({ geometry: sleeve, keepColor: true });
  }
  // Phloem: paler, smaller, closely packed, all in the lower half.
  const PHLOEM = [];
  for (let row = 0; row < 3; row++) {
    const count = [5, 4, 3][row];
    for (let i = 0; i < count; i++) PHLOEM.push([((i + 0.5) / count - 0.5) * [0.72, 0.56, 0.38][row], -0.12 - row * 0.145]);
  }
  for (const [dx, dy] of PHLOEM) {
    must(dy < 0, 'phloem is the lower part of the bundle');
    cells.push({ geometry: ball([vc[0] + dx, vc[1] + dy, FZ + 0.015], [0.078, 0.07, 0.05], 8, 6), color: new THREE.Color(0xe9dd9c).multiplyScalar(0.92 + rng() * 0.1) });
  }

  // --- Base and posts --------------------------------------------------------------------------
  const BX = 6.05; const BZ0 = -3.05; const BZ1 = 3.8; const BY = 0.2;
  stand.push({ geometry: block(-BX, 0, BZ0, BX, BY, BZ1), color: 0x33291f });
  stand.push({ geometry: block(-BX + 0.1, BY, BZ0 + 0.1, BX - 0.1, BY + 0.03, BZ1 - 0.1), color: 0x4a3b2c });
  for (const x of [-3.5, 3.5]) {
    stand.push({ geometry: rod([x, BY, -0.9], [x, Y0 + 0.05, -0.9], 0.085, 12, 0), color: 0x8d8f91 });
    stand.push({ geometry: lathe([[0, 0], [0.26, 0], [0.26, 0.04], [0.13, 0.12], [0.085, 0.2], [0, 0.2]], 18).translate(x, BY, -0.9), color: 0x6a6c6e });
    stand.push({ geometry: lathe([[0, 0], [0.085, 0], [0.14, 0.08], [0.2, 0.12], [0, 0.12]], 18).translate(x, Y0 - 0.115, -0.9), color: 0x6a6c6e });
  }

  // --- Arrows, each standing between the base and the leaf, so that none of them floats --------
  const arrowParts = [];
  const SUN = 0xffc414; const WATER = 0x1a62e0; const CO2 = 0xe2531d; const O2 = 0x1ec7c0;
  for (const x of [-2.4, 0.3, 3.0]) {
    arrowParts.push({ geometry: arrow3([x + 0.5, yTop + 1.75, 1.15], [x, yTop - 0.02, 0.7], 0.075, 0.2, 0.42), color: SUN });
  }
  // Water comes up the vein: the arrow runs up the face of the block and stops just under the bundle.
  arrowParts.push({ geometry: arrow3([0, BY, 2.72], [0, VEIN.c[1] - vR - 0.15, 2.72], 0.07, 0.19, 0.4), color: WATER });
  arrowParts.push({ geometry: rod([0, VEIN.c[1] - vR - 0.15, 2.72], [0, VEIN.c[1] - vR - 0.15, 2.45], 0.012, 4, 0), color: WATER });
  // CO2 goes up through the first stoma, O2 comes down out of the third.
  arrowParts.push({ geometry: arrow3([L.STOMATA[0], BY, ZC + 0.15], [L.STOMATA[0], ySp + 0.1, ZC + 0.15], 0.06, 0.15, 0.34), color: CO2 });
  arrowParts.push({ geometry: arrow3([L.STOMATA[2], ySp + 0.1, ZC + 0.15], [L.STOMATA[2], BY - 0.01, ZC + 0.15], 0.06, 0.15, 0.34), color: O2 });

  // --- Plates ------------------------------------------------------------------------------------
  const atlas = plateAtlas(['CUTICLE', 'PALISADE CELLS', 'SPONGY LAYER', 'STOMA', 'VEIN|xylem above, phloem below', 'SUNLIGHT', 'WATER', 'CO^2', 'O^2'], { W: 512, rowH: 104, ground: '#f0e7cf' });
  // The three layers, each beside the layer it names, with a pin into the block's end.
  const layerPlate = (rect, y) => {
    const g = printedPlate(1.32, 0.34, 0.07, rect);
    g.translate(HX + 0.85, y, HZ - 0.06);
    plates.push({ geometry: g, keepColor: true });
    stand.push({ geometry: rod([HX - 0.02, y, HZ - 0.1], [HX + 0.28, y, HZ - 0.1], 0.02, 6, 0), color: 0x35322c });
  };
  layerPlate(atlas.rects[0], yCu + UP_CUT / 2);
  layerPlate(atlas.rects[1], yPa + PALISADE * 0.55);
  layerPlate(atlas.rects[2], ySp + SPONGY * 0.5);
  // On stalks below the leaf, each with a leader to what it names.
  flagPlate(plates, stand, atlas.rects[3], { x: L.STOMATA[1], y: 1.1, z: 3.1, w: 0.9, h: 0.3, y0: BY, target: [L.STOMATA[1] + 0.05, Y0 + 0.04, 2.32] });
  flagPlate(plates, stand, atlas.rects[4], { x: 1.28, y: 1.15, z: 3.2, w: 1.6, h: 0.5, y0: BY, target: [vc[0] + 0.4, vc[1] - 0.47, 2.42] });
  // Arrow names: each sits on its own arrow's shaft.
  const onShaft = (rect, x, y, z, w = 0.74) => {
    const g = printedPlate(w, 0.27, 0.05, rect);
    g.translate(x, y, z);
    plates.push({ geometry: g, keepColor: true });
  };
  onShaft(atlas.rects[5], 0.55, yTop + 0.95, 1.08, 1.05);
  onShaft(atlas.rects[6], 0, 1.0, 2.82);
  onShaft(atlas.rects[7], L.STOMATA[0], 1.0, ZC + 0.26);
  onShaft(atlas.rects[8], L.STOMATA[2], 1.0, ZC + 0.26);

  const root = new THREE.Group();
  root.add(mesh(mergeParts(body), standard({ vertexColors: true, roughness: 0.9, metalness: 0 })));
  root.add(mesh(mergeParts(sides), standard({ map: leafSidePainting(), roughness: 0.7, metalness: 0 })));
  root.add(mesh(mergeParts(cells), standard({ vertexColors: true, roughness: 0.5, metalness: 0 })));
  root.add(mesh(mergeParts(wax), standard({ vertexColors: true, map: leafSkinMap(61), roughness: 0.22, metalness: 0 })));
  root.add(mesh(mergeParts([...stand, ...arrowParts]), standard({ vertexColors: true, roughness: 0.48, metalness: 0.08 })));
  root.add(mesh(mergeParts(plates), standard({ map: atlas.texture, roughness: 0.6, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Bacterium
// ---------------------------------------------------------------------------------------------

// A tube round a closed curve, its last ring welded to its first by the index: there is no end to
// leave open. The frame is parallel transported and what twist the loop picks up is shared out evenly,
// or the last strip would wring itself.
function closedTube(points, radius, sides = 6) {
  const n = points.length;
  const C = points.map((p) => V(p[0], p[1], p[2]));
  const tangents = C.map((p, i) => C[(i + 1) % n].clone().sub(C[(i - 1 + n) % n]).normalize());
  let N = Math.abs(tangents[0].y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0);
  N.addScaledVector(tangents[0], -N.dot(tangents[0])).normalize();
  const start = N.clone();
  const normals = [];
  for (let i = 0; i < n; i++) {
    normals.push(N.clone());
    const q = new THREE.Quaternion().setFromUnitVectors(tangents[i], tangents[(i + 1) % n]);
    N = N.clone().applyQuaternion(q);
    N.addScaledVector(tangents[(i + 1) % n], -N.dot(tangents[(i + 1) % n])).normalize();
  }
  const T0 = tangents[0];
  const twist = Math.atan2(N.clone().cross(start).dot(T0), N.dot(start));
  const positions = [];
  const index = [];
  for (let i = 0; i < n; i++) {
    const nn = normals[i].clone().applyAxisAngle(tangents[i], (twist * i) / n);
    const bb = tangents[i].clone().cross(nn);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * TAU;
      const r = Array.isArray(radius) ? radius[i] : radius;
      positions.push(C[i].x + (nn.x * Math.cos(a) + bb.x * Math.sin(a)) * r, C[i].y + (nn.y * Math.cos(a) + bb.y * Math.sin(a)) * r, C[i].z + (nn.z * Math.cos(a) + bb.z * Math.sin(a)) * r);
    }
  }
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      index.push(i * sides + j, i * sides + j2, i2 * sides + j2, i * sides + j, i2 * sides + j2, i2 * sides + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  must(signedVolume(g) > 0, 'a closed tube is wound outward');
  return g;
}

// True only of a closed surface: every edge belongs to exactly two triangles. A tube with an end anywhere
// would fail this at the rim of that end.
export function everyEdgeTwice(geometry) {
  const idx = geometry.index;
  const count = new Map();
  for (let t = 0; t < idx.count; t += 3) {
    for (const [a, b] of [[t, t + 1], [t + 1, t + 2], [t + 2, t]]) {
      const u = idx.getX(a); const v = idx.getX(b);
      const key = u < v ? u * 1e7 + v : v * 1e7 + u;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  for (const c of count.values()) if (c !== 2) return false;
  return true;
}

const BACT = {
  CX: -1.5,
  CY: 3.25,
  LC: 2.45, // half the straight part
  CAPSULE: [1.3, 1.17],
  WALL: [1.17, 1.03],
  MEMBRANE: [1.03, 0.95],
  OPEN: { capsule: 1.33, wall: 1.2, membrane: 1.08 }, // half the wedge, by layer, so each shows as a step
  FACE: -0.2,
  PLASMIDS: 2,
};

function bacteriumCell() {
  const B = BACT;
  const rng = seededRandom(2718);
  const { CX, CY, LC, FACE } = B;
  const LEFT = CX - LC; const RIGHT = CX + LC;

  // A true capsule: a cylinder with hemispherical ends. u runs from the left pole to the right one.
  const capsulePoint = (s, phi, rho) => {
    let x; let r;
    if (s < 0.26) { const a = (s / 0.26) * (Math.PI / 2); x = LEFT - rho * Math.cos(a); r = rho * Math.sin(a); }
    else if (s > 0.74) { const a = ((s - 0.74) / 0.26) * (Math.PI / 2); x = RIGHT + rho * Math.sin(a); r = rho * Math.cos(a); }
    else { x = mix(LEFT, RIGHT, (s - 0.26) / 0.48); r = rho; }
    return [x, CY + r * Math.sin(phi), r * Math.cos(phi)];
  };
  const layer = ([rOut, rIn], open, nu = 34, nv = 28) => gridSolid(nu, nv,
    (i, j) => capsulePoint(i / nu, mix(open, TAU - open, j / nv), rOut),
    (i, j) => capsulePoint(i / nu, mix(open, TAU - open, j / nv), rIn),
    { crease: 40 });

  const shells = [];
  const inside = [];
  const stand = [];
  const plates = [];

  const capsule = layer(B.CAPSULE, B.OPEN.capsule);
  tintVertices(capsule, (x, y, z, out) => {
    const k = 0.9 + 0.2 * smoothNoise3(x * 1.3 + 7, y * 1.3, z * 1.3);
    out[0] = 0.13 * k; out[1] = 0.42 * k; out[2] = 0.33 * k;
  });
  shells.push({ geometry: capsule, keepColor: true });
  shells.push({ geometry: layer(B.WALL, B.OPEN.wall), color: 0xe89a24 });
  shells.push({ geometry: layer(B.MEMBRANE, B.OPEN.membrane), color: 0xd03a63 });

  // The flat cut face of the cytoplasm, behind which everything is closed. Its outline reaches into the
  // membrane, so no line of daylight can open between them.
  const rho = Math.sqrt((B.MEMBRANE[1] + 0.04) ** 2 - FACE * FACE);
  const outline = [];
  for (let i = 0; i <= 24; i++) { const a = -Math.PI / 2 + (i / 24) * Math.PI; outline.push([RIGHT + Math.cos(a) * rho, CY + Math.sin(a) * rho]); }
  for (let i = 0; i <= 24; i++) { const a = Math.PI / 2 + (i / 24) * Math.PI; outline.push([LEFT + Math.cos(a) * rho, CY + Math.sin(a) * rho]); }
  const faceShape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const faceG = new THREE.ExtrudeGeometry(faceShape, { depth: 0.1, bevelEnabled: false, curveSegments: 1 });
  faceG.translate(0, 0, FACE - 0.1);

  // Keep-out rings for the two plasmids, so the chromosome does not run through them. There is deliberately
  // no boundary of any kind round the DNA: nothing inside this cell may read as a nucleus.
  const PLASMID_AT = [
    { c: [CX + 2.55, CY - 0.5], tilt: 0.45, spin: 0.3 },
    { c: [CX - 2.75, CY + 0.42], tilt: -0.4, spin: 1.2 },
  ];
  must(PLASMID_AT.length === B.PLASMIDS, 'exactly two plasmids');

  // --- The chromosome: ONE closed loop ---------------------------------------------------------
  // A sum of whole-number harmonics of t returns exactly to where it started, whatever the coefficients,
  // so this cannot have an end: it is one tangled ring, and everyEdgeTwice proves the mesh agrees.
  const harmonics = [];
  for (let k = 2; k <= 13; k++) {
    const amp = 1 / k ** 0.55;
    harmonics.push({ k, ax: amp * (0.4 + rng()), ay: amp * (0.5 + rng()), az: amp * (0.4 + rng()), px: rng() * TAU, py: rng() * TAU, pz: rng() * TAU });
  }
  const DNA_N = 640;
  const raw = [];
  for (let i = 0; i < DNA_N; i++) {
    const t = (i / DNA_N) * TAU;
    let x = 0; let y = 0; let z = 0;
    for (const h of harmonics) {
      x += h.ax * Math.sin(h.k * t + h.px);
      y += h.ay * Math.sin(h.k * t + h.py);
      z += h.az * Math.sin(h.k * t + h.pz);
    }
    raw.push([x, y, z]);
  }
  const span = (axis) => { let a = 1e9; let b = -1e9; for (const p of raw) { a = Math.min(a, p[axis]); b = Math.max(b, p[axis]); } return [a, b]; };
  const [xa, xb] = span(0); const [ya, yb] = span(1); const [za, zb] = span(2);
  const dnaPoints = raw.map(([x, y, z], ring) => {
    const coil = (ring / DNA_N) * TAU * 34;
    // Coiled on top of the wander, as a real bacterial chromosome is. A whole number of coils, so it still closes.
        let px = CX + mix(-LC - 0.28, LC + 0.1, (x - xa) / (xb - xa));
    let py = CY + mix(-0.6, 0.6, (y - ya) / (yb - ya));
    const pz = FACE + mix(0.07, 0.34, (z - za) / (zb - za)) + 0.02 * Math.sin((ring / DNA_N) * TAU * 34 + 1);
    px += 0.13 * Math.cos(coil); py += 0.13 * Math.sin(coil);
    for (const pl of PLASMID_AT) {
      const dx = px - pl.c[0]; const dy = py - pl.c[1]; const d = Math.hypot(dx, dy) || 1;
      const need = 0.34;
      if (d < need) { px = pl.c[0] + (dx / d) * need; py = pl.c[1] + (dy / d) * need; }
    }
    return [px, py, pz];
  });
  const dna = closedTube(dnaPoints, 0.032, 6);
  must(everyEdgeTwice(dna), 'the DNA loop is one closed tube with no ends');
  must(Math.hypot(raw[0][0] - raw[DNA_N - 1][0], raw[0][1] - raw[DNA_N - 1][1], raw[0][2] - raw[DNA_N - 1][2]) < 0.6, 'the DNA loop closes on itself');
  {
    const a = lin(0x2433d6); const b = lin(0x4f6cff);
    const arr = new Float32Array(dna.attributes.position.count * 3);
    for (let i = 0; i < arr.length / 3; i++) {
      const ring = Math.floor(i / 6);
      const c = ring % 8 < 4 ? a : b;
      arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2];
    }
    dna.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  inside.push({ geometry: dna, keepColor: true });

  // --- Two plasmids: small rings, closed for the same reason ---------------------------------------
  const plasmidTops = [];
  PLASMID_AT.forEach((pl, index) => {
    const pts = [];
    const n = 44;
    const r = 0.2;
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pl.tilt, pl.tilt * 0.7, pl.spin));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const q = r * (1 + 0.07 * Math.sin(a * 3 + index));
      const v = V(Math.cos(a) * q, Math.sin(a) * q, 0.016 * Math.sin(a * 5)).applyMatrix4(m);
      pts.push([pl.c[0] + v.x, pl.c[1] + v.y, FACE + 0.1 + v.z]);
    }
    const ring = closedTube(pts, 0.03, 7);
    must(everyEdgeTwice(ring), 'a plasmid is a closed ring');
    inside.push({ geometry: ring, color: 0xf01f8e });
    plasmidTops.push(pts[Math.floor(n * 0.75)]);
  });
  must(plasmidTops.length === 2, 'exactly two plasmids drawn');

  // --- Ribosomes: many, merged, half sunk in the cut face ------------------------------------------
  let ribosomes = 0;
  let tries = 0;
  const ribo = [];
  while (ribosomes < 280 && tries < 6000) {
    tries += 1;
    const x = LEFT - rho + rng() * (RIGHT - LEFT + 2 * rho);
    const y = CY + (rng() * 2 - 1) * rho;
    const dx = x < LEFT ? x - LEFT : x > RIGHT ? x - RIGHT : 0;
    if (Math.hypot(dx, y - CY) > rho - 0.09) continue;
    if (PLASMID_AT.some((pl) => Math.hypot(x - pl.c[0], y - pl.c[1]) < 0.28)) continue;
    if (ribo.some((p) => Math.hypot(p[0] - x, p[1] - y) < 0.1)) continue;
    const r = 0.04 + rng() * 0.016;
    ribo.push([x, y]);
    const g = new THREE.SphereGeometry(r, 7, 5);
    g.scale(1, 0.86, 0.8);
    g.translate(x, y, FACE + r * 0.3);
    inside.push({ geometry: g, color: rng() > 0.5 ? 0x7b2410 : 0x93351a });
    ribosomes += 1;
  }
  must(ribosomes >= 200, 'many ribosomes');

  // --- Pili: short hairs all over the outside, each with its root in the surface -----------------
  let pili = 0;
  const hair = [];
  while (pili < 170) {
    const s = 0.03 + rng() * 0.94;
    const phi = mix(B.OPEN.capsule + 0.09, TAU - B.OPEN.capsule - 0.09, rng());
    const a = capsulePoint(s, phi, B.CAPSULE[0] - 0.03);
    const e = capsulePoint(s, phi, B.CAPSULE[0] + 0.03);
    const n = V(e[0] - a[0], e[1] - a[1], e[2] - a[2]).normalize();
    const L = 0.24 + rng() * 0.26;
    const bend = V(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.3);
    const mid = [a[0] + n.x * L * 0.55 + bend.x * L * 0.5, a[1] + n.y * L * 0.55 + bend.y * L * 0.5, a[2] + n.z * L * 0.55 + bend.z * L * 0.5];
    const tip = [a[0] + n.x * L + bend.x * L, a[1] + n.y * L + bend.y * L, a[2] + n.z * L + bend.z * L];
    hair.push({ geometry: tube([a, mid, tip], [0.021, 0.015, 0.008], { sides: 4, steps: 4, round: 1 }), color: 0x8fd6bb });
    pili += 1;
  }

  // --- The flagellum: a basal body in the membrane, a hook, and a true helix -----------------------
  const POLE = RIGHT + B.CAPSULE[0];
  const axisRing = (x, r, h, color) => {
    const g = lathe([[0, 0], [r, 0], [r, h], [0, h]], 22);
    g.rotateZ(-Math.PI / 2);
    g.translate(x, CY, 0);
    inside.push({ geometry: g, color });
  };
  // The rod runs in from outside to below the membrane, where its motor sits. The rings are at the membrane, the
  // wall and the capsule's inner face, in the order they lie, and the wedge shows their front halves.
  const MEM = RIGHT + (B.MEMBRANE[0] + B.MEMBRANE[1]) / 2;
  const WAL = RIGHT + (B.WALL[0] + B.WALL[1]) / 2;
  inside.push({ geometry: rod([MEM - 0.36, CY, 0], [POLE + 0.12, CY, 0], 0.05, 10, 0), color: 0xc98a14 });
  axisRing(MEM - 0.36, 0.22, 0.12, 0xb9740f); // the motor below the membrane
  axisRing(MEM - 0.05, 0.17, 0.1, 0xefbe36); // the ring in the membrane
  axisRing(WAL - 0.04, 0.13, 0.08, 0xefbe36); // the ring in the wall
  axisRing(POLE - 0.17, 0.11, 0.08, 0xefbe36); // and through the outer layer

  const HELIX = { R: 0.24, PITCH: 1.08, TUBE: 0.045 };
  const END = 6.75;
  const flagPts = [];
  const S = 110;
  const X0 = POLE + 0.1;
  for (let i = 0; i <= S; i++) {
    const u = (i / S) * (END - X0 - HELIX.TUBE);
    const A = HELIX.R * sstep(u, 0.1, 0.75);
    // Left-handed, as an E. coli filament's normal form is: it turns the other way going away from the cell.
    const th = -(u / HELIX.PITCH) * TAU;
    flagPts.push([X0 + u, CY + A * Math.sin(th) + 0.0, A * Math.cos(th) - A]);
  }
  // The helix is built about its own axis, then its start is laid on the rod: A * cos(th) - A is 0 at u = 0.
  for (const p of flagPts) p[2] += HELIX.R * sstep(p[0] - X0, 0.1, 0.75);
  const fil = tube(flagPts, flagPts.map((_, i) => (i < 8 ? mix(0.068, HELIX.TUBE, i / 8) : mix(HELIX.TUBE, 0.03, sstep(i / S, 0.85, 1)))), { sides: 8, steps: S, round: 2 });
  const flagTurns = (END - X0) / HELIX.PITCH;
  must(flagTurns > 3.5, 'the flagellum makes several true turns');
  inside.push({ geometry: fil, color: 0xc98a14 });

  // --- Stands and base -----------------------------------------------------------------------------
  const BY = 0.18;
  stand.push({ geometry: block(-5.5, 0, -1.8, 5.5, BY, 2.75), color: 0x262c33 });
  for (const x of [CX - 2.0, CX + 2.0]) {
    const yFork = CY - B.CAPSULE[0] - 0.45;
    stand.push({ geometry: lathe([[0, 0], [0.42, 0], [0.42, 0.05], [0.14, 0.14], [0.07, 0.3], [0, 0.3]], 20).translate(x, BY, 0), color: 0x585e66 });
    stand.push({ geometry: rod([x, BY, 0], [x, yFork, 0], 0.07, 10, 1), color: 0x7f868e });
    for (const side of [-1, 1]) {
      const a = -Math.PI / 2 + side * 0.5;
      const r = B.CAPSULE[0] - 0.02;
      const tip = [x, CY + Math.sin(a) * r, Math.cos(a) * r];
      stand.push({ geometry: tube([[x, yFork, 0], [x, yFork + 0.12, side * 0.2], tip], 0.05, { sides: 8, steps: 8, round: 1 }), color: 0x7f868e });
    }
  }

  // --- Plates --------------------------------------------------------------------------------------
  const atlas = plateAtlas(['CELL WALL', 'MEMBRANE', 'DNA', 'PLASMID', 'RIBOSOMES', 'FLAGELLUM'], { W: 512, rowH: 104, ground: '#f0e7cf' });
  const rim = (r, phi, x) => [x, CY + r * Math.sin(phi), r * Math.cos(phi)];
  const lowDNA = dnaPoints.reduce((best, p) => (Math.abs(p[0] - (CX + 0.2)) < 0.35 && p[1] < best[1] ? p : best), [0, 1e9, 0]);
  const lowRibo = ribo.reduce((best, p) => (Math.abs(p[0] - (CX + 1.5)) < 0.3 && p[1] < best[1] ? p : best), [0, 1e9]);
  const FLAG_Y = 1.15; const FLAG_Z = 2.35; const W = 1.06; const H = 0.32;
  flagPlate(plates, stand, atlas.rects[0], { x: CX - 3.45, y: FLAG_Y, z: FLAG_Z, w: W, h: H, y0: BY, target: rim((B.WALL[0] + B.WALL[1]) / 2, TAU - B.OPEN.wall - 0.02, CX - 2.9) });
  flagPlate(plates, stand, atlas.rects[1], { x: CX - 2.1, y: FLAG_Y, z: FLAG_Z, w: W, h: H, y0: BY, target: rim((B.MEMBRANE[0] + B.MEMBRANE[1]) / 2, TAU - B.OPEN.membrane - 0.02, CX - 1.6) });
  flagPlate(plates, stand, atlas.rects[2], { x: CX - 0.8, y: FLAG_Y, z: FLAG_Z, w: 0.8, h: H, y0: BY, target: [lowDNA[0], lowDNA[1], lowDNA[2]], via: [lowDNA[0], lowDNA[1] + 0.03, 0.75] });
  flagPlate(plates, stand, atlas.rects[4], { x: CX + 0.75, y: FLAG_Y, z: FLAG_Z, w: W, h: H, y0: BY, target: [lowRibo[0], lowRibo[1], FACE + 0.02], via: [lowRibo[0], lowRibo[1] + 0.03, 0.75] });
  flagPlate(plates, stand, atlas.rects[3], { x: CX + 2.2, y: FLAG_Y, z: FLAG_Z, w: 0.9, h: H, y0: BY, target: plasmidTops[0], via: [plasmidTops[0][0], plasmidTops[0][1] + 0.03, 0.75] });
  const flagAt = flagPts[Math.floor(S * 0.5)];
  flagPlate(plates, stand, atlas.rects[5], { x: flagAt[0] - 0.4, y: FLAG_Y + 0.3, z: 1.2, w: W, h: H, y0: BY, target: flagAt });

  const root = new THREE.Group();
  root.add(mesh(mergeParts(shells), standard({ vertexColors: true, roughness: 0.6, metalness: 0 })));
  root.add(mesh(mergeParts([{ geometry: faceG, color: 0xdde4b6 }]), standard({ vertexColors: true, roughness: 0.85, metalness: 0 })));
  root.add(mesh(mergeParts([...inside, ...hair]), standard({ vertexColors: true, roughness: 0.42, metalness: 0 })));
  root.add(mesh(mergeParts(stand), standard({ vertexColors: true, roughness: 0.55, metalness: 0.1 })));
  root.add(mesh(mergeParts(plates), standard({ map: atlas.texture, roughness: 0.6, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Darwin's finches
// ---------------------------------------------------------------------------------------------

// One field, two densities. Each zone polygonises finely inside its box and the coarse pass over everything
// drops what those boxes cover: both walk their vertices onto one true surface and colour them from one function,
// so there is no seam, and a head can carry several times the triangles per square foot of the back behind it.
function zoned(build, coarseCell, zones, options = () => ({})) {
  const out = [];
  for (const zone of zones) {
    const s = build(zone.cell);
    out.push(polygonize(s, { ...options(s), bounds: zone.box }));
  }
  const s = build(coarseCell);
  const g = polygonize(s, options(s));
  const P = g.attributes.position;
  const idx = g.index;
  const inBox = (i, b) => {
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    return x > b[0] && x < b[3] && y > b[1] && y < b[4] && z > b[2] && z < b[5];
  };
  const kept = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t); const b = idx.getX(t + 1); const c = idx.getX(t + 2);
    if (zones.some((zone) => inBox(a, zone.box) && inBox(b, zone.box) && inBox(c, zone.box))) continue;
    kept.push(a, b, c);
  }
  g.setIndex(kept);
  out.push(g);
  return out;
}

// One flight feather: a closed flat solid with its length on +Z, its width on X and its upper face on +Y.
function featherGeo(L, W, { nu = 2, nv = 4, cup = 0.12, bend = 0, th = 0.01, round = true } = {}) {
  const profile = (v) => Math.min(1, (v / 0.14) ** 0.55) * Math.sqrt(Math.max(0.0015, 1 - v ** (round ? 5 : 3)));
  return solidSurface({
    nu, nv,
    point: (u, v) => {
      const U = u * 2 - 1;
      const w = (W / 2) * profile(v);
      return [U * w, -cup * W * U * U + bend * L * v * v, L * v];
    },
    thick: (u, v) => th * Math.max(0, 1 - (u * 2 - 1) ** 4) * Math.sin(Math.PI * clamp01(v)) ** 0.4,
    axis: [0, 1, 0],
  });
}

function placeFeather(geometry, root, dir, normal) {
  const end = [root[0] + dir.x, root[1] + dir.y, root[2] + dir.z];
  const { m } = alongMatrix(root, end, [normal.x, normal.y, normal.z]);
  return geometry.applyMatrix4(m);
}

// Barbs angled up from a pale shaft, near white so that a feather's own colour carries the hue.
function barbMap(seed) {
  return canvasTexture(128, 256, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#e4e4e4';
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1.3;
    for (let y = h + 60; y > -10; y -= 2.6) {
      for (const side of [1, -1]) {
        const v = 180 + Math.floor(rng() * 72);
        ctx.strokeStyle = `rgb(${v},${v},${v})`;
        ctx.beginPath();
        ctx.moveTo(w / 2, y);
        ctx.quadraticCurveTo(w / 2 + (side * w) / 4, y - 14, w / 2 + (side * w) / 2, y - 46);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#5c5c5c';
    ctx.fillRect(w / 2 - 2.4, 0, 4.8, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(w / 2 - 1.1, 0, 2.2, h);
  });
}

// The body's plumage: rows of overlapping feathers, near white so the vertex colour carries the hue, each with a
// dark tip-line and a shaft. Upper rows overlap lower ones, as on a bird. It tiles, and it drives the bump too.
function plumageMap(seed) {
  const tex = canvasTexture(512, 512, (ctx, W, H) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#b4b4b4';
    ctx.fillRect(0, 0, W, H);
    const rows = 10; const cols = 8;
    const fw = W / cols; const fh = H / rows;
    const table = [];
    for (let i = 0; i < rows * (cols + 2); i++) table.push([(rng() - 0.5) * 6, 226 + Math.floor(rng() * 29)]);
    // Painted top row last and bottom row first, so each row lies over the one below it. Row -1 is a copy of the bottom
    // row, painted last of all, which is what closes the overlap across the tile's seam.
    for (let r = rows - 1; r >= -1; r--) {
      const rr = (r + rows) % rows;
      for (let c = -1; c <= cols; c++) {
        const [jit, v] = table[rr * (cols + 2) + ((c + cols) % cols)];
        const x = (c + (rr % 2) * 0.5) * fw + jit;
        const y = r * fh;
        const grad = ctx.createLinearGradient(0, y, 0, y + fh * 1.5);
        grad.addColorStop(0, `rgb(${v - 12},${v - 12},${v - 12})`);
        grad.addColorStop(0.72, `rgb(${v},${v},${v})`);
        grad.addColorStop(1, `rgb(${v - 40},${v - 40},${v - 40})`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x - fw * 0.62, y);
        ctx.quadraticCurveTo(x - fw * 0.62, y + fh * 1.25, x, y + fh * 1.6);
        ctx.quadraticCurveTo(x + fw * 0.62, y + fh * 1.25, x + fw * 0.62, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(70,70,70,0.3)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, y + fh * 0.1);
        ctx.lineTo(x, y + fh * 1.2);
        ctx.stroke();
      }
    }
  });
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.7, 2.7);
  return tex;
}

// One half of a beak, from a table of its real measurements in feet. `sign` is +1 for the upper mandible
// and -1 for the lower. Its base runs back behind z = 0 into the head, so the join is an intersection of two
// solids and cannot show a gap. A closed solid, wound outward by measuring.
function mandible({ len, depth, width, curve = 0, hook = 0, p = 1.6, q = 1, wp = 1.6, wq = 1, sign = 1, back = 0.25 }, tone) {
  const n = 14; const M = 12;
  const positions = [];
  const index = [];
  const tomium = (t) => -curve * len * t * t - hook * len * sstep(t, 0.72, 1) ** 2;
  const colors = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const z = mix(-back * len, len, s);
    const t = clamp01(z / len);
    const e = t * 0.995;
    const H = depth * Math.max(0, 1 - e ** p) ** q;
    const W = width * Math.max(0, 1 - e ** wp) ** wq;
    const y0 = tomium(t);
    for (let j = 0; j < M; j++) {
      const a = (j / M) * TAU;
      const sa = Math.sin(a);
      const yy = y0 + sign * (sa >= 0 ? H * sa : H * 0.1 * sa);
      positions.push(W * Math.cos(a), yy, z);
      // Horn: paler along the ridge, darkening to the tip and down at the line where the two halves meet.
      const ridge = sa > 0 ? sa : 0;
      const k = mix(0.7, 1.12, ridge) * mix(1, 0.62, sstep(t, 0.55, 1));
      colors.push(tone[0] * k, tone[1] * k, tone[2] * k);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < M; j++) {
      const j2 = (j + 1) % M;
      const a = i * M + j; const b = i * M + j2; const c = (i + 1) * M + j2; const d = (i + 1) * M + j;
      index.push(a, b, c, a, c, d);
    }
  }
  const pole0 = positions.length / 3;
  positions.push(0, tomium(0), -back * len);
  colors.push(tone[0] * 0.6, tone[1] * 0.6, tone[2] * 0.6);
  const pole1 = positions.length / 3;
  positions.push(0, tomium(1), len * 1.01);
  colors.push(tone[0] * 0.5, tone[1] * 0.5, tone[2] * 0.5);
  for (let j = 0; j < M; j++) {
    const j2 = (j + 1) % M;
    index.push(pole0, j2, j, pole1, n * M + j, n * M + j2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  if (signedVolume(g) < 0) {
    for (let t = 0; t < index.length; t += 3) { const v = index[t + 1]; index[t + 1] = index[t + 2]; index[t + 2] = v; }
    g.setIndex(index);
  }
  g.computeVertexNormals();
  return g;
}

// Real measurements, in millimetres and centimetres. These are rounded typical values for each species, as
// published beak work on these birds gives them (Grant and others), multiplied here by the card's 8.
const MM_TO_FT = (8 * 1) / 304.8;
const FINCHES = [
  {
    key: 'large', name: 'LARGE GROUND FINCH', food: 'big hard seeds', cm: 16,
    beak: { len: 16, depth: 20, width: 17, p: 2.5, q: 0.72, wp: 2, wq: 0.8, curve: 0.13, split: 0.62 },
    top: 0x232327, belly: 0x2e2e32, wing: 0x2c2c30, horn: 0x5f5850, tail: 0.27,
  },
  {
    key: 'medium', name: 'MEDIUM GROUND FINCH', food: 'smaller seeds', cm: 12.5,
    beak: { len: 11, depth: 10, width: 9, p: 2, q: 0.85, wp: 1.8, wq: 0.85, curve: 0.11, split: 0.6 },
    top: 0x55473a, belly: 0xa79a84, wing: 0x3d3228, horn: 0x8f8268, streak: true, tail: 0.28,
  },
  {
    key: 'cactus', name: 'CACTUS FINCH', food: 'cactus flowers', cm: 14,
    beak: { len: 15, depth: 8.2, width: 7, p: 1.5, q: 0.95, wp: 1.3, wq: 0.9, curve: 0.2, split: 0.58 },
    top: 0x252528, belly: 0x303034, wing: 0x2e2e32, horn: 0x5f5850, vent: 0xb9b4a8, tail: 0.3,
  },
  {
    key: 'vegetarian', name: 'VEGETARIAN FINCH', food: 'leaves and buds', cm: 16,
    beak: { len: 10.5, depth: 12, width: 11, p: 2.2, q: 0.62, wp: 1.8, wq: 0.75, curve: 0.3, hook: 0.08, split: 0.66 },
    top: 0x232326, belly: 0xb2a386, wing: 0x2a2622, horn: 0x57504a, hood: true, tail: 0.3,
  },
  {
    key: 'warbler', name: 'WARBLER FINCH', food: 'small insects', cm: 10,
    beak: { len: 8.5, depth: 3.1, width: 3, p: 1.15, q: 1, wp: 1.1, wq: 1, curve: 0.05, split: 0.55 },
    top: 0x6f6d4b, belly: 0xb5ad86, wing: 0x4b4a33, horn: 0x35302a, tail: 0.3,
  },
];
const FINCH = { YAW: 0.9, HEAD_TURN: 0.42, PERCH_Y: 2.72, PERCH_HALF: 4.05 };

const perchAt = (x) => {
  const y = FINCH.PERCH_Y + 0.1 * Math.sin(x * 0.62 + 0.8) + 0.035 * Math.sin(x * 2.3);
  const z = 0.1 * Math.sin(x * 0.45 - 1.1);
  const r = 0.17 + 0.025 * Math.sin(x * 1.1) + 0.012 * Math.sin(x * 3.1 + 1);
  return { y, z, r };
};

function finchBird(spec, xB, parts) {
  const L = (spec.cm * 10 * MM_TO_FT);
  const k = L / 3.6;
  const psi = FINCH.YAW;
  const P = perchAt(xB);
  const m = new THREE.Matrix4().compose(V(xB, P.y + P.r - 0.02, P.z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), psi), V(1, 1, 1));
  const N = V(0, 1.02, 0.36).multiplyScalar(k); // where the neck turns
  const turn = new THREE.Matrix4().makeTranslation(N.x, N.y, N.z).multiply(new THREE.Matrix4().makeRotationY(FINCH.HEAD_TURN)).multiply(new THREE.Matrix4().makeTranslation(-N.x, -N.y, -N.z));
  const hp = (x, y, z) => { const v = V(x * k, y * k, z * k).applyMatrix4(turn); return [v.x, v.y, v.z]; };
  const headR = 0.315 * k * (spec.key === 'large' ? 1.1 : spec.key === 'warbler' ? 0.94 : 1);
  const H = hp(0, 1.31, 0.5);
  const white = [1, 1, 1];

  const build = (cell) => {
    const s = new Sculpt(cell);
    s.add(ellipsoidP([0, 0.64 * k, 0], [0.46 * k, 0.5 * k, 0.74 * k], [-0.62, 0, 0]), white);
    s.add(ellipsoidP([0, 0.76 * k, 0.2 * k], [0.45 * k, 0.48 * k, 0.5 * k]), white, { k: 0.2 * k });
    s.add(curveP([[0, 0.72 * k, -0.2 * k], [0, 0.5 * k, -0.52 * k], [0, 0.34 * k, -0.78 * k]], [0.36 * k, 0.24 * k, 0.11 * k], 10), white, { k: 0.16 * k });
    // The thighs, feathered down to the top of the bare leg.
    for (const q of [-1, 1]) s.add(ellipsoidP([q * 0.22 * k, 0.3 * k, 0.03 * k], [0.15 * k, 0.23 * k, 0.17 * k]), white, { k: 0.1 * k });
    // The neck and the head, on a turn.
    s.add(curveP([[0, 0.9 * k, 0.28 * k], hp(0, 1.1, 0.4), H], [0.34 * k, 0.3 * k, 0.26 * k], 8), white, { k: 0.18 * k });
    s.add(ellipsoidP(H, [headR * 0.96, headR, headR * 1.08], [0, FINCH.HEAD_TURN, 0]), white, { k: 0.12 * k });
    // The shoulder of the folded wing.
    for (const q of [-1, 1]) s.add(ellipsoidP([q * 0.38 * k, 0.78 * k, 0.05 * k], [0.14 * k, 0.32 * k, 0.44 * k], [-0.5, 0, 0]), white, { k: 0.08 * k });
    return s;
  };

  // Plumage: tone by which way a surface faces in the bird's own frame, so the belly is pale whichever way it is turned.
  const top = lin(spec.top); const belly = lin(spec.belly); const wingT = lin(spec.wing);
  const up = V(0, 0.84, -0.54).normalize();
  const tint = (x, y, z, nx, ny, nz, rgb) => {
    const d = nx * up.x + ny * up.y + nz * up.z;
    let t = 1 - sstep(d, -0.55, 0.18);
    const toHead = sstep(y, 0.95 * k, 1.12 * k);
    if (spec.hood) t *= (1 - toHead) * (1 - sstep(y + z * 0.5, 0.74 * k, 0.98 * k));
    rgb[0] = mix(top[0], belly[0], clamp01(t)); rgb[1] = mix(top[1], belly[1], clamp01(t)); rgb[2] = mix(top[2], belly[2], clamp01(t));
    // The vent is pale on the black cactus finch.
    if (spec.vent) { const v = lin(spec.vent); mixInto(rgb, v, sstep(-z, 0.5 * k, 0.8 * k) * sstep(-d, 0.2, 0.7)); }
    // The folded wing's shoulder takes the wing's tone, softly, over the same ellipsoid the shape used.
    {
      const dx = (Math.abs(x) - 0.38 * k) / (0.2 * k); const dy = y - 0.78 * k; const dz = z - 0.05 * k;
      const cr = Math.cos(0.5); const sr = Math.sin(0.5);
      const yy = (dy * cr - dz * sr) / (0.34 * k); const zz = (dy * sr + dz * cr) / (0.46 * k);
      mixInto(rgb, wingT, 0.7 * (1 - sstep(dx * dx + yy * yy + zz * zz, 0.55, 1.1)));
    }
    const n = 0.92 + 0.16 * smoothNoise3(x * 3.3 / k + xB, y * 3.3 / k, z * 3.3 / k);
    rgb[0] *= n; rgb[1] *= n; rgb[2] *= n;
  };
  const headBox = [H[0] - headR * 1.25, H[1] - headR * 1.15, H[2] - headR * 1.25, H[0] + headR * 1.25, H[1] + headR * 1.25, H[2] + headR * 1.35];
  const geos = zoned(build, 0.08 * k, [{ cell: 0.047 * k, box: headBox }], () => ({ tint, uvScale: 1, extraReach: 0.05 * k }));
  for (const g of geos) { g.applyMatrix4(m); parts.body.push({ geometry: g, keepColor: true }); }

  const field = build(0.05 * k).snapshot();
  const local = (geometry) => geometry.applyMatrix4(m);

  // --- Beak, from the table ------------------------------------------------------------------------
  const b = spec.beak;
  const bL = b.len * MM_TO_FT; const bD = b.depth * MM_TO_FT; const bW = (b.width * MM_TO_FT) / 2;
  const horn = lin(spec.horn);
  const upper = mandible({ len: bL, depth: bD * b.split, width: bW, curve: b.curve, hook: b.hook ?? 0, p: b.p, q: b.q, wp: b.wp, wq: b.wq, sign: 1 }, horn);
  const lower = mandible({ len: bL * 0.93, depth: bD * (1 - b.split), width: bW * 0.94, curve: b.curve * 0.9, p: b.p * 0.9, q: b.q, wp: b.wp, wq: b.wq, sign: -1 }, horn.map((c) => c * 0.86));
  // The beak's root is on the head's surface, on the head's forward line, a little below the eye.
  const dir = V(0, -0.2, 1).normalize();
  const root = V(H[0], H[1], H[2]).sub(V(0, 0, 0));
  const fwd = dir.clone().transformDirection(new THREE.Matrix4().makeRotationY(FINCH.HEAD_TURN));
  root.addScaledVector(fwd, headR * 0.92);
  const beakM = new THREE.Matrix4().compose(root, new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), fwd), V(1, 1, 1));
  for (const g of [upper, lower]) {
    g.applyMatrix4(beakM);
    g.applyMatrix4(m);
    parts.bare.push({ geometry: g, keepColor: true });
  }
  const eyeAt = (q) => {
    const d = V(q * 0.76, 0.2, 0.62).normalize().transformDirection(new THREE.Matrix4().makeRotationY(FINCH.HEAD_TURN));
    const c = V(H[0], H[1], H[2]).addScaledVector(d, headR * 0.93);
    const r = 0.066 * k;
    parts.bare.push({ geometry: local(ball([c.x, c.y, c.z], r, 12, 9)), color: 0x060505 });
    // One catch light, which is what makes an eye read as wet.
    // Sunk into the eye's own surface, so it reads as a reflection on it and not a bead stuck to it.
    const v = d.clone().add(V(0.32, 0.42, 0.22)).normalize();
    const h = c.clone().addScaledVector(v, r * 0.84);
    parts.bare.push({ geometry: local(ball([h.x, h.y, h.z], r * 0.22, 6, 5)), color: 0xf4f4f0 });
  };
  eyeAt(1); eyeAt(-1);

  // --- Wing and tail: real feathers, tone from the table --------------------------------------------
  const wingC = lin(spec.wing);
  const shaded = (g, rootP, len, c, edge = 1) => {
    tintVertices(g, (x, y, z, out) => {
      const d = Math.hypot(x - rootP[0], y - rootP[1], z - rootP[2]) / len;
      const q = mix(0.7, 1.12 * edge, sstep(d, 0, 0.8));
      out[0] = c[0] * q; out[1] = c[1] * q; out[2] = c[2] * q;
    });
    return g;
  };
  for (const q of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const seed = [q * 0.45 * k, mix(0.8, 0.52, t) * 1, mix(0.1, -0.24, t) * k];
      seed[1] *= k;
      const rootP = onSurface(field, seed, 0.012 * k, 8);
      const d = V(q * mix(-0.1, -0.2, t), mix(-0.32, -0.26, t), -0.94).normalize();
      const nrm = V(q, 0.28, 0).normalize();
      nrm.addScaledVector(d, -nrm.dot(d)).normalize();
      const len = mix(1.0, 0.62, t) * k;
      const g = placeFeather(featherGeo(len, 0.21 * k, { th: 0.012 * k, bend: 0.03 }), rootP, d, nrm);
      parts.flight.push({ geometry: local(shaded(g, rootP, len, wingC, spec.key === 'medium' || spec.key === 'warbler' ? 1.35 : 1.1)), keepColor: true });
    }
    // Greater coverts, closing the top of the wing.
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const seed = [q * 0.46 * k, mix(0.92, 0.62, t) * k, mix(0.26, -0.02, t) * k];
      const rootP = onSurface(field, seed, 0.02 * k, 8);
      const d = V(q * -0.08, -0.42, -0.9).normalize();
      const nrm = V(q, 0.25, 0).normalize();
      nrm.addScaledVector(d, -nrm.dot(d)).normalize();
      const len = 0.5 * k;
      const g = placeFeather(featherGeo(len, 0.2 * k, { th: 0.014 * k, nv: 3 }), rootP, d, nrm);
      parts.flight.push({ geometry: local(shaded(g, rootP, len, wingC, 1.25)), keepColor: true });
    }
  }
  // The tail, in line with the body and folded: the middle feathers lie on top and the outer ones under them.
  const tailLen = (spec.tail * L);
  for (let i = 0; i < 6; i++) {
    const f = (i - 2.5) / 2.5;
    const rootP = [f * 0.13 * k, (0.44 - Math.abs(f) * 0.02) * k, -0.66 * k + Math.abs(f) * 0.03 * k];
    const d = V(f * 0.13, -0.62, -0.77).normalize();
    const nrm = V(f * 0.2, 0.77, -0.62).normalize();
    nrm.addScaledVector(d, -nrm.dot(d)).normalize();
    const g = placeFeather(featherGeo(tailLen * (1 - Math.abs(f) * 0.04), 0.21 * k, { th: 0.014 * k, bend: 0.01, nv: 6 }), rootP, d, nrm);
    parts.flight.push({ geometry: local(shaded(g, rootP, tailLen, wingC, 1.25)), keepColor: true });
  }

  // --- Legs and feet: in world coordinates, because they have to grip a perch that is not the bird's ---
  const LEG = 0x201c19;
  const cosy = Math.cos(psi);
  for (const q of [-1, 1]) {
    const xF = xB + q * 0.2 * k * cosy;
    const pf = perchAt(xF);
    const ankle = [xF, pf.y + pf.r + 0.1 * k, pf.z];
    const hip = V(q * 0.22 * k, 0.26 * k, 0.03 * k).applyMatrix4(m);
    parts.bare.push({ geometry: tube([[hip.x, hip.y, hip.z], [mix(hip.x, ankle[0], 0.55), mix(hip.y, ankle[1], 0.55), mix(hip.z, ankle[2], 0.55) + 0.02], ankle], [0.04 * k, 0.028 * k, 0.03 * k], { sides: 6, steps: 5, round: 1 }), color: LEG });
    // Three toes forward, one back, each following the perch's own round section and ending in a claw.
    const toe = (dx, from, to) => {
      const pts = [];
      const n = 4;
      for (let i = 0; i <= n; i++) {
        const a = mix(from, to, i / n);
        const x = xF + dx * (0.25 + 0.75 * (i / n));
        const pp = perchAt(x);
        const rr = pp.r + 0.022 * k;
        pts.push([x, pp.y + Math.cos(a) * rr, pp.z + Math.sin(a) * rr]);
      }
      pts.unshift([ankle[0], ankle[1] - 0.02 * k, ankle[2]]);
      parts.bare.push({ geometry: tube(pts, pts.map((_, i) => mix(0.03, 0.018, i / pts.length) * k), { sides: 5, steps: 8, round: 1 }), color: LEG });
      const last = pts[pts.length - 1];
      const a = to + Math.sign(to) * 0.38;
      const pp = perchAt(x0OfToe(last));
      const clawEnd = [last[0] + dx * 0.04, pp.y + Math.cos(a) * (pp.r + 0.005), pp.z + Math.sin(a) * (pp.r + 0.005)];
      parts.bare.push({ geometry: tube([last, [(last[0] + clawEnd[0]) / 2, (last[1] + clawEnd[1]) / 2, (last[2] + clawEnd[2]) / 2 + Math.sign(to) * 0.012], clawEnd], [0.018 * k, 0.012 * k, 0], { sides: 4, steps: 3, round: 0 }), color: 0x0d0b0a });
    };
    const x0OfToe = (p) => p[0];
    toe(-0.1 * k, 0.05, 1.3);
    toe(0, 0.05, 1.5);
    toe(0.1 * k, 0.05, 1.3);
    toe(0, -0.05, -1.25);
  }
  return { L, k };
}

// Food for one bird, sitting on the sand at (cx, cz).
function finchFood(kind, cx, cz, groundAt, food, rng) {
  const y = groundAt(cx, cz);
  const push = (geometry, color) => food.push({ geometry, color });
  const lumpy = (c, s, seed, color) => {
    const g = new THREE.SphereGeometry(1, 10, 8);
    const Q = g.attributes.position;
    for (let i = 0; i < Q.count; i++) {
      const a = Q.getX(i); const b = Q.getY(i); const d = Q.getZ(i);
      const n = 1 + 0.28 * (smoothNoise3(a * 1.6 + seed, b * 1.6, d * 1.6) - 0.5);
      Q.setXYZ(i, c[0] + a * s[0] * n, c[1] + b * s[1] * n, c[2] + d * s[2] * n);
    }
    g.computeVertexNormals();
    push(g, color);
  };
  if (kind === 'large') {
    // Big hard seeds: pointed, ridged, and spread out so each can be seen, far bigger than the small seeds next door.
    const SEEDS = 7;
    for (let i = 0; i < SEEDS; i++) {
      const a = (i / (SEEDS - 1)) * TAU;
      const r = i === SEEDS - 1 ? 0 : 0.36;
      const x = cx + Math.cos(a) * r; const z = cz + Math.sin(a) * r * 0.72;
      const s = 0.2 + (i % 3) * 0.018;
      const g = lathe([[0, -1], [0.34, -0.86], [0.62, -0.4], [0.68, 0], [0.5, 0.5], [0.22, 0.86], [0, 1.08]], 10);
      tintVertices(g, (px, py, pz, out) => {
        // Ridges running tip to tip, which is what a hard seed coat looks like up close.
        const ridge = 0.72 + 0.38 * Math.abs(Math.sin(Math.atan2(pz, px) * 3));
        const c = i % 2 ? lin(0x84612f) : lin(0x6a4a24);
        const k = ridge * mix(1, 1.3, sstep(py, 0.5, 1));
        out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
      });
      g.scale(s, s, s);
      g.rotateZ(1.25 + i * 0.5);
      g.rotateY(i * 1.3);
      g.translate(x, groundAt(x, z) + s * 0.56, z);
      food.push({ geometry: g, keepColor: true });
    }
  } else if (kind === 'medium') {
    for (let i = 0; i < 30; i++) {
      const a = rng() * TAU; const r = Math.sqrt(rng()) * 0.5;
      const x = cx + Math.cos(a) * r; const z = cz + Math.sin(a) * r * 0.75;
      const g = new THREE.SphereGeometry(1, 6, 4);
      g.scale(0.062, 0.04, 0.044);
      g.rotateY(rng() * TAU);
      g.translate(x, groundAt(x, z) + 0.032, z);
      push(g, rng() > 0.5 ? 0x8a6a3a : 0x6d5230);
    }
  } else if (kind === 'cactus') {
    // A prickly-pear pad with a yellow flower on its top edge, which is what the cactus finch feeds at.
    const pad = new THREE.SphereGeometry(1, 16, 12);
    pad.scale(0.42, 0.56, 0.12);
    pad.rotateY(-0.5);
    pad.translate(cx, y + 0.5, cz);
    tintVertices(pad, (a, b, c, out) => { const k = 0.9 + 0.2 * smoothNoise3(a * 6, b * 6, c * 6); out[0] = 0.13 * k; out[1] = 0.31 * k; out[2] = 0.09 * k; });
    food.push({ geometry: pad, keepColor: true });
    // A second, younger pad growing from the first, which is what makes it a prickly pear rather than an egg.
    const pad2 = new THREE.SphereGeometry(1, 12, 9);
    pad2.scale(0.25, 0.34, 0.08);
    pad2.rotateZ(-0.8);
    pad2.rotateY(-0.5);
    pad2.translate(cx + 0.46, y + 0.52, cz - 0.24);
    tintVertices(pad2, (a, b, c, out) => { const k = 0.9 + 0.2 * smoothNoise3(a * 6, b * 6, c * 6); out[0] = 0.17 * k; out[1] = 0.38 * k; out[2] = 0.1 * k; });
    food.push({ geometry: pad2, keepColor: true });
    // Spine clusters.
    for (let i = 0; i < 16; i++) {
      const a = rng() * TAU; const r = Math.sqrt(rng()) * 0.85;
      const dx = Math.cos(a) * r; const dy = Math.sin(a) * r;
      const lz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
      const base = V(dx * 0.42, dy * 0.56, lz * 0.12).applyAxisAngle(V(0, 1, 0), -0.5).add(V(cx, y + 0.5, cz));
      const out = V(dx * 0.3, dy * 0.3, 1).normalize().applyAxisAngle(V(0, 1, 0), -0.5);
      push(rod([base.x - out.x * 0.01, base.y - out.y * 0.01, base.z - out.z * 0.01], [base.x + out.x * 0.08, base.y + out.y * 0.08, base.z + out.z * 0.08], [0.009, 0.001], 4, 0), 0xd9d3b4);
    }
    const FY = y + 1.04;
    const petal = (a, lean, L, W, color) => {
      const dir = V(Math.cos(a) * Math.sin(lean), Math.cos(lean), Math.sin(a) * Math.sin(lean));
      const side = V(-Math.sin(a), 0, Math.cos(a));
      const nrm = V().crossVectors(side, dir).normalize();
      const g = solidSurface({
        nu: 4, nv: 4,
        point: (u, v) => {
          const U = u * 2 - 1;
          const w = W * Math.sin(Math.PI * Math.min(1, v * 0.92 + 0.08)) ** 0.7 * (1 - 0.15 * v);
          const c = [cx + dir.x * L * v + side.x * U * w + nrm.x * U * U * 0.03, FY + dir.y * L * v + side.y * U * w + nrm.y * U * U * 0.03, cz + dir.z * L * v + side.z * U * w + nrm.z * U * U * 0.03];
          return c;
        },
        thick: () => 0.012,
        axis: [nrm.x, nrm.y, nrm.z],
      });
      food.push({ geometry: g, color });
    };
    for (let i = 0; i < 9; i++) petal((i / 9) * TAU, 1.08, 0.36, 0.13, 0xf2c322);
    for (let i = 0; i < 8; i++) petal(((i + 0.5) / 8) * TAU, 0.62, 0.3, 0.11, 0xf6d640);
    push(ball([cx, FY - 0.05, cz], [0.16, 0.14, 0.15], 10, 8), 0x3e6b1e);
    for (let i = 0; i < 26; i++) {
      const a = rng() * TAU; const r = 0.03 + rng() * 0.08;
      push(rod([cx + Math.cos(a) * r * 0.5, FY + 0.04, cz + Math.sin(a) * r * 0.5], [cx + Math.cos(a) * r, FY + 0.17 + rng() * 0.05, cz + Math.sin(a) * r], 0.007, 4, 1), 0xe89d18);
    }
    push(rod([cx, FY, cz], [cx, FY + 0.27, cz], 0.022, 6, 1), 0x8abf4a);
  } else if (kind === 'vegetarian') {
    // A cut twig leaning on the sand with its buds and first leaves, which is what this bird strips.
    const A = [cx - 0.55, y + 0.05, cz + 0.1]; const C = [cx + 0.55, y + 0.5, cz - 0.1];
    const Mid = [cx, y + 0.34, cz + 0.05];
    const stemPts = [A, Mid, C];
    push(tube(stemPts, [0.04, 0.03, 0.02], { sides: 7, steps: 10, round: 1 }), 0x5c432a);
    const curve = new THREE.CatmullRomCurve3(stemPts.map((p) => V(...p)));
    const budAt = [0.18, 0.34, 0.5, 0.66, 0.82, 1];
    budAt.forEach((t, i) => {
      const p = curve.getPoint(t);
      const a = i * 2.4;
      const d = V(Math.cos(a) * 0.55, 0.75, Math.sin(a) * 0.55).normalize();
      if (i === budAt.length - 1) d.set(0.8, 0.5, 0).normalize();
      const s = i < 4 ? 0.1 : 0.12;
      const g = lathe([[0, 0], [s * 0.55, s * 0.2], [s * 0.6, s * 0.7], [s * 0.34, s * 1.5], [0.002, s * 2.2], [0, s * 2.2]], 9);
      g.applyMatrix4(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d), V(1, 1, 1)));
      push(g, i % 2 ? 0x8fbb3c : 0x76a52e);
    });
    for (const t of [0.42, 0.74]) {
      const p = curve.getPoint(t);
      const a = t * 9;
      const dir = V(Math.cos(a) * 0.8, 0.55, Math.sin(a) * 0.8 + 0.25).normalize();
      const side = V(0, 1, 0).cross(dir).normalize();
      const nrm = dir.clone().cross(side).normalize();
      const g = solidSurface({
        nu: 4, nv: 5,
        point: (u, v) => {
          const U = u * 2 - 1;
          const w = 0.13 * Math.sin(Math.PI * Math.min(1, v * 0.96 + 0.04)) ** 0.85;
          return [p.x + dir.x * 0.42 * v + side.x * U * w + nrm.x * (-0.05 * U * U), p.y + dir.y * 0.42 * v + side.y * U * w + nrm.y * (-0.05 * U * U), p.z + dir.z * 0.42 * v + side.z * U * w + nrm.z * (-0.05 * U * U)];
        },
        thick: () => 0.008,
        axis: [nrm.x, nrm.y, nrm.z],
      });
      food.push({ geometry: g, color: 0x6fa02e });
    }
  } else {
    // A dead leaf with insects on it: two caterpillars and two small beetles, which is what a thin probing beak picks off.
    const leafY = y + 0.03;
    const g = solidSurface({
      nu: 8, nv: 8,
      point: (u, v) => {
        const U = u * 2 - 1;
        const w = 0.32 * Math.sin(Math.PI * Math.min(1, v * 0.97 + 0.03)) ** 0.8;
        return [cx - 0.5 + v * 1.0, leafY + 0.02 + 0.03 * Math.sin(v * 7) * U, cz + U * w];
      },
      thick: () => 0.012,
      axis: [0, 1, 0],
    });
    food.push({ geometry: g, color: 0x8f6a35 });
    const cater = (x0, z0, a, color) => {
      const ca = Math.cos(a); const sa = Math.sin(a);
      for (let i = 0; i < 6; i++) {
        const u = (i - 2.5) * 0.058;
        const px = x0 + ca * u; const pz = z0 + sa * u + 0.018 * Math.sin(i * 1.4);
        push(ball([px, leafY + 0.075 + 0.012 * Math.sin(i * 1.2), pz], 0.046 - Math.abs(i - 2.5) * 0.004, 8, 6), i === 5 ? 0x2f2a14 : color);
      }
    };
    cater(cx - 0.18, cz + 0.05, 0.5, 0x7fae28);
    cater(cx + 0.22, cz - 0.08, -0.7, 0x98b92f);
    const beetle = (x0, z0, a) => {
      const ca = Math.cos(a); const sa = Math.sin(a);
      push(ball([x0, leafY + 0.07, z0], [0.066, 0.045, 0.092], 9, 6).rotateY(a).translate(x0 - (x0 * Math.cos(a) + z0 * Math.sin(a)), 0, z0 - (-x0 * Math.sin(a) + z0 * Math.cos(a))), 0x25190f);
      push(ball([x0 + sa * 0.095, leafY + 0.06, z0 + ca * 0.095], 0.032, 7, 5), 0x120c08);
      for (const q of [-1, 1]) {
        for (const t of [-0.05, 0, 0.05]) {
          const ax = x0 + sa * t + ca * q * 0.05; const az = z0 + ca * t - sa * q * 0.05;
          push(rod([ax, leafY + 0.06, az], [ax + ca * q * 0.06, leafY + 0.025, az - sa * q * 0.06], 0.008, 4, 1), 0x120c08);
        }
      }
    };
    beetle(cx + 0.02, cz + 0.16, 1.1);
    beetle(cx - 0.05, cz - 0.15, -0.5);
  }
}

function darwinsFinches() {
  must(FINCHES.length === 5, 'exactly five finches');
  const rng = seededRandom(1835);
  const parts = { body: [], flight: [], bare: [] };
  const wood = [];
  const ground = [];
  const food = [];
  const plates = [];

  // --- Where each bird stands. Their bodies run across the perch at an angle, so the room each one needs along
  // it is set by the parallel distance between neighbouring bodies, not by their length. ---------------------
  const widths = FINCHES.map((s) => ((s.cm * 10 * MM_TO_FT) / 3.6) * 0.98);
  const gaps = [];
  for (let i = 0; i < 4; i++) gaps.push(((widths[i] + widths[i + 1]) / 2 + 0.06) / Math.cos(FINCH.YAW));
  const need = gaps.reduce((a, b) => a + b, 0);
  must(need < FINCH.PERCH_HALF * 2 - 0.8, `the five birds fit on the perch without touching (${need.toFixed(2)})`);
  const slack = (FINCH.PERCH_HALF * 2 - 1.15 - need) / 4;
  const xs = [-FINCH.PERCH_HALF + 0.42];
  for (let i = 0; i < 4; i++) xs.push(xs[i] + gaps[i] + slack);
  const shift = -(xs[0] + xs[4]) / 2 - 0.15;
  const birdsAt = xs.map((x) => x + shift);

  let birds = 0;
  FINCHES.forEach((spec, i) => { finchBird(spec, birdsAt[i], parts); birds += 1; });
  must(birds === 5, 'five birds drawn');

  // --- The driftwood -------------------------------------------------------------------------------
  const woodUV = (g, axis) => {
    const P = g.attributes.position;
    const uv = new Float32Array(P.count * 2);
    for (let i = 0; i < P.count; i++) {
      if (axis === 'x') { uv[i * 2] = P.getX(i) * 0.3; uv[i * 2 + 1] = P.getY(i) * 1.1 + P.getZ(i) * 1.1; }
      else { uv[i * 2] = P.getY(i) * 0.3; uv[i * 2 + 1] = P.getX(i) * 1.1 + P.getZ(i) * 1.1; }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  };
  const silver = (g) => tintVertices(g, (x, y, z, out) => {
    const n = smoothNoise3(x * 0.9 + 3, y * 2.1, z * 2.1);
    const k = 0.78 + 0.5 * n;
    out[0] = 0.27 * k; out[1] = 0.235 * k; out[2] = 0.19 * k;
  });
  const perchPts = []; const perchR = [];
  for (let i = 0; i <= 26; i++) {
    const x = mix(-FINCH.PERCH_HALF, FINCH.PERCH_HALF, i / 26);
    const p = perchAt(x);
    perchPts.push([x, p.y, p.z]);
    perchR.push(p.r * (i === 0 || i === 26 ? 0.72 : 1));
  }
  must(Math.abs(FINCH.PERCH_HALF * 2 - 8) < 0.5, 'the perch is about 8ft wide');
  wood.push({ geometry: woodUV(silver(tube(perchPts, perchR, { sides: 14, steps: 66, round: 2 })), 'x'), keepColor: true });
  // A snapped branch stub, and a knot, so it is a piece of a tree.
  for (const [x, ax, ay, L, r] of [[-1.05, -0.4, -0.7, 0.45, 0.075], [2.15, 0.3, -0.85, 0.34, 0.06], [0.45, -0.1, -1, 0.26, 0.05]]) {
    const p = perchAt(x);
    wood.push({ geometry: woodUV(silver(tube([[x, p.y, p.z], [x + ax * L * 0.6, p.y + ay * L * 0.6, p.z - 0.05], [x + ax * L, p.y + ay * L, p.z - 0.08]], [r * 1.6, r, r * 0.45], { sides: 8, steps: 6, round: 1 })), 'y'), keepColor: true });
  }
  // Two forked posts, with the perch lying in the crotch.
  const BY = 0.26;
  for (const x of [-3.62, 3.62]) {
    const p = perchAt(x);
    const crotch = p.y - p.r - 0.22;
    const baseP = [x + 0.05, BY - 0.08, p.z - 0.05];
    wood.push({ geometry: woodUV(silver(tube([baseP, [x - 0.04, (BY + crotch) / 2, p.z], [x, crotch, p.z]], [0.2, 0.15, 0.135], { sides: 12, steps: 12, round: 1 })), 'y'), keepColor: true });
    wood.push({ geometry: woodUV(silver(ball([x, crotch, p.z], [0.165, 0.2, 0.17], 12, 9)), 'y'), keepColor: true });
    for (const side of [-1, 1]) {
      wood.push({ geometry: woodUV(silver(tube([[x, crotch, p.z], [x + side * 0.015, crotch + 0.28, p.z + side * 0.25], [x + side * 0.05, p.y + p.r * 0.75, p.z + side * (p.r + 0.08)]], [0.115, 0.09, 0.05], { sides: 9, steps: 8, round: 1 })), 'y'), keepColor: true });
    }
  }

  // --- The low sandy base -------------------------------------------------------------------------
  const BX = 4.85; const BZ0 = -1.75; const BZ1 = 3.05;
  const dune = (x, z) => BY + 0.05 * Math.sin(x * 1.3 + 0.4) * Math.cos(z * 1.7) + 0.022 * Math.sin(x * 4.1 + z * 3.3);
  const sandUV = (i, j) => [i * 0.2, j * 0.2];
  const NX = 36; const NZ = 16;
  const sand = gridSolid(NX, NZ,
    (i, j) => { const x = mix(-BX, BX, i / NX); const z = mix(BZ0, BZ1, j / NZ); return [x, dune(x, z), z]; },
    (i, j) => [mix(-BX, BX, i / NX), 0, mix(BZ0, BZ1, j / NZ)],
    { crease: 30, uvTop: sandUV });
  tintVertices(sand, (x, y, z, out) => {
    const k = 0.84 + 0.34 * smoothNoise3(x * 2.1, 1, z * 2.1);
    if (y < BY - 0.1) { out[0] = 0.12; out[1] = 0.09; out[2] = 0.07; return; }
    out[0] = 0.36 * k; out[1] = 0.27 * k; out[2] = 0.16 * k;
  });
  ground.push({ geometry: sand, keepColor: true });
  // Dark lava pebbles, since these are volcanic islands.
  for (let i = 0; i < 28; i++) {
    const x = mix(-BX + 0.2, BX - 0.2, rng()); const z = mix(BZ0 + 0.2, BZ1 - 0.2, rng());
    const s = 0.035 + rng() * 0.05;
    const g = new THREE.SphereGeometry(1, 6, 4);
    g.scale(s, s * 0.6, s * 0.8);
    g.translate(x, dune(x, z) + s * 0.3, z);
    ground.push({ geometry: g, color: rng() > 0.5 ? 0x2a2622 : 0x3a342e });
  }

  // --- Each bird's food, in front of it, and its plate -----------------------------------------------
  const atlas = plateAtlas(FINCHES.map((s) => `${s.name}|${s.food}`), { W: 512, rowH: 128, ground: '#f0e7cf' });
  const P_W = 1.56; const P_H = 0.42;
  const foodX = [];
  FINCHES.forEach((spec, i) => {
    const cx = birdsAt[i] + 0.4;
    foodX.push(cx);
    finchFood(spec.key, cx, 1.6, dune, food, rng);
    const g = printedPlate(P_W, P_H, 0.24, atlas.rects[i]);
    g.applyMatrix4(new THREE.Matrix4().compose(V(cx, BY + 0.14, 2.62), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.82, 0, 0)), V(1, 1, 1)));
    plates.push({ geometry: g, keepColor: true });
  });
  for (let i = 0; i < 4; i++) must(foodX[i + 1] - foodX[i] > P_W + 0.02, 'the plates do not overlap');

  const root = new THREE.Group();
  const plume = plumageMap(83);
  root.add(mesh(mergeParts(parts.body), standard({ vertexColors: true, map: plume, bumpMap: plume, bumpScale: 0.3, roughness: 0.86, metalness: 0 })));
  root.add(mesh(mergeParts(parts.flight), standard({ vertexColors: true, map: barbMap(31), roughness: 0.68, metalness: 0 })));
  root.add(mesh(mergeParts(parts.bare), standard({ vertexColors: true, roughness: 0.34, metalness: 0 })));
  const grain = grainBump(37, { size: 256, dots: 1400, min: 1, max: 3, contrast: 0.6 });
  grain.repeat.set(1, 1);
  root.add(mesh(mergeParts(wood), standard({ vertexColors: true, bumpMap: woodGrain(11), bumpScale: 2.2, roughness: 0.88, metalness: 0 })));
  root.add(mesh(mergeParts([...ground, ...food]), standard({ vertexColors: true, bumpMap: grain, bumpScale: 0.4, roughness: 0.8, metalness: 0 })));
  root.add(mesh(mergeParts(plates), standard({ map: atlas.texture, roughness: 0.6, metalness: 0 })));
  return root;
}

// Lengthwise cracks and checks, for wood that has been in the sea and the sun.
function woodGrain(seed) {
  const tex = canvasTexture(512, 256, (ctx, W, H) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#909090';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 300; i++) {
      const y = rng() * H; const x = rng() * W; const len = 60 + rng() * 240;
      const v = rng() > 0.55 ? 40 + rng() * 50 : 150 + rng() * 60;
      ctx.strokeStyle = `rgb(${v},${v},${v})`;
      ctx.lineWidth = 0.8 + rng() * 2.4;
      for (const ox of [-W, 0, W]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y);
        ctx.quadraticCurveTo(x + ox + len / 2, y + (rng() - 0.5) * 8, x + ox + len, y + (rng() - 0.5) * 6);
        ctx.stroke();
      }
    }
  });
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Mushroom and mycelium
// ---------------------------------------------------------------------------------------------

const MUSH = {
  HX: 3.2,
  Z0: -5.0,
  ZC: 4.5, // the clean cut
  G: 3.0, // the ground, 3ft above the bottom of the block
  LX: -0.4, LY: 3.95, LR: 1.5, // the log, lying along Z with its end in the cut
  LOG_BACK: -4.6,
  FACE_TOP: 5.95, // how much of the plane the painting covers
  // The one mushroom the cut runs through. Its axis is this far behind the plane, so the plane crosses the stem off
  // centre and goes through the gills across their width, which is what shows them in section as a comb.
  SLICE: { x: 1.92, H: 2.35, Rc: 0.88, e: 0.09 },
};

const groundH = (x, z) => MUSH.G + 0.05 * Math.sin(x * 1.7 + 1) * Math.cos(z * 1.1) + 0.03 * Math.sin(x * 3.7 + z * 2.3) + 0.02 * Math.sin(z * 4.3 - x);

// A mushroom's cap as two curves in (radius, height above its rim). One description, used for the solid, the gills and
// the painted section, so the three cannot disagree.
const capTop = (r, Rc, Hc) => Hc * Math.max(0, 1 - (r / Rc) ** 2.3) ** 0.62;
const capUnder = (r, Rc, Hc) => 0.2 * Hc * Math.max(0, 1 - (r / Rc) ** 1.6) + 0.012 * Hc;
const gillDepth = (r, r0, Rc, Dm) => Dm * Math.max(0.04, Math.sin(Math.PI * clamp01((r - r0 * 0.7) / (Rc - r0 * 0.7))) ** 0.6);

// How many gills a cap carries, by the rule that sets it. Only so many fit round the stem, so that many reach it. Shorter gills
// are then inserted between them, doubling each time, until the spacing at the rim comes down to what a gill needs.
export function gillPlan(Rc, stemR, spacing = 0.075) {
  const nLong = Math.max(8, Math.round((TAU * (stemR * 1.5)) / 0.09));
  const m = Math.max(0, Math.round(Math.log2((TAU * Rc) / (spacing * nLong))));
  return { nLong, m, total: nLong * 2 ** m };
}

function mushroomCap(parts, m, Rc, Hc, opts, rng, clip = null) {
  // --- The cap ------------------------------------------------------------------------------------
  const prof = [[0, capUnder(0, Rc, Hc)]];
  const NR = 7;
  for (let i = 1; i <= NR; i++) { const r = (i / NR) * Rc * 0.985; prof.push([r, capUnder(r, Rc, Hc)]); }
  prof.push([Rc, 0.012 * Hc]);
  for (let i = 1; i <= 9; i++) { const r = Rc * (1 - (i / 9) ** 1.3 * 1); const rr = Math.min(r, Rc * 0.995); prof.push([rr, capTop(rr, Rc, Hc) + 0.012 * Hc]); }
  prof[prof.length - 1][0] = 0;
  const seed = rng() * 50;
  const cap = lathe(prof, 30);
  const HONEY = lin(0xc98d2e); const DARK = lin(0x7c4f1c); const GOLD = lin(0xdfa945); const CREAM = lin(0xe7d7ad);
  tintVertices(cap, (x, y, z, out) => {
    const r = Math.hypot(x, z) / Rc;
    if (y < capUnder(Math.min(Rc, Math.hypot(x, z)), Rc, Hc) + 0.015 * Hc && r < 0.985) { out[0] = CREAM[0] * 0.72; out[1] = CREAM[1] * 0.72; out[2] = CREAM[2] * 0.72; return; }
    const streak = 0.5 + 0.5 * Math.sin(Math.atan2(z, x) * 13 + seed + 2 * Math.sin(r * 5));
    const t = sstep(r, 0.15, 0.85);
    out[0] = mix(DARK[0], mix(HONEY[0], GOLD[0], streak * 0.6), t);
    out[1] = mix(DARK[1], mix(HONEY[1], GOLD[1], streak * 0.6), t);
    out[2] = mix(DARK[2], mix(HONEY[2], GOLD[2], streak * 0.6), t);
  });
  cap.applyMatrix4(m);
  parts.push({ geometry: clip !== null ? clipZ(cap, clip) : cap, keepColor: true });

  // --- Small dark scales, denser toward the middle, each sunk into the cap ------------------------
  for (let i = 0; i < opts.scales; i++) {
    const r = Rc * 0.72 * Math.sqrt(rng()) ** 1.5;
    const a = rng() * TAU;
    const h = capTop(r, Rc, Hc) + 0.012 * Hc;
    const s = 0.024 + rng() * 0.022;
    const e = 0.02;
    const slope = (capTop(r + e, Rc, Hc) - capTop(Math.max(0, r - e), Rc, Hc)) / (r > e ? 2 * e : e + r);
    const n = V(-slope * Math.cos(a), 1, -slope * Math.sin(a)).normalize();
    const g = new THREE.SphereGeometry(1, 5, 3);
    g.scale(s, s * 0.34, s * 0.7);
    g.applyMatrix4(new THREE.Matrix4().compose(V(r * Math.cos(a), h, r * Math.sin(a)), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n), V(1, 1, 1)));
    g.applyMatrix4(m);
    parts.push({ geometry: clip !== null ? clipZ(g, clip) : g, color: 0x5e3b16 });
  }

  // --- The gills, one thin solid each, truly radial -----------------------------------------------
  const plan = gillPlan(Rc, opts.stemR);
  const Dm = opts.gillD;
  const THICK = 0.0115;
  const gillColor = (k) => new THREE.Color(0xd8c390).multiplyScalar(0.88 + 0.16 * Math.sin(k * 7.3) * Math.sin(k * 7.3));
  const makeGill = (r0, r1, stations) => gridSolid(stations, 1,
    (i, j) => {
      const r = mix(r0, r1, i / stations);
      const u = capUnder(Math.min(r, Rc * 0.995), Rc, Hc);
      const y = j === 0 ? u + 0.012 : u - gillDepth(r, opts.r0 ?? opts.stemR, Rc, Dm);
      return [r, y, THICK * (j === 0 ? 1.1 : 0.45)];
    },
    (i, j) => {
      const r = mix(r0, r1, i / stations);
      const u = capUnder(Math.min(r, Rc * 0.995), Rc, Hc);
      const y = j === 0 ? u + 0.012 : u - gillDepth(r, opts.r0 ?? opts.stemR, Rc, Dm);
      return [r, y, -THICK * (j === 0 ? 1.1 : 0.45)];
    }, { crease: 25 });
  const rStem = opts.stemR * 0.86;
  const templates = {};
  const levelOf = (k) => { let lv = 0; let n = k; while (lv < plan.m && n % 2 === 0) { n /= 2; lv += 1; } return plan.m - lv; }; // 0 reaches the stem
  const startOf = (lv) => (lv === 0 ? rStem : mix(rStem, Rc * 0.96, 1 - 0.56 ** lv));
  let drawn = 0;
  for (let k = 0; k < plan.total; k++) {
    const lv = levelOf(k);
    const theta = ((k + 0.5) / plan.total) * TAU;
    const r0 = startOf(lv);
    let g;
    if (clip !== null) {
      // The cut plane stands opts.e in front of the axis. A gill whose far part would cross it ends exactly on it.
      const s = Math.sin(theta);
      if (s > 0 && opts.e / s < Rc * 0.985) {
        const rEnd = opts.e / s;
        drawn += 1;
        if (rEnd - r0 < 0.03) continue;
        g = makeGill(r0, rEnd, 3);
      }
    }
    if (!g) {
      templates[lv] = templates[lv] ?? makeGill(r0, Rc * 0.985, lv === 0 ? 4 : 3);
      g = templates[lv].clone();
      drawn += 1;
    }
    g.rotateY(-theta);
    g.applyMatrix4(m);
    parts.push({ geometry: g, color: gillColor(k) });
  }
  must(drawn === plan.total, `every gill counted (${drawn} of ${plan.total})`);
  must(plan.total === plan.nLong * 2 ** plan.m, 'the gill count is the rule');
  return plan;
}

// Cuts a solid off at a plane, keeping the side behind it. The flat section is a separate painted plate, drawn from the same
// curves, so each triangle is cut exactly on the plane rather than stopping a row short of it.
function clipZ(geometry, zMax) {
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  if (!src.attributes.normal) src.computeVertexNormals();
  const names = ['position', 'normal', 'color'].filter((n) => src.attributes[n]);
  const out = Object.fromEntries(names.map((n) => [n, []]));
  const P = src.attributes.position;
  const read = (i) => Object.fromEntries(names.map((n) => [n, [src.attributes[n].getX(i), src.attributes[n].getY(i), src.attributes[n].getZ(i)]]));
  const lerp = (a, b, t) => Object.fromEntries(names.map((n) => [n, a[n].map((v, k) => mix(v, b[n][k], t))]));
  for (let t = 0; t < P.count; t += 3) {
    const tri = [read(t), read(t + 1), read(t + 2)];
    const poly = [];
    for (let i = 0; i < 3; i++) {
      const a = tri[i]; const b = tri[(i + 1) % 3];
      const ain = a.position[2] <= zMax; const bin = b.position[2] <= zMax;
      if (ain) poly.push(a);
      if (ain !== bin) poly.push(lerp(a, b, (zMax - a.position[2]) / (b.position[2] - a.position[2])));
    }
    for (let i = 1; i < poly.length - 1; i++) {
      for (const v of [poly[0], poly[i], poly[i + 1]]) for (const n of names) out[n].push(...v[n]);
    }
  }
  const g = new THREE.BufferGeometry();
  for (const n of names) g.setAttribute(n, new THREE.Float32BufferAttribute(out[n], 3));
  return g;
}

function mushroomStem(parts, pts, rs, tintBase, clip = null) {
  const radii = pts.map((_, i) => { const t = i / (pts.length - 1); return rs * (mix(1.34, 1.0, sstep(t, 0, 0.28)) * mix(1, 0.8, sstep(t, 0.5, 1))); });
  const g = tube(pts, radii, { sides: 12, steps: 12, round: 1 });
  const yb = pts[0][1]; const yt = pts[pts.length - 1][1];
  const low = lin(0x7d5526); const mid = lin(0xc9a262); const top = lin(0xf0e2bb); const mycel = lin(0xf1ebd8);
  tintVertices(g, (x, y, z, out) => {
    const t = (y - yb) / (yt - yb);
    const c = t < 0.5 ? [mix(low[0], mid[0], t * 2), mix(low[1], mid[1], t * 2), mix(low[2], mid[2], t * 2)] : [mix(mid[0], top[0], (t - 0.5) * 2), mix(mid[1], top[1], (t - 0.5) * 2), mix(mid[2], top[2], (t - 0.5) * 2)];
    const fibre = 0.92 + 0.14 * Math.sin(Math.atan2(z - pts[0][2], x - pts[0][0]) * 9 + y * 3);
    out[0] = c[0] * fibre; out[1] = c[1] * fibre; out[2] = c[2] * fibre;
    if (tintBase) mixInto(out, mycel, 1 - sstep(t, 0.0, 0.1));
  });
  parts.push({ geometry: clip !== null ? clipZ(g, clip) : g, keepColor: true });
}

// The ring: what is left of the veil that covered the young gills, a thin solid skirt on the stem.
function mushroomRing(parts, p, rs, clip = null) {
  const R = rs * 2.15;
  const g = lathe([[0, -0.03], [rs * 0.9, -0.03], [R * 0.72, -0.075], [R, -0.15], [R * 1.02, -0.125], [R * 0.72, -0.035], [rs * 0.9, 0.035], [0, 0.035]], 18);
  tintVertices(g, (x, y, z, out) => {
    const k = sstep(Math.hypot(x, z), rs, R);
    out[0] = mix(0.87, 0.55, k); out[1] = mix(0.78, 0.36, k); out[2] = mix(0.55, 0.13, k);
  });
  g.translate(p[0], p[1], p[2]);
  parts.push({ geometry: clip !== null ? clipZ(g, clip) : g, keepColor: true });
}

// The mycelium, computed. It starts at the stem bases and grows outward by a walk that forks, and its width is set by how far
// it has got from the nearest stem base, so it is thick by the mushrooms and goes down to a single hair.
function myceliumNetwork(anchors, inside, seed) {
  const rng = seededRandom(seed);
  const hubs = [[-1.75, 2.0], [0.15, 1.5], [1.95, 1.95]];
  const nearest = (x, y) => anchors.reduce((d, a) => Math.min(d, Math.hypot(x - a[0], y - a[1])), 1e9);
  const width = (x, y) => 0.75 + 5 * Math.exp(-nearest(x, y) / 0.42);
  const cords = [];
  // The cords first: one from every stem base to the same place in the soil, so that all of them are joined.
  const link = (a, hub) => {
    const pts = [[a[0], a[1]]];
    const n = 28;
    const phase = rng() * 9;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const wob = 0.16 * Math.sin(t * 8 + phase) * Math.sin(Math.PI * t);
      const dx = hub[0] - a[0]; const dy = hub[1] - a[1]; const L = Math.hypot(dx, dy) || 1;
      const x = mix(a[0], hub[0], t) + (-dy / L) * wob;
      const y = mix(a[1], hub[1], t) + (dx / L) * wob;
      pts.push([x, y]);
    }
    must(pts.every(([x, y]) => inside(x, y)), 'a cord stays inside the soil and the log');
    cords.push(pts);
  };
  // Every stem base goes to its nearest junction, and the junctions join, so one body of mycelium holds them all.
  for (const a of anchors) {
    const hub = a[1] > 3.5 ? hubs[1] : hubs.reduce((b, h) => (Math.hypot(a[0] - h[0], a[1] - h[1]) < Math.hypot(a[0] - b[0], a[1] - b[1]) ? h : b), hubs[0]);
    link(a, hub);
  }
  link(hubs[0], hubs[1]);
  link(hubs[1], hubs[2]);
  // Then the fine net, growing out from every cord.
  const segs = [];
  const tips = [];
  for (const cord of cords) {
    for (let i = 2; i < cord.length; i += 3) {
      const a = Math.atan2(cord[i][1] - cord[i - 1][1], cord[i][0] - cord[i - 1][0]);
      for (const q of [-1, 1]) tips.push({ x: cord[i][0], y: cord[i][1], a: a + q * (0.6 + rng() * 0.8), left: 18 + rng() * 34, gen: 0 });
    }
  }
  // A shuffled queue rather than a stack, so that every stem base gets its share of the growth and no one side eats it all.
  for (let i = tips.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const q = tips[i]; tips[i] = tips[j]; tips[j] = q; }
  let budget = 15000;
  const STEP = 0.042;
  for (let head = 0; head < tips.length && budget > 0; head++) {
    const t = tips[head];
    while (t.left > 0 && budget > 0) {
      budget -= 1;
      t.a += (rng() - 0.5) * 0.62;
      const x = t.x + Math.cos(t.a) * STEP; const y = t.y + Math.sin(t.a) * STEP;
      if (!inside(x, y)) { t.a += 1.4; t.left -= 2; continue; }
      segs.push([t.x, t.y, x, y, width(x, y)]);
      t.x = x; t.y = y; t.left -= 1;
      if (rng() < 0.045 && t.gen < 7) tips.push({ x, y, a: t.a + (rng() > 0.5 ? 1 : -1) * (0.45 + rng() * 0.75), left: t.left * 0.75 + rng() * 10, gen: t.gen + 1 });
    }
  }
  must(segs.length > 3000, 'the net is fine and wide');
  return { cords, segs, width };
}

function mushroomMycelium() {
  const M = MUSH;
  const rng = seededRandom(1990);
  const { HX, ZC, G, LX, LY, LR, FACE_TOP } = M;
  const parts = []; // mushrooms and the small things on the surface
  const soil = [];
  const faces = [];
  const stand = [];
  const plates = [];

  const logAt = (x) => { const d = x - LX; return Math.abs(d) < LR ? LY + Math.sqrt(LR * LR - d * d) : -1; };
  const surfaceY = (x, z) => Math.max(groundH(x, z), z < ZC + 0.01 ? logAt(x) : -1);

  // --- The table of mushrooms --------------------------------------------------------------------
  const SH = M.SLICE;
  const TABLE = [
    { x: LX + 0.62, z: 3.5, H: 2.0, Rc: 0.74, lean: [0.26, 0.1] },
    { x: LX - 0.1, z: 3.0, H: 2.55, Rc: 0.92, lean: [-0.08, 0.05] },
    { x: LX - 0.82, z: 3.7, H: 1.72, Rc: 0.66, lean: [-0.3, 0.1] },
    { x: LX + 0.2, z: 1.9, H: 2.1, Rc: 0.78, lean: [0.1, -0.12] },
    { x: -2.65, z: 3.55, H: 1.75, Rc: 0.62, lean: [-0.06, 0.08] },
    { x: 2.45, z: 2.55, H: 2.05, Rc: 0.74, lean: [0.08, -0.1] },
  ];
  must(TABLE.length + 1 === 7, 'about seven mushrooms');
  const bases = [];
  const plansMade = [];
  for (const s of TABLE) {
    const y0 = surfaceY(s.x, s.z) - 0.04;
    const stemR = 0.04 + s.Rc * 0.11;
    const Hc = s.Rc * 0.62;
    const Dm = s.Rc * 0.24;
    // The stem leaves its log at a lean and turns upright, because a mushroom's cap has to hold its gills level to let spores fall.
    const top = [s.x + s.lean[0], y0 + s.H, s.z + s.lean[1]];
    const pts = [[s.x, y0, s.z], [s.x + s.lean[0] * 0.5, y0 + s.H * 0.35, s.z + s.lean[1] * 0.5], [s.x + s.lean[0] * 0.92, y0 + s.H * 0.72, s.z + s.lean[1] * 0.92], top];
    mushroomStem(parts, pts, stemR, true);
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => V(p[0], p[1], p[2])));
    const rp = curve.getPoint(0.78);
    mushroomRing(parts, [rp.x, rp.y, rp.z], stemR * 0.9);
    const m = new THREE.Matrix4().compose(V(top[0], top[1] - 0.02 - capUnder(0, s.Rc, Hc) * 0.5, top[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(s.lean[1] * 0.22, 0, -s.lean[0] * 0.22)), V(1, 1, 1));
    plansMade.push(mushroomCap(parts, m, s.Rc, Hc, { scales: 12, stemR, gillD: Dm }, rng));
    bases.push({ x: s.x, y: y0, z: s.z });
  }

  // --- The sliced one ------------------------------------------------------------------------------
  const zAxis = ZC - SH.e;
  const clip = ZC - 0.004;
  const sliceStemR = 0.04 + SH.Rc * 0.11;
  const sliceY0 = groundH(SH.x, ZC) - 0.05;
  const sliceHc = SH.Rc * 0.62;
  const sliceTop = sliceY0 + SH.H;
  const sliceRim = sliceTop - 0.02 - capUnder(0, SH.Rc, sliceHc) * 0.5;
  mushroomStem(parts, [[SH.x, sliceY0, zAxis], [SH.x + 0.002, sliceY0 + SH.H * 0.5, zAxis], [SH.x, sliceTop, zAxis]], sliceStemR, true, clip);
  mushroomRing(parts, [SH.x, sliceY0 + SH.H * 0.76, zAxis], sliceStemR * 0.86, clip);
  const sliceM = new THREE.Matrix4().makeTranslation(SH.x, sliceRim, zAxis);
  plansMade.push(mushroomCap(parts, sliceM, SH.Rc, sliceHc, { scales: 10, stemR: sliceStemR, gillD: SH.Rc * 0.24, e: SH.e }, rng, clip));
  must(plansMade.length === 7, 'seven mushrooms drawn');
  must(plansMade.every((p) => p.total >= 32), 'every cap carries a full set of gills');

  // Spores: tiny, falling from under the gills of the cut one, the plume widening as it drifts down.
  const SPORES = 130;
  const gillLow = sliceRim - SH.Rc * 0.1;
  for (let i = 0; i < SPORES; i++) {
    const t = rng() ** 1.5;
    const y = mix(gillLow - 0.03, G + 0.25, t);
    const spread = 0.12 + t * 0.32;
    const side = rng() > 0.5 ? 1 : -1;
    const lane = side * (sliceStemR + 0.18 + rng() * SH.Rc * 0.5);
    const x = SH.x + lane + (rng() - 0.5) * spread + t * 0.3;
    const z = ZC + 0.04 + rng() * (0.1 + t * 0.26);
    const r = 0.009 + rng() * 0.006;
    const g = new THREE.SphereGeometry(r, 4, 3);
    g.scale(1, 1.3, 1);
    g.translate(x, y, z);
    parts.push({ geometry: g, color: 0xfff9e6 });
  }

  // --- The computed network ------------------------------------------------------------------------
  const insideDisc = (x, y) => Math.hypot(x - LX, y - LY) < LR - 0.03;
  const inside = (x, y) => (Math.abs(x) < HX - 0.02 && y > 0.05 && y < groundH(x, ZC) - 0.03) || insideDisc(x, y);
  const anchors = [
    [SH.x, groundH(SH.x, ZC) - 0.08],
    [TABLE[0].x, logAt(TABLE[0].x) - 0.1],
    [TABLE[1].x, logAt(TABLE[1].x) - 0.1],
    [TABLE[2].x, logAt(TABLE[2].x) - 0.1],
    [TABLE[4].x, groundH(TABLE[4].x, ZC) - 0.08],
    [TABLE[5].x, groundH(TABLE[5].x, ZC) - 0.08],
  ];
  const net = myceliumNetwork(anchors, inside, 811);

  // --- The painting on the cut -----------------------------------------------------------------
  const FW = 1024; const FH = 952; const STRIP = 300; const TH = FH + STRIP;
  const ftX = (px) => -HX + (px / FW) * (HX * 2);
  const ftY = (py) => FACE_TOP * (1 - py / FH);
  const pxX = (x) => ((x + HX) / (HX * 2)) * FW;
  const pxY = (y) => (1 - y / FACE_TOP) * FH;
  const faceV = (y) => 1 - pxY(y) / TH;
  const faceTex = canvasTexture(FW, TH, (ctx) => {
    const n1 = latticeNoise(301, 128); const n2 = latticeNoise(302, 128); const n3 = latticeNoise(303, 128);
    const soilColor = (depth, x, y, out) => {
      const wob = 0.22 * (n1(x * 1.6 + 40, y * 1.6 + 7) - 0.5);
      const d = depth + wob;
      const fine = n2(x * 34 + 5, y * 34) * 0.6 + n3(x * 11, y * 11 + 3) * 0.4;
      // Horizons from the top down: dark litter and humus, topsoil, paler subsoil.
      let c;
      if (d < 0.2) c = [44, 30, 18];
      else if (d < 0.9) c = [mix(52, 74, (d - 0.2) / 0.7), mix(36, 50, (d - 0.2) / 0.7), mix(22, 30, (d - 0.2) / 0.7)];
      else if (d < 2.0) c = [mix(100, 128, (d - 0.9) / 1.1), mix(72, 92, (d - 0.9) / 1.1), mix(44, 58, (d - 0.9) / 1.1)];
      else c = [mix(128, 150, Math.min(1, (d - 2) / 0.9)), mix(98, 118, Math.min(1, (d - 2) / 0.9)), mix(66, 82, Math.min(1, (d - 2) / 0.9))];
      const k = 0.68 + 0.62 * fine;
      out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
    };
    paintTexels(ctx, 0, 0, FW, TH, (px, py, out) => {
      if (py >= FH) {
        // The strip that wraps the block's other three faces: soil and nothing else.
        const x = (px / FW) * 9.5; const depth = ((py - FH) / STRIP) * 3;
        soilColor(depth, x, depth, out);
        return;
      }
      const x = ftX(px); const y = ftY(py);
      const dx = x - LX; const dy = y - LY;
      const dist = Math.hypot(dx, dy);
      if (dist <= LR + 0.01) {
        // The log's end: bark, then wood with its rings, going to rot from the middle and along the checks.
        if (dist > LR - 0.13 + 0.03 * n1(Math.atan2(dy, dx) * 6 + 30, 3)) {
          const k = 0.7 + 0.6 * n2(x * 22, y * 22);
          out[0] = 52 * k; out[1] = 36 * k; out[2] = 24 * k;
          return;
        }
        const a = Math.atan2(dy, dx);
        const rr = dist + 0.05 * (n1(a * 2.5 + 11, dist * 1.3 + 2) - 0.5);
        const ring = Math.abs(((rr * 10.5) % 1) - 0.5) * 2;
        const rot = sstep(n1(x * 1.5 + 60, y * 1.5 + 20), 0.42, 0.68);
        const heart = 1 - sstep(dist, 0.1, 0.46);
        const check = sstep(n3(a * 8 + 40, 2.5), 0.76, 0.84) * sstep(dist, 0.2, 0.5);
        const grain = 0.82 + 0.3 * n2(x * 44, y * 44);
        const wood = [mix(118, 158, ring), mix(82, 114, ring), mix(46, 68, ring)];
        const pale = [188 + ring * 16, 170 + ring * 14, 132 + ring * 12];
        out[0] = mix(wood[0], pale[0], rot * 0.75) * grain;
        out[1] = mix(wood[1], pale[1], rot * 0.75) * grain;
        out[2] = mix(wood[2], pale[2], rot * 0.75) * grain;
        const hd = Math.max(heart, check);
        out[0] = mix(out[0], 30, hd); out[1] = mix(out[1], 20, hd); out[2] = mix(out[2], 12, hd);
        return;
      }
      // The cut mushroom: pale flesh under a thin honey skin, and the fibres of the stem.
      const ex = x - SH.x;
      const r = Math.hypot(ex, SH.e);
      if (y >= sliceRim - 0.02 && r < SH.Rc) {
        const h = y - sliceRim;
        const skin = capTop(r, SH.Rc, sliceHc) + 0.012 * sliceHc - h;
        if (skin < 0.05) { const t = sstep(r / SH.Rc, 0.15, 0.85); out[0] = mix(122, 205, t); out[1] = mix(78, 143, t); out[2] = mix(30, 52, t); return; }
        const k = 0.95 + 0.08 * n2(x * 30, y * 30);
        out[0] = 214 * k; out[1] = 198 * k; out[2] = 160 * k;
        return;
      }
      if (Math.abs(ex) < sliceStemR * 1.5 && y > G - 0.2 && y < sliceRim + 0.1) {
        const fibre = 0.9 + 0.14 * Math.sin(ex * 180 + 2 * n1(y * 2, 4));
        const t = sstep(y, G, G + 1.2);
        out[0] = mix(180, 214, t) * fibre; out[1] = mix(150, 198, t) * fibre; out[2] = mix(104, 160, t) * fibre;
        return;
      }
      if (y < groundH(x, ZC) + 0.02) { soilColor(groundH(x, ZC) - y, x, y, out); return; }
      out[0] = 60; out[1] = 45; out[2] = 30;
    });

    // Stones and roots, only in the soil. Drawn by hand over the per-texel soil, under the mycelium.
    const stoneRng = seededRandom(404);
    for (let i = 0; i < 42; i++) {
      const x = -HX + stoneRng() * HX * 2; const y = 0.05 + stoneRng() * (G - 0.7);
      if (insideDisc(x, y)) continue;
      const r = 0.03 + stoneRng() ** 2 * 0.15;
      const v = 96 + stoneRng() * 70;
      ctx.fillStyle = `rgb(${v},${v * 0.93},${v * 0.82})`;
      ctx.beginPath();
      ctx.ellipse(pxX(x), pxY(y), (r * FW) / (HX * 2), (r * 0.74 * FW) / (HX * 2), stoneRng() * 3, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,14,8,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // The fine net: white hair-thin lines, then the same for the strip, in the same way but sparser.
    ctx.lineCap = 'round';
    for (const [x0, y0, x1, y1, w] of net.segs) {
      ctx.strokeStyle = `rgba(250,246,232,${Math.min(0.95, 0.42 + w * 0.15)})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(pxX(x0), pxY(y0));
      ctx.lineTo(pxX(x1), pxY(y1));
      ctx.stroke();
    }
    for (const cord of net.cords) {
      for (let i = 1; i < cord.length; i++) {
        ctx.strokeStyle = 'rgba(255,252,240,0.98)';
        ctx.lineWidth = net.width(cord[i][0], cord[i][1]) + 0.5;
        ctx.beginPath();
        ctx.moveTo(pxX(cord[i - 1][0]), pxY(cord[i - 1][1]));
        ctx.lineTo(pxX(cord[i][0]), pxY(cord[i][1]));
        ctx.stroke();
      }
    }
    const stripRng = seededRandom(909);
    for (let i = 0; i < 70; i++) {
      let x = stripRng() * FW; let y = FH + stripRng() * STRIP * 0.8; let a = stripRng() * TAU;
      ctx.strokeStyle = 'rgba(245,240,225,0.55)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 40; k++) {
        a += (stripRng() - 0.5) * 0.7;
        x += Math.cos(a) * 5; y = Math.min(TH - 1, Math.max(FH + 1, y + Math.sin(a) * 5));
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });

  // The cut itself: one thin plate whose outline is the soil's top edge and the log's end together, and two for the mushroom.
  const uvFace = (g) => {
    const P = g.attributes.position;
    const uv = g.attributes.uv;
    const N = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      if (N.getZ(i) > 0.5) uv.setXY(i, pxX(P.getX(i)) / FW, faceV(P.getY(i)));
      else uv.setXY(i, 0.5, faceV(5.9));
    }
    return g;
  };
  const plateFrom = (pts) => {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, ZC - 0.05 + 0.003);
    return uvFace(g);
  };
  const NX_G = 30; const NZ_G = 38;
  {
    const pts = [[-HX, 0], [HX, 0]];
    const xAt = (i) => mix(HX, -HX, i / NX_G);
    let inLog = false;
    let arcDone = false;
    const logHits = (x) => Math.abs(x - LX) < LR && logAt(x) > groundH(x, ZC);
    for (let i = 0; i <= NX_G; i++) {
      const x = xAt(i);
      if (logHits(x)) {
        if (!inLog && !arcDone) {
          // From the right-hand foot of the log, up over its top and down to the left-hand foot.
          const a0 = Math.asin(clamp01((G - LY) / LR) * 0 + (groundH(LX + LR * 0.8, ZC) - LY) / LR);
          const a1 = Math.PI - a0;
          for (let k = 0; k <= 56; k++) { const a = mix(a0, a1, k / 56); pts.push([LX + LR * Math.cos(a), LY + LR * Math.sin(a)]); }
          arcDone = true;
        }
        inLog = true;
        continue;
      }
      inLog = false;
      pts.push([x, groundH(x, ZC)]);
    }
    faces.push({ geometry: plateFrom(pts), keepColor: true });
  }
  {
    // The cap's section, from the same two curves the cap's solid was turned from.
    const xMax = Math.sqrt(SH.Rc ** 2 - SH.e ** 2);
    const pts = [];
    const n = 40;
    for (let i = 0; i <= n; i++) { const x = mix(-xMax, xMax, i / n) * 0.995; const r = Math.hypot(x, SH.e); pts.push([SH.x + x, sliceRim + capUnder(r, SH.Rc, sliceHc)]); }
    for (let i = n; i >= 0; i--) { const x = mix(-xMax, xMax, i / n) * 0.995; const r = Math.hypot(x, SH.e); pts.push([SH.x + x, sliceRim + capTop(r, SH.Rc, sliceHc) + 0.012 * sliceHc]); }
    faces.push({ geometry: plateFrom(pts), keepColor: true });
    // The stem's section: the plane crosses it off centre by e.
    const ptsS = [];
    const rad = (t) => sliceStemR * (mix(1.34, 1.0, sstep(t, 0, 0.28)) * mix(1, 0.8, sstep(t, 0.5, 1)));
    const yTop = sliceRim + capUnder(0, SH.Rc, sliceHc) * 0.8;
    const yBot = groundH(SH.x, ZC) - 0.03;
    const half = (t) => Math.sqrt(Math.max(1e-4, rad(t) ** 2 - SH.e ** 2));
    for (let i = 0; i <= 18; i++) { const t = i / 18; ptsS.push([SH.x + half(t), mix(yBot, yTop, t)]); }
    for (let i = 18; i >= 0; i--) { const t = i / 18; ptsS.push([SH.x - half(t), mix(yBot, yTop, t)]); }
    faces.push({ geometry: plateFrom(ptsS), keepColor: true });
  }
  // The other three faces of the block, soil only, from the strip.
  const stripV = (a) => 1 - (FH + a * STRIP) / TH;
  const sidePanel = (x0, x1, z0, z1) => {
    const g = block(x0, 0, z0, x1, G - 0.07, z1);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), stripV(1 - uv.getY(i)));
    faces.push({ geometry: g, keepColor: true });
  };
  sidePanel(-HX - 0.015, -HX + 0.01, M.Z0, ZC);
  sidePanel(HX - 0.01, HX + 0.015, M.Z0, ZC);
  sidePanel(-HX, HX, M.Z0 - 0.015, M.Z0 + 0.01);

  // --- The ground ----------------------------------------------------------------------------------
  const mossAt = (x, z) => sstep(smoothNoise3(x * 1.3 + 4, 1, z * 1.3), 0.54, 0.7);
  const ground = gridSolid(NX_G, NZ_G,
    (i, j) => { const x = mix(-HX, HX, i / NX_G); const z = mix(M.Z0, ZC, j / NZ_G); return [x, groundH(x, z), z]; },
    (i, j) => [mix(-HX, HX, i / NX_G), 0, mix(M.Z0, ZC, j / NZ_G)],
    { crease: 40 });
  const litterA = lin(0x4a2f17); const litterB = lin(0x7a5427); const mossC = lin(0x35581a);
  tintVertices(ground, (x, y, z, out) => {
    if (y < G - 0.2) { out[0] = 0.04; out[1] = 0.025; out[2] = 0.015; return; }
    const n = smoothNoise3(x * 3.1, 2, z * 3.1);
    out[0] = mix(litterA[0], litterB[0], n); out[1] = mix(litterA[1], litterB[1], n); out[2] = mix(litterA[2], litterB[2], n);
    mixInto(out, mossC, mossAt(x, z) * 0.75);
  });
  soil.push({ geometry: ground, keepColor: true });

  // --- The log ------------------------------------------------------------------------------------------
  const logTube = tube([[LX, LY, M.LOG_BACK], [LX, LY, ZC - 0.002]], LR, { sides: 56, steps: 44, round: 0, straight: true });
  {
    const P = logTube.attributes.position;
    const uv = new Float32Array(P.count * 2);
    const colors = new Float32Array(P.count * 3);
    const barkDark = lin(0x3b2a1b); const barkMid = lin(0x5d452d); const bare = lin(0xa98a5e); const moss = lin(0x3c6419);
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
      const a = Math.atan2(y - LY, x - LX);
      // Furrows run along the log. They are full depth along its length and die out at the cut, where the outline has to be exact.
      const fade = 1 - sstep(z, ZC - 0.5, ZC - 0.03);
      const furrow = Math.abs(Math.sin(a * 11 + 1.6 * smoothNoise3(z * 0.32, a * 1.2 + 5, 2))) ** 0.6;
      const lump = smoothNoise3(a * 1.4 + 9, z * 0.33, 7) - 0.5;
      const peeled = sstep(smoothNoise3(a * 1.9 + 3, z * 0.42, 13), 0.62, 0.68);
      const d = (0.06 * furrow - 0.05 + 0.13 * lump - peeled * 0.06) * fade;
      const k = 1 + d / LR;
      // tube() closes its ends with a fan to a pole standing proud of the last ring, which must not stick through the cut.
      P.setXYZ(i, LX + (x - LX) * k, LY + (y - LY) * k, THREE.MathUtils.clamp(z, M.LOG_BACK, ZC - 0.01));
      uv[i * 2] = z * 0.3; uv[i * 2 + 1] = ((a + TAU * 1.25) % TAU) * 1.6;
      const f = furrow;
      let c = [mix(barkDark[0], barkMid[0], f), mix(barkDark[1], barkMid[1], f), mix(barkDark[2], barkMid[2], f)];
      c = [mix(c[0], bare[0], peeled), mix(c[1], bare[1], peeled), mix(c[2], bare[2], peeled)];
      const sky = Math.sin(a);
      const m2 = sstep(smoothNoise3(x * 1.6 + 2, z * 0.8, 3) + sky * 0.14, 0.6, 0.76) * (1 - peeled) * 0.9;
      colors[i * 3] = mix(c[0], moss[0], m2); colors[i * 3 + 1] = mix(c[1], moss[1], m2); colors[i * 3 + 2] = mix(c[2], moss[2], m2);
    }
    logTube.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    logTube.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    logTube.computeVertexNormals();
  }
  soil.push({ geometry: logTube, keepColor: true });
  // The log's far end, with rings of its own so nobody walking round the back finds a blank disc.
  const prof = [];
  for (let i = 0; i <= 12; i++) prof.push([(i / 12) * (LR - 0.06), 0.04 - (i % 2) * 0.012]);
  prof.reverse();
  const backEnd = lathe([[0, -0.05], [LR - 0.06, -0.05], ...prof], 40);
  backEnd.rotateX(-Math.PI / 2);
  tintVertices(backEnd, (x, y, z, out) => {
    const r = Math.hypot(x, y);
    const ring = Math.abs(((r * 5) % 1) - 0.5) * 2;
    out[0] = mix(0.2, 0.36, ring); out[1] = mix(0.12, 0.22, ring); out[2] = mix(0.06, 0.1, ring);
  });
  backEnd.translate(LX, LY, M.LOG_BACK - 0.02);
  soil.push({ geometry: backEnd, keepColor: true });

  // --- Moss cushions, on the log and the ground ------------------------------------------------------
  for (let i = 0; i < 50; i++) {
    const onLog = i < 28;
    const a = onLog ? mix(0.35, Math.PI - 0.35, rng()) : 0;
    const z = mix(M.Z0 + 0.3, ZC - 0.15, rng());
    const x = onLog ? LX + (LR - 0.02) * Math.cos(a) : mix(-HX + 0.15, HX - 0.15, rng());
    const y = onLog ? LY + (LR - 0.02) * Math.sin(a) : groundH(x, z);
    if (!onLog && Math.abs(x - LX) < LR) continue;
    const s = 0.05 + rng() * 0.07;
    const g = new THREE.SphereGeometry(1, 8, 5);
    g.scale(s, s * 0.34, s * 0.9);
    if (onLog) g.rotateZ(a - Math.PI / 2);
    g.translate(x, y, z);
    parts.push({ geometry: g, color: new THREE.Color(rng() > 0.5 ? 0x2f5f18 : 0x3f7220) });
  }

  // --- Fallen leaves -------------------------------------------------------------------------------
  const LEAVES = 30;
  const LEAF_COLORS = [0xa8531a, 0xc47a1e, 0x8a3e16, 0xb99a2a, 0x6d3a18];
  for (let i = 0; i < LEAVES; i++) {
    const x = mix(-HX + 0.3, HX - 0.3, rng()); const z = mix(M.Z0 + 0.3, ZC - 0.4, rng());
    if (Math.abs(x - LX) < LR - 0.3) continue;
    if (Math.hypot(x - SH.x, z - ZC) < 0.5) continue;
    const y = surfaceY(x, z) + 0.04;
    const a = rng() * TAU;
    const L = 0.55 + rng() * 0.45;
    const W = L * (0.2 + rng() * 0.08);
    const curl = 0.1 + rng() * 0.16;
    const ca = Math.cos(a); const sa = Math.sin(a);
    const g = solidSurface({
      nu: 4, nv: 8,
      point: (u, v) => {
        const U = u * 2 - 1;
        const w = W * Math.sin(Math.PI * Math.min(1, v * 0.98 + 0.01)) ** 0.9 * U;
        const alongL = (v - 0.5) * L;
        return [x + ca * alongL - sa * w, y + curl * (U * U) * W + curl * (v - 0.5) ** 2 * L, z + sa * alongL + ca * w];
      },
      thick: () => 0.01,
      axis: [0, 1, 0],
    });
    const c = lin(LEAF_COLORS[Math.floor(rng() * LEAF_COLORS.length)]);
    tintVertices(g, (px, py, pz, out) => {
      const dz = -(px - x) * sa + (pz - z) * ca;
      const vein = Math.abs(dz) < 0.018 ? 1.25 : 1;
      const t = 0.8 + 0.3 * smoothNoise3(px * 7, py, pz * 7);
      out[0] = c[0] * t * vein; out[1] = c[1] * t * vein; out[2] = c[2] * t * vein;
    });
    parts.push({ geometry: g, keepColor: true });
  }

  // --- Real strands at the surface -----------------------------------------------------------------
  // The cords on the cut stand a hair proud of the painting they follow, and they are the same points, so the two cannot disagree.
  const STRAND = 0xf6f1df;
  for (const cord of net.cords) {
    const pts = cord.filter((_, i) => i % 2 === 0).map(([x, y]) => [x, y, ZC + 0.009]);
    const radii = pts.map(([x, y]) => 0.0035 + (net.width(x, y) * 0.38) / 160);
    parts.push({ geometry: tube(pts, radii, { sides: 5, steps: pts.length * 2, round: 1 }), color: STRAND });
  }
  // And over the ground and up the log, from each stem base to the next, lying on the surface.
  const baseChain = [...bases, { x: SH.x, y: sliceY0, z: zAxis }];
  const strandOn = (a, b, r0, wob = 0.14) => {
    const pts = [];
    const n = 14;
    const ph = rng() * 9;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = mix(a.x, b.x, t) + wob * Math.sin(t * 6 + ph) * Math.sin(Math.PI * t);
      const z = Math.min(ZC - 0.02, mix(a.z, b.z, t) + wob * Math.cos(t * 5 + ph) * Math.sin(Math.PI * t));
      pts.push([x, surfaceY(x, z) + 0.008, z]);
    }
    parts.push({ geometry: tube(pts, pts.map((_, i) => mix(r0, r0 * 0.75, i / n)), { sides: 5, steps: 26, round: 1 }), color: STRAND });
  };
  const order = [4, 2, 1, 0, 3, 5, 6];
  for (let i = 0; i < order.length - 1; i++) strandOn(baseChain[order[i]], baseChain[order[i + 1]], 0.02);
  // Short side-branches out from each base.
  for (const b of baseChain) {
    for (let i = 0; i < 4; i++) {
      const a = rng() * TAU; const L = 0.4 + rng() * 0.7;
      const e = { x: THREE.MathUtils.clamp(b.x + Math.cos(a) * L, -HX + 0.05, HX - 0.05), z: Math.min(ZC - 0.03, b.z + Math.sin(a) * L) };
      strandOn(b, e, 0.012, 0.06);
    }
  }

  // --- Plinth and plates ---------------------------------------------------------------------------
  const PX0 = -HX - 0.28; const PX1 = HX + 1.72; const PZ0 = M.Z0 - 0.28; const PZ1 = ZC + 0.8;
  stand.push({ geometry: block(PX0, -0.0, PZ0, PX1, 0.02, PZ1), color: 0x1f1b16 });
  const atlas = plateAtlas(['CAP', 'GILLS', 'STEM', 'MYCELIUM', 'SPORES'], { W: 512, rowH: 104, ground: '#f0e7cf' });
  const MAST_X = HX + 0.32; const MAST_Z = ZC + 0.12;
  stand.push({ geometry: rod([MAST_X, 0, MAST_Z], [MAST_X, sliceRim + 1.0, MAST_Z], 0.035, 8, 1), color: 0x3b3731 });
  const onMast = (rect, y, target, w = 0.92) => {
    const g = printedPlate(w, 0.3, 0.05, rect);
    g.translate(MAST_X + w / 2 + 0.03, y, MAST_Z + 0.05);
    plates.push({ geometry: g, keepColor: true });
    stand.push({ geometry: rod([MAST_X + 0.04, y, MAST_Z + 0.01], target, 0.012, 5, 1), color: 0x3b3731 });
  };
  onMast(atlas.rects[0], sliceRim + 0.78, [SH.x + SH.Rc * 0.45, sliceRim + capTop(SH.Rc * 0.45, SH.Rc, sliceHc) * 0.75, ZC - 0.01]);
  onMast(atlas.rects[1], sliceRim - 0.05, [SH.x + SH.Rc * 0.62, sliceRim - 0.05, ZC - 0.03]);
  onMast(atlas.rects[4], sliceRim - 0.78, [SH.x + SH.Rc * 0.5, sliceRim - 0.72, ZC + 0.12]);
  onMast(atlas.rects[2], G + 0.62, [SH.x + sliceStemR * 0.7, G + 0.62, ZC - 0.02]);
  // MYCELIUM goes on the cut itself, down where the net is finest, with a pin to the nearest cord.
  const myc = printedPlate(1.1, 0.3, 0.05, atlas.rects[3]);
  myc.translate(-2.35, 0.42, ZC + 0.09);
  plates.push({ geometry: myc, keepColor: true });
  const cordPoint = net.cords[4][Math.floor(net.cords[4].length * 0.55)];
  stand.push({ geometry: rod([-2.35, 0.54, ZC + 0.05], [cordPoint[0], cordPoint[1], ZC + 0.008], 0.011, 5, 1), color: 0x1d1a15 });

  const root = new THREE.Group();
  faceTex.anisotropy = 8;
  root.add(mesh(mergeParts(faces), standard({ map: faceTex, roughness: 0.92, metalness: 0 })));
  const barkBump = woodGrain(71);
  root.add(mesh(mergeParts(soil), standard({ vertexColors: true, bumpMap: barkBump, bumpScale: 2.4, roughness: 0.92, metalness: 0 })));
  root.add(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.58, metalness: 0 })));
  root.add(mesh(mergeParts(stand), standard({ vertexColors: true, roughness: 0.6, metalness: 0 })));
  root.add(mesh(mergeParts(plates), standard({ map: atlas.texture, roughness: 0.6, metalness: 0 })));
  return root;
}

export const BUILDERS = {
  'mitosis-stages': mitosisStages,
  'leaf-section': leafSection,
  'bacterium-cell': bacteriumCell,
  'darwins-finches': darwinsFinches,
  'mushroom-mycelium': mushroomMycelium,
};
