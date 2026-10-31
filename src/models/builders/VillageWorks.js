import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seededRandom, canvasTexture, mesh, standard, relief } from '../../PropKit.js';
import { mergeParts } from '../../props/LoftKit.js';
import {
  tube, lathe, lin, clamp01, mix, sstep, outward, alongMatrix,
} from '../ModelKit.js';

// The village kit's shared works: pieces that sit among other pieces, so their dimensions are the
// point rather than a detail.
//
//   village-well          5ft across the stonework, 9ft to the ridge. The shaft is a real void.
//   granary               10ft square on exactly nine staddle stones, with steps that stop short.
//   wooden-footbridge     a 20ft arched bridge along Z over 30ft of stream along X, which tiles.
//   post-and-rail-fence   10ft along X with a post centred on each end, which a copy shares.
//
// Real life size in feet, origin at the base centre, front is +Z, no stands, no ground plates beyond
// the piece itself, fresh materials per build, seededRandom only.
//
// A NOTE ABOUT DEPTH. The terrain is a solid mesh and cannot be cut, so nothing below y = 0 can be
// seen from above. The well's water therefore stands inside its own wall, a little above the grass,
// and the depth is carried by the shaft going dark on its way down.

// ---------------------------------------------------------------------------
// The village's palette (sRGB hex, as the kit's brief gives them)
// ---------------------------------------------------------------------------
const TIMBER = 0x8a6a48;
const DARK_TIMBER = 0x5b432e;
const FIELDSTONE = 0x8f8a7e;
const SOIL = 0x6b4a2e;
const LEAF = 0x5c8f3a;
const WHEAT = 0xd9b24a;

const SHINGLE_TONES = [0x72604c, 0x7a6752, 0x6b5946, 0x77634d, 0x665441];
const STONE_TONES = [0x8f8a7e, 0x8a8275, 0x7c7c78, 0x8e7f69, 0x75716a, 0x858a84, 0x88796a];

// A linear multiply of a palette colour, so a run of planks are the same wood and not the same plank.
function varied(hex, rng, amount = 0.12) {
  const c = new THREE.Color(hex);
  const k = 1 + (rng() - 0.5) * 2 * amount;
  const warm = (rng() - 0.5) * amount * 0.4;
  c.r *= k * (1 + warm); c.g *= k; c.b *= k * (1 - warm);
  return c;
}

// ---------------------------------------------------------------------------
// Textures: near-white, because a map multiplies the vertex colour
// ---------------------------------------------------------------------------

// Long grain running along u, tiling in both directions. Used as both map and bump, so the dark of
// the grain is also its relief.
function woodMap(seed, size = 256) {
  const rng = seededRandom(seed);
  const texture = canvasTexture(size, size, (ctx, w, h) => {
    ctx.fillStyle = '#f6f2ec';
    ctx.fillRect(0, 0, w, h);
    const lines = Math.round(size * 0.22);
    for (let i = 0; i < lines; i++) {
      const y0 = rng() * h;
      const amp = rng() * size * 0.012;
      const cycles = 1 + Math.floor(rng() * 2);
      const phase = rng() * Math.PI * 2;
      const a = 0.05 + rng() * 0.16;
      ctx.strokeStyle = rng() > 0.2 ? `rgba(92,70,48,${a})` : `rgba(255,255,255,${a})`;
      ctx.lineWidth = 0.6 + rng() * 1.6;
      for (const off of [-h, 0, h]) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const y = y0 + off + Math.sin((x / w) * Math.PI * 2 * cycles + phase) * amp;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    // A few knots, each a small dark eye with the grain implied round it.
    for (let i = 0; i < 2; i++) {
      const x = rng() * w; const y = rng() * h; const r = size * (0.006 + rng() * 0.006);
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          ctx.fillStyle = 'rgba(90,64,42,0.22)';
          ctx.beginPath();
          ctx.ellipse(x + ox, y + oy, r * 2.2, r, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function woodMaterial(seed, size = 256, extra = {}) {
  const t = woodMap(seed, size);
  return standard({ vertexColors: true, map: t, bumpMap: t, bumpScale: 0.7, roughness: 0.92, metalness: 0, ...extra });
}

function stoneMaterial(seed, extra = {}) {
  return standard({ vertexColors: true, roughness: 0.96, metalness: 0, ...relief('stone', { seed, repeat: 1 }), ...extra });
}

// ---------------------------------------------------------------------------
// Boards: every plank, beam and shingle in the file is one of these
// ---------------------------------------------------------------------------
const GRAIN_U = 4; // feet of length per tile
const GRAIN_V = 1.3;

function grainUV(g, rng) {
  const P = g.attributes.position; const N = g.attributes.normal; const U = g.attributes.uv;
  const ou = rng ? rng() * 7 : 0; const ov = rng ? rng() * 7 : 0;
  for (let i = 0; i < P.count; i++) {
    const nx = Math.abs(N.getX(i)); const nz = Math.abs(N.getZ(i));
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    if (nz > 0.5) U.setXY(i, ou + x / GRAIN_V + y / GRAIN_V, ov + y / GRAIN_V); // end grain
    else if (nx > 0.5) U.setXY(i, ou + z / GRAIN_U, ov + y / GRAIN_V);
    else U.setXY(i, ou + z / GRAIN_U, ov + 0.37 + x / GRAIN_V);
  }
  return g;
}

// A squared timber from a to b. `w` runs along up x dir and `h` along the up that is left, and its
// grain runs its length.
function board(list, a, b, w, h, color, { up = [0, 1, 0], rng = null } = {}) {
  const { m, len } = alongMatrix(a, b, up);
  const g = new THREE.BoxGeometry(w, h, len);
  g.translate(0, 0, len / 2);
  grainUV(g, rng);
  g.applyMatrix4(m);
  list.push({ geometry: g, color });
}

// One vertical plank of a wall. `u0..u1` runs along the wall, `n0..n1` through it. side 'z' is a wall
// facing +/-Z and side 'x' a wall facing +/-X, reached by a true rotation about Y rather than by
// swapping axes, since a swap is a reflection and would turn the box inside out. `top(x, z)` lets a
// plank's head follow a roof line.
function wallPlank(list, side, u0, u1, n0, n1, yBot, top, color, rng) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const P = g.attributes.position;
  const U = g.attributes.uv;
  const ou = rng() * 7; const ov = rng() * 7;
  for (let i = 0; i < P.count; i++) {
    const su = P.getX(i) + 0.5; const sn = P.getZ(i) + 0.5; const isTop = P.getY(i) > 0;
    const u = mix(u0, u1, su); const n = mix(n0, n1, sn);
    const x = side === 'z' ? u : n;
    const z = side === 'z' ? n : -u;
    const y = isTop ? top(x, z) : yBot;
    P.setXYZ(i, x, y, z);
    U.setXY(i, ou + y / GRAIN_U, ov + (u + n) / GRAIN_V);
  }
  g.computeVertexNormals();
  list.push({ geometry: g, color });
}

// A wall span of planks. `pitch` is the plank width, `gap` the crack left between them.
function plankRun(list, side, from, to, n0, n1, yBot, top, tone, rng, { pitch = 1, gap = 0, amount = 0.14 } = {}) {
  const count = Math.max(1, Math.round((to - from) / pitch));
  const p = (to - from) / count;
  for (let i = 0; i < count; i++) {
    wallPlank(list, side, from + i * p + gap / 2, from + (i + 1) * p - gap / 2, n0, n1, yBot, top, varied(tone, rng, amount), rng);
  }
}

// A curved beam, its section vertical, from a table of { z, top, bot } stations. Its faces carry their
// own vertices, so its edges stay hard and it shades as sawn timber.
function curvedBeam(list, x, w, stations, color) {
  const n = stations.length;
  const positions = []; const uvs = []; const index = [];
  const corners = [
    [(s) => [x - w / 2, s.top, s.z], (s) => [x + w / 2, s.top, s.z]],
    [(s) => [x + w / 2, s.top, s.z], (s) => [x + w / 2, s.bot, s.z]],
    [(s) => [x + w / 2, s.bot, s.z], (s) => [x - w / 2, s.bot, s.z]],
    [(s) => [x - w / 2, s.bot, s.z], (s) => [x - w / 2, s.top, s.z]],
  ];
  for (const [fa, fb] of corners) {
    const base = positions.length / 3;
    for (let i = 0; i < n; i++) {
      const pa = fa(stations[i]); const pb = fb(stations[i]);
      positions.push(...pa, ...pb);
      uvs.push(stations[i].z / GRAIN_U, 0, stations[i].z / GRAIN_U, 0.5);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2; const b = a + 1; const c = a + 3; const d = a + 2;
      index.push(a, b, c, a, c, d);
    }
  }
  for (const [s, flip] of [[stations[0], true], [stations[n - 1], false]]) {
    const base = positions.length / 3;
    positions.push(x - w / 2, s.top, s.z, x + w / 2, s.top, s.z, x + w / 2, s.bot, s.z, x - w / 2, s.bot, s.z);
    uvs.push(0, 0, 0.2, 0, 0.2, 0.2, 0, 0.2);
    if (flip) index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else index.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  list.push({ geometry: outward(g), color });
}

// A roof's shingled face. Each shingle is a real thin board lying with its butt lifted off the course
// under it, which is what draws the course lines from across a field.
function shingleSlope(list, rng, { ridge, along, down, normal, L, S, expo = 0.42, lift = 0.09 }) {
  const add = (o, d, k) => [o[0] + d[0] * k, o[1] + d[1] * k, o[2] + d[2] * k];
  const len = expo * 2.15;
  let row = 0;
  for (let s = S; s > 0.02; s -= expo, row++) {
    let u = -L / 2 - (row % 2 ? 0.28 : 0);
    while (u < L / 2 - 0.02) {
      const w = 0.5 + rng() * 0.34;
      const u0 = Math.max(u, -L / 2);
      const u1 = Math.min(u + w, L / 2);
      u += w;
      if (u1 - u0 < 0.1) continue;
      const mid = (u0 + u1) / 2;
      const buttS = s + (rng() - 0.5) * 0.05;
      const topS = Math.max(0, s - len);
      const base = add(ridge, along, mid);
      const butt = add(add(base, down, buttS), normal, lift);
      const top = add(add(base, down, topS), normal, 0.015);
      const tone = SHINGLE_TONES[Math.floor(rng() * SHINGLE_TONES.length)];
      board(list, top, butt, u1 - u0 - 0.035, 0.05, varied(tone, rng, 0.05), { up: normal, rng });
    }
  }
}

// ---------------------------------------------------------------------------
// Stone
// ---------------------------------------------------------------------------

// A subdivided cube, welded, so that one set of normals runs round its corners: a closed, pillowed
// solid in a few dozen triangles. It is shaped once per stone.
function stoneUnit(su, sv, sw) {
  const g = new THREE.BoxGeometry(2, 2, 2, su, sv, sw);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return mergeVertices(g, 1e-4);
}

// Shapes a unit stone through `place(px, py, pz) -> [x, y, z]`, which must be right-handed. `paint`
// gets the unit coordinates and the finished normal.
function shapeStone(unit, rng, place, paint, { pillow = 0.62, rough = 0.1, uvScale = 1 } = {}) {
  const g = unit.clone();
  const P = g.attributes.position;
  const count = P.count;
  const s1 = rng() * 20; const s2 = rng() * 20; const s3 = rng() * 20;
  const unitPos = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    const qx = x * Math.sqrt(Math.max(0, 1 - (y * y) / 2 - (z * z) / 2 + (y * y * z * z) / 3));
    const qy = y * Math.sqrt(Math.max(0, 1 - (z * z) / 2 - (x * x) / 2 + (z * z * x * x) / 3));
    const qz = z * Math.sqrt(Math.max(0, 1 - (x * x) / 2 - (y * y) / 2 + (x * x * y * y) / 3));
    const lump = 1 + rough * (Math.sin(x * 1.9 + s1) * Math.cos(y * 2.1 + s2) + 0.6 * Math.sin(z * 2.3 + s3 + x));
    const px = mix(x, qx, pillow) * Math.min(1, lump);
    const py = mix(y, qy, pillow) * Math.min(1, lump);
    const pz = mix(z, qz, pillow) * Math.min(1, lump);
    const w = place(px, py, pz);
    P.setXYZ(i, w[0], w[1], w[2]);
    unitPos[i * 3] = px; unitPos[i * 3 + 1] = py; unitPos[i * 3 + 2] = pz;
    uvs[i * 2] = (w[0] + w[2] * 0.62) * uvScale;
    uvs[i * 2 + 1] = (w[1] + w[2] * 0.37) * uvScale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  const N = g.attributes.normal;
  const col = new Float32Array(count * 3);
  const out = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    paint(unitPos[i * 3], unitPos[i * 3 + 1], unitPos[i * 3 + 2], N.getX(i), N.getY(i), N.getZ(i), P.getX(i), P.getY(i), P.getZ(i), out);
    col[i * 3] = out[0]; col[i * 3 + 1] = out[1]; col[i * 3 + 2] = out[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// A course of curved stones round the axis. Their widths are unequal and their heights are not quite
// the course's, so no joint carries on from the course below.
function stoneCourse(parts, unit, rng, { y0, y1, rc, hd, count, shade, seat = 1 }) {
  const widths = [];
  let total = 0;
  for (let i = 0; i < count; i++) { const w = 0.66 + rng() * 0.7; widths.push(w); total += w; }
  let a = rng() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const ang = (widths[i] / total) * Math.PI * 2;
    const tc = a + ang / 2;
    a += ang;
    const hw = (ang / 2) * 1.02;
    const hh = ((y1 - y0) / 2) * (0.96 + rng() * 0.12);
    const yc = (y0 + y1) / 2 + (rng() - 0.5) * 0.03;
    const proud = hd * (0.86 + rng() * 0.14);
    const tone = lin(STONE_TONES[Math.floor(rng() * STONE_TONES.length)]);
    const k = 0.74 + rng() * 0.26;
    const g = shapeStone(unit, rng, (px, py, pz) => {
      const t = tc + px * hw;
      const r = rc + pz * (seat > 0 ? proud : hd);
      return [Math.sin(t) * r, yc + py * hh, Math.cos(t) * r];
    }, (px, py, pz, nx, ny, nz, x, y, z, out) => {
      // The joints are darker than the faces, which is what draws the courses.
      const face = sstep(pz * seat, -0.25, 0.8);
      const b = k * mix(0.6, 1.08, face) * (shade ? shade(y) : 1);
      out[0] = tone[0] * b; out[1] = tone[1] * b; out[2] = tone[2] * b;
    }, { pillow: 0.5, rough: 0.07 });
    parts.push({ geometry: g, keepColor: true });
  }
}

// ---------------------------------------------------------------------------
// The well
// ---------------------------------------------------------------------------
const WELL_OUTER = 2.5; // 5ft across the stone
const WELL_SHAFT = 1.8; // the shaft's own radius, before its lining stones
const WELL_RIM = 3.04;
const WATER_Y = 0.42;

function villageWell() {
  const stone = [];
  const wood = [];
  const iron = [];
  const water = [];
  const rng = seededRandom(5081);
  const outerUnit = stoneUnit(3, 2, 1);
  const innerUnit = stoneUnit(2, 1, 1);
  const capUnit = stoneUnit(4, 1, 2);

  // --- the void first: one closed solid, the wall's core with a real shaft going down through it, and
  // its floor under the water. Mortar, which the stones are set proud of, and which is near black in
  // the shaft.
  const core = lathe([
    [0, -0.4], [2.4, -0.4], [2.4, 2.84], [WELL_SHAFT, 2.84], [WELL_SHAFT, 0.3], [0, 0.3],
  ], 40);
  const mortar = lin(0x3b352d);
  const pit = lin(0x0c0d0c);
  {
    const P = core.attributes.position;
    const col = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      const r = Math.hypot(P.getX(i), P.getZ(i));
      const t = r < WELL_SHAFT + 0.02 ? 1 - sstep(P.getY(i), 0.4, 2.8) * 0.5 : 0;
      col[i * 3] = mix(mortar[0], pit[0], t); col[i * 3 + 1] = mix(mortar[1], pit[1], t); col[i * 3 + 2] = mix(mortar[2], pit[2], t);
    }
    core.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const uv = core.attributes.uv;
    for (let i = 0; i < P.count; i++) uv.setXY(i, P.getX(i) + P.getZ(i) * 0.62, P.getY(i) + P.getZ(i) * 0.37);
  }
  stone.push({ geometry: core, keepColor: true });

  // --- the outer face, course on course, bedded below the grass line.
  const courses = [0.5, 0.56, 0.44, 0.6, 0.48, 0.58, 0.5];
  let y = -0.36;
  for (const h of courses) {
    const top = Math.min(y + h, 2.82);
    const count = Math.round((Math.PI * 2 * 2.4) / (0.95 + rng() * 0.25));
    stoneCourse(stone, outerUnit, rng, { y0: y, y1: top, rc: 2.36, hd: WELL_OUTER - 2.36, count, shade: (v) => mix(0.82, 1, sstep(v, -0.2, 1.2)) });
    y = top;
    if (y >= 2.82) break;
  }

  // --- the shaft's lining, going dark on its way down to the water, so that 2.6ft of shaft reads as
  // the mouth of something much deeper.
  const liningShade = (v) => mix(0.08, 0.72, sstep(v, WATER_Y, 2.85) ** 1.6);
  y = WATER_Y - 0.1;
  for (const h of [0.5, 0.46, 0.56, 0.48, 0.52, 0.44]) {
    const top = Math.min(y + h, 2.84);
    stoneCourse(stone, innerUnit, rng, { y0: y, y1: top, rc: 1.88, hd: 0.12, count: 8 + Math.floor(rng() * 2), shade: liningShade, seat: -1 });
    y = top;
    if (y >= 2.84) break;
  }

  // --- the coping, big flat stones right across the wall's thickness.
  stoneCourse(stone, capUnit, rng, { y0: 2.76, y1: WELL_RIM, rc: 2.13, hd: WELL_OUTER - 2.13, count: 12 });

  // --- the water, a dark disc with the sky lying in the middle of it.
  {
    const rows = [];
    for (let i = 0; i <= 5; i++) rows.push([(i / 5) * 1.86, WATER_Y]);
    const g = lathe([[0, 0.28], [1.86, 0.28], ...rows.slice().reverse()], 20);
    const deep = lin(0x0d2027); const sky = lin(0x3f6f85);
    const P = g.attributes.position;
    const col = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      const r = Math.hypot(P.getX(i), P.getZ(i)) / 1.86;
      const ripple = 0.5 + 0.5 * Math.cos(r * 19);
      const t = (1 - sstep(r, 0.18, 0.78)) * 0.9 + ripple * 0.08 * (1 - r);
      col[i * 3] = mix(deep[0], sky[0], t); col[i * 3 + 1] = mix(deep[1], sky[1], t); col[i * 3 + 2] = mix(deep[2], sky[2], t);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    water.push({ geometry: outward(g), keepColor: true });
  }

  // --- the frame: two uprights set in the wall, a tie beam across each, and the ridge on their heads.
  const POST_X = 2.12;
  const AXLE_Y = 5.6;
  const RIDGE_Y = 8.86; // top of the rafters, on the centre line
  const PITCH = 0.72;
  const EAVE_Z = 2.92;
  const rafterTop = (z) => RIDGE_Y - PITCH * Math.abs(z);
  const roofLen = 6.1;
  for (const sx of [-1, 1]) {
    const x = sx * POST_X;
    board(wood, [x, 1.4, 0], [x, RIDGE_Y - 0.1, 0], 0.46, 0.46, varied(DARK_TIMBER, rng, 0.08), { up: [0, 0, 1], rng });
    board(wood, [x, 6.72, -2.72], [x, 6.72, 2.72], 0.32, 0.34, varied(DARK_TIMBER, rng, 0.08), { rng });
    for (const sz of [-1, 1]) {
      board(wood, [x, 5.92, sz * 0.1], [x, 6.62, sz * 1.1], 0.22, 0.2, varied(DARK_TIMBER, rng, 0.08), { up: [0, 1, 0], rng });
    }
    // The gable, boarded in behind the frame.
    const planks = 5;
    for (let i = 0; i < planks; i++) {
      const z0 = -2.5 + (5 * i) / planks; const z1 = z0 + 5 / planks;
      const yTop = (px, pz) => rafterTop(pz) - 0.24;
      wallPlank(wood, 'x', -z1 + 0.012, -z0 - 0.012, x - 0.08, x + 0.08, 6.8, yTop, varied(TIMBER, rng, 0.14), rng);
    }
  }
  board(wood, [-roofLen / 2, RIDGE_Y - 0.26, 0], [roofLen / 2, RIDGE_Y - 0.26, 0], 0.3, 0.38, varied(DARK_TIMBER, rng, 0.08), { rng });
  const eaveDown = new THREE.Vector3(0, -PITCH, 1).normalize();
  for (const sz of [-1, 1]) {
    const down = [0, eaveDown.y, eaveDown.z * sz];
    const normal = [0, eaveDown.z, -eaveDown.y * sz];
    const S = EAVE_Z / eaveDown.z;
    // Eave plate.
    const py = rafterTop(2.5) - 0.16;
    board(wood, [-roofLen / 2 + 0.05, py, sz * 2.5], [roofLen / 2 - 0.05, py, sz * 2.5], 0.28, 0.26, varied(DARK_TIMBER, rng, 0.08), { rng });
    // Rafters, then the deck that closes the roof, then the shingles.
    for (const x of [-2.96, -1.5, 0, 1.5, 2.96]) {
      const off = 0.11;
      board(wood, [x, RIDGE_Y - off, 0], [x, rafterTop(EAVE_Z) - off, sz * EAVE_Z], 0.18, 0.22, varied(TIMBER, rng, 0.14), { up: normal, rng });
    }
    const deckA = [0, RIDGE_Y + 0.05, 0];
    const deckB = [0, rafterTop(EAVE_Z) + 0.05, sz * EAVE_Z];
    board(wood, deckA, deckB, roofLen, 0.1, varied(TIMBER, rng, 0.06), { up: normal, rng });
    shingleSlope(wood, rng, {
      ridge: [0, RIDGE_Y + 0.08, 0], along: [1, 0, 0], down, normal, L: roofLen + 0.1, S: S + 0.05, expo: 0.48, lift: 0.08,
    });
    // Barge boards, covering the ends of the courses.
    for (const sx of [-1, 1]) {
      const bx = sx * (roofLen / 2 + 0.05);
      board(wood, [bx, RIDGE_Y + 0.02, 0], [bx, rafterTop(EAVE_Z + 0.04) + 0.02, sz * (EAVE_Z + 0.04)], 0.1, 0.36, varied(DARK_TIMBER, rng, 0.08), { up: normal, rng });
    }
    // Half of the ridge roll.
    board(wood, [-roofLen / 2 - 0.05, RIDGE_Y + 0.17, sz * 0.14], [roofLen / 2 + 0.05, RIDGE_Y + 0.17, sz * 0.14], 0.36, 0.08, varied(DARK_TIMBER, rng, 0.06), { up: normal, rng });
  }

  // --- the windlass: a log drum, its axle through both uprights, and an iron crank on the +X end.
  wood.push({
    geometry: tube([[-POST_X + 0.25, AXLE_Y, 0], [-1, AXLE_Y, 0.004], [0, AXLE_Y, -0.004], [1, AXLE_Y, 0.004], [POST_X - 0.25, AXLE_Y, 0]],
      [0.3, 0.3, 0.29, 0.31, 0.3], { sides: 14, steps: 8, round: 1 }),
    color: 0x7a5c3e,
  });
  wood.push({
    geometry: tube([[-POST_X - 0.42, AXLE_Y, 0], [POST_X + 0.42, AXLE_Y, 0]], 0.12, { sides: 10, steps: 1, straight: true, round: 1 }),
    color: DARK_TIMBER,
  });
  for (const x of [-POST_X + 0.3, POST_X - 0.3]) {
    const band = new THREE.TorusGeometry(0.31, 0.03, 5, 18);
    band.rotateY(Math.PI / 2);
    band.translate(x, AXLE_Y, 0);
    iron.push({ geometry: band, color: 0x3a3836 });
  }
  const crankA = [POST_X + 0.3, AXLE_Y, 0];
  const crankB = [POST_X + 0.62, AXLE_Y, 0];
  const armAngle = 0.5;
  const crankC = [POST_X + 0.62, AXLE_Y - Math.cos(armAngle) * 0.85, Math.sin(armAngle) * 0.85];
  const crankD = [POST_X + 1.32, crankC[1], crankC[2]];
  iron.push({ geometry: tube([crankA, crankB], 0.065, { sides: 8, steps: 1, straight: true, round: 1 }), color: 0x3a3836 });
  iron.push({ geometry: tube([crankB, crankC], 0.06, { sides: 8, steps: 1, straight: true, round: 1 }), color: 0x3a3836 });
  iron.push({ geometry: tube([crankC, [POST_X + 0.82, crankC[1], crankC[2]]], 0.06, { sides: 8, steps: 1, straight: true, round: 1 }), color: 0x3a3836 });
  for (const p of [crankB, crankC]) {
    const ball = new THREE.SphereGeometry(0.085, 8, 5);
    ball.translate(p[0], p[1], p[2]);
    iron.push({ geometry: ball, color: 0x3a3836 });
  }
  wood.push({ geometry: tube([[POST_X + 0.78, crankC[1], crankC[2]], crankD], 0.095, { sides: 10, steps: 1, straight: true, round: 2 }), color: 0x6a4d32 });

  // --- the rope: wound on the drum, leaving it at the front and hanging straight down to the bucket.
  const ROPE_R = 0.05;
  const COIL_R = 0.3 + ROPE_R * 0.7;
  const wraps = 7;
  const coilFrom = -0.9;
  const ropePts = [];
  const perWrap = 11;
  const coilN = wraps * perWrap;
  for (let i = 0; i <= coilN; i++) {
    const t = i / coilN;
    const phi = (1 - t) * wraps * Math.PI * 2; // ends at phi = 0, the front of the drum, going down
    ropePts.push([mix(coilFrom, 0, t), AXLE_Y + COIL_R * Math.sin(phi), COIL_R * Math.cos(phi)]);
  }
  const BUCKET_TOP = 4.28;
  const BUCKET_BOTTOM = 3.22;
  const BAIL_RISE = 0.5;
  const knotY = BUCKET_TOP + BAIL_RISE + 0.04;
  for (let i = 1; i <= 4; i++) ropePts.push([0, AXLE_Y - (i / 4) * (AXLE_Y - knotY), COIL_R]);
  const rope = tube(ropePts, ROPE_R, { sides: 5, steps: ropePts.length - 1, round: 1 });
  // The twist of the lay: light and dark bands wound along the rope's length.
  {
    const P = rope.attributes.position;
    const col = new Float32Array(P.count * 3);
    const light = lin(0xc8a86e); const dark = lin(0x8d7244);
    const sides = 5;
    for (let i = 0; i < P.count; i++) {
      const row = Math.floor(i / sides); const j = i % sides;
      const t = ((row + j * 0.4) % 2) < 1 ? 0.15 : 0.85;
      col[i * 3] = mix(light[0], dark[0], t); col[i * 3 + 1] = mix(light[1], dark[1], t); col[i * 3 + 2] = mix(light[2], dark[2], t);
    }
    rope.setAttribute('color', new THREE.BufferAttribute(col, 3));
    iron.push({ geometry: rope, keepColor: true });
  }
  // The knot, where rope meets bail.
  {
    const knot = new THREE.SphereGeometry(0.11, 8, 6);
    knot.translate(0, knotY, COIL_R);
    iron.push({ geometry: knot, color: 0xa88a58 });
  }

  // --- the bucket, staved and hooped, hanging over the middle of the shaft.
  const bz = COIL_R;
  {
    const Rb = 0.42; const Rt = 0.54;
    const cup = lathe([
      [0, BUCKET_BOTTOM + 0.02], [Rb - 0.02, BUCKET_BOTTOM + 0.02], [Rt - 0.03, BUCKET_TOP - 0.02], [Rt - 0.08, BUCKET_TOP - 0.02],
      [Rb - 0.08, BUCKET_BOTTOM + 0.2], [0, BUCKET_BOTTOM + 0.2],
    ], 14);
    cup.translate(0, 0, bz);
    const inside = lin(0x241a10);
    wood.push({ geometry: cup, color: new THREE.Color().setRGB(inside[0], inside[1], inside[2]) });
    const staves = 14;
    for (let i = 0; i < staves; i++) {
      const a = (i / staves) * Math.PI * 2;
      const dir = [Math.sin(a), 0, Math.cos(a)];
      const p0 = [dir[0] * Rb, BUCKET_BOTTOM, bz + dir[2] * Rb];
      const p1 = [dir[0] * Rt, BUCKET_TOP + (i % 3 === 0 ? 0.02 : 0), bz + dir[2] * Rt];
      board(wood, p0, p1, 2 * Rt * Math.tan(Math.PI / staves) * 1.02, 0.07, varied(TIMBER, rng, 0.18), { up: dir, rng });
    }
    for (const [t, tone] of [[0.17, 0x3a3836], [0.8, 0x3a3836]]) {
      const hoop = new THREE.TorusGeometry(mix(Rb, Rt, t) + 0.045, 0.028, 5, 20);
      hoop.rotateX(Math.PI / 2);
      hoop.translate(0, mix(BUCKET_BOTTOM, BUCKET_TOP, t), bz);
      iron.push({ geometry: hoop, color: tone });
    }
    // The bail: an iron hoop pivoting on two lugs.
    const bail = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI;
      bail.push([-Math.cos(a) * (Rt + 0.05), BUCKET_TOP - 0.1 + Math.sin(a) * (BAIL_RISE + 0.1), bz]);
    }
    iron.push({ geometry: tube(bail, 0.03, { sides: 6, steps: 12, round: 1 }), color: 0x3a3836 });
  }

  const group = new THREE.Group();
  group.add(mesh(mergeParts(stone), stoneMaterial(62)));
  group.add(mesh(mergeParts(wood), woodMaterial(63)));
  group.add(mesh(mergeParts(iron), standard({ vertexColors: true, roughness: 0.82, metalness: 0.2 })));
  const surface = mesh(mergeParts(water), standard({ vertexColors: true, roughness: 0.22, metalness: 0 }));
  surface.castShadow = false;
  group.add(surface);
  return group;
}

// ---------------------------------------------------------------------------
// The granary
// ---------------------------------------------------------------------------

// A closed, gathered sack standing on y = 0. Five folds where the neck is gathered, a cord round them.
function sackGeometry(rng, h, r) {
  const g = lathe([
    [0, 0], [r * 0.72, 0], [r * 0.95, h * 0.06], [r * 1.03, h * 0.26], [r * 0.99, h * 0.5], [r * 0.86, h * 0.68],
    [r * 0.46, h * 0.8], [r * 0.2, h * 0.85], [r * 0.2, h * 0.88], [r * 0.34, h * 0.97], [r * 0.28, h], [0, h * 0.97],
  ], 24);
  const P = g.attributes.position;
  const p1 = rng() * 6; const p2 = rng() * 6;
  const flopAt = (v) => [Math.cos(p2) * v * v * r * 0.34, Math.sin(p2) * v * v * r * 0.34];
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    const t = Math.atan2(x, z);
    const v = y / h;
    const fold = sstep(v, 0.5, 0.86) * 0.28 * Math.sin(t * 6 + p1);
    const slump = (1 - sstep(v, 0.55, 0.85)) * (0.1 * Math.sin(t * 2 + p2) + 0.06 * Math.sin(t * 3 + p1) + 0.05 * Math.sin(v * 7 + t + p2));
    const k = 1 + fold + slump;
    // The top of a full sack flops over to one side; the bottom spreads on what it stands on.
    const flop = flopAt(v);
    const spread = 1 + 0.09 * (1 - sstep(v, 0.02, 0.26));
    P.setXYZ(i, x * k * spread + flop[0], y, z * k * spread * 0.82 + flop[1]);
  }
  const uv = g.attributes.uv;
  for (let i = 0; i < P.count; i++) uv.setXY(i, (P.getX(i) + P.getZ(i) * 0.62) * 0.8, (P.getY(i) + P.getZ(i) * 0.37) * 0.8);
  g.computeVertexNormals();
  return { g, neck: flopAt(0.865) };
}

function placeSack(sacks, rng, x, y, z, { h = 2.3, r = 0.74, yaw = 0, lean = 0 } = {}) {
  const { g, neck } = sackGeometry(rng, h, r);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, yaw, 0));
  g.applyQuaternion(q);
  g.translate(x, y, z);
  sacks.push({ geometry: g, color: varied(0xb79a6b, rng, 0.1) });
  const cord = new THREE.TorusGeometry(r * 0.21, 0.04, 5, 12);
  cord.rotateX(Math.PI / 2);
  cord.scale(1, 1, 0.82);
  cord.translate(neck[0], h * 0.865, neck[1]);
  cord.applyQuaternion(q);
  cord.translate(x, y, z);
  sacks.push({ geometry: cord, color: 0x6d5536 });
}

const GRANARY_HALF = 5;
const STADDLE_TOP = 2.5;
const GRANARY_FLOOR = 3.05;

function staddleStone(rng, x, z) {
  const g = lathe([
    [0, -0.4], [0.66, -0.4], [0.64, 0], [0.56, 0.35], [0.45, 0.85], [0.37, 1.35], [0.34, 1.68],
    [0.42, 1.76], [0.84, 1.88], [1.06, 2.02], [1.1, 2.16], [1.02, 2.32], [0.72, 2.45], [0, STADDLE_TOP],
  ], 22);
  const P = g.attributes.position;
  const s1 = rng() * 9; const s2 = rng() * 9;
  for (let i = 0; i < P.count; i++) {
    const px = P.getX(i); const y = P.getY(i); const pz = P.getZ(i);
    const t = Math.atan2(px, pz);
    const k = 1 + 0.035 * Math.sin(t * 3 + s1 + y) + 0.025 * Math.sin(t * 5 + s2 - y * 2);
    P.setXYZ(i, px * k, y, pz * k);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv;
  const tone = lin(STONE_TONES[Math.floor(rng() * STONE_TONES.length)]);
  const lichen = lin(0x8b9154);
  const col = new Float32Array(P.count * 3);
  const b = 0.92 + rng() * 0.2;
  for (let i = 0; i < P.count; i++) {
    const px = P.getX(i); const y = P.getY(i); const pz = P.getZ(i);
    uv.setXY(i, px + pz * 0.62, y + pz * 0.37);
    const patch = 0.5 + 0.5 * Math.sin(px * 3.1 + s1) * Math.sin(pz * 2.7 + s2);
    const moss = sstep(patch, 0.68, 0.95) * sstep(y, 1.75, 2.1) * 0.5;
    const ground = mix(0.62, 1, sstep(y, -0.1, 0.8));
    col[i * 3] = mix(tone[0], lichen[0], moss) * b * ground;
    col[i * 3 + 1] = mix(tone[1], lichen[1], moss) * b * ground;
    col[i * 3 + 2] = mix(tone[2], lichen[2], moss) * b * ground;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.translate(x, 0, z);
  return g;
}

function granary() {
  const stone = [];
  const wood = [];
  const sacks = [];
  const rng = seededRandom(7719);
  const H = GRANARY_HALF;

  // --- exactly nine staddle stones, three by three, under the three-by-three grid of sills.
  const GRID = [-3.9, 0, 3.9];
  const staddles = GRID.flatMap((x) => GRID.map((z) => [x, z]));
  if (staddles.length !== 9) throw new Error('A granary stands on exactly nine staddle stones.');
  for (const [x, z] of staddles) stone.push({ geometry: staddleStone(rng, x, z), keepColor: true });

  // --- the roof's numbers come first, since the walls run up to it.
  const RIDGE = 12.0; // top of the deck on the centre line
  const SLOPE = 0.5565;
  const EAVE_X = 5.75;
  const ROOF_L = 11.4;
  const deckTop = (x) => RIDGE - SLOPE * Math.abs(x);
  const wallHead = (x) => deckTop(x) - 0.14; // a little way into the deck, so no crack shows inside

  // --- the undercarriage: a grid of sills sitting on the caps. The stones' caps meet them just above
  // y = 2.5, with nothing else from there to the ground.
  const SILL_Y = 2.47;
  for (const v of GRID) {
    board(wood, [v, SILL_Y + 0.21, -H + 0.1], [v, SILL_Y + 0.21, H - 0.1], 0.44, 0.42, varied(DARK_TIMBER, rng, 0.1), { rng });
  }
  for (const v of [-3.9, 3.9]) {
    board(wood, [-H + 0.1, SILL_Y + 0.23, v], [H - 0.1, SILL_Y + 0.23, v], 0.42, 0.44, varied(DARK_TIMBER, rng, 0.1), { rng });
  }
  // Joists and the floor. The floor boards run across X and close the room from below.
  for (const x of [-2, 2]) board(wood, [x, 2.76, -H + 0.2], [x, 2.76, H - 0.2], 0.24, 0.2, varied(DARK_TIMBER, rng, 0.1), { rng });
  const floorBoards = 15;
  for (let i = 0; i < floorBoards; i++) {
    const z0 = -H + (i * 2 * H) / floorBoards; const z1 = z0 + (2 * H) / floorBoards;
    const zc = (z0 + z1) / 2;
    board(wood, [-H, GRANARY_FLOOR - 0.09, zc], [H, GRANARY_FLOOR - 0.09, zc], z1 - z0 - 0.015, 0.18, varied(TIMBER, rng, 0.16), { rng });
  }
  // The ring beam round the floor, which everything above stands on.
  const RING_Y = 2.8;
  for (const s of [-1, 1]) {
    board(wood, [-H - 0.14, RING_Y, s * (H - 0.04)], [H + 0.14, RING_Y, s * (H - 0.04)], 0.36, 0.46, varied(DARK_TIMBER, rng, 0.08), { rng });
    board(wood, [s * (H - 0.04), RING_Y + 0.003, -H - 0.14], [s * (H - 0.04), RING_Y + 0.003, H + 0.14], 0.36, 0.45, varied(DARK_TIMBER, rng, 0.08), { rng });
  }

  // --- the walls: an inner skin of boards (what a student standing inside sees), a dark core, and an
  // outer skin of boards with battens over the joints. They have real thickness, and because each
  // skin is complete there is no place to see through.
  const IN0 = H - 0.45; const IN1 = H - 0.28; const CORE1 = H - 0.24; const OUT1 = H;
  const DOOR_W = 1.5; const DOOR_HEAD = 9.05;
  const front = [[-H, -DOOR_W], [DOOR_W, H]];
  const yWall = 2.95;
  const innerTone = 0x8f6f4c;
  const skins = (side, s, spans, top) => {
    for (const [a, b] of spans) {
      const nIn = s > 0 ? [IN0, IN1] : [-IN1, -IN0];
      const nCore = s > 0 ? [IN1, CORE1] : [-CORE1, -IN1];
      const nOut = s > 0 ? [CORE1, OUT1] : [-OUT1, -CORE1];
      plankRun(wood, side, a, b, nIn[0], nIn[1], yWall, top, innerTone, rng, { pitch: 0.95, gap: 0.012, amount: 0.15 });
      plankRun(wood, side, a, b, nCore[0], nCore[1], yWall, top, 0x2a2118, rng, { pitch: 2.1, gap: 0, amount: 0.02 });
      plankRun(wood, side, a, b, nOut[0], nOut[1], yWall, top, TIMBER, rng, { pitch: 1.15, gap: 0.03, amount: 0.18 });
    }
  };
  const flat = (x) => wallHead(x);
  skins('z', 1, front, flat); // the front, either side of the door
  skins('z', -1, [[-H, H]], flat);
  skins('x', 1, [[-H, H]], flat);
  skins('x', -1, [[-H, H]], flat);

  // The door is a real opening: nothing above except the short planks over its head.
  for (const [n0, n1, tone, pitch, gap] of [[IN0, IN1, innerTone, 0.95, 0.012], [IN1, CORE1, 0x2a2118, 3, 0], [CORE1, OUT1, TIMBER, 1.15, 0.03]]) {
    plankRun(wood, 'z', -DOOR_W, DOOR_W, n0, n1, DOOR_HEAD, flat, tone, rng, { pitch, gap, amount: 0.16 });
  }

  // Battens over the outer joints, on the three plain walls and either side of the door.
  const battens = (side, s, from, to, yBot, top) => {
    const count = Math.round((to - from) / 1.15);
    for (let i = 1; i < count; i++) {
      const u = from + (i * (to - from)) / count;
      const n = s > 0 ? [H - 0.01, H + 0.055] : [-H - 0.055, -H + 0.01];
      wallPlank(wood, side, u - 0.1, u + 0.1, n[0], n[1], yBot, top, varied(TIMBER, rng, 0.2), rng);
    }
  };
  const battenTop = (x) => wallHead(x) - 0.06;
  battens('z', -1, -H, H, 3.0, battenTop);
  battens('x', 1, -H, H, 3.0, battenTop);
  battens('x', -1, -H, H, 3.0, battenTop);
  battens('z', 1, -H, -DOOR_W, 3.0, battenTop);
  battens('z', 1, DOOR_W, H, 3.0, battenTop);
  battens('z', 1, -DOOR_W, DOOR_W, DOOR_HEAD + 0.3, battenTop);

  // The heavy frame on the outside: corner posts, a girt round the middle, and a plate at the eaves.
  const POST = H - 0.02;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      board(wood, [sx * POST, 2.6, sz * POST], [sx * POST, wallHead(POST) - 0.05, sz * POST], 0.44, 0.44, varied(DARK_TIMBER, rng, 0.08), { up: [0, 0, 1], rng });
    }
  }
  const girt = 6.2;
  for (const s of [-1, 1]) {
    board(wood, [s * (H + 0.02), girt, -H], [s * (H + 0.02), girt, H], 0.2, 0.34, varied(DARK_TIMBER, rng, 0.1), { rng });
    board(wood, [-H, girt, -(H + 0.02)], [H, girt, -(H + 0.02)], 0.2, 0.34, varied(DARK_TIMBER, rng, 0.1), { rng });
  }
  for (const [a, b] of front) board(wood, [a, girt, H + 0.02], [b, girt, H + 0.02], 0.2, 0.34, varied(DARK_TIMBER, rng, 0.1), { rng });
  for (const s of [-1, 1]) {
    const y = wallHead(H) - 0.22;
    board(wood, [s * (H + 0.02), y, -H], [s * (H + 0.02), y, H], 0.2, 0.34, varied(DARK_TIMBER, rng, 0.1), { rng });
  }

  // The door frame, and the threshold the steps do not reach.
  for (const s of [-1, 1]) {
    board(wood, [s * (DOOR_W + 0.13), 3.0, H - 0.2], [s * (DOOR_W + 0.13), DOOR_HEAD + 0.1, H - 0.2], 0.26, 0.56, varied(DARK_TIMBER, rng, 0.06), { up: [0, 0, 1], rng });
  }
  board(wood, [-DOOR_W - 0.3, DOOR_HEAD + 0.17, H - 0.2], [DOOR_W + 0.3, DOOR_HEAD + 0.17, H - 0.2], 0.56, 0.28, varied(DARK_TIMBER, rng, 0.06), { rng });
  const THRESHOLD_FRONT = H + 0.15;
  board(wood, [-DOOR_W, GRANARY_FLOOR - 0.02, H - 0.1], [DOOR_W, GRANARY_FLOOR - 0.02, H - 0.1], 0.5, 0.14, varied(DARK_TIMBER, rng, 0.06), { rng });

  // The door leaf, swung right back against the wall so the way in is open: boards, two ledges, a
  // brace, and iron strap hinges on the +X jamb.
  {
    const hinge = [DOOR_W + 0.06, H + 0.19];
    const a = 0.13; // radians off the wall
    const d = [Math.cos(a), Math.sin(a)];
    const nrm = [-Math.sin(a), Math.cos(a)];
    const leafW = DOOR_W * 2 - 0.1;
    const y0 = GRANARY_FLOOR + 0.06; const y1 = DOOR_HEAD - 0.04;
    const at = (u, y, n = 0) => [hinge[0] + d[0] * u + nrm[0] * n, y, hinge[1] + d[1] * u + nrm[1] * n];
    const up = [nrm[0], 0, nrm[1]];
    const count = 5;
    for (let i = 0; i < count; i++) {
      const u = ((i + 0.5) / count) * leafW;
      board(wood, at(u, y0), at(u, y1), leafW / count - 0.02, 0.1, varied(TIMBER, rng, 0.16), { up, rng });
    }
    for (const y of [y0 + 0.7, y1 - 0.7]) {
      board(wood, at(0.08, y, 0.09), at(leafW - 0.08, y, 0.09), 0.08, 0.34, varied(DARK_TIMBER, rng, 0.08), { up: [0, 1, 0], rng });
      board(wood, at(0.0, y, 0.15), at(leafW * 0.68, y, 0.15), 0.035, 0.13, 0x35302b, { up: [0, 1, 0], rng }); // strap
    }
    board(wood, at(0.2, y0 + 0.85, 0.08), at(leafW - 0.2, y1 - 0.85, 0.08), 0.08, 0.3, varied(DARK_TIMBER, rng, 0.08), { up, rng });
  }

  // --- the roof: rafters inside (the student can see them), a closed deck, shingles, barges, a ridge.
  const eaveDir = new THREE.Vector3(1, -SLOPE, 0).normalize();
  for (const s of [-1, 1]) {
    const down = [eaveDir.x * s, eaveDir.y, 0];
    const normal = [-eaveDir.y * s, eaveDir.x, 0];
    const S = EAVE_X / eaveDir.x;
    const deckY = (x) => deckTop(x) - 0.09;
    board(wood, [0, deckY(0), 0], [s * EAVE_X, deckY(EAVE_X), 0], ROOF_L, 0.18, varied(0xb8966e, rng, 0.05), { up: normal, rng });
    for (let i = 0; i < 7; i++) {
      const z = -ROOF_L / 2 + 0.12 + (i * (ROOF_L - 0.24)) / 6;
      const off = 0.34;
      board(wood, [0, deckTop(0) - off, z], [s * (EAVE_X - 0.02), deckTop(EAVE_X) - off, z], 0.2, 0.3, varied(0x9a7a56, rng, 0.1), { up: normal, rng });
    }
    shingleSlope(wood, rng, {
      ridge: [0, RIDGE + 0.02, 0], along: [0, 0, 1], down, normal, L: ROOF_L + 0.1, S: S + 0.06, expo: 0.56, lift: 0.1,
    });
    for (const sz of [-1, 1]) {
      const bz = sz * (ROOF_L / 2 + 0.06);
      board(wood, [0, deckTop(0) - 0.12, bz], [s * (EAVE_X + 0.04), deckTop(EAVE_X + 0.04) - 0.12, bz], 0.12, 0.52, varied(DARK_TIMBER, rng, 0.08), { up: normal, rng });
    }
    board(wood, [s * 0.2, RIDGE + 0.1, -ROOF_L / 2 - 0.1], [s * 0.2, RIDGE + 0.1, ROOF_L / 2 + 0.1], 0.5, 0.09, varied(DARK_TIMBER, rng, 0.06), { up: normal, rng });
  }
  // Ties across the room, high up.
  for (const z of [-2.6, 2.6]) board(wood, [-H + 0.4, 9.2, z], [H - 0.4, 9.2, z], 0.26, 0.3, varied(DARK_TIMBER, rng, 0.08), { rng });
  // Studs on the inside faces of the walls.
  for (const s of [-1, 1]) {
    for (const z of [-2.6, 0, 2.6]) board(wood, [s * (IN0 - 0.08), GRANARY_FLOOR, z], [s * (IN0 - 0.08), wallHead(IN0) - 0.05, z], 0.26, 0.16, varied(DARK_TIMBER, rng, 0.08), { up: [1, 0, 0], rng });
  }

  // Louvred vents under each gable, so the grain can breathe: a dark panel a hair proud, and a frame.
  for (const s of [-1, 1]) {
    const faceZ = s * (H + 0.06);
    const cy = 10.25;
    const W = 1.1; const Hh = 0.55;
    board(wood, [-W, cy, faceZ], [W, cy, faceZ], 0.02, Hh * 2, 0x1c1712, { up: [0, 1, 0], rng });
    for (const dy of [-Hh, Hh]) board(wood, [-W - 0.1, cy + dy, faceZ + s * 0.03], [W + 0.1, cy + dy, faceZ + s * 0.03], 0.1, 0.16, varied(DARK_TIMBER, rng, 0.06), { up: [0, 1, 0], rng });
    for (const dx of [-W, W]) board(wood, [dx, cy - Hh, faceZ + s * 0.03], [dx, cy + Hh, faceZ + s * 0.03], 0.16, 0.1, varied(DARK_TIMBER, rng, 0.06), { up: [0, 0, 1], rng });
    for (let i = 0; i < 4; i++) {
      const y = cy - Hh + ((i + 0.5) / 4) * Hh * 2;
      board(wood, [-W, y, faceZ + s * 0.03], [W, y, faceZ + s * 0.03], 0.05, 0.16, varied(TIMBER, rng, 0.12), { up: [0, 1, s * 0.6], rng });
    }
  }

  // --- the steps, climbing toward the door and stopping a clear foot short of its threshold.
  const STEP_BACK = THRESHOLD_FRONT + 1.1;
  const STEP_W = 1.5;
  const TREADS = 4;
  const RISE = 0.62; const GOING = 0.92;
  for (let i = 0; i < TREADS; i++) {
    const y = RISE * (TREADS - i);
    const z0 = STEP_BACK + i * GOING;
    board(wood, [-STEP_W, y - 0.07, z0 + (GOING + 0.06) / 2], [STEP_W, y - 0.07, z0 + (GOING + 0.06) / 2], GOING + 0.06, 0.14, varied(TIMBER, rng, 0.16), { rng });
  }
  const stepRun = GOING * TREADS;
  // A stringer's line runs through the treads, so every tread is housed in it, and from the top
  // tread's back edge it goes on down into the ground past the bottom one.
  const stringerAt = (z) => RISE * TREADS - 0.17 - (z - STEP_BACK - GOING / 2) * (RISE / GOING);
  const stringerEnd = STEP_BACK + GOING / 2 + ((RISE * TREADS - 0.17 + 0.16) * GOING) / RISE;
  for (const s of [-1, 1]) {
    const x = s * (STEP_W + 0.05);
    board(wood, [x, stringerAt(stringerEnd), stringerEnd], [x, stringerAt(STEP_BACK + 0.02), STEP_BACK + 0.02], 0.16, 0.5, varied(DARK_TIMBER, rng, 0.08), { rng });
    // A post at the head of the flight, which is what holds it up without touching the building.
    board(wood, [x, -0.36, STEP_BACK + 0.3], [x, stringerAt(STEP_BACK + 0.3) - 0.1, STEP_BACK + 0.3], 0.26, 0.26, varied(DARK_TIMBER, rng, 0.08), { up: [0, 0, 1], rng });
  }

  // --- two sacks by the foot of the steps.
  placeSack(sacks, rng, -2.75, 0, 8.05, { h: 2.35, r: 0.76, yaw: 0.6 });
  placeSack(sacks, rng, -3.9, 0, 7.15, { h: 2.1, r: 0.72, yaw: 2.2, lean: -0.08 });

  // --- inside: a grain bin along the back wall, and sacks down the west wall.
  const BIN_Z = -2.5;
  for (const [a, b] of [
    [[-IN0 + 0.05, GRANARY_FLOOR + 0.5, BIN_Z], [IN0 - 0.05, GRANARY_FLOOR + 0.5, BIN_Z]],
  ]) board(wood, a, b, 0.14, 1.0, varied(TIMBER, rng, 0.1), { rng });
  for (const x of [-IN0 + 0.15, -1.5, 1.5, IN0 - 0.15]) {
    board(wood, [x, GRANARY_FLOOR, BIN_Z - 0.1], [x, GRANARY_FLOOR + 1.12, BIN_Z - 0.1], 0.2, 0.18, varied(DARK_TIMBER, rng, 0.1), { up: [0, 0, 1], rng });
  }
  {
    // The heap: a low dome of grain, stretched along the bin.
    const profile = [];
    for (let i = 0; i <= 7; i++) {
      const t = i / 7;
      profile.push([(1 - t) * 1, 0.05 + 1.72 * (1 - (1 - t) ** 2.4)]);
    }
    const g = lathe([[0, 0], [1, 0], ...profile], 26);
    g.scale(3.95, 1, 1);
    g.translate(0, GRANARY_FLOOR, (BIN_Z - IN0) / 2);
    const P = g.attributes.position;
    const uv = g.attributes.uv;
    const light = lin(WHEAT); const dark = lin(0xa98232);
    const col = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
      uv.setXY(i, (x + z * 0.62) * 2.4, (y + z * 0.37) * 2.4);
      const t = 0.5 + 0.5 * Math.sin(x * 1.3) * Math.sin(z * 1.9 + 1);
      col[i * 3] = mix(dark[0], light[0], t); col[i * 3 + 1] = mix(dark[1], light[1], t); col[i * 3 + 2] = mix(dark[2], light[2], t);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    sacks.push({ geometry: g, keepColor: true });
  }
  placeSack(sacks, rng, -3.85, GRANARY_FLOOR, 1.3, { h: 2.1, r: 0.68, yaw: 1 });
  placeSack(sacks, rng, -3.85, GRANARY_FLOOR, 2.85, { h: 2.0, r: 0.66, yaw: 3 });
  placeSack(sacks, rng, 3.85, GRANARY_FLOOR, 2.1, { h: 2.1, r: 0.68, yaw: 5 });
  // A wooden shovel, leaning in the corner.
  board(wood, [3.0, GRANARY_FLOOR + 0.5, -1.4], [3.95, GRANARY_FLOOR + 3.9, -1.1], 0.09, 0.09, 0x7a5c3e, { rng });
  board(wood, [2.88, GRANARY_FLOOR + 0.02, -1.46], [3.04, GRANARY_FLOOR + 0.62, -1.38], 0.55, 0.05, 0x8a6a48, { up: [0, 0, 1], rng });

  const group = new THREE.Group();
  group.add(mesh(mergeParts(stone), stoneMaterial(72)));
  group.add(mesh(mergeParts(wood), woodMaterial(73)));
  group.add(mesh(mergeParts(sacks), standard({ vertexColors: true, roughness: 1, metalness: 0, ...relief('weave', { seed: 74, repeat: 1 }) })));
  return group;
}

// ---------------------------------------------------------------------------
// The footbridge and its stream
// ---------------------------------------------------------------------------
const STREAM_X = 15; // the section's two cuts
const STREAM_Z = 5; // its long edges
const BANK_Y = 0.15;
const WATER_TOP = 0.06;

const TAU = Math.PI * 2;
// Everything that varies along the stream is built from whole cycles per 30ft, so x = -15 and x = +15
// are the same by construction, and so is the slope either side of them. The cut lands on nothing.
const cyc = (x, k, p = 0) => Math.sin((TAU * k * x) / (STREAM_X * 2) + p);

// Bank height across the stream, as a function of distance from the centre line.
const BANK_TABLE = [
  [0, 0.012], [2.3, 0.012], [2.72, 0.035], [2.95, 0.07], [3.25, 0.115], [3.6, 0.145], [3.9, BANK_Y],
  [4.2, 0.1], [4.42, 0.02], [4.7, -0.17], [5, -0.4],
];
function bankProfile(a) {
  if (a <= 0) return BANK_TABLE[0][1];
  for (let i = 1; i < BANK_TABLE.length; i++) {
    if (a <= BANK_TABLE[i][0]) {
      const [a0, y0] = BANK_TABLE[i - 1]; const [a1, y1] = BANK_TABLE[i];
      return mix(y0, y1, (a - a0) / (a1 - a0));
    }
  }
  return BANK_TABLE[BANK_TABLE.length - 1][1];
}

// The surface. `x` must be wrapped first, so that the two cuts are bitwise the same numbers.
function bankHeight(x, z) {
  const side = z >= 0 ? 1 : -1;
  const a = Math.abs(z);
  const m = 0.24 * cyc(x, 2, side * 1.1) + 0.13 * cyc(x, 3, 2.3 + side) + 0.07 * cyc(x, 7, 0.4 - side);
  const hold = 1 - sstep(a, 3.7, 4.55); // the meander dies out before the long edge, which stays exact
  const lumps = (0.016 * cyc(x, 5, side * 2) + 0.012 * cyc(x, 11, side)) * sstep(a, 2.8, 3.4) * hold;
  return bankProfile(Math.max(0, a + m * hold)) + lumps;
}

const wrapX = (x) => (x >= STREAM_X ? -STREAM_X : x);

function bankMap(seed) {
  const rng = seededRandom(seed);
  const texture = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f1efe6';
    ctx.fillRect(0, 0, w, h);
    const dab = (x, y, rx, ry, fill) => {
      ctx.fillStyle = fill;
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          ctx.beginPath();
          ctx.ellipse(x + ox, y + oy, rx, ry, 0, 0, TAU);
          ctx.fill();
        }
      }
    };
    // Broad soft patches, feathered to nothing: a hard-edged oval reads as a stain on a sheet.
    for (let i = 0; i < 60; i++) {
      const x = rng() * w; const y = rng() * h; const r = 14 + rng() * 34; const alpha = 0.05 + rng() * 0.07;
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          g.addColorStop(0, `rgba(70,74,40,${alpha})`);
          g.addColorStop(1, 'rgba(70,74,40,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, 0, TAU);
          ctx.fill();
        }
      }
    }
    for (let i = 0; i < 700; i++) {
      const light = rng() > 0.5;
      dab(rng() * w, rng() * h, 0.7 + rng() * 1.8, 0.7 + rng() * 1.8, light ? `rgba(255,255,240,${0.2 + rng() * 0.3})` : `rgba(80,74,48,${0.08 + rng() * 0.14})`);
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// One painting of the water, once along the 30ft and wrapped across its two ends, so that a copy
// carries straight on from it. Deep and blue in the middle, shallow and green at the edges, with long
// streaks along the flow and a few pale curls where it runs over something.
function waterMap(seed) {
  const rng = seededRandom(seed);
  return canvasTexture(1024, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#6f9f7c');
    g.addColorStop(0.13, '#4d97a0');
    g.addColorStop(0.32, '#2f7f9e');
    g.addColorStop(0.5, '#256f95');
    g.addColorStop(0.68, '#2f7f9e');
    g.addColorStop(0.87, '#4d97a0');
    g.addColorStop(1, '#6f9f7c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const wrap = (fn) => { for (const ox of [-w, 0, w]) fn(ox); };
    // Pebbles showing through the shallows.
    for (let i = 0; i < 90; i++) {
      const x = rng() * w;
      const top = rng() > 0.5;
      const y = top ? rng() * h * 0.2 : h - rng() * h * 0.2;
      const r = 3 + rng() * 7;
      const shade = rng() > 0.5 ? '70,86,78' : '150,160,130';
      wrap((ox) => {
        ctx.fillStyle = `rgba(${shade},${0.14 + rng() * 0.16})`;
        ctx.beginPath();
        ctx.ellipse(x + ox, y, r * 1.5, r, rng(), 0, TAU);
        ctx.fill();
      });
    }
    // Long streaks, which are the current.
    for (let i = 0; i < 240; i++) {
      const x = rng() * w; const y = h * (0.06 + rng() * 0.88);
      const len = 40 + rng() * 180; const bow = (rng() - 0.5) * 14;
      const light = rng() > 0.32;
      ctx.strokeStyle = light ? `rgba(170,216,230,${0.05 + rng() * 0.13})` : `rgba(14,62,92,${0.08 + rng() * 0.16})`;
      ctx.lineWidth = 0.8 + rng() * 3;
      wrap((ox) => {
        ctx.beginPath();
        ctx.moveTo(x + ox, y);
        ctx.quadraticCurveTo(x + ox + len / 2, y + bow, x + ox + len, y);
        ctx.stroke();
      });
    }
    // Curls.
    for (let i = 0; i < 14; i++) {
      const x = rng() * w; const y = h * (0.12 + rng() * 0.76); const r = 7 + rng() * 14;
      ctx.strokeStyle = `rgba(214,238,244,${0.14 + rng() * 0.18})`;
      ctx.lineWidth = 1 + rng() * 1.4;
      wrap((ox) => {
        ctx.beginPath();
        ctx.ellipse(x + ox, y, r * 1.8, r * 0.55, 0, 0.3, 2.9);
        ctx.stroke();
      });
    }
  });
}

// The bank: one closed solid across the whole 30ft, a very low raised form lying on the grass.
function streamBank() {
  const NX = 40;
  const stations = [0, 1.3, 2.3, 2.72, 2.95, 3.25, 3.6, 3.9, 4.2, 4.42, 4.7, 5];
  const zs = [...stations.slice(1).reverse().map((v) => -v), ...stations];
  const NZ = zs.length;
  const positions = []; const normals = []; const uvs = []; const colors = [];
  const index = [];
  const damp = lin(0x4a3c2a); const earth = lin(SOIL); const moss = lin(0x5d7c32); const grass = lin(LEAF); const olive = lin(0x6a7f3a);
  const e = 0.02;
  for (let i = 0; i <= NX; i++) {
    const x = -STREAM_X + (i / NX) * STREAM_X * 2;
    const hx = wrapX(x);
    for (let j = 0; j < NZ; j++) {
      const z = zs[j];
      const a = Math.abs(z);
      const y = a >= STREAM_Z ? -0.4 : bankHeight(hx, z);
      positions.push(x, y, z);
      // Normal from the height function, so that it is the same at both cuts. A normal computed from
      // triangles would have only one side to look at there, and would draw a line across the stream.
      const hl = bankHeight(hx - e, z);
      const hr = bankHeight(hx + e, z);
      const hd = bankHeight(hx, z - e);
      const hu = bankHeight(hx, z + e);
      const nx = -(hr - hl) / (2 * e); const nz = -(hu - hd) / (2 * e);
      const len = Math.hypot(nx, 1, nz);
      normals.push(nx / len, 1 / len, nz / len);
      uvs.push((x + STREAM_X) / 5, (z + STREAM_Z) / 5);
      // Paint by distance from the water, broken by whole-cycle mottling.
      const side = z >= 0 ? 1 : -1;
      const m = 0.3 * cyc(hx, 3, side) + 0.2 * cyc(hx, 5, 2 * side) + 0.15 * cyc(hx, 9, side * 0.5);
      const w = a + m;
      const out = [damp[0], damp[1], damp[2]];
      const t1 = sstep(w, 2.8, 3.25); const t2 = sstep(w, 3.25, 3.75); const t3 = sstep(w, 3.9, 4.5);
      for (let c = 0; c < 3; c++) {
        out[c] = mix(out[c], earth[c], t1 * 0.7);
        out[c] = mix(out[c], moss[c], t2);
        out[c] = mix(out[c], grass[c], t3);
        out[c] = mix(out[c], olive[c], (0.5 + 0.5 * cyc(hx, 4, 1.7 * side)) * 0.3);
      }
      colors.push(...out);
    }
  }
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NZ - 1; j++) {
      const a = i * NZ + j; const b = a + 1; const c = (i + 1) * NZ + j + 1; const d = (i + 1) * NZ + j;
      index.push(a, b, c, a, c, d);
    }
  }
  // Underside, closing the form below ground: a strip with the same stations along the two long edges
  // and a middle line for the end caps to meet.
  const under = positions.length / 3;
  for (let i = 0; i <= NX; i++) {
    const x = -STREAM_X + (i / NX) * STREAM_X * 2;
    positions.push(x, -0.4, -STREAM_Z, x, -0.4, 0, x, -0.4, STREAM_Z);
    for (let k = 0; k < 3; k++) { normals.push(0, -1, 0); uvs.push(0, 0); colors.push(...earth); }
  }
  for (let i = 0; i < NX; i++) {
    for (let k = 0; k < 2; k++) {
      const a = under + i * 3 + k; const b = a + 1; const c = under + (i + 1) * 3 + k + 1; const d = under + (i + 1) * 3 + k;
      index.push(a, c, b, a, d, c);
    }
  }
  // The two flush cuts: a fan from the middle of the underside, which sees all of the profile. Coplanar
  // with a neighbour's when a copy is laid on, and buried there, since neither shows above the surface.
  for (const [sx, row] of [[-1, 0], [1, NX]]) {
    const base = positions.length / 3;
    positions.push(sx * STREAM_X, -0.4, 0);
    normals.push(sx, 0, 0); uvs.push(0, 0); colors.push(...earth);
    for (let j = 0; j < NZ; j++) {
      const k = row * NZ + j;
      positions.push(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]);
      normals.push(sx, 0, 0); uvs.push(0, 0); colors.push(...earth);
    }
    for (let j = 0; j < NZ - 1; j++) {
      if (sx > 0) index.push(base, base + 1 + j, base + 2 + j);
      else index.push(base, base + 2 + j, base + 1 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  return g;
}

function bankStone(unit, rng, x, z, rx, ry, rz, { sink = 0.35, baseY = null } = {}) {
  const yaw = rng() * TAU; const cy = Math.cos(yaw); const sy = Math.sin(yaw);
  const tilt = (rng() - 0.5) * 0.3;
  const y0 = (baseY ?? bankHeight(x, z)) + ry * (1 - sink * 2);
  const tone = lin(STONE_TONES[Math.floor(rng() * STONE_TONES.length)]);
  const mossy = lin(0x56722f);
  const k = 0.68 + rng() * 0.26;
  const s = rng() * 9;
  return shapeStone(unit, rng, (px, py, pz) => {
    const ax = px * rx; const ay = py * ry + px * rx * tilt * 0.3; const az = pz * rz;
    return [x + ax * cy + az * sy, y0 + ay, z - ax * sy + az * cy];
  }, (px, py, pz, nx, ny, nz, wx, wy, wz, out) => {
    // Moss on the tops and away from the waterline, with the wet stone dark round its foot.
    const m = sstep(ny + 0.3 * Math.sin(wx * 2.1 + s) * Math.cos(wz * 2.4 + s), 0.25, 0.75) * sstep(wy, WATER_TOP + 0.04, WATER_TOP + 0.2);
    const wet = 1 - sstep(wy, WATER_TOP, WATER_TOP + 0.12);
    const b = k * mix(1, 0.52, wet);
    out[0] = mix(tone[0], mossy[0], m) * b; out[1] = mix(tone[1], mossy[1], m) * b; out[2] = mix(tone[2], mossy[2], m) * b;
  }, { pillow: 0.86, rough: 0.09 });
}

function reedClump(parts, rng, x, z, count) {
  const stem = lin(0x6f9440); const tip = lin(0xb4b45a);
  for (let i = 0; i < count; i++) {
    const a = rng() * TAU; const r = rng() * 0.36;
    const px = x + Math.cos(a) * r; const pz = z + Math.sin(a) * r;
    const h = 2.2 + rng() * 2.1;
    const lean = 0.08 + rng() * 0.24;
    const dir = rng() * TAU;
    const y0 = bankHeight(px, pz) - 0.08;
    const pts = [
      [px, y0, pz],
      [px + Math.cos(dir) * lean * h * 0.15, y0 + h * 0.45, pz + Math.sin(dir) * lean * h * 0.15],
      [px + Math.cos(dir) * lean * h * 0.45, y0 + h * 0.8, pz + Math.sin(dir) * lean * h * 0.45],
      [px + Math.cos(dir) * lean * h, y0 + h, pz + Math.sin(dir) * lean * h],
    ];
    const g = tube(pts, [0.06, 0.05, 0.035, 0], { sides: 3, steps: 4, round: 0 });
    const P = g.attributes.position;
    const col = new Float32Array(P.count * 3);
    for (let v = 0; v < P.count; v++) {
      const t = clamp01((P.getY(v) - y0) / h);
      for (let c = 0; c < 3; c++) col[v * 3 + c] = mix(stem[c], tip[c], t ** 1.8);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push({ geometry: g, keepColor: true });
    if (i % 3 === 0) {
      // A seed head, rooted on the stem two-thirds of the way up.
      const c = pts[2];
      const head = tube([[c[0], c[1] - 0.25, c[2]], [c[0], c[1] + 0.25, c[2]]], 0.085, { sides: 6, steps: 1, straight: true, round: 1 });
      parts.push({ geometry: head, color: 0x5c3d24 });
    }
  }
}

function footbridge() {
  const bank = [];
  const stones = [];
  const wood = [];
  const rng = seededRandom(3307);

  bank.push({ geometry: streamBank(), keepColor: true });

  // --- rounded mossy stones along both waterlines. None may cross a cut, because they would then
  // stop dead in mid-air where the next copy's bank begins.
  const boulder = stoneUnit(3, 2, 3);
  const small = stoneUnit(2, 2, 2);
  const CLEAR = 14.6;
  for (const side of [-1, 1]) {
    let x = -CLEAR + rng() * 0.6;
    while (x < CLEAR) {
      const big = rng() > 0.55;
      const rx = big ? 0.42 + rng() * 0.34 : 0.2 + rng() * 0.16;
      const rz = rx * (0.7 + rng() * 0.3);
      const ry = rx * (0.55 + rng() * 0.25);
      x += rx * 0.6;
      if (x + rx > CLEAR) break;
      // On the waterline, wherever the meander has put it here.
      let za = 2.3;
      for (let a = 2.3; a < 3.8; a += 0.04) { if (bankHeight(x, side * a) >= WATER_TOP) { za = a; break; } }
      const z = side * (za + (rng() - 0.35) * 0.4);
      stones.push({ geometry: bankStone(big ? boulder : small, rng, x, z, rx, ry, rz, { sink: 0.3, baseY: WATER_TOP - 0.03 }), keepColor: true });
      x += rx * (0.9 + rng() * 2.2);
    }
  }
  // A few standing in the current, which is what makes the stream look as if it is going somewhere.
  for (const [x, z, r] of [[-9.6, 0.7, 0.62], [-8.8, -0.5, 0.34], [7.4, -0.9, 0.56], [8.3, 0.2, 0.3], [11.6, 1.2, 0.42]]) {
    stones.push({ geometry: bankStone(boulder, rng, x, z, r, r * 0.62, r * 0.8, { sink: 0.2, baseY: 0.02 }), keepColor: true });
  }
  // Stones gathered round the foot of the arch at each end, where its thrust goes into the ground.
  for (const sz of [-1, 1]) {
    for (const [x, z, r] of [[-3.45, 9.25, 0.5], [-3.3, 8.25, 0.4], [-3.95, 8.7, 0.32], [3.5, 9.2, 0.52], [3.32, 8.15, 0.42], [4.0, 8.75, 0.3]]) {
      stones.push({ geometry: bankStone(boulder, rng, x, sz * z, r, r * 0.55, r * 0.8, { sink: 0.15, baseY: -0.02 }), keepColor: true });
    }
  }

  // --- the reeds, on the banks and well clear of the cuts and of the bridge's own deck.
  for (const [x, z, n] of [[-12.3, 3.45, 9], [-5.6, -3.4, 7], [5.2, 3.5, 8], [10.3, -3.5, 9], [12.6, 3.3, 6]]) {
    reedClump(bank, rng, x, z, n);
  }

  // --- the bridge. Its arch is the shape of the top of the deck, and every other member reads it.
  const HALF = 10;
  const CREST = 3.5; const END = 0.12;
  const deckY = (z) => {
    const u = clamp01(Math.abs(z) / HALF);
    return END + (CREST - END) * (0.6 * (1 - u * u) + 0.4 * Math.cos((u * Math.PI) / 2) ** 2);
  };
  const slope = (z) => (deckY(z + 0.01) - deckY(z - 0.01)) / 0.02;
  const normalAt = (z) => { const s = slope(z); const l = Math.hypot(1, s); return [0, 1 / l, -s / l]; };
  const stationsZ = [];
  for (let i = 0; i <= 28; i++) stationsZ.push(-HALF + (i / 28) * 2 * HALF);

  // Three laminated arch ribs, deepest at their feet, and sunk into the ground there.
  for (const x of [-2.3, 0, 2.3]) {
    const st = stationsZ.map((z) => {
      const u = Math.abs(z) / HALF;
      const top = deckY(z) - 0.17;
      return { z, top, bot: Math.max(-0.42, top - (0.52 + 0.46 * u * u)) };
    });
    curvedBeam(wood, x, 0.34, st, varied(DARK_TIMBER, rng, 0.06));
  }
  // Cross beams tying the ribs, spaced along the arch.
  for (const z of [-7.5, -5, -2.5, 0, 2.5, 5, 7.5]) {
    const y = deckY(z) - 0.4;
    board(wood, [-2.45, y, z], [2.45, y, z], 0.24, 0.26, varied(DARK_TIMBER, rng, 0.08), { rng });
  }

  // Deck planks, stepped along the arc by true length so they keep one width over the crown. They run
  // across X: 5ft wide.
  let z = -HALF;
  const PITCH = 0.6;
  while (z < HALF) {
    const dz = PITCH / Math.hypot(1, slope(z + PITCH * 0.35));
    const zc = Math.min(z + dz / 2, HALF - dz / 2);
    const n = normalAt(zc);
    const y = deckY(zc) - 0.075;
    const inL = rng() * 0.06; const inR = rng() * 0.06;
    board(wood, [-2.5 + inL, y, zc], [2.5 - inR, y, zc], PITCH - 0.045, 0.15, varied(TIMBER, rng, 0.2), { up: n, rng });
    z += dz;
  }

  // Rails on both sides: posts bolted outside the outer rib, a handrail and a middle rail following
  // the arch, and a brace from each post down to the rib.
  const POSTS = [-9.4, -6.3, -3.15, 0, 3.15, 6.3, 9.4];
  const HAND = 3.05; const MID = 1.65;
  for (const s of [-1, 1]) {
    const x = s * 2.62;
    for (const zp of POSTS) {
      const y0 = Math.max(-0.3, deckY(zp) - 0.62);
      const y1 = deckY(zp) + HAND + 0.16;
      board(wood, [x, y0, zp], [x, y1, zp], 0.3, 0.3, varied(DARK_TIMBER, rng, 0.08), { up: [0, 0, 1], rng });
      const cap = new THREE.ConeGeometry(0.235, 0.2, 4);
      cap.rotateY(Math.PI / 4);
      cap.translate(x, y1 + 0.1, zp);
      wood.push({ geometry: cap, color: varied(DARK_TIMBER, rng, 0.08) });
    }
    const span = stationsZ.filter((v) => Math.abs(v) <= 9.5);
    const rail = (h, w, d, inset, tone) => {
      const st = [-9.5, ...span.filter((v) => Math.abs(v) < 9.45), 9.5].map((v) => ({ z: v, top: deckY(v) + h + d / 2, bot: deckY(v) + h - d / 2 }));
      curvedBeam(wood, s * (2.62 - inset), w, st, tone);
    };
    rail(HAND, 0.24, 0.2, 0.17, varied(TIMBER, rng, 0.08));
    rail(MID, 0.13, 0.18, 0.2, varied(TIMBER, rng, 0.1));
    // Diagonals between the posts, in the plane of the rail, which is what stiffens a timber parapet.
    for (let i = 0; i < POSTS.length - 1; i++) {
      const a = POSTS[i]; const b = POSTS[i + 1];
      const up = i < POSTS.length / 2 - 0.5;
      const zLow = up ? a : b; const zHigh = up ? b : a;
      board(wood, [s * 2.42, deckY(zLow) + 0.25, zLow], [s * 2.42, deckY(zHigh) + MID - 0.09, zHigh], 0.09, 0.12, varied(TIMBER, rng, 0.14), { up: [1, 0, 0], rng });
    }
  }

  // --- the water: a thin closed slab running under both banks' edges, cut flush with the bank's own
  // cuts. Opaque, because it stands about an inch above the bed, so there is no depth to show through
  // it, and a painted surface carries the shallows and the current far better.
  const waterGeo = new THREE.BoxGeometry(STREAM_X * 2, WATER_TOP + 0.02, 7.2);
  waterGeo.translate(0, (WATER_TOP - 0.02) / 2, 0);

  const group = new THREE.Group();
  const bankTexture = bankMap(81);
  group.add(mesh(mergeParts(bank), standard({ vertexColors: true, map: bankTexture, bumpMap: bankTexture, bumpScale: 0.8, roughness: 0.98, metalness: 0 })));
  group.add(mesh(mergeParts(stones), stoneMaterial(82, { roughness: 0.9 })));
  group.add(mesh(mergeParts(wood), woodMaterial(83)));
  const waterTexture = waterMap(84);
  const waterMesh = mesh(waterGeo, standard({ map: waterTexture, roughness: 0.3, metalness: 0 }));
  waterMesh.castShadow = false;
  group.add(waterMesh);
  return group;
}

// ---------------------------------------------------------------------------
// The post and rail fence
// ---------------------------------------------------------------------------
const FENCE_HALF = 5;

// A rough many-sided solid along a path of rings. `ring(t, a, j)` gives the point at fraction t along
// and angle a round. Its section is its own at every ring, so the faces come out hewn rather than
// turned, and creasing the normals keeps the arrises that say so.
function hewnSolid(rows, sides, ring, grainLen = 4) {
  const positions = []; const uvs = []; const index = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    for (let j = 0; j <= sides; j++) {
      const a = ((j % sides) / sides) * TAU;
      positions.push(...ring(t, a, j % sides));
      uvs.push((t * grainLen) / GRAIN_U, (j / sides) * 0.9);
    }
  }
  const row = sides + 1;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * row + j; const b = a + 1; const c = (i + 1) * row + j + 1; const d = (i + 1) * row + j;
      index.push(a, b, c, a, c, d);
    }
  }
  for (const [i, flip] of [[0, true], [rows, false]]) {
    const base = positions.length / 3;
    let cx = 0; let cy = 0; let cz = 0;
    for (let j = 0; j < sides; j++) { cx += positions[(i * row + j) * 3]; cy += positions[(i * row + j) * 3 + 1]; cz += positions[(i * row + j) * 3 + 2]; }
    positions.push(cx / sides, cy / sides, cz / sides);
    uvs.push(0.1, 0.1);
    for (let j = 0; j < sides; j++) {
      const p = i * row + j; const q = i * row + j + 1;
      if (flip) index.push(base, p, q); else index.push(base, q, p);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return outward(g);
}

const RAIL_Y = [1.15, 2.2, 3.25];

// The post. Built once and used at both ends of every section, so the post a copy shares with its
// neighbour is the same surface twice, with the same colours, and so cannot be told apart if the two
// happen to fight for a pixel.
function fencePost() {
  const rng = seededRandom(9101);
  // A hewn section, a little deeper than it is wide, with broad flats toward +/-X where the rails come
  // in and the corners knocked off.
  const SECTION = [[0.25, 0.2], [0.2, 0.3], [-0.2, 0.3], [-0.25, 0.2], [-0.25, -0.2], [-0.2, -0.3], [0.2, -0.3], [0.25, -0.2]];
  const sides = SECTION.length;
  const wobble = SECTION.map(() => 0.97 + rng() * 0.06);
  const lean = [(rng() - 0.5) * 0.012, (rng() - 0.5) * 0.012];
  const Y0 = -0.4; const Y1 = 4.05;
  const rows = 8;
  const slopeCut = 0.16; // the head is cut on a slant, to shed the rain
  const g = hewnSolid(rows, sides, (t, a, j) => {
    const y = mix(Y0, Y1, t);
    const flare = 1 + 0.1 * (1 - sstep(y, -0.4, 0.5));
    const band = 1 + 0.02 * Math.sin(y * 2.1 + j * 1.3);
    const dx = SECTION[j][0] * wobble[j] * flare * band;
    const dz = SECTION[j][1] * wobble[j] * flare * band;
    const cut = t === 1 ? slopeCut * (dz / 0.3) : 0;
    return [dx + lean[0] * t, y + cut, dz + lean[1] * t];
  }, 4.45);
  // Hewn: facets stay facets.
  const hewn = toCreasedNormals(g, THREE.MathUtils.degToRad(32));
  const P = hewn.attributes.position;
  const col = new Float32Array(P.count * 3);
  const tone = lin(0x6f5338); const weather = lin(0x8f7d66); const dark = lin(0x44331f);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    const m = 0.5 + 0.5 * Math.sin(y * 2.7 + x * 9) * Math.cos(z * 8 + y);
    const ground = 1 - sstep(y, -0.1, 0.7);
    for (let c = 0; c < 3; c++) {
      col[i * 3 + c] = mix(mix(tone[c], weather[c], m * 0.5), dark[c], ground * 0.7);
    }
  }
  hewn.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const parts = [{ geometry: hewn, keepColor: true }];

  // The mortises: a dark slot a hair proud on each of the post's two flat faces, standing behind where
  // each rail enters. A slot with no rail in it, on an end post, is what an unused mortise looks like.
  for (const sx of [-1, 1]) {
    for (const y of RAIL_Y) {
      const slot = new THREE.SphereGeometry(1, 8, 4);
      slot.scale(0.03, 0.31, 0.175);
      slot.translate(sx * 0.242, y, 0);
      parts.push({ geometry: slot, color: 0x1a130c });
    }
  }
  return mergeParts(parts);
}

// A split rail from post centre to post centre. Its middle wanders, its ends do not: at x = +/-5 its
// centre is exactly on the post's axis at this rail's height, so the rail of the next section picks
// up from the very same point inside the shared post.
function fenceRail(seed, y) {
  const rng = seededRandom(seed);
  // A log split in wedges has a sector for a section: two riven faces meeting at a thin edge, and the
  // bark side curved. It is that wedge, and not any surface texture, that says "split".
  const SECTION = [[0, 0.25], [0.12, 0.09], [0.165, -0.08], [0.09, -0.2], [-0.05, -0.22], [-0.15, -0.09], [-0.1, 0.09]];
  const sides = SECTION.length;
  const rows = 14;
  const facets = SECTION.map(() => 0.9 + rng() * 0.22);
  const p = [rng() * 6, rng() * 6, rng() * 6];
  const aY = 0.05 + rng() * 0.05; const aZ = 0.04 + rng() * 0.05;
  const roll = (rng() - 0.5) * 1.1;
  const twist = (rng() - 0.5) * 0.7;
  const g = hewnSolid(rows, sides, (t, a, j) => {
    const x = mix(-FENCE_HALF, FENCE_HALF, t);
    const window = Math.sin(Math.PI * t);
    const cy = y + window * aY * Math.sin(t * 6.28 + p[0]);
    const cz = window * aZ * Math.sin(t * 4.7 + p[1]);
    const grain = 1 + 0.07 * Math.sin(t * 15 + j * 2.1 + p[2]);
    const f = facets[j] * grain;
    const th = roll + twist * t;
    // Slimmer at the ends, so the rail stays inside the slot it runs into.
    const end = 0.8 + 0.2 * sstep(window, 0, 0.26);
    const [sz, sy] = SECTION[j];
    const qz = sz * f * end; const qy = sy * f * end;
    return [x, cy + Math.cos(th) * qy + Math.sin(th) * qz, cz - Math.sin(th) * qy + Math.cos(th) * qz];
  }, 10);
  const hewn = toCreasedNormals(g, THREE.MathUtils.degToRad(35));
  const P = hewn.attributes.position;
  const col = new Float32Array(P.count * 3);
  const tone = lin(TIMBER); const pale = lin(0xa78c6a); const shade = lin(0x5b432e);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i); const z = P.getZ(i);
    const m = 0.5 + 0.5 * Math.sin(x * 1.3 + p[0]) * Math.cos(x * 3.1 + z * 11 + p[1]);
    // The shadow in the mortise, where the rail goes into the post.
    const dark = 1 - sstep(FENCE_HALF - Math.abs(x), 0.2, 0.52);
    for (let c = 0; c < 3; c++) {
      col[i * 3 + c] = mix(mix(tone[c], pale[c], m * 0.7), shade[c], dark * 0.75);
    }
  }
  hewn.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return hewn;
}

function postAndRailFence() {
  const post = fencePost();
  const left = post.clone(); left.translate(-FENCE_HALF, 0, 0);
  const right = post.clone(); right.translate(FENCE_HALF, 0, 0);
  const parts = [{ geometry: left, keepColor: true }, { geometry: right, keepColor: true }];
  RAIL_Y.forEach((y, i) => parts.push({ geometry: fenceRail(9201 + i * 17, y), keepColor: true }));
  const group = new THREE.Group();
  group.add(mesh(mergeParts(parts), woodMaterial(91, 128, { bumpScale: 0.9 })));
  return group;
}

export const BUILDERS = {
  'village-well': villageWell,
  granary,
  'wooden-footbridge': footbridge,
  'post-and-rail-fence': postAndRailFence,
};
