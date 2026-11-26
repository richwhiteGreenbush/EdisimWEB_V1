import * as THREE from 'three';
import { mesh, standard, canvasTexture, seededRandom, relief } from '../../PropKit.js';
import { mergeParts } from '../../props/LoftKit.js';
import { tube, lathe, lin, clamp01, mix } from '../ModelKit.js';
import { reducedMotion } from '../../Settings.js';

// The Model Database's Chladni plate: a square steel plate clamped at its centre on an iron
// pedestal, dusted with sand, a violin bow resting against its edge, and a label that says which
// mode it is singing. Authored in feet, origin at the base centre, front toward +Z.
//
// THE ONE IDEA: SAND IS THROWN OFF EVERYTHING THAT MOVES, SO WHAT IT DRAWS IS THE PART THAT DOES
// NOT. The plate's mode shape is a real formula, the sand is sampled from where that formula is
// zero, and when the program changes `mode` the grains hop off the new antinodes and settle on the
// new nodal lines. The plate itself hums in that same shape, exaggerated, so a student can see the
// sand sitting exactly where the metal stays still.
//
// THE PATTERNS: the standard first approximation for a square plate with free edges, which treats
// it as a membrane whose edges are free to move and combines a degenerate pair of its modes:
//
//   Z(u, v) = cos(n pi u) cos(m pi v) + sign * cos(m pi u) cos(n pi v),   u, v in [0, 1]
//
// measured from one corner (see D'Alessio, "Chladni patterns", SN Applied Sciences 3, 2021, and
// Rayleigh's Theory of Sound for the same sum-and-difference combinations). It is not an exact
// plate solution -- a free square plate has none in closed form -- but it draws the figures
// Chladni drew. The sand lies where Z is zero. Every mode in the table below is zero at the
// plate's centre (u = v = 1/2), which a plate clamped at its centre requires: the clamp cannot
// move. That rules out, for instance, (0, 2, +), the ring, which needs the plate held somewhere
// else. The table is ordered by n^2 + m^2, which goes up with the pitch in this approximation, and
// it is exported so a script can hold it to that.

export const CHLADNI_MODES = [
  { n: 1, m: 1, sign: 1 }, //  2: a cross, the plate twisting corner against corner
  { n: 0, m: 2, sign: -1 }, //  4: an X along the diagonals
  { n: 1, m: 2, sign: -1 }, //  5: one diagonal and two arcs
  { n: 0, m: 3, sign: 1 }, //  9: a diamond with corner lines
  { n: 1, m: 3, sign: -1 }, // 10: an eight-pointed star
  { n: 2, m: 3, sign: 1 }, // 13: wavy lines
  { n: 0, m: 4, sign: -1 }, // 16: a lattice of diamonds
  { n: 0, m: 5, sign: 1 }, // 25: a finer lattice
];

// Z and its gradient for one mode, in corner coordinates u, v in [0, 1]. Z runs from -2 to 2.
export function chladniZ(mode, u, v, out = null) {
  const { n, m, sign } = mode;
  const P = Math.PI;
  const cnu = Math.cos(n * P * u); const snu = Math.sin(n * P * u);
  const cmu = Math.cos(m * P * u); const smu = Math.sin(m * P * u);
  const cnv = Math.cos(n * P * v); const snv = Math.sin(n * P * v);
  const cmv = Math.cos(m * P * v); const smv = Math.sin(m * P * v);
  const z = cnu * cmv + sign * cmu * cnv;
  if (out) {
    out[0] = -n * P * snu * cmv - sign * m * P * smu * cnv;
    out[1] = -m * P * cnu * smv - sign * n * P * cmu * snv;
  }
  return z;
}

const DEG = Math.PI / 180;
const FONT = 'Georgia, "Times New Roman", serif';

// The plate, 4ft square: about four times a real one.
const L = 4.0;
const H = L / 2;
const THICK = 0.05;
const PLATE_BOTTOM = 2.3;
const PLATE_TOP = PLATE_BOTTOM + THICK;
const GRID = 40; // 16 samples a cycle at the finest mode, (0, 5)

// How far the plate is drawn to move. A real one moves microns; this is enough to see, and the
// sand on the nodal lines does not move at all, which is the point.
const HUM_AMP = 0.022;
const HUM_HZ = 9;

const GRAINS = 7000;
const LINE_HALF = 0.042; // feet either side of a nodal line that the sand spreads over
const NUT_CLEAR = 0.19;
const EDGE_CLEAR = 0.035;
const MIGRATE_SECONDS = 2.2;

// Corner coordinates for a point on the plate (x right, z toward the front).
const toU = (x) => x / L + 0.5;

// ---------------------------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------------------------
function fitFont(ctx, text, maxWidth, size, weight = '700', family = FONT) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  const width = ctx.measureText(text).width;
  if (width > maxWidth) { s = (s * maxWidth) / width; ctx.font = `${weight} ${s}px ${family}`; }
  return s;
}

function paintWoodGrain(ctx, w, h, seed) {
  const rng = seededRandom(seed);
  ctx.fillStyle = '#efe6d8';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 420; i++) {
    const y = rng() * h;
    const x = rng() * w;
    const len = (0.15 + rng() * 0.5) * w;
    const dark = rng() > 0.35;
    const a = 0.03 + rng() * 0.09;
    ctx.strokeStyle = dark ? `rgba(92,62,36,${a})` : `rgba(255,248,235,${a})`;
    ctx.lineWidth = 0.6 + rng() * 2.4;
    const bend = (rng() - 0.5) * 7;
    for (const ox of [-w, 0, w]) {
      ctx.beginPath();
      ctx.moveTo(x + ox, y);
      ctx.bezierCurveTo(x + ox + len * 0.3, y + bend, x + ox + len * 0.7, y - bend, x + ox + len, y);
      ctx.stroke();
    }
  }
}

// Near-white brushing for the steel, faint streaks across the plate and a few tarnish clouds. The
// colour is the material's; this only carries the finish. Kept faint: strong streaks on a warm
// colour read as wood grain, and the plate came out looking like a table.
function paintBrushed(ctx, w, h, seed) {
  const rng = seededRandom(seed);
  ctx.fillStyle = '#f2ede2';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    const y = rng() * h;
    const a = 0.01 + rng() * 0.025;
    ctx.strokeStyle = rng() > 0.5 ? `rgba(90,90,95,${a})` : `rgba(255,255,255,${a * 1.5})`;
    ctx.lineWidth = 0.5 + rng() * 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y + (rng() - 0.5) * 2);
    ctx.stroke();
  }
  // A few broad tarnish clouds, faint, so the plate is not one flat colour.
  for (let i = 0; i < 18; i++) {
    const x = rng() * w; const y = rng() * h; const r = 40 + rng() * 120;
    for (const ox of [-w, 0, w]) {
      for (const oy of [-h, 0, h]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(110,105,100,${0.04 + rng() * 0.05})`);
        g.addColorStop(1, 'rgba(110,105,100,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
}

// The label card. Redrawn when the mode changes; a canvas texture's version carries to HiFi.
function paintLabel(ctx, w, h, modeNumber, singing) {
  ctx.fillStyle = '#efe6cf';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#a5803e';
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.fillStyle = '#2b2118';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, 'CHLADNI PLATE', w * 0.8, 64, '700');
  ctx.fillText('CHLADNI PLATE', w / 2, h * 0.2);
  ctx.fillStyle = '#7a2a1a';
  fitFont(ctx, `Mode ${modeNumber}`, w * 0.8, 150, '700');
  ctx.fillText(`Mode ${modeNumber}`, w / 2, h * 0.52);
  ctx.fillStyle = '#3b3027';
  const line = singing ? 'The sand gathers where the plate stays still.' : 'Press the green arrow to make it sing.';
  fitFont(ctx, line, w * 0.84, 40, 'italic 400');
  ctx.fillText(line, w / 2, h * 0.82);
}

// ---------------------------------------------------------------------------------------------
// Solids
// ---------------------------------------------------------------------------------------------

// A box from its centre and size, optionally placed by a matrix.
function block(sx, sy, sz, cx, cy, cz, m = null) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(cx, cy, cz);
  if (m) g.applyMatrix4(m);
  return g;
}

// A lathe profile with its corners doubled, so a turned edge stays an edge instead of a pillow.
function turned(profile, segments, corners = []) {
  const out = [];
  profile.forEach((p, i) => {
    out.push(p);
    if (corners.includes(i)) out.push([p[0], p[1]]);
  });
  return lathe(out, segments);
}

// A thin card with a printed face on +Z, built as a closed box: the face carries the whole canvas
// and every other face samples one corner of it.
function printedCard(w, h, depth) {
  const hw = w / 2; const hh = h / 2;
  const pos = []; const uv = [];
  const put = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u, v); };
  const quad = (a, b, c, d) => { for (const p of [a, b, c, a, c, d]) put(...p); };
  const r = 0.01;
  quad([-hw, -hh, 0, 0, 0], [hw, -hh, 0, 1, 0], [hw, hh, 0, 1, 1], [-hw, hh, 0, 0, 1]);
  quad([-hw, hh, -depth, r, r], [hw, hh, -depth, r, r], [hw, -hh, -depth, r, r], [-hw, -hh, -depth, r, r]);
  quad([-hw, -hh, -depth, r, r], [hw, -hh, -depth, r, r], [hw, -hh, 0, r, r], [-hw, -hh, 0, r, r]);
  quad([hw, hh, -depth, r, r], [-hw, hh, -depth, r, r], [-hw, hh, 0, r, r], [hw, hh, 0, r, r]);
  quad([hw, -hh, -depth, r, r], [hw, hh, -depth, r, r], [hw, hh, 0, r, r], [hw, -hh, 0, r, r]);
  quad([-hw, hh, -depth, r, r], [-hw, -hh, -depth, r, r], [-hw, -hh, 0, r, r], [-hw, hh, 0, r, r]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// The plate: one closed slab whose two faces and four edges all take the same displacement, so it
// cannot open however it hums. Positions and normals are rewritten; UVs never are.
// ---------------------------------------------------------------------------------------------
function buildPlate() {
  const P = []; const N = []; const U = []; const I = [];
  const kind = []; // 1 top, -1 bottom, 0 edge
  const add = (x, y, z, nx, ny, nz, k) => {
    P.push(x, y, z); N.push(nx, ny, nz); U.push(toU(x), toU(z)); kind.push(k);
    return P.length / 3 - 1;
  };
  const step = L / GRID;
  const top = []; const bot = [];
  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      const x = -H + i * step; const z = -H + j * step;
      top.push(add(x, PLATE_TOP, z, 0, 1, 0, 1));
    }
  }
  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      const x = -H + i * step; const z = -H + j * step;
      bot.push(add(x, PLATE_BOTTOM, z, 0, -1, 0, -1));
    }
  }
  const at = (i, j) => j * (GRID + 1) + i;
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const a = at(i, j); const b = at(i + 1, j); const c = at(i + 1, j + 1); const d = at(i, j + 1);
      I.push(top[a], top[d], top[c], top[a], top[c], top[b]);
      I.push(bot[a], bot[b], bot[c], bot[a], bot[c], bot[d]);
    }
  }
  // The four edges, each its own strip so it keeps a sharp arris.
  const quadOut = (a, b, c, d, nx, nz) => {
    const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]];
    const pb = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]];
    const pc = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * nx + cz * nz >= 0) I.push(a, b, c, a, c, d);
    else I.push(a, c, b, a, d, c);
  };
  const sides = [
    { nx: 1, nz: 0, pt: (t) => [H, -H + t * step] },
    { nx: -1, nz: 0, pt: (t) => [-H, -H + t * step] },
    { nx: 0, nz: 1, pt: (t) => [-H + t * step, H] },
    { nx: 0, nz: -1, pt: (t) => [-H + t * step, -H] },
  ];
  for (const s of sides) {
    const up = []; const dn = [];
    for (let t = 0; t <= GRID; t++) {
      const [x, z] = s.pt(t);
      up.push(add(x, PLATE_TOP, z, s.nx, 0, s.nz, 0));
      dn.push(add(x, PLATE_BOTTOM, z, s.nx, 0, s.nz, 0));
    }
    for (let t = 0; t < GRID; t++) quadOut(dn[t], dn[t + 1], up[t + 1], up[t], s.nx, s.nz);
  }
  const geometry = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(P), 3).setUsage(THREE.DynamicDrawUsage);
  const nrm = new THREE.BufferAttribute(new Float32Array(N), 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', pos);
  geometry.setAttribute('normal', nrm);
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(U), 2));
  geometry.setIndex(I);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, PLATE_TOP, 0), H * Math.SQRT2 + 0.2);
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-H, PLATE_BOTTOM - HUM_AMP, -H), new THREE.Vector3(H, PLATE_TOP + HUM_AMP, H));
  return { geometry, base: new Float32Array(P), kind: new Int8Array(kind), count: kind.length };
}

// ---------------------------------------------------------------------------------------------
// The sand. Every grain is a small tetrahedron with its own size, turn and colour, all in one
// mesh. Grains only ever translate, so their normals are written once.
// ---------------------------------------------------------------------------------------------
const TETRA = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map((p) => p.map((c) => c / Math.sqrt(3)));
const TETRA_FACES = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]];

function buildSand(rng) {
  const local = new Float32Array(GRAINS * 36);
  const normals = new Float32Array(GRAINS * 36);
  const colors = new Float32Array(GRAINS * 36);
  const radius = new Float32Array(GRAINS);
  const palette = [lin(0xf4ead2), lin(0xeadcb8), lin(0xe0cfa4), lin(0xf8f2e4), lin(0xcdb88c)];
  const q = new THREE.Quaternion(); const e = new THREE.Euler(); const v = new THREE.Vector3();
  const corner = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  let rSum = 0;
  for (let g = 0; g < GRAINS; g++) {
    const r = 0.013 + rng() * 0.011;
    radius[g] = r; rSum += r;
    e.set(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);
    q.setFromEuler(e);
    const sx = 0.8 + rng() * 0.45; const sy = 0.7 + rng() * 0.35; const sz = 0.8 + rng() * 0.45;
    for (let k = 0; k < 4; k++) {
      corner[k].set(TETRA[k][0], TETRA[k][1], TETRA[k][2]).applyQuaternion(q);
      corner[k].set(corner[k].x * sx * r, corner[k].y * sy * r, corner[k].z * sz * r);
    }
    const pick = rng();
    const base = pick < 0.06 ? lin(0x9c8662) : palette[Math.floor(rng() * palette.length)];
    const shade = 0.88 + rng() * 0.2;
    for (let f = 0; f < 4; f++) {
      let [a, b, c] = TETRA_FACES[f];
      const A = corner[a]; const B = corner[b]; const C = corner[c];
      const n = new THREE.Vector3().subVectors(B, A).cross(v.subVectors(C, A)).normalize();
      const centroid = new THREE.Vector3().add(A).add(B).add(C);
      if (n.dot(centroid) < 0) { [b, c] = [c, b]; n.negate(); }
      [a, b, c].forEach((k, s) => {
        const o = g * 36 + f * 9 + s * 3;
        local[o] = corner[k].x; local[o + 1] = corner[k].y; local[o + 2] = corner[k].z;
        normals[o] = n.x; normals[o + 1] = n.y; normals[o + 2] = n.z;
        colors[o] = base[0] * shade; colors[o + 1] = base[1] * shade; colors[o + 2] = base[2] * shade;
      });
    }
  }
  const geometry = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(GRAINS * 36), 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', pos);
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(GRAINS * 24), 2));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, PLATE_TOP, 0), H * Math.SQRT2 + 0.4);
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-H, PLATE_BOTTOM, -H), new THREE.Vector3(H, PLATE_TOP + 0.4, H));
  return { geometry, local, radius, rMean: rSum / GRAINS };
}

// Where the sand of one mode settles: rejection sampling against the distance to the nearest
// nodal line, estimated to first order as |Z| / |grad Z|. Returns x, height above the plate, z
// for every grain. Seeded per mode, so a mode always settles the same way.
function settledSand(k, rMean) {
  const mode = CHLADNI_MODES[k];
  const rng = seededRandom(9001 + k * 7919);
  const out = new Float32Array(GRAINS * 3);
  const grad = [0, 0];
  const lim = H - EDGE_CLEAR;
  const nLine = Math.round(GRAINS * 0.9);
  const sample = () => {
    const x = (rng() * 2 - 1) * lim; const z = (rng() * 2 - 1) * lim;
    if (x * x + z * z < NUT_CLEAR * NUT_CLEAR) return null;
    const zz = chladniZ(mode, toU(x), toU(z), grad);
    const d = (Math.abs(zz) / Math.max(Math.hypot(grad[0], grad[1]), 0.2)) * L;
    return { x, z, d, zn: Math.abs(zz) / 2 };
  };
  // First the line grains, measuring the band's area as we go, which decides how high they pile.
  const keep = [];
  let tries = 0; let weight = 0;
  while (keep.length < nLine && tries < 4e6) {
    tries++;
    const s = sample();
    if (!s) continue;
    const p = Math.exp(-((s.d / LINE_HALF) ** 2));
    weight += p;
    if (rng() < p) keep.push(s);
  }
  const bandArea = (weight / tries) * (2 * lim) * (2 * lim);
  const coverage = (keep.length * Math.PI * rMean * rMean * 1.3) / Math.max(bandArea, 1e-3);
  const pile = Math.min(0.075, Math.max(0, 0.02 * (coverage - 0.6)));
  let g = 0;
  for (const s of keep) {
    const prof = Math.exp(-((s.d / LINE_HALF) ** 2));
    out[g * 3] = s.x; out[g * 3 + 1] = rMean * 0.55 + pile * prof * Math.sqrt(rng()); out[g * 3 + 2] = s.z;
    g++;
  }
  // A sparse scatter beside the lines: grains still hopping on their way in. None on an antinode,
  // because nothing stays on an antinode.
  tries = 0;
  while (g < GRAINS && tries < 4e6) {
    tries++;
    const s = sample();
    if (!s || s.d > LINE_HALF * 5 || s.zn > 0.16) continue;
    out[g * 3] = s.x; out[g * 3 + 1] = rMean * 0.5; out[g * 3 + 2] = s.z;
    g++;
  }
  for (; g < GRAINS; g++) { out[g * 3] = 0.3; out[g * 3 + 1] = rMean * 0.5; out[g * 3 + 2] = 0.3; }
  return out;
}

// Which new place each grain goes to: greedy nearest, grains taken in a shuffled order, from a
// grid of buckets. Sand moves to the line nearest it, which is what the sand does.
function matchGrains(from, targets, rng) {
  const B = 24; const cell = L / B;
  const buckets = Array.from({ length: B * B }, () => []);
  const cellOf = (x) => Math.min(B - 1, Math.max(0, Math.floor((x + H) / cell)));
  for (let t = 0; t < GRAINS; t++) buckets[cellOf(targets[t * 3 + 2]) * B + cellOf(targets[t * 3])].push(t);
  const order = Array.from({ length: GRAINS }, (_, i) => i);
  for (let i = GRAINS - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const to = new Float32Array(GRAINS * 3);
  for (const g of order) {
    const x = from[g * 3]; const z = from[g * 3 + 2];
    const ci = cellOf(x); const cj = cellOf(z);
    let best = -1; let bestB = -1; let bestK = -1; let bd = Infinity;
    for (let r = 0; r < B; r++) {
      if (best >= 0 && (r - 1) * cell > Math.sqrt(bd)) break;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di; const j = cj + dj;
          if (i < 0 || j < 0 || i >= B || j >= B) continue;
          const list = buckets[j * B + i];
          for (let k = 0; k < list.length; k++) {
            const t = list[k];
            const dx = targets[t * 3] - x; const dz = targets[t * 3 + 2] - z;
            const d = dx * dx + dz * dz;
            if (d < bd) { bd = d; best = t; bestB = j * B + i; bestK = k; }
          }
        }
      }
    }
    const list = buckets[bestB];
    list[bestK] = list[list.length - 1];
    list.pop();
    to[g * 3] = targets[best * 3]; to[g * 3 + 1] = targets[best * 3 + 1]; to[g * 3 + 2] = targets[best * 3 + 2];
  }
  return to;
}

// ---------------------------------------------------------------------------------------------
// The bow. Built in its own frame -- s along the hair from the button, y toward the stick -- and
// stood so that the hair rests on the plate's right edge and the button rests on the floor.
// ---------------------------------------------------------------------------------------------
const BOW_LEN = 3.25;
const stickOffset = (s) => {
  // The stick bends toward the hair in the middle, as a real bow's camber does.
  const t = clamp01(s / BOW_LEN);
  return mix(0.085, 0.075, t) - 0.05 * Math.sin(Math.PI * clamp01((s - 0.3) / 2.8));
};
const stickRadius = (s) => mix(0.024, 0.015, clamp01(s / BOW_LEN));

function bowParts(matrix) {
  const wood = []; const metal = [];
  const pts = []; const radii = [];
  for (let i = 0; i <= 28; i++) {
    const s = 0.03 + (i / 28) * (BOW_LEN - 0.03);
    pts.push([0, stickOffset(s), s]);
    radii.push(stickRadius(s));
  }
  const stick = tube(pts, radii, { sides: 10, steps: 56, round: 2 });
  stick.applyMatrix4(matrix);
  wood.push({ geometry: stick, color: 0x7a3a1e });
  // The frog, ebony, from the hair up round the stick.
  const fTop = stickOffset(0.2) + 0.012;
  wood.push({ geometry: block(0.058, fTop + 0.016, 0.34, 0, (fTop - 0.016) / 2, 0.21, matrix), color: 0x231a15 });
  // The head at the tip, with its ivory face.
  const hTop = stickOffset(BOW_LEN - 0.09) + 0.01;
  wood.push({ geometry: block(0.032, hTop + 0.014, 0.1, 0, (hTop - 0.014) / 2, BOW_LEN - 0.07, matrix), color: 0x5e2a16 });
  wood.push({ geometry: block(0.034, hTop + 0.006, 0.016, 0, (hTop - 0.006) / 2, BOW_LEN - 0.12, matrix), color: 0xe9e1cd });
  // The hair, a flat ribbon running into the frog and the head.
  wood.push({ geometry: block(0.042, 0.012, 2.87, 0, 0, 1.735, matrix), color: 0xf1ebdc });
  // The silver ferrule where the hair leaves the frog, and the screw button on the end.
  metal.push({ geometry: block(0.064, 0.03, 0.03, 0, 0.0, 0.38, matrix), color: 0xc9cbce });
  const button = turned([[0, -0.05], [0.021, -0.05], [0.024, -0.02], [0.024, 0.05], [0, 0.05]], 14, [1, 3]);
  button.rotateX(Math.PI / 2);
  button.translate(0, stickOffset(0), 0.0);
  button.applyMatrix4(matrix);
  metal.push({ geometry: button, color: 0xc9cbce });
  return { wood, metal };
}

function placeBow() {
  // The hair crosses the plate's top right edge here.
  const C = new THREE.Vector3(H + 0.004, PLATE_TOP - 0.004, 0.85);
  const F = new THREE.Vector3(3.05, 0, 1.0);
  let matrix = null;
  for (let it = 0; it < 4; it++) {
    const d = C.clone().sub(F).normalize();
    const n = new THREE.Vector3(1, 0, 0).addScaledVector(d, -d.x).normalize();
    const b = new THREE.Vector3().crossVectors(n, d).normalize();
    matrix = new THREE.Matrix4().makeBasis(b, n, d).setPosition(F);
    const { wood, metal } = bowParts(matrix);
    let minY = Infinity;
    for (const p of [...wood, ...metal]) {
      const a = p.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) minY = Math.min(minY, a.getY(i));
    }
    // Rest the lowest point on the floor, sunk a hair so it is touching rather than near.
    F.y -= minY + 0.004;
  }
  return bowParts(matrix);
}

// ---------------------------------------------------------------------------------------------
// The whole model
// ---------------------------------------------------------------------------------------------
function buildChladni(options = {}) {
  const root = new THREE.Group();
  root.name = 'chladni-plate';
  const rng = seededRandom(4242);

  // --- Wood: the plinth, the label stand and the bow's stick, frog, head and hair ---
  const wood = [];
  const metal = [];
  wood.push({ geometry: block(2.3, 0.24, 2.3, 0, 0.12, 0), color: 0x5b3a24 });
  wood.push({ geometry: block(1.8, 0.13, 1.8, 0, 0.305, 0), color: 0x6b4429 });

  // The label stands in front, clear of the plate, read the way a lectern is.
  const LX = -1.05; const LZ = 2.8; const LY = 1.45; const TILT = -45 * DEG;
  wood.push({ geometry: block(0.7, 0.07, 0.5, LX, 0.035, LZ), color: 0x5b3a24 });
  const post = turned([[0, 0.06], [0.06, 0.06], [0.05, 0.12], [0.04, 0.18], [0.04, LY - 0.05], [0, LY - 0.05]], 16, [1]);
  post.translate(LX, 0, LZ - 0.02);
  metal.push({ geometry: post, color: 0x7d7872 });
  const cardM = new THREE.Matrix4().compose(new THREE.Vector3(LX, LY, LZ), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), TILT), new THREE.Vector3(1, 1, 1));
  wood.push({ geometry: block(1.32, 0.62, 0.07, 0, 0, -0.042, cardM), color: 0x4a2f1d });

  const bow = placeBow();
  wood.push(...bow.wood);
  metal.push(...bow.metal);

  const woodMap = canvasTexture(512, 256, (c, w, h) => paintWoodGrain(c, w, h, 31));
  root.add(mesh(mergeParts(wood), standard({ vertexColors: true, map: woodMap, roughness: 0.55, metalness: 0 })));

  // --- Metal: the iron pedestal, the brass washer and nut that clamp the plate ---
  const pedestal = turned([
    [0, 0.37], [0.52, 0.37], [0.52, 0.42], [0.44, 0.47], [0.3, 0.53], [0.19, 0.62], [0.12, 0.78], [0.095, 0.95],
    [0.085, 2.05], [0.11, 2.1], [0.11, 2.17], [0.17, 2.22], [0.17, PLATE_BOTTOM], [0, PLATE_BOTTOM],
  ], 48, [1, 2, 9, 10, 11, 12]);
  metal.push({ geometry: pedestal, color: 0x7d7872 });
  const washer = turned([[0, PLATE_TOP - 0.004], [0.16, PLATE_TOP - 0.004], [0.16, PLATE_TOP + 0.022], [0, PLATE_TOP + 0.022]], 32, [1, 2]);
  metal.push({ geometry: washer, color: 0xc2a15a });
  const nut = turned([[0, PLATE_TOP + 0.02], [0.115, PLATE_TOP + 0.02], [0.115, PLATE_TOP + 0.09], [0.095, PLATE_TOP + 0.105], [0, PLATE_TOP + 0.105]], 6, [1, 2, 3]);
  metal.push({ geometry: nut, color: 0xb89650 });
  const bolt = turned([[0, PLATE_TOP + 0.1], [0.05, PLATE_TOP + 0.1], [0.05, PLATE_TOP + 0.15], [0.038, PLATE_TOP + 0.163], [0, PLATE_TOP + 0.163]], 16, [1, 2, 3]);
  metal.push({ geometry: bolt, color: 0xa9adb0 });
  root.add(mesh(mergeParts(metal), standard({ vertexColors: true, roughness: 0.45, metalness: 0.2 })));

  // --- The plate ---
  const plate = buildPlate();
  const brushed = canvasTexture(512, 512, (c, w, h) => paintBrushed(c, w, h, 23));
  const plateMesh = mesh(plate.geometry, standard({ color: 0x858b92, map: brushed, roughness: 0.36, metalness: 0.4, ...relief('metal', { seed: 17, repeat: 3, strength: 0.1 }) }));
  root.add(plateMesh);

  // --- The sand ---
  const sand = buildSand(rng);
  const sandMesh = mesh(sand.geometry, standard({ vertexColors: true, roughness: 0.92, metalness: 0 }));
  root.add(sandMesh);

  // --- The label card ---
  const labelTex = canvasTexture(1024, 470, (ctx, w, h) => paintLabel(ctx, w, h, 1, false));
  const card = printedCard(1.2, 0.52, 0.02);
  card.applyMatrix4(cardM);
  const labelMesh = mesh(card, standard({ map: labelTex, roughness: 0.75, metalness: 0 }));
  labelMesh.castShadow = false;
  root.add(labelMesh);

  // ------------------------------------------------------------------------------------------
  // State and motion
  // ------------------------------------------------------------------------------------------
  const settled = new Map();
  const settledFor = (k) => { if (!settled.has(k)) settled.set(k, settledSand(k, sand.rMean)); return settled.get(k); };
  const startMode = Math.min(CHLADNI_MODES.length, Math.max(1, Math.round(options.mode ?? 1))) - 1;
  const cur = settledFor(startMode).slice();
  let shownMode = startMode;

  const sandPos = sand.geometry.attributes.position;
  const writeSand = (xyz, humS = 0, hop = null) => {
    const arr = sandPos.array;
    const mode = CHLADNI_MODES[shownMode];
    for (let g = 0; g < GRAINS; g++) {
      const x = xyz[g * 3]; const z = xyz[g * 3 + 2];
      let y = PLATE_TOP + xyz[g * 3 + 1] + (sand.radius[g] - sand.rMean) * 0.55;
      if (humS) y += HUM_AMP * 0.5 * chladniZ(mode, toU(x), toU(z)) * humS;
      if (hop) y += hop[g];
      const o = g * 36;
      for (let k = 0; k < 36; k += 3) {
        arr[o + k] = x + sand.local[o + k];
        arr[o + k + 1] = y + sand.local[o + k + 1];
        arr[o + k + 2] = z + sand.local[o + k + 2];
      }
    }
    sandPos.needsUpdate = true;
  };
  writeSand(cur);

  // The plate's mode shape at every vertex, worked out once per mode.
  const plateZ = new Float32Array(plate.count);
  const plateGx = new Float32Array(plate.count);
  const plateGz = new Float32Array(plate.count);
  const shapePlate = (k) => {
    const mode = CHLADNI_MODES[k];
    const grad = [0, 0];
    for (let i = 0; i < plate.count; i++) {
      const x = plate.base[i * 3]; const z = plate.base[i * 3 + 2];
      plateZ[i] = chladniZ(mode, toU(x), toU(z), grad) * 0.5;
      plateGx[i] = (grad[0] * 0.5) / L; plateGz[i] = (grad[1] * 0.5) / L;
    }
  };
  shapePlate(shownMode);
  const platePos = plate.geometry.attributes.position;
  const plateNrm = plate.geometry.attributes.normal;
  let plateDirty = false;
  const writePlate = (s) => {
    const p = platePos.array; const nn = plateNrm.array;
    for (let i = 0; i < plate.count; i++) {
      p[i * 3 + 1] = plate.base[i * 3 + 1] + HUM_AMP * plateZ[i] * s;
      const k = plate.kind[i];
      if (k !== 0) {
        const gx = -HUM_AMP * plateGx[i] * s; const gz = -HUM_AMP * plateGz[i] * s;
        const inv = 1 / Math.hypot(gx, 1, gz);
        nn[i * 3] = gx * inv * k; nn[i * 3 + 1] = inv * k; nn[i * 3 + 2] = gz * inv * k;
      }
    }
    platePos.needsUpdate = true;
    plateNrm.needsUpdate = true;
  };

  let labelKey = '';
  const refreshLabel = (singing) => {
    const key = `${shownMode}|${singing}`;
    if (key === labelKey) return;
    labelKey = key;
    const canvas = labelTex.image;
    const ctx = canvas.getContext('2d');
    paintLabel(ctx, canvas.width, canvas.height, shownMode + 1, singing);
    labelTex.needsUpdate = true;
  };
  refreshLabel(false);

  // A change of note: every grain is given its place on the new pattern, and a delay that is
  // shortest where the new note shakes hardest, so the antinodes empty first.
  let move = null;
  const hop = new Float32Array(GRAINS);
  const moveRng = seededRandom(77);
  const changeTo = (k, clock) => {
    shownMode = k;
    shapePlate(k);
    const from = cur.slice();
    const to = matchGrains(from, settledFor(k), moveRng);
    if (reducedMotion()) { cur.set(to); writeSand(cur); move = null; return; }
    const mode = CHLADNI_MODES[k];
    const delay = new Float32Array(GRAINS); const hops = new Float32Array(GRAINS);
    const phase = new Float32Array(GRAINS); const jx = new Float32Array(GRAINS); const jz = new Float32Array(GRAINS);
    for (let g = 0; g < GRAINS; g++) {
      const a = Math.abs(chladniZ(mode, toU(from[g * 3]), toU(from[g * 3 + 2]))) * 0.5;
      delay[g] = (1 - a) * 0.55 + moveRng() * 0.3;
      hops[g] = 2 + Math.floor(moveRng() * 4);
      phase[g] = moveRng() * Math.PI * 2;
      const ang = moveRng() * Math.PI * 2;
      jx[g] = Math.cos(ang); jz[g] = Math.sin(ang);
    }
    move = { from, to, delay, hops, phase, jx, jz, t0: clock };
  };

  const stepMove = (clock, humS) => {
    const m = move;
    const t = clock - m.t0;
    const mode = CHLADNI_MODES[shownMode];
    const draw = new Float32Array(GRAINS * 3);
    let done = t >= MIGRATE_SECONDS;
    for (let g = 0; g < GRAINS; g++) {
      const span = Math.max(0.4, MIGRATE_SECONDS - 0.15 - m.delay[g]);
      const u = done ? 1 : clamp01((t - m.delay[g]) / span);
      const e = u * u * (3 - 2 * u);
      const x = mix(m.from[g * 3], m.to[g * 3], e);
      const yo = mix(m.from[g * 3 + 1], m.to[g * 3 + 1], e);
      const z = mix(m.from[g * 3 + 2], m.to[g * 3 + 2], e);
      cur[g * 3] = x; cur[g * 3 + 1] = yo; cur[g * 3 + 2] = z;
      // How hard the plate shakes under this grain now: that is what throws it.
      const a = done ? 0 : Math.abs(chladniZ(mode, toU(x), toU(z))) * 0.5;
      const buzz = Math.sin(clock * 47 + m.phase[g]);
      const j = a * 0.02 * buzz * (1 - u);
      draw[g * 3] = x + m.jx[g] * j; draw[g * 3 + 1] = yo; draw[g * 3 + 2] = z + m.jz[g] * j;
      const hopU = u > 0 ? u : clamp01(t / Math.max(0.05, m.delay[g])) * 0.3;
      hop[g] = done ? 0 : 0.11 * a * Math.abs(Math.sin(Math.PI * m.hops[g] * hopU + (u > 0 ? 0 : m.phase[g]))) * (1 - 0.6 * u);
    }
    writeSand(draw, humS, hop);
    if (done) move = null;
  };

  let clock = 0;
  let singing = false;
  root.userData.tick = {
    update(dt) {
      clock += Math.min(dt || 0, 0.1);
      const raw = root.userData.programVars?.get?.('mode');
      const num = Number(raw);
      const active = raw !== undefined && raw !== null && Number.isFinite(num) && num !== 0;
      if (active) {
        const k = Math.min(CHLADNI_MODES.length, Math.max(1, Math.round(num))) - 1;
        if (k !== shownMode) changeTo(k, clock);
      }
      singing = active;
      refreshLabel(singing);
      const still = reducedMotion();
      if (still && move) { cur.set(move.to); writeSand(cur); move = null; }
      const humS = singing && !still ? Math.sin(clock * Math.PI * 2 * HUM_HZ) : 0;
      if (humS !== 0) { writePlate(humS); plateDirty = true; } else if (plateDirty) { writePlate(0); plateDirty = false; }
      if (move) stepMove(clock, humS);
      // Work out where the other modes' sand settles one mode a frame while the plate sings, so
      // a change of note costs only the matching and never a whole sampling pass in one frame.
      else if (singing && settled.size < CHLADNI_MODES.length) {
        for (let k = 0; k < CHLADNI_MODES.length; k++) if (!settled.has(k)) { settledFor(k); break; }
      }
    },
    dispose() {},
  };
  return root;
}

export const BUILDERS = {
  'chladni-plate': (options) => buildChladni(options),
};
