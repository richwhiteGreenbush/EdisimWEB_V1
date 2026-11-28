// Build a City: the homes and the shops. Row house, apartment building, office tower, corner grocery,
// diner, post office.
//
// Every one is real life size on the kit's 10ft grid (src/models/town/TownKit.js), origin at the base
// centre, front toward +Z, its front wall standing on the front edge of its footprint so it can be
// placed with its front against the back of a sidewalk. The parts all come from
// src/models/town/CityHomesKit.js, which explains the three ideas they are built on: walls as frames,
// one mesh per material, and nothing that is not a closed solid.
//
// Two of them have rooms you can walk into, because their cards say so: the corner grocery and the
// diner. Their floors are at ground level (the player walks on the terrain, never on a prop), their
// doors are real openings, and their shop windows are the one see-through mesh each is allowed.
// Everything else is closed, with its doors and windows built forward of a solid wall.

import * as THREE from 'three';
import { PALETTE } from '../town/TownKit.js';
import { lathe } from '../ModelKit.js';
import {
  Build, face, walls, shade, col, blend,
  holedWall, windowAt, doorLeaf, casing, band, railing, awning, steps,
} from '../town/CityHomesKit.js';

// ---------------------------------------------------------------------------------------------
// Colours shared by the six
// ---------------------------------------------------------------------------------------------
const K = {
  brick: PALETTE.brickRed, brickBrown: PALETTE.brickBrown, limestone: PALETTE.limestone, trim: 0xe6e0d2,
  brownstone: 0x7c5a47, granite: 0x8c8a86, tar: PALETTE.roofTar, iron: 0x26282b, glass: PALETTE.glass,
  cornice: 0x3c3632, doorGreen: 0x2f4c37, doorRed: 0x8a2a22, doorBlue: 0x24405f, brass: 0xc29a48,
  concrete: PALETTE.concrete, steel: PALETTE.steel, interior: 0xe9e3d3, wood: 0x8a5e3a,
};

// Offsets a convex plan outline [[x, z], ...] outward by d.
function offsetPoly(poly, d) {
  const n = poly.length;
  const cx = poly.reduce((s, p) => s + p[0], 0) / n; const cz = poly.reduce((s, p) => s + p[1], 0) / n;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i]; const b = poly[(i + 1) % n];
    let nx = b[1] - a[1]; let nz = -(b[0] - a[0]);
    const len = Math.hypot(nx, nz); nx /= len; nz /= len;
    const mx = (a[0] + b[0]) / 2; const mz = (a[1] + b[1]) / 2;
    if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
    lines.push({ p: [a[0] + nx * d, a[1] + nz * d], d: [b[0] - a[0], b[1] - a[1]] });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i + n - 1) % n]; const L2 = lines[i];
    const den = L1.d[0] * L2.d[1] - L1.d[1] * L2.d[0];
    const t = ((L2.p[0] - L1.p[0]) * L2.d[1] - (L2.p[1] - L1.p[1]) * L2.d[0]) / den;
    out.push([L1.p[0] + L1.d[0] * t, L1.p[1] + L1.d[1] * t]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Row house: 20 x 40, three storeys over a raised brownstone basement, a stoop, a canted bay over
// the parlour and the floor above it, and a bracketed cornice. NOTHING passes x = +/-10: the green
// arrow duplicates it every 20ft, and a row only reads as a row if its houses stand wall to wall.
// ---------------------------------------------------------------------------------------------
function rowHouse() {
  const B = new Build(101);
  const HX = 10; const HZ = 20;
  const W = walls(HX, HZ);
  const BASE = 3.6; // the parlour floor, and the top of the stoop
  const TOP = 33; // the roof
  const brick = K.brick;
  const lime = K.limestone;
  const brown = K.brownstone;

  // ---- the mass ----
  B.box('stone', brown, [-HX, HX], [-0.4, BASE], [-HZ, HZ]);
  B.box('brick', brick, [-HX, HX], [BASE, TOP], [-HZ, HZ]);
  // rustication on the base front: courses proud of the wall with their joints sunk between
  for (let y = 0.0; y < BASE - 0.2; y += 1.2) {
    B.box('stone', shade(brown, 0.96 + ((y * 7) % 3) * 0.03), [-HX, HX], [y + 0.06, Math.min(BASE - 0.05, y + 1.14)], [HZ - 0.1, HZ + 0.12], {});
  }
  // the water table: a stone band at the parlour floor
  B.box('stone', lime, [-HX, HX], [BASE - 0.05, BASE + 0.45], [HZ - 0.1, HZ + 0.3]);
  // a stone belt course under each upper floor's windows, front only
  B.box('stone', lime, [-HX, HX], [24.1, 24.5], [HZ - 0.1, HZ + 0.16]);

  // ---- the bay: parlour and second floor, canted ----
  const bayC = 3.2; const bayF = 6.0; const bayD = 2.6;
  const bayPoly = [[bayC - bayF / 2 - bayD, HZ - 0.05], [bayC + bayF / 2 + bayD, HZ - 0.05], [bayC + bayF / 2, HZ + bayD], [bayC - bayF / 2, HZ + bayD]];
  const BAY_TOP = 23.2;
  B.slab('stone', brown, bayPoly, -0.4, BASE);
  B.slab('brick', brick, bayPoly, BASE, BAY_TOP);
  // bay water table and the bay's own cornice and lead roof
  const grow = offsetPoly;
  B.slab('stone', lime, grow(bayPoly, 0.3), BASE - 0.05, BASE + 0.45);
  B.slab('paint', K.cornice, grow(bayPoly, 0.2), BAY_TOP, BAY_TOP + 0.9);
  B.slab('paint', shade(K.cornice, 1.12), grow(bayPoly, 0.5), BAY_TOP + 0.9, BAY_TOP + 1.25);
  B.slab('paint', K.tar, grow(bayPoly, 0.35), BAY_TOP + 1.25, BAY_TOP + 1.45);
  const bayFront = face([bayC, 0, HZ + bayD], [1, 0, 0]);
  const L0 = [bayC - bayF / 2 - bayD, HZ]; const L1 = [bayC - bayF / 2, HZ + bayD];
  const R0 = [bayC + bayF / 2, HZ + bayD]; const R1 = [bayC + bayF / 2 + bayD, HZ];
  const bayLeft = face([(L0[0] + L1[0]) / 2, 0, (L0[1] + L1[1]) / 2], [L1[0] - L0[0], 0, L1[1] - L0[1]]);
  const bayRight = face([(R0[0] + R1[0]) / 2, 0, (R0[1] + R1[1]) / 2], [R1[0] - R0[0], 0, R1[1] - R0[1]]);
  const win = { frame: K.trim, sillColor: lime, lintelColor: lime };
  for (const [y0, h] of [[BASE + 1.6, 7.2], [BASE + 11.7, 6.4]]) {
    windowAt(B, bayFront, 0, y0, 3.7, h, { ...win, cols: 2, rows: 4, keystone: true });
    windowAt(B, bayLeft, 0, y0, 2.1, h, { ...win, cols: 1, rows: 4 });
    windowAt(B, bayRight, 0, y0, 2.1, h, { ...win, cols: 1, rows: 4 });
  }
  // a window box of geraniums under the bay's parlour window
  {
    const f = bayFront;
    B.box('paint', 0x4a3424, [-1.9, 1.9], [BASE + 0.6, BASE + 1.25], [0.25, 1.0], { f });
    for (let i = 0; i < 9; i++) {
      const u = -1.65 + i * 0.41;
      B.ball('paint', 0x3f6f2e, u, BASE + 1.35, 0.65, 0.3, { f, w: 7, h: 5 });
      B.ball('paint', i % 3 === 1 ? 0xe8e0d0 : 0xc8282c, u + 0.08, BASE + 1.6, 0.72, 0.17, { f, w: 6, h: 4 });
    }
  }

  // ---- the front: the door bay and the top floor ----
  const F = W.front;
  const DOOR_U = -6.8;
  // the doorway: a dark vestibule, double leaves, a glazed transom, a brownstone surround and hood
  {
    const d0 = DOOR_U - 2.05; const d1 = DOOR_U + 2.05; const y0 = BASE + 0.45; const y1 = BASE + 9.0;
    B.box('paint', 0x1c1a18, [d0, d1], [y0, y1 + 1.6], [-0.1, 0.02], { f: F });
    doorLeaf(B, F, d0 + 0.1, DOOR_U - 0.02, y0, y1, 0.12, K.doorGreen, { panels: 3, knob: K.brass });
    doorLeaf(B, F, DOOR_U + 0.02, d1 - 0.1, y0, y1, 0.12, K.doorGreen, { panels: 3, knob: K.brass });
    B.box('paint', K.trim, [d0, d1], [y1, y1 + 0.25], [-0.05, 0.22], { f: F });
    B.box('glass', K.glass, [d0 + 0.15, d1 - 0.15], [y1 + 0.25, y1 + 1.5], [-0.05, 0.05], { f: F, tint: (x, y, z, c) => { const k = 1.2; c[0] *= k; c[1] *= k; c[2] *= k; } });
    // the house number, gilt on the transom
    const num = B.atlas.sign('24', 2.2, { bg: '#202a33', fg: '#e2b860', px: 64, family: 'Georgia, serif', fill: 0.72 });
    B.box('paint', 0xffffff, [DOOR_U - 0.6, DOOR_U + 0.6], [y1 + 0.55, y1 + 1.1], [0.05, 0.09], { f: F, sign: num });
    casing(B, 'stone', brown, F, d0, d1, y0, y1 + 1.6, { w: 0.55, out: 0.3, head: 0.45 });
    // the hood on two scrolled brackets
    B.box('stone', brown, [d0 - 1.0, d1 + 1.0], [y1 + 2.05, y1 + 2.5], [-0.1, 1.05], { f: F });
    B.box('stone', shade(brown, 1.06), [d0 - 1.15, d1 + 1.15], [y1 + 2.5, y1 + 2.75], [-0.1, 1.2], { f: F });
    for (const u of [d0 - 0.55, d1 + 0.55]) {
      const bf = face([u + 0.22, 0, HZ], [0, 0, 1]);
      B.prism('stone', brown, [[0, y1 + 2.06], [0, y1 - 0.4], [0.25, y1 - 0.4], [0.35, y1 + 0.6], [0.95, y1 + 1.7], [0.95, y1 + 2.06]], 0, 0.44, { f: bf });
    }
  }
  // the windows above the door, and the third floor
  windowAt(B, F, DOOR_U, BASE + 11.7, 3.4, 6.4, { ...win, cols: 2, rows: 4, keystone: true });
  for (const u of [DOOR_U, 0.4, 6.0]) windowAt(B, F, u, 25.1, 3.2, 5.6, { ...win, cols: 2, rows: 4, lintelH: 0.55 });
  // basement windows, barred, under the bay
  windowAt(B, bayFront, 0, 0.9, 2.6, 1.9, { frame: K.trim, sill: 'stone', sillColor: lime, lintel: null, rows: 1, sash: false, cols: 1 });
  for (let i = 0; i < 6; i++) B.box('metal', K.iron, [-1.1 + i * 0.44, -1.04 + i * 0.44], [0.85, 2.85], [0.12, 0.2], { f: bayFront });

  // ---- the stoop ----
  {
    const s0 = -9.3; const s1 = -4.3; // the stair between its cheeks, along x
    const land = 2.6; const nSteps = 5;
    const run = 0.95;
    const front = land + run * (nSteps - 1);
    // the landing, then the flight down to the sidewalk
    B.box('stone', brown, [s0 - 0.45, s1 + 0.45], [-0.4, BASE], [HZ - 0.1, HZ + land]);
    const rise = BASE / nSteps;
    for (let k = 0; k < nSteps - 1; k++) {
      const top = rise * (k + 1);
      const nf = front - run * k;
      B.box('stone', shade(brown, 1.04), [s0, s1], [k === 0 ? -0.4 : rise * k, top], [HZ + land - 0.05, HZ + nf + 0.08]);
    }
    // the cheek walls, sloping with the flight
    for (const x of [s0 - 0.45, s1]) {
      const cf = face([x + 0.45, 0, HZ], [0, 0, 1]);
      B.prism('stone', shade(brown, 0.94), [[0, -0.4], [front + 0.35, -0.4], [front + 0.35, rise + 0.55], [land, BASE + 0.55], [0, BASE + 0.55]], 0, 0.45, { f: cf });
    }
    // iron railings with newels at the foot
    for (const x of [s0 - 0.22, s1 + 0.22]) {
      railing(B, 'metal', K.iron, [x, BASE + 0.55, HZ + land], [x, rise + 0.55, HZ + front + 0.2], 2.6, { newel: true, step: 0.5 });
      railing(B, 'metal', K.iron, [x, BASE + 0.55, HZ + 0.4], [x, BASE + 0.55, HZ + land], 2.6, { step: 0.5 });
    }
  }

  // a low iron fence round the little front garden in front of the bay, on a stone curb
  {
    const fz = HZ + bayD + 1.3;
    B.box('stone', brown, [-3.8, HX - 0.15], [-0.4, 0.45], [fz - 0.25, fz + 0.25]);
    B.box('stone', brown, [HX - 0.65, HX - 0.15], [-0.4, 0.45], [HZ, fz - 0.25]);
    railing(B, 'metal', K.iron, [-3.6, 0.45, fz], [HX - 0.4, 0.45, fz], 2.4, { step: 0.4, newel: true });
    railing(B, 'metal', K.iron, [HX - 0.4, 0.45, fz], [HX - 0.4, 0.45, HZ + 0.4], 2.4, { step: 0.4 });
    for (let x = -3.6 + 0.4; x < HX - 0.5; x += 0.4) B.turned('metal', K.iron, [[0, 0], [0.05, 0], [0.09, 0.12], [0, 0.3]], x, 2.9, fz, { sides: 5 });
    B.box('stone', 0x5a4a3a, [-3.6, HX - 0.65], [-0.4, 0.2], [HZ + bayD + 0.05, fz - 0.25]);
    for (let i = 0; i < 7; i++) B.ball('paint', i % 2 ? 0x4b7d38 : 0x3d6c30, -2.4 + i * 1.9, 0.6, fz - 0.65, 0.55, { w: 8, h: 6, scale: [1.2, 0.8, 1] });
  }

  // ---- the back: plainer, brick lintels, a yard door ----
  const BK = W.back;
  const bwin = { frame: K.trim, sillColor: lime, lintel: 'brick', lintelColor: shade(brick, 0.9), lintelH: 0.45, cols: 2, rows: 2 };
  for (const [y0, h] of [[7.3, 4.9], [BASE + 11.9, 5.8], [25.1, 5.2]]) for (const u of [-5.5, 0, 5.5]) windowAt(B, BK, u, y0, 3.0, h, bwin);
  {
    const u0 = -7.4; const u1 = -4.4;
    B.box('paint', 0x1c1a18, [u0, u1], [0, 6.4], [-0.1, 0.02], { f: BK });
    doorLeaf(B, BK, u0 + 0.1, u1 - 0.1, 0.05, 6.3, 0.12, 0x5a3a2a, { glazed: true });
    casing(B, 'paint', K.trim, BK, u0, u1, 0, 6.4, { w: 0.3, out: 0.16, head: 0.28 });
    B.box('stone', K.concrete, [u0 - 0.6, u1 + 0.6], [-0.4, 0.2], [-0.1, 2.2], { f: BK });
  }

  // ---- the cornice: frieze, brackets, corona; stops at x = +/-10 exactly ----
  {
    const cy = TOP - 1.4;
    B.box('paint', K.cornice, [-HX, HX], [cy, TOP + 0.4], [HZ - 0.1, HZ + 0.35]);
    B.box('paint', shade(K.cornice, 1.18), [-HX, HX], [cy - 0.22, cy], [HZ - 0.1, HZ + 0.45]);
    B.box('paint', K.cornice, [-HX, HX], [TOP + 0.4, TOP + 1.25], [HZ - 0.1, HZ + 1.55]);
    B.box('paint', shade(K.cornice, 1.18), [-HX, HX], [TOP + 1.25, TOP + 1.5], [HZ - 0.1, HZ + 1.75]);
    B.box('paint', K.cornice, [-HX, HX], [TOP + 1.5, TOP + 2.0], [HZ - 0.1, HZ + 1.65]);
    // dentils under the corona
    for (let x = -HX + 0.12; x + 0.26 <= HX; x += 0.5) B.box('paint', shade(K.cornice, 1.1), [x, x + 0.26], [TOP + 0.15, TOP + 0.4], [HZ + 0.3, HZ + 0.6]);
    // scrolled brackets, the first and last flush with the party lines
    const nb = 7;
    for (let i = 0; i < nb; i++) {
      const xc = -HX + 0.25 + (i * (2 * HX - 0.5)) / (nb - 1);
      const bf = face([xc + 0.25, 0, HZ], [0, 0, 1]);
      B.prism('paint', shade(K.cornice, 1.05), [[0.3, cy - 1.0], [0.62, cy - 1.0], [0.78, cy - 0.3], [1.3, TOP + 0.1], [1.45, TOP + 0.4], [0.3, TOP + 0.4]], 0, 0.5, { f: bf });
    }
  }
  // parapets at the back and on the party lines, and the roof
  B.box('brick', brick, [-HX, HX], [TOP, TOP + 1.3], [-HZ, -HZ + 0.8]);
  B.box('stone', lime, [-HX, HX], [TOP + 1.3, TOP + 1.55], [-HZ - 0.08, -HZ + 0.9]);
  for (const s of [-1, 1]) {
    B.box('brick', brick, s < 0 ? [-HX, -HX + 0.7] : [HX - 0.7, HX], [TOP, TOP + 1.3], [-HZ + 0.8, HZ - 0.1]);
    B.box('stone', lime, s < 0 ? [-HX, -HX + 0.8] : [HX - 0.8, HX], [TOP + 1.3, TOP + 1.55], [-HZ + 0.9, HZ - 0.1]);
  }
  B.box('paint', K.tar, [-HX + 0.7, HX - 0.7], [TOP, TOP + 0.2], [-HZ + 0.8, HZ - 0.1]);
  // two chimneys on the party wall and a roof hatch
  for (const z of [-6, 9]) {
    B.box('brick', shade(brick, 0.92), [-HX + 0.15, -HX + 2.4], [TOP, TOP + 4.6], [z - 1.2, z + 1.2]);
    B.box('stone', lime, [-HX + 0.05, -HX + 2.5], [TOP + 4.6, TOP + 4.9], [z - 1.3, z + 1.3]);
    for (const dz of [-0.55, 0.55]) B.post('paint', 0x9a5a3e, -HX + 1.2, z + dz, TOP + 4.9, TOP + 5.6, 0.26, { sides: 10 });
  }
  B.box('paint', 0x6b6a66, [3, 6.5], [TOP, TOP + 2.2], [-8, -4]);
  B.box('paint', 0x55534f, [2.85, 6.65], [TOP + 2.2, TOP + 2.45], [-8.15, -3.85]);
  return B.assemble();
}

// ---------------------------------------------------------------------------------------------
// Apartment building: 40 x 40, five storeys and about 60ft. Two shops and a lobby on the ground
// floor; above them four apartments a floor, and the front is divided into four bays by brick piers
// so each apartment is a column you can point at: the outer two have a balcony on every floor, the
// middle two share the iron fire escape.
// ---------------------------------------------------------------------------------------------
function apartmentBuilding() {
  const B = new Build(202);
  const HX = 20; const HZ = 20;
  const W = walls(HX, HZ);
  const F = W.front;
  const GF = 14.4; // the top of the shop floor
  const FL = 10; // each floor above
  const TOP = GF + FL * 4; // 54.4
  const brick = K.brickBrown;
  const lime = K.limestone;
  const floorsY = [0, 1, 2, 3].map((k) => GF + k * FL);

  // ---- the mass ----
  B.box('stone', K.granite, [-HX, HX], [-0.4, 1.0], [-HZ, HZ]);
  B.box('brick', brick, [-HX, HX], [1.0, TOP], [-HZ, HZ]);
  // a stone sill course under every floor's windows, all the way round
  for (const y of floorsY) band(B, 'stone', lime, HX, HZ, y + 2.25, y + 2.6, 0.22);
  // and a heavier belt over the shops
  band(B, 'stone', lime, HX, HZ, GF - 0.9, GF, 0.5, { sides: ['front', 'left', 'right'] });
  band(B, 'stone', shade(lime, 1.04), HX, HZ, GF, GF + 0.35, 0.7, { sides: ['front', 'left', 'right'] });

  // ---- the shop floor ----
  const sign = { px: 80, bg: '#21433a', fg: '#efe2bf', border: '#c9a45a', family: 'Georgia, "Times New Roman", serif' };
  const shops = [
    { name: 'BAKERY', w0: -18.9, w1: -7.7, d0: -7.5, d1: -4.4, stripes: [0xb3302b, 0xece4d4] },
    { name: 'HARDWARE', w0: 7.7, w1: 18.9, d0: 4.4, d1: 7.5, stripes: [0x2f6a45, 0xece4d4] },
  ];
  // piers: the two corners and the pair flanking the lobby
  for (const [a, b] of [[-HX - 0.05, -18.9], [18.9, HX + 0.05], [-4.4, -3.0], [3.0, 4.4]]) {
    B.box('stone', lime, [a, b], [1.0, GF - 0.9], [-0.1, 0.35], { f: F });
    B.box('stone', K.granite, [a - 0.05, b + 0.05], [-0.4, 1.0], [-0.1, 0.45], { f: F });
  }
  // the sign frieze across both shops
  B.box('paint', 0x21433a, [-HX, HX], [11.6, GF - 0.9], [-0.1, 0.3], { f: F });
  for (const sh of shops) {
    const lo = Math.min(sh.w0, sh.d0); const hi = Math.max(sh.w1, sh.d1);
    const span = hi - lo; const mid = (lo + hi) / 2;
    const r = B.atlas.sign(sh.name, (span - 1.4) / 1.5, sign);
    B.box('paint', 0xffffff, [mid - span / 2 + 0.7, mid + span / 2 - 0.7], [11.8, 13.3], [0.3, 0.36], { f: F, sign: r });
    // bulkhead, display glass in three lights, transom
    B.box('paint', 0x3b2a20, [sh.w0, sh.w1], [0, 2.2], [-0.1, 0.32], { f: F });
    B.box('paint', 0x4c3628, [sh.w0 - 0.05, sh.w1 + 0.05], [2.0, 2.35], [-0.1, 0.45], { f: F });
    B.box('glass', K.glass, [sh.w0, sh.w1], [2.35, 10.2], [-0.1, 0.06], { f: F, tint: (x, y, z, c) => { const k = 0.85 + 0.5 * ((y - 2.35) / 7.85); c[0] *= k; c[1] *= k; c[2] *= k; } });
    B.box('glass', shade(K.glass, 1.3), [sh.w0, sh.w1], [10.5, 11.5], [-0.1, 0.06], { f: F });
    const lights = 3;
    for (let i = 0; i <= lights; i++) {
      const u = sh.w0 + ((sh.w1 - sh.w0) * i) / lights;
      B.box('paint', 0x3b2a20, [u - 0.13, u + 0.13], [2.3, 11.6], [-0.05, 0.2], { f: F });
    }
    B.box('paint', 0x3b2a20, [sh.w0, sh.w1], [10.2, 10.5], [-0.05, 0.2], { f: F });
    for (let i = 1; i < 8; i++) {
      const u = sh.w0 + ((sh.w1 - sh.w0) * i) / 8;
      B.box('paint', 0x3b2a20, [u - 0.05, u + 0.05], [10.5, 11.5], [-0.05, 0.12], { f: F });
    }
    // the shop door: glazed, under its own transom
    B.box('paint', 0x18130f, [sh.d0, sh.d1], [0, 10.2], [-0.12, 0.0], { f: F });
    doorLeaf(B, F, sh.d0 + 0.15, sh.d1 - 0.15, 0.05, 8.6, 0.1, 0x4c3628, { glazed: true, knob: K.brass, kick: K.brass });
    B.box('glass', shade(K.glass, 1.3), [sh.d0 + 0.1, sh.d1 - 0.1], [8.9, 10.1], [-0.08, 0.04], { f: F });
    B.box('paint', 0x3b2a20, [sh.d0, sh.d1], [8.6, 8.9], [-0.05, 0.2], { f: F });
    for (const u of [sh.d0, sh.d1]) B.box('paint', 0x3b2a20, [u - 0.13, u + 0.13], [0, 11.6], [-0.05, 0.2], { f: F });
    B.box('stone', K.granite, [sh.d0, sh.d1], [-0.4, 0.3], [-0.1, 0.9], { f: F });
    // a striped awning over the display window
    awning(B, F, sh.w0 + 0.1, sh.w1 - 0.1, 11.45, 4.6, 2.0, sh.stripes, { stripe: 0.93, valance: 0.85 });
  }
  // the lobby: double glazed doors, a transom with the street number, a stone surround and lamps
  {
    const d0 = -2.5; const d1 = 2.5; const y1 = 8.4;
    B.box('paint', 0x15120f, [-3.0, 3.0], [0, 11.6], [-0.12, 0.0], { f: F });
    doorLeaf(B, F, d0, -0.03, 0.4, y1, 0.1, 0x6b2d22, { glazed: true, knob: K.brass, kick: K.brass });
    doorLeaf(B, F, 0.03, d1, 0.4, y1, 0.1, 0x6b2d22, { glazed: true, knob: K.brass, kick: K.brass });
    B.box('paint', K.trim, [d0, d1], [y1, y1 + 0.3], [-0.05, 0.2], { f: F });
    B.box('glass', shade(K.glass, 1.25), [d0, d1], [y1 + 0.3, 10.9], [-0.06, 0.04], { f: F });
    const num = B.atlas.sign('120', 2.6, { bg: '#1a232c', fg: '#e5bd63', px: 64, family: 'Georgia, serif', fill: 0.7 });
    B.box('paint', 0xffffff, [-1.0, 1.0], [y1 + 0.85, y1 + 1.6], [0.04, 0.08], { f: F, sign: num });
    B.box('stone', K.granite, [-3.0, 3.0], [-0.4, 0.4], [-0.1, 1.6], { f: F });
    B.box('stone', K.granite, [-2.7, 2.7], [-0.4, 0.4], [1.5, 2.6], { f: F });
    // a little canopy over the lobby door, on two iron rods
    B.box('metal', 0x2c3a33, [-3.1, 3.1], [11.0, 11.35], [-0.1, 3.4], { f: F });
    for (const u of [-2.8, 2.8]) B.bar('metal', K.iron, [u, 13.2, 0], [u, 11.3, 3.2], 0.07, 0.07, { f: F });
    for (const u of [-3.7, 3.7]) {
      B.box('metal', K.iron, [u - 0.12, u + 0.12], [7.0, 7.6], [0.3, 0.55], { f: F });
      B.turned('glass', 0xe8dcb4, [[0, 0], [0.32, 0.15], [0.36, 0.7], [0.22, 1.0], [0, 1.05]], u, 7.6, 0.75, { f: F, sides: 12 });
    }
  }

  // ---- four apartments a floor ----
  const bays = [-15, -5, 5, 15];
  for (const u of [-10, 0, 10]) B.box('brick', shade(brick, 1.05), [u - 0.65, u + 0.65], [GF + 0.35, TOP], [-0.1, 0.35], { f: F });
  for (const u of [-HX - 0.05, HX - 1.15]) B.box('brick', shade(brick, 1.05), [u, u + 1.2], [GF + 0.35, TOP], [-0.1, 0.35], { f: F });
  const win = { frame: K.trim, sill: null, lintelColor: lime, cols: 1, rows: 2, keystone: true, lintelH: 0.6 };
  for (const y of floorsY) {
    for (const uc of bays) {
      for (const du of [-2.2, 2.2]) windowAt(B, F, uc + du, y + 2.6, 2.9, y > 40 ? 5.0 : 5.6, win);
      // a recessed brick panel under each pair, the apartment's own spandrel
      B.box('brick', shade(brick, 0.86), [uc - 3.7, uc + 3.7], [y + 0.5, y + 1.9], [-0.1, 0.05], { f: F });
    }
  }
  // the outer two apartments: a balcony on every floor
  for (const uc of [-15, 15]) {
    for (const y of floorsY) {
      const by = y + 2.1;
      B.box('stone', lime, [uc - 3.9, uc + 3.9], [by - 0.35, by], [-0.1, 2.6], { f: F });
      for (const du of [-3.3, -1.4, 1.4, 3.3]) {
        const bf = face([uc + du + 0.2, 0, HZ], [0, 0, 1]);
        B.prism('stone', lime, [[0, by - 0.35], [2.0, by - 0.35], [0, by - 1.6]], 0, 0.4, { f: bf });
      }
      railing(B, 'metal', K.iron, [uc - 3.75, by, HZ + 2.45], [uc + 3.75, by, HZ + 2.45], 3.0, { step: 0.38 });
      for (const s of [-1, 1]) railing(B, 'metal', K.iron, [uc + s * 3.75, by, HZ + 0.3], [uc + s * 3.75, by, HZ + 2.45], 3.0, { step: 0.38 });
    }
  }
  // the middle two share the fire escape: a platform at every floor, a stair through a hatch in the
  // one above, a drop ladder at the bottom and a gooseneck ladder up to the roof at the top
  {
    const iron = 0x2a2c2f;
    const U0 = -8.6; const U1 = 8.6; const D = 3.9;
    const hatch = [-1.6, 1.5];
    floorsY.forEach((y, k) => {
      const py = y + 1.0;
      // the grating: an inner strip, and an outer strip with the hatch left open where the stair arrives
      B.box('metal', iron, [U0, U1], [py - 0.14, py], [-0.1, 2.3], { f: F });
      if (k === 0) B.box('metal', iron, [U0, U1], [py - 0.14, py], [2.3, D], { f: F });
      else {
        B.box('metal', iron, [U0, hatch[0]], [py - 0.14, py], [2.3, D], { f: F });
        B.box('metal', iron, [hatch[1], U1], [py - 0.14, py], [2.3, D], { f: F });
      }
      for (let u = U0 + 0.4; u < U1; u += 0.55) B.box('metal', shade(iron, 1.3), [u - 0.02, u + 0.02], [py, py + 0.03], [0, D], { f: F });
      railing(B, 'metal', iron, [U0, py, HZ + D], [U1, py, HZ + D], 3.0, { step: 0.36, post: 0.035, rail: 0.09 });
      for (const u of [U0, U1]) railing(B, 'metal', iron, [u, py, HZ + 0.2], [u, py, HZ + D], 3.0, { step: 0.36, post: 0.035, rail: 0.09 });
      // brackets into the wall
      for (const u of [U0 + 0.5, -3, 3, U1 - 0.5]) B.bar('metal', iron, [u, py - 2.2, 0], [u, py - 0.12, D - 0.3], 0.1, 0.1, { f: F });
      // the stair up to the next platform
      if (k < floorsY.length - 1) {
        const top = floorsY[k + 1] + 1.0;
        const a = [-7.4, py, 3.1]; const b = [hatch[1] - 0.15, top, 3.1];
        for (const n of [2.45, 3.75]) B.bar('metal', iron, [a[0], a[1], n], [b[0], b[1], n], 0.08, 0.5, { f: F });
        const nt = 13;
        for (let t = 1; t < nt; t++) {
          const s = t / nt; const u = a[0] + (b[0] - a[0]) * s; const yy = a[1] + (b[1] - a[1]) * s;
          B.box('metal', shade(iron, 1.2), [u - 0.25, u + 0.25], [yy - 0.05, yy + 0.02], [2.45, 3.75], { f: F });
        }
        B.bar('metal', iron, [a[0], a[1] + 3.0, 3.8], [b[0], b[1] + 3.0, 3.8], 0.09, 0.09, { f: F });
      }
    });
    // the drop ladder, hanging folded above the sidewalk beside the lobby
    const ly = floorsY[0] + 1.0;
    for (const u of [-6.7, -5.4]) B.box('metal', iron, [u - 0.05, u + 0.05], [ly - 7.0, ly + 0.3], [D - 0.4, D - 0.3], { f: F });
    for (let y = ly - 6.6; y < ly; y += 0.95) B.box('metal', iron, [-6.7, -5.4], [y - 0.04, y + 0.04], [D - 0.42, D - 0.28], { f: F });
    // the gooseneck to the roof
    const ty = floorsY[3] + 1.0;
    for (const u of [6.3, 7.6]) {
      B.box('metal', iron, [u - 0.05, u + 0.05], [ty, TOP + 3.8], [0.9, 1.0], { f: F });
      B.bar('metal', iron, [u, TOP + 3.8, 1.0], [u, TOP + 3.8, -1.5], 0.1, 0.1, { f: F });
    }
    for (let y = ty + 0.9; y < TOP + 3.6; y += 0.95) B.box('metal', iron, [6.3, 7.6], [y - 0.04, y + 0.04], [0.88, 1.02], { f: F });
  }

  // ---- sides and back ----
  const plain = { frame: K.trim, sill: null, lintel: 'brick', lintelColor: shade(brick, 0.85), lintelH: 0.45, cols: 1, rows: 2 };
  for (const side of [W.left, W.right]) {
    for (const y of floorsY) for (const u of [-15, -5, 5, 15]) windowAt(B, side, u, y + 2.6, 2.9, y > 40 ? 5.0 : 5.6, plain);
    for (const u of [-12, 12]) windowAt(B, side, u, 4.2, 3.2, 5.2, { ...plain, cols: 2, sill: 'stone', sillColor: lime });
  }
  for (const y of floorsY) for (const u of [-17, -12.5, -7.5, -2.5, 2.5, 7.5, 12.5, 17]) windowAt(B, W.back, u, y + 2.6, 2.7, y > 40 ? 5.0 : 5.4, plain);
  for (const u of [-12, 12]) {
    B.box('paint', 0x17140f, [u - 1.6, u + 1.6], [0, 7.4], [-0.1, 0.02], { f: W.back });
    doorLeaf(B, W.back, u - 1.5, u + 1.5, 0.05, 7.2, 0.12, 0x4e5458, { panels: 2 });
    B.box('stone', K.concrete, [u - 2.2, u + 2.2], [-0.4, 0.25], [-0.1, 2.0], { f: W.back });
  }
  for (const u of [-6, -1, 4, 9]) windowAt(B, W.back, u, 5.0, 2.8, 3.6, { ...plain, sill: 'stone', sillColor: lime });

  // ---- the cornice, brackets and parapet ----
  band(B, 'paint', K.cornice, HX, HZ, TOP - 1.2, TOP + 0.6, 0.4, { sides: ['front', 'left', 'right'] });
  band(B, 'paint', shade(K.cornice, 1.2), HX, HZ, TOP - 1.45, TOP - 1.2, 0.5, { sides: ['front', 'left', 'right'] });
  band(B, 'paint', K.cornice, HX, HZ, TOP + 0.6, TOP + 1.6, 2.0, { sides: ['front', 'left', 'right'] });
  band(B, 'paint', shade(K.cornice, 1.2), HX, HZ, TOP + 1.6, TOP + 1.95, 2.25, { sides: ['front', 'left', 'right'] });
  band(B, 'paint', K.cornice, HX, HZ, TOP + 1.95, TOP + 2.5, 2.1, { sides: ['front', 'left', 'right'] });
  for (let i = 0; i < 17; i++) {
    const xc = -HX + 0.6 + (i * (2 * HX - 1.2)) / 16;
    const bf = face([xc + 0.3, 0, HZ], [0, 0, 1]);
    B.prism('paint', shade(K.cornice, 1.08), [[0.4, TOP - 1.6], [0.75, TOP - 1.6], [0.95, TOP - 0.7], [1.75, TOP + 0.3], [1.9, TOP + 0.6], [0.4, TOP + 0.6]], 0, 0.6, { f: bf });
  }
  B.box('brick', brick, [-HX, HX], [TOP + 2.5, TOP + 4.6], [HZ - 1.0, HZ - 0.1]);
  B.box('stone', lime, [-HX - 0.1, HX + 0.1], [TOP + 4.6, TOP + 5.0], [HZ - 1.1, HZ]);
  // a raised centre panel on the parapet with the building's name
  B.box('brick', brick, [-6, 6], [TOP + 4.6, TOP + 6.2], [HZ - 1.0, HZ - 0.1]);
  B.box('stone', lime, [-6.2, 6.2], [TOP + 6.2, TOP + 6.6], [HZ - 1.1, HZ]);
  const nm = B.atlas.sign('THE MAPLE', 8, { bg: '#d8cdb4', fg: '#5a4632', px: 60, family: 'Georgia, serif', fill: 0.62 });
  B.box('paint', 0xffffff, [-5.2, 5.2], [TOP + 4.75, TOP + 6.05], [HZ - 0.12, HZ + 0.02], { sign: nm });
  // side and back parapets
  for (const s of [-1, 1]) {
    const xr = s < 0 ? [-HX, -HX + 0.9] : [HX - 0.9, HX];
    B.box('brick', brick, xr, [TOP + 2.5, TOP + 3.8], [-HZ + 0.9, HZ - 1.0]);
    B.box('stone', lime, xr, [TOP + 3.8, TOP + 4.1], [-HZ + 0.9, HZ - 1.0]);
  }
  B.box('brick', brick, [-HX, HX], [TOP, TOP + 3.0], [-HZ, -HZ + 0.9]);
  B.box('stone', lime, [-HX - 0.1, HX + 0.1], [TOP + 3.0, TOP + 3.3], [-HZ - 0.1, -HZ + 1.0]);
  for (const s of [-1, 1]) {
    const xr = s < 0 ? [-HX, -HX + 0.9] : [HX - 0.9, HX];
    B.box('brick', brick, xr, [TOP, TOP + 2.5], [-HZ + 0.9, HZ - 1.0]);
  }
  B.box('paint', K.tar, [-HX + 0.9, HX - 0.9], [TOP, TOP + 0.2], [-HZ + 0.9, HZ - 1.0]);
  // the stair bulkhead and two chimneys
  B.box('brick', brick, [-12, -4], [TOP, TOP + 9], [-12, -4]);
  B.box('stone', lime, [-12.3, -3.7], [TOP + 9, TOP + 9.4], [-12.3, -3.7]);
  B.box('paint', 0x55595c, [-9.5, -6.5], [TOP + 0.2, TOP + 7], [-4.05, -3.9]);
  for (const [x, z] of [[10, -10], [10, 6]]) {
    B.box('brick', shade(brick, 0.9), [x - 1.4, x + 1.4], [TOP, TOP + 6.5], [z - 1.1, z + 1.1]);
    B.box('stone', lime, [x - 1.55, x + 1.55], [TOP + 6.5, TOP + 6.8], [z - 1.25, z + 1.25]);
  }
  return B.assemble();
}

// ---------------------------------------------------------------------------------------------
// Office tower: 40 x 40, twelve floors of 13ft and about 165ft with its parapet and machinery. A
// stone base with a recessed entrance, a revolving door and a lobby you can see into, then eleven
// floors of glass curtain wall: each floor marked by a band of brushed steel, every 5ft a steel
// mullion. The curtain wall hangs on the frame, so nothing in it carries anything, which is why it
// can be glass.
// ---------------------------------------------------------------------------------------------
function officeTower() {
  const B = new Build(303);
  B.glowColor = 0xfff1d6;
  const HX = 20; const HZ = 20;
  const FH = 13; const FLOORS = 12;
  const ROOF = FH * FLOORS; // 156
  const BASE = 14; // the top of the stone base
  const stone = 0xcfc6b4; const granite = 0x6f6c69; const steel = 0x9aa0a6; const bronze = 0x6e5a3f;
  const W = walls(HX, HZ);
  const rng = B.rng;

  // ---- the stone base ----
  // the core behind the lobby, the two side walls running out to the corner piers, the loggia
  // columns, the soffit over the entrance and a heavy band on top
  B.box('stone', stone, [-HX, HX], [-0.4, BASE], [-HZ, -1]);
  for (const s of [-1, 1]) B.box('stone', stone, s < 0 ? [-HX, -18.4] : [18.4, HX], [-0.4, BASE], [-1, HZ]);
  B.box('stone', stone, [-18.4, 18.4], [12.4, BASE], [-1, HZ]);
  B.box('stone', granite, [-HX - 0.15, HX + 0.15], [-0.4, 1.6], [-HZ - 0.15, HZ + 0.15], {});
  band(B, 'stone', shade(stone, 1.05), HX, HZ, BASE - 0.8, BASE, 0.25);
  for (const u of [-12, -4, 4, 12]) {
    B.box('stone', stone, [u - 0.8, u + 0.8], [1.6, 12.4], [HZ - 1.6, HZ]);
    B.box('stone', granite, [u - 0.95, u + 0.95], [0.12, 1.6], [HZ - 1.75, HZ + 0.15]);
  }
  // the address, in bronze letters on the band over the entrance
  const addr = B.atlas.sign('100 MAIN STREET', 12, { bg: '#d2c9b7', fg: '#5c4a33', px: 64, family: '"Helvetica Neue", Arial, sans-serif', font: 'bold', fill: 0.6 });
  B.box('paint', 0xffffff, [-9, 9], [BASE - 0.72, BASE - 0.08], [HZ + 0.25, HZ + 0.29], { sign: addr });
  // the loggia: granite paving out front, terrazzo inside, the lobby's glass wall set back at z = 15.5
  B.box('stone', granite, [-18.4, 18.4], [-0.4, 0.12], [15.5, HZ]);
  B.checker('paint', -18.4, 18.4, -1, 15.5, -0.4, 0.1, 2.2, 0xd9d2c4, 0xb9b0a0);
  const GZ = 15.5;
  const doorR = 3.6;
  // glass wall, in bronze frames, with the revolving door in the middle
  const bays = [[-18.4, -12], [-12, -8], [-8, -4], [4, 8], [8, 12], [12, 18.4]];
  for (const [a, b] of bays) B.box('clear', 0x9fb7c4, [a, b], [0.1, 12.4], [GZ - 0.12, GZ - 0.04]);
  B.box('clear', 0x9fb7c4, [-4, 4], [8.4, 12.4], [GZ - 0.12, GZ - 0.04]);
  for (const u of [-18.4, -15.2, -12, -8, -4, 4, 8, 12, 15.2, 18.4]) B.box('metal', bronze, [u - 0.14, u + 0.14], [0.1, 12.4], [GZ - 0.2, GZ + 0.08]);
  for (const y of [0.1, 8.4, 12.3]) B.box('metal', bronze, [-18.4, 18.4], [y - 0.1, y + 0.18], [GZ - 0.2, GZ + 0.08]);
  {
    // the drum: two curved glass walls left and right, open front and back, under a bronze crown
    const cz = GZ - 0.08;
    const arc = (a0, a1, r0, r1, n = 10) => {
      const pts = [];
      for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([Math.sin(a) * r1, cz + Math.cos(a) * r1]); }
      for (let i = n; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / n; pts.push([Math.sin(a) * r0, cz + Math.cos(a) * r0]); }
      return pts;
    };
    for (const c of [-Math.PI / 2, Math.PI / 2]) {
      B.slab('clear', 0x9fb7c4, arc(c - 0.85, c + 0.85, doorR - 0.06, doorR + 0.02), 0.12, 8.0);
      B.slab('metal', bronze, arc(c - 0.88, c + 0.88, doorR - 0.1, doorR + 0.06), 0.1, 0.35);
    }
    B.post('metal', bronze, 0, cz, 8.0, 8.9, doorR + 0.15, { sides: 28 });
    B.post('metal', shade(bronze, 0.8), 0, cz, 0.1, 0.16, doorR, { sides: 28 });
    // four wings, turned a little off square so the door reads as a door that turns
    for (let k = 0; k < 4; k++) {
      const a = 0.42 + (k * Math.PI) / 2;
      const tip = [Math.sin(a) * (doorR - 0.15), 0, cz + Math.cos(a) * (doorR - 0.15)];
      B.bar('clear', 0xa9c0cc, [0, 4.05, cz], [tip[0], 4.05, tip[2]], 0.06, 7.5);
      for (const y of [0.45, 4.05, 7.75]) B.bar('metal', bronze, [0, y, cz], [tip[0], y, tip[2]], 0.12, y === 4.05 ? 0.12 : 0.3);
      B.post('metal', bronze, tip[0], tip[2], 0.2, 7.9, 0.07, { sides: 6 });
    }
    B.post('metal', bronze, 0, cz, 0.1, 8.0, 0.16, { sides: 10 });
  }
  // the lobby: marble walls, three elevators, a desk and a plant, and a lit ceiling
  {
    const marble = 0xe6dfd1;
    B.box('stone', marble, [-18.4, 18.4], [0.1, 12.4], [-1, -0.8]);
    for (const s of [-1, 1]) B.box('stone', marble, s < 0 ? [-18.4, -18.2] : [18.2, 18.4], [0.1, 12.4], [-0.8, GZ - 0.2]);
    B.box('paint', 0xf0ece2, [-18.2, 18.2], [12.0, 12.4], [-0.8, GZ - 0.2]);
    for (let x = -14; x <= 14; x += 7) for (const z of [3, 10]) B.box('glow', 0xffffff, [x - 2.2, x + 2.2], [11.92, 12.0], [z - 0.6, z + 0.6]);
    for (const x of [-7, 0, 7]) {
      B.box('metal', 0xb79a5c, [x - 2.4, x + 2.4], [0.1, 8.6], [-0.8, -0.62]);
      B.box('metal', 0x8f7444, [x - 1.8, x + 1.8], [0.1, 7.6], [-0.62, -0.55]);
      B.box('metal', 0x5f4c2e, [x - 0.02, x + 0.02], [0.1, 7.6], [-0.55, -0.5]);
      B.box('glow', 0xffffff, [x - 0.9, x + 0.9], [8.0, 8.35], [-0.62, -0.56]);
    }
    const desk = 0x4b3a2c;
    B.box('stone', 0x3f3d3b, [-5, 5], [0.1, 3.6], [4.5, 6.5]);
    B.box('stone', 0xd8d1c1, [-5.2, 5.2], [3.6, 3.85], [4.3, 6.7]);
    B.box('paint', desk, [-4.8, 4.8], [2.6, 2.9], [3.6, 4.5]);
    for (const [x, z] of [[-14, 11], [14, 11]]) {
      B.turned('paint', 0x6d5a48, [[0, 0], [1.1, 0], [1.3, 2.2], [0, 2.2]], x, 0.1, z, { sides: 14 });
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05; const r = 0.6 + (i % 2) * 0.3;
        B.ball('paint', 0x3f6f34, x + Math.sin(a) * r, 3.6 + (i % 3) * 0.8, z + Math.cos(a) * r, 1.0, { w: 8, h: 6 });
      }
      B.ball('paint', 0x4a7d3b, x, 5.4, z, 1.0, { w: 8, h: 6 });
    }
  }
  // tall windows in the stone base on the sides and the back
  for (const f of [W.left, W.right, W.back]) {
    for (const u of [-13, -5, 5, 13]) {
      if (f !== W.back && u > 10) continue;
      windowAt(B, f, u, 2.6, 5.6, 8.8, { frame: bronze, cols: 3, rows: 1, sash: false, sill: 'stone', sillColor: granite, lintel: null, frameW: 0.3 });
    }
  }
  // a service door at the back
  B.box('metal', 0x6d7276, [-17.6, -14.8], [0.1, 8], [-HZ - 0.12, -HZ + 0.05]);
  B.box('stone', granite, [-18.1, -14.3], [-0.4, 0.3], [-HZ - 2, -HZ]);

  // ---- the curtain wall ----
  const glass = 0x32506a; // a blue-grey curtain wall glass, a little lighter than the kit's window glass
  const top = ROOF + 3; // the parapet
  B.box('glass', shade(glass, 0.8), [-HX + 0.5, HX - 0.5], [BASE, top], [-HZ + 0.5, HZ - 0.5]);
  for (const f of Object.values(W)) {
    // vision glass, a box per bay per floor so every pane catches the sky a little differently
    for (let fl = 1; fl < FLOORS; fl++) {
      const y0 = fl * FH;
      const g0 = y0 + 2.4; const g1 = (fl + 1) * FH - 1.1;
      for (let b = 0; b < 8; b++) {
        const u0 = -HX + b * 5; const u1 = u0 + 5;
        const blinds = rng() < 0.14;
        const tone = blinds ? blend(glass, 0x8e9aa2, 0.3) : glass;
        const k = 0.86 + rng() * 0.28;
        B.box('glass', shade(tone, k), [u0 + 0.05, u1 - 0.05], [g0, g1], [-0.5, -0.32], {
          f,
          tint: (x, y, z, c) => { const t = 0.72 + 0.62 * ((y - g0) / (g1 - g0)) * (0.55 + 0.45 * (y / ROOF)); c[0] *= t; c[1] *= t; c[2] *= t * 1.03; },
        });
        // a transom bar a third of the way up each pane
        B.box('metal', steel, [u0, u1], [g0 + 6.2, g0 + 6.42], [-0.5, -0.26], { f });
      }
      // the steel band that marks the floor: it hides the slab and the ceiling void
      const b0 = fl === 1 ? BASE : y0 - 1.1;
      B.box('metal', steel, [-HX + 0.5, HX - 0.5], [b0, g0], [-0.5, -0.15], { f });
      B.box('metal', shade(steel, 1.12), [-HX + 0.5, HX - 0.5], [g0 - 0.2, g0], [-0.5, -0.08], { f });
    }
    // the parapet band
    B.box('metal', steel, [-HX + 0.5, HX - 0.5], [ROOF - 1.1, top], [-0.5, -0.15], { f });
    B.box('metal', shade(steel, 1.15), [-HX + 0.4, HX - 0.4], [top, top + 0.3], [-0.7, 0.05], { f });
    // mullions every 5ft, standing proud
    for (let b = 1; b < 8; b++) {
      const u = -HX + b * 5;
      B.box('metal', shade(steel, 0.92), [u - 0.16, u + 0.16], [BASE, top], [-0.5, 0], { f });
    }
  }
  // the four corner columns
  for (const x of [-HX, HX]) for (const z of [-HZ, HZ]) {
    B.box('metal', shade(steel, 0.85), [x - (x > 0 ? 0.9 : 0), x + (x < 0 ? 0.9 : 0)], [BASE, top], [z - (z > 0 ? 0.9 : 0), z + (z < 0 ? 0.9 : 0)]);
  }

  // ---- the roof: machinery behind the parapet ----
  B.box('paint', K.tar, [-HX + 0.5, HX - 0.5], [ROOF - 0.5, ROOF + 0.25], [-HZ + 0.5, HZ - 0.5]);
  const plant = 0xb9b6ae;
  B.box('stone', plant, [-11, 9], [ROOF, ROOF + 8.2], [-11, 5]);
  B.box('stone', shade(plant, 1.08), [-11.4, 9.4], [ROOF + 8.2, ROOF + 8.6], [-11.4, 5.4]);
  // louvres on the plant room
  for (let y = ROOF + 1.5; y < ROOF + 7.4; y += 0.45) B.box('metal', shade(steel, 0.8), [-7, 5], [y, y + 0.16], [5, 5.32]);
  B.box('metal', 0x6d7276, [-10, -7.6], [ROOF + 0.25, ROOF + 7.2], [5, 5.15]);
  // two cooling towers with their fan stacks
  for (const x of [-6, 6]) {
    B.box('metal', 0x8b9095, [x - 3.4, x + 3.4], [ROOF, ROOF + 5.6], [-18.2, -12.4]);
    for (let y = ROOF + 0.8; y < ROOF + 5; y += 0.5) B.box('metal', 0x6f7479, [x - 3.4, x + 3.4], [y, y + 0.18], [-12.4, -12.28]);
    B.turned('metal', 0x9aa0a5, [[0, 0], [2.4, 0], [2.6, 1.6], [2.3, 1.7], [0, 1.7]], x, ROOF + 5.6, -15.3, { sides: 24 });
  }
  // a window-cleaning davit at each corner, and a short mast
  for (const [x, z] of [[-17.5, 17.5], [17.5, 17.5], [17.5, -8], [-17.5, -8]]) {
    B.post('metal', 0xd2d4d6, x, z, ROOF, ROOF + 4.6, 0.18, { sides: 8 });
    B.bar('metal', 0xd2d4d6, [x, ROOF + 4.6, z], [x + Math.sign(x) * 1.6, ROOF + 4.6, z + Math.sign(z) * 1.6], 0.2, 0.2);
  }
  B.post('metal', 0xc8cacc, 6, 0, ROOF + 8.6, ROOF + 9.0, 0.5, { sides: 10 });
  return B.assemble();
}

// ---------------------------------------------------------------------------------------------
// Corner grocery: 30 wide x 40 deep, two storeys, display windows on the front AND the +X side
// because a corner store faces two streets. The door is a real opening onto a shop floor at
// ground level, so a student walks in among two aisles of shelves, a wall of groceries, a dairy
// case and the counter with its till. Crates of fruit stand outside under the striped awning.
// The shop windows are the one see-through mesh, so the shelves read from the sidewalk.
// ---------------------------------------------------------------------------------------------
const PRODUCT = [0xc8342c, 0xe0b23a, 0x2f6fae, 0x3b8a4a, 0xe7e1cf, 0xd8682a, 0x7a3f8c, 0x9c2a3a, 0x2b8c8c, 0xf0d35a];

// Goods on a shelf are a PAINTING on the front of one block per shelf run: a facing of packets, cans,
// jars and bottles drawn per texel, so a whole shop of them costs a few hundred triangles and every
// label is sharp. Six variants, picked at random along each shelf.
const GOODS_FT = [4.5, 1.25];
function goodsVariants(B, rng) {
  const css = (hex, k = 1) => { const c = new THREE.Color(hex); return `rgb(${Math.round(Math.min(255, c.r * 255 * k))},${Math.round(Math.min(255, c.g * 255 * k))},${Math.round(Math.min(255, c.b * 255 * k))})`; };
  const out = [];
  for (let v = 0; v < 6; v++) {
    out.push(B.atlas.paint(512, 142, (ctx, w, h) => {
      ctx.fillStyle = '#2b2724';
      ctx.fillRect(0, 0, w, h);
      let x = 3;
      const kind = v % 3;
      while (x < w - 10) {
        const c = PRODUCT[Math.floor(rng() * PRODUCT.length)];
        const count = 2 + Math.floor(rng() * 3);
        for (let k = 0; k < count && x < w - 10; k++) {
          if (kind === 0) {
            // packets and cereal boxes
            const pw = 30 + (v * 7) % 14; const ph = h * (0.62 + ((v * 13) % 5) * 0.06);
            ctx.fillStyle = css(c); ctx.fillRect(x, h - ph, pw, ph);
            ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x + 3, h - ph * 0.72, pw - 6, ph * 0.22);
            ctx.fillStyle = css(c, 0.6); ctx.beginPath(); ctx.arc(x + pw / 2, h - ph * 0.3, pw * 0.22, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + pw - 3, h - ph, 3, ph);
            x += pw + 2;
          } else if (kind === 1) {
            // cans in two stacked rows
            const pw = 26; const ph = h * 0.42;
            for (const row of [0, 1]) {
              const y = h - ph * (row + 1) - row * 2;
              ctx.fillStyle = css(c); ctx.fillRect(x, y, pw, ph);
              ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(x, y + ph * 0.3, pw, ph * 0.38);
              ctx.fillStyle = css(c, 0.7); ctx.fillRect(x + pw * 0.3, y + ph * 0.38, pw * 0.4, ph * 0.22);
              ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + pw * 0.2, y, pw * 0.12, ph);
              ctx.fillStyle = '#9ea3a8'; ctx.fillRect(x, y, pw, 3); ctx.fillRect(x, y + ph - 3, pw, 3);
            }
            x += 28;
          } else {
            // jars and bottles
            const pw = 24; const ph = h * (0.55 + (k % 2) * 0.2);
            const y = h - ph;
            ctx.fillStyle = css(c, 0.85);
            ctx.fillRect(x + 2, y + ph * 0.28, pw - 4, ph * 0.72);
            ctx.fillRect(x + pw * 0.3, y + ph * 0.08, pw * 0.4, ph * 0.22);
            ctx.fillStyle = '#d9d4c8'; ctx.fillRect(x + pw * 0.27, y, pw * 0.46, ph * 0.09);
            ctx.fillStyle = 'rgba(255,250,235,0.9)'; ctx.fillRect(x + 2, y + ph * 0.5, pw - 4, ph * 0.26);
            ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(x + 5, y + ph * 0.3, 3, ph * 0.6);
            x += pw + 3;
          }
        }
        x += 4;
      }
    }));
  }
  return out;
}

// Fills a shelf from u0 to u1 with painted goods blocks, about GOODS_FT[0] each.
function shelfGoods(B, f, u0, u1, y, n0, n1, variants, rng, { h = 1.1 } = {}) {
  const n = Math.max(1, Math.round((u1 - u0 - 0.1) / GOODS_FT[0]));
  const w = (u1 - u0 - 0.1) / n;
  const topC = col(0x5e5850);
  for (let i = 0; i < n; i++) {
    const a = u0 + 0.05 + i * w;
    const r = variants[Math.floor(rng() * variants.length)];
    B.box('paint', 0xffffff, [a, a + w], [y, y + h], [n0 + 0.05, n1 - 0.02], {
      f, sign: r, tint: (x, yy, z, c, nx, ny) => { if (ny > 0.5) { c[0] = topC[0]; c[1] = topC[1]; c[2] = topC[2]; } },
    });
  }
}

function cornerGrocery() {
  const B = new Build(404);
  const HX = 15; const HZ = 20; const T = 0.9; // wall thickness
  const W = walls(HX, HZ);
  const F = W.front; const R = W.right;
  const GF = 13; // the shop floor's ceiling is at 12.2
  const TOP = 23.2;
  const brick = 0x8e4f3b;
  const lime = K.limestone;
  const green = 0x24513d;
  const cream = 0xeee6d2;
  const rng = B.rng;

  // ---- walls: the two shop fronts have real openings; the upper floor is closed ----
  const front = [
    { u0: -13.6, u1: -4.4, y0: 2.4, y1: 10.4 },
    { u0: -3.0, u1: 1.4, y0: -1, y1: 9.4 },
    { u0: 2.8, u1: 13.4, y0: 2.4, y1: 10.4 },
  ];
  const side = [
    { u0: -17.6, u1: -8.2, y0: 2.4, y1: 10.4 },
    { u0: -6.2, u1: 4.4, y0: 2.4, y1: 10.4 },
  ];
  holedWall(B, 'brick', brick, F, -HX, HX, -0.4, TOP, -T, 0, front);
  holedWall(B, 'brick', brick, R, -HZ + T, HZ - T, -0.4, TOP, -T, 0, side);
  B.box('brick', brick, [-HX, HX], [-0.4, TOP], [-HZ, -HZ + T]);
  B.box('brick', brick, [-HX, -HX + T], [-0.4, TOP], [-HZ + T, HZ - T]);
  // the floors: a checker of linoleum at ground level, the ceiling, the upper floor and the roof
  B.checker('paint', -HX + T, HX - T, -HZ + T, HZ - T, -0.4, 0.1, 2, 0x2f5d4a, 0xe6dfcb);
  B.box('stone', K.concrete, [-3.0, 1.4], [-0.4, 0.12], [HZ - T, HZ + 0.25]);
  B.box('paint', 0xf3efe6, [-HX + T, HX - T], [12.2, GF + 0.2], [-HZ + T, HZ - T]);
  B.box('paint', K.tar, [-HX + T, HX - T], [TOP - 0.8, TOP - 0.6], [-HZ + T, HZ - T]);
  // a pale lining inside the shop, so the room is lit by its own walls
  holedWall(B, 'paint', cream, F, -HX + T, HX - T, 0.1, 12.2, -T - 0.06, -T, front);
  holedWall(B, 'paint', cream, R, -HZ + T, HZ - T, 0.1, 12.2, -T - 0.06, -T, side);
  B.box('paint', cream, [-HX + T, HX - T], [0.1, 12.2], [-HZ + T, -HZ + T + 0.06]);
  B.box('paint', cream, [-HX + T, -HX + T + 0.06], [0.1, 12.2], [-HZ + T + 0.06, HZ - T]);
  // a green dado and a pressed-tin cornice inside, the old shop's two horizontal lines
  B.box('paint', green, [-HX + T, HX - T], [0.1, 3.0], [-HZ + T + 0.06, -HZ + T + 0.12]);
  B.box('paint', green, [-HX + T + 0.06, -HX + T + 0.12], [0.1, 3.0], [-HZ + T + 0.12, HZ - T]);
  // fluorescent fittings
  for (const x of [-8, 1, 9]) for (const z of [-12, -3, 6, 14]) {
    B.box('paint', 0xb8bcbf, [x - 2.1, x + 2.1], [11.85, 12.2], [z - 0.45, z + 0.45]);
    B.box('paint', 0xfffdf6, [x - 2.0, x + 2.0], [11.8, 11.86], [z - 0.35, z + 0.35]);
  }

  // ---- the two shop fronts ----
  const glassC = 0xa7c0cb;
  for (const [f, holes] of [[F, front], [R, side]]) {
    for (const h of holes) {
      if (h.y0 < 0) continue;
      // bulkhead, clear glass in three lights, a dark green frame
      B.box('paint', green, [h.u0 - 0.1, h.u1 + 0.1], [-0.4, h.y0], [-0.2, 0.18], { f });
      B.box('paint', shade(green, 1.25), [h.u0 + 0.35, h.u1 - 0.35], [0.5, h.y0 - 0.5], [0.15, 0.22], { f });
      B.box('clear', glassC, [h.u0, h.u1], [h.y0, h.y1], [-0.5, -0.42], { f });
      const n = 3;
      for (let i = 0; i <= n; i++) {
        const u = h.u0 + ((h.u1 - h.u0) * i) / n;
        B.box('paint', green, [u - (i === 0 ? 0 : 0.14), u + (i === n ? 0 : 0.14)], [h.y0, h.y1], [-0.55, 0.06], { f });
      }
      B.box('paint', green, [h.u0, h.u1], [h.y1 - 0.25, h.y1], [-0.55, 0.06], { f });
      B.box('paint', green, [h.u0 - 0.1, h.u1 + 0.1], [h.y0 - 0.05, h.y0 + 0.2], [-0.55, 0.3], { f });
      // a display shelf inside the glass
      B.box('paint', 0xd7cdb6, [h.u0 + 0.2, h.u1 - 0.2], [2.3, 2.5], [-2.6, -0.9], { f });
    }
  }
  // the doorway: casing, a transom over it and both leaves standing open
  {
    const d0 = -3.0; const d1 = 1.4; const y1 = 9.4;
    for (const [a, b] of [[d0 - 0.25, d0], [d1, d1 + 0.25]]) B.box('paint', green, [a, b], [0.1, y1], [-T, 0.12], { f: F });
    B.box('paint', green, [d0 - 0.25, d1 + 0.25], [y1, y1 + 0.3], [-T, 0.12], { f: F });
    // a leaf swung in against each jamb
    for (const s of [-1, 1]) {
      const hinge = s < 0 ? d0 + 0.05 : d1 - 0.05;
      const g = new THREE.BoxGeometry(0.14, 8.9, 2.1);
      g.translate(0, 4.55, -1.05);
      const m = new THREE.Matrix4().makeRotationY(s * 0.12).setPosition(hinge - s * 0.1, 0.12, -T);
      B.add('paint', g, green, { f: F, matrix: m });
      const gl = new THREE.BoxGeometry(0.18, 4.6, 1.5);
      gl.translate(0, 6.0, -1.05);
      B.add('glass', gl, shade(K.glass, 1.4), { f: F, matrix: m });
    }
    const sc = B.atlas.sign('OPEN', 2.6, { bg: '#b8332b', fg: '#fff6e0', px: 64, family: '"Helvetica Neue", Arial, sans-serif', fill: 0.6 });
    B.box('paint', 0xffffff, [d1 + 0.4, d1 + 1.35], [6.0, 6.37], [0.05, 0.1], { f: F, sign: sc });
  }
  // the sign fascias over both fronts, with a moulding and a cornice over the shop floor
  const signFace = (f, u0, u1, text, aspect) => {
    B.box('paint', green, [u0, u1], [10.4, 12.6], [-0.1, 0.32], { f });
    const r = B.atlas.sign(text, aspect, { px: 96, bg: '#24513d', fg: '#f4e7c2', border: '#d9b35c', family: 'Georgia, "Times New Roman", serif' });
    B.box('paint', 0xffffff, [u0 + 0.4, u1 - 0.4], [10.6, 12.4], [0.32, 0.36], { f, sign: r });
  };
  signFace(F, -HX, HX, 'CORNER GROCERY', (2 * HX - 0.8) / 1.8);
  signFace(R, -HZ, HZ, 'FRESH FRUIT  VEGETABLES  DAIRY', (2 * HZ - 0.8) / 1.8);
  band(B, 'stone', lime, HX, HZ, 12.6, 13.2, 0.55, { sides: ['front', 'right'] });
  // striped awnings over both fronts
  const stripes = [0x2f7a4c, 0xf1ead8];
  awning(B, F, -14.4, 14.4, 10.3, 5.0, 1.9, stripes, { stripe: 1.0, valance: 0.8 });
  awning(B, R, -19.0, 5.0, 10.3, 5.0, 1.9, stripes, { stripe: 1.0, valance: 0.8 });

  // ---- the upper floor and the cornice ----
  const win = { frame: K.trim, sillColor: lime, lintelColor: lime, cols: 1, rows: 2, keystone: false, lintelH: 0.5 };
  for (const u of [-9, 0, 9]) windowAt(B, F, u, 15.0, 3.2, 5.6, win);
  for (const u of [-14, -5, 5, 14]) windowAt(B, R, u, 15.0, 3.2, 5.6, win);
  for (const u of [-9, 0, 9]) windowAt(B, W.back, u, 15.0, 3.0, 5.4, { ...win, lintel: 'brick', lintelColor: shade(brick, 0.85) });
  band(B, 'paint', K.cornice, HX, HZ, TOP - 1.3, TOP + 0.4, 0.35, { sides: ['front', 'right'] });
  band(B, 'paint', shade(K.cornice, 1.2), HX, HZ, TOP + 0.4, TOP + 1.0, 1.3, { sides: ['front', 'right'] });
  band(B, 'paint', K.cornice, HX, HZ, TOP + 1.0, TOP + 1.4, 1.45, { sides: ['front', 'right'] });
  for (let i = 0; i < 12; i++) {
    const xc = -HX + 0.4 + (i * (2 * HX - 0.8)) / 11;
    B.prism('paint', shade(K.cornice, 1.08), [[0.3, TOP - 1.4], [0.6, TOP - 1.4], [1.15, TOP + 0.1], [1.15, TOP + 0.4], [0.3, TOP + 0.4]], 0, 0.4, { f: face([xc + 0.2, 0, HZ], [0, 0, 1]) });
  }
  for (let i = 0; i < 15; i++) {
    const zc = -HZ + 0.4 + (i * (2 * HZ - 0.8)) / 14;
    B.prism('paint', shade(K.cornice, 1.08), [[0.3, TOP - 1.4], [0.6, TOP - 1.4], [1.15, TOP + 0.1], [1.15, TOP + 0.4], [0.3, TOP + 0.4]], 0, 0.4, { f: face([HX, 0, zc - 0.2], [-1, 0, 0]) });
  }
  // parapets on the two plain sides
  B.box('brick', brick, [-HX, HX], [TOP, TOP + 1.2], [-HZ, -HZ + T]);
  B.box('brick', brick, [-HX, -HX + T], [TOP, TOP + 1.2], [-HZ + T, HZ]);
  B.box('stone', lime, [-HX - 0.05, HX], [TOP + 1.2, TOP + 1.45], [-HZ - 0.05, -HZ + T + 0.05]);
  B.box('stone', lime, [-HX - 0.05, -HX + T + 0.05], [TOP + 1.2, TOP + 1.45], [-HZ + T + 0.05, HZ]);
  B.box('brick', shade(brick, 0.9), [-HX + T, -HX + T + 2.4], [TOP, TOP + 4.5], [-6, -4]);

  // ---- inside: two aisles, a wall of groceries, the dairy case, the counter and its till ----
  const wood = 0x8b6a48; const shelfC = 0xd8d2c4;
  const goods = goodsVariants(B, rng);
  // two double-sided gondolas running back from the door
  for (const x of [-4.6, 4.4]) {
    const z0 = -13; const z1 = 5;
    const gf = face([x, 0, 0], [0, 0, -1]); // u = -z, n = x - X
    B.box('paint', shelfC, [-z1, -z0], [0.1, 6.0], [-0.12, 0.12], { f: gf });
    B.box('paint', shade(shelfC, 0.8), [-z1, -z0], [0.1, 0.6], [-1.3, 1.3], { f: gf });
    for (const f2 of [gf, face([x, 0, 0], [0, 0, 1])]) {
      for (const y of [0.6, 1.95, 3.3, 4.65]) {
        B.box('paint', shelfC, [f2 === gf ? -z1 : z0, f2 === gf ? -z0 : z1], [y - 0.08, y], [0.12, 1.25], { f: f2 });
        shelfGoods(B, f2, f2 === gf ? -z1 : z0, f2 === gf ? -z0 : z1, y, 0.12, 1.2, goods, rng);
      }
      B.box('paint', shelfC, [f2 === gf ? -z1 - 0.1 : z0 - 0.1, f2 === gf ? -z1 + 0.15 : z0 + 0.15], [0.1, 6.0], [0, 1.3], { f: f2 });
      B.box('paint', shelfC, [f2 === gf ? -z0 - 0.15 : z1 - 0.15, f2 === gf ? -z0 + 0.1 : z1 + 0.1], [0.1, 6.0], [0, 1.3], { f: f2 });
    }
    // an aisle sign hanging from the ceiling
    const label = x < 0 ? 'AISLE 1  BREAD  CEREAL' : 'AISLE 2  CANS  RICE';
    const r = B.atlas.sign(label, 5, { px: 56, bg: '#2f5d4a', fg: '#fff4d8', family: '"Helvetica Neue", Arial, sans-serif', fill: 0.5 });
    B.box('paint', 0xffffff, [x - 2.5, x + 2.5], [9.2, 10.2], [-4.05, -3.95], { sign: r });
    for (const dx of [-2, 2]) B.box('metal', 0x8a8f94, [x + dx - 0.03, x + dx + 0.03], [10.2, 12.2], [-4.02, -3.98]);
  }
  // wall shelving down the left wall
  {
    const lf = face([-HX + T + 0.12, 0, 0], [0, 0, -1]); // u = -z, n = x + 13.98 (into the room)
    B.box('paint', wood, [-8, 17], [0.1, 7.4], [0, 0.2], { f: lf });
    for (const y of [0.6, 2.0, 3.4, 4.8, 6.2]) {
      B.box('paint', shade(wood, 1.15), [-8, 17], [y - 0.1, y], [0, 1.5], { f: lf });
      if (y < 6) shelfGoods(B, lf, -8, 17, y, 0.2, 1.45, goods, rng, { h: 1.2 });
    }
    for (const u of [-8, 17]) B.box('paint', wood, [u - 0.15, u + 0.15], [0.1, 7.4], [0, 1.55], { f: lf });
  }
  // the dairy case along the back wall: glass doors in steel frames, lit milk and cheese behind
  {
    const bf = W.back; // u = -x, n = -(z + 20)
    const n0 = -T - 2.6; const n1 = -T - 0.06;
    B.box('paint', 0xd9dcdc, [-12.5, 8.5], [0.1, 7.6], [n0, n1], { f: bf });
    B.box('paint', 0x9aa1a5, [-12.5, 8.5], [7.6, 8.4], [n0 - 0.2, n1], { f: bf });
    const r = B.atlas.sign('DAIRY  MILK  JUICE', 6, { px: 56, bg: '#2f6fae', fg: '#ffffff', family: '"Helvetica Neue", Arial, sans-serif', fill: 0.55 });
    B.box('paint', 0xffffff, [-7.5, 3.5], [7.7, 8.3], [n0 - 0.24, n0 - 0.2], { f: bf, sign: r });
    const doors = 6;
    for (let i = 0; i < doors; i++) {
      const u0 = -12.3 + i * 3.45; const u1 = u0 + 3.3;
      B.box('glass', shade(K.glass, 1.6), [u0 + 0.18, u1 - 0.18], [0.7, 7.3], [n0 - 0.06, n0 + 0.02], { f: bf });
      for (const [a, b] of [[u0, u0 + 0.18], [u1 - 0.18, u1]]) B.box('metal', 0xc0c4c7, [a, b], [0.4, 7.45], [n0 - 0.1, n0 + 0.02], { f: bf });
      B.box('metal', 0xc0c4c7, [u0, u1], [0.4, 0.7], [n0 - 0.1, n0 + 0.02], { f: bf });
      B.box('metal', 0xc0c4c7, [u0, u1], [7.3, 7.45], [n0 - 0.1, n0 + 0.02], { f: bf });
      B.box('metal', 0x8d9298, [u1 - 0.5, u1 - 0.4], [3.0, 4.8], [n0 - 0.25, n0 - 0.1], { f: bf });
    }
    B.box('paint', 0x55595c, [-12.5, 8.5], [0.1, 0.4], [n0, n0 + 0.4], { f: bf });
  }
  // a door to the storeroom, back right
  B.box('paint', 0x6a4e36, [9.6, 12.6], [0.1, 7.2], [-HZ + T, -HZ + T + 0.18]);
  B.box('paint', cream, [9.3, 12.9], [7.2, 7.5], [-HZ + T, -HZ + T + 0.2]);
  // the counter by the front window, with the till on it
  {
    const cx0 = -12.8; const cx1 = -5.6; const cz0 = 11.2; const cz1 = 13.6;
    B.box('paint', 0x7a4f32, [cx0, cx1], [0.1, 3.2], [cz0, cz1]);
    B.box('stone', 0xc9c2b2, [cx0 - 0.15, cx1 + 0.15], [3.2, 3.42], [cz0 - 0.2, cz1 + 0.1]);
    for (let i = 0; i < 5; i++) B.box('paint', shade(0x7a4f32, 1.15), [cx0 + 0.3 + i * 1.42, cx0 + 1.4 + i * 1.42], [0.6, 2.7], [cz1, cz1 + 0.05]);
    // the till: a body, a sloped key bank, a drawer and a little pop-up price display
    const tx = -7.6; const tz = 12.4;
    B.box('metal', 0x4a4d52, [tx - 0.9, tx + 0.9], [3.42, 4.2], [tz - 0.8, tz + 0.6]);
    B.box('metal', 0x5a5e63, [tx - 0.95, tx + 0.95], [3.42, 3.8], [tz + 0.6, tz + 1.05]);
    const keys = new THREE.BoxGeometry(1.6, 0.12, 0.8);
    keys.rotateX(0.45);
    keys.translate(tx, 4.1, tz + 0.25);
    B.add('paint', keys, 0xe6e0d2);
    B.box('metal', 0x2e3135, [tx - 0.7, tx + 0.7], [4.2, 4.85], [tz - 0.6, tz - 0.1]);
    const disp = B.atlas.sign('$ 4.25', 3, { px: 48, bg: '#101418', fg: '#7ef08a', family: '"Courier New", monospace', fill: 0.62 });
    B.box('paint', 0xffffff, [tx - 0.6, tx + 0.6], [4.32, 4.72], [tz - 0.1, tz - 0.06], { sign: disp });
    // candy and a scale
    for (let i = 0; i < 4; i++) B.box('paint', PRODUCT[i + 2], [cx0 + 0.4 + i * 0.9, cx0 + 1.1 + i * 0.9], [3.42, 3.75], [cz0 - 0.1, cz0 + 0.6]);
    B.turned('metal', 0xd6d8da, [[0, 0], [0.7, 0], [0.7, 0.15], [0.25, 0.3], [0.25, 0.9], [0.9, 0.95], [0.9, 1.05], [0, 1.05]], -10.6, 3.42, 12.6, { sides: 16 });
    // a stool behind the counter
    B.turned('metal', 0x9aa0a5, [[0, 0], [0.8, 0], [0.12, 0.3], [0.12, 2.4], [0.7, 2.45], [0.7, 2.7], [0, 2.7]], -9, 0.1, 9.6, { sides: 14 });
  }
  // a bread rack by the side window
  {
    const rf = face([HX - T - 2.6, 0, -1], [0, 0, -1]);
    B.box('paint', wood, [-3.5, 3.5], [0.1, 0.3], [-1.0, 1.0], { f: rf });
    for (const y of [1.6, 3.1, 4.6]) {
      B.box('paint', shade(wood, 1.15), [-3.5, 3.5], [y - 0.1, y], [-1.0, 1.0], { f: rf });
      for (let i = 0; i < 6; i++) B.ball('paint', i % 2 ? 0xc68a44 : 0xd9a85e, -2.9 + i * 1.15, y + 0.3, (i % 3 - 1) * 0.4, 0.42, { f: rf, scale: [1.3, 0.75, 0.8], w: 8, h: 5 });
    }
    for (const u of [-3.5, 3.5]) for (const nn of [-1, 1]) B.box('paint', wood, [u - 0.08, u + 0.08], [0.1, 5.0], [nn - 0.08, nn + 0.08], { f: rf });
  }

  // ---- crates of fruit by the door ----
  const fruit = [
    { c: 0xc32a22, r: 0.18 }, { c: 0xf08c1d, r: 0.19 }, { c: 0xf2d24a, r: 0.16, long: true }, { c: 0x86b83a, r: 0.17 },
    { c: 0x6b2a5a, r: 0.13 }, { c: 0xe9c33b, r: 0.15 }, { c: 0xd8452c, r: 0.17 }, { c: 0x3f8a2f, r: 0.25 },
  ];
  const crateC = 0xa27a4c;
  let fi = 0;
  for (const [u0, u1] of [[-12.6, -4.6], [3.4, 11.4]]) {
    // a stepped stand: three crates in front, low, and three tipped up behind them
    B.box('paint', shade(crateC, 0.8), [u0, u1], [-0.4, 1.0], [0.6, 3.2], { f: F });
    for (let k = 0; k < 3; k++) {
      const a = u0 + 0.1 + k * ((u1 - u0 - 0.2) / 3); const b = a + (u1 - u0 - 0.2) / 3 - 0.15;
      for (const [yb, nn, tilt] of [[1.0, 2.3, 0.0], [2.1, 1.25, 0.35]]) {
        const fr = fruit[fi++ % fruit.length];
        const m = new THREE.Matrix4().makeRotationX(tilt);
        const cw = b - a; const cd = 1.5;
        // the crate: a floor and four slatted sides, open at the top
        const crate = (gx0, gx1, gy0, gy1, gz0, gz1, c) => {
          const g = new THREE.BoxGeometry(gx1 - gx0, gy1 - gy0, gz1 - gz0);
          g.translate((gx0 + gx1) / 2, (gy0 + gy1) / 2, (gz0 + gz1) / 2);
          g.applyMatrix4(m);
          g.translate(0, yb, nn);
          B.add('paint', g, c, { f: F });
        };
        crate(a, b, 0, 0.12, -cd / 2, cd / 2, crateC);
        for (const z of [-cd / 2, cd / 2 - 0.08]) crate(a, b, 0.12, 0.62, z, z + 0.08, shade(crateC, z > 0 ? 1.08 : 0.95));
        for (const x of [a, b - 0.08]) crate(x, x + 0.08, 0.12, 0.62, -cd / 2 + 0.08, cd / 2 - 0.08, crateC);
        // a mound of fruit, and the fruit on top of it
        const mound = new THREE.SphereGeometry(1, 10, 6);
        mound.scale((cw - 0.2) / 2, 0.35, cd / 2 - 0.12);
        mound.translate((a + b) / 2, 0.3, 0);
        mound.applyMatrix4(m);
        mound.translate(0, yb, nn);
        B.add('paint', mound, shade(fr.c, 0.75), { f: F, flip: true });
        const nx = Math.max(2, Math.floor((cw - 0.2) / (fr.r * 2.1)));
        const nz = Math.max(2, Math.floor((cd - 0.25) / (fr.r * 2.1)));
        for (let ix = 0; ix < nx; ix++) {
          for (let iz = 0; iz < nz; iz++) {
            const px = a + 0.12 + fr.r + ((cw - 0.24 - 2 * fr.r) * ix) / Math.max(1, nx - 1);
            const pz = -cd / 2 + 0.12 + fr.r + ((cd - 0.24 - 2 * fr.r) * iz) / Math.max(1, nz - 1);
            const ex = ((px - (a + b) / 2) / ((cw - 0.2) / 2)) ** 2 + (pz / (cd / 2 - 0.12)) ** 2;
            const py = 0.3 + 0.35 * Math.sqrt(Math.max(0, 1 - ex)) + fr.r * 0.4;
            const g = new THREE.SphereGeometry(fr.r, 7, 4);
            if (fr.long) g.scale(2.2, 0.8, 0.8);
            g.translate(px + (rng() - 0.5) * 0.04, py, pz + (rng() - 0.5) * 0.04);
            g.applyMatrix4(m);
            g.translate(0, yb, nn);
            B.add('paint', g, shade(fr.c, 0.9 + rng() * 0.2), { f: F });
          }
        }
      }
    }
    // a price card on a stick
    const price = B.atlas.sign(u0 < 0 ? 'APPLES 3 FOR $1' : 'ORANGES 50c', 3.2, { px: 48, bg: '#fff8e4', fg: '#b32a22', family: '"Comic Sans MS", "Chalkboard SE", sans-serif', fill: 0.5 });
    B.box('paint', 0xffffff, [(u0 + u1) / 2 - 0.8, (u0 + u1) / 2 + 0.8], [3.6, 4.1], [0.55, 0.6], { f: F, sign: price });
  }
  return B.assemble();
}

// ---------------------------------------------------------------------------------------------
// Diner: a stainless-steel lunch car 40ft long and 16ft wide, shaped like the railroad car it
// grew out of: a barrel roof, ribbed steel below a long band of windows, an enamel stripe and a
// neon sign. The door in the middle of the long side is a real opening onto a checkered floor at
// ground level: a counter with ten stools down the back, four booths along the windows.
// ---------------------------------------------------------------------------------------------
function cityDiner() {
  const B = new Build(505);
  const HX = 20; const HZ = 8; const T = 0.5;
  const WALL = 9.0; // the eaves
  const W = walls(HX, HZ);
  const F = W.front;
  const steel = 0xcdd3d8; const red = 0xb8282a; const vinyl = 0xb3262b; const cream = 0xf1e9d6;
  const rng = B.rng;

  // ---- the shell ----
  const win = [];
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) { const a = s < 0 ? -19.2 + i * 2.8 : 2.6 + i * 2.8; win.push({ u0: a, u1: a + 2.6, y0: 3.7, y1: 7.3 }); }
  const door = { u0: -1.7, u1: 1.7, y0: -1, y1: 7.4 };
  holedWall(B, 'metal', steel, F, -HX, HX, -0.4, WALL, -T, 0, [...win, door]);
  B.box('metal', steel, [-HX, HX], [-0.4, WALL], [-HZ, -HZ + T]);
  const endWin = [{ u0: -5.4, u1: -0.6, y0: 3.7, y1: 7.3 }, { u0: 0.6, u1: 5.4, y0: 3.7, y1: 7.3 }];
  for (const f of [W.left, W.right]) holedWall(B, 'metal', steel, f, -HZ + T, HZ - T, -0.4, WALL, -T, 0, endWin);
  // the barrel roof: one arc band extruded the whole length, smooth-shaded, overhanging every edge
  {
    const a = HZ + 0.45; const rise = 3.5; const yE = WALL - 0.12;
    const R = (a * a + rise * rise) / (2 * rise); const cy = yE + rise - R;
    const th = Math.asin(a / R);
    const pts = [];
    const n = 24;
    for (let i = 0; i <= n; i++) { const t = -th + (2 * th * i) / n; pts.push([Math.sin(t) * R, cy + Math.cos(t) * R]); }
    for (let i = n; i >= 0; i--) { const t = -th + (2 * th * i) / n; pts.push([Math.sin(t) * (R - 0.45), cy + Math.cos(t) * (R - 0.45)]); }
    const rf = face([-HX - 0.45, 0, 0], [0, 0, -1]);
    B.prism('paint', 0xc6cacb, pts, 0, 2 * HX + 0.9, { f: rf, smooth: true });
    // the gable ends under the barrel, closing the ceiling
    const seg = [];
    for (let i = 0; i <= n; i++) { const t = -th + (2 * th * i) / n; seg.push([Math.sin(t) * (R - 0.25), cy + Math.cos(t) * (R - 0.25)]); }
    const cut = seg.filter((p) => p[1] > WALL - 0.3).map((p) => [Math.max(-HZ, Math.min(HZ, p[0])), p[1]]);
    const gable = [[-HZ, WALL - 0.3], ...cut, [HZ, WALL - 0.3]];
    for (const x of [-HX, HX - T]) B.prism('metal', steel, gable, 0, T, { f: face([x + T, 0, 0], [0, 0, 1]), smooth: false });
    // a ceiling lining of cream enamel, following the roof inside
    const lin2 = [];
    for (let i = 0; i <= n; i++) { const t = -th * 0.93 + (2 * th * 0.93 * i) / n; lin2.push([Math.sin(t) * (R - 0.47), cy + Math.cos(t) * (R - 0.47)]); }
    for (let i = n; i >= 0; i--) { const t = -th * 0.93 + (2 * th * 0.93 * i) / n; lin2.push([Math.sin(t) * (R - 0.55), cy + Math.cos(t) * (R - 0.55)]); }
    B.prism('paint', cream, lin2, T + 0.45, 2 * HX + 0.45 - T, { f: rf, smooth: true });
  }
  // rounded corners, a base of glazed tile, ribbed steel, the enamel stripe, the sill under the windows
  for (const x of [-HX, HX]) for (const z of [-HZ, HZ]) B.post('metal', steel, x, z, -0.4, WALL - 0.1, 0.55, { sides: 16 });
  // Every band wraps the car but stops either side of the door. The sides run out to the front
  // corner and the front pieces stop short of it, so no two share a top face.
  const gap = 2.05;
  const backGap = [-11.75, -8.05]; // the kitchen door, in x
  const wrap = (bag, c, y0, y1, out) => {
    band(B, bag, c, HX, HZ, y0, y1, out, { sides: ['left', 'right'] });
    B.box(bag, c, [-HX + 0.3, -gap], [y0, y1], [HZ - 0.3, HZ + out]);
    B.box(bag, c, [gap, HX - 0.3], [y0, y1], [HZ - 0.3, HZ + out]);
    B.box(bag, c, [-HX + 0.3, backGap[0]], [y0, y1], [-HZ - out, -HZ + 0.3]);
    B.box(bag, c, [backGap[1], HX - 0.3], [y0, y1], [-HZ - out, -HZ + 0.3]);
  };
  wrap('stone', 0x6b2f2a, -0.4, 0.7, 0.12);
  for (let y = 0.95; y < 3.1; y += 0.24) {
    for (const [a, b] of [[-HX + 0.3, -gap], [gap, HX - 0.3]]) B.rod('metal', shade(steel, 1.04), [a, y, HZ + 0.03], [b, y, HZ + 0.03], 0.07, { sides: 6 });
    for (const [a, b] of [[-HX + 0.3, backGap[0]], [backGap[1], HX - 0.3]]) B.rod('metal', shade(steel, 1.04), [a, y, -HZ - 0.03], [b, y, -HZ - 0.03], 0.07, { sides: 6 });
    for (const x of [-HX - 0.03, HX + 0.03]) B.rod('metal', shade(steel, 1.04), [x, y, -HZ + 0.3], [x, y, HZ - 0.3], 0.07, { sides: 6 });
  }
  wrap('paint', red, 3.15, 3.55, 0.12);
  wrap('metal', shade(steel, 1.08), 3.55, 3.72, 0.25);
  band(B, 'paint', red, HX, HZ, 7.42, 7.62, 0.1);
  // the letterboard over the windows: a long enamel panel with the menu on it
  const lb = B.atlas.sign('BREAKFAST  LUNCH  DINNER', 12, { px: 72, bg: '#f1e7cf', fg: '#b3262b', family: '"Arial Black", "Helvetica Neue", Arial, sans-serif', font: 'bold', fill: 0.62 });
  for (const s of [-1, 1]) B.box('paint', 0xffffff, s < 0 ? [-18.8, -2.2] : [2.2, 18.8], [7.75, 8.75], [0.0, 0.08], { f: F, sign: lb });
  // clear glass and steel mullions in every window
  const glassC = 0xb2c8d2;
  for (const [f, list] of [[F, win], [W.left, endWin], [W.right, endWin]]) {
    for (const h of list) {
      B.box('clear', glassC, [h.u0, h.u1], [h.y0, h.y1], [-0.3, -0.22], { f });
      B.box('metal', steel, [h.u0, h.u1], [5.9, 6.02], [-0.33, -0.19], { f });
    }
  }
  // small high windows over the back bar
  for (const u of [-14, -5, 5, 14]) {
    B.box('glass', shade(K.glass, 1.2), [u - 1.6, u + 1.6], [6.3, 7.3], [0.0, 0.06], { f: W.back });
    B.box('metal', shade(steel, 0.92), [u - 1.75, u + 1.75], [6.15, 7.45], [-0.05, 0.03], { f: W.back });
  }
  // a kitchen door at the back and its step
  B.box('metal', shade(steel, 0.85), [8.4, 11.4], [0.1, 7.2], [0, 0.1], { f: W.back });
  B.box('stone', K.concrete, [8, 11.8], [-0.4, 0.15], [0, 2.4], { f: W.back });

  // ---- the door, the entry step and the handrails ----
  {
    const d0 = door.u0; const d1 = door.u1;
    B.box('metal', shade(steel, 1.06), [d0 - 0.3, d0], [0.1, 7.4], [-T, 0.12], { f: F });
    B.box('metal', shade(steel, 1.06), [d1, d1 + 0.3], [0.1, 7.4], [-T, 0.12], { f: F });
    B.box('metal', shade(steel, 1.06), [d0 - 0.3, d1 + 0.3], [7.4, 7.7], [-T, 0.12], { f: F });
    // the leaf, stainless with a big porthole of glass, standing open inward against the jamb
    const m = new THREE.Matrix4().makeRotationY(-1.35).setPosition(d1 - 0.1, 0, -T);
    const leaf = new THREE.BoxGeometry(3.2, 7.1, 0.14); leaf.translate(-1.6, 3.65, 0);
    B.add('metal', leaf, steel, { f: F, matrix: m });
    const pane = new THREE.BoxGeometry(2.2, 3.0, 0.18); pane.translate(-1.6, 5.0, 0);
    B.add('glass', pane, shade(K.glass, 1.4), { f: F, matrix: m });
    const kick = new THREE.BoxGeometry(2.9, 0.8, 0.17); kick.translate(-1.6, 0.6, 0);
    B.add('paint', kick, red, { f: F, matrix: m });
    // the entry: a granite landing at the floor's own height, with a step's nosing and rails
    B.box('stone', 0x8f8c88, [d0 - 1.4, d1 + 1.4], [-0.4, 0.12], [-T, 3.4], { f: F });
    B.box('stone', 0x9d9a96, [d0 - 1.5, d1 + 1.5], [0.02, 0.14], [3.2, 3.5], { f: F });
    for (const u of [d0 - 1.1, d1 + 1.1]) {
      for (const n of [0.4, 3.1]) B.post('metal', steel, u, n, 0.12, 3.2, 0.08, { f: F, sides: 8 });
      B.rod('metal', steel, [u, 3.2, 0.2], [u, 3.2, 3.2], 0.08, { f: F, sides: 8 });
      B.ball('metal', steel, u, 3.2, 3.2, 0.11, { f: F });
    }
    const op = B.atlas.sign('OPEN', 2.8, { px: 48, bg: '#1d2b44', fg: '#ff6a5a', family: '"Helvetica Neue", Arial, sans-serif', fill: 0.62 });
    B.box('glow', 0xffffff, [d1 + 1.3, d1 + 2.4], [5.2, 5.6], [-0.5, -0.46], { f: F, sign: op });
  }

  // ---- the neon sign on the roof ----
  {
    const neon = B.atlas.sign('DINER', 3.2, { px: 160, bg: '#18233a', fg: '#ff4b45', border: '#ffd76a', family: '"Arial Black", "Helvetica Neue", Arial, sans-serif', font: 'bold', fill: 0.66, shadow: 'rgba(255,90,80,0.45)' });
    const sy = 12.4; const sz = 1.0;
    B.box('metal', 0x2b3446, [-6.4, 6.4], [sy + 0.6, sy + 4.8], [sz - 0.5, sz]);
    B.box('glow', 0xffffff, [-6.1, 6.1], [sy + 0.85, sy + 4.55], [sz, sz + 0.05], { sign: neon });
    B.box('glow', 0xffffff, [-6.1, 6.1], [sy + 0.85, sy + 4.55], [0, 0.05], { f: face([0, 0, sz - 0.5], [-1, 0, 0]), sign: neon });
    for (const x of [-4.5, 4.5]) {
      B.box('metal', 0x2b3446, [x - 0.15, x + 0.15], [10.5, sy + 0.7], [sz - 0.4, sz - 0.1]);
      B.bar('metal', 0x2b3446, [x, 10.6, sz - 3.0], [x, sy + 0.8, sz - 0.3], 0.18, 0.18);
    }
  }
  // two vents on the roof over the grill
  for (const x of [-10, 6]) B.turned('metal', 0xa5abb0, [[0, 0], [0.8, 0], [0.8, 1.4], [1.2, 1.5], [1.2, 1.8], [0, 1.9]], x, 11.6, -3.5, { sides: 14 });

  // ---- inside ----
  B.checker('paint', -HX + T, HX - T, -HZ + T, HZ - T, -0.4, 0.1, 1.25, 0x1e1e20, 0xeeeae0);
  // the counter: a stainless apron, a red stripe, a pale top
  const cz0 = -4.6; const cz1 = -2.8;
  B.box('metal', steel, [-15.5, 12.5], [0.1, 3.2], [cz0, cz1]);
  B.box('paint', red, [-15.5, 12.5], [2.4, 2.7], [cz1, cz1 + 0.05]);
  B.box('paint', 0xe9e1cf, [-15.7, 12.7], [3.2, 3.45], [cz0 - 0.1, cz1 + 0.35]);
  B.box('paint', 0x3a3a3c, [-15.5, 12.5], [0.1, 0.45], [cz1, cz1 + 0.12]);
  // ten stools, chrome pedestals and red seats
  for (let i = 0; i < 10; i++) {
    const x = -14.2 + i * 2.85;
    B.turned('metal', steel, [[0, 0], [0.55, 0], [0.55, 0.08], [0.12, 0.18], [0.1, 2.25], [0.4, 2.3], [0, 2.32]], x, 0.1, cz1 + 1.4, { sides: 14 });
    B.turned('paint', vinyl, [[0, 0], [0.68, 0.02], [0.72, 0.2], [0.6, 0.34], [0, 0.36]], x, 2.4, cz1 + 1.4, { sides: 16 });
  }
  // the back bar: work counter, griddle and hood, coffee urns, a pie case, a menu board and a clock
  B.box('metal', steel, [-HX + T, HX - T], [0.1, 3.0], [-HZ + T, -HZ + T + 1.6]);
  B.box('paint', 0xe9e1cf, [-HX + T, HX - T], [3.0, 3.2], [-HZ + T, -HZ + T + 1.7]);
  B.box('paint', 0xe9dfc6, [-HX + T, HX - T], [3.2, WALL], [-HZ + T, -HZ + T + 0.06]);
  // a band of tile behind the counter
  B.box('paint', 0x2a6c6b, [-HX + T, HX - T], [3.2, 4.4], [-HZ + T + 0.06, -HZ + T + 0.1]);
  B.box('metal', 0x3a3d40, [-12, -6], [3.2, 3.4], [-HZ + T + 0.1, -HZ + T + 1.5]);
  B.box('metal', shade(steel, 0.9), [-12.6, -5.4], [7.0, 8.3], [-HZ + T + 0.06, -HZ + T + 2.0]);
  for (const x of [-3.5, -1.5]) {
    B.turned('metal', steel, [[0, 0], [0.5, 0], [0.55, 1.6], [0.4, 1.75], [0.12, 1.8], [0.12, 2.0], [0, 2.0]], x, 3.2, -HZ + T + 0.9, { sides: 14 });
    B.box('metal', 0x2b2b2b, [x - 0.05, x + 0.05], [3.5, 3.7], [-HZ + T + 1.4, -HZ + T + 1.6]);
  }
  B.box('clear', 0xc8d8de, [1.0, 4.4], [3.45, 5.0], [cz0 + 0.05, cz0 + 1.35]);
  for (let i = 0; i < 3; i++) B.turned('paint', i === 1 ? 0x8f3a3a : 0xd6a65a, [[0, 0], [0.42, 0], [0.42, 0.25], [0, 0.32]], 1.6 + i * 1.1, 3.45, cz0 + 0.7, { sides: 12 });
  for (const x of [8.0, 9.4]) B.turned('metal', 0xd4d7da, [[0, 0], [0.28, 0], [0.3, 0.9], [0.18, 1.0], [0, 1.0]], x, 3.2, -HZ + T + 0.8, { sides: 10 });
  const menu = B.atlas.paint(640, 230, (ctx, w, h) => {
    ctx.fillStyle = '#1f2a24'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f3e7c4'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const rows = [['COFFEE', '10c'], ['PIE', '25c'], ['EGGS AND TOAST', '45c'], ['HAMBURGER', '35c'], ['GRILLED CHEESE', '30c'], ['MILKSHAKE', '25c']];
    ctx.font = 'bold 26px "Helvetica Neue", Arial, sans-serif';
    rows.forEach(([a, b], i) => {
      const col2 = i < 3 ? 0 : 1; const r = i % 3;
      const x = 24 + col2 * (w / 2); const y = 46 + r * 64;
      ctx.fillText(a, x, y);
      ctx.textAlign = 'right'; ctx.fillText(b, x + w / 2 - 48, y); ctx.textAlign = 'left';
    });
  });
  B.box('paint', 0xffffff, [2, 13], [5.2, 8.4], [-HZ + T + 0.06, -HZ + T + 0.14], { sign: menu });
  const clock = B.atlas.paint(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f6f1e4'; ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.46, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 5; ctx.stroke();
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; ctx.fillStyle = '#2b2b2b'; ctx.fillRect(w / 2 + Math.sin(a) * 50 - 2, h / 2 - Math.cos(a) * 50 - 2, 4, 4); }
    ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(w / 2, h / 2); ctx.lineTo(w / 2 + 22, h / 2 - 18); ctx.stroke();
    ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(w / 2, h / 2); ctx.lineTo(w / 2 - 6, h / 2 - 42); ctx.stroke();
  });
  B.turned('paint', 0xffffff, [[0, 0], [0.75, 0], [0.75, 0.12], [0, 0.14]], -14.5, 6.6, -HZ + T + 0.06, { rotate: Math.PI / 2, sides: 20 });
  B.box('paint', 0xffffff, [-15.1, -13.9], [6.0, 7.2], [-HZ + T + 0.2, -HZ + T + 0.22], { sign: clock });
  // four booths along the windows: two benches and a table each
  for (const xc of [-15.2, -8.6, 8.6, 15.2]) {
    for (const s of [-1, 1]) {
      const x0 = xc + s * 2.1; const x1 = xc + s * 3.3;
      const lo = Math.min(x0, x1); const hi = Math.max(x0, x1);
      B.box('paint', 0x5a2a22, [lo, hi], [0.1, 1.5], [2.6, HZ - T]);
      B.box('paint', vinyl, [lo - (s < 0 ? 0.0 : 0.05), hi + (s < 0 ? 0.05 : 0)], [1.5, 1.85], [2.55, HZ - T]);
      const bx = s > 0 ? [hi - 0.45, hi] : [lo, lo + 0.45];
      B.box('paint', vinyl, bx, [1.85, 4.2], [2.55, HZ - T]);
      B.box('metal', steel, [bx[0] - 0.02, bx[1] + 0.02], [4.2, 4.35], [2.5, HZ - T]);
    }
    B.box('paint', 0xe7dfcf, [xc - 1.9, xc + 1.9], [2.45, 2.62], [3.0, HZ - T]);
    B.box('metal', steel, [xc - 1.95, xc + 1.95], [2.4, 2.47], [2.95, HZ - T]);
    B.post('metal', steel, xc, 3.6, 0.1, 2.45, 0.12, { sides: 8 });
    B.post('metal', steel, xc, 3.6, 0.1, 0.18, 0.7, { sides: 12 });
    // a sugar pourer, a napkin box and two coffee cups
    B.turned('clear', 0xe8eef0, [[0, 0], [0.13, 0], [0.13, 0.35], [0.06, 0.45], [0, 0.45]], xc, 2.62, HZ - T - 0.4, { sides: 8 });
    B.box('metal', steel, [xc + 0.25, xc + 0.6], [2.62, 2.95], [HZ - T - 0.55, HZ - T - 0.25]);
    for (const s of [-1, 1]) B.turned('paint', 0xf4f0e6, [[0, 0], [0.13, 0], [0.16, 0.25], [0, 0.25]], xc + s * 1.2, 2.62, 4.6 + rng() * 0.5, { sides: 10 });
  }
  // pendant lamps down the middle
  for (let x = -16; x <= 16; x += 4) {
    B.box('metal', 0x8c9196, [x - 0.02, x + 0.02], [9.3, 11.2], [0.38, 0.42]);
    B.ball('glow', 0xffffff, x, 9.1, 0.4, 0.38, { w: 10, h: 7 });
  }
  return B.assemble();
}

// ---------------------------------------------------------------------------------------------
// Post office: 40 x 40, brick with limestone trim, one tall storey over a raised base, stone steps
// up to the door, POST OFFICE across the frieze, a cupola, a flag on its pole, a blue collection
// box at the curb and a loading dock round the +X side for the mail trucks.
// ---------------------------------------------------------------------------------------------
function flagArt(ctx, w, h) {
  const stripe = h / 13;
  for (let i = 0; i < 13; i++) { ctx.fillStyle = i % 2 ? '#f4f1ea' : '#b22234'; ctx.fillRect(0, i * stripe, w, stripe + 0.5); }
  const cw = w * 0.4; const ch = stripe * 7;
  ctx.fillStyle = '#3c3b6e'; ctx.fillRect(0, 0, cw, ch);
  ctx.fillStyle = '#f4f1ea';
  const star = (cx, cy, r) => {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5; const rr = k % 2 ? r * 0.4 : r; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  };
  for (let r = 0; r < 9; r++) {
    const n = r % 2 ? 5 : 6;
    for (let c = 0; c < n; c++) star(cw * ((c + (r % 2 ? 1 : 0.5)) / 6), ch * ((r + 0.5) / 9), ch * 0.045);
  }
}

function postOffice() {
  const B = new Build(606);
  const HX = 20; const HZ = 20;
  const W = walls(HX, HZ);
  const F = W.front;
  const BASE = 3.0; const EAVE = 21.5; const TOP = 24.6;
  const brick = 0x9a4b38; const lime = 0xd9cfb8; const granite = 0x8a8782;

  // ---- the mass, the base, the quoins ----
  B.box('stone', granite, [-HX, HX], [-0.4, BASE], [-HZ, HZ]);
  B.box('brick', brick, [-HX, HX], [BASE, EAVE], [-HZ, HZ]);
  band(B, 'stone', lime, HX, HZ, BASE - 0.1, BASE + 0.55, 0.3);
  for (const x of [-HX, HX]) for (const z of [-HZ, HZ]) {
    for (let k = 0; k < 12; k++) {
      const y0 = BASE + 0.55 + k * 1.45; const y1 = y0 + 1.3;
      if (y1 > EAVE - 0.2) break;
      const long = k % 2 === 0;
      const sx = Math.sign(x); const sz = Math.sign(z);
      // each block wraps the corner: long on one face, short on the other, alternating
      const ax = long ? 2.2 : 1.3; const az = long ? 1.3 : 2.2;
      B.box('stone', shade(lime, 0.97 + (k % 3) * 0.02), sx > 0 ? [x - ax, x + 0.14] : [x - 0.14, x + ax], [y0, y1], sz > 0 ? [z - 0.4, z + 0.14] : [z - 0.14, z + 0.4]);
      B.box('stone', shade(lime, 0.97 + (k % 3) * 0.02), sx > 0 ? [x - 0.4, x - 0.0] : [x, x + 0.4], [y0, y1], sz > 0 ? [z - az, z - 0.4] : [z + 0.4, z + az]);
    }
  }

  // ---- the front: four tall windows and the entrance ----
  const win = { frame: K.trim, sillColor: lime, lintelColor: lime, cols: 3, rows: 8, keystone: true, lintelH: 0.9, hood: false };
  for (const u of [-14.5, -8.5, 8.5, 14.5]) windowAt(B, F, u, BASE + 2.4, 4.2, 12.4, win);
  {
    const d0 = -3.0; const d1 = 3.0; const y0 = BASE + 0.05; const y1 = BASE + 9.6;
    B.box('paint', 0x15130f, [d0, d1], [y0, y1 + 3.2], [-0.1, 0.02], { f: F });
    doorLeaf(B, F, d0 + 0.1, -0.03, y0, y1, 0.12, 0x3a2a1e, { glazed: true, knob: K.brass, kick: K.brass });
    doorLeaf(B, F, 0.03, d1 - 0.1, y0, y1, 0.12, 0x3a2a1e, { glazed: true, knob: K.brass, kick: K.brass });
    B.box('paint', K.trim, [d0, d1], [y1, y1 + 0.3], [-0.05, 0.2], { f: F });
    // a fanlight over the door: glass with radiating glazing bars
    B.box('glass', shade(K.glass, 1.25), [d0 + 0.1, d1 - 0.1], [y1 + 0.3, y1 + 3.1], [-0.06, 0.04], { f: F });
    for (let k = 1; k < 6; k++) {
      const a = Math.PI * (k / 6);
      B.bar('paint', K.trim, [0, y1 + 0.35, 0.06], [-Math.cos(a) * 2.8, y1 + 0.35 + Math.sin(a) * 2.7, 0.06], 0.08, 0.06, { f: F, up: [0, 0, 1] });
    }
    // a limestone surround: pilasters, an entablature and a pediment
    for (const u of [d0 - 1.2, d1]) {
      B.box('stone', lime, [u, u + 1.2], [BASE, y1 + 3.4], [-0.1, 0.45], { f: F });
      B.box('stone', shade(lime, 1.04), [u - 0.1, u + 1.3], [BASE, BASE + 0.9], [-0.1, 0.55], { f: F });
      B.box('stone', shade(lime, 1.04), [u - 0.15, u + 1.35], [y1 + 3.4, y1 + 3.8], [-0.1, 0.6], { f: F });
    }
    B.box('stone', lime, [d0 - 1.5, d1 + 1.5], [y1 + 3.8, y1 + 4.9], [-0.1, 0.5], { f: F });
    B.box('stone', shade(lime, 1.05), [d0 - 1.8, d1 + 1.8], [y1 + 4.9, y1 + 5.3], [-0.1, 0.8], { f: F });
    const pw = d1 - d0 + 3.6; const ph = 2.2; const pb = y1 + 5.3;
    B.prism('stone', lime, [[-pw / 2, pb], [pw / 2, pb], [0, pb + ph]], -0.1, 0.7, { f: F });
    B.prism('stone', shade(lime, 0.9), [[-pw / 2 + 0.9, pb + 0.25], [pw / 2 - 0.9, pb + 0.25], [0, pb + ph - 0.45]], 0.7, 0.76, { f: F });
  }

  // ---- the frieze, POST OFFICE, the cornice, the parapet ----
  band(B, 'stone', lime, HX, HZ, EAVE - 0.4, TOP - 1.4, 0.2);
  band(B, 'stone', shade(lime, 1.04), HX, HZ, TOP - 1.4, TOP - 0.9, 0.55);
  band(B, 'stone', lime, HX, HZ, TOP - 0.9, TOP - 0.35, 1.15);
  band(B, 'stone', shade(lime, 1.06), HX, HZ, TOP - 0.35, TOP, 1.25);
  for (let x = -HX + 0.6; x < HX - 0.5; x += 0.9) B.box('stone', shade(lime, 0.95), [x, x + 0.45], [TOP - 1.4, TOP - 1.0], [HZ + 0.4, HZ + 0.8]);
  const word = B.atlas.sign('POST OFFICE', 10, { px: 96, bg: '#d6ccb5', fg: '#3e3428', family: 'Georgia, "Times New Roman", serif', font: 'bold', fill: 0.62, shadow: 'rgba(0,0,0,0.25)' });
  B.box('paint', 0xffffff, [-11, 11], [EAVE - 0.25, TOP - 1.55], [HZ + 0.2, HZ + 0.24], { sign: word });
  // a brick parapet with a stone coping and a balustraded centre over the door
  for (const [xr, zr] of [[[-HX, HX], [HZ - 0.8, HZ]], [[-HX, HX], [-HZ, -HZ + 0.8]], [[-HX, -HX + 0.8], [-HZ + 0.8, HZ - 0.8]], [[HX - 0.8, HX], [-HZ + 0.8, HZ - 0.8]]]) {
    B.box('brick', brick, xr, [TOP, TOP + 2.0], zr);
  }
  band(B, 'stone', lime, HX, HZ, TOP + 2.0, TOP + 2.35, 0.1, { inset: 0.9 });
  {
    const bz = HZ - 0.4;
    B.box('stone', lime, [-8, 8], [TOP, TOP + 0.5], [bz - 0.5, bz + 0.5]);
    B.box('stone', lime, [-8.2, 8.2], [TOP + 2.6, TOP + 3.0], [bz - 0.6, bz + 0.6]);
    for (let x = -7.6; x <= 7.65; x += 0.95) B.turned('stone', lime, [[0, 0], [0.26, 0], [0.18, 0.35], [0.32, 1.1], [0.16, 1.8], [0.24, 2.1], [0, 2.1]], x, TOP + 0.5, bz, { sides: 10 });
    for (const x of [-8.6, 8.6]) B.box('stone', lime, [x - 0.6, x + 0.6], [TOP, TOP + 3.2], [bz - 0.6, bz + 0.6]);
  }
  B.box('paint', K.tar, [-HX + 0.8, HX - 0.8], [TOP - 0.6, TOP - 0.4], [-HZ + 0.8, HZ - 0.8]);
  B.box('brick', brick, [-HX + 0.8, HX - 0.8], [EAVE, TOP - 0.6], [-HZ + 0.8, HZ - 0.8]);
  // the cupola: a square base, louvred openings, a dome-ish roof and a ball finial
  {
    const cyb = TOP - 0.4; const cz = -2;
    B.box('brick', brick, [-3.6, 3.6], [cyb, cyb + 3.2], [cz - 3.6, cz + 3.6]);
    B.box('stone', lime, [-3.8, 3.8], [cyb + 3.2, cyb + 3.6], [cz - 3.8, cz + 3.8]);
    B.box('paint', 0xe9e4d8, [-3.0, 3.0], [cyb + 3.6, cyb + 8.2], [cz - 3.0, cz + 3.0]);
    for (const f of [face([0, 0, cz + 3.0], [1, 0, 0]), face([0, 0, cz - 3.0], [-1, 0, 0]), face([3.0, 0, cz], [0, 0, -1]), face([-3.0, 0, cz], [0, 0, 1])]) {
      B.box('paint', 0x2d2a26, [-1.4, 1.4], [cyb + 4.2, cyb + 7.6], [-0.1, 0.03], { f });
      for (let y = cyb + 4.5; y < cyb + 7.5; y += 0.4) B.box('paint', 0xe9e4d8, [-1.4, 1.4], [y, y + 0.12], [0, 0.12], { f });
      for (const u of [-1.75, 1.75]) B.box('paint', 0xf2eee5, [u - 0.3, u + 0.3], [cyb + 3.6, cyb + 8.2], [-0.05, 0.18], { f });
    }
    B.box('paint', 0xe9e4d8, [-3.4, 3.4], [cyb + 8.2, cyb + 8.8], [cz - 3.4, cz + 3.4]);
    // a four-sided ogee roof, turned so its faces sit square on the cupola below
    const roof = lathe([[0, 0], [4.6, 0], [4.2, 0.8], [3.0, 1.9], [1.4, 2.7], [0.5, 3.1], [0, 3.2]], 4);
    roof.rotateY(Math.PI / 4);
    roof.translate(0, cyb + 8.8, cz);
    B.add('metal', roof, 0x5f8a6e, { flip: true });
    B.post('metal', 0xb08d4e, 0, cz, cyb + 11.9, cyb + 13.4, 0.08, { sides: 6 });
    B.ball('metal', 0xc9a24a, 0, cyb + 13.5, cz, 0.3, { w: 10, h: 8 });
  }

  // ---- the steps ----
  {
    const s0 = -6.5; const s1 = 6.5; const land = 3.2; const n = 6;
    const rise = BASE / n; const run = 1.05;
    B.box('stone', lime, [s0, s1], [-0.4, BASE], [HZ - 0.1, HZ + land]);
    for (let k = 0; k < n - 1; k++) {
      const top = rise * (k + 1); const front = land + run * (n - 1 - k);
      B.box('stone', shade(lime, 1.03), [s0, s1], [k === 0 ? -0.4 : rise * k, top], [HZ + land - 0.05, HZ + front + 0.08]);
    }
    const front = land + run * (n - 1);
    for (const x of [s0 - 1.3, s1]) {
      B.prism('stone', granite, [[0, -0.4], [front + 0.3, -0.4], [front + 0.3, 1.4], [land, BASE + 0.9], [0, BASE + 0.9]], 0, 1.3, { f: face([x + 1.3, 0, HZ], [0, 0, 1]) });
      // a lamp on each cheek
      const lx = x + 0.65; const lz = HZ + front - 0.3;
      B.post('metal', 0x23272a, lx, lz, 1.4, 5.6, 0.12, { sides: 10 });
      B.turned('metal', 0x23272a, [[0, 0], [0.4, 0], [0.4, 0.3], [0, 0.35]], lx, 1.4, lz, { sides: 10 });
      B.ball('glass', 0xf2ead2, lx, 6.1, lz, 0.55, { w: 12, h: 9 });
      B.turned('metal', 0x23272a, [[0, 0], [0.3, 0], [0.12, 0.3], [0, 0.4]], lx, 6.55, lz, { sides: 10 });
    }
    // a brass handrail down the middle of the flight
    railing(B, 'metal', 0xb08d4e, [0, BASE, HZ + land - 0.2], [0, rise, HZ + front - 0.2], 2.8, { step: 1.6, post: 0.05, rail: 0.1 });
  }

  // ---- the flag ----
  {
    const fx = -14; const fz = HZ + 7.5; const H = 32;
    B.turned('stone', granite, [[0, 0], [1.6, 0], [1.6, 0.6], [1.2, 0.9], [0, 0.9]], fx, -0.4, fz, { sides: 16 });
    B.post('metal', 0xd8dadc, fx, fz, 0.5, H, 0.14, { r2: 0.08, sides: 10 });
    B.ball('metal', 0xc9a24a, fx, H + 0.25, fz, 0.3, { w: 10, h: 8 });
    const art = B.atlas.paint(380, 200, flagArt);
    const g = new THREE.BoxGeometry(7.6, 4.0, 0.06, 16, 1, 1);
    g.translate(fx + 0.15 + 3.8, H - 2.4, fz);
    B.add('paint', g, 0xffffff, { sign: art, signBack: true, warp: (x, y, z) => { const d = x - fx - 0.15; return [x, y - d * 0.04, z + Math.sin(d * 1.1) * 0.22 * Math.min(1, d / 1.5)]; } });
    B.post('metal', 0x9a9c9e, fx + 0.12, fz, H - 4.5, H - 0.3, 0.025, { sides: 4 });
  }

  // ---- the blue collection box at the curb ----
  {
    const mx = 11; const mz = HZ + 8.6; const blue = 0x2a4f8c;
    for (const dx of [-0.7, 0.7]) for (const dz of [-0.6, 0.6]) B.box('metal', 0x1f2733, [mx + dx - 0.08, mx + dx + 0.08], [0, 0.9], [mz + dz - 0.08, mz + dz + 0.08]);
    B.box('paint', blue, [mx - 0.9, mx + 0.9], [0.8, 3.2], [mz - 0.8, mz + 0.8]);
    const top = new THREE.CylinderGeometry(0.9, 0.9, 1.6, 20);
    top.rotateX(Math.PI / 2); top.translate(mx, 3.2, mz);
    B.add('paint', top, blue);
    // the pull-down chute, a white plate and the word MAIL
    B.box('metal', 0x8e959c, [mx - 0.55, mx + 0.55], [3.25, 3.7], [mz + 0.75, mz + 0.95]);
    B.box('metal', 0x5c636a, [mx - 0.35, mx + 0.35], [3.55, 3.64], [mz + 0.95, mz + 1.02]);
    const mail = B.atlas.sign('MAIL', 2.4, { px: 64, bg: '#2a4f8c', fg: '#ffffff', family: '"Helvetica Neue", Arial, sans-serif', font: 'bold', fill: 0.62 });
    B.box('paint', 0xffffff, [mx - 0.7, mx + 0.7], [2.2, 2.78], [mz + 0.8, mz + 0.83], { sign: mail });
    B.box('paint', 0xeeeae0, [mx - 0.45, mx + 0.45], [1.3, 1.85], [mz + 0.8, mz + 0.83]);
  }

  // ---- sides and back ----
  const plain = { frame: K.trim, sillColor: lime, lintelColor: lime, cols: 3, rows: 8, keystone: true, lintelH: 0.9 };
  for (const u of [-14, -5, 5, 14]) windowAt(B, W.left, u, BASE + 2.4, 4.2, 12.4, plain);
  for (const u of [-14, -5]) windowAt(B, W.right, u, BASE + 2.4, 4.2, 12.4, plain);
  for (const u of [-12, 0, 12]) windowAt(B, W.back, u, BASE + 2.4, 4.2, 12.4, plain);

  // ---- the loading dock round the +X side ----
  {
    const R = W.right; // u = -z, n = x - 20
    const z0 = -18.5; const z1 = -3.5; const DY = 4.0; const DN = 7.5;
    // the platform, with a steel edge and black rubber bumpers on its face
    B.box('stone', K.concrete, [-z1, -z0], [-0.4, DY], [-0.1, DN], { f: R });
    B.box('metal', 0x6c7176, [-z1, -z0], [DY - 0.25, DY + 0.02], [DN - 0.05, DN + 0.12], { f: R });
    for (const u of [-z1 + 2.5, -z0 - 2.5]) B.box('paint', 0x1d1e20, [u - 0.6, u + 0.6], [DY - 2.0, DY - 0.35], [DN, DN + 0.55], { f: R });
    for (let u = -z1 + 0.6; u < -z0; u += 3.6) B.box('paint', 0xe2b23a, [u, u + 1.4], [DY - 0.24, DY - 0.08], [DN + 0.12, DN + 0.13], { f: R });
    // stairs down to the street at the front end of the dock, and a pipe rail
    steps(B, 'stone', K.concrete, face([HX, 0, z1], [1, 0, 0]), 0.2, 3.6, 4.6, -0.05, 0, DY, 6);
    railing(B, 'metal', 0xe2b23a, [HX + 3.8, DY, z1 + 0.2], [HX + 3.8, 0.5, z1 + 4.4], 3.0, { step: 2, post: 0.06, rail: 0.1 });
    railing(B, 'metal', 0xe2b23a, [HX + DN - 0.2, DY, z1 - 0.2], [HX + DN - 0.2, DY, z0 + 0.3], 3.0, { step: 3.5, post: 0.06, rail: 0.1 });
    // a steel canopy over it, hung on tie rods
    B.box('metal', 0x7f868c, [-z1 + 0.5, -z0 + 0.5], [15.6, 16.1], [-0.1, DN + 0.6], { f: R });
    B.box('metal', 0x5d6369, [-z1 + 0.5, -z0 + 0.5], [15.1, 15.6], [DN + 0.3, DN + 0.6], { f: R });
    for (const u of [-z1 + 1.5, -z0 - 1.5]) B.bar('metal', 0x3a3f44, [u, 20.4, 0], [u, 16.05, DN + 0.3], 0.09, 0.09, { f: R });
    // the roll-up door, ribbed, and a steel door for people beside it
    B.box('paint', 0x2a2724, [5.0, 15.5], [DY, 14.4], [-0.1, 0.02], { f: R });
    for (let y = DY + 0.1; y < 14.2; y += 0.45) B.box('metal', 0xa3a8ad, [5.2, 15.3], [y, y + 0.38], [0, 0.1], { f: R });
    B.box('stone', lime, [4.6, 15.9], [14.4, 15.0], [-0.1, 0.25], { f: R });
    B.box('metal', 0x6d7276, [16.4, 19.0], [DY, DY + 7.2], [-0.1, 0.06], { f: R });
    const dock = B.atlas.sign('LOADING DOCK', 6, { px: 56, bg: '#2a4f8c', fg: '#ffffff', family: '"Helvetica Neue", Arial, sans-serif', font: 'bold', fill: 0.58 });
    B.box('paint', 0xffffff, [7.0, 13.5], [12.0 + 3.1, 12.0 + 4.1], [0, 0.06], { f: R, sign: dock });
  }
  // a door at the back
  B.box('paint', 0x15130f, [-7.6, -5.0], [BASE + 0.55, BASE + 7.8], [-0.1, 0.02], { f: W.back });
  doorLeaf(B, W.back, -7.5, -5.1, BASE + 0.6, BASE + 7.6, 0.12, 0x4e5458, { panels: 2 });
  casing(B, 'stone', lime, W.back, -7.6, -5.0, BASE + 0.55, BASE + 7.8, { w: 0.35, out: 0.25, head: 0.5 });
  B.box('stone', K.concrete, [-8.4, -4.2], [-0.4, BASE + 0.55], [-0.1, 1.8], { f: W.back });
  steps(B, 'stone', K.concrete, W.back, -8.4, -4.2, 5.4, 1.7, 0, BASE + 0.55, 5);
  return B.assemble();
}

export const BUILDERS = {
  'row-house': rowHouse,
  'apartment-building': apartmentBuilding,
  'office-tower': officeTower,
  'corner-grocery': cornerGrocery,
  'city-diner': cityDiner,
  'post-office': postOffice,
};

